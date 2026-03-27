'use client'

import { useEffect, useState } from 'react'

interface SentimentData {
  vix: number | null
  spyChange: number | null
  score: number  // 0-100, 0=extreme fear, 100=extreme greed
  label: string
  color: string
}

export default function SentimentPanel() {
  const [data, setData] = useState<SentimentData>({
    vix: null, spyChange: null, score: 50, label: 'LOADING', color: 'var(--text-muted)'
  })

  const fetch_ = async () => {
    try {
      const [vixRes, spyRes] = await Promise.all([
        fetch('/api/finnhub?endpoint=quote&symbol=VIX'),
        fetch('/api/finnhub?endpoint=quote&symbol=SPY'),
      ])
      const vix = await vixRes.json()
      const spy = await spyRes.json()

      const vixVal = vix.c || 20
      const spyChg = spy.dp || 0

      // Simple fear/greed proxy
      // VIX: <12 = greed, >30 = fear
      // SPY change: positive = greed, negative = fear
      let score = 50
      score -= (vixVal - 20) * 1.5   // VIX above 20 = fear
      score += spyChg * 3            // SPY move
      score = Math.max(0, Math.min(100, score))

      const label = score > 75 ? 'EXTREME GREED'
        : score > 55 ? 'GREED'
        : score > 45 ? 'NEUTRAL'
        : score > 25 ? 'FEAR'
        : 'EXTREME FEAR'

      const color = score > 65 ? '#00c97a'
        : score > 45 ? '#f0a500'
        : '#ff4560'

      setData({ vix: vixVal, spyChange: spyChg, score: Math.round(score), label, color })
    } catch {}
  }

  useEffect(() => {
    fetch_()
    const t = setInterval(fetch_, 30000)
    return () => clearInterval(t)
  }, [])

  const circumference = 2 * Math.PI * 54
  const dashOffset = circumference - (data.score / 100) * circumference

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" />
        MARKET SENTIMENT
      </div>
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '16px', padding: '16px',
      }}>
        {/* Gauge */}
        <div style={{ position: 'relative', width: '128px', height: '128px' }}>
          <svg width="128" height="128" style={{ transform: 'rotate(-90deg)' }}>
            <circle cx="64" cy="64" r="54"
              fill="none" stroke="var(--border)" strokeWidth="10" />
            <circle cx="64" cy="64" r="54"
              fill="none" stroke={data.color} strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.5s' }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{
              fontFamily: 'Syne, sans-serif', fontWeight: 800,
              fontSize: '28px', color: data.color,
              lineHeight: 1, transition: 'color 0.5s',
            }}>{data.score}</span>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>/ 100</span>
          </div>
        </div>

        <div style={{
          fontFamily: 'Syne, sans-serif', fontWeight: 700,
          fontSize: '14px', color: data.color, letterSpacing: '0.05em',
          transition: 'color 0.5s',
        }}>{data.label}</div>

        {/* Stats */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--bg-deep)', borderRadius: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>VIX</span>
            <span style={{
              fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
              color: (data.vix || 0) > 25 ? 'var(--negative)' : (data.vix || 0) < 15 ? 'var(--positive)' : '#fff',
            }}>
              {data.vix?.toFixed(2) || '---'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--bg-deep)', borderRadius: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>SPY TODAY</span>
            <span style={{
              fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
              color: (data.spyChange || 0) >= 0 ? 'var(--positive)' : 'var(--negative)',
            }}>
              {data.spyChange != null ? `${data.spyChange >= 0 ? '+' : ''}${data.spyChange.toFixed(2)}%` : '---'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}