// src/lib/vol-surface.ts
// Implied-volatility term structure and skew from a full options chain.
// Pure: no network, no clock unless passed in. Unit-tested.
//
// Input is the chain as CBOE publishes it (delayed, free, keyless): every
// contract with its implied volatility and delta. Output is small:
//   • per expiry: at-the-money IV, 25-delta put and call IV, the risk reversal
//     (call minus put), and the move the market is pricing by that date;
//   • a smile for each expiry: out-of-the-money IV by strike.
//
// Conventions:
//   • Only out-of-the-money options are used (puts below spot, calls above).
//     They are the liquid side; in-the-money quotes are wide and noisy.
//   • A contract is used only if it has an IV and someone is interested in it
//     (a bid, or open interest). Stale zero-bid strikes would bend the curve.
//   • IV is annualised, as a fraction (0.25 = 25%).

export interface RawOption {
  option?: string            // OCC symbol, e.g. AAPL261120C00415000
  iv?: number
  delta?: number
  bid?: number
  open_interest?: number
}

export interface RawChain {
  timestamp?: string
  data?: { current_price?: number; close?: number; iv30?: number; options?: RawOption[] }
}

export interface SmilePoint { strike: number; moneyness: number; iv: number }

export interface ExpiryVol {
  expiry:  string            // ISO date
  dte:     number            // calendar days to expiry (≥ 1)
  atmIv:   number
  put25:   number | null     // IV of the 25-delta put
  call25:  number | null     // IV of the 25-delta call
  /** call25 − put25. Negative = downside protection costs more (the usual state for shares). */
  riskReversal: number | null
  /** One-standard-deviation move by expiry, as a fraction of spot. */
  expectedMove: number
  smile:   SmilePoint[]
}

export interface VolSurface {
  spot:     number
  iv30:     number | null
  asOf:     string | null
  expiries: ExpiryVol[]
  /** Front versus roughly three months out. */
  shape:    'rising' | 'flat' | 'inverted' | null
}

const OCC = /^([A-Z0-9.^_]{1,8})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/
const MAX_EXPIRIES  = 14
const SMILE_BAND    = 0.25          // keep strikes within ±25% of spot
const MAX_SMILE_PTS = 41

export function parseOcc(symbol: string): { expiry: string; type: 'C' | 'P'; strike: number } | null {
  const m = OCC.exec(symbol.trim())
  if (!m) return null
  const [, , yy, mm, dd, type, k] = m
  const month = Number(mm), day = Number(dd), strike = Number(k) / 1000
  if (month < 1 || month > 12 || day < 1 || day > 31 || !(strike > 0)) return null
  return { expiry: `20${yy}-${mm}-${dd}`, type: type as 'C' | 'P', strike }
}

interface Pt { x: number; y: number }

/** Linear interpolation of y at x over points sorted by x; null outside the range. */
export function interpolate(points: readonly Pt[], x: number): number | null {
  if (!points.length) return null
  for (let i = 0; i < points.length; i++) {
    if (points[i].x === x) return points[i].y
    if (points[i].x > x) {
      if (i === 0) return null
      const a = points[i - 1], b = points[i]
      return a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y)
    }
  }
  return null
}

const usable = (o: RawOption) =>
  typeof o.iv === 'number' && Number.isFinite(o.iv) && o.iv > 0.01 && o.iv < 5 &&
  ((typeof o.bid === 'number' && o.bid > 0) || (typeof o.open_interest === 'number' && o.open_interest > 0))

export function buildVolSurface(raw: RawChain | null | undefined, now: Date = new Date()): VolSurface | null {
  const d = raw?.data
  const spot = typeof d?.current_price === 'number' && d.current_price > 0 ? d.current_price
             : typeof d?.close === 'number' && d.close > 0 ? d.close : null
  if (!d || spot === null || !Array.isArray(d.options)) return null

  interface Row { strike: number; iv: number; delta: number | null }
  const byExpiry = new Map<string, { calls: Row[]; puts: Row[] }>()
  for (const o of d.options) {
    if (!o || typeof o.option !== 'string' || !usable(o)) continue
    const p = parseOcc(o.option)
    if (!p) continue
    if (!byExpiry.has(p.expiry)) byExpiry.set(p.expiry, { calls: [], puts: [] })
    const row: Row = { strike: p.strike, iv: o.iv!, delta: typeof o.delta === 'number' && Number.isFinite(o.delta) ? o.delta : null }
    byExpiry.get(p.expiry)![p.type === 'C' ? 'calls' : 'puts'].push(row)
  }

  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const all: ExpiryVol[] = []

  for (const expiry of [...byExpiry.keys()].sort()) {
    const dte = Math.round((Date.parse(`${expiry}T00:00:00Z`) - today) / 86_400_000)
    if (!(dte >= 1)) continue                       // expired, or expiring today: no time value left to read
    const { calls, puts } = byExpiry.get(expiry)!
    calls.sort((a, b) => a.strike - b.strike); puts.sort((a, b) => a.strike - b.strike)

    // Out-of-the-money curve across strikes: puts up to spot, calls from spot.
    const otm: Pt[] = [
      ...puts.filter(r => r.strike <= spot).map(r => ({ x: r.strike, y: r.iv })),
      ...calls.filter(r => r.strike > spot).map(r => ({ x: r.strike, y: r.iv })),
    ]
    const atmIv = interpolate(otm, spot)
    if (atmIv === null || otm.length < 4) continue

    // 25-delta wings, interpolated in delta. Call deltas fall as strikes rise; put deltas are negative.
    const callByDelta = calls.filter(r => r.delta !== null && r.strike > spot).map(r => ({ x: r.delta!, y: r.iv })).sort((a, b) => a.x - b.x)
    const putByDelta  = puts.filter(r => r.delta !== null && r.strike < spot).map(r => ({ x: -r.delta!, y: r.iv })).sort((a, b) => a.x - b.x)
    const call25 = interpolate(callByDelta, 0.25), put25 = interpolate(putByDelta, 0.25)

    let smile = otm.filter(p => Math.abs(p.x / spot - 1) <= SMILE_BAND).map(p => ({ strike: p.x, moneyness: (p.x / spot - 1) * 100, iv: p.y }))
    if (smile.length > MAX_SMILE_PTS) {
      const step = smile.length / MAX_SMILE_PTS
      smile = Array.from({ length: MAX_SMILE_PTS }, (_, i) => smile[Math.min(smile.length - 1, Math.round(i * step))])
    }

    all.push({
      expiry, dte, atmIv, put25, call25,
      riskReversal: call25 !== null && put25 !== null ? call25 - put25 : null,
      expectedMove: atmIv * Math.sqrt(dte / 365),
      smile,
    })
  }

  if (!all.length) return null
  const expiries = thinExpiries(all)

  // Shape: the first expiry at least a week out versus the one nearest 90 days.
  const front = expiries.find(e => e.dte >= 7) ?? expiries[0]
  const back  = expiries.reduce((best, e) => (Math.abs(e.dte - 90) < Math.abs(best.dte - 90) ? e : best), expiries[0])
  let shape: VolSurface['shape'] = null
  if (back.dte - front.dte >= 30) {
    const diff = back.atmIv - front.atmIv
    shape = Math.abs(diff) < 0.01 ? 'flat' : diff > 0 ? 'rising' : 'inverted'
  }

  return {
    spot,
    iv30: typeof d.iv30 === 'number' && d.iv30 > 0 ? d.iv30 / 100 : null,
    asOf: typeof raw?.timestamp === 'string' ? raw.timestamp.slice(0, 19) : null,
    expiries, shape,
  }
}

/**
 * Keep at most MAX_EXPIRIES while still covering the whole curve: every one of
 * the nearest NEAR_KEPT (where the detail is), then an even sample of the rest
 * that always includes the furthest expiry.
 */
const NEAR_KEPT = 6
export function thinExpiries<T>(rows: readonly T[]): T[] {
  if (rows.length <= MAX_EXPIRIES) return [...rows]
  const near = rows.slice(0, NEAR_KEPT), far = rows.slice(NEAR_KEPT)
  const want = MAX_EXPIRIES - NEAR_KEPT
  const picked = Array.from({ length: want }, (_, i) => far[Math.round(((i + 1) * far.length) / want) - 1])
  return [...near, ...picked]
}

/** CBOE's symbol for an underlying, or null when it is not a US optionable ticker. */
export function cboeSymbol(symbol: string): string | null {
  const s = symbol.trim().toUpperCase()
  const INDEX: Record<string, string> = { '^SPX': '_SPX', '^GSPC': '_SPX', '^VIX': '_VIX', '^NDX': '_NDX', '^RUT': '_RUT', '^DJX': '_DJX' }
  if (INDEX[s]) return INDEX[s]
  return /^[A-Z]{1,5}$/.test(s) ? s : null
}
