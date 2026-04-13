'use client'
// src/components/panels/EconomicCalendarPanel.tsx
// ALWAYS shows data — hardcoded FOMC/RBI/ECB events are embedded in the component
// Optionally supplements with live Finnhub data via /api/economic-calendar
// Never shows "Failed to load" — fallback data is always available

import { useEffect, useState } from 'react'

interface CalEvent {
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

type RegionFilter = 'ALL' | 'US' | 'IN' | 'EU' | 'UK'
type ImpactFilter = 'ALL' | 'high' | 'medium'

// ── Hardcoded events embedded directly (zero dependency) ──────────────────────
function getEmbedded(): CalEvent[] {
  const cutoff = Date.now() - 5 * 86400_000
  const rows: Array<Omit<CalEvent,'id'>> = [
    // FOMC 2025
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2025-01-29T19:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2025-03-19T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2025-05-07T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2025-06-18T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2025-07-30T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2025-09-17T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2025-10-29T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2025-12-10T20:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    // FOMC 2026
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2026-01-28T19:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2026-03-18T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2026-05-06T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2026-06-17T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2026-07-29T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2026-09-16T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2026-10-28T18:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'FOMC Rate Decision',country:'United States',region:'US',date:'2026-12-09T19:00:00.000Z',time:'2:00pm ET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    // RBI 2025
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2025-02-07T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2025-04-09T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2025-06-06T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2025-08-06T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2025-10-08T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2025-12-05T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    // RBI 2026
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2026-02-05T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2026-04-09T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2026-06-04T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2026-08-06T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2026-10-08T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'RBI MPC Rate Decision',country:'India',region:'IN',date:'2026-12-03T04:30:00.000Z',time:'10:00am IST',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    // ECB 2026
    {title:'ECB Rate Decision',country:'Euro Zone',region:'EU',date:'2026-01-30T13:15:00.000Z',time:'2:15pm CET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'ECB Rate Decision',country:'Euro Zone',region:'EU',date:'2026-03-05T13:15:00.000Z',time:'2:15pm CET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'ECB Rate Decision',country:'Euro Zone',region:'EU',date:'2026-04-16T12:15:00.000Z',time:'2:15pm CET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'ECB Rate Decision',country:'Euro Zone',region:'EU',date:'2026-06-04T12:15:00.000Z',time:'2:15pm CET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'ECB Rate Decision',country:'Euro Zone',region:'EU',date:'2026-07-23T12:15:00.000Z',time:'2:15pm CET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    {title:'ECB Rate Decision',country:'Euro Zone',region:'EU',date:'2026-09-10T12:15:00.000Z',time:'2:15pm CET',impact:'high',category:'central_bank',forecast:null,previous:null,actual:null},
    // US CPI approximate 2026
    {title:'US CPI YoY',country:'United States',region:'US',date:'2026-01-15T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'inflation',forecast:null,previous:null,actual:null},
    {title:'US CPI YoY',country:'United States',region:'US',date:'2026-02-12T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'inflation',forecast:null,previous:null,actual:null},
    {title:'US CPI YoY',country:'United States',region:'US',date:'2026-03-12T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'inflation',forecast:null,previous:null,actual:null},
    {title:'US CPI YoY',country:'United States',region:'US',date:'2026-04-10T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'inflation',forecast:null,previous:null,actual:null},
    {title:'US CPI YoY',country:'United States',region:'US',date:'2026-05-13T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'inflation',forecast:null,previous:null,actual:null},
    // US Non-Farm Payrolls 2026
    {title:'US Non-Farm Payrolls',country:'United States',region:'US',date:'2026-02-06T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'employment',forecast:null,previous:null,actual:null},
    {title:'US Non-Farm Payrolls',country:'United States',region:'US',date:'2026-03-06T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'employment',forecast:null,previous:null,actual:null},
    {title:'US Non-Farm Payrolls',country:'United States',region:'US',date:'2026-04-03T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'employment',forecast:null,previous:null,actual:null},
    {title:'US Non-Farm Payrolls',country:'United States',region:'US',date:'2026-05-01T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'employment',forecast:null,previous:null,actual:null},
    // India CPI
    {title:'India CPI YoY',country:'India',region:'IN',date:'2026-02-12T12:00:00.000Z',time:'5:30pm IST',impact:'high',category:'inflation',forecast:null,previous:null,actual:null},
    {title:'India CPI YoY',country:'India',region:'IN',date:'2026-03-12T12:00:00.000Z',time:'5:30pm IST',impact:'high',category:'inflation',forecast:null,previous:null,actual:null},
    {title:'India CPI YoY',country:'India',region:'IN',date:'2026-04-14T12:00:00.000Z',time:'5:30pm IST',impact:'high',category:'inflation',forecast:null,previous:null,actual:null},
    {title:'India CPI YoY',country:'India',region:'IN',date:'2026-05-13T12:00:00.000Z',time:'5:30pm IST',impact:'high',category:'inflation',forecast:null,previous:null,actual:null},
    // US GDP
    {title:'US GDP Growth Rate QoQ',country:'United States',region:'US',date:'2026-01-29T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'growth',forecast:null,previous:null,actual:null},
    {title:'US GDP Growth Rate QoQ',country:'United States',region:'US',date:'2026-04-29T13:30:00.000Z',time:'8:30am ET',impact:'high',category:'growth',forecast:null,previous:null,actual:null},
    // India GDP
    {title:'India GDP Growth Rate QoQ',country:'India',region:'IN',date:'2026-02-28T12:00:00.000Z',time:'5:30pm IST',impact:'high',category:'growth',forecast:null,previous:null,actual:null},
    {title:'India GDP Growth Rate QoQ',country:'India',region:'IN',date:'2026-05-29T12:00:00.000Z',time:'5:30pm IST',impact:'high',category:'growth',forecast:null,previous:null,actual:null},
  ]

  return rows
    .filter(r => new Date(r.date).getTime() >= cutoff)
    .map((r, i): CalEvent => ({ ...r, id: `emb-${i}` }))
    .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

// ── Impact styles ─────────────────────────────────────────────────────────────
const IMPACT_COLOR: Record<string, string> = { high:'var(--negative)', medium:'var(--amber)', low:'var(--text-muted)' }
const IMPACT_BG:    Record<string, string> = { high:'rgba(255,69,96,0.12)', medium:'rgba(240,165,0,0.10)', low:'rgba(74,96,112,0.08)' }
const CAT_ICON: Record<string, string> = {
  inflation:'📈', growth:'📊', employment:'👷', central_bank:'🏦',
  trade:'🌐', manufacturing:'🏭', consumer:'🛒', other:'📋',
}

function relDay(iso: string): string {
  const diff = Math.floor((new Date(iso).getTime() - new Date().setHours(0,0,0,0)) / 86400_000)
  if (diff === 0)  return 'TODAY'
  if (diff === 1)  return 'TMR'
  if (diff === -1) return 'YEST'
  if (diff > 0 && diff < 8) return `+${diff}d`
  if (diff < 0 && diff > -8) return `${diff}d`
  return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'})
}

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString()
}

export default function EconomicCalendarPanel() {
  const [events,  setEvents]  = useState<CalEvent[]>(() => getEmbedded()) // ← starts with data immediately
  const [loading, setLoading] = useState(false)
  const [region,  setRegion]  = useState<RegionFilter>('ALL')
  const [impact,  setImpact]  = useState<ImpactFilter>('ALL')
  const [source,  setSource]  = useState('Scheduled Events')

  // Try to enhance with live data from API; never replace base events if it fails
  useEffect(() => {
    const base = getEmbedded()
    setEvents(base) // always reset to base first

    setLoading(true)
    const params = new URLSearchParams()
    if (region !== 'ALL') params.set('region', region)
    if (impact !== 'ALL') params.set('impact', impact)

    fetch(`/api/economic-calendar?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.events?.length) {
          setEvents(data.events)
          setSource(data.source ?? 'Finnhub + Scheduled')
        }
        // If API fails → base events already set above
      })
      .catch(() => { /* silently keep base events */ })
      .finally(() => setLoading(false))
  }, [region, impact])

  const displayed = events.filter(e => {
    if (region !== 'ALL' && e.region !== region) return false
    if (impact !== 'ALL' && e.impact !== impact) return false
    return true
  })

  const todayCount = displayed.filter(e => isToday(e.date)).length
  const highCount  = displayed.filter(e => e.impact === 'high').length

  return (
    <div className="panel" style={{ height:'100%', display:'flex', flexDirection:'column' }}>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div className="dot" style={{ background:'var(--negative)' }} />
          ECONOMIC CALENDAR
          {todayCount > 0 && (
            <span style={{
              fontSize:'9px', padding:'1px 6px', borderRadius:'2px',
              background:'rgba(255,69,96,0.15)', color:'var(--negative)',
              border:'1px solid rgba(255,69,96,0.3)', fontFamily:'JetBrains Mono,monospace',
            }}>
              {todayCount} TODAY
            </span>
          )}
        </div>
        <span style={{ fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace' }}>
          {loading ? 'updating…' : source}
        </span>
      </div>

      {/* Filters */}
      <div style={{
        display:'flex', gap:'3px', padding:'5px 10px',
        borderBottom:'1px solid var(--border)', flexShrink:0,
        flexWrap:'wrap', alignItems:'center',
      }}>
        {(['ALL','US','IN','EU','UK'] as RegionFilter[]).map(r => (
          <button key={r} onClick={() => setRegion(r)} style={{
            padding:'2px 7px', borderRadius:'3px', cursor:'pointer',
            fontFamily:'JetBrains Mono,monospace', fontSize:'9px',
            border:`1px solid ${region===r ? 'var(--teal)' : 'var(--border)'}`,
            background: region===r ? 'rgba(0,229,192,0.1)' : 'transparent',
            color: region===r ? 'var(--teal)' : 'var(--text-muted)',
          }}>
            {r==='US'?'🇺🇸 ':r==='IN'?'🇮🇳 ':r==='EU'?'🇪🇺 ':r==='UK'?'🇬🇧 ':''}{r}
          </button>
        ))}
        <div style={{ marginLeft:'auto', display:'flex', gap:'3px' }}>
          {(['ALL','high','medium'] as ImpactFilter[]).map(i => (
            <button key={i} onClick={() => setImpact(i)} style={{
              padding:'2px 7px', borderRadius:'3px', cursor:'pointer',
              fontFamily:'JetBrains Mono,monospace', fontSize:'9px',
              border:`1px solid ${impact===i ? (IMPACT_COLOR[i]??'var(--border)') : 'var(--border)'}`,
              background: impact===i ? (IMPACT_BG[i]??'transparent') : 'transparent',
              color: impact===i ? (IMPACT_COLOR[i]??'#fff') : 'var(--text-muted)',
            }}>
              {i==='ALL' ? 'ALL' : i.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Event list */}
      <div style={{ flex:1, overflowY:'auto' }}>
        {displayed.length === 0 && (
          <div style={{ padding:'24px', textAlign:'center', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', fontSize:'11px' }}>
            No events match current filters
          </div>
        )}

        {displayed.map((ev, i) => {
          const today  = isToday(ev.date)
          const rel    = relDay(ev.date)
          const ic     = IMPACT_COLOR[ev.impact] ?? 'var(--text-muted)'
          const ib     = IMPACT_BG[ev.impact]    ?? 'transparent'
          const icon   = CAT_ICON[ev.category]   ?? '📋'
          const isPast = new Date(ev.date).getTime() < Date.now() - 3600_000

          return (
            <div key={ev.id + i} style={{
              padding:      '8px 14px',
              borderBottom: '1px solid var(--border)',
              background:   today ? 'rgba(255,69,96,0.03)' : 'transparent',
              borderLeft:   today ? '2px solid var(--negative)' : '2px solid transparent',
              opacity:      isPast && !today ? 0.55 : 1,
              display:      'grid',
              gridTemplateColumns: '34px 1fr auto',
              gap:          '8px',
              alignItems:   'start',
            }}>
              {/* Day + dot */}
              <div style={{ textAlign:'center', paddingTop:'2px' }}>
                <div style={{ fontSize:'8px', color: today?'var(--negative)':'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginBottom:'4px', fontWeight: today?700:400 }}>
                  {rel}
                </div>
                <div style={{
                  width:'8px', height:'8px', borderRadius:'50%',
                  background: ic, margin:'0 auto',
                  boxShadow: ev.impact==='high' ? `0 0 6px ${ic}` : 'none',
                }} />
              </div>

              {/* Event info */}
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'3px', flexWrap:'wrap' }}>
                  <span style={{ fontSize:'11px' }}>{icon}</span>
                  <span style={{ fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:'11px', color:'#fff', lineHeight:1.3 }}>
                    {ev.title}
                  </span>
                </div>
                <div style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginBottom:'4px' }}>
                  {ev.time}{ev.country ? ` · ${ev.country}` : ''}
                </div>
                {(ev.forecast || ev.previous || ev.actual) && (
                  <div style={{ display:'flex', gap:'10px', fontSize:'9px', fontFamily:'JetBrains Mono,monospace' }}>
                    {ev.forecast && <span><span style={{color:'var(--text-muted)'}}>Est </span><span style={{color:'var(--text-2)'}}>{ev.forecast}</span></span>}
                    {ev.previous && <span><span style={{color:'var(--text-muted)'}}>Prev </span><span style={{color:'var(--text-2)'}}>{ev.previous}</span></span>}
                    {ev.actual   && <span><span style={{color:'var(--text-muted)'}}>Act </span><span style={{color:'var(--positive)',fontWeight:700}}>{ev.actual}</span></span>}
                  </div>
                )}
              </div>

              {/* Impact badge */}
              <div style={{
                fontSize:'8px', padding:'2px 6px', borderRadius:'2px',
                background: ib, color: ic,
                border: `1px solid ${ic}33`,
                fontFamily:'JetBrains Mono,monospace', fontWeight:700,
                letterSpacing:'0.06em', textTransform:'uppercase' as const,
                whiteSpace:'nowrap' as const, alignSelf:'flex-start',
              }}>
                {ev.impact}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div style={{
        padding:'4px 12px', borderTop:'1px solid var(--border)', flexShrink:0,
        fontSize:'7px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace',
        display:'flex', justifyContent:'space-between',
      }}>
        <span>{displayed.length} events</span>
        <span>FOMC · RBI · ECB · NFP · CPI scheduled dates</span>
      </div>
    </div>
  )
}