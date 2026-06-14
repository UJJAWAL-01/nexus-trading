import { describe, it, expect } from 'vitest'
import { computeRating } from './taRating'
import { analyzeStructure } from './trendStructure'
import { detectPivots } from './pivots'
import { fromCloses, linspace, noise } from './__fixtures__/builders'

describe('taRating', () => {
  it('rates a strong uptrend as buy / strong buy', () => {
    const candles = fromCloses(linspace(50, 150, 260), { wick: 0.5 })
    const r = computeRating(candles)
    expect(r.overall.score).toBeGreaterThan(0.1)
    expect(['buy', 'strong_buy']).toContain(r.overall.label)
    expect(r.movingAvg.votes.length).toBe(12)
    expect(r.oscillators.votes.length).toBe(10)
  })

  it('rates a strong downtrend as sell / strong sell', () => {
    const candles = fromCloses(linspace(150, 50, 260), { wick: 0.5 })
    const r = computeRating(candles)
    expect(r.overall.score).toBeLessThan(-0.1)
    expect(['sell', 'strong_sell']).toContain(r.overall.label)
  })

  it('stays near neutral on a flat random walk', () => {
    const r = computeRating(noise(260, 5))
    expect(Math.abs(r.overall.score)).toBeLessThan(0.6)
  })
})

describe('trend structure', () => {
  it('classifies a rising zigzag as an uptrend (HH + HL)', () => {
    const closes = [
      ...linspace(100, 110, 10),
      ...linspace(110, 104, 8).slice(1),
      ...linspace(104, 120, 10).slice(1),
      ...linspace(120, 113, 8).slice(1),
      ...linspace(113, 130, 10).slice(1),
    ]
    const candles = fromCloses(closes, { wick: 0.4 })
    const s = analyzeStructure(candles, detectPivots(candles))
    expect(s.bias).toBe('uptrend')
  })
})
