// src/app/api/edgar/route.ts
import { NextRequest, NextResponse } from 'next/server'

const dev = process.env.NODE_ENV !== 'production'

const cache = new Map<string, { data: unknown; expires: number }>()
const SEC_UA = 'NEXUS Trading Intelligence nexus-app/1.0 contact@nexustrading.app'

// ── CIK lookup cache ──────────────────────────────────────────────────────────
let tickerMap: Record<string, string> | null = null
let tickerMapExpiry = 0

async function getTickerMap(): Promise<Record<string, string>> {
  if (tickerMap && Date.now() < tickerMapExpiry) return tickerMap

  try {
    // SEC returns: {"0":{"cik_str":320193,"ticker":"AAPL","title":"Apple Inc."},...}
    // Note: cik_str is a NUMBER in the JSON (no leading zeros), not a string
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: {
        'User-Agent': SEC_UA,
        'Accept':     'application/json',
      },
      // Don't use next.revalidate in API routes — it's unreliable
      // Use our own cache instead
    })

    if (!res.ok) {
      dev && console.error('[edgar] ticker map fetch failed:', res.status)
      return tickerMap ?? {}
    }

    const raw = await res.json() as Record<string, {
      cik_str: number | string
      ticker:  string
      title:   string
    }>

    const map: Record<string, string> = {}
    Object.values(raw).forEach(e => {
      if (!e.ticker || !e.cik_str) return
      // CIK must be zero-padded to 10 digits for the API
      const cik = String(e.cik_str).padStart(10, '0')
      map[e.ticker.toUpperCase().trim()] = cik
    })

    tickerMap   = map
    tickerMapExpiry = Date.now() + 4 * 3600_000 // 4 hours
    return map
  } catch (err) {
    dev && console.error('[edgar] getTickerMap error:', err)
    return tickerMap ?? {}
  }
}

async function resolveCIK(ticker: string): Promise<string | null> {
  const map = await getTickerMap()
  const cik = map[ticker.toUpperCase()]
  return cik ?? null
}

// ── EDGAR XBRL facts ──────────────────────────────────────────────────────────

function dedupeAndSort(arr: any[]): any[] {
  if (!Array.isArray(arr)) return []
  const byPeriod = new Map<string, any>()
  arr.forEach(e => {
    if (!e.end) return
    const k = `${e.start ?? ''}_${e.end}`
    const ex = byPeriod.get(k)
    if (!ex || new Date(e.filed ?? 0) > new Date(ex.filed ?? 0)) byPeriod.set(k, e)
  })
  return [...byPeriod.values()]
    .filter(e => e.form === '10-Q' || e.form === '10-K')
    .sort((a, b) => new Date(b.end).getTime() - new Date(a.end).getTime())
    .slice(0, 10)
    .map(e => ({ ...e, value: e.val ?? e.value }))  // Normalize SEC's 'val' to 'value'
}

async function fetchEdgarFacts(cik: string, ticker: string) {
  const key = `edgar:facts:${cik}`
  const hit  = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data

  try {
    const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`
    const res = await fetch(url, {
      headers: {
        'User-Agent': SEC_UA,
        'Accept':     'application/json',
      },
    })

    if (!res.ok) {
      dev && console.error('[edgar] facts fetch failed:', res.status, 'for', ticker, cik)
      return null
    }

    const data = await res.json()
    const usGaap = data.facts?.['us-gaap'] ?? {}
    const dei    = data.facts?.['dei']     ?? {}
    const facts  = { ...usGaap }

    // ── EPS ───────────────────────────────────────────────────────────────────
    const epsData = (() => {
      for (const k of ['EarningsPerShareBasic', 'EarningsPerShareDiluted', 'IncomeLossFromContinuingOperationsPerDilutedShare']) {
        const arr = facts[k]?.units?.['USD/shares'] ?? []
        if (arr.length > 0) return dedupeAndSort(arr)
      }
      return []
    })()

    // ── Revenue ───────────────────────────────────────────────────────────────
    const revData = (() => {
      for (const k of [
        'Revenues',
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'RevenueFromContractWithCustomerIncludingAssessedTax',
        'SalesRevenueNet',
        'SalesRevenueGoodsNet',
        'RevenueFromContractWithCustomer',
        'NetRevenues',
      ]) {
        const arr = facts[k]?.units?.USD ?? []
        if (arr.length > 0) return dedupeAndSort(arr)
      }
      return []
    })()

    // ── Net Income ────────────────────────────────────────────────────────────
    const netData = dedupeAndSort(
      facts['NetIncomeLoss']?.units?.USD ??
      facts['ProfitLoss']?.units?.USD ?? []
    )

    // ── Operating Cash Flow ───────────────────────────────────────────────────
    const cfData = dedupeAndSort(
      facts['NetCashProvidedByUsedInOperatingActivities']?.units?.USD ??
      facts['NetCashProvidedByUsedInOperatingActivitiesContinuingOperations']?.units?.USD ?? []
    )

    const payload = {
      ticker,
      cik,
      companyName: data.entityName ?? ticker,
      entityType:  data.entityType ?? '',
      eps:      epsData,
      revenue:  revData,
      net:      netData,
      cashFlow: cfData,
      source:   'SEC EDGAR',
      lastUpdated: new Date().toISOString(),
    }

    cache.set(key, { data: payload, expires: Date.now() + 3_600_000 })
    return payload
  } catch (err) {
    dev && console.error('[edgar] fetchFacts error:', err)
    return null
  }
}

// ── Yahoo Finance financials — works for ALL global stocks ────────────────────
// Used for non-US stocks and as fallback

async function fetchYahooFinancials(symbol: string) {
  const key = `yahoo:fin:${symbol}`
  const hit  = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data

  try {
    const modules = [
      'incomeStatementHistory',
      'incomeStatementHistoryQuarterly',
      'cashflowStatementHistory',
      'cashflowStatementHistoryQuarterly',
      'earningsHistory',
      'defaultKeyStatistics',
    ].join(',')

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!res.ok) return null

    const json = await res.json()
    const r    = json?.quoteSummary?.result?.[0]
    if (!r) return null

    // ── Annual income statements ───────────────────────────────────────────
    const annualIS = r.incomeStatementHistory?.incomeStatementHistory ?? []
    const eps: any[] = (r.earningsHistory?.history ?? [])
      .map((e: any) => ({
        end:    e.period ?? '',
        value:  e.epsActual?.raw ?? 0,
        epsSurprise: e.epsDifference?.raw ?? 0,
        epsEstimate: e.epsEstimate?.raw ?? 0,
        form:  '10-Q',
        filed: e.quarter ?? '',
      }))
      .filter((e: any) => e.end && e.value !== undefined)
      .reverse() ?? []

    const revenue: any[] = annualIS.map((s: any) => ({
      end:   s.endDate?.fmt ?? '',
      value: s.totalRevenue?.raw ?? 0,
      form: '10-K',
      filed: s.endDate?.fmt ?? '',
    })).reverse()

    const net: any[] = annualIS.map((s: any) => ({
      end:   s.endDate?.fmt ?? '',
      value: s.netIncome?.raw ?? 0,
      form: '10-K',
      filed: s.endDate?.fmt ?? '',
    })).reverse()

    // ── Quarterly income statements ────────────────────────────────────────
    const quarterlyIS = r.incomeStatementHistoryQuarterly?.incomeStatementHistory ?? []
    const revenueQ: any[] = quarterlyIS.map((s: any) => ({
      end:   s.endDate?.fmt ?? '',
      value: s.totalRevenue?.raw ?? 0,
      form: '10-Q',
      filed: s.endDate?.fmt ?? '',
    })).reverse()

    const netQ: any[] = quarterlyIS.map((s: any) => ({
      end:   s.endDate?.fmt ?? '',
      value: s.netIncome?.raw ?? 0,
      form: '10-Q',
      filed: s.endDate?.fmt ?? '',
    })).reverse()

    // ── Cash flow ──────────────────────────────────────────────────────────
    const annualCF = r.cashflowStatementHistory?.cashflowStatements ?? []
    const cashFlow: any[] = annualCF.map((s: any) => ({
      end:   s.endDate?.fmt ?? '',
      value: s.operatingCashflow?.raw ?? s.totalCashFromOperatingActivities?.raw ?? 0,
      form: '10-K',
      filed: s.endDate?.fmt ?? '',
    })).reverse()

    const stats = r.defaultKeyStatistics ?? {}

    const payload = {
      ticker:  symbol,
      companyName: stats.enterpriseValue?.longFmt ? symbol : symbol,
      eps:     eps.filter(e => e.value !== 0 && e.value !== undefined).slice(0, 8),
      revenue: (revenueQ.length > 0 ? revenueQ : revenue).filter(e => e.value !== 0 && e.value !== undefined).slice(0, 8),
      net:     (netQ.length > 0 ? netQ : net).filter(e => e.value !== 0 && e.value !== undefined).slice(0, 8),
      cashFlow: cashFlow.filter(e => e.value !== 0 && e.value !== undefined).slice(0, 8),
      source: 'Yahoo Finance',
      lastUpdated: new Date().toISOString(),
    }

    cache.set(key, { data: payload, expires: Date.now() + 3_600_000 })
    return payload
  } catch (err) {
    dev && console.error('[edgar] Yahoo financials error:', err)
    return null
  }
}

// ── Route handler ──────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const ticker = searchParams.get('ticker')?.toUpperCase().trim()
  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

  // For non-US symbols (contains dot like RELIANCE.NS), use Yahoo directly
  if (ticker.includes('.')) {
    const yahooData = await fetchYahooFinancials(ticker)
    if (!yahooData) {
      return NextResponse.json(
        { error: 'Financial data unavailable for this symbol', ticker },
        { headers: { 'Cache-Control': 'public, s-maxage=300' } },
      )
    }
    return NextResponse.json(yahooData, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    })
  }

  // For US stocks, try EDGAR first (authoritative), fallback to Yahoo
  const cik = await resolveCIK(ticker)

  if (cik) {
    const edgarData = await fetchEdgarFacts(cik, ticker)
    if (edgarData) {
      return NextResponse.json(edgarData, {
        headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
      })
    }
  }

  // EDGAR failed or no CIK — fallback to Yahoo Finance
  const yahooData = await fetchYahooFinancials(ticker)
  if (yahooData) {
    return NextResponse.json(yahooData, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    })
  }

  return NextResponse.json(
    { error: 'Financial data unavailable', ticker, cik: cik ?? 'not found' },
    { headers: { 'Cache-Control': 'public, s-maxage=300' } },
  )
}