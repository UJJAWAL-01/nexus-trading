// src/lib/providers/public-data.ts
// Keyless public data sources. Nothing here needs an account, a key or a
// payment method, which is what lets NEXUS run with zero setup and zero cost.
//
//   FRED   fred.stlouisfed.org/graph/fredgraph.csv   public CSV download
//   Nasdaq api.nasdaq.com/api                        public calendar JSON
//
// Server-only. All requests go through upstreamFetch (HTTPS, host allowlist,
// timeout) and the shared cache (bounded, stale-on-error, de-duplicated).

import { upstreamFetch } from './http'
import { createCache } from './cache'

const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
}

// ── FRED (keyless CSV) ───────────────────────────────────────────────────────

export interface FredObservation { date: string; value: string }

const FRED_SERIES = /^[A-Z0-9_]{1,40}$/
const fredCache = createCache<FredObservation[]>({ name: 'fred-csv', max: 300, staleMs: 24 * 3600_000 })

/** Parse FRED's two-column CSV ("observation_date,SERIES"). Exported for tests. */
export function parseFredCsv(csv: string): FredObservation[] {
  const out: FredObservation[] = []
  const lines = csv.split(/\r?\n/)
  for (let i = 1; i < lines.length; i++) {
    const [date, value] = lines[i].split(',')
    if (!date || value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    out.push({ date, value: value.trim() === '' ? '.' : value.trim() })
  }
  return out
}

/**
 * Latest observations for a FRED series, newest first, in the same
 * `{ observations: [{ date, value }] }` shape as FRED's keyed API ("." marks a
 * missing value), so callers written for that API work unchanged.
 * Returns null when FRED is unreachable and nothing is cached.
 */
export async function fredObservations(series: string, limit = 3): Promise<{ observations: FredObservation[] } | null> {
  if (!FRED_SERIES.test(series)) return null
  try {
    const all = await fredCache.wrap(series, 3600_000, async () => {
      // Two years back covers a 12-month change on monthly series and keeps
      // daily series small.
      const start = new Date(Date.now() - 2 * 366 * 86_400_000).toISOString().slice(0, 10)
      const url = new URL('https://fred.stlouisfed.org/graph/fredgraph.csv')
      url.searchParams.set('id', series)
      url.searchParams.set('cosd', start)
      const res = await upstreamFetch(url, { provider: 'fred', timeoutMs: 10_000, headers: { ...BROWSER_HEADERS, Accept: 'text/csv' }, cache: 'no-store' })
      if (!res.ok) throw new Error(`FRED ${res.status}`)
      const rows = parseFredCsv(await res.text())
      if (!rows.length) throw new Error('FRED returned no rows')
      return rows.reverse()            // newest first
    })
    return { observations: all.slice(0, Math.max(1, Math.min(limit, 500))) }
  } catch {
    const stale = fredCache.getStale(series)
    return stale ? { observations: stale.slice(0, limit) } : null
  }
}

// ── Nasdaq calendars (keyless JSON) ──────────────────────────────────────────

const nasdaqCache = createCache<unknown>({ name: 'nasdaq', max: 100, staleMs: 12 * 3600_000 })

async function nasdaq<T>(path: string, params: Record<string, string>, ttlMs: number): Promise<T | null> {
  const key = `${path}?${new URLSearchParams(params)}`
  try {
    return (await nasdaqCache.wrap(key, ttlMs, async () => {
      const url = new URL(`https://api.nasdaq.com/api/${path}`)
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
      const res = await upstreamFetch(url, { provider: 'nasdaq', timeoutMs: 10_000, headers: { ...BROWSER_HEADERS, Accept: 'application/json' }, cache: 'no-store' })
      if (!res.ok) throw new Error(`Nasdaq ${res.status}`)
      const json = (await res.json()) as { data?: unknown }
      if (!json?.data) throw new Error('Nasdaq returned no data')
      return json.data
    })) as T
  } catch {
    return (nasdaqCache.getStale(key) as T | undefined) ?? null
  }
}

/** "$1.15" → 1.15 · "($0.20)" → -0.2 · "$386,964,914,000" → 386964914000 · "N/A" → null */
export function parseMoney(input: unknown): number | null {
  if (typeof input !== 'string') return typeof input === 'number' && Number.isFinite(input) ? input : null
  const s = input.trim()
  if (!s || /^(n\/a|--|-)$/i.test(s)) return null
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-')
  const n = Number(s.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(n) || !/\d/.test(s)) return null
  return negative ? -n : n
}

/** "11/02/2026" → "2026-11-02". Returns '' when the input is not a US date. */
export function usDateToIso(input: unknown): string {
  if (typeof input !== 'string') return ''
  const m = input.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return ''
  const iso = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
  return Number.isNaN(Date.parse(iso)) ? '' : iso
}

// IPO calendar ────────────────────────────────────────────────────────────────

export interface NasdaqIpo {
  ticker:     string
  company:    string
  exchange:   string
  date:       string          // ISO; '' when Nasdaq lists no date
  priceRange: string
  shares:     string
  offerAmount: string
  stage:      'priced' | 'upcoming' | 'filed'
}

interface IpoRow {
  proposedTickerSymbol?: string; companyName?: string; proposedExchange?: string
  proposedSharePrice?: string; sharesOffered?: string; dollarValueOfSharesOffered?: string
  pricedDate?: string; expectedPriceDate?: string; filedDate?: string
}
interface IpoMonth {
  priced?:   { rows?: IpoRow[] | null }
  upcoming?: { upcomingTable?: { rows?: IpoRow[] | null } }
  filed?:    { rows?: IpoRow[] | null }
}

export function mapIpoMonth(month: IpoMonth): NasdaqIpo[] {
  const out: NasdaqIpo[] = []
  const push = (rows: IpoRow[] | null | undefined, stage: NasdaqIpo['stage'], dateOf: (r: IpoRow) => string | undefined) => {
    for (const r of rows ?? []) {
      if (!r?.companyName) continue
      const price = (r.proposedSharePrice ?? '').trim()
      out.push({
        ticker:      (r.proposedTickerSymbol ?? '').trim() || '—',
        company:     r.companyName.trim(),
        exchange:    (r.proposedExchange ?? '').trim() || (stage === 'filed' ? 'Filed' : 'US Exchange'),
        date:        usDateToIso(dateOf(r)),
        priceRange:  price ? `$${price.replace(/-/g, '–$')}` : '—',
        shares:      (r.sharesOffered ?? '').trim() || '—',
        offerAmount: (r.dollarValueOfSharesOffered ?? '').trim() || '—',
        stage,
      })
    }
  }
  push(month.priced?.rows, 'priced', r => r.pricedDate)
  push(month.upcoming?.upcomingTable?.rows, 'upcoming', r => r.expectedPriceDate)
  push(month.filed?.rows, 'filed', r => r.filedDate)
  return out
}

/** IPOs for the given months ("YYYY-MM"). Empty array when Nasdaq is unreachable. */
export async function nasdaqIpos(months: string[]): Promise<NasdaqIpo[]> {
  const results = await Promise.all(months.map(m => nasdaq<IpoMonth>('ipo/calendar', { date: m }, 3600_000)))
  const seen = new Set<string>()
  const out: NasdaqIpo[] = []
  for (const month of results) {
    if (!month) continue
    for (const ipo of mapIpoMonth(month)) {
      const key = `${ipo.company}|${ipo.stage}|${ipo.date}`
      if (!seen.has(key)) { seen.add(key); out.push(ipo) }
    }
  }
  return out
}

// Earnings calendar ───────────────────────────────────────────────────────────

export interface NasdaqEarning {
  symbol:      string
  name:        string
  date:        string           // ISO
  hour:        'bmo' | 'amc' | 'dmh'
  epsEstimate: number | null
  epsActual:   number | null
  marketCap:   number | null
  quarter:     string
}

interface EarningRow {
  symbol?: string; name?: string; time?: string; marketCap?: string
  fiscalQuarterEnding?: string; epsForecast?: string; eps?: string
}

export function mapEarningsDay(date: string, rows: EarningRow[] | null | undefined): NasdaqEarning[] {
  const out: NasdaqEarning[] = []
  for (const r of rows ?? []) {
    if (!r?.symbol) continue
    out.push({
      symbol:      r.symbol.trim().toUpperCase(),
      name:        (r.name ?? r.symbol).trim(),
      date,
      hour:        r.time === 'time-pre-market' ? 'bmo' : r.time === 'time-after-hours' ? 'amc' : 'dmh',
      epsEstimate: parseMoney(r.epsForecast),
      epsActual:   parseMoney(r.eps),
      marketCap:   parseMoney(r.marketCap),
      quarter:     (r.fiscalQuarterEnding ?? '').trim(),
    })
  }
  return out
}

/** Earnings reports for one ISO date. Empty array when unavailable. */
export async function nasdaqEarnings(date: string): Promise<NasdaqEarning[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
  const data = await nasdaq<{ rows?: EarningRow[] | null }>('calendar/earnings', { date }, 3600_000)
  return mapEarningsDay(date, data?.rows)
}
