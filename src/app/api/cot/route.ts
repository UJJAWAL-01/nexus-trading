import { NextResponse } from 'next/server'
import { cotSummaries } from '@/lib/providers/positioning'

// Futures positioning from the CFTC Commitments of Traders report.
// Public data, no API key, no cost. One upstream call serves every contract
// and is cached for six hours (the report is weekly).

export async function GET() {
  const contracts = await cotSummaries()
  if (!contracts) {
    return NextResponse.json({ error: 'Positioning data is unavailable right now', contracts: [] }, { status: 503 })
  }
  return NextResponse.json(
    { contracts, source: 'CFTC Commitments of Traders (legacy, futures only)', asOf: contracts[0]?.date ?? null },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=21600' } },
  )
}
