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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')?.trim().toUpperCase()
  if (!symbol) return NextResponse.json({ error: 'symbol required' }, { status: 400 })

  const cacheKey = `gq:${symbol}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data, {
      headers: { 'Cache-Control': 'public, s-maxage=8, stale-while-revalidate=30' },
    })
  }

  // ── Yahoo Finance v8 chart endpoint — works for all global symbols ─────────
  // Indian NSE: RELIANCE.NS  BSE: RELIANCE.BO
  // US: AAPL  UK: VODAFONE.L  Germany: BASI.F etc.
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/` +
      `${encodeURIComponent(symbol)}?interval=1d&range=2d&includePrePost=true`

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
      if (cached?.stale) return NextResponse.json(cached.stale)
      return NextResponse.json({ symbol, price: null, error: `HTTP ${res.status}` })
    }

    const json = await res.json()
    const result = json?.chart?.result?.[0]

    if (!result || !result.meta) {
      if (cached?.stale) return NextResponse.json(cached.stale)
      return NextResponse.json({ symbol, price: null, error: 'No data' })
    }

    const m = result.meta

    // For intraday data, prefer regularMarketPrice; for after-hours prefer postMarketPrice
    const price = m.regularMarketPrice ?? m.previousClose ?? null
    const prevClose = m.chartPreviousClose ?? m.previousClose ?? null
    const change = price != null && prevClose != null ? +(price - prevClose).toFixed(4) : null
    const changePct =
      change != null && prevClose ? +((change / prevClose) * 100).toFixed(4) : null

    const payload: GlobalQuote = {
      symbol:           m.symbol ?? symbol,
      price,
      change,
      changePercent:    changePct,
      currency:         m.currency ?? 'USD',
      exchange:         m.exchangeName ?? m.fullExchangeName ?? '',
      marketState:      m.marketState ?? 'CLOSED',
      high:             m.regularMarketDayHigh ?? null,
      low:              m.regularMarketDayLow  ?? null,
      volume:           m.regularMarketVolume  ?? null,
      prevClose,
      longName:         m.longName ?? m.shortName ?? '',
      open:             m.regularMarketOpen ?? null,
      fiftyTwoWeekHigh: m.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow:  m.fiftyTwoWeekLow  ?? null,
    }

    cache.set(cacheKey, { data: payload, stale: payload, expires: Date.now() + 8_000 })

    return NextResponse.json(payload, {
      headers: { 'Cache-Control': 'public, s-maxage=8, stale-while-revalidate=30' },
    })
  } catch (err) {
    console.error('[globalquote] error for', symbol, err)
    if (cached?.stale) return NextResponse.json(cached.stale)
    return NextResponse.json({ symbol, price: null, error: 'Fetch error' })
  }
}