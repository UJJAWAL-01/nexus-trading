// ─── /api/screener ────────────────────────────────────────────────────────────
//
// Real Koyfin-style stock screener backed by 5 years of SEC EDGAR XBRL
// fundamentals (ingested via scripts/ingest-sec-fundamentals.ts).
//
// Strategy:
//   1. Find each company's most recent annual (FY) values for the canonical
//      metrics — annual filings give a clean snapshot per year.
//   2. Compute derived ratios (margins, ROE, ROA) in SQL.
//   3. Apply filters in SQL too — pushes the WHERE down so we never ship
//      thousands of rows over the wire only to filter in JS.
//   4. Sort + paginate.
//
// Query targets sub-200ms p95 on the Russell-3000 universe (we built indexes
// on (company_id, metric, fiscal_period_end) specifically for this).
//
// Request:
//   GET /api/screener?country=US&sector=Technology&minRevenue=1e9&minNetMargin=0.1&sortBy=revenue&sortDir=desc&limit=50&offset=0
//
// All filter params are optional.  Numbers can use scientific notation
// (`1e9`, `5e8`) for ergonomics in the slider UI.

import { NextRequest, NextResponse } from 'next/server'
import { db, sql } from '@db/client'
import { redis } from '@db/redis'

// ── Types ─────────────────────────────────────────────────────────────────────

interface ScreenerRow {
  ticker:          string
  name:            string
  sector:          string | null
  industry:        string | null
  country:         string
  currency:        string | null
  logo_domain:     string | null
  latest_fy:       number | null
  revenue:         string | null
  net_income:      string | null
  gross_profit:    string | null
  op_income:       string | null
  eps:             string | null
  equity:          string | null
  assets:          string | null
  liabilities:     string | null
  net_margin:      string | null
  gross_margin:    string | null
  operating_margin: string | null
  roe:             string | null
  roa:             string | null
}

type SortBy =
  | 'revenue' | 'netIncome' | 'netMargin' | 'grossMargin' | 'operatingMargin'
  | 'roe'     | 'roa'       | 'eps'       | 'ticker'

const SORT_COLUMNS: Record<SortBy, string> = {
  revenue:         'revenue',
  netIncome:       'net_income',
  netMargin:       'net_margin',
  grossMargin:     'gross_margin',
  operatingMargin: 'operating_margin',
  roe:             'roe',
  roa:             'roa',
  eps:             'eps',
  ticker:          'ticker',
}

// ── Args parsing ──────────────────────────────────────────────────────────────

interface Filters {
  country:      'US' | 'IN' | 'ALL'
  sector:       string | null
  minRevenue:   number | null
  maxRevenue:   number | null
  minNetMargin: number | null
  maxNetMargin: number | null
  minROE:       number | null
  maxROE:       number | null
  sortBy:       SortBy
  sortDir:      'asc' | 'desc'
  limit:        number
  offset:       number
}

function parseFilters(sp: URLSearchParams): Filters {
  const num = (k: string): number | null => {
    const v = sp.get(k)
    if (v == null || v === '') return null
    const n = Number(v)
    return isFinite(n) ? n : null
  }
  const countryRaw = (sp.get('country') ?? 'US').toUpperCase()
  const sortByRaw  = (sp.get('sortBy') ?? 'revenue') as SortBy
  return {
    country:      ['US', 'IN', 'ALL'].includes(countryRaw) ? (countryRaw as 'US' | 'IN' | 'ALL') : 'US',
    sector:       sp.get('sector') || null,
    minRevenue:   num('minRevenue'),
    maxRevenue:   num('maxRevenue'),
    minNetMargin: num('minNetMargin'),
    maxNetMargin: num('maxNetMargin'),
    minROE:       num('minROE'),
    maxROE:       num('maxROE'),
    sortBy:       SORT_COLUMNS[sortByRaw] ? sortByRaw : 'revenue',
    sortDir:      sp.get('sortDir') === 'asc' ? 'asc' : 'desc',
    limit:        Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 200),
    offset:       Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0),
  }
}

function cacheKey(f: Filters): string {
  return `screener:v1:${JSON.stringify(f)}`
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now()
  const url = new URL(req.url)
  const filters = parseFilters(url.searchParams)

  // 1. Cache lookup (10-min TTL — fundamentals change rarely, but filter
  //    combinations vary so we use a longer-than-usual key space).
  const ck = cacheKey(filters)
  try {
    const hit = await redis.get<unknown>(ck)
    if (hit) {
      return NextResponse.json(hit, {
        headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
      })
    }
  } catch { /* miss → DB */ }

  // 2. Build the screener query.  We compute everything we need in one round-trip:
  //    • Per-company latest-annual values for the canonical metrics (DISTINCT ON)
  //    • Pivot via FILTER aggregates so we get one row per company
  //    • Join companies for ticker / name / sector
  //    • Compute derived ratios
  //    • Apply optional filters
  //    • Sort + paginate
  //
  // Indexes used:
  //   • fundamentals(company_id, metric, fiscal_period_end) for the DISTINCT ON
  //   • companies(country), companies(sector), companies(is_active) for the WHERE
  // Country clause used inside the main query where `companies` is aliased as `c`.
  const countryClauseC = filters.country === 'ALL'
    ? sql`c.country IN ('US', 'IN')`
    : sql`c.country = ${filters.country}`
  // Same predicate but without table alias — used in the sectors query which
  // doesn't alias the companies table.
  const countryClauseBare = filters.country === 'ALL'
    ? sql`country IN ('US', 'IN')`
    : sql`country = ${filters.country}`

  const sortColExpr = SORT_COLUMNS[filters.sortBy]
  const sortDirSql  = filters.sortDir === 'asc' ? sql`ASC NULLS LAST` : sql`DESC NULLS LAST`

  const rows = await db.execute<ScreenerRow & Record<string, unknown>>(sql`
    WITH latest_annual AS (
      -- Latest annual revision per (company, metric) — DISTINCT ON skips older
      -- restatements automatically.
      -- Unit guard:  drop foreign-currency rows.  SEC's 20-F filers (Japanese,
      -- Korean, UK ADRs etc.) report in JPY/KRW/GBP — treating those values as
      -- USD silently inflates revenue by 100x+.  We only screen USD reporters.
      SELECT DISTINCT ON (company_id, metric)
        company_id, metric, fiscal_year,
        value::numeric AS value
      FROM fundamentals
      WHERE period_type = 'annual'
        AND (
          -- Flow / balance sheet metrics → USD
          (metric IN (
            'Revenues','RevenueFromContractWithCustomerExcludingAssessedTax',
            'GrossProfit','OperatingIncomeLoss','NetIncomeLoss',
            'Assets','Liabilities','StockholdersEquity'
          ) AND unit = 'USD')
          OR
          -- Per-share metric → USD/shares
          (metric = 'EarningsPerShareDiluted' AND unit IN ('USD/shares','USD'))
        )
      ORDER BY company_id, metric, fiscal_period_end DESC, as_of DESC
    ),
    pivoted AS (
      SELECT
        company_id,
        MAX(fiscal_year)                                                                            AS latest_fy,
        MAX(value) FILTER (WHERE metric IN ('Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax')) AS revenue,
        MAX(value) FILTER (WHERE metric = 'NetIncomeLoss')                                          AS net_income,
        MAX(value) FILTER (WHERE metric = 'GrossProfit')                                            AS gross_profit,
        MAX(value) FILTER (WHERE metric = 'OperatingIncomeLoss')                                    AS op_income,
        MAX(value) FILTER (WHERE metric = 'EarningsPerShareDiluted')                                AS eps,
        MAX(value) FILTER (WHERE metric = 'StockholdersEquity')                                     AS equity,
        MAX(value) FILTER (WHERE metric = 'Assets')                                                 AS assets,
        MAX(value) FILTER (WHERE metric = 'Liabilities')                                            AS liabilities
      FROM latest_annual
      GROUP BY company_id
    ),
    enriched AS (
      -- Keep all numeric columns as numeric so ORDER BY does proper math
      -- (text-cast happens at the outer SELECT, after sorting).
      SELECT
        c.ticker,
        c.name,
        c.sector,
        c.industry,
        c.country,
        c.currency,
        c.logo_domain,
        p.latest_fy::int                                                  AS latest_fy,
        p.revenue                                                         AS revenue,
        p.net_income                                                      AS net_income,
        p.gross_profit                                                    AS gross_profit,
        p.op_income                                                       AS op_income,
        p.eps                                                             AS eps,
        p.equity                                                          AS equity,
        p.assets                                                          AS assets,
        p.liabilities                                                     AS liabilities,
        (p.net_income / NULLIF(p.revenue, 0))                             AS net_margin,
        (p.gross_profit / NULLIF(p.revenue, 0))                           AS gross_margin,
        (p.op_income / NULLIF(p.revenue, 0))                              AS operating_margin,
        (p.net_income / NULLIF(p.equity, 0))                              AS roe,
        (p.net_income / NULLIF(p.assets, 0))                              AS roa
      FROM companies c
      INNER JOIN pivoted p ON p.company_id = c.id
      WHERE c.is_active = TRUE
        AND ${countryClauseC}
        ${filters.sector       ? sql`AND c.sector ILIKE ${filters.sector}`                              : sql``}
        ${filters.minRevenue   != null ? sql`AND p.revenue   >= ${filters.minRevenue}`                  : sql``}
        ${filters.maxRevenue   != null ? sql`AND p.revenue   <= ${filters.maxRevenue}`                  : sql``}
        ${filters.minNetMargin != null ? sql`AND (p.net_income / NULLIF(p.revenue, 0)) >= ${filters.minNetMargin}` : sql``}
        ${filters.maxNetMargin != null ? sql`AND (p.net_income / NULLIF(p.revenue, 0)) <= ${filters.maxNetMargin}` : sql``}
        ${filters.minROE       != null ? sql`AND (p.net_income / NULLIF(p.equity, 0)) >= ${filters.minROE}`        : sql``}
        ${filters.maxROE       != null ? sql`AND (p.net_income / NULLIF(p.equity, 0)) <= ${filters.maxROE}`        : sql``}
    )
    SELECT *,
           (SELECT COUNT(*)::int FROM enriched) AS total_count
    FROM enriched
    ORDER BY ${sql.raw(sortColExpr)} ${sortDirSql}, ticker ASC
    LIMIT ${filters.limit} OFFSET ${filters.offset}
  `)

  const totalCount = rows.length > 0 ? Number((rows[0] as { total_count?: number }).total_count ?? 0) : 0

  // Pull distinct sectors for the panel dropdown (cheap one-row query on a 10K-row table)
  const sectorsRaw = await db.execute<{ sector: string }>(sql`
    SELECT DISTINCT sector
    FROM companies
    WHERE is_active = TRUE
      AND sector IS NOT NULL
      AND sector <> ''
      AND ${countryClauseBare}
    ORDER BY sector
  `)
  const sectors = sectorsRaw.map(r => r.sector)

  const response = {
    results: rows.map((r: ScreenerRow) => ({
      ticker:          r.ticker,
      name:            r.name,
      sector:          r.sector,
      industry:        r.industry,
      country:         r.country,
      currency:        r.currency,
      logoDomain:      r.logo_domain,
      latestFy:        r.latest_fy ?? null,
      revenue:         r.revenue         != null ? Number(r.revenue)         : null,
      netIncome:       r.net_income      != null ? Number(r.net_income)      : null,
      grossProfit:     r.gross_profit    != null ? Number(r.gross_profit)    : null,
      opIncome:        r.op_income       != null ? Number(r.op_income)       : null,
      eps:             r.eps             != null ? Number(r.eps)             : null,
      equity:          r.equity          != null ? Number(r.equity)          : null,
      assets:          r.assets          != null ? Number(r.assets)          : null,
      liabilities:     r.liabilities     != null ? Number(r.liabilities)     : null,
      netMargin:       r.net_margin      != null ? Number(r.net_margin)      : null,
      grossMargin:     r.gross_margin    != null ? Number(r.gross_margin)    : null,
      operatingMargin: r.operating_margin != null ? Number(r.operating_margin) : null,
      roe:             r.roe             != null ? Number(r.roe)             : null,
      roa:             r.roa             != null ? Number(r.roa)             : null,
    })),
    sectors,
    meta: {
      filters,
      totalCount,
      returnedCount: rows.length,
      fetchedAt:     new Date().toISOString(),
      queryMs:       Date.now() - startedAt,
      source:        'SEC EDGAR XBRL (latest annual)',
    },
  }

  try { await redis.set(ck, response, { ex: 600 }) } catch {}

  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' },
  })
}
