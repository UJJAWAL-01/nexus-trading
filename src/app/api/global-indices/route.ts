// src/app/api/global-indices/route.ts
// Returns all dashboard indices in ONE response — eliminates the 12 per-symbol
// calls the panel was making every 15 seconds per user.
//
// Caching: revalidate=30 caches the full response in Vercel's Data Cache so
// ALL users share one backend compute per 30s window.

import { NextResponse } from 'next/server'
import { cachedJSON } from '@/lib/cache'

export const revalidate = 30

interface QuoteData {
  symbol: string; label: string; flag: string
  price: number | null; change: number | null; digits: number
}

// Split by source so we hit the right upstream API
const YAHOO_SYMBOLS = [
  { symbol: 'BTC-USD', label: 'BTC/USD',    flag: '₿',    digits: 0 },
  { symbol: '^VIX',    label: 'VIX',        flag: '📊',   digits: 2 },
  { symbol: '^NSEI',   label: 'NIFTY 50',   flag: '🇮🇳', digits: 0 },
  { symbol: '^BSESN',  label: 'SENSEX',     flag: '🇮🇳', digits: 0 },
  { symbol: '^NSEBANK',label: 'BANK NIFTY', flag: '🇮🇳', digits: 0 },
  { symbol: 'USDINR=X',label: 'USD/INR',    flag: '💱',   digits: 4 },
  { symbol: '^N225',   label: 'Nikkei',     flag: '🇯🇵', digits: 0 },
  { symbol: '^HSI',    label: 'Hang Seng',  flag: '🇭🇰', digits: 0 },
]
const FINNHUB_SYMBOLS = [
  { symbol: 'SPY',     label: 'S&P 500',    flag: '🇺🇸', digits: 2 },
  { symbol: 'QQQ',     label: 'NASDAQ',     flag: '🇺🇸', digits: 2 },
  { symbol: 'DIA',     label: 'DOW 30',     flag: '🇺🇸', digits: 2 },
  { symbol: 'GLD',     label: 'Gold',       flag: '🥇',   digits: 2 },
]

// v8/finance/chart — works without crumb/session auth unlike v7/quote
async function fetchYahooSymbol(symbol: string): Promise<{ price: number | null; change: number | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`
  const json = await cachedJSON<any>(url, {
    revalidate: 30,
    tags: ['global-indices'],
    timeoutMs: 8000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
    },
  })
  const meta = json?.chart?.result?.[0]?.meta
  if (!meta?.regularMarketPrice) return { price: null, change: null }
  const price = meta.regularMarketPrice as number
  const prev  = meta.chartPreviousClose ?? meta.previousClose ?? null
  const change = meta.regularMarketChangePercent
    ?? (prev && prev > 0 ? ((price - prev) / prev) * 100 : null)
  return { price, change }
}

// Fetch all Yahoo symbols in parallel — each cached individually for 30s server-side
async function fetchYahooBatch(): Promise<Map<string, { price: number | null; change: number | null }>> {
  const settled = await Promise.allSettled(
    YAHOO_SYMBOLS.map(s => fetchYahooSymbol(s.symbol).then(r => ({ symbol: s.symbol, ...r })))
  )
  const map = new Map<string, { price: number | null; change: number | null }>()
  for (const r of settled) {
    if (r.status === 'fulfilled') map.set(r.value.symbol, { price: r.value.price, change: r.value.change })
  }
  return map
}

// Finnhub quotes — still per-symbol but cached individually for 30s
async function fetchFinnhubQuote(symbol: string): Promise<{ price: number | null; change: number | null }> {
  if (!process.env.FINNHUB_API_KEY) return { price: null, change: null }
  const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${process.env.FINNHUB_API_KEY}`
  const d = await cachedJSON<any>(url, { revalidate: 30, tags: ['global-indices'], timeoutMs: 5000 })
  if (!d || d.rateLimited || !d.c || d.c <= 0) return { price: null, change: null }
  return { price: d.c, change: d.dp ?? null }
}

export async function GET() {
  // Fire Yahoo batch and Finnhub calls in parallel
  const [yahooMap, ...finnhubResults] = await Promise.all([
    fetchYahooBatch(),
    ...FINNHUB_SYMBOLS.map(s => fetchFinnhubQuote(s.symbol)),
  ])

  const quotes: QuoteData[] = []

  // Finnhub quotes (US indices + Gold)
  FINNHUB_SYMBOLS.forEach((cfg, i) => {
    const r = finnhubResults[i]
    quotes.push({ symbol: cfg.symbol, label: cfg.label, flag: cfg.flag, digits: cfg.digits, ...r })
  })

  // Yahoo Finance batch results
  for (const cfg of YAHOO_SYMBOLS) {
    const r = yahooMap.get(cfg.symbol) ?? { price: null, change: null }
    quotes.push({ symbol: cfg.symbol, label: cfg.label, flag: cfg.flag, digits: cfg.digits, ...r })
  }

  return NextResponse.json(
    { quotes, lastUpdated: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
  )
}