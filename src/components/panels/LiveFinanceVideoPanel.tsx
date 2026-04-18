'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

type Region = 'ALL' | 'US' | 'IN'

interface StreamResult {
  channelId:   string
  channelName: string
  shortName:   string
  region:      string
  accent:      string
  videoId:     string
  embedUrl:    string
  watchUrl:    string
  description: string
  isVerified:  boolean
  isLive:      boolean
  title:       string
  status:      'live' | 'fallback' | 'unverified'
}

interface APIResponse {
  channels:  StreamResult[]
  hasApiKey: boolean
  fetchedAt: string
  liveCount: number
}

const REGION_FILTERS: { key: Region; label: string }[] = [
  { key: 'ALL', label: 'ALL' },
  { key: 'US',  label: '🇺🇸 US' },
  { key: 'IN',  label: '🇮🇳 INDIA' },
]

export default function LiveFinanceVideoPanel() {
  const [streams,      setStreams]      = useState<StreamResult[]>([])
  const [loading,      setLoading]      = useState(true)
  const [region,       setRegion]       = useState<Region>('ALL')
  const [active,       setActive]       = useState<StreamResult | null>(null)
  const [liveCount,    setLiveCount]    = useState(0)
  const [embedFailed,  setEmbedFailed]  = useState(false)
  const [useFallback,  setUseFallback]  = useState(false)
  const [lastRefresh,  setLastRefresh]  = useState<string>('')
  const retryCountRef = useRef(0)

  const fetchStreams = useCallback(async (r: Region) => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/youtube-live?region=${r}`)
      const data = await res.json() as APIResponse
      const channels = data.channels ?? []
      setStreams(channels)
      setLiveCount(data.liveCount ?? 0)
      setLastRefresh(new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' }))

      setActive(prev => {
        if (prev) {
          const same = channels.find(c => c.channelId === prev.channelId)
          return same ?? channels[0] ?? null
        }
        // Auto-select first verified/live channel
        return channels.find(c => c.isVerified) ?? channels[0] ?? null
      })
    } catch {
      setStreams([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStreams(region)
    const id = setInterval(() => fetchStreams(region), 5 * 60_000)
    return () => clearInterval(id)
  }, [region, fetchStreams])

  // Reset error state when active channel changes
  useEffect(() => {
    setEmbedFailed(false)
    setUseFallback(false)
    retryCountRef.current = 0
  }, [active?.channelId])

  const displayed = region === 'ALL' ? streams : streams.filter(s => s.region === region)

  // Determine which embed URL to actually use
  const embedSrc = (() => {
    if (!active) return ''
    if (embedFailed) return ''  // Both tiers failed
    if (useFallback) {
      // Tier 2: channel live_stream embed
      return `https://www.youtube.com/embed/live_stream?channel=${active.channelId}&autoplay=1&mute=1&rel=0`
    }
    return active.embedUrl  // Tier 1: direct video ID
  })()

  const handleTryFallback = () => {
    if (retryCountRef.current === 0) {
      setUseFallback(true)
      retryCountRef.current = 1
    } else {
      setEmbedFailed(true)
    }
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ justifyContent: 'space-between', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: '#ff4560', flexShrink: 0,
            animation: 'pulseDot 1.5s ease-in-out infinite',
          }} />
          <span style={{ whiteSpace: 'nowrap' }}>LIVE FINANCE TV</span>
          <span style={{
            fontSize: '11px', padding: '2px 8px', borderRadius: '2px',
            background: 'rgba(255,69,96,0.12)', color: '#ff4560',
            border: '1px solid rgba(255,69,96,0.25)',
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            flexShrink: 0,
          }}>
            {loading ? '···' : `${liveCount} LIVE`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
          {REGION_FILTERS.map(f => (
            <button key={f.key} onClick={() => setRegion(f.key)} style={{
              padding: '2px 7px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '11px',
              border: `1px solid ${region === f.key ? '#ff4560' : 'var(--border)'}`,
              background: region === f.key ? 'rgba(255,69,96,0.1)' : 'transparent',
              color: region === f.key ? '#ff4560' : 'var(--text-muted)',
              whiteSpace: 'nowrap',
            }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Channel selector ─────────────────────────────────────────────────── */}
      <div style={{
        display:    'flex',
        overflowX:  'auto',
        gap:        '4px',
        padding:    '6px 8px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        scrollbarWidth: 'none',
        WebkitOverflowScrolling: 'touch',
      }}>
        {loading
          ? <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', padding: '4px' }}>
              Scanning channels...
            </div>
          : displayed.map(stream => {
            const isActive = active?.channelId === stream.channelId
            return (
              <button
                key={stream.channelId}
                onClick={() => setActive(stream)}
                style={{
                  padding:    '5px 10px',
                  borderRadius:'4px',
                  cursor:     'pointer',
                  flexShrink: 0,
                  border:     `1px solid ${isActive ? stream.accent : 'var(--border)'}`,
                  background: isActive ? `${stream.accent}1a` : 'var(--bg-deep)',
                  color:      isActive ? stream.accent : 'var(--text-muted)',
                  display:    'flex',
                  alignItems: 'center',
                  gap:        '5px',
                  transition: 'all 0.15s',
                  minWidth:   0,
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                {/* Status dot */}
                <div style={{
                  width: '5px', height: '5px', borderRadius: '50%', flexShrink: 0,
                  background: stream.isVerified ? '#00c97a' : stream.isLive ? stream.accent : '#4a6070',
                  animation: stream.isLive ? 'pulseDot 2s ease-in-out infinite' : 'none',
                }} />
                <span style={{ fontSize: '10px', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                  {stream.region === 'IN' ? '🇮🇳' : '🇺🇸'} {stream.shortName}
                </span>
              </button>
            )
          })
        }
      </div>

      {/* ── Video player ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#000', overflow: 'hidden' }}>

        {/* Embed iframe */}
        {active && !embedFailed && embedSrc && (
          <iframe
            key={`${active.channelId}-${useFallback ? 'fb' : 'primary'}`}
            src={embedSrc}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        )}

        {/* Error state — both tiers failed */}
        {(embedFailed || (!active && !loading)) && (
          <div style={{
            position:       'absolute', inset: 0,
            display:        'flex', flexDirection: 'column',
            alignItems:     'center', justifyContent: 'center', gap: '16px',
            background:     '#000', padding: '20px',
          }}>
            <div style={{ fontSize: '40px' }}>📺</div>
            <div style={{
              fontSize: '13px', color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace',
              textAlign: 'center', lineHeight: 1.6, maxWidth: '260px',
            }}>
              {active
                ? `${active.channelName} embed is restricted in your region. Watch directly on YouTube — all channels are live 24/7.`
                : 'Select a channel above to start watching.'}
            </div>
            {active && (
              <a
                href={active.watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: '10px 24px', background: 'rgba(255,0,0,0.9)', color: '#fff',
                  borderRadius: '4px', fontSize: '13px',
                  fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                  textDecoration: 'none', letterSpacing: '0.06em',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}
              >
                ▶ WATCH {active.shortName} ON YOUTUBE
              </a>
            )}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '12px',
            background: '#000',
          }}>
            <div style={{
              width: '28px', height: '28px',
              border: '2px solid #222', borderTop: '2px solid #ff4560',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }} />
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              SCANNING LIVE FEEDS...
            </div>
          </div>
        )}

        {/* Channel overlay + controls */}
        {active && !embedFailed && (
          <>
            <div style={{
              position: 'absolute', bottom: '10px', left: '10px',
              background: 'rgba(0,0,0,0.75)', padding: '4px 10px',
              borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px',
              pointerEvents: 'none',
            }}>
              <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#ff4560', animation: 'pulseDot 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: '11px', color: '#fff', fontFamily: 'Syne, sans-serif', fontWeight: 700 }}>
                {active.channelName}
              </span>
              {active.isVerified && (
                <span style={{ fontSize: '11px', color: '#00c97a', fontFamily: 'JetBrains Mono, monospace' }}>✓ LIVE</span>
              )}
            </div>

            <div style={{ position: 'absolute', bottom: '10px', right: '10px', display: 'flex', gap: '5px' }}>
              <button
                onClick={handleTryFallback}
                style={{
                  background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.15)',
                  color: 'var(--text-muted)', padding: '4px 9px', borderRadius: '3px',
                  fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer',
                }}
                title="Reload stream"
              >
                ↺
              </button>
              <a
                href={active.watchUrl} target="_blank" rel="noopener noreferrer"
                style={{
                  background: 'rgba(255,0,0,0.85)', color: '#fff',
                  padding: '4px 9px', borderRadius: '3px',
                  fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                ▶ YT
              </a>
            </div>
          </>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
        fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>8 channels · 24/7 live · tap to switch</span>
        <span style={{ color: 'var(--text-muted)' }}>{lastRefresh ? `updated ${lastRefresh}` : ''}</span>
      </div>

      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}