// src/app/api/news-feed/route.ts
// Multi-source financial news: Finnhub + NewsAPI + RSS (ET, BS, Moneycontrol, Reuters)
// Categorized: relevant | markets | macro | geopolitics | india
// Company names resolved dynamically from Yahoo Finance — no hardcoded symbol maps

import { NextRequest, NextResponse } from 'next/server'

// djb2 hash — gives a stable numeric ID from any string (URL, headline)
function hashStr(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0
  return h
}

// 60s shared edge cache covers all categories. The `relevant` tab URL varies
// per watchlist so each watchlist combo gets its own cache entry — still
// deduplicated across the 30-40 users who likely share watchlists.
export const revalidate = 60

export type FeedCategory = 'relevant' | 'markets' | 'macro' | 'geopolitics' | 'india'

export interface FeedItem {
  id:             string
  headline:       string
  source:         string
  url:            string
  datetime:       number     // unix seconds
  summary:        string
  category:       FeedCategory
  sentiment:      'bullish' | 'bearish' | 'neutral'
  relatedSymbols: string[]
  relevanceScore: number
  isIndian:       boolean
}

// Symbol name resolution: in-memory only — these are resolved per cold-start
// and stay warm within one instance. Names don't change so 24h is safe.
const symbolNameCache = new Map<string, { name: string; expires: number }>()
const NAME_TTL = 24 * 60 * 60 * 1000

function stripMarketSuffix(sym: string): string {
  return sym.replace(/\.(NS|BO)$/i, '')
}

function isIndianSymbol(sym: string): boolean {
  return sym.endsWith('.NS') || sym.endsWith('.BO')
}

/**
 * Resolve a symbol's company long name from Yahoo Finance chart API.
 * Caches for 24h per symbol. Returns null on failure — callers fall back to base ticker.
 * Works for any exchange: AAPL, RELIANCE.NS, 005930.KS, etc.
 */
async function resolveSymbolName(symbol: string): Promise<string | null> {
  const cached = symbolNameCache.get(symbol)
  if (cached && cached.expires > Date.now()) return cached.name

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
      {
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NexusTrading/1.0)' },
        next: { revalidate: 60 },
      },
    )
    if (!res.ok) return null
    const data = await res.json()
    const name = (data?.chart?.result?.[0]?.meta?.longName as string | undefined)
              ?? (data?.chart?.result?.[0]?.meta?.shortName as string | undefined)
              ?? null
    if (name) symbolNameCache.set(symbol, { name, expires: Date.now() + NAME_TTL })
    return name
  } catch {
    return null
  }
}

/**
 * Batch-resolve company names for a list of symbols.
 * All requests fire in parallel. Missing entries are simply absent from the map.
 */
async function resolveWatchlistNames(symbols: string[]): Promise<Map<string, string>> {
  const results = await Promise.allSettled(symbols.map(resolveSymbolName))
  const map = new Map<string, string>()
  symbols.forEach((sym, i) => {
    const r = results[i]
    if (r.status === 'fulfilled' && r.value) map.set(sym, r.value)
  })
  return map
}

/**
 * Extract matchable search terms from a resolved company name.
 * Strips generic corporate suffixes so we match article text naturally.
 *   "Reliance Industries Limited" → ["reliance industries", "reliance"]
 *   "NVIDIA Corporation"         → ["nvidia corporation", "nvidia"]
 *   "HDFC Bank Limited"          → ["hdfc bank", "hdfc"]
 */
function toMatchTerms(name: string): string[] {
  const NOISE = /\b(limited|ltd\.?|inc\.?|corp\.?|corporation|plc|llc|pvt\.?|private|public|company|co\.?|group|holdings?|international|technologies|technology|services|industries|solutions)\b/gi
  const cleaned = name.replace(NOISE, '').replace(/\s+/g, ' ').trim().toLowerCase()
  const terms: string[] = [cleaned]
  const firstWord = cleaned.split(' ')[0]
  if (firstWord && firstWord.length > 3) terms.push(firstWord)
  return [...new Set(terms)].filter(t => t.length > 2)
}

// ── Sentiment keywords ────────────────────────────────────────────────────────
const BULL_WORDS = ['surge','soar','rally','gain','rise','jump','beat','record','profit','growth','strong',
  'boost','upgrade','buy','outperform','upside','positive','breakout','momentum','bullish','acquisition',
  'dividend','expansion','revenue beat','eps beat','raised guidance','buy rating']
const BEAR_WORDS = ['crash','fall','drop','plunge','miss','loss','weak','cut','warn','fear','recession',
  'down','slump','downgrade','sell','underperform','downside','negative','concern','risk','layoff',
  'bankruptcy','fraud','scandal','investigation','margin pressure','guidance cut','sell-off','bear']

function guessSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const t = text.toLowerCase()
  let b = 0, br = 0
  BULL_WORDS.forEach(w => { if (t.includes(w)) b++ })
  BEAR_WORDS.forEach(w => { if (t.includes(w)) br++ })
  if (b > br + 1) return 'bullish'
  if (br > b + 1) return 'bearish'
  return 'neutral'
}

/**
 * Score how relevant a piece of text is to a watchlist.
 * nameMap is populated from resolveWatchlistNames — when absent the function falls
 * back to ticker-only matching (used for initial RSS parse; re-scored later with nameMap).
 */
function scoreRelevance(
  text: string,
  watchlist: string[],
  nameMap: Map<string, string> = new Map(),
): { score: number; matched: string[] } {
  const t = text.toLowerCase()
  const matched: string[] = []
  let score = 0

  for (const sym of watchlist) {
    if (matched.includes(sym)) continue
    const base = stripMarketSuffix(sym)

    // Direct ticker match (with or without exchange suffix)
    if (t.includes(sym.toLowerCase()) || t.includes(base.toLowerCase())) {
      score += 15; matched.push(sym); continue
    }

    // Dynamic company name match via resolved nameMap (works for any symbol, any market)
    const resolvedName = nameMap.get(sym)
    if (resolvedName) {
      const terms = toMatchTerms(resolvedName)
      if (terms.some(term => t.includes(term))) { score += 12; matched.push(sym); continue }
    }
  }

  const tier1 = ['fed','fomc','rate hike','rate cut','inflation','cpi','gdp','jobs report','nfp',
    'recession','earnings','guidance','rbi','sebi','nifty','sensex','repo rate']
  const tier2 = ['market','stock','equities','rally','selloff','bull','bear','volatility','tariff',
    'trade war','geopolit','sanctions','opec','crude','gold','bitcoin']
  tier1.forEach(k => { if (t.includes(k)) score += 4 })
  tier2.forEach(k => { if (t.includes(k)) score += 2 })

  return { score, matched }
}

function isIndianNews(text: string): boolean {
  const t = text.toLowerCase()
  const keywords = ['india','nifty','sensex','rbi','sebi','bse','nse','rupee','inr','mumbai','delhi','dalal street']
  return keywords.some(k => t.includes(k))
}

// ── RSS Parser (no external dependencies) ─────────────────────────────────────
interface RSSItem { title: string; link: string; description: string; pubDate: string; source: string }

function extractCDATA(raw: string): string {
  const m = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)
  return m ? m[1].trim() : raw.replace(/<[^>]+>/g, '').trim()
}

function parseRSSXML(xml: string, sourceLabel: string): RSSItem[] {
  const items: RSSItem[] = []
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  for (const match of itemMatches) {
    const block = match[1]
    const title = extractCDATA(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '')
    const link  = extractCDATA(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '')
             || (block.match(/<link[^>]*\/>/)?.[0]?.match(/href="([^"]+)"/)?.[1] ?? '')
    const date  = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? ''
    const desc  = extractCDATA(block.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '')
    if (title && title.length > 10) items.push({ title, link, description: desc, pubDate: date, source: sourceLabel })
  }
  return items
}

async function fetchRSS(url: string, sourceLabel: string, timeoutMs = 8000): Promise<RSSItem[]> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/rss+xml, application/xml, text/xml, */*',
      },
      next: { revalidate: 60 },
    })
    if (!res.ok) return []
    return parseRSSXML(await res.text(), sourceLabel)
  } catch {
    return []
  }
}

function rssToFeedItem(item: RSSItem, category: FeedCategory, watchlist: string[], idx: number): FeedItem {
  const text  = item.title + ' ' + item.description
  const { score, matched } = scoreRelevance(text, watchlist) // nameMap added in re-score pass
  const dt    = item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : Math.floor(Date.now() / 1000) - idx * 300
  return {
    id:             `rss-${hashStr(item.link || item.title + String(dt))}`,
    headline:       item.title,
    source:         item.source,
    url:            item.link,
    datetime:       isNaN(dt) ? Math.floor(Date.now() / 1000) - idx * 300 : dt,
    summary:        item.description.slice(0, 300),
    category,
    sentiment:      guessSentiment(text),
    relatedSymbols: matched,
    relevanceScore: score,
    isIndian:       isIndianNews(text),
  }
}

// ── RSS Feed Sources ──────────────────────────────────────────────────────────
const RSS_SOURCES: Record<string, { url: string; label: string; categories: FeedCategory[] }[]> = {
  india: [
    { url: 'https://economictimes.indiatimes.com/markets/stocks/rss.cms',         label: 'Economic Times',    categories: ['india','relevant'] },
    { url: 'https://economictimes.indiatimes.com/markets/market-outlook/rss.cms', label: 'ET Market Outlook', categories: ['india','macro'] },
    { url: 'https://www.business-standard.com/rss/markets-106.rss',               label: 'Business Standard', categories: ['india','relevant'] },
    { url: 'https://www.business-standard.com/rss/economy-policy-102.rss',        label: 'BS Economy',        categories: ['india','macro'] },
    { url: 'https://www.livemint.com/rss/markets',                                label: 'LiveMint Markets',  categories: ['india','relevant'] },
    { url: 'https://www.livemint.com/rss/economy',                                label: 'LiveMint Economy',  categories: ['india','macro'] },
    { url: 'https://feeds.feedburner.com/ndtvprofit-latest',                      label: 'NDTV Profit',       categories: ['india','relevant'] },
  ],
  global: [
    { url: 'https://feeds.reuters.com/reuters/businessNews',  label: 'Reuters Business', categories: ['markets','relevant'] },
    { url: 'https://feeds.reuters.com/reuters/topNews',       label: 'Reuters World',    categories: ['geopolitics','markets'] },
    { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',  label: 'MarketWatch',      categories: ['markets','relevant'] },
    { url: 'https://www.ft.com/?format=rss',                 label: 'Financial Times',  categories: ['markets','macro'] },
    { url: 'https://feeds.bloomberg.com/markets/news.rss',   label: 'Bloomberg Markets',categories: ['markets','macro'] },
  ],
  macro: [
    { url: 'https://feeds.reuters.com/reuters/economyNews',  label: 'Reuters Economy',  categories: ['macro'] },
  ],
  geo: [
    { url: 'https://feeds.reuters.com/reuters/worldNews',    label: 'Reuters World News',  categories: ['geopolitics'] },
    { url: 'https://feeds.reuters.com/reuters/politicsNews', label: 'Reuters Politics',    categories: ['geopolitics'] },
  ],
}

// ── Finnhub news ──────────────────────────────────────────────────────────────
async function fetchFinnhubCategory(category: string): Promise<FeedItem[]> {
  if (!process.env.FINNHUB_API_KEY) return []
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=${category}&token=${process.env.FINNHUB_API_KEY}`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 60 } },
    )
    if (!res.ok) return []
    const data = await res.json()
    return (Array.isArray(data) ? data : []).slice(0, 40).map((item: any, i: number): FeedItem => ({
      id:             `fh-${category}-${item.id ?? i}`,
      headline:       item.headline ?? '',
      source:         item.source   ?? 'Finnhub',
      url:            item.url      ?? '',
      datetime:       item.datetime ?? Math.floor(Date.now() / 1000),
      summary:        (item.summary ?? '').slice(0, 300),
      category:       'markets',
      sentiment:      guessSentiment((item.headline ?? '') + ' ' + (item.summary ?? '')),
      relatedSymbols: [],
      relevanceScore: 5,
      isIndian:       false,
    }))
  } catch { return [] }
}

// ── Yahoo Finance RSS — per-symbol, works for any exchange (.NS, .BO, US, etc.) ─
async function fetchYahooFinanceNews(symbol: string, category: FeedCategory = 'relevant'): Promise<FeedItem[]> {
  const items = await fetchRSS(
    `https://finance.yahoo.com/rss/headline?s=${symbol}`,
    `Yahoo (${stripMarketSuffix(symbol)})`,
    7000,
  )
  if (items.length === 0) {
    console.warn(`[news-feed] Yahoo Finance RSS returned no items for ${symbol}`)
    return []
  }
  return items.map((item, i) => {
    const fi = rssToFeedItem(item, category, [symbol], i)
    fi.relatedSymbols = [symbol]
    fi.relevanceScore = Math.max(fi.relevanceScore, 20)
    fi.isIndian       = isIndianSymbol(symbol)
    return fi
  })
}

// ── NewsAPI ───────────────────────────────────────────────────────────────────
async function fetchNewsAPI(query: string, category: FeedCategory, watchlist: string[]): Promise<FeedItem[]> {
  if (!process.env.NEWS_API_KEY) return []
  try {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const url  = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=30&from=${from}&apiKey=${process.env.NEWS_API_KEY}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 60 } })
    if (!res.ok) return []
    const data = await res.json()
    return (data.articles ?? [])
      .filter((a: any) => a.title && a.title !== '[Removed]')
      .slice(0, 25)
      .map((a: any, i: number): FeedItem => {
        const ts   = Math.floor(new Date(a.publishedAt).getTime() / 1000)
        const text = a.title + ' ' + (a.description ?? '')
        const { score, matched } = scoreRelevance(text, watchlist)
        return {
          id:             `na-${category}-${i}-${ts}`,
          headline:       a.title,
          source:         a.source?.name ?? 'NewsAPI',
          url:            a.url ?? '',
          datetime:       isNaN(ts) ? Math.floor(Date.now() / 1000) : ts,
          summary:        (a.description ?? '').slice(0, 300),
          category,
          sentiment:      guessSentiment(text),
          relatedSymbols: matched,
          relevanceScore: score,
          isIndian:       isIndianNews(text),
        }
      })
  } catch { return [] }
}

// ── Alpha Vantage market news ─────────────────────────────────────────────────
async function fetchAlphaVantageNews(topic: string, watchlist: string[]): Promise<FeedItem[]> {
  if (!process.env.ALPHA_VANTAGE_KEY) return []
  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=${topic}&sort=LATEST&limit=20&apikey=${process.env.ALPHA_VANTAGE_KEY}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), next: { revalidate: 60 } })
    if (!res.ok) return []
    const data = await res.json()
    const feed: any[] = data.feed ?? []
    return feed.slice(0, 20).map((item: any, i: number): FeedItem => {
      const ts = (() => {
        try {
          const d = item.time_published
          return Math.floor(new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(9,11)}:${d.slice(11,13)}:${d.slice(13,15)}`).getTime() / 1000)
        } catch { return Math.floor(Date.now() / 1000) }
      })()
      const text = item.title + ' ' + (item.summary ?? '')
      const { score, matched } = scoreRelevance(text, watchlist)
      const avSentiment = item.overall_sentiment_label?.toLowerCase() ?? ''
      const sentiment: 'bullish' | 'bearish' | 'neutral' =
        avSentiment.includes('bullish') ? 'bullish' :
        avSentiment.includes('bearish') ? 'bearish' : 'neutral'
      return {
        id:             `av-${i}-${ts}`,
        headline:       item.title ?? '',
        source:         item.source ?? 'Alpha Vantage',
        url:            item.url ?? '',
        datetime:       ts,
        summary:        (item.summary ?? '').slice(0, 300),
        category:       'markets',
        sentiment,
        relatedSymbols: matched,
        relevanceScore: score + (sentiment !== 'neutral' ? 3 : 0),
        isIndian:       isIndianNews(text),
      }
    })
  } catch { return [] }
}

// ── Static queries for non-watchlist tabs ─────────────────────────────────────
const CATEGORY_NEWSAPI_QUERIES: Partial<Record<FeedCategory, string>> = {
  markets:     'stock market OR Wall Street OR S&P 500 OR earnings OR "Federal Reserve" OR equities',
  macro:       'inflation OR "interest rates" OR "Federal Reserve" OR GDP OR "central bank" OR CPI OR recession OR "RBI" OR "ECB" OR "rate decision"',
  geopolitics: 'geopolitics OR sanctions OR "trade war" OR tariffs OR Ukraine OR China OR "Middle East" OR OPEC OR tensions OR conflict',
}

const INDIA_BASE_QUERY = 'India stocks OR NIFTY OR Sensex OR RBI OR "NSE India" OR "BSE India" OR "Indian economy" OR "Dalal Street"'

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const category      = (searchParams.get('category') ?? 'markets') as FeedCategory
  const watchlistParam = searchParams.get('watchlist') ?? ''
  const watchlist      = watchlistParam ? watchlistParam.split(',').filter(Boolean) : []

  const allItems: FeedItem[] = []
  const seen = new Set<string>()

  function addItems(items: FeedItem[]) {
    for (const item of items) {
      if (!item.headline || item.headline.length < 10) continue
      const key = item.headline.slice(0, 50).toLowerCase().replace(/\s+/g, ' ')
      if (seen.has(key)) continue
      seen.add(key)
      allItems.push(item)
    }
  }

  // ── Fetch based on category ───────────────────────────────────────────────

  if (category === 'relevant') {
    // Every tradeable symbol gets identical treatment — no market bias
    const tradeableSymbols = watchlist.filter(s => !s.startsWith('^')).slice(0, 10)
    const hasIndiaSymbols  = tradeableSymbols.some(isIndianSymbol)
    const hasUsSymbols     = tradeableSymbols.some(s => !isIndianSymbol(s))

    // Resolve company names for every symbol uniformly (cached 24h)
    const nameMap = await resolveWatchlistNames(tradeableSymbols)

    // Build NewsAPI query from resolved names — works for any symbol, any market
    const newsApiQuery = (() => {
      if (tradeableSymbols.length === 0) return 'stock market OR earnings OR Federal Reserve OR inflation OR S&P 500'
      const terms = tradeableSymbols.slice(0, 8).map(sym => {
        const name = nameMap.get(sym)
        return name ? toMatchTerms(name)[0] : stripMarketSuffix(sym)
      })
      return [...new Set(terms)].join(' OR ') + ' OR stock market OR earnings OR Fed'
    })()

    // Per-symbol: Yahoo Finance RSS for EVERY symbol — same source, same logic, no market bias
    // Market-context sources: Finnhub general (US) + Indian RSS (India) — symmetric by market presence
    const [finnhubGeneral, newsApiRelevant, ...perSymbolResults] = await Promise.allSettled([
      fetchFinnhubCategory('general'),
      fetchNewsAPI(newsApiQuery, 'relevant', watchlist),
      ...tradeableSymbols.map(s => fetchYahooFinanceNews(s, 'relevant')),
    ])

    if (finnhubGeneral.status  === 'fulfilled') addItems(finnhubGeneral.value)
    if (newsApiRelevant.status === 'fulfilled') addItems(newsApiRelevant.value)
    perSymbolResults.forEach(r => { if (r.status === 'fulfilled') addItems(r.value) })

    // Market-context RSS — fetch for whichever markets are represented in the watchlist
    const contextFeeds: Promise<PromiseSettledResult<RSSItem[]>>[] = []
    const contextMeta:  { category: FeedCategory; offset: number }[] = []

    if (hasUsSymbols) {
      // US market context: Reuters Business (symmetric to Indian RSS below)
      contextFeeds.push(Promise.resolve({ status: 'fulfilled' as const, value: [] }).then(async () => {
        const items = await fetchRSS(RSS_SOURCES.global[0].url, RSS_SOURCES.global[0].label, 6000)
        return { status: 'fulfilled' as const, value: items }
      }))
      contextMeta.push({ category: 'relevant', offset: 300 })
    }

    if (hasIndiaSymbols) {
      // India market context: ET + BS + Mint (symmetric to Reuters above)
      contextFeeds.push(
        Promise.allSettled([
          fetchRSS(RSS_SOURCES.india[0].url, RSS_SOURCES.india[0].label, 6000),
          fetchRSS(RSS_SOURCES.india[2].url, RSS_SOURCES.india[2].label, 6000),
          fetchRSS(RSS_SOURCES.india[4].url, RSS_SOURCES.india[4].label, 6000),
        ]).then(results => ({
          status: 'fulfilled' as const,
          value: results.flatMap(r => r.status === 'fulfilled' ? r.value : []),
        })),
      )
      contextMeta.push({ category: 'relevant', offset: 400 })
    }

    const contextResults = await Promise.allSettled(contextFeeds)
    contextResults.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.status === 'fulfilled') {
        r.value.value.forEach((it, j) => addItems([rssToFeedItem(it, contextMeta[i].category, watchlist, contextMeta[i].offset + j)]))
      }
    })

    // Re-score everything with dynamically resolved names
    allItems.forEach(item => {
      const { score, matched } = scoreRelevance(item.headline + ' ' + item.summary, watchlist, nameMap)
      item.relevanceScore = Math.max(item.relevanceScore, score)
      item.relatedSymbols = [...new Set([...item.relatedSymbols, ...matched])]
      if (matched.some(isIndianSymbol)) item.isIndian = true
    })

    // Log coverage gaps
    for (const sym of tradeableSymbols) {
      const hasNews = allItems.some(it => it.relatedSymbols.includes(sym))
      if (!hasNews) console.warn(`[news-feed] No matched news for ${sym} (resolved name: ${nameMap.get(sym) ?? 'unresolved'})`)
    }
  }

  else if (category === 'markets') {
    const [finnhubGeneral, finnhubMergers, newsApiMarkets, avNews, rssFeeds] = await Promise.allSettled([
      fetchFinnhubCategory('general'),
      fetchFinnhubCategory('merger'),
      fetchNewsAPI(CATEGORY_NEWSAPI_QUERIES.markets!, 'markets', watchlist),
      fetchAlphaVantageNews('financial_markets,earnings,ipo', watchlist),
      Promise.all([
        fetchRSS(RSS_SOURCES.global[0].url, RSS_SOURCES.global[0].label, 6000),
        fetchRSS(RSS_SOURCES.global[2].url, RSS_SOURCES.global[2].label, 6000),
      ]),
    ])
    if (finnhubGeneral.status === 'fulfilled') addItems(finnhubGeneral.value)
    if (finnhubMergers.status  === 'fulfilled') addItems(finnhubMergers.value)
    if (newsApiMarkets.status  === 'fulfilled') addItems(newsApiMarkets.value)
    if (avNews.status          === 'fulfilled') addItems(avNews.value)
    if (rssFeeds.status === 'fulfilled') {
      rssFeeds.value.flat().forEach((item, i) => addItems([rssToFeedItem(item, 'markets', watchlist, i)]))
    }
  }

  else if (category === 'macro') {
    const [newsApiMacro, avMacro, rssMacro, rssEconomy] = await Promise.allSettled([
      fetchNewsAPI(CATEGORY_NEWSAPI_QUERIES.macro!, 'macro', watchlist),
      fetchAlphaVantageNews('economy_fiscal,economy_monetary,economy_macro', watchlist),
      fetchRSS(RSS_SOURCES.macro[0].url, RSS_SOURCES.macro[0].label, 6000),
      fetchRSS(RSS_SOURCES.india[1].url, RSS_SOURCES.india[1].label, 6000),
    ])
    if (newsApiMacro.status === 'fulfilled') addItems(newsApiMacro.value)
    if (avMacro.status      === 'fulfilled') addItems(avMacro.value)
    if (rssMacro.status     === 'fulfilled') rssMacro.value.forEach((it, i) => addItems([rssToFeedItem(it, 'macro', watchlist, i)]))
    if (rssEconomy.status   === 'fulfilled') rssEconomy.value.forEach((it, i) => addItems([rssToFeedItem(it, 'macro', watchlist, i)]))
  }

  else if (category === 'geopolitics') {
    const [newsApiGeo, rssWorld, rssPolitics] = await Promise.allSettled([
      fetchNewsAPI(CATEGORY_NEWSAPI_QUERIES.geopolitics!, 'geopolitics', watchlist),
      fetchRSS(RSS_SOURCES.geo[0].url, RSS_SOURCES.geo[0].label, 6000),
      fetchRSS(RSS_SOURCES.geo[1].url, RSS_SOURCES.geo[1].label, 6000),
    ])
    if (newsApiGeo.status  === 'fulfilled') addItems(newsApiGeo.value)
    if (rssWorld.status    === 'fulfilled') rssWorld.value.forEach((it, i) => addItems([rssToFeedItem(it, 'geopolitics', watchlist, i)]))
    if (rssPolitics.status === 'fulfilled') rssPolitics.value.forEach((it, i) => addItems([rssToFeedItem(it, 'geopolitics', watchlist, i)]))
    allItems.forEach(item => { item.category = 'geopolitics' })
  }

  else if (category === 'india') {
    const indiaSymbols = watchlist.filter(isIndianSymbol).slice(0, 6)

    // Resolve names for watchlist Indian symbols — builds dynamic NewsAPI query
    const nameMap = await resolveWatchlistNames(indiaSymbols)

    const indiaNewsQuery = (() => {
      if (indiaSymbols.length === 0) return INDIA_BASE_QUERY
      const companyTerms = indiaSymbols
        .map(s => { const n = nameMap.get(s); return n ? toMatchTerms(n)[0] : null })
        .filter((t): t is string => t !== null)
        .slice(0, 4)
        .join(' OR ')
      return companyTerms ? `${companyTerms} OR ${INDIA_BASE_QUERY}` : INDIA_BASE_QUERY
    })()

    // All Indian RSS + NewsAPI + Yahoo Finance per-symbol in parallel
    const [rssGroup, newsApiIndia, ...yahooResults] = await Promise.allSettled([
      Promise.allSettled(RSS_SOURCES.india.map(s => fetchRSS(s.url, s.label, 8000))),
      fetchNewsAPI(indiaNewsQuery, 'india', watchlist),
      ...indiaSymbols.map(s => fetchYahooFinanceNews(s, 'india')),
    ])

    if (rssGroup.status === 'fulfilled') {
      rssGroup.value.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          r.value.forEach((item, j) => addItems([rssToFeedItem(item, 'india', watchlist, i * 50 + j)]))
        }
      })
    }
    if (newsApiIndia.status === 'fulfilled') addItems(newsApiIndia.value)
    yahooResults.forEach(r => { if (r.status === 'fulfilled') addItems(r.value) })

    // Re-score with resolved names
    allItems.forEach(item => {
      const { score, matched } = scoreRelevance(item.headline + ' ' + item.summary, watchlist, nameMap)
      item.relevanceScore = Math.max(item.relevanceScore, score)
      item.relatedSymbols = [...new Set([...item.relatedSymbols, ...matched])]
    })

    if (indiaSymbols.length > 0) {
      const covered = allItems.filter(it => it.relatedSymbols.some(s => isIndianSymbol(s)))
      if (covered.length === 0) console.warn(`[news-feed] No India tab news matched watchlist symbols: ${indiaSymbols.join(', ')}`)
    }

    allItems.forEach(item => { item.isIndian = true; item.category = 'india' })
  }

  // ── Deduplicate, sort, limit ───────────────────────────────────────────────
  const sorted = allItems
    .filter(item => item.headline?.length > 5)
    .sort((a, b) => {
      if (category === 'relevant') {
        const diff = b.relevanceScore - a.relevanceScore
        if (Math.abs(diff) > 3) return diff
      }
      return b.datetime - a.datetime
    })
    .slice(0, 50)

  return NextResponse.json(
    { items: sorted, count: sorted.length, category, fetchedAt: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } },
  )
}