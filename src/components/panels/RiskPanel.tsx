'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTradingContext } from '@/components/trading/TradingContext'

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcPositionSize(balance: number, riskPct: number, entry: number, sl: number): number {
  if (entry === 0 || sl === 0 || entry === sl) return 0
  return (balance * (riskPct / 100)) / Math.abs(entry - sl)
}

function calcPips(entry: number, sl: number, pair: string): number {
  const pip = pair.includes('JPY') || pair.includes('XAU') || pair.includes('XAG') ? 0.01 : 0.0001
  return Math.abs(entry - sl) / pip
}

function calcRR(entry: number, sl: number, tp: number): number {
  if (entry === sl) return 0
  return Math.abs(tp - entry) / Math.abs(entry - sl)
}

function riskColor(pct: number): string {
  if (pct <= 1.5) return 'var(--positive)'
  if (pct <= 3.0) return 'var(--amber)'
  return 'var(--negative)'
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span
      style={{ position: 'relative', display: 'inline-block', marginLeft: 4, cursor: 'help', verticalAlign: 'middle' }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>ⓘ</span>
      {show && (
        <span style={{
          position: 'absolute', zIndex: 50, left: 16, top: -4,
          width: 220, background: 'var(--bg-panel)', border: '1px solid var(--border-br)',
          color: 'var(--text-2)', fontSize: 11, borderRadius: 6, padding: '6px 10px',
          fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6,
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)', whiteSpace: 'pre-wrap', pointerEvents: 'none',
        }}>
          {text}
        </span>
      )}
    </span>
  )
}

// ── Risk Gauge ────────────────────────────────────────────────────────────────

function RiskGauge({ riskPct }: { riskPct: number }) {
  const clamped = Math.min(riskPct, 5)
  const angle   = (clamped / 5) * 180
  const rad     = (angle - 180) * (Math.PI / 180)
  const r = 60, cx = 80, cy = 80
  const nx = cx + r * Math.cos(rad), ny = cy + r * Math.sin(rad)
  const color = riskColor(riskPct)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width="160" height="90" viewBox="0 0 160 90">
        <path d="M20,80 A60,60 0 0,1 140,80" fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round" />
        <path d="M20,80 A60,60 0 0,1 62,26"  fill="none" stroke="var(--positive)" strokeWidth="10" strokeLinecap="round" strokeOpacity="0.25" />
        <path d="M62,26 A60,60 0 0,1 101,26" fill="none" stroke="var(--amber)"    strokeWidth="10" strokeLinecap="round" strokeOpacity="0.25" />
        <path d="M101,26 A60,60 0 0,1 140,80" fill="none" stroke="var(--negative)" strokeWidth="10" strokeLinecap="round" strokeOpacity="0.25" />
        {riskPct > 0 && (
          <path d={`M20,80 A60,60 0 0,1 ${nx.toFixed(1)},${ny.toFixed(1)}`}
            fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
        )}
        <line x1={cx} y1={cy} x2={(cx + 50 * Math.cos(rad)).toFixed(1)} y2={(cy + 50 * Math.sin(rad)).toFixed(1)}
          stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="4" fill={color} />
        <text x="13" y="92" fontSize="9" fill="var(--text-dim)" fontFamily="JetBrains Mono, monospace">0%</text>
        <text x="68" y="18" fontSize="9" fill="var(--text-dim)" fontFamily="JetBrains Mono, monospace">2.5%</text>
        <text x="130" y="92" fontSize="9" fill="var(--text-dim)" fontFamily="JetBrains Mono, monospace">5%</text>
      </svg>
      <div>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, color, lineHeight: 1 }}>
          {riskPct.toFixed(1)}%
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 4 }}>
          risk
        </span>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        {[['var(--positive)', 'Safe ≤1.5%'], ['var(--amber)', 'Caution'], ['var(--negative)', 'High >3%']].map(([c, l]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: c, display: 'inline-block' }} />{l}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Daily Drawdown Tracker ────────────────────────────────────────────────────

function DailyDrawdownTracker({ balance }: { balance: number }) {
  const [dailyPnL,   setDailyPnL]   = useState(0)
  const dailyLimit = balance * 0.05
  const used       = Math.abs(Math.min(0, dailyPnL))
  const pct        = dailyLimit > 0 ? Math.min((used / dailyLimit) * 100, 100) : 0
  const isOver     = pct >= 100
  const isWarn     = pct >= 80 && !isOver
  const barColor   = isOver ? 'var(--negative)' : isWarn ? 'var(--amber)' : 'var(--positive)'

  return (
    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Daily Drawdown Tracker
        </span>
        <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: dailyPnL >= 0 ? 'var(--positive)' : 'var(--negative)', fontWeight: 600 }}>
          {dailyPnL >= 0 ? '+' : ''}{dailyPnL.toFixed(2)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', marginBottom: 4 }}>
        <span>${used.toFixed(0)} used of ${dailyLimit.toFixed(0)}</span>
        <span style={{ color: barColor }}>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ width: '100%', height: 6, background: 'var(--bg-deep)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: barColor, borderRadius: 3, transition: 'width 0.5s' }} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        {[['−$100', () => setDailyPnL(p => p - 100)], ['+$100', () => setDailyPnL(p => p + 100)], ['Reset', () => setDailyPnL(0)]].map(([label, fn]) => (
          <button key={label as string} onClick={fn as () => void}
            className="nx-btn" style={{ padding: '2px 8px', fontSize: 10 }}>
            {label as string}
          </button>
        ))}
      </div>
      {isOver && (
        <div style={{
          position: 'absolute', inset: 0, background: 'rgba(255,69,96,0.08)',
          border: '1px solid rgba(255,69,96,0.4)', borderRadius: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2,
        }}>
          <span style={{ color: 'var(--negative)', fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 13, letterSpacing: '0.1em' }}>
            ⛔ DAILY LIMIT REACHED
          </span>
          <span style={{ color: 'var(--negative)', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>
            Stop trading for today
          </span>
        </div>
      )}
    </div>
  )
}

// ── Input ─────────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border-br)',
  borderRadius: 4, padding: '6px 10px', fontSize: 12,
  fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)',
  outline: 'none', boxSizing: 'border-box',
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function RiskPanel() {
  const { accountBalance, settings } = useTradingContext()
  const [balance,   setBalance]   = useState(accountBalance)
  const [riskPct,   setRiskPct]   = useState(settings.defaultRisk)
  const [entry,     setEntry]     = useState('')
  const [sl,        setSl]        = useState('')
  const [tp,        setTp]        = useState('')
  const [assetType, setAssetType] = useState<'forex' | 'crypto'>('forex')
  const [direction, setDirection] = useState<'long' | 'short'>('long')
  const [pair,      setPair]      = useState('EUR/USD')

  useEffect(() => { setBalance(accountBalance) }, [accountBalance])
  useEffect(() => { setRiskPct(settings.defaultRisk) }, [settings.defaultRisk])
  useEffect(() => { setPair(assetType === 'forex' ? 'EUR/USD' : 'BTC/USD') }, [assetType])

  const entryN = Number(entry), slN = Number(sl), tpN = Number(tp)
  const dollarRisk   = balance * (riskPct / 100)
  const posSize      = entry && sl ? calcPositionSize(balance, riskPct, entryN, slN) : 0
  const pipsAtRisk   = entry && sl ? calcPips(entryN, slN, pair) : 0
  const rr           = entry && sl && tp ? calcRR(entryN, slN, tpN) : 0
  const color        = riskColor(riskPct)

  const FOREX_PAIRS  = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/USD', 'USD/CAD', 'XAU/USD', 'XAG/USD']
  const CRYPTO_PAIRS = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'BNB/USD']
  const pairOptions  = assetType === 'forex' ? FOREX_PAIRS : CRYPTO_PAIRS

  const row = (label: string, value: string, tip: string, highlight?: boolean) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center' }}>
        {label}<Tip text={tip} />
      </span>
      <span style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: highlight ? 'var(--positive)' : 'var(--text)' }}>
        {value}
      </span>
    </div>
  )

  const labelStyle: React.CSSProperties = { fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" style={{ background: 'var(--positive)' }} />
        FX RISK CALCULATOR
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Grid inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label>
            <span style={labelStyle}>Account Balance<Tip text="Total equity for risk calculations." /></span>
            <input type="number" value={balance} onChange={e => setBalance(Number(e.target.value))} style={inputStyle} />
          </label>

          <label>
            <span style={labelStyle}>Asset Type</span>
            <div style={{ display: 'flex', border: '1px solid var(--border-br)', borderRadius: 4, overflow: 'hidden' }}>
              {(['forex', 'crypto'] as const).map(t => (
                <button key={t} onClick={() => setAssetType(t)} style={{
                  flex: 1, padding: '6px 0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                  cursor: 'pointer', border: 'none', textTransform: 'capitalize',
                  background: assetType === t ? 'rgba(0,229,192,0.18)' : 'var(--bg-deep)',
                  color: assetType === t ? 'var(--teal)' : 'var(--text-muted)',
                  borderRight: t === 'forex' ? '1px solid var(--border-br)' : 'none',
                }}>{t}</button>
              ))}
            </div>
          </label>

          <label>
            <span style={labelStyle}>Pair</span>
            <select value={pair} onChange={e => setPair(e.target.value)} style={{ ...inputStyle }}>
              {pairOptions.map(p => <option key={p} value={p} style={{ background: 'var(--bg-panel)' }}>{p}</option>)}
            </select>
          </label>

          <label>
            <span style={labelStyle}>Direction</span>
            <div style={{ display: 'flex', border: '1px solid var(--border-br)', borderRadius: 4, overflow: 'hidden' }}>
              {(['long', 'short'] as const).map(d => (
                <button key={d} onClick={() => setDirection(d)} style={{
                  flex: 1, padding: '6px 0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                  cursor: 'pointer', border: 'none',
                  background: direction === d ? (d === 'long' ? 'rgba(0,201,122,0.18)' : 'rgba(255,69,96,0.18)') : 'var(--bg-deep)',
                  color: direction === d ? (d === 'long' ? 'var(--positive)' : 'var(--negative)') : 'var(--text-muted)',
                  borderRight: d === 'long' ? '1px solid var(--border-br)' : 'none',
                }}>
                  {d === 'long' ? '▲ Long' : '▼ Short'}
                </button>
              ))}
            </div>
          </label>

          <label>
            <span style={labelStyle}>Entry Price<Tip text="Price you enter the trade." /></span>
            <input type="number" value={entry} placeholder="0.00000" onChange={e => setEntry(e.target.value)} style={inputStyle} />
          </label>

          <label>
            <span style={labelStyle}>Stop Loss<Tip text="Risk = |Entry − SL|" /></span>
            <input type="number" value={sl} placeholder="0.00000" onChange={e => setSl(e.target.value)} style={inputStyle} />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            <span style={labelStyle}>Take Profit — optional, for R:R<Tip text="R:R = |TP − Entry| / |Entry − SL|" /></span>
            <input type="number" value={tp} placeholder="0.00000" onChange={e => setTp(e.target.value)} style={inputStyle} />
          </label>
        </div>

        {/* Risk % slider */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ ...labelStyle, marginBottom: 0, display: 'flex', alignItems: 'center' }}>Risk %<Tip text="Dollar Risk = Balance × Risk%" /></span>
            <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 16, color }}>{riskPct.toFixed(1)}%</span>
          </div>
          <input type="range" min="0.5" max="5" step="0.1" value={riskPct}
            onChange={e => setRiskPct(Number(e.target.value))}
            style={{ width: '100%', accentColor: color }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', marginTop: 2 }}>
            <span>0.5%</span><span>2.5%</span><span>5.0%</span>
          </div>
        </div>

        {/* Gauge + results side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div style={{ background: 'var(--bg-deep)', borderRadius: 6, padding: '10px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
              Risk Gauge
            </span>
            <RiskGauge riskPct={riskPct} />
          </div>

          <div style={{ background: 'var(--bg-deep)', borderRadius: 6, padding: '10px 12px' }}>
            <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4, display: 'block' }}>
              Calculated
            </span>
            {row('Dollar Risk', `$${dollarRisk.toFixed(2)}`, 'Dollar Risk = Balance × Risk%')}
            {row('Position Size',
              posSize > 0
                ? assetType === 'forex'
                  ? (pair.includes('XAU') || pair.includes('XAG'))
                    ? `${posSize.toFixed(2)} oz`
                    : `${(posSize / 100000).toFixed(2)} lots`
                  : `${posSize.toFixed(4)} units`
                : '—',
              'Position Size = (Balance × Risk%) / |Entry − SL|')}
            {assetType === 'forex' && !pair.includes('XAU') && !pair.includes('XAG') && row('Pips at Risk',
              pipsAtRisk > 0 ? `${pipsAtRisk.toFixed(1)} pips` : '—',
              'Pips = |Entry − SL| / 0.0001')}
            {row('R:R Ratio',
              rr > 0 ? `1 : ${rr.toFixed(2)}` : tp ? '—' : 'Enter TP',
              'R:R = |TP − Entry| / |Entry − SL|', rr >= 2)}
          </div>
        </div>
      </div>

      <DailyDrawdownTracker balance={balance} />
    </div>
  )
}
