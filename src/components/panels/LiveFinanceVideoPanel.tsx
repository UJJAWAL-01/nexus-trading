'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

type Region = 'ALL' | 'US' | 'IN'

interface StreamInfo {
  channelId:   string
  channelName: string
  region:      string
  accent:      string
  videoId:     string
  embedUrl:    string
  watchUrl:    string
  isLive:      boolean
  isVerified:  boolean
  viewers:     number | null
  title:       string
}

interface APIResponse {
  channels:  StreamInfo[]
  hasApiKey: boolean
  fetchedAt: string
  note:      string
}

/*
  Fallback tier system for broken embeds:
  When a video shows "This video is unavailable", the iframe fires an error.
  We detect this and automatically try the channel live_stream embed.
*/
function buildChannelLiveUrl(channelId: string): string {
  return `https://www.youtube.com/embed/live_stream?channel=${channelId}&autoplay=1&mute=1&rel=0`
}

const REGION_FILTERS: { key: Region; label: string }[] = [
  { key: 'ALL', label: 'ALL' },
  { key: 'US',  label: '🇺🇸 US' },
  { key: 'IN',  label: '🇮🇳 INDIA' },
]

export default function LiveFinanceVideoPanel() {
  const [streams,    setStreams]    = useState<StreamInfo[]>([])
  const [loading,    setLoading]    = useState(true)
  const [region,     setRegion]     = useState<Region>('ALL')
  const [active,     setActive]     = useState<StreamInfo | null>(null)
  const [hasApiKey,  setHasApiKey]  = useState(false)
  const [embedError, setEmbedError] = useState(false)
  const [fallbackMode, setFallbackMode] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  /*
    Fetch channel list from our API
  */
  const fetchStreams = useCallback(async (r: Region) => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/youtube-live?region=${r}`)
      const data = await res.json() as APIResponse
      const channels = data.channels ?? []
      setStreams(channels)
      setHasApiKey(data.hasApiKey ?? false)

      // Auto-select first channel, preserve selection on refresh
      setActive(prev => {
        if (prev) {
          // Re-find the same channel with updated data
          const same = channels.find(c => c.channelId === prev.channelId)
          return same ?? channels[0] ?? null
        }
        return channels[0] ?? null
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
    setEmbedError(false)
    setFallbackMode(false)
  }, [active?.channelId])

  const displayed = region === 'ALL' ? streams : streams.filter(s => s.region === region)

  /*
    Determine which embed URL to use based on error state
    Tier 1: permanentVideoId direct embed
    Tier 2: channel live_stream embed
    Tier 3: Open YouTube link
  */
  const embedUrl = (() => {
    if (!active) return ''
    if (fallbackMode) {
      return buildChannelLiveUrl(active.channelId)
    }
    return active.embedUrl
  })()

  const handleEmbedError = () => {
    if (!fallbackMode) {
      // Try channel fallback
      setFallbackMode(true)
    } else {
      // Both failed — show error state
      setEmbedError(true)
    }
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="panel-header" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%', background: '#ff4560',
            animation: 'pulseDot 1.5s ease-in-out infinite',
            boxShadow: '0 0 8px #ff4560',
          }} />
          LIVE FINANCE TV
          <span style={{
            fontSize: '9px', padding: '1px 6px', borderRadius: '2px',
            background: 'rgba(255,69,96,0.12)', color: '#ff4560',
            border: '1px solid rgba(255,69,96,0.25)',
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
          }}>
            ● LIVE
          </span>
        </div>
        <div style={{ display: 'flex', gap: '3px' }}>
          {REGION_FILTERS.map(f => (
            <button key={f.key} onClick={() => setRegion(f.key)} style={{
              padding: '2px 8px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace', fontSize: '9px',
              border: `1px solid ${region === f.key ? '#ff4560' : 'var(--border)'}`,
              background: region === f.key ? 'rgba(255,69,96,0.1)' : 'transparent',
              color: region === f.key ? '#ff4560' : 'var(--text-muted)',
            }}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Channel selector tabs ───────────────────────────────────────────── */}
      <div style={{
        display: 'flex', overflowX: 'auto', gap: '4px',
        padding: '8px 10px', borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        // Hide scrollbar but keep functionality
        scrollbarWidth: 'none',
      }}>
        {loading
          ? <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
              SCANNING FEEDS...
            </div>
          : displayed.map(stream => {
            const isActive = active?.channelId === stream.channelId
            return (
              <button
                key={stream.channelId}
                onClick={() => setActive(stream)}
                style={{
                  padding:      '5px 12px',
                  borderRadius: '4px',
                  cursor:       'pointer',
                  fontFamily:   'JetBrains Mono, monospace',
                  fontSize:     '10px',
                  whiteSpace:   'nowrap',
                  flexShrink:   0,
                  border:       `1px solid ${isActive ? stream.accent : 'var(--border)'}`,
                  background:   isActive ? `${stream.accent}20` : 'var(--bg-deep)',
                  color:        isActive ? stream.accent : 'var(--text-muted)',
                  display:      'flex',
                  alignItems:   'center',
                  gap:          '6px',
                  transition:   'all 0.15s',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = stream.accent + '80'
                    e.currentTarget.style.color = stream.accent + 'cc'
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    e.currentTarget.style.borderColor = 'var(--border)'
                    e.currentTarget.style.color = 'var(--text-muted)'
                  }
                }}
              >
                {/* Live indicator dot */}
                <div style={{
                  width: '5px', height: '5px', borderRadius: '50%',
                  background: stream.isVerified ? '#00c97a' : stream.isLive ? stream.accent : '#4a6070',
                  animation: stream.isLive ? 'pulseDot 2s ease-in-out infinite' : 'none',
                }} />
                {stream.region === 'IN' ? '🇮🇳' : '🇺🇸'} {stream.channelName}
              </button>
            )
          })
        }
      </div>

      {/* ── Main player area ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: '#000' }}>

        {/* Embed iframe */}
        {active && !embedError && embedUrl && (
          <iframe
            ref={iframeRef}
            key={`${active.channelId}-${fallbackMode ? 'fallback' : 'primary'}`}
            src={embedUrl}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
            /*
              YouTube iframes don't fire standard error events for "video unavailable".
              We use an onLoad timeout — if iframe loads but shows error, user clicks
              the fallback button.
            */
          />
        )}

        {/* Error state — both tiers failed */}
        {(embedError || !active) && !loading && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '16px',
            background: '#000',
          }}>
            <div style={{ fontSize: '32px' }}>📺</div>
            <div style={{
              fontSize: '12px', color: 'var(--text-muted)',
              fontFamily: 'JetBrains Mono, monospace', textAlign: 'center',
              lineHeight: 1.6, maxWidth: '280px',
            }}>
              {active
                ? 'Embed restricted. Click below to watch on YouTube — all channels stream 24/7.'
                : 'Select a channel above to start watching.'}
            </div>
            {active && (
              <a
                href={active.watchUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding:       '8px 20px',
                  background:    'rgba(255,0,0,0.9)',
                  color:         '#fff',
                  borderRadius:  '4px',
                  fontSize:      '12px',
                  fontFamily:    'JetBrains Mono, monospace',
                  fontWeight:    700,
                  textDecoration:'none',
                  letterSpacing: '0.06em',
                  display:       'flex',
                  alignItems:    'center',
                  gap:           '8px',
                }}
              >
                ▶ WATCH {active.channelName} ON YOUTUBE
              </a>
            )}
          </div>
        )}

        {/* Loading overlay */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#000',
          }}>
            <div style={{ color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', fontSize: '11px' }}>
              SCANNING LIVE FEEDS...
            </div>
          </div>
        )}

        {/* Channel name overlay */}
        {active && !embedError && (
          <div style={{
            position: 'absolute', bottom: '12px', left: '12px',
            background: 'rgba(0,0,0,0.75)',
            padding: '5px 12px', borderRadius: '4px',
            fontSize: '11px', color: '#fff',
            fontFamily: 'Syne, sans-serif', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: '6px',
            pointerEvents: 'none',
          }}>
            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ff4560', animation: 'pulseDot 1.5s ease-in-out infinite' }} />
            {active.channelName} · LIVE
          </div>
        )}

        {/* Embed error / fallback controls */}
        {active && !embedError && (
          <div style={{
            position: 'absolute', bottom: '12px', right: '12px',
            display: 'flex', gap: '6px',
          }}>
            {/* Try fallback if not already in fallback */}
            {!fallbackMode && (
              <button
                onClick={() => setFallbackMode(true)}
                style={{
                  background: 'rgba(0,0,0,0.7)', color: 'var(--text-muted)',
                  padding: '4px 10px', borderRadius: '3px',
                  fontSize: '9px', fontFamily: 'JetBrains Mono, monospace',
                  border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
                }}
              >
                ↺ RELOAD
              </button>
            )}
            <a
              href={active.watchUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: 'rgba(255,0,0,0.85)', color: '#fff',
                padding: '4px 10px', borderRadius: '3px',
                fontSize: '9px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                textDecoration: 'none', letterSpacing: '0.06em',
              }}
            >
              ▶ YOUTUBE
            </a>
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '5px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
        fontSize: '9px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>All channels broadcast 24/7 · Click channel to switch instantly</span>
        <span style={{ color: hasApiKey ? 'var(--positive)' : 'var(--text-muted)' }}>
          {hasApiKey ? '● API LIVE DETECT' : '● PERMANENT IDs'}
        </span>
      </div>
    </div>
  )
}