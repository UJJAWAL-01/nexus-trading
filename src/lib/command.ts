// src/lib/command.ts
// The command bar's language. Turns what the user typed into a ranked list of
// actions. Pure: no network, no DOM, no stores. Unit-tested.
//
// Grammar (case-insensitive, either word order where it makes sense):
//   AAPL                        open a symbol
//   AAPL chart   |  chart AAPL  open a symbol in a panel
//   screener                    jump to a panel
//   alert AAPL above 400        price alert        (also: > < below over under)
//   alert NVDA down 5%          daily-move alert   (also: up)
//   watch TSLA   |  unwatch TSLA
//   classic  |  pro             switch layout
//   help

import { sanitizeRule, type AlertKind } from '@/lib/price-alerts'
import { isValidSymbol } from '@/lib/providers/symbols'

export type Command =
  | { kind: 'symbol';       symbol: string }
  | { kind: 'symbol-panel'; symbol: string; panelId: string }
  | { kind: 'panel';        panelId: string }
  | { kind: 'alert';        symbol: string; alertKind: AlertKind; value: number }
  | { kind: 'watch';        symbol: string }
  | { kind: 'unwatch';      symbol: string }
  | { kind: 'layout';       mode: 'classic' | 'tabs' }
  | { kind: 'help' }
  /** Not executable: tells the user how to finish what they started. */
  | { kind: 'hint';         text: string }

/** Short words for each panel. The first entry is the one shown in examples. */
export const PANEL_ALIASES: Record<string, readonly string[]> = {
  chart:          ['chart', 'gp', 'graph', 'price'],
  news:           ['news', 'cn'],
  watchlist:      ['watchlist', 'wl'],
  portfolio:      ['portfolio', 'port', 'positions'],
  risk:           ['risk', 'var'],
  alerts:         ['alerts'],
  options:        ['options', 'opt', 'omon', 'chain'],
  strategy:       ['strategy', 'payoff', 'spread'],
  volatility:     ['volatility', 'vol', 'iv', 'skew'],
  equityresearch: ['fundamentals', 'fa', 'research', 'financials'],
  stockprofile:   ['profile', 'des', 'about'],
  secfilings:     ['filings', 'sec', 'cf'],
  insiderdeals:   ['insiders', 'insider'],
  smartmoney:     ['holders', '13f', 'funds'],
  seasonality:    ['seasonality', 'season', 'seasonal'],
  backtest:       ['backtest', 'bt'],
  screener:       ['screener', 'screen', 'eqs'],
  patternscanner: ['patterns', 'scanner'],
  rotation:       ['rotation', 'sectors', 'rrg'],
  positioning:    ['positioning', 'cot', 'shorts', 'short'],
  heatmap:        ['heatmap', 'map'],
  indices:        ['indices', 'wei'],
  earnings:       ['earnings', 'ern'],
  calendar:       ['calendar', 'eco', 'econ'],
  macrorates:     ['macro', 'rates'],
  fixedincome:    ['bonds', 'yields', 'fixedincome'],
  commodities:    ['commodities', 'cmdty'],
  sentiment:      ['sentiment', 'fear'],
  indiamarkets:   ['india'],
  ipo:            ['ipo'],
  supplychain:    ['supply', 'spl'],
  altdata:        ['alt', 'altdata'],
  livevideo:      ['tv', 'live'],
  mktclock:       ['clock', 'hours'],
}

const ALIAS_TO_PANEL = new Map<string, string>()
for (const [id, words] of Object.entries(PANEL_ALIASES)) for (const w of words) ALIAS_TO_PANEL.set(w, id)

const RESERVED = new Set(['alert', 'watch', 'add', 'unwatch', 'remove', 'help', 'classic', 'pro', 'tabs', 'above', 'below', 'over', 'under', 'up', 'down'])

const ABOVE = new Set(['above', 'over', '>', '>=', 'gt'])
const BELOW = new Set(['below', 'under', '<', '<=', 'lt'])

export const ALERT_HINT = 'alert SYMBOL above|below PRICE   ·   alert SYMBOL up|down PERCENT%'
const MAX_PANEL_SUGGESTIONS = 5

/** A token that could be a ticker (not a bare number, not a reserved word). */
export function asSymbol(token: string): string | null {
  const s = token.trim().toUpperCase()
  if (!s || /^[\d.]+%?$/.test(s) || !isValidSymbol(s)) return null
  return s
}

/** Panels a word refers to: exact alias first, then prefix matches (2+ letters). */
export function matchPanels(word: string, available: ReadonlySet<string>): string[] {
  const w = word.toLowerCase()
  if (!w) return []
  const exact = ALIAS_TO_PANEL.get(w) ?? (available.has(w) ? w : undefined)
  const out: string[] = exact && available.has(exact) ? [exact] : []
  if (w.length >= 2) {
    for (const [id, words] of Object.entries(PANEL_ALIASES)) {
      if (out.includes(id) || !available.has(id)) continue
      if (id.startsWith(w) || words.some(x => x.startsWith(w))) out.push(id)
      if (out.length >= MAX_PANEL_SUGGESTIONS) break
    }
  }
  return out
}

const isExactPanel = (word: string, available: ReadonlySet<string>) => {
  const id = ALIAS_TO_PANEL.get(word.toLowerCase())
  return !!id && available.has(id)
}

function parseAlert(tokens: string[]): Command[] {
  const [rawSym, rawOp, rawVal] = tokens
  const symbol = rawSym ? asSymbol(rawSym) : null
  if (!symbol || !rawOp) return [{ kind: 'hint', text: ALERT_HINT }]

  // Allow "alert AAPL >400" and "alert AAPL above 400".
  let op = rawOp.toLowerCase(), val = rawVal
  const glued = op.match(/^(>=|<=|>|<)(.+)$/)
  if (glued) { op = glued[1]; val = glued[2] }
  if (val === undefined) return [{ kind: 'hint', text: ALERT_HINT }]

  const isPct = val.endsWith('%')
  const n = Number(val.replace(/%$/, '').replace(/,/g, ''))
  let alertKind: AlertKind | null = null
  if (op === 'up') alertKind = 'pct-up'
  else if (op === 'down') alertKind = 'pct-down'
  else if (!isPct && ABOVE.has(op)) alertKind = 'above'
  else if (!isPct && BELOW.has(op)) alertKind = 'below'
  if (!alertKind) return [{ kind: 'hint', text: ALERT_HINT }]

  const clean = sanitizeRule({ symbol, kind: alertKind, value: n })
  return clean ? [{ kind: 'alert', symbol: clean.symbol, alertKind: clean.kind, value: clean.value }] : [{ kind: 'hint', text: ALERT_HINT }]
}

/** Best interpretation first. An empty array means "nothing recognisable yet". */
export function parseCommand(input: string, availablePanels: readonly string[]): Command[] {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const available = new Set(availablePanels)
  const head = tokens[0].toLowerCase()

  if (head === 'alert') return parseAlert(tokens.slice(1))

  if (head === 'watch' || head === 'add' || head === 'unwatch' || head === 'remove') {
    const symbol = tokens[1] ? asSymbol(tokens[1]) : null
    const kind = head === 'watch' || head === 'add' ? 'watch' : 'unwatch'
    return symbol ? [{ kind, symbol }] : [{ kind: 'hint', text: `${head} SYMBOL` }]
  }

  if (tokens.length === 1) {
    if (head === 'help' || head === '?') return [{ kind: 'help' }]
    if (head === 'classic') return [{ kind: 'layout', mode: 'classic' }]
    if (head === 'pro' || head === 'tabs') return [{ kind: 'layout', mode: 'tabs' }]

    const out: Command[] = matchPanels(head, available).map(panelId => ({ kind: 'panel', panelId }))
    const symbol = RESERVED.has(head) ? null : asSymbol(tokens[0])
    // A word that is exactly a panel name ("news") is a panel first; anything
    // else that looks like a ticker ("aapl", "c") is a symbol first.
    if (symbol) {
      const cmd: Command = { kind: 'symbol', symbol }
      if (isExactPanel(head, available)) out.push(cmd); else out.unshift(cmd)
    }
    return out
  }

  // Two words: SYMBOL PANEL (terminal order) or PANEL SYMBOL.
  const [a, b] = tokens
  const out: Command[] = []
  const pair = (symToken: string, panelWord: string) => {
    const symbol = RESERVED.has(symToken.toLowerCase()) ? null : asSymbol(symToken)
    if (!symbol) return
    for (const panelId of matchPanels(panelWord, available)) out.push({ kind: 'symbol-panel', symbol, panelId })
  }
  // Prefer whichever order has an exact panel word; terminal order wins ties.
  if (isExactPanel(b, available) || !isExactPanel(a, available)) { pair(a, b); if (!out.length) pair(b, a) }
  else { pair(b, a); if (!out.length) pair(a, b) }
  return out
}

/** One line describing a command, given human panel labels. */
export function describeCommand(c: Command, labelOf: (panelId: string) => string): string {
  switch (c.kind) {
    case 'symbol':       return `Open ${c.symbol}`
    case 'symbol-panel': return `${c.symbol} → ${labelOf(c.panelId)}`
    case 'panel':        return `Go to ${labelOf(c.panelId)}`
    case 'alert':
      return c.alertKind === 'above' ? `Alert when ${c.symbol} reaches ${c.value}`
        : c.alertKind === 'below' ? `Alert when ${c.symbol} falls to ${c.value}`
        : c.alertKind === 'pct-up' ? `Alert when ${c.symbol} is up ${c.value}% on the day`
        : `Alert when ${c.symbol} is down ${c.value}% on the day`
    case 'watch':        return `Add ${c.symbol} to watchlist`
    case 'unwatch':      return `Remove ${c.symbol} from watchlist`
    case 'layout':       return c.mode === 'classic' ? 'Switch to Classic layout (one grid)' : 'Switch to Pro layout (tabs)'
    case 'help':         return 'Show keyboard shortcuts'
    case 'hint':         return c.text
  }
}

export const COMMAND_EXAMPLES = ['AAPL', 'NVDA options', 'TSLA seasonality', 'alert AAPL above 400', 'alert NVDA down 5%', 'watch MSFT', 'screener', 'rotation'] as const
