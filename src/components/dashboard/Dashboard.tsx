'use client'

import { useState, useEffect, useRef } from 'react'
import TickerBar   from '@/components/ui/TickerBar'
import GridLayout  from '@/components/dashboard/GridLayout'
import Footer from '@/components/ui/Footer'

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
      const t   = et.getHours() * 60 + et.getMinutes()

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
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <div style={{
          width: '7px', height: '7px', borderRadius: '50%',
          background: status.color,
          boxShadow: status.pulse ? `0 0 10px ${status.color}` : 'none',
          animation: status.pulse ? 'pulseDot 2s ease-in-out infinite' : 'none',
        }} />
        <span style={{
          fontSize: '11px', color: status.color,
          fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
          letterSpacing: '0.08em',
        }}>
          {status.label}
        </span>

        <span className="status-sub">
          {status.sub}
        </span>
      </div>

      <div className="divider" />

      <div className="clock-wrap">
        {[
          { label: 'NY',  value: times.et,  highlight: true  },
          { label: 'LON', value: times.lon, highlight: false },
          { label: 'IST', value: times.ist, highlight: false },
        ].map(({ label, value, highlight }) => (
          <div key={label} className="clock">
            <div className="clock-label">{label}</div>
            <div className={`clock-value ${highlight ? 'active' : ''}`}>
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
  const topRef = useRef<HTMLDivElement>(null)
  const [topHeight, setTopHeight] = useState(0)

  useEffect(() => {
    const updateHeight = () => {
      if (topRef.current) {
        setTopHeight(topRef.current.offsetHeight)
      }
    }

    updateHeight()
    window.addEventListener('resize', updateHeight)

    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  return (
    <div className="app-root">

      {/* ── Sticky Top Nav (Header + Ticker) ───────────────────────────── */}
      <div ref={topRef} className="top-nav">

        <header className="header">
          <div className="logo-wrap">
            <div className="logo">
              NEX<span className="accent">US</span>
            </div>

            <div className="tagline">
              TRADING INTELLIGENCE
            </div>
          </div>

          <div className="market-status">
            <MarketStatusBar />
          </div>
        </header>

        <TickerBar />
      </div>
      
      <div style={{ height: '6px' }} /> {/* Spacer to prevent content jump */}

      {/* ── Scrollable Content ─────────────────────────────────────────── */}
      <main
        className="grid-container"
        style={{ height: `calc(100vh - ${topHeight}px)` }}
      >
        <GridLayout />
        <Footer />
      </main>

      {/* ── Styles ─────────────────────────────────────────────────────── */}
      <style>{`

        /* Lock page scroll */
        html, body, .app-root {
          height: 100%;
          overflow: hidden;
        }

        .top-nav {
          position: sticky;
          top: 0;
          z-index: 1000;
          background: var(--bg-panel);
          display: flex;
          flex-direction: column;
          border-bottom: 1px solid var(--border);
        }

        .header {
          height: 46px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 16px;
          gap: 12px;
        }

        .logo-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .logo {
          font-family: 'Syne', sans-serif;
          font-weight: 800;
          font-size: 20px;
          color: #fff;
        }

        .accent {
          color: var(--amber);
        }

        .tagline {
          border-left: 1px solid var(--border);
          padding-left: 10px;
          font-size: 9px;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.12em;
        }

        .market-status {
          flex: 1;
          display: flex;
          justify-content: flex-end;
        }

        .grid-container {
          overflow-y: auto;
          overflow-x: hidden;
          padding: 12px;
          scroll-behavior: smooth;
        }

        .divider {
          width: 1px;
          height: 16px;
          background: var(--border);
        }

        .clock-wrap {
          display: flex;
          gap: 14px;
        }

        .clock {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .clock-label {
          font-size: 8px;
          color: var(--text-muted);
        }

        .clock-value {
          font-size: 12px;
          font-family: 'JetBrains Mono', monospace;
        }

        .clock-value.active {
          color: #fff;
        }

        .status-sub {
          font-size: 10px;
          color: var(--text-muted);
          margin-left: 4px;
        }

        /* Mobile */
        @media (max-width: 639px) {
          .tagline { display: none; }
          .status-sub { display: none; }
          .header { padding: 0 10px; }
        }

        /* Tablet */
        @media (min-width: 640px) and (max-width: 1023px) {
          .tagline { display: block; }
        }

        @keyframes pulseDot {
          0%,100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

      `}</style>
    </div>
  )
}