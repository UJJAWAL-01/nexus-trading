'use client'

import { useState, useEffect } from 'react'
import RGL, { WidthProvider, Layout } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import ChartPanel          from '@/components/panels/ChartPanel'
import WatchlistPanel      from '@/components/panels/WatchlistPanel'
import NewsFeedPanel       from '@/components/panels/NewsFeedPanel'
import GlobalIndicesPanel  from '@/components/panels/GlobalIndicesPanel'
import SentimentPanel      from '@/components/panels/SentimentPanel'
import EconomicCalendarPanel from '@/components/panels/EconomicCalendarPanel'

const ReactGridLayout = WidthProvider(RGL)

const DEFAULT_LAYOUT: Layout = [
  { i: 'chart',    x: 0,  y: 0, w: 8,  h: 14, minW: 4, minH: 8  },
  { i: 'indices',  x: 8,  y: 0, w: 2,  h: 14, minW: 2, minH: 6  },
  { i: 'watchlist',x: 10, y: 0, w: 2,  h: 14, minW: 2, minH: 6  },
  { i: 'news',     x: 0,  y: 14, w: 7, h: 12, minW: 3, minH: 6  },
  { i: 'sentiment',x: 7,  y: 14, w: 3, h: 12, minW: 2, minH: 6  },
  { i: 'calendar', x: 10, y: 14, w: 2, h: 12, minW: 2, minH: 6  },
]

const PANEL_MAP: Record<string, { component: React.ReactNode; label: string }> = {
  chart:     { component: <ChartPanel />,           label: 'CHART' },
  indices:   { component: <GlobalIndicesPanel />,   label: 'INDICES' },
  watchlist: { component: <WatchlistPanel />,       label: 'WATCHLIST' },
  news:      { component: <NewsFeedPanel />,        label: 'INTEL FEED' },
  sentiment: { component: <SentimentPanel />,       label: 'SENTIMENT' },
  calendar:  { component: <EconomicCalendarPanel />,label: 'CALENDAR' },
}

export default function GridLayout() {
  const [layout, setLayout] = useState<Layout>(DEFAULT_LAYOUT)
  const [editing, setEditing] = useState(false)

  return (
    <div style={{ padding: '8px' }}>
      {/* Edit mode toggle */}
      <div style={{
        display: 'flex', justifyContent: 'flex-end',
        marginBottom: '6px', gap: '8px', alignItems: 'center',
      }}>
        {editing && (
          <span style={{ fontSize: '11px', color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>
            ◆ DRAG PANELS TO MOVE · DRAG CORNERS TO RESIZE
          </span>
        )}
        <button
          onClick={() => setEditing(v => !v)}
          style={{
            padding: '3px 12px', borderRadius: '3px', cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            border: `1px solid ${editing ? 'var(--amber)' : 'var(--border)'}`,
            background: editing ? 'rgba(240,165,0,0.1)' : 'transparent',
            color: editing ? 'var(--amber)' : 'var(--text-muted)',
          }}
        >
          {editing ? '✓ DONE' : '⊞ EDIT LAYOUT'}
        </button>
        <button
          onClick={() => setLayout(DEFAULT_LAYOUT)}
          style={{
            padding: '3px 12px', borderRadius: '3px', cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
            letterSpacing: '0.08em', textTransform: 'uppercase',
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-muted)',
          }}
        >
          ↺ RESET
        </button>
      </div>

      <ReactGridLayout
        layout={layout}
        cols={12}
        rowHeight={30}
        isDraggable={editing}
        isResizable={editing}
        onLayoutChange={setLayout}
        draggableHandle=".drag-handle"
        style={{ minHeight: '80vh' }}
      >
        {DEFAULT_LAYOUT.map(({ i }) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Drag handle — only visible in edit mode */}
            {editing && (
              <div className="drag-handle" style={{
                height: '22px', background: 'rgba(240,165,0,0.1)',
                border: '1px solid rgba(240,165,0,0.3)',
                borderRadius: '4px 4px 0 0',
                display: 'flex', alignItems: 'center',
                padding: '0 10px', cursor: 'grab', flexShrink: 0,
                justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: '9px', color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
                  ⠿ {PANEL_MAP[i]?.label}
                </span>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>drag</span>
              </div>
            )}
            <div style={{ flex: 1, overflow: 'hidden', borderRadius: editing ? '0 0 6px 6px' : '6px' }}>
              {PANEL_MAP[i]?.component}
            </div>
          </div>
        ))}
      </ReactGridLayout>

      <style>{`
        .react-resizable-handle {
          background: none !important;
          border-right: 2px solid rgba(240,165,0,0.5) !important;
          border-bottom: 2px solid rgba(240,165,0,0.5) !important;
          width: 12px !important; height: 12px !important;
          opacity: ${editing ? 1 : 0};
        }
        .react-grid-item.react-grid-placeholder {
          background: rgba(240,165,0,0.1) !important;
          border: 1px dashed rgba(240,165,0,0.4) !important;
          border-radius: 6px !important;
        }
        .drag-handle { user-select: none; }
      `}</style>
    </div>
  )
}