import { describe, it, expect } from 'vitest'
import { runBacktest, computeSignals, MIN_BARS } from '@/lib/backtest'
import { decodeScreener, runScreen, sectorsOf, SCREENER_COLUMNS, type ScreenerFile } from '@/lib/screener'
import { parseFredCsv, parseMoney, usDateToIso, mapIpoMonth, mapEarningsDay } from '@/lib/providers/public-data'
import { toKeylessSymbol } from '@/lib/providers/symbols'
import type { Candle } from '@/lib/patterns/types'

const DAY = 86_400
const mk = (closes: number[], opens?: number[]): Candle[] =>
  closes.map((c, i) => ({ time: 1_600_000_000 + i * DAY, open: opens?.[i] ?? c, high: Math.max(c, opens?.[i] ?? c) * 1.01, low: Math.min(c, opens?.[i] ?? c) * 0.99, close: c, volume: 1000 }))

// ── Backtester ───────────────────────────────────────────────────────────────

describe('backtester', () => {
  const rising = mk(Array.from({ length: 400 }, (_, i) => 100 + i))

  it('refuses to report on too little data', () => {
    expect(runBacktest(mk(Array.from({ length: MIN_BARS - 1 }, (_, i) => 100 + i)), { id: 'sma-cross', fast: 5, slow: 20 })).toBeNull()
  })

  it('benchmark equals the buy-and-hold return exactly', () => {
    const r = runBacktest(rising, { id: 'sma-cross', fast: 5, slow: 20 })!
    expect(r.benchmark.totalReturnPct).toBeCloseTo((499 / 100 - 1) * 100, 6)
    expect(r.benchEquity[0]).toBe(1)
  })

  it('in a steady uptrend an MA cross enters once and stays in', () => {
    const r = runBacktest(rising, { id: 'sma-cross', fast: 5, slow: 20 }, { costBps: 0 })!
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0].exitTime).toBeNull()
    expect(r.strategy.totalReturnPct).toBeGreaterThan(0)
    // It waits for the slow average, so it captures less than buy-and-hold.
    expect(r.strategy.totalReturnPct).toBeLessThan(r.benchmark.totalReturnPct)
  })

  it('NO LOOK-AHEAD: changing future bars never changes past equity', () => {
    const base = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 12 + i * 0.05)
    const altered = [...base]
    for (let i = 200; i < 300; i++) altered[i] = base[i] * (i % 2 ? 3 : 0.3)   // wildly different future
    for (const cfg of [{ id: 'sma-cross', fast: 5, slow: 20 }, { id: 'rsi-reversion' }, { id: 'donchian-breakout', entryLen: 20, exitLen: 10 }] as const) {
      const a = runBacktest(mk(base), cfg)!, b = runBacktest(mk(altered), cfg)!
      for (let i = 0; i < 200; i++) expect(a.equity[i], `${cfg.id} bar ${i}`).toBeCloseTo(b.equity[i], 10)
    }
  })

  it('signals at bar i depend only on bars up to i', () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 5) * 10)
    const full = computeSignals(mk(closes), { id: 'donchian-breakout', entryLen: 20, exitLen: 10 })
    const partial = computeSignals(mk(closes.slice(0, 120)), { id: 'donchian-breakout', entryLen: 20, exitLen: 10 })
    expect(full.slice(0, 120)).toEqual(partial)
  })

  it('executes at the NEXT bar open, not the signal bar close', () => {
    // Flat at 100, then a jump: close[60]=200 with next open 150.
    const closes = Array.from({ length: 120 }, (_, i) => (i < 60 ? 100 : 200))
    const opens  = closes.map((c, i) => (i === 61 ? 150 : c))
    const r = runBacktest(mk(closes, opens), { id: 'donchian-breakout', entryLen: 20, exitLen: 10 }, { costBps: 0 })!
    expect(r.trades[0].entryPrice).toBe(150)
    expect(r.trades[0].entryTime).toBe(1_600_000_000 + 61 * DAY)
  })

  it('trading costs reduce returns', () => {
    const wavy = mk(Array.from({ length: 500 }, (_, i) => 100 + Math.sin(i / 6) * 15))
    const free = runBacktest(wavy, { id: 'sma-cross', fast: 3, slow: 10 }, { costBps: 0 })!
    const paid = runBacktest(wavy, { id: 'sma-cross', fast: 3, slow: 10 }, { costBps: 50 })!
    expect(free.trades.length).toBeGreaterThan(3)
    expect(paid.strategy.totalReturnPct).toBeLessThan(free.strategy.totalReturnPct)
  })

  it('max drawdown is never positive and exposure is a percentage', () => {
    const r = runBacktest(mk(Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 9) * 20)), { id: 'rsi-reversion' })!
    expect(r.strategy.maxDrawdownPct).toBeLessThanOrEqual(0)
    expect(r.benchmark.maxDrawdownPct).toBeLessThan(0)
    expect(r.exposurePct).toBeGreaterThanOrEqual(0)
    expect(r.exposurePct).toBeLessThanOrEqual(100)
  })

  it('an invalid crossover (fast >= slow) never trades', () => {
    const r = runBacktest(rising, { id: 'sma-cross', fast: 50, slow: 20 })!
    expect(r.trades).toHaveLength(0)
    expect(r.strategy.totalReturnPct).toBe(0)
  })

  it('ignores corrupt candles instead of producing NaN', () => {
    const bad = [...rising]
    bad[100] = { ...bad[100], close: NaN }
    bad[150] = { ...bad[150], open: 0 }
    const r = runBacktest(bad, { id: 'sma-cross', fast: 5, slow: 20 })!
    expect(Number.isFinite(r.strategy.totalReturnPct)).toBe(true)
    expect(r.equity.every(Number.isFinite)).toBe(true)
  })
})

// ── Screener ─────────────────────────────────────────────────────────────────

describe('screener', () => {
  const row = (ticker: string, sector: string, revenue: number | null, netIncome: number | null, netMargin: number | null, roe: number | null, fcf: number | null) =>
    [ticker, `${ticker} Corp`, 1, '7372', sector, 'CA', revenue, netIncome, null, 0.5, 0.2, netMargin, roe, 0.1, 1.2, 1, fcf, 100, 50]
  const file: ScreenerFile = {
    generatedAt: '2026-01-01T00:00:00Z', fiscalYear: 2025, source: 't', note: '', columns: [...SCREENER_COLUMNS],
    rows: [
      row('BIG', 'Technology', 5e11, 1e11, 0.2, 0.4, 9e10),
      row('MID', 'Technology', 5e9, -1e8, -0.02, -0.05, -1e7),
      row('BANK', 'Financials', 8e10, 2e10, 0.25, 0.12, null),
      row('NEW', 'Healthcare', null, -5e7, null, null, -4e7),
    ],
  }
  const companies = decodeScreener(file)

  it('decodes the compact file', () => {
    expect(companies).toHaveLength(4)
    expect(companies[0]).toMatchObject({ ticker: 'BIG', sector: 'Technology', revenue: 5e11, netMargin: 0.2 })
    expect(sectorsOf(companies)).toEqual(['Financials', 'Healthcare', 'Technology'])
  })
  it('filters by sector, size and profitability', () => {
    expect(runScreen(companies, { sector: 'Technology' }).map(c => c.ticker)).toEqual(['BIG', 'MID'])
    expect(runScreen(companies, { minRevenue: 1e10 }).map(c => c.ticker)).toEqual(['BIG', 'BANK'])
    expect(runScreen(companies, { profitableOnly: true }).map(c => c.ticker)).toEqual(['BIG', 'BANK'])
    expect(runScreen(companies, { positiveFcfOnly: true }).map(c => c.ticker)).toEqual(['BIG'])
  })
  it('treats a missing metric as NOT passing a filter on it', () => {
    expect(runScreen(companies, { minNetMargin: -1 }).map(c => c.ticker)).not.toContain('NEW')
    expect(runScreen(companies, { minRoe: -1 }).map(c => c.ticker)).not.toContain('NEW')
  })
  it('sorts with nulls last in both directions', () => {
    expect(runScreen(companies, {}, 'revenue', 'desc').map(c => c.ticker)).toEqual(['BIG', 'BANK', 'MID', 'NEW'])
    expect(runScreen(companies, {}, 'revenue', 'asc').map(c => c.ticker)).toEqual(['MID', 'BANK', 'BIG', 'NEW'])
    expect(runScreen(companies, {}, 'ticker', 'asc').map(c => c.ticker)).toEqual(['BANK', 'BIG', 'MID', 'NEW'])
  })
  it('searches ticker and name case-insensitively', () => {
    expect(runScreen(companies, { query: 'ban' }).map(c => c.ticker)).toEqual(['BANK'])
    expect(runScreen(companies, { query: 'zzz' })).toEqual([])
  })
})

// ── Keyless public data parsers ──────────────────────────────────────────────

describe('public data parsers', () => {
  it('parses FRED CSV and marks blanks as missing', () => {
    expect(parseFredCsv('observation_date,DGS10\n2026-11-06,4.86\n2026-11-09,\n2026-11-10,4.88\n')).toEqual([
      { date: '2026-11-06', value: '4.86' }, { date: '2026-11-09', value: '.' }, { date: '2026-11-10', value: '4.88' },
    ])
    expect(parseFredCsv('<html>error</html>')).toEqual([])
  })
  it('parses money strings', () => {
    expect(parseMoney('$1.15')).toBe(1.15)
    expect(parseMoney('($0.20)')).toBe(-0.2)
    expect(parseMoney('-$0.05')).toBe(-0.05)
    expect(parseMoney('$386,964,914,000')).toBe(386964914000)
    expect(parseMoney('N/A')).toBeNull()
    expect(parseMoney('')).toBeNull()
    expect(parseMoney(undefined)).toBeNull()
  })
  it('converts US dates and rejects anything else', () => {
    expect(usDateToIso('11/02/2026')).toBe('2026-11-02')
    expect(usDateToIso('1/5/2026')).toBe('2026-01-05')
    expect(usDateToIso('2026-11-02')).toBe('')
    expect(usDateToIso('13/45/2026')).toBe('')
    expect(usDateToIso(null)).toBe('')
  })
  it('maps the Nasdaq IPO calendar without adding opinions', () => {
    const ipos = mapIpoMonth({
      priced:   { rows: [{ proposedTickerSymbol: 'NARA', companyName: 'Narragansett Bancorp, Inc.', proposedExchange: 'NASDAQ Capital', proposedSharePrice: '10.00', sharesOffered: '9,098,800', pricedDate: '11/02/2026' }] },
      upcoming: { upcomingTable: { rows: [{ proposedTickerSymbol: 'XYZ', companyName: 'Xyz Inc', proposedSharePrice: '70.00-78.00', expectedPriceDate: '11/20/2026' }] } },
      filed:    { rows: null },
    })
    expect(ipos).toHaveLength(2)
    expect(ipos[0]).toMatchObject({ ticker: 'NARA', stage: 'priced', date: '2026-11-02', priceRange: '$10.00' })
    expect(ipos[1]).toMatchObject({ stage: 'upcoming', priceRange: '$70.00–$78.00' })
    expect(JSON.stringify(ipos)).not.toMatch(/rating|bullish|bearish/)
  })
  it('maps the Nasdaq earnings calendar', () => {
    const rows = mapEarningsDay('2026-11-12', [
      { symbol: 'csco', name: 'Cisco Systems, Inc.', time: 'time-after-hours', marketCap: '$386,964,914,000', epsForecast: '$1.15', fiscalQuarterEnding: 'Oct/2026' },
      { symbol: 'ABC', time: 'time-pre-market', eps: '($0.10)', epsForecast: 'N/A' },
      { name: 'no symbol' },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ symbol: 'CSCO', hour: 'amc', epsEstimate: 1.15, epsActual: null, marketCap: 386964914000 })
    expect(rows[1]).toMatchObject({ hour: 'bmo', epsActual: -0.1, epsEstimate: null })
  })
  it('maps vendor-specific symbols to the keyless grammar', () => {
    expect(toKeylessSymbol('VIX')).toBe('^VIX')
    expect(toKeylessSymbol('BINANCE:BTCUSDT')).toBe('BTC-USD')
    expect(toKeylessSymbol('OANDA:EUR_USD')).toBe('EURUSD=X')
    expect(toKeylessSymbol('AAPL')).toBe('AAPL')
  })
})
