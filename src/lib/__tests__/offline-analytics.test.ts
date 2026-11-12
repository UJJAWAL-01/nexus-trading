import { describe, it, expect } from 'vitest'
import { buildPeriods, sicToSector, type CompanyFacts } from '@/lib/sec-fundamentals'
import { buildRuleNote, fixedIncomeRuleInsights } from '@/lib/rule-notes'

// ── SEC companyfacts → annual periods ────────────────────────────────────────

const fact = (start: string | undefined, end: string, val: number, filed: string, form = '10-K') =>
  ({ ...(start ? { start } : {}), end, val, filed, form })

const facts: CompanyFacts = {
  entityName: 'Test Corp',
  facts: {
    'us-gaap': {
      Revenues: { units: { USD: [
        fact('2023-01-01', '2023-12-31', 1000, '2024-02-01'),
        fact('2024-01-01', '2024-12-31', 1200, '2025-02-01'),
        // Restated FY2023 in the FY2024 10-K: later filing must win.
        fact('2023-01-01', '2023-12-31', 1010, '2025-02-01'),
        // Quarterly and year-to-date values share end dates with nothing annual: must be ignored.
        fact('2024-10-01', '2024-12-31', 330, '2025-02-01'),
        fact('2024-01-01', '2024-09-30', 870, '2024-11-01', '10-Q'),
      ],
      // A foreign-currency series must never be read as USD.
      JPY: [fact('2024-01-01', '2024-12-31', 150000, '2025-02-01')] } },
      NetIncomeLoss: { units: { USD: [
        fact('2023-01-01', '2023-12-31', 100, '2024-02-01'),
        fact('2024-01-01', '2024-12-31', 180, '2025-02-01'),
      ] } },
      GrossProfit: { units: { USD: [fact('2024-01-01', '2024-12-31', 600, '2025-02-01')] } },
      NetCashProvidedByUsedInOperatingActivities: { units: { USD: [fact('2024-01-01', '2024-12-31', 300, '2025-02-01')] } },
      PaymentsToAcquirePropertyPlantAndEquipment: { units: { USD: [fact('2024-01-01', '2024-12-31', 50, '2025-02-01')] } },
      StockholdersEquity: { units: { USD: [
        fact(undefined, '2024-12-31', 900, '2025-02-01'),
        // Balance at a quarter-end that is not a fiscal year-end: ignored.
        fact(undefined, '2024-09-30', 850, '2024-11-01', '10-Q'),
      ] } },
      Assets: { units: { USD: [fact(undefined, '2024-12-31', 3600, '2025-02-01')] } },
      CommonStockSharesOutstanding: { units: { shares: [fact(undefined, '2024-12-31', 100, '2025-02-01')] } },
      EarningsPerShareDiluted: { units: { 'USD/shares': [fact('2024-01-01', '2024-12-31', 1.8, '2025-02-01')] } },
    },
  },
}

describe('SEC fundamentals', () => {
  const { periods } = buildPeriods(facts)

  it('keeps only annual periods, newest first', () => {
    expect(periods.map(p => p.fiscalPeriodEnd)).toEqual(['2024-12-31', '2023-12-31'])
    expect(periods.every(p => p.periodType === 'annual')).toBe(true)
  })
  it('uses the annual figure, not the quarterly or year-to-date one', () => {
    expect(periods[0].metrics.Revenues).toBe(1200)
  })
  it('takes the most recently filed revision of a period', () => {
    expect(periods[1].metrics.Revenues).toBe(1010)
  })
  it('never treats a foreign-currency series as USD', () => {
    expect(periods[0].units.Revenues).toBe('USD')
    expect(periods.some(p => p.metrics.Revenues === 150000)).toBe(false)
  })
  it('attaches balance-sheet values only at fiscal year-ends', () => {
    expect(periods[0].metrics.StockholdersEquity).toBe(900)
    expect(periods.find(p => p.fiscalPeriodEnd === '2024-09-30')).toBeUndefined()
  })
  it('derives margins, returns and free cash flow', () => {
    const c = periods[0].computed
    expect(c.GrossMargin).toBeCloseTo(0.5)
    expect(c.NetMargin).toBeCloseTo(0.15)
    expect(c.ROE).toBeCloseTo(0.2)
    expect(c.ROA).toBeCloseTo(0.05)
    expect(c.FreeCashFlow).toBe(250)
    expect(c.BookValuePerShare).toBe(9)
  })
  it('returns null, not zero or Infinity, when an input is missing', () => {
    expect(periods[1].computed.GrossMargin).toBeNull()
    expect(periods[1].computed.ROE).toBeNull()
    expect(periods[1].computed.FreeCashFlow).toBeNull()
  })
  it('derives fiscal year from the period end date', () => {
    expect(periods[0].fiscalYear).toBe(2024)
  })
  it('handles a filer with no XBRL data', () => {
    expect(buildPeriods({}).periods).toEqual([])
    expect(buildPeriods({ facts: {} }).periods).toEqual([])
  })
  it('maps SIC codes to sectors', () => {
    expect(sicToSector('7372')).toBe('Technology')
    expect(sicToSector('6021')).toBe('Financials')
    expect(sicToSector('2834')).toBe('Healthcare')
    expect(sicToSector('1311')).toBe('Energy')
    expect(sicToSector('4911')).toBe('Utilities')
    expect(sicToSector(undefined)).toBeNull()
    expect(sicToSector('abc')).toBeNull()
  })
})

// ── Rule-based chart note ────────────────────────────────────────────────────

describe('rule-based chart note', () => {
  const digest = {
    symbol: 'AAPL', timeframe: '1D', lastClose: 348.51,
    rating: { overall: { label: 'Buy', score: 0.42 }, movingAvg: { label: 'Strong Buy' }, oscillators: { label: 'Neutral' } },
    structure: { bias: 'bullish', label: 'Uptrend', support: 322.97, resistance: 353.75 },
    patterns: [{ name: 'Ascending Triangle', direction: 'bullish', status: 'forming', confidence: 72, breakoutLevel: 353.75, target: 380, invalidation: 335 }],
    keyLevels: { support: 322.97, resistance: 353.75 },
    indicatorSnapshot: { rsi: 74, macdState: 'Bullish', volVs20: 1.3, atrPct: 2.1, distFrom50: 4, distFrom200: 18.2 },
  }
  const note = buildRuleNote(digest)

  it('derives bias and strength from the composite rating', () => {
    expect(note.bias).toBe('bullish')
    expect(note.biasStrength).toBe('moderate')
    expect(buildRuleNote({ ...digest, rating: { overall: { label: 'Strong Sell', score: -0.7 } } }).bias).toBe('bearish')
  })
  it('falls back to market structure when the rating is flat', () => {
    expect(buildRuleNote({ rating: { overall: { label: 'Neutral', score: 0 } }, structure: { bias: 'bearish' } }).bias).toBe('bearish')
  })
  it('only cites prices that were supplied', () => {
    const allowed = ['348.51', '322.97', '353.75', '380.00', '335.00']
    const text = [note.narrative, note.bullCase, note.bearCase, note.keyLevelToWatch, note.riskNote].join(' ')
    const cited = text.match(/\d{3}\.\d{2}/g) ?? []
    expect(cited.length).toBeGreaterThan(0)
    for (const p of cited) expect(allowed, p).toContain(p)
  })
  it('names the pattern, the RSI zone and the key level', () => {
    expect(note.headline).toContain('Ascending Triangle')
    expect(note.narrative).toContain('overbought')
    expect(note.keyLevelToWatch).toContain('353.75')
    expect(note.riskNote).toContain('335.00')
  })
  it('respects field length limits and always carries a disclaimer', () => {
    expect(note.headline.length).toBeLessThanOrEqual(140)
    expect(note.narrative.length).toBeLessThanOrEqual(900)
    expect(note.riskNote).toMatch(/not a forecast or advice/)
  })
  it('does not crash or invent data on an empty digest', () => {
    const empty = buildRuleNote({})
    expect(empty.bias).toBe('neutral')
    expect(empty.narrative).toContain('No chart pattern currently qualifies')
    expect(empty.keyLevelToWatch).toBe('No clear level identified')
    expect(empty.narrative).not.toMatch(/NaN|undefined|null/)
  })
})

// ── Rule-based fixed income summary ──────────────────────────────────────────

describe('rule-based fixed income insights', () => {
  const base = { market: 'US' as const, policyRate: 4.5, cpi: 3.0, stance: 'Hold', twoY: 4.2, fiveY: 4.0, tenY: 4.0, curveShape: 'Inverted', igOAS: 95, hyOAS: 320, dataQuality: 'Live' }

  it('computes the real rate, curve spread and term premium', () => {
    const text = fixedIncomeRuleInsights(base)
    expect(text).toContain('+1.50%')          // 4.5 - 3.0
    expect(text).toContain('-20bp')           // (4.0 - 4.2) * 100
    expect(text).toContain('inverted curve')
    expect(text).toContain('50bp below the policy rate')
    expect(text).toContain('tight')
  })
  it('skips lines whose inputs are missing instead of printing N/A', () => {
    const text = fixedIncomeRuleInsights({ ...base, twoY: null, igOAS: null, hyOAS: null, cpi: null })
    expect(text).not.toMatch(/N\/A|NaN|null|undefined/)
    expect(text).toContain('10Y yield is 4.00%')
  })
  it('says so plainly when there is no data', () => {
    expect(fixedIncomeRuleInsights({ ...base, policyRate: null, cpi: null, twoY: null, fiveY: null, tenY: null, igOAS: null, hyOAS: null }))
      .toBe('Not enough live rate data to summarise right now.')
  })
  it('labels India with the RBI repo rate', () => {
    expect(fixedIncomeRuleInsights({ ...base, market: 'IN' })).toContain('RBI repo rate')
  })
})
