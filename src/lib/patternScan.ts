// ─────────────────────────────────────────────────────────────────────────────
// Pattern-scan pipeline — server-side.
//
// Runs the SAME detectAll() the chart uses over daily or weekly candles.
// The universe (US list + the whole Nifty 500) is scanned in chunks of
// SCAN_CHUNK symbols: one small request per chunk, each cached for hours, so
// no single request has to sweep 600 symbols and a slow upstream only delays
// the chunk it affects. Keyless (Yahoo chart data), no cost.
// ─────────────────────────────────────────────────────────────────────────────

import type { Candle, PatternDetection } from '@/lib/patterns'
import { detectAll } from '@/lib/patterns'
import { upstreamFetch } from '@/lib/providers/http'
import { createCache } from '@/lib/providers/cache'
import { chunkEntries, UNIVERSE_BY_SYMBOL, type ScanMarket, type UniverseEntry } from '@/data/universe'

export type ScanTf = '1D' | '1W'

export interface ScanDetection {
  id:            string
  name:          string
  direction:     PatternDetection['direction']
  status:        PatternDetection['status']
  category:      PatternDetection['category']
  confidence:    number
  breakoutLevel: number | null
  target:        number | null
  ageBar:        number
  distToBreakoutPct: number | null
  /** Outline vertices normalised to 0..1 along the sparkline (geometric only). */
  outline:       Array<{ x: number; y: number }>
}

export interface SymbolScan {
  symbol:     string
  name:       string
  sector:     string
  country:    'US' | 'IN'
  price:      number
  changePct:  number
  spark:      number[]      // downsampled closes (≤48) for the row sparkline
  sparkMin:   number
  sparkMax:   number
  detections: ScanDetection[]
}

export interface ChunkScan {
  rows:      SymbolScan[]
  /** Symbols asked for, and how many returned usable candles. */
  symbols:   number
  scanned:   number
  scannedAt: number
  /** False when too many symbols failed to load; such a result is not cached. */
  complete:  boolean
}

const TF_FETCH: Record<ScanTf, { range: string; interval: string }> = {
  '1D': { range: '1y', interval: '1d' },
  '1W': { range: '5y', interval: '1wk' },
}

const FRESH_MS = 3 * 3600_000
const chunkCache = createCache<ChunkScan>({ name: 'patternscan', max: 120, staleMs: 24 * 3600_000, distributed: true })

type FetchResult = { candles: Candle[]; limited: boolean }

async function fetchCandles(symbol: string, tf: ScanTf): Promise<FetchResult> {
  const { range, interval } = TF_FETCH[tf]
  try {
    const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`)
    url.searchParams.set('interval', interval)
    url.searchParams.set('range', range)
    const r = await upstreamFetch(url, { provider: 'yahoo', timeoutMs: 8_000, headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' })
    if (r.status === 429) return { candles: [], limited: true }
    if (!r.ok) return { candles: [], limited: false }
    const j = await r.json()
    const res = j?.chart?.result?.[0]
    const ts = res?.timestamp ?? []
    const q = res?.indicators?.quote?.[0]
    if (!q) return { candles: [], limited: false }
    const candles = (ts as number[])
      .map((time, i) => ({ time, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0 }))
      .filter((c): c is Candle => [c.open, c.high, c.low, c.close].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0))
    return { candles, limited: false }
  } catch {
    return { candles: [], limited: false }
  }
}

function downsample(values: number[], target = 48): number[] {
  if (values.length <= target) return values
  const out: number[] = []
  const step = values.length / target
  for (let i = 0; i < target; i++) out.push(values[Math.floor(i * step)])
  return out
}

// How many bars back a pattern may have ended and still be listed.
const MAX_AGE_GEOMETRIC = 15
const MAX_AGE_CANDLE    = 2

/** Null when there is too little history or nothing current was detected. */
export function scanSymbol(entry: UniverseEntry, candles: Candle[], tf: ScanTf): SymbolScan | null {
  if (candles.length < 30) return null
  const result = detectAll(candles, { timeframe: tf })
  const closes = candles.map(c => c.close)
  const lastClose = closes[closes.length - 1]
  const prevClose = closes[closes.length - 2] ?? lastClose
  const lastIndex = candles.length - 1
  const firstIdx = candles[0].time, span = (candles[lastIndex].time - firstIdx) || 1

  // A screener is about now: drop shapes that finished long ago, and keep
  // candle signals to the last few bars. Candles are capped separately so a
  // run of them cannot push a chart pattern off the list.
  const fresh = (d: PatternDetection, maxAge: number) => d.status !== 'failed' && lastIndex - d.endIndex <= maxAge
  const byQuality = (a: PatternDetection, b: PatternDetection) => b.confidence - a.confidence
  const dets: ScanDetection[] = [
    ...result.geometric.filter(d => fresh(d, MAX_AGE_GEOMETRIC)).sort(byQuality).slice(0, 4),
    ...result.candlestick.filter(d => fresh(d, MAX_AGE_CANDLE)).sort(byQuality).slice(0, 3),
  ]
    .sort(byQuality)
    .map(d => ({
      id: d.id, name: d.name, direction: d.direction, status: d.status, category: d.category,
      confidence: d.confidence, breakoutLevel: d.breakoutLevel, target: d.target,
      ageBar: Math.max(0, lastIndex - d.endIndex),
      distToBreakoutPct: d.breakoutLevel != null && lastClose > 0
        ? (d.breakoutLevel - lastClose) / lastClose * 100 : null,
      outline: d.kind === 'geometric'
        ? d.points.map(p => ({ x: (p.time - firstIdx) / span, y: p.price }))
        : [],
    }))

  if (dets.length === 0) return null
  const spark = downsample(closes)
  return {
    symbol: entry.symbol, name: entry.name, sector: entry.sector, country: entry.country,
    price: +lastClose.toFixed(2),
    changePct: prevClose > 0 ? +((lastClose - prevClose) / prevClose * 100).toFixed(2) : 0,
    spark: spark.map(v => +v.toFixed(2)),
    sparkMin: Math.min(...spark), sparkMax: Math.max(...spark),
    detections: dets,
  }
}

const CONCURRENCY = 6

async function scanEntries(entries: readonly UniverseEntry[], tf: ScanTf): Promise<ChunkScan> {
  const rows: SymbolScan[] = []
  let scanned = 0, next = 0

  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++]
      let res = await fetchCandles(entry.symbol, tf)
      if (res.limited) {
        // Rate limited: wait once and retry, then give up on this symbol.
        await new Promise(r => setTimeout(r, 900))
        res = await fetchCandles(entry.symbol, tf)
      }
      if (!res.candles.length) continue
      scanned++
      try {
        const scan = scanSymbol(entry, res.candles, tf)
        if (scan) rows.push(scan)
      } catch { /* one bad series must not sink the chunk */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker))

  return {
    rows, symbols: entries.length, scanned, scannedAt: Date.now(),
    // A few delisted or renamed symbols are normal; most of a chunk failing is an outage.
    complete: entries.length === 0 || scanned >= entries.length * 0.6,
  }
}

async function cached(key: string, entries: readonly UniverseEntry[], tf: ScanTf): Promise<ChunkScan> {
  const hit = chunkCache.get(key)
  if (hit) return hit
  const fresh = await scanEntries(entries, tf)
  if (fresh.complete) { chunkCache.set(key, fresh, FRESH_MS); return fresh }
  // Upstream trouble: prefer the last good scan over a thin one.
  return chunkCache.getStale(key) ?? fresh
}

/** One fixed chunk of a market's universe. */
export function scanChunk(tf: ScanTf, market: ScanMarket, index: number): Promise<ChunkScan> {
  return cached(`${tf}:${market}:${index}`, chunkEntries(market, index), tf)
}

/** Ad-hoc symbols (the user's watchlist names that are outside the universe). */
export function scanSymbols(tf: ScanTf, symbols: readonly string[]): Promise<ChunkScan> {
  const entries = symbols.map(s => UNIVERSE_BY_SYMBOL[s] ?? {
    symbol: s, name: s, sector: 'Other', country: /\.(NS|BO)$/.test(s) ? 'IN' as const : 'US' as const,
  })
  return cached(`${tf}:x:${symbols.join(',')}`, entries, tf)
}
