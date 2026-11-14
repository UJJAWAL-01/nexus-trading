// src/lib/payoff.ts
// Options strategy payoff maths. Pure and deterministic (no random numbers),
// computed in the browser: no options-data subscription, no key, no cost.
// Unit-tested.
//
// Conventions:
//   • P&L is per ONE unit of the underlying; the panel multiplies by lot size.
//   • `premium` is the price paid (long) or received (short) per unit.
//   • A 'stock' leg uses `strike` as its entry price and has no premium.
//   • Payoff at expiry is piecewise-linear with kinks only at strikes, so
//     break-evens, maximum profit and maximum loss are exact, not sampled.

import { bsm, normalCDF } from '@/lib/options-math'

export type LegType = 'call' | 'put' | 'stock'
export type LegSide = 'long' | 'short'

export interface Leg {
  type:    LegType
  side:    LegSide
  strike:  number
  qty:     number
  premium: number
}

const sgn = (l: Leg) => (l.side === 'long' ? 1 : -1)

export function legPayoff(l: Leg, S: number): number {
  if (l.type === 'stock') return sgn(l) * (S - l.strike) * l.qty
  const intrinsic = l.type === 'call' ? Math.max(S - l.strike, 0) : Math.max(l.strike - S, 0)
  return sgn(l) * (intrinsic - l.premium) * l.qty
}

/** Profit or loss at expiry for underlying price S. */
export const payoffAtExpiry = (legs: readonly Leg[], S: number): number => legs.reduce((a, l) => a + legPayoff(l, S), 0)

/** Mark-to-model P&L before expiry (Black-Scholes value of each option leg). */
export function payoffBeforeExpiry(legs: readonly Leg[], S: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return payoffAtExpiry(legs, S)
  return legs.reduce((a, l) => {
    if (l.type === 'stock') return a + legPayoff(l, S)
    const v = bsm({ S, K: l.strike, T, r, sigma })
    return a + sgn(l) * ((l.type === 'call' ? v.call : v.put) - l.premium) * l.qty
  }, 0)
}

/** Positive = you pay to open (debit); negative = you receive (credit). Options only. */
export const netDebit = (legs: readonly Leg[]): number =>
  legs.reduce((a, l) => (l.type === 'stock' ? a : a + sgn(l) * l.premium * l.qty), 0)

export interface PayoffAnalysis {
  breakevens: number[]
  /** null = unlimited. */
  maxProfit:  number | null
  maxLoss:    number | null      // reported as a negative number
  netDebit:   number
  /** Price ranges where the position is profitable at expiry (hi null = no upper bound). */
  profitZones: Array<{ lo: number; hi: number | null }>
}

const EPS = 1e-9

export function analysePayoff(legs: readonly Leg[]): PayoffAnalysis | null {
  const valid = legs.filter(l => l.qty > 0 && Number.isFinite(l.strike) && l.strike > 0 && Number.isFinite(l.premium) && l.premium >= 0)
  if (!valid.length) return null

  // Kinks: 0, every option strike. Beyond the last kink the line continues with a fixed slope.
  const knots = [...new Set([0, ...valid.filter(l => l.type !== 'stock').map(l => l.strike)])].sort((a, b) => a - b)
  const lastK = knots[knots.length - 1]
  const tailSlope = valid.reduce((a, l) => a + (l.type === 'put' ? 0 : sgn(l) * l.qty), 0)
  const values = knots.map(k => payoffAtExpiry(valid, k))

  // Roots: between knots by linear interpolation, then on the open tail.
  const roots: number[] = []
  const addRoot = (x: number) => { if (!roots.some(r => Math.abs(r - x) < 1e-6)) roots.push(x) }
  for (let i = 0; i < knots.length; i++) {
    if (Math.abs(values[i]) < EPS) { if (knots[i] > 0) addRoot(knots[i]); continue }
    if (i + 1 < knots.length && Math.abs(values[i + 1]) >= EPS && values[i] * values[i + 1] < 0) {
      addRoot(knots[i] + (knots[i + 1] - knots[i]) * (-values[i] / (values[i + 1] - values[i])))
    }
  }
  const vLast = values[values.length - 1]
  if (Math.abs(tailSlope) > EPS && Math.abs(vLast) >= EPS && vLast * tailSlope < 0) addRoot(lastK - vLast / tailSlope)
  roots.sort((a, b) => a - b)

  const maxProfit = tailSlope > EPS ? null : Math.max(...values)
  const maxLoss   = tailSlope < -EPS ? null : Math.min(...values)

  // Profit zones: test the midpoint of every segment between consecutive roots.
  const edges = [0, ...roots]
  const profitZones: PayoffAnalysis['profitZones'] = []
  for (let i = 0; i < edges.length; i++) {
    const lo = edges[i], hi = i + 1 < edges.length ? edges[i + 1] : null
    const probe = hi === null ? Math.max(lo, lastK) * 1.5 + 1 : (lo + hi) / 2
    if (payoffAtExpiry(valid, probe) > EPS) {
      const prev = profitZones[profitZones.length - 1]
      if (prev && prev.hi !== null && Math.abs(prev.hi - lo) < 1e-6) prev.hi = hi
      else profitZones.push({ lo, hi })
    }
  }

  return { breakevens: roots, maxProfit, maxLoss, netDebit: netDebit(valid), profitZones }
}

/**
 * Probability the position is profitable at expiry, assuming the underlying is
 * lognormal with volatility `sigma` and drifts at the risk-free rate. This is
 * a model estimate under that assumption, not a forecast.
 */
export function probabilityOfProfit(legs: readonly Leg[], spot: number, sigma: number, T: number, r = 0): number | null {
  const a = analysePayoff(legs)
  if (!a || !(spot > 0) || !(sigma > 0) || !(T > 0)) return null
  const sd = sigma * Math.sqrt(T)
  // P(S_T < x) under the risk-neutral lognormal.
  const cdf = (x: number) => (x <= 0 ? 0 : normalCDF((Math.log(x / spot) - (r - 0.5 * sigma * sigma) * T) / sd))
  const p = a.profitZones.reduce((s, z) => s + (z.hi === null ? 1 : cdf(z.hi)) - cdf(z.lo), 0)
  return Math.min(1, Math.max(0, p))
}

/** Evenly spaced curve for charting. */
export function payoffCurve(legs: readonly Leg[], lo: number, hi: number, points = 121): Array<{ S: number; pnl: number }> {
  const out: Array<{ S: number; pnl: number }> = []
  if (!(hi > lo) || points < 2) return out
  for (let i = 0; i < points; i++) {
    const S = lo + ((hi - lo) * i) / (points - 1)
    out.push({ S, pnl: payoffAtExpiry(legs, S) })
  }
  return out
}

// ── Templates ────────────────────────────────────────────────────────────────

export const TEMPLATES = {
  'long-call':       'Long call',
  'long-put':        'Long put',
  'covered-call':    'Covered call',
  'protective-put':  'Protective put',
  'bull-call':       'Bull call spread',
  'bear-put':        'Bear put spread',
  'straddle':        'Long straddle',
  'strangle':        'Long strangle',
  'iron-condor':     'Iron condor',
  'butterfly':       'Call butterfly',
} as const
export type TemplateId = keyof typeof TEMPLATES

/** A sensible strike spacing for a given price (1, 2.5, 5, 10, 25, 50…). */
export function strikeStep(spot: number): number {
  if (!(spot > 0)) return 1
  const raw = spot * 0.025
  const pow = 10 ** Math.floor(Math.log10(raw))
  const m = raw / pow
  return (m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * pow
}

/** Build a template around `spot`, pricing every option with Black-Scholes at `sigma`. */
export function buildTemplate(id: TemplateId, spot: number, sigma: number, T: number, r = 0): Leg[] {
  if (!(spot > 0)) return []
  const step = strikeStep(spot)
  const atm  = Math.max(step, Math.round(spot / step) * step)
  const k = (n: number) => Math.max(step, atm + n * step)
  const price = (type: 'call' | 'put', strike: number) => {
    const v = bsm({ S: spot, K: strike, T: Math.max(T, 1 / 365), r, sigma: Math.max(sigma, 0.01) })
    return Math.round((type === 'call' ? v.call : v.put) * 100) / 100
  }
  const opt = (type: 'call' | 'put', side: LegSide, strike: number, qty = 1): Leg => ({ type, side, strike, qty, premium: price(type, strike) })
  const stock: Leg = { type: 'stock', side: 'long', strike: Math.round(spot * 100) / 100, qty: 1, premium: 0 }

  switch (id) {
    case 'long-call':      return [opt('call', 'long', atm)]
    case 'long-put':       return [opt('put', 'long', atm)]
    case 'covered-call':   return [stock, opt('call', 'short', k(2))]
    case 'protective-put': return [stock, opt('put', 'long', k(-2))]
    case 'bull-call':      return [opt('call', 'long', atm), opt('call', 'short', k(2))]
    case 'bear-put':       return [opt('put', 'long', atm), opt('put', 'short', k(-2))]
    case 'straddle':       return [opt('call', 'long', atm), opt('put', 'long', atm)]
    case 'strangle':       return [opt('call', 'long', k(2)), opt('put', 'long', k(-2))]
    case 'iron-condor':    return [opt('put', 'long', k(-4)), opt('put', 'short', k(-2)), opt('call', 'short', k(2)), opt('call', 'long', k(4))]
    case 'butterfly':      return [opt('call', 'long', k(-2)), opt('call', 'short', atm, 2), opt('call', 'long', k(2))]
  }
}
