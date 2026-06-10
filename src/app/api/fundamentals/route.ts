// ─── /api/fundamentals ────────────────────────────────────────────────────────
//
// Returns the full 5-year quarterly XBRL fundamentals time series for one
// company, sourced from our Supabase Postgres mirror of SEC EDGAR data
// (populated by scripts/ingest-sec-fundamentals.ts).
//
// Request:
//   GET /api/fundamentals?ticker=AAPL
//
// Response shape:
//   {
//     ticker:  "AAPL",
//     company: { name, cik, sector, industry, country, currency },
//     periods: [
//       {
//         fiscalPeriodEnd: "2024-09-28",
//         fiscalYear: 2024, fiscalQuarter: 4,
//         calendarYear: 2024, calendarQuarter: 3,
//         periodType:  "quarterly" | "annual",
//         metrics:     { Revenues: 94930000000, NetIncomeLoss: 14700000000, ... },
//         computed:    { FreeCashFlow, GrossMargin, OperatingMargin, NetMargin, ... }
//       },
//       …
//     ],
//     meta: { fetchedAt, source, cached, rowCount }
//   }
//
// Caching:
//   • Redis (or in-memory shim) — 6 hour TTL.  Fundamentals change at most
//     once a quarter, so anything finer is wasted DB load.
//   • CDN headers — s-maxage=21600 stale-while-revalidate=43200.

import { NextRequest, NextResponse } from 'next/server'
import { db, companies, eq, sql } from '@db/client'
import { redis } from '@db/redis'

// ── Types ─────────────────────────────────────────────────────────────────────

// Drizzle's db.execute<T>() requires T to be a Record<string, unknown>, so we
// add an index signature.  The fields below are still type-checked as expected.
type RawRow = {
  metric:           string
  fiscal_period_end: string
  fiscal_year:      number
  fiscal_quarter:   number | null
  calendar_year:    number
  calendar_quarter: number | null
  period_type:      string
  value:            string  // numeric → string from Postgres
  unit:             string
  as_of:            string
} & Record<string, unknown>

interface Period {
  fiscalPeriodEnd:  string
  fiscalYear:       number
  fiscalQuarter:    number | null
  calendarYear:     number
  calendarQuarter:  number | null
  periodType:       'quarterly' | 'annual'
  metrics:          Record<string, number>
  computed:         Record<string, number | null>
  units:            Record<string, string>
  latestAsOf:       string
}

interface FundamentalsResponse {
  ticker:  string
  company: {
    name:     string
    cik:      string | null
    sector:   string | null
    industry: string | null
    country:  string
    currency: string | null
  }
  periods: Period[]
  meta: {
    fetchedAt: string
    source:    string
    cached:    boolean
    rowCount:  number
  }
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 6 * 60 * 60   // 6h
// v3 = annual-only + USD-unit guard + fiscalYear derived from period_end
// (v1 had TTM-polluted quarterly data, v2 still used SEC's misleading `fy` field)
const CACHE_PREFIX = 'fundamentals:v3:'

// ── Derived metrics ───────────────────────────────────────────────────────────
//
// Computed at request time from the raw XBRL values.  We deliberately don't
// store these — they'd duplicate data and any formula change forces a
// re-ingestion.  Computing here keeps the storage layer pure.

function computeDerived(metrics: Record<string, number>): Record<string, number | null> {
  // Some companies report `Revenues`, others `RevenueFromContractWithCustomerExcludingAssessedTax`.
  // Treat them as the same logical revenue line.
  const revenue =
    metrics['Revenues'] ??
    metrics['RevenueFromContractWithCustomerExcludingAssessedTax'] ??
    null

  const grossProfit = metrics['GrossProfit'] ?? null
  const opInc       = metrics['OperatingIncomeLoss'] ?? null
  const netInc      = metrics['NetIncomeLoss'] ?? null
  const ocf         = metrics['NetCashProvidedByUsedInOperatingActivities'] ?? null
  const capex       = metrics['PaymentsToAcquirePropertyPlantAndEquipment'] ?? null
  const assets      = metrics['Assets'] ?? null
  const equity      = metrics['StockholdersEquity'] ?? null
  const shares      = metrics['CommonStockSharesOutstanding'] ?? null

  const div = (a: number | null, b: number | null): number | null => {
    if (a == null || b == null || b === 0) return null
    return a / b
  }

  return {
    Revenue:         revenue,
    GrossMargin:     div(grossProfit, revenue),
    OperatingMargin: div(opInc,        revenue),
    NetMargin:       div(netInc,       revenue),
    // CapEx values come in as positive numbers (it's an outflow but SEC reports magnitude)
    FreeCashFlow:    (ocf != null && capex != null) ? ocf - capex : null,
    ROE:             div(netInc, equity),
    ROA:             div(netInc, assets),
    BookValuePerShare: div(equity, shares),
  }
}

// ── Pivot raw rows → periods ──────────────────────────────────────────────────

function pivotToPeriods(rows: RawRow[]): Period[] {
  // Group by (fiscal_period_end, period_type)
  const byPeriod = new Map<string, {
    fiscalPeriodEnd: string
    fiscalYear: number
    fiscalQuarter: number | null
    calendarYear: number
    calendarQuarter: number | null
    periodType: 'quarterly' | 'annual'
    metrics: Record<string, number>
    units:   Record<string, string>
    latestAsOf: string
  }>()

  for (const r of rows) {
    const key = `${r.fiscal_period_end}|${r.period_type}`
    // Derive fiscalYear from fiscal_period_end, NOT the SEC-reported `fy` field.
    // SEC restatements tag the period with the *filing's* fiscal context — e.g.
    // a 2026 10-K restating data for 2024-12-31 tags it with fy=2025, even though
    // that period is really FY2024.  The end-date year is the source of truth.
    const trueFiscalYear = Number(r.fiscal_period_end.slice(0, 4))
    const existing = byPeriod.get(key)
    if (!existing) {
      byPeriod.set(key, {
        fiscalPeriodEnd:  r.fiscal_period_end,
        fiscalYear:       trueFiscalYear,
        fiscalQuarter:    r.fiscal_quarter,
        calendarYear:     r.calendar_year,
        calendarQuarter:  r.calendar_quarter,
        periodType:       r.period_type as 'quarterly' | 'annual',
        metrics:          { [r.metric]: Number(r.value) },
        units:            { [r.metric]: r.unit },
        latestAsOf:       r.as_of,
      })
    } else {
      existing.metrics[r.metric] = Number(r.value)
      existing.units[r.metric]   = r.unit
      if (r.as_of > existing.latestAsOf) existing.latestAsOf = r.as_of
    }
  }

  // Convert to array + add computed metrics, sorted newest first
  return Array.from(byPeriod.values())
    .map(p => ({
      ...p,
      computed: computeDerived(p.metrics),
    }))
    .sort((a, b) => b.fiscalPeriodEnd.localeCompare(a.fiscalPeriodEnd))
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const tickerParam = searchParams.get('ticker')?.trim().toUpperCase()
  if (!tickerParam) {
    return NextResponse.json({ error: 'ticker parameter is required' }, { status: 400 })
  }

  const cacheKey = `${CACHE_PREFIX}${tickerParam}`

  // ── 1. Try cache ──────────────────────────────────────────────────────────
  try {
    const hit = await redis.get<FundamentalsResponse>(cacheKey)
    if (hit) {
      return NextResponse.json({ ...hit, meta: { ...hit.meta, cached: true } }, {
        headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
      })
    }
  } catch { /* cache miss → DB */ }

  // ── 2. Look up company ────────────────────────────────────────────────────
  const [company] = await db
    .select({
      id:       companies.id,
      name:     companies.name,
      cik:      companies.cik,
      sector:   companies.sector,
      industry: companies.industry,
      country:  companies.country,
      currency: companies.currency,
    })
    .from(companies)
    .where(eq(companies.ticker, tickerParam))
    .limit(1)

  if (!company) {
    return NextResponse.json({ error: `Unknown ticker: ${tickerParam}` }, { status: 404 })
  }

  // ── 3. Pull latest revision of each (metric, fiscal_period_end) ──────────
  // The composite index on (company_id, metric, fiscal_period_end) makes the
  // grouping cheap.  DISTINCT ON is Postgres-specific but ideal here.
  //
  // ANNUAL-ONLY GUARD (Phase A fix, 2026-06):
  //   SEC XBRL returns *both* the 3-month quarterly value AND the rolling
  //   12-month TTM value for the same (metric, fiscal_period_end) tag.  Without
  //   the `start` date we can't tell them apart, so quarterly rows in the DB
  //   are unreliable — e.g. AMZN Q1 2024 stored as $37.7B is actually the TTM
  //   sum (Q2'23+Q3'23+Q4'23+Q1'24), not the $10.4B real quarter.  Annual
  //   (fp="FY") values are unambiguous, so until ingestion captures `start`
  //   we restrict to period_type='annual'.
  //
  // UNIT GUARD:
  //   Foreign filers (20-F: Japanese/Korean/UK ADRs) report in their home
  //   currency.  Treating those values as USD silently inflates revenue 100x+.
  //   We accept USD for flow/balance-sheet metrics and USD/shares for EPS.
  const rows = await db.execute<RawRow>(sql`
    SELECT DISTINCT ON (metric, fiscal_period_end)
      metric,
      fiscal_period_end::text AS fiscal_period_end,
      fiscal_year,
      fiscal_quarter,
      calendar_year,
      calendar_quarter,
      period_type,
      value::text AS value,
      unit,
      as_of::text AS as_of
    FROM fundamentals
    WHERE company_id = ${company.id}
      AND period_type = 'annual'
      AND (
        (metric IN (
          'Revenues','RevenueFromContractWithCustomerExcludingAssessedTax',
          'GrossProfit','OperatingIncomeLoss','NetIncomeLoss',
          'Assets','Liabilities','StockholdersEquity',
          'NetCashProvidedByUsedInOperatingActivities',
          'PaymentsToAcquirePropertyPlantAndEquipment',
          'CommonStockSharesOutstanding'
        ) AND unit IN ('USD','shares'))
        OR (metric = 'EarningsPerShareDiluted' AND unit IN ('USD/shares','USD'))
      )
    ORDER BY metric, fiscal_period_end DESC, as_of DESC
  `)

  if (rows.length === 0) {
    // Company exists but no fundamentals — most likely a SEC filer with no XBRL
    // data (small / foreign / closed-end fund).
    const empty: FundamentalsResponse = {
      ticker: tickerParam,
      company: {
        name:     company.name,
        cik:      company.cik ?? null,
        sector:   company.sector ?? null,
        industry: company.industry ?? null,
        country:  company.country,
        currency: company.currency ?? null,
      },
      periods: [],
      meta: {
        fetchedAt: new Date().toISOString(),
        source:    'SEC EDGAR XBRL (no coverage)',
        cached:    false,
        rowCount:  0,
      },
    }
    return NextResponse.json(empty, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
    })
  }

  // ── 4. Pivot + compute derived ───────────────────────────────────────────
  const periods = pivotToPeriods([...rows])

  const response: FundamentalsResponse = {
    ticker: tickerParam,
    company: {
      name:     company.name,
      cik:      company.cik ?? null,
      sector:   company.sector ?? null,
      industry: company.industry ?? null,
      country:  company.country,
      currency: company.currency ?? null,
    },
    periods,
    meta: {
      fetchedAt: new Date().toISOString(),
      source:    'SEC EDGAR XBRL',
      cached:    false,
      rowCount:  rows.length,
    },
  }

  // ── 5. Cache + return ─────────────────────────────────────────────────────
  try { await redis.set(cacheKey, response, { ex: CACHE_TTL_SECONDS }) } catch {}

  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
  })
}
