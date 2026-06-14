// ─────────────────────────────────────────────────────────────────────────────
// Deterministic fixture builders for the pattern-engine test suite.
//
// Synthetic but textbook-shaped candle sequences let us assert exact detector
// behaviour without committing megabytes of real history. The noise builder is
// the false-positive control: a trendless random walk that must produce zero
// geometric detections.
// ─────────────────────────────────────────────────────────────────────────────

import type { Candle } from '../types'

const DAY = 86400
const T0 = 1_700_000_000   // fixed base so `time` is stable across runs

export function candle(
  i: number, o: number, h: number, l: number, c: number, v = 1_000_000,
): Candle {
  return { time: T0 + i * DAY, open: o, high: h, low: l, close: c, volume: v }
}

/** Mulberry32 — tiny seeded PRNG for reproducible "random" walks. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A straight trend of full-bodied bars from `from` to `to` over `n` bars. */
export function trend(from: number, to: number, n: number, startIdx = 0): Candle[] {
  const out: Candle[] = []
  const step = (to - from) / Math.max(1, n - 1)
  for (let i = 0; i < n; i++) {
    const c = from + step * i
    const prev = i === 0 ? c - step : from + step * (i - 1)
    const up = step >= 0
    const open = prev
    const close = c
    const hi = Math.max(open, close) + Math.abs(step) * 0.15 + 0.2
    const lo = Math.min(open, close) - Math.abs(step) * 0.15 - 0.2
    out.push(candle(startIdx + i, open, hi, lo, close, up ? 1_200_000 : 900_000))
  }
  return out
}

/** Trendless random walk — the noise control. Bodies stay small, no drift. */
export function noise(n: number, seed = 42, base = 100): Candle[] {
  const r = rng(seed)
  const out: Candle[] = []
  let price = base
  for (let i = 0; i < n; i++) {
    const open = price
    const drift = (r() - 0.5) * 1.2          // symmetric, no trend
    const close = open + drift
    const hi = Math.max(open, close) + r() * 0.6
    const lo = Math.min(open, close) - r() * 0.6
    out.push(candle(i, open, hi, lo, close, 1_000_000))
    price = close
  }
  return out
}

/** Re-time a concatenated set of candle arrays so indices/times stay monotonic. */
export function concatCandles(...parts: Candle[][]): Candle[] {
  const flat = parts.flat()
  return flat.map((c, i) => ({ ...c, time: T0 + i * DAY }))
}

/** Inclusive linear ramp of `n` values from `from` to `to`. */
export function linspace(from: number, to: number, n: number): number[] {
  if (n <= 1) return [to]
  const step = (to - from) / (n - 1)
  return Array.from({ length: n }, (_, i) => from + step * i)
}

/**
 * Build candles directly from a close-price path. Each bar opens at the prior
 * close; wick size and per-bar volume are controllable so we can construct
 * volume-sensitive patterns (flags, H&S) deterministically.
 */
export function fromCloses(
  closes: number[],
  opts: { wick?: number; vol?: number | number[] } = {},
): Candle[] {
  const wick = opts.wick ?? 0.4
  return closes.map((cl, i) => {
    const open = i === 0 ? cl : closes[i - 1]
    const hi = Math.max(open, cl) + wick
    const lo = Math.min(open, cl) - wick
    const v = Array.isArray(opts.vol) ? opts.vol[i] : (opts.vol ?? 1_000_000)
    return candle(i, open, hi, lo, cl, v)
  })
}
