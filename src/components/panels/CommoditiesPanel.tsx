'use client'

import { useEffect, useState, useCallback } from 'react'

// ── Commodity definitions ─────────────────────────────────────────────────────

interface CommodityDef {
  symbol:   string   // Yahoo Finance symbol
  name:     string
  unit:     string
  category: 'Energy' | 'Metals' | 'Agriculture' | 'Crypto'
  flag:     string
  digits:   number
  // How this commodity impacts India vs US (for news context)
  usImpact:  string
  indImpact: string
}

const COMMODITIES: CommodityDef[] = [
  // Energy
  { symbol: 'CL=F',  name: 'Crude Oil (WTI)',  unit: '$/bbl',  category: 'Energy',      flag: '🛢️', digits: 2, usImpact: 'Gasoline, jet fuel, energy costs', indImpact: 'Petrol/diesel prices, INR pressure, fuel subsidy burden' },
  { symbol: 'BZ=F',  name: 'Brent Crude',      unit: '$/bbl',  category: 'Energy',      flag: '🛢️', digits: 2, usImpact: 'Global oil benchmark, exports',    indImpact: 'India imports ~85% of oil at Brent prices, forex drain' },
  { symbol: 'NG=F',  name: 'Natural Gas',       unit: '$/MMBtu',category: 'Energy',      flag: '🔥', digits: 3, usImpact: 'Heating, power generation, LNG',   indImpact: 'GAIL, city gas distribution, fertilizer production' },
  { symbol: 'RB=F',  name: 'Gasoline (RBOB)',   unit: '$/gal',  category: 'Energy',      flag: '⛽', digits: 4, usImpact: 'Consumer fuel prices, inflation',  indImpact: 'Indirect via crude pricing' },

  // Metals
  { symbol: 'GC=F',  name: 'Gold',              unit: '$/oz',   category: 'Metals',      flag: '🥇', digits: 0, usImpact: 'Safe haven, dollar inverse',      indImpact: 'World\'s 2nd largest consumer, jewellery demand, weddings' },
  { symbol: 'SI=F',  name: 'Silver',             unit: '$/oz',   category: 'Metals',      flag: '🥈', digits: 2, usImpact: 'Industrial + safe haven',         indImpact: 'Solar panels, electronics, jewellery' },
  { symbol: 'HG=F',  name: 'Copper',             unit: '$/lb',   category: 'Metals',      flag: '🔴', digits: 4, usImpact: 'Construction, EV infrastructure', indImpact: 'Hindalco, Hindustan Copper, infra projects, EVs' },
  { symbol: 'ALI=F', name: 'Aluminum',           unit: '$/lb',   category: 'Metals',      flag: '🪙', digits: 4, usImpact: 'Aerospace, automotive, packaging', indImpact: 'NALCO, Vedanta, auto & packaging sectors' },
  { symbol: 'PL=F',  name: 'Platinum',           unit: '$/oz',   category: 'Metals',      flag: '⚪', digits: 0, usImpact: 'Catalytic converters, jewelry',   indImpact: 'Auto emissions control, industrial uses' },

  // Agriculture
  { symbol: 'ZW=F',  name: 'Wheat',              unit: '¢/bu',   category: 'Agriculture', flag: '🌾', digits: 2, usImpact: 'Food prices, farmer income',      indImpact: 'Atta/flour prices, MSP policy, food inflation (WPI)' },
  { symbol: 'ZC=F',  name: 'Corn',               unit: '¢/bu',   category: 'Agriculture', flag: '🌽', digits: 2, usImpact: 'Ethanol, livestock feed, exports', indImpact: 'Poultry feed, starch industry, ethanol blending target' },
  { symbol: 'ZS=F',  name: 'Soybeans',           unit: '¢/bu',   category: 'Agriculture', flag: '🫘', digits: 2, usImpact: 'Cooking oil, protein exports',     indImpact: 'Edible oil import costs, ITC, Ruchi Soya exposure' },
  { symbol: 'SB=F',  name: 'Sugar',              unit: '¢/lb',   category: 'Agriculture', flag: '🍬', digits: 2, usImpact: 'Food processing, biofuel',         indImpact: 'India is world\'s top producer — Balrampur, Shree Renuka' },
  { symbol: 'KC=F',  name: 'Coffee (Arabica)',   unit: '¢/lb',   category: 'Agriculture', flag: '☕', digits: 2, usImpact: 'Consumer staples, cafe chains',    indImpact: 'Karnataka/Kerala growers, Tata Coffee, Nestle India' },
  { symbol: 'CT=F',  name: 'Cotton',             unit: '¢/lb',   category: 'Agriculture', flag: '🫙', digits: 2, usImpact: 'Apparel, textile exports',         indImpact: 'India 2nd largest producer — Welspun, textile mills, yarn exports' },

  // Crypto (via Yahoo Finance)
  { symbol: 'BTC-USD', name: 'Bitcoin',          unit: '$/BTC',  category: 'Crypto',     flag: '₿',  digits: 0, usImpact: 'Institutional crypto, ETF flows',  indImpact: 'WazirX exposure, crypto regulation, fintech sector' },
  { symbol: 'ETH-USD', name: 'Ethereum',         unit: '$/ETH',  category: 'Crypto',     flag: '⧫',  digits: 2, usImpact: 'DeFi, Web3 platform risk proxy',  indImpact: 'NFT/DeFi projects, blockchain startups in India' },
]

interface CommodityPrice {
  symbol: string
  price:  number | null
  change: number | null
  flash:  'up' | 'down' | null
}

// Stale store — never goes blank
const staleStore = new Map<string, { price: number|null; change: number|null }>()

// ── Commodities news API ───────────────────────────────────────────────────────
// Using existing /api/news endpoint with commodities-focused query

interface NewsItem {
  headline:   string
  source:     string
  url:        string
  datetime:   number
  summary:    string
  sentiment:  'bullish' | 'bearish' | 'neutral'
  commodity:  string | null  // which commodity is impacted
  usImpact:   string | null
  indImpact:  string | null
}

// Quick keyword-based commodity detection (instant, no API needed)
function detectCommodity(text: string): { name: string | null; def: CommodityDef | null } {
  const t = text.toLowerCase()
  const KEYWORDS: [string[], CommodityDef][] = [
    [['crude','wti','brent','oil','opec','petroleum'],    COMMODITIES.find(c=>c.symbol==='CL=F')!],
    [['natural gas','lng','gas prices'],                  COMMODITIES.find(c=>c.symbol==='NG=F')!],
    [['gold','bullion','yellow metal'],                   COMMODITIES.find(c=>c.symbol==='GC=F')!],
    [['silver','ag metal'],                               COMMODITIES.find(c=>c.symbol==='SI=F')!],
    [['copper','hg futures'],                             COMMODITIES.find(c=>c.symbol==='HG=F')!],
    [['aluminum','aluminium'],                            COMMODITIES.find(c=>c.symbol==='ALI=F')!],
    [['wheat','grain','flour'],                           COMMODITIES.find(c=>c.symbol==='ZW=F')!],
    [['corn','maize','ethanol corn'],                     COMMODITIES.find(c=>c.symbol==='ZC=F')!],
    [['soybean','soy','edible oil'],                      COMMODITIES.find(c=>c.symbol==='ZS=F')!],
    [['sugar','cane','sweetener'],                        COMMODITIES.find(c=>c.symbol==='SB=F')!],
    [['coffee','arabica','robusta'],                      COMMODITIES.find(c=>c.symbol==='KC=F')!],
    [['cotton','fiber','textile commodity'],               COMMODITIES.find(c=>c.symbol==='CT=F')!],
    [['bitcoin','btc','crypto'],                          COMMODITIES.find(c=>c.symbol==='BTC-USD')!],
  ]
  for (const [kws, def] of KEYWORDS) {
    if (kws.some(k => t.includes(k))) return { name: def.name, def }
  }
  return { name: null, def: null }
}

function guessSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const t = text.toLowerCase()
  const bull = ['surge','soar','rally','gain','rise','jump','beat','record','high','bull','strong','boost']
  const bear = ['crash','fall','drop','plunge','miss','loss','weak','cut','warn','slump','down','low','bear','concern']
  let b=0, br=0
  bull.forEach(w => { if(t.includes(w)) b++ })
  bear.forEach(w => { if(t.includes(w)) br++ })
  if (b>br+1) return 'bullish'
  if (br>b+1) return 'bearish'
  return 'neutral'
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now()/1000) - ts
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`
  return `${Math.floor(diff/86400)}d ago`
}

const SENTIMENT_COLOR = {
  bullish: { color: 'var(--positive)', bg: 'rgba(0,201,122,0.1)', border: 'rgba(0,201,122,0.25)' },
  bearish: { color: 'var(--negative)', bg: 'rgba(255,69,96,0.1)', border: 'rgba(255,69,96,0.25)' },
  neutral: { color: 'var(--text-muted)', bg: 'rgba(74,96,112,0.1)', border: 'rgba(74,96,112,0.2)' },
}

const CATEGORY_COLOR: Record<string, string> = {
  Energy:      '#f97316',
  Metals:      '#f0a500',
  Agriculture: '#00c97a',
  Crypto:      '#a78bfa',
}

// ── Main Component ─────────────────────────────────────────────────────────────

type ActiveView = 'prices' | 'news'
type ActiveCat  = 'All' | 'Energy' | 'Metals' | 'Agriculture' | 'Crypto'

export default function CommoditiesPanel() {
  const [prices,     setPrices]     = useState<CommodityPrice[]>(
    COMMODITIES.map(c => ({ symbol: c.symbol, price: staleStore.get(c.symbol)?.price ?? null, change: staleStore.get(c.symbol)?.change ?? null, flash: null }))
  )
  const [news,       setNews]       = useState<NewsItem[]>([])
  const [view,       setView]       = useState<ActiveView>('prices')
  const [cat,        setCat]        = useState<ActiveCat>('All')
  const [loadPrices, setLoadPrices] = useState(true)
  const [loadNews,   setLoadNews]   = useState(false)
  const [lastUpdate, setLastUpdate] = useState('')

  // ── Fetch prices via yquote ────────────────────────────────────────────────
  const fetchPrices = useCallback(async () => {
    const BATCH = 4
    const results: CommodityPrice[] = []

    for (let i = 0; i < COMMODITIES.length; i += BATCH) {
      const batch = COMMODITIES.slice(i, i + BATCH)
      const fetched = await Promise.all(
        batch.map(async def => {
          try {
            const res  = await fetch(`/api/yquote?symbol=${encodeURIComponent(def.symbol)}`)
            const data = await res.json()
            if (data.price && data.price > 0) {
              staleStore.set(def.symbol, { price: data.price, change: data.change })
              return { symbol: def.symbol, price: data.price as number, change: data.change as number | null, flash: null }
            }
          } catch {}
          const st = staleStore.get(def.symbol)
          return { symbol: def.symbol, price: st?.price ?? null, change: st?.change ?? null, flash: null }
        })
      )
      results.push(...fetched)
      if (i + BATCH < COMMODITIES.length) await new Promise(r => setTimeout(r, 150))
    }

    setPrices(prev => {
      const flashMap: Record<string, 'up'|'down'> = {}
      const prevMap = new Map(prev.map(p => [p.symbol, p]))
      results.forEach(r => {
        const old = prevMap.get(r.symbol)
        if (old?.price && r.price && r.price !== old.price) {
          flashMap[r.symbol] = r.price > old.price ? 'up' : 'down'
        }
      })
      const next = results.map(r => ({ ...r, flash: flashMap[r.symbol] ?? null }))
      if (Object.keys(flashMap).length) setTimeout(() => setPrices(cur => cur.map(p => ({ ...p, flash: null }))), 700)
      return next
    })
    setLoadPrices(false)
    setLastUpdate(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }))
  }, [])

  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, 30_000)
    return () => clearInterval(id)
  }, [fetchPrices])

  // ── Fetch commodity news ───────────────────────────────────────────────────
  const fetchNews = useCallback(async () => {
    setLoadNews(true)
    try {
      const query = 'crude oil gold copper wheat commodities OPEC metals agriculture'
      const [finnhubRes, newsApiRes] = await Promise.allSettled([
        fetch('/api/finnhub?endpoint=news&category=general'),
        fetch(`/api/news?q=${encodeURIComponent(query)}`),
      ])

      const items: NewsItem[] = []

      if (finnhubRes.status === 'fulfilled') {
        const data = await finnhubRes.value.json()
        if (Array.isArray(data)) {
          data.slice(0, 30).forEach((item: any) => {
            if (!item.headline) return
            const { def } = detectCommodity(item.headline + ' ' + (item.summary ?? ''))
            if (!def && !item.headline.toLowerCase().includes('market')) return
            items.push({
              headline:  item.headline,
              source:    item.source ?? 'Finnhub',
              url:       item.url ?? '',
              datetime:  item.datetime ?? 0,
              summary:   item.summary ?? '',
              sentiment: guessSentiment(item.headline + ' ' + (item.summary ?? '')),
              commodity: def?.name ?? null,
              usImpact:  def?.usImpact ?? null,
              indImpact: def?.indImpact ?? null,
            })
          })
        }
      }

      if (newsApiRes.status === 'fulfilled') {
        const data = await newsApiRes.value.json()
        if (Array.isArray(data.articles)) {
          data.articles.slice(0, 20).forEach((item: any) => {
            if (!item.title || item.title === '[Removed]') return
            const { def } = detectCommodity(item.title + ' ' + (item.description ?? ''))
            if (!def) return
            items.push({
              headline:  item.title,
              source:    item.source?.name ?? 'NewsAPI',
              url:       item.url ?? '',
              datetime:  Math.floor(new Date(item.publishedAt).getTime() / 1000),
              summary:   item.description ?? '',
              sentiment: guessSentiment(item.title + ' ' + (item.description ?? '')),
              commodity: def.name,
              usImpact:  def.usImpact,
              indImpact: def.indImpact,
            })
          })
        }
      }

      // Deduplicate + sort by time
      const seen = new Set<string>()
      const unique = items
        .filter(i => { const k = i.headline.slice(0,40).toLowerCase(); if(seen.has(k))return false; seen.add(k); return true })
        .sort((a, b) => b.datetime - a.datetime)
        .slice(0, 25)

      setNews(unique)
    } catch {}
    setLoadNews(false)
  }, [])

  useEffect(() => {
    if (view === 'news' && news.length === 0) fetchNews()
  }, [view, news.length, fetchNews])

  // ── Filtered prices ─────────────────────────────────────────────────────────
  const displayed = COMMODITIES.filter(c => cat === 'All' || c.category === cat)

  const priceMap = new Map(prices.map(p => [p.symbol, p]))

  const categories: ActiveCat[] = ['All', 'Energy', 'Metals', 'Agriculture', 'Crypto']

  // Summary stats
  const loadedPrices = prices.filter(p => p.price !== null)
  const gainers = loadedPrices.filter(p => (p.change ?? 0) > 0).length
  const losers  = loadedPrices.filter(p => (p.change ?? 0) < 0).length

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <div className="dot" style={{ background: '#f0a500', flexShrink: 0 }} />
          <span style={{ whiteSpace: 'nowrap' }}>COMMODITIES</span>
          <span style={{
            fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
            background: 'rgba(240,165,0,0.12)', color: '#f0a500',
            border: '1px solid rgba(240,165,0,0.25)', fontFamily: 'JetBrains Mono, monospace',
            flexShrink: 0,
          }}>
            {gainers > 0 ? `▲${gainers}` : ''} {losers > 0 ? `▼${losers}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
          {(['prices', 'news'] as ActiveView[]).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '9px', letterSpacing: '0.06em',
              border: `1px solid ${view === v ? '#f0a500' : 'var(--border)'}`,
              background: view === v ? 'rgba(240,165,0,0.1)' : 'transparent',
              color: view === v ? '#f0a500' : 'var(--text-muted)',
              textTransform: 'uppercase',
            }}>
              {v === 'prices' ? 'PRICES' : '📰 NEWS'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Category filter ─────────────────────────────────────────────────── */}
      {view === 'prices' && (
        <div style={{
          display: 'flex', gap: '4px', padding: '5px 10px',
          borderBottom: '1px solid var(--border)', flexShrink: 0,
          overflowX: 'auto', scrollbarWidth: 'none',
        }}>
          {categories.map(c => (
            <button key={c} onClick={() => setCat(c)} style={{
              padding: '2px 9px', borderRadius: '3px', cursor: 'pointer',
              flexShrink: 0,
              fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
              border: `1px solid ${cat === c ? (CATEGORY_COLOR[c] ?? 'var(--teal)') : 'var(--border)'}`,
              background: cat === c ? ((CATEGORY_COLOR[c] ?? 'var(--teal)') + '18') : 'transparent',
              color: cat === c ? (CATEGORY_COLOR[c] ?? 'var(--teal)') : 'var(--text-muted)',
            }}>
              {c}
            </button>
          ))}
          {lastUpdate && (
            <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', alignSelf: 'center', marginLeft: 'auto', flexShrink: 0 }}>
              {lastUpdate}
            </span>
          )}
        </div>
      )}

      {/* ── PRICES VIEW ─────────────────────────────────────────────────────── */}
      {view === 'prices' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadPrices && prices.every(p => p.price === null) ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
              FETCHING COMMODITY PRICES...
            </div>
          ) : (
            displayed.map(def => {
              const p      = priceMap.get(def.symbol)
              const price  = p?.price ?? null
              const change = p?.change ?? null
              const flash  = p?.flash ?? null
              const isPos  = (change ?? 0) >= 0
              const catColor = CATEGORY_COLOR[def.category]

              return (
                <div
                  key={def.symbol}
                  style={{
                    display:     'grid',
                    gridTemplateColumns: '28px 1fr auto',
                    alignItems:  'center',
                    gap:         '8px',
                    padding:     '8px 14px',
                    borderBottom:'1px solid var(--border)',
                    background:
                      flash === 'up'   ? 'rgba(0,201,122,0.08)' :
                      flash === 'down' ? 'rgba(255,69,96,0.08)'  : 'transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ fontSize: '16px', textAlign: 'center' }}>{def.flag}</div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: '#fff' }}>
                        {def.name.split('(')[0].trim()}
                      </span>
                      <span style={{
                        fontSize: '8px', padding: '1px 5px', borderRadius: '2px',
                        background: catColor + '18', color: catColor,
                        border: `1px solid ${catColor}30`,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        {def.category}
                      </span>
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '1px' }}>
                      {def.unit} · {def.symbol}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', fontWeight: 700, color: price !== null ? '#fff' : 'var(--text-muted)' }}>
                      {price !== null
                        ? price >= 1000
                          ? price.toLocaleString('en-US', { maximumFractionDigits: def.digits })
                          : price.toFixed(def.digits)
                        : '···'}
                    </div>
                    {change !== null && (
                      <div style={{
                        fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
                        color: isPos ? 'var(--positive)' : 'var(--negative)',
                      }}>
                        {isPos ? '+' : ''}{change.toFixed(2)}%
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── NEWS VIEW ─────────────────────────────────────────────────────── */}
      {view === 'news' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loadNews ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
              LOADING COMMODITY INTELLIGENCE...
            </div>
          ) : news.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center' }}>
              <button
                onClick={fetchNews}
                style={{
                  padding: '8px 20px', borderRadius: '4px', cursor: 'pointer',
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
                  border: '1px solid var(--amber)', background: 'rgba(240,165,0,0.1)',
                  color: 'var(--amber)',
                }}
              >
                LOAD COMMODITY NEWS
              </button>
            </div>
          ) : (
            news.map((item, i) => {
              const ss = SENTIMENT_COLOR[item.sentiment]
              return (
                <div
                  key={i}
                  onClick={() => item.url && window.open(item.url, '_blank')}
                  style={{
                    padding:      '10px 14px',
                    borderBottom: '1px solid var(--border)',
                    cursor:       item.url ? 'pointer' : 'default',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {/* Row 1: badges */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '5px', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
                      background: ss.bg, color: ss.color, border: `1px solid ${ss.border}`,
                      fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', fontWeight: 700,
                    }}>
                      {item.sentiment}
                    </span>
                    {item.commodity && (
                      <span style={{
                        fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
                        background: 'rgba(240,165,0,0.12)', color: '#f0a500',
                        border: '1px solid rgba(240,165,0,0.25)',
                        fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                      }}>
                        🏷 {item.commodity}
                      </span>
                    )}
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {item.source}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {timeAgo(item.datetime)}
                    </span>
                  </div>

                  {/* Row 2: headline */}
                  <div style={{ fontSize: '12px', color: '#fff', lineHeight: 1.4, fontFamily: 'Syne, sans-serif', fontWeight: 600, marginBottom: '6px' }}>
                    {item.headline}
                  </div>

                  {/* Row 3: impact strips */}
                  {(item.usImpact || item.indImpact) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                      {item.usImpact && (
                        <div style={{
                          padding: '4px 8px', borderRadius: '3px',
                          background: 'rgba(30,144,255,0.06)', border: '1px solid rgba(30,144,255,0.15)',
                          borderLeft: '2px solid rgba(30,144,255,0.5)',
                        }}>
                          <div style={{ fontSize: '7px', color: '#1e90ff', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '2px' }}>
                            🇺🇸 US IMPACT
                          </div>
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.4 }}>
                            {item.usImpact}
                          </div>
                        </div>
                      )}
                      {item.indImpact && (
                        <div style={{
                          padding: '4px 8px', borderRadius: '3px',
                          background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)',
                          borderLeft: '2px solid rgba(249,115,22,0.5)',
                        }}>
                          <div style={{ fontSize: '7px', color: '#f97316', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '2px' }}>
                            🇮🇳 INDIA IMPACT
                          </div>
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.4 }}>
                            {item.indImpact}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{
        padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
        fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace',
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{COMMODITIES.length} instruments · Energy · Metals · Agriculture · Crypto</span>
        <span>via Yahoo Finance · refreshes 30s</span>
      </div>
    </div>
  )
}