// Head & Shoulders / Inverse H&S (spec §1.3).
//
// 5 alternating pivots on the k=5 tier: shoulders within 3% of each other, head
// ≥1.5% beyond both, neckline through the two intervening pivots (slope ≤ ±25°).
// forming above neckline → confirmed on a close beyond it → failed past the head.

import type { PatternDetection, PivotPoint } from '../types'
import { clamp } from '../indicators'
import {
  GeoContext, buildGeo, fmt, pct, firstCloseBeyond, volAvg, hasReversalContext,
} from './util'

function necklineAt(b: PivotPoint, d: PivotPoint, index: number): number {
  const slope = (d.price - b.price) / (d.index - b.index || 1)
  return b.price + slope * (index - b.index)
}
function necklineAngleOk(b: PivotPoint, d: PivotPoint, atr: number): boolean {
  const slopePerBar = (d.price - b.price) / (d.index - b.index || 1)
  // ±25° with ATR-scaled normalisation: |slope| small relative to ATR/bar.
  return Math.abs(slopePerBar) <= atr * 0.7
}

export function detectHeadShoulders(ctx: GeoContext): PatternDetection[] {
  const piv = ctx.tiers.k5
  const out: PatternDetection[] = []
  const { candles, atr } = ctx

  for (let i = 0; i + 4 < piv.length; i++) {
    const a = piv[i], b = piv[i + 1], c = piv[i + 2], d = piv[i + 3], e = piv[i + 4]

    const isTop = a.type === 'high' && c.type === 'high' && e.type === 'high' && b.type === 'low' && d.type === 'low'
    const isBot = a.type === 'low' && c.type === 'low' && e.type === 'low' && b.type === 'high' && d.type === 'high'
    if (!isTop && !isBot) continue

    const ls = a.price, head = c.price, rs = e.price
    const shoulderDiff = pct(ls, rs)
    if (shoulderDiff > 0.03) continue
    if (!necklineAngleOk(b, d, atr)) continue

    // Time symmetry: a textbook H&S has roughly equidistant shoulders. Random
    // five-pivot alignments are usually lopsided in time — reject those.
    const leftSpan = c.index - a.index
    const rightSpan = e.index - c.index
    const totalSpan = e.index - a.index || 1
    if (Math.abs(leftSpan - rightSpan) / totalSpan > 0.5) continue

    if (isTop && !(head >= ls * 1.015 && head >= rs * 1.015)) continue
    if (isBot && !(head <= ls * 0.985 && head <= rs * 0.985)) continue

    // Reversal context: a top forms after an uptrend, an inverse after a downtrend.
    if (!hasReversalContext(ctx, a.index, isTop)) continue

    // Structural significance: the head must clear the shoulders by a real margin
    // and the whole formation must be tall vs ATR — kills chance-aligned noise.
    const shoulderAvg = (ls + rs) / 2
    if (Math.abs(head - shoulderAvg) < 2.5 * atr) continue
    if (Math.abs(head - necklineAt(b, d, c.index)) < 3 * atr) continue

    const breakIdx = firstCloseBeyond(candles, e.index, necklineAt(b, d, ctx.lastIndex), isTop ? 'below' : 'above')
    const neckNow = necklineAt(b, d, ctx.lastIndex)
    let status: PatternDetection['status'] = 'forming'
    let breakBar = ctx.lastIndex
    if (breakIdx != null) { status = 'confirmed'; breakBar = breakIdx }

    // failure: price ran back past the head after forming
    const headBreached = isTop
      ? candles.slice(e.index).some(x => x.close > head)
      : candles.slice(e.index).some(x => x.close < head)
    if (headBreached && status !== 'confirmed') status = 'failed'

    const neckAtBreak = necklineAt(b, d, breakBar)
    const target = isTop ? neckAtBreak - (head - neckAtBreak) : neckAtBreak + (neckAtBreak - head)

    // geometry quality: symmetric shoulders + prominent head + flat neckline
    const symmetry = clamp(1 - shoulderDiff / 0.03, 0, 1)
    const prominence = clamp(Math.abs(head - (ls + rs) / 2) / (atr * 3), 0, 1)
    const geometryQuality = symmetry * 0.6 + prominence * 0.4

    // volume: declining into the right shoulder, expansion on the break
    const headVol = volAvg(candles, c.index - 2, c.index + 2)
    const rsVol = volAvg(candles, e.index - 2, e.index + 2)
    const breakVol = candles[breakBar]?.volume ?? 0
    const volumeConfirmed = rsVol < headVol && breakVol > ctx.avgVol * 1.2

    const id = isTop ? 'head_shoulders' : 'inverse_head_shoulders'
    const name = isTop ? 'Head & Shoulders' : 'Inverse Head & Shoulders'
    const dir = isTop ? 'bearish' : 'bullish'

    const points = [
      { time: a.time, price: a.price, label: 'LS' },
      { time: b.time, price: b.price },
      { time: c.time, price: c.price, label: 'H' },
      { time: d.time, price: d.price },
      { time: e.time, price: e.price, label: 'RS' },
    ]
    const lines = [
      { a: points[0], b: points[1], style: 'solid' as const, role: 'pattern' as const },
      { a: points[1], b: points[2], style: 'solid' as const, role: 'pattern' as const },
      { a: points[2], b: points[3], style: 'solid' as const, role: 'pattern' as const },
      { a: points[3], b: points[4], style: 'solid' as const, role: 'pattern' as const },
      // neckline extended through the break
      {
        a: { time: b.time, price: b.price },
        b: { time: candles[Math.min(ctx.lastIndex, breakBar)].time, price: neckAtBreak },
        style: 'dashed' as const, role: 'neckline' as const,
      },
    ]

    const verb = status === 'confirmed' ? 'broke' : 'is testing'
    out.push(buildGeo({
      id, name, category: 'reversal', direction: dir, status,
      startIndex: a.index, endIndex: e.index,
      points, lines,
      breakoutLevel: neckNow, target, invalidation: head,
      geometryQuality, volumeConfirmed,
      ageBars: status === 'confirmed' ? ctx.lastIndex - breakBar : 0,
      implication:
        `${dir === 'bearish' ? 'Bearish' : 'Bullish'} reversal. Price ${verb} the neckline at ${fmt(neckNow)}; ` +
        `a confirmed break projects a measured move to ~${fmt(target)}. Invalidated ${isTop ? 'above' : 'below'} the head at ${fmt(head)}.`,
      ctx,
    }))
  }
  return out
}
