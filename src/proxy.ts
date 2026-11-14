// src/proxy.ts  (Next.js 16 "proxy" convention — formerly middleware)
// ─────────────────────────────────────────────────────────────────────────────
// One guard in front of every /api/* route.
//
// The API routes spend this deployment's provider keys (Finnhub, FRED,
// NewsAPI, AI providers…). Before a request reaches any of them it must pass:
//
//   1. Method allowlist            → 405
//   2. URL size limit              → 414
//   3. Cross-site browser block    → 403  (other websites cannot use this API)
//   4. Per-IP rate limit, by tier  → 429
//
// Individual routes still validate their own parameters and the expensive AI
// routes keep their own tighter limits on top of this.
// ─────────────────────────────────────────────────────────────────────────────

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { rateLimit } from '@/lib/ratelimiter'
import { clientIp, invalidParam, isCrossSiteRequest, parseAllowedOrigins } from '@/lib/api-guard'
import { redis } from '@db/redis'

const WINDOW_MS = 60_000

function envInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Requests per minute, per IP. Generous enough for a full dashboard polling
// every panel; far below what would drain a free-tier provider quota.
const LIMIT_DEFAULT = envInt('RATE_LIMIT_PER_MIN', 600)
const LIMIT_HEAVY   = envInt('RATE_LIMIT_HEAVY_PER_MIN', 120)

// Routes that fan out to many upstream calls or hit scarce quotas.
const HEAVY_ROUTES = new Set([
  'options', 'fixed-income', 'smart-money', 'sec-filings',
  'insider-deals', 'fundamentals', 'news-feed', 'news', 'search',
  'pattern-scan', 'chart-analysis', 'ai-context',
  'earnings', 'ipo-data', 'macro-rates', 'economic-calender', 'stream', 'short-volume', 'vol-surface',
])

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'OPTIONS'])
const MAX_URL_LENGTH  = 4096

const allowedOrigins = parseAllowedOrigins(process.env.NEXUS_ALLOWED_ORIGINS)

const distributed = () =>
  process.env.RATE_LIMIT_DISTRIBUTED === '1' &&
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN

function deny(status: number, error: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error }, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  })
}

async function consume(key: string, limit: number): Promise<{ allowed: boolean; retryAfterS: number }> {
  if (distributed()) {
    try {
      const bucket = Math.floor(Date.now() / WINDOW_MS)
      const rkey   = `rl:${key}:${bucket}`
      const count  = await redis.incr(rkey)
      if (count === 1) await redis.expire(rkey, 120)
      const retryAfterS = Math.ceil((WINDOW_MS - (Date.now() % WINDOW_MS)) / 1000)
      return { allowed: count <= limit, retryAfterS }
    } catch {
      // Redis unavailable: fall back to the local limiter rather than failing open.
    }
  }
  const r = rateLimit(key, limit, WINDOW_MS)
  return { allowed: r.allowed, retryAfterS: Math.max(1, Math.ceil(r.resetIn / 1000)) }
}

export async function proxy(request: NextRequest) {
  return guard(request)
}

async function guard(request: NextRequest) {
  if (!ALLOWED_METHODS.has(request.method)) {
    return deny(405, 'Method not allowed', { Allow: 'GET, HEAD, POST, OPTIONS' })
  }

  const { pathname, search } = request.nextUrl
  if (pathname.length + search.length > MAX_URL_LENGTH) {
    return deny(414, 'Request URL too long')
  }

  const host = request.headers.get('host') ?? request.nextUrl.host
  if (isCrossSiteRequest(request.headers, host, allowedOrigins)) {
    return deny(403, 'Cross-site requests are not allowed')
  }

  // CORS preflight from an allowed origin never reaches a provider.
  if (request.method === 'OPTIONS') return new NextResponse(null, { status: 204 })

  // Central parameter hygiene: these names mean the same thing on every route
  // and end up in upstream requests and cache keys, so reject malformed values
  // here once instead of trusting each route to remember.
  const invalid = invalidParam(request.nextUrl.searchParams)
  if (invalid) return deny(400, `Invalid parameter: ${invalid}`)

  const route = pathname.split('/')[2] ?? ''
  const heavy = HEAVY_ROUTES.has(route)
  const ip    = clientIp(request.headers)

  const overall = await consume(`all:${ip}`, LIMIT_DEFAULT)
  if (!overall.allowed) {
    return deny(429, 'Rate limit exceeded', { 'Retry-After': String(overall.retryAfterS) })
  }
  if (heavy) {
    const tier = await consume(`heavy:${route}:${ip}`, LIMIT_HEAVY)
    if (!tier.allowed) {
      return deny(429, 'Rate limit exceeded', { 'Retry-After': String(tier.retryAfterS) })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
