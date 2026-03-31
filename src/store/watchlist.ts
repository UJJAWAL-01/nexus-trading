import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface WatchlistStore {
  symbols: string[]
  addSymbol: (s: string) => void
  removeSymbol: (s: string) => void
  reorder: (symbols: string[]) => void
}

export const useWatchlist = create<WatchlistStore>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'nexus-watchlist', // key in localStorage
    }
  )
)