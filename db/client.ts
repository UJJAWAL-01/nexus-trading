// ─── Postgres + Drizzle client (singleton) ────────────────────────────────────
//
// Imported by every API route + worker that needs DB access.  The connection
// is lazily created once per Node process and cached on globalThis so HMR
// in `next dev` doesn't open dozens of pools.
//
// Driver choice: `postgres` (postgres-js, not node-pg).  Reasons:
//   • Smaller bundle, no native deps — runs in Node + Edge
//   • Better with Supabase's pooled connection limit (we use pgbouncer URL)
//   • Drizzle's officially-recommended driver for Supabase/Neon
//
// IMPORTANT for Supabase:
//   • Use the *Transaction Mode* pooler URL (port 6543) for serverless functions.
//   • Set `prepare: false` because pgbouncer doesn't support prepared statements.
//
// The schema is wired here so callers can `import { db, eq } from '@/db/client'`
// and use `db.select().from(companies).where(eq(companies.ticker, 'AAPL'))`.

// ── Auto-load env vars (for standalone Node tooling) ─────────────────────────
// Next.js loads `.env.local` automatically for app code, but standalone scripts
// (tsx, drizzle-kit, GitHub Actions) don't get that magic.  Loading dotenv at
// the top of this file means any consumer — including a tsx script that just
// imports `db` — gets DATABASE_URL automatically without needing to remember
// to configure dotenv first.
//
// ES module imports are hoisted and executed in declaration order, so doing
// this BEFORE any other code touches process.env is essential.  The `override:
// false` flag means we never clobber an env var that Next.js or the OS already
// set, keeping the Vercel deployment path unaffected.
import { config as loadEnv } from 'dotenv'
for (const path of ['.env.local', '.env']) {
  try { loadEnv({ path, override: false }) } catch { /* not available — fine */ }
}

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Re-export commonly used Drizzle SQL helpers so callers have a single import
export {
  eq, and, or, not, isNull, isNotNull,
  gt, gte, lt, lte, between,
  inArray, notInArray,
  like, ilike,
  desc, asc,
  sql,
} from 'drizzle-orm'

type DB = PostgresJsDatabase<typeof schema>

declare global {
  // eslint-disable-next-line no-var
  var __nexusPg: ReturnType<typeof postgres> | undefined
  // eslint-disable-next-line no-var
  var __nexusDb: DB | undefined
}

function getConnectionString(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      '[db] DATABASE_URL is not set. ' +
      'Set it to the Supabase Transaction-Mode pooler URL (port 6543) in .env.local.'
    )
  }
  return url
}

function createClient(): { pg: ReturnType<typeof postgres>; db: DB } {
  const pg = postgres(getConnectionString(), {
    // pgbouncer/Supabase pooler doesn't support prepared statements
    prepare:     false,
    // Keep connections lean — serverless functions are short-lived
    max:         5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Disable SQL-level notice logging (very chatty)
    onnotice:    () => {},
  })
  const db = drizzle(pg, { schema, logger: process.env.DB_LOG === '1' })
  return { pg, db }
}

// Lazy, globalThis-cached client.
//
// Nothing connects (or throws) at import time. The connection is created on
// first actual use, so the app builds and runs without a database; only the
// features that need Postgres report that it is not configured. globalThis
// caching survives Next.js HMR cycles in dev.
function ensure(): { pg: ReturnType<typeof postgres>; db: DB } {
  if (!globalThis.__nexusDb || !globalThis.__nexusPg) {
    const { pg, db } = createClient()
    globalThis.__nexusPg = pg
    globalThis.__nexusDb = db
  }
  return { pg: globalThis.__nexusPg, db: globalThis.__nexusDb }
}

/** True when DATABASE_URL is set. Routes use this to answer 503 instead of throwing. */
export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL
}

function lazy<T extends object>(resolve: () => T, shell: object): T {
  return new Proxy(shell, {
    get(_t, prop) {
      const real = resolve() as Record<PropertyKey, unknown>
      const value = real[prop]
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value
    },
    has(_t, prop) { return prop in (resolve() as object) },
    apply(_t, _thisArg, args) {
      return (resolve() as unknown as (...a: unknown[]) => unknown)(...args)
    },
  }) as T
}

export const db: DB = lazy<DB>(() => ensure().db, {})
// Raw client for ad-hoc queries. It is a tagged-template function, so the
// proxy shell must be callable.
export const sql_client = lazy<ReturnType<typeof postgres>>(() => ensure().pg, function () {})

// Re-export schema for ergonomic usage:
//   import { db, companies, eq } from '@/db/client'
export * from './schema'
