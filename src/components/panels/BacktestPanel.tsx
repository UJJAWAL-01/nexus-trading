'use client'

// BACKTEST — test a rule-based strategy on the active symbol's price history.
//
// Everything is computed in the browser by src/lib/backtest.ts from the same
// keyless candles the chart uses. No server compute, no API key, no cost.
// The engine never looks ahead, charges trading costs, and always shows
// buy-and-hold next to the strategy so results cannot flatter themselves.

import { useMemo, useState, type CSSProperties } from 'react'
import useSWR from 'swr'
import { useEffectiveSymbol } from '@/store/symbol'
import { runBacktest, STRATEGIES, MIN_BARS, type StrategyConfig, type StrategyId } from '@/lib/backtest'
import type { Candle } from '@/lib/patterns/types'
import { downloadCsv } from '@/lib/export'
import { PanelSkeleton, usePanelGuide } from '@/components/ui/Motion'

const MONO = 'var(--font-data)'
const RANGES = [
  { id: '2y',  label: '2Y'  },
  { id: '5y',  label: '5Y'  },
  { id: '10y', label: '10Y' },
  { id: 'max', label: 'MAX' },
] as const
type RangeId = (typeof RANGES)[number]['id']

interface ChartPayload {
  results?: Array<{ data?: { chart?: { result?: Array<{
    timestamp?: number[]
    indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> }
  }> | null } } }>
}

function toCandles(payload: ChartPayload | undefined): Candle[] {
  const res = payload?.results?.[0]?.data?.chart?.result?.[0]
  const q = res?.indicators?.quote?.[0]
  if (!res?.timestamp || !q) return []
  const out: Candle[] = []
  res.timestamp.forEach((time, i) => {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i]
    if (o == null || h == null || l == null || c == null) return
    out.push({ time, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 })
  })
  return out.sort((a, b) => a.time - b.time)
}

const pct = (n: number | null | undefined, dp = 1) => (n == null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(dp)}%`)
const num = (n: number | null | undefined, dp = 2) => (n == null || !Number.isFinite(n) ? '—' : n.toFixed(dp))
const tone = (n: number | null | undefined) => (n == null || n === 0 ? 'var(--text-2)' : n > 0 ? 'var(--positive)' : 'var(--negative)')
const day = (t: number | null) => (t == null ? 'open' : new Date(t * 1000).toISOString().slice(0, 10))

const ctl: CSSProperties = {
  background: 'var(--bg-deep)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 3, padding: '5px 7px', fontSize: 11, fontFamily: MONO, minWidth: 0,
}
const lbl: CSSProperties = { fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em', display: 'flex', flexDirection: 'column', gap: 3 }
const btn: CSSProperties = { ...ctl, cursor: 'pointer', fontWeight: 700, color: 'var(--text-2)' }

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label style={lbl}>
      {label}
      <input
        type="number" inputMode="numeric" min={min} max={max} value={value} style={{ ...ctl, width: 64 }}
        onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))) }}
      />
    </label>
  )
}

export default function BacktestPanel() {
  const { symbol: effective } = useEffectiveSymbol('backtest')
  const symbol = effective ?? 'SPY'

  const [strategyId, setStrategyId] = useState<StrategyId>('sma-cross')
  const [cfg, setCfg] = useState<Record<StrategyId, StrategyConfig>>(() => ({
    'sma-cross':         { ...STRATEGIES['sma-cross'].defaults },
    'rsi-reversion':     { ...STRATEGIES['rsi-reversion'].defaults },
    'donchian-breakout': { ...STRATEGIES['donchian-breakout'].defaults },
  }))
  const [range, setRange]     = useState<RangeId>('5y')
  const [costBps, setCostBps] = useState(5)

  const active = cfg[strategyId]
  const patch = (p: Partial<StrategyConfig>) => setCfg(prev => ({ ...prev, [strategyId]: { ...prev[strategyId], ...p } }))

  const { data, error, isLoading } = useSWR<ChartPayload>(
    `/api/yfinance?symbols=${encodeURIComponent(symbol)}&range=${range}&interval=1d`,
    { refreshInterval: 0, dedupingInterval: 10 * 60_000 },
  )

  const candles = useMemo(() => toCandles(data), [data])
  const result  = useMemo(() => runBacktest(candles, active, { costBps }), [candles, active, costBps])

  const edge = result ? result.strategy.totalReturnPct - result.benchmark.totalReturnPct : null
  const invalidCross = strategyId === 'sma-cross' && (active.fast ?? 0) >= (active.slow ?? 0)

  const guide = usePanelGuide({
    title: 'Reading a backtest',
    next: [{ label: 'SEASONALITY', panelId: 'seasonality' }, { label: 'SCREENER', panelId: 'screener' }],
    children: <>A backtest replays one fixed rule over past prices. Always compare it with simply holding the stock, shown beside it. A rule that looks good on one stock or one period has usually been fitted to noise, so try other symbols and date ranges before believing it.</>,
  })

  const exportTrades = () => {
    if (!result) return
    downloadCsv(
      `nexus-backtest-${symbol}-${strategyId}`,
      ['symbol', 'strategy', 'entry_date', 'entry_price', 'exit_date', 'exit_price', 'return_pct', 'bars_held'],
      result.trades.map(t => [symbol, STRATEGIES[strategyId].label, day(t.entryTime), t.entryPrice, t.exitTime == null ? '' : day(t.exitTime), t.exitPrice, Number(t.returnPct.toFixed(4)), t.bars]),
    )
  }

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" />
          BACKTEST
          <span style={{ fontSize: 11, color: 'var(--amber)', fontFamily: MONO, fontWeight: 700 }}>{symbol}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>DAILY · RUNS IN YOUR BROWSER</span>
          {guide.button}
        </div>
        <button type="button" style={{ ...btn, opacity: result?.trades.length ? 1 : 0.4 }} disabled={!result?.trades.length} onClick={exportTrades} title="Download the trade list as CSV">
          EXPORT TRADES
        </button>
      </div>
      {guide.body}

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <label style={lbl}>
          STRATEGY
          <select style={ctl} value={strategyId} onChange={e => setStrategyId(e.target.value as StrategyId)}>
            {(Object.keys(STRATEGIES) as StrategyId[]).map(id => <option key={id} value={id}>{STRATEGIES[id].label}</option>)}
          </select>
        </label>

        {strategyId === 'sma-cross' && (<>
          <NumberField label="FAST" value={active.fast ?? 50} min={2} max={400} onChange={n => patch({ fast: n })} />
          <NumberField label="SLOW" value={active.slow ?? 200} min={3} max={600} onChange={n => patch({ slow: n })} />
        </>)}
        {strategyId === 'rsi-reversion' && (<>
          <NumberField label="RSI PERIOD" value={active.rsiPeriod ?? 14} min={2} max={100} onChange={n => patch({ rsiPeriod: n })} />
          <NumberField label="BUY BELOW" value={active.buyBelow ?? 30} min={1} max={99} onChange={n => patch({ buyBelow: n })} />
          <NumberField label="SELL ABOVE" value={active.sellAbove ?? 55} min={1} max={99} onChange={n => patch({ sellAbove: n })} />
        </>)}
        {strategyId === 'donchian-breakout' && (<>
          <NumberField label="ENTRY BARS" value={active.entryLen ?? 55} min={2} max={400} onChange={n => patch({ entryLen: n })} />
          <NumberField label="EXIT BARS" value={active.exitLen ?? 20} min={2} max={400} onChange={n => patch({ exitLen: n })} />
        </>)}

        <NumberField label="COST (BPS/TRADE)" value={costBps} min={0} max={500} onChange={setCostBps} />

        <div style={lbl}>
          HISTORY
          <div style={{ display: 'flex', gap: 4 }}>
            {RANGES.map(r => (
              <button key={r.id} type="button" aria-pressed={range === r.id} onClick={() => setRange(r.id)}
                style={{ ...btn, background: range === r.id ? 'var(--amber)' : 'var(--bg-deep)', color: range === r.id ? 'var(--bg-deep)' : 'var(--text-2)', borderColor: range === r.id ? 'var(--amber)' : 'var(--border)' }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: '6px 10px', fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO, borderBottom: '1px solid var(--border)' }}>
        {STRATEGIES[strategyId].description} Signals use the close; orders fill at the next open. Long-only, no leverage.
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {isLoading && !data ? (
          <PanelSkeleton label={`Loading ${symbol} price history…`} />
        ) : error ? (
          <Message text="Could not load price history. Try again shortly." bad />
        ) : invalidCross ? (
          <Message text="The fast period must be smaller than the slow period." bad />
        ) : !result ? (
          <Message text={candles.length ? `Only ${candles.length} daily bars available for ${symbol}; at least ${MIN_BARS} are needed.` : `No daily price history found for ${symbol}.`} bad />
        ) : (
          <>
            {/* Verdict */}
            <div style={{ padding: '8px 10px', fontFamily: MONO, fontSize: 12, color: tone(edge), borderBottom: '1px solid var(--border)' }}>
              {edge !== null && Math.abs(edge) < 0.05
                ? 'Matched buy-and-hold over this period.'
                : `${(edge ?? 0) > 0 ? 'Beat' : 'Lagged'} buy-and-hold by ${Math.abs(edge ?? 0).toFixed(1)} percentage points over ${result.years.toFixed(1)} years (${result.bars} bars, after costs).`}
            </div>

            <EquityChart strategy={result.equity} benchmark={result.benchEquity} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, padding: '8px 10px' }}>
              <Compare label="TOTAL RETURN" a={result.strategy.totalReturnPct} b={result.benchmark.totalReturnPct} fmt={pct} />
              <Compare label="ANNUALISED (CAGR)" a={result.strategy.cagrPct} b={result.benchmark.cagrPct} fmt={pct} />
              <Compare label="MAX DRAWDOWN" a={result.strategy.maxDrawdownPct} b={result.benchmark.maxDrawdownPct} fmt={pct} />
              <Compare label="SHARPE (RF 0%)" a={result.strategy.sharpe} b={result.benchmark.sharpe} fmt={n => num(n)} plain />
              <Single label="TRADES" value={String(result.trades.length)} />
              <Single label="WIN RATE" value={result.winRatePct == null ? '—' : `${result.winRatePct.toFixed(0)}%`} />
              <Single label="PROFIT FACTOR" value={num(result.profitFactor)} />
              <Single label="TIME IN MARKET" value={`${result.exposurePct.toFixed(0)}%`} />
            </div>

            {result.trades.length === 0 ? (
              <Message text="The strategy never entered a trade in this period." />
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: 11 }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    {['ENTRY', 'PRICE', 'EXIT', 'PRICE', 'BARS', 'RETURN'].map((h, i) => (
                      <th key={i} style={{ padding: '6px 8px', textAlign: i === 0 || i === 2 ? 'left' : 'right', borderBottom: '1px solid var(--border)', fontWeight: 700, letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...result.trades].reverse().slice(0, 12).map((t, i) => (
                    <tr key={i}>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)' }}>{day(t.entryTime)}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>{t.entryPrice.toFixed(2)}</td>
                      <td style={{ padding: '5px 8px', borderBottom: '1px solid var(--border)', color: t.exitTime == null ? 'var(--amber)' : undefined }}>{day(t.exitTime)}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>{t.exitPrice == null ? '—' : t.exitPrice.toFixed(2)}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>{t.bars}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', color: tone(t.returnPct), fontWeight: 700 }}>{pct(t.returnPct, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {result.trades.length > 12 && (
              <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>
                Showing the latest 12 of {result.trades.length} trades. Export for the full list.
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        Past performance does not predict future results. Excludes dividends and taxes; tuning parameters to past data overstates results. Not financial advice.
      </div>
    </div>
  )
}

function Message({ text, bad }: { text: string; bad?: boolean }) {
  return <div role="status" style={{ padding: '22px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: bad ? 'var(--negative)' : 'var(--text-muted)' }}>{text}</div>
}

function Compare({ label, a, b, fmt, plain }: { label: string; a: number | null; b: number | null; fmt: (n: number | null) => string; plain?: boolean }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '7px 9px', background: 'var(--bg-deep)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: plain ? 'var(--text)' : tone(a) }}>{fmt(a)}</div>
      <div style={{ fontSize: 10, fontFamily: MONO, color: 'var(--text-muted)' }}>buy &amp; hold {fmt(b)}</div>
    </div>
  )
}

function Single({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '7px 9px', background: 'var(--bg-deep)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

function EquityChart({ strategy, benchmark }: { strategy: number[]; benchmark: number[] }) {
  const W = 600, H = 150, PAD = 4
  const path = useMemo(() => {
    const all = [...strategy, ...benchmark]
    const lo = Math.min(...all), hi = Math.max(...all)
    const span = hi - lo || 1
    // Downsample long histories so the SVG stays light.
    const step = Math.max(1, Math.floor(strategy.length / 600))
    const line = (series: number[]) => {
      const pts: string[] = []
      for (let i = 0; i < series.length; i += step) {
        const x = PAD + (i / (series.length - 1)) * (W - 2 * PAD)
        const y = H - PAD - ((series[i] - lo) / span) * (H - 2 * PAD)
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
      }
      return pts.join(' ')
    }
    const baseY = H - PAD - ((1 - lo) / span) * (H - 2 * PAD)
    return { strategy: line(strategy), benchmark: line(benchmark), baseY }
  }, [strategy, benchmark])

  return (
    <div style={{ padding: '8px 10px 2px' }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Equity curve: strategy versus buy and hold"
        style={{ width: '100%', height: 150, display: 'block', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 4 }}>
        <line x1={PAD} x2={W - PAD} y1={path.baseY} y2={path.baseY} stroke="var(--border-br)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        <polyline points={path.benchmark} fill="none" stroke="var(--text-muted)" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        <polyline points={path.strategy} fill="none" stroke="var(--amber)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', gap: 14, padding: '4px 2px', fontSize: 10, fontFamily: MONO, color: 'var(--text-muted)' }}>
        <span><span style={{ color: 'var(--amber)' }}>━</span> Strategy</span>
        <span><span style={{ color: 'var(--text-muted)' }}>━</span> Buy &amp; hold</span>
        <span>Dashed line = starting capital</span>
      </div>
    </div>
  )
}

