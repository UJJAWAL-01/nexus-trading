import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') || 'stock market'
  const cacheKey = `news:${query}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    const res = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=20&apiKey=${process.env.NEWS_API_KEY}`
    )
    if (res.status === 429) return NextResponse.json({ rateLimited: true, articles: [] })
    const data = await res.json()
    cache.set(cacheKey, { data, expires: Date.now() + 60_000 })
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'fetch failed', articles: [] })
  }
}