'use client'
// src/components/panels/AlternativeDataPanel.tsx
// Alt-data viewer: Wikipedia pageviews + Reddit mentions/sentiment + HN mentions.
// Each section ships a "signal read" — algorithmic 1-line interpretation derived
// from latest vs 30-day baseline, peak detection, and trend slope. No AI, no
// trading recommendations — just descriptive statistics in plain English.

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  ResponsiveContainer, LineChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ComposedChart,
} from 'recharts'
import { useWatchlist } from '@/store/watchlist'

// ── Types (mirror server payload) ─────────────────────────────────────────────
interface WikiSeries   { dates: string[]; views: number[]; article: string }
interface RedditSeries { dates: string[]; mentions: number[]; sentiment: number[]; totalPosts: number }
interface HNSeries     { dates: string[]; mentions: number[]; topStory: { title: string; url: string; points: number; date: string } | null }

interface AltDataResponse {
  ticker:      string
  companyName: string | null
  lastUpdated: string
  sources: {
    wikipedia:  WikiSeries   | null
    reddit:     RedditSeries | null
    hackerNews: HNSeries     | null
  }
  errors: { wikipedia?: string; reddit?: string; hackerNews?: string }
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

const TT_STYLE: React.CSSProperties = {
  background: 'var(--bg-deep)', border: '1px solid var(--border)',
  borderRadius: '4px', fontSize: '11px', color: '#fff',
  fontFamily: 'JetBrains Mono, monospace', padding: '6px 8px',
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m, 10) - 1] ?? m} ${parseInt(d, 10)}`
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}

function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : ''
  return `${sign}${Math.round(n)}%`
}

// ── Statistics over a daily series ────────────────────────────────────────────
interface SeriesStats {
  latest:    number      // most recent non-null value (or last value)
  latestDate: string
  avg30d:    number      // mean of last 30 days
  peak:      number
  peakDate:  string
  vsAvgPct:  number      // (latest - avg30d) / avg30d * 100
  trendSlope: number     // simple linear regression slope (units / day)
  trendDir:  'up' | 'down' | 'flat'
}

function computeStats(dates: string[], values: number[]): SeriesStats | null {
  if (!dates.length || !values.length || dates.length !== values.length) return null
  const window = values.slice(-30)
  const winDates = dates.slice(-30)
  if (window.length === 0) return null

  const sum = window.reduce((s, v) => s + v, 0)
  const avg30d = sum / window.length

  // "latest" = the most recent non-zero value if all-zeros baseline; otherwise last
  const latest = window[window.length - 1] ?? 0
  const latestDate = winDates[winDates.length - 1] ?? ''

  let peak = -Infinity
  let peakDate = ''
  for (let i = 0; i < window.length; i++) {
    if (window[i] > peak) { peak = window[i]; peakDate = winDates[i] }
  }
  if (!Number.isFinite(peak)) peak = 0

  const vsAvgPct = avg30d > 0 ? ((latest - avg30d) / avg30d) * 100 : 0

  // Linear regression on the 30-day window: slope of fitted line
  const n = window.length
  const xMean = (n - 1) / 2
  const yMean = avg30d
  let num = 0, den = 0
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (window[i] - yMean)
    den += (i - xMean) ** 2
  }
  const trendSlope = den === 0 ? 0 : num / den
  // "Flat" if slope is < 5% of mean per day
  const flatThreshold = Math.max(yMean * 0.05, 0.5)
  const trendDir: SeriesStats['trendDir'] =
    Math.abs(trendSlope) < flatThreshold ? 'flat' : trendSlope > 0 ? 'up' : 'down'

  return { latest, latestDate, avg30d, peak, peakDate, vsAvgPct, trendSlope, trendDir }
}

// ── Algorithmic signal-read text ──────────────────────────────────────────────
function wikiSignalRead(s: SeriesStats, article: string): { text: string; tone: 'pos' | 'neg' | 'neu' } {
  if (s.avg30d === 0) return { text: `Almost no Wikipedia traffic for "${article}".`, tone: 'neu' }
  const elev = s.vsAvgPct
  if (Math.abs(elev) < 15) {
    return { text: `Wikipedia traffic is in line with the 30-day baseline (~${fmtNum(Math.round(s.avg30d))}/day).`, tone: 'neu' }
  }
  const tone = elev > 0 ? 'pos' : 'neg'
  const verb = elev > 0 ? 'above' : 'below'
  return {
    text: `Wikipedia traffic is ${fmtPct(elev)} ${verb} the 30-day average. Peak ${fmtNum(s.peak)} on ${shortDate(s.peakDate)}.`,
    tone,
  }
}

function redditSignalRead(s: SeriesStats, totalPosts: number, sentArr: number[]): { text: string; tone: 'pos' | 'neg' | 'neu' } {
  const recentSent = sentArr.slice(-7).filter(v => v !== 0)
  const avgSent = recentSent.length > 0 ? recentSent.reduce((a, b) => a + b, 0) / recentSent.length : 0

  if (totalPosts < 5) return { text: `Low Reddit chatter — only ${totalPosts} matching posts found in the last 30 days.`, tone: 'neu' }

  const sentLabel = avgSent > 20 ? 'bullish-leaning' : avgSent < -20 ? 'bearish-leaning' : 'mixed'
  const sentTone: 'pos' | 'neg' | 'neu' = avgSent > 20 ? 'pos' : avgSent < -20 ? 'neg' : 'neu'
  const elev = s.vsAvgPct

  if (s.peak >= 3 * Math.max(s.avg30d, 1) && s.peak >= 5) {
    return {
      text: `Mention spike: ${s.peak} posts on ${shortDate(s.peakDate)} (vs ${s.avg30d.toFixed(1)}/day avg). Recent keyword sentiment ${sentLabel} (${fmtPct(avgSent)}).`,
      tone: sentTone,
    }
  }
  if (Math.abs(elev) >= 30) {
    return {
      text: `Reddit chatter ${elev > 0 ? 'elevated' : 'subdued'} (${fmtPct(elev)} vs avg). Recent sentiment ${sentLabel} (${fmtPct(avgSent)}).`,
      tone: sentTone,
    }
  }
  return {
    text: `Steady Reddit activity (~${s.avg30d.toFixed(1)} posts/day). Recent keyword sentiment ${sentLabel} (${fmtPct(avgSent)}).`,
    tone: sentTone,
  }
}

function hnSignalRead(
  s: SeriesStats,
  totalMentions: number,
  topStory: HNSeries['topStory'],
): { text: string; tone: 'pos' | 'neg' | 'neu' } {
  if (totalMentions === 0) {
    return { text: 'No Hacker News story mentions in the last 30 days. Tech audience is not discussing this ticker.', tone: 'neu' }
  }
  if (totalMentions < 3) {
    return { text: `Sparse HN coverage — ${totalMentions} stor${totalMentions === 1 ? 'y' : 'ies'} in 30 days.`, tone: 'neu' }
  }
  const peakNote = s.peak >= 2 * Math.max(s.avg30d, 0.5)
    ? ` Peak ${s.peak} stor${s.peak === 1 ? 'y' : 'ies'} on ${shortDate(s.peakDate)}.`
    : ''
  const topNote = topStory ? ` Top: "${topStory.title.slice(0, 70)}${topStory.title.length > 70 ? '…' : ''}" (${topStory.points} pts).` : ''
  return {
    text: `${totalMentions} HN mentions in 30 days, avg ${s.avg30d.toFixed(1)}/day.${peakNote}${topNote}`,
    tone: 'neu',
  }
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AlternativeDataPanel() {
  const [input, setInput] = useState('AAPL')
  const [query, setQuery] = useState('AAPL')
  const watchlist = useWatchlist(s => s.symbols)

  const url = query ? `/api/alternative-data?ticker=${encodeURIComponent(query)}` : null
  const { data, error, isLoading, mutate } = useSWR<AltDataResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval:  60_000,
  })

  const submit = () => {
    const v = input.trim().toUpperCase()
    if (v) setQuery(v)
  }

  const wiki   = data?.sources.wikipedia  ?? null
  const reddit = data?.sources.reddit     ?? null
  const hn     = data?.sources.hackerNews ?? null

  // Derived: stats + signal reads
  const wikiStats   = useMemo(() => wiki   ? computeStats(wiki.dates, wiki.views)   : null, [wiki])
  const redditStats = useMemo(() => reddit ? computeStats(reddit.dates, reddit.mentions) : null, [reddit])
  const hnStats     = useMemo(() => hn     ? computeStats(hn.dates, hn.mentions)    : null, [hn])

  const wikiRead   = wiki   && wikiStats   ? wikiSignalRead(wikiStats, wiki.article) : null
  const redditRead = reddit && redditStats ? redditSignalRead(redditStats, reddit.totalPosts, reddit.sentiment) : null
  const hnRead     = hn     && hnStats     ? hnSignalRead(hnStats, hn.mentions.reduce((a, b) => a + b, 0), hn.topStory) : null

  // Chart data (Recharts-ready)
  const wikiData = useMemo(() => wiki ? wiki.dates.map((d, i) => ({ date: shortDate(d), value: wiki.views[i] ?? 0 })) : [], [wiki])
  const redditData = useMemo(() => reddit ? reddit.dates.map((d, i) => ({
    date: shortDate(d), mentions: reddit.mentions[i] ?? 0, sentiment: reddit.sentiment[i] ?? 0,
  })) : [], [reddit])
  const hnData = useMemo(() => hn ? hn.dates.map((d, i) => ({ date: shortDate(d), value: hn.mentions[i] ?? 0 })) : [], [hn])

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', fontFamily: 'JetBrains Mono, monospace' }}>
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ flexShrink: 0, justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div className="dot" style={{ background: '#a78bfa', flexShrink: 0 }} />
          <span style={{ fontSize: '10px', letterSpacing: '0.12em', fontWeight: 700 }}>ALT DATA</span>
          {data?.companyName && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>· {data.companyName}</span>
          )}
        </div>
        <button onClick={() => mutate()} disabled={isLoading} style={{
          fontSize: '10px', padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
          border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
        }}>
          {isLoading ? '···' : '↺ Refresh'}
        </button>
      </div>

      {/* ── Search ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0,
                    display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          placeholder="Ticker (e.g. NVDA)"
          style={{
            flex: 1, minWidth: '120px',
            background: 'var(--bg-deep)', color: '#fff',
            border: '1px solid var(--border)', borderRadius: '4px',
            padding: '5px 8px', fontSize: '11px', fontFamily: 'JetBrains Mono, monospace',
            outline: 'none',
          }}
        />
        <button onClick={submit} style={{
          padding: '5px 12px', borderRadius: '3px', cursor: 'pointer',
          border: '1px solid #a78bfa', background: 'rgba(167,139,250,0.12)',
          color: '#a78bfa', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
        }}>SEARCH</button>
        {watchlist.slice(0, 5).map(s => (
          <button key={s} onClick={() => { setInput(s); setQuery(s) }} style={{
            padding: '3px 7px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px',
            border: `1px solid ${query === s ? '#a78bfa' : 'var(--border)'}`,
            background: query === s ? 'rgba(167,139,250,0.08)' : 'transparent',
            color: query === s ? '#a78bfa' : 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace',
          }}>{s}</button>
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {isLoading && (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px' }}>
            Loading alternative data sources…
          </div>
        )}

        {!isLoading && error && (
          <div style={{ padding: '24px', textAlign: 'center', fontSize: '11px' }}>
            <div style={{ color: 'var(--negative)', marginBottom: '6px' }}>⚠ Network error</div>
            <button onClick={() => mutate()} style={{
              padding: '4px 10px', borderRadius: '3px', cursor: 'pointer', fontSize: '11px',
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)',
            }}>↺ Retry</button>
          </div>
        )}

        {!isLoading && !error && data && (
          <>
            {/* ── WIKIPEDIA ──────────────────────────────────────────────── */}
            <Section
              title="WIKIPEDIA · DAILY PAGE VIEWS"
              subtitle={wiki?.article ? `Article: ${wiki.article}` : undefined}
              error={data.errors.wikipedia}
              hasData={wikiData.length > 0}
              read={wikiRead}
              tiles={wikiStats ? [
                { label: 'TODAY',  value: fmtNum(Math.round(wikiStats.latest)),  hint: shortDate(wikiStats.latestDate) },
                { label: '30D AVG', value: fmtNum(Math.round(wikiStats.avg30d)) },
                { label: 'PEAK',   value: fmtNum(Math.round(wikiStats.peak)), hint: shortDate(wikiStats.peakDate) },
                { label: 'VS AVG', value: fmtPct(wikiStats.vsAvgPct),
                  color: wikiStats.vsAvgPct > 15 ? 'var(--positive)' : wikiStats.vsAvgPct < -15 ? 'var(--negative)' : undefined },
                { label: 'TREND',  value: trendIcon(wikiStats.trendDir) },
              ] : []}
            >
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={wikiData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="var(--text-muted)" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis stroke="var(--text-muted)" tick={{ fontSize: 9 }} width={42}
                         tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
                  <Tooltip contentStyle={TT_STYLE} />
                  {wikiStats && wikiStats.avg30d > 0 && (
                    <ReferenceLine y={wikiStats.avg30d} stroke="var(--text-muted)" strokeDasharray="3 3"
                                   label={{ value: '30D AVG', fill: 'var(--text-muted)', fontSize: 9, position: 'insideTopRight' }} />
                  )}
                  <Line type="monotone" dataKey="value" stroke="var(--teal)" strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </Section>

            {/* ── REDDIT ────────────────────────────────────────────────── */}
            <Section
              title="REDDIT · MENTIONS + KEYWORD SENTIMENT"
              subtitle={reddit ? `${reddit.totalPosts} matching posts in 30 days` : undefined}
              error={data.errors.reddit}
              hasData={redditData.length > 0}
              read={redditRead}
              tiles={redditStats && reddit ? [
                { label: 'TODAY',   value: String(Math.round(redditStats.latest)) + ' posts' },
                { label: '30D AVG', value: redditStats.avg30d.toFixed(1) + '/d' },
                { label: 'PEAK',    value: String(redditStats.peak), hint: shortDate(redditStats.peakDate) },
                { label: '7D SENT', value: fmtPct(avgRecentSentiment(reddit.sentiment, 7)),
                  color: avgRecentSentiment(reddit.sentiment, 7) > 20 ? 'var(--positive)'
                       : avgRecentSentiment(reddit.sentiment, 7) < -20 ? 'var(--negative)' : undefined },
                { label: 'TREND',   value: trendIcon(redditStats.trendDir) },
              ] : []}
            >
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={redditData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="var(--text-muted)" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" stroke="var(--text-muted)" tick={{ fontSize: 9 }} width={28} />
                  <YAxis yAxisId="right" orientation="right" domain={[-100, 100]}
                         stroke="var(--text-muted)" tick={{ fontSize: 9 }} width={32} />
                  <Tooltip contentStyle={TT_STYLE} />
                  <ReferenceLine yAxisId="right" y={0} stroke="var(--border)" strokeDasharray="2 2" />
                  <Bar yAxisId="left"  dataKey="mentions"  fill="#a78bfa" opacity={0.55} />
                  <Line yAxisId="right" type="monotone" dataKey="sentiment" stroke="var(--positive)" strokeWidth={1.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Section>

            {/* ── HACKER NEWS ──────────────────────────────────────────── */}
            <Section
              title="HACKER NEWS · STORY MENTIONS"
              subtitle={hn?.topStory ? `Top story ${hn.topStory.points} pts` : undefined}
              error={data.errors.hackerNews}
              hasData={hnData.length > 0}
              read={hnRead}
              tiles={hnStats && hn ? [
                { label: 'TOTAL',   value: String(hn.mentions.reduce((a, b) => a + b, 0)) },
                { label: '30D AVG', value: hnStats.avg30d.toFixed(1) + '/d' },
                { label: 'PEAK',    value: String(hnStats.peak), hint: hnStats.peak > 0 ? shortDate(hnStats.peakDate) : undefined },
                { label: 'TREND',   value: trendIcon(hnStats.trendDir) },
              ] : []}
              footer={hn?.topStory ? (
                <a href={hn.topStory.url} target="_blank" rel="noopener noreferrer" style={{
                  fontSize: '10px', color: '#a78bfa', textDecoration: 'none',
                }}>
                  ↗ {hn.topStory.title.slice(0, 90)}{hn.topStory.title.length > 90 ? '…' : ''}
                  <span style={{ color: 'var(--text-muted)', marginLeft: '6px' }}>
                    {hn.topStory.points} pts · {shortDate(hn.topStory.date)}
                  </span>
                </a>
              ) : undefined}
            >
              <ResponsiveContainer width="100%" height={110}>
                <ComposedChart data={hnData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="var(--text-muted)" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                  <YAxis stroke="var(--text-muted)" tick={{ fontSize: 9 }} width={28} allowDecimals={false} />
                  <Tooltip contentStyle={TT_STYLE} />
                  {hnStats && hnStats.avg30d > 0 && (
                    <ReferenceLine y={hnStats.avg30d} stroke="var(--text-muted)" strokeDasharray="3 3" />
                  )}
                  <Bar dataKey="value" fill="#f97316" opacity={0.7} />
                </ComposedChart>
              </ResponsiveContainer>
            </Section>
          </>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
        fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center',
      }}>
        Wikipedia · Reddit · Hacker News · 6h cache · descriptive stats only, no trading advice
      </div>
    </div>
  )
}

// ── Section wrapper ───────────────────────────────────────────────────────────
interface Tile { label: string; value: string; hint?: string; color?: string }

function Section({
  title, subtitle, error, hasData, read, tiles, children, footer,
}: {
  title:    string
  subtitle?: string
  error?:   string
  hasData:  boolean
  read?:    { text: string; tone: 'pos' | 'neg' | 'neu' } | null
  tiles?:   Tile[]
  children: React.ReactNode
  footer?:  React.ReactNode
}) {
  if (!hasData) {
    return (
      <div style={{ marginBottom: '14px' }}>
        <SectionTitle title={title} subtitle={subtitle} />
        <div style={{
          minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(255,255,255,0.015)',
          border: '1px dashed var(--border)', borderRadius: '4px',
          color: 'var(--text-muted)', fontSize: '11px', padding: '12px',
        }}>
          Data unavailable{error ? ` — ${error}` : ''}
        </div>
      </div>
    )
  }

  const toneColor = read?.tone === 'pos' ? 'var(--positive)'
                  : read?.tone === 'neg' ? 'var(--negative)'
                  : 'var(--text-2)'

  return (
    <div style={{ marginBottom: '14px' }}>
      <SectionTitle title={title} subtitle={subtitle} />

      {/* Signal read */}
      {read && (
        <div style={{
          padding: '6px 10px', marginBottom: '6px', borderRadius: '4px',
          background: 'rgba(255,255,255,0.025)',
          borderLeft: `3px solid ${toneColor}`,
          fontSize: '11px', color: 'var(--text-2)', lineHeight: 1.4,
        }}>
          {read.text}
        </div>
      )}

      {/* Stat tiles */}
      {tiles && tiles.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))`,
          gap: '4px', marginBottom: '6px',
        }}>
          {tiles.map(t => (
            <div key={t.label} style={{
              padding: '5px 7px', borderRadius: '3px',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.08em' }}>{t.label}</div>
              <div style={{
                fontSize: '12px', fontWeight: 700, marginTop: '1px',
                color: t.color ?? '#fff', fontFamily: 'JetBrains Mono, monospace',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {t.value}
              </div>
              {t.hint && (
                <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '1px' }}>
                  {t.hint}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {children}

      {footer && <div style={{ marginTop: '4px' }}>{footer}</div>}
    </div>
  )
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{
      fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.1em',
      marginBottom: '4px', fontFamily: 'JetBrains Mono, monospace',
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
    }}>
      <span>{title}</span>
      {subtitle && <span style={{ fontSize: '9px', textTransform: 'none', letterSpacing: 0 }}>{subtitle}</span>}
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function trendIcon(dir: 'up' | 'down' | 'flat'): string {
  if (dir === 'up')   return '↑ rising'
  if (dir === 'down') return '↓ falling'
  return '→ flat'
}

function avgRecentSentiment(sentiment: number[], windowDays: number): number {
  const recent = sentiment.slice(-windowDays).filter(v => v !== 0)
  if (recent.length === 0) return 0
  return recent.reduce((a, b) => a + b, 0) / recent.length
}
