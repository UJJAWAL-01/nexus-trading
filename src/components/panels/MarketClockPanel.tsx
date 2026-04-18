'use client'

import { useEffect, useState } from 'react'

interface MarketCenter {
  city:       string
  country:    string
  flag:       string
  tz:         string
  exchange:   string
  openHour:   number  // local 24h
  openMin:    number
  closeHour:  number
  closeMin:   number
  tradingDays: number[] // 0=Sun…6=Sat
}

const MARKETS: MarketCenter[] = [
  { city: 'New York',   country: 'US',  flag: '🇺🇸', tz: 'America/New_York',    exchange: 'NYSE / NASDAQ', openHour: 9,  openMin: 30, closeHour: 16, closeMin: 0,  tradingDays: [1,2,3,4,5] },
  { city: 'Chicago',    country: 'US',  flag: '🇺🇸', tz: 'America/Chicago',     exchange: 'CME / CBOT',    openHour: 8,  openMin: 30, closeHour: 15, closeMin: 15, tradingDays: [1,2,3,4,5] },
  { city: 'London',     country: 'UK',  flag: '🇬🇧', tz: 'Europe/London',       exchange: 'LSE',           openHour: 8,  openMin: 0,  closeHour: 16, closeMin: 30, tradingDays: [1,2,3,4,5] },
  { city: 'Frankfurt',  country: 'DE',  flag: '🇩🇪', tz: 'Europe/Berlin',       exchange: 'Xetra / FSE',   openHour: 9,  openMin: 0,  closeHour: 17, closeMin: 30, tradingDays: [1,2,3,4,5] },
  { city: 'Mumbai',     country: 'IN',  flag: '🇮🇳', tz: 'Asia/Kolkata',        exchange: 'NSE / BSE',     openHour: 9,  openMin: 15, closeHour: 15, closeMin: 30, tradingDays: [1,2,3,4,5] },
  { city: 'Singapore',  country: 'SG',  flag: '🇸🇬', tz: 'Asia/Singapore',      exchange: 'SGX',           openHour: 9,  openMin: 0,  closeHour: 17, closeMin: 0,  tradingDays: [1,2,3,4,5] },
  { city: 'Tokyo',      country: 'JP',  flag: '🇯🇵', tz: 'Asia/Tokyo',          exchange: 'TSE',           openHour: 9,  openMin: 0,  closeHour: 15, closeMin: 30, tradingDays: [1,2,3,4,5] },
  { city: 'Hong Kong',  country: 'HK',  flag: '🇭🇰', tz: 'Asia/Hong_Kong',      exchange: 'HKEX',          openHour: 9,  openMin: 30, closeHour: 16, closeMin: 0,  tradingDays: [1,2,3,4,5] },
  { city: 'Sydney',     country: 'AU',  flag: '🇦🇺', tz: 'Australia/Sydney',    exchange: 'ASX',           openHour: 10, openMin: 0,  closeHour: 16, closeMin: 0,  tradingDays: [1,2,3,4,5] },
]

interface ClockState {
  timeStr:    string
  dateStr:    string
  status:     'open' | 'premarket' | 'afterhours' | 'closed' | 'weekend'
  countdown:  string
  pct:        number   // 0–100 how far through the session
}

function computeState(market: MarketCenter, now: Date): ClockState {
  const local = new Date(now.toLocaleString('en-US', { timeZone: market.tz }))
  const day   = local.getDay()
  const h     = local.getHours()
  const m     = local.getMinutes()
  const s     = local.getSeconds()
  const t     = h * 3600 + m * 60 + s

  const timeStr = local.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const dateStr = local.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const openSec  = market.openHour  * 3600 + market.openMin  * 60
  const closeSec = market.closeHour * 3600 + market.closeMin * 60

  if (!market.tradingDays.includes(day)) {
    return { timeStr, dateStr, status: 'weekend', countdown: 'Closed — Weekend', pct: 0 }
  }

  let status: ClockState['status']
  let countdown = ''
  let pct = 0

  if (t < openSec - 3600) {
    status    = 'closed'
    const rem = openSec - t
    countdown = `Opens in ${Math.floor(rem / 3600)}h ${Math.floor((rem % 3600) / 60)}m`
  } else if (t < openSec) {
    status    = 'premarket'
    const rem = openSec - t
    countdown = `Pre-market · Opens in ${Math.floor(rem / 60)}m ${rem % 60}s`
  } else if (t >= openSec && t < closeSec) {
    status    = 'open'
    const rem = closeSec - t
    pct       = Math.round(((t - openSec) / (closeSec - openSec)) * 100)
    countdown = `Closes in ${Math.floor(rem / 3600)}h ${Math.floor((rem % 3600) / 60)}m`
  } else if (t < closeSec + 3600) {
    status    = 'afterhours'
    countdown = 'After-hours trading'
  } else {
    status    = 'closed'
    // Next open: tomorrow (simplified)
    const rem = 86400 - t + openSec
    countdown = `Opens in ${Math.floor(rem / 3600)}h ${Math.floor((rem % 3600) / 60)}m`
  }

  return { timeStr, dateStr, status, countdown, pct }
}

const STATUS_STYLES = {
  open:       { label: 'OPEN',       dot: '#00c97a', text: '#00c97a', bg: 'rgba(0,201,122,0.08)',  border: 'rgba(0,201,122,0.2)'  },
  premarket:  { label: 'PRE',        dot: '#f0a500', text: '#f0a500', bg: 'rgba(240,165,0,0.06)',  border: 'rgba(240,165,0,0.15)' },
  afterhours: { label: 'AH',         dot: '#1e90ff', text: '#1e90ff', bg: 'rgba(30,144,255,0.06)', border: 'rgba(30,144,255,0.15)'},
  closed:     { label: 'CLOSED',     dot: '#4a6070', text: '#4a6070', bg: 'transparent',           border: 'var(--border)'       },
  weekend:    { label: 'WEEKEND',    dot: '#4a6070', text: '#4a6070', bg: 'transparent',           border: 'var(--border)'       },
}

export default function MarketClockPanel() {
  const [states, setStates] = useState<ClockState[]>(() =>
    MARKETS.map(m => computeState(m, new Date()))
  )

  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setStates(MARKETS.map(m => computeState(m, now)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const openCount = states.filter(s => s.status === 'open').length

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: openCount > 0 ? '#00c97a' : '#4a6070' }} />
          WORLD MARKET CLOCKS
        </div>
        <span style={{
          fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
          color: openCount > 0 ? '#00c97a' : 'var(--text-muted)',
        }}>
          {openCount} OPEN
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {MARKETS.map((m, i) => {
          const st    = states[i]
          const sty   = STATUS_STYLES[st.status]
          const isTop = m.city === 'New York' || m.city === 'Mumbai'

          return (
            <div key={m.city} style={{
              padding:      '9px 14px',
              borderBottom: '1px solid var(--border)',
              background:   st.status === 'open' ? 'rgba(0,201,122,0.03)' : 'transparent',
            }}>
              {/* Row 1 — city + time */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '14px' }}>{m.flag}</span>
                  <div>
                    <div style={{
                      fontFamily: 'Syne, sans-serif', fontWeight: isTop ? 800 : 700,
                      fontSize:   isTop ? '13px' : '12px', color: '#fff',
                    }}>
                      {m.city}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em' }}>
                      {m.exchange}
                    </div>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontFamily:    'JetBrains Mono, monospace',
                    fontSize:      isTop ? '18px' : '15px',
                    fontWeight:    700,
                    color:         st.status === 'open' ? '#fff' : 'var(--text-2)',
                    letterSpacing: '0.02em',
                  }}>
                    {st.timeStr}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {st.dateStr}
                  </div>
                </div>
              </div>

              {/* Row 2 — status bar */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '5px' }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '4px 10px', borderRadius: '2px',
                  background: sty.bg, border: `1px solid ${sty.border}`,
                }}>
                  <div style={{
                    width: '5px', height: '5px', borderRadius: '50%',
                    background: sty.dot,
                    animation: st.status === 'open' ? 'pulseDot 2s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{
                    fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
                    color:    sty.text, fontWeight: 700, letterSpacing: '0.08em',
                  }}>
                    {sty.label}
                  </span>
                </div>

                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {st.countdown}
                </span>

                {st.status === 'open' && (
                  <div style={{ flex: 1, height: '3px', background: 'var(--bg-deep)', borderRadius: '2px', overflow: 'hidden', marginLeft: 'auto' }}>
                    <div style={{
                      height: '100%', width: `${st.pct}%`,
                      background: 'linear-gradient(90deg, rgba(0,201,122,0.4), rgba(0,201,122,0.8))',
                      borderRadius: '2px',
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div style={{
        padding: '6px 14px', borderTop: '1px solid var(--border)',
        display: 'flex', gap: '12px', flexShrink: 0,
      }}>
        {[
          { label: 'OPEN',  color: '#00c97a' },
          { label: 'PRE',   color: '#f0a500' },
          { label: 'AH',    color: '#1e90ff' },
          { label: 'CLOSED',color: '#4a6070' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: color }} />
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}