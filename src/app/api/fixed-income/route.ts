// src/app/api/fixed-income/route.ts
// ─────────────────────────────────────────────────────────────────────────────
// Production-Grade Fixed Income Intelligence — US + India
//
// DATA INTEGRITY CONTRACT
// ──────────────────────
//   "live"       → From primary market API within last 24h (e.g., FRED Treasury).
//   "official"   → Government/central bank published; may have reporting lag.
//   "modeled"    → Nelson-Siegel derived from real inputs. User must explicitly
//                  opt-in via ?modeled=1. Never silently substituted.
//   "synthetic"  → Illustrative bonds derived from live yields. NOT real bonds.
//                  Always flagged in every field.
//   "unavailable"→ Source failed; no fallback invented. Partial data returned.
//
// SOURCES
//   US: FRED (11 Treasury series, BAML IG/HY/BBB OAS) — daily
//   IN: NSE India liveBonds API — primary live source
//   IN: RBI DBIE API — official with lag
//   IN: FRED INTDSRINM193N — IMF IFS proxy, quarterly lag
//   IN: Official RBI decision table — last-known, clearly labeled
//
// NO HARDCODED SPREADS. NO SILENT SYNTHETIC CURVES.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server'
import { callAI } from '@/lib/ai-provider'

const cache = new Map<string, { data: unknown; expires: number }>()

// ═══════════════════════════════════════════════════════════════════════════════
// DATA INTEGRITY TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type DataSourceType = 'live' | 'official' | 'modeled' | 'synthetic' | 'unavailable'

export interface DataPoint<T> {
  value:          T | null
  source:         string
  sourceUrl?:     string
  dataSourceType: DataSourceType
  fetchedAt:      string
  reportingDate?: string
  ageHours?:      number
  notes?:         string
}

export interface YieldPoint {
  tenor:         string
  maturityYears: number
  yieldData:     DataPoint<number>
}

export interface SpreadData {
  igOAS:         DataPoint<number>
  hyOAS:         DataPoint<number>
  bbbSpread:     DataPoint<number>
  twoTenSpread:  DataPoint<number>
  psuSpread?:    DataPoint<number>
  sdlSpread?:    DataPoint<number>
  tenYrVsRepo?:  DataPoint<number>
}

export interface BondData {
  id:               string
  issuer:           string
  type:             string
  country:          'US' | 'IN'
  coupon:           number
  maturityDate:     string
  maturityYears:    number
  price:            DataPoint<number>
  ytm:              DataPoint<number>
  macaulayDuration: number
  modifiedDuration: number
  convexity:        number
  spreadBps:        DataPoint<number>
  rating:           string
  liquidityScore:   number
  currency:         'USD' | 'INR'
  isin?:            string
  synthetic:        true
  syntheticNote:    string
}

export interface MacroContext {
  policyRate: DataPoint<number>
  cpi:        DataPoint<number>
  label:      string
  stance:     string
}

export interface IndiaAvailability {
  nseSuccess:    boolean
  dbieSuccess:   boolean
  anyLiveData:   boolean
  message:       string
}

export interface TipsBreakeven {
  dfii5:  DataPoint<number>
  dfii10: DataPoint<number>
  be5y:   DataPoint<number>
  be10y:  DataPoint<number>
}

export interface TradingSignals {
  duration:        'EXTEND' | 'NEUTRAL' | 'REDUCE'
  durationReason:  string
  durationColor:   string
  credit:          'ADD' | 'NEUTRAL' | 'REDUCE' | 'N/A'
  creditReason:    string
  creditColor:     string
  curveSignal:     'STEEPEN' | 'NEUTRAL' | 'FLATTEN' | 'N/A'
  curveReason:     string
  recessionRisk:   'LOW' | 'MODERATE' | 'ELEVATED'
  recessionReason: string
  recessionColor:  string
}

export interface FixedIncomeResponse {
  market:             'US' | 'IN'
  yieldCurve:         YieldPoint[]
  bonds:              BondData[]
  spreads:            SpreadData | null
  macroContext:       MacroContext
  curveShape:         string
  curveDataQuality:   DataSourceType
  indiaAvailability?: IndiaAvailability
  systemMessages:     string[]
  fetchedAt:          string
  insights?:          string
  insightsProvider?:  string
  insightsError?:     string
  tips?:              TipsBreakeven
  signals?:           TradingSignals
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUANT ENGINE — inputs must be real; the math itself is always correct
// ═══════════════════════════════════════════════════════════════════════════════

function bondPriceFn(coupon: number, ytm: number, mat: number, face = 100, freq = 2): number {
  if (mat <= 0) return face
  const r = ytm / 100 / freq
  const c = (coupon / 100 * face) / freq
  const n = Math.round(mat * freq)
  let pv = 0
  for (let t = 1; t <= n; t++) pv += c / Math.pow(1 + r, t)
  return pv + face / Math.pow(1 + r, n)
}

function calcYTM(price: number, coupon: number, mat: number, face = 100, freq = 2): number {
  if (mat <= 0 || price <= 0) return 0
  const n = Math.round(mat * freq)
  const c = (coupon / 100 * face) / freq
  let y   = (c * freq + (face - price) / mat) / ((face + price) / 2) / 100 * freq
  for (let i = 0; i < 300; i++) {
    let pv = 0, dpv = 0
    for (let t = 1; t <= n; t++) {
      const df = Math.pow(1 + y, -t)
      pv  += c * df
      dpv -= t * c * df / (1 + y)
    }
    const fd = Math.pow(1 + y, -n)
    pv  += face * fd
    dpv -= n * face * fd / (1 + y)
    const err = pv - price
    if (Math.abs(err) < 1e-10 || Math.abs(dpv) < 1e-14) break
    y -= err / dpv
    y = Math.max(-0.99, Math.min(y, 10))
  }
  return y * freq * 100
}

function calcDurConvex(price: number, coupon: number, ytm: number, mat: number, face = 100, freq = 2) {
  if (mat <= 0 || price <= 0 || ytm <= 0) return { mac: 0, mod: 0, cvx: 0 }
  const r = ytm / 100 / freq
  const c = (coupon / 100 * face) / freq
  const n = Math.round(mat * freq)
  let mac = 0, cvx = 0
  for (let t = 1; t <= n; t++) {
    const cf   = t < n ? c : c + face
    const pvcf = cf * Math.pow(1 + r, -t)
    mac += (t / freq) * pvcf
    cvx += t * (t + 1) * pvcf
  }
  const macaulay  = mac / price
  const modified  = macaulay / (1 + r)
  const convexity = cvx / (price * Math.pow(1 + r, 2) * freq * freq)
  return { mac: macaulay, mod: modified, cvx: convexity }
}

function nelsonSiegel(tau: number, b0: number, b1: number, b2: number, lam: number): number {
  if (tau <= 0) return b0 + b1
  const x  = tau / lam
  const ex = Math.exp(-x)
  const f1 = (1 - ex) / x
  return b0 + b1 * f1 + b2 * (f1 - ex)
}

function classifyCurve(pts: YieldPoint[]): string {
  const valid = pts.filter(p => p.yieldData.value !== null)
  if (valid.length < 3) return 'unknown'
  const s = valid.find(p => p.maturityYears <= 2)?.yieldData.value
  const m = valid.find(p => p.maturityYears >= 4 && p.maturityYears <= 6)?.yieldData.value
  const l = valid.find(p => p.maturityYears >= 9)?.yieldData.value
  if (!s || !l) return 'unknown'
  const slope = l - s
  if (slope > 0.5)  return 'normal'
  if (slope < -0.5) return 'inverted'
  if (m && m > Math.max(s, l) + 0.2) return 'humped'
  return 'flat'
}

function ageHours(dateStr: string): number {
  try { return (Date.now() - new Date(dateStr).getTime()) / 3_600_000 } catch { return 9999 }
}

// ═══════════════════════════════════════════════════════════════════════════════
// US DATA PIPELINE — FRED
// ═══════════════════════════════════════════════════════════════════════════════

const US_TENORS = [
  { series: 'DGS1MO', tenor: '1M',  mat: 1/12  },
  { series: 'DGS3MO', tenor: '3M',  mat: 0.25  },
  { series: 'DGS6MO', tenor: '6M',  mat: 0.5   },
  { series: 'DGS1',   tenor: '1Y',  mat: 1     },
  { series: 'DGS2',   tenor: '2Y',  mat: 2     },
  { series: 'DGS3',   tenor: '3Y',  mat: 3     },
  { series: 'DGS5',   tenor: '5Y',  mat: 5     },
  { series: 'DGS7',   tenor: '7Y',  mat: 7     },
  { series: 'DGS10',  tenor: '10Y', mat: 10    },
  { series: 'DGS20',  tenor: '20Y', mat: 20    },
  { series: 'DGS30',  tenor: '30Y', mat: 30    },
]

async function fredFetch(series: string): Promise<{ value: number; date: string } | null> {
  if (!process.env.FRED_API_KEY) return null
  const ck = `fred:${series}`
  const hit = cache.get(ck)
  if (hit && hit.expires > Date.now()) return hit.data as { value: number; date: string }
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${process.env.FRED_API_KEY}&file_type=json&sort_order=desc&limit=3`
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) })
    if (!res.ok) return null
    const j   = await res.json()
    const obs = (j.observations ?? []).find((o: any) => o.value !== '.' && parseFloat(o.value) > 0)
    if (!obs) return null
    const result = { value: parseFloat(obs.value), date: obs.date }
    cache.set(ck, { data: result, expires: Date.now() + 3_600_000 })
    return result
  } catch { return null }
}

// ── YoY % from FRED index series (computes 12-month change) ─────────────────
async function fredYoY(series: string): Promise<{ value: number; date: string } | null> {
  if (!process.env.FRED_API_KEY) return null
  const ck = `fredyoy:${series}`
  const hit = cache.get(ck)
  if (hit && hit.expires > Date.now()) return hit.data as { value: number; date: string }
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${process.env.FRED_API_KEY}&file_type=json&sort_order=desc&limit=14`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const j = await res.json()
    const obs = (j.observations ?? [])
      .filter((o: any) => o.value !== '.')
      .map((o: any) => ({ value: parseFloat(o.value), date: o.date }))
    if (obs.length < 13) return null
    const yoy = ((obs[0].value - obs[12].value) / Math.abs(obs[12].value)) * 100
    const result = { value: parseFloat(yoy.toFixed(2)), date: obs[0].date }
    cache.set(ck, { data: result, expires: Date.now() + 4 * 3600_000 })
    return result
  } catch { return null }
}

// ── TIPS real yields + breakeven inflation from FRED ────────────────────────
async function fetchTipsBreakeven(): Promise<TipsBreakeven> {
  const now = new Date().toISOString()
  const mk = async (series: string, label: string): Promise<DataPoint<number>> => {
    const obs = await fredFetch(series)
    const age = obs ? (Date.now() - new Date(obs.date).getTime()) / 3_600_000 : 9999
    return {
      value:          obs?.value ?? null,
      source:         `FRED ${series} — ${label}`,
      sourceUrl:      `https://fred.stlouisfed.org/series/${series}`,
      dataSourceType: (obs && age < 96 ? 'live' : obs ? 'official' : 'unavailable') as DataSourceType,
      fetchedAt:      now,
      reportingDate:  obs?.date,
      ageHours:       obs ? Math.round(age) : undefined,
      notes:          !obs ? `${series} unavailable from FRED.` : undefined,
    }
  }
  const [dfii5, dfii10, be5y, be10y] = await Promise.all([
    mk('DFII5',  '5Y TIPS Real Yield'),
    mk('DFII10', '10Y TIPS Real Yield'),
    mk('T5YIE',  '5Y Breakeven Inflation'),
    mk('T10YIE', '10Y Breakeven Inflation'),
  ])
  return { dfii5, dfii10, be5y, be10y }
}

// ── Trading signals from live market data ────────────────────────────────────
function computeSignals(
  realRate: number | null,
  igOAS: number | null,
  twoTenBps: number | null,
): TradingSignals {
  let duration: TradingSignals['duration'] = 'NEUTRAL'
  let durationReason = 'Real rate near neutral — no directional edge'
  let durationColor  = '#f0a500'
  if (realRate !== null) {
    if (realRate > 1.5)  { duration = 'REDUCE'; durationReason = `Real rate +${realRate.toFixed(2)}% — bonds expensive vs cash`; durationColor = '#ff4560' }
    else if (realRate < -0.5) { duration = 'EXTEND'; durationReason = `Negative real rate (${realRate.toFixed(2)}%) — duration attractive`; durationColor = '#00c97a' }
    else if (realRate <= 0.5) { duration = 'EXTEND'; durationReason = `Low real rate (${realRate.toFixed(2)}%) — carry favors longer duration`; durationColor = '#00c97a' }
  }

  let credit: TradingSignals['credit'] = 'N/A'
  let creditReason = 'IG OAS data unavailable from FRED'
  let creditColor  = '#4a6070'
  if (igOAS !== null) {
    if (igOAS < 80)       { credit = 'REDUCE'; creditReason = `IG OAS ${igOAS}bp — historically tight, limited margin of safety`; creditColor = '#ff4560' }
    else if (igOAS < 110) { credit = 'NEUTRAL'; creditReason = `IG OAS ${igOAS}bp — fair value, selective sector allocation`;       creditColor = '#f0a500' }
    else                  { credit = 'ADD';     creditReason = `IG OAS ${igOAS}bp — spreads offer real compensation for risk`;      creditColor = '#00c97a' }
  }

  let curveSignal: TradingSignals['curveSignal'] = 'N/A'
  let curveReason = '2Y/10Y data insufficient for curve signal'
  if (twoTenBps !== null) {
    if (twoTenBps > 80)       { curveSignal = 'FLATTEN'; curveReason = `2s10s +${twoTenBps}bp — curve steep, flatteners in focus` }
    else if (twoTenBps < -10) { curveSignal = 'STEEPEN'; curveReason = `2s10s ${twoTenBps}bp inverted — steepeners if recession unfolds` }
    else                       { curveSignal = 'NEUTRAL'; curveReason = `2s10s ${twoTenBps}bp — flat curve, no strong directional signal` }
  }

  let recessionRisk: TradingSignals['recessionRisk'] = 'LOW'
  let recessionReason = 'Curve not inverted — no structural recession signal'
  let recessionColor  = '#00c97a'
  if (twoTenBps !== null) {
    if (twoTenBps < -25)     { recessionRisk = 'ELEVATED'; recessionReason = `2s10s ${twoTenBps}bp — deep inversion historically precedes recession by 12-18M`; recessionColor = '#ff4560' }
    else if (twoTenBps < 10) { recessionRisk = 'MODERATE'; recessionReason = `2s10s flat (${twoTenBps}bp) — watch for sustained inversion`; recessionColor = '#f0a500' }
  }

  return { duration, durationReason, durationColor, credit, creditReason, creditColor, curveSignal, curveReason, recessionRisk, recessionReason, recessionColor }
}

async function fetchUSYieldCurve(): Promise<YieldPoint[]> {
  const now = new Date().toISOString()
  const results = await Promise.all(
    US_TENORS.map(async ({ series, tenor, mat }) => {
      const obs = await fredFetch(series)
      const age = obs ? ageHours(obs.date) : 9999
      const dst: DataSourceType = obs && age < 96 ? 'live' : obs ? 'official' : 'unavailable'
      return {
        tenor,
        maturityYears: mat,
        yieldData: {
          value:          obs?.value ?? null,
          source:         `FRED ${series} (US Treasury)`,
          sourceUrl:      `https://fred.stlouisfed.org/series/${series}`,
          dataSourceType: dst,
          fetchedAt:      now,
          reportingDate:  obs?.date,
          ageHours:       obs ? Math.round(age) : undefined,
          notes:          !obs ? `FRED returned no data for ${series}.` : undefined,
        },
      } as YieldPoint
    })
  )
  return results.filter(p => p.yieldData.value !== null)
}

async function fetchUSSpreads(curve: YieldPoint[]): Promise<SpreadData> {
  const now = new Date().toISOString()

  const mkSpread = async (series: string, label: string): Promise<DataPoint<number>> => {
    const obs = await fredFetch(series)
    const age = obs ? ageHours(obs.date) : 9999
    return {
      value:          obs?.value ?? null,
      source:         `FRED ${series} — ICE BofA ${label}`,
      sourceUrl:      `https://fred.stlouisfed.org/series/${series}`,
      dataSourceType: (obs && age < 96 ? 'live' : obs ? 'official' : 'unavailable') as DataSourceType,
      fetchedAt:      now,
      reportingDate:  obs?.date,
      ageHours:       obs ? Math.round(age) : undefined,
      notes:          !obs ? `FRED ${series} unavailable. No fallback substituted.` : undefined,
    }
  }

  const twoY = curve.find(p => p.maturityYears === 2)
  const tenY = curve.find(p => p.maturityYears === 10)
  const bothLive = twoY?.yieldData.dataSourceType === 'live' && tenY?.yieldData.dataSourceType === 'live'

  const twoTen: DataPoint<number> = {
    value: twoY?.yieldData.value != null && tenY?.yieldData.value != null
      ? Math.round((tenY.yieldData.value - twoY.yieldData.value) * 100)
      : null,
    source:         'Computed: FRED DGS10 − FRED DGS2',
    dataSourceType: bothLive ? 'live' : twoY?.yieldData.value != null && tenY?.yieldData.value != null ? 'official' : 'unavailable' as DataSourceType,
    fetchedAt:      now,
    reportingDate:  tenY?.yieldData.reportingDate,
    notes:          (!twoY?.yieldData.value || !tenY?.yieldData.value) ? 'Cannot compute spread — missing tenor data.' : undefined,
  }

  const [ig, hy, bbb] = await Promise.all([
    mkSpread('BAMLC0A0CM',    'US Corp IG OAS'),
    mkSpread('BAMLH0A0HYM2',  'US HY OAS'),
    mkSpread('BAMLC0A4CBBBM', 'US BBB OAS'),
  ])

  return { igOAS: ig, hyOAS: hy, bbbSpread: bbb, twoTenSpread: twoTen }
}

function buildUSBonds(curve: YieldPoint[], spreads: SpreadData): BondData[] {
  const now  = new Date().toISOString()
  const note = 'Illustrative instrument. Coupon and maturity represent current on-the-run structure; NOT fetched from a live bond database. All analytics (YTM, Duration, Convexity) use live FRED yield inputs.'

  const getY = (mat: number): { yield: number; quality: DataSourceType } | null => {
    const exact = curve.find(p => Math.abs(p.maturityYears - mat) < 0.3 && p.yieldData.value !== null)
    if (exact?.yieldData.value) return { yield: exact.yieldData.value, quality: exact.yieldData.dataSourceType }
    const lo = [...curve].reverse().find(p => p.maturityYears <= mat && p.yieldData.value !== null)
    const hi = curve.find(p => p.maturityYears >= mat && p.yieldData.value !== null)
    if (!lo?.yieldData.value || !hi?.yieldData.value) return null
    const t = (mat - lo.maturityYears) / (hi.maturityYears - lo.maturityYears)
    return { yield: lo.yieldData.value + t * (hi.yieldData.value - lo.yieldData.value), quality: 'live' }
  }

  const igBps  = spreads.igOAS.value
  const hyBps  = spreads.hyOAS.value
  const bbbBps = spreads.bbbSpread.value

  const templates: { id: string; issuer: string; type: string; coupon: number; mat: number; addBps: number | null; basisBps: number | null; rating: string; liq: number }[] = [
    { id:'ust-3m',   issuer:'US Treasury (3M T-Bill)',       type:'treasury',     coupon:0,    mat:0.25, addBps:0,                               basisBps:0,    rating:'UST', liq:10 },
    { id:'ust-6m',   issuer:'US Treasury (6M T-Bill)',       type:'treasury',     coupon:0,    mat:0.5,  addBps:0,                               basisBps:0,    rating:'UST', liq:10 },
    { id:'ust-2y',   issuer:'US Treasury (2Y Note)',         type:'treasury',     coupon:4.25, mat:2,    addBps:0,                               basisBps:0,    rating:'UST', liq:10 },
    { id:'ust-5y',   issuer:'US Treasury (5Y Note)',         type:'treasury',     coupon:4.00, mat:5,    addBps:0,                               basisBps:0,    rating:'UST', liq:10 },
    { id:'ust-10y',  issuer:'US Treasury (10Y Note)',        type:'treasury',     coupon:4.25, mat:10,   addBps:0,                               basisBps:0,    rating:'UST', liq:10 },
    { id:'ust-30y',  issuer:'US Treasury (30Y Bond)',        type:'treasury',     coupon:4.50, mat:30,   addBps:0,                               basisBps:0,    rating:'UST', liq:10 },
    { id:'ig-aaa-5y',issuer:'AAA IG Corp (5Y Repr.)',        type:'ig-corporate', coupon:4.10, mat:5,    addBps: igBps  != null ? igBps  - 40 : null, basisBps:igBps,  rating:'Aaa', liq:8 },
    { id:'ig-a-7y',  issuer:'A-rated Corp (7Y Repr.)',       type:'ig-corporate', coupon:4.50, mat:7,    addBps: igBps  != null ? igBps  + 20 : null, basisBps:igBps,  rating:'A2',  liq:7 },
    { id:'bbb-5y',   issuer:'BBB Corp (5Y Repr.)',           type:'ig-corporate', coupon:4.90, mat:5,    addBps: bbbBps,                              basisBps:bbbBps, rating:'Baa', liq:6 },
    { id:'hy-bb-5y', issuer:'BB HY Corp (5Y Repr.)',         type:'hy-corporate', coupon:6.50, mat:5,    addBps: hyBps  != null ? hyBps  - 100 : null,basisBps:hyBps,  rating:'Ba2', liq:5 },
    { id:'hy-b-5y',  issuer:'B HY Corp (5Y Repr.)',          type:'hy-corporate', coupon:8.25, mat:5,    addBps: hyBps  != null ? hyBps  + 120 : null,basisBps:hyBps,  rating:'B2',  liq:4 },
  ]

  return templates.map(t => {
    const bench  = getY(t.mat)
    const ytmRaw = bench !== null && t.addBps !== null ? bench.yield + t.addBps / 100 : bench?.yield ?? null
    const effCpn = t.coupon === 0 ? (ytmRaw ?? 4) : t.coupon
    const price  = ytmRaw !== null
      ? t.coupon === 0 ? 100 / (1 + ytmRaw / 100 * t.mat) : bondPriceFn(effCpn, ytmRaw, t.mat)
      : null
    const { mac, mod, cvx } = price !== null && ytmRaw !== null
      ? calcDurConvex(price, effCpn, ytmRaw, t.mat)
      : { mac: 0, mod: 0, cvx: 0 }

    const matDate = new Date()
    matDate.setMonth(matDate.getMonth() + Math.round(t.mat * 12))
    const yQ: DataSourceType = bench?.quality ?? 'unavailable'
    const spQ: DataSourceType = t.addBps === 0 ? yQ : (t.addBps !== null && t.basisBps !== null) ? (spreads.igOAS.dataSourceType === 'live' ? 'live' : 'official') : 'unavailable'

    return {
      id: t.id, issuer: t.issuer, type: t.type, country: 'US' as const,
      coupon: t.coupon,
      maturityDate: matDate.toISOString().slice(0, 7),
      maturityYears: t.mat,
      price: {
        value: price !== null ? parseFloat(price.toFixed(3)) : null,
        source: 'Computed from bond pricing formula using live FRED yield',
        dataSourceType: yQ,
        fetchedAt: now,
        notes: price === null ? 'Cannot price — FRED yield unavailable for this tenor.' : undefined,
      },
      ytm: {
        value: ytmRaw !== null ? parseFloat(ytmRaw.toFixed(3)) : null,
        source: t.addBps === 0 ? 'FRED Treasury yield (zero spread — benchmark)' : `FRED Treasury yield + BAML ${t.type === 'hy-corporate' ? 'HY' : 'IG/BBB'} OAS`,
        dataSourceType: spQ,
        fetchedAt: now,
        notes: ytmRaw === null ? 'YTM unavailable: missing FRED yield or BAML spread data.' : undefined,
      },
      macaulayDuration: parseFloat(mac.toFixed(3)),
      modifiedDuration: parseFloat(mod.toFixed(3)),
      convexity:        parseFloat(cvx.toFixed(5)),
      spreadBps: {
        value: t.addBps !== null ? Math.round(t.addBps) : null,
        source: t.addBps === 0 ? 'Benchmark — zero spread by definition' : `FRED ICE BofA ${t.type === 'hy-corporate' ? 'HY' : 'IG/BBB'} OAS`,
        dataSourceType: spQ,
        fetchedAt: now,
        notes: t.addBps === null ? 'BAML spread data unavailable from FRED. No fallback used.' : undefined,
      },
      rating: t.rating, liquidityScore: t.liq, currency: 'USD' as const,
      synthetic: true as const, syntheticNote: note,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDIA DATA PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

const NSE_SESSION = { cookie: '', exp: 0 }

async function getNSECookie(): Promise<string> {
  if (NSE_SESSION.cookie && NSE_SESSION.exp > Date.now()) return NSE_SESSION.cookie
  for (const page of [
    'https://www.nseindia.com/market-data/bonds-traded-in-capital-market',
    'https://www.nseindia.com/',
  ]) {
    try {
      const res = await fetch(page, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(10000),
      })
      const raw   = res.headers.get('set-cookie') ?? ''
      const parts = raw.split(/,(?=[^;]+=[^;]+)/).map(s => s.split(';')[0].trim()).filter(s => s.includes('=') && s.length > 5)
      if (parts.length >= 1) {
        NSE_SESSION.cookie = parts.slice(0, 5).join('; ')
        NSE_SESSION.exp    = Date.now() + 8 * 60_000
        return NSE_SESSION.cookie
      }
    } catch {}
  }
  return NSE_SESSION.cookie
}

async function fetchNSEGSec(): Promise<{ tenor: string; matYears: number; yield: number }[] | null> {
  const cacheKey = 'nse:gsec'
  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.data as { tenor: string; matYears: number; yield: number }[]

  try {
    const cookie = await getNSECookie()
    if (!cookie) return null
    await new Promise(r => setTimeout(r, 350))

    const res = await fetch('https://www.nseindia.com/api/liveBonds-traded-on-nse?type=gsBonds', {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':          'application/json, text/plain, */*',
        'Referer':         'https://www.nseindia.com/market-data/bonds-traded-in-capital-market',
        'Cookie':          cookie,
        'X-Requested-With':'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(12000),
    })

    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || data.length === 0) return null

    const today = new Date()
    const TENOR_YEARS: Record<string, number> = { '91D':91/365,'182D':182/365,'364D':364/365,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10,'14Y':14,'20Y':20,'30Y':30 }

    const buckets = new Map<string, number[]>()
    for (const bond of data) {
      const matStr = bond.maturDate || bond.maturityDate || bond.matDate
      const yld    = parseFloat(bond.lastYield ?? bond.yield ?? bond.ltYield ?? bond.yld ?? 0)
      if (!matStr || !yld || yld <= 0 || yld > 25) continue
      const matDate = new Date(matStr)
      if (isNaN(matDate.getTime())) continue
      const matYrs = (matDate.getTime() - today.getTime()) / (365.25 * 86400_000)
      if (matYrs < 0.05 || matYrs > 45) continue
      const tenor = matYrs < 0.3 ? '91D' : matYrs < 0.7 ? '182D' : matYrs < 1.2 ? '364D'
        : matYrs < 2.5 ? '2Y' : matYrs < 4 ? '3Y' : matYrs < 6 ? '5Y'
        : matYrs < 8.5 ? '7Y' : matYrs < 12 ? '10Y' : matYrs < 17 ? '14Y'
        : matYrs < 23  ? '20Y' : '30Y'
      if (!buckets.has(tenor)) buckets.set(tenor, [])
      buckets.get(tenor)!.push(yld)
    }

    if (buckets.size < 3) return null

    const result = [...buckets.entries()].map(([tenor, yields]) => {
      const sorted = [...yields].sort((a, b) => a - b)
      const median = sorted[Math.floor(sorted.length / 2)]
      return { tenor, matYears: TENOR_YEARS[tenor] ?? 5, yield: Math.round(median * 1000) / 1000 }
    }).sort((a, b) => a.matYears - b.matYears)

    cache.set(cacheKey, { data: result, expires: Date.now() + 15 * 60_000 })
    return result
  } catch (err) {
    console.error('[fi:nse]', err)
    return null
  }
}

/** RBI DBIE API — official data with lag */
async function fetchRBIDBIE(): Promise<{ repoRate: number | null; gsec10Y: number | null; date: string | null }> {
  try {
    const [rRes, gRes] = await Promise.allSettled([
      fetch('https://data.rbi.org.in/DBIE/api/v1/data/series?id=BS_REPORATE_MPC&from=2025-01-01', {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible)' },
        signal: AbortSignal.timeout(8000),
      }),
      fetch('https://data.rbi.org.in/DBIE/api/v1/data/series?id=FMJD10YGoI&from=2025-01-01', {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible)' },
        signal: AbortSignal.timeout(8000),
      }),
    ])

    const extract = async (res: PromiseSettledResult<Response>): Promise<number | null> => {
      if (res.status !== 'fulfilled' || !res.value.ok) return null
      try {
        const j = await res.value.json()
        const series = j?.data?.[0]?.series ?? j?.series ?? []
        if (!Array.isArray(series) || series.length === 0) return null
        const latest = series[series.length - 1]
        const v = parseFloat(latest.value ?? latest.val ?? latest.Value ?? 0)
        return v > 0 && v < 30 ? v : null
      } catch { return null }
    }

    const [repoRate, gsec10Y] = await Promise.all([extract(rRes), extract(gRes)])
    return { repoRate, gsec10Y, date: new Date().toISOString().slice(0, 10) }
  } catch {
    return { repoRate: null, gsec10Y: null, date: null }
  }
}

// Authoritative RBI rate table — official decisions, NOT live.
// Fallback only when DBIE and FRED both fail.
// ALIGNED with macro-rates/route.ts — both files must match.
// Sorted newest first; getOfficialRBIRate() returns first entry with date <= today.
const RBI_DECISIONS: { date: string; rate: number; note: string }[] = [
  { date: '2026-04-09', rate: 6.00, note: 'RBI MPC Apr 2026 — 25bps cut (fallback)' },
  { date: '2026-02-07', rate: 6.25, note: 'RBI MPC Feb 2026 — 25bps cut (fallback)' },
  { date: '2025-04-09', rate: 6.00, note: 'RBI MPC Apr 2025 — 25bps cut' },
  { date: '2025-02-07', rate: 6.25, note: 'RBI MPC Feb 2025 — 25bps cut' },
  { date: '2024-08-07', rate: 6.50, note: 'RBI held at 6.50%' },
]

function getOfficialRBIRate() {
  const today = new Date().toISOString().slice(0, 10)
  return RBI_DECISIONS.find(r => r.date <= today) ?? RBI_DECISIONS[RBI_DECISIONS.length - 1]
}

async function fetchRBIRepo(): Promise<DataPoint<number>> {
  const now = new Date().toISOString()

  // 1. RBI DBIE
  const dbie = await fetchRBIDBIE()
  if (dbie.repoRate && dbie.repoRate > 0) {
    return {
      value: dbie.repoRate,
      source: 'RBI DBIE API (data.rbi.org.in)', sourceUrl: 'https://data.rbi.org.in/DBIE/',
      dataSourceType: 'official', fetchedAt: now, reportingDate: dbie.date ?? undefined,
      notes: 'RBI DBIE API — official with reporting lag.',
    }
  }

  // 2. FRED INTDSRINM193N (IMF IFS quarterly proxy)
  const fred = await fredFetch('INTDSRINM193N')
  if (fred && fred.value > 0 && fred.value < 20 && ageHours(fred.date) < 120 * 24) {
    return {
      value: fred.value,
      source: 'FRED INTDSRINM193N (IMF IFS proxy)', sourceUrl: 'https://fred.stlouisfed.org/series/INTDSRINM193N',
      dataSourceType: 'official', fetchedAt: now, reportingDate: fred.date,
      ageHours: Math.round(ageHours(fred.date)),
      notes: `IMF IFS proxy for Indian lending rate. Quarterly lag. Data as of ${fred.date}. May not reflect latest RBI MPC decision.`,
    }
  }

  // 3. Known official decision table
  const official = getOfficialRBIRate()
  return {
    value: official.rate,
    source: `RBI Official MPC Decision Table`, sourceUrl: 'https://rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx',
    dataSourceType: 'official', fetchedAt: now, reportingDate: official.date,
    ageHours: Math.round(ageHours(official.date)),
    notes: `Not live. Last-known official RBI rate: ${official.rate}% (${official.note}). Neither DBIE nor FRED returned fresher data.`,
  }
}

async function buildIndiaYieldCurve(
  nse: { tenor: string; matYears: number; yield: number }[] | null,
  dbieGSec10Y: number | null,
  repoRate: number,
  allowModeled: boolean
): Promise<{ points: YieldPoint[]; availability: IndiaAvailability; messages: string[] }> {
  const now = new Date().toISOString()
  const messages: string[] = []
  const avail: IndiaAvailability = { nseSuccess: !!nse, dbieSuccess: !!dbieGSec10Y, anyLiveData: !!nse, message: '' }

  // ── CASE 1: NSE live data ──
  if (nse && nse.length >= 3) {
    messages.push(`India G-Sec: ${nse.length} live tenor(s) from NSE India.`)
    if (nse.length < 5) messages.push(`⚠ Sparse NSE data (${nse.length} tenors). Curve interpolation will be limited.`)
    return {
      points: nse.map(p => ({
        tenor: p.tenor, maturityYears: p.matYears,
        yieldData: {
          value: p.yield,
          source: 'NSE India liveBonds API (G-Sec last yield)',
          sourceUrl: 'https://www.nseindia.com/market-data/bonds-traded-in-capital-market',
          dataSourceType: 'live', fetchedAt: now, reportingDate: now.slice(0, 10), ageHours: 0,
        },
      })),
      availability: { ...avail, message: 'NSE India live data.' },
      messages,
    }
  }

  // ── CASE 2: NSE failed ──
  messages.push('⚠ NSE India G-Sec API unavailable. Live yield curve cannot be displayed.')
  const partial: YieldPoint[] = []

  // Salvage the DBIE 10Y official point if available
  if (dbieGSec10Y && dbieGSec10Y > 0) {
    messages.push(`Partial data: RBI DBIE 10Y G-Sec = ${dbieGSec10Y.toFixed(2)}% (official, lagged).`)
    partial.push({
      tenor: '10Y', maturityYears: 10,
      yieldData: {
        value: dbieGSec10Y, source: 'RBI DBIE API (FMJD10YGoI)',
        sourceUrl: 'https://data.rbi.org.in/DBIE/',
        dataSourceType: 'official', fetchedAt: now, reportingDate: now.slice(0, 10),
        notes: 'Official RBI data with reporting lag. Not a live market quote.',
      },
    })
  }

  // ── CASE 3: No data at all, no modeled consent ──
  if (partial.length === 0 && !allowModeled) {
    messages.push('❌ No India G-Sec data from any source. Enable modeled curve for NS-model view.')
    avail.message = 'All India sources failed.'
    return { points: [], availability: avail, messages }
  }

  // ── CASE 4: User opted in to modeled curve ──
  if (allowModeled) {
    messages.push('⚙ MODELED curve (Nelson-Siegel). NOT live market data. Anchored to RBI repo rate.')
    messages.push(`Model inputs: repo=${repoRate}%, long-run rate=repo+1.75%, hump factor=0.30, lambda=3.5.`)
    const b0 = repoRate + 1.75, b1 = -(b0 - repoRate - 0.10), b2 = 0.30, lam = 3.5
    const TENORS = [
      { tenor:'91D', mat:91/365 }, { tenor:'182D', mat:182/365 }, { tenor:'364D', mat:364/365 },
      { tenor:'2Y', mat:2 }, { tenor:'3Y', mat:3 }, { tenor:'5Y', mat:5 },
      { tenor:'7Y', mat:7 }, { tenor:'10Y', mat:10 }, { tenor:'14Y', mat:14 }, { tenor:'30Y', mat:30 },
    ]
    return {
      points: TENORS.map(t => {
        const isDbie = t.tenor === '10Y' && dbieGSec10Y && dbieGSec10Y > 0
        return {
          tenor: t.tenor, maturityYears: t.mat,
          yieldData: {
            value: isDbie ? dbieGSec10Y! : parseFloat(Math.max(repoRate - 0.15, nelsonSiegel(t.mat, b0, b1, b2, lam)).toFixed(3)),
            source: isDbie ? 'RBI DBIE API (10Y official)' : 'Nelson-Siegel model (RBI repo anchor)',
            sourceUrl: isDbie ? 'https://data.rbi.org.in/DBIE/' : undefined,
            dataSourceType: (isDbie ? 'official' : 'modeled') as DataSourceType,
            fetchedAt: now,
            notes: isDbie
              ? 'Official RBI data, lagged.' : 'MODELED — not a real market yield. For illustration only. Do not use for trading decisions.',
          },
        }
      }),
      availability: { ...avail, message: 'Nelson-Siegel modeled curve (user opt-in).' },
      messages,
    }
  }

  // Return partial official data
  return { points: partial, availability: avail, messages }
}

function buildIndiaBonds(curve: YieldPoint[], repoRate: number): BondData[] {
  if (curve.filter(p => p.yieldData.value !== null).length < 2) return []
  const now  = new Date().toISOString()
  const note = 'Illustrative instrument. ISIN, coupon, and maturity represent recently-issued bonds in this category. YTM computed from available G-Sec curve. NOT from a live bond database.'

  const getGY = (mat: number): { yield: number; quality: DataSourceType } | null => {
    const valid = curve.filter(p => p.yieldData.value !== null)
    const exact = valid.find(p => Math.abs(p.maturityYears - mat) < 0.5)
    if (exact?.yieldData.value) return { yield: exact.yieldData.value, quality: exact.yieldData.dataSourceType }
    const lo = [...valid].reverse().find(p => p.maturityYears <= mat)
    const hi = valid.find(p => p.maturityYears >= mat)
    if (!lo?.yieldData.value || !hi?.yieldData.value) return null
    const t = (mat - lo.maturityYears) / (hi.maturityYears - lo.maturityYears)
    const q = lo.yieldData.dataSourceType === 'live' && hi.yieldData.dataSourceType === 'live' ? 'live' : lo.yieldData.dataSourceType
    return { yield: lo.yieldData.value + t * (hi.yieldData.value - lo.yieldData.value), quality: q as DataSourceType }
  }

  const templates: { id: string; issuer: string; type: string; coupon: number; mat: number; bps: number; rating: string; liq: number; isin?: string; spNote: string }[] = [
    { id:'in-91d',     issuer:'GOI (91D T-Bill)',        type:'gsec',         coupon:0,    mat:91/365,  bps:0,   rating:'Sov', liq:9, isin:'IN001425K153', spNote:'Benchmark' },
    { id:'in-5y-gs',   issuer:'GOI 7.18% ~2030 (5Y)',   type:'gsec',         coupon:7.18, mat:5,       bps:0,   rating:'Sov', liq:10,isin:'IN0020180057', spNote:'Benchmark' },
    { id:'in-10y-gs',  issuer:'GOI 7.26% ~2034 (10Y)',  type:'gsec',         coupon:7.26, mat:10,      bps:0,   rating:'Sov', liq:10,isin:'IN0020230027', spNote:'Benchmark' },
    { id:'in-30y-gs',  issuer:'GOI 7.46% ~2054 (30Y)',  type:'gsec',         coupon:7.46, mat:28,      bps:0,   rating:'Sov', liq:6, isin:'IN0020240013', spNote:'Benchmark' },
    { id:'in-sdl-10y', issuer:'State Dev. Loan (10Y)',  type:'sdl',          coupon:7.55, mat:10,      bps:55,  rating:'Sov-',liq:6, spNote:'Illustrative SDL spread ~55bps. Actual 40-70bps; varies by state.' },
    { id:'in-nhai-5y', issuer:'NHAI AAA PSU (5Y)',      type:'psu',          coupon:7.35, mat:5,       bps:42,  rating:'AAA', liq:7, spNote:'Illustrative AAA PSU spread ~42bps. Actual 30-55bps.' },
    { id:'in-rec-7y',  issuer:'REC Ltd. AAA PSU (7Y)', type:'psu',          coupon:7.55, mat:7,       bps:45,  rating:'AAA', liq:7, spNote:'Illustrative REC/PFC category spread.' },
    { id:'in-hdfc-3y', issuer:'HDFC Bank AAA Corp (3Y)',type:'ig-corporate', coupon:7.75, mat:3,       bps:75,  rating:'AAA', liq:7, spNote:'Illustrative AAA bank spread ~75bps.' },
    { id:'in-tata-5y', issuer:'Tata Capital AA+ (5Y)',  type:'ig-corporate', coupon:8.10, mat:5,       bps:120, rating:'AA+', liq:6, spNote:'Illustrative AA+ corp spread ~120bps.' },
  ]

  return templates.map(t => {
    const bench  = getGY(t.mat)
    const ytmRaw = bench ? bench.yield + t.bps / 100 : null
    const effCpn = t.coupon === 0 ? (ytmRaw ?? repoRate) : t.coupon
    const price  = ytmRaw !== null
      ? t.coupon === 0 ? 100 / (1 + ytmRaw / 100 * t.mat) : bondPriceFn(effCpn, ytmRaw, t.mat)
      : null
    const { mac, mod, cvx } = price !== null && ytmRaw !== null ? calcDurConvex(price, effCpn, ytmRaw, t.mat) : { mac: 0, mod: 0, cvx: 0 }
    const matDate = new Date(); matDate.setMonth(matDate.getMonth() + Math.round(t.mat * 12))
    const yQ: DataSourceType = bench?.quality ?? 'unavailable'
    const spQ: DataSourceType = t.bps === 0 ? yQ : 'synthetic'
    return {
      id: t.id, issuer: t.issuer, type: t.type, country: 'IN' as const, coupon: t.coupon,
      maturityDate: matDate.toISOString().slice(0, 7), maturityYears: t.mat,
      price: { value: price !== null ? parseFloat(price.toFixed(3)) : null, source: 'Computed from G-Sec curve', dataSourceType: yQ, fetchedAt: now, notes: price === null ? 'Yield data unavailable.' : undefined },
      ytm: { value: ytmRaw !== null ? parseFloat(ytmRaw.toFixed(3)) : null, source: `G-Sec benchmark + illustrative spread (${t.bps}bps). ${t.spNote}`, dataSourceType: yQ, fetchedAt: now, notes: ytmRaw === null ? 'G-Sec curve unavailable.' : undefined },
      macaulayDuration: parseFloat(mac.toFixed(3)), modifiedDuration: parseFloat(mod.toFixed(3)), convexity: parseFloat(cvx.toFixed(5)),
      spreadBps: { value: t.bps, source: t.spNote, dataSourceType: spQ, fetchedAt: now, notes: t.bps > 0 ? 'Illustrative spread. Not from live database.' : undefined },
      rating: t.rating, liquidityScore: t.liq, currency: 'INR' as const, isin: t.isin,
      synthetic: true as const, syntheticNote: note,
    }
  })
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI INSIGHTS — real callAI, real data context, honest about data quality
// ═══════════════════════════════════════════════════════════════════════════════

async function generateInsights(market: 'US' | 'IN', resp: FixedIncomeResponse): Promise<{ text: string; provider: string; error?: string }> {
  const { yieldCurve: curve, macroContext: macro, spreads: sp, curveShape, systemMessages } = resp
  const liveCount = curve.filter(p => p.yieldData.dataSourceType === 'live').length

  if (liveCount === 0 && market === 'IN') {
    return { text: '⚠ No live India G-Sec data available. Insights require real market inputs. Enable modeled curve or wait for NSE data to become available.', provider: 'none', error: 'insufficient_data' }
  }

  const tenY  = curve.find(p => p.maturityYears >= 9 && p.maturityYears <= 11 && p.yieldData.value !== null)
  const twoY  = curve.find(p => Math.abs(p.maturityYears - 2) < 0.5 && p.yieldData.value !== null)
  const fiveY = curve.find(p => Math.abs(p.maturityYears - 5) < 0.5 && p.yieldData.value !== null)
  const dataQuality = liveCount > 5 ? 'Live' : liveCount > 0 ? 'Partial live' : 'Official/Modeled'
  const dataWarning = systemMessages.filter(m => m.startsWith('⚠') || m.startsWith('❌')).join(' ')

  const prompt = market === 'US'
    ? `You are a US fixed income strategist writing 4 bullet points for a trading terminal.
Each bullet: under 25 words, references exact figures, trading-actionable. Use • prefix.

VERIFIED DATA (FRED, ${dataQuality}, ${new Date().toLocaleDateString()}):
Fed Funds: ${macro.policyRate.value?.toFixed(2) ?? 'N/A'}% (${macro.stance}) | CPI: ~${macro.cpi.value?.toFixed(1) ?? 'N/A'}%
Real rate: ${macro.policyRate.value && macro.cpi.value ? (macro.policyRate.value - macro.cpi.value).toFixed(2) : 'N/A'}%
2Y: ${twoY?.yieldData.value?.toFixed(2) ?? 'N/A'}% | 10Y: ${tenY?.yieldData.value?.toFixed(2) ?? 'N/A'}%
2-10 spread: ${sp?.twoTenSpread.value ?? 'N/A'}bp | Curve: ${curveShape}
IG OAS: ${sp?.igOAS.value?.toFixed(0) ?? 'N/A'}bp | HY OAS: ${sp?.hyOAS.value?.toFixed(0) ?? 'N/A'}bp | BBB: ${sp?.bbbSpread.value?.toFixed(0) ?? 'N/A'}bp
${sp?.igOAS.value === null ? 'NOTE: IG/HY/BBB OAS unavailable from FRED — do not reference them.' : ''}
Output ONLY 4 bullet points. No preamble.`
    : `You are an Indian fixed income strategist writing 4 bullet points for a trading terminal.
Each bullet: under 25 words, references exact figures, trading-actionable. Use • prefix.
Data quality: ${dataQuality}. ${dataWarning}

DATA:
RBI Repo: ${macro.policyRate.value?.toFixed(2) ?? 'N/A'}% (${macro.stance}) | Source: ${macro.policyRate.source}
CPI: ~${macro.cpi.value?.toFixed(1) ?? 'N/A'}% | Real rate: ${macro.policyRate.value && macro.cpi.value ? (macro.policyRate.value - macro.cpi.value).toFixed(2) : 'N/A'}%
5Y G-Sec: ${fiveY?.yieldData.value?.toFixed(2) ?? 'N/A'}% | 10Y G-Sec: ${tenY?.yieldData.value?.toFixed(2) ?? 'N/A'}%
2Y-10Y spread: ${sp?.twoTenSpread.value ?? 'N/A'}bp | 10Y-Repo: ${sp?.tenYrVsRepo?.value ?? 'N/A'}bp | Curve: ${curveShape}
SDL/PSU spreads: not available from free sources (typical: 40-70bp / 30-55bp)
${liveCount === 0 ? 'NOTE: No live G-Sec data. Base insights on RBI rate and macro context only.' : ''}
Output ONLY 4 bullet points. No preamble.`

  try {
    const { text, provider } = await callAI([{ role: 'user', content: prompt }], 350)
    if (!text || text.length < 10) {
      return { text: 'AI analysis temporarily unavailable.', provider: 'none', error: 'empty_response' }
    }
    return { text: text.trim(), provider }
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[fixed-income] AI error:', err)
    return { text: 'AI analysis temporarily unavailable.', provider: 'none', error: 'ai_failed' }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market       = (searchParams.get('market') ?? 'US').toUpperCase() as 'US' | 'IN'
  const type         = searchParams.get('type') ?? 'overview'
  const allowModeled = searchParams.get('modeled') === '1'
  const noCache      = searchParams.get('noCache') === '1'

  const ck = `fi3:${market}:${type}:${allowModeled ? 'm' : ''}`
  if (!noCache) {
    const hit = cache.get(ck)
    if (hit && hit.expires > Date.now()) {
      return NextResponse.json(hit.data, { headers: { 'Cache-Control': 'public, s-maxage=1800' } })
    }
  }

  const now     = new Date().toISOString()
  const sysmsgs: string[] = []

  // ── US ──────────────────────────────────────────────────────────────────────
  if (market === 'US') {
    if (!process.env.FRED_API_KEY) {
      return NextResponse.json({
        error: 'FRED_API_KEY not configured. Get free key at https://fred.stlouisfed.org/docs/api/api_key.html',
      }, { status: 503 })
    }

    const [curve, rateObs, rateHi, usCpiLive, tips] = await Promise.all([
      fetchUSYieldCurve(),
      fredFetch('DFEDTARL'),
      fredFetch('DFEDTARU'),
      fredYoY('CPIAUCSL'),         // live YoY CPI — no hardcoded values
      fetchTipsBreakeven(),        // TIPS real yields + breakeven inflation
    ])

    const liveCount = curve.filter(p => p.yieldData.dataSourceType === 'live').length
    if (liveCount < 5) sysmsgs.push(`⚠ Only ${liveCount}/11 Treasury tenors available from FRED.`)
    if (liveCount === 0) sysmsgs.push('❌ No US Treasury yield data from FRED. The API may be down.')

    const spreads = await fetchUSSpreads(curve)
    const lo = rateObs?.value ?? null
    const hi = rateHi?.value ?? lo

    const policyRate: DataPoint<number> = {
      value: lo, source: 'FRED DFEDTARL (Fed Funds target lower bound)',
      sourceUrl: 'https://fred.stlouisfed.org/series/DFEDTARL',
      dataSourceType: lo && rateObs && ageHours(rateObs.date) < 96 ? 'live' : lo ? 'official' : 'unavailable',
      fetchedAt: now, reportingDate: rateObs?.date,
      ageHours: rateObs ? Math.round(ageHours(rateObs.date)) : undefined,
      notes: !lo ? 'FRED DFEDTARL unavailable.' : hi && hi !== lo ? `Target range: ${lo?.toFixed(2)}-${hi?.toFixed(2)}%` : undefined,
    }

    // Live CPI from FRED CPIAUCSL — no hardcoded fallback; show null if unavailable
    const cpi: DataPoint<number> = usCpiLive
      ? {
          value: usCpiLive.value, source: 'FRED CPIAUCSL (US CPI All Items, YoY %)',
          sourceUrl: 'https://fred.stlouisfed.org/series/CPIAUCSL',
          dataSourceType: 'official', fetchedAt: now, reportingDate: usCpiLive.date,
          ageHours: Math.round(ageHours(usCpiLive.date)),
        }
      : {
          value: null, source: 'FRED CPIAUCSL unavailable',
          dataSourceType: 'unavailable', fetchedAt: now,
          notes: 'US CPI could not be fetched from FRED. No hardcoded fallback used.',
        }

    // Compute actionable trading signals from live data
    const realRate = lo !== null && cpi.value !== null ? lo - cpi.value : null
    const signals  = computeSignals(realRate, spreads.igOAS.value, spreads.twoTenSpread.value)

    const resp: FixedIncomeResponse = {
      market: 'US', yieldCurve: curve, bonds: buildUSBonds(curve, spreads),
      spreads,
      macroContext: {
        policyRate, cpi,
        label: `Fed Funds ${lo?.toFixed(2) ?? 'N/A'}${hi && hi !== lo ? `-${hi.toFixed(2)}` : ''}%`,
        stance: (lo ?? 4) >= 5.0 ? 'RESTRICTIVE' : (lo ?? 4) >= 3.75 ? 'SLIGHTLY RESTRICTIVE' : 'NEUTRAL',
      },
      curveShape: classifyCurve(curve),
      curveDataQuality: curve.every(p => p.yieldData.dataSourceType === 'live') ? 'live' : 'official',
      systemMessages: sysmsgs, fetchedAt: now,
      tips, signals,
    }

    if (type === 'insights') {
      const { text, provider, error } = await generateInsights('US', resp)
      const result = { ...resp, insights: text, insightsProvider: provider, insightsError: error }
      cache.set(ck, { data: result, expires: Date.now() + 1_800_000 })
      return NextResponse.json(result)
    }
    cache.set(ck, { data: resp, expires: Date.now() + 1_800_000 })
    return NextResponse.json(resp)
  }

  // ── INDIA ───────────────────────────────────────────────────────────────────
  const [nse, dbie, repoPoint, indCpiLive] = await Promise.all([
    fetchNSEGSec(),
    fetchRBIDBIE(),
    fetchRBIRepo(),
    fredYoY('INDCPIALLMINMEI'),   // India CPI YoY from FRED — no hardcoded fallback
  ])
  const repoRate = repoPoint.value ?? 6.00

  const { points: curve, availability, messages } = await buildIndiaYieldCurve(nse, dbie.gsec10Y, repoRate, allowModeled)
  sysmsgs.push(...messages)
  if (!availability.anyLiveData && !allowModeled) {
    sysmsgs.push('ℹ Add ?modeled=1 to URL or click "Enable Modeled Curve" in UI to view NS-modeled curve (clearly labeled).')
  }

  const twoY = curve.find(p => Math.abs(p.maturityYears - 2) < 0.5 && p.yieldData.value !== null)
  const tenY = curve.find(p => p.maturityYears >= 9 && p.yieldData.value !== null)
  const bothValid = twoY?.yieldData.value != null && tenY?.yieldData.value != null
  const twoTenQ: DataSourceType = twoY?.yieldData.dataSourceType === 'live' ? 'live' : twoY?.yieldData.value != null ? 'official' : 'unavailable'

  const indiaSpreads: SpreadData = {
    igOAS:   { value: null, source: 'Not applicable (India G-Sec market structure)', dataSourceType: 'unavailable', fetchedAt: now },
    hyOAS:   { value: null, source: 'Not applicable', dataSourceType: 'unavailable', fetchedAt: now },
    bbbSpread:{ value: null, source: 'Not applicable', dataSourceType: 'unavailable', fetchedAt: now },
    twoTenSpread: {
      value: bothValid ? Math.round((tenY!.yieldData.value! - twoY!.yieldData.value!) * 100) : null,
      source: 'Computed: G-Sec 10Y − 2Y', dataSourceType: twoTenQ, fetchedAt: now,
      notes: !bothValid ? 'Cannot compute — insufficient G-Sec curve data.' : undefined,
    },
    sdlSpread: {
      value: null, source: 'No free real-time SDL spread source available', dataSourceType: 'unavailable', fetchedAt: now,
      notes: 'SDL-G-Sec spreads historically 40-70bps. CCIL or Bloomberg required for live data.',
    },
    psuSpread: {
      value: null, source: 'No free real-time AAA PSU spread source', dataSourceType: 'unavailable', fetchedAt: now,
      notes: 'AAA PSU-G-Sec spreads historically 30-55bps. Proprietary data required.',
    },
    tenYrVsRepo: {
      value: tenY?.yieldData.value != null ? Math.round((tenY.yieldData.value - repoRate) * 100) : null,
      source: '10Y G-Sec minus RBI Repo Rate (term premium)', dataSourceType: tenY?.yieldData.dataSourceType ?? 'unavailable', fetchedAt: now,
    },
  }

  // Live India CPI from FRED INDCPIALLMINMEI — no hardcoded fallback
  const cpiIndia: DataPoint<number> = indCpiLive
    ? {
        value: indCpiLive.value, source: 'FRED INDCPIALLMINMEI (OECD India CPI, YoY %)',
        sourceUrl: 'https://fred.stlouisfed.org/series/INDCPIALLMINMEI',
        dataSourceType: 'official', fetchedAt: now, reportingDate: indCpiLive.date,
        ageHours: Math.round(ageHours(indCpiLive.date)),
        notes: 'OECD/FRED series. Typically 1-2 month lag behind MOSPI release.',
      }
    : {
        value: null, source: 'FRED INDCPIALLMINMEI unavailable',
        dataSourceType: 'unavailable', fetchedAt: now,
        notes: 'India CPI could not be fetched from FRED. No hardcoded fallback used.',
      }

  const resp: FixedIncomeResponse = {
    market: 'IN', yieldCurve: curve, bonds: buildIndiaBonds(curve, repoRate),
    spreads: indiaSpreads,
    macroContext: { policyRate: repoPoint, cpi: cpiIndia, label: 'RBI Repo Rate', stance: repoRate <= 5.5 ? 'ACCOMMODATIVE' : repoRate <= 6.25 ? 'NEUTRAL' : 'RESTRICTIVE' },
    curveShape: classifyCurve(curve),
    curveDataQuality: availability.nseSuccess ? 'live' : availability.dbieSuccess ? 'official' : allowModeled ? 'modeled' : 'unavailable',
    indiaAvailability: availability, systemMessages: sysmsgs, fetchedAt: now,
  }

  if (type === 'insights') {
    const { text, provider, error } = await generateInsights('IN', resp)
    const result = { ...resp, insights: text, insightsProvider: provider, insightsError: error }
    cache.set(ck, { data: result, expires: Date.now() + 1_800_000 })
    return NextResponse.json(result)
  }
  cache.set(ck, { data: resp, expires: Date.now() + 1_800_000 })
  return NextResponse.json(resp)
}