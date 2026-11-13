import { NextRequest, NextResponse } from 'next/server'
import { finnhub, hasKey, type Params } from '@/lib/providers/keys'
import { createCache } from '@/lib/providers/cache'
import { cleanQuery, cleanSymbol, toKeylessSymbol } from '@/lib/providers/symbols'
import { getQuote } from '@/lib/providers/market'

// Narrow, read-only window onto Finnhub for the dashboard panels.
//
// This used to forward ANY endpoint and ANY query parameter with the server's
// key attached — an open proxy onto the whole Finnhub API. It now only serves
// the endpoints the app actually uses, with a fixed set of validated
// parameters per endpoint. The key is attached by lib/providers/keys.ts and
// is sent as a header, never in a URL.

type Spec = {
  ttlMs:   number
  sMaxAge: number
  /** Build upstream params from the request, or return null to reject (400). */
  params:  (q: URLSearchParams) => Params | null
}

const symbolOnly = (q: URLSearchParams): Params | null => {
  const symbol = cleanSymbol(q.get('symbol'))
  return symbol ? { symbol } : null
}

const NEWS_CATEGORIES = new Set(['general', 'forex', 'crypto', 'merger'])

const ENDPOINTS: Record<string, Spec> = {
  'quote':                { ttlMs: 6_000,   sMaxAge: 25,  params: symbolOnly },
  'stock/profile2':       { ttlMs: 3600_000, sMaxAge: 600, params: symbolOnly },
  'stock/recommendation': { ttlMs: 3600_000, sMaxAge: 600, params: symbolOnly },
  'stock/metric': {
    ttlMs: 900_000, sMaxAge: 300,
    params: q => {
      const symbol = cleanSymbol(q.get('symbol'))
      return symbol ? { symbol, metric: 'all' } : null
    },
  },
  'news': {
    ttlMs: 90_000, sMaxAge: 90,
    params: q => {
      const category = q.get('category') ?? 'general'
      return NEWS_CATEGORIES.has(category) ? { category } : null
    },
  },
  'search': {
    ttlMs: 60_000, sMaxAge: 60,
    params: q => {
      const query = cleanQuery(q.get('q'), 40)
      return query ? { q: query } : null
    },
  },
}

const cache = createCache<unknown>({ name: 'finnhub', max: 1000, staleMs: 15 * 60_000 })

class RateLimited extends Error {}

// ── Keyless quote ────────────────────────────────────────────────────────────
// Quotes must work with no API key. When Finnhub is not configured (the
// default) or fails, the quote comes from the keyless provider chain and is
// returned in Finnhub's shape, so every panel keeps working unchanged.

async function keylessQuote(symbol: string): Promise<Record<string, number | null> | null> {
  const q = await getQuote(toKeylessSymbol(symbol))
  if (!q || q.price === null) return null
  return { c: q.price, d: q.changeAbs, dp: q.change, h: q.high, l: q.low, o: null, pc: q.prevClose, t: Math.floor(q.ts / 1000) }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const endpoint = searchParams.get('endpoint') ?? ''

  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
  }
  const spec = Object.prototype.hasOwnProperty.call(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint] : undefined
  if (!spec) {
    return NextResponse.json({ error: 'endpoint not supported' }, { status: 400 })
  }
  const params = spec.params(searchParams)
  if (!params) {
    return NextResponse.json({ error: 'invalid parameters' }, { status: 400 })
  }
  const quoteSymbol = endpoint === 'quote' ? String(params.symbol ?? '') : ''
  const QUOTE_HEADERS = { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60', 'x-quote-source': 'keyless' }

  if (!hasKey('finnhub')) {
    if (quoteSymbol) {
      const q = await keylessQuote(quoteSymbol)
      // Same "no data" shape Finnhub uses for an unknown symbol.
      return NextResponse.json(q ?? { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }, { headers: QUOTE_HEADERS })
    }
    return NextResponse.json({ error: 'Data source unavailable' }, { status: 503 })
  }

  const cacheKey = `${endpoint}?${new URLSearchParams(params as Record<string, string>).toString()}`
  const headers  = { 'Cache-Control': `public, s-maxage=${spec.sMaxAge}, stale-while-revalidate=120` }

  try {
    const data = await cache.wrap(cacheKey, spec.ttlMs, async () => {
      const res = await finnhub(endpoint, params, { cache: 'no-store' })
      if (res.status === 429) throw new RateLimited()
      if (!res.ok) throw new Error('upstream error')
      return (await res.json()) as unknown
    })
    return NextResponse.json(data, { headers })
  } catch (err) {
    // cache.wrap already serves the last good value when one exists; reaching
    // here means there is nothing to fall back to. Shapes below are what the
    // panels have always received in these cases.
    if (quoteSymbol) {
      const q = await keylessQuote(quoteSymbol)
      if (q) return NextResponse.json(q, { headers: QUOTE_HEADERS })
    }
    if (err instanceof RateLimited) return NextResponse.json({ rateLimited: true }, { status: 200 })
    return NextResponse.json({ error: 'fetch failed' }, { status: 200 })
  }
}
