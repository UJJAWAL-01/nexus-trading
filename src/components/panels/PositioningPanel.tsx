'use client'

// POSITIONING — who is positioned how.
//   FUTURES       large speculators vs hedgers in 21 major futures markets,
//                 from the CFTC's weekly Commitments of Traders report.
//   SHORT VOLUME  the share of the active stock's daily off-exchange trading
//                 that was short sales, from FINRA's daily files.
// Both are free public data with no key. The statistics are computed by
// src/lib/positioning.ts (pure, tested).

import { useMemo, useState, type CSSProperties } from 'react'
import useSWR from 'swr'
import { useActiveSymbol, useEffectiveSymbol } from '@/store/symbol'
import { cotStance, type CotGroup, type CotSummary, type ShortStats } from '@/lib/positioning'
import { PanelSkeleton, usePanelGuide } from '@/components/ui/Motion'

const MONO = 'JetBrains Mono, monospace'
type Tab = 'futures' | 'short'

interface CotPayload { contracts: CotSummary[]; source: string; asOf: string | null }
type ShortPayload = ShortStats & { symbol: string; supported: boolean; source?: string; reason?: string }

// Continuous-contract chart symbol for each CFTC market, so a row can open its chart.
const CHART_SYMBOL: Record<string, string> = {
  '13874A': 'ES=F', '209742': 'NQ=F', '124603': 'YM=F', '239742': 'RTY=F', '1170E1': '^VIX',
  '042601': 'ZT=F', '043602': 'ZN=F', '020601': 'ZB=F',
  '088691': 'GC=F', '084691': 'SI=F', '085692': 'HG=F', '067651': 'CL=F', '023651': 'NG=F',
  '098662': 'DX-Y.NYB', '099741': '6E=F', '097741': '6J=F', '096742': '6B=F',
  '133741': 'BTC-USD', '002602': 'ZC=F', '005602': 'ZS=F', '001602': 'ZW=F',
}

const STANCE: Record<ReturnType<typeof cotStance>, { label: string; color: string }> = {
  'crowded long':  { label: 'MOST LONG',     color: 'var(--positive)' },
  'long side':     { label: 'UPPER RANGE',   color: 'color-mix(in srgb, var(--positive) 70%, var(--text-muted))' },
  'middle':        { label: 'MID RANGE',     color: 'var(--text-muted)' },
  'short side':    { label: 'LOWER RANGE',   color: 'color-mix(in srgb, var(--negative) 70%, var(--text-muted))' },
  'crowded short': { label: 'MOST SHORT',    color: 'var(--negative)' },
  'unknown':       { label: '—',             color: 'var(--text-muted)' },
}

const th: CSSProperties = { padding: '5px 8px', fontSize: 10, letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: MONO, fontWeight: 700, textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--bg-panel)', zIndex: 1 }
const td: CSSProperties = { padding: '5px 8px', fontSize: 11, fontFamily: MONO, textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const tile: CSSProperties = { border: '1px solid var(--border)', borderRadius: 4, padding: '7px 9px', background: 'var(--bg-deep)', minWidth: 0 }

const compact = (n: number) => {
  const a = Math.abs(n), sign = n < 0 ? '−' : n > 0 ? '+' : ''
  return a >= 1e6 ? `${sign}${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${sign}${(a / 1e3).toFixed(1)}K` : `${sign}${a}`
}
const vol = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n))
const tone = (n: number | null) => (n === null || n === 0 ? 'var(--text-2)' : n > 0 ? 'var(--positive)' : 'var(--negative)')
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** Where today sits between the most short (left) and most long (right) of the window. */
function RangeBar({ position }: { position: number | null }) {
  if (position === null) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  return (
    <div title={`${position.toFixed(0)} of 100 in its own range`} style={{ position: 'relative', width: 90, height: 6, borderRadius: 3, marginLeft: 'auto', background: 'linear-gradient(90deg, color-mix(in srgb, var(--negative) 45%, transparent), var(--border-br) 50%, color-mix(in srgb, var(--positive) 45%, transparent))' }}>
      <div style={{ position: 'absolute', left: `${position}%`, top: -3, width: 2, height: 12, background: 'var(--text)', transform: 'translateX(-50%)', borderRadius: 1 }} />
    </div>
  )
}

function Spark({ data }: { data: Array<{ specNetPct: number }> }) {
  const W = 84, H = 20
  if (data.length < 2) return null
  const ys = data.map(d => d.specNetPct), lo = Math.min(...ys, 0), hi = Math.max(...ys, 0), span = hi - lo || 1
  const x = (i: number) => (i / (data.length - 1)) * W, y = (v: number) => H - ((v - lo) / span) * H
  const last = ys[ys.length - 1]
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ display: 'block', marginLeft: 'auto', overflow: 'visible' }}>
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-br)" strokeDasharray="2 2" />
      <polyline fill="none" strokeWidth={1.3} stroke={last >= 0 ? 'var(--positive)' : 'var(--negative)'} points={ys.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} />
    </svg>
  )
}

function Futures() {
  const setActive = useActiveSymbol(s => s.setActiveSymbol)
  const { data, error, isLoading } = useSWR<CotPayload>('/api/cot', { refreshInterval: 6 * 3600_000, dedupingInterval: 3600_000 })
  const rows = useMemo(() => data?.contracts ?? [], [data])
  const groups = useMemo(() => {
    const g = new Map<CotGroup, CotSummary[]>()
    for (const r of rows) { if (!g.has(r.group)) g.set(r.group, []); g.get(r.group)!.push(r) }
    return [...g.entries()]
  }, [rows])

  if (isLoading && !data) return <PanelSkeleton label="Loading the latest Commitments of Traders report…" shapes={['table', 'table']} />
  if (error || !rows.length) return <Note bad text="Futures positioning is unavailable right now. Try again shortly." />

  const longs  = rows.filter(r => cotStance(r.rangePosition) === 'crowded long').map(r => r.name)
  const shorts = rows.filter(r => cotStance(r.rangePosition) === 'crowded short').map(r => r.name)
  const years = Math.round(Math.max(...rows.map(r => r.weeks)) / 52)

  return (
    <div className="nx-fade">
      <div style={{ padding: '8px 10px', fontFamily: MONO, fontSize: 12, borderBottom: '1px solid var(--border)', color: 'var(--text-2)', lineHeight: 1.5 }}>
        {longs.length > 0 && <>Speculators are most long in {years} years in <strong style={{ color: 'var(--positive)' }}>{longs.join(', ')}</strong>. </>}
        {shorts.length > 0 && <>Most short in <strong style={{ color: 'var(--negative)' }}>{shorts.join(', ')}</strong>. </>}
        {!longs.length && !shorts.length && <>No market is at an extreme of its {years}-year range. </>}
        <span style={{ color: 'var(--text-muted)' }}>Positions as of {data?.asOf ? shortDate(data.asOf) : 'the latest report'}.</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>MARKET</th>
            <th style={{ ...th, textAlign: 'left' }} title="Where speculators stand today compared with their own range over the history shown. A market can be net short and still be in its upper range.">VS OWN RANGE</th>
            <th style={th} title="Most short on the left, most long on the right, over the history shown">{years}Y RANGE</th>
            <th style={th} title="Large speculators: long contracts minus short contracts">NET</th>
            <th style={th} title="Change from the previous weekly report">WEEK</th>
            <th style={th} title="Speculator net position as a share of all open contracts">% OF OI</th>
            <th style={th}>TREND</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(([group, list]) => [
            <tr key={group}><td colSpan={7} style={{ ...td, textAlign: 'left', fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-muted)', background: 'var(--bg-deep)', padding: '4px 8px' }}>{group.toUpperCase()}</td></tr>,
            ...list.map(r => {
              const s = STANCE[cotStance(r.rangePosition)]
              return (
                <tr key={r.code} onClick={() => CHART_SYMBOL[r.code] && setActive(CHART_SYMBOL[r.code])} style={{ cursor: 'pointer' }} title={`Open the ${r.name} chart. Hedgers are net ${compact(r.commNet)} contracts.`}>
                  <td style={{ ...td, textAlign: 'left', color: 'var(--text)', fontWeight: 700 }}>{r.name}</td>
                  <td style={{ ...td, textAlign: 'left', color: s.color, fontWeight: 700, fontSize: 10 }}>{s.label}</td>
                  <td style={td}><RangeBar position={r.rangePosition} /></td>
                  <td style={{ ...td, color: tone(r.specNet) }}>{compact(r.specNet)}</td>
                  <td style={{ ...td, color: tone(r.specNetChange) }}>{r.specNetChange === null ? '—' : compact(r.specNetChange)}</td>
                  <td style={{ ...td, color: tone(r.specNetPct) }}>{r.specNetPct > 0 ? '+' : ''}{r.specNetPct.toFixed(1)}%</td>
                  <td style={td}><Spark data={r.history} /></td>
                </tr>
              )
            }),
          ])}
        </tbody>
      </table>
    </div>
  )
}

function ShortVolume({ symbol }: { symbol: string }) {
  const { data, error, isLoading } = useSWR<ShortPayload>(`/api/short-volume?symbol=${encodeURIComponent(symbol)}`, { refreshInterval: 30 * 60_000, dedupingInterval: 10 * 60_000 })

  if (isLoading && !data) return <PanelSkeleton label={`Loading ${symbol} short-sale volume…`} shapes={['tiles', 'chart']} />
  if (error) return <Note bad text="Short-sale volume is unavailable right now. Try again shortly." />
  if (data && !data.supported) return <Note text={`${symbol}: ${data.reason ?? 'not covered'}. Pick a US-listed share to see its short-sale volume.`} />
  if (!data?.latest || !data.days.length) return <Note text={`No short-sale volume was reported for ${symbol} in the last month.`} />

  const { latest, avgPct, vsAvg, zScore, days } = data
  const unusual = zScore !== null && Math.abs(zScore) >= 2
  const W = 600, H = 150, PAD = { l: 30, r: 8, t: 8, b: 20 }
  const top = Math.max(70, ...days.map(d => d.pct)) , bw = (W - PAD.l - PAD.r) / days.length
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b)

  return (
    <div key={symbol} className="nx-fade">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8, padding: '8px 10px' }}>
        <div style={tile}><Label>LATEST ({shortDate(latest.date).toUpperCase()})</Label><Value>{latest.pct.toFixed(1)}%</Value><Sub>{vol(latest.shortVolume)} of {vol(latest.totalVolume)} shares</Sub></div>
        <div style={tile}><Label>{days.length}-DAY AVERAGE</Label><Value>{avgPct === null ? '—' : `${avgPct.toFixed(1)}%`}</Value><Sub>Weighted by volume</Sub></div>
        <div style={tile}><Label>VERSUS AVERAGE</Label><Value color={vsAvg === null ? undefined : unusual ? 'var(--amber)' : 'var(--text)'}>{vsAvg === null ? '—' : `${vsAvg > 0 ? '+' : ''}${vsAvg.toFixed(1)} pts`}</Value>
          <Sub>{zScore === null ? 'Too few days to judge' : unusual ? `Unusual: ${Math.abs(zScore).toFixed(1)} standard deviations ${zScore > 0 ? 'above' : 'below'}` : 'Within its normal range'}</Sub></div>
      </div>

      <div style={{ padding: '0 10px' }}>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`Daily short-sale volume share for ${symbol}, last ${days.length} trading days. Latest ${latest.pct.toFixed(1)} percent.`}>
          {[0, 25, 50].map(v => (
            <g key={v}><line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fontFamily={MONO} fill="var(--text-muted)">{v}%</text></g>
          ))}
          {days.map((d, i) => (
            <rect key={d.date} className="nx-grow" style={{ animationDelay: `${i * 18}ms`, transformBox: 'fill-box' }} x={PAD.l + i * bw + bw * 0.15} width={bw * 0.7} y={y(d.pct)} height={Math.max(1, y(0) - y(d.pct))} rx={1.5}
              fill={i === days.length - 1 ? 'var(--teal)' : 'color-mix(in srgb, var(--teal) 45%, transparent)'}>
              <title>{`${shortDate(d.date)}: ${d.pct.toFixed(1)}% short (${vol(d.shortVolume)} of ${vol(d.totalVolume)})`}</title>
            </rect>
          ))}
          {avgPct !== null && <>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(avgPct)} y2={y(avgPct)} stroke="var(--amber)" strokeDasharray="4 3" />
            <text x={W - PAD.r} y={y(avgPct) - 4} textAnchor="end" fontSize={9} fontFamily={MONO} fill="var(--amber)">AVERAGE {avgPct.toFixed(1)}%</text>
          </>}
          <text x={PAD.l} y={H - 5} fontSize={9} fontFamily={MONO} fill="var(--text-muted)">{shortDate(days[0].date)}</text>
          <text x={W - PAD.r} y={H - 5} textAnchor="end" fontSize={9} fontFamily={MONO} fill="var(--text-muted)">{shortDate(latest.date)}</text>
        </svg>
      </div>
      <div style={{ padding: '4px 10px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, lineHeight: 1.5 }}>
        Share of each day&apos;s off-exchange volume that was sold short. This is not short interest: market makers sell short routinely, so 40–50% is ordinary. Watch for a clear departure from the stock&apos;s own average.
      </div>
    </div>
  )
}

export default function PositioningPanel() {
  const { symbol: effective } = useEffectiveSymbol('positioning')
  const symbol = effective ?? 'SPY'
  const [tab, setTab] = useState<Tab>('futures')

  const guide = usePanelGuide({
    title: 'Reading positioning',
    next: [{ label: 'COMMODITIES', panelId: 'commodities' }, { label: 'SENTIMENT', panelId: 'sentiment' }],
    children: <>Futures shows whether large speculators, mostly funds, are betting on a rise or a fall in each market, and how extreme that bet is compared with the last three years. A crowded position is not a signal to trade against it, but it does mean there are few people left to join in and many who could rush for the exit. The report counts positions each Tuesday and is published on Friday, so it is always a few days old.</>,
  })

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" />
          POSITIONING
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>{tab === 'futures' ? 'CFTC · WEEKLY' : `FINRA · DAILY · ${symbol}`}</span>
          {guide.button}
        </div>
        <div style={{ display: 'flex', gap: 4 }} role="tablist" aria-label="Positioning view">
          {([['futures', 'FUTURES'], ['short', 'SHORT VOLUME']] as Array<[Tab, string]>).map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{
              background: tab === t ? 'color-mix(in srgb, var(--teal) 14%, transparent)' : 'transparent',
              border: `1px solid ${tab === t ? 'var(--teal)' : 'var(--border)'}`, color: tab === t ? 'var(--teal)' : 'var(--text-muted)',
              borderRadius: 3, padding: '3px 7px', fontSize: 10, fontFamily: MONO, fontWeight: 700, cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>
      </div>
      {guide.body}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {tab === 'futures' ? <Futures /> : <ShortVolume symbol={symbol} />}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        {tab === 'futures' ? 'Source: CFTC Commitments of Traders, futures only. Speculators = non-commercial traders.' : 'Source: FINRA Reg SHO daily short sale volume.'} Public data, shown as published. Not financial advice.
      </div>
    </div>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em' }}>{children}</div>
const Value = ({ children, color }: { children: React.ReactNode; color?: string }) => <div style={{ fontSize: 16, fontWeight: 700, fontFamily: MONO, color: color ?? 'var(--text)', marginTop: 2 }}>{children}</div>
const Sub = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, marginTop: 2 }}>{children}</div>

function Note({ text, bad }: { text: string; bad?: boolean }) {
  return <div role="status" style={{ padding: '24px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: bad ? 'var(--negative)' : 'var(--text-muted)' }}>{text}</div>
}
