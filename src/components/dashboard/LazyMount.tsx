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
      {visible ? <div className="nx-enter" style={{ height: '100%', width: '100%' }}>{children}</div> : (fallback ?? <DefaultPlaceholder />)}
    </div>
  )
}

function DefaultPlaceholder() {
  // Shaped like a panel so nothing jumps when the real one arrives.
  return (
    <div aria-hidden style={{ height: '100%', width: '100%', background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: '6px', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, overflow: 'hidden' }}>
      <div className="nx-skel" style={{ height: 14, width: '38%' }} />
      <div className="nx-skel" style={{ flex: 1, minHeight: 40, animationDelay: '120ms' }} />
      <div className="nx-skel" style={{ height: 10, width: '72%', animationDelay: '240ms' }} />
    </div>
  )
}
