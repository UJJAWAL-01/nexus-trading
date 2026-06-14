// ─────────────────────────────────────────────────────────────────────────────
// Shared scaffolding for geometric pattern detectors.
//
// A single GeoContext (candles + pre-computed pivot tiers + ATR series + volume
// baseline) is built once and threaded into every detector, so the whole
// geometric pass is one cheap sweep over the zigzag chains.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Candle, PatternDetection, PatternDirection, PatternCategory,
  PatternStatus, PatternPoint, PatternLine, Timeframe,
} from '../types'
import type { PivotTiers } from '../pivots'
import { atrSeries, atr as atrLast, linreg, clamp } from '../indicators'
import { baseFor, scoreConfidence } from '../confidence'

export interface GeoContext {
  candles:  Candle[]
  tiers:    PivotTiers
  atrAt:    Array<number | null>
  atr:      number
  avgVol:   number
  tf?:      Timeframe
  lastIndex: number
  lastClose: number
}

export function buildGeoContext(candles: Candle[], tiers: PivotTiers, tf?: Timeframe): GeoContext {
  const vols = candles.map(c => c.volume)
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0
  return {
    candles, tiers,
    atrAt: atrSeries(candles, 14),
    atr: atrLast(candles, 14),
    avgVol,
    tf,
    lastIndex: candles.length - 1,
    lastClose: candles[candles.length - 1]?.close ?? 0,
  }
}

export const fmt = (n: number): string =>
  n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4)

/** Average volume over [from, to] inclusive. */
export function volAvg(candles: Candle[], from: number, to: number): number {
  const a = Math.max(0, from), b = Math.min(candles.length - 1, to)
  if (b < a) return 0
  let s = 0
  for (let i = a; i <= b; i++) s += candles[i].volume
  return s / (b - a + 1)
}

export interface PriorTrend { norm: number; r2: number }

/**
 * Prior-trend slope (ATR units/bar) and regression R² over the `lookback` bars
 * ending at `endIndex`. A *real* trend needs both a meaningful slope and a high
 * R²; a random-walk run has a weak slope and/or low R², which is what lets the
 * reversal detectors reject chance-equal noise swings.
 */
export function priorTrend(ctx: GeoContext, endIndex: number, lookback = 20): PriorTrend {
  const start = Math.max(0, endIndex - lookback)
  if (endIndex - start < 4) return { norm: 0, r2: 0 }
  const closes = ctx.candles.slice(start, endIndex + 1).map(c => c.close)
  const { slope, r2 } = linreg(closes)
  const a = ctx.atrAt[endIndex] ?? ctx.atr
  return { norm: a > 0 ? slope / a : 0, r2 }
}

export function priorTrendNorm(ctx: GeoContext, endIndex: number, lookback = 20): number {
  return priorTrend(ctx, endIndex, lookback).norm
}

/**
 * Does a genuine trend precede a reversal at `beforeIndex`? `wantUp` = the
 * reversal needs a prior uptrend (bearish reversal) vs downtrend (bullish).
 */
export function hasReversalContext(ctx: GeoContext, beforeIndex: number, wantUp: boolean): boolean {
  const t = priorTrend(ctx, beforeIndex, 20)
  if (t.r2 < 0.4) return false
  return wantUp ? t.norm >= 0.15 : t.norm <= -0.15
}

/**
 * How well the trend context agrees with a detection (0–1).
 *  - reversal: trend should oppose the breakout direction
 *  - continuation: trend should align with the breakout direction
 */
export function trendAgreement(
  ctx: GeoContext, startIndex: number, category: PatternCategory, direction: PatternDirection,
): number {
  if (category === 'bilateral' || direction === 'neutral') return 0.5
  const norm = priorTrendNorm(ctx, Math.max(3, startIndex), 20)
  const wantUp = category === 'continuation' ? direction === 'bullish' : direction === 'bearish'
  const signed = wantUp ? norm : -norm
  return clamp(signed / 0.3, 0, 1)
}

export interface GeoBuildArgs {
  id: string; name: string
  category: PatternCategory
  direction: PatternDirection
  status: PatternStatus
  startIndex: number; endIndex: number
  points: PatternPoint[]
  lines: PatternLine[]
  breakoutLevel: number | null
  target: number | null
  invalidation: number | null
  geometryQuality: number      // 0–1
  volumeConfirmed: boolean
  implication: string
  ageBars?: number
  ctx: GeoContext
}

export function buildGeo(a: GeoBuildArgs): PatternDetection {
  const breakdown = scoreConfidence({
    base: baseFor(a.id, 'geometric', 0),
    geometryQuality: a.geometryQuality,
    volumeConfirm: a.volumeConfirmed,
    trendContext: trendAgreement(a.ctx, a.startIndex, a.category, a.direction),
    timeframe: a.ctx.tf,
    ageBars: a.status === 'confirmed' ? (a.ageBars ?? 0) : 0,
  })
  return {
    id: a.id, name: a.name, kind: 'geometric',
    category: a.category, direction: a.direction, status: a.status,
    confidence: breakdown.total, confidenceBreakdown: breakdown,
    startIndex: a.startIndex, endIndex: a.endIndex,
    points: a.points, lines: a.lines,
    breakoutLevel: a.breakoutLevel, target: a.target, invalidation: a.invalidation,
    volumeConfirmed: a.volumeConfirmed,
    implication: a.implication,
  }
}

/** Did price close beyond a level after `index`? Returns the first such index. */
export function firstCloseBeyond(
  candles: Candle[], fromIndex: number, level: number, dir: 'above' | 'below',
): number | null {
  for (let i = fromIndex; i < candles.length; i++) {
    if (dir === 'above' && candles[i].close > level) return i
    if (dir === 'below' && candles[i].close < level) return i
  }
  return null
}

export const pct = (a: number, b: number): number => (b === 0 ? Infinity : Math.abs(a - b) / Math.abs(b))
