// ─── fundamentals ─────────────────────────────────────────────────────────────
//
// Time series of XBRL-reported financial metrics, one row per
// (company, metric, fiscal_period, filing_revision).
//
// Populated by /workers/ingest-sec-fundamentals from SEC EDGAR's Frames API
// (https://data.sec.gov/api/xbrl/frames/...).  India fundamentals are out of
// scope until a data source is selected.
//
// Why we keep `asOf` (filing date):
//   Same fiscal quarter's revenue may be reported multiple times — initial
//   10-Q, restated in 10-K, restated again in 10-K/A.  Storing all revisions
//   lets us do point-in-time (PIT) queries for proper backtesting later.
//
//   Latest value for a (company, metric, fiscal_period_end):
//     SELECT DISTINCT ON (company_id, metric, fiscal_period_end)
//            value FROM fundamentals
//     WHERE  ...
//     ORDER  BY company_id, metric, fiscal_period_end, as_of DESC;
//
// Why both fiscal AND calendar columns:
//   Apple's fiscal Q3 2024 ends Jun 29.  In calendar terms that's CY2024Q2.
//   Different queries care about different lenses:
//     – Comparing Apple's quarters across years → fiscal axis
//     – Comparing Apple vs Microsoft in "Q3 2024" → calendar axis
//
// Cardinality estimate:
//   3,000 companies × 30 metrics × 40 quarters × ~1.3 revisions ≈ 4.7M rows.
//   Plenty of headroom on Supabase free tier (500MB; this is ~150MB).

import {
  pgTable, uuid, text, integer, numeric, date, timestamp,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core'
import { companies } from './companies'

export const fundamentals = pgTable('fundamentals', {
  id:                 uuid('id').defaultRandom().primaryKey(),

  // ── Relations ──────────────────────────────────────────────────────────────
  companyId:          uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),

  // ── What metric ────────────────────────────────────────────────────────────
  metric:             text('metric').notNull(),            // XBRL tag, e.g. "Revenues", "NetIncomeLoss", "EarningsPerShareDiluted"
                                                            // The canonical set is documented in workers/sec-metrics.ts

  // ── Reporting period (fiscal lens — the company's view) ────────────────────
  fiscalPeriodEnd:    date('fiscal_period_end').notNull(), // last day of the fiscal period the value applies to
  fiscalPeriodStart:  date('fiscal_period_start'),         // first day of the period (SEC's `start` field).  NULL for stock metrics (balance-sheet snapshots have no start).
  periodDays:         integer('period_days'),              // (end - start) in days — discriminates true Q-only (~90d) from YTD (180/270d) and TTM (365d).  Computed at ingest.
  fiscalYear:         integer('fiscal_year').notNull(),    // FY2024
  fiscalQuarter:      integer('fiscal_quarter'),           // 1-4 for quarterly; NULL for annual rollup

  // ── Reporting period (calendar lens — the world's view) ────────────────────
  calendarYear:       integer('calendar_year').notNull(),  // 2024
  calendarQuarter:    integer('calendar_quarter'),         // 1-4 (always set for quarterly); NULL for annual rollup
  periodType:         text('period_type').notNull(),       // "quarterly" | "annual" | "ttm" (we may compute TTM rollups)

  // ── The value ──────────────────────────────────────────────────────────────
  value:              numeric('value', { precision: 28, scale: 4 }).notNull(),
                                                            // 28 digits is enough for trillions in pennies.
  unit:               text('unit').notNull(),               // "USD", "shares", "USD/shares" (for EPS), "pure" (for ratios)

  // ── Provenance + point-in-time ─────────────────────────────────────────────
  asOf:               date('as_of').notNull(),             // SEC accession filing date — defines "as known on" date for PIT queries
  accessionNumber:    text('accession_number'),            // SEC filing ID, e.g. "0000320193-24-000123" — for traceability
  source:             text('source').notNull().default('SEC_XBRL'), // future: "MANUAL", "NSE_FILINGS", etc.

  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // ── Indexes optimized for screener queries ─────────────────────────────────

  // Primary natural key — prevents duplicate ingestion of same revision.
  //
  // periodDays is part of the key so that the SAME end date can carry both
  // the 3-month quarter value AND the 12-month TTM value — SEC reports both
  // under fp:"Q3" with the same `end` and `accn`/`filed`, distinguished only
  // by `start`.  Without periodDays here, one of them silently overwrites
  // the other during ingestion.
  uniqueRevisionIdx:  uniqueIndex('fundamentals_unique_revision_idx')
                        .on(t.companyId, t.metric, t.fiscalPeriodEnd, t.periodDays, t.asOf),

  // Most common screener query: "give me latest TTM Revenue for all companies in Tech"
  // → join companies on sector, fundamentals on metric, ORDER BY (companyId, metric, asOf DESC)
  companyMetricIdx:   index('fundamentals_company_metric_idx').on(t.companyId, t.metric, t.fiscalPeriodEnd),

  // "Show all companies' latest reported metric X" — full-table scan with filter pushdown
  metricLatestIdx:    index('fundamentals_metric_period_idx').on(t.metric, t.calendarYear, t.calendarQuarter),

  // Period-based scans (e.g. all FY2024 EPS values for peer comparison)
  fiscalPeriodIdx:    index('fundamentals_fiscal_period_idx').on(t.fiscalYear, t.fiscalQuarter, t.periodType),
}))

export type Fundamental    = typeof fundamentals.$inferSelect
export type NewFundamental = typeof fundamentals.$inferInsert
