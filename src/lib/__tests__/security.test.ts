import { describe, it, expect, beforeEach } from 'vitest'
import { clientIp, invalidParam, isCrossSiteRequest, parseAllowedOrigins } from '@/lib/api-guard'
import { cleanQuery, cleanSymbol, cleanSymbolList, isValidSymbol } from '@/lib/providers/symbols'
import { redact, upstreamFetch, UpstreamError, isAllowedHost } from '@/lib/providers/http'
import { BoundedMap, createCache } from '@/lib/providers/cache'
import { rateLimit, _resetRateLimiter } from '@/lib/ratelimiter'
import { finnhub, fred, hasKey } from '@/lib/providers/keys'

const h = (o: Record<string, string>) => new Headers(o)

describe('symbol validation', () => {
  it('accepts every symbol style the app uses', () => {
    for (const s of ['AAPL', 'BRK-B', 'BRK.B', 'RELIANCE.NS', 'M&M.NS', 'BAJAJ-AUTO.NS', '^NSEI', 'EURUSD=X', 'CL=F', 'BTC-USD', 'BINANCE:BTCUSDT', 'OANDA:EUR_USD']) {
      expect(isValidSymbol(s), s).toBe(true)
    }
  })
  it('rejects injection and traversal attempts', () => {
    for (const s of ['', 'AAPL?x=1', 'AAPL/../../x', '../v1/secret', 'A B', 'AAPL#', 'AAPL%00', '<script>', 'A'.repeat(40)]) {
      expect(cleanSymbol(s), s).toBeNull()
    }
  })
  it('caps and de-duplicates symbol lists', () => {
    expect(cleanSymbolList('AAPL, MSFT,AAPL,bad symbol,NVDA', 2)).toEqual(['AAPL', 'MSFT'])
  })
  it('bounds free-text queries and strips control characters', () => {
    expect(cleanQuery('a\u0000b\nc')).toBe('a b c')
    expect(cleanQuery('x'.repeat(500), 80)?.length).toBe(80)
    expect(cleanQuery('   ')).toBeNull()
  })
})

describe('central parameter guard', () => {
  it('passes normal requests', () => {
    expect(invalidParam(new URLSearchParams('symbol=AAPL&range=1d'))).toBeNull()
    expect(invalidParam(new URLSearchParams('watchlist=AAPL,RELIANCE.NS,%5ENSEI&category=markets'))).toBeNull()
    expect(invalidParam(new URLSearchParams('ticker=&market=US'))).toBeNull()
  })
  it('flags malformed symbols, oversized lists and long values', () => {
    expect(invalidParam(new URLSearchParams('symbol=AAPL%3Ftoken%3Dx'))).toBe('symbol')
    expect(invalidParam(new URLSearchParams('ticker=..%2F..%2Fetc'))).toBe('ticker')
    expect(invalidParam(new URLSearchParams('symbols=' + Array(40).fill('AAPL').join(',')))).toBe('symbols')
    expect(invalidParam(new URLSearchParams('q=' + 'x'.repeat(700)))).toBe('q')
  })
})

describe('client IP', () => {
  it('ignores client-supplied (left-most) X-Forwarded-For entries', () => {
    expect(clientIp(h({ 'x-forwarded-for': '1.1.1.1, 9.9.9.9, 203.0.113.7' }))).toBe('203.0.113.7')
  })
  it('falls back to x-real-ip, then unknown', () => {
    expect(clientIp(h({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4')
    expect(clientIp(h({}))).toBe('unknown')
  })
})

describe('cross-site request detection', () => {
  const host = 'nexus.example.com'
  it('allows same-origin and direct navigation', () => {
    expect(isCrossSiteRequest(h({ 'sec-fetch-site': 'same-origin' }), host, [])).toBe(false)
    expect(isCrossSiteRequest(h({ 'sec-fetch-site': 'none' }), host, [])).toBe(false)
    expect(isCrossSiteRequest(h({ origin: 'https://nexus.example.com' }), host, [])).toBe(false)
    expect(isCrossSiteRequest(h({}), host, [])).toBe(false)
  })
  it('blocks other websites', () => {
    expect(isCrossSiteRequest(h({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), host, [])).toBe(true)
    expect(isCrossSiteRequest(h({ origin: 'https://evil.example' }), host, [])).toBe(true)
    expect(isCrossSiteRequest(h({ origin: 'not a url' }), host, [])).toBe(true)
  })
  it('honours the explicit allowlist', () => {
    const allowed = parseAllowedOrigins('https://partner.example/, https://other.example')
    expect(isCrossSiteRequest(h({ 'sec-fetch-site': 'cross-site', origin: 'https://partner.example' }), host, allowed)).toBe(false)
  })
})

describe('secret redaction', () => {
  it('removes configured secret values and key-like query params', () => {
    process.env.TEST_PROVIDER_API_KEY = 'super-secret-value-123'
    const out = redact('GET https://x.test/a?api_key=super-secret-value-123&token=abc123 failed: super-secret-value-123')
    expect(out).not.toContain('super-secret-value-123')
    expect(out).not.toContain('abc123')
    delete process.env.TEST_PROVIDER_API_KEY
  })
})

describe('guarded upstream fetch', () => {
  it('refuses hosts that are not on the allowlist, plain HTTP and URL credentials', async () => {
    expect(isAllowedHost('finnhub.io')).toBe(true)
    await expect(upstreamFetch(new URL('https://evil.example/x'), { provider: 't' })).rejects.toBeInstanceOf(UpstreamError)
    await expect(upstreamFetch(new URL('http://finnhub.io/x'), { provider: 't' })).rejects.toBeInstanceOf(UpstreamError)
    await expect(upstreamFetch(new URL('https://u:p@finnhub.io/x'), { provider: 't' })).rejects.toBeInstanceOf(UpstreamError)
  })
})

describe('key vault', () => {
  it('refuses unsafe paths before any request is made', () => {
    const saved = process.env.FINNHUB_API_KEY
    process.env.FINNHUB_API_KEY = 'unit-test-key-not-real'
    expect(() => finnhub('../../other')).toThrow(UpstreamError)
    expect(() => finnhub('quote?token=x')).toThrow(UpstreamError)
    if (saved) process.env.FINNHUB_API_KEY = saved
    else delete process.env.FINNHUB_API_KEY
  })
  it('fails closed with a URL-free error when a key is missing', () => {
    const saved = process.env.FRED_API_KEY
    delete process.env.FRED_API_KEY
    expect(hasKey('fred')).toBe(false)
    let message = ''
    try { void fred('series/observations', { series_id: 'DGS10' }) } catch (e) { message = String(e) }
    expect(message).toContain('not configured')
    expect(message).not.toMatch(/https?:|api_key/)
    if (saved) process.env.FRED_API_KEY = saved
  })
})

describe('shared cache', () => {
  it('de-duplicates concurrent loads into one upstream call', async () => {
    const cache = createCache<number>({ name: 't1' })
    let calls = 0
    const load = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return 42 }
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.wrap('k', 1000, load)))
    expect(results.every(r => r === 42)).toBe(true)
    expect(calls).toBe(1)
  })
  it('serves the last good value when the loader fails', async () => {
    const cache = createCache<string>({ name: 't2' })
    await cache.wrap('k', 1, async () => 'good')
    await new Promise(r => setTimeout(r, 5))
    expect(await cache.wrap('k', 1, async () => { throw new Error('down') })).toBe('good')
  })
  it('never exceeds its size bound', () => {
    const cache = createCache<number>({ name: 't3', max: 5 })
    for (let i = 0; i < 100; i++) cache.set(`k${i}`, i, 1000)
    expect(cache.size).toBe(5)
    const m = new BoundedMap<string, number>(3)
    for (let i = 0; i < 50; i++) m.set(`k${i}`, i)
    expect(m.size).toBe(3)
    expect(m.has('k49')).toBe(true)
  })
})

describe('rate limiter', () => {
  beforeEach(() => _resetRateLimiter())
  it('allows up to the limit then blocks', () => {
    for (let i = 0; i < 5; i++) expect(rateLimit('ip', 5, 60_000).allowed).toBe(true)
    expect(rateLimit('ip', 5, 60_000).allowed).toBe(false)
    expect(rateLimit('other-ip', 5, 60_000).allowed).toBe(true)
  })
})
