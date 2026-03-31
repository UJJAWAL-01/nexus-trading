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

export default function AlternativeSignalsPanel() {
  const [moon,       setMoon]       = useState<MoonInfo | null>(null)
  const [season,     setSeason]     = useState(getSeasonality())
  const [dayEffect,  setDayEffect]  = useState(getDayEffect())
  const [activeTab,  setActiveTab]  = useState<'moon' | 'season' | 'day'>('moon')

  useEffect(() => {
    setMoon(getMoonInfo())
    const t = setInterval(() => {
      setMoon(getMoonInfo())
      setSeason(getSeasonality())
      setDayEffect(getDayEffect())
    }, 60_000)
    return () => clearInterval(t)
  }, [])

  const tabs: [string, string, 'moon' | 'season' | 'day'][] = [
    ['🌙', 'LUNAR',  'moon'],
    ['📅', 'SEASON', 'season'],
    ['📆', 'DOW',    'day'],
  ]

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#a78bfa' }} />
          ALT SIGNALS
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {tabs.map(([icon, label, tab]) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
              letterSpacing: '0.06em', border: 'none',
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
                  background: moon.signalColor + '22',
                  border: `1px solid ${moon.signalColor}44`,
                }}>
                  <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: moon.signalColor }} />
                  <span style={{ fontSize: '10px', color: moon.signalColor, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em', fontWeight: 700 }}>
                    {moon.signal}
                  </span>
                </div>
              </div>
            </div>

            {/* Cycle bar */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>🌑 NEW</span>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>🌕 FULL</span>
                <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>🌑 NEW</span>
              </div>
              <div style={{ height: '7px', background: 'var(--bg-deep)', borderRadius: '4px', overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  height: '100%', width: `${(moon.age / LUNAR_CYCLE) * 100}%`,
                  borderRadius: '4px',
                  background: moon.age < 14.75
                    ? 'linear-gradient(90deg, #a78bfa, #00c97a)'
                    : 'linear-gradient(90deg, #00c97a, #a78bfa, #ff4560)',
                  transition: 'width 0.5s ease',
                }} />
                {/* Full moon marker */}
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, left: '50%',
                  width: '1px', background: 'rgba(255,255,255,0.2)',
                }} />
              </div>
            </div>

            {/* Description */}
            <div style={{
              padding: '10px 12px',
              background: 'rgba(167,139,250,0.06)',
              border: '1px solid rgba(167,139,250,0.15)',
              borderLeft: '3px solid #a78bfa',
              borderRadius: '0 5px 5px 0',
              fontSize: '11px', color: 'var(--text-2)',
              fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.65,
            }}>
              {moon.description}
            </div>

            {/* Next event */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 12px', background: 'var(--bg-deep)', borderRadius: '4px',
            }}>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
                NEXT {moon.nextEmoji} {moon.nextPhase.toUpperCase()}
              </span>
              <span style={{ fontSize: '12px', color: '#a78bfa', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                {moon.daysToNext}d away
              </span>
            </div>

            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center', lineHeight: 1.5 }}>
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

            {/* 12-month strip */}
            <div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: '7px', letterSpacing: '0.1em' }}>
                BEST 6 MONTHS CYCLE (NOV – APR)
              </div>
              <div style={{ display: 'flex', gap: '3px' }}>
                {['N','D','J','F','M','A','M','J','J','A','S','O'].map((m, i) => {
                  const isBest    = i < 6
                  const monthMap  = [10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
                  const isCurrent = monthMap[i] === season.month
                  return (
                    <div key={i} style={{
                      flex: 1, padding: '5px 0', textAlign: 'center', borderRadius: '3px',
                      fontSize: '8px', fontFamily: 'JetBrains Mono, monospace',
                      background: isCurrent
                        ? (isBest ? 'rgba(0,201,122,0.45)' : 'rgba(255,69,96,0.45)')
                        : (isBest ? 'rgba(0,201,122,0.1)'  : 'rgba(255,69,96,0.06)'),
                      color: isCurrent ? '#fff' : (isBest ? 'var(--positive)' : 'var(--text-muted)'),
                      border: isCurrent ? `1px solid ${isBest ? 'var(--positive)' : 'var(--negative)'}` : 'none',
                      fontWeight: isCurrent ? 700 : 400,
                    }}>
                      {m}
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '9px', fontFamily: 'JetBrains Mono, monospace' }}>
                <span style={{ color: 'var(--positive)' }}>▲ Strong (Nov–Apr)</span>
                <span style={{ color: 'var(--negative)' }}>▼ Weak (May–Oct)</span>
              </div>
            </div>

            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
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
                <span style={{ fontSize: '12px', color: dayEffect.color, fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>
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

            {/* Day strength grid — Mon to Fri */}
            <div>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', marginBottom: '8px', letterSpacing: '0.1em' }}>
                HISTORICAL BULLISH STRENGTH
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '5px' }}>
                {(['Mon','Tue','Wed','Thu','Fri'] as const).map((d, i) => {
                  const strengths = [2, 3, 3, 4, 3]
                  const dayNums   = [1, 2, 3, 4, 5]
                  const isCurrent = new Date().getDay() === dayNums[i]
                  const s         = strengths[i]
                  return (
                    <div key={d} style={{
                      padding: '7px 4px', textAlign: 'center', borderRadius: '4px',
                      background: isCurrent ? 'rgba(240,165,0,0.12)' : 'var(--bg-deep)',
                      border: `1px solid ${isCurrent ? 'rgba(240,165,0,0.3)' : 'var(--border)'}`,
                    }}>
                      <div style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: isCurrent ? 'var(--amber)' : 'var(--text-muted)', fontWeight: isCurrent ? 700 : 400, marginBottom: '5px' }}>
                        {d}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center', gap: '2px' }}>
                        {[1,2,3,4,5].map(n => (
                          <div key={n} style={{
                            width: '5px', height: '5px', borderRadius: '1px',
                            background: n <= s ? 'var(--positive)' : 'var(--border)',
                          }} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', textAlign: 'center' }}>
              ⚠ Statistical patterns only — not financial advice.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}