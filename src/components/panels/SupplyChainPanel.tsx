'use client'
// src/components/panels/SupplyChainPanel.tsx
//
// Bloomberg SPLC-style supplier/customer map.
// All compute is client-side — dataset is shipped as /public/data/supply-chain.json
// (version-controlled, citable, community-PR-friendly). Server only serves the file.
//
// Visual: 3-column hierarchical map with curved SVG connectors animating from
// the central target node out to suppliers (left) and customers (right).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'

// ── Types (mirror JSON shape) ────────────────────────────────────────────────
interface Company {
  name: string; exchange: string; country: string
  sector: string; industry: string
}
type EdgeType   = 'supply' | 'ownership' | 'jv'
type Confidence = 'high' | 'medium' | 'low'
type Region     = 'us' | 'in'

interface Edge {
  supplier: string; customer: string
  type:        EdgeType
  category:    string
  evidence:    string
  sourceUrl:   string
  sourceType:  string
  sourceDate:  string
  revenuePct:  number | null
  stakePct?:   number | null
  confidence:  Confidence
  note?:       string
}

interface DataFile {
  version:     string
  generatedAt: string
  coverage:    { us: string[]; in: string[] }
  companies:   Record<string, Company>
  edges:       Edge[]
}

const fetcher = (u: string) => fetch(u).then(r => r.json())

// ── Visual constants ─────────────────────────────────────────────────────────
const CONF_COLOR: Record<Confidence, string> = {
  high:   '#00c97a',
  medium: '#f0a500',
  low:    '#ef4444',
}
const CONF_LABEL: Record<Confidence, string> = { high: 'HIGH', medium: 'MED', low: 'LOW' }

const REGION_DEFAULT: Record<Region, string> = { us: 'AAPL', in: 'RELIANCE.NS' }

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[+m - 1]} ${+d}, ${y}`
}

function tickerLabel(t: string): string {
  return t.replace('.NS', '').replace('.BO', '').replace('.T', '').replace('.SR', '')
          .replace('.TW', '').replace('.KS', '').replace('.SZ', '').replace('.HK', '')
}

function regionOf(ticker: string, companies: Record<string, Company>): Region | null {
  const c = companies[ticker]
  if (!c) return null
  return c.country === 'IN' ? 'in' : c.country === 'US' ? 'us' : null
}

// ── Main panel ───────────────────────────────────────────────────────────────
export default function SupplyChainPanel() {
  const { data, error, isLoading } = useSWR<DataFile>('/data/supply-chain.json', fetcher, {
    revalidateOnFocus: false, dedupingInterval: 60_000_000,
  })

  const [region,  setRegion]  = useState<Region>('us')
  const [target,  setTarget]  = useState('AAPL')
  const [input,   setInput]   = useState('AAPL')
  const [picked,  setPicked]  = useState<Edge | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  // Region toggle: switch default ticker
  const switchRegion = (r: Region) => {
    setRegion(r)
    const def = REGION_DEFAULT[r]
    setTarget(def); setInput(def); setPicked(null); setShowAll(false)
  }

  // Resolve target — accept any case, normalize against company keys
  const resolved = useMemo<string | null>(() => {
    if (!data) return null
    const upper = target.toUpperCase()
    if (data.companies[upper]) return upper
    if (data.companies[`${upper}.NS`]) return `${upper}.NS`
    return null
  }, [data, target])

  const company = resolved ? data?.companies[resolved] ?? null : null

  // Auto-switch region when target changes (e.g., user clicks an Indian peer from US view)
  useEffect(() => {
    if (!data || !resolved) return
    const r = regionOf(resolved, data.companies)
    if (r && r !== region) setRegion(r)
  }, [resolved, data, region])

  // Quick-pick tickers — filtered by region
  const quickPicks = useMemo(() => {
    if (!data) return [] as string[]
    return region === 'in' ? data.coverage.in : data.coverage.us
  }, [data, region])

  // Slice edges by relationship to target
  const { suppliers, customers, ownership, ownedBy } = useMemo(() => {
    if (!data || !resolved) {
      return { suppliers: [] as Edge[], customers: [] as Edge[],
               ownership: [] as Edge[], ownedBy:  [] as Edge[] }
    }
    const e = data.edges.filter(x => !x.note)
    return {
      suppliers: e.filter(x => x.customer === resolved && x.type === 'supply'),
      customers: e.filter(x => x.supplier === resolved && x.type === 'supply'),
      ownership: e.filter(x => x.supplier === resolved && x.type === 'ownership'),
      ownedBy:   e.filter(x => x.customer === resolved && x.type === 'ownership'),
    }
  }, [data, resolved])

  const submit = () => {
    const v = input.trim().toUpperCase()
    if (v) { setTarget(v); setPicked(null); setShowAll(false) }
  }
  const recenter = (ticker: string) => {
    setTarget(ticker); setInput(ticker); setPicked(null); setShowAll(false); setHovered(null)
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column',
                                     fontFamily: 'JetBrains Mono, monospace' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ flexShrink: 0, justifyContent: 'space-between',
                                              flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#a78bfa', flexShrink: 0 }} />
          <span style={{ fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700 }}>
            SUPPLY CHAIN MAP
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            · verified disclosures only
          </span>
        </div>
        {/* Region toggle */}
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['us', 'in'] as Region[]).map(r => (
            <button key={r} onClick={() => switchRegion(r)} style={{
              padding: '3px 10px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
              fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', fontWeight: 700,
              border: `1px solid ${region === r ? '#a78bfa' : 'var(--border)'}`,
              background: region === r ? 'rgba(167,139,250,0.12)' : 'transparent',
              color:      region === r ? '#a78bfa' : 'var(--text-muted)',
            }}>
              {r === 'us' ? 'US · S&P 500' : 'INDIA · NIFTY 50'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats strip */}
      {data && (
        <div style={{ padding: '4px 12px', borderBottom: '1px solid var(--border)',
                      flexShrink: 0, fontSize: '10px', color: 'var(--text-muted)',
                      display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {data.coverage.us.length} US · {data.coverage.in.length} IN companies
            · {data.edges.filter(e => !e.note).length} edges
          </span>
          <span>v{data.version} · refreshed {data.generatedAt}</span>
        </div>
      )}

      {/* ── Search ─────────────────────────────────────────────────────────── */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)',
                    flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder={region === 'us' ? 'Ticker — AAPL · NVDA · TSLA …' : 'Ticker — RELIANCE.NS · MARUTI.NS …'}
            style={{
              flex: 1, background: 'var(--bg-deep)', color: '#fff',
              border: '1px solid var(--border)', borderRadius: '4px',
              padding: '6px 10px', fontSize: '11px', fontFamily: 'inherit', outline: 'none',
            }}
          />
          <button onClick={submit} style={{
            padding: '6px 14px', borderRadius: '4px', cursor: 'pointer',
            border: '1px solid #a78bfa', background: 'rgba(167,139,250,0.12)',
            color: '#a78bfa', fontSize: '10px', fontFamily: 'inherit', letterSpacing: '0.08em',
          }}>MAP</button>
        </div>
        {/* Quick-pick: only seeded tickers in current region */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {quickPicks.map(t => (
            <button key={t} onClick={() => recenter(t)} style={{
              padding: '3px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
              fontFamily: 'inherit',
              border: `1px solid ${resolved === t ? '#a78bfa' : 'var(--border)'}`,
              background: resolved === t ? 'rgba(167,139,250,0.10)' : 'transparent',
              color:      resolved === t ? '#a78bfa' : 'var(--text-muted)',
            }}>{tickerLabel(t)}</button>
          ))}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', position: 'relative',
                    background: 'radial-gradient(circle at center, rgba(167,139,250,0.025) 0%, transparent 60%)' }}>
        {isLoading && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)',
                        fontSize: '11px' }}>
            Loading verified supply-chain database…
          </div>
        )}

        {!isLoading && error && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--negative)',
                        fontSize: '11px' }}>
            Failed to load /data/supply-chain.json
          </div>
        )}

        {!isLoading && !error && data && !resolved && (
          <NoCoverage ticker={target} region={region} quickPicks={quickPicks} onPick={recenter} />
        )}

        {!isLoading && !error && data && resolved && company && (
          <MapView
            data={data}
            target={resolved}
            company={company}
            suppliers={suppliers}
            customers={customers}
            ownership={ownership}
            ownedBy={ownedBy}
            onPick={setPicked}
            onRecenter={recenter}
            hovered={hovered}
            setHovered={setHovered}
            showAll={showAll}
            setShowAll={setShowAll}
          />
        )}
      </div>

      {/* ── Detail drawer ──────────────────────────────────────────────────── */}
      {picked && data && (
        <EdgeDetail
          edge={picked}
          companies={data.companies}
          target={resolved!}
          onClose={() => setPicked(null)}
          onRecenter={recenter}
        />
      )}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
        fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center',
      }}>
        SEC EDGAR · NSE/BSE filings · supplier disclosures · every edge cites a public source
      </div>
    </div>
  )
}

// ── NO COVERAGE ───────────────────────────────────────────────────────────────
function NoCoverage({
  ticker, region, quickPicks, onPick,
}: { ticker: string; region: Region; quickPicks: string[]; onPick: (t: string) => void }) {
  const idx = region === 'us' ? 'S&P 500' : 'NIFTY 50'
  return (
    <div style={{ padding: '32px 20px', textAlign: 'center', maxWidth: '520px', margin: '0 auto' }}>
      <div style={{ fontSize: '13px', color: '#fff', marginBottom: '8px', fontWeight: 700 }}>
        <span style={{ color: '#a78bfa' }}>{ticker}</span> not yet in dataset
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '14px' }}>
        Coverage: {quickPicks.length} {idx} companies seeded. Re-runs quarterly.
        To add ahead of schedule, run the extractor and submit a PR:
      </div>
      <div style={{ background: 'var(--bg-deep)', border: '1px solid var(--border)',
                    borderRadius: '4px', padding: '10px 12px', marginBottom: '14px',
                    fontSize: '11px', color: '#a78bfa', textAlign: 'left' }}>
        npx tsx scripts/extract-supply-chain.ts {ticker} --write
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '12px',
                    letterSpacing: '0.08em' }}>
        OR PICK A SEEDED COMPANY
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', justifyContent: 'center' }}>
        {quickPicks.map(t => (
          <button key={t} onClick={() => onPick(t)} style={{
            padding: '4px 10px', borderRadius: '3px', cursor: 'pointer', fontSize: '11px',
            fontFamily: 'JetBrains Mono, monospace',
            border: '1px solid var(--border)', background: 'transparent', color: '#fff',
          }}>{tickerLabel(t)}</button>
        ))}
      </div>
    </div>
  )
}

// ── MAP: 3-column layout + SVG connectors ────────────────────────────────────
interface CurvePath { key: string; d: string; color: string; weight: number }

function MapView({
  data, target, company, suppliers, customers, ownership, ownedBy,
  onPick, onRecenter, hovered, setHovered, showAll, setShowAll,
}: {
  data: DataFile; target: string; company: Company
  suppliers: Edge[]; customers: Edge[]; ownership: Edge[]; ownedBy: Edge[]
  onPick: (e: Edge) => void; onRecenter: (t: string) => void
  hovered: string | null; setHovered: (s: string | null) => void
  showAll: boolean; setShowAll: (b: boolean) => void
}) {
  const VISIBLE = showAll ? 999 : 8
  const truncSup = suppliers.slice(0, VISIBLE)
  const truncCus = customers.slice(0, VISIBLE)
  const supMore  = Math.max(0, suppliers.length - truncSup.length)
  const cusMore  = Math.max(0, customers.length - truncCus.length)

  const empty = suppliers.length + customers.length + ownership.length + ownedBy.length === 0

  // Refs for connector geometry
  const wrapRef    = useRef<HTMLDivElement>(null)
  const targetRef  = useRef<HTMLDivElement>(null)
  const peerRefs   = useRef<Map<string, HTMLDivElement>>(new Map())
  const [paths, setPaths] = useState<CurvePath[]>([])

  const setPeerRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) peerRefs.current.set(key, el)
    else    peerRefs.current.delete(key)
  }

  // Compute paths after layout, re-compute on resize
  useLayoutEffect(() => {
    const compute = () => {
      const wrap = wrapRef.current; const tgt = targetRef.current
      if (!wrap || !tgt) return
      const wRect = wrap.getBoundingClientRect()
      const tRect = tgt.getBoundingClientRect()
      const tCx = tRect.left - wRect.left + tRect.width / 2
      const tLeftEdge  = tRect.left - wRect.left
      const tRightEdge = tRect.right - wRect.left
      const tCy = tRect.top - wRect.top + tRect.height / 2

      const newPaths: CurvePath[] = []
      for (const [key, el] of peerRefs.current) {
        const r = el.getBoundingClientRect()
        const py = r.top - wRect.top + r.height / 2
        const isLeft = (r.left - wRect.left + r.width / 2) < tCx
        const px = isLeft ? r.right - wRect.left : r.left - wRect.left
        const tx = isLeft ? tLeftEdge : tRightEdge
        // Bezier control points pull toward the target horizontally
        const dx = Math.abs(tx - px)
        const cp1x = isLeft ? px + dx * 0.55 : px - dx * 0.55
        const cp2x = isLeft ? tx - dx * 0.40 : tx + dx * 0.40
        const d = `M ${px} ${py} C ${cp1x} ${py}, ${cp2x} ${tCy}, ${tx} ${tCy}`
        const meta = (el as HTMLElement).dataset
        const conf = (meta.conf as Confidence) || 'medium'
        const hasRev = meta.hasrev === '1'
        newPaths.push({
          key, d,
          color:  CONF_COLOR[conf],
          weight: hasRev ? 2 : 1.2,
        })
      }
      setPaths(newPaths)
    }
    compute()
    const ro = new ResizeObserver(compute)
    if (wrapRef.current) ro.observe(wrapRef.current)
    window.addEventListener('resize', compute)
    return () => { ro.disconnect(); window.removeEventListener('resize', compute) }
  // Stable primitive deps — avoids infinite loop from .slice() creating new array refs every render
  }, [target, showAll, suppliers.length, customers.length])

  return (
    <div style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

      {/* Ownership bar */}
      {(ownedBy.length > 0 || ownership.length > 0) && (
        <div style={{
          padding: '8px 12px', borderRadius: '5px',
          background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)',
          display: 'flex', flexWrap: 'wrap', gap: '14px', alignItems: 'center',
        }}>
          {ownedBy.map(e => (
            <OwnershipChip key={'p'+e.supplier} edge={e} role="parent"
                          companies={data.companies} onPick={onPick} onRecenter={onRecenter} />
          ))}
          {ownership.map(e => (
            <OwnershipChip key={'s'+e.customer} edge={e} role="subsidiary"
                          companies={data.companies} onPick={onPick} onRecenter={onRecenter} />
          ))}
        </div>
      )}

      {/* 3-column with SVG connector layer behind */}
      <div ref={wrapRef} style={{ position: 'relative',
                                   display: 'grid', gridTemplateColumns: '1fr auto 1fr',
                                   gap: '40px', alignItems: 'start' }}>

        {/* SVG connector layer — CSS-sized so no box state needed */}
        {paths.length > 0 && (
          <svg style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: 0, overflow: 'visible',
          }}>
            <defs>
              {/* Subtle glow filter for hovered line */}
              <filter id="glow">
                <feGaussianBlur stdDeviation="2" result="b"/>
                <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            {paths.map(p => {
              const isHovered = hovered === p.key
              return (
                <g key={p.key}>
                  <path d={p.d} fill="none" stroke={p.color}
                        strokeWidth={isHovered ? p.weight + 1.5 : p.weight}
                        strokeOpacity={isHovered ? 0.95 : 0.45}
                        strokeLinecap="round"
                        filter={isHovered ? 'url(#glow)' : undefined}
                        style={{ transition: 'stroke-opacity 0.15s, stroke-width 0.15s' }} />
                </g>
              )
            })}
          </svg>
        )}

        {/* Suppliers column */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <ColumnHeader label="UPSTREAM · SUPPLIES" count={suppliers.length} side="left" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {truncSup.map(e => {
              const k = `s-${e.supplier}-${e.category}`
              return (
                <PeerCard key={k} edgeKey={k} edge={e}
                          peer={e.supplier} side="left"
                          companies={data.companies}
                          onPick={onPick} onRecenter={onRecenter}
                          onHover={setHovered}
                          peerRef={setPeerRef(k)} />
              )
            })}
            {suppliers.length === 0 && <EmptyNote text="No supplier disclosures in dataset." />}
          </div>
        </div>

        {/* Center node */}
        <div style={{ minWidth: '180px', maxWidth: '220px', position: 'relative', zIndex: 1,
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      paddingTop: '24px' }}>
          <div ref={targetRef} style={{ width: '100%' }}>
            <CenterNode ticker={target} company={company} />
          </div>
        </div>

        {/* Customers column */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <ColumnHeader label="DOWNSTREAM · BUYS" count={customers.length} side="right" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {truncCus.map(e => {
              const k = `c-${e.customer}-${e.category}`
              return (
                <PeerCard key={k} edgeKey={k} edge={e}
                          peer={e.customer} side="right"
                          companies={data.companies}
                          onPick={onPick} onRecenter={onRecenter}
                          onHover={setHovered}
                          peerRef={setPeerRef(k)} />
              )
            })}
            {customers.length === 0 && <EmptyNote text="No customer disclosures in dataset." />}
          </div>
        </div>
      </div>

      {(supMore > 0 || cusMore > 0) && (
        <button onClick={() => setShowAll(!showAll)} style={{
          alignSelf: 'center', padding: '5px 14px', borderRadius: '3px', cursor: 'pointer',
          fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
          border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
          letterSpacing: '0.08em',
        }}>
          {showAll ? 'COLLAPSE' : `SHOW ALL · +${supMore + cusMore} MORE`}
        </button>
      )}

      {empty && (
        <div style={{ padding: '20px', textAlign: 'center', fontSize: '11px',
                      color: 'var(--text-muted)' }}>
          Company is in the database but has no recorded supply-chain edges yet.
        </div>
      )}
    </div>
  )
}

// ── Center node ──────────────────────────────────────────────────────────────
function CenterNode({ ticker, company }: { ticker: string; company: Company }) {
  return (
    <div style={{
      padding: '12px 14px', borderRadius: '8px', textAlign: 'center', width: '100%',
      border: '2px solid #a78bfa', background: 'rgba(167,139,250,0.10)',
      boxShadow: '0 0 24px rgba(167,139,250,0.15), inset 0 0 12px rgba(167,139,250,0.05)',
    }}>
      <div style={{ fontSize: '18px', fontWeight: 900, color: '#fff',
                    fontFamily: 'Syne, sans-serif', lineHeight: 1.1 }}>
        {tickerLabel(ticker)}
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px',
                    lineHeight: 1.3 }}>
        {company.name}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginTop: '6px',
                    flexWrap: 'wrap' }}>
        <Tag>{company.country}</Tag>
        <Tag>{company.exchange}</Tag>
      </div>
      <div style={{ fontSize: '10px', color: '#a78bfa', marginTop: '4px',
                    fontFamily: 'JetBrains Mono, monospace' }}>
        {company.sector}
      </div>
    </div>
  )
}

function ColumnHeader({ label, count, side }:
                      { label: string; count: number; side: 'left'|'right' }) {
  return (
    <div style={{
      fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.12em',
      marginBottom: '8px', fontFamily: 'JetBrains Mono, monospace',
      textAlign: side === 'left' ? 'right' : 'left',
      paddingRight: side === 'left' ? '4px' : 0,
      paddingLeft:  side === 'right' ? '4px' : 0,
    }}>
      {label} <span style={{ color: '#a78bfa', marginLeft: '4px' }}>{count}</span>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '2px',
                   background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)',
                   border: '1px solid var(--border)', letterSpacing: '0.06em' }}>
      {children}
    </span>
  )
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div style={{ padding: '10px', borderRadius: '4px', background: 'rgba(255,255,255,0.02)',
                  border: '1px dashed var(--border)', textAlign: 'center',
                  fontSize: '10px', color: 'var(--text-muted)' }}>
      {text}
    </div>
  )
}

// ── Ownership chip ───────────────────────────────────────────────────────────
function OwnershipChip({
  edge, role, companies, onPick, onRecenter,
}: {
  edge: Edge; role: 'parent' | 'subsidiary'
  companies: Record<string, Company>
  onPick: (e: Edge) => void; onRecenter: (t: string) => void
}) {
  const counterTicker = role === 'parent' ? edge.supplier : edge.customer
  const counter = companies[counterTicker]
  if (!counter) return null
  const labelTxt = role === 'parent' ? 'PARENT' : 'SUBSIDIARY'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
      <span style={{ fontSize: '9px', letterSpacing: '0.1em', color: '#a78bfa',
                     fontFamily: 'JetBrains Mono, monospace' }}>
        {labelTxt} →
      </span>
      <button onClick={() => onRecenter(counterTicker)} title="Recenter map"
              style={{ padding: '3px 8px', borderRadius: '3px', cursor: 'pointer',
                       border: '1px solid rgba(167,139,250,0.3)',
                       background: 'rgba(167,139,250,0.06)', color: '#fff',
                       fontSize: '11px', fontWeight: 700,
                       fontFamily: 'Syne, sans-serif' }}>
        {tickerLabel(counterTicker)}
      </button>
      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
        {counter.name}
      </span>
      {edge.stakePct != null && (
        <span style={{ fontSize: '10px', color: '#f0a500',
                       fontFamily: 'JetBrains Mono, monospace' }}>
          · {edge.stakePct}% stake
        </span>
      )}
      <button onClick={() => onPick(edge)} title="View source"
              style={{ marginLeft: 'auto', fontSize: '10px', padding: '2px 6px',
                       borderRadius: '2px', cursor: 'pointer',
                       border: '1px solid var(--border)', background: 'transparent',
                       color: 'var(--text-muted)' }}>
        SOURCE
      </button>
    </div>
  )
}

// ── PeerCard: a supplier or customer node ────────────────────────────────────
function PeerCard({
  edge, peer, side, companies, onPick, onRecenter, onHover, peerRef, edgeKey,
}: {
  edge: Edge; peer: string; side: 'left' | 'right'
  companies: Record<string, Company>
  onPick: (e: Edge) => void; onRecenter: (t: string) => void
  onHover: (k: string | null) => void
  peerRef: (el: HTMLDivElement | null) => void
  edgeKey: string
}) {
  const c = companies[peer]
  const known = !!c
  const conf = edge.confidence
  const confColor = CONF_COLOR[conf]

  return (
    <div ref={peerRef}
         data-conf={conf}
         data-hasrev={edge.revenuePct != null ? '1' : '0'}
         onMouseEnter={() => onHover(edgeKey)}
         onMouseLeave={() => onHover(null)}
         style={{
      padding: '8px 10px', borderRadius: '6px',
      border: `1px solid ${confColor}33`,
      background: 'var(--bg-secondary)',
      display: 'flex', flexDirection: 'column', gap: '4px',
      borderLeft: side === 'left' ? `3px solid ${confColor}` : `1px solid ${confColor}33`,
      borderRight: side === 'right' ? `3px solid ${confColor}` : `1px solid ${confColor}33`,
      transition: 'transform 0.12s, box-shadow 0.12s',
      cursor: 'default',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                    gap: '6px' }}>
        <button onClick={() => known && onRecenter(peer)} disabled={!known}
                title={known ? 'Recenter map' : 'Not in dataset'}
                style={{
                  padding: 0, background: 'transparent', border: 'none',
                  cursor: known ? 'pointer' : 'default',
                  textAlign: side === 'left' ? 'right' : 'left',
                  color: known ? '#fff' : 'var(--text-muted)',
                  fontSize: '12px', fontWeight: 700, fontFamily: 'Syne, sans-serif',
                  textDecoration: known ? 'underline' : 'none',
                  textDecorationColor: 'rgba(255,255,255,0.2)',
                  textUnderlineOffset: '3px',
                }}>
          {tickerLabel(peer)}
        </button>
        <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: '2px',
                       background: `${confColor}15`, color: confColor,
                       border: `1px solid ${confColor}40`, letterSpacing: '0.06em',
                       fontFamily: 'JetBrains Mono, monospace' }}>
          {CONF_LABEL[conf]}
        </span>
      </div>

      <div style={{ fontSize: '10px', color: 'var(--text-muted)',
                    textAlign: side === 'left' ? 'right' : 'left', lineHeight: 1.3 }}>
        {c?.name ?? 'Not in dataset'} · {c?.country ?? '—'}
      </div>

      <div style={{ fontSize: '11px', color: '#fff', lineHeight: 1.4,
                    textAlign: side === 'left' ? 'right' : 'left' }}>
        {edge.category}
      </div>

      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap',
                    justifyContent: side === 'left' ? 'flex-end' : 'flex-start',
                    marginTop: '2px' }}>
        {edge.revenuePct != null && (
          <span style={{ fontSize: '10px', padding: '1px 5px', borderRadius: '2px',
                         background: 'rgba(240,165,0,0.12)', color: '#f0a500',
                         border: '1px solid rgba(240,165,0,0.3)',
                         fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
            {edge.revenuePct}% of {tickerLabel(edge.supplier)} rev
          </span>
        )}
        <button onClick={() => onPick(edge)} style={{
          fontSize: '10px', padding: '1px 6px', borderRadius: '2px', cursor: 'pointer',
          border: '1px solid var(--border)', background: 'transparent',
          color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace',
        }}>
          PROOF →
        </button>
      </div>
    </div>
  )
}

// ── Edge detail drawer ───────────────────────────────────────────────────────
function EdgeDetail({
  edge, companies, target, onClose, onRecenter,
}: {
  edge: Edge; companies: Record<string, Company>; target: string
  onClose: () => void; onRecenter: (t: string) => void
}) {
  const sup = companies[edge.supplier]
  const cus = companies[edge.customer]
  const confColor = CONF_COLOR[edge.confidence]

  return (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 50,
      background: 'var(--bg-deep)', borderTop: `2px solid ${confColor}`,
      padding: '12px 14px', maxHeight: '60%', overflowY: 'auto',
      boxShadow: '0 -8px 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => onRecenter(edge.supplier)}
                  style={tickerBtnStyle(edge.supplier === target)}>
            {tickerLabel(edge.supplier)}
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
            {edge.type === 'ownership' ? 'OWNS' : 'SUPPLIES'} →
          </span>
          <button onClick={() => onRecenter(edge.customer)}
                  style={tickerBtnStyle(edge.customer === target)}>
            {tickerLabel(edge.customer)}
          </button>
          <span style={{ fontSize: '10px', color: confColor,
                         padding: '2px 6px', borderRadius: '2px',
                         background: `${confColor}12`, border: `1px solid ${confColor}40`,
                         fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em' }}>
            CONFIDENCE · {CONF_LABEL[edge.confidence]}
          </span>
        </div>
        <button onClick={onClose} style={{
          fontSize: '12px', padding: '3px 9px', borderRadius: '3px', cursor: 'pointer',
          border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
          fontFamily: 'JetBrains Mono, monospace',
        }}>CLOSE ✕</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
                    marginBottom: '10px' }}>
        <Mini label="SUPPLIER" body={sup?.name ?? edge.supplier}
              sub={`${sup?.country ?? '—'} · ${sup?.exchange ?? '—'}`} />
        <Mini label="CUSTOMER" body={cus?.name ?? edge.customer}
              sub={`${cus?.country ?? '—'} · ${cus?.exchange ?? '—'}`} />
      </div>

      <div style={{ marginBottom: '8px' }}>
        <Label>CATEGORY</Label>
        <div style={{ fontSize: '12px', color: '#fff', lineHeight: 1.4 }}>{edge.category}</div>
      </div>

      <div style={{ marginBottom: '8px' }}>
        <Label>EVIDENCE</Label>
        <div style={{ fontSize: '11px', color: 'var(--text-2)', lineHeight: 1.6,
                      borderLeft: `3px solid ${confColor}`,
                      background: 'rgba(255,255,255,0.02)', padding: '8px 10px',
                      borderRadius: '3px' }}>
          {edge.evidence}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center',
                    fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}>
        <a href={edge.sourceUrl} target="_blank" rel="noopener noreferrer" style={{
          padding: '4px 10px', borderRadius: '3px', textDecoration: 'none',
          border: '1px solid #a78bfa', background: 'rgba(167,139,250,0.1)', color: '#a78bfa',
          letterSpacing: '0.08em', fontWeight: 700,
        }}>
          ↗ {edge.sourceType.toUpperCase()} SOURCE
        </a>
        <span style={{ color: 'var(--text-muted)' }}>FILED · {shortDate(edge.sourceDate)}</span>
        {edge.revenuePct != null && (
          <span style={{ color: '#f0a500', fontWeight: 700 }}>
            REVENUE EXPOSURE · {edge.revenuePct}%
          </span>
        )}
        {edge.stakePct != null && (
          <span style={{ color: '#f0a500', fontWeight: 700 }}>
            STAKE · {edge.stakePct}%
          </span>
        )}
      </div>
    </div>
  )
}

function tickerBtnStyle(isTarget: boolean): React.CSSProperties {
  return {
    padding: '3px 10px', borderRadius: '3px', cursor: 'pointer',
    border: `1px solid ${isTarget ? '#a78bfa' : 'var(--border)'}`,
    background: isTarget ? 'rgba(167,139,250,0.12)' : 'transparent',
    color: isTarget ? '#a78bfa' : '#fff',
    fontSize: '12px', fontWeight: 700, fontFamily: 'Syne, sans-serif',
  }
}

function Mini({ label, body, sub }: { label: string; body: string; sub: string }) {
  return (
    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: '4px', padding: '6px 10px' }}>
      <Label>{label}</Label>
      <div style={{ fontSize: '11px', color: '#fff', fontWeight: 700 }}>{body}</div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '1px' }}>{sub}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.12em',
                  marginBottom: '3px', fontFamily: 'JetBrains Mono, monospace' }}>
      {children}
    </div>
  )
}
