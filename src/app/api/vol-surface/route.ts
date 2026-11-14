import { NextRequest, NextResponse } from 'next/server'
import { volSurface } from '@/lib/providers/positioning'
import { cleanSymbol } from '@/lib/providers/symbols'

// Implied-volatility term structure and skew for one US underlying, computed
// from CBOE's free delayed options file. No API key, no cost.

export async function GET(request: NextRequest) {
  const symbol = cleanSymbol(new URL(request.url).searchParams.get('symbol'))
  if (!symbol) return NextResponse.json({ error: 'invalid symbol' }, { status: 400 })

  const result = await volSurface(symbol)
  if (result === 'unsupported') {
    return NextResponse.json({ symbol, supported: false, reason: 'Listed options data covers US shares, ETFs and major US indices only' })
  }
  if (!result) {
    return NextResponse.json({ symbol, supported: true, surface: null, reason: 'No usable options data for this symbol right now' })
  }
  return NextResponse.json(
    { symbol, supported: true, surface: result, source: 'CBOE delayed quotes (15 minutes)' },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } },
  )
}
