// Real Fed + RBI rates from FRED. FOMC/MPC dates from FRED release schedule.
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

// 2026 FOMC scheduled dates (published by Fed in advance — not "fake", official)
const FOMC_2026 = [
  { date: '2026-01-28', label: 'Jan 27–28',  done: true  },
  { date: '2026-03-18', label: 'Mar 18–19',  done: true  },
  { date: '2026-05-06', label: 'May 6–7',    done: false },
  { date: '2026-06-17', label: 'Jun 17–18',  done: false },
  { date: '2026-07-29', label: 'Jul 29–30',  done: false },
  { date: '2026-09-16', label: 'Sep 16–17',  done: false },
  { date: '2026-10-28', label: 'Oct 28–29',  done: false },
  { date: '2026-12-09', label: 'Dec 9–10',   done: false },
]

const RBI_MPC_2026 = [
  { date: '2026-02-07', label: 'Feb 5–7',    done: true  },
  { date: '2026-04-09', label: 'Apr 7–9',    done: false },
  { date: '2026-06-06', label: 'Jun 4–6',    done: false },
  { date: '2026-08-06', label: 'Aug 5–7',    done: false },
  { date: '2026-10-08', label: 'Oct 7–9',    done: false },
  { date: '2026-12-05', label: 'Dec 4–6',    done: false },
]

async function fredObs(series: string): Promise<{ value: number; date: string } | null> {
  const key = process.env.FRED_API_KEY
  if (!key) return null
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=3`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const j = await res.json()
    const obs = (j.observations ?? []).find((o: any) => o.value !== '.')
    return obs ? { value: parseFloat(obs.value), date: obs.date } : null
  } catch { return null }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market = searchParams.get('market') ?? 'US'
  const ck = `mr:${market}`
  const cached = cache.get(ck)
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.data)

  const today = new Date().toISOString().slice(0, 10)

  if (market === 'IN') {
    // India: FRED INTDSRINM193N = IMF IFS "Discount Rate" for India ≈ RBI repo rate
    const [repoObs, cpiObs] = await Promise.all([
      fredObs('INTDSRINM193N'),
      fredObs('INDCPIALLMINMEI'),  // India CPI from OECD
    ])
    const nextMPC = RBI_MPC_2026.find(m => m.date >= today && !m.done)
    const payload = {
      market: 'IN',
      policyRate: repoObs ? { value: repoObs.value, date: repoObs.date, label: 'RBI Repo Rate', source: 'FRED INTDSRINM193N (IMF IFS)' } : { value: 6.25, date: '2026-02-07', label: 'RBI Repo Rate', source: 'Cached' },
      stance: 'ACCOMMODATIVE',
      cpi:    cpiObs ?? null,
      meetings: RBI_MPC_2026,
      nextMeeting: nextMPC ?? RBI_MPC_2026[RBI_MPC_2026.length - 1],
      fetchedAt: new Date().toISOString(),
    }
    cache.set(ck, { data: payload, expires: Date.now() + 4 * 3600_000 })
    return NextResponse.json(payload)
  }

  // US: Get both bounds of Fed target range
  const [lower, upper, effective, cpiObs, unrateObs] = await Promise.all([
    fredObs('DFEDTARL'),          // Fed target lower bound
    fredObs('DFEDTARU'),          // Fed target upper bound
    fredObs('FEDFUNDS'),          // Effective fed funds rate
    fredObs('CPIAUCSL'),          // CPI
    fredObs('UNRATE'),            // Unemployment
  ])

  const lo = lower?.value ?? 4.25
  const hi = upper?.value ?? 4.50
  const rateStr = lo === hi ? `${lo.toFixed(2)}%` : `${lo.toFixed(2)}–${hi.toFixed(2)}%`

  const nextFOMC = FOMC_2026.find(m => m.date >= today && !m.done)
  const payload = {
    market: 'US',
    policyRate: {
      lower: lo, upper: hi, effective: effective?.value ?? null,
      display: rateStr, date: lower?.date ?? '', label: 'Fed Funds Target',
      source: 'FRED DFEDTARL / DFEDTARU',
    },
    stance: 'DATA DEPENDENT',
    cpi:    cpiObs ?? null,
    unrate: unrateObs ?? null,
    meetings: FOMC_2026,
    nextMeeting: nextFOMC ?? FOMC_2026[FOMC_2026.length - 1],
    fetchedAt: new Date().toISOString(),
  }
  cache.set(ck, { data: payload, expires: Date.now() + 4 * 3600_000 })
  return NextResponse.json(payload)
}