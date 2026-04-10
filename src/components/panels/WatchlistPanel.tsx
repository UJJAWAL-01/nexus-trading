'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StockRow {
  symbol: string; price: number | null; changePercent: number | null;
  currency: string; exchange: string; longName: string; flash: 'up' | 'down' | null;
}

interface SearchResult { symbol: string; name: string; exchange: string; type: string; }
interface Toast { id: number; msg: string; type: 'ok' | 'err' }

export default function WatchlistPanel() {
  const { symbols, addSymbol, removeSymbol } = useWatchlist()
  const [rows, setRows] = useState<StockRow[]>([])
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [searching, setSearching] = useState(false)
  const [validating, setValidating] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [showDrop, setShowDrop] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])

  const prevRef = useRef<StockRow[]>([])
  const searchTmr = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toastId = useRef(0)

  const toast = useCallback((msg: string, type: 'ok' | 'err' = 'err') => {
    const id = ++toastId.current
    setToasts(p => [...p, { id, msg, type }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3200)
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
          const isYahoo = needsYahooRoute(sym);
          const endpoint = isYahoo 
            ? `/api/yquote?symbol=${encodeURIComponent(sym)}` 
            : `/api/finnhub?endpoint=quote&symbol=${encodeURIComponent(sym)}`;
          
          const res = await fetch(endpoint);
          const d = await res.json();

          const price = isYahoo ? d.price : d.c;
          const pct = isYahoo ? d.change : d.dp;

          if (price == null || price === 0) {
            return prevRef.current.find(r => r.symbol === sym) ?? 
              { symbol: sym, price: null, changePercent: null, currency: 'USD', exchange: '', longName: '', flash: null };
          }

          return {
            symbol: sym,
            price: price,
            changePercent: pct,
            currency: d.currency ?? 'USD',
            exchange: d.exchange ?? (isYahoo ? '' : 'US'),
            longName: d.longName || d.name || '',
            flash: null,
          };
        } catch {
          return prevRef.current.find(r => r.symbol === sym) ?? 
            { symbol: sym, price: null, changePercent: null, currency: 'USD', exchange: '', longName: '', flash: null };
        }
      })
    )

    const withFlash = updates.map(u => {
      const old = prevRef.current.find(r => r.symbol === u.symbol)
      const flash = old?.price && u.price && u.price !== old.price ? (u.price > old.price ? 'up' : 'down') : null
      return { ...u, flash } as StockRow
    })

    prevRef.current = withFlash
    setRows(withFlash)
    setTimeout(() => setRows(p => p.map(r => ({ ...r, flash: null }))), 650)
  }, [symbols])

  useEffect(() => {
    pollPrices();
    const t = setInterval(pollPrices, 10000);
    return () => clearInterval(t);
  }, [pollPrices]);

  // Dropdown / Search logic remains same as your original provided working search...
  const handleInput = (val: string) => {
    setInput(val);
    if (searchTmr.current) clearTimeout(searchTmr.current);
    if (!val.trim()) { setResults([]); setShowDrop(false); return; }
    setSearching(true);
    searchTmr.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val.trim())}`);
        const data = await res.json();
        setResults(data.results ?? []);
        setShowDrop(true);
      } finally { setSearching(false); }
    }, 280);
  }

  const addTicker = async (sym: string) => {
    const upper = sym.toUpperCase().trim();
    if (!upper || symbols.includes(upper)) return;
    setValidating(true);
    try {
      const isYahoo = needsYahooRoute(upper);
      const endpoint = isYahoo ? `/api/yquote?symbol=${upper}` : `/api/finnhub?endpoint=quote&symbol=${upper}`;
      const res = await fetch(endpoint);
      const data = await res.json();
      if ((isYahoo ? data.price : data.c)) {
        addSymbol(upper);
        setAdding(false);
        setInput('');
        setShowDrop(false);
      } else {
        toast("Symbol not found or no data");
      }
    } finally { setValidating(false); }
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Toast Render Logic */}
      <div style={{ position: 'absolute', top: '48px', left: '8px', right: '8px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '4px', pointerEvents: 'none' }}>
        {toasts.map(t => (
          <div key={t.id} style={{ padding: '6px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', background: t.type === 'ok' ? 'rgba(0,201,122,0.15)' : 'rgba(255,69,96,0.15)', border: `1px solid ${t.type === 'ok' ? 'rgba(0,201,122,0.4)' : 'rgba(255,69,96,0.4)'}`, color: t.type === 'ok' ? 'var(--positive)' : 'var(--negative)' }}>
            {t.type === 'ok' ? '✓ ' : '✕ '}{t.msg}
          </div>
        ))}
      </div>

      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" /> WATCHLIST <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{symbols.length}/20</span>
        </div>
        <button onClick={() => { setAdding(!adding); setTimeout(() => inputRef.current?.focus(), 50); }} style={{ background: adding ? 'var(--amber)' : 'transparent', border: '1px solid var(--border)', color: adding ? '#000' : 'var(--text-2)', borderRadius: '3px', padding: '1px 8px', fontSize: '11px', cursor: 'pointer' }}>
          {adding ? '✕' : '+ ADD'}
        </button>
      </div>

      {adding && (
        <div ref={dropRef} style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', position: 'relative', zIndex: 200 }}>
          <input ref={inputRef} value={input} onChange={e => handleInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTicker(input)} placeholder="Search ticker..." style={{ width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border-br)', padding: '6px', color: '#fff', fontSize: '11px' }} />
          {showDrop && results.length > 0 && (
             <div style={{ position: 'absolute', left: '10px', right: '10px', top: '100%', background: '#0d1117', border: '1px solid var(--border)', zIndex: 999 }}>
                {results.map(r => (
                  <div key={r.symbol} onMouseDown={() => addTicker(r.symbol)} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: '11px' }}>
                    <span style={{ color: 'var(--amber)', fontWeight: 700 }}>{r.symbol}</span> - {r.name}
                  </div>
                ))}
             </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {rows.map(row => {
          const isPos = (row.changePercent ?? 0) >= 0;
          return (
            <div key={row.symbol} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', background: row.flash === 'up' ? 'rgba(0,201,122,0.1)' : row.flash === 'down' ? 'rgba(255,69,96,0.1)' : 'transparent' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '12px', color: '#fff' }}>{row.symbol}</div>
                <div style={{ fontSize: '8px', color: 'var(--text-muted)' }}>{row.exchange}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '12px', color: '#fff', fontFamily: 'JetBrains Mono' }}>{fmtPrice(row.price, row.currency)}</div>
                <div style={{ fontSize: '10px', color: isPos ? 'var(--positive)' : 'var(--negative)' }}>
                  {isPos ? '+' : ''}{(row.changePercent ?? 0).toFixed(2)}%
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}