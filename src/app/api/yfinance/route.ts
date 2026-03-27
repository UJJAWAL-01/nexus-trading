import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbols  = searchParams.get('symbols') || 'SPY'
  const range    = searchParams.get('range')    || '1mo'
  const interval = searchParams.get('interval') || '1d'

  const cacheKey = `yfinance:${symbols}:${range}:${interval}`
  const cached   = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    const symbolList = symbols.split(',')
    const results = await Promise.all(
      symbolList.map(async (symbol) => {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.trim()}?interval=${interval}&range=${range}`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        )
        const data = await res.json()
        return { symbol: symbol.trim(), data }
      })
    )

    const ttl = range === '1d' ? 30_000 : 300_000
    const payload = { results }
    cache.set(cacheKey, { data: payload, expires: Date.now() + ttl })
    return NextResponse.json(payload)
  } catch {
    return NextResponse.json({ error: 'fetch failed', results: [] })
  }
}