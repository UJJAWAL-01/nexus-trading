'use client'
// src/components/panels/OptionsPanel.tsx
// US:  Yahoo Finance (crumb auth) → CBOE CDN fallback → stale cache
// IN:  NSE India real-time → stale cache with age indicator
// All BSM / Newton-Raphson IV / Greeks computed CLIENT-SIDE

import { useEffect, useState, useCallback, useRef } from 'react'

// ── Client-side BSM + Newton-Raphson IV ───────────────────────────────────────
function normcdf(x: number): number {
  const a = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429]
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const poly = t * (a[0] + t * (a[1] + t * (a[2] + t * (a[3] + t * a[4]))))
  const cdf  = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * poly
  return x >= 0 ? cdf : 1 - cdf
}

function bsmPrice(S: number, K: number, T: number, r: number, sigma: number, type: 'call'|'put'): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return Math.max(type === 'call' ? S - K : K - S, 0)
  const sqT = Math.sqrt(T)
  const d1  = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqT)
  const d2  = d1 - sigma * sqT
  return type === 'call'
    ? S * normcdf(d1) - K * Math.exp(-r * T) * normcdf(d2)
    : K * Math.exp(-r * T) * normcdf(-d2) - S * normcdf(-d1)
}

function calcIV(price: number, S: number, K: number, T: number, r: number, type: 'call'|'put'): number {
  if (price <= 0 || S <= 0 || K <= 0 || T <= 0) return 0
  const intrinsic = type === 'call'
    ? Math.max(S - K * Math.exp(-r * T), 0)
    : Math.max(K * Math.exp(-r * T) - S, 0)
  if (price <= intrinsic) return 0

  // Newton-Raphson
  let sigma = Math.min(Math.max(price / S * Math.sqrt(2 * Math.PI / T), 0.05), 3)
  for (let i = 0; i < 200; i++) {
    const p    = bsmPrice(S, K, T, r, sigma, type)
    const diff = p - price
    if (Math.abs(diff) < 1e-7) return sigma
    const d1   = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T))
    const vega = S * Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI) * Math.sqrt(T)
    if (vega < 1e-10) break
    sigma -= diff / vega
    if (sigma <= 0) sigma = 0.001
    if (sigma > 20) sigma = 20
  }
  return sigma > 0 && sigma < 20 ? sigma : 0
}

function calcGreeks(S: number, K: number, T: number, r: number, sigma: number, type: 'call'|'put') {
  if (T <= 0 || sigma <= 0 || S <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0 }
  const sqT  = Math.sqrt(T)
  const d1   = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqT)
  const d2   = d1 - sigma * sqT
  const nd1  = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI)
  const Er   = Math.exp(-r * T)
  const delta = type === 'call' ? normcdf(d1) : normcdf(d1) - 1
  const gamma = nd1 / (S * sigma * sqT)
  const vega  = S * nd1 * sqT / 100       // per 1% vol move
  const theta = type === 'call'
    ? (-(S * nd1 * sigma) / (2 * sqT) - r * K * Er * normcdf(d2)) / 365
    : (-(S * nd1 * sigma) / (2 * sqT) + r * K * Er * normcdf(-d2)) / 365
  return {
    delta: +delta.toFixed(4),
    gamma: +gamma.toFixed(6),
    theta: +theta.toFixed(4),
    vega:  +vega.toFixed(4),
  }
}

function calcMaxPain(chain: ChainRow[]): number {
  if (!chain.length) return 0
  let minLoss = Infinity, mp = 0
  for (const { strike: s } of chain) {
    let total = 0
    for (const r of chain) {
      total += (r.ce?.oi ?? 0) * Math.max(s - r.strike, 0)
               + (r.pe?.oi ?? 0) * Math.max(r.strike - s, 0)
    }
    if (total < minLoss) { minLoss = total; mp = s }
  }
  return mp
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Side {
  ltp: number; oi: number; oiChg: number; volume: number; iv: number
  bid: number; ask: number; delta: number; gamma: number; theta: number; vega: number
}
interface ChainRow    { strike: number; ce: Side|null; pe: Side|null }
interface OptionsData {
  symbol: string; market: 'US'|'IN'; spot: number
  expiries: string[]; selectedExpiry: string; chain: ChainRow[]
  callOI: number; putOI: number; pcr: number; lotSize: number
  riskFreeRate: number; source: string; hasGreeks: boolean
  staleData?: boolean; staleAgeStr?: string; staleAgeMins?: number
  error?: string; fetchedAt: string; chainCount?: number
}

// ── Symbol lists ──────────────────────────────────────────────────────────────
const US_SYMBOLS = [
  'SPX','NDX','RUT','VIX',
  'SPY','QQQ','IWM','GLD','TLT',
  'AAPL','MSFT','NVDA','TSLA','META','AMZN','GOOGL',
  'JPM','BAC','GS','XOM','AMD','NFLX','V','MA','GM',
]
const IN_SYMBOLS = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50']

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtNum(v: number, d = 0): string {
  if (!v || !isFinite(v)) return '—'
  const a = Math.abs(v)
  if (a >= 1e7) return (v/1e7).toFixed(1) + 'Cr'
  if (a >= 1e5) return (v/1e5).toFixed(1) + 'L'
  if (a >= 1e6) return (v/1e6).toFixed(1) + 'M'
  if (a >= 1e3) return (v/1e3).toFixed(0) + 'K'
  return v.toFixed(d)
}

function fmtExpiry(d: string): string {
  try {
    return new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC',
    })
  } catch { return d }
}

function yearsToExpiry(isoDate: string): number {
  const d = new Date(isoDate + 'T16:00:00Z')  // 4pm ET expiry
  return Math.max((d.getTime() - Date.now()) / (365 * 86400_000), 1/365)
}

function getNSEStatus() {
  const now = new Date()
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = ist.getDay()
  const h   = ist.getHours()
  const m   = ist.getMinutes()
  const s   = ist.getSeconds()
  const isOpen = day >= 1 && day <= 5 && (h > 9 || (h === 9 && m >= 15)) && (h < 15 || (h === 15 && m <= 30))
  const timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return { isOpen, timeStr }
}

type Tab = 'chain' | 'oi'

// ── Panel ─────────────────────────────────────────────────────────────────────
export default function OptionsPanel() {
  const [market,     setMarket]     = useState<'US'|'IN'>('US')
  const [symbol,     setSymbol]     = useState('SPY')
  const [symInput,   setSymInput]   = useState('SPY')
  const [expiry,     setExpiry]     = useState('')
  const [data,       setData]       = useState<OptionsData|null>(null)
  const [loading,    setLoading]    = useState(false)
  const [loadStep,   setLoadStep]   = useState(0)  // for progressive messages
  const [tab,        setTab]        = useState<Tab>('chain')
  const [showGreeks, setShowGreeks] = useState(false)
  const [showSug,    setShowSug]    = useState(false)
  const [nseStatus,  setNseStatus]  = useState(getNSEStatus)
  const abortRef = useRef<AbortController|null>(null)
  const stepRef  = useRef<ReturnType<typeof setInterval>|null>(null)

  // Update NSE clock every second
  useEffect(() => {
    const id = setInterval(() => setNseStatus(getNSEStatus()), 1000)
    return () => clearInterval(id)
  }, [])

  const load = useCallback(async (mkt: 'US'|'IN', sym: string, exp?: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setLoadStep(0)

    // Progressive loading steps
    if (stepRef.current) clearInterval(stepRef.current)
    stepRef.current = setInterval(() => {
      setLoadStep(s => Math.min(s + 1, 3))
    }, 3000)

    try {
      const p = new URLSearchParams({ market: mkt, symbol: sym })
      if (exp) p.set('expiry', exp)
      const res = await fetch(`/api/options?${p}`, { signal: ctrl.signal })
      const raw = await res.json() as OptionsData
      if (stepRef.current) clearInterval(stepRef.current)
      if (!ctrl.signal.aborted) {
        setData(raw)
        if (raw.expiries?.length && !exp) setExpiry(raw.selectedExpiry ?? raw.expiries[0] ?? '')
      }
    } catch (e: any) {
      if (stepRef.current) clearInterval(stepRef.current)
      if (e.name !== 'AbortError') setData(null)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => { load('US', 'SPY') }, [])

  const onMarket = (m: 'US'|'IN') => {
    const sym = m === 'IN' ? 'NIFTY' : 'SPY'
    setMarket(m); setSymbol(sym); setSymInput(sym); setExpiry(''); setData(null); load(m, sym)
  }
  const onSymbol = (s: string) => {
    const u = s.toUpperCase()
    setSymbol(u); setSymInput(u); setExpiry(''); setData(null); setShowSug(false); load(market, u)
  }
  const onExpiry = (e: string) => { setExpiry(e); load(market, symbol, e) }

  // ── Client-side enrichment ─────────────────────────────────────────────────
  const T = expiry ? yearsToExpiry(expiry) : 0.08
  const r = data?.riskFreeRate ?? 0.043
  const S = data?.spot ?? 0

  const enriched = (data?.chain ?? []).map(row => {
    const K = row.strike
    let ceIV = row.ce?.iv ?? 0
    let peIV = row.pe?.iv ?? 0
    let ceG  = { delta: row.ce?.delta ?? 0, gamma: row.ce?.gamma ?? 0, theta: row.ce?.theta ?? 0, vega: row.ce?.vega ?? 0 }
    let peG  = { delta: row.pe?.delta ?? 0, gamma: row.pe?.gamma ?? 0, theta: row.pe?.theta ?? 0, vega: row.pe?.vega ?? 0 }

    // Always compute IV + Greeks client-side when server didn't provide them (or IV=0)
    if (S > 0 && T > 0) {
      if (row.ce?.ltp && (ceIV === 0 || !data?.hasGreeks)) {
        const iv = calcIV(row.ce.ltp, S, K, T, r, 'call')
        if (iv > 0) { ceIV = iv * 100; ceG = calcGreeks(S, K, T, r, iv, 'call') }
      }
      if (row.pe?.ltp && (peIV === 0 || !data?.hasGreeks)) {
        const iv = calcIV(row.pe.ltp, S, K, T, r, 'put')
        if (iv > 0) { peIV = iv * 100; peG = calcGreeks(S, K, T, r, iv, 'put') }
      }
    }

    const isATM = S > 0 && Math.abs(K - S) / S < 0.006
    return { ...row, ceIV, peIV, ceG, peG, isATM }
  })

  const mp      = data ? calcMaxPain(data.chain) : 0
  const acent   = market === 'IN' ? '#f97316' : '#a78bfa'
  const symbols = market === 'IN' ? IN_SYMBOLS : US_SYMBOLS
  const suggest = symInput
    ? symbols.filter(s => s.toUpperCase().startsWith(symInput.toUpperCase())).slice(0, 8)
    : symbols.slice(0, 8)

  // OI chart data
  const oiRows = [...enriched]
    .filter(r => (r.ce?.oi ?? 0) + (r.pe?.oi ?? 0) > 0)
    .sort((a, b) => (b.ce?.oi??0)+(b.pe?.oi??0)-(a.ce?.oi??0)-(a.pe?.oi??0))
    .slice(0, 24)
    .sort((a, b) => a.strike - b.strike)
  const maxOI = Math.max(...oiRows.map(r => Math.max(r.ce?.oi??0, r.pe?.oi??0)), 1)

  // Loading messages
  const US_STEPS  = ['Acquiring Yahoo Finance session…', 'Fetching options chain…', 'Building strike table…', 'Falling back to CBOE…']
  const IN_STEPS  = ['Warming NSE session (Akamai)…', 'Fetching NIFTY chain…', 'Retrying with fresh cookies…', 'Building strike table…']
  const loadMsg = (market === 'IN' ? IN_STEPS : US_STEPS)[Math.min(loadStep, 3)]

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="panel" style={{ height:'100%', display:'flex', flexDirection:'column' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div className="dot" style={{ background: acent }} />
          OPTIONS ANALYTICS
          <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace' }}>
            BSM · Newton-Raphson IV · Greeks
          </span>
        </div>
        <div style={{ display:'flex', gap:'3px' }}>
          {(['chain','oi'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding:'2px 10px', borderRadius:'3px', cursor:'pointer',
              fontFamily:'JetBrains Mono,monospace', fontSize:'9px',
              border:`1px solid ${tab===t ? acent : 'var(--border)'}`,
              background: tab===t ? acent+'1a' : 'transparent',
              color: tab===t ? acent : 'var(--text-muted)',
            }}>
              {t === 'chain' ? '≡ CHAIN' : '▦ OI ANALYSIS'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Status bar — market hours + stale indicator ────────────────────── */}
      {(market === 'IN' || data?.staleData) && (
        <div style={{
          padding:'4px 12px', flexShrink:0,
          borderBottom:'1px solid var(--border)',
          background: data?.staleData
            ? 'rgba(240,165,0,0.06)'
            : nseStatus.isOpen ? 'rgba(0,201,122,0.06)' : 'rgba(255,69,96,0.06)',
          display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap',
          fontSize:'9px', fontFamily:'JetBrains Mono,monospace',
        }}>
          {market === 'IN' && (
            <>
              <div style={{
                width:'6px', height:'6px', borderRadius:'50%', flexShrink:0,
                background: nseStatus.isOpen ? '#00c97a' : '#ff4560',
                animation: nseStatus.isOpen ? 'pulseDot 2s ease-in-out infinite' : 'none',
              }} />
              <span style={{ color: nseStatus.isOpen ? '#00c97a' : '#ff4560', fontWeight:700 }}>
                NSE {nseStatus.isOpen ? 'OPEN' : 'CLOSED'}
              </span>
              <span style={{ color:'var(--text-muted)' }}>{nseStatus.timeStr} IST</span>
              <span style={{ color:'var(--text-muted)' }}>·</span>
              <span style={{ color:'var(--text-muted)' }}>Market hours: Mon–Fri 9:15am–3:30pm IST</span>
            </>
          )}
          {data?.staleData && (
            <>
              <span style={{ marginLeft: market === 'IN' ? 'auto' : 0, display:'flex', alignItems:'center', gap:'5px' }}>
                <span style={{ color:'var(--amber)', fontWeight:700 }}>⚠ STALE DATA</span>
                <span style={{ color:'var(--text-muted)' }}>
                  {data.staleAgeStr ? `${data.staleAgeStr} old — ` : ''}
                  {market === 'IN' && !nseStatus.isOpen
                    ? 'Last snapshot before market closed'
                    : 'Live feed temporarily unavailable'}
                </span>
                <button
                  onClick={() => load(market, symbol, expiry || undefined)}
                  style={{
                    padding:'1px 7px', borderRadius:'2px', cursor:'pointer',
                    fontFamily:'JetBrains Mono,monospace', fontSize:'8px',
                    border:'1px solid var(--amber)', background:'rgba(240,165,0,0.1)', color:'var(--amber)',
                  }}
                >
                  ↺ Retry
                </button>
              </span>
            </>
          )}
          {!data?.staleData && market === 'IN' && data && (
            <span style={{ marginLeft:'auto', color:'var(--text-muted)', fontSize:'8px' }}>
              Real-time · {new Date(data.fetchedAt).toLocaleTimeString('en-US', { timeZone:'Asia/Kolkata', hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit' })} IST
            </span>
          )}
        </div>
      )}

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div style={{
        display:'flex', gap:'6px', padding:'6px 10px',
        borderBottom:'1px solid var(--border)', flexShrink:0,
        flexWrap:'wrap', alignItems:'center',
      }}>
        {/* Market */}
        <div style={{ display:'flex', gap:'2px' }}>
          {(['US','IN'] as const).map(m => (
            <button key={m} onClick={() => onMarket(m)} style={{
              padding:'3px 10px', borderRadius:'3px', cursor:'pointer',
              fontFamily:'JetBrains Mono,monospace', fontSize:'10px', fontWeight:700,
              border:`1px solid ${market===m ? acent : 'var(--border)'}`,
              background: market===m ? acent+'15' : 'transparent',
              color: market===m ? acent : 'var(--text-muted)',
            }}>
              {m === 'US' ? '🇺🇸' : '🇮🇳'} {m}
            </button>
          ))}
        </div>

        {/* Symbol */}
        {market === 'US' ? (
          <div style={{ position:'relative', flex:1, minWidth:'100px', maxWidth:'140px' }}>
            <input
              value={symInput}
              onChange={e => { setSymInput(e.target.value.toUpperCase()); setShowSug(true) }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 200)}
              onKeyDown={e => { if (e.key === 'Enter' && symInput) onSymbol(symInput) }}
              placeholder="SPY, AAPL, SPX…"
              style={{
                width:'100%', fontFamily:'JetBrains Mono,monospace', fontSize:'10px',
                padding:'4px 8px', background:'var(--bg-deep)',
                border:`1px solid ${acent}44`, borderRadius:'3px', color:'#fff', outline:'none',
              }}
            />
            {showSug && suggest.length > 0 && (
              <div style={{
                position:'absolute', top:'100%', left:0, right:0, zIndex:50,
                background:'#0d1117', border:'1px solid var(--border)', borderRadius:'4px',
                boxShadow:'0 8px 24px rgba(0,0,0,0.8)', maxHeight:'200px', overflowY:'auto',
              }}>
                {suggest.map(s => (
                  <div key={s} onMouseDown={() => onSymbol(s)} style={{
                    padding:'5px 10px', cursor:'pointer', fontSize:'10px',
                    fontFamily:'JetBrains Mono,monospace', color:'var(--text-2)',
                    borderBottom:'1px solid var(--border)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >{s}</div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <select value={symbol} onChange={e => onSymbol(e.target.value)}
            style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'10px', padding:'4px 6px' }}>
            {IN_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}

        {/* Expiry */}
        {data?.expiries && data.expiries.length > 0 && (
          <select value={expiry} onChange={e => onExpiry(e.target.value)}
            style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'10px', padding:'4px 6px', maxWidth:'120px' }}>
            {data.expiries.map(e => (
              <option key={e} value={e}>{fmtExpiry(e)}</option>
            ))}
          </select>
        )}

        {/* Greeks toggle */}
        <button onClick={() => setShowGreeks(v => !v)} style={{
          padding:'2px 8px', borderRadius:'3px', cursor:'pointer',
          fontFamily:'JetBrains Mono,monospace', fontSize:'9px',
          border:`1px solid ${showGreeks ? '#00e5c0' : 'var(--border)'}`,
          background: showGreeks ? 'rgba(0,229,192,0.1)' : 'transparent',
          color: showGreeks ? '#00e5c0' : 'var(--text-muted)',
        }}>Δ GREEKS</button>

        <button
          onClick={() => load(market, symbol, expiry || undefined)}
          disabled={loading}
          style={{
            marginLeft:'auto', padding:'2px 10px', borderRadius:'3px', cursor:'pointer',
            fontFamily:'JetBrains Mono,monospace', fontSize:'9px',
            border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)',
          }}
        >
          {loading ? '···' : '↺'}
        </button>
      </div>

      {/* ── Stats strip ────────────────────────────────────────────────────── */}
      {data && !data.error && data.spot > 0 && (
        <div style={{
          padding:'5px 12px', borderBottom:'1px solid var(--border)', flexShrink:0,
          display:'flex', gap:'16px', alignItems:'center', flexWrap:'wrap',
          fontSize:'10px', fontFamily:'JetBrains Mono,monospace',
        }}>
          <span>
            <span style={{ color:'var(--text-muted)' }}>SPOT </span>
            <b style={{ color:'#fff', fontSize:'13px', fontFamily:'Syne,sans-serif' }}>
              {data.spot.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </b>
          </span>
          <span>
            <span style={{ color:'var(--text-muted)' }}>PCR </span>
            <b style={{ color: data.pcr > 1.2 ? 'var(--positive)' : data.pcr < 0.7 ? 'var(--negative)' : '#f0a500' }}>
              {data.pcr > 0 ? data.pcr.toFixed(3) : '—'}
            </b>
          </span>
          <span>
            <span style={{ color:'var(--text-muted)' }}>MAX PAIN </span>
            <b style={{ color: acent }}>{mp > 0 ? mp.toLocaleString() : '—'}</b>
          </span>
          <span>
            <span style={{ color:'var(--text-muted)' }}>C-OI </span>
            <b style={{ color:'var(--positive)' }}>{fmtNum(data.callOI)}</b>
          </span>
          <span>
            <span style={{ color:'var(--text-muted)' }}>P-OI </span>
            <b style={{ color:'var(--negative)' }}>{fmtNum(data.putOI)}</b>
          </span>
          <span>
            <span style={{ color:'var(--text-muted)' }}>STRIKES </span>
            <b style={{ color:'#fff' }}>{enriched.length}</b>
          </span>
          <span style={{
            marginLeft:'auto', fontSize:'8px',
            color: data.staleData ? 'var(--amber)' : 'var(--text-muted)',
          }}>
            {data.source}
            {market === 'US' && !data.staleData && (
              <span style={{ color:'var(--text-muted)', marginLeft:'4px' }}>· 15-min delayed</span>
            )}
          </span>
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto', overflowX:'auto', position:'relative' }}>

        {/* Loading */}
        {loading && (
          <div style={{ padding:'32px 20px', display:'flex', flexDirection:'column', alignItems:'center', gap:'14px' }}>
            <div style={{
              width:'26px', height:'26px',
              border:'2px solid var(--border)', borderTop:`2px solid ${acent}`,
              borderRadius:'50%', animation:'spin 0.8s linear infinite', flexShrink:0,
            }} />
            <div style={{ color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', fontSize:'11px', textAlign:'center' }}>
              {loadMsg}
            </div>
            {loadStep >= 2 && market === 'IN' && (
              <div style={{
                padding:'8px 14px', borderRadius:'4px',
                background:'rgba(249,115,22,0.06)', border:'1px solid rgba(249,115,22,0.2)',
                fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace',
                textAlign:'center', maxWidth:'300px', lineHeight:1.7,
              }}>
                NSE India uses bot protection. Session warm-up may take 10–15 seconds.
                If market is closed, last available data will be shown.
              </div>
            )}
          </div>
        )}

        {/* Error — no stale data available */}
        {!loading && data?.error && !data.staleData && (
          <div style={{ padding:'16px' }}>
            <div style={{
              padding:'10px 14px', borderRadius:'5px',
              background: market === 'IN' ? 'rgba(249,115,22,0.07)' : 'rgba(167,139,250,0.07)',
              border:`1px solid ${market === 'IN' ? 'rgba(249,115,22,0.25)' : 'rgba(167,139,250,0.25)'}`,
              fontSize:'10px', fontFamily:'JetBrains Mono,monospace', lineHeight:1.8,
            }}>
              <div style={{ color: market === 'IN' ? '#f97316' : '#a78bfa', fontWeight:700, marginBottom:'6px', fontSize:'11px' }}>
                ⚠ {data.error}
              </div>
              {market === 'IN' ? (
                <>
                  <div style={{ color:'var(--text-muted)' }}>• NSE data available Mon–Fri, 9:15am–3:30pm IST</div>
                  <div style={{ color:'var(--text-muted)' }}>
                    • Current IST: <b style={{color:'#fff'}}>{nseStatus.timeStr}</b> —{' '}
                    Market <b style={{color: nseStatus.isOpen ? '#00c97a' : '#ff4560'}}>
                      {nseStatus.isOpen ? 'OPEN — retry should work' : 'CLOSED — no live data available'}
                    </b>
                  </div>
                  <div style={{ color:'var(--text-muted)' }}>• NSE uses Akamai bot protection — first load may take 10–15s</div>
                  <div style={{ color:'var(--text-muted)' }}>• Stale data will show automatically once first successful fetch completes</div>
                </>
              ) : (
                <>
                  <div style={{ color:'var(--text-muted)' }}>• Trying Yahoo Finance (crumb auth) then CBOE CDN fallback</div>
                  <div style={{ color:'var(--text-muted)' }}>• Most liquid symbols work best: SPY, QQQ, AAPL, NVDA, SPX</div>
                  <div style={{ color:'var(--text-muted)' }}>• Click Retry — second attempt usually succeeds after session warms</div>
                </>
              )}
            </div>
            <button
              onClick={() => load(market, symbol, expiry || undefined)}
              style={{
                marginTop:'12px', padding:'6px 18px', borderRadius:'4px', cursor:'pointer',
                fontFamily:'JetBrains Mono,monospace', fontSize:'10px', fontWeight:700,
                border:`1px solid ${acent}`, background: acent+'15', color: acent,
              }}
            >
              ↺ Retry Now
            </button>
          </div>
        )}

        {/* ═══ CHAIN TAB ═══════════════════════════════════════════════════ */}
        {!loading && !data?.error && tab === 'chain' && enriched.length > 0 && (
          <table style={{
            width:'100%', borderCollapse:'collapse',
            fontFamily:'JetBrains Mono,monospace', fontSize:'10px', minWidth:'560px',
          }}>
            <thead style={{ position:'sticky', top:0, background:'#0d1117', zIndex:2 }}>
              <tr>
                {showGreeks && <>
                  <th style={TH('var(--positive)')}>Δ</th>
                  <th style={TH('var(--positive)')}>Γ</th>
                  <th style={TH('var(--positive)')}>θ</th>
                </>}
                <th style={TH('var(--positive)')}>OI</th>
                <th style={TH('var(--positive)')}>Vol</th>
                <th style={TH('#f0a500')}>IV%</th>
                <th style={TH('var(--positive)')}>LTP</th>
                <th style={{ ...TH('#fff'), background:'rgba(255,255,255,0.06)', minWidth:'70px', fontSize:'9px' }}>STRIKE</th>
                <th style={TH('var(--negative)')}>LTP</th>
                <th style={TH('#f0a500')}>IV%</th>
                <th style={TH('var(--negative)')}>Vol</th>
                <th style={TH('var(--negative)')}>OI</th>
                {showGreeks && <>
                  <th style={TH('var(--negative)')}>θ</th>
                  <th style={TH('var(--negative)')}>Γ</th>
                  <th style={TH('var(--negative)')}>Δ</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {enriched.map(row => {
                const K   = row.strike
                const atm = row.isATM
                const mps = mp > 0 && K === mp
                const itC = S > 0 && K < S   // in-the-money for calls
                const itP = S > 0 && K > S   // in-the-money for puts

                return (
                  <tr key={K} style={{
                    borderBottom:'1px solid rgba(30,45,61,0.6)',
                    background: atm ? 'rgba(240,165,0,0.06)' : mps ? acent+'08' : 'transparent',
                  }}>
                    {showGreeks && <>
                      <td style={TD('var(--positive)', itC)}>{row.ceG.delta ? row.ceG.delta.toFixed(3) : '—'}</td>
                      <td style={TD('var(--positive)', itC)}>{row.ceG.gamma ? row.ceG.gamma.toFixed(5) : '—'}</td>
                      <td style={TD('var(--positive)', itC)}>{row.ceG.theta ? row.ceG.theta.toFixed(3) : '—'}</td>
                    </>}
                    <td style={{ ...TD('var(--positive)', itC), fontWeight: itC ? 600 : 400 }}>
                      {fmtNum(row.ce?.oi ?? 0)}
                    </td>
                    <td style={TD('var(--text-2)', itC)}>
                      {fmtNum(row.ce?.volume ?? 0)}
                    </td>
                    <td style={TD('#f0a500', itC)}>
                      {row.ceIV > 0 ? row.ceIV.toFixed(1) + '%' : '—'}
                    </td>
                    <td style={{ ...TD('#fff', itC), fontWeight: 600 }}>
                      {row.ce?.ltp ? row.ce.ltp.toFixed(2) : '—'}
                    </td>

                    {/* Strike */}
                    <td style={{
                      textAlign:'center', padding:'5px 6px',
                      fontWeight: atm ? 900 : mps ? 700 : 600,
                      color: atm ? '#f0a500' : mps ? acent : 'var(--text-2)',
                      background: atm
                        ? 'rgba(240,165,0,0.12)'
                        : mps ? acent + '12' : 'rgba(255,255,255,0.03)',
                      borderLeft:'1px solid rgba(30,45,61,0.8)',
                      borderRight:'1px solid rgba(30,45,61,0.8)',
                      fontSize: atm ? '11px' : '10px',
                      whiteSpace:'nowrap',
                    }}>
                      {K.toLocaleString()}
                      {atm && <sup style={{ fontSize:'7px', color:'#f0a500', marginLeft:'2px' }}>ATM</sup>}
                      {mps && !atm && <sup style={{ fontSize:'7px', color: acent, marginLeft:'2px' }}>MP</sup>}
                    </td>

                    <td style={{ ...TD('#fff', itP), fontWeight: 600 }}>
                      {row.pe?.ltp ? row.pe.ltp.toFixed(2) : '—'}
                    </td>
                    <td style={TD('#f0a500', itP)}>
                      {row.peIV > 0 ? row.peIV.toFixed(1) + '%' : '—'}
                    </td>
                    <td style={TD('var(--text-2)', itP)}>
                      {fmtNum(row.pe?.volume ?? 0)}
                    </td>
                    <td style={{ ...TD('var(--negative)', itP), fontWeight: itP ? 600 : 400 }}>
                      {fmtNum(row.pe?.oi ?? 0)}
                    </td>
                    {showGreeks && <>
                      <td style={TD('var(--negative)', itP)}>{row.peG.theta ? row.peG.theta.toFixed(3) : '—'}</td>
                      <td style={TD('var(--negative)', itP)}>{row.peG.gamma ? row.peG.gamma.toFixed(5) : '—'}</td>
                      <td style={TD('var(--negative)', itP)}>{row.peG.delta ? row.peG.delta.toFixed(3) : '—'}</td>
                    </>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Empty chain with data */}
        {!loading && !data?.error && tab === 'chain' && enriched.length === 0 && data && data.spot > 0 && (
          <div style={{
            padding:'24px', textAlign:'center',
            color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', fontSize:'10px', lineHeight:1.8,
          }}>
            <div style={{ fontSize:'20px', marginBottom:'8px' }}>📊</div>
            <div>Got {data.expiries.length} expiries but 0 strikes for <b style={{color:'#fff'}}>{fmtExpiry(expiry)}</b></div>
            {data.expiries.length > 1 && (
              <div style={{ color:'var(--text-muted)', marginTop:'4px' }}>
                Try a different expiry from the dropdown above
              </div>
            )}
            <button
              onClick={() => load(market, symbol, expiry || undefined)}
              style={{
                marginTop:'12px', padding:'5px 14px', borderRadius:'3px', cursor:'pointer',
                fontFamily:'JetBrains Mono,monospace', fontSize:'10px',
                border:`1px solid ${acent}`, background: acent + '15', color: acent,
              }}
            >
              ↺ Retry
            </button>
          </div>
        )}

        {/* ═══ OI ANALYSIS TAB ══════════════════════════════════════════════ */}
        {!loading && !data?.error && tab === 'oi' && (
          <div style={{ padding:'12px', display:'flex', flexDirection:'column', gap:'10px' }}>
            {/* PCR + Max Pain */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
              <div style={{ padding:'12px', borderRadius:'6px', background:'var(--bg-deep)', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginBottom:'4px', letterSpacing:'0.1em' }}>PUT / CALL RATIO</div>
                <div style={{ fontSize:'28px', fontWeight:900, fontFamily:'Syne,sans-serif', lineHeight:1,
                  color: (data?.pcr??0) > 1.2 ? 'var(--positive)' : (data?.pcr??0) < 0.7 ? 'var(--negative)' : '#f0a500' }}>
                  {data && data?.pcr > 0 ? data.pcr.toFixed(3) : '—'}
                </div>
                <div style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginTop:'4px' }}>
                  {(data?.pcr??0) > 1.2 ? '▲ Bearish hedge-heavy' : (data?.pcr??0) < 0.7 ? '▼ Call-side heavy' : '~ Balanced sentiment'}
                </div>
              </div>
              <div style={{ padding:'12px', borderRadius:'6px', background:'var(--bg-deep)', border:`1px solid ${acent}33` }}>
                <div style={{ fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginBottom:'4px', letterSpacing:'0.1em' }}>MAX PAIN STRIKE</div>
                <div style={{ fontSize:'28px', fontWeight:900, fontFamily:'Syne,sans-serif', lineHeight:1, color: acent }}>
                  {mp > 0 ? mp.toLocaleString() : '—'}
                </div>
                <div style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginTop:'4px' }}>
                  {S > 0 && mp > 0
                    ? `${((mp - S) / S * 100).toFixed(2)}% from spot`
                    : 'Point of max option-writer profit'}
                </div>
              </div>
            </div>

            {/* OI bars */}
            {oiRows.length > 0 ? (
              <>
                <div style={{ fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', letterSpacing:'0.1em' }}>
                  OPEN INTEREST BY STRIKE · ■ CALLS (green) ■ PUTS (red)
                </div>
                {oiRows.map(row => {
                  const ceW = Math.round(((row.ce?.oi??0) / maxOI) * 100)
                  const peW = Math.round(((row.pe?.oi??0) / maxOI) * 100)
                  const atm = row.isATM, mps = mp > 0 && row.strike === mp
                  return (
                    <div key={row.strike} style={{ display:'grid', gridTemplateColumns:'70px 1fr 1fr', gap:'4px', alignItems:'center' }}>
                      <div style={{
                        textAlign:'center', fontSize:'10px',
                        fontFamily:'JetBrains Mono,monospace', fontWeight: atm || mps ? 700 : 400,
                        color: atm ? '#f0a500' : mps ? acent : 'var(--text-2)',
                      }}>
                        {row.strike.toLocaleString()}{atm ? ' ★' : mps ? ' ⊕' : ''}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:'4px' }}>
                        <span style={{ fontSize:'9px', color:'var(--positive)', fontFamily:'JetBrains Mono,monospace', minWidth:'34px', textAlign:'right' }}>
                          {fmtNum(row.ce?.oi??0)}
                        </span>
                        <div style={{ width:'80px', height:'10px', background:'var(--bg-deep)', borderRadius:'2px', overflow:'hidden', display:'flex', justifyContent:'flex-end' }}>
                          <div style={{ width:`${ceW}%`, background:'rgba(0,201,122,0.8)' }} />
                        </div>
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                        <div style={{ width:'80px', height:'10px', background:'var(--bg-deep)', borderRadius:'2px', overflow:'hidden' }}>
                          <div style={{ width:`${peW}%`, background:'rgba(255,69,96,0.8)' }} />
                        </div>
                        <span style={{ fontSize:'9px', color:'var(--negative)', fontFamily:'JetBrains Mono,monospace', minWidth:'34px' }}>
                          {fmtNum(row.pe?.oi??0)}
                        </span>
                      </div>
                    </div>
                  )
                })}
                <div style={{ fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', paddingTop:'4px' }}>
                  ★ ATM strike · ⊕ Max Pain strike
                </div>
              </>
            ) : (
              <div style={{ textAlign:'center', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', fontSize:'10px', padding:'20px' }}>
                {data ? 'No OI data for this expiry' : 'Load an options chain to see OI analysis'}
              </div>
            )}
          </div>
        )}

        {/* Nothing loaded */}
        {!loading && !data && (
          <div style={{ padding:'32px', textAlign:'center', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', fontSize:'11px' }}>
            Select a symbol to load the options chain
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding:'4px 12px', borderTop:'1px solid var(--border)', flexShrink:0,
        fontSize:'7px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace',
        display:'flex', justifyContent:'space-between', gap:'8px',
      }}>
        <span>
          {market === 'US'
            ? 'Yahoo Finance (crumb auth) → CBOE Delayed fallback'
            : 'NSE India real-time · stale cache when closed'}
          {' · BSM Black-Scholes · Newton-Raphson IV · All math client-side'}
        </span>
        <span>2-min cache</span>
      </div>

      <style>{`
        @keyframes spin     { 100% { transform: rotate(360deg); } }
        @keyframes pulseDot { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>
    </div>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────
const TH = (color: string): React.CSSProperties => ({
  padding: '5px 5px', textAlign: 'right', fontSize: '8px',
  color, letterSpacing: '0.06em', fontWeight: 600,
  borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
  background: '#0d1117',
})

const TD = (color: string, highlight = false): React.CSSProperties => ({
  padding: '4px 5px', textAlign: 'right',
  color: highlight ? color : 'var(--text-muted)',
  background: highlight ? color + '06' : 'transparent',
  fontFamily: 'JetBrains Mono,monospace', fontSize: '10px',
})