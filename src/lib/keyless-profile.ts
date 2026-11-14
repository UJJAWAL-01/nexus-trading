// src/lib/keyless-profile.ts
// Company profile and key ratios with no API key: built from SEC annual
// filings (via /api/fundamentals) plus price history. Pure, unit-tested.
//
// Output uses the same field names the Stock Profile panel already reads, so
// the panel renders either source. Differences worth knowing:
//   • Ratios use the latest FISCAL YEAR, not trailing twelve months.
//   • Market cap = latest reported share count × current price (approximate
//     when the share count has changed since the filing).
//   • Dividend yield and debt/equity are not derived (no clean keyless source);
//     they are left undefined rather than guessed.

import { beta as betaOf } from '@/lib/risk'

export interface ProfilePeriod {
  fiscalYear: number
  periodType: string
  metrics:    Record<string, number | null | undefined>
  computed:   Record<string, number | null | undefined>
}

export interface ProfileSource {
  ticker:  string
  company: { name?: string | null; sector?: string | null; industry?: string | null; country?: string | null; currency?: string | null }
  periods: ProfilePeriod[]
}

export interface KeylessProfile {
  profile: {
    name: string; ticker: string; finnhubIndustry?: string; country?: string; currency?: string
    marketCapitalization?: number      // millions
    shareOutstanding?: number          // millions
  }
  metric: {
    peTTM?: number; beta?: number; '52WeekHigh'?: number; '52WeekLow'?: number; epsTTM?: number
    roeTTM?: number; revenueGrowthTTMYoy?: number; grossMarginTTM?: number
    operatingMarginTTM?: number; netProfitMarginTTM?: number; priceToBookTTM?: number
  }
  fiscalYear: number | null
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const pct = (v: unknown): number | undefined => { const n = num(v); return n === undefined ? undefined : n * 100 }

export interface PriceContext {
  price:   number | null
  /** About one year of daily closes, oldest first. */
  closes:  readonly number[]
  /** Daily returns of the stock and the benchmark on the same dates (optional). */
  returns?:   readonly number[]
  benchmark?: readonly number[]
}

/** Null when the filings carry no company name (nothing worth showing). */
export function buildKeylessProfile(src: ProfileSource | null | undefined, px: PriceContext): KeylessProfile | null {
  const name = src?.company?.name
  if (!src || !name) return null

  const annual = (src.periods ?? []).filter(p => p.periodType === 'annual').sort((a, b) => b.fiscalYear - a.fiscalYear)
  const latest = annual[0], prior = annual[1]
  const m = latest?.metrics ?? {}, c = latest?.computed ?? {}

  const price  = num(px.price) && px.price! > 0 ? px.price! : undefined
  const shares = num(m.CommonStockSharesOutstanding)
  const eps    = num(m.EarningsPerShareDiluted)
  const equity = num(m.StockholdersEquity)
  const cap    = price !== undefined && shares !== undefined && shares > 0 ? price * shares : undefined

  const rev = num(c.Revenue), prevRev = num(prior?.computed?.Revenue)
  const closes = px.closes.filter(x => Number.isFinite(x) && x > 0)
  const withNow = price !== undefined ? [...closes, price] : closes
  const b = px.returns && px.benchmark && px.returns.length >= 60 ? betaOf(px.returns, px.benchmark) : null

  return {
    profile: {
      name,
      ticker: src.ticker,
      finnhubIndustry: src.company.industry ?? src.company.sector ?? undefined,
      country:  src.company.country ?? undefined,
      currency: src.company.currency ?? undefined,
      marketCapitalization: cap !== undefined ? cap / 1e6 : undefined,
      shareOutstanding:     shares !== undefined && shares > 0 ? shares / 1e6 : undefined,
    },
    metric: {
      // A P/E on negative earnings is meaningless, so it is left out.
      peTTM:  price !== undefined && eps !== undefined && eps > 0 ? price / eps : undefined,
      epsTTM: eps,
      beta:   b ?? undefined,
      '52WeekHigh': withNow.length >= 20 ? Math.max(...withNow) : undefined,
      '52WeekLow':  withNow.length >= 20 ? Math.min(...withNow) : undefined,
      // Return on negative equity is not a return; skip it.
      roeTTM: equity !== undefined && equity > 0 ? pct(c.ROE) : undefined,
      revenueGrowthTTMYoy: rev !== undefined && prevRev !== undefined && prevRev > 0 && prior!.fiscalYear === latest!.fiscalYear - 1
        ? (rev / prevRev - 1) * 100 : undefined,
      grossMarginTTM:     pct(c.GrossMargin),
      operatingMarginTTM: pct(c.OperatingMargin),
      netProfitMarginTTM: pct(c.NetMargin),
      priceToBookTTM: cap !== undefined && equity !== undefined && equity > 0 ? cap / equity : undefined,
    },
    fiscalYear: latest?.fiscalYear ?? null,
  }
}
