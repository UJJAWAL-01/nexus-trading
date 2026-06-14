// Composite Technical Rating (spec §1.4) — TradingView-style.
//
// 12 moving-average votes + 10 oscillator votes → per-group and overall scores
// mapped to Strong Sell … Strong Buy. The full per-indicator breakdown is
// returned for the UI table.

import type {
  Candle, TaRating, RatingGroup, IndicatorVote, RatingSignal, RatingLabel,
} from './types'
import {
  smaSeries, emaSeries, rsiSeries, macd, stochastic, cci, williamsR,
  momentum, adx, stochRsi, ultimateOscillator, awesomeOscillator,
} from './indicators'

const NEUTRAL_BAND = 0.001  // 0.1% around an MA counts as neutral

function maVote(label: string, id: string, price: number, ma: number | null): IndicatorVote {
  if (ma == null) return { id, label, value: null, signal: 'neutral' }
  const diff = (price - ma) / ma
  const signal: RatingSignal = diff > NEUTRAL_BAND ? 'buy' : diff < -NEUTRAL_BAND ? 'sell' : 'neutral'
  return { id, label, value: +ma.toFixed(2), signal }
}

function groupOf(votes: IndicatorVote[]): RatingGroup {
  let buys = 0, sells = 0, neutrals = 0
  for (const v of votes) {
    if (v.signal === 'buy') buys++
    else if (v.signal === 'sell') sells++
    else neutrals++
  }
  const total = votes.length || 1
  const score = (buys - sells) / total
  return { score, buys, sells, neutrals, label: labelFor(score), votes }
}

export function labelFor(score: number): RatingLabel {
  if (score > 0.5) return 'strong_buy'
  if (score > 0.1) return 'buy'
  if (score >= -0.1) return 'neutral'
  if (score >= -0.5) return 'sell'
  return 'strong_sell'
}

export function computeRating(candles: Candle[]): TaRating {
  const close = candles.map(c => c.close)
  const price = close[close.length - 1] ?? 0
  const lastOf = (s: Array<number | null>) => s[s.length - 1] ?? null

  // ── Moving averages (12) ──────────────────────────────────────────────────
  const maPeriods = [10, 20, 30, 50, 100, 200]
  const maVotes: IndicatorVote[] = []
  for (const p of maPeriods) maVotes.push(maVote(`SMA ${p}`, `SMA${p}`, price, lastOf(smaSeries(close, p))))
  for (const p of maPeriods) maVotes.push(maVote(`EMA ${p}`, `EMA${p}`, price, lastOf(emaSeries(close, p))))

  // ── Oscillators (10) ────────────────────────────────────────────────────
  const oscVotes: IndicatorVote[] = []
  const push = (id: string, label: string, value: number | null, signal: RatingSignal) =>
    oscVotes.push({ id, label, value: value == null ? null : +value.toFixed(2), signal })

  // RSI with rising-from-oversold nuance
  const rsiS = rsiSeries(close, 14)
  const rsiV = lastOf(rsiS); const rsiPrev = rsiS.length >= 2 ? rsiS[rsiS.length - 2] : null
  push('RSI', 'RSI (14)', rsiV,
    rsiV == null ? 'neutral'
      : rsiV < 30 ? 'buy'
      : rsiV > 70 ? 'sell'
      : rsiV < 45 && rsiPrev != null && rsiV > rsiPrev ? 'buy'
      : 'neutral')

  // Stochastic %K/%D
  const st = stochastic(candles)
  push('STOCH', 'Stoch %K', st?.k ?? null,
    !st ? 'neutral' : st.k < 20 && st.k > st.d ? 'buy' : st.k > 80 && st.k < st.d ? 'sell' : 'neutral')

  // CCI(20) with direction
  const cciS: Array<number | null> = []
  for (let i = 0; i < candles.length; i++) cciS.push(cci(candles.slice(0, i + 1), 20))
  const cciV = lastOf(cciS), cciPrev = cciS.length >= 2 ? cciS[cciS.length - 2] : null
  push('CCI', 'CCI (20)', cciV,
    cciV == null ? 'neutral'
      : cciV < -100 && cciPrev != null && cciV > cciPrev ? 'buy'
      : cciV > 100 && cciPrev != null && cciV < cciPrev ? 'sell'
      : cciV < -100 ? 'buy' : cciV > 100 ? 'sell' : 'neutral')

  // ADX + DI
  const adxV = adx(candles)
  push('ADX', 'ADX (14)', adxV?.adx ?? null,
    !adxV ? 'neutral' : adxV.adx > 20 && adxV.plusDI > adxV.minusDI ? 'buy'
      : adxV.adx > 20 && adxV.minusDI > adxV.plusDI ? 'sell' : 'neutral')

  // Momentum(10)
  const momV = momentum(close, 10)
  push('MOM', 'Momentum (10)', momV, momV == null ? 'neutral' : momV > 0 ? 'buy' : momV < 0 ? 'sell' : 'neutral')

  // MACD(12,26,9)
  const m = macd(close)
  push('MACD', 'MACD (12,26,9)', m?.hist ?? null, !m ? 'neutral' : m.macd > m.signal ? 'buy' : m.macd < m.signal ? 'sell' : 'neutral')

  // Williams %R
  const wr = williamsR(candles)
  push('WILLR', 'Williams %R', wr, wr == null ? 'neutral' : wr < -80 ? 'buy' : wr > -20 ? 'sell' : 'neutral')

  // Stoch RSI
  const sr = stochRsi(close)
  push('STOCHRSI', 'Stoch RSI', sr, sr == null ? 'neutral' : sr < 20 ? 'buy' : sr > 80 ? 'sell' : 'neutral')

  // Ultimate Oscillator
  const uo = ultimateOscillator(candles)
  push('UO', 'Ultimate Osc.', uo, uo == null ? 'neutral' : uo < 30 ? 'buy' : uo > 70 ? 'sell' : 'neutral')

  // Awesome Oscillator
  const ao = awesomeOscillator(candles)
  push('AO', 'Awesome Osc.', ao?.value ?? null,
    !ao ? 'neutral' : ao.value > 0 && ao.rising ? 'buy' : ao.value < 0 && !ao.rising ? 'sell' : 'neutral')

  const movingAvg = groupOf(maVotes)
  const oscillators = groupOf(oscVotes)
  const overall = groupOf([...maVotes, ...oscVotes])
  return { overall, movingAvg, oscillators }
}
