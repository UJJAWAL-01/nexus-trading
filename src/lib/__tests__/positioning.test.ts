import { describe, it, expect } from 'vitest'
import {
  COT_CONTRACTS, cotStance, findShortVolume, finraSymbol, recentWeekdays, shortStats, summariseCot,
  type CotRawRow, type ShortDay,
} from '@/lib/positioning'
import { isAllowedHost } from '@/lib/providers/http'

const row = (code: string, date: string, oi: number, nl: number, ns: number, cl = 0, cs = 0): CotRawRow => ({
  cftc_contract_market_code: code, report_date_as_yyyy_mm_dd: `${date}T00:00:00.000`,
  open_interest_all: String(oi), noncomm_positions_long_all: String(nl), noncomm_positions_short_all: String(ns),
  comm_positions_long_all: String(cl), comm_positions_short_all: String(cs),
})
const week = (i: number) => new Date(Date.UTC(2025, 0, 7) + i * 7 * 86_400_000).toISOString().slice(0, 10)

describe('CFTC positioning', () => {
  it('summarises the latest report against its own history', () => {
    // 30 weeks: speculators go from 10% net short to 19% net long of open interest.
    const rows = Array.from({ length: 30 }, (_, i) => row('088691', week(i), 1000, 100 + i * 10, 200))
    const [gold] = summariseCot(rows)
    expect(gold).toMatchObject({ code: '088691', name: 'Gold', group: 'Metals', date: week(29), weeks: 30, openInterest: 1000 })
    expect(gold.specNet).toBe(190)
    expect(gold.specNetChange).toBe(10)
    expect(gold.specNetPct).toBeCloseTo(19, 10)
    expect(gold.rangePosition).toBeCloseTo(100, 10)          // most long it has been
    expect(gold.history[0]).toEqual({ date: week(0), specNetPct: -10 })
    expect(gold.history).toHaveLength(30)
  })
  it('accepts rows in any order and ignores duplicates of a date', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row('088691', week(i), 1000, 100 + i * 10, 200))
    const shuffled = [...rows].reverse().concat(rows[5])
    expect(summariseCot(shuffled)[0].history.map(h => h.date)).toEqual(rows.map((_, i) => week(i)))
  })
  it('gives no range position on too little history', () => {
    const s = summariseCot(Array.from({ length: 10 }, (_, i) => row('088691', week(i), 1000, 100 + i, 200)))[0]
    expect(s.rangePosition).toBeNull()
    expect(cotStance(s.rangePosition)).toBe('unknown')
    expect(summariseCot([row('088691', week(0), 1000, 1, 1)])[0].specNetChange).toBeNull()
  })
  it('drops unknown contracts and unusable rows instead of guessing', () => {
    expect(summariseCot([
      row('999999', week(0), 1000, 1, 1),                    // not on our list
      row('088691', 'garbage', 1000, 1, 1),                  // bad date
      row('088691', week(0), 0, 1, 1),                       // zero open interest would divide by zero
      { cftc_contract_market_code: '088691', report_date_as_yyyy_mm_dd: `${week(1)}T00:00:00.000`, open_interest_all: 'n/a' },
    ])).toEqual([])
    expect(JSON.stringify(summariseCot([row('088691', week(0), 1000, 5, 5)]))).not.toMatch(/NaN|Infinity/)
  })
  it('keeps contracts in the curated order and computes hedgers too', () => {
    const out = summariseCot([row('067651', week(0), 1000, 10, 5, 300, 420), row('13874A', week(0), 1000, 10, 5)])
    expect(out.map(c => c.code)).toEqual(['13874A', '067651'])
    expect(out[1].commNet).toBe(-120)
  })
  it('names the stance', () => {
    expect(cotStance(95)).toBe('crowded long')
    expect(cotStance(5)).toBe('crowded short')
    expect(cotStance(70)).toBe('long side')
    expect(cotStance(30)).toBe('short side')
    expect(cotStance(50)).toBe('middle')
  })
  it('every curated contract has a unique, well-formed code', () => {
    const codes = COT_CONTRACTS.map(c => c.code)
    expect(new Set(codes).size).toBe(codes.length)
    // Codes are interpolated into the CFTC query, so they must never contain quote or SQL characters.
    for (const c of codes) expect(c).toMatch(/^[0-9A-Z]{6}$/)
  })
})

const FILE = [
  'Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market',
  '20261113|A|316826.314547|259|553450.606448|B,Q,N',
  '20261113|AA|716238.685536|500|1240222.984423|B,Q,N',
  '20261113|AAPL|6815042.794270|25752|12364490.326956|B,Q,N',
  '20261113|BF/B|343265.250228|33|707256.070849|B,Q,N',
  '20261113|BAD|500|0|100|Q',
  '20261113|ZERO|0|0|0|Q',
  '12268',
].join('\n')

describe('FINRA short volume', () => {
  it('maps tickers to FINRA symbols and rejects anything that is not a US ticker', () => {
    expect(finraSymbol('aapl')).toBe('AAPL')
    expect(finraSymbol('BRK.B')).toBe('BRK/B')
    expect(finraSymbol('BRK-B')).toBe('BRK/B')
    for (const s of ['RELIANCE.NS', '^NSEI', 'BTC-USD', 'EURUSD=X', 'CL=F', 'TOOLONGX', '', 'A|B', 'AAPL\n20261113'])
      expect(finraSymbol(s), s).toBeNull()
  })
  it('finds exactly the requested symbol', () => {
    expect(findShortVolume(FILE, 'AAPL')).toEqual({ date: '2026-11-13', shortVolume: 6815043, totalVolume: 12364490, pct: expect.closeTo(55.118, 2) })
    expect(findShortVolume(FILE, 'A')!.totalVolume).toBe(553451)       // not AA, not AAPL
    expect(findShortVolume(FILE, 'AA')!.shortVolume).toBe(716239)
    expect(findShortVolume(FILE, 'BF/B')!.pct).toBeCloseTo(48.53, 1)
    expect(findShortVolume(FILE, 'MSFT')).toBeNull()
  })
  it('never matches a market code or another field as the symbol', () => {
    expect(findShortVolume(FILE, 'Q')).toBeNull()
    expect(findShortVolume(FILE, 'B,Q,N')).toBeNull()
    expect(findShortVolume(FILE, '500')).toBeNull()
  })
  it('rejects impossible rows', () => {
    expect(findShortVolume(FILE, 'BAD')).toBeNull()              // short volume above total
    expect(findShortVolume(FILE, 'ZERO')).toBeNull()             // no volume
    expect(findShortVolume('', 'AAPL')).toBeNull()
  })
  it('lists recent weekdays, newest first, skipping weekends', () => {
    // Saturday 14 Nov 2026
    expect(recentWeekdays(4, new Date(Date.UTC(2026, 10, 14, 12)))).toEqual(['20261113', '20261112', '20261111', '20261110'])
    expect(recentWeekdays(3, new Date(Date.UTC(2026, 10, 16, 1)))).toEqual(['20261116', '20261113', '20261112'])
  })
  it('summarises a window', () => {
    const days: ShortDay[] = Array.from({ length: 12 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, shortVolume: 400 + (i === 11 ? 300 : i % 2 * 20), totalVolume: 1000, pct: (400 + (i === 11 ? 300 : i % 2 * 20)) / 10 }))
    const s = shortStats([...days].reverse())
    expect(s.days[0].date).toBe('2026-11-01')                   // sorted oldest first
    expect(s.latest!.pct).toBe(70)
    expect(s.avgPct).toBeCloseTo((400 * 6 + 420 * 5 + 700) / 120, 8)
    expect(s.vsAvg!).toBeGreaterThan(20)
    expect(s.zScore!).toBeGreaterThan(2)                        // clearly unusual
    expect(shortStats([])).toEqual({ latest: null, avgPct: null, vsAvg: null, zScore: null, days: [] })
    expect(shortStats(days.slice(0, 3)).zScore).toBeNull()      // too few days to call anything unusual
  })
})

describe('positioning data sources', () => {
  it('are on the outbound allowlist', () => {
    expect(isAllowedHost('publicreporting.cftc.gov')).toBe(true)
    expect(isAllowedHost('cdn.finra.org')).toBe(true)
  })
})
