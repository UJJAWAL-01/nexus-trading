'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { TTL } from '@/lib/data-hooks'
import type { EarningItem } from '@/app/api/earnings/route'

type Market = 'US' | 'IN'
type TimeFilter = 'upcoming' | 'recent' | 'all'

function todayStr() { return new Date().toISOString().split('T')[0] }

function fmtDate(d: string) {
  try {
    return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return d }
}

function fmtEps(v: number | null, currency = '$') {
  if (v === null) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1000) return `${sign}${currency}${(abs/1000).toFixed(1)}K`
  if (abs >= 1)    return `${sign}${currency}${abs.toFixed(2)}`
  return `${sign}${currency}${abs.toFixed(4)}`
}

function fmtRevenue(v: number | null, isIndia = false) {
  if (v === null) return '—'
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (isIndia) {
    // Indian companies report in INR crores
    if (abs >= 1e7)   return `${sign}₹${(abs/1e7).toFixed(1)}Cr`
    if (abs >= 1e5)   return `${sign}₹${(abs/1e5).toFixed(1)}L`
    if (abs >= 1e9)   return `${sign}₹${(abs/1e9).toFixed(1)}B`
    return `${sign}₹${abs.toFixed(0)}`
  }
  if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(1)}B`
  if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(1)}M`
  return `${sign}$${abs.toFixed(0)}`
}

function relDay(date: string): string {
  const today = new Date(todayStr() + 'T00:00:00').getTime()
  const d     = new Date(date + 'T00:00:00').getTime()
  const diff  = Math.round((d - today) / 86400_000)
  if (diff === 0) return 'TODAY'
  if (diff === 1) return 'TMR'
  if (diff === -1) return 'YEST'
  if (diff > 0)   return `+${diff}d`
  return `${diff}d`
}

function epsSuprise(actual: number | null, estimate: number | null): number | null {
  if (actual === null || estimate === null || estimate === 0) return null
  return ((actual - estimate) / Math.abs(estimate)) * 100
}

export default function EarningsPanel() {
  const [market, setMarket] = useState<Market>('US')
  const [filter, setFilter] = useState<TimeFilter>('upcoming')

  const { data: earnings = [], isLoading: loading } = useSWR<EarningItem[]>(
    `/api/earnings?market=${market}`,
    { refreshInterval: TTL.HOURLY, dedupingInterval: TTL.SLOW, keepPreviousData: true },
  )

  const today = todayStr()

  // ── Filter logic ────────────────────────────────────────────────────────────
  const displayed = earnings.filter(e => {
    if (filter === 'upcoming') return e.isFuture
    if (filter === 'recent')   return !e.isFuture
    return true
  })

  const upcomingCount = earnings.filter(e => e.isFuture).length
  const recentCount   = earnings.filter(e => !e.isFuture).length
  const todayCount    = earnings.filter(e => e.date === today).length

  const isIndia = market === 'IN'

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div className="panel-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#a78bfa' }} />
          EARNINGS CALENDAR
          {todayCount > 0 && (
            <span style={{
              fontSize: '11px', padding: '2px 8px', borderRadius: '2px',
              background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
              border: '1px solid rgba(167,139,250,0.3)',
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {todayCount} TODAY
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {(['US', 'IN'] as Market[]).map(m => (
            <button key={m} onClick={() => setMarket(m)} style={{
              padding: '4px 12px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
              letterSpacing: '0.08em', fontWeight: 700,
              border:     `1px solid ${market === m ? '#a78bfa' : 'var(--border)'}`,
              background: market === m ? 'rgba(167,139,250,0.12)' : 'transparent',
              color:      market === m ? '#a78bfa' : 'var(--text-muted)',
            }}>
              {m === 'US' ? '🇺🇸 US' : '🇮🇳 IN'}
            </button>
          ))}
        </div>
      </div>

      {/* Time filters */}
      <div style={{
        display: 'flex', gap: '4px', padding: '6px 12px',
        borderBottom: '1px solid var(--border)', alignItems: 'center',
      }}>
        {([
          ['upcoming', `Upcoming (${upcomingCount})`],
          ['recent',   `Results (${recentCount})`],
          ['all',      `All (${earnings.length})`],
        ] as const).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '4px 12px', borderRadius: '3px', cursor: 'pointer',
            fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
            border:     `1px solid ${filter === f ? 'var(--teal)' : 'var(--border)'}`,
            background: filter === f ? 'rgba(0,229,192,0.08)' : 'transparent',
            color:      filter === f ? 'var(--teal)' : 'var(--text-muted)',
          }}>
            {label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
          {isIndia ? 'via Yahoo Finance' : 'via Finnhub · ±30d'}
        </div>
      </div>

      {/* Legend for "Results" view */}
      {filter === 'recent' && !loading && displayed.length > 0 && (
        <div style={{
          padding: '4px 12px', display: 'flex', gap: '12px', alignItems: 'center',
          borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.1)',
        }}>
          {[
            { color: 'var(--positive)', label: '▲ BEAT' },
            { color: 'var(--negative)', label: '▼ MISS' },
            { color: 'var(--text-muted)', label: '— IN LINE' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: color }} />
              <span style={{ fontSize: '10px', color, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em' }}>
                {label}
              </span>
            </div>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {displayed.filter(e => e.beat === true).length} beat · {displayed.filter(e => e.beat === false).length} missed
          </span>
        </div>
      )}

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', letterSpacing: '0.1em' }}>
            {isIndia ? 'FETCHING INDIA EARNINGS...' : 'FETCHING EARNINGS DATA...'}
          </div>
        ) : displayed.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', lineHeight: 1.7 }}>
            {filter === 'upcoming'
              ? `No upcoming earnings in the next 30 days.`
              : `No recent results in the past 30 days.`}
            <br />
            <button onClick={() => setFilter('all')} style={{
              marginTop: '8px', padding: '4px 12px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
              border: '1px solid var(--teal)', background: 'rgba(0,229,192,0.08)', color: 'var(--teal)',
            }}>
              Show All ({earnings.length})
            </button>
          </div>
        ) : (
          displayed.map((e, i) => {
            const isToday = e.date === today
            const rel     = relDay(e.date)
            const surprise = epsSuprise(e.epsActual, e.epsEstimate)
            const hasBeat  = e.beat !== null
            const beaten   = e.beat === true

            // Color coding
            const leftBorderColor =
              isToday ? '#a78bfa' :
              hasBeat && beaten ? 'rgba(0,201,122,0.5)' :
              hasBeat && !beaten ? 'rgba(255,69,96,0.5)' :
              e.isFuture ? 'rgba(167,139,250,0.2)' :
              'transparent'

            return (
              <div key={`${e.symbol}-${e.date}-${i}`} style={{
                padding:      '9px 14px',
                borderBottom: '1px solid var(--border)',
                background:   isToday ? 'rgba(167,139,250,0.04)' : 'transparent',
                borderLeft:   `3px solid ${leftBorderColor}`,
              }}>
                {/* Row 1: Symbol + badges + time */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '13px', color: '#fff' }}>
                      {e.symbol}
                    </span>

                    {/* Beat/miss badge */}
                    {hasBeat && !e.isFuture && (
                      <span style={{
                        fontSize: '10px', padding: '2px 8px', borderRadius: '2px', fontWeight: 700,
                        background: beaten ? 'rgba(0,201,122,0.12)' : 'rgba(255,69,96,0.12)',
                        color:      beaten ? 'var(--positive)' : 'var(--negative)',
                        border:     `1px solid ${beaten ? 'rgba(0,201,122,0.3)' : 'rgba(255,69,96,0.3)'}`,
                        fontFamily: 'JetBrains Mono, monospace',
                      }}>
                        {beaten ? '▲ BEAT' : '▼ MISS'}
                      </span>
                    )}

                    {/* EPS surprise % */}
                    {surprise !== null && Math.abs(surprise) > 0.5 && (
                      <span style={{
                        fontSize: '10px', padding: '2px 7px', borderRadius: '2px',
                        fontFamily: 'JetBrains Mono, monospace',
                        color:     surprise >= 0 ? 'var(--positive)' : 'var(--negative)',
                        background: surprise >= 0 ? 'rgba(0,201,122,0.08)' : 'rgba(255,69,96,0.08)',
                      }}>
                        {surprise >= 0 ? '+' : ''}{surprise.toFixed(1)}%
                      </span>
                    )}

                    {/* Upcoming badge */}
                    {e.isFuture && (
                      <span style={{
                        fontSize: '10px', padding: '2px 8px', borderRadius: '2px',
                        fontFamily: 'JetBrains Mono, monospace',
                        background: 'rgba(167,139,250,0.1)', color: '#a78bfa',
                        border: '1px solid rgba(167,139,250,0.25)',
                      }}>
                        UPCOMING
                      </span>
                    )}

                    {/* Hour badge */}
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {e.hour === 'bmo' ? 'BMO' : e.hour === 'amc' ? 'AMC' : 'INTRA'}
                    </span>

                    {/* Quarter label for India */}
                    {isIndia && e.quarter && e.quarter !== 'Upcoming' && (
                      <span style={{ fontSize: '10px', color: '#f97316', fontFamily: 'JetBrains Mono, monospace' }}>
                        {e.quarter}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
                      color:      isToday ? '#a78bfa' : 'var(--text-muted)',
                      fontWeight: isToday ? 700 : 400,
                    }}>
                      {rel}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {fmtDate(e.date)}
                    </span>
                  </div>
                </div>

                {/* Row 2: Company name */}
                <div style={{ fontSize: '11px', color: 'var(--text-2)', fontFamily: 'Syne, sans-serif', marginBottom: '5px' }}>
                  {e.name}
                </div>

                {/* Row 3: EPS + Revenue data */}
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  {/* EPS Estimate */}
                  {e.epsEstimate !== null && (
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
                        EPS EST
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtEps(e.epsEstimate, isIndia ? '₹' : '$')}
                      </div>
                    </div>
                  )}

                  {/* EPS Actual */}
                  {!e.isFuture && e.epsActual !== null && (
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
                        EPS ACTUAL
                      </div>
                      <div style={{
                        fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                        color: e.beat === true ? 'var(--positive)' : e.beat === false ? 'var(--negative)' : 'var(--text-2)',
                      }}>
                        {fmtEps(e.epsActual, isIndia ? '₹' : '$')}
                      </div>
                    </div>
                  )}

                  {/* Revenue Estimate */}
                  {e.revenueEstimate !== null && (
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
                        REV EST
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtRevenue(e.revenueEstimate, isIndia)}
                      </div>
                    </div>
                  )}

                  {/* Revenue Actual */}
                  {!e.isFuture && e.revenueActual !== null && (
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
                        REV ACTUAL
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {fmtRevenue(e.revenueActual, isIndia)}
                      </div>
                    </div>
                  )}

                  {/* YoY Growth or surprise */}
                  {e.yoyGrowth !== null && e.yoyGrowth !== undefined && (
                    <div>
                      <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
                        SURPRISE
                      </div>
                      <div style={{
                        fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
                        color: e.yoyGrowth >= 0 ? 'var(--positive)' : 'var(--negative)',
                      }}>
                        {e.yoyGrowth >= 0 ? '+' : ''}{e.yoyGrowth.toFixed(1)}%
                      </div>
                    </div>
                  )}
                </div>

                {/* Row 4: EPS comparison bar (for results) */}
                {!e.isFuture && e.epsActual !== null && e.epsEstimate !== null && (
                  <div style={{ marginTop: '6px' }}>
                    <div style={{ height: '2px', background: 'var(--bg-deep)', borderRadius: '1px', overflow: 'hidden' }}>
                      {/* Visual beat/miss bar */}
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, Math.abs(epsSuprise(e.epsActual, e.epsEstimate) ?? 0) * 2 + 50)}%`,
                        background: e.beat ? 'var(--positive)' : 'var(--negative)',
                        borderRadius: '1px',
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}

        {/* India data note */}
        {isIndia && !loading && (
          <div style={{
            padding: '8px 14px', fontSize: '10px', color: 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.6,
            borderTop: '1px solid var(--border)',
          }}>
            🇮🇳 India earnings: Nifty 50 + Bank Nifty components · Via Yahoo Finance
            · Quarterly results per SEBI mandate · INR amounts
          </div>
        )}
      </div>
    </div>
  )
}