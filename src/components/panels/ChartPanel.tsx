'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'
import { useActiveSymbol } from '@/store/symbol'
import { detectAll, computeRating } from '@/lib/patterns'
import type { DetectAllResult, PatternDetection, TaRating, Timeframe } from '@/lib/patterns'
import { buildCandleMarkers, drawGeometric } from './chart/patternRender'
import type { PatternVisibility } from './chart/patternRender'
import AnalysisDrawer from './chart/AnalysisDrawer'
import DrawingLayer from './chart/DrawingLayer'
import { fetchChartAnalysis } from './chart/aiNote'
import type { AiNote } from './chart/aiNote'
import {
  CandlestickChart, BarChart3, LineChart as LineChartIcon, AreaChart, LayoutGrid,
  Clock, ChevronDown, GitCompareArrows, Layers, RotateCcw, Camera,
  Maximize2, Minimize2, Activity, Bell, Search as SearchIcon, X as XIcon, SlidersHorizontal,
} from 'lucide-react'
import type { ComponentType } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }
interface SearchResult { symbol: string; name: string; exchange: string; type: string; currency: string }

// ─────────────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────────────

function smaArr(vals: number[], p: number): number[] {
  if (vals.length < p) return []
  const out: number[] = []
  for (let i = p - 1; i < vals.length; i++)
    out.push(vals.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p)
  return out
}

function emaArr(vals: number[], p: number): number[] {
  if (vals.length < p) return []
  const k = 2 / (p + 1)
  const out = [vals.slice(0, p).reduce((a, b) => a + b, 0) / p]
  for (let i = p; i < vals.length; i++) out.push(vals[i] * k + out[out.length - 1] * (1 - k))
  return out
}

function vwapArr(candles: Candle[]): Array<{ time: number; value: number }> {
  const result: Array<{ time: number; value: number }> = []
  let cumTPV = 0, cumVol = 0, lastDate = ''
  for (const c of candles) {
    const date = new Date(c.time * 1000).toDateString()
    if (date !== lastDate) { cumTPV = 0; cumVol = 0; lastDate = date }
    const tp = (c.high + c.low + c.close) / 3
    cumTPV += tp * c.volume
    cumVol += c.volume
    result.push({ time: c.time, value: cumVol > 0 ? cumTPV / cumVol : 0 })
  }
  return result
}

function rsiArr(candles: Candle[], period = 14): Array<{ time: number; value: number }> {
  const close = candles.map(c => c.close)
  if (close.length < period + 1) return []
  const result: Array<{ time: number; value: number }> = []
  let avgGain = 0, avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const d = close[i] - close[i - 1]
    if (d > 0) avgGain += d; else avgLoss -= d
  }
  avgGain /= period; avgLoss /= period
  const push = (i: number) => {
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
    result.push({ time: candles[i].time, value: +rsi.toFixed(2) })
  }
  push(period)
  for (let i = period + 1; i < candles.length; i++) {
    const d = close[i] - close[i - 1]
    avgGain = (avgGain * (period - 1) + Math.max(0, d)) / period
    avgLoss = (avgLoss * (period - 1) + Math.max(0, -d)) / period
    push(i)
  }
  return result
}

function macdData(candles: Candle[]): {
  macd: Array<{ time: number; value: number }>
  signal: Array<{ time: number; value: number }>
  hist: Array<{ time: number; value: number; color: string }>
} {
  const close = candles.map(c => c.close)
  const e12 = emaArr(close, 12)
  const e26 = emaArr(close, 26)
  if (e12.length < 15 || e26.length === 0) return { macd: [], signal: [], hist: [] }
  // e12[0]=candles[11], e26[0]=candles[25]; so e12[k+14] aligns with e26[k]
  const macdLine: number[] = [], macdTimes: number[] = []
  for (let k = 0; k < e26.length; k++) {
    macdLine.push(e12[k + 14] - e26[k])
    macdTimes.push(candles[25 + k].time)
  }
  const sig = emaArr(macdLine, 9)
  const macd = macdLine.map((v, k) => ({ time: macdTimes[k], value: +v.toFixed(4) }))
  const signal: Array<{ time: number; value: number }> = []
  const hist: Array<{ time: number; value: number; color: string }> = []
  for (let k = 0; k < sig.length; k++) {
    const t = macdTimes[k + 8], m = macdLine[k + 8], s = sig[k], h = m - s
    signal.push({ time: t, value: +s.toFixed(4) })
    hist.push({ time: t, value: +h.toFixed(4), color: h >= 0 ? 'rgba(0,201,122,0.7)' : 'rgba(255,69,96,0.7)' })
  }
  return { macd, signal, hist }
}

function bollingerBands(candles: Candle[], p = 20, m = 2) {
  const c = candles.map(x => x.close)
  return candles.slice(p - 1).map((_, idx) => {
    const i = idx + p - 1, sl = c.slice(i - p + 1, i + 1)
    const mean = sl.reduce((a, b) => a + b, 0) / p
    const std  = Math.sqrt(sl.reduce((s, v) => s + (v - mean) ** 2, 0) / p)
    return { time: candles[i].time, upper: mean + m * std, mid: mean, lower: mean - m * std }
  })
}

function fibLevels(candles: Candle[]) {
  const s = candles.slice(-60)
  const H = Math.max(...s.map(c => c.high)), L = Math.min(...s.map(c => c.low)), d = H - L
  return [
    { price: H,             label: 'Fib 0%',    color: '#ffffff28' },
    { price: H - 0.236 * d, label: 'Fib 23.6%', color: '#00e5c070' },
    { price: H - 0.382 * d, label: 'Fib 38.2%', color: '#1e90ff70' },
    { price: H - 0.5 * d,   label: 'Fib 50%',   color: '#f0a50070' },
    { price: H - 0.618 * d, label: 'Fib 61.8%', color: '#ff456070' },
    { price: L,             label: 'Fib 100%',  color: '#ffffff28' },
  ]
}

function pivotLevels(candles: Candle[]) {
  if (!candles.length) return { pivot: 0, r1: 0, r2: 0, s1: 0, s2: 0 }
  const { high: H, low: L, close: C } = candles[candles.length - 1]
  const P = (H + L + C) / 3
  return { pivot: P, r1: 2 * P - L, r2: P + (H - L), s1: 2 * P - H, s2: P - (H - L) }
}

function donchianChannels(candles: Candle[], period = 20) {
  const out: Array<{ time: number; high: number; low: number; mid: number }> = []
  for (let i = period - 1; i < candles.length; i++) {
    const sl = candles.slice(i - period + 1, i + 1)
    const high = Math.max(...sl.map(c => c.high)), low = Math.min(...sl.map(c => c.low))
    out.push({ time: candles[i].time, high, low, mid: (high + low) / 2 })
  }
  return out
}

function ichimokuCloud(candles: Candle[]) {
  const tenkan: Array<{ time: number; value: number }> = []
  const kijun:  Array<{ time: number; value: number }> = []
  const chikou: Array<{ time: number; value: number }> = []
  for (let i = 25; i < candles.length; i++) {
    const t9  = candles.slice(Math.max(0, i - 9),  i + 1)
    const t26 = candles.slice(Math.max(0, i - 26), i + 1)
    tenkan.push({ time: candles[i].time, value: (Math.max(...t9.map(c => c.high))  + Math.min(...t9.map(c => c.low)))  / 2 })
    kijun.push({  time: candles[i].time, value: (Math.max(...t26.map(c => c.high)) + Math.min(...t26.map(c => c.low))) / 2 })
    chikou.push({ time: candles[i].time, value: candles[Math.max(0, i - 26)].close })
  }
  return { tenkan, kijun, chikou }
}

function supportResistanceLevels(candles: Candle[], count = 6) {
  if (candles.length < 20) return [] as Array<{ price: number; type: 'support' | 'resistance'; strength: number }>
  const threshold = candles[candles.length - 1].close * 0.006
  const levels: Array<{ price: number; touches: number; type: 'support' | 'resistance' }> = []
  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i]
    if (c.high > candles[i-1].high && c.high > candles[i-2].high && c.high > candles[i+1].high && c.high > candles[i+2].high) {
      const ex = levels.find(l => Math.abs(l.price - c.high) < threshold)
      if (ex) ex.touches++; else levels.push({ price: c.high, touches: 1, type: 'resistance' })
    }
    if (c.low < candles[i-1].low && c.low < candles[i-2].low && c.low < candles[i+1].low && c.low < candles[i+2].low) {
      const ex = levels.find(l => Math.abs(l.price - c.low) < threshold)
      if (ex) ex.touches++; else levels.push({ price: c.low, touches: 1, type: 'support' })
    }
  }
  return levels.sort((a, b) => b.touches - a.touches).slice(0, count).map(l => ({ ...l, strength: l.touches }))
}

function toHeikinAshi(candles: Candle[]): Candle[] {
  const ha: Candle[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const haClose = (c.open + c.high + c.low + c.close) / 4
    const haOpen  = i === 0 ? (c.open + c.close) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2
    ha.push({ time: c.time, open: haOpen, high: Math.max(c.high, haOpen, haClose), low: Math.min(c.low, haOpen, haClose), close: haClose, volume: c.volume })
  }
  return ha
}

// ── Point & Figure ─────────────────────────────────────────────────────────────
interface PnFColumn { direction: 'X' | 'O'; boxes: number[]; startTime: number; endTime: number }

function computePnF(candles: Candle[], boxPct = 0.01, reversal = 3): PnFColumn[] {
  if (candles.length < 10) return []
  const firstClose = candles[0].close
  const boxSize = Math.max(0.01, firstClose * boxPct)
  const roundBox = (price: number, dir: 'up' | 'down') =>
    dir === 'up' ? Math.ceil(price / boxSize) * boxSize : Math.floor(price / boxSize) * boxSize
  const columns: PnFColumn[] = []
  let direction: 'X' | 'O' = 'X'
  let topBox = roundBox(firstClose, 'up'), bottomBox = topBox
  let colStart = candles[0].time, colEnd = candles[0].time
  let currentBoxes: number[] = [topBox]
  const flushCol = () => columns.push({ direction, boxes: [...currentBoxes], startTime: colStart, endTime: colEnd })
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]; colEnd = c.time
    if (direction === 'X') {
      const newTop = roundBox(c.close, 'up')
      if (newTop >= topBox + boxSize) {
        while (topBox + boxSize <= newTop) { topBox += boxSize; currentBoxes.push(topBox) }
        bottomBox = currentBoxes[0]
      } else if (c.close <= topBox - reversal * boxSize) {
        flushCol()
        const newBottom = roundBox(c.close, 'down')
        direction = 'O'; bottomBox = newBottom; colStart = c.time; currentBoxes = []
        let b = topBox - boxSize
        while (b >= newBottom) { currentBoxes.push(b); b -= boxSize }
        topBox = currentBoxes[0] ?? bottomBox
      }
    } else {
      const newBottom = roundBox(c.close, 'down')
      if (newBottom <= bottomBox - boxSize) {
        while (bottomBox - boxSize >= newBottom) { bottomBox -= boxSize; currentBoxes.push(bottomBox) }
        topBox = currentBoxes[0]
      } else if (c.close >= bottomBox + reversal * boxSize) {
        flushCol()
        const newTop = roundBox(c.close, 'up')
        direction = 'X'; topBox = newTop; colStart = c.time; currentBoxes = []
        let b = bottomBox + boxSize
        while (b <= newTop) { currentBoxes.push(b); b += boxSize }
        bottomBox = currentBoxes[0] ?? topBox
      }
    }
  }
  if (currentBoxes.length > 0) flushCol()
  return columns
}

function renderPnF(canvas: HTMLCanvasElement, columns: PnFColumn[], containerH: number) {
  if (columns.length === 0) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const allPrices = columns.flatMap(c => c.boxes)
  if (!allPrices.length) return
  const minPrice = Math.min(...allPrices), maxPrice = Math.max(...allPrices)
  const boxSize = allPrices.length > 1 ? Math.abs(allPrices[1] - allPrices[0]) : 1
  const BOX_W = 22
  const BOX_H = Math.max(14, Math.min(24, Math.floor((containerH - 80) / ((maxPrice - minPrice) / boxSize + 2))))
  const PAD = { l: 72, r: 12, t: 20, b: 30 }
  const numRows = Math.round((maxPrice - minPrice) / boxSize) + 3
  canvas.width = columns.length * BOX_W + PAD.l + PAD.r
  canvas.height = numRows * BOX_H + PAD.t + PAD.b
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#1c1f2555'; ctx.lineWidth = 0.5
  for (let r = 0; r <= numRows; r++) { const y = PAD.t + r * BOX_H; ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(canvas.width - PAD.r, y); ctx.stroke() }
  for (let c = 0; c <= columns.length; c++) { const x = PAD.l + c * BOX_W; ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, canvas.height - PAD.b); ctx.stroke() }
  ctx.font = '9px JetBrains Mono, monospace'; ctx.textAlign = 'right'
  const lI = Math.max(1, Math.round(5 / (BOX_H / 20)))
  for (let r = 0; r <= numRows; r += lI) {
    const price = maxPrice - r * boxSize + boxSize, y = PAD.t + r * BOX_H + BOX_H / 2 + 3
    ctx.fillStyle = '#4a6070'; ctx.fillText(price.toFixed(price < 10 ? 3 : price < 100 ? 2 : 0), PAD.l - 4, y)
  }
  columns.forEach((col, ci) => {
    const x0 = PAD.l + ci * BOX_W
    col.boxes.forEach(price => {
      const row = Math.round((maxPrice - price) / boxSize), y0 = PAD.t + row * BOX_H, pad = 3
      if (col.direction === 'X') {
        ctx.strokeStyle = '#00c97a'; ctx.lineWidth = 2.5
        ctx.beginPath(); ctx.moveTo(x0 + pad, y0 + pad); ctx.lineTo(x0 + BOX_W - pad, y0 + BOX_H - pad); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(x0 + BOX_W - pad, y0 + pad); ctx.lineTo(x0 + pad, y0 + BOX_H - pad); ctx.stroke()
      } else {
        ctx.strokeStyle = '#ff4560'; ctx.lineWidth = 2.5
        ctx.beginPath(); ctx.arc(x0 + BOX_W / 2, y0 + BOX_H / 2, BOX_W / 2 - pad, 0, Math.PI * 2); ctx.stroke()
      }
    })
  })
  ctx.font = '8px JetBrains Mono, monospace'; ctx.fillStyle = '#4a6070'; ctx.textAlign = 'center'
  columns.forEach((_, ci) => { ctx.fillText(String(ci + 1), PAD.l + ci * BOX_W + BOX_W / 2, canvas.height - PAD.b + 14) })
  ctx.font = '10px JetBrains Mono, monospace'; ctx.textAlign = 'left'
  ctx.fillStyle = '#00c97a'; ctx.fillText('X = Up Column', 4, 14)
  ctx.fillStyle = '#ff4560'; ctx.fillText('O = Down Column', 4, canvas.height - 10)
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

type ChartType = 'Candle' | 'Heikin Ashi' | 'Bar' | 'Line' | 'Area' | 'P&F'
const CHART_TYPES: ChartType[] = ['Candle', 'Heikin Ashi', 'Bar', 'Line', 'Area', 'P&F']
// Clean lucide icons so the chart-type dropdown reads at a glance.
const CHART_TYPE_META: Record<ChartType, { Icon: ComponentType<{ size?: number }>; hint: string }> = {
  'Candle':      { Icon: CandlestickChart, hint: 'Japanese candlesticks' },
  'Heikin Ashi': { Icon: CandlestickChart, hint: 'Smoothed trend candles' },
  'Bar':         { Icon: BarChart3,        hint: 'OHLC bars' },
  'Line':        { Icon: LineChartIcon,    hint: 'Close line' },
  'Area':        { Icon: AreaChart,        hint: 'Filled area' },
  'P&F':         { Icon: LayoutGrid,       hint: 'Point & Figure' },
}
const RATING_DISPLAY: Record<string, { text: string; color: string }> = {
  strong_buy:  { text: 'Strong Buy',  color: '#00c97a' },
  buy:         { text: 'Buy',         color: '#3ddc97' },
  neutral:     { text: 'Neutral',     color: '#a0a0a0' },
  sell:        { text: 'Sell',        color: '#ff8c42' },
  strong_sell: { text: 'Strong Sell', color: '#ff4560' },
}

interface IndicatorDef { id: string; label: string; group: 'overlay' | 'oscillator'; color: string }
const INDICATORS: IndicatorDef[] = [
  { id: 'SMA20',  label: 'SMA 20',           group: 'overlay',     color: '#f0a500'  },
  { id: 'SMA50',  label: 'SMA 50',           group: 'overlay',     color: '#1e90ff'  },
  { id: 'SMA200', label: 'SMA 200',          group: 'overlay',     color: '#a78bfa'  },
  { id: 'EMA9',   label: 'EMA 9',            group: 'overlay',     color: '#00e5c0'  },
  { id: 'EMA21',  label: 'EMA 21',           group: 'overlay',     color: '#ff9f43'  },
  { id: 'VWAP',   label: 'VWAP',             group: 'overlay',     color: '#e056fd'  },
  { id: 'BB',     label: 'Bollinger Bands',  group: 'overlay',     color: '#1e90ff'  },
  { id: 'DONCH',  label: 'Donchian Ch.',     group: 'overlay',     color: '#1e90ff'  },
  { id: 'ICHI',   label: 'Ichimoku Cloud',   group: 'overlay',     color: '#00e5c0'  },
  { id: 'FIB',    label: 'Fibonacci',        group: 'overlay',     color: '#00e5c070'},
  { id: 'PIVOT',  label: 'Pivot Points',     group: 'overlay',     color: '#f0a500'  },
  { id: 'SR',     label: 'Support/Resist.',  group: 'overlay',     color: '#00c97a'  },
  { id: 'RSI',    label: 'RSI 14',           group: 'oscillator',  color: '#f0a500'  },
  { id: 'MACD',   label: 'MACD',             group: 'oscillator',  color: '#1e90ff'  },
]

// Full TradingView-style timeframe set (spec §2.3). Yahoo range limits respected:
// 1m ≤ 7d · 5/15/30m ≤ 60d · 1h ≤ 730d. 4h is aggregated client-side from 1h.
const TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'] as const
type TF = typeof TFS[number]
const TF_CFG: Record<TF, { range: string; interval: string; label: string; agg4h?: boolean }> = {
  '1m':  { range: '7d',   interval: '1m',  label: '1m · 7d'    },   // Yahoo 1m max 7d
  '5m':  { range: '60d',  interval: '5m',  label: '5m · 60d'   },   // 5/15/30m max 60d
  '15m': { range: '60d',  interval: '15m', label: '15m · 60d'  },
  '30m': { range: '60d',  interval: '30m', label: '30m · 60d'  },
  '1h':  { range: '730d', interval: '1h',  label: '1h · 2y'    },   // 1h max 730d
  '4h':  { range: '730d', interval: '1h',  label: '4h · 2y', agg4h: true },
  '1D':  { range: '5y',   interval: '1d',  label: '1D · 5y'    },
  '1W':  { range: '10y',  interval: '1wk', label: '1W · 10y'   },
  '1M':  { range: 'max',  interval: '1mo', label: '1M · max'   },
}

// Grouped intervals for the timeframe dropdown.
const TF_GROUPS: Array<{ label: string; items: TF[] }> = [
  { label: 'Minutes', items: ['1m', '5m', '15m', '30m'] },
  { label: 'Hours',   items: ['1h', '4h'] },
  { label: 'Days',    items: ['1D', '1W', '1M'] },
]

// The pattern engine reasons about the BAR interval — now an identity mapping.
const ENGINE_TF: Record<TF, Timeframe> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1D': '1D', '1W': '1W', '1M': '1M',
}

// Map a scanned screener timeframe back to the chart TF that uses that interval.
const SCAN_TF_TO_CHART: Record<'1D' | '1W', TF> = { '1D': '1D', '1W': '1W' }

// Fetch configs for the per-timeframe rating pills (spec §2.2).
const RATING_TF_FETCH: Partial<Record<Timeframe, { range: string; interval: string }>> = {
  '15m': { range: '5d',  interval: '15m' },
  '1h':  { range: '1mo', interval: '1h'  },
  '4h':  { range: '3mo', interval: '1h'  },   // 1h candles aggregated to 4h
  '1D':  { range: '1y',  interval: '1d'  },
  '1W':  { range: '5y',  interval: '1wk' },
}

/** Aggregate 1h candles into 4h buckets (Yahoo has no native 4h). */
function aggregateTo4h(candles: Candle[]): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < candles.length; i += 4) {
    const grp = candles.slice(i, i + 4)
    if (!grp.length) break
    out.push({
      time: grp[0].time, open: grp[0].open,
      high: Math.max(...grp.map(c => c.high)),
      low: Math.min(...grp.map(c => c.low)),
      close: grp[grp.length - 1].close,
      volume: grp.reduce((a, c) => a + c.volume, 0),
    })
  }
  return out
}

/** Shared Yahoo candle fetch (used by the main chart and by compare series). */
async function fetchCandlesRaw(symbol: string, range: string, interval: string, agg4h: boolean): Promise<Candle[]> {
  try {
    const r = await fetch(`/api/yfinance?symbols=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`)
    const j = await r.json()
    const res = j?.results?.[0]?.data?.chart?.result?.[0]
    if (!res) return []
    const ts = res.timestamp ?? [], q = res.indicators?.quote?.[0]
    if (!q) return []
    const raw = (ts as number[])
      .map((time, i) => ({ time, open: q.open?.[i] ?? null, high: q.high?.[i] ?? null, low: q.low?.[i] ?? null, close: q.close?.[i] ?? null, volume: q.volume?.[i] ?? 0 }))
      .filter((c): c is Candle => c.open !== null && c.high !== null && c.low !== null && c.close !== null)
      .sort((a, b) => a.time - b.time)
    return agg4h ? aggregateTo4h(raw) : raw
  } catch { return [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// ChartPanel
// ─────────────────────────────────────────────────────────────────────────────

export default function ChartPanel() {
  const { symbols: wl } = useWatchlist()
  const symbols = wl.length > 0 ? wl : ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA']

  // ── State ──────────────────────────────────────────────────────────────────
  const [sym,           setSym]           = useState(() => symbols[0] ?? 'SPY')
  const [searchSym,     setSearchSym]     = useState('')
  const [searchInput,   setSearchInput]   = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchOpen,    setSearchOpen]    = useState(false)
  const [searchFocIdx,  setSearchFocIdx]  = useState(-1)
  const [tf,            setTf]            = useState<TF>('1D')
  const [chartType,     setChartType]     = useState<ChartType>('Candle')
  const [activeInds,    setActiveInds]    = useState<Set<string>>(() => new Set(['FIB', 'PIVOT']))
  const [indOpen,       setIndOpen]       = useState(false)
  const [quote,         setQuote]         = useState<Record<string, number> | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [ready,         setReady]         = useState(false)
  const [pfData,        setPfData]        = useState<PnFColumn[]>([])

  // ── Pattern engine + ANALYSIS drawer state ─────────────────────────────────
  const [analysis,        setAnalysis]        = useState<DetectAllResult | null>(null)
  const [analysisOpen,    setAnalysisOpen]    = useState(false)
  const [patternVis,      setPatternVis]      = useState<PatternVisibility>('all')
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null)
  const [perTfRatings,    setPerTfRatings]    = useState<Partial<Record<Timeframe, TaRating | 'loading'>>>({})
  const [activeRatingTf,  setActiveRatingTf]  = useState<Timeframe>('1D')
  const [aiNote,          setAiNote]          = useState<AiNote | null>(null)
  const [aiLoading,       setAiLoading]       = useState(false)
  const [aiError,         setAiError]         = useState<string | null>(null)
  const [scaleMode,       setScaleMode]       = useState<'normal' | 'log' | 'pct'>('normal')
  const [typeOpen,        setTypeOpen]        = useState(false)
  const [intervalOpen,    setIntervalOpen]    = useState(false)
  const [maximized,       setMaximized]       = useState(false)
  const [analysisHover,   setAnalysisHover]   = useState(false)
  const [compareSyms,     setCompareSyms]     = useState<string[]>([])
  const [compareInput,    setCompareInput]    = useState('')
  const [compareOpen,     setCompareOpen]     = useState(false)
  const [templates,       setTemplates]       = useState<Array<{ name: string; chartType: ChartType; inds: string[]; tf: TF; vis: PatternVisibility; scale: 'normal' | 'log' | 'pct' }>>([])
  const [tplOpen,         setTplOpen]         = useState(false)
  const [alertToast,      setAlertToast]      = useState<string | null>(null)

  const effectiveSym = searchSym || sym

  // ── Refs ───────────────────────────────────────────────────────────────────
  const containerRef   = useRef<HTMLDivElement>(null)
  const pfCanvasRef    = useRef<HTMLCanvasElement>(null)
  const tooltipRef     = useRef<HTMLDivElement>(null)
  const tabsScrollRef  = useRef<HTMLDivElement>(null)
  const searchBoxRef   = useRef<HTMLDivElement>(null)
  const indDropRef     = useRef<HTMLDivElement>(null)
  const searchTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chartR         = useRef<any>(null)
  const seriesR        = useRef<Record<string, any>>({})
  const priceLines     = useRef<Record<string, any[]>>({ fib: [], pivot: [], sr: [], rsiOB: [], rsiOS: [], rsiMid: [] })
  const dataRef        = useRef<Candle[]>([])
  // Pattern overlay refs (read inside chart subscriptions, which capture stale state).
  const overlayRef     = useRef<HTMLCanvasElement>(null)
  const analysisRef    = useRef<DetectAllResult | null>(null)
  const selectedRef    = useRef<string | null>(null)
  const visRef         = useRef<PatternVisibility>('all')
  const patternLines   = useRef<any[]>([])
  const chartAreaRef   = useRef<HTMLDivElement>(null)
  const panelRootRef   = useRef<HTMLDivElement>(null)
  const barSpacingRef  = useRef(6)
  const compareSeriesRef = useRef<Record<string, any>>({})
  const typeDropRef    = useRef<HTMLDivElement>(null)
  const intervalDropRef = useRef<HTMLDivElement>(null)

  // ── Symbol sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (symbols.length > 0 && !symbols.includes(sym)) setSym(symbols[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')])

  // ── Global active symbol (driven by the top search bar) ───────────────────
  const activeSymbol = useActiveSymbol(s => s.activeSymbol)
  const focusPattern = useActiveSymbol(s => s.focusPattern)
  const pendingFocusRef = useRef<{ id: string; nonce: number } | null>(null)
  useEffect(() => {
    if (!activeSymbol) return
    const upper = activeSymbol.toUpperCase()
    if (symbols.includes(upper)) {
      setSym(upper)
      setSearchSym('')
      setSearchInput('')
    } else {
      setSearchSym(upper)
      setSearchInput(upper)
    }
    setSearchOpen(false)
    setSearchResults([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSymbol])

  // ── Screener → chart pattern hand-off (spec §4.3) ──────────────────────────
  useEffect(() => {
    if (!focusPattern) return
    pendingFocusRef.current = { id: focusPattern.patternId, nonce: focusPattern.nonce }
    setAnalysisOpen(true)
    setTf(SCAN_TF_TO_CHART[focusPattern.tf])
    // The activeSymbol effect routes the symbol; runDetection consumes the pending id.
  }, [focusPattern])

  // ── Click-outside closes dropdowns ────────────────────────────────────────
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (searchBoxRef.current   && !searchBoxRef.current.contains(e.target as Node))   setSearchOpen(false)
      if (indDropRef.current     && !indDropRef.current.contains(e.target as Node))     setIndOpen(false)
      if (typeDropRef.current    && !typeDropRef.current.contains(e.target as Node))    setTypeOpen(false)
      if (intervalDropRef.current && !intervalDropRef.current.contains(e.target as Node)) setIntervalOpen(false)
    }
    document.addEventListener('mousedown', handle)
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaximized(false) }
    document.addEventListener('keydown', onEsc)
    return () => { document.removeEventListener('mousedown', handle); document.removeEventListener('keydown', onEsc) }
  }, [])

  // ── Search ─────────────────────────────────────────────────────────────────
  const handleSearchInput = useCallback((val: string) => {
    setSearchInput(val)
    setSearchFocIdx(-1)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!val.trim()) { setSearchResults([]); setSearchOpen(false); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(val.trim())}`)
        const d = await r.json()
        setSearchResults(d.results ?? [])
        setSearchOpen(true)
      } catch {}
    }, 250)
  }, [])

  const selectResult = useCallback((r: SearchResult) => {
    setSearchSym(r.symbol)
    setSearchInput(r.symbol)
    setSearchOpen(false)
    setSearchResults([])
    setSearchFocIdx(-1)
  }, [])

  const clearSearch = useCallback(() => {
    setSearchSym('')
    setSearchInput('')
    setSearchOpen(false)
    setSearchResults([])
    setSearchFocIdx(-1)
  }, [])

  const handleSearchKey = useCallback((e: React.KeyboardEvent) => {
    if (!searchOpen || !searchResults.length) {
      if (e.key === 'Enter' && searchInput.trim()) { setSearchSym(searchInput.trim().toUpperCase()); setSearchOpen(false) }
      if (e.key === 'Escape') clearSearch()
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSearchFocIdx(i => Math.min(i + 1, searchResults.length - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSearchFocIdx(i => Math.max(i - 1, -1)) }
    if (e.key === 'Enter')     { e.preventDefault(); if (searchFocIdx >= 0) selectResult(searchResults[searchFocIdx]); else if (searchResults.length > 0) selectResult(searchResults[0]) }
    if (e.key === 'Escape')    { setSearchOpen(false); setSearchFocIdx(-1) }
  }, [searchOpen, searchResults, searchFocIdx, searchInput, clearSearch, selectResult])

  // ── Toggle indicator ───────────────────────────────────────────────────────
  const toggleInd = useCallback((id: string) => {
    setActiveInds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  // ── Update pane layout ─────────────────────────────────────────────────────
  const updatePaneLayout = useCallback((inds: Set<string>) => {
    const chart = chartR.current
    if (!chart) return
    const hasRsi = inds.has('RSI'), hasMacd = inds.has('MACD')
    if (hasRsi && hasMacd) {
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.02, bottom: 0.42 } })
      chart.priceScale('vol').applyOptions(  { scaleMargins: { top: 0.58, bottom: 0.28 } })
      chart.priceScale('rsi').applyOptions(  { scaleMargins: { top: 0.73, bottom: 0.14 } })
      chart.priceScale('macd').applyOptions( { scaleMargins: { top: 0.87, bottom: 0.02 } })
    } else if (hasRsi) {
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.02, bottom: 0.28 } })
      chart.priceScale('vol').applyOptions(  { scaleMargins: { top: 0.72, bottom: 0.16 } })
      chart.priceScale('rsi').applyOptions(  { scaleMargins: { top: 0.84, bottom: 0.02 } })
      chart.priceScale('macd').applyOptions( { scaleMargins: { top: 0.99, bottom: 0.005 } })
    } else if (hasMacd) {
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.02, bottom: 0.28 } })
      chart.priceScale('vol').applyOptions(  { scaleMargins: { top: 0.72, bottom: 0.16 } })
      chart.priceScale('rsi').applyOptions(  { scaleMargins: { top: 0.99, bottom: 0.005 } })
      chart.priceScale('macd').applyOptions( { scaleMargins: { top: 0.84, bottom: 0.02 } })
    } else {
      chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.02, bottom: 0.15 } })
      chart.priceScale('vol').applyOptions(  { scaleMargins: { top: 0.85, bottom: 0.02 } })
      chart.priceScale('rsi').applyOptions(  { scaleMargins: { top: 0.99, bottom: 0.005 } })
      chart.priceScale('macd').applyOptions( { scaleMargins: { top: 0.99, bottom: 0.005 } })
    }
  }, [])

  // ── Apply all indicators to chart ──────────────────────────────────────────
  const applyAll = useCallback((rawCandles: Candle[], inds: Set<string>) => {
    const s = seriesR.current
    if (!s.candle || rawCandles.length === 0) return

    const isPnF  = chartType === 'P&F'
    const isHA   = chartType === 'Heikin Ashi'
    const isBar  = chartType === 'Bar'
    const isLine = chartType === 'Line'
    const isArea = chartType === 'Area'
    const isCandle = chartType === 'Candle' || isHA

    const displayCandles = isHA ? toHeikinAshi(rawCandles) : rawCandles
    const close = rawCandles.map(c => c.close)

    // ── Main series data ────────────────────────────────────────────────────
    s.candle?.setData(isCandle && !isPnF ? displayCandles : [])
    s.bar?.setData(isBar ? displayCandles : [])
    s.line?.setData(isLine ? displayCandles.map(c => ({ time: c.time, value: c.close })) : [])
    s.area?.setData(isArea ? displayCandles.map(c => ({ time: c.time, value: c.close })) : [])

    // ── Volume ──────────────────────────────────────────────────────────────
    s.volume?.setData(rawCandles.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? 'rgba(0,201,122,0.45)' : 'rgba(255,69,96,0.45)',
    })))

    // ── SMA ─────────────────────────────────────────────────────────────────
    const mkSmaData = (period: number) => {
      const arr = smaArr(close, period)
      const off = rawCandles.length - arr.length
      return arr.map((v, k) => ({ time: rawCandles[off + k].time, value: v }))
    }
    s.sma20?.setData(inds.has('SMA20')  ? mkSmaData(20)  : [])
    s.sma50?.setData(inds.has('SMA50')  ? mkSmaData(50)  : [])
    s.sma200?.setData(inds.has('SMA200') ? mkSmaData(200) : [])

    // ── EMA ─────────────────────────────────────────────────────────────────
    const mkEmaData = (period: number) => {
      const arr = emaArr(close, period)
      const off = rawCandles.length - arr.length
      return arr.map((v, k) => ({ time: rawCandles[off + k].time, value: v }))
    }
    s.ema9?.setData(inds.has('EMA9')  ? mkEmaData(9)  : [])
    s.ema21?.setData(inds.has('EMA21') ? mkEmaData(21) : [])

    // ── VWAP ────────────────────────────────────────────────────────────────
    s.vwap?.setData(inds.has('VWAP') ? vwapArr(rawCandles) : [])

    // ── Bollinger Bands ─────────────────────────────────────────────────────
    if (inds.has('BB') && rawCandles.length >= 20) {
      const bb = bollingerBands(rawCandles)
      s.bbUpper?.setData(bb.map(b => ({ time: b.time, value: b.upper })))
      s.bbMid?.setData(  bb.map(b => ({ time: b.time, value: b.mid   })))
      s.bbLower?.setData(bb.map(b => ({ time: b.time, value: b.lower })))
    } else { s.bbUpper?.setData([]); s.bbMid?.setData([]); s.bbLower?.setData([]) }

    // ── Donchian ────────────────────────────────────────────────────────────
    if (inds.has('DONCH') && rawCandles.length >= 20) {
      const dc = donchianChannels(rawCandles)
      s.donchUp?.setData( dc.map(d => ({ time: d.time, value: d.high })))
      s.donchDn?.setData( dc.map(d => ({ time: d.time, value: d.low  })))
      s.donchMid?.setData(dc.map(d => ({ time: d.time, value: d.mid  })))
    } else { s.donchUp?.setData([]); s.donchDn?.setData([]); s.donchMid?.setData([]) }

    // ── Ichimoku ────────────────────────────────────────────────────────────
    if (inds.has('ICHI') && rawCandles.length >= 52) {
      const ic = ichimokuCloud(rawCandles)
      s.ichiTenkan?.setData(ic.tenkan)
      s.ichiKijun?.setData( ic.kijun)
      s.ichiChikou?.setData(ic.chikou)
    } else { s.ichiTenkan?.setData([]); s.ichiKijun?.setData([]); s.ichiChikou?.setData([]) }

    // ── Price lines: Fib / Pivot / S&R ─────────────────────────────────────
    // Always attach to candle series (shared right price scale)
    const priceSeries = s.candle
    ;(['fib', 'pivot', 'sr'] as const).forEach(key => {
      priceLines.current[key]?.forEach(l => { try { priceSeries?.removePriceLine(l) } catch {} })
      priceLines.current[key] = []
    })

    if (priceSeries && !isPnF && rawCandles.length >= 2) {
      if (inds.has('FIB')) {
        fibLevels(rawCandles).forEach(f => {
          try { priceLines.current.fib.push(priceSeries.createPriceLine({ price: f.price, color: f.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: f.label })) } catch {}
        })
      }
      if (inds.has('PIVOT')) {
        const piv = pivotLevels(rawCandles)
        ;[
          { price: piv.pivot, color: '#f0a50088', lineWidth: 2, title: 'Pivot' },
          { price: piv.r1,    color: '#00c97a99', lineWidth: 1, title: 'R1'    },
          { price: piv.r2,    color: '#00c97a66', lineWidth: 1, title: 'R2'    },
          { price: piv.s1,    color: '#ff456099', lineWidth: 1, title: 'S1'    },
          { price: piv.s2,    color: '#ff456066', lineWidth: 1, title: 'S2'    },
        ].forEach(p => { try { priceLines.current.pivot.push(priceSeries.createPriceLine({ ...p, lineStyle: 2, axisLabelVisible: true })) } catch {} })
      }
      if (inds.has('SR')) {
        supportResistanceLevels(rawCandles).forEach(l => {
          const alpha = Math.min(0.9, 0.4 + l.strength * 0.08)
          const color = l.type === 'resistance' ? `rgba(255,69,96,${alpha})` : `rgba(0,201,122,${alpha})`
          try { priceLines.current.sr.push(priceSeries.createPriceLine({ price: l.price, color, lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: l.type === 'resistance' ? `R(${l.strength})` : `S(${l.strength})` })) } catch {}
        })
      }
    }

    // ── RSI ─────────────────────────────────────────────────────────────────
    ;(['rsiOB', 'rsiOS', 'rsiMid'] as const).forEach(key => {
      priceLines.current[key]?.forEach(l => { try { s.rsiLine?.removePriceLine(l) } catch {} })
      priceLines.current[key] = []
    })
    if (inds.has('RSI')) {
      s.rsiLine?.setData(rsiArr(rawCandles))
      try {
        priceLines.current.rsiOB  = [s.rsiLine?.createPriceLine({ price: 70, color: 'rgba(255,69,96,0.5)',    lineWidth: 1, lineStyle: 2, axisLabelVisible: true,  title: 'OB' })]
        priceLines.current.rsiOS  = [s.rsiLine?.createPriceLine({ price: 30, color: 'rgba(0,201,122,0.5)',   lineWidth: 1, lineStyle: 2, axisLabelVisible: true,  title: 'OS' })]
        priceLines.current.rsiMid = [s.rsiLine?.createPriceLine({ price: 50, color: 'rgba(160,160,160,0.25)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false         })]
      } catch {}
    } else {
      s.rsiLine?.setData([])
    }

    // ── MACD ────────────────────────────────────────────────────────────────
    if (inds.has('MACD') && rawCandles.length > 40) {
      const md = macdData(rawCandles)
      s.macdLine?.setData(md.macd)
      s.macdSignal?.setData(md.signal)
      s.macdHist?.setData(md.hist)
    } else { s.macdLine?.setData([]); s.macdSignal?.setData([]); s.macdHist?.setData([]) }

    // ── P&F ─────────────────────────────────────────────────────────────────
    if (isPnF) setPfData(computePnF(rawCandles)); else setPfData([])

  }, [chartType])

  // ── Pattern overlay + detection ────────────────────────────────────────────
  const redrawOverlay = useCallback(() => {
    const canvas = overlayRef.current, chart = chartR.current, s = seriesR.current
    if (!canvas || !chart || !s.candle) return
    drawGeometric(canvas, chart, s.candle, analysisRef.current?.geometric ?? [], {
      visibility: visRef.current, selectedId: selectedRef.current,
    })
  }, [])

  const applyPatternLines = useCallback((det: PatternDetection | null) => {
    const s = seriesR.current
    patternLines.current.forEach(l => { try { s.candle?.removePriceLine(l) } catch {} })
    patternLines.current = []
    if (!det || !s.candle) return
    const add = (price: number | null, color: string, style: number, title: string) => {
      if (price == null) return
      try { patternLines.current.push(s.candle.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })) } catch {}
    }
    add(det.target,        'rgba(0,201,122,0.9)', 2, 'Target')
    add(det.invalidation,  'rgba(255,69,96,0.9)', 2, 'Invalid')
    add(det.breakoutLevel, 'rgba(160,160,160,0.8)', 3, 'Breakout')
  }, [])

  const focusPatternOnChart = useCallback((det: PatternDetection) => {
    setSelectedPattern(det.id)
    selectedRef.current = det.id
    applyPatternLines(det)
    const ts = chartR.current?.timeScale()
    const pad = Math.max(6, Math.round((det.endIndex - det.startIndex) * 0.3))
    try { ts?.setVisibleLogicalRange({ from: Math.max(0, det.startIndex - pad), to: det.endIndex + pad }) } catch {}
    redrawOverlay()
  }, [applyPatternLines, redrawOverlay])

  const runDetection = useCallback((candles: Candle[], chartTf: TF) => {
    const result = detectAll(candles, { timeframe: ENGINE_TF[chartTf] })
    analysisRef.current = result
    setAnalysis(result)
    try { seriesR.current.candle?.setMarkers(buildCandleMarkers(result.candlestick, visRef.current)) } catch {}

    // If the screener handed us a pattern to focus, prefer it; else top geometric.
    const all = [...result.geometric, ...result.candlestick]
    const pending = pendingFocusRef.current
    const focusTarget = (pending && all.find(d => d.id === pending.id)) || result.geometric[0] || null
    if (pending) pendingFocusRef.current = null

    setSelectedPattern(focusTarget?.id ?? null)
    selectedRef.current = focusTarget?.id ?? null
    applyPatternLines(focusTarget)
    redrawOverlay()
  }, [applyPatternLines, redrawOverlay])

  const loadTfRating = useCallback(async (t: Timeframe) => {
    setActiveRatingTf(t)
    setPerTfRatings(prev => (prev[t] && prev[t] !== 'loading') ? prev : { ...prev, [t]: 'loading' })
    if (perTfRatings[t] && perTfRatings[t] !== 'loading') return
    const cfg = RATING_TF_FETCH[t]
    if (!cfg) return
    try {
      const r = await fetch(`/api/yfinance?symbols=${encodeURIComponent(effectiveSym)}&range=${cfg.range}&interval=${cfg.interval}`)
      const j = await r.json()
      const res = j?.results?.[0]?.data?.chart?.result?.[0]
      const ts = res?.timestamp ?? [], q = res?.indicators?.quote?.[0]
      if (!q) throw new Error('no data')
      let candles: Candle[] = (ts as number[])
        .map((time, i) => ({ time, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0 }))
        .filter((c): c is Candle => c.open != null && c.close != null && c.high != null && c.low != null)
      if (t === '4h') candles = aggregateTo4h(candles)
      const rating = computeRating(candles)
      setPerTfRatings(prev => ({ ...prev, [t]: rating }))
    } catch {
      setPerTfRatings(prev => { const n = { ...prev }; delete n[t]; return n })
    }
  }, [effectiveSym, perTfRatings])

  const generateAi = useCallback(async () => {
    const result = analysisRef.current
    const candles = dataRef.current
    if (!result || candles.length < 30) { setAiError('Not enough data for analysis'); return }
    setAiLoading(true); setAiError(null)
    try {
      const close = candles.map(c => c.close)
      const lastClose = close[close.length - 1]
      const rsiV = rsiArr(candles).at(-1)?.value ?? null
      const md = macdData(candles)
      const macdState = md.macd.length && md.signal.length
        ? (md.macd[md.macd.length - 1].value > md.signal[md.signal.length - 1].value ? 'bullish (above signal)' : 'bearish (below signal)')
        : 'n/a'
      const sma50 = smaArr(close, 50).at(-1) ?? null
      const sma200 = smaArr(close, 200).at(-1) ?? null
      const vol20 = candles.slice(-20).reduce((a, c) => a + c.volume, 0) / Math.min(20, candles.length)
      const volVs20 = vol20 > 0 ? candles[candles.length - 1].volume / vol20 : null
      let trSum = 0, trN = 0
      for (let i = Math.max(1, candles.length - 14); i < candles.length; i++) {
        const c = candles[i], p = candles[i - 1]
        trSum += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)); trN++
      }
      const atrPct = lastClose > 0 && trN ? (trSum / trN) / lastClose * 100 : null
      const note = await fetchChartAnalysis({
        symbol: effectiveSym, timeframe: ENGINE_TF[tf],
        rating: result.rating, structure: result.structure,
        patterns: [...result.geometric, ...result.candlestick].sort((a, b) => b.confidence - a.confidence).slice(0, 5)
          .map(d => ({ id: d.id, name: d.name, direction: d.direction, status: d.status, confidence: d.confidence, breakoutLevel: d.breakoutLevel, target: d.target, invalidation: d.invalidation, implication: d.implication })),
        keyLevels: { support: result.structure.support, resistance: result.structure.resistance },
        indicatorSnapshot: {
          rsi: rsiV, macdState, volVs20, atrPct,
          distFrom50: sma50 ? (lastClose - sma50) / sma50 * 100 : null,
          distFrom200: sma200 ? (lastClose - sma200) / sma200 * 100 : null,
        },
        lastClose,
      })
      setAiNote(note)
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAiLoading(false)
    }
  }, [effectiveSym, tf])

  // ── Scale / screenshot / fullscreen / keyboard (spec §2.3) ─────────────────
  const applyScale = useCallback((mode: 'normal' | 'log' | 'pct') => {
    setScaleMode(mode)
    const m = mode === 'log' ? 1 : mode === 'pct' ? 2 : 0   // LWC PriceScaleMode
    try { chartR.current?.priceScale('right').applyOptions({ mode: m }) } catch {}
  }, [])

  const resetView = useCallback(() => {
    const chart = chartR.current
    if (!chart) return
    try {
      const n = dataRef.current.length
      const visible = Math.min(120, n)
      if (visible < n) chart.timeScale().setVisibleLogicalRange({ from: n - visible, to: n - 1 })
      else chart.timeScale().fitContent()
      chart.priceScale('right').applyOptions({ autoScale: true })
    } catch {}
  }, [])

  const screenshot = useCallback(() => {
    const chart = chartR.current
    if (!chart) return
    try {
      const src = chart.takeScreenshot()
      const out = document.createElement('canvas')
      out.width = src.width; out.height = src.height
      const c = out.getContext('2d'); if (!c) return
      c.drawImage(src, 0, 0)
      c.font = 'bold 15px Syne, sans-serif'
      c.fillStyle = 'rgba(0,229,192,0.55)'
      c.fillText(`NEXUS · ${effectiveSym} · ${tf}`, 12, src.height - 12)
      const a = document.createElement('a')
      a.download = `NEXUS_${effectiveSym}_${tf}.png`
      a.href = out.toDataURL('image/png')
      a.click()
    } catch {}
  }, [effectiveSym, tf])

  const onChartKey = useCallback((e: React.KeyboardEvent) => {
    const chart = chartR.current
    if (!chart) return
    const ts = chart.timeScale()
    const pos = () => { try { return ts.scrollPosition() } catch { return 0 } }
    if (e.key === 'ArrowRight') { e.preventDefault(); ts.scrollToPosition(pos() + 3, false) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); ts.scrollToPosition(pos() - 3, false) }
    else if (e.key === '+' || e.key === '=') { barSpacingRef.current = Math.min(60, barSpacingRef.current + 1.5); ts.applyOptions({ barSpacing: barSpacingRef.current }) }
    else if (e.key === '-' || e.key === '_') { barSpacingRef.current = Math.max(2, barSpacingRef.current - 1.5); ts.applyOptions({ barSpacing: barSpacingRef.current }) }
    else if (e.key === 'f') { try { if (document.fullscreenElement) document.exitFullscreen(); else panelRootRef.current?.requestFullscreen() } catch {} }
    else if (e.key === 's') { screenshot() }
    else if (/^[1-9]$/.test(e.key)) { const idx = parseInt(e.key, 10) - 1; if (TFS[idx]) setTf(TFS[idx]) }
  }, [screenshot])

  const miniBtn = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    minWidth: 28, height: 24, padding: '0 7px', borderRadius: '4px', cursor: 'pointer', flexShrink: 0,
    fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
    border: `1px solid ${active ? 'var(--teal)' : 'var(--border)'}`,
    background: active ? 'rgba(0,229,192,0.12)' : 'transparent',
    color: active ? 'var(--teal)' : 'var(--text-2)', transition: 'all 0.12s',
  })
  // Dropdown-trigger button (icon + label + caret) for the interval/type pickers.
  const ddBtn = (active: boolean, accent = 'var(--teal)'): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', borderRadius: '4px', cursor: 'pointer', flexShrink: 0,
    fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', fontWeight: 600,
    border: `1px solid ${active ? accent : 'var(--border)'}`,
    background: active ? 'rgba(0,229,192,0.08)' : 'var(--bg-deep)',
    color: active ? accent : '#dfe8f0', transition: 'all 0.12s',
  })

  // ── Symbol comparison (spec §2.3) ──────────────────────────────────────────
  const COMPARE_COLORS = ['#a78bfa', '#ff9f43', '#22d3ee']
  const drawCompare = useCallback(async (syms: string[]) => {  // eslint-disable-line react-hooks/exhaustive-deps
    const chart = chartR.current
    if (!chart) return
    for (const s of Object.keys(compareSeriesRef.current)) {
      if (!syms.includes(s)) { try { chart.removeSeries(compareSeriesRef.current[s]) } catch {}; delete compareSeriesRef.current[s] }
    }
    const cfg = TF_CFG[tf]
    await Promise.all(syms.map(async (s, i) => {
      const candles = await fetchCandlesRaw(s, cfg.range, cfg.interval, !!cfg.agg4h)
      if (!candles.length) return
      let ser = compareSeriesRef.current[s]
      if (!ser) {
        ser = chart.addLineSeries({ priceScaleId: 'compare', color: COMPARE_COLORS[i % 3], lineWidth: 1.5, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false })
        compareSeriesRef.current[s] = ser
      }
      const base = candles[0].close
      ser.setData(candles.map(c => ({ time: c.time, value: base > 0 ? +(((c.close / base) - 1) * 100).toFixed(2) : 0 })))
    }))
    try { chart.priceScale('compare').applyOptions({ visible: false, scaleMargins: { top: 0.02, bottom: 0.15 } }) } catch {}
  }, [tf])

  const addCompare = useCallback(() => {
    const s = compareInput.trim().toUpperCase()
    if (!s || compareSyms.includes(s) || compareSyms.length >= 3) return
    setCompareSyms(prev => [...prev, s]); setCompareInput('')
  }, [compareInput, compareSyms])
  const removeCompare = useCallback((s: string) => setCompareSyms(prev => prev.filter(x => x !== s)), [])

  useEffect(() => { if (ready) drawCompare(compareSyms) }, [compareSyms, tf, effectiveSym, ready, drawCompare])

  // ── Saved templates (spec §2.3) ────────────────────────────────────────────
  useEffect(() => { try { const r = localStorage.getItem('nexus:templates'); if (r) setTemplates(JSON.parse(r)) } catch {} }, [])
  const saveTemplate = useCallback(() => {
    const t = { name: `Layout ${templates.length + 1}`, chartType, inds: [...activeInds], tf, vis: patternVis, scale: scaleMode }
    const next = [...templates, t]; setTemplates(next)
    try { localStorage.setItem('nexus:templates', JSON.stringify(next)) } catch {}
  }, [templates, chartType, activeInds, tf, patternVis, scaleMode])
  const applyTemplate = useCallback((t: typeof templates[number]) => {
    setChartType(t.chartType); setActiveInds(new Set(t.inds)); setTf(t.tf)
    setPatternVis(t.vis); visRef.current = t.vis; applyScale(t.scale); setTplOpen(false)
  }, [applyScale])
  const deleteTemplate = useCallback((name: string) => {
    const next = templates.filter(x => x.name !== name); setTemplates(next)
    try { localStorage.setItem('nexus:templates', JSON.stringify(next)) } catch {}
  }, [templates])

  // ── Price alerts (loginless: localStorage + poll, spec §2.3) ───────────────
  const alertKey = `nexus:alerts:${effectiveSym}`
  const addAlert = useCallback(() => {
    const price = quote?.c
    if (price == null) return
    const raw = window.prompt(`Alert price for ${effectiveSym} (current ${price.toFixed(2)})`)
    const lvl = raw ? parseFloat(raw) : NaN
    if (!isFinite(lvl)) return
    try {
      const list = JSON.parse(localStorage.getItem(alertKey) || '[]')
      list.push({ price: lvl, dir: lvl >= price ? 'above' : 'below', created: Date.now() })
      localStorage.setItem(alertKey, JSON.stringify(list))
      setAlertToast(`Alert set: ${effectiveSym} ${lvl >= price ? '≥' : '≤'} ${lvl.toFixed(2)} (fires only while this tab is open)`)
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
    } catch {}
  }, [alertKey, effectiveSym, quote])

  // poll the current quote against stored alerts
  useEffect(() => {
    if (!effectiveSym) return
    const check = () => {
      let list: Array<{ price: number; dir: 'above' | 'below'; created: number }>
      try { list = JSON.parse(localStorage.getItem(alertKey) || '[]') } catch { return }
      if (!list.length) return
      const px = quote?.c
      if (px == null) return
      const remaining = list.filter(a => !((a.dir === 'above' && px >= a.price) || (a.dir === 'below' && px <= a.price)))
      const fired = list.filter(a => !remaining.includes(a))
      if (fired.length) {
        const msg = `${effectiveSym} crossed ${fired.map(a => a.price.toFixed(2)).join(', ')} (now ${px.toFixed(2)})`
        setAlertToast(msg)
        try { if ('Notification' in window && Notification.permission === 'granted') new Notification('NEXUS price alert', { body: msg }) } catch {}
        try { localStorage.setItem(alertKey, JSON.stringify(remaining)) } catch {}
      }
    }
    check()
  }, [quote, alertKey, effectiveSym])

  useEffect(() => { if (!alertToast) return; const t = setTimeout(() => setAlertToast(null), 4500); return () => clearTimeout(t) }, [alertToast])

  // On maximize toggle the container resizes (autoSize handles the chart canvas);
  // re-project the overlays once layout settles. Two passes cover the transition.
  useEffect(() => {
    if (!ready) return
    const t1 = setTimeout(() => redrawOverlay(), 60)
    const t2 = setTimeout(() => redrawOverlay(), 220)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [maximized, ready, redrawOverlay])

  // Full-screen chart via the Fullscreen API — promotes the panel to the top
  // layer so it's immune to the grid's CSS transforms (a plain fixed overlay
  // would be positioned relative to a transformed ancestor and get clipped).
  const toggleMaximize = useCallback(() => {
    try {
      if (document.fullscreenElement) document.exitFullscreen()
      else panelRootRef.current?.requestFullscreen()
    } catch {}
  }, [])
  useEffect(() => {
    const onFs = () => setMaximized(document.fullscreenElement === panelRootRef.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  // ── Chart initialization ───────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    let dead = false
    ;(async () => {
      try {
        const LWC = await import('lightweight-charts')
        if (dead || !containerRef.current) return

        const chart = LWC.createChart(containerRef.current, {
          // Let the library track the container with its own ResizeObserver.
          // This survives the maximize↔window transition without the price axis
          // being clipped by a stale manually-applied width.
          autoSize: true,
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
          layout: { background: { color: 'transparent' }, textColor: '#7a9ab0', fontSize: 10 },
          grid: { vertLines: { color: 'rgba(150,165,185,0.12)', style: 1 }, horzLines: { color: 'rgba(150,165,185,0.12)', style: 1 } },
          crosshair: {
            mode: 1,
            vertLine: { color: '#f0a50066', width: 1, style: 0, labelBackgroundColor: '#f0a500' },
            horzLine: { color: '#f0a50066', width: 1, style: 0, labelBackgroundColor: '#1c1f25' },
          },
          rightPriceScale: { borderColor: '#1c1f25', textColor: '#7a9ab0', visible: true, ticksVisible: true, minimumWidth: 56 },
          timeScale: {
            borderColor: '#1c1f25', timeVisible: true, secondsVisible: false,
            rightOffset: 8, barSpacing: 8, minBarSpacing: 1.2, fixLeftEdge: false,
            lockVisibleTimeRangeOnResize: true,
          },
          // TradingView-like feel: kinetic momentum scroll, cursor-anchored wheel
          // zoom, drag-to-pan, double-click axis to auto-reset.
          handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
          handleScale: {
            mouseWheel: true, pinch: true,
            axisPressedMouseMove: { time: true, price: true },
            axisDoubleClickReset: { time: true, price: true },
          },
          kineticScroll: { touch: true, mouse: true },
        })

        const shared = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }
        // The active price series shows a live last-price line + an axis tag — the
        // professional touch every trading chart has.
        const mainExtras = {
          lastValueVisible: true, priceLineVisible: true,
          priceLineWidth: 1 as const, priceLineStyle: 2 as const, crosshairMarkerVisible: true,
        }

        // Main series — all types pre-created, active one gets data
        const candle = chart.addCandlestickSeries({
          priceScaleId: 'right',
          upColor: '#00c97a', downColor: '#ff4560',
          borderUpColor: '#00c97a', borderDownColor: '#ff4560',
          wickUpColor: '#00c97a99', wickDownColor: '#ff456099',
          ...mainExtras,
        })
        const bar = chart.addBarSeries({
          priceScaleId: 'right',
          upColor: '#00c97a', downColor: '#ff4560',
          ...mainExtras,
        })
        const line = chart.addLineSeries({ ...mainExtras, priceScaleId: 'right', color: '#00e5c0', lineWidth: 2 })
        const area = chart.addAreaSeries({
          priceScaleId: 'right',
          lineColor: '#00e5c0', topColor: 'rgba(0,229,192,0.28)', bottomColor: 'rgba(0,229,192,0.01)',
          lineWidth: 2, ...mainExtras,
        })

        // Volume
        const volume = chart.addHistogramSeries({
          priceScaleId: 'vol', color: 'rgba(0,201,122,0.4)',
          priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
        })
        chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.02, bottom: 0.15 } })
        chart.priceScale('vol').applyOptions(  { scaleMargins: { top: 0.85, bottom: 0.02 } })

        // Overlay indicators
        const sma20     = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#f0a500',   lineWidth: 1 })
        const sma50     = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#1e90ff',   lineWidth: 1, lineStyle: 2 })
        const sma200    = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#a78bfa',   lineWidth: 2 })
        const ema9      = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#00e5c0',   lineWidth: 1 })
        const ema21     = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#ff9f43',   lineWidth: 1, lineStyle: 2 })
        const vwap      = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#e056fd',   lineWidth: 2 })
        const bbUpper   = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#1e90ff77', lineWidth: 1 })
        const bbMid     = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#1e90ff44', lineWidth: 1, lineStyle: 2 })
        const bbLower   = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#1e90ff77', lineWidth: 1 })
        const donchUp   = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#1e90ff',   lineWidth: 2 })
        const donchDn   = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#ff6b6b',   lineWidth: 2 })
        const donchMid  = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: 'rgba(160,160,160,0.4)', lineWidth: 1, lineStyle: 3 })
        const ichiTenkan= chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#00e5c0',   lineWidth: 2 })
        const ichiKijun = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#ff4560',   lineWidth: 2 })
        const ichiChikou= chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#a78bfa',   lineWidth: 1, lineStyle: 1 })

        // RSI pane
        const rsiLine = chart.addLineSeries({
          priceScaleId: 'rsi', color: '#f0a500', lineWidth: 2,
          lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false,
        })
        chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.99, bottom: 0.005 }, borderColor: '#1c1f25', textColor: '#7a9ab0' })

        // MACD pane
        const macdLine   = chart.addLineSeries({ priceScaleId: 'macd', color: '#1e90ff', lineWidth: 2, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false })
        const macdSignal = chart.addLineSeries({ ...shared, priceScaleId: 'macd', color: '#ff9f43', lineWidth: 1, lineStyle: 2 })
        const macdHist   = chart.addHistogramSeries({ priceScaleId: 'macd', color: 'rgba(0,201,122,0.6)', lastValueVisible: false, priceLineVisible: false })
        chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.99, bottom: 0.005 }, borderColor: '#1c1f25', textColor: '#7a9ab0' })

        seriesR.current = {
          candle, bar, line, area, volume,
          sma20, sma50, sma200, ema9, ema21, vwap,
          bbUpper, bbMid, bbLower,
          donchUp, donchDn, donchMid,
          ichiTenkan, ichiKijun, ichiChikou,
          rsiLine, macdLine, macdSignal, macdHist,
        }

        // Resize observer
        // autoSize handles the chart canvas; we only need to re-project overlays
        // (pattern lines, drawings) when the container size changes.
        const ro = new ResizeObserver(() => { redrawOverlay() })
        ro.observe(containerRef.current)

        // Crosshair tooltip
        chart.subscribeCrosshairMove(param => {
          if (!param.time || !param.point) { if (tooltipRef.current) tooltipRef.current.style.opacity = '0'; return }
          const cd = (param.seriesData.get(candle) ?? param.seriesData.get(bar)) as any
          if (cd && tooltipRef.current) {
            const up  = cd.close >= cd.open
            const cur = dataRef.current.find(c => c.time === (param.time as number))
            const vol = cur?.volume
            const fmt = (v: number) => v >= 1e9 ? (v/1e9).toFixed(2)+'B' : v >= 1e6 ? (v/1e6).toFixed(1)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'K' : String(v)
            tooltipRef.current.style.opacity = '1'
            tooltipRef.current.innerHTML =
              `<span style="color:#4a6070">O </span><b style="color:#c8d8e8">${cd.open?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070">H </span><b style="color:#00c97a">${cd.high?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070">L </span><b style="color:#ff4560">${cd.low?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070">C </span><b style="color:${up ? '#00c97a' : '#ff4560'}">${cd.close?.toFixed(2)}</b>` +
              (vol != null ? `&emsp;<span style="color:#4a6070">V </span><b style="color:#7a9ab0">${fmt(vol)}</b>` : '')
          }
        })

        chartR.current = chart
        if (!dead) setReady(true)
      } catch (err) { console.error('[ChartPanel] init:', err) }
    })()
    return () => {
      dead = true
      try { chartR.current?.remove() } catch {}
      chartR.current = null; seriesR.current = {}; setReady(false)
    }
  }, [])

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  const getCandles = useCallback(async (s: string, timeframe: TF): Promise<Candle[]> => {
    const cfg = TF_CFG[timeframe]
    return fetchCandlesRaw(s, cfg.range, cfg.interval, !!cfg.agg4h)
  }, [])

  const getQuote = useCallback(async (s: string) => {
    try {
      const r = await fetch(`/api/globalquote?symbol=${encodeURIComponent(s)}`)
      const d = await r.json()
      if (d.price != null) setQuote({ c: d.price, d: d.change??0, dp: d.changePercent??0, h: d.high??0, l: d.low??0, pc: d.prevClose??0 })
    } catch {}
  }, [])

  // ── Load data when symbol / TF / chart type changes ────────────────────────
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setLoading(true)
    setQuote(null)
    // Reset per-symbol/TF analysis state.
    setAiNote(null); setAiError(null); setPerTfRatings({}); setActiveRatingTf(ENGINE_TF[tf])
    Promise.all([getCandles(effectiveSym, tf), getQuote(effectiveSym)]).then(([candles]) => {
      if (cancelled) return
      if (candles.length > 0) {
        dataRef.current = candles
        applyAll(candles, activeInds)
        updatePaneLayout(activeInds)
        runDetection(candles, tf)
        if (chartType !== 'P&F') {
          const ts = chartR.current?.timeScale()
          // Focus on most recent ~120 candles (better than fitContent which crams everything).
          // Falls back to fitContent for short series, then snaps right edge to latest bar.
          const visible = Math.min(120, candles.length)
          if (visible < candles.length) {
            ts?.setVisibleLogicalRange({ from: candles.length - visible, to: candles.length - 1 })
          } else {
            ts?.fitContent()
          }
          chartR.current?.priceScale('right').applyOptions({ autoScale: true })
        }
      }
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSym, tf, ready, chartType])

  // ── Re-apply when indicators toggled ──────────────────────────────────────
  useEffect(() => {
    if (!ready || !dataRef.current.length) return
    applyAll(dataRef.current, activeInds)
    updatePaneLayout(activeInds)
  }, [activeInds, chartType, ready, applyAll, updatePaneLayout])

  // ── Re-project the pattern overlay on pan / zoom / crosshair ───────────────
  useEffect(() => {
    if (!ready) return
    const chart = chartR.current
    if (!chart) return
    const ts = chart.timeScale()
    const handler = () => redrawOverlay()
    ts.subscribeVisibleLogicalRangeChange(handler)
    chart.subscribeCrosshairMove(handler)
    redrawOverlay()
    return () => {
      try { ts.unsubscribeVisibleLogicalRangeChange(handler); chart.unsubscribeCrosshairMove(handler) } catch {}
    }
  }, [ready, redrawOverlay, analysis, chartType])

  // ── Render P&F canvas ──────────────────────────────────────────────────────
  useEffect(() => {
    if (pfData.length > 0 && pfCanvasRef.current && containerRef.current)
      renderPnF(pfCanvasRef.current, pfData, containerRef.current.clientHeight)
  }, [pfData])

  // ── Scroll active watchlist tab into view ──────────────────────────────────
  useEffect(() => {
    const el = tabsScrollRef.current?.querySelector(`[data-sym="${sym}"]`) as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [sym])

  const isUp = (quote?.dp ?? 0) >= 0
  const hasRsi  = activeInds.has('RSI')
  const hasMacd = activeInds.has('MACD')

  return (
    <div ref={panelRootRef} className="panel" style={{
      display: 'flex', flexDirection: 'column',
      height: '100%',
      ...(maximized ? { width: '100vw', height: '100vh', background: 'var(--bg-deep, #090c10)' } : {}),
    }}>

      {/* ── Row 1: Watchlist tabs + search ──────────────────────────────────── */}
      <div className="panel-header" style={{ justifyContent: 'space-between', gap: '6px', padding: '5px 10px', minHeight: '34px', flexWrap: 'nowrap', overflow: 'visible' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flex: 1 }}>
          <div className="dot" style={{ flexShrink: 0 }} />
          <div ref={tabsScrollRef} style={{ display: 'flex', gap: '3px', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', flex: 1, paddingBottom: '1px' }}>
            {symbols.map(s => (
              <button
                key={s} data-sym={s}
                onClick={() => { setSym(s); clearSearch() }}
                style={{
                  padding: '2px 7px', borderRadius: '3px', border: 'none', cursor: 'pointer',
                  fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '11px', flexShrink: 0,
                  background: !searchSym && sym === s ? 'var(--amber)' : 'var(--bg-deep)',
                  color:      !searchSym && sym === s ? '#000' : 'var(--text-2)',
                  transition: 'all 0.12s',
                }}
              >{s}</button>
            ))}
          </div>
        </div>

        {/* Professional search box */}
        <div ref={searchBoxRef} style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 0,
            background: 'var(--bg-deep)',
            border: `1px solid ${searchOpen || searchSym ? 'var(--teal)' : 'var(--border)'}`,
            borderRadius: '4px', overflow: 'visible', transition: 'border-color 0.15s',
          }}>
            <span style={{ padding: '0 4px 0 7px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', pointerEvents: 'none', userSelect: 'none' }}><SearchIcon size={13} /></span>
            <input
              value={searchInput}
              onChange={e => handleSearchInput(e.target.value.toUpperCase())}
              onKeyDown={handleSearchKey}
              onFocus={() => searchResults.length > 0 && setSearchOpen(true)}
              placeholder="Symbol search…"
              style={{
                width: '138px', background: 'transparent', border: 'none', outline: 'none',
                padding: '4px 2px', color: '#fff', fontSize: '11px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            />
            {(searchInput || searchSym) && (
              <button onClick={clearSearch} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 7px', display: 'inline-flex', alignItems: 'center' }}><XIcon size={13} /></button>
            )}
          </div>

          {/* Autocomplete dropdown */}
          {searchOpen && searchResults.length > 0 && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 1000,
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: '5px', width: '290px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.7)', overflow: 'hidden',
            }}>
              <div style={{ padding: '4px 10px 3px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', borderBottom: '1px solid var(--border)' }}>
                RESULTS — click or ↑↓ Enter to select
              </div>
              {searchResults.map((r, i) => (
                <div
                  key={r.symbol}
                  onMouseDown={() => selectResult(r)}
                  onMouseEnter={() => setSearchFocIdx(i)}
                  style={{
                    padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                    background: i === searchFocIdx ? 'rgba(240,165,0,0.1)' : 'transparent',
                    borderBottom: i < searchResults.length - 1 ? '1px solid rgba(30,45,61,0.5)' : 'none',
                    transition: 'background 0.08s',
                  }}
                >
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: i === searchFocIdx ? 'var(--amber)' : '#fff', minWidth: '64px', flexShrink: 0 }}>{r.symbol}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-deep)', padding: '2px 7px', borderRadius: '2px', border: '1px solid var(--border)', flexShrink: 0, fontFamily: 'JetBrains Mono, monospace' }}>{r.exchange || r.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Chart type + Indicators ──────────────────────────────────── */}
      <div style={{
        padding: '3px 10px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap',
        background: 'rgba(0,0,0,0.18)',
      }}>
        {/* Chart-type dropdown */}
        <div ref={typeDropRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setTypeOpen(v => !v)} title="Chart type" style={ddBtn(typeOpen, 'var(--amber)')}>
            {(() => { const I = CHART_TYPE_META[chartType].Icon; return <I size={15} /> })()}
            <span>{chartType}</span>
            <ChevronDown size={12} style={{ opacity: 0.6 }} />
          </button>
          {typeOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000, width: 196, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 12px 40px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
              <div style={{ padding: '5px 10px 3px', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid var(--border)' }}>CHART TYPE</div>
              {CHART_TYPES.map(ct => {
                const I = CHART_TYPE_META[ct].Icon
                return (
                  <div key={ct} onMouseDown={() => { setChartType(ct); setTypeOpen(false) }} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '6px 10px', cursor: 'pointer', background: chartType === ct ? 'rgba(240,165,0,0.08)' : 'transparent' }}>
                    <span style={{ width: 18, display: 'flex', justifyContent: 'center', color: chartType === ct ? 'var(--amber)' : 'var(--text-2)' }}><I size={15} /></span>
                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: chartType === ct ? '#fff' : 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{ct}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{CHART_TYPE_META[ct].hint}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ width: '1px', height: '16px', background: 'var(--border)', margin: '0 4px', flexShrink: 0 }} />

        {/* Indicators dropdown */}
        <div ref={indDropRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setIndOpen(v => !v)}
            style={{
              padding: '2px 9px', borderRadius: '3px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
              border: `1px solid ${indOpen || activeInds.size > 0 ? 'var(--teal)' : 'var(--border)'}`,
              background: indOpen ? 'rgba(0,229,192,0.1)' : activeInds.size > 0 ? 'rgba(0,229,192,0.06)' : 'transparent',
              color: indOpen || activeInds.size > 0 ? 'var(--teal)' : 'var(--text-2)',
              transition: 'all 0.12s',
            }}
          >
            <SlidersHorizontal size={13} />
            INDICATORS
            {activeInds.size > 0 && (
              <span style={{ background: 'var(--teal)', color: '#000', borderRadius: '8px', padding: '0 5px', fontSize: '10px', fontWeight: 700, lineHeight: '14px' }}>{activeInds.size}</span>
            )}
            <ChevronDown size={12} style={{ opacity: 0.7 }} />
          </button>

          {indOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000,
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: '5px', width: '200px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.7)', overflow: 'hidden',
            }}>
              <div style={{ padding: '5px 10px 3px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', borderBottom: '1px solid var(--border)' }}>OVERLAYS</div>
              {INDICATORS.filter(i => i.group === 'overlay').map(ind => (
                <div
                  key={ind.id}
                  onMouseDown={() => toggleInd(ind.id)}
                  style={{
                    padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                    background: activeInds.has(ind.id) ? 'rgba(0,229,192,0.06)' : 'transparent',
                    transition: 'background 0.08s',
                  }}
                >
                  <div style={{
                    width: '12px', height: '12px', borderRadius: '2px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${activeInds.has(ind.id) ? 'var(--teal)' : 'var(--border)'}`,
                    background: activeInds.has(ind.id) ? 'var(--teal)' : 'transparent',
                  }}>
                    {activeInds.has(ind.id) && <span style={{ color: '#000', fontSize: '10px', lineHeight: 1, fontWeight: 900 }}>✓</span>}
                  </div>
                  <div style={{ width: '12px', height: '2px', borderRadius: '1px', background: ind.color, flexShrink: 0, opacity: 0.8 }} />
                  <span style={{ fontSize: '11px', color: activeInds.has(ind.id) ? '#fff' : 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{ind.label}</span>
                </div>
              ))}
              <div style={{ padding: '5px 10px 3px', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>OSCILLATORS</div>
              {INDICATORS.filter(i => i.group === 'oscillator').map(ind => (
                <div
                  key={ind.id}
                  onMouseDown={() => toggleInd(ind.id)}
                  style={{
                    padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                    background: activeInds.has(ind.id) ? 'rgba(0,229,192,0.06)' : 'transparent',
                    transition: 'background 0.08s',
                  }}
                >
                  <div style={{
                    width: '12px', height: '12px', borderRadius: '2px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${activeInds.has(ind.id) ? 'var(--teal)' : 'var(--border)'}`,
                    background: activeInds.has(ind.id) ? 'var(--teal)' : 'transparent',
                  }}>
                    {activeInds.has(ind.id) && <span style={{ color: '#000', fontSize: '10px', lineHeight: 1, fontWeight: 900 }}>✓</span>}
                  </div>
                  <div style={{ width: '12px', height: '2px', borderRadius: '1px', background: ind.color, flexShrink: 0, opacity: 0.8 }} />
                  <span style={{ fontSize: '11px', color: activeInds.has(ind.id) ? '#fff' : 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{ind.label}</span>
                </div>
              ))}
              {activeInds.size > 0 && (
                <div
                  onMouseDown={() => setActiveInds(new Set())}
                  style={{ padding: '5px 10px', cursor: 'pointer', borderTop: '1px solid var(--border)', fontSize: '10px', color: 'var(--negative)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', transition: 'background 0.08s' }}
                >
                  Clear all
                </div>
              )}
            </div>
          )}
        </div>

        {/* Compare symbols */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setCompareOpen(v => !v)} title="Compare symbols (% normalized)" style={miniBtn(compareSyms.length > 0 || compareOpen)}>
            <GitCompareArrows size={13} /><span>COMPARE{compareSyms.length > 0 ? ` ${compareSyms.length}` : ''}</span>
          </button>
          {compareOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000, width: 200, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 5, boxShadow: '0 12px 40px rgba(0,0,0,0.7)', padding: 8 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <input value={compareInput} onChange={e => setCompareInput(e.target.value.toUpperCase())} onKeyDown={e => e.key === 'Enter' && addCompare()} placeholder="e.g. MSFT" style={{ flex: 1, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 3, color: '#fff', fontSize: 11, padding: '3px 6px', fontFamily: 'JetBrains Mono, monospace', outline: 'none' }} />
                <button onClick={addCompare} disabled={compareSyms.length >= 3} style={{ ...miniBtn(false), opacity: compareSyms.length >= 3 ? 0.5 : 1 }}>Add</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                {compareSyms.map((s, i) => (
                  <span key={s} style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace', padding: '1px 6px', borderRadius: 3, color: COMPARE_COLORS[i % 3], border: `1px solid ${COMPARE_COLORS[i % 3]}55`, cursor: 'pointer' }} onClick={() => removeCompare(s)}>{s} ×</span>
                ))}
                {compareSyms.length === 0 && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>Up to 3 · rebased to 0% at start</span>}
              </div>
            </div>
          )}
        </div>

        {/* Templates */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setTplOpen(v => !v)} title="Saved chart layouts" style={miniBtn(tplOpen)}>
            <Layers size={13} /><span>LAYOUTS</span>
          </button>
          {tplOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000, width: 180, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 5, boxShadow: '0 12px 40px rgba(0,0,0,0.7)', overflow: 'hidden' }}>
              <div onMouseDown={saveTemplate} style={{ padding: '6px 10px', fontSize: 10, color: 'var(--teal)', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px solid var(--border)' }}>＋ Save current layout</div>
              {templates.length === 0 && <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>No saved layouts</div>}
              {templates.map(t => (
                <div key={t.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
                  <span onMouseDown={() => applyTemplate(t)} style={{ color: 'var(--text-2)', cursor: 'pointer', flex: 1 }}>{t.name} · {t.tf} · {t.chartType}</span>
                  <span onMouseDown={() => deleteTemplate(t.name)} style={{ color: 'var(--negative)', cursor: 'pointer', paddingLeft: 6 }}>×</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active indicator chips */}
        {activeInds.size > 0 && (
          <div style={{ display: 'flex', gap: '3px', flex: 1, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: '1px' }}>
            {[...activeInds].map(id => {
              const ind = INDICATORS.find(i => i.id === id)
              if (!ind) return null
              return (
                <button
                  key={id} onClick={() => toggleInd(id)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                    padding: '2px 7px', borderRadius: '3px', fontSize: '11px', flexShrink: 0,
                    fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', whiteSpace: 'nowrap',
                    background: ind.group === 'oscillator' ? 'rgba(240,165,0,0.1)' : 'rgba(0,229,192,0.08)',
                    border: `1px solid ${ind.group === 'oscillator' ? 'rgba(240,165,0,0.3)' : 'rgba(0,229,192,0.25)'}`,
                    color: ind.group === 'oscillator' ? 'var(--amber)' : 'var(--teal)',
                  }}
                >{ind.label} ×</button>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Row 3: Interval picker + display tools ───────────────────────────── */}
      <div style={{
        padding: '4px 10px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '6px',
        background: 'rgba(0,0,0,0.12)',
      }}>
        {/* Interval / timeframe dropdown */}
        <div ref={intervalDropRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setIntervalOpen(v => !v)} title="Timeframe / interval" style={ddBtn(intervalOpen)}>
            <Clock size={13} />
            <span>{tf}</span>
            <ChevronDown size={12} style={{ opacity: 0.6 }} />
          </button>
          {intervalOpen && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000, width: 168, background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 12px 40px rgba(0,0,0,0.7)', overflow: 'hidden', paddingBottom: 4 }}>
              {TF_GROUPS.map(g => (
                <div key={g.label}>
                  <div style={{ padding: '6px 10px 3px', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', fontFamily: 'JetBrains Mono, monospace' }}>{g.label.toUpperCase()}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 8px' }}>
                    {g.items.map(t => (
                      <button key={t} onMouseDown={() => { setTf(t); setIntervalOpen(false) }} style={{ ...miniBtn(tf === t), minWidth: 36 }}>{t}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap', flexShrink: 0 }}>{TF_CFG[tf].label}</span>
        {chartType === 'P&F' && (
          <span style={{ fontSize: 10, color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace', border: '1px solid rgba(240,165,0,0.3)', padding: '2px 8px', borderRadius: 3, background: 'rgba(240,165,0,0.08)', flexShrink: 0 }}>X up · O down · 3-box</span>
        )}

        {/* right-aligned display tools */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {chartType !== 'P&F' && (
            <>
              <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', height: 24 }} title="Price-axis scale">
                {(['normal', 'log', 'pct'] as const).map((m, i) => (
                  <button key={m} onClick={() => applyScale(m)} title={m === 'normal' ? 'Linear scale' : m === 'log' ? 'Logarithmic scale' : 'Percent scale'} style={{
                    padding: '0 9px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, height: '100%',
                    border: 'none', borderLeft: i ? '1px solid var(--border)' : 'none',
                    background: scaleMode === m ? 'rgba(0,229,192,0.16)' : 'transparent',
                    color: scaleMode === m ? 'var(--teal)' : 'var(--text-2)',
                  }}>{m === 'normal' ? 'Lin' : m === 'log' ? 'Log' : '%'}</button>
                ))}
              </div>
              <button onClick={resetView} title="Reset view / auto-scale" style={miniBtn(false)}><RotateCcw size={14} /></button>
              <button onClick={screenshot} title="Save chart image (S)" style={miniBtn(false)}><Camera size={14} /></button>
            </>
          )}
          <button onClick={toggleMaximize} title={maximized ? 'Exit full-screen chart (Esc)' : 'Full-screen chart (F)'} style={miniBtn(maximized)}>{maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>

          {/* ANALYSIS — click opens the panel, hover previews what's on the chart */}
          <div style={{ position: 'relative' }} onMouseEnter={() => setAnalysisHover(true)} onMouseLeave={() => setAnalysisHover(false)}>
            <button onClick={() => setAnalysisOpen(o => !o)} title="Pattern recognition & technical analysis" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 26, padding: '0 12px', borderRadius: 4, cursor: 'pointer', flexShrink: 0,
              fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 11, letterSpacing: '0.04em',
              border: `1px solid ${analysisOpen || analysisHover ? 'var(--teal)' : 'var(--border)'}`,
              background: analysisOpen ? 'rgba(0,229,192,0.16)' : 'rgba(0,229,192,0.04)',
              color: analysisOpen || analysisHover ? 'var(--teal)' : '#dfe8f0', transition: 'all 0.12s',
            }}>
              <Activity size={14} /> ANALYSIS
              {analysis && (analysis.geometric.length + analysis.candlestick.length) > 0 && (
                <span style={{ background: 'var(--teal)', color: '#000', borderRadius: 8, padding: '0 5px', fontSize: 9, fontWeight: 800, lineHeight: '14px' }}>{analysis.geometric.length + analysis.candlestick.length}</span>
              )}
              <ChevronDown size={12} style={{ opacity: 0.6 }} />
            </button>
            {analysisHover && analysis && (() => {
              const rd = RATING_DISPLAY[analysis.rating.overall.label] ?? RATING_DISPLAY.neutral
              const pats = [...analysis.geometric, ...analysis.candlestick].sort((a, b) => b.confidence - a.confidence)
              const setVis = (v: PatternVisibility) => { setPatternVis(v); visRef.current = v; try { seriesR.current.candle?.setMarkers(buildCandleMarkers(analysis.candlestick, v)) } catch {}; redrawOverlay() }
              return (
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 1001, width: 248, background: 'var(--bg-panel)', border: '1px solid var(--teal)', borderRadius: 6, boxShadow: '0 14px 44px rgba(0,0,0,0.75)', padding: 11 }}>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.12em', fontFamily: 'JetBrains Mono, monospace', marginBottom: 8 }}>WHAT&apos;S ON THIS CHART</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Technical rating</span>
                    <span style={{ fontSize: 11, fontWeight: 800, fontFamily: 'Syne, sans-serif', color: rd.color }}>{rd.text}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 9 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>Structure</span>
                    <span style={{ fontSize: 10, color: analysis.structure.bias === 'uptrend' ? '#00c97a' : analysis.structure.bias === 'downtrend' ? '#ff4560' : '#a0a0a0', fontFamily: 'JetBrains Mono, monospace', textTransform: 'capitalize' }}>{analysis.structure.bias}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace', marginBottom: 5 }}>{pats.length} pattern{pats.length === 1 ? '' : 's'} detected</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                    {pats.slice(0, 4).map((d, i) => (
                      <span key={i} style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', padding: '1px 6px', borderRadius: 3, color: d.direction === 'bullish' ? '#00c97a' : d.direction === 'bearish' ? '#ff4560' : '#f0a500', border: `1px solid ${(d.direction === 'bullish' ? '#00c97a' : d.direction === 'bearish' ? '#ff4560' : '#f0a500')}55` }}>{d.name} {d.confidence}</span>
                    ))}
                    {pats.length === 0 && <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>None on this timeframe</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginRight: 'auto' }}>OVERLAY</span>
                    {(['all', 'confirmed', 'off'] as PatternVisibility[]).map(v => (
                      <button key={v} onClick={() => setVis(v)} style={{ ...miniBtn(patternVis === v), height: 20, minWidth: 0, fontSize: 9, textTransform: 'capitalize' }}>{v}</button>
                    ))}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 9, fontFamily: 'JetBrains Mono, monospace' }}>Click for the full analysis panel →</div>
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* ── Quote strip ──────────────────────────────────────────────────────── */}
      {quote && (
        <div style={{
          padding: '4px 12px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap',
          background: 'rgba(0,0,0,0.22)',
        }}>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '20px', color: '#fff', letterSpacing: '-0.02em' }}>
            {quote.c?.toFixed(2)}
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: isUp ? 'var(--positive)' : 'var(--negative)' }}>
            {isUp ? '+' : ''}{quote.d?.toFixed(2)}&nbsp;({isUp ? '+' : ''}{quote.dp?.toFixed(2)}%)
          </span>
          <span style={{ fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{effectiveSym}</span>
          {chartType !== 'Candle' && (
            <span style={{ fontSize: '11px', color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace', padding: '2px 7px', borderRadius: '2px', border: '1px solid rgba(240,165,0,0.3)', background: 'rgba(240,165,0,0.08)' }}>
              {chartType.toUpperCase()}
            </span>
          )}
          {(hasRsi || hasMacd) && (
            <span style={{ fontSize: '11px', color: 'var(--teal)', fontFamily: 'JetBrains Mono, monospace', marginLeft: '2px' }}>
              {[hasRsi && 'RSI', hasMacd && 'MACD'].filter(Boolean).join(' · ')}
            </span>
          )}
          <button onClick={addAlert} title="Set a price alert (fires while this tab is open)" style={{ ...miniBtn(false), marginLeft: 'auto', width: 'auto', padding: '0 9px' }}><Bell size={13} /> Alert</button>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>scroll=zoom · drag=pan</span>
        </div>
      )}

      {/* ── Chart area + ANALYSIS drawer ─────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
       <div ref={chartAreaRef} tabIndex={0} onKeyDown={onChartKey} style={{ flex: 1, position: 'relative', minHeight: 0, outline: 'none' }}>
        {/* geometric pattern overlay (synced canvas) */}
        <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, zIndex: 6, pointerEvents: 'none', width: '100%', height: '100%', display: chartType === 'P&F' ? 'none' : 'block' }} />
        {/* interactive drawing tools */}
        {ready && chartType !== 'P&F' && (
          <DrawingLayer chart={chartR.current} series={seriesR.current.candle} symbol={effectiveSym} ready={ready} />
        )}
        {/* alert toast */}
        {alertToast && (
          <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 12, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(9,12,16,0.94)', border: '1px solid var(--teal)', borderRadius: 5, padding: '6px 12px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--teal)', boxShadow: '0 8px 30px rgba(0,0,0,0.6)', maxWidth: '90%' }}>
            <Bell size={13} /> {alertToast}
          </div>
        )}
        {loading && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(9,12,16,0.78)' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
              LOADING {effectiveSym}…
            </span>
          </div>
        )}

        {/* OHLCV tooltip */}
        <div ref={tooltipRef} style={{
          position: 'absolute', top: '6px', left: '8px', zIndex: 8,
          fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
          opacity: 0, pointerEvents: 'none',
          background: 'rgba(9,12,16,0.88)', padding: '3px 10px',
          borderRadius: '3px', border: '1px solid var(--border)',
          transition: 'opacity 0.06s',
        }} />

        {/* Volume separator */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: `${hasRsi && hasMacd ? 58 : hasRsi || hasMacd ? 72 : 85}%`, height: '1px', background: '#1c1f25', zIndex: 5, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: '8px', top: `${hasRsi && hasMacd ? 58 : hasRsi || hasMacd ? 72 : 85}%`, zIndex: 6, fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none', marginTop: '2px' }}>VOL</div>

        {/* RSI separator */}
        {hasRsi && (
          <>
            <div style={{ position: 'absolute', left: 0, right: 0, top: `${hasMacd ? 73 : 84}%`, height: '1px', background: '#1c1f25', zIndex: 5, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: '8px', top: `${hasMacd ? 73 : 84}%`, zIndex: 6, fontSize: '11px', color: '#f0a50077', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none', marginTop: '2px' }}>RSI 14</div>
          </>
        )}

        {/* MACD separator */}
        {hasMacd && (
          <>
            <div style={{ position: 'absolute', left: 0, right: 0, top: '87%', height: '1px', background: '#1c1f25', zIndex: 5, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: '8px', top: '87%', zIndex: 6, fontSize: '11px', color: '#1e90ff77', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none', marginTop: '2px' }}>MACD</div>
          </>
        )}

        {/* P&F canvas */}
        {chartType === 'P&F' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 7, overflowX: 'auto', overflowY: 'auto', background: '#000000' }}>
            {pfData.length > 0
              ? <canvas ref={pfCanvasRef} style={{ display: 'block', cursor: 'crosshair' }} />
              : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
                  {loading ? 'Computing P&F…' : 'Not enough price swings for P&F'}
                </div>
            }
          </div>
        )}

        {/* LWC canvas */}
        <div ref={containerRef} style={{ width: '100%', height: '100%', display: chartType === 'P&F' ? 'none' : 'block' }} />
       </div>

       {analysisOpen && analysis && (
         <AnalysisDrawer
           result={analysis}
           symbol={effectiveSym}
           tf={tf}
           visibility={patternVis}
           onVisibility={(v) => {
             setPatternVis(v); visRef.current = v
             try { seriesR.current.candle?.setMarkers(buildCandleMarkers(analysis.candlestick, v)) } catch {}
             redrawOverlay()
           }}
           selectedId={selectedPattern}
           onSelectPattern={focusPatternOnChart}
           perTfRatings={perTfRatings}
           onLoadTf={loadTfRating}
           activeRatingTf={activeRatingTf}
           aiNote={aiNote}
           aiLoading={aiLoading}
           aiError={aiError}
           onGenerateAi={generateAi}
           onClose={() => setAnalysisOpen(false)}
         />
       )}
      </div>
    </div>
  )
}
