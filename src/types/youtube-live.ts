// src/types/youtube-live.ts

export type ChannelStatus = 'live' | 'recent' | 'offline'
export type ChannelRegion = 'US' | 'IN'

export interface ChannelDef {
  channelId:     string
  channelName:   string
  shortName:     string
  region:        ChannelRegion
  accent:        string
  priorityScore: number   // 1–10, higher = shown first within same status tier
  description:   string
}

export interface ResolvedChannel extends ChannelDef {
  status:      ChannelStatus
  isLive:      boolean
  isFallback:  boolean     // true when showing recent instead of live
  videoId:     string | null
  title:       string
  publishedAt: string | null
  embedUrl:    string | null
  watchUrl:    string | null
}

export interface YoutubeApiResponse {
  channels:   ResolvedChannel[]
  hasApiKey:  boolean
  fetchedAt:  string
  liveCount:  number
  recentCount: number
}