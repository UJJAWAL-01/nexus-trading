// ─── ingest-sec-fundamentals ──────────────────────────────────────────────────
//
// Pulls XBRL-reported financial metrics for every US company in the
// `companies` table (anything with a non-null CIK) from SEC EDGAR's
// `companyfacts` endpoint and writes them into the `fundamentals` table.
//
// Endpoint:
//   https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit-padded}.json
//
// Response shape (truncated for clarity):
//   {
//     "cik": 320193,
//     "entityName": "Apple Inc.",
//     "facts": {
//       "us-gaap": {
//         "Revenues": {
//           "units": {
//             "USD": [
//               { "end":"2024-09-28", "val":94930000000, "accn":"...",
//                 "fy":2024, "fp":"Q4", "form":"10-K", "filed":"2024-10-31",
//                 "frame":"CY2024Q3" },
//               ...
//             ]
//           }
//         },
//         ...
//       }
//     }
//   }
//
// We extract a curated set of 30 canonical metrics (see CANONICAL_METRICS
// below) — enough to drive screeners, equity research, and growth charts
// without bloating the DB with every obscure XBRL tag.
//
// Rate limit:
//   SEC enforces 10 req/sec per IP.  We pace at ~110ms between requests
//   to stay under that, with retry+backoff on 429/503.
//
// Resumability:
//   Idempotent — re-running with the same data skips rows via the
//   (company_id, metric, fiscal_period_end, as_of) unique index.  Each run
//   logs a row to `ingestion_runs` so you can see when it last completed.
//
// Usage:
//   npm run ingest:sec                  # all US companies
//   npm run ingest:sec -- --limit 100   # first 100 (for testing)
//   npm run ingest:sec -- --since-years 10  # only fetch last 10 years (default)
//   npm run ingest:sec -- --resume      # skip companies that already have data
//
// Expected runtime: ~20 minutes for full ~10K US universe (network-bound).

// db/client.ts loads .env.local automatically, so no dotenv boilerplate here.
import { db, companies, fundamentals, ingestionRuns, sql_client } from '../db/client'
import { sql, eq, isNotNull, and } from 'drizzle-orm'

// ── Constants ────────────────────────────────────────────────────────────────

const SEC_HEADERS = {
  'User-Agent': 'NEXUS-Trading-Research/1.0 research@nexustrading.app',
  Accept:       'application/json',
  'Accept-Encoding': 'gzip',
}

const REQ_GAP_MS    = 110       // 9 req/sec — safely under the 10/sec limit
const BACKFILL_YEARS = 5        // default — fits Supabase 500MB free tier
const INSERT_BATCH   = 1000

// The "essential 12" — the canonical metrics we actually use for screeners,
// equity research, and growth analysis.  Picked deliberately to fit the
// Supabase 500MB free tier (10K companies × 12 metrics × 20 quarters × 1.3
// revisions × ~80 bytes ≈ 250MB raw + ~150MB indexes = ~400MB total).
//
// Adding more metrics here picks them up on the next run, but be aware the
// row count grows linearly — and the free tier breaks at 500MB.
//
// Notes:
//   • SEC moved revenue reporting from `Revenues` (older) to
//     `RevenueFromContractWithCustomerExcludingAssessedTax` (ASC 606, 2018+).
//     We accept both — downstream we treat them as the same logical metric.
//   • EarningsPerShare values are unit "USD/shares".
const CANONICAL_METRICS: ReadonlyArray<string> = [
  // Income statement — the 4 lines a screener can't live without
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'GrossProfit',
  'OperatingIncomeLoss',
  'NetIncomeLoss',
  'EarningsPerShareDiluted',

  // Balance sheet — minimum for solvency / book-value ratios
  'Assets',
  'Liabilities',
  'StockholdersEquity',

  // Cash flow — needed for FCF computation
  'NetCashProvidedByUsedInOperatingActivities',
  'PaymentsToAcquirePropertyPlantAndEquipment',

  // Shares outstanding — needed for any per-share ratio
  'CommonStockSharesOutstanding',
]

const METRIC_SET = new Set(CANONICAL_METRICS)

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs(): { limit?: number; sinceYears: number; resume: boolean } {
  const args = process.argv.slice(2)
  let limit: number | undefined
  let sinceYears = BACKFILL_YEARS
  let resume = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) { limit = Number(args[i + 1]); i++ }
    else if (args[i] === '--since-years' && args[i + 1]) { sinceYears = Number(args[i + 1]); i++ }
    else if (args[i] === '--resume') resume = true
  }
  return { limit, sinceYears, resume }
}

// ── SEC fetch + parse ────────────────────────────────────────────────────────

interface FactEntry {
  start?: string        // ISO date — period start (only present for flow metrics: revenue, cash flow, etc.)
  end:   string         // ISO date "2024-09-28" — fiscal period end
  val:   number
  accn:  string         // SEC accession number
  fy:    number         // fiscal year
  fp:    string         // "Q1" | "Q2" | "Q3" | "Q4" | "FY"
  form:  string         // "10-K" | "10-Q" | "10-K/A" | "10-Q/A" | "8-K" | etc
  filed: string         // ISO date filed
  frame?: string        // "CY2024Q3" or "CY2024" — when available
}

interface CompanyFacts {
  cik:        number
  entityName: string
  facts?: {
    'us-gaap'?: Record<string, {
      label?: string
      units?: Record<string, FactEntry[]>
    }>
  }
}

async function fetchCompanyFacts(cik: string): Promise<CompanyFacts | null> {
  const padded = cik.padStart(10, '0')
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: SEC_HEADERS, signal: AbortSignal.timeout(20_000) })
      if (res.status === 404) return null               // company has no XBRL data
      if (res.status === 429 || res.status === 503) {
        // Rate-limited or upstream pressure — back off
        const wait = (attempt + 1) * 2000
        await sleep(wait)
        continue
      }
      if (!res.ok) {
        if (attempt < 3) { await sleep(1000); continue }
        return null
      }
      return await res.json() as CompanyFacts
    } catch {
      if (attempt < 3) { await sleep(1000); continue }
      return null
    }
  }
  return null
}

// ── Period parsing ──────────────────────────────────────────────────────────

interface ParsedPeriod {
  fiscalYear:      number
  fiscalQuarter:   number | null
  calendarYear:    number
  calendarQuarter: number | null
  periodType:      'quarterly' | 'annual'
  periodDays:      number | null   // (end - start) in days — null for balance-sheet (no `start`)
}

// Flow / cash-flow / income metrics — these have a `start` date and are
// reported as "value over duration".  We can use periodDays to distinguish
// 3-month quarterly values from rolling-TTM values (XBRL stores both!).
const FLOW_METRICS = new Set<string>([
  'Revenues',
  'RevenueFromContractWithCustomerExcludingAssessedTax',
  'GrossProfit',
  'OperatingIncomeLoss',
  'NetIncomeLoss',
  'EarningsPerShareDiluted',
  'NetCashProvidedByUsedInOperatingActivities',
  'PaymentsToAcquirePropertyPlantAndEquipment',
])

function parsePeriod(entry: FactEntry, metric: string): ParsedPeriod | null {
  // Determine quarter from fp.  SEC uses Q1/Q2/Q3/Q4 for quarterly, FY for annual.
  let fiscalQuarter: number | null = null
  let periodType: 'quarterly' | 'annual'
  switch (entry.fp) {
    case 'Q1': fiscalQuarter = 1; periodType = 'quarterly'; break
    case 'Q2': fiscalQuarter = 2; periodType = 'quarterly'; break
    case 'Q3': fiscalQuarter = 3; periodType = 'quarterly'; break
    case 'Q4': fiscalQuarter = 4; periodType = 'quarterly'; break
    case 'FY': fiscalQuarter = null; periodType = 'annual';  break
    default: return null
  }

  // Calendar period: derive from end-date (more reliable than `frame`).
  const endDate = new Date(entry.end + 'T00:00:00Z')
  if (isNaN(endDate.getTime())) return null
  const calendarYear = endDate.getUTCFullYear()
  const month = endDate.getUTCMonth() + 1
  const calendarQuarter = periodType === 'annual' ? null : Math.ceil(month / 3)

  // periodDays — duration of the reporting window.
  //   Balance-sheet metrics (Assets, Liabilities, Equity, Shares) have no
  //   `start` field and represent a point-in-time snapshot.  periodDays=null.
  //
  //   Flow metrics ALWAYS have `start`.  We compute days = end - start.
  //   Typical durations:
  //       ~90d   = true 3-month quarter      ← what we want
  //       ~180d  = H1 YTD                     ← skip
  //       ~270d  = 9-month YTD                ← skip
  //       ~365d  = FY or rolling TTM          ← keep only when fp="FY"
  //   We use 3-week tolerance for fiscal-year quirks.
  let periodDays: number | null = null
  const isFlow = FLOW_METRICS.has(metric)
  if (isFlow) {
    if (!entry.start) {
      // Flow metric with no start = malformed entry, skip.
      return null
    }
    const startDate = new Date(entry.start + 'T00:00:00Z')
    if (isNaN(startDate.getTime())) return null
    periodDays = Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000)

    // Discriminate by duration:
    //   • Quarter: 80-100 days
    //   • Annual:  350-380 days (10-K FY values)
    //   Reject everything else (YTD / TTM pollution).
    if (periodType === 'quarterly' && (periodDays < 80 || periodDays > 100)) return null
    if (periodType === 'annual'    && (periodDays < 350 || periodDays > 380)) return null
  }

  return {
    fiscalYear:      entry.fy,
    fiscalQuarter,
    calendarYear,
    calendarQuarter,
    periodType,
    periodDays,
  }
}

// ── Build fundamentals rows ──────────────────────────────────────────────────

type FundamentalRow = typeof fundamentals.$inferInsert

function extractRows(companyId: string, facts: CompanyFacts, cutoffDate: string): FundamentalRow[] {
  const out: FundamentalRow[] = []
  const usGaap = facts.facts?.['us-gaap']
  if (!usGaap) return out

  for (const [metric, def] of Object.entries(usGaap)) {
    if (!METRIC_SET.has(metric)) continue
    const units = def.units
    if (!units) continue

    // Prefer USD unit; fall back to USD/shares (EPS) or shares.
    for (const [unit, entries] of Object.entries(units)) {
      if (!Array.isArray(entries)) continue
      for (const e of entries) {
        if (e.end < cutoffDate) continue              // too old
        if (typeof e.val !== 'number' || !isFinite(e.val)) continue
        if (!e.accn || !e.filed) continue

        const parsed = parsePeriod(e, metric)
        if (!parsed) continue

        out.push({
          companyId,
          metric,
          fiscalPeriodEnd:   e.end,
          fiscalPeriodStart: e.start ?? null,
          periodDays:        parsed.periodDays,
          fiscalYear:        parsed.fiscalYear,
          fiscalQuarter:     parsed.fiscalQuarter,
          calendarYear:      parsed.calendarYear,
          calendarQuarter:   parsed.calendarQuarter,
          periodType:        parsed.periodType,
          value:             String(e.val),                  // numeric column, stringify
          unit,
          asOf:              e.filed,
          accessionNumber:   e.accn,
          source:            'SEC_XBRL',
        })
      }
    }
  }
  return out
}

// ── Database writes ──────────────────────────────────────────────────────────

async function upsertFundamentals(rows: FundamentalRow[]): Promise<number> {
  if (rows.length === 0) return 0
  let total = 0
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH)
    // Skip duplicates instead of conflicting — same revision shouldn't be
    // re-inserted, and changes to the value would imply SEC restated history,
    // which we'd see as a new `accn` + `filed` date → different row anyway.
    await db.insert(fundamentals)
      .values(batch)
      .onConflictDoNothing({
        target: [
          fundamentals.companyId,
          fundamentals.metric,
          fundamentals.fiscalPeriodEnd,
          fundamentals.periodDays,
          fundamentals.asOf,
        ],
      })
    total += batch.length
  }
  return total
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function pad(n: number, len = 5): string {
  return String(n).padStart(len, ' ')
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const { limit, sinceYears, resume } = parseArgs()
  const startedAt = new Date()
  const cutoffDate = new Date(startedAt)
  cutoffDate.setFullYear(cutoffDate.getFullYear() - sinceYears)
  const cutoffISO = cutoffDate.toISOString().slice(0, 10)

  console.log(`[sec] Settings:`)
  console.log(`     • Backfill from: ${cutoffISO} (${sinceYears} years)`)
  console.log(`     • Resume mode:   ${resume ? 'skip companies with existing data' : 'process all'}`)
  console.log(`     • Limit:         ${limit ?? 'no limit (full universe)'}`)
  console.log(`     • Canonical metrics: ${CANONICAL_METRICS.length}`)
  console.log()

  // Open an ingestion_runs row to track this execution
  const [run] = await db.insert(ingestionRuns).values({
    jobName:     'sec_fundamentals',
    status:      'running',
    startedAt,
    triggeredBy: 'manual',
    stats:       {},
  }).returning({ id: ingestionRuns.id })

  console.log(`[sec] Ingestion run id: ${run.id}`)

  // Fetch the list of US companies with CIKs
  const targets = await db
    .select({ id: companies.id, cik: companies.cik, ticker: companies.ticker, name: companies.name })
    .from(companies)
    .where(and(eq(companies.country, 'US'), isNotNull(companies.cik), eq(companies.isActive, true)))
    .orderBy(companies.ticker)
    .limit(limit ?? 999_999)

  console.log(`[sec] Universe: ${targets.length} US companies with CIKs`)

  let attempted = 0
  let succeeded = 0
  let skipped  = 0
  let noData   = 0
  let rowsInserted = 0
  let edgar404 = 0
  let edgar429 = 0

  for (const c of targets) {
    attempted++

    if (resume) {
      // Quick check: does this company have *any* fundamentals already?
      const [{ count }] = await db.execute<{ count: number }>(
        sql`SELECT COUNT(*)::int AS count FROM fundamentals WHERE company_id = ${c.id} LIMIT 1`
      )
      if (count > 0) {
        skipped++
        if (attempted % 100 === 0) {
          process.stdout.write(`\r[sec] ${pad(attempted)}/${targets.length}  ok=${succeeded}  skip=${skipped}  rows=${rowsInserted}`)
        }
        continue
      }
    }

    const facts = await fetchCompanyFacts(c.cik!)
    if (facts === null) {
      noData++
      // SEC 404 is normal for companies that don't file standard XBRL
      // (e.g. closed-end funds, foreign privates, very small filers)
      edgar404++
    } else {
      try {
        const rows = extractRows(c.id, facts, cutoffISO)
        if (rows.length > 0) {
          const inserted = await upsertFundamentals(rows)
          rowsInserted += inserted
          succeeded++
        } else {
          noData++
        }
      } catch (e) {
        console.error(`\n[sec] ${c.ticker}: extraction failed —`, e instanceof Error ? e.message : e)
      }
    }

    // Progress display
    if (attempted % 25 === 0 || attempted === targets.length) {
      process.stdout.write(
        `\r[sec] ${pad(attempted)}/${targets.length}  ok=${succeeded}  no-data=${noData}  skip=${skipped}  rows=${rowsInserted}`
      )
    }

    // Pace
    await sleep(REQ_GAP_MS)
  }

  // Close the ingestion run
  const completedAt = new Date()
  const durationMs  = completedAt.getTime() - startedAt.getTime()
  await db.update(ingestionRuns)
    .set({
      status:      succeeded > 0 ? 'success' : 'partial',
      completedAt,
      durationMs,
      stats: {
        universe:     targets.length,
        attempted,
        succeeded,
        skipped,
        noData,
        rowsInserted,
        edgar404,
        edgar429,
        cutoffDate:   cutoffISO,
      },
    })
    .where(eq(ingestionRuns.id, run.id))

  // Final stats from the DB
  const [{ count: totalFundamentals }] = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int AS count FROM fundamentals`
  )

  console.log()
  console.log('─'.repeat(64))
  console.log(`✓ SEC ingestion complete in ${(durationMs / 1000).toFixed(1)}s`)
  console.log(`  Attempted:           ${attempted}`)
  console.log(`  Succeeded:           ${succeeded}`)
  console.log(`  No XBRL data:        ${noData}`)
  console.log(`  Skipped (resumed):   ${skipped}`)
  console.log(`  Rows inserted (run): ${rowsInserted.toLocaleString()}`)
  console.log(`  Rows in DB (total):  ${totalFundamentals.toLocaleString()}`)
  console.log('─'.repeat(64))

  await sql_client.end()
}

main().catch(async (err) => {
  console.error('\n[fail]', err instanceof Error ? err.message : err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  try { await sql_client.end() } catch {}
  process.exit(1)
})
