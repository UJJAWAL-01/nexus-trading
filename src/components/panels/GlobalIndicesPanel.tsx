'use client'

import { useEffect, useRef, useState } from 'react'

// ── Index registry ─────────────────────────────────────────────────────────────
// source: 'finnhub' | 'yahoo'
// For any symbol that Finnhub quotes poorly (crypto, VIX), use Yahoo.
// Yahoo covers everything through /api/globalquote.

interface IndexEntry {
  symbol:  string
  ySymbol: string   // Yahoo Finance symbol (may differ)
  label:   string
  flag:    string
  source:  'yahoo'  // All now use globalquote → Yahoo Finance
}

const INDICES: IndexEntry[] = [
  { symbol:'SPY',     ySymbol:'SPY',      label:'S&P 500',  flag:'🇺🇸', source:'yahoo' },
  { symbol:'QQQ',     ySymbol:'QQQ',      label:'NASDAQ',   flag:'🇺🇸', source:'yahoo' },
  { symbol:'DIA',     ySymbol:'DIA',      label:'DOW 30',   flag:'🇺🇸', source:'yahoo' },
  { symbol:'^NSEI',   ySymbol:'^NSEI',    label:'Nifty 50', flag:'🇮🇳', source:'yahoo' },
  { symbol:'^BSESN',  ySymbol:'^BSESN',   label:'Sensex',   flag:'🇮🇳', source:'yahoo' },
  { symbol:'USDINR=X',ySymbol:'USDINR=X', label:'USD/INR',  flag:'💱', source:'yahoo' },
  { symbol:'^N225',   ySymbol:'^N225',    label:'Nikkei',   flag:'🇯🇵', source:'yahoo' },
  { symbol:'^HSI',    ySymbol:'^HSI',     label:'Hang Seng',flag:'🇭🇰', source:'yahoo' },
  { symbol:'GLD',     ySymbol:'GLD',      label:'Gold',     flag:'🥇', source:'yahoo' },
  { symbol:'^VIX',    ySymbol:'^VIX',     label:'VIX',      flag:'📊', source:'yahoo' },
]

interface IndexData {
  symbol:  string
  price:   number | null
  change:  number | null
  changePct: number | null
  currency: string
}

export default function GlobalIndicesPanel() {
  const [data, setData] = useState<IndexData[]>(
    INDICES.map(i => ({ symbol: i.symbol, price: null, change: null, changePct: null, currency: 'USD' })),
  )
  const prevRef = useRef<IndexData[]>([])
  const [flash, setFlash] = useState<Record<string, 'up' | 'down'>>({})

  const fetchAll = async () => {
    const updates = await Promise.all(
      INDICES.map(async (idx) => {
        try {
          // Use globalquote for ALL symbols — handles ^VIX, BTC-USD, EURUSD=X, etc.
          const res = await fetch(`/api/globalquote?symbol=${encodeURIComponent(idx.ySymbol)}`)
          const d   = await res.json()

          if (d.price == null) {
            const stale = prevRef.current.find(x => x.symbol === idx.symbol)
            return stale ?? { symbol: idx.symbol, price: null, change: null, changePct: null, currency: 'USD' }
          }

          return {
            symbol:    idx.symbol,
            price:     d.price,
            change:    d.change,
            changePct: d.changePercent,
            currency:  d.currency ?? 'USD',
          } satisfies IndexData
        } catch {
          const stale = prevRef.current.find(x => x.symbol === idx.symbol)
          return stale ?? { symbol: idx.symbol, price: null, change: null, changePct: null, currency: 'USD' }
        }
      }),
    )

    // Compute flash
    const newFlash: Record<string, 'up' | 'down'> = {}
    updates.forEach(u => {
      const old = prevRef.current.find(x => x.symbol === u.symbol)
      if (old?.price && u.price && u.price !== old.price) {
        newFlash[u.symbol] = u.price > old.price ? 'up' : 'down'
      }
    })
    if (Object.keys(newFlash).length > 0) {
      setFlash(newFlash)
      setTimeout(() => setFlash({}), 650)
    }

    prevRef.current = updates
    setData(updates)
  }

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 12_000)
    return () => clearInterval(t)
  }, [])

  // Price formatting — VIX, yield, forex have different decimal needs
  const fmtPrice = (idx: IndexEntry, price: number): string => {
    if (['EURUSD=X', 'USDINR=X'].includes(idx.symbol)) return price.toFixed(4)
    if (['^VIX', '^TNX'].includes(idx.symbol)) return price.toFixed(2)
    if (idx.symbol === 'BTC-USD') {
      if (price > 10000) return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 })
      return '$' + price.toFixed(2)
    }
    return price.toFixed(2)
  }

  return (
    <div className="panel" style={{ height:'100%', display:'flex', flexDirection:'column' }}>
      <div className="panel-header">
        <div className="dot" />
        GLOBAL INDICES
      </div>

      <div style={{ flex:1, overflowY:'auto' }}>
        {INDICES.map(idx => {
          const d      = data.find(x => x.symbol === idx.symbol)
          const pct    = d?.changePct ?? 0
          const isPos  = pct >= 0
          const fl     = flash[idx.symbol]
          return (
            <div
              key={idx.symbol}
              style={{
                display:'flex', justifyContent:'space-between', alignItems:'center',
                padding:'7px 12px', borderBottom:'1px solid var(--border)',
                background: fl==='up'?'rgba(0,201,122,0.10)':fl==='down'?'rgba(255,69,96,0.10)':'transparent',
                transition:'background 0.15s ease-out',
              }}
            >
              <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                <span style={{ fontSize:'13px', flexShrink:0 }}>{idx.flag}</span>
                <span style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'11px', color:'#fff' }}>
                  {idx.label}
                </span>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'12px', color:'#fff' }}>
                  {d?.price != null
                    ? fmtPrice(idx, d.price)
                    : <span style={{ color:'var(--text-muted)', fontSize:'10px' }}>---</span>}
                </div>
                <div style={{
                  fontFamily:'JetBrains Mono, monospace', fontSize:'10px',
                  color: d?.changePct == null ? 'var(--text-muted)' : isPos ? 'var(--positive)' : 'var(--negative)',
                }}>
                  {d?.changePct != null
                    ? `${isPos?'+':''}${d.changePct.toFixed(2)}%`
                    : d?.price != null ? '—' : ''}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}