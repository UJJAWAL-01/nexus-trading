// ─── /api/fundamentals?ticker=AAPL ───────────────────────────────────────────
//
// Annual fundamentals for one US filer, straight from SEC EDGAR's public XBRL
// API. No API key, no database, no setup, no cost:
//
//   www.sec.gov/files/company_tickers.json        ticker → CIK
//   data.sec.gov/submissions/CIK##########.json   name, SIC industry
//   data.sec.gov/api/xbrl/companyfacts/CIK…json   every reported XBRL fact
//
// Response shape is unchanged from the previous database-backed version, so
// EquityResearchPanel needs no changes.
//
// Correctness guards (these are the classic XBRL traps):
//   • ANNUAL ONLY. A fact is annual when its period is ~one year long
//     (350–380 days). SEC tags quarterly, year-to-date and trailing values
//     with the same end date, so the period length is the only reliable test.
//   • USD ONLY. Foreign filers report in their home currency; treating that as
//     USD inflates figures 100x+. Non-USD facts are ignored.
//   • LATEST REVISION. The same period is re-reported in later filings;
//     the most recently filed value wins.
//   • Fiscal year is taken from the period END date, not SEC's `fy` field
//     (which reflects the filing, not the period).
//
// SEC asks automated clients to identify themselves and stay under 10 req/s.
// Everything here is cached (tickers 24h, company data 6h) and concurrent
// requests for the same ticker share one upstream call.

import { NextRequest, NextResponse } from 'next/server'
import { upstreamFetch } from '@/lib/providers/http'
import { createCache } from '@/lib/providers/cache'
import { cleanSymbol } from '@/lib/providers/symbols'
import { buildPeriods, sicToSector, type CompanyFacts, type FundamentalsResponse } from '@/lib/sec-fundamentals'

const SEC_UA = 'NEXUS Trading Intelligence nexus-app/1.0 contact@nexustrading.app'
const SEC_HEADERS = { 'User-Agent': SEC_UA, Accept: 'application/json' }

// ── SEC lookups ───────────────────────────────────────────────────────────────

type TickerMap = Record<string, { cik: string; name: string }>

const tickerCache  = createCache<TickerMap>({ name: 'sec-tickers', max: 1, staleMs: 7 * 24 * 3600_000 })
const resultCache  = createCache<FundamentalsResponse>({ name: 'fundamentals', max: 300, staleMs: 24 * 3600_000, distributed: true })

async function secJson<T>(url: string, timeoutMs: number): Promise<T> {
  const res = await upstreamFetch(new URL(url), { provider: 'sec', timeoutMs, headers: SEC_HEADERS, cache: 'no-store' })
  if (!res.ok) throw new Error(`SEC ${res.status}`)
  return (await res.json()) as T
}

function loadTickers(): Promise<TickerMap> {
  return tickerCache.wrap('all', 24 * 3600_000, async () => {
    const raw = await secJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
      'https://www.sec.gov/files/company_tickers.json', 15_000,
    )
    const map: TickerMap = {}
    for (const row of Object.values(raw)) {
      if (!row?.ticker) continue
      map[row.ticker.toUpperCase()] = { cik: String(row.cik_str).padStart(10, '0'), name: row.title }
    }
    return map
  })
}

// ── Handler ───────────────────────────────────────────────────────────────────

const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' }

export async function GET(req: NextRequest): Promise<NextResponse> {
  const raw = new URL(req.url).searchParams.get('ticker')
  if (!raw?.trim()) {
    return NextResponse.json({ error: 'ticker parameter is required' }, { status: 400 })
  }
  const ticker = cleanSymbol(raw)?.toUpperCase()
  if (!ticker) return NextResponse.json({ error: 'invalid ticker' }, { status: 400 })

  const hit = resultCache.get(ticker)
  if (hit) return NextResponse.json({ ...hit, meta: { ...hit.meta, cached: true } }, { headers: CACHE_HEADERS })

  try {
    const tickers = await loadTickers()
    // SEC writes share classes with a dash (BRK-B); Yahoo-style input may use a dot.
    const entry = tickers[ticker] ?? tickers[ticker.replace(/\./g, '-')]
    if (!entry) {
      return NextResponse.json({ error: `Unknown ticker: ${ticker}. Fundamentals cover SEC filers only.` }, { status: 404 })
    }

    const response = await resultCache.wrap(ticker, 6 * 3600_000, async () => {
      const [facts, sub] = await Promise.all([
        secJson<CompanyFacts>(`https://data.sec.gov/api/xbrl/companyfacts/CIK${entry.cik}.json`, 20_000)
          .catch(() => null),
        secJson<{ name?: string; sic?: string; sicDescription?: string }>(`https://data.sec.gov/submissions/CIK${entry.cik}.json`, 15_000)
          .catch(() => null),
      ])
      const { periods, rowCount } = facts ? buildPeriods(facts) : { periods: [], rowCount: 0 }
      // Both lookups failing means SEC is unreachable: do not cache an empty answer.
      if (!facts && !sub) throw new Error('SEC unavailable')

      const out: FundamentalsResponse = {
        ticker,
        company: {
          name:     sub?.name ?? facts?.entityName ?? entry.name,
          cik:      entry.cik,
          sector:   sicToSector(sub?.sic),
          industry: sub?.sicDescription ?? null,
          country:  'US',
          currency: 'USD',
        },
        periods,
        meta: {
          fetchedAt: new Date().toISOString(),
          source:    periods.length ? 'SEC EDGAR XBRL' : 'SEC EDGAR XBRL (no coverage)',
          cached:    false,
          rowCount,
        },
      }
      return out
    })

    return NextResponse.json(response, { headers: CACHE_HEADERS })
  } catch {
    return NextResponse.json({ error: 'SEC EDGAR is temporarily unavailable. Try again shortly.' }, { status: 503 })
  }
}
