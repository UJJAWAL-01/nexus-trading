import { describe, it, expect } from 'vitest'
import {
  annualVol, beta, commonDates, correlation, historicalVaR, maxDrawdown, portfolioRisk,
  isSpike, returnsOn, seasonality, stdev, TRADING_DAYS, type Series,
} from '@/lib/risk'

const day = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
const series = (closes: number[], skip: number[] = []): Series => {
  const m = new Map<string, number>()
  closes.forEach((c, i) => { if (!skip.includes(i)) m.set(day(i), c) })
  return m
}
// Deterministic pseudo-random walk.
const walk = (n: number, seed: number, drift = 0.0004, vol = 0.012): number[] => {
  let s = seed, p = 100
  const out = [p]
  for (let i = 1; i < n; i++) {
    s = (s * 1664525 + 1013904223) % 4294967296
    const u = s / 4294967296 - 0.5
    p *= 1 + drift + u * vol * 2
    out.push(p)
  }
  return out
}

describe('risk primitives', () => {
  it('standard deviation and annualised volatility', () => {
    expect(stdev([1, 1, 1, 1])).toBe(0)
    expect(stdev([1])).toBeNull()
    expect(annualVol([0.01, -0.01, 0.01, -0.01])!).toBeCloseTo(0.011547 * Math.sqrt(TRADING_DAYS), 3)
  })
  it('correlation is 1 for identical, -1 for mirrored, null for a flat series', () => {
    const a = [0.01, -0.02, 0.03, 0.005, -0.01]
    expect(correlation(a, a)).toBeCloseTo(1, 10)
    expect(correlation(a, a.map(x => -x))).toBeCloseTo(-1, 10)
    expect(correlation(a, [0, 0, 0, 0, 0])).toBeNull()
  })
  it('beta scales with leverage to the benchmark', () => {
    const b = [0.01, -0.02, 0.03, 0.005, -0.01, 0.02]
    expect(beta(b, b)).toBeCloseTo(1, 10)
    expect(beta(b.map(x => 2 * x), b)).toBeCloseTo(2, 10)
    expect(beta(b.map(x => -0.5 * x), b)).toBeCloseTo(-0.5, 10)
  })
  it('max drawdown measures the worst peak-to-trough fall', () => {
    expect(maxDrawdown([0.1, 0.1, -0.5, 0.2])).toBeCloseTo(-0.5, 10)
    expect(maxDrawdown([0.01, 0.02, 0.03])).toBe(0)
    expect(maxDrawdown([])).toBe(0)
  })
  it('historical VaR is the loss exceeded on 5% of days', () => {
    const r = Array.from({ length: 100 }, (_, i) => (i - 50) / 1000)   // -5.0% … +4.9%
    expect(historicalVaR(r, 0.95)).toBeCloseTo(0.045, 10)
    expect(historicalVaR([0.01, 0.02])).toBeNull()                     // too few observations
    expect(historicalVaR(Array.from({ length: 60 }, () => 0.001))).toBe(0)
  })
  it('aligns series on shared dates only', () => {
    const a = series([1, 2, 3, 4, 5]), b = series([1, 2, 3, 4, 5], [2])
    expect(commonDates([a, b])).toEqual([day(0), day(1), day(3), day(4)])
    expect(returnsOn(a, commonDates([a, b]))).toEqual([1, 1, 0.25])
  })
})

describe('portfolio risk', () => {
  const bench = series(walk(260, 7))
  const a = series(walk(260, 11)), b = series(walk(260, 23))

  it('returns null without enough overlapping history', () => {
    expect(portfolioRisk([], bench)).toBeNull()
    expect(portfolioRisk([{ symbol: 'A', value: 100, closes: series(walk(10, 1)) }], bench)).toBeNull()
  })
  it('a portfolio that IS the benchmark has beta 1 and identical volatility', () => {
    const r = portfolioRisk([{ symbol: 'SPY', value: 1000, closes: bench }], bench)!
    expect(r.beta).toBeCloseTo(1, 8)
    expect(r.positions[0].weight).toBe(1)
    expect(r.positions[0].riskShare).toBeCloseTo(1, 8)
    expect(r.diversification).toBeCloseTo(1, 8)
  })
  it('weights sum to 1 and risk shares sum to 1', () => {
    const r = portfolioRisk([{ symbol: 'A', value: 3000, closes: a }, { symbol: 'B', value: 1000, closes: b }], bench)!
    expect(r.positions.map(p => p.weight)).toEqual([0.75, 0.25])
    expect(r.positions.reduce((s, p) => s + (p.riskShare ?? 0), 0)).toBeCloseTo(1, 8)
  })
  it('diversifying across imperfectly correlated assets lowers volatility', () => {
    const r = portfolioRisk([{ symbol: 'A', value: 1000, closes: a }, { symbol: 'B', value: 1000, closes: b }], bench)!
    const va = r.positions[0].vol!, vb = r.positions[1].vol!
    expect(r.vol!).toBeLessThan((va + vb) / 2)
    expect(r.diversification!).toBeGreaterThan(1)
  })
  it('builds a symmetric correlation matrix with a unit diagonal', () => {
    const r = portfolioRisk([{ symbol: 'A', value: 1, closes: a }, { symbol: 'B', value: 1, closes: b }], bench)!
    const m = r.correlation.matrix
    expect(m[0][0]).toBe(1)
    expect(m[1][1]).toBe(1)
    expect(m[0][1]).toBeCloseTo(m[1][0]!, 12)
    expect(Math.abs(m[0][1]!)).toBeLessThanOrEqual(1)
  })
  it('ignores zero-value and non-finite positions', () => {
    const r = portfolioRisk([{ symbol: 'A', value: 100, closes: a }, { symbol: 'Z', value: 0, closes: b }, { symbol: 'N', value: NaN, closes: b }], bench)!
    expect(r.positions.map(p => p.symbol)).toEqual(['A'])
  })
  it('never reports NaN', () => {
    const r = portfolioRisk([{ symbol: 'A', value: 1, closes: a }, { symbol: 'B', value: -1, closes: b }], bench)!
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
  })
})

describe('seasonality', () => {
  // 6 full years of month-end closes; every January +10%, every other month flat.
  const monthly: Array<{ time: number; close: number }> = []
  let p = 100
  for (let y = 2019; y <= 2025; y++) for (let m = 0; m < 12; m++) {
    if (m === 0 && y > 2019) p *= 1.1
    monthly.push({ time: Date.UTC(y, m, 28) / 1000, close: p })
  }
  const now = new Date(Date.UTC(2026, 5, 15))

  it('needs at least two years of data', () => {
    expect(seasonality(monthly.slice(0, 10), now)).toBeNull()
  })
  it('finds the January effect built into the data', () => {
    const s = seasonality(monthly, now)!
    expect(s.months[0].avgPct).toBeCloseTo(10, 8)
    expect(s.months[0].winRate).toBe(1)
    expect(s.months[0].years).toBe(6)
    expect(s.months[5].avgPct).toBeCloseTo(0, 8)
    expect(s.months[5].winRate).toBe(0)
  })
  it('excludes the current unfinished month', () => {
    const withPartial = [...monthly, { time: Date.UTC(2026, 5, 10) / 1000, close: p * 5 }]
    const s = seasonality(withPartial, now)!
    expect(s.months[5].bestPct).toBeCloseTo(0, 8)
  })
  it('skips returns that span a gap in the data', () => {
    const gappy = monthly.filter((_, i) => i !== 30)           // drop one month
    const s = seasonality(gappy, now)!
    const total = s.months.reduce((a, m) => a + m.years, 0)
    expect(total).toBe(monthly.length - 1 - 2)                  // two returns lost, not one bogus 2-month return
  })
  it('assigns bars stamped in a timezone ahead of UTC to the right month', () => {
    // India-style stamps: month start at 00:00 IST = 18:30 UTC on the previous day.
    const ist: Array<{ time: number; close: number }> = []
    let q = 100
    for (let y = 2019; y <= 2025; y++) for (let m = 0; m < 12; m++) {
      if (m === 0 && y > 2019) q *= 1.1                       // January bar closes +10%
      ist.push({ time: (Date.UTC(y, m, 1) - 5.5 * 3_600_000) / 1000, close: q })
    }
    const s = seasonality(ist, now)!
    expect(s.months[0].avgPct).toBeCloseTo(10, 8)             // January, not December
    expect(s.months[11].avgPct).toBeCloseTo(0, 8)
  })
  it('rejects quarterly bars instead of reporting them as monthly returns', () => {
    const quarterly = Array.from({ length: 60 }, (_, i) => ({ time: Date.UTC(2010 + Math.floor(i / 4), (i % 4) * 3, 1) / 1000, close: 100 + i }))
    expect(seasonality(quarterly, now)).toBeNull()
  })
  it('discards an isolated bad print but keeps real crashes and squeezes', () => {
    expect(isSpike(12.9, 25.9, 11.3)).toBe(true)              // doubles then halves straight back
    expect(isSpike(100, 48, 97)).toBe(true)                   // halves then doubles straight back
    expect(isSpike(18.8, 325, 101)).toBe(false)               // real squeeze: did not come back
    expect(isSpike(100, 60, 55)).toBe(false)                  // real crash: stayed down
    expect(isSpike(100, 130, 100)).toBe(false)                // an ordinary volatile month
    expect(isSpike(0, 10, 10)).toBe(false)

    const bad = monthly.map((m, i) => (i === 40 ? { ...m, close: m.close * 2.1 } : m))
    const s = seasonality(bad, now)!
    expect(s.suspectBars).toBe(1)
    const worst = Math.min(...s.months.map(m => m.worstPct ?? 0))
    const best  = Math.max(...s.months.map(m => m.bestPct ?? 0))
    expect(worst).toBeGreaterThan(-1)                          // no phantom −52% month
    expect(best).toBeLessThan(11)                              // no phantom +110% month
    expect(seasonality(monthly, now)!.suspectBars).toBe(0)
  })
  it('lays out a year-by-month grid', () => {
    const s = seasonality(monthly, now)!
    expect(s.firstYear).toBe(2019)
    expect(s.lastYear).toBe(2025)
    expect(s.grid[0].returns[0]).toBeNull()                    // no prior month for the very first point
    expect(s.grid[1].returns[0]).toBeCloseTo(10, 8)
  })
})
