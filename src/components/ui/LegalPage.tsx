'use client'

import Link from 'next/link'
import { ReactNode } from 'react'

interface Section {
  heading: string
  body: ReactNode
}

interface LegalPageProps {
  title: string
  subtitle?: string
  lastUpdated: string
  sections: Section[]
}

export default function LegalPage({ title, subtitle, lastUpdated, sections }: LegalPageProps) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg-deep)',
      color: 'var(--text-1, #e2e8f0)',
      fontFamily: 'Inter, sans-serif',
    }}>
      {/* Header bar */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        padding: '12px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
      }}>
        <Link href="/" style={{ textDecoration: 'none' }}>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: '18px', color: '#fff' }}>
            NEX<span style={{ color: 'var(--amber)' }}>US</span>
          </span>
        </Link>
        <span style={{ color: 'var(--border)', fontSize: '14px' }}>›</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>{title}</span>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '800px', margin: '0 auto', padding: '48px 24px 80px' }}>
        <h1 style={{
          fontFamily: 'Syne, sans-serif',
          fontWeight: 800,
          fontSize: '28px',
          color: '#fff',
          marginBottom: '8px',
          letterSpacing: '-0.02em',
        }}>{title}</h1>

        {subtitle && (
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginBottom: '8px' }}>{subtitle}</p>
        )}

        <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginBottom: '40px', borderBottom: '1px solid var(--border)', paddingBottom: '24px' }}>
          Last updated: {lastUpdated}
        </p>

        {sections.map((s, i) => (
          <div key={i} style={{ marginBottom: '36px' }}>
            <h2 style={{
              fontSize: '15px',
              fontWeight: 700,
              color: 'var(--amber)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: '12px',
            }}>{s.heading}</h2>
            <div style={{ fontSize: '14px', color: 'var(--text-2, #94a3b8)', lineHeight: 1.8 }}>
              {s.body}
            </div>
          </div>
        ))}

        <div style={{
          marginTop: '48px',
          padding: '16px 20px',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '6px',
          borderLeft: '3px solid var(--teal)',
          fontSize: '13px',
          color: 'var(--text-muted)',
        }}>
          Questions? Email us at{' '}
          <a href="mailto:nexus.trading.dev@gmail.com" style={{ color: 'var(--teal)' }}>
            nexus.trading.dev@gmail.com
          </a>
        </div>

        <div style={{ marginTop: '32px' }}>
          <Link href="/" style={{ color: 'var(--teal)', textDecoration: 'none', fontSize: '13px' }}>
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
