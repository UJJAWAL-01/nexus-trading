'use client'

// SEASONALITY — how the active symbol has behaved in each calendar month.
// Computed in the browser by src/lib/risk.ts from keyless monthly closes.
// Shows the sample size and win rate next to every average, because a
// "seasonal pattern" from a handful of years is usually noise.

import { useMemo } from 'react'
import useSWR from 'swr'
import { useEffectiveSymbol } from '@/store/symbol'
import { seasonality } from '@/lib/risk'

const MONO = 'JetBrains Mono, monospace'
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const GRID_YEARS = 12

interface ChartPayload {
  results?: Array<{ data?: { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> | null } } }>
}

const cellBg = (v: number | null): string => {
  if (v === null) return 'transparent'
  const a = Math.min(1, Math.abs(v) / 10)
  return `color-mix(in srgb, var(${v >= 0 ? '--positive' : '--negative'}) ${Math.round(12 + a * 55)}%, transparent)`
}
function compute(payload: ChartPayload | undefined) {
  const res = payload?.results?.[0]?.data?.chart?.result?.[0]
  const closes = res?.indicators?.quote?.[0]?.close
  if (!res?.timestamp || !closes) return null
  const monthly: Array<{ time: number; close: number }> = []
  res.timestamp.forEach((time, i) => { const c = closes[i]; if (typeof c === 'number' && c > 0) monthly.push({ time, close: c }) })
  return seasonality(monthly)
}

const pct = (v: number | null, dp = 1) => (v === null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}`)

export default function SeasonalityPanel() {
  const { symbol: effective } = useEffectiveSymbol('seasonality')
  const symbol = effective ?? 'SPY'

  const opts = { refreshInterval: 0, dedupingInterval: 60 * 60_000 }
  const url  = (range: string) => `/api/yfinance?symbols=${encodeURIComponent(symbol)}&range=${range}&interval=1mo`

  // Full history first. For some long-listed symbols the source answers a
  // "max" request with QUARTERLY bars; those cannot give monthly returns, so
  // seasonality() rejects them and we fall back to ten years of true monthly bars.
  const full     = useSWR<ChartPayload>(url('max'), opts)
  const fromFull = useMemo(() => compute(full.data), [full.data])
  const needTen  = !!full.data && !fromFull
  const ten      = useSWR<ChartPayload>(needTen ? url('10y') : null, opts)
  const fromTen  = useMemo(() => compute(ten.data), [ten.data])

  const result    = fromFull ?? fromTen
  const error     = full.error ?? (needTen ? ten.error : undefined)
  const isLoading = full.isLoading || (needTen && ten.isLoading)

  const thisMonth = new Date().getUTCMonth()
  const maxAbs = result ? Math.max(1, ...result.months.map(m => Math.abs(m.avgPct ?? 0))) : 1
  const current = result?.months[thisMonth]

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="dot" />
        SEASONALITY
        <span style={{ fontSize: 11, color: 'var(--amber)', fontFamily: MONO, fontWeight: 700 }}>{symbol}</span>
        {result && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>{result.firstYear}–{result.lastYear} · MONTHLY RETURNS</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {isLoading && !result ? (
          <Note text={`Loading ${symbol} monthly history…`} />
        ) : error ? (
          <Note bad text="Could not load price history. Try again shortly." />
        ) : !result ? (
          <Note bad text={`${symbol} has less than two years of monthly history, which is too little to say anything about seasonality.`} />
        ) : (
          <>
            {current && current.avgPct !== null && (
              <div style={{ padding: '8px 10px', fontFamily: MONO, fontSize: 12, borderBottom: '1px solid var(--border)', color: 'var(--text-2)' }}>
                {MONTHS[thisMonth]} has closed higher in{' '}
                <strong style={{ color: 'var(--text)' }}>{Math.round((current.winRate ?? 0) * current.years)} of {current.years}</strong> years, averaging{' '}
                <strong style={{ color: current.avgPct >= 0 ? 'var(--positive)' : 'var(--negative)' }}>{pct(current.avgPct)}%</strong>
                {' '}(range {pct(current.worstPct)}% to {pct(current.bestPct)}%).
                {current.years < 10 && <span style={{ color: 'var(--amber)' }}> Small sample: treat with caution.</span>}
              </div>
            )}

            {/* Average return by month */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 4, padding: '12px 10px 4px', alignItems: 'end' }}>
              {result.months.map((m, i) => {
                const v = m.avgPct ?? 0
                const h = Math.round((Math.abs(v) / maxAbs) * 46)
                return (
                  <div key={m.month} title={`${MONTHS[i]}: average ${pct(m.avgPct, 2)}%, median ${pct(m.medianPct, 2)}%, up ${Math.round((m.winRate ?? 0) * 100)}% of ${m.years} years`}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontFamily: MONO, fontSize: 10 }}>
                    <div style={{ height: 50, display: 'flex', alignItems: 'flex-end' }}>
                      <div style={{ width: 16, height: Math.max(2, h), background: v >= 0 ? 'var(--positive)' : 'var(--negative)', borderRadius: 2, opacity: i === thisMonth ? 1 : 0.65 }} />
                    </div>
                    <div style={{ color: v >= 0 ? 'var(--positive)' : 'var(--negative)', fontWeight: 700 }}>{pct(m.avgPct)}</div>
                    <div style={{ color: 'var(--text-muted)' }}>{m.winRate === null ? '' : `${Math.round(m.winRate * 100)}%`}</div>
                    <div style={{ color: i === thisMonth ? 'var(--amber)' : 'var(--text-2)', fontWeight: i === thisMonth ? 700 : 400 }}>{MONTHS[i]}</div>
                  </div>
                )
              })}
            </div>
            <div style={{ padding: '0 10px 8px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>
              Bar and first number: average monthly return (%). Second number: share of years the month closed higher.
            </div>

            {/* Year by month grid */}
            <div style={{ overflowX: 'auto', padding: '0 10px 10px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: 10 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '3px 4px', color: 'var(--text-muted)' }}>YEAR</th>
                    {MONTHS.map((m, i) => <th key={m} style={{ padding: '3px 2px', color: i === thisMonth ? 'var(--amber)' : 'var(--text-muted)', fontWeight: 700 }}>{m}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...result.grid].reverse().slice(0, GRID_YEARS).map(row => (
                    <tr key={row.year}>
                      <th style={{ textAlign: 'left', padding: '3px 4px', color: 'var(--text-2)', fontWeight: 700 }}>{row.year}</th>
                      {row.returns.map((v, i) => (
                        <td key={i} style={{ padding: '4px 2px', textAlign: 'center', background: cellBg(v), border: '1px solid var(--bg-panel)', color: 'var(--text)' }}>{pct(v)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        {result && result.suspectBars > 0 ? `${result.suspectBars} month${result.suspectBars === 1 ? '' : 's'} left out as a bad print in the source data. ` : ''}Price returns only (no dividends). Past seasonal tendencies are weak evidence and often disappear. Not financial advice.
      </div>
    </div>
  )
}

function Note({ text, bad }: { text: string; bad?: boolean }) {
  return <div role="status" style={{ padding: '24px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: bad ? 'var(--negative)' : 'var(--text-muted)' }}>{text}</div>
}
