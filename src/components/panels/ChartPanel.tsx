'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

// ─────────────────────────────────────────────────────────────────────────────
// Pure math helpers — no hooks, no side-effects
// ─────────────────────────────────────────────────────────────────────────────

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

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

// ── Pivot Point calculation ──────────────────────────────────────────────────────
function pivotLevels(candles: Candle[]) {
  const lastCandle = candles[candles.length - 1]
  const h = lastCandle.high, l = lastCandle.low, c = lastCandle.close
  const p = (h + l + c) / 3
  const r1 = 2 * p - l, r2 = p + (h - l)
  const s1 = 2 * p - h, s2 = p - (h - l)
  return {
    pivot: p,
    r1: r1, r2: r2,
    s1: s1, s2: s2,
  }
}

// ── Donchian Channels ────────────────────────────────────────────────────────────
function donchianChannels(candles: Candle[], period = 20) {
  const out: { time: number; high: number; low: number; mid: number }[] = []
  if (candles.length < period) return out
  for (let i = period - 1; i < candles.length; i++) {
    const slice = candles.slice(i - period + 1, i + 1)
    const high = Math.max(...slice.map(c => c.high))
    const low = Math.min(...slice.map(c => c.low))
    out.push({ time: candles[i].time, high, low, mid: (high + low) / 2 })
  }
  return out
}

// ── Ichimoku Cloud ──────────────────────────────────────────────────────────────
function ichimokuCloud(candles: Candle[]) {
  if (candles.length < 52) return { tenkan: [], kijun: [], chikou: [] }

  const tenkan: any[] = [], kijun: any[] = [], chikou: any[] = []

  for (let i = 8; i < candles.length; i++) {
    const h9 = Math.max(...candles.slice(i - 8, i + 1).map(c => c.high))
    const l9 = Math.min(...candles.slice(i - 8, i + 1).map(c => c.low))
    tenkan.push({ time: candles[i].time, value: (h9 + l9) / 2 })
  }

  for (let i = 25; i < candles.length; i++) {
    const h26 = Math.max(...candles.slice(i - 25, i + 1).map(c => c.high))
    const l26 = Math.min(...candles.slice(i - 25, i + 1).map(c => c.low))
    kijun.push({ time: candles[i].time, value: (h26 + l26) / 2 })
  }

  for (let i = 25; i < candles.length; i++) {
    if (i >= 26) chikou.push({ time: candles[i - 26].time, value: candles[i].close })
  }

  return { tenkan, kijun, chikou }
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TFS = ['1D'] as const
type TF = typeof TFS[number]

const TF_CFG: Record<TF,{range:string;interval:string;label:string}> = {
  '1D':{ range:'1d',  interval:'15m',  label:'15min'   },
}

const PANES = {
  main:   { top:0.02, bottom:0.15 },
  volume: { top:0.85, bottom:0.10 },
}
const SEP_LINES   = [85] as const
const PANE_LABELS = { vol:86 }

function mkBtn(active:boolean, col:'amber'|'purple'|'teal'='amber'):React.CSSProperties {
  const C = { amber:['var(--amber)','rgba(240,165,0,0.12)'], purple:['#a78bfa','rgba(167,139,250,0.12)'], teal:['var(--teal)','rgba(0,229,192,0.12)'] }[col]
  return {
    padding:'2px 8px', borderRadius:'3px', cursor:'pointer', whiteSpace:'nowrap',
    fontFamily:'JetBrains Mono, monospace', fontSize:'10px', letterSpacing:'0.06em',
    border:     `1px solid ${active?C[0]:'var(--border)'}`,
    background: active?C[1]:'transparent',
    color:      active?C[0]:'var(--text-muted)',
    transition: 'all 0.12s', flexShrink:0,
  }
}

// ── ChartPanel ─────────────────────────────────────────────────────────────────

export default function ChartPanel() {

  // ── 1. Store hooks ─────────────────────────────────────────────────────────
  const { symbols: wl } = useWatchlist()
  const symbols = wl.length > 0 ? wl : ['SPY','QQQ','AAPL','NVDA','TSLA','MSFT']

  // ── 2. State ───────────────────────────────────────────────────────────────
  const [sym,       setSym]       = useState(() => symbols[0] ?? 'SPY')
  const [quote,     setQuote]     = useState<Record<string,number>|null>(null)
  const [loading,   setLoading]   = useState(true)
  const [ready,     setReady]     = useState(false)
  const [showFib,   setShowFib]   = useState(true)
  const [showPivot, setShowPivot] = useState(true)
  const [showDonch, setShowDonch] = useState(true)
  const [showIchi,  setShowIchi]  = useState(true)
  const [hoveredInd, setHoveredInd] = useState<string | null>(null)
  const [volHeight, setVolHeight] = useState(1.0)
  const [volWidth,  setVolWidth]  = useState(1.0)
  const [hoveredVol, setHoveredVol] = useState<{value: number; time: string} | null>(null)

  // ── 3. DOM refs ────────────────────────────────────────────────────────────
  const containerRef  = useRef<HTMLDivElement>(null)
  const tooltipRef    = useRef<HTMLDivElement>(null)
  const rsiLblRef     = useRef<HTMLSpanElement>(null)
  const macdLblRef    = useRef<HTMLSpanElement>(null)
  const tabsScrollRef = useRef<HTMLDivElement>(null)

  // ── 4. Chart object refs ───────────────────────────────────────────────────
  const chartR      = useRef<any>(null)
  const candleR     = useRef<any>(null)
  const volumeR     = useRef<any>(null)
  const fibRef      = useRef<any[]>([])
  const pivotLinesR = useRef<any[]>([])
  const donchUpR    = useRef<any>(null)
  const donchDnR    = useRef<any>(null)
  const donchMidR   = useRef<any>(null)
  const ichiTenkanR = useRef<any>(null)
  const ichiKijunR  = useRef<any>(null)
  const ichiChikouR = useRef<any>(null)
  const dataRef     = useRef<Candle[]>([])

  // ── 5. Sync selected symbol when watchlist changes ─────────────────────────
  useEffect(() => {
    if (symbols.length > 0 && !symbols.includes(sym)) setSym(symbols[0])
  }, [symbols.join(',')]) // eslint-disable-line

  // ── 6. Fetch helpers ───────────────────────────────────────────────────────

  const getCandles = useCallback(async (s:string): Promise<Candle[]> => {
    try {
      const r = await fetch(`/api/yfinance?symbols=${encodeURIComponent(s)}&range=1d&interval=15m`)
      const j = await r.json()
      const res = j?.results?.[0]?.data?.chart?.result?.[0]
      if (!res) return []
      const ts=res.timestamp??[], q=res.indicators?.quote?.[0]
      if (!q) return []
      return (ts as number[])
        .map((time,i) => ({ time, open:q.open?.[i]??null, high:q.high?.[i]??null, low:q.low?.[i]??null, close:q.close?.[i]??null, volume:q.volume?.[i]??0 }))
        .filter((c): c is Candle => c.open!==null&&c.high!==null&&c.low!==null&&c.close!==null)
        .sort((a,b)=>a.time-b.time)
    } catch { return [] }
  }, [])

  const getQuote = useCallback(async (s:string) => {
    try {
      // Use globalquote for all symbols (handles Indian, crypto, etc.)
      const r = await fetch(`/api/globalquote?symbol=${encodeURIComponent(s)}`)
      const d = await r.json()
      if (d.price!=null) {
        setQuote({
          c:  d.price,
          d:  d.change   ?? 0,
          dp: d.changePercent ?? 0,
          h:  d.high     ?? 0,
          l:  d.low      ?? 0,
          pc: d.prevClose ?? 0,
        })
      }
    } catch {}
  }, [])

  // ── 7. Apply indicators ────────────────────────────────────────────────────

  const applyAll = useCallback((
    candles: Candle[],
    flags: { fib:boolean; pivot:boolean; donch:boolean; ichi:boolean },
  ) => {
    if (!candleR.current) return

    // Volume
    volumeR.current?.setData(candles.map(c=>({
      time:c.time, value:c.volume,
      color: c.close>=c.open?'rgba(0,201,122,0.45)':'rgba(255,69,96,0.45)',
    })))

    // Fibonacci
    fibRef.current.forEach(l=>{ try{ candleR.current?.removePriceLine(l) }catch{} })
    fibRef.current=[]
    if (flags.fib && candles.length>=2) {
      fibLevels(candles).forEach(f=>{
        try{ fibRef.current.push(candleR.current.createPriceLine({ price:f.price, color:f.color, lineWidth:1, lineStyle:2, axisLabelVisible:true, title:f.label })) }catch{}
      })
    }

    // Pivot levels
    pivotLinesR.current.forEach(l=>{ try{ candleR.current?.removePriceLine(l) }catch{} })
    pivotLinesR.current=[]
    if (flags.pivot && candles.length>=2) {
      const piv = pivotLevels(candles)
      try {
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.pivot, color:'#f0a50080', lineWidth:2, lineStyle:0, axisLabelVisible:true, title:'Pivot' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.r1, color:'#00c97a99', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'R1' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.r2, color:'#00c97a66', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'R2' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.s1, color:'#ff456099', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'S1' }))
        pivotLinesR.current.push(candleR.current.createPriceLine({ price:piv.s2, color:'#ff456066', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'S2' }))
      } catch{}
    }

    // Donchian Channels
    if (flags.donch && candles.length>=20) {
      const donch = donchianChannels(candles)
      donchUpR.current?.setData(donch.map(d=>({ time:d.time, value:d.high })))
      donchDnR.current?.setData(donch.map(d=>({ time:d.time, value:d.low })))
      donchMidR.current?.setData(donch.map(d=>({ time:d.time, value:d.mid })))
    } else {
      donchUpR.current?.setData([])
      donchDnR.current?.setData([])
      donchMidR.current?.setData([])
    }

    // Ichimoku
    if (flags.ichi && candles.length>=52) {
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

  // ── 8. Chart init — runs once ──────────────────────────────────────────────

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
        chart.priceScale('right').applyOptions({ scaleMargins:PANES.main })

        const volume = chart.addHistogramSeries({
          priceScaleId:'vol', color:'rgba(0,201,122,0.4)',
          priceFormat:{ type:'volume' }, lastValueVisible:false, priceLineVisible:false,
        })
        chart.priceScale('vol').applyOptions({ scaleMargins:PANES.volume })

        const shared = { lastValueVisible:false, priceLineVisible:false, crosshairMarkerVisible:false }
        // Enhanced indicators with better visibility
        const donchUp   = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'#1e90ff', lineWidth:2 })
        const donchDn   = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'#ff6b6b', lineWidth:2 })
        const donchMid  = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'rgba(160,160,160,0.5)', lineWidth:1, lineStyle:3 })

        const ichiTenkan = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'#00e5c0', lineWidth:2.5 })
        const ichiKijun  = chart.addLineSeries({ ...shared, priceScaleId:'right', color:'#ff4560', lineWidth:2.5 })
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
          if (!param.time || !param.point) {
            if (tooltipRef.current) tooltipRef.current.style.opacity='0'
            return
          }
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
          const rd = param.seriesData.get(ichiTenkan) as any
          if (rd!=null && rsiLblRef.current) {
            const v = typeof rd==='object'?rd.value:rd
            rsiLblRef.current.innerHTML=`<span style="color:#4a6070">Ichimoku TK&nbsp;</span><b style="color:#00c97a">${(+v).toFixed(2)}</b>`
          }
        })

        if (!dead) setReady(true)
      } catch (err) { console.error('[ChartPanel] init error:', err) }
    })()

    return () => {
      dead=true
      try{ chartR.current?.remove() }catch{}
      chartR.current=candleR.current=volumeR.current=null
      donchUpR.current=donchDnR.current=donchMidR.current=null
      ichiTenkanR.current=ichiKijunR.current=ichiChikouR.current=null
      setReady(false)
    }
  }, [])

  // ── 9. Load data when symbol/tf changes ───────────────────────────────────

  useEffect(() => {
    if (!ready) return
    let cancelled=false
    setLoading(true)
    Promise.all([getCandles(sym), getQuote(sym)]).then(([candles]) => {
      if (cancelled||!candleR.current) return
      if (candles.length>0) {
        candleR.current.setData(candles)
        chartR.current?.timeScale().fitContent()
        dataRef.current=candles
        applyAll(candles, { fib:showFib, pivot:showPivot, donch:showDonch, ichi:showIchi })
      }
      setLoading(false)
    }).catch(()=>setLoading(false))
    return ()=>{ cancelled=true }
  }, [sym, ready]) // eslint-disable-line

  // ── 10. Indicator toggle re-apply ─────────────────────────────────────────

  useEffect(() => {
    if (!ready||dataRef.current.length===0) return
    applyAll(dataRef.current, { fib:showFib, pivot:showPivot, donch:showDonch, ichi:showIchi })
  }, [showFib,showPivot,showDonch,showIchi,ready] // eslint-disable-line
  )

  // ── Scroll tab into view when sym changes ─────────────────────────────────

  useEffect(() => {
    const container = tabsScrollRef.current
    if (!container) return
    const active = container.querySelector(`[data-sym="${sym}"]`) as HTMLElement | null
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [sym])

  // ── Render ─────────────────────────────────────────────────────────────────

  const isUp = (quote?.dp ?? 0) >= 0

  return (
    <div className="panel" style={{ height:'100%', display:'flex', flexDirection:'column' }}>

      {/* ── Row 1: Symbols (scrollable) + Timeframes ─────────────────────── */}
      <div className="panel-header" style={{
        justifyContent:'space-between', gap:'4px',
        padding:'5px 10px', minHeight:'34px', flexWrap:'nowrap',
      }}>

        {/* Symbol tabs — horizontally scrollable, shows ALL watchlist stocks */}
        <div style={{ display:'flex', alignItems:'center', gap:'4px', minWidth:0, flex:1 }}>
          <div className="dot" style={{ flexShrink:0 }} />
          <div
            ref={tabsScrollRef}
            style={{
              display:'flex', gap:'3px',
              overflowX:'auto', overflowY:'hidden',
              scrollbarWidth:'none', // Firefox
              msOverflowStyle:'none', // IE
              flex:1,
              paddingBottom:'1px', // prevent clip on bottom
            }}
          >
            <style>{`.nexus-tabs-scroll::-webkit-scrollbar{ display:none; }`}</style>
            {symbols.map(s => (
              <button
                key={s}
                data-sym={s}
                onClick={() => setSym(s)}
                style={{
                  padding:'2px 7px', borderRadius:'3px', border:'none', cursor:'pointer',
                  fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:'11px',
                  background: sym===s ? 'var(--amber)' : 'var(--bg-deep)',
                  color:      sym===s ? '#000' : 'var(--text-2)',
                  transition:'all 0.12s', flexShrink:0,
                }}
              >{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Row 2: Indicator toggles ───────────────────────────────────── */}
      <div style={{
        padding:'3px 10px', borderBottom:'1px solid var(--border)',
        display:'flex', alignItems:'center', gap:'4px', flexWrap:'wrap',
        background:'rgba(0,0,0,0.18)',
      }}>
        <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', letterSpacing:'0.1em' }}>IND</span>
        <button
          onMouseEnter={() => setHoveredInd('fib')}
          onMouseLeave={() => setHoveredInd(null)}
          onClick={()=>setShowFib(v=>!v)}
          style={mkBtn(showFib)}
          title="Fibonacci Retracement Levels - Support/Resistance at 23.6%, 38.2%, 50%, 61.8%"
        >FIB</button>
        <button
          onMouseEnter={() => setHoveredInd('pivot')}
          onMouseLeave={() => setHoveredInd(null)}
          onClick={()=>setShowPivot(v=>!v)}
          style={mkBtn(showPivot,'purple')}
          title="Pivot Points with Support/Resistance Levels - Key price reversal zones"
        >PIVOT</button>
        <button
          onMouseEnter={() => setHoveredInd('donch')}
          onMouseLeave={() => setHoveredInd(null)}
          onClick={()=>setShowDonch(v=>!v)}
          style={mkBtn(showDonch)}
          title="Donchian Channels - 20-period high/low, shows breakout levels"
        >DONCH</button>
        <button
          onMouseEnter={() => setHoveredInd('ichi')}
          onMouseLeave={() => setHoveredInd(null)}
          onClick={()=>setShowIchi(v=>!v)}
          style={mkBtn(showIchi,'teal')}
          title="Ichimoku Cloud - Tenkan (fast), Kijun (slow), Chikou (lagging) - Trend & momentum"
        >ICHIMOKU</button>

        <div style={{ marginLeft:'auto', display:'flex', gap:'8px', alignItems:'center', fontSize:'9px', fontFamily:'JetBrains Mono, monospace', color:'var(--text-muted)' }}>
          {hoveredInd === 'fib' && <span style={{ color:'#00e5c0' }}>Support/Resistance at key retracement levels</span>}
          {hoveredInd === 'pivot' && <span style={{ color:'#a78bfa' }}>Current day pivot + resistance & support zones</span>}
          {hoveredInd === 'donch' && <span style={{ color:'#f0a500' }}>20-period High/Low channels - breakout/reversal</span>}
          {hoveredInd === 'ichi' && <span style={{ color:'#00e5c0' }}>Tenkan(TK), Kijun(KJ), Chikou(CK) - Trend direction</span>}
        </div>

        <div style={{ marginLeft:'auto', display:'flex', gap:'3px', alignItems:'center', paddingLeft: '12px', borderLeft:'1px solid var(--border)' }}>
          <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace' }}>VOL</span>
          <button onClick={() => setVolHeight(v => Math.max(0.5, v - 0.2))} style={{ ...mkBtn(false, 'teal'), fontSize: '8px', padding: '1px 5px' }}>−H</button>
          <button onClick={() => setVolHeight(v => Math.min(2, v + 0.2))} style={{ ...mkBtn(false, 'teal'), fontSize: '8px', padding: '1px 5px' }}>+H</button>
          <button onClick={() => setVolWidth(v => Math.max(0.5, v - 0.2))} style={{ ...mkBtn(false, 'teal'), fontSize: '8px', padding: '1px 5px' }}>−W</button>
          <button onClick={() => setVolWidth(v => Math.min(2, v + 0.2))} style={{ ...mkBtn(false, 'teal'), fontSize: '8px', padding: '1px 5px' }}>+W</button>
        </div>
      </div>

      {/* ── Quote strip ───────────────────────────────────────────────── */}
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
          <span style={{ fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', marginLeft:'auto' }}>
            {sym} · 15min · scroll=zoom · drag price axis=stretch
          </span>
        </div>
      )}

      {/* ── Chart area ────────────────────────────────────────────────── */}
      <div style={{ flex:1, position:'relative', minHeight:0 }}>
        {loading && (
          <div style={{ position:'absolute', inset:0, zIndex:10, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(9,12,16,0.78)' }}>
            <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'11px', color:'var(--text-muted)', letterSpacing:'0.12em' }}>
              LOADING {sym}...
            </span>
          </div>
        )}

        <div ref={tooltipRef} style={{
          position:'absolute', top:'6px', left:'8px', zIndex:8,
          fontFamily:'JetBrains Mono, monospace', fontSize:'11px',
          opacity:0, pointerEvents:'none',
          background:'rgba(9,12,16,0.82)', padding:'3px 10px',
          borderRadius:'3px', border:'1px solid var(--border)',
          transition:'opacity 0.06s',
        }} />

        {SEP_LINES.map(p => (
          <div key={p} style={{ position:'absolute', left:0, right:0, top:`${p}%`, height:'1px', background:'#1e2d3d', zIndex:5, pointerEvents:'none' }} />
        ))}

        <div style={{ position:'absolute', left:'8px', top:`${PANE_LABELS.vol}%`, zIndex:6, fontSize:'9px', color:'var(--text-muted)', fontFamily:'JetBrains Mono, monospace', pointerEvents:'none' }}>VOL</div>

        <div ref={containerRef} style={{ width:'100%', height:'100%' }} />
      </div>
    </div>
  )
}