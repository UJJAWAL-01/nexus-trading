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
import ChartPanel from '@/components/panels/ChartPanel'
import EconomicCalendarPanel from '@/components/panels/EconomicCalendarPanel'
import GlobalIndicesPanel from '@/components/panels/GlobalIndicesPanel'
import NewsFeedPanel from '@/components/panels/NewsFeedPanel'
import SectorHeatmapPanel from '@/components/panels/SectorHeatmapPanel'
import SentimentPanel from '@/components/panels/SentimentPanel'
import WatchlistPanel from '@/components/panels/WatchlistPanel'

const ReactGridLayout = WidthProvider(GridLayoutBase)

const PANEL_IDS = [
  'chart',
  'indices',
  'watchlist',
  'news',
  'sentiment',
  'calendar',
  'heatmap',
  'altsignals',
] as const

type PanelId = (typeof PANEL_IDS)[number]
type DashboardLayoutItem = LayoutItem & { i: PanelId }
type DashboardLayout = DashboardLayoutItem[]
type PanelMeta = {
  component: ReactNode
  label: string
  color?: string
}

const PANEL_META: Record<PanelId, PanelMeta> = {
  chart: { component: <ChartPanel />, label: 'CHART', color: 'var(--teal)' },
  indices: { component: <GlobalIndicesPanel />, label: 'INDICES', color: 'var(--blue)' },
  watchlist: { component: <WatchlistPanel />, label: 'WATCHLIST', color: 'var(--amber)' },
  news: { component: <NewsFeedPanel />, label: 'INTEL FEED', color: 'var(--amber)' },
  sentiment: { component: <SentimentPanel />, label: 'SENTIMENT', color: 'var(--teal)' },
  calendar: {
    component: <EconomicCalendarPanel />,
    label: 'CALENDAR',
    color: 'var(--red, #ff4560)',
  },
  heatmap: { component: <SectorHeatmapPanel />, label: 'HEATMAP', color: 'var(--teal)' },
  altsignals: {
    component: <AlternativeSignalsPanel />,
    label: 'ALT SIGNALS',
    color: '#a78bfa',
  },
}

const DEFAULT_LAYOUT: DashboardLayout = [
  { i: 'chart', x: 0, y: 0, w: 8, h: 15, minW: 3, minH: 8 },
  { i: 'indices', x: 8, y: 0, w: 2, h: 15, minW: 2, minH: 6 },
  { i: 'watchlist', x: 10, y: 0, w: 2, h: 15, minW: 2, minH: 6 },
  { i: 'news', x: 0, y: 15, w: 6, h: 12, minW: 3, minH: 6 },
  { i: 'sentiment', x: 6, y: 15, w: 3, h: 12, minW: 2, minH: 6 },
  { i: 'calendar', x: 9, y: 15, w: 3, h: 12, minW: 2, minH: 6 },
  { i: 'heatmap', x: 0, y: 27, w: 7, h: 11, minW: 3, minH: 6 },
  { i: 'altsignals', x: 7, y: 27, w: 5, h: 11, minW: 2, minH: 6 },
]

const LS_KEY = 'nexus-drag-layout-v3'

function cloneLayout<T extends LayoutItem>(layout: readonly T[]): T[] {
  return layout.map((item) => ({ ...item })) as T[]
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPanelId(value: unknown): value is PanelId {
  return typeof value === 'string' && PANEL_IDS.includes(value as PanelId)
}

function isDashboardLayoutItem(value: unknown): value is DashboardLayoutItem {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return (
    isPanelId(item.i) &&
    isFiniteNumber(item.x) &&
    isFiniteNumber(item.y) &&
    isFiniteNumber(item.w) &&
    isFiniteNumber(item.h)
  )
}

function normalizeLayout(layout: Layout): DashboardLayout | null {
  if (!layout.every(isDashboardLayoutItem)) {
    return null
  }

  const keys = new Set(layout.map((item) => item.i))
  const hasAllPanels = PANEL_IDS.every((panelId) => keys.has(panelId))

  if (!hasAllPanels) {
    return null
  }

  return cloneLayout(layout)
}

function loadLayout(): DashboardLayout {
  if (typeof window === 'undefined') {
    return cloneLayout(DEFAULT_LAYOUT)
  }

  try {
    const saved = localStorage.getItem(LS_KEY)
    if (!saved) {
      return cloneLayout(DEFAULT_LAYOUT)
    }

    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) {
      return cloneLayout(DEFAULT_LAYOUT)
    }

    return normalizeLayout(parsed) ?? cloneLayout(DEFAULT_LAYOUT)
  } catch {
    return cloneLayout(DEFAULT_LAYOUT)
  }
}

function saveLayout(layout: DashboardLayout) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(layout))
  } catch {}
}

export default function GridLayout() {
  const [mounted, setMounted] = useState(false)
  const [editing, setEditing] = useState(false)
  const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout())
  const [saved, setSaved] = useState(false)

  const originalLayoutRef = useRef<DashboardLayout>(cloneLayout(DEFAULT_LAYOUT))
  const saveIndicatorTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setMounted(true))

    return () => {
      window.cancelAnimationFrame(frameId)
      if (saveIndicatorTimerRef.current !== null) {
        window.clearTimeout(saveIndicatorTimerRef.current)
      }
    }
  }, [])

  const showSaveIndicator = () => {
    setSaved(true)

    if (saveIndicatorTimerRef.current !== null) {
      window.clearTimeout(saveIndicatorTimerRef.current)
    }

    saveIndicatorTimerRef.current = window.setTimeout(() => {
      setSaved(false)
      saveIndicatorTimerRef.current = null
    }, 2000)
  }

  const handleStartEdit = () => {
    originalLayoutRef.current = cloneLayout(layout)
    setEditing(true)
  }

  const handleSave = () => {
    const nextLayout = cloneLayout(layout)
    saveLayout(nextLayout)
    setEditing(false)
    showSaveIndicator()
  }

  const handleCancel = () => {
    setLayout(cloneLayout(originalLayoutRef.current))
    setEditing(false)
  }

  const handleReset = () => {
    const nextLayout = cloneLayout(DEFAULT_LAYOUT)
    originalLayoutRef.current = cloneLayout(nextLayout)
    setLayout(nextLayout)
    saveLayout(nextLayout)
    setEditing(false)
    showSaveIndicator()
  }

  const handleLayoutChange = (nextLayout: Layout) => {
    if (!editing) {
      return
    }

    const normalizedLayout = normalizeLayout(nextLayout)
    if (normalizedLayout) {
      setLayout(normalizedLayout)
    }
  }

  if (!mounted) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '60vh',
          color: 'var(--text-muted)',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '11px',
          letterSpacing: '0.1em',
        }}
      >
        LOADING NEXUS...
      </div>
    )
  }

  return (
    <div style={{ padding: '0 8px 40px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: '8px',
          padding: '6px 0',
          position: 'sticky',
          top: '46px',
          zIndex: 50,
          background: 'var(--bg-base)',
          borderBottom: editing
            ? '1px solid rgba(240,165,0,0.2)'
            : '1px solid transparent',
          transition: 'border-color 0.2s',
        }}
      >
        {editing && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--amber)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.06em',
              marginRight: 'auto',
              marginLeft: '4px',
            }}
          >
            drag panel headers to move / drag bottom-right corner to resize
          </span>
        )}

        {saved && !editing && (
          <span
            style={{
              fontSize: '10px',
              color: 'var(--positive)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.08em',
            }}
          >
            layout saved
          </span>
        )}

        {!editing ? (
          <>
            <button
              onClick={handleStartEdit}
              style={{
                padding: '4px 14px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '10px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = 'var(--amber)'
                event.currentTarget.style.color = 'var(--amber)'
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = 'var(--border)'
                event.currentTarget.style.color = 'var(--text-muted)'
              }}
            >
              Edit layout
            </button>
            <button
              onClick={handleReset}
              style={{
                padding: '4px 14px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '10px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = 'var(--border2)'
                event.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = 'var(--border)'
                event.currentTarget.style.color = 'var(--text-muted)'
              }}
            >
              Reset
            </button>
          </>
        ) : (
          <>
            <button
              onClick={handleCancel}
              style={{
                padding: '4px 14px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '10px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{
                padding: '4px 18px',
                borderRadius: '3px',
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: '10px',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                border: '1px solid var(--amber)',
                background: 'rgba(240,165,0,0.15)',
                color: 'var(--amber)',
                fontWeight: 700,
                boxShadow: '0 0 12px rgba(240,165,0,0.15)',
              }}
            >
              Save layout
            </button>
          </>
        )}
      </div>

      <div style={{ marginTop: '8px' }}>
        <ReactGridLayout
          layout={layout}
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
          {layout.map(({ i }) => {
            const meta = PANEL_META[i]

            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                  outline: editing ? '1px solid rgba(240,165,0,0.2)' : 'none',
                  borderRadius: '6px',
                  transition: 'outline 0.2s',
                }}
              >
                {editing && (
                  <div
                    className="nexus-drag-handle"
                    style={{
                      height: '28px',
                      flexShrink: 0,
                      background: 'rgba(240,165,0,0.07)',
                      borderBottom: '1px solid rgba(240,165,0,0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0 12px',
                      cursor: 'grab',
                      borderRadius: '6px 6px 0 0',
                      userSelect: 'none',
                    }}
                    onMouseDown={(event) => {
                      event.currentTarget.style.cursor = 'grabbing'
                    }}
                    onMouseUp={(event) => {
                      event.currentTarget.style.cursor = 'grab'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '10px',
                          color: 'var(--text-muted)',
                          fontFamily: 'JetBrains Mono, monospace',
                          letterSpacing: '0.08em',
                        }}
                      >
                        DRAG
                      </span>
                      <span
                        style={{
                          fontSize: '10px',
                          fontFamily: 'Syne, sans-serif',
                          fontWeight: 700,
                          color: meta.color || 'var(--amber)',
                          letterSpacing: '0.1em',
                        }}
                      >
                        {meta.label}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: '9px',
                        color: 'var(--text-muted)',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      drag to move / corner to resize
                    </span>
                  </div>
                )}

                <div
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    minHeight: 0,
                    borderRadius: editing ? '0 0 6px 6px' : '6px',
                  }}
                >
                  {meta.component}
                </div>
              </div>
            )
          })}
        </ReactGridLayout>
      </div>

      <style>{`
        .react-grid-item {
          transition: none !important;
        }
        .react-grid-item.cssTransforms {
          transition-property: transform !important;
          transition-duration: 120ms !important;
          transition-timing-function: ease-out !important;
        }
        .react-grid-item.react-grid-placeholder {
          background: rgba(240, 165, 0, 0.07) !important;
          border: 1px dashed rgba(240, 165, 0, 0.4) !important;
          border-radius: 6px !important;
          opacity: 1 !important;
          z-index: 2 !important;
        }
        .react-resizable-handle {
          background: none !important;
          border-right: 2px solid rgba(240, 165, 0, 0.7) !important;
          border-bottom: 2px solid rgba(240, 165, 0, 0.7) !important;
          border-radius: 0 0 4px 0 !important;
          width: 14px !important;
          height: 14px !important;
          opacity: ${editing ? 1 : 0} !important;
          transition: opacity 0.2s !important;
        }
        .nexus-drag-handle {
          user-select: none;
        }
        .react-grid-item:hover .react-resizable-handle {
          opacity: ${editing ? 1 : 0} !important;
        }
      `}</style>
    </div>
  )
}
