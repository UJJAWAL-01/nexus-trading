'use client'

// Shared loading / error / empty-state primitives for panels.
// One consistent look across the whole dashboard.

import type { ReactNode, CSSProperties } from 'react'

// ── Skeleton ──────────────────────────────────────────────────────────────────

interface SkeletonProps {
  /** Number of rows to render (default 6) */
  rows?: number
  /** Column widths in px or % — defaults to 4 mixed columns */
  cols?: (number | string)[]
  /** Label shown above the rows (e.g. "Loading watchlist…") */
  label?: string
  /** Tint color for the bars (default panel-amber). Use color tokens. */
  tint?: string
  style?: CSSProperties
}

export function Skeleton({ rows = 6, cols, label, tint = 'rgba(240,165,0,0.10)', style }: SkeletonProps) {
  const colWidths = cols ?? [22, '1fr', 80, 60]
  return (
    <div style={{ flex: 1, overflow: 'hidden', ...style }} role="status" aria-live="polite" aria-busy="true">
      {label && (
        <div style={{
          padding: '8px 12px 4px',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          color: 'var(--text-muted)',
          letterSpacing: '0.08em',
        }}>
          {label}
        </div>
      )}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'grid',
            gridTemplateColumns: colWidths.map(c => typeof c === 'number' ? `${c}px` : c).join(' '),
            gap: 10,
            padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            alignItems: 'center',
            opacity: Math.max(0.25, 1 - i * 0.1),
          }}
        >
          {colWidths.map((_, j) => (
            <div
              key={j}
              style={{
                height: 11,
                background: tint,
                borderRadius: 2,
                animation: 'shimmer 1.4s ease-in-out infinite',
                animationDelay: `${j * 0.1}s`,
              }}
            />
          ))}
        </div>
      ))}
      <style>{`
        @keyframes shimmer {
          0%, 100% { opacity: 0.35; }
          50%      { opacity: 0.75; }
        }
      `}</style>
    </div>
  )
}

// ── Spinner (small, inline) ───────────────────────────────────────────────────

export function Spinner({ size = 18, color = 'var(--amber)' }: { size?: number; color?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{
        width: size, height: size, borderRadius: '50%',
        border: `2px solid var(--border)`,
        borderTopColor: color,
        animation: 'spin 0.8s linear infinite',
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── ErrorState ────────────────────────────────────────────────────────────────

interface ErrorStateProps {
  message: string
  hint?: string
  onRetry?: () => void
  retryLabel?: string
}

export function ErrorState({ message, hint, onRetry, retryLabel = 'Retry' }: ErrorStateProps) {
  return (
    <div
      role="alert"
      style={{
        flex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, padding: '20px 16px',
        fontFamily: 'JetBrains Mono, monospace',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 13, color: 'var(--negative)', fontWeight: 700, letterSpacing: '0.04em' }}>
        ⚠ {message}
      </div>
      {hint && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 320, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: 6,
            padding: '6px 18px',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-2)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.06em',
            cursor: 'pointer',
            minHeight: 36,
            minWidth: 80,
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--amber)'; e.currentTarget.style.color = 'var(--amber)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-2)' }}
        >
          {retryLabel.toUpperCase()}
        </button>
      )}
    </div>
  )
}

// ── EmptyState ────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  message: string
  hint?: string
  action?: ReactNode
  icon?: ReactNode
}

export function EmptyState({ message, hint, action, icon }: EmptyStateProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, padding: '24px 16px',
        fontFamily: 'JetBrains Mono, monospace',
        textAlign: 'center',
      }}
    >
      {icon && <div style={{ fontSize: 22, opacity: 0.5, marginBottom: 4 }}>{icon}</div>}
      <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{message}</div>
      {hint && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', maxWidth: 280, lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  )
}
