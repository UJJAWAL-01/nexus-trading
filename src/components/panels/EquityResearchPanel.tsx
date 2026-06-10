'use client'

// ─── EQUITY RESEARCH ──────────────────────────────────────────────────────────
//
// Real per-stock fundamentals deep dive backed by 5 years of SEC EDGAR XBRL
// data we ingested into Postgres.  This is the Koyfin-killer panel.
//
// Pipeline:
//   useEffectiveSymbol('equityresearch')  →  fetch /api/fundamentals?ticker=X
//   → 5-year quarterly time series of revenue/margins/EPS/FCF + computed
//     ratios.  No hardcoded data anywhere; if the company isn't a SEC filer
//     we say so explicitly.
//
// Layout (top → bottom):
//   1. Identity row     — name + sector + latest quarter date
//   2. Headline stats   — latest revenue, EPS, net margin, FCF + YoY change
//   3. Four mini bar charts — Revenue / Net Income / EPS / Free Cash Flow
//   4. Margin trend     — gross / operating / net stacked over time
//   5. Footer           — source + revision count

import { useEffect, useMemo, useState } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell, Line, LineChart, ReferenceLine } from 'recharts'
import { useEffectiveSymbol } from '@/store/symbol'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PeriodPoint {
  fiscalPeriodEnd:  string
  fiscalYear:       number
  fiscalQuarter:    number | null
  calendarYear:     number
  calendarQuarter:  number | null
  periodType:       'quarterly' | 'annual'
  metrics:          Record<string, number>
  computed:         Record<string, number | null>
}

interface ApiResponse {
  ticker:  string
  company: {
    name:     string
    cik:      string | null
    sector:   string | null
    industry: string | null
    country:  string
    currency: string | null
  }
  periods: PeriodPoint[]
  meta: {
    fetchedAt: string
    source:    string
    cached:    boolean
    rowCount:  number
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMoney(v: number | null | undefined, currency = 'USD'): string {
  if (v == null || !isFinite(v)) return '—'
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  const sym = currency === 'INR' ? '₹' : '$'
  if (a >= 1e12) return `${sign}${sym}${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9)  return `${sign}${sym}${(a / 1e9).toFixed(2)}B`
  if (a >= 1e6)  return `${sign}${sym}${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3)  return `${sign}${sym}${(a / 1e3).toFixed(0)}K`
  return `${sign}${sym}${a.toFixed(0)}`
}

function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

function fmtEPS(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return `$${v.toFixed(2)}`
}

function fmtPeriodLabel(p: PeriodPoint): string {
  if (p.periodType === 'annual') return `FY${p.fiscalYear}`
  return `Q${p.fiscalQuarter} '${String(p.fiscalYear).slice(2)}`
}

function yoyChange(latest: number | null, yearAgo: number | null): number | null {
  if (latest == null || yearAgo == null || yearAgo === 0) return null
  return (latest - yearAgo) / Math.abs(yearAgo)
}

// ── Actionable insights ──────────────────────────────────────────────────────
// Computed PER TICKER from the actual annual time series.  The whole point is
// that this strip should look different for AAPL vs WMT vs NVDA — the user
// shouldn't be reading the same generic story under every name.

type InsightTone = 'great' | 'good' | 'ok' | 'bad'
interface Insight { label: string; value: string; tone: InsightTone; hint?: string }

function revenueOfP(p: PeriodPoint): number | null {
  return p.metrics['Revenues']
    ?? p.metrics['RevenueFromContractWithCustomerExcludingAssessedTax']
    ?? null
}

function computeInsights(annual: PeriodPoint[]): Insight[] {
  if (annual.length < 2) return []
  const out: Insight[] = []
  // annual[0] is the newest reported FY, annual[N-1] the oldest.
  const newest = annual[0]
  const oldest = annual[annual.length - 1]
  const span   = Math.max(1, newest.fiscalYear - oldest.fiscalYear)

  // ── 1. Revenue CAGR over the available window ───────────────────────────
  const revN = revenueOfP(newest)
  const revO = revenueOfP(oldest)
  if (revN != null && revO != null && revO > 0) {
    const cagr = Math.pow(revN / revO, 1 / span) - 1
    out.push({
      label: `${span}Y REV CAGR`,
      value: `${cagr >= 0 ? '+' : ''}${(cagr * 100).toFixed(1)}%`,
      tone:  cagr > 0.20 ? 'great' : cagr > 0.10 ? 'good' : cagr > 0 ? 'ok' : 'bad',
      hint:  `Revenue ${cagr >= 0 ? 'grew' : 'shrank'} from ${fmtMoney(revO)} (FY${oldest.fiscalYear}) to ${fmtMoney(revN)} (FY${newest.fiscalYear})`,
    })
  }

  // ── 2. Net income CAGR (only if both endpoints positive) ────────────────
  const niN = newest.metrics['NetIncomeLoss']
  const niO = oldest.metrics['NetIncomeLoss']
  if (niN != null && niO != null && niO > 0 && niN > 0) {
    const cagr = Math.pow(niN / niO, 1 / span) - 1
    out.push({
      label: `${span}Y NI CAGR`,
      value: `${cagr >= 0 ? '+' : ''}${(cagr * 100).toFixed(1)}%`,
      tone:  cagr > 0.25 ? 'great' : cagr > 0.10 ? 'good' : cagr > 0 ? 'ok' : 'bad',
      hint:  `Net income compounded ${(cagr * 100).toFixed(1)}%/yr`,
    })
  } else if (niN != null && niO != null && niN > 0 && niO <= 0) {
    out.push({ label: 'EARNINGS', value: 'TURNED POSITIVE', tone: 'good',
      hint: `Was ${fmtMoney(niO)} loss in FY${oldest.fiscalYear}, now ${fmtMoney(niN)} profit` })
  } else if (niN != null && niN <= 0) {
    out.push({ label: 'EARNINGS', value: 'UNPROFITABLE', tone: 'bad',
      hint: `Latest FY${newest.fiscalYear} net loss of ${fmtMoney(niN)}` })
  }

  // ── 3. Margin direction (regression slope on net margin, last ≥3 yrs) ───
  const recent = annual.slice(0, Math.min(annual.length, 4)).reverse()
  const ms = recent.map(p => p.computed.NetMargin).filter((m): m is number => m != null && isFinite(m))
  if (ms.length >= 3) {
    const slopePct = (ms[ms.length - 1] - ms[0]) / (ms.length - 1) * 100  // pp/yr
    const dir = slopePct >  0.3 ? 'EXPANDING' : slopePct < -0.3 ? 'COMPRESSING' : 'STABLE'
    const arr = slopePct >  0.3 ? '↑' : slopePct < -0.3 ? '↓' : '→'
    out.push({
      label: 'NET MARGIN',
      value: `${dir} ${arr}`,
      tone:  slopePct > 0.3 ? 'good' : slopePct < -0.3 ? 'bad' : 'ok',
      hint:  `Net margin moved from ${(ms[0]*100).toFixed(1)}% → ${(ms[ms.length-1]*100).toFixed(1)}% over ${ms.length-1} years`,
    })
  }

  // ── 4. Profitability streak ─────────────────────────────────────────────
  const profitableYrs = annual.filter(p => (p.metrics['NetIncomeLoss'] ?? 0) > 0).length
  out.push({
    label: 'PROFITABLE',
    value: `${profitableYrs}/${annual.length} FY`,
    tone:  profitableYrs === annual.length ? 'great'
         : profitableYrs >= annual.length - 1 ? 'good'
         : profitableYrs >= annual.length / 2 ? 'ok' : 'bad',
    hint:  profitableYrs === annual.length
            ? `Net positive every year of available history`
            : `${annual.length - profitableYrs} of the last ${annual.length} fiscal years were unprofitable`,
  })

  // ── 5. ROE quality (latest reported) ────────────────────────────────────
  const roe = newest.computed['ROE']
  if (roe != null && isFinite(roe)) {
    out.push({
      label: `FY${newest.fiscalYear} ROE`,
      value: `${(roe * 100).toFixed(0)}%`,
      tone:  roe > 0.20 ? 'great' : roe > 0.12 ? 'good' : roe > 0 ? 'ok' : 'bad',
      hint:  roe > 1
              ? `Buyback-driven equity — ROE >100% is common for mature companies returning capital`
              : `Return on equity of ${(roe * 100).toFixed(1)}% for the latest fiscal year`,
    })
  }

  // ── 6. Loss-year flag (only if any losses in window) ────────────────────
  const losses = annual.filter(p => (p.metrics['NetIncomeLoss'] ?? 0) < 0)
  if (losses.length > 0) {
    out.push({
      label: 'LOSS YEAR(S)',
      value: losses.map(p => `FY${String(p.fiscalYear).slice(2)}`).join(' · '),
      tone:  'bad',
      hint:  `Reported a net loss in ${losses.length === 1 ? 'one' : losses.length} of the last ${annual.length} fiscal years`,
    })
  }

  return out
}

function InsightStrip({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null
  const toneColor: Record<InsightTone, { fg: string; bg: string; bd: string }> = {
    great: { fg: '#22d3ee', bg: 'rgba(34,211,238,0.10)',  bd: 'rgba(34,211,238,0.35)' },
    good:  { fg: '#00c97a', bg: 'rgba(0,201,122,0.10)',   bd: 'rgba(0,201,122,0.35)' },
    ok:    { fg: '#fbbf24', bg: 'rgba(251,191,36,0.10)',  bd: 'rgba(251,191,36,0.35)' },
    bad:   { fg: '#ff4560', bg: 'rgba(255,69,96,0.10)',   bd: 'rgba(255,69,96,0.40)' },
  }
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: 6,
      marginBottom: 10,
    }}>
      {insights.map(i => {
        const c = toneColor[i.tone]
        return (
          <div
            key={i.label}
            title={i.hint}
            style={{
              display: 'flex', flexDirection: 'column', gap: 1,
              padding: '5px 9px',
              background: c.bg,
              border: `1px solid ${c.bd}`,
              borderRadius: 4,
              minWidth: 0,
            }}
          >
            <span style={{
              fontSize: 9, color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.08em', whiteSpace: 'nowrap',
            }}>{i.label}</span>
            <span style={{
              fontSize: 11, fontWeight: 700, color: c.fg,
              fontFamily: 'JetBrains Mono, monospace',
              fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
            }}>{i.value}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Chart helpers ────────────────────────────────────────────────────────────

interface ChartPoint {
  label: string
  value: number | null
  fill:  string
}

// We display ANNUAL data only.  The quarterly path was tainted by SEC YTD/TTM
// pollution (XBRL returns the rolling 12-month value with the same fp:"Q3" tag
// as the actual 3-month quarter, indistinguishable without the `start` field
// which we don't capture yet).  Annual values are unambiguous and accurate.
function buildAnnualSeries(
  periods: PeriodPoint[],
  read:    (p: PeriodPoint) => number | null,
  posColor = 'var(--positive)',
  negColor = 'var(--negative)',
  maxBars  = 7,
): ChartPoint[] {
  return periods
    .filter(p => p.periodType === 'annual')
    .slice(0, maxBars)
    .map(p => {
      const v = read(p)
      return {
        label: `FY${String(p.fiscalYear).slice(2)}`,
        value: v,
        fill:  (v ?? 0) >= 0 ? posColor : negColor,
      }
    })
    .reverse()  // chart left-to-right = oldest-to-newest
}

// ── Mini chart card ──────────────────────────────────────────────────────────

interface MiniChartProps {
  title:    string
  series:   ChartPoint[]
  yFmt:     (v: number | null) => string
  latest:   number | null
  yoy:      number | null
  accent:   string
  currency?: string
}

function MiniChart({ title, series, yFmt, latest, yoy, accent }: MiniChartProps) {
  if (series.length === 0) {
    return (
      <div style={chartCardStyle}>
        <div style={chartTitleStyle}>{title}</div>
        <div style={chartEmpty}>No data</div>
      </div>
    )
  }
  return (
    <div style={chartCardStyle}>
      <div style={chartHeaderRow}>
        <div style={chartTitleStyle}>{title}</div>
        <div style={chartLatestRow}>
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 13, fontWeight: 700, color: '#fff',
            fontVariantNumeric: 'tabular-nums',
          }}>{yFmt(latest)}</span>
          {yoy != null && isFinite(yoy) && (
            <span style={{
              fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
              color: yoy >= 0 ? 'var(--positive)' : 'var(--negative)',
              fontVariantNumeric: 'tabular-nums',
              marginLeft: 6,
            }}>
              {yoy >= 0 ? '+' : ''}{(yoy * 100).toFixed(1)}% YoY
            </span>
          )}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 80 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
            <Bar dataKey="value" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {series.map((d, i) => (
                <Cell key={i} fill={d.fill === 'var(--positive)' ? '#00c97a' : '#ff4560'} />
              ))}
            </Bar>
            <XAxis
              dataKey="label"
              stroke="var(--text-muted)"
              fontSize={9}
              tickLine={false}
              axisLine={false}
              interval={3}
            />
            <YAxis hide />
            <Tooltip
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ zIndex: 100, pointerEvents: 'none' }}
              contentStyle={{
                background: '#0a0e14',
                border: `1px solid ${accent}`,
                borderRadius: 4,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                color: '#fff',
                padding: '6px 10px',
                boxShadow: '0 4px 18px rgba(0,0,0,0.7)',
              }}
              labelStyle={{ color: accent, fontWeight: 700, marginBottom: 4, fontSize: 10, letterSpacing: '0.08em' }}
              itemStyle={{ color: '#fff', fontSize: 12, padding: 0 }}
              formatter={(v) => {
                const n = typeof v === 'number' ? v : v == null ? null : Number(v)
                return [yFmt(n), title]
              }}
              cursor={{ fill: 'rgba(255,255,255,0.06)' }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Margin trend chart (line) ────────────────────────────────────────────────

function MarginChart({ periods }: { periods: PeriodPoint[] }) {
  const data = useMemo(() => {
    return periods
      .filter(p => p.periodType === 'annual')
      .slice(0, 7)
      .map(p => ({
        label: `FY${String(p.fiscalYear).slice(2)}`,
        gross:     p.computed.GrossMargin     != null ? p.computed.GrossMargin     * 100 : null,
        operating: p.computed.OperatingMargin != null ? p.computed.OperatingMargin * 100 : null,
        net:       p.computed.NetMargin       != null ? p.computed.NetMargin       * 100 : null,
      }))
      .reverse()
  }, [periods])

  if (data.length === 0) {
    return (
      <div style={{ ...chartCardStyle, height: 200 }}>
        <div style={chartTitleStyle}>MARGINS</div>
        <div style={chartEmpty}>No margin data</div>
      </div>
    )
  }

  return (
    <div style={{ ...chartCardStyle, height: 200 }}>
      <div style={chartHeaderRow}>
        <div style={chartTitleStyle}>MARGIN TREND (ANNUAL)</div>
        <div style={{ display: 'flex', gap: 12, fontFamily: 'JetBrains Mono, monospace', fontSize: 9 }}>
          <span style={{ color: '#00c97a' }}>● GROSS</span>
          <span style={{ color: 'var(--amber)' }}>● OP</span>
          <span style={{ color: '#a78bfa' }}>● NET</span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 10, bottom: 0, left: 0 }}>
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} />
            <Line dataKey="gross"     stroke="#00c97a"      strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="operating" stroke="var(--amber)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="net"       stroke="#a78bfa"      strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <XAxis dataKey="label" stroke="var(--text-muted)" fontSize={9} interval={0} tickLine={false} axisLine={false} />
            <YAxis stroke="var(--text-muted)" fontSize={9} tickFormatter={v => `${v}%`} tickLine={false} axisLine={false} width={36} />
            <Tooltip
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ zIndex: 100, pointerEvents: 'none' }}
              contentStyle={{
                background: '#0a0e14',
                border: '1px solid var(--amber)',
                borderRadius: 4,
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                color: '#fff',
                padding: '6px 10px',
                boxShadow: '0 4px 18px rgba(0,0,0,0.7)',
              }}
              labelStyle={{ color: 'var(--amber)', fontWeight: 700, marginBottom: 4, fontSize: 10, letterSpacing: '0.08em' }}
              itemStyle={{ fontSize: 11, padding: 0 }}
              formatter={(v) => {
                const n = typeof v === 'number' ? v : v == null ? null : Number(v)
                return n == null || !isFinite(n) ? '—' : `${n.toFixed(1)}%`
              }}
              cursor={{ stroke: 'var(--amber)', strokeWidth: 1, strokeDasharray: '3 3' }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Inline styles ────────────────────────────────────────────────────────────

const chartCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg-deep)',
  border: '1px solid var(--border)',
  borderRadius: 5,
  padding: '8px 10px',
  height: 130,
}
const chartTitleStyle: React.CSSProperties = {
  fontSize: 9,
  color: 'var(--text-muted)',
  fontFamily: 'JetBrains Mono, monospace',
  letterSpacing: '0.08em',
  fontWeight: 700,
}
const chartHeaderRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 4,
}
const chartLatestRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
}
const chartEmpty: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function EquityResearchPanel() {
  const { symbol: effSym } = useEffectiveSymbol('equityresearch')

  const [data,    setData]    = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    if (!effSym) {
      setData(null); setError(null); setLoading(false)
      return
    }

    let cancelled = false
    const ctrl = new AbortController()
    setLoading(true); setError(null)

    fetch(`/api/fundamentals?ticker=${encodeURIComponent(effSym)}`, { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) {
          const j = await r.json().catch(() => null) as { error?: string } | null
          throw new Error(j?.error ?? `HTTP ${r.status}`)
        }
        return r.json() as Promise<ApiResponse>
      })
      .then(json => {
        if (cancelled) return
        setData(json)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Failed to load')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true; ctrl.abort() }
  }, [effSym])

  // ── Derive series + latest period ─────────────────────────────────────────
  // Annual data only — periods[0] = latest FY, periods[1] = one year ago.
  const allPeriods    = data?.periods ?? []
  const annualPeriods = allPeriods.filter(p => p.periodType === 'annual')
  const latest        = annualPeriods[0]
  const yearAgo       = annualPeriods[1]
  const currency      = data?.company.currency ?? 'USD'

  const revenueOf = (p?: PeriodPoint): number | null => {
    if (!p) return null
    return p.metrics['Revenues']
      ?? p.metrics['RevenueFromContractWithCustomerExcludingAssessedTax']
      ?? null
  }

  const revSeries = useMemo(() => buildAnnualSeries(allPeriods, revenueOf), [allPeriods])
  const niSeries  = useMemo(() => buildAnnualSeries(allPeriods, p => p.metrics['NetIncomeLoss'] ?? null), [allPeriods])
  const epsSeries = useMemo(() => buildAnnualSeries(allPeriods, p => p.metrics['EarningsPerShareDiluted'] ?? null), [allPeriods])
  const fcfSeries = useMemo(() => buildAnnualSeries(allPeriods, p => p.computed.FreeCashFlow), [allPeriods])
  const insights  = useMemo(() => computeInsights(annualPeriods), [annualPeriods])

  const latestRev   = revenueOf(latest)
  const yearAgoRev  = revenueOf(yearAgo)
  const latestNI    = latest?.metrics['NetIncomeLoss'] ?? null
  const yearAgoNI   = yearAgo?.metrics['NetIncomeLoss'] ?? null
  const latestEPS   = latest?.metrics['EarningsPerShareDiluted'] ?? null
  const yearAgoEPS  = yearAgo?.metrics['EarningsPerShareDiluted'] ?? null
  const latestFCF   = latest?.computed.FreeCashFlow ?? null
  const yearAgoFCF  = yearAgo?.computed.FreeCashFlow ?? null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header">
        <span className="dot" style={{ background: '#a78bfa', boxShadow: '0 0 6px #a78bfa' }} />
        <span>EQUITY RESEARCH</span>
        {effSym && (
          <span style={{
            marginLeft: 'auto', fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            {effSym} · ANNUAL XBRL
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
        {/* No symbol */}
        {!effSym && (
          <div style={{
            textAlign: 'center', padding: '36px 16px',
            color: 'var(--text-muted)',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            lineHeight: 1.7,
          }}>
            <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>📈</div>
            Click any ticker anywhere in the app<br/>
            to see 5 years of SEC fundamentals.
          </div>
        )}

        {/* Loading */}
        {effSym && loading && !data && (
          <div style={{
            textAlign: 'center', padding: '36px 16px',
            color: 'var(--text-muted)',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          }}>
            Loading <b style={{ color: '#fff' }}>{effSym}</b> fundamentals…
          </div>
        )}

        {/* Error */}
        {effSym && !loading && error && (
          <div style={{
            textAlign: 'center', padding: '24px 16px',
            color: 'var(--negative)', fontSize: 11,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Empty (no SEC coverage) */}
        {effSym && data && annualPeriods.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '36px 16px',
            color: 'var(--text-muted)',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            lineHeight: 1.7,
          }}>
            <div style={{ color: 'var(--amber)', marginBottom: 8 }}>NO XBRL DATA</div>
            <code style={{ color: '#fff', fontSize: 12 }}>{effSym}</code><br/>
            <span style={{ fontSize: 10, marginTop: 8, display: 'inline-block' }}>
              {data.company.country !== 'US'
                ? 'Fundamentals coverage is US-only for now (SEC EDGAR).'
                : 'Company exists but doesn\'t file standard XBRL (closed-end fund, small filer, etc.)'}
            </span>
          </div>
        )}

        {/* Data */}
        {data && annualPeriods.length > 0 && (
          <>
            {/* Identity row */}
            <div style={{ marginBottom: 12 }}>
              <div style={{
                fontFamily: 'Syne, sans-serif', fontWeight: 800,
                fontSize: 17, color: '#fff', lineHeight: 1.2,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {data.company.name}
              </div>
              <div style={{
                fontSize: 10, color: 'var(--text-muted)',
                fontFamily: 'JetBrains Mono, monospace', marginTop: 4,
              }}>
                {data.company.sector ?? '—'}
                {data.company.industry && ` · ${data.company.industry}`}
                {latest && ` · LATEST FY${latest.fiscalYear} (END ${latest.fiscalPeriodEnd})`}
              </div>
            </div>

            {/* Stock-specific insights — hover any pill for the WHY */}
            <InsightStrip insights={insights} />

            {/* 4 mini charts in a 2×2 grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 8,
              marginBottom: 8,
            }}>
              <MiniChart
                title="REVENUE"
                series={revSeries}
                yFmt={v => fmtMoney(v, currency)}
                latest={latestRev}
                yoy={yoyChange(latestRev, yearAgoRev)}
                accent="#00c97a"
              />
              <MiniChart
                title="NET INCOME"
                series={niSeries}
                yFmt={v => fmtMoney(v, currency)}
                latest={latestNI}
                yoy={yoyChange(latestNI, yearAgoNI)}
                accent="#a78bfa"
              />
              <MiniChart
                title="EPS (DILUTED)"
                series={epsSeries}
                yFmt={fmtEPS}
                latest={latestEPS}
                yoy={yoyChange(latestEPS, yearAgoEPS)}
                accent="var(--amber)"
              />
              <MiniChart
                title="FREE CASH FLOW"
                series={fcfSeries}
                yFmt={v => fmtMoney(v, currency)}
                latest={latestFCF}
                yoy={yoyChange(latestFCF, yearAgoFCF)}
                accent="var(--teal)"
              />
            </div>

            {/* Margins line chart */}
            <MarginChart periods={allPeriods} />

            {/* Latest snapshot stats — bottom strip */}
            {latest && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
                gap: 6, marginTop: 10,
              }}>
                <Stat label="GROSS MARGIN" value={fmtPct(latest.computed.GrossMargin)} />
                <Stat label="OP MARGIN"    value={fmtPct(latest.computed.OperatingMargin)} />
                <Stat label="NET MARGIN"   value={fmtPct(latest.computed.NetMargin)} />
                <Stat label="ROE"          value={fmtPct(latest.computed.ROE)} />
                <Stat label="ROA"          value={fmtPct(latest.computed.ROA)} />
                <Stat label="BVPS"         value={fmtEPS(latest.computed.BookValuePerShare)} />
              </div>
            )}

            {/* Source footer */}
            <div style={{
              marginTop: 10, paddingTop: 8,
              borderTop: '1px solid var(--border)',
              fontSize: 9, color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
              display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6,
            }}>
              <span>SOURCE: {data.meta.source}</span>
              <span>
                {data.meta.rowCount.toLocaleString()} rows · {annualPeriods.length} fiscal years
                {data.meta.cached && ' · cached'}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--bg-deep)',
      border: '1px solid var(--border)',
      borderRadius: 4,
      padding: '6px 8px',
    }}>
      <div style={{
        fontSize: 9, color: 'var(--text-muted)',
        fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{
        fontSize: 12, color: '#fff', fontWeight: 700,
        fontFamily: 'JetBrains Mono, monospace',
        marginTop: 2, fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  )
}
