import { NextRequest, NextResponse } from 'next/server'

// Segment-level revalidate so Vercel Data Cache shares responses across users.
// Quote endpoints need fast TTL; search/news can be longer. The s-maxage
// Cache-Control headers below drive per-endpoint granularity at the CDN.
export const revalidate = 30

const cache = new Map<string, { data: unknown; stale: unknown; expires: number }>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const endpoint = searchParams.get('endpoint')
  const symbol   = searchParams.get('symbol')
  const q        = searchParams.get('q')

  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
  }

  if (!process.env.FINNHUB_API_KEY) {
    return NextResponse.json({ error: 'Data source unavailable' }, { status: 503 })
  }

  const cacheKey = `finnhub:${endpoint}:${symbol || q || ''}`
  const cached   = cache.get(cacheKey)

  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, s-maxage=5, stale-while-revalidate=30' }
    })
  }

  const params = new URLSearchParams()
  params.set('token', process.env.FINNHUB_API_KEY)
  if (symbol) params.set('symbol', symbol)
  if (q)      params.set('q', q)

  if (endpoint === 'search' && q) {
    params.delete('symbol')
    params.set('q', q)
  }

  searchParams.forEach((value, key) => {
    if (!['endpoint', 'symbol', 'q'].includes(key)) params.set(key, value)
  })

  const url = `https://finnhub.io/api/v1/${endpoint}?${params}`

  try {
    const res = await fetch(url, { next: { revalidate: 0 } })

    if (res.status === 429) {
      // Rate limited — always return stale data, never blank
      if (cached?.stale) {
        return NextResponse.json(cached.stale, {
          headers: { 'Cache-Control': 'public, s-maxage=10, stale-while-revalidate=60' }
        })
      }
      return NextResponse.json({ rateLimited: true }, { status: 200 })
    }

    const data = await res.json()

    const ttl = endpoint === 'quote'  ? 6_000
      : endpoint === 'search'         ? 60_000
      : endpoint === 'news'           ? 90_000
      : 60_000

    cache.set(cacheKey, { data, stale: data, expires: Date.now() + ttl })

    // s-maxage tells Vercel CDN to cache at the edge
    const sMaxAge = endpoint === 'quote' ? 25 : endpoint === 'news' ? 90 : 60

    return NextResponse.json(data, {
      headers: { 'Cache-Control': `public, s-maxage=${sMaxAge}, stale-while-revalidate=120` }
    })
  } catch {
    if (cached?.stale) return NextResponse.json(cached.stale)
    return NextResponse.json({ error: 'fetch failed' }, { status: 200 })
  }
}