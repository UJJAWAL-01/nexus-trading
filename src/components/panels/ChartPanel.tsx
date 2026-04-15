'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

// ─────────────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────────────

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

function emaArr(vals: number[], p: number): number[] {
  if (vals.length < p) return []
  const k = 2 / (p + 1)
  const out = [vals.slice(0, p).reduce((a, b) => a + b, 0) / p]
  for (let i = p; i < vals.length; i++) out.push(vals[i] * k + out[out.length - 1] * (1 - k))
  return out
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

// ── Heikin Ashi transformation ─────────────────────────────────────────────
function toHeikinAshi(candles: Candle[]): Candle[] {
  const ha: Candle[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const haClose = (c.open + c.high + c.low + c.close) / 4
    const haOpen  = i === 0
      ? (c.open + c.close) / 2
      : (ha[i - 1].open + ha[i - 1].close) / 2
    const haHigh  = Math.max(c.high, haOpen, haClose)
    const haLow   = Math.min(c.low,  haOpen, haClose)
    ha.push({ time: c.time, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: c.volume })
  }
  return ha
}

// ── Point & Figure computation ──────────────────────────────────────────────
interface PnFColumn { direction: 'X' | 'O'; boxes: number[]; startTime: number; endTime: number }

function computePnF(candles: Candle[], boxPct = 0.01, reversal = 3): PnFColumn[] {
  if (candles.length < 10) return []
  const firstClose = candles[0].close
  const boxSize    = Math.max(0.01, firstClose * boxPct)

  const roundBox = (price: number, dir: 'up' | 'down') =>
    dir === 'up' ? Math.ceil(price / boxSize) * boxSize : Math.floor(price / boxSize) * boxSize

  const columns: PnFColumn[] = []
  let direction: 'X' | 'O' = 'X'
  let topBox    = roundBox(firstClose, 'up')
  let bottomBox = topBox
  let colStart  = candles[0].time
  let colEnd    = candles[0].time
  let currentBoxes: number[] = [topBox]

  const flushCol = () => {
    columns.push({ direction, boxes: [...currentBoxes], startTime: colStart, endTime: colEnd })
  }

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]
    colEnd   = c.time

    if (direction === 'X') {
      const newTop = roundBox(c.close, 'up')
      if (newTop >= topBox + boxSize) {
        // Continue X column upward
        while (topBox + boxSize <= newTop) {
          topBox += boxSize
          currentBoxes.push(topBox)
        }
        bottomBox = currentBoxes[0]
      } else if (c.close <= topBox - reversal * boxSize) {
        // Reverse to O column
        flushCol()
        const newBottom = roundBox(c.close, 'down')
        direction    = 'O'
        bottomBox    = newBottom
        colStart     = c.time
        currentBoxes = []
        let b        = topBox - boxSize
        while (b >= newBottom) { currentBoxes.push(b); b -= boxSize }
        topBox = currentBoxes[0] ?? bottomBox
      }
    } else {
      // direction === 'O'
      const newBottom = roundBox(c.close, 'down')
      if (newBottom <= bottomBox - boxSize) {
        // Continue O column downward
        while (bottomBox - boxSize >= newBottom) {
          bottomBox -= boxSize
          currentBoxes.push(bottomBox)
        }
        topBox = currentBoxes[0]
      } else if (c.close >= bottomBox + reversal * boxSize) {
        // Reverse to X column
        flushCol()
        const newTop = roundBox(c.close, 'up')
        direction    = 'X'
        topBox       = newTop
        colStart     = c.time
        currentBoxes = []
        let b        = bottomBox + boxSize
        while (b <= newTop) { currentBoxes.push(b); b += boxSize }
        bottomBox = currentBoxes[0] ?? topBox
      }
    }
  }
  if (currentBoxes.length > 0) flushCol()
  return columns
}

// ── P&F Canvas Renderer ─────────────────────────────────────────────────────
function renderPnF(canvas: HTMLCanvasElement, columns: PnFColumn[], containerH: number) {
  if (columns.length === 0) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const allPrices = columns.flatMap(c => c.boxes)
  if (allPrices.length === 0) return

  const minPrice  = Math.min(...allPrices)
  const maxPrice  = Math.max(...allPrices)
  const boxSize   = allPrices.length > 1 ? Math.abs(allPrices[1] - allPrices[0]) : 1

  const BOX_W  = 22
  const BOX_H  = Math.max(14, Math.min(24, Math.floor((containerH - 80) / ((maxPrice - minPrice) / boxSize + 2))))
  const PAD    = { l: 72, r: 12, t: 20, b: 30 }
  const numRows = Math.round((maxPrice - minPrice) / boxSize) + 3

  canvas.width  = columns.length * BOX_W + PAD.l + PAD.r
  canvas.height = numRows * BOX_H + PAD.t + PAD.b

  // Background
  ctx.fillStyle = '#090c10'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Grid lines
  ctx.strokeStyle = '#1e2d3d55'
  ctx.lineWidth   = 0.5
  for (let r = 0; r <= numRows; r++) {
    const y = PAD.t + r * BOX_H
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(canvas.width - PAD.r, y); ctx.stroke()
  }
  for (let c = 0; c <= columns.length; c++) {
    const x = PAD.l + c * BOX_W
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, canvas.height - PAD.b); ctx.stroke()
  }

  // Price labels on Y axis
  ctx.font      = '9px JetBrains Mono, monospace'
  ctx.fillStyle = '#4a6070'
  ctx.textAlign = 'right'
  const labelInterval = Math.max(1, Math.round(5 / (BOX_H / 20)))
  for (let r = 0; r <= numRows; r += labelInterval) {
    const price = maxPrice - r * boxSize + boxSize
    const y     = PAD.t + r * BOX_H + BOX_H / 2 + 3
    ctx.fillStyle = '#4a6070'
    ctx.fillText(price.toFixed(price < 10 ? 3 : price < 100 ? 2 : 0), PAD.l - 4, y)
  }

  // Draw X and O boxes
  columns.forEach((col, ci) => {
    const x0 = PAD.l + ci * BOX_W
    col.boxes.forEach(price => {
      const row = Math.round((maxPrice - price) / boxSize)
      const y0  = PAD.t + row * BOX_H

      if (col.direction === 'X') {
        // Green X
        ctx.strokeStyle = '#00c97a'
        ctx.lineWidth   = 2.5
        const pad = 3
        ctx.beginPath()
        ctx.moveTo(x0 + pad, y0 + pad)
        ctx.lineTo(x0 + BOX_W - pad, y0 + BOX_H - pad)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(x0 + BOX_W - pad, y0 + pad)
        ctx.lineTo(x0 + pad, y0 + BOX_H - pad)
        ctx.stroke()
      } else {
        // Red O
        ctx.strokeStyle = '#ff4560'
        ctx.lineWidth   = 2.5
        const pad = 3
        ctx.beginPath()
        ctx.arc(x0 + BOX_W / 2, y0 + BOX_H / 2, (BOX_W / 2) - pad, 0, Math.PI * 2)
        ctx.stroke()
      }
    })
  })

  // Column count label at bottom
  ctx.font      = '8px JetBrains Mono, monospace'
  ctx.fillStyle = '#4a6070'
  ctx.textAlign = 'center'
  columns.forEach((_, ci) => {
    const x = PAD.l + ci * BOX_W + BOX_W / 2
    ctx.fillText(String(ci + 1), x, canvas.height - PAD.b + 14)
  })

  // Legend
  ctx.font      = '10px JetBrains Mono, monospace'
  ctx.textAlign = 'left'
  ctx.fillStyle = '#00c97a'; ctx.fillText('X = Up Column', 4, 14)
  ctx.fillStyle = '#ff4560'; ctx.fillText('O = Down Column', 4, canvas.height - 10)
}

function fibLevels(candles: Candle[]) {
  const s=candles.slice(-60)
  const H=Math.max(...s.map(c=>c.high)), L=Math.min(...s.map(c=>c.low)), d=H-L
  return [
    { price:H,             label:'Fib 0%',    color:'#ffffff28' },
    { price:H-0.236*d,     label:'Fib 23.6%', color:'#00e5c070' },
    { price:H-0.382*d,     label:'Fib 38.2%', color:'#1e90ff70' },
    { price:H-0.5*d,       label:'Fib 50%',   color:'#f0a50070' },
    { price:H-0.618*d,     label:'Fib 61.8%', color:'#ff456070' },
    { price:L,             label:'Fib 100%',  color:'#ffffff28' },
  ]
}

function pivotLevels(candles: Candle[]) {
  if (candles.length < 1) return { pivot:0, r1:0, r2:0, s1:0, s2:0 }
  const last = candles[candles.length - 1]
  const H = last.high, L = last.low, C = last.close
  const P = (H + L + C) / 3
  return { pivot: P, r1: 2*P-L, r2: P+(H-L), s1: 2*P-H, s2: P-(H-L) }
}

function donchianChannels(candles: Candle[], period = 20) {
  const out: Array<{ time: number; high: number; low: number; mid: number }> = []
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1)
    const high  = Math.max(...slice.map(c => c.high))
    const low   = Math.min(...slice.map(c => c.low))
    out.push({ time: candles[i].time, high, low, mid: (high + low) / 2 })
  }
  return out
}

function ichimokuCloud(candles: Candle[]) {
  const tenkan: Array<{ time: number; value: number }> = []
  const kijun:  Array<{ time: number; value: number }> = []
  const chikou: Array<{ time: number; value: number }> = []
  for (let i = 25; i < candles.length; i++) {
    const t9  = candles.slice(Math.max(0, i-9),  i+1)
    const t26 = candles.slice(Math.max(0, i-26), i+1)
    tenkan.push({ time: candles[i].time, value: (Math.max(...t9.map(c=>c.high))  + Math.min(...t9.map(c=>c.low)))  / 2 })
    kijun.push({  time: candles[i].time, value: (Math.max(...t26.map(c=>c.high)) + Math.min(...t26.map(c=>c.low))) / 2 })
    chikou.push({ time: candles[i].time, value: candles[Math.max(0, i-26)].close })
  }
  return { tenkan, kijun, chikou }
}

// ── Constants ──────────────────────────────────────────────────────────────────
type ChartType = 'Candle' | 'Heikin Ashi' | 'P&F'
const CHART_TYPES: ChartType[] = ['Candle', 'Heikin Ashi', 'P&F']

const TFS = ['1D', '5D', '1M', '1Y'] as const
type TF = typeof TFS[number]

// ── FIXED: 1D now uses '5d' range to show previous day data too ───────────────
const TF_CFG: Record<TF, { range: string; interval: string; label: string }> = {
  '1D': { range: '5d',  interval: '15m', label: '15min — 5d' },
  '5D': { range: '1mo', interval: '1h',  label: '1h — 1mo'   },
  '1M': { range: '3mo', interval: '1d',  label: 'daily — 3mo' },
  '1Y': { range: '3y',  interval: '1wk', label: 'weekly — 3y' },
}

const PANES = { main: { top: 0.02, bottom: 0.15 }, volume: { top: 0.85, bottom: 0.10 } }

function mkBtn(active: boolean, col: 'amber' | 'purple' | 'teal' = 'amber'): React.CSSProperties {
  const C = { amber:['var(--amber)','rgba(240,165,0,0.12)'], purple:['#a78bfa','rgba(167,139,250,0.12)'], teal:['var(--teal)','rgba(0,229,192,0.12)'] }[col]
  return {
    padding:'2px 8px', borderRadius:'3px', cursor:'pointer', whiteSpace:'nowrap',
    fontFamily:'JetBrains Mono, monospace', fontSize:'10px', letterSpacing:'0.06em',
    border:`1px solid ${active?C[0]:'var(--border)'}`,
    background: active?C[1]:'transparent',
    color:       active?C[0]:'var(--text-muted)',
    transition: 'all 0.12s', flexShrink:0,
  }
}

// ── ChartPanel ─────────────────────────────────────────────────────────────────
export default function ChartPanel() {
  const { symbols: wl } = useWatchlist()
  const symbols = wl.length > 0 ? wl : ['SPY','QQQ','AAPL','NVDA','TSLA','MSFT','SNDK','AMD','INTC','META']

  // ── State ──────────────────────────────────────────────────────────────────
  const [sym,         setSym]         = useState(() => symbols[0] ?? 'SPY')
  const [searchSym,   setSearchSym]   = useState('')    // typed in search bar
  const [searchInput, setSearchInput] = useState('')    // raw input value
  const [tf,          setTf]          = useState<TF>('1D')
  const [chartType,   setChartType]   = useState<ChartType>('Candle')
  const [quote,       setQuote]       = useState<Record<string, number> | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [ready,       setReady]       = useState(false)
  const [showFib,     setShowFib]     = useState(true)
  const [showPivot,   setShowPivot]   = useState(true)
  const [showDonch,   setShowDonch]   = useState(true)
  const [showIchi,    setShowIchi]    = useState(false)
  const [pfData,      setPfData]      = useState<PnFColumn[]>([])

  // Effective symbol = searched override OR watchlist tab
  const effectiveSym = searchSym || sym

  // ── Refs ───────────────────────────────────────────────────────────────────
  const containerRef  = useRef<HTMLDivElement>(null)
  const pfCanvasRef   = useRef<HTMLCanvasElement>(null)
  const tooltipRef    = useRef<HTMLDivElement>(null)
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const chartR        = useRef<any>(null)
  const candleR       = useRef<any>(null)
  const volumeR       = useRef<any>(null)
  const fibRef        = useRef<any[]>([])
  const pivotLinesR   = useRef<any[]>([])
  const donchUpR      = useRef<any>(null)
  const donchDnR      = useRef<any>(null)
  const donchMidR     = useRef<any>(null)
  const ichiTenkanR   = useRef<any>(null)
  const ichiKijunR    = useRef<any>(null)
  const ichiChikouR   = useRef<any>(null)
  const dataRef       = useRef<Candle[]>([])

  // ── Sync watchlist sym ────────────────────────────────────────────────────
  useEffect(() => {
    if (symbols.length > 0 && !symbols.includes(sym)) setSym(symbols[0])
  }, [symbols.join(',')])

  // ── Fetch helpers ─────────────────────────────────────────────────────────
  const getCandles = useCallback(async (s: string, timeframe: TF = '1D'): Promise<Candle[]> => {
    try {
      const cfg = TF_CFG[timeframe]
      const r   = await fetch(`/api/yfinance?symbols=${encodeURIComponent(s)}&range=${cfg.range}&interval=${cfg.interval}`)
      const j   = await r.json()
      const res = j?.results?.[0]?.data?.chart?.result?.[0]
      if (!res) return []
      const ts = res.timestamp ?? [], q = res.indicators?.quote?.[0]
      if (!q) return []
      return (ts as number[])
        .map((time, i) => ({ time, open: q.open?.[i]??null, high: q.high?.[i]??null, low: q.low?.[i]??null, close: q.close?.[i]??null, volume: q.volume?.[i]??0 }))
        .filter((c): c is Candle => c.open!==null&&c.high!==null&&c.low!==null&&c.close!==null)
        .sort((a, b) => a.time - b.time)
    } catch { return [] }
  }, [])

  const getQuote = useCallback(async (s: string) => {
    try {
      const r = await fetch(`/api/globalquote?symbol=${encodeURIComponent(s)}`)
      const d = await r.json()
      if (d.price != null) {
        setQuote({ c: d.price, d: d.change??0, dp: d.changePercent??0, h: d.high??0, l: d.low??0, pc: d.prevClose??0 })
      }
    } catch {}
  }, [])

  // ── Apply chart type + indicators ─────────────────────────────────────────
  const applyAll = useCallback((candles: Candle[], flags: { fib:boolean; pivot:boolean; donch:boolean; ichi:boolean }) => {
    if (!candleR.current || candles.length === 0) return

    // Apply chart type transformation
    let displayCandles: Candle[]
    switch (chartType) {
      case 'Heikin Ashi': displayCandles = toHeikinAshi(candles); break
      
      default:            displayCandles = candles; break
    }

    if (chartType !== 'P&F') {
      candleR.current.setData(displayCandles)
    } else {
      // P&F: hide main series data (show empty so chart is blank)
      candleR.current.setData([])
    }

    // Volume
    volumeR.current?.setData(candles.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? 'rgba(0,201,122,0.45)' : 'rgba(255,69,96,0.45)',
    })))

    // Fibonacci
    fibRef.current.forEach(l => { try { candleR.current?.removePriceLine(l) } catch {} })
    fibRef.current = []
    if (flags.fib && candles.length >= 2 && chartType !== 'P&F') {
      fibLevels(candles).forEach(f => {
        try { fibRef.current.push(candleR.current.createPriceLine({ price:f.price, color:f.color, lineWidth:1, lineStyle:2, axisLabelVisible:true, title:f.label })) } catch {}
      })
    }

    // Pivot
    pivotLinesR.current.forEach(l => { try { candleR.current?.removePriceLine(l) } catch {} })
    pivotLinesR.current = []
    if (flags.pivot && candles.length >= 2 && chartType !== 'P&F') {
      const piv = pivotLevels(candles)
      try {
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.pivot, color:'#f0a50080', lineWidth:2, lineStyle:0, axisLabelVisible:true, title:'Pivot' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.r1, color:'#00c97a99', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'R1' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.r2, color:'#00c97a66', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'R2' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.s1, color:'#ff456099', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'S1' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.s2, color:'#ff456066', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'S2' }))
      } catch {}
    }

    // Donchian
    if (flags.donch && displayCandles.length >= 20 && chartType !== 'P&F') {
      const donch = donchianChannels(displayCandles)
      donchUpR.current?.setData(donch.map(d => ({ time: d.time, value: d.high })))
      donchDnR.current?.setData(donch.map(d => ({ time: d.time, value: d.low })))
      donchMidR.current?.setData(donch.map(d => ({ time: d.time, value: d.mid })))
    } else {
      donchUpR.current?.setData([])
      donchDnR.current?.setData([])
      donchMidR.current?.setData([])
    }

    // Ichimoku
    if (flags.ichi && displayCandles.length >= 52 && chartType !== 'P&F') {
      const ichi = ichimokuCloud(displayCandles)
      ichiTenkanR.current?.setData(ichi.tenkan)
      ichiKijunR.current?.setData(ichi.kijun)
      ichiChikouR.current?.setData(ichi.chikou)
    } else {
      ichiTenkanR.current?.setData([])
      ichiKijunR.current?.setData([])
      ichiChikouR.current?.setData([])
    }

    // P&F canvas
    if (chartType === 'P&F') {
      const pf = computePnF(candles)
      setPfData(pf)
    } else {
      setPfData([])
    }
  }, [chartType, showFib, showPivot, showDonch, showIchi])

  // ── Render P&F on canvas ──────────────────────────────────────────────────
  useEffect(() => {
    if (pfData.length > 0 && pfCanvasRef.current && containerRef.current) {
      const h = containerRef.current.clientHeight
      renderPnF(pfCanvasRef.current, pfData, h)
    }
  }, [pfData])

  // ── Chart init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    let dead = false;
    (async () => {
      try {
        const LWC = await import('lightweight-charts')
        if (dead || !containerRef.current) return
        const chart = LWC.createChart(containerRef.current, {
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
          layout: { background:{ color:'transparent' }, textColor:'#7a9ab0', fontSize:10 },
          grid: { vertLines:{ color:'#1e2d3d55', style:1 }, horzLines:{ color:'#1e2d3d55', style:1 } },
          crosshair: {
            mode:1,
            vertLine:{ color:'#f0a50055', width:1, style:0, labelBackgroundColor:'#f0a500' },
            horzLine:{ color:'#f0a50055', width:1, style:0, labelBackgroundColor:'#1e2d3d' },
          },
          rightPriceScale:{ borderColor:'#1e2d3d', textColor:'#7a9ab0' },
          timeScale:{ borderColor:'#1e2d3d', timeVisible:true, secondsVisible:false, rightOffset:8 },
          handleScroll:{ mouseWheel:true, pressedMouseMove:true },
          handleScale:{ mouseWheel:true, pinch:true, axisPressedMouseMove:{ time:true, price:true } },
        })
        const candles = chart.addCandlestickSeries({
          priceScaleId:'right',
          upColor:'#00c97a', downColor:'#ff4560',
          borderUpColor:'#00c97a', borderDownColor:'#ff4560',
          wickUpColor:'#00c97a99', wickDownColor:'#ff456099',
        })
        chart.priceScale('right').applyOptions({ scaleMargins: PANES.main })
        const volume = chart.addHistogramSeries({
          priceScaleId:'vol', color:'rgba(0,201,122,0.4)',
          priceFormat:{ type:'volume' }, lastValueVisible:false, priceLineVisible:false,
        })
        chart.priceScale('vol').applyOptions({ scaleMargins: PANES.volume })
        const shared = { lastValueVisible:false, priceLineVisible:false, crosshairMarkerVisible:false }
        const donchUp  = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'#1e90ff', lineWidth:2 })
        const donchDn  = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'#ff6b6b', lineWidth:2 })
        const donchMid = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'rgba(160,160,160,0.5)', lineWidth:1, lineStyle:3 })
        const ichiTenkan = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'#00e5c0', lineWidth:3 })
        const ichiKijun  = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'#ff4560', lineWidth:3 })
        const ichiChikou = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'#a78bfa', lineWidth:2, lineStyle:1 })
        chartR.current=chart; candleR.current=candles; volumeR.current=volume
        donchUpR.current=donchUp; donchDnR.current=donchDn; donchMidR.current=donchMid
        ichiTenkanR.current=ichiTenkan; ichiKijunR.current=ichiKijun; ichiChikouR.current=ichiChikou
        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartR.current) {
            chartR.current.applyOptions({ width:containerRef.current.clientWidth, height:containerRef.current.clientHeight })
          }
        })
        ro.observe(containerRef.current)
        chart.subscribeCrosshairMove(param => {
          if (!param.time || !param.point) { if (tooltipRef.current) tooltipRef.current.style.opacity='0'; return }
          const cd = param.seriesData.get(candles) as any
          if (cd && tooltipRef.current) {
            const up = cd.close>=cd.open
            tooltipRef.current.style.opacity='1'
            tooltipRef.current.innerHTML =
              `<span style="color:#4a6070">O&nbsp;</span><b style="color:#fff">${cd.open?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070">H&nbsp;</span><b style="color:#00c97a">${cd.high?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070">L&nbsp;</span><b style="color:#ff4560">${cd.low?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070">C&nbsp;</span><b style="color:${up?'#00c97a':'#ff4560'}">${cd.close?.toFixed(2)}</b>`
          }
        })
        if (!dead) setReady(true)
      } catch (err) { console.error('[ChartPanel] init error:', err) }
    })()
    return () => {
      dead=true
      try { chartR.current?.remove() } catch {}
      chartR.current=candleR.current=volumeR.current=null
      donchUpR.current=donchDnR.current=donchMidR.current=null
      ichiTenkanR.current=ichiKijunR.current=ichiChikouR.current=null
      setReady(false)
    }
  }, [])

  // ── Load data when symbol, timeframe, or chart type changes ───────────────
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setLoading(true)
    Promise.all([getCandles(effectiveSym, tf), getQuote(effectiveSym)]).then(([candles]) => {
      if (cancelled || !candleR.current) return
      if (candles.length > 0) {
        dataRef.current = candles
        applyAll(candles, { fib:showFib, pivot:showPivot, donch:showDonch, ichi:showIchi })
        if (chartType !== 'P&F') chartR.current?.timeScale().fitContent()
      }
      setLoading(false)
    }).catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [effectiveSym, tf, ready, chartType])

  // ── Re-apply indicators when toggled ─────────────────────────────────────
  useEffect(() => {
    if (!ready || dataRef.current.length === 0) return
    applyAll(dataRef.current, { fib:showFib, pivot:showPivot, donch:showDonch, ichi:showIchi })
  }, [showFib, showPivot, showDonch, showIchi, chartType, ready])

  // ── Scroll active tab into view ───────────────────────────────────────────
  useEffect(() => {
    const container = tabsScrollRef.current
    if (!container) return
    const active = container.querySelector(`[data-sym="${sym}"]`) as HTMLElement | null
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [sym])

  // ── Search submit ─────────────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    const s = searchInput.trim().toUpperCase()
    if (s) {
      setSearchSym(s)
      setSearchInput(s)
    }
  }, [searchInput])

  const clearSearch = useCallback(() => {
    setSearchSym('')
    setSearchInput('')
  }, [])

  const isUp = (quote?.dp ?? 0) >= 0

  return (
    <div className="panel" style={{ height:'100%', display:'flex', flexDirection:'column' }}>

      {/* ── Row 1: Symbol tabs + Search ─────────────────────────────────── */}
      <div className="panel-header" style={{
        justifyContent:'space-between', gap:'4px',
        padding:'5px 10px', minHeight:'34px', flexWrap:'nowrap',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:'4px', minWidth:0, flex:1 }}>
          <div className="dot" style={{ flexShrink:0 }} />

          {/* Watchlist symbol tabs */}
          <div
            ref={tabsScrollRef}
            style={{
              display:'flex', gap:'3px', overflowX:'auto', overflowY:'hidden',
              scrollbarWidth:'none', flex:1, paddingBottom:'1px',
            }}
          >
            {symbols.map(s => (
              <button
                key={s}
                data-sym={s}
                onClick={() => { setSym(s); clearSearch() }}
                style={{
                  padding:'2px 7px', borderRadius:'3px', border:'none', cursor:'pointer',
                  fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'11px',
                  background: !searchSym && sym===s ? 'var(--amber)' : 'var(--bg-deep)',
                  color:      !searchSym && sym===s ? '#000' : 'var(--text-2)',
                  transition:'all 0.12s', flexShrink:0,
                }}
              >{s}</button>
            ))}
          </div>
        </div>

        {/* ── Search any symbol ── */}
        <div style={{ display:'flex', alignItems:'center', gap:'4px', flexShrink:0 }}>
          <input
            value={searchInput}
            onChange={e => setSearchInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') clearSearch() }}
            placeholder="Search any symbol…"
            style={{
              width:'130px', background:'var(--bg-deep)', border:`1px solid ${searchSym ? 'var(--teal)' : 'var(--border)'}`,
              borderRadius:'3px', padding:'3px 7px', color:'#fff',
              fontSize:'10px', fontFamily:'JetBrains Mono, monospace', outline:'none',
            }}
          />
          {searchSym ? (
            <button onClick={clearSearch} style={{ ...mkBtn(false,'teal'), padding:'2px 6px', fontSize:'10px' }} title="Clear search">✕</button>
          ) : (
            <button onClick={handleSearch} style={{ ...mkBtn(false,'teal'), padding:'2px 8px' }}>GO</button>
          )}
          {searchSym && (
            <span style={{ fontSize:'9px', color:'var(--teal)', fontFamily:'JetBrains Mono, monospace', background:'rgba(0,229,192,0.1)', padding:'2px 6px', borderRadius:'3px', border:'1px solid rgba(0,229,192,0.25)' }}>
              {searchSym}
            </span>
          )}
        </div>
      </div>

      {/* ── Row 2: Chart Type + Indicators ──────────────────────────────── */}
      <div style={{
        padding:'3px 10px', borderBottom:'1px solid var(--border)',
        display:'flex', alignItems:'center', gap:'5px', flexWrap:'wrap',
        background:'rgba(0,0,0,0.18)',
      }}>
        <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', letterSpacing:'0.08em', flexShrink:0 }}>TYPE</span>
        {CHART_TYPES.map(ct => (
          <button key={ct} onClick={() => setChartType(ct)} style={{
            padding:'2px 7px', borderRadius:'3px', cursor:'pointer', flexShrink:0,
            fontFamily:'JetBrains Mono, monospace', fontSize:'9px',
            border:`1px solid ${chartType===ct ? 'var(--amber)' : 'var(--border)'}`,
            background: chartType===ct ? 'rgba(240,165,0,0.1)' : 'transparent',
            color:       chartType===ct ? 'var(--amber)' : 'var(--text-2)',
            transition:'all 0.12s',
          }}>{ct}</button>
        ))}

        <div style={{ width:'1px', height:'14px', background:'var(--border)', margin:'0 2px', flexShrink:0 }} />
        <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', letterSpacing:'0.08em', flexShrink:0 }}>IND</span>
        <button onClick={() => setShowFib(v=>!v)}   style={mkBtn(showFib)}          title="Fibonacci Levels">FIB</button>
        <button onClick={() => setShowPivot(v=>!v)} style={mkBtn(showPivot,'purple')} title="Pivot Points">PIVOT</button>
        <button onClick={() => setShowDonch(v=>!v)} style={mkBtn(showDonch)}          title="Donchian Channels">DONCH</button>
        <button onClick={() => setShowIchi(v=>!v)}  style={mkBtn(showIchi,'teal')}    title="Ichimoku Cloud">ICHIMOKU</button>
      </div>

      {/* ── Row 3: Timeframe ────────────────────────────────────────────── */}
      <div style={{
        padding:'3px 10px', borderBottom:'1px solid var(--border)',
        display:'flex', alignItems:'center', gap:'4px', flexWrap:'wrap',
        background:'rgba(0,0,0,0.12)',
      }}>
        <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', letterSpacing:'0.1em', flexShrink:0 }}>TF</span>
        {TFS.map(t => (
          <button key={t} onClick={() => setTf(t)} style={{
            padding:'2px 7px', borderRadius:'3px', cursor:'pointer',
            fontFamily:'JetBrains Mono, monospace', fontSize:'10px', flexShrink:0,
            border:`1px solid ${tf===t?'var(--teal)':'var(--border)'}`,
            background: tf===t?'rgba(0,229,192,0.1)':'transparent',
            color:      tf===t?'var(--teal)':'var(--text-2)',
            transition:'all 0.12s',
          }}>{t}</button>
        ))}
        <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', marginLeft:'6px' }}>
          · {TF_CFG[tf].label}
        </span>
        {chartType === 'P&F' && (
          <span style={{ fontSize:'9px', color:'var(--amber)', fontFamily:'JetBrains Mono, monospace', marginLeft:'auto', border:'1px solid rgba(240,165,0,0.3)', padding:'1px 6px', borderRadius:'2px', background:'rgba(240,165,0,0.08)' }}>
            X = up · O = down · 3-box reversal
          </span>
        )}
      </div>

      {/* ── Quote strip ─────────────────────────────────────────────────── */}
      {quote && (
        <div style={{
          padding:'4px 12px', borderBottom:'1px solid var(--border)',
          display:'flex', alignItems:'baseline', gap:'10px', flexWrap:'wrap',
          background:'rgba(0,0,0,0.22)',
        }}>
          <span style={{ fontFamily:'Syne, sans-serif', fontWeight:800, fontSize:'20px', color:'#fff', letterSpacing:'-0.02em' }}>
            {quote.c?.toFixed(2)}
          </span>
          <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'12px', color:isUp?'var(--positive)':'var(--negative)' }}>
            {isUp?'+':''}{quote.d?.toFixed(2)}&nbsp;({isUp?'+':''}{quote.dp?.toFixed(2)}%)
          </span>
          <span style={{ fontSize:'10px', fontFamily:'Syne, sans-serif', fontWeight:700, color:'var(--text-muted)', marginLeft:'4px' }}>
            {effectiveSym}
          </span>
          {chartType === 'Heikin Ashi' && <span style={{ fontSize:'9px', color:'var(--amber)', fontFamily:'JetBrains Mono, monospace', padding:'1px 5px', borderRadius:'2px', border:'1px solid rgba(240,165,0,0.3)' }}>HEIKEN ASHI</span>}
          <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', marginLeft:'auto' }}>
            scroll=zoom · drag price axis=stretch
          </span>
        </div>
      )}

      {/* ── Chart area ──────────────────────────────────────────────────── */}
      <div style={{ flex:1, position:'relative', minHeight:0 }}>
        {loading && (
          <div style={{ position:'absolute', inset:0, zIndex:10, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(9,12,16,0.78)' }}>
            <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'11px', color:'var(--text-muted)', letterSpacing:'0.12em' }}>
              LOADING {effectiveSym}...
            </span>
          </div>
        )}

        {/* OHLC tooltip */}
        <div ref={tooltipRef} style={{
          position:'absolute', top:'6px', left:'8px', zIndex:8,
          fontFamily:'JetBrains Mono, monospace', fontSize:'11px',
          opacity:0, pointerEvents:'none',
          background:'rgba(9,12,16,0.82)', padding:'3px 10px',
          borderRadius:'3px', border:'1px solid var(--border)',
          transition:'opacity 0.06s',
        }} />

        {/* Volume pane separator */}
        <div style={{ position:'absolute', left:0, right:0, top:'85%', height:'1px', background:'#1e2d3d', zIndex:5, pointerEvents:'none' }} />
        <div style={{ position:'absolute', left:'8px', top:'86%', zIndex:6, fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', pointerEvents:'none' }}>VOL</div>

        {/* ── P&F Canvas overlay ─────────────────────────────────────────── */}
        {chartType === 'P&F' && (
          <div style={{
            position:'absolute', inset:0, zIndex:7,
            overflowX:'auto', overflowY:'auto',
            background:'#090c10',
          }}>
            {pfData.length > 0 ? (
              <canvas ref={pfCanvasRef} style={{ display:'block', cursor:'crosshair' }} />
            ) : (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', fontSize:'11px' }}>
                {loading ? 'Computing P&F...' : 'Not enough price swings for P&F'}
              </div>
            )}
          </div>
        )}

        {/* LWC chart canvas */}
        <div ref={containerRef} style={{ width:'100%', height:'100%', display: chartType === 'P&F' ? 'none' : 'block' }} />
      </div>
    </div>
  )
}