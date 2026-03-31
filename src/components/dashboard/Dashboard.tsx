'use client'

import { useState, useEffect } from 'react'
import TickerBar  from '@/components/ui/TickerBar'
import GridLayout from '@/components/dashboard/GridLayout'

function MarketStatusBar() {
  const [times,  setTimes]  = useState<{ et: string; gmt: string; hkt: string } | null>(null)
  const [status, setStatus] = useState({ label: 'LOADING', color: 'var(--text-muted)', sub: '', pulse: false })

  useEffect(() => {
    const update = () => {
      const now = new Date()

      setTimes({
        et:  now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        gmt: now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'UTC',              hour: '2-digit', minute: '2-digit' }),
        hkt: now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Hong_Kong',   hour: '2-digit', minute: '2-digit' }),
      })

      const et     = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const day    = et.getDay()
      const h      = et.getHours()
      const m      = et.getMinutes()
      const t      = h * 60 + m

      if (day === 0 || day === 6) {
        setStatus({ label: 'WEEKEND', color: 'var(--text-muted)', sub: 'NYSE reopens Monday', pulse: false })
      } else if (t >= 240 && t < 570) {
        const mins = 570 - t
        setStatus({ label: 'PRE-MARKET', color: '#f0a500', sub: `Opens in ${Math.floor(mins/60)}h ${mins%60}m`, pulse: false })
      } else if (t >= 570 && t < 960) {
        const mins = 960 - t
        setStatus({ label: 'MARKET OPEN', color: '#00c97a', sub: `Closes in ${Math.floor(mins/60)}h ${mins%60}m`, pulse: true })
      } else if (t >= 960 && t < 1200) {
        setStatus({ label: 'AFTER-HOURS', color: '#1e90ff', sub: 'Extended trading active', pulse: false })
      } else {
        setStatus({ label: 'CLOSED', color: 'var(--text-muted)', sub: 'Pre-market 4:00 AM ET', pulse: false })
      }
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])

  if (!times) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
      {/* Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: status.color,
          boxShadow: status.pulse ? `0 0 10px ${status.color}` : 'none',
          animation: status.pulse ? 'pulseDot 2s ease-in-out infinite' : 'none',
        }} />
        <span style={{ fontSize: '11px', color: status.color, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', fontWeight: 700 }}>
          {status.label}
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {status.sub}
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '20px', background: 'var(--border)' }} />

      {/* Clocks */}
      <div style={{ display: 'flex', gap: '18px', alignItems: 'center' }}>
        {[
          { label: 'NEW YORK', value: times.et,  highlight: true  },
          { label: 'LONDON',   value: times.gmt, highlight: false },
          { label: 'HK',       value: times.hkt, highlight: false },
        ].map(({ label, value, highlight }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '8px', color: 'var(--text-muted)', letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace' }}>
              {label}
            </div>
            <div style={{ fontSize: '12px', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.04em', color: highlight ? '#fff' : 'var(--text-2)', marginTop: '1px' }}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>

      {/* ── Header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        height: '46px',
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 18px',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '20px', color: '#fff', letterSpacing: '-0.02em' }}>
            NEX<span style={{ color: 'var(--amber)' }}>US</span>
          </div>
          <div style={{
            borderLeft: '1px solid var(--border)', paddingLeft: '12px',
            fontSize: '9px', color: 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em',
          }}>
            TRADING INTELLIGENCE
          </div>
        </div>

        <MarketStatusBar />
      </div>

      {/* ── Ticker ── */}
      <TickerBar />

      {/* ── Panels ── */}
      <GridLayout />
    </div>
  )
}