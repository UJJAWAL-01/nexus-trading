// src/lib/closes.ts
// Browser helper: daily closes for a list of symbols from the app's own
// keyless chart route, as [ISO date, close] rows per symbol. Shared by the
// analytics panels (risk, rotation) so they hit the same cached requests.

import { isoDay } from '@/lib/risk'

const CHUNK = 9          // the chart route accepts at most 10 symbols per request

interface ChartPayload {
  results?: Array<{ symbol: string; data?: { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> | null } } }>
}

export type CloseRows = Record<string, Array<[string, number]>>

export async function loadCloses(symbols: readonly string[], range: '6mo' | '1y' | '2y' = '1y'): Promise<CloseRows> {
  const chunks: string[][] = []
  for (let i = 0; i < symbols.length; i += CHUNK) chunks.push(symbols.slice(i, i + CHUNK))
  const out: CloseRows = {}
  await Promise.all(chunks.map(async chunk => {
    const r = await fetch(`/api/yfinance?symbols=${encodeURIComponent(chunk.join(','))}&range=${range}&interval=1d`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = (await r.json()) as ChartPayload
    for (const item of j.results ?? []) {
      const res = item.data?.chart?.result?.[0]
      const closes = res?.indicators?.quote?.[0]?.close
      if (!res?.timestamp || !closes) continue
      const rows: Array<[string, number]> = []
      res.timestamp.forEach((t, i) => { const c = closes[i]; if (typeof c === 'number' && c > 0) rows.push([isoDay(t), c]) })
      out[item.symbol] = rows
    }
  }))
  return out
}
