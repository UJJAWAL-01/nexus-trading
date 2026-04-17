// src/app/api/insider-deals/route.ts
// US: Finnhub Form 4 — S&P 500 sector rotation + intelligence scoring
// IN: NSE archive CSV (no auth, 24/7) → NSE session API fallback → BSE additional
// Intelligence: deal significance, sector clustering, smart-money scoring,
//               multi-insider cluster detection
//
// Caching strategy (critical for Vercel/serverless cost):
//   1. Route-segment revalidate: Next.js caches the full JSON response per URL
//      for 900s. First user pays the full compute; next ~15 min = zero backend.
//   2. cachedFetch on every external call: puts each third-party response in
//      the Data Cache, so even on a cache-miss we only hit Finnhub/NSE/BSE
//      once across all users.
//   3. No module-level Map caches — those don't survive cold starts in prod.

import { NextRequest, NextResponse } from 'next/server'
import { cachedJSON, cachedFetch } from '@/lib/cache'

// Cache the full JSON response per URL for 15 min. Vercel serves this to all
// users from the edge — one compute per 15-min window regardless of traffic.
export const revalidate = 900

// ── Types ─────────────────────────────────────────────────────────────────────
export interface InsiderDeal {
  id: string; market: 'US' | 'IN'; type: 'insider' | 'bulk' | 'block'
  symbol: string; company: string; person: string; role: string; side: 'BUY' | 'SELL'
  shares: number | null; price: number | null; value: number | null; valueFmt: string
  currency: 'USD' | 'INR'; date: string; dateFmt: string; daysAgo: number
  significance: 'high' | 'medium' | 'low'; note: string; url: string
  smartMoneyScore: number
  sector:          string
  unusualFlag:     boolean
}

export interface SectorIntelligence {
  sector:     string
  netBuys:    number   // Stored separately per currency below; this is a display-ready composite
  netSells:   number
  biggestDeal: number
  signal:     'accumulation' | 'distribution' | 'neutral'
  currency:   'USD' | 'INR'  // all deals in a sector share the same currency (US vs IN split)
}

export interface ClusterSignal {
  symbol:      string
  market:      'US' | 'IN'
  company:     string
  side:        'BUY' | 'SELL'
  uniqueBuyers: number        // distinct people/entities
  totalValue:  number          // in the sector's currency
  currency:    'USD' | 'INR'
  deals:       InsiderDeal[]   // sorted by smartMoneyScore desc, max 5
  sector:      string
  avgScore:    number
}

export interface InsiderResponse {
  deals:        InsiderDeal[]
  sectorIntel:  SectorIntelligence[]
  clusters:     ClusterSignal[]   // 3+ distinct buyers on same symbol
  stats: {
    total: number; buys: number; sells: number
    high: number; us: number; india: number
    // Split by currency — USD and INR cannot be summed
    usdValueBought: number; usdValueSold: number
    inrValueBought: number; inrValueSold: number
  }
  fetchedAt:  string
  sources:    string[]
}

// ── Sector lookups ────────────────────────────────────────────────────────────
const SP500_BY_SECTOR: Record<string, string[]> = {
  'Technology':       ['AAPL','MSFT','NVDA','AVGO','ORCL','CRM','AMD','ADBE','QCOM','TXN','NOW','MU','PANW','AMAT','LRCX','KLAC','MRVL','CDNS','SNPS','FTNT','INTC','HPQ','HPE','GLW','KEYS','ANSS','TER','MPWR','ENPH','FSLR'],
  'Financials':       ['BRK-B','JPM','V','MA','BAC','GS','MS','WFC','SPGI','BLK','AXP','CB','PGR','USB','MMC','AON','TRV','AFL','MET','PRU','ICE','CME','SCHW','COF','DFS','SYF','MTB','RF','HBAN','KEY','CFG','FITB','PNC','TFC','WBS'],
  'Healthcare':       ['LLY','UNH','JNJ','ABBV','MRK','TMO','ABT','DHR','AMGN','BSX','SYK','MDT','ELV','CI','CVS','REGN','VRTX','ISRG','ZTS','BDX','IQV','A','DXCM','IDXX','MRNA','BIIB','GILD','ILMN','HUM','CNC'],
  'ConsumerDisc':     ['AMZN','TSLA','HD','MCD','NKE','LOW','SBUX','TJX','BKNG','MAR','GM','F','ROST','DRI','CMG','AZO','ORLY','EBAY','DHI','LEN','NVR','PHM','YUM','HLT','MGM','LVS','WYNN','RCL','CCL','H'],
  'Industrials':      ['GE','CAT','HON','UNP','RTX','BA','DE','MMM','ETN','EMR','ITW','LMT','NOC','GD','WM','RSG','CBRE','PWR','PCAR','FDX','UPS','DAL','LUV','UAL','CSX','NSC','CARR','OTIS','ROK','IR','TT','SWK','GWW'],
  'Energy':           ['XOM','CVX','COP','EOG','SLB','MPC','PSX','VLO','OXY','DVN','HES','CTRA','BKR','HAL','APA','MRO','FANG','PR','MTDR','SM','PBF','DINO','MUR','CHK','SWN','RRC','EQT','AR','CNX'],
  'Materials':        ['LIN','APD','SHW','ECL','NEM','FCX','NUE','VMC','MLM','PKG','IFF','CE','ALB','CF','MOS','FMC','RPM','EMN','WRK','SEE','IP','PPG','AVY','ESS','ACM','BALL'],
  'Utilities':        ['NEE','DUK','SO','D','AEP','EXC','SRE','XEL','ED','ETR','FE','EIX','PPL','PEG','WEC','DTE','CMS','LNT','EVRG','NI','AES','AWK','ES','PNW','OGE'],
  'CommServices':     ['META','GOOGL','NFLX','DIS','CMCSA','T','VZ','EA','TTWO','WBD','LYV','OMC','IPG','MTCH','PARA','FOX','NYT'],
  'ConsStaples':      ['PG','KO','PEP','WMT','PM','MO','COST','MDLZ','KHC','GIS','K','SJM','CAG','HRL','CPB','CL','CHD','CLX','EL','MNST','STZ','TAP','BF-B','SAM'],
  'RealEstate':       ['PLD','AMT','EQIX','CCI','PSA','O','WELL','DLR','AVB','EQR','ARE','VICI','VTR','BXP','KIM','REG','FRT','SPG','CSGP','INVH','EXR'],
}

const SYMBOL_SECTOR: Record<string, string> = {}
for (const [sector, syms] of Object.entries(SP500_BY_SECTOR)) {
  syms.forEach(s => { SYMBOL_SECTOR[s] = sector })
}

const INDIA_SECTOR: Record<string, string> = {
  'RELIANCE':'Energy','ONGC':'Energy','COALINDIA':'Energy','IOC':'Energy','BPCL':'Energy','GAIL':'Energy',
  'TCS':'Technology','INFY':'Technology','INFOSYS':'Technology','WIPRO':'Technology','HCLTECH':'Technology','TECHM':'Technology','LTIM':'Technology','PERSISTENT':'Technology','MPHASIS':'Technology',
  'HDFCBANK':'Financials','ICICIBANK':'Financials','SBIN':'Financials','KOTAKBANK':'Financials','AXISBANK':'Financials','BAJFINANCE':'Financials','BAJAJFINSV':'Financials','INDUSINDBK':'Financials','IDFCFIRSTB':'Financials','FEDERALBNK':'Financials','HDFC':'Financials','PNB':'Financials','BANKBARODA':'Financials',
  'HINDUNILVR':'ConsStaples','ITC':'ConsStaples','NESTLEIND':'ConsStaples','BRITANNIA':'ConsStaples','DABUR':'ConsStaples','MARICO':'ConsStaples','GODREJCP':'ConsStaples','TATACONSUM':'ConsStaples',
  'LT':'Industrials','SIEMENS':'Industrials','ABB':'Industrials','HAVELLS':'Industrials','BHEL':'Industrials','CUMMINSIND':'Industrials',
  'POWERGRID':'Utilities','NTPC':'Utilities','TATAPOWER':'Utilities','ADANIPOWER':'Utilities','TORNTPOWER':'Utilities',
  'TATAMOTORS':'ConsumerDisc','MARUTI':'ConsumerDisc','HEROMOTOCO':'ConsumerDisc','BAJAJ-AUTO':'ConsumerDisc','EICHERMOT':'ConsumerDisc','M&M':'ConsumerDisc','TITAN':'ConsumerDisc','ASIANPAINT':'ConsumerDisc','TRENT':'ConsumerDisc',
  'TATASTEEL':'Materials','HINDALCO':'Materials','JSWSTEEL':'Materials','VEDL':'Materials','JSPL':'Materials','SAIL':'Materials','NMDC':'Materials','ULTRACEMCO':'Materials','GRASIM':'Materials','SHREECEM':'Materials','AMBUJACEM':'Materials',
  'SUNPHARMA':'Healthcare','DRREDDY':'Healthcare','DIVISLAB':'Healthcare','CIPLA':'Healthcare','APOLLOHOSP':'Healthcare','LUPIN':'Healthcare','ZYDUSLIFE':'Healthcare','AUROPHARMA':'Healthcare','BIOCON':'Healthcare',
  'BHARTIARTL':'CommServices','IDEA':'CommServices','ZEEL':'CommServices','SUNTV':'CommServices',
  'ADANIENT':'Industrials','ADANIPORTS':'Industrials','ADANIGREEN':'Utilities','DMART':'ConsumerDisc','IRCTC':'ConsumerDisc','PIDILITIND':'Materials',
}

// ── Formatting / helpers ──────────────────────────────────────────────────────
function fmtValue(v: number | null, cur: 'USD' | 'INR'): string {
  if (!v) return '—'
  if (cur === 'INR') {
    if (v >= 1e7) return `₹${(v/1e7).toFixed(1)}Cr`
    if (v >= 1e5) return `₹${(v/1e5).toFixed(1)}L`
    return `₹${v.toLocaleString('en-IN',{maximumFractionDigits:0})}`
  }
  if (v >= 1e9) return `$${(v/1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`
  if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtDate(d: string): string {
  try { return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) }
  catch { return d }
}

function daysAgo(d: string): number {
  try { return Math.max(0, Math.floor((Date.now() - new Date(d + 'T12:00:00Z').getTime()) / 86400000)) }
  catch { return 0 }
}

function sigLevel(v: number | null, cur: 'USD' | 'INR'): 'high' | 'medium' | 'low' {
  if (!v) return 'low'
  // Normalized to roughly-equivalent USD terms (₹1Cr ≈ $120K is tiny; use
  // ₹50Cr / ₹5Cr as HIGH/MEDIUM thresholds so Indian "high" deals actually
  // mean something comparable to US "high")
  const hi = cur === 'INR' ? 50e7 : 50e6
  const md = cur === 'INR' ? 5e7  : 5e6
  return v >= hi ? 'high' : v >= md ? 'medium' : 'low'
}

function calcSmartMoneyScore(deal: {
  side: 'BUY'|'SELL'; value: number|null; role: string
  type: 'insider'|'bulk'|'block'; significance: 'high'|'medium'|'low'
}): number {
  let score = 0
  if (deal.side === 'BUY') score += 35
  const roleScore: Record<string, number> = {
    'CEO': 25, 'CFO': 22, 'COO': 20, 'Director': 15, 'Promoter': 25,
    'FII/FPI': 20, 'Mutual Fund': 18, 'DII': 18, 'Institution': 15,
    'Insider': 10, 'Form 4 Filer': 10, 'PMS': 12,
  }
  const r = deal.role.toUpperCase()
  for (const [key, pts] of Object.entries(roleScore)) {
    if (r.includes(key.toUpperCase())) { score += pts; break }
  }
  if (deal.significance === 'high')   score += 25
  if (deal.significance === 'medium') score += 12
  if (deal.type === 'block') score += 10
  if (deal.type === 'bulk')  score += 8
  return Math.min(100, score)
}

function today(): string { return new Date().toISOString().split('T')[0] }
function daysBack(n: number): string { return new Date(Date.now() - n * 86400000).toISOString().split('T')[0] }

// Deterministic, race-free IDs. crypto.randomUUID is available in Node 19+
// and in the Vercel Edge runtime.
function uid(pfx: string): string {
  // 12 chars is enough to be unique within one response
  return `${pfx}-${crypto.randomUUID().slice(0, 12)}`
}

// ── Intelligence builders ─────────────────────────────────────────────────────
function buildSectorIntel(deals: InsiderDeal[]): SectorIntelligence[] {
  // Keep USD and INR sectors separate — they cannot be summed
  const bucket = new Map<string, { buys: number; sells: number; maxVal: number; currency: 'USD'|'INR' }>()

  for (const d of deals) {
    const sector = d.sector || 'Other'
    // Bucket key includes currency so "Technology (USD)" ≠ "Technology (INR)"
    const key = `${sector}::${d.currency}`
    if (!bucket.has(key)) bucket.set(key, { buys: 0, sells: 0, maxVal: 0, currency: d.currency })
    const s = bucket.get(key)!
    const val = d.value ?? 0
    if (d.side === 'BUY') s.buys += val
    else                   s.sells += val
    if (val > s.maxVal) s.maxVal = val
  }

  return [...bucket.entries()]
    .map(([key, { buys, sells, maxVal, currency }]) => ({
      sector:      key.split('::')[0],
      netBuys:     buys,
      netSells:    sells,
      biggestDeal: maxVal,
      currency,
      signal: (buys > sells * 1.5 ? 'accumulation'
             : sells > buys * 1.5 ? 'distribution'
             : 'neutral') as 'accumulation'|'distribution'|'neutral',
    }))
    .sort((a, b) => (b.netBuys + b.netSells) - (a.netBuys + a.netSells))
    .slice(0, 10)
}

// Cluster detection — the Bloomberg-beater signal.
// When 3+ distinct people/entities buy (or sell) the same stock within the
// dataset, that's a stronger signal than any single high-value trade.
function buildClusters(deals: InsiderDeal[]): ClusterSignal[] {
  const groups = new Map<string, InsiderDeal[]>()
  for (const d of deals) {
    const key = `${d.market}::${d.symbol}::${d.side}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(d)
  }

  const clusters: ClusterSignal[] = []
  for (const [key, group] of groups) {
    // Distinct people — compare first 40 chars lowercased to avoid
    // "RAJESH KUMAR AGGARWAL" vs "Rajesh Kumar Aggarwal" being counted twice
    const distinct = new Set(group.map(d => d.person.toLowerCase().slice(0, 40).trim()))
    if (distinct.size < 3) continue

    const [, symbol, side] = key.split('::')
    const sample = group[0]
    const sortedByScore = [...group].sort((a, b) => b.smartMoneyScore - a.smartMoneyScore)

    clusters.push({
      symbol,
      market:       sample.market,
      company:      sample.company,
      side:         side as 'BUY'|'SELL',
      uniqueBuyers: distinct.size,
      totalValue:   group.reduce((s, d) => s + (d.value ?? 0), 0),
      currency:     sample.currency,
      deals:        sortedByScore.slice(0, 5),
      sector:       sample.sector,
      avgScore:     Math.round(group.reduce((s, d) => s + d.smartMoneyScore, 0) / group.length),
    })
  }

  // Buys ranked ahead of sells (more informative), then by unique count, then value
  return clusters
    .sort((a, b) => {
      if (a.side !== b.side) return a.side === 'BUY' ? -1 : 1
      if (b.uniqueBuyers !== a.uniqueBuyers) return b.uniqueBuyers - a.uniqueBuyers
      return b.totalValue - a.totalValue
    })
    .slice(0, 8)
}

// ── US: Finnhub Form 4 ────────────────────────────────────────────────────────
// Each per-symbol fetch goes through cachedFetch, so individual symbol
// responses live in the Data Cache for 15 min. This means:
//   - First cold request fetches N symbols from Finnhub (respecting rate limits)
//   - All subsequent requests within 15 min read from the Data Cache — 0 Finnhub calls
//   - Finnhub free tier 60 req/min is never at risk once warm
async function fetchFinnhubInsiders(symbol?: string): Promise<{ deals: InsiderDeal[]; source: string }> {
  if (!process.env.FINNHUB_API_KEY) return { deals: [], source: '' }
  const from = daysBack(60), to = today()

  let symsToFetch: string[]
  if (symbol) {
    symsToFetch = [symbol.toUpperCase()]
  } else {
    // Top 3 per sector = ~33 symbols. Paired with per-symbol Data Cache this
    // is usually zero-cost after the first warm request. Cold start stays
    // under the 10s Vercel serverless timeout.
    symsToFetch = Object.values(SP500_BY_SECTOR)
      .flatMap(arr => arr.slice(0, 3))
      .filter((s, i, a) => a.indexOf(s) === i)
  }

  const deals: InsiderDeal[] = []

  // Serial-with-batch: 4 parallel requests per tick, ~300ms between ticks.
  // Under Finnhub's free tier (60/min) because in steady state all these are
  // cache hits. Even cold it's only triggered once per 15-min window thanks
  // to the route-segment revalidate above.
  const BATCH = 4
  for (let i = 0; i < symsToFetch.length; i += BATCH) {
    const batch = symsToFetch.slice(i, i + BATCH)
    await Promise.all(batch.map(async sym => {
      const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${sym}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`
      const d = await cachedJSON<{ data?: any[] }>(url, { revalidate: 900, timeoutMs: 7000, tags: ['insider-us'] })
      if (!d?.data) return

      for (const t of d.data) {
        if (!t.transactionDate || !t.transactionCode) continue
        const isBuy  = t.transactionCode === 'P'
        const isSell = t.transactionCode === 'S'
        if (!isBuy && !isSell) continue

        const shares = Math.abs(t.share ?? 0) || null
        const price  = t.transactionPrice > 0 ? t.transactionPrice : null
        const value  = shares && price ? shares * price : null
        const sig    = sigLevel(value, 'USD')
        const role   = t.officerTitle ?? 'Insider'
        const side: 'BUY'|'SELL' = isBuy ? 'BUY' : 'SELL'
        const smScore = calcSmartMoneyScore({ side, value, role, type: 'insider', significance: sig })
        const filer   = t.name ?? 'Unknown'

        deals.push({
          id: uid('us-fh'), market: 'US', type: 'insider',
          symbol: sym, company: sym, person: filer, role, side, shares, price, value,
          valueFmt: fmtValue(value, 'USD'), currency: 'USD',
          date: t.transactionDate, dateFmt: fmtDate(t.transactionDate),
          daysAgo: daysAgo(t.transactionDate),
          significance: sig, smartMoneyScore: smScore,
          sector: SYMBOL_SECTOR[sym] ?? 'Other',
          unusualFlag: smScore >= 70 && sig === 'high',
          note: `${role} ${isBuy?'purchased':'sold'} ${shares?.toLocaleString()??'?'} shares${price?` @ $${price.toFixed(2)}`:''}`,
          url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sym}&type=4&count=5`,
        })
      }
    }))
    if (i + BATCH < symsToFetch.length) await new Promise(r => setTimeout(r, 300))
  }

  return { deals, source: 'Finnhub (Form 4 — S&P 500)' }
}

// ── India: NSE archive CSV (primary) ──────────────────────────────────────────
function parseDateToISO(raw: string): string {
  try {
    const [dd, mon, yyyy] = raw.split('-')
    const m: Record<string, string> = {
      Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
      Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'
    }
    return `${yyyy}-${m[mon]??'01'}-${dd.padStart(2,'0')}`
  } catch { return raw }
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (const char of line) {
    if (char === '"') inQuotes = !inQuotes
    else if (char === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else current += char
  }
  result.push(current.trim())
  return result
}

function classifyClient(name: string): string {
  const n = name.toUpperCase()
  if (n.includes('FII') || n.includes('FPI') || n.includes('FOREIGN')) return 'FII/FPI'
  if (n.includes('MF') || n.includes('MUTUAL') || n.includes('FUND')) return 'Mutual Fund'
  if (n.includes('INSURANCE') || n.includes('LIC')) return 'Insurance'
  if (n.includes('DII')) return 'DII'
  if (n.includes('PROMOTER')) return 'Promoter'
  if (n.includes('PMS')) return 'PMS'
  return 'Institution'
}

async function fetchNSEArchiveCSV(type: 'bulk' | 'block'): Promise<{ deals: InsiderDeal[]; source: string }> {
  const deals: InsiderDeal[] = []
  const source = `NSE ${type.charAt(0).toUpperCase() + type.slice(1)} Deals (Archive)`

  // bulk.csv / block.csv are "today's file". If that's empty (weekend / holiday),
  // try the 3 prior dated files — NSE keeps them at predictable URLs.
  const dates = [0, 1, 2, 3].map(d => {
    const dt = new Date(Date.now() - d * 86400000)
    const dd = String(dt.getDate()).padStart(2, '0')
    const mm = String(dt.getMonth() + 1).padStart(2, '0')
    return `${dd}${mm}${dt.getFullYear()}`
  })

  const archiveUrls = type === 'bulk'
    ? [
        `https://archives.nseindia.com/content/equities/bulk.csv`,
        ...dates.map(d => `https://archives.nseindia.com/content/equities/bulk_deals_${d}.csv`),
      ]
    : [
        `https://archives.nseindia.com/content/equities/block.csv`,
        ...dates.map(d => `https://archives.nseindia.com/content/equities/block_deals_${d}.csv`),
      ]

  for (const url of archiveUrls) {
    try {
      // Go through cachedFetch so all users share one NSE hit per 15 min
      const res = await cachedFetch(url, {
        revalidate: 900,
        tags: ['insider-in'],
        signal: AbortSignal.timeout(8000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/csv,text/plain,*/*',
          'Referer': 'https://www.nseindia.com/',
        },
      })
      if (!res.ok) continue
      const text = await res.text()
      if (!text || text.length < 50) continue

      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length < 2) continue

      for (let i = 1; i < Math.min(lines.length, 200); i++) {
        const cols = parseCSVLine(lines[i])
        if (cols.length < 5) continue

        const [rawDate, sym, secName, clientName, rawBS, rawQty, rawPrice] = cols
        if (!sym || !clientName) continue

        const symbol  = sym.trim().toUpperCase()
        const client  = clientName.trim()
        const company = (secName || symbol).trim()
        const side: 'BUY'|'SELL' = rawBS?.trim().toUpperCase().startsWith('B') ? 'BUY' : 'SELL'
        const shares  = parseFloat(rawQty?.replace(/,/g, '') ?? '0') || null
        const price   = parseFloat(rawPrice?.replace(/,/g, '') ?? '0') || null
        const value   = shares && price ? shares * price : null
        const dateISO = rawDate ? parseDateToISO(rawDate.trim()) : today()
        const sig     = sigLevel(value, 'INR')
        const role    = classifyClient(client)
        const smScore = calcSmartMoneyScore({ side, value, role, type, significance: sig })

        deals.push({
          id: uid(`nse-${type}`), market: 'IN', type,
          symbol, company, person: client, role, side, shares, price, value,
          valueFmt: fmtValue(value, 'INR'), currency: 'INR',
          date: dateISO, dateFmt: fmtDate(dateISO), daysAgo: daysAgo(dateISO),
          significance: sig, smartMoneyScore: smScore,
          sector: INDIA_SECTOR[symbol] ?? 'Other',
          unusualFlag: smScore >= 60 && sig !== 'low',
          note: `${client} ${side === 'BUY' ? 'bought' : 'sold'} ${shares?.toLocaleString('en-IN')??'?'} shares${price ? ` @ ₹${price.toFixed(2)}` : ''}`,
          url: `https://www.nseindia.com/get-quotes/equity?symbol=${symbol}`,
        })
      }

      if (deals.length > 0) return { deals, source }
    } catch { /* try next archive URL */ }
  }

  return { deals, source }
}

// ── India: NSE session API (fallback only) ────────────────────────────────────
const NSE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/',
  'Origin': 'https://www.nseindia.com',
}

async function fetchNSESessionDeals(type: 'bulk' | 'block'): Promise<{ deals: InsiderDeal[]; source: string }> {
  const deals: InsiderDeal[] = []
  try {
    // Cookie bootstrap — also cached so we don't bounce off NSE on every cold start
    const cookieRes = await cachedFetch('https://www.nseindia.com/', {
      revalidate: 600, tags: ['insider-in'],
      headers: NSE_HEADERS, signal: AbortSignal.timeout(7000),
    })
    const rawCookies = cookieRes.headers.get('set-cookie') ?? ''
    const cookie = rawCookies.split(',').flatMap(c => c.split(';')).map(s => s.trim())
      .filter(s => /^(nsit|nseappid|ak_bmsc|bm_sv)=/.test(s))
      .join('; ')

    const endpoint = type === 'bulk'
      ? 'https://www.nseindia.com/api/bulk-block-short-selling-deals?type=bulk_deals'
      : 'https://www.nseindia.com/api/bulk-block-short-selling-deals?type=block_deals'

    const r = await cachedFetch(endpoint, {
      revalidate: 900, tags: ['insider-in'],
      headers: { ...NSE_HEADERS, 'Cookie': cookie },
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return { deals, source: '' }

    const json: any = await r.json()
    const rows: any[] = Array.isArray(json) ? json : (json.data ?? [])
    for (const row of rows.slice(0, 100)) {
      const sym    = (row.symbol ?? row.Symbol ?? row.SYMBOL ?? '').toString().trim()
      const comp   = (row.name ?? row.Name ?? row.COMPANY_NAME ?? sym).toString().trim()
      const client = (row.clientName ?? row.CLIENT_NAME ?? row.clientname ?? '').toString().trim()
      if (!sym || !client) continue

      const rawBS  = (row.buyOrSell ?? row.BUY_SELL ?? row.BuySell ?? 'B').toString().toUpperCase()
      const side: 'BUY'|'SELL' = rawBS.startsWith('B') ? 'BUY' : 'SELL'
      const shares = parseFloat(row.quantityTraded ?? row.QTY_TRADED ?? row.quantity ?? 0) || null
      const price  = parseFloat(row.tradePrice ?? row.TRADE_PRICE ?? row.price ?? 0) || null
      const value  = shares && price ? shares * price : null
      const dateRaw = (row.date ?? row.TRADE_DATE ?? row.tradeDate ?? today()).toString()
      const dateISO = parseDateToISO(dateRaw) || today()
      const sig     = sigLevel(value, 'INR')
      const role    = classifyClient(client)
      const smScore = calcSmartMoneyScore({ side, value, role, type, significance: sig })

      deals.push({
        id: uid(`nse-api-${type}`), market:'IN', type,
        symbol: sym.toUpperCase(), company: comp || sym, person: client, role, side, shares, price, value,
        valueFmt: fmtValue(value, 'INR'), currency: 'INR',
        date: dateISO, dateFmt: fmtDate(dateISO), daysAgo: daysAgo(dateISO),
        significance: sig, smartMoneyScore: smScore,
        sector: INDIA_SECTOR[sym.toUpperCase()] ?? 'Other',
        unusualFlag: smScore >= 60 && sig !== 'low',
        note: `${client} ${side === 'BUY' ? 'bought' : 'sold'} ${shares?.toLocaleString('en-IN')??'?'} shares${price ? ` @ ₹${price.toFixed(2)}` : ''}`,
        url: `https://www.nseindia.com/get-quotes/equity?symbol=${sym}`,
      })
    }
  } catch { /* silent */ }
  return { deals, source: `NSE ${type.charAt(0).toUpperCase()+type.slice(1)} Deals (Session API)` }
}

// ── India: BSE additional ─────────────────────────────────────────────────────
async function fetchBSEDeals(): Promise<{ deals: InsiderDeal[]; source: string }> {
  const deals: InsiderDeal[] = []
  try {
    const dd = new Date()
    const d  = `${String(dd.getDate()).padStart(2,'0')}${String(dd.getMonth()+1).padStart(2,'0')}${dd.getFullYear()}`
    const url = `https://api.bseindia.com/BseIndiaAPI/api/BulkBlockDeals/w?type=D&Fdate=${d}&Tdate=${d}`
    const json = await cachedJSON<{ Table?: any[]; Table1?: any[] }>(url, {
      revalidate: 900, tags: ['insider-in'], timeoutMs: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.bseindia.com/',
        'Accept': 'application/json',
      },
    })
    if (!json) return { deals, source: '' }

    const rows = json.Table ?? json.Table1 ?? []
    for (const row of rows.slice(0, 60)) {
      // BSE uses ScripName (text) for the symbol — ScripCode is numeric
      const scripName = (row.ScripName ?? row.scripname ?? '').toString().trim()
      const comp      = scripName
      const symbol    = scripName.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || scripName
      const client = (row.ClientName ?? row.CLIENT_NAME ?? '').toString().trim()
      if (!scripName || !client) continue

      const rawBS  = (row.BuyOrSell ?? row.BuySell ?? row.DealType ?? 'B').toString().toUpperCase()
      const side: 'BUY'|'SELL' = rawBS.startsWith('B') ? 'BUY' : 'SELL'
      const shares = parseFloat(row.Quantity ?? row.QTY ?? 0) || null
      const price  = parseFloat(row.Price ?? row.PRICE ?? row.DealPrice ?? 0) || null
      const value  = shares && price ? shares * price : null
      const sig    = sigLevel(value, 'INR')
      const role   = classifyClient(client)
      const smScore = calcSmartMoneyScore({ side, value, role, type: 'bulk', significance: sig })

      deals.push({
        id: uid('bse-bulk'), market: 'IN', type: 'bulk',
        symbol, company: comp, person: client, role, side, shares, price, value,
        valueFmt: fmtValue(value, 'INR'), currency: 'INR',
        date: today(), dateFmt: fmtDate(today()), daysAgo: 0,
        significance: sig, smartMoneyScore: smScore,
        sector: INDIA_SECTOR[symbol] ?? 'Other',
        unusualFlag: smScore >= 60 && sig !== 'low',
        note: `${client} ${side === 'BUY' ? 'bought' : 'sold'} ${shares?.toLocaleString('en-IN')??'?'} shares${price ? ` @ ₹${price.toFixed(2)}` : ''}`,
        url: 'https://www.bseindia.com/markets/equity/EQReports/BulkDeals.aspx',
      })
    }
  } catch { /* silent */ }
  return { deals, source: 'BSE Bulk Deals' }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market = (searchParams.get('market') ?? 'ALL').toUpperCase() as 'ALL'|'US'|'IN'
  const symFilter = searchParams.get('symbol') ?? ''

  const allDeals: InsiderDeal[] = []
  const sources:  string[]      = []

  // ── US in parallel with India ─────────────────────────────────────────────
  const usTask: Promise<{ deals: InsiderDeal[]; source: string }> | null =
    market === 'ALL' || market === 'US'
      ? fetchFinnhubInsiders(symFilter || undefined)
      : null

  // India chain: primary → fallback (only if primary empty) + BSE (always
  // additional — different dataset). This replaces the old 4-way concurrent
  // fetch that was producing duplicates.
  const inTask: Promise<Array<{ deals: InsiderDeal[]; source: string }>> | null =
    market === 'ALL' || market === 'IN'
      ? (async () => {
          const results: Array<{ deals: InsiderDeal[]; source: string }> = []
          const [bulkArchive, blockArchive, bse] = await Promise.all([
            fetchNSEArchiveCSV('bulk'),
            fetchNSEArchiveCSV('block'),
            fetchBSEDeals(),
          ])
          results.push(bulkArchive, blockArchive, bse)

          // Session API is cheap to check but we only *use* it if the archive
          // returned nothing — otherwise it duplicates the same rows.
          if (bulkArchive.deals.length === 0) {
            results.push(await fetchNSESessionDeals('bulk'))
          }
          if (blockArchive.deals.length === 0) {
            results.push(await fetchNSESessionDeals('block'))
          }
          return results
        })()
      : null

  const [usResult, inResult] = await Promise.all([
    usTask ?? Promise.resolve(null),
    inTask ?? Promise.resolve(null),
  ])

  if (usResult && usResult.deals.length > 0) {
    allDeals.push(...usResult.deals)
    if (usResult.source) sources.push(usResult.source)
  }
  if (inResult) {
    for (const r of inResult) {
      if (r.deals.length > 0) {
        allDeals.push(...r.deals)
        if (r.source) sources.push(r.source)
      }
    }
  }

  // ── Dedupe ────────────────────────────────────────────────────────────────
  // Key now uses the full normalized person name + full date (not a slice)
  const seen = new Set<string>()
  const unique = allDeals.filter(d => {
    const person = d.person.toLowerCase().replace(/\s+/g, ' ').trim()
    const k = `${d.market}|${d.symbol}|${d.side}|${d.date}|${person}|${d.shares ?? 0}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })

  // ── Sort: smart money score desc (with meaningful tolerance), then date ──
  unique.sort((a, b) => {
    const scoreDiff = b.smartMoneyScore - a.smartMoneyScore
    if (Math.abs(scoreDiff) > 10) return scoreDiff
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  const deals = unique.slice(0, 100)

  // ── Intelligence layers ──────────────────────────────────────────────────
  const sectorIntel = buildSectorIntel(deals)
  const clusters    = buildClusters(deals)

  // ── Stats (split by currency) ────────────────────────────────────────────
  const stats = {
    total: deals.length,
    buys:  deals.filter(d => d.side === 'BUY').length,
    sells: deals.filter(d => d.side === 'SELL').length,
    high:  deals.filter(d => d.significance === 'high').length,
    us:    deals.filter(d => d.market === 'US').length,
    india: deals.filter(d => d.market === 'IN').length,
    usdValueBought: deals.filter(d => d.currency === 'USD' && d.side === 'BUY').reduce((s, d) => s + (d.value ?? 0), 0),
    usdValueSold:   deals.filter(d => d.currency === 'USD' && d.side === 'SELL').reduce((s, d) => s + (d.value ?? 0), 0),
    inrValueBought: deals.filter(d => d.currency === 'INR' && d.side === 'BUY').reduce((s, d) => s + (d.value ?? 0), 0),
    inrValueSold:   deals.filter(d => d.currency === 'INR' && d.side === 'SELL').reduce((s, d) => s + (d.value ?? 0), 0),
  }

  const response: InsiderResponse = {
    deals, sectorIntel, clusters, stats,
    fetchedAt: new Date().toISOString(),
    sources:   [...new Set(sources)],
  }

  return NextResponse.json(response, {
    // Belt-and-suspenders: CDN cache header in addition to route revalidate,
    // so even non-Vercel hosts (e.g. future AWS Amplify) benefit.
    headers: {
      'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
    },
  })
}