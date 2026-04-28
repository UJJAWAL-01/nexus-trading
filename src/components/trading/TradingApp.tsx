'use client'

import { useState } from 'react'
import {
  ShieldCheck, Activity,
  Calendar, Grid3X3, Trophy, Settings, DollarSign, X,
} from 'lucide-react'
import { TradingProvider, useTradingContext } from './TradingContext'
import { RiskPanel } from '@/components/panels/RiskPanel'
import { LiveDashboard } from '@/components/panels/LiveDashboard'
import { CalendarPanel } from '@/components/panels/CalendarPanel'
import { ForexCorrelationPanel } from '@/components/panels/ForexCorrelationPanel'
import { PropFirmPanel } from '@/components/panels/PropFirmPanel'

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelId = 'risk' | 'live' | 'calendar' | 'correlation' | 'propfirm'

interface NavItem {
  id: PanelId
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { id: 'risk',        label: 'Risk Calculator',    icon: <ShieldCheck size={18} /> },
  { id: 'live',        label: 'Live Dashboard',     icon: <Activity size={18} /> },
  { id: 'calendar',    label: 'Econ Calendar',      icon: <Calendar size={18} /> },
  { id: 'correlation', label: 'Correlation Matrix', icon: <Grid3X3 size={18} /> },
  { id: 'propfirm',    label: 'Prop Firm Mode',     icon: <Trophy size={18} /> },
]

// ── Settings Modal ────────────────────────────────────────────────────────────

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useTradingContext()
  const [risk, setRisk] = useState(String(settings.defaultRisk))
  const [bal, setBal]   = useState(String(settings.defaultBalance))
  const [cur, setCur]   = useState(settings.preferredCurrency)

  const save = () => {
    updateSettings({ defaultRisk: Number(risk), defaultBalance: Number(bal), preferredCurrency: cur })
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-xl p-6 w-80 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-white tracking-wide">Settings</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs text-gray-400 mb-1 block">Default Risk %</span>
            <input type="number" value={risk} min="0.1" max="10" step="0.1"
              onChange={e => setRisk(e.target.value)}
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00ff88]" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400 mb-1 block">Default Balance ($)</span>
            <input type="number" value={bal} min="100"
              onChange={e => setBal(e.target.value)}
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00ff88]" />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400 mb-1 block">Preferred Currency</span>
            <select value={cur} onChange={e => setCur(e.target.value)}
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00ff88]">
              {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <button onClick={save}
          className="w-full mt-5 bg-[#00ff88] text-black text-sm font-bold py-2 rounded-lg hover:bg-[#00e07a] transition-colors">
          Save Settings
        </button>
      </div>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar({
  active, onSelect, onSettings,
}: {
  active: PanelId
  onSelect: (id: PanelId) => void
  onSettings: () => void
}) {
  const { accountBalance, setAccountBalance } = useTradingContext()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState(String(accountBalance))

  const commitBalance = () => {
    const v = Number(draft)
    if (!isNaN(v) && v > 0) setAccountBalance(v)
    setEditing(false)
  }

  return (
    <aside className="hidden md:flex flex-col w-[220px] min-h-screen bg-[#0f1117] border-r border-[#1e2130] fixed left-0 top-0 z-40">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-[#1e2130]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-[#00ff88] flex items-center justify-center">
            <Activity size={14} className="text-black" />
          </div>
          <span className="text-white font-bold text-sm tracking-widest">NEXUS FX</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(item => (
          <button key={item.id}
            onClick={() => onSelect(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-xs transition-all ${
              active === item.id
                ? 'bg-[#00ff88]/10 text-[#00ff88] border-l-2 border-[#00ff88] pl-[10px]'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}>
            {item.icon}
            <span className="font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Bottom: balance + settings */}
      <div className="px-3 py-4 border-t border-[#1e2130] space-y-3">
        <div className="bg-[#1a1d27] rounded-lg p-3">
          <div className="flex items-center gap-1 text-gray-500 text-[10px] mb-1">
            <DollarSign size={10} /> ACCOUNT BALANCE
          </div>
          {editing ? (
            <input autoFocus type="number" value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitBalance}
              onKeyDown={e => { if (e.key === 'Enter') commitBalance() }}
              className="w-full bg-transparent text-[#00ff88] text-sm font-bold focus:outline-none" />
          ) : (
            <div onClick={() => { setDraft(String(accountBalance)); setEditing(true) }}
              className="text-[#00ff88] text-sm font-bold cursor-pointer hover:opacity-80">
              ${accountBalance.toLocaleString()}
            </div>
          )}
        </div>
        <button onClick={onSettings}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 text-xs transition-all">
          <Settings size={14} /> Settings
        </button>
      </div>
    </aside>
  )
}

// ── Mobile Tab Bar ────────────────────────────────────────────────────────────

function MobileTabBar({ active, onSelect }: { active: PanelId; onSelect: (id: PanelId) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#0f1117] border-t border-[#1e2130] flex overflow-x-auto">
      {NAV_ITEMS.map(item => (
        <button key={item.id}
          onClick={() => onSelect(item.id)}
          className={`flex flex-col items-center gap-1 flex-1 min-w-[56px] py-2 px-1 text-[9px] transition-colors ${
            active === item.id ? 'text-[#00ff88]' : 'text-gray-500'
          }`}>
          {item.icon}
          <span className="truncate w-full text-center">{item.label.split(' ')[0]}</span>
        </button>
      ))}
    </nav>
  )
}

// ── Panel Renderer ────────────────────────────────────────────────────────────

function PanelView({ active }: { active: PanelId }) {
  switch (active) {
    case 'risk':        return <RiskPanel />
    case 'live':        return <LiveDashboard />
    case 'calendar':    return <CalendarPanel />
    case 'correlation': return <ForexCorrelationPanel />
    case 'propfirm':    return <PropFirmPanel />
  }
}

// ── Inner App (needs context) ─────────────────────────────────────────────────

function InnerApp() {
  const [active, setActive]       = useState<PanelId>('live')
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="min-h-screen bg-[#0f1117]">
      <Sidebar active={active} onSelect={setActive} onSettings={() => setShowSettings(true)} />
      <MobileTabBar active={active} onSelect={setActive} />

      {/* Main content */}
      <main className="md:ml-[220px] pb-16 md:pb-0 min-h-screen">
        <PanelView active={active} />
      </main>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function TradingApp() {
  return (
    <TradingProvider>
      <InnerApp />
    </TradingProvider>
  )
}
