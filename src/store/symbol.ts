'use client'

// ─── Active-symbol store ──────────────────────────────────────────────────────
//
// The "selected ticker" that flows through the entire app.  Click GOOGL anywhere
// (news headline, smart-money row, sector tile) → every subscribed panel routes
// to GOOGL: Chart loads it, News filters to it, SmartMoney highlights funds
// that hold it, etc.
//
// Symbol pinning:
//   Each panel can pin a specific symbol independently.  Pinning means the
//   panel ignores future global changes — useful when you want a Chart locked
//   on AAPL while browsing news for other tickers.
//
// URL sync:
//   The active symbol persists to the URL as `?s=AAPL`.  Refreshing the page
//   reopens the same context.  Sharing a URL preserves the symbol focus.
//   We deliberately use a query param (not a path segment) so it doesn't
//   conflict with Next.js routing.
//
// Canonical form (matches db/schema/companies.ts):
//   • US:    "AAPL", "BRK.B"
//   • India: "RELIANCE.NS", "TCS.NS"
//   • Index: "^GSPC", "^NSEI"
//
// `normalizeSymbol()` does opportunistic normalisation: uppercase, trim,
// strip stray whitespace, but never auto-add suffixes (we don't know if
// "RELIANCE" means RELIANCE.NS or RELIANCE.BO).

import { create } from 'zustand'
import { useCallback, useEffect } from 'react'

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeSymbol(input: string | null | undefined): string | null {
  if (input == null) return null
  const s = input.trim().toUpperCase()
  return s === '' ? null : s
}

/**
 * Is this an Indian-listed symbol? NSE/BSE suffixes (.NS/.BO) or the Indian
 * index tickers. Used by US-first panels to show a friendly "India coverage
 * coming soon" state instead of an empty/error view.
 */
export function isIndianSymbol(input: string | null | undefined): boolean {
  const s = normalizeSymbol(input)
  if (!s) return false
  return s.endsWith('.NS') || s.endsWith('.BO') || s === '^NSEI' || s === '^BSESN'
}

// ── Store shape ───────────────────────────────────────────────────────────────

/**
 * Pattern-screener → chart hand-off (spec §4.3). When a screener row is clicked
 * the chart should load the symbol, switch to the scanned timeframe, and draw
 * that exact pattern. `nonce` makes repeat clicks on the same pattern re-fire.
 */
export interface FocusPattern {
  symbol:    string
  patternId: string
  tf:        '1D' | '1W'
  nonce:     number
}

interface SymbolState {
  /** Global active symbol — what the app considers "currently focused". */
  activeSymbol: string | null

  /**
   * Per-panel pin map.  When a panel pins a symbol, it should display the
   * pinned value regardless of global changes.  Empty = panel follows global.
   */
  pinnedByPanel: Record<string, string>

  /** Pending pattern to draw on the chart, consumed by ChartPanel. */
  focusPattern: FocusPattern | null

  // ── Mutations ──────────────────────────────────────────────────────────────
  setActiveSymbol: (s: string | null, opts?: { skipUrlSync?: boolean }) => void
  pinPanel:        (panelId: string, symbol: string) => void
  unpinPanel:      (panelId: string) => void
  focusOnPattern:  (symbol: string, patternId: string, tf: '1D' | '1W') => void
  clearAll:        () => void
}

// ── URL sync helpers ──────────────────────────────────────────────────────────
//
// Implemented on the store directly (rather than as a React hook) so the
// behaviour is consistent for non-React callers too (e.g. background workers
// reading the active symbol).  Effectively a free side-effect.

function readSymbolFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    return normalizeSymbol(params.get('s'))
  } catch { return null }
}

function writeSymbolToUrl(symbol: string | null) {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (symbol) url.searchParams.set('s', symbol)
    else        url.searchParams.delete('s')
    // Replace (not push) so the browser back button isn't polluted with every
    // ticker click.  Use history.replaceState directly to avoid Next.js router
    // navigation reflows.
    window.history.replaceState(null, '', url.toString())
  } catch { /* ignore — non-fatal */ }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useActiveSymbol = create<SymbolState>((set, get) => ({
  // Initialize from URL on first read (client-only via lazy access — SSR
  // gets null which then hydrates to URL value via SymbolUrlSync below).
  activeSymbol:    null,
  pinnedByPanel:   {},
  focusPattern:    null,

  setActiveSymbol: (s, opts) => {
    const norm = normalizeSymbol(s)
    if (norm === get().activeSymbol) return  // no-op for identical updates
    set({ activeSymbol: norm })
    if (!opts?.skipUrlSync) writeSymbolToUrl(norm)
  },

  focusOnPattern: (symbol, patternId, tf) => {
    const norm = normalizeSymbol(symbol)
    if (!norm) return
    set({ activeSymbol: norm, focusPattern: { symbol: norm, patternId, tf, nonce: Date.now() } })
    writeSymbolToUrl(norm)
  },

  pinPanel: (panelId, symbol) => {
    const norm = normalizeSymbol(symbol)
    if (!norm) return
    set(state => ({ pinnedByPanel: { ...state.pinnedByPanel, [panelId]: norm } }))
  },

  unpinPanel: (panelId) => {
    set(state => {
      if (!(panelId in state.pinnedByPanel)) return state
      const next = { ...state.pinnedByPanel }
      delete next[panelId]
      return { pinnedByPanel: next }
    })
  },

  clearAll: () => {
    set({ activeSymbol: null, pinnedByPanel: {}, focusPattern: null })
    writeSymbolToUrl(null)
  },
}))

// ── Hooks ─────────────────────────────────────────────────────────────────────
//
// `useEffectiveSymbol(panelId)` is the API every panel should use to read
// the symbol they should display.  It returns the pinned value when one
// exists for that panel, otherwise the global.

export function useEffectiveSymbol(panelId: string): {
  symbol: string | null
  isPinned: boolean
  pin:   (symbol: string) => void
  unpin: () => void
} {
  const global = useActiveSymbol(s => s.activeSymbol)
  const pinned = useActiveSymbol(s => s.pinnedByPanel[panelId])
  const pin    = useActiveSymbol(s => s.pinPanel)
  const unpin  = useActiveSymbol(s => s.unpinPanel)

  const symbol   = pinned ?? global
  const isPinned = pinned != null

  const pinHere   = useCallback((s: string) => pin(panelId, s),   [pin, panelId])
  const unpinHere = useCallback(()           => unpin(panelId),   [unpin, panelId])

  return { symbol, isPinned, pin: pinHere, unpin: unpinHere }
}

// ── URL sync component ────────────────────────────────────────────────────────
//
// Mount once near the app root (Dashboard.tsx).  Does two things:
//   1. Reads `?s=...` on mount and seeds the store
//   2. Listens for popstate (browser back/forward) and re-syncs
//
// The store already writes to the URL on every setActiveSymbol() call, so this
// component only handles the inbound direction.

export function SymbolUrlSync(): null {
  const setActiveSymbol = useActiveSymbol(s => s.setActiveSymbol)

  useEffect(() => {
    // Seed once on mount
    const initial = readSymbolFromUrl()
    if (initial) setActiveSymbol(initial, { skipUrlSync: true })

    // Handle browser back/forward
    const onPop = () => {
      setActiveSymbol(readSymbolFromUrl(), { skipUrlSync: true })
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [setActiveSymbol])

  return null
}
