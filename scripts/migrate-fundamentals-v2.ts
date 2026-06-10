// ─── migrate-fundamentals-v2 ──────────────────────────────────────────────────
//
// Manual schema migration for the fundamentals table.  Adds:
//   • fiscal_period_start (date, nullable) — SEC's `start` field
//   • period_days        (integer, nullable) — duration in days
// And replaces the unique key so true-quarter and TTM rows can coexist.
//
// Drizzle-kit push hit a bug pulling the existing schema, so we run this
// as a single transactional SQL block via the postgres-js client.

import { sql_client } from '../db/client'

async function main() {
  console.log('[migrate] Connecting to Supabase…')

  // pgbouncer disallows multi-statement transactions over the pooled
  // connection, so we run each DDL statement individually.  These are all
  // idempotent (IF NOT EXISTS / IF EXISTS), so partial-failure is recoverable
  // by simply running the script again.
  console.log('[migrate] Adding fiscal_period_start column…')
  await sql_client.unsafe(`ALTER TABLE fundamentals ADD COLUMN IF NOT EXISTS fiscal_period_start date`)

  console.log('[migrate] Adding period_days column…')
  await sql_client.unsafe(`ALTER TABLE fundamentals ADD COLUMN IF NOT EXISTS period_days integer`)

  console.log('[migrate] Dropping old unique index…')
  await sql_client.unsafe(`DROP INDEX IF EXISTS fundamentals_unique_revision_idx`)

  console.log('[migrate] Creating new 4-column unique index…')
  await sql_client.unsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS fundamentals_unique_revision_idx
       ON fundamentals (company_id, metric, fiscal_period_end, period_days, as_of)`
  )

  console.log('[migrate] ✓ Schema migration applied')

  // Verify
  const cols = await sql_client.unsafe(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'fundamentals'
      AND column_name IN ('fiscal_period_start', 'period_days')
    ORDER BY column_name
  `)
  console.log('[migrate] New columns:')
  for (const c of cols) console.log(`    ${c.column_name.padEnd(22)} ${c.data_type.padEnd(10)} nullable=${c.is_nullable}`)

  const idx = await sql_client.unsafe(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'fundamentals' AND indexname = 'fundamentals_unique_revision_idx'
  `)
  console.log(`[migrate] Unique index: ${idx.length > 0 ? '✓ recreated' : '✗ MISSING'}`)

  await sql_client.end()
}

main().catch(async (err) => {
  console.error('[migrate] FAILED:', err instanceof Error ? err.message : err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  try { await sql_client.end() } catch {}
  process.exit(1)
})
