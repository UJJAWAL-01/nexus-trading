import { NextRequest, NextResponse } from 'next/server'

// In-memory cache — reset on each Vercel cold start, fine for our use case
const cache = new Map<string, { data: unknown; expires: number }>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const endpoint = searchParams.get('endpoint') // e.g. 'quote', 'company-news'
  const symbol   = searchParams.get('symbol')   // e.g. 'AAPL'

  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint required' }, { status: 400 })
  }

  // Cache key
  const cacheKey = `finnhub:${endpoint}:${symbol}`
  const cached   = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  // Build the Finnhub URL
  const params = new URLSearchParams()
  params.set('token', process.env.FINNHUB_API_KEY!)
  if (symbol) params.set('symbol', symbol)

  // Add any extra params forwarded from the client
  searchParams.forEach((value, key) => {
    if (key !== 'endpoint' && key !== 'symbol') params.set(key, value)
  })

  const url = `https://finnhub.io/api/v1/${endpoint}?${params}`

  try {
    const res = await fetch(url, { next: { revalidate: 0 } })

    // Rate limited — return null gracefully, don't crash
    if (res.status === 429) {
      console.warn('[Finnhub] Rate limit hit for', cacheKey)
      return NextResponse.json({ rateLimited: true, data: null }, { status: 200 })
    }

    const data = await res.json()

    // Cache: 5 seconds for quotes, 60 seconds for news
    const ttl = endpoint === 'quote' ? 5_000 : 60_000
    cache.set(cacheKey, { data, expires: Date.now() + ttl })

    return NextResponse.json(data)
  } catch (err) {
    console.error('[Finnhub] Error:', err)
    return NextResponse.json({ error: 'fetch failed', data: null }, { status: 200 })
  }
}