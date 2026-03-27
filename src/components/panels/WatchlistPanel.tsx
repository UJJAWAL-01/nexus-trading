'use client'

import { useEffect, useState, useRef } from 'react'
import { useWatchlist } from '@/store/watchlist'

interface StockData {
  symbol: string
  price: number | null
  change: number | null
  flash: 'up' | 'down' | null
}

interface SearchResult {
  symbol: string
  description: string
  type: string
}

export default function WatchlistPanel() {
  const { symbols, addSymbol, removeSymbol } = useWatchlist()
  const [stocks,      setStocks]      = useState<StockData[]>([])
  const [input,       setInput]       = useState('')
  const [adding,      setAdding]      = useState(false)
  const [searching,   setSearching]   = useState(false)
  const [results,     setResults]     = useState<SearchResult[]>([])
  const [addError,    setAddError]    = useState('')
  const prevRef = useRef<StockData[]>([])
  const searchTimeout = useRef<NodeJS.Timeout | undefined>(undefined)

  useEffect(() => {
    setStocks(symbols.map(s => ({ symbol: s, price: null, change: null, flash: null })))
  }, [symbols])

  // Live search as user types
  const handleInput = (val: string) => {
    setInput(val)
    setAddError('')
    clearTimeout(searchTimeout.current)
    if (val.length < 1) { setResults([]); return }
    setSearching(true)
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/finnhub?endpoint=search&q=${encodeURIComponent(val)}`)
        const data = await res.json()
        const filtered = (data.result || [])
          .filter((r: any) => r.type === 'Common Stock' || r.type === 'ETP')
          .slice(0, 6)
        setResults(filtered.map((r: any) => ({
          symbol: r.symbol, description: r.description, type: r.type
        })))
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  // Validate ticker exists before adding
  const handleAdd = async (sym: string) => {
    const symbol = sym.trim().toUpperCase()
    if (!symbol) return
    if (symbols.includes(symbol)) {
      setAddError(`${symbol} already in watchlist`)
      return
    }
    setSearching(true)
    try {
      const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
      const d = await res.json()
      if (!d.c || d.c === 0) {
        setAddError(`"${symbol}" not found — check the ticker`)
        setSearching(false)
        return
      }
      addSymbol(symbol)
      setInput('')
      setResults([])
      setAdding(false)
      setAddError('')
    } catch {
      setAddError('Network error — try again')
    } finally {
      setSearching(false)
    }
  }

  const fetchAll = async () => {
    const updates = await Promise.all(
      symbols.map(async symbol => {
        try {
          const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
          const d = await res.json()
          if (d.rateLimited || !d.c) return { symbol, price: null, change: null, flash: null }
          return { symbol, price: d.c, change: d.dp, flash: null }
        } catch {
          return { symbol, price: null, change: null, flash: null }
        }
      })
    )

    const withFlash = updates.map(u => {
      const old = prevRef.current.find(p => p.symbol === u.symbol)
      const flash = old?.price && u.price && u.price !== old.price
        ? (u.price > old.price ? 'up' : 'down') as 'up' | 'down'
        : null
      return { ...u, flash }
    })
    prevRef.current = withFlash
    setStocks(withFlash)
    setTimeout(() => setStocks(prev => prev.map(s => ({ ...s, flash: null }))), 600)
  }

  useEffect(() => {
    fetchAll()
    const interval = setInterval(fetchAll, 8000)
    return () => clearInterval(interval)
  }, [symbols])

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" />
          WATCHLIST
        </div>
        <button onClick={() => { setAdding(!adding); setInput(''); setResults([]); setAddError('') }} style={{
          background: adding ? 'var(--amber)' : 'transparent',
          border: `1px solid ${adding ? 'var(--amber)' : 'var(--border)'}`,
          color: adding ? '#000' : 'var(--text-2)',
          borderRadius: '3px', padding: '1px 8px',
          fontSize: '11px', cursor: 'pointer',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          {adding ? '✕ CANCEL' : '+ ADD'}
        </button>
      </div>

      {/* Search box */}
      {adding && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', position: 'relative' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              autoFocus
              value={input}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && input.trim()) handleAdd(input) }}
              placeholder="Search by name or ticker..."
              style={{
                flex: 1, background: 'var(--bg-deep)',
                border: `1px solid ${addError ? 'var(--negative)' : 'var(--border-br)'}`,
                borderRadius: '3px', padding: '6px 10px',
                color: '#fff', fontFamily: 'JetBrains Mono, monospace',
                fontSize: '12px', outline: 'none',
              }}
            />
            {searching && (
              <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: 'var(--text-muted)', fontSize: '11px' }}>
                ...
              </div>
            )}
          </div>

          {/* Error */}
          {addError && (
            <div style={{ marginTop: '5px', fontSize: '11px', color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace' }}>
              ✕ {addError}
            </div>
          )}

          {/* Dropdown results */}
          {results.length > 0 && (
            <div style={{
              position: 'absolute', left: '12px', right: '12px', top: '100%',
              background: '#0d1117', border: '1px solid var(--border-br)',
              borderRadius: '4px', zIndex: 100, overflow: 'hidden',
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            }}>
              {results.map(r => (
                <div
                  key={r.symbol}
                  onClick={() => handleAdd(r.symbol)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,165,0,0.08)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: 'var(--amber)' }}>
                      {r.symbol}
                    </span>
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {r.description?.slice(0, 30)}
                    </span>
                  </div>
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
                    {r.type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stock list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {stocks.map(stock => (
          <div key={stock.symbol} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '7px 14px', borderBottom: '1px solid var(--border)',
            background: stock.flash === 'up' ? 'rgba(0,201,122,0.1)'
              : stock.flash === 'down' ? 'rgba(255,69,96,0.1)' : 'transparent',
            transition: 'background 0.15s ease-out',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button onClick={() => removeSymbol(stock.symbol)} style={{
                background: 'none', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '10px', padding: '0 2px',
                opacity: 0.4, lineHeight: 1,
              }} title="Remove">✕</button>
              <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: '#fff' }}>
                {stock.symbol}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: '#fff' }}>
                {stock.price ? `$${stock.price.toFixed(2)}` : '---'}
              </div>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
                color: stock.change == null ? 'var(--text-muted)'
                  : stock.change >= 0 ? 'var(--positive)' : 'var(--negative)',
              }}>
                {stock.change != null ? `${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%` : '---'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}