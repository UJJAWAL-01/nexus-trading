'use client'

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS drawer (spec §2.2): technical-rating gauge + per-TF pills, detected
// pattern cards, and the AI analyst note slot. Pure presentation — all data and
// callbacks are supplied by ChartPanel.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import type {
  DetectAllResult, PatternDetection, TaRating, RatingLabel, Timeframe,
} from '@/lib/patterns'
import type { PatternVisibility } from './patternRender'
import type { AiNote } from './aiNote'

const RATING_META: Record<RatingLabel, { text: string; color: string; angle: number }> = {
  strong_sell: { text: 'Strong Sell', color: '#ff4560', angle: -72 },
  sell:        { text: 'Sell',        color: '#ff8c42', angle: -36 },
  neutral:     { text: 'Neutral',     color: '#a0a0a0', angle: 0 },
  buy:         { text: 'Buy',         color: '#3ddc97', angle: 36 },
  strong_buy:  { text: 'Strong Buy',  color: '#00c97a', angle: 72 },
}

const STATUS_META = {
  forming:   { label: 'FORMING',   color: '#f0a500', bg: 'rgba(240,165,0,0.12)' },
  confirmed: { label: 'CONFIRMED', color: '#00c97a', bg: 'rgba(0,201,122,0.12)' },
  failed:    { label: 'FAILED',    color: '#6b7280', bg: 'rgba(107,114,128,0.12)' },
}

const DIR_COLOR = { bullish: '#00c97a', bearish: '#ff4560', neutral: '#f0a500' }

const TF_PILLS: Timeframe[] = ['15m', '1h', '4h', '1D', '1W']

function Gauge({ rating }: { rating: TaRating }) {
  const meta = RATING_META[rating.overall.label]
  // needle angle from continuous score (−1..1 → −90..90°)
  const angle = Math.max(-88, Math.min(88, rating.overall.score * 90))
  const cx = 90, cy = 84, r = 66
  const arc = (a0: number, a1: number, color: string) => {
    const p = (a: number) => [cx + r * Math.cos((a - 90) * Math.PI / 180), cy + r * Math.sin((a - 90) * Math.PI / 180)]
    const [x0, y0] = p(a0), [x1, y1] = p(a1)
    return <path d={`M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`} stroke={color} strokeWidth={9} fill="none" strokeLinecap="butt" />
  }
  const needle = [cx + (r - 12) * Math.cos((angle - 90) * Math.PI / 180), cy + (r - 12) * Math.sin((angle - 90) * Math.PI / 180)]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={180} height={100} viewBox="0 0 180 100">
        {arc(-90, -54, '#ff4560')}
        {arc(-54, -18, '#ff8c42')}
        {arc(-18, 18, '#a0a0a0')}
        {arc(18, 54, '#3ddc97')}
        {arc(54, 90, '#00c97a')}
        <line x1={cx} y1={cy} x2={needle[0]} y2={needle[1]} stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={4} fill="#fff" />
      </svg>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '17px', color: meta.color, marginTop: '-6px', letterSpacing: '-0.01em' }}>
        {meta.text}
      </div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>
        {rating.movingAvg.buys + rating.oscillators.buys} buy · {rating.movingAvg.sells + rating.oscillators.sells} sell · {rating.movingAvg.neutrals + rating.oscillators.neutrals} neutral
      </div>
    </div>
  )
}

function VotesTable({ rating }: { rating: TaRating }) {
  const row = (label: string, sig: string, val: number | null) => {
    const color = sig === 'buy' ? '#00c97a' : sig === 'sell' ? '#ff4560' : 'var(--text-muted)'
    return (
      <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 8px', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace' }}>
        <span style={{ color: 'var(--text-2)' }}>{label}</span>
        <span style={{ display: 'flex', gap: '8px' }}>
          <span style={{ color: 'var(--text-muted)' }}>{val == null ? '—' : val}</span>
          <span style={{ color, fontWeight: 700, minWidth: '34px', textAlign: 'right' }}>{sig.toUpperCase()}</span>
        </span>
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em', padding: '4px 8px 2px' }}>MOVING AVERAGES</div>
      {rating.movingAvg.votes.map(v => row(v.label, v.signal, v.value))}
      <div style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em', padding: '6px 8px 2px' }}>OSCILLATORS</div>
      {rating.oscillators.votes.map(v => row(v.label, v.signal, v.value))}
    </div>
  )
}

function fmt(n: number | null): string {
  if (n == null) return '—'
  return n >= 1000 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(4)
}

function PatternCard({ d, selected, onClick }: { d: PatternDetection; selected: boolean; onClick: () => void }) {
  const sm = STATUS_META[d.status]
  const qf = (label: string, val: number, plus = false) => (
    <span style={{ fontSize: 8.5, fontFamily: 'JetBrains Mono, monospace', color: val < 0 ? '#ff8c42' : 'var(--text-2)', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 5px' }}>
      {label} {plus && val >= 0 ? '+' : ''}{Math.round(val)}
    </span>
  )
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
      background: selected ? 'rgba(0,229,192,0.06)' : 'var(--bg-deep)',
      border: `1px solid ${selected ? 'var(--teal)' : 'var(--border)'}`,
      borderRadius: '5px', padding: '8px 10px', marginBottom: '6px', transition: 'all 0.12s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: '12px', color: '#fff' }}>{d.name}</span>
        <span style={{
          fontSize: '8.5px', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em',
          color: sm.color, background: sm.bg, padding: '1px 6px', borderRadius: '3px',
          animation: d.status === 'forming' ? 'nexusPulse 1.6s ease-in-out infinite' : undefined,
        }}>{sm.label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
        <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: DIR_COLOR[d.direction], textTransform: 'uppercase', fontWeight: 700 }}>
          {d.direction}
        </span>
        <div style={{ flex: 1, height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{ width: `${d.confidence}%`, height: '100%', background: d.confidence >= 70 ? '#00c97a' : d.confidence >= 55 ? '#f0a500' : '#ff8c42' }} />
        </div>
        <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-2)' }}>{d.confidence}</span>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '5px', fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
        {d.breakoutLevel != null && <span>Brk <b style={{ color: 'var(--text-2)' }}>{fmt(d.breakoutLevel)}</b></span>}
        {d.target != null && <span>Tgt <b style={{ color: '#00c97a' }}>{fmt(d.target)}</b></span>}
        {d.invalidation != null && <span>Inv <b style={{ color: '#ff4560' }}>{fmt(d.invalidation)}</b></span>}
      </div>
      <div style={{ fontSize: '9.5px', color: 'var(--text-2)', marginTop: '5px', lineHeight: 1.4 }}>{d.implication}</div>
      {d.confidenceBreakdown && (
        <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', marginBottom: 3 }}>QUALITY FACTORS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {qf('base', d.confidenceBreakdown.base)}
            {qf('geometry', d.confidenceBreakdown.geometryQuality, true)}
            {qf('volume', d.confidenceBreakdown.volumeConfirm, true)}
            {qf('trend', d.confidenceBreakdown.trendContext, true)}
            {qf('timeframe', d.confidenceBreakdown.timeframeBonus, true)}
            {d.confidenceBreakdown.ageDecay > 0 && qf('age', -d.confidenceBreakdown.ageDecay)}
          </div>
        </div>
      )}
    </button>
  )
}

export interface AnalysisDrawerProps {
  result: DetectAllResult
  symbol: string
  tf: string
  visibility: PatternVisibility
  onVisibility: (v: PatternVisibility) => void
  selectedId: string | null
  onSelectPattern: (d: PatternDetection) => void
  perTfRatings: Partial<Record<Timeframe, TaRating | 'loading'>>
  onLoadTf: (tf: Timeframe) => void
  activeRatingTf: Timeframe
  aiNote: AiNote | null
  aiLoading: boolean
  aiError: string | null
  onGenerateAi: () => void
  onClose: () => void
}

export default function AnalysisDrawer(props: AnalysisDrawerProps) {
  const { result, structureBias } = { result: props.result, structureBias: props.result.structure }
  const [showVotes, setShowVotes] = useState(false)
  const allPatterns = [...result.geometric, ...result.candlestick].sort((a, b) => b.confidence - a.confidence)
  const ratingForTf = props.perTfRatings[props.activeRatingTf]
  const displayRating = ratingForTf && ratingForTf !== 'loading' ? ratingForTf : result.rating

  return (
    <div style={{
      width: '300px', flexShrink: 0, height: '100%', display: 'flex', flexDirection: 'column',
      borderLeft: '1px solid var(--border)', background: 'var(--bg-panel)', overflow: 'hidden',
    }}>
      <style>{`@keyframes nexusPulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '12px', letterSpacing: '0.06em', color: 'var(--teal)' }}>ANALYSIS · {props.symbol}</span>
        <button onClick={props.onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '15px', lineHeight: 1 }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* structure badge */}
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '9px', fontWeight: 800, fontFamily: 'JetBrains Mono, monospace', padding: '2px 7px', borderRadius: '3px',
              color: structureBias.bias === 'uptrend' ? '#00c97a' : structureBias.bias === 'downtrend' ? '#ff4560' : '#a0a0a0',
              background: structureBias.bias === 'uptrend' ? 'rgba(0,201,122,0.12)' : structureBias.bias === 'downtrend' ? 'rgba(255,69,96,0.12)' : 'rgba(160,160,160,0.12)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>{structureBias.bias}</span>
            <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-2)' }}>{structureBias.label}</span>
            {structureBias.lastEvent && (
              <span style={{ fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: structureBias.lastEvent.direction === 'bullish' ? '#00c97a' : '#ff4560' }}>
                {structureBias.lastEvent.type}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '12px', marginTop: '5px', fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-muted)' }}>
            {structureBias.support != null && <span>Support <b style={{ color: '#00c97a' }}>{fmt(structureBias.support)}</b></span>}
            {structureBias.resistance != null && <span>Resist <b style={{ color: '#ff4560' }}>{fmt(structureBias.resistance)}</b></span>}
          </div>
        </div>

        {/* rating gauge */}
        <div style={{ padding: '10px', borderBottom: '1px solid var(--border)' }}>
          <Gauge rating={displayRating} />
          <div style={{ display: 'flex', gap: '3px', justifyContent: 'center', marginTop: '8px' }}>
            {TF_PILLS.map(t => (
              <button key={t} onClick={() => props.onLoadTf(t)} style={{
                padding: '2px 7px', borderRadius: '3px', cursor: 'pointer', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
                border: `1px solid ${props.activeRatingTf === t ? 'var(--teal)' : 'var(--border)'}`,
                background: props.activeRatingTf === t ? 'rgba(0,229,192,0.1)' : 'transparent',
                color: props.perTfRatings[t] === 'loading' ? 'var(--amber)' : props.activeRatingTf === t ? 'var(--teal)' : 'var(--text-2)',
              }}>{props.perTfRatings[t] === 'loading' ? '…' : t}</button>
            ))}
          </div>
          <button onClick={() => setShowVotes(v => !v)} style={{
            width: '100%', marginTop: '8px', padding: '3px', cursor: 'pointer', fontSize: '10px', fontFamily: 'JetBrains Mono, monospace',
            background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: '4px', color: 'var(--text-2)',
          }}>{showVotes ? '▴ Hide' : '▾ Show'} all 22 indicators</button>
          {showVotes && <div style={{ marginTop: '6px' }}><VotesTable rating={displayRating} /></div>}
        </div>

        {/* visibility toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', marginRight: 'auto' }}>OVERLAY</span>
          {(['all', 'confirmed', 'off'] as PatternVisibility[]).map(v => (
            <button key={v} onClick={() => props.onVisibility(v)} style={{
              padding: '2px 7px', borderRadius: '3px', cursor: 'pointer', fontSize: '9.5px', fontFamily: 'JetBrains Mono, monospace', textTransform: 'capitalize',
              border: `1px solid ${props.visibility === v ? 'var(--amber)' : 'var(--border)'}`,
              background: props.visibility === v ? 'rgba(240,165,0,0.1)' : 'transparent',
              color: props.visibility === v ? 'var(--amber)' : 'var(--text-2)',
            }}>{v}</button>
          ))}
        </div>

        {/* pattern list */}
        <div style={{ padding: '8px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace' }}>
              DETECTED PATTERNS · {allPatterns.length}
            </span>
            <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontStyle: 'italic' }}>score = pattern quality</span>
          </div>
          {allPatterns.length === 0 && (
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', padding: '8px 0' }}>
              No qualifying patterns on this timeframe.
            </div>
          )}
          {allPatterns.map(d => (
            <PatternCard key={`${d.id}-${d.startIndex}-${d.endIndex}`} d={d} selected={props.selectedId === d.id} onClick={() => props.onSelectPattern(d)} />
          ))}
        </div>

        {/* AI analyst note */}
        <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <span style={{ fontSize: '9px', color: 'var(--text-muted)', letterSpacing: '0.1em', fontFamily: 'JetBrains Mono, monospace' }}>AI ANALYST NOTE</span>
            <button onClick={props.onGenerateAi} disabled={props.aiLoading} style={{
              padding: '2px 8px', borderRadius: '3px', cursor: props.aiLoading ? 'default' : 'pointer', fontSize: '9.5px', fontFamily: 'JetBrains Mono, monospace',
              border: '1px solid var(--teal)', background: 'rgba(0,229,192,0.08)', color: 'var(--teal)', opacity: props.aiLoading ? 0.6 : 1,
            }}>{props.aiLoading ? 'Analyzing…' : props.aiNote ? 'Refresh' : 'Generate'}</button>
          </div>
          {props.aiError && <div style={{ fontSize: '10px', color: '#ff8c42', fontFamily: 'JetBrains Mono, monospace' }}>{props.aiError}</div>}
          {props.aiNote && <AiNoteView note={props.aiNote} />}
          {!props.aiNote && !props.aiError && (
            <div style={{ fontSize: '9.5px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Generate a senior-analyst narrative grounded in the deterministic detections above.
            </div>
          )}
          <div style={{ fontSize: '8.5px', color: 'var(--text-muted)', marginTop: '8px', fontStyle: 'italic' }}>
            Analysis is informational, not investment advice.
          </div>
        </div>
      </div>
    </div>
  )
}

function AiNoteView({ note }: { note: AiNote }) {
  return (
    <div style={{ fontFamily: 'JetBrains Mono, monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
        <span style={{ fontSize: '11px', fontWeight: 800, fontFamily: 'Syne, sans-serif', color: note.bias === 'bullish' ? '#00c97a' : note.bias === 'bearish' ? '#ff4560' : '#f0a500' }}>
          {note.bias?.toUpperCase()} {note.biasStrength ? `· ${note.biasStrength}` : ''}
        </span>
      </div>
      {note.headline && <div style={{ fontSize: '11px', color: '#fff', fontWeight: 600, marginBottom: '4px', lineHeight: 1.3 }}>{note.headline}</div>}
      {note.narrative && <div style={{ fontSize: '10px', color: 'var(--text-2)', lineHeight: 1.5, marginBottom: '6px' }}>{note.narrative}</div>}
      <div style={{ display: 'grid', gap: '4px' }}>
        {note.bullCase && <div style={{ fontSize: '9.5px', color: '#00c97a' }}>▲ {note.bullCase}</div>}
        {note.bearCase && <div style={{ fontSize: '9.5px', color: '#ff4560' }}>▼ {note.bearCase}</div>}
        {note.keyLevelToWatch && <div style={{ fontSize: '9.5px', color: 'var(--amber)' }}>◆ Watch: {note.keyLevelToWatch}</div>}
        {note.riskNote && <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{note.riskNote}</div>}
      </div>
    </div>
  )
}
