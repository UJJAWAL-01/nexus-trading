'use client'
// src/components/panels/FixedIncomePanel.tsx
// Transparent Fixed Income Intelligence — US + India
// Every number shows its source type badge. No false confidence displayed.
import { useEffect, useState, useCallback, useRef } from 'react'

// ── Types (mirror API schema) ─────────────────────────────────────────────────
type DataSourceType = 'live' | 'official' | 'modeled' | 'synthetic' | 'unavailable'

interface DataPoint<T> {
  value:          T | null
  source:         string
  sourceUrl?:     string
  dataSourceType: DataSourceType
  fetchedAt:      string
  reportingDate?: string
  ageHours?:      number
  notes?:         string
}

interface YieldPoint {
  tenor:         string
  maturityYears: number
  yieldData:     DataPoint<number>
}

interface SpreadData {
  igOAS:        DataPoint<number>
  hyOAS:        DataPoint<number>
  bbbSpread:    DataPoint<number>
  twoTenSpread: DataPoint<number>
  psuSpread?:   DataPoint<number>
  sdlSpread?:   DataPoint<number>
  tenYrVsRepo?: DataPoint<number>
}

interface BondData {
  id: string; issuer: string; type: string; country: 'US' | 'IN'
  coupon: number; maturityDate: string; maturityYears: number
  price: DataPoint<number>; ytm: DataPoint<number>
  macaulayDuration: number; modifiedDuration: number; convexity: number
  spreadBps: DataPoint<number>; rating: string; liquidityScore: number
  currency: 'USD' | 'INR'; isin?: string; synthetic: true; syntheticNote: string
}

interface MacroContext {
  policyRate: DataPoint<number>; cpi: DataPoint<number>; label: string; stance: string
}

interface IndiaAvailability {
  nseSuccess: boolean; dbieSuccess: boolean; anyLiveData: boolean; message: string
}

interface TipsBreakeven {
  dfii5:  DataPoint<number>
  dfii10: DataPoint<number>
  be5y:   DataPoint<number>
  be10y:  DataPoint<number>
}

interface TradingSignals {
  duration:        'EXTEND' | 'NEUTRAL' | 'REDUCE'
  durationReason:  string
  durationColor:   string
  credit:          'ADD' | 'NEUTRAL' | 'REDUCE' | 'N/A'
  creditReason:    string
  creditColor:     string
  curveSignal:     'STEEPEN' | 'NEUTRAL' | 'FLATTEN' | 'N/A'
  curveReason:     string
  recessionRisk:   'LOW' | 'MODERATE' | 'ELEVATED'
  recessionReason: string
  recessionColor:  string
}

interface FIResponse {
  market: 'US' | 'IN'; yieldCurve: YieldPoint[]; bonds: BondData[]
  spreads: SpreadData | null; macroContext: MacroContext
  curveShape: string; curveDataQuality: DataSourceType
  indiaAvailability?: IndiaAvailability
  systemMessages: string[]; fetchedAt: string
  insights?: string; insightsProvider?: string; insightsError?: string
  tips?: TipsBreakeven
  signals?: TradingSignals
}

type Market = 'US' | 'IN' | 'COMPARE'
type Tab    = 'overview' | 'curve' | 'bonds' | 'spreads'

// ── Design constants ──────────────────────────────────────────────────────────
const US_COLOR    = '#00e5c0'
const INDIA_COLOR = '#f97316'
const BOND_COLORS: Record<string, string> = {
  treasury: '#00e5c0', gsec: '#f97316', 'ig-corporate': '#a78bfa',
  'hy-corporate': '#f0a500', sdl: '#fbbf24', psu: '#86efac', agency: '#38bdf8',
}

// ── Data Quality System ───────────────────────────────────────────────────────
const DST_META: Record<DataSourceType, { label: string; color: string; bg: string; icon: string; border: string }> = {
  live:        { label: 'LIVE',      color: '#00c97a', bg: 'rgba(0,201,122,0.12)',    icon: '●', border: 'rgba(0,201,122,0.3)'  },
  official:    { label: 'OFFICIAL',  color: '#38bdf8', bg: 'rgba(56,189,248,0.1)',    icon: '◆', border: 'rgba(56,189,248,0.25)' },
  modeled:     { label: 'MODELED',   color: '#f0a500', bg: 'rgba(240,165,0,0.12)',    icon: '⚙', border: 'rgba(240,165,0,0.3)'  },
  synthetic:   { label: 'SYNTHETIC', color: '#a78bfa', bg: 'rgba(167,139,250,0.1)',   icon: '◈', border: 'rgba(167,139,250,0.25)'},
  unavailable: { label: 'N/A',       color: '#4a6070', bg: 'rgba(74,96,112,0.1)',     icon: '○', border: 'rgba(74,96,112,0.2)'  },
}

function DSTBadge({ dst, small, tooltip }: { dst: DataSourceType; small?: boolean; tooltip?: string }) {
  const m = DST_META[dst]
  return (
    <span title={tooltip} style={{
      display: 'inline-flex', alignItems: 'center', gap: '3px',
      fontSize: small ? '10px' : '11px', padding: small ? '1px 5px' : '2px 7px', borderRadius: '2px',
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: '0.06em',
      cursor: tooltip ? 'help' : 'default', flexShrink: 0,
    }}>
      {m.icon} {m.label}
    </span>
  )
}

function SignalPill({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '2px', fontSize: '11px',
      fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: '0.08em',
      background: color + '20', color, border: `1px solid ${color}40`,
    }}>{label}</span>
  )
}

function TradingSignalsBar({ signals, tips }: { signals: TradingSignals; tips?: TipsBreakeven }) {
  const rows = [
    { label: 'DURATION',       signal: signals.duration,     color: signals.durationColor,   reason: signals.durationReason    },
    { label: 'CREDIT (IG)',    signal: signals.credit,       color: signals.creditColor,     reason: signals.creditReason      },
    { label: 'CURVE',         signal: signals.curveSignal,  color: signals.curveSignal === 'N/A' ? '#4a6070' : '#38bdf8', reason: signals.curveReason },
    { label: 'RECESSION RISK', signal: signals.recessionRisk, color: signals.recessionColor, reason: signals.recessionReason   },
  ]
  return (
    <div style={{ margin: '8px 14px', padding: '10px 12px', background: 'rgba(0,229,192,0.03)', border: '1px solid rgba(0,229,192,0.12)', borderRadius: '5px' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', marginBottom: '8px' }}>
        TRADING SIGNALS — computed from live data
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: tips ? '10px' : 0 }}>
        {rows.map(r => (
          <div key={r.label} style={{ padding: '7px 10px', background: 'var(--bg-deep)', borderRadius: '4px', borderLeft: `3px solid ${r.color}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>{r.label}</span>
              <SignalPill label={r.signal} color={r.color} />
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5 }}>{r.reason}</div>
          </div>
        ))}
      </div>
      {tips && (
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '8px', marginTop: '2px' }}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '6px' }}>
            TIPS REAL YIELDS &amp; BREAKEVEN INFLATION
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px' }}>
            {[
              { label: '5Y TIPS', dp: tips.dfii5  },
              { label: '10Y TIPS', dp: tips.dfii10 },
              { label: '5Y BE',   dp: tips.be5y   },
              { label: '10Y BE',  dp: tips.be10y  },
            ].map(({ label, dp }) => (
              <div key={label} title={`Source: ${dp.source}${dp.notes ? ' — ' + dp.notes : ''}`}
                style={{ padding: '6px 8px', background: 'var(--bg-deep)', borderRadius: '3px', cursor: 'help' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: '2px' }}>{label}</div>
                <div style={{ fontSize: '14px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: dp.value !== null ? (label.includes('BE') ? '#f0a500' : '#38bdf8') : '#4a6070', lineHeight: 1 }}>
                  {dp.value !== null ? `${dp.value.toFixed(2)}%` : '—'}
                </div>
                <DSTBadge dst={dp.dataSourceType} small />
              </div>
            ))}
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '6px', lineHeight: 1.5 }}>
            TIPS = inflation-protected real yield · BE = market-implied inflation expectation (FRED T5YIE / T10YIE)
          </div>
        </div>
      )}
    </div>
  )
}

/** Inline source attribution chip — shown on hover via title */
function SourceChip({ dp }: { dp: DataPoint<any> }) {
  const m = DST_META[dp.dataSourceType]
  return (
    <span title={`Source: ${dp.source}${dp.reportingDate ? ` (${dp.reportingDate})` : ''}${dp.notes ? ` — ${dp.notes}` : ''}`} style={{
      fontSize: '10px', color: m.color, cursor: 'help', fontFamily: 'JetBrains Mono, monospace',
    }}>
      {m.icon}
    </span>
  )
}

function SystemMessages({ messages, accentColor }: { messages: string[]; accentColor: string }) {
  if (!messages.length) return null
  const errors   = messages.filter(m => m.startsWith('❌'))
  const warnings = messages.filter(m => m.startsWith('⚠'))
  const infos    = messages.filter(m => m.startsWith('ℹ') || m.startsWith('⚙'))
  const ok       = messages.filter(m => !m.startsWith('❌') && !m.startsWith('⚠') && !m.startsWith('ℹ') && !m.startsWith('⚙'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '8px 12px', flexShrink: 0 }}>
      {errors.map((m, i) => (
        <div key={i} style={{ padding: '6px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', background: 'rgba(255,69,96,0.08)', border: '1px solid rgba(255,69,96,0.25)', color: '#ff4560', lineHeight: 1.5 }}>
          {m}
        </div>
      ))}
      {warnings.map((m, i) => (
        <div key={i} style={{ padding: '6px 10px', borderRadius: '4px', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', background: 'rgba(240,165,0,0.07)', border: '1px solid rgba(240,165,0,0.25)', color: '#f0a500', lineHeight: 1.5 }}>
          {m}
        </div>
      ))}
      {infos.map((m, i) => (
        <div key={i} style={{ padding: '6px 10px', borderRadius: '4px', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', background: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.15)', color: '#38bdf8', lineHeight: 1.5 }}>
          {m}
        </div>
      ))}
      {ok.map((m, i) => (
        <div key={i} style={{ padding: '4px 8px', borderRadius: '3px', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {m}
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// YIELD CURVE SVG
// ═══════════════════════════════════════════════════════════════════════════════

function YieldCurveChart({ us, india, mode, h = 190 }: { us: YieldPoint[]; india: YieldPoint[]; mode: Market; h?: number }) {
  const [hov, setHov] = useState<{ x: number; y: number; label: string; dst: DataSourceType } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const W = 560, H = h
  const PAD = { l: 46, r: 18, t: 16, b: 36 }
  const CW = W - PAD.l - PAD.r, CH = H - PAD.t - PAD.b

  const primary   = mode === 'IN' ? india : us
  const secondary = mode === 'COMPARE' ? india : []
  const allY      = [...primary, ...secondary].map(p => p.yieldData.value).filter(v => v !== null) as number[]
  if (allY.length === 0) return (
    <div style={{ height: H, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
      <div style={{ color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>YIELD CURVE UNAVAILABLE</div>
      <DSTBadge dst="unavailable" />
    </div>
  )

  const minY = Math.max(0, Math.min(...allY) - 0.3), maxY = Math.max(...allY) + 0.4
  const maxMat = Math.max(...primary.map(p => p.maturityYears), ...secondary.map(p => p.maturityYears), 1)
  const x  = (mat: number) => PAD.l + (Math.log1p(mat) / Math.log1p(maxMat)) * CW
  const y  = (yld: number) => PAD.t + CH - ((yld - minY) / (maxY - minY)) * CH

  const path = (pts: YieldPoint[]) => {
    const c = pts.filter(p => p.yieldData.value !== null).map(p => ({ x: x(p.maturityYears), y: y(p.yieldData.value!), p }))
    if (c.length < 2) return { d: '', fillD: '', c }
    let d = `M${c[0].x.toFixed(1)},${c[0].y.toFixed(1)}`
    for (let i = 0; i < c.length - 1; i++) {
      const p0 = c[Math.max(0, i - 1)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(c.length - 1, i + 2)]
      const t = 0.35
      d += ` C${(p1.x + (p2.x - p0.x) * t / 2).toFixed(1)},${(p1.y + (p2.y - p0.y) * t / 2).toFixed(1)} ${(p2.x - (p3.x - p1.x) * t / 2).toFixed(1)},${(p2.y - (p3.y - p1.y) * t / 2).toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
    }
    const fillD = d + ` L${c[c.length - 1].x.toFixed(1)},${(H - PAD.b).toFixed(1)} L${c[0].x.toFixed(1)},${(H - PAD.b).toFixed(1)}Z`
    return { d, fillD, c }
  }

  const primaryColor   = mode === 'IN' ? INDIA_COLOR : US_COLOR
  const primaryPath    = path(primary)
  const secondaryPath  = mode === 'COMPARE' ? path(secondary) : null

  const yTicks = 4
  const gridYs = Array.from({ length: yTicks + 1 }, (_, i) => ({ y: PAD.t + (CH / yTicks) * i, v: maxY - (maxY - minY) / yTicks * i }))
  const xTicks = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30].filter(m => m <= maxMat * 1.05)
  const tl     = (m: number) => m < 1 ? `${Math.round(m * 12)}M` : `${m}Y`

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !primaryPath.c.length) return
    const r  = svgRef.current.getBoundingClientRect()
    const sx = (e.clientX - r.left) * (W / r.width)
    let near = primaryPath.c[0], minD = Infinity
    for (const c of primaryPath.c) { const d = Math.abs(c.x - sx); if (d < minD) { minD = d; near = c } }
    if (minD > 30) { setHov(null); return }
    setHov({ x: near.x, y: near.y, label: `${near.p.tenor}  ${near.p.yieldData.value?.toFixed(3)}%`, dst: near.p.yieldData.dataSourceType })
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible', cursor: 'crosshair' }}
      onMouseMove={handleMove} onMouseLeave={() => setHov(null)}>
      <defs>
        <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={primaryColor} stopOpacity="0.15"/><stop offset="100%" stopColor={primaryColor} stopOpacity="0.01"/></linearGradient>
        <linearGradient id="gs" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={INDIA_COLOR} stopOpacity="0.1"/><stop offset="100%" stopColor={INDIA_COLOR} stopOpacity="0.01"/></linearGradient>
      </defs>
      {gridYs.map(({ y: gy, v }) => (
        <g key={v}>
          <line x1={PAD.l} y1={gy.toFixed(1)} x2={W - PAD.r} y2={gy.toFixed(1)} stroke="#1e2d3d" strokeWidth="1" strokeDasharray="3,4"/>
          <text x={PAD.l - 4} y={(gy + 3.5).toFixed(1)} textAnchor="end" fill="#4a6070" fontSize="9" fontFamily="JetBrains Mono, monospace">{v.toFixed(1)}%</text>
        </g>
      ))}
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#1e2d3d" strokeWidth="1"/>
      {xTicks.map(m => {
        const px = x(m).toFixed(1)
        return (
          <g key={m}>
            <line x1={px} y1={H - PAD.b} x2={px} y2={(H - PAD.b + 4).toFixed(1)} stroke="#1e2d3d" strokeWidth="1"/>
            <text x={px} y={(H - PAD.b + 14).toFixed(1)} textAnchor="middle" fill="#4a6070" fontSize="8.5" fontFamily="JetBrains Mono, monospace">{tl(m)}</text>
          </g>
        )
      })}
      {secondaryPath && secondaryPath.d && <>
        <path d={secondaryPath.fillD} fill="url(#gs)"/>
        <path d={secondaryPath.d} fill="none" stroke={INDIA_COLOR} strokeWidth="2" strokeLinecap="round" opacity="0.8"/>
        {secondaryPath.c.map(c => <circle key={c.p.tenor} cx={c.x.toFixed(1)} cy={c.y.toFixed(1)} r="3" fill={INDIA_COLOR} opacity="0.8"/>)}
      </>}
      {primaryPath.d && <>
        <path d={primaryPath.fillD} fill="url(#gp)"/>
        <path d={primaryPath.d} fill="none" stroke={primaryColor} strokeWidth="2.5" strokeLinecap="round"/>
        {primaryPath.c.map(c => {
          const dm = DST_META[c.p.yieldData.dataSourceType]
          return (
            <circle key={c.p.tenor} cx={c.x.toFixed(1)} cy={c.y.toFixed(1)} r="4"
              fill={c.p.yieldData.dataSourceType !== 'live' ? dm.color : primaryColor}
              stroke={primaryColor} strokeWidth={c.p.yieldData.dataSourceType !== 'live' ? '2' : '0'}
              >
              title={`${c.p.tenor}: ${c.p.yieldData.value?.toFixed(3)}% — ${dm.label}`}
              </circle>
          )
        })}
      </>}
      {mode === 'COMPARE' && (
        <>
          <circle cx={PAD.l + 6} cy={PAD.t + 5} r="4" fill={US_COLOR}/><text x={PAD.l + 14} y={PAD.t + 9} fill={US_COLOR} fontSize="9" fontFamily="JetBrains Mono, monospace">US Treasury</text>
          <circle cx={PAD.l + 98} cy={PAD.t + 5} r="4" fill={INDIA_COLOR}/><text x={PAD.l + 106} y={PAD.t + 9} fill={INDIA_COLOR} fontSize="9" fontFamily="JetBrains Mono, monospace">India G-Sec</text>
        </>
      )}
      {hov && (
        <g>
          <line x1={hov.x.toFixed(1)} y1={PAD.t} x2={hov.x.toFixed(1)} y2={H - PAD.b} stroke={primaryColor} strokeWidth="1" strokeDasharray="4,3" opacity="0.6"/>
          <circle cx={hov.x.toFixed(1)} cy={hov.y.toFixed(1)} r="5" fill="var(--bg-panel)" stroke={primaryColor} strokeWidth="2"/>
          <rect x={(hov.x - 58).toFixed(1)} y={(hov.y - 27).toFixed(1)} width="116" height="20" rx="3" fill="var(--bg-panel)" stroke={primaryColor} strokeWidth="1" opacity="0.95"/>
          <text x={hov.x.toFixed(1)} y={(hov.y - 12).toFixed(1)} textAnchor="middle" fill="#fff" fontSize="10" fontFamily="JetBrains Mono, monospace" fontWeight="700">{hov.label}</text>
        </g>
      )}
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// KPI CARD with data quality badge
// ═══════════════════════════════════════════════════════════════════════════════
function KpiCard({ label, dp, color, note }: { label: string; dp: DataPoint<number>; color?: string; note?: string }) {
  const m     = DST_META[dp.dataSourceType]
  const isAvail = dp.value !== null
  return (
    <div style={{
      padding: '10px 12px', background: 'var(--bg-deep)', flex: 1, minWidth: '90px',
      border: `1px solid ${isAvail ? (color ? color + '30' : 'var(--border)') : 'rgba(74,96,112,0.2)'}`,
      borderLeft: `3px solid ${isAvail ? (color ?? m.color) : '#4a6070'}`,
      borderRadius: '4px', cursor: dp.notes ? 'help' : 'default',
    }} title={dp.notes ?? `Source: ${dp.source}${dp.reportingDate ? ` (${dp.reportingDate})` : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', flex: 1 }}>{label}</div>
        <DSTBadge dst={dp.dataSourceType} small />
      </div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 900, fontSize: '20px', color: isAvail ? (color ?? '#fff') : '#4a6070', lineHeight: 1 }}>
        {isAvail ? (typeof dp.value === 'number' ? dp.value.toFixed(2) : dp.value) : '—'}
        {isAvail && typeof dp.value === 'number' && label.includes('%') ? '' : isAvail ? '%' : ''}
      </div>
      {note && <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '3px' }}>{note}</div>}
      {dp.ageHours != null && dp.ageHours > 48 && (
        <div style={{ fontSize: '10px', color: '#f0a500', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>
          ⚠ {Math.round(dp.ageHours / 24)}d old
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPREAD BAR with data quality
// ═══════════════════════════════════════════════════════════════════════════════
function SpreadBar({ label, dp, maxBps }: { label: string; dp: DataPoint<number>; maxBps: number }) {
  const pct = dp.value !== null ? Math.min((dp.value / maxBps) * 100, 100) : 0
  const m   = DST_META[dp.dataSourceType]
  return (
    <div style={{ marginBottom: '12px' }} title={`Source: ${dp.source}${dp.notes ? ' — ' + dp.notes : ''}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
          <DSTBadge dst={dp.dataSourceType} small />
        </div>
        <span style={{ fontSize: '13px', fontWeight: 700, color: dp.value !== null ? m.color : '#4a6070', fontFamily: 'Syne, sans-serif' }}>
          {dp.value !== null ? `${dp.value > 0 ? '+' : ''}${Math.round(dp.value)}bp` : 'N/A'}
        </span>
      </div>
      <div style={{ height: '5px', background: 'var(--bg-deep)', borderRadius: '3px', overflow: 'hidden' }}>
        {dp.value !== null && (
          <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${m.color}50, ${m.color})`, borderRadius: '3px', transition: 'width 0.8s ease' }}/>
        )}
      </div>
      {dp.notes && <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '3px', lineHeight: 1.5 }}>{dp.notes}</div>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYNTHETIC DATA WARNING BANNER
// ═══════════════════════════════════════════════════════════════════════════════
function SyntheticBanner({ text }: { text: string }) {
  return (
    <div style={{ padding: '8px 12px', background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)', borderLeft: '3px solid #a78bfa', borderRadius: '0 4px 4px 0', marginBottom: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
        <DSTBadge dst="synthetic" />
        <span style={{ fontSize: '11px', color: '#a78bfa', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', fontWeight: 700 }}>SYNTHETIC BOND UNIVERSE</span>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6 }}>{text}</div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// BOND TABLE with per-field quality
// ═══════════════════════════════════════════════════════════════════════════════
function BondTable({ bonds, market }: { bonds: BondData[]; market: 'US' | 'IN' | 'COMPARE' }) {
  const [filter, setFilter] = useState('all')
  const [sortKey, setSortKey] = useState<string>('maturityYears')
  const [sortDir, setSortDir] = useState(1)

  const types = ['all', ...Array.from(new Set(bonds.map(b => b.type)))]
  const sorted = [...bonds]
    .filter(b => filter === 'all' || b.type === filter)
    .sort((a, b) => {
      let av: any, bv: any
      if (sortKey === 'ytm') { av = a.ytm.value ?? -999; bv = b.ytm.value ?? -999 }
      else if (sortKey === 'spreadBps') { av = a.spreadBps.value ?? -999; bv = b.spreadBps.value ?? -999 }
      else if (sortKey === 'maturityYears') { av = a.maturityYears; bv = b.maturityYears }
      else if (sortKey === 'duration') { av = a.modifiedDuration; bv = b.modifiedDuration }
      else { av = (a as any)[sortKey] ?? ''; bv = (b as any)[sortKey] ?? '' }
      return sortDir * (typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv)))
    })

  const TH = ({ label, sk, right }: { label: string; sk?: string; right?: boolean }) => (
    <th onClick={() => sk && (sk === sortKey ? setSortDir(d => d === 1 ? -1 : 1) : (setSortKey(sk), setSortDir(1)))} style={{
      padding: '5px 7px', textAlign: right ? 'right' : 'left', fontSize: '10px',
      color: sortKey === sk ? '#fff' : 'var(--text-muted)', letterSpacing: '0.1em',
      cursor: sk ? 'pointer' : 'default', borderBottom: '1px solid var(--border)',
      background: 'var(--bg-deep)', userSelect: 'none', fontFamily: 'JetBrains Mono, monospace',
      fontWeight: 600, position: 'sticky', top: 0, zIndex: 2, whiteSpace: 'nowrap',
    }}>
      {label}{sk && sortKey === sk && (sortDir === 1 ? ' ↑' : ' ↓')}
    </th>
  )

  const synNote = bonds[0]?.syntheticNote ?? ''

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <SyntheticBanner text={synNote} />
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {types.map(t => (
            <button key={t} onClick={() => setFilter(t)} style={{
              padding: '4px 10px', borderRadius: '3px', cursor: 'pointer', fontSize: '11px',
              fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase',
              border: `1px solid ${filter === t ? BOND_COLORS[t] ?? 'var(--teal)' : 'var(--border)'}`,
              background: filter === t ? (BOND_COLORS[t] ?? 'var(--teal)') + '18' : 'transparent',
              color: filter === t ? BOND_COLORS[t] ?? 'var(--teal)' : 'var(--text-muted)',
            }}>{t}</button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', alignSelf: 'center' }}>{sorted.length} bonds</span>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', minWidth: '680px' }}>
          <thead>
            <tr>
              <TH label="ISSUER"   sk="issuer" />
              <TH label="TYPE" />
              <TH label="MAT"      sk="maturityYears"  right />
              <TH label="CPN %"    right />
              <TH label="PRICE"    right />
              <TH label="YTM"      sk="ytm"            right />
              <TH label="M.DUR"    sk="duration"       right />
              <TH label="SPREAD"   sk="spreadBps"      right />
              <TH label="RTNG" />
              <TH label="LIQ" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((b, i) => {
              const tc = BOND_COLORS[b.type] ?? '#7a9ab0'
              const ytmAvail = b.ytm.value !== null
              return (
                <tr key={b.id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 ? 'rgba(255,255,255,0.01)' : 'transparent' }}
                  title={`Synthetic: ${b.syntheticNote}`}>
                  <td style={{ padding: '6px 7px' }}>
                    <div style={{ color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: '11px' }}>{b.issuer.length > 22 ? b.issuer.slice(0, 22) + '…' : b.issuer}</div>
                    {b.isin && <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{b.isin}</div>}
                  </td>
                  <td style={{ padding: '6px 7px' }}>
                    <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: '2px', background: tc + '18', color: tc, border: `1px solid ${tc}30` }}>
                      {b.type}
                    </span>
                  </td>
                  <td style={{ padding: '6px 7px', textAlign: 'right', color: 'var(--text-2)' }}>
                    {b.maturityYears < 1 ? `${Math.round(b.maturityYears * 365)}D` : `${b.maturityYears.toFixed(1)}Y`}
                  </td>
                  <td style={{ padding: '6px 7px', textAlign: 'right', color: 'var(--text-2)' }}>
                    {b.coupon === 0 ? 'Disc' : `${b.coupon.toFixed(2)}%`}
                  </td>
                  <td style={{ padding: '6px 7px', textAlign: 'right', color: b.price.value !== null ? 'var(--text-2)' : '#4a6070' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', justifyContent: 'flex-end' }}>
                      {b.price.value !== null ? b.price.value.toFixed(2) : '—'}
                      <SourceChip dp={b.price} />
                    </div>
                  </td>
                  <td style={{ padding: '6px 7px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', justifyContent: 'flex-end' }}>
                      <span style={{ fontWeight: 700, color: ytmAvail ? (b.ytm.value! >= 7 ? '#ff4560' : b.ytm.value! >= 5 ? '#00c97a' : 'var(--text-2)') : '#4a6070' }}>
                        {ytmAvail ? `${b.ytm.value?.toFixed(2)}%` : '—'}
                      </span>
                      <SourceChip dp={b.ytm} />
                    </div>
                  </td>
                  <td style={{ padding: '6px 7px', textAlign: 'right', color: 'var(--text-2)' }}>
                    {b.modifiedDuration > 0 ? b.modifiedDuration.toFixed(2) : '—'}
                  </td>
                  <td style={{ padding: '6px 7px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', justifyContent: 'flex-end' }}>
                      <span style={{ color: b.spreadBps.value != null ? (b.spreadBps.value === 0 ? 'var(--text-muted)' : b.spreadBps.value > 300 ? '#ff4560' : '#00c97a') : '#4a6070' }}>
                        {b.spreadBps.value !== null ? (b.spreadBps.value === 0 ? 'Benchmark' : `+${Math.round(b.spreadBps.value)}bp`) : '—'}
                      </span>
                      <SourceChip dp={b.spreadBps} />
                    </div>
                  </td>
                  <td style={{ padding: '6px 7px', fontSize: '11px', color: b.rating === 'UST' || b.rating === 'Sov' ? '#00c97a' : 'var(--text-2)' }}>{b.rating}</td>
                  <td style={{ padding: '6px 7px' }}>
                    <div style={{ display: 'flex', gap: '1px' }}>
                      {Array.from({ length: 10 }, (_, j) => (
                        <div key={j} style={{ width: '3px', height: '9px', borderRadius: '1px', background: j < b.liquidityScore ? '#00c97a' : 'var(--bg-deep)' }}/>
                      ))}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════════════════════
export default function FixedIncomePanel() {
  const [market,         setMarket]         = useState<Market>('US')
  const [tab,            setTab]            = useState<Tab>('overview')
  const [usData,         setUsData]         = useState<FIResponse | null>(null)
  const [inData,         setInData]         = useState<FIResponse | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [allowModeled,   setAllowModeled]   = useState(false)
  const stale = useRef<{ us: FIResponse | null; in: FIResponse | null }>({ us: null, in: null })

  const fetch1 = useCallback(async (mkt: 'US' | 'IN', modeled = false) => {
    try {
      const url = `/api/fixed-income?market=${mkt}${modeled ? '&modeled=1' : ''}`
      const res = await fetch(url)
      const d   = await res.json() as FIResponse
      if (mkt === 'US') { setUsData(d); stale.current.us = d }
      else              { setInData(d); stale.current.in = d }
    } catch {
      if (mkt === 'US' && stale.current.us) setUsData(stale.current.us)
      if (mkt === 'IN' && stale.current.in) setInData(stale.current.in)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetch1('US'), fetch1('IN', allowModeled)]).finally(() => setLoading(false))
    const t = setInterval(() => { fetch1('US'); fetch1('IN', allowModeled) }, 30 * 60_000)
    return () => clearInterval(t)
  }, [fetch1, allowModeled])

  const active       = market === 'IN' ? inData : usData
  const accent       = market === 'IN' ? INDIA_COLOR : US_COLOR
  const dq           = active?.curveDataQuality ?? 'unavailable'
  const inAvail      = inData?.indiaAvailability
  const livePoints   = (active?.yieldCurve ?? []).filter(p => p.yieldData.dataSourceType === 'live')

  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'OVERVIEW'    },
    { id: 'curve',    label: 'YIELD CURVE' },
    { id: 'bonds',    label: 'BONDS'       },
    { id: 'spreads',  label: 'SPREADS'     },
  ]

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* HEADER */}
      <div className="panel-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '5px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: accent }} />
          <span style={{ fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700 }}>FIXED INCOME</span>
          <DSTBadge dst={dq} tooltip={`Yield curve data quality: ${DST_META[dq].label}`} />
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['US', 'IN', 'COMPARE'] as Market[]).map(m => (
            <button key={m} onClick={() => setMarket(m)} style={{
              padding: '3px 10px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', fontWeight: 700,
              border: `1px solid ${market === m ? (m === 'IN' ? INDIA_COLOR : US_COLOR) : 'var(--border)'}`,
              background: market === m ? (m === 'IN' ? INDIA_COLOR : US_COLOR) + '18' : 'transparent',
              color: market === m ? (m === 'IN' ? INDIA_COLOR : US_COLOR) : 'var(--text-muted)',
            }}>{m === 'US' ? '🇺🇸 US' : m === 'IN' ? '🇮🇳 India' : '⇄'}</button>
          ))}
        </div>
      </div>

      {/* DATA QUALITY LEGEND */}
      <div style={{ display: 'flex', gap: '6px', padding: '5px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['live', 'official', 'modeled', 'synthetic', 'unavailable'] as DataSourceType[]).map(dst => {
          const m = DST_META[dst]
          return (
            <div key={dst} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
              <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: m.color }} />
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{m.label}</span>
            </div>
          )
        })}
        {/* India modeled opt-in */}
        {(market === 'IN' || market === 'COMPARE') && !inAvail?.nseSuccess && (
          <button onClick={() => setAllowModeled(v => !v)} style={{
            marginLeft: 'auto', padding: '4px 10px', borderRadius: '3px', cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
            border: `1px solid ${allowModeled ? '#f0a500' : 'var(--border)'}`,
            background: allowModeled ? 'rgba(240,165,0,0.1)' : 'transparent',
            color: allowModeled ? '#f0a500' : 'var(--text-muted)',
          }}>
            ⚙ {allowModeled ? 'MODELED CURVE ON' : 'ENABLE MODELED CURVE'}
          </button>
        )}
      </div>

      {/* TAB BAR */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '6px 14px', cursor: 'pointer', flexShrink: 0,
            fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', letterSpacing: '0.08em',
            border: 'none', borderBottom: `2px solid ${tab === t.id ? accent : 'transparent'}`,
            background: 'transparent', color: tab === t.id ? accent : 'var(--text-muted)',
            fontWeight: tab === t.id ? 700 : 400, transition: 'all 0.15s',
          }}>{t.label}</button>
        ))}
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        {loading && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
            LOADING FIXED INCOME DATA...
          </div>
        )}

        {/* System messages always visible */}
        {!loading && active?.systemMessages.length ? (
          <SystemMessages messages={active.systemMessages} accentColor={accent} />
        ) : null}

        {/* ── OVERVIEW ────────────────────────────────────────────────────── */}
        {!loading && tab === 'overview' && (
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 }}>
            {(market === 'US' || market === 'COMPARE') && usData && (
              <div>
                {market === 'COMPARE' && <div style={{ fontSize: '11px', color: US_COLOR, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '6px' }}>🇺🇸 US TREASURY</div>}
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <KpiCard label="FED FUNDS RATE %" dp={usData.macroContext.policyRate} color={US_COLOR} note={usData.macroContext.stance} />
                  <KpiCard label="10Y TREASURY %" dp={{ ...usData.yieldCurve.find(p => p.maturityYears >= 9)?.yieldData ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' } }} color={US_COLOR} note="Benchmark" />
                  <KpiCard label="2Y-10Y SPREAD bp" dp={{ ...usData.spreads?.twoTenSpread ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' }, value: usData.spreads?.twoTenSpread.value ?? null }} color={(usData.spreads?.twoTenSpread.value ?? 0) < 0 ? '#ff4560' : '#00c97a'} note={(usData.spreads?.twoTenSpread.value ?? 0) < 0 ? 'INVERTED' : 'NORMAL'} />
                  <KpiCard label="IG OAS bp" dp={usData.spreads?.igOAS ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' }} color="#a78bfa" />
                  <KpiCard label="HY OAS bp" dp={usData.spreads?.hyOAS ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' }} color="#f0a500" />
                </div>
                <div style={{ padding: '10px', background: 'var(--bg-deep)', borderRadius: '5px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    US TREASURY CURVE — {usData.yieldCurve[0]?.yieldData.reportingDate}
                    <DSTBadge dst={usData.curveDataQuality} small />
                    <span style={{ color: '#4a6070' }}>{livePoints.length}/11 live tenors</span>
                  </div>
                  <YieldCurveChart us={usData.yieldCurve} india={[]} mode="US" h={130} />
                </div>
                {usData.signals && market !== 'COMPARE' && (
                  <TradingSignalsBar signals={usData.signals} tips={usData.tips} />
                )}
              </div>
            )}
            {(market === 'IN' || market === 'COMPARE') && inData && (
              <div style={{ marginTop: market === 'COMPARE' ? '6px' : 0 }}>
                {market === 'COMPARE' && <div style={{ fontSize: '11px', color: INDIA_COLOR, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '6px', borderTop: '1px solid var(--border)', paddingTop: '10px' }}>🇮🇳 INDIA G-SEC</div>}
                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <KpiCard label="RBI REPO RATE %" dp={inData.macroContext.policyRate} color={INDIA_COLOR} note={inData.macroContext.stance} />
                  <KpiCard label="10Y G-SEC %" dp={{ ...(inData.yieldCurve.find(p => p.maturityYears >= 9)?.yieldData ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' }) }} color={INDIA_COLOR} note="Benchmark" />
                  <KpiCard label="2Y-10Y SPREAD bp" dp={inData.spreads?.twoTenSpread ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' }} color="#00c97a" />
                  <KpiCard label="10Y vs REPO bp" dp={inData.spreads?.tenYrVsRepo ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' }} color="#38bdf8" note="Term premium" />
                  <KpiCard label="INDIA CPI %" dp={inData.macroContext.cpi} color="#ff6b84" />
                </div>
                {market !== 'COMPARE' && (
                  <div style={{ padding: '10px', background: 'var(--bg-deep)', borderRadius: '5px', border: '1px solid var(--border)' }}>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      INDIA G-SEC CURVE
                      <DSTBadge dst={inData.curveDataQuality} small />
                      {!inAvail?.nseSuccess && !allowModeled && (
                        <span style={{ color: '#ff4560' }}>— NSE UNAVAILABLE</span>
                      )}
                    </div>
                    <YieldCurveChart us={[]} india={inData.yieldCurve} mode="IN" h={130} />
                  </div>
                )}
              </div>
            )}
            {/* Compare mode cross-market */}
            {market === 'COMPARE' && usData && inData && (
              <div style={{ padding: '10px 12px', background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: '5px' }}>
                <div style={{ fontSize: '11px', color: '#a78bfa', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '8px' }}>⇄ CROSS-MARKET</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {[
                    { l:'10Y Yield Differential', v: (() => { const u=usData.yieldCurve.find(p=>p.maturityYears>=9)?.yieldData.value; const i=inData.yieldCurve.find(p=>p.maturityYears>=9)?.yieldData.value; return u&&i?`+${(i-u).toFixed(2)}%`:'N/A' })(), s:'India − US (carry)' },
                    { l:'Policy Rate Spread', v:`${(( inData.macroContext.policyRate.value??6)-(usData.macroContext.policyRate.value??4.25)).toFixed(2)}%`, s:'RBI Repo − Fed Funds' },
                    { l:'Real Rate (US)', v: usData.macroContext.policyRate.value&&usData.macroContext.cpi.value?`${(usData.macroContext.policyRate.value-usData.macroContext.cpi.value).toFixed(2)}%`:'N/A', s:'Fed Funds − CPI' },
                    { l:'Real Rate (India)', v: inData.macroContext.policyRate.value&&inData.macroContext.cpi.value?`${(inData.macroContext.policyRate.value-inData.macroContext.cpi.value).toFixed(2)}%`:'N/A', s:'Repo − CPI' },
                  ].map(({ l, v, s }) => (
                    <div key={l} style={{ padding: '8px', background: 'var(--bg-deep)', borderRadius: '4px' }}>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{l}</div>
                      <div style={{ fontSize: '18px', fontWeight: 900, fontFamily: 'Syne, sans-serif', color: '#fff', lineHeight: 1.2 }}>{v}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '2px' }}>{s}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── YIELD CURVE ─────────────────────────────────────────────────── */}
        {!loading && tab === 'curve' && (
          <div style={{ padding: '10px 14px', flex: 1 }}>
            <div style={{ padding: '10px', background: 'var(--bg-deep)', borderRadius: '5px', border: '1px solid var(--border)', marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {market === 'COMPARE' ? 'US TREASURY vs INDIA G-SEC' : market === 'US' ? 'US TREASURY YIELD CURVE' : 'INDIA G-SEC YIELD CURVE'}
                <DSTBadge dst={active?.curveDataQuality ?? 'unavailable'} small />
              </div>
              <YieldCurveChart us={usData?.yieldCurve ?? []} india={inData?.yieldCurve ?? []} mode={market} h={190} />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', minWidth: '520px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['TENOR','MAT','YIELD','vs 2Y','SOURCE','QUALITY'].map(h => (
                      <th key={h} style={{ padding: '5px 8px', textAlign: h === 'TENOR' || h === 'SOURCE' || h === 'QUALITY' ? 'left' : 'right', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em', background: 'var(--bg-deep)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(active?.yieldCurve ?? []).map(p => {
                    const twoY   = active?.yieldCurve.find(x => Math.abs(x.maturityYears - 2) < 0.5)?.yieldData.value
                    const vs2Y   = twoY != null && p.yieldData.value != null ? Math.round((p.yieldData.value - twoY) * 100) : null
                    const m      = DST_META[p.yieldData.dataSourceType]
                    return (
                      <tr key={p.tenor} style={{ borderBottom: '1px solid var(--border)' }} title={`Source: ${p.yieldData.source}${p.yieldData.notes ? ' — ' + p.yieldData.notes : ''}`}>
                        <td style={{ padding: '6px 8px', fontWeight: 700, color: accent }}>{p.tenor}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--text-muted)' }}>{p.maturityYears < 1 ? `${Math.round(p.maturityYears * 365)}D` : `${p.maturityYears.toFixed(1)}Y`}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: p.yieldData.value != null ? (p.yieldData.value >= 7 ? '#ff4560' : '#00c97a') : '#4a6070' }}>
                          {p.yieldData.value != null ? `${p.yieldData.value.toFixed(3)}%` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', color: vs2Y != null ? (vs2Y > 0 ? '#00c97a' : '#ff4560') : '#4a6070' }}>
                          {vs2Y != null ? `${vs2Y > 0 ? '+' : ''}${vs2Y}bp` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px', fontSize: '10px', color: 'var(--text-muted)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.yieldData.source}
                        </td>
                        <td style={{ padding: '6px 8px' }}><DSTBadge dst={p.yieldData.dataSourceType} small /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── BONDS ───────────────────────────────────────────────────────── */}
        {!loading && tab === 'bonds' && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <BondTable
              bonds={market === 'COMPARE'
                ? [...(usData?.bonds ?? []), ...(inData?.bonds ?? [])]
                : (active?.bonds ?? [])}
              market={market}
            />
          </div>
        )}

        {/* ── SPREADS ─────────────────────────────────────────────────────── */}
        {!loading && tab === 'spreads' && (
          <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {(market === 'US' || market === 'COMPARE') && usData?.spreads && (
              <div>
                <div style={{ fontSize: '11px', color: US_COLOR, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '8px' }}>🇺🇸 US CREDIT SPREADS</div>
                <div style={{ padding: '10px 14px', background: 'var(--bg-deep)', borderRadius: '5px', border: '1px solid var(--border)' }}>
                  <SpreadBar label="IG OAS"        dp={usData.spreads.igOAS}        maxBps={300} />
                  <SpreadBar label="HY OAS"        dp={usData.spreads.hyOAS}        maxBps={900} />
                  <SpreadBar label="BBB OAS"       dp={usData.spreads.bbbSpread}    maxBps={400} />
                  <SpreadBar label="2Y-10Y Spread" dp={usData.spreads.twoTenSpread} maxBps={200} />
                </div>
              </div>
            )}
            {(market === 'IN' || market === 'COMPARE') && inData?.spreads && (
              <div>
                <div style={{ fontSize: '11px', color: INDIA_COLOR, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '8px', borderTop: market === 'COMPARE' ? '1px solid var(--border)' : 'none', paddingTop: market === 'COMPARE' ? '10px' : 0 }}>🇮🇳 INDIA G-SEC SPREADS</div>
                <div style={{ padding: '10px 14px', background: 'var(--bg-deep)', borderRadius: '5px', border: '1px solid var(--border)' }}>
                  <SpreadBar label="2Y-10Y G-Sec"  dp={inData.spreads.twoTenSpread}              maxBps={200} />
                  <SpreadBar label="10Y vs Repo"   dp={inData.spreads.tenYrVsRepo  ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' }} maxBps={300} />
                  <SpreadBar label="SDL vs G-Sec"  dp={inData.spreads.sdlSpread   ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' }} maxBps={120} />
                  <SpreadBar label="PSU vs G-Sec"  dp={inData.spreads.psuSpread   ?? { value: null, source:'', dataSourceType:'unavailable', fetchedAt:'' }} maxBps={100} />
                </div>
                <div style={{ marginTop: '8px', padding: '8px 12px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', background: 'rgba(74,96,112,0.08)', border: '1px solid rgba(74,96,112,0.15)', borderRadius: '4px', lineHeight: 1.7 }}>
                  ⚠ SDL and AAA PSU spreads are not available from any free real-time source. CCIL, Bloomberg, or NSE BOND required for live spread data. Historical ranges: SDL ~40-70bps, AAA PSU ~30-55bps over G-Sec.
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* FOOTER */}
      <div style={{ padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0, fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>US: FRED Treasury + ICE BofA · IN: NSE India → RBI DBIE → Official table · Quant: NR-YTM · Duration · Convexity · NS-curve</span>
        {active && <span>{new Date(active.fetchedAt).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
    </div>
  )
}