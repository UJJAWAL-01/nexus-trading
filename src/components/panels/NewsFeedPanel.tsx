'use client'

import { useEffect, useState, useRef } from 'react'
import { useWatchlist } from '@/store/watchlist'

interface NewsItem {
  id:             string
  headline:       string
  source:         string
  url:            string
  datetime:       number
  summary:        string
  relevanceScore: number
  aiContext:      string | null
  loadingAI:      boolean
  sentiment:      'bullish' | 'bearish' | 'neutral'
  relatedSymbols: string[]
}

// Score how relevant a headline is to the watchlist
function scoreRelevance(text: string, symbols: string[]): { score: number; matched: string[] } {
  const t       = text.toLowerCase()
  const matched: string[] = []
  let score     = 0

  for (const sym of symbols) {
    // Direct ticker mention
    if (t.includes(sym.toLowerCase())) {
      score += 15
      matched.push(sym)
      continue
    }
    // Common company name mappings
    const nameMap: Record<string, string[]> = {
      AAPL: ['apple'], NVDA: ['nvidia'], TSLA: ['tesla'], MSFT: ['microsoft'],
      AMZN: ['amazon'], META: ['meta', 'facebook'], GOOGL: ['google', 'alphabet'],
      JPM: ['jpmorgan', 'jp morgan'], BAC: ['bank of america'],
      SPY: ['s&p', 'sp500', 's&p 500'], QQQ: ['nasdaq', 'qqq'],
    }
    const names = nameMap[sym] || []
    if (names.some(n => t.includes(n))) {
      score += 12
      matched.push(sym)
    }
  }

  // High-value market keywords
  const tier1 = ['fed', 'fomc', 'rate hike', 'rate cut', 'inflation', 'cpi', 'gdp', 'jobs report', 'nfp', 'recession', 'earnings', 'guidance']
  const tier2 = ['market', 'stock', 'equities', 'rally', 'selloff', 'bull', 'bear', 'volatility', 'tariff', 'trade war', 'geopolit']

  for (const kw of tier1) if (t.includes(kw)) score += 4
  for (const kw of tier2) if (t.includes(kw)) score += 2

  return { score, matched }
}

function guessSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const t    = text.toLowerCase()
  const bull = ['surge', 'soar', 'rally', 'gain', 'rise', 'jump', 'beat', 'record', 'profit', 'growth', 'strong', 'boost', 'upgrade', 'buy', 'outperform', 'upside', 'positive']
  const bear = ['crash', 'fall', 'drop', 'plunge', 'miss', 'loss', 'weak', 'cut', 'warn', 'fear', 'recession', 'down', 'slump', 'downgrade', 'sell', 'underperform', 'downside', 'negative', 'concern', 'risk']
  let b = 0, br = 0
  for (const w of bull) if (t.includes(w)) b++
  for (const w of bear) if (t.includes(w)) br++
  if (b > br + 1) return 'bullish'
  if (br > b + 1) return 'bearish'
  return 'neutral'
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

const sentimentStyle = (s: string) => ({
  color: s === 'bullish' ? 'var(--positive)' : s === 'bearish' ? 'var(--negative)' : 'var(--text-muted)',
  bg:    s === 'bullish' ? 'rgba(0,201,122,0.1)' : s === 'bearish' ? 'rgba(255,69,96,0.1)' : 'rgba(74,96,112,0.1)',
  border:s === 'bullish' ? 'rgba(0,201,122,0.25)' : s === 'bearish' ? 'rgba(255,69,96,0.25)' : 'rgba(74,96,112,0.25)',
})

export default function NewsFeedPanel() {
  const { symbols }                       = useWatchlist()
  const [news,        setNews]            = useState<NewsItem[]>([])
  const [loading,     setLoading]         = useState(true)
  const [filter,      setFilter]          = useState<'relevant' | 'all'>('relevant')
  const [aiQueue,     setAiQueue]         = useState<string[]>([])
  const prevNewsIds                        = useRef<Set<string>>(new Set())

  const fetchNews = async () => {
    try {
      // Ensure we always have a query - use default if watchlist is empty
      const defaultQuery = 'stock market earnings Fed inflation market news'
      const watchlistQuery = symbols.length > 0 
        ? symbols.join(' OR ') + ' OR stock market OR earnings OR Fed'
        : defaultQuery

      const [finnhubRes, newsApiRes] = await Promise.allSettled([
        fetch('/api/finnhub?endpoint=news&category=general'),
        fetch(`/api/news?q=${encodeURIComponent(watchlistQuery)}`),
      ])

      const items: NewsItem[] = []

      if (finnhubRes.status === 'fulfilled') {
        const data = await finnhubRes.value.json()
        if (Array.isArray(data)) {
          data.slice(0, 25).forEach((item: any) => {
            if (!item.headline || item.headline.length < 10) return
            const { score, matched } = scoreRelevance(item.headline + ' ' + (item.related || '') + ' ' + (item.summary || ''), symbols)
            items.push({
              id:             String(item.id || Math.random()),
              headline:       item.headline,
              source:         item.source || 'Finnhub',
              url:            item.url,
              datetime:       item.datetime,
              summary:        item.summary || '',
              relevanceScore: score,
              relatedSymbols: matched,
              aiContext:      null,
              loadingAI:      false,
              sentiment:      guessSentiment(item.headline + ' ' + (item.summary || '')),
            })
          })
        }
      }

      if (newsApiRes.status === 'fulfilled') {
        const data = await newsApiRes.value.json()
        if (Array.isArray(data.articles)) {
          data.articles.slice(0, 15).forEach((item: any, i: number) => {
            if (!item.title || item.title === '[Removed]') return
            const ts = Math.floor(new Date(item.publishedAt).getTime() / 1000)
            const { score, matched } = scoreRelevance(item.title + ' ' + (item.description || ''), symbols)
            items.push({
              id:             `na-${i}-${ts}`,
              headline:       item.title,
              source:         item.source?.name || 'NewsAPI',
              url:            item.url,
              datetime:       ts,
              summary:        item.description || '',
              relevanceScore: score,
              relatedSymbols: matched,
              aiContext:      null,
              loadingAI:      false,
              sentiment:      guessSentiment(item.title + ' ' + (item.description || '')),
            })
          })
        }
      }

      // Deduplicate by similar headlines
      const seen   = new Set<string>()
      const unique = items.filter(item => {
        const key = item.headline.slice(0, 40).toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      // Sort: relevant first, then by time
      const sorted = unique.sort((a, b) =>
        b.relevanceScore !== a.relevanceScore
          ? b.relevanceScore - a.relevanceScore
          : b.datetime - a.datetime
      )

      setNews(sorted.slice(0, 30))
      setLoading(false)

      // Queue AI context for top relevant items not yet processed
      const newIds = sorted
        .filter(i => i.relevanceScore > 5 && !prevNewsIds.current.has(i.id))
        .slice(0, 5)
        .map(i => i.id)

      newIds.forEach(id => prevNewsIds.current.add(id))
      if (newIds.length > 0) setAiQueue(newIds)

    } catch {
      setLoading(false)
    }
  }

  // Process AI queue one at a time to avoid hammering the API
  useEffect(() => {
    if (aiQueue.length === 0) return
    const [nextId, ...rest] = aiQueue

    const item = news.find(n => n.id === nextId)
    if (!item) { setAiQueue(rest); return }

    setNews(prev => prev.map(n => n.id === nextId ? { ...n, loadingAI: true } : n))

    fetch('/api/ai-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headline: item.headline, summary: item.summary, watchlist: symbols }),
    })
      .then(r => r.json())
      .then(data => {
        setNews(prev => prev.map(n => n.id === nextId
          ? { ...n, aiContext: data.context || null, loadingAI: false }
          : n
        ))
        setTimeout(() => setAiQueue(rest), 500)
      })
      .catch(() => {
        setNews(prev => prev.map(n => n.id === nextId ? { ...n, loadingAI: false } : n))
        setAiQueue(rest)
      })
  }, [aiQueue])

  useEffect(() => {
    fetchNews()
    const t = setInterval(fetchNews, 90_000)
    return () => clearInterval(t)
  }, [symbols])

  const displayed = filter === 'relevant'
    ? news.filter(n => n.relevanceScore > 0).slice(0, 20)
    : news.slice(0, 25)

  const relevantCount = news.filter(n => n.relevanceScore > 0).length
  
  // Show "all" filter if no relevant news found
  const showAll = relevantCount === 0 && filter === 'relevant' && news.length > 0

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: 'var(--amber)' }} />
          INTELLIGENCE FEED
          {!loading && (
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              {relevantCount} relevant
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['relevant', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
              letterSpacing: '0.06em', textTransform: 'uppercase',
              border: `1px solid ${filter === f ? 'var(--amber)' : 'var(--border)'}`,
              background: filter === f ? 'rgba(240,165,0,0.12)' : 'transparent',
              color: filter === f ? 'var(--amber)' : 'var(--text-muted)',
            }}>
              {f === 'relevant' ? '★ RELEVANT' : 'ALL'}
            </button>
          ))}
        </div>
      </div>

      {/* Feed */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
            LOADING FEEDS...
          </div>
        ) : (showAll ? news.slice(0, 25) : displayed).length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
            Fetching news...
          </div>
        ) : (showAll ? news.slice(0, 25) : displayed).map(item => {
          const ss = sentimentStyle(item.sentiment)
          return (
            <div
              key={item.id}
              onClick={() => item.url && window.open(item.url, '_blank')}
              style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border)',
                cursor: item.url ? 'pointer' : 'default',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {/* Row 1 — badges + source + time */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px', flexWrap: 'wrap' }}>

                {/* Sentiment badge */}
                <span style={{
                  fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
                  background: ss.bg, color: ss.color,
                  border: `1px solid ${ss.border}`,
                  fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                }}>
                  {item.sentiment}
                </span>

                {/* Watchlist match badges */}
                {item.relatedSymbols.slice(0, 3).map(sym => (
                  <span key={sym} style={{
                    fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
                    background: 'rgba(240,165,0,0.12)',
                    color: 'var(--amber)',
                    border: '1px solid rgba(240,165,0,0.25)',
                    fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em',
                    fontWeight: 700,
                  }}>
                    ★ {sym}
                  </span>
                ))}

                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: '2px' }}>
                  {item.source}
                </span>

                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>
                  {timeAgo(item.datetime)}
                </span>
              </div>

              {/* Row 2 — headline */}
              <div style={{
                fontSize: '12px', color: '#fff', lineHeight: 1.45,
                fontFamily: 'Syne, sans-serif', fontWeight: 600, marginBottom: '5px',
              }}>
                {item.headline}
              </div>

              {/* Row 3 — AI context */}
              {item.loadingAI && (
                <div style={{ fontSize: '10px', color: 'var(--teal)', fontFamily: 'JetBrains Mono, monospace', opacity: 0.6 }}>
                  ◆ analyzing...
                </div>
              )}
              {item.aiContext && (
                <div style={{
                  fontSize: '11px', color: 'var(--teal)',
                  fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5,
                  padding: '5px 10px',
                  background: 'rgba(0,229,192,0.04)',
                  borderLeft: '2px solid rgba(0,229,192,0.4)',
                  borderRadius: '0 3px 3px 0',
                }}>
                  ◆ {item.aiContext}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}