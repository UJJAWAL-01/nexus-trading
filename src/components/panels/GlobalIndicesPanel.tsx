'use client'
// src/components/panels/GlobalIndicesPanel.tsx
// Before: 12 parallel fetch() calls every 15s per user = massive invocation cost
// After:  1 SWR call to /api/global-indices, 30s refresh, shared across all users

import { useMemo } from 'react'
import useSWR from 'swr'
import { TTL } from '@/lib/data-hooks'

interface QuoteData {
  symbol: string; label: string; flag: string
  price: number | null; change: number | null; digits: number
}

const SECTION_BREAKS: Record<string, string> = {
  '^NSEI':  '── INDIA ──────────────',
  '^N225':  '── ASIA ───────────────',
}

export default function GlobalIndicesPanel() {
  const { data, isLoading } = useSWR<{ quotes: QuoteData[]; lastUpdated: string }>(
    '/api/global-indices',
    { refreshInterval: TTL.FAST, dedupingInterval: 20_000 },
  )

  const quotes = useMemo(() => data?.quotes ?? [], [data])

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" />
        GLOBAL INDICES
        {isLoading && !quotes.length && (
          <span style={{ marginLeft: 'auto', fontSize: '8px', color: 'var(--text-muted)' }}>loading…</span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {quotes.map(q => {
          const isPos = (q.change ?? 0) >= 0
          const sectionLabel = SECTION_BREAKS[q.symbol]

          return (
            <div key={q.symbol}>
              {sectionLabel && (
                <div style={{
                  padding: '4px 14px', fontSize: '8px', color: 'var(--text-muted)',
                  letterSpacing: '0.12em', fontFamily: 'JetBrains Mono, monospace',
                  borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)',
                }}>
                  {sectionLabel}
                </div>
              )}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '7px 14px', borderBottom: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px' }}>{q.flag}</span>
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: '#fff' }}>
                    {q.label}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#fff' }}>
                    {q.price != null ? q.price.toFixed(q.digits) : '···'}
                  </div>
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: '10px',
                    color: q.change == null ? 'var(--text-muted)' : isPos ? 'var(--positive)' : 'var(--negative)',
                  }}>
                    {q.change != null ? `${isPos ? '+' : ''}${q.change.toFixed(2)}%` : '···'}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}