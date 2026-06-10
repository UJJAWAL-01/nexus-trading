// ─── ingest-companies ──────────────────────────────────────────────────────────
//
// Seeds the `companies` table from authoritative public sources.
//
// US side  → SEC company_tickers.json
//   https://www.sec.gov/files/company_tickers.json
//   The canonical SEC-maintained list of every US filer.  Has CIK, ticker,
//   company name.  Broader than Russell 3000 (~10,400 entries) but every
//   entry is guaranteed to have a CIK, which is what the SEC fundamentals
//   pipeline needs.  Anything outside Russell 3000 will simply have sparse
//   fundamentals coverage — the screener can filter by market cap later.
//
// India side → NSE Nifty 500 list CSV
//   https://archives.nseindia.com/content/indices/ind_nifty500list.csv
//   The authoritative Nifty 500 list — published and maintained by NSE.
//   Gives us ~500 of the most liquid Indian listings.
//
// Idempotent — re-running upserts existing rows by ticker and updates the
// `last_verified` timestamp.  Safe to run as often as you want.
//
// Usage:
//   npm run ingest:companies
//
// Expected runtime: ~30-60s (network bound, two HTTP fetches + 11K upserts).

// db/client.ts loads .env.local automatically, so no dotenv boilerplate here.
import { db, companies, sql_client } from '../db/client'
import { sql } from 'drizzle-orm'

// ── Constants ────────────────────────────────────────────────────────────────

const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
const NSE_NIFTY500_URL = 'https://archives.nseindia.com/content/indices/ind_nifty500list.csv'

const SEC_HEADERS = {
  'User-Agent': 'NEXUS-Trading-Research/1.0 research@nexustrading.app',
  Accept: 'application/json',
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0',
  Accept: 'text/csv,application/csv,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
}

const UPSERT_BATCH_SIZE = 500

// ── SEC company tickers ───────────────────────────────────────────────────────

interface SECEntry {
  cik_str: number
  ticker:  string
  title:   string
}

async function fetchSECTickers(): Promise<SECEntry[]> {
  console.log(`[us] Fetching SEC company_tickers.json…`)
  const res = await fetch(SEC_TICKERS_URL, { headers: SEC_HEADERS })
  if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`)
  const data = await res.json() as Record<string, SECEntry>
  const entries = Object.values(data).filter(
    (e): e is SECEntry => typeof e.cik_str === 'number' && typeof e.ticker === 'string' && typeof e.title === 'string'
  )
  console.log(`[us] Got ${entries.length} SEC entries`)
  return entries
}

// ── NSE Nifty 500 ─────────────────────────────────────────────────────────────

interface NSEEntry {
  ticker:   string   // e.g. "RELIANCE.NS" — Yahoo-style
  name:     string
  industry: string | null
  isin:     string | null
}

async function fetchNifty500(): Promise<NSEEntry[]> {
  console.log(`[in] Fetching NSE Nifty 500 list CSV…`)
  const res = await fetch(NSE_NIFTY500_URL, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`NSE Nifty 500 HTTP ${res.status}`)
  const csv = await res.text()
  const lines = csv.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) throw new Error('NSE Nifty 500 CSV is empty')

  // CSV header: Company Name,Industry,Symbol,Series,ISIN Code
  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim())
  const idxName     = headers.findIndex(h => h.includes('company name'))
  const idxIndustry = headers.findIndex(h => h === 'industry')
  const idxSymbol   = headers.findIndex(h => h === 'symbol')
  const idxIsin     = headers.findIndex(h => h.includes('isin'))

  if (idxName === -1 || idxSymbol === -1) {
    throw new Error(`NSE Nifty 500 CSV header changed: ${headers.join(',')}`)
  }

  const out: NSEEntry[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < headers.length) continue
    const symbol = (cols[idxSymbol] ?? '').trim().toUpperCase()
    const name   = (cols[idxName] ?? '').trim()
    if (!symbol || !name) continue
    out.push({
      ticker:   `${symbol}.NS`,
      name,
      industry: idxIndustry >= 0 ? (cols[idxIndustry] ?? '').trim() || null : null,
      isin:     idxIsin     >= 0 ? (cols[idxIsin]     ?? '').trim() || null : null,
    })
  }
  console.log(`[in] Got ${out.length} Nifty 500 entries`)
  return out
}

// ── CSV parsing helper ────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else                                  inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

// ── Upsert helpers ────────────────────────────────────────────────────────────

type CompanyRow = typeof companies.$inferInsert

async function upsertBatched(rows: CompanyRow[], label: string): Promise<{ inserted: number; updated: number }> {
  // Drizzle's onConflictDoUpdate batches cleanly.  We update mutable fields on
  // conflict but DO preserve `id`, `first_seen`, and `created_at`.
  let processed = 0
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE)
    await db.insert(companies)
      .values(batch)
      .onConflictDoUpdate({
        target: companies.ticker,
        set: {
          name:         sql`EXCLUDED.name`,
          cik:          sql`COALESCE(EXCLUDED.cik, ${companies.cik})`,
          country:      sql`EXCLUDED.country`,
          currency:     sql`COALESCE(EXCLUDED.currency, ${companies.currency})`,
          exchange:     sql`COALESCE(EXCLUDED.exchange, ${companies.exchange})`,
          industry:     sql`COALESCE(EXCLUDED.industry, ${companies.industry})`,
          isin:         sql`COALESCE(EXCLUDED.isin, ${companies.isin})`,
          isActive:     sql`TRUE`,
          lastVerified: sql`NOW()`,
          updatedAt:    sql`NOW()`,
        },
      })
    processed += batch.length
    process.stdout.write(`\r[${label}] upserted ${processed} / ${rows.length}`)
  }
  process.stdout.write('\n')
  return { inserted: processed, updated: 0 }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now()

  // 1. US — SEC company_tickers.json
  const sec = await fetchSECTickers()
  const usRows: CompanyRow[] = sec.map(e => ({
    ticker:   e.ticker.toUpperCase(),
    name:     e.title,
    cik:      String(e.cik_str).padStart(10, '0'),
    country:  'US',
    currency: 'USD',
  }))

  await upsertBatched(usRows, 'us')

  // 2. India — NSE Nifty 500
  const nse = await fetchNifty500()
  const inRows: CompanyRow[] = nse.map(e => ({
    ticker:   e.ticker,
    name:     e.name,
    country:  'IN',
    currency: 'INR',
    exchange: 'NSE',
    industry: e.industry ?? undefined,
    isin:     e.isin ?? undefined,
  }))

  await upsertBatched(inRows, 'in')

  // 3. Summary — count what we have
  const [{ count: total }] = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM companies WHERE is_active = TRUE`
  )
  const [{ count: us }] = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM companies WHERE country = 'US'`
  )
  const [{ count: ind }] = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM companies WHERE country = 'IN'`
  )

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log()
  console.log('─'.repeat(48))
  console.log(`✓ Ingestion complete in ${elapsed}s`)
  console.log(`  Total active rows: ${total}`)
  console.log(`  US (SEC filers):   ${us}`)
  console.log(`  India (Nifty 500): ${ind}`)
  console.log('─'.repeat(48))

  // Close the connection so the process exits cleanly
  await sql_client.end()
}

main().catch(async (err) => {
  console.error('\n[fail]', err instanceof Error ? err.message : err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  try { await sql_client.end() } catch {}
  process.exit(1)
})
