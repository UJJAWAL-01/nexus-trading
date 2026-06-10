// ─── Upstash Redis client (singleton) ─────────────────────────────────────────
//
// Two roles:
//   1. Hot quote cache  — TTL'd JSON-encoded snapshot of recent quote responses
//   2. Rate-limit token buckets for upstream APIs (OpenFIGI, SEC EDGAR, Yahoo)
//
// `@upstash/redis` is REST-based (no TCP) — works in Vercel Edge functions
// and is the canonical pairing with Upstash Redis.
//
// Falls back to a NO-OP implementation if env vars are missing so the app
// doesn't crash before the user has wired up Upstash.

import { Redis } from '@upstash/redis'

// Minimal contract — keep small so swapping providers later is easy
export interface RedisLike {
  get<T = unknown>(key: string): Promise<T | null>
  set(key: string, value: unknown, opts?: { ex?: number }): Promise<unknown>
  del(...keys: string[]): Promise<number>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<number>
}

function noopRedis(): RedisLike {
  // In-memory shim — keeps app working with `localhost` style caching when
  // UPSTASH_REDIS_REST_URL is not configured.  Per-process only; resets on
  // server restart.  Logs ONCE on first use so it's obvious in dev.
  let warned = false
  const warn = () => {
    if (warned) return
    warned = true
    console.warn('[redis] UPSTASH_REDIS_REST_URL not set — using in-memory shim (per-process only)')
  }
  const store = new Map<string, { v: unknown; exp: number | null }>()
  const isExpired = (e: number | null) => e !== null && Date.now() > e

  return {
    async get<T>(key: string) {
      warn()
      const r = store.get(key)
      if (!r) return null
      if (isExpired(r.exp)) { store.delete(key); return null }
      return r.v as T
    },
    async set(key, value, opts) {
      warn()
      store.set(key, { v: value, exp: opts?.ex ? Date.now() + opts.ex * 1000 : null })
      return 'OK'
    },
    async del(...keys) {
      warn()
      let n = 0
      for (const k of keys) if (store.delete(k)) n++
      return n
    },
    async incr(key) {
      warn()
      const r = store.get(key)
      const n = (typeof r?.v === 'number' ? r.v : 0) + 1
      store.set(key, { v: n, exp: r?.exp ?? null })
      return n
    },
    async expire(key, seconds) {
      warn()
      const r = store.get(key)
      if (!r) return 0
      store.set(key, { v: r.v, exp: Date.now() + seconds * 1000 })
      return 1
    },
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __nexusRedis: RedisLike | undefined
}

function createClient(): RedisLike {
  const url   = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return noopRedis()

  const r = new Redis({ url, token })
  return {
    get:    (k) => r.get(k) as Promise<unknown> as Promise<never>,
    set:    (k, v, o) => r.set(k, v, o?.ex ? { ex: o.ex } : undefined),
    del:    (...ks) => r.del(...ks),
    incr:   (k) => r.incr(k),
    expire: (k, s) => r.expire(k, s),
  }
}

if (!globalThis.__nexusRedis) globalThis.__nexusRedis = createClient()

export const redis: RedisLike = globalThis.__nexusRedis
