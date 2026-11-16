'use client'
// src/components/ui/Motion.tsx
// Small shared pieces that give panels the same feel:
//   <Tick>          a live number that flashes once when its value changes
//   <PanelSkeleton> a panel-shaped loading state (no spinner, no layout jump)
//   usePanelGuide() "what am I looking at?" with places to go next
// The CSS lives in the MOTION SYSTEM section of globals.css.

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { focusPanel } from '@/components/dashboard/CommandBar'

const MONO = 'var(--font-data)'

/**
 * Renders `children` and flashes green or red for a moment whenever `value`
 * moves. The number itself is never animated: it is always the true value.
 */
export function Tick({ value, children, style }: { value: number | null | undefined; children: ReactNode; style?: CSSProperties }) {
  const ref  = useRef<HTMLSpanElement>(null)
  const prev = useRef<number | null | undefined>(value)
  useEffect(() => {
    const before = prev.current
    prev.current = value
    const el = ref.current
    if (!el || typeof before !== 'number' || typeof value !== 'number' || before === value) return
    el.classList.remove('nx-tick-up', 'nx-tick-down')
    void el.offsetWidth                       // restart the animation if it is still running
    el.classList.add(value > before ? 'nx-tick-up' : 'nx-tick-down')
  }, [value])
  return <span ref={ref} className="nx-tick" style={style}>{children}</span>
}

type SkeletonShape = 'tiles' | 'chart' | 'table'

/** Loading state shaped like the panel it stands in for. */
export function PanelSkeleton({ label, shapes = ['tiles', 'chart', 'table'] }: { label: string; shapes?: SkeletonShape[] }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="nx-fade" style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
      {shapes.map((shape, i) => {
        if (shape === 'tiles') return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
            {[0, 1, 2, 3].map(k => <div key={k} className="nx-skel" style={{ height: 54, animationDelay: `${k * 90}ms` }} />)}
          </div>
        )
        if (shape === 'chart') return <div key={i} className="nx-skel" style={{ height: 150 }} />
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {[100, 92, 96, 84, 90].map((w, k) => <div key={k} className="nx-skel" style={{ height: 12, width: `${w}%`, animationDelay: `${k * 70}ms`, opacity: 1 - k * 0.14 }} />)}
          </div>
        )
      })}
    </div>
  )
}

export interface GuideLink { label: string; panelId: string }

/**
 * A quiet "?" in the panel header that opens a short, plain-language
 * explanation and suggests where to look next. Closed by default.
 * Returns the header button and the collapsible body to place under the header.
 */
export function usePanelGuide({ title, children, next }: { title: string; children: ReactNode; next?: GuideLink[] }): { button: ReactNode; body: ReactNode } {
  const [open, setOpen] = useState(false)
  const id = useId()
  const go = (panelId: string) => focusPanel(panelId)
  return {
    button: (
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)} title={open ? 'Hide explanation' : 'What am I looking at?'}
        style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0, cursor: 'pointer', fontFamily: MONO, fontSize: 11, fontWeight: 700, lineHeight: 1, padding: 0, minWidth: 0, minHeight: 0,
          border: `1px solid ${open ? 'var(--teal)' : 'var(--border-br)'}`, color: open ? 'var(--teal)' : 'var(--text-muted)',
          background: open ? 'color-mix(in srgb, var(--teal) 12%, transparent)' : 'transparent',
        }}>?</button>
    ),
    body: (
      <div id={id} className="nx-collapse" data-open={open} aria-hidden={!open}>
        <div>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'color-mix(in srgb, var(--teal) 4%, transparent)', fontFamily: MONO, fontSize: 11, lineHeight: 1.65, color: 'var(--text-2)' }}>
            <div style={{ color: 'var(--teal)', fontWeight: 700, letterSpacing: '0.06em', fontSize: 10, marginBottom: 4 }}>{title.toUpperCase()}</div>
            {children}
            {next && next.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em' }}>LOOK NEXT</span>
                {next.map(n => (
                  <button key={n.panelId} type="button" tabIndex={open ? 0 : -1} onClick={() => go(n.panelId)}
                    style={{ border: '1px solid var(--border-br)', background: 'var(--bg-deep)', color: 'var(--text)', borderRadius: 3, padding: '3px 8px', fontFamily: MONO, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                    {n.label} →
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    ),
  }
}
