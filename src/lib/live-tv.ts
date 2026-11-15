// src/lib/live-tv.ts
// Channel list for the Live TV panel and the parser that reads which video a
// channel is streaming now. Pure (no network), unit-tested.

export type TvRegion = 'US' | 'IN' | 'WW'

export interface TvChannel {
  channelId:   string          // YouTube channel id (UC…)
  channelName: string
  shortName:   string
  region:      TvRegion
  accent:      string
  description: string
}

/**
 * Channel ids were confirmed against each channel's own /live page, and every
 * channel here was checked to really play inside an embedded player.
 * CNBC-TV18, CNBC Awaaz, Moneycontrol and Zee Business are left out on
 * purpose: they report themselves as embeddable, but the player refuses to
 * play them anywhere except youtube.com.
 * To add one: open youtube.com/@handle/live, view source, copy "channelId".
 */
export const CHANNELS: readonly TvChannel[] = [
  { channelId: 'UCIALMKvObZNtJ6AmdCLP7Lg', channelName: 'Bloomberg Television', shortName: 'Bloomberg',  region: 'US', accent: '#a78bfa', description: 'Global business and markets' },
  { channelId: 'UCvJJ_dzjViJCoLf5uKUTwoA', channelName: 'CNBC',                 shortName: 'CNBC',       region: 'US', accent: '#0078d7', description: 'Business, markets, investing' },
  { channelId: 'UCEAZeUIeJs0IjQiqTCdVSIg', channelName: 'Yahoo Finance',        shortName: 'Yahoo Fin',  region: 'US', accent: '#6001d2', description: 'Daily market coverage' },
  { channelId: 'UChqUTb7kYRX8-EiaN3XFrSQ', channelName: 'Reuters',              shortName: 'Reuters',    region: 'US', accent: '#ff8c00', description: 'Live world and business events' },
  { channelId: 'UCI_mwTKUhicNzFrhm33MzBQ', channelName: 'ET Now',               shortName: 'ET Now',     region: 'IN', accent: '#f97316', description: 'Economic Times business news' },
  { channelId: 'UC3uJIdRFTGgLWrUziaHbzrg', channelName: 'NDTV Profit',          shortName: 'NDTV Profit', region: 'IN', accent: '#d91c5c', description: 'Markets, Nifty, earnings' },
  { channelId: 'UCUI9vm69ZbAqRK3q3vKLWCQ', channelName: 'Mint',                 shortName: 'Mint',       region: 'IN', accent: '#00c97a', description: 'Business and economy news' },
  { channelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', channelName: 'Al Jazeera English',   shortName: 'Al Jazeera', region: 'WW', accent: '#f0a500', description: 'World news' },
  { channelId: 'UCknLrEdhRCp1aegoMqRaCZg', channelName: 'DW News',              shortName: 'DW',         region: 'WW', accent: '#38bdf8', description: 'World news from Europe' },
  { channelId: 'UCoMdktPbSTixAyNGwb-UYkQ', channelName: 'Sky News',             shortName: 'Sky News',   region: 'WW', accent: '#ef4444', description: 'World news from the UK' },
]

export interface LiveInfo {
  /** The video the channel is streaming now, when one was found. */
  videoId: string | null
  /** True only when that video is live, playable, and may be embedded. */
  live:    boolean
  title:   string
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const decode = (s: string) => s
  .replace(/\\u0026/g, '&').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/[\u0000-\u001f<>]/g, ' ').trim()

/**
 * Read a channel's /live page. YouTube redirects that page to the current
 * stream's watch page when the channel is on air, and to the channel home
 * (no video) when it is not.
 */
export function parseLivePage(html: string): LiveInfo {
  const off: LiveInfo = { videoId: null, live: false, title: '' }
  if (typeof html !== 'string' || html.length < 200) return off

  const videoId = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([^"&]+)"/)?.[1] ?? null
  if (!videoId || !VIDEO_ID.test(videoId)) return off

  const status     = html.match(/"playabilityStatus":\{"status":"([A-Z_]+)"/)?.[1]
  const embeddable = html.match(/"playableInEmbed":(true|false)/)?.[1] === 'true'
  const isLive     = /"isLive":true/.test(html)
  const rawTitle   = html.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? ''

  return {
    videoId,
    // "OK" excludes scheduled-but-not-started streams (LIVE_STREAM_OFFLINE) and removed videos.
    live:  status === 'OK' && embeddable && isLive,
    title: decode(rawTitle).slice(0, 140),
  }
}
