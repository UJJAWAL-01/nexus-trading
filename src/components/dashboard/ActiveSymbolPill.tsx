'use client'

// ─── ActiveSymbolPill ─────────────────────────────────────────────────────────
//
// Compact indicator in the top bar showing the currently-focused symbol.
// Renders nothing when no symbol is active (keeps the bar minimal).
//
// When active:
//   ● AAPL   ✕                ← amber pill with pulsing dot + clear button
//   (hover → "Apple Inc.")    ← tooltip with full company name (resolved lazily)
//
// Clicking the pill (not the X) focuses the chart panel.
// Clicking X clears the active symbol everywhere.
//
// Keyboard: Esc clears the symbol when the pill is focused.

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useActiveSymbol } from '@/store/symbol'

export default function ActiveSymbolPill() {
  const activeSymbol = useActiveSymbol(s => s.activeSymbol)
  const setActive    = useActiveSymbol(s => s.setActiveSymbol)
  const [pulse,    setPulse]    = useState(false)
  const [companyName, setCompanyName] = useState<string | null>(null)

  // Brief amber pulse animation each time the symbol changes — confirms to the
  // user that the click "took" without needing to scroll to the chart.
  useEffect(() => {
    if (!activeSymbol) return
    setPulse(true)
    const t = setTimeout(() => setPulse(false), 900)
    return () => clearTimeout(t)
  }, [activeSymbol])

  // Lazy fetch of company name for the hover tooltip.  Uses the existing
  // /api/globalquote endpoint (cheap, already cached at the route level) so
  // we don't add a new round-trip just for this label.
  useEffect(() => {
    if (!activeSymbol) { setCompanyName(null); return }
    let cancelled = false
    const ctrl = new AbortController()
    fetch(`/api/globalquote?symbol=${encodeURIComponent(activeSymbol)}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : null)
      .then((j: { longName?: string; name?: string } | null) => {
        if (cancelled || !j) return
        setCompanyName(j.longName ?? j.name ?? null)
      })
      .catch(() => { /* AbortError or network — pill still works without name */ })
    return () => { cancelled = true; ctrl.abort() }
  }, [activeSymbol])

  if (!activeSymbol) return null

  const focusChart = () => {
    document.querySelector('[data-panel-id="chart"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const clear = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    setActive(null)
  }

  return (
    <div
      role="group"
      aria-label={`Active symbol: ${activeSymbol}${companyName ? ` (${companyName})` : ''}`}
      title={companyName ? `${activeSymbol} · ${companyName}\nClick to focus chart · ✕ to clear` : `Click to focus chart · ✕ to clear`}
      className="active-symbol-pill"
      data-pulsing={pulse ? 'true' : 'false'}
    >
      <button
        onClick={focusChart}
        onKeyDown={e => { if (e.key === 'Escape') clear(e) }}
        className="active-symbol-pill-main"
        aria-label={`Focus chart on ${activeSymbol}`}
      >
        <span className="active-symbol-pill-dot" />
        <span className="active-symbol-pill-ticker">{activeSymbol}</span>
      </button>
      <button
        onClick={clear}
        className="active-symbol-pill-clear"
        aria-label="Clear active symbol"
      >
        <X size={12} strokeWidth={2.4} />
      </button>

      <style>{`
        .active-symbol-pill {
          display: inline-flex;
          align-items: stretch;
          height: 26px;
          border: 1px solid rgba(240,165,0,0.4);
          background: rgba(240,165,0,0.10);
          border-radius: 4px;
          overflow: hidden;
          font-family: 'JetBrains Mono', monospace;
          transition: box-shadow 0.2s, background 0.2s;
          flex-shrink: 0;
        }
        .active-symbol-pill[data-pulsing="true"] {
          background: rgba(240,165,0,0.25);
          box-shadow: 0 0 12px rgba(240,165,0,0.45);
        }
        .active-symbol-pill-main {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 0 8px 0 10px;
          background: transparent;
          border: none;
          color: var(--amber);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          cursor: pointer;
        }
        .active-symbol-pill-main:hover {
          color: var(--amber-br);
        }
        .active-symbol-pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--amber);
          box-shadow: 0 0 6px var(--amber);
          animation: nexus-pill-blink 2s ease-in-out infinite;
        }
        .active-symbol-pill-ticker { white-space: nowrap; }
        .active-symbol-pill-clear {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          background: transparent;
          border: none;
          border-left: 1px solid rgba(240,165,0,0.3);
          color: rgba(240,165,0,0.65);
          cursor: pointer;
          transition: color 0.15s, background 0.15s;
        }
        .active-symbol-pill-clear:hover {
          color: var(--amber);
          background: rgba(240,165,0,0.18);
        }

        @keyframes nexus-pill-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.45; }
        }

        @media (max-width: 639px) {
          /* On phones, the pill lives in a row of its own under the header.
             Caller is responsible for layout — the pill itself doesn't shrink. */
          .active-symbol-pill { height: 28px; }
        }
      `}</style>
    </div>
  )
}
