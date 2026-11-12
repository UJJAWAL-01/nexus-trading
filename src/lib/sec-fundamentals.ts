// src/lib/sec-fundamentals.ts
// Pure transformation of SEC EDGAR companyfacts JSON into annual periods.
// No I/O here, so every XBRL guard is unit-tested (see __tests__).

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Period {
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

export interface FundamentalsResponse {
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

export interface XbrlFact {
  start?: string
  end:    string
  val:    number
  form?:  string
  filed?: string
}
export interface CompanyFacts {
  entityName?: string
  facts?: { 'us-gaap'?: Record<string, { units?: Record<string, XbrlFact[]> }> }
}

// ── Metric definitions ────────────────────────────────────────────────────────

// Flow metrics: measured over a period (need a ~1-year duration).
const FLOW_USD = [
  'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax',
  'GrossProfit', 'OperatingIncomeLoss', 'NetIncomeLoss',
  'NetCashProvidedByUsedInOperatingActivities',
  'PaymentsToAcquirePropertyPlantAndEquipment',
] as const
// Stock metrics: a balance at a point in time (matched to fiscal year-end dates).
const INSTANT_USD = ['Assets', 'Liabilities', 'StockholdersEquity'] as const

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '10-KT', '20-F', '20-F/A', '40-F', '40-F/A'])
const MAX_YEARS = 12

const dayMs = 86_400_000
const isAnnualDuration = (f: XbrlFact): boolean => {
  if (!f.start) return false
  const days = (Date.parse(f.end) - Date.parse(f.start)) / dayMs
  return days >= 350 && days <= 380
}

/** Latest-filed value per period end. */
function latestByEnd(facts: XbrlFact[]): Map<string, XbrlFact> {
  const out = new Map<string, XbrlFact>()
  for (const f of facts) {
    if (typeof f.val !== 'number' || !Number.isFinite(f.val) || !/^\d{4}-\d{2}-\d{2}$/.test(f.end)) continue
    const prev = out.get(f.end)
    if (!prev || (f.filed ?? '') > (prev.filed ?? '')) out.set(f.end, f)
  }
  return out
}

// ── Derived metrics ───────────────────────────────────────────────────────────

function computeDerived(metrics: Record<string, number>): Record<string, number | null> {
  // Some companies report `Revenues`, others the ASC 606 tag. Same logical line.
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
    // CapEx is reported as a positive magnitude (it is an outflow).
    FreeCashFlow:    (ocf != null && capex != null) ? ocf - capex : null,
    ROE:             div(netInc, equity),
    ROA:             div(netInc, assets),
    BookValuePerShare: div(equity, shares),
  }
}

// ── companyfacts → periods ────────────────────────────────────────────────────

export function buildPeriods(cf: CompanyFacts): { periods: Period[]; rowCount: number } {
  const gaap = cf.facts?.['us-gaap'] ?? {}
  const byEnd = new Map<string, { metrics: Record<string, number>; units: Record<string, string>; latestAsOf: string }>()
  let rowCount = 0

  const put = (end: string, metric: string, unit: string, f: XbrlFact) => {
    const p = byEnd.get(end) ?? { metrics: {}, units: {}, latestAsOf: '' }
    p.metrics[metric] = f.val
    p.units[metric]   = unit
    if ((f.filed ?? '') > p.latestAsOf) p.latestAsOf = f.filed ?? ''
    byEnd.set(end, p)
    rowCount++
  }

  const annual = (tag: string, unit: string): Map<string, XbrlFact> => {
    const facts = gaap[tag]?.units?.[unit] ?? []
    return latestByEnd(facts.filter(f => isAnnualDuration(f) && (!f.form || ANNUAL_FORMS.has(f.form))))
  }

  // 1. Flow metrics define which dates are fiscal year-ends.
  for (const tag of FLOW_USD) {
    for (const [end, f] of annual(tag, 'USD')) put(end, tag, 'USD', f)
  }
  for (const [end, f] of annual('EarningsPerShareDiluted', 'USD/shares')) put(end, 'EarningsPerShareDiluted', 'USD/shares', f)

  // 2. Balance-sheet metrics only at those year-end dates.
  const yearEnds = new Set(byEnd.keys())
  const instant = (tag: string, unit: string) => {
    const facts = gaap[tag]?.units?.[unit] ?? []
    for (const [end, f] of latestByEnd(facts.filter(x => !x.start))) {
      if (yearEnds.has(end)) put(end, tag, unit, f)
    }
  }
  for (const tag of INSTANT_USD) instant(tag, 'USD')
  instant('CommonStockSharesOutstanding', 'shares')

  const periods: Period[] = [...byEnd.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, MAX_YEARS)
    .map(([end, p]) => {
      const year = Number(end.slice(0, 4))
      return {
        fiscalPeriodEnd: end,
        fiscalYear:      year,
        fiscalQuarter:   null,
        calendarYear:    year,
        calendarQuarter: null,
        periodType:      'annual' as const,
        metrics:         p.metrics,
        computed:        computeDerived(p.metrics),
        units:           p.units,
        latestAsOf:      p.latestAsOf,
      }
    })

  return { periods, rowCount }
}

// SEC SIC code → broad sector. SIC is the only classification EDGAR publishes.
export function sicToSector(sic: string | undefined): string | null {
  const n = Number(sic)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n >= 2833 && n <= 2836 || n >= 3841 && n <= 3851 || n >= 8000 && n <= 8099) return 'Healthcare'
  if (n >= 3570 && n <= 3579 || n >= 3660 && n <= 3679 || n >= 7370 && n <= 7379) return 'Technology'
  if (n >= 4800 && n <= 4899) return 'Communication'
  if (n >= 4900 && n <= 4999) return 'Utilities'
  if (n >= 6500 && n <= 6599 || n === 6798) return 'Real Estate'
  if (n >= 6000 && n <= 6799) return 'Financials'
  if (n >= 1000 && n <= 1499 && !(n >= 1300 && n <= 1399)) return 'Materials'
  if (n >= 1300 && n <= 1399 || n >= 2900 && n <= 2999) return 'Energy'
  if (n >= 2000 && n <= 2199) return 'Consumer Staples'
  if (n >= 2600 && n <= 2899 || n >= 3300 && n <= 3399) return 'Materials'
  if (n >= 5000 && n <= 5999 || n >= 7000 && n <= 7999 || n >= 2200 && n <= 2599 || n >= 3700 && n <= 3716) return 'Consumer Discretionary'
  if (n >= 1500 && n <= 1799 || n >= 3400 && n <= 3999 || n >= 4000 && n <= 4799) return 'Industrials'
  return null
}
