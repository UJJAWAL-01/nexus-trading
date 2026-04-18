// Simple sliding-window rate limiter — no external deps, serverless-safe (per-instance)
// For multi-instance deployments (Amplify with multiple containers) this only guards
// within a single instance. For cross-instance rate limiting use Upstash Rate Limit.

interface Window {
  count: number
  resetAt: number
}

const store = new Map<string, Window>()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetIn: number  // ms until window resets
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
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, resetIn: windowMs }
  }

  if (win.count >= limit) {
    return { allowed: false, remaining: 0, resetIn: win.resetAt - now }
  }

  win.count++
  return { allowed: true, remaining: limit - win.count, resetIn: win.resetAt - now }
}

// Periodically evict expired windows to avoid memory growth
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [k, w] of store) {
      if (w.resetAt <= now) store.delete(k)
    }
  }, 60_000)
}
