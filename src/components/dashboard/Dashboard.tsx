'use client'

import { useState, useEffect, useRef } from 'react'
import TickerBar         from '@/components/ui/TickerBar'
import TopSearchBar      from '@/components/ui/TopSearchBar'
import GridLayout        from '@/components/dashboard/GridLayout'
import TabbedDashboard   from '@/components/dashboard/TabbedDashboard'
import MorningBrief      from '@/components/dashboard/MorningBrief'
import ActiveSymbolPill  from '@/components/dashboard/ActiveSymbolPill'
import Footer            from '@/components/ui/Footer'
import { useLayoutMode } from '@/store/layoutMode'
import { SymbolUrlSync } from '@/store/symbol'

// ── Market status bar ─────────────────────────────────────────────────────────

function MarketStatusBar() {
  // Compute initial value synchronously so first render shows real status
  // (not "···") and avoids a 1-second blank gap on page load.
  const computeNow = () => {
    const now = new Date()
    const times = {
      et:  now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      lon: now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'Europe/London',    hour: '2-digit', minute: '2-digit' }),
      ist: now.toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Kolkata',     hour: '2-digit', minute: '2-digit' }),
    }
    const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const day = et.getDay()
    const t   = et.getHours() * 60 + et.getMinutes()

    let label = 'CLOSED', color = 'var(--text-muted)', sub = 'Pre-market 4:00 AM ET', pulse = false
    if (day === 0 || day === 6) {
      label = 'WEEKEND'; sub = 'NYSE reopens Monday'
    } else if (t >= 240 && t < 570) {
      const mins = 570 - t
      label = 'PRE-MARKET'; color = '#f0a500'; sub = `Opens in ${Math.floor(mins / 60)}h ${mins % 60}m`
    } else if (t >= 570 && t < 960) {
      const mins = 960 - t
      label = 'MARKET OPEN'; color = '#00c97a'; sub = `Closes in ${Math.floor(mins / 60)}h ${mins % 60}m`; pulse = true
    } else if (t >= 960 && t < 1200) {
      label = 'AFTER-HOURS'; color = '#1e90ff'; sub = 'Extended trading active'
    }
    return { times, status: { label, color, sub, pulse } }
  }

  // SSR-safe: only call computeNow on the client.  Server renders a stable
  // "···" placeholder that hydration replaces synchronously on first mount.
  const [snapshot, setSnapshot] = useState<ReturnType<typeof computeNow> | null>(null)

  useEffect(() => {
    setSnapshot(computeNow())
    const id = setInterval(() => {
      // Only update state when something actually changed — this prevents
      // 1Hz re-renders for every consumer when the minute hasn't ticked.
      setSnapshot(prev => {
        const next = computeNow()
        if (
          prev &&
          prev.times.et  === next.times.et  &&
          prev.times.lon === next.times.lon &&
          prev.times.ist === next.times.ist &&
          prev.status.label === next.status.label &&
          prev.status.sub   === next.status.sub
        ) return prev
        return next
      })
    }, 1000)
    return () => clearInterval(id)
  }, [])

  if (!snapshot) return null
  const { times, status } = snapshot

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
          { key: 'ny',  label: 'NY',  value: times.et,  highlight: true  },
          { key: 'lon', label: 'LON', value: times.lon, highlight: false },
          { key: 'ist', label: 'IST', value: times.ist, highlight: false },
        ].map(({ key, label, value, highlight }) => (
          <div key={key} className={`clock clock-${key}`}>
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

// ── Layout mode toggle (Pro Tabs ↔ Classic Grid) ──────────────────────────────

function LayoutModeToggle() {
  const mode = useLayoutMode(s => s.mode)
  const setMode = useLayoutMode(s => s.setMode)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => { setHydrated(true) }, [])
  if (!hydrated) return null

  return (
    <div className="layout-mode-toggle">
      <button
        onClick={() => setMode('tabs')}
        className={mode === 'tabs' ? 'active' : ''}
        title="Focused tab-based view with persistent chart + watchlist (recommended)"
      >
        Pro
      </button>
      <button
        onClick={() => setMode('classic')}
        className={mode === 'classic' ? 'active' : ''}
        title="Classic multi-panel grid with drag-and-resize"
      >
        Classic
      </button>
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  const topRef = useRef<HTMLDivElement>(null)
  const [topHeight, setTopHeight] = useState(0)
  const mode = useLayoutMode(s => s.mode)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => { setHydrated(true) }, [])

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

      {/* Reads `?s=AAPL` from the URL on mount and on browser back/forward.
          Mounted once at the app root — fire-and-forget, renders nothing. */}
      <SymbolUrlSync />

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

          <div className="header-search">
            <TopSearchBar />
          </div>

          <ActiveSymbolPill />

          <LayoutModeToggle />

          <div className="market-status">
            <MarketStatusBar />
          </div>
        </header>

        {/* Mobile-only search row (header search hidden on small screens) */}
        <div className="mobile-search">
          <TopSearchBar />
        </div>

        <TickerBar />

        {/* Top-of-day brief — joined with TickerBar in one sticky block,
            no gap behind which panels could show through. Hidden on mobile via CSS. */}
        <div className="top-brief">
          <MorningBrief />
        </div>
      </div>

      {/* ── Scrollable Content ─────────────────────────────────────────── */}
      <main
        className="grid-container"
        style={{ height: `calc(100vh - ${topHeight}px)` }}
      >
        {hydrated && mode === 'tabs' ? <TabbedDashboard /> : <GridLayout />}
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
          padding: 0 16px;
          gap: 16px;
        }

        .header-search {
          flex: 1 1 auto;
          display: flex;
          justify-content: center;
          min-width: 0;
        }

        .mobile-search {
          display: none;
          padding: 6px 8px 4px;
          border-bottom: 1px solid var(--border);
        }

        .logo-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .logo {
          font-family: 'Syne', sans-serif;
          font-weight: 800;
          font-size: 20px;
          color: #fff;
          white-space: nowrap;
        }

        .accent {
          color: var(--amber);
        }

        .tagline {
          border-left: 1px solid var(--border);
          padding-left: 10px;
          font-size: 11px;
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          letter-spacing: 0.12em;
          white-space: nowrap;
        }

        .market-status {
          flex: 0 0 auto;
          display: flex;
          justify-content: flex-end;
          min-width: 0;
        }

        .layout-mode-toggle {
          display: inline-flex;
          align-items: center;
          flex-shrink: 0;
          gap: 0;
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 1px;
          background: rgba(255,255,255,0.02);
        }
        .layout-mode-toggle button {
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          padding: 4px 10px;
          border: none;
          background: transparent;
          color: var(--text-muted);
          cursor: pointer;
          border-radius: 3px;
          transition: background 0.15s, color 0.15s;
        }
        .layout-mode-toggle button:hover:not(.active) {
          color: #fff;
        }
        .layout-mode-toggle button.active {
          background: rgba(240,165,0,0.18);
          color: var(--amber);
        }

        .grid-container {
          overflow-y: auto;
          overflow-x: hidden;
          /* No top padding — sticky toolbar inside GridLayout sits flush
             against the top-nav. Side+bottom padding remain for breathing room. */
          padding: 0 12px 12px;
          scroll-behavior: smooth;
        }

        .top-brief { display: block; }

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
          font-size: 10px;
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
          white-space: nowrap;
        }

        /* ── Responsive header tiers ──────────────────────────────────────
           ≥1200px : full layout (logo · tagline · search · status · 3 clocks)
           1100-1199 : hide tagline
           900-1099  : hide tagline + status sub-text, tighter clocks
           640-899   : hide LON clock, smaller spacing
           ≤639      : mobile — search moves to its own row, only NY clock
        */
        @media (max-width: 1199px) {
          .tagline { display: none; }
        }
        @media (max-width: 1099px) {
          .header { gap: 12px; }
          .clock-wrap { gap: 10px; }
          .status-sub { display: none; }
        }
        @media (max-width: 899px) {
          .header { padding: 0 12px; gap: 10px; }
          .clock-lon { display: none; }
          .clock-value { font-size: 11px; }
          .clock-label { font-size: 9px; }
          .clock-wrap { gap: 8px; }
        }
        @media (max-width: 899px) {
          .layout-mode-toggle button { padding: 3px 8px; font-size: 9px; }
        }
        @media (max-width: 639px) {
          .header { padding: 0 10px; gap: 8px; }
          .header-search { display: none; }     /* see mobile-search row */
          .mobile-search { display: block; }
          .clock-ist { display: none; }
          .top-brief { display: none; }
          .layout-mode-toggle { display: none; }
          .active-symbol-pill { display: none; } /* TODO: surface in mobile-search row in a later pass */
        }

        @keyframes pulseDot {
          0%,100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

      `}</style>
    </div>
  )
}