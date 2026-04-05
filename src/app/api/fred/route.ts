// src/app/api/fred/route.ts
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

// All macro series we track
const MACRO_SERIES = {
  FEDFUNDS: { label: 'Fed Funds Rate',      unit: '%',  color: '#f0a500', desc: 'Federal Open Market Committee target rate' },
  DGS10:    { label: '10Y Treasury',         unit: '%',  color: '#1e90ff', desc: '10-year US Treasury constant maturity' },
  DGS2:     { label: '2Y Treasury',          unit: '%',  color: '#00e5c0', desc: '2-year US Treasury constant maturity' },
  T10Y2Y:   { label: 'Yield Curve (10-2Y)',  unit: 'pp', color: '#a78bfa', desc: 'Spread between 10Y and 2Y Treasuries' },
  CPIAUCSL: { label: 'CPI (YoY)',            unit: '%',  color: '#ff4560', desc: 'Consumer Price Index, All Urban Consumers' },
  UNRATE:   { label: 'Unemployment',         unit: '%',  color: '#00c97a', desc: 'Civilian unemployment rate (seasonally adj.)' },
  DEXINUS:  { label: 'USD/INR',              unit: '',   color: '#f97316', desc: 'US Dollar to Indian Rupee exchange rate' },
} as const

type SeriesId = keyof typeof MACRO_SERIES

async function fetchOneSeries(sid: string, limit = 24): Promise<any[] | null> {
  const key = `fred:obs:${sid}`
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data as any[]

  try {
    const url =
      `https://api.stlouisfed.org/fred/series/observations` +
      `?series_id=${sid}` +
      `&api_key=${process.env.FRED_API_KEY}` +
      `&file_type=json&sort_order=desc&limit=${limit}`

    const res = await fetch(url, { next: { revalidate: 0 } })
    if (!res.ok) return hit?.data as any[] ?? null
    const data = await res.json()
    const obs = (data.observations ?? []).filter((o: any) => o.value !== '.')
    cache.set(key, { data: obs, expires: Date.now() + 300_000 })
    return obs
  } catch {
    return hit?.data as any[] ?? null
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const seriesParam = searchParams.get('series')

  // ── Single series (backwards compat with existing code) ───────────────────
  if (seriesParam) {
    const key = `fred:single:${seriesParam}`
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) {
      return NextResponse.json(hit.data, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      })
    }
    try {
      const url =
        `https://api.stlouisfed.org/fred/series/observations` +
        `?series_id=${seriesParam}` +
        `&api_key=${process.env.FRED_API_KEY}` +
        `&file_type=json&sort_order=desc&limit=10`
      const res = await fetch(url, { next: { revalidate: 0 } })
      const data = await res.json()
      cache.set(key, { data, expires: Date.now() + 300_000 })
      return NextResponse.json(data, {
        headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
      })
    } catch {
      const stale = cache.get(key)
      if (stale) return NextResponse.json(stale.data)
      return NextResponse.json({ error: 'fetch failed', observations: [] })
    }
  }

  // ── All macro series ───────────────────────────────────────────────────────
  const allKey = 'fred:all'
  const allHit = cache.get(allKey)
  if (allHit && allHit.expires > Date.now()) {
    return NextResponse.json(allHit.data, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    })
  }

  const results: Record<string, any> = {}

  await Promise.all(
    (Object.entries(MACRO_SERIES) as [SeriesId, typeof MACRO_SERIES[SeriesId]][]).map(
      async ([sid, meta]) => {
        const obs = await fetchOneSeries(sid)
        if (!obs || obs.length === 0) return
        const current  = parseFloat(obs[0]?.value  ?? '0')
        const previous = parseFloat(obs[1]?.value ?? '0')
        results[sid] = {
          ...meta,
          current,
          previous,
          change: +(current - previous).toFixed(4),
          date:   obs[0]?.date ?? '',
          history: obs.slice(0, 12).reverse().map((o: any) => ({
            date:  o.date,
            value: parseFloat(o.value),
          })),
        }
      },
    ),
  )

  const payload = { macro: results, timestamp: new Date().toISOString() }
  cache.set(allKey, { data: payload, expires: Date.now() + 300_000 })

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  })
}