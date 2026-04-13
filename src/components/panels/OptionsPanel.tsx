'use client'
// src/components/panels/OptionsPanel.tsx
// US: CBOE public delayed data (Greeks pre-computed by CBOE)
// IN: NSE real-time index chains (NIFTY, BANKNIFTY, FINNIFTY)
// All BSM/IV validation done client-side — zero server CPU

import { useEffect, useState, useCallback, useRef } from 'react'

// ── Client-side BSM (for IV validation and missing Greeks) ────────────────────
function normcdf(x: number): number {
  const a = [0.319381530, -0.356563782, 1.781477937, -1.821255978, 1.330274429]
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const poly = t * (a[0] + t * (a[1] + t * (a[2] + t * (a[3] + t * a[4]))))
  const cdf  = 1 - (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x) * poly
  return x >= 0 ? cdf : 1 - cdf
}

function bsm(S: number, K: number, T: number, r: number, sigma: number, type: 'call' | 'put'): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T))
  const d2 = d1 - sigma * Math.sqrt(T)
  return type === 'call'
    ? S * normcdf(d1) - K * Math.exp(-r * T) * normcdf(d2)
    : K * Math.exp(-r * T) * normcdf(-d2) - S * normcdf(-d1)
}

function impliedVol(price: number, S: number, K: number, T: number, r: number, type: 'call'|'put'): number {
  if (price <= 0 || S <= 0 || K <= 0 || T <= 0) return 0
  const intrinsic = type === 'call' ? Math.max(S - K * Math.exp(-r * T), 0) : Math.max(K * Math.exp(-r * T) - S, 0)
  if (price < intrinsic * 0.999) return 0
  let sigma = 0.25
  for (let i = 0; i < 300; i++) {
    const p    = bsm(S, K, T, r, sigma, type)
    const diff = p - price
    if (Math.abs(diff) < 1e-8) break
    const d1   = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * Math.sqrt(T))
    const vega = S * Math.exp(-0.5 * d1 ** 2) / Math.sqrt(2 * Math.PI) * Math.sqrt(T)
    if (Math.abs(vega) < 1e-14) break
    sigma -= diff / vega
    if (sigma < 0.001) sigma = 0.001
    if (sigma > 20)   sigma = 20
  }
  return sigma > 0 && sigma < 20 ? sigma : 0
}

function greeks(S: number, K: number, T: number, r: number, sigma: number, type: 'call'|'put') {
  if (T <= 0 || sigma <= 0) return { delta: 0, gamma: 0, theta: 0, vega: 0 }
  const sqT = Math.sqrt(T)
  const d1  = (Math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * sqT)
  const d2  = d1 - sigma * sqT
  const npd1 = Math.exp(-0.5 * d1 ** 2) / Math.sqrt(2 * Math.PI)
  const delta = type === 'call' ? normcdf(d1) : normcdf(d1) - 1
  const gamma = npd1 / (S * sigma * sqT)
  const vega  = S * npd1 * sqT / 100
  const theta = type === 'call'
    ? (-(S * npd1 * sigma) / (2 * sqT) - r * K * Math.exp(-r * T) * normcdf(d2)) / 365
    : (-(S * npd1 * sigma) / (2 * sqT) + r * K * Math.exp(-r * T) * normcdf(-d2)) / 365
  return { delta: +delta.toFixed(4), gamma: +gamma.toFixed(6), theta: +theta.toFixed(4), vega: +vega.toFixed(4) }
}

function maxPain(chain: ChainRow[]): number {
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
interface ChainRow { strike: number; ce: Side | null; pe: Side | null }
interface ChainData {
  symbol: string; market: 'US' | 'IN'; spot: number
  expiries: string[]; selectedExpiry: string; chain: ChainRow[]
  callOI: number; putOI: number; pcr: number; lotSize: number
  riskFreeRate: number; source: string; hasGreeks: boolean
  fetchedAt: string; error?: string
}

// ── Symbol catalogues ─────────────────────────────────────────────────────────
const US_POPULAR = [
  // CBOE indices
  'SPX','NDX','VIX','RUT',
  // ETFs
  'SPY','QQQ','IWM','GLD','TLT','SLV',
  // Magnificent 7 + major stocks
  'AAPL','MSFT','NVDA','TSLA','META','AMZN','GOOGL','GOOG',
  'JPM','BAC','WFC','GS','MS','XOM','CVX',
  'AMD','INTC','NFLX','DIS','BA','LMT','CAT',
  'JNJ','LLY','PFE','UNH','V','MA',
]
const IN_SYMBOLS = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY','NIFTYNXT50']

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtN(v: number, d = 2): string {
  if (v === 0) return '—'
  const a = Math.abs(v)
  if (a >= 1e7) return (v/1e7).toFixed(1) + 'Cr'
  if (a >= 1e5) return (v/1e5).toFixed(1) + 'L'
  if (a >= 1e6) return (v/1e6).toFixed(1) + 'M'
  if (a >= 1e3) return (v/1e3).toFixed(0) + 'K'
  return v.toFixed(d)
}

function fmtDate(d: string): string {
  try { return new Date(d + (d.length===10 ? 'T00:00:00Z' : '')).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'2-digit',timeZone:'UTC'}) }
  catch { return d }
}

function T_from_expiry(e: string): number {
  const d = new Date(e.length===10 ? e+'T00:00:00Z' : e)
  return Math.max((d.getTime() - Date.now()) / (365*86400_000), 1/365)
}

// ── Panel ─────────────────────────────────────────────────────────────────────
type Tab = 'chain' | 'oi'

export default function OptionsPanel() {
  const [market,     setMarket]     = useState<'US'|'IN'>('US')
  const [symbol,     setSymbol]     = useState('SPY')
  const [symInput,   setSymInput]   = useState('SPY')
  const [expiry,     setExpiry]     = useState('')
  const [data,       setData]       = useState<ChainData | null>(null)
  const [loading,    setLoading]    = useState(false)
  const [tab,        setTab]        = useState<Tab>('chain')
  const [showGreeks, setShowGreeks] = useState(false)
  const [showSug,    setShowSug]    = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (mkt: 'US'|'IN', sym: string, exp?: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    try {
      const p = new URLSearchParams({ market: mkt, symbol: sym })
      if (exp) p.set('expiry', exp)
      const res = await fetch(`/api/options?${p}`, { signal: ctrl.signal })
      const raw = await res.json() as ChainData
      setData(raw)
      if (raw.expiries?.length && !exp) setExpiry(raw.selectedExpiry ?? raw.expiries[0] ?? '')
    } catch (e: any) {
      if (e.name !== 'AbortError') setData(null)
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => { load(market, symbol) }, [])

  const onMarket = (m: 'US'|'IN') => {
    const sym = m === 'IN' ? 'NIFTY' : 'SPY'
    setMarket(m); setSymbol(sym); setSymInput(sym); setExpiry(''); setData(null); load(m, sym)
  }
  const onSymbol = (s: string) => {
    const u = s.toUpperCase()
    setSymbol(u); setSymInput(u); setExpiry(''); setData(null); setShowSug(false); load(market, u)
  }
  const onExpiry = (e: string) => { setExpiry(e); load(market, symbol, e) }

  // Client-side enrichment — compute IV + Greeks for rows that don't have them (India)
  const T  = expiry ? T_from_expiry(expiry) : 0.05
  const r  = data?.riskFreeRate ?? 0.043
  const S  = data?.spot ?? 0

  const enriched = (data?.chain ?? []).map(row => {
    const K = row.strike

    // If CBOE already provided Greeks, use them directly (hasGreeks=true)
    let ceG = { delta: row.ce?.delta ?? 0, gamma: row.ce?.gamma ?? 0, theta: row.ce?.theta ?? 0, vega: row.ce?.vega ?? 0 }
    let peG = { delta: row.pe?.delta ?? 0, gamma: row.pe?.gamma ?? 0, theta: row.pe?.theta ?? 0, vega: row.pe?.vega ?? 0 }
    let ceIV = row.ce?.iv ?? 0
    let peIV = row.pe?.iv ?? 0

    // For NSE (hasGreeks=false) or missing CBOE Greeks, compute client-side
    if (!data?.hasGreeks || ceIV === 0) {
      if (row.ce?.ltp && S > 0) {
        const iv = impliedVol(row.ce.ltp, S, K, T, r, 'call')
        if (iv > 0) { ceIV = iv * 100; ceG = greeks(S, K, T, r, iv, 'call') }
      }
      if (row.pe?.ltp && S > 0) {
        const iv = impliedVol(row.pe.ltp, S, K, T, r, 'put')
        if (iv > 0) { peIV = iv * 100; peG = greeks(S, K, T, r, iv, 'put') }
      }
    }

    const isATM = S > 0 && Math.abs(K - S) / S < 0.005
    return { ...row, ceG, peG, ceIV, peIV, isATM }
  })

  const mp     = data ? maxPain(data.chain) : 0
  const acent  = market === 'IN' ? '#f97316' : '#a78bfa'
  const symbols = market === 'IN' ? IN_SYMBOLS : US_POPULAR

  // OI bar chart
  const oiRows = [...enriched]
    .filter(r => (r.ce?.oi ?? 0) + (r.pe?.oi ?? 0) > 0)
    .sort((a,b) => (b.ce?.oi??0)+(b.pe?.oi??0)-(a.ce?.oi??0)-(a.pe?.oi??0))
    .slice(0, 24).sort((a,b) => a.strike - b.strike)
  const maxOI  = Math.max(...oiRows.map(r => Math.max(r.ce?.oi??0, r.pe?.oi??0)), 1)

  // Suggestions filter
  const filtered = symInput
    ? symbols.filter(s => s.startsWith(symInput.toUpperCase())).slice(0, 8)
    : symbols.slice(0, 8)

  return (
    <div className="panel" style={{ height:'100%', display:'flex', flexDirection:'column' }}>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent:'space-between', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div className="dot" style={{ background: acent }} />
          OPTIONS ANALYTICS
          <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace' }}>
            BSM · Newton-Raphson IV
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

      {/* Controls */}
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
              {m==='US' ? '🇺🇸' : '🇮🇳'} {m}
            </button>
          ))}
        </div>

        {/* Symbol input with autocomplete */}
        {market === 'US' ? (
          <div style={{ position:'relative', flex:1, minWidth:'100px', maxWidth:'140px' }}>
            <input
              value={symInput}
              onChange={e => { setSymInput(e.target.value.toUpperCase()); setShowSug(true) }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 200)}
              onKeyDown={e => { if (e.key === 'Enter' && symInput) onSymbol(symInput) }}
              placeholder="e.g. SPY, AAPL…"
              style={{
                width:'100%', fontFamily:'JetBrains Mono,monospace', fontSize:'10px',
                padding:'4px 8px', background:'var(--bg-deep)',
                border:`1px solid ${acent+'44'}`, borderRadius:'3px', color:'#fff', outline:'none',
              }}
            />
            {showSug && filtered.length > 0 && (
              <div style={{
                position:'absolute', top:'100%', left:0, right:0, zIndex:50,
                background:'#0d1117', border:'1px solid var(--border)',
                borderRadius:'4px', boxShadow:'0 8px 24px rgba(0,0,0,0.8)',
                maxHeight:'200px', overflowY:'auto',
              }}>
                {filtered.map(s => (
                  <div key={s} onMouseDown={() => onSymbol(s)} style={{
                    padding:'5px 10px', cursor:'pointer', fontSize:'10px',
                    fontFamily:'JetBrains Mono,monospace', color:'var(--text-2)',
                    borderBottom:'1px solid var(--border)',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {s}
                  </div>
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
            style={{ fontFamily:'JetBrains Mono,monospace', fontSize:'10px', padding:'4px 6px' }}>
            {data.expiries.map(e => <option key={e} value={e}>{fmtDate(e)}</option>)}
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

        <button onClick={() => load(market, symbol, expiry || undefined)}
          disabled={loading} style={{
            marginLeft:'auto', padding:'2px 10px', borderRadius:'3px', cursor:'pointer',
            fontFamily:'JetBrains Mono,monospace', fontSize:'9px',
            border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)',
          }}>
          {loading ? '···' : '↺ Refresh'}
        </button>
      </div>

      {/* Stats strip */}
      {data && !data.error && data.spot > 0 && (
        <div style={{
          padding:'5px 12px', borderBottom:'1px solid var(--border)', flexShrink:0,
          display:'flex', gap:'14px', alignItems:'center', flexWrap:'wrap',
          fontSize:'10px', fontFamily:'JetBrains Mono,monospace',
        }}>
          <span>
            <span style={{ color:'var(--text-muted)' }}>SPOT </span>
            <b style={{ color:'#fff', fontSize:'13px' }}>
              {data.spot.toLocaleString('en-US',{maximumFractionDigits:2})}
            </b>
          </span>
          <span>
            <span style={{ color:'var(--text-muted)' }}>PCR </span>
            <b style={{ color: data.pcr>1.2?'var(--positive)':data.pcr<0.7?'var(--negative)':'#f0a500' }}>
              {data.pcr.toFixed(3)}
            </b>
          </span>
          <span>
            <span style={{ color:'var(--text-muted)' }}>MAX PAIN </span>
            <b style={{ color: acent }}>{mp ? mp.toLocaleString() : '—'}</b>
          </span>
          <span>
            <span style={{ color:'var(--text-muted)' }}>C-OI </span>
            <b style={{ color:'var(--positive)' }}>{fmtN(data.callOI,0)}</b>
          </span>
          <span>
            <span style={{ color:'var(--text-muted)' }}>P-OI </span>
            <b style={{ color:'var(--negative)' }}>{fmtN(data.putOI,0)}</b>
          </span>
          <span style={{ marginLeft:'auto', color:'var(--text-muted)', fontSize:'8px' }}>
            {data.source}
          </span>
        </div>
      )}

      {/* Content */}
      <div style={{ flex:1, overflowY:'auto', overflowX:'auto' }}>

        {loading && (
          <div style={{ padding:'32px', textAlign:'center', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', fontSize:'11px' }}>
            FETCHING {symbol} OPTIONS…
          </div>
        )}

        {!loading && data?.error && (
          <div style={{ padding:'20px 16px' }}>
            <div style={{ color:'var(--negative)', fontSize:'11px', fontFamily:'JetBrains Mono,monospace', marginBottom:'8px' }}>
              ⚠ {data.error}
            </div>
            <div style={{ fontSize:'10px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', lineHeight:1.7 }}>
              {market==='IN'
                ? 'NSE India options require an active market session (Mon–Fri 9:15am–3:30pm IST). Try NIFTY or BANKNIFTY during market hours.'
                : 'US options via CBOE public API. If this keeps failing, try a different symbol or click Refresh.'}
            </div>
          </div>
        )}

        {/* ═══ CHAIN TAB ═══════════════════════════════════════════════════ */}
        {!loading && !data?.error && tab==='chain' && enriched.length > 0 && (
          <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'JetBrains Mono,monospace', fontSize:'10px', minWidth:'580px' }}>
            <thead style={{ position:'sticky', top:0, background:'#0d1117', zIndex:2 }}>
              <tr>
                {showGreeks && <>
                  <th style={TH('var(--positive)')}>Δ delta</th>
                  <th style={TH('var(--positive)')}>Γ gamma</th>
                  <th style={TH('var(--positive)')}>θ theta</th>
                </>}
                <th style={TH('var(--positive)')}>OI</th>
                <th style={TH('var(--positive)')}>Chg</th>
                <th style={TH('#f0a500')}>IV%</th>
                <th style={TH('var(--positive)')}>LTP</th>
                <th style={{ ...TH('#fff'), background:'rgba(255,255,255,0.07)', minWidth:'72px' }}>STRIKE</th>
                <th style={TH('var(--negative)')}>LTP</th>
                <th style={TH('#f0a500')}>IV%</th>
                <th style={TH('var(--negative)')}>Chg</th>
                <th style={TH('var(--negative)')}>OI</th>
                {showGreeks && <>
                  <th style={TH('var(--negative)')}>θ theta</th>
                  <th style={TH('var(--negative)')}>Γ gamma</th>
                  <th style={TH('var(--negative)')}>Δ delta</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {enriched.map(row => {
                const K    = row.strike
                const atm  = row.isATM
                const mps  = mp > 0 && K === mp
                const itC  = S > 0 && K < S
                const itP  = S > 0 && K > S
                return (
                  <tr key={K} style={{ borderBottom:'1px solid var(--border)', background: atm?'rgba(240,165,0,0.07)':mps?acent+'0a':'transparent' }}>
                    {showGreeks && <>
                      <td style={TD('var(--positive)',itC)}>{row.ceG.delta.toFixed(3)}</td>
                      <td style={TD('var(--positive)',itC)}>{row.ceG.gamma.toFixed(4)}</td>
                      <td style={TD('var(--positive)',itC)}>{row.ceG.theta.toFixed(2)}</td>
                    </>}
                    <td style={{ ...TD('var(--positive)',itC), fontWeight:itC?700:400 }}>{fmtN(row.ce?.oi??0,0)}</td>
                    <td style={TD(row.ce?.oiChg??0>=0?'var(--positive)':'var(--negative)',itC)}>
                      {row.ce?.oiChg ? (row.ce.oiChg>=0?'+':'')+fmtN(row.ce.oiChg,0) : '—'}
                    </td>
                    <td style={TD('#f0a500',itC)}>{row.ceIV>0 ? row.ceIV.toFixed(1)+'%' : '—'}</td>
                    <td style={{ ...TD('#fff',itC), fontWeight:600 }}>{row.ce?.ltp ? row.ce.ltp.toFixed(2) : '—'}</td>

                    <td style={{
                      textAlign:'center', padding:'5px 6px',
                      fontWeight: atm?900:mps?700:600,
                      color: atm?'#f0a500':mps?acent:'var(--text-2)',
                      background: atm?'rgba(240,165,0,0.12)':mps?acent+'15':'rgba(255,255,255,0.04)',
                      borderLeft:'1px solid var(--border)', borderRight:'1px solid var(--border)',
                      fontSize: atm?'11px':'10px', whiteSpace:'nowrap' as const,
                    }}>
                      {K.toLocaleString()}
                      {atm && <sup style={{ fontSize:'7px', color:'#f0a500', marginLeft:'2px' }}>ATM</sup>}
                      {mps && <sup style={{ fontSize:'7px', color:acent, marginLeft:'2px' }}>MP</sup>}
                    </td>

                    <td style={{ ...TD('#fff',itP), fontWeight:600 }}>{row.pe?.ltp ? row.pe.ltp.toFixed(2) : '—'}</td>
                    <td style={TD('#f0a500',itP)}>{row.peIV>0 ? row.peIV.toFixed(1)+'%' : '—'}</td>
                    <td style={TD(row.pe?.oiChg??0>=0?'var(--positive)':'var(--negative)',itP)}>
                      {row.pe?.oiChg ? (row.pe.oiChg>=0?'+':'')+fmtN(row.pe.oiChg,0) : '—'}
                    </td>
                    <td style={{ ...TD('var(--negative)',itP), fontWeight:itP?700:400 }}>{fmtN(row.pe?.oi??0,0)}</td>
                    {showGreeks && <>
                      <td style={TD('var(--negative)',itP)}>{row.peG.theta.toFixed(2)}</td>
                      <td style={TD('var(--negative)',itP)}>{row.peG.gamma.toFixed(4)}</td>
                      <td style={TD('var(--negative)',itP)}>{row.peG.delta.toFixed(3)}</td>
                    </>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* ═══ OI ANALYSIS TAB ══════════════════════════════════════════════ */}
        {!loading && !data?.error && tab==='oi' && (
          <div style={{ padding:'12px' }}>
            {/* PCR + Max Pain banner */}
            <div style={{
              display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'12px',
            }}>
              <div style={{ padding:'12px', borderRadius:'6px', background:'var(--bg-deep)', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginBottom:'4px', letterSpacing:'0.1em' }}>
                  PUT/CALL RATIO (OI)
                </div>
                <div style={{ fontSize:'26px', fontWeight:900, fontFamily:'Syne,sans-serif', lineHeight:1,
                  color: data?.pcr&&data.pcr>1.2?'var(--positive)':data?.pcr&&data.pcr<0.7?'var(--negative)':'#f0a500' }}>
                  {data?.pcr?.toFixed(3) ?? '—'}
                </div>
                <div style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginTop:'3px' }}>
                  {data?.pcr&&data.pcr>1.2 ? '▲ BEARISH HEDGE HEAVY' : data?.pcr&&data.pcr<0.7 ? '▼ CALL SIDE HEAVY' : '~ BALANCED'}
                </div>
              </div>
              <div style={{ padding:'12px', borderRadius:'6px', background:'var(--bg-deep)', border:`1px solid ${acent}33` }}>
                <div style={{ fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginBottom:'4px', letterSpacing:'0.1em' }}>
                  MAX PAIN STRIKE
                </div>
                <div style={{ fontSize:'26px', fontWeight:900, fontFamily:'Syne,sans-serif', lineHeight:1, color: acent }}>
                  {mp ? mp.toLocaleString() : '—'}
                </div>
                <div style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginTop:'3px' }}>
                  {data?.spot && mp ? ((mp-data.spot)/data.spot*100).toFixed(2)+'% from spot' : 'Max options pain point'}
                </div>
              </div>
            </div>

            {/* OI bar chart */}
            <div style={{ fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginBottom:'8px', letterSpacing:'0.1em' }}>
              OPEN INTEREST BY STRIKE — ■ CALL (green)  ■ PUT (red)
            </div>
            {oiRows.map(row => {
              const ceW = Math.round(((row.ce?.oi??0)/maxOI)*100)
              const peW = Math.round(((row.pe?.oi??0)/maxOI)*100)
              const atm = row.isATM, mps = mp > 0 && row.strike === mp
              return (
                <div key={row.strike} style={{ display:'grid', gridTemplateColumns:'72px 1fr 1fr', gap:'4px', alignItems:'center', marginBottom:'3px' }}>
                  <div style={{
                    textAlign:'center', fontSize:'10px', fontFamily:'JetBrains Mono,monospace',
                    fontWeight: atm||mps?700:400,
                    color: atm?'#f0a500':mps?acent:'var(--text-2)',
                  }}>
                    {row.strike.toLocaleString()}{atm?' ★':mps?' ⊕':''}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:'4px' }}>
                    <span style={{ fontSize:'9px', color:'var(--positive)', fontFamily:'JetBrains Mono,monospace', minWidth:'36px', textAlign:'right' }}>
                      {fmtN(row.ce?.oi??0,0)}
                    </span>
                    <div style={{ width:'90px', height:'11px', background:'var(--bg-deep)', borderRadius:'2px', overflow:'hidden', display:'flex', justifyContent:'flex-end' }}>
                      <div style={{ width:`${ceW}%`, background:'rgba(0,201,122,0.75)', transition:'width 0.3s' }} />
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'4px' }}>
                    <div style={{ width:'90px', height:'11px', background:'var(--bg-deep)', borderRadius:'2px', overflow:'hidden' }}>
                      <div style={{ width:`${peW}%`, background:'rgba(255,69,96,0.75)', transition:'width 0.3s' }} />
                    </div>
                    <span style={{ fontSize:'9px', color:'var(--negative)', fontFamily:'JetBrains Mono,monospace', minWidth:'36px' }}>
                      {fmtN(row.pe?.oi??0,0)}
                    </span>
                  </div>
                </div>
              )
            })}
            <div style={{ marginTop:'10px', fontSize:'8px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace' }}>
              ★ ATM · ⊕ Max Pain · OI concentration signals key support/resistance
            </div>
          </div>
        )}

        {!loading && !data && (
          <div style={{ padding:'32px', textAlign:'center', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', fontSize:'11px' }}>
            Enter a symbol or click Refresh to load options chain
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding:'4px 12px', borderTop:'1px solid var(--border)', flexShrink:0,
        fontSize:'7px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace',
        display:'flex', justifyContent:'space-between',
      }}>
        <span>{market==='US' ? 'CBOE Delayed Quotes (public CDN)' : 'NSE India'} · BSM Greeks · Newton-Raphson IV</span>
        <span>All math client-side · 2min cache</span>
      </div>
    </div>
  )
}

// Style helpers
const TH = (color: string): React.CSSProperties => ({
  padding:'5px 6px', textAlign:'right' as const, fontSize:'8px',
  color, letterSpacing:'0.06em', fontWeight:600,
  borderBottom:'1px solid var(--border)', whiteSpace:'nowrap' as const,
  background:'#0d1117',
})
const TD = (color: string, hi = false): React.CSSProperties => ({
  padding:'5px 6px', textAlign:'right' as const,
  color: hi ? color : 'var(--text-2)',
  background: hi ? color+'08' : 'transparent',
  fontFamily:'JetBrains Mono,monospace',
})