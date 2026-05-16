// NEXUS Trading Intelligence — Service Worker
// Strategy: network-first for navigation + same-origin assets, cache fallback
// when offline. API responses are NEVER cached (data is live + auth-sensitive).

const VERSION = 'nexus-v1'
const SHELL_CACHE = `${VERSION}-shell`

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

  // 1. API routes — never cache, never fall back. Let the panel handle errors.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    return // default network behavior
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
