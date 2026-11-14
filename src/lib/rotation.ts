// src/lib/rotation.ts
// Relative strength and rotation: which sectors (or any symbols) are leading
// or lagging a benchmark, and whether that lead is growing or fading.
// Pure maths on daily closes, computed in the browser. Unit-tested.
//
// Definitions (deliberately simple and fully disclosed):
//   ratio     = symbol close ÷ benchmark close, on dates both traded
//   strength  = how far the ratio sits above/below its own TREND-day average, in %
//               (> 0: outperforming the benchmark versus its recent norm)
//   momentum  = change in strength over the last MOMENTUM trading days, in points
//               (> 0: relative performance is improving)
//   quadrant  = leading   (strength > 0, momentum > 0)
//               weakening (strength > 0, momentum ≤ 0)
//               lagging   (strength ≤ 0, momentum ≤ 0)
//               improving (strength ≤ 0, momentum > 0)

import { commonDates, type Series } from '@/lib/risk'

export const TREND_DAYS    = 50
export const MOMENTUM_DAYS = 10
const TRAIL_STEP   = 5      // one trail point per trading week
const TRAIL_POINTS = 6

export type Quadrant = 'leading' | 'weakening' | 'lagging' | 'improving'

export interface RotationPoint { date: string; strength: number; momentum: number }

export interface Rotation {
  symbol:    string
  strength:  number
  momentum:  number
  quadrant:  Quadrant
  /** Oldest → newest, the last entry equals the current reading. */
  trail:     RotationPoint[]
  /** Return minus benchmark return over each window, in percentage points (null if too short). */
  relative:  { w1: number | null; m1: number | null; m3: number | null; m6: number | null }
  /** Own return over the same windows, in %. */
  absolute:  { w1: number | null; m1: number | null; m3: number | null; m6: number | null }
  observations: number
}

export const quadrantOf = (strength: number, momentum: number): Quadrant =>
  strength > 0 ? (momentum > 0 ? 'leading' : 'weakening') : (momentum > 0 ? 'improving' : 'lagging')

const WINDOWS = { w1: 5, m1: 21, m3: 63, m6: 126 } as const

/** Null when the two series share too little history to measure a trend. */
export function relativeRotation(symbol: string, closes: Series, benchmark: Series): Rotation | null {
  const dates = commonDates([closes, benchmark])
  const need = TREND_DAYS + MOMENTUM_DAYS
  if (dates.length < need) return null

  const own: number[] = [], bench: number[] = [], ratio: number[] = []
  for (const d of dates) {
    const a = closes.get(d), b = benchmark.get(d)
    if (!a || !b || a <= 0 || b <= 0) return null
    own.push(a); bench.push(b); ratio.push(a / b)
  }

  // strength[i] for every i that has a full trend window behind it.
  const strength: (number | null)[] = new Array(ratio.length).fill(null)
  let sum = 0
  for (let i = 0; i < ratio.length; i++) {
    sum += ratio[i]
    if (i >= TREND_DAYS) sum -= ratio[i - TREND_DAYS]
    if (i >= TREND_DAYS - 1) strength[i] = (ratio[i] / (sum / TREND_DAYS) - 1) * 100
  }

  const pointAt = (i: number): RotationPoint | null => {
    const s = strength[i], p = i - MOMENTUM_DAYS >= 0 ? strength[i - MOMENTUM_DAYS] : null
    return s === null || p === null || p === undefined ? null : { date: dates[i], strength: s, momentum: s - p }
  }

  const last = ratio.length - 1
  const now = pointAt(last)
  if (!now) return null

  const trail: RotationPoint[] = []
  for (let k = TRAIL_POINTS - 1; k >= 0; k--) {
    const p = pointAt(last - k * TRAIL_STEP)
    if (p) trail.push(p)
  }

  const ret = (x: number[], n: number) => (x.length > n ? (x[last] / x[last - n] - 1) * 100 : null)
  const win = <T,>(f: (n: number) => T) => ({ w1: f(WINDOWS.w1), m1: f(WINDOWS.m1), m3: f(WINDOWS.m3), m6: f(WINDOWS.m6) })

  return {
    symbol,
    strength: now.strength,
    momentum: now.momentum,
    quadrant: quadrantOf(now.strength, now.momentum),
    trail,
    absolute: win(n => ret(own, n)),
    relative: win(n => { const a = ret(own, n), b = ret(bench, n); return a === null || b === null ? null : a - b }),
    observations: dates.length,
  }
}

/** Strongest first: leading, then improving, weakening, lagging; ties by strength. */
export function rankRotation(rows: readonly Rotation[]): Rotation[] {
  const order: Record<Quadrant, number> = { leading: 0, improving: 1, weakening: 2, lagging: 3 }
  return [...rows].sort((a, b) => order[a.quadrant] - order[b.quadrant] || b.strength - a.strength)
}
