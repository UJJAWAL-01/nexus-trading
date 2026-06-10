'use client'

// ─── DataAgeBadge ─────────────────────────────────────────────────────────────
//
// Tells the user how old a number is.  Pass an ISO timestamp (or Date / epoch
// ms) and the badge renders a relative age that updates every 30 seconds.
//
// Color tiers (defaults are tuned for live market panels; override with the
// `freshSecs` and `staleSecs` props for slower-changing data like macro):
//
//   age < freshSecs   → green   "12s ago"
//   age < staleSecs   → amber   "4m ago"
//   age >= staleSecs  → red     "2h ago" + a STALE warning icon
//
// Usage:
//   <DataAgeBadge timestamp={data.fetchedAt} />
//   <DataAgeBadge timestamp={data.lastUpdated} freshSecs={300} staleSecs={3600} />

import { useEffect, useState, type CSSProperties } from 'react'

interface Props {
  timestamp:  string | number | Date | null | undefined
  freshSecs?: number   // default 60s — typical poll interval for live quotes
  staleSecs?: number   // default 600s (10 min)
  prefix?:    string   // text before the age, e.g. "Updated"
  small?:     boolean
  style?:     CSSProperties
}

function relAge(seconds: number): string {
  if (seconds < 0)        return 'just now'
  if (seconds < 60)       return `${Math.round(seconds)}s ago`
  if (seconds < 3600)     return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400)    return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

function parseTs(t: Props['timestamp']): number | null {
  if (t == null) return null
  if (typeof t === 'number') return t
  if (t instanceof Date)     return t.getTime()
  const parsed = Date.parse(t)
  return isNaN(parsed) ? null : parsed
}

export function DataAgeBadge({
  timestamp,
  freshSecs = 60,
  staleSecs = 600,
  prefix,
  small = false,
  style,
}: Props) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const ts = parseTs(timestamp)
  if (ts == null) {
    return (
      <span style={{
        fontSize:   small ? '9px' : '10px',
        color:      'var(--text-muted)',
        fontFamily: 'JetBrains Mono, monospace',
        letterSpacing: '0.06em',
        ...style,
      }}>
        — never
      </span>
    )
  }

  const ageSec = Math.max(0, (now - ts) / 1000)
  const isStale = ageSec >= staleSecs
  const isFresh = ageSec < freshSecs

  const color = isStale ? '#fb923c' : isFresh ? '#00c97a' : 'var(--text-muted)'

  return (
    <span
      title={isStale
        ? `Data is older than ${Math.floor(staleSecs / 60)} minutes — live feed may be unavailable. Original timestamp: ${new Date(ts).toISOString()}`
        : `As of ${new Date(ts).toLocaleString()}`}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            '4px',
        fontSize:       small ? '9px' : '10px',
        color,
        fontFamily:     'JetBrains Mono, monospace',
        letterSpacing:  '0.04em',
        cursor:         'help',
        whiteSpace:     'nowrap',
        ...style,
      }}
    >
      {isStale && <span aria-hidden="true">⚠</span>}
      {prefix && <span style={{ opacity: 0.7 }}>{prefix}</span>}
      <span>{relAge(ageSec)}</span>
    </span>
  )
}

export default DataAgeBadge
