// ─────────────────────────────────────────────────────────────────────────────
// NEXUS Pattern Engine — core types
//
// Pure data contracts shared by every detector, the chart panel, and the
// server-side pattern scanner. Zero React, zero fetch, zero side-effects.
// See NEXUS-pattern-engine-spec §1.1.
// ─────────────────────────────────────────────────────────────────────────────

/** OHLCV bar. `time` is unix SECONDS (matches lightweight-charts + Yahoo). */
export interface Candle {
  time:   number
  open:   number
  high:   number
  low:    number
  close:  number
  volume: number
}

export type PatternStatus    = 'forming' | 'confirmed' | 'failed'
export type PatternDirection = 'bullish' | 'bearish' | 'neutral'
export type PatternKind      = 'candlestick' | 'geometric'
export type PatternCategory  = 'reversal' | 'continuation' | 'bilateral'

export interface PivotPoint {
  index:    number          // candle index
  time:     number          // unix seconds
  price:    number
  type:     'high' | 'low'
  strength: number          // how many bars on each side confirm it (3, 5, 8)
}

export interface PatternPoint {
  time:   number
  price:  number
  label?: string
}

export interface PatternLine {
  a:     PatternPoint
  b:     PatternPoint
  style: 'solid' | 'dashed'
  role:  'pattern' | 'neckline' | 'target' | 'support' | 'resistance'
}

/** Per-component breakdown of a confidence score, so the UI can show *why*. */
export interface ConfidenceBreakdown {
  base:            number   // textbook reliability prior
  geometryQuality: number   // 0–15
  volumeConfirm:   number   // 0–10
  trendContext:    number   // 0–10
  timeframeBonus:  number   // 0–5
  ageDecay:        number   // subtracted
  total:           number   // clamped 0–100
}

export interface PatternDetection {
  id:         string             // 'head_shoulders', 'bull_flag', 'hammer', …
  name:       string             // 'Head & Shoulders'
  kind:       PatternKind
  category:   PatternCategory
  direction:  PatternDirection
  status:     PatternStatus
  confidence: number             // 0–100, see confidence.ts
  confidenceBreakdown?: ConfidenceBreakdown
  startIndex: number
  endIndex:   number

  // Geometry for drawing on the chart:
  points: PatternPoint[]
  lines:  PatternLine[]

  // Trade-relevant levels:
  breakoutLevel:   number | null
  target:          number | null
  invalidation:    number | null
  volumeConfirmed: boolean

  // Human explanation (template-filled, NOT AI):
  implication: string
}

// ── Trend structure (§1.5) ──────────────────────────────────────────────────

export type TrendBias = 'uptrend' | 'downtrend' | 'range'

export interface StructuralEvent {
  type:  'BOS' | 'CHoCH'     // break of structure / change of character
  time:  number
  price: number
  direction: PatternDirection
}

export interface TrendStructure {
  bias:            TrendBias
  /** Last up-to-4 structural pivots, oldest → newest. */
  swingPoints:     PivotPoint[]
  lastEvent:       StructuralEvent | null
  support:         number | null
  resistance:      number | null
  /** HH/HL/LH/LL label string for the badge, e.g. "HH · HL". */
  label:           string
}

// ── Technical rating (§1.4) ─────────────────────────────────────────────────

export type RatingSignal = 'buy' | 'sell' | 'neutral'
export type RatingLabel  =
  | 'strong_sell' | 'sell' | 'neutral' | 'buy' | 'strong_buy'

export interface IndicatorVote {
  id:     string            // 'SMA10', 'RSI', 'MACD', …
  label:  string            // 'SMA (10)'
  value:  number | null     // the indicator's numeric value (null if N/A)
  signal: RatingSignal
}

export interface RatingGroup {
  score:    number          // (buys − sells) / total, −1…1
  buys:     number
  sells:    number
  neutrals: number
  label:    RatingLabel
  votes:    IndicatorVote[]
}

export interface TaRating {
  overall:     RatingGroup
  movingAvg:   RatingGroup
  oscillators: RatingGroup
}

// ── detectAll() result + options ────────────────────────────────────────────

export interface DetectAllResult {
  candlestick: PatternDetection[]
  geometric:   PatternDetection[]
  structure:   TrendStructure
  rating:      TaRating
}

export type Timeframe =
  | '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M'

export interface DetectOptions {
  /** Multiplier on ATR(14) for pivot significance filtering. Default 0.8. */
  pivotAtrMult?: number
  /** The timeframe the candles represent — feeds the confidence timeframe bonus. */
  timeframe?: Timeframe
  /** Limit candlestick scan to the last N bars (chart view). Omit = full series. */
  candleScanWindow?: number
  /** Skip geometric detectors (used by lightweight candlestick-only passes). */
  geometricOnly?: boolean
  candlestickOnly?: boolean
  /** Quality floor for geometric detections (default 50). */
  minGeometricConfidence?: number
}

/** Compact detection for Redis storage / screener payloads (§4.1). */
export interface CompactDetection {
  id:            string
  name:          string
  direction:     PatternDirection
  status:        PatternStatus
  category:      PatternCategory
  confidence:    number
  breakoutLevel: number | null
  target:        number | null
  ageBar:        number          // bars since endIndex relative to last candle
}

export function toCompact(d: PatternDetection, lastIndex: number): CompactDetection {
  return {
    id:            d.id,
    name:          d.name,
    direction:     d.direction,
    status:        d.status,
    category:      d.category,
    confidence:    d.confidence,
    breakoutLevel: d.breakoutLevel,
    target:        d.target,
    ageBar:        Math.max(0, lastIndex - d.endIndex),
  }
}
