// scripts/extract-supply-chain.ts
//
// FREE-PROVIDER supply-chain extractor.
// US tickers   → SEC EDGAR 10-K Item 1/1A
// IN tickers   → Wikipedia article (NSE/BSE annual reports are PDFs on inconsistent URLs)
// AI provider  → Grok (xAI free tier) primary, Gemini Flash (free tier) fallback.
//                NEVER calls a paid API. End-users never run this — output is committed
//                to public/data/supply-chain.json and refreshed by maintainer quarterly.
//
// USAGE:
//   GROK_API_KEY=xai-... npx tsx scripts/extract-supply-chain.ts --us-all --write
//   GEMINI_API_KEY=AIza... npx tsx scripts/extract-supply-chain.ts --in-all --write
//   npx tsx scripts/extract-supply-chain.ts AAPL NVDA RELIANCE.NS --write --dry
//
// FLAGS:
//   --us-all      Process every ticker in scripts/sp500.txt
//   --in-all      Process every ticker in scripts/nifty50.json
//   --write       Merge results into public/data/supply-chain.json
//   --dry         Print what would be sent to AI; do not call the API
//
// FREE TIERS:
//   Grok:   $25/mo credits at console.x.ai (more than enough for ~550 companies)
//   Gemini: 15 req/min free at aistudio.google.com
//
// HONEST LIMITS:
//   * Free models (Grok-3-mini, Gemini-Flash) are less accurate than paid frontier
//     models. Each edge ships with sourceUrl — spot-check before merging large batches.
//   * Wikipedia coverage of supply chains varies — some Indian companies will yield
//     few or no edges. That's a data-quality limit, not a script bug.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ── CLI ──────────────────────────────────────────────────────────────────────
const args     = process.argv.slice(2)
const writeOut = args.includes('--write')
const dryRun   = args.includes('--dry')
const usAll    = args.includes('--us-all')
const inAll    = args.includes('--in-all')

const SCRIPTS_DIR = resolve(process.cwd(), 'scripts')
const DATA_FILE   = resolve(process.cwd(), 'public/data/supply-chain.json')

interface NiftyEntry { ticker: string; name: string; wikiTitle: string }

const NIFTY50: NiftyEntry[] = JSON.parse(
  readFileSync(resolve(SCRIPTS_DIR, 'nifty50.json'), 'utf8')
) as NiftyEntry[]

const SP500: string[] = readFileSync(resolve(SCRIPTS_DIR, 'sp500.txt'), 'utf8')
  .split('\n').map(s => s.trim()).filter(Boolean)
  .filter((v, i, a) => a.indexOf(v) === i)  // dedupe

// Build the work queue: explicit tickers from args + --us-all + --in-all
type Job = { ticker: string; region: 'us' | 'in'; wikiTitle?: string; name?: string }
const explicit = args.filter(a => !a.startsWith('--'))
const queue: Job[] = []

for (const t of explicit) {
  const upper = t.toUpperCase()
  if (NIFTY50.find(n => n.ticker === upper)) {
    const e = NIFTY50.find(n => n.ticker === upper)!
    queue.push({ ticker: upper, region: 'in', wikiTitle: e.wikiTitle, name: e.name })
  } else {
    queue.push({ ticker: upper, region: 'us' })
  }
}
if (usAll) for (const t of SP500) queue.push({ ticker: t, region: 'us' })
if (inAll) for (const e of NIFTY50) queue.push({ ticker: e.ticker, region: 'in', wikiTitle: e.wikiTitle, name: e.name })

// Dedupe queue
const seen = new Set<string>()
const dedup = queue.filter(j => seen.has(j.ticker) ? false : (seen.add(j.ticker), true))

if (dedup.length === 0) {
  console.error('Usage: npx tsx scripts/extract-supply-chain.ts [TICKERS] [--us-all] [--in-all] [--write] [--dry]')
  process.exit(1)
}

console.error(`Queued ${dedup.length} tickers (${dedup.filter(d => d.region === 'us').length} US · ${dedup.filter(d => d.region === 'in').length} IN)`)

// ── AI provider chain (free only) ────────────────────────────────────────────
const GROK_KEY   = process.env.GROK_API_KEY
const GEMINI_KEY = process.env.GEMINI_API_KEY

if (!dryRun && !GROK_KEY && !GEMINI_KEY) {
  console.error('ERROR: set GROK_API_KEY or GEMINI_API_KEY (both are free-tier).')
  console.error('  Grok:   https://console.x.ai     ($25/mo free credits)')
  console.error('  Gemini: https://aistudio.google.com   (15 req/min free)')
  process.exit(1)
}

async function callGrok(systemPrompt: string, userPrompt: string): Promise<string | null> {
  if (!GROK_KEY) return null
  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROK_KEY}` },
      body: JSON.stringify({
        model:       'grok-3-mini',
        messages:    [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens:  4000,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) { console.error(`  Grok ${res.status}: ${(await res.text()).slice(0, 200)}`); return null }
    const j = await res.json() as { choices: { message: { content: string } }[] }
    return j.choices?.[0]?.message?.content ?? null
  } catch (e) { console.error('  Grok error:', e); return null }
}

async function callGemini(systemPrompt: string, userPrompt: string): Promise<string | null> {
  if (!GEMINI_KEY) return null
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n---\n\n${userPrompt}` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) { console.error(`  Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`); return null }
    const j = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] }
    return j.candidates?.[0]?.content?.parts?.[0]?.text ?? null
  } catch (e) { console.error('  Gemini error:', e); return null }
}

async function callAI(systemPrompt: string, userPrompt: string): Promise<string | null> {
  return (await callGrok(systemPrompt, userPrompt)) ?? (await callGemini(systemPrompt, userPrompt))
}

// ── SEC EDGAR (US tickers) ───────────────────────────────────────────────────
const SEC_HEADERS = {
  'User-Agent': `nexus-trading-extractor ${process.env.CONTACT_EMAIL ?? 'contact@example.com'}`,
}

let cikMap: Record<string, string> | null = null
async function loadCikMap(): Promise<Record<string, string>> {
  if (cikMap) return cikMap
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: SEC_HEADERS })
  if (!res.ok) throw new Error(`SEC tickers fetch failed: ${res.status}`)
  const json = await res.json() as Record<string, { cik_str: number; ticker: string }>
  const map: Record<string, string> = {}
  for (const v of Object.values(json)) map[v.ticker] = String(v.cik_str).padStart(10, '0')
  cikMap = map
  return map
}

interface FilingRef { accessionNumber: string; primaryDocument: string; filingDate: string }

async function getLatest10K(cik: string): Promise<FilingRef | null> {
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: SEC_HEADERS })
  if (!res.ok) return null
  const json = await res.json()
  const r = json?.filings?.recent
  if (!r) return null
  for (let i = 0; i < r.form.length; i++) {
    if (r.form[i] === '10-K') {
      return { accessionNumber: r.accessionNumber[i], primaryDocument: r.primaryDocument[i], filingDate: r.filingDate[i] }
    }
  }
  return null
}

async function fetchFilingHTML(cik: string, ref: FilingRef): Promise<{ text: string; sourceUrl: string }> {
  const cikInt   = String(parseInt(cik, 10))
  const accNoDash = ref.accessionNumber.replace(/-/g, '')
  const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}/${ref.primaryDocument}`
  const res = await fetch(sourceUrl, { headers: SEC_HEADERS })
  if (!res.ok) throw new Error(`Filing fetch ${res.status}: ${sourceUrl}`)
  return { text: await res.text(), sourceUrl }
}

function isolateBusinessSection(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ').trim()
  const lower = stripped.toLowerCase()
  const item1  = Math.max(lower.indexOf('item 1.'), lower.indexOf('item 1 '))
  const item2  = lower.indexOf('item 2', item1 + 1000)
  if (item1 < 0) return stripped.slice(0, 60_000)
  const end = item2 > 0 ? item2 : Math.min(item1 + 60_000, stripped.length)
  return stripped.slice(item1, end).slice(0, 60_000)
}

// ── Wikipedia (Indian tickers) ───────────────────────────────────────────────
async function fetchWikipediaText(title: string): Promise<{ text: string; sourceUrl: string } | null> {
  const sourceUrl = `https://en.wikipedia.org/wiki/${title}`
  const apiUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&titles=${title}&prop=extracts&explaintext=1&redirects=1`
  try {
    const res = await fetch(apiUrl, { headers: { 'User-Agent': 'nexus-trading-extractor' } })
    if (!res.ok) return null
    const json = await res.json() as { query: { pages: Record<string, { extract?: string }> } }
    const pages = json.query?.pages
    if (!pages) return null
    const page = Object.values(pages)[0]
    const extract = page?.extract ?? ''
    if (extract.length < 500) return null  // article too thin to be useful
    return { text: extract.slice(0, 60_000), sourceUrl }
  } catch (e) { console.error('  Wikipedia error:', e); return null }
}

// ── Extraction prompts ───────────────────────────────────────────────────────
const SYSTEM_US = `You extract supply-chain edges from a US public company's 10-K filing.
Return STRICT JSON only — an object with an "edges" array. Each edge MUST cite a verbatim quote from the input text.
A "supplier" supplies the subject company; a "customer" buys from the subject company.

Rules:
- Only include edges with a named counterparty company. NEVER guess. NEVER infer.
- If the filing anonymizes a customer ("Customer A is 12% of revenue"), emit role="customer", name="ANON-A", revenuePct=12, and the verbatim quote.
- Map well-known company names to widely-used tickers (TSMC=TSM, Foxconn=2317.TW, Samsung Electronics=005930.KS). If you are not sure of the ticker, leave ticker=null and provide the company name string.
- Confidence: "high" if a specific named company has a quantified relationship; "medium" if named without a quantified percentage; "low" otherwise.
- Skip generic mentions like "various customers" or "third-party suppliers".

Output schema:
{ "edges": [
  { "ticker": string|null, "name": string, "role": "supplier"|"customer",
    "category": string, "evidence": string, "revenuePct": number|null,
    "confidence": "high"|"medium"|"low" } ] }`

const SYSTEM_IN = `You extract supply-chain edges for an Indian (NSE-listed) public company from its Wikipedia article.
Return STRICT JSON only — an object with an "edges" array. Each edge MUST cite a verbatim quote from the input text.
A "supplier" supplies the subject company; a "customer" buys from the subject company. "ownership" means parent or subsidiary.

Rules:
- Only include edges with a named counterparty company. NEVER guess. NEVER infer.
- Prefer tickers in the form .NS for Indian (e.g., TATASTEEL.NS), or local exchange suffix for foreign (e.g., 7269.T for Suzuki, UL for Unilever PLC ADR).
- If unsure of the ticker, leave ticker=null with the name string.
- Confidence: "high" only if the relationship is explicitly stated as a major supplier / customer / parent in the article; "medium" if mentioned in context; "low" if relationship is implied.
- Include parent/subsidiary edges (e.g., "Suzuki Motor Corp owns 58.19% of Maruti Suzuki India") as role="parent" or role="subsidiary".

Output schema:
{ "edges": [
  { "ticker": string|null, "name": string, "role": "supplier"|"customer"|"parent"|"subsidiary",
    "category": string, "evidence": string, "revenuePct": number|null, "stakePct": number|null,
    "confidence": "high"|"medium"|"low" } ] }`

interface ExtractedEdge {
  ticker: string | null; name: string
  role: 'supplier' | 'customer' | 'parent' | 'subsidiary'
  category: string; evidence: string
  revenuePct: number | null; stakePct?: number | null
  confidence: 'high' | 'medium' | 'low'
}

function parseEdgesFromAI(text: string): ExtractedEdge[] {
  // Tolerate code-fenced JSON, trailing prose, etc.
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return []
  try {
    const parsed = JSON.parse(m[0]) as { edges?: ExtractedEdge[] }
    return parsed.edges ?? []
  } catch { return [] }
}

// ── Convert to canonical supply-chain.json schema ────────────────────────────
type CanonType = 'supply' | 'ownership'
interface CanonicalEdge {
  supplier: string; customer: string
  type: CanonType
  category: string; evidence: string
  sourceUrl: string; sourceType: string; sourceDate: string
  revenuePct: number | null; stakePct?: number | null
  confidence: 'high' | 'medium' | 'low'
}

function toCanonical(
  subject: string, edges: ExtractedEdge[],
  sourceUrl: string, sourceType: string, filingDate: string,
): CanonicalEdge[] {
  return edges
    .filter(e => (e.ticker || e.name) && e.evidence)
    .map(e => {
      const counter = e.ticker ?? e.name
      let supplier = subject, customer = subject, type: CanonType = 'supply'
      switch (e.role) {
        case 'supplier':   supplier = counter; customer = subject; type = 'supply'; break
        case 'customer':   supplier = subject; customer = counter; type = 'supply'; break
        case 'parent':     supplier = counter; customer = subject; type = 'ownership'; break
        case 'subsidiary': supplier = subject; customer = counter; type = 'ownership'; break
      }
      return {
        supplier, customer, type,
        category: e.category, evidence: e.evidence,
        sourceUrl, sourceType, sourceDate: filingDate,
        revenuePct: e.revenuePct ?? null,
        stakePct:   e.stakePct  ?? null,
        confidence: e.confidence,
      }
    })
}

// ── Per-ticker pipelines ─────────────────────────────────────────────────────
async function processUS(ticker: string): Promise<CanonicalEdge[]> {
  console.error(`\n[${ticker}] (US) resolving CIK…`)
  const ciks = await loadCikMap()
  const cik  = ciks[ticker]
  if (!cik) { console.error(`  no CIK match — skipping`); return [] }

  console.error(`  fetching latest 10-K…`)
  const ref = await getLatest10K(cik)
  if (!ref) { console.error(`  no 10-K found`); return [] }

  console.error(`  downloading filing (${ref.filingDate})…`)
  const { text: html, sourceUrl } = await fetchFilingHTML(cik, ref)
  const text = isolateBusinessSection(html)
  console.error(`  isolated ${text.length} chars from Item 1`)

  if (dryRun) {
    console.log(`\n=== DRY ${ticker} ===\n${sourceUrl}\n${text.slice(0, 600)}\n...`)
    return []
  }

  console.error(`  calling AI…`)
  const aiText = await callAI(SYSTEM_US, `Subject: ${ticker}\n\n10-K Item 1 excerpt:\n"""\n${text}\n"""\n\nReturn the JSON only.`)
  if (!aiText) { console.error(`  AI returned nothing`); return [] }
  const edges = parseEdgesFromAI(aiText)
  console.error(`  AI returned ${edges.length} edges`)
  return toCanonical(ticker, edges, sourceUrl, '10-K', ref.filingDate)
}

async function processIN(ticker: string, wikiTitle: string): Promise<CanonicalEdge[]> {
  console.error(`\n[${ticker}] (IN) fetching Wikipedia: ${wikiTitle}`)
  const wiki = await fetchWikipediaText(wikiTitle)
  if (!wiki) { console.error(`  Wikipedia article too thin or missing`); return [] }
  console.error(`  isolated ${wiki.text.length} chars`)

  if (dryRun) {
    console.log(`\n=== DRY ${ticker} ===\n${wiki.sourceUrl}\n${wiki.text.slice(0, 600)}\n...`)
    return []
  }

  console.error(`  calling AI…`)
  const aiText = await callAI(SYSTEM_IN, `Subject: ${ticker}\n\nWikipedia article excerpt:\n"""\n${wiki.text}\n"""\n\nReturn the JSON only.`)
  if (!aiText) { console.error(`  AI returned nothing`); return [] }
  const edges = parseEdgesFromAI(aiText)
  console.error(`  AI returned ${edges.length} edges`)
  return toCanonical(ticker, edges, wiki.sourceUrl, 'wikipedia', new Date().toISOString().slice(0, 10))
}

// ── Merge into supply-chain.json ─────────────────────────────────────────────
function mergeEdges(newEdges: CanonicalEdge[], processed: Job[]): void {
  if (!existsSync(DATA_FILE)) {
    console.error(`ERROR: ${DATA_FILE} not found. Run from repo root.`); process.exit(1)
  }
  const file = JSON.parse(readFileSync(DATA_FILE, 'utf8'))
  const existing = file.edges as CanonicalEdge[]

  // Dedupe key: supplier+customer+category. Newer sourceDate wins.
  const keyOf = (e: CanonicalEdge) => `${e.supplier}|${e.customer}|${e.category}`
  const map = new Map<string, CanonicalEdge>()
  for (const e of existing) map.set(keyOf(e), e)
  for (const e of newEdges) {
    const k = keyOf(e); const prev = map.get(k)
    if (!prev || prev.sourceDate < e.sourceDate) map.set(k, e)
  }

  // Update coverage arrays
  const usSet = new Set<string>(file.coverage?.us ?? [])
  const inSet = new Set<string>(file.coverage?.in ?? [])
  for (const j of processed) {
    if (j.region === 'us') usSet.add(j.ticker)
    if (j.region === 'in') inSet.add(j.ticker)
  }
  file.coverage = { us: [...usSet].sort(), in: [...inSet].sort() }

  file.edges       = [...map.values()]
  file.generatedAt = new Date().toISOString().slice(0, 10)
  writeFileSync(DATA_FILE, JSON.stringify(file, null, 2))
  console.error(`\nWrote ${file.edges.length} edges (added/updated ${newEdges.length}) to ${DATA_FILE}`)
}

// ── Main ─────────────────────────────────────────────────────────────────────
;(async () => {
  const all: CanonicalEdge[] = []
  const processed: Job[] = []
  for (const job of dedup) {
    try {
      const edges = job.region === 'us'
        ? await processUS(job.ticker)
        : await processIN(job.ticker, job.wikiTitle!)
      if (edges.length > 0 || dryRun) processed.push(job)
      all.push(...edges)
      // Polite pacing — SEC asks <=10 rps, Gemini free is 15 rpm
      await new Promise(r => setTimeout(r, 800))
    } catch (e) { console.error(`[${job.ticker}] ERROR:`, e) }
  }

  if (writeOut) mergeEdges(all, processed)
  else          console.log(JSON.stringify({ edges: all, processed: processed.length }, null, 2))
})().catch(err => { console.error(err); process.exit(1) })
