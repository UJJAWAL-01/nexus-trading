// ─── ingestion_runs ───────────────────────────────────────────────────────────
//
// Audit log for every scheduled data job: fundamentals refresh, OHLCV daily
// append, IWV universe refresh, NSE Nifty 500 refresh, pattern detection sweep.
//
// Drives two important pieces of the app:
//   1. Operational visibility: "When was X last refreshed?  Did it succeed?"
//   2. "Data fresh as of …" badges in panel headers (per the Phase D pattern
//      we already established on EconCalendar / MacroRates).
//
// Reads from this table should be cheap.  The `lastSuccess()` query is one
// row-scan via the indexed (jobName, status, completedAt) compound.

import {
  pgTable, uuid, text, integer, timestamp, jsonb,
  index,
} from 'drizzle-orm/pg-core'

export const ingestionRuns = pgTable('ingestion_runs', {
  id:               uuid('id').defaultRandom().primaryKey(),
  jobName:          text('job_name').notNull(),          // 'sec_fundamentals' | 'iwv_universe' | 'nifty500_universe' |
                                                          // 'ohlcv_daily_us' | 'ohlcv_daily_in' | 'pattern_detection'

  status:           text('status').notNull(),            // 'running' | 'success' | 'partial' | 'failed'

  startedAt:        timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt:      timestamp('completed_at', { withTimezone: true }),
  durationMs:       integer('duration_ms'),

  // ── Result counters (job-specific shape) ───────────────────────────────────
  // Example for sec_fundamentals:
  //   { metricsRequested: 30, companiesAttempted: 3000,
  //     rowsInserted: 87500, rowsSkippedDuplicate: 1200,
  //     edgar429Count: 4, retriesAttempted: 4 }
  stats:            jsonb('stats').notNull().default({}),

  // ── Failure details (populated only when status != 'success') ──────────────
  errorMessage:     text('error_message'),
  errorStack:       text('error_stack'),

  // ── Trigger source ─────────────────────────────────────────────────────────
  triggeredBy:      text('triggered_by').notNull(),      // 'cron' | 'manual' | 'github_actions'

  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // "What was the last successful sec_fundamentals run?" — used by panel header badges
  jobStatusIdx:     index('ingestion_runs_job_status_idx').on(t.jobName, t.status, t.completedAt),
  // For ops dashboard / log review
  startedAtIdx:     index('ingestion_runs_started_at_idx').on(t.startedAt),
}))

export type IngestionRun    = typeof ingestionRuns.$inferSelect
export type NewIngestionRun = typeof ingestionRuns.$inferInsert
