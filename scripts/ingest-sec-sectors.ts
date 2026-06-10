// ─── ingest-sec-sectors ──────────────────────────────────────────────────────
//
// Backfills `companies.sector`, `companies.industry`, `companies.sicCode`,
// `companies.exchange`, `companies.logoDomain` and `companies.website` for
// every US SEC filer in our `companies` table.
//
// Source: SEC EDGAR Submissions endpoint
//   https://data.sec.gov/submissions/CIK{10-digit}.json
//
// This endpoint returns a company-level metadata record (separate from the
// financial facts endpoint we use in ingest-sec-fundamentals.ts) and includes:
//   • entityName
//   • sic + sicDescription                  (e.g. "7372" + "SERVICES-PREPACKAGED SOFTWARE")
//   • exchanges[]                           (e.g. ["Nasdaq"], ["NYSE"])
//   • tickers[]                             (every ticker the entity files under)
//   • addresses, formerNames, etc.          (we ignore these)
//
// We map SEC's SIC code into the canonical GICS-11 sector taxonomy that
// Koyfin / Bloomberg / our screener UI use:
//
//     Energy · Materials · Industrials · Consumer Discretionary ·
//     Consumer Staples · Health Care · Financials · Information Technology ·
//     Communication Services · Utilities · Real Estate
//
// The SIC→GICS crosswalk lives in `sicToGics()` below.  It's not perfectly
// 1:1 (the two taxonomies have different boundaries) but it's the same
// approximate mapping the SEC's EDGAR XBRL viewer uses, and it's what every
// free-data fintech uses when they don't pay S&P for native GICS codes.
//
// Cost: free (SEC EDGAR), ~15 minutes to backfill ~10K US filers at 9 req/sec.
//
// Usage:
//   npm run ingest:sectors                  # full universe
//   npm run ingest:sectors -- --limit 100   # smoke test
//   npm run ingest:sectors -- --only-missing  # only rows where sector IS NULL

import { db, companies, sql_client } from '../db/client'
import { eq, isNull, and, isNotNull } from 'drizzle-orm'

const SEC_HEADERS = {
  'User-Agent':      'NEXUS-Trading-Research/1.0 research@nexustrading.app',
  Accept:            'application/json',
  'Accept-Encoding': 'gzip',
}

const REQ_GAP_MS = 110  // 9 req/sec — safely under SEC's 10/sec ceiling

// ── SIC → GICS sector mapping ────────────────────────────────────────────────
//
// SEC uses 4-digit SIC codes from the 1987 US Census schema.  We bucket
// them into the GICS-11 sectors that Wall Street + every modern screener uses.
// The breakpoints below are based on the official SEC SIC→GICS crosswalk
// (https://www.sec.gov/info/edgar/siccodes.htm) plus the GICS industry
// taxonomy from MSCI/S&P.
//
// Anything outside the listed ranges falls into "Industrials" by default,
// which is what SEC EDGAR's full-text search defaults to too.

interface SectorMap {
  sector:   string
  industry: string
}

function sicToGics(sic: number, sicDesc: string): SectorMap {
  const desc = sicDesc.trim()

  // ── Energy ──────────────────────────────────────────────────────────────
  if (sic >= 1300 && sic <= 1389) return { sector: 'Energy', industry: 'Oil & Gas E&P' }
  if (sic >= 1400 && sic <= 1499) return { sector: 'Energy', industry: 'Mining Services' }
  if (sic === 2911)               return { sector: 'Energy', industry: 'Oil Refining' }
  if (sic === 4922 || sic === 4923 || sic === 4924) return { sector: 'Utilities', industry: 'Natural Gas Utilities' }
  if (sic >= 5170 && sic <= 5172) return { sector: 'Energy', industry: 'Petroleum Distribution' }

  // ── Materials ────────────────────────────────────────────────────────────
  if (sic >= 1000 && sic <= 1099) return { sector: 'Materials', industry: 'Metal Mining' }
  if (sic >= 1200 && sic <= 1299) return { sector: 'Materials', industry: 'Coal Mining' }
  if (sic >= 2400 && sic <= 2499) return { sector: 'Materials', industry: 'Forest Products' }
  if (sic >= 2600 && sic <= 2699) return { sector: 'Materials', industry: 'Paper Products' }
  if (sic >= 2800 && sic <= 2899 && sic !== 2834 && sic !== 2836) return { sector: 'Materials', industry: 'Chemicals' }
  if (sic >= 3300 && sic <= 3399) return { sector: 'Materials', industry: 'Steel' }
  if (sic === 3334)               return { sector: 'Materials', industry: 'Aluminum' }
  if (sic === 1040)               return { sector: 'Materials', industry: 'Gold Mining' }
  if (sic === 1411)               return { sector: 'Materials', industry: 'Stone Quarrying' }
  if (sic >= 3200 && sic <= 3299) return { sector: 'Materials', industry: 'Construction Materials' }

  // ── Industrials ──────────────────────────────────────────────────────────
  if (sic >= 1500 && sic <= 1799) return { sector: 'Industrials', industry: 'Construction & Engineering' }
  if (sic >= 3400 && sic <= 3499) return { sector: 'Industrials', industry: 'Fabricated Metal' }
  if (sic >= 3500 && sic <= 3569) return { sector: 'Industrials', industry: 'Industrial Machinery' }
  if (sic === 3711 || sic === 3713 || sic === 3714 || sic === 3715) return { sector: 'Consumer Discretionary', industry: 'Automobiles' }
  if (sic === 3721 || sic === 3724 || sic === 3728) return { sector: 'Industrials', industry: 'Aerospace & Defense' }
  if (sic >= 3730 && sic <= 3799) return { sector: 'Industrials', industry: 'Transportation Equipment' }
  if (sic >= 4000 && sic <= 4011) return { sector: 'Industrials', industry: 'Railroads' }
  if (sic >= 4200 && sic <= 4231) return { sector: 'Industrials', industry: 'Trucking' }
  if (sic >= 4400 && sic <= 4499) return { sector: 'Industrials', industry: 'Marine Shipping' }
  if (sic >= 4500 && sic <= 4581) return { sector: 'Industrials', industry: 'Airlines' }
  if (sic >= 4700 && sic <= 4789) return { sector: 'Industrials', industry: 'Transportation Services' }
  if (sic === 7389)               return { sector: 'Industrials', industry: 'Business Services' }
  if (sic === 7363)               return { sector: 'Industrials', industry: 'Staffing & Outsourcing' }

  // ── Consumer Discretionary ────────────────────────────────────────────
  if (sic >= 2300 && sic <= 2399) return { sector: 'Consumer Discretionary', industry: 'Apparel' }
  if (sic >= 2500 && sic <= 2599) return { sector: 'Consumer Discretionary', industry: 'Furniture' }
  if (sic >= 3140 && sic <= 3199) return { sector: 'Consumer Discretionary', industry: 'Footwear' }
  if (sic === 3711 || sic === 3713 || sic === 3714) return { sector: 'Consumer Discretionary', industry: 'Automobiles' }
  if (sic === 3942 || sic === 3944 || sic === 3949) return { sector: 'Consumer Discretionary', industry: 'Toys & Sporting Goods' }
  if (sic >= 5000 && sic <= 5199 && !(sic >= 5170 && sic <= 5172)) return { sector: 'Consumer Discretionary', industry: 'Wholesale' }
  if (sic >= 5200 && sic <= 5999 && !(sic >= 5810 && sic <= 5813) && !(sic >= 5400 && sic <= 5499)) return { sector: 'Consumer Discretionary', industry: 'Retail' }
  if (sic === 7011)               return { sector: 'Consumer Discretionary', industry: 'Hotels' }
  if (sic === 7372)               return { sector: 'Information Technology', industry: 'Software' }
  if (sic >= 7800 && sic <= 7899) return { sector: 'Communication Services', industry: 'Movies & Entertainment' }
  if (sic >= 7990 && sic <= 7999) return { sector: 'Consumer Discretionary', industry: 'Leisure' }

  // ── Consumer Staples ────────────────────────────────────────────────────
  if (sic >= 2000 && sic <= 2099) return { sector: 'Consumer Staples', industry: 'Food Products' }
  if (sic >= 2100 && sic <= 2199) return { sector: 'Consumer Staples', industry: 'Tobacco' }
  if (sic === 2080 || sic === 2082 || sic === 2086) return { sector: 'Consumer Staples', industry: 'Beverages' }
  if (sic >= 2840 && sic <= 2899 && sic !== 2834 && sic !== 2836) return { sector: 'Consumer Staples', industry: 'Personal Care' }
  if (sic >= 5400 && sic <= 5499) return { sector: 'Consumer Staples', industry: 'Food & Drug Retail' }
  if (sic === 5912)               return { sector: 'Consumer Staples', industry: 'Drug Retail' }

  // ── Health Care ─────────────────────────────────────────────────────────
  if (sic === 2834 || sic === 2836) return { sector: 'Health Care', industry: 'Pharmaceuticals' }
  if (sic === 8731 || sic === 8734) return { sector: 'Health Care', industry: 'Biotech / Research' }
  if (sic === 2835)               return { sector: 'Health Care', industry: 'Diagnostics' }
  if (sic >= 3840 && sic <= 3851) return { sector: 'Health Care', industry: 'Medical Devices' }
  if (sic >= 8000 && sic <= 8099) return { sector: 'Health Care', industry: 'Health Care Services' }
  if (sic === 8071 || sic === 8731) return { sector: 'Health Care', industry: 'Health Care Services' }

  // ── Financials ──────────────────────────────────────────────────────────
  if (sic >= 6000 && sic <= 6099) return { sector: 'Financials', industry: 'Banks' }
  if (sic >= 6100 && sic <= 6199) return { sector: 'Financials', industry: 'Credit Services' }
  if (sic >= 6200 && sic <= 6299) return { sector: 'Financials', industry: 'Capital Markets' }
  if (sic >= 6300 && sic <= 6399) return { sector: 'Financials', industry: 'Insurance' }
  if (sic >= 6400 && sic <= 6499) return { sector: 'Financials', industry: 'Insurance Brokers' }
  if (sic === 6770)               return { sector: 'Financials', industry: 'Holding Companies' }
  if (sic >= 6712 && sic <= 6726) return { sector: 'Financials', industry: 'Asset Management' }

  // ── Information Technology ──────────────────────────────────────────────
  if (sic === 3570 || sic === 3571 || sic === 3572 || sic === 3577 || sic === 3578 || sic === 3579) return { sector: 'Information Technology', industry: 'Computer Hardware' }
  if (sic === 3674)               return { sector: 'Information Technology', industry: 'Semiconductors' }
  if (sic === 3651 || sic === 3669 || sic === 3670 || sic === 3679) return { sector: 'Information Technology', industry: 'Electronic Components' }
  if (sic === 3812)               return { sector: 'Information Technology', industry: 'Defense Electronics' }
  if (sic === 3825 || sic === 3827) return { sector: 'Information Technology', industry: 'Instruments' }
  if (sic === 7370 || sic === 7371 || sic === 7372 || sic === 7373 || sic === 7374 || sic === 7375 || sic === 7378 || sic === 7379) {
    return { sector: 'Information Technology', industry: sic === 7372 ? 'Software' : 'IT Services' }
  }

  // ── Communication Services ─────────────────────────────────────────────
  if (sic === 2711 || sic === 2721 || sic === 2731 || sic === 2741) return { sector: 'Communication Services', industry: 'Publishing' }
  if (sic >= 4810 && sic <= 4899) return { sector: 'Communication Services', industry: 'Telecommunications' }
  if (sic === 7812 || sic === 7822 || sic === 7841) return { sector: 'Communication Services', industry: 'Movies & Entertainment' }
  if (sic === 4833 || sic === 4832 || sic === 4841) return { sector: 'Communication Services', industry: 'Broadcasting' }

  // ── Utilities ──────────────────────────────────────────────────────────
  if (sic === 4911 || sic === 4931 || sic === 4932) return { sector: 'Utilities', industry: 'Electric Utilities' }
  if (sic === 4941)               return { sector: 'Utilities', industry: 'Water Utilities' }
  if (sic === 4961)               return { sector: 'Utilities', industry: 'Steam Supply' }

  // ── Real Estate ────────────────────────────────────────────────────────
  if (sic === 6500 || sic === 6512 || sic === 6552) return { sector: 'Real Estate', industry: 'Real Estate Development' }
  if (sic === 6798)               return { sector: 'Real Estate', industry: 'REITs' }

  // ── Fallback ───────────────────────────────────────────────────────────
  return { sector: 'Industrials', industry: desc || 'Diversified' }
}

// ── SEC submissions endpoint ─────────────────────────────────────────────────

interface SubmissionsResponse {
  cik?:            string
  entityName?:     string
  sic?:            string
  sicDescription?: string
  tickers?:        string[]
  exchanges?:      string[]
  website?:        string
  // (we don't care about the rest)
}

async function fetchSubmissions(cik: string): Promise<SubmissionsResponse | null> {
  const padded = cik.padStart(10, '0')
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: SEC_HEADERS, signal: AbortSignal.timeout(15_000) })
      if (res.status === 404) return null
      if (res.status === 429 || res.status === 503) { await sleep((attempt + 1) * 2000); continue }
      if (!res.ok) { if (attempt < 2) { await sleep(1000); continue } return null }
      return await res.json() as SubmissionsResponse
    } catch {
      if (attempt < 2) { await sleep(1000); continue }
      return null
    }
  }
  return null
}

// ── Logo domain heuristic ────────────────────────────────────────────────────
// Derive a clearbit/clearbit-equivalent domain from the website URL or fall
// back to the entity name.  Stripping subdomains keeps the logo crisp.

function deriveLogoDomain(website: string | undefined, entityName: string): string | null {
  if (website) {
    try {
      const u = new URL(website.startsWith('http') ? website : `https://${website}`)
      const host = u.hostname.toLowerCase().replace(/^www\./, '')
      // Reject obviously bad cases (sec.gov etc)
      if (host && !host.endsWith('.gov') && host.includes('.')) return host
    } catch { /* fall through */ }
  }
  return null
}

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(): { limit?: number; onlyMissing: boolean; onlyWithFundamentals: boolean } {
  const args = process.argv.slice(2)
  let limit: number | undefined
  let onlyMissing = false
  let onlyWithFundamentals = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i+1]) { limit = Number(args[i+1]); i++ }
    else if (args[i] === '--only-missing') onlyMissing = true
    else if (args[i] === '--with-fundamentals') onlyWithFundamentals = true
  }
  return { limit, onlyMissing, onlyWithFundamentals }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
function pad(n: number, len = 5) { return String(n).padStart(len, ' ') }

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { limit, onlyMissing, onlyWithFundamentals } = parseArgs()

  // When --with-fundamentals, we only enrich companies that already have SEC
  // financial data — they're the ones a user will actually see in the
  // screener.  Saves ~3K API calls on SPAC shells and small filers.
  let targets: Array<{ id: string; ticker: string; cik: string | null; name: string }>
  if (onlyWithFundamentals) {
    const { sql } = await import('drizzle-orm')
    const rows = await db.execute<{ id: string; ticker: string; cik: string | null; name: string }>(sql`
      SELECT DISTINCT c.id, c.ticker, c.cik, c.name
      FROM companies c
      INNER JOIN fundamentals f ON f.company_id = c.id
      WHERE c.country = 'US'
        AND c.cik IS NOT NULL
        AND c.is_active = TRUE
        ${onlyMissing ? sql`AND c.sector IS NULL` : sql``}
      ORDER BY c.ticker
      ${limit ? sql`LIMIT ${limit}` : sql``}
    `)
    targets = [...rows]
  } else {
    const where = onlyMissing
      ? and(eq(companies.country, 'US'), isNotNull(companies.cik), eq(companies.isActive, true), isNull(companies.sector))
      : and(eq(companies.country, 'US'), isNotNull(companies.cik), eq(companies.isActive, true))
    targets = await db
      .select({ id: companies.id, ticker: companies.ticker, cik: companies.cik, name: companies.name })
      .from(companies)
      .where(where)
      .orderBy(companies.ticker)
      .limit(limit ?? 999_999)
  }

  console.log(`[sectors] Universe: ${targets.length} US companies`)
  console.log(`[sectors]   Mode:   ${onlyMissing ? 'only-missing' : 'all'}${onlyWithFundamentals ? ' (with-fundamentals)' : ''}`)

  let updated  = 0
  let noData   = 0
  let attempted = 0
  const startedAt = Date.now()

  for (const c of targets) {
    attempted++
    if (!c.cik) { noData++; continue }

    const sub = await fetchSubmissions(c.cik)
    if (!sub || !sub.sic) { noData++ }
    else {
      const sicNum = Number(sub.sic) || 0
      const mapping = sicToGics(sicNum, sub.sicDescription ?? '')
      const exchange = sub.exchanges?.[0] ?? null
      const logoDomain = deriveLogoDomain(sub.website, c.name)

      await db.update(companies)
        .set({
          sector:     mapping.sector,
          industry:   mapping.industry,
          sicCode:    sub.sic,
          exchange:   exchange,
          website:    sub.website ?? null,
          logoDomain: logoDomain ?? undefined,
          updatedAt:  new Date(),
        })
        .where(eq(companies.id, c.id))
      updated++
    }

    if (attempted % 50 === 0 || attempted === targets.length) {
      const elapsed = (Date.now() - startedAt) / 1000
      const rate    = attempted / elapsed
      const eta     = (targets.length - attempted) / Math.max(rate, 0.001)
      process.stdout.write(
        `\r[sectors] ${pad(attempted)}/${targets.length}  upd=${updated}  no-data=${noData}  ` +
        `${rate.toFixed(1)}/s  ETA ${(eta / 60).toFixed(1)}m`
      )
    }
    await sleep(REQ_GAP_MS)
  }

  console.log()
  console.log('─'.repeat(64))
  console.log(`✓ Sector backfill complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
  console.log(`  Attempted:   ${attempted}`)
  console.log(`  Updated:     ${updated}`)
  console.log(`  No SEC data: ${noData}`)
  console.log('─'.repeat(64))
  await sql_client.end()
}

main().catch(async e => {
  console.error('\n[fail]', e instanceof Error ? e.message : e)
  if (e instanceof Error && e.stack) console.error(e.stack)
  try { await sql_client.end() } catch {}
  process.exit(1)
})
