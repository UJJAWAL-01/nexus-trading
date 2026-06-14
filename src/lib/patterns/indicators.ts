// ─────────────────────────────────────────────────────────────────────────────
// Shared indicator math for the pattern engine.
//
// Every value is computed deterministically from Candle[]. These feed the pivot
// detector (ATR), candlestick context gating (regression slope), and the TA
// rating (the full oscillator + MA suite). Kept dependency-free and aligned
// index-for-index with the source candles where it matters.
// ─────────────────────────────────────────────────────────────────────────────

import type { Candle } from './types'

export const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x

export const last = <T>(a: T[]): T | undefined => a[a.length - 1]

// ── Moving averages ──────────────────────────────────────────────────────────

/** Simple moving average. Returns value at the LAST index, or null if too short. */
export function sma(values: number[], period: number): number | null {
  if (values.length < period || period <= 0) return null
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) sum += values[i]
  return sum / period
}

/** Full SMA series, value[i] aligned to values[i] (null until enough history). */
export function smaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null)
  if (period <= 0) return out
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** EMA value at the last index, seeded with an SMA. */
export function ema(values: number[], period: number): number | null {
  const series = emaSeries(values, period)
  const v = last(series)
  return v ?? null
}

/** Full EMA series, value[i] aligned to values[i] (null until seeded). */
export function emaSeries(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null)
  if (values.length < period || period <= 0) return out
  const k = 2 / (period + 1)
  let prev = 0
  for (let i = 0; i < period; i++) prev += values[i]
  prev /= period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

// ── True range / ATR ─────────────────────────────────────────────────────────

export function trueRangeSeries(candles: Candle[]): number[] {
  const out: number[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (i === 0) { out.push(c.high - c.low); continue }
    const pc = candles[i - 1].close
    out.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)))
  }
  return out
}

/** Wilder-smoothed ATR series, aligned to candles (null until `period` bars). */
export function atrSeries(candles: Candle[], period = 14): Array<number | null> {
  const tr = trueRangeSeries(candles)
  const out: Array<number | null> = new Array(candles.length).fill(null)
  if (candles.length < period) return out
  let prev = 0
  for (let i = 0; i < period; i++) prev += tr[i]
  prev /= period
  out[period - 1] = prev
  for (let i = period; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period
    out[i] = prev
  }
  return out
}

/** ATR value at the last bar; falls back to a robust range estimate if short. */
export function atr(candles: Candle[], period = 14): number {
  const s = atrSeries(candles, period)
  const v = last(s)
  if (v != null) return v
  if (!candles.length) return 0
  const tr = trueRangeSeries(candles)
  return tr.reduce((a, b) => a + b, 0) / Math.max(1, tr.length)
}

// ── Linear regression (slope of closes) ──────────────────────────────────────

export interface Regression { slope: number; intercept: number; r2: number }

/** Least-squares fit of y over x = 0..n-1. */
export function linreg(y: number[]): Regression {
  const n = y.length
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0, r2: 0 }
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) { sx += i; sy += y[i]; sxx += i * i; sxy += i * y[i] }
  const denom = n * sxx - sx * sx
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  let ssTot = 0, ssRes = 0
  const mean = sy / n
  for (let i = 0; i < n; i++) {
    const pred = slope * i + intercept
    ssRes += (y[i] - pred) ** 2
    ssTot += (y[i] - mean) ** 2
  }
  const r2 = ssTot === 0 ? 1 : clamp(1 - ssRes / ssTot, 0, 1)
  return { slope, intercept, r2 }
}

// ── Oscillators (last-value, for the TA rating) ──────────────────────────────

export function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null
  let gain = 0, loss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]
    if (d > 0) gain += d; else loss -= d
  }
  gain /= period; loss /= period
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    gain = (gain * (period - 1) + Math.max(0, d)) / period
    loss = (loss * (period - 1) + Math.max(0, -d)) / period
  }
  if (loss === 0) return 100
  return 100 - 100 / (1 + gain / loss)
}

/** Full RSI series aligned to values (null until seeded). */
export function rsiSeries(values: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null)
  if (values.length < period + 1) return out
  let gain = 0, loss = 0
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1]
    if (d > 0) gain += d; else loss -= d
  }
  gain /= period; loss /= period
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1]
    gain = (gain * (period - 1) + Math.max(0, d)) / period
    loss = (loss * (period - 1) + Math.max(0, -d)) / period
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  }
  return out
}

export interface MacdState { macd: number; signal: number; hist: number }

export function macd(values: number[], fast = 12, slow = 26, sigP = 9): MacdState | null {
  if (values.length < slow + sigP) return null
  const ef = emaSeries(values, fast)
  const es = emaSeries(values, slow)
  const macdLine: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (ef[i] != null && es[i] != null) macdLine.push((ef[i] as number) - (es[i] as number))
  }
  if (macdLine.length < sigP) return null
  const sigSeries = emaSeries(macdLine, sigP)
  const m = last(macdLine) as number
  const s = last(sigSeries) as number
  return { macd: m, signal: s, hist: m - s }
}

/** Stochastic %K/%D (period, smoothK, smoothD). Returns the last values. */
export function stochastic(
  candles: Candle[], period = 14, smoothK = 3, smoothD = 3,
): { k: number; d: number } | null {
  if (candles.length < period + smoothK + smoothD) return null
  const rawK: number[] = []
  for (let i = period - 1; i < candles.length; i++) {
    const win = candles.slice(i - period + 1, i + 1)
    const hh = Math.max(...win.map(c => c.high))
    const ll = Math.min(...win.map(c => c.low))
    rawK.push(hh === ll ? 50 : ((candles[i].close - ll) / (hh - ll)) * 100)
  }
  const kSeries = smaSeries(rawK, smoothK).filter((v): v is number => v != null)
  const dSeries = smaSeries(kSeries, smoothD).filter((v): v is number => v != null)
  const k = last(kSeries), d = last(dSeries)
  if (k == null || d == null) return null
  return { k, d }
}

export function cci(candles: Candle[], period = 20): number | null {
  if (candles.length < period) return null
  const tp = candles.map(c => (c.high + c.low + c.close) / 3)
  const win = tp.slice(-period)
  const mean = win.reduce((a, b) => a + b, 0) / period
  const md = win.reduce((a, b) => a + Math.abs(b - mean), 0) / period
  if (md === 0) return 0
  return (tp[tp.length - 1] - mean) / (0.015 * md)
}

export function williamsR(candles: Candle[], period = 14): number | null {
  if (candles.length < period) return null
  const win = candles.slice(-period)
  const hh = Math.max(...win.map(c => c.high))
  const ll = Math.min(...win.map(c => c.low))
  if (hh === ll) return -50
  return ((hh - candles[candles.length - 1].close) / (hh - ll)) * -100
}

export function momentum(values: number[], period = 10): number | null {
  if (values.length < period + 1) return null
  return values[values.length - 1] - values[values.length - 1 - period]
}

/** ADX(period) with directional indicators. */
export function adx(candles: Candle[], period = 14): { adx: number; plusDI: number; minusDI: number } | null {
  if (candles.length < period * 2) return null
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high
    const dn = candles[i - 1].low - candles[i].low
    plusDM.push(up > dn && up > 0 ? up : 0)
    minusDM.push(dn > up && dn > 0 ? dn : 0)
    const c = candles[i], pc = candles[i - 1].close
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)))
  }
  const wilder = (arr: number[]) => {
    let prev = arr.slice(0, period).reduce((a, b) => a + b, 0)
    const out = [prev]
    for (let i = period; i < arr.length; i++) { prev = prev - prev / period + arr[i]; out.push(prev) }
    return out
  }
  const trS = wilder(tr), pS = wilder(plusDM), mS = wilder(minusDM)
  const dx: number[] = []
  for (let i = 0; i < trS.length; i++) {
    const pDI = trS[i] === 0 ? 0 : (pS[i] / trS[i]) * 100
    const mDI = trS[i] === 0 ? 0 : (mS[i] / trS[i]) * 100
    const sum = pDI + mDI
    dx.push(sum === 0 ? 0 : (Math.abs(pDI - mDI) / sum) * 100)
  }
  if (dx.length < period) return null
  let adxVal = dx.slice(0, period).reduce((a, b) => a + b, 0) / period
  for (let i = period; i < dx.length; i++) adxVal = (adxVal * (period - 1) + dx[i]) / period
  const i = trS.length - 1
  const plusDI = trS[i] === 0 ? 0 : (pS[i] / trS[i]) * 100
  const minusDI = trS[i] === 0 ? 0 : (mS[i] / trS[i]) * 100
  return { adx: adxVal, plusDI, minusDI }
}

export function stochRsi(values: number[], period = 14): number | null {
  const rs = rsiSeries(values, period).filter((v): v is number => v != null)
  if (rs.length < period) return null
  const win = rs.slice(-period)
  const hh = Math.max(...win), ll = Math.min(...win)
  if (hh === ll) return 50
  return ((rs[rs.length - 1] - ll) / (hh - ll)) * 100
}

export function ultimateOscillator(candles: Candle[], s1 = 7, s2 = 14, s3 = 28): number | null {
  if (candles.length < s3 + 1) return null
  const bp: number[] = [], tr: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], pc = candles[i - 1].close
    const trueLow = Math.min(c.low, pc)
    bp.push(c.close - trueLow)
    tr.push(Math.max(c.high, pc) - trueLow)
  }
  const avg = (n: number) => {
    const b = bp.slice(-n).reduce((a, x) => a + x, 0)
    const t = tr.slice(-n).reduce((a, x) => a + x, 0)
    return t === 0 ? 0 : b / t
  }
  return (4 * avg(s1) + 2 * avg(s2) + avg(s3)) / 7 * 100
}

/** Awesome Oscillator = SMA5(median) − SMA34(median), with rising/falling slope. */
export function awesomeOscillator(candles: Candle[]): { value: number; rising: boolean } | null {
  if (candles.length < 35) return null
  const median = candles.map(c => (c.high + c.low) / 2)
  const f = smaSeries(median, 5)
  const s = smaSeries(median, 34)
  const ao: number[] = []
  for (let i = 0; i < candles.length; i++) {
    if (f[i] != null && s[i] != null) ao.push((f[i] as number) - (s[i] as number))
  }
  if (ao.length < 2) return null
  return { value: ao[ao.length - 1], rising: ao[ao.length - 1] > ao[ao.length - 2] }
}
