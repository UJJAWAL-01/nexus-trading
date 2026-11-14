// src/store/priceAlerts.ts
// User-defined price alerts, stored in this browser only (localStorage).
// Nothing is sent to a server: the rules never leave the device.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  MAX_HISTORY, MAX_RULES, MAX_SYMBOLS, sanitizeRule,
  type FiredAlert, type PriceAlertRule, type RuleInput,
} from '@/lib/price-alerts'

export type AddResult = 'ok' | 'invalid' | 'full' | 'too-many-symbols' | 'duplicate'

interface PriceAlertStore {
  rules:   PriceAlertRule[]
  history: FiredAlert[]
  add:     (input: RuleInput) => AddResult
  remove:  (id: string) => void
  rearm:   (id: string) => void
  /** Engine callback: store evaluated rules and append what fired. */
  commit:  (rules: readonly PriceAlertRule[], fired: readonly FiredAlert[]) => void
  clearHistory: () => void
}

// Live quotes for alert symbols, published by PriceAlertEngine so the panel can
// show them without opening a second stream. Not persisted.
export interface AlertLiveQuote { price: number | null; change: number | null }
export const useAlertQuotes = create<{ quotes: Record<string, AlertLiveQuote>; status: string }>()(() => ({ quotes: {}, status: 'idle' }))

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export const usePriceAlerts = create<PriceAlertStore>()(
  persist(
    (set, get) => ({
      rules: [],
      history: [],
      add: (input) => {
        const clean = sanitizeRule(input)
        if (!clean) return 'invalid'
        const { rules } = get()
        if (rules.length >= MAX_RULES) return 'full'
        if (rules.some(r => r.symbol === clean.symbol && r.kind === clean.kind && r.value === clean.value)) return 'duplicate'
        const symbols = new Set(rules.map(r => r.symbol))
        if (!symbols.has(clean.symbol) && symbols.size >= MAX_SYMBOLS) return 'too-many-symbols'
        const rule: PriceAlertRule = { ...clean, id: newId(), armed: true, createdAt: Date.now(), firedAt: null, firedPrice: null }
        set({ rules: [rule, ...rules] })
        return 'ok'
      },
      remove: (id) => set(s => ({ rules: s.rules.filter(r => r.id !== id) })),
      rearm:  (id) => set(s => ({ rules: s.rules.map(r => (r.id === id ? { ...r, armed: true } : r)) })),
      commit: (rules, fired) => set(s => ({
        rules:   [...rules],
        history: fired.length ? [...fired].reverse().concat(s.history).slice(0, MAX_HISTORY) : s.history,
      })),
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: 'nexus-price-alerts',
      version: 1,
      // Never trust what is in storage: re-validate every rule on load.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PriceAlertStore>
        const rules: PriceAlertRule[] = []
        for (const r of Array.isArray(p.rules) ? p.rules.slice(0, MAX_RULES) : []) {
          const clean = r && typeof r === 'object' ? sanitizeRule(r) : null
          if (!clean || typeof r.id !== 'string') continue
          rules.push({
            ...clean, id: r.id.slice(0, 40), armed: r.armed !== false,
            createdAt:  typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
            firedAt:    typeof r.firedAt === 'number' ? r.firedAt : null,
            firedPrice: typeof r.firedPrice === 'number' ? r.firedPrice : null,
          })
        }
        const history = (Array.isArray(p.history) ? p.history : [])
          .filter((h): h is FiredAlert => !!h && typeof h === 'object' && typeof h.symbol === 'string' && typeof h.at === 'number' && sanitizeRule(h) !== null)
          .slice(0, MAX_HISTORY)
          .map(h => ({ ...h, note: typeof h.note === 'string' ? h.note.slice(0, 80) : '', price: typeof h.price === 'number' ? h.price : 0, change: typeof h.change === 'number' ? h.change : null }))
        return { ...current, rules, history }
      },
    },
  ),
)
