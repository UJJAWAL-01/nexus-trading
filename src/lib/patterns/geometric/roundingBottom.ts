// Rounding Bottom / Saucer (spec §1.3) — the cup logic without a handle, over a
// longer window. A smooth bowl between two rim highs that recovers to the rim.

import type { PatternDetection } from '../types'
import { clamp } from '../indicators'
import { GeoContext, buildGeo, fmt, pct, firstCloseBeyond } from './util'
import { fitParabola } from './parabola'

export function detectRoundingBottom(ctx: GeoContext): PatternDetection[] {
  const { candles } = ctx
  const highs = ctx.tiers.k8.filter(p => p.type === 'high')
  if (highs.length < 2) return []

  for (let r = highs.length - 1; r >= 1; r--) {
    const rightRim = highs[r]
    for (let l = r - 1; l >= 0; l--) {
      const leftRim = highs[l]
      const dur = rightRim.index - leftRim.index
      if (dur < 50 || dur > 300) continue
      if (pct(leftRim.price, rightRim.price) > 0.06) continue

      const lows = candles.slice(leftRim.index, rightRim.index + 1).map(c => c.low)
      const fit = fitParabola(lows)
      if (!fit || fit.a <= 0 || fit.r2 < 0.82) continue

      const rim = (leftRim.price + rightRim.price) / 2
      const depth = rim - Math.min(...lows)
      if (depth / rim < 0.1 || depth / rim > 0.55) continue

      const breakIdx = firstCloseBeyond(candles, rightRim.index, rim, 'above')
      let status: PatternDetection['status'] = 'forming'
      let breakBar = ctx.lastIndex
      if (breakIdx != null) { status = 'confirmed'; breakBar = breakIdx }

      const target = rim + depth
      const geometryQuality = clamp(fit.r2, 0, 1) * 0.8 + 0.1
      const cupBottomIdx = (() => {
        let bi = leftRim.index, bv = Infinity
        for (let i = leftRim.index; i <= rightRim.index; i++) if (candles[i].low < bv) { bv = candles[i].low; bi = i }
        return bi
      })()

      const verb = status === 'confirmed' ? 'broke above' : 'is recovering toward'
      return [buildGeo({
        id: 'rounding_bottom', name: 'Rounding Bottom', category: 'reversal', direction: 'bullish', status,
        startIndex: leftRim.index, endIndex: ctx.lastIndex,
        points: [
          { time: leftRim.time, price: leftRim.price, label: 'L Rim' },
          { time: candles[cupBottomIdx].time, price: candles[cupBottomIdx].low, label: 'Base' },
          { time: rightRim.time, price: rightRim.price, label: 'R Rim' },
        ],
        lines: [{
          a: { time: leftRim.time, price: rim },
          b: { time: candles[Math.min(ctx.lastIndex, breakBar)].time, price: rim },
          style: 'dashed' as const, role: 'neckline' as const,
        }],
        breakoutLevel: rim, target, invalidation: rim - depth,
        geometryQuality, volumeConfirmed: (candles[breakBar]?.volume ?? 0) > ctx.avgVol * 1.2,
        ageBars: status === 'confirmed' ? ctx.lastIndex - breakBar : 0,
        implication:
          `Bullish reversal. A long, smooth saucer base bottomed and ${verb} the rim at ${fmt(rim)}; ` +
          `a breakout projects ~${fmt(target)}.`,
        ctx,
      })]
    }
  }
  return []
}
