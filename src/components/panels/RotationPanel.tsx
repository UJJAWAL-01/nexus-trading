'use client'

// ROTATION — which sectors (or your watchlist names) are leading or lagging
// the index, and whether that lead is growing or fading.
//
// Computed in the browser by src/lib/rotation.ts from one year of keyless
// daily closes. The definitions are simple on purpose and printed under the
// chart, so nothing here is a black box.

import { useMemo, useState, type CSSProperties } from 'react'
import useSWR from 'swr'
import { useActiveSymbol } from '@/store/symbol'
import { useWatchlist } from '@/store/watchlist'
import { loadCloses } from '@/lib/closes'
import { MOMENTUM_DAYS, TREND_DAYS, rankRotation, relativeRotation, type Quadrant, type Rotation } from '@/lib/rotation'
import type { Series } from '@/lib/risk'
import { PanelSkeleton, usePanelGuide } from '@/components/ui/Motion'

const MONO = 'JetBrains Mono, monospace'

interface Universe { label: string; benchmark: string; benchmarkLabel: string; members: Array<{ symbol: string; name: string }> }

const US: Universe = {
  label: 'US SECTORS', benchmark: 'SPY', benchmarkLabel: 'S&P 500',
  members: [
    { symbol: 'XLK', name: 'Technology' }, { symbol: 'XLC', name: 'Communication' }, { symbol: 'XLY', name: 'Consumer Discretionary' },
    { symbol: 'XLF', name: 'Financials' }, { symbol: 'XLV', name: 'Health Care' }, { symbol: 'XLI', name: 'Industrials' },
    { symbol: 'XLE', name: 'Energy' }, { symbol: 'XLP', name: 'Consumer Staples' }, { symbol: 'XLB', name: 'Materials' },
    { symbol: 'XLRE', name: 'Real Estate' }, { symbol: 'XLU', name: 'Utilities' },
  ],
}
const INDIA: Universe = {
  label: 'INDIA SECTORS', benchmark: '^NSEI', benchmarkLabel: 'Nifty 50',
  members: [
    { symbol: '^CNXIT', name: 'IT' }, { symbol: '^NSEBANK', name: 'Banks' }, { symbol: '^CNXAUTO', name: 'Auto' },
    { symbol: '^CNXPHARMA', name: 'Pharma' }, { symbol: '^CNXFMCG', name: 'FMCG' }, { symbol: '^CNXMETAL', name: 'Metals' },
    { symbol: '^CNXENERGY', name: 'Energy' }, { symbol: '^CNXREALTY', name: 'Realty' }, { symbol: '^CNXINFRA', name: 'Infrastructure' },
    { symbol: '^CNXPSUBANK', name: 'PSU Banks' },
  ],
}
type UniverseId = 'us' | 'india' | 'watchlist'

const QUAD: Record<Quadrant, { label: string; color: string; meaning: string }> = {
  leading:   { label: 'LEADING',   color: 'var(--positive)', meaning: 'beating the index and the lead is growing' },
  weakening: { label: 'WEAKENING', color: 'var(--amber)',    meaning: 'still ahead of the index but losing ground' },
  lagging:   { label: 'LAGGING',   color: 'var(--negative)', meaning: 'behind the index and falling further back' },
  improving: { label: 'IMPROVING', color: '#38bdf8',         meaning: 'behind the index but catching up' },
}

const th: CSSProperties = { padding: '5px 8px', fontSize: 10, letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: MONO, fontWeight: 700, textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--bg-panel)' }
const td: CSSProperties = { padding: '5px 8px', fontSize: 11, fontFamily: MONO, textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const signed = (n: number | null, dp = 1) => (n === null || !Number.isFinite(n) ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(dp)}`)
const tone = (n: number | null) => (n === null || n === 0 ? 'var(--text-2)' : n > 0 ? 'var(--positive)' : 'var(--negative)')
const short = (s: string) => s.replace(/^\^CNX|^\^NSE|^\^/, '').replace(/\.(NS|BO)$/, '')

// ── Scatter ──────────────────────────────────────────────────────────────────
const W = 600, H = 300, PAD = { l: 34, r: 12, t: 12, b: 24 }

function Scatter({ rows, onPick, focus, onFocus }: { rows: Rotation[]; onPick: (s: string) => void; focus: string | null; onFocus: (s: string | null) => void }) {
  const all = rows.flatMap(r => r.trail)
  const mx = Math.max(1, ...all.map(p => Math.abs(p.strength))) * 1.15
  const my = Math.max(1, ...all.map(p => Math.abs(p.momentum))) * 1.15
  const x = (v: number) => PAD.l + ((v + mx) / (2 * mx)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + ((my - v) / (2 * my)) * (H - PAD.t - PAD.b)
  const cx = x(0), cy = y(0)

  // Place labels top to bottom, nudging any that would sit on an earlier one.
  const labelY = new Map<string, number>()
  const placed: Array<{ x: number; y: number }> = []
  for (const r of [...rows].sort((a, b) => b.momentum - a.momentum)) {
    const px = x(r.strength)
    let py = y(r.momentum) + 3
    while (placed.some(p => Math.abs(p.x - px) < 46 && Math.abs(p.y - py) < 11)) py += 11
    placed.push({ x: px, y: py })
    labelY.set(r.symbol, Math.min(py, H - PAD.b - 3))
  }
  const corner: Array<[Quadrant, number, number, 'start' | 'end']> = [
    ['improving', PAD.l + 6, PAD.t + 12, 'start'], ['leading', W - PAD.r - 6, PAD.t + 12, 'end'],
    ['lagging', PAD.l + 6, H - PAD.b - 6, 'start'], ['weakening', W - PAD.r - 6, H - PAD.b - 6, 'end'],
  ]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
      aria-label={`Rotation chart. ${rows.map(r => `${short(r.symbol)} ${r.quadrant}`).join(', ')}.`}>
      <rect x={cx} y={PAD.t} width={W - PAD.r - cx} height={cy - PAD.t} fill="var(--positive)" opacity={0.05} />
      <rect x={PAD.l} y={cy} width={cx - PAD.l} height={H - PAD.b - cy} fill="var(--negative)" opacity={0.05} />
      <line x1={PAD.l} x2={W - PAD.r} y1={cy} y2={cy} stroke="var(--border-br)" />
      <line x1={cx} x2={cx} y1={PAD.t} y2={H - PAD.b} stroke="var(--border-br)" />
      <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="none" stroke="var(--border)" />
      {corner.map(([q, tx, ty, anchor]) => (
        <text key={q} x={tx} y={ty} textAnchor={anchor} fontSize={10} fontFamily={MONO} fontWeight={700} fill={QUAD[q].color} opacity={0.75}>{QUAD[q].label}</text>
      ))}
      <text x={(PAD.l + W - PAD.r) / 2} y={H - 6} textAnchor="middle" fontSize={9} fontFamily={MONO} fill="var(--text-muted)">RELATIVE STRENGTH → (% vs own {TREND_DAYS}-day norm)</text>
      <text x={10} y={(PAD.t + H - PAD.b) / 2} textAnchor="middle" fontSize={9} fontFamily={MONO} fill="var(--text-muted)" transform={`rotate(-90 10 ${(PAD.t + H - PAD.b) / 2})`}>MOMENTUM →</text>
      {rows.map(r => {
        const c = QUAD[r.quadrant].color
        const last = r.trail[r.trail.length - 1]
        const on = focus === r.symbol, dim = focus !== null && !on
        return (
          <g key={r.symbol} style={{ cursor: 'pointer' }} opacity={dim ? 0.3 : 1} onClick={() => onPick(r.symbol)} onMouseEnter={() => onFocus(r.symbol)} onMouseLeave={() => onFocus(null)}>
            <title>{`${r.symbol}: ${QUAD[r.quadrant].label.toLowerCase()} (strength ${signed(r.strength, 2)}, momentum ${signed(r.momentum, 2)})`}</title>
            <polyline points={r.trail.map(p => `${x(p.strength).toFixed(1)},${y(p.momentum).toFixed(1)}`).join(' ')} fill="none" stroke={c} strokeWidth={on ? 1.8 : 1} opacity={on ? 0.95 : 0.22} />
            {r.trail.slice(0, -1).map((p, i) => <circle key={i} cx={x(p.strength)} cy={y(p.momentum)} r={on ? 2.2 : 1.4} fill={c} opacity={on ? 0.95 : 0.3} />)}
            <circle cx={x(last.strength)} cy={y(last.momentum)} r={4.5} fill={c} stroke="var(--bg-panel)" strokeWidth={1.5} />
            <text x={x(last.strength) + 7} y={labelY.get(r.symbol) ?? y(last.momentum) + 3} fontSize={10} fontFamily={MONO} fontWeight={700} fill="var(--text)">{short(r.symbol)}</text>
          </g>
        )
      })}
    </svg>
  )
}

export default function RotationPanel() {
  const setActive = useActiveSymbol(s => s.setActiveSymbol)
  const watch = useWatchlist(s => s.symbols)
  const [id, setId] = useState<UniverseId>('us')
  const [focus, setFocus] = useState<string | null>(null)

  const universe = useMemo<Universe>(() => {
    if (id === 'us') return US
    if (id === 'india') return INDIA
    const indian = watch.filter(s => /\.(NS|BO)$/.test(s)).length > watch.length / 2
    const benchmark = indian ? '^NSEI' : 'SPY'
    return {
      label: 'MY WATCHLIST', benchmark, benchmarkLabel: indian ? 'Nifty 50' : 'S&P 500',
      members: watch.filter(s => s !== benchmark).slice(0, 20).map(symbol => ({ symbol, name: '' })),
    }
  }, [id, watch])

  const wanted = useMemo(() => [...new Set([...universe.members.map(m => m.symbol), universe.benchmark])].sort(), [universe])
  const { data, error, isLoading } = useSWR(
    wanted.length > 1 ? ['rotation-closes', wanted.join(',')] : null,
    () => loadCloses(wanted, '1y'),
    { refreshInterval: 0, dedupingInterval: 15 * 60_000, revalidateOnFocus: false },
  )

  const { rows, missing } = useMemo(() => {
    if (!data) return { rows: [] as Rotation[], missing: [] as string[] }
    const bench: Series = new Map(data[universe.benchmark] ?? [])
    const out: Rotation[] = [], none: string[] = []
    for (const m of universe.members) {
      const r = relativeRotation(m.symbol, new Map(data[m.symbol] ?? []), bench)
      if (r) out.push(r); else none.push(m.symbol)
    }
    return { rows: rankRotation(out), missing: none }
  }, [data, universe])

  const guide = usePanelGuide({
    title: 'Reading rotation',
    next: [{ label: 'HEATMAP', panelId: 'heatmap' }, { label: 'SCREENER', panelId: 'screener' }],
    children: <>Right of centre means a sector is beating the index. Above centre means that lead is growing. Sectors tend to travel clockwise: improving, leading, weakening, then lagging. This describes what has already happened; leadership can change without warning.</>,
  })

  const nameOf = (s: string) => universe.members.find(m => m.symbol === s)?.name ?? ''
  const list = (q: Quadrant) => rows.filter(r => r.quadrant === q).map(r => nameOf(r.symbol) || short(r.symbol))
  const leading = list('leading'), improving = list('improving'), lagging = list('lagging')

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" />
          ROTATION
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>VS {universe.benchmarkLabel.toUpperCase()} · RUNS IN YOUR BROWSER</span>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }} role="group" aria-label="Universe">
          {([['us', US.label], ['india', INDIA.label], ['watchlist', 'MY WATCHLIST']] as Array<[UniverseId, string]>).map(([u, label]) => (
            <button key={u} type="button" onClick={() => setId(u)} aria-pressed={id === u} style={{
              background: id === u ? 'color-mix(in srgb, var(--teal) 14%, transparent)' : 'transparent',
              border: `1px solid ${id === u ? 'var(--teal)' : 'var(--border)'}`, color: id === u ? 'var(--teal)' : 'var(--text-muted)',
              borderRadius: 3, padding: '3px 7px', fontSize: 10, fontFamily: MONO, fontWeight: 700, cursor: 'pointer',
            }}>{label}</button>
          ))}
          {guide.button}
        </div>
      </div>
      {guide.body}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {universe.members.length === 0 ? (
          <Note text="Your watchlist is empty. Add symbols in the Watchlist panel to see how they rotate against the index." />
        ) : isLoading && !data ? (
          <PanelSkeleton label="Loading one year of price history…" shapes={['chart', 'table']} />
        ) : error ? (
          <Note bad text="Could not load price history. Try again shortly." />
        ) : rows.length === 0 ? (
          <Note bad text="Not enough shared price history to measure relative strength." />
        ) : (
          <div key={id} className="nx-fade">
            <div style={{ padding: '8px 10px', fontFamily: MONO, fontSize: 12, borderBottom: '1px solid var(--border)', color: 'var(--text-2)', lineHeight: 1.5 }}>
              {leading.length
                ? <>Leading the {universe.benchmarkLabel}: <strong style={{ color: 'var(--positive)' }}>{leading.join(', ')}</strong>. </>
                : <>Nothing is clearly leading the {universe.benchmarkLabel} right now. </>}
              {improving.length > 0 && <>Catching up: <strong style={{ color: '#38bdf8' }}>{improving.join(', ')}</strong>. </>}
              {lagging.length > 0 && <>Falling behind: <strong style={{ color: 'var(--negative)' }}>{lagging.join(', ')}</strong>.</>}
            </div>

            <div style={{ padding: '8px 10px 0' }}><Scatter rows={rows} onPick={setActive} focus={focus} onFocus={setFocus} /></div>
            <div style={{ padding: '2px 10px 8px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, lineHeight: 1.5 }}>
              Strength: price ÷ index, compared with its own {TREND_DAYS}-day average. Momentum: change in strength over {MOMENTUM_DAYS} trading days. Tails show the last five weeks; hover a point or row to trace one. Click to open it.
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>NAME</th><th style={{ ...th, textAlign: 'left' }}>STATE</th>
                  <th style={th}>STRENGTH</th><th style={th}>MOMENTUM</th>
                  <th style={th} title="Return minus index return, percentage points">VS INDEX 1W</th><th style={th}>1M</th><th style={th}>3M</th><th style={th}>6M</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.symbol} onClick={() => setActive(r.symbol)} onMouseEnter={() => setFocus(r.symbol)} onMouseLeave={() => setFocus(null)} style={{ cursor: 'pointer', background: focus === r.symbol ? 'var(--bg-row)' : undefined }} title={`${r.symbol} is ${QUAD[r.quadrant].meaning}`}>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <span style={{ color: 'var(--amber)', fontWeight: 700 }}>{short(r.symbol)}</span>
                      {nameOf(r.symbol) && <span style={{ color: 'var(--text-muted)' }}> {nameOf(r.symbol)}</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'left', color: QUAD[r.quadrant].color, fontWeight: 700 }}>{QUAD[r.quadrant].label}</td>
                    <td style={{ ...td, color: tone(r.strength) }}>{signed(r.strength, 2)}</td>
                    <td style={{ ...td, color: tone(r.momentum) }}>{signed(r.momentum, 2)}</td>
                    {(['w1', 'm1', 'm3', 'm6'] as const).map(k => <td key={k} style={{ ...td, color: tone(r.relative[k]) }}>{signed(r.relative[k])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {missing.length > 0 && (
              <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>
                Not shown (too little price history): {missing.map(short).join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        Relative performance describes the past; leadership changes without warning. Not financial advice.
      </div>
    </div>
  )
}

function Note({ text, bad }: { text: string; bad?: boolean }) {
  return <div role="status" style={{ padding: '24px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: bad ? 'var(--negative)' : 'var(--text-muted)' }}>{text}</div>
}
