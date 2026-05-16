'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { Activity, Newspaper, Briefcase, Globe, BarChart2 } from 'lucide-react'
import { PANEL_META, type PanelId } from './panelRegistry'
import KeyboardShortcuts from './KeyboardShortcuts'
import AlertToasts       from './AlertToasts'
import AlertEngine       from './AlertEngine'

// ── Tab definition ─────────────────────────────────────────────────────────────
// Five tabs grouping panels by trader intent (not panel type).
// Every non-hero panel belongs to exactly one tab.

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
  { id: 'smartmoney', label: 'Smart Money', hint: 'What pros are doing',       icon: Briefcase, panels: ['smartmoney', 'insiderdeals', 'supplychain', 'secfilings', 'altdata'] },
  { id: 'india',      label: 'India',       hint: 'Nifty / Sensex / FII-DII',  icon: Globe,     panels: ['indiamarkets', 'fixedincome'] },
  { id: 'options',    label: 'Options',     hint: 'Derivatives + rates',       icon: BarChart2, panels: ['options', 'macrorates', 'altsignals'] },
]

const TAB_LS_KEY = 'nexus-active-tab'

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadActiveTab(): TabId {
  if (typeof window === 'undefined') return 'markets'
  try {
    const saved = localStorage.getItem(TAB_LS_KEY) as TabId | null
    return saved && TABS.some(t => t.id === saved) ? saved : 'markets'
  } catch { return 'markets' }
}

// ── Tab content ────────────────────────────────────────────────────────────────

function TabContent({ panels }: { panels: PanelId[] }) {
  return (
    <div
      style={{
        display:             'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
        gap:                 '10px',
        padding:             '10px 0 0',
      }}
    >
      {panels.map(panelId => {
        const meta = PANEL_META[panelId]
        return (
          <div
            key={panelId}
            style={{
              height:       460,
              display:      'flex',
              flexDirection:'column',
              overflow:     'hidden',
              borderRadius: 6,
              border:       '1px solid var(--border)',
              background:   'var(--bg-panel)',
            }}
          >
            <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
              {meta.component}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TabbedDashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('markets')
  const [mounted, setMounted] = useState(false)

  // Read persisted tab after mount (avoid SSR hydration mismatch)
  useEffect(() => {
    setActiveTab(loadActiveTab())
    setMounted(true)
  }, [])

  // Persist on change
  useEffect(() => {
    if (!mounted) return
    try { localStorage.setItem(TAB_LS_KEY, activeTab) } catch {}
  }, [activeTab, mounted])

  // Keyboard shortcuts: 1-5 to switch tabs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when user is typing in an input/textarea
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

  return (
    <div className="tabbed-root">
      {/* Global UX layer */}
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
      <div className="tabbed-tabbar">
        {TABS.map((t, i) => {
          const active = t.id === activeTab
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`tabbed-tab ${active ? 'active' : ''}`}
              title={`${t.hint}  ·  press ${i + 1}`}
            >
              <span className="tab-key">{i + 1}</span>
              <span className="tab-label">{t.label}</span>
            </button>
          )
        })}
        <span className="tabbed-hint">{tab.hint}</span>
      </div>

      {/* ─── ACTIVE TAB CONTENT ──────────────────────────────────────────── */}
      <TabContent panels={tab.panels} />

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

        .tabbed-tabbar {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 12px 0 0;
          border-bottom: 1px solid var(--border);
        }
        .tabbed-tab {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 9px 16px 11px;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: var(--text-muted);
          font-family: 'Syne', sans-serif;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: color 0.15s, border-color 0.15s;
          margin-bottom: -1px;
        }
        .tabbed-tab:hover {
          color: #fff;
        }
        .tabbed-tab.active {
          color: var(--amber);
          border-bottom-color: var(--amber);
        }
        .tab-key {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 3px;
          background: rgba(255,255,255,0.06);
          color: var(--text-muted);
          font-family: 'JetBrains Mono', monospace;
          font-size: 9px;
          font-weight: 700;
        }
        .tabbed-tab.active .tab-key {
          background: rgba(240,165,0,0.15);
          color: var(--amber);
        }
        .tabbed-hint {
          margin-left: auto;
          padding-right: 8px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 10px;
          color: var(--text-muted);
          letter-spacing: 0.08em;
        }

        /* ─── Bottom nav (mobile/tablet only) ─── */
        .tabbed-bottom-nav { display: none; }

        /* Mobile/tablet — stack hero vertically, swap top tabbar for bottom nav */
        @media (max-width: 899px) {
          .tabbed-root {
            padding-bottom: calc(64px + env(safe-area-inset-bottom, 0));
          }
          .tabbed-hero {
            grid-template-columns: 1fr;
            grid-template-rows: 440px 240px;
            height: auto;
            min-height: 0;
            max-height: none;
          }
          .tabbed-tabbar { display: none; }
          .tabbed-bottom-nav {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: var(--bg-panel);
            border-top: 1px solid var(--border);
            z-index: 1100;
            padding-bottom: env(safe-area-inset-bottom, 0);
            box-shadow: 0 -4px 16px rgba(0,0,0,0.6);
          }
          .bottom-tab {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 3px;
            padding: 7px 4px 8px;
            background: transparent;
            border: none;
            color: var(--text-muted);
            font-family: 'JetBrains Mono', monospace;
            font-size: 9px;
            font-weight: 600;
            letter-spacing: 0.04em;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            transition: color 0.15s;
            min-height: 54px;
          }
          .bottom-tab:active { background: rgba(255,255,255,0.04); }
          .bottom-tab.active { color: var(--amber); }
          .bottom-tab span { line-height: 1; }
        }
      `}</style>
    </div>
  )
}
