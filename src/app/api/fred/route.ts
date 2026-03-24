import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const series = searchParams.get('series') || 'FEDFUNDS'
  const cacheKey = `fred:${series}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    const res = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${process.env.FRED_API_KEY}&file_type=json&sort_order=desc&limit=10`
    )
    const data = await res.json()
    cache.set(cacheKey, { data, expires: Date.now() + 300_000 })
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'fetch failed', observations: [] })
  }
}