'use client'
// src/components/dashboard/MorningBrief.tsx
//
// Bloomberg "TOP" monitor analog. Slim pinned strip rendered above the panel
// grid, always visible (no scroll required during the trading session):
//
//   [● US OPEN 14:23 EST]   [↑ NVDA +3.2  ↓ TSLA -1.8  ↑ AAPL +0.9]   [⚠ NEXT · CPI in 2d 14h]   [F&G 67 GREED]
//
// Independent of the panel grid — uses its own fast endpoints with 60s caching.
// Failure-tolerant: each section degrades to a hyphen rather than crashing.

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { useWatchlist } from '@/store/watchlist'

const fetcher = (u: string) => fetch(u).then(r => r.ok ? r.json() : Promise.reject(r.status))

// ── Market sessions (NYSE + NSE) ────────────────────────────────────────────
type Session = 'pre' | 'open' | 'after' | 'closed'

interface MarketState { exchange: 'US' | 'IN'; session: Session; localTime: string }

function nowInTZ(tz: string): { h: number; m: number; dow: number; iso: string } {
  const d = new Date()
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, weekday: 'short',
    hour: '2-digit', minute: '2-digit',
  })
  const parts = fmt.formatToParts(d)
  const h = parseInt(parts.find(p => p.type === 'hour')!.value, 10) % 24
  const m = parseInt(parts.find(p => p.type === 'minute')!.value, 10)
  const wd = parts.find(p => p.type === 'weekday')!.value
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { h, m, dow: dowMap[wd] ?? 0, iso: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` }
}

function usSession(): MarketState {
  const t = nowInTZ('America/New_York')
  const mins = t.h * 60 + t.m
  const isWeekday = t.dow >= 1 && t.dow <= 5
  let session: Session = 'closed'
  if (isWeekday) {
    if      (mins >= 9*60+30 && mins < 16*60)  session = 'open'   // 9:30 → 16:00
    else if (mins >= 4*60    && mins < 9*60+30) session = 'pre'   // 04:00 → 09:30
    else if (mins >= 16*60   && mins < 20*60)   session = 'after' // 16:00 → 20:00
  }
  return { exchange: 'US', session, localTime: t.iso }
}

function inSession(): MarketState {
  const t = nowInTZ('Asia/Kolkata')
  const mins = t.h * 60 + t.m
  const isWeekday = t.dow >= 1 && t.dow <= 5
  let session: Session = 'closed'
  if (isWeekday) {
    if      (mins >= 9*60+15 && mins < 15*60+30) session = 'open' // 9:15 → 15:30
    else if (mins >= 9*60    && mins < 9*60+15)  session = 'pre'
  }
  return { exchange: 'IN', session, localTime: t.iso }
}

const SESSION_COLOR: Record<Session, string> = {
  open: '#00c97a', pre: '#f0a500', after: '#a78bfa', closed: '#6b7280',
}

const SESSION_LABEL: Record<Session, string> = {
  open: 'OPEN', pre: 'PRE-MKT', after: 'AFTER-HOURS', closed: 'CLOSED',
}

// ── Top movers from user watchlist ──────────────────────────────────────────
// Uses /api/yquote (same endpoint as WatchlistPanel) so the brief and the
// watchlist NEVER disagree. yquote returns regular-session change only;
// no pre/post-market noise. Field name is `change` (already a percentage).
interface Quote { symbol: string; changePercent: number | null; price: number | null }

function useMovers(): Quote[] {
  const symbols = useWatchlist(s => s.symbols)
  const slice = symbols.slice(0, 12)
  const key = slice.length > 0 ? `movers-yq:${slice.join(',')}` : null

  const { data } = useSWR<Quote[]>(key, async () => {
    const results = await Promise.all(slice.map(async sym => {
      try {
        const r = await fetch(`/api/yquote?symbol=${encodeURIComponent(sym)}`)
        if (!r.ok) return null
        const j = await r.json() as { price?: number | null; change?: number | null }
        if (typeof j.change !== 'number' || !Number.isFinite(j.change)) return null
        return {
          symbol: sym,
          changePercent: j.change,
          price:         typeof j.price === 'number' ? j.price : null,
        } as Quote
      } catch { return null }
    }))
    return results.filter((q): q is Quote => q !== null)
  }, { refreshInterval: 60_000, revalidateOnFocus: false, dedupingInterval: 30_000 })

  return useMemo(() => {
    if (!data) return []
    // Only show movers with |change| ≥ 0.1% — silence inert symbols (e.g. closed markets)
    return [...data]
      .filter(q => Math.abs(q.changePercent ?? 0) >= 0.1)
      .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
      .slice(0, 3)
  }, [data])
}

// ── Next event from econ calendar ───────────────────────────────────────────
// /api/economic-calender returns { events: CalEvent[] } where date and time
// are separate fields ("2026-04-25" + "13:30"). Combine them as UTC for
// reliable countdown across user timezones.
interface EconEvent { date: string; time?: string; title: string; impact?: string }

function eventTimestamp(e: EconEvent): number {
  if (!e.date) return NaN
  // Treat as UTC if no offset present — calendar APIs typically publish in UTC
  const iso = e.time ? `${e.date}T${e.time}:00Z` : `${e.date}T00:00:00Z`
  return new Date(iso).getTime()
}

function useNextEvent(): { event: EconEvent; ts: number } | null {
  const { data } = useSWR<{ events?: EconEvent[] }>('/api/economic-calender', fetcher, {
    refreshInterval: 60 * 60_000, revalidateOnFocus: false, dedupingInterval: 30 * 60_000,
  })
  return useMemo(() => {
    if (!data?.events) return null
    const now = Date.now()
    const future = data.events
      .map(e => ({ event: e, ts: eventTimestamp(e) }))
      .filter(({ ts, event }) => Number.isFinite(ts) && ts > now &&
                                  (!event.impact || event.impact.toLowerCase() === 'high'))
      .sort((a, b) => a.ts - b.ts)
    return future[0] ?? null
  }, [data])
}

function formatCountdown(ts: number): string {
  const ms = ts - Date.now()
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const m = Math.floor(ms / 60_000)
  if (m < 60)        return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48)        return `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

// ── Component ───────────────────────────────────────────────────────────────
export default function MorningBrief() {
  // Tick every 30s so the session/clock/countdown stay live
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTick(t => t + 1), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const us = usSession()
  const ind = inSession()
  const movers = useMovers()
  const nextEvent = useNextEvent()

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '14px',
      padding: '5px 10px',
      background: 'linear-gradient(180deg, rgba(167,139,250,0.04), transparent)',
      borderBottom: '1px solid var(--border)',
      fontFamily:   'JetBrains Mono, monospace',
      fontSize:     '11px',
      overflow:     'hidden',
      whiteSpace:   'nowrap',
      flexWrap:     'wrap',
      rowGap:       '4px',
    }}>
      {/* Market sessions */}
      <SessionBadge state={us} />
      <SessionBadge state={ind} />

      <Sep />

      {/* Movers */}
      <span style={{ color: 'var(--text-muted)', letterSpacing: '0.1em', fontSize: '10px' }}>
        MOVERS
      </span>
      {movers.length === 0 ? (
        <span style={{ color: 'var(--text-muted)' }}>—</span>
      ) : movers.map(m => {
        const v = m.changePercent ?? 0
        const up = v >= 0
        return (
          <span key={m.symbol} style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
          }}>
            <span style={{ color: up ? '#00c97a' : '#ef4444' }}>{up ? '↑' : '↓'}</span>
            <span style={{ color: '#fff', fontWeight: 700 }}>{m.symbol}</span>
            <span style={{ color: up ? '#00c97a' : '#ef4444', fontWeight: 700 }}>
              {up ? '+' : ''}{v.toFixed(2)}%
            </span>
          </span>
        )
      })}

      <Sep />

      {/* Next event */}
      <span style={{ color: 'var(--text-muted)', letterSpacing: '0.1em', fontSize: '10px' }}>
        NEXT
      </span>
      {nextEvent ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ color: '#f0a500' }}>⚠</span>
          <span style={{ color: '#fff', fontWeight: 700, maxWidth: '220px',
                         overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {nextEvent.event.title}
          </span>
          <span style={{ color: '#f0a500', fontWeight: 700 }}>
            in {formatCountdown(nextEvent.ts)}
          </span>
        </span>
      ) : (
        <span style={{ color: 'var(--text-muted)' }}>—</span>
      )}

      <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: '10px',
                     letterSpacing: '0.08em' }}>
        TOP · live · {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

// ── Pieces ──────────────────────────────────────────────────────────────────
function SessionBadge({ state }: { state: MarketState }) {
  const c = SESSION_COLOR[state.session]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '5px',
      padding: '2px 7px', borderRadius: '3px',
      background: `${c}10`, border: `1px solid ${c}40`,
    }}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%', background: c,
        boxShadow: state.session === 'open' ? `0 0 6px ${c}` : 'none',
        animation: state.session === 'open' ? 'mb-pulse 2s ease-in-out infinite' : 'none',
      }} />
      <span style={{ color: c, fontWeight: 700, letterSpacing: '0.06em' }}>{state.exchange}</span>
      <span style={{ color: '#fff', fontWeight: 700 }}>{SESSION_LABEL[state.session]}</span>
      <span style={{ color: 'var(--text-muted)' }}>{state.localTime}</span>
      <style>{`@keyframes mb-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }`}</style>
    </span>
  )
}

function Sep() {
  return <span style={{ color: 'var(--border)', userSelect: 'none' }}>│</span>
}
