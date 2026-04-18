'use client'

import { useState, useEffect } from 'react'

// ── Pair definitions ───────────────────────────────────────────────────────────

interface PairData {
  display: string
  symbol:  string
  price:   number | null
  change:  number | null
  high:    number | null
  low:     number | null
  ticks:   number[]
  flash:   'up' | 'down' | null
  stale:   boolean
}

const INIT_PAIRS: PairData[] = [
  { display: 'EUR/USD', symbol: 'EURUSD=X', price: null, change: null, high: null, low: null, ticks: [], flash: null, stale: false },
  { display: 'GBP/USD', symbol: 'GBPUSD=X', price: null, change: null, high: null, low: null, ticks: [], flash: null, stale: false },
  { display: 'USD/JPY', symbol: 'JPY=X',    price: null, change: null, high: null, low: null, ticks: [], flash: null, stale: false },
  { display: 'USD/CHF', symbol: 'USDCHF=X', price: null, change: null, high: null, low: null, ticks: [], flash: null, stale: false },
  { display: 'XAU/USD', symbol: 'XAUUSD=X', price: null, change: null, high: null, low: null, ticks: [], flash: null, stale: false },
  { display: 'BTC/USD', symbol: 'BTC-USD',   price: null, change: null, high: null, low: null, ticks: [], flash: null, stale: false },
  { display: 'ETH/USD', symbol: 'ETH-USD',   price: null, change: null, high: null, low: null, ticks: [], flash: null, stale: false },
]

function fmtPrice(price: number, display: string): string {
  if (display === 'USD/JPY') return price.toFixed(3)
  if (display === 'BTC/USD' || display === 'ETH/USD')
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (display === 'XAU/USD') return price.toFixed(2)
  return price.toFixed(5)
}

// ── Sparkline ──────────────────────────────────────────────────────────────────

function Sparkline({ ticks, change }: { ticks: number[]; change: number | null }) {
  if (ticks.length < 2) return <div style={{ width: 64, height: 22 }} />
  const min = Math.min(...ticks), max = Math.max(...ticks)
  const range = max - min || 1
  const w = 64, h = 20
  const pts = ticks.map((v, i) =>
    `${(i / (ticks.length - 1)) * w},${h - ((v - min) / range) * (h - 2) + 1}`
  )
  const color = change === null ? 'var(--text-muted)' : change >= 0 ? 'var(--positive)' : 'var(--negative)'
  return (
    <svg width={w} height={h + 2} viewBox={`0 0 ${w} ${h + 2}`}>
      <polyline
        points={pts.join(' ')}
        fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  )
}

// ── Session Clock ──────────────────────────────────────────────────────────────

const SESSIONS = [
  { name: 'Sydney',   open: 22, close: 7  },
  { name: 'Tokyo',    open: 0,  close: 9  },
  { name: 'London',   open: 8,  close: 16 },
  { name: 'New York', open: 13, close: 22 },
]

function isActive(h: number, open: number, close: number) {
  return open < close ? h >= open && h < close : h >= open || h < close
}

function SessionClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const utcH = now.getUTCHours()
  const utcM = now.getUTCMinutes()
  const utcS = now.getUTCSeconds()
  const nyOn  = isActive(utcH, 13, 22)
  const lonOn = isActive(utcH, 8, 16)

  return (
    <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Market Sessions
        </span>
        <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
          UTC {String(utcH).padStart(2,'0')}:{String(utcM).padStart(2,'0')}:{String(utcS).padStart(2,'0')}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {SESSIONS.map(s => {
          const active = isActive(utcH, s.open, s.close)
          return (
            <div key={s.name} style={{
              padding: '5px 6px', borderRadius: 4, textAlign: 'center',
              background: active ? 'rgba(0,201,122,0.08)' : 'transparent',
              border: `1px solid ${active ? 'rgba(0,201,122,0.3)' : 'var(--border)'}`,
            }}>
              <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: active ? 700 : 400, color: active ? 'var(--positive)' : 'var(--text-dim)' }}>
                {s.name}
              </div>
              <div style={{ fontSize: 9, color: active ? 'var(--positive)' : 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>
                {active ? '● OPEN' : `${s.open}:00–${s.close}:00 UTC`}
              </div>
            </div>
          )
        })}
      </div>
      {nyOn && lonOn && (
        <div style={{ marginTop: 6, padding: '4px 8px', background: 'rgba(0,229,192,0.06)', border: '1px solid rgba(0,229,192,0.2)', borderRadius: 3, fontSize: 10, color: 'var(--teal)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
          London + New York overlap — highest liquidity window
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export function LiveDashboard() {
  const [pairs,       setPairs]       = useState<PairData[]>(INIT_PAIRS.map(p => ({ ...p })))
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading,     setLoading]     = useState(true)

  useEffect(() => {
    const fetchAll = async () => {
      const results = await Promise.allSettled(
        INIT_PAIRS.map(p =>
          fetch(`/api/yquote?symbol=${encodeURIComponent(p.symbol)}`).then(r => r.json())
        )
      )
      setPairs(prev => prev.map((p, i) => {
        const r = results[i]
        if (r.status === 'rejected') return { ...p, flash: null }
        const data = r.value as { price: number | null; change: number | null; stale?: boolean }
        if (!data.price) return { ...p, flash: null }
        const flash: PairData['flash'] = p.price !== null
          ? data.price > p.price ? 'up' : data.price < p.price ? 'down' : null
          : null
        return {
          ...p,
          price:  data.price,
          change: data.change ?? null,
          high:   p.high === null ? data.price : Math.max(p.high, data.price),
          low:    p.low  === null ? data.price : Math.min(p.low,  data.price),
          ticks:  [...p.ticks, data.price].slice(-20),
          flash,
          stale:  data.stale ?? false,
        }
      }))
      setLastUpdated(new Date())
      setLoading(false)
      setTimeout(() => setPairs(prev => prev.map(p => ({ ...p, flash: null }))), 600)
    }

    fetchAll()
    const id = setInterval(fetchAll, 30_000)
    return () => clearInterval(id)
  }, [])

  const COL = '90px 1fr 80px 80px 80px 70px'

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" />
          FX LIVE DASHBOARD
          <span className="panel-header-sub">Yahoo Finance · 30s refresh</span>
        </div>
        {lastUpdated && (
          <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
            Loading prices...
          </span>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '5px 14px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.015)' }}>
            {['PAIR', 'PRICE', '24H %', 'HIGH*', 'LOW*', 'CHART'].map(h => (
              <span key={h} style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{h}</span>
            ))}
          </div>

          {pairs.map(p => {
            const color = p.change === null ? 'var(--text-muted)' : p.change >= 0 ? 'var(--positive)' : 'var(--negative)'
            const bg = p.flash === 'up' ? 'rgba(0,201,122,0.06)' : p.flash === 'down' ? 'rgba(255,69,96,0.06)' : 'transparent'
            return (
              <div key={p.display} className="nx-row" style={{
                display: 'grid', gridTemplateColumns: COL,
                padding: '8px 14px', borderBottom: '1px solid var(--border)',
                alignItems: 'center', background: bg, transition: 'background 0.6s ease',
              }}>
                <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text)' }}>
                  {p.display}
                </span>
                <span style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color }}>
                  {p.price !== null ? fmtPrice(p.price, p.display) : '—'}
                  {p.stale && <span style={{ fontSize: 9, color: 'var(--text-dim)', marginLeft: 4 }}>~</span>}
                </span>
                <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color }}>
                  {p.change !== null ? `${p.change >= 0 ? '+' : ''}${p.change.toFixed(2)}%` : '—'}
                </span>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
                  {p.high !== null ? fmtPrice(p.high, p.display) : '—'}
                </span>
                <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
                  {p.low !== null ? fmtPrice(p.low, p.display) : '—'}
                </span>
                <Sparkline ticks={p.ticks} change={p.change} />
              </div>
            )
          })}

          <div style={{ padding: '5px 14px', fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            * High/Low since panel load · ~ = stale cache · Source: Yahoo Finance
          </div>
        </div>
      )}

      <SessionClock />
    </div>
  )
}
