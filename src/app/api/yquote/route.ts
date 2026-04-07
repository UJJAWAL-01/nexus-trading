// src/app/api/yquote/route.ts
// Handles: stocks, indices (^VIX, ^NSEI), crypto (BTC-USD), futures (CL=F), FX (USDINR=X)

import { NextRequest, NextResponse } from 'next/server'

const liveCache  = new Map<string, { data: QuoteData; expires: number }>()
const staleCache = new Map<string, QuoteData>()

interface QuoteData {
  symbol:      string
  price:       number | null
  change:      number | null
  changeAbs:   number | null
  currency:    string
  marketState: string
}

/*
  SYMBOL ROUTING TABLE
  Some Yahoo Finance symbols need special handling
*/
const SYMBOL_ALIASES: Record<string, string> = {
  'VIX':    '^VIX',    // VIX without caret → fix to proper Yahoo format
  'BITCOIN':'BTC-USD', // common alternate
}

// Finnhub crypto symbols (fallback for when Yahoo rate-limits crypto)
const FINNHUB_CRYPTO: Record<string, string> = {
  'BTC-USD': 'BINANCE:BTCUSDT',
  'ETH-USD': 'BINANCE:ETHUSDT',
  'SOL-USD': 'BINANCE:SOLUSDT',
  'BNB-USD': 'BINANCE:BNBUSDT',
}

async function fetchFromYahoo(symbol: string): Promise<QuoteData | null> {
  // Yahoo Finance v8 chart API — most reliable endpoint
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`
  
  // Try both Yahoo endpoints (query1 and query2 for redundancy)
  const endpoints = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
  ]

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept':     'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          // Required for some Yahoo endpoints
          'Referer':    'https://finance.yahoo.com',
        },
        signal: AbortSignal.timeout(8000),
      })

      if (!res.ok) continue

      const json   = await res.json()
      const result = json?.chart?.result?.[0]
      if (!result) continue

      const meta       = result.meta ?? {}
      const price      = meta.regularMarketPrice ?? null
      const prevClose  = meta.previousClose ?? meta.chartPreviousClose ?? null
      const changeAbs  = price && prevClose ? price - prevClose : null
      const changePct  = price && prevClose
        ? ((price - prevClose) / prevClose) * 100
        : (meta.regularMarketChangePercent ?? null)

      if (!price || price <= 0) continue

      return {
        symbol,
        price:       Math.round(price * 10000) / 10000,
        change:      changePct !== null ? Math.round(changePct * 100) / 100 : null,
        changeAbs:   changeAbs !== null ? Math.round(changeAbs * 10000) / 10000 : null,
        currency:    meta.currency ?? 'USD',
        marketState: meta.marketState ?? 'UNKNOWN',
      }
    } catch {}
  }
  return null
}

async function fetchFromFinnhubCrypto(symbol: string): Promise<QuoteData | null> {
  const finnhubSym = FINNHUB_CRYPTO[symbol]
  if (!finnhubSym || !process.env.FINNHUB_API_KEY) return null

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${finnhubSym}&token=${process.env.FINNHUB_API_KEY}`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const data = await res.json()

    if (!data.c || data.c <= 0) return null

    return {
      symbol,
      price:       data.c,
      change:      data.dp ?? null,
      changeAbs:   data.d ?? null,
      currency:    'USD',
      marketState: 'REGULAR',
    }
  } catch { return null }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  let symbol = (searchParams.get('symbol') ?? '').trim()

  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  // Apply aliases
  symbol = SYMBOL_ALIASES[symbol.toUpperCase()] ?? symbol

  const cacheKey = `yq:${symbol}`

  // Live cache (15s TTL)
  const live = liveCache.get(cacheKey)
  if (live && live.expires > Date.now()) {
    return NextResponse.json(live.data)
  }

  // Try Yahoo Finance first
  let data = await fetchFromYahoo(symbol)

  // For crypto: try Finnhub as fallback
  if (!data && FINNHUB_CRYPTO[symbol]) {
    data = await fetchFromFinnhubCrypto(symbol)
  }

  if (data) {
    liveCache.set(cacheKey, { data, expires: Date.now() + 15_000 })
    staleCache.set(cacheKey, data)
    return NextResponse.json(data)
  }

  // Return stale data if available — never return null/blank
  const stale = staleCache.get(cacheKey)
  if (stale) {
    return NextResponse.json({ ...stale, stale: true })
  }

  // Last resort: return null data (not blank — the UI handles "···")
  return NextResponse.json({
    symbol,
    price:       null,
    change:      null,
    changeAbs:   null,
    currency:    'USD',
    marketState: 'UNKNOWN',
  })
}