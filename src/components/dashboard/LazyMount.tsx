'use client'
// src/components/dashboard/LazyMount.tsx
//
// IntersectionObserver-gated mount: child only renders when scrolled into view
// (with rootMargin so panels render *just before* they appear, eliminating any
// visible "pop"). Once mounted, stays mounted — no remount on scroll-up.

import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  children:    ReactNode
  rootMargin?: string   // default 300px → mount before scroll reaches panel
  fallback?:   ReactNode
}

export default function LazyMount({ children, rootMargin = '300px', fallback }: Props) {
  const [visible, setVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visible) return
    const el = ref.current
    if (!el) return

    // Browsers without IntersectionObserver: mount immediately
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }

    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin, threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible, rootMargin])

  return (
    <div ref={ref} style={{ height: '100%', width: '100%' }}>
      {visible ? children : (fallback ?? <DefaultPlaceholder />)}
    </div>
  )
}

function DefaultPlaceholder() {
  return (
    <div style={{
      height: '100%', width: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-panel)',
      border: '1px solid var(--border)',
      borderRadius: '6px',
      color: 'var(--text-muted)',
      fontSize: '11px',
      fontFamily: 'JetBrains Mono, monospace',
      letterSpacing: '0.08em',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
        <div style={{
          width: '20px', height: '20px',
          border: '2px solid var(--border)',
          borderTopColor: 'var(--text-muted)',
          borderRadius: '50%',
          animation: 'lazy-spin 0.9s linear infinite',
        }} />
        <span>STANDBY</span>
      </div>
      <style>{`@keyframes lazy-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
