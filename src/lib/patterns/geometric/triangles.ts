// Triangles: ascending / descending / symmetrical (spec §1.3).
//
// Two converging trendlines (opposite or one-flat slopes) with the apex still
// ahead of price. Breakout = a close outside either line; target = the widest
// height projected from the breakout point.

import type { PatternDetection, PatternDirection, PatternCategory } from '../types'
import { lineValueAt, isHorizontal } from '../trendlines'
import { clamp } from '../indicators'
import { GeoContext, buildGeo, fmt } from './util'
import { gatherDualFit } from './lines'

export function detectTriangles(ctx: GeoContext): PatternDetection[] {
  const fit = gatherDualFit(ctx, 'k5', { minLookback: 20, maxLookback: 120 })
    ?? gatherDualFit(ctx, 'k3', { minLookback: 20, maxLookback: 120 })
  if (!fit) return []
  const { upper, lower, apexIndex, startIndex, endIndex } = fit

  // Lines must converge with the apex ahead, and the formation must not be
  // exhausted (current bar < 75% of the way to the apex).
  if (apexIndex == null || apexIndex <= ctx.lastIndex) return []
  const progress = (ctx.lastIndex - startIndex) / (apexIndex - startIndex)
  if (progress > 0.75) return []

  const upFlat = isHorizontal(upper, 10)
  const loFlat = isHorizontal(lower, 10)
  const upDown = upper.angleDeg < -3
  const loUp = lower.angleDeg > 3

  let id = '', name = '', dir: PatternDirection = 'neutral'
  const category: PatternCategory = 'continuation'
  if (upFlat && loUp) { id = 'ascending_triangle'; name = 'Ascending Triangle'; dir = 'bullish' }
  else if (loFlat && upDown) { id = 'descending_triangle'; name = 'Descending Triangle'; dir = 'bearish' }
  else if (upDown && loUp) { id = 'symmetrical_triangle'; name = 'Symmetrical Triangle'; dir = 'neutral' }
  else return []

  const upNow = lineValueAt(upper, ctx.lastIndex)
  const loNow = lineValueAt(lower, ctx.lastIndex)
  const close = ctx.lastClose

  let status: PatternDetection['status'] = 'forming'
  let direction = dir
  let breakoutLevel: number | null = dir === 'bullish' ? upNow : dir === 'bearish' ? loNow : null
  if (close > upNow) { status = 'confirmed'; direction = 'bullish'; breakoutLevel = upNow }
  else if (close < loNow) { status = 'confirmed'; direction = 'bearish'; breakoutLevel = loNow }
  else if (dir === 'neutral') { direction = 'neutral'; breakoutLevel = upNow }

  const height = fit.startHeight
  const target = direction === 'bullish' ? (breakoutLevel ?? upNow) + height
    : direction === 'bearish' ? (breakoutLevel ?? loNow) - height : null
  const invalidation = direction === 'bullish' ? loNow : direction === 'bearish' ? upNow : null

  const geometryQuality = clamp((upper.r2 + lower.r2) / 2, 0, 1) * 0.7
    + clamp(1 - Math.max(upper.maxDevAtr, lower.maxDevAtr) / 1.2, 0, 1) * 0.3

  const breakVol = ctx.candles[ctx.lastIndex]?.volume ?? 0
  const volumeConfirmed = status === 'confirmed' && breakVol > ctx.avgVol * 1.3

  const c = ctx.candles
  const lines = [
    { a: { time: c[startIndex].time, price: lineValueAt(upper, startIndex) },
      b: { time: c[ctx.lastIndex].time, price: upNow }, style: 'solid' as const, role: 'resistance' as const },
    { a: { time: c[startIndex].time, price: lineValueAt(lower, startIndex) },
      b: { time: c[ctx.lastIndex].time, price: loNow }, style: 'solid' as const, role: 'support' as const },
  ]
  const verb = status === 'confirmed' ? `broke ${direction === 'bullish' ? 'above' : 'below'}` : 'is coiling within'

  return [buildGeo({
    id, name, category, direction, status,
    startIndex, endIndex,
    points: [...fit.highs, ...fit.lows].map(p => ({ time: p.time, price: p.price })),
    lines,
    breakoutLevel, target, invalidation,
    geometryQuality, volumeConfirmed,
    ageBars: 0,
    implication:
      `${name}. Price ${verb} the boundaries (${fmt(loNow)}–${fmt(upNow)})` +
      (target != null ? `; a breakout projects ~${fmt(target)}.` : '; awaiting a directional break.'),
    ctx,
  })]
}
