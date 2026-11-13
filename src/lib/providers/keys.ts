// src/lib/providers/keys.ts
// ─────────────────────────────────────────────────────────────────────────────
// The key vault. This is the ONLY module that attaches a provider API key to
// an outbound request. Routes call these helpers and never see a key value.
//
// Rules enforced here:
//   • Keys travel in request headers wherever the provider supports it
//     (Finnhub, NewsAPI, Groq). They then never appear in URLs, which is
//     where keys leak into logs, error messages and caches.
//   • Alpha Vantage only accepts the key as a query parameter. For
//     that one, the URL is built here and never leaves this module; failures are
//     reported through UpstreamError, which carries no URL.
//   • All user-influenced values are passed as URLSearchParams entries so they
//     are always encoded and can never inject extra parameters.
//   • Paths are validated, so input can never traverse to another endpoint.
//
// Server-only.
// ─────────────────────────────────────────────────────────────────────────────

import { upstreamFetch, UpstreamError, type UpstreamInit } from './http'

// Every provider here is a free tier that needs no payment method. Providers
// that can bill per use must not be added (see the zero-cost rule in http.ts).
export type Provider = 'finnhub' | 'newsapi' | 'alphavantage' | 'groq'

const ENV_NAME: Record<Provider, string> = {
  finnhub:      'FINNHUB_API_KEY',
  newsapi:      'NEWS_API_KEY',
  alphavantage: 'ALPHA_VANTAGE_KEY',
  groq:         'GROQ_API_KEY',
}

function keyFor(provider: Provider): string {
  const value = process.env[ENV_NAME[provider]]?.trim()
  if (!value) throw new UpstreamError(provider, 0, 'not configured')
  return value
}

/** Is a key configured for this provider? Never returns the key itself. */
export function hasKey(provider: Provider): boolean {
  return !!process.env[ENV_NAME[provider]]?.trim()
}

export type Params = Record<string, string | number | undefined | null>
export type CallInit = Omit<UpstreamInit, 'provider' | 'headers' | 'method' | 'body'>

function withParams(url: URL, params: Params): URL {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    url.searchParams.set(k, String(v))
  }
  return url
}

// Lowercase path segments only: no dots, no encoded characters, no traversal.
const SAFE_PATH = /^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\/[a-z0-9]+(?:[-_][a-z0-9]+)*)*$/

function safePath(provider: Provider, path: string): string {
  const clean = path.replace(/^\/+/, '')
  if (!SAFE_PATH.test(clean)) throw new UpstreamError(provider, 0, 'refused: invalid path')
  return clean
}

// ── Finnhub — key in X-Finnhub-Token header ──────────────────────────────────

export function finnhub(path: string, params: Params = {}, init: CallInit = {}): Promise<Response> {
  const url = withParams(new URL(`https://finnhub.io/api/v1/${safePath('finnhub', path)}`), params)
  // Defence in depth: a caller must never be able to smuggle a token param.
  url.searchParams.delete('token')
  return upstreamFetch(url, {
    timeoutMs: 8_000,
    ...init,
    provider: 'finnhub',
    headers:  { 'X-Finnhub-Token': keyFor('finnhub'), Accept: 'application/json' },
  })
}

/** Finnhub JSON with Next Data Cache. Returns null on any failure. */
export async function finnhubJSON<T = unknown>(
  path: string,
  params: Params = {},
  opts: { revalidate?: number; tags?: string[]; timeoutMs?: number } = {},
): Promise<T | null> {
  const { revalidate = 60, tags, timeoutMs = 8_000 } = opts
  try {
    const res = await finnhub(path, params, { timeoutMs, next: { revalidate, tags } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch { return null }
}

// ── NewsAPI — key in X-Api-Key header ────────────────────────────────────────

export function newsapi(path: string, params: Params = {}, init: CallInit = {}): Promise<Response> {
  const url = withParams(new URL(`https://newsapi.org/v2/${safePath('newsapi', path)}`), params)
  url.searchParams.delete('apiKey')
  return upstreamFetch(url, {
    timeoutMs: 8_000,
    ...init,
    provider: 'newsapi',
    headers:  { 'X-Api-Key': keyFor('newsapi'), Accept: 'application/json' },
  })
}

// ── Alpha Vantage — key only accepted as a query parameter ───────────────────

export function alphaVantage(params: Params = {}, init: CallInit = {}): Promise<Response> {
  const url = withParams(new URL('https://www.alphavantage.co/query'), params)
  url.searchParams.set('apikey', keyFor('alphavantage'))
  return upstreamFetch(url, { timeoutMs: 10_000, ...init, provider: 'alphavantage' })
}

// ── Groq — bearer token ──────────────────────────────────────────────────────

export function groq(body: unknown, init: CallInit = {}): Promise<Response> {
  return upstreamFetch(new URL('https://api.groq.com/openai/v1/chat/completions'), {
    timeoutMs: 15_000,
    ...init,
    provider: 'groq',
    method:   'POST',
    headers:  { Authorization: `Bearer ${keyFor('groq')}`, 'Content-Type': 'application/json' },
    body:     JSON.stringify(body),
  })
}
