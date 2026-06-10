'use client'

// ─── DataQualityBadge ─────────────────────────────────────────────────────────
//
// One badge across every panel.  Tells the user, in one glance, whether the
// number they are looking at is:
//
//   live       — coming from a real-time public feed (FRED, Yahoo, NSE, etc.)
//   official   — published primary source (10-K filing, central bank decision)
//   modeled    — derived from real inputs (computed margins, BSM-implied IV)
//   versioned  — static dataset shipped with the build (supply chain JSON,
//                sector ETF holdings snapshot), date-stamped and citable
//   stale      — last known live value but the data is older than the
//                expected freshness window (e.g. a quote from 2 hours ago)
//   unavailable— upstream is unreachable and we have no cached value
//
// Originally extracted from FixedIncomePanel, which set the standard for
// how every other panel should label its numbers.
//
// Usage:
//   <DataQualityBadge kind="live" />
//   <DataQualityBadge kind="versioned" small tooltip="As of 2026-04-12" />

import type { CSSProperties } from 'react'

export type DataQualityKind =
  | 'live' | 'official' | 'modeled' | 'versioned' | 'stale' | 'unavailable'

const META: Record<DataQualityKind, { label: string; color: string; bg: string; icon: string; border: string; defaultTooltip: string }> = {
  live: {
    label:   'LIVE',
    color:   '#00c97a',
    bg:      'rgba(0,201,122,0.12)',
    icon:    '●',
    border:  'rgba(0,201,122,0.3)',
    defaultTooltip: 'Real-time public data feed',
  },
  official: {
    label:   'OFFICIAL',
    color:   '#38bdf8',
    bg:      'rgba(56,189,248,0.12)',
    icon:    '◆',
    border:  'rgba(56,189,248,0.3)',
    defaultTooltip: 'Verbatim primary-source disclosure (filing, central bank decision, etc.)',
  },
  modeled: {
    label:   'MODELED',
    color:   '#f0a500',
    bg:      'rgba(240,165,0,0.12)',
    icon:    '⚙',
    border:  'rgba(240,165,0,0.3)',
    defaultTooltip: 'Computed from real inputs (margins, ratios, derivatives pricing)',
  },
  versioned: {
    label:   'VERSIONED',
    color:   '#a78bfa',
    bg:      'rgba(167,139,250,0.12)',
    icon:    '◈',
    border:  'rgba(167,139,250,0.3)',
    defaultTooltip: 'Static dataset shipped with the build — citable, version-controlled, refreshed on a cadence',
  },
  stale: {
    label:   'STALE',
    color:   '#fb923c',
    bg:      'rgba(251,146,60,0.12)',
    icon:    '◐',
    border:  'rgba(251,146,60,0.3)',
    defaultTooltip: 'Last known live value — live feed unavailable since the timestamp',
  },
  unavailable: {
    label:   'N/A',
    color:   '#94a3b8',
    bg:      'rgba(148,163,184,0.1)',
    icon:    '○',
    border:  'rgba(148,163,184,0.25)',
    defaultTooltip: 'Upstream unavailable, no cached value',
  },
}

interface Props {
  kind:     DataQualityKind
  small?:   boolean
  tooltip?: string
  style?:   CSSProperties
}

export function DataQualityBadge({ kind, small = false, tooltip, style }: Props) {
  const m = META[kind]
  return (
    <span
      title={tooltip ?? m.defaultTooltip}
      style={{
        display:        'inline-flex',
        alignItems:     'center',
        gap:            '4px',
        fontSize:       small ? '9px' : '10px',
        padding:        small ? '1px 5px' : '2px 7px',
        borderRadius:   '2px',
        background:     m.bg,
        color:          m.color,
        border:         `1px solid ${m.border}`,
        fontFamily:     'JetBrains Mono, monospace',
        fontWeight:     700,
        letterSpacing:  '0.06em',
        cursor:         'help',
        flexShrink:     0,
        whiteSpace:     'nowrap',
        lineHeight:     1,
        ...style,
      }}
    >
      <span aria-hidden="true">{m.icon}</span>
      <span>{m.label}</span>
    </span>
  )
}

export default DataQualityBadge
