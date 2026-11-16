'use client'

import { useEffect, useState, useCallback, useRef } from 'react'

type Region = 'ALL' | 'US' | 'IN' | 'WW'

const FLAG: Record<string, string> = { US: 'US', IN: 'IN', WW: 'INTL' }

interface StreamResult {
  channelId:   string
  channelName: string
  shortName:   string
  region:      string
  accent:      string
  videoId:     string
  embedUrl:    string
  channelEmbed: string
  watchUrl:    string
  description: string
  isVerified:  boolean
  isLive:      boolean
  title:       string
  status:      'live' | 'offline' | 'unknown'
}

interface APIResponse {
  channels:  StreamResult[]
  hasApiKey: boolean
  fetchedAt: string
  liveCount: number
}

const REGION_FILTERS: { key: Region; label: string }[] = [
  { key: 'ALL', label: 'ALL' },
  { key: 'US',  label: 'US' },
  { key: 'IN',  label: 'INDIA' },
  { key: 'WW',  label: 'WORLD' },
]

export default function LiveFinanceVideoPanel() {
  const [streams,      setStreams]      = useState<StreamResult[]>([])
  const [loading,      setLoading]      = useState(true)
  const [region,       setRegion]       = useState<Region>('ALL')
  const [active,       setActive]       = useState<StreamResult | null>(null)
  const [liveCount,    setLiveCount]    = useState(0)
  // Per channel: which player is in use. Unset = the stream found by the server,
  // 'channel' = the channel's own live embed, 'failed' = neither would play here.
  const [tier,        setTier]        = useState<Record<string, 'channel' | 'failed'>>({})
  const [notice,      setNotice]      = useState('')
  const [lastRefresh, setLastRefresh] = useState<string>('')
  const [nonce,       setNonce]       = useState(0)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const tierRef  = useRef(tier)
  tierRef.current = tier

  // A channel can be played unless it is known to be off air or both players failed.
  const playable = useCallback((c: StreamResult) => c.status !== 'offline' && tierRef.current[c.channelId] !== 'failed', [])

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
        const same = prev ? channels.find(c => c.channelId === prev.channelId) : undefined
        // Keep the channel being watched while it can still play; otherwise move
        // to the first one that can, so something is always on screen.
        if (same && playable(same)) return same
        return channels.find(playable) ?? same ?? channels[0] ?? null
      })
    } catch {
      setStreams([])
    } finally {
      setLoading(false)
    }
  }, [playable])

  useEffect(() => {
    fetchStreams(region)
    const id = setInterval(() => fetchStreams(region), 5 * 60_000)
    return () => clearInterval(id)
  }, [region, fetchStreams])

  const displayed = region === 'ALL' ? streams : streams.filter(s => s.region === region)

  const activeTier  = active ? tier[active.channelId] : undefined
  const offAir      = !!active && active.status === 'offline'
  const embedFailed = activeTier === 'failed'
  const embedSrc = (() => {
    if (!active || offAir || embedFailed) return ''
    const base = activeTier === 'channel' || !active.embedUrl ? active.channelEmbed : active.embedUrl
    // enablejsapi lets the player tell this panel when a stream refuses to play.
    return base ? `${base}&enablejsapi=1&origin=${encodeURIComponent(typeof window !== 'undefined' ? window.location.origin : '')}` : ''
  })()

  // The player could not play this stream: try the channel's own live embed,
  // and if that fails too, move on to the next channel that can play.
  const handlePlayerError = useCallback(() => {
    if (!active) return
    const id = active.channelId
    const usingChannel = tierRef.current[id] === 'channel' || !active.embedUrl
    if (!usingChannel) { setTier(t => ({ ...t, [id]: 'channel' })); return }
    const nextTier = { ...tierRef.current, [id]: 'failed' as const }
    tierRef.current = nextTier
    setTier(nextTier)
    const next = streams.find(c => c.channelId !== id && playable(c))
    if (next) { setNotice(`${active.shortName} cannot be played here right now. Switched to ${next.shortName}.`); setActive(next) }
  }, [active, streams, playable])

  // Listen to the YouTube player (its documented postMessage events).
  useEffect(() => {
    if (!embedSrc) return
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== 'https://www.youtube.com' || e.source !== frameRef.current?.contentWindow) return
      let msg: { event?: string; info?: unknown } | null = null
      try { msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
      if (msg?.event === 'onError') handlePlayerError()
    }
    window.addEventListener('message', onMessage)
    // The player only reports events after it is asked to; ask a few times while it starts up.
    let tries = 0
    const ask = () => {
      const w = frameRef.current?.contentWindow
      if (!w) return
      try {
        w.postMessage(JSON.stringify({ event: 'listening', id: 'nexus-tv', channel: 'widget' }), 'https://www.youtube.com')
        w.postMessage(JSON.stringify({ event: 'command', func: 'addEventListener', args: ['onError'], id: 'nexus-tv', channel: 'widget' }), 'https://www.youtube.com')
      } catch {}
    }
    const timer = setInterval(() => { ask(); if (++tries >= 8) clearInterval(timer) }, 1000)
    return () => { window.removeEventListener('message', onMessage); clearInterval(timer) }
  }, [embedSrc, nonce, handlePlayerError])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const pick = (stream: StreamResult) => {
    setNotice('')
    // Picking a channel by hand gives it a fresh try.
    setTier(t => { const n = { ...t }; delete n[stream.channelId]; return n })
    setActive(stream)
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
            fontFamily: 'var(--font-data)', fontWeight: 700,
            flexShrink: 0,
          }}>
            {loading && !streams.length ? '···' : `${liveCount || streams.filter(c => c.status !== 'offline').length} LIVE`}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
          {REGION_FILTERS.map(f => (
            <button key={f.key} onClick={() => setRegion(f.key)} style={{
              padding: '2px 7px', borderRadius: '3px', cursor: 'pointer',
              fontFamily: 'var(--font-data)', fontSize: '11px',
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
        {loading && !streams.length
          ? <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-data)', padding: '4px' }}>
              Scanning channels...
            </div>
          : displayed.map(stream => {
            const isActive = active?.channelId === stream.channelId
            return (
              <button
                key={stream.channelId}
                onClick={() => pick(stream)}
                title={stream.status === 'offline' ? `${stream.channelName} is off air` : stream.title}
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
                  background: stream.status === 'offline' || tier[stream.channelId] === 'failed' ? '#4a6070' : '#00c97a',
                  animation: stream.status === 'live' ? 'pulseDot 2s ease-in-out infinite' : 'none',
                }} />
                <span style={{ fontSize: '10px', fontFamily: 'var(--font-data)', whiteSpace: 'nowrap' }}>
                  {FLAG[stream.region] ?? ''} {stream.shortName}
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
            ref={frameRef}
            key={`${active.channelId}-${activeTier ?? 'video'}-${nonce}`}
            title={`${active.channelName} live`}
            src={embedSrc}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        )}

        {/* Error state — both tiers failed */}
        {(embedFailed || offAir || (!active && !loading)) && (
          <div style={{
            position:       'absolute', inset: 0,
            display:        'flex', flexDirection: 'column',
            alignItems:     'center', justifyContent: 'center', gap: '16px',
            background:     '#000', padding: '20px',
          }}>
            
            <div style={{
              fontSize: '13px', color: 'var(--text-muted)',
              fontFamily: 'var(--font-data)',
              textAlign: 'center', lineHeight: 1.6, maxWidth: '260px',
            }}>
              {active
                ? offAir
                  ? `${active.channelName} is not broadcasting live right now. Pick a channel with a green dot.`
                  : `${active.channelName} cannot be played inside the panel right now. Pick another channel.`
                : 'No channels could be loaded. They are checked again every few minutes.'}
            </div>
            {active && embedFailed && (
              <button
                onClick={() => pick(active)}
                style={{
                  padding: '8px 20px', background: 'transparent', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.25)', borderRadius: '4px', fontSize: '12px',
                  fontFamily: 'var(--font-data)', fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
                }}
              >
                ↺ TRY AGAIN
              </button>
            )}
          </div>
        )}

        {/* Loading state */}
        {loading && !active && (
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
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-data)' }}>
              SCANNING LIVE FEEDS...
            </div>
          </div>
        )}

        {/* Channel overlay + controls */}
        {active && !embedFailed && !offAir && (
          <>
            <div style={{
              position: 'absolute', bottom: '10px', left: '10px',
              background: 'rgba(0,0,0,0.75)', padding: '4px 10px',
              borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '6px',
              pointerEvents: 'none',
            }}>
              <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#ff4560', animation: 'pulseDot 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: '11px', color: '#fff', fontFamily: 'var(--font-ui)', fontWeight: 700 }}>
                {active.channelName}
              </span>
              {active.status === 'live' && (
                <span style={{ fontSize: '11px', color: '#00c97a', fontFamily: 'var(--font-data)' }}>✓ LIVE</span>
              )}
            </div>

            <div style={{ position: 'absolute', bottom: '10px', right: '10px', display: 'flex', gap: '5px' }}>
              <button
                onClick={() => setNonce(n => n + 1)}
                style={{
                  background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.15)',
                  color: 'var(--text-muted)', padding: '4px 9px', borderRadius: '3px',
                  fontSize: '11px', fontFamily: 'var(--font-data)', cursor: 'pointer',
                }}
                title="Reload stream"
                aria-label="Reload stream"
              >
                ↺
              </button>
            </div>
          </>
        )}
      </div>

      {notice && (
        <div className="nx-fade" role="status" style={{
          padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
          fontSize: '11px', color: 'var(--amber)', fontFamily: 'var(--font-data)',
        }}>
          {notice}
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div style={{
        padding: '4px 12px', borderTop: '1px solid var(--border)', flexShrink: 0,
        fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-data)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span>{streams.length} channels · plays here, muted until you unmute · green dot = on air</span>
        <span style={{ color: 'var(--text-muted)' }}>{lastRefresh ? `updated ${lastRefresh}` : ''}</span>
      </div>

      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}