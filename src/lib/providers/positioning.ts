// src/lib/providers/positioning.ts
// Keyless public positioning data. No account, no key, no cost.
//
//   CFTC   publicreporting.cftc.gov   Commitments of Traders (weekly, open data API)
//   FINRA  cdn.finra.org              Reg SHO daily short-sale volume files
//   CBOE   cdn-api.cboe.com           delayed options quotes (15 minutes)
//
// Server-only. Requests go through upstreamFetch (HTTPS, host allowlist,
// timeout) and the shared cache (bounded, stale-on-error, de-duplicated).

import { upstreamFetch } from './http'
import { createCache } from './cache'
import {
  COT_CONTRACTS, findShortVolume, finraSymbol, recentWeekdays, shortStats, summariseCot,
  type CotRawRow, type CotSummary, type ShortDay, type ShortStats,
} from '@/lib/positioning'
import { buildVolSurface, cboeSymbol, type RawChain, type VolSurface } from '@/lib/vol-surface'

// ── CFTC ─────────────────────────────────────────────────────────────────────

const COT_WEEKS = 156                 // three years of weekly reports
const cotCache = createCache<CotSummary[]>({ name: 'cot', max: 2, staleMs: 7 * 24 * 3600_000 })

/** All curated contracts in ONE upstream call, cached for six hours (the data is weekly). */
export async function cotSummaries(): Promise<CotSummary[] | null> {
  try {
    return await cotCache.wrap('all', 6 * 3600_000, async () => {
      const since = new Date(Date.now() - (COT_WEEKS + 2) * 7 * 86_400_000).toISOString().slice(0, 10)
      // Legacy futures-only report. Codes come from our own constant list, never from user input.
      const codes = COT_CONTRACTS.map(c => `'${c.code}'`).join(',')
      const url = new URL('https://publicreporting.cftc.gov/resource/6dca-aqww.json')
      url.searchParams.set('$select', 'cftc_contract_market_code,report_date_as_yyyy_mm_dd,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all,comm_positions_long_all,comm_positions_short_all')
      url.searchParams.set('$where', `report_date_as_yyyy_mm_dd > '${since}T00:00:00.000' AND cftc_contract_market_code in(${codes})`)
      url.searchParams.set('$order', 'report_date_as_yyyy_mm_dd DESC')
      url.searchParams.set('$limit', String(COT_CONTRACTS.length * (COT_WEEKS + 4)))
      const res = await upstreamFetch(url, { provider: 'cftc', timeoutMs: 15_000, headers: { Accept: 'application/json' }, cache: 'no-store' })
      if (!res.ok) throw new Error(`CFTC ${res.status}`)
      const rows = (await res.json()) as CotRawRow[]
      const out = summariseCot(Array.isArray(rows) ? rows : [])
      if (!out.length) throw new Error('CFTC returned no usable rows')
      return out
    })
  } catch {
    return cotCache.getStale('all') ?? null
  }
}

// ── FINRA ────────────────────────────────────────────────────────────────────

const SHORT_DAYS  = 20
const LOOKBACK    = 26               // weekdays to try, so holidays do not shorten the window
const CONCURRENCY = 5

// One file is ~0.5 MB of text. Holding the raw text for ~26 days costs about
// 14 MB and makes a symbol lookup a substring search, with no per-symbol maps.
// '' marks a day with no file (holiday, or today's file not published yet).
const fileCache = createCache<string>({ name: 'finra-shvol', max: LOOKBACK + 2, staleMs: 24 * 3600_000 })

const MAX_FILE_BYTES = 3_000_000    // a normal file is ~0.5 MB; refuse anything wildly larger

/**
 * One day's file. Published files never change, so they are kept for a week.
 * The newest weekday is re-checked every 30 minutes, because its file appears
 * in the evening and a "not there yet" answer must not stick.
 */
async function dailyFile(yyyymmdd: string, isNewest: boolean): Promise<string> {
  const ttl = isNewest ? 30 * 60_000 : 7 * 24 * 3600_000
  try {
    return await fileCache.wrap(yyyymmdd, ttl, async () => {
      const url = new URL(`https://cdn.finra.org/equity/regsho/daily/CNMSshvol${yyyymmdd}.txt`)
      const res = await upstreamFetch(url, { provider: 'finra', timeoutMs: 12_000, headers: { Accept: 'text/plain' }, cache: 'no-store' })
      if (res.status === 403 || res.status === 404) return ''          // holiday, or not published yet
      if (!res.ok) throw new Error(`FINRA ${res.status}`)
      const text = await res.text()
      if (text.length > MAX_FILE_BYTES || !text.startsWith('Date|Symbol|')) throw new Error('unexpected FINRA file')
      return text
    })
  } catch {
    return fileCache.getStale(yyyymmdd) ?? ''
  }
}

async function pool<T, R>(items: readonly T[], size: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

/** Null when the symbol is not a US equity ticker. */
export async function shortVolume(symbol: string): Promise<(ShortStats & { symbol: string }) | null> {
  const fs = finraSymbol(symbol)
  if (!fs) return null
  const dates = recentWeekdays(LOOKBACK)
  const files = await pool(dates, CONCURRENCY, (d, i) => dailyFile(d, i === 0))
  const days: ShortDay[] = []
  for (const file of files) {
    if (!file) continue
    const row = findShortVolume(file, fs)
    if (row) days.push(row)
    if (days.length >= SHORT_DAYS) break
  }
  return { symbol: symbol.toUpperCase(), ...shortStats(days) }
}

// ── CBOE ─────────────────────────────────────────────────────────────────────

// The raw chain is 1–10 MB per symbol, so only the computed surface (a few KB)
// is cached. Five minutes is well inside the feed's own 15-minute delay.
const surfaceCache = createCache<VolSurface>({ name: 'vol-surface', max: 60, staleMs: 6 * 3600_000 })
const MAX_CHAIN_BYTES = 40_000_000

/** 'unsupported' when the symbol is not a US optionable ticker; null when no data. */
export async function volSurface(symbol: string): Promise<VolSurface | 'unsupported' | null> {
  const cs = cboeSymbol(symbol)
  if (!cs) return 'unsupported'
  try {
    return await surfaceCache.wrap(cs, 5 * 60_000, async () => {
      const url = new URL(`https://cdn-api.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(cs)}.json`)
      const res = await upstreamFetch(url, { provider: 'cboe', timeoutMs: 20_000, headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' })
      if (!res.ok) throw new Error(`CBOE ${res.status}`)
      const length = Number(res.headers.get('content-length') ?? 0)
      if (length > MAX_CHAIN_BYTES) throw new Error('CBOE chain too large')
      const surface = buildVolSurface((await res.json()) as RawChain)
      if (!surface) throw new Error('no usable options')
      return surface
    })
  } catch {
    return surfaceCache.getStale(cs) ?? null
  }
}
