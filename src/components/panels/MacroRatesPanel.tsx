'use client'

import { useEffect, useState } from 'react'

type Mode = 'FED' | 'RBI'

interface MacroIndicator {
  indicator: string
  label:     string
  value:     number | null
  year:      string
  change:    number | null
}

interface WorldBankResponse {
  country:     string
  lastFetched: string
  indicators:  MacroIndicator[]
  note:        string
}

const FOMC_2026 = [
  'Jan 27–28 ✓', 'Mar 17–18 ✓', 'May 5–6',
  'Jun 16–17', 'Jul 28–29', 'Sep 15–16',
  'Oct 27–28', 'Dec 8–9',
]

const RBI_MPC_2026 = [
  'Feb 5–7 ✓', 'Apr 7–9 ←', 'Jun 2026',
  'Aug 2026', 'Oct 2026', 'Dec 2026',
]

function fmtVal(v: number | null, suffix = ''): string {
  if (v === null) return '···'
  return `${v >= 0 ? '' : ''}${v.toFixed(2)}${suffix}`
}

function changeColor(c: number | null, invert = false): string {
  if (c === null) return 'var(--text-muted)'
  const pos = invert ? c < 0 : c >= 0
  return pos ? 'var(--positive)' : 'var(--negative)'
}

const staleRef: Partial<Record<Mode, WorldBankResponse>> = {}

export default function MacroRatesPanel() {
  const [mode,    setMode]    = useState<Mode>('FED')
  const [wbData,  setWbData]  = useState<WorldBankResponse | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchMacroData = async (m: Mode) => {
    const country = m === 'FED' ? 'US' : 'IN'
    setLoading(true)
    try {
      const res  = await fetch(`/api/worldbank?country=${country}`)
      const data = await res.json() as WorldBankResponse
      staleRef[m] = data
      setWbData(data)
    } catch {
      if (staleRef[m]) setWbData(staleRef[m]!)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchMacroData(mode) }, [mode])

  const primaryColor = mode === 'FED' ? 'var(--teal)' : '#f97316'

  // Hero rate (policy rate) — static but sourced info
  const heroRate   = mode === 'FED' ? '4.25–4.50%' : '5.25%'
  const lastChange = mode === 'FED' ? '−25bps · Dec 2024' : ' Feb 2025'
  const stance     = mode === 'FED'
    ? { label: 'DATA DEPENDENT', color: '#f0a500' }
    : { label: 'ACCOMMODATIVE',  color: 'var(--positive)' }
  const meetings   = mode === 'FED' ? FOMC_2026 : RBI_MPC_2026
  const nextMtg    = meetings.find(m => !m.includes('✓')) ?? meetings[meetings.length - 1]

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
            <button key={m} onClick={() => setMode(m)} style={{
              padding:      '3px 14px', borderRadius: '3px', cursor: 'pointer',
              fontFamily:   'JetBrains Mono, monospace', fontSize: '11px',
              letterSpacing:'0.08em', fontWeight: 700,
              border:        `1px solid ${mode === m ? (m === 'FED' ? 'var(--teal)' : '#f97316') : 'var(--border)'}`,
              background:    mode === m ? (m === 'FED' ? 'rgba(0,229,192,0.12)' : 'rgba(249,115,22,0.12)') : 'transparent',
              color:         mode === m ? (m === 'FED' ? 'var(--teal)' : '#f97316') : 'var(--text-muted)',
              transition:    'all 0.15s',
            }}>
              {m === 'FED' ? '🇺🇸' : '🇮🇳'} {m}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>

        {/* Hero rate card */}
        <div style={{
          margin: '12px 14px', padding: '14px',
          background:   `${primaryColor === 'var(--teal)' ? 'rgba(0,229,192' : 'rgba(249,115,22'}, 0.06)`,
          border:       `1px solid ${primaryColor === 'var(--teal)' ? 'rgba(0,229,192' : 'rgba(249,115,22'}, 0.2)`,
          borderRadius: '6px',
          display:      'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', marginBottom: '6px' }}>
              {mode === 'FED' ? 'FED FUNDS RATE (TARGET)' : 'RBI REPO RATE'}
            </div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '32px', color: primaryColor, lineHeight: 1 }}>
              {heroRate}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '5px' }}>
              Last change: {lastChange}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
            <div style={{
              padding: '4px 12px', borderRadius: '3px',
              fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: '0.06em',
              background: `${stance.color}18`, color: stance.color, border: `1px solid ${stance.color}35`,
            }}>
              {stance.label}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>
              Next: {nextMtg}
            </div>
          </div>
        </div>

        {/* Live World Bank indicators */}
        {loading ? (
          <div style={{ padding: '12px 14px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
            FETCHING WORLD BANK DATA...
          </div>
        ) : wbData?.indicators.length ? (
          <>
            <div style={{ padding: '2px 14px 6px', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
                WORLD BANK DATA — MOST RECENT RELEASE
              </span>
              <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                {new Date(wbData.lastFetched).toLocaleDateString()}
              </span>
            </div>
            {wbData.indicators.map(ind => {
              const isCPI = ind.label.includes('CPI') || ind.label.includes('Inflation')
              const isDebt = ind.label.includes('Debt')
              return (
                <div key={ind.indicator} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 14px', borderBottom: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {ind.label}
                    </div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '1px' }}>
                      {ind.year}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{
                      fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                      color: ind.value === null ? 'var(--text-muted)' : isCPI ? '#f0a500' : '#fff',
                    }}>
                      {ind.value !== null ? ind.value.toFixed(2) + '%' : '···'}
                    </div>
                    {ind.change !== null && (
                      <div style={{
                        fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
                        color: changeColor(ind.change, isCPI),
                      }}>
                        {ind.change >= 0 ? '+' : ''}{ind.change.toFixed(2)} YoY
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div style={{ padding: '6px 14px', fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5 }}>
              {wbData.note}
            </div>
          </>
        ) : (
          <div style={{ padding: '12px 14px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            World Bank data unavailable. Check network.
          </div>
        )}

        {/* Meeting schedule */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', marginBottom: '8px' }}>
            {mode === 'FED' ? 'FOMC 2026 SCHEDULE' : 'RBI MPC 2026 SCHEDULE'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {meetings.map((m, i) => {
              const isPast    = m.includes('✓')
              const isCurrent = m.includes('←')
              return (
                <span key={m} style={{
                  fontSize: '9px', padding: '3px 8px', borderRadius: '2px',
                  fontFamily: 'JetBrains Mono, monospace',
                  background: isCurrent ? `${primaryColor === 'var(--teal)' ? 'rgba(0,229,192' : 'rgba(249,115,22'}, 0.15)` : isPast ? 'var(--bg-deep)' : 'var(--bg-deep)',
                  color:      isCurrent ? primaryColor : isPast ? 'var(--text-muted)' : 'var(--text-2)',
                  border:     `1px solid ${isCurrent ? (primaryColor === 'var(--teal)' ? 'rgba(0,229,192,0.4)' : 'rgba(249,115,22,0.4)') : 'var(--border)'}`,
                  fontWeight: isCurrent ? 700 : 400,
                  opacity:    isPast ? 0.5 : 1,
                }}>
                  {m.replace(' ✓', '').replace(' ←', '')}
                  {isCurrent ? ' ◀' : isPast ? ' ✓' : ''}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}