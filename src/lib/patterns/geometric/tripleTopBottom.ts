// Triple Top / Bottom (spec §1.3) — extends the double logic to three near-equal
// pivots, with a confidence boost for successively lower volume on each test.

import type { PatternDetection } from '../types'
import { clamp } from '../indicators'
import { GeoContext, buildGeo, fmt, pct, firstCloseBeyond, volAvg, hasReversalContext } from './util'

export function detectTripleTopBottom(ctx: GeoContext): PatternDetection[] {
  const piv = ctx.tiers.k5
  const out: PatternDetection[] = []
  const { candles, atr } = ctx

  // window of 5: E-L-E-L-E (top) or L-H-L-H-L (bottom)
  for (let i = 0; i + 4 < piv.length; i++) {
    const e1 = piv[i], t1 = piv[i + 1], e2 = piv[i + 2], t2 = piv[i + 3], e3 = piv[i + 4]
    const isTop = e1.type === 'high' && e2.type === 'high' && e3.type === 'high' && t1.type === 'low' && t2.type === 'low'
    const isBot = e1.type === 'low' && e2.type === 'low' && e3.type === 'low' && t1.type === 'high' && t2.type === 'high'
    if (!isTop && !isBot) continue

    const extremes = [e1.price, e2.price, e3.price]
    const avgExt = (extremes[0] + extremes[1] + extremes[2]) / 3
    if (extremes.some(p => pct(p, avgExt) > 0.025)) continue

    const neckline = isTop ? Math.max(t1.price, t2.price) : Math.min(t1.price, t2.price)
    const height = Math.abs(avgExt - neckline)
    if (height < 3.5 * atr) continue

    if (!hasReversalContext(ctx, e1.index, isTop)) continue

    const breakIdx = firstCloseBeyond(candles, e3.index, neckline, isTop ? 'below' : 'above')
    let status: PatternDetection['status'] = 'forming'
    let breakBar = ctx.lastIndex
    if (breakIdx != null) { status = 'confirmed'; breakBar = breakIdx }

    const target = isTop ? neckline - height : neckline + height
    const symmetry = clamp(1 - Math.max(...extremes.map(p => pct(p, avgExt))) / 0.025, 0, 1)

    const v1 = volAvg(candles, e1.index - 1, e1.index + 1)
    const v2 = volAvg(candles, e2.index - 1, e2.index + 1)
    const v3 = volAvg(candles, e3.index - 1, e3.index + 1)
    const decliningVol = v1 > v2 && v2 > v3
    const breakVol = candles[breakBar]?.volume ?? 0
    const volumeConfirmed = decliningVol && breakVol > ctx.avgVol * 1.2
    const geometryQuality = symmetry * 0.8 + (decliningVol ? 0.2 : 0)

    const id = isTop ? 'triple_top' : 'triple_bottom'
    const name = isTop ? 'Triple Top' : 'Triple Bottom'
    const dir = isTop ? 'bearish' : 'bullish'

    const points = [e1, t1, e2, t2, e3].map((p, k) => ({
      time: p.time, price: p.price,
      label: k % 2 === 0 ? (isTop ? `T${k / 2 + 1}` : `B${k / 2 + 1}`) : undefined,
    }))
    const lines = points.slice(0, 4).map((p, k) => ({
      a: p, b: points[k + 1], style: 'solid' as const, role: 'pattern' as const,
    }))
    lines.push({
      a: { time: t1.time, price: neckline },
      b: { time: candles[Math.min(ctx.lastIndex, breakBar)].time, price: neckline },
      style: 'dashed' as const, role: 'neckline' as const,
    } as never)

    const verb = status === 'confirmed' ? 'broke' : 'is testing'
    out.push(buildGeo({
      id, name, category: 'reversal', direction: dir, status,
      startIndex: e1.index, endIndex: e3.index,
      points, lines,
      breakoutLevel: neckline, target, invalidation: avgExt,
      geometryQuality, volumeConfirmed,
      ageBars: status === 'confirmed' ? ctx.lastIndex - breakBar : 0,
      implication:
        `${dir === 'bearish' ? 'Bearish' : 'Bullish'} reversal. Three ${isTop ? 'highs' : 'lows'} near ${fmt(avgExt)}; ` +
        `price ${verb} the neckline at ${fmt(neckline)}, projecting ~${fmt(target)}.`,
      ctx,
    }))
  }
  return out
}
