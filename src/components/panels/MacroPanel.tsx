'use client'

import { useEffect, useState } from 'react'

interface MacroIndicator {
  label:    string
  unit:     string
  color:    string
  desc:     string
  current:  number
  previous: number
  change:   number
  date:     string
  history:  { date: string; value: number }[]
}

interface MacroData {
  macro:     Record<string, MacroIndicator>
  timestamp: string
}

// ── Mini SVG sparkline ────────────────────────────────────────────────────────

function Sparkline({ data, color, width = 56, height = 22 }: {
  data: number[]; color: string; width?: number; height?: number
}) {
  if (data.length < 2) return <div style={{ width, height }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const rng = max - min || 0.001
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / rng) * (height - 4) - 2
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  // Trend colour: if last value > first → positive, else negative
  const lineColor = data[data.length - 1] > data[0] ? 'var(--positive)' : 'var(--negative)'

  return (
    <svg
      width={width}
      height={height}
      style={{ overflow: 'visible', flexShrink: 0 }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ── Yield curve label ─────────────────────────────────────────────────────────

function yieldCurveLabel(spread: number) {
  if (spread > 1.0)  return { label: 'NORMAL',        color: 'var(--positive)' }
  if (spread > 0.25) return { label: 'FLAT',           color: 'var(--amber)'    }
  if (spread > -0.5) return { label: 'INVERTED',       color: 'var(--negative)' }
                     return { label: 'DEEPLY INVERTED',color: '#ff1f3d'         }
}

// ── CPI label ─────────────────────────────────────────────────────────────────

function cpiLabel(v: number) {
  if (v < 2)   return { label: 'DEFLATIONARY', color: '#1e90ff'    }
  if (v < 2.5) return { label: 'TARGET',       color: 'var(--positive)' }
  if (v < 4)   return { label: 'ELEVATED',     color: 'var(--amber)'   }
  if (v < 6)   return { label: 'HIGH',         color: 'var(--negative)' }
               return { label: 'CRISIS',       color: '#ff1f3d'    }
}

// ── MacroPanel ────────────────────────────────────────────────────────────────

export default function MacroPanel() {
  const [data,    setData]    = useState<MacroData | null>(null)
  const [loading, setLoading] = useState(true)
  const [noKey,   setNoKey]   = useState(false)

  const fetchMacro = async () => {
    try {
      const res  = await fetch('/api/fred')
      const json = await res.json()
      if (json.macro && Object.keys(json.macro).length > 0) {
        setData(json)
        setNoKey(false)
      } else {
        setNoKey(true)
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    fetchMacro()
    const t = setInterval(fetchMacro, 300_000)
    return () => clearInterval(t)
  }, [])

  const entries = data ? Object.entries(data.macro) : []

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#1e90ff' }} />
          MACRO MONITOR
        </div>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          FRED · LIVE
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
            FETCHING FRED DATA...
          </div>
        )}
        {!loading && noKey && (
          <div style={{ padding: '14px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6 }}>
            <div style={{ color: 'var(--amber)', marginBottom: '6px' }}>⚠ FRED_API_KEY missing</div>
            Get a free key at fred.stlouisfed.org and add it to your .env.local / Vercel env vars.
          </div>
        )}
        {!loading && !noKey && entries.map(([sid, ind]) => {
          const isYC  = sid === 'T10Y2Y'
          const isCPI = sid === 'CPIAUCSL'
          const badge = isYC  ? yieldCurveLabel(ind.current) :
                        isCPI ? cpiLabel(ind.current) : null
          const chgPos = ind.change >= 0
          const histVals = (ind.history ?? []).map(h => h.value)

          return (
            <div
              key={sid}
              title={ind.desc}
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid var(--border)',
                display: 'grid',
                gridTemplateColumns: '1fr 56px auto',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              {/* Label + date + badge */}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: 'Syne, sans-serif', fontWeight: 600,
                  fontSize: '11px', color: '#fff', marginBottom: '2px',
                  display: 'flex', alignItems: 'center', gap: '5px',
                }}>
                  {ind.label}
                  {badge && (
                    <span style={{
                      fontSize: '8px', padding: '1px 4px', borderRadius: '2px',
                      fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em',
                      background: badge.color + '18', color: badge.color,
                      border: `1px solid ${badge.color}30`,
                    }}>
                      {badge.label}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {ind.date}
                </div>
              </div>

              {/* Sparkline */}
              <Sparkline data={histVals} color={ind.color} />

              {/* Value + change */}
              <div style={{ textAlign: 'right', minWidth: '60px' }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '13px',
                  fontWeight: 700, color: ind.color,
                }}>
                  {sid === 'DEXINUS'
                    ? ind.current.toFixed(2)
                    : ind.current.toFixed(2) + ind.unit}
                </div>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
                  color: chgPos ? 'var(--positive)' : 'var(--negative)',
                }}>
                  {chgPos ? '+' : ''}{ind.change.toFixed(2)}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}