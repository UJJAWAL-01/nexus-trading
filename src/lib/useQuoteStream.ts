'use client'
// src/lib/useQuoteStream.ts
// Live quotes for a set of symbols over ONE Server-Sent Events connection
// (/api/stream/quotes). If the stream cannot be established (old proxy,
// platform without streaming, limits reached) it falls back to polling
// /api/yquote, so a panel using this hook always gets data.

import { useEffect, useMemo, useState } from 'react'

export interface LiveQuote {
  symbol:      string
  price:       number | null
  change:      number | null
  changeAbs:   number | null
  currency:    string
  marketState: string
  ts:          number
}

export type StreamStatus = 'connecting' | 'live' | 'polling' | 'idle'

const MAX_SYMBOLS      = 25
const POLL_MS          = 20_000
const ERRORS_TO_FALLBACK = 3

export function useQuoteStream(symbols: readonly string[]): {
  quotes: Record<string, LiveQuote>
  status: StreamStatus
} {
  // Stable, order-independent key so re-renders do not reconnect the stream.
  const key = useMemo(
    () => Array.from(new Set(symbols.map(s => s.trim()).filter(Boolean))).sort().slice(0, MAX_SYMBOLS).join(','),
    [symbols],
  )

  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({})
  const [status, setStatus] = useState<StreamStatus>('connecting')

  useEffect(() => {
    if (!key) return
    const list = key.split(',')
    let cancelled = false
    let source: EventSource | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let errors = 0

    const merge = (incoming: LiveQuote[]) => {
      if (cancelled || !incoming.length) return
      setQuotes(prev => {
        const next = { ...prev }
        for (const q of incoming) if (q && typeof q.symbol === 'string') next[q.symbol] = q
        return next
      })
    }

    const poll = async () => {
      const results = await Promise.all(list.map(async symbol => {
        try {
          const r = await fetch(`/api/yquote?symbol=${encodeURIComponent(symbol)}`)
          if (!r.ok) return null
          const j = await r.json()
          if (typeof j?.price !== 'number') return null
          return {
            symbol, price: j.price, change: j.change ?? null, changeAbs: j.changeAbs ?? null,
            currency: j.currency ?? 'USD', marketState: j.marketState ?? 'UNKNOWN', ts: Date.now(),
          } as LiveQuote
        } catch { return null }
      }))
      merge(results.filter((q): q is LiveQuote => q !== null))
    }

    const startPolling = () => {
      if (cancelled || pollTimer) return
      source?.close()
      source = null
      setStatus('polling')
      void poll()
      pollTimer = setInterval(() => { if (!document.hidden) void poll() }, POLL_MS)
    }

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    if (typeof EventSource === 'undefined') {
      fallbackTimer = setTimeout(startPolling, 0)
    } else {
      source = new EventSource(`/api/stream/quotes?symbols=${encodeURIComponent(key)}`)
      source.addEventListener('quotes', ev => {
        errors = 0
        if (!cancelled) setStatus('live')
        try { merge(JSON.parse((ev as MessageEvent<string>).data) as LiveQuote[]) } catch { /* ignore bad frame */ }
      })
      source.onopen = () => { if (!cancelled) setStatus('live') }
      source.onerror = () => {
        // EventSource retries by itself; only give up after repeated failures.
        errors++
        if (errors >= ERRORS_TO_FALLBACK) startPolling()
        else if (!cancelled) setStatus('connecting')
      }
    }

    return () => {
      cancelled = true
      source?.close()
      if (pollTimer) clearInterval(pollTimer)
      if (fallbackTimer) clearTimeout(fallbackTimer)
    }
  }, [key])

  // Report 'idle' and no quotes when there is nothing to watch, without
  // resetting state from inside the effect.
  const active = key.length > 0
  return { quotes: active ? quotes : EMPTY, status: active ? status : 'idle' }
}

const EMPTY: Record<string, LiveQuote> = {}
