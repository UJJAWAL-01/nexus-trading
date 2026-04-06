'use client'

import { useEffect, useState, useRef } from 'react'

type Market = 'US' | 'IN'

interface Earning {
  symbol:          string
  name:            string
  date:            string
  epsEstimate:     number | null
  epsActual:       number | null
  revenueEstimate: number | null
  revenueActual:   number | null
  hour:            string
  market:          'US' | 'IN'
  beat:            boolean | null
}

function todayStr() { return new Date().toISOString().split('T')[0] }
function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function fmtEps(v: number | null) {
  if (v === null) return '—'
  return (v >= 0 ? '' : '-') + '$' + Math.abs(v).toFixed(2)
}
function fmtRevenue(v: number | null) {
  if (v === null) return '—'
  if (Math.abs(v) >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B'
  if (Math.abs(v) >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'
  return '$' + v.toFixed(0)
}
function relDay(date: string): string {
  const today = new Date(todayStr() + 'T00:00:00').getTime()
  const d     = new Date(date + 'T00:00:00').getTime()
  const diff  = Math.round((d - today) / 86400_000)
  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'TMR'
  if (diff === -1) return 'YEST'
  if (diff > 0) return `+${diff}d`
  return `${diff}d`
}

const staleRef: Record<Market, Earning[]> = { US: [], IN: [] }

export default function EarningsPanel() {
  const [market,   setMarket]   = useState<Market>('US')
  const [earnings, setEarnings] = useState<Earning[]>([])
  const [loading,  setLoading]  = useState(true)
  const [filter,   setFilter]   = useState<'all' | 'today' | 'week'>('week')
  const abortRef = useRef<AbortController | null>(null)

  const fetchEarnings = async (m: Market) => {
    setLoading(true)
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res  = await fetch(`/api/earnings?market=${m}`, { signal: ctrl.signal })
      const data = (await res.json()) as Earning[]
      staleRef[m] = data
      setEarnings(data)
    } catch {
      if (staleRef[m].length) setEarnings(staleRef[m])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchEarnings(market)
  }, [market])

  const today = todayStr()
  const displayed = earnings.filter(e => {
    if (filter === 'today') return e.date === today
    if (filter === 'week') {
      const d = new Date(e.date + 'T00:00:00').getTime()
      const t = new Date(today + 'T00:00:00').getTime()
      return d >= t - 86400_000 && d <= t + 7 * 86400_000
    }
    return true
  })

  const todayCount = earnings.filter(e => e.date === today).length
  const weekCount  = earnings.filter(e => {
    const d = new Date(e.date + 'T00:00:00').getTime()
    const t = new Date(today + 'T00:00:00').getTime()
    return d >= t && d <= t + 7 * 86400_000
  }).length

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#a78bfa' }} />
          EARNINGS CALENDAR
          {todayCount > 0 && (
            <span style={{
              fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
              background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
              border: '1px solid rgba(167,139,250,0.3)',
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {todayCount} TODAY
            </span>
          )}
        </div>

        {/* Market toggle */}
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['US', 'IN'] as Market[]).map(m => (
            <button key={m} onClick={() => setMarket(m)} style={{
              padding: '2px 10px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
              letterSpacing: '0.08em', fontWeight: 700,
              border: `1px solid ${market === m ? '#a78bfa' : 'var(--border)'}`,
              background: market === m ? 'rgba(167,139,250,0.12)' : 'transparent',
              color: market === m ? '#a78bfa' : 'var(--text-muted)',
            }}>
              {m === 'US' ? '🇺🇸' : '🇮🇳'} {m}
            </button>
          ))}
        </div>
      </div>

      {/* Time filters */}
      <div style={{
        display: 'flex', gap: '4px', padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
      }}>
        {([
          ['all',   `All (${earnings.length})`],
          ['today', `Today (${todayCount})`],
          ['week',  `7 Days (${weekCount})`],
        ] as const).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '2px 10px', borderRadius: '3px', cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
            letterSpacing: '0.05em',
            border: `1px solid ${filter === f ? 'var(--teal)' : 'var(--border)'}`,
            background: filter === f ? 'rgba(0,229,192,0.08)' : 'transparent',
            color: filter === f ? 'var(--teal)' : 'var(--text-muted)',
          }}>
            {label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', alignSelf: 'center' }}>
          {market === 'US' ? 'via Finnhub' : 'via Yahoo Finance'}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
            FETCHING EARNINGS...
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
            {market === 'IN'
              ? 'India earnings data requires Yahoo Finance module access.\nMajor stocks may show limited data.'
              : 'No earnings in this window.'}
          </div>
        ) : displayed.map((e, i) => {
          const isToday  = e.date === today
          const rel      = relDay(e.date)
          const hasBeat  = e.beat !== null
          const beaten   = e.beat === true

          return (
            <div key={`${e.symbol}-${e.date}-${i}`} style={{
              padding:      '9px 14px',
              borderBottom: '1px solid var(--border)',
              background:   isToday ? 'rgba(167,139,250,0.04)' : 'transparent',
              borderLeft:   isToday ? '2px solid #a78bfa' : '2px solid transparent',
            }}>
              {/* Row 1 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontFamily: 'Syne, sans-serif', fontWeight: 800,
                    fontSize: '13px', color: '#fff',
                  }}>
                    {e.symbol}
                  </span>
                  {hasBeat && (
                    <span style={{
                      fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
                      background: beaten ? 'rgba(0,201,122,0.12)' : 'rgba(255,69,96,0.12)',
                      color:      beaten ? 'var(--positive)' : 'var(--negative)',
                      border:     `1px solid ${beaten ? 'rgba(0,201,122,0.25)' : 'rgba(255,69,96,0.25)'}`,
                      fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                    }}>
                      {beaten ? '▲ BEAT' : '▼ MISS'}
                    </span>
                  )}
                  <span style={{
                    fontSize: '9px', color: 'var(--text-muted)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    {e.hour === 'bmo' ? 'BMO' : e.hour === 'amc' ? 'AMC' : 'During'}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{
                    fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
                    color: isToday ? '#a78bfa' : 'var(--text-muted)',
                    fontWeight: isToday ? 700 : 400,
                  }}>
                    {rel}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {fmtDate(e.date)}
                  </span>
                </div>
              </div>

              {/* Row 2 — Company name */}
              <div style={{ fontSize: '11px', color: 'var(--text-2)', fontFamily: 'Syne, sans-serif', marginBottom: '5px' }}>
                {e.name}
              </div>

              {/* Row 3 — EPS + Revenue */}
              <div style={{ display: 'flex', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>EPS EST</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                    {fmtEps(e.epsEstimate)}
                  </div>
                </div>
                {e.epsActual !== null && (
                  <div>
                    <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>EPS ACT</div>
                    <div style={{
                      fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                      color: e.beat === true ? 'var(--positive)' : e.beat === false ? 'var(--negative)' : 'var(--text-2)',
                    }}>
                      {fmtEps(e.epsActual)}
                    </div>
                  </div>
                )}
                {e.revenueEstimate !== null && (
                  <div>
                    <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>REV EST</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {fmtRevenue(e.revenueEstimate)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}