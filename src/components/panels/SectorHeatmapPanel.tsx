'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

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

// Top holdings per sector ETF
const SECTOR_HOLDINGS: Record<string, { sym: string; name: string }[]> = {
  XLK:  [{ sym:'AAPL',name:'Apple' },{ sym:'MSFT',name:'Microsoft' },{ sym:'NVDA',name:'NVIDIA' },{ sym:'AVGO',name:'Broadcom' },{ sym:'AMD',name:'AMD' },{ sym:'ORCL',name:'Oracle' },{ sym:'CSCO',name:'Cisco' },{ sym:'ACN',name:'Accenture' },{ sym:'CRM',name:'Salesforce' },{ sym:'INTC',name:'Intel' }],
  XLC:  [{ sym:'META',name:'Meta' },{ sym:'GOOGL',name:'Alphabet A' },{ sym:'GOOG',name:'Alphabet C' },{ sym:'NFLX',name:'Netflix' },{ sym:'DIS',name:'Disney' },{ sym:'CMCSA',name:'Comcast' },{ sym:'T',name:'AT&T' },{ sym:'VZ',name:'Verizon' },{ sym:'EA',name:'EA' },{ sym:'TTWO',name:'Take-Two' }],
  XLY:  [{ sym:'AMZN',name:'Amazon' },{ sym:'TSLA',name:'Tesla' },{ sym:'HD',name:'Home Depot' },{ sym:'MCD',name:'McDonald\'s' },{ sym:'NKE',name:'Nike' },{ sym:'LOW',name:'Lowe\'s' },{ sym:'TJX',name:'TJX' },{ sym:'SBUX',name:'Starbucks' },{ sym:'GM',name:'GM' },{ sym:'F',name:'Ford' }],
  XLF:  [{ sym:'BRK-B',name:'Berkshire' },{ sym:'JPM',name:'JPMorgan' },{ sym:'V',name:'Visa' },{ sym:'MA',name:'Mastercard' },{ sym:'BAC',name:'BofA' },{ sym:'WFC',name:'Wells Fargo' },{ sym:'GS',name:'Goldman' },{ sym:'MS',name:'Morgan Stanley' },{ sym:'SPGI',name:'S&P Global' },{ sym:'BLK',name:'BlackRock' }],
  XLV:  [{ sym:'LLY',name:'Eli Lilly' },{ sym:'UNH',name:'UnitedHealth' },{ sym:'JNJ',name:'J&J' },{ sym:'ABBV',name:'AbbVie' },{ sym:'MRK',name:'Merck' },{ sym:'TMO',name:'Thermo Fisher' },{ sym:'ABT',name:'Abbott' },{ sym:'DHR',name:'Danaher' },{ sym:'BMY',name:'BMS' },{ sym:'AMGN',name:'Amgen' }],
  XLI:  [{ sym:'GE',name:'GE' },{ sym:'CAT',name:'Caterpillar' },{ sym:'RTX',name:'RTX' },{ sym:'HON',name:'Honeywell' },{ sym:'UNP',name:'Union Pacific' },{ sym:'UPS',name:'UPS' },{ sym:'BA',name:'Boeing' },{ sym:'DE',name:'Deere' },{ sym:'LMT',name:'Lockheed' },{ sym:'MMM',name:'3M' }],
  XLE:  [{ sym:'XOM',name:'ExxonMobil' },{ sym:'CVX',name:'Chevron' },{ sym:'COP',name:'ConocoPhillips' },{ sym:'EOG',name:'EOG' },{ sym:'SLB',name:'Schlumberger' },{ sym:'MPC',name:'Marathon Pete.' },{ sym:'PSX',name:'Phillips 66' },{ sym:'HES',name:'Hess' },{ sym:'VLO',name:'Valero' },{ sym:'DVN',name:'Devon' }],
  XLP:  [{ sym:'PG',name:'Procter & Gamble' },{ sym:'KO',name:'Coca-Cola' },{ sym:'PEP',name:'PepsiCo' },{ sym:'COST',name:'Costco' },{ sym:'WMT',name:'Walmart' },{ sym:'PM',name:'Philip Morris' },{ sym:'MO',name:'Altria' },{ sym:'MDLZ',name:'Mondelez' },{ sym:'CL',name:'Colgate' },{ sym:'KMB',name:'Kimberly-Clark' }],
  XLB:  [{ sym:'LIN',name:'Linde' },{ sym:'APD',name:'Air Products' },{ sym:'SHW',name:'Sherwin-Williams' },{ sym:'FCX',name:'Freeport' },{ sym:'NEM',name:'Newmont' },{ sym:'NUE',name:'Nucor' },{ sym:'DOW',name:'Dow' },{ sym:'VMC',name:'Vulcan' },{ sym:'MLM',name:'Martin Marietta' },{ sym:'CF',name:'CF Industries' }],
  XLRE: [{ sym:'PLD',name:'Prologis' },{ sym:'AMT',name:'American Tower' },{ sym:'EQIX',name:'Equinix' },{ sym:'CCI',name:'Crown Castle' },{ sym:'SPG',name:'Simon Property' },{ sym:'O',name:'Realty Income' },{ sym:'DLR',name:'Digital Realty' },{ sym:'PSA',name:'Public Storage' },{ sym:'WELL',name:'Welltower' },{ sym:'AVB',name:'AvalonBay' }],
  XLU:  [{ sym:'NEE',name:'NextEra' },{ sym:'DUK',name:'Duke Energy' },{ sym:'SO',name:'Southern Co.' },{ sym:'D',name:'Dominion' },{ sym:'AEP',name:'AEP' },{ sym:'EXC',name:'Exelon' },{ sym:'SRE',name:'Sempra' },{ sym:'PCG',name:'PG&E' },{ sym:'XEL',name:'Xcel' },{ sym:'ED',name:'Con Edison' }],
}

interface SectorData { symbol: string; change: number | null }
interface StockMover { sym: string; name: string; change: number | null }

function getColors(change: number | null) {
  if (change === null) return { bg: 'rgba(74,96,112,0.15)', text: 'var(--text-muted)', border: 'rgba(74,96,112,0.2)' }
  if (change >  3)  return { bg: 'rgba(0,201,122,0.55)', text: '#00ffaa', border: 'rgba(0,201,122,0.6)' }
  if (change >  1.5) return { bg: 'rgba(0,201,122,0.32)', text: '#00c97a', border: 'rgba(0,201,122,0.4)' }
  if (change >  0.3) return { bg: 'rgba(0,201,122,0.14)', text: '#00a866', border: 'rgba(0,201,122,0.2)' }
  if (change > -0.3) return { bg: 'rgba(74,96,112,0.2)',  text: 'var(--text-2)', border: 'rgba(74,96,112,0.3)' }
  if (change > -1.5) return { bg: 'rgba(255,69,96,0.14)', text: '#ff6b84', border: 'rgba(255,69,96,0.2)' }
  if (change > -3)  return { bg: 'rgba(255,69,96,0.32)', text: '#ff4560', border: 'rgba(255,69,96,0.4)' }
  return                    { bg: 'rgba(255,69,96,0.55)', text: '#ff1f3d', border: 'rgba(255,69,96,0.6)' }
}

function MoverRow({ sym, name, change }: StockMover) {
  const isPos = (change ?? 0) >= 0
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, color: '#fff', fontFamily: 'Syne, sans-serif' }}>{sym}</div>
        <div style={{ fontSize: '7px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{name.slice(0,10)}</div>
      </div>
      <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: isPos ? '#00c97a' : '#ff4560' }}>
        {change != null ? `${isPos?'+':''}${change.toFixed(2)}%` : '···'}
      </span>
    </div>
  )
}

interface HoverOverlayProps {
  sector: (typeof SECTORS)[0]
  sectorChange: number | null
  movers: StockMover[]
  loadingMovers: boolean
  pos: { x: number; y: number }
}

function HoverOverlay({ sector, sectorChange, movers, loadingMovers, pos }: HoverOverlayProps) {
  const isPos = (sectorChange ?? 0) >= 0
  const winners = [...movers].filter(m => (m.change ?? 0) > 0).sort((a,b) => (b.change??0)-(a.change??0)).slice(0,5)
  const losers  = [...movers].filter(m => (m.change ?? 0) <= 0).sort((a,b) => (a.change??0)-(b.change??0)).slice(0,5)

  return (
    <div style={{
      position: 'fixed',
      left: Math.min(pos.x + 12, window.innerWidth - 300),
      top:  Math.min(pos.y - 10, window.innerHeight - 340),
      zIndex: 9999, width: '280px',
      background: '#0d1117', border: '1px solid var(--border)',
      borderRadius: '8px', boxShadow: '0 16px 48px rgba(0,0,0,0.9)',
      padding: '12px', pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '13px', color: '#fff' }}>{sector.name}</div>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{sector.symbol}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '20px', fontWeight: 900, fontFamily: 'Syne, sans-serif', color: isPos ? '#00c97a' : '#ff4560' }}>
            {sectorChange != null ? `${isPos?'+':''}${sectorChange.toFixed(2)}%` : '···'}
          </div>
        </div>
      </div>

      {loadingMovers ? (
        <div style={{ textAlign: 'center', padding: '16px', color: 'var(--text-muted)', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}>
          Loading constituents...
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '8px', color: '#00c97a', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '5px', borderBottom: '1px solid rgba(0,201,122,0.2)', paddingBottom: '3px' }}>
              ▲ TOP WINNERS
            </div>
            {winners.length > 0 ? winners.map(m => <MoverRow key={m.sym} {...m} />) : (
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>No data</div>
            )}
          </div>
          <div>
            <div style={{ fontSize: '8px', color: '#ff4560', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '5px', borderBottom: '1px solid rgba(255,69,96,0.2)', paddingBottom: '3px' }}>
              ▼ TOP LOSERS
            </div>
            {losers.length > 0 ? losers.map(m => <MoverRow key={m.sym} {...m} />) : (
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>No data</div>
            )}
          </div>
        </div>
      )}
      <div style={{ marginTop: '8px', fontSize: '7px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>
        Top 10 holdings · Day change %
      </div>
    </div>
  )
}

export default function SectorHeatmapPanel() {
  const [data, setData]           = useState<SectorData[]>(SECTORS.map(s => ({ symbol: s.symbol, change: null })))
  const [lastUpdated, setUpdated] = useState('')
  const [hovered, setHovered]     = useState<string|null>(null)
  const [hoverPos, setHoverPos]   = useState({ x: 0, y: 0 })
  const [movers, setMovers]       = useState<StockMover[]>([])
  const [loadingMovers, setLoadingMovers] = useState(false)
  const moverCache = useRef<Map<string, StockMover[]>>(new Map())
  const hoverTimer = useRef<ReturnType<typeof setTimeout>|null>(null)

  const fetchData = async () => {
    const updates = await Promise.all(
      SECTORS.map(async ({ symbol }) => {
        try {
          const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
          const d = await res.json()
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

  const fetchMovers = useCallback(async (etfSym: string) => {
    if (moverCache.current.has(etfSym)) { setMovers(moverCache.current.get(etfSym)!); return }
    const holdings = SECTOR_HOLDINGS[etfSym] ?? []
    if (!holdings.length) return
    setLoadingMovers(true)
    const results = await Promise.all(
      holdings.map(async ({ sym, name }) => {
        try {
          const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${sym}`)
          const d = await res.json()
          return { sym, name, change: d.dp ?? null }
        } catch { return { sym, name, change: null } }
      })
    )
    moverCache.current.set(etfSym, results)
    setMovers(results)
    setLoadingMovers(false)
  }, [])

  const handleMouseEnter = (sym: string, e: React.MouseEvent) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHovered(sym)
    setHoverPos({ x: e.clientX, y: e.clientY })
    // setMovers([])
    // hoverTimer.current = setTimeout(() => fetchMovers(sym), 200)
    // Check cache first for instant UI response
    if (moverCache.current.has(sym)) {
      setMovers(moverCache.current.get(sym)!)
      setLoadingMovers(false)
    } else {
      setMovers([])
      setLoadingMovers(true)
      hoverTimer.current = setTimeout(() => fetchMovers(sym), 250)
    }
  }

  const handleMouseLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHovered(null)

  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (hovered) setHoverPos({ x: e.clientX, y: e.clientY })
  }

  const loaded  = data.filter(d => d.change !== null)
  const gainers = loaded.filter(d => (d.change ?? 0) > 0).length
  const losers  = loaded.filter(d => (d.change ?? 0) < 0).length
  const avgChg  = loaded.length ? loaded.reduce((s, d) => s + (d.change ?? 0), 0) / loaded.length : 0

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }} onMouseMove={handleMouseMove}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" />
          US SECTOR HEATMAP
          <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>hover to see movers</span>
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

      <div style={{ flex: 1, padding: '8px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: '5px' }}>
        {SECTORS.map(sector => {
          const d      = data.find(x => x.symbol === sector.symbol)
          const change = d?.change ?? null
          const col    = getColors(change)
          const isHov  = hovered === sector.symbol
          return (
            <div
              key={sector.symbol}
              onMouseEnter={(e) => handleMouseEnter(sector.symbol, e)}
              onMouseLeave={handleMouseLeave}
              style={{
                background: isHov ? col.bg.replace(/0\.\d+\)/, '0.7)') : col.bg,
                border:     `1px solid ${isHov ? col.text : col.border}`,
                borderRadius: '5px', display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '6px 4px', position: 'relative', overflow: 'hidden',
                transition: 'all 0.2s ease', cursor: 'pointer',
                transform: isHov ? 'scale(1.02)' : 'scale(1)',
                boxShadow: isHov ? `0 0 12px ${col.text}44` : 'none',
              }}
            >
              {change !== null && (
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${Math.min(Math.abs(change) * 14, 100)}%`, background: change >= 0 ? 'rgba(0,201,122,0.07)' : 'rgba(255,69,96,0.07)' }} />
              )}
              <div style={{ fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff', letterSpacing: '0.04em', zIndex: 1 }}>{sector.short}</div>
              <div style={{ fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: col.text, marginTop: '2px', zIndex: 1 }}>
                {change !== null ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '---'}
              </div>
              <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '1px', zIndex: 1 }}>{sector.symbol}</div>
              {isHov && (
                <div style={{ position: 'absolute', top: '3px', right: '3px', fontSize: '7px', color: col.text, fontFamily: 'JetBrains Mono, monospace' }}>ℹ</div>
              )}
            </div>
          )
        })}

        {/* Breadth tile */}
        <div style={{
          background: avgChg >= 0 ? 'rgba(0,201,122,0.1)' : 'rgba(255,69,96,0.1)',
          border: `1px solid ${avgChg >= 0 ? 'rgba(0,201,122,0.25)' : 'rgba(255,69,96,0.25)'}`,
          borderRadius: '5px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '6px 4px',
        }}>
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>BREADTH</div>
          <div style={{ fontSize: '15px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: avgChg >= 0 ? 'var(--positive)' : 'var(--negative)', marginTop: '2px' }}>
            {gainers}/{gainers + losers}
          </div>
          <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>up</div>
        </div>
      </div>

      {/* Hover overlay */}
      {hovered && (() => {
        const sec = SECTORS.find(s => s.symbol === hovered)!
        const sectorChange = data.find(d => d.symbol === hovered)?.change ?? null
        return <HoverOverlay sector={sec} sectorChange={sectorChange} movers={movers} loadingMovers={loadingMovers} pos={hoverPos} />
      })()}
    </div>
  )
}