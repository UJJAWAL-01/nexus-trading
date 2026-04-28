// src/app/api/sec-filings/route.ts
// SEC filing alerts — structured parsing, zero AI tokens.
//   GET ?ticker=AAPL&types=8-K,S-1,13D&limit=10
//
// For every filing we:
//   8-K  → detect which items are filed (2.02 = Earnings, 5.02 = Leadership etc.)
//           try to fetch Exhibit 99.1 press-release text (400 chars)
//           fall back to excerpt from the main document
//   13D/G → regex-extract filer name, ownership %, share count
//   S-1   → extract offering headline from document
//   10-K/Q → section headings + key financials line from doc header

import { NextRequest, NextResponse } from 'next/server'

const dev = process.env.NODE_ENV !== 'production'
const SEC_UA = 'NEXUS Trading Intelligence nexus-app/1.0 contact@nexustrading.app'
const ONE_HOUR   = 3_600_000
const FILING_TTL = 24 * ONE_HOUR

// ── Caches ────────────────────────────────────────────────────────────────────
const submissionsCache = new Map<string, { rows: SubmissionRow[]; expires: number }>()
const parsedCache      = new Map<string, { data: ParsedFiling;    expires: number }>()
const responseCache    = new Map<string, { data: SecFilingsResponse; expires: number }>()

// ── 8-K item registry ─────────────────────────────────────────────────────────
// Importance: 'high' items bubble to the top of the badge list
const ITEM_META: Record<string, { label: string; importance: 'high' | 'medium' | 'low' }> = {
  '1.01': { label: 'New Material Agreement',      importance: 'medium' },
  '1.02': { label: 'Agreement Terminated',        importance: 'medium' },
  '1.03': { label: 'Bankruptcy/Receivership',     importance: 'high'   },
  '2.01': { label: 'Acquisition / Disposal',      importance: 'high'   },
  '2.02': { label: 'Earnings Results',            importance: 'high'   },
  '2.03': { label: 'Off-Balance Sheet',           importance: 'low'    },
  '2.04': { label: 'Triggering Events',           importance: 'medium' },
  '2.05': { label: 'Asset Impairment',            importance: 'medium' },
  '2.06': { label: 'Material Impairment',         importance: 'medium' },
  '3.01': { label: 'Delisting Risk',              importance: 'high'   },
  '3.02': { label: 'Unregistered Securities',     importance: 'low'    },
  '4.01': { label: 'Auditor Changed',             importance: 'medium' },
  '4.02': { label: 'Restatement Risk',            importance: 'high'   },
  '5.01': { label: 'Change of Control',           importance: 'high'   },
  '5.02': { label: 'Leadership Change',           importance: 'high'   },
  '5.03': { label: 'Charter Amendment',           importance: 'low'    },
  '5.05': { label: 'Code of Ethics Change',       importance: 'low'    },
  '5.07': { label: 'Shareholder Vote',            importance: 'medium' },
  '5.08': { label: 'Director Nominations',        importance: 'low'    },
  '6.01': { label: 'ABS Material',               importance: 'low'    },
  '7.01': { label: 'Reg FD Disclosure',           importance: 'medium' },
  '8.01': { label: 'Other Material Events',       importance: 'medium' },
  '9.01': { label: 'Financial Statements & Exhibits', importance: 'low' },
}

// ── Types ─────────────────────────────────────────────────────────────────────
const ALLOWED_TYPES = ['8-K', 'S-1', '13D', '13G', '10-K', '10-Q'] as const
type FormType = (typeof ALLOWED_TYPES)[number]

interface SubmissionRow {
  accession:       string
  form:            string
  filingDate:      string
  reportDate:      string
  primaryDocument: string
}

interface FilingItem8K {
  code:       string   // e.g. '2.02'
  label:      string   // e.g. 'Earnings Results'
  importance: 'high' | 'medium' | 'low'
}

interface Ownership13D {
  filerName:    string | null
  pctOwned:     number | null
  sharesHeld:   number | null
  sharesAcquired: number | null
  purpose:      string | null
}

interface ParsedFiling {
  formType:     string
  filingDate:   string
  accession:    string
  documentUrl:  string
  fullTextUrl:  string
  excerpt:      string | null   // ≤500 chars, human-readable
  items8K:      FilingItem8K[]  // only populated for 8-K
  ownership13D: Ownership13D | null  // only for 13D/13G
  exhibitSource: boolean        // true if excerpt came from Exhibit 99.1
}

interface SecFilingsResponse {
  ticker:      string
  companyName: string
  cik:         string
  filings:     ParsedFiling[]
  lastUpdated: string
  error?:      string
}

// ── CIK resolution ────────────────────────────────────────────────────────────
let tickerMap: Record<string, { cik: string; title: string }> | null = null
let tickerExpiry = 0

async function getTickerMap(): Promise<Record<string, { cik: string; title: string }>> {
  if (tickerMap && Date.now() < tickerExpiry) return tickerMap
  try {
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) return tickerMap ?? {}
    const raw = await res.json() as Record<string, { cik_str: number | string; ticker: string; title: string }>
    const map: Record<string, { cik: string; title: string }> = {}
    for (const e of Object.values(raw)) {
      if (!e.ticker || e.cik_str == null) continue
      map[e.ticker.toUpperCase()] = { cik: String(e.cik_str).padStart(10, '0'), title: e.title }
    }
    tickerMap    = map
    tickerExpiry = Date.now() + 4 * ONE_HOUR
    return map
  } catch { return tickerMap ?? {} }
}

// ── Submissions list ──────────────────────────────────────────────────────────
async function fetchSubmissions(cik: string): Promise<SubmissionRow[]> {
  const hit = submissionsCache.get(cik)
  if (hit && hit.expires > Date.now()) return hit.rows
  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(12_000),
    })
    if (!res.ok) return []
    const json  = await res.json()
    const r     = json?.filings?.recent
    if (!r) return []
    const accs:   string[] = r.accessionNumber  ?? []
    const forms:  string[] = r.form             ?? []
    const fdates: string[] = r.filingDate       ?? []
    const rdates: string[] = r.reportDate       ?? []
    const docs:   string[] = r.primaryDocument  ?? []
    const rows: SubmissionRow[] = accs.map((a, i) => ({
      accession: a, form: forms[i] ?? '', filingDate: fdates[i] ?? '',
      reportDate: rdates[i] ?? '', primaryDocument: docs[i] ?? '',
    }))
    submissionsCache.set(cik, { rows, expires: Date.now() + ONE_HOUR })
    return rows
  } catch (err) {
    dev && console.error('[sec-filings] fetchSubmissions:', err)
    return []
  }
}

// ── Low-level helpers ─────────────────────────────────────────────────────────
function intCik(cik: string) { return String(parseInt(cik, 10)) }
function stripDashes(s: string) { return s.replace(/-/g, '') }

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi,   ' ')
    .replace(/<[^>]+>/g, ' ')
    // Numeric entities first (covers smart quotes &#8220; &#8221; &#8217;, nbsp &#160;, etc.)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g,         (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    // Named entities
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s{2,}/g, ' ').trim()
}

function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10FFFF) return ''
  // Map nbsp and similar zero-width / control to plain space
  if (cp === 160 || cp === 8203 || cp === 8204 || cp === 8205 || cp === 65279) return ' '
  try { return String.fromCodePoint(cp) } catch { return '' }
}

async function fetchText(url: string, maxChars = 8_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': SEC_UA },
      signal:  AbortSignal.timeout(12_000),
    })
    if (!res.ok) return null
    const raw = await res.text()
    return stripHtml(raw).slice(0, maxChars)
  } catch { return null }
}

async function fetchFilingIndex(cik: string, accession: string): Promise<string[]> {
  try {
    const url = `https://www.sec.gov/Archives/edgar/data/${intCik(cik)}/${stripDashes(accession)}/index.json`
    const res = await fetch(url, {
      headers: { 'User-Agent': SEC_UA, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    const json = await res.json()
    return (json?.directory?.item ?? []).map((it: { name: string }) => it.name).filter(Boolean)
  } catch { return [] }
}

// ── 8-K: detect filed items ────────────────────────────────────────────────────
function extract8KItems(text: string): FilingItem8K[] {
  // Matches "Item 2.02", "ITEM 5.02", "Item\n2.02" etc.
  const re = /item\s+(\d+\.\d{2})/gi
  const found = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const code = m[1].replace(/^0+/, '') // strip leading zeros: "02.02" → "2.02"
    if (ITEM_META[code]) found.add(code)
  }
  // Sort: high importance first, then by code
  return [...found]
    .sort((a, b) => {
      const ia = ITEM_META[a]?.importance === 'high' ? 0 : ITEM_META[a]?.importance === 'medium' ? 1 : 2
      const ib = ITEM_META[b]?.importance === 'high' ? 0 : ITEM_META[b]?.importance === 'medium' ? 1 : 2
      return ia !== ib ? ia - ib : a.localeCompare(b)
    })
    .map(code => ({ code, label: ITEM_META[code]!.label, importance: ITEM_META[code]!.importance }))
}

// ── 8-K: extract excerpt from the most important item section ─────────────────
function extractItemExcerpt(text: string, items: FilingItem8K[]): string | null {
  // Skip 9.01 (just "exhibits"), prefer the highest-importance item
  const target = items.find(i => i.code !== '9.01') ?? items[0]
  if (!target) return null

  const re = new RegExp(`item\\s+${target.code.replace('.', '\\.')}[^a-z0-9]{0,60}`, 'i')
  const pos = text.search(re)
  if (pos === -1) return null

  // Skip past the item header (up to 120 chars), then take 450 chars of content
  const headerEnd = text.indexOf(' ', pos + 15)
  const start = headerEnd > pos ? Math.min(headerEnd, pos + 120) : pos + 80
  return text.slice(start, start + 450).trim() || null
}

// ── 8-K: try to get Exhibit 99.1 press release ────────────────────────────────
async function fetchExhibit99(cik: string, accession: string): Promise<string | null> {
  const files = await fetchFilingIndex(cik, accession)
  // Look for exhibit 99, 99-1, ex99, ex-99 etc.
  const pr = files.find(n =>
    /^(ex|exhibit)[\s\-_]*99[\s\-_]*1?[^0-9]/i.test(n) && /\.(htm|html|txt)$/i.test(n)
  ) ?? files.find(n => /99/.test(n) && /\.(htm|html|txt)$/i.test(n))
  if (!pr) return null

  const url = `https://www.sec.gov/Archives/edgar/data/${intCik(cik)}/${stripDashes(accession)}/${pr}`
  return fetchText(url, 600)
}

// ── 13D/13G: parse structured fields ─────────────────────────────────────────
function extract13DInfo(text: string): Ownership13D {
  // Ownership percentage — look for "XX.X% of the outstanding" or "aggregate of X%"
  const pctRe = /(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:of the|of outstanding|of the outstanding|of all)/i
  const pctM  = pctRe.exec(text)
  const pctOwned = pctM ? parseFloat(pctM[1]) : null

  // Shares held — "X,XXX,XXX shares"
  const sharesRe = /(\d[\d,]+)\s*shares?\s*(?:of\s+(?:common\s+)?stock|of\s+the)/i
  const sharesM  = sharesRe.exec(text)
  const sharesHeld = sharesM ? parseInt(sharesM[1].replace(/,/g, ''), 10) : null

  // Shares acquired in this transaction
  const acqRe = /(?:acquired|purchased)\s+(?:an\s+aggregate\s+of\s+)?(\d[\d,]+)\s*shares?/i
  const acqM  = acqRe.exec(text)
  const sharesAcquired = acqM ? parseInt(acqM[1].replace(/,/g, ''), 10) : null

  // Filer name — usually in "Reporting Person(s): ..." or first prominent proper noun
  const filerRe = /(?:reporting\s+person[s]?\s*(?:is|are|:)\s*)([A-Z][A-Za-z\s,\.]+?)(?:\n|\.|\r|,\s+a\s)/
  const filerM  = filerRe.exec(text)
  const filerName = filerM ? filerM[1].trim().replace(/\s+/g, ' ') : null

  // Purpose — passive investment vs active
  const purposeText = text.toLowerCase()
  const purpose =
    purposeText.includes('purpose of acquiring control') ? 'Acquiring control' :
    purposeText.includes('for investment purposes') ? 'Passive investment' :
    purposeText.includes('activist') ? 'Activist position' :
    purposeText.includes('tender offer') ? 'Tender offer' : null

  return { filerName, pctOwned, sharesHeld, sharesAcquired, purpose }
}

// ── S-1: extract offering headline ────────────────────────────────────────────
function extractS1Info(text: string): string | null {
  // Try to find proposed offering size
  const offeringRe = /\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion)?\s*(?:aggregate\s+)?(?:maximum\s+)?(?:offering|proceeds)/i
  const om = offeringRe.exec(text)
  if (om) {
    const amt = om[1].replace(/,/g, '')
    const unit = om[2]?.toLowerCase() === 'billion' ? 'B' : om[2]?.toLowerCase() === 'million' ? 'M' : ''
    return `Proposed offering: $${amt}${unit}`
  }
  // Fall back to first meaningful sentence of the prospectus summary
  const summaryRe = /prospectus\s+summary[\s\S]{0,200}/i
  const sm = summaryRe.exec(text)
  if (sm) return sm[0].slice(sm[0].indexOf(' ') + 1, 300).trim()
  return null
}

// ── Parse a single filing ─────────────────────────────────────────────────────
async function parseFiling(
  cik: string,
  row: SubmissionRow,
): Promise<ParsedFiling> {
  const cacheKey = `p:${cik}:${row.accession}`
  const hit = parsedCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.data

  const accNoDash  = stripDashes(row.accession)
  const documentUrl = row.primaryDocument
    ? `https://www.sec.gov/Archives/edgar/data/${intCik(cik)}/${accNoDash}/${row.primaryDocument}`
    : ''
  const fullTextUrl = `https://www.sec.gov/Archives/edgar/data/${intCik(cik)}/${accNoDash}/${row.accession}-index.htm`

  let excerpt:     string | null = null
  let items8K:     FilingItem8K[] = []
  let ownership13D: Ownership13D | null = null
  let exhibitSource = false

  const form = row.form.replace('/A', '') // treat amendments same as originals

  if (form === '8-K') {
    const text = documentUrl ? await fetchText(documentUrl) : null
    if (text) {
      items8K = extract8KItems(text)
      // For earnings (2.02) or material events, try Exhibit 99.1 first
      const hasEarnings = items8K.some(i => i.code === '2.02')
      const hasHighItem = items8K.some(i => i.importance === 'high')
      if (hasEarnings || hasHighItem) {
        const ex99 = await fetchExhibit99(cik, row.accession)
        if (ex99 && ex99.length > 60) {
          excerpt = ex99.slice(0, 480).trim()
          exhibitSource = true
        }
      }
      if (!excerpt) excerpt = extractItemExcerpt(text, items8K)
    }
  } else if (form === '13D' || form === '13G') {
    const text = documentUrl ? await fetchText(documentUrl) : null
    if (text) {
      ownership13D = extract13DInfo(text)
      // Build a readable excerpt from the extracted fields
      if (ownership13D.pctOwned !== null || ownership13D.filerName) {
        const parts: string[] = []
        if (ownership13D.filerName) parts.push(`Filer: ${ownership13D.filerName}`)
        if (ownership13D.pctOwned !== null) parts.push(`${ownership13D.pctOwned}% of outstanding shares`)
        if (ownership13D.sharesHeld !== null) parts.push(`${ownership13D.sharesHeld.toLocaleString('en-US')} shares held`)
        if (ownership13D.sharesAcquired !== null) parts.push(`${ownership13D.sharesAcquired.toLocaleString('en-US')} acquired in this transaction`)
        if (ownership13D.purpose) parts.push(`Purpose: ${ownership13D.purpose}`)
        excerpt = parts.join(' · ')
      }
    }
  } else if (form === 'S-1') {
    const text = documentUrl ? await fetchText(documentUrl) : null
    if (text) excerpt = extractS1Info(text)
  } else if (form === '10-K' || form === '10-Q') {
    const text = documentUrl ? await fetchText(documentUrl, 3_000) : null
    if (text) {
      // Grab the first substantive sentence after the cover page
      const match = /(?:For the|Annual|Quarterly)\s+(?:fiscal|period)\s+(?:year|ended|quarter)[^.]{0,200}\./i.exec(text)
      excerpt = match ? match[0].trim() : text.slice(0, 300).trim()
    }
  }

  const result: ParsedFiling = {
    formType:     row.form,
    filingDate:   row.filingDate,
    accession:    row.accession,
    documentUrl,
    fullTextUrl,
    excerpt,
    items8K,
    ownership13D,
    exhibitSource,
  }

  parsedCache.set(cacheKey, { data: result, expires: Date.now() + FILING_TTL })
  return result
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tickerRaw = searchParams.get('ticker')?.trim()
  if (!tickerRaw) return NextResponse.json({ error: 'ticker required' }, { status: 400 })

  const ticker = tickerRaw.toUpperCase()
  const limit  = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10) || 10))
  const typesParam = (searchParams.get('types') ?? '8-K,S-1,13D')
    .split(',').map(s => s.trim().toUpperCase())
  const types = typesParam.filter((t): t is FormType => (ALLOWED_TYPES as readonly string[]).includes(t))
  if (types.length === 0) return NextResponse.json({ error: 'invalid types' }, { status: 400 })

  const map   = await getTickerMap()
  const entry = map[ticker]
  if (!entry) return NextResponse.json({ error: `Ticker "${ticker}" not in SEC database` }, { status: 404 })

  const cacheKey = `r:${ticker}:${types.sort().join(',')}:${limit}`
  const hit = responseCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) {
    return NextResponse.json(hit.data, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    })
  }

  const rows    = await fetchSubmissions(entry.cik)
  const wanted  = rows
    .filter(r => types.some(t => r.form === t || r.form === `${t}/A`))
    .slice(0, limit)

  const filings = await Promise.all(wanted.map(row => parseFiling(entry.cik, row)))

  const data: SecFilingsResponse = {
    ticker,
    companyName: entry.title,
    cik: entry.cik,
    filings,
    lastUpdated: new Date().toISOString(),
  }

  responseCache.set(cacheKey, { data, expires: Date.now() + ONE_HOUR })
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
  })
}
