// Flags & Pennants (spec §1.3) — the bread-and-butter momentum continuations.
//
// Require a "pole": a move ≥ 4·ATR within ≤ 10 bars. Then a consolidation of
// 5–20 bars retracing < 50% of the pole, held in a small parallel channel
// (flag, counter-sloped to the pole) or a tiny symmetric triangle (pennant).
// Volume must contract through the consolidation. Target = pole height from the
// breakout.

import type { PatternDetection, PatternDirection } from '../types'
import { fitLine } from '../trendlines'
import { clamp } from '../indicators'
import { GeoContext, buildGeo, fmt, volAvg } from './util'

export function detectFlagsPennants(ctx: GeoContext): PatternDetection[] {
  const { candles, atr } = ctx
  const n = candles.length
  if (n < 12 || atr <= 0) return []
  const consoEnd = ctx.lastIndex

  let best: {
    poleStart: number; poleEnd: number; consoStart: number
    move: number; poleHeight: number; up: boolean
  } | null = null

  for (let consoLen = 5; consoLen <= 20; consoLen++) {
    const consoStart = consoEnd - consoLen + 1
    const poleEnd = consoStart - 1
    if (poleEnd < 3) break
    for (let poleLen = 3; poleLen <= 10; poleLen++) {
      const poleStart = poleEnd - poleLen + 1
      if (poleStart < 0) break
      const move = candles[poleEnd].close - candles[poleStart].close
      const poleHeight = Math.abs(move)
      if (poleHeight < 4 * atr) continue

      const up = move > 0
      // consolidation retraces < 50% of the pole
      const consol = candles.slice(consoStart, consoEnd + 1)
      const cHi = Math.max(...consol.map(c => c.high))
      const cLo = Math.min(...consol.map(c => c.low))
      const retrace = up ? candles[poleEnd].close - cLo : cHi - candles[poleEnd].close
      if (retrace > poleHeight * 0.5) continue
      // consolidation must be tight relative to the pole
      if (cHi - cLo > poleHeight * 0.6) continue
      // volume contracts
      if (volAvg(candles, consoStart, consoEnd) >= volAvg(candles, poleStart, poleEnd)) continue

      if (!best || poleHeight > best.poleHeight) {
        best = { poleStart, poleEnd, consoStart, move, poleHeight, up }
      }
    }
  }
  if (!best) return []

  const { poleStart, poleEnd, consoStart, poleHeight, up } = best
  const consol = candles.slice(consoStart, consoEnd + 1)
  const dir: PatternDirection = up ? 'bullish' : 'bearish'

  // classify flag (parallel channel) vs pennant (converging) from the
  // consolidation's high/low slopes
  const hiPts = consol.map((c, k) => ({ index: consoStart + k, time: c.time, price: c.high, type: 'high' as const, strength: 1 }))
  const loPts = consol.map((c, k) => ({ index: consoStart + k, time: c.time, price: c.low, type: 'low' as const, strength: 1 }))
  const upLine = fitLine(hiPts, atr, ctx.lastClose)
  const loLine = fitLine(loPts, atr, ctx.lastClose)
  const converging = upLine && loLine && upLine.slope < 0 && loLine.slope > 0
  const isPennant = converging
  const id = isPennant ? (up ? 'bull_pennant' : 'bear_pennant') : (up ? 'bull_flag' : 'bear_flag')
  const name = isPennant ? (up ? 'Bullish Pennant' : 'Bearish Pennant') : (up ? 'Bull Flag' : 'Bear Flag')

  const cHi = Math.max(...consol.map(c => c.high))
  const cLo = Math.min(...consol.map(c => c.low))
  const breakoutLevel = up ? cHi : cLo
  const close = ctx.lastClose
  const status: PatternDetection['status'] = up ? (close > cHi ? 'confirmed' : 'forming') : (close < cLo ? 'confirmed' : 'forming')
  const target = up ? breakoutLevel + poleHeight : breakoutLevel - poleHeight
  const invalidation = up ? cLo : cHi

  const geometryQuality = clamp(poleHeight / (atr * 8), 0, 1) * 0.6
    + clamp(1 - (cHi - cLo) / (poleHeight * 0.6), 0, 1) * 0.4

  const c = candles
  const lines = [
    { a: { time: c[poleStart].time, price: c[poleStart].close }, b: { time: c[poleEnd].time, price: c[poleEnd].close },
      style: 'solid' as const, role: 'pattern' as const },
    { a: { time: c[consoStart].time, price: cHi }, b: { time: c[consoEnd].time, price: cHi },
      style: 'dashed' as const, role: 'resistance' as const },
    { a: { time: c[consoStart].time, price: cLo }, b: { time: c[consoEnd].time, price: cLo },
      style: 'dashed' as const, role: 'support' as const },
  ]
  const verb = status === 'confirmed' ? 'broke out' : 'is consolidating'
  return [buildGeo({
    id, name, category: 'continuation', direction: dir, status,
    startIndex: poleStart, endIndex: consoEnd,
    points: [
      { time: c[poleStart].time, price: c[poleStart].close, label: 'Pole' },
      { time: c[poleEnd].time, price: c[poleEnd].close },
    ],
    lines,
    breakoutLevel, target, invalidation,
    geometryQuality,
    volumeConfirmed: status === 'confirmed' && (c[ctx.lastIndex]?.volume ?? 0) > ctx.avgVol * 1.3,
    ageBars: 0,
    implication:
      `${name} — ${dir} continuation after a ${fmt(poleHeight)}-point pole. Price ${verb} ` +
      `${up ? 'above' : 'below'} ${fmt(breakoutLevel)}; measured move targets ~${fmt(target)}.`,
    ctx,
  })]
}
