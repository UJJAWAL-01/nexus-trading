// src/lib/providers/symbols.ts
// Validation for anything a client sends that ends up in an upstream request.
// Pure functions, safe to import anywhere (including tests and the browser).

// Covers: AAPL · BRK-B · BRK.B · RELIANCE.NS · M&M.NS · BAJAJ-AUTO.NS ·
//         ^NSEI · EURUSD=X · CL=F · BTC-USD · BINANCE:BTCUSDT
const SYMBOL = /^[A-Za-z0-9^][A-Za-z0-9.\-=^&:_]{0,24}$/

export function isValidSymbol(input: unknown): input is string {
  return typeof input === 'string' && SYMBOL.test(input)
}

/** Trim + validate. Returns null when the symbol is not acceptable. */
export function cleanSymbol(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const s = input.trim()
  return SYMBOL.test(s) ? s : null
}

/** Parse a comma-separated list, dropping invalid entries and capping the count. */
export function cleanSymbolList(input: unknown, max: number): string[] {
  if (typeof input !== 'string') return []
  const out: string[] = []
  for (const part of input.split(',')) {
    const s = cleanSymbol(part)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= max) break
  }
  return out
}

// Yahoo chart API accepted values. Anything else is rejected before a request
// is made, so query input can never add parameters to the upstream URL.
export const YAHOO_RANGES = new Set([
  '1d', '5d', '7d', '1mo', '60d', '3mo', '6mo', '1y', '2y', '730d', '5y', '10y', 'ytd', 'max',
])
export const YAHOO_INTERVALS = new Set([
  '1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo',
])

/** Free-text search query: bounded length, control characters removed. */
export function cleanQuery(input: unknown, maxLength = 80): string | null {
  if (typeof input !== 'string') return null
  const s = input.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength)
  return s.length ? s : null
}
