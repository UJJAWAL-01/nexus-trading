'use client'
// src/components/dashboard/OfflineNotice.tsx
// Says so, plainly, when the browser has no connection. While offline the
// service worker serves the last saved price history, fundamentals and
// positioning (see public/sw.js); live prices cannot update. People must never
// mistake saved data for live data.

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}
const isOnline = () => navigator.onLine
const serverOnline = () => true

export default function OfflineNotice() {
  const online = useSyncExternalStore(subscribe, isOnline, serverOnline)
  if (online) return null
  return (
    <div role="status" aria-live="polite" className="nx-toast" style={{
      position: 'fixed', left: '50%', bottom: 14, transform: 'translateX(-50%)', zIndex: 9998,
      maxWidth: 'min(640px, calc(100vw - 24px))', padding: '8px 14px', borderRadius: 5,
      background: 'var(--bg-deep)', border: '1px solid var(--amber)', borderLeft: '3px solid var(--amber)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, lineHeight: 1.5, color: 'var(--text-2)',
    }}>
      <strong style={{ color: 'var(--amber)', letterSpacing: '0.06em' }}>YOU ARE OFFLINE.</strong>{' '}
      Live prices and news are paused. Price history, fundamentals and positioning show the last data saved on this device.
    </div>
  )
}
