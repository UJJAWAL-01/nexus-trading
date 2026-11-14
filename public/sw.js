// NEXUS Trading Intelligence — Service Worker
// Strategy: network-first for navigation + same-origin assets, cache fallback
// when offline.
//
// API responses are never cached, with one narrow exception: slow-moving,
// public, keyless reference data (daily-or-slower price history, company
// fundamentals, weekly futures positioning). Those are saved after a
// successful fetch and used ONLY when the network request fails, so the
// research panels still work on a plane or a dropped connection. Live quotes,
// news, streams and anything intraday always go to the network.

const VERSION = 'nexus-v2'
const SHELL_CACHE = `${VERSION}-shell`
const DATA_CACHE  = `${VERSION}-data`
const DATA_MAX_ENTRIES = 150

// Which API requests may be kept for offline use.
function isOfflineData(url) {
  const p = url.pathname
  if (p === '/api/fundamentals' || p === '/api/cot') return true
  if (p === '/api/yfinance') {
    // History only: daily, weekly or monthly bars. Intraday data is never kept.
    const interval = url.searchParams.get('interval') || '1d'
    const range    = url.searchParams.get('range') || '1mo'
    return ['1d', '5d', '1wk', '1mo', '3mo'].includes(interval) && range !== '1d'
  }
  return false
}

async function trimCache(cache) {
  const keys = await cache.keys()
  // Cache.keys() returns entries in insertion order: drop the oldest first.
  for (let i = 0; i < keys.length - DATA_MAX_ENTRIES; i++) await cache.delete(keys[i])
}

async function networkThenSaved(req) {
  const cache = await caches.open(DATA_CACHE)
  try {
    const res = await fetch(req)
    if (res && res.status === 200) {
      // Re-insert so the freshest entries are the last to be trimmed.
      await cache.delete(req)
      await cache.put(req, res.clone())
      trimCache(cache).catch(() => {})
    }
    return res
  } catch (err) {
    const saved = await cache.match(req)
    if (!saved) throw err
    // Tell the page this answer is saved data, not live.
    const headers = new Headers(saved.headers)
    headers.set('x-nexus-offline', '1')
    return new Response(await saved.blob(), { status: 200, headers })
  }
}

// Install: precache nothing — runtime cache is enough.
// Activate immediately so an updated worker takes over without an extra reload.
self.addEventListener('install', (event) => {
  self.skipWaiting()
})

// Activate: nuke any older caches so we don't serve stale assets after a deploy.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// Fetch:
//   /api/*           → network-only (live data, never cached)
//   navigations      → network-first, fall back to cached shell
//   same-origin GET  → network-first, fall back to cache, then update cache
//   anything else    → pass-through
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // 1. API routes — network only, except saved reference data as an offline fallback.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    if (isOfflineData(url)) event.respondWith(networkThenSaved(req))
    return // everything else: default network behavior
  }

  // 2. Cross-origin (third-party fetches) — pass through.
  if (url.origin !== self.location.origin) return

  // 3. Same-origin GETs — network-first with cache fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        // Only cache 200 OK basic responses (avoid opaque / errored)
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {})
        }
        return res
      })
      .catch(async () => {
        const cached = await caches.match(req)
        if (cached) return cached
        // Navigation fallback — return the home shell if we have it
        if (req.mode === 'navigate') {
          const home = await caches.match('/')
          if (home) return home
        }
        // No cache, no network — return a synthetic 503
        return new Response('Offline — open the app while online to cache resources.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        })
      })
  )
})
