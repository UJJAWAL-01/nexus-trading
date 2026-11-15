// src/app/api/youtube-live/route.ts
// Live finance and news TV, with no API key.
//
// Earlier versions hardcoded one "permanent" video id per channel. Channels
// restart their streams, the ids died, and the player showed "This video is
// unavailable". This version asks YouTube which video each channel is
// streaming RIGHT NOW (the public /channel/<id>/live page, the same one a
// browser opens), and only offers a stream that is live and allows embedding.
// A channel that is off air is reported as off air, never as a broken player.
//
// When the lookup itself fails (YouTube sometimes turns away requests from
// hosting providers), the channel is reported as "unknown" and the panel plays
// the channel's own live embed instead, which the viewer's browser resolves.
// Either way the video plays inside the panel.

import { NextRequest, NextResponse } from 'next/server'
import { upstreamFetch } from '@/lib/providers/http'
import { createCache } from '@/lib/providers/cache'
import { CHANNELS, parseLivePage, type LiveInfo } from '@/lib/live-tv'

// One lookup per channel every ten minutes, shared by every viewer. If YouTube
// is unreachable the last known answer is served for up to an hour.
const liveCache = createCache<LiveInfo>({ name: 'yt-live', max: 40, staleMs: 60 * 60_000 })
const TTL_MS = 10 * 60_000

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  // Skips the EU cookie-consent interstitial, which would hide the player data.
  Cookie:            'SOCS=CAI; CONSENT=YES+1',
}

/** null = the lookup failed and nothing is known about this channel. */
async function resolveLive(channelId: string): Promise<LiveInfo | null> {
  try {
    return await liveCache.wrap(channelId, TTL_MS, async () => {
      // channelId comes from our own constant list, never from the request.
      const url = new URL(`https://www.youtube.com/channel/${channelId}/live`)
      const res = await upstreamFetch(url, { provider: 'youtube', timeoutMs: 8_000, headers: HEADERS, cache: 'no-store' })
      if (!res.ok) throw new Error(`YouTube ${res.status}`)
      const html = await res.text()
      // A consent or bot-check page has no canonical link: that is a failed lookup, not "off air".
      if (!html.includes('<link rel="canonical" href="https://www.youtube.com/')) throw new Error('unreadable page')
      return parseLivePage(html)
    })
  } catch {
    return liveCache.getStale(channelId) ?? null
  }
}

export async function GET(request: NextRequest) {
  const region = new URL(request.url).searchParams.get('region') ?? 'ALL'
  const wanted = region === 'ALL' ? CHANNELS : CHANNELS.filter(c => c.region === region)

  const resolved = await Promise.all(wanted.map(async ch => {
    const info = await resolveLive(ch.channelId)
    const live = !!info && info.live && !!info.videoId
    const channelEmbed = `https://www.youtube.com/embed/live_stream?channel=${ch.channelId}&autoplay=1&mute=1&rel=0&playsinline=1`
    return {
      channelId:   ch.channelId,
      channelName: ch.channelName,
      shortName:   ch.shortName,
      region:      ch.region,
      accent:      ch.accent,
      description: ch.description,
      videoId:     live ? info!.videoId! : '',
      embedUrl:    live ? `https://www.youtube.com/embed/${info!.videoId}?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1` : '',
      channelEmbed,
      watchUrl:    live ? `https://www.youtube.com/watch?v=${info!.videoId}` : `https://www.youtube.com/channel/${ch.channelId}/live`,
      isVerified:  live,
      isLive:      live,
      title:       live ? info!.title : info ? `${ch.channelName} is off air` : ch.channelName,
      status:      live ? 'live' as const : info ? 'offline' as const : 'unknown' as const,
    }
  }))

  // Channels that can be watched now come first; the curated order is kept within each group.
  const rank = { live: 0, unknown: 1, offline: 2 }
  const channels = [...resolved].sort((a, b) => rank[a.status] - rank[b.status])

  return NextResponse.json(
    { channels, hasApiKey: false, fetchedAt: new Date().toISOString(), liveCount: channels.filter(c => c.isLive).length },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  )
}
