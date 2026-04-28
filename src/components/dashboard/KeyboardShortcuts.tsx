'use client'
// src/components/dashboard/KeyboardShortcuts.tsx
//
// Global keyboard layer:
//   /        → open command palette
//   Esc      → close any palette / drawer (also dispatches custom event for panels)
//   W        → focus Watchlist panel  (scroll into view + highlight border)
//   C        → focus Chart
//   N        → focus News
//   ?        → show shortcut help
//
// Letter shortcuts are skipped if the user is typing into an input/textarea/
// contenteditable, so they never interfere with normal text entry.

import { useCallback, useEffect, useMemo, useState } from 'react'

interface PanelTarget { id: string; label: string; description: string }

interface Props {
  panels: PanelTarget[]   // must include id + label for every grid panel
}

const QUICK_KEYS: Record<string, string> = {
  w: 'watchlist',
  c: 'chart',
  n: 'news',
  i: 'indices',
  e: 'earnings',
  o: 'options',
  s: 'sentiment',
  h: 'heatmap',
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false
  const tag = t.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (t.isContentEditable) return true
  return false
}

function focusPanel(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-panel-id="${id}"]`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('panel-focus-flash')
  window.setTimeout(() => el.classList.remove('panel-focus-flash'), 1400)
}

export default function KeyboardShortcuts({ panels }: Props) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen,    setHelpOpen]    = useState(false)
  const [query,       setQuery]       = useState('')

  const close = useCallback(() => {
    setPaletteOpen(false); setHelpOpen(false); setQuery('')
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Esc — always works (closes palettes, dispatches global event)
      if (e.key === 'Escape') {
        if (paletteOpen || helpOpen) { e.preventDefault(); close(); return }
        window.dispatchEvent(new CustomEvent('nexus:escape'))
        return
      }

      // While palette/help open, only Enter/arrows are handled inside the modal
      if (paletteOpen || helpOpen) return

      // Skip letter shortcuts while user is typing
      if (isTypingTarget(e.target)) return

      // Modifier-bearing combos: ignore (Ctrl+W is "close tab", etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return

      if (e.key === '/') {
        e.preventDefault(); setPaletteOpen(true); return
      }
      if (e.key === '?') {
        e.preventDefault(); setHelpOpen(true); return
      }

      const lower = e.key.toLowerCase()
      const target = QUICK_KEYS[lower]
      if (target) {
        e.preventDefault()
        focusPanel(target)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [paletteOpen, helpOpen, close])

  return (
    <>
      {paletteOpen && (
        <CommandPalette
          panels={panels}
          query={query}
          setQuery={setQuery}
          onClose={close}
        />
      )}
      {helpOpen && <HelpOverlay onClose={close} />}
      {/* Tiny keyboard hint in the corner */}
      <KeyboardHint />
      <style>{`
        .panel-focus-flash {
          outline: 2px solid #a78bfa !important;
          outline-offset: 2px !important;
          box-shadow: 0 0 24px rgba(167,139,250,0.35) !important;
          transition: outline 0.2s, box-shadow 0.2s !important;
        }
      `}</style>
    </>
  )
}

// ── Command palette ─────────────────────────────────────────────────────────
function CommandPalette({
  panels, query, setQuery, onClose,
}: {
  panels: PanelTarget[]; query: string
  setQuery: (q: string) => void; onClose: () => void
}) {
  const [hi, setHi] = useState(0)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return panels.slice(0, 12)
    return panels
      .filter(p => p.label.toLowerCase().includes(q) ||
                   p.id.toLowerCase().includes(q) ||
                   p.description.toLowerCase().includes(q))
      .slice(0, 12)
  }, [panels, query])

  // Reset highlight when filter changes
  useEffect(() => { setHi(0) }, [query])

  const select = useCallback((id: string) => {
    onClose()
    // wait one frame for modal to unmount before scrolling
    requestAnimationFrame(() => focusPanel(id))
  }, [onClose])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: '12vh',
      animation: 'palette-fade 0.12s ease-out',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(560px, 92vw)',
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        overflow: 'hidden',
        fontFamily: 'JetBrains Mono, monospace',
      }}>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi(i => Math.min(i + 1, filtered.length - 1)) }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setHi(i => Math.max(i - 1, 0)) }
            if (e.key === 'Enter' && filtered[hi]) { e.preventDefault(); select(filtered[hi].id) }
          }}
          placeholder="Jump to panel — type a name or ID, then ↵"
          style={{
            width: '100%', padding: '14px 16px',
            background: 'transparent', border: 'none', outline: 'none',
            color: '#fff', fontSize: '14px', fontFamily: 'inherit',
            borderBottom: '1px solid var(--border)',
          }}
        />
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)',
                          fontSize: '11px' }}>
              No matches
            </div>
          )}
          {filtered.map((p, i) => (
            <div key={p.id} onClick={() => select(p.id)} onMouseEnter={() => setHi(i)}
                 style={{
              padding: '8px 16px', cursor: 'pointer',
              background: i === hi ? 'rgba(167,139,250,0.08)' : 'transparent',
              borderLeft: i === hi ? '3px solid #a78bfa' : '3px solid transparent',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '12px', color: '#fff', fontWeight: 700,
                              letterSpacing: '0.06em' }}>
                  {p.label}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.description}
                </div>
              </div>
              <span style={{ fontSize: '9px', color: 'var(--text-muted)',
                             padding: '1px 5px', border: '1px solid var(--border)',
                             borderRadius: '2px', flexShrink: 0 }}>
                {p.id}
              </span>
            </div>
          ))}
        </div>
        <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)',
                      fontSize: '10px', color: 'var(--text-muted)',
                      display: 'flex', justifyContent: 'space-between' }}>
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span>{filtered.length} of {panels.length}</span>
        </div>
      </div>
      <style>{`@keyframes palette-fade { from { opacity:0; } to { opacity:1; } }`}</style>
    </div>
  )
}

// ── Help overlay (?) ────────────────────────────────────────────────────────
function HelpOverlay({ onClose }: { onClose: () => void }) {
  const rows: { keys: string; label: string }[] = [
    { keys: '/',      label: 'Open command palette (jump to any panel)' },
    { keys: 'W',      label: 'Focus Watchlist' },
    { keys: 'C',      label: 'Focus Chart' },
    { keys: 'N',      label: 'Focus News' },
    { keys: 'I',      label: 'Focus Indices' },
    { keys: 'E',      label: 'Focus Earnings' },
    { keys: 'O',      label: 'Focus Options' },
    { keys: 'S',      label: 'Focus Sentiment' },
    { keys: 'H',      label: 'Focus Heatmap' },
    { keys: '?',      label: 'Show this help' },
    { keys: 'Esc',    label: 'Close palette / drawer' },
  ]
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 'min(440px, 92vw)', background: 'var(--bg-deep)',
        border: '1px solid var(--border)', borderRadius: '8px', padding: '18px 20px',
        fontFamily: 'JetBrains Mono, monospace',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: '13px', color: '#fff', fontWeight: 700, letterSpacing: '0.1em',
                      marginBottom: '14px' }}>
          KEYBOARD SHORTCUTS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rows.map(r => (
            <div key={r.keys} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                minWidth: '38px', padding: '2px 8px', borderRadius: '3px',
                background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.3)',
                color: '#a78bfa', fontSize: '11px', fontWeight: 700, textAlign: 'center',
              }}>
                {r.keys}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-2)' }}>{r.label}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '14px', fontSize: '10px', color: 'var(--text-muted)' }}>
          Letter shortcuts are disabled while typing in inputs.
        </div>
      </div>
    </div>
  )
}

// ── Tiny corner hint ────────────────────────────────────────────────────────
function KeyboardHint() {
  return (
    <div style={{
      position: 'fixed', left: '10px', bottom: '10px', zIndex: 80,
      fontSize: '10px', color: 'var(--text-muted)',
      fontFamily: 'JetBrains Mono, monospace',
      letterSpacing: '0.08em',
      padding: '4px 8px', borderRadius: '3px',
      background: 'rgba(0,0,0,0.4)',
      border: '1px solid var(--border)',
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      <span style={{ color: '#a78bfa' }}>?</span> shortcuts · <span style={{ color: '#a78bfa' }}>/</span> jump
    </div>
  )
}
