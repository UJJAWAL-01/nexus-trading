// Drizzle Kit config — drives `drizzle-kit generate` (create migrations from schema)
// and `drizzle-kit migrate` (apply pending migrations to the configured DB).
//
// Usage:
//   npm run db:generate    → create a new SQL migration from schema changes
//   npm run db:migrate     → apply pending migrations to DB at DATABASE_URL
//   npm run db:push        → push schema directly (fast iteration during dev)
//   npm run db:studio      → web UI at https://local.drizzle.studio
//
// Migrations live under ./db/migrations/ and are committed to git.

import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

// Match Next.js's env-file precedence so the same DATABASE_URL the app uses
// is the one drizzle-kit reads.  Default dotenv only loads `.env` — but the
// app puts credentials in `.env.local`, which Next.js loads automatically
// but standalone tools like drizzle-kit do not.
// Order: .env.local → .env.development.local → .env.development → .env.
// First win takes precedence (override: false).
for (const path of ['.env.local', '.env.development.local', '.env.development', '.env']) {
  loadEnv({ path, override: false })
}

if (!process.env.DATABASE_URL) {
  console.warn(
    '[drizzle-kit] DATABASE_URL not set after loading .env.local / .env.\n' +
    '  Make sure DATABASE_URL is defined in .env.local and is the Supabase\n' +
    '  Transaction-Mode pooler URL (port 6543, with ?pgbouncer=true).'
  )
}

export default defineConfig({
  dialect:     'postgresql',
  schema:      './db/schema/index.ts',
  out:         './db/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://invalid',
  },
  verbose: true,
  strict:  true,
})
