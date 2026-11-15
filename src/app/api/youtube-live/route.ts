// src/app/api/youtube-live/route.ts
// Live finance and news TV, with no API key.
//
// Earlier versions hardcoded one "permanent" video id per channel. Channels
// restart their streams, the ids died, and the player showed "This video is
// unavailable". This version asks YouTube which video each channel is
// streaming RIGHT NOW (the public /channel/<id>/live page, the same one a
// browser opens), and only offers a stream that is live and allows embedding.
// A channel that is off air is reported as off air, never as a broken player.

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

async function resolveLive(channelId: string): Promise<LiveInfo> {
  try {
    return await liveCache.wrap(channelId, TTL_MS, async () => {
      // channelId comes from our own constant list, never from the request.
      const url = new URL(`https://www.youtube.com/channel/${channelId}/live`)
      const res = await upstreamFetch(url, { provider: 'youtube', timeoutMs: 8_000, headers: HEADERS, cache: 'no-store' })
      if (!res.ok) throw new Error(`YouTube ${res.status}`)
      return parseLivePage(await res.text())
    })
  } catch {
    return liveCache.getStale(channelId) ?? { videoId: null, live: false, title: '' }
  }
}

export async function GET(request: NextRequest) {
  const region = new URL(request.url).searchParams.get('region') ?? 'ALL'
  const wanted = region === 'ALL' ? CHANNELS : CHANNELS.filter(c => c.region === region)

  const resolved = await Promise.all(wanted.map(async ch => {
    const info = await resolveLive(ch.channelId)
    const live = info.live && !!info.videoId
    return {
      channelId:   ch.channelId,
      channelName: ch.channelName,
      shortName:   ch.shortName,
      region:      ch.region,
      accent:      ch.accent,
      description: ch.description,
      videoId:     live ? info.videoId! : '',
      embedUrl:    live ? `https://www.youtube.com/embed/${info.videoId}?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1` : '',
      watchUrl:    live ? `https://www.youtube.com/watch?v=${info.videoId}` : `https://www.youtube.com/channel/${ch.channelId}/live`,
      isVerified:  live,
      isLive:      live,
      title:       live ? info.title : `${ch.channelName} is off air`,
      status:      live ? 'live' as const : 'offline' as const,
    }
  }))

  // Channels that can be watched now come first; the curated order is kept within each group.
  const channels = [...resolved.filter(c => c.isLive), ...resolved.filter(c => !c.isLive)]

  return NextResponse.json(
    { channels, hasApiKey: false, fetchedAt: new Date().toISOString(), liveCount: channels.filter(c => c.isLive).length },
    { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } },
  )
}
