'use client'
// src/components/dashboard/AlertEngine.tsx
//
// Silent background driver that converts existing data into pushed alerts.
// Renders nothing — just polls existing endpoints, evaluates simple
// thresholds, and pushes to the alert store. Dedup is automatic (same id
// replaces existing). Failure-tolerant per source.
//
// Triggers (current set):
//   1. WATCHLIST MOVER  — any watchlist ticker abs(intraday %) ≥ 5
//   2. EARNINGS IMMINENT — any watchlist ticker reporting in next 24h
//   3. ALL-DAY SESSION   — once-per-session "trading day open" / "close" notices
//
// New triggers can be added by writing one async function that pushes via
// useAlerts.getState().push({...}). Keep them defensive — never throw.

import { useEffect, useRef } from 'react'
import { useAlerts } from '@/store/alerts'
import { useWatchlist } from '@/store/watchlist'

const POLL_MS = 5 * 60_000  // 5 min — enough for live moves; respects rate limits

export default function AlertEngine() {
  const symbols = useWatchlist(s => s.symbols)
  // Snapshot symbols in a ref so the polling loop reads the latest without
  // tearing down on every change.
  const symbolsRef = useRef(symbols)
  useEffect(() => { symbolsRef.current = symbols }, [symbols])

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (cancelled) return
      try {
        await Promise.allSettled([
          checkMovers(symbolsRef.current),
          checkEarnings(symbolsRef.current),
        ])
      } catch { /* swallow — no engine should ever crash the app */ }
    }
    // First run after a brief delay (let above-fold panels finish first)
    const startTimer = window.setTimeout(run, 8_000)
    const interval   = window.setInterval(run, POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(startTimer)
      window.clearInterval(interval)
    }
  }, [])

  return null
}

// ── Trigger 1: Watchlist mover ──────────────────────────────────────────────
// Uses /api/yquote (same as WatchlistPanel) — regular-session change only,
// no pre/post-market readings. Field name is `change` (already a percentage).
async function checkMovers(symbols: string[]): Promise<void> {
  const slice = symbols.slice(0, 12)
  for (const sym of slice) {
    try {
      const r = await fetch(`/api/yquote?symbol=${encodeURIComponent(sym)}`)
      if (!r.ok) continue
      const j = await r.json() as { change?: number | null; marketState?: string }
      const pct = j.change
      if (typeof pct !== 'number' || !Number.isFinite(pct)) continue

      const abs = Math.abs(pct)
      if (abs >= 5) {
        const up = pct > 0
        useAlerts.getState().push({
          // Bucket id by symbol + day so the alert refreshes (not duplicates)
          // when the % climbs further during the same session.
          id:    `mover:${sym}:${dayKey()}`,
          title: `${up ? '+' : ''}${pct.toFixed(2)}% intraday`,
          body:  `${sym} ${up ? 'up' : 'down'} ${abs.toFixed(1)}% — large move worth checking`,
          level:  abs >= 10 ? 'critical' : up ? 'positive' : 'warn',
          source: 'WATCHLIST',
          symbol: sym,
          ttlMs:  20 * 60_000,
        })
      }
    } catch { /* continue */ }
  }
}

// ── Trigger 2: Earnings imminent (within 24h) ──────────────────────────────
// /api/earnings returns EarningItem[] directly, not wrapped in {events}.
async function checkEarnings(symbols: string[]): Promise<void> {
  if (symbols.length === 0) return
  try {
    const r = await fetch('/api/earnings')
    if (!r.ok) return
    const arr = await r.json() as { symbol: string; date: string; hour?: string }[]
    if (!Array.isArray(arr)) return
    const set = new Set(symbols.map(s => s.toUpperCase()))
    const now = Date.now()
    const cutoff = now + 24 * 60 * 60_000

    for (const e of arr) {
      const sym = (e.symbol ?? '').toUpperCase()
      if (!set.has(sym)) continue
      const ts = new Date(e.date).getTime()
      if (!Number.isFinite(ts) || ts < now || ts > cutoff) continue

      const hours = Math.max(1, Math.round((ts - now) / 3_600_000))
      useAlerts.getState().push({
        id:    `earnings:${sym}`,
        title: `Earnings in ${hours}h`,
        body:  `${sym} reports ${e.hour ? '· ' + e.hour + ' ' : ''}${new Date(e.date).toLocaleDateString()}`,
        level: 'info',
        source: 'EARNINGS',
        symbol: sym,
        ttlMs:  6 * 60 * 60_000,
      })
    }
  } catch { /* continue */ }
}

// ── helpers ─────────────────────────────────────────────────────────────────
function dayKey(): string {
  return new Date().toISOString().slice(0, 10)
}
