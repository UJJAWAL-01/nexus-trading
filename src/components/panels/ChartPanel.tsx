'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

const SYMBOLS = ['SPY', 'QQQ', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META']
const TIMEFRAMES = ['1D', '5D', '1M', '3M', '6M', '1Y']

interface CandleData {
  time: number
  open: number
  high: number
  low: number
  close: number
}

function calcSupertrend(candles: CandleData[], period = 10, multiplier = 2) {
  const result: { time: number; value: number; bull: boolean }[] = []
  if (candles.length < period) return result

  const atr: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high, low = candles[i].low, prevClose = candles[i - 1].close
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose))
    atr.push(i < period ? tr : (atr[atr.length - 1] * (period - 1) + tr) / period)
  }

  let supertrend = 0, direction = 1
  for (let i = period; i < candles.length; i++) {
    const c = candles[i], a = atr[i - 1]
    const hl2 = (c.high + c.low) / 2
    const upperBand = hl2 + multiplier * a
    const lowerBand = hl2 - multiplier * a
    const prevST = supertrend || lowerBand
    if (prevST === lowerBand) {
      supertrend = c.close < lowerBand ? upperBand : Math.max(lowerBand, prevST)
      direction = c.close < lowerBand ? -1 : 1
    } else {
      supertrend = c.close > upperBand ? lowerBand : Math.min(upperBand, prevST)
      direction = c.close > upperBand ? 1 : -1
    }
    result.push({ time: c.time, value: supertrend, bull: direction === 1 })
  }
  return result
}


function calcEMA(candles: CandleData[], period: number): { time: number; value: number }[] {
  if (candles.length < period) return []
  const k   = 2 / (period + 1)
  const out: { time: number; value: number }[] = []
  let ema = candles.slice(0, period).reduce((s, c) => s + c.close, 0) / period
  candles.forEach((c, i) => {
    if (i < period - 1) return
    if (i === period - 1) { out.push({ time: c.time, value: ema }); return }
    ema = c.close * k + ema * (1 - k)
    out.push({ time: c.time, value: ema })
  })
  return out
}

function calcFibLevels(candles: CandleData[]) {
  if (candles.length < 2) return []
  const recent = candles.slice(-60)
  const high = Math.max(...recent.map(c => c.high))
  const low  = Math.min(...recent.map(c => c.low))
  const diff = high - low
  return [
    { ratio: 0,     price: high,               label: 'Fib 0%' },
    { ratio: 0.236, price: high - 0.236 * diff, label: 'Fib 23.6%' },
    { ratio: 0.382, price: high - 0.382 * diff, label: 'Fib 38.2%' },
    { ratio: 0.5,   price: high - 0.5   * diff, label: 'Fib 50%' },
    { ratio: 0.618, price: high - 0.618 * diff, label: 'Fib 61.8%' },
    { ratio: 1,     price: low,                label: 'Fib 100%' },
  ]
}

export default function ChartPanel() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef    = useRef<any>(null)
  const candleRef   = useRef<any>(null)
  const stBullRef   = useRef<any>(null)
  const stBearRef   = useRef<any>(null)
  const fibLinesRef = useRef<any[]>([])
  const ema9Ref     = useRef<any>(null)
  const ema21Ref    = useRef<any>(null)
  const volumeRef   = useRef<any>(null)

  const [selectedSymbol, setSelectedSymbol] = useState('SPY')
  const [selectedTf, setSelectedTf]         = useState('1D')
  const [quoteData,  setQuoteData]           = useState<any>(null)
  const [loading,    setLoading]             = useState(true)
  const [showFib,    setShowFib]             = useState(true)
  const [showST,     setShowST]             = useState(true)
  const [showEMA,    setShowEMA]    = useState(true)

  const tfToRange:    Record<string, string> = { '1D':'1d','5D':'5d','1M':'1mo','3M':'3mo','6M':'6mo','1Y':'1y' }
  const tfToInterval: Record<string, string> = { '1D':'5m','5D':'15m','1M':'1d','3M':'1d','6M':'1wk','1Y':'1wk' }
  const tfLabel:      Record<string, string> = { '1D':'5min','5D':'15min','1M':'Daily','3M':'Daily','6M':'Weekly','1Y':'Weekly' }

  const fetchChartData = useCallback(async (symbol: string, tf: string) => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/yfinance?symbols=${symbol}&range=${tfToRange[tf]}&interval=${tfToInterval[tf]}`
      )
      const json = await res.json()
      const result = json?.results?.[0]?.data?.chart?.result?.[0]
      if (!result) return []
      const timestamps = result.timestamp || []
      const ohlcv = result.indicators?.quote?.[0]
      if (!ohlcv) return []
      return timestamps
        .map((t: number, i: number) => ({
          time: t, open: ohlcv.open[i], high: ohlcv.high[i],
          low: ohlcv.low[i], close: ohlcv.close[i],
        }))
        .filter((c: CandleData) => c.open != null && c.high != null && c.low != null && c.close != null)
        .sort((a: CandleData, b: CandleData) => a.time - b.time)
    } catch { return [] }
    finally { setLoading(false) }
  }, [])

  const fetchQuote = useCallback(async (symbol: string) => {
    try {
      const res = await fetch(`/api/finnhub?endpoint=quote&symbol=${symbol}`)
      const d = await res.json()
      if (!d.rateLimited && d.c) setQuoteData(d)
    } catch {}
  }, [])

  const applyIndicators = useCallback((candles: CandleData[]) => {
  if (!chartRef.current) return

  // Clear fib lines
  fibLinesRef.current.forEach(l => { try { candleRef.current.removePriceLine(l) } catch {} })
  fibLinesRef.current = []

  // Fibonacci
  if (showFib && candleRef.current) {
    const fibs = calcFibLevels(candles)
    const fibColors: Record<string, string> = {
      'Fib 0%': '#ffffff33', 'Fib 23.6%': '#00e5c088', 'Fib 38.2%': '#1e90ff88',
      'Fib 50%': '#f0a50088', 'Fib 61.8%': '#ff456088', 'Fib 100%': '#ffffff33',
    }
    fibs.forEach(f => {
      const line = candleRef.current.createPriceLine({
        price: f.price, color: fibColors[f.label] || '#ffffff44',
        lineWidth: 1, lineStyle: 2,
        axisLabelVisible: true, title: f.label,
      })
      fibLinesRef.current.push(line)
    })
  }

  // Supertrend
  if (stBullRef.current && stBearRef.current) {
    if (showST) {
      const st   = calcSupertrend(candles)
      stBullRef.current.setData(st.filter(s =>  s.bull).map(s => ({ time: s.time, value: s.value })))
      stBearRef.current.setData(st.filter(s => !s.bull).map(s => ({ time: s.time, value: s.value })))
    } else {
      stBullRef.current.setData([])
      stBearRef.current.setData([])
    }
  }

  // EMAs
  if (ema9Ref.current && ema21Ref.current) {
    if (showEMA) {
      ema9Ref.current.setData(calcEMA(candles, 9))
      ema21Ref.current.setData(calcEMA(candles, 21))
    } else {
      ema9Ref.current.setData([])
      ema21Ref.current.setData([])
    }
  }

  // Volume
  if (volumeRef.current) {
    const volData = candles.map(c => ({
      time:  c.time,
      value: 0, // Yahoo free doesn't give volume in this endpoint — placeholder
      color: c.close >= c.open ? 'rgba(0,201,122,0.4)' : 'rgba(255,69,96,0.4)',
    }))
    // Only set if we have actual volume — skip silently
  }
}, [showFib, showST, showEMA])

  // Init chart once
  useEffect(() => {
    if (!chartContainerRef.current) return
    let chart: any

    const init = async () => {
      const LWC = await import('lightweight-charts')
      chart = LWC.createChart(chartContainerRef.current!, {
        width:  chartContainerRef.current!.clientWidth,
        height: chartContainerRef.current!.clientHeight,
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
        timeScale: { borderColor: '#1e2d3d', timeVisible: true, secondsVisible: false },
        // ← vertical zoom enabled via mouse/touch
        handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
        handleScale:  { axisPressedMouseMove: { time: true, price: true }, mouseWheel: true, pinch: true },
      })

      const candles = chart.addCandlestickSeries({
        upColor: '#00c97a', downColor: '#ff4560',
        borderUpColor: '#00c97a', borderDownColor: '#ff4560',
        wickUpColor: '#00c97a', wickDownColor: '#ff4560',
      })
      const stBull = chart.addLineSeries({ color: '#00c97a', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })
      const stBear = chart.addLineSeries({ color: '#ff4560', lineWidth: 2, lastValueVisible: false, priceLineVisible: false })

      chartRef.current  = chart
      candleRef.current = candles
      stBullRef.current = stBull
      stBearRef.current = stBear

      const ro = new ResizeObserver(() => {
        if (chartContainerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width:  chartContainerRef.current.clientWidth,
            height: chartContainerRef.current.clientHeight,
          })
        }
      })
      ro.observe(chartContainerRef.current!)

      const data = await fetchChartData('SPY', '1D')
      if (data.length > 0) {
        candles.setData(data)
        chart.timeScale().fitContent()
        applyIndicators(data)
      }
      fetchQuote('SPY')
      // Volume series — separate price scale at bottom
const volume = chart.addHistogramSeries({
  color: '#26a69a',
  priceFormat: { type: 'volume' },
  priceScaleId: 'volume',
  scaleMargins: { top: 0.85, bottom: 0 },
})
chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } })

// EMA lines
const ema9  = chart.addLineSeries({ color: '#f0a500', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })
const ema21 = chart.addLineSeries({ color: '#1e90ff', lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false })

volumeRef.current = volume
ema9Ref.current   = ema9
ema21Ref.current  = ema21
    }

    init()
    return () => { chartRef.current?.remove(); chartRef.current = null; candleRef.current = null }
  }, [])

  // Reload on symbol/tf change
  useEffect(() => {
    if (!candleRef.current || !chartRef.current) return
    fetchChartData(selectedSymbol, selectedTf).then(data => {
      if (data.length > 0) {
        candleRef.current.setData(data)
        chartRef.current.timeScale().fitContent()
        applyIndicators(data)
      }
    })
    fetchQuote(selectedSymbol)
  }, [selectedSymbol, selectedTf])

  // Re-apply indicators when toggles change
  useEffect(() => {
    if (!candleRef.current) return
    fetchChartData(selectedSymbol, selectedTf).then(data => {
      if (data.length > 0) applyIndicators(data)
    })
  }, [showFib, showST])

  const isPositive = (quoteData?.dp ?? 0) >= 0

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Symbol row */}
      <div className="panel-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" />
          {SYMBOLS.map(s => (
            <button key={s} onClick={() => setSelectedSymbol(s)} style={{
              padding: '2px 8px', borderRadius: '3px', border: 'none', cursor: 'pointer',
              fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '11px', letterSpacing: '0.05em',
              background: selectedSymbol === s ? 'var(--amber)' : 'var(--bg-deep)',
              color:      selectedSymbol === s ? '#000' : 'var(--text-2)',
              transition: 'all 0.15s',
            }}>{s}</button>
          ))}
        </div>
        {/* Timeframe + indicator toggles */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {TIMEFRAMES.map(tf => (
            <button key={tf} onClick={() => setSelectedTf(tf)} style={{
              padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
              border: `1px solid ${selectedTf === tf ? 'var(--teal)' : 'var(--border)'}`,
              background: selectedTf === tf ? 'rgba(0,229,192,0.1)' : 'transparent',
              color:      selectedTf === tf ? 'var(--teal)' : 'var(--text-2)',
              transition: 'all 0.15s',
            }}>{tf}</button>
          ))}
          <div style={{ width: '1px', height: '14px', background: 'var(--border)', margin: '0 4px' }} />
          {/* Indicator toggles */}
          {[
            { key: 'fib', label: 'FIB', active: showFib, toggle: () => setShowFib(v => !v) },
            { key: 'st',  label: 'ST(10,2)', active: showST,  toggle: () => setShowST(v => !v) },
            { key: 'ema', label: 'EMA 9/21', active: showEMA, toggle: () => setShowEMA(v => !v) },
          ].map(ind => (
            <button key={ind.key} onClick={ind.toggle} style={{
              padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
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
          display: 'flex', alignItems: 'baseline', gap: '16px',
        }}>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '22px', color: '#fff', letterSpacing: '-0.02em' }}>
            ${quoteData.c?.toFixed(2)}
          </span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', color: isPositive ? 'var(--positive)' : 'var(--negative)' }}>
            {isPositive ? '+' : ''}{quoteData.d?.toFixed(2)} ({isPositive ? '+' : ''}{quoteData.dp?.toFixed(2)}%)
          </span>
          <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>
            {selectedSymbol} · {tfLabel[selectedTf]} candles · scroll=zoom · drag price axis=vertical zoom
          </span>
        </div>
      )}

      {/* Chart */}
      <div style={{ flex: 1, position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
              LOADING {selectedSymbol}...
            </span>
          </div>
        )}
        <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  )
}