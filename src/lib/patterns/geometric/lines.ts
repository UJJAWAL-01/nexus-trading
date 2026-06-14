// Shared trendline-pair fitting for triangles / wedges / channels / broadening.
//
// Gathers the recent swing highs and lows from a pivot tier, fits a least-squares
// line through each, and reports slopes, fit quality, and the apex (line
// intersection) so each detector only has to classify the geometry.

import type { PivotPoint } from '../types'
import { fitLine, Trendline, intersectIndex } from '../trendlines'
import type { GeoContext } from './util'

export interface DualFit {
  upper:      Trendline
  lower:      Trendline
  highs:      PivotPoint[]
  lows:       PivotPoint[]
  apexIndex:  number | null
  startIndex: number
  endIndex:   number
  /** Height (price) of the formation at its start. */
  startHeight: number
}

export function gatherDualFit(
  ctx: GeoContext,
  tier: 'k3' | 'k5',
  opts: { minLookback?: number; maxLookback?: number; maxDevAtr?: number } = {},
): DualFit | null {
  const { minLookback = 20, maxLookback = 120, maxDevAtr = 1.2 } = opts
  const from = Math.max(0, ctx.lastIndex - maxLookback)
  const recent = ctx.tiers[tier].filter(p => p.index >= from)
  const highs = recent.filter(p => p.type === 'high')
  const lows = recent.filter(p => p.type === 'low')
  if (highs.length < 2 || lows.length < 2) return null

  const idxs = recent.map(p => p.index)
  const startIndex = Math.min(...idxs)
  const endIndex = Math.max(...idxs)
  if (endIndex - startIndex < minLookback) return null

  const ref = ctx.lastClose
  const upper = fitLine(highs, ctx.atr, ref)
  const lower = fitLine(lows, ctx.atr, ref)
  if (!upper || !lower) return null
  if (upper.maxDevAtr > maxDevAtr || lower.maxDevAtr > maxDevAtr) return null

  const apexIndex = intersectIndex(upper, lower)
  const startHeight = Math.abs(
    (upper.slope * startIndex + upper.intercept) - (lower.slope * startIndex + lower.intercept),
  )
  return { upper, lower, highs, lows, apexIndex, startIndex, endIndex, startHeight }
}
