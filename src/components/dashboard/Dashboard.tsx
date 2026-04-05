'use client'

import { useState, useEffect } from 'react'
import TickerBar  from '@/components/ui/TickerBar'
import GridLayout from '@/components/dashboard/GridLayout'
import Footer     from '@/components/ui/Footer'

const MOBILE_BREAKPOINT = 768

function MarketStatusBar() {
  const [times,  setTimes]  = useState<{ et: string; gmt: string; hkt: string } | null>(null)
  const [status, setStatus] = useState({ label: 'LOADING', color: 'var(--text-muted)', sub: '', pulse: false })
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    const handleResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

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

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
        {/* Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '7px', height: '7px', borderRadius: '50%',
            background: status.color,
            boxShadow: status.pulse ? `0 0 10px ${status.color}` : 'none',
            animation: status.pulse ? 'pulseDot 2s ease-in-out infinite' : 'none',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: '10px', color: status.color, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', fontWeight: 700 }}>
            {status.label}
          </span>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {status.sub}
          </span>
        </div>

        {/* Clocks */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', overflowX: 'auto', paddingBottom: '4px' }}>
          {[
            { label: 'NY', value: times.et,  highlight: true  },
            { label: 'LON', value: times.gmt, highlight: false },
            { label: 'HK', value: times.hkt, highlight: false },
          ].map(({ label, value, highlight }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <div style={{ fontSize: '8px', color: 'var(--text-muted)', letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace' }}>
                {label}
              </div>
              <div style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.04em', color: highlight ? '#fff' : 'var(--text-2)', marginTop: '1px' }}>
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

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
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    const handleResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>

      {/* ── Header ── */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        height: isMobile ? 'auto' : '46px',
        display: 'flex',
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        padding: isMobile ? '12px' : '0 18px',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? '12px' : '0',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '0', flex: isMobile ? '0 0 auto' : 'none' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: isMobile ? '18px' : '20px', color: '#fff', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>
            NEX<span style={{ color: 'var(--amber)' }}>US</span>
          </div>
          <div style={{
            borderLeft: '1px solid var(--border)', paddingLeft: '12px',
            fontSize: isMobile ? '8px' : '9px', color: 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em',
            display: isMobile ? 'none' : 'block',
          }}>
            TRADING INTELLIGENCE
          </div>
        </div>

        <div style={{ width: '100%', ...(isMobile ? {} : { flex: 1 }) }}>
          <MarketStatusBar />
        </div>
      </div>

      {/* ── Ticker ── */}
      <TickerBar />

      {/* ── Panels ── */}
      <GridLayout />

      {/* ── Footer ── */}
      <Footer />
    </div>
  )
}