'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import GridLayoutBase, { WidthProvider, type Layout, type LayoutItem } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

// ── Panel imports ─────────────────────────────────────────────────────────────
import AlternativeSignalsPanel  from '@/components/panels/AlternativeSignalsPanel'
import ChartPanel               from '@/components/panels/ChartPanel'
import CorrelationPanel         from '@/components/panels/CorrelationPanel'
import EarningsPanel            from '@/components/panels/EarningsPanel'
import EconomicCalendarPanel    from '@/components/panels/EconomicCalendarPanel'
import GlobalIndicesPanel       from '@/components/panels/GlobalIndicesPanel'
import IndiaMarketsPanel        from '@/components/panels/IndiaMarketsPanel'
import LiveFinanceVideoPanel    from '@/components/panels/LiveFinanceVideoPanel'
import MacroRatesPanel          from '@/components/panels/MacroRatesPanel'
import MarketClockPanel         from '@/components/panels/MarketClockPanel'
import NewsFeedPanel            from '@/components/panels/NewsFeedPanel'
import SectorHeatmapPanel       from '@/components/panels/SectorHeatmapPanel'
import SentimentPanel           from '@/components/panels/SentimentPanel'
import WatchlistPanel           from '@/components/panels/WatchlistPanel'

const ReactGridLayout = WidthProvider(GridLayoutBase)

// ── Panel registry ────────────────────────────────────────────────────────────

const PANEL_IDS = [
  'chart', 'indices', 'watchlist', 'news',
  'sentiment', 'calendar', 'heatmap', 'altsignals',
  'indiamarkets', 'macrorates',
  'earnings', 'mktclock', 'livevideo', 'correlation',
] as const

type PanelId = (typeof PANEL_IDS)[number]
type DashboardLayoutItem = LayoutItem & { i: PanelId }
type DashboardLayout     = DashboardLayoutItem[]

type PanelMeta = { component: ReactNode; label: string; color?: string }

const PANEL_META: Record<PanelId, PanelMeta> = {
  chart:         { component: <ChartPanel />,               label: 'CHART',         color: 'var(--teal)'     },
  livevideo:     { component: <LiveFinanceVideoPanel />,     label: 'LIVE TV',       color: '#ff4560'         },
  indices:       { component: <GlobalIndicesPanel />,        label: 'INDICES',       color: '#1e90ff'         },
  mktclock:      { component: <MarketClockPanel />,          label: 'WORLD CLOCK',   color: '#00c97a'         },
  watchlist:     { component: <WatchlistPanel />,            label: 'WATCHLIST',     color: 'var(--amber)'    },
  news:          { component: <NewsFeedPanel />,             label: 'INTEL FEED',    color: 'var(--amber)'    },
  sentiment:     { component: <SentimentPanel />,            label: 'SENTIMENT',     color: 'var(--teal)'     },
  calendar:      { component: <EconomicCalendarPanel />,     label: 'ECON CALENDAR', color: '#ff4560'         },
  correlation:   { component: <CorrelationPanel />,          label: 'CORRELATION',   color: '#1e90ff'         },
  indiamarkets:  { component: <IndiaMarketsPanel />,         label: 'INDIA MKTS',    color: '#f97316'         },
  heatmap:       { component: <SectorHeatmapPanel />,        label: 'HEATMAP',       color: 'var(--teal)'     },
  altsignals:    { component: <AlternativeSignalsPanel />,   label: 'ALT SIGNALS',   color: '#a78bfa'         },
  macrorates:    { component: <MacroRatesPanel />,           label: 'MACRO RATES',   color: 'var(--teal)'     },
  earnings:      { component: <EarningsPanel />,             label: 'EARNINGS',      color: '#a78bfa'         },
}

// ── Default layout — version 5 ────────────────────────────────────────────────
const LS_KEY = 'nexus-drag-layout-v5'

const DEFAULT_LAYOUT: DashboardLayout = [
  // Row 1 — main workspace
  { i: 'chart',        x: 0,  y: 0,  w: 8, h: 15, minW: 3, minH: 8  },
  { i: 'indices',      x: 8,  y: 0,  w: 2, h: 15, minW: 2, minH: 6  },
  { i: 'watchlist',    x: 10, y: 0,  w: 2, h: 15, minW: 2, minH: 6  },
  // Row 2 — intelligence
  { i: 'news',         x: 0,  y: 15, w: 5, h: 12, minW: 3, minH: 6  },
  { i: 'sentiment',    x: 5,  y: 15, w: 3, h: 12, minW: 2, minH: 6  },
  { i: 'calendar',     x: 8,  y: 15, w: 2, h: 12, minW: 2, minH: 6  },
  { i: 'mktclock',     x: 10, y: 15, w: 2, h: 12, minW: 2, minH: 8  },
  // Row 3 — analytics
  { i: 'heatmap',      x: 0,  y: 27, w: 6, h: 11, minW: 3, minH: 6  },
  { i: 'altsignals',   x: 6,  y: 27, w: 3, h: 11, minW: 2, minH: 6  },
  { i: 'earnings',     x: 9,  y: 27, w: 3, h: 11, minW: 2, minH: 8  },
  // Row 4 — India + Macro
  { i: 'indiamarkets', x: 0,  y: 38, w: 5, h: 14, minW: 3, minH: 8  },
  { i: 'macrorates',   x: 5,  y: 38, w: 4, h: 14, minW: 3, minH: 8  },
  { i: 'correlation',  x: 9,  y: 38, w: 3, h: 14, minW: 2, minH: 8  },
  // Row 5 — Live video
  { i: 'livevideo',    x: 0,  y: 52, w: 12, h: 13, minW: 4, minH: 10 },
]

// ── Validation helpers ─────────────────────────────────────────────────────────

function cloneLayout<T extends LayoutItem>(layout: readonly T[]): T[] {
  return layout.map(item => ({ ...item })) as T[]
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isPanelId(v: unknown): v is PanelId {
  return typeof v === 'string' && (PANEL_IDS as readonly string[]).includes(v)
}

function isDashboardLayoutItem(v: unknown): v is DashboardLayoutItem {
  if (!v || typeof v !== 'object') return false
  const item = v as Record<string, unknown>
  return isPanelId(item.i) && isFiniteNumber(item.x) && isFiniteNumber(item.y) && isFiniteNumber(item.w) && isFiniteNumber(item.h)
}

function normalizeLayout(layout: Layout): DashboardLayout | null {
  if (!layout.every(isDashboardLayoutItem)) return null
  const keys = new Set(layout.map(item => item.i))
  if (!PANEL_IDS.every(id => keys.has(id))) return null
  return cloneLayout(layout)
}

function loadLayout(): DashboardLayout {
  if (typeof window === 'undefined') return cloneLayout(DEFAULT_LAYOUT)
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (!saved) return cloneLayout(DEFAULT_LAYOUT)
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return cloneLayout(DEFAULT_LAYOUT)
    return normalizeLayout(parsed) ?? cloneLayout(DEFAULT_LAYOUT)
  } catch {
    return cloneLayout(DEFAULT_LAYOUT)
  }
}

function saveLayout(layout: DashboardLayout) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(layout)) } catch {}
}

// ── Panel visibility (hide/show individual panels) ────────────────────────────

const PANEL_GROUPS: { label: string; ids: PanelId[] }[] = [
  { label: 'Core',    ids: ['chart', 'indices', 'watchlist'] },
  { label: 'Intel',   ids: ['news', 'sentiment', 'calendar'] },
  { label: 'Analytics', ids: ['heatmap', 'altsignals', 'earnings', 'correlation'] },
  { label: 'Global',  ids: ['indiamarkets', 'macrorates', 'mktclock'] },
  { label: 'Media',   ids: ['livevideo'] },
]

// ── Component ──────────────────────────────────────────────────────────────────

export default function GridLayout() {
  const [mounted,  setMounted]  = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [layout,   setLayout]   = useState<DashboardLayout>(() => loadLayout())
  const [saved,    setSaved]    = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [hidden,   setHidden]   = useState<Set<PanelId>>(new Set())

  const originalLayoutRef     = useRef<DashboardLayout>(cloneLayout(DEFAULT_LAYOUT))
  const saveIndicatorTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setMounted(true))
    return () => {
      window.cancelAnimationFrame(frameId)
      if (saveIndicatorTimerRef.current !== null) window.clearTimeout(saveIndicatorTimerRef.current)
    }
  }, [])

  const showSaveIndicator = () => {
    setSaved(true)
    if (saveIndicatorTimerRef.current !== null) window.clearTimeout(saveIndicatorTimerRef.current)
    saveIndicatorTimerRef.current = window.setTimeout(() => {
      setSaved(false)
      saveIndicatorTimerRef.current = null
    }, 2000)
  }

  const handleStartEdit = () => { originalLayoutRef.current = cloneLayout(layout); setEditing(true) }
  const handleSave      = () => { const n = cloneLayout(layout); saveLayout(n); setEditing(false); showSaveIndicator() }
  const handleCancel    = () => { setLayout(cloneLayout(originalLayoutRef.current)); setEditing(false) }
  const handleReset     = () => {
    const n = cloneLayout(DEFAULT_LAYOUT)
    originalLayoutRef.current = cloneLayout(n)
    setLayout(n); saveLayout(n); setEditing(false); showSaveIndicator()
  }

  const handleLayoutChange = (nextLayout: Layout) => {
    if (!editing) return
    const n = normalizeLayout(nextLayout)
    if (n) setLayout(n)
  }

  const toggleHide = (id: PanelId) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const visibleLayout = layout.filter(({ i }) => !hidden.has(i))

  if (!mounted) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', letterSpacing: '0.1em' }}>
        LOADING NEXUS...
      </div>
    )
  }

  const btnBase: React.CSSProperties = {
    padding: '4px 14px', borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
    letterSpacing: '0.08em', textTransform: 'uppercase', transition: 'all 0.15s',
  }

  return (
    <div style={{ padding: '0 8px 40px' }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
        gap: '6px', padding: '6px 0',
        position: 'sticky', top: '46px', zIndex: 50,
        background: 'var(--bg-base)',
        borderBottom: editing ? '1px solid rgba(240,165,0,0.2)' : '1px solid transparent',
        transition: 'border-color 0.2s',
      }}>
        {editing && (
          <span style={{ fontSize: '11px', color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em', marginRight: 'auto', marginLeft: '4px' }}>
            drag headers to move · corner to resize
          </span>
        )}
        {saved && !editing && (
          <span style={{ fontSize: '10px', color: 'var(--positive)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>
            layout saved
          </span>
        )}

        {/* Panel visibility menu */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowMenu(v => !v)}
            style={{ ...btnBase, border: '1px solid var(--border)', background: showMenu ? 'rgba(0,229,192,0.08)' : 'transparent', color: showMenu ? 'var(--teal)' : 'var(--text-muted)', borderColor: showMenu ? 'var(--teal)' : 'var(--border)' }}
          >
            PANELS {hidden.size > 0 ? `(${hidden.size} hidden)` : ''}
          </button>
          {showMenu && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', marginTop: '4px',
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: '6px', padding: '8px', zIndex: 200, width: '220px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}>
              {PANEL_GROUPS.map(group => (
                <div key={group.label} style={{ marginBottom: '8px' }}>
                  <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', marginBottom: '4px', padding: '0 4px' }}>
                    {group.label.toUpperCase()}
                  </div>
                  {group.ids.map(id => {
                    const meta    = PANEL_META[id]
                    const visible = !hidden.has(id)
                    return (
                      <div
                        key={id}
                        onClick={() => toggleHide(id)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '4px 8px', borderRadius: '3px', cursor: 'pointer',
                          background: visible ? 'transparent' : 'rgba(255,255,255,0.02)',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                        onMouseLeave={e => (e.currentTarget.style.background = visible ? 'transparent' : 'rgba(255,255,255,0.02)')}
                      >
                        <span style={{ fontSize: '11px', color: visible ? '#fff' : 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {meta.label}
                        </span>
                        <div style={{
                          width: '12px', height: '12px', borderRadius: '2px',
                          border: `1px solid ${visible ? (meta.color ?? 'var(--teal)') : 'var(--border)'}`,
                          background: visible ? (meta.color ?? 'var(--teal)') + '40' : 'transparent',
                          flexShrink: 0,
                        }} />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {!editing ? (
          <>
            <button
              onClick={handleStartEdit}
              style={{ ...btnBase, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--amber)'; e.currentTarget.style.color = 'var(--amber)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              Edit layout
            </button>
            <button
              onClick={handleReset}
              style={{ ...btnBase, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              Reset
            </button>
          </>
        ) : (
          <>
            <button onClick={handleCancel} style={{ ...btnBase, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}>
              Cancel
            </button>
            <button onClick={handleSave} style={{ ...btnBase, border: '1px solid var(--amber)', background: 'rgba(240,165,0,0.15)', color: 'var(--amber)', fontWeight: 700, boxShadow: '0 0 12px rgba(240,165,0,0.15)' }}>
              Save layout
            </button>
          </>
        )}
      </div>

      {/* Grid */}
      <div style={{ marginTop: '8px' }}>
        <ReactGridLayout
          layout={visibleLayout}
          cols={12} rowHeight={30} margin={[8, 8]} containerPadding={[0, 0]}
          isDraggable={editing} isResizable={editing}
          draggableHandle=".nexus-drag-handle"
          onLayoutChange={handleLayoutChange}
          useCSSTransforms compactType="vertical"
        >
          {visibleLayout.map(({ i }) => {
            const meta = PANEL_META[i]
            return (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                outline:      editing ? '1px solid rgba(240,165,0,0.2)' : 'none',
                borderRadius: '6px', transition: 'outline 0.2s',
              }}>
                {editing && (
                  <div
                    className="nexus-drag-handle"
                    style={{
                      height: '28px', flexShrink: 0, background: 'rgba(240,165,0,0.07)',
                      borderBottom: '1px solid rgba(240,165,0,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0 12px', cursor: 'grab', borderRadius: '6px 6px 0 0', userSelect: 'none',
                    }}
                    onMouseDown={e => { e.currentTarget.style.cursor = 'grabbing' }}
                    onMouseUp={e   => { e.currentTarget.style.cursor = 'grab'     }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>DRAG</span>
                      <span style={{ fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: meta.color || 'var(--amber)', letterSpacing: '0.1em' }}>{meta.label}</span>
                    </div>
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>drag · corner to resize</span>
                  </div>
                )}
                <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, borderRadius: editing ? '0 0 6px 6px' : '6px' }}>
                  {meta.component}
                </div>
              </div>
            )
          })}
        </ReactGridLayout>
      </div>

      <style>{`
        .react-grid-item { transition: none !important; }
        .react-grid-item.cssTransforms { transition-property: transform !important; transition-duration: 120ms !important; transition-timing-function: ease-out !important; }
        .react-grid-item.react-grid-placeholder { background: rgba(240,165,0,0.07) !important; border: 1px dashed rgba(240,165,0,0.4) !important; border-radius: 6px !important; opacity: 1 !important; z-index: 2 !important; }
        .react-resizable-handle { background: none !important; border-right: 2px solid rgba(240,165,0,0.7) !important; border-bottom: 2px solid rgba(240,165,0,0.7) !important; border-radius: 0 0 4px 0 !important; width: 14px !important; height: 14px !important; opacity: ${editing ? 1 : 0} !important; transition: opacity 0.2s !important; }
        .nexus-drag-handle { user-select: none; }
      `}</style>
    </div>
  )
}