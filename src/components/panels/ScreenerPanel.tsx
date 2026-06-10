'use client'

// ─── SCREENER PANEL ──────────────────────────────────────────────────────────
//
// Koyfin-style stock screener backed by 5y of SEC EDGAR XBRL fundamentals.
//
// Reads from `/api/screener`:
//   • Country toggle (US / IN / ALL)
//   • Sector dropdown (populated from the API response)
//   • Range sliders for: revenue floor, net-margin floor, ROE floor
//   • Sortable result columns (Revenue, Net Margin, ROE, etc.)
// Click any row → sets the global active symbol so every other panel
// (Chart, EquityResearch, StockProfile, AnalystConsensus...) routes to it.

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useActiveSymbol } from '@/store/symbol'

// ── Types ────────────────────────────────────────────────────────────────────

interface ScreenerRow {
  ticker:          string
  name:            string
  sector:          string | null
  industry:        string | null
  country:         string
  currency:        string | null
  logoDomain:      string | null
  latestFy:        number | null
  revenue:         number | null
  netIncome:       number | null
  grossProfit:     number | null
  opIncome:        number | null
  eps:             number | null
  equity:          number | null
  assets:          number | null
  liabilities:     number | null
  netMargin:       number | null
  grossMargin:     number | null
  operatingMargin: number | null
  roe:             number | null
  roa:             number | null
}

interface ScreenerResponse {
  results: ScreenerRow[]
  sectors: string[]
  meta: {
    totalCount:    number
    returnedCount: number
    queryMs:       number
    fetchedAt:     string
    source:        string
  }
}

type SortBy =
  | 'revenue' | 'netIncome' | 'netMargin' | 'grossMargin' | 'operatingMargin'
  | 'roe'     | 'roa'       | 'eps'       | 'ticker'

// ── Presets ───────────────────────────────────────────────────────────────────

interface Preset {
  id:           string
  label:        string
  description:  string
  filters: {
    minRevenue?:   number
    minNetMargin?: number
    minROE?:       number
    sortBy:        SortBy
    sortDir:       'asc' | 'desc'
  }
}

const PRESETS: Preset[] = [
  { id: 'mega', label: 'Mega Caps',     description: 'Revenue >$50B, by size',  filters: { minRevenue: 50e9, sortBy: 'revenue', sortDir: 'desc' } },
  { id: 'qual', label: 'High Quality',  description: 'Net margin >20%, ROE >20%', filters: { minNetMargin: 0.20, minROE: 0.20, sortBy: 'roe', sortDir: 'desc' } },
  { id: 'comp', label: 'Compounders',   description: 'ROE >15%, sized >$1B',    filters: { minRevenue: 1e9, minROE: 0.15, sortBy: 'roe', sortDir: 'desc' } },
  { id: 'fcf',  label: 'High Margin',   description: 'Net margin >25%',         filters: { minNetMargin: 0.25, sortBy: 'netMargin', sortDir: 'desc' } },
]

// ── Formatters ───────────────────────────────────────────────────────────────

function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9)  return `${(n / 1e9 ).toFixed(2)}B`
  if (abs >= 1e6)  return `${(n / 1e6 ).toFixed(1)}M`
  if (abs >= 1e3)  return `${(n / 1e3 ).toFixed(1)}K`
  return n.toFixed(0)
}

function fmtPct(n: number | null): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function fmtNum(n: number | null): string {
  if (n == null) return '—'
  return n.toFixed(2)
}

function pctColor(n: number | null): string {
  if (n == null) return 'var(--text-muted)'
  if (n > 0.20) return 'var(--positive, #00c97a)'
  if (n > 0.10) return '#a3e635'
  if (n > 0)    return '#fbbf24'
  return 'var(--negative, #ff4560)'
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ScreenerPanel() {
  // Filters
  const [country,      setCountry]      = useState<'US' | 'IN' | 'ALL'>('US')
  const [sector,       setSector]       = useState<string>('')
  const [minRevenue,   setMinRevenue]   = useState<number>(0)        // $ (0 = no filter)
  const [minNetMargin, setMinNetMargin] = useState<number>(-1)       // -1 = no filter, 0..1
  const [minROE,       setMinROE]       = useState<number>(-1)       // same
  const [sortBy,       setSortBy]       = useState<SortBy>('revenue')
  const [sortDir,      setSortDir]      = useState<'asc' | 'desc'>('desc')
  const [limit]        = useState<number>(100)

  // Data
  const [data,    setData]    = useState<ScreenerResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error,   setError]   = useState<string | null>(null)

  const setActiveSymbol = useActiveSymbol(s => s.setActiveSymbol)

  // Build query string from current filters
  const queryString = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set('country', country)
    if (sector)              sp.set('sector',       sector)
    if (minRevenue > 0)      sp.set('minRevenue',   String(minRevenue))
    if (minNetMargin >= 0)   sp.set('minNetMargin', String(minNetMargin))
    if (minROE >= 0)         sp.set('minROE',       String(minROE))
    sp.set('sortBy',  sortBy)
    sp.set('sortDir', sortDir)
    sp.set('limit',   String(limit))
    return sp.toString()
  }, [country, sector, minRevenue, minNetMargin, minROE, sortBy, sortDir, limit])

  // Fetch on filter change (debounced via dependency on queryString)
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)

    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/screener?${queryString}`, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        const json = (await res.json()) as ScreenerResponse
        if (!cancelled) setData(json)
      } catch (e) {
        if (cancelled) return
        if ((e as { name?: string }).name === 'AbortError') return
        setError((e as Error).message || 'Failed to load screener')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 220)  // 220ms debounce so slider drags don't hammer the API

    return () => { cancelled = true; ctrl.abort(); clearTimeout(t) }
  }, [queryString])

  // Reset sector when country changes (sectors are country-scoped)
  useEffect(() => { setSector('') }, [country])

  const applyPreset = useCallback((preset: Preset) => {
    setMinRevenue(preset.filters.minRevenue ?? 0)
    setMinNetMargin(preset.filters.minNetMargin ?? -1)
    setMinROE(preset.filters.minROE ?? -1)
    setSortBy(preset.filters.sortBy)
    setSortDir(preset.filters.sortDir)
  }, [])

  const resetFilters = useCallback(() => {
    setSector('')
    setMinRevenue(0)
    setMinNetMargin(-1)
    setMinROE(-1)
    setSortBy('revenue')
    setSortDir('desc')
  }, [])

  const handleSort = (col: SortBy) => {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="screener-root">
      {/* Header */}
      <div className="screener-header">
        <div className="screener-title">
          <span className="dot" />
          <div className="title-stack">
            <span className="label">SCREENER</span>
            <span className="subtitle">Find names across SEC&apos;s 7,500+ US filer universe by FY fundamentals — click any row to focus the rest of the dashboard on it.</span>
          </div>
        </div>
        <div className="screener-stats">
          {loading && <span className="loading-pulse">loading…</span>}
          {!loading && data && (
            <>
              <span><strong>{data.meta.totalCount.toLocaleString()}</strong> matches</span>
              <span className="dim">·</span>
              <span className="dim">{data.meta.queryMs}ms</span>
            </>
          )}
        </div>
      </div>

      {/* Filter row */}
      <div className="filter-bar">
        {/* Country pills */}
        <div className="filter-group">
          <label className="filter-label">COUNTRY</label>
          <div className="pill-group">
            {(['US', 'IN', 'ALL'] as const).map(c => (
              <button
                key={c}
                className={`pill ${country === c ? 'active' : ''}`}
                onClick={() => setCountry(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* Sector dropdown */}
        <div className="filter-group">
          <label className="filter-label">SECTOR</label>
          <select
            value={sector}
            onChange={e => setSector(e.target.value)}
            className="select"
          >
            <option value="">All sectors</option>
            {(data?.sectors ?? []).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {/* Sliders */}
        <div className="filter-group">
          <label className="filter-label">
            MIN REVENUE <span className="filter-value">{minRevenue > 0 ? `≥ $${fmtMoney(minRevenue)}` : 'any'}</span>
          </label>
          <input
            type="range"
            min={0}
            max={11}
            step={1}
            value={revenueToSlider(minRevenue)}
            onChange={e => setMinRevenue(sliderToRevenue(Number(e.target.value)))}
            className="slider"
          />
        </div>

        <div className="filter-group">
          <label className="filter-label">
            MIN NET MARGIN <span className="filter-value">{minNetMargin >= 0 ? `≥ ${(minNetMargin * 100).toFixed(0)}%` : 'any'}</span>
          </label>
          <input
            type="range"
            min={-1}
            max={50}
            step={1}
            value={minNetMargin >= 0 ? minNetMargin * 100 : -1}
            onChange={e => {
              const v = Number(e.target.value)
              setMinNetMargin(v < 0 ? -1 : v / 100)
            }}
            className="slider"
          />
        </div>

        <div className="filter-group">
          <label className="filter-label">
            MIN ROE <span className="filter-value">{minROE >= 0 ? `≥ ${(minROE * 100).toFixed(0)}%` : 'any'}</span>
          </label>
          <input
            type="range"
            min={-1}
            max={50}
            step={1}
            value={minROE >= 0 ? minROE * 100 : -1}
            onChange={e => {
              const v = Number(e.target.value)
              setMinROE(v < 0 ? -1 : v / 100)
            }}
            className="slider"
          />
        </div>

        <div className="filter-group reset-group">
          <button className="reset-btn" onClick={resetFilters}>RESET</button>
        </div>
      </div>

      {/* Preset chips */}
      <div className="preset-bar">
        <span className="preset-label">PRESETS:</span>
        {PRESETS.map(p => (
          <button
            key={p.id}
            className="preset-chip"
            onClick={() => applyPreset(p)}
            title={p.description}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Results table */}
      <div className="table-scroll">
        {error && (
          <div className="error-state">
            <strong>Failed to load:</strong> {error}
          </div>
        )}

        {!error && !data && loading && (
          <div className="loading-state">Querying fundamentals…</div>
        )}

        {!error && data && data.results.length === 0 && (
          <div className="empty-state">
            <strong>No matches.</strong>
            <div>Try widening the filters or switching country.</div>
          </div>
        )}

        {!error && data && data.results.length > 0 && (
          <table className="screener-table">
            <thead>
              <tr>
                <Th col="ticker"          label="Ticker"  sortBy={sortBy} sortDir={sortDir} onSort={handleSort} align="left"   />
                <th className="th-static th-left">Name</th>
                <th className="th-static">Sector</th>
                <Th col="revenue"         label="Revenue" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <Th col="netIncome"       label="Net Inc" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <Th col="grossMargin"     label="Gross %" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <Th col="operatingMargin" label="Op %"    sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <Th col="netMargin"       label="Net %"   sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <Th col="roe"             label="ROE"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <Th col="roa"             label="ROA"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <Th col="eps"             label="EPS"     sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                <th className="th-static">FY</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map(row => (
                <tr
                  key={row.ticker}
                  onClick={() => setActiveSymbol(row.ticker)}
                  className="screener-row"
                  title={`Click to set active symbol → ${row.ticker}`}
                >
                  <td className="td-ticker">
                    <span className="ticker-cell">{row.ticker}</span>
                    <span className="country-tag">{row.country}</span>
                  </td>
                  <td className="td-name">{row.name}</td>
                  <td className="td-sector">{row.sector ?? '—'}</td>
                  <td className="td-num">${fmtMoney(row.revenue)}</td>
                  <td className="td-num">${fmtMoney(row.netIncome)}</td>
                  <td className="td-num" style={{ color: pctColor(row.grossMargin) }}>{fmtPct(row.grossMargin)}</td>
                  <td className="td-num" style={{ color: pctColor(row.operatingMargin) }}>{fmtPct(row.operatingMargin)}</td>
                  <td className="td-num" style={{ color: pctColor(row.netMargin) }}>{fmtPct(row.netMargin)}</td>
                  <td className="td-num" style={{ color: pctColor(row.roe) }}>{fmtPct(row.roe)}</td>
                  <td className="td-num" style={{ color: pctColor(row.roa) }}>{fmtPct(row.roa)}</td>
                  <td className="td-num">{fmtNum(row.eps)}</td>
                  <td className="td-num td-dim">{row.latestFy ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      {data && (
        <div className="screener-footer">
          showing <strong>{data.meta.returnedCount}</strong> of <strong>{data.meta.totalCount}</strong>
          {' · '}source: SEC EDGAR XBRL
          {' · '}click any row to set active symbol
        </div>
      )}

      <style jsx>{`
        .screener-root {
          height: 100%;
          display: flex;
          flex-direction: column;
          background: var(--bg-panel);
          font-family: 'JetBrains Mono', monospace;
          color: var(--text-1, #fff);
        }
        .screener-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 10px 14px 8px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
          gap: 12px;
        }
        .screener-title { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
        .title-stack { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #22d3ee;
          box-shadow: 0 0 8px #22d3ee;
          animation: pulseDot 2s ease-in-out infinite;
        }
        .label {
          font-family: 'Syne', sans-serif;
          font-weight: 800;
          font-size: 13px;
          letter-spacing: 0.1em;
          color: #fff;
        }
        .subtitle {
          font-size: 10px;
          color: var(--text-muted);
          letter-spacing: 0.02em;
          line-height: 1.4;
          max-width: 460px;
          font-family: 'JetBrains Mono', monospace;
          font-weight: 400;
        }
        .screener-stats {
          display: flex;
          gap: 6px;
          align-items: center;
          font-size: 11px;
          color: var(--text-2, #cbd5e1);
        }
        .screener-stats strong { color: #22d3ee; font-weight: 700; }
        .screener-stats .dim { color: var(--text-muted); }
        .loading-pulse {
          color: var(--amber);
          animation: pulseDot 1.2s ease-in-out infinite;
          font-size: 10px;
          letter-spacing: 0.06em;
        }

        .filter-bar {
          display: grid;
          /* Two clean rows: dropdowns + sliders.  Each row owns its own
             columns at min 140px so labels never collapse onto each other. */
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 10px 14px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
          align-items: end;
          flex-shrink: 0;
        }
        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        /* Each filter's caption is stacked vertically — label on top line,
           live value chip on the next.  Horizontal space-between caused the
           labels to wrap and overlap at narrow widths. */
        .filter-label {
          font-size: 9px;
          letter-spacing: 0.10em;
          color: var(--text-muted);
          display: flex;
          flex-direction: column;
          gap: 2px;
          line-height: 1.2;
          white-space: nowrap;
        }
        .filter-value {
          color: #22d3ee;
          font-weight: 700;
          font-size: 10px;
          font-variant-numeric: tabular-nums;
        }
        .filter-group.reset-group {
          align-items: flex-start;
        }
        .pill-group { display: inline-flex; gap: 3px; }
        .pill {
          padding: 4px 10px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.06em;
          background: transparent;
          color: var(--text-muted);
          border: 1px solid var(--border);
          border-radius: 3px;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.12s;
        }
        .pill:hover { color: #fff; border-color: var(--text-muted); }
        .pill.active {
          color: #22d3ee;
          background: rgba(34,211,238,0.10);
          border-color: rgba(34,211,238,0.45);
        }
        .select {
          background: var(--bg-base, #0a0e14);
          border: 1px solid var(--border);
          color: #fff;
          padding: 5px 8px;
          border-radius: 3px;
          font-family: inherit;
          font-size: 11px;
          cursor: pointer;
          min-width: 130px;
        }
        .slider {
          accent-color: #22d3ee;
          height: 18px;
          margin: 0;
        }
        .reset-btn {
          padding: 5px 12px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.08em;
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-muted);
          cursor: pointer;
          border-radius: 3px;
          font-family: inherit;
          transition: all 0.12s;
        }
        .reset-btn:hover { color: var(--amber); border-color: var(--amber); }

        .preset-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 14px;
          border-bottom: 1px solid var(--border);
          font-size: 11px;
          flex-wrap: wrap;
          flex-shrink: 0;
        }
        .preset-label {
          font-size: 9px;
          letter-spacing: 0.14em;
          color: var(--text-muted);
        }
        .preset-chip {
          padding: 4px 10px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
          background: rgba(34,211,238,0.06);
          border: 1px solid rgba(34,211,238,0.25);
          color: #22d3ee;
          border-radius: 12px;
          cursor: pointer;
          font-family: inherit;
          transition: all 0.12s;
        }
        .preset-chip:hover {
          background: rgba(34,211,238,0.15);
          border-color: rgba(34,211,238,0.6);
        }

        .table-scroll {
          flex: 1;
          overflow: auto;
          min-height: 0;
        }
        .error-state,
        .loading-state,
        .empty-state {
          padding: 40px 14px;
          text-align: center;
          color: var(--text-muted);
          font-size: 12px;
        }
        .error-state strong { color: var(--negative, #ff4560); display: block; margin-bottom: 6px; }
        .empty-state strong { color: #fff; display: block; margin-bottom: 4px; }
        .loading-state { color: var(--amber); animation: pulseDot 1.2s ease-in-out infinite; }

        .screener-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        .screener-table thead th {
          position: sticky;
          top: 0;
          background: var(--bg-base, #0a0e14);
          padding: 7px 10px;
          font-size: 10px;
          letter-spacing: 0.08em;
          color: var(--text-muted);
          border-bottom: 1px solid var(--border);
          text-transform: uppercase;
          font-weight: 700;
          z-index: 1;
          text-align: right;
          white-space: nowrap;
        }
        .th-static.th-left,
        .screener-table thead th.th-left { text-align: left; }
        .th-static { cursor: default; }
        .screener-table tbody tr {
          cursor: pointer;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.08s;
        }
        .screener-table tbody tr:hover {
          background: rgba(34,211,238,0.06);
        }
        .screener-table td {
          padding: 6px 10px;
          white-space: nowrap;
          text-align: right;
        }
        .td-ticker {
          text-align: left;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .ticker-cell {
          color: var(--amber);
          font-weight: 700;
          letter-spacing: 0.04em;
        }
        .country-tag {
          font-size: 8px;
          padding: 1px 4px;
          background: rgba(255,255,255,0.06);
          color: var(--text-muted);
          border-radius: 2px;
          letter-spacing: 0.06em;
        }
        .td-name {
          text-align: left;
          color: #fff;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
          font-size: 11px;
        }
        .td-sector {
          text-align: left;
          color: var(--text-2, #cbd5e1);
          font-size: 10px;
        }
        .td-num { font-variant-numeric: tabular-nums; }
        .td-dim { color: var(--text-muted); }

        @keyframes pulseDot {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.45; }
        }

        .screener-footer {
          padding: 7px 14px;
          font-size: 10px;
          color: var(--text-muted);
          border-top: 1px solid var(--border);
          letter-spacing: 0.04em;
          flex-shrink: 0;
        }
        .screener-footer strong { color: #22d3ee; }
      `}</style>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Th({ col, label, sortBy, sortDir, onSort, align = 'right' }: {
  col:      SortBy
  label:    string
  sortBy:   SortBy
  sortDir:  'asc' | 'desc'
  onSort:   (c: SortBy) => void
  align?:   'left' | 'right'
}) {
  const active = sortBy === col
  return (
    <th
      onClick={() => onSort(col)}
      className={align === 'left' ? 'th-left' : ''}
      style={{
        cursor: 'pointer',
        color:  active ? '#22d3ee' : undefined,
      }}
    >
      {label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
    </th>
  )
}

// ── Slider helpers ───────────────────────────────────────────────────────────
// Log-scale revenue slider: 0 → no filter, 1 → $1M, … 11 → $100B
// Steps: 0, 1M, 5M, 25M, 100M, 500M, 1B, 5B, 10B, 25B, 50B, 100B

const REVENUE_STOPS = [0, 1e6, 5e6, 25e6, 100e6, 500e6, 1e9, 5e9, 10e9, 25e9, 50e9, 100e9]

function sliderToRevenue(idx: number): number {
  const i = Math.max(0, Math.min(REVENUE_STOPS.length - 1, Math.round(idx)))
  return REVENUE_STOPS[i]
}

function revenueToSlider(v: number): number {
  if (v <= 0) return 0
  // Find closest stop
  let best = 0
  let bestDiff = Infinity
  for (let i = 0; i < REVENUE_STOPS.length; i++) {
    const diff = Math.abs(REVENUE_STOPS[i] - v)
    if (diff < bestDiff) { bestDiff = diff; best = i }
  }
  return best
}
