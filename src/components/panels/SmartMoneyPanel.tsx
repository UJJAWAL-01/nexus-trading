'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useActiveSymbol } from '@/store/symbol'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Holding {
  name: string; ticker?: string; value: number; shares: number; pctPort: number
  price?: number; change?: number
}
interface FundMeta { id: string; name: string; manager: string; style: string; loaded?: boolean }
interface FundData extends FundMeta { holdings: Holding[]; asOf: string; totalAum: number; source: string }
interface ConsensusItem { name: string; ticker?: string; count: number; funds: string[]; totalValue: number; avgPct: number; score: number }
interface ApiResponse {
  market: 'US' | 'IN'; type: 'fund' | 'consensus'
  fund?: FundData; funds?: FundMeta[]; consensus?: ConsensusItem[]
  disclaimer: string; stale?: boolean
}

// ── Fund metadata (mirrors route.ts) ───────────────────────────────────────────

const US_FUNDS = [
  { id: 'berkshire',  short: 'Buffett',        full: 'Berkshire Hathaway',     style: 'Value'      },
  { id: 'pershing',   short: 'Ackman',         full: 'Pershing Square',         style: 'Activist'   },
  { id: 'duquesne',   short: 'Druckenmiller',  full: 'Duquesne Family Office',  style: 'Macro'      },
  { id: 'tiger',      short: 'Tiger Global',   full: 'Tiger Global Mgmt',       style: 'Tech'       },
  { id: 'baupost',    short: 'Klarman',        full: 'Baupost Group',           style: 'Value'      },
  { id: 'scion',      short: 'Burry',          full: 'Scion Asset Mgmt',        style: 'Contrarian' },
  { id: 'greenlight', short: 'Einhorn',        full: 'Greenlight Capital',      style: 'L/S'        },
]

const IN_FUNDS = [
  { id: 'nifty50',    short: 'Large Cap',    full: 'Large Cap (Nifty 50)',     style: 'Large Cap'  },
  { id: 'nifty100',   short: 'Bluechip',     full: 'Bluechip (Nifty 100)',     style: 'Large Cap'  },
  { id: 'nexttfifty', short: 'Emerging LC',  full: 'Emerging LargeCap',         style: 'Mid-Large'  },
  { id: 'midcap100',  short: 'Mid Cap',      full: 'Mid Cap (Midcap 100)',     style: 'Mid Cap'    },
  { id: 'smlcap100',  short: 'Small Cap',    full: 'Small Cap (Smlcap 100)',   style: 'Small Cap'  },
  { id: 'flexicap',   short: 'Flexi Cap',    full: 'Flexi Cap (Nifty 200)',    style: 'Flexi Cap'  },
  { id: 'multicap',   short: 'Multi Cap',    full: 'Multi Cap (Nifty 500)',     style: 'Multi Cap'  },
]

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmtPrice(price: number | undefined, market: 'US' | 'IN'): string {
  if (price == null || price <= 0) return '—'
  if (market === 'IN') return `₹${price.toFixed(price < 100 ? 2 : 0)}`
  return `$${price.toFixed(2)}`
}

function fmtChange(change: number | undefined): string {
  if (change == null) return '—'
  const sign = change >= 0 ? '+' : ''
  return `${sign}${change.toFixed(2)}%`
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div style={{ flex: 1, overflow: 'hidden' }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={{
          display: 'flex', gap: 10, padding: '9px 12px',
          borderBottom: '1px solid var(--border)', alignItems: 'center',
          opacity: 1 - i * 0.1,
        }}>
          <div style={{ width: 20, height: 11, background: 'rgba(167,139,250,0.12)', borderRadius: 2, animation: 'shimmer 1.4s ease infinite' }} />
          <div style={{ flex: 1, height: 11, background: 'rgba(167,139,250,0.12)', borderRadius: 2, animation: 'shimmer 1.4s ease infinite', animationDelay: '0.1s' }} />
          <div style={{ width: 60, height: 11, background: 'rgba(167,139,250,0.12)', borderRadius: 2, animation: 'shimmer 1.4s ease infinite', animationDelay: '0.2s' }} />
          <div style={{ width: 50, height: 11, background: 'rgba(167,139,250,0.12)', borderRadius: 2, animation: 'shimmer 1.4s ease infinite', animationDelay: '0.3s' }} />
        </div>
      ))}
    </div>
  )
}

// Row for the consensus view (multiple funds holding the same stock)
function ConsensusRow({ item, totalFunds, market, prices, onClick }: {
  item: ConsensusItem; totalFunds: number; market: 'US' | 'IN'
  prices: Record<string, { price: number; change: number }>
  onClick: () => void
}) {
  const filled = '●'.repeat(item.count) + '○'.repeat(totalFunds - item.count)
  const liveQuote = item.ticker ? prices[item.ticker] : undefined
  const price = liveQuote?.price
  const change = liveQuote?.change
  const changeColor = change == null ? 'var(--text-muted)' : change >= 0 ? 'var(--positive)' : 'var(--negative)'

  return (
    <div
      onClick={item.ticker ? onClick : undefined}
      style={{
        display: 'grid', gridTemplateColumns: '24px 1fr 90px 56px 72px 60px',
        padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
        alignItems: 'center', fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11, cursor: item.ticker ? 'pointer' : 'default',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => item.ticker && (e.currentTarget.style.background = 'rgba(167,139,250,0.08)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{item.count}</span>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ color: '#e8e8e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.name}
        </div>
        <div style={{ fontSize: 9, color: 'rgba(167,139,250,0.6)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.funds.slice(0, 4).join(' · ')}{item.funds.length > 4 ? ` +${item.funds.length - 4}` : ''}
        </div>
      </div>
      <span style={{ textAlign: 'center', color: item.count >= 4 ? 'var(--positive)' : item.count >= 3 ? 'var(--amber)' : 'var(--text-2)', fontSize: 10, letterSpacing: 0 }}>
        {filled}
      </span>
      <span style={{ textAlign: 'right', color: 'var(--amber)', fontVariantNumeric: 'tabular-nums' }}>
        {item.avgPct.toFixed(1)}%
      </span>
      <span style={{ textAlign: 'right', color: 'var(--teal)', fontVariantNumeric: 'tabular-nums', fontSize: 10 }}>
        {fmtPrice(price, market)}
      </span>
      <span style={{ textAlign: 'right', color: changeColor, fontVariantNumeric: 'tabular-nums', fontSize: 10 }}>
        {fmtChange(change)}
      </span>
    </div>
  )
}

// Row for individual fund holdings
function HoldingRow({ holding, rank, market, prices, onClick }: {
  holding: Holding; rank: number; market: 'US' | 'IN'
  prices: Record<string, { price: number; change: number }>
  onClick: () => void
}) {
  // For US: get live price from prices map (Finnhub call)
  // For India: NSE already provided price/change
  const liveQuote = holding.ticker ? prices[holding.ticker] : undefined
  const price = liveQuote?.price ?? holding.price
  const change = liveQuote?.change ?? holding.change
  const changeColor = change == null ? 'var(--text-muted)' : change >= 0 ? 'var(--positive)' : 'var(--negative)'

  return (
    <div
      onClick={holding.ticker ? onClick : undefined}
      style={{
        display: 'grid', gridTemplateColumns: '24px 1fr 56px 72px 60px',
        padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)',
        alignItems: 'center', fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11, cursor: holding.ticker ? 'pointer' : 'default',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => holding.ticker && (e.currentTarget.style.background = 'rgba(167,139,250,0.08)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ color: 'var(--text-muted)', fontSize: 9 }}>{rank}</span>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ color: '#e8e8e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {holding.name}
        </div>
        {holding.ticker && (
          <div style={{ fontSize: 9, color: 'rgba(167,139,250,0.6)', marginTop: 1 }}>{holding.ticker}</div>
        )}
      </div>
      <span style={{ textAlign: 'right', color: 'var(--amber)', fontVariantNumeric: 'tabular-nums' }}>
        {holding.pctPort.toFixed(1)}%
      </span>
      <span style={{ textAlign: 'right', color: 'var(--teal)', fontVariantNumeric: 'tabular-nums', fontSize: 10 }}>
        {fmtPrice(price, market)}
      </span>
      <span style={{ textAlign: 'right', color: changeColor, fontVariantNumeric: 'tabular-nums', fontSize: 10 }}>
        {fmtChange(change)}
      </span>
    </div>
  )
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export default function SmartMoneyPanel() {
  const [market,     setMarket]     = useState<'US' | 'IN'>('US')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [data,       setData]       = useState<ApiResponse | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)
  const [prices,     setPrices]     = useState<Record<string, { price: number; change: number }>>({})
  const setActiveSymbol = useActiveSymbol(s => s.setActiveSymbol)

  const funds = market === 'US' ? US_FUNDS : IN_FUNDS

  const loadData = useCallback(async () => {
    setLoading(true); setError(null); setData(null); setPrices({})
    try {
      const params = new URLSearchParams({ market })
      if (selectedId) params.set('fund', selectedId)
      const res  = await fetch(`/api/smart-money?${params}`)
      const json = await res.json() as ApiResponse
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [market, selectedId])

  useEffect(() => { loadData() }, [loadData])

  // Collect tickers for US to fetch live prices (India already has them from NSE)
  const tickersNeedingPrices = useMemo(() => {
    if (!data || market === 'IN') return []
    const tickers = new Set<string>()
    if (data.consensus) data.consensus.slice(0, 15).forEach(c => c.ticker && tickers.add(c.ticker))
    if (data.fund) data.fund.holdings.slice(0, 15).forEach(h => h.ticker && tickers.add(h.ticker))
    return [...tickers]
  }, [data, market])

  // Fetch live prices in parallel via /api/globalquote
  useEffect(() => {
    if (tickersNeedingPrices.length === 0) return
    let cancelled = false
    Promise.allSettled(
      tickersNeedingPrices.map(async t => {
        const r = await fetch(`/api/globalquote?symbol=${encodeURIComponent(t)}`)
        if (!r.ok) return null
        const q = await r.json() as { price?: number; changePercent?: number }
        return q.price != null ? { ticker: t, price: q.price, change: q.changePercent ?? 0 } : null
      })
    ).then(results => {
      if (cancelled) return
      const map: Record<string, { price: number; change: number }> = {}
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value) {
          map[r.value.ticker] = { price: r.value.price, change: r.value.change }
        }
      })
      setPrices(map)
    })
    return () => { cancelled = true }
  }, [tickersNeedingPrices])

  const handleMarket = (m: 'US' | 'IN') => { setMarket(m); setSelectedId(null) }

  const openChart = (ticker: string) => {
    setActiveSymbol(ticker)
    // Smooth-scroll to chart panel if present
    document.querySelector('[data-panel-id="chart"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const fundData     = data?.fund
  const consensus    = data?.consensus ?? []
  const loadedCount  = data?.funds?.filter(f => f.loaded !== false).length ?? 0
  const isConsensusView = !selectedId

  // What we're showing right now (context line)
  const contextLine = useMemo(() => {
    if (loading) return null
    if (selectedId && fundData) {
      const asOf = fundData.asOf
      return market === 'US'
        ? `${fundData.manager} · ${fundData.name} · 13F filed ${asOf}`
        : `${fundData.name} · Live NSE composition · ${fundData.holdings.length} stocks`
    }
    return market === 'US'
      ? `Top picks across ${loadedCount} hedge funds · Q4 2025 13F filings`
      : `Top picks across ${loadedCount} fund categories · Live NSE data`
  }, [loading, selectedId, fundData, market, loadedCount])

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div className="panel-header">
        <span className="dot" style={{ background: '#a78bfa', boxShadow: '0 0 6px #a78bfa' }} />
        <span>SMART MONEY</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {market === 'US' ? 'SEC 13F · 7 FUNDS' : 'NSE LIVE · 7 CATEGORIES'}
        </span>
      </div>

      {/* Market toggle */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
        {(['US', 'IN'] as const).map(m => (
          <button key={m} onClick={() => handleMarket(m)} style={{
            padding: '4px 14px', borderRadius: 3, cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
            border: `1px solid ${market === m ? '#a78bfa' : 'var(--border)'}`,
            background: market === m ? 'rgba(167,139,250,0.15)' : 'transparent',
            color: market === m ? '#a78bfa' : 'var(--text-muted)',
          }}>
            {m === 'US' ? '🇺🇸 US Hedge Funds' : '🇮🇳 India Smart Money'}
          </button>
        ))}
      </div>

      {/* Fund selector */}
      <div style={{ display: 'flex', gap: 4, padding: '7px 12px', overflowX: 'auto', borderBottom: '1px solid var(--border)', scrollbarWidth: 'none' }}>
        <button onClick={() => setSelectedId(null)} style={{
          padding: '3px 11px', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 700,
          border: `1px solid ${isConsensusView ? 'var(--teal)' : 'var(--border)'}`,
          background: isConsensusView ? 'rgba(0,229,192,0.1)' : 'transparent',
          color: isConsensusView ? 'var(--teal)' : 'var(--text-muted)',
        }}>
          ALL
        </button>
        {funds.map(f => {
          const meta = data?.funds?.find(m => m.id === f.id)
          const failed = meta?.loaded === false
          const selected = selectedId === f.id
          return (
            <button key={f.id} onClick={() => setSelectedId(f.id)} title={f.full} style={{
              padding: '3px 11px', borderRadius: 3, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
              border: `1px solid ${selected ? '#a78bfa' : failed ? 'var(--negative)' : 'var(--border)'}`,
              background: selected ? 'rgba(167,139,250,0.12)' : 'transparent',
              color: selected ? '#a78bfa' : failed ? 'var(--negative)' : 'var(--text-muted)',
              opacity: failed ? 0.6 : 1,
            }}>
              {f.short}
            </button>
          )
        })}
      </div>

      {/* Context line */}
      {contextLine && (
        <div style={{
          padding: '5px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
          color: '#a78bfa', background: 'rgba(167,139,250,0.06)',
          borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {contextLine}
        </div>
      )}

      {/* Column headers */}
      {!loading && !error && data && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: isConsensusView ? '24px 1fr 90px 56px 72px 60px' : '24px 1fr 56px 72px 60px',
          padding: '5px 12px', borderBottom: '1px solid var(--border)',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.08em',
          background: 'var(--bg-panel)',
        }}>
          {isConsensusView ? (
            <>
              <span>#</span><span>STOCK · FUNDS HOLDING</span>
              <span style={{ textAlign: 'center' }}>CONVICTION</span>
              <span style={{ textAlign: 'right' }}>AVG%</span>
              <span style={{ textAlign: 'right' }}>PRICE</span>
              <span style={{ textAlign: 'right' }}>CHG</span>
            </>
          ) : (
            <>
              <span>#</span><span>STOCK · TICKER</span>
              <span style={{ textAlign: 'right' }}>WEIGHT</span>
              <span style={{ textAlign: 'right' }}>PRICE</span>
              <span style={{ textAlign: 'right' }}>CHG</span>
            </>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {loading ? (
          <Skeleton />
        ) : error ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20, fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            <span style={{ color: 'var(--negative)' }}>⚠ {error}</span>
            <button onClick={loadData} style={{ padding: '4px 14px', borderRadius: 3, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}>
              RETRY
            </button>
          </div>
        ) : isConsensusView ? (
          consensus.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
              No consensus picks (no overlap across funds).<br/>
              Click a fund button to see individual holdings.
            </div>
          ) : (
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {consensus.map((c, i) => (
                <ConsensusRow
                  key={c.name + i}
                  item={c}
                  totalFunds={funds.length}
                  market={market}
                  prices={prices}
                  onClick={() => c.ticker && openChart(c.ticker)}
                />
              ))}
            </div>
          )
        ) : fundData?.holdings && fundData.holdings.length > 0 ? (
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {fundData.holdings.map((h, i) => (
              <HoldingRow
                key={h.name + i}
                holding={h}
                rank={i + 1}
                market={market}
                prices={prices}
                onClick={() => h.ticker && openChart(h.ticker)}
              />
            ))}
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>
            No holdings data
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div style={{
        padding: '5px 12px', fontSize: 9, color: 'var(--text-muted)',
        fontFamily: 'JetBrains Mono, monospace', borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', gap: 8,
      }}>
        <span>Click any row → open chart</span>
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>
          {market === 'US' ? 'SEC 13F · public regulatory data' : 'NSE India · live'}
        </span>
      </div>

      <style>{`
        @keyframes shimmer { 0%,100% { opacity:0.3; } 50% { opacity:0.7; } }
      `}</style>
    </div>
  )
}
