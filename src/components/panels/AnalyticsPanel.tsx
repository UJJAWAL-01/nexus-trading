'use client'

import { useMemo } from 'react'
import {
  LineChart, Line, BarChart, Bar, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useTradingContext, TradeEntry } from '@/components/trading/TradingContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function useStats(trades: TradeEntry[]) {
  return useMemo(() => {
    const total   = trades.length
    const wins    = trades.filter(t => t.outcome === 'win').length
    const winRate = total > 0 ? (wins / total) * 100 : 0
    const gW      = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
    const gL      = trades.filter(t => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0)
    const pf      = gL > 0 ? gW / gL : gW > 0 ? Infinity : 0
    const rrVals  = trades.filter(t => t.rr > 0).map(t => t.rr)
    const avgRR   = rrVals.length > 0 ? rrVals.reduce((s, r) => s + r, 0) / rrVals.length : 0
    const byDay: Record<string, number> = {}
    trades.forEach(t => { const d = t.dateTime.slice(0, 10); byDay[d] = (byDay[d] ?? 0) + t.pnl })
    const days    = Object.entries(byDay).sort((a, b) => b[1] - a[1])
    let streak    = 0
    for (let i = 0; i < trades.length; i++) {
      if (i === 0) { streak = trades[i].outcome === 'win' ? 1 : -1; continue }
      if (trades[i].outcome === 'win' && streak > 0) streak++
      else if (trades[i].outcome === 'loss' && streak < 0) streak--
      else break
    }
    return { total, winRate, pf, avgRR, bestDay: days[0], worstDay: days[days.length - 1], streak }
  }, [trades])
}

// ── Shared tooltip style ──────────────────────────────────────────────────────

const tooltipStyle = { background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)' }
const tickStyle    = { fontSize: 10, fill: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }

// ── Equity Curve ──────────────────────────────────────────────────────────────

function EquityCurve({ trades }: { trades: TradeEntry[] }) {
  const data = useMemo(() => {
    let cum = 0
    return trades.slice().reverse().map((t, i) => ({ n: i + 1, pnl: Number((cum += t.pnl).toFixed(5)) }))
  }, [trades])

  return (
    <div style={{ padding: '0 0 12px' }}>
      <div className="nx-section">Equity Curve</div>
      <div style={{ padding: '10px 14px 0' }}>
        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={data}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="n" tick={tickStyle} />
            <YAxis tick={tickStyle} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={v => `Trade #${v}`} formatter={v => [Number(v).toFixed(5), 'Cum. P&L']} />
            <Line type="monotone" dataKey="pnl" stroke="var(--positive)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Win Rate by Day ───────────────────────────────────────────────────────────

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

function WinRateByDay({ trades }: { trades: TradeEntry[] }) {
  const data = useMemo(() => DAYS.map((day, i) => {
    const dow   = i === 4 ? 5 : i + 1
    const sub   = trades.filter(t => { const d = new Date(t.dateTime).getDay(); return d === dow })
    const wins  = sub.filter(t => t.outcome === 'win').length
    return { day, winRate: sub.length > 0 ? (wins / sub.length) * 100 : 0, total: sub.length }
  }), [trades])

  return (
    <div>
      <div className="nx-section">Win Rate by Day</div>
      <div style={{ padding: '10px 14px' }}>
        <ResponsiveContainer width="100%" height={130}>
          <BarChart data={data} barSize={20}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={tickStyle} />
            <YAxis domain={[0, 100]} tick={tickStyle} unit="%" />
            <Tooltip contentStyle={tooltipStyle}
              formatter={(v, _, p) => [`${Number(v).toFixed(1)}% (${(p as { payload: { total: number } }).payload.total})`, 'Win Rate']} />
            <Bar dataKey="winRate" radius={[3, 3, 0, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.winRate >= 50 ? 'var(--positive)' : d.winRate >= 30 ? 'var(--amber)' : 'var(--negative)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── Win Rate by Setup ─────────────────────────────────────────────────────────

function WinRateBySetup({ trades }: { trades: TradeEntry[] }) {
  const data = useMemo(() => {
    const m: Record<string, { wins: number; total: number }> = {}
    trades.forEach(t => t.setupTags.forEach(tag => {
      m[tag] ??= { wins: 0, total: 0 }; m[tag].total++
      if (t.outcome === 'win') m[tag].wins++
    }))
    return Object.entries(m).map(([tag, { wins, total }]) => ({ tag, winRate: (wins / total) * 100, total })).sort((a, b) => b.winRate - a.winRate)
  }, [trades])

  if (data.length === 0) return (
    <div><div className="nx-section">Win Rate by Setup</div>
      <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>No tagged trades yet</div>
    </div>
  )

  return (
    <div>
      <div className="nx-section">Win Rate by Setup</div>
      <div style={{ padding: '10px 14px' }}>
        <ResponsiveContainer width="100%" height={Math.max(100, data.length * 34)}>
          <BarChart data={data} layout="vertical" barSize={16}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={tickStyle} unit="%" />
            <YAxis type="category" dataKey="tag" tick={{ ...tickStyle, fill: 'var(--text-2)' }} width={88} />
            <Tooltip contentStyle={tooltipStyle}
              formatter={(v, _, p) => [`${Number(v).toFixed(1)}% (${(p as { payload: { total: number } }).payload.total})`, 'Win Rate']} />
            <Bar dataKey="winRate" radius={[0, 3, 3, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.winRate >= 60 ? 'var(--positive)' : d.winRate >= 40 ? 'var(--amber)' : 'var(--negative)'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ── P&L Heatmap ───────────────────────────────────────────────────────────────

function PnLHeatmap({ trades }: { trades: TradeEntry[] }) {
  const cells = useMemo(() => {
    const byDay: Record<string, number> = {}
    trades.forEach(t => { const d = t.dateTime.slice(0, 10); byDay[d] = (byDay[d] ?? 0) + t.pnl })
    if (!Object.keys(byDay).length) return []
    const dates = Object.keys(byDay).sort()
    const cur = new Date(dates[0])
    const dow0 = cur.getDay() === 0 ? 6 : cur.getDay() - 1
    cur.setDate(cur.getDate() - dow0)
    const end = new Date(dates[dates.length - 1])
    const result: { date: string; pnl: number | null }[] = []
    while (cur <= end) {
      const k = cur.toISOString().slice(0, 10)
      result.push({ date: k, pnl: byDay[k] ?? null })
      cur.setDate(cur.getDate() + 1)
    }
    return result
  }, [trades])

  function cellColor(pnl: number | null) {
    if (pnl === null) return 'var(--bg-deep)'
    if (pnl === 0)   return 'var(--border)'
    const i = Math.min(Math.abs(pnl) / 0.005, 1)
    if (pnl > 0) return `rgba(0, ${Math.round(130 + i * 71)}, 90, 1)`
    return `rgba(${Math.round(140 + i * 115)}, 40, 55, 1)`
  }

  if (!cells.length) return (
    <div><div className="nx-section">P&L Calendar Heatmap</div>
      <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>No trades to display</div>
    </div>
  )

  // Split into weeks
  const weeks: { date: string; pnl: number | null }[][] = []
  let week: { date: string; pnl: number | null }[] = []
  cells.forEach((c, i) => {
    week.push(c)
    if ((i + 1) % 7 === 0 || i === cells.length - 1) { weeks.push(week); week = [] }
  })

  return (
    <div>
      <div className="nx-section">P&L Calendar Heatmap</div>
      <div style={{ padding: '10px 14px', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 3 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingTop: 20 }}>
            {['M','T','W','T','F','S','S'].map((d, i) => (
              <div key={i} style={{ width: 12, height: 12, fontSize: 8, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{d}</div>
            ))}
          </div>
          {weeks.map((w, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {wi === 0 && <div style={{ height: 18 }} />}
              {w.map((c, ci) => (
                <div key={ci} title={c.pnl !== null ? `${c.date}: ${c.pnl > 0 ? '+' : ''}${c.pnl.toFixed(5)}` : c.date}
                  style={{ width: 12, height: 12, borderRadius: 2, background: cellColor(c.pnl), cursor: 'default' }} />
              ))}
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
          {[['rgba(0,180,90,1)', 'Profit'], ['rgba(240,40,55,1)', 'Loss'], ['var(--bg-deep)', 'No trades']].map(([c, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block', border: '1px solid var(--border)' }} />{l}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Summary stats ─────────────────────────────────────────────────────────────

function SummaryStats({ s }: { s: ReturnType<typeof useStats> }) {
  const items = [
    { label: 'Total',   value: String(s.total),                                        color: 'var(--text)' },
    { label: 'Win Rate', value: `${s.winRate.toFixed(1)}%`,                            color: s.winRate >= 50 ? 'var(--positive)' : 'var(--negative)' },
    { label: 'Prof. Factor', value: isFinite(s.pf) ? s.pf.toFixed(2) : '∞',           color: s.pf >= 1.5 ? 'var(--positive)' : s.pf >= 1 ? 'var(--amber)' : 'var(--negative)' },
    { label: 'Avg R:R', value: s.avgRR > 0 ? `1:${s.avgRR.toFixed(2)}` : '—',        color: 'var(--text)' },
    { label: 'Best Day', value: s.bestDay ? `+${s.bestDay[1].toFixed(4)}` : '—',      color: 'var(--positive)' },
    { label: 'Worst Day', value: s.worstDay ? s.worstDay[1].toFixed(4) : '—',         color: 'var(--negative)' },
    { label: 'Streak',  value: s.streak === 0 ? '—' : s.streak > 0 ? `+${s.streak}W` : `${Math.abs(s.streak)}L`,
      color: s.streak > 0 ? 'var(--positive)' : s.streak < 0 ? 'var(--negative)' : 'var(--text-muted)' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, borderBottom: '1px solid var(--border)' }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{ padding: '8px 10px', background: 'var(--bg-deep)', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 13, color }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function AnalyticsPanel() {
  const { tradeHistory } = useTradingContext()
  const stats = useStats(tradeHistory)

  if (tradeHistory.length === 0) {
    return (
      <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="panel-header">
          <div className="dot" style={{ background: '#a78bfa' }} />
          FX ANALYTICS
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <span style={{ fontSize: 36, opacity: 0.15 }}>📈</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            Start logging trades to see analytics
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            Equity curves, win rates, and P&L heatmaps will appear here
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" style={{ background: '#a78bfa' }} />
        FX ANALYTICS
        <span className="panel-header-sub">{tradeHistory.length} trades</span>
      </div>
      <SummaryStats s={stats} />
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ borderRight: '1px solid var(--border)' }}><EquityCurve trades={tradeHistory} /></div>
          <div><WinRateByDay trades={tradeHistory} /></div>
        </div>
        <div style={{ borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
          <div style={{ borderRight: '1px solid var(--border)' }}><WinRateBySetup trades={tradeHistory} /></div>
          <div><PnLHeatmap trades={tradeHistory} /></div>
        </div>
      </div>
    </div>
  )
}
