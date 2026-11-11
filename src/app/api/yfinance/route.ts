import { NextRequest, NextResponse } from 'next/server'
import { getChart } from '@/lib/providers/market'
import { cleanSymbolList, YAHOO_INTERVALS, YAHOO_RANGES } from '@/lib/providers/symbols'

// Chart candles. Response shape is unchanged: { results: [{ symbol, data }] }
// where `data` is the raw Yahoo chart payload the panels already parse.
//
// Input is validated before anything leaves the server: symbols must match the
// symbol grammar, range/interval must be known values, and at most
// MAX_SYMBOLS are fetched per request (each one is an upstream call).

const MAX_SYMBOLS = 10

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const range    = searchParams.get('range')    || '1mo'
  const interval = searchParams.get('interval') || '1d'
  const symbols  = cleanSymbolList(searchParams.get('symbols') || 'SPY', MAX_SYMBOLS)

  if (!symbols.length) {
    return NextResponse.json({ error: 'invalid symbols', results: [] }, { status: 400 })
  }
  if (!YAHOO_RANGES.has(range) || !YAHOO_INTERVALS.has(interval)) {
    return NextResponse.json({ error: 'invalid range or interval', results: [] }, { status: 400 })
  }

  const results = await Promise.all(
    symbols.map(async symbol => ({ symbol, data: await getChart(symbol, range, interval) })),
  )
  return NextResponse.json({ results })
}
