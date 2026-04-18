'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'
import type { FeedCategory, FeedItem } from '@/app/api/news-feed/route'

// ── Re-export types locally to avoid import issues ────────────────────────────
type SentimentType = 'bullish' | 'bearish' | 'neutral'

// ── Legacy news item format (from /api/finnhub + /api/news) ──────────────────
interface LegacyNewsItem {
  id:             string
  headline:       string
  source:         string
  url:            string
  datetime:       number
  summary:        string
  relevanceScore: number
  aiContext:      string | null
  loadingAI:      boolean
  sentiment:      SentimentType
  relatedSymbols: string[]
}

// ── Tab definitions ───────────────────────────────────────────────────────────
type TabId = 'relevant' | 'markets' | 'macro' | 'india'

interface TabDef {
  id:     TabId
  label:  string
  icon:   string
  color:  string
  desc:   string
}

const TABS: TabDef[] = [
  { id:'relevant',    label:'RELEVANT',    icon:'★', color:'var(--amber)',   desc:'Watchlist-matched news' },
  { id:'markets',     label:'MARKETS',     icon:'', color:'var(--teal)',   desc:'US & global markets' },
  { id:'macro',       label:'MACRO',       icon:'🏦', color:'#a78bfa',      desc:'Fed, RBI, economy, rates' },
  // { id:'geopolitics', label:'GEO',         icon:'🌐', color:'#1e90ff',      desc:'Geopolitics & global events' },
  { id:'india',       label:'INDIA',       icon:'🇮🇳', color:'#f97316',    desc:'NSE, BSE, Indian economy' },
]

// ── Score relevance client-side for legacy items ──────────────────────────────
function scoreRelevance(text: string, symbols: string[]): { score: number; matched: string[] } {
  const t       = text.toLowerCase()
  const matched: string[] = []
  let score     = 0
  for (const sym of symbols) {
    if (t.includes(sym.toLowerCase())) { score += 15; matched.push(sym); continue }
    const nameMap: Record<string, string[]> = {
      AAPL:['apple'], NVDA:['nvidia'], TSLA:['tesla'], MSFT:['microsoft'],
      AMZN:['amazon'], META:['meta','facebook'], GOOGL:['google','alphabet'],
      JPM:['jpmorgan','jp morgan'], BAC:['bank of america'],
      SPY:['s&p','sp500'], QQQ:['nasdaq'], RELIANCE:['reliance'], TCS:['tata consultancy'],
    }
    const names = nameMap[sym] ?? []
    if (names.some(n => t.includes(n))) { score += 12; matched.push(sym) }
  }
  const tier1 = ['fed','fomc','rate hike','rate cut','inflation','cpi','gdp','jobs report','nfp','recession','earnings','guidance','rbi','sebi','nifty','sensex']
  const tier2 = ['market','stock','equities','rally','selloff','bull','bear','volatility','tariff','trade war','geopolit']
  tier1.forEach(k => { if (t.includes(k)) score += 4 })
  tier2.forEach(k => { if (t.includes(k)) score += 2 })
  return { score, matched }
}

function guessSentiment(text: string): SentimentType {
  const t    = text.toLowerCase()
  const bull = ['surge','soar','rally','gain','rise','jump','beat','record','profit','growth','strong','boost','upgrade','buy','outperform','upside','positive']
  const bear = ['crash','fall','drop','plunge','miss','loss','weak','cut','warn','fear','recession','down','slump','downgrade','sell','underperform','downside','negative','concern','risk']
  let b = 0, br = 0
  bull.forEach(w => { if (t.includes(w)) b++ })
  bear.forEach(w => { if (t.includes(w)) br++ })
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

const sentimentStyle = (s: SentimentType) => ({
  color:  s === 'bullish' ? 'var(--positive)' : s === 'bearish' ? 'var(--negative)' : 'var(--text-muted)',
  bg:     s === 'bullish' ? 'rgba(0,201,122,0.1)' : s === 'bearish' ? 'rgba(255,69,96,0.1)' : 'rgba(74,96,112,0.1)',
  border: s === 'bullish' ? 'rgba(0,201,122,0.25)' : s === 'bearish' ? 'rgba(255,69,96,0.25)' : 'rgba(74,96,112,0.25)',
})

// ── News item display component (shared between tabs) ─────────────────────────
function NewsItem({
  item, onAILoad, showAI,
}: {
  item: FeedItem
  onAILoad?: (id: string) => void
  showAI?: boolean
}) {
  const ss = sentimentStyle(item.sentiment as SentimentType)
  const tab = TABS.find(t => t.id === item.category)

  return (
    <div
      onClick={() => item.url && window.open(item.url, '_blank')}
      style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--border)',
        cursor: item.url ? 'pointer' : 'default',
        transition: 'background 0.1s',
        borderLeft: item.isIndian ? '2px solid rgba(249,115,22,0.4)' : '2px solid transparent',
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      {/* Row 1 — badges + source + time */}
      <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'5px', flexWrap:'wrap' }}>
        {/* Sentiment badge */}
        <span style={{
          fontSize:'11px', padding:'1px 6px', borderRadius:'2px',
          background: ss.bg, color: ss.color, border:`1px solid ${ss.border}`,
          fontFamily:'JetBrains Mono,monospace', letterSpacing:'0.08em', textTransform:'uppercase',
          fontWeight: 700,
        }}>
          {item.sentiment}
        </span>

        {/* India badge */}
        {item.isIndian && (
          <span style={{
            fontSize:'11px', padding:'1px 5px', borderRadius:'2px',
            background:'rgba(249,115,22,0.1)', color:'#f97316',
            border:'1px solid rgba(249,115,22,0.25)',
            fontFamily:'JetBrains Mono,monospace',
          }}>🇮🇳</span>
        )}

        {/* Related symbol badges */}
        {item.relatedSymbols.slice(0, 3).map(sym => (
          <span key={sym} style={{
            fontSize:'11px', padding:'1px 6px', borderRadius:'2px',
            background:'rgba(240,165,0,0.12)', color:'var(--amber)',
            border:'1px solid rgba(240,165,0,0.25)',
            fontFamily:'JetBrains Mono,monospace', letterSpacing:'0.06em', fontWeight:700,
          }}>
            ★ {sym.replace('.NS','').replace('.BO','')}
          </span>
        ))}

        <span style={{ fontSize:'10px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginLeft:'2px' }}>
          {item.source}
        </span>
        <span style={{ fontSize:'10px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace', marginLeft:'auto' }}>
          {timeAgo(item.datetime)}
        </span>
      </div>

      {/* Row 2 — headline */}
      <div style={{
        fontSize:'13px', color:'#fff', lineHeight:1.45,
        fontFamily:'Syne,sans-serif', fontWeight:600, marginBottom:'4px',
      }}>
        {item.headline}
      </div>

      {/* Row 3 — summary snippet */}
      {item.summary && (
        <div style={{
          fontSize:'11px', color:'var(--text-muted)', lineHeight:1.5,
          fontFamily:'JetBrains Mono,monospace',
        }}>
          {item.summary.slice(0, 140)}{item.summary.length > 140 ? '…' : ''}
        </div>
      )}
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────
export default function NewsFeedPanel() {
  const { symbols } = useWatchlist()

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('relevant')

  // Per-tab data
  const [tabData,    setTabData]    = useState<Record<TabId, FeedItem[]>>({
    relevant: [], markets: [], macro: [], india: [],
  })
  const [tabLoading, setTabLoading] = useState<Record<TabId, boolean>>({
    relevant: true, markets: false, macro: false, india: false,
  })
  const [tabError, setTabError] = useState<Record<TabId, string>>({
    relevant: '', markets: '', macro: '', india: '',
  })

  // Legacy relevant items with AI context (existing functionality)
  const [aiQueue,   setAiQueue]   = useState<string[]>([])
  const [aiItems,   setAiItems]   = useState<Map<string, { context: string|null; loading: boolean }>>(new Map())
  const prevNewsIds = useRef<Set<string>>(new Set())
  const loadedTabs  = useRef<Set<TabId>>(new Set())

  // ── Fetch a specific tab ──────────────────────────────────────────────────
  const fetchTab = useCallback(async (tab: TabId, force = false) => {
    if (!force && loadedTabs.current.has(tab)) return
    loadedTabs.current.add(tab)

    setTabLoading(prev => ({ ...prev, [tab]: true }))
    setTabError(prev => ({ ...prev, [tab]: '' }))

    try {
      const watchlistParam = symbols.slice(0, 20).join(',')
      const res  = await fetch(`/api/news-feed?category=${tab}&watchlist=${encodeURIComponent(watchlistParam)}`)
      const data = await res.json()
      const items: FeedItem[] = data.items ?? []

      setTabData(prev => ({ ...prev, [tab]: items }))

      // Queue AI context for top relevant items
      if (tab === 'relevant') {
        const newIds = items
          .filter(i => i.relevanceScore > 5 && !prevNewsIds.current.has(i.id))
          .slice(0, 5)
          .map(i => i.id)
        newIds.forEach(id => prevNewsIds.current.add(id))
        if (newIds.length > 0) setAiQueue(q => [...q, ...newIds])
      }
    } catch (e: any) {
      setTabError(prev => ({ ...prev, [tab]: e?.message ?? 'Failed to load' }))
    } finally {
      setTabLoading(prev => ({ ...prev, [tab]: false }))
    }
  }, [symbols])

  // Initial load — relevant tab
  useEffect(() => {
    loadedTabs.current.clear()  // Reset when watchlist changes
    fetchTab('relevant', true)
  }, [symbols.join(',')])

  // Load tab on switch
  useEffect(() => {
    fetchTab(activeTab)
  }, [activeTab, fetchTab])

  // Auto-refresh every 90 seconds for active tab
  useEffect(() => {
    const id = setInterval(() => {
      loadedTabs.current.delete(activeTab)
      fetchTab(activeTab, true)
    }, 90_000)
    return () => clearInterval(id)
  }, [activeTab, fetchTab])

  // ── AI context processor ──────────────────────────────────────────────────
  useEffect(() => {
    if (aiQueue.length === 0) return
    const [nextId, ...rest] = aiQueue

    const items = tabData.relevant
    const item  = items.find(n => n.id === nextId)
    if (!item) { setAiQueue(rest); return }

    setAiItems(m => new Map(m).set(nextId, { context: null, loading: true }))

    fetch('/api/ai-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headline: item.headline, summary: item.summary, watchlist: symbols }),
    })
      .then(r => r.json())
      .then(data => {
        setAiItems(m => new Map(m).set(nextId, { context: data.context ?? null, loading: false }))
        setTimeout(() => setAiQueue(rest), 500)
      })
      .catch(() => {
        setAiItems(m => new Map(m).set(nextId, { context: null, loading: false }))
        setAiQueue(rest)
      })
  }, [aiQueue])

  // ── Tab stats ──────────────────────────────────────────────────────────────
  const currentItems  = tabData[activeTab]
  const isLoading     = tabLoading[activeTab]
  const hasError      = tabError[activeTab]
  const relevantCount = tabData.relevant.filter(n => n.relevanceScore > 0).length

  const sentimentCounts = currentItems.reduce((acc, item) => {
    acc[item.sentiment as SentimentType] = (acc[item.sentiment as SentimentType] ?? 0) + 1
    return acc
  }, {} as Record<SentimentType, number>)

  const tabDef = TABS.find(t => t.id === activeTab)!

  return (
    <div className="panel" style={{ height:'100%', display:'flex', flexDirection:'column' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ justifyContent:'space-between', padding:'8px 14px', minHeight:'36px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <div className="dot" style={{ background:'var(--amber)' }} />
          INTELLIGENCE FEED
          {!isLoading && relevantCount > 0 && activeTab === 'relevant' && (
            <span style={{ fontSize:'11px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace' }}>
              {relevantCount} relevant
            </span>
          )}
        </div>
        {/* Sentiment mini-bar */}
        {!isLoading && currentItems.length > 0 && (
          <div style={{ display:'flex', gap:'8px', fontSize:'11px', fontFamily:'JetBrains Mono,monospace' }}>
            {sentimentCounts.bullish ? <span style={{ color:'var(--positive)' }}>▲ {sentimentCounts.bullish}</span> : null}
            {sentimentCounts.bearish ? <span style={{ color:'var(--negative)' }}>▼ {sentimentCounts.bearish}</span> : null}
          </div>
        )}
      </div>

      {/* ── Tab Navigation ─────────────────────────────────────────────────── */}
      <div style={{
        display:'flex', borderBottom:'1px solid var(--border)',
        overflowX:'auto', scrollbarWidth:'none', flexShrink:0,
        background:'rgba(0,0,0,0.15)',
      }}>
        {TABS.map(tab => {
          const isActive  = activeTab === tab.id
          const count     = tabData[tab.id].length
          const loading   = tabLoading[tab.id]
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding:'7px 12px', border:'none', cursor:'pointer',
                flexShrink:0, display:'flex', alignItems:'center', gap:'5px',
                borderBottom:`2px solid ${isActive ? tab.color : 'transparent'}`,
                background: isActive ? `${tab.color}10` : 'transparent',
                transition:'all 0.15s',
              }}
            >
              <span style={{ fontSize:'11px' }}>{tab.icon}</span>
              <span style={{
                fontSize:'11px', fontFamily:'JetBrains Mono,monospace', fontWeight: isActive ? 700 : 400,
                letterSpacing:'0.06em', color: isActive ? tab.color : 'var(--text-muted)',
                whiteSpace:'nowrap',
              }}>
                {tab.label}
              </span>
              {count > 0 && (
                <span style={{
                  fontSize:'10px', padding:'1px 4px', borderRadius:'2px',
                  background: isActive ? tab.color + '20' : 'rgba(74,96,112,0.2)',
                  color: isActive ? tab.color : 'var(--text-muted)',
                  fontFamily:'JetBrains Mono,monospace',
                }}>
                  {loading ? '···' : count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Tab description ────────────────────────────────────────────────── */}
      <div style={{
        padding:'3px 14px', borderBottom:'1px solid var(--border)', flexShrink:0,
        fontSize:'10px', color:'var(--text-muted)', fontFamily:'JetBrains Mono,monospace',
        background:'rgba(0,0,0,0.08)',
        display:'flex', justifyContent:'space-between', alignItems:'center',
      }}>
        <span style={{ color: tabDef.color }}>{tabDef.icon} {tabDef.desc}</span>
        {!isLoading && currentItems.length > 0 && (
          <span>{currentItems.length} stories · {timeAgo(currentItems[0]?.datetime ?? 0)}</span>
        )}
      </div>

      {/* ── News list ──────────────────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:'auto' }}>

        {/* Loading */}
        {isLoading && (
          <div style={{
            padding:'24px', textAlign:'center',
            color:'var(--text-muted)', fontSize:'11px', fontFamily:'JetBrains Mono,monospace',
            letterSpacing:'0.1em', display:'flex', flexDirection:'column', alignItems:'center', gap:'8px',
          }}>
            <div style={{
              width:'20px', height:'20px',
              border:`2px solid var(--border)`, borderTop:`2px solid ${tabDef.color}`,
              borderRadius:'50%', animation:'spin 0.8s linear infinite',
            }} />
            LOADING {tabDef.label} FEED…
          </div>
        )}

        {/* Error */}
        {!isLoading && hasError && (
          <div style={{ padding:'16px', textAlign:'center' }}>
            <div style={{ color:'var(--negative)', fontSize:'10px', fontFamily:'JetBrains Mono,monospace', marginBottom:'8px' }}>
              ⚠ {hasError}
            </div>
            <button
              onClick={() => { loadedTabs.current.delete(activeTab); fetchTab(activeTab, true) }}
              style={{
                padding:'4px 12px', borderRadius:'3px', cursor:'pointer',
                fontFamily:'JetBrains Mono,monospace', fontSize:'11px',
                border:`1px solid ${tabDef.color}`, background: tabDef.color + '15', color: tabDef.color,
              }}
            >
              ↺ Retry
            </button>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !hasError && currentItems.length === 0 && (
          <div style={{ padding:'24px', textAlign:'center', color:'var(--text-muted)', fontSize:'11px', fontFamily:'JetBrains Mono,monospace' }}>
            {activeTab === 'relevant' ? 'Add stocks to your watchlist to see relevant news' : 'No stories found — try refreshing'}
          </div>
        )}

        {/* News items */}
        {!isLoading && currentItems.map(item => {
          const aiState = aiItems.get(item.id)
          return (
            <div key={item.id}>
              <NewsItem item={item} />
              {/* AI context (only on relevant tab) */}
              {activeTab === 'relevant' && (
                <>
                  {aiState?.loading && (
                    <div style={{ paddingLeft:'14px', paddingBottom:'6px', fontSize:'10px', color:'var(--teal)', fontFamily:'JetBrains Mono,monospace', opacity:0.6 }}>
                      ◆ analyzing…
                    </div>
                  )}
                  {aiState?.context && (
                    <div style={{
                      margin:'-1px 14px 0', padding:'5px 10px', marginBottom:'1px',
                      fontSize:'11px', color:'var(--teal)',
                      fontFamily:'JetBrains Mono,monospace', lineHeight:1.5,
                      background:'rgba(0,229,192,0.04)',
                      borderLeft:'2px solid rgba(0,229,192,0.4)',
                      borderRadius:'0 3px 3px 0',
                    }}>
                      ◆ {aiState.context}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}

        {/* Refresh footer */}
        {!isLoading && currentItems.length > 0 && (
          <div style={{
            padding:'10px 14px', textAlign:'center',
            borderTop:'1px solid var(--border)',
          }}>
            <button
              onClick={() => { loadedTabs.current.delete(activeTab); fetchTab(activeTab, true) }}
              style={{
                padding:'4px 14px', borderRadius:'3px', cursor:'pointer',
                fontFamily:'JetBrains Mono,monospace', fontSize:'11px',
                border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)',
              }}
            >
              ↺ Refresh {tabDef.label}
            </button>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}