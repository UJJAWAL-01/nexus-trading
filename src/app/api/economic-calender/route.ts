// src/app/api/economic-calendar/route.ts
// ALWAYS returns data — hardcoded FOMC/RBI/ECB events are embedded
// Finnhub supplements with live economic data when key is present
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; exp: number }>()

export interface CalEvent {
  id:       string
  title:    string
  country:  string
  region:   'US' | 'IN' | 'EU' | 'UK' | 'JP' | 'CN' | 'AU' | 'CA' | 'OTHER'
  date:     string
  time:     string
  impact:   'high' | 'medium' | 'low'
  forecast: string | null
  previous: string | null
  actual:   string | null
  category: 'inflation' | 'growth' | 'employment' | 'central_bank' | 'trade' | 'manufacturing' | 'consumer' | 'other'
}

const REGION: Record<string, CalEvent['region']> = {
  'united states':'US','us':'US','usa':'US','america':'US',
  'india':'IN','in':'IN',
  'euro zone':'EU','eu':'EU','eurozone':'EU','germany':'EU','france':'EU','italy':'EU','spain':'EU','ecb':'EU',
  'united kingdom':'UK','uk':'UK','gb':'UK','britain':'UK',
  'japan':'JP','jp':'JP',
  'china':'CN','cn':'CN',
  'australia':'AU','au':'AU',
  'canada':'CA','ca':'CA',
}

function toRegion(c: string): CalEvent['region'] { return REGION[c.toLowerCase()] ?? 'OTHER' }

function toImpact(s?: string | null): CalEvent['impact'] {
  const u = (s ?? '').toLowerCase()
  if (u === 'high' || u === '3') return 'high'
  if (u === 'medium' || u === '2') return 'medium'
  return 'low'
}

function toCategory(t: string): CalEvent['category'] {
  const s = t.toLowerCase()
  if (/cpi|pce|inflation|ppi|wpi|deflat/.test(s))                        return 'inflation'
  if (/gdp|growth|output/.test(s))                                        return 'growth'
  if (/employ|nfp|job|payroll|unemploy|jobless|jolt|labor|labour/.test(s))return 'employment'
  if (/rate decision|fomc|fed |mpc|rbi|boe|ecb|central bank|monetary/.test(s)) return 'central_bank'
  if (/pmi|manufacturing|industrial|ism|factory/.test(s))                 return 'manufacturing'
  if (/retail|consumer spend|confidence|sentiment/.test(s))               return 'consumer'
  if (/trade|export|import|current account|balance of/.test(s))           return 'trade'
  return 'other'
}

function safeISO(v: string | number | null | undefined): string {
  if (!v) return new Date().toISOString()
  try {
    if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString()
    const d = new Date(String(v).includes('T') ? v : v + 'T12:00:00Z')
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
  } catch { return new Date().toISOString() }
}

function etTime(iso: string): string {
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return 'All Day'
    const h = d.getUTCHours(), m = d.getUTCMinutes()
    if (h === 0 && m === 0) return 'All Day'
    const etH  = ((h - 4) + 24) % 24  // EDT (Apr)
    const ampm = etH >= 12 ? 'pm' : 'am'
    const h12  = etH > 12 ? etH - 12 : etH === 0 ? 12 : etH
    return `${h12}:${String(m).padStart(2,'0')}${ampm} ET`
  } catch { return 'All Day' }
}

// ── Hardcoded scheduled events (ALWAYS available) ────────────────────────────
// Official central bank dates — never need an API to load
function getScheduled(): CalEvent[] {
  const cutoff = Date.now() - 5 * 86400_000

  const rows: Array<{date:string;title:string;country:string;impact:CalEvent['impact'];category:CalEvent['category'];time:string}> = [
    // FOMC 2025
    {date:'2025-01-29',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2025-03-19',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2025-05-07',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2025-06-18',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2025-07-30',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2025-09-17',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2025-10-29',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2025-12-10',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    // FOMC 2026
    {date:'2026-01-28',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2026-03-18',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2026-05-06',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2026-06-17',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2026-07-29',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2026-09-16',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2026-10-28',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    {date:'2026-12-09',title:'FOMC Rate Decision',country:'United States',impact:'high',category:'central_bank',time:'2:00pm ET'},
    // RBI MPC 2025
    {date:'2025-02-07',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2025-04-09',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2025-06-06',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2025-08-06',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2025-10-08',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2025-12-05',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    // RBI MPC 2026
    {date:'2026-02-05',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2026-04-09',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2026-06-04',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2026-08-06',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2026-10-08',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    {date:'2026-12-03',title:'RBI MPC Rate Decision',country:'India',impact:'high',category:'central_bank',time:'10:00am IST'},
    // ECB 2026
    {date:'2026-01-30',title:'ECB Rate Decision',country:'Euro Zone',impact:'high',category:'central_bank',time:'2:15pm CET'},
    {date:'2026-03-05',title:'ECB Rate Decision',country:'Euro Zone',impact:'high',category:'central_bank',time:'2:15pm CET'},
    {date:'2026-04-16',title:'ECB Rate Decision',country:'Euro Zone',impact:'high',category:'central_bank',time:'2:15pm CET'},
    {date:'2026-06-04',title:'ECB Rate Decision',country:'Euro Zone',impact:'high',category:'central_bank',time:'2:15pm CET'},
    {date:'2026-07-23',title:'ECB Rate Decision',country:'Euro Zone',impact:'high',category:'central_bank',time:'2:15pm CET'},
    {date:'2026-09-10',title:'ECB Rate Decision',country:'Euro Zone',impact:'high',category:'central_bank',time:'2:15pm CET'},
    {date:'2026-10-22',title:'ECB Rate Decision',country:'Euro Zone',impact:'high',category:'central_bank',time:'2:15pm CET'},
    {date:'2026-12-10',title:'ECB Rate Decision',country:'Euro Zone',impact:'high',category:'central_bank',time:'2:15pm CET'},
    // BOE 2026
    {date:'2026-02-06',title:'BOE Rate Decision',country:'United Kingdom',impact:'high',category:'central_bank',time:'12:00pm GMT'},
    {date:'2026-03-19',title:'BOE Rate Decision',country:'United Kingdom',impact:'high',category:'central_bank',time:'12:00pm GMT'},
    {date:'2026-05-07',title:'BOE Rate Decision',country:'United Kingdom',impact:'high',category:'central_bank',time:'12:00pm GMT'},
    {date:'2026-06-18',title:'BOE Rate Decision',country:'United Kingdom',impact:'high',category:'central_bank',time:'12:00pm GMT'},
    // US Inflation (approximate monthly schedule 2026)
    {date:'2026-01-15',title:'US CPI YoY',country:'United States',impact:'high',category:'inflation',time:'8:30am ET'},
    {date:'2026-02-12',title:'US CPI YoY',country:'United States',impact:'high',category:'inflation',time:'8:30am ET'},
    {date:'2026-03-12',title:'US CPI YoY',country:'United States',impact:'high',category:'inflation',time:'8:30am ET'},
    {date:'2026-04-10',title:'US CPI YoY',country:'United States',impact:'high',category:'inflation',time:'8:30am ET'},
    {date:'2026-05-13',title:'US CPI YoY',country:'United States',impact:'high',category:'inflation',time:'8:30am ET'},
    {date:'2026-06-10',title:'US CPI YoY',country:'United States',impact:'high',category:'inflation',time:'8:30am ET'},
    // US Jobs
    {date:'2026-02-06',title:'US Non-Farm Payrolls',country:'United States',impact:'high',category:'employment',time:'8:30am ET'},
    {date:'2026-03-06',title:'US Non-Farm Payrolls',country:'United States',impact:'high',category:'employment',time:'8:30am ET'},
    {date:'2026-04-03',title:'US Non-Farm Payrolls',country:'United States',impact:'high',category:'employment',time:'8:30am ET'},
    {date:'2026-05-01',title:'US Non-Farm Payrolls',country:'United States',impact:'high',category:'employment',time:'8:30am ET'},
    {date:'2026-06-05',title:'US Non-Farm Payrolls',country:'United States',impact:'high',category:'employment',time:'8:30am ET'},
    // India CPI
    {date:'2026-02-12',title:'India CPI YoY',country:'India',impact:'high',category:'inflation',time:'5:30pm IST'},
    {date:'2026-03-12',title:'India CPI YoY',country:'India',impact:'high',category:'inflation',time:'5:30pm IST'},
    {date:'2026-04-14',title:'India CPI YoY',country:'India',impact:'high',category:'inflation',time:'5:30pm IST'},
    {date:'2026-05-13',title:'India CPI YoY',country:'India',impact:'high',category:'inflation',time:'5:30pm IST'},
    // India GDP
    {date:'2026-02-28',title:'India GDP Growth Rate QoQ',country:'India',impact:'high',category:'growth',time:'5:30pm IST'},
    {date:'2026-05-31',title:'India GDP Growth Rate QoQ',country:'India',impact:'high',category:'growth',time:'5:30pm IST'},
    // US GDP
    {date:'2026-01-29',title:'US GDP Growth Rate QoQ',country:'United States',impact:'high',category:'growth',time:'8:30am ET'},
    {date:'2026-04-29',title:'US GDP Growth Rate QoQ',country:'United States',impact:'high',category:'growth',time:'8:30am ET'},
  ]

  return rows
    .filter(r => new Date(r.date + 'T00:00:00Z').getTime() >= cutoff)
    .map((r, i): CalEvent => ({
      id:       `sched-${i}-${r.date}`,
      title:    r.title,
      country:  r.country,
      region:   toRegion(r.country),
      date:     r.date + 'T00:00:00.000Z',
      time:     r.time,
      impact:   r.impact,
      forecast: null, previous: null, actual: null,
      category: r.category,
    }))
}

// ── Finnhub supplement ────────────────────────────────────────────────────────
async function fetchFinnhub(from: string, to: string): Promise<CalEvent[]> {
  const key = process.env.FINNHUB_API_KEY
  if (!key) return []

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`,
      { headers: { 'User-Agent': 'NEXUS/1.0' }, signal: AbortSignal.timeout(10000) }
    )
    if (!res.ok) return []
    const json = await res.json()
    const events: any[] = json.economicCalendar ?? []

    return events.filter((e: any) => e.event).map((e: any, i: number): CalEvent => {
      const iso = safeISO(e.time ?? e.date)
      return {
        id:       `fh-${i}-${iso.slice(0,10)}`,
        title:    e.event,
        country:  e.country ?? '',
        region:   toRegion(e.country ?? ''),
        date:     iso,
        time:     etTime(iso),
        impact:   toImpact(e.impact),
        forecast: e.estimate != null ? String(e.estimate) : null,
        previous: e.prev     != null ? String(e.prev)     : null,
        actual:   e.actual   != null ? String(e.actual)   : null,
        category: toCategory(e.event),
      }
    })
  } catch { return [] }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const region = searchParams.get('region') ?? 'ALL'
  const impact = searchParams.get('impact') ?? 'ALL'
  const ck     = `ec:${region}:${impact}`

  const cached = cache.get(ck)
  if (cached && cached.exp > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' }
    })
  }

  const from = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0,10)
  const to   = new Date(Date.now() + 21 * 86400_000).toISOString().slice(0,10)

  // Hardcoded events ALWAYS succeed; Finnhub is optional supplement
  const [scheduled, finnhub] = await Promise.all([
    Promise.resolve(getScheduled()),
    fetchFinnhub(from, to).catch(() => [] as CalEvent[]),
  ])

  // Merge: deduplicate by title+date
  const seen  = new Set<string>()
  let   merged = [...scheduled, ...finnhub].filter(e => {
    const k = `${e.title.slice(0,28).toLowerCase()}:${e.date.slice(0,10)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  merged.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  if (region !== 'ALL') merged = merged.filter(e => e.region === region)
  if (impact !== 'ALL') merged = merged.filter(e => e.impact === impact)

  const payload = {
    events: merged, total: merged.length,
    fetchedAt: new Date().toISOString(),
    source: finnhub.length > 0 ? 'Finnhub + Scheduled Events' : 'Scheduled Events',
  }

  cache.set(ck, { data: payload, exp: Date.now() + 30 * 60_000 })
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' }
  })
}