// src/app/api/globalquote/route.ts
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; stale: unknown; expires: number }>()

export interface GlobalQuote {
  symbol:        string
  price:         number | null
  change:        number | null
  changePercent: number | null
  currency:      string
  exchange:      string
  marketState:   string
  high:          number | null
  low:           number | null
  volume:        number | null
  prevClose:     number | null
  longName:      string
  open:          number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow:  number | null
}

// Map international symbols to correct Yahoo Finance symbols if needed
const SYMBOL_MAP: Record<string, string> = {
  '^NSEI': '^NSEI',      // Nifty 50 - works as-is
  '^BSESN': '^BSESN',    // Sensex - works as-is
  'USDINR=X': 'USDINR=X', // USD/INR - works as-is
  '^N225': '^N225',      // Nikkei 225 - works as-is
  '^HSI': '^HSI',        // Hang Seng - works as-is
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  let symbol = searchParams.get('symbol')?.trim().toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  // Apply symbol mapping if needed
  const yfinanceSymbol = SYMBOL_MAP[symbol] || symbol

  const cacheKey = `gq:${symbol}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, s-maxage=8, stale-while-revalidate=30' },
    })
  }

  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/` +
      `${encodeURIComponent(yfinanceSymbol)}?interval=1d&range=5d&includePrePost=true`

    if (process.env.NODE_ENV !== 'production') console.log(`[globalquote] Fetching: ${symbol}`)

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      next: { revalidate: 0 },
    })

    if (res.status === 404) {
      return NextResponse.json({ symbol, price: null, error: 'Symbol not found' })
    }

    if (!res.ok) {
      if (process.env.NODE_ENV !== 'production') console.error(`[globalquote] HTTP ${res.status} for ${symbol}`)
      if (cached?.stale) return NextResponse.json(cached.stale)
      return NextResponse.json({ symbol, price: null, error: 'Data unavailable' })
    }

    const json = await res.json()
    const result = json?.chart?.result?.[0]

    if (!result || !result.meta) {
      if (cached?.stale) return NextResponse.json(cached.stale)
      return NextResponse.json({ symbol, price: null, error: 'No data' })
    }

    const m = result.meta
    const timestamps = result.timestamp || []
    const quotes = result.indicators?.quote?.[0] || {}

    // Use latest close price from data
    let price = m.regularMarketPrice ?? null
    let prevClose = m.chartPreviousClose ?? m.previousClose ?? null

    // If regularMarketPrice not available, use latest closing price from data
    if (price === null && timestamps.length > 0 && quotes.close) {
      const latestIdx = timestamps.length - 1
      price = quotes.close[latestIdx] ?? null
    }

    // If still no price, use previous close as fallback
    if (price === null) {
      price = prevClose
    }

    const change = price != null && prevClose != null ? +(price - prevClose).toFixed(4) : null
    const changePct =
      change != null && prevClose ? +((change / prevClose) * 100).toFixed(4) : null

    const payload: GlobalQuote = {
      symbol,
      price:            price ?? 0,
      change:           change ?? 0,
      changePercent:    changePct ?? 0,
      currency:         m.currency ?? 'USD',
      exchange:         m.exchangeName ?? m.fullExchangeName ?? 'Unknown',
      marketState:      m.marketState ?? 'CLOSED',
      high:             m.regularMarketDayHigh ?? null,
      low:              m.regularMarketDayLow  ?? null,
      volume:           m.regularMarketVolume  ?? null,
      prevClose:        prevClose ?? null,
      longName:         m.longName ?? m.shortName ?? symbol,
      open:             m.regularMarketOpen ?? null,
      fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow:  m.fiftyTwoWeekLow  ?? null,
    }

    if (process.env.NODE_ENV !== 'production') console.log(`[globalquote] Success: ${symbol} = ${price}`)
    cache.set(cacheKey, { data: payload, stale: payload, expires: Date.now() + 8_000 })

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=8, stale-while-revalidate=30' },
    })
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') console.error('[globalquote] error for', symbol, err)
    if (cached?.stale) return NextResponse.json(cached.stale)
    return NextResponse.json({ symbol, price: null, error: 'Data unavailable' })
  }
}