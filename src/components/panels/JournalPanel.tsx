'use client'

import { useState, useMemo } from 'react'
import { useTradingContext, TradeEntry } from '@/components/trading/TradingContext'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAIRS      = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'GBP/JPY', 'AUD/USD', 'USD/CAD', 'NZD/USD', 'BTC/USD', 'ETH/USD', 'XAU/USD']
const SETUP_TAGS = ['Trend Follow', 'Breakout', 'Reversal', 'News Play', 'ICT Setup', 'Support/Resistance', 'Mean Reversion', 'Custom'] as const
const EMOTIONS   = ['Confident', 'Disciplined', 'Hesitant', 'FOMO', 'Neutral', 'Revenge', 'Rushed'] as const

// ── Calculations ──────────────────────────────────────────────────────────────

function calcOutcome(entry: number, exit: number, dir: 'long' | 'short'): 'win' | 'loss' | 'breakeven' {
  const diff = dir === 'long' ? exit - entry : entry - exit
  // threshold: 0.1 pip — anything less is a true breakeven
  if (Math.abs(diff) < 0.00001) return 'breakeven'
  return diff > 0 ? 'win' : 'loss'
}

function calcRR(entry: number, sl: number, tp: number): number {
  if (!sl || !tp || Math.abs(entry - sl) < 1e-10) return 0
  return Math.abs(tp - entry) / Math.abs(entry - sl)
}

function calcPips(entry: number, exit: number, pair: string, dir: 'long' | 'short'): number {
  const diff   = dir === 'long' ? exit - entry : entry - exit
  const pipSz  = pair.includes('JPY') || pair.includes('XAU') ? 0.01 : 0.0001
  return parseFloat((diff / pipSz).toFixed(1))
}

function exportCSV(trades: TradeEntry[]) {
  const headers = ['Date', 'Pair', 'Direction', 'Outcome', 'Entry', 'Exit', 'SL', 'TP', 'Pips', 'P&L ($)', 'R:R', 'Setup Tags', 'Emotion', 'Planned', 'Notes']
  const rows = trades.map(t => [
    t.dateTime, t.pair, t.direction, t.outcome,
    t.entryPrice, t.exitPrice, t.stopLoss || '', t.takeProfit || '',
    t.pips.toFixed(1), t.pnlDollar ?? '',
    t.rr > 0 ? t.rr.toFixed(2) : '',
    `"${t.setupTags.join('; ')}"`, t.emotion,
    t.wasPlanned ? 'Yes' : 'No',
    `"${t.notes.replace(/"/g, "'")}"`
  ])
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
  const a   = document.createElement('a')
  a.href    = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv)
  a.download = `trade_journal_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const IS: React.CSSProperties = {
  width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border-br)',
  borderRadius: 4, padding: '5px 8px', fontSize: 11,
  fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
}
const LS: React.CSSProperties = {
  fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)',
  letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 3, display: 'block',
}
const ghostBtn = (danger = false): React.CSSProperties => ({
  fontSize: 10, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer',
  background: 'none', border: `1px solid ${danger ? 'rgba(255,69,96,0.3)' : 'var(--border)'}`,
  borderRadius: 3, padding: '3px 10px',
  color: danger ? 'var(--negative)' : 'var(--text-muted)',
})

// ── Outcome badge ─────────────────────────────────────────────────────────────

function OutcomeBadge({ o }: { o: TradeEntry['outcome'] }) {
  const cfg = {
    win:       { bg: 'rgba(0,201,122,0.15)',   color: 'var(--positive)', label: 'WIN'  },
    loss:      { bg: 'rgba(255,69,96,0.15)',   color: 'var(--negative)', label: 'LOSS' },
    breakeven: { bg: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', label: 'B/E' },
  }[o]
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, fontSize: 9,
      fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
      padding: '2px 6px', borderRadius: 3, letterSpacing: '0.06em',
      border: `1px solid ${cfg.color}50`,
    }}>{cfg.label}</span>
  )
}

// ── Trade Form (shared for Add & Edit) ────────────────────────────────────────

interface TradeFormProps {
  initial?: TradeEntry
  onSave:  (t: Omit<TradeEntry, 'id'>) => void
  onClose: () => void
}

function TradeForm({ initial, onSave, onClose }: TradeFormProps) {
  const isEdit = !!initial
  const [pair,    setPair]    = useState(initial?.pair ?? 'EUR/USD')
  const [dir,     setDir]     = useState<'long' | 'short'>(initial?.direction ?? 'long')
  const [entry,   setEntry]   = useState(initial?.entryPrice?.toString() ?? '')
  const [exit,    setExit]    = useState(initial?.exitPrice?.toString()  ?? '')
  const [sl,      setSl]      = useState(initial && initial.stopLoss   > 0 ? initial.stopLoss.toString()   : '')
  const [tp,      setTp]      = useState(initial && initial.takeProfit > 0 ? initial.takeProfit.toString() : '')
  const [pnlD,    setPnlD]    = useState(initial?.pnlDollar !== undefined ? initial.pnlDollar.toString() : '')
  const [dt,      setDt]      = useState(initial?.dateTime?.slice(0, 16) ?? new Date().toISOString().slice(0, 16))
  const [tags,    setTags]    = useState<string[]>(initial?.setupTags   ?? [])
  const [planned, setPlanned] = useState(initial?.wasPlanned ?? true)
  const [whyNot,  setWhyNot]  = useState(initial?.whyNotPlanned ?? '')
  const [emotion, setEmotion] = useState(initial?.emotion ?? 'Neutral')
  const [notes,   setNotes]   = useState(initial?.notes ?? '')
  const [shot,    setShot]    = useState(initial?.screenshotUrl ?? '')
  const [errors,  setErrors]  = useState<string[]>([])

  const toggleTag = (t: string) => setTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])

  const dirBtn = (active: boolean, danger = false): React.CSSProperties => ({
    flex: 1, padding: '5px 0', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
    cursor: 'pointer',
    border:      `1px solid ${active ? (danger ? 'rgba(255,69,96,0.5)' : 'rgba(0,201,122,0.5)') : 'var(--border-br)'}`,
    borderRadius: 4,
    background:  active ? (danger ? 'rgba(255,69,96,0.12)' : 'rgba(0,201,122,0.12)') : 'transparent',
    color:       active ? (danger ? 'var(--negative)' : 'var(--positive)') : 'var(--text-muted)',
  })

  const save = () => {
    const eN = Number(entry), xN = Number(exit), sN = Number(sl) || 0, tN = Number(tp) || 0
    const errs: string[] = []
    if (!eN) errs.push('Entry price is required')
    if (!xN) errs.push('Exit price is required')
    if (eN && xN && eN === xN) errs.push('Entry and exit prices are identical — did you mean breakeven?')
    if (errs.length) { setErrors(errs); return }
    setErrors([])

    const outcome = calcOutcome(eN, xN, dir)
    const pips    = calcPips(eN, xN, pair, dir)

    onSave({
      pair, direction: dir,
      entryPrice: eN, exitPrice: xN, stopLoss: sN, takeProfit: tN,
      pnlDollar:  pnlD !== '' ? Number(pnlD) : undefined,
      dateTime: dt, setupTags: tags, wasPlanned: planned, whyNotPlanned: whyNot,
      emotion, notes, screenshotUrl: shot,
      outcome, rr: sN && tN ? calcRR(eN, sN, tN) : 0,
      pips, pnl: dir === 'long' ? xN - eN : eN - xN,
    })
  }

  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
      {/* Form header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {isEdit ? '✎  Edit Trade' : '+  Log New Trade'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
          * required fields
        </span>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div style={{ padding: '7px 10px', background: 'rgba(255,69,96,0.08)', border: '1px solid rgba(255,69,96,0.3)', borderRadius: 4, marginBottom: 10 }}>
          {errors.map((e, i) => (
            <div key={i} style={{ fontSize: 10, color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace' }}>✕ {e}</div>
          ))}
        </div>
      )}

      {/* Row 1 — Pair · Direction · DateTime */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <label>
          <span style={LS}>Pair *</span>
          <select value={pair} onChange={e => setPair(e.target.value)} style={IS}>
            {PAIRS.map(p => <option key={p} value={p} style={{ background: 'var(--bg-panel)' }}>{p}</option>)}
          </select>
        </label>
        <label>
          <span style={LS}>Direction *</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setDir('long')}  style={dirBtn(dir === 'long')}>▲ Long</button>
            <button onClick={() => setDir('short')} style={dirBtn(dir === 'short', true)}>▼ Short</button>
          </div>
        </label>
        <label>
          <span style={LS}>Date / Time</span>
          <input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)} style={IS} />
        </label>
      </div>

      {/* Row 2 — Prices + P&L */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
        <label>
          <span style={LS}>Entry Price *</span>
          <input type="number" step="any" value={entry} placeholder="e.g. 1.17800"
            onChange={e => setEntry(e.target.value)}
            style={{ ...IS, borderColor: errors.some(e => e.includes('Entry')) ? 'rgba(255,69,96,0.6)' : undefined }} />
        </label>
        <label>
          <span style={LS}>Exit Price *</span>
          <input type="number" step="any" value={exit}  placeholder="e.g. 1.17420"
            onChange={e => setExit(e.target.value)}
            style={{ ...IS, borderColor: errors.some(e => e.includes('Exit')) ? 'rgba(255,69,96,0.6)' : undefined }} />
        </label>
        <label>
          <span style={LS}>Realized P&amp;L ($) — from broker</span>
          <input type="number" step="any" value={pnlD} placeholder="e.g. 120.00 or -50.00"
            onChange={e => setPnlD(e.target.value)} style={IS} />
        </label>
      </div>

      {/* Row 3 — SL, TP, Emotion */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
        <label>
          <span style={LS}>Stop Loss</span>
          <input type="number" step="any" value={sl} placeholder="e.g. 1.18200" onChange={e => setSl(e.target.value)} style={IS} />
        </label>
        <label>
          <span style={LS}>Take Profit</span>
          <input type="number" step="any" value={tp} placeholder="e.g. 1.16500" onChange={e => setTp(e.target.value)} style={IS} />
        </label>
        <label>
          <span style={LS}>Emotion</span>
          <select value={emotion} onChange={e => setEmotion(e.target.value)} style={IS}>
            {EMOTIONS.map(e => <option key={e} value={e} style={{ background: 'var(--bg-panel)' }}>{e}</option>)}
          </select>
        </label>
      </div>

      {/* Setup tags */}
      <div style={{ marginTop: 10 }}>
        <span style={LS}>Setup Tags</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {SETUP_TAGS.map(t => (
            <button key={t} onClick={() => toggleTag(t)} style={{
              padding: '3px 9px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', borderRadius: 3,
              border:     `1px solid ${tags.includes(t) ? 'rgba(0,229,192,0.45)' : 'var(--border-br)'}`,
              background: tags.includes(t) ? 'rgba(0,229,192,0.1)' : 'transparent',
              color:      tags.includes(t) ? 'var(--teal)' : 'var(--text-muted)',
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Planned + why + screenshot in one row */}
      <div style={{ display: 'flex', gap: 12, marginTop: 10, alignItems: 'flex-start' }}>
        <div>
          <span style={LS}>In Your Plan?</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setPlanned(true)}  style={{ ...dirBtn(planned),       flex: 'none', padding: '5px 12px' }}>✓ Yes</button>
            <button onClick={() => setPlanned(false)} style={{ ...dirBtn(!planned, true), flex: 'none', padding: '5px 12px' }}>✕ No</button>
          </div>
        </div>
        {!planned && (
          <div style={{ flex: 1 }}>
            <span style={LS}>Why unplanned?</span>
            <input type="text" value={whyNot} onChange={e => setWhyNot(e.target.value)}
              placeholder="e.g. Chased price, missed entry window" style={IS} />
          </div>
        )}
        <div style={{ flex: planned ? 1 : '0 0 200px' }}>
          <span style={LS}>Screenshot URL</span>
          <input type="url" value={shot} placeholder="https://…" onChange={e => setShot(e.target.value)} style={IS} />
        </div>
      </div>

      {/* Notes */}
      <div style={{ marginTop: 10 }}>
        <span style={LS}>Notes &amp; Rationale</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="Setup rationale, execution quality, lessons learned…"
          style={{ ...IS, resize: 'vertical', lineHeight: 1.55 }} />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button onClick={save} style={{
          padding: '6px 18px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
          cursor: 'pointer', border: '1px solid rgba(0,229,192,0.5)', borderRadius: 4,
          background: 'rgba(0,229,192,0.13)', color: 'var(--teal)',
        }}>{isEdit ? 'Update Trade' : 'Save Trade'}</button>
        <button onClick={onClose} style={{
          padding: '6px 14px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          cursor: 'pointer', border: '1px solid var(--border-br)', borderRadius: 4,
          background: 'transparent', color: 'var(--text-muted)',
        }}>Cancel</button>
      </div>
    </div>
  )
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ trades }: { trades: TradeEntry[] }) {
  const s = useMemo(() => {
    const wins   = trades.filter(t => t.outcome === 'win').length
    const losses = trades.filter(t => t.outcome === 'loss').length
    const be     = trades.filter(t => t.outcome === 'breakeven').length
    const pips   = trades.reduce((s, t) => s + t.pips, 0)
    const wr     = trades.length > 0 ? (wins / trades.length) * 100 : 0
    const hasDlr = trades.some(t => (t.pnlDollar ?? 0) !== 0)
    const netDlr = hasDlr ? trades.reduce((s, t) => s + (t.pnlDollar ?? 0), 0) : null
    return { wins, losses, be, pips, wr, netDlr }
  }, [trades])

  const items: { label: string; value: string; color: string }[] = [
    { label: 'Wins',     value: String(s.wins),   color: 'var(--positive)' },
    { label: 'Losses',   value: String(s.losses),  color: 'var(--negative)' },
    ...(s.be > 0 ? [{ label: 'B/E', value: String(s.be), color: 'var(--text-muted)' }] : []),
    { label: 'Win Rate', value: `${s.wr.toFixed(1)}%`, color: s.wr >= 50 ? 'var(--positive)' : 'var(--negative)' },
    { label: 'Total Pips', value: `${s.pips >= 0 ? '+' : ''}${s.pips.toFixed(1)}`, color: s.pips >= 0 ? 'var(--positive)' : 'var(--negative)' },
    ...(s.netDlr !== null ? [{
      label: 'Net P&L', value: `${s.netDlr >= 0 ? '+$' : '-$'}${Math.abs(s.netDlr).toFixed(2)}`,
      color: s.netDlr >= 0 ? 'var(--positive)' : 'var(--negative)',
    }] : []),
  ]

  return (
    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.015)' }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{ padding: '7px 14px', borderRight: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({ t, onDelete, onEdit }: {
  t:        TradeEntry
  onDelete: () => void
  onEdit:   (u: Partial<Omit<TradeEntry, 'id'>>) => void
}) {
  const [open,    setOpen]    = useState(false)
  const [editing, setEditing] = useState(false)
  const [delConf, setDelConf] = useState(false)

  const dirColor   = t.direction === 'long' ? 'var(--positive)' : 'var(--negative)'
  const accentLeft = { win: 'rgba(0,201,122,0.45)', loss: 'rgba(255,69,96,0.45)', breakeven: 'rgba(255,255,255,0.12)' }[t.outcome]

  // Inline edit replaces the card
  if (editing) return (
    <div style={{ borderBottom: '1px solid var(--border)', borderLeft: `2px solid ${accentLeft}` }}>
      <TradeForm
        initial={t}
        onSave={updates => { onEdit(updates); setEditing(false); setOpen(false) }}
        onClose={() => setEditing(false)}
      />
    </div>
  )

  return (
    <div style={{ borderBottom: '1px solid var(--border)', borderLeft: `2px solid ${accentLeft}` }}>
      {/* Summary row — clickable */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 14px', cursor: 'pointer', gap: 8 }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {/* Left — pair + dir + badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text)', letterSpacing: '0.03em' }}>
            {t.pair}
          </span>
          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: dirColor }}>
            {t.direction === 'long' ? '▲' : '▼'} {t.direction}
          </span>
          <OutcomeBadge o={t.outcome} />
          {t.setupTags.slice(0, 2).map(tag => (
            <span key={tag} style={{
              fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--teal)',
              border: '1px solid rgba(0,229,192,0.25)', padding: '1px 6px', borderRadius: 2,
            }}>{tag}</span>
          ))}
          {!t.wasPlanned && (
            <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--amber)', border: '1px solid rgba(240,165,0,0.3)', padding: '1px 5px', borderRadius: 2 }}>
              unplanned
            </span>
          )}
        </div>

        {/* Right — metrics + date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          {t.rr > 0 && (
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-2)', fontWeight: 600 }}>
              1:{t.rr.toFixed(2)}R
            </span>
          )}
          <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: t.pips >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
            {t.pips >= 0 ? '+' : ''}{t.pips.toFixed(1)}p
          </span>
          {(t.pnlDollar ?? 0) !== 0 && (
            <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: (t.pnlDollar ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
              {(t.pnlDollar ?? 0) >= 0 ? '+$' : '-$'}{Math.abs(t.pnlDollar!).toFixed(2)}
            </span>
          )}
          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)' }}>
            {new Date(t.dateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '10px 14px 12px', background: 'var(--bg-deep)', borderTop: '1px solid var(--border)' }}>
          {/* Price grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 10 }}>
            {([
              ['Entry',      t.entryPrice.toFixed(pair(t).dp)],
              ['Exit',       t.exitPrice.toFixed(pair(t).dp)],
              ['Stop Loss',  t.stopLoss  > 0 ? t.stopLoss.toFixed(pair(t).dp)  : '—'],
              ['Take Profit',t.takeProfit > 0 ? t.takeProfit.toFixed(pair(t).dp) : '—'],
              ['Pips',       `${t.pips >= 0 ? '+' : ''}${t.pips.toFixed(1)}`],
              ['R:R Ratio',  t.rr > 0 ? `1:${t.rr.toFixed(2)}` : '—'],
              ['Emotion',    t.emotion],
              ['Planned',    t.wasPlanned ? '✓ Yes' : '✕ No'],
              ...((t.pnlDollar ?? 0) !== 0 ? [['P&L ($)', `${(t.pnlDollar! >= 0) ? '+$' : '-$'}${Math.abs(t.pnlDollar!).toFixed(2)}`]] : []),
              ['Time',       new Date(t.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })],
            ] as [string, string][]).map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>

          {!t.wasPlanned && t.whyNotPlanned && (
            <div style={{ padding: '5px 9px', background: 'rgba(255,69,96,0.07)', border: '1px solid rgba(255,69,96,0.2)', borderRadius: 4, fontSize: 11, color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 8, lineHeight: 1.5 }}>
              <strong>Unplanned:</strong> {t.whyNotPlanned}
            </div>
          )}
          {t.notes && (
            <div style={{ padding: '6px 9px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 4, fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6, marginBottom: 8 }}>
              {t.notes}
            </div>
          )}
          {t.screenshotUrl && /^https?:\/\//i.test(t.screenshotUrl) && (
            <a href={t.screenshotUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: 'var(--teal)', fontFamily: 'JetBrains Mono, monospace', textDecoration: 'none', display: 'inline-block', marginBottom: 8 }}>
              ↗ View Chart Screenshot
            </a>
          )}

          {/* Action row */}
          <div style={{ display: 'flex', gap: 6, paddingTop: 8, borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <button onClick={() => { setEditing(true); setDelConf(false) }} style={{
              ...ghostBtn(), color: 'var(--teal)', borderColor: 'rgba(0,229,192,0.3)',
            }}>✎ Edit</button>
            {!delConf ? (
              <button onClick={() => setDelConf(true)} style={ghostBtn()}>Delete</button>
            ) : (
              <>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', alignSelf: 'center' }}>
                  Confirm delete?
                </span>
                <button onClick={onDelete} style={ghostBtn(true)}>✕ Yes, delete</button>
                <button onClick={() => setDelConf(false)} style={ghostBtn()}>Cancel</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// decimal places helper
function pair(t: TradeEntry) {
  if (t.pair.includes('JPY')) return { dp: 3 }
  if (t.pair === 'BTC/USD') return { dp: 2 }
  if (t.pair === 'ETH/USD') return { dp: 2 }
  if (t.pair === 'XAU/USD') return { dp: 2 }
  return { dp: 5 }
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 }}>
      <div style={{ width: 52, height: 52, borderRadius: 10, background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
        📓
      </div>
      <div style={{ textAlign: 'center', maxWidth: 280 }}>
        <div style={{ fontSize: 13, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, marginBottom: 8, letterSpacing: '0.03em' }}>
          No trades logged yet
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.65 }}>
          Every trade you log feeds the analytics panel — win rate, equity curve, emotion patterns, and your best setups. The journal is your edge over time.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 2 }}>
        {[['Track edge', 'var(--positive)'], ['Emotion audit', 'var(--amber)'], ['Setup stats', 'var(--teal)']].map(([label, color]) => (
          <span key={label} style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color, fontSize: 11 }}>●</span> {label}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function JournalPanel() {
  const { tradeHistory, addTrade, updateTrade, deleteTrade } = useTradingContext()
  const [showForm, setShowForm] = useState(false)
  const [fPair,    setFPair]    = useState('')
  const [fOutcome, setFOutcome] = useState('')
  const [fTag,     setFTag]     = useState('')

  const filtered = useMemo(() => tradeHistory.filter(t => {
    if (fPair    && t.pair !== fPair)                     return false
    if (fOutcome && t.outcome !== fOutcome)               return false
    if (fTag     && !t.setupTags.includes(fTag))          return false
    return true
  }), [tradeHistory, fPair, fOutcome, fTag])

  const selSt: React.CSSProperties = {
    background: 'var(--bg-deep)', border: '1px solid var(--border-br)', borderRadius: 4,
    padding: '3px 7px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
    color: 'var(--text-muted)', outline: 'none',
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" style={{ background: '#a78bfa' }} />
          TRADE JOURNAL
          <span style={{
            fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)',
            background: 'var(--bg-deep)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 3,
          }}>{tradeHistory.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {tradeHistory.length > 0 && (
            <button onClick={() => exportCSV(tradeHistory)} style={{
              padding: '3px 10px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
              cursor: 'pointer', border: '1px solid var(--border-br)', borderRadius: 3,
              background: 'transparent', color: 'var(--text-muted)',
            }}>↓ CSV</button>
          )}
          <button onClick={() => setShowForm(s => !s)} style={{
            padding: '3px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            cursor: 'pointer', border: '1px solid rgba(0,229,192,0.5)', borderRadius: 3,
            background: showForm ? 'rgba(0,229,192,0.14)' : 'transparent', color: 'var(--teal)',
          }}>
            {showForm ? '✕ Cancel' : '+ Log Trade'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Log form */}
        {showForm && (
          <TradeForm
            onSave={t => { addTrade(t); setShowForm(false) }}
            onClose={() => setShowForm(false)}
          />
        )}

        {/* Stats bar */}
        {tradeHistory.length > 0 && <StatsBar trades={tradeHistory} />}

        {/* Filter bar */}
        {tradeHistory.length > 0 && (
          <div className="panel-filter-bar">
            <select value={fPair} onChange={e => setFPair(e.target.value)} style={selSt}>
              <option value="">All Pairs</option>
              {PAIRS.map(p => <option key={p} value={p} style={{ background: 'var(--bg-panel)' }}>{p}</option>)}
            </select>
            <select value={fOutcome} onChange={e => setFOutcome(e.target.value)} style={selSt}>
              <option value="">All Outcomes</option>
              {['win', 'loss', 'breakeven'].map(o => <option key={o} value={o} style={{ background: 'var(--bg-panel)' }}>{o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
            </select>
            <select value={fTag} onChange={e => setFTag(e.target.value)} style={selSt}>
              <option value="">All Setups</option>
              {SETUP_TAGS.map(t => <option key={t} value={t} style={{ background: 'var(--bg-panel)' }}>{t}</option>)}
            </select>
            {(fPair || fOutcome || fTag) && (
              <>
                <button onClick={() => { setFPair(''); setFOutcome(''); setFTag('') }} style={{
                  ...selSt, cursor: 'pointer', padding: '3px 9px',
                }}>Clear</button>
                <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', alignSelf: 'center' }}>
                  {filtered.length}/{tradeHistory.length} shown
                </span>
              </>
            )}
          </div>
        )}

        {/* Trade list */}
        {tradeHistory.length === 0 ? (
          <EmptyState />
        ) : filtered.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            No trades match these filters
          </div>
        ) : (
          filtered.map(t => (
            <EntryCard
              key={t.id}
              t={t}
              onDelete={() => deleteTrade(t.id)}
              onEdit={updates => updateTrade(t.id, updates)}
            />
          ))
        )}
      </div>
    </div>
  )
}
