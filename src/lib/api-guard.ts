// src/lib/api-guard.ts
// Request-level helpers shared by the global proxy and individual API routes.
// Pure functions over standard Request headers, so they are unit-testable.

/**
 * Best-effort client IP.
 *
 * X-Forwarded-For is a comma-separated chain; every hop APPENDS the address it
 * saw. The left-most entries are whatever the client chose to send, so they are
 * trivially spoofable and must not be used for rate limiting. We count
 * TRUSTED_PROXY_HOPS entries from the right (default 1: one load balancer /
 * CDN / reverse proxy in front of the app).
 *
 * If you expose the Node server directly to the internet with no proxy in
 * front, there is no trustworthy client address in the headers at all — put a
 * reverse proxy in front (see docs/SELF_HOSTING.md).
 */
export function clientIp(headers: Headers): string {
  const hops = Math.max(1, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10) || 1)

  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const chain = xff.split(',').map(s => s.trim()).filter(Boolean)
    if (chain.length) {
      const idx = Math.max(0, chain.length - hops)
      return normalizeIp(chain[idx])
    }
  }
  const real = headers.get('x-real-ip')
  if (real) return normalizeIp(real.trim())
  return 'unknown'
}

function normalizeIp(ip: string): string {
  // Bound the length so a hostile header cannot bloat the limiter's key space.
  return ip.slice(0, 64).toLowerCase()
}

/**
 * Should this request be refused as a cross-site call?
 *
 * The API exists to serve this app's own pages. Without this check any other
 * website could point its visitors' browsers at /api/* and spend this
 * deployment's provider quota. Browsers attach Sec-Fetch-Site / Origin and
 * page scripts cannot forge them, so this reliably stops browser-based abuse.
 * It does not (and cannot) stop non-browser clients; rate limiting covers those.
 */
export function isCrossSiteRequest(headers: Headers, requestHost: string, allowedOrigins: readonly string[]): boolean {
  const origin = headers.get('origin')
  const site   = headers.get('sec-fetch-site')
  const originAllowed = !!origin && allowedOrigins.includes(origin.replace(/\/+$/, ''))

  // Sec-Fetch-Site is set by the browser and cannot be forged by page script,
  // so it is the most reliable signal when present. Trusting 'same-origin'
  // also keeps the app working behind a reverse proxy that rewrites Host.
  if (site === 'same-origin' || site === 'none') return false
  if (site === 'cross-site') return !originAllowed

  // Older browsers / same-site: fall back to comparing Origin with our host.
  if (origin && origin !== 'null') {
    if (originAllowed) return false
    let originHost = ''
    try { originHost = new URL(origin).host } catch { return true }
    const hosts = [requestHost, headers.get('x-forwarded-host') ?? '']
      .flatMap(h => h.split(',')).map(h => h.trim().toLowerCase()).filter(Boolean)
    return !hosts.includes(originHost.toLowerCase())
  }

  // No browser signals at all: a non-browser client. Rate limiting covers it.
  return false
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean)
}

// ── Central query-parameter validation ───────────────────────────────────────

import { isValidSymbol } from './providers/symbols'

const SINGLE_SYMBOL_PARAMS = ['symbol', 'ticker'] as const
const SYMBOL_LIST_PARAMS: Record<string, number> = { symbols: 25, watchlist: 300 }
const MAX_FREE_TEXT = 600

/**
 * Returns the name of the first malformed well-known parameter, or null.
 * Empty values are allowed (routes apply their own defaults).
 */
export function invalidParam(params: URLSearchParams): string | null {
  for (const name of SINGLE_SYMBOL_PARAMS) {
    const v = params.get(name)?.trim()
    if (v && !isValidSymbol(v)) return name
  }
  for (const [name, max] of Object.entries(SYMBOL_LIST_PARAMS)) {
    const v = params.get(name)
    if (!v) continue
    const parts = v.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length > max) return name
    if (parts.some(p => !isValidSymbol(p))) return name
  }
  for (const [name, value] of params) {
    if (value.length > MAX_FREE_TEXT && !(name in SYMBOL_LIST_PARAMS)) return name
    if (/[\u0000-\u001f\u007f]/.test(value)) return name
  }
  return null
}
