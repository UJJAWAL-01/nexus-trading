// src/lib/backtest.ts
// Strategy backtester. Runs entirely in the browser on candles the chart
// already loads: no server, no key, no cost. Pure functions, unit-tested.
//
// Honesty rules built into the engine:
//   • NO LOOK-AHEAD. A signal is decided on bar i's close and executed at bar
//     i+1's OPEN. A strategy can never trade on a price it could not have seen.
//   • COSTS COUNT. Every entry and exit pays `costBps` (commission + slippage).
//   • ALWAYS SHOW THE BENCHMARK. Results are reported next to buy-and-hold over
//     the same bars, because most strategies do not beat it.
//   • Long-only, fully invested or flat. No leverage, no shorting.

import type { Candle } from './patterns/types'
import { smaSeries, rsiSeries } from './patterns/indicators'

export type StrategyId = 'sma-cross' | 'rsi-reversion' | 'donchian-breakout'

export interface StrategyConfig {
  id: StrategyId
  /** sma-cross: fast/slow periods. */
  fast?: number
  slow?: number
  /** rsi-reversion: period and thresholds. */
  rsiPeriod?: number
  buyBelow?:  number
  sellAbove?: number
  /** donchian-breakout: entry/exit channel lengths. */
  entryLen?: number
  exitLen?:  number
}

export const STRATEGIES: Record<StrategyId, { label: string; description: string; defaults: StrategyConfig }> = {
  'sma-cross': {
    label: 'Moving-average crossover',
    description: 'Long while the fast average is above the slow average; flat otherwise.',
    defaults: { id: 'sma-cross', fast: 50, slow: 200 },
  },
  'rsi-reversion': {
    label: 'RSI mean reversion',
    description: 'Buy when RSI falls below the lower threshold; sell when it rises above the upper one.',
    defaults: { id: 'rsi-reversion', rsiPeriod: 14, buyBelow: 30, sellAbove: 55 },
  },
  'donchian-breakout': {
    label: 'Donchian channel breakout',
    description: 'Buy a close above the highest high of the entry window; sell a close below the lowest low of the exit window.',
    defaults: { id: 'donchian-breakout', entryLen: 55, exitLen: 20 },
  },
}

const int = (n: number | undefined, fallback: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.round(Number.isFinite(n as number) ? (n as number) : fallback)))

/**
 * Desired position after each bar's close: true = hold the asset.
 * `out[i]` uses only candles[0..i].
 */
export function computeSignals(candles: readonly Candle[], cfg: StrategyConfig): boolean[] {
  const n = candles.length
  const out = new Array<boolean>(n).fill(false)
  const closes = candles.map(c => c.close)

  if (cfg.id === 'sma-cross') {
    const fast = int(cfg.fast, 50, 2, 400), slow = int(cfg.slow, 200, 3, 600)
    if (fast >= slow) return out
    const f = smaSeries(closes, fast), s = smaSeries(closes, slow)
    for (let i = 0; i < n; i++) out[i] = f[i] !== null && s[i] !== null && (f[i] as number) > (s[i] as number)
    return out
  }

  if (cfg.id === 'rsi-reversion') {
    const period = int(cfg.rsiPeriod, 14, 2, 100)
    const lo = Math.min(99, Math.max(1, cfg.buyBelow ?? 30)), hi = Math.min(99, Math.max(1, cfg.sellAbove ?? 55))
    const r = rsiSeries(closes, period)
    let holding = false
    for (let i = 0; i < n; i++) {
      const v = r[i]
      if (v !== null) {
        if (!holding && v < lo) holding = true
        else if (holding && v > hi) holding = false
      }
      out[i] = holding
    }
    return out
  }

  // donchian-breakout
  const entry = int(cfg.entryLen, 55, 2, 400), exit = int(cfg.exitLen, 20, 2, 400)
  let holding = false
  for (let i = 0; i < n; i++) {
    if (i >= entry) {
      // Channel is built from PRIOR bars only (i-entry … i-1).
      let hh = -Infinity
      for (let j = i - entry; j < i; j++) hh = Math.max(hh, candles[j].high)
      if (!holding && candles[i].close > hh) holding = true
    }
    if (holding && i >= exit) {
      let ll = Infinity
      for (let j = i - exit; j < i; j++) ll = Math.min(ll, candles[j].low)
      if (candles[i].close < ll) holding = false
    }
    out[i] = holding
  }
  return out
}

export interface Trade {
  entryTime:  number
  entryPrice: number
  exitTime:   number | null     // null = still open at the end of the data
  exitPrice:  number | null
  returnPct:  number            // net of costs
  bars:       number
}

export interface Stats {
  totalReturnPct: number
  cagrPct:        number | null
  maxDrawdownPct: number        // negative number
  volatilityPct:  number | null // annualised
  sharpe:         number | null // risk-free rate assumed 0
}

export interface BacktestResult {
  bars:        number
  years:       number
  strategy:    Stats
  benchmark:   Stats            // buy-and-hold over the same bars
  trades:      Trade[]
  winRatePct:  number | null
  profitFactor: number | null
  exposurePct: number           // share of bars spent in the market
  equity:      number[]         // strategy equity per bar, starts at 1
  benchEquity: number[]         // buy-and-hold equity per bar, starts at 1
  times:       number[]
}

function stats(equity: number[], years: number): Stats {
  const n = equity.length
  const total = equity[n - 1] / equity[0] - 1
  let peak = equity[0], maxDd = 0
  const rets: number[] = []
  for (let i = 1; i < n; i++) {
    peak = Math.max(peak, equity[i])
    maxDd = Math.min(maxDd, equity[i] / peak - 1)
    rets.push(equity[i] / equity[i - 1] - 1)
  }
  let vol: number | null = null, sharpe: number | null = null
  if (rets.length >= 20 && years > 0) {
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1)
    const sd = Math.sqrt(variance)
    const perYear = rets.length / years
    vol = sd * Math.sqrt(perYear) * 100
    sharpe = sd > 0 ? (mean / sd) * Math.sqrt(perYear) : null
  }
  return {
    totalReturnPct: total * 100,
    cagrPct:        years >= 0.25 && equity[n - 1] > 0 ? (Math.pow(equity[n - 1] / equity[0], 1 / years) - 1) * 100 : null,
    maxDrawdownPct: maxDd * 100,
    volatilityPct:  vol,
    sharpe,
  }
}

export const MIN_BARS = 60

/** Returns null when there is not enough clean data to say anything meaningful. */
export function runBacktest(input: readonly Candle[], cfg: StrategyConfig, opts: { costBps?: number } = {}): BacktestResult | null {
  const candles = input.filter(c =>
    Number.isFinite(c.open) && Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low) && c.open > 0 && c.close > 0)
  const n = candles.length
  if (n < MIN_BARS) return null

  const cost = Math.min(500, Math.max(0, opts.costBps ?? 5)) / 10_000
  const signal = computeSignals(candles, cfg)

  const equity = new Array<number>(n).fill(1)
  const benchEquity = candles.map(c => c.close / candles[0].close)
  const trades: Trade[] = []

  let cash = 1, units = 0, inBars = 0
  let open: { time: number; price: number; index: number; value: number } | null = null

  for (let i = 0; i < n; i++) {
    // Act at this bar's OPEN on the decision made at the previous close.
    const want = i > 0 ? signal[i - 1] : false
    if (want && units === 0) {
      const price = candles[i].open
      const invest = cash * (1 - cost)
      open = { time: candles[i].time, price, index: i, value: cash }
      units = invest / price
      cash = 0
    } else if (!want && units > 0 && open) {
      const price = candles[i].open
      cash = units * price * (1 - cost)
      trades.push({ entryTime: open.time, entryPrice: open.price, exitTime: candles[i].time, exitPrice: price, returnPct: (cash / open.value - 1) * 100, bars: i - open.index })
      units = 0
      open = null
    }
    if (units > 0) inBars++
    equity[i] = cash + units * candles[i].close
  }
  if (units > 0 && open) {
    // Mark the open position to the last close (no exit cost charged: it has not been sold).
    trades.push({ entryTime: open.time, entryPrice: open.price, exitTime: null, exitPrice: null, returnPct: (equity[n - 1] / open.value - 1) * 100, bars: n - 1 - open.index })
  }

  const years = Math.max(0, (candles[n - 1].time - candles[0].time) / (365.25 * 86_400))
  const closed = trades.filter(t => t.exitTime !== null)
  const wins = closed.filter(t => t.returnPct > 0)
  const grossWin = wins.reduce((a, t) => a + t.returnPct, 0)
  const grossLoss = closed.filter(t => t.returnPct <= 0).reduce((a, t) => a - t.returnPct, 0)

  return {
    bars: n,
    years,
    strategy:     stats(equity, years),
    benchmark:    stats(benchEquity, years),
    trades,
    winRatePct:   closed.length ? (wins.length / closed.length) * 100 : null,
    profitFactor: closed.length && grossLoss > 0 ? grossWin / grossLoss : null,
    exposurePct:  (inBars / n) * 100,
    equity,
    benchEquity,
    times: candles.map(c => c.time),
  }
}
