import { describe, it, expect } from 'vitest'
import { detectCandlestick } from './candlestick'
import { trend, noise, concatCandles, candle } from './__fixtures__/builders'

const ids = (cs: ReturnType<typeof detectCandlestick>) => cs.map(d => d.id)

describe('context-gated single-bar reversals', () => {
  it('detects a Hammer after a downswing', () => {
    const series = concatCandles(
      trend(100, 90, 6),
      [candle(0, 90, 91.2, 86, 91)],   // long lower wick, tiny upper
    )
    const det = detectCandlestick(series, { tf: '1D' })
    expect(ids(det)).toContain('hammer')
    const h = det.find(d => d.id === 'hammer')!
    expect(h.direction).toBe('bullish')
    expect(h.confidence).toBeGreaterThan(40)
  })

  it('detects a Shooting Star after an upswing', () => {
    const series = concatCandles(
      trend(90, 100, 6),
      [candle(0, 100, 104, 98.9, 99)],  // long upper wick
    )
    const det = detectCandlestick(series, { tf: '1D' })
    expect(ids(det)).toContain('shooting_star')
    expect(det.find(d => d.id === 'shooting_star')!.direction).toBe('bearish')
  })

  it('detects a Bullish Engulfing after a downswing', () => {
    const series = concatCandles(
      trend(100, 90, 6),
      [candle(0, 91, 91.2, 89.8, 90)],   // small bear
      [candle(0, 89.5, 92.2, 89.3, 92)], // engulfs
    )
    expect(ids(detectCandlestick(series, { tf: '1D' }))).toContain('bullish_engulfing')
  })

  it('detects Three White Soldiers', () => {
    const series = concatCandles(
      trend(100, 94, 4),
      [candle(0, 90, 93.3, 89.8, 93)],
      [candle(0, 91.5, 95.3, 91.3, 95)],
      [candle(0, 93.5, 97.3, 93.3, 97)],
    )
    expect(ids(detectCandlestick(series, { tf: '1D' }))).toContain('three_white_soldiers')
  })

  it('detects a Doji', () => {
    const series = concatCandles(
      trend(100, 105, 6),
      [candle(0, 100, 102, 98, 100.05)],
    )
    expect(ids(detectCandlestick(series, { tf: '1D' }))).toContain('doji')
  })
})

describe('false-positive control (noise suite)', () => {
  it('does NOT fire context-gated reversals on a trendless random walk', () => {
    const det = ids(detectCandlestick(noise(150, 7), { tf: '1D', window: 140 }))
    expect(det).not.toContain('hammer')
    expect(det).not.toContain('shooting_star')
    expect(det).not.toContain('hanging_man')
  })
})
