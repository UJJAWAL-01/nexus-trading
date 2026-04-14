// src/app/api/insider-deals/route.ts
// US: Finnhub Form 4 — full S&P 500 sector rotation + intelligence scoring
// IN: NSE archive CSV (no auth needed, works 24/7) + NSE session API fallback
// Intelligence layer: deal significance, sector clustering, smart-money scoring

import { NextRequest, NextResponse } from 'next/server'

// ── Cache ─────────────────────────────────────────────────────────────────────
interface CacheEntry { data: InsiderResponse; expires: number }
const cache     = new Map<string, CacheEntry>()
const staleStore = new Map<string, InsiderResponse>()
const nse        = { cookie: '', exp: 0 }

// ── Types ─────────────────────────────────────────────────────────────────────
export interface InsiderDeal {
  id: string; market: 'US' | 'IN'; type: 'insider' | 'bulk' | 'block'
  symbol: string; company: string; person: string; role: string; side: 'BUY' | 'SELL'
  shares: number | null; price: number | null; value: number | null; valueFmt: string
  currency: 'USD' | 'INR'; date: string; dateFmt: string; daysAgo: number
  significance: 'high' | 'medium' | 'low'; note: string; url: string
  // Intelligence fields
  smartMoneyScore: number   // 0-100 composite
  sector:          string
  unusualFlag:     boolean  // true if size >> typical for this insider
}

export interface SectorIntelligence {
  sector:    string
  netBuys:   number
  netSells:  number
  biggestDeal: number   // USD/INR value
  signal:    'accumulation' | 'distribution' | 'neutral'
}

interface InsiderResponse {
  deals:             InsiderDeal[]
  sectorIntel:       SectorIntelligence[]
  stats: {
    total: number; buys: number; sells: number
    high: number; us: number; india: number
    totalValueBought: number; totalValueSold: number
  }
  fetchedAt:   string
  sources:     string[]
}

// ── Full S&P 500 by GICS sector ───────────────────────────────────────────────
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

// Nifty 500 sector-based for India (for intelligent coverage)
const NIFTY50 = ['RELIANCE','TCS','HDFCBANK','BHARTIARTL','ICICIBANK','INFOSYS','SBIN','HINDUNILVR',
  'ITC','LT','KOTAKBANK','AXISBANK','BAJFINANCE','MARUTI','TITAN','WIPRO','SUNPHARMA','HCLTECH',
  'TATAMOTORS','ONGC','ADANIENT','TATASTEEL','NTPC','POWERGRID','BAJAJFINSV','DRREDDY','DIVISLAB',
  'CIPLA','ULTRACEMCO','ASIANPAINT','NESTLEIND','GRASIM','TECHM','M&M','HEROMOTOCO','EICHERMOT',
  'JSWSTEEL','HINDALCO','VEDL','COALINDIA']

// Sector lookup for US symbols
const SYMBOL_SECTOR: Record<string, string> = {}
for (const [sector, syms] of Object.entries(SP500_BY_SECTOR)) {
  syms.forEach(s => { SYMBOL_SECTOR[s] = sector })
}
const INDIA_SECTOR: Record<string, string> = {
  'RELIANCE':'Energy', 'ONGC':'Energy', 'COALINDIA':'Energy',
  'TCS':'Technology', 'INFOSYS':'Technology', 'WIPRO':'Technology', 'HCLTECH':'Technology', 'TECHM':'Technology',
  'HDFCBANK':'Financials', 'ICICIBANK':'Financials', 'SBIN':'Financials', 'KOTAKBANK':'Financials', 'AXISBANK':'Financials', 'BAJFINANCE':'Financials', 'BAJAJFINSV':'Financials',
  'HINDUNILVR':'ConsStaples', 'ITC':'ConsStaples', 'NESTLEIND':'ConsStaples',
  'LT':'Industrials', 'POWERGRID':'Utilities', 'NTPC':'Utilities',
  'TATAMOTORS':'ConsumerDisc', 'MARUTI':'ConsumerDisc', 'HEROMOTOCO':'ConsumerDisc',
  'TATASTEEL':'Materials', 'HINDALCO':'Materials', 'JSWSTEEL':'Materials', 'VEDL':'Materials',
  'SUNPHARMA':'Healthcare', 'DRREDDY':'Healthcare', 'DIVISLAB':'Healthcare', 'CIPLA':'Healthcare',
  'BHARTIARTL':'CommServices',
}

// ── Helper functions ──────────────────────────────────────────────────────────
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
  const hi = cur === 'INR' ? 1e8 : 50e6
  const md = cur === 'INR' ? 1e7 : 5e6
  return v >= hi ? 'high' : v >= md ? 'medium' : 'low'
}

// Smart money score: 0-100 based on deal characteristics
function calcSmartMoneyScore(deal: {
  side: 'BUY'|'SELL'; value: number|null; role: string
  type: 'insider'|'bulk'|'block'; significance: 'high'|'medium'|'low'
}): number {
  let score = 0
  // Buys are more informative than sells (insiders sell for many reasons)
  if (deal.side === 'BUY') score += 35
  // Role weight
  const roleScore: Record<string, number> = {
    'CEO': 25, 'CFO': 22, 'COO': 20, 'Director': 15, 'Promoter': 25,
    'FII/FPI': 20, 'Mutual Fund': 18, 'DII': 18, 'Institution': 15,
    'Insider': 10, 'Form 4 Filer': 10, 'PMS': 12,
  }
  const r = deal.role
  for (const [key, pts] of Object.entries(roleScore)) {
    if (r.toUpperCase().includes(key.toUpperCase())) { score += pts; break }
  }
  // Size weight
  if (deal.significance === 'high')   score += 25
  if (deal.significance === 'medium') score += 12
  // Block deals are institutional and thus more significant
  if (deal.type === 'block') score += 10
  if (deal.type === 'bulk')  score += 8
  return Math.min(100, score)
}

function today(): string { return new Date().toISOString().split('T')[0] }
function daysBack(n: number): string { return new Date(Date.now() - n * 86400000).toISOString().split('T')[0] }

let uidCtr = 0
function uid(pfx: string): string { return `${pfx}-${++uidCtr}-${Date.now()}` }

// ── Sector intelligence builder ───────────────────────────────────────────────
function buildSectorIntel(deals: InsiderDeal[]): SectorIntelligence[] {
  const sectorMap = new Map<string, { buys: number; sells: number; maxVal: number }>()

  for (const d of deals) {
    const sector = d.sector || 'Other'
    if (!sectorMap.has(sector)) sectorMap.set(sector, { buys: 0, sells: 0, maxVal: 0 })
    const s = sectorMap.get(sector)!
    const val = d.value ?? 0
    if (d.side === 'BUY')  s.buys  += val
    else                    s.sells += val
    if (val > s.maxVal) s.maxVal = val
  }

  return [...sectorMap.entries()]
    .map(([sector, { buys, sells, maxVal }]) => ({
      sector,
      netBuys:     buys,
      netSells:    sells,
      biggestDeal: maxVal,
      signal: (buys > sells * 1.5  ? 'accumulation'  :
               sells > buys * 1.5  ? 'distribution'  : 'neutral') as 'accumulation'|'distribution'|'neutral',
    }))
    .sort((a, b) => (b.netBuys + b.netSells) - (a.netBuys + a.netSells))
    .slice(0, 8)
}

// ── US: Finnhub Form 4 — rotating S&P 500 batch ──────────────────────────────
// Fetches 8 symbols from each sector = broad S&P 500 coverage per request
async function fetchFinnhubInsiders(symbol?: string): Promise<{ deals: InsiderDeal[]; source: string }> {
  if (!process.env.FINNHUB_API_KEY) return { deals: [], source: '' }
  const from = daysBack(60), to = today()

  let symsToFetch: string[]
  if (symbol) {
    symsToFetch = [symbol.toUpperCase()]
  } else {
    // Rotate through all sectors — take top symbols from each
    symsToFetch = Object.values(SP500_BY_SECTOR)
      .flatMap(arr => arr.slice(0, 8))  // 8 per sector × ~11 sectors = ~88 symbols
      .filter((s, i, a) => a.indexOf(s) === i) // dedupe
  }

  const deals: InsiderDeal[] = []
  const BATCH = 8
  let fetched = 0

  for (let i = 0; i < symsToFetch.length && fetched < 200; i += BATCH) {
    const batch = symsToFetch.slice(i, i + BATCH)
    await Promise.all(batch.map(async sym => {
      try {
        const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${sym}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`
        const r   = await fetch(url, { signal: AbortSignal.timeout(8000) })
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
          const sig    = sigLevel(value, 'USD')
          const role   = t.officerTitle ?? 'Insider'
          const side   = isBuy ? 'BUY' : 'SELL'
          const smScore = calcSmartMoneyScore({ side, value, role, type:'insider', significance: sig })

          deals.push({
            id: uid('us-fh'), market:'US', type:'insider',
            symbol: sym, company: t.name ?? sym, person: t.name ?? 'Unknown',
            role, side, shares, price, value,
            valueFmt: fmtValue(value, 'USD'), currency:'USD',
            date: t.transactionDate, dateFmt: fmtDate(t.transactionDate),
            daysAgo: daysAgo(t.transactionDate),
            significance: sig, smartMoneyScore: smScore,
            sector: SYMBOL_SECTOR[sym] ?? 'Other',
            unusualFlag: smScore >= 70 && sig === 'high',
            note: `${role} ${isBuy?'purchased':'sold'} ${shares?.toLocaleString()??'?'} shares${price?` @ $${price.toFixed(2)}`:''}`,
            url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${sym}&type=4&count=5`,
          })
          fetched++
        }
      } catch {}
    }))
    // Rate limit: Finnhub free = 60 req/min
    if (i + BATCH < symsToFetch.length) await new Promise(r => setTimeout(r, 100))
  }

  return { deals, source: 'Finnhub (Form 4 — S&P 500)' }
}

// ── India: NSE archive CSV (no auth, works 24/7) ─────────────────────────────
function parseDateToISO(raw: string): string {
  // NSE CSV dates are like "14-Apr-2026"
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
    if (char === '"') { inQuotes = !inQuotes }
    else if (char === ',' && !inQuotes) { result.push(current.trim()); current = '' }
    else { current += char }
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
  // NSE archives are available without auth/cookies — published daily
  // Try today's file, fallback to yesterday for weekends/holidays
  const deals: InsiderDeal[] = []
  const source = `NSE ${type.charAt(0).toUpperCase() + type.slice(1)} Deals (Archive)`

  const dates = [0, 1, 2, 3].map(d => {
    const dt = new Date(Date.now() - d * 86400000)
    const dd = String(dt.getDate()).padStart(2, '0')
    const mm = String(dt.getMonth() + 1).padStart(2, '0')
    const yyyy = dt.getFullYear()
    return { iso: `${yyyy}-${mm}-${dd}`, nse: `${dd}${mm}${yyyy}` }
  })

  // NSE archive URL format for bulk deals
  const archiveUrls = type === 'bulk'
    ? [
        `https://archives.nseindia.com/content/equities/bulk.csv`,  // current
        ...dates.map(d => `https://archives.nseindia.com/content/equities/bulk_deals_${d.nse}.csv`),
      ]
    : [
        `https://archives.nseindia.com/content/equities/block.csv`,  // current
        ...dates.map(d => `https://archives.nseindia.com/content/equities/block_deals_${d.nse}.csv`),
      ]

  for (const url of archiveUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/csv,text/plain,*/*',
          'Referer': 'https://www.nseindia.com/',
        },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) continue
      const text = await res.text()
      if (!text || text.length < 50) continue

      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length < 2) continue

      const header = lines[0].toLowerCase()
      console.log(`[insider] NSE ${type} CSV header: ${header.slice(0, 100)}`)

      for (let i = 1; i < Math.min(lines.length, 200); i++) {
        const cols = parseCSVLine(lines[i])
        if (cols.length < 5) continue

        // NSE bulk CSV format: Date, Symbol, Security Name, Client Name, Buy/Sell, Quantity, Price, Remarks
        // NSE block CSV format: similar
        const [rawDate, sym, secName, clientName, rawBS, rawQty, rawPrice] = cols
        if (!sym || !clientName) continue

        const symbol   = sym.trim().toUpperCase()
        const client   = clientName.trim()
        const company  = (secName || symbol).trim()
        const side: 'BUY'|'SELL' = rawBS?.trim().toUpperCase().startsWith('B') ? 'BUY' : 'SELL'
        const shares   = parseFloat(rawQty?.replace(/,/g, '') ?? '0') || null
        const price    = parseFloat(rawPrice?.replace(/,/g, '') ?? '0') || null
        const value    = shares && price ? shares * price : null
        const dateISO  = rawDate ? parseDateToISO(rawDate.trim()) : today()
        const sig      = sigLevel(value, 'INR')
        const role     = classifyClient(client)
        const smScore  = calcSmartMoneyScore({ side, value, role, type, significance: sig })

        deals.push({
          id: uid(`nse-${type}`), market:'IN', type,
          symbol, company, person: client, role, side, shares, price, value,
          valueFmt: fmtValue(value, 'INR'), currency:'INR',
          date: dateISO, dateFmt: fmtDate(dateISO), daysAgo: daysAgo(dateISO),
          significance: sig, smartMoneyScore: smScore,
          sector: INDIA_SECTOR[symbol] ?? 'Other',
          unusualFlag: smScore >= 60 && sig !== 'low',
          note: `${client} ${side === 'BUY' ? 'bought' : 'sold'} ${shares?.toLocaleString('en-IN')??'?'} shares${price ? ` @ ₹${price.toFixed(2)}` : ''}`,
          url: `https://www.nseindia.com/get-quotes/equity?symbol=${symbol}`,
        })
      }

      if (deals.length > 0) {
        console.log(`[insider] NSE ${type} archive: ${deals.length} deals from ${url}`)
        return { deals, source }
      }
    } catch (e) {
      console.warn(`[insider] NSE ${type} archive ${url} failed:`, e)
    }
  }

  return { deals, source }
}

// ── NSE session API fallback (works during market hours) ─────────────────────
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
    const parts   = cookies.split(',').flatMap(c => c.split(';')).map(s => s.trim())
      .filter(s => /^(nsit|nseappid|ak_bmsc|bm_sv)=/.test(s))
    nse.cookie = parts.join('; ')
    nse.exp    = Date.now() + 12 * 60_000
    return nse.cookie
  } catch { return '' }
}

async function fetchNSESessionDeals(type: 'bulk' | 'block'): Promise<{ deals: InsiderDeal[]; source: string }> {
  const deals: InsiderDeal[] = []
  try {
    const cookie   = await getNSECookie()
    const endpoint = type === 'bulk'
      ? 'https://www.nseindia.com/api/bulk-block-short-selling-deals?type=bulk_deals'
      : 'https://www.nseindia.com/api/bulk-block-short-selling-deals?type=block_deals'
    const r = await fetch(endpoint, {
      headers: { ...NSE_HEADERS, 'Cookie': cookie },
      signal: AbortSignal.timeout(12000),
    })
    if (!r.ok) return { deals, source: '' }
    const json = await r.json()
    const rows: any[] = Array.isArray(json) ? json : (json.data ?? [])
    for (const row of rows.slice(0, 100)) {
      const sym    = (row.symbol ?? row.Symbol ?? row.SYMBOL ?? '').toString().trim()
      const comp   = (row.name ?? row.Name ?? row.COMPANY_NAME ?? sym).toString().trim()
      const client = (row.clientName ?? row.CLIENT_NAME ?? row.clientname ?? 'Unknown').toString().trim()
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
      if (!sym || !client || client === 'Unknown') continue
      deals.push({
        id: uid(`nse-api-${type}`), market:'IN', type,
        symbol: sym, company: comp || sym, person: client, role, side, shares, price, value,
        valueFmt: fmtValue(value, 'INR'), currency:'INR',
        date: dateISO, dateFmt: fmtDate(dateISO), daysAgo: daysAgo(dateISO),
        significance: sig, smartMoneyScore: smScore,
        sector: INDIA_SECTOR[sym] ?? 'Other',
        unusualFlag: smScore >= 60 && sig !== 'low',
        note: `${client} ${side === 'BUY' ? 'bought' : 'sold'} ${shares?.toLocaleString('en-IN')??'?'} shares${price ? ` @ ₹${price.toFixed(2)}` : ''}`,
        url: `https://www.nseindia.com/get-quotes/equity?symbol=${sym}`,
      })
    }
  } catch (e) { console.warn(`[insider] NSE session ${type} failed:`, e) }
  return { deals, source: `NSE ${type.charAt(0).toUpperCase()+type.slice(1)} Deals (Session API)` }
}

// ── BSE bulk deals ────────────────────────────────────────────────────────────
async function fetchBSEDeals(): Promise<{ deals: InsiderDeal[]; source: string }> {
  const deals: InsiderDeal[] = []
  try {
    const dd = new Date()
    const d  = `${String(dd.getDate()).padStart(2,'0')}${String(dd.getMonth()+1).padStart(2,'0')}${dd.getFullYear()}`
    const url = `https://api.bseindia.com/BseIndiaAPI/api/BulkBlockDeals/w?type=D&Fdate=${d}&Tdate=${d}`
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://www.bseindia.com/',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return { deals, source: '' }
    const json = await r.json()
    const rows: any[] = json.Table ?? json.Table1 ?? []
    for (const row of rows.slice(0, 60)) {
      const sym    = (row.ScripCode ?? row.scripcode ?? '').toString().trim()
      const comp   = (row.ScripName ?? row.scripname ?? sym).toString().trim()
      const client = (row.ClientName ?? row.CLIENT_NAME ?? 'Unknown').toString().trim()
      const rawBS  = (row.BuyOrSell ?? row.BuySell ?? 'B').toString().toUpperCase()
      const side: 'BUY'|'SELL' = rawBS.startsWith('B') ? 'BUY' : 'SELL'
      const shares = parseFloat(row.Quantity ?? row.QTY ?? 0) || null
      const price  = parseFloat(row.Price ?? row.PRICE ?? 0) || null
      const value  = shares && price ? shares * price : null
      if (!comp || comp === sym) continue
      const sig     = sigLevel(value, 'INR')
      const role    = classifyClient(client)
      const smScore = calcSmartMoneyScore({ side, value, role, type:'bulk', significance: sig })
      deals.push({
        id: uid('bse-bulk'), market:'IN', type:'bulk',
        symbol: comp, company: comp, person: client, role, side, shares, price, value,
        valueFmt: fmtValue(value, 'INR'), currency:'INR',
        date: today(), dateFmt: fmtDate(today()), daysAgo: 0,
        significance: sig, smartMoneyScore: smScore,
        sector: INDIA_SECTOR[comp] ?? 'Other',
        unusualFlag: smScore >= 60 && sig !== 'low',
        note: `${client} ${side === 'BUY' ? 'bought' : 'sold'} ${shares?.toLocaleString('en-IN')??'?'} shares${price ? ` @ ₹${price.toFixed(2)}` : ''}`,
        url: 'https://www.bseindia.com/markets/equity/EQReports/BulkDeals.aspx',
      })
    }
  } catch (e) { console.warn('[insider] BSE bulk failed:', e) }
  return { deals, source: 'BSE Bulk Deals' }
}

// ── Main route handler ────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market    = (searchParams.get('market') ?? 'ALL').toUpperCase()
  const symFilter = searchParams.get('symbol') ?? ''
  const cacheKey  = `insider:${market}:${symFilter}`

  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  const allDeals: InsiderDeal[] = []
  const sources:  string[]      = []

  // ── Fetch concurrently ─────────────────────────────────────────────────────
  const tasks: Promise<{ deals: InsiderDeal[]; source: string }>[] = []

  if (market === 'ALL' || market === 'US') {
    tasks.push(fetchFinnhubInsiders(symFilter || undefined))
  }

  if (market === 'ALL' || market === 'IN') {
    // Primary: NSE archive CSV (no auth, works 24/7)
    tasks.push(fetchNSEArchiveCSV('bulk'))
    tasks.push(fetchNSEArchiveCSV('block'))
    // Fallback: NSE session API (may fail outside market hours)
    tasks.push(fetchNSESessionDeals('bulk'))
    tasks.push(fetchNSESessionDeals('block'))
    // BSE as additional source
    tasks.push(fetchBSEDeals())
  }

  const results = await Promise.allSettled(tasks)
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.deals.length > 0) {
      allDeals.push(...r.value.deals)
      if (r.value.source) sources.push(r.value.source)
    }
  }

  // ── Deduplicate by symbol+side+date+person ─────────────────────────────────
  const seen = new Set<string>()
  const unique = allDeals.filter(d => {
    const k = `${d.market}-${d.symbol}-${d.side}-${d.date}-${d.person.slice(0,15)}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })

  // ── Sort: smart money score DESC, then by date ─────────────────────────────
  unique.sort((a, b) => {
    const scoreDiff = b.smartMoneyScore - a.smartMoneyScore
    if (Math.abs(scoreDiff) > 10) return scoreDiff
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  const deals = unique.slice(0, 100)

  // ── Build sector intelligence ─────────────────────────────────────────────
  const sectorIntel = buildSectorIntel(deals)

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = {
    total: deals.length,
    buys:  deals.filter(d => d.side === 'BUY').length,
    sells: deals.filter(d => d.side === 'SELL').length,
    high:  deals.filter(d => d.significance === 'high').length,
    us:    deals.filter(d => d.market === 'US').length,
    india: deals.filter(d => d.market === 'IN').length,
    totalValueBought: deals.filter(d => d.side === 'BUY').reduce((s, d) => s + (d.value ?? 0), 0),
    totalValueSold:   deals.filter(d => d.side === 'SELL').reduce((s, d) => s + (d.value ?? 0), 0),
  }

  const response: InsiderResponse = {
    deals, sectorIntel, stats,
    fetchedAt: new Date().toISOString(),
    sources:   [...new Set(sources)],
  }

  // Cache 15 minutes + stale store
  cache.set(cacheKey, { data: response, expires: Date.now() + 15 * 60_000 })
  staleStore.set(cacheKey, response)

  return NextResponse.json(response)
}