// AI analyst note types + client fetch (spec §3). The route at
// /api/chart-analysis returns this exact shape; the engine supplies the digest.

import type { DetectAllResult, Timeframe } from '@/lib/patterns'

export interface AiNote {
  bias:            'bullish' | 'bearish' | 'neutral'
  biasStrength?:   string
  headline:        string
  narrative:       string
  bullCase:        string
  bearCase:        string
  keyLevelToWatch: string
  riskNote:        string
}

export interface IndicatorSnapshot {
  rsi: number | null
  macdState: string
  volVs20: number | null
  atrPct: number | null
  distFrom50: number | null
  distFrom200: number | null
}

export interface ChartAnalysisRequest {
  symbol: string
  timeframe: Timeframe | string
  rating: DetectAllResult['rating']
  structure: DetectAllResult['structure']
  patterns: Array<Pick<
    DetectAllResult['geometric'][number],
    'id' | 'name' | 'direction' | 'status' | 'confidence' | 'breakoutLevel' | 'target' | 'invalidation' | 'implication'
  >>
  keyLevels: { support: number | null; resistance: number | null; fib?: number[] }
  indicatorSnapshot: IndicatorSnapshot
  lastClose: number
}

export async function fetchChartAnalysis(body: ChartAnalysisRequest, signal?: AbortSignal): Promise<AiNote> {
  const r = await fetch('/api/chart-analysis', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!r.ok) {
    const msg = await r.text().catch(() => '')
    throw new Error(msg || `Analysis failed (${r.status})`)
  }
  return r.json()
}
