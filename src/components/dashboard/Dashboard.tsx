'use client'

import React, { useState, useEffect } from 'react'
import TickerBar from '@/components/ui/TickerBar'
import GridLayout from '@/components/dashboard/GridLayout'

export default function Dashboard() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Top header bar */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        padding: '0 16px',
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'var(--bg-panel)',
      }}>
        <div style={{
          fontFamily: 'Syne, sans-serif',
          fontWeight: 800,
          fontSize: '18px',
          color: '#fff',
          letterSpacing: '-0.02em',
        }}>
          NEX<span style={{ color: 'var(--amber)' }}>US</span>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          <MarketClock />
        </div>
      </div>

      {/* Live ticker strip */}
      <TickerBar />

      {/* Main dashboard grid */}
      <GridLayout />
    </div>
  )
}

function MarketClock() {
  const [time, setTime] = useState<string>('')

  useEffect(() => {
    const update = () => setTime(
      new Date().toLocaleTimeString('en-US', {
        hour12: false,
        timeZone: 'America/New_York',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    )
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])

  if (!time) return null  // render nothing on server
  return <span>{time} ET</span>
}