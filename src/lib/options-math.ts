// Real BSM, Newton-Raphson IV, analytical Greeks, Binomial (American), Monte Carlo
// No placeholders — all production math

export function normalCDF(x: number): number {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429]
  const p = 0.3275911
  const sign = x < 0 ? -1 : 1
  const t = 1 / (1 + (p * Math.abs(x)) / Math.SQRT2)
  const y = 1 - ((((a[4]*t + a[3])*t + a[2])*t + a[1])*t + a[0]) * t * Math.exp(-x*x/2)
  return 0.5 * (1 + sign * y)
}

export function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

export interface BSMInput {
  S: number      // spot
  K: number      // strike
  T: number      // years to expiry
  r: number      // risk-free (annual decimal)
  sigma: number  // volatility (annual decimal)
  q?: number     // dividend yield
}

export interface BSMOutput { call: number; put: number; d1: number; d2: number }

export function bsm(p: BSMInput): BSMOutput {
  const q = p.q ?? 0
  if (p.T <= 0) return { call: Math.max(p.S - p.K, 0), put: Math.max(p.K - p.S, 0), d1: 0, d2: 0 }
  const sqT = Math.sqrt(p.T)
  const d1  = (Math.log(p.S / p.K) + (p.r - q + 0.5 * p.sigma * p.sigma) * p.T) / (p.sigma * sqT)
  const d2  = d1 - p.sigma * sqT
  const Eq  = Math.exp(-q * p.T)
  const Er  = Math.exp(-p.r * p.T)
  return {
    call: p.S * Eq * normalCDF(d1) - p.K * Er * normalCDF(d2),
    put:  p.K * Er * normalCDF(-d2) - p.S * Eq * normalCDF(-d1),
    d1, d2,
  }
}

export interface Greeks {
  delta: number   // price sensitivity to spot
  gamma: number   // delta sensitivity to spot
  theta: number   // time decay per calendar day
  vega:  number   // sensitivity per 1% vol move
  rho:   number   // sensitivity per 1% rate move
}

export function computeGreeks(p: BSMInput, type: 'call' | 'put'): Greeks {
  const q = p.q ?? 0
  if (p.T <= 0 || p.sigma <= 0) return { delta: type==='call'?1:0, gamma:0, theta:0, vega:0, rho:0 }
  const sqT = Math.sqrt(p.T)
  const d1  = (Math.log(p.S / p.K) + (p.r - q + 0.5 * p.sigma * p.sigma) * p.T) / (p.sigma * sqT)
  const d2  = d1 - p.sigma * sqT
  const Eq  = Math.exp(-q * p.T)
  const Er  = Math.exp(-p.r * p.T)
  const nd1 = normalPDF(d1)
  const gamma = Eq * nd1 / (p.S * p.sigma * sqT)
  const vega  = p.S * Eq * nd1 * sqT / 100
  if (type === 'call') {
    return {
      delta: Eq * normalCDF(d1),
      gamma,
      theta: (-p.S * Eq * nd1 * p.sigma / (2 * sqT) - p.r * p.K * Er * normalCDF(d2) + q * p.S * Eq * normalCDF(d1)) / 365,
      vega,
      rho:   p.K * p.T * Er * normalCDF(d2) / 100,
    }
  }
  return {
    delta: Eq * (normalCDF(d1) - 1),
    gamma,
    theta: (-p.S * Eq * nd1 * p.sigma / (2 * sqT) + p.r * p.K * Er * normalCDF(-d2) - q * p.S * Eq * normalCDF(-d1)) / 365,
    vega,
    rho:   -p.K * p.T * Er * normalCDF(-d2) / 100,
  }
}

// Newton-Raphson with bisection fallback — solves for σ given market price
export function impliedVol(
  mktPrice: number, S: number, K: number, T: number, r: number,
  type: 'call' | 'put', q = 0
): number | null {
  if (T <= 0 || mktPrice <= 0) return null
  const intrinsic = type === 'call'
    ? Math.max(S * Math.exp(-q*T) - K * Math.exp(-r*T), 0)
    : Math.max(K * Math.exp(-r*T) - S * Math.exp(-q*T), 0)
  if (mktPrice < intrinsic - 0.01) return null

  // Seed: Brenner-Subrahmanyam approximation
  let sigma = Math.sqrt(Math.abs(2 * Math.log(S / K) / T + 2 * r))
  if (!isFinite(sigma) || sigma < 0.01) sigma = 0.25

  for (let i = 0; i < 100; i++) {
    const res   = bsm({ S, K, T, r, sigma, q })
    const price = type === 'call' ? res.call : res.put
    const diff  = price - mktPrice
    if (Math.abs(diff) < 1e-7) return Math.max(sigma, 0.001)
    const sqT   = Math.sqrt(T)
    const d1    = (Math.log(S/K) + (r - q + 0.5*sigma*sigma)*T) / (sigma*sqT)
    const vega  = S * Math.exp(-q*T) * normalPDF(d1) * sqT
    if (vega < 1e-10) break
    const next = sigma - diff / vega
    sigma = next <= 0 ? sigma * 0.5 : next
  }

  // Bisection fallback
  let lo = 0.001, hi = 10.0
  for (let i = 0; i < 60; i++) {
    const mid   = (lo + hi) / 2
    const res   = bsm({ S, K, T, r, sigma: mid, q })
    const price = type === 'call' ? res.call : res.put
    if (price < mktPrice) lo = mid; else hi = mid
    if (hi - lo < 1e-7) return (lo + hi) / 2
  }
  return (lo + hi) / 2
}

// Cox-Ross-Rubinstein binomial tree — for American options
export function binomialAmerican(
  S: number, K: number, T: number, r: number, sigma: number,
  type: 'call' | 'put', steps = 150
): number {
  if (T <= 0) return Math.max(type === 'call' ? S-K : K-S, 0)
  const dt = T / steps
  const u  = Math.exp(sigma * Math.sqrt(dt))
  const d  = 1 / u
  const p  = (Math.exp(r * dt) - d) / (u - d)
  const df = Math.exp(-r * dt)
  let V    = Array.from({ length: steps+1 }, (_, i) => {
    const spot = S * Math.pow(u, steps - 2*i)
    return Math.max(type === 'call' ? spot - K : K - spot, 0)
  })
  for (let n = steps-1; n >= 0; n--) {
    V = Array.from({ length: n+1 }, (_, i) => {
      const cont  = df * (p * V[i] + (1-p) * V[i+1])
      const spot  = S * Math.pow(u, n - 2*i)
      const early = Math.max(type === 'call' ? spot - K : K - spot, 0)
      return Math.max(cont, early)
    })
  }
  return V[0]
}

// Monte Carlo strategy simulator
export interface StrategyLeg {
  type:    'call' | 'put'
  action:  'buy'  | 'sell'
  strike:  number
  T:       number  // years to expiry
  qty:     number
  premium: number  // paid/received per unit
}

export interface MCResult {
  profitProb: number    // 0-1
  expectedValue: number
  maxProfit: number
  maxLoss: number
  p10: number; p25: number; p50: number; p75: number; p90: number
  histogram: number[]  // 20 bins of payoff frequencies
}

export function monteCarlo(S: number, r: number, sigma: number, legs: StrategyLeg[], sims = 10000): MCResult {
  const T = Math.max(...legs.map(l => l.T), 1/365)
  const payoffs: number[] = new Array(sims)
  for (let i = 0; i < sims; i++) {
    // Box-Muller
    const u1 = Math.max(Math.random(), 1e-10)
    const Z  = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * Math.random())
    const ST = S * Math.exp((r - 0.5*sigma*sigma)*T + sigma*Math.sqrt(T)*Z)
    let pnl  = 0
    for (const leg of legs) {
      const val  = leg.type === 'call' ? Math.max(ST - leg.strike, 0) : Math.max(leg.strike - ST, 0)
      const sign = leg.action === 'buy' ? 1 : -1
      pnl += sign * (val - leg.premium) * leg.qty
    }
    payoffs[i] = pnl
  }
  payoffs.sort((a, b) => a - b)
  const n = payoffs.length
  const minP = payoffs[0], maxP = payoffs[n-1]
  const bins = 20
  const hist = new Array(bins).fill(0)
  const range = maxP - minP || 1
  payoffs.forEach(p => {
    const b = Math.min(Math.floor((p - minP) / range * bins), bins-1)
    hist[b]++
  })
  return {
    profitProb:    payoffs.filter(p => p > 0).length / n,
    expectedValue: payoffs.reduce((s, v) => s + v, 0) / n,
    maxProfit:     maxP,
    maxLoss:       minP,
    p10: payoffs[Math.floor(n*0.10)], p25: payoffs[Math.floor(n*0.25)],
    p50: payoffs[Math.floor(n*0.50)], p75: payoffs[Math.floor(n*0.75)],
    p90: payoffs[Math.floor(n*0.90)],
    histogram: hist,
  }
}

// Max pain: strike where total option holder loss is minimized
export function maxPain(chain: { strike: number; callOI: number; putOI: number }[]): number {
  let bestStrike = chain[0]?.strike ?? 0
  let minPain = Infinity
  for (const { strike: test } of chain) {
    let pain = 0
    for (const { strike, callOI, putOI } of chain) {
      pain += callOI * Math.max(test - strike, 0)
      pain += putOI * Math.max(strike - test, 0)
    }
    if (pain < minPain) { minPain = pain; bestStrike = test }
  }
  return bestStrike
}