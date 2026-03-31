'use client'

import { useEffect, useState, useRef } from 'react'

const DEFAULT_SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'BTC-USD', 'GLD']

interface TickerItem {
  symbol: string
  price: number | null
  change: number | null
  prevPrice: number | null
}

export default function TickerBar() {
  const [tickers, setTickers] = useState<TickerItem[]>(
    DEFAULT_SYMBOLS.map(s => ({ symbol: s, price: null, change: null, prevPrice: null }))
  )
  const flashRef = useRef<Record<string, 'up' | 'down' | null>>({})
  const [flashes, setFlashes] = useState<Record<string, 'up' | 'down' | null>>({})

// Replace the fetchPrices function inside TickerBar:
const fetchPrices = async () => {
  const updates: TickerItem[] = []
  for (const symbol of DEFAULT_SYMBOLS) {
    try {
      const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
      const data = await res.json()
      if (data.rateLimited || !data.c) {
        // Keep previous value — never go blank
        const prev = tickers.find(t => t.symbol === symbol)
        updates.push({ symbol, price: prev?.price ?? null, change: prev?.change ?? null, prevPrice: prev?.prevPrice ?? null })
        continue
      }
      updates.push({ symbol, price: data.c, change: data.dp, prevPrice: data.pc })
    } catch {
      const prev = tickers.find(t => t.symbol === symbol)
      updates.push({ symbol, price: prev?.price ?? null, change: prev?.change ?? null, prevPrice: prev?.prevPrice ?? null })
    }
  }
  // rest of flash logic stays the same...

    setTickers(prev => {
      const newFlashes: Record<string, 'up' | 'down' | null> = {}
      updates.forEach(u => {
        const old = prev.find(p => p.symbol === u.symbol)
        if (old?.price && u.price && u.price !== old.price) {
          newFlashes[u.symbol] = u.price > old.price ? 'up' : 'down'
        }
      })
      setFlashes(newFlashes)
      setTimeout(() => setFlashes({}), 600)
      return updates
    })
  }

  useEffect(() => {
    fetchPrices()
    const interval = setInterval(fetchPrices, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
  <div style={{
    background: 'var(--bg-panel)',
    borderBottom: '1px solid var(--border)',
    height: '32px',
    overflow: 'hidden',
    position: 'relative',
  }}>
    <style>{`
      @keyframes tickerScroll {
        0%   { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      .ticker-track {
        display: flex;
        align-items: center;
        height: 100%;
        animation: tickerScroll 40s linear infinite;
        width: max-content;
      }
      .ticker-track:hover { animation-play-state: paused; }
    `}</style>

    <div className="ticker-track">
      {/* Render twice for seamless loop */}
      {[...tickers, ...tickers].map((ticker, idx) => (
        <div
          key={`${ticker.symbol}-${idx}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexShrink: 0,
            padding: '2px 16px',
            borderRight: '1px solid var(--border)',
            background: flashes[ticker.symbol] === 'up'
              ? 'rgba(0,201,122,0.2)'
              : flashes[ticker.symbol] === 'down'
              ? 'rgba(255,69,96,0.2)'
              : 'transparent',
            transition: 'background 0.1s',
          }}
        >
          <span style={{
            fontSize: '11px',
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            color: '#fff',
            letterSpacing: '0.05em',
          }}>
            {ticker.symbol}
          </span>
          <span style={{
            fontSize: '12px',
            fontFamily: 'JetBrains Mono, monospace',
            color: ticker.price ? '#fff' : 'var(--text-muted)',
          }}>
            {ticker.price ? ticker.price.toFixed(2) : '---'}
          </span>
          {ticker.change !== null && (
            <span style={{
              fontSize: '11px',
              fontFamily: 'JetBrains Mono, monospace',
              color: ticker.change >= 0 ? 'var(--positive)' : 'var(--negative)',
            }}>
              {ticker.change >= 0 ? '+' : ''}{ticker.change.toFixed(2)}%
            </span>
          )}
        </div>
      ))}
    </div>
  </div>
)
}