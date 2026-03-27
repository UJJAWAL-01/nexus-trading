'use client'

import { useEffect, useState } from 'react'

const INDICES = [
  { symbol: 'SPY',  label: 'S&P 500',  flag: '🇺🇸' },
  { symbol: 'QQQ',  label: 'NASDAQ',   flag: '🇺🇸' },
  { symbol: 'DIA',  label: 'DOW 30',   flag: '🇺🇸' },
  { symbol: 'IWM',  label: 'Russell',  flag: '🇺🇸' },
  { symbol: 'GLD',  label: 'Gold',     flag: '🥇' },
  { symbol: 'USO',  label: 'Oil',      flag: '🛢️' },
  { symbol: 'BTC-USD', label: 'BTC',   flag: '₿' },
  { symbol: 'VIX',  label: 'VIX',      flag: '📊' },
]

interface IndexData {
  symbol: string
  price: number | null
  change: number | null
}

export default function GlobalIndicesPanel() {
  const [data, setData] = useState<IndexData[]>(
    INDICES.map(i => ({ symbol: i.symbol, price: null, change: null }))
  )

  const fetch_ = async () => {
    const updates = await Promise.all(
      INDICES.map(async ({ symbol }) => {
        try {
          const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
          const d = await res.json()
          if (d.rateLimited || !d.c) return { symbol, price: null, change: null }
          return { symbol, price: d.c, change: d.dp }
        } catch {
          return { symbol, price: null, change: null }
        }
      })
    )
    setData(updates)
  }

  useEffect(() => {
    fetch_()
    const t = setInterval(fetch_, 12000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" />
        GLOBAL INDICES
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {INDICES.map((idx, i) => {
          const d = data.find(x => x.symbol === idx.symbol)
          const isPos = (d?.change ?? 0) >= 0
          return (
            <div key={idx.symbol} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 14px',
              borderBottom: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '13px' }}>{idx.flag}</span>
                <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: '#fff' }}>
                  {idx.label}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#fff' }}>
                  {d?.price ? d.price.toFixed(2) : '---'}
                </div>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
                  color: d?.change == null ? 'var(--text-muted)' : isPos ? 'var(--positive)' : 'var(--negative)',
                }}>
                  {d?.change != null ? `${isPos ? '+' : ''}${d.change.toFixed(2)}%` : '---'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}