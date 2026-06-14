'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Screener (spec §4.3). Scans the US + India universe for stocks forming
// or confirming chart/candlestick patterns. Click a row to focus the chart with
// that exact pattern drawn (via the symbol store's focusOnPattern).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react'
import { useActiveSymbol } from '@/store/symbol'
import { useWatchlist } from '@/store/watchlist'
import { SECTORS } from '@/data/universe'

type Tf = '1D' | '1W'
type Dir = 'all' | 'bullish' | 'bearish'
type Status = 'forming' | 'confirmed'

interface ScanDetection {
  id: string; name: string; direction: 'bullish' | 'bearish' | 'neutral'
  status: 'forming' | 'confirmed' | 'failed'; category: string; confidence: number
  breakoutLevel: number | null; target: number | null; ageBar: number
  distToBreakoutPct: number | null; outline: Array<{ x: number; y: number }>
}
interface Row {
  symbol: string; name: string; sector: string; country: string
  price: number; changePct: number; spark: number[]; sparkMin: number; sparkMax: number
  detections: ScanDetection[]
}
interface ScanMeta { scannedAt: number; universeSize: number; scannedCount: number; stale: boolean; queryMs: number }

const PATTERN_GROUPS: Array<{ group: string; items: Array<{ id: string; label: string }> }> = [
  { group: 'Reversal', items: [
    { id: 'head_shoulders', label: 'Head & Shoulders' }, { id: 'inverse_head_shoulders', label: 'Inverse H&S' },
    { id: 'double_top', label: 'Double Top' }, { id: 'double_bottom', label: 'Double Bottom' },
    { id: 'triple_top', label: 'Triple Top' }, { id: 'triple_bottom', label: 'Triple Bottom' },
    { id: 'rising_wedge', label: 'Rising Wedge' }, { id: 'falling_wedge', label: 'Falling Wedge' },
    { id: 'rounding_bottom', label: 'Rounding Bottom' },
  ] },
  { group: 'Continuation', items: [
    { id: 'ascending_triangle', label: 'Ascending Triangle' }, { id: 'descending_triangle', label: 'Descending Triangle' },
    { id: 'symmetrical_triangle', label: 'Symmetrical Triangle' }, { id: 'bull_flag', label: 'Bull Flag' },
    { id: 'bear_flag', label: 'Bear Flag' }, { id: 'bull_pennant', label: 'Bull Pennant' },
    { id: 'bear_pennant', label: 'Bear Pennant' }, { id: 'cup_handle', label: 'Cup & Handle' },
    { id: 'rectangle', label: 'Rectangle' }, { id: 'channel_up', label: 'Ascending Channel' },
    { id: 'channel_down', label: 'Descending Channel' },
  ] },
  { group: 'Candlestick', items: [
    { id: 'hammer', label: 'Hammer' }, { id: 'shooting_star', label: 'Shooting Star' },
    { id: 'bullish_engulfing', label: 'Bullish Engulfing' }, { id: 'bearish_engulfing', label: 'Bearish Engulfing' },
    { id: 'morning_star', label: 'Morning Star' }, { id: 'evening_star', label: 'Evening Star' },
    { id: 'three_white_soldiers', label: 'Three White Soldiers' }, { id: 'three_black_crows', label: 'Three Black Crows' },
  ] },
]

interface Preset { label: string; patterns: string[]; direction: Dir; statuses: Status[]; minConf: number }
const PRESETS: Preset[] = [
  { label: 'Breakout Watch', patterns: ['ascending_triangle', 'descending_triangle', 'symmetrical_triangle', 'bull_flag', 'bear_flag', 'rectangle'], direction: 'all', statuses: ['forming'], minConf: 65 },
  { label: 'Fresh Reversals', patterns: ['head_shoulders', 'inverse_head_shoulders', 'double_top', 'double_bottom'], direction: 'all', statuses: ['confirmed'], minConf: 60 },
  { label: 'Momentum Cont.', patterns: ['bull_flag', 'bull_pennant'], direction: 'bullish', statuses: ['confirmed'], minConf: 60 },
  { label: 'Bottom Fishers', patterns: ['inverse_head_shoulders', 'double_bottom', 'cup_handle'], direction: 'bullish', statuses: ['forming'], minConf: 55 },
]

const DIR_COLOR = { bullish: '#00c97a', bearish: '#ff4560', neutral: '#f0a500' }
const STATUS_COLOR = { forming: '#f0a500', confirmed: '#00c97a', failed: '#6b7280' }

function timeAgo(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

function Spark({ row }: { row: Row }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current; if (!cv) return
    const ctx = cv.getContext('2d'); if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = 60, h = 30
    cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const min = row.sparkMin, max = row.sparkMax, rng = max - min || 1
    const Y = (p: number) => h - 2 - ((p - min) / rng) * (h - 4)
    const X = (i: number) => 1 + (i / Math.max(1, row.spark.length - 1)) * (w - 2)
    // sparkline
    ctx.beginPath()
    row.spark.forEach((p, i) => { const x = X(i), y = Y(p); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
    ctx.strokeStyle = '#5a6b7a'; ctx.lineWidth = 1; ctx.stroke()
    // pattern outline (the "killer detail")
    const det = row.detections[0]
    if (det?.outline?.length) {
      ctx.beginPath()
      det.outline.forEach((pt, i) => { const x = 1 + pt.x * (w - 2), y = Y(pt.y); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y) })
      ctx.strokeStyle = DIR_COLOR[det.direction]; ctx.lineWidth = 1.3; ctx.stroke()
    }
  }, [row])
  return <canvas ref={ref} style={{ width: 60, height: 30, flexShrink: 0 }} />
}

const pillStyle = (active: boolean, color = 'var(--teal)'): CSSProperties => ({
  padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
  border: `1px solid ${active ? color : 'var(--border)'}`,
  background: active ? 'rgba(0,229,192,0.1)' : 'transparent',
  color: active ? color : 'var(--text-2)', whiteSpace: 'nowrap',
})

export default function PatternScreenerPanel() {
  const focusOnPattern = useActiveSymbol(s => s.focusOnPattern)
  const { symbols: watchlist } = useWatchlist()

  const [tf, setTf] = useState<Tf>('1D')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [direction, setDirection] = useState<Dir>('all')
  const [statuses, setStatuses] = useState<Set<Status>>(new Set(['forming', 'confirmed']))
  const [minConf, setMinConf] = useState(55)
  const [country, setCountry] = useState<'ALL' | 'US' | 'IN'>('ALL')
  const [sector, setSector] = useState('ALL')
  const [sortBy, setSortBy] = useState<'confidence' | 'changePct' | 'distance'>('confidence')
  const [patternMenu, setPatternMenu] = useState(false)

  const [rows, setRows] = useState<Row[]>([])
  const [meta, setMeta] = useState<ScanMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setPatternMenu(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const togglePattern = useCallback((id: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const toggleStatus = useCallback((s: Status) => {
    setStatuses(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n.size ? n : new Set([s]) })
  }, [])
  const applyPreset = useCallback((p: Preset) => {
    setSelected(new Set(p.patterns)); setDirection(p.direction); setStatuses(new Set(p.statuses)); setMinConf(p.minConf)
  }, [])

  const watchKey = watchlist.join(',')
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    const params = new URLSearchParams()
    params.set('tf', tf)
    if (selected.size) params.set('pattern', [...selected].join(','))
    if (direction !== 'all') params.set('direction', direction)
    params.set('status', [...statuses].join(','))
    params.set('minConfidence', String(minConf))
    if (country !== 'ALL') params.set('country', country)
    if (sector !== 'ALL') params.set('sector', sector)
    params.set('sortBy', sortBy)
    if (watchKey) params.set('watchlist', watchKey)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/pattern-scan?${params.toString()}`)
        const j = await r.json()
        if (cancelled) return
        if (j.error) { setError(j.error); setRows([]) }
        else { setRows(j.results ?? []); setMeta(j.meta ?? null) }
      } catch {
        if (!cancelled) setError('Scan request failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [tf, selected, direction, statuses, minConf, country, sector, sortBy, watchKey])

  const selectedLabel = useMemo(() => selected.size === 0 ? 'All patterns' : `${selected.size} selected`, [selected])

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between', padding: '6px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div className="dot" />
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '12px', letterSpacing: '0.05em' }}>PATTERN SCREENER</span>
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['1D', '1W'] as Tf[]).map(t => (
            <button key={t} onClick={() => setTf(t)} style={pillStyle(tf === t, 'var(--amber)')}>{t}</button>
          ))}
        </div>
      </div>

      {/* presets */}
      <div style={{ display: 'flex', gap: '4px', padding: '6px 10px', borderBottom: '1px solid var(--border)', overflowX: 'auto', background: 'rgba(0,0,0,0.18)' }}>
        {PRESETS.map(p => (
          <button key={p.label} onClick={() => applyPreset(p)} style={{
            padding: '3px 9px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', flexShrink: 0,
            fontFamily: 'Syne, sans-serif', fontWeight: 700, border: '1px solid var(--border)',
            background: 'var(--bg-deep)', color: 'var(--text-2)', whiteSpace: 'nowrap',
          }}>{p.label}</button>
        ))}
      </div>

      {/* filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        {/* pattern multi-select */}
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button onClick={() => setPatternMenu(v => !v)} style={pillStyle(selected.size > 0)}>
            {selectedLabel} ▾
          </button>
          {patternMenu && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000, width: 220, maxHeight: 300, overflowY: 'auto', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 5, boxShadow: '0 12px 40px rgba(0,0,0,0.7)' }}>
              {selected.size > 0 && (
                <div onMouseDown={() => setSelected(new Set())} style={{ padding: '5px 10px', fontSize: 10, color: 'var(--negative)', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid var(--border)' }}>Clear all</div>
              )}
              {PATTERN_GROUPS.map(g => (
                <div key={g.group}>
                  <div style={{ padding: '5px 10px 2px', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace' }}>{g.group.toUpperCase()}</div>
                  {g.items.map(it => (
                    <div key={it.id} onMouseDown={() => togglePattern(it.id)} style={{ padding: '4px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7, background: selected.has(it.id) ? 'rgba(0,229,192,0.06)' : 'transparent' }}>
                      <span style={{ width: 11, height: 11, borderRadius: 2, border: `1px solid ${selected.has(it.id) ? 'var(--teal)' : 'var(--border)'}`, background: selected.has(it.id) ? 'var(--teal)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        {selected.has(it.id) && <span style={{ color: '#000', fontSize: 9, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                      </span>
                      <span style={{ fontSize: 11, color: selected.has(it.id) ? '#fff' : 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{it.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* direction pills */}
        {(['all', 'bullish', 'bearish'] as Dir[]).map(d => (
          <button key={d} onClick={() => setDirection(d)} style={pillStyle(direction === d, d === 'bearish' ? '#ff4560' : d === 'bullish' ? '#00c97a' : 'var(--teal)')}>
            {d === 'all' ? 'All' : d.charAt(0).toUpperCase() + d.slice(1)}
          </button>
        ))}

        {/* status pills */}
        {(['forming', 'confirmed'] as Status[]).map(s => (
          <button key={s} onClick={() => toggleStatus(s)} style={pillStyle(statuses.has(s), STATUS_COLOR[s])}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}

        {/* country */}
        <select value={country} onChange={e => setCountry(e.target.value as 'ALL' | 'US' | 'IN')} style={selStyle}>
          <option value="ALL">All mkts</option><option value="US">US</option><option value="IN">India</option>
        </select>
        {/* sector */}
        <select value={sector} onChange={e => setSector(e.target.value)} style={selStyle}>
          <option value="ALL">All sectors</option>
          {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {/* sort */}
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)} style={selStyle}>
          <option value="confidence">Quality</option><option value="changePct">% Change</option><option value="distance">Near breakout</option>
        </select>

        {/* min quality slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>Q≥{minConf}</span>
          <input type="range" min={0} max={95} value={minConf} onChange={e => setMinConf(Number(e.target.value))} style={{ width: 70, accentColor: 'var(--teal)' }} />
        </div>
      </div>

      {/* scanned-at line */}
      <div style={{ padding: '3px 10px', fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{meta ? `universe scanned ${timeAgo(meta.scannedAt)} · ${meta.scannedCount}/${meta.universeSize} symbols${meta.stale ? ' · refreshing…' : ''}` : 'scanning…'}</span>
        <span>{rows.length} matches</span>
      </div>

      {/* results */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading && rows.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            Scanning the universe… first sweep can take a moment.
          </div>
        )}
        {error && <div style={{ padding: 16, color: '#ff8c42', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
            No symbols match these filters.
          </div>
        )}
        {rows.map(row => {
          const det = row.detections[0]
          const up = row.changePct >= 0
          return (
            <button key={row.symbol} onClick={() => focusOnPattern(row.symbol, det.id, tf)} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
              padding: '7px 10px', borderBottom: '1px solid rgba(30,45,61,0.5)', background: 'transparent', border: 'none', borderBottomStyle: 'solid',
            }}>
              <div style={{ minWidth: 76, flexShrink: 0 }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 12, color: '#fff' }}>{row.symbol.replace('.NS', '')}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>{row.name}</div>
              </div>
              <div style={{ minWidth: 60, flexShrink: 0, fontFamily: 'JetBrains Mono, monospace' }}>
                <div style={{ fontSize: 11, color: '#fff' }}>{row.price}</div>
                <div style={{ fontSize: 10, color: up ? 'var(--positive)' : 'var(--negative)' }}>{up ? '+' : ''}{row.changePct}%</div>
              </div>
              <Spark row={row} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {row.detections.slice(0, 3).map((d, i) => (
                  <span key={i} style={{
                    fontSize: 9, fontFamily: 'JetBrains Mono, monospace', padding: '1px 6px', borderRadius: 3,
                    border: `1px solid ${DIR_COLOR[d.direction]}55`, color: DIR_COLOR[d.direction], background: `${DIR_COLOR[d.direction]}14`,
                  }}>{d.name} {d.confidence}</span>
                ))}
              </div>
              <div style={{ minWidth: 64, flexShrink: 0, textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: STATUS_COLOR[det.status], textTransform: 'uppercase' }}>{det.status}</div>
                {det.distToBreakoutPct != null && (
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{det.distToBreakoutPct > 0 ? '+' : ''}{det.distToBreakoutPct.toFixed(1)}% to brk</div>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const selStyle: CSSProperties = {
  padding: '2px 6px', borderRadius: 3, fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
  border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text-2)', cursor: 'pointer',
}
