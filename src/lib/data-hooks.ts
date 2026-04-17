// src/lib/data-hooks.ts
// Shared SWR hooks: the canonical way for panels to fetch data.
//
// Why this exists:
//   Before — every panel called fetch() inline. If two panels both needed
//   global indices, that was two network requests, two function invocations,
//   two serverless billable ms. For 500-1000 concurrent users across 19
//   panels, costs multiply fast.
//
//   Now — every panel that shares data (indices, macro rates, news,
//   insider deals, etc.) goes through a hook below. SWR dedupes by URL key,
//   so two panels using useInsiderDeals('ALL') at once = one request.
//   Paired with Next.js Data Cache on the server (revalidate: N), external
//   API calls are shared across all users too.
//
// Adding a panel:
//   1. Pick a TTL that matches how fast the data actually changes.
//   2. Export a typed hook here.
//   3. In your panel: `const { data, error, isLoading } = useXxx(params)`.
//
// Don't call fetch() inline in a panel unless the data is panel-specific
// (e.g. user search input). Shared feeds MUST go through a hook.

import useSWR from 'swr'
import type { SWRConfiguration } from 'swr'
import type { InsiderDeal, InsiderResponse } from '@/app/api/insider-deals/route'
import type { EarningItem } from '@/app/api/earnings/route'
import type { CalEvent } from '@/app/api/economic-calender/route'

// ── TTL tiers ────────────────────────────────────────────────────────────────
// These drive both client-side dedupe (via refreshInterval) and should mirror
// the `revalidate` value on the corresponding server route. Keep them in sync.
export const TTL = {
  FAST:   60_000,        // 1 min  — intraday quotes, live indices
  MEDIUM: 5 * 60_000,    // 5 min  — news feed, sentiment
  SLOW:   15 * 60_000,   // 15 min — insider/block deals, earnings
  HOURLY: 60 * 60_000,   // 1 h    — IPO calendar, fixed income
  DAILY:  6 * 60 * 60_000, // 6 h  — fundamentals, world bank macros
} as const

function useSharedSWR<T>(key: string | null, cfg: SWRConfiguration = {}) {
  return useSWR<T>(key, cfg)
}

// ── Insider Deals ────────────────────────────────────────────────────────────
export function useInsiderDeals(market: 'ALL' | 'US' | 'IN' = 'ALL') {
  return useSharedSWR<InsiderResponse>(
    `/api/insider-deals?market=${market}`,
    { refreshInterval: TTL.SLOW, dedupingInterval: TTL.SLOW / 3 },
  )
}

export type { InsiderDeal, InsiderResponse }

// ── Global Indices ───────────────────────────────────────────────────────────
interface QuoteData {
  symbol: string; label: string; flag: string
  price: number | null; change: number | null; digits: number
}
export function useGlobalIndices() {
  return useSharedSWR<{ quotes: QuoteData[]; lastUpdated: string }>(
    '/api/global-indices',
    { refreshInterval: TTL.FAST, dedupingInterval: 20_000 },
  )
}

// ── News Feed ────────────────────────────────────────────────────────────────
export function useNewsFeed(category = 'relevant', watchlist?: string) {
  const params = new URLSearchParams({ cat: category })
  if (watchlist) params.set('watchlist', watchlist)
  return useSharedSWR<{ items: unknown[]; fetchedAt: string }>(
    `/api/news-feed?${params}`,
    { refreshInterval: TTL.MEDIUM, dedupingInterval: 2 * 60_000 },
  )
}

// ── Earnings ─────────────────────────────────────────────────────────────────
export function useEarnings(market: 'US' | 'IN' = 'US') {
  return useSharedSWR<EarningItem[]>(
    `/api/earnings?market=${market}`,
    { refreshInterval: TTL.HOURLY, dedupingInterval: TTL.SLOW },
  )
}
export type { EarningItem }

// ── Economic Calendar ────────────────────────────────────────────────────────
export function useEconomicCalendar() {
  return useSharedSWR<{ events: CalEvent[]; total: number; fetchedAt: string; source: string }>(
    '/api/economic-calender',
    { refreshInterval: TTL.SLOW, dedupingInterval: TTL.SLOW / 3 },
  )
}
export type { CalEvent }