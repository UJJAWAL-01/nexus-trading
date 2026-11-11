import { NextRequest, NextResponse } from 'next/server'
import { hasKey, newsapi } from '@/lib/providers/keys'
import { createCache } from '@/lib/providers/cache'
import { cleanQuery } from '@/lib/providers/symbols'

// NewsAPI search. Response shape is the NewsAPI payload ({ status, articles }).
// The key is sent as a header by lib/providers/keys.ts and upstream error
// bodies are never forwarded to the client.

type NewsPayload = { status: string; totalResults?: number; articles: unknown[]; message?: string }

const cache = createCache<NewsPayload>({ name: 'news', max: 200, staleMs: 30 * 60_000 })

const GENERIC_QUERY = 'stock market finance business'
const UNAVAILABLE: NewsPayload = { articles: [], status: 'error', message: 'News temporarily unavailable' }

async function search(q: string, from?: string): Promise<NewsPayload | null> {
  const res = await newsapi('everything', { q, language: 'en', sortBy: 'publishedAt', pageSize: 30, from })
  if (!res.ok) return null
  const data = (await res.json()) as { status?: string; totalResults?: number; articles?: unknown[] }
  if (!Array.isArray(data.articles)) return null
  return { status: data.status ?? 'ok', totalResults: data.totalResults, articles: data.articles }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = cleanQuery(searchParams.get('q'), 120) ?? 'stock market finance'

  if (!hasKey('newsapi')) return NextResponse.json(UNAVAILABLE)

  try {
    const data = await cache.wrap(q, 60_000, async () => {
      // Last 6 hours first, then any time, then a generic market query.
      const from   = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
      const recent = await search(q, from)
      if (recent?.articles.length) return recent

      const anytime = await search(q)
      if (anytime?.articles.length) return anytime

      const generic = await search(GENERIC_QUERY)
      if (generic) return generic
      throw new Error('news unavailable')
    })
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(cache.getStale(q) ?? UNAVAILABLE)
  }
}
