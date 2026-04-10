'use client'
// src/components/panels/InsiderDealsPanel.tsx
import { useEffect, useState, useCallback, useRef } from 'react'
import type { InsiderDeal } from '@/app/api/insider-deals/route'

type Market = 'ALL' | 'US' | 'IN'
type DealType = 'ALL' | 'insider' | 'bulk' | 'block'
type SigFilter = 'ALL' | 'high' | 'medium'

interface Stats { total: number; buys: number; sells: number; high: number; us: number; india: number }

const ROLE_COLORS: Record<string, string> = {
  'FII/FPI': '#38bdf8', 'Mutual Fund': '#a78bfa', 'Insurance': '#f0a500', 'DII': '#86efac',
  'Promoter': '#f97316', 'PMS': '#f0a500', 'CEO': '#fbbf24', 'CFO': '#fbbf24',
  'Director': '#fbbf24', 'Institution': '#94a3b8', 'Insider': '#94a3b8', 'Form 4 Filer': '#94a3b8',
}
function roleColor(role: string): string {
  for (const [k, v] of Object.entries(ROLE_COLORS)) if (role.toUpperCase().includes(k.toUpperCase())) return v
  return '#94a3b8'
}

const TYPE_META = {
  insider: { label: 'Form 4 Insider', color: '#f0a500', bg: 'rgba(240,165,0,0.1)', icon: '📋' },
  bulk:    { label: 'Bulk Deal',       color: '#38bdf8', bg: 'rgba(56,189,248,0.1)', icon: '📦' },
  block:   { label: 'Block Deal',      color: '#a78bfa', bg: 'rgba(167,139,250,0.1)', icon: '🧱' },
}
const SIG_META = {
  high:   { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  label: 'HIGH' },
  medium: { color: '#f0a500', bg: 'rgba(240,165,0,0.1)',   border: 'rgba(240,165,0,0.25)', label: 'MID'  },
  low:    { color: '#4a6070', bg: 'rgba(74,96,112,0.08)',  border: 'rgba(74,96,112,0.2)',  label: 'LOW'  },
}

function timeAgo(daysAgo: number): string {
  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return '1d ago'
  if (daysAgo < 7)   return `${daysAgo}d ago`
  if (daysAgo < 30)  return `${Math.floor(daysAgo / 7)}w ago`
  return `${Math.floor(daysAgo / 30)}mo ago`
}

export default function InsiderDealsPanel() {
  const [deals,    setDeals]    = useState<InsiderDeal[]>([])
  const [stats,    setStats]    = useState<Stats | null>(null)
  const [sources,  setSources]  = useState<string[]>([])
  const [loading,  setLoading]  = useState(true)
  const [market,   setMarket]   = useState<Market>('ALL')
  const [dtype,    setDtype]    = useState<DealType>('ALL')
  const [sigF,     setSigF]     = useState<SigFilter>('ALL')
  const [search,   setSearch]   = useState('')
  const [lastUp,   setLastUp]   = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (m: Market) => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    // Clear deals immediately when switching markets to avoid stale data showing
    setDeals([])
    setStats(null)
    setSources([])

    try {
      const r = await fetch(`/api/insider-deals?market=${m}`, { signal: ctrl.signal })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      setDeals(j.deals ?? [])
      setStats(j.stats ?? null)
      setSources(j.sources ?? [])
      setLastUp(new Date(j.fetchedAt || Date.now()).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }))
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('[InsiderDeals] fetch error:', e)
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => { load('ALL') }, [load])

  // Handle market tab change
  const handleMarketChange = (m: Market) => {
    setMarket(m)
    setSearch('') // reset search on market change
    setDtype('ALL')
    setSigF('ALL')
    load(m)
  }

  // Apply filters client-side
  const filtered = deals.filter(d => {
    if (market !== 'ALL' && d.market !== market) return false
    if (dtype  !== 'ALL' && d.type   !== dtype)  return false
    if (sigF   !== 'ALL' && d.significance !== sigF) return false
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      return (
        d.symbol.toLowerCase().includes(q) ||
        d.company.toLowerCase().includes(q) ||
        d.person.toLowerCase().includes(q) ||
        d.role.toLowerCase().includes(q)
      )
    }
    return true
  })

  const buyCount  = filtered.filter(d => d.side === 'BUY').length
  const sellCount = filtered.filter(d => d.side === 'SELL').length
  const sentiment = buyCount + sellCount === 0 ? 0.5 : buyCount / (buyCount + sellCount)

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'JetBrains Mono,monospace' }}>

      {/* HEADER */}
      <div className="panel-header" style={{ flexShrink: 0, justifyContent: 'space-between', flexWrap: 'wrap', gap: '5px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#38bdf8', flexShrink: 0 }} />
          <span style={{ fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700 }}>INSIDER &amp; BLOCK DEALS</span>
          {stats && stats.high > 0 && (
            <span style={{ fontSize: '7px', padding: '2px 6px', borderRadius: '2px', fontWeight: 700, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
              🔥 {stats.high} HIGH-VALUE
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {lastUp && <span style={{ fontSize: '7px', color: 'var(--text-muted)' }}>Updated {lastUp} · 15m cache</span>}
          <button
            onClick={() => load(market)}
            disabled={loading}
            style={{ fontSize: '8px', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
          >
            {loading ? '···' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {/* STATS BAR */}
      {stats && !loading && (
        <div style={{ padding: '7px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0' }}>
          <div style={{ flex: 1, marginRight: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
              <span style={{ fontSize: '8px', color: '#00c97a' }}>▲ BUY {buyCount}</span>
              <span style={{ fontSize: '8px', color: 'var(--text-muted)' }}>SENTIMENT</span>
              <span style={{ fontSize: '8px', color: '#ef4444' }}>SELL {sellCount} ▼</span>
            </div>
            <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(239,68,68,0.3)', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${sentiment * 100}%`, background: '#00c97a', borderRadius: '2px', transition: 'width 0.5s' }} />
            </div>
          </div>
          {[
            { l: 'SHOWING', v: filtered.length, c: '' },
            { l: 'US',      v: stats.us,        c: '#60a5fa' },
            { l: 'INDIA',   v: stats.india,     c: '#f97316' },
            { l: 'HIGH',    v: stats.high,      c: '#ef4444' },
          ].map(s => (
            <div key={s.l} style={{ textAlign: 'center', paddingLeft: '12px', borderLeft: '1px solid var(--border)' }}>
              <div style={{ fontSize: '16px', fontWeight: 900, fontFamily: 'Syne,sans-serif', color: s.c || '#fff', lineHeight: 1 }}>{s.v}</div>
              <div style={{ fontSize: '7px', color: 'var(--text-muted)', letterSpacing: '0.07em' }}>{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* FILTERS */}
      <div style={{ padding: '7px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Market toggle */}
        <div style={{ display: 'flex', gap: '2px' }}>
          {(['ALL', 'US', 'IN'] as Market[]).map(m => (
            <button key={m} onClick={() => handleMarketChange(m)} style={{
              padding: '2px 9px', borderRadius: '3px', cursor: 'pointer', fontSize: '8px',
              border: `1px solid ${market === m ? '#38bdf8' : 'var(--border)'}`,
              background: market === m ? 'rgba(56,189,248,0.12)' : 'transparent',
              color: market === m ? '#38bdf8' : 'var(--text-muted)',
              fontFamily: 'JetBrains Mono,monospace',
            }}>
              {m === 'ALL' ? '🌐 ALL' : m === 'US' ? '🇺🇸 US' : '🇮🇳 INDIA'}
            </button>
          ))}
        </div>

        {/* Type toggle */}
        <div style={{ display: 'flex', gap: '2px' }}>
          {(['ALL', 'insider', 'bulk', 'block'] as DealType[]).map(t => (
            <button key={t} onClick={() => setDtype(t)} style={{
              padding: '2px 9px', borderRadius: '3px', cursor: 'pointer', fontSize: '8px',
              border: `1px solid ${dtype === t ? 'var(--teal)' : 'var(--border)'}`,
              background: dtype === t ? 'rgba(0,201,122,0.1)' : 'transparent',
              color: dtype === t ? 'var(--teal)' : 'var(--text-muted)',
              fontFamily: 'JetBrains Mono,monospace',
            }}>
              {t === 'ALL' ? 'ALL' : TYPE_META[t]?.icon + ' ' + t.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Significance */}
        <div style={{ display: 'flex', gap: '2px' }}>
          {(['ALL', 'high', 'medium'] as SigFilter[]).map(s => (
            <button key={s} onClick={() => setSigF(s)} style={{
              padding: '2px 9px', borderRadius: '3px', cursor: 'pointer', fontSize: '8px',
              border: `1px solid ${sigF === s ? '#f0a500' : 'var(--border)'}`,
              background: sigF === s ? 'rgba(240,165,0,0.1)' : 'transparent',
              color: sigF === s ? '#f0a500' : 'var(--text-muted)',
              fontFamily: 'JetBrains Mono,monospace',
            }}>
              {s === 'ALL' ? 'ALL SIG' : s.toUpperCase() + ' SIG'}
            </button>
          ))}
        </div>

        {/* Search — proper controlled input */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
          placeholder="Search symbol / company / person..."
          style={{
            flex: 1, minWidth: '100px',
            background: 'var(--bg-deep)', border: `1px solid ${search ? 'rgba(56,189,248,0.4)' : 'var(--border)'}`,
            borderRadius: '4px', padding: '3px 8px', color: '#fff', fontSize: '9px',
            fontFamily: 'JetBrains Mono,monospace', outline: 'none',
          }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ padding: '2px 6px', borderRadius: '3px', cursor: 'pointer', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: '10px' }}>✕</button>
        )}

        {/* Result count */}
        <span style={{ fontSize: '8px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {filtered.length}/{deals.length}
        </span>
      </div>

      {/* DEAL LIST */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.1em' }}>
            <div style={{ marginBottom: '8px' }}>FETCHING DEAL DATA…</div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
              {market === 'US' ? 'Loading SEC Form 4 data via Finnhub' : market === 'IN' ? 'Loading NSE + BSE bulk/block deals' : 'Loading US + India deals'}
            </div>
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '10px' }}>
            {deals.length === 0
              ? `No deals fetched for ${market} market. NSE/BSE APIs may be unavailable outside market hours.`
              : search
              ? `No deals match "${search}". Try clearing the search.`
              : 'No deals match the current filters.'}
          </div>
        )}

        {!loading && filtered.map((d, i) => {
          const tm = TYPE_META[d.type]
          const sm = SIG_META[d.significance]
          const rc = roleColor(d.role)
          const isBuy = d.side === 'BUY'

          return (
            <div
              key={d.id}
              onClick={() => d.url && window.open(d.url, '_blank')}
              style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border)', cursor: d.url ? 'pointer' : 'default',
                background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.008)',
                borderLeft: `3px solid ${isBuy ? 'rgba(0,201,122,0.4)' : 'rgba(239,68,68,0.4)'}`,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
              onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.008)')}
            >
              {/* Row 1: badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '8px', padding: '2px 8px', borderRadius: '3px', fontWeight: 900, letterSpacing: '0.1em', background: isBuy ? 'rgba(0,201,122,0.15)' : 'rgba(239,68,68,0.15)', color: isBuy ? '#00c97a' : '#ef4444', border: `1px solid ${isBuy ? 'rgba(0,201,122,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                  {isBuy ? '▲ BUY' : '▼ SELL'}
                </span>
                <span style={{ fontSize: '7px', padding: '2px 6px', borderRadius: '2px', background: tm.bg, color: tm.color, border: `1px solid ${tm.color}28` }}>
                  {tm.icon} {tm.label}
                </span>
                <span style={{ fontSize: '10px' }}>{d.market === 'US' ? '🇺🇸' : '🇮🇳'}</span>
                <span style={{ fontSize: '7px', padding: '2px 6px', borderRadius: '2px', fontWeight: 700, background: sm.bg, color: sm.color, border: `1px solid ${sm.border}` }}>
                  {sm.label}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '7px', color: 'var(--text-muted)' }}>{timeAgo(d.daysAgo)} · {d.dateFmt}</span>
              </div>

              {/* Row 2: symbol + value */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '5px', gap: '8px' }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: '15px', fontWeight: 900, color: '#fff', fontFamily: 'Syne,sans-serif' }}>{d.symbol}</span>
                  {d.company !== d.symbol && (
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: '6px' }}>
                      {d.company.slice(0, 28)}{d.company.length > 28 ? '…' : ''}
                    </span>
                  )}
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '18px', fontWeight: 900, color: isBuy ? '#00c97a' : '#ef4444', fontFamily: 'Syne,sans-serif', lineHeight: 1 }}>
                    {d.valueFmt !== '—' ? d.valueFmt : '—'}
                  </div>
                  {d.shares && (
                    <div style={{ fontSize: '8px', color: 'var(--text-muted)' }}>
                      {d.shares.toLocaleString(d.market === 'IN' ? 'en-IN' : 'en-US')} shares
                      {d.price ? ` @ ${d.currency === 'INR' ? '₹' : '$'}${d.price.toFixed(2)}` : ''}
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3: person + role */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '7px', padding: '2px 7px', borderRadius: '2px', background: `${rc}15`, color: rc, border: `1px solid ${rc}28`, fontWeight: 700 }}>{d.role}</span>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                  {d.person.length > 40 ? d.person.slice(0, 40) + '…' : d.person}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* FOOTER */}
      <div style={{ padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0, fontSize: '7px', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
        <span>{sources.length > 0 ? sources.join(' · ') : 'Waiting for data…'}</span>
        <span>US: Form 4 (open-market only) · India: NSE + BSE official APIs</span>
      </div>
    </div>
  )
}