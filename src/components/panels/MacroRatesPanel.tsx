'use client'
import { useEffect, useState } from 'react'

type Mode = 'FED' | 'RBI'

interface RateData {
  market: string
  policyRate: { lower?: number; upper?: number; effective?: number | null; value?: number; display?: string; date: string; label: string; source: string }
  stance: string
  cpi: { value: number; date: string } | null
  unrate?: { value: number; date: string } | null
  meetings: { date: string; label: string; done: boolean }[]
  nextMeeting: { date: string; label: string; done: boolean }
  fetchedAt: string
}

const staleRef: Partial<Record<Mode, RateData>> = {}

export default function MacroRatesPanel() {
  const [mode,    setMode]    = useState<Mode>('FED')
  const [data,    setData]    = useState<RateData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async (m: Mode) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/macro-rates?market=${m === 'FED' ? 'US' : 'IN'}`)
      const d   = await res.json() as RateData
      staleRef[m] = d
      setData(d)
    } catch {
      if (staleRef[m]) setData(staleRef[m]!)
    }
    setLoading(false)
  }

  useEffect(() => { load(mode) }, [mode])

  const today   = new Date().toISOString().slice(0, 10)
  const primary = mode === 'FED' ? 'var(--teal)' : '#f97316'
  const rateStr = data?.policyRate
    ? (data.policyRate.display ?? (data.policyRate.value != null ? `${data.policyRate.value?.toFixed(2)}%` : '···'))
    : '···'

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" />
          MACRO RATES
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['FED', 'RBI'] as Mode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '3px 14px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', letterSpacing: '0.08em', fontWeight: 700,
              border: `1px solid ${mode === m ? (m === 'FED' ? 'var(--teal)' : '#f97316') : 'var(--border)'}`,
              background: mode === m ? (m === 'FED' ? 'rgba(0,229,192,0.12)' : 'rgba(249,115,22,0.12)') : 'transparent',
              color: mode === m ? (m === 'FED' ? 'var(--teal)' : '#f97316') : 'var(--text-muted)',
            }}>{m === 'FED' ? '🇺🇸 FED' : '🇮🇳 RBI'}</button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Hero rate card */}
        <div style={{
          margin: '12px 14px', padding: '14px',
          background: `rgba(${mode === 'FED' ? '0,229,192' : '249,115,22'}, 0.06)`,
          border: `1px solid rgba(${mode === 'FED' ? '0,229,192' : '249,115,22'}, 0.2)`,
          borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', marginBottom: '6px' }}>
              {mode === 'FED' ? 'FED FUNDS TARGET RANGE' : 'RBI POLICY REPO RATE'}
            </div>
            {loading ? (
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '32px', color: 'var(--text-muted)' }}>···</div>
            ) : (
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '32px', color: primary, lineHeight: 1 }}>
                {rateStr}
              </div>
            )}
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '5px' }}>
              As of {data?.policyRate?.date ?? '···'} · {data?.policyRate?.source ?? 'FRED'}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              padding: '4px 12px', borderRadius: '3px', fontSize: '10px',
              fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
              background: `${primary}18`, color: primary, border: `1px solid ${primary}35`, marginBottom: '6px',
            }}>
              {data?.stance ?? '···'}
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              Next: {data?.nextMeeting?.label ?? '···'}
            </div>
          </div>
        </div>

        {/* Live indicators */}
        {!loading && data && (
          <>
            {data.cpi && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>CPI Inflation (YoY)</div>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{data.cpi.date} · FRED</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: data.cpi.value > 4 ? 'var(--negative)' : data.cpi.value > 2.5 ? 'var(--amber)' : 'var(--positive)' }}>
                    {data.cpi.value.toFixed(2)}%
                  </div>
                </div>
              </div>
            )}
            {data.unrate && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>Unemployment Rate</div>
                  <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{data.unrate.date} · FRED</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: '#fff' }}>
                    {data.unrate.value.toFixed(1)}%
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Meeting schedule */}
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.12em', marginBottom: '8px' }}>
            {mode === 'FED' ? 'FOMC 2026 SCHEDULE' : 'RBI MPC 2026 SCHEDULE'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {(data?.meetings ?? []).map(m => {
              const isCurrent = !m.done && data?.nextMeeting?.date === m.date
              return (
                <span key={m.date} style={{
                  fontSize: '9px', padding: '3px 8px', borderRadius: '2px',
                  fontFamily: 'JetBrains Mono, monospace',
                  background: isCurrent ? `rgba(${mode==='FED'?'0,229,192':'249,115,22'}, 0.15)` : 'var(--bg-deep)',
                  color: isCurrent ? primary : m.done ? 'var(--text-muted)' : 'var(--text-2)',
                  border: `1px solid ${isCurrent ? primary + '60' : 'var(--border)'}`,
                  fontWeight: isCurrent ? 700 : 400,
                  opacity: m.done ? 0.5 : 1,
                }}>
                  {m.label}{m.done ? ' ✓' : isCurrent ? ' ◀' : ''}
                </span>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}