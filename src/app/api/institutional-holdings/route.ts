// src/app/api/institutional-holdings/route.ts
// SEC EDGAR 13F-HR holdings tracker.
// Modes:
//   GET ?cik=0001067983              → Berkshire's latest 13F holdings
//   GET ?ticker=AAPL                 → Which major institutions hold AAPL
//
// Data: SEC EDGAR submissions JSON + 13F informationtable XML (no API key).

import { NextRequest, NextResponse } from 'next/server'

const dev = process.env.NODE_ENV !== 'production'
const SEC_UA = 'NEXUS Trading Intelligence nexus-app/1.0 contact@nexustrading.app'

// ── Caches (24h, 13F filings update quarterly) ────────────────────────────────
const filingsCache  = new Map<string, { data: ParsedFiling | null; expires: number }>()
const holdingsCache = new Map<string, { data: HoldingsResponse;     expires: number }>()
const tickerByQuery = new Map<string, { data: TickerLookup;         expires: number }>()

const TWENTY_FOUR_H = 24 * 3600_000

// ── Types ─────────────────────────────────────────────────────────────────────
interface InfoTableEntry {
  nameOfIssuer: string
  cusip:        string
  value:        number    // USD (raw, post-2022 SEC switched filings to whole dollars)
  shares:       number
  putCall:      'Put' | 'Call' | null
  shareType:    string    // 'SH' | 'PRN'
}

interface ParsedFiling {
  accession:   string
  filingDate:  string
  reportDate:  string
  entries:     InfoTableEntry[]
  totalValue:  number
}

interface HoldingChange {
  shares: number
  value:  number
  type:   'new' | 'increased' | 'decreased' | 'exited' | 'unchanged'
}

interface HoldingRow {
  cusip:             string
  name:              string
  shares:            number
  value:             number
  percentOfPortfolio: number
  putCall:           'Put' | 'Call' | null
  change:            HoldingChange
}

interface HoldingsResponse {
  institution:        { name: string; cik: string }
  filingDate:         string
  reportDate:         string
  priorReportDate:    string | null
  holdings:           HoldingRow[]
  totalPortfolioValue: number
  newPositions:       number
  exitedPositions:    number
  nextFilingDue:      string
  source:             string
  lastUpdated:        string
}

interface TickerLookup {
  ticker:        string
  cusip:         string | null
  name:          string
  appearsIn:     {
    institution: { name: string; cik: string }
    filingDate:  string
    shares:      number
    value:       number
    percentOfPortfolio: number
    change:      HoldingChange
  }[]
}

// ── Major institutions (also used for "by ticker" cross-lookup) ───────────────
export const MAJOR_INSTITUTIONS: { name: string; cik: string }[] = [
  { name: 'Berkshire Hathaway',           cik: '0001067983' },
  { name: 'Vanguard Group',               cik: '0000102909' },
  { name: 'BlackRock',                    cik: '0001364742' },
  { name: 'State Street',                 cik: '0000093751' },
  { name: 'ARK Investment Management',    cik: '0001697748' },
  { name: 'Bridgewater Associates',       cik: '0001350694' },
  { name: 'Renaissance Technologies',     cik: '0001037389' },
  { name: 'Two Sigma Investments',        cik: '0001179392' },
  { name: 'Citadel Advisors',             cik: '0001423053' },
  { name: 'Tiger Global Management',      cik: '0001167483' },
  { name: 'Soros Fund Management',        cik: '0001029160' },
  { name: 'Pershing Square Capital',      cik: '0001336528' },
  { name: 'Appaloosa Management',         cik: '0001656456' },
  { name: 'Baupost Group',                cik: '0001061165' },
]

const INSTITUTION_BY_CIK: Record<string, string> = Object.fromEntries(
  MAJOR_INSTITUTIONS.map(i => [i.cik, i.name]),
)

// ── Helpers ───────────────────────────────────────────────────────────────────
function padCik(cik: string): string {
  return cik.padStart(10, '0')
}

function intCik(cik: string): string {
  return String(parseInt(cik, 10))
}

function stripDashes(accession: string): string {
  return accession.replace(/-/g, '')
}

function nextFilingDueAfter(reportDateISO: string): string {
  // 13F-HR is due 45 days after end of quarter
  const d = new Date(reportDateISO)
  if (Number.isNaN(d.getTime())) return ''
  const due = new Date(d)
  due.setUTCDate(due.getUTCDate() + 45)
  return due.toISOString().slice(0, 10)
}

// ── EDGAR submissions list — find 13F-HR accession numbers ────────────────────
interface SubmissionRow {
  accession: string
  form:      string
  filingDate: string
  reportDate: string
  primaryDocument: string
}

async function fetchSubmissions(cik: string): Promise<SubmissionRow[]> {
  try {
    const url = `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`
    const res = await fetch(url, {
      headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      dev && console.error('[13F] submissions fetch failed:', res.status, cik)
      return []
    }

    const json     = await res.json()
    const recent   = json?.filings?.recent
    if (!recent) return []

    const accs:    string[] = recent.accessionNumber  ?? []
    const forms:   string[] = recent.form              ?? []
    const fdates:  string[] = recent.filingDate        ?? []
    const rdates:  string[] = recent.reportDate        ?? []
    const docs:    string[] = recent.primaryDocument   ?? []

    const rows: SubmissionRow[] = []
    for (let i = 0; i < accs.length; i++) {
      rows.push({
        accession:       accs[i] ?? '',
        form:            forms[i] ?? '',
        filingDate:      fdates[i] ?? '',
        reportDate:      rdates[i] ?? '',
        primaryDocument: docs[i] ?? '',
      })
    }
    return rows
  } catch (err) {
    dev && console.error('[13F] fetchSubmissions error:', err)
    return []
  }
}

async function findRecent13F(cik: string): Promise<{ latest: SubmissionRow | null; prior: SubmissionRow | null }> {
  const rows = await fetchSubmissions(cik)
  const f13 = rows.filter(r => r.form === '13F-HR' || r.form === '13F-HR/A')
  return { latest: f13[0] ?? null, prior: f13[1] ?? null }
}

// ── Fetch and parse the 13F informationtable XML ──────────────────────────────
async function fetchFilingIndex(cik: string, accession: string): Promise<string[]> {
  // Lists all files in the filing folder; we want the *.xml that's the info table
  try {
    const url = `https://www.sec.gov/Archives/edgar/data/${intCik(cik)}/${stripDashes(accession)}/index.json`
    const res = await fetch(url, {
      headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const json = await res.json()
    return (json?.directory?.item ?? []).map((it: { name: string }) => it.name).filter(Boolean)
  } catch {
    return []
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function pluck(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9]+:)?${tag}>`, 'i')
  const m  = re.exec(xml)
  return m ? decodeXmlEntities(m[1]).trim() : null
}

function parseInfoTableXml(xml: string): InfoTableEntry[] {
  // Match each <infoTable>…</infoTable> block (may be ns-prefixed)
  const blockRe = /<(?:[A-Za-z0-9]+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?infoTable>/g
  const out: InfoTableEntry[] = []
  let m: RegExpExecArray | null

  while ((m = blockRe.exec(xml)) !== null) {
    const body  = m[1]
    const name  = pluck(body, 'nameOfIssuer') ?? ''
    const cusip = pluck(body, 'cusip')        ?? ''
    const valueStr = pluck(body, 'value')     ?? '0'
    const sharesStr = pluck(body, 'sshPrnamt') ?? '0'
    const shareType = pluck(body, 'sshPrnamtType') ?? 'SH'
    const putCall   = pluck(body, 'putCall')

    if (!name || !cusip) continue
    // SEC switched 13F values from ×1000 to whole dollars on 2022-09-30.
    // Heuristic: if max value is small, multiply (we'll fix at aggregate level).
    const value = Number(valueStr)  || 0
    const shares = Number(sharesStr) || 0

    out.push({
      nameOfIssuer: name,
      cusip,
      value,
      shares,
      putCall: putCall === 'Put' ? 'Put' : putCall === 'Call' ? 'Call' : null,
      shareType,
    })
  }

  return out
}

async function fetchFiling(cik: string, sub: SubmissionRow): Promise<ParsedFiling | null> {
  const cacheKey = `f:${cik}:${sub.accession}`
  const hit = filingsCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.data

  const files = await fetchFilingIndex(cik, sub.accession)
  // Prefer files whose name suggests the info table; fall back to any non-primary .xml
  const candidates = files
    .filter(n => n.toLowerCase().endsWith('.xml'))
    .sort((a, b) => {
      const aScore = /infotable|info_table|holdings/i.test(a) ? 0 : /primary|cover|header/i.test(a) ? 2 : 1
      const bScore = /infotable|info_table|holdings/i.test(b) ? 0 : /primary|cover|header/i.test(b) ? 2 : 1
      return aScore - bScore
    })

  for (const fname of candidates) {
    try {
      const fileUrl = `https://www.sec.gov/Archives/edgar/data/${intCik(cik)}/${stripDashes(sub.accession)}/${fname}`
      const res = await fetch(fileUrl, {
        headers: { 'User-Agent': SEC_UA },
        signal:  AbortSignal.timeout(15_000),
      })
      if (!res.ok) continue
      const xml = await res.text()
      if (!/infoTable/i.test(xml)) continue

      const entries = parseInfoTableXml(xml)
      if (entries.length === 0) continue

      // Detect the legacy ×1000 convention: if the report quarter is before
      // 2022-09-30 SEC required values reported in thousands of dollars.
      const reportYear = parseInt(sub.reportDate.slice(0, 4), 10)
      const reportMo   = parseInt(sub.reportDate.slice(5, 7), 10)
      const isLegacyThousands =
        reportYear < 2022 || (reportYear === 2022 && reportMo < 9)

      if (isLegacyThousands) {
        for (const e of entries) e.value = e.value * 1000
      }

      const totalValue = entries.reduce((s, e) => s + e.value, 0)
      const result: ParsedFiling = {
        accession:  sub.accession,
        filingDate: sub.filingDate,
        reportDate: sub.reportDate,
        entries,
        totalValue,
      }

      filingsCache.set(cacheKey, { data: result, expires: Date.now() + TWENTY_FOUR_H })
      return result
    } catch (err) {
      dev && console.error('[13F] file fetch error:', fname, err)
    }
  }

  filingsCache.set(cacheKey, { data: null, expires: Date.now() + 3600_000 })
  return null
}

// ── Build holdings response with QoQ change classification ────────────────────
function buildHoldings(latest: ParsedFiling, prior: ParsedFiling | null): HoldingRow[] {
  const priorByCusip = new Map<string, InfoTableEntry>()
  if (prior) {
    // Same cusip can appear multiple times (different putCall etc). Sum shares.
    for (const e of prior.entries) {
      const ex = priorByCusip.get(e.cusip)
      if (ex) {
        ex.shares += e.shares
        ex.value  += e.value
      } else {
        priorByCusip.set(e.cusip, { ...e })
      }
    }
  }

  // Aggregate latest entries by cusip too (same issuer multiple lines)
  const byCusip = new Map<string, InfoTableEntry & { putCalls: Set<string> }>()
  for (const e of latest.entries) {
    const ex = byCusip.get(e.cusip)
    if (ex) {
      ex.shares += e.shares
      ex.value  += e.value
      if (e.putCall) ex.putCalls.add(e.putCall)
    } else {
      byCusip.set(e.cusip, { ...e, putCalls: new Set(e.putCall ? [e.putCall] : []) })
    }
  }

  const total = latest.totalValue || 1
  const rows: HoldingRow[] = []

  for (const [cusip, agg] of byCusip) {
    const priorEntry = priorByCusip.get(cusip)
    let change: HoldingChange
    if (!prior) {
      change = { shares: 0, value: 0, type: 'unchanged' }
    } else if (!priorEntry) {
      change = { shares: agg.shares, value: agg.value, type: 'new' }
    } else {
      const dShares = agg.shares - priorEntry.shares
      const dValue  = agg.value  - priorEntry.value
      let type: HoldingChange['type']
      if (dShares === 0)      type = 'unchanged'
      else if (dShares > 0)   type = 'increased'
      else                    type = 'decreased'
      change = { shares: dShares, value: dValue, type }
    }

    rows.push({
      cusip,
      name:               agg.nameOfIssuer,
      shares:             agg.shares,
      value:              agg.value,
      percentOfPortfolio: (agg.value / total) * 100,
      putCall:            agg.putCalls.has('Put') ? 'Put' : agg.putCalls.has('Call') ? 'Call' : null,
      change,
    })
  }

  // Add fully-exited positions (prior had them, latest doesn't)
  if (prior) {
    for (const [cusip, p] of priorByCusip) {
      if (byCusip.has(cusip)) continue
      rows.push({
        cusip,
        name:               p.nameOfIssuer,
        shares:             0,
        value:              0,
        percentOfPortfolio: 0,
        putCall:            null,
        change:             { shares: -p.shares, value: -p.value, type: 'exited' },
      })
    }
  }

  rows.sort((a, b) => b.value - a.value)
  return rows
}

// ── Mode 1: holdings for a given institution ──────────────────────────────────
async function fetchHoldingsByInstitution(cik: string): Promise<HoldingsResponse | { error: string }> {
  const cikPadded = padCik(cik)
  const cacheKey  = `h:${cikPadded}`
  const hit = holdingsCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.data

  const { latest, prior } = await findRecent13F(cikPadded)
  if (!latest) return { error: 'No 13F-HR filings found for this CIK' }

  const [latestFiling, priorFiling] = await Promise.all([
    fetchFiling(cikPadded, latest),
    prior ? fetchFiling(cikPadded, prior) : Promise.resolve(null),
  ])

  if (!latestFiling) return { error: 'Failed to parse latest 13F filing' }

  const holdings = buildHoldings(latestFiling, priorFiling)
  const newPositions    = holdings.filter(h => h.change.type === 'new').length
  const exitedPositions = holdings.filter(h => h.change.type === 'exited').length

  const response: HoldingsResponse = {
    institution: {
      name: INSTITUTION_BY_CIK[cikPadded] ?? `CIK ${cikPadded}`,
      cik:  cikPadded,
    },
    filingDate:          latestFiling.filingDate,
    reportDate:          latestFiling.reportDate,
    priorReportDate:     priorFiling?.reportDate ?? null,
    holdings,
    totalPortfolioValue: latestFiling.totalValue,
    newPositions,
    exitedPositions,
    nextFilingDue:       nextFilingDueAfter(latestFiling.reportDate),
    source:              'SEC EDGAR 13F-HR',
    lastUpdated:         new Date().toISOString(),
  }

  holdingsCache.set(cacheKey, { data: response, expires: Date.now() + TWENTY_FOUR_H })
  return response
}

// ── Mode 2: which major institutions hold a given ticker ──────────────────────
// Strategy: we don't have a CUSIP→ticker map. Match by company-name keywords
// derived from the SEC company_tickers.json file (ticker → official name).

let companyNamesByTicker: Map<string, string> | null = null
let companyNamesExpires = 0

async function getCompanyNames(): Promise<Map<string, string>> {
  if (companyNamesByTicker && Date.now() < companyNamesExpires) return companyNamesByTicker
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) return companyNamesByTicker ?? new Map()
    const raw = await res.json() as Record<string, { ticker: string; title: string }>
    const map = new Map<string, string>()
    for (const e of Object.values(raw)) {
      if (e.ticker && e.title) map.set(e.ticker.toUpperCase(), e.title.toUpperCase())
    }
    companyNamesByTicker = map
    companyNamesExpires  = Date.now() + 4 * 3600_000
    return map
  } catch {
    return companyNamesByTicker ?? new Map()
  }
}

// Normalize "APPLE INC.", "APPLE INC", "APPLE-INC" → "APPLE"
function normalizeIssuerName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[.,'"&\/-]/g, ' ')
    .replace(/\b(INC|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|HOLDINGS|GROUP|PLC|TRUST|FUND|CLASS [A-Z]|CL [A-Z]|COM)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchHoldingsByTicker(ticker: string): Promise<TickerLookup | { error: string }> {
  const upper = ticker.toUpperCase()
  const cacheKey = `t:${upper}`
  const hit = tickerByQuery.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.data

  const names = await getCompanyNames()
  const officialName = names.get(upper)
  if (!officialName) return { error: `Ticker "${upper}" not found in SEC company database` }

  const needle = normalizeIssuerName(officialName)
  if (needle.length < 2) return { error: `Could not derive search key from "${officialName}"` }

  // Fetch each major institution's latest holdings concurrently
  const results = await Promise.all(
    MAJOR_INSTITUTIONS.map(async inst => {
      const data = await fetchHoldingsByInstitution(inst.cik)
      if ('error' in data) return null
      const matches = data.holdings.filter(h => {
        if (h.change.type === 'exited') return false
        const norm = normalizeIssuerName(h.name)
        return norm.startsWith(needle) || needle.startsWith(norm) || norm === needle
      })
      if (matches.length === 0) return null
      // Pick the largest matching position (some institutions hold multiple share classes)
      const top = matches.sort((a, b) => b.value - a.value)[0]
      return {
        institution: data.institution,
        filingDate:  data.filingDate,
        shares:      top.shares,
        value:       top.value,
        percentOfPortfolio: top.percentOfPortfolio,
        change:      top.change,
      }
    }),
  )

  const appearsIn = results.filter((r): r is NonNullable<typeof r> => r !== null)
                           .sort((a, b) => b.value - a.value)

  const out: TickerLookup = {
    ticker: upper,
    cusip:  null,
    name:   officialName,
    appearsIn,
  }
  tickerByQuery.set(cacheKey, { data: out, expires: Date.now() + TWENTY_FOUR_H })
  return out
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const cik    = searchParams.get('cik')?.trim()
  const ticker = searchParams.get('ticker')?.trim()

  if (!cik && !ticker) {
    return NextResponse.json({
      institutions: MAJOR_INSTITUTIONS,
      hint:         'Pass ?cik=0001067983 or ?ticker=AAPL',
    })
  }

  if (cik) {
    const result = await fetchHoldingsByInstitution(cik)
    if ('error' in result) {
      return NextResponse.json(result, { status: 404 })
    }
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' },
    })
  }

  // ticker mode
  const result = await fetchHoldingsByTicker(ticker!)
  if ('error' in result) {
    return NextResponse.json(result, { status: 404 })
  }
  return NextResponse.json(result, {
    headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' },
  })
}
