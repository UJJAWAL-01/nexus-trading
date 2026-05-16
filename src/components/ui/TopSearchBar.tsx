'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useActiveSymbol } from '@/store/symbol'
import { useWatchlist } from '@/store/watchlist'

interface SearchResult {
  symbol:   string
  name:     string
  exchange: string
  type:     string
  currency: string
}

const RECENT_KEY = 'nexus-recent-symbols'
const MAX_RECENT = 6

function loadRecent(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string').slice(0, MAX_RECENT) : []
  } catch { return [] }
}

function saveRecent(list: string[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))) } catch {}
}

export default function TopSearchBar() {
  const setActiveSymbol = useActiveSymbol(s => s.setActiveSymbol)
  const watchlist       = useWatchlist(s => s.symbols)
  const addToWatchlist  = useWatchlist(s => s.addSymbol)

  const [input,     setInput]     = useState('')
  const [results,   setResults]   = useState<SearchResult[]>([])
  const [open,      setOpen]      = useState(false)
  const [hi,        setHi]        = useState(0)
  const [loading,   setLoading]   = useState(false)
  const [recent,    setRecent]    = useState<string[]>(() => loadRecent())

  const wrapRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const debounceR  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Responsive placeholder — long version only fits on wider screens
  const [placeholder, setPlaceholder] = useState('Search ticker…')
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      if (w >= 1280)      setPlaceholder('Search ticker… (AAPL · RELIANCE.NS · ^NSEI)')
      else if (w >= 900)  setPlaceholder('Search ticker symbol…')
      else                setPlaceholder('Search ticker…')
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // ── Cmd+K / Ctrl+K to focus ───────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Click-outside closes dropdown ─────────────────────────────────────────
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // ── Debounced search ──────────────────────────────────────────────────────
  const runSearch = useCallback((q: string) => {
    if (debounceR.current) clearTimeout(debounceR.current)
    if (!q.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceR.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`)
        const d = await r.json()
        setResults(Array.isArray(d.results) ? d.results : [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 200)
  }, [])

  const handleInput = (val: string) => {
    setInput(val)
    setHi(0)
    setOpen(true)
    runSearch(val)
  }

  const route = useCallback((symbol: string, opts?: { addToList?: boolean }) => {
    const sym = symbol.trim().toUpperCase()
    if (!sym) return

    setActiveSymbol(sym)

    // Update recent
    const next = [sym, ...recent.filter(s => s !== sym)].slice(0, MAX_RECENT)
    setRecent(next)
    saveRecent(next)

    if (opts?.addToList) addToWatchlist(sym)

    // Scroll to chart panel + flash
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-panel-id="chart"]')
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('panel-focus-flash')
        window.setTimeout(() => el.classList.remove('panel-focus-flash'), 1400)
      }
    })

    setOpen(false)
    setInput('')
    setResults([])
    inputRef.current?.blur()
  }, [setActiveSymbol, recent, addToWatchlist])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      inputRef.current?.blur()
      return
    }
    const list = displayList
    if (!list.length) {
      if (e.key === 'Enter' && input.trim()) {
        e.preventDefault()
        route(input.trim())
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi(i => Math.min(i + 1, list.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = list[hi]
      if (item) route(item.symbol, { addToList: e.shiftKey })
      else if (input.trim()) route(input.trim())
    }
  }

  // ── Display list: search results, OR recent+watchlist suggestions ─────────
  const displayList = useMemo<SearchResult[]>(() => {
    if (input.trim() && results.length) return results.slice(0, 10)
    if (input.trim()) return []
    // No query → suggest recent + watchlist
    const seen = new Set<string>()
    const out: SearchResult[] = []
    for (const s of recent) {
      if (!seen.has(s)) {
        seen.add(s)
        out.push({ symbol: s, name: 'Recent', exchange: '', type: 'RECENT', currency: '' })
      }
    }
    for (const s of watchlist) {
      if (!seen.has(s)) {
        seen.add(s)
        out.push({ symbol: s, name: 'Watchlist', exchange: '', type: 'WATCH', currency: '' })
      }
    }
    return out.slice(0, 10)
  }, [input, results, recent, watchlist])

  const showHint = !input && !open

  return (
    <div ref={wrapRef} className="top-search-wrap">
      <div className={`top-search ${open ? 'is-open' : ''}`}>
        <span className="top-search-icon" aria-hidden>
          {/* magnifying glass */}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          ref={inputRef}
          type="text"
          spellCheck={false}
          autoComplete="off"
          value={input}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Search ticker symbol"
        />
        {input && (
          <button
            type="button"
            onClick={() => { setInput(''); setResults([]); inputRef.current?.focus() }}
            className="top-search-clear"
            aria-label="Clear"
          >
            ✕
          </button>
        )}
        {showHint && (
          <span className="top-search-kbd">
            <kbd>⌘</kbd><kbd>K</kbd>
          </span>
        )}
      </div>

      {open && (
        <div className="top-search-dropdown">
          {loading && (
            <div className="top-search-status">Searching…</div>
          )}
          {!loading && displayList.length === 0 && input.trim() && (
            <div className="top-search-status">
              No matches. Press <kbd>↵</kbd> to load <strong>{input.trim().toUpperCase()}</strong> anyway.
            </div>
          )}
          {!loading && displayList.length === 0 && !input.trim() && (
            <div className="top-search-status">Type to search any global ticker</div>
          )}
          {!loading && displayList.length > 0 && (
            <>
              {!input.trim() && (
                <div className="top-search-section">
                  {recent.length > 0 ? 'RECENT · WATCHLIST' : 'WATCHLIST'}
                </div>
              )}
              {displayList.map((r, i) => (
                <div
                  key={`${r.symbol}-${i}`}
                  className={`top-search-row ${i === hi ? 'is-active' : ''}`}
                  onMouseEnter={() => setHi(i)}
                  onMouseDown={(e) => {
                    e.preventDefault() // keep input focus
                    route(r.symbol, { addToList: e.shiftKey })
                  }}
                >
                  <div className="row-left">
                    <span className="row-symbol">{r.symbol}</span>
                    <span className="row-name">{r.name}</span>
                  </div>
                  <div className="row-right">
                    {r.exchange && <span className="row-exch">{r.exchange}</span>}
                    {r.type && r.type !== 'RECENT' && r.type !== 'WATCH' && (
                      <span className="row-type">{r.type}</span>
                    )}
                    {r.type === 'RECENT' && <span className="row-tag">⏱ recent</span>}
                    {r.type === 'WATCH' && <span className="row-tag">★ watch</span>}
                  </div>
                </div>
              ))}
            </>
          )}
          <div className="top-search-foot">
            <span><kbd>↑↓</kbd> navigate · <kbd>↵</kbd> chart · <kbd>⇧↵</kbd> +watchlist · <kbd>esc</kbd> close</span>
          </div>
        </div>
      )}

      <style>{`
        .top-search-wrap {
          position: relative;
          flex: 1 1 auto;
          width: 100%;
          max-width: 460px;
          min-width: 0;
        }

        .top-search {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 30px;
          padding: 0 8px 0 10px;
          background: var(--bg-deep, rgba(0,0,0,0.35));
          border: 1px solid var(--border);
          border-radius: 4px;
          transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
        }
        .top-search:hover {
          border-color: rgba(240,165,0,0.45);
        }
        .top-search.is-open,
        .top-search:focus-within {
          border-color: var(--amber);
          box-shadow: 0 0 0 3px rgba(240,165,0,0.12);
          background: var(--bg-deep, rgba(0,0,0,0.5));
        }

        .top-search-icon {
          color: var(--text-muted);
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .top-search:focus-within .top-search-icon { color: var(--amber); }

        .top-search input {
          flex: 1;
          min-width: 0;
          background: transparent;
          border: none;
          outline: none;
          color: #fff;
          font-family: 'JetBrains Mono', monospace;
          font-size: 12px;
          letter-spacing: 0.04em;
          padding: 0;
        }
        .top-search input::placeholder {
          color: var(--text-muted);
          letter-spacing: 0.02em;
        }

        .top-search-clear {
          background: none; border: none;
          color: var(--text-muted);
          font-size: 11px;
          cursor: pointer;
          padding: 2px 4px;
          flex-shrink: 0;
        }
        .top-search-clear:hover { color: #fff; }

        .top-search-kbd {
          display: flex; gap: 3px;
          flex-shrink: 0;
        }
        .top-search-kbd kbd,
        .top-search-foot kbd,
        .top-search-status kbd {
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          background: rgba(255,255,255,0.06);
          border: 1px solid var(--border);
          border-radius: 3px;
          padding: 1px 4px;
          color: var(--text-muted);
          line-height: 1;
        }

        /* Dropdown */
        .top-search-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          right: 0;
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: 6px;
          box-shadow: 0 16px 48px rgba(0,0,0,0.65);
          max-height: 70vh;
          overflow-y: auto;
          z-index: 1100;
          font-family: 'JetBrains Mono', monospace;
          animation: top-search-slide 0.12s ease-out;
        }
        @keyframes top-search-slide {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .top-search-section {
          font-size: 9px;
          letter-spacing: 0.14em;
          color: var(--text-muted);
          padding: 8px 12px 4px;
        }

        .top-search-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 12px;
          cursor: pointer;
          border-left: 2px solid transparent;
        }
        .top-search-row.is-active {
          background: rgba(240,165,0,0.07);
          border-left-color: var(--amber);
        }

        .row-left {
          min-width: 0;
          display: flex;
          align-items: baseline;
          gap: 10px;
          flex: 1;
        }
        .row-symbol {
          font-size: 13px;
          color: #fff;
          font-weight: 700;
          letter-spacing: 0.04em;
          flex-shrink: 0;
        }
        .row-name {
          font-size: 11px;
          color: var(--text-2);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .row-right {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
        }
        .row-exch, .row-type, .row-tag {
          font-size: 9px;
          padding: 2px 6px;
          border-radius: 3px;
          letter-spacing: 0.06em;
        }
        .row-exch {
          background: rgba(30,144,255,0.12);
          color: #5fa8ff;
          border: 1px solid rgba(30,144,255,0.25);
        }
        .row-type {
          background: rgba(255,255,255,0.04);
          color: var(--text-muted);
          border: 1px solid var(--border);
        }
        .row-tag {
          background: rgba(240,165,0,0.10);
          color: var(--amber);
          border: 1px solid rgba(240,165,0,0.3);
        }

        .top-search-status {
          padding: 14px 12px;
          font-size: 11px;
          color: var(--text-muted);
          text-align: center;
          line-height: 1.5;
        }
        .top-search-status strong { color: var(--amber); font-weight: 700; }

        .top-search-foot {
          padding: 7px 12px;
          border-top: 1px solid var(--border);
          font-size: 10px;
          color: var(--text-muted);
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(0,0,0,0.2);
        }
        .top-search-foot kbd { font-size: 9px; }

        /* Hide the ⌘K affordance on touch / narrower viewports */
        @media (max-width: 1099px) {
          .top-search-kbd { display: none; }
        }

        /* Tablet & under — slightly tighter */
        @media (max-width: 899px) {
          .top-search-wrap { max-width: 320px; }
          .top-search input { font-size: 12px; }
        }

        /* Mobile — full width, larger tap target */
        @media (max-width: 639px) {
          .top-search-wrap { max-width: none; }
          .top-search { height: 34px; }
          .top-search input { font-size: 13px; }
        }
      `}</style>
    </div>
  )
}
