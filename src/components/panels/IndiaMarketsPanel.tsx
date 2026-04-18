'use client'

import { useEffect, useState, useRef, useCallback } from 'react'

interface MainIndex { symbol: string; label: string; badge: string; digits: number }
interface SectorDef { symbol: string; label: string; short: string }

const MAIN_INDICES: MainIndex[] = [
  { symbol: '^NSEI',     label: 'NIFTY 50',    badge: 'N50', digits: 2 },
  { symbol: '^BSESN',    label: 'SENSEX',      badge: 'BSE', digits: 2 },
  { symbol: '^NSEBANK',  label: 'BANK NIFTY',  badge: 'BNK', digits: 2 },
  { symbol: '^INDIAVIX', label: 'India VIX',   badge: 'VIX', digits: 2 },
  { symbol: 'USDINR=X',  label: 'USD / INR',   badge: '₹',   digits: 4 },
]

const SECTORS: SectorDef[] = [
  { symbol: '^CNXIT',      label: 'IT',       short: 'IT'   },
  { symbol: '^CNXAUTO',    label: 'Auto',     short: 'AUTO' },
  { symbol: '^CNXFMCG',    label: 'FMCG',     short: 'FMCG' },
  { symbol: '^CNXPHARMA',  label: 'Pharma',   short: 'PHRM' },
  { symbol: '^CNXMETAL',   label: 'Metal',    short: 'METL' },
  { symbol: '^CNXENERGY',  label: 'Energy',   short: 'ENGY' },
  { symbol: '^CNXREALTY',  label: 'Realty',   short: 'RLTY' },
  { symbol: '^CNXFIN', label: 'Finance',  short: 'FIN'  },
]

const NSE_SECTOR_STOCKS: Record<string, { sym: string; name: string }[]> = {
  '^CNXIT':      [{ sym:'TCS.NS',name:'TCS' },{ sym:'INFY.NS',name:'Infosys' },{ sym:'WIPRO.NS',name:'Wipro' },{ sym:'HCLTECH.NS',name:'HCL Tech' },{ sym:'TECHM.NS',name:'Tech Mahindra' },{ sym:'LTIM.NS',name:'LTIMindtree' },{ sym:'PERSISTENT.NS',name:'Persistent' },{ sym:'MPHASIS.NS',name:'Mphasis' }],
  '^CNXAUTO':    [{ sym:'MARUTI.NS',name:'Maruti' },{ sym:'TATAMOTORS.NS',name:'Tata Motors' },{ sym:'M&M.NS',name:'M&M' },{ sym:'BAJAJ-AUTO.NS',name:'Bajaj Auto' },{ sym:'HEROMOTOCO.NS',name:'Hero Moto' },{ sym:'EICHERMOT.NS',name:'Eicher' },{ sym:'BOSCHLTD.NS',name:'Bosch' },{ sym:'MOTHERSON.NS',name:'Motherson' }],
  '^CNXFMCG':    [{ sym:'HINDUNILVR.NS',name:'HUL' },{ sym:'ITC.NS',name:'ITC' },{ sym:'NESTLEIND.NS',name:'Nestle' },{ sym:'BRITANNIA.NS',name:'Britannia' },{ sym:'DABUR.NS',name:'Dabur' },{ sym:'MARICO.NS',name:'Marico' },{ sym:'COLPAL.NS',name:'Colgate' },{ sym:'GODREJCP.NS',name:'Godrej CP' }],
  '^CNXPHARMA':  [{ sym:'SUNPHARMA.NS',name:'Sun Pharma' },{ sym:'DRREDDY.NS',name:'Dr Reddy' },{ sym:'CIPLA.NS',name:'Cipla' },{ sym:'DIVISLAB.NS',name:'Divis' },{ sym:'AUROPHARMA.NS',name:'Aurobindo' },{ sym:'LUPIN.NS',name:'Lupin' },{ sym:'BIOCON.NS',name:'Biocon' },{ sym:'TORNTPHARM.NS',name:'Torrent' }],
  '^CNXMETAL':   [{ sym:'TATASTEEL.NS',name:'Tata Steel' },{ sym:'HINDALCO.NS',name:'Hindalco' },{ sym:'JSWSTEEL.NS',name:'JSW Steel' },{ sym:'VEDL.NS',name:'Vedanta' },{ sym:'COALINDIA.NS',name:'Coal India' },{ sym:'NMDC.NS',name:'NMDC' },{ sym:'SAIL.NS',name:'SAIL' },{ sym:'APLAPOLLO.NS',name:'APL Apollo' }],
  '^CNXENERGY':  [{ sym:'RELIANCE.NS',name:'Reliance' },{ sym:'ONGC.NS',name:'ONGC' },{ sym:'NTPC.NS',name:'NTPC' },{ sym:'POWERGRID.NS',name:'Power Grid' },{ sym:'BPCL.NS',name:'BPCL' },{ sym:'IOC.NS',name:'IOC' },{ sym:'GAIL.NS',name:'GAIL' },{ sym:'ADANIGREEN.NS',name:'Adani Green' }],
  '^CNXREALTY':  [{ sym:'DLF.NS',name:'DLF' },{ sym:'GODREJPROP.NS',name:'Godrej Prop' },{ sym:'OBEROIRLTY.NS',name:'Oberoi' },{ sym:'PRESTIGE.NS',name:'Prestige' },{ sym:'PHOENIXLTD.NS',name:'Phoenix' },{ sym:'BRIGADE.NS',name:'Brigade' },{ sym:'SOBHA.NS',name:'Sobha' },{ sym:'MAHLIFE.NS',name:'Mahindra Life' }],
  '^CNXFIN': [{ sym:'HDFCBANK.NS',name:'HDFC Bank' },{ sym:'ICICIBANK.NS',name:'ICICI Bank' },{ sym:'KOTAKBANK.NS',name:'Kotak Bank' },{ sym:'AXISBANK.NS',name:'Axis Bank' },{ sym:'SBIN.NS',name:'SBI' },{ sym:'BAJFINANCE.NS',name:'Bajaj Finance' },{ sym:'BAJAJFINSV.NS',name:'Bajaj FinSv' },{ sym:'INDUSINDBK.NS',name:'IndusInd' }],
}

interface QuoteState { price: number | null; change: number | null }
type IndexState  = MainIndex & QuoteState
type SectorState = SectorDef & QuoteState
interface StockMover { sym: string; name: string; change: number | null }

async function fetchYQuote(symbol: string): Promise<QuoteState> {
  try {
    const res = await fetch(`/api/yquote?symbol=${encodeURIComponent(symbol)}`)
    const data = await res.json()
    return { price: data.price ?? null, change: data.change ?? null }
  } catch { return { price: null, change: null } }
}

function sectorColor(change: number | null) {
  if (change === null) return { bg: 'rgba(74,96,112,0.15)', text: 'var(--text-muted)', border: 'rgba(74,96,112,0.2)' }
  if (change >  2)    return { bg: 'rgba(0,201,122,0.45)', text: '#00ffaa', border: 'rgba(0,201,122,0.5)' }
  if (change >  0.5)  return { bg: 'rgba(0,201,122,0.18)', text: '#00c97a', border: 'rgba(0,201,122,0.3)' }
  if (change > -0.5)  return { bg: 'rgba(74,96,112,0.2)',   text: 'var(--text-2)', border: 'rgba(74,96,112,0.3)' }
  if (change > -2)    return { bg: 'rgba(255,69,96,0.18)', text: '#ff6b84', border: 'rgba(255,69,96,0.3)' }
  return                     { bg: 'rgba(255,69,96,0.40)', text: '#ff4560', border: 'rgba(255,69,96,0.5)' }
}

interface SectorHoverProps {
  sector: SectorDef
  change: number | null
  movers: StockMover[]
  loading: boolean
}

function SectorHoverOverlay({ sector, change, movers, loading }: SectorHoverProps) {
  const isPos = (change ?? 0) >= 0
  const winners = [...movers].filter(m => (m.change ?? 0) > 0).sort((a,b) => (b.change??0)-(a.change??0)).slice(0,4)
  const losers  = [...movers].filter(m => (m.change ?? 0) <= 0).sort((a,b) => (a.change??0)-(b.change??0)).slice(0,4)

  return (
    <div style={{
      position: 'absolute',
      left: '50%',
      transform: 'translateX(-50%)',
      top: '80px', // Pinned in the upper half so it doesn't cover the FII strip or leak out
      zIndex: 999, 
      width: '92%',
      maxWidth: '280px',
      background: '#0d1117', 
      border: '1px solid var(--border)', 
      borderRadius: '8px',
      boxShadow: '0 16px 48px rgba(0,0,0,0.95)', 
      padding: '12px', 
      pointerEvents: 'none',
      animation: 'fadeInUp 0.15s ease-out'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '13px', color: '#fff' }}>NSE {sector.label}</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{sector.symbol}</div>
        </div>
        <div style={{ fontSize: '18px', fontWeight: 900, fontFamily: 'Syne,sans-serif', color: isPos ? '#00c97a' : '#ff4560' }}>
          {change != null ? `${isPos?'+':''}${change.toFixed(2)}%` : '···'}
        </div>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '12px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono,monospace' }}>Loading sector components...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <div>
            <div style={{ fontSize: '10px', color: '#00c97a', fontFamily: 'JetBrains Mono,monospace', letterSpacing: '0.1em', marginBottom: '4px', borderBottom: '1px solid rgba(0,201,122,0.2)', paddingBottom: '2px' }}>▲ WINNERS</div>
            {winners.map(m => (
              <div key={m.sym} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ fontSize: '11px', color: '#fff', fontFamily: 'JetBrains Mono,monospace' }}>{m.sym.replace('.NS','')}</span>
                <span style={{ fontSize: '11px', color: '#00c97a', fontFamily: 'JetBrains Mono,monospace', fontWeight: 700 }}>{m.change!=null?`+${m.change.toFixed(1)}%`:'···'}</span>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: '10px', color: '#ff4560', fontFamily: 'JetBrains Mono,monospace', letterSpacing: '0.1em', marginBottom: '4px', borderBottom: '1px solid rgba(255,69,96,0.2)', paddingBottom: '2px' }}>▼ LOSERS</div>
            {losers.map(m => (
              <div key={m.sym} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ fontSize: '11px', color: '#fff', fontFamily: 'JetBrains Mono,monospace' }}>{m.sym.replace('.NS','')}</span>
                <span style={{ fontSize: '11px', color: '#ff4560', fontFamily: 'JetBrains Mono,monospace', fontWeight: 700 }}>{m.change!=null?`${m.change.toFixed(1)}%`:'···'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 10px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  )
}

export default function IndiaMarketsPanel() {
  const [indices,   setIndices]   = useState<IndexState[]>(MAIN_INDICES.map(i => ({ ...i, price: null, change: null })))
  const [sectors,   setSectors]   = useState<SectorState[]>(SECTORS.map(s => ({ ...s, price: null, change: null })))
  const [lastUpdated, setUpdated] = useState('')
  const [hoveredSector, setHoveredSector] = useState<string|null>(null)
  const [sectorMovers,  setSectorMovers]  = useState<StockMover[]>([])
  const [loadingMovers, setLoadingMovers] = useState(false)
  
  const moverCache = useRef<Map<string, StockMover[]>>(new Map())
  const hoverTimer = useRef<ReturnType<typeof setTimeout>|null>(null)
  const staleIndices = useRef<Map<string, QuoteState>>(new Map())
  const staleSectors = useRef<Map<string, QuoteState>>(new Map())

  const fetchAll = async () => {
    const idxResults = await Promise.all(
      MAIN_INDICES.map(async idx => {
        const q = await fetchYQuote(idx.symbol)
        if (q.price !== null) staleIndices.current.set(idx.symbol, q)
        const st = staleIndices.current.get(idx.symbol)
        return { ...idx, price: q.price ?? st?.price ?? null, change: q.change ?? st?.change ?? null }
      })
    )
    setIndices(idxResults)

    const secResults = await Promise.all(
      SECTORS.map(async sec => {
        const q = await fetchYQuote(sec.symbol)
        if (q.price !== null) staleSectors.current.set(sec.symbol, q)
        const st = staleSectors.current.get(sec.symbol)
        return { ...sec, price: q.price ?? st?.price ?? null, change: q.change ?? st?.change ?? null }
      })
    )
    setSectors(secResults)
    setUpdated(new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit' }) + ' IST')
  }

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 30_000)
    return () => clearInterval(t)
  }, [])

  const fetchSectorMovers = useCallback(async (sectorSym: string) => {
    if (moverCache.current.has(sectorSym)) { setSectorMovers(moverCache.current.get(sectorSym)!); return }
    const stocks = NSE_SECTOR_STOCKS[sectorSym] ?? []
    if (!stocks.length) { setSectorMovers([]); return }
    setLoadingMovers(true)
    const results = await Promise.all(
      stocks.map(async ({ sym, name }) => {
        const q = await fetchYQuote(sym)
        return { sym, name, change: q.change }
      })
    )
    moverCache.current.set(sectorSym, results)
    setSectorMovers(results)
    setLoadingMovers(false)
  }, [])

  const handleSectorEnter = (sym: string) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoveredSector(sym)
    setSectorMovers([])
    hoverTimer.current = setTimeout(() => fetchSectorMovers(sym), 200)
  }

  const handleSectorLeave = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    setHoveredSector(null)
  }

  const gainers = sectors.filter(s => (s.change ?? 0) > 0).length
  const losers  = sectors.filter(s => (s.change ?? 0) < 0).length

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      
      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#f97316', boxShadow: '0 0 8px #f97316' }} />
          IN INDIA MARKETS
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'var(--positive)', fontFamily: 'JetBrains Mono, monospace' }}>▲ {gainers}</span>
          <span style={{ fontSize: '10px', color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace' }}>▼ {losers}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{lastUpdated}</span>
        </div>
      </div>

      {/* Main indices */}
      <div style={{ flex: '0 0 auto' }}>
        {indices.map(idx => {
          const isPos = (idx.change ?? 0) >= 0
          const isVix = idx.symbol === '^INDIAVIX'
          return (
            <div key={idx.symbol} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '2px', background: 'rgba(249,115,22,0.12)', color: '#f97316', border: '1px solid rgba(249,115,22,0.25)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                  {idx.badge}
                </span>
                <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: '#fff' }}>{idx.label}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: '#fff' }}>
                  {idx.price != null ? idx.price.toLocaleString('en-IN', { maximumFractionDigits: idx.digits }) : '···'}
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: idx.change == null ? 'var(--text-muted)' : isVix ? (isPos ? 'var(--negative)' : 'var(--positive)') : (isPos ? 'var(--positive)' : 'var(--negative)') }}>
                  {idx.change != null ? `${isPos ? '+' : ''}${idx.change.toFixed(2)}%` : '···'}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Sector mini-heatmap */}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', flex: '0 0 auto' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '5px', paddingLeft: '4px' }}>
          NSE SECTORS · hover for movers
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
          {sectors.map(sec => {
            const col = sectorColor(sec.change)
            const isHov = hoveredSector === sec.symbol
            return (
              <div key={sec.symbol}
                onMouseEnter={() => handleSectorEnter(sec.symbol)}
                onMouseLeave={handleSectorLeave}
                style={{
                  background: col.bg, border: `1px solid ${isHov ? col.text : col.border}`,
                  borderRadius: '4px', padding: '5px 4px', display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: '1px', cursor: 'pointer',
                  transform: isHov ? 'scale(1.03)' : 'scale(1)',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff' }}>{sec.short}</div>
                <div style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: col.text }}>
                  {sec.change != null ? `${sec.change >= 0 ? '+' : ''}${sec.change.toFixed(2)}%` : '···'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* FII/DII flow strip
      <div style={{ padding: '8px 14px', marginTop: 'auto', flex: '0 0 auto' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '6px' }}>
          FII / DII FLOWS — T-1 EST (₹ Cr)
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { label: 'FII NET', value: '-', positive: false },
            { label: 'DII NET', value: '+', positive: true  },
            { label: 'COMBINED', value: '+', positive: true  },
          ].map(({ label, value, positive }) => (
            <div key={label} style={{ flex: 1, padding: '6px 8px', borderRadius: '4px', background: positive ? 'rgba(0,201,122,0.08)' : 'rgba(255,69,96,0.08)', border: `1px solid ${positive ? 'rgba(0,201,122,0.2)' : 'rgba(255,69,96,0.2)'}` }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</div>
              <div style={{ fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: positive ? 'var(--positive)' : 'var(--negative)' }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '4px', opacity: 0.6 }}>
          * Indicative T-1 data. Connect NSE API for live flows.
        </div>
      </div> */}

      {/* Centered Sector Overlay */}
      {hoveredSector && (() => {
        const sec = SECTORS.find(s => s.symbol === hoveredSector)!
        const sectorChange = sectors.find(s => s.symbol === hoveredSector)?.change ?? null
        return <SectorHoverOverlay sector={sec} change={sectorChange} movers={sectorMovers} loading={loadingMovers} />
      })()}
    </div>
  )
}