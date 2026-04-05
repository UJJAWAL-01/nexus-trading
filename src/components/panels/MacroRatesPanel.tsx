'use client'

import { useEffect, useState } from 'react'

type Mode = 'FED' | 'RBI'

// ── Static policy data (update as rates change) ───────────────────────────

const FOMC_2026 = [
  'Jan 27–28', 'Mar 17–18', 'May 5–6',
  'Jun 16–17', 'Jul 28–29', 'Sep 15–16',
  'Oct 27–28', 'Dec 8–9',
]

const RBI_MPC_2026 = [
  'Apr 7–9 ←', 'Jun 2026', 'Aug 2026',
  'Oct 2026',  'Dec 2026', 'Feb 2027',
]

function getNextMeeting(meetings: string[]): string {
  // Return first meeting that doesn't have a ← marker (already happened) — simplified
  const now = new Date()
  const month = now.getMonth() // 0-indexed
  // Use index as fallback
  return meetings.find(m => !m.includes('past')) ?? meetings[0] ?? '—'
}

interface FredObs { date: string; value: string }

// ── Component ─────────────────────────────────────────────────────────────

export default function MacroRatesPanel() {
  const [mode,        setMode]        = useState<Mode>('FED')
  const [fedRate,     setFedRate]     = useState<number | null>(null)
  const [fedBalance,  setFedBalance]  = useState<string | null>(null)
  const [fedPCE,      setFedPCE]      = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)

  // Fetch FRED data for FED panel
  const fetchFedData = async () => {
    setLoading(true)
    try {
      const [rateRes, balRes, pceRes] = await Promise.all([
        fetch('/api/fred?series=FEDFUNDS'),
        fetch('/api/fred?series=WALCL'),
        fetch('/api/fred?series=PCEPI'),
      ])

      const rateData = await rateRes.json()
      const balData  = await balRes.json()
      const pceData  = await pceRes.json()

      const latestRate = rateData?.observations?.[0]
      if (latestRate && latestRate.value !== '.') {
        setFedRate(parseFloat(latestRate.value))
      }

      const latestBal = balData?.observations?.[0]
      if (latestBal && latestBal.value !== '.') {
        const t = (parseFloat(latestBal.value) / 1_000_000).toFixed(2)
        setFedBalance(`$${t}T`)
      }

      const latestPCE = pceData?.observations?.[0]
      if (latestPCE && latestPCE.value !== '.') {
        setFedPCE(latestPCE.value + '%')
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    fetchFedData()
  }, [])

  // ── FED data rows ─────────────────────────────────────────────────────
  const fedRows = [
    { label: 'Fed Funds Rate',   value: fedRate != null ? `${fedRate.toFixed(2)}%` : '···', color: 'var(--teal)' },
    { label: 'Target Band',      value: fedRate != null ? `${(fedRate - 0.25).toFixed(2)}–${(fedRate).toFixed(2)}%` : '···', color: 'var(--text-2)' },
    { label: 'Balance Sheet',    value: fedBalance ?? '···', color: 'var(--text-2)' },
    { label: 'QT Pace',          value: '$60B / mo', color: 'var(--negative)' },
    { label: 'PCE Inflation',    value: fedPCE ?? '···', color: '#f0a500' },
    { label: 'Inflation Target', value: '2.00%', color: 'var(--text-muted)' },
  ]

  // ── RBI data rows (semi-static — update as RBI meets) ─────────────────
  const rbiRows = [
    { label: 'Repo Rate',         value: '5.25%',  color: '#f97316' },
    { label: 'Reverse Repo',      value: '3.35%',  color: 'var(--text-2)' },
    { label: 'CRR',               value: '4.00%',  color: 'var(--text-2)' },
    { label: 'SLR',               value: '18.00%', color: 'var(--text-2)' },
    { label: 'CPI Inflation',     value: '~4.8%',  color: '#f0a500' },
    { label: 'Inflation Target',  value: '4.00%',  color: 'var(--text-muted)' },
  ]

  const rows = mode === 'FED' ? fedRows : rbiRows

  const fedStance  = { label: 'DATA DEPENDENT', color: '#f0a500' }
  const rbiStance  = { label: 'ACCOMMODATIVE',  color: 'var(--positive)' }
  const stance     = mode === 'FED' ? fedStance : rbiStance

  const primaryColor = mode === 'FED' ? 'var(--teal)' : '#f97316'
  const primaryRate  = mode === 'FED'
    ? (fedRate != null ? `${fedRate.toFixed(2)}%` : '···')
    : '5.25%'
  const lastChange   = mode === 'FED' ? '−25bps · Dec 2024' : '0 bps · Feb 2025'
  const nextMeeting  = mode === 'FED'
    ? (FOMC_2026.find(m => true) ?? 'TBD')
    : RBI_MPC_2026[0]
  const meetings     = mode === 'FED' ? FOMC_2026 : RBI_MPC_2026

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Header with FED/RBI toggle */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" />
          MACRO RATES
        </div>

        <div style={{ display: 'flex', gap: '3px' }}>
          {(['FED', 'RBI'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding:       '3px 14px',
                borderRadius:  '3px',
                cursor:        'pointer',
                fontFamily:    'JetBrains Mono, monospace',
                fontSize:      '11px',
                letterSpacing: '0.08em',
                fontWeight:    700,
                border:        `1px solid ${mode === m
                  ? (m === 'FED' ? 'var(--teal)' : '#f97316')
                  : 'var(--border)'}`,
                background:    mode === m
                  ? (m === 'FED' ? 'rgba(0,229,192,0.12)' : 'rgba(249,115,22,0.12)')
                  : 'transparent',
                color:         mode === m
                  ? (m === 'FED' ? 'var(--teal)' : '#f97316')
                  : 'var(--text-muted)',
                transition:    'all 0.15s',
              }}
            >
              {m === 'FED' ? '🇺🇸' : '🇮🇳'} {m}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Hero rate card */}
        <div style={{
          margin:     '12px 14px',
          padding:    '14px',
          background: `${primaryColor}0d`,
          border:     `1px solid ${primaryColor}25`,
          borderRadius: '6px',
          display:    'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              fontSize:      '9px',
              color:         'var(--text-muted)',
              fontFamily:    'JetBrains Mono, monospace',
              letterSpacing: '0.12em',
              marginBottom:  '6px',
            }}>
              {mode === 'FED' ? 'EFFECTIVE FED FUNDS RATE' : 'RBI REPO RATE'}
            </div>
            <div style={{
              fontFamily:  'Syne, sans-serif',
              fontWeight:  800,
              fontSize:    '36px',
              color:       primaryColor,
              lineHeight:  1,
            }}>
              {loading && mode === 'FED' ? '···' : primaryRate}
            </div>
            <div style={{
              fontSize:   '10px',
              color:      'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
              marginTop:  '5px',
            }}>
              Last change: {lastChange}
            </div>
          </div>

          <div style={{
            display:       'flex',
            flexDirection: 'column',
            alignItems:    'flex-end',
            gap:           '6px',
          }}>
            <div style={{
              padding:       '4px 12px',
              borderRadius:  '3px',
              fontSize:      '10px',
              fontFamily:    'JetBrains Mono, monospace',
              fontWeight:    700,
              letterSpacing: '0.06em',
              background:    `${stance.color}18`,
              color:         stance.color,
              border:        `1px solid ${stance.color}35`,
            }}>
              {stance.label}
            </div>
            <div style={{
              fontSize:   '9px',
              color:      'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
              textAlign:  'right',
            }}>
              Next: {nextMeeting}
            </div>
          </div>
        </div>

        {/* Data rows */}
        {rows.map(row => (
          <div key={row.label} style={{
            display:        'flex',
            justifyContent: 'space-between',
            alignItems:     'center',
            padding:        '8px 14px',
            borderBottom:   '1px solid var(--border)',
          }}>
            <span style={{
              fontSize:   '11px',
              color:      'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {row.label}
            </span>
            <span style={{
              fontSize:   '12px',
              fontFamily: 'JetBrains Mono, monospace',
              fontWeight: 600,
              color:      row.color,
            }}>
              {row.value}
            </span>
          </div>
        ))}

        {/* Meeting schedule */}
        <div style={{ padding: '10px 14px' }}>
          <div style={{
            fontSize:      '8px',
            color:         'var(--text-muted)',
            fontFamily:    'JetBrains Mono, monospace',
            letterSpacing: '0.12em',
            marginBottom:  '8px',
          }}>
            {mode === 'FED' ? 'FOMC 2026 SCHEDULE' : 'RBI MPC 2026 SCHEDULE'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {meetings.map((m, i) => {
              const isCurrent = i === 0 // first upcoming
              return (
                <span key={m} style={{
                  fontSize:      '9px',
                  padding:       '3px 8px',
                  borderRadius:  '2px',
                  fontFamily:    'JetBrains Mono, monospace',
                  background:    isCurrent ? `${primaryColor}20` : 'var(--bg-deep)',
                  color:         isCurrent ? primaryColor : 'var(--text-muted)',
                  border:        `1px solid ${isCurrent ? `${primaryColor}40` : 'var(--border)'}`,
                  fontWeight:    isCurrent ? 700 : 400,
                }}>
                  {m}
                </span>
              )
            })}
          </div>
        </div>

        {/* RBI extra indicators */}
        {mode === 'RBI' && (
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
            <div style={{
              fontSize:      '8px',
              color:         'var(--text-muted)',
              fontFamily:    'JetBrains Mono, monospace',
              letterSpacing: '0.12em',
              marginBottom:  '8px',
            }}>
              INDIA MACRO SNAPSHOT
            </div>
            {[
              { l: 'GDP Growth (FY26E)',   v: '~6.5%',  c: 'var(--positive)' },
              { l: 'WPI Inflation',        v: '~2.4%',  c: '#f0a500' },
              { l: 'Forex Reserves',       v: '~$644B', c: 'var(--teal)'    },
              { l: 'Current Account',      v: '-1.1% GDP', c: '#f0a500' },
              { l: 'Fiscal Deficit (FY26)',v: '4.8% GDP',  c: '#f0a500' },
            ].map(r => (
              <div key={r.l} style={{
                display:        'flex',
                justifyContent: 'space-between',
                padding:        '5px 0',
                borderBottom:   '1px solid rgba(30,45,61,0.4)',
              }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {r.l}
                </span>
                <span style={{ fontSize: '10px', color: r.c, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                  {r.v}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* FED extra — dot plot stub */}
        {mode === 'FED' && (
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)' }}>
            <div style={{
              fontSize:      '8px',
              color:         'var(--text-muted)',
              fontFamily:    'JetBrains Mono, monospace',
              letterSpacing: '0.12em',
              marginBottom:  '8px',
            }}>
              FED KEY METRICS
            </div>
            {[
              { l: 'PCE Target',          v: '2.00%',     c: 'var(--text-muted)' },
              { l: 'Unemployment Rate',   v: '~4.1%',     c: 'var(--text-2)'    },
              { l: 'GDP Growth (Q4 25E)', v: '~2.3%',     c: 'var(--positive)'  },
              { l: 'DXY (Dollar Index)',  v: '~103',      c: 'var(--text-2)'    },
              { l: '10Y Treasury Yield',  v: '~4.25%',    c: '#f0a500'          },
            ].map(r => (
              <div key={r.l} style={{
                display:        'flex',
                justifyContent: 'space-between',
                padding:        '5px 0',
                borderBottom:   '1px solid rgba(30,45,61,0.4)',
              }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                  {r.l}
                </span>
                <span style={{ fontSize: '10px', color: r.c, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>
                  {r.v}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}