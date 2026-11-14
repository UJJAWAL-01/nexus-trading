'use client'

// PRICE ALERTS — set a level or a daily move on any symbol and get told when
// it happens. Rules are stored in this browser only and checked against the
// app's live quote stream by PriceAlertEngine. No account, no key, no cost.
//
// Honest limit: alerts are checked while NEXUS is open in a tab. Nothing runs
// on a server, so a closed browser cannot alert you.

import { useState, useSyncExternalStore, type CSSProperties, type FormEvent } from 'react'
import useSWR from 'swr'
import { useAlertQuotes, usePriceAlerts, type AddResult, type AlertLiveQuote } from '@/store/priceAlerts'
import { useActiveSymbol, useEffectiveSymbol } from '@/store/symbol'
import { ALERT_KINDS, KIND_LABEL, MAX_RULES, describeRule, type AlertKind } from '@/lib/price-alerts'

const MONO = 'JetBrains Mono, monospace'
const ctl: CSSProperties = {
  background: 'var(--bg-deep)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 3, padding: '5px 7px', fontSize: 11, fontFamily: MONO, minWidth: 0,
}
const lbl: CSSProperties = { fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em', display: 'flex', flexDirection: 'column', gap: 3 }
const btn: CSSProperties = { ...ctl, cursor: 'pointer', fontWeight: 700, color: 'var(--text-2)' }
const th: CSSProperties = { textAlign: 'left', padding: '5px 8px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 10, position: 'sticky', top: 0, background: 'var(--bg-panel)' }
const td: CSSProperties = { padding: '6px 8px', borderTop: '1px solid var(--border)' }

const ADD_MESSAGE: Record<Exclude<AddResult, 'ok'>, string> = {
  'invalid':          'Enter a valid symbol and a number above zero.',
  'full':             `You already have ${MAX_RULES} alerts. Delete one first.`,
  'too-many-symbols': 'Alerts can cover at most 25 different symbols.',
  'duplicate':        'That alert already exists.',
}

type Permission = 'unsupported' | 'default' | 'granted' | 'denied'
const readPermission = (): Permission => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
const noSubscribe = () => () => {}
const serverPermission = (): Permission => 'default'

const fmt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : n.toLocaleString(undefined, { maximumFractionDigits: 2 }))
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function AlertsPanel() {
  const { symbol: active } = useEffectiveSymbol('alerts')
  const setActive = useActiveSymbol(s => s.setActiveSymbol)
  const { rules, history, add, remove, rearm, clearHistory } = usePriceAlerts()

  const [symbol, setSymbol] = useState('')
  const [kind, setKind]     = useState<AlertKind>('above')
  const [value, setValue]   = useState('')
  const [note, setNote]     = useState('')
  const [repeat, setRepeat] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Read the browser's permission without an effect; `asked` holds the answer
  // once the user has responded to the prompt in this session.
  const initial = useSyncExternalStore(noSubscribe, readPermission, serverPermission)
  const [asked, setPermission] = useState<Permission | null>(null)
  const permission = asked ?? initial

  const target = (symbol.trim() || active || '').toUpperCase()
  // Rule symbols come from the engine's stream; the symbol being typed is a
  // single cached lookup, so this panel never opens a stream of its own.
  const quotes = useAlertQuotes(s => s.quotes)
  const status = useAlertQuotes(s => s.status)
  const { data: looked } = useSWR<AlertLiveQuote>(
    target && !quotes[target] ? `/api/yquote?symbol=${encodeURIComponent(target)}` : null,
    { refreshInterval: 30_000, dedupingInterval: 15_000 },
  )
  const live: AlertLiveQuote | undefined = target ? quotes[target] ?? looked : undefined
  const isPct = kind === 'pct-up' || kind === 'pct-down'

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const result = add({ symbol: target, kind, value, note, repeat })
    if (result === 'ok') { setValue(''); setNote(''); setMessage(null) }
    else setMessage(ADD_MESSAGE[result])
  }

  const askPermission = async () => {
    try { setPermission(await Notification.requestPermission()) } catch { setPermission(readPermission()) }
  }

  // Warn before saving a level that is already met: it would fire immediately.
  const numeric = Number(value)
  const alreadyMet = !isPct && live?.price != null && Number.isFinite(numeric) && numeric > 0
    && (kind === 'above' ? live.price >= numeric : live.price <= numeric)

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" />
          PRICE ALERTS
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>
            {rules.filter(r => r.armed).length} ACTIVE · {status === 'live' ? 'LIVE STREAM' : status === 'polling' ? 'POLLING' : status === 'idle' ? 'IDLE' : 'CONNECTING'}
          </span>
        </div>
        {permission === 'default' && <button type="button" style={{ ...btn, color: 'var(--amber)' }} onClick={askPermission}>ENABLE DESKTOP NOTIFICATIONS</button>}
        {permission === 'granted' && <span style={{ fontSize: 10, color: 'var(--positive)', fontFamily: MONO }}>DESKTOP NOTIFICATIONS ON</span>}
        {permission === 'denied' && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }} title="Allow notifications for this site in your browser settings to turn them on.">NOTIFICATIONS BLOCKED IN BROWSER</span>}
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
        <label style={lbl}>
          SYMBOL
          <input style={{ ...ctl, width: 96, textTransform: 'uppercase' }} value={symbol} maxLength={25} placeholder={active ?? 'AAPL'} onChange={e => setSymbol(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <label style={lbl}>
          CONDITION
          <select style={ctl} value={kind} onChange={e => setKind(e.target.value as AlertKind)}>
            {ALERT_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label style={lbl}>
          {isPct ? 'PERCENT' : 'PRICE'}
          <input style={{ ...ctl, width: 88 }} type="number" inputMode="decimal" step="any" min="0" value={value} placeholder={isPct ? '3' : live?.price != null ? String(live.price) : ''} onChange={e => setValue(e.target.value)} required />
        </label>
        <label style={{ ...lbl, flex: '1 1 120px' }}>
          NOTE (OPTIONAL)
          <input style={ctl} value={note} maxLength={80} placeholder="why this level matters" onChange={e => setNote(e.target.value)} />
        </label>
        <label style={{ ...lbl, flexDirection: 'row', alignItems: 'center', gap: 5, paddingBottom: 6 }} title="Fire again each time the condition clears and is met again">
          <input type="checkbox" checked={repeat} onChange={e => setRepeat(e.target.checked)} /> REPEAT
        </label>
        <button type="submit" style={{ ...btn, color: 'var(--bg-base)', background: 'var(--amber)', borderColor: 'var(--amber)' }} disabled={!target}>ADD ALERT</button>
      </form>

      {(message || alreadyMet || target) && (
        <div role="status" style={{ padding: '5px 10px', fontSize: 11, fontFamily: MONO, color: message ? 'var(--negative)' : alreadyMet ? 'var(--amber)' : 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
          {message
            ?? (alreadyMet ? `${target} is already ${kind === 'above' ? 'at or above' : 'at or below'} ${numeric}, so this alert would fire straight away.`
            : `${target} last ${fmt(live?.price)}${live?.change != null ? ` (${live.change > 0 ? '+' : ''}${live.change.toFixed(2)}% today)` : ''}`)}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {rules.length === 0 ? (
          <div style={{ padding: '22px 14px', textAlign: 'center', fontFamily: MONO, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            No alerts yet. Pick a symbol, a condition and a level above.<br />
            Alerts are stored in this browser and checked while NEXUS is open.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: MONO, fontSize: 11 }}>
            <thead><tr><th style={th}>SYMBOL</th><th style={th}>CONDITION</th><th style={{ ...th, textAlign: 'right' }}>LAST</th><th style={{ ...th, textAlign: 'right' }}>DISTANCE</th><th style={th}>STATUS</th><th style={th} /></tr></thead>
            <tbody>
              {rules.map(r => {
                const q = quotes[r.symbol]
                const pctKind = r.kind === 'pct-up' || r.kind === 'pct-down'
                const dist = !pctKind && q?.price ? ((r.value - q.price) / q.price) * 100 : null
                return (
                  <tr key={r.id}>
                    <td style={td}>
                      <button type="button" onClick={() => setActive(r.symbol)} title="Open in chart" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'var(--amber)', fontFamily: MONO, fontWeight: 700, fontSize: 11 }}>{r.symbol}</button>
                      {r.note && <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>{r.note}</div>}
                    </td>
                    <td style={{ ...td, color: 'var(--text)' }}>{describeRule(r)}{r.repeat && <span style={{ color: 'var(--text-muted)' }}> · repeat</span>}</td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>{fmt(q?.price)}</td>
                    <td style={{ ...td, textAlign: 'right', color: 'var(--text-2)' }}>{pctKind ? (q?.change != null ? `${q.change > 0 ? '+' : ''}${q.change.toFixed(2)}% today` : '—') : dist === null ? '—' : `${dist > 0 ? '+' : ''}${dist.toFixed(2)}%`}</td>
                    <td style={td}>
                      {r.armed
                        ? <span style={{ color: 'var(--positive)' }}>WATCHING</span>
                        : <span style={{ color: 'var(--amber)' }} title={r.firedAt ? when(r.firedAt) : undefined}>FIRED{r.firedPrice ? ` @ ${fmt(r.firedPrice)}` : ''}{r.repeat ? ' · waits to reset' : ''}</span>}
                    </td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!r.armed && !r.repeat && <button type="button" style={{ ...btn, padding: '2px 6px', marginRight: 4 }} onClick={() => rearm(r.id)}>RE-ARM</button>}
                      <button type="button" style={{ ...btn, padding: '2px 6px' }} onClick={() => remove(r.id)} aria-label={`Delete alert on ${r.symbol}`}>DELETE</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {history.length > 0 && (
          <div style={{ padding: '10px 10px 6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: MONO, fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 4 }}>
              RECENTLY FIRED
              <button type="button" style={{ ...btn, padding: '2px 6px' }} onClick={clearHistory}>CLEAR</button>
            </div>
            {history.slice(0, 10).map((h, i) => (
              <div key={`${h.ruleId}-${h.at}-${i}`} style={{ display: 'flex', gap: 8, fontFamily: MONO, fontSize: 11, padding: '3px 0', color: 'var(--text-2)' }}>
                <span style={{ color: 'var(--text-muted)', minWidth: 104 }}>{when(h.at)}</span>
                <span style={{ color: 'var(--amber)', fontWeight: 700, minWidth: 60 }}>{h.symbol}</span>
                <span>{describeRule(h)} at {fmt(h.price)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        Checked while NEXUS is open in a tab. Quotes can be delayed, so do not rely on alerts for order execution.
      </div>
    </div>
  )
}
