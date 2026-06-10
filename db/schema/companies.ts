// ─── companies ────────────────────────────────────────────────────────────────
//
// Master registry of every ticker the app tracks.
//
// Populated from two sources, both run as daily jobs:
//   • iShares IWV ETF holdings (Russell 3000, ~3,000 US listings)
//   • NSE Nifty 500 constituents file (~500 Indian listings)
//
// Canonical `ticker` follows Yahoo conventions:
//   • US:     "AAPL", "MSFT", "BRK.B"      (no suffix, dots for share class)
//   • India:  "RELIANCE.NS", "TCS.NS"      (.NS = NSE, .BO = BSE)
//   • Index:  "^GSPC", "^NSEI"             (carat prefix)
//
// This file is imported by every API route that needs to resolve a ticker
// to its CIK (for SEC ingestion), sector, country, etc.

import { pgTable, uuid, text, boolean, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const companies = pgTable('companies', {
  // ── Identity ────────────────────────────────────────────────────────────────
  id:            uuid('id').defaultRandom().primaryKey(),
  ticker:        text('ticker').notNull(),                 // canonical, Yahoo-style — see file header
  name:          text('name').notNull(),                   // "Apple Inc."

  // ── Identifiers across sources ──────────────────────────────────────────────
  cik:           text('cik'),                              // SEC CIK, 10-digit zero-padded.  NULL for non-SEC filers
  isin:          text('isin'),                             // 12-char ISIN — useful when adding paid data providers later
  figi:          text('figi'),                             // OpenFIGI BBG-prefixed identifier (we resolve these in smart-money route)
  cusip:         text('cusip'),                            // 9-char CUSIP (US/Canada securities)

  // ── Listing details ────────────────────────────────────────────────────────
  exchange:      text('exchange'),                         // "NMS" (NASDAQ), "NYQ" (NYSE), "NSE", "BSE"
  country:       text('country').notNull(),                // ISO-2: "US", "IN"
  currency:      text('currency'),                         // "USD", "INR"

  // ── Classification ─────────────────────────────────────────────────────────
  sector:        text('sector'),                           // GICS-style ("Technology", "Financials") — enriched from Yahoo
  industry:      text('industry'),                         // GICS industry ("Software", "Banks")
  sicCode:       text('sic_code'),                         // SEC SIC code (numeric, e.g. "7372") — for SEC-filer companies only

  // ── UI metadata ────────────────────────────────────────────────────────────
  logoDomain:    text('logo_domain'),                      // "apple.com" → resolves to https://logo.clearbit.com/apple.com
  website:       text('website'),                          // canonical company URL
  description:   text('description'),                      // short blurb (from Yahoo "longBusinessSummary")

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  isActive:      boolean('is_active').notNull().default(true), // false = delisted, M&A'd, etc.
  firstSeen:     timestamp('first_seen', { withTimezone: true }).defaultNow().notNull(),
  lastVerified:  timestamp('last_verified', { withTimezone: true }).defaultNow().notNull(), // updated on every ingestion run that confirms presence

  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // ── Indexes ────────────────────────────────────────────────────────────────
  tickerIdx:     uniqueIndex('companies_ticker_idx').on(t.ticker),      // primary lookup path
  cikIdx:        index('companies_cik_idx').on(t.cik),                  // for SEC ingestion joins
  countryIdx:    index('companies_country_idx').on(t.country),          // for US-vs-India screener filters
  sectorIdx:     index('companies_sector_idx').on(t.sector),            // screener "Technology" filter
  activeIdx:     index('companies_active_idx').on(t.isActive),
}))

export type Company       = typeof companies.$inferSelect
export type NewCompany    = typeof companies.$inferInsert
