'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import GridLayoutBase, { WidthProvider, type Layout, type LayoutItem } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

// ── Panel imports ─────────────────────────────────────────────────────────────
import AlternativeSignalsPanel  from '@/components/panels/AlternativeSignalsPanel'
import ChartPanel               from '@/components/panels/ChartPanel'
import SupplyChainPanel        from '@/components/panels/SupplyChainPanel'
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
import CommoditiesPanel         from '@/components/panels/CommoditiesPanel'
import InsiderDealsPanel        from '@/components/panels/InsiderDealsPanel'
import IpoScreenerPanel         from '@/components/panels/IpoScreenerPanel'
import OptionsPanel             from '@/components/panels/OptionsPanel'
import FixedIncomePanel         from '@/components/panels/FixedIncomePanel'
import InstitutionalHoldingsPanel from '@/components/panels/InstitutionalHoldingsPanel'
import AlternativeDataPanel     from '@/components/panels/AlternativeDataPanel'
import SecFilingsPanel          from '@/components/panels/SecFilingsPanel'
// ── Forex / Crypto trading suite
import { TradingProvider }          from '@/components/trading/TradingContext'
import { RiskPanel }                from '@/components/panels/RiskPanel'
import { LiveDashboard }            from '@/components/panels/LiveDashboard'
import { CalendarPanel }            from '@/components/panels/CalendarPanel'
import { PropFirmPanel }            from '@/components/panels/PropFirmPanel'
// ── Terminal-grade UX layer
// (MorningBrief is mounted in Dashboard's top-nav so it sits in the same
//  sticky block as TickerBar — no gap behind which panels could show.)
import LazyMount                    from '@/components/dashboard/LazyMount'
import KeyboardShortcuts            from '@/components/dashboard/KeyboardShortcuts'
import AlertToasts                  from '@/components/dashboard/AlertToasts'
import AlertEngine                  from '@/components/dashboard/AlertEngine'
const ReactGridLayout = WidthProvider(GridLayoutBase)

// Panels that mount eagerly (rows 1-4, y < 56). All below-fold panels are
// gated behind LazyMount + IntersectionObserver to defer their API calls.
const EAGER_MOUNT: Set<string> = new Set([
  'livevideo', 'news', 'watchlist',
  'indices', 'mktclock', 'chart',
  'indiamarkets', 'heatmap', 'commodities',
  'earnings', 'calendar', 'insiderdeals', 'sentiment',
])

// ── Panel registry ─────────────────────────────────────────────────────────────

const PANEL_IDS = [
  'livevideo', 'news', 'watchlist',
  'indices', 'mktclock', 'chart',
  'sentiment', 'calendar', 'earnings',
  'heatmap', 'indiamarkets', 'macrorates',
  'altsignals','insiderdeals', 'commodities', 'correlation',
  'options', 'ipo', 'fixedincome',
  // Research add-ons
  'institutional', 'altdata', 'secfilings',
  // Forex / Crypto trading suite
  'fx-risk', 'fx-live',
  'fx-calendar', 'fx-propfirm',
] as const

type PanelId = (typeof PANEL_IDS)[number]
type DashboardLayoutItem = LayoutItem & { i: PanelId }
type DashboardLayout     = DashboardLayoutItem[]

type PanelMeta = {
  component:   ReactNode
  label:       string
  color:       string
  mobileH:     number   // px height on mobile
  description: string
}

const PANEL_META: Record<PanelId, PanelMeta> = {
  livevideo:    { component: <LiveFinanceVideoPanel />,    label: 'LIVE TV',       color: '#ff4560',        mobileH: 420, description: 'Bloomberg · CNBC · Yahoo · NDTV · ET Now' },
  news:         { component: <NewsFeedPanel />,            label: 'INTEL FEED',    color: 'var(--amber)',   mobileH: 480, description: 'AI-powered financial news feed' },
  watchlist:    { component: <WatchlistPanel />,           label: 'WATCHLIST',     color: 'var(--amber)',   mobileH: 400, description: 'Live prices + watchlist' },
  indices:      { component: <GlobalIndicesPanel />,       label: 'INDICES',       color: '#1e90ff',        mobileH: 520, description: 'US · India · Asia global indices' },
  mktclock:     { component: <MarketClockPanel />,         label: 'WORLD CLOCK',   color: '#00c97a',        mobileH: 460, description: 'Live global market hours' },
  chart:        { component: <ChartPanel />,               label: 'CHART',         color: 'var(--teal)',    mobileH: 480, description: 'Candlestick + FIB + Supertrend' },
  sentiment:    { component: <SentimentPanel />,           label: 'SENTIMENT',     color: 'var(--teal)',    mobileH: 360, description: 'Fear & Greed Index' },
  calendar:     { component: <EconomicCalendarPanel />,    label: 'ECON CALENDAR', color: '#ff4560',        mobileH: 380, description: 'FOMC · CPI · NFP · RBI' },
  earnings:     { component: <EarningsPanel />,            label: 'EARNINGS',      color: '#a78bfa',        mobileH: 440, description: 'US + India earnings calendar' },
  heatmap:      { component: <SectorHeatmapPanel />,       label: 'HEATMAP',       color: 'var(--teal)',    mobileH: 340, description: 'US sector performance' },
  indiamarkets: { component: <IndiaMarketsPanel />,        label: 'INDIA MKTS',    color: '#f97316',        mobileH: 500, description: 'NIFTY · SENSEX · FII/DII' },
  macrorates:   { component: <MacroRatesPanel />,          label: 'MACRO RATES',   color: 'var(--teal)',    mobileH: 520, description: 'FED · RBI live rates + World Bank' },
  altsignals:   { component: <AlternativeSignalsPanel />,  label: 'ALT SIGNALS',   color: '#a78bfa',        mobileH: 380, description: 'Lunar · Seasonality · DoW' },
  commodities: { component: <CommoditiesPanel/>,           label: 'COMMODITIES',   color: '#f97316',        mobileH: 380, description: 'Gold · Oil · Crypto signals' },
  insiderdeals: { component: <InsiderDealsPanel />,        label: 'INSIDER DEALS', color: '#f97316',         mobileH: 380, description: 'US & India insider transactions' },
  correlation:  { component: <SupplyChainPanel />,         label: 'SUPPLY CHAIN',  color: '#1e90ff',        mobileH: 500, description: 'Verified supplier/customer map (SEC + NSE filings)' },
  ipo:          { component: <IpoScreenerPanel />,         label: 'IPO',           color: '#1e90ff',    mobileH: 380, description: 'Upcoming and recent IPOs' },
  options:      { component: <OptionsPanel />,             label: 'OPTIONS',       color: '#a78bfa',    mobileH: 560, description: 'BSM pricing · IV · Greeks · Monte Carlo · OI' },
  fixedincome:    { component: <FixedIncomePanel />,         label: 'FIXED INCOME',   color: '#38bdf8',   mobileH: 560, description: 'India yield curve · credit spreads' },
  institutional:  { component: <InstitutionalHoldingsPanel />, label: '13F TRACKER',   color: '#1e90ff',   mobileH: 560, description: 'Institutional holdings · QoQ change' },
  altdata:        { component: <AlternativeDataPanel />,     label: 'ALT DATA',       color: '#a78bfa',   mobileH: 620, description: 'Wikipedia · Reddit · Google Trends' },
  secfilings:     { component: <SecFilingsPanel />,          label: 'SEC FILINGS',    color: '#f97316',   mobileH: 540, description: '8-K · S-1 · 13D with AI summaries' },
  // ── Forex / Crypto trading suite (shared TradingContext injected at render) ──
  'fx-risk':        { component: <RiskPanel />,              label: 'FX RISK CALC',   color: '#00ff88',   mobileH: 640, description: 'Position size · pip value · R:R · daily drawdown' },
  'fx-live':        { component: <LiveDashboard />,   label: 'FX LIVE',       color: '#00ff88', mobileH: 540, description: 'Live Forex & Crypto prices · Yahoo Finance · session clock' },
  'fx-calendar':    { component: <CalendarPanel />,  label: 'ECON CALENDAR', color: '#f0a500', mobileH: 520, description: 'Economic calendar · Finnhub + official schedule' },
  'fx-propfirm':    { component: <PropFirmPanel />,  label: 'PROP FIRM',     color: '#f0a500', mobileH: 560, description: 'Prop firm challenge tracker · drawdown limits' },
}

// ── DESKTOP default layout — v13 ─────────────────────────────────────────────
// Full layout redesign: priority tiers, content-fit heights, IPO offscreen bug fixed.
// Rows 1-3 locked per user instruction. Rows 4+ reorganized by live-data value.
// rowHeight=30 → h:1 = 30px rendered.
const LS_KEY = 'nexus-layout-v13'

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
  // Supply Chain (correlation): given 4 cols so the 3-col map layout fits.
  // Macro Rates: rich but scrollable; h:18 gives it room for FED schedule.
  { i: 'options',       x: 0,  y: 56, w: 5,  h: 18, minW: 4, minH: 14 },
  { i: 'correlation',   x: 5,  y: 56, w: 4,  h: 18, minW: 3, minH: 12 },
  { i: 'macrorates',    x: 9,  y: 56, w: 3,  h: 18, minW: 2, minH: 10 },

  // ══ ROW 6 (y:74→90) — Market structure ═══════════════════════════════════
  // Fixed Income yield curve needs h:16 (480px) to show curve + signals without cut.
  // IPO: bug fix — was at x:12 (offscreen). Now x:5 w:4 h:16.
  // Alt Signals: was truncating at h:12; h:16 gives each tab room to breathe.
  { i: 'fixedincome',   x: 0,  y: 74, w: 5,  h: 16, minW: 3, minH: 12 },
  { i: 'ipo',           x: 5,  y: 74, w: 4,  h: 16, minW: 3, minH: 10 },
  { i: 'altsignals',    x: 9,  y: 74, w: 3,  h: 16, minW: 2, minH: 10 },

  // ══ ROW 7 (y:90→106) — Smart money research ══════════════════════════════
  // 13F holdings + SEC filings: both are table/list UIs, h:16 is tight but workable.
  { i: 'institutional', x: 0,  y: 90, w: 6,  h: 16, minW: 4, minH: 12 },
  { i: 'secfilings',    x: 6,  y: 90, w: 6,  h: 16, minW: 4, minH: 12 },

  // ══ ROW 8 (y:106→124) — Alternative intelligence + FX live ════════════════
  // Alt Data needs h:18 (540px) for 3 data sources with charts.
  // FX Live: price table + session clock, h:18 gives it room for all pairs.
  { i: 'altdata',       x: 0,  y: 106, w: 7,  h: 18, minW: 4, minH: 14 },
  { i: 'fx-live',       x: 7,  y: 106, w: 5,  h: 18, minW: 4, minH: 12 },

  // ══ ROW 9 (y:124→140) — FX / Crypto trading suite ════════════════════════
  { i: 'fx-risk',       x: 0,  y: 124, w: 4,  h: 16, minW: 3, minH: 14 },
  { i: 'fx-calendar',   x: 4,  y: 124, w: 4,  h: 16, minW: 4, minH: 12 },
  { i: 'fx-propfirm',   x: 8,  y: 124, w: 4,  h: 16, minW: 4, minH: 14 },
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
  'correlation', 'ipo', 'institutional', 'secfilings',
  // Tier 6: Alternative + FX
  'fx-live', 'altdata', 'altsignals', 'mktclock',
  'fx-risk', 'fx-calendar', 'fx-propfirm', 'livevideo',
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

// ── Panel group definitions for visibility menu ────────────────────────────────

const PANEL_GROUPS: { label: string; ids: PanelId[] }[] = [
  { label: 'Live Feed',    ids: ['livevideo', 'news', 'watchlist']                                       },
  { label: 'Market Pulse', ids: ['chart', 'indices', 'mktclock', 'indiamarkets', 'heatmap', 'commodities'] },
  { label: 'Signals',      ids: ['earnings', 'calendar', 'insiderdeals', 'sentiment']                    },
  { label: 'Analytics',    ids: ['options', 'macrorates', 'fixedincome', 'correlation']                  },
  { label: 'Research',     ids: ['institutional', 'secfilings', 'altdata', 'ipo', 'altsignals']          },
  { label: 'FX / Crypto',  ids: ['fx-live', 'fx-risk', 'fx-calendar', 'fx-propfirm']                    },
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

// TradingProvider is hoisted here so all FX panels share one context instance
export default function GridLayout() {
  const [mounted,  setMounted]  = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [layout,   setLayout]   = useState<DashboardLayout>(() => loadLayout())
  const [saved,    setSaved]    = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [hidden,   setHidden]   = useState<Set<PanelId>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const stored = localStorage.getItem('nexus-hidden-panels')
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })

  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'
  const isTablet = bp === 'tablet'

  const originalLayoutRef     = useRef<DashboardLayout>(cloneLayout(DEFAULT_LAYOUT))
  const saveIndicatorTimerRef = useRef<number | null>(null)

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => setMounted(true))
    return () => {
      window.cancelAnimationFrame(frameId)
      if (saveIndicatorTimerRef.current !== null) window.clearTimeout(saveIndicatorTimerRef.current)
    }
  }, [])

  // Persist hidden panels
  useEffect(() => {
    try { localStorage.setItem('nexus-hidden-panels', JSON.stringify([...hidden])) } catch {}
  }, [hidden])

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

  // All layout variants are wrapped in TradingProvider so the FX panels share context
  const withTrading = (children: ReactNode) => (
    <TradingProvider>{children}</TradingProvider>
  )

  // ── MOBILE LAYOUT ────────────────────────────────────────────────────────────
  if (isMobile) {
    return withTrading(
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
          <span style={{
            fontSize:   '10px',
            color:      'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: '0.08em',
          }}>
            {MOBILE_ORDER.filter(id => !hidden.has(id)).length} PANELS
          </span>

          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowMenu(v => !v)}
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
    return withTrading(
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
              onClick={() => setShowMenu(v => !v)}
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

  return withTrading(
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

        {/* Panel visibility toggle */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowMenu(v => !v)}
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
        .react-grid-item { transition: none !important; }
        .react-grid-item.cssTransforms { transition-property: transform !important; transition-duration: 100ms !important; transition-timing-function: ease-out !important; }
        .react-grid-item.react-grid-placeholder { background: rgba(240,165,0,0.07) !important; border: 1px dashed rgba(240,165,0,0.4) !important; border-radius: 6px !important; opacity: 1 !important; z-index: 2 !important; }
        .react-resizable-handle { background: none !important; border-right: 2px solid rgba(240,165,0,0.7) !important; border-bottom: 2px solid rgba(240,165,0,0.7) !important; border-radius: 0 0 4px 0 !important; width: 14px !important; height: 14px !important; }
        .nexus-drag-handle { user-select: none; }
        @keyframes pulseDot { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>
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