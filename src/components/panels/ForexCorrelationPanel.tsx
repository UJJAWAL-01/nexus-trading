'use client'

import { useState } from 'react'
import { useTradingContext } from '@/components/trading/TradingContext'

// ── Static correlation data ───────────────────────────────────────────────────

const PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'BTC/USD', 'XAU/USD']

const MATRIX: number[][] = [
  [ 1.00,  0.84, -0.73, -0.91,  0.21,  0.45],
  [ 0.84,  1.00, -0.61, -0.79,  0.18,  0.38],
  [-0.73, -0.61,  1.00,  0.72, -0.12, -0.55],
  [-0.91, -0.79,  0.72,  1.00, -0.19, -0.62],
  [ 0.21,  0.18, -0.12, -0.19,  1.00,  0.15],
  [ 0.45,  0.38, -0.55, -0.62,  0.15,  1.00],
]

function cellBg(v: number): string {
  if (v === 1)    return 'rgba(255,255,255,0.03)'
  if (v >= 0.70)  return 'rgba(0,201,122,0.20)'
  if (v >= 0.40)  return 'rgba(0,201,122,0.10)'
  if (v >= 0.10)  return 'rgba(0,201,122,0.04)'
  if (v >= -0.10) return 'transparent'
  if (v >= -0.40) return 'rgba(255,69,96,0.06)'
  if (v >= -0.70) return 'rgba(255,69,96,0.12)'
  return 'rgba(211,47,47,0.20)'
}

function cellColor(v: number): string {
  if (v === 1)    return 'var(--text-dim)'
  if (v >= 0.70)  return '#00c853'
  if (v >= 0.40)  return '#86efac'
  if (v >= 0.10)  return 'var(--text-2)'
  if (v >= -0.10) return 'var(--text-muted)'
  if (v >= -0.40) return '#fca5a5'
  if (v >= -0.70) return 'var(--negative)'
  return '#d32f2f'
}

function strengthLabel(v: number): string {
  if (v === 1) return 'Self'
  const a = Math.abs(v)
  if (a >= 0.70) return v > 0 ? 'Strong Positive' : 'Strong Negative'
  if (a >= 0.40) return v > 0 ? 'Moderate Positive' : 'Moderate Negative'
  if (a >= 0.10) return v > 0 ? 'Weak Positive' : 'Weak Negative'
  return 'Neutral'
}

// ── Cell with hover tooltip ───────────────────────────────────────────────────

function Cell({ v }: { v: number }) {
  const [hover, setHover] = useState(false)
  return (
    <td style={{ padding: 0, border: '1px solid var(--border)', background: cellBg(v), cursor: 'default', position: 'relative', textAlign: 'center' }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div style={{ padding: '7px 6px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: cellColor(v) }}>
        {v === 1 ? '—' : v.toFixed(2)}
      </div>
      {hover && v !== 1 && (
        <div style={{
          position: 'absolute', zIndex: 50, top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 3,
          background: 'var(--bg-panel)', border: '1px solid var(--border-br)', borderRadius: 5,
          padding: '4px 8px', fontSize: 10, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace',
          whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 6px 20px rgba(0,0,0,0.7)',
        }}>
          {strengthLabel(v)}
        </div>
      )}
    </td>
  )
}

// ── Exposure warnings ─────────────────────────────────────────────────────────

function Warnings({ openPairs }: { openPairs: string[] }) {
  const warns: string[] = []
  for (let i = 0; i < openPairs.length; i++) {
    for (let j = i + 1; j < openPairs.length; j++) {
      const pi = PAIRS.indexOf(openPairs[i]), pj = PAIRS.indexOf(openPairs[j])
      if (pi === -1 || pj === -1) continue
      const c = Math.abs(MATRIX[pi][pj])
      if (c >= 0.80) warns.push(`${openPairs[i]} and ${openPairs[j]} are ${(c * 100).toFixed(0)}% correlated — you may have double exposure.`)
    }
  }
  if (!warns.length) return null
  return (
    <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--border)' }}>
      {warns.map((w, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 10px', background: 'rgba(240,165,0,0.08)', border: '1px solid rgba(240,165,0,0.25)', borderRadius: 4, fontSize: 11, color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5, marginBottom: i < warns.length - 1 ? 4 : 0 }}>
          <span>⚠</span><span>{w}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function ForexCorrelationPanel() {
  const { openPositions } = useTradingContext()
  const openPairs = openPositions.map(p => p.pair)

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" style={{ background: 'var(--info)' }} />
        FX CORRELATION MATRIX
        <span className="panel-header-sub">30-day rolling · 6 pairs</span>
      </div>

      <Warnings openPairs={openPairs} />

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', padding: '10px 14px' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ padding: '6px 8px', fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'left', border: '1px solid var(--border)' }}>Pair</th>
              {PAIRS.map(p => (
                <th key={p} style={{ padding: '6px 8px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.015)' }}>
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAIRS.map((row, ri) => (
              <tr key={row}>
                <td style={{ padding: '7px 8px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.015)' }}>
                  {row}
                  {openPairs.includes(row) && (
                    <span style={{ marginLeft: 6, fontSize: 8, fontWeight: 700, color: 'var(--positive)', background: 'rgba(0,201,122,0.15)', border: '1px solid rgba(0,201,122,0.3)', padding: '1px 4px', borderRadius: 2 }}>
                      OPEN
                    </span>
                  )}
                </td>
                {PAIRS.map((_, ci) => <Cell key={ci} v={MATRIX[ri][ci]} />)}
              </tr>
            ))}
          </tbody>
        </table>

        {/* Legend */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
          {[['#00c853', 'Strong Positive (>0.70)'], ['#86efac', 'Moderate Positive'], ['var(--text-dim)', 'Neutral'], ['#fca5a5', 'Moderate Negative'], ['#d32f2f', 'Strong Negative (<−0.70)']].map(([c, l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: c, border: '1px solid var(--border)', display: 'inline-block' }} />{l}
            </span>
          ))}
        </div>
        <p style={{ marginTop: 6, fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5 }}>
          Values above ±0.80 indicate significant co-movement. Open positions flagged automatically.
        </p>
      </div>
    </div>
  )
}
