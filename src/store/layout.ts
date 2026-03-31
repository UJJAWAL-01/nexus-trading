import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PresetName = 'balanced' | 'chart-focus' | 'news-focus' | 'research'

export interface LayoutPreset {
  name: PresetName
  label: string
  icon: string
  description: string
  rows: {
    columns: string        // CSS grid-template-columns
    height: string         // row height
    panels: string[]       // panel keys in order
  }[]
}

export const PRESETS: Record<PresetName, LayoutPreset> = {
  'balanced': {
    name: 'balanced', label: 'Balanced', icon: '⊞', description: 'Default — equal weight across chart, news, and signals',
    rows: [
      { columns: '1fr 220px 240px',        height: '460px', panels: ['chart', 'indices', 'watchlist'] },
      { columns: '1fr 260px 280px',        height: '360px', panels: ['news', 'sentiment', 'calendar'] },
      { columns: '1fr 320px',              height: '300px', panels: ['heatmap', 'altsignals'] },
    ],
  },
  'chart-focus': {
    name: 'chart-focus', label: 'Chart Focus', icon: '📈', description: 'Maximised chart — ideal for active day trading',
    rows: [
      { columns: '1fr 200px',              height: '580px', panels: ['chart', 'watchlist'] },
      { columns: '200px 1fr 240px 260px',  height: '320px', panels: ['indices', 'news', 'sentiment', 'calendar'] },
      { columns: '1fr 300px',              height: '260px', panels: ['heatmap', 'altsignals'] },
    ],
  },
  'news-focus': {
    name: 'news-focus', label: 'News Focus', icon: '📰', description: 'Larger news feed — ideal for macro & event-driven trading',
    rows: [
      { columns: '1fr 200px 220px',        height: '380px', panels: ['chart', 'indices', 'watchlist'] },
      { columns: '2fr 1fr',                height: '460px', panels: ['news', 'sentiment'] },
      { columns: '1fr 1fr 1fr',            height: '280px', panels: ['heatmap', 'calendar', 'altsignals'] },
    ],
  },
  'research': {
    name: 'research', label: 'Research', icon: '🔬', description: 'Signals-heavy — moon, seasonality, heatmap prominent',
    rows: [
      { columns: '1fr 220px 240px',        height: '400px', panels: ['chart', 'indices', 'watchlist'] },
      { columns: '1fr 1fr',                height: '360px', panels: ['heatmap', 'altsignals'] },
      { columns: '1fr 260px 240px',        height: '340px', panels: ['news', 'sentiment', 'calendar'] },
    ],
  },
}

interface LayoutStore {
  activePreset: PresetName
  setPreset: (p: PresetName) => void
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      activePreset: 'balanced',
      setPreset: (activePreset) => set({ activePreset }),
    }),
    { name: 'nexus-layout-v2' }
  )
)