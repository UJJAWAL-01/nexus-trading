// src/store/alerts.ts
// Lightweight in-browser alert queue. Any panel can push an alert; a global
// AlertToasts component renders them. Auto-dismiss + manual dismiss + dedup.

import { create } from 'zustand'

export type AlertLevel = 'info' | 'warn' | 'critical' | 'positive'

export interface Alert {
  id:         string         // dedup key — same id replaces existing
  title:      string
  body:       string
  level:      AlertLevel
  source:     string         // panel name (e.g. 'EARNINGS', 'SENTIMENT')
  symbol?:    string         // optional ticker for click-to-focus
  createdAt:  number
  ttlMs?:     number         // auto-dismiss after this many ms; undefined = sticky
}

interface AlertStore {
  alerts:        Alert[]
  push:          (a: Omit<Alert, 'createdAt'>) => void
  dismiss:       (id: string) => void
  dismissAll:    () => void
}

export const useAlerts = create<AlertStore>()((set) => ({
  alerts: [],
  push: (a) => set((state) => {
    const now = Date.now()
    // Dedup by id — if same id exists, replace with new (refreshes timestamp)
    const filtered = state.alerts.filter(x => x.id !== a.id)
    const next: Alert = { ...a, createdAt: now }
    return { alerts: [next, ...filtered].slice(0, 8) } // cap at 8 visible
  }),
  dismiss: (id) => set((state) => ({ alerts: state.alerts.filter(a => a.id !== id) })),
  dismissAll: () => set({ alerts: [] }),
}))
