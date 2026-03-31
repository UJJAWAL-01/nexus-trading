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

interface Toast {
  id: number
  message: string
  type: 'error' | 'success'
}

export default function WatchlistPanel() {
  const { symbols, addSymbol, removeSymbol } = useWatchlist()
  const [stocks,    setStocks]    = useState<StockData[]>([])
  const [input,     setInput]     = useState('')
  const [adding,    setAdding]    = useState(false)
  const [searching, setSearching] = useState(false)
  const [validating,setValidating]= useState(false)
  const [results,   setResults]   = useState<SearchResult[]>([])
  const [toasts,    setToasts]    = useState<Toast[]>([])
  const [showDrop,  setShowDrop]  = useState(false)
  const prevRef       = useRef<StockData[]>([])
  const searchTimeout = useRef<NodeJS.Timeout | undefined>(undefined)
  const dropRef       = useRef<HTMLDivElement>(null)
  const inputRef      = useRef<HTMLInputElement>(null)
  const toastId       = useRef(0)

  const showToast = (message: string, type: 'error' | 'success' = 'error') => {
    const id = ++toastId.current
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3000)
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setShowDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    setStocks(symbols.map(s => ({
      symbol: s, price: null, change: null, flash: null
    })))
  }, [symbols])

  const handleInput = (val: string) => {
  setInput(val)
  clearTimeout(searchTimeout.current)
  
  if (val.length < 1) {
    setResults([])
    setShowDrop(false)
    return
  }

  setSearching(true)
  searchTimeout.current = setTimeout(async () => {
    try {
      const res = await fetch(
        `/api/finnhub?endpoint=search&q=${encodeURIComponent(val)}`
      )
      const data = await res.json()

      // Finnhub returns { count, result: [...] }
      const all = data.result || data.results || []
      
      const filtered = all
        .filter((r: any) =>
          r.symbol &&
          r.description &&
          (r.type === 'Common Stock' || r.type === 'ETP' || r.type === '') &&
          !r.symbol.includes('.') // remove foreign tickers like AAPL.MX
        )
        .slice(0, 7)

      setResults(filtered.map((r: any) => ({
        symbol: r.symbol,
        description: r.description,
        type: r.type || 'Stock',
      })))
      
      // Show dropdown if we have results OR show a "no results" state
      setShowDrop(true)
    } catch (err) {
      setResults([])
      setShowDrop(false)
    } finally {
      setSearching(false)
    }
  }, 280)
}

  const handleSelectFromDropdown = async (sym: string) => {
    // Immediately close dropdown and clear input
    setShowDrop(false)
    setResults([])
    setInput('')

    if (symbols.includes(sym.toUpperCase())) {
      showToast(`${sym} is already in your watchlist`)
      return
    }

    setValidating(true)
    try {
      const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${sym}`)
      const d = await res.json()
      if (!d.c || d.c === 0) {
        showToast(`${sym} — no price data available`, 'error')
        return
      }
      addSymbol(sym.toUpperCase())
      showToast(`${sym} added to watchlist`, 'success')
      setAdding(false)
    } catch {
      showToast('Network error — please try again', 'error')
    } finally {
      setValidating(false)
    }
  }

  const handleManualAdd = async () => {
    const sym = input.trim().toUpperCase()
    if (!sym) return
    await handleSelectFromDropdown(sym)
  }

  // Fetch prices — always keep stale data, never go blank
  const fetchAll = async () => {
    const updates = await Promise.all(
      symbols.map(async symbol => {
        try {
          const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
          const d = await res.json()
          // If rate limited or no data, keep previous value
          if (d.rateLimited || !d.c) {
            const prev = prevRef.current.find(p => p.symbol === symbol)
            return { symbol, price: prev?.price ?? null, change: prev?.change ?? null, flash: null }
          }
          return { symbol, price: d.c, change: d.dp, flash: null }
        } catch {
          const prev = prevRef.current.find(p => p.symbol === symbol)
          return { symbol, price: prev?.price ?? null, change: prev?.change ?? null, flash: null }
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
    const interval = setInterval(fetchAll, 7000)
    return () => clearInterval(interval)
  }, [symbols])

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>

      {/* Toast notifications */}
      <div style={{
        position: 'absolute', top: '48px', left: '8px', right: '8px',
        zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px',
        pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '7px 12px', borderRadius: '4px', fontSize: '11px',
            fontFamily: 'JetBrains Mono, monospace',
            background: t.type === 'error' ? 'rgba(255,69,96,0.15)' : 'rgba(0,201,122,0.15)',
            border: `1px solid ${t.type === 'error' ? 'rgba(255,69,96,0.4)' : 'rgba(0,201,122,0.4)'}`,
            color: t.type === 'error' ? 'var(--negative)' : 'var(--positive)',
            animation: 'fadeInDown 0.2s ease',
          }}>
            {t.type === 'error' ? '✕ ' : '✓ '}{t.message}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" />
          WATCHLIST
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {symbols.length}/20
          </span>
        </div>
        <button
          onClick={() => {
            setAdding(!adding)
            setInput('')
            setResults([])
            setShowDrop(false)
            setTimeout(() => inputRef.current?.focus(), 50)
          }}
          style={{
            background: adding ? 'var(--amber)' : 'transparent',
            border: `1px solid ${adding ? 'var(--amber)' : 'var(--border)'}`,
            color: adding ? '#000' : 'var(--text-2)',
            borderRadius: '3px', padding: '1px 8px',
            fontSize: '11px', cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
          }}
        >
          {adding ? '✕' : '+ ADD'}
        </button>
      </div>

      {/* Search box */}
      {adding && (
        <div
          ref={dropRef}
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid var(--border)',
            position: 'relative',
            zIndex: 200,
          }}
        >
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => handleInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleManualAdd()
                  if (e.key === 'Escape') { setShowDrop(false); setAdding(false) }
                }}
                onFocus={() => results.length > 0 && setShowDrop(true)}
                placeholder="Name or ticker — e.g. Apple or AAPL"
                style={{
                  width: '100%', background: 'var(--bg-deep)',
                  border: '1px solid var(--border-br)',
                  borderRadius: '3px', padding: '6px 10px',
                  color: '#fff', fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '12px', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {searching && (
                <span style={{
                  position: 'absolute', right: '10px', top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '10px', color: 'var(--text-muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>searching...</span>
              )}
              {validating && (
                <span style={{
                  position: 'absolute', right: '10px', top: '50%',
                  transform: 'translateY(-50%)',
                  fontSize: '10px', color: 'var(--amber)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>validating...</span>
              )}
            </div>
          </div>

          {/* Hint text */}
          <div style={{ marginTop: '5px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            ↵ enter to add · or select from dropdown below
          </div>

          {/* Dropdown — rendered inside the ref div so clicks register */}
          {showDrop && (
            <div style={{
              position: 'absolute',
              left: '12px', right: '12px',
              top: 'calc(100% - 8px)',
              background: '#0d1117',
              border: '1px solid var(--border-br)',
              borderRadius: '4px',
              zIndex: 9999,
              boxShadow: '0 12px 32px rgba(0,0,0,0.8)',
              overflow: 'hidden',
            }}>
              {results.length === 0 ? (
                <div style={{
                  padding: '12px', fontSize: '11px',
                  color: 'var(--text-muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                  textAlign: 'center',
                }}>
                  {searching ? 'Searching...' : `No results for "${input}" — try exact ticker`}
                </div>
              ) : (
                <>
                  <div style={{
                    padding: '5px 12px', fontSize: '9px',
                    color: 'var(--text-muted)', letterSpacing: '0.1em',
                    borderBottom: '1px solid var(--border)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    CLICK TO ADD
                  </div>
                  {results.map(r => (
                    <div
                      key={r.symbol}
                      onMouseDown={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        handleSelectFromDropdown(r.symbol)
                      }}
                      style={{
                        padding: '9px 12px', cursor: 'pointer',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,165,0,0.1)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{
                          fontFamily: 'Syne, sans-serif', fontWeight: 700,
                          fontSize: '13px', color: 'var(--amber)', minWidth: '60px',
                        }}>
                          {r.symbol}
                        </span>
                        <span style={{
                          fontSize: '11px', color: 'var(--text-2)',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}>
                          {r.description?.slice(0, 28)}
                        </span>
                      </div>
                      <span style={{
                        fontSize: '9px', color: 'var(--text-muted)',
                        background: 'var(--bg-deep)', padding: '2px 6px',
                        borderRadius: '3px', letterSpacing: '0.06em',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        {r.type}
                      </span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {stocks.map(stock => (
          <div
            key={stock.symbol}
            style={{
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between',
              padding: '7px 14px',
              borderBottom: '1px solid var(--border)',
              background: stock.flash === 'up' ? 'rgba(0,201,122,0.1)'
                : stock.flash === 'down' ? 'rgba(255,69,96,0.1)' : 'transparent',
              transition: 'background 0.15s ease-out',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => removeSymbol(stock.symbol)}
                style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: '10px', padding: '0 2px',
                  lineHeight: 1, opacity: 0.5,
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => ((e.target as HTMLElement).style.opacity = '1')}
                onMouseLeave={e => ((e.target as HTMLElement).style.opacity = '0.5')}
                title={`Remove ${stock.symbol}`}
              >✕</button>
              <span style={{
                fontFamily: 'Syne, sans-serif', fontWeight: 700,
                fontSize: '13px', color: '#fff',
              }}>
                {stock.symbol}
              </span>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: '13px',
                color: '#fff',
              }}>
                {stock.price ? `$${stock.price.toFixed(2)}` : (
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>loading</span>
                )}
              </div>
              <div style={{
                fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
                color: stock.change == null ? 'var(--text-muted)'
                  : stock.change >= 0 ? 'var(--positive)' : 'var(--negative)',
              }}>
                {stock.change != null
                  ? `${stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)}%`
                  : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}