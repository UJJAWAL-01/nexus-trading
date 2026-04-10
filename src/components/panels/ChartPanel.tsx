'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

// ── Math helpers ──────────────────────────────────────────────────────────────
function computeHeikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    const haClose = (c.open + c.high + c.low + c.close) / 4
    const haOpen  = i === 0
      ? (c.open + c.close) / 2
      : (out[i - 1].open + out[i - 1].close) / 2
    const haHigh  = Math.max(c.high, haOpen, haClose)
    const haLow   = Math.min(c.low,  haOpen, haClose)
    // Keep original timestamps — HA maps 1-to-1 with source candles
    out.push({ time: c.time, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: c.volume })
  }
  return out
}

function atr(candles: Candle[], period = 14): number[] {
  const trs = candles.map((c, i) => {
    if (i === 0) return c.high - c.low
    return Math.max(c.high - c.low, Math.abs(c.high - candles[i-1].close), Math.abs(c.low - candles[i-1].close))
  })
  const result: number[] = [trs[0]]
  for (let i = 1; i < trs.length; i++) {
    result.push((result[i-1] * (period - 1) + trs[i]) / period)
  }
  return result
}

/**
 * Renko — FIX: each brick gets a unique synthetic timestamp so no two bricks
 * share the same time value (which caused the deduplication pass to wipe them).
 * We space bricks 60 s apart starting from the first real candle's time.
 */
function computeRenko(candles: Candle[]): Candle[] {
  if (candles.length < 20) return candles
  const atrs   = atr(candles, 14)
  const boxSize = atrs[atrs.length - 1] * 1.5
  const bricks: Candle[] = []

  // Synthetic time counter – starts at the first real timestamp
  let syntheticTime = candles[0].time

  let lastBrickHigh = candles[0].close
  let lastBrickLow  = candles[0].close

  for (let i = 1; i < candles.length; i++) {
    const price = candles[i].close
    const vol   = candles[i].volume

    // Bullish bricks
    while (price >= lastBrickHigh + boxSize) {
      const newHigh = lastBrickHigh + boxSize
      bricks.push({ time: syntheticTime, open: lastBrickHigh, high: newHigh, low: lastBrickHigh, close: newHigh, volume: vol })
      syntheticTime += 60          // ← unique tick per brick
      lastBrickLow  = lastBrickHigh
      lastBrickHigh = newHigh
    }
    // Bearish bricks
    while (price <= lastBrickLow - boxSize) {
      const newLow = lastBrickLow - boxSize
      bricks.push({ time: syntheticTime, open: lastBrickLow, high: lastBrickLow, low: newLow, close: newLow, volume: vol })
      syntheticTime += 60
      lastBrickHigh = lastBrickLow
      lastBrickLow  = newLow
    }
  }

  return bricks.length > 0 ? bricks : candles
}

/**
 * Point & Figure — classic 3-box reversal, ATR-based box size.
 * X columns = rising price, O columns = falling price.
 * Each box is rendered as a zero-wick candlestick:
 *   X box → open = box_bottom, close = box_top  (green)
 *   O box → open = box_top,    close = box_bottom (red)
 * Synthetic timestamps keep boxes evenly spaced on the time axis;
 * a 10-tick gap is inserted between column reversals for visual clarity.
 */
function computePnF(candles: Candle[]): Candle[] {
  if (candles.length < 20) return candles

  const atrs    = atr(candles, 14)
  const boxSize = atrs[atrs.length - 1] * 1.5

  const snap = (p: number) => Math.floor(p / boxSize) * boxSize

  const bricks: Candle[] = []
  let syntheticTime = 1_000_000   // start well away from real unix ts
  const gap = 10                  // ticks between columns

  // Seed with first close
  let direction: 'X' | 'O' | null = null
  let colTop    = snap(candles[0].close)
  let colBottom = colTop

  const addX = (bottom: number, top: number, vol: number) => {
    for (let p = bottom + boxSize; p <= top + 1e-9; p += boxSize) {
      bricks.push({ time: syntheticTime++, open: p - boxSize, high: p, low: p - boxSize, close: p, volume: vol })
    }
  }

  const addO = (top: number, bottom: number, vol: number) => {
    for (let p = top - boxSize; p >= bottom - 1e-9; p -= boxSize) {
      bricks.push({ time: syntheticTime++, open: p + boxSize, high: p + boxSize, low: p, close: p, volume: vol })
    }
  }

  for (let i = 1; i < candles.length; i++) {
    const price = snap(candles[i].close)
    const vol   = candles[i].volume

    if (direction === null) {
      // Determine initial direction
      if (price >= colTop + boxSize) {
        direction = 'X'; addX(colBottom, price, vol); colTop = price
      } else if (price <= colBottom - boxSize) {
        direction = 'O'; addO(colTop, price, vol); colBottom = price
      }
      continue
    }

    if (direction === 'X') {
      if (price >= colTop + boxSize) {
        // Continue column up
        addX(colTop, price, vol); colTop = price
      } else if (price <= colTop - 3 * boxSize) {
        // 3-box reversal to O
        direction = 'O'
        syntheticTime += gap
        colBottom = price
        addO(colTop - boxSize, price, vol)
        colTop = colTop - boxSize
      }
    } else {
      if (price <= colBottom - boxSize) {
        // Continue column down
        addO(colBottom, price, vol); colBottom = price
      } else if (price >= colBottom + 3 * boxSize) {
        // 3-box reversal to X
        direction = 'X'
        syntheticTime += gap
        colTop = price
        addX(colBottom + boxSize, price, vol)
        colBottom = colBottom + boxSize
      }
    }
  }

  return bricks.length > 0 ? bricks : candles
}

function fibLevels(candles: Candle[]) {
  const s = candles.slice(-60)
  const H = Math.max(...s.map(c => c.high)), L = Math.min(...s.map(c => c.low)), d = H - L
  return [
    { price: H,           label: 'Fib 0%',    color: '#ffffff50' },
    { price: H - 0.236*d, label: 'Fib 23.6%', color: '#00e5c099' },
    { price: H - 0.382*d, label: 'Fib 38.2%', color: '#1e90ffaa' },
    { price: H - 0.5*d,   label: 'Fib 50%',   color: '#f0a500bb' },
    { price: H - 0.618*d, label: 'Fib 61.8%', color: '#ff4560bb' },
    { price: L,           label: 'Fib 100%',  color: '#ffffff50' },
  ]
}

function pivotLevels(candles: Candle[]) {
  const last = candles[candles.length - 1]
  const P = (last.high + last.low + last.close) / 3
  return { pivot: P, r1: 2*P - last.low, r2: P + (last.high - last.low), s1: 2*P - last.high, s2: P - (last.high - last.low) }
}

function donchianChannels(candles: Candle[], period = 20) {
  return candles.slice(period - 1).map((_, idx) => {
    const slice = candles.slice(idx, idx + period)
    const high = Math.max(...slice.map(c => c.high))
    const low  = Math.min(...slice.map(c => c.low))
    return { time: candles[idx + period - 1].time, high, low, mid: (high + low) / 2 }
  })
}

function ichimokuCloud(candles: Candle[]) {
  const tenkan: any[] = [], kijun: any[] = [], chikou: any[] = []
  for (let i = 25; i < candles.length; i++) {
    const t9  = candles.slice(Math.max(0,i-9), i+1)
    const t26 = candles.slice(Math.max(0,i-26), i+1)
    tenkan.push({ time: candles[i].time, value: (Math.max(...t9.map(c=>c.high)) + Math.min(...t9.map(c=>c.low))) / 2 })
    kijun.push({  time: candles[i].time, value: (Math.max(...t26.map(c=>c.high)) + Math.min(...t26.map(c=>c.low))) / 2 })
    chikou.push({ time: candles[i].time, value: candles[Math.max(0,i-26)].close })
  }
  return { tenkan, kijun, chikou }
}

// ── Timezone helper ───────────────────────────────────────────────────────────
function getSymbolTimezone(sym: string): string {
  if (sym.endsWith('.NS') || sym.endsWith('.BO') || sym.includes('NSEI') || sym.includes('BSESN')) return 'Asia/Kolkata'
  if (sym.endsWith('.T') || sym.includes('N225')) return 'Asia/Tokyo'
  if (sym.endsWith('.HK') || sym.includes('HSI')) return 'Asia/Hong_Kong'
  if (sym.endsWith('.L')) return 'Europe/London'
  if (sym.endsWith('.DE') || sym.endsWith('.F')) return 'Europe/Berlin'
  return 'America/New_York'
}

function tzLabel(sym: string): string {
  const tz = getSymbolTimezone(sym)
  if (tz === 'Asia/Kolkata') return 'IST'
  if (tz === 'Asia/Tokyo') return 'JST'
  if (tz === 'Asia/Hong_Kong') return 'HKT'
  if (tz === 'Europe/London') return 'GMT/BST'
  if (tz.startsWith('Europe')) return 'CET'
  return 'ET'
}

function formatTimeInTz(unixSeconds: number, sym: string): string {
  const tz = getSymbolTimezone(sym)
  return new Date(unixSeconds * 1000).toLocaleTimeString('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
  })
}

// ── Timeframe configs ─────────────────────────────────────────────────────────
const TF_CONFIGS = {
  '15m': { range: '1d',  interval: '15m', label: 'Today · 15min',    description: 'Intraday 15-minute candles' },
  '1H':  { range: '5d',  interval: '60m', label: '5D · 1hr',         description: '5-day hourly candles' },
  '1D':  { range: '3mo', interval: '1d',  label: '3M · Daily',        description: '3-month daily candles' },
  '1W':  { range: '1y',  interval: '1wk', label: '1Y · Weekly',       description: '1-year weekly candles' },
  '1M':  { range: '5y',  interval: '1mo', label: '5Y · Monthly',      description: '5-year monthly candles' },
} as const
type TF = keyof typeof TF_CONFIGS

// ── Chart types ───────────────────────────────────────────────────────────────
const CHART_TYPES = {
  candle: {
    label: 'Candle',
    icon: '🕯',
    description: 'Standard OHLC candlestick — shows open, high, low, close for each period. Green = up day, Red = down day.',
    syntheticTime: false,
  },
  heikin: {
    label: 'Heikin Ashi',
    icon: '⬛',
    description: 'Smoothed candles that filter noise. HA Close = avg of OHLC, HA Open = avg of prev HA open/close. Better for trend following.',
    syntheticTime: false,
  },
  renko: {
    label: 'Renko',
    icon: '▪',
    description: 'Brick charts that ignore time — only price moves matter. Each brick = 1.5× ATR move. Filters noise, shows pure trend.',
    syntheticTime: true,
  },
  pnf: {
    label: 'P&F',
    icon: '✕',
    description: 'Point & Figure — X columns rise, O columns fall. 3-box ATR reversal. Time is irrelevant; only price direction matters.',
    syntheticTime: true,
  },
} as const
type ChartType = keyof typeof CHART_TYPES

// ── Whether a chart type uses synthetic (non-real) timestamps ─────────────────
const SYNTHETIC_TIME_TYPES: ChartType[] = ['renko', 'pnf']

function mkBtn(active: boolean, col: 'amber'|'purple'|'teal'|'blue' = 'amber'): React.CSSProperties {
  const C = {
    amber:  ['#f0a500', 'rgba(240,165,0,0.12)'],
    purple: ['#a78bfa', 'rgba(167,139,250,0.12)'],
    teal:   ['#00e5c0', 'rgba(0,229,192,0.12)'],
    blue:   ['#1e90ff', 'rgba(30,144,255,0.12)'],
  }[col]
  return {
    padding: '2px 8px', borderRadius: '3px', cursor: 'pointer', whiteSpace: 'nowrap' as const,
    fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', letterSpacing: '0.06em',
    border:     `1px solid ${active ? C[0] : 'var(--border)'}`,
    background: active ? C[1] : 'transparent',
    color:      active ? C[0] : 'var(--text-muted)',
    transition: 'all 0.12s', flexShrink: 0,
  }
}

export default function ChartPanel() {
  const { symbols: wl } = useWatchlist()
  const symbols = wl.length > 0 ? wl : ['SPY','QQQ','AAPL','NVDA','TSLA','MSFT']

  const [sym,       setSym]       = useState(() => symbols[0] ?? 'SPY')
  const [tf,        setTf]        = useState<TF>('15m')
  const [chartType, setChartType] = useState<ChartType>('candle')
  const [quote,     setQuote]     = useState<Record<string,number>|null>(null)
  const [loading,   setLoading]   = useState(true)
  const [ready,     setReady]     = useState(false)
  const [showFib,   setShowFib]   = useState(true)
  const [showPivot, setShowPivot] = useState(true)
  const [showDonch, setShowDonch] = useState(false)
  const [showIchi,  setShowIchi]  = useState(false)
  const [hoveredCtrl, setHoveredCtrl] = useState<string|null>(null)
  const [hoveredChartType, setHoveredChartType] = useState<ChartType|null>(null)
  const [dataAge,   setDataAge]   = useState<string>('')
  const [candleCount, setCandleCount] = useState(0)

  const containerRef  = useRef<HTMLDivElement>(null)
  const tooltipRef    = useRef<HTMLDivElement>(null)
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const volTooltipRef = useRef<HTMLDivElement>(null)

  const chartR       = useRef<any>(null)
  const candleR      = useRef<any>(null)
  const volumeR      = useRef<any>(null)
  const fibRef       = useRef<any[]>([])
  const pivotLinesR  = useRef<any[]>([])
  const donchUpR     = useRef<any>(null)
  const donchDnR     = useRef<any>(null)
  const donchMidR    = useRef<any>(null)
  const ichiTenkanR  = useRef<any>(null)
  const ichiKijunR   = useRef<any>(null)
  const ichiChikouR  = useRef<any>(null)
  const dataRef      = useRef<Candle[]>([])
  const initialFitDone = useRef(false)
  const currentSymRef  = useRef(sym)
  const currentTfRef   = useRef(tf)
  const currentTypeRef = useRef(chartType)   // ← track chart type changes for fitContent

  useEffect(() => {
    if (symbols.length > 0 && !symbols.includes(sym)) setSym(symbols[0])
  }, [symbols.join(',')])

  const getCandles = useCallback(async (s: string, timeframe: TF): Promise<Candle[]> => {
    try {
      const cfg = TF_CONFIGS[timeframe]
      const r = await fetch(`/api/yfinance?symbols=${encodeURIComponent(s)}&range=${cfg.range}&interval=${cfg.interval}`)
      const j = await r.json()
      const res = j?.results?.[0]?.data?.chart?.result?.[0]
      if (!res) return []
      const ts = res.timestamp ?? [], q = res.indicators?.quote?.[0]
      if (!q) return []
      return (ts as number[])
        .map((time, i) => ({ time, open: q.open?.[i], high: q.high?.[i], low: q.low?.[i], close: q.close?.[i], volume: q.volume?.[i] ?? 0 }))
        .filter((c): c is Candle => c.open != null && c.high != null && c.low != null && c.close != null)
        .sort((a, b) => a.time - b.time)
    } catch { return [] }
  }, [])

  const getQuote = useCallback(async (s: string) => {
    try {
      const r = await fetch(`/api/globalquote?symbol=${encodeURIComponent(s)}`)
      const d = await r.json()
      if (d.price != null) setQuote({ c: d.price, d: d.change ?? 0, dp: d.changePercent ?? 0, h: d.high ?? 0, l: d.low ?? 0, pc: d.prevClose ?? 0 })
    } catch {}
  }, [])

  const applyIndicators = useCallback((candles: Candle[], flags: { fib: boolean; pivot: boolean; donch: boolean; ichi: boolean }, isSynthetic: boolean) => {
    if (!candleR.current) return

    // Volume — skip for synthetic-time types (bricks don't map 1:1 to time)
    if (!isSynthetic) {
      volumeR.current?.setData(candles.map(c => ({
        time: c.time, value: c.volume,
        color: c.close >= c.open ? 'rgba(0,201,122,0.55)' : 'rgba(255,69,96,0.55)',
      })))
    } else {
      volumeR.current?.setData([])
    }

    // Fibonacci
    fibRef.current.forEach(l => { try { candleR.current?.removePriceLine(l) } catch {} })
    fibRef.current = []
    if (flags.fib && candles.length >= 2) {
      fibLevels(candles).forEach(f => {
        try { fibRef.current.push(candleR.current.createPriceLine({ price: f.price, color: f.color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: f.label })) } catch {}
      })
    }

    // Pivot
    pivotLinesR.current.forEach(l => { try { candleR.current?.removePriceLine(l) } catch {} })
    pivotLinesR.current = []
    if (flags.pivot && candles.length >= 2) {
      const piv = pivotLevels(candles)
      try {
        pivotLinesR.current.push(candleR.current.createPriceLine({ price: piv.pivot, color: '#f0a500cc', lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: 'Pivot' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price: piv.r1, color: '#00c97acc', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'R1' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price: piv.r2, color: '#00c97a88', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'R2' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price: piv.s1, color: '#ff4560cc', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'S1' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price: piv.s2, color: '#ff456088', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: 'S2' }))
      } catch {}
    }

    // Donchian (skip for synthetic-time types — timestamps won't align)
    if (flags.donch && candles.length >= 20 && !isSynthetic) {
      const donch = donchianChannels(candles)
      donchUpR.current?.setData(donch.map(d => ({ time: d.time, value: d.high })))
      donchDnR.current?.setData(donch.map(d => ({ time: d.time, value: d.low })))
      donchMidR.current?.setData(donch.map(d => ({ time: d.time, value: d.mid })))
    } else {
      donchUpR.current?.setData([])
      donchDnR.current?.setData([])
      donchMidR.current?.setData([])
    }

    // Ichimoku (skip for synthetic-time types)
    if (flags.ichi && candles.length >= 52 && !isSynthetic) {
      const ichi = ichimokuCloud(candles)
      ichiTenkanR.current?.setData(ichi.tenkan)
      ichiKijunR.current?.setData(ichi.kijun)
      ichiChikouR.current?.setData(ichi.chikou)
    } else {
      ichiTenkanR.current?.setData([])
      ichiKijunR.current?.setData([])
      ichiChikouR.current?.setData([])
    }
  }, [])

  // Chart init
  useEffect(() => {
    if (!containerRef.current) return
    let dead = false

    ;(async () => {
      try {
        const LWC = await import('lightweight-charts')
        if (dead || !containerRef.current) return

        const chart = LWC.createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
          layout: { background: { color: 'transparent' }, textColor: '#7a9ab0', fontSize: 11 },
          grid: { vertLines: { color: '#1e2d3d66', style: 1 }, horzLines: { color: '#1e2d3d66', style: 1 } },
          crosshair: {
            mode: 1,
            vertLine: { color: '#f0a50066', width: 1, style: 0, labelBackgroundColor: '#f0a500' },
            horzLine: { color: '#f0a50066', width: 1, style: 0, labelBackgroundColor: '#1e2d3d' },
          },
          rightPriceScale: { borderColor: '#1e2d3d', textColor: '#7a9ab0', scaleMargins: { top: 0.08, bottom: 0.18 } },
          timeScale: { borderColor: '#1e2d3d', timeVisible: true, secondsVisible: false, rightOffset: 10 },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: { time: true, price: true } },
        })

        const candles = chart.addCandlestickSeries({
          priceScaleId: 'right',
          upColor: '#00c97a', downColor: '#ff4560',
          borderUpColor: '#00c97a', borderDownColor: '#ff4560',
          wickUpColor: '#00c97aaa', wickDownColor: '#ff4560aa',
        })

        const volume = chart.addHistogramSeries({
          priceScaleId: 'vol', color: 'rgba(0,201,122,0.5)',
          priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
        })
        chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0.01 } })

        const shared = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }
        const donchUp  = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#3b82f6', lineWidth: 2 })
        const donchDn  = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#f87171', lineWidth: 2 })
        const donchMid = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#94a3b888', lineWidth: 1, lineStyle: 3 })
        const ichiTenkan = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#00e5c0', lineWidth: 2 })
        const ichiKijun  = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#ff6b6b', lineWidth: 2 })
        const ichiChikou = chart.addLineSeries({ ...shared, priceScaleId: 'right', color: '#c084fc', lineWidth: 2, lineStyle: 1 })

        chartR.current = chart; candleR.current = candles; volumeR.current = volume
        donchUpR.current = donchUp; donchDnR.current = donchDn; donchMidR.current = donchMid
        ichiTenkanR.current = ichiTenkan; ichiKijunR.current = ichiKijun; ichiChikouR.current = ichiChikou

        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartR.current) {
            chartR.current.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight })
          }
        })
        ro.observe(containerRef.current)

        chart.subscribeCrosshairMove(param => {
          if (!param.time || !param.point) {
            if (tooltipRef.current) tooltipRef.current.style.opacity = '0'
            if (volTooltipRef.current) volTooltipRef.current.style.opacity = '0'
            return
          }
          const cd = param.seriesData.get(candles) as any
          const vd = param.seriesData.get(volume) as any
          const curSym  = currentSymRef.current
          const curType = currentTypeRef.current
          if (cd && tooltipRef.current) {
            const up = cd.close >= cd.open
            // For synthetic-time chart types, don't attempt timestamp → wall-clock conversion
            const timeStr = SYNTHETIC_TIME_TYPES.includes(curType)
              ? `Box ${param.logical ?? ''}`
              : formatTimeInTz(param.time as number, curSym)
            tooltipRef.current.style.opacity = '1'
            tooltipRef.current.innerHTML =
              `<span style="color:#4a6070">O&nbsp;</span><b style="color:#fff">${cd.open?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070">H&nbsp;</span><b style="color:#00c97a">${cd.high?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070">L&nbsp;</span><b style="color:#ff4560">${cd.low?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070">C&nbsp;</span><b style="color:${up?'#00c97a':'#ff4560'}">${cd.close?.toFixed(2)}</b>&emsp;` +
              `<span style="color:#4a6070;font-size:9px">${timeStr}</span>`
          }
          if (vd && volTooltipRef.current) {
            const vol = vd.value
            const fmtVol = vol >= 1e9 ? (vol/1e9).toFixed(1)+'B' : vol >= 1e6 ? (vol/1e6).toFixed(1)+'M' : vol >= 1e3 ? (vol/1e3).toFixed(0)+'K' : vol?.toFixed(0)
            volTooltipRef.current.style.opacity = '1'
            volTooltipRef.current.textContent = `Vol: ${fmtVol}`
          }
        })

        if (!dead) setReady(true)
      } catch (err) { console.error('[ChartPanel] init:', err) }
    })()

    return () => {
      dead = true
      try { chartR.current?.remove() } catch {}
      chartR.current = candleR.current = volumeR.current = null
      setReady(false)
    }
  }, [])

  // Load data when sym, tf, or chartType changes
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    setLoading(true)

    // FIX: include chartType in the "did something meaningful change?" check
    const symChanged  = currentSymRef.current  !== sym
                     || currentTfRef.current   !== tf
                     || currentTypeRef.current !== chartType

    currentSymRef.current  = sym
    currentTfRef.current   = tf
    currentTypeRef.current = chartType

    const isSynthetic = SYNTHETIC_TIME_TYPES.includes(chartType)

    // Synthetic-time chart types (Renko, P&F) need time axis in "index" mode so
    // lightweight-charts doesn't try to parse the fake timestamps as dates.
    chartR.current?.applyOptions({
      timeScale: {
        timeVisible:    !isSynthetic,
        secondsVisible: false,
        tickMarkFormatter: isSynthetic
          ? () => ''          // hide all tick labels — time is meaningless
          : undefined,
      },
    })

    Promise.all([getCandles(sym, tf), getQuote(sym)]).then(([rawCandles]) => {
      if (cancelled || !candleR.current || rawCandles.length === 0) { setLoading(false); return }

      // Apply chart-type transform
      let displayCandles: Candle[]
      if (chartType === 'heikin') {
        displayCandles = computeHeikinAshi(rawCandles)
      } else if (chartType === 'renko') {
        displayCandles = computeRenko(rawCandles)
      } else if (chartType === 'pnf') {
        displayCandles = computePnF(rawCandles)
      } else {
        displayCandles = rawCandles
      }

      // Safety dedup (Heikin Ashi and regular candles shouldn't need this,
      // but Renko/P&F now use synthetic timestamps so collisions are impossible)
      const seen = new Set<number>()
      const unique = displayCandles.filter(c => { if (seen.has(c.time)) return false; seen.add(c.time); return true })

      // For P&F, suppress wicks so it looks like proper filled boxes
      if (chartType === 'pnf') {
        candleR.current.applyOptions({ wickUpColor: 'transparent', wickDownColor: 'transparent' })
      } else {
        candleR.current.applyOptions({ wickUpColor: '#00c97aaa', wickDownColor: '#ff4560aa' })
      }

      candleR.current.setData(unique)
      dataRef.current = rawCandles
      setCandleCount(unique.length)

      // Data freshness (only meaningful for real-time charts)
      if (!isSynthetic) {
        const lastTs = rawCandles[rawCandles.length - 1]?.time ?? 0
        const ageMin = Math.floor((Date.now()/1000 - lastTs) / 60)
        if (ageMin < 1) setDataAge('Live')
        else if (ageMin < 60) setDataAge(`${ageMin}m ago`)
        else setDataAge(`${Math.floor(ageMin/60)}h ago`)
      } else {
        setDataAge('')
      }

      // Always fit when something actually changed
      if (symChanged || !initialFitDone.current) {
        chartR.current?.timeScale().fitContent()
        initialFitDone.current = true
      }

      applyIndicators(rawCandles, { fib: showFib, pivot: showPivot, donch: showDonch, ichi: showIchi }, isSynthetic)
      setLoading(false)
    }).catch(() => setLoading(false))

    return () => { cancelled = true }
  }, [sym, tf, chartType, ready])

  // Re-apply indicators when toggles change
  useEffect(() => {
    if (!ready || dataRef.current.length === 0) return
    const isSynthetic = SYNTHETIC_TIME_TYPES.includes(chartType)
    applyIndicators(dataRef.current, { fib: showFib, pivot: showPivot, donch: showDonch, ichi: showIchi }, isSynthetic)
  }, [showFib, showPivot, showDonch, showIchi, ready])

  // Scroll active tab into view
  useEffect(() => {
    const c = tabsScrollRef.current
    if (!c) return
    const el = c.querySelector(`[data-sym="${sym}"]`) as HTMLElement | null
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [sym])

  const isUp = (quote?.dp ?? 0) >= 0
  const currentTz = tzLabel(sym)
  const isSyntheticType = SYNTHETIC_TIME_TYPES.includes(chartType)

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Row 1: Symbol tabs */}
      <div className="panel-header" style={{ justifyContent: 'space-between', gap: '4px', padding: '5px 10px', minHeight: '34px', flexWrap: 'nowrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, flex: 1 }}>
          <div className="dot" style={{ flexShrink: 0 }} />
          <div ref={tabsScrollRef} style={{ display: 'flex', gap: '3px', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none', flex: 1, paddingBottom: '1px' }}>
            {symbols.map(s => (
              <button key={s} data-sym={s} onClick={() => setSym(s)} style={{
                padding: '2px 7px', borderRadius: '3px', border: 'none', cursor: 'pointer',
                fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '11px',
                background: sym === s ? 'var(--amber)' : 'var(--bg-deep)',
                color:      sym === s ? '#000' : 'var(--text-2)',
                transition: 'all 0.12s', flexShrink: 0,
              }}>{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Row 2: Chart type + Timeframe + Indicators */}
      <div style={{ padding: '3px 10px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', background: 'rgba(0,0,0,0.2)' }}>
        {/* Chart types */}
        <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>TYPE</span>
        {(Object.entries(CHART_TYPES) as [ChartType, typeof CHART_TYPES[ChartType]][]).map(([key, meta]) => (
          <div key={key} style={{ position: 'relative' }}>
            <button
              onClick={() => setChartType(key)}
              onMouseEnter={() => setHoveredChartType(key)}
              onMouseLeave={() => setHoveredChartType(null)}
              style={{ ...mkBtn(chartType === key, 'blue'), fontSize: '10px' }}
            >
              {meta.icon} {meta.label}
            </button>
            {hoveredChartType === key && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 99, width: '220px',
                background: '#0d1117', border: '1px solid var(--border)', borderRadius: '6px',
                padding: '8px 10px', fontSize: '10px', color: 'var(--text-2)',
                fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5,
                boxShadow: '0 8px 24px rgba(0,0,0,0.8)',
              }}>
                <div style={{ color: '#1e90ff', fontWeight: 700, marginBottom: '3px' }}>{meta.label}</div>
                {meta.description}
                {meta.syntheticTime && (
                  <div style={{ marginTop: '6px', color: '#f0a500aa', fontSize: '9px' }}>
                    ⚠ Time axis = box index (not real time)
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />

        {/* Timeframes */}
        <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>TF</span>
        {(Object.entries(TF_CONFIGS) as [TF, typeof TF_CONFIGS[TF]][]).map(([key, cfg]) => (
          <button key={key} onClick={() => setTf(key)} title={cfg.description} style={{ ...mkBtn(tf === key, 'teal'), fontSize: '10px' }}>
            {cfg.label}
          </button>
        ))}

        <div style={{ width: '1px', height: '16px', background: 'var(--border)' }} />

        {/* Indicators */}
        <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>IND</span>
        {[
          { key: 'fib',   label: 'FIB',      state: showFib,   set: setShowFib,   col: 'amber' as const },
          { key: 'pivot', label: 'PIVOT',     state: showPivot, set: setShowPivot, col: 'purple' as const },
          { key: 'donch', label: 'DONCH',     state: showDonch, set: setShowDonch, col: 'amber' as const, syntheticDisabled: true },
          { key: 'ichi',  label: 'ICHIMOKU',  state: showIchi,  set: setShowIchi,  col: 'teal' as const, syntheticDisabled: true },
        ].map(ind => {
          const disabled = isSyntheticType && (ind as any).syntheticDisabled
          return (
            <button
              key={ind.key}
              onClick={() => !disabled && ind.set((v: boolean) => !v)}
              onMouseEnter={() => !disabled && setHoveredCtrl(ind.key)}
              onMouseLeave={() => setHoveredCtrl(null)}
              title={disabled ? 'Not available for this chart type' : undefined}
              style={{ ...mkBtn(ind.state && !disabled, ind.col), opacity: disabled ? 0.35 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
            >
              {ind.label}
            </button>
          )
        })}

        {/* Staleness + TZ */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          {isSyntheticType && (
            <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: '#f0a500aa', padding: '1px 6px', borderRadius: '2px', border: '1px solid #f0a50033' }}>
              ≡ PRICE-ONLY
            </span>
          )}
          {dataAge && !isSyntheticType && (
            <span style={{
              fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
              color: dataAge === 'Live' ? '#00c97a' : 'var(--text-muted)',
              padding: '1px 6px', borderRadius: '2px',
              background: dataAge === 'Live' ? 'rgba(0,201,122,0.1)' : 'transparent',
              border: dataAge === 'Live' ? '1px solid rgba(0,201,122,0.2)' : 'none',
            }}>
              {dataAge === 'Live' ? '● LIVE' : `⏱ ${dataAge}`}
            </span>
          )}
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {isSyntheticType ? 'PRICE-AXIS' : currentTz} · {candleCount} {chartType === 'pnf' ? 'boxes' : chartType === 'renko' ? 'bricks' : 'bars'}
          </span>
        </div>
      </div>

      {/* Indicator hover hint */}
      {hoveredCtrl && (
        <div style={{ padding: '3px 12px', background: 'rgba(0,0,0,0.3)', fontSize: '9px', color: 'var(--teal)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
          {hoveredCtrl === 'fib'   && 'Fibonacci Retracement: 23.6%, 38.2%, 50%, 61.8% — key support/resistance levels'}
          {hoveredCtrl === 'pivot' && 'Pivot Points: P=(H+L+C)/3, R1/R2 resistance above, S1/S2 support below'}
          {hoveredCtrl === 'donch' && 'Donchian Channels: 20-period high (blue) / low (red) — breakout & reversal zones'}
          {hoveredCtrl === 'ichi'  && 'Ichimoku: Tenkan (fast) / Kijun (slow) / Chikou (lagging) — trend, momentum, S/R'}
        </div>
      )}

      {/* Quote strip */}
      {quote && (
        <div style={{ padding: '4px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap', background: 'rgba(0,0,0,0.22)' }}>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '20px', color: '#fff', letterSpacing: '-0.02em' }}>
            {quote.c?.toFixed(2)}
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: isUp ? 'var(--positive)' : 'var(--negative)' }}>
            {isUp ? '+' : ''}{quote.d?.toFixed(2)}&nbsp;({isUp ? '+' : ''}{quote.dp?.toFixed(2)}%)
          </span>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>
            {sym} · {
              chartType === 'candle' ? 'Candlestick' :
              chartType === 'heikin' ? 'Heikin Ashi' :
              chartType === 'renko'  ? 'Renko (ATR×1.5)' :
              'Point & Figure (3-box)'
            } · scroll=zoom · drag axis=stretch
          </span>
        </div>
      )}

      {/* Chart area */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(9,12,16,0.8)' }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.12em' }}>
              LOADING {sym} · {TF_CONFIGS[tf].label}...
            </span>
          </div>
        )}

        {/* OHLC tooltip */}
        <div ref={tooltipRef} style={{
          position: 'absolute', top: '6px', left: '8px', zIndex: 8,
          fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
          opacity: 0, pointerEvents: 'none',
          background: 'rgba(9,12,16,0.9)', padding: '3px 10px',
          borderRadius: '3px', border: '1px solid var(--border)',
          transition: 'opacity 0.06s',
        }} />

        {/* Volume tooltip */}
        <div ref={volTooltipRef} style={{
          position: 'absolute', bottom: '22px', left: '8px', zIndex: 8,
          fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
          opacity: 0, pointerEvents: 'none',
          background: 'rgba(9,12,16,0.85)', padding: '2px 8px',
          borderRadius: '3px', border: '1px solid var(--border)',
          color: 'var(--text-2)', transition: 'opacity 0.06s',
        }} />

        {/* Vol pane label — only for real-time chart types */}
        {!isSyntheticType && (
          <div style={{ position: 'absolute', left: '8px', bottom: '8px', zIndex: 6, fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', pointerEvents: 'none' }}>
            VOL
          </div>
        )}

        {/* Separator line */}
        {!isSyntheticType && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: '16%', height: '1px', background: '#1e2d3d', zIndex: 5, pointerEvents: 'none' }} />
        )}

        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}