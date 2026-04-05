'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

// ── Currency display helpers ──────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',  EUR: '€',  GBP: '£',  JPY: '¥',
  INR: '₹',  CNY: '¥',  CAD: 'C$', AUD: 'A$',
  HKD: 'HK$',SGD: 'S$', KRW: '₩',  BRL: 'R$',
  MXN: '₱',  CHF: '₣',  SEK: 'kr', NOK: 'kr',
  ZAR: 'R',  TRY: '₺',  THB: '฿',  IDR: 'Rp',
  MYR: 'RM', PHP: '₱',  TWD: 'NT$',AED: 'د.إ',
}

function fmtPrice(price: number | null, currency = 'USD'): string {
  if (price == null) return '---'
  const sym = CURRENCY_SYMBOLS[currency] ?? currency + ' '
  // Large prices (JPY, INR, KRW) — no decimals
  if (['JPY', 'KRW', 'IDR'].includes(currency)) return sym + Math.round(price).toLocaleString()
  if (price >= 1000) return sym + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price < 0.01)  return sym + price.toFixed(6)
  if (price < 1)     return sym + price.toFixed(4)
  return sym + price.toFixed(2)
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StockRow {
  symbol:        string
  price:         number | null
  change:        number | null
  changePercent: number | null
  currency:      string
  exchange:      string
  longName:      string
  flash:         'up' | 'down' | null
}

interface SearchResult {
  symbol:   string
  name:     string
  exchange: string
  type:     string
  currency: string
}

interface Toast { id: number; msg: string; type: 'ok' | 'err' }

// ── Component ─────────────────────────────────────────────────────────────────

export default function WatchlistPanel() {
  const { symbols, addSymbol, removeSymbol } = useWatchlist()

  const [rows,      setRows]      = useState<StockRow[]>([])
  const [input,     setInput]     = useState('')
  const [adding,    setAdding]    = useState(false)
  const [searching, setSearching] = useState(false)
  const [validating,setValidating]= useState(false)
  const [results,   setResults]   = useState<SearchResult[]>([])
  const [showDrop,  setShowDrop]  = useState(false)
  const [toasts,    setToasts]    = useState<Toast[]>([])

  const prevRef    = useRef<StockRow[]>([])
  const searchTmr  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const toastId    = useRef(0)

  // ── Toast helpers ────────────────────────────────────────────────────────────

  const toast = useCallback((msg: string, type: 'ok' | 'err' = 'err') => {
    const id = ++toastId.current
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3200)
  }, [])

  // ── Init row list when watchlist changes ──────────────────────────────────

  useEffect(() => {
    setRows(prev => symbols.map(sym => {
      const ex = prev.find(r => r.symbol === sym)
      return ex ?? { symbol: sym, price: null, change: null, changePercent: null, currency: 'USD', exchange: '', longName: '', flash: null }
    }))
  }, [symbols])

  // ── Price polling — globalquote (Yahoo Finance, global) ───────────────────

  const pollPrices = useCallback(async () => {
    if (symbols.length === 0) return
    const updates = await Promise.all(
      symbols.map(async sym => {
        try {
          const res = await fetch(`/api/globalquote?symbol=${encodeURIComponent(sym)}`)
          const d = await res.json()
          if (d.price == null) {
            // Keep stale data if price fetch failed
            const stale = prevRef.current.find(r => r.symbol === sym)
            return stale ?? { symbol: sym, price: null, change: null, changePercent: null, currency: 'USD', exchange: '', longName: '', flash: null }
          }
          return {
            symbol:        sym,
            price:         d.price,
            change:        d.change,
            changePercent: d.changePercent,
            currency:      d.currency ?? 'USD',
            exchange:      d.exchange ?? '',
            longName:      d.longName ?? '',
            flash:         null as 'up' | 'down' | null,
          } satisfies StockRow
        } catch {
          const stale = prevRef.current.find(r => r.symbol === sym)
          return stale ?? { symbol: sym, price: null, change: null, changePercent: null, currency: 'USD', exchange: '', longName: '', flash: null }
        }
      }),
    )

    // Compute flash
    const withFlash: StockRow[] = updates.map(u => {
      const old = prevRef.current.find(r => r.symbol === u.symbol)
      const flash: 'up' | 'down' | null =
        old?.price && u.price && u.price !== old.price
          ? u.price > old.price ? 'up' : 'down'
          : null
      return { ...u, flash }
    })

    prevRef.current = withFlash
    setRows(withFlash)
    // Clear flash after 600ms
    setTimeout(() => setRows(p => p.map(r => ({ ...r, flash: null }))), 650)
  }, [symbols])

  useEffect(() => {
    pollPrices()
    const t = setInterval(pollPrices, 8000)
    return () => clearInterval(t)
  }, [pollPrices])

  // ── Close dropdown on outside click ──────────────────────────────────────

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setShowDrop(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── Search (debounced 280ms) ──────────────────────────────────────────────

  const handleInput = (val: string) => {
    setInput(val)
    if (searchTmr.current !== null) clearTimeout(searchTmr.current)
    if (!val.trim()) { setResults([]); setShowDrop(false); return }
    setSearching(true)
    searchTmr.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val.trim())}`)
        const data = await res.json()
        const list: SearchResult[] = data.results ?? []
        setResults(list)
        setShowDrop(true)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 280)
  }

  // ── Add symbol (from dropdown click or Enter) ─────────────────────────────

  const addTicker = async (sym: string) => {
    const upper = sym.toUpperCase().trim()
    if (!upper) return
    setShowDrop(false)
    setResults([])
    setInput('')

    if (symbols.includes(upper)) {
      toast(`${upper} is already in your watchlist`)
      return
    }
    if (symbols.length >= 20) {
      toast('Watchlist is full (20 max)')
      return
    }

    setValidating(true)
    try {
      const res  = await fetch(`/api/globalquote?symbol=${encodeURIComponent(upper)}`)
      const data = await res.json()

      if (data.price == null) {
        toast(`${upper} — no price data available. Try the full Yahoo Finance symbol (e.g. RELIANCE.NS for Indian NSE)`, 'err')
        return
      }

      addSymbol(upper)
      toast(`${upper} added — ${data.longName || data.exchange || ''}`, 'ok')
      setAdding(false)
    } catch {
      toast('Network error — please try again')
    } finally {
      setValidating(false)
    }
  }

  // ── Exchange badge color ──────────────────────────────────────────────────

  const exchangeColor = (ex: string) => {
    const e = ex.toUpperCase()
    if (e.includes('NSE') || e.includes('NSI')) return '#f97316'
    if (e.includes('BSE') || e.includes('BOM')) return '#ef4444'
    if (e.includes('NASDAQ') || e.includes('NMS')) return '#00e5c0'
    if (e.includes('NYSE') || e.includes('NYQ')) return '#1e90ff'
    if (e.includes('LSE')) return '#a78bfa'
    if (e.includes('TSX')) return '#00c97a'
    return '#7a9ab0'
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>

      {/* Toasts */}
      <div style={{
        position: 'absolute', top: '48px', left: '8px', right: '8px',
        zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px',
        pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '6px 10px', borderRadius: '4px', fontSize: '10px',
            fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.4,
            background: t.type === 'ok' ? 'rgba(0,201,122,0.15)' : 'rgba(255,69,96,0.15)',
            border: `1px solid ${t.type === 'ok' ? 'rgba(0,201,122,0.4)' : 'rgba(255,69,96,0.4)'}`,
            color:   t.type === 'ok' ? 'var(--positive)' : 'var(--negative)',
            animation: 'fadeInDown 0.2s ease',
          }}>
            {t.type === 'ok' ? '✓ ' : '✕ '}{t.msg}
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
            setAdding(v => !v)
            setInput('')
            setResults([])
            setShowDrop(false)
            setTimeout(() => inputRef.current?.focus(), 60)
          }}
          style={{
            background: adding ? 'var(--amber)' : 'transparent',
            border: `1px solid ${adding ? 'var(--amber)' : 'var(--border)'}`,
            color:  adding ? '#000' : 'var(--text-2)',
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
            padding: '8px 10px', borderBottom: '1px solid var(--border)',
            position: 'relative', zIndex: 200,
          }}
        >
          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') addTicker(input.trim())
                if (e.key === 'Escape') { setShowDrop(false); setAdding(false) }
              }}
              onFocus={() => results.length > 0 && setShowDrop(true)}
              placeholder="Company name or ticker (e.g. Reliance, AAPL, RELIANCE.NS)"
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'var(--bg-deep)', border: '1px solid var(--border-br)',
                borderRadius: '3px', padding: '6px 10px',
                color: '#fff', fontFamily: 'JetBrains Mono, monospace',
                fontSize: '11px', outline: 'none',
              }}
            />
            {(searching || validating) && (
              <span style={{
                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                fontSize: '9px', color: 'var(--amber)',
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {validating ? 'validating...' : 'searching...'}
              </span>
            )}
          </div>

          <div style={{ marginTop: '4px', fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            ↵ enter to add · Indian NSE: add .NS suffix (e.g. RELIANCE.NS) · BSE: add .BO
          </div>

          {/* Dropdown */}
          {showDrop && (
            <div style={{
              position: 'absolute', left: '10px', right: '10px',
              top: 'calc(100% - 6px)',
              background: '#0d1117', border: '1px solid var(--border-br)',
              borderRadius: '4px', zIndex: 9999,
              boxShadow: '0 12px 32px rgba(0,0,0,0.9)', overflow: 'hidden',
            }}>
              {results.length === 0 ? (
                <div style={{
                  padding: '12px', textAlign: 'center',
                  fontSize: '10px', color: 'var(--text-muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {searching
                    ? 'Searching...'
                    : `No results for "${input}" — try adding .NS for Indian NSE stocks`}
                </div>
              ) : (
                <>
                  <div style={{
                    padding: '4px 10px', fontSize: '9px',
                    color: 'var(--text-muted)', letterSpacing: '0.1em',
                    borderBottom: '1px solid var(--border)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}>
                    CLICK TO ADD · {results.length} RESULTS
                  </div>
                  {results.map(r => {
                    const exCol = exchangeColor(r.exchange)
                    return (
                      <div
                        key={r.symbol}
                        onMouseDown={e => { e.preventDefault(); addTicker(r.symbol) }}
                        style={{
                          padding: '8px 10px', cursor: 'pointer',
                          borderBottom: '1px solid var(--border)',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(240,165,0,0.08)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <span style={{
                            fontFamily: 'Syne, sans-serif', fontWeight: 700,
                            fontSize: '12px', color: 'var(--amber)', flexShrink: 0, minWidth: '70px',
                          }}>
                            {r.symbol}
                          </span>
                          <span style={{
                            fontSize: '10px', color: 'var(--text-2)',
                            fontFamily: 'JetBrains Mono, monospace',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}>
                            {r.name?.slice(0, 30)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                          {r.exchange && (
                            <span style={{
                              fontSize: '8px', padding: '1px 5px', borderRadius: '2px',
                              fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em',
                              background: exCol + '18', color: exCol, border: `1px solid ${exCol}33`,
                            }}>
                              {r.exchange}
                            </span>
                          )}
                          <span style={{
                            fontSize: '8px', padding: '1px 5px', borderRadius: '2px',
                            fontFamily: 'JetBrains Mono, monospace',
                            background: 'var(--bg-deep)', color: 'var(--text-muted)',
                          }}>
                            {r.type}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stock list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.map(row => {
          const isPos = (row.changePercent ?? row.change ?? 0) >= 0
          return (
            <div
              key={row.symbol}
              style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '7px 12px',
                borderBottom: '1px solid var(--border)',
                background:
                  row.flash === 'up'   ? 'rgba(0,201,122,0.12)' :
                  row.flash === 'down' ? 'rgba(255,69,96,0.12)' : 'transparent',
                transition: 'background 0.15s ease-out',
              }}
            >
              {/* Left: remove + symbol + exchange */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                <button
                  onClick={() => removeSymbol(row.symbol)}
                  title={`Remove ${row.symbol}`}
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)',
                    cursor: 'pointer', fontSize: '10px', padding: '0 2px',
                    lineHeight: 1, opacity: 0.45, transition: 'opacity 0.15s', flexShrink: 0,
                  }}
                  onMouseEnter={e => ((e.target as HTMLElement).style.opacity = '1')}
                  onMouseLeave={e => ((e.target as HTMLElement).style.opacity = '0.45')}
                >✕</button>

                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'Syne, sans-serif', fontWeight: 700,
                    fontSize: '12px', color: '#fff',
                  }}>
                    {row.symbol}
                  </div>
                  {row.exchange && (
                    <div style={{
                      fontSize: '8px', color: exchangeColor(row.exchange),
                      fontFamily: 'JetBrains Mono, monospace',
                    }}>
                      {row.exchange}
                    </div>
                  )}
                </div>
              </div>

              {/* Right: price + change */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#fff',
                }}>
                  {row.price != null
                    ? fmtPrice(row.price, row.currency)
                    : <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>loading</span>}
                </div>
                {row.changePercent != null && (
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
                    color: isPos ? 'var(--positive)' : 'var(--negative)',
                  }}>
                    {isPos ? '+' : ''}{row.changePercent.toFixed(2)}%
                  </div>
                )}
              </div>
            </div>
          )
        })}
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