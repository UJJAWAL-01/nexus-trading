import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q') || 'stock market finance'

  const cacheKey = `news:${q}`
  const cached   = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    // Use 'everything' endpoint with very recent time filter
    const from = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString() // last 6 hours
    const url  = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=30&from=${from}&apiKey=${process.env.NEWS_API_KEY}`

    const res  = await fetch(url)
    const data = await res.json()

    // Fallback: if no recent results, try without time filter
    if (!data.articles?.length) {
      const fallback = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${process.env.NEWS_API_KEY}`
      )
      const fallbackData = await fallback.json()
      cache.set(cacheKey, { data: fallbackData, expires: Date.now() + 60_000 })
      return NextResponse.json(fallbackData)
    }

    cache.set(cacheKey, { data, expires: Date.now() + 60_000 })
    return NextResponse.json(data)
  } catch {
    const stale = cache.get(cacheKey)
    if (stale) return NextResponse.json(stale.data)
    return NextResponse.json({ articles: [] })
  }
}