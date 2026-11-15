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
  // Each preset lists panels in reading order; the grid packs them into
  // full-width rows, so no preset can leave a gap.
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
    description: 'News, earnings, rates, positioning, filings',
    visible:     [
      'livevideo', 'news', 'sentiment',
      'earnings', 'macrorates',
      'fixedincome', 'positioning',
      'secfilings', 'insiderdeals',
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
    description: 'Chain, volatility, strategy builder, positioning',
    visible:     [
      // Row 1: chart(7) · watchlist(2) · sentiment(2)            → 11 (+1)
      'chart', 'watchlist', 'sentiment',
      'options', 'heatmap', 'earnings',
      'volatility', 'strategy', 'positioning',
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
