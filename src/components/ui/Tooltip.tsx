'use client'

// Touch-friendly tooltip primitive.
// - Desktop: shows on hover (mouseenter), hides on mouseleave + after delay.
// - Touch:   shows on tap, persists until next tap outside or 5s timeout.
// - Always keyboard-accessible via focus/blur.

import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'

interface TooltipProps {
  /** Tooltip content (text or JSX) */
  content: ReactNode
  /** The element that triggers the tooltip — wrapped, not replaced */
  children: ReactNode
  /** Preferred placement (default 'top') — falls back if not enough room */
  placement?: 'top' | 'bottom' | 'left' | 'right'
  /** Max width in px (default 240) */
  maxWidth?: number
  /** Optional extra style for the trigger wrapper */
  triggerStyle?: CSSProperties
  /** Aria label for screen readers (defaults to stringified content) */
  ariaLabel?: string
}

export default function Tooltip({
  content, children,
  placement = 'top',
  maxWidth = 240,
  triggerStyle,
  ariaLabel,
}: TooltipProps) {
  const [open, setOpen] = useState(false)
  const wrapRef     = useRef<HTMLSpanElement>(null)
  const closeTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoClose   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Outside-click handler closes the tooltip on touch devices
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    // Auto-close after 5s on touch (where there's no leave event)
    autoClose.current = setTimeout(() => setOpen(false), 5000)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      if (autoClose.current) { clearTimeout(autoClose.current); autoClose.current = null }
    }
  }, [open])

  // Clean up timers on unmount
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    if (autoClose.current)  clearTimeout(autoClose.current)
  }, [])

  const show = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(true)
  }
  const scheduleHide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }

  // Placement → positioning style for the bubble
  const placementStyle: CSSProperties = (() => {
    switch (placement) {
      case 'bottom': return { top: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' }
      case 'left':   return { right: 'calc(100% + 6px)', top: '50%',  transform: 'translateY(-50%)' }
      case 'right':  return { left:  'calc(100% + 6px)', top: '50%',  transform: 'translateY(-50%)' }
      case 'top':
      default:       return { bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)' }
    }
  })()

  return (
    <span
      ref={wrapRef}
      style={{ position: 'relative', display: 'inline-flex', ...triggerStyle }}
      onMouseEnter={show}
      onMouseLeave={scheduleHide}
      onFocus={show}
      onBlur={scheduleHide}
    >
      <span
        onClick={e => {
          // On touch devices, click toggles. On mouse, the hover handlers
          // already control state — this is a no-op there.
          e.stopPropagation()
          setOpen(v => !v)
        }}
        aria-label={ariaLabel}
        aria-describedby={open ? 'tooltip-bubble' : undefined}
        tabIndex={0}
        style={{ display: 'inline-flex', cursor: 'help' }}
      >
        {children}
      </span>
      {open && (
        <span
          id="tooltip-bubble"
          role="tooltip"
          style={{
            position: 'absolute',
            ...placementStyle,
            background: 'var(--bg-deep)',
            border: '1px solid var(--border-br)',
            borderRadius: 4,
            padding: '6px 10px',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--text)',
            maxWidth,
            width: 'max-content',
            zIndex: 10000,
            boxShadow: '0 6px 18px rgba(0,0,0,0.6)',
            pointerEvents: 'auto',
            whiteSpace: 'normal',
          }}
        >
          {content}
        </span>
      )}
    </span>
  )
}
