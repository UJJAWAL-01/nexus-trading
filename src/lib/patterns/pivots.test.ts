import { describe, it, expect } from 'vitest'
import { detectPivots, fractalPivots } from './pivots'
import { trend, concatCandles, candle } from './__fixtures__/builders'

describe('fractalPivots', () => {
  it('finds a swing high at an obvious peak', () => {
    // rise to a peak at index 4, then fall
    const c = [
      candle(0, 100, 101, 99, 100),
      candle(1, 100, 103, 100, 102),
      candle(2, 102, 105, 101, 104),
      candle(3, 104, 108, 103, 107),
      candle(4, 107, 115, 106, 110),   // peak
      candle(5, 110, 111, 106, 107),
      candle(6, 107, 108, 103, 104),
      candle(7, 104, 105, 100, 101),
      candle(8, 101, 102, 98, 99),
    ]
    const piv = fractalPivots(c, 3)
    const high = piv.find(p => p.type === 'high')
    expect(high).toBeDefined()
    expect(high!.index).toBe(4)
    expect(high!.price).toBe(115)
  })
})

describe('detectPivots zigzag', () => {
  const series = concatCandles(
    trend(100, 110, 8),
    trend(110, 95, 10),
    trend(95, 120, 14),
  )

  it('produces an alternating high/low chain', () => {
    const { k5 } = detectPivots(series)
    expect(k5.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < k5.length; i++) {
      expect(k5[i].type).not.toBe(k5[i - 1].type)
    }
  })

  it('captures the major peak near 110 and trough near 95', () => {
    const { k3 } = detectPivots(series)
    const highs = k3.filter(p => p.type === 'high').map(p => p.price)
    const lows = k3.filter(p => p.type === 'low').map(p => p.price)
    expect(Math.max(...highs)).toBeGreaterThan(108)
    expect(Math.min(...lows)).toBeLessThan(98)
  })

  it('tags pivots with their strength tier', () => {
    const { k8 } = detectPivots(series)
    expect(k8.every(p => p.strength === 8)).toBe(true)
  })
})
