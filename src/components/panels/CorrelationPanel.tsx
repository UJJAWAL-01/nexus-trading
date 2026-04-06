'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useWatchlist } from '@/store/watchlist'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CorrelationResult {
  symbol:          string
  pearson:         number
  spearman:        number
  beta:            number
  direction:       'leads' | 'follows' | 'concurrent'
  leadLagDays:     number
  leadLagStrength: number
  category:        string | null
  explanation:     string
  abs:             number
  dataPoints:      number
}

interface CorrelationResponse {
  target:         string
  market:         string
  dataPoints:     number
  period:         string
  correlations:   CorrelationResult[]
  categories:     Record<string, string[]>
  universeReason: string
  fetchedAt:      string
  poweredBy:      string
  error?:         string
}

// ── Force-directed graph engine ───────────────────────────────────────────────

interface SimNode {
  id:         string
  label:      string
  corr:       number
  beta:       number
  direction:  'leads' | 'follows' | 'concurrent'
  category:   string | null
  explanation:string
  x:          number
  y:          number
  vx:         number
  vy:         number
  r:          number
  pearson:    number
  spearman:   number
  leadLagDays:number
}

interface SimEdge {
  src: number
  tgt: number
  w:   number
}

function corrToColor(corr: number): string {
  if (corr > 0.8)  return '#00c97a'
  if (corr > 0.6)  return '#00e5a0'
  if (corr > 0.3)  return '#4ade80'
  if (corr > 0.1)  return '#7a9ab0'
  if (corr > -0.1) return '#4a6070'
  if (corr > -0.3) return '#fb923c'
  if (corr > -0.6) return '#ff6080'
  return '#ff1f3d'
}

function categoryColor(cat: string | null): string {
  if (!cat) return '#4a6070'
  if (cat.includes('Index') || cat.includes('ETF') || cat.includes('Indices')) return '#1e90ff'
  if (cat.includes('Macro') || cat.includes('Factor')) return '#a78bfa'
  if (cat.includes('Peer') || cat.includes('Sector') || cat.includes('Banking')) return '#00e5c0'
  if (cat.includes('Supply') || cat.includes('Chain')) return '#f97316'
  if (cat.includes('Compet')) return '#ff4560'
  return '#f0a500'
}

function simulate(nodes: SimNode[], edges: SimEdge[], cx: number, cy: number) {
  const K_REPULSE = 8000
  const K_SPRING  = 0.006
  const DAMP      = 0.84
  const K_CENTER  = 0.015

  for (let i = 0; i < nodes.length; i++) {
    let fx = 0, fy = 0
    const ni = nodes[i]

    // Coulomb repulsion between all pairs
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue
      const nj = nodes[j]
      const dx = ni.x - nj.x + (Math.random() - 0.5) * 0.1
      const dy = ni.y - nj.y + (Math.random() - 0.5) * 0.1
      const d2 = dx * dx + dy * dy + 0.01
      const d  = Math.sqrt(d2)
      const f  = K_REPULSE / d2
      fx += (dx / d) * f
      fy += (dy / d) * f
    }

    // Hooke spring along edges (target length = 120 - |corr| * 60)
    edges.forEach(e => {
      if (e.src !== i && e.tgt !== i) return
      const other = nodes[e.src === i ? e.tgt : e.src]
      const dx = other.x - ni.x
      const dy = other.y - ni.y
      const d  = Math.sqrt(dx * dx + dy * dy) + 0.01
      const targetLen = 90 + (1 - e.w) * 100
      const f = (d - targetLen) * K_SPRING
      fx += (dx / d) * f
      fy += (dy / d) * f
    })

    // Gravity toward center (stronger for target node)
    const kc = i === 0 ? K_CENTER * 6 : K_CENTER
    fx += (cx - ni.x) * kc
    fy += (cy - ni.y) * kc

    // Apply damped velocity
    ni.vx = (ni.vx + fx) * DAMP
    ni.vy = (ni.vy + fy) * DAMP

    const spd = Math.sqrt(ni.vx ** 2 + ni.vy ** 2)
    if (spd > 10) { ni.vx *= 10 / spd; ni.vy *= 10 / spd }

    ni.x += ni.vx
    ni.y += ni.vy
  }
}

function draw(
  ctx:   CanvasRenderingContext2D,
  nodes: SimNode[],
  edges: SimEdge[],
  hover: number | null,
  W: number, H: number,
  dpr:  number,
  showCategoryColors: boolean,
) {
  ctx.clearRect(0, 0, W * dpr, H * dpr)
  ctx.save()
  ctx.scale(dpr, dpr)

  // ── Draw edges ──────────────────────────────────────────────────────────
  edges.forEach(e => {
    const a   = nodes[e.src], b = nodes[e.tgt]
    const col = corrToColor(b.corr)
    const isHoveredEdge = hover === e.tgt || hover === e.src

    // Draw dashed edge for leading symbols, solid for followers
    if (b.direction === 'leads') {
      ctx.setLineDash([4, 4])
    } else {
      ctx.setLineDash([])
    }

    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = col + (isHoveredEdge ? 'cc' : '44')
    ctx.lineWidth   = isHoveredEdge ? 1.5 + e.w * 2 : 0.6 + e.w * 1.2
    ctx.stroke()
    ctx.setLineDash([])

    // Arrow direction indicator (tiny triangle at midpoint)
    if (b.direction !== 'concurrent') {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      const dx = b.x - a.x, dy = b.y - a.y
      const angle = Math.atan2(
        b.direction === 'leads' ? -dy : dy,
        b.direction === 'leads' ? -dx : dx
      )
      ctx.save()
      ctx.translate(mx, my)
      ctx.rotate(angle)
      ctx.beginPath()
      ctx.moveTo(5, 0)
      ctx.lineTo(-3, 3)
      ctx.lineTo(-3, -3)
      ctx.closePath()
      ctx.fillStyle = col + '99'
      ctx.fill()
      ctx.restore()
    }
  })

  // ── Draw nodes ──────────────────────────────────────────────────────────
  nodes.forEach((n, i) => {
    const isTarget = i === 0
    const isHover  = hover === i

    const nodeColor = isTarget
      ? '#f0a500'
      : showCategoryColors && n.category
        ? categoryColor(n.category)
        : corrToColor(n.corr)

    // Outer glow for hover
    if (isHover || isTarget) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r + 8, 0, Math.PI * 2)
      ctx.fillStyle = nodeColor + (isTarget ? '30' : '20')
      ctx.fill()
    }

    // Node body
    ctx.beginPath()
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
    ctx.fillStyle   = nodeColor + (isTarget ? 'ee' : isHover ? 'dd' : 'bb')
    ctx.strokeStyle = nodeColor
    ctx.lineWidth   = isTarget ? 2.5 : isHover ? 2 : 1.5
    ctx.fill()
    ctx.stroke()

    // Beta ring (outer ring shows beta vs target)
    if (!isTarget && Math.abs(n.beta) > 0.3) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r + 3.5, 0, Math.PI * 2 * Math.min(Math.abs(n.beta), 2) / 2)
      ctx.strokeStyle = n.beta > 0 ? 'rgba(0,201,122,0.5)' : 'rgba(255,69,96,0.5)'
      ctx.lineWidth   = 1.5
      ctx.stroke()
    }

    // Symbol label
    const fs = isTarget ? 11 : Math.max(8, 10 - Math.max(0, n.label.length - 5))
    ctx.font        = `${isTarget || isHover ? 700 : 500} ${fs}px "JetBrains Mono", monospace`
    ctx.fillStyle   = '#fff'
    ctx.textAlign   = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(n.label.slice(0, 8), n.x, n.y)

    // Correlation badge below label (for hover)
    if (isHover && !isTarget) {
      const corrStr = (n.pearson >= 0 ? '+' : '') + n.pearson.toFixed(2)
      ctx.font       = '600 9px "JetBrains Mono", monospace'
      ctx.fillStyle  = nodeColor
      ctx.fillText(corrStr, n.x, n.y + n.r + 9)
    }

    // TARGET label always shown
    if (isTarget) {
      ctx.font      = '600 8px "JetBrains Mono", monospace'
      ctx.fillStyle = '#f0a500aa'
      ctx.fillText('TARGET', n.x, n.y + n.r + 9)
    }
  })

  ctx.restore()
}

// ── Component ─────────────────────────────────────────────────────────────────

type MarketFilter = 'US' | 'IN'
type ViewMode = 'correlation' | 'category'

const DIRECTION_ICONS = {
  leads:      '↑',
  follows:    '↓',
  concurrent: '↔',
}

export default function CorrelationPanel() {
  const { symbols: watchlist } = useWatchlist()

  const [market,         setMarket]          = useState<MarketFilter>('US')
  const [targetInput,    setTargetInput]      = useState('SPY')
  const [activeTarget,   setActiveTarget]     = useState('SPY')
  const [data,           setData]             = useState<CorrelationResponse | null>(null)
  const [loading,        setLoading]          = useState(false)
  const [loadingPhase,   setLoadingPhase]     = useState('')
  const [hover,          setHover]            = useState<number | null>(null)
  const [hoverNode,      setHoverNode]        = useState<SimNode | null>(null)
  const [viewMode,       setViewMode]         = useState<ViewMode>('correlation')
  const [showList,       setShowList]         = useState(false)
  const [settled,        setSettled]          = useState(false)

  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const nodesRef   = useRef<SimNode[]>([])
  const edgesRef   = useRef<SimEdge[]>([])
  const animRef    = useRef<number>(0)
  const stepsRef   = useRef(0)

  // ── When market changes, reset target ──────────────────────────────────────
  useEffect(() => {
    if (market === 'IN') {
      setTargetInput('^NSEI')
      setActiveTarget('^NSEI')
    } else {
      setTargetInput('SPY')
      setActiveTarget('SPY')
    }
  }, [market])

  // ── Fetch correlation data ─────────────────────────────────────────────────
  const fetchData = useCallback(async (target: string) => {
    setLoading(true)
    setSettled(false)
    setLoadingPhase('🤖 Claude AI identifying related stocks...')
    nodesRef.current = []
    edgesRef.current = []

    try {
      // Phase messaging
      const phaseTimer = setTimeout(() => setLoadingPhase('📊 Fetching 90-day OHLCV data...'), 3000)
      const phaseTimer2 = setTimeout(() => setLoadingPhase('🔢 Computing Pearson · Spearman · Beta · Lead-Lag...'), 7000)
      const phaseTimer3 = setTimeout(() => setLoadingPhase('💡 Generating relationship explanations...'), 12000)

      const res  = await fetch(`/api/correlation?symbol=${encodeURIComponent(target)}&market=${market}`)
      const json = await res.json() as CorrelationResponse

      clearTimeout(phaseTimer)
      clearTimeout(phaseTimer2)
      clearTimeout(phaseTimer3)

      if (json.error) throw new Error(json.error)
      setData(json)
    } catch (err) {
      console.error('[CorrelationPanel]', err)
      setData(null)
    } finally {
      setLoading(false)
      setLoadingPhase('')
    }
  }, [market])

  useEffect(() => {
    fetchData(activeTarget)
  }, [activeTarget, fetchData])

  // ── Build simulation nodes when data arrives ───────────────────────────────
  useEffect(() => {
    if (!data?.correlations?.length) return
    const canvas = canvasRef.current
    if (!canvas) return

    const W = canvas.clientWidth  || 400
    const H = canvas.clientHeight || 300
    const cx = W / 2, cy = H / 2

    const targetNode: SimNode = {
      id:          data.target,
      label:       data.target.replace('.NS','').replace('^',''),
      corr:        0, pearson: 0, spearman: 0, beta: 1,
      direction:   'concurrent',
      category:    'TARGET',
      explanation: 'This is the selected target stock.',
      leadLagDays: 0,
      x: cx, y: cy, vx: 0, vy: 0, r: 22,
    }

    const peerNodes: SimNode[] = data.correlations.slice(0, 14).map((c, i) => {
      const angle = (i / data.correlations.slice(0, 14).length) * Math.PI * 2
      const dist  = 100 + Math.random() * 60 + (1 - c.abs) * 60
      return {
        id:          c.symbol,
        label:       c.symbol.replace('.NS','').replace('.BO','').replace('^',''),
        corr:        c.pearson,
        pearson:     c.pearson,
        spearman:    c.spearman,
        beta:        c.beta,
        direction:   c.direction,
        category:    c.category,
        explanation: c.explanation,
        leadLagDays: c.leadLagDays,
        x:  cx + Math.cos(angle) * dist,
        y:  cy + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        r:  9 + c.abs * 12,
      }
    })

    nodesRef.current = [targetNode, ...peerNodes]
    edgesRef.current = peerNodes.map((_, i) => ({
      src: 0, tgt: i + 1,
      w:   data.correlations[i]?.abs ?? 0.5,
    }))
    stepsRef.current = 0
    setSettled(false)
  }, [data])

  // ── Animation loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const ctx  = canvas.getContext('2d')
    if (!ctx) return

    let running = true

    const frame = () => {
      if (!running) return
      const W = canvas.clientWidth
      const H = canvas.clientHeight

      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width  = W * dpr
        canvas.height = H * dpr
      }

      const cx = W / 2, cy = H / 2

      if (nodesRef.current.length > 0) {
        if (stepsRef.current < 300) {
          simulate(nodesRef.current, edgesRef.current, cx, cy)
          stepsRef.current++
          if (stepsRef.current === 300) setSettled(true)
        }
        draw(ctx, nodesRef.current, edgesRef.current, hover, W, H, dpr, viewMode === 'category')
      } else if (!loading) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.save()
        ctx.scale(dpr, dpr)
        ctx.font = '500 11px "JetBrains Mono", monospace'
        ctx.fillStyle = '#4a6070'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('Enter a symbol and click ANALYZE', W / 2, H / 2)
        ctx.restore()
      }

      animRef.current = requestAnimationFrame(frame)
    }

    animRef.current = requestAnimationFrame(frame)
    return () => { running = false; cancelAnimationFrame(animRef.current) }
  }, [hover, loading, viewMode])

  // ── Mouse interaction ──────────────────────────────────────────────────────
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !nodesRef.current.length) return
    const rect = canvas.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const my   = e.clientY - rect.top

    let closest: number | null = null
    let minDist = Infinity

    nodesRef.current.forEach((n, i) => {
      const d = Math.sqrt((mx - n.x) ** 2 + (my - n.y) ** 2)
      if (d < n.r + 10 && d < minDist) { minDist = d; closest = i }
    })

    setHover(closest)
    setHoverNode(closest !== null ? nodesRef.current[closest] : null)
  }, [])

  // ── Watchlist + default options for quick select ───────────────────────────
  const quickSymbols = market === 'US'
    ? [...new Set(['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL', ...watchlist.filter(s => !s.includes('.') && !s.startsWith('^'))]).values()].slice(0, 12)
    : [...new Set(['^NSEI', '^NSEBANK', 'RELIANCE.NS', 'TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ICICIBANK.NS', ...watchlist.filter(s => s.includes('.NS'))]).values()].slice(0, 10)

  const handleSubmit = () => {
    const t = targetInput.trim().toUpperCase()
    if (t) { setActiveTarget(t); setShowList(false) }
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#1e90ff' }} />
          CORRELATION MAP
          <span style={{
            fontSize: '8px', padding: '1px 6px', borderRadius: '2px',
            background: 'rgba(30,144,255,0.1)', color: '#1e90ff',
            border: '1px solid rgba(30,144,255,0.2)',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            AI · PEARSON · SPEARMAN · BETA · LEAD-LAG
          </span>
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['US', 'IN'] as MarketFilter[]).map(m => (
            <button key={m} onClick={() => setMarket(m)} style={{
              padding: '2px 10px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', fontWeight: 700,
              border: `1px solid ${market === m ? '#1e90ff' : 'var(--border)'}`,
              background: market === m ? 'rgba(30,144,255,0.1)' : 'transparent',
              color: market === m ? '#1e90ff' : 'var(--text-muted)',
            }}>
              {m === 'US' ? '🇺🇸' : '🇮🇳'} {m}
            </button>
          ))}
        </div>
      </div>

      {/* ── Symbol input + controls ────────────────────────────────────────── */}
      <div style={{
        padding: '6px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        {/* Symbol input */}
        <div style={{ position: 'relative', flex: 1, minWidth: '80px' }}>
          <input
            value={targetInput}
            onChange={e => { setTargetInput(e.target.value.toUpperCase()); setShowList(true) }}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            onFocus={() => setShowList(true)}
            placeholder="Enter any symbol..."
            style={{
              width: '100%', background: 'var(--bg-deep)',
              color: '#fff', border: '1px solid var(--border)',
              borderRadius: '3px', padding: '4px 10px',
              fontSize: '12px', fontFamily: 'JetBrains Mono, monospace',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          {/* Quick-select dropdown */}
          {showList && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
              background: 'var(--bg-panel)', border: '1px solid var(--border)',
              borderRadius: '4px', maxHeight: '160px', overflowY: 'auto',
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)', marginTop: '2px',
            }}>
              {quickSymbols
                .filter(s => s.includes(targetInput) || targetInput.length === 0)
                .map(s => (
                  <div
                    key={s}
                    onMouseDown={() => { setTargetInput(s); setActiveTarget(s); setShowList(false) }}
                    style={{
                      padding: '6px 12px', cursor: 'pointer',
                      fontSize: '11px', color: 'var(--text-2)',
                      fontFamily: 'JetBrains Mono, monospace',
                      borderBottom: '1px solid var(--border)',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(30,144,255,0.1)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {s.replace('.NS', '').replace('^', '')}
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: '8px' }}>{s}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            padding: '4px 14px', borderRadius: '3px', cursor: loading ? 'wait' : 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', fontWeight: 700,
            border: '1px solid #1e90ff', background: 'rgba(30,144,255,0.1)',
            color: '#1e90ff', letterSpacing: '0.06em', flexShrink: 0,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '...' : 'ANALYZE'}
        </button>

        {/* View mode toggle */}
        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
          {([['correlation', 'CORR'], ['category', 'CAT']] as [ViewMode, string][]).map(([mode, label]) => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{
              padding: '3px 8px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
              border: `1px solid ${viewMode === mode ? 'var(--amber)' : 'var(--border)'}`,
              background: viewMode === mode ? 'rgba(240,165,0,0.1)' : 'transparent',
              color: viewMode === mode ? 'var(--amber)' : 'var(--text-muted)',
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* List toggle */}
        <button
          onClick={() => setShowList(false)}
          style={{
            padding: '3px 8px', borderRadius: '3px', cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-muted)',
          }}
        >
          ≡ LIST
        </button>
      </div>

      {/* Universe + metadata strip */}
      {data && !loading && (
        <div style={{
          padding: '5px 14px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: '9px', color: '#1e90ff', fontFamily: 'JetBrains Mono, monospace' }}>
            🤖 {data.poweredBy?.split('+')[0].trim()}
          </span>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {data.period} · {data.correlations.length} correlates
          </span>
          {data.universeReason && (
            <span style={{
              fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace',
              fontStyle: 'italic', marginLeft: 'auto',
            }}>
              {data.universeReason}
            </span>
          )}
        </div>
      )}

      {/* ── Main area: graph OR list ─────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>

        {/* Loading state */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '12px',
            background: 'rgba(9,12,16,0.9)',
          }}>
            <div style={{
              width: '32px', height: '32px', border: '2px solid var(--border)',
              borderTop: '2px solid #1e90ff', borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <div style={{ fontSize: '11px', color: '#1e90ff', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', maxWidth: '280px', lineHeight: 1.5 }}>
              {loadingPhase || 'COMPUTING...'}
            </div>
            <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Canvas graph */}
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => { setHover(null); setHoverNode(null) }}
          onClick={() => setShowList(false)}
          style={{
            width: '100%', height: '100%', display: 'block',
            cursor: hover !== null ? 'pointer' : 'default',
          }}
        />

        {/* Hover tooltip — rich panel */}
        {hoverNode && (
          <div style={{
            position: 'absolute', top: '8px', left: '8px',
            background: 'rgba(9,12,16,0.96)',
            border: `1px solid ${corrToColor(hoverNode.corr)}55`,
            borderRadius: '6px', padding: '10px 14px',
            maxWidth: '240px',
            fontFamily: 'JetBrains Mono, monospace',
            zIndex: 50, pointerEvents: 'none',
          }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '15px', color: '#fff', marginBottom: '6px' }}>
              {hoverNode.id.replace('.NS','').replace('^','')}
              {hoverNode.category && (
                <span style={{
                  fontSize: '8px', marginLeft: '8px', padding: '2px 6px',
                  borderRadius: '2px', background: categoryColor(hoverNode.category) + '20',
                  color: categoryColor(hoverNode.category),
                  border: `1px solid ${categoryColor(hoverNode.category)}40`,
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {hoverNode.category}
                </span>
              )}
            </div>

            {hoverNode.corr !== 0 && (
              <>
                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                  {[
                    { label: 'PEARSON R',  value: (hoverNode.pearson >= 0 ? '+' : '') + hoverNode.pearson.toFixed(3),  color: corrToColor(hoverNode.pearson) },
                    { label: 'SPEARMAN ρ', value: (hoverNode.spearman >= 0 ? '+' : '') + hoverNode.spearman.toFixed(3), color: corrToColor(hoverNode.spearman) },
                    { label: 'BETA vs TARGET', value: hoverNode.beta.toFixed(3), color: hoverNode.beta > 0 ? 'var(--positive)' : 'var(--negative)' },
                    { label: 'LEAD/LAG',   value: `${DIRECTION_ICONS[hoverNode.direction]} ${hoverNode.direction.toUpperCase()}${hoverNode.leadLagDays > 0 ? ` ${hoverNode.leadLagDays}d` : ''}`, color: '#a78bfa' },
                  ].map(({ label, value, color }) => (
                    <div key={label} style={{ background: 'rgba(255,255,255,0.03)', padding: '4px 6px', borderRadius: '3px' }}>
                      <div style={{ fontSize: '8px', color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '2px' }}>{label}</div>
                      <div style={{ fontSize: '12px', fontWeight: 700, color }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Strength label */}
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginBottom: '6px' }}>
                  {Math.abs(hoverNode.pearson) > 0.8 ? '🔴 VERY STRONG' :
                   Math.abs(hoverNode.pearson) > 0.6 ? '🟠 STRONG' :
                   Math.abs(hoverNode.pearson) > 0.3 ? '🟡 MODERATE' : '⚪ WEAK'}{' '}
                  {hoverNode.pearson > 0 ? 'POSITIVE' : 'NEGATIVE'} CORRELATION
                </div>

                {/* AI explanation */}
                {hoverNode.explanation && (
                  <div style={{
                    fontSize: '10px', color: 'var(--teal)', lineHeight: 1.5,
                    borderLeft: '2px solid rgba(0,229,192,0.4)',
                    paddingLeft: '8px',
                    fontStyle: 'italic',
                  }}>
                    ◆ {hoverNode.explanation}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Legend — bottom-left when no hover */}
        {!hoverNode && data && !loading && (
          <div style={{
            position: 'absolute', bottom: '8px', left: '8px',
            display: 'flex', flexDirection: 'column', gap: '4px',
            pointerEvents: 'none',
          }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {[
                { label: '>0.8',  color: '#00c97a' },
                { label: '>0.6',  color: '#4ade80' },
                { label: '~0',    color: '#4a6070' },
                { label: '<-0.3', color: '#fb923c' },
                { label: '<-0.6', color: '#ff4560' },
              ].map(({ label, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: color }} />
                  <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{label}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              Dashed edge = peer LEADS target · → arrow = direction
            </div>
          </div>
        )}
      </div>

      {/* ── Sortable list view (below graph) ─────────────────────────────────── */}
      {data && !loading && data.correlations.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--border)', flexShrink: 0,
          maxHeight: '180px', overflowY: 'auto',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 56px 56px 56px 80px',
            padding: '4px 14px',
            fontSize: '8px', color: 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-deep)',
            position: 'sticky', top: 0, zIndex: 5,
          }}>
            <span>SYMBOL</span>
            <span style={{ textAlign: 'right' }}>PEARSON</span>
            <span style={{ textAlign: 'right' }}>BETA</span>
            <span style={{ textAlign: 'right' }}>SPEARMAN</span>
            <span style={{ textAlign: 'right' }}>LEAD/LAG</span>
          </div>

          {data.correlations.map((c, i) => (
            <div
              key={c.symbol}
              onMouseEnter={() => {
                const node = nodesRef.current[i + 1]
                if (node) { setHover(i + 1); setHoverNode(node) }
              }}
              onMouseLeave={() => { setHover(null); setHoverNode(null) }}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 56px 56px 56px 80px',
                padding: '5px 14px',
                borderBottom: '1px solid rgba(30,45,61,0.4)',
                cursor: 'default',
                background: hover === i + 1 ? 'rgba(30,144,255,0.06)' : 'transparent',
                transition: 'background 0.1s',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                <span style={{ fontSize: '11px', fontFamily: 'Syne, sans-serif', fontWeight: 700, color: '#fff' }}>
                  {c.symbol.replace('.NS','').replace('^','')}
                </span>
                {c.category && (
                  <span style={{ fontSize: '8px', color: categoryColor(c.category), fontFamily: 'JetBrains Mono, monospace' }}>
                    {c.category}
                  </span>
                )}
              </div>
              <span style={{
                fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                color: corrToColor(c.pearson), textAlign: 'right', alignSelf: 'center',
              }}>
                {(c.pearson >= 0 ? '+' : '') + c.pearson.toFixed(3)}
              </span>
              <span style={{
                fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
                color: c.beta > 0 ? 'var(--positive)' : 'var(--negative)',
                textAlign: 'right', alignSelf: 'center',
              }}>
                {c.beta.toFixed(2)}
              </span>
              <span style={{
                fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
                color: corrToColor(c.spearman), textAlign: 'right', alignSelf: 'center',
              }}>
                {(c.spearman >= 0 ? '+' : '') + c.spearman.toFixed(3)}
              </span>
              <span style={{
                fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
                color: '#a78bfa', textAlign: 'right', alignSelf: 'center',
              }}>
                {DIRECTION_ICONS[c.direction]} {c.direction}{c.leadLagDays > 0 ? ` ${c.leadLagDays}d` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}