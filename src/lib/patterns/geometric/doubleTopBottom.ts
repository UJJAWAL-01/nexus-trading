// Double Top / Double Bottom (spec §1.3).
//
// Two same-type pivots within 2% of each other, ≥10 bars apart, separated by an
// intervening retracement ≥3% (or ≥2·ATR). Neckline = the intervening pivot;
// confirmed on a close beyond it. Target = pattern height from the neckline.

import type { PatternDetection } from '../types'
import { clamp } from '../indicators'
import { GeoContext, buildGeo, fmt, pct, firstCloseBeyond, volAvg, hasReversalContext } from './util'

export function detectDoubleTopBottom(ctx: GeoContext): PatternDetection[] {
  const piv = ctx.tiers.k5
  const out: PatternDetection[] = []
  const { candles, atr } = ctx

  for (let i = 0; i + 2 < piv.length; i++) {
    const p0 = piv[i], p1 = piv[i + 1], p2 = piv[i + 2]
    const isTop = p0.type === 'high' && p2.type === 'high' && p1.type === 'low'
    const isBot = p0.type === 'low' && p2.type === 'low' && p1.type === 'high'
    if (!isTop && !isBot) continue

    if (pct(p0.price, p2.price) > 0.02) continue
    if (p2.index - p0.index < 10) continue

    const retrace = Math.abs(p1.price - (p0.price + p2.price) / 2)
    if (retrace / ((p0.price + p2.price) / 2) < 0.03 && retrace < 2 * atr) continue

    // Reversal context: a top must follow an uptrend, a bottom a downtrend.
    // This is what separates a real double from two chance-equal noise swings.
    if (!hasReversalContext(ctx, p0.index, isTop)) continue
    // Structural significance: pattern must be tall vs local ATR.
    if (Math.abs((p0.price + p2.price) / 2 - p1.price) < 3.5 * atr) continue

    const neckline = p1.price
    const height = Math.abs((p0.price + p2.price) / 2 - neckline)
    const breakIdx = firstCloseBeyond(candles, p2.index, neckline, isTop ? 'below' : 'above')
    let status: PatternDetection['status'] = 'forming'
    let breakBar = ctx.lastIndex
    if (breakIdx != null) { status = 'confirmed'; breakBar = breakIdx }

    // failed: blew past the double extreme after the second test
    const ext = isTop ? Math.max(p0.price, p2.price) : Math.min(p0.price, p2.price)
    const breached = isTop
      ? candles.slice(p2.index + 1).some(x => x.close > ext * 1.005)
      : candles.slice(p2.index + 1).some(x => x.close < ext * 0.995)
    if (breached && status !== 'confirmed') status = 'failed'

    const target = isTop ? neckline - height : neckline + height
    const geometryQuality = clamp(1 - pct(p0.price, p2.price) / 0.02, 0, 1) * 0.7
      + clamp(retrace / (atr * 4), 0, 1) * 0.3

    const breakVol = candles[breakBar]?.volume ?? 0
    const volumeConfirmed = breakVol > ctx.avgVol * 1.3
      && volAvg(candles, p2.index - 2, p2.index + 2) < volAvg(candles, p0.index - 2, p0.index + 2)

    const id = isTop ? 'double_top' : 'double_bottom'
    const name = isTop ? 'Double Top' : 'Double Bottom'
    const dir = isTop ? 'bearish' : 'bullish'

    const points = [
      { time: p0.time, price: p0.price, label: isTop ? 'Top 1' : 'Bottom 1' },
      { time: p1.time, price: p1.price, label: 'Neck' },
      { time: p2.time, price: p2.price, label: isTop ? 'Top 2' : 'Bottom 2' },
    ]
    const lines = [
      { a: points[0], b: points[1], style: 'solid' as const, role: 'pattern' as const },
      { a: points[1], b: points[2], style: 'solid' as const, role: 'pattern' as const },
      {
        a: { time: p1.time, price: neckline },
        b: { time: candles[Math.min(ctx.lastIndex, breakBar)].time, price: neckline },
        style: 'dashed' as const, role: 'neckline' as const,
      },
    ]
    const verb = status === 'confirmed' ? 'broke' : 'is testing'
    out.push(buildGeo({
      id, name, category: 'reversal', direction: dir, status,
      startIndex: p0.index, endIndex: p2.index,
      points, lines,
      breakoutLevel: neckline, target, invalidation: ext,
      geometryQuality, volumeConfirmed,
      ageBars: status === 'confirmed' ? ctx.lastIndex - breakBar : 0,
      implication:
        `${dir === 'bearish' ? 'Bearish' : 'Bullish'} reversal. Two ${isTop ? 'highs' : 'lows'} near ${fmt((p0.price + p2.price) / 2)}; ` +
        `price ${verb} the neckline at ${fmt(neckline)}, projecting ~${fmt(target)}. Invalidated ${isTop ? 'above' : 'below'} ${fmt(ext)}.`,
      ctx,
    }))
  }
  return out
}
