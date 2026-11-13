// src/lib/rule-notes.ts
// Deterministic, rule-based commentary. This is what NEXUS shows by default:
// it needs no AI provider, no key and costs nothing. Every sentence is derived
// from numbers the engine already computed, so it cannot invent a pattern,
// level or price. Pure functions, unit-tested.

export interface AiNote {
  bias:            'bullish' | 'bearish' | 'neutral'
  biasStrength:    string
  headline:        string
  narrative:       string
  bullCase:        string
  bearCase:        string
  keyLevelToWatch: string
  riskNote:        string
}

interface RatingPart { label?: string; score?: number }
interface DigestPattern {
  name?: string; direction?: string; status?: string; confidence?: number
  breakoutLevel?: number | null; target?: number | null; invalidation?: number | null
}
export interface NoteDigest {
  symbol?:    string
  timeframe?: string
  lastClose?: number
  rating?:    { overall?: RatingPart; movingAvg?: RatingPart; oscillators?: RatingPart }
  structure?: { bias?: string; label?: string; support?: number | null; resistance?: number | null }
  patterns?:  DigestPattern[]
  keyLevels?: { support?: number | null; resistance?: number | null }
  indicatorSnapshot?: {
    rsi?: number | null; macdState?: string; volVs20?: number | null
    atrPct?: number | null; distFrom50?: number | null; distFrom200?: number | null
  }
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const px = (n: unknown): string => (isNum(n) ? (Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(2)) : '')
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

export function buildRuleNote(d: NoteDigest): AiNote {
  const symbol = String(d.symbol ?? 'This symbol').slice(0, 24)
  const tf     = String(d.timeframe ?? '').slice(0, 6)
  const score  = isNum(d.rating?.overall?.score) ? d.rating!.overall!.score! : 0
  const label  = String(d.rating?.overall?.label ?? 'Neutral')
  const ind    = d.indicatorSnapshot ?? {}
  const top    = (d.patterns ?? []).find(p => p && p.name)

  // Bias: composite rating first, market structure as the tie-breaker.
  const structBias = String(d.structure?.bias ?? '').toLowerCase()
  let bias: AiNote['bias'] = score > 0.1 ? 'bullish' : score < -0.1 ? 'bearish' : 'neutral'
  if (bias === 'neutral' && (structBias === 'bullish' || structBias === 'bearish')) bias = structBias
  const strength = Math.abs(score) >= 0.5 ? 'strong' : Math.abs(score) >= 0.1 ? 'moderate' : 'weak'

  const support    = isNum(d.keyLevels?.support) ? d.keyLevels!.support! : isNum(d.structure?.support) ? d.structure!.support! : null
  const resistance = isNum(d.keyLevels?.resistance) ? d.keyLevels!.resistance! : isNum(d.structure?.resistance) ? d.structure!.resistance! : null

  // ── Narrative, built only from supplied facts ──
  const parts: string[] = []
  parts.push(`${symbol}${tf ? ` (${tf})` : ''} carries a ${label} composite technical rating`
    + (d.rating?.movingAvg?.label || d.rating?.oscillators?.label
        ? ` (moving averages: ${d.rating?.movingAvg?.label ?? 'n/a'}, oscillators: ${d.rating?.oscillators?.label ?? 'n/a'})`
        : '') + '.')
  if (d.structure?.label) parts.push(`Market structure is ${String(d.structure.label).toLowerCase()}.`)
  if (top) {
    const lv = [
      isNum(top.breakoutLevel) ? `breakout ${px(top.breakoutLevel)}` : '',
      isNum(top.target) ? `target ${px(top.target)}` : '',
      isNum(top.invalidation) ? `invalidation ${px(top.invalidation)}` : '',
    ].filter(Boolean).join(', ')
    parts.push(`Highest-confidence pattern: ${top.name} (${top.direction ?? 'n/a'}, ${top.status ?? 'n/a'}`
      + (isNum(top.confidence) ? `, confidence ${Math.round(top.confidence)}` : '') + `)${lv ? ` with ${lv}` : ''}.`)
  } else {
    parts.push('No chart pattern currently qualifies.')
  }
  if (isNum(ind.rsi)) {
    const zone = ind.rsi >= 70 ? 'overbought' : ind.rsi <= 30 ? 'oversold' : 'mid-range'
    parts.push(`RSI is ${ind.rsi.toFixed(0)} (${zone}).`)
  }
  if (ind.macdState) parts.push(`MACD is ${String(ind.macdState).toLowerCase()}.`)
  if (isNum(ind.volVs20)) parts.push(`Volume is ${ind.volVs20.toFixed(2)}x its 20-period average.`)
  if (isNum(ind.distFrom200)) parts.push(`Price is ${Math.abs(ind.distFrom200).toFixed(1)}% ${ind.distFrom200 >= 0 ? 'above' : 'below'} the 200-period average.`)

  const bullCase = resistance !== null
    ? `A close above resistance at ${px(resistance)}${top?.direction === 'bullish' && isNum(top.target) ? ` opens the pattern target near ${px(top.target)}` : ' would confirm buyers are in control'}.`
    : 'A higher high on rising volume would strengthen the bullish case.'
  const bearCase = support !== null
    ? `A close below support at ${px(support)}${top?.direction === 'bearish' && isNum(top.target) ? ` opens the pattern target near ${px(top.target)}` : ' would shift control to sellers'}.`
    : 'A lower low on rising volume would strengthen the bearish case.'

  const keyLevel =
    top && isNum(top.breakoutLevel) ? `${px(top.breakoutLevel)} (${top.name} breakout level)`
    : bias === 'bearish' && support !== null ? `${px(support)} (support)`
    : resistance !== null ? `${px(resistance)} (resistance)`
    : support !== null ? `${px(support)} (support)`
    : 'No clear level identified'

  const risk: string[] = []
  if (isNum(ind.atrPct)) risk.push(`Average true range is ${ind.atrPct.toFixed(1)}% of price, so size positions for that swing.`)
  if (isNum(ind.rsi) && (ind.rsi >= 70 || ind.rsi <= 30)) risk.push(`RSI at an extreme raises the odds of a counter-move.`)
  if (top && isNum(top.invalidation)) risk.push(`The pattern is invalid beyond ${px(top.invalidation)}.`)
  risk.push('Rule-based reading of past prices, not a forecast or advice.')

  const headline =
    top ? `${label} rating; ${top.name} ${top.status ?? ''}`.trim()
    : `${label} rating; structure ${structBias || 'unclear'}`

  return {
    bias,
    biasStrength:    strength,
    headline:        clip(headline, 140),
    narrative:       clip(parts.join(' '), 900),
    bullCase:        clip(bullCase, 300),
    bearCase:        clip(bearCase, 300),
    keyLevelToWatch: clip(keyLevel, 160),
    riskNote:        clip(risk.join(' '), 300),
  }
}

// ── Fixed income ─────────────────────────────────────────────────────────────

export interface FixedIncomeFacts {
  market:      'US' | 'IN'
  policyRate:  number | null
  cpi:         number | null
  stance:      string
  twoY:        number | null
  fiveY:       number | null
  tenY:        number | null
  curveShape:  string
  igOAS:       number | null
  hyOAS:       number | null
  dataQuality: string
}

/** Four bullets, each stating a computed fact. Lines without data are skipped. */
export function fixedIncomeRuleInsights(f: FixedIncomeFacts): string {
  const out: string[] = []
  const bank = f.market === 'US' ? 'Fed funds' : 'RBI repo'

  if (isNum(f.policyRate)) {
    let line = `${bank} rate is ${f.policyRate.toFixed(2)}%${f.stance ? ` (${f.stance})` : ''}`
    if (isNum(f.cpi)) {
      const real = f.policyRate - f.cpi
      line += `; with CPI near ${f.cpi.toFixed(1)}% the real policy rate is ${real >= 0 ? '+' : ''}${real.toFixed(2)}%`
    }
    out.push(line + '.')
  }

  if (isNum(f.twoY) && isNum(f.tenY)) {
    const bp = Math.round((f.tenY - f.twoY) * 100)
    out.push(`2Y ${f.twoY.toFixed(2)}% vs 10Y ${f.tenY.toFixed(2)}%: the 2s10s spread is ${bp >= 0 ? '+' : ''}${bp}bp, ${bp < 0 ? 'an inverted curve' : bp < 50 ? 'a flat curve' : 'a positively sloped curve'}.`)
  } else if (isNum(f.tenY)) {
    out.push(`10Y yield is ${f.tenY.toFixed(2)}%${f.curveShape ? `; curve shape reads ${f.curveShape.toLowerCase()}` : ''}.`)
  }

  if (isNum(f.tenY) && isNum(f.policyRate)) {
    const bp = Math.round((f.tenY - f.policyRate) * 100)
    out.push(`10Y sits ${Math.abs(bp)}bp ${bp >= 0 ? 'above' : 'below'} the policy rate, ${bp < 0 ? 'which prices in rate cuts' : 'a positive term premium over cash'}.`)
  }

  if (isNum(f.igOAS) && isNum(f.hyOAS)) {
    out.push(`Credit spreads: investment grade ${f.igOAS.toFixed(0)}bp, high yield ${f.hyOAS.toFixed(0)}bp (${f.hyOAS > 500 ? 'stressed' : f.hyOAS < 350 ? 'tight' : 'around normal'} by historical ranges).`)
  } else if (isNum(f.fiveY) && isNum(f.tenY)) {
    const bp = Math.round((f.tenY - f.fiveY) * 100)
    out.push(`5Y ${f.fiveY.toFixed(2)}% vs 10Y ${f.tenY.toFixed(2)}%: the 5s10s segment is ${bp >= 0 ? '+' : ''}${bp}bp.`)
  }

  if (!out.length) return 'Not enough live rate data to summarise right now.'
  out.push(`Data quality: ${f.dataQuality}. Rule-based summary of the figures shown, not advice.`)
  return out.slice(0, 5).map(l => `• ${l}`).join('\n')
}
