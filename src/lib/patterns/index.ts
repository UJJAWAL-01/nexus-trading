// ─────────────────────────────────────────────────────────────────────────────
// NEXUS Pattern Engine — public API (spec §1, §6 Phase 2).
//
//   detectAll(candles, opts) → { candlestick, geometric, structure, rating }
//
// ONE detection engine, two consumers: the ChartPanel (browser) and the
// pattern scanner (`/api/pattern-scan`, server) call this exact function.
// Pure math, no React, no fetch. Budget < 50ms on ~1500 candles.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Candle, DetectAllResult, DetectOptions, PatternDetection, TaRating, TrendStructure,
} from './types'
import { detectPivots } from './pivots'
import { detectCandlestick } from './candlestick'
import { analyzeStructure } from './trendStructure'
import { computeRating } from './taRating'
import { buildGeoContext } from './geometric/util'
import { detectHeadShoulders } from './geometric/headShoulders'
import { detectDoubleTopBottom } from './geometric/doubleTopBottom'
import { detectTripleTopBottom } from './geometric/tripleTopBottom'
import { detectTriangles } from './geometric/triangles'
import { detectWedges } from './geometric/wedges'
import { detectChannels } from './geometric/channels'
import { detectFlagsPennants } from './geometric/flagsPennants'
import { detectCupHandle } from './geometric/cupHandle'
import { detectRoundingBottom } from './geometric/roundingBottom'

export * from './types'
export { detectPivots } from './pivots'
export { computeRating, labelFor } from './taRating'
export { analyzeStructure } from './trendStructure'

/** Fraction of the smaller span shared by two index ranges. */
function overlapRatio(a: PatternDetection, b: PatternDetection): number {
  const lo = Math.max(a.startIndex, b.startIndex)
  const hi = Math.min(a.endIndex, b.endIndex)
  const inter = Math.max(0, hi - lo)
  const spanA = Math.max(1, a.endIndex - a.startIndex)
  const spanB = Math.max(1, b.endIndex - b.startIndex)
  return inter / Math.min(spanA, spanB)
}

/**
 * Dedup policy (spec §1.3): within overlapping detections of the same category,
 * keep the highest-confidence one. Different categories (e.g. a flag inside a
 * channel) are kept — they describe different things at different scales.
 */
function dedupe(dets: PatternDetection[]): PatternDetection[] {
  const sorted = [...dets].sort((a, b) => b.confidence - a.confidence)
  const kept: PatternDetection[] = []
  for (const d of sorted) {
    const clash = kept.some(k => k.category === d.category && overlapRatio(k, d) > 0.6)
    if (!clash) kept.push(d)
  }
  return kept.sort((a, b) => a.startIndex - b.startIndex)
}

const EMPTY_RATING: TaRating = {
  overall: { score: 0, buys: 0, sells: 0, neutrals: 0, label: 'neutral', votes: [] },
  movingAvg: { score: 0, buys: 0, sells: 0, neutrals: 0, label: 'neutral', votes: [] },
  oscillators: { score: 0, buys: 0, sells: 0, neutrals: 0, label: 'neutral', votes: [] },
}
const EMPTY_STRUCTURE: TrendStructure = {
  bias: 'range', swingPoints: [], lastEvent: null, support: null, resistance: null, label: 'Range',
}

export function detectAll(candles: Candle[], opts: DetectOptions = {}): DetectAllResult {
  if (!candles || candles.length < 5) {
    return { candlestick: [], geometric: [], structure: EMPTY_STRUCTURE, rating: EMPTY_RATING }
  }

  const tiers = detectPivots(candles, opts.pivotAtrMult)

  const candlestick = opts.geometricOnly
    ? []
    : detectCandlestick(candles, { window: opts.candleScanWindow, tf: opts.timeframe })

  let geometric: PatternDetection[] = []
  if (!opts.candlestickOnly) {
    const gctx = buildGeoContext(candles, tiers, opts.timeframe)
    const minConf = opts.minGeometricConfidence ?? 50
    geometric = dedupe([
      ...detectHeadShoulders(gctx),
      ...detectDoubleTopBottom(gctx),
      ...detectTripleTopBottom(gctx),
      ...detectTriangles(gctx),
      ...detectWedges(gctx),
      ...detectChannels(gctx),
      ...detectFlagsPennants(gctx),
      ...detectCupHandle(gctx),
      ...detectRoundingBottom(gctx),
    ])
      // Surface only tradeable-quality structure: drop already-invalidated
      // ('failed') patterns and anything below the quality floor.
      .filter(d => d.status !== 'failed' && d.confidence >= minConf)
  }

  return {
    candlestick,
    geometric,
    structure: analyzeStructure(candles, tiers),
    rating: computeRating(candles),
  }
}
