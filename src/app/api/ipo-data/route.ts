import { NextRequest, NextResponse } from 'next/server'
import { nasdaqIpos } from '@/lib/providers/public-data'

// IPO calendar from Nasdaq's public calendar. No API key, no cost.
// Shows what the exchange publishes: priced deals, expected pricings and new
// filings. NEXUS adds no opinion or "rating" of its own to these rows.

export interface IPOData {
  ticker:        string
  company:       string
  industry:      string   // listing exchange / market (Nasdaq publishes no industry)
  ipoDate:       string   // ISO date: priced, expected or filed date
  priceRange:    string
  shares:        string
  status:        'upcoming' | 'recent'
  stage:         'priced' | 'upcoming' | 'filed'
  offerAmount?:  string
}

const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`

export async function GET(request: NextRequest) {
  const raw    = new URL(request.url).searchParams.get('status')
  const status = raw === 'upcoming' || raw === 'recent' ? raw : null

  const now    = new Date()
  const months = [-1, 0, 1].map(offset => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))))

  const rows = await nasdaqIpos(months)

  let ipos: IPOData[] = rows
    .filter(r => r.date)
    .map(r => ({
      ticker:      r.ticker,
      company:     r.company,
      industry:    r.stage === 'filed' ? 'Filed with SEC' : r.exchange,
      ipoDate:     r.date,
      priceRange:  r.priceRange,
      shares:      r.shares,
      // Priced deals are done; expected pricings and fresh filings are ahead.
      status:      r.stage === 'priced' ? 'recent' as const : 'upcoming' as const,
      stage:       r.stage,
      offerAmount: r.offerAmount,
    }))
    .sort((a, b) => b.ipoDate.localeCompare(a.ipoDate))

  if (status) ipos = ipos.filter(i => i.status === status)

  return NextResponse.json({
    ipos,
    total:     ipos.length,
    fetchedAt: new Date().toISOString(),
    source:    rows.length ? 'Nasdaq IPO Calendar' : 'Nasdaq IPO Calendar (unavailable)',
  }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } })
}
