'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

// ── Indicator math ────────────────────────────────────────────────────────────

interface CandleData { time: number; open: number; high: number; low: number; close: number }

function calcSupertrend(candles: CandleData[], period = 10, multiplier = 2) {
  const result: { time: number; value: number; bull: boolean }[] = []
  if (candles.length < period) return result
  const atr: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const { high, low } = candles[i]
    const prevClose      = candles[i - 1].close
    const tr             = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    atr.push(i < period ? tr : (atr[atr.length - 1] * (period - 1) + tr) / period)
  }
  let supertrend = 0
  let direction  = 1
  for (let i = period; i < candles.length; i++) {
    const c   = candles[i]
    const a   = atr[i - 1]
    const hl2 = (c.high + c.low) / 2
    const up  = hl2 + multiplier * a
    const dn  = hl2 - multiplier * a
    const prev = supertrend || dn
    if (prev === dn) {
      supertrend = c.close < dn  ? up : Math.max(dn, prev)
      direction  = c.close < dn  ? -1 : 1
    } else {
      supertrend = c.close > up  ? dn : Math.min(up, prev)
      direction  = c.close > up  ? 1  : -1
    }
    result.push({ time: c.time, value: supertrend, bull: direction === 1 })
  }
  return result
}

function calcEMA(candles: CandleData[], period: number) {
  if (candles.length < period) return []
  const k   = 2 / (period + 1)
  const out: { time: number; value: number }[] = []
  let ema   = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period
  candles.forEach((c, i) => {
    if (i < period - 1) return
    if (i === period - 1) { out.push({ time: c.time, value: ema }); return }
    ema = c.close * k + ema * (1 - k)
    out.push({ time: c.time, value: ema })
  })
  return out
}

function calcFibLevels(candles: CandleData[]) {
  const recent = candles.slice(-60)
  const high   = Math.max(...recent.map(c => c.high))
  const low    = Math.min(...recent.map(c => c.low))
  const diff   = high - low
  return [
    { ratio: 0,     price: high,               label: 'Fib 0%'   },
    { ratio: 0.236, price: high - 0.236 * diff, label: 'Fib 23.6%' },
    { ratio: 0.382, price: high - 0.382 * diff, label: 'Fib 38.2%' },
    { ratio: 0.5,   price: high - 0.5   * diff, label: 'Fib 50%'  },
    { ratio: 0.618, price: high - 0.618 * diff, label: 'Fib 61.8%' },
    { ratio: 1,     price: low,                label: 'Fib 100%' },
  ]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['1D', '5D', '1M', '3M', '6M', '1Y'] as const
type TF = typeof TIMEFRAMES[number]

const TF_RANGE:    Record<TF, string> = { '1D': '1d',  '5D': '5d',  '1M': '1mo', '3M': '3mo', '6M': '6mo', '1Y': '1y' }
const TF_INTERVAL: Record<TF, string> = { '1D': '5m',  '5D': '15m', '1M': '1d',  '3M': '1d',  '6M': '1wk', '1Y': '1wk' }
const TF_LABEL:    Record<TF, string> = { '1D': '5min','5D': '15min','1M': 'Daily','3M':'Daily','6M':'Weekly','1Y':'Weekly' }

const FIB_COLORS: Record<string, string> = {
  'Fib 0%':    '#ffffff33',
  'Fib 23.6%': '#00e5c088',
  'Fib 38.2%': '#1e90ff88',
  'Fib 50%':   '#f0a50088',
  'Fib 61.8%': '#ff456088',
  'Fib 100%':  '#ffffff33',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ChartPanel() {
  // ── All hooks at the top — never inside callbacks or async functions ──────
  const { symbols: watchlistSymbols } = useWatchlist()

  const [selectedTf,  setSelectedTf]  = useState<TF>('1D')
  const [quoteData,   setQuoteData]   = useState<Record<string, number> | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [showFib,     setShowFib]     = useState(true)
  const [showST,      setShowST]      = useState(true)
  const [showEMA,     setShowEMA]     = useState(true)
  const [chartReady,  setChartReady]  = useState(false)

  // Derive symbols list from watchlist — fall back to defaults
  const symbols = watchlistSymbols.length > 0
    ? watchlistSymbols
    : ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT']

  const [selectedSymbol, setSelectedSymbol] = useState(symbols[0] || 'SPY')

  // Refs for chart objects — never cause re-renders
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<any>(null)
  const candleRef    = useRef<any>(null)
  const stBullRef    = useRef<any>(null)
  const stBearRef    = useRef<any>(null)
  const ema9Ref      = useRef<any>(null)
  const ema21Ref     = useRef<any>(null)
  const fibLinesRef  = useRef<any[]>([])
  const chartData    = useRef<CandleData[]>([])

  // Keep selectedSymbol valid when watchlist changes
  useEffect(() => {
    if (symbols.length > 0 && !symbols.includes(selectedSymbol)) {
      setSelectedSymbol(symbols[0])
    }
  }, [symbols.join(',')])

  // ── Fetch helpers — pure async functions, no hooks inside ─────────────────

  const fetchCandles = useCallback(async (symbol: string, tf: TF): Promise<CandleData[]> => {
    try {
      const res  = await fetch(`/api/yfinance?symbols=${symbol}&range=${TF_RANGE[tf]}&interval=${TF_INTERVAL[tf]}`)
      const json = await res.json()
      const result = json?.results?.[0]?.data?.chart?.result?.[0]
      if (!result) return []
      const ts   = result.timestamp  || []
      const ohlc = result.indicators?.quote?.[0]
      if (!ohlc) return []
      return ts
        .map((t: number, i: number) => ({
          time: t, open: ohlc.open[i], high: ohlc.high[i], low: ohlc.low[i], close: ohlc.close[i],
        }))
        .filter((c: CandleData) => c.open != null && c.high != null && c.low != null && c.close != null)
        .sort((a: CandleData, b: CandleData) => a.time - b.time)
    } catch { return [] }
  }, [])

  const fetchQuote = useCallback(async (symbol: string) => {
    try {
      const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
      const d   = await res.json()
      if (!d.rateLimited && d.c) setQuoteData(d)
    } catch {}
  }, [])

  // ── Apply indicators to chart — pure function using refs ──────────────────

  const applyIndicators = useCallback((candles: CandleData[], fib: boolean, st: boolean, ema: boolean) => {
    // Clear old fib lines
    fibLinesRef.current.forEach(l => { try { candleRef.current?.removePriceLine(l) } catch {} })
    fibLinesRef.current = []

    if (!candleRef.current) return

    if (fib && candles.length >= 2) {
      calcFibLevels(candles).forEach(f => {
        try {
          const line = candleRef.current.createPriceLine({
            price: f.price, color: FIB_COLORS[f.label] || '#ffffff44',
            lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: f.label,
          })
          fibLinesRef.current.push(line)
        } catch {}
      })
    }

    if (stBullRef.current && stBearRef.current) {
      if (st && candles.length > 10) {
        const stData = calcSupertrend(candles)
        stBullRef.current.setData(stData.filter(s =>  s.bull).map(s => ({ time: s.time, value: s.value })))
        stBearRef.current.setData(stData.filter(s => !s.bull).map(s => ({ time: s.time, value: s.value })))
      } else {
        stBullRef.current.setData([])
        stBearRef.current.setData([])
      }
    }

    if (ema9Ref.current && ema21Ref.current) {
      if (ema && candles.length > 21) {
        ema9Ref.current.setData(calcEMA(candles, 9))
        ema21Ref.current.setData(calcEMA(candles, 21))
      } else {
        ema9Ref.current.setData([])
        ema21Ref.current.setData([])
      }
    }
  }, [])

  // ── Chart initialisation — runs once on mount ─────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return
    let destroyed = false

    const initChart = async () => {
      try {
        const LWC = await import('lightweight-charts')
        if (destroyed || !containerRef.current) return

        const chart = LWC.createChart(containerRef.current, {
          width:  containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
          layout: { background: { color: 'transparent' }, textColor: '#7a9ab0' },
          grid: {
            vertLines: { color: '#1e2d3d', style: 1 },
            horzLines: { color: '#1e2d3d', style: 1 },
          },
          crosshair: {
            mode: 1,
            vertLine: { color: '#f0a500', labelBackgroundColor: '#f0a500' },
            horzLine: { color: '#f0a500', labelBackgroundColor: '#f0a500' },
          },
          rightPriceScale: {
            borderColor: '#1e2d3d', textColor: '#7a9ab0',
            scaleMargins: { top: 0.1, bottom: 0.1 },
          },
          timeScale: {
            borderColor: '#1e2d3d',
            timeVisible: true, secondsVisible: false,
          },
          handleScroll: { mouseWheel: true, pressedMouseMove: true },
          handleScale:  { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
        })

        const candles = chart.addCandlestickSeries({
          upColor: '#00c97a', downColor: '#ff4560',
          borderUpColor: '#00c97a', borderDownColor: '#ff4560',
          wickUpColor: '#00c97a', wickDownColor: '#ff4560',
        })
        const stBull = chart.addLineSeries({ color: '#00c97a', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
        const stBear = chart.addLineSeries({ color: '#ff4560', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
        const ema9   = chart.addLineSeries({ color: '#f0a500', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
        const ema21  = chart.addLineSeries({ color: '#1e90ff', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })

        chartRef.current   = chart
        candleRef.current  = candles
        stBullRef.current  = stBull
        stBearRef.current  = stBear
        ema9Ref.current    = ema9
        ema21Ref.current   = ema21

        const ro = new ResizeObserver(() => {
          if (containerRef.current && chartRef.current) {
            chartRef.current.applyOptions({
              width:  containerRef.current.clientWidth,
              height: containerRef.current.clientHeight,
            })
          }
        })
        ro.observe(containerRef.current)

        if (!destroyed) setChartReady(true)
      } catch (err) {
        console.error('[ChartPanel] init error:', err)
      }
    }

    initChart()

    return () => {
      destroyed = true
      try { chartRef.current?.remove() } catch {}
      chartRef.current  = null
      candleRef.current = null
      stBullRef.current = null
      stBearRef.current = null
      ema9Ref.current   = null
      ema21Ref.current  = null
      setChartReady(false)
    }
  }, []) // runs exactly once

  // ── Load data when symbol/timeframe changes (after chart is ready) ─────────

  useEffect(() => {
    if (!chartReady || !candleRef.current || !chartRef.current) return
    let cancelled = false

    setLoading(true)
    Promise.all([
      fetchCandles(selectedSymbol, selectedTf),
      fetchQuote(selectedSymbol),
    ]).then(([candles]) => {
      if (cancelled || !candleRef.current || !chartRef.current) return
      if (candles.length > 0) {
        candleRef.current.setData(candles)
        chartRef.current.timeScale().fitContent()
        chartData.current = candles
        applyIndicators(candles, showFib, showST, showEMA)
      }
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [selectedSymbol, selectedTf, chartReady])

  // ── Re-apply indicators when toggles change ───────────────────────────────

  useEffect(() => {
    if (!chartReady || chartData.current.length === 0) return
    applyIndicators(chartData.current, showFib, showST, showEMA)
  }, [showFib, showST, showEMA, chartReady])

  // ── Derived display values ────────────────────────────────────────────────

  const isPositive  = (quoteData?.dp ?? 0) >= 0
  const displaySyms = symbols.slice(0, 10) // cap at 10 buttons

  const indToggles = [
    { key: 'fib', label: 'FIB',     active: showFib,  toggle: () => setShowFib(v => !v)  },
    { key: 'st',  label: 'ST(10,2)',active: showST,   toggle: () => setShowST(v => !v)   },
    { key: 'ema', label: 'EMA 9/21',active: showEMA,  toggle: () => setShowEMA(v => !v)  },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Symbol + indicator row */}
      <div className="panel-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', minHeight: '36px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <div className="dot" />
          {displaySyms.map(s => (
            <button key={s} onClick={() => setSelectedSymbol(s)} style={{
              padding: '2px 7px', borderRadius: '3px', border: 'none', cursor: 'pointer',
              fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '11px', letterSpacing: '0.04em',
              background: selectedSymbol === s ? 'var(--amber)' : 'var(--bg-deep)',
              color:      selectedSymbol === s ? '#000' : 'var(--text-2)',
              transition: 'all 0.15s',
            }}>
              {s}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => setSelectedTf(tf)} style={{
              padding: '2px 7px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
              border: `1px solid ${selectedTf === tf ? 'var(--teal)' : 'var(--border)'}`,
              background: selectedTf === tf ? 'rgba(0,229,192,0.1)' : 'transparent',
              color:      selectedTf === tf ? 'var(--teal)' : 'var(--text-2)',
              transition: 'all 0.15s',
            }}>{tf}</button>
          ))}
          <div style={{ width: '1px', height: '14px', background: 'var(--border)', margin: '0 2px' }} />
          {indToggles.map(ind => (
            <button key={ind.key} onClick={ind.toggle} style={{
              padding: '2px 7px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
              border: `1px solid ${ind.active ? 'var(--amber)' : 'var(--border)'}`,
              background: ind.active ? 'rgba(240,165,0,0.1)' : 'transparent',
              color:      ind.active ? 'var(--amber)' : 'var(--text-muted)',
              transition: 'all 0.15s',
            }}>{ind.label}</button>
          ))}
        </div>
      </div>

      {/* Quote strip */}
      {quoteData && (
        <div style={{
          padding: '6px 14px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap',
        }}>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '22px', color: '#fff', letterSpacing: '-0.02em' }}>
            ${quoteData.c?.toFixed(2)}
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: isPositive ? 'var(--positive)' : 'var(--negative)' }}>
            {isPositive ? '+' : ''}{quoteData.d?.toFixed(2)} ({isPositive ? '+' : ''}{quoteData.dp?.toFixed(2)}%)
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>
            {selectedSymbol} · {TF_LABEL[selectedTf]} candles · scroll to zoom · drag price axis to stretch
          </span>
        </div>
      )}

      {/* Chart container */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(9,12,16,0.6)',
          }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
              LOADING {selectedSymbol}...
            </span>
          </div>
        )}
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}