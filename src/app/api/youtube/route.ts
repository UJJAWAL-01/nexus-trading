import { NextResponse } from 'next/server'
import { hasKey, youtube } from '@/lib/providers/keys'
import { createCache } from '@/lib/providers/cache'

const cache = createCache<unknown>({ name: 'youtube', max: 10, staleMs: 6 * 3600_000 })

const FINANCIAL_CHANNELS = [
  'UCrM7B7SL_g1edFOnmj-SDKg', // CNBC
]

class QuotaExceeded extends Error {}

export async function GET() {
  if (!hasKey('youtube')) return NextResponse.json({ error: 'fetch failed', items: [] })

  try {
    const data = await cache.wrap('financial', 600_000, async () => {
      const res = await youtube('search', {
        part: 'snippet', channelId: FINANCIAL_CHANNELS[0], maxResults: 5, order: 'date', type: 'video',
      })
      if (res.status === 403) throw new QuotaExceeded()
      if (!res.ok) throw new Error('upstream error')
      return (await res.json()) as unknown
    })
    return NextResponse.json(data)
  } catch (err) {
    if (err instanceof QuotaExceeded) return NextResponse.json({ rateLimited: true, items: [] })
    return NextResponse.json({ error: 'fetch failed', items: [] })
  }
}
