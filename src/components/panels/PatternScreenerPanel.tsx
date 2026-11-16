'use client'

// ─────────────────────────────────────────────────────────────────────────────
// Pattern Screener. Scans the US list and the whole Nifty 500 for stocks that
// are forming or have confirmed chart and candlestick patterns. The universe
// is loaded chunk by chunk (results appear as they arrive) and filtered here in
// the browser, so picking a pattern is instant. Click a row to open the chart
// with that exact pattern drawn (via the symbol store's focusOnPattern).
// ─────────────────────────────────────────────────────────────────────────────

import { usePanelGuide } from '@/components/ui/Motion'
import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from 'react'
import { useActiveSymbol } from '@/store/symbol'
import { useWatchlist } from '@/store/watchlist'
import { SECTORS, UNIVERSE_BY_SYMBOL, chunkCount, SCAN_CHUNK, type ScanMarket } from '@/data/universe'

type Tf = '1D' | '1W'
type Dir = 'all' | 'bullish' | 'bearish'
type Status = 'forming' | 'confirmed'
type Market = 'ALL' | ScanMarket

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
interface Chunk { rows: Row[]; symbols: number; scanned: number; scannedAt: number; complete: boolean }

// ── Chunk loader ─────────────────────────────────────────────────────────────
// Complete chunks are remembered for the session so switching market, timeframe
// or tab does not scan again.
const CHUNK_TTL = 30 * 60_000
const chunkMemo = new Map<string, { at: number; data: Chunk }>()

async function loadChunk(url: string, signal: AbortSignal): Promise<Chunk | null> {
  const hit = chunkMemo.get(url)
  if (hit && Date.now() - hit.at < CHUNK_TTL) return hit.data
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { signal })
      if (r.ok) {
        const data = await r.json() as Chunk
        if (Array.isArray(data?.rows)) {
          if (data.complete) chunkMemo.set(url, { at: Date.now(), data })
          return data
        }
      }
    } catch { if (signal.aborted) return null }
    await new Promise(res => setTimeout(res, 1500))
    if (signal.aborted) return null
  }
  return null
}

const MARKET_KEY = 'nexus-pattern-market'
const PAGE = 80

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
  padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', fontSize: '12px', fontFamily: 'var(--font-data)',
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
  const [market, setMarketState] = useState<Market>('ALL')
  const [sector, setSector] = useState('ALL')
  const [sortBy, setSortBy] = useState<'confidence' | 'changePct' | 'distance'>('confidence')
  const [shown, setShown] = useState(PAGE)

  const [all, setAll] = useState<Row[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0, symbols: 0, scanned: 0, failed: 0, at: 0 })
  const [reload, setReload] = useState(0)

  useEffect(() => {
    try { const m = localStorage.getItem(MARKET_KEY); if (m === 'US' || m === 'IN' || m === 'ALL') setMarketState(m) } catch {}
  }, [])
  const setMarket = useCallback((m: Market) => {
    setMarketState(m)
    try { localStorage.setItem(MARKET_KEY, m) } catch {}
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

  // Watchlist names outside the built-in universe are scanned as one extra request.
  const extraKey = useMemo(() => [...new Set(watchlist.map(s => s.toUpperCase()))]
    .filter(s => !UNIVERSE_BY_SYMBOL[s] && /^[A-Z0-9^][A-Z0-9.\-&=^]{0,19}$/.test(s)).sort().slice(0, SCAN_CHUNK).join(','), [watchlist])

  useEffect(() => {
    const ctl = new AbortController()
    const urls: string[] = []
    for (const m of (market === 'ALL' ? ['IN', 'US'] : [market]) as ScanMarket[]) {
      for (let i = 0; i < chunkCount(m); i++) urls.push(`/api/pattern-scan?tf=${tf}&market=${m}&chunk=${i}`)
    }
    if (extraKey) urls.push(`/api/pattern-scan?tf=${tf}&symbols=${encodeURIComponent(extraKey)}`)

    const rows = new Map<string, Row>()
    const prog = { done: 0, total: urls.length, symbols: 0, scanned: 0, failed: 0, at: 0 }
    setAll([]); setProgress({ ...prog }); setShown(PAGE)

    let next = 0
    const worker = async () => {
      while (next < urls.length && !ctl.signal.aborted) {
        const data = await loadChunk(urls[next++], ctl.signal)
        if (ctl.signal.aborted) return
        prog.done++
        if (data) {
          for (const r of data.rows) if (r?.symbol && Array.isArray(r.detections) && r.detections.length) rows.set(r.symbol, r)
          prog.symbols += data.symbols; prog.scanned += data.scanned
          prog.at = prog.at ? Math.min(prog.at, data.scannedAt) : data.scannedAt
        } else prog.failed++
        setAll([...rows.values()]); setProgress({ ...prog })
      }
    }
    void Promise.all([worker(), worker(), worker()])
    return () => ctl.abort()
  }, [tf, market, extraKey, reload])

  // ── Filtering, all in the browser ──────────────────────────────────────────
  // `base` applies everything except the pattern choice, so the pattern board
  // can show how many stocks each pattern would give.
  const base = useMemo(() => {
    const out: Row[] = []
    for (const r of all) {
      if (sector !== 'ALL' && r.sector !== sector) continue
      const dets = r.detections.filter(d =>
        (direction === 'all' || d.direction === direction) &&
        (d.status === 'forming' || d.status === 'confirmed') && statuses.has(d.status) &&
        d.confidence >= minConf)
      if (dets.length) out.push({ ...r, detections: dets })
    }
    return out
  }, [all, sector, direction, statuses, minConf])

  const counts = useMemo(() => {
    const c = new Map<string, number>()
    for (const r of base) for (const id of new Set(r.detections.map(d => d.id))) c.set(id, (c.get(id) ?? 0) + 1)
    return c
  }, [base])

  const rows = useMemo(() => {
    const out = selected.size === 0 ? [...base] : base
      .map(r => ({ ...r, detections: r.detections.filter(d => selected.has(d.id)) }))
      .filter(r => r.detections.length)
    const top = (r: Row) => Math.max(...r.detections.map(d => d.confidence))
    const near = (r: Row) => Math.min(...r.detections.map(d => Math.abs(d.distToBreakoutPct ?? 999)))
    out.sort((a, b) => sortBy === 'changePct' ? b.changePct - a.changePct : sortBy === 'distance' ? near(a) - near(b) : top(b) - top(a) || a.symbol.localeCompare(b.symbol))
    return out
  }, [base, selected, sortBy])

  useEffect(() => { setShown(PAGE) }, [selected, sector, direction, statuses, minConf, sortBy])

  const loading = progress.done < progress.total
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  const guide = usePanelGuide({
    title: "Using the pattern scanner",
    next: [{ label: "CHART", panelId: "chart" }, { label: "BACKTEST", panelId: "backtest" }],
    children: <>The scanner looks for price shapes that traders watch, using fixed rules so the same chart always gives the same answer. A pattern is a description of what price has done, with a level that would confirm it and a level that would prove it wrong. Pick a pattern on the board to list every stock showing it now; the number beside each pattern is how many stocks match. It covers the whole Nifty 500 and a US large-cap list, on daily or weekly candles, and only lists patterns that are current: chart shapes that ended within the last 15 candles and candle signals from the last 3. Treat the confidence score as how cleanly the shape fits, not the chance it works.</>,
  })

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between', padding: '6px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div className="dot" />
          <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: '13px', letterSpacing: '0.05em' }}>PATTERN SCREENER</span>
          {guide.button}
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['1D', '1W'] as Tf[]).map(t => (
            <button key={t} onClick={() => setTf(t)} style={pillStyle(tf === t, 'var(--amber)')}>{t}</button>
          ))}
        </div>
      </div>
      {guide.body}

      {/* presets */}
      <div style={{ display: 'flex', gap: '4px', padding: '6px 10px', borderBottom: '1px solid var(--border)', overflowX: 'auto', background: 'rgba(0,0,0,0.18)' }}>
        {PRESETS.map(p => (
          <button key={p.label} onClick={() => applyPreset(p)} style={{
            padding: '3px 9px', borderRadius: '3px', cursor: 'pointer', fontSize: '12px', flexShrink: 0,
            fontFamily: 'var(--font-ui)', fontWeight: 700, border: '1px solid var(--border)',
            background: 'var(--bg-deep)', color: 'var(--text-2)', whiteSpace: 'nowrap',
          }}>{p.label}</button>
        ))}
      </div>

      {/* filter bar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        {/* market */}
        {([['ALL', 'All'], ['IN', 'Nifty 500'], ['US', 'US']] as Array<[Market, string]>).map(([m, label]) => (
          <button key={m} onClick={() => setMarket(m)} style={pillStyle(market === m, 'var(--amber)')}>{label}</button>
        ))}
        <span style={{ width: 1, height: 14, background: 'var(--border)' }} />

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
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>Q≥{minConf}</span>
          <input type="range" min={0} max={95} value={minConf} onChange={e => setMinConf(Number(e.target.value))} style={{ width: 70, accentColor: 'var(--teal)' }} />
        </div>
      </div>

      {/* pattern board: pick what you are looking for; numbers are stocks matching the filters above */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', maxHeight: '42%', overflowY: 'auto', flexShrink: 0 }}>
        {PATTERN_GROUPS.map(g => (
          <div key={g.group} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ width: 84, flexShrink: 0, fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.1em', fontFamily: 'var(--font-data)' }}>{g.group.toUpperCase()}</span>
            {g.items.map(it => {
              const n = counts.get(it.id) ?? 0, on = selected.has(it.id)
              return (
                <button key={it.id} onClick={() => togglePattern(it.id)} aria-pressed={on} style={{
                  ...pillStyle(on), opacity: n === 0 && !on ? 0.45 : 1, display: 'inline-flex', gap: 5, alignItems: 'center',
                }}>
                  {it.label}
                  <span style={{ color: on ? 'var(--teal)' : n ? '#fff' : 'var(--text-muted)', fontWeight: 700 }}>{n}</span>
                </button>
              )
            })}
          </div>
        ))}
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} style={{ ...pillStyle(false), color: 'var(--negative)', marginLeft: 88 }}>Clear patterns</button>
        )}
      </div>

      {/* scan status */}
      <div style={{ position: 'relative', padding: '3px 10px', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-data)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', gap: 8, flexShrink: 0 }}>
        <span>
          {loading
            ? `scanning ${tf === '1D' ? 'daily' : 'weekly'} candles… ${pct}% · ${progress.scanned} stocks read`
            : `${progress.scanned} of ${progress.symbols} stocks scanned on ${tf === '1D' ? 'daily' : 'weekly'} candles${progress.at ? ` · ${timeAgo(progress.at)}` : ''}`}
          {!loading && progress.failed > 0 && (
            <button onClick={() => setReload(n => n + 1)} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--amber)', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit', padding: 0 }}>
              {progress.failed} part{progress.failed > 1 ? 's' : ''} did not load · retry
            </button>
          )}
        </span>
        <span>{rows.length} match{rows.length === 1 ? '' : 'es'}</span>
        {loading && <span style={{ position: 'absolute', left: 0, bottom: -1, height: 1, width: `${pct}%`, background: 'var(--teal)', transition: 'width var(--dur) var(--ease-out)' }} />}
      </div>

      {/* results */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {loading && rows.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-data)', fontSize: 13 }}>
            Reading price history… results appear here as each batch finishes.
          </div>
        )}
        {!loading && rows.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-data)', fontSize: 13 }}>
            {progress.scanned === 0 ? 'Price history could not be loaded just now. Try again in a minute.' : 'No stocks match these filters. Lower Q or clear a pattern.'}
          </div>
        )}
        {rows.slice(0, shown).map(row => {
          const det = row.detections[0]
          const up = row.changePct >= 0
          return (
            <button key={row.symbol} onClick={() => focusOnPattern(row.symbol, det.id, tf)} style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
              padding: '7px 10px', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(30,45,61,0.5)',
            }}>
              <div style={{ minWidth: 76, flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: 13, color: '#fff' }}>{row.symbol.replace('.NS', '')}{row.country === 'IN' && <span style={{ marginLeft: 4, fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>NSE</span>}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>{row.name}</div>
              </div>
              <div style={{ minWidth: 60, flexShrink: 0, fontFamily: 'var(--font-data)' }}>
                <div style={{ fontSize: 13, color: '#fff' }}>{row.price}</div>
                <div style={{ fontSize: 12, color: up ? 'var(--positive)' : 'var(--negative)' }}>{up ? '+' : ''}{row.changePct}%</div>
              </div>
              <Spark row={row} />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {row.detections.slice(0, 3).map((d, i) => (
                  <span key={i} style={{
                    fontSize: 11, fontFamily: 'var(--font-data)', padding: '1px 6px', borderRadius: 3,
                    border: `1px solid ${DIR_COLOR[d.direction]}55`, color: DIR_COLOR[d.direction], background: `${DIR_COLOR[d.direction]}14`,
                  }}>{d.name} {d.confidence}</span>
                ))}
              </div>
              <div style={{ minWidth: 64, flexShrink: 0, textAlign: 'right', fontFamily: 'var(--font-data)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: STATUS_COLOR[det.status], textTransform: 'uppercase' }}>{det.status}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{det.ageBar === 0 ? (tf === '1D' ? 'latest candle' : 'this week') : `${det.ageBar} ${tf === '1D' ? 'day' : 'week'}${det.ageBar > 1 ? 's' : ''} ago`}</div>
                {det.distToBreakoutPct != null && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{det.distToBreakoutPct > 0 ? '+' : ''}{det.distToBreakoutPct.toFixed(1)}% to brk</div>
                )}
              </div>
            </button>
          )
        })}
        {rows.length > shown && (
          <button onClick={() => setShown(n => n + PAGE)} style={{ width: '100%', padding: '8px', background: 'transparent', border: 'none', color: 'var(--teal)', cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-data)' }}>
            Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
          </button>
        )}
      </div>
    </div>
  )
}

const selStyle: CSSProperties = {
  padding: '2px 6px', borderRadius: 3, fontSize: 12, fontFamily: 'var(--font-data)',
  border: '1px solid var(--border)', background: 'var(--bg-deep)', color: 'var(--text-2)', cursor: 'pointer',
}
