import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

const FINANCIAL_CHANNELS = [
  'UCrM7B7SL_g1edFOnmj-SDKg', // CNBC
  'UCIALMKvObZNtJ6AmdCLP_aQ', // Bloomberg
]

export async function GET(request: NextRequest) {
  const cacheKey = 'youtube:financial'
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    const channelId = FINANCIAL_CHANNELS[0]
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channelId}&maxResults=5&order=date&type=video&key=${process.env.YOUTUBE_API_KEY}`
    )
    if (res.status === 403) return NextResponse.json({ rateLimited: true, items: [] })
    const data = await res.json()
    cache.set(cacheKey, { data, expires: Date.now() + 600_000 })
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'fetch failed', items: [] })
  }
}