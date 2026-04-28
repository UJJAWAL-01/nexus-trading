'use client'
// src/components/panels/SecFilingsPanel.tsx
// SEC filing alerts — structured data, zero AI tokens.
// 8-K: shows filed items (e.g. "Earnings Results · Leadership Change") + press release excerpt
// 13D/G: filer name, ownership %, shares
// S-1: offering headline

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useWatchlist } from '@/store/watchlist'

// ── Types (mirror server) ─────────────────────────────────────────────────────
interface FilingItem8K  { code: string; label: string; importance: 'high' | 'medium' | 'low' }
interface Ownership13D {
  filerName:      string | null
  pctOwned:       number | null
  sharesHeld:     number | null
  sharesAcquired: number | null
  purpose:        string | null
}
interface ParsedFiling {
  formType:      string
  filingDate:    string
  accession:     string
  documentUrl:   string
  fullTextUrl:   string
  excerpt:       string | null
  items8K:       FilingItem8K[]
  ownership13D:  Ownership13D | null
  exhibitSource: boolean
}
interface SecFilingsResponse {
  ticker:      string
  companyName: string
  cik:         string
  filings:     ParsedFiling[]
  lastUpdated: string
  error?:      string
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

// ── Form type metadata ────────────────────────────────────────────────────────
const FORM_META: Record<string, { color: string; bg: string; description: string }> = {
  '8-K':   { color: '#f0a500',         bg: 'rgba(240,165,0,0.12)',    description: 'Material Event' },
  '8-K/A': { color: '#f0a500',         bg: 'rgba(240,165,0,0.08)',    description: 'Amended Filing' },
  'S-1':   { color: 'var(--teal)',     bg: 'rgba(0,229,192,0.12)',   description: 'IPO Registration' },
  'S-1/A': { color: 'var(--teal)',     bg: 'rgba(0,229,192,0.08)',   description: 'Amended S-1' },
  '13D':   { color: 'var(--negative)', bg: 'rgba(255,69,96,0.12)',   description: '>5% Ownership Change' },
  '13D/A': { color: 'var(--negative)', bg: 'rgba(255,69,96,0.08)',   description: 'Amended 13D' },
  '13G':   { color: '#a78bfa',         bg: 'rgba(167,139,250,0.12)', description: 'Passive >5% Stake' },
  '13G/A': { color: '#a78bfa',         bg: 'rgba(167,139,250,0.08)', description: 'Amended 13G' },
  '10-K':  { color: '#1e90ff',         bg: 'rgba(30,144,255,0.12)',  description: 'Annual Report' },
  '10-Q':  { color: '#38bdf8',         bg: 'rgba(56,189,248,0.12)',  description: 'Quarterly Report' },
}
function fmtMeta(t: string) {
  return FORM_META[t] ?? { color: 'var(--text-muted)', bg: 'rgba(255,255,255,0.04)', description: t }
}

const IMPORTANCE_COLOR = {
  high:   { color: '#fff',              bg: 'rgba(255,255,255,0.12)',  border: 'rgba(255,255,255,0.2)' },
  medium: { color: 'var(--text-2)',     bg: 'rgba(255,255,255,0.06)',  border: 'var(--border)' },
  low:    { color: 'var(--text-muted)', bg: 'transparent',             border: 'var(--border)' },
}

function relDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 7)   return `${days}d ago`
  if (days < 30)  return `${Math.floor(days / 7)}w ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

const ALL_TYPES = ['8-K', 'S-1', '13D'] as const

// ── Main panel ────────────────────────────────────────────────────────────────
export default function SecFilingsPanel() {
  const watchlist = useWatchlist(s => s.symbols)
  const [input,  setInput]  = useState('AAPL')
  const [ticker, setTicker] = useState('AAPL')
  const [active, setActive] = useState<Set<string>>(new Set(ALL_TYPES))

  const typesParam = useMemo(() => [...active].sort().join(','), [active])
  const url = ticker && active.size > 0
    ? `/api/sec-filings?ticker=${encodeURIComponent(ticker)}&types=${encodeURIComponent(typesParam)}&limit=10`
    : null

  const { data, error, isLoading, mutate } = useSWR<SecFilingsResponse>(url, fetcher, {
    revalidateOnFocus: false, dedupingInterval: 60_000,
  })

  const submit = () => { const v = input.trim().toUpperCase(); if (v) setTicker(v) }
  const toggleType = (t: string) =>
    setActive(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'JetBrains Mono, monospace' }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ flexShrink: 0, justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#f97316', flexShrink: 0 }} />
          <span style={{ fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700 }}>SEC FILINGS</span>
          {data?.companyName && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>· {data.companyName}</span>
          )}
        </div>
        <button onClick={() => mutate()} disabled={isLoading} style={{
          fontSize: '10px', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
          border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
        }}>
          {isLoading ? '···' : '↺ Refresh'}
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
                    display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={input} onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="Ticker"
          style={{
            flex: 1, minWidth: '100px', background: 'var(--bg-deep)', color: '#fff',
            border: '1px solid var(--border)', borderRadius: '4px',
            padding: '5px 8px', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', outline: 'none',
          }}
        />
        <button onClick={submit} style={{
          padding: '5px 12px', borderRadius: '3px', cursor: 'pointer',
          border: '1px solid #f97316', background: 'rgba(249,115,22,0.12)',
          color: '#f97316', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
        }}>SEARCH</button>
        {watchlist.slice(0, 4).map(s => (
          <button key={s} onClick={() => { setInput(s); setTicker(s) }} style={{
            padding: '3px 7px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
            border: `1px solid ${ticker === s ? '#f97316' : 'var(--border)'}`,
            background: ticker === s ? 'rgba(249,115,22,0.08)' : 'transparent',
            color: ticker === s ? '#f97316' : 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace',
          }}>{s}</button>
        ))}
      </div>

      {/* ── Form type filters ───────────────────────────────────────────── */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
                    display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>FORMS</span>
        {ALL_TYPES.map(t => {
          const m  = fmtMeta(t)
          const on = active.has(t)
          return (
            <button key={t} onClick={() => toggleType(t)} style={{
              padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
              border: `1px solid ${on ? m.color : 'var(--border)'}`,
              background: on ? m.bg : 'transparent',
              color: on ? m.color : 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            }}>
              {on ? '✓ ' : ''}{t}
              <span style={{ marginLeft: '4px', fontWeight: 400, fontSize: '9px', opacity: 0.7 }}>
                {fmtMeta(t).description}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
            <div style={{ marginBottom: '6px' }}>Fetching EDGAR filings…</div>
            <div style={{ fontSize: '10px' }}>Parsing filing documents (5-10 s first load)</div>
          </div>
        )}

        {!isLoading && error && (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '11px' }}>
            <div style={{ color: 'var(--negative)', marginBottom: '6px' }}>⚠ Network error</div>
            <button onClick={() => mutate()} style={{
              padding: '4px 10px', borderRadius: '3px', cursor: 'pointer', fontSize: '11px',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
            }}>↺ Retry</button>
          </div>
        )}

        {!isLoading && !error && data?.error && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--negative)', fontSize: '11px' }}>
            ⚠ {data.error}
          </div>
        )}

        {!isLoading && !error && data && !data.error && data.filings.length === 0 && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
            No recent filings of the selected types for <strong style={{ color: '#fff' }}>{data.ticker}</strong>.
          </div>
        )}

        {!isLoading && !error && data?.filings && data.filings.length > 0 && (
          <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {data.filings.map(f => <FilingCard key={f.accession} filing={f} />)}
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <div style={{
        padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
        fontSize: '10px', color: 'var(--text-muted)', display: 'flex',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px',
      }}>
        <span>Source: SEC EDGAR · 1h cache</span>
        <span>Always review full filings on SEC.gov for accuracy.</span>
      </div>
    </div>
  )
}

// ── Filing card ───────────────────────────────────────────────────────────────
function FilingCard({ filing }: { filing: ParsedFiling }) {
  const m = fmtMeta(filing.formType)

  const is13D  = filing.formType.startsWith('13D') || filing.formType.startsWith('13G')
  const is8K   = filing.formType.startsWith('8-K')
  const isS1   = filing.formType.startsWith('S-1')

  // Derive a concise "what happened" headline
  const headline = (() => {
    if (is13D && filing.ownership13D) {
      const o = filing.ownership13D
      const parts: string[] = []
      if (o.filerName) parts.push(o.filerName)
      if (o.pctOwned !== null) parts.push(`${o.pctOwned}% stake`)
      if (o.purpose) parts.push(o.purpose)
      return parts.join(' · ') || null
    }
    if (is8K && filing.items8K.length > 0) {
      const highItems = filing.items8K.filter(i => i.importance === 'high')
      const show = highItems.length > 0 ? highItems : filing.items8K
      return show.map(i => i.label).join(' · ')
    }
    if (isS1) return 'New IPO registration'
    return null
  })()

  const linkUrl = filing.documentUrl || filing.fullTextUrl
  const indexUrl = filing.fullTextUrl

  return (
    <div style={{
      borderRadius: '5px',
      background: 'rgba(255,255,255,0.015)',
      border: `1px solid var(--border)`,
      borderLeft: `3px solid ${m.color}`,
      overflow: 'hidden',
    }}>
      {/* Card header */}
      <div style={{
        padding: '8px 12px',
        display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap',
        borderBottom: filing.excerpt || filing.items8K.length > 0 ? '1px solid var(--border)' : 'none',
      }}>
        {/* Form type badge */}
        <span style={{
          fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: '3px',
          background: m.bg, color: m.color, letterSpacing: '0.08em', flexShrink: 0,
        }}>
          {filing.formType}
        </span>

        {/* Headline */}
        {headline && (
          <span style={{ fontSize: '11px', color: '#fff', flex: 1, fontWeight: 600 }}>
            {headline}
          </span>
        )}

        {/* Date */}
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>
          {relDate(filing.filingDate)} · {filing.filingDate}
        </span>
      </div>

      {/* 8-K item tags */}
      {is8K && filing.items8K.length > 0 && (
        <div style={{
          padding: '6px 12px', display: 'flex', gap: '4px', flexWrap: 'wrap',
          borderBottom: filing.excerpt ? '1px solid var(--border)' : 'none',
        }}>
          {filing.items8K.map(item => {
            const ic = IMPORTANCE_COLOR[item.importance]
            return (
              <span key={item.code} style={{
                fontSize: '10px', padding: '2px 6px', borderRadius: '3px',
                background: ic.bg, color: ic.color,
                border: `1px solid ${ic.border}`,
                fontWeight: item.importance === 'high' ? 700 : 400,
              }}>
                <span style={{ color: m.color, marginRight: '4px' }}>§{item.code}</span>
                {item.label}
              </span>
            )
          })}
        </div>
      )}

      {/* 13D ownership detail tiles */}
      {is13D && filing.ownership13D && (() => {
        const o = filing.ownership13D
        const tiles = [
          o.pctOwned     !== null ? { label: 'OWNERSHIP',  value: `${o.pctOwned}%` }         : null,
          o.sharesHeld   !== null ? { label: 'SHARES HELD', value: fmtShares(o.sharesHeld) }  : null,
          o.sharesAcquired!== null ? { label: 'ACQUIRED',   value: fmtShares(o.sharesAcquired) } : null,
          o.purpose               ? { label: 'PURPOSE',     value: o.purpose }                : null,
        ].filter((x): x is { label: string; value: string } => x !== null)
        if (tiles.length === 0) return null
        return (
          <div style={{
            padding: '8px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap',
            borderBottom: filing.excerpt ? '1px solid var(--border)' : 'none',
          }}>
            {tiles.map(t => (
              <div key={t.label} style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>{t.label}</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: m.color, fontFamily: 'JetBrains Mono, monospace' }}>
                  {t.value}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* Excerpt */}
      {filing.excerpt && (
        <div style={{ padding: '8px 12px' }}>
          {filing.exhibitSource && (
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginRight: '6px' }}>
              PRESS RELEASE ·
            </span>
          )}
          <span style={{ fontSize: '11px', color: 'var(--text-2)', lineHeight: 1.55 }}>
            {filing.excerpt}
          </span>
        </div>
      )}

      {/* Footer link */}
      <div style={{
        padding: '6px 12px',
        display: 'flex', gap: '12px', alignItems: 'center',
        borderTop: '1px solid var(--border)',
        background: 'rgba(255,255,255,0.01)',
      }}>
        <a href={linkUrl} target="_blank" rel="noopener noreferrer" style={{
          fontSize: '10px', color: m.color, textDecoration: 'none', fontWeight: 600,
        }}>
          View document →
        </a>
        {linkUrl !== indexUrl && (
          <a href={indexUrl} target="_blank" rel="noopener noreferrer" style={{
            fontSize: '10px', color: 'var(--text-muted)', textDecoration: 'none',
          }}>
            Filing index
          </a>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--text-muted)' }}>
          SEC EDGAR · {filing.accession}
        </span>
      </div>
    </div>
  )
}

function fmtShares(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return n.toLocaleString('en-US')
}
