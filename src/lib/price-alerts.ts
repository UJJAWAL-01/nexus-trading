// src/lib/price-alerts.ts
// User-defined price alerts. Pure rule evaluation: no network, no browser
// APIs, no cost. The engine component feeds it live quotes; this file decides
// what fires. Unit-tested.
//
// Semantics:
//   • A rule fires when its condition is true while it is ARMED.
//   • After firing, a one-shot rule stays disarmed.
//   • A repeating rule re-arms only after its condition has gone false again,
//     so a price sitting above a level fires once, not on every tick.

export const ALERT_KINDS = ['above', 'below', 'pct-up', 'pct-down'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export const KIND_LABEL: Record<AlertKind, string> = {
  'above':    'Price at or above',
  'below':    'Price at or below',
  'pct-up':   'Day gain of at least (%)',
  'pct-down': 'Day fall of at least (%)',
}

export const MAX_RULES   = 50
export const MAX_SYMBOLS = 25      // one live stream carries at most this many symbols
export const MAX_HISTORY = 30

export interface PriceAlertRule {
  id:        string
  symbol:    string
  kind:      AlertKind
  value:     number
  note:      string
  repeat:    boolean
  armed:     boolean
  createdAt: number
  firedAt:   number | null
  firedPrice: number | null
}

export interface AlertQuote { price: number | null; change: number | null }

export interface FiredAlert {
  ruleId:  string
  symbol:  string
  kind:    AlertKind
  value:   number
  price:   number
  change:  number | null
  note:    string
  at:      number
}

const SYMBOL = /^[A-Za-z0-9^][A-Za-z0-9.\-=^&:_]{0,24}$/
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

export interface RuleInput { symbol: unknown; kind: unknown; value: unknown; note?: unknown; repeat?: unknown }

/** Validate untrusted input (form fields, imported backups). Null when unusable. */
export function sanitizeRule(input: RuleInput): Pick<PriceAlertRule, 'symbol' | 'kind' | 'value' | 'note' | 'repeat'> | null {
  if (typeof input.symbol !== 'string') return null
  const symbol = input.symbol.trim().toUpperCase()
  if (!SYMBOL.test(symbol)) return null
  if (typeof input.kind !== 'string' || !(ALERT_KINDS as readonly string[]).includes(input.kind)) return null
  const kind = input.kind as AlertKind
  const value = typeof input.value === 'string' ? Number(input.value) : input.value
  if (!isNum(value) || value <= 0 || value > 1e9) return null
  if ((kind === 'pct-up' || kind === 'pct-down') && value > 100) return null
  const note = typeof input.note === 'string' ? input.note.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 80) : ''
  return { symbol, kind, value, note, repeat: input.repeat === true }
}

/** True when the rule's condition holds for this quote; null when it cannot be judged. */
export function conditionMet(rule: Pick<PriceAlertRule, 'kind' | 'value'>, q: AlertQuote | undefined): boolean | null {
  if (!q) return null
  switch (rule.kind) {
    case 'above':    return isNum(q.price) && q.price > 0 ? q.price >= rule.value : null
    case 'below':    return isNum(q.price) && q.price > 0 ? q.price <= rule.value : null
    case 'pct-up':   return isNum(q.change) ? q.change >= rule.value : null
    case 'pct-down': return isNum(q.change) ? q.change <= -rule.value : null
  }
}

/**
 * Evaluate every rule against the latest quotes. Returns the SAME array when
 * nothing changed, so callers can skip a state update.
 */
export function evaluateRules(
  rules: readonly PriceAlertRule[],
  quotes: Readonly<Record<string, AlertQuote | undefined>>,
  now: number = Date.now(),
): { rules: readonly PriceAlertRule[]; fired: FiredAlert[] } {
  const fired: FiredAlert[] = []
  let changed = false

  const next = rules.map(rule => {
    const q = quotes[rule.symbol]
    const met = conditionMet(rule, q)
    if (met === null) return rule

    if (rule.armed && met) {
      const price = isNum(q?.price) ? q!.price! : 0
      fired.push({ ruleId: rule.id, symbol: rule.symbol, kind: rule.kind, value: rule.value, price, change: q?.change ?? null, note: rule.note, at: now })
      changed = true
      return { ...rule, armed: false, firedAt: now, firedPrice: price }
    }
    // Re-arm a repeating rule once its condition has cleared.
    if (!rule.armed && rule.repeat && rule.firedAt !== null && !met) {
      changed = true
      return { ...rule, armed: true }
    }
    return rule
  })

  return { rules: changed ? next : rules, fired }
}

export function describeRule(r: Pick<PriceAlertRule, 'kind' | 'value'>): string {
  switch (r.kind) {
    case 'above':    return `≥ ${r.value}`
    case 'below':    return `≤ ${r.value}`
    case 'pct-up':   return `day ≥ +${r.value}%`
    case 'pct-down': return `day ≤ −${r.value}%`
  }
}

export function describeFired(f: FiredAlert): { title: string; body: string } {
  const px = f.price ? f.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : 'n/a'
  const title =
    f.kind === 'above'  ? `${f.symbol} reached ${f.value}`
    : f.kind === 'below' ? `${f.symbol} fell to ${f.value}`
    : f.kind === 'pct-up' ? `${f.symbol} up ${f.value}%+ today`
    : `${f.symbol} down ${f.value}%+ today`
  const chg = isNum(f.change) ? ` (${f.change > 0 ? '+' : ''}${f.change.toFixed(2)}% today)` : ''
  return { title, body: `Last ${px}${chg}${f.note ? ` · ${f.note}` : ''}` }
}
