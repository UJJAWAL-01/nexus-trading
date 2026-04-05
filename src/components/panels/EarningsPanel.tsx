'use client'

import { useEffect, useState } from 'react'
import { useWatchlist } from '@/store/watchlist'

// ── Types ─────────────────────────────────────────────────────────────────────

interface EarningsObs {
  end:          string
  value:        number
  form?:        string
  filed?:       string
  epsEstimate?: number
  epsSurprise?: number
}

interface StockEarnings {
  ticker:      string
  cik?:        string
  companyName?: string
  eps:         EarningsObs[]
  revenue:     EarningsObs[]
  net:         EarningsObs[]
  cashFlow:    EarningsObs[]
  source?:     string
  error?:      string
  aiInsight?:  string | null
  loadingAI?:  boolean
  loading?:    boolean
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtBig(v: number, currency = 'USD'): string {
  const sym = currency === 'INR' ? '₹' : currency === 'GBP' ? '£' : '$'
  const av   = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (av >= 1e12) return `${sign}${sym}${(av / 1e12).toFixed(2)}T`
  if (av >= 1e9)  return `${sign}${sym}${(av / 1e9).toFixed(2)}B`
  if (av >= 1e6)  return `${sign}${sym}${(av / 1e6).toFixed(1)}M`
  if (av >= 1e3)  return `${sign}${sym}${(av / 1e3).toFixed(1)}K`
  return `${sign}${sym}${av.toFixed(2)}`
}

function fmtDate(s: string): string {
  if (!s) return ''
  // Handle "Q1 2024", "Dec 2023", ISO dates
  if (s.includes('Q')) return s
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s.slice(0, 7)
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
  } catch { return s.slice(0, 7) }
}

function growthPct(curr: number, prev: number | undefined): number | null {
  if (prev == null || prev === 0) return null
  return ((curr - prev) / Math.abs(prev)) * 100
}

// ── Mini growth bar ───────────────────────────────────────────────────────────

function GrowthBar({ curr, prev }: { curr: number; prev: number | undefined }) {
  const g = growthPct(curr, prev)
  if (g == null) return <span style={{ width: '72px' }} />
  const w   = Math.min(Math.abs(g), 100)
  const pos = g >= 0
  return (
    <span style={{ display:'flex', alignItems:'center', gap:'4px', minWidth:'72px' }}>
      <span style={{ display:'inline-block', width:'30px', height:'3px', background:'var(--border)', borderRadius:'2px', overflow:'hidden', flexShrink:0 }}>
        <span style={{ display:'block', width:`${w}%`, height:'100%', borderRadius:'2px', background: pos?'var(--positive)':'var(--negative)' }} />
      </span>
      <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'8px', color: pos?'var(--positive)':'var(--negative)', minWidth:'36px' }}>
        {pos?'+':''}{g.toFixed(1)}%
      </span>
    </span>
  )
}

// ── EarningsPanel ─────────────────────────────────────────────────────────────

export default function EarningsPanel() {
  const { symbols }    = useWatchlist()
  const [stocks,   setStocks]   = useState<StockEarnings[]>([])
  const [loading,  setLoading]  = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [aiQueue,  setAiQueue]  = useState<string[]>([])
  const [tab,      setTab]      = useState<'eps'|'rev'|'net'|'cf'>('eps')

  // ── Fetch all tickers ──────────────────────────────────────────────────────

  useEffect(() => {
    if (symbols.length === 0) { setLoading(false); return }

    // Show loading skeletons immediately
    setLoading(true)
    setStocks(symbols.map(t => ({ ticker:t, eps:[], revenue:[], net:[], cashFlow:[], loading:true })))

    // Fetch one by one (EDGAR + Yahoo have rate limits)
    const fetchAll = async () => {
      const results: StockEarnings[] = []

      for (const ticker of symbols) {
        try {
          const res = await fetch(`/api/edgar?ticker=${encodeURIComponent(ticker)}`)
          const d   = await res.json()

          results.push({
            ticker,
            cik:         d.cik,
            companyName: d.companyName ?? ticker,
            eps:         d.eps     ?? [],
            revenue:     d.revenue ?? [],
            net:         d.net     ?? [],
            cashFlow:    d.cashFlow ?? [],
            source:      d.source  ?? 'Unknown',
            error:       d.error,
            loading:     false,
          })
        } catch {
          results.push({ ticker, eps:[], revenue:[], net:[], cashFlow:[], error:'Fetch failed', loading:false })
        }

        // Update incrementally so user sees results as they load
        setStocks([...results, ...symbols.slice(results.length).map(t => ({
          ticker: t, eps:[], revenue:[], net:[], cashFlow:[], loading:true,
        }))])
      }

      setLoading(false)
      if (!selected && results.length > 0) setSelected(results[0].ticker)

      // Queue AI for stocks with actual data
      setAiQueue(results.filter(r => (r.eps?.length ?? 0) > 0 || (r.revenue?.length ?? 0) > 0).map(r => r.ticker))
    }

    fetchAll()
  }, [symbols.join(',')]) // eslint-disable-line

  // ── AI queue (serial, rate-limited) ──────────────────────────────────────

  useEffect(() => {
    if (aiQueue.length === 0) return
    const [ticker, ...rest] = aiQueue
    const s = stocks.find(x => x.ticker === ticker)
    if (!s || s.aiInsight !== undefined || s.loading) { setAiQueue(rest); return }

    setStocks(prev => prev.map(x => x.ticker === ticker ? { ...x, loadingAI:true } : x))

    const epsStr = s.eps?.slice(0, 4)
      .map(e => `${fmtDate(e.end)}: ${e.value >= 0 ? '$' : '-$'}${Math.abs(e.value).toFixed(2)}`)
      .join(', ') ?? ''
    const revStr = s.revenue?.slice(0, 4)
      .map(e => `${fmtDate(e.end)}: ${fmtBig(e.value)}`)
      .join(', ') ?? ''

    const isIndian = ticker.includes('.NS') || ticker.includes('.BO')
    const suffix   = isIndian ? ` (Indian stock, values in ₹ crore)` : ''

    fetch('/api/ai-context', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headline: `${ticker} ${s.companyName ?? ''} earnings trend${suffix}`,
        summary:  `EPS quarterly: ${epsStr}. Revenue: ${revStr}. Analyze growth trajectory, earnings quality, acceleration or deceleration, and key flags.`,
        watchlist: [ticker],
      }),
    })
      .then(r => r.json())
      .then(d => {
        setStocks(prev => prev.map(x =>
          x.ticker === ticker ? { ...x, aiInsight: d.context ?? null, loadingAI:false } : x,
        ))
        setTimeout(() => setAiQueue(rest), 1000)
      })
      .catch(() => {
        setStocks(prev => prev.map(x => x.ticker === ticker ? { ...x, loadingAI:false, aiInsight:null } : x))
        setAiQueue(rest)
      })
  }, [aiQueue]) // eslint-disable-line

  // ── Active data ───────────────────────────────────────────────────────────

  const active     = stocks.find(s => s.ticker === selected)
  const activeData = active
    ? tab==='eps' ? active.eps ?? []
    : tab==='rev' ? active.revenue ?? []
    : tab==='net' ? active.net ?? []
    : active.cashFlow ?? []
    : []

  const isIndian  = (selected ?? '').includes('.NS') || (selected ?? '').includes('.BO')
  const currency  = isIndian ? 'INR' : 'USD'

  const fmtVal = (v: number) => {
    if (v == null || isNaN(v)) return 'N/A'
    if (tab === 'eps') {
      const sym = isIndian ? '₹' : '$'
      return `${v < 0 ? '-' : ''}${sym}${Math.abs(v).toFixed(2)}`
    }
    return fmtBig(v, currency)
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="panel" style={{ height:'100%', display:'flex', flexDirection:'column' }}>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div className="dot" style={{ background:'#f0a500' }} />
          EARNINGS TRACKER
          <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace' }}>
            SEC EDGAR + Yahoo Finance · AI
          </span>
        </div>
        <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace' }}>
          US + Global
        </span>
      </div>

      {loading && stocks.every(s => s.loading) ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ color:'var(--text-muted)', fontSize:'11px', fontFamily:'JetBrains Mono, monospace' }}>
            FETCHING FINANCIAL DATA...
          </span>
        </div>
      ) : symbols.length === 0 ? (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <span style={{ color:'var(--text-muted)', fontSize:'11px', fontFamily:'JetBrains Mono, monospace' }}>
            Add stocks to your watchlist
          </span>
        </div>
      ) : (
        <div style={{ flex:1, display:'flex', minHeight:0 }}>

          {/* Left: ticker list */}
          <div style={{ width:'90px', flexShrink:0, borderRight:'1px solid var(--border)', overflowY:'auto' }}>
            {stocks.map(s => {
              const eps0 = s.eps?.[0]?.value
              const eps1 = s.eps?.[1]?.value
              const g    = growthPct(eps0 ?? 0, eps1)
              const hasData = (s.eps?.length ?? 0) > 0 || (s.revenue?.length ?? 0) > 0
              return (
                <div
                  key={s.ticker}
                  onClick={() => setSelected(s.ticker)}
                  style={{
                    padding:'7px 8px', cursor:'pointer',
                    borderBottom:'1px solid var(--border)',
                    background: selected===s.ticker ? 'rgba(240,165,0,0.07)' : 'transparent',
                    borderLeft: `2px solid ${selected===s.ticker ? 'var(--amber)' : 'transparent'}`,
                  }}
                >
                  <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'10px', color:'#fff' }}>
                    {s.ticker}
                  </div>
                  {s.loading ? (
                    <div style={{ fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace' }}>loading...</div>
                  ) : hasData ? (
                    <>
                      {eps0 != null && (
                        <div style={{ fontSize:'9px', fontFamily:'JetBrains Mono, monospace', color: eps0>=0?'var(--positive)':'var(--negative)' }}>
                          {eps0>=0?'+':''}{eps0.toFixed(2)}
                        </div>
                      )}
                      {g != null && (
                        <div style={{ fontSize:'8px', fontFamily:'JetBrains Mono, monospace', color: g>=0?'var(--positive)':'var(--negative)' }}>
                          {g>=0?'▲':'▼'} {Math.abs(g).toFixed(0)}%
                        </div>
                      )}
                      {s.source === 'Yahoo Finance' && (
                        <div style={{ fontSize:'7px', color:'#1e90ff', fontFamily:'JetBrains Mono, monospace', marginTop:'1px' }}>YF</div>
                      )}
                      {s.loadingAI && (
                        <div style={{ fontSize:'8px', color:'var(--teal)', fontFamily:'JetBrains Mono, monospace' }}>◆ AI</div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize:'8px', color:'var(--negative)', fontFamily:'JetBrains Mono, monospace' }}>
                      {s.error?.includes('unavailable') ? 'N/A' : 'err'}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Right: detail */}
          <div style={{ flex:1, overflow:'hidden', display:'flex', flexDirection:'column', minWidth:0 }}>
            {!active ? (
              <div style={{ padding:'16px', color:'var(--text-muted)', fontSize:'10px', fontFamily:'JetBrains Mono, monospace' }}>
                Select a stock →
              </div>
            ) : active.loading ? (
              <div style={{ padding:'16px', color:'var(--text-muted)', fontSize:'10px', fontFamily:'JetBrains Mono, monospace' }}>
                Loading {active.ticker}...
              </div>
            ) : active.error && !activeData.length ? (
              <div style={{ padding:'14px' }}>
                <div style={{ color:'var(--negative)', fontSize:'10px', fontFamily:'JetBrains Mono, monospace', marginBottom:'4px' }}>
                  {active.error}
                </div>
                <div style={{ color:'var(--text-muted)', fontSize:'9px', fontFamily:'JetBrains Mono, monospace', lineHeight:1.5 }}>
                  Financial data may not be available for this symbol via our free data sources.
                </div>
              </div>
            ) : (
              <>
                {/* Company name + source + tabs */}
                <div style={{ padding:'7px 10px', borderBottom:'1px solid var(--border)', flexShrink:0 }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'4px' }}>
                    <div style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'11px', color:'#fff' }}>
                      {active.companyName || active.ticker}
                    </div>
                    <span style={{
                      fontSize:'8px', padding:'1px 5px', borderRadius:'2px',
                      fontFamily:'JetBrains Mono, monospace',
                      background: active.source==='SEC EDGAR' ? 'rgba(0,201,122,0.12)' : 'rgba(30,144,255,0.12)',
                      color:      active.source==='SEC EDGAR' ? 'var(--positive)' : '#1e90ff',
                      border:     `1px solid ${active.source==='SEC EDGAR' ? 'rgba(0,201,122,0.3)' : 'rgba(30,144,255,0.3)'}`,
                    }}>
                      {active.source ?? 'Data'}
                    </span>
                  </div>
                  <div style={{ display:'flex', gap:'3px' }}>
                    {([['eps','EPS'],['rev','Revenue'],['net','Net Inc.'],['cf','Op.CF']] as const).map(([t,lbl])=>(
                      <button key={t} onClick={()=>setTab(t)} style={{
                        padding:'1px 7px', borderRadius:'3px', cursor:'pointer',
                        fontFamily:'JetBrains Mono, monospace', fontSize:'9px',
                        border:`1px solid ${tab===t?'var(--amber)':'var(--border)'}`,
                        background: tab===t?'rgba(240,165,0,0.12)':'transparent',
                        color: tab===t?'var(--amber)':'var(--text-muted)',
                      }}>{lbl}</button>
                    ))}
                  </div>
                </div>

                {/* Data rows */}
                <div style={{ flex:1, overflowY:'auto' }}>
                  {activeData.length === 0 ? (
                    <div style={{ padding:'12px', color:'var(--text-muted)', fontSize:'10px', fontFamily:'JetBrains Mono, monospace' }}>
                      No {tab.toUpperCase()} data available
                    </div>
                  ) : (
                    activeData.slice(0, 8).map((obs, i) => {
                      const prev = activeData[i+1]?.value
                      const isPos = obs.value >= 0
                      return (
                        <div key={i} style={{
                          display:'grid', gridTemplateColumns:'48px 1fr auto',
                          alignItems:'center', padding:'5px 10px',
                          borderBottom:'1px solid var(--border)', gap:'6px',
                        }}>
                          <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace' }}>
                            {fmtDate(obs.end)}
                          </span>
                          <div>
                            <span style={{
                              fontSize:'11px', fontFamily:'JetBrains Mono, monospace', fontWeight:700,
                              color: isPos ? (tab==='eps'?'var(--positive)':'var(--text-2)') : 'var(--negative)',
                            }}>
                              {fmtVal(obs.value)}
                            </span>
                            {/* EPS beat/miss badge */}
                            {tab==='eps' && obs.epsEstimate != null && obs.epsSurprise != null && (
                              <span style={{
                                marginLeft:'6px', fontSize:'8px', padding:'1px 4px', borderRadius:'2px',
                                fontFamily:'JetBrains Mono, monospace',
                                background: obs.epsSurprise>=0 ? 'rgba(0,201,122,0.15)' : 'rgba(255,69,96,0.15)',
                                color:      obs.epsSurprise>=0 ? 'var(--positive)' : 'var(--negative)',
                              }}>
                                {obs.epsSurprise>=0?'▲ BEAT':'▼ MISS'} est ${obs.epsEstimate.toFixed(2)}
                              </span>
                            )}
                          </div>
                          <GrowthBar curr={obs.value} prev={prev} />
                        </div>
                      )
                    })
                  )}

                  {/* AI insight */}
                  {active.loadingAI && (
                    <div style={{ padding:'8px 10px', fontSize:'9px', color:'var(--teal)', fontFamily:'JetBrains Mono, monospace' }}>
                      ◆ Groq analyzing filings...
                    </div>
                  )}
                  {active.aiInsight && (
                    <div style={{
                      margin:'8px 8px', padding:'7px 10px',
                      fontSize:'9px', color:'var(--teal)', fontFamily:'JetBrains Mono, monospace',
                      lineHeight:1.65, background:'rgba(0,229,192,0.04)',
                      borderLeft:'2px solid rgba(0,229,192,0.4)', borderRadius:'0 3px 3px 0',
                    }}>
                      ◆ {active.aiInsight}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}