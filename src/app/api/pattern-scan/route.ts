// ─────────────────────────────────────────────────────────────────────────────
// GET /api/pattern-scan
//
//   ?tf=1D&market=IN&chunk=3      one fixed chunk of a market's universe
//   ?tf=1D&symbols=ZOMATO.NS,ARM  ad-hoc symbols (watchlist names, max 30)
//
// The browser asks for every chunk of the markets it wants and filters the
// combined result itself. Chunk responses depend only on (tf, market, chunk),
// so the CDN can serve one scan to every visitor for hours.
// ─────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimiter'
import { clientIp } from '@/lib/api-guard'
import { scanChunk, scanSymbols, type ScanTf } from '@/lib/patternScan'
import { chunkCount, SCAN_CHUNK, type ScanMarket } from '@/data/universe'

export const maxDuration = 30

const SYMBOL = /^[A-Z0-9^][A-Z0-9.\-&=^]{0,19}$/

export async function GET(request: NextRequest) {
  const ip = clientIp(request.headers)
  const rl = rateLimit(`pattern-scan:${ip}`, 90, 60_000)
  if (!rl.allowed) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })

  const q = new URL(request.url).searchParams
  const tf: ScanTf = q.get('tf') === '1W' ? '1W' : '1D'

  const rawSymbols = q.get('symbols')
  let scan
  if (rawSymbols !== null) {
    const symbols = [...new Set(rawSymbols.split(',').map(s => s.trim().toUpperCase()).filter(s => SYMBOL.test(s)))].sort().slice(0, SCAN_CHUNK)
    if (!symbols.length) return NextResponse.json({ error: 'No valid symbols' }, { status: 400 })
    scan = await scanSymbols(tf, symbols)
  } else {
    const market = q.get('market')
    if (market !== 'US' && market !== 'IN') return NextResponse.json({ error: 'market must be US or IN' }, { status: 400 })
    const chunk = Number(q.get('chunk') ?? 0)
    if (!Number.isInteger(chunk) || chunk < 0 || chunk >= chunkCount(market as ScanMarket)) {
      return NextResponse.json({ error: 'chunk out of range' }, { status: 400 })
    }
    scan = await scanChunk(tf, market as ScanMarket, chunk)
  }

  return NextResponse.json(scan, {
    headers: {
      // Daily candles change once a day: let the CDN hold a complete chunk for an hour
      // and keep serving it while it refreshes. A thin (upstream trouble) scan is never cached.
      'Cache-Control': scan.complete && rawSymbols === null
        ? 'public, s-maxage=3600, stale-while-revalidate=21600'
        : 'no-store',
    },
  })
}
