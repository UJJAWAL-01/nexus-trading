'use client'

// SCREENER — filter every SEC filer by fundamentals, entirely in the browser.
//
// The dataset (public/data/screener.json) is a static file built from SEC
// EDGAR's public XBRL "frames" by scripts/build-screener.ts and refreshed by a
// scheduled GitHub Action. There is no server query, no database and no key:
// after one download, filtering and sorting are instant and work offline.

import { usePanelGuide } from '@/components/ui/Motion'
import { useMemo, useState, type CSSProperties } from 'react'
import useSWR from 'swr'
import { useActiveSymbol } from '@/store/symbol'
import { decodeScreener, runScreen, sectorsOf, type Company, type ScreenerFile, type ScreenerFilters } from '@/lib/screener'
import { downloadCsv } from '@/lib/export'

const MONO = 'JetBrains Mono, monospace'
const PAGE = 150

const usd = (n: number | null): string => {
  if (n === null) return '—'
  const a = Math.abs(n), s = n < 0 ? '-' : ''
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9)  return `${s}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6)  return `${s}$${(a / 1e6).toFixed(0)}M`
  return `${s}$${a.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
const pct = (n: number | null): string => (n === null ? '—' : `${(n * 100).toFixed(1)}%`)
const x   = (n: number | null): string => (n === null ? '—' : n.toFixed(2))
const tone = (n: number | null) => (n === null ? 'var(--text-muted)' : n > 0 ? 'var(--positive)' : n < 0 ? 'var(--negative)' : 'var(--text-2)')

const ctl: CSSProperties = {
  background: 'var(--bg-deep)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 3, padding: '5px 7px', fontSize: 11, fontFamily: MONO, minWidth: 0,
}
const lbl: CSSProperties = { fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em', display: 'flex', flexDirection: 'column', gap: 3 }
const th: CSSProperties = {
  padding: '6px 8px', fontSize: 10, letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: MONO, fontWeight: 700,
  textAlign: 'right', position: 'sticky', top: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
}
const td: CSSProperties = { padding: '6px 8px', fontSize: 11, fontFamily: MONO, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }

type SortKey = keyof Company
const COLUMNS: Array<{ key: SortKey; label: string; render: (c: Company) => string; color?: (c: Company) => string; title?: string }> = [
  { key: 'revenue',      label: 'REVENUE',    render: c => usd(c.revenue) },
  { key: 'netIncome',    label: 'NET INCOME', render: c => usd(c.netIncome), color: c => tone(c.netIncome) },
  { key: 'grossMargin',  label: 'GROSS M.',   render: c => pct(c.grossMargin) },
  { key: 'netMargin',    label: 'NET M.',     render: c => pct(c.netMargin), color: c => tone(c.netMargin) },
  { key: 'roe',          label: 'ROE',        render: c => pct(c.roe), color: c => tone(c.roe), title: 'Net income / equity. Blank when equity is negative.' },
  { key: 'debtToEquity', label: 'LIAB/EQ',    render: c => x(c.debtToEquity), title: 'Total liabilities / shareholders equity' },
  { key: 'freeCashFlow', label: 'FCF',        render: c => usd(c.freeCashFlow), color: c => tone(c.freeCashFlow), title: 'Operating cash flow minus capital expenditure' },
  { key: 'eps',          label: 'EPS',        render: c => (c.eps === null ? '—' : c.eps.toFixed(2)), color: c => tone(c.eps) },
]

const REVENUE_PRESETS = [
  { label: 'Any', value: '' }, { label: '> $100M', value: '1e8' }, { label: '> $1B', value: '1e9' },
  { label: '> $10B', value: '1e10' }, { label: '> $50B', value: '5e10' },
]
const PCT_PRESETS = [{ label: 'Any', value: '' }, { label: '> 0%', value: '0' }, { label: '> 10%', value: '0.1' }, { label: '> 20%', value: '0.2' }, { label: '> 30%', value: '0.3' }]

const toNum = (s: string): number | null => (s === '' ? null : Number(s))

export default function ScreenerPanel() {
  const setActiveSymbol = useActiveSymbol(s => s.setActiveSymbol)

  // Static file: fetch once, never poll.
  const { data, error, isLoading } = useSWR<ScreenerFile>('/data/screener.json', {
    refreshInterval: 0, revalidateOnReconnect: false, dedupingInterval: 24 * 3600_000,
  })

  const companies = useMemo(() => (data ? decodeScreener(data) : []), [data])
  const sectors   = useMemo(() => sectorsOf(companies), [companies])

  const [query, setQuery]         = useState('')
  const [sector, setSector]       = useState('All')
  const [minRevenue, setMinRev]   = useState('1e9')
  const [minNetMargin, setMinNm]  = useState('')
  const [minRoe, setMinRoe]       = useState('')
  const [profitable, setProfit]   = useState(false)
  const [positiveFcf, setFcf]     = useState(false)
  const [sortBy, setSortBy]       = useState<SortKey>('revenue')
  const [dir, setDir]             = useState<'asc' | 'desc'>('desc')
  const [limit, setLimit]         = useState(PAGE)

  const filters: ScreenerFilters = useMemo(() => ({
    query, sector, minRevenue: toNum(minRevenue), minNetMargin: toNum(minNetMargin), minRoe: toNum(minRoe),
    profitableOnly: profitable, positiveFcfOnly: positiveFcf,
  }), [query, sector, minRevenue, minNetMargin, minRoe, profitable, positiveFcf])

  const results = useMemo(() => runScreen(companies, filters, sortBy, dir), [companies, filters, sortBy, dir])
  const shown   = results.slice(0, limit)

  const sort = (key: SortKey) => {
    if (key === sortBy) setDir(d => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortBy(key); setDir(key === 'ticker' || key === 'name' || key === 'sector' ? 'asc' : 'desc') }
    setLimit(PAGE)
  }
  const arrow = (key: SortKey) => (key === sortBy ? (dir === 'desc' ? ' ▼' : ' ▲') : '')

  const exportCsv = () => downloadCsv(
    `nexus-screener-FY${data?.fiscalYear ?? ''}`,
    ['ticker', 'name', 'sector', 'state', 'revenue', 'net_income', 'gross_margin', 'operating_margin', 'net_margin', 'roe', 'roa', 'liabilities_to_equity', 'eps', 'free_cash_flow', 'assets', 'equity'],
    results.map(c => [c.ticker, c.name, c.sector, c.state, c.revenue, c.netIncome, c.grossMargin, c.operatingMargin, c.netMargin, c.roe, c.roa, c.debtToEquity, c.eps, c.freeCashFlow, c.assets, c.equity]),
  )

  const reset = () => { setQuery(''); setSector('All'); setMinRev(''); setMinNm(''); setMinRoe(''); setProfit(false); setFcf(false); setLimit(PAGE) }

  const guide = usePanelGuide({
    title: "Using the screener",
    next: [{ label: "EQUITY RESEARCH", panelId: "equityresearch" }, { label: "BACKTEST", panelId: "backtest" }],
    children: <>Every row is a company&apos;s latest annual report filed with the SEC. Filters narrow thousands of companies to a short list worth reading about; they do not tell you what to buy. High margins and returns usually cost more to own, so check the price you are paying next. Click a row to load that company everywhere.</>,
  })

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" />
          SCREENER
          {data && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>
              {results.length.toLocaleString()} OF {companies.length.toLocaleString()} US FILERS · FY{data.fiscalYear}
            </span>
          )}
          {guide.button}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={{ ...ctl, cursor: 'pointer', fontWeight: 700, color: 'var(--text-2)' }} onClick={reset}>RESET</button>
          <button type="button" style={{ ...ctl, cursor: 'pointer', fontWeight: 700, color: 'var(--text-2)', opacity: results.length ? 1 : 0.4 }}
            disabled={!results.length} onClick={exportCsv} title="Download every matching company as CSV">EXPORT CSV</button>
        </div>
      </div>
      {guide.body}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <label style={lbl}>SEARCH
          <input style={{ ...ctl, width: 130 }} placeholder="Ticker or name" value={query} maxLength={40}
            onChange={e => { setQuery(e.target.value); setLimit(PAGE) }} />
        </label>
        <label style={lbl}>SECTOR
          <select style={ctl} value={sector} onChange={e => { setSector(e.target.value); setLimit(PAGE) }}>
            <option value="All">All sectors</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={lbl}>REVENUE
          <select style={ctl} value={minRevenue} onChange={e => { setMinRev(e.target.value); setLimit(PAGE) }}>
            {REVENUE_PRESETS.map(p => <option key={p.label} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label style={lbl}>NET MARGIN
          <select style={ctl} value={minNetMargin} onChange={e => { setMinNm(e.target.value); setLimit(PAGE) }}>
            {PCT_PRESETS.map(p => <option key={p.label} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label style={lbl}>ROE
          <select style={ctl} value={minRoe} onChange={e => { setMinRoe(e.target.value); setLimit(PAGE) }}>
            {PCT_PRESETS.map(p => <option key={p.label} value={p.value}>{p.label}</option>)}
          </select>
        </label>
        <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 5, paddingBottom: 6 }}>
          <input type="checkbox" checked={profitable} onChange={e => { setProfit(e.target.checked); setLimit(PAGE) }} /> PROFITABLE
        </label>
        <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 5, paddingBottom: 6 }}>
          <input type="checkbox" checked={positiveFcf} onChange={e => { setFcf(e.target.checked); setLimit(PAGE) }} /> POSITIVE FCF
        </label>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {isLoading && !data ? (
          <Note text="Loading the SEC fundamentals dataset…" />
        ) : error || !data ? (
          <Note bad text="The screener dataset is missing. Run `npm run data:screener` to build it (free, uses public SEC data)." />
        ) : results.length === 0 ? (
          <Note text="No company matches these filters. Loosen a filter or press RESET." />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }} onClick={() => sort('ticker')} aria-sort={sortBy === 'ticker' ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>TICKER{arrow('ticker')}</th>
                <th style={{ ...th, textAlign: 'left' }} onClick={() => sort('name')}>COMPANY{arrow('name')}</th>
                <th style={{ ...th, textAlign: 'left' }} onClick={() => sort('sector')}>SECTOR{arrow('sector')}</th>
                {COLUMNS.map(c => (
                  <th key={c.key} style={th} title={c.title} onClick={() => sort(c.key)}
                    aria-sort={sortBy === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {c.label}{arrow(c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map(c => (
                <tr key={`${c.cik}-${c.ticker}`}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <button type="button" onClick={() => setActiveSymbol(c.ticker)} title={`Focus ${c.ticker} across the dashboard`}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--amber)', fontFamily: MONO, fontSize: 11, fontWeight: 700 }}>
                      {c.ticker}
                    </button>
                  </td>
                  <td style={{ ...td, textAlign: 'left', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-2)' }} title={c.name}>{c.name}</td>
                  <td style={{ ...td, textAlign: 'left', color: 'var(--text-muted)' }}>{c.sector}</td>
                  {COLUMNS.map(col => (
                    <td key={col.key} style={{ ...td, color: col.color ? col.color(c) : undefined }}>{col.render(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {results.length > shown.length && (
          <div style={{ padding: 10, textAlign: 'center' }}>
            <button type="button" style={{ ...ctl, cursor: 'pointer', fontWeight: 700, color: 'var(--text-2)' }} onClick={() => setLimit(l => l + PAGE)}>
              SHOW {Math.min(PAGE, results.length - shown.length)} MORE ({(results.length - shown.length).toLocaleString()} hidden)
            </button>
          </div>
        )}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        {data
          ? `Source: ${data.source}. Annual figures as filed for FY${data.fiscalYear}; built ${data.generatedAt.slice(0, 10)}. Companies missing a metric are excluded by filters on that metric. Not financial advice.`
          : 'Source: SEC EDGAR public data.'}
      </div>
    </div>
  )
}

function Note({ text, bad }: { text: string; bad?: boolean }) {
  return <div role="status" style={{ padding: '24px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: bad ? 'var(--negative)' : 'var(--text-muted)' }}>{text}</div>
}
