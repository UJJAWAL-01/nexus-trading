// src/app/api/correlation/route.ts
import { NextRequest, NextResponse } from 'next/server'

// ── Cache (4hr TTL for computed correlations) ─────────────────────────────────
const corrCache = new Map<string, { data: unknown; expires: number }>()
const priceCache = new Map<string, { closes: number[]; expires: number }>()

// ── Math: Pearson correlation & returns ───────────────────────────────────────

function pctReturns(prices: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      out.push((prices[i] - prices[i - 1]) / prices[i - 1])
    }
  }
  return out
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 10) return 0
  const as = a.slice(-n), bs = b.slice(-n)
  const ma = as.reduce((s, v) => s + v, 0) / n
  const mb = bs.reduce((s, v) => s + v, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) {
    const ai = as[i] - ma, bi = bs[i] - mb
    num += ai * bi; da += ai * ai; db += bi * bi
  }
  const denom = Math.sqrt(da * db)
  return denom === 0 ? 0 : parseFloat((num / denom).toFixed(4))
}

// Spearman rank correlation (less sensitive to outliers than Pearson)
function rankify(arr: number[]): number[] {
  const sorted = [...arr].sort((a, b) => a - b)
  return arr.map(v => sorted.indexOf(v) + 1)
}

function spearman(a: number[], b: number[]): number {
  return pearson(rankify(a), rankify(b))
}

// Rolling beta: how much target moves per unit of benchmark
function beta(target: number[], benchmark: number[], window = 60): number {
  const n = Math.min(target.length, benchmark.length, window)
  if (n < 10) return 0
  const t = target.slice(-n), b = benchmark.slice(-n)
  const cov = pearson(t, b) * stdDev(t) * stdDev(b) // pearson * stds
  const varB = Math.pow(stdDev(b), 2)
  return varB === 0 ? 0 : parseFloat((cov / varB).toFixed(4))
}

function stdDev(arr: number[]): number {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length)
}

// Granger causality proxy: does X lag predict Y?
// We compute cross-correlation at lag 1,2,3 to detect lead/lag relationship
function laggedCorrelation(a: number[], b: number[], lag: number): number {
  if (lag >= a.length) return 0
  const aLagged = a.slice(0, -lag)
  const bLeads  = b.slice(lag)
  return pearson(aLagged, bLeads)
}

// Detect lead/lag: does symbol A lead or follow the target?
function detectLeadLag(target: number[], other: number[]): {
  lag: number; direction: 'leads' | 'follows' | 'concurrent'; strength: number
} {
  const lags = [1, 2, 3, 5]
  let bestLag = 0, bestCorr = 0, bestDirection: 'leads' | 'follows' | 'concurrent' = 'concurrent'

  lags.forEach(l => {
    // other leads target (other moves first)
    const otherLeads = laggedCorrelation(other, target, l)
    // target leads other (target moves first)
    const targetLeads = laggedCorrelation(target, other, l)

    if (Math.abs(otherLeads) > Math.abs(bestCorr)) {
      bestCorr = otherLeads
      bestLag  = l
      bestDirection = 'leads'
    }
    if (Math.abs(targetLeads) > Math.abs(bestCorr)) {
      bestCorr = targetLeads
      bestLag  = l
      bestDirection = 'follows'
    }
  })

  return { lag: bestLag, direction: bestDirection, strength: Math.abs(bestCorr) }
}

// ── Yahoo Finance OHLCV fetcher ────────────────────────────────────────────────

async function fetchCloses(symbol: string, days = 120): Promise<number[]> {
  // Check price cache first
  const cacheKey = `prices:${symbol}:${days}`
  const cached   = priceCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.closes

  try {
    const range = days <= 30 ? '1mo' : days <= 90 ? '3mo' : '6mo'
    const url   = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`
    const res   = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NexusTrader/1.0)' },
      signal:  AbortSignal.timeout(8000),
    })
    if (!res.ok) return []

    const json   = await res.json()
    const result = json?.chart?.result?.[0]
    if (!result) return []

    const closes = (result.indicators?.quote?.[0]?.close ?? []) as (number | null)[]
    const valid  = closes.filter((v): v is number => v !== null && v > 0)

    priceCache.set(cacheKey, { closes: valid, expires: Date.now() + 2 * 3_600_000 })
    return valid
  } catch {
    return []
  }
}

// ── Claude AI: Identify the right universe of stocks to correlate ─────────────

interface StockUniverse {
  symbols:     string[]
  categories:  Record<string, string[]>   // category -> symbols
  reasoning:   string
}

async function getStockUniverseFromClaude(
  targetSymbol: string,
  market: string,
): Promise<StockUniverse> {

  const isIndian = market === 'IN' ||
    targetSymbol.endsWith('.NS') ||
    targetSymbol.endsWith('.BO') ||
    targetSymbol.startsWith('^N')

  const prompt = isIndian
    ? `You are a quantitative analyst. For the stock/index "${targetSymbol}" on NSE/BSE India, identify the 20 most important symbols to analyze for correlation. Include:
1. Direct sector peers (same industry NSE stocks, use .NS suffix)
2. Key ETFs and indices (^NSEI, ^NSEBANK, ^CNXIT etc.)
3. Global macro factors that affect Indian stocks (^GSPC, GLD, CL=F for crude, USDINR=X)
4. Supply chain / business relationship stocks
5. Major FII favorite stocks that move together
6. Competitor and substitute companies

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "symbols": ["SYMBOL1.NS", "SYMBOL2.NS", "^NSEI", ...],
  "categories": {
    "Sector Peers": ["..."],
    "Indian Indices": ["..."],
    "Global Factors": ["..."],
    "Supply Chain": ["..."],
    "Institutional Favorites": ["..."]
  },
  "reasoning": "One sentence explaining the key relationships"
}`
    : `You are a quantitative analyst. For the stock/ETF "${targetSymbol}" traded in the US market, identify the 20 most important symbols to analyze for correlation. Include:
1. Direct sector peers (same industry S&P 500 stocks)
2. Relevant ETFs (sector ETFs, thematic ETFs)
3. Major indices (SPY, QQQ, DIA, IWM)
4. Supply chain companies (key suppliers and customers)
5. Macro factors (GLD, TLT, VIX, DXY via UUP, crude via USO)
6. Key competitors with overlapping revenue streams
7. Stocks with known institutional co-ownership

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "symbols": ["AAPL", "MSFT", "QQQ", "SPY", ...],
  "categories": {
    "Sector Peers": ["..."],
    "ETFs": ["..."],
    "Macro Factors": ["..."],
    "Supply Chain": ["..."],
    "Competitors": ["..."]
  },
  "reasoning": "One sentence explaining the key relationships"
}`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) throw new Error(`Claude API ${response.status}`)

    const data    = await response.json()
    const text    = data.content?.[0]?.text ?? ''

    // Strip any markdown fences and parse JSON
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(clean) as StockUniverse

    // Remove the target itself from the list
    parsed.symbols = parsed.symbols
      .filter(s => s !== targetSymbol && s !== targetSymbol.replace('.NS',''))
      .slice(0, 22) // cap at 22

    return parsed
  } catch (err) {
    console.error('[Correlation] Claude API failed:', err)

    // Intelligent fallback based on target symbol
    return buildFallbackUniverse(targetSymbol, isIndian)
  }
}

function buildFallbackUniverse(symbol: string, isIndian: boolean): StockUniverse {
  if (isIndian) {
    return {
      symbols: [
        '^NSEI', '^NSEBANK', '^CNXIT', 'RELIANCE.NS', 'TCS.NS',
        'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS', 'WIPRO.NS', 'SBIN.NS',
        'AXISBANK.NS', 'LT.NS', 'BAJFINANCE.NS', 'HINDUNILVR.NS',
        'USDINR=X', 'GLD', '^GSPC', 'BHARTIARTL.NS', 'KOTAKBANK.NS',
      ],
      categories: {
        'NSE Indices':   ['^NSEI', '^NSEBANK', '^CNXIT'],
        'Banking':       ['HDFCBANK.NS', 'ICICIBANK.NS', 'SBIN.NS', 'AXISBANK.NS'],
        'IT Sector':     ['TCS.NS', 'INFY.NS', 'WIPRO.NS'],
        'Macro Factors': ['USDINR=X', 'GLD', '^GSPC'],
      },
      reasoning: 'Default Indian market universe — major NIFTY 50 components and macro factors',
    }
  }

  return {
    symbols: [
      'SPY', 'QQQ', 'DIA', 'IWM', 'VGT', 'XLK', 'XLF', 'XLE',
      'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
      'JPM', 'GLD', 'TLT', 'VIX', 'USO',
    ].filter(s => s !== symbol),
    categories: {
      'Major Indices': ['SPY', 'QQQ', 'DIA', 'IWM'],
      'Mega Cap Tech': ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA'],
      'Sector ETFs':   ['VGT', 'XLK', 'XLF', 'XLE'],
      'Macro Factors': ['GLD', 'TLT', 'VIX', 'USO'],
    },
    reasoning: 'Default US market universe — major S&P 500 tech and macro instruments',
  }
}

// ── Claude AI: Explain WHY two stocks correlate ────────────────────────────────

async function explainCorrelation(
  target:    string,
  peer:      string,
  pearsonR:  number,
  leadLag:   { direction: string; lag: number },
  category:  string | null,
): Promise<string> {

  // Short prompt for efficiency — we run these in parallel for each symbol
  const prompt = `Stock: ${target} vs ${peer}. Pearson r=${pearsonR.toFixed(2)}. ${peer} ${leadLag.direction} ${target} by ${leadLag.lag} days. Category: ${category ?? 'unknown'}. 
In exactly ONE sentence (max 20 words), explain WHY these stocks are correlated. Focus on fundamental business or macro reason, not just the numbers.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: 60,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) return ''
    const data = await res.json()
    return (data.content?.[0]?.text ?? '').trim().replace(/^["']|["']$/g, '')
  } catch {
    return ''
  }
}

// ── Main computation pipeline ─────────────────────────────────────────────────

export interface CorrelationResult {
  symbol:      string
  pearson:     number
  spearman:    number
  beta:        number
  direction:   'leads' | 'follows' | 'concurrent'
  leadLagDays: number
  leadLagStrength: number
  category:    string | null
  explanation: string
  abs:         number
  dataPoints:  number
}

export interface CorrelationResponse {
  target:        string
  market:        string
  dataPoints:    number
  period:        string
  correlations:  CorrelationResult[]
  categories:    Record<string, string[]>
  universeReason: string
  fetchedAt:     string
  poweredBy:     string
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || 'SPY').trim()
  const market = searchParams.get('market') || 'US'
  const cacheKey = `corr:${symbol}:${market}`

  const cached = corrCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  try {
    // ── Step 1: Ask Claude which stocks to analyze ─────────────────────────
    const universe = await getStockUniverseFromClaude(symbol, market)

    // ── Step 2: Fetch target prices ────────────────────────────────────────
    const targetCloses = await fetchCloses(symbol)
    if (targetCloses.length < 20) {
      return NextResponse.json({
        error: `Insufficient price data for ${symbol}`,
        correlations: [],
        target: symbol,
      })
    }
    const targetReturns = pctReturns(targetCloses)

    // ── Step 3: Fetch all peer prices in parallel (batched) ────────────────
    const BATCH = 6
    const peerPrices: Map<string, number[]> = new Map()

    for (let i = 0; i < universe.symbols.length; i += BATCH) {
      const batch = universe.symbols.slice(i, i + BATCH)
      const results = await Promise.all(
        batch.map(async s => ({ s, closes: await fetchCloses(s) }))
      )
      results.forEach(({ s, closes }) => {
        if (closes.length >= 20) peerPrices.set(s, closes)
      })
      // Small delay between batches
      if (i + BATCH < universe.symbols.length) {
        await new Promise(r => setTimeout(r, 250))
      }
    }

    // ── Step 4: Compute statistics for each peer ───────────────────────────
    const rawResults: Omit<CorrelationResult, 'explanation'>[] = []

    peerPrices.forEach((closes, sym) => {
      const returns = pctReturns(closes)
      const p       = pearson(targetReturns, returns)
      if (Math.abs(p) < 0.05) return // skip near-zero correlations

      const sp      = spearman(targetReturns, returns)
      const b       = beta(targetReturns, returns)
      const ll      = detectLeadLag(targetReturns, returns)

      // Find which category this symbol belongs to
      let category: string | null = null
      for (const [cat, syms] of Object.entries(universe.categories)) {
        if (syms.includes(sym)) { category = cat; break }
      }

      rawResults.push({
        symbol:          sym,
        pearson:         p,
        spearman:        sp,
        beta:            b,
        direction:       ll.direction,
        leadLagDays:     ll.lag,
        leadLagStrength: ll.strength,
        category,
        abs:             Math.abs(p),
        dataPoints:      Math.min(targetCloses.length, closes.length),
      })
    })

    // Sort by absolute correlation
    rawResults.sort((a, b) => b.abs - a.abs)
    const top = rawResults.slice(0, 16)

    // ── Step 5: Get AI explanations for top correlations (parallel, capped) ─
    const TOP_EXPLAIN = 8 // explain top 8, rest get empty string

    const withExplanations: CorrelationResult[] = await Promise.all(
      top.map(async (r, idx): Promise<CorrelationResult> => {
        const explanation = idx < TOP_EXPLAIN
          ? await explainCorrelation(symbol, r.symbol, r.pearson, { direction: r.direction, lag: r.leadLagDays }, r.category)
          : ''
        return { ...r, explanation }
      })
    )

    // ── Step 6: Assemble response ──────────────────────────────────────────
    const response: CorrelationResponse = {
      target:         symbol,
      market,
      dataPoints:     targetCloses.length,
      period:         `${Math.round(targetCloses.length * 1)} trading days`,
      correlations:   withExplanations,
      categories:     universe.categories,
      universeReason: universe.reasoning,
      fetchedAt:      new Date().toISOString(),
      poweredBy:      'Claude AI Universe Detection + 90-day Pearson/Spearman/Beta + Lead-Lag Analysis',
    }

    corrCache.set(cacheKey, { data: response, expires: Date.now() + 4 * 3_600_000 })
    return NextResponse.json(response)

  } catch (err) {
    console.error('[Correlation API] Error:', err)
    return NextResponse.json({ error: 'Computation failed', correlations: [], target: symbol })
  }
}