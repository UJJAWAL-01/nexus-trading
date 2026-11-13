// src/lib/providers/http.ts
// ─────────────────────────────────────────────────────────────────────────────
// Guarded outbound HTTP for every upstream data provider.
//
// Guarantees:
//   1. HTTPS only, and only to hosts on the allowlist below. A request can
//      never be steered to an arbitrary host by user input.
//   2. Every request has a timeout.
//   3. Errors never carry the request URL, headers or any secret. Anything
//      that might be logged or returned to a client goes through redact().
//
// This module is server-only. It must never be imported from a client
// component ('use client').
// ─────────────────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  throw new Error('providers/http is server-only and must not be bundled for the browser')
}

/**
 * Hosts NEXUS is allowed to call with credentials or on behalf of a user.
 *
 * ZERO-COST RULE: every host here must be either keyless or a free tier that
 * cannot bill (no payment method on file is required to use it). Pay-per-use
 * APIs (Anthropic, OpenAI, xAI, Google Gemini, paid market-data vendors) must
 * never be added. src/lib/__tests__/zero-cost.test.ts enforces this in CI.
 */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'finnhub.io',
  // Keyless public data
  'fred.stlouisfed.org',
  'api.nasdaq.com',
  'newsapi.org',
  'www.alphavantage.co',
  'api.groq.com',
  // SEC EDGAR — public, keyless
  'data.sec.gov',
  'www.sec.gov',
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
])

export function isAllowedHost(host: string): boolean {
  return ALLOWED_HOSTS.has(host.toLowerCase())
}

/** Error type that is safe to log and safe to map to a client response. */
export class UpstreamError extends Error {
  readonly provider: string
  readonly status:   number
  constructor(provider: string, status: number, reason: string) {
    super(`[${provider}] ${reason}`)
    this.name     = 'UpstreamError'
    this.provider = provider
    this.status   = status
  }
}

// ── Secret redaction ─────────────────────────────────────────────────────────

const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|DATABASE_URL)/i
const SECRET_PARAM    = /\b(api_?key|apikey|token|key|access_token|secret)=([^&\s"'<>]+)/gi

function secretValues(): string[] {
  const out: string[] = []
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 8) continue
    if (name.startsWith('NEXT_PUBLIC_')) continue
    if (SECRET_ENV_NAME.test(name)) out.push(value)
  }
  return out
}

/**
 * Strip anything secret-looking from a value before it is logged or returned.
 * Removes configured secret values verbatim and any key-like query parameter.
 */
export function redact(input: unknown): string {
  let text: string
  if (input instanceof Error)        text = `${input.name}: ${input.message}`
  else if (typeof input === 'string') text = input
  else {
    try { text = JSON.stringify(input) ?? String(input) } catch { text = String(input) }
  }
  for (const secret of secretValues()) {
    if (text.includes(secret)) text = text.split(secret).join('[redacted]')
  }
  return text.replace(SECRET_PARAM, '$1=[redacted]')
}

// ── Guarded fetch ────────────────────────────────────────────────────────────

export interface UpstreamInit extends Omit<RequestInit, 'signal'> {
  /** Label used in errors/logs, e.g. 'finnhub'. */
  provider:   string
  /** Hard timeout. Default 10s. */
  timeoutMs?: number
  /** Optional caller signal; combined with the timeout. */
  signal?:    AbortSignal
  /** Next.js Data Cache hints. */
  next?:      { revalidate?: number | false; tags?: string[] }
}

export async function upstreamFetch(url: URL, init: UpstreamInit): Promise<Response> {
  const { provider, timeoutMs = 10_000, signal, ...rest } = init

  if (url.protocol !== 'https:') {
    throw new UpstreamError(provider, 0, 'refused: non-HTTPS upstream')
  }
  if (!isAllowedHost(url.hostname)) {
    throw new UpstreamError(provider, 0, 'refused: host not on allowlist')
  }
  if (url.username || url.password) {
    throw new UpstreamError(provider, 0, 'refused: credentials in URL')
  }

  const timeout  = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  try {
    return await fetch(url, { ...rest, signal: combined } as RequestInit)
  } catch (err) {
    // Never rethrow the raw error: undici attaches the URL (and with it any
    // query-string key) to the error cause.
    const name = err instanceof Error ? err.name : 'Error'
    const reason = name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error'
    throw new UpstreamError(provider, 0, reason)
  }
}
