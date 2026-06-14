import { describe, it, expect } from 'vitest'
import {
  sma, ema, atr, rsi, linreg, macd, smaSeries,
} from './indicators'
import { candle, trend } from './__fixtures__/builders'

describe('moving averages', () => {
  it('sma of a flat series equals the value', () => {
    expect(sma([5, 5, 5, 5], 4)).toBe(5)
  })
  it('sma returns null when too short', () => {
    expect(sma([1, 2], 5)).toBeNull()
  })
  it('smaSeries aligns to input length with leading nulls', () => {
    const s = smaSeries([1, 2, 3, 4], 2)
    expect(s.length).toBe(4)
    expect(s[0]).toBeNull()
    expect(s[1]).toBe(1.5)
    expect(s[3]).toBe(3.5)
  })
  it('ema tracks an uptrend above the oldest values', () => {
    const e = ema([1, 2, 3, 4, 5, 6, 7, 8], 4)
    expect(e).not.toBeNull()
    expect(e as number).toBeGreaterThan(4)
  })
})

describe('atr', () => {
  it('is positive for a trending series', () => {
    const c = trend(100, 120, 30)
    expect(atr(c, 14)).toBeGreaterThan(0)
  })
  it('handles a single candle without throwing', () => {
    expect(atr([candle(0, 10, 11, 9, 10)], 14)).toBeGreaterThan(0)
  })
})

describe('rsi', () => {
  it('is 100 for a monotonic uptrend', () => {
    const vals = Array.from({ length: 30 }, (_, i) => 100 + i)
    expect(rsi(vals, 14)).toBe(100)
  })
  it('sits below 50 for a downtrend', () => {
    const vals = Array.from({ length: 30 }, (_, i) => 100 - i)
    expect(rsi(vals, 14)!).toBeLessThan(50)
  })
})

describe('linreg', () => {
  it('recovers a known slope', () => {
    const { slope, r2 } = linreg([0, 2, 4, 6, 8])
    expect(slope).toBeCloseTo(2, 6)
    expect(r2).toBeCloseTo(1, 6)
  })
})

describe('macd', () => {
  it('is positive when the fast EMA leads in an uptrend', () => {
    const vals = Array.from({ length: 60 }, (_, i) => 100 + i)
    const m = macd(vals)
    expect(m).not.toBeNull()
    expect(m!.macd).toBeGreaterThan(0)
  })
})
