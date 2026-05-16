import { NextRequest, NextResponse } from 'next/server'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Holding {
  name: string
  ticker?: string
  cusip?: string   // CUSIP from SEC 13F XML — canonical security identifier
  value: number    // USD (13F raw) or INR free-float market cap (NSE)
  shares: number
  pctPort: number
  price?: number   // current/last price
  change?: number  // day change %
}

interface FundResult {
  id: string; name: string; manager: string; style: string
  asOf: string; holdings: Holding[]; totalAum: number; source: string
}

interface ConsensusItem {
  name: string; ticker?: string
  count: number; funds: string[]
  totalValue: number; avgPct: number; score: number
}

// ── Cache ──────────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: unknown; expires: number }>()
const TTL_24H = 24 * 60 * 60 * 1000

// ── US Hedge Funds — 7 verified SEC CIKs ──────────────────────────────────────

const US_FUNDS = [
  { id: 'berkshire',  name: 'Berkshire Hathaway',          manager: 'Warren Buffett',        cik: '1067983', style: 'Value / GARP'        },
  { id: 'pershing',   name: 'Pershing Square Capital',     manager: 'Bill Ackman',            cik: '1336528', style: 'Concentrated Value'  },
  { id: 'duquesne',   name: 'Duquesne Family Office',      manager: 'Stan Druckenmiller',     cik: '1536411', style: 'Global Macro'        },
  { id: 'tiger',      name: 'Tiger Global Management',     manager: 'Chase Coleman',          cik: '1167483', style: 'Tech Growth L/S'     },
  { id: 'baupost',    name: 'Baupost Group',               manager: 'Seth Klarman',           cik: '1061768', style: 'Deep Value'          },
  { id: 'scion',      name: 'Scion Asset Management',      manager: 'Michael Burry',          cik: '1649339', style: 'Contrarian Value'    },
  { id: 'greenlight', name: 'Greenlight Capital',          manager: 'David Einhorn',          cik: '1079114', style: 'Long/Short Value'    },
] as const

// ── India Smart Money — 7 NSE indices → top MF category proxies ───────────────

const IN_FUNDS = [
  { id: 'nifty50',    name: 'Large Cap (Nifty 50)',         manager: 'Top Large Cap AMCs',   nseIndex: 'NIFTY 50',                    style: 'Large Cap'    },
  { id: 'nifty100',   name: 'Bluechip (Nifty 100)',         manager: 'Top Bluechip AMCs',    nseIndex: 'NIFTY 100',                   style: 'Large Cap 100'},
  { id: 'nexttfifty', name: 'Emerging LargeCap (Next 50)',  manager: 'Mirae / L&T AMCs',     nseIndex: 'NIFTY NEXT 50',               style: 'Mid-Large Cap'},
  { id: 'midcap100',  name: 'Mid Cap (Nifty Midcap 100)',   manager: 'Nippon / HDFC AMCs',   nseIndex: 'NIFTY MIDCAP 100',            style: 'Mid Cap'      },
  { id: 'smlcap100',  name: 'Small Cap (Nifty Smlcap 100)', manager: 'SBI / Axis AMCs',      nseIndex: 'NIFTY SMLCAP 100',            style: 'Small Cap'    },
  { id: 'flexicap',   name: 'Flexi Cap (Nifty 200)',        manager: 'Parag Parikh / HDFC',  nseIndex: 'NIFTY 200',                   style: 'Flexi Cap'    },
  { id: 'multicap',   name: 'Multi Cap (Nifty500 50:25:25)', manager: 'Kotak / Nippon AMCs', nseIndex: 'NIFTY500 MULTICAP 50:25:25',  style: 'Multi Cap'    },
] as const

// ── CUSIP → ticker resolution via OpenFIGI ─────────────────────────────────────
// OpenFIGI (https://openfigi.com) is Bloomberg's free public identifier service.
// Every 13F filing contains a CUSIP for each holding — the canonical 9-char
// security identifier. We resolve those to tickers at runtime. No hardcoded list.
//
// CUSIPs are permanent (don't change for a security's lifetime), so caching the
// resolution forever is safe. Cache is module-level, persists for the process.

const cusipCache = new Map<string, string>()

async function resolveTickers(holdings: Holding[]): Promise<void> {
  // Pull CUSIPs we haven't cached yet
  const toResolve = [...new Set(
    holdings.map(h => h.cusip).filter((c): c is string => !!c && !cusipCache.has(c))
  )]

  // OpenFIGI rate limits (anonymous, no API key):
  //   - 25 requests/minute
  //   - 10 jobs per request   ← critical: more than 10 in one batch → rejected
  // With a paid API key these become 250 req/min and 100 jobs/req.
  const BATCH_SIZE = 10

  // Inner: run one batched mapping pass. `filterUS=true` restricts to US-listed
  // securities (preferred for primary ticker resolution); `false` falls back
  // to any exchange (catches foreign-domiciled issuers like WTW on Cayman CUSIPs).
  const runPass = async (cusips: string[], filterUS: boolean): Promise<void> => {
    for (let i = 0; i < cusips.length; i += BATCH_SIZE) {
      const batch = cusips.slice(i, i + BATCH_SIZE)
      const body  = batch.map(c =>
        filterUS
          ? { idType: 'ID_CUSIP', idValue: c, exchCode: 'US' }
          : { idType: 'ID_CUSIP', idValue: c }
      )
      try {
        const res = await fetch('https://api.openfigi.com/v3/mapping', {
          method:  'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept':       'application/json',
            'User-Agent':   'NEXUS-Trading-Research/1.0',
          },
          body:    JSON.stringify(body),
          signal:  AbortSignal.timeout(12_000),
        })
        if (!res.ok) {
          console.warn(`[smart-money] OpenFIGI HTTP ${res.status} (filterUS=${filterUS})`)
          continue
        }
        const data = await res.json() as Array<{
          data?: Array<{ ticker?: string; securityType?: string; marketSector?: string }>
          error?: string
        }>
        data.forEach((entry, idx) => {
          const cusip = batch[idx]
          if (!entry.data?.length) return
          const common = entry.data.find(d => d.securityType === 'Common Stock' && d.ticker)
          const adr    = entry.data.find(d => d.securityType === 'ADR' && d.ticker)
          const ticker = common?.ticker ?? adr?.ticker ?? entry.data[0]?.ticker
          if (ticker) cusipCache.set(cusip, ticker)
        })
        if (i + BATCH_SIZE < cusips.length) {
          await new Promise(r => setTimeout(r, 100))
        }
      } catch (err) {
        console.warn(`[smart-money] OpenFIGI fetch failed:`, err instanceof Error ? err.message : err)
      }
    }
  }

  // Pass 1: US-listed only (catches the vast majority — major hedge fund holdings)
  await runPass(toResolve, true)

  // Pass 2: retry whatever's still unresolved without the exchange filter
  // (Cayman / Bermuda / Irish CUSIPs whose primary listing isn't tagged 'US')
  const stillMissing = toResolve.filter(c => !cusipCache.has(c))
  if (stillMissing.length > 0) await runPass(stillMissing, false)

  // Apply resolved tickers
  for (const h of holdings) {
    if (h.cusip && cusipCache.has(h.cusip)) h.ticker = cusipCache.get(h.cusip)
  }
}

// ── SEC EDGAR 13F parser ───────────────────────────────────────────────────────

const EDGAR_HEADERS = {
  'User-Agent': 'NEXUS-Trading-Research/1.0 research@nexustrading.app',
  Accept: 'application/json, text/plain, */*',
}

function parseInfotable(xml: string): Holding[] {
  // Dedupe by CUSIP (canonical security identifier) when available, else by name.
  // 13F often has multiple <infoTable> entries per issuer (different sub-accounts);
  // they share a CUSIP and must be summed.
  const byKey = new Map<string, { name: string; cusip?: string; value: number; shares: number }>()

  for (const [, inner] of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi)) {
    const name   = inner.match(/<(?:\w+:)?nameOfIssuer>\s*(.*?)\s*<\/(?:\w+:)?nameOfIssuer>/i)?.[1]?.trim() ?? ''
    const cusip  = inner.match(/<(?:\w+:)?cusip>\s*(.*?)\s*<\/(?:\w+:)?cusip>/i)?.[1]?.trim() ?? ''
    const rawVal = parseInt(inner.match(/<(?:\w+:)?value>\s*(\d+)\s*<\/(?:\w+:)?value>/i)?.[1] ?? '0')
    const shares = parseInt(inner.match(/<(?:\w+:)?sshPrnamt>\s*(\d+)\s*<\/(?:\w+:)?sshPrnamt>/i)?.[1] ?? '0')
    if (!name || rawVal <= 0) continue

    const key = cusip || name
    const prev = byKey.get(key)
    if (prev) {
      prev.value  += rawVal
      prev.shares += shares
    } else {
      byKey.set(key, { name, cusip: cusip || undefined, value: rawVal, shares })
    }
  }

  const holdings: Holding[] = [...byKey.values()].map(({ name, cusip, value, shares }) => ({
    name, cusip, value, shares, pctPort: 0,
  }))
  const total = holdings.reduce((s, h) => s + h.value, 0)
  return holdings
    .map(h => ({ ...h, pctPort: total > 0 ? (h.value / total) * 100 : 0 }))
    .sort((a, b) => b.pctPort - a.pctPort)
    .slice(0, 25)
}

async function fetch13F(cik: string): Promise<{ holdings: Holding[]; asOf: string; totalAum: number }> {
  const paddedCik  = cik.padStart(10, '0')
  const numericCik = String(parseInt(cik, 10))

  const subRes = await fetch(`https://data.sec.gov/submissions/CIK${paddedCik}.json`,
    { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(15_000) })
  if (!subRes.ok) throw new Error(`EDGAR submissions HTTP ${subRes.status}`)

  const sub = await subRes.json() as {
    filings: { recent: { form: string[]; accessionNumber: string[]; filingDate: string[] } }
  }
  const { form, accessionNumber, filingDate } = sub.filings.recent
  const idx = form.findIndex(f => f === '13F-HR')
  if (idx === -1) throw new Error(`No 13F-HR for CIK ${cik}`)

  const accDash   = accessionNumber[idx]
  const accNoDash = accDash.replace(/-/g, '')
  const asOf      = filingDate[idx]

  let infotableName = ''
  const indexRes = await fetch(
    `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accNoDash}/${accDash}-index.htm`,
    { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(10_000) }
  )
  if (indexRes.ok) {
    const html = await indexRes.text()
    const dirRegex = new RegExp(`/Archives/edgar/data/${numericCik}/${accNoDash}/([^/"<>]+\\.xml)`, 'gi')
    const xmlFiles = [...html.matchAll(dirRegex)]
      .map(m => m[1])
      .filter(f => !f.toLowerCase().includes('primary_doc') && !f.toLowerCase().includes('xsl'))
    if (xmlFiles.length > 0) infotableName = xmlFiles[0]
  }
  if (!infotableName) infotableName = 'form13fInfoTable.xml'

  const xmlRes = await fetch(
    `https://www.sec.gov/Archives/edgar/data/${numericCik}/${accNoDash}/${infotableName}`,
    { headers: EDGAR_HEADERS, signal: AbortSignal.timeout(25_000) }
  )
  if (!xmlRes.ok) throw new Error(`Infotable HTTP ${xmlRes.status}`)

  const holdings = parseInfotable(await xmlRes.text())
  // Resolve CUSIPs → tickers via OpenFIGI (Bloomberg's public identifier service).
  // Mutates holdings in-place; safe to await before returning.
  await resolveTickers(holdings)
  return { holdings, asOf, totalAum: holdings.reduce((s, h) => s + h.value, 0) }
}

// ── NSE India live index composition ──────────────────────────────────────────

interface NSEStock { symbol: string; priority: number; ffmc: number | string; lastPrice: number; pChange: number; meta?: { companyName?: string } }

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.nseindia.com/',
}

async function fetchNSEIndex(indexName: string): Promise<Holding[]> {
  const url = `https://www.nseindia.com/api/equity-stockIndices?index=${encodeURIComponent(indexName)}`
  const res = await fetch(url, { headers: NSE_HEADERS, signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`NSE HTTP ${res.status}`)

  const data = await res.json() as { data: NSEStock[] }
  const stocks = (data.data ?? []).filter(s => s.priority === 0)
  const totalFFMC = stocks.reduce((sum, s) => sum + parseFloat(String(s.ffmc ?? 0)), 0)

  return stocks
    .map(s => ({
      name:    s.meta?.companyName ?? s.symbol,
      ticker:  s.symbol + '.NS',
      value:   parseFloat(String(s.ffmc ?? 0)),
      shares:  0,
      pctPort: totalFFMC > 0 ? (parseFloat(String(s.ffmc ?? 0)) / totalFFMC) * 100 : 0,
      price:   s.lastPrice,
      change:  s.pChange,
    }))
    .sort((a, b) => b.pctPort - a.pctPort)
    .slice(0, 25)
}

// ── Consensus builder ─────────────────────────────────────────────────────────

function buildConsensus(funds: FundResult[]): ConsensusItem[] {
  if (funds.length === 0) return []
  const map = new Map<string, ConsensusItem>()
  for (const fund of funds) {
    for (const h of fund.holdings) {
      // Dedupe by CUSIP (canonical) when available, else normalized name.
      // CUSIP catches cases where two funds report the same security with
      // slightly different name spellings ("ALPHABET INC" vs "ALPHABET INC-CL A").
      const key = h.cusip ?? h.name.toLowerCase().replace(/\s+/g, ' ').trim()
      if (!map.has(key)) {
        map.set(key, { name: h.name, ticker: h.ticker, count: 0, funds: [], totalValue: 0, avgPct: 0, score: 0 })
      }
      const item = map.get(key)!
      item.count++
      item.funds.push(fund.name)
      item.totalValue += h.value
      item.avgPct += h.pctPort
      // Take ticker from whichever fund's holding resolved one
      if (!item.ticker && h.ticker) item.ticker = h.ticker
    }
  }
  const threshold = funds.length <= 2 ? 1 : 2
  return [...map.values()]
    .filter(c => c.count >= threshold)
    .map(c => ({ ...c, avgPct: c.avgPct / c.count, score: c.count * Math.sqrt(c.avgPct / c.count + 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 25)
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const market = (searchParams.get('market') ?? 'US') as 'US' | 'IN'
  const fund   = searchParams.get('fund')

  const cacheKey = `sm-${market}-${fund ?? 'consensus'}`
  const cached   = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.data)

  try {
    let data: unknown

    // ── US Hedge Funds ──────────────────────────────────────────────────────────
    if (market === 'US') {
      if (fund) {
        const def = US_FUNDS.find(f => f.id === fund)
        if (!def) return NextResponse.json({ error: `Unknown fund: ${fund}` }, { status: 400 })
        const result = await fetch13F(def.cik)
        data = {
          market: 'US', type: 'fund',
          fund: { id: def.id, name: def.name, manager: def.manager, style: def.style, ...result, source: 'SEC EDGAR Form 13F' },
          disclaimer: `SEC Form 13F filing dated ${result.asOf}. Holdings reflect that quarter's positions (45-90 day reporting lag). Public regulatory data.`,
        }
      } else {
        const settled = await Promise.allSettled(
          US_FUNDS.map(async f => {
            const r = await fetch13F(f.cik)
            return { id: f.id, name: f.name, manager: f.manager, style: f.style, ...r, source: 'SEC EDGAR 13F' } as FundResult
          })
        )
        const successFunds = settled
          .filter((r): r is PromiseFulfilledResult<FundResult> => r.status === 'fulfilled')
          .map(r => r.value)

        data = {
          market: 'US', type: 'consensus',
          funds: US_FUNDS.map(def => ({
            id: def.id, name: def.name, manager: def.manager, style: def.style,
            loaded: successFunds.some(f => f.id === def.id),
          })),
          consensus: buildConsensus(successFunds),
          disclaimer: 'SEC Form 13F mandatory public disclosures (Q4 2025 filings). Reporting lag 45-90 days.',
        }
      }

    // ── India ───────────────────────────────────────────────────────────────────
    } else {
      if (fund) {
        const def = IN_FUNDS.find(f => f.id === fund)
        if (!def) return NextResponse.json({ error: `Unknown fund: ${fund}` }, { status: 400 })
        const holdings = await fetchNSEIndex(def.nseIndex)
        data = {
          market: 'IN', type: 'fund',
          fund: {
            id: def.id, name: def.name, manager: def.manager, style: def.style,
            asOf: new Date().toISOString().split('T')[0],
            holdings, totalAum: 0, source: `NSE India · ${def.nseIndex}`,
          },
          disclaimer: `Live NSE ${def.nseIndex} composition by free-float market cap. Indian large-cap MFs hold 70-90% overlap by SEBI mandate.`,
        }
      } else {
        const settled = await Promise.allSettled(
          IN_FUNDS.map(async def => {
            const holdings = await fetchNSEIndex(def.nseIndex)
            return {
              id: def.id, name: def.name, manager: def.manager, style: def.style,
              asOf: new Date().toISOString().split('T')[0],
              holdings, totalAum: 0, source: `NSE ${def.nseIndex}`,
            } as FundResult
          })
        )
        const successFunds = settled
          .filter((r): r is PromiseFulfilledResult<FundResult> => r.status === 'fulfilled')
          .map(r => r.value)

        data = {
          market: 'IN', type: 'consensus',
          funds: IN_FUNDS.map(def => ({
            id: def.id, name: def.name, manager: def.manager, style: def.style,
            loaded: successFunds.some(f => f.id === def.id),
          })),
          consensus: buildConsensus(successFunds),
          disclaimer: 'Live NSE index compositions. Indian MFs in each category hold 70-90% overlap per SEBI mandate.',
        }
      }
    }

    // India data updates every minute via NSE; cache shorter. US 13F is quarterly; cache long.
    const ttl = market === 'IN' ? 5 * 60 * 1000 : TTL_24H
    cache.set(cacheKey, { data, expires: Date.now() + ttl })
    return NextResponse.json(data)
  } catch (err) {
    if (cached) return NextResponse.json({ ...cached.data as object, stale: true })
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
