import { NextRequest, NextResponse } from 'next/server'
import { shortVolume } from '@/lib/providers/positioning'
import { cleanSymbol } from '@/lib/providers/symbols'

// Daily short-sale volume for one US equity, from FINRA's public Reg SHO files.
// No API key, no cost. Short VOLUME is not short interest: see lib/positioning.ts.

export async function GET(request: NextRequest) {
  const symbol = cleanSymbol(new URL(request.url).searchParams.get('symbol'))
  if (!symbol) return NextResponse.json({ error: 'invalid symbol' }, { status: 400 })

  const data = await shortVolume(symbol)
  if (!data) {
    return NextResponse.json({ symbol, supported: false, days: [], reason: 'Short-sale volume is published for US-listed shares only' })
  }
  return NextResponse.json(
    { ...data, supported: true, source: 'FINRA Reg SHO daily short sale volume (consolidated NMS)' },
    { headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' } },
  )
}
