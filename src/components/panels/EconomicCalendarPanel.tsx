'use client'

import { useEffect, useState } from 'react'

interface CalEvent {
  event: string
  date: string
  impact: 'high' | 'medium' | 'low'
  actual: string | null
  estimate: string | null
  prev: string | null
}

const HARDCODED_UPCOMING: CalEvent[] = [
  { event: 'FOMC Meeting Minutes', date: 'Wed', impact: 'high', actual: null, estimate: null, prev: null },
  { event: 'CPI YoY', date: 'Thu', impact: 'high', actual: null, estimate: '3.1%', prev: '3.2%' },
  { event: 'Initial Jobless Claims', date: 'Thu', impact: 'medium', actual: null, estimate: '215K', prev: '211K' },
  { event: 'Core PPI MoM', date: 'Thu', impact: 'medium', actual: null, estimate: '0.2%', prev: '0.3%' },
  { event: 'Michigan Sentiment', date: 'Fri', impact: 'medium', actual: null, estimate: '72.5', prev: '73.0' },
  { event: 'Fed Chair Speech', date: 'Fri', impact: 'high', actual: null, estimate: null, prev: null },
]

export default function EconomicCalendarPanel() {
  const impactColor = (i: string) =>
    i === 'high' ? 'var(--negative)' : i === 'medium' ? 'var(--amber)' : 'var(--text-muted)'

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" style={{ background: 'var(--red, #ff4560)' }} />
        ECONOMIC CALENDAR
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {HARDCODED_UPCOMING.map((ev, i) => (
          <div key={i} style={{
            padding: '8px 14px',
            borderBottom: '1px solid var(--border)',
            display: 'grid',
            gridTemplateColumns: '36px 1fr auto',
            alignItems: 'start', gap: '8px',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                {ev.date}
              </div>
              <div style={{
                width: '8px', height: '8px', borderRadius: '50%',
                background: impactColor(ev.impact),
                margin: '4px auto 0',
                boxShadow: ev.impact === 'high' ? `0 0 6px ${impactColor(ev.impact)}` : 'none',
              }} />
            </div>
            <div>
              <div style={{
                fontFamily: 'Syne, sans-serif', fontWeight: 600,
                fontSize: '11px', color: '#fff', marginBottom: '3px',
              }}>{ev.event}</div>
              {(ev.estimate || ev.prev) && (
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {ev.estimate && `est: ${ev.estimate}`}
                  {ev.estimate && ev.prev && ' · '}
                  {ev.prev && `prev: ${ev.prev}`}
                </div>
              )}
            </div>
            <div style={{
              fontSize: '9px', padding: '2px 6px',
              borderRadius: '2px', letterSpacing: '0.06em',
              background: impactColor(ev.impact) + '18',
              color: impactColor(ev.impact),
              border: `1px solid ${impactColor(ev.impact)}33`,
              fontFamily: 'JetBrains Mono, monospace',
              textTransform: 'uppercase', alignSelf: 'flex-start',
            }}>
              {ev.impact}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}