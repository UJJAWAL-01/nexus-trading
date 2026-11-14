'use client'

// PORTFOLIO RISK — volatility, beta, value-at-risk, drawdown, risk concentration
// and correlations for the positions in the Portfolio panel.
//
// Computed in the browser by src/lib/risk.ts from one year of keyless daily
// closes. Nothing about your holdings is sent anywhere: the only requests are
// ordinary price-history lookups for the symbols.

import { useMemo, type CSSProperties } from 'react'
import useSWR from 'swr'
import { usePortfolio } from '@/store/portfolio'
import { portfolioRisk, type RiskInput, type Series } from '@/lib/risk'
import { loadCloses } from '@/lib/closes'
import { PanelSkeleton, usePanelGuide } from '@/components/ui/Motion'

const MONO = 'JetBrains Mono, monospace'

const currencyOf = (symbol: string) => (symbol.endsWith('.NS') || symbol.endsWith('.BO') ? 'INR' : 'USD')
const BENCHMARK: Record<string, { symbol: string; label: string }> = {
  USD: { symbol: 'SPY',   label: 'S&P 500 (SPY)' },
  INR: { symbol: '^NSEI', label: 'Nifty 50' },
}
const SIGN: Record<string, string> = { USD: '$', INR: '₹' }

const pct  = (n: number | null, dp = 1) => (n === null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(dp)}%`)
const num  = (n: number | null, dp = 2) => (n === null || !Number.isFinite(n) ? '—' : n.toFixed(dp))
const tile: CSSProperties = { border: '1px solid var(--border)', borderRadius: 4, padding: '7px 9px', background: 'var(--bg-deep)', minWidth: 0 }
const th: CSSProperties = { padding: '6px 8px', fontSize: 10, letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: MONO, fontWeight: 700, textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td: CSSProperties = { padding: '6px 8px', fontSize: 11, fontFamily: MONO, textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

// Correlation cell colour: red = moves together (concentrated), teal = offsets.
const corrBg = (v: number | null): string => {
  if (v === null) return 'transparent'
  const a = Math.min(1, Math.abs(v))
  return v >= 0
    ? `color-mix(in srgb, var(--negative) ${Math.round(a * 55)}%, transparent)`
    : `color-mix(in srgb, var(--teal) ${Math.round(a * 55)}%, transparent)`
}

export default function RiskPanel() {
  const positions = usePortfolio(s => s.positions)

  // One currency at a time: without FX rates, mixing USD and INR values would
  // produce meaningless weights. Analyse the larger group by cost basis.
  const group = useMemo(() => {
    const by: Record<string, { cost: number; symbols: string[] }> = {}
    for (const p of positions) {
      const c = currencyOf(p.symbol)
      by[c] ??= { cost: 0, symbols: [] }
      by[c].cost += Math.abs(p.qty * p.avgCost)
      by[c].symbols.push(p.symbol)
    }
    const entries = Object.entries(by).sort((a, b) => b[1].cost - a[1].cost)
    return entries.length ? { currency: entries[0][0], symbols: entries[0][1].symbols, excluded: entries.slice(1).flatMap(e => e[1].symbols) } : null
  }, [positions])

  const bench = group ? BENCHMARK[group.currency] : null
  const wanted = useMemo(() => (group && bench ? [...new Set([...group.symbols, bench.symbol])].sort() : []), [group, bench])

  const { data, error, isLoading } = useSWR(
    wanted.length ? ['risk-closes', wanted.join(',')] : null,
    () => loadCloses(wanted),
    { refreshInterval: 0, dedupingInterval: 15 * 60_000, revalidateOnFocus: false },
  )

  const result = useMemo(() => {
    if (!data || !group || !bench) return null
    const toSeries = (rows: Array<[string, number]> | undefined): Series => new Map(rows ?? [])
    const inputs: RiskInput[] = []
    const noHistory: string[] = []
    for (const p of positions) {
      if (!group.symbols.includes(p.symbol)) continue
      const rows = data[p.symbol]
      if (!rows || rows.length < 40) { noHistory.push(p.symbol); continue }
      inputs.push({ symbol: p.symbol, value: p.qty * rows[rows.length - 1][1], closes: toSeries(rows) })
    }
    const risk = portfolioRisk(inputs, toSeries(data[bench.symbol]))
    const net = inputs.reduce((a, i) => a + i.value, 0)
    return { risk, noHistory, net }
  }, [data, group, bench, positions])

  const risk = result?.risk ?? null
  const guide = usePanelGuide({
    title: 'Reading portfolio risk',
    next: [{ label: 'PORTFOLIO', panelId: 'portfolio' }, { label: 'ROTATION', panelId: 'rotation' }],
    children: <>Volatility is how much the portfolio swings in a typical year. Beta is how hard it moves when the index moves 1%. Value at risk is a daily loss you should expect to exceed about one day in twenty. Share of risk shows which holding is really driving the swings, which is often not the largest one.</>,
  })
  const sign = group ? SIGN[group.currency] ?? '' : ''
  const varAmount = risk?.var95 != null && result ? Math.abs(result.net) * risk.var95 : null

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="dot" />
        PORTFOLIO RISK
        {risk && bench && (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>
            {risk.observations} TRADING DAYS · VS {bench.label.toUpperCase()} · RUNS IN YOUR BROWSER
          </span>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>{guide.button}</span>
      </div>
      {guide.body}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {!positions.length ? (
          <Note text="Add positions in the Portfolio panel to see their risk here." />
        ) : isLoading && !data ? (
          <PanelSkeleton label="Loading one year of price history…" />
        ) : error ? (
          <Note bad text="Could not load price history. Try again shortly." />
        ) : !risk ? (
          <Note bad text="Not enough overlapping price history to measure risk for these positions." />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, padding: '8px 10px' }}>
              <Tile label="VOLATILITY (ANNUAL)" value={pct(risk.vol)} sub="How much the portfolio swings in a typical year" />
              <Tile label={`BETA VS ${bench?.symbol ?? ''}`} value={num(risk.beta)} sub={risk.beta == null ? '' : `Moves about ${Math.abs(risk.beta).toFixed(2)}x the index${risk.beta < 0 ? ', inversely' : ''}`} />
              <Tile label="1-DAY VALUE AT RISK (95%)" value={varAmount == null ? '—' : `${sign}${varAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`} sub={`${pct(risk.var95, 2)} of value. Worse on about 1 day in 20`} bad />
              <Tile label="WORST DRAWDOWN (WINDOW)" value={pct(risk.maxDrawdown)} sub="Largest peak-to-trough fall at today's weights" bad />
              <Tile label="DIVERSIFICATION" value={risk.diversification == null ? '—' : `${risk.diversification.toFixed(2)}x`} sub={risk.diversification == null ? '' : risk.diversification < 1.1 ? 'Positions move almost as one' : 'Above 1.0 = holdings offset each other'} />
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>POSITION</th>
                  <th style={th}>WEIGHT</th>
                  <th style={th}>VOLATILITY</th>
                  <th style={th}>BETA</th>
                  <th style={{ ...th, textAlign: 'left' }} title="Share of total portfolio variance contributed by this position">SHARE OF RISK</th>
                </tr>
              </thead>
              <tbody>
                {[...risk.positions].sort((a, b) => (b.riskShare ?? 0) - (a.riskShare ?? 0)).map(p => {
                  const share = p.riskShare ?? 0
                  const heavy = share > Math.abs(p.weight) + 0.05
                  return (
                    <tr key={p.symbol}>
                      <td style={{ ...td, textAlign: 'left', color: 'var(--amber)', fontWeight: 700 }}>{p.symbol}</td>
                      <td style={td}>{pct(p.weight)}</td>
                      <td style={td}>{pct(p.vol)}</td>
                      <td style={td}>{num(p.beta)}</td>
                      <td style={{ ...td, textAlign: 'left', minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.max(0, Math.min(100, share * 100))}%`, height: '100%', background: heavy ? 'var(--negative)' : 'var(--amber)' }} />
                          </div>
                          <span style={{ width: 44, textAlign: 'right', color: heavy ? 'var(--negative)' : undefined }}>{pct(p.riskShare, 0)}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {risk.correlation.symbols.length > 1 && (
              <div style={{ padding: '10px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em', marginBottom: 6 }}>
                  CORRELATION OF DAILY RETURNS · RED = MOVE TOGETHER · TEAL = OFFSET
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontFamily: MONO, fontSize: 10 }}>
                    <thead>
                      <tr>
                        <th />
                        {risk.correlation.symbols.map(s => <th key={s} style={{ padding: '3px 6px', color: 'var(--text-muted)', fontWeight: 700 }}>{s}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {risk.correlation.matrix.map((row, i) => (
                        <tr key={risk.correlation.symbols[i]}>
                          <th style={{ padding: '3px 6px', color: 'var(--text-muted)', fontWeight: 700, textAlign: 'left' }}>{risk.correlation.symbols[i]}</th>
                          {row.map((v, j) => (
                            <td key={j} style={{ padding: '5px 8px', textAlign: 'center', minWidth: 46, background: i === j ? 'var(--bg-deep)' : corrBg(v), border: '1px solid var(--bg-panel)', color: 'var(--text)' }}>
                              {v === null ? '—' : v.toFixed(2)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(result!.noHistory.length > 0 || (group?.excluded.length ?? 0) > 0) && (
              <div style={{ padding: '0 10px 8px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>
                {result!.noHistory.length > 0 && <div>No usable price history, excluded: {result!.noHistory.join(', ')}.</div>}
                {(group?.excluded.length ?? 0) > 0 && <div>Other-currency positions are analysed separately and excluded here: {group!.excluded.join(', ')}.</div>}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        Based on the past year at today&apos;s weights. Historical risk understates rare events and does not predict losses. Not financial advice.
      </div>
    </div>
  )
}

function Tile({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: MONO, color: bad ? 'var(--negative)' : 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, fontFamily: MONO, color: 'var(--text-muted)', lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
}

function Note({ text, bad }: { text: string; bad?: boolean }) {
  return <div role="status" style={{ padding: '24px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: bad ? 'var(--negative)' : 'var(--text-muted)' }}>{text}</div>
}
