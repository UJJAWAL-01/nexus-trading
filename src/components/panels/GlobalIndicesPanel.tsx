'use client'

import { useEffect, useState, useRef } from 'react'

interface IndexDef {
  symbol:  string
  label:   string
  flag:    string
  source:  'finnhub' | 'yahoo'
  digits?: number
}

const ALL_INDICES: IndexDef[] = [
  // ── US ────────────────────────────────────────────────
  { symbol: 'SPY',       label: 'S&P 500',    flag: '🇺🇸', source: 'finnhub' },
  { symbol: 'QQQ',       label: 'NASDAQ',     flag: '🇺🇸', source: 'finnhub' },
  { symbol: 'DIA',       label: 'DOW 30',     flag: '🇺🇸', source: 'finnhub' },
  // ── Commodities / Crypto ──────────────────────────────
  { symbol: 'GLD',       label: 'Gold',       flag: '🥇',  source: 'finnhub' },
  { symbol: 'BTC-USD',   label: 'BTC/USD',    flag: '₿',    source: 'finnhub' },
  { symbol: '^VIX',      label: 'VIX',        flag: '📊',  source: 'yahoo' },
  // ── India ─────────────────────────────────────────────
  { symbol: '^NSEI',     label: 'NIFTY 50',   flag: '🇮🇳', source: 'yahoo' },
  { symbol: '^BSESN',    label: 'SENSEX',     flag: '🇮🇳', source: 'yahoo' },
  { symbol: '^NSEBANK',  label: 'BANK NIFTY', flag: '🇮🇳', source: 'yahoo' },
  { symbol: 'USDINR=X',  label: 'USD/INR',    flag: '💱',  source: 'yahoo', digits: 4 },
  // ── Asia ──────────────────────────────────────────────
  { symbol: '^N225',     label: 'Nikkei',     flag: '🇯🇵', source: 'yahoo' },
  { symbol: '^HSI',      label: 'Hang Seng',  flag: '🇭🇰', source: 'yahoo' },
]

function toFinnhubCrypto(symbol: string): string | null {
  const map: Record<string, string> = {
    'BTC-USD': 'BINANCE:BTCUSDT',
    'ETH-USD': 'BINANCE:ETHUSDT',
    'SOL-USD': 'BINANCE:SOLUSDT',
  }
  return map[symbol] ?? null
}
interface IndexData {
  symbol: string
  price:  number | null
  change: number | null
}

export default function GlobalIndicesPanel() {
  const [data, setData]     = useState<IndexData[]>(
    ALL_INDICES.map(i => ({ symbol: i.symbol, price: null, change: null }))
  )
  const staleRef = useRef<Map<string, IndexData>>(new Map())

  const fetchAll = async () => {
    const results = await Promise.all(
      ALL_INDICES.map(async (idx): Promise<IndexData> => {
        try {
          let price:  number | null = null
          let change: number | null = null

          if (idx.source === 'finnhub') {
            const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${idx.symbol}`)
            const d   = await res.json()
            if (!d.rateLimited && d.c && d.c > 0) {
              price  = d.c
              change = d.dp
            }
          } else {
            const res = await fetch(`/api/yquote?symbol=${encodeURIComponent(idx.symbol)}`)
            const d   = await res.json()
            if (d.price !== null && d.price > 0) {
              price  = d.price
              change = d.change
            }
          }

          if (price !== null) {
            staleRef.current.set(idx.symbol, { symbol: idx.symbol, price, change })
          }

          const stale = staleRef.current.get(idx.symbol)
          return {
            symbol: idx.symbol,
            price:  price  ?? stale?.price  ?? null,
            change: change ?? stale?.change ?? null,
          }
        } catch {
          const stale = staleRef.current.get(idx.symbol)
          return { symbol: idx.symbol, price: stale?.price ?? null, change: stale?.change ?? null }
        }
      })
    )
    setData(results)
  }

  useEffect(() => {
    fetchAll()
    const t = setInterval(fetchAll, 15_000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" />
        GLOBAL INDICES
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {ALL_INDICES.map((idx) => {
          const d      = data.find(x => x.symbol === idx.symbol)
          const isPos  = (d?.change ?? 0) >= 0
          const digits = idx.digits ?? 2

          // Dividers between sections
          const isFirstIndia = idx.symbol === '^NSEI'
          const isFirstAsia  = idx.symbol === '^N225'

          return (
            <div key={idx.symbol}>
              {(isFirstIndia || isFirstAsia) && (
                <div style={{
                  padding:    '4px 14px',
                  fontSize:   '8px',
                  color:      'var(--text-muted)',
                  letterSpacing: '0.12em',
                  fontFamily: 'JetBrains Mono, monospace',
                  borderBottom: '1px solid var(--border)',
                  background: 'rgba(255,255,255,0.02)',
                }}>
                  {isFirstIndia ? '── INDIA ──────────────' : '── ASIA ───────────────'}
                </div>
              )}

              <div style={{
                display:        'flex',
                justifyContent: 'space-between',
                alignItems:     'center',
                padding:        '7px 14px',
                borderBottom:   '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px' }}>{idx.flag}</span>
                  <span style={{
                    fontFamily: 'Syne, sans-serif',
                    fontWeight: 700,
                    fontSize:   '12px',
                    color:      '#fff',
                  }}>
                    {idx.label}
                  </span>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize:   '12px',
                    color:      '#fff',
                  }}>
                    {d?.price != null ? d.price.toFixed(digits) : '···'}
                  </div>
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize:   '10px',
                    color:
                      d?.change == null ? 'var(--text-muted)' :
                      isPos ? 'var(--positive)' : 'var(--negative)',
                  }}>
                    {d?.change != null
                      ? `${isPos ? '+' : ''}${d.change.toFixed(2)}%`
                      : '···'}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}