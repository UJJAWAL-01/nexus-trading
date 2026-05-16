import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type WorkspaceId = 'all' | 'trading' | 'news-macro' | 'global' | 'options' | 'custom'

export interface Workspace {
  id:          WorkspaceId
  label:       string
  description: string
  /** Panel IDs to *show*. `null` = show all (used by 'all' and 'custom'). */
  visible:     readonly string[] | null
}

export const WORKSPACES: readonly Workspace[] = [
  {
    id:          'all',
    label:       'All Panels',
    description: 'Full multi-panel terminal view',
    visible:     null,
  },
  // Each preset's `visible` order is curated so the auto-packer produces
  // 12-column rows with minimal stretching. Order = pack order.
  {
    id:          'trading',
    label:       'Trading Floor',
    description: 'Chart, watchlist, options, sentiment',
    visible:     [
      // Row 1: chart(7) · watchlist(2) · indices(2)            → 11 (+1)
      'chart', 'watchlist', 'indices',
      // Row 2: options(5) · heatmap(4) · sentiment(2)          → 11 (+1)
      'options', 'heatmap', 'sentiment',
      // Row 3: commodities(5) · indiamarkets(3) · earnings(3)  → 11 (+1)
      'commodities', 'indiamarkets', 'earnings',
    ],
  },
  {
    id:          'news-macro',
    label:       'News & Macro',
    description: 'News, calendar, rates, filings',
    visible:     [
      // Row 1: livevideo(5) · news(5) · sentiment(2)              → 12
      'livevideo', 'news', 'sentiment',
      // Row 2: calendar(3) · altsignals(3) · secfilings(6)        → 12
      'calendar', 'altsignals', 'secfilings',
      // Row 3: macrorates(3) · fixedincome(5) · insiderdeals(4)   → 12
      'macrorates', 'fixedincome', 'insiderdeals',
    ],
  },
  {
    id:          'global',
    label:       'Global Markets',
    description: 'World indices, smart money, commodities',
    visible:     [
      // Row 1: indices(2) · mktclock(3) · heatmap(4) · indiamarkets(3) → 12
      'indices', 'mktclock', 'heatmap', 'indiamarkets',
      // Row 2: commodities(5) · smartmoney(5) · sentiment(2)           → 12
      'commodities', 'smartmoney', 'sentiment',
      // Row 3: macrorates(3) · fixedincome(5) · insiderdeals(4)        → 12
      'macrorates', 'fixedincome', 'insiderdeals',
    ],
  },
  {
    id:          'options',
    label:       'Options Day',
    description: 'Greeks, IV, OI, flow',
    visible:     [
      // Row 1: chart(7) · watchlist(2) · sentiment(2)            → 11 (+1)
      'chart', 'watchlist', 'sentiment',
      // Row 2: options(5) · heatmap(4) · earnings(3)             → 12
      'options', 'heatmap', 'earnings',
      // Row 3: news(5) · calendar(3) · insiderdeals(4)           → 12
      'news', 'calendar', 'insiderdeals',
    ],
  },
  {
    id:          'custom',
    label:       'Custom',
    description: 'Your saved configuration',
    visible:     null,
  },
]

interface WorkspaceStore {
  active: WorkspaceId
  setActive: (id: WorkspaceId) => void
}

export const useWorkspace = create<WorkspaceStore>()(
  persist(
    (set) => ({
      active: 'all',
      setActive: (id) => set({ active: id }),
    }),
    { name: 'nexus-workspace' },
  ),
)
