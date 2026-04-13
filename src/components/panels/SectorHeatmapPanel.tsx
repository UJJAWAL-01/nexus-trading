'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

// ── Sector definitions with top components ────────────────────────────────────
const SECTORS = [
  { symbol: 'XLK',  name: 'Technology',     short: 'TECH',  components: ['AAPL','NVDA','MSFT','AVGO','AMD','ORCL','CRM','ACN'] },
  { symbol: 'XLC',  name: 'Comm. Services', short: 'COMM',  components: ['META','GOOGL','NFLX','DIS','CMCSA','T','VZ','EA'] },
  { symbol: 'XLY',  name: 'Cons. Discret.', short: 'DISC',  components: ['AMZN','TSLA','HD','MCD','NKE','SBUX','TJX','LOW'] },
  { symbol: 'XLF',  name: 'Financials',     short: 'FIN',   components: ['JPM','V','MA','BAC','WFC','GS','MS','AXP'] },
  { symbol: 'XLV',  name: 'Health Care',    short: 'HLTH',  components: ['LLY','UNH','JNJ','ABBV','MRK','PFE','TMO','ABT'] },
  { symbol: 'XLI',  name: 'Industrials',    short: 'IND',   components: ['GE','CAT','HON','UNP','RTX','BA','MMM','DE'] },
  { symbol: 'XLE',  name: 'Energy',         short: 'ENGY',  components: ['XOM','CVX','COP','SLB','EOG','MPC','VLO','PSX'] },
  { symbol: 'XLP',  name: 'Cons. Staples',  short: 'STPL',  components: ['PG','KO','PEP','COST','WMT','PM','MO','CL'] },
  { symbol: 'XLB',  name: 'Materials',      short: 'MATL',  components: ['LIN','APD','SHW','ECL','NEM','FCX','NUE','VMC'] },
  { symbol: 'XLRE', name: 'Real Estate',    short: 'REIT',  components: ['AMT','PLD','EQIX','CCI','PSA','WELL','DLR','SPG'] },
  { symbol: 'XLU',  name: 'Utilities',      short: 'UTIL',  components: ['NEE','DUK','AEP','EXC','SO','PCG','XEL','WEC'] },
]

interface SectorData { symbol: string; change: number | null }
interface MoverData { symbol: string; change: number | null; fetched: boolean }

// stale cache so movers don't blank on re-hover
const moversCache = new Map<string, MoverData[]>()

function getColors(change: number | null) {
  if (change === null) return { bg: 'rgba(74,96,112,0.15)', text: 'var(--text-muted)', border: 'rgba(74,96,112,0.2)' }
  if (change >  3)    return { bg: 'rgba(0,201,122,0.60)', text: '#00ffaa', border: 'rgba(0,201,122,0.7)' }
  if (change >  1.5)  return { bg: 'rgba(0,201,122,0.38)', text: '#00c97a', border: 'rgba(0,201,122,0.5)' }
  if (change >  0.3)  return { bg: 'rgba(0,201,122,0.16)', text: '#00a866', border: 'rgba(0,201,122,0.25)' }
  if (change > -0.3)  return { bg: 'rgba(74,96,112,0.2)',  text: 'var(--text-2)', border: 'rgba(74,96,112,0.3)' }
  if (change > -1.5)  return { bg: 'rgba(255,69,96,0.16)', text: '#ff6b84', border: 'rgba(255,69,96,0.25)' }
  if (change > -3)    return { bg: 'rgba(255,69,96,0.38)', text: '#ff4560', border: 'rgba(255,69,96,0.5)' }
  return { bg: 'rgba(255,69,96,0.60)', text: '#ff1f3d', border: 'rgba(255,69,96,0.7)' }
}

export default function SectorHeatmapPanel() {
  const [data, setData]             = useState<SectorData[]>(
    SECTORS.map(s => ({ symbol: s.symbol, change: null }))
  )
  const [lastUpdated, setUpdated]   = useState('')
  const [activeSector, setActive]   = useState<string | null>(null)
  const [movers, setMovers]         = useState<MoverData[]>([])
  const [loadingMovers, setLoadingMovers] = useState(false)
  const hoverTimerRef               = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popupRef                    = useRef<HTMLDivElement>(null)

  // ── Fetch sector ETF prices ─────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    const updates = await Promise.all(
      SECTORS.map(async ({ symbol }) => {
        try {
          const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
          const d   = await res.json()
          if (d.rateLimited || !d.c) {
            const prev = data.find(x => x.symbol === symbol)
            return { symbol, change: prev?.change ?? null }
          }
          return { symbol, change: d.dp as number }
        } catch {
          const prev = data.find(x => x.symbol === symbol)
          return { symbol, change: prev?.change ?? null }
        }
      })
    )
    setData(updates)
    setUpdated(
      new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
    )
  }, [data])

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, 30_000)
    return () => clearInterval(t)
  }, [])

  // ── Fetch movers for active sector ─────────────────────────────────────────
  const fetchMovers = useCallback(async (sectorSymbol: string) => {
    // Return cached immediately if available
    if (moversCache.has(sectorSymbol)) {
      setMovers(moversCache.get(sectorSymbol)!)
      return
    }

    const sector = SECTORS.find(s => s.symbol === sectorSymbol)
    if (!sector) return

    setLoadingMovers(true)
    const placeholders = sector.components.slice(0, 6).map(sym => ({
      symbol: sym, change: null, fetched: false,
    }))
    setMovers(placeholders)

    const results = await Promise.all(
      sector.components.slice(0, 6).map(async sym => {
        try {
          const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${sym}`)
          const d   = await res.json()
          return { symbol: sym, change: d.rateLimited || !d.dp ? null : (d.dp as number), fetched: true }
        } catch {
          return { symbol: sym, change: null, fetched: true }
        }
      })
    )

    // Sort: biggest movers first (by absolute change)
    const sorted = results.sort((a, b) =>
      Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0)
    )
    moversCache.set(sectorSymbol, sorted)
    setMovers(sorted)
    setLoadingMovers(false)
  }, [])

  // ── Desktop hover handlers ──────────────────────────────────────────────────
  const handleMouseEnter = useCallback((symbol: string) => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setActive(symbol)
      fetchMovers(symbol)
    }, 120) // small delay to avoid flicker
  }, [fetchMovers])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      setActive(null)
    }, 200) // delay so user can move into popup
  }, [])

  const handlePopupEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
  }, [])

  const handlePopupLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setActive(null), 150)
  }, [])

  // ── Mobile tap handler ──────────────────────────────────────────────────────
  const handleTap = useCallback((symbol: string) => {
    if (activeSector === symbol) {
      setActive(null)
    } else {
      setActive(symbol)
      fetchMovers(symbol)
    }
  }, [activeSector, fetchMovers])

  // ── Click outside to dismiss on mobile ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        // Only dismiss via outside click on mobile (touch device)
        if (window.matchMedia('(hover: none)').matches) {
          setActive(null)
        }
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler, { passive: true })
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  // ── Stats ──────────────────────────────────────────────────────────────────
  const loaded  = data.filter(d => d.change !== null)
  const gainers = loaded.filter(d => (d.change ?? 0) > 0).length
  const losers  = loaded.filter(d => (d.change ?? 0) < 0).length
  const avgChg  = loaded.length
    ? loaded.reduce((s, d) => s + (d.change ?? 0), 0) / loaded.length
    : 0

  const activeSectorDef = activeSector ? SECTORS.find(s => s.symbol === activeSector) : null

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" />
          US SECTOR HEATMAP
          <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            HOVER TO SEE MOVERS
          </span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'var(--positive)', fontFamily: 'JetBrains Mono, monospace' }}>▲ {gainers}</span>
          <span style={{ fontSize: '10px', color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace' }}>▼ {losers}</span>
          <span style={{
            fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
            color: avgChg >= 0 ? 'var(--positive)' : 'var(--negative)',
          }}>
            avg {avgChg >= 0 ? '+' : ''}{avgChg.toFixed(2)}%
          </span>
          {lastUpdated && (
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              {lastUpdated}
            </span>
          )}
        </div>
      </div>

      {/* Grid */}
      <div style={{
        flex: 1, padding: '8px',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: '5px',
        position: 'relative',
      }}>
        {SECTORS.map(sector => {
          const d       = data.find(x => x.symbol === sector.symbol)
          const change  = d?.change ?? null
          const col     = getColors(change)
          const isActive = activeSector === sector.symbol

          return (
            <div
              key={sector.symbol}
              onMouseEnter={() => handleMouseEnter(sector.symbol)}  // ← desktop hover
              onMouseLeave={handleMouseLeave}                        // ← desktop leave
              onClick={() => handleTap(sector.symbol)}               // ← mobile tap
              style={{
                background:   isActive ? col.bg : col.bg,
                border:       `1px solid ${isActive ? 'rgba(240,165,0,0.6)' : col.border}`,
                borderRadius: '5px',
                display:      'flex',
                flexDirection:'column',
                alignItems:   'center',
                justifyContent: 'center',
                padding:      '6px 4px',
                position:     'relative',
                overflow:     'hidden',
                cursor:       'pointer',
                transition:   'all 0.15s ease',
                outline:      isActive ? '1px solid rgba(240,165,0,0.4)' : 'none',
                outlineOffset: '1px',
              }}
            >
              {/* Background fill bar */}
              {change !== null && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  height: `${Math.min(Math.abs(change) * 14, 100)}%`,
                  background: change >= 0 ? 'rgba(0,201,122,0.07)' : 'rgba(255,69,96,0.07)',
                }} />
              )}
              <div style={{
                fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700,
                color: '#fff', letterSpacing: '0.04em', zIndex: 1,
              }}>
                {sector.short}
              </div>
              <div style={{
                fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                color: col.text, marginTop: '2px', zIndex: 1,
              }}>
                {change !== null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '---'}
              </div>
              <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '1px', zIndex: 1 }}>
                {sector.symbol}
              </div>
            </div>
          )
        })}

        {/* 12th tile — breadth summary */}
        <div style={{
          background: avgChg >= 0 ? 'rgba(0,201,122,0.1)' : 'rgba(255,69,96,0.1)',
          border: `1px solid ${avgChg >= 0 ? 'rgba(0,201,122,0.25)' : 'rgba(255,69,96,0.25)'}`,
          borderRadius: '5px', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: '6px 4px',
        }}>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>BREADTH</div>
          <div style={{
            fontSize: '15px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            color: gainers >= losers ? 'var(--positive)' : 'var(--negative)', marginTop: '2px',
          }}>
            {gainers}/{gainers + losers}
          </div>
          <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>up</div>
        </div>
      </div>

      {/* ── Movers Popup ─────────────────────────────────────────────────────── */}
      {activeSector && activeSectorDef && (
        <div
          ref={popupRef}
          onMouseEnter={handlePopupEnter}   // ← keep popup open while mouse inside
          onMouseLeave={handlePopupLeave}   // ← close when leaving popup
          style={{
            position:    'absolute',
            bottom:      '8px',
            left:        '8px',
            right:       '8px',
            zIndex:      50,
            background:  'var(--bg-panel)',
            border:      '1px solid rgba(240,165,0,0.35)',
            borderRadius:'8px',
            padding:     '10px 12px',
            boxShadow:   '0 8px 32px rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {/* Popup header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                fontFamily: 'Syne, sans-serif', fontWeight: 800,
                fontSize: '12px', color: '#fff', letterSpacing: '0.08em',
              }}>
                {activeSectorDef.name.toUpperCase()}
              </div>
              <div style={{
                fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
                fontFamily: 'JetBrains Mono, monospace',
                background: getColors(data.find(d => d.symbol === activeSector)?.change ?? null).bg,
                color:      getColors(data.find(d => d.symbol === activeSector)?.change ?? null).text,
                border:     `1px solid ${getColors(data.find(d => d.symbol === activeSector)?.change ?? null).border}`,
              }}>
                {(() => {
                  const c = data.find(d => d.symbol === activeSector)?.change ?? null
                  return c !== null ? `${c >= 0 ? '+' : ''}${c.toFixed(2)}%` : '---'
                })()}
              </div>
            </div>
            <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              TOP MOVERS
            </div>
          </div>

          {/* Movers grid */}
          {loadingMovers ? (
            <div style={{
              display: 'flex', gap: '5px', flexWrap: 'wrap',
            }}>
              {activeSectorDef.components.slice(0, 6).map(sym => (
                <div key={sym} style={{
                  flex: '1 1 30%', minWidth: '80px',
                  padding: '6px 8px', borderRadius: '4px',
                  background: 'var(--bg-deep)', border: '1px solid var(--border)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff' }}>{sym}</span>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>···</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {movers.map(m => {
                const isPos = (m.change ?? 0) >= 0
                const col   = getColors(m.change)
                return (
                  <div key={m.symbol} style={{
                    flex: '1 1 30%', minWidth: '80px',
                    padding: '6px 8px', borderRadius: '4px',
                    background: col.bg,
                    border: `1px solid ${col.border}`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    transition: 'all 0.15s',
                  }}>
                    <span style={{ fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff' }}>
                      {m.symbol}
                    </span>
                    <span style={{
                      fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                      color: m.change !== null ? col.text : 'var(--text-muted)',
                    }}>
                      {m.change !== null
                        ? `${isPos ? '+' : ''}${m.change.toFixed(2)}%`
                        : '···'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Dismiss hint — mobile only */}
          <div style={{
            marginTop: '6px', fontSize: '8px', color: 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace', textAlign: 'center',
          }}>
            {/* Show tap-to-dismiss only on touch devices */}
            <span className="nexus-mobile-only">tap sector again to dismiss</span>
            <span className="nexus-desktop-only">move away to dismiss</span>
          </div>
        </div>
      )}

      <style>{`
        @media (hover: hover) {
          .nexus-mobile-only { display: none !important; }
          .nexus-desktop-only { display: inline !important; }
        }
        @media (hover: none) {
          .nexus-mobile-only { display: inline !important; }
          .nexus-desktop-only { display: none !important; }
        }
      `}</style>
    </div>
  )
}