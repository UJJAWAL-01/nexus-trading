'use client'

import { useEffect, useState } from 'react'

// ── Moon Phase Math ──────────────────────────────────────────────────────────
const KNOWN_NEW_MOON = new Date('2000-01-06T18:14:00Z').getTime()
const LUNAR_CYCLE    = 29.53058867

function getMoonAge(date: Date = new Date()): number {
  const diff = (date.getTime() - KNOWN_NEW_MOON) / (1000 * 60 * 60 * 24)
  return ((diff % LUNAR_CYCLE) + LUNAR_CYCLE) % LUNAR_CYCLE
}

interface MoonInfo {
  age: number; phase: string; emoji: string; illumination: number
  signal: string; signalColor: string; description: string
  daysToNext: number; nextPhase: string; nextEmoji: string
}

function getMoonInfo(): MoonInfo {
  const age          = getMoonAge()
  const illumination = Math.round((1 - Math.cos((2 * Math.PI * age) / LUNAR_CYCLE)) / 2 * 100)

  type PhaseInfo = { phase: string; emoji: string; signal: string; signalColor: string; description: string }

  const info: PhaseInfo =
    age < 1.85  ? { phase: 'New Moon',        emoji: '🌑', signal: 'ACCUMULATE',   signalColor: '#00c97a', description: 'Historically linked to market lows. Smart money tends to quietly accumulate near new moons. Lowest emotional noise in the cycle.' } :
    age < 7.38  ? { phase: 'Waxing Crescent', emoji: '🌒', signal: 'BULLISH BIAS', signalColor: '#00c97a', description: 'Rising lunar energy. Markets historically show upward momentum in the waxing phase. Trend-following strategies tend to outperform.' } :
    age < 9.22  ? { phase: 'First Quarter',   emoji: '🌓', signal: 'WATCH',        signalColor: '#f0a500', description: 'Decision point in the cycle. Watch for key breakouts or breakdowns. Volume often spikes. Direction set here often holds through full moon.' } :
    age < 14.75 ? { phase: 'Waxing Gibbous',  emoji: '🌔', signal: 'BULLISH BIAS', signalColor: '#00c97a', description: 'Strong upward lunar phase. Trend-following and momentum strategies historically perform best in this window.' } :
    age < 16.61 ? { phase: 'Full Moon',        emoji: '🌕', signal: 'CAUTION',     signalColor: '#ff4560', description: 'Full moons historically correlate with market peaks and heightened volatility. Consider trimming positions. Emotional trading increases.' } :
    age < 22.14 ? { phase: 'Waning Gibbous',  emoji: '🌖', signal: 'DISTRIBUTE',  signalColor: '#ff4560', description: 'Waning lunar phase. Distribution by institutional players common. Markets may face headwinds.' } :
    age < 24.0  ? { phase: 'Last Quarter',    emoji: '🌗', signal: 'BEARISH BIAS', signalColor: '#ff4560', description: 'Selling pressure historically increases. Defensive positioning may be warranted through this phase.' } :
                  { phase: 'Waning Crescent', emoji: '🌘', signal: 'WAIT',         signalColor: '#f0a500', description: 'Lunar energy dissipating. Approaching reset. Reduce noise, prepare watchlist for next new moon accumulation opportunity.' }

  const daysToNew  = LUNAR_CYCLE - age
  const daysToFull = age < 14.75 ? 14.75 - age : LUNAR_CYCLE - age + 14.75
  const toNew      = Math.ceil(daysToNew)
  const toFull     = Math.ceil(daysToFull)

  return {
    ...info, age, illumination,
    daysToNext:  toNew < toFull ? toNew  : toFull,
    nextPhase:   toNew < toFull ? 'New Moon'  : 'Full Moon',
    nextEmoji:   toNew < toFull ? '🌑' : '🌕',
  }
}

// ── Seasonality ───────────────────────────────────────────────────────────────
function getSeasonality() {
  const m = new Date().getMonth()
  const seasons = [
    { bias: 'BULLISH',  color: '#00c97a', detail: 'January Effect — small caps outperform, fresh inflows reset portfolios' },
    { bias: 'NEUTRAL',  color: '#f0a500', detail: 'Mixed signals — post-January slowdown. Watch earnings revisions' },
    { bias: 'BULLISH',  color: '#00c97a', detail: '"Best 6 months" (Nov–Apr) still active. Spring rally historically strong' },
    { bias: 'BULLISH',  color: '#00c97a', detail: 'Earnings season catalyst. "Best 6 months" finale — often strong close' },
    { bias: 'BEARISH',  color: '#ff4560', detail: '"Sell in May and go away" — historically weakest 6-month period begins' },
    { bias: 'BEARISH',  color: '#ff4560', detail: 'Summer doldrums — institutional desks thin, choppy low-volume action' },
    { bias: 'BEARISH',  color: '#ff4560', detail: 'Historically weakest calendar month for US equities' },
    { bias: 'BEARISH',  color: '#ff4560', detail: 'August weakness common — summer selloffs and low-conviction rallies' },
    { bias: 'BEARISH',  color: '#ff4560', detail: 'Worst month statistically — September Effect well-documented' },
    { bias: 'NEUTRAL',  color: '#f0a500', detail: '"October reversals" — can flip bear to bull. Pre-election seasonality' },
    { bias: 'BULLISH',  color: '#00c97a', detail: '"Best 6 months" begins — historically very strong. Q4 rally setup' },
    { bias: 'BULLISH',  color: '#00c97a', detail: 'Santa Claus rally + year-end window dressing. Historically very strong' },
  ]
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return { label: months[m], month: m, ...seasons[m] }
}

// ── Day of Week ───────────────────────────────────────────────────────────────
function getDayEffect() {
  const d = new Date().getDay()
  const fx = [
    { signal: 'WEEKEND', color: 'var(--text-muted)', note: 'Markets closed. Crypto runs 24/7.', strength: 0 },
    { signal: 'CAUTION',  color: '#f0a500', note: '"Monday Effect" — historically weakest open. Gap-downs common after weekend news.', strength: 2 },
    { signal: 'NEUTRAL',  color: 'var(--text-2)', note: 'Recovery from Monday often seen mid-morning. Look for reversal setups.', strength: 3 },
    { signal: 'NEUTRAL',  color: 'var(--text-2)', note: 'Midweek equilibrium. FOMC statements often released on Wednesday.', strength: 3 },
    { signal: 'BULLISH',  color: '#00c97a', note: 'Strongest day historically. Earnings often released post-close Thursday.', strength: 4 },
    { signal: 'WATCH',    color: '#f0a500', note: '"Friday Effect" — profit-taking into weekend. Positions squared before close.', strength: 3 },
    { signal: 'WEEKEND',  color: 'var(--text-muted)', note: 'Markets closed. Review positions for Monday.', strength: 0 },
  ]
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  return { day: days[d], dayIdx: d, ...fx[d] }
}

// ── Options Expiration (OpEx) ─────────────────────────────────────────────────
// OpEx = 3rd Friday of every month (standard equity options)
// Also monthly SPX/SPY options (3rd Friday) + weekly expirations every Friday
function getOpExInfo() {
  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth()
  const today = now.getDate()
  const dow   = now.getDay() // 0=Sun

  // Find 3rd Friday of current month
  const findThirdFriday = (y: number, m: number): Date => {
    const d = new Date(y, m, 1)
    // Advance to first Friday
    while (d.getDay() !== 5) d.setDate(d.getDate() + 1)
    // Add 2 more weeks
    d.setDate(d.getDate() + 14)
    return d
  }

  const thisMonthOpEx = findThirdFriday(year, month)
  const nextMonthOpEx = findThirdFriday(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)

  const opExDate  = today <= thisMonthOpEx.getDate() ? thisMonthOpEx : nextMonthOpEx
  const daysToOpEx = Math.ceil((opExDate.getTime() - now.getTime()) / 86400000)
  const isOpExWeek = daysToOpEx <= 5 && daysToOpEx >= 0
  const isOpExDay  = daysToOpEx === 0
  const isWeekAfter = daysToOpEx < 0 && daysToOpEx >= -5 // past OpEx within 5 days

  // Weekly OpEx (every Friday for weeklies)
  const nextFriday = new Date(now)
  while (nextFriday.getDay() !== 5) nextFriday.setDate(nextFriday.getDate() + 1)
  const daysToWeekly = nextFriday.getDay() === 5 && dow === 5 ? 0 : Math.ceil((nextFriday.getTime() - now.getTime()) / 86400000)
  const isWeeklyOpEx = dow === 5 // Today is Friday

  type OpExPhase = 'pre-opex' | 'opex-week' | 'opex-day' | 'post-opex' | 'normal'
  let phase: OpExPhase = 'normal'
  let signal = 'NEUTRAL'
  let signalColor = '#f0a500'
  let description = ''
  let bias = ''

  if (isOpExDay) {
    phase       = 'opex-day'
    signal      = 'VOLATILE'
    signalColor = '#ff4560'
    bias        = 'HIGH GAMMA RISK'
    description = 'Maximum options pain today. Market makers unwind delta hedges aggressively. Expect pin risk near large open interest strikes. Intraday volatility spikes common.'
  } else if (isOpExWeek && daysToOpEx <= 3) {
    phase       = 'opex-week'
    signal      = 'BULLISH LEAN'
    signalColor = '#00c97a'
    bias        = 'DEALER HEDGING'
    description = 'OpEx week historically shows upward bias (especially in bull markets). Market makers net long delta → support rallies. 73% of OpEx weeks close positive in S&P 500 since 2010.'
  } else if (isOpExWeek) {
    phase       = 'pre-opex'
    signal      = 'WATCH'
    signalColor = '#f0a500'
    bias        = 'POSITIONING'
    description = 'Pre-OpEx positioning window. Institutional rebalancing begins. Watch for unusual options flow as dealers adjust hedges. Volume often picks up 3-5 days before expiration.'
  } else if (isWeekAfter) {
    phase       = 'post-opex'
    signal      = 'BEARISH LEAN'
    signalColor = '#ff4560'
    bias        = 'DELTA UNWIND'
    description = 'Post-OpEx unwind period. Dealer delta hedges removed → support disappears. Historically the week after OpEx shows slight negative bias. Momentum strategies underperform.'
  } else {
    phase       = 'normal'
    signal      = 'NORMAL'
    signalColor = 'var(--text-muted)'
    bias        = 'STANDARD FLOW'
    description = `Next monthly OpEx is in ${daysToOpEx} days. Options gamma is low — directional moves tend to persist without pin risk. Trend-following strategies perform better in this window.`
  }

  // Monthly OpEx stats
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const opExMonthStr = `${monthNames[opExDate.getMonth()]} ${opExDate.getDate()}, ${opExDate.getFullYear()}`

  return {
    phase, signal, signalColor, bias, description,
    daysToOpEx, isOpExWeek, isOpExDay, isWeeklyOpEx,
    opExDateStr: opExMonthStr,
    daysToWeekly,
  }
}

// ── Turn of Month (TOM) ───────────────────────────────────────────────────────
// Research: Last trading day of month + first 4 trading days of next month
// Source: Lakonishok & Smidt (1988), Ogden (1990), numerous replications
function getTOMInfo() {
  const now        = new Date()
  const year       = now.getFullYear()
  const month      = now.getMonth()
  const today      = now.getDate()
  const dow        = now.getDay()

  // Last trading day of current month
  const lastDayOfMonth = new Date(year, month + 1, 0) // last day of month
  const lastTradingDay = new Date(lastDayOfMonth)
  while (lastTradingDay.getDay() === 0 || lastTradingDay.getDay() === 6) {
    lastTradingDay.setDate(lastTradingDay.getDate() - 1)
  }

  // First 4 trading days of next month
  const firstOfNext = new Date(year, month + 1, 1)
  const tradingDaysNext: number[] = []
  const cursor = new Date(firstOfNext)
  while (tradingDaysNext.length < 4) {
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) {
      tradingDaysNext.push(cursor.getDate())
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  const lastTradDay4 = new Date(year, month + 1, tradingDaysNext[3])

  // Determine TOM window
  const isLastTradingDay = today === lastTradingDay.getDate() && month === lastTradingDay.getMonth() && (dow >= 1 && dow <= 5)
  const isInFirstFour   = month === (now.getMonth()) && tradingDaysNext.includes(today) // simplified
  
  // Days until next TOM
  const daysToLastTrad = Math.ceil((lastTradingDay.getTime() - now.getTime()) / 86400000)
  const daysToTOM = daysToLastTrad > 0 ? daysToLastTrad : Math.ceil((firstOfNext.getTime() - now.getTime()) / 86400000)

  const inTOMWindow = isLastTradingDay || (today <= 4 && month !== lastTradingDay.getMonth() && (dow >= 1 && dow <= 5))

  type TOMPhase = 'in-window' | 'approaching' | 'normal'
  let phase: TOMPhase = 'normal'
  let signal = 'NORMAL'
  let signalColor = 'var(--text-muted)'
  let description = ''
  let strength = 0

  if (inTOMWindow) {
    phase       = 'in-window'
    signal      = 'BULLISH WINDOW'
    signalColor = '#00c97a'
    strength    = 4
    description = 'You are in the Turn of Month window — historically the most bullish 5-day period of any month. Driven by: pension fund contributions, month-end portfolio rebalancing, and fresh capital deployment. S&P 500 captures ~70% of monthly returns in these 5 days.'
  } else if (daysToTOM <= 4) {
    phase       = 'approaching'
    signal      = 'APPROACHING TOM'
    signalColor = '#f0a500'
    strength    = 2
    description = `TOM window begins in ${daysToTOM} day${daysToTOM !== 1 ? 's' : ''}. Historically, pre-positioning begins 2-3 days early. Watch for breadth improvement and volume pickup.`
  } else {
    phase       = 'normal'
    signal      = 'INTER-MONTH'
    signalColor = 'var(--text-muted)'
    strength    = 1
    description = `Next TOM window in ~${daysToTOM} days. Inter-month period shows no consistent directional bias. Mid-month is often the weakest phase. Focus on relative strength and sector rotation.`
  }

  // Historical stats
  const monthNames  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const nextTOMDate = `${monthNames[lastTradingDay.getMonth()]} ${lastTradingDay.getDate()}`

  // Which day of month are we in?
  const dayOfMonth = today
  const isEarlyMonth = dayOfMonth <= 4
  const isMidMonth   = dayOfMonth >= 10 && dayOfMonth <= 20
  const isLateMonth  = dayOfMonth >= 21

  return {
    phase, signal, signalColor, description, strength,
    daysToTOM, inTOMWindow,
    nextTOMDate, dayOfMonth, isEarlyMonth, isMidMonth, isLateMonth,
    // Historical return stats by month phase (approximate, well-documented)
    stats: [
      { label: 'Last 1 TD',     return: '+0.31%', days: 'day -1' },
      { label: 'First 2 TDs',   return: '+0.24%', days: 'days 1-2' },
      { label: 'Days 3-4',      return: '+0.18%', days: 'days 3-4' },
      { label: 'Rest of month', return: '+0.04%', days: 'avg day' },
    ]
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
type TabId = 'moon' | 'season' | 'day' | 'opex' | 'tom'

export default function AlternativeSignalsPanel() {
  const [moon,      setMoon]      = useState<MoonInfo | null>(null)
  const [season,    setSeason]    = useState(getSeasonality())
  const [dayEffect, setDayEffect] = useState(getDayEffect())
  const [opex,      setOpEx]      = useState(getOpExInfo())
  const [tom,       setTOM]       = useState(getTOMInfo())
  const [activeTab, setActiveTab] = useState<TabId>('moon')

  useEffect(() => {
    setMoon(getMoonInfo())
    const t = setInterval(() => {
      setMoon(getMoonInfo())
      setSeason(getSeasonality())
      setDayEffect(getDayEffect())
      setOpEx(getOpExInfo())
      setTOM(getTOMInfo())
    }, 60_000)
    return () => clearInterval(t)
  }, [])

  const tabs: [string, string, TabId][] = [
    ['🌙', 'LUNAR',  'moon'],
    ['📅', 'SEASON', 'season'],
    ['📆', 'DOW',    'day'],
    ['📊', 'OPEX',   'opex'],
    ['🔄', 'TOM',    'tom'],
  ]

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#a78bfa' }} />
          ALT SIGNALS
        </div>
        <div style={{ display: 'flex', gap: '2px', flexWrap: 'wrap' }}>
          {tabs.map(([icon, label, tab]) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '2px 7px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
              letterSpacing: '0.05em', border: 'none',
              background: activeTab === tab ? 'rgba(167,139,250,0.2)' : 'transparent',
              color: activeTab === tab ? '#a78bfa' : 'var(--text-muted)',
            }}>
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, padding: '14px', overflowY: 'auto' }}>

        {/* ── MOON TAB ── */}
        {activeTab === 'moon' && moon && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{ fontSize: '56px', lineHeight: 1, filter: 'drop-shadow(0 0 14px rgba(167,139,250,0.5))' }}>
                {moon.emoji}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '15px', color: '#fff' }}>
                  {moon.phase}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '3px' }}>
                  Day {moon.age.toFixed(1)} / 29.5 · {moon.illumination}% lit
                </div>
                <div style={{
                  marginTop: '7px', display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '3px 10px', borderRadius: '3px',
                  background: moon.signalColor + '22', border: `1px solid ${moon.signalColor}44`,
                }}>
                  <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: moon.signalColor }} />
                  <span style={{ fontSize: '10px', color: moon.signalColor, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', fontWeight: 700 }}>
                    {moon.signal}
                  </span>
                </div>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>🌑 NEW</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>🌕 FULL</span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>🌑 NEW</span>
              </div>
              <div style={{ height: '7px', background: 'var(--bg-deep)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  height: '100%', width: `${(moon.age / LUNAR_CYCLE) * 100}%`, borderRadius: '4px',
                  background: moon.age < 14.75 ? 'linear-gradient(90deg, #a78bfa, #00c97a)' : 'linear-gradient(90deg, #00c97a, #a78bfa, #ff4560)',
                  transition: 'width 0.5s ease',
                }} />
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: '1px', background: 'rgba(255,255,255,0.2)' }} />
              </div>
            </div>
            <div style={{
              padding: '10px 12px', background: 'rgba(167,139,250,0.06)',
              border: '1px solid rgba(167,139,250,0.15)', borderLeft: '3px solid #a78bfa',
              borderRadius: '0 5px 5px 0', fontSize: '11px', color: 'var(--text-2)',
              fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.65,
            }}>
              {moon.description}
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', background: 'var(--bg-deep)', borderRadius: '4px',
            }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                NEXT {moon.nextEmoji} {moon.nextPhase.toUpperCase()}
              </span>
              <span style={{ fontSize: '13px', color: '#a78bfa', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                {moon.daysToNext}d away
              </span>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
              ⚠ Lunar signals are historical folklore only — not financial advice.
            </div>
          </div>
        )}

        {/* ── SEASON TAB ── */}
        {activeTab === 'season' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
              <div style={{ fontSize: '32px', fontFamily: 'Syne, sans-serif', fontWeight: 800, color: '#fff' }}>
                {season.label}
              </div>
              <div style={{
                marginTop: '10px', display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '4px 16px', borderRadius: '4px',
                background: season.color + '22', border: `1px solid ${season.color}44`,
              }}>
                <span style={{ fontSize: '13px', color: season.color, fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>
                  {season.bias}
                </span>
              </div>
            </div>
            <div style={{
              padding: '12px', background: 'var(--bg-deep)', borderRadius: '5px',
              fontSize: '11px', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace',
              lineHeight: 1.65, borderLeft: `3px solid ${season.color}`,
            }}>
              {season.detail}
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: '7px', letterSpacing: '0.1em' }}>
                BEST 6 MONTHS CYCLE (NOV – APR)
              </div>
              <div style={{ display: 'flex', gap: '3px' }}>
                {['N','D','J','F','M','A','M','J','J','A','S','O'].map((m, i) => {
                  const isBest   = i < 6
                  const monthMap = [10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
                  const isCurrent = monthMap[i] === season.month
                  return (
                    <div key={i} style={{
                      flex: 1, padding: '5px 0', textAlign: 'center', borderRadius: '3px',
                      fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
                      background: isCurrent ? (isBest ? 'rgba(0,201,122,0.45)' : 'rgba(255,69,96,0.45)') : (isBest ? 'rgba(0,201,122,0.1)' : 'rgba(255,69,96,0.06)'),
                      color:      isCurrent ? '#fff' : (isBest ? 'var(--positive)' : 'var(--text-muted)'),
                      border:     isCurrent ? `1px solid ${isBest ? 'var(--positive)' : 'var(--negative)'}` : 'none',
                      fontWeight: isCurrent ? 700 : 400,
                    }}>
                      {m}
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
              ⚠ Historical patterns only — not financial advice.
            </div>
          </div>
        )}

        {/* ── DAY OF WEEK TAB ── */}
        {activeTab === 'day' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ textAlign: 'center', padding: '10px 0 4px' }}>
              <div style={{ fontSize: '30px', fontFamily: 'Syne, sans-serif', fontWeight: 800, color: '#fff' }}>
                {dayEffect.day}
              </div>
              <div style={{
                marginTop: '8px', display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '4px 14px', borderRadius: '4px',
                background: dayEffect.color + '22', border: `1px solid ${dayEffect.color}44`,
              }}>
                <span style={{ fontSize: '13px', color: dayEffect.color, fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>
                  {dayEffect.signal}
                </span>
              </div>
            </div>
            <div style={{
              padding: '12px', background: 'var(--bg-deep)', borderRadius: '5px',
              fontSize: '11px', color: 'var(--text-2)', fontFamily: 'JetBrains Mono, monospace',
              lineHeight: 1.65, borderLeft: `3px solid ${dayEffect.color}`,
            }}>
              {dayEffect.note}
            </div>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: '8px', letterSpacing: '0.1em' }}>
                HISTORICAL BULLISH STRENGTH
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '5px' }}>
                {(['Mon','Tue','Wed','Thu','Fri'] as const).map((d, i) => {
                  const strengths = [2, 3, 3, 4, 3]
                  const dayNums   = [1, 2, 3, 4, 5]
                  const isCurrent = new Date().getDay() === dayNums[i]
                  const s = strengths[i]
                  return (
                    <div key={d} style={{
                      padding: '7px 4px', textAlign: 'center', borderRadius: '4px',
                      background: isCurrent ? 'rgba(240,165,0,0.12)' : 'var(--bg-deep)',
                      border: `1px solid ${isCurrent ? 'rgba(240,165,0,0.3)' : 'var(--border)'}`,
                    }}>
                      <div style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: isCurrent ? 'var(--amber)' : 'var(--text-muted)', fontWeight: isCurrent ? 700 : 400, marginBottom: '5px' }}>
                        {d}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '2px' }}>
                        {[1,2,3,4,5].map(n => (
                          <div key={n} style={{ width: '5px', height: '5px', borderRadius: '1px', background: n <= s ? 'var(--positive)' : 'var(--border)' }} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
              ⚠ Statistical patterns only — not financial advice.
            </div>
          </div>
        )}

        {/* ── OPEX TAB ── */}
        {activeTab === 'opex' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', padding: '8px 0 2px' }}>
              <div style={{ fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 800, color: '#fff', marginBottom: '8px' }}>
                OPTIONS EXPIRATION CYCLE
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '5px 16px', borderRadius: '4px',
                background: opex.signalColor + '22', border: `1px solid ${opex.signalColor}44`,
              }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: opex.signalColor, boxShadow: `0 0 6px ${opex.signalColor}` }} />
                <span style={{ fontSize: '13px', color: opex.signalColor, fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>
                  {opex.signal}
                </span>
              </div>
              {opex.bias && (
                <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em' }}>
                  {opex.bias}
                </div>
              )}
            </div>

            {/* Description */}
            <div style={{
              padding: '10px 12px', background: 'rgba(167,139,250,0.05)',
              border: '1px solid rgba(167,139,250,0.15)', borderLeft: `3px solid ${opex.signalColor}`,
              borderRadius: '0 5px 5px 0', fontSize: '11px', color: 'var(--text-2)',
              fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.65,
            }}>
              {opex.description}
            </div>

            {/* Next OpEx countdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
              <div style={{ padding: '8px 10px', background: 'var(--bg-deep)', borderRadius: '4px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '4px' }}>
                  MONTHLY OPEX
                </div>
                <div style={{ fontSize: '15px', fontWeight: 900, color: opex.isOpExDay ? '#ff4560' : opex.isOpExWeek ? '#f0a500' : '#fff', fontFamily: 'Syne, sans-serif', lineHeight: 1 }}>
                  {opex.isOpExDay ? 'TODAY' : `${opex.daysToOpEx}d`}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '3px' }}>
                  {opex.opExDateStr}
                </div>
              </div>
              <div style={{ padding: '8px 10px', background: 'var(--bg-deep)', borderRadius: '4px', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '4px' }}>
                  WEEKLY OPEX
                </div>
                <div style={{ fontSize: '15px', fontWeight: 900, color: opex.isWeeklyOpEx ? '#ff4560' : '#fff', fontFamily: 'Syne, sans-serif', lineHeight: 1 }}>
                  {opex.isWeeklyOpEx ? 'TODAY' : `${opex.daysToWeekly}d`}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '3px' }}>
                  Every Friday
                </div>
              </div>
            </div>

            {/* OpEx cycle phases */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '8px' }}>
                MONTHLY OPEX CYCLE PATTERN
              </div>
              {[
                { label: 'Week Before',  bias: 'BULLISH', color: '#00c97a', desc: 'Dealer long gamma → market support' },
                { label: 'OpEx Week',    bias: 'BULLISH', color: '#00c97a', desc: '73% positive in bull markets' },
                { label: 'OpEx Day',     bias: 'VOLATILE', color: '#ff4560', desc: 'Pin risk, intraday swings' },
                { label: 'Week After',   bias: 'BEARISH', color: '#ff4560', desc: 'Hedge removal → support gone' },
              ].map(({ label, bias, color, desc }) => (
                <div key={label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '5px 8px', borderBottom: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontSize: '10px', color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>{label}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{desc}</div>
                  </div>
                  <span style={{
                    fontSize: '10px', padding: '3px 8px', borderRadius: '2px',
                    background: color + '18', color, border: `1px solid ${color}33`,
                    fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                  }}>{bias}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
              ⚠ Statistical patterns only — not financial advice.
            </div>
          </div>
        )}

        {/* ── TOM TAB ── */}
        {activeTab === 'tom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Header */}
            <div style={{ textAlign: 'center', padding: '8px 0 2px' }}>
              <div style={{ fontSize: '13px', fontFamily: 'Syne, sans-serif', fontWeight: 800, color: '#fff', marginBottom: '6px' }}>
                TURN OF MONTH EFFECT
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '5px 16px', borderRadius: '4px',
                background: tom.signalColor + '22', border: `1px solid ${tom.signalColor}44`,
              }}>
                <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: tom.signalColor, boxShadow: `0 0 6px ${tom.signalColor}`, animation: tom.inTOMWindow ? 'pulseDot 1.5s ease-in-out infinite' : 'none' }} />
                <span style={{ fontSize: '13px', color: tom.signalColor, fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>
                  {tom.signal}
                </span>
              </div>
            </div>

            {/* Description */}
            <div style={{
              padding: '10px 12px', background: 'rgba(167,139,250,0.05)',
              border: '1px solid rgba(167,139,250,0.15)', borderLeft: `3px solid ${tom.signalColor}`,
              borderRadius: '0 5px 5px 0', fontSize: '11px', color: 'var(--text-2)',
              fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.65,
            }}>
              {tom.description}
            </div>

            {/* Current position in month */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '6px' }}>
                POSITION IN MONTHLY CYCLE
              </div>
              <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                {[...Array(31)].map((_, i) => {
                  const day = i + 1
                  const isTOM = day <= 4 || day >= 28 // simplified visual
                  const isToday = day === tom.dayOfMonth
                  return (
                    <div key={day} style={{
                      flex: 1, height: '20px', borderRadius: '2px',
                      background: isToday ? (isTOM ? '#00c97a' : '#f0a500') : (isTOM ? 'rgba(0,201,122,0.3)' : 'rgba(74,96,112,0.2)'),
                      border:     isToday ? `1px solid ${isTOM ? '#00c97a' : '#f0a500'}` : 'none',
                      position:   'relative',
                    }}>
                      {isToday && (
                        <div style={{ position: 'absolute', top: '-12px', left: '50%', transform: 'translateX(-50%)', fontSize: '10px', color: isTOM ? '#00c97a' : '#f0a500', fontFamily: 'JetBrains Mono, monospace' }}>
                          ▼
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <span style={{ fontSize: '10px', color: 'var(--positive)', fontFamily: 'JetBrains Mono, monospace' }}>TOM start</span>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>Mid-month (neutral)</span>
                <span style={{ fontSize: '10px', color: 'var(--positive)', fontFamily: 'JetBrains Mono, monospace' }}>TOM end</span>
              </div>
            </div>

            {/* Historical return stats */}
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', marginBottom: '6px' }}>
                HISTORICAL AVERAGE DAILY S&P RETURN
              </div>
              {tom.stats.map(s => (
                <div key={s.label} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '5px 8px', borderBottom: '1px solid var(--border)',
                }}>
                  <div>
                    <div style={{ fontSize: '10px', color: '#fff', fontFamily: 'JetBrains Mono, monospace' }}>{s.label}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{s.days}</div>
                  </div>
                  <span style={{
                    fontSize: '13px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                    color: s.return.startsWith('+') ? 'var(--positive)' : 'var(--text-muted)',
                  }}>{s.return}</span>
                </div>
              ))}
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginTop: '5px', lineHeight: 1.6 }}>
                Source: Lakonishok & Smidt (1988), updated through 2023
              </div>
            </div>

            {/* Next TOM */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', background: 'var(--bg-deep)', borderRadius: '4px',
            }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                🔄 NEXT TOM WINDOW
              </span>
              <span style={{ fontSize: '13px', color: '#00c97a', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                {tom.inTOMWindow ? 'NOW ACTIVE' : tom.nextTOMDate}
              </span>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
              ⚠ Historical patterns only — not financial advice.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}