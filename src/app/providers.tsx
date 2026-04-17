'use client'
// src/app/providers.tsx
// Global SWR provider. Every panel that fetches through the shared hooks in
// src/lib/data-hooks.ts goes through this config — so two panels requesting
// the same key fire a single network request, and re-mounts hit the cache.

import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'

const fetcher = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) {
    const err: any = new Error(`HTTP ${r.status}`)
    err.status = r.status
    throw err
  }
  return r.json()
}

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        // Any two panels requesting the same URL within 5 min share one request
        dedupingInterval:        5 * 60 * 1000,
        // Revalidate in the background every 15 min
        refreshInterval:        15 * 60 * 1000,
        // Don't refetch when the window regains focus — our data is minute-scale,
        // not second-scale, and this is the single biggest source of unwanted
        // invocations
        revalidateOnFocus:      false,
        // But do revalidate on reconnect — stale data after offline is worse
        revalidateOnReconnect:  true,
        // Keep previous data visible while revalidating (no flash of empty)
        keepPreviousData:       true,
        // Retry on 5xx with backoff, but don't hammer the server
        errorRetryCount:        2,
        errorRetryInterval:     4000,
        // Don't retry 404/429 — they won't magically succeed
        shouldRetryOnError: (err: any) =>
          err?.status !== 404 && err?.status !== 429,
      }}
    >
      {children}
    </SWRConfig>
  )
}