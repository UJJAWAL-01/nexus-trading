'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

// ── Symbol routing ────────────────────────────────────────────────────────────
// Finnhub uses different symbols for some assets. We route problematic ones
// through our Yahoo Finance /api/yquote route instead.

const INDEX_SUPPLEMENTS = ['GLD', 'VIX', 'BTC-USD', 'ETH-USD']

// Symbols that Finnhub doesn't support well — route to Yahoo
function needsYahooRoute(symbol: string): boolean {
  return (
    symbol.endsWith('.NS') ||
    symbol.endsWith('.BO') ||
    symbol.startsWith('^') ||
    symbol.includes('-USD') ||         // Crypto e.g. BTC-USD, ETH-USD
    symbol.includes('=X') ||           // Forex e.g. USDINR=X
    symbol === 'VIX'                   // VIX via Finnhub is unreliable
  )
}

// For Finnhub crypto you need e.g. BINANCE:BTCUSDT
function toFinnhubCrypto(symbol: string): string | null {
  const map: Record<string, string> = {
    'BTC-USD': 'BINANCE:BTCUSDT',
    'ETH-USD': 'BINANCE:ETHUSDT',
    'SOL-USD': 'BINANCE:SOLUSDT',
  }
  return map[symbol] ?? null
}

interface TickerItem {
  symbol:    string
  display:   string    // cleaned display label
  price:     number | null
  change:    number | null
  flash:     'up' | 'down' | null
}

const staleStore = new Map<string, { price: number | null; change: number | null }>()

export default function TickerBar() {
  const { symbols: watchlistSymbols } = useWatchlist()

  // Combined symbol list: watchlist + key indices
  const allSymbols = [...new Set([...watchlistSymbols, ...INDEX_SUPPLEMENTS])]

  const [tickers, setTickers] = useState<TickerItem[]>(
    allSymbols.map(s => ({
      symbol:  s,
      display: s.replace('.NS', '').replace('.BO', '').replace('-USD', '').replace('=X', '').replace('^', ''),
      price:   staleStore.get(s)?.price  ?? null,
      change:  staleStore.get(s)?.change ?? null,
      flash:   null,
    }))
  )

  // Sync ticker list when watchlist changes
  useEffect(() => {
    const combined = [...new Set([...watchlistSymbols, ...INDEX_SUPPLEMENTS])]
    setTickers(prev => {
      const prevMap = new Map(prev.map(t => [t.symbol, t]))
      return combined.map(symbol => prevMap.get(symbol) ?? {
        symbol,
        display: symbol.replace('.NS','').replace('.BO','').replace('-USD','').replace('=X','').replace('^',''),
        price:   staleStore.get(symbol)?.price  ?? null,
        change:  staleStore.get(symbol)?.change ?? null,
        flash:   null,
      })
    })
  }, [watchlistSymbols.join(',')])

  const fetchPrice = useCallback(async (symbol: string): Promise<{ price: number | null; change: number | null }> => {
    // Try Yahoo route first for problematic symbols
    if (needsYahooRoute(symbol)) {
      try {
        const res  = await fetch(`/api/yquote?symbol=${encodeURIComponent(symbol)}`)
        const data = await res.json()
        if (data.price !== null && data.price > 0) {
          return { price: data.price as number, change: data.change as number ?? null }
        }
      } catch {}
      const st = staleStore.get(symbol)
      return { price: st?.price ?? null, change: st?.change ?? null }
    }

    // Try Finnhub for standard US stocks (with crypto fallback)
    const finnhubSym = toFinnhubCrypto(symbol) ?? symbol
    try {
      const res  = await fetch(`/api/finnhub?endpoint=quote&symbol=${finnhubSym}`)
      const data = await res.json()
      if (!data.rateLimited && data.c && data.c > 0) {
        return { price: data.c as number, change: data.dp as number ?? null }
      }
    } catch {}

    // Fallback to Yahoo
    try {
      const res  = await fetch(`/api/yquote?symbol=${encodeURIComponent(symbol)}`)
      const data = await res.json()
      if (data.price !== null && data.price > 0) {
        return { price: data.price as number, change: data.change as number ?? null }
      }
    } catch {}

    const st = staleStore.get(symbol)
    return { price: st?.price ?? null, change: st?.change ?? null }
  }, [])

  const fetchAll = useCallback(async () => {
    const symbols = [...new Set([...watchlistSymbols, ...INDEX_SUPPLEMENTS])]

    // Batch in groups of 5 to avoid hammering APIs
    const results: TickerItem[] = []
    const batchSize = 5

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize)
      const fetched = await Promise.all(
        batch.map(async symbol => {
          const { price, change } = await fetchPrice(symbol)
          if (price !== null) staleStore.set(symbol, { price, change })
          return { symbol, price, change }
        })
      )
      results.push(
        ...fetched.map(({ symbol, price, change }) => ({
          symbol,
          display: symbol.replace('.NS','').replace('.BO','').replace('-USD','').replace('=X','').replace('^',''),
          price,
          change,
          flash: null as null,
        }))
      )
      if (i + batchSize < symbols.length) {
        await new Promise(r => setTimeout(r, 200))
      }
    }

    setTickers(prev => {
      const prevMap = new Map(prev.map(t => [t.symbol, t]))
      const flashMap: Record<string, 'up' | 'down'> = {}

      const next = results.map(r => {
        const old = prevMap.get(r.symbol)
        if (old?.price && r.price && r.price !== old.price) {
          flashMap[r.symbol] = r.price > old.price ? 'up' : 'down'
        }
        return { ...r, flash: flashMap[r.symbol] ?? null }
      })

      if (Object.keys(flashMap).length > 0) {
        setTimeout(() => setTickers(cur => cur.map(t => ({ ...t, flash: null }))), 700)
      }

      return next
    })
  }, [watchlistSymbols.join(','), fetchPrice])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, 12_000)
    return () => clearInterval(id)
  }, [fetchAll])

  const duration = Math.max(20, tickers.length * 4)

  return (
    <div style={{
      background:   'var(--bg-panel)',
      borderBottom: '1px solid var(--border)',
      height:       '32px',
      overflow:     'hidden',
      position:     'relative',
    }}>
      <style>{`
        @keyframes tickerScroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track-m2 {
          display:   flex;
          align-items: center;
          height:    100%;
          animation: tickerScroll ${duration}s linear infinite;
          width:     max-content;
          will-change: transform;
        }
        .ticker-track-m2:hover { animation-play-state: paused; }
      `}</style>

      <div className="ticker-track-m2">
        {[...tickers, ...tickers].map((t, idx) => (
          <div
            key={`${t.symbol}-${idx}`}
            style={{
              display:    'flex',
              alignItems: 'center',
              gap:        '6px',
              flexShrink: 0,
              padding:    '2px 10px',
              borderRight: '1px solid var(--border)',
              background:
                t.flash === 'up'   ? 'rgba(0,201,122,0.2)' :
                t.flash === 'down' ? 'rgba(255,69,96,0.2)'  : 'transparent',
              transition: 'background 0.2s',
            }}
          >
            <span style={{ fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff', letterSpacing: '0.04em' }}>
              {t.display}
            </span>
            <span style={{
              fontSize:   '13px',
              fontFamily: 'JetBrains Mono, monospace',
              color:      t.price != null ? '#fff' : 'var(--text-muted)',
            }}>
              {t.price != null
                ? t.price >= 1000
                  ? t.price.toLocaleString('en-US', { maximumFractionDigits: 2 })
                  : t.price.toFixed(2)
                : '···'}
            </span>
            {t.change !== null && (
              <span style={{
                fontSize:   '11px',
                fontFamily: 'JetBrains Mono, monospace',
                color:      t.change >= 0 ? 'var(--positive)' : 'var(--negative)',
              }}>
                {t.change >= 0 ? '+' : ''}{t.change.toFixed(2)}%
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}