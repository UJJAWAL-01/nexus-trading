// ─────────────────────────────────────────────────────────────────────────────
// Unified confidence model (spec §1.6).
//
//   confidence = clamp(
//        base(pattern)
//      + geometryQuality × 15
//      + volumeConfirm   × 10
//      + trendContext    × 10
//      + timeframeBonus  × 5
//      − ageDecay
//   , 0, 100)
//
// Every component is returned in the breakdown so the UI can explain *why* a
// score is what it is. This is "pattern quality", never a probability of profit.
// ─────────────────────────────────────────────────────────────────────────────

import type { ConfidenceBreakdown, Timeframe } from './types'
import { clamp } from './indicators'

/** Textbook reliability priors, keyed by pattern id (fallbacks below). */
export const BASE_CONFIDENCE: Record<string, number> = {
  // Geometric reversals
  head_shoulders: 70, inverse_head_shoulders: 70,
  double_top: 65, double_bottom: 65,
  triple_top: 66, triple_bottom: 66,
  cup_handle: 64, rounding_bottom: 58,
  // Geometric continuations / bilateral
  ascending_triangle: 60, descending_triangle: 60, symmetrical_triangle: 58,
  rising_wedge: 60, falling_wedge: 60,
  bull_flag: 65, bear_flag: 65, bull_pennant: 63, bear_pennant: 63,
  rectangle: 55, channel_up: 55, channel_down: 55, broadening: 50,
}

const SINGLE_CANDLE_BASE = 40
const MULTI_CANDLE_BASE = 50

export function baseFor(id: string, kind: 'candlestick' | 'geometric', bars: number): number {
  if (id in BASE_CONFIDENCE) return BASE_CONFIDENCE[id]
  if (kind === 'candlestick') return bars >= 2 ? MULTI_CANDLE_BASE : SINGLE_CANDLE_BASE
  return 55
}

/** Timeframe weighting: intraday detections score below daily/weekly. */
export function timeframeWeight(tf: Timeframe | undefined): number {
  switch (tf) {
    case '1m': case '5m':  return 0.1
    case '15m': case '30m': return 0.3
    case '1h':  return 0.5
    case '4h':  return 0.7
    case '1D':  return 1.0
    case '1W':  return 1.0
    case '1M':  return 0.9
    default:    return 0.7   // unknown — treat as a higher TF, mildly discounted
  }
}

export interface ScoreInput {
  base:            number
  geometryQuality: number   // 0–1
  volumeConfirm:   boolean
  trendContext:    number   // 0–1 (how well trend agrees with the pattern's context)
  timeframe?:      Timeframe
  ageBars?:        number   // bars since breakout/confirmation
}

export function scoreConfidence(i: ScoreInput): ConfidenceBreakdown {
  const geometryQuality = clamp(i.geometryQuality, 0, 1) * 15
  const volumeConfirm   = i.volumeConfirm ? 10 : 0
  const trendContext    = clamp(i.trendContext, 0, 1) * 10
  const timeframeBonus  = timeframeWeight(i.timeframe) * 5
  const ageDecay        = i.ageBars && i.ageBars > 0 ? i.ageBars / 2 : 0
  const total = clamp(
    i.base + geometryQuality + volumeConfirm + trendContext + timeframeBonus - ageDecay,
    0, 100,
  )
  return {
    base: i.base,
    geometryQuality: +geometryQuality.toFixed(1),
    volumeConfirm,
    trendContext: +trendContext.toFixed(1),
    timeframeBonus: +timeframeBonus.toFixed(1),
    ageDecay: +ageDecay.toFixed(1),
    total: Math.round(total),
  }
}
