// src/app/api/options/route.ts
// US  → CBOE public CDN (cdn.cboe.com) — free, no auth, works from any server IP, 15-min delayed
// IN  → NSE India API with robust session management
// Math (BSM/Greeks/IV) done CLIENT-SIDE — zero Vercel CPU cost
import { NextRequest, NextResponse } from 'next/server'

const cache     = new Map<string, { data: unknown; exp: number }>()
const nseStore  = { cookie: '', exp: 0 }

// ── CBOE indices need underscore prefix ───────────────────────────────────────
const CBOE_INDEX = new Set(['SPX','NDX','VIX','RUT','XSP','MXEA','MXEF','DJX','OEX'])

function cboeSym(s: string) {
  const u = s.toUpperCase()
  return CBOE_INDEX.has(u) ? `_${u}` : u
}

// ── Fetch CBOE delayed options (public CDN, no IP blocks) ────────────────────
async function fetchCBOE(symbol: string, expiry?: string): Promise<any> {
  const sym = cboeSym(symbol)
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${sym}.json`

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': 'https://www.cboe.com/',
      'Origin': 'https://www.cboe.com',
    },
    signal: AbortSignal.timeout(15000),
    next: { revalidate: 0 },
  })

  if (!res.ok) throw new Error(`CBOE ${res.status} for ${sym}`)
  const raw = await res.json()
  return parseCBOE(raw, symbol, expiry)
}

function parseCBOE(raw: any, symbol: string, selectedExpiry?: string): any {
  const spot: number = raw?.data?.current_price ?? raw?.data?.close ?? 0
  const opts: any[]  = raw?.data?.options ?? []

  if (!opts.length) throw new Error(`CBOE returned empty options for ${symbol}`)

  // Collect expiry dates
  const expSet = new Set<string>()
  for (const o of opts) { if (o.expiration) expSet.add(String(o.expiration)) }
  const expiries = [...expSet].sort()
  const chosen   = (selectedExpiry && expiries.includes(selectedExpiry)) ? selectedExpiry : expiries[0] ?? ''

  // Build chain for chosen expiry
  const cMap = new Map<number, any>(), pMap = new Map<number, any>()
  for (const o of opts) {
    if (String(o.expiration) !== chosen) continue
    const k = Number(o.strike)
    if (o.type === 'C') cMap.set(k, o)
    else                pMap.set(k, o)
  }

  const strikes = new Set([...cMap.keys(), ...pMap.keys()])
  const chain   = [...strikes].sort((a, b) => a - b).map(K => {
    const c = cMap.get(K), p = pMap.get(K)
    return {
      strike: K,
      ce: c ? mapCBOESide(c) : null,
      pe: p ? mapCBOESide(p) : null,
    }
  }).filter(r => r.ce || r.pe)

  const callOI = chain.reduce((s, r) => s + (r.ce?.oi ?? 0), 0)
  const putOI  = chain.reduce((s, r) => s + (r.pe?.oi  ?? 0), 0)

  return {
    spot, expiries, selectedExpiry: chosen, chain, callOI, putOI,
    pcr:         callOI > 0 ? +(putOI / callOI).toFixed(3) : 0,
    lotSize:     100,
    riskFreeRate: 0.043,
    source:      'CBOE (15-min delayed)',
    hasGreeks:   true, // CBOE provides pre-computed Greeks
  }
}

function mapCBOESide(o: any) {
  return {
    ltp:    +(o.last_trade_price ?? 0),
    oi:     +(o.open_interest    ?? 0),
    oiChg:  +(o.oi_change       ?? 0),
    volume: +(o.volume           ?? 0),
    iv:     +(o.iv               ?? 0) * 100,  // CBOE returns decimal, convert to %
    bid:    +(o.bid              ?? 0),
    ask:    +(o.ask              ?? 0),
    delta:  +(o.delta            ?? 0),
    gamma:  +(o.gamma            ?? 0),
    theta:  +(o.theta            ?? 0),
    vega:   +(o.vega             ?? 0),
  }
}

// ── NSE India session management ──────────────────────────────────────────────
const NSE_HDRS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
  'Referer':         'https://www.nseindia.com/option-chain',
}

async function getNSECookie(): Promise<string> {
  if (nseStore.exp > Date.now()) return nseStore.cookie

  // Multi-attempt cookie acquisition
  const pages = [
    'https://www.nseindia.com/',
    'https://www.nseindia.com/option-chain',
    'https://www.nseindia.com/market-data/live-equity-market',
  ]

  for (const page of pages) {
    try {
      const r = await fetch(page, {
        headers: {
          ...NSE_HDRS,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        },
        redirect: 'follow',
        signal:   AbortSignal.timeout(10000),
      })

      const raw  = r.headers.get('set-cookie') ?? ''
      const cookies: string[] = []
      raw.split(/,(?=[^;]+=[^;]+)/).forEach(c => {
        const kv = c.trim().split(';')[0].trim()
        if (kv.includes('=') && !kv.startsWith('Path')) cookies.push(kv)
      })

      if (cookies.length >= 1) {
        nseStore.cookie = cookies.join('; ')
        nseStore.exp    = Date.now() + 7 * 60_000
        return nseStore.cookie
      }
    } catch {}
    await new Promise(r => setTimeout(r, 300))
  }

  return nseStore.cookie // may be stale
}

// NSE index → equity (for stocks with options)
const NSE_INDEX_SET = new Set(['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50','SENSEX','BANKEX'])

async function fetchNSE(symbol: string, expiry?: string): Promise<any> {
  const cookie = await getNSECookie()
  await new Promise(r => setTimeout(r, 400)) // avoid immediate bot detection

  const isIndex = NSE_INDEX_SET.has(symbol.toUpperCase())
  const apiSym  = symbol.toUpperCase()
  const endpoint = isIndex
    ? `https://www.nseindia.com/api/option-chain-indices?symbol=${apiSym}`
    : `https://www.nseindia.com/api/option-chain-equities?symbol=${apiSym}`

  const res = await fetch(endpoint, {
    headers: {
      ...NSE_HDRS,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(12000),
  })

  if (!res.ok) {
    nseStore.exp = 0 // invalidate stale cookie
    throw new Error(`NSE returned HTTP ${res.status} for ${symbol}`)
  }

  const json = await res.json()
  if (!json?.records?.data?.length) {
    throw new Error(`NSE: No option data for ${symbol}. Market may be closed (Mon–Fri 9:15am–3:30pm IST).`)
  }

  return parseNSE(json, symbol, expiry)
}

function parseNSE(json: any, symbol: string, selectedExpiry?: string): any {
  const records = json.records ?? {}
  const data: any[] = records.data ?? []
  const spot: number = records.underlyingValue ?? 0

  // Convert NSE date format "15-Apr-2025" → "2025-04-15"
  const nseToISO = (d: string) => {
    try {
      const [dd, mon, yyyy] = d.split('-')
      const m = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' }[mon] ?? '01'
      return `${yyyy}-${m}-${dd.padStart(2,'0')}`
    } catch { return d }
  }

  const expirySet = new Set<string>()
  data.forEach((r: any) => { if (r.expiryDate) expirySet.add(r.expiryDate) })
  const rawExpiries = [...expirySet].sort((a, b) =>
    new Date(nseToISO(a)).getTime() - new Date(nseToISO(b)).getTime()
  )
  const expiries     = rawExpiries.map(nseToISO)
  const nearRaw      = rawExpiries[0] ?? ''
  const chosen       = selectedExpiry ?? expiries[0] ?? ''
  const chosenRaw    = rawExpiries[expiries.indexOf(chosen)] ?? nearRaw

  const strikeMap = new Map<number, { ce: any; pe: any }>()
  data
    .filter((r: any) => r.expiryDate === chosenRaw)
    .forEach((r: any) => {
      const K = Number(r.strikePrice)
      if (!strikeMap.has(K)) strikeMap.set(K, { ce: null, pe: null })
      const row = strikeMap.get(K)!
      if (r.CE) row.ce = r.CE
      if (r.PE) row.pe = r.PE
    })

  const chain = [...strikeMap.entries()].sort(([a],[b]) => a-b).map(([strike, {ce, pe}]) => ({
    strike,
    ce: ce ? mapNSESide(ce) : null,
    pe: pe ? mapNSESide(pe) : null,
  })).filter(r => r.ce || r.pe)

  const callOI = chain.reduce((s, r) => s + (r.ce?.oi ?? 0), 0)
  const putOI  = chain.reduce((s, r) => s + (r.pe?.oi  ?? 0), 0)

  // NSE provides lot sizes via index
  const LOT: Record<string,number> = { NIFTY:25, BANKNIFTY:15, FINNIFTY:40, MIDCPNIFTY:50, NIFTYNXT50:10 }

  return {
    spot, expiries, selectedExpiry: chosen, chain, callOI, putOI,
    pcr:         callOI > 0 ? +(putOI / callOI).toFixed(3) : 0,
    lotSize:     LOT[symbol.toUpperCase()] ?? 1,
    riskFreeRate: 0.065,
    source:      'NSE India (real-time)',
    hasGreeks:   false, // NSE doesn't provide Greeks — computed client-side
  }
}

function mapNSESide(side: any) {
  return {
    ltp:    +(side.lastPrice             ?? 0),
    oi:     +(side.openInterest          ?? 0),
    oiChg:  +(side.changeinOpenInterest  ?? 0),
    volume: +(side.totalTradedVolume     ?? 0),
    iv:     +(side.impliedVolatility     ?? 0),
    bid:    +(side.bidprice ?? side.bidPrice ?? 0),
    ask:    +(side.askPrice ?? side.askprice ?? 0),
    delta: 0, gamma: 0, theta: 0, vega: 0,
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market = (searchParams.get('market') ?? 'US').toUpperCase() as 'US' | 'IN'
  const symbol = (searchParams.get('symbol') ?? (market === 'IN' ? 'NIFTY' : 'SPY')).toUpperCase()
  const expiry = searchParams.get('expiry') ?? undefined
  const ck     = `opts:${market}:${symbol}:${expiry ?? 'near'}`

  const cached = cache.get(ck)
  if (cached && cached.exp > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' }
    })
  }

  try {
    const payload = market === 'IN'
      ? await fetchNSE(symbol, expiry)
      : await fetchCBOE(symbol, expiry)

    const result = { ...payload, symbol, market, fetchedAt: new Date().toISOString() }
    cache.set(ck, { data: result, exp: Date.now() + 2 * 60_000 })
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300' }
    })
  } catch (err: any) {
    const msg = err?.message ?? 'Failed to fetch options'
    return NextResponse.json({
      error: msg, chain: [], expiries: [], spot: 0, pcr: 0,
      callOI: 0, putOI: 0, lotSize: 100, selectedExpiry: '',
      symbol, market, fetchedAt: new Date().toISOString(),
    }, { status: 200 })
  }
}