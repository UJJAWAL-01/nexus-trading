import { NextRequest, NextResponse } from 'next/server'

// Two-tier cache: live (15s) + stale (1hr fallback)
const liveCache  = new Map<string, { data: unknown; expires: number }>()
const staleCache = new Map<string, { data: unknown }>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol') || ''

  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  const key = `yq:${symbol}`

  const live = liveCache.get(key)
  if (live && live.expires > Date.now()) {
    return NextResponse.json(live.data)
  }

  try {
    const encoded = encodeURIComponent(symbol)
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?interval=1m&range=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      }
    )

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json = await res.json()
    const result = json?.chart?.result?.[0]

    if (!result) {
      const stale = staleCache.get(key)
      if (stale) return NextResponse.json(stale.data)
      return NextResponse.json({ price: null, change: null, symbol })
    }

    const meta      = result.meta ?? {}
    const price     = meta.regularMarketPrice ?? null
    const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null
    const changePct = price && prevClose
      ? ((price - prevClose) / prevClose) * 100
      : (meta.regularMarketChangePercent ?? null)

    const data = {
      symbol,
      price,
      change: changePct !== null ? Math.round(changePct * 100) / 100 : null,
      currency: meta.currency ?? 'USD',
      marketState: meta.marketState ?? 'UNKNOWN',
    }

    liveCache.set(key,  { data, expires: Date.now() + 15_000 })
    staleCache.set(key, { data })

    return NextResponse.json(data)
  } catch {
    const stale = staleCache.get(key)
    if (stale) return NextResponse.json(stale.data)
    return NextResponse.json({ price: null, change: null, symbol })
  }
}