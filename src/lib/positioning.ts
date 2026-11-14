// src/lib/positioning.ts
// Who is positioned how: futures positioning from the CFTC's weekly
// Commitments of Traders report, and daily short-sale volume from FINRA.
// Both are free public data with no key. This file is the pure part
// (parsing and statistics); fetching lives in providers/positioning.ts.
//
// What these numbers are, and are not:
//   • COT counts open futures contracts each Tuesday, published on Friday.
//     "Non-commercial" traders are large speculators (funds); "commercial"
//     traders are hedgers who use the commodity or asset in their business.
//   • Short VOLUME is the share of a day's off-exchange trades that were short
//     sales. It is NOT short interest. Market makers sell short all day as a
//     matter of routine, so 40–50% is ordinary, not bearish.

// ── COT ──────────────────────────────────────────────────────────────────────

export type CotGroup = 'Equity index' | 'Rates' | 'Metals' | 'Energy' | 'Currencies' | 'Crypto' | 'Grains'

export interface CotContract { code: string; name: string; group: CotGroup }

/** Curated, liquid contracts. Codes are CFTC contract market codes. */
export const COT_CONTRACTS: readonly CotContract[] = [
  { code: '13874A', name: 'S&P 500 (E-mini)',   group: 'Equity index' },
  { code: '209742', name: 'Nasdaq 100 (E-mini)', group: 'Equity index' },
  { code: '124603', name: 'Dow Jones',          group: 'Equity index' },
  { code: '239742', name: 'Russell 2000',       group: 'Equity index' },
  { code: '1170E1', name: 'VIX',                group: 'Equity index' },
  { code: '042601', name: 'US 2-year note',     group: 'Rates' },
  { code: '043602', name: 'US 10-year note',    group: 'Rates' },
  { code: '020601', name: 'US Treasury bond',   group: 'Rates' },
  { code: '088691', name: 'Gold',               group: 'Metals' },
  { code: '084691', name: 'Silver',             group: 'Metals' },
  { code: '085692', name: 'Copper',             group: 'Metals' },
  { code: '067651', name: 'Crude oil (WTI)',    group: 'Energy' },
  { code: '023651', name: 'Natural gas',        group: 'Energy' },
  { code: '098662', name: 'US dollar index',    group: 'Currencies' },
  { code: '099741', name: 'Euro',               group: 'Currencies' },
  { code: '097741', name: 'Japanese yen',       group: 'Currencies' },
  { code: '096742', name: 'British pound',      group: 'Currencies' },
  { code: '133741', name: 'Bitcoin',            group: 'Crypto' },
  { code: '002602', name: 'Corn',               group: 'Grains' },
  { code: '005602', name: 'Soybeans',           group: 'Grains' },
  { code: '001602', name: 'Wheat',              group: 'Grains' },
]

/** One row as the CFTC API returns it (numbers arrive as strings). */
export interface CotRawRow {
  cftc_contract_market_code?:   string
  report_date_as_yyyy_mm_dd?:   string
  open_interest_all?:           string
  noncomm_positions_long_all?:  string
  noncomm_positions_short_all?: string
  comm_positions_long_all?:     string
  comm_positions_short_all?:    string
}

export interface CotSummary {
  code:   string
  name:   string
  group:  CotGroup
  date:   string            // report date (a Tuesday), ISO
  weeks:  number            // history length used for the range
  openInterest: number
  /** Large speculators: long minus short contracts. */
  specNet:       number
  specNetChange: number | null      // vs the previous report
  /** specNet as a share of open interest, in %. */
  specNetPct:    number
  /** Where today's specNetPct sits in its own history range: 0 = most short, 100 = most long. */
  rangePosition: number | null
  commNet:       number
  /** Oldest first: speculator net as % of open interest. */
  history: Array<{ date: string; specNetPct: number }>
}

const int = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

const MIN_WEEKS_FOR_RANGE = 26

/** Group raw rows by contract and summarise each. Unknown contracts and bad rows are dropped. */
export function summariseCot(rows: readonly CotRawRow[]): CotSummary[] {
  const known = new Map(COT_CONTRACTS.map(c => [c.code, c]))
  const by = new Map<string, Array<{ date: string; oi: number; specNet: number; commNet: number }>>()

  for (const r of rows) {
    const code = r.cftc_contract_market_code?.trim()
    const date = r.report_date_as_yyyy_mm_dd?.slice(0, 10)
    if (!code || !known.has(code) || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const oi = int(r.open_interest_all)
    const nl = int(r.noncomm_positions_long_all), ns = int(r.noncomm_positions_short_all)
    const cl = int(r.comm_positions_long_all),   cs = int(r.comm_positions_short_all)
    if (oi === null || oi <= 0 || nl === null || ns === null || cl === null || cs === null) continue
    if (!by.has(code)) by.set(code, [])
    by.get(code)!.push({ date, oi, specNet: nl - ns, commNet: cl - cs })
  }

  const out: CotSummary[] = []
  for (const contract of COT_CONTRACTS) {
    const series = by.get(contract.code)
    if (!series?.length) continue
    // Oldest first, one row per date.
    const seen = new Set<string>()
    const hist = series.sort((a, b) => a.date.localeCompare(b.date)).filter(p => (seen.has(p.date) ? false : (seen.add(p.date), true)))
    const last = hist[hist.length - 1], prev = hist[hist.length - 2]
    const pcts = hist.map(p => (p.specNet / p.oi) * 100)
    const cur = pcts[pcts.length - 1], lo = Math.min(...pcts), hi = Math.max(...pcts)
    out.push({
      code: contract.code, name: contract.name, group: contract.group,
      date: last.date, weeks: hist.length, openInterest: last.oi,
      specNet: last.specNet,
      specNetChange: prev ? last.specNet - prev.specNet : null,
      specNetPct: cur,
      rangePosition: hist.length >= MIN_WEEKS_FOR_RANGE && hi > lo ? ((cur - lo) / (hi - lo)) * 100 : null,
      commNet: last.commNet,
      history: hist.map((p, i) => ({ date: p.date, specNetPct: pcts[i] })),
    })
  }
  return out
}

/** Plain-language reading of where speculators stand in their own range. */
export function cotStance(rangePosition: number | null): 'crowded long' | 'crowded short' | 'long side' | 'short side' | 'middle' | 'unknown' {
  if (rangePosition === null) return 'unknown'
  if (rangePosition >= 90) return 'crowded long'
  if (rangePosition <= 10) return 'crowded short'
  if (rangePosition >= 60) return 'long side'
  if (rangePosition <= 40) return 'short side'
  return 'middle'
}

// ── FINRA short volume ───────────────────────────────────────────────────────

/** FINRA only covers US-listed equities. Returns its symbol form, or null. */
export function finraSymbol(symbol: string): string | null {
  const s = symbol.trim().toUpperCase()
  // US tickers only: 1–5 letters, optional single-letter class (BRK.B / BRK-B → BRK/B).
  const m = s.match(/^([A-Z]{1,5})(?:[.\-/]([A-Z]))?$/)
  return m ? (m[2] ? `${m[1]}/${m[2]}` : m[1]) : null
}

export interface ShortDay { date: string; shortVolume: number; totalVolume: number; pct: number }

/** Find one symbol's line in a FINRA daily file ("Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market"). */
export function findShortVolume(file: string, finraSym: string): ShortDay | null {
  const needle = `|${finraSym}|`
  let at = file.indexOf(needle)
  while (at !== -1) {
    const start = file.lastIndexOf('\n', at) + 1
    // The symbol must be the second field: the date before it has no pipe.
    if (at - start === 8) {
      const end = file.indexOf('\n', at)
      const parts = file.slice(start, end === -1 ? undefined : end).trim().split('|')
      const d = parts[0], short = Number(parts[2]), total = Number(parts[4])
      if (/^\d{8}$/.test(d) && Number.isFinite(short) && Number.isFinite(total) && total > 0 && short >= 0 && short <= total) {
        return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, shortVolume: Math.round(short), totalVolume: Math.round(total), pct: (short / total) * 100 }
      }
      return null
    }
    at = file.indexOf(needle, at + 1)
  }
  return null
}

/** The last `n` weekdays up to and including `now` (UTC), newest first, as YYYYMMDD. */
export function recentWeekdays(n: number, now: Date = new Date()): string[] {
  const out: string[] = []
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  while (out.length < n) {
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10).replace(/-/g, ''))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}

export interface ShortStats {
  latest:  ShortDay | null
  avgPct:  number | null           // volume-weighted over the window
  /** Latest day minus the window average, in percentage points. */
  vsAvg:   number | null
  /** How unusual the latest day is, in standard deviations of the window. */
  zScore:  number | null
  days:    ShortDay[]              // oldest first
}

export function shortStats(days: readonly ShortDay[]): ShortStats {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const latest = sorted[sorted.length - 1] ?? null
  if (!latest) return { latest: null, avgPct: null, vsAvg: null, zScore: null, days: [] }
  const short = sorted.reduce((a, d) => a + d.shortVolume, 0), total = sorted.reduce((a, d) => a + d.totalVolume, 0)
  const avgPct = total > 0 ? (short / total) * 100 : null
  let zScore: number | null = null
  if (sorted.length >= 10) {
    const xs = sorted.map(d => d.pct), m = xs.reduce((a, b) => a + b, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
    zScore = sd > 0 ? (latest.pct - m) / sd : null
  }
  return { latest, avgPct, vsAvg: avgPct === null ? null : latest.pct - avgPct, zScore, days: sorted }
}
