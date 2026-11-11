// src/lib/providers/cache.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared server-side cache for upstream responses.
//
// Why this exists: routes used to keep their own unbounded module-level Maps
// keyed on raw user input. That grows without limit (a memory-exhaustion
// vector) and lets every cache miss fan out to the upstream provider.
//
// What this gives every route:
//   • Bounded size with least-recently-used eviction.
//   • Fresh TTL plus a longer "stale" window, so an upstream outage or a 429
//     serves the last good value instead of an error.
//   • In-flight de-duplication: N concurrent requests for the same key make
//     ONE upstream call. This is the main protection for provider quotas.
//   • Optional cross-instance tier through Upstash Redis when it is configured
//     (UPSTASH_REDIS_REST_URL / _TOKEN). Without it the cache is per-process.
// ─────────────────────────────────────────────────────────────────────────────

import { redis } from '@db/redis'

interface Entry<T> { value: T; freshUntil: number; staleUntil: number }

export interface CacheOptions {
  /** Namespace, also the Redis key prefix. */
  name:        string
  /** Max entries held in memory. Default 500. */
  max?:        number
  /** How long past freshness a value may still be served on failure. Default 10 min. */
  staleMs?:    number
  /** Mirror entries to Redis when configured. Default false (hot, tiny TTL data gains little). */
  distributed?: boolean
}

const redisConfigured = () =>
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN

const MAX_KEY_LENGTH = 200

export class SharedCache<T> {
  private readonly store    = new Map<string, Entry<T>>()
  private readonly inflight = new Map<string, Promise<T>>()
  private readonly name:        string
  private readonly max:         number
  private readonly staleMs:     number
  private readonly distributed: boolean

  constructor(opts: CacheOptions) {
    this.name        = opts.name
    this.max         = opts.max ?? 500
    this.staleMs     = opts.staleMs ?? 10 * 60_000
    this.distributed = !!opts.distributed
  }

  private touch(key: string, entry: Entry<T>) {
    this.store.delete(key)
    this.store.set(key, entry)
    while (this.store.size > this.max) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }

  /** Fresh value or undefined. */
  get(key: string): T | undefined {
    const e = this.store.get(key)
    if (!e) return undefined
    if (e.freshUntil > Date.now()) { this.touch(key, e); return e.value }
    if (e.staleUntil <= Date.now()) this.store.delete(key)
    return undefined
  }

  /** Last known value, even if no longer fresh (within the stale window). */
  getStale(key: string): T | undefined {
    const e = this.store.get(key)
    if (!e) return undefined
    if (e.staleUntil <= Date.now()) { this.store.delete(key); return undefined }
    return e.value
  }

  set(key: string, value: T, ttlMs: number): void {
    if (key.length > MAX_KEY_LENGTH) return
    const now = Date.now()
    this.touch(key, { value, freshUntil: now + ttlMs, staleUntil: now + ttlMs + this.staleMs })
    if (this.distributed && redisConfigured()) {
      const ex = Math.max(1, Math.ceil(ttlMs / 1000))
      void redis.set(`cache:${this.name}:${key}`, value, { ex }).catch(() => {})
    }
  }

  /**
   * Return a fresh cached value, or run `load` exactly once for all concurrent
   * callers. If `load` throws, the last known value is served when available.
   */
  async wrap(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.get(key)
    if (hit !== undefined) return hit

    const pending = this.inflight.get(key)
    if (pending) return pending

    const run = (async () => {
      if (this.distributed && redisConfigured()) {
        try {
          const remote = await redis.get<T>(`cache:${this.name}:${key}`)
          if (remote !== null && remote !== undefined) {
            const now = Date.now()
            this.touch(key, { value: remote, freshUntil: now + ttlMs, staleUntil: now + ttlMs + this.staleMs })
            return remote
          }
        } catch { /* fall through to the loader */ }
      }
      try {
        const value = await load()
        this.set(key, value, ttlMs)
        return value
      } catch (err) {
        const stale = this.getStale(key)
        if (stale !== undefined) return stale
        throw err
      }
    })()

    this.inflight.set(key, run)
    try { return await run } finally { this.inflight.delete(key) }
  }

  get size(): number { return this.store.size }
}

export function createCache<T>(opts: CacheOptions): SharedCache<T> {
  return new SharedCache<T>(opts)
}

/**
 * Drop-in replacement for a module-level `new Map()` cache: identical API,
 * but it can never hold more than `max` entries (oldest insertion is evicted).
 * Use this for any map keyed on request input.
 */
export class BoundedMap<K, V> extends Map<K, V> {
  private readonly max: number
  constructor(max = 1000) {
    super()
    this.max = max
  }
  set(key: K, value: V): this {
    if (!this.has(key)) {
      while (this.size >= this.max) {
        const oldest = this.keys().next().value
        if (oldest === undefined) break
        this.delete(oldest)
      }
    }
    return super.set(key, value)
  }
}
