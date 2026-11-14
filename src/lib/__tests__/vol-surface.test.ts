import { describe, it, expect } from 'vitest'
import { buildVolSurface, cboeSymbol, interpolate, parseOcc, thinExpiries, type RawChain, type RawOption } from '@/lib/vol-surface'
import { isAllowedHost } from '@/lib/providers/http'

const NOW = new Date(Date.UTC(2026, 10, 14))
const occ = (expiry: string, type: 'C' | 'P', strike: number) =>
  `TEST${expiry.slice(2, 4)}${expiry.slice(5, 7)}${expiry.slice(8, 10)}${type}${String(Math.round(strike * 1000)).padStart(8, '0')}`

/** A chain with a chosen ATM IV and a linear skew (puts dearer than calls when slope < 0). */
function chain(expiry: string, atm: number, slopePerPct = -0.002, spot = 100): RawOption[] {
  const out: RawOption[] = []
  for (let k = 70; k <= 130; k += 5) {
    const iv = atm + slopePerPct * (k - spot)
    const m = (k - spot) / spot
    // Rough but monotonic deltas: enough to exercise the 25-delta interpolation.
    const callDelta = Math.max(0.01, Math.min(0.99, 0.5 - m * 2.5))
    out.push({ option: occ(expiry, 'C', k), iv, delta: callDelta, bid: 1, open_interest: 10 })
    out.push({ option: occ(expiry, 'P', k), iv, delta: callDelta - 1, bid: 1, open_interest: 10 })
  }
  return out
}
const raw = (options: RawOption[], spot = 100): RawChain => ({ timestamp: '2026-11-14 01:04:40', data: { current_price: spot, iv30: 21.3, options } })

describe('OCC symbols', () => {
  it('parses expiry, type and strike', () => {
    expect(parseOcc('AAPL261120C00415000')).toEqual({ expiry: '2026-11-20', type: 'C', strike: 415 })
    expect(parseOcc('SPY270115P00452500')).toEqual({ expiry: '2027-01-15', type: 'P', strike: 452.5 })
    expect(parseOcc('BRKB261218C00500000')).toMatchObject({ strike: 500 })
  })
  it('rejects anything malformed', () => {
    for (const s of ['', 'AAPL', 'AAPL261120X00415000', 'AAPL261320C00415000', 'AAPL261120C00000000', 'AAPL261120C415', '<script>261120C00415000'])
      expect(parseOcc(s), s).toBeNull()
  })
})

describe('interpolation', () => {
  const pts = [{ x: 90, y: 0.3 }, { x: 100, y: 0.2 }, { x: 110, y: 0.25 }]
  it('interpolates linearly and returns exact points', () => {
    expect(interpolate(pts, 95)).toBeCloseTo(0.25, 10)
    expect(interpolate(pts, 100)).toBe(0.2)
    expect(interpolate(pts, 105)).toBeCloseTo(0.225, 10)
  })
  it('never extrapolates', () => {
    expect(interpolate(pts, 80)).toBeNull()
    expect(interpolate(pts, 120)).toBeNull()
    expect(interpolate([], 100)).toBeNull()
  })
})

describe('volatility surface', () => {
  it('recovers the at-the-money IV and the expected move', () => {
    const s = buildVolSurface(raw(chain('2026-12-18', 0.25)), NOW)!
    expect(s.spot).toBe(100)
    expect(s.iv30).toBeCloseTo(0.213, 10)
    expect(s.asOf).toBe('2026-11-14 01:04:40')
    const e = s.expiries[0]
    expect(e).toMatchObject({ expiry: '2026-12-18', dte: 34 })
    expect(e.atmIv).toBeCloseTo(0.25, 10)
    expect(e.expectedMove).toBeCloseTo(0.25 * Math.sqrt(34 / 365), 10)
  })
  it('interpolates ATM when spot sits between strikes', () => {
    const s = buildVolSurface(raw(chain('2026-12-18', 0.25), 102), NOW)!
    // IV is linear in strike here: 0.25 − 0.002 × (102 − 100)
    expect(s.expiries[0].atmIv).toBeCloseTo(0.246, 10)
  })
  it('measures skew: puts dearer than calls gives a negative risk reversal', () => {
    const e = buildVolSurface(raw(chain('2026-12-18', 0.25, -0.002)), NOW)!.expiries[0]
    expect(e.put25!).toBeGreaterThan(e.atmIv)
    expect(e.call25!).toBeLessThan(e.atmIv)
    expect(e.riskReversal!).toBeLessThan(0)
    // 25-delta strikes are ±10% here, so the wings are atm ± 0.02.
    expect(e.put25!).toBeCloseTo(0.27, 6)
    expect(e.call25!).toBeCloseTo(0.23, 6)
    const flat = buildVolSurface(raw(chain('2026-12-18', 0.25, 0)), NOW)!.expiries[0]
    expect(flat.riskReversal!).toBeCloseTo(0, 10)
  })
  it('builds a smile from out-of-the-money options only, inside ±25%', () => {
    const e = buildVolSurface(raw(chain('2026-12-18', 0.25)), NOW)!.expiries[0]
    expect(e.smile.map(p => p.strike)).toEqual([75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125])
    expect(e.smile.find(p => p.strike === 100)!.moneyness).toBe(0)
    expect(e.smile.every((p, i, a) => i === 0 || p.strike > a[i - 1].strike)).toBe(true)
  })
  it('orders expiries and reads the term structure', () => {
    const rising = buildVolSurface(raw([...chain('2027-02-19', 0.30), ...chain('2026-11-27', 0.20)]), NOW)!
    expect(rising.expiries.map(e => e.expiry)).toEqual(['2026-11-27', '2027-02-19'])
    expect(rising.shape).toBe('rising')
    expect(buildVolSurface(raw([...chain('2026-11-27', 0.40), ...chain('2027-02-19', 0.25)]), NOW)!.shape).toBe('inverted')
    expect(buildVolSurface(raw([...chain('2026-11-27', 0.25), ...chain('2027-02-19', 0.252)]), NOW)!.shape).toBe('flat')
    expect(buildVolSurface(raw(chain('2026-11-27', 0.25)), NOW)!.shape).toBeNull()      // one expiry: no shape to speak of
  })
  it('skips expired and same-day expiries', () => {
    const s = buildVolSurface(raw([...chain('2026-11-13', 0.9), ...chain('2026-11-14', 0.9), ...chain('2026-11-20', 0.2)]), NOW)!
    expect(s.expiries.map(e => e.expiry)).toEqual(['2026-11-20'])
  })
  it('ignores contracts nobody is quoting, and absurd IVs', () => {
    const good = chain('2026-12-18', 0.25)
    const junk: RawOption[] = [
      { option: occ('2026-12-18', 'C', 101), iv: 3.9, delta: 0.45, bid: 0, open_interest: 0 },   // no bid, no interest
      { option: occ('2026-12-18', 'C', 102), iv: 0, delta: 0.4, bid: 1, open_interest: 5 },       // no IV
      { option: occ('2026-12-18', 'C', 103), iv: 9, delta: 0.4, bid: 1, open_interest: 5 },       // 900% is a bad print
      { option: 'garbage', iv: 0.5, bid: 1 },
    ]
    const e = buildVolSurface(raw([...good, ...junk]), NOW)!.expiries[0]
    expect(e.atmIv).toBeCloseTo(0.25, 10)
    expect(e.smile.some(p => [101, 102, 103].includes(p.strike))).toBe(false)
  })
  it('returns null rather than a surface it cannot justify', () => {
    expect(buildVolSurface(null, NOW)).toBeNull()
    expect(buildVolSurface({ data: { current_price: 0, options: chain('2026-12-18', 0.25) } }, NOW)).toBeNull()
    expect(buildVolSurface(raw([]), NOW)).toBeNull()
    expect(buildVolSurface(raw(chain('2026-12-18', 0.25).slice(0, 4)), NOW)).toBeNull()         // too few strikes
    // Spot outside every strike: ATM cannot be interpolated.
    expect(buildVolSurface(raw(chain('2026-12-18', 0.25), 500), NOW)).toBeNull()
  })
  it('thins a long list of expiries but keeps the near ones and the furthest', () => {
    const many = Array.from({ length: 24 }, (_, i) => i)
    const kept = thinExpiries(many)
    expect(kept).toHaveLength(14)
    expect(kept.slice(0, 6)).toEqual([0, 1, 2, 3, 4, 5])
    expect(kept[13]).toBe(23)
    expect(new Set(kept).size).toBe(14)
    expect(kept.every((v, i, a) => i === 0 || v > a[i - 1])).toBe(true)
    expect(thinExpiries([1, 2, 3])).toEqual([1, 2, 3])
  })
  it('never emits NaN or Infinity', () => {
    const s = buildVolSurface(raw([...chain('2026-11-20', 0.2), ...chain('2027-06-18', 0.3)]), NOW)!
    expect(JSON.stringify(s)).not.toMatch(/NaN|Infinity/)
  })
})

describe('CBOE symbols', () => {
  it('accepts US tickers and known indices only', () => {
    expect(cboeSymbol('aapl')).toBe('AAPL')
    expect(cboeSymbol('^SPX')).toBe('_SPX')
    expect(cboeSymbol('^GSPC')).toBe('_SPX')
    for (const s of ['RELIANCE.NS', '^NSEI', 'BTC-USD', 'CL=F', '../x', 'A/B', 'TOOLONG', ''])
      expect(cboeSymbol(s), s).toBeNull()
  })
  it('the data host is on the outbound allowlist', () => {
    expect(isAllowedHost('cdn-api.cboe.com')).toBe(true)
  })
})
