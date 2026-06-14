// ─────────────────────────────────────────────────────────────────────────────
// Pattern-scan pipeline (spec §4.1) — server-side.
//
// Sweeps the universe on daily/weekly candles, runs the SAME detectAll() the
// chart uses, and stores compact detections in Redis. A lazy-cron model: the
// first request after the cache goes stale serves the stale snapshot instantly
// and refreshes in the background.
// ─────────────────────────────────────────────────────────────────────────────

import type { Candle, PatternDetection } from '@/lib/patterns'
import { detectAll } from '@/lib/patterns'
import { redis } from '@db/redis'
import { UNIVERSE, type UniverseEntry } from '@/data/universe'

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
  price:      number
  changePct:  number
  spark:      number[]      // downsampled closes (≤48) for the row sparkline
  sparkMin:   number
  sparkMax:   number
  detections: ScanDetection[]
}

export interface ScanStore {
  tf:           ScanTf
  scannedAt:    number
  universeSize: number
  scannedCount: number
  results:      Record<string, SymbolScan>
}

const TF_FETCH: Record<ScanTf, { range: string; interval: string }> = {
  '1D': { range: '1y', interval: '1d' },
  '1W': { range: '5y', interval: '1wk' },
}

const STORE_TTL = 48 * 3600           // keep snapshot up to 48h so we can serve stale
const FRESH_MS = 6 * 3600 * 1000      // consider stale after 6h
const storeKey = (tf: ScanTf) => `patternscan:${tf}`

// In-process guard so we don't launch two sweeps at once on the same instance.
const sweeping = new Set<ScanTf>()

async function fetchDaily(symbol: string, tf: ScanTf): Promise<Candle[]> {
  const { range, interval } = TF_FETCH[tf]
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12_000) },
    )
    if (r.status === 429) throw Object.assign(new Error('429'), { rateLimited: true })
    if (!r.ok) return []
    const j = await r.json()
    const res = j?.chart?.result?.[0]
    const ts = res?.timestamp ?? []
    const q = res?.indicators?.quote?.[0]
    if (!q) return []
    return (ts as number[])
      .map((time, i) => ({ time, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0 }))
      .filter((c): c is Candle => c.open != null && c.high != null && c.low != null && c.close != null)
  } catch (e) {
    if ((e as { rateLimited?: boolean })?.rateLimited) throw e
    return []
  }
}

function downsample(values: number[], target = 48): number[] {
  if (values.length <= target) return values
  const out: number[] = []
  const step = values.length / target
  for (let i = 0; i < target; i++) out.push(values[Math.floor(i * step)])
  return out
}

function scanSymbol(entry: UniverseEntry, candles: Candle[], tf: ScanTf): SymbolScan | null {
  if (candles.length < 30) return null
  const result = detectAll(candles, { timeframe: tf })
  const closes = candles.map(c => c.close)
  const lastClose = closes[closes.length - 1]
  const prevClose = closes[closes.length - 2] ?? lastClose
  const lastIndex = candles.length - 1
  const firstIdx = candles[0].time, span = (candles[lastIndex].time - firstIdx) || 1

  const dets: ScanDetection[] = [...result.geometric, ...result.candlestick]
    .filter(d => d.status !== 'failed')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
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
    symbol: entry.symbol,
    price: +lastClose.toFixed(2),
    changePct: prevClose > 0 ? +((lastClose - prevClose) / prevClose * 100).toFixed(2) : 0,
    spark: spark.map(v => +v.toFixed(2)),
    sparkMin: Math.min(...spark), sparkMax: Math.max(...spark),
    detections: dets,
  }
}

export async function getScanStore(tf: ScanTf): Promise<ScanStore | null> {
  try { return (await redis.get<ScanStore>(storeKey(tf))) ?? null } catch { return null }
}

export function isStale(store: ScanStore | null): boolean {
  return !store || Date.now() - store.scannedAt > FRESH_MS
}

/**
 * Sweep the universe (+ extra watchlist symbols). Batches of 20 with a 250ms
 * stagger and exponential backoff on 429. Writes one snapshot to Redis.
 */
export async function runSweep(tf: ScanTf, extraSymbols: string[] = []): Promise<ScanStore> {
  if (sweeping.has(tf)) {
    const existing = await getScanStore(tf)
    if (existing) return existing
  }
  sweeping.add(tf)
  try {
    const seen = new Set<string>()
    const list: UniverseEntry[] = []
    for (const e of UNIVERSE) { if (!seen.has(e.symbol)) { seen.add(e.symbol); list.push(e) } }
    for (const s of extraSymbols) {
      const sym = s.toUpperCase()
      if (!seen.has(sym)) { seen.add(sym); list.push({ symbol: sym, name: sym, sector: 'Other', country: sym.endsWith('.NS') ? 'IN' : 'US' }) }
    }

    const results: Record<string, SymbolScan> = {}
    let scannedCount = 0
    const BATCH = 20
    let backoff = 0

    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH)
      try {
        const settled = await Promise.all(batch.map(async (entry) => {
          try {
            const candles = await fetchDaily(entry.symbol, tf)
            return { entry, scan: candles.length ? scanSymbol(entry, candles, tf) : null }
          } catch (e) {
            if ((e as { rateLimited?: boolean })?.rateLimited) throw e
            return { entry, scan: null }
          }
        }))
        for (const { entry, scan } of settled) {
          scannedCount++
          if (scan) results[entry.symbol] = scan
        }
        backoff = 0
      } catch {
        // 429 somewhere in the batch — back off and retry this batch once.
        backoff = Math.min(4000, backoff ? backoff * 2 : 750)
        await new Promise(r => setTimeout(r, backoff))
        i -= BATCH
        continue
      }
      await new Promise(r => setTimeout(r, 250))   // stagger between batches
    }

    const store: ScanStore = {
      tf, scannedAt: Date.now(), universeSize: list.length, scannedCount, results,
    }
    try { await redis.set(storeKey(tf), store, { ex: STORE_TTL }) } catch { /* non-fatal */ }
    return store
  } finally {
    sweeping.delete(tf)
  }
}
