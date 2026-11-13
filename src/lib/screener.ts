// src/lib/screener.ts
// In-browser stock screener over the static SEC dataset (public/data/screener.json).
// Pure functions: no network, no server. Shared by the build script (column
// layout) and the Screener panel (filter + sort), and unit-tested.

export const SCREENER_COLUMNS = [
  'ticker', 'name', 'cik', 'sic', 'sector', 'state',
  'revenue', 'netIncome', 'operatingIncome',
  'grossMargin', 'operatingMargin', 'netMargin',
  'roe', 'roa', 'debtToEquity',
  'eps', 'freeCashFlow', 'assets', 'equity',
] as const

export type ScreenerColumn = (typeof SCREENER_COLUMNS)[number]
export type ScreenerRow = Array<string | number | null>

export interface ScreenerFile {
  generatedAt: string
  fiscalYear:  number
  source:      string
  note:        string
  columns:     string[]
  rows:        ScreenerRow[]
}

export interface Company {
  ticker: string; name: string; cik: number; sic: string; sector: string; state: string
  revenue: number | null; netIncome: number | null; operatingIncome: number | null
  grossMargin: number | null; operatingMargin: number | null; netMargin: number | null
  roe: number | null; roa: number | null; debtToEquity: number | null
  eps: number | null; freeCashFlow: number | null; assets: number | null; equity: number | null
}

const NUMERIC: ReadonlySet<string> = new Set([
  'revenue', 'netIncome', 'operatingIncome', 'grossMargin', 'operatingMargin', 'netMargin',
  'roe', 'roa', 'debtToEquity', 'eps', 'freeCashFlow', 'assets', 'equity',
])

/** Turn the compact array-of-arrays file into typed objects. Tolerates column reordering. */
export function decodeScreener(file: ScreenerFile): Company[] {
  const idx = new Map(file.columns.map((c, i) => [c, i]))
  const out: Company[] = []
  for (const row of file.rows) {
    const get = (c: ScreenerColumn) => { const i = idx.get(c); return i === undefined ? null : row[i] ?? null }
    const n = (c: ScreenerColumn): number | null => { const v = get(c); return typeof v === 'number' && Number.isFinite(v) ? v : null }
    const ticker = String(get('ticker') ?? '')
    if (!ticker) continue
    out.push({
      ticker, name: String(get('name') ?? ''), cik: Number(get('cik') ?? 0),
      sic: String(get('sic') ?? ''), sector: String(get('sector') ?? 'Other'), state: String(get('state') ?? ''),
      revenue: n('revenue'), netIncome: n('netIncome'), operatingIncome: n('operatingIncome'),
      grossMargin: n('grossMargin'), operatingMargin: n('operatingMargin'), netMargin: n('netMargin'),
      roe: n('roe'), roa: n('roa'), debtToEquity: n('debtToEquity'),
      eps: n('eps'), freeCashFlow: n('freeCashFlow'), assets: n('assets'), equity: n('equity'),
    })
  }
  return out
}

export interface ScreenerFilters {
  query?:            string        // ticker or name contains
  sector?:           string        // exact sector, or '' / 'All'
  minRevenue?:       number | null // USD
  minNetMargin?:     number | null // fraction, e.g. 0.1
  minGrossMargin?:   number | null
  minRoe?:           number | null
  maxDebtToEquity?:  number | null
  profitableOnly?:   boolean
  positiveFcfOnly?:  boolean
}

const passMin = (v: number | null, min: number | null | undefined) => min == null || (v !== null && v >= min)
const passMax = (v: number | null, max: number | null | undefined) => max == null || (v !== null && v <= max)

/**
 * Filter then sort. A company with no value for a filtered metric is excluded
 * (unknown is not treated as passing), and nulls always sort last.
 */
export function runScreen(
  companies: readonly Company[],
  filters: ScreenerFilters,
  sortBy: keyof Company = 'revenue',
  direction: 'asc' | 'desc' = 'desc',
): Company[] {
  const q = (filters.query ?? '').trim().toUpperCase()
  const sector = filters.sector && filters.sector !== 'All' ? filters.sector : ''

  const out = companies.filter(c => {
    if (q && !c.ticker.includes(q) && !c.name.toUpperCase().includes(q)) return false
    if (sector && c.sector !== sector) return false
    if (!passMin(c.revenue, filters.minRevenue)) return false
    if (!passMin(c.netMargin, filters.minNetMargin)) return false
    if (!passMin(c.grossMargin, filters.minGrossMargin)) return false
    if (!passMin(c.roe, filters.minRoe)) return false
    if (!passMax(c.debtToEquity, filters.maxDebtToEquity)) return false
    if (filters.profitableOnly && !(c.netIncome !== null && c.netIncome > 0)) return false
    if (filters.positiveFcfOnly && !(c.freeCashFlow !== null && c.freeCashFlow > 0)) return false
    return true
  })

  const numeric = NUMERIC.has(sortBy as string)
  const sign = direction === 'asc' ? 1 : -1
  return out.sort((a, b) => {
    const x = a[sortBy], y = b[sortBy]
    if (numeric) {
      if (x === null && y === null) return 0
      if (x === null) return 1              // nulls last, both directions
      if (y === null) return -1
      return ((x as number) - (y as number)) * sign
    }
    return String(x ?? '').localeCompare(String(y ?? '')) * sign
  })
}

export function sectorsOf(companies: readonly Company[]): string[] {
  return [...new Set(companies.map(c => c.sector))].sort((a, b) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
}
