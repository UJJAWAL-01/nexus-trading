// src/app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

export interface SearchResult {
  symbol:   string
  name:     string
  exchange: string
  type:     string
  currency: string
}

// Yahoo exchange codes → human-readable labels
const EXCHANGE_LABELS: Record<string, string> = {
  NMS: 'NASDAQ', NGM: 'NASDAQ', NCM: 'NASDAQ',
  NYQ: 'NYSE',   ASE: 'NYSE Am.',
  NSI: 'NSE',    BOM: 'BSE',    BSE: 'BSE',
  LSE: 'LSE',    AMS: 'AMS',    PAR: 'Paris',
  FRA: 'Frankfurt', STU: 'Stuttgart',
  TSX: 'TSX',    CVE: 'TSX-V',
  ASX: 'ASX',    HKG: 'HKEX',
  SHH: 'Shanghai', SHZ: 'Shenzhen',
  TYO: 'Tokyo',  KSC: 'Korea',
  SES: 'SGX',    SAO: 'B3',
  MCX: 'MCX',
}

const VALID_QUOTE_TYPES = [
  'EQUITY', 'ETF', 'MUTUALFUND', 'INDEX',
  'CRYPTOCURRENCY', 'CURRENCY', 'FUTURE',
]

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  if (q.length < 1) return NextResponse.json({ results: [] })

  const cacheKey = `search:${q.toLowerCase()}`
  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) {
    return NextResponse.json(hit.data, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
    })
  }

  const results: SearchResult[] = []

  // ── Primary: Yahoo Finance (global — US, India, UK, Asia, etc.) ───────────
  try {
    const url =
      `https://query1.finance.yahoo.com/v1/finance/search` +
      `?q=${encodeURIComponent(q)}` +
      `&quotesCount=15&newsCount=0&listsCount=0` +
      `&enableFuzzyQuery=false&enableCb=true` +
      `&enableNavLinks=false&enableEnhancedTrivialQuery=true`

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

    if (res.ok) {
      const data = await res.json()
      for (const q of (data.quotes ?? []) as any[]) {
        if (!q.symbol) continue
        if (!VALID_QUOTE_TYPES.includes(q.quoteType)) continue
        results.push({
          symbol:   q.symbol,
          name:     q.longname || q.shortname || q.symbol,
          exchange: EXCHANGE_LABELS[q.exchange] || q.fullExchangeName || q.exchange || '',
          type:     q.typeDisp || q.quoteType || 'Equity',
          currency: q.currency || 'USD',
        })
      }
    }
  } catch (err) {
    console.error('[search] Yahoo error:', err)
  }

  // ── Fallback: Finnhub (supplements when Yahoo results are sparse) ─────────
  if (results.length < 4 && process.env.FINNHUB_API_KEY) {
    try {
      const fhRes = await fetch(
        `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${process.env.FINNHUB_API_KEY}`,
        { next: { revalidate: 0 } },
      )
      if (fhRes.ok) {
        const fh = await fhRes.json()
        for (const r of (fh.result ?? []).slice(0, 8) as any[]) {
          if (!r.symbol) continue
          if (results.some(x => x.symbol === r.symbol)) continue
          results.push({
            symbol:   r.symbol,
            name:     r.description || r.symbol,
            exchange: '',
            type:     r.type === 'ETP' ? 'ETF' : r.type || 'Equity',
            currency: 'USD',
          })
        }
      }
    } catch {}
  }

  const payload = { results: results.slice(0, 12) }
  cache.set(cacheKey, { data: payload, expires: Date.now() + 30_000 })

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
  })
}