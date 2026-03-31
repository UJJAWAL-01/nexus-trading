import { NextRequest, NextResponse } from 'next/server'

interface CacheEntry { data: unknown; expires: number; stale: unknown }
const cache = new Map<string, CacheEntry>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const endpoint = searchParams.get('endpoint')
  const symbol   = searchParams.get('symbol')
  const q        = searchParams.get('q')

  if (!endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 })

  const cacheKey = `finnhub:${endpoint}:${symbol || q || ''}`
  const cached   = cache.get(cacheKey)

  // Return fresh cache
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  const params = new URLSearchParams()
  params.set('token', process.env.FINNHUB_API_KEY!)
  if (symbol) params.set('symbol', symbol)
  if (q)      params.set('q', q)

  // Forward any extra params
  searchParams.forEach((value, key) => {
    if (!['endpoint', 'symbol', 'q'].includes(key)) params.set(key, value)
  })

// Finnhub search uses different base path
const path = endpoint === 'search' ? 'search' : endpoint
// For search, Finnhub needs 'q' not 'symbol'
if (endpoint === 'search' && q) {
  params.delete('symbol')
  params.set('q', q)
}
const url = `https://finnhub.io/api/v1/${path}?${params}`

  try {
    const res = await fetch(url, { next: { revalidate: 0 } })

    if (res.status === 429) {
      // Rate limited — return stale data if available, never blank
      if (cached?.stale) {
        return NextResponse.json(cached.stale)
      }
      return NextResponse.json({ rateLimited: true, data: null })
    }

    const data = await res.json()

    // TTL per endpoint
    const ttl = endpoint === 'quote'  ? 6_000
      : endpoint === 'search'         ? 30_000
      : endpoint === 'news'           ? 90_000
      : 60_000

    // Store both fresh and stale copy
    cache.set(cacheKey, { data, expires: Date.now() + ttl, stale: data })

    return NextResponse.json(data)
  } catch {
    // Network error — return stale if available
    if (cached?.stale) return NextResponse.json(cached.stale)
    return NextResponse.json({ error: 'fetch failed', data: null })
  }
}