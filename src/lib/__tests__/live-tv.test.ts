import { describe, it, expect } from 'vitest'
import { CHANNELS, parseLivePage } from '@/lib/live-tv'
import { isAllowedHost } from '@/lib/providers/http'

const page = (opts: { id?: string; status?: string; embed?: boolean; live?: boolean; title?: string }) => `<!DOCTYPE html><html><head>
<title>x</title>${opts.id ? `<link rel="canonical" href="https://www.youtube.com/watch?v=${opts.id}">` : '<link rel="canonical" href="https://www.youtube.com/channel/UCabc">'}
<meta property="og:title" content="${opts.title ?? 'Markets Live'}"></head><body><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"${opts.status ?? 'OK'}","playableInEmbed":${opts.embed ?? true}},"videoDetails":{"isLive":${opts.live ?? true}}};</script>
${'<!-- padding -->'.repeat(20)}</body></html>`

describe('live TV', () => {
  it('finds the stream a channel is broadcasting now', () => {
    expect(parseLivePage(page({ id: 'QB5BNdBFujE', title: 'Bloomberg Business News Live' }))).toEqual({ videoId: 'QB5BNdBFujE', live: true, title: 'Bloomberg Business News Live' })
  })
  it('reports a channel that is off air instead of a dead player', () => {
    expect(parseLivePage(page({}))).toEqual({ videoId: null, live: false, title: '' })                       // redirected to the channel home
    expect(parseLivePage(page({ id: 'XykDr_zArcI', status: 'LIVE_STREAM_OFFLINE' })).live).toBe(false)         // scheduled, not started
    expect(parseLivePage(page({ id: 'XykDr_zArcI', status: 'ERROR' })).live).toBe(false)                      // removed
    expect(parseLivePage(page({ id: 'XykDr_zArcI', live: false })).live).toBe(false)                          // an ordinary upload
  })
  it('never offers a stream whose owner has disabled embedding', () => {
    expect(parseLivePage(page({ id: 'QB5BNdBFujE', embed: false })).live).toBe(false)
  })
  it('rejects malformed ids and hostile markup', () => {
    expect(parseLivePage(page({ id: 'short' })).videoId).toBeNull()
    expect(parseLivePage(page({ id: '"><script>x' })).videoId).toBeNull()
    expect(parseLivePage('')).toEqual({ videoId: null, live: false, title: '' })
    // Entities are decoded and angle brackets are stripped, so a title can never carry markup.
    const title = parseLivePage(page({ id: 'QB5BNdBFujE', title: 'A &amp; B &#39;live&#39; <b>' })).title
    expect(title.startsWith("A & B 'live'")).toBe(true)
    expect(title).not.toMatch(/[<>]/)
    expect(parseLivePage(page({ id: 'QB5BNdBFujE', title: 'x'.repeat(500) })).title.length).toBeLessThanOrEqual(140)
  })
  it('has well-formed, unique channel ids (they are placed in a request URL)', () => {
    const ids = CHANNELS.map(c => c.channelId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^UC[A-Za-z0-9_-]{22}$/)
    expect(CHANNELS.some(c => c.region === 'US') && CHANNELS.some(c => c.region === 'IN')).toBe(true)
  })
  it('the lookup host is on the outbound allowlist', () => {
    expect(isAllowedHost('www.youtube.com')).toBe(true)
  })
})
