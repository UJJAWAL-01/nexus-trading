// ─────────────────────────────────────────────────────────────────────────────
// Trendline fitting (spec §1.1 "trendlines.ts").
//
// Least-squares line through a set of pivots, expressed in (index, price) space
// so detectors can reason about slope in degrees and project the line forward.
// R² + max-deviation-in-ATR let detectors gate on fit quality.
// ─────────────────────────────────────────────────────────────────────────────

import type { PivotPoint } from './types'
import { clamp } from './indicators'

export interface Trendline {
  slope:     number   // price per bar (index)
  intercept: number   // price at index 0
  r2:        number   // 0–1 goodness of fit
  /** Max deviation of any input pivot from the line, in price units. */
  maxDev:    number
  /** Max deviation expressed in multiples of ATR (Infinity if atr ≤ 0). */
  maxDevAtr: number
  points:    PivotPoint[]
  /** Angle of the line in degrees, scaled by price so it's comparable. */
  angleDeg:  number
}

/**
 * Fit a least-squares line through pivots in (index, price) space.
 * `atr` and `refPrice` are used to normalise deviation and angle so thresholds
 * stay scale-free across symbols.
 */
export function fitLine(points: PivotPoint[], atr: number, refPrice: number): Trendline | null {
  const n = points.length
  if (n < 2) return null
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const p of points) { sx += p.index; sy += p.price; sxx += p.index * p.index; sxy += p.index * p.price }
  const denom = n * sxx - sx * sx
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n

  let ssTot = 0, ssRes = 0, maxDev = 0
  const mean = sy / n
  for (const p of points) {
    const pred = slope * p.index + intercept
    const dev = Math.abs(p.price - pred)
    maxDev = Math.max(maxDev, dev)
    ssRes += (p.price - pred) ** 2
    ssTot += (p.price - mean) ** 2
  }
  const r2 = ssTot === 0 ? 1 : clamp(1 - ssRes / ssTot, 0, 1)

  // Normalise slope to "% of price per bar" then to degrees for human angle gates.
  const slopePct = refPrice > 0 ? slope / refPrice : 0
  const angleDeg = Math.atan(slopePct * 100) * (180 / Math.PI)

  return {
    slope, intercept, r2, maxDev,
    maxDevAtr: atr > 0 ? maxDev / atr : Infinity,
    points,
    angleDeg,
  }
}

/** Price predicted by the line at a given candle index. */
export function lineValueAt(line: Trendline, index: number): number {
  return line.slope * index + line.intercept
}

/**
 * Index at which two lines intersect (the apex of a triangle/wedge).
 * Returns null for parallel lines.
 */
export function intersectIndex(a: Trendline, b: Trendline): number | null {
  const ds = a.slope - b.slope
  if (Math.abs(ds) < 1e-12) return null
  return (b.intercept - a.intercept) / ds
}

/** Is a line effectively horizontal (within ±`maxDeg` degrees)? */
export function isHorizontal(line: Trendline, maxDeg = 10): boolean {
  return Math.abs(line.angleDeg) <= maxDeg
}
