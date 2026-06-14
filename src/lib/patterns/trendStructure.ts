// Market-structure classification (spec §1.5).
//
// From the k=5 zigzag: Uptrend (HH+HL), Downtrend (LH+LL), or Range. Reports the
// last 4 structural points, the most recent BOS (break of structure) / CHoCH
// (change of character), and the nearest structural support/resistance.

import type { Candle, PivotPoint, TrendStructure, StructuralEvent, TrendBias } from './types'
import type { PivotTiers } from './pivots'

function tag(prev: PivotPoint | undefined, cur: PivotPoint): 'HH' | 'LH' | 'HL' | 'LL' | '' {
  if (!prev) return ''
  if (cur.type === 'high') return cur.price > prev.price ? 'HH' : 'LH'
  return cur.price > prev.price ? 'HL' : 'LL'
}

export function analyzeStructure(candles: Candle[], tiers: PivotTiers): TrendStructure {
  const chain = tiers.k5
  const highs = chain.filter(p => p.type === 'high')
  const lows = chain.filter(p => p.type === 'low')
  const lastClose = candles[candles.length - 1]?.close ?? 0

  if (chain.length < 2 || highs.length < 1 || lows.length < 1) {
    return {
      bias: 'range', swingPoints: chain.slice(-4), lastEvent: null,
      support: lows.length ? lows[lows.length - 1].price : null,
      resistance: highs.length ? highs[highs.length - 1].price : null,
      label: 'Range',
    }
  }

  const hh = highs.length >= 2 ? highs[highs.length - 1].price > highs[highs.length - 2].price : null
  const hl = lows.length >= 2 ? lows[lows.length - 1].price > lows[lows.length - 2].price : null

  let bias: TrendBias = 'range'
  if (hh === true && hl === true) bias = 'uptrend'
  else if (hh === false && hl === false) bias = 'downtrend'

  // Most recent structural event: did the latest swing break the prior same-type
  // extreme (BOS, trend continuation) or the opposite structure (CHoCH)?
  let lastEvent: StructuralEvent | null = null
  const lastPivot = chain[chain.length - 1]
  if (lastPivot.type === 'high' && highs.length >= 2) {
    const prevHigh = highs[highs.length - 2]
    if (lastPivot.price > prevHigh.price) {
      lastEvent = {
        type: bias === 'downtrend' ? 'CHoCH' : 'BOS',
        time: lastPivot.time, price: prevHigh.price, direction: 'bullish',
      }
    }
  } else if (lastPivot.type === 'low' && lows.length >= 2) {
    const prevLow = lows[lows.length - 2]
    if (lastPivot.price < prevLow.price) {
      lastEvent = {
        type: bias === 'uptrend' ? 'CHoCH' : 'BOS',
        time: lastPivot.time, price: prevLow.price, direction: 'bearish',
      }
    }
  }

  const swingPoints = chain.slice(-4)
  const label = swingPoints.map((p, i) => tag(swingPoints[i - 1], p)).filter(Boolean).join(' · ')
    || (bias === 'uptrend' ? 'Uptrend' : bias === 'downtrend' ? 'Downtrend' : 'Range')

  // Nearest structural SR relative to current price.
  const supports = lows.map(l => l.price).filter(p => p <= lastClose)
  const resistances = highs.map(h => h.price).filter(p => p >= lastClose)
  const support = supports.length ? Math.max(...supports) : lows[lows.length - 1].price
  const resistance = resistances.length ? Math.min(...resistances) : highs[highs.length - 1].price

  return { bias, swingPoints, lastEvent, support, resistance, label }
}
