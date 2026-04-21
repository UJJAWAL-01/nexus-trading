'use client'

import { useMemo } from 'react'
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { useTradingContext, TradeEntry } from '@/components/trading/TradingContext'

// ── Recharts shared styles ────────────────────────────────────────────────────

const TT = { background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 5, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)', padding: '6px 10px' }
const TX = { fontSize: 9, fill: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }
const SH: React.CSSProperties = {
  fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)',
  letterSpacing: '0.12em', textTransform: 'uppercase', padding: '7px 14px',
  borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.012)',
}

// ── Core stats hook ───────────────────────────────────────────────────────────

function useStats(trades: TradeEntry[]) {
  return useMemo(() => {
    const total = trades.length
    if (total === 0) return null

    const hasDollar  = trades.some(t => (t.pnlDollar ?? 0) !== 0)
    const getPnL     = (t: TradeEntry) => hasDollar ? (t.pnlDollar ?? 0) : t.pips
    const pnlLabel   = hasDollar ? '$' : 'pips'

    const wins   = trades.filter(t => t.outcome === 'win')
    const losses = trades.filter(t => t.outcome === 'loss')
    const wr     = (wins.length / total) * 100
    const lr     = (losses.length / total) * 100

    const winPnLs  = wins.map(getPnL)
    const lossPnLs = losses.map(t => Math.abs(getPnL(t)))
    const avgWin   = winPnLs.length  > 0 ? winPnLs.reduce((s, v)  => s + v, 0)  / winPnLs.length  : 0
    const avgLoss  = lossPnLs.length > 0 ? lossPnLs.reduce((s, v) => s + v, 0)  / lossPnLs.length : 0
    const grossW   = winPnLs.reduce((s, v) => s + v, 0)
    const grossL   = lossPnLs.reduce((s, v) => s + v, 0)
    const pf       = grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : 0
    const expect   = (wr / 100) * avgWin - (lr / 100) * avgLoss

    // Equity curve (chronological = reversed, newest is index 0)
    const chron   = trades.slice().reverse()
    const equity: { n: number; cum: number; trade: number }[] = []
    let cum = 0, peak = 0, maxDD = 0
    chron.forEach((t, i) => {
      const p = getPnL(t)
      cum += p
      equity.push({ n: i + 1, cum: parseFloat(cum.toFixed(hasDollar ? 2 : 1)), trade: parseFloat(p.toFixed(hasDollar ? 2 : 1)) })
      if (cum > peak) peak = cum
      const dd = peak - cum
      if (dd > maxDD) maxDD = dd
    })

    // R:R
    const rrVals = trades.filter(t => t.rr > 0).map(t => t.rr)
    const avgRR  = rrVals.length > 0 ? rrVals.reduce((s, r) => s + r, 0) / rrVals.length : 0

    // Streak (from most-recent = index 0)
    let streak = 0
    for (let i = 0; i < trades.length; i++) {
      if (i === 0) { streak = trades[i].outcome === 'win' ? 1 : trades[i].outcome === 'loss' ? -1 : 0; continue }
      if      (trades[i].outcome === 'win'  && streak > 0) streak++
      else if (trades[i].outcome === 'loss' && streak < 0) streak--
      else break
    }

    // Best / worst single trade
    const sortedByPnL = [...trades].sort((a, b) => getPnL(b) - getPnL(a))
    const bestTrade   = sortedByPnL[0]
    const worstTrade  = sortedByPnL[sortedByPnL.length - 1]

    return {
      total, wins: wins.length, losses: losses.length, be: total - wins.length - losses.length,
      wr, pf, avgRR, expect, avgWin, avgLoss, grossW, grossL,
      maxDD: parseFloat(maxDD.toFixed(hasDollar ? 2 : 1)),
      streak, equity, hasDollar, pnlLabel, bestTrade, worstTrade,
    }
  }, [trades])
}

// ── Summary stats grid ────────────────────────────────────────────────────────

function SummaryGrid({ s }: { s: NonNullable<ReturnType<typeof useStats>> }) {
  const fmt = (v: number) => s.hasDollar ? `$${Math.abs(v).toFixed(2)}` : `${Math.abs(v).toFixed(1)}p`
  const items = [
    { l: 'Total',    v: String(s.total),                                              c: 'var(--text)' },
    { l: 'Win Rate', v: `${s.wr.toFixed(1)}%`,                                       c: s.wr >= 50 ? 'var(--positive)' : 'var(--negative)' },
    { l: 'Prof. Factor', v: isFinite(s.pf) ? s.pf.toFixed(2) : '∞',                 c: s.pf >= 1.5 ? 'var(--positive)' : s.pf >= 1 ? 'var(--amber)' : 'var(--negative)' },
    { l: 'Expectancy', v: s.expect !== 0 ? `${s.expect >= 0 ? '+' : ''}${fmt(s.expect)}` : '—', c: s.expect >= 0 ? 'var(--positive)' : 'var(--negative)' },
    { l: 'Avg Win',  v: s.avgWin  > 0 ? `+${fmt(s.avgWin)}`  : '—',                 c: 'var(--positive)' },
    { l: 'Avg Loss', v: s.avgLoss > 0 ? `-${fmt(s.avgLoss)}` : '—',                 c: 'var(--negative)' },
    { l: 'Max DD',   v: s.maxDD   > 0 ? `-${fmt(s.maxDD)}`   : '—',                 c: s.maxDD > 0 ? 'var(--negative)' : 'var(--text-muted)' },
    { l: 'Streak',   v: s.streak === 0 ? '—' : s.streak > 0 ? `+${s.streak}W` : `${Math.abs(s.streak)}L`,
                        c: s.streak > 0 ? 'var(--positive)' : s.streak < 0 ? 'var(--negative)' : 'var(--text-muted)' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, borderBottom: '1px solid var(--border)' }}>
      {items.map(({ l, v, c }) => (
        <div key={l} style={{ padding: '8px 10px', background: 'var(--bg-deep)', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 8, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.09em', textTransform: 'uppercase', marginBottom: 3 }}>{l}</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 13, color: c, lineHeight: 1 }}>{v}</div>
        </div>
      ))}
    </div>
  )
}

// ── Equity curve ──────────────────────────────────────────────────────────────

function EquityCurve({ trades, s }: { trades: TradeEntry[]; s: NonNullable<ReturnType<typeof useStats>> }) {
  const finalPnL = s.equity.length > 0 ? s.equity[s.equity.length - 1].cum : 0
  const color    = finalPnL >= 0 ? 'var(--positive)' : 'var(--negative)'
  const colorHex = finalPnL >= 0 ? '#00c97a' : '#ff4560'

  return (
    <div>
      <div style={SH}>Equity Curve <span style={{ color: finalPnL >= 0 ? 'var(--positive)' : 'var(--negative)', marginLeft: 6 }}>
        {finalPnL >= 0 ? '+' : ''}{s.hasDollar ? `$${finalPnL.toFixed(2)}` : `${finalPnL.toFixed(1)} pips`}
      </span></div>
      <div style={{ padding: '10px 6px 4px 0' }}>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={s.equity} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={colorHex} stopOpacity={0.18} />
                <stop offset="95%" stopColor={colorHex} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="n" tick={TX} label={{ value: 'Trade #', position: 'insideBottomRight', offset: -4, style: { fontSize: 9, fill: 'var(--text-dim)' } }} />
            <YAxis tick={TX} tickFormatter={v => s.hasDollar ? `$${v}` : String(v)} width={50} />
            <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 2" />
            <Tooltip contentStyle={TT}
              formatter={(v: any) => [s.hasDollar ? `$${Number(v).toFixed(2)}` : `${v} pips`, 'Cum. P&L']}
              labelFormatter={(n: any) => `Trade #${n}`}
            />
            <Area type="monotone" dataKey="cum" stroke={color} strokeWidth={2} fill="url(#eqGrad)" dot={false} activeDot={{ r: 3, fill: colorHex }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Win rate by day ───────────────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

function WinRateByDay({ trades }: { trades: TradeEntry[] }) {
  const data = useMemo(() => DAYS.map((day, i) => {
    const dow  = i === 4 ? 5 : i + 1
    const sub  = trades.filter(t => new Date(t.dateTime).getDay() === dow)
    const wins = sub.filter(t => t.outcome === 'win').length
    return { day, wr: sub.length > 0 ? (wins / sub.length) * 100 : 0, n: sub.length }
  }), [trades])

  return (
    <div>
      <div style={SH}>Win Rate by Day</div>
      <div style={{ padding: '10px 6px 4px 0' }}>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={data} barSize={22}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={TX} />
            <YAxis domain={[0, 100]} tick={TX} unit="%" width={36} />
            <Tooltip contentStyle={TT} formatter={(v: any, _: any, p: any) => [`${Number(v).toFixed(1)}% (${p.payload.n} trades)`, 'Win Rate']} />
            <Bar dataKey="wr" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.wr >= 55 ? '#00c97a' : d.wr >= 35 ? '#f0a500' : '#ff4560'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── P&L by pair ───────────────────────────────────────────────────────────────

function PnLByPair({ trades, s }: { trades: TradeEntry[]; s: NonNullable<ReturnType<typeof useStats>> }) {
  const data = useMemo(() => {
    const m: Record<string, { pnl: number; n: number; wins: number }> = {}
    trades.forEach(t => {
      m[t.pair] ??= { pnl: 0, n: 0, wins: 0 }
      m[t.pair].pnl  += s.hasDollar ? (t.pnlDollar ?? 0) : t.pips
      m[t.pair].n++
      if (t.outcome === 'win') m[t.pair].wins++
    })
    return Object.entries(m)
      .map(([pair, { pnl, n, wins }]) => ({
        pair, pnl: parseFloat(pnl.toFixed(s.hasDollar ? 2 : 1)), n, wr: Math.round((wins / n) * 100),
      }))
      .sort((a, b) => b.pnl - a.pnl)
  }, [trades, s.hasDollar])

  if (data.length === 0) return (
    <div>
      <div style={SH}>P&amp;L by Pair</div>
      <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>No pair data yet</div>
    </div>
  )

  return (
    <div>
      <div style={SH}>P&amp;L by Pair</div>
      <div style={{ padding: '10px 6px 4px 14px' }}>
        <ResponsiveContainer width="100%" height={Math.max(90, data.length * 30)}>
          <BarChart data={data} layout="vertical" barSize={14}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tick={TX} tickFormatter={v => s.hasDollar ? `$${v}` : String(v)} />
            <YAxis type="category" dataKey="pair" tick={{ ...TX, fill: 'var(--text-2)' }} width={68} />
            <ReferenceLine x={0} stroke="var(--border)" />
            <Tooltip contentStyle={TT}
              formatter={(v: any, _: any, p: any) => [
                `${s.hasDollar ? `$${Number(v).toFixed(2)}` : `${v} pips`}  (${p.payload.n} trades, ${p.payload.wr}% WR)`,
                'P&L',
              ]}
            />
            <Bar dataKey="pnl" radius={[0, 3, 3, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.pnl >= 0 ? '#00c97a' : '#ff4560'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Win rate by setup ─────────────────────────────────────────────────────────

function WinRateBySetup({ trades }: { trades: TradeEntry[] }) {
  const data = useMemo(() => {
    const m: Record<string, { wins: number; total: number }> = {}
    trades.forEach(t => t.setupTags.forEach(tag => {
      m[tag] ??= { wins: 0, total: 0 }
      m[tag].total++
      if (t.outcome === 'win') m[tag].wins++
    }))
    return Object.entries(m)
      .map(([tag, { wins, total }]) => ({ tag, wr: (wins / total) * 100, n: total }))
      .sort((a, b) => b.wr - a.wr)
  }, [trades])

  if (data.length === 0) return (
    <div>
      <div style={SH}>Win Rate by Setup</div>
      <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
        Tag trades with setups to see performance breakdown
      </div>
    </div>
  )

  return (
    <div>
      <div style={SH}>Win Rate by Setup</div>
      <div style={{ padding: '10px 6px 4px 14px' }}>
        <ResponsiveContainer width="100%" height={Math.max(90, data.length * 34)}>
          <BarChart data={data} layout="vertical" barSize={16}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={TX} unit="%" />
            <YAxis type="category" dataKey="tag" tick={{ ...TX, fill: 'var(--text-2)' }} width={100} />
            <Tooltip contentStyle={TT}
              formatter={(v: any, _: any, p: any) => [`${Number(v).toFixed(1)}% (${p.payload.n} trades)`, 'Win Rate']}
            />
            <Bar dataKey="wr" radius={[0, 3, 3, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.wr >= 60 ? '#00c97a' : d.wr >= 40 ? '#f0a500' : '#ff4560'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Emotion analysis ──────────────────────────────────────────────────────────

function EmotionAnalysis({ trades }: { trades: TradeEntry[] }) {
  const data = useMemo(() => {
    const m: Record<string, { wins: number; losses: number; total: number }> = {}
    trades.forEach(t => {
      const e = t.emotion || 'Unknown'
      m[e] ??= { wins: 0, losses: 0, total: 0 }
      m[e].total++
      if (t.outcome === 'win')  m[e].wins++
      if (t.outcome === 'loss') m[e].losses++
    })
    return Object.entries(m)
      .map(([emotion, { wins, losses, total }]) => ({
        emotion, wr: (wins / total) * 100, n: total, wins, losses,
      }))
      .sort((a, b) => b.wr - a.wr)
  }, [trades])

  if (data.length === 0) return (
    <div>
      <div style={SH}>Win Rate by Emotion</div>
      <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
        Log trades and tag emotions to see win rate by mindset
      </div>
    </div>
  )

  return (
    <div>
      <div style={SH}>Win Rate by Emotion</div>
      <div style={{ padding: '10px 6px 4px 14px' }}>
        <ResponsiveContainer width="100%" height={Math.max(90, data.length * 32)}>
          <BarChart data={data} layout="vertical" barSize={14}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={TX} unit="%" />
            <YAxis type="category" dataKey="emotion" tick={{ ...TX, fill: 'var(--text-2)' }} width={84} />
            <Tooltip contentStyle={TT}
              formatter={(v: any, _: any, p: any) =>
                [`${Number(v).toFixed(1)}%  (${p.payload.wins}W / ${p.payload.losses}L / ${p.payload.n} total)`, 'Win Rate']
              }
            />
            <Bar dataKey="wr" radius={[0, 3, 3, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.wr >= 60 ? '#00c97a' : d.wr >= 40 ? '#f0a500' : '#ff4560'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── P&L calendar heatmap ──────────────────────────────────────────────────────

function PnLHeatmap({ trades, s }: { trades: TradeEntry[]; s: NonNullable<ReturnType<typeof useStats>> }) {
  const { cells, maxAbs } = useMemo(() => {
    const byDay: Record<string, number> = {}
    trades.forEach(t => {
      const d = t.dateTime.slice(0, 10)
      byDay[d] = (byDay[d] ?? 0) + (s.hasDollar ? (t.pnlDollar ?? 0) : t.pips)
    })
    if (!Object.keys(byDay).length) return { cells: [], maxAbs: 1 }

    const dates  = Object.keys(byDay).sort()
    const maxAbs = Math.max(1, ...Object.values(byDay).map(Math.abs))
    const cur    = new Date(dates[0])
    const dow0   = cur.getDay() === 0 ? 6 : cur.getDay() - 1
    cur.setDate(cur.getDate() - dow0)
    const end    = new Date(dates[dates.length - 1])
    const result: { date: string; pnl: number | null }[] = []
    while (cur <= end) {
      const k = cur.toISOString().slice(0, 10)
      result.push({ date: k, pnl: byDay[k] ?? null })
      cur.setDate(cur.getDate() + 1)
    }
    return { cells: result, maxAbs }
  }, [trades, s.hasDollar])

  const cellColor = (pnl: number | null) => {
    if (pnl === null) return 'var(--bg-deep)'
    if (pnl === 0)    return 'var(--border)'
    const i = Math.min(Math.abs(pnl) / maxAbs, 1)
    if (pnl > 0) return `rgba(0, ${Math.round(120 + i * 81)}, ${Math.round(80 + i * 42)}, 1)`
    return `rgba(${Math.round(140 + i * 115)}, 40, 55, 1)`
  }

  if (!cells.length) return (
    <div>
      <div style={SH}>P&amp;L Calendar</div>
      <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
        No trades to display
      </div>
    </div>
  )

  const weeks: typeof cells[] = []
  let week: typeof cells = []
  cells.forEach((c, i) => {
    week.push(c)
    if ((i + 1) % 7 === 0 || i === cells.length - 1) { weeks.push(week); week = [] }
  })

  const fmt = (pnl: number) => s.hasDollar ? `$${pnl.toFixed(2)}` : `${pnl.toFixed(1)} pips`

  return (
    <div>
      <div style={SH}>P&amp;L Calendar</div>
      <div style={{ padding: '10px 14px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 3 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 20 }}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <div key={i} style={{ width: 12, height: 12, fontSize: 8, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{d}</div>
            ))}
          </div>
          {weeks.map((w, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {wi === 0 && <div style={{ height: 18 }} />}
              {w.map((c, ci) => (
                <div key={ci}
                  title={c.pnl !== null ? `${c.date}: ${c.pnl >= 0 ? '+' : ''}${fmt(c.pnl)}` : c.date}
                  style={{ width: 12, height: 12, borderRadius: 2, background: cellColor(c.pnl), cursor: 'default' }}
                />
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          {[['rgba(0,180,120,1)', 'Profit'], ['rgba(240,40,55,1)', 'Loss'], ['var(--bg-deep)', 'No trades']].map(([c, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block', border: '1px solid var(--border)' }} />
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Best / Worst trade callout ─────────────────────────────────────────────────

function TradeCallouts({ s }: { s: NonNullable<ReturnType<typeof useStats>> }) {
  const fmt = (t: TradeEntry) => {
    const pnl = s.hasDollar ? (t.pnlDollar ?? 0) : t.pips
    return `${t.pair} ${t.direction}  ${pnl >= 0 ? '+' : ''}${s.hasDollar ? `$${pnl.toFixed(2)}` : `${pnl.toFixed(1)}p`}`
  }
  if (!s.bestTrade || !s.worstTrade) return null
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, borderBottom: '1px solid var(--border)', borderTop: '1px solid var(--border)' }}>
      {[
        { label: 'Best Trade', trade: s.bestTrade,  color: 'var(--positive)', bg: 'rgba(0,201,122,0.06)' },
        { label: 'Worst Trade', trade: s.worstTrade, color: 'var(--negative)', bg: 'rgba(255,69,96,0.06)' },
      ].map(({ label, trade, color, bg }) => (
        <div key={label} style={{ padding: '6px 14px', background: bg, borderRight: '1px solid var(--border)' }}>
          <span style={{ fontSize: 8, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 2 }}>{label}</span>
          <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color }}>{fmt(trade)}</span>
          {trade.setupTags[0] && (
            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 8 }}>{trade.setupTags[0]}</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AnalyticsPanel() {
  const { tradeHistory } = useTradingContext()
  const stats = useStats(tradeHistory)

  if (!stats) {
    return (
      <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header">
          <div className="dot" style={{ background: '#a78bfa' }} />
          FX ANALYTICS
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 }}>
          <div style={{ width: 52, height: 52, borderRadius: 10, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
            📈
          </div>
          <div style={{ textAlign: 'center', maxWidth: 280 }}>
            <div style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, marginBottom: 8 }}>
              Analytics start here
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.65 }}>
              Log trades in the Journal to unlock equity curves, win rates by setup, emotion analysis, P&L by pair, and calendar heatmaps.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            {['Equity curve', 'Expectancy', 'Emotion edge', 'Pair P&L'].map(t => (
              <span key={t} style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ color: 'var(--teal)' }}>●</span> {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" style={{ background: '#a78bfa' }} />
        FX ANALYTICS
        <span className="panel-header-sub">
          {stats.total} trades · {stats.wins}W {stats.losses}L
          {stats.hasDollar ? ' · $ mode' : ' · pip mode'}
        </span>
      </div>

      <SummaryGrid s={stats} />
      <TradeCallouts s={stats} />

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Row 1: Equity curve + Win by day */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
          <div style={{ borderRight: '1px solid var(--border)' }}>
            <EquityCurve trades={tradeHistory} s={stats} />
          </div>
          <WinRateByDay trades={tradeHistory} />
        </div>

        {/* Row 2: P&L by pair + Emotion */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--border)' }}>
          <div style={{ borderRight: '1px solid var(--border)' }}>
            <PnLByPair trades={tradeHistory} s={stats} />
          </div>
          <EmotionAnalysis trades={tradeHistory} />
        </div>

        {/* Row 3: Win by setup + Calendar */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ borderRight: '1px solid var(--border)' }}>
            <WinRateBySetup trades={tradeHistory} />
          </div>
          <PnLHeatmap trades={tradeHistory} s={stats} />
        </div>
      </div>
    </div>
  )
}
