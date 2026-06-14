// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pattern-scan  (spec §4.2)
//
//   ?tf=1D&pattern=bull_flag,ascending_triangle&direction=bullish
//   &status=forming,confirmed&minConfidence=60&country=US&sector=Technology
//   &sortBy=confidence&limit=50
//
// Serves the cached universe snapshot immediately; if stale, refreshes in the
// background (lazy cron). Sector/name are joined from the static universe.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { rateLimit } from '@/lib/ratelimiter'
import {
  getScanStore, isStale, runSweep, type ScanTf, type SymbolScan, type ScanDetection,
} from '@/lib/patternScan'
import { UNIVERSE_BY_SYMBOL } from '@/data/universe'

const csv = (s: string | null) => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : [])

export async function GET(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
  const rl = rateLimit(`pattern-scan:${ip}`, 30, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })

  const q = new URL(request.url).searchParams
  const tf: ScanTf = q.get('tf') === '1W' ? '1W' : '1D'
  const patterns = csv(q.get('pattern'))
  const direction = q.get('direction')          // bullish | bearish | null/all
  const statuses = csv(q.get('status'))         // forming, confirmed
  const minConfidence = Number(q.get('minConfidence') ?? 0) || 0
  const country = q.get('country')              // US | IN | null/all
  const sector = q.get('sector')
  const sortBy = q.get('sortBy') ?? 'confidence'
  const limit = Math.min(200, Number(q.get('limit') ?? 50) || 50)
  const watchlist = csv(q.get('watchlist'))
  const t0 = Date.now()

  // Lazy cron: serve cache; refresh in the background when stale; sweep cold.
  let store = await getScanStore(tf)
  if (!store) {
    store = await runSweep(tf, watchlist)
  } else if (isStale(store)) {
    after(() => runSweep(tf, watchlist).catch(() => {}))
  }

  const matchDet = (d: ScanDetection): boolean => {
    if (patterns.length && !patterns.includes(d.id)) return false
    if (direction && direction !== 'all' && d.direction !== direction) return false
    if (statuses.length && !statuses.includes(d.status)) return false
    if (d.confidence < minConfidence) return false
    return true
  }

  const rows: Array<{
    symbol: string; name: string; sector: string; country: string
    price: number; changePct: number; spark: number[]; sparkMin: number; sparkMax: number
    detections: ScanDetection[]
  }> = []

  for (const sym of Object.keys(store.results)) {
    const meta = UNIVERSE_BY_SYMBOL[sym]
    const cc = meta?.country ?? (sym.endsWith('.NS') ? 'IN' : 'US')
    if (country && country !== 'ALL' && cc !== country) continue
    if (sector && sector !== 'ALL' && (meta?.sector ?? 'Other') !== sector) continue
    const s: SymbolScan = store.results[sym]
    const dets = s.detections.filter(matchDet)
    if (dets.length === 0) continue
    rows.push({
      symbol: sym, name: meta?.name ?? sym, sector: meta?.sector ?? 'Other', country: cc,
      price: s.price, changePct: s.changePct, spark: s.spark, sparkMin: s.sparkMin, sparkMax: s.sparkMax,
      detections: dets,
    })
  }

  const topConf = (r: typeof rows[number]) => Math.max(...r.detections.map(d => d.confidence))
  rows.sort((a, b) => {
    if (sortBy === 'changePct') return b.changePct - a.changePct
    if (sortBy === 'distance') {
      const da = Math.min(...a.detections.map(d => Math.abs(d.distToBreakoutPct ?? 999)))
      const db = Math.min(...b.detections.map(d => Math.abs(d.distToBreakoutPct ?? 999)))
      return da - db
    }
    return topConf(b) - topConf(a)
  })

  return NextResponse.json({
    results: rows.slice(0, limit),
    meta: {
      scannedAt: store.scannedAt,
      universeSize: store.universeSize,
      scannedCount: store.scannedCount,
      stale: isStale(store),
      queryMs: Date.now() - t0,
    },
  })
}
