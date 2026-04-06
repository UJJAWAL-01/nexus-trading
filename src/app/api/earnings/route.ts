// src/app/api/earnings/route.ts
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number; stale: unknown }>()

// NIFTY 50 + BANK NIFTY component stocks (Yahoo Finance .NS symbols)
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
]

interface EarningItem {
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
}

async function fetchUSEarnings(): Promise<EarningItem[]> {
  const today = new Date()
  const from  = today.toISOString().split('T')[0]
  const to    = new Date(today.getTime() + 14 * 86400_000).toISOString().split('T')[0]

  const res  = await fetch(
    `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`,
    { next: { revalidate: 0 } }
  )
  if (!res.ok) throw new Error(`Finnhub ${res.status}`)
  const data = await res.json()

  return (data.earningsCalendar ?? [])
    .filter((e: any) => e.symbol && e.date)
    .map((e: any): EarningItem => ({
      symbol:          e.symbol,
      name:            e.name || e.symbol,
      date:            e.date,
      epsEstimate:     e.epsEstimate  ?? null,
      epsActual:       e.epsActual    ?? null,
      revenueEstimate: e.revenueEstimate ?? null,
      revenueActual:   e.revenueActual   ?? null,
      hour:            e.hour || 'amc',
      market:          'US',
      beat:
        e.epsActual !== null && e.epsEstimate !== null
          ? e.epsActual >= e.epsEstimate
          : null,
    }))
    .slice(0, 60)
}

async function fetchIndiaEarnings(): Promise<EarningItem[]> {
  const results = await Promise.allSettled(
    INDIA_WATCHLIST.map(async ({ symbol, name }): Promise<EarningItem | null> => {
      try {
        const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=calendarEvents,earningsTrend`
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          signal:  AbortSignal.timeout(5000),
        })
        if (!res.ok) return null
        const json = await res.json()
        const cal  = json?.quoteSummary?.result?.[0]?.calendarEvents?.earnings

        if (!cal?.earningsDate?.[0]) return null

        const dateRaw = cal.earningsDate[0].raw as number
        const date    = new Date(dateRaw * 1000).toISOString().split('T')[0]

        const epsEst    = cal.earningsAverage?.raw ?? null
        const epsLow    = cal.earningsLow?.raw     ?? null
        const epsHigh   = cal.earningsHigh?.raw    ?? null

        // earningsTrend for actual
        const trend = json?.quoteSummary?.result?.[0]?.earningsTrend?.trend?.[0]
        const epsAct = trend?.earningsEstimate?.avg?.raw ?? null

        return {
          symbol: symbol.replace('.NS', '').replace('.BO', ''),
          name,
          date,
          epsEstimate:     epsEst,
          epsActual:       epsAct,
          revenueEstimate: null,
          revenueActual:   null,
          hour:            'amc',
          market:          'IN' as const,
          beat:            epsAct !== null && epsEst !== null ? epsAct >= epsEst : null,
        }
      } catch {
        return null
      }
    })
  )

  return results
    .filter((r): r is PromiseFulfilledResult<EarningItem | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((v): v is EarningItem => v !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
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

    cache.set(key, { data, expires: Date.now() + 3_600_000, stale: data })
    return NextResponse.json(data)
  } catch (err) {
    const stale = cache.get(key)?.stale
    if (stale) return NextResponse.json(stale)
    return NextResponse.json([])
  }
}