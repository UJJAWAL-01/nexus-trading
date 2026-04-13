import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

// ✅ Matches the existing IpoScreenerPanel interface exactly
export interface IPOData {
  ticker:        string
  company:       string
  industry:      string
  ipoDate:       string   // ← was 'date' — now matches component
  priceRange:    string
  shares:        string
  rating:        'bullish' | 'neutral' | 'bearish'
  status:        'upcoming' | 'recent'
  underwriter?:  string
  marketCap?:    string
}

function parseFinDate(raw: string | null | undefined): string {
  if (!raw) return ''
  // Finnhub returns "YYYY-MM-DD" — this is always valid ISO
  // Guard: if empty or not parseable, return empty string
  try {
    const d = new Date(raw + 'T12:00:00Z')   // noon UTC avoids timezone day-shift
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  } catch { return '' }
}

function deriveRating(e: any): 'bullish' | 'neutral' | 'bearish' {
  const name = ((e.name ?? '') + (e.description ?? '')).toLowerCase()
  if (/technology|software|saas|ai|cloud|semiconductor/.test(name)) return 'bullish'
  if (/biotech|pharma|clinical|drug|loss|deficit/.test(name))       return 'bearish'
  return 'neutral'
}

async function finnhubIPOs(from: string, to: string): Promise<IPOData[]> {
  const key = process.env.FINNHUB_API_KEY
  if (!key) return []

  try {
    const url = `https://finnhub.io/api/v1/calendar/ipo?from=${from}&to=${to}&token=${key}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const j = await res.json()

    return (j.ipoCalendar ?? [])
      .map((e: any): IPOData | null => {
        const ipoDate = parseFinDate(e.date)
        if (!ipoDate) return null   // skip entries with no valid date

        const statusDate = new Date(ipoDate + 'T12:00:00Z')
        const isUpcoming = statusDate >= new Date()

        // price from Finnhub is a single string like "18.00-20.00" or "18.00"
        let priceRange = '—'
        if (e.price) priceRange = `$${e.price}`
        if (e.priceRangeLow && e.priceRangeHigh) priceRange = `$${e.priceRangeLow}–$${e.priceRangeHigh}`

        const shares = e.numberOfShares
          ? `${(Number(e.numberOfShares) / 1e6).toFixed(1)}M`
          : '—'

        return {
          ticker:     e.symbol    ?? '—',
          company:    e.name      ?? e.symbol ?? '—',
          industry:   e.exchange  ?? 'US Exchange',
          ipoDate,
          priceRange,
          shares,
          rating:     deriveRating(e),
          status:     isUpcoming ? 'upcoming' : 'recent',
          underwriter: e.underwriter ?? undefined,
          marketCap:   undefined,
        }
      })
      .filter((x: IPOData | null): x is IPOData => x !== null)
      .sort((a: IPOData, b: IPOData) => new Date(b.ipoDate).getTime() - new Date(a.ipoDate).getTime())
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status      = searchParams.get('status')   as 'upcoming' | 'recent' | null
  const ratingParam = searchParams.get('rating')   as 'bullish' | 'neutral' | 'bearish' | null
  const ck          = `ipo:${status}:${ratingParam}`
  const cached      = cache.get(ck)
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.data)

  const today = new Date()
  const from  = new Date(today.getTime() - 30 * 86400_000).toISOString().slice(0, 10)
  const to    = new Date(today.getTime() + 60 * 86400_000).toISOString().slice(0, 10)

  let ipos = await finnhubIPOs(from, to)

  if (status)      ipos = ipos.filter(i => i.status === status)
  if (ratingParam) ipos = ipos.filter(i => i.rating === ratingParam)

  const payload = {
    ipos,
    total:       ipos.length,
    fetchedAt:   new Date().toISOString(),
    source:      'Finnhub IPO Calendar',
  }

  cache.set(ck, { data: payload, expires: Date.now() + 3600_000 })
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'public, s-maxage=3600' } })
}