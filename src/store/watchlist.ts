import { create } from 'zustand'

interface WatchlistStore {
  symbols: string[]
  addSymbol: (s: string) => void
  removeSymbol: (s: string) => void
  reorder: (symbols: string[]) => void
}

export const useWatchlist = create<WatchlistStore>((set) => ({
  symbols: ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'SPY', 'QQQ', 'AMZN', 'META'],
  addSymbol: (s) => set((state) => ({
    symbols: state.symbols.includes(s.toUpperCase())
      ? state.symbols
      : [...state.symbols, s.toUpperCase()]
  })),
  removeSymbol: (s) => set((state) => ({
    symbols: state.symbols.filter(x => x !== s.toUpperCase())
  })),
  reorder: (symbols) => set({ symbols }),
}))