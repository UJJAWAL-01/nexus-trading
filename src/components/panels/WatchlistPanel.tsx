'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', CNY: '¥', CAD: 'C$', AUD: 'A$',
}

function fmtPrice(price: number | null, currency = 'USD'): string {
  if (price == null) return '---'
  const sym = CURRENCY_SYMBOLS[currency] ?? currency + ' '
  if (['JPY', 'KRW', 'IDR'].includes(currency)) return sym + Math.round(price).toLocaleString()
  return sym + price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function needsYahooRoute(symbol: string): boolean {
  return (
    symbol.endsWith('.NS') || symbol.endsWith('.BO') ||
    symbol.startsWith('^') || symbol.includes('-USD') ||
    symbol.includes('=X') || symbol === 'VIX'
  )
}

interface StockRow {
  symbol: string; price: number | null; changePercent: number | null;
  currency: string; exchange: string; longName: string; flash: 'up' | 'down' | null;
}

interface SearchResult { symbol: string; name: string; exchange: string; type: string; }
interface Toast { id: number; msg: string; type: 'ok' | 'err' }

export default function WatchlistPanel() {
  const { symbols, addSymbol, removeSymbol } = useWatchlist()
  const [rows, setRows]           = useState<StockRow[]>([])
  const [input, setInput]         = useState('')
  const [adding, setAdding]       = useState(false)
  const [validating, setValidating] = useState(false)
  const [results, setResults]     = useState<SearchResult[]>([])
  const [showDrop, setShowDrop]   = useState(false)
  const [toasts, setToasts]       = useState<Toast[]>([])
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const prevRef    = useRef<StockRow[]>([])
  const searchTmr  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const toastId    = useRef(0)

  const toast = useCallback((msg: string, type: 'ok' | 'err' = 'err') => {
    const id = ++toastId.current
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3000)
  }, [])

  useEffect(() => {
    setRows(prev => symbols.map(sym => {
      const ex = prev.find(r => r.symbol === sym)
      return ex ?? { symbol: sym, price: null, changePercent: null, currency: 'USD', exchange: '', longName: '', flash: null }
    }))
  }, [symbols])

  const pollPrices = useCallback(async () => {
    if (symbols.length === 0) return
    const updates = await Promise.all(
      symbols.map(async sym => {
        try {
          const isYahoo = needsYahooRoute(sym)
          const endpoint = isYahoo
            ? `/api/yquote?symbol=${encodeURIComponent(sym)}`
            : `/api/finnhub?endpoint=quote&symbol=${encodeURIComponent(sym)}`
          const res = await fetch(endpoint)
          const d   = await res.json()
          const price = isYahoo ? d.price : d.c
          const pct   = isYahoo ? d.change : d.dp
          if (price == null || price === 0) {
            return prevRef.current.find(r => r.symbol === sym) ??
              { symbol: sym, price: null, changePercent: null, currency: 'USD', exchange: '', longName: '', flash: null }
          }
          return { symbol: sym, price, changePercent: pct, currency: d.currency ?? 'USD', exchange: d.exchange ?? '', longName: d.longName || d.name || '', flash: null }
        } catch {
          return prevRef.current.find(r => r.symbol === sym) ??
            { symbol: sym, price: null, changePercent: null, currency: 'USD', exchange: '', longName: '', flash: null }
        }
      })
    )
    const withFlash = updates.map(u => {
      const old   = prevRef.current.find(r => r.symbol === u.symbol)
      const flash = old?.price && u.price && u.price !== old.price ? (u.price > old.price ? 'up' : 'down') : null
      return { ...u, flash } as StockRow
    })
    prevRef.current = withFlash
    setRows(withFlash)
    setTimeout(() => setRows(p => p.map(r => ({ ...r, flash: null }))), 650)
  }, [symbols])

  useEffect(() => {
    pollPrices()
    const t = setInterval(pollPrices, 30_000)
    return () => clearInterval(t)
  }, [pollPrices])

  const handleInput = (val: string) => {
    setInput(val)
    if (searchTmr.current) clearTimeout(searchTmr.current)
    if (!val.trim()) { setResults([]); setShowDrop(false); return }
    searchTmr.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/search?q=${encodeURIComponent(val.trim())}`)
        const data = await res.json()
        setResults(data.results ?? [])
        setShowDrop(true)
      } catch {}
    }, 280)
  }

  const addTicker = async (sym: string) => {
    const upper = sym.toUpperCase().trim()
    if (!upper || symbols.includes(upper)) { toast('Already in watchlist', 'err'); return }
    if (symbols.length >= 20) { toast('Max 20 symbols', 'err'); return }
    setValidating(true)
    try {
      const isYahoo = needsYahooRoute(upper)
      const endpoint = isYahoo ? `/api/yquote?symbol=${upper}` : `/api/finnhub?endpoint=quote&symbol=${upper}`
      const res = await fetch(endpoint)
      const data = await res.json()
      if (isYahoo ? data.price : data.c) {
        addSymbol(upper)
        setAdding(false); setInput(''); setShowDrop(false)
        toast(`Added ${upper}`, 'ok')
      } else {
        toast('Symbol not found or no data', 'err')
      }
    } catch { toast('Network error', 'err') }
    setValidating(false)
  }

  const handleRemove = (sym: string) => {
    if (confirmRemove === sym) {
      removeSymbol(sym)
      setConfirmRemove(null)
      setHoveredRow(null)
      toast(`Removed ${sym}`, 'ok')
    } else {
      setConfirmRemove(sym)
      // Auto-cancel confirm after 2.5s
      setTimeout(() => setConfirmRemove(null), 2500)
    }
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>

      {/* Toasts */}
      <div style={{ position: 'absolute', top: '44px', left: '8px', right: '8px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px', pointerEvents: 'none' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '5px 10px', borderRadius: '4px', fontSize: '10px',
            fontFamily: 'JetBrains Mono, monospace',
            background: t.type === 'ok' ? 'rgba(0,201,122,0.15)' : 'rgba(255,69,96,0.15)',
            border: `1px solid ${t.type === 'ok' ? 'rgba(0,201,122,0.4)' : 'rgba(255,69,96,0.4)'}`,
            color: t.type === 'ok' ? 'var(--positive)' : 'var(--negative)',
            animation: 'fadeInDown 0.2s ease',
          }}>
            {t.type === 'ok' ? '✓' : '✕'} {t.msg}
          </div>
        ))}
      </div>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" />
          WATCHLIST
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {symbols.length}/20
          </span>
        </div>
        <button
          onClick={() => { setAdding(!adding); setTimeout(() => inputRef.current?.focus(), 50) }}
          style={{
            background: adding ? 'var(--amber)' : 'transparent',
            border: `1px solid ${adding ? 'var(--amber)' : 'var(--border)'}`,
            color: adding ? '#000' : 'var(--text-2)',
            borderRadius: '3px', padding: '4px 12px',
            fontSize: '11px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 700,
          }}
        >
          {adding ? '✕ CLOSE' : '+ ADD'}
        </button>
      </div>

      {/* Search input */}
      {adding && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', position: 'relative', zIndex: 200 }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTicker(input)}
              placeholder="Ticker or company name…"
              style={{
                flex: 1, background: 'var(--bg-deep)', border: '1px solid var(--border-br)',
                borderRadius: '3px', padding: '6px 10px', color: '#fff',
                fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', outline: 'none',
              }}
            />
            <button
              onClick={() => addTicker(input)}
              disabled={validating}
              style={{
                padding: '6px 12px', borderRadius: '3px', cursor: 'pointer',
                background: 'rgba(0,229,192,0.12)', border: '1px solid var(--teal)',
                color: 'var(--teal)', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              {validating ? '···' : 'ADD'}
            </button>
          </div>

          {showDrop && results.length > 0 && (
            <div style={{
              position: 'absolute', left: '10px', right: '10px', top: '100%',
              background: '#0d1117', border: '1px solid var(--border)',
              borderRadius: '4px', zIndex: 999, boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
              maxHeight: '200px', overflowY: 'auto',
            }}>
              {results.map(r => (
                <div key={r.symbol}
                  onMouseDown={() => { setInput(r.symbol); addTicker(r.symbol) }}
                  style={{
                    padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                    fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ color: 'var(--amber)', fontWeight: 700 }}>{r.symbol}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>{r.name?.slice(0, 24)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rows */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
            No symbols yet. Click + ADD to get started.
          </div>
        )}

        {rows.map(row => {
          const isPos    = (row.changePercent ?? 0) >= 0
          const isHov    = hoveredRow === row.symbol
          const isConfirm = confirmRemove === row.symbol

          return (
            <div
              key={row.symbol}
              onMouseEnter={() => setHoveredRow(row.symbol)}
              onMouseLeave={() => { setHoveredRow(null); setConfirmRemove(null) }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderBottom: '1px solid var(--border)',
                background:
                  row.flash === 'up'   ? 'rgba(0,201,122,0.1)'  :
                  row.flash === 'down' ? 'rgba(255,69,96,0.1)'   :
                  isHov                ? 'rgba(255,255,255,0.02)' : 'transparent',
                transition: 'background 0.15s',
                position: 'relative',
              }}
            >
              {/* Symbol + exchange */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '13px', color: '#fff', fontFamily: 'Syne, sans-serif' }}>
                  {row.symbol}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '1px' }}>
                  {row.exchange || (row.symbol.endsWith('.NS') ? 'NSE' : 'US')}
                </div>
              </div>

              {/* Price + change */}
              <div style={{ textAlign: 'right', marginRight: isHov ? '36px' : '0', transition: 'margin 0.15s' }}>
                <div style={{ fontSize: '13px', color: '#fff', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                  {fmtPrice(row.price, row.currency)}
                </div>
                <div style={{ fontSize: '11px', color: isPos ? 'var(--positive)' : 'var(--negative)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {isPos ? '+' : ''}{(row.changePercent ?? 0).toFixed(2)}%
                </div>
              </div>

              {/* Remove button (appears on hover) */}
              {isHov && (
                <button
                  onClick={() => handleRemove(row.symbol)}
                  title={isConfirm ? 'Click again to confirm' : 'Remove from watchlist'}
                  style={{
                    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                    width: '26px', height: '26px', borderRadius: '4px', cursor: 'pointer',
                    border: `1px solid ${isConfirm ? 'rgba(255,69,96,0.6)' : 'rgba(255,69,96,0.25)'}`,
                    background: isConfirm ? 'rgba(255,69,96,0.2)' : 'rgba(255,69,96,0.08)',
                    color: isConfirm ? '#ff4560' : 'rgba(255,69,96,0.6)',
                    fontSize: isConfirm ? '10px' : '14px', lineHeight: 1,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.15s',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700,
                  }}
                >
                  {isConfirm ? '✓?' : '×'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer hint */}
      {rows.length > 0 && (
        <div style={{
          padding: '4px 12px', borderTop: '1px solid var(--border)',
          fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace',
        }}>
          Hover a symbol → click × to remove (confirm click required)
        </div>
      )}
    </div>
  )
}