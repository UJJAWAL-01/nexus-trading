import { describe, it, expect } from 'vitest'
import {
  conditionMet, describeFired, evaluateRules, sanitizeRule, type PriceAlertRule,
} from '@/lib/price-alerts'
import { quadrantOf, rankRotation, relativeRotation, MOMENTUM_DAYS, TREND_DAYS } from '@/lib/rotation'
import {
  analysePayoff, buildTemplate, netDebit, payoffAtExpiry, payoffBeforeExpiry, payoffCurve,
  probabilityOfProfit, strikeStep, TEMPLATES, type Leg, type TemplateId,
} from '@/lib/payoff'
import type { Series } from '@/lib/risk'

// ── Price alerts ─────────────────────────────────────────────────────────────

const rule = (over: Partial<PriceAlertRule> = {}): PriceAlertRule => ({
  id: 'r1', symbol: 'AAPL', kind: 'above', value: 200, note: '', repeat: false,
  armed: true, createdAt: 0, firedAt: null, firedPrice: null, ...over,
})

describe('price alerts', () => {
  it('validates untrusted input', () => {
    expect(sanitizeRule({ symbol: ' aapl ', kind: 'above', value: '200.5' })).toEqual({ symbol: 'AAPL', kind: 'above', value: 200.5, note: '', repeat: false })
    expect(sanitizeRule({ symbol: 'AAPL', kind: 'above', value: 0 })).toBeNull()
    expect(sanitizeRule({ symbol: 'AAPL', kind: 'above', value: NaN })).toBeNull()
    expect(sanitizeRule({ symbol: 'AAPL', kind: 'sideways', value: 5 })).toBeNull()
    expect(sanitizeRule({ symbol: 'A B<script>', kind: 'above', value: 5 })).toBeNull()
    expect(sanitizeRule({ symbol: 'AAPL', kind: 'pct-up', value: 250 })).toBeNull()
    expect(sanitizeRule({ symbol: 42, kind: 'above', value: 5 })).toBeNull()
    expect(sanitizeRule({ symbol: 'AAPL', kind: 'below', value: 5, note: 'x'.repeat(500) })!.note).toHaveLength(80)
  })

  it('judges each kind of condition and refuses to guess without data', () => {
    expect(conditionMet({ kind: 'above', value: 200 }, { price: 200, change: 0 })).toBe(true)
    expect(conditionMet({ kind: 'above', value: 200 }, { price: 199.99, change: 0 })).toBe(false)
    expect(conditionMet({ kind: 'below', value: 200 }, { price: 199, change: 0 })).toBe(true)
    expect(conditionMet({ kind: 'pct-up', value: 3 }, { price: 10, change: 3.2 })).toBe(true)
    expect(conditionMet({ kind: 'pct-down', value: 3 }, { price: 10, change: -2.9 })).toBe(false)
    expect(conditionMet({ kind: 'pct-down', value: 3 }, { price: 10, change: -3 })).toBe(true)
    expect(conditionMet({ kind: 'above', value: 200 }, undefined)).toBeNull()
    expect(conditionMet({ kind: 'above', value: 200 }, { price: null, change: 1 })).toBeNull()
    expect(conditionMet({ kind: 'below', value: 200 }, { price: 0, change: 1 })).toBeNull()   // a zero price is a bad tick, not a crash
    expect(conditionMet({ kind: 'pct-up', value: 3 }, { price: 10, change: null })).toBeNull()
  })

  it('fires once and then stays quiet', () => {
    const first = evaluateRules([rule()], { AAPL: { price: 201, change: 1 } }, 1000)
    expect(first.fired).toHaveLength(1)
    expect(first.fired[0]).toMatchObject({ symbol: 'AAPL', price: 201, at: 1000 })
    expect(first.rules[0]).toMatchObject({ armed: false, firedAt: 1000, firedPrice: 201 })
    const second = evaluateRules(first.rules, { AAPL: { price: 205, change: 2 } }, 2000)
    expect(second.fired).toHaveLength(0)
    expect(second.rules).toBe(first.rules)
  })

  it('returns the same array when nothing changes', () => {
    const rules = [rule()]
    expect(evaluateRules(rules, { AAPL: { price: 150, change: 0 } }).rules).toBe(rules)
    expect(evaluateRules(rules, {}).rules).toBe(rules)
  })

  it('re-arms a repeating rule only after the condition clears', () => {
    let state = evaluateRules([rule({ repeat: true })], { AAPL: { price: 201, change: 0 } }, 1)
    expect(state.fired).toHaveLength(1)
    state = evaluateRules(state.rules, { AAPL: { price: 202, change: 0 } }, 2)   // still above: silent
    expect(state.fired).toHaveLength(0)
    expect(state.rules[0].armed).toBe(false)
    state = evaluateRules(state.rules, { AAPL: { price: 198, change: 0 } }, 3)   // cleared: re-armed
    expect(state.rules[0].armed).toBe(true)
    state = evaluateRules(state.rules, { AAPL: { price: 200, change: 0 } }, 4)   // crossed again
    expect(state.fired).toHaveLength(1)
  })

  it('a one-shot rule never re-arms by itself', () => {
    const fired = evaluateRules([rule()], { AAPL: { price: 201, change: 0 } }, 1)
    const after = evaluateRules(fired.rules, { AAPL: { price: 100, change: 0 } }, 2)
    expect(after.rules[0].armed).toBe(false)
  })

  it('evaluates rules for different symbols independently', () => {
    const rules = [rule(), rule({ id: 'r2', symbol: 'MSFT', kind: 'pct-down', value: 2 })]
    const out = evaluateRules(rules, { AAPL: { price: 100, change: 0 }, MSFT: { price: 400, change: -2.5 } }, 9)
    expect(out.fired.map(f => f.symbol)).toEqual(['MSFT'])
    expect(out.rules[0]).toBe(rules[0])
  })

  it('writes a readable message', () => {
    const { fired } = evaluateRules([rule({ note: 'trim position' })], { AAPL: { price: 201.5, change: 1.25 } }, 1)
    const msg = describeFired(fired[0])
    expect(msg.title).toBe('AAPL reached 200')
    expect(msg.body).toContain('+1.25% today')
    expect(msg.body).toContain('trim position')
  })
})

// ── Relative rotation ────────────────────────────────────────────────────────

const day = (i: number) => new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10)
const toSeries = (closes: number[]): Series => new Map(closes.map((c, i) => [day(i), c]))
const N = 160
const flat = toSeries(Array.from({ length: N }, () => 100))
// Flat until `from`, then compounding at `rate` per day.
const bend = (from: number, rate: number, until = N) => {
  let p = 100
  return toSeries(Array.from({ length: N }, (_, i) => { if (i >= from && i < until) p *= 1 + rate; return p }))
}

describe('relative rotation', () => {
  it('names the four quadrants', () => {
    expect(quadrantOf(1, 1)).toBe('leading')
    expect(quadrantOf(1, -1)).toBe('weakening')
    expect(quadrantOf(-1, -1)).toBe('lagging')
    expect(quadrantOf(-1, 1)).toBe('improving')
  })
  it('needs enough shared history', () => {
    const short = toSeries(Array.from({ length: TREND_DAYS + MOMENTUM_DAYS - 1 }, () => 100))
    expect(relativeRotation('X', short, flat)).toBeNull()
    expect(relativeRotation('X', new Map(), flat)).toBeNull()
  })
  it('a symbol identical to the benchmark has no relative strength', () => {
    const r = relativeRotation('SPY', flat, flat)!
    expect(r.strength).toBeCloseTo(0, 10)
    expect(r.momentum).toBeCloseTo(0, 10)
    expect(r.relative.m1).toBeCloseTo(0, 10)
  })
  it('a fresh breakout against the benchmark is leading', () => {
    const r = relativeRotation('UP', bend(N - 20, 0.005), flat)!
    expect(r.strength).toBeGreaterThan(0)
    expect(r.momentum).toBeGreaterThan(0)
    expect(r.quadrant).toBe('leading')
    expect(r.relative.m1!).toBeGreaterThan(0)
  })
  it('a fresh breakdown is lagging', () => {
    expect(relativeRotation('DN', bend(N - 20, -0.005), flat)!.quadrant).toBe('lagging')
  })
  it('a rally that has stalled is weakening', () => {
    const r = relativeRotation('STALL', bend(N - 45, 0.005, N - 12), flat)!
    expect(r.strength).toBeGreaterThan(0)
    expect(r.momentum).toBeLessThan(0)
    expect(r.quadrant).toBe('weakening')
  })
  it('a sell-off that has stalled is improving', () => {
    expect(relativeRotation('BASE', bend(N - 45, -0.005, N - 12), flat)!.quadrant).toBe('improving')
  })
  it('measures strength against the benchmark, not in absolute terms', () => {
    // Symbol and benchmark both rise at the same rate: no relative edge.
    const both = bend(0, 0.003)
    expect(relativeRotation('SAME', both, both)!.strength).toBeCloseTo(0, 8)
    // Symbol flat while the benchmark rallies: lagging despite not falling.
    expect(relativeRotation('FLAT', flat, bend(N - 20, 0.005))!.quadrant).toBe('lagging')
  })
  it('gives a trail that ends at the current reading and reports relative returns', () => {
    const r = relativeRotation('UP', bend(N - 20, 0.005), flat)!
    expect(r.trail.length).toBeGreaterThan(1)
    expect(r.trail[r.trail.length - 1]).toMatchObject({ strength: r.strength, momentum: r.momentum })
    expect(r.absolute.w1).toBeCloseTo((1.005 ** 5 - 1) * 100, 8)
    expect(r.relative.w1).toBeCloseTo(r.absolute.w1!, 8)       // benchmark is flat
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/)
  })
  it('ranks leaders first', () => {
    const rows = [
      relativeRotation('DN', bend(N - 20, -0.005), flat)!,
      relativeRotation('UP', bend(N - 20, 0.005), flat)!,
      relativeRotation('BASE', bend(N - 45, -0.005, N - 12), flat)!,
    ]
    expect(rankRotation(rows).map(r => r.symbol)).toEqual(['UP', 'BASE', 'DN'])
  })
})

// ── Options payoff ───────────────────────────────────────────────────────────

const L = (type: Leg['type'], side: Leg['side'], strike: number, premium: number, qty = 1): Leg => ({ type, side, strike, premium, qty })

describe('options payoff', () => {
  it('long call: limited loss, unlimited profit, one break-even', () => {
    const legs = [L('call', 'long', 100, 5)]
    expect(payoffAtExpiry(legs, 90)).toBe(-5)
    expect(payoffAtExpiry(legs, 120)).toBe(15)
    const a = analysePayoff(legs)!
    expect(a.breakevens).toEqual([105])
    expect(a.maxLoss).toBe(-5)
    expect(a.maxProfit).toBeNull()
    expect(a.netDebit).toBe(5)
    expect(a.profitZones).toEqual([{ lo: 105, hi: null }])
  })
  it('naked short call has unlimited loss', () => {
    const a = analysePayoff([L('call', 'short', 100, 5)])!
    expect(a.maxLoss).toBeNull()
    expect(a.maxProfit).toBe(5)
    expect(a.netDebit).toBe(-5)
  })
  it('long put: profit is capped because price cannot go below zero', () => {
    const a = analysePayoff([L('put', 'long', 100, 4)])!
    expect(a.breakevens).toEqual([96])
    expect(a.maxProfit).toBe(96)
    expect(a.maxLoss).toBe(-4)
    expect(a.profitZones).toEqual([{ lo: 0, hi: 96 }])
  })
  it('long straddle has two break-evens around the strike', () => {
    const a = analysePayoff([L('call', 'long', 100, 4), L('put', 'long', 100, 3)])!
    expect(a.breakevens).toEqual([93, 107])
    expect(a.maxLoss).toBe(-7)
    expect(a.maxProfit).toBeNull()
    expect(a.profitZones).toEqual([{ lo: 0, hi: 93 }, { lo: 107, hi: null }])
  })
  it('iron condor: profit and loss are both capped', () => {
    const a = analysePayoff([L('put', 'long', 90, 1), L('put', 'short', 95, 2), L('call', 'short', 105, 2), L('call', 'long', 110, 1)])!
    expect(a.netDebit).toBe(-2)
    expect(a.maxProfit).toBeCloseTo(2, 10)
    expect(a.maxLoss).toBeCloseTo(-3, 10)
    expect(a.breakevens[0]).toBeCloseTo(93, 10)
    expect(a.breakevens[1]).toBeCloseTo(107, 10)
    expect(a.profitZones).toHaveLength(1)
  })
  it('call butterfly peaks at the middle strike', () => {
    const legs = [L('call', 'long', 95, 6), L('call', 'short', 100, 3, 2), L('call', 'long', 105, 1)]
    const a = analysePayoff(legs)!
    expect(a.netDebit).toBe(1)
    expect(a.maxProfit).toBeCloseTo(4, 10)
    expect(a.maxLoss).toBeCloseTo(-1, 10)
    expect(a.breakevens[0]).toBeCloseTo(96, 10)
    expect(a.breakevens[1]).toBeCloseTo(104, 10)
    expect(payoffAtExpiry(legs, 100)).toBeCloseTo(4, 10)
  })
  it('covered call: stock plus a short call', () => {
    const a = analysePayoff([L('stock', 'long', 100, 0), L('call', 'short', 110, 2)])!
    expect(a.maxProfit).toBeCloseTo(12, 10)
    expect(a.maxLoss).toBeCloseTo(-98, 10)
    expect(a.breakevens[0]).toBeCloseTo(98, 10)
    expect(a.netDebit).toBe(-2)                               // premium only; stock is not a premium
  })
  it('stock alone', () => {
    expect(analysePayoff([L('stock', 'long', 50, 0)])).toMatchObject({ breakevens: [50], maxProfit: null, maxLoss: -50 })
    expect(analysePayoff([L('stock', 'short', 50, 0)])).toMatchObject({ breakevens: [50], maxProfit: 50, maxLoss: null })
  })
  it('ignores unusable legs and returns null when none remain', () => {
    expect(analysePayoff([])).toBeNull()
    expect(analysePayoff([L('call', 'long', NaN, 1), L('call', 'long', 100, 1, 0)])).toBeNull()
  })

  it('probability of profit matches the lognormal closed form', () => {
    // Long 100 call for 5: profit above 105. sigma 20%, 3 months, r = 0.
    // P(S > 105) = 1 − N((ln 1.05 + 0.005) / 0.1) = 0.2953
    expect(probabilityOfProfit([L('call', 'long', 100, 5)], 100, 0.2, 0.25)!).toBeCloseTo(0.2953, 3)
    // The seller of the same call has the complementary probability.
    expect(probabilityOfProfit([L('call', 'short', 100, 5)], 100, 0.2, 0.25)!).toBeCloseTo(0.7047, 3)
    expect(probabilityOfProfit([L('call', 'long', 100, 5)], 100, 0, 0.25)).toBeNull()
    expect(probabilityOfProfit([L('call', 'long', 100, 5)], 0, 0.2, 0.25)).toBeNull()
  })
  it('a wider iron condor is more likely to profit than a narrow one', () => {
    const condor = (w: number) => [L('put', 'long', 100 - w - 5, 0.5), L('put', 'short', 100 - w, 1.5), L('call', 'short', 100 + w, 1.5), L('call', 'long', 100 + w + 5, 0.5)]
    const narrow = probabilityOfProfit(condor(3), 100, 0.25, 0.1)!
    const wide   = probabilityOfProfit(condor(10), 100, 0.25, 0.1)!
    expect(wide).toBeGreaterThan(narrow)
    expect(wide).toBeLessThanOrEqual(1)
  })

  it('value before expiry converges to the expiry payoff', () => {
    const legs = [L('call', 'long', 100, 5)]
    expect(payoffBeforeExpiry(legs, 120, 0, 0, 0.2)).toBe(payoffAtExpiry(legs, 120))
    expect(payoffBeforeExpiry(legs, 120, 1e-6, 0, 0.2)).toBeCloseTo(15, 3)
    // With time left an option is worth more than its intrinsic value.
    expect(payoffBeforeExpiry(legs, 100, 0.25, 0, 0.2)).toBeGreaterThan(payoffAtExpiry(legs, 100))
  })
  it('samples a curve for charting', () => {
    const c = payoffCurve([L('call', 'long', 100, 5)], 50, 150, 11)
    expect(c).toHaveLength(11)
    expect(c[0]).toEqual({ S: 50, pnl: -5 })
    expect(c[10]).toEqual({ S: 150, pnl: 45 })
    expect(payoffCurve([], 10, 5)).toEqual([])
  })

  it('chooses sensible strike spacing', () => {
    expect(strikeStep(8)).toBe(0.25)
    expect(strikeStep(100)).toBe(2.5)
    expect(strikeStep(250)).toBe(5)
    expect(strikeStep(24000)).toBe(500)
    expect(strikeStep(0)).toBe(1)
  })
  it('every template is priced, analysable and free of NaN', () => {
    for (const id of Object.keys(TEMPLATES) as TemplateId[]) {
      const legs = buildTemplate(id, 187.4, 0.3, 30 / 365, 0.04)
      expect(legs.length, id).toBeGreaterThan(0)
      expect(legs.every(l => l.strike > 0 && l.premium >= 0), id).toBe(true)
      const a = analysePayoff(legs)!
      expect(a, id).not.toBeNull()
      expect(JSON.stringify(a), id).not.toMatch(/NaN|Infinity/)
      const pop = probabilityOfProfit(legs, 187.4, 0.3, 30 / 365, 0.04)!
      expect(pop, id).toBeGreaterThanOrEqual(0)
      expect(pop, id).toBeLessThanOrEqual(1)
    }
    expect(buildTemplate('straddle', 0, 0.3, 0.1)).toEqual([])
  })
  it('templates have the risk shape their name promises', () => {
    const t = (id: TemplateId) => analysePayoff(buildTemplate(id, 100, 0.3, 30 / 365))!
    expect(t('iron-condor').netDebit).toBeLessThan(0)          // opened for a credit
    expect(t('iron-condor').maxLoss).not.toBeNull()
    expect(t('bull-call').maxProfit).not.toBeNull()
    expect(t('straddle').maxProfit).toBeNull()
    expect(t('protective-put').maxLoss).not.toBeNull()
    expect(netDebit(buildTemplate('covered-call', 100, 0.3, 30 / 365))).toBeLessThan(0)
  })
})
