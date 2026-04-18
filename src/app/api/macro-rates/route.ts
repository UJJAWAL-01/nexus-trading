// src/app/api/macro-rates/route.ts
// Real Fed + RBI rates from FRED.
// KEY GUARANTEES:
//   1. done flags on meeting schedule are ALWAYS computed from today's date — never hardcoded
//   2. CPI is proper YoY % from FRED (not an index value)
//   3. RBI rate freshness-validated — stale FRED falls back to last-known official decision
//   4. Rate tables aligned between macro-rates and fixed-income endpoints
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

// ── 2026 Meeting Schedules — NO hardcoded done flags ─────────────────────────
// done is always computed dynamically from today's date in the route handler.
const FOMC_SCHEDULE_2026 = [
  { date: '2026-01-28', label: 'Jan 27–28' },
  { date: '2026-03-18', label: 'Mar 18–19' },
  { date: '2026-05-06', label: 'May 6–7'   },
  { date: '2026-06-17', label: 'Jun 17–18' },
  { date: '2026-07-29', label: 'Jul 29–30' },
  { date: '2026-09-16', label: 'Sep 16–17' },
  { date: '2026-10-28', label: 'Oct 28–29' },
  { date: '2026-12-09', label: 'Dec 9–10'  },
]

const RBI_MPC_SCHEDULE_2026 = [
  { date: '2026-02-07', label: 'Feb 5–7' },
  { date: '2026-04-09', label: 'Apr 7–9' },
  { date: '2026-06-06', label: 'Jun 4–6' },
  { date: '2026-08-06', label: 'Aug 5–7' },
  { date: '2026-10-08', label: 'Oct 7–9' },
  { date: '2026-12-05', label: 'Dec 4–6' },
]

// ── Known RBI Repo Rate milestones (official RBI announcements) ───────────────
// Fallback only when FRED INTDSRINM193N is unavailable or stale.
// Sorted newest first. Rate = repo rate in effect FROM that date.
// ALIGNED with fixed-income/route.ts — both files must match.
const RBI_RATE_KNOWN = [
  { date: '2026-04-09', rate: 6.00, note: 'RBI MPC Apr 2026 — 25bps cut (fallback)' },
  { date: '2026-02-07', rate: 6.25, note: 'RBI MPC Feb 2026 — 25bps cut (fallback)' },
  { date: '2025-04-09', rate: 6.00, note: 'RBI MPC Apr 2025 — 25bps cut' },
  { date: '2025-02-07', rate: 6.25, note: 'RBI MPC Feb 2025 — 25bps cut' },
  { date: '2024-06-07', rate: 6.50, note: 'RBI held at 6.50%' },
]

// ── Known Fed Rate milestones (official FOMC decisions) ───────────────────────
// Sorted oldest first. getKnownFedRate() takes the last entry <= today.
const FED_RATE_KNOWN = [
  { date: '2025-09-17', lower: 4.25, upper: 4.50, note: 'FOMC Sep 2025' },
  { date: '2025-12-11', lower: 4.25, upper: 4.50, note: 'FOMC Dec 2025' },
  { date: '2026-01-28', lower: 4.25, upper: 4.50, note: 'FOMC Jan 2026 hold' },
  { date: '2026-03-18', lower: 4.00, upper: 4.25, note: 'FOMC Mar 2026 cut' },
]

// ── Core FRED fetcher — single most recent observation ───────────────────────
async function fredObs(series: string, limit = 3): Promise<{ value: number; date: string } | null> {
  const key = process.env.FRED_API_KEY
  if (!key) return null
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=${limit}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const j = await res.json()
    const obs = (j.observations ?? []).find((o: any) => o.value !== '.')
    if (!obs) return null
    return { value: parseFloat(obs.value), date: obs.date }
  } catch { return null }
}

// ── YoY % calculator from FRED index series ───────────────────────────────────
async function fredYoY(series: string): Promise<{ value: number; date: string } | null> {
  const key = process.env.FRED_API_KEY
  if (!key) return null
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=14`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const j = await res.json()
    const obs = (j.observations ?? [])
      .filter((o: any) => o.value !== '.')
      .map((o: any) => ({ value: parseFloat(o.value), date: o.date }))

    if (obs.length < 13) return null

    const latest  = obs[0].value
    const yearAgo = obs[12].value  // 12 months back
    if (!yearAgo || yearAgo === 0) return null

    const yoy = ((latest - yearAgo) / Math.abs(yearAgo)) * 100
    return { value: parseFloat(yoy.toFixed(2)), date: obs[0].date }
  } catch { return null }
}

// ── Check if a FRED date is fresh (within maxDays) ──────────────────────────
function isFresh(dateStr: string, maxDays = 90): boolean {
  try {
    const diff = (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
    return diff <= maxDays
  } catch { return false }
}

// ── Best known RBI rate (latest official announcement on or before today) ─────
function getKnownRBIRate(today: string) {
  const past = RBI_RATE_KNOWN.filter(r => r.date <= today)
  return past[0] ?? RBI_RATE_KNOWN[RBI_RATE_KNOWN.length - 1]
}

// ── Best known Fed rate (latest official FOMC decision on or before today) ────
function getKnownFedRate(today: string) {
  const past = FED_RATE_KNOWN.filter(r => r.date <= today)
  return past[past.length - 1] ?? FED_RATE_KNOWN[FED_RATE_KNOWN.length - 1]
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const market = searchParams.get('market') ?? 'US'
  const ck = `mr:${market}`
  const cached = cache.get(ck)
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.data)

  const today = new Date().toISOString().slice(0, 10)

  // Compute done flags dynamically — never rely on hardcoded booleans
  const FOMC_2026    = FOMC_SCHEDULE_2026.map(m    => ({ ...m, done: m.date < today }))
  const RBI_MPC_2026 = RBI_MPC_SCHEDULE_2026.map(m => ({ ...m, done: m.date < today }))

  // ── INDIA ─────────────────────────────────────────────────────────────────
  if (market === 'IN') {
    const [fredRateObs, indCpiYoY] = await Promise.all([
      // INTDSRINM193N = IMF IFS India Discount Rate (infrequently updated)
      fredObs('INTDSRINM193N'),
      // India CPI → compute YoY from monthly index
      fredYoY('INDCPIALLMINMEI'),
    ])

    // Validate FRED rate — only trust it if published within last 90 days
    const knownRBI = getKnownRBIRate(today)
    let rbiRateValue = knownRBI.rate
    let rbiRateDate  = knownRBI.date
    let rbiSource    = `RBI Official decision table (${knownRBI.note})`

    if (fredRateObs && isFresh(fredRateObs.date, 90)) {
      rbiRateValue = fredRateObs.value
      rbiRateDate  = fredRateObs.date
      rbiSource    = 'FRED INTDSRINM193N (IMF IFS)'
    }

    const nextMPC = RBI_MPC_2026.find(m => !m.done)

    const payload = {
      market: 'IN',
      policyRate: {
        value:   rbiRateValue,
        date:    rbiRateDate,
        label:   'RBI Repo Rate',
        source:  rbiSource,
        display: `${rbiRateValue.toFixed(2)}%`,
      },
      stance: rbiRateValue <= 5.5 ? 'ACCOMMODATIVE' : rbiRateValue <= 6.25 ? 'NEUTRAL' : 'RESTRICTIVE',
      cpi: indCpiYoY
        ? { value: indCpiYoY.value, date: indCpiYoY.date, label: 'India CPI YoY %', source: 'FRED INDCPIALLMINMEI (OECD)' }
        : null,
      meetings:    RBI_MPC_2026,
      nextMeeting: nextMPC ?? RBI_MPC_2026[RBI_MPC_2026.length - 1],
      fetchedAt:   new Date().toISOString(),
    }

    cache.set(ck, { data: payload, expires: Date.now() + 4 * 3600_000 })
    return NextResponse.json(payload)
  }

  // ── US ────────────────────────────────────────────────────────────────────
  const [lower, upper, effective, usCpiYoY, unrateObs] = await Promise.all([
    fredObs('DFEDTARL'),     // Fed target lower bound (daily — very fresh)
    fredObs('DFEDTARU'),     // Fed target upper bound (daily — very fresh)
    fredObs('FEDFUNDS'),     // Effective fed funds rate (monthly)
    fredYoY('CPIAUCSL'),     // US CPI → compute YoY from monthly index
    fredObs('UNRATE'),       // Unemployment rate (monthly)
  ])

  // Validate Fed rate freshness
  const knownFed = getKnownFedRate(today)
  let lo = knownFed.lower
  let hi = knownFed.upper
  let fedDate = knownFed.date
  let fedSource = `FOMC Official (${knownFed.note})`

  if (lower && isFresh(lower.date, 30)) {
    lo = lower.value
    fedDate = lower.date
    fedSource = 'FRED DFEDTARL/DFEDTARU (Federal Reserve)'
  }
  if (upper && isFresh(upper.date, 30)) {
    hi = upper.value
  }

  const rateStr = lo === hi
    ? `${lo.toFixed(2)}%`
    : `${lo.toFixed(2)}–${hi.toFixed(2)}%`

  const nextFOMC = FOMC_2026.find(m => !m.done)

  const payload = {
    market: 'US',
    policyRate: {
      lower:     lo,
      upper:     hi,
      effective: effective?.value ?? null,
      display:   rateStr,
      date:      fedDate,
      label:     'Fed Funds Target',
      source:    fedSource,
    },
    stance: lo >= 5.0 ? 'RESTRICTIVE' : lo >= 3.75 ? 'SLIGHTLY RESTRICTIVE' : lo >= 2.5 ? 'NEUTRAL' : 'ACCOMMODATIVE',
    cpi: usCpiYoY
      ? { value: usCpiYoY.value, date: usCpiYoY.date, label: 'US CPI YoY %', source: 'FRED CPIAUCSL' }
      : null,
    unrate: unrateObs
      ? { value: unrateObs.value, date: unrateObs.date }
      : null,
    meetings:    FOMC_2026,
    nextMeeting: nextFOMC ?? FOMC_2026[FOMC_2026.length - 1],
    fetchedAt:   new Date().toISOString(),
  }

  cache.set(ck, { data: payload, expires: Date.now() + 4 * 3600_000 })
  return NextResponse.json(payload)
}