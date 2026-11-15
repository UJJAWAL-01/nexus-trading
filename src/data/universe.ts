// ─────────────────────────────────────────────────────────────────────────────
// Pattern-screener universe (spec §4.1).
//
// US: a curated, sector-tagged slice of the S&P 500 plus index ETFs.
// India: every Nifty 500 constituent (src/data/nifty500.ts, generated).
// The scan pipeline also merges in the user's watchlist.
// ─────────────────────────────────────────────────────────────────────────────

import { NIFTY500 } from '@/data/nifty500'

export interface UniverseEntry {
  symbol:  string
  name:    string
  sector:  string
  country: 'US' | 'IN'
}

const US: UniverseEntry[] = [
  // Technology
  ['AAPL', 'Apple', 'Technology'], ['MSFT', 'Microsoft', 'Technology'],
  ['NVDA', 'NVIDIA', 'Technology'], ['AVGO', 'Broadcom', 'Technology'],
  ['ORCL', 'Oracle', 'Technology'], ['CRM', 'Salesforce', 'Technology'],
  ['ADBE', 'Adobe', 'Technology'], ['AMD', 'Advanced Micro Devices', 'Technology'],
  ['INTC', 'Intel', 'Technology'], ['CSCO', 'Cisco', 'Technology'],
  ['QCOM', 'Qualcomm', 'Technology'], ['TXN', 'Texas Instruments', 'Technology'],
  ['IBM', 'IBM', 'Technology'], ['NOW', 'ServiceNow', 'Technology'],
  ['MU', 'Micron', 'Technology'], ['PLTR', 'Palantir', 'Technology'],
  // Communication
  ['GOOGL', 'Alphabet', 'Communication'], ['META', 'Meta Platforms', 'Communication'],
  ['NFLX', 'Netflix', 'Communication'], ['DIS', 'Walt Disney', 'Communication'],
  ['T', 'AT&T', 'Communication'], ['VZ', 'Verizon', 'Communication'],
  ['TMUS', 'T-Mobile', 'Communication'],
  // Consumer Discretionary
  ['AMZN', 'Amazon', 'Consumer Discretionary'], ['TSLA', 'Tesla', 'Consumer Discretionary'],
  ['HD', 'Home Depot', 'Consumer Discretionary'], ['MCD', "McDonald's", 'Consumer Discretionary'],
  ['NKE', 'Nike', 'Consumer Discretionary'], ['SBUX', 'Starbucks', 'Consumer Discretionary'],
  ['LOW', "Lowe's", 'Consumer Discretionary'], ['BKNG', 'Booking', 'Consumer Discretionary'],
  // Consumer Staples
  ['WMT', 'Walmart', 'Consumer Staples'], ['PG', 'Procter & Gamble', 'Consumer Staples'],
  ['KO', 'Coca-Cola', 'Consumer Staples'], ['PEP', 'PepsiCo', 'Consumer Staples'],
  ['COST', 'Costco', 'Consumer Staples'], ['MDLZ', 'Mondelez', 'Consumer Staples'],
  // Financials
  ['BRK.B', 'Berkshire Hathaway', 'Financials'], ['JPM', 'JPMorgan Chase', 'Financials'],
  ['V', 'Visa', 'Financials'], ['MA', 'Mastercard', 'Financials'],
  ['BAC', 'Bank of America', 'Financials'], ['WFC', 'Wells Fargo', 'Financials'],
  ['GS', 'Goldman Sachs', 'Financials'], ['MS', 'Morgan Stanley', 'Financials'],
  ['AXP', 'American Express', 'Financials'], ['BLK', 'BlackRock', 'Financials'],
  // Health Care
  ['UNH', 'UnitedHealth', 'Health Care'], ['LLY', 'Eli Lilly', 'Health Care'],
  ['JNJ', 'Johnson & Johnson', 'Health Care'], ['ABBV', 'AbbVie', 'Health Care'],
  ['MRK', 'Merck', 'Health Care'], ['PFE', 'Pfizer', 'Health Care'],
  ['TMO', 'Thermo Fisher', 'Health Care'], ['ABT', 'Abbott', 'Health Care'],
  // Industrials
  ['CAT', 'Caterpillar', 'Industrials'], ['BA', 'Boeing', 'Industrials'],
  ['GE', 'GE Aerospace', 'Industrials'], ['HON', 'Honeywell', 'Industrials'],
  ['UPS', 'United Parcel Service', 'Industrials'], ['RTX', 'RTX', 'Industrials'],
  ['DE', 'Deere', 'Industrials'], ['LMT', 'Lockheed Martin', 'Industrials'],
  // Energy
  ['XOM', 'Exxon Mobil', 'Energy'], ['CVX', 'Chevron', 'Energy'],
  ['COP', 'ConocoPhillips', 'Energy'], ['SLB', 'Schlumberger', 'Energy'],
  // Materials / Utilities / Real Estate
  ['LIN', 'Linde', 'Materials'], ['FCX', 'Freeport-McMoRan', 'Materials'],
  ['NEE', 'NextEra Energy', 'Utilities'], ['DUK', 'Duke Energy', 'Utilities'],
  ['PLD', 'Prologis', 'Real Estate'], ['AMT', 'American Tower', 'Real Estate'],
  // Popular ETFs (always useful in a screener)
  ['SPY', 'S&P 500 ETF', 'Index'], ['QQQ', 'Nasdaq 100 ETF', 'Index'],
  ['IWM', 'Russell 2000 ETF', 'Index'], ['DIA', 'Dow Jones ETF', 'Index'],
].map(([symbol, name, sector]) => ({ symbol, name, sector, country: 'US' as const }))

// India: the full Nifty 500, generated from the NSE constituent list.
const IN: UniverseEntry[] = NIFTY500.map(([symbol, name, sector]) => ({ symbol: `${symbol}.NS`, name, sector, country: 'IN' as const }))

export const UNIVERSE: UniverseEntry[] = [...US, ...IN]

export const UNIVERSE_BY_SYMBOL: Record<string, UniverseEntry> =
  Object.fromEntries(UNIVERSE.map(e => [e.symbol, e]))

export const SECTORS: string[] = [...new Set(UNIVERSE.map(e => e.sector))].sort()

// ── Scan chunks ──────────────────────────────────────────────────────────────
// The screener scans a market in fixed-size chunks so each request stays small
// and each chunk can be cached on its own. Server and browser share this maths.
export type ScanMarket = 'US' | 'IN'
export const SCAN_CHUNK = 30

export const marketEntries = (market: ScanMarket): UniverseEntry[] => UNIVERSE.filter(e => e.country === market)
export const chunkCount = (market: ScanMarket): number => Math.ceil(marketEntries(market).length / SCAN_CHUNK)
export const chunkEntries = (market: ScanMarket, index: number): UniverseEntry[] =>
  marketEntries(market).slice(index * SCAN_CHUNK, (index + 1) * SCAN_CHUNK)
