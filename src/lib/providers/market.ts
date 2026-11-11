// src/lib/providers/market.ts
// ─────────────────────────────────────────────────────────────────────────────
// Market-data provider adapters.
//
// A provider is a small object that knows how to fetch one kind of data.
// Routes ask the chain for data and never talk to a vendor directly, so a
// vendor can be added, reordered or removed here without touching any route
// or panel. To add one (Polygon, Twelve Data, Stooq, an exchange feed…):
// implement the interface, add its host to providers/http.ts and its key to
// providers/keys.ts, then append it to the chain below.
//
// Server-only.
// ─────────────────────────────────────────────────────────────────────────────

import { upstreamFetch } from './http'
import { createCache } from './cache'
import { YAHOO_INTERVALS, YAHOO_RANGES, isValidSymbol } from './symbols'

/** Raw Yahoo-shaped chart payload. Panels already parse this shape. */
export type ChartPayload = Record<string, unknown>

export interface ChartProvider {
  readonly name: string
  /** Resolve to a payload, or null when this provider has no data. */
  chart(symbol: string, range: string, interval: string): Promise<ChartPayload | null>
}

const BROWSER_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:            'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
}

function yahooChart(host: 'query1.finance.yahoo.com' | 'query2.finance.yahoo.com'): ChartProvider {
  return {
    name: `yahoo:${host.split('.')[0]}`,
    async chart(symbol, range, interval) {
      const url = new URL(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}`)
      url.searchParams.set('interval', interval)
      url.searchParams.set('range', range)
      const res = await upstreamFetch(url, { provider: 'yahoo', timeoutMs: 8_000, headers: BROWSER_HEADERS, cache: 'no-store' })
      if (!res.ok) return null
      const json = (await res.json()) as { chart?: { result?: unknown[] } }
      return json?.chart?.result?.length ? (json as ChartPayload) : null
    },
  }
}

/** Ordered fallback chain. First provider to return data wins. */
const CHART_CHAIN: ChartProvider[] = [
  yahooChart('query1.finance.yahoo.com'),
  yahooChart('query2.finance.yahoo.com'),
]

const chartCache = createCache<ChartPayload>({ name: 'chart', max: 400, staleMs: 30 * 60_000 })

const EMPTY_CHART: ChartPayload = { chart: { result: null, error: { code: 'Unavailable', description: 'No data available' } } }

export function isValidChartRequest(symbol: string, range: string, interval: string): boolean {
  return isValidSymbol(symbol) && YAHOO_RANGES.has(range) && YAHOO_INTERVALS.has(interval)
}

/**
 * Chart candles through the provider chain, cached and de-duplicated.
 * Never throws: on total failure it returns the last known payload, or an
 * empty Yahoo-shaped payload the panels already handle.
 */
export async function getChart(symbol: string, range: string, interval: string): Promise<ChartPayload> {
  if (!isValidChartRequest(symbol, range, interval)) return EMPTY_CHART

  const key = `${symbol}|${range}|${interval}`
  const ttl = range === '1d' || interval.endsWith('m') || interval === '1h' ? 30_000 : 300_000

  try {
    return await chartCache.wrap(key, ttl, async () => {
      for (const provider of CHART_CHAIN) {
        try {
          const data = await provider.chart(symbol, range, interval)
          if (data) return data
        } catch { /* try the next provider */ }
      }
      throw new Error('all chart providers failed')
    })
  } catch {
    return chartCache.getStale(key) ?? EMPTY_CHART
  }
}

// ── Quotes ───────────────────────────────────────────────────────────────────

export interface Quote {
  symbol:      string
  price:       number | null
  /** Percent change vs previous close. */
  change:      number | null
  /** Absolute change vs previous close. */
  changeAbs:   number | null
  currency:    string
  marketState: string
  /** Server time this quote was produced (ms). */
  ts:          number
}

const quoteCache = createCache<Quote>({ name: 'quote', max: 2000, staleMs: 15 * 60_000 })

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp

function quoteFromChart(symbol: string, payload: ChartPayload): Quote | null {
  const result = (payload as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } }).chart?.result?.[0]
  const meta   = result?.meta
  if (!meta) return null
  const price = typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : null
  if (price === null || price <= 0) return null
  const prev  = typeof meta.previousClose === 'number' ? meta.previousClose
              : typeof meta.chartPreviousClose === 'number' ? meta.chartPreviousClose : null
  return {
    symbol,
    price:       round(price, 4),
    change:      prev ? round(((price - prev) / prev) * 100, 2) : null,
    changeAbs:   prev ? round(price - prev, 4) : null,
    currency:    typeof meta.currency === 'string' ? meta.currency : 'USD',
    marketState: typeof meta.marketState === 'string' ? meta.marketState : 'UNKNOWN',
    ts:          Date.now(),
  }
}

/**
 * Latest quote through the provider chain. However many clients ask, each
 * symbol costs at most one upstream call per QUOTE_TTL_MS. Never throws.
 */
const QUOTE_TTL_MS = 10_000

export async function getQuote(symbol: string): Promise<Quote | null> {
  if (!isValidSymbol(symbol)) return null
  try {
    return await quoteCache.wrap(symbol, QUOTE_TTL_MS, async () => {
      for (const provider of CHART_CHAIN) {
        try {
          const data  = await provider.chart(symbol, '1d', '1m')
          const quote = data ? quoteFromChart(symbol, data) : null
          if (quote) return quote
        } catch { /* try the next provider */ }
      }
      throw new Error('all quote providers failed')
    })
  } catch {
    return quoteCache.getStale(symbol) ?? null
  }
}
