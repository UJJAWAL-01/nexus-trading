import { describe, it, expect } from 'vitest'
import { csvCell, toCsv, parseCsv, parseBackup } from '@/lib/export'
import { positionPnl, sanitizePosition } from '@/store/portfolio'

describe('CSV export', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })
  it('neutralises spreadsheet formula injection in text cells only', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`)
    expect(csvCell('+1+1')).toBe("'+1+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell(-12.5)).toBe('-12.5')
  })
  it('handles empty and non-finite values', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(NaN)).toBe('')
    expect(csvCell(Infinity)).toBe('')
  })
  it('round-trips through the parser', () => {
    const csv = toCsv(['symbol', 'name', 'qty'], [['AAPL', 'Apple, Inc.', 10], ['M&M.NS', 'Mahindra "M&M"', -5]])
    expect(parseCsv(csv)).toEqual([
      ['symbol', 'name', 'qty'],
      ['AAPL', 'Apple, Inc.', '10'],
      ['M&M.NS', 'Mahindra "M&M"', '-5'],
    ])
  })
  it('parses LF files, a BOM and skips blank lines', () => {
    expect(parseCsv('﻿a,b\n1,2\n\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })
})

describe('workspace backup validation', () => {
  const good = { format: 'nexus-workspace-backup', version: 1, exportedAt: '2026-01-01T00:00:00Z', keys: { 'nexus-watchlist': '{"a":1}' } }
  it('accepts a valid backup', () => {
    expect(Object.keys(parseBackup(JSON.stringify(good)).keys)).toEqual(['nexus-watchlist'])
  })
  it('rejects non-JSON and foreign files', () => {
    expect(() => parseBackup('not json')).toThrow()
    expect(() => parseBackup('{"hello":"world"}')).toThrow()
    expect(() => parseBackup(JSON.stringify({ ...good, version: 99 }))).toThrow()
  })
  it('drops keys outside the nexus namespace and non-string values', () => {
    const b = parseBackup(JSON.stringify({ ...good, keys: { 'nexus-watchlist': 'x', 'auth-token': 'steal', 'nexus-obj': { a: 1 } } }))
    expect(Object.keys(b.keys)).toEqual(['nexus-watchlist'])
  })
  it('rejects a backup with nothing usable', () => {
    expect(() => parseBackup(JSON.stringify({ ...good, keys: { other: 'x' } }))).toThrow()
  })
})

describe('portfolio maths', () => {
  it('computes long position P&L', () => {
    const r = positionPnl({ qty: 10, avgCost: 100 }, 110, 2)
    expect(r.marketValue).toBe(1100)
    expect(r.costBasis).toBe(1000)
    expect(r.unrealized).toBe(100)
    expect(r.unrealizedPct).toBeCloseTo(10)
    expect(r.dayChange).toBe(20)
  })
  it('computes short position P&L with the right sign', () => {
    const r = positionPnl({ qty: -10, avgCost: 100 }, 90, -1)
    expect(r.unrealized).toBe(100)          // price fell, short gained
    expect(r.unrealizedPct).toBeCloseTo(10)
    expect(r.dayChange).toBe(10)
  })
  it('returns nulls, not zeros, when there is no price', () => {
    const r = positionPnl({ qty: 5, avgCost: 20 }, null, null)
    expect(r.marketValue).toBeNull()
    expect(r.unrealized).toBeNull()
    expect(r.costBasis).toBe(100)
  })
  it('handles a zero cost basis without dividing by zero', () => {
    expect(positionPnl({ qty: 5, avgCost: 0 }, 10, 0).unrealizedPct).toBeNull()
  })
})

describe('position validation', () => {
  it('normalises good input', () => {
    expect(sanitizePosition({ symbol: ' aapl ', qty: '10', avgCost: '150.5' })).toEqual({ symbol: 'AAPL', qty: 10, avgCost: 150.5 })
    expect(sanitizePosition({ symbol: 'reliance.ns', qty: -3, avgCost: 2500 })?.symbol).toBe('RELIANCE.NS')
  })
  it('rejects bad symbols and numbers', () => {
    expect(sanitizePosition({ symbol: '<script>', qty: 1, avgCost: 1 })).toBeNull()
    expect(sanitizePosition({ symbol: 'AAPL', qty: 0, avgCost: 1 })).toBeNull()
    expect(sanitizePosition({ symbol: 'AAPL', qty: 'abc', avgCost: 1 })).toBeNull()
    expect(sanitizePosition({ symbol: 'AAPL', qty: 1, avgCost: -5 })).toBeNull()
    expect(sanitizePosition({ symbol: 'AAPL', qty: Infinity, avgCost: 1 })).toBeNull()
  })
})
