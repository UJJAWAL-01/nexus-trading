'use client'

// OPTIONS STRATEGY — build a multi-leg options position on the active symbol
// and see its payoff, break-evens, maximum profit and loss, and a model
// probability of profit.
//
// Computed in the browser by src/lib/payoff.ts. It needs only the spot price
// and recent price history (both keyless), so it works for any symbol, with no
// options-data subscription. Premiums start as Black-Scholes MODEL prices at
// the volatility shown; type in the real quotes from your broker for an exact
// picture.

import { useMemo, useState, type CSSProperties } from 'react'
import useSWR from 'swr'
import { useEffectiveSymbol } from '@/store/symbol'
import { annualVol } from '@/lib/risk'
import { PanelSkeleton, usePanelGuide } from '@/components/ui/Motion'
import {
  TEMPLATES, analysePayoff, buildTemplate, payoffAtExpiry, payoffBeforeExpiry, probabilityOfProfit, strikeStep,
  type Leg, type LegSide, type LegType, type TemplateId,
} from '@/lib/payoff'

const MONO = 'var(--font-data)'
const MAX_LEGS = 8
const VOL_WINDOW = 30

const ctl: CSSProperties = {
  background: 'var(--bg-deep)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 3, padding: '5px 7px', fontSize: 13, fontFamily: MONO, minWidth: 0,
}
const lbl: CSSProperties = { fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em', display: 'flex', flexDirection: 'column', gap: 3 }
const btn: CSSProperties = { ...ctl, cursor: 'pointer', fontWeight: 700, color: 'var(--text-2)' }
const tile: CSSProperties = { border: '1px solid var(--border)', borderRadius: 4, padding: '7px 9px', background: 'var(--bg-deep)', minWidth: 0 }
const cell: CSSProperties = { padding: '3px 4px' }

interface QuotePayload { price?: number | null; currency?: string }
interface ChartPayload {
  results?: Array<{ data?: { chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> | null } } }>
}

const money = (n: number, sign: string) => `${n < 0 ? '−' : ''}${sign}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 })}`
const px = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: n >= 1000 ? 0 : 2 })

function Num({ label, value, onChange, min, max, step, width = 64, title }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; step?: number; width?: number; title?: string }) {
  return (
    <label style={lbl} title={title}>
      {label}
      <input type="number" inputMode="decimal" style={{ ...ctl, width }} value={value} min={min} max={max} step={step ?? 'any'}
        onChange={e => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))) }} />
    </label>
  )
}

// ── Payoff chart ─────────────────────────────────────────────────────────────
const W = 640, H = 250, PAD = { l: 52, r: 12, t: 12, b: 24 }
const POINTS = 161

function PayoffChart({ legs, spot, T, r, sigma, lot, breakevens, sign, drawKey }: { drawKey: string; legs: Leg[]; spot: number; T: number; r: number; sigma: number; lot: number; breakevens: number[]; sign: string }) {
  const strikes = legs.map(l => l.strike)
  const reach = Math.max(0.12, 2.5 * sigma * Math.sqrt(T))
  const lo = Math.max(0, Math.min(spot * (1 - reach), ...strikes.map(s => s * 0.92), ...breakevens.map(b => b * 0.96)))
  const hi = Math.max(spot * (1 + reach), ...strikes.map(s => s * 1.08), ...breakevens.map(b => b * 1.04))

  // Sample evenly, plus every strike so the kinks are exact.
  const xs = [...new Set([...Array.from({ length: POINTS }, (_, i) => lo + ((hi - lo) * i) / (POINTS - 1)), ...strikes.filter(s => s > lo && s < hi)])].sort((a, b) => a - b)
  const expiry = xs.map(S => payoffAtExpiry(legs, S) * lot)
  const today  = xs.map(S => payoffBeforeExpiry(legs, S, T, r, sigma) * lot)
  const top = Math.max(1e-9, ...expiry, ...today), bottom = Math.min(-1e-9, ...expiry, ...today)
  const span = top - bottom
  const yMax = top + span * 0.08, yMin = bottom - span * 0.08

  const x = (S: number) => PAD.l + ((S - lo) / (hi - lo)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + ((yMax - v) / (yMax - yMin)) * (H - PAD.t - PAD.b)
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(xs[i]).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line(expiry)} L${x(hi).toFixed(1)},${y(0).toFixed(1)} L${x(lo).toFixed(1)},${y(0).toFixed(1)} Z`
  const zero = y(0)
  const ticksX = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
      aria-label={`Payoff diagram from ${px(lo)} to ${px(hi)}. Break-even${breakevens.length === 1 ? '' : 's'} at ${breakevens.map(px).join(' and ') || 'none'}.`}>
      <defs>
        <clipPath id="strat-profit"><rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={Math.max(0, zero - PAD.t)} /></clipPath>
        <clipPath id="strat-loss"><rect x={PAD.l} y={zero} width={W - PAD.l - PAD.r} height={Math.max(0, H - PAD.b - zero)} /></clipPath>
      </defs>
      <path d={area} fill="var(--positive)" opacity={0.16} clipPath="url(#strat-profit)" />
      <path d={area} fill="var(--negative)" opacity={0.16} clipPath="url(#strat-loss)" />
      <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="none" stroke="var(--border)" />
      <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} stroke="var(--border-br)" />
      {[yMax - span * 0.08, 0, yMin + span * 0.08].map((v, i) => (
        <text key={i} x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fontFamily={MONO} fill="var(--text-muted)">{money(v, sign)}</text>
      ))}
      {ticksX.map((S, i) => (
        <text key={i} x={x(S)} y={H - 8} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} fontSize={9} fontFamily={MONO} fill="var(--text-muted)">{px(S)}</text>
      ))}
      {T > 1 / 365 && <path d={line(today)} fill="none" stroke="var(--amber)" strokeWidth={1.3} strokeDasharray="4 3" />}
      <path key={drawKey} className="nx-draw" pathLength={1} d={line(expiry)} fill="none" stroke="var(--text)" strokeWidth={1.8} />
      <line x1={x(spot)} x2={x(spot)} y1={PAD.t} y2={H - PAD.b} stroke="var(--teal)" strokeDasharray="2 3" />
      <text x={x(spot) + 4} y={PAD.t + 10} fontSize={9} fontFamily={MONO} fill="var(--teal)">SPOT {px(spot)}</text>
      {breakevens.filter(b => b > lo && b < hi).map(b => (
        <g key={b}>
          <circle cx={x(b)} cy={zero} r={3.5} fill="var(--bg-panel)" stroke="var(--text)" strokeWidth={1.5} />
          <text x={x(b)} y={zero - 7} textAnchor="middle" fontSize={9} fontFamily={MONO} fill="var(--text)">{px(b)}</text>
        </g>
      ))}
    </svg>
  )
}

export default function StrategyPanel() {
  const { symbol: effective } = useEffectiveSymbol('strategy')
  const symbol = effective ?? 'SPY'
  const indian = /\.(NS|BO)$/.test(symbol) || symbol.startsWith('^NSE') || symbol.startsWith('^CNX')
  const sign = indian ? '₹' : '$'

  const { data: quote, error: quoteError } = useSWR<QuotePayload>(`/api/yquote?symbol=${encodeURIComponent(symbol)}`, { refreshInterval: 60_000, dedupingInterval: 30_000 })
  const { data: hist } = useSWR<ChartPayload>(`/api/yfinance?symbols=${encodeURIComponent(symbol)}&range=6mo&interval=1d`, { refreshInterval: 0, dedupingInterval: 30 * 60_000 })

  const spot = typeof quote?.price === 'number' && quote.price > 0 ? quote.price : null

  // Default volatility: what the stock actually did over the last 30 sessions.
  const realised = useMemo(() => {
    const closes = (hist?.results?.[0]?.data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter((c): c is number => typeof c === 'number' && c > 0)
    if (closes.length < VOL_WINDOW + 1) return null
    const tail = closes.slice(-(VOL_WINDOW + 1))
    return annualVol(tail.slice(1).map((c, i) => c / tail[i] - 1))
  }, [hist])

  const [template, setTemplate] = useState<TemplateId>('bull-call')
  const [days, setDays]         = useState(30)
  const [volInput, setVolInput] = useState<number | null>(null)       // % ; null = use realised
  const [ratePct, setRatePct]   = useState(indian ? 6.5 : 4)
  const [lotInput, setLotInput] = useState<number | null>(null)
  // Custom legs are tied to the symbol they were edited for, so switching
  // symbol falls back to the template instead of showing stale strikes.
  const [custom, setCustom]     = useState<{ symbol: string; legs: Leg[] } | null>(null)

  const volPct = volInput ?? (realised ? Math.round(realised * 1000) / 10 : 30)
  const sigma = volPct / 100, T = days / 365, r = ratePct / 100
  const lot = lotInput ?? (indian ? 1 : 100)

  const templateLegs = useMemo(() => (spot ? buildTemplate(template, spot, sigma, T, r) : []), [template, spot, sigma, T, r])
  const isCustom = custom?.symbol === symbol
  const legs = isCustom ? custom.legs : templateLegs

  const edit = (next: Leg[]) => setCustom({ symbol, legs: next })
  const patch = (i: number, p: Partial<Leg>) => edit(legs.map((l, j) => (j === i ? { ...l, ...p } : l)))
  const addLeg = () => {
    if (!spot || legs.length >= MAX_LEGS) return
    const step = strikeStep(spot), strike = Math.round(spot / step) * step
    edit([...legs, ...buildTemplate('long-call', strike, sigma, T, r)])
  }

  const guide = usePanelGuide({
    title: 'Reading a payoff diagram',
    next: [{ label: 'OPTIONS CHAIN', panelId: 'options' }, { label: 'PRICE ALERTS', panelId: 'alerts' }],
    children: <>The solid line is what the position makes or loses at expiry for each possible price. Where it crosses zero is a break-even. The probability of profit assumes prices follow the volatility you entered, so change it and watch the number move. Selling options usually means a small, likely gain in exchange for a rare, large loss.</>,
  })

  const analysis = useMemo(() => analysePayoff(legs), [legs])
  const pop = useMemo(() => (spot ? probabilityOfProfit(legs, spot, sigma, T, r) : null), [legs, spot, sigma, T, r])
  const expected = spot ? spot * sigma * Math.sqrt(T) : null

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div className="dot" />
        OPTIONS STRATEGY
        <span style={{ fontSize: 13, color: 'var(--amber)', fontFamily: MONO, fontWeight: 700 }}>{symbol}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO }}>{spot ? `SPOT ${px(spot)} · ` : ''}MODEL PRICES · RUNS IN YOUR BROWSER</span>
        <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>{guide.button}</span>
      </div>
      {guide.body}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <label style={lbl}>
          STRATEGY
          <select style={ctl} value={isCustom ? 'custom' : template} onChange={e => { if (e.target.value !== 'custom') { setTemplate(e.target.value as TemplateId); setCustom(null) } }}>
            {(Object.keys(TEMPLATES) as TemplateId[]).map(id => <option key={id} value={id}>{TEMPLATES[id]}</option>)}
            {isCustom && <option value="custom">Custom (edited)</option>}
          </select>
        </label>
        <Num label="DAYS TO EXPIRY" value={days} min={1} max={730} step={1} onChange={setDays} />
        <Num label="VOLATILITY %" value={volPct} min={1} max={400} onChange={setVolInput}
          title={realised ? `Defaults to the last ${VOL_WINDOW} sessions' realised volatility (${(realised * 100).toFixed(1)}%). Replace with implied volatility if you know it.` : 'Annual volatility used to price the options'} />
        <Num label="RATE %" value={ratePct} min={0} max={30} onChange={setRatePct} />
        <Num label="LOT SIZE" value={lot} min={1} max={100000} step={1} onChange={setLotInput} title="Units of the underlying per contract" />
        {isCustom && <button type="button" style={btn} onClick={() => setCustom(null)}>RESET TO TEMPLATE</button>}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {!spot ? (
          quoteError ? <Note bad text={`Could not load a price for ${symbol}. Try again shortly.`} /> : <PanelSkeleton label={`Loading ${symbol} price…`} />
        ) : !analysis ? (
          <Note text="Add at least one leg with a strike and quantity above zero." />
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 8, padding: '8px 10px' }}>
              <Tile label={analysis.netDebit >= 0 ? 'COST TO OPEN' : 'CREDIT RECEIVED'} value={money(Math.abs(analysis.netDebit) * lot, sign)} sub="Option premiums, one lot" />
              <Tile label="MAX PROFIT" value={analysis.maxProfit === null ? 'Unlimited' : money(analysis.maxProfit * lot, sign)} color="var(--positive)" sub="At expiry" />
              <Tile label="MAX LOSS" value={analysis.maxLoss === null ? 'Unlimited' : money(analysis.maxLoss * lot, sign)} color="var(--negative)" sub={analysis.maxLoss === null ? 'Uncovered short call' : 'At expiry'} />
              <Tile label={`BREAK-EVEN${analysis.breakevens.length === 1 ? '' : 'S'}`} value={analysis.breakevens.length ? analysis.breakevens.map(px).join(' / ') : 'None'}
                sub={analysis.breakevens.length && spot ? analysis.breakevens.map(b => `${b >= spot ? '+' : ''}${(((b - spot) / spot) * 100).toFixed(1)}%`).join(' / ') + ' from spot' : ''} />
              <Tile label="PROBABILITY OF PROFIT" value={pop === null ? '—' : `${(pop * 100).toFixed(0)}%`} sub={`Model estimate at ${volPct.toFixed(1)}% volatility`} />
            </div>

            <div style={{ padding: '0 10px' }}>
              <PayoffChart legs={legs} spot={spot} T={T} r={r} sigma={sigma} lot={lot} breakevens={analysis.breakevens} sign={sign} drawKey={`${symbol}:${isCustom ? 'custom' : template}`} />
            </div>
            <div style={{ padding: '2px 10px 8px', fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO, lineHeight: 1.5 }}>
              Solid line: profit or loss at expiry. <span style={{ color: 'var(--amber)' }}>Dashed</span>: model value today.
              {expected ? ` One-standard-deviation move by expiry at this volatility: ±${px(expected)} (${((expected / spot) * 100).toFixed(1)}%).` : ''}
            </div>

            <div style={{ overflowX: 'auto', padding: '0 10px 8px' }}>
              <table style={{ borderCollapse: 'collapse', fontFamily: MONO, fontSize: 13, width: '100%' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'left' }}>
                    <th style={cell}>SIDE</th><th style={cell}>TYPE</th><th style={cell}>STRIKE / ENTRY</th><th style={cell}>PREMIUM</th><th style={cell}>QTY</th><th style={cell} />
                  </tr>
                </thead>
                <tbody>
                  {legs.map((l, i) => (
                    <tr key={i}>
                      <td style={cell}>
                        <select aria-label={`Leg ${i + 1} side`} style={{ ...ctl, color: l.side === 'long' ? 'var(--positive)' : 'var(--negative)' }} value={l.side} onChange={e => patch(i, { side: e.target.value as LegSide })}>
                          <option value="long">BUY</option><option value="short">SELL</option>
                        </select>
                      </td>
                      <td style={cell}>
                        <select aria-label={`Leg ${i + 1} type`} style={ctl} value={l.type} onChange={e => patch(i, { type: e.target.value as LegType, ...(e.target.value === 'stock' ? { premium: 0 } : {}) })}>
                          <option value="call">CALL</option><option value="put">PUT</option><option value="stock">STOCK</option>
                        </select>
                      </td>
                      <td style={cell}><input aria-label={`Leg ${i + 1} strike`} type="number" inputMode="decimal" step="any" min={0} style={{ ...ctl, width: 84 }} value={l.strike} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0) patch(i, { strike: n }) }} /></td>
                      <td style={cell}>
                        {l.type === 'stock'
                          ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                          : <input aria-label={`Leg ${i + 1} premium`} type="number" inputMode="decimal" step="any" min={0} style={{ ...ctl, width: 76 }} value={l.premium} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0) patch(i, { premium: n }) }} />}
                      </td>
                      <td style={cell}><input aria-label={`Leg ${i + 1} quantity`} type="number" inputMode="numeric" step={1} min={1} max={1000} style={{ ...ctl, width: 54 }} value={l.qty} onChange={e => { const n = Math.floor(Number(e.target.value)); if (Number.isFinite(n) && n >= 1 && n <= 1000) patch(i, { qty: n }) }} /></td>
                      <td style={cell}><button type="button" style={{ ...btn, padding: '3px 6px' }} onClick={() => edit(legs.filter((_, j) => j !== i))} aria-label={`Remove leg ${i + 1}`}>REMOVE</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" style={{ ...btn, marginTop: 6, opacity: legs.length >= MAX_LEGS ? 0.4 : 1 }} disabled={legs.length >= MAX_LEGS} onClick={addLeg}>+ ADD LEG</button>
            </div>
          </>
        )}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        Premiums are Black-Scholes model prices, not market quotes; replace them with your broker&apos;s. Ignores early exercise, dividends, fees and margin. Not financial advice.
      </div>
    </div>
  )
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={tile}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, fontFamily: MONO, color: color ?? 'var(--text)', marginTop: 2, overflowWrap: 'anywhere' }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: MONO, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function Note({ text, bad }: { text: string; bad?: boolean }) {
  return <div role="status" style={{ padding: '24px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 13, color: bad ? 'var(--negative)' : 'var(--text-muted)' }}>{text}</div>
}
