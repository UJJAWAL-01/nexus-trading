'use client'

// ─────────────────────────────────────────────────────────────────────────────
// DrawingLayer (spec §2.3) — interactive chart drawing tools.
//
// Drawings are stored in DATA SPACE ({time, price}) and re-projected to pixels
// on every chart range change, so they survive pan / zoom / timeframe changes.
// Persisted to localStorage per symbol (the app is loginless). A slim vertical
// tool rail sits on the chart's left edge.
//
// Tools: trendline · ray · horizontal · vertical · rectangle · Fibonacci
//        retracement · long / short position (auto R:R). Select mode enables
//        click-to-select, endpoint drag, and Delete/Esc.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState, useCallback, type ComponentType, type CSSProperties } from 'react'
import {
  Hand, MousePointer2, PenLine, ArrowUpRight, Minus, Square,
  Ruler, AlignJustify, TrendingUp, TrendingDown, Trash2,
} from 'lucide-react'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Tool = 'pan' | 'select' | 'trend' | 'ray' | 'hline' | 'vline' | 'rect' | 'measure' | 'fib' | 'long' | 'short'
interface Pt { time: number; price: number }
interface Drawing { id: string; type: Exclude<Tool, 'pan' | 'select'>; pts: Pt[]; color: string }

type IconCmp = ComponentType<{ size?: number; style?: CSSProperties }>
const TOOLS: Array<{ id: Tool; Icon: IconCmp; title: string; sep?: boolean; color?: string; rotate?: number }> = [
  { id: 'pan',     Icon: Hand,          title: 'Pan / interact' },
  { id: 'select',  Icon: MousePointer2, title: 'Select & edit' },
  { id: 'trend',   Icon: PenLine,       title: 'Trend line', sep: true },
  { id: 'ray',     Icon: ArrowUpRight,  title: 'Ray' },
  { id: 'hline',   Icon: Minus,         title: 'Horizontal line' },
  { id: 'vline',   Icon: Minus,         title: 'Vertical line', rotate: 90 },
  { id: 'rect',    Icon: Square,        title: 'Rectangle' },
  { id: 'measure', Icon: Ruler,         title: 'Measure (price / % / time)' },
  { id: 'fib',     Icon: AlignJustify,  title: 'Fib retracement' },
  { id: 'long',    Icon: TrendingUp,    title: 'Long position (R:R)', sep: true, color: '#00c97a' },
  { id: 'short',   Icon: TrendingDown,  title: 'Short position (R:R)', color: '#ff4560' },
]

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const FIB_COLORS = ['#ffffff55', '#00e5c0', '#1e90ff', '#f0a500', '#ff4560', '#a78bfa', '#ffffff55']
const DEFAULT_COLOR = '#22d3ee'
const HIT = 8

const fmt = (n: number) => (n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4))
const twoPoint = (t: Tool) => t === 'trend' || t === 'ray' || t === 'rect' || t === 'fib' || t === 'long' || t === 'short' || t === 'measure'

export interface DrawingLayerProps {
  chart: any
  series: any
  symbol: string
  ready: boolean
}

export default function DrawingLayer({ chart, series, symbol, ready }: DrawingLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>('pan')
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  // Mirror state into refs (synced after commit) so the stable pointer/keyboard
  // handlers can read the latest values without being re-created each render.
  const toolRef = useRef(tool)
  const drawingsRef = useRef(drawings)
  const selectedRef = useRef(selected)
  useEffect(() => { toolRef.current = tool }, [tool])
  useEffect(() => { drawingsRef.current = drawings }, [drawings])
  useEffect(() => { selectedRef.current = selected }, [selected])
  const draftRef = useRef<Drawing | null>(null)
  const dragRef = useRef<{ mode: 'move' | 'pt'; id: string; ptIndex: number; orig: Pt[]; startPx: { x: number; y: number } } | null>(null)

  const storeKey = `nexus:drawings:${symbol}`

  // ── Load / persist per symbol ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey)
      setDrawings(raw ? JSON.parse(raw) : [])
    } catch { setDrawings([]) }
    setSelected(null)
  }, [storeKey])

  const persist = useCallback((next: Drawing[]) => {
    setDrawings(next)
    try { localStorage.setItem(storeKey, JSON.stringify(next)) } catch {}
  }, [storeKey])

  // ── Coordinate helpers ─────────────────────────────────────────────────────
  const toX = useCallback((t: number): number | null => { try { const x = chart?.timeScale().timeToCoordinate(t); return x == null ? null : x } catch { return null } }, [chart])
  const toY = useCallback((p: number): number | null => { try { const y = series?.priceToCoordinate(p); return y == null ? null : y } catch { return null } }, [series])
  const fromX = useCallback((x: number): number | null => { try { const t = chart?.timeScale().coordinateToTime(x); return typeof t === 'number' ? t : null } catch { return null } }, [chart])
  const fromY = useCallback((y: number): number | null => { try { const p = series?.coordinateToPrice(y); return p == null ? null : p } catch { return null } }, [series])

  // ── Rendering ──────────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d'); if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const w = cv.clientWidth, h = cv.clientHeight
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const all = [...drawingsRef.current]
    if (draftRef.current) all.push(draftRef.current)

    for (const d of all) {
      const sel = d.id === selectedRef.current
      ctx.strokeStyle = d.color; ctx.fillStyle = d.color; ctx.lineWidth = sel ? 2.2 : 1.5
      ctx.setLineDash([])
      const A = d.pts[0], B = d.pts[1]
      const ax = A ? toX(A.time) : null, ay = A ? toY(A.price) : null
      const bx = B ? toX(B.time) : null, by = B ? toY(B.price) : null

      if (d.type === 'hline' && ay != null) { line(ctx, 0, ay, w, ay); label(ctx, w - 54, ay - 4, fmt(A.price), d.color) }
      else if (d.type === 'vline' && ax != null) { ctx.strokeStyle = d.color; line(ctx, ax, 0, ax, h) }
      else if (ax != null && ay != null && bx != null && by != null) {
        if (d.type === 'trend') line(ctx, ax, ay, bx, by)
        else if (d.type === 'ray') { const dx = bx - ax, dy = by - ay; const k = dx !== 0 ? (w - ax) / dx : 1e6; line(ctx, ax, ay, ax + dx * Math.max(1, k), ay + dy * Math.max(1, k)) }
        else if (d.type === 'rect') { ctx.globalAlpha = 0.08; ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); ctx.globalAlpha = 1; ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)) }
        else if (d.type === 'fib') drawFib(ctx, ax, bx, A.price, B.price, toY, w)
        else if (d.type === 'measure') drawMeasure(ctx, A, B, ax, ay, bx, by)
        else if (d.type === 'long' || d.type === 'short') drawPosition(ctx, d.type, A, B, ax, ay, bx, by)
      }

      if (sel) for (const p of d.pts) { const px = toX(p.time), py = toY(p.price); if (px != null && py != null) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = d.color } }
    }
  }, [toX, toY])

  // Re-project on chart pan/zoom + on data changes.
  useEffect(() => {
    if (!ready || !chart) return
    const ts = chart.timeScale()
    const h = () => redraw()
    ts.subscribeVisibleLogicalRangeChange(h)
    chart.subscribeCrosshairMove(h)
    const ro = new ResizeObserver(() => redraw())
    if (canvasRef.current) ro.observe(canvasRef.current)
    redraw()
    return () => { try { ts.unsubscribeVisibleLogicalRangeChange(h); chart.unsubscribeCrosshairMove(h); ro.disconnect() } catch {} }
  }, [ready, chart, redraw])

  useEffect(() => { redraw() }, [drawings, selected, redraw])

  // ── Hit-testing (select mode) ──────────────────────────────────────────────
  const hitEndpoint = useCallback((d: Drawing, x: number, y: number): number => {
    for (let i = 0; i < d.pts.length; i++) {
      const px = toX(d.pts[i].time), py = toY(d.pts[i].price)
      if (px != null && py != null && Math.hypot(px - x, py - y) <= HIT) return i
    }
    return -1
  }, [toX, toY])

  const hitBody = useCallback((d: Drawing, x: number, y: number): boolean => {
    const A = d.pts[0], B = d.pts[1]
    const ay = A ? toY(A.price) : null, ax = A ? toX(A.time) : null
    if (d.type === 'hline') return ay != null && Math.abs(y - ay) <= HIT
    if (d.type === 'vline') return ax != null && Math.abs(x - ax) <= HIT
    if (!B) return false
    const bx = toX(B.time), by = toY(B.price)
    if (ax == null || ay == null || bx == null || by == null) return false
    if (d.type === 'rect' || d.type === 'fib' || d.type === 'long' || d.type === 'short' || d.type === 'measure')
      return x >= Math.min(ax, bx) - HIT && x <= Math.max(ax, bx) + HIT && y >= Math.min(ay, by) - HIT && y <= Math.max(ay, by) + HIT
    return distToSeg(x, y, ax, ay, bx, by) <= HIT
  }, [toX, toY])

  // ── Pointer handlers ───────────────────────────────────────────────────────
  const pos = (e: React.PointerEvent) => { const r = canvasRef.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

  const onDown = useCallback((e: React.PointerEvent) => {
    const t = toolRef.current
    if (t === 'pan') return
    const { x, y } = pos(e)
    canvasRef.current?.setPointerCapture(e.pointerId)

    if (t === 'select') {
      for (let i = drawingsRef.current.length - 1; i >= 0; i--) {
        const d = drawingsRef.current[i]
        const ep = hitEndpoint(d, x, y)
        if (ep >= 0) { setSelected(d.id); dragRef.current = { mode: 'pt', id: d.id, ptIndex: ep, orig: d.pts.map(p => ({ ...p })), startPx: { x, y } }; return }
        if (hitBody(d, x, y)) { setSelected(d.id); dragRef.current = { mode: 'move', id: d.id, ptIndex: -1, orig: d.pts.map(p => ({ ...p })), startPx: { x, y } }; return }
      }
      setSelected(null)
      return
    }

    // drawing tool: start a draft
    const time = fromX(x), price = fromY(y)
    if (time == null || price == null) return
    const id = `dw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    if (t === 'hline' || t === 'vline') { persist([...drawingsRef.current, { id, type: t, pts: [{ time, price }], color: DEFAULT_COLOR }]); setTool('select'); return }
    draftRef.current = { id, type: t, pts: [{ time, price }, { time, price }], color: DEFAULT_COLOR }
  }, [fromX, fromY, hitBody, hitEndpoint, persist])

  const onMove = useCallback((e: React.PointerEvent) => {
    const { x, y } = pos(e)
    if (draftRef.current && twoPoint(toolRef.current)) {
      const time = fromX(x), price = fromY(y)
      if (time != null && price != null) { draftRef.current.pts[1] = { time, price }; redraw() }
      return
    }
    const drag = dragRef.current
    if (drag) {
      const dxT = fromX(x), dyP = fromY(y)
      const startT = fromX(drag.startPx.x), startP = fromY(drag.startPx.y)
      if (dxT == null || dyP == null || startT == null || startP == null) return
      const next = drawingsRef.current.map(d => {
        if (d.id !== drag.id) return d
        if (drag.mode === 'pt') { const pts = d.pts.map((p, i) => i === drag.ptIndex ? { time: dxT, price: dyP } : p); return { ...d, pts } }
        const dt = dxT - startT, dp = dyP - startP
        return { ...d, pts: drag.orig.map(p => ({ time: p.time + dt, price: p.price + dp })) }
      })
      drawingsRef.current = next; redraw()
    }
  }, [fromX, fromY, redraw])

  const onUp = useCallback((e: React.PointerEvent) => {
    canvasRef.current?.releasePointerCapture(e.pointerId)
    if (draftRef.current) { persist([...drawingsRef.current, draftRef.current]); draftRef.current = null; setSelected(null); setTool('select'); return }
    if (dragRef.current) { persist(drawingsRef.current); dragRef.current = null }
  }, [persist])

  // ── Keyboard: Delete removes selection, Esc cancels ────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { draftRef.current = null; setSelected(null); setTool('pan'); redraw() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
        persist(drawingsRef.current.filter(d => d.id !== selectedRef.current)); setSelected(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [persist, redraw])

  if (!ready) return null
  const interactive = tool !== 'pan'

  return (
    <>
      {/* tool rail — icons reveal their name on hover */}
      <div style={{ position: 'absolute', left: 6, top: 10, zIndex: 9, display: 'flex', flexDirection: 'column', gap: 2, background: 'rgba(9,12,16,0.9)', border: '1px solid var(--border)', borderRadius: 6, padding: 4, boxShadow: '0 6px 20px rgba(0,0,0,0.5)' }}>
        {TOOLS.map(tl => (
          <div key={tl.id} style={{ position: 'relative' }} onMouseEnter={() => setHovered(tl.id)} onMouseLeave={() => setHovered(null)}>
            {tl.sep && <div style={{ height: 1, background: 'var(--border)', margin: '3px 2px' }} />}
            <button onClick={() => { setTool(tl.id); if (tl.id !== 'select') setSelected(null) }} style={{
              width: 26, height: 26, borderRadius: 4, cursor: 'pointer', fontSize: 13, lineHeight: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: `1px solid ${tool === tl.id ? 'var(--teal)' : 'transparent'}`,
              background: tool === tl.id ? 'rgba(0,229,192,0.14)' : 'transparent',
              color: tool === tl.id ? 'var(--teal)' : (tl.color ?? 'var(--text-2)'),
            }}>{(() => { const I = tl.Icon; return <I size={15} style={tl.rotate ? { transform: `rotate(${tl.rotate}deg)` } : undefined} /> })()}</button>
            {hovered === tl.id && (
              <div style={{ position: 'absolute', left: 'calc(100% + 7px)', top: tl.sep ? 'calc(50% + 3px)' : '50%', transform: 'translateY(-50%)', whiteSpace: 'nowrap', background: 'rgba(9,12,16,0.96)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 9px', fontSize: 10, color: '#dfe8f0', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none', zIndex: 12 }}>{tl.title}</div>
            )}
          </div>
        ))}
        {drawings.length > 0 && (
          <div style={{ position: 'relative' }} onMouseEnter={() => setHovered('clear')} onMouseLeave={() => setHovered(null)}>
            <div style={{ height: 1, background: 'var(--border)', margin: '3px 2px' }} />
            <button onClick={() => persist([])} style={{ width: 26, height: 26, borderRadius: 4, cursor: 'pointer', border: '1px solid transparent', background: 'transparent', color: 'var(--negative)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={14} /></button>
            {hovered === 'clear' && (
              <div style={{ position: 'absolute', left: 'calc(100% + 7px)', top: 'calc(50% + 3px)', transform: 'translateY(-50%)', whiteSpace: 'nowrap', background: 'rgba(9,12,16,0.96)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 9px', fontSize: 10, color: '#dfe8f0', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none', zIndex: 12 }}>Clear all drawings</div>
            )}
          </div>
        )}
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
        style={{ position: 'absolute', inset: 0, zIndex: 7, width: '100%', height: '100%', pointerEvents: interactive ? 'auto' : 'none', cursor: tool === 'select' ? 'pointer' : interactive ? 'crosshair' : 'default' }}
      />

      {interactive && (
        <div style={{ position: 'absolute', left: 34, top: 8, zIndex: 9, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)', background: 'rgba(9,12,16,0.7)', padding: '2px 6px', borderRadius: 3, pointerEvents: 'none' }}>
          {tool === 'select' ? 'click to select · drag endpoints · Del to remove' : 'drag to draw · Esc to cancel · saved on this device'}
        </div>
      )}
    </>
  )
}

// ── Drawing primitives ────────────────────────────────────────────────────────
function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
}
function label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string) {
  ctx.font = '10px JetBrains Mono, monospace'; ctx.fillStyle = color; ctx.fillText(text, x, y)
}
function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - x1) * dx + (py - y1) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
function drawFib(ctx: CanvasRenderingContext2D, ax: number, bx: number, pA: number, pB: number, toY: (p: number) => number | null, w: number) {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx)
  FIB_LEVELS.forEach((lv, i) => {
    const price = pA + (pB - pA) * lv
    const y = toY(price)
    if (y == null) return
    ctx.strokeStyle = FIB_COLORS[i]; ctx.lineWidth = 1; ctx.setLineDash([4, 3])
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(Math.max(x1, w), y); ctx.stroke()
    ctx.setLineDash([])
    ctx.font = '9px JetBrains Mono, monospace'; ctx.fillStyle = FIB_COLORS[i]
    ctx.fillText(`${(lv * 100).toFixed(1)}%  ${fmt(price)}`, x0 + 3, y - 2)
  })
}
function drawMeasure(ctx: CanvasRenderingContext2D, A: Pt, B: Pt, ax: number, ay: number, bx: number, by: number) {
  const up = B.price >= A.price
  const col = up ? '#00c97a' : '#ff4560'
  const x0 = Math.min(ax, bx), y0 = Math.min(ay, by), bw = Math.abs(bx - ax), bh = Math.abs(by - ay)
  ctx.globalAlpha = 0.1; ctx.fillStyle = col; ctx.fillRect(x0, y0, bw, bh); ctx.globalAlpha = 1
  ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.strokeRect(x0, y0, bw, bh); ctx.setLineDash([])
  const dP = B.price - A.price
  const pct = A.price !== 0 ? (dP / A.price) * 100 : 0
  const secs = Math.abs(B.time - A.time)
  const span = secs >= 86400 ? `${(secs / 86400).toFixed(secs / 86400 >= 10 ? 0 : 1)}d` : `${(secs / 3600).toFixed(1)}h`
  const txt = `${dP >= 0 ? '+' : ''}${fmt(dP)}   ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%   ${span}`
  ctx.font = 'bold 10px JetBrains Mono, monospace'
  const tw = ctx.measureText(txt).width + 12
  const lx = x0 + bw / 2 - tw / 2
  const ly = up ? y0 - 19 : y0 + bh + 4
  ctx.fillStyle = col; ctx.fillRect(lx, ly, tw, 16)
  ctx.fillStyle = '#000'; ctx.fillText(txt, lx + 6, ly + 11.5)
}

function drawPosition(ctx: CanvasRenderingContext2D, type: 'long' | 'short', A: Pt, B: Pt, ax: number, ay: number, bx: number, by: number) {
  const entry = A.price, target = B.price
  const reward = target - entry
  const stop = entry - reward * 0.5            // default 2:1 reward:risk
  const sy = ctxYFrom(ay, by)
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), w = Math.abs(bx - ax) || 40
  // reward zone (entry → target)
  ctx.globalAlpha = 0.12; ctx.fillStyle = '#00c97a'; ctx.fillRect(x0, Math.min(ay, by), w, Math.abs(by - ay)); ctx.globalAlpha = 1
  // risk zone (entry → stop)
  ctx.globalAlpha = 0.12; ctx.fillStyle = '#ff4560'; ctx.fillRect(x0, ay, w, sy - ay); ctx.globalAlpha = 1
  ctx.strokeStyle = '#00c97a'; ctx.lineWidth = 1; line(ctx, x0, by, x1, by)
  ctx.strokeStyle = '#7a9ab0'; line(ctx, x0, ay, x1, ay)
  ctx.strokeStyle = '#ff4560'; line(ctx, x0, sy, x1, sy)
  ctx.font = '9px JetBrains Mono, monospace'
  ctx.fillStyle = '#00c97a'; ctx.fillText(`TP ${fmt(target)}`, x1 + 3, by + 3)
  ctx.fillStyle = '#7a9ab0'; ctx.fillText(`${type === 'long' ? 'LONG' : 'SHORT'} ${fmt(entry)}  R:R 2.0`, x1 + 3, ay + 3)
  ctx.fillStyle = '#ff4560'; ctx.fillText(`SL ${fmt(stop)}`, x1 + 3, sy + 3)
}
// stop's y is the entry y mirrored by the reward pixel distance / 2
function ctxYFrom(ay: number, by: number) {
  return ay + (ay - by) * 0.5
}
