'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface IPOData {
  ticker: string
  company: string
  industry: string
  ipoDate: string
  priceRange: string
  shares: string
  rating: 'bullish' | 'neutral' | 'bearish'
  status: 'upcoming' | 'recent'
  underwriter?: string
  marketCap?: string
}

const ratingColor = (r: string) => r === 'bullish' ? 'var(--positive)' : r === 'bearish' ? 'var(--negative)' : 'var(--text-muted)'
const ratingBg = (r: string) => r === 'bullish' ? 'rgba(0,201,122,0.12)' : r === 'bearish' ? 'rgba(255,69,96,0.12)' : 'rgba(74,96,112,0.12)'

export default function IpoScreenerPanel() {
  const [ipos, setIpos]       = useState<IPOData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [filter, setFilter]   = useState<'all' | 'upcoming' | 'recent'>('all')
  const [ratingFilter, setRatingFilter] = useState<'all' | 'bullish' | 'neutral' | 'bearish'>('all')
  const abortRef = useRef<AbortController | null>(null)

  const fetchIPOs = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    setError(null)
    let url = '/api/ipo-data'
    const params: string[] = []
    if (filter !== 'all')       params.push(`status=${filter}`)
    if (ratingFilter !== 'all') params.push(`rating=${ratingFilter}`)
    if (params.length) url += `?${params.join('&')}`

    try {
      const res = await fetch(url, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status} from /api/ipo-data`)
      const data = await res.json()
      if (signal.aborted) return
      setIpos(Array.isArray(data.ipos) ? data.ipos : [])
      setLoading(false)
    } catch (e) {
      // AbortError is expected when the filter changes mid-flight — silent.
      if ((e as { name?: string }).name === 'AbortError') return
      // Don't console.error transient upstream failures; surface in UI so
      // the user has a Retry path and the dev console stays clean.
      setError(e instanceof Error ? e.message : 'Network error')
      setLoading(false)
    }
  }, [filter, ratingFilter])

  useEffect(() => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    fetchIPOs(ctrl.signal)
    return () => ctrl.abort()
  }, [fetchIPOs])

  const retry = () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    fetchIPOs(ctrl.signal)
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#ff6b6b' }} />
          IPO SCREENER
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {ipos.length} listings
          </span>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        padding: '6px 10px', borderBottom: '1px solid var(--border)',
        display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center',
        background: 'rgba(0,0,0,0.12)',
      }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>STATUS</span>
        {(['all', 'upcoming', 'recent'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 10px', borderRadius: '3px', cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
            border: `1px solid ${filter === f ? 'var(--amber)' : 'var(--border)'}`,
            background: filter === f ? 'rgba(240,165,0,0.12)' : 'transparent',
            color: filter === f ? 'var(--amber)' : 'var(--text-muted)',
            textTransform: 'capitalize',
          }}>{f}</button>
        ))}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>RATING</span>
          {(['all', 'bullish', 'neutral', 'bearish'] as const).map(r => (
            <button key={r} onClick={() => setRatingFilter(r)} style={{
              padding: '4px 10px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
              border: `1px solid ${ratingFilter === r ? ratingColor(r) : 'var(--border)'}`,
              background: ratingFilter === r ? ratingBg(r) : 'transparent',
              color: ratingFilter === r ? ratingColor(r) : 'var(--text-muted)',
              textTransform: 'capitalize',
            }}>{r}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
            LOADING IPO DATA...
          </div>
        ) : error ? (
          <div style={{
            padding: '32px 20px', textAlign: 'center',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
            lineHeight: 1.6,
          }}>
            <div style={{ color: 'var(--negative)', marginBottom: '6px' }}>⚠ Failed to load IPO data</div>
            <div style={{ color: 'var(--text-muted)', marginBottom: '14px' }}>{error}</div>
            <button
              onClick={retry}
              style={{
                padding: '5px 14px', borderRadius: '3px', cursor: 'pointer',
                border: '1px solid var(--amber)', background: 'rgba(240,165,0,0.10)',
                color: 'var(--amber)', fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', fontWeight: 700,
              }}
            >↺ RETRY</button>
          </div>
        ) : ipos.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
            No IPOs match your filters
          </div>
        ) : (
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
          }}>
            <thead style={{ background: 'rgba(0,0,0,0.25)', position: 'sticky', top: 0 }}>
              <tr>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>TICKER</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>COMPANY</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>INDUSTRY</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>IPO DATE</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>PRICE RANGE</th>
                <th style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, borderBottom: '1px solid var(--border)' }}>RATING</th>
              </tr>
            </thead>
            <tbody>
              {ipos.map((ipo, i) => (
                <tr key={i} style={{
                  borderBottom: '1px solid var(--border)',
                  background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.08)',
                  cursor: 'pointer',
                }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')} onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.08)')}>
                  <td style={{ padding: '8px', fontWeight: 700, color: 'var(--amber)' }}>{ipo.ticker}</td>
                  <td style={{ padding: '8px', color: '#fff' }}>{ipo.company}</td>
                  <td style={{ padding: '8px', color: 'var(--text-muted)', fontSize: '10px' }}>{ipo.industry}</td>
                  <td style={{ padding: '8px', color: 'var(--text-muted)' }}>{new Date(ipo.ipoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td style={{ padding: '8px', color: 'var(--text-2)', fontWeight: 500 }}>{ipo.priceRange}</td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <span style={{
                      padding: '2px 8px', borderRadius: '2px', fontSize: '11px',
                      background: ratingBg(ipo.rating), color: ratingColor(ipo.rating),
                      border: `1px solid ${ratingColor(ipo.rating)}20`,
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}>
                      {ipo.rating}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
