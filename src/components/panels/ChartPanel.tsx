'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

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
  ctx.fillStyle = '#090c10'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = '#1e2d3d55'; ctx.lineWidth = 0.5
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

const TFS = ['1D', '5D', '1M', '1Y'] as const
type TF = typeof TFS[number]
const TF_CFG: Record<TF, { range: string; interval: string; label: string }> = {
  '1D': { range: '5d',  interval: '15m', label: '15m · 5d'  },
  '5D': { range: '1mo', interval: '1h',  label: '1h · 1mo'  },
  '1M': { range: '3mo', interval: '1d',  label: '1D · 3mo'  },
  '1Y': { range: '3y',  interval: '1wk', label: '1W · 3y'   },
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

  // ── Symbol sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (symbols.length > 0 && !symbols.includes(sym)) setSym(symbols[0])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(',')])

  // ── Click-outside closes dropdowns ────────────────────────────────────────
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setSearchOpen(false)
      if (indDropRef.current   && !indDropRef.current.contains(e.target as Node))   setIndOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
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

  // ── Chart initialization ───────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    let dead = false
    ;(async () => {
      try {
        const LWC = await import('lightweight-charts')
        if (dead || !containerRef.current) return

        const chart = LWC.createChart(containerRef.current, {
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
          layout: { background: { color: 'transparent' }, textColor: '#7a9ab0', fontSize: 10 },
          grid: { vertLines: { color: '#1e2d3d44', style: 1 }, horzLines: { color: '#1e2d3d44', style: 1 } },
          crosshair: {
            mode: 1,
            vertLine: { color: '#f0a50066', width: 1, style: 0, labelBackgroundColor: '#f0a500' },
            horzLine: { color: '#f0a50066', width: 1, style: 0, labelBackgroundColor: '#1e2d3d' },
          },
          rightPriceScale: { borderColor: '#1e2d3d', textColor: '#7a9ab0' },
          timeScale: { borderColor: '#1e2d3d', timeVisible: true, secondsVisible: false, rightOffset: 10 },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true } },
        })

        const shared = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }

        // Main series — all types pre-created, active one gets data
        const candle = chart.addCandlestickSeries({
          priceScaleId: 'right',
          upColor: '#00c97a', downColor: '#ff4560',
          borderUpColor: '#00c97a', borderDownColor: '#ff4560',
          wickUpColor: '#00c97a99', wickDownColor: '#ff456099',
        })
        const bar = chart.addBarSeries({
          priceScaleId: 'right',
          upColor: '#00c97a', downColor: '#ff4560',
          ...shared,
        })
        const line = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#00e5c0', lineWidth: 2 })
        const area = chart.addAreaSeries({
          priceScaleId: 'right',
          lineColor: '#00e5c0', topColor: 'rgba(0,229,192,0.22)', bottomColor: 'rgba(0,229,192,0.02)',
          lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: true,
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
        chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.99, bottom: 0.005 }, borderColor: '#1e2d3d', textColor: '#7a9ab0' })

        // MACD pane
        const macdLine   = chart.addLineSeries({ priceScaleId: 'macd', color: '#1e90ff', lineWidth: 2, lastValueVisible: true, priceLineVisible: false, crosshairMarkerVisible: false })
        const macdSignal = chart.addLineSeries({ ...shared, priceScaleId: 'macd', color: '#ff9f43', lineWidth: 1, lineStyle: 2 })
        const macdHist   = chart.addHistogramSeries({ priceScaleId: 'macd', color: 'rgba(0,201,122,0.6)', lastValueVisible: false, priceLineVisible: false })
        chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.99, bottom: 0.005 }, borderColor: '#1e2d3d', textColor: '#7a9ab0' })

        seriesR.current = {
          candle, bar, line, area, volume,
          sma20, sma50, sma200, ema9, ema21, vwap,
          bbUpper, bbMid, bbLower,
          donchUp, donchDn, donchMid,
          ichiTenkan, ichiKijun, ichiChikou,
          rsiLine, macdLine, macdSignal, macdHist,
        }

        // Resize observer
        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartR.current)
            chartR.current.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight })
        })
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
    try {
      const cfg = TF_CFG[timeframe]
      const r = await fetch(`/api/yfinance?symbols=${encodeURIComponent(s)}&range=${cfg.range}&interval=${cfg.interval}`)
      const j = await r.json()
      const res = j?.results?.[0]?.data?.chart?.result?.[0]
      if (!res) return []
      const ts = res.timestamp ?? [], q = res.indicators?.quote?.[0]
      if (!q) return []
      return (ts as number[])
        .map((time, i) => ({ time, open: q.open?.[i]??null, high: q.high?.[i]??null, low: q.low?.[i]??null, close: q.close?.[i]??null, volume: q.volume?.[i]??0 }))
        .filter((c): c is Candle => c.open!==null && c.high!==null && c.low!==null && c.close!==null)
        .sort((a, b) => a.time - b.time)
    } catch { return [] }
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
    Promise.all([getCandles(effectiveSym, tf), getQuote(effectiveSym)]).then(([candles]) => {
      if (cancelled) return
      if (candles.length > 0) {
        dataRef.current = candles
        applyAll(candles, activeInds)
        updatePaneLayout(activeInds)
        if (chartType !== 'P&F') chartR.current?.timeScale().scrollToRealTime()
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
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

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
            <span style={{ padding: '0 5px 0 7px', color: 'var(--text-muted)', fontSize: '10px', pointerEvents: 'none', userSelect: 'none' }}>⌕</span>
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
              <button onClick={clearSearch} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0 8px', fontSize: '13px', lineHeight: 1 }}>×</button>
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
              <div style={{ padding: '4px 10px 3px', fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', borderBottom: '1px solid var(--border)' }}>
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
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: i === searchFocIdx ? 'var(--amber)' : '#fff', minWidth: '64px', flexShrink: 0 }}>{r.symbol}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span style={{ fontSize: '8px', color: 'var(--text-muted)', background: 'var(--bg-deep)', padding: '1px 5px', borderRadius: '2px', border: '1px solid var(--border)', flexShrink: 0, fontFamily: 'JetBrains Mono, monospace' }}>{r.exchange || r.type}</span>
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
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', flexShrink: 0 }}>TYPE</span>
        {CHART_TYPES.map(ct => (
          <button key={ct} onClick={() => setChartType(ct)} style={{
            padding: '2px 7px', borderRadius: '3px', cursor: 'pointer', flexShrink: 0,
            fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
            border: `1px solid ${chartType === ct ? 'var(--amber)' : 'var(--border)'}`,
            background: chartType === ct ? 'rgba(240,165,0,0.1)' : 'transparent',
            color: chartType === ct ? 'var(--amber)' : 'var(--text-2)',
            transition: 'all 0.12s',
          }}>{ct}</button>
        ))}

        <div style={{ width: '1px', height: '14px', background: 'var(--border)', margin: '0 3px', flexShrink: 0 }} />

        {/* Indicators dropdown */}
        <div ref={indDropRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setIndOpen(v => !v)}
            style={{
              padding: '2px 9px', borderRadius: '3px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
              border: `1px solid ${indOpen || activeInds.size > 0 ? 'var(--teal)' : 'var(--border)'}`,
              background: indOpen ? 'rgba(0,229,192,0.1)' : activeInds.size > 0 ? 'rgba(0,229,192,0.06)' : 'transparent',
              color: indOpen || activeInds.size > 0 ? 'var(--teal)' : 'var(--text-2)',
              transition: 'all 0.12s',
            }}
          >
            INDICATORS
            {activeInds.size > 0 && (
              <span style={{ background: 'var(--teal)', color: '#000', borderRadius: '8px', padding: '0 5px', fontSize: '8px', fontWeight: 700, lineHeight: '14px' }}>{activeInds.size}</span>
            )}
            <span style={{ fontSize: '7px', opacity: 0.7 }}>▾</span>
          </button>

          {indOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 1000,
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: '5px', width: '200px',
              boxShadow: '0 12px 40px rgba(0,0,0,0.7)', overflow: 'hidden',
            }}>
              <div style={{ padding: '5px 10px 3px', fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', borderBottom: '1px solid var(--border)' }}>OVERLAYS</div>
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
                    {activeInds.has(ind.id) && <span style={{ color: '#000', fontSize: '8px', lineHeight: 1, fontWeight: 900 }}>✓</span>}
                  </div>
                  <div style={{ width: '12px', height: '2px', borderRadius: '1px', background: ind.color, flexShrink: 0, opacity: 0.8 }} />
                  <span style={{ fontSize: '11px', color: activeInds.has(ind.id) ? '#fff' : 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>{ind.label}</span>
                </div>
              ))}
              <div style={{ padding: '5px 10px 3px', fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>OSCILLATORS</div>
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
                    {activeInds.has(ind.id) && <span style={{ color: '#000', fontSize: '8px', lineHeight: 1, fontWeight: 900 }}>✓</span>}
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
                    padding: '1px 5px', borderRadius: '3px', fontSize: '9px', flexShrink: 0,
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

      {/* ── Row 3: Timeframe ─────────────────────────────────────────────────── */}
      <div style={{
        padding: '3px 10px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '4px',
        background: 'rgba(0,0,0,0.12)',
      }}>
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', flexShrink: 0 }}>TF</span>
        {TFS.map(t => (
          <button key={t} onClick={() => setTf(t)} style={{
            padding: '2px 7px', borderRadius: '3px', cursor: 'pointer', flexShrink: 0,
            fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
            border: `1px solid ${tf === t ? 'var(--teal)' : 'var(--border)'}`,
            background: tf === t ? 'rgba(0,229,192,0.1)' : 'transparent',
            color: tf === t ? 'var(--teal)' : 'var(--text-2)',
            transition: 'all 0.12s',
          }}>{t}</button>
        ))}
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: '5px' }}>
          · {TF_CFG[tf].label}
        </span>
        {chartType === 'P&F' && (
          <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace', border: '1px solid rgba(240,165,0,0.3)', padding: '1px 6px', borderRadius: '2px', background: 'rgba(240,165,0,0.08)', flexShrink: 0 }}>
            X = up · O = down · 3-box reversal
          </span>
        )}
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
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: isUp ? 'var(--positive)' : 'var(--negative)' }}>
            {isUp ? '+' : ''}{quote.d?.toFixed(2)}&nbsp;({isUp ? '+' : ''}{quote.dp?.toFixed(2)}%)
          </span>
          <span style={{ fontSize: '10px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>{effectiveSym}</span>
          {chartType !== 'Candle' && (
            <span style={{ fontSize: '9px', color: 'var(--amber)', fontFamily: 'JetBrains Mono, monospace', padding: '1px 5px', borderRadius: '2px', border: '1px solid rgba(240,165,0,0.3)', background: 'rgba(240,165,0,0.08)' }}>
              {chartType.toUpperCase()}
            </span>
          )}
          {(hasRsi || hasMacd) && (
            <span style={{ fontSize: '9px', color: 'var(--teal)', fontFamily: 'JetBrains Mono, monospace', marginLeft: '2px' }}>
              {[hasRsi && 'RSI', hasMacd && 'MACD'].filter(Boolean).join(' · ')}
            </span>
          )}
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>scroll=zoom · drag=pan</span>
        </div>
      )}

      {/* ── Chart area ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
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
        <div style={{ position: 'absolute', left: 0, right: 0, top: `${hasRsi && hasMacd ? 58 : hasRsi || hasMacd ? 72 : 85}%`, height: '1px', background: '#1e2d3d', zIndex: 5, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: '8px', top: `${hasRsi && hasMacd ? 58 : hasRsi || hasMacd ? 72 : 85}%`, zIndex: 6, fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none', marginTop: '2px' }}>VOL</div>

        {/* RSI separator */}
        {hasRsi && (
          <>
            <div style={{ position: 'absolute', left: 0, right: 0, top: `${hasMacd ? 73 : 84}%`, height: '1px', background: '#1e2d3d', zIndex: 5, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: '8px', top: `${hasMacd ? 73 : 84}%`, zIndex: 6, fontSize: '9px', color: '#f0a50077', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none', marginTop: '2px' }}>RSI 14</div>
          </>
        )}

        {/* MACD separator */}
        {hasMacd && (
          <>
            <div style={{ position: 'absolute', left: 0, right: 0, top: '87%', height: '1px', background: '#1e2d3d', zIndex: 5, pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: '8px', top: '87%', zIndex: 6, fontSize: '9px', color: '#1e90ff77', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none', marginTop: '2px' }}>MACD</div>
          </>
        )}

        {/* P&F canvas */}
        {chartType === 'P&F' && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 7, overflowX: 'auto', overflowY: 'auto', background: '#090c10' }}>
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
    </div>
  )
}
