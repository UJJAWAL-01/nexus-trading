// ─────────────────────────────────────────────────────────────────────────────
// Pivot / swing-point detection (spec §1.2).
//
// Fractal pivots at three strength tiers (k = 3 / 5 / 8), filtered by an
// ATR(14) significance gate, then reduced to an alternating high→low→high
// zigzag chain. Geometric detectors pick the tier that matches their lookback.
// Everything downstream depends on getting these right.
// ─────────────────────────────────────────────────────────────────────────────

import type { Candle, PivotPoint } from './types'
import { atrSeries, atr as atrLast } from './indicators'

export interface PivotTiers {
  k3: PivotPoint[]
  k5: PivotPoint[]
  k8: PivotPoint[]
}

/**
 * Raw fractal pivots at strength `k`: a swing high is the max high over k bars
 * on each side; a swing low the min low. Edge bars (first/last k) can't be
 * confirmed and are skipped.
 */
export function fractalPivots(candles: Candle[], k: number): PivotPoint[] {
  const out: PivotPoint[] = []
  const n = candles.length
  for (let i = k; i < n - k; i++) {
    const c = candles[i]
    // A genuine swing high is ≥ every neighbour (so a single tie at a turning
    // point — e.g. open==prevClose bars — doesn't disqualify it) AND strictly
    // above at least one bar on each side. The second clause rejects flat
    // plateaus, where no bar is strictly lower, so flat data yields no pivots.
    let isHigh = true, isLow = true
    let hiL = false, hiR = false, loL = false, loR = false
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue
      const left = j < i
      if (candles[j].high > c.high) isHigh = false
      else if (candles[j].high < c.high) { if (left) hiL = true; else hiR = true }
      if (candles[j].low < c.low) isLow = false
      else if (candles[j].low > c.low) { if (left) loL = true; else loR = true }
    }
    if (isHigh && hiL && hiR) out.push({ index: i, time: c.time, price: c.high, type: 'high', strength: k })
    if (isLow && loL && loR)  out.push({ index: i, time: c.time, price: c.low,  type: 'low',  strength: k })
  }
  return out.sort((a, b) => a.index - b.index)
}

/**
 * Reduce a pivot list to an alternating zigzag chain:
 *  - consecutive highs → keep the higher; consecutive lows → keep the lower
 *  - drop a pivot whose move from the previous opposite pivot is smaller than
 *    `atrMult × ATR(14)` (kills chop). A high and the immediately following low
 *    sharing the same candle index (doji bar that is both) is de-duplicated.
 */
export function zigzag(
  pivots: PivotPoint[],
  atrAt: Array<number | null>,
  fallbackAtr: number,
  atrMult: number,
): PivotPoint[] {
  if (pivots.length === 0) return []
  const sig = (idx: number) => (atrAt[idx] ?? fallbackAtr) * atrMult

  const chain: PivotPoint[] = []
  for (const p of pivots) {
    const prev = chain[chain.length - 1]
    if (!prev) { chain.push(p); continue }

    if (prev.type === p.type) {
      // Same direction: keep the more extreme one.
      const keepNew = p.type === 'high' ? p.price > prev.price : p.price < prev.price
      if (keepNew) chain[chain.length - 1] = p
      continue
    }

    // Opposite type: enforce ATR significance vs the kept pivot.
    if (prev.index === p.index) continue // same bar both high & low — ignore the second
    const move = Math.abs(p.price - prev.price)
    if (move < sig(p.index)) {
      // Insignificant reversal — fold into the dominant pivot.
      const replace = prev.type === 'high'
        ? p.price > prev.price   // new "low" is actually higher → keep extending high
        : p.price < prev.price
      if (replace) chain[chain.length - 1] = p
      continue
    }
    chain.push(p)
  }
  return chain
}

/**
 * Compute all three pivot tiers as significance-filtered zigzag chains.
 * `pivotAtrMult` defaults to 0.8 (spec).
 */
export function detectPivots(candles: Candle[], pivotAtrMult = 0.8): PivotTiers {
  const atrAt = atrSeries(candles, 14)
  const fallback = atrLast(candles, 14)
  const build = (k: number) =>
    zigzag(fractalPivots(candles, k), atrAt, fallback, pivotAtrMult)
  return {
    k3: build(3),
    k5: build(5),
    k8: build(8),
  }
}

/** Nearest pivot of a type at or before index, for structural SR lookups. */
export function priorPivot(
  pivots: PivotPoint[], index: number, type?: 'high' | 'low',
): PivotPoint | null {
  for (let i = pivots.length - 1; i >= 0; i--) {
    if (pivots[i].index > index) continue
    if (!type || pivots[i].type === type) return pivots[i]
  }
  return null
}
