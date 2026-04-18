// src/app/api/options/route.ts
// US  → Yahoo Finance v7 with crumb/cookie auth (primary) → CBOE CDN (fallback)  
// IN  → NSE India real-time → stale cache with timestamp (when market closed)
// All Greeks computed CLIENT-SIDE — zero server CPU

import { NextRequest, NextResponse } from 'next/server'

const dev = process.env.NODE_ENV !== 'production'

// ── In-memory caches ───────────────────────────────────────────────────────────
const liveCache  = new Map<string, { data: unknown; exp: number; fetchedAt: number }>()
const staleStore = new Map<string, { data: unknown; fetchedAt: number }>()  // never expires

// ── Yahoo Finance crumb session (4h lifetime) ─────────────────────────────────
const yfSession = { crumb: '', cookie: '', exp: 0 }

const YF_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
}

function parseCookieHeader(header: string): string {
  const jar: Record<string, string> = {}
  header.split(/,(?=\s*[a-zA-Z0-9_-]+=)/).forEach(segment => {
    const kv = segment.trim().split(';')[0].trim()
    const idx = kv.indexOf('=')
    if (idx > 0) {
      const k = kv.slice(0, idx).trim()
      const v = kv.slice(idx + 1).trim()
      if (k && v && !['path','domain','expires','samesite','secure','httponly'].includes(k.toLowerCase())) {
        jar[k] = v
      }
    }
  })
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
}

async function getYFSession(): Promise<{ crumb: string; cookie: string } | null> {
  if (yfSession.exp > Date.now() && yfSession.crumb) {
    return { crumb: yfSession.crumb, cookie: yfSession.cookie }
  }

  dev && console.log('[options] Acquiring Yahoo Finance crumb...')

  // Step 1: Hit Yahoo Finance to get session cookies (GDPR consent cookies)
  const cookieJar: Record<string, string> = {}
  const cookiePages = [
    'https://fc.yahoo.com',
    'https://finance.yahoo.com/',
  ]

  for (const page of cookiePages) {
    try {
      const r = await fetch(page, {
        headers: { ...YF_HEADERS, Accept: 'text/html,application/xhtml+xml,*/*;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      })
      const raw = r.headers.get('set-cookie') ?? ''
      raw.split(/,(?=\s*[a-zA-Z0-9_-]+=)/).forEach(seg => {
        const kv = seg.trim().split(';')[0].trim()
        const idx = kv.indexOf('=')
        if (idx > 0) {
          const k = kv.slice(0, idx).trim()
          const v = kv.slice(idx + 1).trim()
          if (k && v && !['path','domain','expires','samesite','secure','httponly'].includes(k.toLowerCase())) {
            cookieJar[k] = v
          }
        }
      })
    } catch (e) {
      dev && console.warn(`[options] YF cookie page ${page} failed:`, e)
    }
  }

  const cookieStr = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ')
  dev && console.log(`[options] YF got ${Object.keys(cookieJar).length} cookies`)

  // Step 2: Exchange cookies for crumb
  const crumbUrls = [
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    'https://query2.finance.yahoo.com/v1/test/getcrumb',
  ]

  for (const url of crumbUrls) {
    try {
      const r = await fetch(url, {
        headers: {
          ...YF_HEADERS,
          'Referer': 'https://finance.yahoo.com/',
          ...(cookieStr ? { Cookie: cookieStr } : {}),
        },
        signal: AbortSignal.timeout(8000),
      })

      if (!r.ok) {
        dev && console.warn(`[options] YF crumb ${url}: HTTP ${r.status}`)
        continue
      }

      const crumb = (await r.text()).trim()
      if (!crumb || crumb.startsWith('<') || crumb.length < 3) {
        dev && console.warn(`[options] YF crumb invalid: "${crumb.slice(0, 30)}"`)
        continue
      }

      yfSession.crumb  = crumb
      yfSession.cookie = cookieStr
      yfSession.exp    = Date.now() + 3 * 3600_000  // 3 hours
      dev && console.log(`[options] YF crumb acquired: ${crumb.slice(0, 8)}...`)
      return { crumb, cookie: cookieStr }
    } catch (e) {
      dev && console.warn(`[options] YF crumb ${url} error:`, e)
    }
  }

  dev && console.warn('[options] YF crumb acquisition failed')
  return null
}

// ── Parse Yahoo Finance options response ───────────────────────────────────────
function mapYahooSide(opt: any) {
  return {
    ltp:    +(opt.lastPrice          ?? opt.ask ?? 0),
    oi:     +(opt.openInterest       ?? 0),
    oiChg:  0,
    volume: +(opt.volume             ?? 0),
    iv:     +(opt.impliedVolatility  ?? 0) * 100,   // Yahoo: decimal → %
    bid:    +(opt.bid                ?? 0),
    ask:    +(opt.ask                ?? 0),
    delta: 0, gamma: 0, theta: 0, vega: 0,          // computed client-side
  }
}

function parseYahooResult(result: any, symbol: string): any {
  const spot: number =
    result.quote?.regularMarketPrice ??
    result.quote?.regularMarketPreviousClose ??
    result.underlyingSymbol ? 0 : 0

  // Expiry dates from the result
  const expTimestamps: number[] = result.expirationDates ?? []
  const expiries = expTimestamps
    .map(ts => new Date(ts * 1000).toISOString().slice(0, 10))
    .filter(Boolean)
    .sort()

  // Option chain for selected expiry
  const optionData    = result.options?.[0]
  const calls: any[]  = optionData?.calls ?? []
  const puts:  any[]  = optionData?.puts  ?? []
  const expiryTs      = optionData?.expirationDate
  const selectedExpiry = expiryTs
    ? new Date(expiryTs * 1000).toISOString().slice(0, 10)
    : expiries[0] ?? ''

  dev && console.log(`[options] Yahoo parsed: spot=${spot}, expiries=${expiries.length}, calls=${calls.length}, puts=${puts.length}`)

  // Build strike map
  const strikeSet = new Set([
    ...calls.map((c: any) => +c.strike),
    ...puts.map( (p: any) => +p.strike),
  ])

  const chain = [...strikeSet]
    .filter(k => k > 0 && isFinite(k))
    .sort((a, b) => a - b)
    .map(K => {
      const ce = calls.find((c: any) => +c.strike === K)
      const pe = puts.find( (p: any) => +p.strike === K)
      return {
        strike: K,
        ce: ce ? mapYahooSide(ce) : null,
        pe: pe ? mapYahooSide(pe) : null,
      }
    })
    .filter(r => r.ce || r.pe)

  const callOI = chain.reduce((s, r) => s + (r.ce?.oi ?? 0), 0)
  const putOI  = chain.reduce((s, r) => s + (r.pe?.oi  ?? 0), 0)

  return {
    spot, expiries, selectedExpiry, chain, callOI, putOI,
    pcr:         callOI > 0 ? +(putOI / callOI).toFixed(3) : 0,
    lotSize:     100,
    riskFreeRate: 0.043,
    source:      'Yahoo Finance (15-min delayed)',
    hasGreeks:   false,
    chainCount:  chain.length,
  }
}

// ── Yahoo Finance options fetch ────────────────────────────────────────────────
async function fetchYahooOptions(symbol: string, selectedExpiry?: string): Promise<any> {
  const sym = symbol.toUpperCase()

  // Get crumb session
  const session = await getYFSession()

  // Build expiry timestamp param
  let expiryParam = ''
  if (selectedExpiry) {
    const ts = Math.floor(new Date(selectedExpiry + 'T00:00:00Z').getTime() / 1000)
    expiryParam = `&date=${ts}`
  }

  const crumbParam = session ? `&crumb=${encodeURIComponent(session.crumb)}` : ''

  // Try both Yahoo query servers
  const bases = ['https://query2.finance.yahoo.com', 'https://query1.finance.yahoo.com']

  for (const base of bases) {
    const url = `${base}/v7/finance/options/${encodeURIComponent(sym)}?formatted=false&lang=en-US&region=US${expiryParam}${crumbParam}`
    dev && console.log(`[options] Yahoo fetch: ${base}/v7/finance/options/${sym}${expiryParam ? ' (with expiry)' : ''}${session ? ' (with crumb)' : ' (no crumb)'}`)

    try {
      const headers: Record<string, string> = {
        ...YF_HEADERS,
        'Referer': `https://finance.yahoo.com/quote/${sym}/options`,
        'Origin':  'https://finance.yahoo.com',
      }
      if (session?.cookie) headers['Cookie'] = session.cookie

      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000),
        next: { revalidate: 0 },
      })

      if (!res.ok) {
        // If 401 with crumb, invalidate and try without
        if (res.status === 401 || res.status === 403) {
          dev && console.warn(`[options] Yahoo ${res.status} — crumb may be expired, invalidating`)
          yfSession.exp = 0
        }
        dev && console.error(`[options] Yahoo ${base}: HTTP ${res.status}`)
        continue
      }

      const json = await res.json()
      const result = json?.optionChain?.result?.[0]

      if (!result) {
        dev && console.warn(`[options] Yahoo ${base}: no result`)
        continue
      }

      const parsed = parseYahooResult(result, sym)

      // If we got spot but no chain, try fetching again with an explicit expiry
      if (parsed.spot > 0 && parsed.chain.length === 0 && parsed.expiries.length > 0 && !selectedExpiry) {
        dev && console.log(`[options] Yahoo: got spot + expiries but empty chain — refetching with explicit expiry ${parsed.expiries[0]}`)
        const ts = Math.floor(new Date(parsed.expiries[0] + 'T00:00:00Z').getTime() / 1000)
        const url2 = `${base}/v7/finance/options/${encodeURIComponent(sym)}?formatted=false&lang=en-US&region=US&date=${ts}${crumbParam}`
        try {
          const res2 = await fetch(url2, { headers, signal: AbortSignal.timeout(15000), next: { revalidate: 0 } })
          if (res2.ok) {
            const json2 = await res2.json()
            const result2 = json2?.optionChain?.result?.[0]
            if (result2) {
              const parsed2 = parseYahooResult(result2, sym)
              if (parsed2.chain.length > 0) {
                dev && console.log(`[options] Yahoo retry success: ${parsed2.chain.length} strikes`)
                return parsed2
              }
            }
          }
        } catch (e) {
          dev && console.warn('[options] Yahoo retry failed:', e)
        }
      }

      if (parsed.spot > 0) return parsed
    } catch (e: any) {
      dev && console.error(`[options] Yahoo ${base} error:`, e?.message ?? e)
    }
  }

  throw new Error(`Yahoo Finance options failed for ${sym}`)
}

// ── CBOE CDN fallback ─────────────────────────────────────────────────────────
function mapCBOESide(o: any) {
  return {
    ltp:    +(o.last_trade_price ?? o.ask ?? 0),
    oi:     +(o.open_interest    ?? 0),
    oiChg:  +(o.oi_change       ?? 0),
    volume: +(o.volume           ?? 0),
    iv:     +(o.iv               ?? 0) * 100,
    bid:    +(o.bid              ?? 0),
    ask:    +(o.ask              ?? 0),
    delta:  +(o.delta            ?? 0),
    gamma:  +(o.gamma            ?? 0),
    theta:  +(o.theta            ?? 0),
    vega:   +(o.vega             ?? 0),
  }
}

// CBOE OCC symbol parser: e.g. "SPY230616C00400000" → { type:'C', strike:400, expiry:'2023-06-16' }
function parseCBOEOCCSymbol(occ: string, underlyingLen: number) {
  try {
    const dateStr  = occ.slice(underlyingLen, underlyingLen + 6)
    const typeChar = occ[underlyingLen + 6]
    const strikeRaw = occ.slice(underlyingLen + 7)
    const strike   = parseInt(strikeRaw, 10) / 1000
    const y = '20' + dateStr.slice(0, 2)
    const m = dateStr.slice(2, 4)
    const d = dateStr.slice(4, 6)
    return { type: typeChar, strike, expiry: `${y}-${m}-${d}` }
  } catch { return null }
}

const CBOE_INDEX = new Set(['SPX','NDX','VIX','RUT','XSP','DJX','OEX','MXEA','MXEF'])

async function fetchCBOE(symbol: string, selectedExpiry?: string): Promise<any> {
  const sym = symbol.toUpperCase()
  const cboeSymbol = CBOE_INDEX.has(sym) ? `_${sym}` : sym
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${cboeSymbol}.json`
  dev && console.log(`[options] CBOE fetch: ${url}`)

  const res = await fetch(url, {
    headers: {
      ...YF_HEADERS,
      'Referer': 'https://www.cboe.com/',
      'Origin':  'https://www.cboe.com',
    },
    signal: AbortSignal.timeout(15000),
    next: { revalidate: 0 },
  })

  if (!res.ok) throw new Error(`CBOE HTTP ${res.status}`)

  const raw  = await res.json()
  dev && console.log(`[options] CBOE raw keys: ${Object.keys(raw?.data ?? {}).slice(0, 10).join(', ')}`)

  const spot: number = raw?.data?.current_price ?? raw?.data?.close ?? 0
  const opts: any[]  = raw?.data?.options ?? []

  dev && console.log(`[options] CBOE: spot=${spot}, total options=${opts.length}`)
  if (!opts.length) throw new Error(`CBOE returned 0 options for ${sym}`)

  // CBOE options have both { type, strike, expiration } directly AND OCC symbol
  // Determine expiry set from data
  const expSet = new Set<string>()
  const underlyingLen = sym.replace('_','').length

  const parsedOpts = opts.map((o: any) => {
    // Try direct fields first
    if (o.expiration && (o.type === 'C' || o.type === 'P') && o.strike !== undefined) {
      expSet.add(String(o.expiration))
      return {
        type:   o.type as 'C' | 'P',
        strike: +o.strike,
        expiry: String(o.expiration),
        data:   o,
      }
    }
    // Fall back to OCC symbol parsing
    if (o.option) {
      const parsed = parseCBOEOCCSymbol(o.option, underlyingLen)
      if (parsed) {
        expSet.add(parsed.expiry)
        return { ...parsed, data: o }
      }
    }
    return null
  }).filter(Boolean) as Array<{ type: 'C'|'P'; strike: number; expiry: string; data: any }>

  dev && console.log(`[options] CBOE parsed: ${parsedOpts.length} options, ${expSet.size} expiries`)

  const expiries  = [...expSet].sort()
  const chosen    = (selectedExpiry && expiries.includes(selectedExpiry)) ? selectedExpiry : expiries[0] ?? ''

  dev && console.log(`[options] CBOE: expiries=${expiries.slice(0, 5).join(', ')}... chosen=${chosen}`)

  const cMap = new Map<number, any>()
  const pMap = new Map<number, any>()

  for (const o of parsedOpts) {
    if (o.expiry !== chosen) continue
    if (o.type === 'C') cMap.set(o.strike, o.data)
    else                pMap.set(o.strike, o.data)
  }

  const strikes = new Set([...cMap.keys(), ...pMap.keys()])
  dev && console.log(`[options] CBOE chain strikes for ${chosen}: ${strikes.size}`)

  const chain = [...strikes]
    .filter(k => k > 0 && isFinite(k))
    .sort((a, b) => a - b)
    .map(K => ({
      strike: K,
      ce: cMap.has(K) ? mapCBOESide(cMap.get(K)) : null,
      pe: pMap.has(K) ? mapCBOESide(pMap.get(K)) : null,
    }))
    .filter(r => r.ce || r.pe)

  const callOI = chain.reduce((s, r) => s + (r.ce?.oi ?? 0), 0)
  const putOI  = chain.reduce((s, r) => s + (r.pe?.oi  ?? 0), 0)

  return {
    spot, expiries, selectedExpiry: chosen, chain, callOI, putOI,
    pcr:         callOI > 0 ? +(putOI / callOI).toFixed(3) : 0,
    lotSize:     100,
    riskFreeRate: 0.043,
    source:      'CBOE Delayed (15-min)',
    hasGreeks:   true,
    chainCount:  chain.length,
  }
}

// ── NSE India ─────────────────────────────────────────────────────────────────
const nseSession = { cookie: '', exp: 0 }

const NSE_HDRS: Record<string, string> = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer':         'https://www.nseindia.com/option-chain',
  'X-Requested-With': 'XMLHttpRequest',
}

async function warmNSESession(): Promise<string> {
  if (nseSession.exp > Date.now() && nseSession.cookie) return nseSession.cookie

  const cookieJar: Record<string, string> = {}
  const pages = [
    'https://www.nseindia.com/',
    'https://www.nseindia.com/market-data/live-equity-market',
    'https://www.nseindia.com/option-chain',
  ]

  for (const page of pages) {
    try {
      const r = await fetch(page, {
        headers: {
          ...NSE_HDRS,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      })
      const raw = r.headers.get('set-cookie') ?? ''
      raw.split(/,(?=\s*[a-zA-Z0-9_-]+=)/).forEach(seg => {
        const kv = seg.trim().split(';')[0].trim()
        const idx = kv.indexOf('=')
        if (idx > 0) {
          const k = kv.slice(0, idx).trim()
          const v = kv.slice(idx + 1).trim()
          if (k && v && !['path','domain','expires','samesite','secure','httponly'].includes(k.toLowerCase())) {
            cookieJar[k] = v
          }
        }
      })
      await new Promise(r => setTimeout(r, 500))
    } catch {}
  }

  nseSession.cookie = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ')
  nseSession.exp    = Date.now() + 7 * 60_000
  dev && console.log(`[options] NSE session warmed: ${Object.keys(cookieJar).length} cookies`)
  return nseSession.cookie
}

function nseToISO(d: string): string {
  try {
    const [dd, mon, yyyy] = d.split('-')
    const m: Record<string, string> = {
      Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
      Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'
    }
    return `${yyyy}-${m[mon] ?? '01'}-${dd.padStart(2, '0')}`
  } catch { return d }
}

const NSE_INDEX = new Set(['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50','SENSEX','BANKEX'])
const NSE_LOTS:  Record<string, number> = { NIFTY:25, BANKNIFTY:15, FINNIFTY:40, MIDCPNIFTY:50, NIFTYNXT50:10 }

function parseNSEResponse(json: any, symbol: string, selectedExpiry?: string): any {
  const records = json?.records ?? {}
  const data: any[] = records?.data ?? []
  const spot: number = records?.underlyingValue ?? 0

  const rawExpiries: string[] = records?.expiryDates ?? []
  const isoExpiries = rawExpiries
    .map(nseToISO)
    .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())

  const rawMap: Record<string, string> = {}
  rawExpiries.forEach(r => { rawMap[nseToISO(r)] = r })

  const chosen    = selectedExpiry && isoExpiries.includes(selectedExpiry) ? selectedExpiry : isoExpiries[0] ?? ''
  const chosenRaw = rawMap[chosen] ?? rawExpiries[0] ?? ''

  const strikeMap = new Map<number, { ce: any; pe: any }>()
  data
    .filter((r: any) => r.expiryDate === chosenRaw)
    .forEach((r: any) => {
      const K = +r.strikePrice
      if (!strikeMap.has(K)) strikeMap.set(K, { ce: null, pe: null })
      const row = strikeMap.get(K)!
      if (r.CE) row.ce = r.CE
      if (r.PE) row.pe = r.PE
    })

  const chain = [...strikeMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([strike, { ce, pe }]) => ({
      strike,
      ce: ce ? {
        ltp:    +(ce.lastPrice ?? 0),
        oi:     +(ce.openInterest ?? 0),
        oiChg:  +(ce.changeinOpenInterest ?? 0),
        volume: +(ce.totalTradedVolume ?? 0),
        iv:     +(ce.impliedVolatility ?? 0),
        bid:    +(ce.bidprice ?? ce.bidPrice ?? 0),
        ask:    +(ce.askPrice ?? ce.askprice ?? 0),
        delta: 0, gamma: 0, theta: 0, vega: 0,
      } : null,
      pe: pe ? {
        ltp:    +(pe.lastPrice ?? 0),
        oi:     +(pe.openInterest ?? 0),
        oiChg:  +(pe.changeinOpenInterest ?? 0),
        volume: +(pe.totalTradedVolume ?? 0),
        iv:     +(pe.impliedVolatility ?? 0),
        bid:    +(pe.bidprice ?? pe.bidPrice ?? 0),
        ask:    +(pe.askPrice ?? pe.askprice ?? 0),
        delta: 0, gamma: 0, theta: 0, vega: 0,
      } : null,
    }))
    .filter(r => r.ce || r.pe)

  const callOI = chain.reduce((s, r) => s + (r.ce?.oi ?? 0), 0)
  const putOI  = chain.reduce((s, r) => s + (r.pe?.oi  ?? 0), 0)

  return {
    spot, expiries: isoExpiries, selectedExpiry: chosen, chain, callOI, putOI,
    pcr:         callOI > 0 ? +(putOI / callOI).toFixed(3) : 0,
    lotSize:     NSE_LOTS[symbol.toUpperCase()] ?? 1,
    riskFreeRate: 0.065,
    source:      'NSE India (real-time)',
    hasGreeks:   false,
    chainCount:  chain.length,
  }
}

// ── Indian options: Yahoo .NS for stocks, NSE direct for indices ───────────────
async function fetchIndian(symbol: string, selectedExpiry?: string): Promise<any> {
  const sym = symbol.toUpperCase()
  if (!NSE_INDEX.has(sym)) {
    try {
      const yData = await fetchYahooOptions(`${sym}.NS`, selectedExpiry)
      if (yData.chain.length > 0 && yData.spot > 0) {
        return {
          ...yData,
          lotSize:      NSE_LOTS[sym] ?? 1,
          riskFreeRate: 0.065,
          source:       'NSE/Yahoo Finance (15-min delayed)',
        }
      }
    } catch (e: any) {
      dev && console.warn(`[options] Yahoo .NS failed for ${sym}, trying NSE direct:`, e?.message)
    }
  }
  return fetchNSE(sym, selectedExpiry)
}

async function fetchNSE(symbol: string, selectedExpiry?: string): Promise<any> {
  const sym      = symbol.toUpperCase()
  const isIndex  = NSE_INDEX.has(sym)
  const endpoint = isIndex
    ? `https://www.nseindia.com/api/option-chain-indices?symbol=${sym}`
    : `https://www.nseindia.com/api/option-chain-equities?symbol=${sym}`

  const cookie = await warmNSESession()
  await new Promise(r => setTimeout(r, 800))

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      dev && console.log(`[options] NSE attempt ${attempt}: ${sym}`)
      const res = await fetch(endpoint, {
        headers: { ...NSE_HDRS, ...(cookie ? { Cookie: cookie } : {}) },
        signal: AbortSignal.timeout(15000),
        next: { revalidate: 0 },
      })

      if (res.status === 401 || res.status === 403) {
        nseSession.exp = 0
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1500 * attempt))
          await warmNSESession()
          await new Promise(r => setTimeout(r, 1000))
        }
        continue
      }

      if (!res.ok) {
        dev && console.error(`[options] NSE HTTP ${res.status}`)
        continue
      }

      const json = await res.json()
      if (!json?.records?.data?.length) {
        const now = new Date()
        const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
        const h = ist.getHours(), m = ist.getMinutes(), day = ist.getDay()
        const isOpen = day >= 1 && day <= 5 && (h > 9 || (h === 9 && m >= 15)) && (h < 15 || (h === 15 && m <= 30))
        throw new Error(isOpen ? `NSE returned empty data for ${sym}` : `Market closed (IST ${ist.toLocaleTimeString()})`)
      }

      const parsed = parseNSEResponse(json, sym, selectedExpiry)
      dev && console.log(`[options] NSE success: ${sym}, spot=${parsed.spot}, chain=${parsed.chain.length}`)
      return parsed
    } catch (e: any) {
      dev && console.error(`[options] NSE attempt ${attempt} error:`, e?.message ?? e)
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * attempt))
      else throw e
    }
  }
  throw new Error(`NSE fetch failed for ${sym} after 3 attempts`)
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market = (searchParams.get('market') ?? 'US').toUpperCase() as 'US' | 'IN'
  const symbol = (searchParams.get('symbol') ?? (market === 'IN' ? 'NIFTY' : 'SPY')).toUpperCase()
  const expiry  = searchParams.get('expiry') ?? undefined

  const ck = `opts:${market}:${symbol}:${expiry ?? 'near'}`

  // Serve from live cache if fresh
  const cached = liveCache.get(ck)
  if (cached && cached.exp > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' }
    })
  }

  let payload: any = null

  try {
    if (market === 'IN') {
      try {
        payload = await fetchIndian(symbol, expiry)
      } catch (e: any) {
        // Serve stale data with age info
        const stale = staleStore.get(ck)
        if (stale) {
          const s = stale as any
          const ageMs = Date.now() - s._fetchedAt
          const ageMins = Math.round(ageMs / 60_000)
          const ageStr = ageMins < 60
            ? `${ageMins} min${ageMins !== 1 ? 's' : ''}`
            : `${Math.round(ageMins / 60)} hr${Math.round(ageMins / 60) !== 1 ? 's' : ''}`

          dev && console.log(`[options] NSE live failed, serving stale data (${ageStr} old)`)
          const staleResult = {
            ...s,
            symbol, market,
            staleData:    true,
            staleAgeStr:  ageStr,
            staleAgeMins: ageMins,
            source:       `${s.source} — data from ${ageStr} ago`,
            fetchedAt:    new Date().toISOString(),
          }
          return NextResponse.json(staleResult)
        }
        throw e
      }
    } else {
      // US: Yahoo Finance → CBOE fallback
      let yahooErr = ''
      try {
        payload = await fetchYahooOptions(symbol, expiry)
        // If Yahoo returned data but empty chain, try CBOE
        if (payload.chain.length === 0 && payload.spot > 0) {
          dev && console.warn(`[options] Yahoo returned empty chain for ${symbol}, trying CBOE`)
          try {
            const cboe = await fetchCBOE(symbol, expiry)
            if (cboe.chain.length > 0) {
              // Use CBOE chain but keep Yahoo spot if better
              payload = { ...cboe, spot: Math.max(payload.spot, cboe.spot) }
            }
          } catch (cboeE: any) {
            dev && console.warn('[options] CBOE also failed:', cboeE?.message)
          }
        }
      } catch (e: any) {
        yahooErr = e?.message ?? 'Yahoo failed'
        dev && console.warn(`[options] Yahoo primary failed: ${yahooErr}, trying CBOE`)
        try {
          payload = await fetchCBOE(symbol, expiry)
        } catch (cboeE: any) {
          // Last resort: stale cache
          const stale = staleStore.get(ck)
          if (stale) {
            const s = stale as any
            const ageMs = Date.now() - s._fetchedAt
            const ageMins = Math.round(ageMs / 60_000)
            const ageStr = ageMins < 60 ? `${ageMins}m` : `${Math.round(ageMins / 60)}h`
            return NextResponse.json({
              ...s, symbol, market, staleData: true, staleAgeStr: ageStr, staleAgeMins: ageMins,
              source: `${s.source} (cached ${ageStr} ago)`,
              fetchedAt: new Date().toISOString(),
            })
          }
          if (process.env.NODE_ENV !== 'production') {
            dev && console.error(`[options] Yahoo: ${yahooErr}. CBOE: ${cboeE?.message ?? 'failed'}`)
          }
          throw new Error('Options data unavailable from all sources')
        }
      }
    }

    const now = Date.now()
    const result = {
      ...payload,
      symbol, market,
      staleData:   false,
      fetchedAt:   new Date().toISOString(),
      _fetchedAt:  now,
    }

    // Cache it
    liveCache.set(ck, { data: result, exp: now + 2 * 60_000, fetchedAt: now })
    staleStore.set(ck, result)   // permanent stale store

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' }
    })

  } catch (err: unknown) {
    if (process.env.NODE_ENV !== 'production') {
      dev && console.error(`[options] Final error for ${market}:${symbol}:`, err)
    }

    return NextResponse.json({
      error: 'Options data unavailable',
      chain: [], expiries: [], spot: 0, pcr: 0,
      callOI: 0, putOI: 0, lotSize: 100, selectedExpiry: '',
      symbol, market, staleData: false,
      fetchedAt: new Date().toISOString(),
    }, { status: 200 })
  }
}