'use client'

import { useState, useEffect } from 'react'
import TickerBar   from '@/components/ui/TickerBar'
import GridLayout  from '@/components/dashboard/GridLayout'
// import BullBearMascot from '@/components/ui/BullBearMascot'

// ── Market status bar ─────────────────────────────────────────────────────────

function MarketStatusBar() {
  const [times,  setTimes]  = useState<{ et: string; lon: string; ist: string } | null>(null)
  const [status, setStatus] = useState({ label: '···', color: 'var(--text-muted)', sub: '', pulse: false })

  useEffect(() => {
    const update = () => {
      const now = new Date()
      setTimes({
        et:  now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        lon: now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'Europe/London',    hour: '2-digit', minute: '2-digit' }),
        ist: now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Kolkata',     hour: '2-digit', minute: '2-digit' }),
      })

      const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const day = et.getDay()
      const h   = et.getHours()
      const m   = et.getMinutes()
      const t   = h * 60 + m

      if (day === 0 || day === 6) {
        setStatus({ label: 'WEEKEND', color: 'var(--text-muted)', sub: 'NYSE reopens Monday', pulse: false })
      } else if (t >= 240 && t < 570) {
        const mins = 570 - t
        setStatus({ label: 'PRE-MARKET', color: '#f0a500', sub: `Opens in ${Math.floor(mins / 60)}h ${mins % 60}m`, pulse: false })
      } else if (t >= 570 && t < 960) {
        const mins = 960 - t
        setStatus({ label: 'MARKET OPEN', color: '#00c97a', sub: `Closes in ${Math.floor(mins / 60)}h ${mins % 60}m`, pulse: true })
      } else if (t >= 960 && t < 1200) {
        setStatus({ label: 'AFTER-HOURS', color: '#1e90ff', sub: 'Extended trading active', pulse: false })
      } else {
        setStatus({ label: 'CLOSED', color: 'var(--text-muted)', sub: 'Pre-market 4:00 AM ET', pulse: false })
      }
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  if (!times) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
      {/* Market status badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <div style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: status.color,
          boxShadow: status.pulse ? `0 0 10px ${status.color}` : 'none',
          animation: status.pulse ? 'pulseDot 2s ease-in-out infinite' : 'none',
          flexShrink: 0,
        }} />
        <span style={{
          fontSize: '11px', color: status.color,
          fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', fontWeight: 700,
          whiteSpace: 'nowrap',
        }}>
          {status.label}
        </span>
        <span style={{
          fontSize: '10px', color: 'var(--text-muted)',
          fontFamily: 'JetBrains Mono, monospace',
          whiteSpace: 'nowrap',
          // Hide sub-label on very small screens
          display: 'var(--status-sub-display, inline)',
        }}>
          {status.sub}
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: '1px', height: '20px', background: 'var(--border)', flexShrink: 0 }} />

      {/* Clocks */}
      <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
        {[
          { label: 'NY',  value: times.et,  highlight: true  },
          { label: 'LON', value: times.lon, highlight: false },
          { label: 'IST', value: times.ist, highlight: false },
        ].map(({ label, value, highlight }) => (
          <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ fontSize: '8px', color: 'var(--text-muted)', letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace' }}>
              {label}
            </div>
            <div style={{
              fontSize: '12px', fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.04em', color: highlight ? '#fff' : 'var(--text-2)',
              whiteSpace: 'nowrap',
            }}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)' }}>

      {/* ── Sticky Header ──────────────────────────────────────────────────── */}
      <header style={{
        position:      'sticky',
        top:            0,
        zIndex:         100,
        borderBottom:  '1px solid var(--border)',
        background:    'var(--bg-panel)',
        height:        '46px',
        display:       'flex',
        alignItems:    'center',
        justifyContent:'space-between',
        padding:       '0 16px',
        gap:           '12px',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <div style={{
            fontFamily:   'Syne, sans-serif',
            fontWeight:   800,
            fontSize:     '20px',
            color:        '#fff',
            letterSpacing:'-0.02em',
          }}>
            NEX<span style={{ color: 'var(--amber)' }}>US</span>
          </div>
          {/* Hide tagline on very narrow screens */}
          <div style={{
            borderLeft:   '1px solid var(--border)',
            paddingLeft:  '10px',
            fontSize:     '9px',
            color:        'var(--text-muted)',
            fontFamily:   'JetBrains Mono, monospace',
            letterSpacing:'0.12em',
            display:      'none',  // hidden mobile, shown via CSS
          }}
            className="nexus-tagline"
          >
            TRADING INTELLIGENCE
          </div>
        </div>

        {/* Market status — hidden on tiny mobile, shown otherwise */}
        <div className="nexus-market-status" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
          <MarketStatusBar />
        </div>
      </header>

      {/* ── Ticker Bar ─────────────────────────────────────────────────────── */}
      <TickerBar />

      {/* ── BullBear Mascot ─────────────────────────────────────────────────────── */}
      {/* <BullBearMascot /> */}

      {/* ── Main grid ──────────────────────────────────────────────────────── */}
      <main>
        <GridLayout />
      </main>

      {/* ── Responsive CSS ──────────────────────────────────────────────────── */}
      <style>{`
        /* Mobile — under 640px */
        @media (max-width: 639px) {
          .nexus-tagline { display: none !important; }
          .nexus-market-status { font-size: 9px; }
          header { padding: 0 10px !important; gap: 8px !important; }
        }

        /* Tablet — 640px to 1023px */
        @media (min-width: 640px) and (max-width: 1023px) {
          .nexus-tagline { display: block !important; }
        }

        /* Desktop */
        @media (min-width: 1024px) {
          .nexus-tagline { display: block !important; }
        }

        @keyframes pulseDot {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}