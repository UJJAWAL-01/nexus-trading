'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import GridLayoutBase, {
  WidthProvider,
  type Layout,
  type LayoutItem,
} from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import AlternativeSignalsPanel from '@/components/panels/AlternativeSignalsPanel'
import ChartPanel              from '@/components/panels/ChartPanel'
import EarningsPanel           from '@/components/panels/EarningsPanel'
import EconomicCalendarPanel   from '@/components/panels/EconomicCalendarPanel'
import GlobalIndicesPanel      from '@/components/panels/GlobalIndicesPanel'
import MacroPanel              from '@/components/panels/MacroPanel'
import NewsFeedPanel           from '@/components/panels/NewsFeedPanel'
import SectorHeatmapPanel      from '@/components/panels/SectorHeatmapPanel'
import SentimentPanel          from '@/components/panels/SentimentPanel'
import WatchlistPanel          from '@/components/panels/WatchlistPanel'

const ReactGridLayout = WidthProvider(GridLayoutBase)

// ── Panel registry ────────────────────────────────────────────────────────────

const PANEL_IDS = [
  'chart', 'indices', 'watchlist', 'news',
  'sentiment', 'calendar', 'heatmap', 'altsignals',
  'macro', 'earnings',
] as const

type PanelId = (typeof PANEL_IDS)[number]
type DashboardLayoutItem = LayoutItem & { i: PanelId }
type DashboardLayout = DashboardLayoutItem[]

interface PanelMeta {
  component: ReactNode
  label:     string
  color?:    string
  icon?:     string
}

const PANEL_META: Record<PanelId, PanelMeta> = {
  chart:      { component: <ChartPanel />,            label: 'CHART',       color: 'var(--teal)',  icon: '📈' },
  indices:    { component: <GlobalIndicesPanel />,     label: 'INDICES',     color: '#1e90ff',      icon: '🌐' },
  watchlist:  { component: <WatchlistPanel />,         label: 'WATCHLIST',   color: 'var(--amber)', icon: '⭐' },
  news:       { component: <NewsFeedPanel />,          label: 'INTEL FEED',  color: 'var(--amber)', icon: '📰' },
  sentiment:  { component: <SentimentPanel />,         label: 'SENTIMENT',   color: 'var(--teal)',  icon: '🧭' },
  calendar:   { component: <EconomicCalendarPanel />,  label: 'CALENDAR',    color: '#ff4560',      icon: '📅' },
  heatmap:    { component: <SectorHeatmapPanel />,     label: 'HEATMAP',     color: 'var(--teal)',  icon: '🔥' },
  altsignals: { component: <AlternativeSignalsPanel />,label: 'ALT SIGNALS', color: '#a78bfa',      icon: '🌙' },
  macro:      { component: <MacroPanel />,             label: 'MACRO',       color: '#1e90ff',      icon: '🏛️' },
  earnings:   { component: <EarningsPanel />,          label: 'EARNINGS',    color: '#f0a500',      icon: '📊' },
}

// ── Default layout ────────────────────────────────────────────────────────────

const DEFAULT_LAYOUT: DashboardLayout = [
  { i: 'chart',      x: 0,  y: 0,  w: 8, h: 15, minW: 3, minH: 8  },
  { i: 'indices',    x: 8,  y: 0,  w: 2, h: 15, minW: 2, minH: 6  },
  { i: 'watchlist',  x: 10, y: 0,  w: 2, h: 15, minW: 2, minH: 6  },
  { i: 'news',       x: 0,  y: 15, w: 6, h: 12, minW: 3, minH: 6  },
  { i: 'sentiment',  x: 6,  y: 15, w: 3, h: 12, minW: 2, minH: 6  },
  { i: 'calendar',   x: 9,  y: 15, w: 3, h: 12, minW: 2, minH: 6  },
  { i: 'heatmap',    x: 0,  y: 27, w: 5, h: 11, minW: 3, minH: 6  },
  { i: 'macro',      x: 5,  y: 27, w: 3, h: 11, minW: 2, minH: 6  },
  { i: 'altsignals', x: 8,  y: 27, w: 4, h: 11, minW: 2, minH: 6  },
  { i: 'earnings',   x: 0,  y: 38, w: 12, h: 12, minW: 4, minH: 6 },
]

// ── localStorage keys ─────────────────────────────────────────────────────────
// IMPORTANT: We try all previous keys as migration sources so the user
// never loses their saved layout on upgrade.

const LAYOUT_KEYS = [
  'nexus-drag-layout-v4',  // current
  'nexus-drag-layout-v3',  // previous
  'nexus-drag-layout-v2',  // older
] as const
const CURRENT_LAYOUT_KEY = LAYOUT_KEYS[0]
const HIDDEN_KEY          = 'nexus-hidden-panels-v1'

// ── Validation helpers ────────────────────────────────────────────────────────

function isFiniteNum(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v) }
function isPanelId(v: unknown):   v is PanelId { return typeof v === 'string' && PANEL_IDS.includes(v as PanelId) }

function isDashItem(v: unknown): v is DashboardLayoutItem {
  if (!v || typeof v !== 'object') return false
  const x = v as Record<string, unknown>
  return isPanelId(x.i) && isFiniteNum(x.x) && isFiniteNum(x.y) && isFiniteNum(x.w) && isFiniteNum(x.h)
}

function clone<T extends LayoutItem>(l: readonly T[]): T[] {
  return l.map(x => ({ ...x })) as T[]
}

/**
 * Accept ANY saved layout that has at least 2 known panels.
 * This is intentionally lenient so old layouts (from v3 key) still load.
 */
function parseLayout(raw: string): DashboardLayout | null {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const valid = parsed.filter(isDashItem)
    if (valid.length < 2) return null
    return clone(valid)
  } catch { return null }
}

/**
 * Merge a saved layout with defaults:
 * - Keep positions/sizes from saved layout for panels that exist
 * - Append any panels that are missing (new panels from upgrades)
 * - Remove panels whose IDs are no longer valid
 */
function mergeWithDefaults(saved: DashboardLayout): DashboardLayout {
  const have = new Set(saved.map(x => x.i))
  const merged = clone(saved).filter(x => isPanelId(x.i)) // strip unknown IDs

  // Find the max Y of existing items to place new panels below
  const maxY = merged.reduce((m, x) => Math.max(m, x.y + x.h), 0)
  let offsetY = 0

  PANEL_IDS.forEach(pid => {
    if (!have.has(pid)) {
      const def = DEFAULT_LAYOUT.find(d => d.i === pid)
      if (def) {
        // Place new panel below existing content
        merged.push({ ...def, y: maxY + offsetY })
        offsetY += def.h + 1
      }
    }
  })
  return merged
}

/**
 * Load layout — tries current key first, then older keys for migration.
 * This ensures the user's saved layout is NEVER lost on upgrade.
 */
function loadLayout(): DashboardLayout {
  if (typeof window === 'undefined') return clone(DEFAULT_LAYOUT)

  // Try each key in order (current first, then older versions)
  for (const key of LAYOUT_KEYS) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = parseLayout(raw)
      if (!parsed) continue

      // If we loaded from an older key, migrate to current key
      if (key !== CURRENT_LAYOUT_KEY) {
        const migrated = mergeWithDefaults(parsed)
        localStorage.setItem(CURRENT_LAYOUT_KEY, JSON.stringify(migrated))
        // Optionally remove old key to keep localStorage clean
        // localStorage.removeItem(key)
        return migrated
      }

      return mergeWithDefaults(parsed)
    } catch { continue }
  }

  return clone(DEFAULT_LAYOUT)
}

function saveLayout(l: DashboardLayout) {
  try { localStorage.setItem(CURRENT_LAYOUT_KEY, JSON.stringify(l)) } catch {}
}

function loadHidden(): Set<PanelId> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (!raw) return new Set()
    const arr = JSON.parse(raw) as unknown[]
    return new Set(arr.filter(isPanelId))
  } catch { return new Set() }
}

function saveHidden(h: Set<PanelId>) {
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...h])) } catch {}
}

// ── GridLayout component ──────────────────────────────────────────────────────

export default function GridLayout() {
  const [mounted,   setMounted]   = useState(false)
  const [editing,   setEditing]   = useState(false)
  const [layout,    setLayout]    = useState<DashboardLayout>(() => loadLayout())
  const [hidden,    setHidden]    = useState<Set<PanelId>>(() => loadHidden())
  const [saved,     setSaved]     = useState(false)

  const origLayoutRef = useRef<DashboardLayout>(clone(DEFAULT_LAYOUT))
  const origHiddenRef = useRef<Set<PanelId>>(new Set())
  const timerRef      = useRef<number | null>(null)

  useEffect(() => {
    const f = window.requestAnimationFrame(() => setMounted(true))
    return () => {
      window.cancelAnimationFrame(f)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const flashSaved = () => {
    setSaved(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { setSaved(false); timerRef.current = null }, 2200)
  }

  const handleStartEdit = () => {
    origLayoutRef.current = clone(layout)
    origHiddenRef.current = new Set(hidden)
    setEditing(true)
  }

  const handleSave = () => {
    saveLayout(layout)
    saveHidden(hidden)
    setEditing(false)
    flashSaved()
  }

  const handleCancel = () => {
    setLayout(clone(origLayoutRef.current))
    setHidden(new Set(origHiddenRef.current))
    setEditing(false)
  }

  const handleReset = () => {
    const next = clone(DEFAULT_LAYOUT)
    const nh: Set<PanelId> = new Set()
    origLayoutRef.current = clone(next)
    origHiddenRef.current = nh
    setLayout(next)
    setHidden(nh)
    saveLayout(next)
    saveHidden(nh)
    setEditing(false)
    flashSaved()
  }

  const handleLayoutChange = (next: Layout) => {
    if (!editing) return
    const valid = next.filter(isDashItem) as DashboardLayoutItem[]
    if (valid.length >= 2) setLayout(mergeWithDefaults(valid))
  }

  const hidePanel = (pid: PanelId) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.add(pid)
      // Auto-save hide even outside edit mode — hide is instant UX
      saveHidden(next)
      return next
    })
  }

  const showPanel = (pid: PanelId) => {
    setHidden(prev => {
      const next = new Set(prev)
      next.delete(pid)
      saveHidden(next)
      return next
    })
  }

  if (!mounted) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '60vh', color: 'var(--text-muted)',
        fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', letterSpacing: '0.1em',
      }}>
        LOADING NEXUS...
      </div>
    )
  }

  const visibleLayout = layout.filter(item => !hidden.has(item.i))
  const hiddenPanels  = PANEL_IDS.filter(pid => hidden.has(pid))

  return (
    <div style={{ padding: '0 8px 40px' }}>

      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        flexWrap: 'wrap', gap: '6px', padding: '6px 0',
        position: 'sticky', top: '46px', zIndex: 50,
        background: 'var(--bg-base)',
        borderBottom: editing ? '1px solid rgba(240,165,0,0.2)' : '1px solid transparent',
        transition: 'border-color 0.2s',
      }}>

        {editing && (
          <span style={{
            fontSize: '11px', color: 'var(--amber)',
            fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em',
            marginRight: 'auto', marginLeft: '4px',
          }}>
            drag headers to move · resize from corner · 👁 hide panel
          </span>
        )}

        {/* Restore hidden panels */}
        {hiddenPanels.length > 0 && !editing && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginRight: 'auto' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              HIDDEN:
            </span>
            {hiddenPanels.map(pid => (
              <button
                key={pid}
                onClick={() => showPanel(pid)}
                title="Click to restore"
                style={{
                  padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  border: `1px solid ${PANEL_META[pid].color ?? 'var(--border)'}`,
                  background: `${PANEL_META[pid].color ?? '#fff'}12`,
                  color: PANEL_META[pid].color ?? 'var(--text-muted)',
                }}
              >
                {PANEL_META[pid].icon} + {PANEL_META[pid].label}
              </button>
            ))}
          </div>
        )}

        {saved && !editing && (
          <span style={{ fontSize: '10px', color: 'var(--positive)', fontFamily: 'JetBrains Mono, monospace' }}>
            layout saved ✓
          </span>
        )}

        {!editing ? (
          <>
            <button onClick={handleStartEdit} style={btnStyle('muted')}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--amber)'; e.currentTarget.style.color = 'var(--amber)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}>
              Edit layout
            </button>
            <button onClick={handleReset} style={btnStyle('muted')}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}>
              Reset
            </button>
          </>
        ) : (
          <>
            <button onClick={handleCancel} style={btnStyle('muted')}>Cancel</button>
            <button onClick={handleSave}   style={btnStyle('amber')}>Save layout</button>
          </>
        )}
      </div>

      {/* ── Grid ──────────────────────────────────────────────────────── */}
      <div style={{ marginTop: '8px' }}>
        <ReactGridLayout
          layout={visibleLayout}
          cols={12}
          rowHeight={30}
          margin={[8, 8]}
          containerPadding={[0, 0]}
          isDraggable={editing}
          isResizable={editing}
          draggableHandle=".nexus-drag-handle"
          onLayoutChange={handleLayoutChange}
          useCSSTransforms
          compactType="vertical"
        >
          {visibleLayout.map(({ i }) => {
            const meta = PANEL_META[i]
            return (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                outline: editing ? '1px solid rgba(240,165,0,0.18)' : 'none',
                borderRadius: '6px', transition: 'outline 0.2s',
              }}>
                {editing && (
                  <div
                    className="nexus-drag-handle"
                    style={{
                      height: '28px', flexShrink: 0,
                      background: 'rgba(240,165,0,0.06)',
                      borderBottom: '1px solid rgba(240,165,0,0.18)',
                      display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 10px', cursor: 'grab',
                      borderRadius: '6px 6px 0 0', userSelect: 'none',
                    }}
                    onMouseDown={e => (e.currentTarget.style.cursor = 'grabbing')}
                    onMouseUp={e   => (e.currentTarget.style.cursor = 'grab')}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {meta.icon} DRAG
                      </span>
                      <span style={{
                        fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700,
                        color: meta.color ?? 'var(--amber)', letterSpacing: '0.1em',
                      }}>
                        {meta.label}
                      </span>
                    </div>

                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => hidePanel(i as PanelId)}
                      title="Hide this panel"
                      style={{
                        background: 'none', border: '1px solid var(--border)',
                        color: 'var(--text-muted)', cursor: 'pointer',
                        fontSize: '9px', padding: '1px 7px', borderRadius: '3px',
                        fontFamily: 'JetBrains Mono, monospace',
                        transition: 'all 0.12s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = '#ff4560'; e.currentTarget.style.color = '#ff4560' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                    >
                      👁 Hide
                    </button>
                  </div>
                )}

                <div style={{
                  flex: 1, overflow: 'hidden', minHeight: 0,
                  borderRadius: editing ? '0 0 6px 6px' : '6px',
                }}>
                  {meta.component}
                </div>
              </div>
            )
          })}
        </ReactGridLayout>
      </div>

      <style>{`
        .react-grid-item { transition: none !important; }
        .react-grid-item.cssTransforms {
          transition-property: transform !important;
          transition-duration: 120ms !important;
          transition-timing-function: ease-out !important;
        }
        .react-grid-item.react-grid-placeholder {
          background: rgba(240,165,0,0.06) !important;
          border: 1px dashed rgba(240,165,0,0.35) !important;
          border-radius: 6px !important;
          opacity: 1 !important;
          z-index: 2 !important;
        }
        .react-resizable-handle {
          background: none !important;
          border-right:  2px solid rgba(240,165,0,0.65) !important;
          border-bottom: 2px solid rgba(240,165,0,0.65) !important;
          border-radius: 0 0 4px 0 !important;
          width: 14px !important; height: 14px !important;
          opacity: ${editing ? 1 : 0} !important;
          transition: opacity 0.2s !important;
        }
        .nexus-drag-handle { user-select: none; }
      `}</style>
    </div>
  )
}

function btnStyle(variant: 'muted' | 'amber'): React.CSSProperties {
  return {
    padding: '4px 14px', borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
    border:     variant === 'amber' ? '1px solid var(--amber)' : '1px solid var(--border)',
    background: variant === 'amber' ? 'rgba(240,165,0,0.15)' : 'transparent',
    color:      variant === 'amber' ? 'var(--amber)' : 'var(--text-muted)',
    fontWeight: variant === 'amber' ? 700 : 400,
    boxShadow:  variant === 'amber' ? '0 0 10px rgba(240,165,0,0.12)' : 'none',
    transition: 'all 0.15s',
  }
}