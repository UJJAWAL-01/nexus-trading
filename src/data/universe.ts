// ─────────────────────────────────────────────────────────────────────────────
// Pattern-screener universe (spec §4.1).
//
// A curated, sector-tagged slice of the S&P 500 (US) + Nifty 500 (.NS, India).
// Refresh quarterly. The scan pipeline treats this as the base set and merges in
// the user's watchlist dynamically, so it scales to the full ~1000-name universe
// by extending these arrays — no code changes needed.
// ─────────────────────────────────────────────────────────────────────────────

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

const IN: UniverseEntry[] = [
  ['RELIANCE.NS', 'Reliance Industries', 'Energy'],
  ['TCS.NS', 'Tata Consultancy Services', 'Technology'],
  ['INFY.NS', 'Infosys', 'Technology'],
  ['HDFCBANK.NS', 'HDFC Bank', 'Financials'],
  ['ICICIBANK.NS', 'ICICI Bank', 'Financials'],
  ['SBIN.NS', 'State Bank of India', 'Financials'],
  ['AXISBANK.NS', 'Axis Bank', 'Financials'],
  ['KOTAKBANK.NS', 'Kotak Mahindra Bank', 'Financials'],
  ['BHARTIARTL.NS', 'Bharti Airtel', 'Communication'],
  ['ITC.NS', 'ITC', 'Consumer Staples'],
  ['HINDUNILVR.NS', 'Hindustan Unilever', 'Consumer Staples'],
  ['LT.NS', 'Larsen & Toubro', 'Industrials'],
  ['WIPRO.NS', 'Wipro', 'Technology'],
  ['HCLTECH.NS', 'HCL Technologies', 'Technology'],
  ['MARUTI.NS', 'Maruti Suzuki', 'Consumer Discretionary'],
  ['TATAMOTORS.NS', 'Tata Motors', 'Consumer Discretionary'],
  ['SUNPHARMA.NS', 'Sun Pharmaceutical', 'Health Care'],
  ['ASIANPAINT.NS', 'Asian Paints', 'Materials'],
  ['TITAN.NS', 'Titan Company', 'Consumer Discretionary'],
  ['BAJFINANCE.NS', 'Bajaj Finance', 'Financials'],
  ['ADANIENT.NS', 'Adani Enterprises', 'Industrials'],
  ['ONGC.NS', 'Oil & Natural Gas Corp', 'Energy'],
  ['NTPC.NS', 'NTPC', 'Utilities'],
  ['POWERGRID.NS', 'Power Grid Corp', 'Utilities'],
  ['TATASTEEL.NS', 'Tata Steel', 'Materials'],
  ['JSWSTEEL.NS', 'JSW Steel', 'Materials'],
  ['ULTRACEMCO.NS', 'UltraTech Cement', 'Materials'],
  ['NESTLEIND.NS', 'Nestle India', 'Consumer Staples'],
  ['M&M.NS', 'Mahindra & Mahindra', 'Consumer Discretionary'],
  ['DRREDDY.NS', "Dr. Reddy's Labs", 'Health Care'],
].map(([symbol, name, sector]) => ({ symbol, name, sector, country: 'IN' as const }))

export const UNIVERSE: UniverseEntry[] = [...US, ...IN]

export const UNIVERSE_BY_SYMBOL: Record<string, UniverseEntry> =
  Object.fromEntries(UNIVERSE.map(e => [e.symbol, e]))

export const SECTORS: string[] = [...new Set(UNIVERSE.map(e => e.sector))].sort()
