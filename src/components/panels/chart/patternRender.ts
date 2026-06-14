// ─────────────────────────────────────────────────────────────────────────────
// Pattern rendering helpers for ChartPanel (spec §2.1).
//
// Candlestick detections → lightweight-charts series markers.
// Geometric detections   → a synced absolute-positioned canvas overlay drawing
//                          each detection's lines[] (outline solid, neckline
//                          dashed, translucent body fill). Target / invalidation
//                          are drawn as price lines by the panel itself.
//
// Coordinates are projected every redraw via the chart's coordinate APIs so the
// overlay survives pan/zoom/timeframe changes.
// ─────────────────────────────────────────────────────────────────────────────

import type { PatternDetection, PatternDirection } from '@/lib/patterns'

// lightweight-charts is dynamically imported in ChartPanel; we only need loose
// shapes here, so the chart/series are typed as `any` to match that module.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type PatternVisibility = 'all' | 'confirmed' | 'off'

const DIR_COLOR: Record<PatternDirection, string> = {
  bullish: '#00c97a',
  bearish: '#ff4560',
  neutral: '#f0a500',
}

/** Short glyph label for a candlestick detection. */
const ABBREV: Record<string, string> = {
  hammer: 'Ham', hanging_man: 'HM', inverted_hammer: 'IH', shooting_star: 'SS',
  doji: 'Doji', dragonfly_doji: 'DfD', gravestone_doji: 'GsD', marubozu: 'Mbz',
  bullish_engulfing: 'Eng↑', bearish_engulfing: 'Eng↓',
  harami: 'Har', harami_cross: 'HarX',
  piercing_line: 'Prc', dark_cloud_cover: 'DCC',
  tweezer_top: 'TwT', tweezer_bottom: 'TwB',
  bullish_kicker: 'Kck↑', bearish_kicker: 'Kck↓',
  morning_star: 'MS', evening_star: 'ES',
  three_white_soldiers: '3WS', three_black_crows: '3BC',
  three_inside_up: '3IU', three_inside_down: '3ID',
  abandoned_baby: 'AB', rising_three_methods: 'R3M', falling_three_methods: 'F3M',
}

export interface SeriesMarker {
  time: number
  position: 'aboveBar' | 'belowBar'
  color: string
  shape: 'arrowUp' | 'arrowDown' | 'circle'
  text: string
  size?: number
}

export function buildCandleMarkers(
  dets: PatternDetection[], visibility: PatternVisibility,
): SeriesMarker[] {
  if (visibility === 'off') return []
  const out: SeriesMarker[] = []
  for (const d of dets) {
    const c = d.direction
    out.push({
      time: d.points[d.points.length - 1]?.time ?? 0,
      position: c === 'bearish' ? 'aboveBar' : 'belowBar',
      color: DIR_COLOR[c],
      shape: c === 'bearish' ? 'arrowDown' : c === 'bullish' ? 'arrowUp' : 'circle',
      text: ABBREV[d.id] ?? d.name.slice(0, 4),
    })
  }
  // lightweight-charts requires markers sorted ascending by time.
  return out.sort((a, b) => a.time - b.time)
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export interface DrawOpts {
  visibility: PatternVisibility
  selectedId: string | null
}

/**
 * Redraw all visible geometric detections onto the overlay canvas. Call on every
 * chart range/crosshair change. `series` is the main price series (for
 * priceToCoordinate); `chart` provides the time scale.
 */
export function drawGeometric(
  canvas: HTMLCanvasElement,
  chart: any,
  series: any,
  dets: PatternDetection[],
  opts: DrawOpts,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth, h = canvas.clientHeight
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (opts.visibility === 'off') return

  const ts = chart.timeScale()
  const X = (t: number): number | null => {
    const x = ts.timeToCoordinate(t as any)
    return x == null ? null : x
  }
  const Y = (p: number): number | null => {
    const y = series.priceToCoordinate(p)
    return y == null ? null : y
  }

  for (const d of dets) {
    if (opts.visibility === 'confirmed' && d.status !== 'confirmed') continue
    const selected = opts.selectedId === d.id
    const color = DIR_COLOR[d.direction]
    const baseAlpha = selected ? 1 : d.status === 'confirmed' ? 0.85 : 0.55
    const lw = selected ? 2.2 : 1.4

    // translucent body fill across the pattern's vertices
    const verts = d.points
      .map(p => { const x = X(p.time), y = Y(p.price); return x != null && y != null ? { x, y } : null })
      .filter((v): v is { x: number; y: number } => v != null)
    if (verts.length >= 3) {
      ctx.beginPath()
      ctx.moveTo(verts[0].x, verts[0].y)
      for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y)
      ctx.closePath()
      ctx.fillStyle = hexA(color, selected ? 0.10 : 0.05)
      ctx.fill()
    }

    for (const ln of d.lines) {
      const x1 = X(ln.a.time), y1 = Y(ln.a.price), x2 = X(ln.b.time), y2 = Y(ln.b.price)
      if (x1 == null || y1 == null || x2 == null || y2 == null) continue
      ctx.beginPath()
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
      ctx.lineWidth = lw
      ctx.strokeStyle = ln.role === 'neckline' || ln.role === 'target'
        ? hexA('#a0a0a0', baseAlpha) : hexA(color, baseAlpha)
      ctx.setLineDash(ln.style === 'dashed' ? [5, 4] : [])
      ctx.stroke()
    }
    ctx.setLineDash([])

    // label at the pattern's last vertex
    const labelPt = verts[verts.length - 1]
    if (labelPt && selected) {
      ctx.font = '10px JetBrains Mono, monospace'
      ctx.fillStyle = color
      ctx.fillText(d.name, labelPt.x + 6, labelPt.y - 6)
    }

    // vertex dots for the selected pattern
    if (selected) {
      for (const v of verts) {
        ctx.beginPath(); ctx.arc(v.x, v.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = color; ctx.fill()
      }
    }
  }
}

export { DIR_COLOR }
