// ─────────────────────────────────────────────────────────────────────────────
// Candlestick pattern detection (spec §1.3).
//
// Every threshold is expressed relative to the candle's own range and to
// ATR(14) — never absolute prices. The critical quality rule is CONTEXT GATING:
// a Hammer only matters after a downswing, a Shooting Star after an upswing.
// Prior 5-bar regression slope (normalised by ATR) must agree with the
// pattern's reversal context, or the detection is suppressed / penalised.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Candle, PatternDetection, PatternDirection, Timeframe,
} from './types'
import { atrSeries, atr as atrLast, linreg, clamp } from './indicators'
import { baseFor, scoreConfidence } from './confidence'

interface Metrics {
  body: number; range: number; upper: number; lower: number
  bull: boolean; bear: boolean; mid: number
  bodyTop: number; bodyBot: number
}

function metrics(c: Candle): Metrics {
  const body = Math.abs(c.close - c.open)
  const range = Math.max(c.high - c.low, 1e-9)
  const bodyTop = Math.max(c.open, c.close)
  const bodyBot = Math.min(c.open, c.close)
  return {
    body, range,
    upper: c.high - bodyTop,
    lower: bodyBot - c.low,
    bull: c.close > c.open,
    bear: c.close < c.open,
    mid: (c.open + c.close) / 2,
    bodyTop, bodyBot,
  }
}

export interface CandlestickContext {
  candles: Candle[]
  atrAt:   Array<number | null>
  atr:     number
  avgVol:  number
  tf?:     Timeframe
}

function buildContext(candles: Candle[], tf?: Timeframe): CandlestickContext {
  const vols = candles.map(c => c.volume)
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0
  return { candles, atrAt: atrSeries(candles, 14), atr: atrLast(candles, 14), avgVol, tf }
}

interface TrendInfo {
  /** Slope of prior closes in ATR units per bar. Negative = downswing. */
  norm: number
  /** R² of the regression — how cleanly directional the swing is (0–1). */
  r2: number
}

/**
 * Prior-trend strength ending just before `i`. Returns both the ATR-normalised
 * slope and the regression R². A *real* swing needs both a meaningful slope and
 * a high R²; chop has a near-zero slope and/or a low R², which is what lets the
 * context gate reject hammers/stars on trendless noise.
 */
function priorTrend(ctx: CandlestickContext, i: number, lookback = 5): TrendInfo {
  const start = Math.max(0, i - lookback)
  if (i - start < 2) return { norm: 0, r2: 0 }
  const closes = ctx.candles.slice(start, i).map(c => c.close)
  const { slope, r2 } = linreg(closes)
  const a = ctx.atrAt[i] ?? ctx.atr
  return { norm: a > 0 ? slope / a : 0, r2 }
}

const fmt = (n: number) => n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4)

interface BuildArgs {
  id: string; name: string
  direction: PatternDirection
  bars: number
  startIndex: number; endIndex: number
  geometry: number        // 0–1 shape quality
  volumeConfirm: boolean
  trendContext: number    // 0–1
  invalidation: number | null
  implication: string
  ctx: CandlestickContext
}

function build(a: BuildArgs): PatternDetection {
  const c = a.ctx.candles
  const points = []
  for (let k = a.startIndex; k <= a.endIndex; k++) {
    points.push({ time: c[k].time, price: c[k].close })
  }
  const ageBars = c.length - 1 - a.endIndex
  const breakdown = scoreConfidence({
    base: baseFor(a.id, 'candlestick', a.bars),
    geometryQuality: a.geometry,
    volumeConfirm: a.volumeConfirm,
    trendContext: a.trendContext,
    timeframe: a.ctx.tf,
    ageBars: 0,    // candlesticks are points in time; no post-breakout decay
  })
  void ageBars
  return {
    id: a.id, name: a.name, kind: 'candlestick',
    category: 'reversal',
    direction: a.direction,
    status: 'confirmed',         // candlesticks are complete-bar events
    confidence: breakdown.total,
    confidenceBreakdown: breakdown,
    startIndex: a.startIndex, endIndex: a.endIndex,
    points,
    lines: [],
    breakoutLevel: null,
    target: null,
    invalidation: a.invalidation,
    volumeConfirmed: a.volumeConfirm,
    implication: a.implication,
  }
}

/**
 * Detect candlestick patterns. Scans the last `opts.window` bars (default 10)
 * but computes ATR/trend over the full series. Pass a large window for the
 * full-series screener pass.
 */
export function detectCandlestick(
  candles: Candle[],
  opts: { window?: number; tf?: Timeframe } = {},
): PatternDetection[] {
  const n = candles.length
  if (n < 5) return []
  const ctx = buildContext(candles, opts.tf)
  const window = opts.window ?? 10
  const startScan = Math.max(2, n - window)
  const out: PatternDetection[] = []

  const m = candles.map(metrics)
  const big = (i: number) => ctx.atrAt[i] ?? ctx.atr   // local ATR
  const volUp = (i: number) => ctx.avgVol > 0 && candles[i].volume > ctx.avgVol * 1.2

  for (let i = startScan; i < n; i++) {
    const c = candles[i], p = candles[i - 1], pp = candles[i - 2]
    const mi = m[i], mp = m[i - 1], mpp = m[i - 2]
    const a = big(i)
    const tInfo = priorTrend(ctx, i)
    const trend = tInfo.norm
    // A "real" swing: meaningful slope AND a cleanly directional regression.
    const realDown = tInfo.norm <= -0.2 && tInfo.r2 >= 0.45
    const realUp   = tInfo.norm >=  0.2 && tInfo.r2 >= 0.45
    const isDoji = mi.body < mi.range * 0.10

    // ── Single-bar ──────────────────────────────────────────────────────────

    // Doji family
    if (isDoji) {
      if (mi.lower > mi.range * 0.6 && mi.upper < mi.range * 0.1) {
        out.push(build({ id: 'dragonfly_doji', name: 'Dragonfly Doji', direction: 'bullish', bars: 1,
          startIndex: i, endIndex: i, geometry: clamp(mi.lower / mi.range, 0, 1),
          volumeConfirm: volUp(i), trendContext: clamp(-trend / 0.3, 0, 1),
          invalidation: c.low, implication: `Bullish reversal signal — long lower shadow rejected lower prices near ${fmt(c.low)}.`, ctx }))
      } else if (mi.upper > mi.range * 0.6 && mi.lower < mi.range * 0.1) {
        out.push(build({ id: 'gravestone_doji', name: 'Gravestone Doji', direction: 'bearish', bars: 1,
          startIndex: i, endIndex: i, geometry: clamp(mi.upper / mi.range, 0, 1),
          volumeConfirm: volUp(i), trendContext: clamp(trend / 0.3, 0, 1),
          invalidation: c.high, implication: `Bearish reversal signal — long upper shadow rejected higher prices near ${fmt(c.high)}.`, ctx }))
      } else {
        out.push(build({ id: 'doji', name: 'Doji', direction: 'neutral', bars: 1,
          startIndex: i, endIndex: i, geometry: clamp(1 - mi.body / (mi.range * 0.1), 0, 1),
          volumeConfirm: false, trendContext: clamp(Math.abs(trend) / 0.3, 0, 1),
          invalidation: null, implication: 'Indecision — buyers and sellers in balance. Often precedes a turn after a strong move.', ctx }))
      }
    }

    // Marubozu
    if (!isDoji && mi.body >= mi.range * 0.95) {
      const dir: PatternDirection = mi.bull ? 'bullish' : 'bearish'
      out.push(build({ id: 'marubozu', name: `${mi.bull ? 'Bullish' : 'Bearish'} Marubozu`, direction: dir, bars: 1,
        startIndex: i, endIndex: i, geometry: clamp(mi.body / mi.range, 0, 1),
        volumeConfirm: volUp(i), trendContext: clamp(Math.abs(trend) / 0.3, 0, 1),
        invalidation: mi.bull ? c.low : c.high,
        implication: `${mi.bull ? 'Strong buying' : 'Strong selling'} pressure — a full-bodied bar with no wicks signals conviction.`, ctx }))
    }

    // Hammer / Hanging Man (long lower wick)
    if (!isDoji && mi.lower >= mi.body * 2 && mi.upper < mi.body * 0.3 && mi.body > a * 0.05) {
      if (realDown) {
        out.push(build({ id: 'hammer', name: 'Hammer', direction: 'bullish', bars: 1,
          startIndex: i, endIndex: i, geometry: clamp(mi.lower / (mi.body * 3), 0, 1),
          volumeConfirm: volUp(i), trendContext: clamp(-trend / 0.3, 0, 1),
          invalidation: c.low, implication: `Bullish reversal — sellers drove price down but buyers reclaimed the bar, leaving a long lower wick. Invalidated below ${fmt(c.low)}.`, ctx }))
      } else if (realUp) {
        out.push(build({ id: 'hanging_man', name: 'Hanging Man', direction: 'bearish', bars: 1,
          startIndex: i, endIndex: i, geometry: clamp(mi.lower / (mi.body * 3), 0, 1),
          volumeConfirm: volUp(i), trendContext: clamp(trend / 0.3, 0, 1),
          invalidation: c.high, implication: `Bearish warning after an advance — long lower wick shows selling pressure entering. Confirmed on a lower close; invalidated above ${fmt(c.high)}.`, ctx }))
      }
    }

    // Inverted Hammer / Shooting Star (long upper wick)
    if (!isDoji && mi.upper >= mi.body * 2 && mi.lower < mi.body * 0.3 && mi.body > a * 0.05) {
      if (realDown) {
        out.push(build({ id: 'inverted_hammer', name: 'Inverted Hammer', direction: 'bullish', bars: 1,
          startIndex: i, endIndex: i, geometry: clamp(mi.upper / (mi.body * 3), 0, 1),
          volumeConfirm: volUp(i), trendContext: clamp(-trend / 0.3, 0, 1),
          invalidation: c.low, implication: `Potential bullish reversal after a decline — buyers tested higher prices. Needs confirmation on the next bar.`, ctx }))
      } else if (realUp) {
        out.push(build({ id: 'shooting_star', name: 'Shooting Star', direction: 'bearish', bars: 1,
          startIndex: i, endIndex: i, geometry: clamp(mi.upper / (mi.body * 3), 0, 1),
          volumeConfirm: volUp(i), trendContext: clamp(trend / 0.3, 0, 1),
          invalidation: c.high, implication: `Bearish reversal — rally rejected at the highs leaving a long upper wick. Invalidated above ${fmt(c.high)}.`, ctx }))
      }
    }

    // ── Two-bar ──────────────────────────────────────────────────────────────

    // Engulfing
    const engulfBull = mi.bull && mp.bear && c.close >= p.open && c.open <= p.close && mi.body > mp.body
    const engulfBear = mi.bear && mp.bull && c.open >= p.close && c.close <= p.open && mi.body > mp.body
    if (engulfBull && trend <= -0.05) {
      out.push(build({ id: 'bullish_engulfing', name: 'Bullish Engulfing', direction: 'bullish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp(mi.body / Math.max(mp.body, a * 0.3), 0, 1),
        volumeConfirm: volUp(i), trendContext: clamp(-trend / 0.3, 0, 1),
        invalidation: Math.min(c.low, p.low), implication: `Bullish reversal — today's up-bar fully engulfs yesterday's down-bar. Invalidated below ${fmt(Math.min(c.low, p.low))}.`, ctx }))
    }
    if (engulfBear && trend >= 0.05) {
      out.push(build({ id: 'bearish_engulfing', name: 'Bearish Engulfing', direction: 'bearish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp(mi.body / Math.max(mp.body, a * 0.3), 0, 1),
        volumeConfirm: volUp(i), trendContext: clamp(trend / 0.3, 0, 1),
        invalidation: Math.max(c.high, p.high), implication: `Bearish reversal — today's down-bar fully engulfs yesterday's up-bar. Invalidated above ${fmt(Math.max(c.high, p.high))}.`, ctx }))
    }

    // Harami / Harami Cross (inside bar after a larger opposite body)
    const haramiBull = mp.bear && mi.bull && mi.bodyTop <= mp.bodyTop && mi.bodyBot >= mp.bodyBot && mp.body > a * 0.5
    const haramiBear = mp.bull && mi.bear && mi.bodyTop <= mp.bodyTop && mi.bodyBot >= mp.bodyBot && mp.body > a * 0.5
    if (haramiBull && trend <= -0.05) {
      const cross = isDoji
      out.push(build({ id: cross ? 'harami_cross' : 'harami', name: cross ? 'Bullish Harami Cross' : 'Bullish Harami', direction: 'bullish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp(1 - mi.body / Math.max(mp.body, 1e-9), 0, 1),
        volumeConfirm: false, trendContext: clamp(-trend / 0.3, 0, 1),
        invalidation: Math.min(c.low, p.low), implication: `Momentum stalling after a decline — a small inside bar signals selling exhaustion.`, ctx }))
    }
    if (haramiBear && trend >= 0.05) {
      const cross = isDoji
      out.push(build({ id: cross ? 'harami_cross' : 'harami', name: cross ? 'Bearish Harami Cross' : 'Bearish Harami', direction: 'bearish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp(1 - mi.body / Math.max(mp.body, 1e-9), 0, 1),
        volumeConfirm: false, trendContext: clamp(trend / 0.3, 0, 1),
        invalidation: Math.max(c.high, p.high), implication: `Momentum stalling after an advance — a small inside bar signals buying exhaustion.`, ctx }))
    }

    // Piercing Line / Dark Cloud Cover
    if (mp.bear && mi.bull && c.open < p.low && c.close > mp.mid && c.close < p.open && trend <= -0.1) {
      out.push(build({ id: 'piercing_line', name: 'Piercing Line', direction: 'bullish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp((c.close - mp.mid) / Math.max(mp.body / 2, 1e-9), 0, 1),
        volumeConfirm: volUp(i), trendContext: clamp(-trend / 0.3, 0, 1),
        invalidation: c.low, implication: `Bullish reversal — gapped down then closed above the midpoint of the prior down-bar.`, ctx }))
    }
    if (mp.bull && mi.bear && c.open > p.high && c.close < mp.mid && c.close > p.open && trend >= 0.1) {
      out.push(build({ id: 'dark_cloud_cover', name: 'Dark Cloud Cover', direction: 'bearish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp((mp.mid - c.close) / Math.max(mp.body / 2, 1e-9), 0, 1),
        volumeConfirm: volUp(i), trendContext: clamp(trend / 0.3, 0, 1),
        invalidation: c.high, implication: `Bearish reversal — gapped up then closed below the midpoint of the prior up-bar.`, ctx }))
    }

    // Tweezer Top / Bottom
    const tweezerTol = a * 0.1
    if (Math.abs(c.high - p.high) < tweezerTol && mp.bull && mi.bear && trend >= 0.1) {
      out.push(build({ id: 'tweezer_top', name: 'Tweezer Top', direction: 'bearish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp(1 - Math.abs(c.high - p.high) / tweezerTol, 0, 1),
        volumeConfirm: false, trendContext: clamp(trend / 0.3, 0, 1),
        invalidation: Math.max(c.high, p.high), implication: `Bearish reversal — two bars rejected at the same high near ${fmt(c.high)}.`, ctx }))
    }
    if (Math.abs(c.low - p.low) < tweezerTol && mp.bear && mi.bull && trend <= -0.1) {
      out.push(build({ id: 'tweezer_bottom', name: 'Tweezer Bottom', direction: 'bullish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp(1 - Math.abs(c.low - p.low) / tweezerTol, 0, 1),
        volumeConfirm: false, trendContext: clamp(-trend / 0.3, 0, 1),
        invalidation: Math.min(c.low, p.low), implication: `Bullish reversal — two bars held the same low near ${fmt(c.low)}.`, ctx }))
    }

    // Kicker (gap-and-reverse, marubozu-ish, ignores prior trend by design)
    if (mp.bear && mi.bull && c.open >= p.open && mi.body > a * 0.8 && mp.body > a * 0.5) {
      out.push(build({ id: 'bullish_kicker', name: 'Bullish Kicker', direction: 'bullish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp(mi.body / (a * 1.5), 0, 1),
        volumeConfirm: volUp(i), trendContext: 0.6,
        invalidation: p.open, implication: `Strong bullish reversal — opened above the prior bar and ran without filling the gap.`, ctx }))
    }
    if (mp.bull && mi.bear && c.open <= p.open && mi.body > a * 0.8 && mp.body > a * 0.5) {
      out.push(build({ id: 'bearish_kicker', name: 'Bearish Kicker', direction: 'bearish', bars: 2,
        startIndex: i - 1, endIndex: i, geometry: clamp(mi.body / (a * 1.5), 0, 1),
        volumeConfirm: volUp(i), trendContext: 0.6,
        invalidation: p.open, implication: `Strong bearish reversal — opened below the prior bar and sold off without filling the gap.`, ctx }))
    }

    // ── Three-bar ──────────────────────────────────────────────────────────
    if (i >= 2) {
      const tBefore = priorTrend(ctx, i - 1).norm

      // Morning / Evening Star
      const smallMid = mp.body < mpp.body * 0.5 && mp.body < mi.body * 0.6
      if (mpp.bear && smallMid && mi.bull && c.close > pp.open + mpp.body * 0.5 && tBefore <= -0.1) {
        out.push(build({ id: 'morning_star', name: 'Morning Star', direction: 'bullish', bars: 3,
          startIndex: i - 2, endIndex: i, geometry: clamp((c.close - pp.close) / Math.max(mpp.body, 1e-9), 0, 1),
          volumeConfirm: volUp(i), trendContext: clamp(-tBefore / 0.3, 0, 1),
          invalidation: Math.min(p.low, pp.low, c.low), implication: `Bullish three-bar reversal — a small-bodied pause followed by a strong up-bar reclaiming the first bar's range.`, ctx }))
      }
      if (mpp.bull && smallMid && mi.bear && c.close < pp.open - mpp.body * 0.5 && tBefore >= 0.1) {
        out.push(build({ id: 'evening_star', name: 'Evening Star', direction: 'bearish', bars: 3,
          startIndex: i - 2, endIndex: i, geometry: clamp((pp.close - c.close) / Math.max(mpp.body, 1e-9), 0, 1),
          volumeConfirm: volUp(i), trendContext: clamp(tBefore / 0.3, 0, 1),
          invalidation: Math.max(p.high, pp.high, c.high), implication: `Bearish three-bar reversal — a small-bodied pause followed by a strong down-bar.`, ctx }))
      }

      // Three White Soldiers / Three Black Crows
      const soldiers = mpp.bull && mp.bull && mi.bull &&
        p.close > pp.close && c.close > p.close &&
        p.open > pp.open && p.open < pp.close && c.open > p.open && c.open < p.close &&
        mpp.upper < mpp.body * 0.4 && mp.upper < mp.body * 0.4 && mi.upper < mi.body * 0.4
      const crows = mpp.bear && mp.bear && mi.bear &&
        p.close < pp.close && c.close < p.close &&
        p.open < pp.open && p.open > pp.close && c.open < p.open && c.open > p.close &&
        mpp.lower < mpp.body * 0.4 && mp.lower < mp.body * 0.4 && mi.lower < mi.body * 0.4
      if (soldiers) {
        out.push(build({ id: 'three_white_soldiers', name: 'Three White Soldiers', direction: 'bullish', bars: 3,
          startIndex: i - 2, endIndex: i, geometry: 0.8,
          volumeConfirm: volUp(i), trendContext: clamp(-tBefore / 0.3 + 0.4, 0, 1),
          invalidation: pp.open, implication: `Strong bullish momentum — three consecutive rising bars with small upper wicks.`, ctx }))
      }
      if (crows) {
        out.push(build({ id: 'three_black_crows', name: 'Three Black Crows', direction: 'bearish', bars: 3,
          startIndex: i - 2, endIndex: i, geometry: 0.8,
          volumeConfirm: volUp(i), trendContext: clamp(tBefore / 0.3 + 0.4, 0, 1),
          invalidation: pp.open, implication: `Strong bearish momentum — three consecutive falling bars with small lower wicks.`, ctx }))
      }

      // Three Inside Up / Down (harami + confirmation)
      if (mpp.bear && mp.bull && mp.bodyTop <= mpp.bodyTop && mp.bodyBot >= mpp.bodyBot && mi.bull && c.close > pp.open && tBefore <= -0.1) {
        out.push(build({ id: 'three_inside_up', name: 'Three Inside Up', direction: 'bullish', bars: 3,
          startIndex: i - 2, endIndex: i, geometry: 0.7,
          volumeConfirm: volUp(i), trendContext: clamp(-tBefore / 0.3, 0, 1),
          invalidation: Math.min(pp.low, p.low, c.low), implication: `Bullish reversal — a harami confirmed by a third bar closing above the first.`, ctx }))
      }
      if (mpp.bull && mp.bear && mp.bodyTop <= mpp.bodyTop && mp.bodyBot >= mpp.bodyBot && mi.bear && c.close < pp.open && tBefore >= 0.1) {
        out.push(build({ id: 'three_inside_down', name: 'Three Inside Down', direction: 'bearish', bars: 3,
          startIndex: i - 2, endIndex: i, geometry: 0.7,
          volumeConfirm: volUp(i), trendContext: clamp(tBefore / 0.3, 0, 1),
          invalidation: Math.max(pp.high, p.high, c.high), implication: `Bearish reversal — a harami confirmed by a third bar closing below the first.`, ctx }))
      }

      // Abandoned Baby (doji island reversal with gaps)
      const dojiMid = mp.body < mp.range * 0.1
      if (mpp.bear && dojiMid && mi.bull && p.high < pp.low && p.high < c.low && tBefore <= -0.1) {
        out.push(build({ id: 'abandoned_baby', name: 'Bullish Abandoned Baby', direction: 'bullish', bars: 3,
          startIndex: i - 2, endIndex: i, geometry: 0.9,
          volumeConfirm: volUp(i), trendContext: clamp(-tBefore / 0.3, 0, 1),
          invalidation: p.low, implication: `Rare, high-reliability bullish reversal — a gapped-down doji isolated by gaps on both sides.`, ctx }))
      }
      if (mpp.bull && dojiMid && mi.bear && p.low > pp.high && p.low > c.high && tBefore >= 0.1) {
        out.push(build({ id: 'abandoned_baby', name: 'Bearish Abandoned Baby', direction: 'bearish', bars: 3,
          startIndex: i - 2, endIndex: i, geometry: 0.9,
          volumeConfirm: volUp(i), trendContext: clamp(tBefore / 0.3, 0, 1),
          invalidation: p.high, implication: `Rare, high-reliability bearish reversal — a gapped-up doji isolated by gaps on both sides.`, ctx }))
      }
    }

    // ── Five-bar: Rising / Falling Three Methods ─────────────────────────────
    if (i >= 4) {
      const c0 = candles[i - 4], m0 = m[i - 4]
      const mids = [candles[i - 3], candles[i - 2], candles[i - 1]]
      const midM = [m[i - 3], m[i - 2], m[i - 1]]
      const tBefore = priorTrend(ctx, i - 4).norm
      const smallContained = (ref: Candle) =>
        mids.every((x, k) => midM[k].body < m0.body * 0.6 && x.high <= ref.high && x.low >= ref.low)
      if (m0.bull && smallContained(c0) && mids.every(x => x.close < x.open || true) &&
          mi.bull && c.close > c0.close && tBefore >= 0.1) {
        out.push(build({ id: 'rising_three_methods', name: 'Rising Three Methods', direction: 'bullish', bars: 5,
          startIndex: i - 4, endIndex: i, geometry: 0.75,
          volumeConfirm: volUp(i), trendContext: clamp(tBefore / 0.3, 0, 1),
          invalidation: c0.low, implication: `Bullish continuation — a brief pullback contained within the first up-bar, then a new high.`, ctx }))
      }
      if (m0.bear && smallContained(c0) && mi.bear && c.close < c0.close && tBefore <= -0.1) {
        out.push(build({ id: 'falling_three_methods', name: 'Falling Three Methods', direction: 'bearish', bars: 5,
          startIndex: i - 4, endIndex: i, geometry: 0.75,
          volumeConfirm: volUp(i), trendContext: clamp(-tBefore / 0.3, 0, 1),
          invalidation: c0.high, implication: `Bearish continuation — a brief bounce contained within the first down-bar, then a new low.`, ctx }))
      }
    }
  }

  // Continuation patterns are categorised as such (build() defaults to reversal).
  for (const d of out) {
    if (['rising_three_methods', 'falling_three_methods'].includes(d.id)) d.category = 'continuation'
  }
  return out
}
