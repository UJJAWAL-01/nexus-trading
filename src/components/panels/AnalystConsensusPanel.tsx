'use client'

// ─── ANALYST CONSENSUS ────────────────────────────────────────────────────────
//
// Aggregated analyst recommendations for the active stock.  Source: Finnhub
// `/stock/recommendation` (free tier, real institutional data — same feed
// Bloomberg and TradingView display).
//
// Each row from the API is one snapshot period (Finnhub publishes a fresh
// snapshot ~monthly) with counts in each rating bucket:
//   { strongBuy, buy, hold, sell, strongSell, period }
//
// Display:
//   • Headline rating + label, computed as a weighted average on a 1-5 scale
//     (1.0 = Strong Buy, 5.0 = Strong Sell — Wall Street convention)
//   • Stacked horizontal bar showing the breakdown
//   • Trend over the last 4 published periods so you see momentum
//
// No hardcoded fallback — if Finnhub doesn't have coverage we say so.

import { useEffect, useMemo, useState } from 'react'
import { useEffectiveSymbol } from '@/store/symbol'
import { ComingSoon } from '@/components/ui/PanelStates'

interface RecommendationPeriod {
  symbol:     string
  period:     string   // YYYY-MM-DD
  strongBuy:  number
  buy:        number
  hold:       number
  sell:       number
  strongSell: number
}

// ── Score → label mapping (1 = best / Strong Buy, 5 = worst / Strong Sell) ───

const RATING_LABELS: { max: number; label: string; color: string; bgWeight: number }[] = [
  { max: 1.5, label: 'STRONG BUY',  color: 'var(--positive)', bgWeight: 0.18 },
  { max: 2.5, label: 'BUY',          color: 'var(--positive)', bgWeight: 0.10 },
  { max: 3.5, label: 'HOLD',         color: 'var(--amber)',    bgWeight: 0.10 },
  { max: 4.5, label: 'SELL',         color: 'var(--negative)', bgWeight: 0.10 },
  { max: 99,  label: 'STRONG SELL',  color: 'var(--negative)', bgWeight: 0.18 },
]

function ratingMeta(score: number | null) {
  if (score == null) return null
  return RATING_LABELS.find(b => score <= b.max) ?? RATING_LABELS[RATING_LABELS.length - 1]
}

function periodTotal(p: RecommendationPeriod): number {
  return p.strongBuy + p.buy + p.hold + p.sell + p.strongSell
}

function periodScore(p: RecommendationPeriod): number | null {
  const t = periodTotal(p)
  if (t === 0) return null
  return (1 * p.strongBuy + 2 * p.buy + 3 * p.hold + 4 * p.sell + 5 * p.strongSell) / t
}

// ── Stacked horizontal bar segment ────────────────────────────────────────────

function BarSegment({ count, total, color, label }: {
  count: number; total: number; color: string; label: string
}) {
  if (count === 0 || total === 0) return null
  const pct = (count / total) * 100
  return (
    <div
      title={`${label}: ${count} analyst${count === 1 ? '' : 's'} (${pct.toFixed(0)}%)`}
      style={{
        width: `${pct}%`, height: '100%',
        background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, color: '#fff', fontWeight: 700,
        fontFamily: 'JetBrains Mono, monospace',
        overflow: 'hidden', whiteSpace: 'nowrap',
        cursor: 'help',
      }}
    >
      {pct >= 8 ? count : ''}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function AnalystConsensusPanel() {
  const { symbol: effSym } = useEffectiveSymbol('analystconsensus')

  const [history, setHistory] = useState<RecommendationPeriod[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const unsupported = useMemo(() => {
    if (!effSym) return null
    if (effSym.endsWith('.NS') || effSym.endsWith('.BO')) return 'india'
    if (effSym.startsWith('^')) return 'index'
    return null
  }, [effSym])

  useEffect(() => {
    if (!effSym || unsupported) {
      setHistory(null); setError(null); setLoading(false); return
    }

    let cancelled = false
    const ctrl = new AbortController()
    setLoading(true); setError(null)

    fetch(`/api/finnhub?endpoint=stock/recommendation&symbol=${encodeURIComponent(effSym)}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() as Promise<RecommendationPeriod[]> : null)
      .then(arr => {
        if (cancelled) return
        if (!Array.isArray(arr) || arr.length === 0) {
          setError(`No analyst coverage data for ${effSym}`)
          setHistory(null); return
        }
        // Finnhub returns latest first — confirm and clip to last 6 periods (~6 months)
        const sorted = [...arr].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 6)
        setHistory(sorted)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Failed to load recommendations')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true; ctrl.abort() }
  }, [effSym, unsupported])

  // Latest period + derived values
  const latest         = history?.[0] ?? null
  const latestTotal    = latest ? periodTotal(latest) : 0
  const latestScore    = latest ? periodScore(latest) : null
  const latestMeta     = ratingMeta(latestScore)

  // Previous period score for the change indicator
  const previousScore  = history?.[1] ? periodScore(history[1]) : null
  const scoreChange    = (latestScore != null && previousScore != null) ? (latestScore - previousScore) : null

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header">
        <span className="dot" style={{ background: 'var(--teal)', boxShadow: '0 0 6px var(--teal)' }} />
        <span>ANALYST CONSENSUS</span>
        {effSym && (
          <span style={{
            marginLeft: 'auto', fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            {effSym}
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {/* No symbol */}
        {!effSym && (
          <div style={{
            textAlign: 'center', padding: '36px 16px',
            color: 'var(--text-muted)',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            lineHeight: 1.7,
          }}>
            <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.4 }}>📊</div>
            Click any ticker anywhere in the app<br/>
            to see analyst consensus here.
          </div>
        )}

        {effSym && unsupported === 'india' && (
          <ComingSoon
            feature="India analyst coverage"
            detail="Analyst recommendations currently cover US-listed equities. NSE/BSE coverage is on the roadmap."
          />
        )}

        {effSym && unsupported === 'index' && (
          <div style={{
            textAlign: 'center', padding: '36px 16px',
            color: 'var(--text-muted)',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            lineHeight: 1.7,
          }}>
            <div style={{ color: 'var(--amber)', marginBottom: 8 }}>INDEX</div>
            <code style={{ color: '#fff', fontSize: 12 }}>{effSym}</code><br/>
            <span style={{ fontSize: 10, marginTop: 8, display: 'inline-block' }}>
              Analyst recommendations apply to individual equities, not indices.
            </span>
          </div>
        )}

        {effSym && !unsupported && loading && !history && (
          <div style={{
            textAlign: 'center', padding: '36px 16px',
            color: 'var(--text-muted)',
            fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
          }}>
            Loading <b style={{ color: '#fff' }}>{effSym}</b> analyst data…
          </div>
        )}

        {effSym && !unsupported && !loading && error && (
          <div style={{
            textAlign: 'center', padding: '24px 16px',
            color: 'var(--negative)', fontSize: 11,
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            ⚠ {error}
          </div>
        )}

        {history && latest && latestMeta && (
          <>
            {/* Headline rating ──────────────────────────────────────────────── */}
            <div style={{
              background: latestMeta.color.startsWith('var')
                ? `rgba(${latestMeta.color === 'var(--positive)' ? '0,201,122' :
                          latestMeta.color === 'var(--negative)' ? '255,69,96' :
                          '240,165,0'}, ${latestMeta.bgWeight})`
                : latestMeta.color,
              border: `1px solid ${latestMeta.color}`,
              borderRadius: 6, padding: '14px 16px', marginBottom: 14,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <div>
                <div style={{
                  fontSize: 9, color: 'var(--text-muted)',
                  fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.1em',
                  marginBottom: 4,
                }}>
                  CONSENSUS · {latest.period}
                </div>
                <div style={{
                  fontFamily: 'Syne, sans-serif', fontWeight: 800,
                  fontSize: 22, color: latestMeta.color, lineHeight: 1,
                  letterSpacing: '0.02em',
                }}>
                  {latestMeta.label}
                </div>
                <div style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  fontFamily: 'JetBrains Mono, monospace', marginTop: 6,
                }}>
                  {latestTotal} analyst{latestTotal === 1 ? '' : 's'} covering
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 28, fontWeight: 800, color: latestMeta.color,
                  lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                }}>
                  {latestScore?.toFixed(2) ?? '—'}
                </div>
                <div style={{
                  fontSize: 9, color: 'var(--text-muted)',
                  fontFamily: 'JetBrains Mono, monospace',
                  marginTop: 4, letterSpacing: '0.08em',
                }}>
                  / 5.0 SCALE
                </div>
                {scoreChange != null && Math.abs(scoreChange) >= 0.01 && (
                  <div style={{
                    fontSize: 10,
                    color: scoreChange < 0 ? 'var(--positive)' : 'var(--negative)',
                    fontFamily: 'JetBrains Mono, monospace', marginTop: 4,
                  }}>
                    {scoreChange < 0 ? '▲' : '▼'} {Math.abs(scoreChange).toFixed(2)} from prior period
                  </div>
                )}
              </div>
            </div>

            {/* Stacked breakdown bar ──────────────────────────────────────────── */}
            <div style={{ marginBottom: 14 }}>
              <div style={{
                fontSize: 9, color: 'var(--text-muted)',
                fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em',
                marginBottom: 6,
              }}>
                BREAKDOWN · {latest.period}
              </div>
              <div style={{
                display: 'flex',
                height: 22,
                borderRadius: 3,
                overflow: 'hidden',
                background: 'var(--bg-deep)',
                border: '1px solid var(--border)',
              }}>
                <BarSegment count={latest.strongBuy}  total={latestTotal} color="#00c97a" label="Strong Buy" />
                <BarSegment count={latest.buy}        total={latestTotal} color="rgba(0,201,122,0.55)" label="Buy" />
                <BarSegment count={latest.hold}       total={latestTotal} color="rgba(240,165,0,0.65)"  label="Hold" />
                <BarSegment count={latest.sell}       total={latestTotal} color="rgba(255,69,96,0.55)"  label="Sell" />
                <BarSegment count={latest.strongSell} total={latestTotal} color="#ff4560" label="Strong Sell" />
              </div>

              {/* Legend numbers */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: 4,
                marginTop: 6,
                fontSize: 10,
                fontFamily: 'JetBrains Mono, monospace',
                textAlign: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}>
                <div><div style={{ color: 'var(--positive)' }}>{latest.strongBuy}</div><div style={{ color: 'var(--text-muted)', fontSize: 8, marginTop: 2 }}>STR BUY</div></div>
                <div><div style={{ color: 'rgba(0,201,122,0.85)' }}>{latest.buy}</div><div style={{ color: 'var(--text-muted)', fontSize: 8, marginTop: 2 }}>BUY</div></div>
                <div><div style={{ color: 'var(--amber)' }}>{latest.hold}</div><div style={{ color: 'var(--text-muted)', fontSize: 8, marginTop: 2 }}>HOLD</div></div>
                <div><div style={{ color: 'rgba(255,69,96,0.85)' }}>{latest.sell}</div><div style={{ color: 'var(--text-muted)', fontSize: 8, marginTop: 2 }}>SELL</div></div>
                <div><div style={{ color: 'var(--negative)' }}>{latest.strongSell}</div><div style={{ color: 'var(--text-muted)', fontSize: 8, marginTop: 2 }}>STR SELL</div></div>
              </div>
            </div>

            {/* Trend over past periods ──────────────────────────────────────── */}
            {history.length > 1 && (
              <div>
                <div style={{
                  fontSize: 9, color: 'var(--text-muted)',
                  fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em',
                  marginBottom: 6,
                }}>
                  TREND · LAST {history.length} PERIODS
                </div>
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: `60px repeat(${history.length}, 1fr)`,
                  rowGap: 4, columnGap: 4,
                  fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {/* Header */}
                  <div style={{ color: 'var(--text-muted)' }}></div>
                  {history.map((p) => (
                    <div key={p.period} style={{
                      color: 'var(--text-muted)', textAlign: 'center',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {p.period.slice(2, 7).replace('-', '/')}
                    </div>
                  ))}

                  {/* Score row */}
                  <div style={{ color: 'var(--text-muted)' }}>SCORE</div>
                  {history.map(p => {
                    const s = periodScore(p)
                    const m = ratingMeta(s)
                    return (
                      <div key={p.period + '-score'} style={{
                        textAlign: 'center', color: m?.color ?? 'var(--text-muted)',
                        fontWeight: 700,
                      }}>
                        {s?.toFixed(2) ?? '—'}
                      </div>
                    )
                  })}

                  {/* Total analysts row */}
                  <div style={{ color: 'var(--text-muted)' }}>ANALYSTS</div>
                  {history.map(p => (
                    <div key={p.period + '-total'} style={{
                      textAlign: 'center', color: 'var(--text-2)',
                    }}>
                      {periodTotal(p)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer note */}
            <div style={{
              marginTop: 14,
              paddingTop: 8,
              borderTop: '1px solid var(--border)',
              fontSize: 9, color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.5,
            }}>
              Aggregated buy/sell/hold counts from analyst firms. Source: Finnhub.
              Score 1.0 = Strong Buy, 5.0 = Strong Sell.
            </div>
          </>
        )}
      </div>
    </div>
  )
}
