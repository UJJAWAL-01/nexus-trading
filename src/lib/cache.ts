// src/lib/cache.ts
// Unified server-side cache layer.
//
// Why: on Vercel (and any serverless host), each request may hit a cold
// function instance. A module-level Map cache is useless — it's empty on every
// cold start. Next.js's Data Cache (shared across users + instances) is the
// only caching that actually works in production.
//
// Usage
//   const getDeals = cached(
//     async (market: string) => fetchDeals(market),
//     ['insider-deals'],           // key prefix
//     { revalidate: 900, tags: ['insider-deals'] }
//   )
//
//   // Wrap third-party fetches so their responses live in the Data Cache:
//   const json = await cachedFetch(url, { revalidate: 600, tags: ['nse'] })

import { unstable_cache } from 'next/cache'

export interface CachedFetchOpts extends RequestInit {
  revalidate?: number            // seconds; default 600
  tags?:        string[]         // for revalidateTag()
}

export function cached<T extends (...args: any[]) => Promise<any>>(
  fn:      T,
  keyPfx:  string[],
  opts:    { revalidate: number; tags?: string[] },
): T {
  return unstable_cache(fn, keyPfx, {
    revalidate: opts.revalidate,
    tags:       opts.tags,
  }) as T
}

/**
 * Fetch wrapper that places the response in Next.js's Data Cache. All users
 * hitting the same URL within `revalidate` seconds share one network round-trip.
 */
export async function cachedFetch(url: string, opts: CachedFetchOpts = {}): Promise<Response> {
  const { revalidate = 600, tags, ...init } = opts
  return fetch(url, {
    ...init,
    next: { revalidate, tags },
  })
}

/**
 * Same as cachedFetch but returns parsed JSON (or null on failure). Timeout is
 * enforced via AbortSignal. Errors are swallowed to null so callers can use
 * `?? []` patterns cleanly.
 */
export async function cachedJSON<T = unknown>(
  url:  string,
  opts: CachedFetchOpts & { timeoutMs?: number } = {},
): Promise<T | null> {
  const { timeoutMs = 10_000, ...rest } = opts
  try {
    const r = await cachedFetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return (await r.json()) as T
  } catch { return null }
}