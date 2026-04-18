'use client'

import { useState, useMemo } from 'react'
import { useTradingContext, TradeEntry } from '@/components/trading/TradingContext'

// ── Constants ─────────────────────────────────────────────────────────────────

const PAIRS      = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'BTC/USD', 'ETH/USD', 'XAU/USD']
const SETUP_TAGS = ['Trend Follow', 'Breakout', 'Reversal', 'News Play', 'ICT Setup', 'Custom'] as const
const EMOTIONS   = ['Confident', 'Hesitant', 'FOMO', 'Neutral', 'Revenge'] as const
type SetupTag    = typeof SETUP_TAGS[number]

// ── Calculations ──────────────────────────────────────────────────────────────

function calcOutcome(entry: number, exit: number, dir: 'long' | 'short'): 'win' | 'loss' | 'breakeven' {
  const diff = dir === 'long' ? exit - entry : entry - exit
  if (Math.abs(diff) < entry * 0.0001) return 'breakeven'
  return diff > 0 ? 'win' : 'loss'
}
function calcRR(entry: number, sl: number, tp: number): number {
  return Math.abs(entry - sl) > 0 ? Math.abs(tp - entry) / Math.abs(entry - sl) : 0
}
function calcPips(entry: number, exit: number, pair: string, dir: 'long' | 'short'): number {
  const diff = dir === 'long' ? exit - entry : entry - exit
  return diff / (pair.includes('JPY') ? 0.01 : 0.0001)
}

// ── Shared input style ────────────────────────────────────────────────────────

const IS: React.CSSProperties = {
  width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border-br)',
  borderRadius: 4, padding: '5px 8px', fontSize: 11,
  fontFamily: 'JetBrains Mono, monospace', color: 'var(--text)', outline: 'none', boxSizing: 'border-box',
}
const LS: React.CSSProperties = {
  fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)',
  letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 3, display: 'block',
}

// ── Outcome badge ─────────────────────────────────────────────────────────────

function OutcomeBadge({ o }: { o: TradeEntry['outcome'] }) {
  const cfg = {
    win:       { bg: 'rgba(0,201,122,0.15)',  color: 'var(--positive)', label: 'WIN' },
    loss:      { bg: 'rgba(255,69,96,0.15)',  color: 'var(--negative)', label: 'LOSS' },
    breakeven: { bg: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', label: 'B/E' },
  }[o]
  return (
    <span style={{
      background: cfg.bg, color: cfg.color, fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
      fontWeight: 700, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.06em',
      border: `1px solid ${cfg.color}40`,
    }}>{cfg.label}</span>
  )
}

// ── Trade form ────────────────────────────────────────────────────────────────

function TradeForm({ onClose }: { onClose: () => void }) {
  const { addTrade } = useTradingContext()
  const [pair,      setPair]      = useState('EUR/USD')
  const [dir,       setDir]       = useState<'long' | 'short'>('long')
  const [entry,     setEntry]     = useState('')
  const [exit,      setExit]      = useState('')
  const [sl,        setSl]        = useState('')
  const [tp,        setTp]        = useState('')
  const [dt,        setDt]        = useState(new Date().toISOString().slice(0, 16))
  const [tags,      setTags]      = useState<SetupTag[]>([])
  const [planned,   setPlanned]   = useState(true)
  const [whyNot,    setWhyNot]    = useState('')
  const [emotion,   setEmotion]   = useState('Neutral')
  const [notes,     setNotes]     = useState('')
  const [shot,      setShot]      = useState('')

  const toggleTag = (t: SetupTag) => setTags(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])

  const save = () => {
    const [eN, xN, sN, tN] = [Number(entry), Number(exit), Number(sl), Number(tp)]
    if (!eN || !xN) return
    addTrade({
      pair, direction: dir, entryPrice: eN, exitPrice: xN, stopLoss: sN, takeProfit: tN,
      dateTime: dt, setupTags: tags, wasPlanned: planned, whyNotPlanned: whyNot,
      emotion, notes, screenshotUrl: shot,
      outcome: calcOutcome(eN, xN, dir),
      rr: sN && tN ? calcRR(eN, sN, tN) : 0,
      pips: calcPips(eN, xN, pair, dir),
      pnl: dir === 'long' ? xN - eN : eN - xN,
    })
    onClose()
  }

  const btnToggle = (active: boolean, danger = false): React.CSSProperties => ({
    padding: '5px 14px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
    cursor: 'pointer', border: `1px solid ${active ? (danger ? 'rgba(255,69,96,0.5)' : 'rgba(0,201,122,0.5)') : 'var(--border-br)'}`,
    borderRadius: 4, background: active ? (danger ? 'rgba(255,69,96,0.12)' : 'rgba(0,201,122,0.12)') : 'transparent',
    color: active ? (danger ? 'var(--negative)' : 'var(--positive)') : 'var(--text-muted)',
  })

  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-deep)' }}>
      <div style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
        Log New Trade
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        <label><span style={LS}>Pair</span>
          <select value={pair} onChange={e => setPair(e.target.value)} style={IS}>
            {PAIRS.map(p => <option key={p} value={p} style={{ background: 'var(--bg-panel)' }}>{p}</option>)}
          </select>
        </label>
        <label><span style={LS}>Direction</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setDir('long')} style={btnToggle(dir === 'long')}>▲ Long</button>
            <button onClick={() => setDir('short')} style={btnToggle(dir === 'short', true)}>▼ Short</button>
          </div>
        </label>
        <label><span style={LS}>Date / Time</span>
          <input type="datetime-local" value={dt} onChange={e => setDt(e.target.value)} style={IS} />
        </label>
        <label><span style={LS}>Entry Price</span>
          <input type="number" value={entry} placeholder="0.00000" onChange={e => setEntry(e.target.value)} style={IS} />
        </label>
        <label><span style={LS}>Exit Price</span>
          <input type="number" value={exit} placeholder="0.00000" onChange={e => setExit(e.target.value)} style={IS} />
        </label>
        <label><span style={LS}>Stop Loss</span>
          <input type="number" value={sl} placeholder="0.00000" onChange={e => setSl(e.target.value)} style={IS} />
        </label>
        <label><span style={LS}>Take Profit</span>
          <input type="number" value={tp} placeholder="0.00000" onChange={e => setTp(e.target.value)} style={IS} />
        </label>
        <label><span style={LS}>Emotion</span>
          <select value={emotion} onChange={e => setEmotion(e.target.value)} style={IS}>
            {EMOTIONS.map(e => <option key={e} value={e} style={{ background: 'var(--bg-panel)' }}>{e}</option>)}
          </select>
        </label>
        <label><span style={LS}>Screenshot URL</span>
          <input type="url" value={shot} placeholder="https://…" onChange={e => setShot(e.target.value)} style={IS} />
        </label>
      </div>

      {/* Setup tags */}
      <div style={{ marginTop: 8 }}>
        <span style={LS}>Setup Tags</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {SETUP_TAGS.map(t => (
            <button key={t} onClick={() => toggleTag(t)} style={{
              padding: '3px 9px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', borderRadius: 3,
              border: `1px solid ${tags.includes(t) ? 'rgba(0,229,192,0.5)' : 'var(--border-br)'}`,
              background: tags.includes(t) ? 'rgba(0,229,192,0.12)' : 'transparent',
              color: tags.includes(t) ? 'var(--teal)' : 'var(--text-muted)',
            }}>{t}</button>
          ))}
        </div>
      </div>

      {/* Planned? */}
      <div style={{ marginTop: 8 }}>
        <span style={LS}>In Your Plan?</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setPlanned(true)} style={btnToggle(planned)}>Yes</button>
          <button onClick={() => setPlanned(false)} style={btnToggle(!planned, true)}>No</button>
        </div>
        {!planned && (
          <input type="text" value={whyNot} onChange={e => setWhyNot(e.target.value)}
            placeholder="Why wasn't this in your plan?" style={{ ...IS, marginTop: 5 }} />
        )}
      </div>

      {/* Notes */}
      <div style={{ marginTop: 8 }}>
        <span style={LS}>Notes</span>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
          placeholder="Trade rationale, observations…"
          style={{ ...IS, resize: 'none' }} />
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button onClick={save} style={{
          padding: '6px 16px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
          cursor: 'pointer', border: '1px solid rgba(0,229,192,0.5)', borderRadius: 4,
          background: 'rgba(0,229,192,0.14)', color: 'var(--teal)',
        }}>Save Trade</button>
        <button onClick={onClose} className="nx-btn">Cancel</button>
      </div>
    </div>
  )
}

// ── Entry card ────────────────────────────────────────────────────────────────

function EntryCard({ t, onDelete }: { t: TradeEntry; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const dirColor = t.direction === 'long' ? 'var(--positive)' : 'var(--negative)'

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', cursor: 'pointer' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.02)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, color: 'var(--text)' }}>{t.pair}</span>
          <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: dirColor }}>
            {t.direction === 'long' ? '▲' : '▼'} {t.direction}
          </span>
          <OutcomeBadge o={t.outcome} />
          {t.setupTags.slice(0, 2).map(tag => (
            <span key={tag} style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: 2 }}>
              {tag}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)' }}>
            {new Date(t.dateTime).toLocaleDateString()}
          </span>
          {t.rr > 0 && (
            <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-2)' }}>1:{t.rr.toFixed(2)}R</span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div style={{ padding: '8px 14px 12px', background: 'var(--bg-deep)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
            {[['Entry', t.entryPrice.toFixed(5)], ['Exit', t.exitPrice.toFixed(5)], ['SL', t.stopLoss > 0 ? t.stopLoss.toFixed(5) : '—'], ['TP', t.takeProfit > 0 ? t.takeProfit.toFixed(5) : '—'],
              ['Pips', t.pips.toFixed(1)], ['P&L', `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(5)}`], ['Emotion', t.emotion], ['Planned', t.wasPlanned ? 'Yes' : 'No']
            ].map(([l, v]) => (
              <div key={l}>
                <div style={{ fontSize: 9, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2 }}>{l}</div>
                <div style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          {!t.wasPlanned && t.whyNotPlanned && (
            <div style={{ padding: '5px 8px', background: 'rgba(255,69,96,0.08)', border: '1px solid rgba(255,69,96,0.2)', borderRadius: 4, fontSize: 11, color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 6 }}>
              <strong>Unplanned:</strong> {t.whyNotPlanned}
            </div>
          )}
          {t.notes && (
            <div style={{ padding: '5px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, fontSize: 11, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6, marginBottom: 6 }}>
              {t.notes}
            </div>
          )}
          <button onClick={onDelete} style={{ fontSize: 10, color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            ✕ Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function JournalPanel() {
  const { tradeHistory, deleteTrade } = useTradingContext()
  const [showForm,  setShowForm]  = useState(false)
  const [fPair,     setFPair]     = useState('')
  const [fOutcome,  setFOutcome]  = useState('')
  const [fTag,      setFTag]      = useState('')

  const filtered = useMemo(() => tradeHistory.filter(t => {
    if (fPair    && t.pair    !== fPair)    return false
    if (fOutcome && t.outcome !== fOutcome) return false
    if (fTag     && !t.setupTags.includes(fTag as SetupTag)) return false
    return true
  }), [tradeHistory, fPair, fOutcome, fTag])

  const selStyle: React.CSSProperties = {
    background: 'var(--bg-deep)', border: '1px solid var(--border-br)', borderRadius: 4,
    padding: '4px 8px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', outline: 'none',
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" style={{ background: '#a78bfa' }} />
          TRADE JOURNAL
          <span style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', background: 'var(--bg-deep)', border: '1px solid var(--border)', padding: '1px 6px', borderRadius: 3 }}>
            {tradeHistory.length}
          </span>
        </div>
        <button onClick={() => setShowForm(s => !s)} style={{
          padding: '3px 12px', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
          cursor: 'pointer', border: '1px solid rgba(0,229,192,0.5)', borderRadius: 3,
          background: showForm ? 'rgba(0,229,192,0.14)' : 'transparent', color: 'var(--teal)',
        }}>
          {showForm ? '✕ Cancel' : '+ Log Trade'}
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {showForm && <TradeForm onClose={() => setShowForm(false)} />}

        {tradeHistory.length > 0 && (
          <div className="panel-filter-bar">
            <select value={fPair} onChange={e => setFPair(e.target.value)} style={selStyle}>
              <option value="">All Pairs</option>
              {PAIRS.map(p => <option key={p} value={p} style={{ background: 'var(--bg-panel)' }}>{p}</option>)}
            </select>
            <select value={fOutcome} onChange={e => setFOutcome(e.target.value)} style={selStyle}>
              <option value="">All Outcomes</option>
              {['win','loss','breakeven'].map(o => <option key={o} value={o} style={{ background: 'var(--bg-panel)' }}>{o}</option>)}
            </select>
            <select value={fTag} onChange={e => setFTag(e.target.value)} style={selStyle}>
              <option value="">All Setups</option>
              {SETUP_TAGS.map(t => <option key={t} value={t} style={{ background: 'var(--bg-panel)' }}>{t}</option>)}
            </select>
            {(fPair || fOutcome || fTag) && (
              <button onClick={() => { setFPair(''); setFOutcome(''); setFTag('') }} className="nx-btn" style={{ fontSize: 10 }}>Clear</button>
            )}
          </div>
        )}

        {tradeHistory.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <span style={{ fontSize: 36, opacity: 0.2 }}>📓</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              Start logging trades to see analytics
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
              Track entries, emotions, and setups to improve your edge
            </span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            No trades match these filters
          </div>
        ) : (
          filtered.map(t => <EntryCard key={t.id} t={t} onDelete={() => deleteTrade(t.id)} />)
        )}
      </div>
    </div>
  )
}
