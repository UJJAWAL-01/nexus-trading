'use client'
// src/components/dashboard/CommandBar.tsx
// The command bar: one keyboard-first input that opens symbols, jumps to
// panels, sets price alerts and edits the watchlist. Opened with "/" or
// Ctrl/Cmd+K. The language lives in src/lib/command.ts (pure, tested);
// this file only renders suggestions and carries them out.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COMMAND_EXAMPLES, describeCommand, parseCommand, type Command } from '@/lib/command'
import { useActiveSymbol } from '@/store/symbol'
import { useWatchlist } from '@/store/watchlist'
import { usePriceAlerts } from '@/store/priceAlerts'
import { useLayoutMode } from '@/store/layoutMode'
import { useAlerts } from '@/store/alerts'

export interface PanelTarget { id: string; label: string; description: string }

const MONO = 'var(--font-data)'
const RECENT_KEY = 'nexus-recent-commands'
const MAX_RECENT = 6
const ACCENT = '#a78bfa'

interface SearchHit { symbol: string; name: string; exchange: string }
interface Row { key: string; tag: string; title: string; sub?: string; command: Command; text?: string }

const TAG: Record<Command['kind'], string> = {
  'symbol': 'SYMBOL', 'symbol-panel': 'OPEN', 'panel': 'PANEL', 'alert': 'ALERT',
  'watch': 'WATCH', 'unwatch': 'WATCH', 'layout': 'LAYOUT', 'help': 'HELP', 'hint': 'SYNTAX',
}

function loadRecent(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string' && s.length <= 60).slice(0, MAX_RECENT) : []
  } catch { return [] }
}

/** Scroll a panel into view and flash it. In Pro layout the panel may live on
 *  another tab, so announce the request first and wait for it to mount. */
export function focusPanel(id: string) {
  window.dispatchEvent(new CustomEvent('nexus:focus-panel', { detail: { id } }))
  let tries = 0
  const attempt = () => {
    const el = document.querySelector<HTMLElement>(`[data-panel-id="${CSS.escape(id)}"]`)
    if (el) {
      // Glide to a nearby panel; jump straight to a distant one. A smooth
      // scroll across thousands of pixels is slow and can stall part-way as
      // lazily mounted panels above it change height.
      const top = el.getBoundingClientRect().top
      const far = Math.abs(top) > window.innerHeight * 1.5
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ behavior: far || calm ? 'instant' : 'smooth', block: 'center' })
      // Changing symbol re-lays out the page, which can cancel a scroll in
      // flight or push the panel away. Check twice and correct if needed.
      for (const ms of [900, 1800]) {
        window.setTimeout(() => {
          if (!el.isConnected) return
          const r = el.getBoundingClientRect()
          const visible = r.top < window.innerHeight * 0.8 && r.bottom > window.innerHeight * 0.2
          if (!visible) el.scrollIntoView({ behavior: 'instant', block: 'center' })
        }, ms)
      }
      el.classList.add('panel-focus-flash')
      window.setTimeout(() => el.classList.remove('panel-focus-flash'), 1400)
    } else if (++tries < 25) window.setTimeout(attempt, 80)
  }
  attempt()
}

export default function CommandBar({ panels, onClose, onHelp }: { panels: PanelTarget[]; onClose: () => void; onHelp: () => void }) {
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const [hits, setHits] = useState<{ q: string; rows: SearchHit[] }>({ q: '', rows: [] })
  const [recent] = useState<string[]>(loadRecent)
  const listRef = useRef<HTMLDivElement>(null)

  const panelIds = useMemo(() => panels.map(p => p.id), [panels])
  const labelOf = useCallback((id: string) => panels.find(p => p.id === id)?.label ?? id.toUpperCase(), [panels])

  const commands = useMemo(() => parseCommand(query, panelIds), [query, panelIds])

  // Company-name search for plain one-word queries ("apple" → AAPL).
  const searchTerm = useMemo(() => {
    const t = query.trim()
    return /^[A-Za-z][A-Za-z0-9.&-]{1,30}$/.test(t) ? t : ''
  }, [query])
  useEffect(() => {
    if (!searchTerm) return
    const ctrl = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`, { signal: ctrl.signal })
        const d = (await r.json()) as { results?: SearchHit[] }
        setHits({ q: searchTerm, rows: Array.isArray(d.results) ? d.results.slice(0, 5) : [] })
      } catch { /* aborted or offline: suggestions are optional */ }
    }, 220)
    return () => { ctrl.abort(); window.clearTimeout(timer) }
  }, [searchTerm])

  const rows = useMemo<Row[]>(() => {
    if (!query.trim()) {
      const texts = [...recent, ...COMMAND_EXAMPLES.filter(e => !recent.includes(e))].slice(0, 9)
      return texts.flatMap((text, i) => {
        const c = parseCommand(text, panelIds)[0]
        return c && c.kind !== 'hint' ? [{ key: `ex-${i}`, tag: i < recent.length ? 'RECENT' : 'TRY', title: text, sub: describeCommand(c, labelOf), command: c, text }] : []
      })
    }
    const out: Row[] = commands.map((c, i) => ({
      key: `c-${i}`, tag: TAG[c.kind], title: describeCommand(c, labelOf), command: c,
      sub: c.kind === 'panel' || c.kind === 'symbol-panel' ? panels.find(p => p.id === c.panelId)?.description : undefined,
    }))
    if (hits.q === searchTerm && searchTerm) {
      const have = new Set(commands.filter(c => c.kind === 'symbol').map(c => (c as { symbol: string }).symbol))
      for (const h of hits.rows) {
        if (typeof h.symbol !== 'string' || have.has(h.symbol.toUpperCase())) continue
        out.push({ key: `s-${h.symbol}`, tag: 'SEARCH', title: `Open ${h.symbol}`, sub: [h.name, h.exchange].filter(Boolean).join(' · '), command: { kind: 'symbol', symbol: h.symbol.toUpperCase() } })
      }
    }
    return out
  }, [query, commands, hits, searchTerm, recent, panelIds, panels, labelOf])

  const active = Math.min(hi, Math.max(0, rows.length - 1))

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = useCallback((row: Row) => {
    const c = row.command
    if (c.kind === 'hint') return
    const toast = (title: string, body: string, level: 'info' | 'positive' | 'warn' = 'info') =>
      useAlerts.getState().push({ id: `cmd:${Date.now()}`, title, body, level, source: 'COMMAND', ttlMs: 5000 })

    try {
      const text = (row.text ?? query).trim()
      if (text) localStorage.setItem(RECENT_KEY, JSON.stringify([text, ...loadRecent().filter(r => r !== text)].slice(0, MAX_RECENT)))
    } catch { /* storage unavailable */ }

    onClose()
    switch (c.kind) {
      case 'symbol':
        useActiveSymbol.getState().setActiveSymbol(c.symbol)
        // Pro layout keeps the chart on screen, so show the symbol's research tab.
        requestAnimationFrame(() => focusPanel(useLayoutMode.getState().mode === 'tabs' ? 'stockprofile' : 'chart'))
        break
      case 'symbol-panel':
        useActiveSymbol.getState().setActiveSymbol(c.symbol)
        requestAnimationFrame(() => focusPanel(c.panelId))
        break
      case 'panel':
        requestAnimationFrame(() => focusPanel(c.panelId))
        break
      case 'alert': {
        const result = usePriceAlerts.getState().add({ symbol: c.symbol, kind: c.alertKind, value: c.value })
        if (result === 'ok') toast('Alert set', describeCommand(c, labelOf), 'positive')
        else toast('Alert not set', result === 'duplicate' ? 'That alert already exists.' : result === 'full' ? 'You have reached the alert limit. Delete one first.' : result === 'too-many-symbols' ? 'Alerts can cover at most 25 symbols.' : 'That alert is not valid.', 'warn')
        break
      }
      case 'watch':
        useWatchlist.getState().addSymbol(c.symbol)
        toast('Watchlist', `${c.symbol} added.`, 'positive')
        break
      case 'unwatch':
        useWatchlist.getState().removeSymbol(c.symbol)
        toast('Watchlist', `${c.symbol} removed.`)
        break
      case 'layout':
        useLayoutMode.getState().setMode(c.mode)
        break
      case 'help':
        onHelp()
        break
    }
  }, [query, onClose, onHelp, labelOf])

  return (
    <div onClick={onClose} className="nx-backdrop" style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Command bar" className="nx-dialog" onClick={e => e.stopPropagation()} style={{
        width: 'min(620px, 94vw)', background: 'var(--bg-deep)', border: '1px solid var(--border-br)',
        borderRadius: 8, boxShadow: '0 24px 64px rgba(0,0,0,0.6)', overflow: 'hidden', fontFamily: MONO,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
          <span aria-hidden style={{ padding: '0 0 0 16px', color: ACCENT, fontSize: 15, fontWeight: 700 }}>›</span>
          <input
            autoFocus value={query} maxLength={80} spellCheck={false} autoComplete="off" autoCapitalize="off"
            role="combobox" aria-expanded aria-controls="command-results" aria-activedescendant={rows[active] ? `command-row-${active}` : undefined}
            aria-label="Type a command" placeholder="Symbol, panel or command…  e.g. NVDA options"
            onChange={e => { setQuery(e.target.value); setHi(0) }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(Math.min(active + 1, rows.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(active - 1, 0)) }
              else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); run(rows[active]) }
              else if (e.key === 'Tab' && rows[active]?.text) { e.preventDefault(); setQuery(rows[active].text!); setHi(0) }
            }}
            style={{ flex: 1, padding: '14px 16px 14px 10px', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)', fontSize: 14, fontFamily: 'inherit', minWidth: 0 }}
          />
        </div>

        <div id="command-results" role="listbox" ref={listRef} style={{ maxHeight: '56vh', overflowY: 'auto' }}>
          {rows.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.7 }}>
              Nothing matches that yet.<br />Try a ticker, a panel name, or <span style={{ color: 'var(--text-2)' }}>alert AAPL above 400</span>.
            </div>
          )}
          {rows.map((r, i) => {
            const on = i === active, hint = r.command.kind === 'hint'
            return (
              <div key={r.key} id={`command-row-${i}`} data-row={i} role="option" aria-selected={on}
                onClick={() => run(r)} onMouseEnter={() => setHi(i)}
                style={{
                  padding: '8px 16px', cursor: hint ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'background-color 90ms ease-out, border-color 90ms ease-out', background: on ? 'rgba(167,139,250,0.08)' : 'transparent', borderLeft: `3px solid ${on ? ACCENT : 'transparent'}`,
                }}>
                <span style={{ fontSize: 9, letterSpacing: '0.08em', color: hint ? 'var(--amber)' : ACCENT, border: '1px solid var(--border)', borderRadius: 2, padding: '1px 5px', minWidth: 52, textAlign: 'center', flexShrink: 0 }}>{r.tag}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, color: hint ? 'var(--text-2)' : 'var(--text)', fontWeight: hint ? 400 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</div>
                  {r.sub && <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sub}</div>}
                </div>
                {on && !hint && <span aria-hidden style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>↵</span>}
              </div>
            )
          })}
        </div>

        <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <span>↑↓ choose · ↵ run{!query.trim() ? ' · tab fill' : ''} · esc close</span>
          <span>SYMBOL PANEL · alert · watch · help</span>
        </div>
      </div>
    </div>
  )
}
