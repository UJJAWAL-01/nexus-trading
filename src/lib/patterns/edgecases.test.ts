import { describe, it, expect } from 'vitest'
import { detectAll } from './index'
import { detectPivots } from './pivots'
import { computeRating } from './taRating'
import { candle, fromCloses, concatCandles, trend } from './__fixtures__/builders'
import type { Candle } from './types'

describe('engine edge cases — must never throw or emit NaN', () => {
  it('handles empty input', () => {
    const r = detectAll([])
    expect(r.geometric).toEqual([])
    expect(r.candlestick).toEqual([])
    expect(r.structure.bias).toBe('range')
  })

  it('handles a too-short series (< 5 bars)', () => {
    const c = [candle(0, 10, 11, 9, 10), candle(1, 10, 12, 10, 11)]
    expect(() => detectAll(c)).not.toThrow()
    expect(detectAll(c).geometric).toEqual([])
  })

  it('handles a perfectly flat series without div-by-zero', () => {
    const c: Candle[] = Array.from({ length: 120 }, (_, i) => candle(i, 100, 100, 100, 100, 1_000_000))
    const r = detectAll(c, { timeframe: '1D' })
    expect(r.geometric).toEqual([])
    // rating votes should be finite (or null), never NaN
    for (const v of [...r.rating.movingAvg.votes, ...r.rating.oscillators.votes]) {
      expect(v.value === null || Number.isFinite(v.value)).toBe(true)
    }
    expect(Number.isFinite(r.rating.overall.score)).toBe(true)
  })

  it('handles zero-range bars (high == low) in candlestick metrics', () => {
    const series = concatCandles(trend(100, 90, 6), [candle(0, 95, 95, 95, 95)])
    expect(() => detectAll(series, { timeframe: '1D' })).not.toThrow()
  })

  it('survives gaps / non-uniform time spacing', () => {
    const closes = [...Array(80)].map((_, i) => 100 + Math.sin(i / 7) * 6)
    const c = fromCloses(closes)
    // blow a hole in the time axis (skip ahead) — engine reasons on index, not Δt
    const gapped = c.map((x, i) => (i > 40 ? { ...x, time: x.time + 30 * 86400 } : x))
    expect(() => detectAll(gapped, { timeframe: '1D' })).not.toThrow()
  })

  it('detectPivots on flat data yields no pivots', () => {
    const c: Candle[] = Array.from({ length: 60 }, (_, i) => candle(i, 50, 50, 50, 50))
    const piv = detectPivots(c)
    expect(piv.k3.length + piv.k5.length + piv.k8.length).toBe(0)
  })

  it('computeRating on a short series returns finite/neutral, no throw', () => {
    const c = fromCloses([100, 101, 102, 101, 100])
    const r = computeRating(c)
    expect(['strong_sell', 'sell', 'neutral', 'buy', 'strong_buy']).toContain(r.overall.label)
  })

  it('every detection carries finite levels (no NaN target/breakout)', () => {
    const series = concatCandles(
      trend(100, 80, 14),
      trend(80, 90, 12).slice(1),
      trend(90, 80.5, 12).slice(1),
      trend(80.5, 95, 14).slice(1),
    )
    const r = detectAll(series as Candle[], { timeframe: '1D' })
    for (const d of [...r.geometric, ...r.candlestick]) {
      for (const lvl of [d.breakoutLevel, d.target, d.invalidation]) {
        expect(lvl === null || Number.isFinite(lvl)).toBe(true)
      }
      expect(Number.isFinite(d.confidence)).toBe(true)
      expect(d.confidence).toBeGreaterThanOrEqual(0)
      expect(d.confidence).toBeLessThanOrEqual(100)
    }
  })
})
