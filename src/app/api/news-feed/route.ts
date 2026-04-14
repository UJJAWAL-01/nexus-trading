// src/app/api/news-feed/route.ts
// Multi-source financial news: Finnhub + NewsAPI + RSS (ET, BS, Moneycontrol, Reuters)
// Categorized: relevant | markets | macro | geopolitics | india
// Sentiment scoring + relevance tagging — NO fake/placeholder data

import { NextRequest, NextResponse } from 'next/server'

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

// ── Cache ─────────────────────────────────────────────────────────────────────
const cache = new Map<string, { data: FeedItem[]; expires: number }>()

// ── Indian company name → NSE ticker mapping (for relevance scoring) ──────────
const INDIA_NAME_MAP: Record<string, string> = {
  'reliance':         'RELIANCE',  'tcs':             'TCS',
  'hdfc bank':        'HDFCBANK',  'infosys':         'INFY',
  'icici bank':       'ICICIBANK', 'hindustan unilever': 'HINDUNILVR',
  'sbi':              'SBIN',      'state bank':      'SBIN',
  'bharti airtel':    'BHARTIARTL','airtel':          'BHARTIARTL',
  'itc':              'ITC',       'kotak':           'KOTAKBANK',
  'larsen':           'LT',        'l&t':             'LT',
  'axis bank':        'AXISBANK',  'bajaj finance':   'BAJFINANCE',
  'maruti':           'MARUTI',    'titan':           'TITAN',
  'wipro':            'WIPRO',     'sun pharma':      'SUNPHARMA',
  'hcl tech':         'HCLTECH',   'hcl technologies':'HCLTECH',
  'tata motors':      'TATAMOTORS','ongc':            'ONGC',
  'adani':            'ADANIENT',  'tata steel':      'TATASTEEL',
  'ntpc':             'NTPC',      'power grid':      'POWERGRID',
  'bajaj finserv':    'BAJAJFINSV','dr reddy':        'DRREDDY',
  'divis':            'DIVISLAB',  'cipla':           'CIPLA',
  'ultratech':        'ULTRACEMCO','asian paints':    'ASIANPAINT',
  'nestle india':     'NESTLEIND', 'grasim':          'GRASIM',
  'tech mahindra':    'TECHM',     'mahindra':        'MM',
  'hero motocorp':    'HEROMOTOCO','eicher':          'EICHERMOT',
  'jsw steel':        'JSWSTEEL',  'hindalco':        'HINDALCO',
  'vedanta':          'VEDL',      'coal india':      'COALINDIA',
  'nifty':            'NIFTY',     'sensex':          'SENSEX',
  'rbi':              'RBI',       'sebi':            'SEBI',
  'bse':              'BSE',       'nse':             'NSE',
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

function scoreRelevance(text: string, watchlist: string[]): { score: number; matched: string[] } {
  const t = text.toLowerCase()
  const matched: string[] = []
  let score = 0

  // Match watchlist tickers directly
  for (const sym of watchlist) {
    if (t.includes(sym.toLowerCase())) { score += 15; matched.push(sym); continue }
    // US company name mappings
    const usNames: Record<string, string[]> = {
      AAPL:['apple'], NVDA:['nvidia'], TSLA:['tesla'], MSFT:['microsoft'],
      AMZN:['amazon'], META:['meta','facebook'], GOOGL:['google','alphabet'],
      JPM:['jpmorgan','jp morgan'], BAC:['bank of america'], SPY:['s&p','sp500'],
      QQQ:['nasdaq'], NFLX:['netflix'], DIS:['disney'], AMD:['advanced micro'],
    }
    if ((usNames[sym] ?? []).some(n => t.includes(n))) { score += 12; matched.push(sym) }
  }

  // Match Indian company names
  for (const [name, ticker] of Object.entries(INDIA_NAME_MAP)) {
    if (t.includes(name)) {
      score += 10
      if (watchlist.includes(ticker) || watchlist.includes(ticker + '.NS')) {
        score += 8
        if (!matched.includes(ticker)) matched.push(ticker)
      }
    }
  }

  // Tier-1 market keywords
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
  const keywords = ['india','nifty','sensex','rbi','sebi','bse','nse','rupee','inr',
    'reliance','tcs','infosys','hdfc','icici','sbi','bharti','adani','tata','wipro',
    'bajaj','hindalco','vedanta','ongc','ntpc','maruti','mahindra','mumbai','delhi']
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
    const link = extractCDATA(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? '') || (block.match(/<link[^>]*\/>/)?.[0]?.match(/href="([^"]+)"/)?.[1] ?? '');    const date  = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? ''
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
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
      next: { revalidate: 0 },
    })
    if (!res.ok) return []
    const xml = await res.text()
    return parseRSSXML(xml, sourceLabel)
  } catch {
    return []
  }
}

function rssToFeedItem(item: RSSItem, category: FeedCategory, watchlist: string[], idx: number): FeedItem {
  const text   = item.title + ' ' + item.description
  const { score, matched } = scoreRelevance(text, watchlist)
  const dt     = item.pubDate ? Math.floor(new Date(item.pubDate).getTime() / 1000) : Math.floor(Date.now() / 1000) - idx * 300
  return {
    id:             `rss-${item.source.slice(0,3)}-${idx}-${dt}`,
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
    { url: 'https://economictimes.indiatimes.com/markets/stocks/rss.cms',      label: 'Economic Times',       categories: ['india','relevant'] },
    { url: 'https://economictimes.indiatimes.com/markets/market-outlook/rss.cms', label: 'ET Market Outlook',  categories: ['india','macro'] },
    { url: 'https://www.business-standard.com/rss/markets-106.rss',            label: 'Business Standard',    categories: ['india','relevant'] },
    { url: 'https://www.business-standard.com/rss/economy-policy-102.rss',     label: 'BS Economy',           categories: ['india','macro'] },
    { url: 'https://www.livemint.com/rss/markets',                             label: 'LiveMint Markets',     categories: ['india','relevant'] },
    { url: 'https://www.livemint.com/rss/economy',                             label: 'LiveMint Economy',     categories: ['india','macro'] },
    { url: 'https://feeds.feedburner.com/ndtvprofit-latest',                   label: 'NDTV Profit',          categories: ['india','relevant'] },
  ],
  global: [
    { url: 'https://feeds.reuters.com/reuters/businessNews',                   label: 'Reuters Business',     categories: ['markets','relevant'] },
    { url: 'https://feeds.reuters.com/reuters/topNews',                        label: 'Reuters World',        categories: ['geopolitics','markets'] },
    { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',                   label: 'MarketWatch',          categories: ['markets','relevant'] },
    { url: 'https://www.ft.com/?format=rss',                                  label: 'Financial Times',      categories: ['markets','macro'] },
    { url: 'https://feeds.bloomberg.com/markets/news.rss',                    label: 'Bloomberg Markets',    categories: ['markets','macro'] },
  ],
  macro: [
    { url: 'https://feeds.reuters.com/reuters/economyNews',                    label: 'Reuters Economy',      categories: ['macro'] },
  ],
  geo: [
    { url: 'https://feeds.reuters.com/reuters/worldNews',                      label: 'Reuters World News',   categories: ['geopolitics'] },
    { url: 'https://feeds.reuters.com/reuters/politicsNews',                   label: 'Reuters Politics',     categories: ['geopolitics'] },
  ],
}

// ── Finnhub news ──────────────────────────────────────────────────────────────
async function fetchFinnhubCategory(category: string): Promise<FeedItem[]> {
  if (!process.env.FINNHUB_API_KEY) return []
  try {
    const res  = await fetch(
      `https://finnhub.io/api/v1/news?category=${category}&token=${process.env.FINNHUB_API_KEY}`,
      { signal: AbortSignal.timeout(8000), next: { revalidate: 0 } }
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

async function fetchFinnhubCompanyNews(symbol: string): Promise<FeedItem[]> {
  if (!process.env.FINNHUB_API_KEY) return []
  const to   = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10)
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`,
      { signal: AbortSignal.timeout(6000), next: { revalidate: 0 } }
    )
    if (!res.ok) return []
    const data = await res.json()
    return (Array.isArray(data) ? data : []).slice(0, 5).map((item: any, i: number): FeedItem => ({
      id:             `fh-co-${symbol}-${item.id ?? i}`,
      headline:       item.headline ?? '',
      source:         item.source   ?? 'Finnhub',
      url:            item.url      ?? '',
      datetime:       item.datetime ?? Math.floor(Date.now() / 1000),
      summary:        (item.summary ?? '').slice(0, 300),
      category:       'relevant',
      sentiment:      guessSentiment((item.headline ?? '') + ' ' + (item.summary ?? '')),
      relatedSymbols: [symbol],
      relevanceScore: 20,
      isIndian:       false,
    }))
  } catch { return [] }
}

// ── NewsAPI ───────────────────────────────────────────────────────────────────
async function fetchNewsAPI(query: string, category: FeedCategory, watchlist: string[]): Promise<FeedItem[]> {
  if (!process.env.NEWS_API_KEY) return []
  try {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const url  = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=30&from=${from}&apiKey=${process.env.NEWS_API_KEY}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000), next: { revalidate: 0 } })
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
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), next: { revalidate: 0 } })
    if (!res.ok) return []
    const data = await res.json()
    const feed: any[] = data.feed ?? []
    return feed.slice(0, 20).map((item: any, i: number): FeedItem => {
      const ts   = (() => {
        try { const d = item.time_published; return Math.floor(new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}T${d.slice(9,11)}:${d.slice(11,13)}:${d.slice(13,15)}`).getTime() / 1000) } catch { return Math.floor(Date.now()/1000) }
      })()
      const text = item.title + ' ' + (item.summary ?? '')
      const { score, matched } = scoreRelevance(text, watchlist)
      const avSentiment = item.overall_sentiment_label?.toLowerCase() ?? ''
      const sentiment: 'bullish'|'bearish'|'neutral' =
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

// ── NewsAPI queries per category ──────────────────────────────────────────────
const CATEGORY_NEWSAPI_QUERIES: Record<FeedCategory, string> = {
  relevant:    '',  // built dynamically from watchlist
  markets:     'stock market OR Wall Street OR S&P 500 OR earnings OR "Federal Reserve" OR equities',
  macro:       'inflation OR "interest rates" OR "Federal Reserve" OR GDP OR "central bank" OR CPI OR recession OR "RBI" OR "ECB" OR "rate decision"',
  geopolitics: 'geopolitics OR sanctions OR "trade war" OR tariffs OR Ukraine OR China OR "Middle East" OR OPEC OR tensions OR conflict',
  india:       'India stocks OR NIFTY OR Sensex OR RBI OR "NSE India" OR "BSE India" OR "Indian economy" OR "Indian markets" OR "Dalal Street"',
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const category = (searchParams.get('category') ?? 'markets') as FeedCategory
  const watchlistParam = searchParams.get('watchlist') ?? ''
  const watchlist = watchlistParam ? watchlistParam.split(',').filter(Boolean) : []

  const cacheKey = `feed:${category}:${watchlist.slice(0, 5).join(',')}`
  const cached   = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json({ items: cached.data }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
    })
  }

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
    // Primary: Finnhub general + per-symbol company news for top watchlist stocks
    const [finnhubGeneral, newsApiRelevant] = await Promise.allSettled([
      fetchFinnhubCategory('general'),
      (() => {
        const q = watchlist.length > 0
          ? watchlist.slice(0, 8).join(' OR ') + ' OR stock market OR earnings OR Fed'
          : 'stock market OR earnings OR Federal Reserve OR inflation OR S&P 500'
        return fetchNewsAPI(q, 'relevant', watchlist)
      })(),
    ])
    if (finnhubGeneral.status === 'fulfilled') addItems(finnhubGeneral.value)
    if (newsApiRelevant.status === 'fulfilled') addItems(newsApiRelevant.value)

    // Company-specific news for top 5 US watchlist symbols
    const usSymbols = watchlist.filter(s => !s.endsWith('.NS') && !s.endsWith('.BO') && !s.startsWith('^')).slice(0, 5)
    const companyNewsResults = await Promise.allSettled(usSymbols.map(s => fetchFinnhubCompanyNews(s)))
    companyNewsResults.forEach(r => { if (r.status === 'fulfilled') addItems(r.value) })

    // Score everything with watchlist
    allItems.forEach(item => {
      const { score, matched } = scoreRelevance(item.headline + ' ' + item.summary, watchlist)
      item.relevanceScore = Math.max(item.relevanceScore, score)
      item.relatedSymbols = [...new Set([...item.relatedSymbols, ...matched])]
    })
  }

  else if (category === 'markets') {
    const [finnhubGeneral, finnhubMergers, newsApiMarkets, avNews, rssFeeds] = await Promise.allSettled([
      fetchFinnhubCategory('general'),
      fetchFinnhubCategory('merger'),
      fetchNewsAPI(CATEGORY_NEWSAPI_QUERIES.markets, 'markets', watchlist),
      fetchAlphaVantageNews('financial_markets,earnings,ipo', watchlist),
      Promise.all([
        fetchRSS(RSS_SOURCES.global[0].url, RSS_SOURCES.global[0].label, 6000),  // Reuters Business
        fetchRSS(RSS_SOURCES.global[2].url, RSS_SOURCES.global[2].label, 6000),  // MarketWatch
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
      fetchNewsAPI(CATEGORY_NEWSAPI_QUERIES.macro, 'macro', watchlist),
      fetchAlphaVantageNews('economy_fiscal,economy_monetary,economy_macro', watchlist),
      fetchRSS(RSS_SOURCES.macro[0].url, RSS_SOURCES.macro[0].label, 6000),
      fetchRSS(RSS_SOURCES.india[1].url, RSS_SOURCES.india[1].label, 6000),  // ET Market Outlook
    ])
    if (newsApiMacro.status === 'fulfilled') addItems(newsApiMacro.value)
    if (avMacro.status      === 'fulfilled') addItems(avMacro.value)
    if (rssMacro.status     === 'fulfilled') rssMacro.value.forEach((it, i) => addItems([rssToFeedItem(it, 'macro', watchlist, i)]))
    if (rssEconomy.status   === 'fulfilled') rssEconomy.value.forEach((it, i) => addItems([rssToFeedItem(it, 'macro', watchlist, i)]))
  }

  else if (category === 'geopolitics') {
    const [newsApiGeo, rssWorld, rssPolitics] = await Promise.allSettled([
      fetchNewsAPI(CATEGORY_NEWSAPI_QUERIES.geopolitics, 'geopolitics', watchlist),
      fetchRSS(RSS_SOURCES.geo[0].url, RSS_SOURCES.geo[0].label, 6000),
      fetchRSS(RSS_SOURCES.geo[1].url, RSS_SOURCES.geo[1].label, 6000),
    ])
    if (newsApiGeo.status   === 'fulfilled') addItems(newsApiGeo.value)
    if (rssWorld.status     === 'fulfilled') rssWorld.value.forEach((it, i) => addItems([rssToFeedItem(it, 'geopolitics', watchlist, i)]))
    if (rssPolitics.status  === 'fulfilled') rssPolitics.value.forEach((it, i) => addItems([rssToFeedItem(it, 'geopolitics', watchlist, i)]))

    // Tag geo items
    allItems.forEach(item => { item.category = 'geopolitics' })
  }

  else if (category === 'india') {
    // Fetch all Indian RSS sources in parallel
    const indiaSources = RSS_SOURCES.india
    const rssResults = await Promise.allSettled(
      indiaSources.map(s => fetchRSS(s.url, s.label, 8000))
    )
    rssResults.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        r.value.forEach((item, j) => addItems([rssToFeedItem(item, 'india', watchlist, i * 50 + j)]))
      }
    })

    // Supplement with NewsAPI India
    const newsApiIndia = await fetchNewsAPI(CATEGORY_NEWSAPI_QUERIES.india, 'india', watchlist).catch(() => [])
    addItems(newsApiIndia)

    // Finnhub company news for Indian watchlist stocks
    const indiaSymbols = watchlist.filter(s => s.endsWith('.NS') || s.endsWith('.BO')).slice(0, 4)
    if (indiaSymbols.length > 0) {
      const indiaCompanyNews = await Promise.allSettled(
        indiaSymbols.map(s => fetchFinnhubCompanyNews(s.replace('.NS','').replace('.BO','')))
      )
      indiaCompanyNews.forEach(r => { if (r.status === 'fulfilled') addItems(r.value) })
    }

    // Ensure all are tagged as india
    allItems.forEach(item => { item.isIndian = true; item.category = 'india' })
  }

  // ── Deduplicate, sort, limit ───────────────────────────────────────────────
  const sorted = allItems
    .filter(item => item.headline?.length > 5)
    .sort((a, b) => {
      // Sort by recency for non-relevant, by relevance+recency for relevant
      if (category === 'relevant') {
        const diff = b.relevanceScore - a.relevanceScore
        if (Math.abs(diff) > 3) return diff
      }
      return b.datetime - a.datetime
    })
    .slice(0, 50)

  const ttl = category === 'relevant' ? 60_000 : 120_000
  cache.set(cacheKey, { data: sorted, expires: Date.now() + ttl })

  return NextResponse.json({ items: sorted, count: sorted.length, category, fetchedAt: new Date().toISOString() }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
  })
}