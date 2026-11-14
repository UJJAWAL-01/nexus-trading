import { describe, it, expect } from 'vitest'
import { COMMAND_EXAMPLES, PANEL_ALIASES, asSymbol, describeCommand, matchPanels, parseCommand } from '@/lib/command'

const PANELS = Object.keys(PANEL_ALIASES)
const parse = (s: string) => parseCommand(s, PANELS)
const first = (s: string) => parse(s)[0]

describe('command bar language', () => {
  it('returns nothing for empty input', () => {
    expect(parse('')).toEqual([])
    expect(parse('   ')).toEqual([])
  })

  it('opens a symbol', () => {
    expect(first('aapl')).toEqual({ kind: 'symbol', symbol: 'AAPL' })
    expect(first('reliance.ns')).toEqual({ kind: 'symbol', symbol: 'RELIANCE.NS' })
    expect(first('^nsei')).toEqual({ kind: 'symbol', symbol: '^NSEI' })
    expect(first('BRK-B')).toEqual({ kind: 'symbol', symbol: 'BRK-B' })
  })

  it('opens a symbol in a panel, in either word order', () => {
    expect(first('aapl chart')).toEqual({ kind: 'symbol-panel', symbol: 'AAPL', panelId: 'chart' })
    expect(first('chart aapl')).toEqual({ kind: 'symbol-panel', symbol: 'AAPL', panelId: 'chart' })
    expect(first('NVDA opt')).toEqual({ kind: 'symbol-panel', symbol: 'NVDA', panelId: 'options' })
    expect(first('tsla fa')).toEqual({ kind: 'symbol-panel', symbol: 'TSLA', panelId: 'equityresearch' })
    expect(first('msft des')).toEqual({ kind: 'symbol-panel', symbol: 'MSFT', panelId: 'stockprofile' })
    expect(first('spy season')).toEqual({ kind: 'symbol-panel', symbol: 'SPY', panelId: 'seasonality' })
  })

  it('completes a partly typed panel name', () => {
    expect(first('aapl seas')).toEqual({ kind: 'symbol-panel', symbol: 'AAPL', panelId: 'seasonality' })
    expect(parse('scr').some(c => c.kind === 'panel' && c.panelId === 'screener')).toBe(true)
  })

  it('treats an exact panel word as the panel, but still offers the ticker', () => {
    expect(parse('news')).toEqual([{ kind: 'panel', panelId: 'news' }, { kind: 'symbol', symbol: 'NEWS' }])
    expect(first('screener')).toEqual({ kind: 'panel', panelId: 'screener' })
    expect(first('heatmap')).toEqual({ kind: 'panel', panelId: 'heatmap' })
  })

  it('treats short tickers as tickers, not as panel shortcuts', () => {
    expect(first('c')).toEqual({ kind: 'symbol', symbol: 'C' })           // Citigroup
    expect(first('f chart')).toEqual({ kind: 'symbol-panel', symbol: 'F', panelId: 'chart' })
    // A ticker that is also a panel word: terminal order (SYMBOL PANEL) wins.
    expect(first('ipo chart')).toEqual({ kind: 'symbol-panel', symbol: 'IPO', panelId: 'chart' })
  })

  it('only offers panels that exist in the current layout', () => {
    expect(parseCommand('screener', ['chart'])).toEqual([{ kind: 'symbol', symbol: 'SCREENER' }])
    expect(matchPanels('opt', new Set(['chart']))).toEqual([])
  })

  it('creates price alerts', () => {
    expect(first('alert aapl above 400')).toEqual({ kind: 'alert', symbol: 'AAPL', alertKind: 'above', value: 400 })
    expect(first('alert AAPL > 400.5')).toEqual({ kind: 'alert', symbol: 'AAPL', alertKind: 'above', value: 400.5 })
    expect(first('alert AAPL <350')).toEqual({ kind: 'alert', symbol: 'AAPL', alertKind: 'below', value: 350 })
    expect(first('alert nifty.ns under 24,000')).toEqual({ kind: 'alert', symbol: 'NIFTY.NS', alertKind: 'below', value: 24000 })
    expect(first('alert nvda down 5%')).toEqual({ kind: 'alert', symbol: 'NVDA', alertKind: 'pct-down', value: 5 })
    expect(first('alert nvda up 3')).toEqual({ kind: 'alert', symbol: 'NVDA', alertKind: 'pct-up', value: 3 })
  })

  it('shows a hint instead of guessing at an unfinished or invalid alert', () => {
    for (const s of ['alert', 'alert aapl', 'alert aapl above', 'alert aapl above abc', 'alert aapl above -5', 'alert aapl above 5%', 'alert aapl sideways 5', 'alert aapl up 500%', 'alert 123 above 5']) {
      expect(parse(s), s).toEqual([{ kind: 'hint', text: expect.stringContaining('alert SYMBOL') }])
    }
  })

  it('manages the watchlist', () => {
    expect(first('watch tsla')).toEqual({ kind: 'watch', symbol: 'TSLA' })
    expect(first('add tsla')).toEqual({ kind: 'watch', symbol: 'TSLA' })
    expect(first('unwatch tsla')).toEqual({ kind: 'unwatch', symbol: 'TSLA' })
    expect(first('watch')).toEqual({ kind: 'hint', text: 'watch SYMBOL' })
  })

  it('switches layout and opens help', () => {
    expect(first('classic')).toEqual({ kind: 'layout', mode: 'classic' })
    expect(first('pro')).toEqual({ kind: 'layout', mode: 'tabs' })
    expect(first('help')).toEqual({ kind: 'help' })
  })

  it('never turns hostile or meaningless input into a symbol', () => {
    expect(asSymbol('<script>')).toBeNull()
    expect(asSymbol('400')).toBeNull()
    expect(asSymbol('5%')).toBeNull()
    expect(asSymbol('a'.repeat(40))).toBeNull()
    expect(parse('<img src=x onerror=alert(1)>')).toEqual([])
    expect(parse('../../etc/passwd')).toEqual([])
    expect(parse('400')).toEqual([])
  })

  it('every alias points at exactly one panel and every example parses', () => {
    const seen = new Map<string, string>()
    for (const [id, words] of Object.entries(PANEL_ALIASES)) for (const w of words) {
      expect(seen.has(w), `alias "${w}" used by ${seen.get(w)} and ${id}`).toBe(false)
      seen.set(w, id)
    }
    for (const ex of COMMAND_EXAMPLES) {
      const c = first(ex)
      expect(c, ex).toBeDefined()
      expect(c.kind, ex).not.toBe('hint')
    }
  })

  it('describes each command in plain words', () => {
    const label = (id: string) => id.toUpperCase()
    expect(describeCommand(first('aapl chart'), label)).toBe('AAPL → CHART')
    expect(describeCommand(first('alert aapl above 400'), label)).toBe('Alert when AAPL reaches 400')
    expect(describeCommand(first('alert nvda down 5%'), label)).toBe('Alert when NVDA is down 5% on the day')
    expect(describeCommand(first('watch tsla'), label)).toBe('Add TSLA to watchlist')
  })
})
