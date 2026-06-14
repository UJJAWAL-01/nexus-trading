// Rectangles, parallel channels, and broadening formations (spec §1.3).
//
//  - rectangle / channel: two roughly-parallel boundaries, ≥2 touches each,
//    high fit quality. Bilateral until a close breaks out.
//  - broadening: diverging boundaries (upper rising, lower falling) with ≥5
//    alternating touches — flagged as a high-volatility bilateral structure.

import type { PatternDetection } from '../types'
import { lineValueAt, isHorizontal } from '../trendlines'
import { clamp } from '../indicators'
import { GeoContext, buildGeo, fmt } from './util'
import { gatherDualFit } from './lines'

export function detectChannels(ctx: GeoContext): PatternDetection[] {
  const fit = gatherDualFit(ctx, 'k5', { minLookback: 20, maxLookback: 140, maxDevAtr: 1.0 })
  if (!fit) return []
  const { upper, lower, highs, lows, startIndex, endIndex } = fit
  const out: PatternDetection[] = []

  const upNow = lineValueAt(upper, ctx.lastIndex)
  const loNow = lineValueAt(lower, ctx.lastIndex)
  const close = ctx.lastClose
  const c = ctx.candles
  const linesOf = () => [
    { a: { time: c[startIndex].time, price: lineValueAt(upper, startIndex) },
      b: { time: c[ctx.lastIndex].time, price: upNow }, style: 'solid' as const, role: 'resistance' as const },
    { a: { time: c[startIndex].time, price: lineValueAt(lower, startIndex) },
      b: { time: c[ctx.lastIndex].time, price: loNow }, style: 'solid' as const, role: 'support' as const },
  ]
  const points = [...highs, ...lows].map(p => ({ time: p.time, price: p.price }))

  const slopeDiff = Math.abs(upper.angleDeg - lower.angleDeg)
  const parallel = slopeDiff < 8
  const diverging = upper.angleDeg > 3 && lower.angleDeg < -3
  const height = fit.startHeight

  // ── Rectangle / Channel (parallel) ───────────────────────────────────────
  if (parallel && highs.length >= 2 && lows.length >= 2 && upper.r2 >= 0.9 && lower.r2 >= 0.9) {
    const flat = isHorizontal(upper, 8) && isHorizontal(lower, 8)
    let status: PatternDetection['status'] = 'forming'
    let direction: PatternDetection['direction'] = 'neutral'
    let breakoutLevel: number | null = null
    let target: number | null = null
    if (close > upNow) { status = 'confirmed'; direction = 'bullish'; breakoutLevel = upNow; target = upNow + height }
    else if (close < loNow) { status = 'confirmed'; direction = 'bearish'; breakoutLevel = loNow; target = loNow - height }

    const id = flat ? 'rectangle' : upper.angleDeg > 0 ? 'channel_up' : 'channel_down'
    const name = flat ? 'Rectangle' : upper.angleDeg > 0 ? 'Ascending Channel' : 'Descending Channel'
    const geometryQuality = clamp((upper.r2 + lower.r2) / 2, 0, 1) * 0.8 + clamp(1 - slopeDiff / 8, 0, 1) * 0.2
    out.push(buildGeo({
      id, name, category: 'bilateral', direction, status,
      startIndex, endIndex, points, lines: linesOf(),
      breakoutLevel, target, invalidation: direction === 'bullish' ? loNow : direction === 'bearish' ? upNow : null,
      geometryQuality,
      volumeConfirmed: status === 'confirmed' && (c[ctx.lastIndex]?.volume ?? 0) > ctx.avgVol * 1.3,
      implication:
        `${name} between ${fmt(loNow)} and ${fmt(upNow)}. ` +
        (status === 'confirmed'
          ? `Broke ${direction === 'bullish' ? 'up' : 'down'} — projects ~${fmt(target!)}.`
          : `Range-bound; trade the edges until a close breaks out.`),
      ctx,
    }))
  }

  // ── Broadening (diverging, ≥5 alternating touches) ───────────────────────
  if (diverging && highs.length + lows.length >= 5) {
    const geometryQuality = clamp((upper.r2 + lower.r2) / 2, 0, 1) * 0.6 + 0.2
    out.push(buildGeo({
      id: 'broadening', name: 'Broadening Formation', category: 'bilateral', direction: 'neutral',
      status: 'forming', startIndex, endIndex, points, lines: linesOf(),
      breakoutLevel: null, target: null, invalidation: null,
      geometryQuality, volumeConfirmed: false,
      implication:
        `Broadening formation — expanding volatility between ${fmt(loNow)} and ${fmt(upNow)}. ` +
        `Megaphone structure; widening swings favour breakout traders over range traders.`,
      ctx,
    }))
  }

  return out
}
