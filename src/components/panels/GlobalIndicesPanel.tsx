'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { TTL } from '@/lib/data-hooks'

interface QuoteData {
  symbol: string; label: string; flag: string
  price: number | null; change: number | null; digits: number
}

const SECTION_BREAKS: Record<string, string> = {
  '^NSEI':  'INDIA',
  '^N225':  'ASIA / PACIFIC',
}

export default function GlobalIndicesPanel() {
  const { data, isLoading } = useSWR<{ quotes: QuoteData[]; lastUpdated: string }>(
    '/api/global-indices',
    { refreshInterval: TTL.FAST, dedupingInterval: 20_000 },
  )
  const [hovered, setHovered] = useState<string | null>(null)

  const quotes = useMemo(() => data?.quotes ?? [], [data])

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <div className="dot" style={{ background: '#4da6ff' }} />
        GLOBAL INDICES
        {isLoading && !quotes.length && (
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            loading…
          </span>
        )}
        {data?.lastUpdated && !isLoading && (
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace' }}>
            live
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {quotes.map(q => {
          const isPos = (q.change ?? 0) >= 0
          const sectionLabel = SECTION_BREAKS[q.symbol]
          const isHov = hovered === q.symbol

          return (
            <div key={q.symbol}>
              {sectionLabel && (
                <div className="nx-section">
                  {sectionLabel}
                </div>
              )}
              <div
                onMouseEnter={() => setHovered(q.symbol)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 14px', borderBottom: '1px solid var(--border)',
                  background: isHov ? 'rgba(255,255,255,0.025)' : 'transparent',
                  transition: 'background 0.12s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px' }}>{q.flag}</span>
                  <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>
                    {q.label}
                  </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>
                    {q.price != null ? q.price.toLocaleString('en-US', { maximumFractionDigits: q.digits }) : '···'}
                  </div>
                  <div style={{
                    fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
                    color: q.change == null ? 'var(--text-muted)' : isPos ? 'var(--positive)' : 'var(--negative)',
                  }}>
                    {q.change != null ? `${isPos ? '+' : ''}${q.change.toFixed(2)}%` : '···'}
                  </div>
                </div>
              </div>
            </div>
          )
        })}

        {quotes.length === 0 && !isLoading && (
          <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }}>
            No data available
          </div>
        )}
      </div>
    </div>
  )
}