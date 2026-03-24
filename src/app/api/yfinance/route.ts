import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbols = searchParams.get('symbols') || 'SPY,QQQ,DIA,VIX'

  const cacheKey = `yfinance:${symbols}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    // Using Yahoo Finance unofficial API
    const symbolList = symbols.split(',')
    const results = await Promise.all(
      symbolList.map(async (symbol) => {
        const res = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${symbol.trim()}?interval=1d&range=1d`,
          { headers: { 'User-Agent': 'Mozilla/5.0' } }
        )
        const data = await res.json()
        return { symbol: symbol.trim(), data }
      })
    )
    cache.set(cacheKey, { data: results, expires: Date.now() + 5_000 })
    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ error: 'fetch failed', results: [] })
  }
}