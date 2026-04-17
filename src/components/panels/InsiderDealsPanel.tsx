'use client'
// src/components/panels/InsiderDealsPanel.tsx
// Intelligence layer: smart-money scoring, sector clustering, unusual activity
// detection, multi-insider CLUSTER signals (the Bloomberg-beater).

import { useMemo, useState } from 'react'
import { useInsiderDeals, type InsiderDeal } from '@/lib/data-hooks'

type Market    = 'ALL' | 'US' | 'IN'
type DealType  = 'ALL' | 'insider' | 'bulk' | 'block'
type SigFilter = 'ALL' | 'high' | 'medium'
type ViewMode  = 'deals' | 'intelligence'

// ── Color helpers ─────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  'FII/FPI':      '#38bdf8', 'Mutual Fund': '#a78bfa', 'Insurance':   '#f0a500',
  'DII':          '#86efac', 'Promoter':    '#f97316', 'PMS':         '#f0a500',
  'CEO':          '#fbbf24', 'CFO':         '#fbbf24', 'Director':    '#fbbf24',
  'Institution':  '#94a3b8', 'Insider':     '#94a3b8', 'Form 4 Filer':'#94a3b8',
}
function roleColor(role: string): string {
  const r = role.toUpperCase()
  for (const [k, v] of Object.entries(ROLE_COLORS)) {
    if (r.includes(k.toUpperCase())) return v
  }
  return '#94a3b8'
}

const TYPE_META = {
  insider: { label:'Form 4 Insider', color:'#f0a500', bg:'rgba(240,165,0,0.1)',   icon:'📋' },
  bulk:    { label:'Bulk Deal',       color:'#38bdf8', bg:'rgba(56,189,248,0.1)',  icon:'📦' },
  block:   { label:'Block Deal',      color:'#a78bfa', bg:'rgba(167,139,250,0.1)', icon:'🧱' },
}
const SIG_META = {
  high:   { color:'#ef4444', bg:'rgba(239,68,68,0.12)',  border:'rgba(239,68,68,0.3)',  label:'HIGH'   },
  medium: { color:'#f0a500', bg:'rgba(240,165,0,0.1)',   border:'rgba(240,165,0,0.25)', label:'MID'    },
  low:    { color:'#4a6070', bg:'rgba(74,96,112,0.08)',  border:'rgba(74,96,112,0.2)',  label:'LOW'    },
}

function timeAgo(d: number): string {
  if (d === 0) return 'Today'
  if (d === 1) return '1d ago'
  if (d < 7)   return `${d}d ago`
  if (d < 30)  return `${Math.floor(d/7)}w ago`
  return `${Math.floor(d/30)}mo ago`
}

// Single source of truth for formatting currency-aware numbers. The API
// already sends `valueFmt` for individual deals; this is only used for
// *aggregate* stats where the API ships raw numbers so the client can
// decide what to render.
function fmt(v: number, currency: 'USD'|'INR'): string {
  if (!v) return '—'
  const a = Math.abs(v)
  if (currency === 'INR') {
    if (a >= 1e7) return `₹${(v/1e7).toFixed(1)}Cr`
    if (a >= 1e5) return `₹${(v/1e5).toFixed(1)}L`
    return `₹${v.toLocaleString('en-IN',{maximumFractionDigits:0})}`
  }
  if (a >= 1e9) return `$${(v/1e9).toFixed(1)}B`
  if (a >= 1e6) return `$${(v/1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v/1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function smColor(score: number): string {
  if (score >= 75) return '#00c97a'
  if (score >= 50) return '#f0a500'
  if (score >= 30) return '#94a3b8'
  return '#4a6070'
}

function SmartBar({ score }: { score: number }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'4px', marginTop:'3px' }}>
      <div style={{ flex:1, height:'3px', background:'var(--bg-deep)', borderRadius:'2px', overflow:'hidden' }}>
        <div style={{ height:'100%', width:`${score}%`, background: smColor(score), borderRadius:'2px', transition:'width 0.5s' }} />
      </div>
      <span style={{ fontSize:'8px', color: smColor(score), fontFamily:'JetBrains Mono,monospace', minWidth:'24px' }}>
        {score}
      </span>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function InsiderDealsPanel() {
  const [market,   setMarket]   = useState<Market>('ALL')
  const [dtype,    setDtype]    = useState<DealType>('ALL')
  const [sigF,     setSigF]     = useState<SigFilter>('ALL')
  const [search,   setSearch]   = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('deals')

  // Shared SWR hook — if another panel ever uses the same market, they
  // share one network request & cache entry.
  const { data, error, isLoading, isValidating, mutate } = useInsiderDeals(market)

  const deals        = data?.deals       ?? []
  const stats        = data?.stats       ?? null
  const sectorIntel  = data?.sectorIntel ?? []
  const clusters     = data?.clusters    ?? []
  const sources      = data?.sources     ?? []
  const lastUp       = data?.fetchedAt
    ? new Date(data.fetchedAt).toLocaleTimeString('en-US', { hour12:false, hour:'2-digit', minute:'2-digit' })
    : ''

  const handleMarketChange = (m: Market) => {
    setMarket(m); setSearch(''); setDtype('ALL'); setSigF('ALL')
  }

  // ── Derived values (memoized) ──────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return deals.filter(d => {
      if (dtype !== 'ALL' && d.type !== dtype) return false
      if (sigF  !== 'ALL' && d.significance !== sigF) return false
      if (q) {
        return d.symbol.toLowerCase().includes(q) ||
               d.company.toLowerCase().includes(q) ||
               d.person.toLowerCase().includes(q) ||
               d.role.toLowerCase().includes(q)
      }
      return true
    })
  }, [deals, dtype, sigF, search])

  const { buyCount, sellCount, sentiment } = useMemo(() => {
    const b = filtered.filter(d => d.side === 'BUY').length
    const s = filtered.filter(d => d.side === 'SELL').length
    return { buyCount: b, sellCount: s, sentiment: b + s === 0 ? 0.5 : b / (b + s) }
  }, [filtered])

  const unusualDeals = useMemo(
    () => filtered.filter(d => d.unusualFlag || d.smartMoneyScore >= 70).slice(0, 5),
    [filtered],
  )

  const hasData   = deals.length > 0
  const showError = !!error && !hasData

  return (
    <div className="panel" style={{ height:'100%', display:'flex', flexDirection:'column', fontFamily:'JetBrains Mono,monospace' }}>
      <style>{`
        .idl-row { transition: background 0.1s; }
        .idl-row:hover { background: rgba(255,255,255,0.025) !important; }
        .idl-row-alt { background: rgba(255,255,255,0.008); }
      `}</style>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ flexShrink:0, justifyContent:'space-between', flexWrap:'wrap', gap:'5px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div className="dot" style={{ background:'#38bdf8', flexShrink:0 }} />
          <span style={{ fontSize:'10px', letterSpacing:'0.12em', fontWeight:700 }}>INSIDER &amp; BLOCK DEALS</span>
          {stats?.high ? (
            <span style={{ fontSize:'7px', padding:'2px 6px', borderRadius:'2px', fontWeight:700, background:'rgba(239,68,68,0.15)', color:'#ef4444', border:'1px solid rgba(239,68,68,0.3)' }}>
              🔥 {stats.high} HIGH-VALUE
            </span>
          ) : null}
          {clusters.length > 0 && (
            <span style={{ fontSize:'7px', padding:'2px 6px', borderRadius:'2px', fontWeight:700, background:'rgba(0,229,192,0.12)', color:'var(--teal)', border:'1px solid rgba(0,229,192,0.3)' }}>
              ◈ {clusters.length} CLUSTER{clusters.length===1?'':'S'}
            </span>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
          <div style={{ display:'flex', gap:'2px' }}>
            {(['deals','intelligence'] as ViewMode[]).map(v => (
              <button key={v} onClick={() => setViewMode(v)} style={{
                padding:'2px 8px', borderRadius:'3px', cursor:'pointer', fontSize:'8px',
                border:`1px solid ${viewMode===v?'#38bdf8':'var(--border)'}`,
                background: viewMode===v?'rgba(56,189,248,0.1)':'transparent',
                color: viewMode===v?'#38bdf8':'var(--text-muted)',
                fontFamily:'JetBrains Mono,monospace',
              }}>
                {v === 'deals' ? '≡ DEALS' : '◈ INTEL'}
              </button>
            ))}
          </div>
          {lastUp && <span style={{ fontSize:'7px', color:'var(--text-muted)' }}>Updated {lastUp}</span>}
          <button onClick={() => mutate()} disabled={isValidating} style={{
            fontSize:'8px', padding:'2px 8px', borderRadius:'3px', cursor:'pointer',
            border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)',
          }}>
            {isValidating ? '···' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Stats / Sentiment bar ────────────────────────────────────────────── */}
      {stats && hasData && (
        <div style={{ padding:'6px 14px', borderBottom:'1px solid var(--border)', flexShrink:0, display:'flex', alignItems:'center', gap:'0' }}>
          <div style={{ flex:1, marginRight:'14px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'3px' }}>
              <span style={{ fontSize:'8px', color:'#00c97a' }}>▲ BUY {buyCount}</span>
              <span style={{ fontSize:'8px', color:'var(--text-muted)' }}>SENTIMENT</span>
              <span style={{ fontSize:'8px', color:'#ef4444' }}>SELL {sellCount} ▼</span>
            </div>
            <div style={{ height:'4px', borderRadius:'2px', background:'rgba(239,68,68,0.3)', overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${sentiment*100}%`, background:'#00c97a', borderRadius:'2px', transition:'width 0.5s' }} />
            </div>
          </div>
          {[
            { l:'SHOWING', v:filtered.length, c:'' },
            { l:'US',      v:stats.us,        c:'#60a5fa' },
            { l:'INDIA',   v:stats.india,     c:'#f97316' },
            { l:'HIGH',    v:stats.high,      c:'#ef4444' },
          ].map(s => (
            <div key={s.l} style={{ textAlign:'center', paddingLeft:'10px', borderLeft:'1px solid var(--border)' }}>
              <div style={{ fontSize:'15px', fontWeight:900, fontFamily:'Syne,sans-serif', color: s.c || '#fff', lineHeight:1 }}>{s.v}</div>
              <div style={{ fontSize:'7px', color:'var(--text-muted)', letterSpacing:'0.07em' }}>{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      {viewMode === 'deals' && (
        <div style={{ padding:'6px 12px', borderBottom:'1px solid var(--border)', flexShrink:0, display:'flex', gap:'4px', alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:'2px' }}>
            {(['ALL','US','IN'] as Market[]).map(m => (
              <button key={m} onClick={() => handleMarketChange(m)} style={{
                padding:'2px 8px', borderRadius:'3px', cursor:'pointer', fontSize:'8px',
                border:`1px solid ${market===m?'#38bdf8':'var(--border)'}`,
                background: market===m?'rgba(56,189,248,0.12)':'transparent',
                color: market===m?'#38bdf8':'var(--text-muted)',
                fontFamily:'JetBrains Mono,monospace',
              }}>
                {m==='ALL'?'🌐 ALL':m==='US'?'🇺🇸 US':'🇮🇳 INDIA'}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:'2px' }}>
            {(['ALL','insider','bulk','block'] as DealType[]).map(t => (
              <button key={t} onClick={() => setDtype(t)} style={{
                padding:'2px 8px', borderRadius:'3px', cursor:'pointer', fontSize:'8px',
                border:`1px solid ${dtype===t?'var(--teal)':'var(--border)'}`,
                background: dtype===t?'rgba(0,201,122,0.1)':'transparent',
                color: dtype===t?'var(--teal)':'var(--text-muted)',
                fontFamily:'JetBrains Mono,monospace',
              }}>
                {t==='ALL'?'ALL':TYPE_META[t as Exclude<DealType,'ALL'>].icon+' '+t.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ display:'flex', gap:'2px' }}>
            {(['ALL','high','medium'] as SigFilter[]).map(s => (
              <button key={s} onClick={() => setSigF(s)} style={{
                padding:'2px 8px', borderRadius:'3px', cursor:'pointer', fontSize:'8px',
                border:`1px solid ${sigF===s?'#f0a500':'var(--border)'}`,
                background: sigF===s?'rgba(240,165,0,0.1)':'transparent',
                color: sigF===s?'#f0a500':'var(--text-muted)',
                fontFamily:'JetBrains Mono,monospace',
              }}>
                {s==='ALL'?'ALL SIG':s.toUpperCase()+' SIG'}
              </button>
            ))}
          </div>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if(e.key==='Escape') setSearch('') }}
            placeholder="Search symbol / company / person…"
            style={{
              flex:1, minWidth:'90px', background:'var(--bg-deep)',
              border:`1px solid ${search?'rgba(56,189,248,0.4)':'var(--border)'}`,
              borderRadius:'4px', padding:'3px 8px', color:'#fff', fontSize:'9px',
              fontFamily:'JetBrains Mono,monospace', outline:'none',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ padding:'2px 6px', borderRadius:'3px', cursor:'pointer', border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', fontSize:'10px' }}>✕</button>
          )}
          <span style={{ fontSize:'8px', color:'var(--text-muted)', whiteSpace:'nowrap' }}>
            {filtered.length}/{deals.length}
          </span>
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto' }}>

        {isLoading && !hasData && (
          <div style={{ padding:'32px', textAlign:'center', color:'var(--text-muted)', fontSize:'11px', letterSpacing:'0.1em' }}>
            <div style={{ marginBottom:'8px' }}>FETCHING DEAL DATA…</div>
            <div style={{ fontSize:'9px' }}>
              {market==='US'?'Loading SEC Form 4 data — S&P 500 coverage':
               market==='IN'?'Loading NSE archive CSV + BSE official APIs':
               'Loading US + India deals simultaneously'}
            </div>
          </div>
        )}

        {showError && (
          <div style={{ padding:'24px', textAlign:'center', fontSize:'10px' }}>
            <div style={{ color:'#ef4444', marginBottom:'6px' }}>
              ⚠ Failed to load deals
            </div>
            <div style={{ color:'var(--text-muted)', marginBottom:'10px' }}>
              {String((error as Error).message || 'Network error')}
            </div>
            <button onClick={() => mutate()} style={{
              padding:'4px 10px', borderRadius:'3px', cursor:'pointer', fontSize:'9px',
              border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)',
            }}>↺ Retry</button>
          </div>
        )}

        {/* ═══ INTELLIGENCE VIEW ═════════════════════════════════════════════ */}
        {!isLoading && !showError && viewMode === 'intelligence' && (
          <div style={{ padding:'12px', display:'flex', flexDirection:'column', gap:'12px' }}>

            {/* Capital flow — split by currency (the old buggy single-USD box) */}
            {stats && (
              <div>
                <div style={{ fontSize:'8px', color:'var(--text-muted)', letterSpacing:'0.12em', marginBottom:'8px' }}>
                  CAPITAL FLOW SUMMARY
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px', marginBottom:'6px' }}>
                  <div style={{ padding:'10px', borderRadius:'5px', background:'rgba(0,201,122,0.06)', border:'1px solid rgba(0,201,122,0.2)' }}>
                    <div style={{ fontSize:'7px', color:'var(--text-muted)', marginBottom:'4px', letterSpacing:'0.1em' }}>🇺🇸 US BOUGHT</div>
                    <div style={{ fontSize:'16px', fontWeight:900, color:'#00c97a', fontFamily:'Syne,sans-serif', lineHeight:1 }}>
                      {fmt(stats.usdValueBought, 'USD')}
                    </div>
                    <div style={{ fontSize:'7px', color:'var(--text-muted)', marginTop:'2px' }}>vs sold {fmt(stats.usdValueSold, 'USD')}</div>
                  </div>
                  <div style={{ padding:'10px', borderRadius:'5px', background:'rgba(0,201,122,0.06)', border:'1px solid rgba(0,201,122,0.2)' }}>
                    <div style={{ fontSize:'7px', color:'var(--text-muted)', marginBottom:'4px', letterSpacing:'0.1em' }}>🇮🇳 INDIA BOUGHT</div>
                    <div style={{ fontSize:'16px', fontWeight:900, color:'#00c97a', fontFamily:'Syne,sans-serif', lineHeight:1 }}>
                      {fmt(stats.inrValueBought, 'INR')}
                    </div>
                    <div style={{ fontSize:'7px', color:'var(--text-muted)', marginTop:'2px' }}>vs sold {fmt(stats.inrValueSold, 'INR')}</div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ CLUSTER SIGNALS — the Bloomberg-beater USP ═══════════════ */}
            {clusters.length > 0 && (
              <div>
                <div style={{ fontSize:'8px', color:'var(--teal)', letterSpacing:'0.12em', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                  ◈ CLUSTER SIGNALS
                  <span style={{ color:'var(--text-muted)', fontSize:'7px' }}>3+ distinct buyers on same stock</span>
                </div>
                {clusters.map(c => {
                  const isBuy = c.side === 'BUY'
                  return (
                    <div key={`${c.market}-${c.symbol}-${c.side}`} style={{
                      padding:'8px 10px', marginBottom:'4px', borderRadius:'5px',
                      background: isBuy ? 'rgba(0,201,122,0.08)' : 'rgba(239,68,68,0.08)',
                      border: `1px solid ${isBuy ? 'rgba(0,201,122,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                          <span style={{ fontSize:'13px', fontWeight:900, color:'#fff', fontFamily:'Syne,sans-serif' }}>{c.symbol}</span>
                          <span style={{ fontSize:'9px' }}>{c.market==='US'?'🇺🇸':'🇮🇳'}</span>
                          <span style={{
                            fontSize:'7px', padding:'2px 6px', borderRadius:'2px', fontWeight:700, letterSpacing:'0.1em',
                            background: isBuy ? 'rgba(0,201,122,0.18)' : 'rgba(239,68,68,0.18)',
                            color: isBuy ? '#00c97a' : '#ef4444',
                          }}>
                            {isBuy ? '▲ ACCUMULATION' : '▼ DISTRIBUTION'}
                          </span>
                          <span style={{ fontSize:'7px', color:'var(--text-muted)' }}>{c.sector}</span>
                        </div>
                        <div style={{ textAlign:'right' }}>
                          <div style={{ fontSize:'13px', fontWeight:900, color: isBuy?'#00c97a':'#ef4444', fontFamily:'Syne,sans-serif', lineHeight:1 }}>
                            {fmt(c.totalValue, c.currency)}
                          </div>
                          <div style={{ fontSize:'7px', color:'var(--text-muted)', marginTop:'2px' }}>
                            {c.uniqueBuyers} unique · avg score {c.avgScore}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize:'8px', color:'var(--text-muted)', display:'flex', flexWrap:'wrap', gap:'4px' }}>
                        {c.deals.slice(0, 3).map(d => (
                          <span key={d.id} style={{
                            padding:'1px 5px', borderRadius:'2px',
                            background:'rgba(255,255,255,0.04)', border:'1px solid var(--border)',
                          }}>
                            {d.person.slice(0, 22)}{d.person.length > 22 ? '…' : ''}
                          </span>
                        ))}
                        {c.deals.length > 3 && (
                          <span style={{ color:'var(--text-muted)' }}>+{c.uniqueBuyers - 3} more</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Unusual / high smart-money deals */}
            {unusualDeals.length > 0 && (
              <div>
                <div style={{ fontSize:'8px', color:'#ef4444', letterSpacing:'0.12em', marginBottom:'8px', display:'flex', alignItems:'center', gap:'6px' }}>
                  🔥 UNUSUAL SMART MONEY ACTIVITY
                  <span style={{ color:'var(--text-muted)', fontSize:'7px' }}>Score ≥ 70 / High significance</span>
                </div>
                {unusualDeals.map(d => {
                  const isBuy = d.side === 'BUY'
                  const tm    = TYPE_META[d.type]
                  return (
                    <div key={d.id} onClick={() => d.url && window.open(d.url,'_blank')} style={{
                      padding:'8px 10px', marginBottom:'4px', borderRadius:'5px', cursor:'pointer',
                      background: isBuy ? 'rgba(0,201,122,0.06)' : 'rgba(239,68,68,0.06)',
                      border:`1px solid ${isBuy?'rgba(0,201,122,0.25)':'rgba(239,68,68,0.25)'}`,
                      display:'flex', justifyContent:'space-between', alignItems:'flex-start',
                    }}>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'3px' }}>
                          <span style={{ fontSize:'12px', fontWeight:900, color:'#fff', fontFamily:'Syne,sans-serif' }}>{d.symbol}</span>
                          <span style={{ fontSize:'7px', padding:'1px 5px', borderRadius:'2px', background: tm.bg, color: tm.color }}>{tm.icon} {d.type.toUpperCase()}</span>
                          <span style={{ fontSize:'10px' }}>{d.market==='US'?'🇺🇸':'🇮🇳'}</span>
                        </div>
                        <div style={{ fontSize:'9px', color:'var(--text-muted)' }}>{d.person.slice(0,35)} · {d.role}</div>
                        <SmartBar score={d.smartMoneyScore} />
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        <div style={{ fontSize:'14px', fontWeight:900, color: isBuy?'#00c97a':'#ef4444', fontFamily:'Syne,sans-serif' }}>
                          {d.valueFmt}
                        </div>
                        <div style={{ fontSize:'8px', color:'var(--text-muted)' }}>{timeAgo(d.daysAgo)}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Sector intelligence — grouped by currency now */}
            {sectorIntel.length > 0 && (
              <div>
                <div style={{ fontSize:'8px', color:'var(--text-muted)', letterSpacing:'0.12em', marginBottom:'8px' }}>
                  SECTOR FLOW INTELLIGENCE
                </div>
                {sectorIntel.map(s => {
                  const total  = s.netBuys + s.netSells
                  const buyPct = total > 0 ? (s.netBuys / total) * 100 : 50
                  const sigColor = s.signal==='accumulation' ? '#00c97a'
                                 : s.signal==='distribution' ? '#ef4444'
                                 : '#f0a500'
                  return (
                    <div key={`${s.sector}-${s.currency}`} style={{ marginBottom:'8px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'3px' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                          <span style={{ fontSize:'10px', color:'#fff', fontFamily:'Syne,sans-serif', fontWeight:700 }}>{s.sector}</span>
                          <span style={{ fontSize:'7px', color:'var(--text-muted)' }}>{s.currency==='USD'?'🇺🇸':'🇮🇳'}</span>
                          <span style={{
                            fontSize:'7px', padding:'1px 5px', borderRadius:'2px', fontWeight:700,
                            background: sigColor+'18', color: sigColor, border:`1px solid ${sigColor}33`,
                            fontFamily:'JetBrains Mono,monospace',
                          }}>
                            {s.signal.toUpperCase()}
                          </span>
                        </div>
                        <div style={{ display:'flex', gap:'8px', fontSize:'8px', fontFamily:'JetBrains Mono,monospace' }}>
                          <span style={{ color:'#00c97a' }}>▲ {fmt(s.netBuys, s.currency)}</span>
                          <span style={{ color:'#ef4444' }}>▼ {fmt(s.netSells, s.currency)}</span>
                        </div>
                      </div>
                      <div style={{ height:'6px', borderRadius:'3px', background:'rgba(239,68,68,0.25)', overflow:'hidden' }}>
                        <div style={{ height:'100%', width:`${buyPct}%`, background:'rgba(0,201,122,0.7)', borderRadius:'3px', transition:'width 0.5s' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {sectorIntel.length === 0 && clusters.length === 0 && unusualDeals.length === 0 && (
              <div style={{ textAlign:'center', color:'var(--text-muted)', fontSize:'10px', padding:'20px' }}>
                No intelligence signals yet. Load deals first.
              </div>
            )}
          </div>
        )}

        {/* ═══ DEALS VIEW ══════════════════════════════════════════════════ */}
        {!isLoading && !showError && viewMode === 'deals' && (
          <>
            {filtered.length === 0 && (
              <div style={{ padding:'24px', textAlign:'center', color:'var(--text-muted)', fontSize:'10px' }}>
                {deals.length === 0
                  ? `No deals fetched for ${market} market. Upstream sources may be unavailable.`
                  : search
                  ? `No deals match "${search}". Try clearing the search.`
                  : 'No deals match the current filters.'}
              </div>
            )}

            {filtered.map((d, i) => (
              <DealRow key={d.id} deal={d} alt={i % 2 === 1} />
            ))}
          </>
        )}
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div style={{
        padding:'4px 12px', borderTop:'1px solid var(--border)', flexShrink:0,
        fontSize:'7px', color:'var(--text-muted)', display:'flex',
        justifyContent:'space-between', flexWrap:'wrap', gap:'4px',
      }}>
        <span>{sources.length > 0 ? sources.join(' · ') : 'Waiting for data…'}</span>
        <span>US: Form 4 (S&P 500) · India: NSE Archive CSV + BSE · 15m cache</span>
      </div>
    </div>
  )
}

// ── Row extracted so React can skip unchanged rows ───────────────────────────
function DealRow({ deal, alt }: { deal: InsiderDeal; alt: boolean }) {
  const tm    = TYPE_META[deal.type]
  const sm    = SIG_META[deal.significance]
  const rc    = roleColor(deal.role)
  const isBuy = deal.side === 'BUY'
  const highSM = deal.smartMoneyScore >= 70

  return (
    <div
      className={`idl-row ${alt ? 'idl-row-alt' : ''}`}
      onClick={() => deal.url && window.open(deal.url,'_blank')}
      style={{
        padding:'9px 14px', borderBottom:'1px solid var(--border)',
        cursor: deal.url ? 'pointer' : 'default',
        borderLeft:`3px solid ${isBuy?'rgba(0,201,122,0.45)':'rgba(239,68,68,0.45)'}`,
      }}
    >
      {/* Row 1: badges + time */}
      <div style={{ display:'flex', alignItems:'center', gap:'4px', marginBottom:'5px', flexWrap:'wrap' }}>
        <span style={{
          fontSize:'8px', padding:'2px 8px', borderRadius:'3px', fontWeight:900, letterSpacing:'0.1em',
          background: isBuy?'rgba(0,201,122,0.15)':'rgba(239,68,68,0.15)',
          color: isBuy?'#00c97a':'#ef4444',
          border:`1px solid ${isBuy?'rgba(0,201,122,0.3)':'rgba(239,68,68,0.3)'}`,
        }}>
          {isBuy ? '▲ BUY' : '▼ SELL'}
        </span>
        <span style={{ fontSize:'7px', padding:'2px 6px', borderRadius:'2px', background:tm.bg, color:tm.color, border:`1px solid ${tm.color}28` }}>
          {tm.icon} {tm.label}
        </span>
        <span style={{ fontSize:'10px' }}>{deal.market==='US'?'🇺🇸':'🇮🇳'}</span>
        <span style={{
          fontSize:'7px', padding:'2px 6px', borderRadius:'2px', fontWeight:700,
          background:sm.bg, color:sm.color, border:`1px solid ${sm.border}`,
        }}>
          {sm.label}
        </span>
        {highSM && (
          <span style={{
            fontSize:'7px', padding:'2px 6px', borderRadius:'2px', fontWeight:700,
            background:'rgba(0,229,192,0.1)', color:'var(--teal)',
            border:'1px solid rgba(0,229,192,0.25)',
          }}>
            ◈ SMART MONEY
          </span>
        )}
        {deal.unusualFlag && <span style={{ fontSize:'8px', color:'#ef4444' }}>🔥</span>}
        <span style={{ marginLeft:'auto', fontSize:'7px', color:'var(--text-muted)' }}>
          {timeAgo(deal.daysAgo)} · {deal.dateFmt}
        </span>
      </div>

      {/* Row 2: symbol + value */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'4px', gap:'8px' }}>
        <div style={{ minWidth:0 }}>
          <span style={{ fontSize:'15px', fontWeight:900, color:'#fff', fontFamily:'Syne,sans-serif' }}>
            {deal.symbol}
          </span>
          {deal.company !== deal.symbol && (
            <span style={{ fontSize:'9px', color:'var(--text-muted)', marginLeft:'6px' }}>
              {deal.company.slice(0,28)}{deal.company.length>28?'…':''}
            </span>
          )}
          {deal.sector && deal.sector !== 'Other' && (
            <span style={{
              marginLeft:'6px', fontSize:'7px', padding:'1px 5px', borderRadius:'2px',
              background:'rgba(74,96,112,0.2)', color:'var(--text-muted)',
              fontFamily:'JetBrains Mono,monospace',
            }}>
              {deal.sector}
            </span>
          )}
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontSize:'18px', fontWeight:900, color: isBuy?'#00c97a':'#ef4444', fontFamily:'Syne,sans-serif', lineHeight:1 }}>
            {deal.valueFmt}
          </div>
          {deal.shares && (
            <div style={{ fontSize:'8px', color:'var(--text-muted)' }}>
              {deal.shares.toLocaleString(deal.market==='IN'?'en-IN':'en-US')} shares
              {deal.price ? ` @ ${deal.currency==='INR'?'₹':'$'}${deal.price.toFixed(2)}` : ''}
            </div>
          )}
        </div>
      </div>

      {/* Row 3: person + role + smart money bar */}
      <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
        <span style={{
          fontSize:'7px', padding:'2px 7px', borderRadius:'2px',
          background:`${rc}15`, color:rc, border:`1px solid ${rc}28`, fontWeight:700,
        }}>
          {deal.role}
        </span>
        <span style={{ fontSize:'9px', color:'var(--text-muted)', flex:1, minWidth:0, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
          {deal.person.length>40 ? deal.person.slice(0,40)+'…' : deal.person}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:'3px', flexShrink:0 }}>
          <div style={{
            width:'30px', height:'3px', borderRadius:'2px',
            background:'var(--bg-deep)', overflow:'hidden',
          }}>
            <div style={{
              height:'100%', width:`${deal.smartMoneyScore}%`,
              background: smColor(deal.smartMoneyScore), borderRadius:'2px',
            }} />
          </div>
          <span style={{ fontSize:'7px', color: smColor(deal.smartMoneyScore), fontFamily:'JetBrains Mono,monospace' }}>
            {deal.smartMoneyScore}
          </span>
        </div>
      </div>
    </div>
  )
}