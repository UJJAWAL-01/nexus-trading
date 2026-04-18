'use client'

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Position {
  id: string
  pair: string
  direction: 'long' | 'short'
  size: number
  entryPrice: number
  currentPrice: number
  unrealizedPnL: number
}

export interface TradeEntry {
  id: string
  pair: string
  direction: 'long' | 'short'
  entryPrice: number
  exitPrice: number
  stopLoss: number
  takeProfit: number
  dateTime: string
  setupTags: string[]
  wasPlanned: boolean
  whyNotPlanned: string
  emotion: string
  notes: string
  screenshotUrl: string
  // auto-calculated on save
  outcome: 'win' | 'loss' | 'breakeven'
  rr: number
  pips: number
  pnl: number
}

export interface UserSettings {
  defaultRisk: number
  defaultBalance: number
  preferredCurrency: string
}

export interface PropFirmSettings {
  firmName: string
  accountSize: number
  dailyLossLimitPct: number
  maxDrawdownPct: number
  profitTargetPct: number
  phase: 'Phase 1' | 'Phase 2' | 'Funded'
  challengeStartDate: string
  currentDrawdown: number
  currentProfit: number
  dailyLoss: number
}

interface TradingContextType {
  accountBalance: number
  setAccountBalance: (v: number) => void
  openPositions: Position[]
  setOpenPositions: (p: Position[]) => void
  tradeHistory: TradeEntry[]
  addTrade: (t: Omit<TradeEntry, 'id'>) => void
  deleteTrade: (id: string) => void
  settings: UserSettings
  updateSettings: (s: Partial<UserSettings>) => void
  propFirm: PropFirmSettings
  updatePropFirm: (s: Partial<PropFirmSettings>) => void
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: UserSettings = {
  defaultRisk: 1,
  defaultBalance: 10000,
  preferredCurrency: 'USD',
}

const DEFAULT_PROP_FIRM: PropFirmSettings = {
  firmName: 'FTMO',
  accountSize: 100000,
  dailyLossLimitPct: 5,
  maxDrawdownPct: 10,
  profitTargetPct: 10,
  phase: 'Phase 1',
  challengeStartDate: new Date().toISOString().split('T')[0],
  currentDrawdown: 0,
  currentProfit: 0,
  dailyLoss: 0,
}


// ── Context ───────────────────────────────────────────────────────────────────

const TradingContext = createContext<TradingContextType | null>(null)

export function TradingProvider({ children }: { children: ReactNode }) {
  const [accountBalance, setAccountBalance] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS.defaultBalance
    return Number(localStorage.getItem('trading_balance') ?? DEFAULT_SETTINGS.defaultBalance)
  })

  const [openPositions, setOpenPositions] = useState<Position[]>([])

  const [tradeHistory, setTradeHistory] = useState<TradeEntry[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      return JSON.parse(localStorage.getItem('trading_journal') ?? '[]')
    } catch { return [] }
  })

  const [settings, setSettings] = useState<UserSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_SETTINGS
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('trading_settings') ?? '{}') }
    } catch { return DEFAULT_SETTINGS }
  })

  const [propFirm, setPropFirm] = useState<PropFirmSettings>(() => {
    if (typeof window === 'undefined') return DEFAULT_PROP_FIRM
    try {
      return { ...DEFAULT_PROP_FIRM, ...JSON.parse(localStorage.getItem('trading_propfirm') ?? '{}') }
    } catch { return DEFAULT_PROP_FIRM }
  })

  // Persist to localStorage
  useEffect(() => { try { localStorage.setItem('trading_balance', String(accountBalance)) } catch {} }, [accountBalance])
  useEffect(() => { try { localStorage.setItem('trading_journal', JSON.stringify(tradeHistory)) } catch {} }, [tradeHistory])
  useEffect(() => { try { localStorage.setItem('trading_settings', JSON.stringify(settings)) } catch {} }, [settings])
  useEffect(() => { try { localStorage.setItem('trading_propfirm', JSON.stringify(propFirm)) } catch {} }, [propFirm])

  const addTrade = useCallback((t: Omit<TradeEntry, 'id'>) => {
    setTradeHistory(prev => [{ ...t, id: `t_${Date.now()}` }, ...prev])
  }, [])

  const deleteTrade = useCallback((id: string) => {
    setTradeHistory(prev => prev.filter(t => t.id !== id))
  }, [])

  const updateSettings = useCallback((s: Partial<UserSettings>) => {
    setSettings(prev => ({ ...prev, ...s }))
  }, [])

  const updatePropFirm = useCallback((s: Partial<PropFirmSettings>) => {
    setPropFirm(prev => ({ ...prev, ...s }))
  }, [])

  return (
    <TradingContext.Provider value={{
      accountBalance, setAccountBalance,
      openPositions, setOpenPositions,
      tradeHistory, addTrade, deleteTrade,
      settings, updateSettings,
      propFirm, updatePropFirm,
    }}>
      {children}
    </TradingContext.Provider>
  )
}

export function useTradingContext(): TradingContextType {
  const ctx = useContext(TradingContext)
  if (!ctx) throw new Error('useTradingContext must be used inside TradingProvider')
  return ctx
}
