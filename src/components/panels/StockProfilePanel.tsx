'use client'

// ─── STOCK PROFILE ────────────────────────────────────────────────────────────
//
// Per-stock identity + key statistics card.  Driven by the global active
// symbol — clicking any ticker anywhere refocuses this panel on it.
//
// Data sources (all live, no hardcoded fallbacks):
//   • Finnhub /stock/profile2  → name, sector, country, market cap, logo, IPO, website
//   • Finnhub /stock/metric    → P/E, beta, 52w high/low, EPS, margins, ROE, growth
//   • Finnhub /quote           → current price + day change (for the range marker)
//
// India tickers (.NS / .BO) and indices (^*) are not covered by Finnhub's free
// tier; the panel shows an explicit "not available" message for them rather
// than a misleading half-loaded card.

import { usePanelGuide } from '@/components/ui/Motion'
import { useEffect, useMemo, useState } from 'react'
import { useEffectiveSymbol } from '@/store/symbol'
import { ComingSoon } from '@/components/ui/PanelStates'
import { buildKeylessProfile, type ProfileSource } from '@/lib/keyless-profile'
import { loadCloses } from '@/lib/closes'
import { commonDates, returnsOn } from '@/lib/risk'

// With no data key configured (the default), the profile is built in the
// browser from SEC annual filings and a year of price history.
async function loadKeyless(symbol: string, signal: AbortSignal): Promise<{ profile: Profile; metric: NonNullable<MetricsBag['metric']>; fiscalYear: number | null; price: number | null } | null> {
  const [fund, q, rows] = await Promise.all([
    fetch(`/api/fundamentals?ticker=${encodeURIComponent(symbol)}`, { signal }).then(r => (r.ok ? (r.json() as Promise<ProfileSource>) : null)).catch(() => null),
    fetch(`/api/yquote?symbol=${encodeURIComponent(symbol)}`, { signal }).then(r => (r.ok ? (r.json() as Promise<{ price?: number | null }>) : null)).catch(() => null),
    loadCloses([symbol, 'SPY'], '1y').catch(() => ({} as Awaited<ReturnType<typeof loadCloses>>)),
  ])
  const own = new Map(rows[symbol] ?? []), bench = new Map(rows.SPY ?? [])
  const dates = commonDates([own, bench])
  const price = typeof q?.price === 'number' ? q.price : null
  const built = buildKeylessProfile(fund, {
    price, closes: (rows[symbol] ?? []).map(r => r[1]),
    returns: returnsOn(own, dates), benchmark: returnsOn(bench, dates),
  })
  return built ? { ...built, price } : null
}

interface Profile {
  name?: string
  ticker?: string
  logo?: string
  exchange?: string
  finnhubIndustry?: string
  country?: string
  currency?: string
  marketCapitalization?: number      // in millions of currency units
  shareOutstanding?: number          // in millions
  weburl?: string
  ipo?: string
}

interface MetricsBag {
  metric?: {
    peTTM?: number
    beta?: number
    '52WeekHigh'?: number
    '52WeekLow'?: number
    epsTTM?: number
    dividendYieldIndicatedAnnual?: number   // already a percent
    roeTTM?: number                          // already a percent
    revenueGrowthTTMYoy?: number             // already a percent
    grossMarginTTM?: number                  // already a percent
    operatingMarginTTM?: number              // already a percent
    netProfitMarginTTM?: number              // already a percent
    priceToBookTTM?: number
    psTTM?: number
    currentRatioAnnual?: number
    'totalDebt/totalEquityAnnual'?: number
  }
}

interface Quote { c?: number; d?: number; dp?: number }

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtCap(millions: number | undefined): string {
  if (millions == null || !isFinite(millions) || millions <= 0) return '—'
  if (millions >= 1e6) return `$${(millions / 1e6).toFixed(2)}T`
  if (millions >= 1e3) return `$${(millions / 1e3).toFixed(2)}B`
  return `$${millions.toFixed(0)}M`
}

function fmtPct(v: number | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

function fmtNum(v: number | undefined, digits = 2): string {
  if (v == null || !isFinite(v)) return '—'
  return v.toFixed(digits)
}

function fmtPrice(v: number | undefined): string {
  if (v == null || !isFinite(v)) return '—'
  return `$${v.toFixed(2)}`
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: 'var(--bg-deep)',
      padding: '8px 10px',
      borderRadius: 4,
      border: '1px solid var(--border)',
    }}>
      <div style={{
        fontSize: 9, color: 'var(--text-muted)',
        fontFamily: 'var(--font-data)', letterSpacing: '0.08em',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 13, color: color ?? '#fff',
        fontFamily: 'var(--font-data)', fontWeight: 700,
        marginTop: 2, fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function StockProfilePanel() {
  const { symbol: effSym } = useEffectiveSymbol('stockprofile')

  const [profile, setProfile] = useState<Profile | null>(null)
  const [metrics, setMetrics] = useState<MetricsBag['metric'] | null>(null)
  const [quote,   setQuote]   = useState<Quote | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  // null = live provider (trailing twelve months); a number = SEC fiscal year.
  const [fiscalYear, setFiscalYear] = useState<number | null>(null)
  const [keyless, setKeyless] = useState(false)

  // Detect uncovered symbol shapes early — explicit messaging beats half-loaded UI
  const unsupported = useMemo(() => {
    if (!effSym) return null
    if (effSym.endsWith('.NS') || effSym.endsWith('.BO')) return 'india'
    if (effSym.startsWith('^')) return 'index'
    return null
  }, [effSym])

  useEffect(() => {
    if (!effSym || unsupported) {
      setProfile(null); setMetrics(null); setQuote(null); setError(null); setLoading(false)
      return
    }

    let cancelled = false
    const ctrl = new AbortController()
    setLoading(true); setError(null)

    Promise.all([
      fetch(`/api/finnhub?endpoint=stock/profile2&symbol=${encodeURIComponent(effSym)}`, { signal: ctrl.signal })
        .then(r => r.ok ? r.json() as Promise<Profile> : null),
      fetch(`/api/finnhub?endpoint=stock/metric&symbol=${encodeURIComponent(effSym)}&metric=all`, { signal: ctrl.signal })
        .then(r => r.ok ? r.json() as Promise<MetricsBag> : null),
      fetch(`/api/finnhub?endpoint=quote&symbol=${encodeURIComponent(effSym)}`, { signal: ctrl.signal })
        .then(r => r.ok ? r.json() as Promise<Quote> : null),
    ])
      .then(async ([p, m, q]) => {
        if (cancelled) return
        if (!p || !p.name) {
          const k = await loadKeyless(effSym, ctrl.signal)
          if (cancelled) return
          if (!k) {
            setError(`No SEC filings found for ${effSym}. Profiles cover companies that file annual reports with the US SEC.`)
            setProfile(null); setMetrics(null); setQuote(null)
            return
          }
          setProfile(k.profile); setMetrics(k.metric); setKeyless(true); setFiscalYear(k.fiscalYear)
          setQuote(q && q.c ? q : { c: k.price ?? undefined })
          return
        }
        setKeyless(false); setFiscalYear(null)
        setProfile(p)
        setMetrics(m?.metric ?? null)
        setQuote(q)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Failed to load profile')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true; ctrl.abort() }
  }, [effSym, unsupported])

  const basis = keyless ? 'FY' : 'TTM'

  // 52-week range marker position (0 → low end, 100 → high end)
  const rangePos = useMemo(() => {
    const lo = metrics?.['52WeekLow']
    const hi = metrics?.['52WeekHigh']
    const px = quote?.c
    if (lo == null || hi == null || px == null || hi <= lo) return null
    return Math.max(0, Math.min(100, ((px - lo) / (hi - lo)) * 100))
  }, [metrics, quote])

  const guide = usePanelGuide({
    title: "Reading a stock profile",
    next: [{ label: "EQUITY RESEARCH", panelId: "equityresearch" }, { label: "SEASONALITY", panelId: "seasonality" }],
    children: <>A one-page summary of the company. Market cap is what the whole company is worth at today&apos;s price. P/E is the share price divided by a year of earnings per share: a higher number means investors pay more for each unit of profit, usually because they expect growth. Margins show how much of each unit of sales is kept as profit.</>,
  })

  return (
    <div className="panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="panel-header">
        <span className="dot" style={{ background: '#00e5c0', boxShadow: '0 0 6px #00e5c0' }} />
        <span>STOCK PROFILE</span>
        {effSym && (
          <span style={{
            marginLeft: 'auto', fontSize: 10,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-data)',
          }}>
            {effSym}
          </span>
        )}
        <span style={{ marginLeft: 8, display: 'inline-flex' }}>{guide.button}</span>
      </div>
      {guide.body}

      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {/* No symbol */}
        {!effSym && (
          <div style={{
            textAlign: 'center', padding: '36px 16px',
            color: 'var(--text-muted)',
            fontSize: 11, fontFamily: 'var(--font-data)',
            lineHeight: 1.7,
          }}>
            
            Click any ticker anywhere in the app<br/>
            to see its profile here.
          </div>
        )}

        {/* India — coverage coming soon */}
        {effSym && unsupported === 'india' && (
          <ComingSoon
            feature="India company profiles"
            detail="Company profiles currently cover US-listed securities. NSE/BSE profiles are being added."
          />
        )}

        {/* Index — not applicable */}
        {effSym && unsupported === 'index' && (
          <div style={{
            textAlign: 'center', padding: '36px 16px',
            color: 'var(--text-muted)',
            fontSize: 11, fontFamily: 'var(--font-data)',
            lineHeight: 1.7,
          }}>
            <div style={{ color: 'var(--amber)', marginBottom: 8 }}>INDEX</div>
            <code style={{ color: '#fff', fontSize: 12 }}>{effSym}</code><br/>
            <span style={{ fontSize: 10, marginTop: 8, display: 'inline-block' }}>
              Indices don&apos;t have company-level fundamentals.
            </span>
          </div>
        )}

        {/* Loading */}
        {effSym && !unsupported && loading && !profile && (
          <div style={{
            textAlign: 'center', padding: '36px 16px',
            color: 'var(--text-muted)',
            fontSize: 11, fontFamily: 'var(--font-data)',
          }}>
            Loading <b style={{ color: '#fff' }}>{effSym}</b> profile…
          </div>
        )}

        {/* Error */}
        {effSym && !unsupported && !loading && error && (
          <div style={{
            textAlign: 'center', padding: '24px 16px',
            color: 'var(--negative)', fontSize: 11,
            fontFamily: 'var(--font-data)',
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Profile */}
        {profile && (
          <>
            {/* Identity row */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
              {profile.logo && (
                <img
                  src={profile.logo} alt={`${profile.name} logo`}
                  width={48} height={48}
                  style={{ borderRadius: 6, background: '#fff', objectFit: 'contain', flexShrink: 0 }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-ui)', fontWeight: 800,
                  fontSize: 16, color: '#fff', lineHeight: 1.2,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {profile.name}
                </div>
                <div style={{
                  fontSize: 10, color: 'var(--text-muted)',
                  fontFamily: 'var(--font-data)', marginTop: 3,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {profile.ticker} · {profile.exchange?.split(' ')[0] ?? '—'}
                  {profile.finnhubIndustry && ` · ${profile.finnhubIndustry}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{
                  fontFamily: 'var(--font-data)',
                  fontSize: 14, fontWeight: 700, color: '#fff',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmtPrice(quote?.c)}
                </div>
                <div style={{
                  fontFamily: 'var(--font-data)', fontSize: 10,
                  color: (quote?.dp ?? 0) >= 0 ? 'var(--positive)' : 'var(--negative)',
                  marginTop: 2, fontVariantNumeric: 'tabular-nums',
                }}>
                  {fmtPct(quote?.dp)}
                </div>
              </div>
            </div>

            {/* 52-week range */}
            {rangePos !== null && metrics?.['52WeekLow'] && metrics?.['52WeekHigh'] && (
              <div style={{ marginBottom: 14 }}>
                <div style={{
                  fontSize: 9, color: 'var(--text-muted)',
                  fontFamily: 'var(--font-data)', letterSpacing: '0.08em',
                  marginBottom: 6,
                }}>
                  52W RANGE
                </div>
                <div style={{
                  position: 'relative', height: 6,
                  background: 'linear-gradient(90deg, rgba(255,69,96,0.25), rgba(0,229,192,0.25), rgba(0,201,122,0.25))',
                  borderRadius: 3,
                }}>
                  <div style={{
                    position: 'absolute',
                    left: `${rangePos}%`, top: -4,
                    width: 2, height: 14,
                    background: 'var(--amber)',
                    boxShadow: '0 0 6px var(--amber)',
                    transform: 'translateX(-50%)',
                  }} />
                </div>
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  marginTop: 4, fontSize: 9,
                  fontFamily: 'var(--font-data)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  <span style={{ color: 'var(--negative)' }}>${metrics['52WeekLow']!.toFixed(2)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{rangePos.toFixed(0)}%</span>
                  <span style={{ color: 'var(--positive)' }}>${metrics['52WeekHigh']!.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Stats grid — auto-fit so it adapts to panel width */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
              gap: 8, marginBottom: 14,
            }}>
              <Stat label="MARKET CAP" value={fmtCap(profile.marketCapitalization)} />
              <Stat label={`P/E (${basis})`}  value={fmtNum(metrics?.peTTM)} />
              <Stat label="BETA"       value={fmtNum(metrics?.beta)} />
              <Stat label={`EPS (${basis})`}  value={metrics?.epsTTM != null ? `$${metrics.epsTTM.toFixed(2)}` : '—'} />
              <Stat label="DIV YIELD"  value={metrics?.dividendYieldIndicatedAnnual != null ? `${metrics.dividendYieldIndicatedAnnual.toFixed(2)}%` : '—'} />
              <Stat label="P/B"        value={fmtNum(metrics?.priceToBookTTM)} />
              <Stat label={`ROE (${basis})`}
                    value={metrics?.roeTTM != null ? `${metrics.roeTTM.toFixed(1)}%` : '—'}
                    color={metrics?.roeTTM != null ? (metrics.roeTTM >= 0 ? 'var(--positive)' : 'var(--negative)') : undefined} />
              <Stat label="REV GROWTH"
                    value={fmtPct(metrics?.revenueGrowthTTMYoy)}
                    color={metrics?.revenueGrowthTTMYoy != null ? (metrics.revenueGrowthTTMYoy >= 0 ? 'var(--positive)' : 'var(--negative)') : undefined} />
              <Stat label="GROSS MARGIN" value={metrics?.grossMarginTTM != null ? `${metrics.grossMarginTTM.toFixed(1)}%` : '—'} />
              <Stat label="OP MARGIN"    value={metrics?.operatingMarginTTM != null ? `${metrics.operatingMarginTTM.toFixed(1)}%` : '—'} />
              <Stat label="NET MARGIN"   value={metrics?.netProfitMarginTTM != null ? `${metrics.netProfitMarginTTM.toFixed(1)}%` : '—'} />
              <Stat label="DEBT/EQUITY"  value={fmtNum(metrics?.['totalDebt/totalEquityAnnual'])} />
            </div>

            {keyless && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-data)', marginBottom: 10, lineHeight: 1.5 }}>
                Source: SEC annual filings{fiscalYear ? ` (fiscal ${fiscalYear})` : ''} and one year of price history. Ratios use the latest fiscal year, not the trailing twelve months. Market cap is the last reported share count × current price.
              </div>
            )}

            {/* Meta footer */}
            <div style={{
              fontSize: 10, color: 'var(--text-muted)',
              fontFamily: 'var(--font-data)',
              borderTop: '1px solid var(--border)',
              paddingTop: 10, lineHeight: 1.8,
            }}>
              <div>
                COUNTRY: <span style={{ color: 'var(--text-2)' }}>{profile.country ?? '—'}</span>
                {profile.currency && <> · CURRENCY: <span style={{ color: 'var(--text-2)' }}>{profile.currency}</span></>}
              </div>
              {profile.shareOutstanding && (
                <div>
                  SHARES OUT: <span style={{ color: 'var(--text-2)' }}>{(profile.shareOutstanding / 1000).toFixed(2)}B</span>
                  {profile.ipo && <> · IPO: <span style={{ color: 'var(--text-2)' }}>{profile.ipo}</span></>}
                </div>
              )}
              {profile.weburl && (
                <div>
                  WEB:{' '}
                  <a
                    href={profile.weburl}
                    target="_blank" rel="noreferrer noopener"
                    style={{ color: 'var(--teal)', textDecoration: 'none' }}
                  >
                    {profile.weburl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
