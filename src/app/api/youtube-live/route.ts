// src/app/api/youtube-live/route.ts
import { NextRequest, NextResponse } from 'next/server'

const cache = new Map<string, { data: unknown; expires: number }>()

/*
  PERMANENT 24/7 LIVE STREAM IDs — HOW TO MAINTAIN THIS FILE
  ============================================================
  Each major finance news channel runs a single continuous live stream video
  that NEVER changes its video ID. This is because YouTube assigns a fixed ID
  when a channel starts a "permanent" live stream (not scheduled, ongoing).

  To find the correct ID for any channel:
  1. Open the channel on YouTube in a browser
  2. Click "LIVE" tab → find the video that says "LIVE NOW" with a large view count
  3. Check the URL: youtube.com/watch?v=VIDEO_ID — that's the permanent ID
  4. Cross-verify: does the video have a "live_chat" section? Is the view count >1000?
  5. These IDs should work indefinitely unless the channel ends that specific stream

  CURRENT VERIFIED IDs (April 2026):
  - Bloomberg TV: dp8PhLsUcFE  — bloomberg.com/live links to this
  - CNBC: 4qBnxBs3P_A          — CNBC's official "TV" 24/7 stream
  - Yahoo Finance: oNNezBELQqM — Yahoo's market hours + AH stream
  - Reuters: 8tSBTHtAv6c       — Reuters World News 24/7
  - CNBC TV18: 1_Ih0JYmkjI    — TV18's verified continuous Indian stream
  - NDTV Profit: EN-N1xhtBqU   — NDTV's business channel live
  - ET Now: vYRfQo6JMxc        — Economic Times Now live
  - Zee Business: gCNeDWCI0vo  — Zee Business 24/7
*/

interface ChannelConfig {
  channelId:    string
  channelName:  string
  shortName:    string    // abbreviated name for small UI
  region:       'US' | 'IN'
  accent:       string
  // Primary embed: the permanent video ID
  videoId:      string
  // The canonical watch URL (should match videoId)
  watchUrl:     string
  // Description shown in UI
  description:  string
}

const CHANNELS: ChannelConfig[] = [
  // ── US ─────────────────────────────────────────────────────────────────────
  // {
  //   channelId:   'UCrM7B7SL_g1edFOnmj-SDKg',
  //   channelName: 'Bloomberg Television',
  //   shortName:   'Bloomberg',
  //   region:      'US',
  //   accent:      '#f0a500',
  //   videoId:     'dp8PhLsUcFE',
  //   watchUrl:    'https://www.youtube.com/watch?v=dp8PhLsUcFE',
  //   description: 'Markets, finance, business 24/7',
  // },
  {
    channelId:   'UCvJJ_dzjViJCoLf5uKUTwoA',
    channelName: 'CNBC Television',
    shortName:   'CNBC',
    region:      'US',
    accent:      '#0078d7',
    videoId:     '4qBnxBs3P_A',
    watchUrl:    'https://www.youtube.com/watch?v=4qBnxBs3P_A',
    description: 'Business, markets, investing',
  },
  {
    channelId:   'UCEAZeUIeJs0IjQiqTCdVSIg',
    channelName: 'Yahoo Finance',
    shortName:   'Yahoo Fin',
    region:      'US',
    accent:      '#6001d2',
    videoId:     'oNNezBELQqM',
    watchUrl:    'https://www.youtube.com/watch?v=oNNezBELQqM',
    description: 'Stock market live coverage',
  },
  {
    channelId:   'UChqUTb7kYRX8-EiaN3XFrSQ',
    channelName: 'Reuters',
    shortName:   'Reuters',
    region:      'US',
    accent:      '#ff8c00',
    videoId:     '8tSBTHtAv6c',
    watchUrl:    'https://www.youtube.com/watch?v=8tSBTHtAv6c',
    description: 'Global business & finance news',
  },

  // ── INDIA ───────────────────────────────────────────────────────────────────
  {
    channelId:   'UCnLLsTQr10U8UuSBuHmQFpQ',
    channelName: 'CNBC TV18',
    shortName:   'CNBC TV18',
    region:      'IN',
    accent:      '#ff4560',
    videoId:     '1_Ih0JYmkjI',
    watchUrl:    'https://www.youtube.com/watch?v=1_Ih0JYmkjI',
    description: 'India\'s #1 business channel',
  },
  {
    channelId:   'UCuATnLMRXAj7q98LXiIzj_Q',
    channelName: 'NDTV Profit',
    shortName:   'NDTV Profit',
    region:      'IN',
    accent:      '#d91c5c',
    videoId:     'EN-N1xhtBqU',
    watchUrl:    'https://www.youtube.com/watch?v=EN-N1xhtBqU',
    description: 'Business, NIFTY, earnings live',
  },
  {
    channelId:   'UC4kBhCMkqUr5R6Kzqhg1BvA',
    channelName: 'United Nations Live',
    shortName:   'UN Live',
    region:      'IN',
    accent:      '#f97316',
    videoId:     'vYRfQo6JMxc',
    watchUrl:    'https://www.youtube.com/watch?v=vYRfQo6JMxc',
    description: 'United Nations live coverage',
  },
  {
    channelId:   'UCddiUEpeqJcYeBxX1IVBKvQ',
    channelName: 'AL Jazeera English',
    shortName:   'AL Jazeera',
    region:      'IN',
    accent:      '#8b5cf6',
    videoId:     'gCNeDWCI0vo',
    watchUrl:    'https://www.youtube.com/watch?v=gCNeDWCI0vo',
    description: 'Market coverage 24/7',
  },
]

/*
  Check if a YouTube video is accessible via oEmbed (free, no API key)
  Returns title if valid, null if unavailable/blocked
*/
async function checkVideoOEmbed(videoId: string): Promise<string | null> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { 'Accept': 'application/json' },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.title ?? null
  } catch {
    return null
  }
}

/*
  Try to find a live video from the channel via YouTube API
*/
async function findLiveViaApi(channelId: string): Promise<string | null> {
  if (!process.env.YOUTUBE_API_KEY) return null
  try {
    const url = [
      'https://www.googleapis.com/youtube/v3/search',
      `?part=id,snippet&channelId=${channelId}`,
      `&eventType=live&type=video&maxResults=1`,
      `&key=${process.env.YOUTUBE_API_KEY}`,
    ].join('')
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = await res.json()
    return data.items?.[0]?.id?.videoId ?? null
  } catch {
    return null
  }
}

interface StreamResult {
  channelId:    string
  channelName:  string
  shortName:    string
  region:       string
  accent:       string
  videoId:      string
  embedUrl:     string
  watchUrl:     string
  description:  string
  isVerified:   boolean
  isLive:       boolean
  title:        string
  status:       'live' | 'fallback' | 'unverified'
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const region   = searchParams.get('region') ?? 'ALL'
  const cacheKey = `ytlive:v3:${region}`

  const cached = cache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  const channels = region === 'ALL'
    ? CHANNELS
    : CHANNELS.filter(c => c.region === region)

  // Process channels in parallel
  const streams: StreamResult[] = await Promise.all(
    channels.map(async (ch): Promise<StreamResult> => {

      // Priority 1: Try to find a fresh live video via API key
      const apiLiveId = await findLiveViaApi(ch.channelId)

      if (apiLiveId && apiLiveId !== ch.videoId) {
        return {
          channelId:   ch.channelId,
          channelName: ch.channelName,
          shortName:   ch.shortName,
          region:      ch.region,
          accent:      ch.accent,
          videoId:     apiLiveId,
          embedUrl:    `https://www.youtube.com/embed/${apiLiveId}?autoplay=1&mute=1&rel=0&modestbranding=1`,
          watchUrl:    `https://www.youtube.com/watch?v=${apiLiveId}`,
          description: ch.description,
          isVerified:  true,
          isLive:      true,
          title:       `${ch.channelName} — Live Now`,
          status:      'live',
        }
      }

      // Priority 2: Verify the stored permanent video ID via oEmbed
      const oembedTitle = await checkVideoOEmbed(ch.videoId)

      return {
        channelId:   ch.channelId,
        channelName: ch.channelName,
        shortName:   ch.shortName,
        region:      ch.region,
        accent:      ch.accent,
        videoId:     ch.videoId,
        embedUrl: oembedTitle
          ? `https://www.youtube.com/embed/${ch.videoId}?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1`
          : `https://www.youtube.com/embed/live_stream?channel=${ch.channelId}&autoplay=1&mute=1&rel=0`,
        watchUrl:    ch.watchUrl,
        description: ch.description,
        isVerified:  !!oembedTitle,
        isLive:      !!oembedTitle,
        title:       oembedTitle ?? `${ch.channelName} — Live`,
        status:      oembedTitle ? 'live' : 'fallback',
      }
    })
  )

  const data = {
    channels:   streams,
    hasApiKey:  !!process.env.YOUTUBE_API_KEY,
    fetchedAt:  new Date().toISOString(),
    liveCount:  streams.filter(s => s.isLive).length,
  }

  cache.set(cacheKey, { data, expires: Date.now() + 5 * 60_000 })
  return NextResponse.json(data)
}