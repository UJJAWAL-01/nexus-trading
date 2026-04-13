// src/app/api/earnings/route.ts
// US: Finnhub calendar + historical actuals
// India: Yahoo Finance quoteSummary + earningsHistory for past results
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number; stale: unknown }>()

// NIFTY 50 + BANK NIFTY + large-cap India stocks
const INDIA_WATCHLIST = [
  { symbol: 'RELIANCE.NS',     name: 'Reliance Industries'   },
  { symbol: 'TCS.NS',          name: 'TCS'                   },
  { symbol: 'HDFCBANK.NS',     name: 'HDFC Bank'             },
  { symbol: 'INFY.NS',         name: 'Infosys'               },
  { symbol: 'ICICIBANK.NS',    name: 'ICICI Bank'            },
  { symbol: 'HINDUNILVR.NS',   name: 'Hindustan Unilever'    },
  { symbol: 'SBIN.NS',         name: 'State Bank of India'   },
  { symbol: 'BHARTIARTL.NS',   name: 'Bharti Airtel'         },
  { symbol: 'ITC.NS',          name: 'ITC'                   },
  { symbol: 'KOTAKBANK.NS',    name: 'Kotak Mahindra Bank'   },
  { symbol: 'LT.NS',           name: 'Larsen & Toubro'       },
  { symbol: 'AXISBANK.NS',     name: 'Axis Bank'             },
  { symbol: 'BAJFINANCE.NS',   name: 'Bajaj Finance'         },
  { symbol: 'MARUTI.NS',       name: 'Maruti Suzuki'         },
  { symbol: 'TITAN.NS',        name: 'Titan Company'         },
  { symbol: 'WIPRO.NS',        name: 'Wipro'                 },
  { symbol: 'SUNPHARMA.NS',    name: 'Sun Pharma'            },
  { symbol: 'HCLTECH.NS',      name: 'HCL Technologies'      },
  { symbol: 'TATAMOTORS.NS',   name: 'Tata Motors'           },
  { symbol: 'ONGC.NS',         name: 'ONGC'                  },
  { symbol: 'ADANIENT.NS',     name: 'Adani Enterprises'     },
  { symbol: 'TATASTEEL.NS',    name: 'Tata Steel'            },
  { symbol: 'NTPC.NS',         name: 'NTPC'                  },
  { symbol: 'POWERGRID.NS',    name: 'Power Grid Corp'       },
  { symbol: 'BAJAJFINSV.NS',   name: 'Bajaj Finserv'         },
]

export interface EarningItem {
  symbol:           string
  name:             string
  date:             string
  epsEstimate:      number | null
  epsActual:        number | null
  revenueEstimate:  number | null
  revenueActual:    number | null
  hour:             string
  market:           'US' | 'IN'
  beat:             boolean | null
  // Additional fields for India
  netProfitActual?: number | null
  netProfitEst?:   number | null
  yoyGrowth?:      number | null
  quarter?:        string
  isFuture:        boolean
}

// ── US Earnings: Finnhub (upcoming + recent) ─────────────────────────────────
async function fetchUSEarnings(): Promise<EarningItem[]> {
  const today   = new Date()
  // Go back 30 days for recent actuals, forward 30 days for upcoming
  const fromDate = new Date(today.getTime() - 30 * 86400_000)
  const toDate   = new Date(today.getTime() + 30 * 86400_000)
  const from     = fromDate.toISOString().split('T')[0]
  const to       = toDate.toISOString().split('T')[0]
  const todayStr = today.toISOString().split('T')[0]

  const res  = await fetch(
    `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`,
    { next: { revalidate: 0 } }
  )
  if (!res.ok) throw new Error(`Finnhub ${res.status}`)
  const data = await res.json()

  return (data.earningsCalendar ?? [])
    .filter((e: any) => e.symbol && e.date)
    .map((e: any): EarningItem => {
      const isFuture = e.date > todayStr
      const beat = !isFuture && e.epsActual !== null && e.epsEstimate !== null
        ? e.epsActual >= e.epsEstimate
        : null
      return {
        symbol:          e.symbol,
        name:            e.name || e.symbol,
        date:            e.date,
        epsEstimate:     e.epsEstimate     ?? null,
        epsActual:       isFuture ? null : (e.epsActual ?? null),
        revenueEstimate: e.revenueEstimate ?? null,
        revenueActual:   isFuture ? null : (e.revenueActual ?? null),
        hour:            e.hour || 'amc',
        market:          'US',
        beat,
        isFuture,
      }
    })
    .sort((a: EarningItem, b: EarningItem) => {
      // Put today and upcoming first, then recent past
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })
    .slice(0, 80)
}

// ── India Earnings: Yahoo Finance multi-module ────────────────────────────────
// Uses earningsHistory for actual past results + calendarEvents for upcoming
async function fetchIndiaEarningsSingle(symbol: string, name: string): Promise<EarningItem[]> {
  const modules = [
    'calendarEvents',
    'earningsHistory',
    'earningsTrend',
    'defaultKeyStatistics',
    'financialData',
  ].join(',')

  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=${modules}`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) return []

  const json = await res.json()
  const r    = json?.quoteSummary?.result?.[0]
  if (!r) return []

  const results: EarningItem[] = []
  const todayStr = new Date().toISOString().split('T')[0]
  const displaySym = symbol.replace('.NS', '').replace('.BO', '')

  // ── 1. Historical actual earnings (earningsHistory) ───────────────────────
  const history: any[] = r.earningsHistory?.history ?? []
  for (const h of history.slice(-8)) {
    if (!h.period) continue
    // Yahoo's period is like "3Q2024" or "-3q" relative. Use quarter directly.
    const rawDate = h.quarter?.fmt ?? h.period ?? ''
    // Try to parse date from surprise/actual data
    const eps       = h.epsActual?.raw ?? null
    const estimate  = h.epsEstimate?.raw ?? null
    const surprise  = h.surprisePercent?.raw ?? null
    const beat      = eps !== null && estimate !== null ? eps >= estimate : null

    // Approximate date from period string like "3Q2024"
    let date = todayStr
    const periodMatch = rawDate.match(/(\d)Q(\d{4})/)
    if (periodMatch) {
      const q = parseInt(periodMatch[1])
      const yr = parseInt(periodMatch[2])
      // Q results typically released 1-2 months after quarter end
      const monthMap: Record<number, string> = { 1:'04', 2:'07', 3:'10', 4:'01' }
      const resultYr = q === 4 ? yr + 1 : yr
      date = `${resultYr}-${monthMap[q] ?? '04'}-15`
    }

    results.push({
      symbol:          displaySym,
      name,
      date,
      epsEstimate:     estimate,
      epsActual:       eps,
      revenueEstimate: null,
      revenueActual:   null,
      hour:            'amc',
      market:          'IN',
      beat,
      isFuture:        false,
      quarter:         rawDate,
      yoyGrowth:       surprise,
    })
  }

  // ── 2. Upcoming earnings (calendarEvents) ─────────────────────────────────
  const cal = r.calendarEvents?.earnings
  if (cal?.earningsDate?.[0]) {
    const dateRaw  = cal.earningsDate[0].raw as number
    const dateStr  = new Date(dateRaw * 1000).toISOString().split('T')[0]
    const epsEst   = cal.earningsAverage?.raw ?? null

    // Get EPS estimate from earningsTrend (more reliable)
    const trend    = r.earningsTrend?.trend?.[0]
    const trendEst = trend?.earningsEstimate?.avg?.raw ?? epsEst

    // Get revenue estimate from trend
    const revEst   = trend?.revenueEstimate?.avg?.raw ?? null

    if (dateStr > todayStr) {
      results.push({
        symbol:          displaySym,
        name,
        date:            dateStr,
        epsEstimate:     trendEst,
        epsActual:       null,
        revenueEstimate: revEst,
        revenueActual:   null,
        hour:            'amc',
        market:          'IN',
        beat:            null,
        isFuture:        true,
        quarter:         'Upcoming',
      })
    }
  }

  // ── 3. Fallback: earningsTrend historical ─────────────────────────────────
  if (results.length === 0) {
    const trends: any[] = r.earningsTrend?.trend ?? []
    for (const t of trends.filter(t => t.period !== '0q' && t.period !== '+1q')) {
      const epsAct = t.earningsEstimate?.avg?.raw ?? null
      results.push({
        symbol:          displaySym,
        name,
        date:            todayStr,
        epsEstimate:     epsAct,
        epsActual:       null,
        revenueEstimate: t.revenueEstimate?.avg?.raw ?? null,
        revenueActual:   null,
        hour:            'amc',
        market:          'IN',
        beat:            null,
        isFuture:        false,
        quarter:         t.period,
      })
    }
  }

  return results
}

async function fetchIndiaEarnings(): Promise<EarningItem[]> {
  const all: EarningItem[] = []

  // Fetch in batches of 5 to avoid rate limiting
  const BATCH = 5
  for (let i = 0; i < INDIA_WATCHLIST.length; i += BATCH) {
    const batch = INDIA_WATCHLIST.slice(i, i + BATCH)
    const results = await Promise.allSettled(
      batch.map(({ symbol, name }) => fetchIndiaEarningsSingle(symbol, name))
    )
    for (const r of results) {
      if (r.status === 'fulfilled') all.push(...r.value)
    }
    if (i + BATCH < INDIA_WATCHLIST.length) {
      await new Promise(res => setTimeout(res, 300)) // rate limit pause
    }
  }

  // Deduplicate by symbol+date+quarter
  const seen = new Set<string>()
  const unique = all.filter(e => {
    const k = `${e.symbol}:${e.date}:${e.quarter ?? ''}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })

  // Sort: upcoming first (soonest), then recent past (most recent first)
  const upcoming = unique.filter(e => e.isFuture).sort((a,b) => a.date.localeCompare(b.date))
  const past     = unique.filter(e => !e.isFuture).sort((a,b) => b.date.localeCompare(a.date))

  return [...upcoming, ...past].slice(0, 80)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market = (searchParams.get('market') ?? 'US').toUpperCase()
  const key    = `earnings:${market}`
  const cached = cache.get(key)

  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    const data = market === 'IN'
      ? await fetchIndiaEarnings()
      : await fetchUSEarnings()

    const ttl = market === 'IN' ? 2 * 3_600_000 : 3_600_000
    cache.set(key, { data, expires: Date.now() + ttl, stale: data })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[earnings] error:', err)
    const stale = cache.get(key)?.stale
    if (stale) return NextResponse.json(stale)
    return NextResponse.json([])
  }
}