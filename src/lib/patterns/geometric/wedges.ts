// Rising / Falling Wedges (spec §1.3).
//
// Both boundary lines slope the SAME direction and converge. A rising wedge
// (both up, converging) is bearish; a falling wedge (both down, converging) is
// bullish. Same fit rules as triangles.

import type { PatternDetection, PatternDirection } from '../types'
import { lineValueAt } from '../trendlines'
import { clamp } from '../indicators'
import { GeoContext, buildGeo, fmt } from './util'
import { gatherDualFit } from './lines'

export function detectWedges(ctx: GeoContext): PatternDetection[] {
  const fit = gatherDualFit(ctx, 'k5', { minLookback: 20, maxLookback: 120 })
    ?? gatherDualFit(ctx, 'k3', { minLookback: 20, maxLookback: 120 })
  if (!fit) return []
  const { upper, lower, apexIndex, startIndex, endIndex } = fit

  if (apexIndex == null || apexIndex <= ctx.lastIndex) return []

  const bothUp = upper.angleDeg > 3 && lower.angleDeg > 3
  const bothDown = upper.angleDeg < -3 && lower.angleDeg < -3
  if (!bothUp && !bothDown) return []
  // converging: lower steeper than upper for rising; upper steeper for falling
  const converging = bothUp ? lower.slope > upper.slope : upper.slope < lower.slope
  if (!converging) return []

  const id = bothUp ? 'rising_wedge' : 'falling_wedge'
  const name = bothUp ? 'Rising Wedge' : 'Falling Wedge'
  const baseDir: PatternDirection = bothUp ? 'bearish' : 'bullish'

  const upNow = lineValueAt(upper, ctx.lastIndex)
  const loNow = lineValueAt(lower, ctx.lastIndex)
  const close = ctx.lastClose

  let status: PatternDetection['status'] = 'forming'
  let direction = baseDir
  let breakoutLevel: number | null = bothUp ? loNow : upNow
  if (bothUp && close < loNow) { status = 'confirmed'; direction = 'bearish'; breakoutLevel = loNow }
  else if (bothDown && close > upNow) { status = 'confirmed'; direction = 'bullish'; breakoutLevel = upNow }

  const height = fit.startHeight
  const target = direction === 'bearish' ? (breakoutLevel ?? loNow) - height : (breakoutLevel ?? upNow) + height
  const invalidation = bothUp ? upNow : loNow

  const geometryQuality = clamp((upper.r2 + lower.r2) / 2, 0, 1) * 0.7
    + clamp(1 - Math.max(upper.maxDevAtr, lower.maxDevAtr) / 1.2, 0, 1) * 0.3
  const breakVol = ctx.candles[ctx.lastIndex]?.volume ?? 0
  const volumeConfirmed = status === 'confirmed' && breakVol > ctx.avgVol * 1.2

  const c = ctx.candles
  const lines = [
    { a: { time: c[startIndex].time, price: lineValueAt(upper, startIndex) },
      b: { time: c[ctx.lastIndex].time, price: upNow }, style: 'solid' as const, role: 'resistance' as const },
    { a: { time: c[startIndex].time, price: lineValueAt(lower, startIndex) },
      b: { time: c[ctx.lastIndex].time, price: loNow }, style: 'solid' as const, role: 'support' as const },
  ]
  const verb = status === 'confirmed' ? 'broke' : 'is narrowing within'
  return [buildGeo({
    id, name, category: 'reversal', direction, status,
    startIndex, endIndex,
    points: [...fit.highs, ...fit.lows].map(p => ({ time: p.time, price: p.price })),
    lines,
    breakoutLevel, target, invalidation,
    geometryQuality, volumeConfirmed,
    ageBars: 0,
    implication:
      `${name} — ${baseDir} bias. Price ${verb} the wedge (${fmt(loNow)}–${fmt(upNow)}); ` +
      `a confirmed break projects ~${fmt(target)}.`,
    ctx,
  })]
}
