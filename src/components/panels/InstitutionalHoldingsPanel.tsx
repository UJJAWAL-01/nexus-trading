'use client'
// src/components/panels/InstitutionalHoldingsPanel.tsx
// 13F-HR institutional-holdings tracker.
//   • By Institution: pick from a curated list of major filers, see top holdings + QoQ change
//   • By Ticker:      enter a ticker, see which major institutions hold it

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useWatchlist } from '@/store/watchlist'

// ── Types (mirror server payload) ─────────────────────────────────────────────
interface HoldingChange {
  shares: number
  value:  number
  type:   'new' | 'increased' | 'decreased' | 'exited' | 'unchanged'
}
interface HoldingRow {
  cusip:              string
  name:               string
  shares:             number
  value:              number
  percentOfPortfolio: number
  putCall:            'Put' | 'Call' | null
  change:             HoldingChange
}
interface HoldingsResponse {
  institution:        { name: string; cik: string }
  filingDate:         string
  reportDate:         string
  priorReportDate:    string | null
  holdings:           HoldingRow[]
  totalPortfolioValue: number
  newPositions:       number
  exitedPositions:    number
  nextFilingDue:      string
  source:             string
  lastUpdated:        string
  error?:             string
}
interface TickerLookup {
  ticker:    string
  name:      string
  appearsIn: {
    institution: { name: string; cik: string }
    filingDate:  string
    shares:      number
    value:       number
    percentOfPortfolio: number
    change:      HoldingChange
  }[]
  error?: string
}

// ── Curated institution list (must match server) ──────────────────────────────
const MAJOR_INSTITUTIONS = [
  { name: 'Berkshire Hathaway',           cik: '0001067983' },
  { name: 'Vanguard Group',               cik: '0000102909' },
  { name: 'BlackRock',                    cik: '0001364742' },
  { name: 'State Street',                 cik: '0000093751' },
  { name: 'ARK Investment Management',    cik: '0001697748' },
  { name: 'Bridgewater Associates',       cik: '0001350694' },
  { name: 'Renaissance Technologies',     cik: '0001037389' },
  { name: 'Two Sigma Investments',        cik: '0001179392' },
  { name: 'Citadel Advisors',             cik: '0001423053' },
  { name: 'Tiger Global Management',      cik: '0001167483' },
  { name: 'Soros Fund Management',        cik: '0001029160' },
  { name: 'Pershing Square Capital',      cik: '0001336528' },
  { name: 'Appaloosa Management',         cik: '0001656456' },
  { name: 'Baupost Group',                cik: '0001061165' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
const fetcher = (url: string) => fetch(url).then(r => r.json())

function fmtUSD(v: number): string {
  if (!v) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function fmtShares(n: number): string {
  if (!n) return '—'
  return n.toLocaleString('en-US')
}

const CHANGE_META: Record<HoldingChange['type'], { color: string; bg: string; label: string; icon: string }> = {
  new:       { color: 'var(--teal)',     bg: 'rgba(0,229,192,0.12)', label: 'NEW',       icon: '★' },
  increased: { color: 'var(--positive)', bg: 'rgba(0,201,122,0.12)', label: 'INCREASED', icon: '↑' },
  decreased: { color: '#f0a500',         bg: 'rgba(240,165,0,0.12)', label: 'DECREASED', icon: '↓' },
  exited:    { color: 'var(--negative)', bg: 'rgba(255,69,96,0.12)', label: 'EXITED',    icon: '✕' },
  unchanged: { color: 'var(--text-muted)', bg: 'transparent',          label: '—',         icon: '·' },
}

type Tab = 'institution' | 'ticker'
type SortKey = 'value' | 'change' | 'name'

// ── Main panel ────────────────────────────────────────────────────────────────
export default function InstitutionalHoldingsPanel() {
  const [tab,         setTab]         = useState<Tab>('institution')
  const [cik,         setCik]         = useState<string>(MAJOR_INSTITUTIONS[0].cik)
  const [tickerInput, setTickerInput] = useState<string>('AAPL')
  const [tickerQuery, setTickerQuery] = useState<string>('AAPL')
  const [sort,        setSort]        = useState<SortKey>('value')
  const watchlist = useWatchlist(s => s.symbols)

  const instUrl = tab === 'institution' && cik
    ? `/api/institutional-holdings?cik=${encodeURIComponent(cik)}`
    : null

  const tickerUrl = tab === 'ticker' && tickerQuery
    ? `/api/institutional-holdings?ticker=${encodeURIComponent(tickerQuery)}`
    : null

  const { data: instData, isLoading: instLoading, error: instError, mutate: mutateInst } = useSWR<HoldingsResponse>(
    instUrl, fetcher, { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )
  const { data: tickerData, isLoading: tickerLoading, error: tickerError, mutate: mutateTicker } = useSWR<TickerLookup>(
    tickerUrl, fetcher, { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )

  const isLoading = tab === 'institution' ? instLoading : tickerLoading
  const error     = tab === 'institution' ? instError   : tickerError
  const apiError  = tab === 'institution' ? instData?.error : tickerData?.error
  const refetch   = () => tab === 'institution' ? mutateInst() : mutateTicker()

  // Sorted holdings for institution view
  const sortedHoldings = useMemo<HoldingRow[]>(() => {
    if (tab !== 'institution' || !instData?.holdings) return []
    const arr = [...instData.holdings]
    if (sort === 'value')      arr.sort((a, b) => b.value - a.value)
    else if (sort === 'name')  arr.sort((a, b) => a.name.localeCompare(b.name))
    else if (sort === 'change') {
      // Sort by absolute change in value, descending
      arr.sort((a, b) => Math.abs(b.change.value) - Math.abs(a.change.value))
    }
    return arr
  }, [tab, instData, sort])

  const handleTickerSubmit = () => {
    const v = tickerInput.trim().toUpperCase()
    if (v) setTickerQuery(v)
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'JetBrains Mono, monospace' }}>
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ flexShrink: 0, justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#1e90ff', flexShrink: 0 }} />
          <span style={{ fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700 }}>13F TRACKER</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {(['institution', 'ticker'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
              border: `1px solid ${tab === t ? '#1e90ff' : 'var(--border)'}`,
              background: tab === t ? 'rgba(30,144,255,0.1)' : 'transparent',
              color: tab === t ? '#1e90ff' : 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {t === 'institution' ? 'BY INSTITUTION' : 'BY TICKER'}
            </button>
          ))}
          <button onClick={refetch} disabled={isLoading} style={{
            fontSize: '10px', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
            border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
          }}>
            {isLoading ? '···' : '↺'}
          </button>
        </div>
      </div>

      {/* ── Search controls ─────────────────────────────────────────────────── */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {tab === 'institution' ? (
          <select
            value={cik}
            onChange={e => setCik(e.target.value)}
            style={{
              width: '100%', background: 'var(--bg-deep)', color: '#fff',
              border: '1px solid var(--border)', borderRadius: '4px',
              padding: '5px 8px', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
              outline: 'none',
            }}
          >
            {MAJOR_INSTITUTIONS.map(i => (
              <option key={i.cik} value={i.cik}>{i.name}</option>
            ))}
          </select>
        ) : (
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={tickerInput}
              onChange={e => setTickerInput(e.target.value.toUpperCase())}
              onKeyDown={e => { if (e.key === 'Enter') handleTickerSubmit() }}
              placeholder="Enter ticker (e.g. AAPL)"
              style={{
                flex: 1, minWidth: '120px',
                background: 'var(--bg-deep)', color: '#fff',
                border: '1px solid var(--border)', borderRadius: '4px',
                padding: '5px 8px', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
                outline: 'none',
              }}
            />
            <button onClick={handleTickerSubmit} style={{
              padding: '5px 12px', borderRadius: '3px', cursor: 'pointer',
              border: '1px solid #1e90ff', background: 'rgba(30,144,255,0.12)',
              color: '#1e90ff', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
            }}>
              SEARCH
            </button>
            {watchlist.slice(0, 5).map(s => (
              <button key={s} onClick={() => { setTickerInput(s); setTickerQuery(s) }} style={{
                padding: '3px 7px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
                border: `1px solid ${tickerQuery === s ? '#1e90ff' : 'var(--border)'}`,
                background: tickerQuery === s ? 'rgba(30,144,255,0.08)' : 'transparent',
                color: tickerQuery === s ? '#1e90ff' : 'var(--text-muted)',
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Summary stats (institution view) ────────────────────────────────── */}
      {tab === 'institution' && instData && !apiError && (
        <div style={{
          padding: '6px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px',
        }}>
          <Stat label="PORTFOLIO" value={fmtUSD(instData.totalPortfolioValue)} />
          <Stat label="POSITIONS" value={String(instData.holdings.filter(h => h.change.type !== 'exited').length)} />
          <Stat label="REPORT Q"  value={instData.reportDate || '—'} />
          <Stat label="NEXT DUE"  value={instData.nextFilingDue || '—'} />
        </div>
      )}

      {/* ── Sort controls (institution view) ────────────────────────────────── */}
      {tab === 'institution' && instData && !apiError && (
        <div style={{
          padding: '5px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>SORT</span>
          {(['value', 'change', 'name'] as SortKey[]).map(k => (
            <button key={k} onClick={() => setSort(k)} style={{
              padding: '2px 7px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
              border: `1px solid ${sort === k ? 'var(--teal)' : 'var(--border)'}`,
              background: sort === k ? 'rgba(0,229,192,0.08)' : 'transparent',
              color: sort === k ? 'var(--teal)' : 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {k.toUpperCase()}
            </button>
          ))}
          {instData.newPositions > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--teal)', marginLeft: 'auto' }}>
              ★ {instData.newPositions} NEW
            </span>
          )}
          {instData.exitedPositions > 0 && (
            <span style={{ fontSize: '10px', color: 'var(--negative)' }}>
              ✕ {instData.exitedPositions} EXITED
            </span>
          )}
        </div>
      )}

      {/* ── Content area ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {isLoading && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', letterSpacing: '0.1em' }}>
            <div style={{ marginBottom: '8px' }}>FETCHING 13F-HR FILING…</div>
            <div style={{ fontSize: '10px' }}>SEC EDGAR · may take 2-5 seconds</div>
          </div>
        )}

        {!isLoading && (apiError || error) && (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '11px' }}>
            <div style={{ color: 'var(--negative)', marginBottom: '6px' }}>⚠ {apiError ?? 'Network error'}</div>
            <button onClick={refetch} style={{
              padding: '4px 10px', borderRadius: '3px', cursor: 'pointer',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
              fontSize: '11px',
            }}>↺ Retry</button>
          </div>
        )}

        {/* Institution view: holdings table */}
        {!isLoading && !apiError && tab === 'institution' && instData && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 1 }}>
                <Th>Issuer</Th>
                <Th align="right">Shares</Th>
                <Th align="right">Value</Th>
                <Th align="right">% Port</Th>
                <Th align="right">QoQ</Th>
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.slice(0, 200).map((h, i) => {
                const cm = CHANGE_META[h.change.type]
                return (
                  <tr key={`${h.cusip}-${i}`} style={{
                    borderBottom: '1px solid var(--border)',
                    background: i % 2 === 1 ? 'rgba(255,255,255,0.008)' : 'transparent',
                  }}>
                    <Td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ color: '#fff', fontWeight: 600 }}>{h.name}</span>
                        {h.putCall && (
                          <span style={{
                            fontSize: '9px', padding: '1px 4px', borderRadius: '2px',
                            background: h.putCall === 'Put' ? 'rgba(255,69,96,0.15)' : 'rgba(0,201,122,0.15)',
                            color: h.putCall === 'Put' ? 'var(--negative)' : 'var(--positive)',
                          }}>{h.putCall.toUpperCase()}</span>
                        )}
                      </div>
                      <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '1px' }}>
                        CUSIP {h.cusip}
                      </div>
                    </Td>
                    <Td align="right" mono>{fmtShares(h.shares)}</Td>
                    <Td align="right" mono color="#fff">{fmtUSD(h.value)}</Td>
                    <Td align="right" mono>{h.percentOfPortfolio.toFixed(2)}%</Td>
                    <Td align="right">
                      <span style={{
                        display: 'inline-block', padding: '1px 6px', borderRadius: '3px',
                        background: cm.bg, color: cm.color, fontSize: '10px', fontWeight: 700,
                      }}>
                        {cm.icon} {cm.label}
                      </span>
                      {h.change.type !== 'unchanged' && h.change.value !== 0 && (
                        <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '1px' }}>
                          {h.change.value > 0 ? '+' : ''}{fmtUSD(h.change.value)}
                        </div>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {!isLoading && !apiError && tab === 'institution' && sortedHoldings.length === 0 && instData && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
            No holdings parsed from this filing.
          </div>
        )}

        {/* Ticker view: institutions holding it */}
        {!isLoading && !apiError && tab === 'ticker' && tickerData && (
          <>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: '11px' }}>
              <span style={{ color: 'var(--text-muted)' }}>Issuer:</span>{' '}
              <span style={{ color: '#fff', fontWeight: 700 }}>{tickerData.name}</span>
            </div>
            {tickerData.appearsIn.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
                No major institution in our coverage list currently holds <strong>{tickerData.ticker}</strong>.
                <div style={{ fontSize: '10px', marginTop: '6px' }}>
                  Coverage: {MAJOR_INSTITUTIONS.length} major filers (SEC 13F-HR).
                </div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                <thead>
                  <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 1 }}>
                    <Th>Institution</Th>
                    <Th align="right">Shares</Th>
                    <Th align="right">Value</Th>
                    <Th align="right">% Port</Th>
                    <Th align="right">QoQ</Th>
                  </tr>
                </thead>
                <tbody>
                  {tickerData.appearsIn.map((row, i) => {
                    const cm = CHANGE_META[row.change.type]
                    return (
                      <tr key={row.institution.cik} style={{
                        borderBottom: '1px solid var(--border)',
                        background: i % 2 === 1 ? 'rgba(255,255,255,0.008)' : 'transparent',
                      }}>
                        <Td>
                          <div style={{ color: '#fff', fontWeight: 600 }}>{row.institution.name}</div>
                          <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '1px' }}>
                            Filed {row.filingDate}
                          </div>
                        </Td>
                        <Td align="right" mono>{fmtShares(row.shares)}</Td>
                        <Td align="right" mono color="#fff">{fmtUSD(row.value)}</Td>
                        <Td align="right" mono>{row.percentOfPortfolio.toFixed(2)}%</Td>
                        <Td align="right">
                          <span style={{
                            display: 'inline-block', padding: '1px 6px', borderRadius: '3px',
                            background: cm.bg, color: cm.color, fontSize: '10px', fontWeight: 700,
                          }}>
                            {cm.icon} {cm.label}
                          </span>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
        fontSize: '10px', color: 'var(--text-muted)', display: 'flex',
        justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px',
      }}>
        <span>SEC EDGAR · 13F-HR · 24h cache</span>
        <span>
          {tab === 'institution' && instData && `Last updated ${new Date(instData.lastUpdated).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}`}
        </span>
      </div>
    </div>
  )
}

// ── Small UI helpers ──────────────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: '12px', color: '#fff', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, marginTop: '2px' }}>
        {value}
      </div>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align, padding: '6px 10px',
      borderBottom: '1px solid var(--border)',
      fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em',
      fontWeight: 600, textTransform: 'uppercase',
    }}>
      {children}
    </th>
  )
}

function Td({
  children, align = 'left', mono = false, color,
}: { children: React.ReactNode; align?: 'left' | 'right'; mono?: boolean; color?: string }) {
  return (
    <td style={{
      textAlign: align, padding: '6px 10px',
      fontFamily: mono ? 'JetBrains Mono, monospace' : 'inherit',
      color: color ?? 'var(--text-2)',
      fontSize: '11px',
      verticalAlign: 'top',
    }}>
      {children}
    </td>
  )
}
