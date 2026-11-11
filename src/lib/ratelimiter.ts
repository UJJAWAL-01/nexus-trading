// Fixed-window rate limiter — no external deps.
//
// State is per server process. On a single Node server (Docker / `next start`)
// that is a real limit. On serverless platforms each instance counts
// separately, so treat it as a per-instance guard there and set
// RATE_LIMIT_DISTRIBUTED=1 with Upstash configured for a cross-instance limit
// (see src/proxy.ts).

interface Window {
  count: number
  resetAt: number
}

const store = new Map<string, Window>()

// Hard cap on tracked keys so a flood of distinct keys cannot grow memory
// without bound.
const MAX_KEYS = 50_000

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetIn: number  // ms until window resets
}

function evict(now: number) {
  for (const [k, w] of store) {
    if (w.resetAt <= now) store.delete(k)
  }
  // Still over the cap: drop the oldest insertions.
  while (store.size >= MAX_KEYS) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/**
 * Check and consume one token for the given key.
 * @param key     Identifier (e.g. IP address or route name)
 * @param limit   Max requests per window
 * @param windowMs Window duration in milliseconds
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const win = store.get(key)

  if (!win || win.resetAt <= now) {
    if (!win && store.size >= MAX_KEYS) evict(now)
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, resetIn: windowMs }
  }

  if (win.count >= limit) {
    return { allowed: false, remaining: 0, resetIn: win.resetAt - now }
  }

  win.count++
  return { allowed: true, remaining: limit - win.count, resetIn: win.resetAt - now }
}

/** Test helper. */
export function _resetRateLimiter() { store.clear() }

// Periodically evict expired windows to avoid memory growth
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(() => evict(Date.now()), 60_000)
  // Do not keep the process (or a test runner) alive just for this timer.
  if (typeof timer === 'object' && timer && 'unref' in timer) (timer as { unref: () => void }).unref()
}
