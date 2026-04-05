import { NextRequest, NextResponse } from 'next/server'

const INDICES_CONFIG: Record<string, { name: string; symbol: string }> = {
  'SPX': { name: 'S&P 500', symbol: '^GSPC' },
  'NDX': { name: 'Nasdaq 100', symbol: '^NDX' },
  'DJI': { name: 'Dow Jones', symbol: '^DJI' },
  'VIX': { name: 'VIX', symbol: '^VIX' },
  'NIFTY': { name: 'Nifty 50', symbol: '^NSEI' },
  'SENSEX': { name: 'Sensex', symbol: '^BSESN' },
  'USDINR': { name: 'USD/INR', symbol: 'USDINR=X' },
  'N225': { name: 'Nikkei 225', symbol: '^N225' },
  'HSI': { name: 'Hang Seng', symbol: '^HSI' },
}

async function fetchYFinanceQuote(symbol: string) {
  try {
    const res = await fetch(`/api/globalquote?symbol=${encodeURIComponent(symbol)}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const indices = searchParams.get('indices')?.split(',') || Object.keys(INDICES_CONFIG)

  const results: any[] = []

  for (const idx of indices) {
    if (!INDICES_CONFIG[idx]) continue
    const config = INDICES_CONFIG[idx]
    const data = await fetchYFinanceQuote(config.symbol)

    if (data) {
      results.push({
        id: idx,
        name: config.name,
        symbol: config.symbol,
        price: data.price ?? 0,
        change: data.change ?? 0,
        changePercent: data.changePercent ?? 0,
        high: data.high ?? 0,
        low: data.low ?? 0,
        timestamp: new Date().toISOString(),
      })
    }
  }

  return NextResponse.json(
    { indices: results, total: results.length, lastUpdated: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=30' } }
  )
}
