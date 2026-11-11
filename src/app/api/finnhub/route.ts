import { NextRequest, NextResponse } from 'next/server'
import { finnhub, hasKey, type Params } from '@/lib/providers/keys'
import { createCache } from '@/lib/providers/cache'
import { cleanQuery, cleanSymbol } from '@/lib/providers/symbols'

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
  if (!hasKey('finnhub')) {
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
    if (err instanceof RateLimited) return NextResponse.json({ rateLimited: true }, { status: 200 })
    return NextResponse.json({ error: 'fetch failed' }, { status: 200 })
  }
}
