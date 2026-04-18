'use client'

import { useState, useEffect, useMemo } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CalEvent {
  id:       string
  title:    string
  country:  string
  region:   string
  date:     string       // ISO
  time:     string       // display string e.g. "2:00pm ET"
  impact:   'high' | 'medium' | 'low'
  forecast: string | null
  previous: string | null
  actual:   string | null
  category: string
}

const MAJOR = new Set(['US', 'EU', 'UK', 'JP'])

const IMP: Record<string, { dot: string; color: string; bg: string; border: string }> = {
  high:   { dot: 'var(--negative)', color: 'var(--negative)', bg: 'rgba(255,69,96,0.1)',   border: 'rgba(255,69,96,0.3)'  },
  medium: { dot: 'var(--amber)',    color: 'var(--amber)',    bg: 'rgba(240,165,0,0.1)',    border: 'rgba(240,165,0,0.3)'  },
  low:    { dot: 'var(--text-dim)', color: 'var(--text-dim)', bg: 'rgba(255,255,255,0.04)', border: 'var(--border)'        },
}

// ── Countdown ──────────────────────────────────────────────────────────────────

function Countdown({ target }: { target: string }) {
  const [diff, setDiff] = useState(new Date(target).getTime() - Date.now())
  useEffect(() => {
    const id = setInterval(() => setDiff(new Date(target).getTime() - Date.now()), 1000)
    return () => clearInterval(id)
  }, [target])

  if (diff <= 0) return (
    <span style={{ color: 'var(--positive)', fontWeight: 700, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>TODAY</span>
  )
  const s = Math.floor(diff / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24)
  const str = d > 0
    ? `${d}d ${h % 24}h`
    : h > 0
    ? `${h}h ${String(m % 60).padStart(2, '0')}m`
    : `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return (
    <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: diff < 3_600_000 ? 'var(--amber)' : 'var(--text-muted)', fontWeight: diff < 3_600_000 ? 700 : 400 }}>
      {str}
    </span>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function CalendarPanel() {
  const [events,    setEvents]    = useState<CalEvent[]>([])
  const [loading,   setLoading]   = useState(true)
  const [source,    setSource]    = useState('')
  const [fImpact,   setFImpact]   = useState('')
  const [fRegion,   setFRegion]   = useState('')
  const [majorOnly, setMajorOnly] = useState(false)

  useEffect(() => {
    fetch('/api/economic-calender')
      .then(r => r.json())
      .then(data => {
        setEvents(data.events ?? [])
        setSource(data.source ?? '')
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const regions  = useMemo(() => [...new Set(events.map(e => e.region))].filter(r => r !== 'OTHER').sort(), [events])
  const filtered = useMemo(() => events.filter(e => {
    if (fImpact   && e.impact  !== fImpact)  return false
    if (fRegion   && e.region  !== fRegion)  return false
    if (majorOnly && !MAJOR.has(e.region))   return false
    return true
  }), [events, fImpact, fRegion, majorOnly])

  const selStyle: React.CSSProperties = {
    background: 'var(--bg-deep)', border: '1px solid var(--border-br)', borderRadius: 3,
    padding: '3px 8px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', outline: 'none',
  }

  const TH = ({ ch }: { ch: string }) => (
    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 9, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 500, whiteSpace: 'nowrap' }}>
      {ch}
    </th>
  )

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" style={{ background: 'var(--amber)' }} />
        ECONOMIC CALENDAR
        <span className="panel-header-sub">
          {loading ? '...' : `${filtered.length} events · 3 weeks`}
        </span>
      </div>

      <div className="panel-filter-bar">
        <select value={fImpact} onChange={e => setFImpact(e.target.value)} style={selStyle}>
          <option value="">All Impact</option>
          {['high', 'medium', 'low'].map(i => (
            <option key={i} value={i} style={{ background: 'var(--bg-panel)' }}>
              {i.charAt(0).toUpperCase() + i.slice(1)}
            </option>
          ))}
        </select>
        <select value={fRegion} onChange={e => setFRegion(e.target.value)} style={selStyle}>
          <option value="">All Regions</option>
          {regions.map(r => <option key={r} value={r} style={{ background: 'var(--bg-panel)' }}>{r}</option>)}
        </select>
        <button onClick={() => setMajorOnly(w => !w)} style={{
          padding: '3px 10px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
          cursor: 'pointer', borderRadius: 3,
          border: `1px solid ${majorOnly ? 'rgba(0,229,192,0.5)' : 'var(--border-br)'}`,
          background: majorOnly ? 'rgba(0,229,192,0.12)' : 'transparent',
          color: majorOnly ? 'var(--teal)' : 'var(--text-muted)',
        }}>
          Major Only
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            Loading calendar...
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 580 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.015)' }}>
                {['Date / Time', 'Region', 'Event', 'Impact', 'Forecast', 'Previous', 'Countdown'].map(h => (
                  <TH key={h} ch={h} />
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
                    No events match these filters
                  </td>
                </tr>
              ) : filtered.map(ev => {
                const dateMs = new Date(ev.date).getTime()
                const past   = dateMs < Date.now() - 24 * 3_600_000
                const imp    = IMP[ev.impact] ?? IMP.low
                const dateStr = new Date(ev.date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                return (
                  <tr key={ev.id} className="nx-row" style={{ borderBottom: '1px solid var(--border)', opacity: past ? 0.4 : 1 }}>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                      <div style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace' }}>{ev.time}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>{dateStr}</div>
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                      {ev.region}
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: imp.dot, display: 'inline-block', flexShrink: 0 }} />
                        {ev.title}
                      </div>
                    </td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: imp.color, background: imp.bg, border: `1px solid ${imp.border}`, padding: '1px 5px', borderRadius: 3 }}>
                        {ev.impact.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>
                      {ev.forecast ?? '—'}
                    </td>
                    <td style={{ padding: '7px 10px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {ev.previous ?? '—'}
                    </td>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                      {ev.actual
                        ? <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--positive)' }}>{ev.actual}</span>
                        : past
                        ? <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>—</span>
                        : <Countdown target={ev.date} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding: '5px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 14, alignItems: 'center', background: 'rgba(255,255,255,0.01)' }}>
        {(['high', 'medium', 'low'] as const).map(i => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: IMP[i].dot, display: 'inline-block' }} />
            {i.charAt(0).toUpperCase() + i.slice(1)} Impact
          </span>
        ))}
        {source && (
          <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            {source}
          </span>
        )}
      </div>
    </div>
  )
}
