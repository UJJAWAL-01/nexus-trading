// ─── pattern_signals ──────────────────────────────────────────────────────────
//
// Pre-computed chart pattern detection results.
//
// Populated by /workers/detect-patterns running on Vercel Cron, hourly during
// US market hours (9:30-16:00 ET, Mon-Fri).  The worker reads daily OHLCV from
// R2 parquet files (DuckDB), runs rule-based detectors across the tracked
// universe, and writes signals here.
//
// The UI ("Pattern Alerts" panel) reads from this table — never re-computes
// in the panel.  This is what makes screening 5K tickers feel instant.
//
// Pattern lifecycle:
//   1. Detector finds a pattern → row inserted with status='forming'
//   2. Subsequent scan confirms breakout → status='confirmed', breakoutAt set
//   3. Price invalidates the pattern → status='invalidated'
//   4. Target reached → status='completed' (good for win-rate stats later)
//
// Each row references the supporting price points so the UI can draw the
// pattern overlay on the chart without re-detecting.

import {
  pgTable, uuid, text, numeric, integer, timestamp, jsonb,
  index,
} from 'drizzle-orm/pg-core'
import { companies } from './companies'

export const patternSignals = pgTable('pattern_signals', {
  id:               uuid('id').defaultRandom().primaryKey(),
  companyId:        uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),

  // ── Pattern identity ───────────────────────────────────────────────────────
  patternType:      text('pattern_type').notNull(),
  // Allowed values (v1, rule-based — keep in sync with workers/detectors/index.ts):
  //   'cup_handle' | 'head_shoulders' | 'inverse_head_shoulders'
  //   'double_top' | 'double_bottom'
  //   'triangle_ascending' | 'triangle_descending' | 'triangle_symmetric'
  //   'flag_bull' | 'flag_bear' | 'pennant'
  //   'trendline_break' | 'ma_cross_golden' | 'ma_cross_death'
  //   'support_break' | 'resistance_break'
  //   'volume_spike_bull' | 'volume_spike_bear'

  direction:        text('direction').notNull(),         // 'bullish' | 'bearish' | 'neutral'

  // ── Quality metrics ────────────────────────────────────────────────────────
  confidence:       numeric('confidence', { precision: 5, scale: 4 }).notNull(),
                                                          // 0.0000 – 1.0000.  Detector-specific scoring (e.g. depth/symmetry for cup-handle).
  timeframe:        text('timeframe').notNull(),          // '1D' (only daily for v1; intraday is paid-tier later)

  // ── Time anchors ───────────────────────────────────────────────────────────
  detectedAt:       timestamp('detected_at', { withTimezone: true }).defaultNow().notNull(),
  patternStartedAt: timestamp('pattern_started_at', { withTimezone: true }).notNull(),  // first candle of the formation
  breakoutAt:       timestamp('breakout_at', { withTimezone: true }),                   // null until breakout confirmed

  // ── Price anchors (drives the chart overlay) ───────────────────────────────
  // Stored as JSON to keep schema flexible across pattern types.
  // Each detector emits its own shape; the panel knows how to draw it.
  // Example for cup-handle:
  //   { left_peak: { t: '2024-03-15', y: 192.50 },
  //     trough:    { t: '2024-05-20', y: 158.20 },
  //     right_peak:{ t: '2024-08-10', y: 191.80 },
  //     handle_low:{ t: '2024-09-05', y: 178.30 },
  //     breakout:  { t: '2024-09-18', y: 193.00 } }
  anchors:          jsonb('anchors').notNull(),

  // ── Targets / stops (computed by detector) ─────────────────────────────────
  entry:            numeric('entry',  { precision: 18, scale: 4 }),   // suggested entry price (typically breakout level)
  target:           numeric('target', { precision: 18, scale: 4 }),   // projected target (measured move)
  stopLoss:         numeric('stop_loss', { precision: 18, scale: 4 }),// invalidation level

  // ── Status ─────────────────────────────────────────────────────────────────
  status:           text('status').notNull().default('forming'),
                                                          // 'forming' | 'confirmed' | 'invalidated' | 'completed'

  // ── Universe filter helpers ────────────────────────────────────────────────
  marketCapBucket:  text('market_cap_bucket'),            // 'mega' | 'large' | 'mid' | 'small' — denormalized for fast "show me only large caps" filtering
  sectorAtDetection:text('sector_at_detection'),          // snapshot — sector could change later
  volumeRelative:   numeric('volume_relative', { precision: 8, scale: 4 }),
                                                          // volume on breakout vs 20-day avg.  >1.5 is meaningful.

  // ── Audit ──────────────────────────────────────────────────────────────────
  detectorVersion:  text('detector_version').notNull().default('1.0.0'),
                                                          // bump when detector logic changes — lets us re-evaluate older signals
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // "Show all bullish breakouts today" → primary use case
  feedIdx:          index('pattern_signals_feed_idx').on(t.status, t.direction, t.detectedAt),
  // "Show all signals on ticker X"
  companyIdx:       index('pattern_signals_company_idx').on(t.companyId, t.detectedAt),
  // "Show all cup-and-handles in the last week"
  typeIdx:          index('pattern_signals_type_idx').on(t.patternType, t.detectedAt),
}))

export type PatternSignal    = typeof patternSignals.$inferSelect
export type NewPatternSignal = typeof patternSignals.$inferInsert
