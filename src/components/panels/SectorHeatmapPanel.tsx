'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import useSWR from 'swr'
import { DataQualityBadge } from '@/components/dashboard/DataQualityBadge'
import { DataAgeBadge } from '@/components/dashboard/DataAgeBadge'

// ── Sector universe loaded from /public/data/sector-etfs.json ────────────────
// This used to be a hardcoded constant inside this file.  Migrating it out
// makes the dataset citable + refreshable independently of code releases.

interface SectorDef {
  symbol:     string
  name:       string
  short:      string
  components: string[]
}
interface SectorETFFile {
  version:      string
  generatedAt:  string
  source:       string
  sectors:      SectorDef[]
  companyNames: Record<string, string>
}
const sectorEtfFetcher = (url: string) => fetch(url).then(r => r.json() as Promise<SectorETFFile>)

interface SectorData { symbol: string; change: number | null }
interface MoverData { symbol: string; name: string; change: number | null; fetched: boolean }

// Stale cache — never blanks after first load
const moversCache = new Map<string, MoverData[]>()
// Global stale per-symbol prices to prevent showing ···
const symbolPriceCache = new Map<string, { change: number | null; ts: number }>()

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
  // Load the versioned sector dataset (sectors + components + company names).
  const { data: etfFile } = useSWR<SectorETFFile>('/data/sector-etfs.json', sectorEtfFetcher, {
    revalidateOnFocus: false, dedupingInterval: 60_000_000,
  })
  const SECTORS = useMemo<SectorDef[]>(() => etfFile?.sectors ?? [], [etfFile])
  const COMPANY_NAMES = useMemo<Record<string, string>>(() => etfFile?.companyNames ?? {}, [etfFile])

  const [data, setData]             = useState<SectorData[]>([])
  const [lastUpdatedTs, setUpdatedTs] = useState<number | null>(null)
  const [activeSector, setActive]   = useState<string | null>(null)
  const [movers, setMovers]         = useState<MoverData[]>([])
  const [loadingMovers, setLoadingMovers] = useState(false)
  const hoverTimerRef               = useRef<ReturnType<typeof setTimeout> | null>(null)
  const popupRef                    = useRef<HTMLDivElement>(null)

  // Initialize empty rows once the JSON file resolves
  useEffect(() => {
    if (SECTORS.length === 0) return
    setData(prev => prev.length ? prev : SECTORS.map(s => ({ symbol: s.symbol, change: null })))
  }, [SECTORS])

  // ── Fetch sector ETF prices ─────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    if (SECTORS.length === 0) return
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
    setUpdatedTs(Date.now())
  }, [data, SECTORS])

  useEffect(() => {
    if (SECTORS.length === 0) return
    fetchData()
    const t = setInterval(fetchData, 60_000)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [SECTORS])

  // ── Fetch movers for active sector ─────────────────────────────────────────
  // KEY FIX: use stale data immediately, fetch fresh in background
  const fetchMovers = useCallback(async (sectorSymbol: string) => {
    const sector = SECTORS.find(s => s.symbol === sectorSymbol)
    if (!sector) return

    const TOP6 = sector.components.slice(0, 6)

    // Show stale cache immediately if available
    if (moversCache.has(sectorSymbol)) {
      setMovers(moversCache.get(sectorSymbol)!)
      setLoadingMovers(false)
    } else {
      // Show placeholders with whatever we have in symbolPriceCache
      const placeholders: MoverData[] = TOP6.map(sym => ({
        symbol: sym,
        name: COMPANY_NAMES[sym] ?? sym,
        change: symbolPriceCache.get(sym)?.change ?? null,
        fetched: symbolPriceCache.has(sym),
      }))
      setMovers(placeholders)
      setLoadingMovers(true)
    }

    // Always fetch fresh data in background
    const results = await Promise.all(
      TOP6.map(async sym => {
        // Check in-memory cache first (5 min TTL)
        const cached = symbolPriceCache.get(sym)
        if (cached && Date.now() - cached.ts < 5 * 60_000) {
          return { symbol: sym, name: COMPANY_NAMES[sym] ?? sym, change: cached.change, fetched: true }
        }

        try {
          // Try Finnhub first (US stocks — faster)
          const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${sym}`)
          const d   = await res.json()
          if (!d.rateLimited && d.dp != null) {
            symbolPriceCache.set(sym, { change: d.dp, ts: Date.now() })
            return { symbol: sym, name: COMPANY_NAMES[sym] ?? sym, change: d.dp as number, fetched: true }
          }
        } catch {}

        try {
          // Fallback: yquote
          const res  = await fetch(`/api/yquote?symbol=${encodeURIComponent(sym)}`)
          const data = await res.json()
          if (data.change != null) {
            symbolPriceCache.set(sym, { change: data.change, ts: Date.now() })
            return { symbol: sym, name: COMPANY_NAMES[sym] ?? sym, change: data.change as number, fetched: true }
          }
        } catch {}

        // Use stale if available
        const stale = symbolPriceCache.get(sym)
        return { symbol: sym, name: COMPANY_NAMES[sym] ?? sym, change: stale?.change ?? null, fetched: true }
      })
    )

    // Sort: biggest absolute movers first
    const sorted = results.sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))
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
    }, 120)
  }, [fetchMovers])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setActive(null), 200)
  }, [])

  const handlePopupEnter = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
  }, [])

  const handlePopupLeave = useCallback(() => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => setActive(null), 150)
  }, [])

  // ── Mobile tap ──────────────────────────────────────────────────────────────
  const handleTap = useCallback((symbol: string) => {
    if (activeSector === symbol) { setActive(null) }
    else { setActive(symbol); fetchMovers(symbol) }
  }, [activeSector, fetchMovers])

  // Click outside to dismiss on mobile
  useEffect(() => {
    const handler = (e: MouseEvent | TouchEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        if (window.matchMedia('(hover: none)').matches) setActive(null)
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
    return () => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current) }
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
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
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
          <DataQualityBadge kind="live" small tooltip="Sector ETF quotes from Finnhub, polled every 60s" />
          <DataAgeBadge timestamp={lastUpdatedTs} freshSecs={90} staleSecs={300} small />
          {etfFile?.generatedAt && (
            <DataQualityBadge
              kind="versioned"
              small
              tooltip={`Sector membership snapshot from ${new Date(etfFile.generatedAt).toLocaleDateString()} — top 8 ETF holdings per sector. Source: ${etfFile.source}`}
            />
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
              onMouseEnter={() => handleMouseEnter(sector.symbol)}
              onMouseLeave={handleMouseLeave}
              onClick={() => handleTap(sector.symbol)}
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
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '1px', zIndex: 1 }}>
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
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>BREADTH</div>
          <div style={{
            fontSize: '15px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            color: gainers >= losers ? 'var(--positive)' : 'var(--negative)', marginTop: '2px',
          }}>
            {gainers}/{gainers + losers}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>up</div>
        </div>
      </div>

      {/* ── Movers Popup ─────────────────────────────────────────────────────── */}
      {activeSector && activeSectorDef && (
        <div
          ref={popupRef}
          onMouseEnter={handlePopupEnter}
          onMouseLeave={handlePopupLeave}
          style={{
            position:   'absolute',
            bottom:     '8px',
            left:       '8px',
            right:      '8px',
            zIndex:     50,
            background: 'var(--bg-panel)',
            border:     '1px solid rgba(240,165,0,0.35)',
            borderRadius:'8px',
            padding:    '10px 12px',
            boxShadow:  '0 8px 32px rgba(0,0,0,0.8)',
            backdropFilter: 'blur(4px)',
          }}
        >
          {/* Popup header */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '13px', color: '#fff', letterSpacing: '0.08em' }}>
                {activeSectorDef.name.toUpperCase()}
              </div>
              {(() => {
                const c = data.find(d => d.symbol === activeSector)?.change ?? null
                const col = getColors(c)
                return (
                  <div style={{
                    fontSize: '11px', padding: '2px 8px', borderRadius: '2px',
                    fontFamily: 'JetBrains Mono, monospace',
                    background: col.bg, color: col.text, border: `1px solid ${col.border}`,
                  }}>
                    {c !== null ? `${c >= 0 ? '+' : ''}${c.toFixed(2)}%` : '---'}
                  </div>
                )
              })()}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              {loadingMovers ? 'LOADING…' : 'TOP MOVERS'}
            </div>
          </div>

          {/* Movers grid — always shows something (stale or live) */}
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            {movers.map(m => {
              const isPos = (m.change ?? 0) >= 0
              const col   = getColors(m.change)
              const isPending = m.change === null && loadingMovers
              return (
                <div key={m.symbol} style={{
                  flex: '1 1 30%', minWidth: '80px',
                  padding: '6px 8px', borderRadius: '4px',
                  background:  isPending ? 'var(--bg-deep)' : col.bg,
                  border:      `1px solid ${isPending ? 'var(--border)' : col.border}`,
                  display:     'flex', flexDirection: 'column',
                  transition:  'all 0.15s',
                }}>
                  {/* Symbol row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <span style={{ fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff' }}>
                      {m.symbol}
                    </span>
                    <span style={{
                      fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                      color: m.change !== null ? col.text : 'var(--text-muted)',
                    }}>
                      {m.change !== null
                        ? `${isPos ? '+' : ''}${m.change.toFixed(2)}%`
                        : isPending ? '···' : '—'}
                    </span>
                  </div>
                  {/* Company name */}
                  <div style={{
                    fontSize: '10px', color: 'var(--text-muted)',
                    fontFamily: 'JetBrains Mono, monospace', marginTop: '2px',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {m.name}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Dismiss hint */}
          <div style={{
            marginTop: '6px', fontSize: '10px', color: 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace', textAlign: 'center',
          }}>
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