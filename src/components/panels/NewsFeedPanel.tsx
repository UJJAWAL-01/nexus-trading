'use client'

import { useEffect, useState } from 'react'
import { useWatchlist } from '@/store/watchlist'

interface NewsItem {
  id: string
  headline: string
  source: string
  url: string
  datetime: number
  summary: string
  related: string
  relevanceScore: number
  aiContext: string | null
  loadingAI: boolean
  sentiment: 'bullish' | 'bearish' | 'neutral'
}

function scoreRelevance(headline: string, symbols: string[]): number {
  const h = headline.toLowerCase()
  let score = 0
  for (const sym of symbols) {
    if (h.includes(sym.toLowerCase())) score += 10
  }
  const keywords = ['fed', 'rate', 'inflation', 'earnings', 'gdp', 'jobs', 'market', 'stock', 'trade', 'tariff', 'recession', 'rally', 'crash', 'bull', 'bear']
  for (const kw of keywords) {
    if (h.includes(kw)) score += 2
  }
  return score
}

function guessSentiment(headline: string): 'bullish' | 'bearish' | 'neutral' {
  const h = headline.toLowerCase()
  const bull = ['surge', 'rally', 'beat', 'record', 'gain', 'rise', 'jump', 'soar', 'up', 'profit', 'growth', 'strong', 'boost']
  const bear = ['crash', 'fall', 'drop', 'miss', 'loss', 'plunge', 'sink', 'weak', 'cut', 'warn', 'fear', 'recession', 'down', 'slump']
  let b = 0, br = 0
  for (const w of bull) if (h.includes(w)) b++
  for (const w of bear) if (h.includes(w)) br++
  if (b > br) return 'bullish'
  if (br > b) return 'bearish'
  return 'neutral'
}

export default function NewsFeedPanel() {
  const { symbols } = useWatchlist()
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'watchlist'>('watchlist')

  const fetchNews = async () => {
    try {
      // Fetch from multiple sources in parallel
      const [finnhubRes, newsApiRes] = await Promise.allSettled([
        fetch('/api/finnhub?endpoint=news&category=general'),
        fetch('/api/news?q=' + encodeURIComponent(
          symbols.slice(0, 4).join(' OR ') + ' OR stock market OR earnings OR Fed'
        ))
      ])

      const items: NewsItem[] = []

      if (finnhubRes.status === 'fulfilled') {
        const data = await finnhubRes.value.json()
        if (Array.isArray(data)) {
          data.slice(0, 20).forEach((item: any) => {
            items.push({
              id: String(item.id),
              headline: item.headline,
              source: item.source,
              url: item.url,
              datetime: item.datetime,
              summary: item.summary || '',
              related: item.related || '',
              relevanceScore: scoreRelevance(item.headline + ' ' + (item.related || ''), symbols),
              aiContext: null,
              loadingAI: false,
              sentiment: guessSentiment(item.headline),
            })
          })
        }
      }

      if (newsApiRes.status === 'fulfilled') {
        const data = await newsApiRes.value.json()
        if (data.articles) {
          data.articles.slice(0, 10).forEach((item: any, i: number) => {
            items.push({
              id: `newsapi-${i}`,
              headline: item.title,
              source: item.source?.name || 'NewsAPI',
              url: item.url,
              datetime: Math.floor(new Date(item.publishedAt).getTime() / 1000),
              summary: item.description || '',
              related: '',
              relevanceScore: scoreRelevance(item.title, symbols),
              aiContext: null,
              loadingAI: false,
              sentiment: guessSentiment(item.title),
            })
          })
        }
      }

      // Sort by relevance then time
      const sorted = items
        .filter(i => i.headline && i.headline.length > 10)
        .sort((a, b) => (b.relevanceScore - a.relevanceScore) || (b.datetime - a.datetime))

      setNews(sorted.slice(0, 25))
      setLoading(false)

      // Fetch AI context for top 5 most relevant
      sorted.slice(0, 5).forEach((item, idx) => {
        fetchAIContext(item.id, item.headline, item.summary, symbols)
      })
    } catch {
      setLoading(false)
    }
  }

  const fetchAIContext = async (id: string, headline: string, summary: string, watchlist: string[]) => {
    setNews(prev => prev.map(n => n.id === id ? { ...n, loadingAI: true } : n))
    try {
      const res = await fetch('/api/ai-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headline, summary, watchlist }),
      })
      const data = await res.json()
      setNews(prev => prev.map(n =>
        n.id === id ? { ...n, aiContext: data.context, loadingAI: false } : n
      ))
    } catch {
      setNews(prev => prev.map(n => n.id === id ? { ...n, loadingAI: false } : n))
    }
  }

  useEffect(() => {
    fetchNews()
    const t = setInterval(fetchNews, 60_000) // refresh every 2 min
    return () => clearInterval(t)
  }, [symbols])

  const displayed = filter === 'watchlist'
    ? news.filter(n => n.relevanceScore > 0 || news.indexOf(n) < 8)
    : news

  const sentimentColor = (s: string) =>
    s === 'bullish' ? 'var(--positive)' : s === 'bearish' ? 'var(--negative)' : 'var(--text-muted)'

  const timeAgo = (ts: number) => {
    const diff = Math.floor(Date.now() / 1000) - ts
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`
    return `${Math.floor(diff/3600)}h ago`
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: 'var(--amber)' }} />
          INTELLIGENCE FEED
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {(['watchlist', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              background: filter === f ? 'rgba(240,165,0,0.15)' : 'transparent',
              border: `1px solid ${filter === f ? 'var(--amber)' : 'var(--border)'}`,
              color: filter === f ? 'var(--amber)' : 'var(--text-muted)',
              borderRadius: '3px', padding: '1px 8px',
              fontSize: '10px', cursor: 'pointer', letterSpacing: '0.08em',
              textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace',
            }}>
              {f === 'watchlist' ? '★ RELEVANT' : 'ALL'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            LOADING FEEDS...
          </div>
        ) : displayed.map(item => (
          <div key={item.id} style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
            cursor: 'pointer',
          }}
          onClick={() => window.open(item.url, '_blank')}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
                  background: sentimentColor(item.sentiment) + '22',
                  color: sentimentColor(item.sentiment),
                  letterSpacing: '0.08em', fontFamily: 'JetBrains Mono, monospace',
                  textTransform: 'uppercase', border: `1px solid ${sentimentColor(item.sentiment)}44`,
                }}>
                  {item.sentiment}
                </span>
                {item.relevanceScore > 5 && (
                  <span style={{
                    fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
                    background: 'rgba(240,165,0,0.1)', color: 'var(--amber)',
                    border: '1px solid rgba(240,165,0,0.2)',
                    fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em',
                  }}>★ WATCHLIST</span>
                )}
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {item.source}
                </span>
              </div>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                {timeAgo(item.datetime)}
              </span>
            </div>

            {/* Headline */}
            <div style={{
              fontSize: '12px', color: '#fff', lineHeight: 1.4,
              fontFamily: 'Syne, sans-serif', fontWeight: 600,
              marginBottom: '6px',
            }}>
              {item.headline}
            </div>

            {/* AI Context */}
            {item.loadingAI && (
              <div style={{
                fontSize: '11px', color: 'var(--teal)',
                fontFamily: 'JetBrains Mono, monospace',
                opacity: 0.6, fontStyle: 'italic',
              }}>
                ◆ analyzing...
              </div>
            )}
            {item.aiContext && (
              <div style={{
                fontSize: '11px', color: 'var(--teal)',
                fontFamily: 'JetBrains Mono, monospace',
                lineHeight: 1.5,
                borderLeft: '2px solid var(--teal)',
                paddingLeft: '8px',
                background: 'rgba(0,229,192,0.04)',
                padding: '4px 8px',
                borderRadius: '0 3px 3px 0',
              }}>
                ◆ {item.aiContext}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}