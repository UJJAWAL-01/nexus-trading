// Cup & Handle (spec §1.3).
//
// Two rim highs within 5% of each other, 30–200 bars apart, with a smooth
// rounding bottom between them (parabola R² ≥ 0.8, depth 12–50% of the rim).
// The handle is a shallow drift (< 1/3 cup depth) on the right rim lasting
// < 1/4 of the cup's duration. Confirmed on a close above the rim;
// target = rim + cup depth.

import type { PatternDetection, PivotPoint } from '../types'
import { clamp } from '../indicators'
import { GeoContext, buildGeo, fmt, pct, firstCloseBeyond } from './util'
import { fitParabola } from './parabola'

export function detectCupHandle(ctx: GeoContext): PatternDetection[] {
  const { candles } = ctx
  const highs = ctx.tiers.k8.filter(p => p.type === 'high')
  if (highs.length < 2) return []
  const out: PatternDetection[] = []

  // Try the most recent rim pairs first.
  for (let r = highs.length - 1; r >= 1; r--) {
    const rightRim = highs[r]
    for (let l = r - 1; l >= 0; l--) {
      const leftRim = highs[l]
      const dur = rightRim.index - leftRim.index
      if (dur < 30 || dur > 200) continue
      if (pct(leftRim.price, rightRim.price) > 0.05) continue

      const lows = candles.slice(leftRim.index, rightRim.index + 1).map(c => c.low)
      const fit = fitParabola(lows)
      if (!fit || fit.a <= 0 || fit.r2 < 0.8) continue

      const rim = (leftRim.price + rightRim.price) / 2
      const cupBottom = Math.min(...lows)
      const depth = rim - cupBottom
      const depthPct = depth / rim
      if (depthPct < 0.12 || depthPct > 0.5) continue

      // Handle: bars after the right rim
      const handle = candles.slice(rightRim.index + 1)
      const handleLen = handle.length
      let handleValid = handleLen > 0 && handleLen <= dur / 4
      if (handleValid) {
        const handleLow = Math.min(...handle.map(c => c.low))
        if (rightRim.price - handleLow > depth / 3) handleValid = false
      }

      const det = buildCup(ctx, leftRim, rightRim, rim, depth, fit.r2, handleValid)
      out.push(det)
      return out  // one best cup is enough
    }
  }
  return out
}

function buildCup(
  ctx: GeoContext, leftRim: PivotPoint, rightRim: PivotPoint,
  rim: number, depth: number, r2: number, handleValid: boolean,
): PatternDetection {
  const { candles } = ctx
  const breakIdx = firstCloseBeyond(candles, rightRim.index, rim, 'above')
  let status: PatternDetection['status'] = 'forming'
  let breakBar = ctx.lastIndex
  if (breakIdx != null) { status = 'confirmed'; breakBar = breakIdx }
  // failed: dropped well below the cup bottom after the right rim
  if (status !== 'confirmed' && candles.slice(rightRim.index).some(c => c.close < rim - depth * 1.1)) status = 'failed'

  const target = rim + depth
  const cupBottomIdx = (() => {
    let bi = leftRim.index, bv = Infinity
    for (let i = leftRim.index; i <= rightRim.index; i++) if (candles[i].low < bv) { bv = candles[i].low; bi = i }
    return bi
  })()

  const geometryQuality = clamp(r2, 0, 1) * 0.7 + (handleValid ? 0.3 : 0.1)
  const points = [
    { time: leftRim.time, price: leftRim.price, label: 'L Rim' },
    { time: candles[cupBottomIdx].time, price: candles[cupBottomIdx].low, label: 'Base' },
    { time: rightRim.time, price: rightRim.price, label: 'R Rim' },
  ]
  const lines = [
    { a: { time: leftRim.time, price: rim }, b: { time: candles[Math.min(ctx.lastIndex, breakBar)].time, price: rim },
      style: 'dashed' as const, role: 'neckline' as const },
  ]
  const verb = status === 'confirmed' ? 'broke above' : 'is approaching'
  return buildGeo({
    id: 'cup_handle', name: 'Cup & Handle', category: 'continuation', direction: 'bullish', status,
    startIndex: leftRim.index, endIndex: ctx.lastIndex,
    points, lines,
    breakoutLevel: rim, target, invalidation: rim - depth,
    geometryQuality, volumeConfirmed: (candles[breakBar]?.volume ?? 0) > ctx.avgVol * 1.3,
    ageBars: status === 'confirmed' ? ctx.lastIndex - breakBar : 0,
    implication:
      `Bullish continuation. A rounded base${handleValid ? ' with a shallow handle' : ''} formed below the rim at ${fmt(rim)}. ` +
      `Price ${verb} the rim; a breakout projects ~${fmt(target)}. Invalidated below ${fmt(rim - depth)}.`,
    ctx,
  })
}
