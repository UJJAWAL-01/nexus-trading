import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Contact — NEXUS Trading Intelligence',
}

export default function ContactPage() {
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
        <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Contact</span>
      </div>

      <div style={{ maxWidth: '700px', margin: '0 auto', padding: '48px 24px 80px' }}>
        <h1 style={{
          fontFamily: 'Syne, sans-serif',
          fontWeight: 800,
          fontSize: '28px',
          color: '#fff',
          marginBottom: '12px',
          letterSpacing: '-0.02em',
        }}>Contact Us</h1>

        <p style={{ color: 'var(--text-muted)', fontSize: '14px', lineHeight: 1.7, marginBottom: '40px', borderBottom: '1px solid var(--border)', paddingBottom: '24px' }}>
          NEXUS is built by a solo developer. I read every message — please be specific about your issue or question so I can help you faster.
        </p>

        {/* Contact card */}
        <div style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '28px',
          marginBottom: '24px',
        }}>
          <h2 style={{ color: 'var(--amber)', textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '16px' }}>
            General & Support
          </h2>
          <a href="mailto:nexus.trading.dev@gmail.com" style={{
            color: 'var(--teal)',
            fontSize: '18px',
            fontWeight: 600,
            textDecoration: 'none',
            fontFamily: 'JetBrains Mono, monospace',
          }}>
            nexus.trading.dev@gmail.com
          </a>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: '10px', lineHeight: 1.6 }}>
            For bug reports, data issues, feature requests, partnership inquiries, and general questions.
          </p>
        </div>

        {/* Topic cards */}
        {[
          {
            title: 'Bug Reports',
            color: 'var(--negative, #ff4560)',
            tips: ['Describe what you expected vs. what happened', 'Include the stock symbol or panel where the issue occurred', 'Share your browser and device type'],
          },
          {
            title: 'Data Issues',
            color: 'var(--teal)',
            tips: ['Include the ticker symbol and data type (price, options, news, etc.)', 'Note the time when you saw incorrect data', 'Market data may be delayed 15+ min — please verify before reporting'],
          },
          {
            title: 'Feature Requests',
            color: 'var(--amber)',
            tips: ['Describe the use case, not just the feature', 'Explain how it fits your trading workflow', 'Mention whether you use US or Indian market primarily'],
          },
        ].map((item, i) => (
          <div key={i} style={{
            background: 'rgba(0,0,0,0.2)',
            border: '1px solid var(--border)',
            borderLeft: `3px solid ${item.color}`,
            borderRadius: '6px',
            padding: '20px',
            marginBottom: '16px',
          }}>
            <h3 style={{ color: item.color, fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '10px' }}>
              {item.title}
            </h3>
            <ul style={{ color: 'var(--text-muted)', fontSize: '13px', paddingLeft: '18px', lineHeight: 1.8 }}>
              {item.tips.map((tip, j) => <li key={j}>{tip}</li>)}
            </ul>
          </div>
        ))}

        <div style={{
          marginTop: '32px',
          padding: '16px 20px',
          background: 'rgba(0,0,0,0.3)',
          borderRadius: '6px',
          fontSize: '13px',
          color: 'var(--text-muted)',
          lineHeight: 1.7,
        }}>
          <strong style={{ color: '#fff' }}>Response time:</strong> I aim to respond within 48 hours. For urgent data or access issues, please include "URGENT" in your subject line.
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
