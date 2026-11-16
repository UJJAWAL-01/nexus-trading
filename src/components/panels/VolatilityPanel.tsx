'use client'

// VOLATILITY — what the options market is pricing for the active symbol.
//   Term structure: at-the-money implied volatility for each expiry.
//   Skew: implied volatility across strikes for one expiry (the "smile").
// Computed on the server by src/lib/vol-surface.ts from CBOE's free delayed
// options file: one download per symbol, no key, no cost.

import { useMemo, useState, type CSSProperties } from 'react'
import useSWR from 'swr'
import { useEffectiveSymbol } from '@/store/symbol'
import type { ExpiryVol, VolSurface } from '@/lib/vol-surface'
import { PanelSkeleton, usePanelGuide } from '@/components/ui/Motion'

const MONO = 'var(--font-data)'
interface Payload { symbol: string; supported: boolean; surface?: VolSurface | null; source?: string; reason?: string }

const tile: CSSProperties = { border: '1px solid var(--border)', borderRadius: 4, padding: '7px 9px', background: 'var(--bg-deep)', minWidth: 0 }
const th: CSSProperties = { padding: '5px 8px', fontSize: 10, letterSpacing: '0.06em', color: 'var(--text-muted)', fontFamily: MONO, fontWeight: 700, textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', position: 'sticky', top: 0, background: 'var(--bg-panel)' }
const td: CSSProperties = { padding: '5px 8px', fontSize: 11, fontFamily: MONO, textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }

const pct = (v: number | null | undefined, dp = 1) => (v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(dp)}%`)
const pts = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}`)
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })
const px = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : 2 })

const W = 600, H = 170, PAD = { l: 38, r: 10, t: 10, b: 22 }
const niceRange = (values: number[]) => {
  const lo = Math.min(...values), hi = Math.max(...values), pad = Math.max(0.01, (hi - lo) * 0.15)
  return [Math.max(0, lo - pad), hi + pad] as const
}

function TermChart({ rows, selected, onSelect }: { rows: ExpiryVol[]; selected: string; onSelect: (e: string) => void }) {
  const [lo, hi] = niceRange(rows.map(r => r.atmIv))
  const maxT = Math.sqrt(rows[rows.length - 1].dte)
  // Square-root time axis: near expiries are not crushed against the left edge.
  const x = (dte: number) => PAD.l + (rows.length === 1 ? 0.5 : Math.sqrt(dte) / maxT) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b)
  const labelled = new Set([0, Math.floor(rows.length / 2), rows.length - 1])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
      aria-label={`Implied volatility by expiry, from ${pct(rows[0].atmIv)} at ${rows[0].dte} days to ${pct(rows[rows.length - 1].atmIv)} at ${rows[rows.length - 1].dte} days.`}>
      {[lo, (lo + hi) / 2, hi].map((v, i) => (
        <g key={i}><line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fontFamily={MONO} fill="var(--text-muted)">{(v * 100).toFixed(0)}%</text></g>
      ))}
      <polyline key={rows[0].expiry + rows.length} className="nx-draw" pathLength={1} fill="none" stroke="var(--teal)" strokeWidth={1.8} points={rows.map(r => `${x(r.dte).toFixed(1)},${y(r.atmIv).toFixed(1)}`).join(' ')} />
      {rows.map((r, i) => {
        const on = r.expiry === selected
        return (
          <g key={r.expiry} style={{ cursor: 'pointer' }} onClick={() => onSelect(r.expiry)}>
            <title>{`${day(r.expiry)} (${r.dte} days): ${pct(r.atmIv)} implied. Priced move ±${pct(r.expectedMove)}.`}</title>
            <circle cx={x(r.dte)} cy={y(r.atmIv)} r={10} fill="transparent" />
            <circle cx={x(r.dte)} cy={y(r.atmIv)} r={on ? 5 : 3} fill={on ? 'var(--amber)' : 'var(--teal)'} stroke="var(--bg-panel)" strokeWidth={1.5} />
            {labelled.has(i) && <text x={x(r.dte)} y={H - 6} textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'} fontSize={9} fontFamily={MONO} fill="var(--text-muted)">{r.dte}d</text>}
          </g>
        )
      })}
    </svg>
  )
}

function SmileChart({ row, spot }: { row: ExpiryVol; spot: number }) {
  if (row.smile.length < 3) return <div style={{ padding: 14, fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)' }}>Too few quoted strikes to draw a smile for this expiry.</div>
  const [lo, hi] = niceRange(row.smile.map(p => p.iv))
  const mLo = row.smile[0].moneyness, mHi = row.smile[row.smile.length - 1].moneyness
  const x = (m: number) => PAD.l + ((m - mLo) / (mHi - mLo || 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
      aria-label={`Implied volatility by strike for ${day(row.expiry)}. ${pct(row.smile[0].iv)} at ${row.smile[0].moneyness.toFixed(0)} percent, ${pct(row.atmIv)} at the money, ${pct(row.smile[row.smile.length - 1].iv)} at plus ${mHi.toFixed(0)} percent.`}>
      {[lo, (lo + hi) / 2, hi].map((v, i) => (
        <g key={i}><line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fontFamily={MONO} fill="var(--text-muted)">{(v * 100).toFixed(0)}%</text></g>
      ))}
      {mLo < 0 && mHi > 0 && <>
        <line x1={x(0)} x2={x(0)} y1={PAD.t} y2={H - PAD.b} stroke="var(--teal)" strokeDasharray="2 3" />
        <text x={x(0) + 4} y={PAD.t + 9} fontSize={9} fontFamily={MONO} fill="var(--teal)">SPOT {px(spot)}</text>
      </>}
      <polyline key={row.expiry} className="nx-draw" pathLength={1} fill="none" stroke="var(--amber)" strokeWidth={1.8} points={row.smile.map(p => `${x(p.moneyness).toFixed(1)},${y(p.iv).toFixed(1)}`).join(' ')} />
      {row.smile.map(p => (
        <circle key={p.strike} cx={x(p.moneyness)} cy={y(p.iv)} r={2} fill="var(--amber)"><title>{`Strike ${px(p.strike)} (${p.moneyness > 0 ? '+' : ''}${p.moneyness.toFixed(1)}%): ${pct(p.iv)}`}</title></circle>
      ))}
      <text x={PAD.l} y={H - 6} fontSize={9} fontFamily={MONO} fill="var(--text-muted)">{mLo.toFixed(0)}% · PUTS</text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize={9} fontFamily={MONO} fill="var(--text-muted)">CALLS · +{mHi.toFixed(0)}%</text>
    </svg>
  )
}

export default function VolatilityPanel() {
  const { symbol: effective } = useEffectiveSymbol('volatility')
  const symbol = effective ?? 'SPY'
  const [picked, setPicked] = useState<{ symbol: string; expiry: string } | null>(null)

  const { data, error, isLoading } = useSWR<Payload>(`/api/vol-surface?symbol=${encodeURIComponent(symbol)}`, { refreshInterval: 5 * 60_000, dedupingInterval: 2 * 60_000 })
  const surface = data?.surface ?? null
  const rows = useMemo(() => surface?.expiries ?? [], [surface])

  // Default to the first expiry at least three weeks out: near-dated skew is dominated by single events.
  const selected = useMemo(() => {
    if (picked?.symbol === symbol && rows.some(r => r.expiry === picked.expiry)) return picked.expiry
    return (rows.find(r => r.dte >= 21) ?? rows[0])?.expiry ?? ''
  }, [picked, symbol, rows])
  const row = rows.find(r => r.expiry === selected)

  const guide = usePanelGuide({
    title: 'Reading implied volatility',
    next: [{ label: 'OPTIONS STRATEGY', panelId: 'strategy' }, { label: 'EARNINGS', panelId: 'earnings' }],
    children: <>Implied volatility is the size of move that option prices are charging for, stated as a yearly percentage. The top chart shows it for each expiry: a line that rises to the right is the calm, normal state, while a line that is highest at the front means the market is braced for something soon, often earnings. The bottom chart shows one expiry across strikes. For shares it usually slopes down to the right, because protection against a fall costs more than a bet on a rise.</>,
  })

  const SHAPE: Record<NonNullable<VolSurface['shape']>, string> = {
    rising: 'Longer-dated options are priced for more movement than near ones, the usual calm-market shape.',
    flat: 'Near and far expiries are priced for about the same movement.',
    inverted: 'Near-dated options are priced for more movement than later ones: the market is braced for something soon.',
  }

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="dot" />
        VOLATILITY
        <span style={{ fontSize: 11, color: 'var(--amber)', fontFamily: MONO, fontWeight: 700 }}>{symbol}</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>IMPLIED · 15-MIN DELAYED</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>{guide.button}</span>
      </div>
      {guide.body}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {isLoading && !data ? (
          <PanelSkeleton label={`Loading ${symbol} options…`} shapes={['tiles', 'chart', 'chart']} />
        ) : error ? (
          <Note bad text="Options data is unavailable right now. Try again shortly." />
        ) : data && !data.supported ? (
          <Note text={`${symbol}: ${data.reason ?? 'not covered'}.`} />
        ) : !surface || !row ? (
          <Note text={`${symbol} has no listed options with usable quotes right now.`} />
        ) : (
          <div key={symbol} className="nx-fade">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 8, padding: '8px 10px' }}>
              <div style={tile}><Label>30-DAY IMPLIED</Label><Value>{pct(surface.iv30 ?? rows.find(r => r.dte >= 25)?.atmIv ?? rows[0].atmIv)}</Value><Sub>Yearly rate the market is pricing</Sub></div>
              <div style={tile}><Label>PRICED MOVE BY {day(row.expiry).toUpperCase()}</Label><Value>±{pct(row.expectedMove)}</Value><Sub>±{px(surface.spot * row.expectedMove)} · about 2 in 3 odds of staying inside</Sub></div>
              <div style={tile}><Label>SKEW (25-DELTA)</Label><Value color={row.riskReversal === null ? undefined : row.riskReversal < -0.03 ? 'var(--negative)' : row.riskReversal > 0.01 ? 'var(--positive)' : 'var(--text)'}>{pts(row.riskReversal)} pts</Value>
                <Sub>{row.riskReversal === null ? 'Not enough quoted strikes' : row.riskReversal < -0.005 ? 'Downside protection costs more' : row.riskReversal > 0.005 ? 'Upside calls cost more: unusual' : 'Puts and calls priced alike'}</Sub></div>
            </div>

            <Section title="TERM STRUCTURE · AT-THE-MONEY IMPLIED VOLATILITY BY EXPIRY">
              {rows.length >= 2 ? <TermChart rows={rows} selected={selected} onSelect={e => setPicked({ symbol, expiry: e })} /> : <div style={{ padding: 10, fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)' }}>Only one expiry has usable quotes.</div>}
              {surface.shape && <Caption>{SHAPE[surface.shape]} Click a point to see that expiry&apos;s skew.</Caption>}
            </Section>

            <Section title={`SKEW · ${day(row.expiry).toUpperCase()} · ${row.dte} DAYS · BY STRIKE`}>
              <SmileChart row={row} spot={surface.spot} />
              <Caption>Out-of-the-money options only: puts left of spot, calls right. 25-delta put {pct(row.put25)}, at the money {pct(row.atmIv)}, 25-delta call {pct(row.call25)}.</Caption>
            </Section>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={{ ...th, textAlign: 'left' }}>EXPIRY</th><th style={th}>DAYS</th><th style={th}>ATM IV</th>
                <th style={th} title="One-standard-deviation move priced by this date">PRICED MOVE</th><th style={th}>25Δ PUT</th><th style={th}>25Δ CALL</th>
                <th style={th} title="25-delta call IV minus 25-delta put IV, in volatility points">SKEW</th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.expiry} onClick={() => setPicked({ symbol, expiry: r.expiry })} aria-selected={r.expiry === selected} style={{ cursor: 'pointer', background: r.expiry === selected ? 'var(--bg-row)' : undefined }}>
                    <td style={{ ...td, textAlign: 'left', color: r.expiry === selected ? 'var(--amber)' : 'var(--text)', fontWeight: 700 }}>{day(r.expiry)}</td>
                    <td style={{ ...td, color: 'var(--text-2)' }}>{r.dte}</td>
                    <td style={{ ...td, color: 'var(--text)' }}>{pct(r.atmIv)}</td>
                    <td style={{ ...td, color: 'var(--text-2)' }}>±{pct(r.expectedMove)}</td>
                    <td style={{ ...td, color: 'var(--text-2)' }}>{pct(r.put25)}</td>
                    <td style={{ ...td, color: 'var(--text-2)' }}>{pct(r.call25)}</td>
                    <td style={{ ...td, color: r.riskReversal === null ? 'var(--text-muted)' : r.riskReversal < 0 ? 'var(--negative)' : 'var(--positive)' }}>{pts(r.riskReversal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        Source: CBOE delayed quotes{surface?.asOf ? `, quote time ${surface.asOf}` : ''}. A priced move is what options cost, not a forecast. Not financial advice.
      </div>
    </div>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em' }}>{children}</div>
const Value = ({ children, color }: { children: React.ReactNode; color?: string }) => <div style={{ fontSize: 16, fontWeight: 700, fontFamily: MONO, color: color ?? 'var(--text)', marginTop: 2 }}>{children}</div>
const Sub = ({ children }: { children: React.ReactNode }) => <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, marginTop: 2 }}>{children}</div>
const Caption = ({ children }: { children: React.ReactNode }) => <div style={{ padding: '2px 0 0', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, lineHeight: 1.5 }}>{children}</div>
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '4px 10px 10px' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em', marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}
function Note({ text, bad }: { text: string; bad?: boolean }) {
  return <div role="status" style={{ padding: '24px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: bad ? 'var(--negative)' : 'var(--text-muted)' }}>{text}</div>
}
