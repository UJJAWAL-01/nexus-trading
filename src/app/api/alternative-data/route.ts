// src/app/api/alternative-data/route.ts
// Alternative-data viewer for a given ticker. All sources are free / no API key.
// Sources fetched in parallel with per-source error isolation:
//   • Wikipedia REST  — page-views, daily, last 90 days
//   • Reddit search   — mentions per day, last 30 days, naive sentiment
//   • Hacker News     — story mentions per day, last 30 days (Algolia API)
//
// Why not Google Trends? The unofficial widget endpoint returns 429 from most
// serverless IPs (Vercel/AWS pools are aggressively rate-limited by Google).
// HN Algolia is free, no auth, and reliably available — better signal for tech
// tickers, honest "low activity" signal for non-tech.

import { NextRequest, NextResponse } from 'next/server'

const dev = process.env.NODE_ENV !== 'production'
const SIX_HOURS = 6 * 3600_000
const UA = 'NEXUS-Trading/1.0 (contact@nexustrading.app)'

// ── Caches ────────────────────────────────────────────────────────────────────
const wikiCache    = new Map<string, { data: WikiSeries  | null; expires: number }>()
const redditCache  = new Map<string, { data: RedditSeries | null; expires: number }>()
const hnCache      = new Map<string, { data: HNSeries    | null;  expires: number }>()
const tickerNames  = new Map<string, { name: string;              expires: number }>()

// ── Types ─────────────────────────────────────────────────────────────────────
export interface WikiSeries   { dates: string[]; views: number[]; article: string }
export interface RedditSeries { dates: string[]; mentions: number[]; sentiment: number[]; totalPosts: number }
export interface HNSeries     { dates: string[]; mentions: number[]; topStory: { title: string; url: string; points: number; date: string } | null }

interface AltDataResponse {
  ticker:      string
  companyName: string | null
  lastUpdated: string
  sources: {
    wikipedia:  WikiSeries   | null
    reddit:     RedditSeries | null
    hackerNews: HNSeries     | null
  }
  errors: {
    wikipedia?:  string
    reddit?:     string
    hackerNews?: string
  }
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function ymd(d: Date): string { return d.toISOString().slice(0, 10) }
function ymdCompact(d: Date): string { return ymd(d).replace(/-/g, '') }
function daysAgoUTC(n: number): Date {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d
}
function unixSecondsAgo(n: number): number {
  return Math.floor(Date.now() / 1000) - n * 86400
}

// ── Resolve company name for the ticker ───────────────────────────────────────
async function resolveCompanyName(ticker: string): Promise<string | null> {
  const upper = ticker.toUpperCase()
  const hit = tickerNames.get(upper)
  if (hit && hit.expires > Date.now()) return hit.name

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(upper)}&quotesCount=1&newsCount=0`
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept':     'application/json',
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const json = await res.json()
    const name = json?.quotes?.[0]?.longname ?? json?.quotes?.[0]?.shortname ?? null
    if (name) tickerNames.set(upper, { name, expires: Date.now() + 24 * 3600_000 })
    return name
  } catch {
    return null
  }
}

// ── Wikipedia article resolution (multi-strategy) ─────────────────────────────
function cleanName(name: string): string {
  return name
    .replace(/\bSPDR\b/gi, 'SPDR')                // keep canonical casing
    .replace(/\b(Trust|Inc|Inc\.|Corp|Corporation|Co|Company|Ltd|Limited|Holdings|Group|PLC|N\.V\.|S\.A\.)\b/g, '')
    .replace(/\s+T$/i, ' Trust')                  // Yahoo truncates "Trust" → "T" sometimes
    .replace(/\s{2,}/g, ' ')
    .trim()
}

async function tryWikiSearch(query: string): Promise<string | null> {
  try {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=3&search=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal:  AbortSignal.timeout(7_000),
    })
    if (!res.ok) return null
    const json = await res.json() as [string, string[], string[], string[]]
    const titles = json?.[1] ?? []
    return titles[0] ? titles[0].replace(/\s+/g, '_') : null
  } catch {
    return null
  }
}

async function findWikiArticle(ticker: string, companyName: string | null): Promise<string | null> {
  const cleaned = companyName ? cleanName(companyName) : null
  const looksLikeETF = cleaned ? /\b(ETF|ETN|Fund)\b/i.test(cleaned) : false

  const candidates: string[] = []
  if (cleaned)      candidates.push(cleaned)
  if (cleaned)      candidates.push(`${cleaned} (company)`)
  if (looksLikeETF) candidates.push(`${ticker} (ETF)`)
  candidates.push(`${ticker} (stock)`)
  candidates.push(ticker)
  // Last resort: drop trailing words from the name one at a time
  if (cleaned) {
    const words = cleaned.split(' ')
    for (let cut = 1; cut < words.length && cut < 3; cut++) {
      candidates.push(words.slice(0, words.length - cut).join(' '))
    }
  }

  for (const q of candidates) {
    const found = await tryWikiSearch(q)
    if (found) return found
  }
  return null
}

// ── Wikipedia page-views (90 days) ────────────────────────────────────────────
async function fetchWikipedia(ticker: string, companyName: string | null): Promise<WikiSeries | { error: string }> {
  const cacheKey = `w:${ticker}`
  const hit = wikiCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.data ?? { error: 'cached miss' }

  const article = await findWikiArticle(ticker, companyName)
  if (!article) {
    wikiCache.set(cacheKey, { data: null, expires: Date.now() + SIX_HOURS })
    return { error: `No Wikipedia article matched ticker or "${companyName ?? ticker}"` }
  }

  const start = ymdCompact(daysAgoUTC(91))
  const end   = ymdCompact(daysAgoUTC(1))
  try {
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article)}/daily/${start}/${end}`
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      wikiCache.set(cacheKey, { data: null, expires: Date.now() + SIX_HOURS })
      return { error: `Wikipedia ${res.status}` }
    }
    const json = await res.json() as { items?: { timestamp: string; views: number }[] }
    const items = json.items ?? []
    const dates: string[] = []
    const views: number[] = []
    for (const it of items) {
      const t = it.timestamp
      dates.push(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`)
      views.push(it.views)
    }
    if (dates.length === 0) {
      wikiCache.set(cacheKey, { data: null, expires: Date.now() + SIX_HOURS })
      return { error: 'Wikipedia returned no data points' }
    }
    const data: WikiSeries = { dates, views, article: article.replace(/_/g, ' ') }
    wikiCache.set(cacheKey, { data, expires: Date.now() + SIX_HOURS })
    return data
  } catch (err) {
    dev && console.error('[altdata] wikipedia error:', err)
    return { error: 'Wikipedia fetch failed' }
  }
}

// ── Reddit mentions + naive sentiment (30 days, multi-source) ─────────────────
const BULL_KW = /\b(bull|bullish|moon|long|calls?|buy|rally|breakout|rocket|🚀|tendies|squeeze|gains?)\b/i
const BEAR_KW = /\b(bear|bearish|crash|short|puts?|sell|dump|tank|drill|drop|losses?|🐻)\b/i

interface RedditPost { id: string; title: string; created_utc: number }

async function redditSearch(url: string): Promise<RedditPost[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) return []
    const json = await res.json() as { data?: { children?: { data?: RedditPost }[] } }
    const posts = json?.data?.children ?? []
    return posts.map(p => p.data).filter((d): d is RedditPost => !!d?.id && !!d?.created_utc)
  } catch {
    return []
  }
}

async function fetchReddit(ticker: string, companyName: string | null): Promise<RedditSeries | { error: string }> {
  const cacheKey = `r:${ticker}`
  const hit = redditCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.data ?? { error: 'cached miss' }

  const upper = ticker.toUpperCase()
  // Mix sort=top (popular across the month, gives day-spread coverage)
  // with sort=new (latest activity) and target the high-signal subreddits.
  const queries: string[] = [
    `https://www.reddit.com/search.json?q=${encodeURIComponent(`$${upper}`)}&sort=top&t=month&limit=100&type=link`,
    `https://www.reddit.com/search.json?q=${encodeURIComponent(`$${upper}`)}&sort=new&t=month&limit=100&type=link`,
    `https://www.reddit.com/r/wallstreetbets/search.json?q=${encodeURIComponent(upper)}&restrict_sr=1&sort=top&t=month&limit=100`,
    `https://www.reddit.com/r/stocks/search.json?q=${encodeURIComponent(upper)}&restrict_sr=1&sort=top&t=month&limit=100`,
    `https://www.reddit.com/r/investing/search.json?q=${encodeURIComponent(upper)}&restrict_sr=1&sort=top&t=month&limit=100`,
  ]
  if (companyName) {
    queries.push(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(`"${companyName}"`)}&sort=top&t=month&limit=100&type=link`,
    )
  }

  const results = await Promise.all(queries.map(redditSearch))
  const seen = new Map<string, RedditPost>()
  for (const arr of results) for (const p of arr) seen.set(p.id, p)

  if (seen.size === 0) {
    redditCache.set(cacheKey, { data: null, expires: Date.now() + 30 * 60_000 })
    return { error: 'No Reddit posts found (all queries empty or rate-limited)' }
  }

  // Bucket into the last 30 days
  const buckets = new Map<string, { count: number; bull: number; bear: number }>()
  for (let i = 0; i < 30; i++) {
    buckets.set(ymd(daysAgoUTC(i)), { count: 0, bull: 0, bear: 0 })
  }

  let totalPosts = 0
  for (const post of seen.values()) {
    const day = ymd(new Date(post.created_utc * 1000))
    const b = buckets.get(day)
    if (!b) continue
    totalPosts++
    b.count++
    if (BULL_KW.test(post.title)) b.bull++
    if (BEAR_KW.test(post.title)) b.bear++
  }

  const dates    = [...buckets.keys()].sort()
  const mentions = dates.map(d => buckets.get(d)!.count)
  const sentiment = dates.map(d => {
    const b = buckets.get(d)!
    if (b.count === 0) return 0
    return Math.round(((b.bull - b.bear) / b.count) * 100)
  })

  const data: RedditSeries = { dates, mentions, sentiment, totalPosts }
  redditCache.set(cacheKey, { data, expires: Date.now() + SIX_HOURS })
  return data
}

// ── Hacker News mentions (30 days, Algolia API) ───────────────────────────────
interface HNHit {
  objectID:      string
  title:         string | null
  url:           string | null
  story_text:    string | null
  points:        number | null
  num_comments:  number | null
  created_at_i:  number
}

async function fetchHackerNews(ticker: string, companyName: string | null): Promise<HNSeries | { error: string }> {
  const cacheKey = `hn:${ticker}`
  const hit = hnCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.data ?? { error: 'cached miss' }

  const upper  = ticker.toUpperCase()
  const since  = unixSecondsAgo(30)
  const queries = [upper]
  if (companyName) queries.push(`"${companyName}"`)

  const seen = new Map<string, HNHit>()

  for (const q of queries) {
    try {
      const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=200&numericFilters=created_at_i>${since}`
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal:  AbortSignal.timeout(10_000),
      })
      if (!res.ok) continue
      const json = await res.json() as { hits?: HNHit[] }
      for (const h of (json.hits ?? [])) {
        if (!h.objectID || !h.created_at_i) continue
        // Filter: title or story text must contain the ticker token to avoid
        // false positives ("apple" matches Apple Inc but also fruit recipes —
        // require the exact uppercase token or a $-prefixed mention).
        const text = `${h.title ?? ''} ${h.story_text ?? ''}`
        const tickerRe = new RegExp(`(?:^|[^A-Z])\\$?${upper}(?:[^A-Z]|$)`)
        const nameRe   = companyName ? new RegExp(`\\b${companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null
        if (!tickerRe.test(text) && !(nameRe && nameRe.test(text))) continue
        seen.set(h.objectID, h)
      }
    } catch (err) {
      dev && console.error('[altdata] hn error:', err)
    }
  }

  // Bucket per day
  const buckets = new Map<string, number>()
  for (let i = 0; i < 30; i++) buckets.set(ymd(daysAgoUTC(i)), 0)

  let topStory: HNHit | null = null
  for (const h of seen.values()) {
    const day = ymd(new Date(h.created_at_i * 1000))
    if (!buckets.has(day)) continue
    buckets.set(day, (buckets.get(day) ?? 0) + 1)
    if (!topStory || (h.points ?? 0) > (topStory.points ?? 0)) topStory = h
  }

  const dates    = [...buckets.keys()].sort()
  const mentions = dates.map(d => buckets.get(d) ?? 0)

  const data: HNSeries = {
    dates,
    mentions,
    topStory: topStory ? {
      title:  topStory.title ?? '(no title)',
      url:    topStory.url   ?? `https://news.ycombinator.com/item?id=${topStory.objectID}`,
      points: topStory.points ?? 0,
      date:   ymd(new Date(topStory.created_at_i * 1000)),
    } : null,
  }
  hnCache.set(cacheKey, { data, expires: Date.now() + SIX_HOURS })
  return data
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tickerRaw = searchParams.get('ticker')?.trim()
  if (!tickerRaw) {
    return NextResponse.json({ error: 'ticker required' }, { status: 400 })
  }
  const ticker = tickerRaw.toUpperCase()

  const sourcesParam = (searchParams.get('sources') ?? 'wikipedia,reddit,hackernews')
    .toLowerCase().split(',').map(s => s.trim())

  const wantWiki   = sourcesParam.includes('wikipedia')
  const wantReddit = sourcesParam.includes('reddit')
  const wantHN     = sourcesParam.includes('hackernews') || sourcesParam.includes('hn')

  const companyName = await resolveCompanyName(ticker)

  const [wikiRes, redditRes, hnRes] = await Promise.all([
    wantWiki   ? fetchWikipedia(ticker, companyName)  : Promise.resolve(null),
    wantReddit ? fetchReddit(ticker, companyName)     : Promise.resolve(null),
    wantHN     ? fetchHackerNews(ticker, companyName) : Promise.resolve(null),
  ])

  const errors: AltDataResponse['errors'] = {}
  const sources: AltDataResponse['sources'] = {
    wikipedia:  null,
    reddit:     null,
    hackerNews: null,
  }

  if (wikiRes   && 'error' in wikiRes)   errors.wikipedia  = wikiRes.error
  else if (wikiRes)                      sources.wikipedia = wikiRes

  if (redditRes && 'error' in redditRes) errors.reddit     = redditRes.error
  else if (redditRes)                    sources.reddit    = redditRes

  if (hnRes     && 'error' in hnRes)     errors.hackerNews = hnRes.error
  else if (hnRes)                        sources.hackerNews = hnRes

  const payload: AltDataResponse = {
    ticker,
    companyName,
    lastUpdated: new Date().toISOString(),
    sources,
    errors,
  }

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=43200' },
  })
}
