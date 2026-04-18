'use client'

import { useTradingContext } from '@/components/trading/TradingContext'

// ── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({ label, used, limit, unit = '$', invert = false }: {
  label: string; used: number; limit: number; unit?: string; invert?: boolean
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const color = invert
    ? (pct >= 80 ? 'var(--positive)' : pct >= 50 ? 'var(--amber)' : 'var(--text-muted)')
    : (pct >= 80 ? 'var(--negative)' : pct >= 50 ? 'var(--amber)' : 'var(--positive)')

  return (
    <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', letterSpacing: '0.07em' }}>{label}</span>
        <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color }}>
          {unit}{used.toFixed(0)} / {unit}{limit.toFixed(0)}
          <span style={{ fontSize: 9, color, marginLeft: 6 }}>({pct.toFixed(1)}%)</span>
        </span>
      </div>
      <div style={{ width: '100%', height: 5, background: 'var(--bg-deep)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ passing }: { passing: boolean }) {
  return (
    <span style={{
      padding: '3px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
      letterSpacing: '0.08em', borderRadius: 3,
      background: passing ? 'rgba(0,201,122,0.15)' : 'rgba(255,69,96,0.15)',
      color:      passing ? 'var(--positive)'       : 'var(--negative)',
      border:    `1px solid ${passing ? 'rgba(0,201,122,0.4)' : 'rgba(255,69,96,0.4)'}`,
    }}>
      {passing ? '✓ PASSING' : '✗ AT RISK'}
    </span>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function PropFirmPanel() {
  const { propFirm, updatePropFirm } = useTradingContext()
  const { firmName, accountSize, dailyLossLimitPct, maxDrawdownPct, profitTargetPct,
    phase, challengeStartDate, currentDrawdown, currentProfit, dailyLoss } = propFirm

  const dailyLossLimit = accountSize * (dailyLossLimitPct / 100)
  const maxDrawdownAmt = accountSize * (maxDrawdownPct    / 100)
  const profitTarget   = accountSize * (profitTargetPct   / 100)

  const today       = new Date()
  const startDate   = new Date(challengeStartDate)
  const daysElapsed = Math.max(0, Math.floor((today.getTime() - startDate.getTime()) / 86400000))
  const totalDays   = phase === 'Phase 1' ? 30 : phase === 'Phase 2' ? 60 : 0
  const daysLeft    = totalDays > 0 ? Math.max(0, totalDays - daysElapsed) : null
  const passing     = dailyLoss < dailyLossLimit && currentDrawdown < maxDrawdownAmt

  const IS: React.CSSProperties = {
    width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border-br)', borderRadius: 4,
    padding: '5px 8px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
  }
  const LS: React.CSSProperties = {
    fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)',
    letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3, display: 'block',
  }

  type FieldKey = 'firmName' | 'accountSize' | 'dailyLossLimitPct' | 'maxDrawdownPct' | 'profitTargetPct' | 'challengeStartDate'

  const field = (key: FieldKey, label: string, type: 'text' | 'number' | 'date' = 'number') => (
    <label key={key}>
      <span style={LS}>{label}</span>
      <input type={type} value={String(propFirm[key])}
        onChange={e => updatePropFirm({ [key]: type === 'number' ? Number(e.target.value) : e.target.value } as Parameters<typeof updatePropFirm>[0])}
        style={IS} />
    </label>
  )

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" style={{ background: 'var(--amber)' }} />
          PROP FIRM MODE
        </div>
        <StatusBadge passing={passing} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Settings */}
        <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
            Challenge Settings
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {field('firmName',          'Firm Name',        'text'  )}
            {field('accountSize',       'Account Size ($)', 'number')}
            {field('challengeStartDate','Start Date',       'date'  )}
            {field('dailyLossLimitPct', 'Daily Loss Limit %','number')}
            {field('maxDrawdownPct',    'Max Drawdown %',   'number')}
            {field('profitTargetPct',   'Profit Target %',  'number')}
          </div>

          {/* Phase toggle */}
          <div style={{ marginTop: 10 }}>
            <span style={LS}>Challenge Phase</span>
            <div style={{ display: 'flex', border: '1px solid var(--border-br)', borderRadius: 4, overflow: 'hidden', width: 'fit-content' }}>
              {(['Phase 1', 'Phase 2', 'Funded'] as const).map((p, i) => (
                <button key={p} onClick={() => updatePropFirm({ phase: p })} style={{
                  padding: '5px 14px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                  cursor: 'pointer',
                  borderRight: i < 2 ? '1px solid var(--border-br)' : 'none', border: 'none',
                  background: phase === p ? 'rgba(0,229,192,0.18)' : 'var(--bg-deep)',
                  color: phase === p ? 'var(--teal)' : 'var(--text-muted)',
                }}>{p}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Summary row */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <div style={{ flex: 1, padding: '8px 14px', borderRight: '1px solid var(--border)' }}>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Account</div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>${accountSize.toLocaleString()}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{firmName || '—'} · {phase}</div>
          </div>
          {daysLeft !== null && (
            <div style={{ flex: 1, padding: '8px 14px', textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 2 }}>Days Remaining</div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 22, color: daysLeft <= 5 ? 'var(--negative)' : daysLeft <= 10 ? 'var(--amber)' : 'var(--text)' }}>
                {daysLeft}
              </div>
            </div>
          )}
        </div>

        {/* Progress bars */}
        <ProgressBar label="Daily Loss Used"   used={dailyLoss}          limit={dailyLossLimit} />
        <ProgressBar label="Total Drawdown"    used={currentDrawdown}    limit={maxDrawdownAmt}  />
        <ProgressBar label="Profit Progress"   used={currentProfit}      limit={profitTarget}    invert />

      </div>
    </div>
  )
}
