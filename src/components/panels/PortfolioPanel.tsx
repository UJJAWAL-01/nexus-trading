'use client'

// PORTFOLIO — positions, live P&L and CSV import/export.
//
// Data handling:
//   • Positions live only in this browser (zustand → localStorage). Nothing is
//     uploaded. Move them with CSV export/import or a workspace backup.
//   • Prices arrive over the shared quote stream (one SSE connection for the
//     whole panel) with automatic fallback to polling.
//   • Totals are grouped per currency. USD and INR positions are never summed
//     together, because that number would be meaningless without an FX rate.

import { useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { usePortfolio, positionPnl, sanitizePosition, MAX_POSITIONS, type PositionInput } from '@/store/portfolio'
import { useQuoteStream } from '@/lib/useQuoteStream'
import { useActiveSymbol } from '@/store/symbol'
import { downloadCsv, parseCsv } from '@/lib/export'

const MONO = 'JetBrains Mono, monospace'

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', INR: '₹', CNY: '¥', CAD: 'C$', AUD: 'A$',
}

function money(n: number | null, currency: string, signed = false): string {
  if (n === null || !Number.isFinite(n)) return '—'
  const sym  = CURRENCY_SYMBOLS[currency] ?? `${currency} `
  const abs  = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const sign = n < 0 ? '-' : signed && n > 0 ? '+' : ''
  return `${sign}${sym}${abs}`
}

function pct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}

const tone = (n: number | null): string =>
  n === null || n === 0 ? 'var(--text-2)' : n > 0 ? 'var(--positive)' : 'var(--negative)'

function guessCurrency(symbol: string): string {
  return symbol.endsWith('.NS') || symbol.endsWith('.BO') ? 'INR' : 'USD'
}

const btn: CSSProperties = {
  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)',
  borderRadius: 3, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
  fontFamily: MONO, fontWeight: 700, minHeight: 26,
}
const input: CSSProperties = {
  background: 'var(--bg-deep)', border: '1px solid var(--border)', color: 'var(--text)',
  borderRadius: 3, padding: '6px 8px', fontSize: 12, fontFamily: MONO, minWidth: 0, width: '100%',
}
const th: CSSProperties = {
  padding: '6px 8px', fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-muted)',
  fontFamily: MONO, fontWeight: 700, textAlign: 'right', position: 'sticky', top: 0,
  background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap',
}
const td: CSSProperties = {
  padding: '7px 8px', fontSize: 12, fontFamily: MONO, textAlign: 'right', whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
}

export default function PortfolioPanel() {
  const positions  = usePortfolio(s => s.positions)
  const upsert     = usePortfolio(s => s.upsert)
  const remove     = usePortfolio(s => s.remove)
  const replaceAll = usePortfolio(s => s.replaceAll)
  const setActiveSymbol = useActiveSymbol(s => s.setActiveSymbol)

  const symbols = useMemo(() => positions.map(p => p.symbol), [positions])
  const { quotes, status } = useQuoteStream(symbols)

  const [adding, setAdding] = useState(false)
  const [form, setForm]     = useState({ symbol: '', qty: '', avgCost: '' })
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(() => positions.map(p => {
    const q = quotes[p.symbol]
    const currency = q?.currency ?? guessCurrency(p.symbol)
    return { p, q, currency, pnl: positionPnl(p, q?.price ?? null, q?.changeAbs ?? null) }
  }), [positions, quotes])

  const totals = useMemo(() => {
    const by = new Map<string, { value: number; cost: number; day: number; priced: number; count: number }>()
    for (const r of rows) {
      const t = by.get(r.currency) ?? { value: 0, cost: 0, day: 0, priced: 0, count: 0 }
      t.count++
      if (r.pnl.marketValue !== null) {
        t.value += r.pnl.marketValue
        t.cost  += r.pnl.costBasis
        t.day   += r.pnl.dayChange ?? 0
        t.priced++
      }
      by.set(r.currency, t)
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const clean = sanitizePosition({ symbol: form.symbol, qty: form.qty, avgCost: form.avgCost })
    if (!clean) {
      setNotice({ text: 'Enter a valid symbol, a non-zero quantity and a cost of 0 or more.', ok: false })
      return
    }
    if (!upsert(clean)) {
      setNotice({ text: `Portfolio is limited to ${MAX_POSITIONS} positions.`, ok: false })
      return
    }
    setForm({ symbol: '', qty: '', avgCost: '' })
    setNotice({ text: `${clean.symbol} saved.`, ok: true })
  }

  const exportCsv = () => {
    downloadCsv(
      'nexus-portfolio',
      ['symbol', 'quantity', 'avg_cost', 'currency', 'last_price', 'market_value', 'day_pnl', 'unrealized_pnl', 'unrealized_pct'],
      rows.map(r => [
        r.p.symbol, r.p.qty, r.p.avgCost, r.currency, r.q?.price ?? null,
        r.pnl.marketValue, r.pnl.dayChange, r.pnl.unrealized,
        r.pnl.unrealizedPct === null ? null : Number(r.pnl.unrealizedPct.toFixed(4)),
      ]),
    )
  }

  const importCsv = async (file: File) => {
    try {
      if (file.size > 1024 * 1024) throw new Error('File is larger than 1 MB.')
      const table = parseCsv(await file.text())
      if (table.length < 2) throw new Error('No rows found.')
      const head = table[0].map(h => h.trim().toLowerCase().replace(/^'/, ''))
      const col  = (...names: string[]) => head.findIndex(h => names.includes(h))
      const iSym = col('symbol', 'ticker')
      const iQty = col('quantity', 'qty', 'shares')
      const iAvg = col('avg_cost', 'avgcost', 'cost', 'price', 'average cost')
      if (iSym < 0 || iQty < 0 || iAvg < 0) throw new Error('Need columns: symbol, quantity, avg_cost.')
      const inputs: PositionInput[] = []
      for (const r of table.slice(1)) {
        const clean = sanitizePosition({ symbol: (r[iSym] ?? '').replace(/^'/, ''), qty: r[iQty], avgCost: r[iAvg] })
        if (clean) inputs.push(clean)
      }
      if (!inputs.length) throw new Error('No valid positions in the file.')
      if (positions.length && !window.confirm(`Replace the current ${positions.length} position(s) with ${inputs.length} from the file?`)) return
      const kept = replaceAll(inputs)
      setNotice({ text: `Imported ${kept} position(s).`, ok: true })
    } catch (err) {
      setNotice({ text: err instanceof Error ? err.message : 'Import failed.', ok: false })
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const statusLabel = status === 'live' ? 'LIVE' : status === 'polling' ? 'POLLING' : status === 'connecting' ? 'CONNECTING' : ''
  const statusColor = status === 'live' ? 'var(--positive)' : status === 'polling' ? 'var(--amber)' : 'var(--text-muted)'

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="panel-header" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="dot" />
          PORTFOLIO
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: MONO }}>{positions.length}</span>
          {statusLabel && (
            <span
              title={status === 'live' ? 'Prices pushed over a live stream' : status === 'polling' ? 'Live stream unavailable; refreshing every 20s' : 'Connecting to the price stream'}
              style={{ fontSize: 10, color: statusColor, fontFamily: MONO, fontWeight: 700, letterSpacing: '0.08em' }}
            >
              ● {statusLabel}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" style={btn} onClick={() => fileRef.current?.click()} title="Import positions from a CSV file (symbol, quantity, avg_cost)">IMPORT</button>
          <button type="button" style={{ ...btn, opacity: rows.length ? 1 : 0.4 }} disabled={!rows.length} onClick={exportCsv} title="Download positions and P&L as CSV">EXPORT CSV</button>
          <button
            type="button"
            aria-expanded={adding}
            onClick={() => { setAdding(v => !v); setNotice(null) }}
            style={{ ...btn, background: adding ? 'var(--amber)' : 'transparent', borderColor: adding ? 'var(--amber)' : 'var(--border)', color: adding ? 'var(--bg-deep)' : 'var(--text-2)' }}
          >
            {adding ? '✕ CLOSE' : '+ ADD'}
          </button>
          <input
            ref={fileRef} type="file" accept=".csv,text/csv" hidden aria-label="Import portfolio CSV"
            onChange={e => { const f = e.target.files?.[0]; if (f) void importCsv(f) }}
          />
        </div>
      </div>

      {adding && (
        <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr auto', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          <input style={input} aria-label="Symbol" placeholder="SYMBOL  e.g. AAPL, TCS.NS" value={form.symbol} maxLength={25}
            onChange={e => setForm(f => ({ ...f, symbol: e.target.value.toUpperCase() }))} />
          <input style={input} aria-label="Quantity" placeholder="QTY" inputMode="decimal" value={form.qty}
            onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
          <input style={input} aria-label="Average cost per share" placeholder="AVG COST" inputMode="decimal" value={form.avgCost}
            onChange={e => setForm(f => ({ ...f, avgCost: e.target.value }))} />
          <button type="submit" style={{ ...btn, background: 'var(--amber)', borderColor: 'var(--amber)', color: 'var(--bg-deep)' }}>SAVE</button>
        </form>
      )}

      {notice && (
        <div role="status" style={{ padding: '6px 10px', fontSize: 11, fontFamily: MONO, color: notice.ok ? 'var(--positive)' : 'var(--negative)', borderBottom: '1px solid var(--border)' }}>
          {notice.text}
        </div>
      )}

      {totals.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          {totals.map(([currency, t]) => {
            const total = t.value - t.cost
            return (
              <div key={currency} style={{ flex: '1 1 220px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-deep)' }}>
                <Stat label={`VALUE · ${currency}`} value={t.priced ? money(t.value, currency) : '—'} />
                <Stat label="DAY P&L" value={t.priced ? money(t.day, currency, true) : '—'} color={tone(t.priced ? t.day : null)} />
                <Stat label="TOTAL P&L" value={t.priced ? money(total, currency, true) : '—'} color={tone(t.priced ? total : null)}
                  sub={t.priced && t.cost !== 0 ? pct((total / Math.abs(t.cost)) * 100) : undefined} />
                {t.priced < t.count && (
                  <div style={{ gridColumn: '1 / -1', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO }}>
                    {t.count - t.priced} position(s) awaiting a price are excluded from these totals.
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {rows.length === 0 ? (
          <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: MONO, fontSize: 12, lineHeight: 1.7 }}>
            <div style={{ color: 'var(--text-2)', fontWeight: 700, marginBottom: 6 }}>No positions yet</div>
            Add a position with <strong>+ ADD</strong> or import a CSV with the columns<br />
            <code>symbol, quantity, avg_cost</code>.<br />
            Positions stay in this browser. Nothing is uploaded.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>SYMBOL</th>
                <th style={th}>QTY</th>
                <th style={th}>AVG COST</th>
                <th style={th}>LAST</th>
                <th style={th}>DAY</th>
                <th style={th}>VALUE</th>
                <th style={th}>P&amp;L</th>
                <th style={th}>P&amp;L %</th>
                <th style={th}><span style={{ position: 'absolute', left: -9999 }}>Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, q, currency, pnl }) => (
                <tr key={p.id}>
                  <td style={{ ...td, textAlign: 'left' }}>
                    <button
                      type="button" onClick={() => setActiveSymbol(p.symbol)} title={`Focus ${p.symbol} across the dashboard`}
                      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--amber)', fontFamily: MONO, fontSize: 12, fontWeight: 700 }}
                    >
                      {p.symbol}
                    </button>
                  </td>
                  <td style={td}>{p.qty.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                  <td style={td}>{money(p.avgCost, currency)}</td>
                  <td style={td}>{money(q?.price ?? null, currency)}</td>
                  <td style={{ ...td, color: tone(q?.change ?? null) }}>{pct(q?.change ?? null)}</td>
                  <td style={td}>{money(pnl.marketValue, currency)}</td>
                  <td style={{ ...td, color: tone(pnl.unrealized) }}>{money(pnl.unrealized, currency, true)}</td>
                  <td style={{ ...td, color: tone(pnl.unrealizedPct) }}>{pct(pnl.unrealizedPct)}</td>
                  <td style={{ ...td, width: 28 }}>
                    <button
                      type="button" aria-label={`Remove ${p.symbol}`} title={`Remove ${p.symbol}`}
                      onClick={() => { if (window.confirm(`Remove ${p.symbol} from the portfolio?`)) remove(p.id) }}
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, padding: '2px 6px' }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, borderTop: '1px solid var(--border)' }}>
        Prices may be delayed. Unrealized P&amp;L only; excludes fees, dividends and FX. Not financial advice.
      </div>
    </div>
  )
}

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, fontFamily: MONO, color: color ?? 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, fontFamily: MONO, color: color ?? 'var(--text-muted)' }}>{sub}</div>}
    </div>
  )
}
