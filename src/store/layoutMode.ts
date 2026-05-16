import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type LayoutMode = 'tabs' | 'classic'

interface LayoutModeStore {
  mode: LayoutMode
  setMode: (m: LayoutMode) => void
  toggle: () => void
}

// New users default to 'tabs' (focused, professional UI).
// Existing users keep whatever they had via persisted localStorage.
export const useLayoutMode = create<LayoutModeStore>()(
  persist(
    (set, get) => ({
      mode: 'tabs',
      setMode: (mode) => set({ mode }),
      toggle: () => set({ mode: get().mode === 'tabs' ? 'classic' : 'tabs' }),
    }),
    { name: 'nexus-layout-mode' },
  ),
)
