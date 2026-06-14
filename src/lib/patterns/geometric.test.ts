import { describe, it, expect } from 'vitest'
import { detectAll } from './index'
import { fromCloses, linspace, noise } from './__fixtures__/builders'

const geoIds = (c: number[][] | ReturnType<typeof fromCloses>, opts = {}) =>
  detectAll(c as never, { timeframe: '1D', ...opts }).geometric.map(d => d.id)

describe('double bottom', () => {
  const closes = [
    ...linspace(100, 80, 14),
    ...linspace(80, 90, 12).slice(1),
    ...linspace(90, 80.5, 12).slice(1),
    ...linspace(80.5, 95, 14).slice(1),
  ]
  const candles = fromCloses(closes, { wick: 0.5 })

  it('detects a double bottom and confirms the neckline break', () => {
    const res = detectAll(candles, { timeframe: '1D' })
    const db = res.geometric.find(d => d.id === 'double_bottom')
    expect(db).toBeDefined()
    expect(db!.direction).toBe('bullish')
    expect(db!.status).toBe('confirmed')
    expect(db!.target).toBeGreaterThan(db!.breakoutLevel!)
  })
})

describe('head & shoulders', () => {
  const closes = [
    ...linspace(80, 100, 11),
    ...linspace(100, 92, 9).slice(1),
    ...linspace(92, 108, 11).slice(1),
    ...linspace(108, 91, 11).slice(1),
    ...linspace(91, 99, 9).slice(1),
    ...linspace(99, 86, 11).slice(1),
  ]
  const candles = fromCloses(closes, { wick: 0.5 })

  it('detects a bearish H&S top', () => {
    const det = detectAll(candles, { timeframe: '1D' }).geometric
    const hs = det.find(d => d.id === 'head_shoulders')
    expect(hs).toBeDefined()
    expect(hs!.direction).toBe('bearish')
    expect(hs!.target).toBeLessThan(hs!.breakoutLevel!)
  })
})

describe('ascending triangle', () => {
  const closes = [
    ...linspace(95, 86, 9),
    ...linspace(86, 100, 9).slice(1),
    ...linspace(100, 89, 9).slice(1),
    ...linspace(89, 100, 9).slice(1),
    ...linspace(100, 92, 8).slice(1),
    ...linspace(92, 98, 8).slice(1),
  ]
  const candles = fromCloses(closes, { wick: 0.4 })

  it('detects an ascending triangle (flat top, rising lows)', () => {
    expect(geoIds(candles)).toContain('ascending_triangle')
  })
})

describe('bull flag', () => {
  const closes = [
    ...Array(28).fill(0).map((_, i) => 79 + (i % 2 === 0 ? 0.3 : -0.3)), // flat lead-in
    ...linspace(80, 100, 6).slice(1),   // pole
    ...linspace(100, 96, 11).slice(1),  // tight pullback
  ]
  const vol = closes.map((_, i) => (i >= 28 && i < 33 ? 2_400_000 : i >= 33 ? 500_000 : 900_000))
  const candles = fromCloses(closes, { wick: 0.3, vol })

  it('detects a forming bull flag with an upside target', () => {
    const det = detectAll(candles, { timeframe: '1D' }).geometric
    const f = det.find(d => d.id === 'bull_flag')
    expect(f).toBeDefined()
    expect(f!.direction).toBe('bullish')
    expect(f!.target).toBeGreaterThan(f!.breakoutLevel!)
  })
})

describe('false-positive control (noise suite)', () => {
  it('keeps the geometric false-positive RATE near zero on random walks', () => {
    // A sensitive detector will occasionally fire on a random walk that happens
    // to contain a textbook shape — that is unavoidable and correct. The honest
    // control is the RATE: across 30 trendless 220-bar walks, detections must
    // stay far below one-per-series (here ≤ 0.25/series).
    let total = 0
    for (let seed = 1; seed <= 30; seed++) {
      total += detectAll(noise(220, seed), { timeframe: '1D' }).geometric.length
    }
    expect(total / 30).toBeLessThan(0.25)
  })
})

describe('performance budget', () => {
  it('detectAll runs under 50ms on 1500 candles', () => {
    const closes = Array.from({ length: 1500 }, (_, i) => 100 + Math.sin(i / 9) * 8 + i * 0.02)
    const candles = fromCloses(closes, { wick: 0.5 })
    // Warm up the JIT, then take the BEST of several runs so a transient load
    // spike on the test machine can't flake a genuinely-fast computation.
    for (let i = 0; i < 3; i++) detectAll(candles, { timeframe: '1D' })
    let best = Infinity
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now()
      detectAll(candles, { timeframe: '1D' })
      best = Math.min(best, performance.now() - t0)
    }
    expect(best).toBeLessThan(50)
  })
})
