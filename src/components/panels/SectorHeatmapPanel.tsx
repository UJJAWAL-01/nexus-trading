'use client'

import { useEffect, useState } from 'react'

const SECTORS = [
  { symbol: 'XLK',  name: 'Technology',     short: 'TECH'  },
  { symbol: 'XLC',  name: 'Comm. Services', short: 'COMM'  },
  { symbol: 'XLY',  name: 'Cons. Discret.', short: 'DISC'  },
  { symbol: 'XLF',  name: 'Financials',     short: 'FIN'   },
  { symbol: 'XLV',  name: 'Health Care',    short: 'HLTH'  },
  { symbol: 'XLI',  name: 'Industrials',    short: 'IND'   },
  { symbol: 'XLE',  name: 'Energy',         short: 'ENGY'  },
  { symbol: 'XLP',  name: 'Cons. Staples',  short: 'STPL'  },
  { symbol: 'XLB',  name: 'Materials',      short: 'MATL'  },
  { symbol: 'XLRE', name: 'Real Estate',    short: 'REIT'  },
  { symbol: 'XLU',  name: 'Utilities',      short: 'UTIL'  },
]

interface SectorData { symbol: string; change: number | null }

function getColors(change: number | null) {
  if (change === null) return { bg: 'rgba(74,96,112,0.15)', text: 'var(--text-muted)', border: 'rgba(74,96,112,0.2)' }
  if (change >  3)    return { bg: 'rgba(0,201,122,0.55)', text: '#00ffaa', border: 'rgba(0,201,122,0.6)' }
  if (change >  1.5)  return { bg: 'rgba(0,201,122,0.32)', text: '#00c97a', border: 'rgba(0,201,122,0.4)' }
  if (change >  0.3)  return { bg: 'rgba(0,201,122,0.14)', text: '#00a866', border: 'rgba(0,201,122,0.2)' }
  if (change > -0.3)  return { bg: 'rgba(74,96,112,0.2)',  text: 'var(--text-2)', border: 'rgba(74,96,112,0.3)' }
  if (change > -1.5)  return { bg: 'rgba(255,69,96,0.14)', text: '#ff6b84', border: 'rgba(255,69,96,0.2)' }
  if (change > -3)    return { bg: 'rgba(255,69,96,0.32)', text: '#ff4560', border: 'rgba(255,69,96,0.4)' }
  return { bg: 'rgba(255,69,96,0.55)', text: '#ff1f3d', border: 'rgba(255,69,96,0.6)' }
}

export default function SectorHeatmapPanel() {
  const [data, setData]           = useState<SectorData[]>(SECTORS.map(s => ({ symbol: s.symbol, change: null })))
  const [lastUpdated, setUpdated] = useState('')
  const prevRef                   = useState<SectorData[]>([])[0]

  const fetchData = async () => {
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
    setUpdated(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }))
  }

  useEffect(() => {
    fetchData()
    const t = setInterval(fetchData, 30_000)
    return () => clearInterval(t)
  }, [])

  const loaded  = data.filter(d => d.change !== null)
  const gainers = loaded.filter(d => (d.change ?? 0) > 0).length
  const losers  = loaded.filter(d => (d.change ?? 0) < 0).length
  const avgChg  = loaded.length ? loaded.reduce((s, d) => s + (d.change ?? 0), 0) / loaded.length : 0

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" />
          SECTOR HEATMAP
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'var(--positive)', fontFamily: 'JetBrains Mono, monospace' }}>▲ {gainers}</span>
          <span style={{ fontSize: '10px', color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace' }}>▼ {losers}</span>
          <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: avgChg >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
            avg {avgChg >= 0 ? '+' : ''}{avgChg.toFixed(2)}%
          </span>
          {lastUpdated && <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{lastUpdated}</span>}
        </div>
      </div>

      <div style={{
        flex: 1, padding: '8px',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gridTemplateRows: 'repeat(3, 1fr)',
        gap: '5px',
      }}>
        {SECTORS.map(sector => {
          const d      = data.find(x => x.symbol === sector.symbol)
          const change = d?.change ?? null
          const col    = getColors(change)
          return (
            <div key={sector.symbol} style={{
              background: col.bg, border: `1px solid ${col.border}`,
              borderRadius: '5px', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              padding: '6px 4px', position: 'relative', overflow: 'hidden',
              transition: 'all 0.4s ease',
            }}>
              {change !== null && (
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  height: `${Math.min(Math.abs(change) * 14, 100)}%`,
                  background: change >= 0 ? 'rgba(0,201,122,0.07)' : 'rgba(255,69,96,0.07)',
                }} />
              )}
              <div style={{ fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff', letterSpacing: '0.04em', zIndex: 1 }}>
                {sector.short}
              </div>
              <div style={{ fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: col.text, marginTop: '2px', zIndex: 1 }}>
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
          <div style={{ fontSize: '15px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: avgChg >= 0 ? 'var(--positive)' : 'var(--negative)', marginTop: '2px' }}>
            {gainers}/{gainers + losers}
          </div>
          <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>up</div>
        </div>
      </div>
    </div>
  )
}