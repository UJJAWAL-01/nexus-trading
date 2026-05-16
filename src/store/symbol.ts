import { create } from 'zustand'

interface SymbolStore {
  activeSymbol: string | null
  setActiveSymbol: (s: string | null) => void
}

export const useActiveSymbol = create<SymbolStore>((set) => ({
  activeSymbol: null,
  setActiveSymbol: (s) => set({ activeSymbol: s ? s.toUpperCase() : null }),
}))
