import { describe, it, expect } from 'vitest'
import { buildKeylessProfile, type ProfileSource } from '@/lib/keyless-profile'

const period = (fiscalYear: number, revenue: number, over: Record<string, number | null> = {}, periodType = 'annual') => ({
  fiscalYear, periodType,
  metrics:  { CommonStockSharesOutstanding: 1_000_000_000, EarningsPerShareDiluted: 5, StockholdersEquity: 20_000_000_000, ...over },
  computed: { Revenue: revenue, GrossMargin: 0.4, OperatingMargin: 0.25, NetMargin: 0.2, ROE: 0.25 },
})
const src = (periods = [period(2025, 120e9), period(2024, 100e9)]): ProfileSource => ({
  ticker: 'TEST',
  company: { name: 'Test Corp', sector: 'Technology', industry: 'Software', country: 'US', currency: 'USD' },
  periods,
})
const closes = Array.from({ length: 250 }, (_, i) => 80 + (i % 50))     // 80 … 129

describe('keyless stock profile', () => {
  it('returns null without a company name', () => {
    expect(buildKeylessProfile(null, { price: 100, closes })).toBeNull()
    expect(buildKeylessProfile({ ...src(), company: {} }, { price: 100, closes })).toBeNull()
  })

  it('derives valuation from filings and price', () => {
    const p = buildKeylessProfile(src(), { price: 100, closes })!
    expect(p.profile).toMatchObject({ name: 'Test Corp', ticker: 'TEST', finnhubIndustry: 'Software', country: 'US' })
    expect(p.profile.marketCapitalization).toBe(100_000)          // $100bn in millions
    expect(p.profile.shareOutstanding).toBe(1000)
    expect(p.metric.peTTM).toBe(20)
    expect(p.metric.epsTTM).toBe(5)
    expect(p.metric.priceToBookTTM).toBe(5)
    expect(p.metric.roeTTM).toBe(25)
    expect(p.metric.grossMarginTTM).toBe(40)
    expect(p.metric.revenueGrowthTTMYoy).toBeCloseTo(20, 10)
    expect(p.fiscalYear).toBe(2025)
  })

  it('takes the 52-week range from history, including today', () => {
    const p = buildKeylessProfile(src(), { price: 140, closes })!
    expect(p.metric['52WeekHigh']).toBe(140)
    expect(p.metric['52WeekLow']).toBe(80)
    expect(buildKeylessProfile(src(), { price: 100, closes: [1, 2, 3] })!.metric['52WeekHigh']).toBeUndefined()
  })

  it('uses the newest annual period even when periods arrive unordered or mixed', () => {
    const p = buildKeylessProfile(src([period(2023, 90e9), period(2026, 999e9, {}, 'quarterly'), period(2025, 120e9), period(2024, 100e9)]), { price: 100, closes })!
    expect(p.fiscalYear).toBe(2025)
    expect(p.metric.revenueGrowthTTMYoy).toBeCloseTo(20, 10)
  })

  it('leaves out ratios it cannot justify', () => {
    const losing = buildKeylessProfile(src([period(2025, 120e9, { EarningsPerShareDiluted: -2, StockholdersEquity: -5e9 })]), { price: 100, closes })!
    expect(losing.metric.peTTM).toBeUndefined()                  // negative earnings
    expect(losing.metric.priceToBookTTM).toBeUndefined()         // negative equity
    expect(losing.metric.roeTTM).toBeUndefined()
    expect(losing.metric.revenueGrowthTTMYoy).toBeUndefined()    // no prior year

    const gap = buildKeylessProfile(src([period(2025, 120e9), period(2022, 60e9)]), { price: 100, closes })!
    expect(gap.metric.revenueGrowthTTMYoy).toBeUndefined()       // not consecutive years

    const noPrice = buildKeylessProfile(src(), { price: null, closes })!
    expect(noPrice.profile.marketCapitalization).toBeUndefined()
    expect(noPrice.metric.peTTM).toBeUndefined()
    expect(noPrice.metric.grossMarginTTM).toBe(40)               // filing-only figures still shown
  })

  it('computes beta only with enough paired returns', () => {
    const bench = Array.from({ length: 100 }, (_, i) => Math.sin(i) / 100)
    const p = buildKeylessProfile(src(), { price: 100, closes, returns: bench.map(x => 1.5 * x), benchmark: bench })!
    expect(p.metric.beta).toBeCloseTo(1.5, 8)
    expect(buildKeylessProfile(src(), { price: 100, closes, returns: [0.01], benchmark: [0.01] })!.metric.beta).toBeUndefined()
  })

  it('never emits NaN or Infinity', () => {
    const odd = buildKeylessProfile(src([period(2025, 0, { CommonStockSharesOutstanding: 0, EarningsPerShareDiluted: 0, StockholdersEquity: 0 }), period(2024, 0)]), { price: 100, closes: [NaN, 0, -5] })!
    expect(JSON.stringify(odd)).not.toMatch(/NaN|Infinity/)
  })
})
