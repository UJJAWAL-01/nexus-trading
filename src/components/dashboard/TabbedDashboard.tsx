'use client'

import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { Activity, Newspaper, Briefcase, Globe, BarChart2 } from 'lucide-react'
import GridLayoutBase, { WidthProvider, type LayoutItem } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

import { PANEL_META, EAGER_MOUNT, type PanelId } from './panelRegistry'
import LazyMount         from './LazyMount'
import KeyboardShortcuts from './KeyboardShortcuts'
import AlertToasts       from './AlertToasts'
import AlertEngine       from './AlertEngine'

const ReactGridLayout = WidthProvider(GridLayoutBase)

// ── Tab definition ─────────────────────────────────────────────────────────────

type TabId = 'markets' | 'news' | 'smartmoney' | 'india' | 'options'

interface Tab {
  id:     TabId
  label:  string
  hint:   string
  icon:   ComponentType<{ size?: number; strokeWidth?: number }>
  panels: PanelId[]
}

const TABS: Tab[] = [
  { id: 'markets',    label: 'Markets',     hint: "What's moving",            icon: Activity,  panels: ['indices', 'heatmap', 'commodities', 'sentiment', 'mktclock'] },
  { id: 'news',       label: 'News',        hint: 'Events + earnings',         icon: Newspaper, panels: ['news', 'calendar', 'earnings', 'livevideo', 'ipo'] },
  { id: 'smartmoney', label: 'Research',    hint: 'Per-stock deep dive + smart money flow', icon: Briefcase, panels: ['equityresearch', 'screener', 'stockprofile', 'analystconsensus', 'smartmoney', 'insiderdeals', 'secfilings', 'supplychain', 'altdata'] },
  { id: 'india',      label: 'India',       hint: 'Nifty / Sensex / FII-DII',  icon: Globe,     panels: ['indiamarkets', 'fixedincome'] },
  { id: 'options',    label: 'Options',     hint: 'Derivatives + rates',       icon: BarChart2, panels: ['options', 'macrorates'] },
]

const TAB_LS_KEY            = 'nexus-active-tab'
// v3 = max 50% width per panel (no full-width heroes).
// v2 had tightened heights; v1 was tall.  Bump invalidates older saves.
const PRO_LAYOUT_KEY_PREFIX = 'nexus-pro-layout-v3-'

// ── Per-panel size hints (12-col grid, rowHeight=30) ─────────────────────────
// These came from Classic's DEFAULT_LAYOUT — sizes already tuned to each
// panel's natural content height.  Anything missing falls back to a sane
// `w:6 h:16` default that comfortably fits a 12-col row in two columns.

// Sizes are content-fit at default — chosen so a typical desktop screen
// shows ≥2 panels stacked without scrolling.  Rows of 4 cols (3-up) for
// small widgets, 6 cols (2-up) for table/feed panels, full 12 only for the
// genuine hero panels (EquityResearch + Screener) where the table needs the
// whole width.  User can still drag any corner to resize bigger.
//
// Heights:   rowHeight=30px → h is in 30-px units.
//   h:10 = 300px (compact widget)
//   h:12 = 360px (typical card)
//   h:14 = 420px (table / scrolling feed)
//   h:16 = 480px (only data-heavy panels)

type SizeHint = { w: number; h: number; minW: number; minH: number }
const PRO_PANEL_SIZE: Partial<Record<PanelId, SizeHint>> = {
  // Markets — small widgets, 3-up
  indices:         { w: 4, h: 12, minW: 3, minH: 8  },
  heatmap:         { w: 4, h: 12, minW: 3, minH: 8  },
  commodities:     { w: 4, h: 12, minW: 3, minH: 8  },
  sentiment:       { w: 4, h: 10, minW: 2, minH: 8  },
  mktclock:        { w: 4, h: 12, minW: 2, minH: 8  },
  // News — 2-up
  news:            { w: 6, h: 14, minW: 3, minH: 10 },
  calendar:        { w: 6, h: 12, minW: 2, minH: 8  },
  earnings:        { w: 6, h: 12, minW: 2, minH: 8  },
  livevideo:       { w: 6, h: 14, minW: 3, minH: 10 },
  ipo:             { w: 6, h: 12, minW: 3, minH: 10 },
  // Research — everything 2-up, max half-width per user spec.
  equityresearch:  { w: 6, h: 18, minW: 4, minH: 14 },
  screener:        { w: 6, h: 16, minW: 4, minH: 12 },
  stockprofile:    { w: 6, h: 14, minW: 4, minH: 10 },
  analystconsensus:{ w: 6, h: 14, minW: 4, minH: 10 },
  smartmoney:      { w: 6, h: 14, minW: 3, minH: 10 },
  insiderdeals:    { w: 6, h: 12, minW: 3, minH: 10 },
  secfilings:      { w: 6, h: 14, minW: 3, minH: 10 },
  supplychain:     { w: 6, h: 12, minW: 3, minH: 10 },
  altdata:         { w: 6, h: 14, minW: 3, minH: 10 },
  // India — 2-up
  indiamarkets:    { w: 6, h: 14, minW: 3, minH: 10 },
  fixedincome:     { w: 6, h: 14, minW: 3, minH: 10 },
  // Options
  options:         { w: 6, h: 16, minW: 4, minH: 12 },
  macrorates:      { w: 6, h: 14, minW: 2, minH: 10 },
}

const DEFAULT_SIZE: SizeHint = { w: 6, h: 12, minW: 3, minH: 8 }

// Pack the tab's panels left-to-right into rows that don't exceed 12 columns.
// Each row's height is taken from the tallest panel in the row so cards align
// — same packer logic Classic uses, just inline for fewer moving parts.
function defaultLayoutForTab(panels: PanelId[]): LayoutItem[] {
  const out: LayoutItem[] = []
  let x = 0, y = 0, rowH = 0
  for (const id of panels) {
    const sz = PRO_PANEL_SIZE[id] ?? DEFAULT_SIZE
    if (x + sz.w > 12) { x = 0; y += rowH; rowH = 0 }
    out.push({ i: id, x, y, w: sz.w, h: sz.h, minW: sz.minW, minH: sz.minH })
    x   += sz.w
    rowH = Math.max(rowH, sz.h)
  }
  return out
}

function loadTabLayout(tabId: TabId, panels: PanelId[]): LayoutItem[] {
  if (typeof window === 'undefined') return defaultLayoutForTab(panels)
  try {
    const saved = localStorage.getItem(PRO_LAYOUT_KEY_PREFIX + tabId)
    if (!saved) return defaultLayoutForTab(panels)
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return defaultLayoutForTab(panels)
    const ids = new Set<string>()
    const cleaned: LayoutItem[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') return defaultLayoutForTab(panels)
      const r = item as Record<string, unknown>
      if (typeof r.i !== 'string' || typeof r.x !== 'number' || typeof r.y !== 'number' ||
          typeof r.w !== 'number' || typeof r.h !== 'number') {
        return defaultLayoutForTab(panels)
      }
      cleaned.push({
        i: r.i, x: r.x, y: r.y, w: r.w, h: r.h,
        minW: typeof r.minW === 'number' ? r.minW : undefined,
        minH: typeof r.minH === 'number' ? r.minH : undefined,
      })
      ids.add(r.i)
    }
    // If a saved layout is missing a panel (new panel added since), fall back.
    if (!panels.every(p => ids.has(p))) return defaultLayoutForTab(panels)
    return cleaned
  } catch { return defaultLayoutForTab(panels) }
}

function saveTabLayout(tabId: TabId, layout: LayoutItem[]) {
  try { localStorage.setItem(PRO_LAYOUT_KEY_PREFIX + tabId, JSON.stringify(layout)) } catch {}
}

function clearTabLayout(tabId: TabId) {
  try { localStorage.removeItem(PRO_LAYOUT_KEY_PREFIX + tabId) } catch {}
}

function loadActiveTab(): TabId {
  if (typeof window === 'undefined') return 'markets'
  try {
    const saved = localStorage.getItem(TAB_LS_KEY) as TabId | null
    return saved && TABS.some(t => t.id === saved) ? saved : 'markets'
  } catch { return 'markets' }
}

// ── Resizable tab content ─────────────────────────────────────────────────────
//
// Each tab gets its own 12-column react-grid-layout instance with per-tab
// localStorage persistence.  When `editing` is false the panels are locked
// (no drag/resize, no handle bars).  When true, a thin amber drag header
// appears on each card and the corner resize handle lights up.
//
// Layout autosaves on every change while editing — there's no separate Save
// step, the Edit button just toggles "interactivity on/off".

function TabContent({ tab, editing }: { tab: Tab; editing: boolean }) {
  // Re-derive on tab change so each tab has its own layout state.  Using
  // tab.id as a useMemo key means the heavy localStorage read happens once
  // per tab switch, not per render.
  const initialLayout = useMemo(() => loadTabLayout(tab.id, tab.panels), [tab.id, tab.panels])
  const [layout, setLayout] = useState<LayoutItem[]>(initialLayout)

  // Reset state when the active tab changes.  Without this, switching from
  // Markets→Research would keep the Markets layout state until next render.
  useEffect(() => { setLayout(initialLayout) }, [initialLayout])

  return (
    <div className={`tab-grid-wrap ${editing ? 'is-editing' : ''}`}>
      <ReactGridLayout
        layout={layout}
        cols={12}
        rowHeight={30}
        margin={[10, 10]}
        containerPadding={[0, 10]}
        isDraggable={editing}
        isResizable={editing}
        draggableHandle=".tab-drag-handle"
        onLayoutChange={next => {
          if (!editing) return
          setLayout(next as LayoutItem[])
          saveTabLayout(tab.id, next as LayoutItem[])
        }}
        useCSSTransforms
        compactType="vertical"
      >
        {tab.panels.map(id => {
          const meta  = PANEL_META[id]
          const eager = EAGER_MOUNT.has(id)
          return (
            <div key={id} data-panel-id={id} className="tab-panel-card">
              {editing && (
                <div className="tab-drag-handle">
                  <span className="dh-grip">⠿ DRAG</span>
                  <span className="dh-label" style={{ color: meta.color }}>{meta.label}</span>
                  <span className="dh-hint">↔ move · ↘ resize</span>
                </div>
              )}
              <div className="tab-panel-body">
                {eager ? meta.component : <LazyMount>{meta.component}</LazyMount>}
              </div>
            </div>
          )
        })}
      </ReactGridLayout>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TabbedDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('markets')
  const [mounted,   setMounted]   = useState(false)
  const [editing,   setEditing]   = useState(false)
  const [savedTick, setSavedTick] = useState(0)   // brief "saved" flash counter

  useEffect(() => {
    setActiveTab(loadActiveTab())
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    try { localStorage.setItem(TAB_LS_KEY, activeTab) } catch {}
  }, [activeTab, mounted])

  // Leave edit mode when switching tabs — feels right, prevents accidental drag
  useEffect(() => { setEditing(false) }, [activeTab])

  // Keyboard shortcuts: 1-5 to switch tabs (only when not editing, no modifiers)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      const idx = parseInt(e.key, 10) - 1
      if (idx >= 0 && idx < TABS.length) {
        e.preventDefault()
        setActiveTab(TABS[idx].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const tab = TABS.find(t => t.id === activeTab) ?? TABS[0]

  const handleReset = () => {
    clearTabLayout(activeTab)
    // Force TabContent to re-read defaults by bouncing editing off-then-on
    setEditing(false)
    setSavedTick(t => t + 1)
    // Tiny delay so the user sees the layout snap back, then re-enter edit
    requestAnimationFrame(() => requestAnimationFrame(() => setEditing(true)))
  }

  return (
    <div className="tabbed-root">
      <AlertEngine />
      <AlertToasts />
      <KeyboardShortcuts panels={[
        { id: 'chart',     label: 'CHART',     description: 'Open chart' },
        { id: 'watchlist', label: 'WATCHLIST', description: 'Open watchlist' },
      ]} />

      {/* ─── HERO ─── Chart + Watchlist (always visible) ──────────────────── */}
      <div className="tabbed-hero">
        <div className="hero-chart">
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {PANEL_META.chart.component}
          </div>
        </div>
        <div className="hero-watchlist">
          <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {PANEL_META.watchlist.component}
          </div>
        </div>
      </div>

      {/* ─── DESKTOP TAB BAR ─────────────────────────────────────────────── */}
      <div className="tabbed-tabbar" role="tablist" aria-label="Pro dashboard sections">
        {TABS.map((t, i) => {
          const active = t.id === activeTab
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`tabbed-tab ${active ? 'active' : ''}`}
              role="tab"
              aria-selected={active}
              title={`${t.hint}  ·  press ${i + 1}`}
            >
              <span className="tab-icon" aria-hidden="true">
                <Icon size={16} strokeWidth={active ? 2.5 : 2} />
              </span>
              <span className="tab-label">{t.label}</span>
              <span className="tab-key" aria-hidden="true">{i + 1}</span>
            </button>
          )
        })}

        {/* Toolbar — edit mode + reset + status hint */}
        <div className="tabbed-toolbar">
          {!editing ? (
            <>
              <span className="tabbed-hint">
                <span className="hint-arrow">←</span> {tab.hint}
              </span>
              <button
                className="tab-tool-btn tab-tool-btn--edit-cta"
                onClick={() => setEditing(true)}
                title="Drag panel headers to move · drag bottom-right corner to resize · auto-saves"
              >
                <span className="edit-icon">✎</span>
                Edit Layout
                <span className="edit-chevron" aria-hidden="true">→</span>
              </button>
            </>
          ) : (
            <>
              <span className="tabbed-hint editing">
                DRAG ⠿  ·  RESIZE ↘  ·  AUTO-SAVED
              </span>
              <button
                className="tab-tool-btn tab-tool-btn--reset"
                onClick={handleReset}
                title="Restore this tab's default layout"
              >
                Reset
              </button>
              <button
                className="tab-tool-btn tab-tool-btn--done"
                onClick={() => setEditing(false)}
              >
                ✓ Done
              </button>
            </>
          )}
        </div>
      </div>

      {/* ─── ACTIVE TAB CONTENT ──────────────────────────────────────────── */}
      {/* Key on (tab.id + savedTick) so Reset force-rebuilds the grid cleanly */}
      <TabContent key={`${tab.id}:${savedTick}`} tab={tab} editing={editing} />

      {/* ─── MOBILE BOTTOM NAV (fixed) ───────────────────────────────────── */}
      <nav className="tabbed-bottom-nav" role="tablist" aria-label="Main sections">
        {TABS.map(t => {
          const active = t.id === activeTab
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`bottom-tab ${active ? 'active' : ''}`}
              aria-selected={active}
              role="tab"
              title={t.label}
            >
              <Icon size={18} strokeWidth={active ? 2.4 : 1.8} />
              <span>{t.label}</span>
            </button>
          )
        })}
      </nav>

      <style>{`
        .tabbed-root {
          padding-bottom: 40px;
        }

        .tabbed-hero {
          display: grid;
          grid-template-columns: 3fr 1fr;
          gap: 10px;
          height: 72vh;
          min-height: 560px;
          max-height: 900px;
          margin-top: 10px;
        }
        .hero-chart, .hero-watchlist {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--bg-panel);
        }

        /* ─── Tab bar ─────────────────────────────────────────────────────── */
        .tabbed-tabbar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 10px 14px 0;
          margin-top: 14px;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%),
            #1a1d24;
          border-top:    1px solid rgba(255,255,255,0.08);
          border-left:   1px solid rgba(255,255,255,0.04);
          border-right:  1px solid rgba(255,255,255,0.04);
          border-bottom: 1px solid var(--border-br);
          border-radius: 8px 8px 0 0;
          box-shadow:
            0 -1px 0   rgba(255,255,255,0.04) inset,
            0  6px 14px rgba(0,0,0,0.45);
          position: relative;
        }
        .tabbed-tab {
          display: inline-flex;
          align-items: center;
          gap: 9px;
          padding: 10px 16px 12px;
          background: transparent;
          border: 1px solid transparent;
          border-bottom: 3px solid transparent;
          color: var(--text-2);
          font-family: 'Syne', sans-serif;
          font-weight: 700;
          font-size: 14px;
          letter-spacing: 0.04em;
          cursor: pointer;
          transition: background 0.18s, color 0.18s, border-color 0.18s, box-shadow 0.18s;
          margin-bottom: -1px;
          border-radius: 6px 6px 0 0;
          white-space: nowrap;
        }
        .tabbed-tab .tab-icon { opacity: 0.7; transition: opacity 0.18s, color 0.18s; }
        .tabbed-tab:hover { color: #fff; background: rgba(255,255,255,0.07); }
        .tabbed-tab:hover .tab-icon { opacity: 1; }
        .tabbed-tab:focus-visible { outline: 2px solid var(--amber); outline-offset: -2px; }

        .tabbed-tab.active {
          color: var(--amber);
          background: rgba(240,165,0,0.12);
          border-color: rgba(240,165,0,0.35);
          border-bottom-color: var(--amber);
          box-shadow: 0 0 0 1px rgba(240,165,0,0.18), 0 4px 14px rgba(240,165,0,0.18);
          position: relative;
        }
        .tabbed-tab.active .tab-icon { opacity: 1; color: var(--amber); }
        .tabbed-tab.active::after {
          content: '';
          position: absolute;
          left: 0; right: 0; bottom: -1px;
          height: 3px;
          background: var(--amber);
          box-shadow: 0 0 10px rgba(240,165,0,0.6);
        }

        .tab-key {
          display: inline-flex; align-items: center; justify-content: center;
          width: 18px; height: 18px;
          border-radius: 4px;
          background: rgba(255,255,255,0.08);
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px; font-weight: 700;
          flex-shrink: 0;
        }
        .tabbed-tab.active .tab-key {
          background: rgba(240,165,0,0.28);
          color: var(--amber);
          box-shadow: inset 0 0 0 1px rgba(240,165,0,0.5);
        }

        /* ─── Toolbar (right side of tab bar) ─────────────────────────────── */
        .tabbed-toolbar {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .tabbed-hint {
          padding: 6px 10px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: var(--amber);
          letter-spacing: 0.08em;
          background: rgba(240,165,0,0.06);
          border-radius: 3px;
          border: 1px solid rgba(240,165,0,0.15);
          white-space: nowrap;
        }
        .tabbed-hint.editing {
          color: var(--amber);
          background: rgba(240,165,0,0.18);
          border-color: rgba(240,165,0,0.5);
          font-weight: 700;
          animation: editPulse 1.6s ease-in-out infinite;
        }
        @keyframes editPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(240,165,0,0.0); }
          50%      { box-shadow: 0 0 0 4px rgba(240,165,0,0.10); }
        }
        .hint-arrow { opacity: 0.6; margin-right: 4px; }

        .tab-tool-btn {
          padding: 6px 12px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          font-weight: 700;
          background: transparent;
          color: var(--text-muted);
          border: 1px solid var(--border);
          border-radius: 3px;
          cursor: pointer;
          transition: all 0.12s;
          white-space: nowrap;
        }
        .tab-tool-btn:hover {
          color: var(--amber);
          border-color: var(--amber);
        }
        .tab-tool-btn--reset:hover {
          color: #ff4560;
          border-color: rgba(255,69,96,0.6);
        }
        .tab-tool-btn--done {
          color: var(--amber);
          background: rgba(240,165,0,0.15);
          border-color: var(--amber);
          box-shadow: 0 0 12px rgba(240,165,0,0.15);
        }

        /* Highlighted default-state CTA so first-time users notice they can
           customize the layout.  Bigger, amber-tinted, soft pulsing glow,
           chevron that nudges right on hover.  Calms down once clicked. */
        .tab-tool-btn--edit-cta {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 14px;
          color: var(--amber);
          background: rgba(240,165,0,0.10);
          border: 1px solid rgba(240,165,0,0.55);
          box-shadow:
            0 0 0 1px rgba(240,165,0,0.10),
            0 0 14px rgba(240,165,0,0.18);
          animation: editCtaPulse 2.4s ease-in-out infinite;
        }
        .tab-tool-btn--edit-cta:hover {
          color: #fff;
          background: rgba(240,165,0,0.22);
          border-color: var(--amber);
          box-shadow:
            0 0 0 1px rgba(240,165,0,0.25),
            0 0 22px rgba(240,165,0,0.35);
          animation: none;
        }
        .tab-tool-btn--edit-cta .edit-icon {
          font-size: 12px;
          line-height: 1;
        }
        .tab-tool-btn--edit-cta .edit-chevron {
          opacity: 0.6;
          margin-left: 2px;
          transition: transform 0.18s, opacity 0.18s;
        }
        .tab-tool-btn--edit-cta:hover .edit-chevron {
          opacity: 1;
          transform: translateX(3px);
        }
        @keyframes editCtaPulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(240,165,0,0.10), 0 0 14px rgba(240,165,0,0.18); }
          50%      { box-shadow: 0 0 0 1px rgba(240,165,0,0.20), 0 0 22px rgba(240,165,0,0.36); }
        }

        @media (max-width: 1180px) {
          .tabbed-hint { display: none; }
          .tabbed-tab  { padding: 9px 12px 11px; font-size: 13px; }
        }
        @media (max-width: 1024px) {
          .tab-key { display: none; }
        }

        /* ─── Tab grid wrapper ────────────────────────────────────────────── */
        .tab-grid-wrap {
          margin-top: 8px;
        }
        .tab-panel-card {
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 6px;
          background: var(--bg-panel);
          outline: 1px solid transparent;
          transition: outline 0.15s, box-shadow 0.15s;
        }
        .is-editing .tab-panel-card {
          outline: 1px solid rgba(240,165,0,0.25);
        }
        .tab-drag-handle {
          height: 26px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 12px;
          background: rgba(240,165,0,0.07);
          border-bottom: 1px solid rgba(240,165,0,0.2);
          cursor: grab;
          user-select: none;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          letter-spacing: 0.08em;
          border-radius: 6px 6px 0 0;
        }
        .tab-drag-handle:active { cursor: grabbing; }
        .dh-grip   { color: var(--text-muted); }
        .dh-label  { font-family: 'Syne', sans-serif; font-weight: 700; font-size: 11px; letter-spacing: 0.1em; }
        .dh-hint   { margin-left: auto; color: var(--text-muted); }
        .tab-panel-body {
          flex: 1; min-height: 0; overflow: hidden;
        }

        /* react-grid-layout dressing (mirrors Classic for consistency) */
        .tab-grid-wrap .react-grid-item {
          transition-property: transform, width, height !important;
          transition-duration: 180ms !important;
          transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1) !important;
          will-change: transform, width, height;
        }
        .tab-grid-wrap .react-grid-item.react-draggable-dragging,
        .tab-grid-wrap .react-grid-item.resizing {
          transition: none !important;
          z-index: 10 !important;
        }
        .tab-grid-wrap .react-grid-item.react-draggable-dragging {
          opacity: 0.92;
          box-shadow:
            0 16px 40px rgba(0, 0, 0, 0.55),
            0 0 0 1px rgba(240, 165, 0, 0.55),
            0 0 24px rgba(240, 165, 0, 0.15) !important;
        }
        .tab-grid-wrap .react-grid-item.resizing {
          opacity: 0.95;
          box-shadow:
            0 0 0 2px rgba(240, 165, 0, 0.55),
            0 0 18px rgba(240, 165, 0, 0.25) !important;
        }
        .tab-grid-wrap .react-grid-placeholder {
          background:
            repeating-linear-gradient(
              45deg,
              rgba(240, 165, 0, 0.08),
              rgba(240, 165, 0, 0.08) 8px,
              rgba(240, 165, 0, 0.16) 8px,
              rgba(240, 165, 0, 0.16) 16px
            ) !important;
          border: 1.5px dashed rgba(240, 165, 0, 0.65) !important;
          border-radius: 6px !important;
          opacity: 1 !important;
        }
        .tab-grid-wrap .react-resizable-handle {
          background: none !important;
          width: 18px !important;
          height: 18px !important;
        }
        .tab-grid-wrap .react-resizable-handle::before {
          content: '';
          position: absolute;
          right: 3px; bottom: 3px;
          width: 12px; height: 12px;
          border-right:  2px solid rgba(240, 165, 0, 0.75);
          border-bottom: 2px solid rgba(240, 165, 0, 0.75);
          border-radius: 0 0 4px 0;
          transition: border-color 0.15s, transform 0.15s;
        }
        .tab-grid-wrap .react-resizable-handle:hover::before {
          border-color: var(--amber);
          transform: scale(1.15);
        }

        /* ─── Bottom nav (mobile/tablet) ──────────────────────────────────── */
        .tabbed-bottom-nav { display: none; }

        @media (max-width: 899px) {
          .tabbed-root { padding-bottom: calc(64px + env(safe-area-inset-bottom, 0)); }
          .tabbed-hero {
            grid-template-columns: 1fr;
            grid-template-rows: 440px 240px;
            height: auto; min-height: 0; max-height: none;
          }
          .tabbed-tabbar { display: none; }
          .tabbed-bottom-nav {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            position: fixed;
            bottom: 0; left: 0; right: 0;
            background: var(--bg-panel);
            border-top: 1px solid var(--border);
            z-index: 1100;
            padding-bottom: env(safe-area-inset-bottom, 0);
            box-shadow: 0 -4px 16px rgba(0,0,0,0.6);
          }
          .bottom-tab {
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 3px;
            padding: 7px 4px 8px;
            background: transparent; border: none;
            color: var(--text-muted);
            font-family: 'JetBrains Mono', monospace;
            font-size: 9px; font-weight: 600; letter-spacing: 0.04em;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            transition: color 0.15s;
            min-height: 54px;
          }
          .bottom-tab:active { background: rgba(255,255,255,0.04); }
          .bottom-tab.active { color: var(--amber); }
          .bottom-tab span   { line-height: 1; }
        }
      `}</style>
    </div>
  )
}
