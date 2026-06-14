// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chart-analysis  (spec §3)
//
// The AI never detects anything. It receives the deterministic digest produced
// by lib/patterns + indicator helpers and writes the narrative. Output is strict
// JSON. Cached in Redis (key chartai:{symbol}:{tf}:{digest}, TTL 15 min) and
// per-IP rate limited — this is the most expensive endpoint in the app.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimiter'
import { callAI, parseAIJson, type AIMessage } from '@/lib/ai-provider'
import { redis } from '@db/redis'

interface AiNote {
  bias: 'bullish' | 'bearish' | 'neutral'
  biasStrength: string
  headline: string
  narrative: string
  bullCase: string
  bearCase: string
  keyLevelToWatch: string
  riskNote: string
}

const CACHE_TTL = 15 * 60   // 15 minutes
const num = (n: unknown): string => (typeof n === 'number' && isFinite(n) ? (Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(2)) : '—')

const SYSTEM_PROMPT = `You are a senior technical analyst writing a concise desk note. You will be given a STRUCTURED DIGEST of deterministic technical detections (a composite rating, market structure, detected chart/candlestick patterns, key levels, and an indicator snapshot) for one symbol and timeframe.

Rules:
- Reference ONLY the data provided. Do NOT invent patterns, levels, prices, or indicators that are not in the digest.
- This is analysis of historical price structure, NOT financial advice and NOT a prediction.
- Output STRICT JSON only — no markdown, no preamble — with EXACTLY these keys:
  {"bias": "bullish"|"bearish"|"neutral", "biasStrength": string, "headline": string, "narrative": string, "bullCase": string, "bearCase": string, "keyLevelToWatch": string, "riskNote": string}
- "narrative" must be <= 120 words. "headline" <= 12 words. Keep every other field to one sentence.
- Ground the bias in the composite rating and structure; cite the highest-confidence pattern by name and its breakout/target/invalidation when present.`

function buildUserDigest(b: Record<string, unknown>): string {
  const rating = b.rating as any
  const structure = b.structure as any
  const patterns = (b.patterns as any[]) ?? []
  const kl = b.keyLevels as any
  const ind = b.indicatorSnapshot as any
  const lines: string[] = []
  lines.push(`SYMBOL: ${b.symbol}   TIMEFRAME: ${b.timeframe}   LAST: ${num(b.lastClose)}`)
  if (rating?.overall) {
    lines.push(`COMPOSITE RATING: ${rating.overall.label} (score ${Number(rating.overall.score).toFixed(2)}) | MAs ${rating.movingAvg?.label} | Oscillators ${rating.oscillators?.label}`)
  }
  if (structure) {
    lines.push(`STRUCTURE: ${structure.bias} (${structure.label})${structure.lastEvent ? ` | last event ${structure.lastEvent.type} ${structure.lastEvent.direction}` : ''} | support ${num(structure.support)} | resistance ${num(structure.resistance)}`)
  }
  if (patterns.length) {
    lines.push('PATTERNS (highest confidence first):')
    for (const p of patterns) {
      lines.push(`  - ${p.name} [${p.direction}/${p.status}] conf ${p.confidence} | breakout ${num(p.breakoutLevel)} target ${num(p.target)} invalidation ${num(p.invalidation)} :: ${p.implication}`)
    }
  } else {
    lines.push('PATTERNS: none currently qualifying.')
  }
  if (kl) lines.push(`KEY LEVELS: support ${num(kl.support)} | resistance ${num(kl.resistance)}`)
  if (ind) {
    lines.push(`INDICATORS: RSI ${num(ind.rsi)} | MACD ${ind.macdState} | vol vs 20d ${ind.volVs20 != null ? `${Number(ind.volVs20).toFixed(2)}x` : '—'} | ATR% ${num(ind.atrPct)} | dist 50SMA ${num(ind.distFrom50)}% | dist 200SMA ${num(ind.distFrom200)}%`)
  }
  return lines.join('\n')
}

function cacheKey(b: Record<string, unknown>): string {
  const rating = b.rating as any
  const top = (b.patterns as any[])?.[0]
  const digest = `${rating?.overall?.label ?? 'na'}_${top?.id ?? 'none'}_${top?.status ?? ''}_${num(b.lastClose)}`
  return `chartai:${b.symbol}:${b.timeframe}:${digest}`
}

function normalize(n: Partial<AiNote> | null): AiNote | null {
  if (!n) return null
  const bias = n.bias === 'bullish' || n.bias === 'bearish' || n.bias === 'neutral' ? n.bias : 'neutral'
  return {
    bias,
    biasStrength: String(n.biasStrength ?? '').slice(0, 40),
    headline: String(n.headline ?? '').slice(0, 140),
    narrative: String(n.narrative ?? '').slice(0, 900),
    bullCase: String(n.bullCase ?? '').slice(0, 300),
    bearCase: String(n.bearCase ?? '').slice(0, 300),
    keyLevelToWatch: String(n.keyLevelToWatch ?? '').slice(0, 160),
    riskNote: String(n.riskNote ?? '').slice(0, 300),
  }
}

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const rl = rateLimit(`chart-analysis:${ip}`, 12, 60_000)  // 12 req/min per IP — expensive
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded — try again shortly.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body?.symbol || !body?.rating) {
    return NextResponse.json({ error: 'Missing symbol or rating digest' }, { status: 400 })
  }

  const key = cacheKey(body)
  try {
    const cached = await redis.get<AiNote>(key)
    if (cached) return NextResponse.json(cached, { headers: { 'x-cache': 'hit' } })
  } catch { /* cache miss path */ }

  const messages: AIMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserDigest(body) },
  ]

  const ai = await callAI(messages, 700)
  if (!ai.text) {
    return NextResponse.json({ error: 'No AI provider configured or all providers failed.' }, { status: 503 })
  }
  const note = normalize(parseAIJson<AiNote>(ai.text))
  if (!note || !note.headline) {
    return NextResponse.json({ error: 'AI returned an unparseable response.' }, { status: 502 })
  }

  try { await redis.set(key, note, { ex: CACHE_TTL }) } catch { /* non-fatal */ }
  return NextResponse.json(note, { headers: { 'x-cache': 'miss', 'x-ai-provider': ai.provider } })
}

export async function GET() {
  return NextResponse.json({ message: 'POST a chart digest to receive an AI analyst note.' })
}
