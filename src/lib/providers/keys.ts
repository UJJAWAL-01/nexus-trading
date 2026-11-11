// src/lib/providers/keys.ts
// ─────────────────────────────────────────────────────────────────────────────
// The key vault. This is the ONLY module that attaches a provider API key to
// an outbound request. Routes call these helpers and never see a key value.
//
// Rules enforced here:
//   • Keys travel in request headers wherever the provider supports it
//     (Finnhub, NewsAPI, Google). They then never appear in URLs, which is
//     where keys leak into logs, error messages and caches.
//   • FRED and Alpha Vantage only accept the key as a query parameter. For
//     those, the URL is built here and never leaves this module; failures are
//     reported through UpstreamError, which carries no URL.
//   • All user-influenced values are passed as URLSearchParams entries so they
//     are always encoded and can never inject extra parameters.
//   • Paths are validated, so input can never traverse to another endpoint.
//
// Server-only.
// ─────────────────────────────────────────────────────────────────────────────

import { upstreamFetch, UpstreamError, type UpstreamInit } from './http'

export type Provider = 'finnhub' | 'fred' | 'newsapi' | 'alphavantage' | 'youtube' | 'gemini' | 'groq'

const ENV_NAME: Record<Provider, string> = {
  finnhub:      'FINNHUB_API_KEY',
  fred:         'FRED_API_KEY',
  newsapi:      'NEWS_API_KEY',
  alphavantage: 'ALPHA_VANTAGE_KEY',
  youtube:      'YOUTUBE_API_KEY',
  gemini:       'GEMINI_API_KEY',
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

// ── FRED — key only accepted as a query parameter ────────────────────────────

export function fred(path: string, params: Params = {}, init: CallInit = {}): Promise<Response> {
  const url = withParams(new URL(`https://api.stlouisfed.org/fred/${safePath('fred', path)}`), params)
  url.searchParams.set('file_type', 'json')
  url.searchParams.set('api_key', keyFor('fred'))
  return upstreamFetch(url, { timeoutMs: 8_000, ...init, provider: 'fred' })
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

// ── YouTube Data API — key in X-Goog-Api-Key header ──────────────────────────

export function youtube(path: string, params: Params = {}, init: CallInit = {}): Promise<Response> {
  const url = withParams(new URL(`https://www.googleapis.com/youtube/v3/${safePath('youtube', path)}`), params)
  url.searchParams.delete('key')
  return upstreamFetch(url, {
    timeoutMs: 6_000,
    ...init,
    provider: 'youtube',
    headers:  { 'X-Goog-Api-Key': keyFor('youtube'), Accept: 'application/json' },
  })
}

// ── Gemini — key in X-Goog-Api-Key header ────────────────────────────────────

const GEMINI_MODEL = /^gemini-[a-z0-9.-]+$/

export function gemini(model: string, body: unknown, init: CallInit = {}): Promise<Response> {
  if (!GEMINI_MODEL.test(model)) throw new UpstreamError('gemini', 0, 'refused: invalid model')
  const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`)
  return upstreamFetch(url, {
    timeoutMs: 20_000,
    ...init,
    provider: 'gemini',
    method:   'POST',
    headers:  { 'X-Goog-Api-Key': keyFor('gemini'), 'Content-Type': 'application/json' },
    body:     JSON.stringify(body),
  })
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

// ── xAI (Grok) — bearer token ────────────────────────────────────────────────

export function xai(body: unknown, init: CallInit = {}): Promise<Response> {
  const key = process.env.GROK_API_KEY?.trim()
  if (!key) throw new UpstreamError('xai', 0, 'not configured')
  return upstreamFetch(new URL('https://api.x.ai/v1/chat/completions'), {
    timeoutMs: 25_000,
    ...init,
    provider: 'xai',
    method:   'POST',
    headers:  { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body:     JSON.stringify(body),
  })
}

// ── Anthropic (Claude) — x-api-key header ────────────────────────────────────

export function anthropic(body: unknown, init: CallInit = {}): Promise<Response> {
  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) throw new UpstreamError('anthropic', 0, 'not configured')
  return upstreamFetch(new URL('https://api.anthropic.com/v1/messages'), {
    timeoutMs: 30_000,
    ...init,
    provider: 'anthropic',
    method:   'POST',
    headers:  { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body:     JSON.stringify(body),
  })
}

/** Which AI providers are configured. Never returns key values. */
export function hasAIKey(provider: 'xai' | 'anthropic'): boolean {
  return !!(provider === 'xai' ? process.env.GROK_API_KEY : process.env.ANTHROPIC_API_KEY)?.trim()
}
