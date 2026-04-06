// src/app/api/worldbank/route.ts
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number; stale: unknown }>()

// World Bank indicator codes for India (IN) and US (US)
const INDIA_INDICATORS: Record<string, string> = {
  'FP.CPI.TOTL.ZG': 'CPI Inflation (%)',
  'NY.GDP.MKTP.KD.ZG': 'GDP Growth (%)',
  'NE.TRD.GNFS.ZS': 'Trade (% of GDP)',
  'BN.CAB.XOKA.GD.ZS': 'Current Account (% GDP)',
  'GC.DOD.TOTL.GD.ZS': 'Gov Debt (% GDP)',
  'SL.UEM.TOTL.ZS': 'Unemployment (%)',
  'FP.WPI.TOTL': 'WPI Inflation',
  'PA.NUS.FCRF': 'Exchange Rate (LCU/USD)',
}

const US_INDICATORS: Record<string, string> = {
  'FP.CPI.TOTL.ZG': 'CPI Inflation (%)',
  'NY.GDP.MKTP.KD.ZG': 'GDP Growth (%)',
  'SL.UEM.TOTL.ZS': 'Unemployment (%)',
  'GC.DOD.TOTL.GD.ZS': 'Gov Debt (% GDP)',
  'NE.TRD.GNFS.ZS': 'Trade (% of GDP)',
  'BN.CAB.XOKA.GD.ZS': 'Current Account (% GDP)',
}

interface MacroDataPoint {
  indicator: string
  label:     string
  value:     number | null
  year:      string
  change:    number | null
}

async function fetchWorldBankSeries(
  country:     string,
  indicatorId: string,
  label:       string
): Promise<MacroDataPoint> {
  try {
    const url = `https://api.worldbank.org/v2/country/${country}/indicator/${indicatorId}?format=json&mrv=3&per_page=3`
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`WB ${res.status}`)
    const json = await res.json()

    // World Bank returns [metadata, data]
    const rows: any[] = json?.[1] ?? []
    const latest      = rows.find(r => r.value !== null)
    const prev        = rows.filter(r => r.value !== null)[1] ?? null

    const value  = latest?.value   ?? null
    const year   = latest?.date    ?? '—'
    const change = prev?.value != null && value != null ? value - prev.value : null

    return { indicator: indicatorId, label, value, year, change }
  } catch {
    return { indicator: indicatorId, label, value: null, year: '—', change: null }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const country = (searchParams.get('country') ?? 'IN').toUpperCase()
  const cacheKey = `worldbank:${country}`

  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  const indicators = country === 'IN' ? INDIA_INDICATORS : US_INDICATORS
  const countryCode = country === 'IN' ? 'IN' : 'US'

  const results = await Promise.all(
    Object.entries(indicators).map(([id, label]) =>
      fetchWorldBankSeries(countryCode, id, label)
    )
  )

  // Also fetch RBI-specific data for India using FRED API as backup
  let repoRate: MacroDataPoint | null = null
  if (country === 'IN') {
    try {
      // FRED series for India: Not directly available for repo rate
      // Use World Bank deposit rate as proxy; supplement with RBI announcement
      const rbiFredRes = await fetch(
        `https://api.stlouisfed.org/fred/series/observations?series_id=INDIRSA&api_key=${process.env.FRED_API_KEY}&file_type=json&sort_order=desc&limit=3`,
        { signal: AbortSignal.timeout(5000) }
      )
      if (rbiFredRes.ok) {
        const fredJson   = await rbiFredRes.json()
        const obs: any[] = fredJson?.observations ?? []
        const latest     = obs.find((o: any) => o.value !== '.')
        const prev       = obs.filter((o: any) => o.value !== '.')[1]

        if (latest) {
          repoRate = {
            indicator: 'RBI_REPO',
            label:     'Lending Rate / Repo Proxy (%)',
            value:     parseFloat(latest.value),
            year:      latest.date,
            change:    prev ? parseFloat(latest.value) - parseFloat(prev.value) : null,
          }
        }
      }
    } catch {}
  }

  const data = {
    country,
    lastFetched: new Date().toISOString(),
    indicators:  repoRate ? [...results, repoRate] : results,
    note: country === 'IN'
      ? 'World Bank Annual Data (most recent release) + FRED proxy for lending rate'
      : 'World Bank Annual Data (most recent release)',
  }

  cache.set(cacheKey, { data, expires: Date.now() + 12 * 3_600_000, stale: data }) // 12hr cache
  return NextResponse.json(data)
}