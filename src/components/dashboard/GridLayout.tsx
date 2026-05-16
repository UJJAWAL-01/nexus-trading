'use client'

import { useEffect, useRef, useState } from 'react'
import GridLayoutBase, { WidthProvider, type Layout, type LayoutItem } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

// Panel registry is shared between Classic Grid and the new Tabbed Dashboard.
import { PANEL_IDS, PANEL_META, EAGER_MOUNT, type PanelId } from '@/components/dashboard/panelRegistry'

// Terminal-grade UX layer
import LazyMount         from '@/components/dashboard/LazyMount'
import KeyboardShortcuts from '@/components/dashboard/KeyboardShortcuts'
import AlertToasts       from '@/components/dashboard/AlertToasts'
import AlertEngine       from '@/components/dashboard/AlertEngine'
import { useWorkspace, WORKSPACES, type WorkspaceId } from '@/store/workspace'
const ReactGridLayout = WidthProvider(GridLayoutBase)

type DashboardLayoutItem = LayoutItem & { i: PanelId }
type DashboardLayout     = DashboardLayoutItem[]

// ── DESKTOP default layout — v13 ─────────────────────────────────────────────
// Full layout redesign: priority tiers, content-fit heights, IPO offscreen bug fixed.
// Rows 1-3 locked per user instruction. Rows 4+ reorganized by live-data value.
// rowHeight=30 → h:1 = 30px rendered.
const LS_KEY = 'nexus-layout-v15'

const DEFAULT_LAYOUT: DashboardLayout = [
  // ══ ROW 1 (y:0→14) — Live intelligence feed ══════════════════════════════
  // Unchanged per user: TV | News | Watchlist
  { i: 'livevideo',     x: 0,  y: 0,  w: 5,  h: 14, minW: 3, minH: 10 },
  { i: 'news',          x: 5,  y: 0,  w: 5,  h: 14, minW: 3, minH: 8  },
  { i: 'watchlist',     x: 10, y: 0,  w: 2,  h: 14, minW: 2, minH: 8  },

  // ══ ROW 2 (y:14→30) — Market pulse ═══════════════════════════════════════
  // Unchanged per user: Indices | Clock | Chart (hero)
  { i: 'indices',       x: 0,  y: 14, w: 2,  h: 16, minW: 2, minH: 8  },
  { i: 'mktclock',      x: 2,  y: 14, w: 3,  h: 16, minW: 2, minH: 8  },
  { i: 'chart',         x: 5,  y: 14, w: 7,  h: 16, minW: 4, minH: 14 },

  // ══ ROW 3 (y:30→44) — Global markets overview ════════════════════════════
  // Unchanged per user: India | Heatmap | Commodities
  { i: 'indiamarkets',  x: 0,  y: 30, w: 3,  h: 14, minW: 2, minH: 10 },
  { i: 'heatmap',       x: 3,  y: 30, w: 4,  h: 14, minW: 2, minH: 10 },
  { i: 'commodities',   x: 7,  y: 30, w: 5,  h: 14, minW: 2, minH: 10 },

  // ══ ROW 4 (y:44→56) — Time-critical signals (earnings · events · flow) ════
  // All panels here are market-moving and need daily attention.
  // Heights matched to content: each needs ~330-360px (h:12 = 360px).
  { i: 'earnings',      x: 0,  y: 44, w: 3,  h: 12, minW: 2, minH: 8  },
  { i: 'calendar',      x: 3,  y: 44, w: 3,  h: 12, minW: 2, minH: 8  },
  { i: 'insiderdeals',  x: 6,  y: 44, w: 4,  h: 12, minW: 3, minH: 8  },
  { i: 'sentiment',     x: 10, y: 44, w: 2,  h: 12, minW: 2, minH: 8  },

  // ══ ROW 5 (y:56→74) — Deep analytics ═════════════════════════════════════
  // Options needs most height (BSM + Greeks + OI chart ≈ 480px → h:18 = 540px).
  // Supply Chain: 4 cols for the 3-col map layout.
  // Macro Rates: rich but scrollable; h:18 gives it room for FED schedule.
  { i: 'options',       x: 0,  y: 56, w: 5,  h: 18, minW: 4, minH: 14 },
  { i: 'supplychain',   x: 5,  y: 56, w: 4,  h: 18, minW: 3, minH: 12 },
  { i: 'macrorates',    x: 9,  y: 56, w: 3,  h: 18, minW: 2, minH: 10 },

  // ══ ROW 6 (y:74→90) — Market structure ═══════════════════════════════════
  { i: 'fixedincome',   x: 0,  y: 74, w: 5,  h: 16, minW: 3, minH: 12 },
  { i: 'ipo',           x: 5,  y: 74, w: 4,  h: 16, minW: 3, minH: 10 },
  { i: 'altsignals',    x: 9,  y: 74, w: 3,  h: 16, minW: 2, minH: 10 },

  // ══ ROW 7 (y:90→108) — Smart money research ══════════════════════════════
  // 3 panels @ 4-col × h:18 — SEC Filings · Smart Money · Alt Data (Wiki/Reddit/Trends).
  // Smart Money replaces the old 13F Tracker (which was redundant).
  { i: 'secfilings',    x: 0,  y: 90, w: 4,  h: 18, minW: 3, minH: 14 },
  { i: 'smartmoney',    x: 4,  y: 90, w: 4,  h: 18, minW: 3, minH: 14 },
  { i: 'altdata',       x: 8,  y: 90, w: 4,  h: 18, minW: 3, minH: 14 },
]

// ── MOBILE panel order (priority-first: live data → analytics → research) ─────
const MOBILE_ORDER: PanelId[] = [
  // Tier 1: Always-on essentials
  'watchlist', 'chart', 'news',
  // Tier 2: Market pulse
  'indices', 'indiamarkets', 'commodities',
  // Tier 3: Time-critical signals
  'earnings', 'calendar', 'insiderdeals', 'sentiment',
  // Tier 4: Deep analytics
  'options', 'macrorates', 'heatmap', 'fixedincome',
  // Tier 5: Research
  'smartmoney', 'secfilings', 'altdata', 'supplychain', 'ipo',
  // Tier 6: Alt + media
  'altsignals', 'mktclock', 'livevideo',
]

// ── Breakpoints ────────────────────────────────────────────────────────────────
function useBreakpoint() {
  const [bp, setBp] = useState<'mobile' | 'tablet' | 'desktop'>('desktop')

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      if (w < 640)       setBp('mobile')
      else if (w < 1024) setBp('tablet')
      else               setBp('desktop')
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return bp
}

// ── Layout helpers ─────────────────────────────────────────────────────────────

function cloneLayout<T extends LayoutItem>(layout: readonly T[]): T[] {
  return layout.map(item => ({ ...item })) as T[]
}

function isPanelId(v: unknown): v is PanelId {
  return typeof v === 'string' && (PANEL_IDS as readonly string[]).includes(v)
}

function normalizeLayout(layout: Layout): DashboardLayout | null {
  if (!layout.every(item => {
    if (!item || typeof item !== 'object') return false
    const i = item as unknown as Record<string, unknown>

    return (
      isPanelId(i.i) &&
      typeof i.x === 'number' &&
      typeof i.y === 'number' &&
      typeof i.w === 'number' &&
      typeof i.h === 'number'
    )
  })) return null

  const keys = new Set(layout.map(item => item.i))
  if (!PANEL_IDS.every(id => keys.has(id))) return null

  return cloneLayout(layout) as DashboardLayout
}

function loadLayout(): DashboardLayout {
  if (typeof window === 'undefined') return cloneLayout(DEFAULT_LAYOUT)
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (!saved) return cloneLayout(DEFAULT_LAYOUT)
    const parsed: unknown = JSON.parse(saved)
    if (!Array.isArray(parsed)) return cloneLayout(DEFAULT_LAYOUT)
    return normalizeLayout(parsed) ?? cloneLayout(DEFAULT_LAYOUT)
  } catch { return cloneLayout(DEFAULT_LAYOUT) }
}

function saveLayout(layout: DashboardLayout) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(layout)) } catch {}
}

// ── Fluid void-free packer ───────────────────────────────────────────────────
// Reflows visible panels into a fully-tiled grid:
//   1. Group panels into rows greedily, capping each row at 12 cols
//   2. Stretch widths so every row totals exactly 12 cols (no horizontal voids)
//   3. Set every panel in a row to the row's tallest natural height
//      (no vertical voids between rows)
//   4. Hidden panels get parked far below the visible grid; they stay in the
//      layout state because react-grid-layout requires every key present.
function packLayout(visibleIds: readonly PanelId[]): DashboardLayout {
  const sizeMap = new Map<PanelId, { w: number; h: number; minW?: number; minH?: number }>()
  for (const item of DEFAULT_LAYOUT) {
    sizeMap.set(item.i, { w: item.w, h: item.h, minW: item.minW, minH: item.minH })
  }

  const COLS = 12

  type Row = {
    ids:    PanelId[]
    widths: number[]      // natural widths, mutated in step 2
    maxH:   number
  }

  // ── Step 1: greedy row packing ────────────────────────────────────────────
  const rows: Row[] = []
  let cur: Row = { ids: [], widths: [], maxH: 0 }
  let curW = 0

  for (const id of visibleIds) {
    const sz = sizeMap.get(id)
    if (!sz) continue
    const w = Math.min(sz.w, COLS)

    if (curW + w > COLS) {
      if (cur.ids.length > 0) rows.push(cur)
      cur = { ids: [id], widths: [w], maxH: sz.h }
      curW = w
    } else {
      cur.ids.push(id)
      cur.widths.push(w)
      if (sz.h > cur.maxH) cur.maxH = sz.h
      curW += w
    }
  }
  if (cur.ids.length > 0) rows.push(cur)

  // ── Step 2: stretch each row's widths to total exactly 12 ─────────────────
  for (const row of rows) {
    const total = row.widths.reduce((a, b) => a + b, 0)
    const leftover = COLS - total
    if (leftover <= 0) continue
    let distributed = 0
    for (let i = 0; i < row.widths.length; i++) {
      const isLast = i === row.widths.length - 1
      const extra  = isLast
        ? leftover - distributed
        : Math.floor((leftover * row.widths[i]) / total)
      row.widths[i] += extra
      distributed   += extra
    }
  }

  // ── Step 3: emit items with uniform row heights ───────────────────────────
  const out: DashboardLayout = []
  let y = 0
  for (const row of rows) {
    let x = 0
    for (let i = 0; i < row.ids.length; i++) {
      const id = row.ids[i]
      const sz = sizeMap.get(id)!
      out.push({
        i:    id,
        x,
        y,
        w:    row.widths[i],
        h:    row.maxH,
        minW: sz.minW,
        minH: sz.minH,
      })
      x += row.widths[i]
    }
    y += row.maxH
  }

  // ── Step 4: park hidden panels far off-screen ─────────────────────────────
  const visibleSet = new Set(visibleIds)
  let hY = y + 100, hX = 0, hRowH = 0
  for (const id of PANEL_IDS) {
    if (visibleSet.has(id)) continue
    const sz = sizeMap.get(id)
    if (!sz) continue
    const w = Math.min(sz.w, COLS)
    if (hX + w > COLS) { hX = 0; hY += hRowH; hRowH = 0 }
    out.push({ i: id, x: hX, y: hY, w, h: sz.h, minW: sz.minW, minH: sz.minH })
    hX += w
    if (sz.h > hRowH) hRowH = sz.h
  }

  return out
}

// ── Panel group definitions for visibility menu ────────────────────────────────

const PANEL_GROUPS: { label: string; ids: PanelId[] }[] = [
  { label: 'Live Feed',    ids: ['livevideo', 'news', 'watchlist']                                          },
  { label: 'Market Pulse', ids: ['chart', 'indices', 'mktclock', 'indiamarkets', 'heatmap', 'commodities']  },
  { label: 'Signals',      ids: ['earnings', 'calendar', 'insiderdeals', 'sentiment']                       },
  { label: 'Analytics',    ids: ['options', 'macrorates', 'fixedincome', 'supplychain']                     },
  { label: 'Research',     ids: ['smartmoney', 'secfilings', 'altdata', 'ipo', 'altsignals']                },
]

// ── Mobile panel component ─────────────────────────────────────────────────────

function MobilePanelCard({ id, hidden, onToggle }: {
  id:       PanelId
  hidden:   boolean
  onToggle: () => void
}) {
  const meta = PANEL_META[id]
  const [collapsed, setCollapsed] = useState(false)

  if (hidden) return null

  return (
    <div style={{
      marginBottom: '8px',
      border:       '1px solid var(--border)',
      borderRadius: '8px',
      overflow:     'hidden',
      background:   'var(--bg-panel)',
    }}>
      {/* Mobile panel header — tap to collapse */}
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '10px 14px',
          cursor:         'pointer',
          borderBottom:   collapsed ? 'none' : '1px solid var(--border)',
          userSelect:     'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: meta.color,
            boxShadow: `0 0 6px ${meta.color}`,
            animation: 'pulseDot 2s ease-in-out infinite',
          }} />
          <div>
            <div style={{
              fontFamily:    'Syne, sans-serif',
              fontWeight:    800,
              fontSize:      '13px',
              color:         '#fff',
              letterSpacing: '0.06em',
            }}>
              {meta.label}
            </div>
            <div style={{
              fontSize:   '10px',
              color:      'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
              marginTop:  '1px',
            }}>
              {meta.description}
            </div>
          </div>
        </div>
        <div style={{
          fontSize:   '16px',
          color:      'var(--text-muted)',
          transform:  collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s',
          lineHeight: 1,
        }}>
          ▾
        </div>
      </div>

      {/* Panel content */}
      {!collapsed && (
        <div style={{ height: meta.mobileH, overflow: 'hidden' }}>
          {meta.component}
        </div>
      )}
    </div>
  )
}

// ── Tablet 2-column layout ─────────────────────────────────────────────────────

function TabletLayout({ hidden }: { hidden: Set<PanelId> }) {
  // Arrange panels into 2 columns
  const visible = MOBILE_ORDER.filter(id => !hidden.has(id))

  return (
    <div style={{
      display:             'grid',
      gridTemplateColumns: '1fr 1fr',
      gap:                 '8px',
      padding:             '8px',
    }}>
      {visible.map(id => {
        const meta = PANEL_META[id]
        const isWide = ['chart', 'livevideo', 'news', 'indiamarkets', 'macrorates', 'correlation', 'commodities'].includes(id)
        return (
          <div
            key={id}
            style={{
              gridColumn:   isWide ? 'span 2' : 'span 1',
              height:       meta.mobileH,
              border:       '1px solid var(--border)',
              borderRadius: '8px',
              overflow:     'hidden',
              background:   'var(--bg-panel)',
            }}
          >
            {meta.component}
          </div>
        )
      })}
    </div>
  )
}

// ── Main GridLayout component ──────────────────────────────────────────────────

export default function GridLayout() {
  // All state starts at SSR-safe defaults; localStorage is read in useEffect
  // after hydration to avoid SSR/client divergence.
  const [mounted,  setMounted]  = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [layout,   setLayout]   = useState<DashboardLayout>(() => cloneLayout(DEFAULT_LAYOUT))
  const [saved,    setSaved]    = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false)
  const [hidden,   setHidden]   = useState<Set<PanelId>>(() => new Set())

  const activeWorkspace = useWorkspace(s => s.active)
  const setWorkspace    = useWorkspace(s => s.setActive)

  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const isTablet = bp === 'tablet'

  const originalLayoutRef     = useRef<DashboardLayout>(cloneLayout(DEFAULT_LAYOUT))
  const saveIndicatorTimerRef = useRef<number | null>(null)

  // Hydrate persisted state from localStorage after mount (single source of truth
  // for SSR-safety + so originalLayoutRef matches what the user actually has saved).
  useEffect(() => {
    const persistedLayout = loadLayout()
    setLayout(persistedLayout)
    originalLayoutRef.current = cloneLayout(persistedLayout)

    try {
      const stored = localStorage.getItem('nexus-hidden-panels')
      if (stored) setHidden(new Set(JSON.parse(stored)))
    } catch {}

    const frameId = window.requestAnimationFrame(() => setMounted(true))
    return () => {
      window.cancelAnimationFrame(frameId)
      if (saveIndicatorTimerRef.current !== null) window.clearTimeout(saveIndicatorTimerRef.current)
    }
  }, [])

  // Persist hidden panels
  useEffect(() => {
    if (!mounted) return  // skip the initial-mount write (we just read this value)
    try { localStorage.setItem('nexus-hidden-panels', JSON.stringify([...hidden])) } catch {}
  }, [hidden, mounted])

  const showSaveIndicator = () => {
    setSaved(true)
    if (saveIndicatorTimerRef.current !== null) window.clearTimeout(saveIndicatorTimerRef.current)
    saveIndicatorTimerRef.current = window.setTimeout(() => {
      setSaved(false)
      saveIndicatorTimerRef.current = null
    }, 2000)
  }

  const handleStartEdit = () => { originalLayoutRef.current = cloneLayout(layout); setEditing(true) }
  const handleSave      = () => { saveLayout(cloneLayout(layout)); setEditing(false); showSaveIndicator() }
  const handleCancel    = () => { setLayout(cloneLayout(originalLayoutRef.current)); setEditing(false) }
  const handleReset     = () => {
    const n = cloneLayout(DEFAULT_LAYOUT)
    originalLayoutRef.current = cloneLayout(n)
    setLayout(n); saveLayout(n); setEditing(false); showSaveIndicator()
  }

  const applyWorkspace = (id: WorkspaceId) => {
    const ws = WORKSPACES.find(w => w.id === id)
    if (!ws) return
    setWorkspace(id)
    setShowWorkspaceMenu(false)

    if (id === 'all') {
      // Reveal everything and restore the curated default layout.
      setHidden(new Set())
      const fresh = cloneLayout(DEFAULT_LAYOUT)
      setLayout(fresh)
      saveLayout(fresh)
      return
    }

    if (id === 'custom' || ws.visible === null) {
      // Keep current layout + hidden as the user left them.
      return
    }

    // Preset: hide the panels not in this workspace and reflow the rest into
    // a void-free packed layout.
    const visibleSet = new Set(ws.visible as readonly PanelId[])
    const newHidden = new Set<PanelId>()
    for (const p of PANEL_IDS) if (!visibleSet.has(p)) newHidden.add(p)
    setHidden(newHidden)

    const packed = packLayout(ws.visible as readonly PanelId[])
    setLayout(packed)
    saveLayout(packed)
  }

  const toggleHide = (id: PanelId) => {
    // User manually toggling a panel → break out to 'custom' workspace
    if (activeWorkspace !== 'custom' && activeWorkspace !== 'all') {
      setWorkspace('custom')
    }
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const visibleLayout = layout.filter(({ i }) => !hidden.has(i))

  if (!mounted) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', color: 'var(--text-muted)',
        fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', letterSpacing: '0.12em',
        flexDirection: 'column', gap: '12px',
      }}>
        <div style={{
          width: '32px', height: '32px',
          border: '2px solid var(--border)', borderTop: '2px solid var(--teal)',
          borderRadius: '50%', animation: 'spin 0.8s linear infinite',
        }} />
        <span>LOADING NEXUS...</span>
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // ── MOBILE LAYOUT ────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ padding: '8px', paddingBottom: '40px', overflowX: 'hidden' }}>

        {/* Alerts work everywhere */}
        <AlertEngine />
        <AlertToasts />

        {/* Mobile toolbar */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          marginBottom:   '8px',
          padding:        '6px 4px',
        }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowWorkspaceMenu(v => !v); setShowMenu(false) }}
              style={{
                padding:    '5px 12px',
                borderRadius:'3px',
                cursor:     'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize:   '10px',
                letterSpacing: '0.08em',
                border:     `1px solid ${showWorkspaceMenu ? 'var(--amber)' : 'var(--border)'}`,
                background: showWorkspaceMenu ? 'rgba(240,165,0,0.10)' : 'transparent',
                color:      showWorkspaceMenu ? 'var(--amber)' : 'var(--text-muted)',
              }}
            >
              {(WORKSPACES.find(w => w.id === activeWorkspace)?.label ?? 'All').toUpperCase()} ▾
            </button>
            {showWorkspaceMenu && (
              <WorkspaceMenu
                active={activeWorkspace}
                onPick={applyWorkspace}
                onClose={() => setShowWorkspaceMenu(false)}
              />
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowMenu(v => !v); setShowWorkspaceMenu(false) }}
              style={{
                padding:    '5px 12px',
                borderRadius:'3px',
                cursor:     'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize:   '10px',
                letterSpacing: '0.08em',
                border:     `1px solid ${showMenu ? 'var(--teal)' : 'var(--border)'}`,
                background: showMenu ? 'rgba(0,229,192,0.1)' : 'transparent',
                color:      showMenu ? 'var(--teal)' : 'var(--text-muted)',
              }}
            >
              PANELS {hidden.size > 0 ? `(${hidden.size} off)` : ''}
            </button>

            {showMenu && (
              <div style={{
                position:  'absolute',
                right:     0,
                top:       'calc(100% + 4px)',
                background:'var(--bg-panel)',
                border:    '1px solid var(--border)',
                borderRadius: '8px',
                padding:   '10px',
                zIndex:    200,
                width:     '200px',
                boxShadow: '0 12px 40px rgba(0,0,0,0.7)',
              }}>
                {PANEL_GROUPS.map(group => (
                  <div key={group.label} style={{ marginBottom: '10px' }}>
                    <div style={{
                      fontSize:    '10px',
                      color:       'var(--text-muted)',
                      fontFamily:  'JetBrains Mono, monospace',
                      letterSpacing: '0.12em',
                      marginBottom: '4px',
                      padding:     '0 4px',
                    }}>
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
                            display:        'flex',
                            alignItems:     'center',
                            justifyContent: 'space-between',
                            padding:        '6px 8px',
                            borderRadius:   '4px',
                            cursor:         'pointer',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{
                              width: '8px', height: '8px', borderRadius: '50%',
                              background: visible ? meta.color : 'var(--border)',
                            }} />
                            <span style={{
                              fontSize:   '11px',
                              color:      visible ? '#fff' : 'var(--text-muted)',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}>
                              {meta.label}
                            </span>
                          </div>
                          <div style={{
                            width:        '16px',
                            height:       '16px',
                            borderRadius: '3px',
                            border:       `1px solid ${visible ? meta.color : 'var(--border)'}`,
                            background:   visible ? meta.color + '30' : 'transparent',
                            display:      'flex',
                            alignItems:   'center',
                            justifyContent:'center',
                            fontSize:     '10px',
                            color:        visible ? meta.color : 'var(--text-muted)',
                          }}>
                            {visible ? '✓' : ''}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mobile panels — stacked full-width */}
        {MOBILE_ORDER.map(id => (
          <MobilePanelCard
            key={id}
            id={id}
            hidden={hidden.has(id)}
            onToggle={() => toggleHide(id)}
          />
        ))}

        <style>{`
          @keyframes pulseDot {
            0%,100% { opacity:1; }
            50%      { opacity:0.4; }
          }
        `}</style>
      </div>
    )
  }

  // ── TABLET LAYOUT ────────────────────────────────────────────────────────────
  if (isTablet) {
    return (
      <div style={{ paddingBottom: '40px' }}>
        <AlertEngine />
        <AlertToasts />
        <div style={{
          display:        'flex',
          justifyContent: 'flex-end',
          gap:            '8px',
          padding:        '6px 12px',
          borderBottom:   '1px solid var(--border)',
          background:     'var(--bg-base)',
          position:       'relative',
          top:            '6px',
          zIndex:         50,
        }}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowWorkspaceMenu(v => !v); setShowMenu(false) }}
              style={{
                padding: '4px 12px', borderRadius: '3px', cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
                border: `1px solid ${showWorkspaceMenu ? 'var(--amber)' : 'var(--border)'}`,
                background: showWorkspaceMenu ? 'rgba(240,165,0,0.10)' : 'transparent',
                color: showWorkspaceMenu ? 'var(--amber)' : 'var(--text-muted)',
              }}
            >
              {(WORKSPACES.find(w => w.id === activeWorkspace)?.label ?? 'All').toUpperCase()} ▾
            </button>
            {showWorkspaceMenu && (
              <WorkspaceMenu
                active={activeWorkspace}
                onPick={applyWorkspace}
                onClose={() => setShowWorkspaceMenu(false)}
              />
            )}
          </div>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => { setShowMenu(v => !v); setShowWorkspaceMenu(false) }}
              style={{
                padding: '4px 12px', borderRadius: '3px', cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
                border: `1px solid ${showMenu ? 'var(--teal)' : 'var(--border)'}`,
                background: showMenu ? 'rgba(0,229,192,0.1)' : 'transparent',
                color: showMenu ? 'var(--teal)' : 'var(--text-muted)',
              }}
            >
              PANELS {hidden.size > 0 ? `(${hidden.size} hidden)` : ''}
            </button>
            {showMenu && <PanelMenu hidden={hidden} toggleHide={toggleHide} onClose={() => setShowMenu(false)} />}
          </div>
        </div>
        <TabletLayout hidden={hidden} />
      </div>
    )
  }

  // ── DESKTOP DRAG-DROP LAYOUT ──────────────────────────────────────────────────

  const btnBase: React.CSSProperties = {
    padding: '4px 14px', borderRadius: '3px', cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
    letterSpacing: '0.08em', textTransform: 'uppercase', transition: 'all 0.15s',
  }

  // Pass full panel registry into the keyboard palette
  const paletteTargets = (Object.keys(PANEL_META) as PanelId[]).map(id => ({
    id, label: PANEL_META[id].label, description: PANEL_META[id].description,
  }))

  return (
    <div style={{ padding: '0 6px 40px' }}>

      {/* Global UX layer — alerts, keyboard shortcuts, alert engine */}
      <AlertEngine />
      <AlertToasts />
      <KeyboardShortcuts panels={paletteTargets} />

      {/* ── STICKY TOOLBAR ──────────────────────────────────────────────── */}
      {/* Pins to the top of the scrolling grid-container, sitting flush      */}
      {/* against the top-nav (which holds NEXUS header + ticker + brief).    */}
      <div style={{
        position:     'sticky',
        top:          0,
        zIndex:       100,
        background:   'var(--bg-base)',
        borderBottom: '1px solid var(--border)',
        boxShadow:    '0 4px 12px rgba(0,0,0,0.30)',
      }}>
        {/* Desktop toolbar */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', alignItems: 'center',
          gap: '6px', padding: '5px 0',
          borderBottom: editing ? '1px solid rgba(240,165,0,0.2)' : 'none',
          transition: 'border-color 0.2s',
        }}>
        {editing && (
          <span style={{
            fontSize: '11px', color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: '0.06em', marginRight: 'auto', marginLeft: '4px',
          }}>
            drag headers to move · corner to resize
          </span>
        )}
        {saved && !editing && (
          <span style={{ fontSize: '10px', color: 'var(--positive)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>
            ✓ layout saved
          </span>
        )}

        {/* Workspace preset selector */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowWorkspaceMenu(v => !v); setShowMenu(false) }}
            title="Switch workspace preset"
            style={{
              ...btnBase,
              border: `1px solid ${showWorkspaceMenu ? 'var(--amber)' : 'var(--border)'}`,
              background: showWorkspaceMenu ? 'rgba(240,165,0,0.10)' : 'transparent',
              color: showWorkspaceMenu ? 'var(--amber)' : 'var(--text-muted)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span style={{ opacity: 0.7 }}>WS:</span>
            <span style={{ color: '#fff', fontWeight: 700 }}>
              {(WORKSPACES.find(w => w.id === activeWorkspace)?.label ?? 'All Panels').toUpperCase()}
            </span>
            <span style={{ fontSize: '8px', opacity: 0.7 }}>▾</span>
          </button>
          {showWorkspaceMenu && (
            <WorkspaceMenu
              active={activeWorkspace}
              onPick={applyWorkspace}
              onClose={() => setShowWorkspaceMenu(false)}
            />
          )}
        </div>

        {/* Panel visibility toggle */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowMenu(v => !v); setShowWorkspaceMenu(false) }}
            style={{ ...btnBase, border: `1px solid ${showMenu ? 'var(--teal)' : 'var(--border)'}`, background: showMenu ? 'rgba(0,229,192,0.08)' : 'transparent', color: showMenu ? 'var(--teal)' : 'var(--text-muted)' }}
          >
            PANELS {hidden.size > 0 ? `(${hidden.size} off)` : ''}
          </button>
          {showMenu && <PanelMenu hidden={hidden} toggleHide={toggleHide} onClose={() => setShowMenu(false)} />}
        </div>

        {!editing ? (
          <>
            <button
              onClick={handleStartEdit}
              style={{ ...btnBase, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--amber)'; e.currentTarget.style.color = 'var(--amber)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              Edit Layout
            </button>
            <button
              onClick={handleReset}
              style={{ ...btnBase, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = '#fff' }}
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
              Save Layout
            </button>
          </>
        )}
        </div>
      </div>
      {/* ── /STICKY HEADER ──────────────────────────────────────────────── */}

      {/* Desktop grid */}
      <div style={{ marginTop: '8px' }}>
        <ReactGridLayout
          layout={visibleLayout}
          cols={12} rowHeight={30}
          margin={[8, 8]} containerPadding={[0, 0]}
          isDraggable={editing} isResizable={editing}
          draggableHandle=".nexus-drag-handle"
          onLayoutChange={next => {
            if (!editing) return
            const n = normalizeLayout(next)
            if (n) setLayout(n)
          }}
          useCSSTransforms compactType="vertical"
        >
          {visibleLayout.map(({ i }) => {
            const meta  = PANEL_META[i]
            const eager = EAGER_MOUNT.has(i)
            return (
              <div key={i} data-panel-id={i} style={{
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                outline:      editing ? '1px solid rgba(240,165,0,0.2)' : 'none',
                borderRadius: '6px', transition: 'outline 0.2s, box-shadow 0.2s',
              }}>
                {editing && (
                  <div
                    className="nexus-drag-handle"
                    style={{
                      height: '28px', flexShrink: 0,
                      background: 'rgba(240,165,0,0.07)',
                      borderBottom: '1px solid rgba(240,165,0,0.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0 12px', cursor: 'grab',
                      borderRadius: '6px 6px 0 0', userSelect: 'none',
                    }}
                    onMouseDown={e => { e.currentTarget.style.cursor = 'grabbing' }}
                    onMouseUp={e   => { e.currentTarget.style.cursor = 'grab' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>⠿ DRAG</span>
                      <span style={{ fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: meta.color, letterSpacing: '0.1em' }}>{meta.label}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>↔ move · ↘ resize</span>
                  </div>
                )}
                <div style={{ flex: 1, overflow: 'hidden', minHeight: 0, borderRadius: editing ? '0 0 6px 6px' : '6px' }}>
                  {eager ? meta.component : <LazyMount>{meta.component}</LazyMount>}
                </div>
              </div>
            )
          })}
        </ReactGridLayout>
      </div>

      <style>{`
        /* Smooth snap/resize/move transitions */
        .react-grid-item {
          transition-property: transform, width, height !important;
          transition-duration: 180ms !important;
          transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1) !important;
          will-change: transform, width, height;
        }
        .react-grid-item.cssTransforms {
          transition-property: transform, width, height !important;
          transition-duration: 180ms !important;
          transition-timing-function: cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        /* Skip transition while actively dragging or resizing → feels glued to cursor */
        .react-grid-item.react-draggable-dragging,
        .react-grid-item.resizing {
          transition: none !important;
          z-index: 10 !important;
        }
        .react-grid-item.react-draggable-dragging {
          opacity: 0.92;
          box-shadow:
            0 16px 40px rgba(0, 0, 0, 0.55),
            0 0 0 1px rgba(240, 165, 0, 0.55),
            0 0 24px rgba(240, 165, 0, 0.15) !important;
          cursor: grabbing !important;
        }
        .react-grid-item.resizing {
          opacity: 0.95;
          box-shadow:
            0 0 0 2px rgba(240, 165, 0, 0.55),
            0 0 18px rgba(240, 165, 0, 0.25) !important;
        }

        /* Drop-zone preview with diagonal stripe so the snap target is unmistakable */
        .react-grid-item.react-grid-placeholder {
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
          z-index: 2 !important;
          transition: transform 120ms ease-out, width 120ms ease-out, height 120ms ease-out !important;
          box-shadow: 0 0 0 1px rgba(240, 165, 0, 0.20), inset 0 0 24px rgba(240, 165, 0, 0.08) !important;
        }

        /* Resize handle — bigger, easier to grab, with a clear corner glyph */
        .react-resizable-handle {
          background: none !important;
          width: 18px !important;
          height: 18px !important;
        }
        .react-resizable-handle::before {
          content: '';
          position: absolute;
          right: 3px;
          bottom: 3px;
          width: 12px;
          height: 12px;
          border-right: 2px solid rgba(240, 165, 0, 0.75);
          border-bottom: 2px solid rgba(240, 165, 0, 0.75);
          border-radius: 0 0 4px 0;
          transition: border-color 0.15s, transform 0.15s;
        }
        .react-resizable-handle:hover::before {
          border-color: var(--amber);
          transform: scale(1.15);
        }

        .nexus-drag-handle { user-select: none; }
        @keyframes pulseDot { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

// ── Workspace preset menu ──────────────────────────────────────────────────────

function WorkspaceMenu({ active, onPick, onClose }: {
  active:  WorkspaceId
  onPick:  (id: WorkspaceId) => void
  onClose: () => void
}) {
  return (
    <div
      style={{
        position:     'absolute',
        right:        0,
        top:          'calc(100% + 4px)',
        background:   'var(--bg-panel)',
        border:       '1px solid var(--border)',
        borderRadius: '8px',
        padding:      '8px',
        zIndex:       200,
        width:        '260px',
        boxShadow:    '0 12px 40px rgba(0,0,0,0.7)',
      }}
    >
      <div style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        padding:        '4px 6px 8px',
        borderBottom:   '1px solid var(--border)',
        marginBottom:   '6px',
      }}>
        <span style={{
          fontSize: '10px', color: 'var(--text-muted)',
          fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.14em',
        }}>
          WORKSPACES
        </span>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px' }}
        >
          ✕
        </button>
      </div>
      {WORKSPACES.map(ws => {
        const isActive = ws.id === active
        return (
          <button
            key={ws.id}
            onClick={() => onPick(ws.id)}
            style={{
              width:          '100%',
              textAlign:      'left',
              display:        'flex',
              flexDirection:  'column',
              gap:            '2px',
              padding:        '8px 10px',
              borderRadius:   '4px',
              border:         '1px solid transparent',
              background:     isActive ? 'rgba(240,165,0,0.10)' : 'transparent',
              borderColor:    isActive ? 'rgba(240,165,0,0.4)' : 'transparent',
              cursor:         'pointer',
              fontFamily:     'JetBrains Mono, monospace',
              transition:     'background 0.12s',
              marginBottom:   '2px',
            }}
            onMouseEnter={e => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
            }}
            onMouseLeave={e => {
              if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{
                fontSize: '12px', color: isActive ? 'var(--amber)' : '#fff',
                fontWeight: 700, letterSpacing: '0.06em',
              }}>
                {ws.label}
              </span>
              {isActive && (
                <span style={{
                  fontSize: '9px', color: 'var(--amber)',
                  letterSpacing: '0.1em',
                }}>
                  ● ACTIVE
                </span>
              )}
            </div>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {ws.description}
            </span>
          </button>
        )
      })}
      <div style={{
        marginTop:    '4px',
        paddingTop:   '6px',
        borderTop:    '1px solid var(--border)',
        fontSize:     '10px',
        color:        'var(--text-muted)',
        padding:      '6px 6px 2px',
        lineHeight:   1.4,
      }}>
        Toggle individual panels via PANELS to switch to Custom.
      </div>
    </div>
  )
}

// ── Shared panel menu component ────────────────────────────────────────────────

function PanelMenu({ hidden, toggleHide, onClose }: {
  hidden:     Set<PanelId>
  toggleHide: (id: PanelId) => void
  onClose:    () => void
}) {
  return (
    <div
      style={{
        position:     'absolute',
        right:        0,
        top:          'calc(100% + 4px)',
        background:   'var(--bg-panel)',
        border:       '1px solid var(--border)',
        borderRadius: '8px',
        padding:      '10px',
        zIndex:       200,
        width:        '230px',
        boxShadow:    '0 12px 40px rgba(0,0,0,0.7)',
        maxHeight:    '70vh',
        overflowY:    'auto',
      }}
    >
      <div style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        marginBottom:   '8px',
        paddingBottom:  '6px',
        borderBottom:   '1px solid var(--border)',
      }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
          TOGGLE PANELS
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '14px' }}>
          ✕
        </button>
      </div>

      {PANEL_GROUPS.map(group => (
        <div key={group.label} style={{ marginBottom: '10px' }}>
          <div style={{
            fontSize:    '10px',
            color:       'var(--text-muted)',
            fontFamily:  'JetBrains Mono, monospace',
            letterSpacing:'0.12em',
            marginBottom:'4px',
            paddingLeft: '4px',
          }}>
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
                  display:        'flex',
                  alignItems:     'center',
                  justifyContent: 'space-between',
                  padding:        '5px 8px',
                  borderRadius:   '4px',
                  cursor:         'pointer',
                  transition:     'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: visible ? meta.color : 'var(--border)',
                    transition: 'background 0.15s',
                  }} />
                  <div>
                    <div style={{ fontSize: '11px', color: visible ? '#fff' : 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {meta.label}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {meta.description}
                    </div>
                  </div>
                </div>
                <div style={{
                  width:        '16px',
                  height:       '16px',
                  borderRadius: '3px',
                  border:       `1px solid ${visible ? meta.color : 'var(--border)'}`,
                  background:   visible ? meta.color + '25' : 'transparent',
                  display:      'flex',
                  alignItems:   'center',
                  justifyContent:'center',
                  fontSize:     '10px',
                  color:        meta.color,
                  flexShrink:   0,
                }}>
                  {visible ? '✓' : ''}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}