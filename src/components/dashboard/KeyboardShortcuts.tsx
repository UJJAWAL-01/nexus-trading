'use client'
// src/components/dashboard/KeyboardShortcuts.tsx
//
// Global keyboard layer:
//   /  or Ctrl/Cmd+K → open the command bar (symbols, panels, alerts, watchlist)
//   Esc      → close any palette / drawer (also dispatches custom event for panels)
//   W        → focus Watchlist panel  (scroll into view + highlight border)
//   C        → focus Chart
//   N        → focus News
//   ?        → show shortcut help
//
// Letter shortcuts are skipped if the user is typing into an input/textarea/
// contenteditable, so they never interfere with normal text entry.

import { useCallback, useEffect, useState } from 'react'
import CommandBar, { focusPanel, type PanelTarget } from './CommandBar'

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

export default function KeyboardShortcuts({ panels }: Props) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen,    setHelpOpen]    = useState(false)

  const close = useCallback(() => {
    setPaletteOpen(false); setHelpOpen(false)
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

      // Ctrl/Cmd+K opens the command bar from anywhere, even while typing.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setPaletteOpen(true); return
      }

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
        <CommandBar panels={panels} onClose={close} onHelp={() => { setPaletteOpen(false); setHelpOpen(true) }} />
      )}
      {helpOpen && <HelpOverlay onClose={close} />}
      {/* Tiny keyboard hint in the corner */}
      <KeyboardHint />
    </>
  )
}

// ── Help overlay (?) ────────────────────────────────────────────────────────
function HelpOverlay({ onClose }: { onClose: () => void }) {
  const rows: { keys: string; label: string }[] = [
    { keys: '/',      label: 'Open the command bar (also Ctrl/Cmd+K)' },
    { keys: '›',      label: 'In the bar: AAPL · NVDA options · alert AAPL above 400 · watch TSLA' },
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
    <div onClick={onClose} className="nx-backdrop" style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" className="nx-dialog" onClick={e => e.stopPropagation()} style={{
        width: 'min(440px, 92vw)', background: 'var(--bg-deep)',
        border: '1px solid var(--border)', borderRadius: '8px', padding: '18px 20px',
        fontFamily: 'var(--font-data)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: '14px', color: '#fff', fontWeight: 700, letterSpacing: '0.1em',
                      marginBottom: '14px' }}>
          KEYBOARD SHORTCUTS
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rows.map(r => (
            <div key={r.keys} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{
                minWidth: '38px', padding: '2px 8px', borderRadius: '3px',
                background: 'rgba(167,139,250,0.10)', border: '1px solid rgba(167,139,250,0.3)',
                color: '#a78bfa', fontSize: '13px', fontWeight: 700, textAlign: 'center',
              }}>
                {r.keys}
              </span>
              <span style={{ fontSize: '13px', color: 'var(--text-2)' }}>{r.label}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: '14px', fontSize: '12px', color: 'var(--text-muted)' }}>
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
      fontSize: '12px', color: 'var(--text-muted)',
      fontFamily: 'var(--font-data)',
      letterSpacing: '0.08em',
      padding: '4px 8px', borderRadius: '3px',
      background: 'rgba(0,0,0,0.4)',
      border: '1px solid var(--border)',
      pointerEvents: 'none',
      userSelect: 'none',
    }}>
      <span style={{ color: '#a78bfa' }}>?</span> shortcuts · <span style={{ color: '#a78bfa' }}>/</span> command bar
    </div>
  )
}
