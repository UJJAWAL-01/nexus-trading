'use client'

import { useEffect } from 'react'

/**
 * Registers /sw.js once the page has fully loaded.
 * - Production only (dev would interfere with HMR).
 * - Silent failure — service worker registration must never block UX.
 * - Listens for waiting workers and auto-activates after a tab focus,
 *   so users see fresh code without manual hard-reloads.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })

        // Auto-activate updated worker when user refocuses the tab
        const handleVisibility = () => {
          if (document.visibilityState === 'visible' && reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          }
        }
        document.addEventListener('visibilitychange', handleVisibility)

        // When the controller changes (new worker took over), reload once
        let refreshed = false
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (refreshed) return
          refreshed = true
          window.location.reload()
        })
      } catch {
        // SW unavailable / blocked — fine, app still works without it
      }
    }

    // Defer registration until after the page is interactive
    if (document.readyState === 'complete') {
      register()
    } else {
      window.addEventListener('load', register, { once: true })
    }
  }, [])

  return null
}
