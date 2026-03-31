'use client'

import { useEffect, useState } from 'react'

interface SentimentData {
  score:       number   // 0–100
  label:       string
  color:       string
  components:  { label: string; value: string; contribution: string; color: string }[]
  vix:         number | null
  vixChange:   number | null
  spyRsi:      number | null
  spyVs50d:    number | null
  loading:     boolean
}

// RSI calculation from closing prices
function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff > 0) gains  += diff
    else          losses -= diff
  }
  const avgGain = gains  / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return Math.round(100 - (100 / (1 + rs)))
}

function scoreToLabel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: 'EXTREME GREED', color: '#00c97a' }
  if (score >= 65) return { label: 'GREED',         color: '#4ade80' }
  if (score >= 55) return { label: 'MILD GREED',    color: '#a3e635' }
  if (score >= 45) return { label: 'NEUTRAL',       color: '#f0a500' }
  if (score >= 35) return { label: 'MILD FEAR',     color: '#fb923c' }
  if (score >= 20) return { label: 'FEAR',          color: '#ff4560' }
  return                   { label: 'EXTREME FEAR', color: '#ff1f3d' }
}

export default function SentimentPanel() {
  const [data, setData] = useState<SentimentData>({
    score: 50, label: 'LOADING', color: 'var(--text-muted)',
    components: [], vix: null, vixChange: null, spyRsi: null, spyVs50d: null,
    loading: true,
  })

  const fetchSentiment = async () => {
    try {
      // Fetch VIX, SPY, and SPY historical in parallel
      const [vixRes, spyRes, spyHistRes] = await Promise.all([
        fetch('/api/finnhub?endpoint=quote&symbol=VIX'),
        fetch('/api/finnhub?endpoint=quote&symbol=SPY'),
        fetch('/api/yfinance?symbols=SPY&range=3mo&interval=1d'),
      ])

      const vixData = await vixRes.json()
      const spyData = await spyRes.json()
      const histData = await spyHistRes.json()

      const vix       = vixData?.c     ?? null
      const vixPrev   = vixData?.pc    ?? null
      const vixChange = vix && vixPrev ? vix - vixPrev : null
      const spyPrice  = spyData?.c     ?? null
      const spyChange = spyData?.dp    ?? null

      // Extract SPY closing prices from Yahoo Finance response
      let closes: number[] = []
      let spyVs50d: number | null = null
      let rsi: number | null = null

      try {
        const result = histData?.results?.[0]?.data?.chart?.result?.[0]
        if (result?.indicators?.quote?.[0]?.close) {
          closes = result.indicators.quote[0].close.filter((c: any) => c != null)
          if (closes.length >= 15) rsi = calcRSI(closes)
          if (closes.length >= 50) {
            const ma50    = closes.slice(-50).reduce((a: number, b: number) => a + b, 0) / 50
            spyVs50d      = spyPrice ? ((spyPrice - ma50) / ma50) * 100 : null
          }
        }
      } catch {}

      // ── Fear & Greed Score (0–100) ──────────────────────────────────────────
      // Based on 4 real indicators, each weighted:
      // 1. VIX Level          (25%) — VIX < 12 = extreme greed, > 30 = extreme fear
      // 2. VIX Momentum       (20%) — VIX rising = fear increasing
      // 3. SPY RSI 14         (30%) — RSI > 70 = greed, < 30 = fear
      // 4. SPY vs 50-day MA   (25%) — above = bullish, below = bearish

      const components: SentimentData['components'] = []
      let totalScore = 0
      let totalWeight = 0

      // Component 1: VIX Level (inverted — low VIX = greed)
      if (vix !== null) {
        const vixScore = vix <= 12 ? 90
          : vix <= 15 ? 75
          : vix <= 18 ? 60
          : vix <= 22 ? 50
          : vix <= 27 ? 35
          : vix <= 35 ? 20
          : 5
        totalScore  += vixScore * 0.25
        totalWeight += 0.25
        components.push({
          label: 'VIX Level',
          value: vix.toFixed(2),
          contribution: `${vixScore}/100`,
          color: vixScore > 60 ? 'var(--positive)' : vixScore > 40 ? 'var(--amber)' : 'var(--negative)',
        })
      }

      // Component 2: VIX Momentum (rising VIX = fear)
      if (vixChange !== null) {
        const momScore = vixChange < -2 ? 80
          : vixChange < -0.5 ? 65
          : vixChange < 0.5  ? 50
          : vixChange < 2    ? 35
          : 20
        totalScore  += momScore * 0.20
        totalWeight += 0.20
        components.push({
          label: 'VIX Momentum',
          value: `${vixChange >= 0 ? '+' : ''}${vixChange.toFixed(2)}`,
          contribution: `${momScore}/100`,
          color: momScore > 55 ? 'var(--positive)' : momScore > 40 ? 'var(--amber)' : 'var(--negative)',
        })
      }

      // Component 3: RSI 14 of SPY
      if (rsi !== null) {
        const rsiScore = rsi >= 80 ? 95
          : rsi >= 70 ? 78
          : rsi >= 60 ? 63
          : rsi >= 45 ? 50
          : rsi >= 35 ? 37
          : rsi >= 25 ? 22
          : 8
        totalScore  += rsiScore * 0.30
        totalWeight += 0.30
        components.push({
          label: 'SPY RSI (14)',
          value: rsi.toString(),
          contribution: `${rsiScore}/100`,
          color: rsi > 70 ? 'var(--positive)' : rsi > 50 ? 'var(--amber)' : 'var(--negative)',
        })
      }

      // Component 4: SPY vs 50-day MA
      if (spyVs50d !== null) {
        const maScore = spyVs50d > 8  ? 90
          : spyVs50d > 4  ? 72
          : spyVs50d > 1  ? 58
          : spyVs50d > -1 ? 50
          : spyVs50d > -4 ? 38
          : spyVs50d > -8 ? 25
          : 10
        totalScore  += maScore * 0.25
        totalWeight += 0.25
        components.push({
          label: 'SPY vs 50d MA',
          value: `${spyVs50d >= 0 ? '+' : ''}${spyVs50d.toFixed(2)}%`,
          contribution: `${maScore}/100`,
          color: spyVs50d > 0 ? 'var(--positive)' : 'var(--negative)',
        })
      }

      // Normalise to 0–100 based on available components
      const rawScore    = totalWeight > 0 ? totalScore / totalWeight : 50
      const finalScore  = Math.max(0, Math.min(100, Math.round(rawScore)))
      const { label, color } = scoreToLabel(finalScore)

      setData({
        score: finalScore, label, color, components,
        vix, vixChange, spyRsi: rsi, spyVs50d, loading: false,
      })

    } catch {
      setData(prev => ({ ...prev, loading: false }))
    }
  }

  useEffect(() => {
    fetchSentiment()
    const t = setInterval(fetchSentiment, 60_000)
    return () => clearInterval(t)
  }, [])

  const circumference = 2 * Math.PI * 52
  const dashOffset    = circumference - (data.score / 100) * circumference

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" />
        MARKET SENTIMENT
        <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginLeft: '6px' }}>
          Fear &amp; Greed Index
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 16px', gap: '12px' }}>

        {/* Gauge */}
        {!data.loading && (
          <>
            <div style={{ position: 'relative', width: '120px', height: '120px' }}>
              <svg width="120" height="120" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="10" />
                <circle cx="60" cy="60" r="52"
                  fill="none" stroke={data.color} strokeWidth="10"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 1.2s ease, stroke 0.6s' }}
                />
              </svg>
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '26px', color: data.color, lineHeight: 1, transition: 'color 0.6s' }}>
                  {data.score}
                </span>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>/100</span>
              </div>
            </div>

            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: data.color, letterSpacing: '0.06em' }}>
              {data.label}
            </div>
          </>
        )}

        {/* Component breakdown */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {data.loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
              Computing...
            </div>
          ) : data.components.map(c => (
            <div key={c.label} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '5px 10px', background: 'var(--bg-deep)', borderRadius: '4px',
            }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', flex: 1 }}>
                {c.label}
              </span>
              <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-2)', marginRight: '8px' }}>
                {c.value}
              </span>
              <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: c.color, minWidth: '44px', textAlign: 'right' }}>
                {c.contribution}
              </span>
            </div>
          ))}
        </div>

        {/* Methodology note */}
        {!data.loading && (
          <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', lineHeight: 1.5 }}>
            VIX 25% · VIX momentum 20% · RSI(14) 30% · vs 50d MA 25%
          </div>
        )}
      </div>
    </div>
  )
}