// src/lib/risk.ts
// Portfolio risk analytics and seasonality. Pure maths on daily/monthly closes,
// computed in the browser: no server, no key, no cost. Unit-tested.
//
// Conventions:
//   • Returns are simple close-to-close returns.
//   • Series are aligned on the dates ALL of them share, so a holiday in one
//     market never creates a fake zero return in another.
//   • Annualisation uses 252 trading days.
//   • Every function returns null rather than a number it cannot justify.

export const TRADING_DAYS = 252
const MIN_OBS = 30

export type Series = ReadonlyMap<string, number>   // ISO date → close

export const isoDay = (unixSeconds: number): string => new Date(unixSeconds * 1000).toISOString().slice(0, 10)

/** Dates present in every series, ascending. */
export function commonDates(series: readonly Series[]): string[] {
  if (!series.length) return []
  const [first, ...rest] = [...series].sort((a, b) => a.size - b.size)
  return [...first.keys()].filter(d => rest.every(s => s.has(d))).sort()
}

export function returnsOn(series: Series, dates: readonly string[]): number[] {
  const out: number[] = []
  for (let i = 1; i < dates.length; i++) {
    const a = series.get(dates[i - 1]), b = series.get(dates[i])
    out.push(a && b && a > 0 ? b / a - 1 : 0)
  }
  return out
}

export const mean = (x: readonly number[]): number => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0)

export function stdev(x: readonly number[]): number | null {
  if (x.length < 2) return null
  const m = mean(x)
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1))
}

export function covariance(x: readonly number[], y: readonly number[]): number | null {
  const n = Math.min(x.length, y.length)
  if (n < 2) return null
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n))
  let s = 0
  for (let i = 0; i < n; i++) s += (x[i] - mx) * (y[i] - my)
  return s / (n - 1)
}

export function correlation(x: readonly number[], y: readonly number[]): number | null {
  const c = covariance(x, y), sx = stdev(x), sy = stdev(y)
  if (c === null || !sx || !sy) return null
  return Math.max(-1, Math.min(1, c / (sx * sy)))
}

/** Sensitivity of `asset` to `benchmark`: cov(a, b) / var(b). */
export function beta(asset: readonly number[], benchmark: readonly number[]): number | null {
  const c = covariance(asset, benchmark), sb = stdev(benchmark)
  if (c === null || !sb) return null
  return c / (sb * sb)
}

export function annualVol(returns: readonly number[]): number | null {
  const s = stdev(returns)
  return s === null ? null : s * Math.sqrt(TRADING_DAYS)
}

/** Largest peak-to-trough fall of the compounded return path, as a negative fraction. */
export function maxDrawdown(returns: readonly number[]): number {
  let equity = 1, peak = 1, worst = 0
  for (const r of returns) {
    equity *= 1 + r
    peak = Math.max(peak, equity)
    worst = Math.min(worst, equity / peak - 1)
  }
  return worst
}

/**
 * Historical value-at-risk: the loss exceeded on only (1 - confidence) of past
 * days, as a positive fraction. No distribution is assumed.
 */
export function historicalVaR(returns: readonly number[], confidence = 0.95): number | null {
  if (returns.length < MIN_OBS) return null
  const sorted = [...returns].sort((a, b) => a - b)
  const idx = Math.max(0, Math.floor((1 - confidence) * sorted.length) - 0)
  const q = sorted[Math.min(sorted.length - 1, idx)]
  return q < 0 ? -q : 0
}

// ── Portfolio ────────────────────────────────────────────────────────────────

export interface RiskInput {
  symbol: string
  /** Current market value in the portfolio's currency (may be negative for a short). */
  value:  number
  closes: Series
}

export interface PositionRisk {
  symbol:  string
  weight:  number          // share of gross exposure, signed
  vol:     number | null   // annualised
  beta:    number | null
  /** Share of total portfolio variance this position contributes (sums to 1). */
  riskShare: number | null
}

export interface PortfolioRisk {
  observations: number
  from:         string
  to:           string
  positions:    PositionRisk[]
  vol:          number | null
  beta:         number | null
  maxDrawdown:  number
  var95:        number | null       // 1-day, fraction of portfolio value
  /** Weighted average of position vols ÷ portfolio vol. 1 = no diversification benefit. */
  diversification: number | null
  correlation:  { symbols: string[]; matrix: (number | null)[][] }
  /** Portfolio's daily returns over the window (for charts). */
  returns:      number[]
}

/** Returns null when there is not enough overlapping history to measure anything. */
export function portfolioRisk(inputs: readonly RiskInput[], benchmark: Series): PortfolioRisk | null {
  const usable = inputs.filter(i => i.closes.size > MIN_OBS && Number.isFinite(i.value) && i.value !== 0)
  if (!usable.length) return null

  const dates = commonDates([...usable.map(u => u.closes), benchmark])
  if (dates.length < MIN_OBS + 1) return null

  const gross = usable.reduce((a, u) => a + Math.abs(u.value), 0)
  const weights = usable.map(u => u.value / gross)
  const rets = usable.map(u => returnsOn(u.closes, dates))
  const bench = returnsOn(benchmark, dates)
  const n = bench.length

  // Constant-weight portfolio return each day.
  const port: number[] = []
  for (let t = 0; t < n; t++) {
    let r = 0
    for (let i = 0; i < usable.length; i++) r += weights[i] * rets[i][t]
    port.push(r)
  }

  const portVar = (() => { const s = stdev(port); return s === null ? null : s * s })()
  const vols = rets.map(annualVol)

  const positions: PositionRisk[] = usable.map((u, i) => {
    const cov = covariance(rets[i], port)
    return {
      symbol:    u.symbol,
      weight:    weights[i],
      vol:       vols[i],
      beta:      beta(rets[i], bench),
      riskShare: cov !== null && portVar ? (weights[i] * cov) / portVar : null,
    }
  })

  const pVol = annualVol(port)
  const weightedVol = vols.every(v => v !== null) ? vols.reduce<number>((a, v, i) => a + Math.abs(weights[i]) * (v as number), 0) : null

  return {
    observations: n,
    from: dates[0],
    to:   dates[dates.length - 1],
    positions,
    vol:  pVol,
    beta: beta(port, bench),
    maxDrawdown: maxDrawdown(port),
    var95: historicalVaR(port, 0.95),
    diversification: weightedVol !== null && pVol ? weightedVol / pVol : null,
    correlation: {
      symbols: usable.map(u => u.symbol),
      matrix:  rets.map((a, i) => rets.map((b, j) => (i === j ? 1 : correlation(a, b)))),
    },
    returns: port,
  }
}

// ── Seasonality ──────────────────────────────────────────────────────────────

export interface MonthStat {
  month:     number          // 1–12
  years:     number          // how many years contributed
  avgPct:    number | null
  medianPct: number | null
  winRate:   number | null   // share of years the month closed higher
  bestPct:   number | null
  worstPct:  number | null
}

export interface Seasonality {
  months: MonthStat[]
  /** year → 12 monthly returns in percent (null where there is no data). */
  grid:   Array<{ year: number; returns: (number | null)[] }>
  firstYear: number
  lastYear:  number
}

const median = (x: number[]): number => {
  const s = [...x].sort((a, b) => a - b), m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Calendar-month seasonality from month-end closes. `closes` is ordered oldest
 * first; each entry is the close of one calendar month.
 * The current, unfinished month is excluded so a partial month cannot skew it.
 */
export function seasonality(monthly: ReadonlyArray<{ time: number; close: number }>, now: Date = new Date()): Seasonality | null {
  const clean = monthly.filter(m => Number.isFinite(m.close) && m.close > 0).sort((a, b) => a.time - b.time)
  if (clean.length < 25) return null

  // Monthly bars are stamped at the start of the month in the EXCHANGE's
  // timezone. For markets ahead of UTC (India, Japan…) that instant falls on
  // the last day of the previous month in UTC, which would shift every bar one
  // month back. Exchange offsets span UTC-12…UTC+14, so adding 14 hours moves
  // every month-start stamp onto day 1 or 2 of the correct month.
  const stamp = (t: number) => new Date(t * 1000 + 14 * 3_600_000)

  const curKey = now.getUTCFullYear() * 12 + now.getUTCMonth()
  const byYear = new Map<number, (number | null)[]>()
  const perMonth: number[][] = Array.from({ length: 12 }, () => [])

  for (let i = 1; i < clean.length; i++) {
    const d = stamp(clean[i].time)
    const year = d.getUTCFullYear(), month = d.getUTCMonth()
    if (year * 12 + month >= curKey) continue
    const prev = stamp(clean[i - 1].time)
    // Only consecutive months form a monthly return (skip gaps in the data).
    if (year * 12 + month - (prev.getUTCFullYear() * 12 + prev.getUTCMonth()) !== 1) continue
    const pct = (clean[i].close / clean[i - 1].close - 1) * 100
    if (!byYear.has(year)) byYear.set(year, new Array<number | null>(12).fill(null))
    byYear.get(year)![month] = pct
    perMonth[month].push(pct)
  }

  const years = [...byYear.keys()].sort((a, b) => a - b)
  if (!years.length) return null

  return {
    months: perMonth.map((v, i) => ({
      month:     i + 1,
      years:     v.length,
      avgPct:    v.length ? mean(v) : null,
      medianPct: v.length ? median(v) : null,
      winRate:   v.length ? v.filter(x => x > 0).length / v.length : null,
      bestPct:   v.length ? Math.max(...v) : null,
      worstPct:  v.length ? Math.min(...v) : null,
    })),
    grid: years.map(year => ({ year, returns: byYear.get(year)! })),
    firstYear: years[0],
    lastYear:  years[years.length - 1],
  }
}
