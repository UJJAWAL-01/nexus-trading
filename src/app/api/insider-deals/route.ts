// src/app/api/insider-deals/route.ts
// KEY FIX: Added cache-busting and proper market filtering
import { NextRequest, NextResponse } from 'next/server'

interface CacheEntry { data: InsiderResponse; expires: number }
const cache = new Map<string, CacheEntry>()
const nse = { cookie: '', exp: 0 }

export interface InsiderDeal {
  id: string; market: 'US' | 'IN'; type: 'insider' | 'bulk' | 'block'
  symbol: string; company: string; person: string; role: string; side: 'BUY' | 'SELL'
  shares: number | null; price: number | null; value: number | null; valueFmt: string
  currency: 'USD' | 'INR'; date: string; dateFmt: string; daysAgo: number
  significance: 'high' | 'medium' | 'low'; note: string; url: string
}

interface InsiderResponse {
  deals: InsiderDeal[]; stats: { total: number; buys: number; sells: number; high: number; us: number; india: number }
  fetchedAt: string; sources: string[]
}

function fmtValue(v: number | null, cur: 'USD' | 'INR'): string {
  if (!v) return '—'
  if (cur === 'INR') {
    if (v >= 1e7) return `₹${(v/1e7).toFixed(1)}Cr`
    if (v >= 1e5) return `₹${(v/1e5).toFixed(1)}L`
    return `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  }
  if (v >= 1e9) return `$${(v/1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtDate(d: string): string {
  try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function dAgo(d: string): number {
  try { return Math.max(0, Math.floor((Date.now() - new Date(d + 'T12:00:00Z').getTime()) / 86400000)) }
  catch { return 0 }
}

function sig(v: number | null, cur: 'USD' | 'INR'): 'high' | 'medium' | 'low' {
  if (!v) return 'low'
  const hi = cur === 'INR' ? 1e8 : 50e6
  const md = cur === 'INR' ? 1e7 : 5e6
  return v >= hi ? 'high' : v >= md ? 'medium' : 'low'
}

function today(): string { return new Date().toISOString().split('T')[0] }
function daysBack(n: number): string { return new Date(Date.now() - n * 86400000).toISOString().split('T')[0] }

let uidCtr = 0
function uid(pfx: string) { return `${pfx}-${++uidCtr}-${Date.now()}` }

const US_UNIVERSE = [
  'AAPL','MSFT','NVDA','AMZN','META','GOOGL','TSLA','JPM','BAC','WFC',
  'GS','MS','XOM','CVX','LLY','JNJ','PFE','PG','KO','WMT',
  'HD','AMD','INTC','NFLX','DIS','V','MA','UNH','COST','BRK-B',
]

async function fetchFinnhubInsiders(symbol?: string): Promise<{ deals: InsiderDeal[]; source: string }> {
  if (!process.env.FINNHUB_API_KEY) return { deals: [], source: '' }
  const syms = symbol ? [symbol.toUpperCase()] : US_UNIVERSE.slice(0, 15)
  const from = daysBack(60), to = today()
  const deals: InsiderDeal[] = []

  await Promise.all(syms.map(async sym => {
    try {
      const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${sym}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!r.ok) return
      const d = await r.json()
      for (const t of (d.data ?? [])) {
        if (!t.transactionDate || !t.transactionCode) continue
        const isBuy  = t.transactionCode === 'P'
        const isSell = t.transactionCode === 'S'
        if (!isBuy && !isSell) continue
        const shares = Math.abs(t.share ?? 0) || null
        const price  = t.transactionPrice > 0 ? t.transactionPrice : null
        const value  = shares && price ? shares * price : null
        deals.push({
          id: uid('us-fh'), market: 'US', type: 'insider',
          symbol: sym, company: t.name ?? sym, person: t.name ?? 'Unknown',
          role: t.officerTitle ?? 'Insider', side: isBuy ? 'BUY' : 'SELL',
          shares, price, value, valueFmt: fmtValue(value, 'USD'), currency: 'USD',
          date: t.transactionDate, dateFmt: fmtDate(t.transactionDate),
          daysAgo: dAgo(t.transactionDate), significance: sig(value, 'USD'),
          note: `${t.officerTitle ?? 'Insider'} ${isBuy ? 'purchased' : 'sold'} ${shares?.toLocaleString() ?? '?'} shares${price ? ` @ $${price.toFixed(2)}` : ''}`,
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sym}&type=4&count=5`,
        })
      }
    } catch {}
  }))
  return { deals, source: 'Finnhub (Form 4)' }
}

const NSE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/',
  'Origin': 'https://www.nseindia.com',
}

async function getNSECookie(): Promise<string> {
  if (nse.cookie && nse.exp > Date.now()) return nse.cookie
  try {
    const r = await fetch('https://www.nseindia.com/', { headers: NSE_HEADERS, signal: AbortSignal.timeout(10000) })
    const cookies = r.headers.get('set-cookie') ?? ''
    const parts = cookies.split(',').flatMap(c => c.split(';')).map(s => s.trim()).filter(s => /^(nsit|nseappid|ak_bmsc|bm_sv)=/.test(s))
    nse.cookie = parts.join('; ')
    nse.exp = Date.now() + 12 * 60_000
    return nse.cookie
  } catch { return '' }
}

function parseNSEDate(raw: string): string {
  if (!raw) return today()
  if (raw.includes('-') && raw.length === 10 && raw[4] === '-') return raw
  try { const d = new Date(raw); if (!isNaN(d.getTime())) return d.toISOString().split('T')[0] } catch {}
  return today()
}

function classifyClient(name: string): string {
  const n = name.toUpperCase()
  if (n.includes('FII') || n.includes('FPI') || n.includes('FOREIGN')) return 'FII/FPI'
  if (n.includes('MF') || n.includes('MUTUAL') || n.includes('FUND')) return 'Mutual Fund'
  if (n.includes('DII')) return 'DII'
  if (n.includes('INSURANCE') || n.includes('LIC')) return 'Insurance'
  if (n.includes('PROMOTER')) return 'Promoter'
  if (n.includes('PMS')) return 'PMS'
  return 'Institution'
}

async function fetchNSEDeals(type: 'bulk' | 'block'): Promise<{ deals: InsiderDeal[]; source: string }> {
  const deals: InsiderDeal[] = []
  try {
    const cookie = await getNSECookie()
    const endpoint = type === 'bulk'
      ? 'https://www.nseindia.com/api/bulk-block-short-selling-deals?type=bulk_deals'
      : 'https://www.nseindia.com/api/bulk-block-short-selling-deals?type=block_deals'
    const r = await fetch(endpoint, { headers: { ...NSE_HEADERS, 'Cookie': cookie }, signal: AbortSignal.timeout(12000) })
    if (!r.ok) throw new Error(`NSE ${r.status}`)
    const json = await r.json()
    const rows: any[] = Array.isArray(json) ? json : (json.data ?? [])
    for (const row of rows.slice(0, 80)) {
      const sym    = (row.symbol ?? row.Symbol ?? row.SYMBOL ?? '').toString().trim()
      const comp   = (row.name ?? row.Name ?? row.COMPANY_NAME ?? sym).toString().trim()
      const client = (row.clientName ?? row.CLIENT_NAME ?? row.clientname ?? 'Unknown').toString().trim()
      const rawBS  = (row.buyOrSell ?? row.BUY_SELL ?? row.BuySell ?? 'B').toString().toUpperCase()
      const side: 'BUY' | 'SELL' = rawBS.startsWith('B') ? 'BUY' : 'SELL'
      const shares = parseFloat(row.quantityTraded ?? row.QTY_TRADED ?? row.quantity ?? 0) || null
      const price  = parseFloat(row.tradePrice ?? row.TRADE_PRICE ?? row.price ?? 0) || null
      const value  = shares && price ? shares * price : null
      const date   = parseNSEDate((row.date ?? row.TRADE_DATE ?? row.tradeDate ?? today()).toString())
      if (!sym || !client || client === 'Unknown') continue
      deals.push({
        id: uid(`nse-${type}`), market: 'IN', type,
        symbol: sym, company: comp || sym, person: client,
        role: classifyClient(client), side, shares, price, value,
        valueFmt: fmtValue(value, 'INR'), currency: 'INR',
        date, dateFmt: fmtDate(date), daysAgo: dAgo(date),
        significance: sig(value, 'INR'),
        note: `${client} ${side === 'BUY' ? 'bought' : 'sold'} ${shares?.toLocaleString('en-IN') ?? '?'} shares${price ? ` @ ₹${price.toFixed(2)}` : ''}`,
        url: `https://www.nseindia.com/get-quotes/equity?symbol=${sym}`,
      })
    }
  } catch (e) { console.warn(`[NSE ${type}]`, e) }
  return { deals, source: `NSE ${type.charAt(0).toUpperCase() + type.slice(1)} Deals` }
}

async function fetchBSEDeals(): Promise<{ deals: InsiderDeal[]; source: string }> {
  const deals: InsiderDeal[] = []
  try {
    const dd = new Date()
    const d = `${String(dd.getDate()).padStart(2,'0')}${String(dd.getMonth()+1).padStart(2,'0')}${dd.getFullYear()}`
    const url = `https://api.bseindia.com/BseIndiaAPI/api/BulkBlockDeals/w?type=D&Fdate=${d}&Tdate=${d}`
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://www.bseindia.com/', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) throw new Error(`BSE ${r.status}`)
    const json = await r.json()
    const rows: any[] = json.Table ?? json.Table1 ?? []
    for (const row of rows.slice(0, 60)) {
      const sym    = (row.ScripCode ?? row.scripcode ?? '').toString().trim()
      const comp   = (row.ScripName ?? row.scripname ?? sym).toString().trim()
      const client = (row.ClientName ?? row.CLIENT_NAME ?? 'Unknown').toString().trim()
      const rawBS  = (row.BuyOrSell ?? row.BuySell ?? 'B').toString().toUpperCase()
      const side: 'BUY' | 'SELL' = rawBS.startsWith('B') ? 'BUY' : 'SELL'
      const shares = parseFloat(row.Quantity ?? row.QTY ?? 0) || null
      const price  = parseFloat(row.Price ?? row.PRICE ?? 0) || null
      const value  = shares && price ? shares * price : null
      if (!comp || comp === sym) continue
      deals.push({
        id: uid('bse-bulk'), market: 'IN', type: 'bulk',
        symbol: comp, company: comp, person: client,
        role: classifyClient(client), side, shares, price, value,
        valueFmt: fmtValue(value, 'INR'), currency: 'INR',
        date: today(), dateFmt: fmtDate(today()), daysAgo: 0,
        significance: sig(value, 'INR'),
        note: `${client} ${side === 'BUY' ? 'bought' : 'sold'} ${shares?.toLocaleString('en-IN') ?? '?'} shares${price ? ` @ ₹${price.toFixed(2)}` : ''}`,
        url: 'https://www.bseindia.com/markets/equity/EQReports/BulkDeals.aspx',
      })
    }
  } catch (e) { console.warn('[BSE bulk]', e) }
  return { deals, source: 'BSE Bulk Deals' }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market    = (searchParams.get('market') ?? 'ALL').toUpperCase()
  const symFilter = searchParams.get('symbol') ?? ''
  // Add cache-bust param to force refresh on tab switch
  const bust = searchParams.get('_t') ?? ''
  const cacheKey = `insider:${market}:${symFilter}`

  // If caller provides _t param, skip cache (tab switch forced refresh)
  const cached = bust ? null : cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.data)

  const allDeals: InsiderDeal[] = []
  const sources: string[] = []

  const tasks: Promise<{ deals: InsiderDeal[]; source: string }>[] = []

  if (market === 'ALL' || market === 'US') {
    tasks.push(fetchFinnhubInsiders(symFilter || undefined))
  }
  if (market === 'ALL' || market === 'IN') {
    tasks.push(fetchNSEDeals('bulk'))
    tasks.push(fetchNSEDeals('block'))
    tasks.push(fetchBSEDeals())
  }

  const results = await Promise.allSettled(tasks)
  for (const r of results) {
    if (r.status === 'fulfilled') {
      allDeals.push(...r.value.deals)
      if (r.value.source && r.value.deals.length) sources.push(r.value.source)
    }
  }

  // Deduplicate
  const seen = new Set<string>()
  const unique = allDeals.filter(d => {
    const k = `${d.market}-${d.symbol}-${d.side}-${d.date}-${d.person.slice(0,15)}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })

  // Sort by significance then date
  const sigScore = { high: 3, medium: 2, low: 1 }
  unique.sort((a, b) => {
    const ds = sigScore[b.significance] - sigScore[a.significance]
    return ds !== 0 ? ds : new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  const deals = unique.slice(0, 80)
  const stats = {
    total: deals.length,
    buys:  deals.filter(d => d.side === 'BUY').length,
    sells: deals.filter(d => d.side === 'SELL').length,
    high:  deals.filter(d => d.significance === 'high').length,
    us:    deals.filter(d => d.market === 'US').length,
    india: deals.filter(d => d.market === 'IN').length,
  }

  const response: InsiderResponse = { deals, stats, fetchedAt: new Date().toISOString(), sources }
  cache.set(cacheKey, { data: response, expires: Date.now() + 15*60_000 })
  return NextResponse.json(response)
}