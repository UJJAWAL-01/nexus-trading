'use client'

import { useEffect, useState, useRef } from 'react'

// ── Symbol definitions ─────────────────────────────────────────────────────

interface MainIndex { symbol: string; label: string; badge: string; digits: number }
interface SectorDef { symbol: string; label: string; short: string }

const MAIN_INDICES: MainIndex[] = [
  { symbol: '^NSEI',     label: 'NIFTY 50',    badge: 'N50',  digits: 2 },
  { symbol: '^BSESN',    label: 'SENSEX',       badge: 'BSE',  digits: 2 },
  { symbol: '^NSEBANK',  label: 'BANK NIFTY',   badge: 'BNK',  digits: 2 },
  { symbol: '^INDIAVIX', label: 'India VIX',    badge: 'VIX',  digits: 2 },
  { symbol: 'USDINR=X',  label: 'USD / INR',    badge: '₹',    digits: 4 },
]

const SECTORS: SectorDef[] = [
  { symbol: '^CNXIT',      label: 'IT',       short: 'IT'   },
  { symbol: '^CNXAUTO',    label: 'Auto',     short: 'AUTO' },
  { symbol: '^CNXFMCG',    label: 'FMCG',     short: 'FMCG' },
  { symbol: '^CNXPHARMA',  label: 'Pharma',   short: 'PHRM' },
  { symbol: '^CNXMETAL',   label: 'Metal',    short: 'METL' },
  { symbol: '^CNXENERGY',  label: 'Energy',   short: 'ENGY' },
  { symbol: '^CNXREALTY',  label: 'Realty',   short: 'RLTY' },
  { symbol: '^CNXFINANCE', label: 'Finance',  short: 'FIN'  },
]

// ── Types ──────────────────────────────────────────────────────────────────

interface QuoteState { price: number | null; change: number | null }
type IndexState  = MainIndex  & QuoteState
type SectorState = SectorDef  & QuoteState

// ── Helpers ────────────────────────────────────────────────────────────────

async function fetchYQuote(symbol: string): Promise<QuoteState> {
  try {
    const res  = await fetch(`/api/yquote?symbol=${encodeURIComponent(symbol)}`)
    const data = await res.json()
    return { price: data.price ?? null, change: data.change ?? null }
  } catch {
    return { price: null, change: null }
  }
}

function sectorColor(change: number | null) {
  if (change === null)  return { bg: 'rgba(74,96,112,0.15)', text: 'var(--text-muted)', border: 'rgba(74,96,112,0.2)' }
  if (change >  2)      return { bg: 'rgba(0,201,122,0.45)', text: '#00ffaa',           border: 'rgba(0,201,122,0.5)' }
  if (change >  0.5)    return { bg: 'rgba(0,201,122,0.18)', text: '#00c97a',           border: 'rgba(0,201,122,0.3)' }
  if (change > -0.5)    return { bg: 'rgba(74,96,112,0.2)',  text: 'var(--text-2)',      border: 'rgba(74,96,112,0.3)' }
  if (change > -2)      return { bg: 'rgba(255,69,96,0.18)', text: '#ff6b84',           border: 'rgba(255,69,96,0.3)' }
  return                       { bg: 'rgba(255,69,96,0.40)', text: '#ff4560',           border: 'rgba(255,69,96,0.5)' }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function IndiaMarketsPanel() {
  const [indices, setIndices]   = useState<IndexState[]>(
    MAIN_INDICES.map(i => ({ ...i, price: null, change: null }))
  )
  const [sectors, setSectors]   = useState<SectorState[]>(
    SECTORS.map(s => ({ ...s, price: null, change: null }))
  )
  const [lastUpdated, setUpdated] = useState('')

  const staleIndices = useRef<Map<string, QuoteState>>(new Map())
  const staleSectors = useRef<Map<string, QuoteState>>(new Map())

  const fetchAll = async () => {
    // Fetch main indices in parallel
    const idxResults = await Promise.all(
      MAIN_INDICES.map(async (idx) => {
        const q = await fetchYQuote(idx.symbol)
        if (q.price !== null) staleIndices.current.set(idx.symbol, q)
        const st = staleIndices.current.get(idx.symbol)
        return { ...idx, price: q.price ?? st?.price ?? null, change: q.change ?? st?.change ?? null }
      })
    )
    setIndices(idxResults)

    // Fetch sectors in parallel
    const secResults = await Promise.all(
      SECTORS.map(async (sec) => {
        const q = await fetchYQuote(sec.symbol)
        if (q.price !== null) staleSectors.current.set(sec.symbol, q)
        const st = staleSectors.current.get(sec.symbol)
        return { ...sec, price: q.price ?? st?.price ?? null, change: q.change ?? st?.change ?? null }
      })
    )
    setSectors(secResults)

    setUpdated(
      new Date().toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata', hour12: false,
        hour: '2-digit', minute: '2-digit',
      }) + ' IST'
    )
  }

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 30_000)
    return () => clearInterval(t)
  }, [])

  const loadedSectors = sectors.filter(s => s.change !== null)
  const gainers = loadedSectors.filter(s => (s.change ?? 0) > 0).length
  const losers  = loadedSectors.filter(s => (s.change ?? 0) < 0).length

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#f97316', boxShadow: '0 0 8px #f97316' }} />
          🇮🇳 INDIA MARKETS
        </div>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {gainers > 0 && <span style={{ fontSize: '10px', color: 'var(--positive)', fontFamily: 'JetBrains Mono, monospace' }}>▲ {gainers}</span>}
          {losers  > 0 && <span style={{ fontSize: '10px', color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace' }}>▼ {losers}</span>}
          {lastUpdated && (
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              {lastUpdated}
            </span>
          )}
        </div>
      </div>

      {/* Main indices */}
      <div style={{ flex: '0 0 auto' }}>
        {indices.map((idx) => {
          const isPos  = (idx.change ?? 0) >= 0
          const isVix  = idx.symbol === '^INDIAVIX'
          const isINR  = idx.symbol === 'USDINR=X'
          return (
            <div key={idx.symbol} style={{
              display:        'flex',
              justifyContent: 'space-between',
              alignItems:     'center',
              padding:        '7px 14px',
              borderBottom:   '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Badge */}
                <span style={{
                  fontSize:      '9px',
                  padding:       '1px 6px',
                  borderRadius:  '2px',
                  background:    'rgba(249,115,22,0.12)',
                  color:         '#f97316',
                  border:        '1px solid rgba(249,115,22,0.25)',
                  fontFamily:    'JetBrains Mono, monospace',
                  letterSpacing: '0.04em',
                  fontWeight:    700,
                }}>
                  {idx.badge}
                </span>
                <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: '#fff' }}>
                  {idx.label}
                </span>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#fff' }}>
                  {idx.price != null
                    ? idx.price.toLocaleString('en-IN', { maximumFractionDigits: idx.digits })
                    : '···'}
                </div>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize:   '10px',
                  color:
                    idx.change == null ? 'var(--text-muted)' :
                    isVix    ? (isPos ? 'var(--negative)' : 'var(--positive)') : // VIX up = bad
                    isPos    ? 'var(--positive)' : 'var(--negative)',
                }}>
                  {idx.change != null
                    ? `${isPos ? '+' : ''}${idx.change.toFixed(2)}%`
                    : '···'}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Sector mini-heatmap */}
      <div style={{
        padding:             '6px 8px',
        borderBottom:        '1px solid var(--border)',
        flex:                '0 0 auto',
      }}>
        <div style={{
          fontSize:      '8px',
          color:         'var(--text-muted)',
          fontFamily:    'JetBrains Mono, monospace',
          letterSpacing: '0.1em',
          marginBottom:  '5px',
          paddingLeft:   '4px',
        }}>
          NSE SECTORS
        </div>
        <div style={{
          display:             'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap:                 '4px',
        }}>
          {sectors.map(sec => {
            const col = sectorColor(sec.change)
            return (
              <div key={sec.symbol} style={{
                background:    col.bg,
                border:        `1px solid ${col.border}`,
                borderRadius:  '4px',
                padding:       '5px 4px',
                display:       'flex',
                flexDirection: 'column',
                alignItems:    'center',
                gap:           '1px',
              }}>
                <div style={{
                  fontSize:      '9px',
                  fontFamily:    'Syne, sans-serif',
                  fontWeight:    700,
                  color:         '#fff',
                  letterSpacing: '0.02em',
                }}>
                  {sec.short}
                </div>
                <div style={{
                  fontSize:   '10px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700,
                  color:      col.text,
                }}>
                  {sec.change != null
                    ? `${sec.change >= 0 ? '+' : ''}${sec.change.toFixed(2)}%`
                    : '···'}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* FII / DII flow strip */}
      <div style={{ padding: '8px 14px', marginTop: 'auto', flex: '0 0 auto' }}>
        <div style={{
          fontSize:      '8px',
          color:         'var(--text-muted)',
          fontFamily:    'JetBrains Mono, monospace',
          letterSpacing: '0.1em',
          marginBottom:  '6px',
        }}>
          FII / DII FLOWS — T-1 EST (₹ Cr)
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {[
            { label: 'FII NET',  value: '-2,847',  positive: false },
            { label: 'DII NET',  value: '+3,412',  positive: true  },
            { label: 'COMBINED', value: '+565',    positive: true  },
          ].map(({ label, value, positive }) => (
            <div key={label} style={{
              flex:         1,
              padding:      '6px 8px',
              borderRadius: '4px',
              background:   positive ? 'rgba(0,201,122,0.08)'  : 'rgba(255,69,96,0.08)',
              border:       `1px solid ${positive ? 'rgba(0,201,122,0.2)' : 'rgba(255,69,96,0.2)'}`,
            }}>
              <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                {label}
              </div>
              <div style={{
                fontSize:   '12px',
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 700,
                color:      positive ? 'var(--positive)' : 'var(--negative)',
              }}>
                {value}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '4px', opacity: 0.6 }}>
          * Indicative T-1 data. Connect NSE API for live flows.
        </div>
      </div>
    </div>
  )
}