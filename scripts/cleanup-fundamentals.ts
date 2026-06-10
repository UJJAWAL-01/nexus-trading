// ─── cleanup-fundamentals ─────────────────────────────────────────────────────
//
// Reclaims space in the `fundamentals` table.  Use cases:
//   • Supabase free tier hit (500 MB ceiling) — DELETE old rows + VACUUM
//   • Restart from scratch (--truncate)
//   • Trim by metric subset (--keep-metrics) — coming if needed
//
// After deleting rows we run VACUUM to actually reclaim disk space.  Without
// VACUUM, Postgres marks rows as dead but doesn't release storage back to the
// OS, and Supabase keeps counting the deleted-but-not-vacuumed bytes against
// your quota.
//
// Usage:
//   npm run db:cleanup -- --before 2021-01-01        # delete rows older than this
//   npm run db:cleanup -- --truncate                 # wipe entire fundamentals table
//   npm run db:cleanup -- --keep-metrics Revenues,NetIncomeLoss,Assets,...
//   npm run db:cleanup -- --dry-run                  # show what WOULD be deleted

import { db, fundamentals, sql_client } from '../db/client'
import { sql } from 'drizzle-orm'

// ── CLI args ─────────────────────────────────────────────────────────────────

interface Args {
  before?:       string         // ISO date — delete rows where fiscal_period_end < this
  truncate:      boolean
  dryRun:        boolean
  keepMetrics?:  string[]
  skipVacuum:    boolean
}

function parseArgs(): Args {
  const a = process.argv.slice(2)
  const out: Args = { truncate: false, dryRun: false, skipVacuum: false }
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--before' && a[i+1])        { out.before = a[i+1]; i++ }
    else if (a[i] === '--truncate')           out.truncate = true
    else if (a[i] === '--dry-run')            out.dryRun = true
    else if (a[i] === '--skip-vacuum')        out.skipVacuum = true
    else if (a[i] === '--keep-metrics' && a[i+1]) { out.keepMetrics = a[i+1].split(','); i++ }
  }
  return out
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function rowCount(): Promise<number> {
  const [{ n }] = await db.execute<{ n: number }>(
    sql`SELECT COUNT(*)::int AS n FROM fundamentals`
  )
  return Number(n)
}

async function tableSize(): Promise<string> {
  const [{ size }] = await db.execute<{ size: string }>(
    sql`SELECT pg_size_pretty(pg_total_relation_size('fundamentals')) AS size`
  )
  return String(size)
}

async function dbSize(): Promise<string> {
  const [{ size }] = await db.execute<{ size: string }>(
    sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`
  )
  return String(size)
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  console.log('[cleanup] Settings:', JSON.stringify(args, null, 2))
  console.log()

  // Before stats
  console.log('[cleanup] Current state:')
  const before = await rowCount()
  const sizeBefore   = await tableSize()
  const dbSizeBefore = await dbSize()
  console.log(`  • fundamentals rows:  ${before.toLocaleString()}`)
  console.log(`  • fundamentals size:  ${sizeBefore}`)
  console.log(`  • whole DB size:      ${dbSizeBefore}`)
  console.log()

  if (before === 0) {
    console.log('[cleanup] Table is empty — nothing to do.')
    await sql_client.end()
    return
  }

  // Validate exactly one operation requested
  const ops = [args.truncate, !!args.before, !!args.keepMetrics].filter(Boolean).length
  if (ops === 0) {
    console.log('[cleanup] No operation specified.  Use one of:')
    console.log('  --before YYYY-MM-DD     Delete rows older than this fiscal_period_end')
    console.log('  --truncate              Wipe the entire fundamentals table')
    console.log('  --keep-metrics A,B,C    Keep only these XBRL tags, delete others')
    console.log()
    console.log('Other flags:')
    console.log('  --dry-run               Show what would be deleted without doing it')
    console.log('  --skip-vacuum           Skip the post-DELETE VACUUM step')
    await sql_client.end()
    return
  }
  if (ops > 1) {
    console.error('[cleanup] Pick exactly ONE operation (--before / --truncate / --keep-metrics)')
    await sql_client.end()
    process.exit(1)
  }

  // ── Execute ────────────────────────────────────────────────────────────────

  if (args.truncate) {
    if (args.dryRun) {
      console.log('[cleanup] DRY RUN — would TRUNCATE fundamentals (delete all rows).')
    } else {
      console.log('[cleanup] Attempting read-only mode override…')
      // Supabase sets default_transaction_read_only = TRUE at the database
      // level when storage is over quota.  This is a SESSION-level override
      // — must run on the same connection that does the TRUNCATE.
      try {
        await sql_client.unsafe('SET SESSION default_transaction_read_only = OFF')
        console.log('[cleanup] Session override applied.')
      } catch (e) {
        console.warn('[cleanup] Session override failed (continuing):', (e as Error).message)
      }

      console.log('[cleanup] Truncating fundamentals…')
      try {
        await sql_client.unsafe('TRUNCATE TABLE fundamentals')
        console.log('[cleanup] Truncated.')
      } catch (truncErr) {
        console.error('[cleanup] TRUNCATE failed — full error:')
        console.error(truncErr)
        console.log('[cleanup] Falling back to batched DELETE…')
        // Pgbouncer transaction mode + storage-exhausted DBs sometimes refuse
        // TRUNCATE.  DELETE in 50K-row batches works around both.
        let totalDeleted = 0
        let chunk = 0
        // Loop until we've cleared everything
        // We rely on the LIMIT'd DELETE via CTE pattern, since plain LIMIT isn't supported on DELETE
        while (true) {
          const res = await sql_client.unsafe(`
            WITH victims AS (
              SELECT id FROM fundamentals LIMIT 50000
            )
            DELETE FROM fundamentals WHERE id IN (SELECT id FROM victims)
            RETURNING 1
          `)
          const n = res.count ?? res.length ?? 0
          if (n === 0) break
          totalDeleted += n
          chunk++
          process.stdout.write(`\r[cleanup] batched DELETE: ${totalDeleted.toLocaleString()} rows`)
          if (chunk > 1000) { console.log('\n[cleanup] safety break (1000 batches)'); break }
        }
        console.log()
      }
    }
  }
  else if (args.before) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.before)) {
      console.error(`[cleanup] --before must be ISO date YYYY-MM-DD (got ${args.before})`)
      await sql_client.end()
      process.exit(1)
    }
    const [{ targeted }] = await db.execute<{ targeted: number }>(
      sql`SELECT COUNT(*)::int AS targeted FROM fundamentals WHERE fiscal_period_end < ${args.before}`
    )
    console.log(`[cleanup] Rows older than ${args.before}: ${Number(targeted).toLocaleString()}`)

    if (args.dryRun) {
      console.log('[cleanup] DRY RUN — no changes made.')
    } else {
      console.log(`[cleanup] Deleting…`)
      await db.execute(sql`DELETE FROM fundamentals WHERE fiscal_period_end < ${args.before}`)
      console.log('[cleanup] Deleted.')
    }
  }
  else if (args.keepMetrics) {
    const keep = args.keepMetrics
    const [{ targeted }] = await db.execute<{ targeted: number }>(
      sql`SELECT COUNT(*)::int AS targeted FROM fundamentals WHERE NOT (metric = ANY(${keep}))`
    )
    console.log(`[cleanup] Rows whose metric is NOT in keep-list: ${Number(targeted).toLocaleString()}`)
    console.log(`[cleanup] Keep-list (${keep.length}):`, keep.join(', '))

    if (args.dryRun) {
      console.log('[cleanup] DRY RUN — no changes made.')
    } else {
      console.log('[cleanup] Deleting…')
      await db.execute(sql`DELETE FROM fundamentals WHERE NOT (metric = ANY(${keep}))`)
      console.log('[cleanup] Deleted.')
    }
  }

  if (args.dryRun) {
    await sql_client.end()
    return
  }

  // ── VACUUM to reclaim space ────────────────────────────────────────────────
  if (args.truncate) {
    console.log('[cleanup] TRUNCATE already reclaims space — skipping VACUUM.')
  } else if (args.skipVacuum) {
    console.log('[cleanup] Skipping VACUUM (per --skip-vacuum).')
  } else {
    console.log('[cleanup] Running VACUUM (FULL) to reclaim space on disk…')
    // VACUUM FULL rewrites the table — slower but fully reclaims space.
    // VACUUM (without FULL) only marks pages as reusable; Supabase keeps
    // counting those bytes against your quota.  For storage relief we want FULL.
    // Note: VACUUM FULL requires an exclusive lock on the table, which is fine
    // for our offline cleanup but would block app queries in production.
    await sql_client.unsafe('VACUUM (FULL, ANALYZE) fundamentals')
    console.log('[cleanup] VACUUM complete.')
  }

  // After stats
  console.log()
  console.log('[cleanup] New state:')
  const after = await rowCount()
  const sizeAfter   = await tableSize()
  const dbSizeAfter = await dbSize()
  console.log(`  • fundamentals rows:  ${after.toLocaleString()}  (was ${before.toLocaleString()})`)
  console.log(`  • fundamentals size:  ${sizeAfter}            (was ${sizeBefore})`)
  console.log(`  • whole DB size:      ${dbSizeAfter}          (was ${dbSizeBefore})`)
  console.log()
  const pct = before > 0 ? (((before - after) / before) * 100).toFixed(1) : '0.0'
  console.log(`✓ Removed ${(before - after).toLocaleString()} rows (${pct}%)`)

  await sql_client.end()
}

main().catch(async (err) => {
  console.error('\n[fail] Error caught:')
  console.error(err)
  // Drizzle wraps errors in a way that hides the Postgres detail.  Surface it.
  const cause = (err as { cause?: unknown }).cause
  if (cause) { console.error('\n[fail] Underlying cause:'); console.error(cause) }
  try { await sql_client.end() } catch {}
  process.exit(1)
})
