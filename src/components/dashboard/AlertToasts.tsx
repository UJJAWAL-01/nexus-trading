'use client'
// src/components/dashboard/AlertToasts.tsx
// Renders the alert queue from the global store. Bottom-right stack, auto-dismiss
// per alert.ttlMs, manual dismiss with the × button.

import { useEffect } from 'react'
import { useAlerts, type AlertLevel } from '@/store/alerts'

const LEVEL_COLOR: Record<AlertLevel, { bg: string; bd: string; fg: string }> = {
  info:     { bg: 'rgba(56,189,248,0.08)',  bd: 'rgba(56,189,248,0.4)',  fg: '#38bdf8' },
  warn:     { bg: 'rgba(240,165,0,0.10)',   bd: 'rgba(240,165,0,0.5)',   fg: '#f0a500' },
  critical: { bg: 'rgba(239,68,68,0.10)',   bd: 'rgba(239,68,68,0.5)',   fg: '#ef4444' },
  positive: { bg: 'rgba(0,201,122,0.08)',   bd: 'rgba(0,201,122,0.4)',   fg: '#00c97a' },
}

const LEVEL_PREFIX: Record<AlertLevel, string> = {
  info: '◆', warn: '⚠', critical: '⚡', positive: '✓',
}

export default function AlertToasts() {
  const alerts  = useAlerts(s => s.alerts)
  const dismiss = useAlerts(s => s.dismiss)

  // Auto-dismiss timers
  useEffect(() => {
    if (alerts.length === 0) return
    const now = Date.now()
    const timers = alerts
      .filter(a => a.ttlMs !== undefined)
      .map(a => {
        const remaining = (a.createdAt + (a.ttlMs ?? 0)) - now
        if (remaining <= 0) { dismiss(a.id); return null }
        return window.setTimeout(() => dismiss(a.id), remaining)
      })
      .filter((t): t is number => t !== null)
    return () => { for (const t of timers) window.clearTimeout(t) }
  }, [alerts, dismiss])

  if (alerts.length === 0) return null

  return (
    <div style={{
      position: 'fixed', right: '12px', bottom: '12px', zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: '6px',
      pointerEvents: 'none', maxWidth: '380px',
    }}>
      {alerts.map(a => {
        const c = LEVEL_COLOR[a.level]
        return (
          <div key={a.id} style={{
            background: 'var(--bg-deep)',
            border: `1px solid ${c.bd}`,
            borderLeft: `3px solid ${c.fg}`,
            borderRadius: '5px',
            padding: '8px 10px',
            pointerEvents: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            fontFamily: 'JetBrains Mono, monospace',
            animation: 'alert-in 0.18s ease-out',
          }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                          gap: '8px', marginBottom: '3px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', minWidth: 0 }}>
                <span style={{ color: c.fg, fontSize: '11px', flexShrink: 0 }}>
                  {LEVEL_PREFIX[a.level]}
                </span>
                <span style={{ fontSize: '9px', color: c.fg, letterSpacing: '0.1em',
                               flexShrink: 0 }}>
                  {a.source}
                </span>
                {a.symbol && (
                  <span style={{ fontSize: '10px', color: '#a78bfa',
                                 padding: '0 4px', borderRadius: '2px',
                                 background: 'rgba(167,139,250,0.10)',
                                 border: '1px solid rgba(167,139,250,0.3)',
                                 fontWeight: 700, flexShrink: 0 }}>
                    {a.symbol}
                  </span>
                )}
                <span style={{ fontSize: '11px', color: '#fff', fontWeight: 700,
                               whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.title}
                </span>
              </div>
              <button onClick={() => dismiss(a.id)} style={{
                background: 'transparent', border: 'none', color: 'var(--text-muted)',
                cursor: 'pointer', fontSize: '14px', padding: 0, lineHeight: 1,
                flexShrink: 0,
              }}>×</button>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-2)', lineHeight: 1.4 }}>
              {a.body}
            </div>
          </div>
        )
      })}
      <style>{`
        @keyframes alert-in {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  )
}
