'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

// Always-present index symbols added to watchlist symbols
const INDEX_SYMBOLS = ['SPY', 'QQQ', 'GLD', 'BTC-USD', 'VIX']
const MOBILE_BREAKPOINT = 768

interface TickerItem {
  symbol: string
  price:  number | null
  change: number | null
  flash:  'up' | 'down' | null
}

export default function TickerBar() {
  const { symbols: watchlistSymbols } = useWatchlist()
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile
  useEffect(() => {
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    const handleResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Derive combined, deduplicated symbol list
  const allSymbols = [...new Set([...watchlistSymbols, ...INDEX_SYMBOLS])]

  // Persistent stale store — survives re-renders & API failures
  const staleRef = useRef<Map<string, { price: number | null; change: number | null }>>(new Map())

  const [tickers, setTickers] = useState<TickerItem[]>(
    allSymbols.map(s => ({ symbol: s, price: null, change: null, flash: null }))
  )

  // When watchlist changes, merge in new symbols keeping stale data for existing ones
  useEffect(() => {
    const combined = [...new Set([...watchlistSymbols, ...INDEX_SYMBOLS])]
    setTickers(prev => {
      const prevMap = new Map(prev.map(t => [t.symbol, t]))
      return combined.map(symbol => {
        if (prevMap.has(symbol)) return prevMap.get(symbol)!
        const stale = staleRef.current.get(symbol)
        return {
          symbol,
          price:  stale?.price  ?? null,
          change: stale?.change ?? null,
          flash:  null,
        }
      })
    })
  }, [watchlistSymbols.join(',')])

  const fetchPrices = useCallback(async () => {
    const symbols = [...new Set([...watchlistSymbols, ...INDEX_SYMBOLS])]

    const results = await Promise.all(
      symbols.map(async (symbol): Promise<{ symbol: string; price: number | null; change: number | null }> => {
        try {
          const res  = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
          const data = await res.json()

          if (!data.rateLimited && data.c && data.c > 0) {
            const item = { price: data.c as number, change: data.dp as number }
            staleRef.current.set(symbol, item)
            return { symbol, ...item }
          }
        } catch {}

        // Always return stale — never blank
        const stale = staleRef.current.get(symbol)
        return { symbol, price: stale?.price ?? null, change: stale?.change ?? null }
      })
    )

    setTickers(prev => {
      const prevMap  = new Map(prev.map(t => [t.symbol, t]))
      const newItems = results.map(r => {
        const old   = prevMap.get(r.symbol)
        const flash =
          old?.price && r.price && r.price !== old.price
            ? ((r.price > old.price ? 'up' : 'down') as 'up' | 'down')
            : null
        return { symbol: r.symbol, price: r.price, change: r.change, flash }
      })

      if (newItems.some(t => t.flash)) {
        setTimeout(() => setTickers(cur => cur.map(t => ({ ...t, flash: null }))), 600)
      }

      return newItems
    })
  }, [watchlistSymbols.join(',')])

  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, 10_000)
    return () => clearInterval(id)
  }, [fetchPrices])

  if (tickers.length === 0) return null

  // Scroll speed scales with count — min 25s, +3s per symbol
  const duration = Math.max(25, tickers.length * 3.5)

  // On mobile, show fewer tickers in a horizontally scrollable container
  if (isMobile) {
    return (
      <div
        style={{
          background:   'var(--bg-panel)',
          borderBottom: '1px solid var(--border)',
          height:       '40px',
          overflow:     'auto',
          position:     'relative',
          msOverflowStyle: 'none',
          scrollBehavior: 'smooth',
        }}
      >
        <style>{`
          .ticker-track-mobile::-webkit-scrollbar { display: none; }
          .ticker-track-mobile { -ms-overflow-style: none; }
        `}</style>
        
        <div className="ticker-track-mobile" style={{
          display: 'flex',
          alignItems: 'center',
          height: '100%',
          gap: '0',
          width: 'max-content',
          minWidth: '100%',
        }}>
          {tickers.map((ticker) => (
            <div
              key={ticker.symbol}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexShrink: 0,
                padding: '2px 12px',
                borderRight: '1px solid var(--border)',
                background:
                  ticker.flash === 'up'
                    ? 'rgba(0,201,122,0.2)'
                    : ticker.flash === 'down'
                    ? 'rgba(255,69,96,0.2)'
                    : 'transparent',
                transition: 'background 0.1s',
                minWidth: '100px',
              }}
            >
              <span style={{
                fontSize: '10px',
                fontFamily: 'Syne, sans-serif',
                fontWeight: 700,
                color: '#fff',
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
              }}>
                {ticker.symbol}
              </span>

              <span style={{
                fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace',
                color: ticker.price != null ? '#fff' : 'var(--text-muted)',
                whiteSpace: 'nowrap',
              }}>
                {ticker.price != null ? ticker.price.toFixed(2) : '···'}
              </span>

              {ticker.change !== null && (
                <span style={{
                  fontSize: '9px',
                  fontFamily: 'JetBrains Mono, monospace',
                  color: ticker.change >= 0 ? 'var(--positive)' : 'var(--negative)',
                  whiteSpace: 'nowrap',
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

  return (
    <div
      style={{
        background:   'var(--bg-panel)',
        borderBottom: '1px solid var(--border)',
        height:       '32px',
        overflow:     'hidden',
        position:     'relative',
      }}
    >
      <style>{`
        @keyframes tickerScroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track {
          display:   flex;
          align-items: center;
          height:    100%;
          animation: tickerScroll ${duration}s linear infinite;
          width:     max-content;
        }
        .ticker-track:hover { animation-play-state: paused; }
      `}</style>

      <div className="ticker-track">
        {[...tickers, ...tickers].map((ticker, idx) => (
          <div
            key={`${ticker.symbol}-${idx}`}
            style={{
              display:     'flex',
              alignItems:  'center',
              gap:         '7px',
              flexShrink:  0,
              padding:     '2px 14px',
              borderRight: '1px solid var(--border)',
              background:
                ticker.flash === 'up'
                  ? 'rgba(0,201,122,0.2)'
                  : ticker.flash === 'down'
                  ? 'rgba(255,69,96,0.2)'
                  : 'transparent',
              transition: 'background 0.1s',
            }}
          >
            <span style={{
              fontSize:       '11px',
              fontFamily:     'Syne, sans-serif',
              fontWeight:     700,
              color:          '#fff',
              letterSpacing:  '0.04em',
            }}>
              {ticker.symbol}
            </span>

            <span style={{
              fontSize:   '12px',
              fontFamily: 'JetBrains Mono, monospace',
              color:      ticker.price != null ? '#fff' : 'var(--text-muted)',
            }}>
              {ticker.price != null ? ticker.price.toFixed(2) : '···'}
            </span>

            {ticker.change !== null && (
              <span style={{
                fontSize:   '10px',
                fontFamily: 'JetBrains Mono, monospace',
                color:      ticker.change >= 0 ? 'var(--positive)' : 'var(--negative)',
              }}>
                {ticker.change >= 0 ? '+' : ''}
                {ticker.change.toFixed(2)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}