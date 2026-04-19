'use client'

import React, { useState, useEffect } from 'react'
import Link from 'next/link'

const MOBILE_BREAKPOINT = 768

export default function Footer() {
  const [isMobile, setIsMobile] = useState(false)
  const currentYear = new Date().getFullYear()

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <footer
      style={{
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        padding: isMobile ? '20px 12px' : '32px 20px',
        marginTop: '40px',
        fontSize: isMobile ? '11px' : '12px',
        color: 'var(--text-2)',
        fontFamily: 'Inter, sans-serif',
        lineHeight: 1.6,
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        
        {/* DISCLAIMER SECTION */}
        <div
          style={{
            marginBottom: '20px',
            paddingBottom: '20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <h3
            style={{
              fontSize: isMobile ? '12px' : '14px',
              fontWeight: 700,
              color: '#fff',
              marginBottom: '12px',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
            }}
          >
            ⚠️ IMPORTANT DISCLAIMER
          </h3>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: isMobile
                ? '1fr'
                : 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: isMobile ? '12px' : '16px',
              marginBottom: '16px',
            }}
          >
            {[
              {
                title: 'NOT FINANCIAL ADVICE',
                color: 'var(--amber)',
                text:
                  'The information, data, tools, and analysis provided are for informational and educational purposes only. Nothing constitutes financial or investment advice.',
              },
              {
                title: 'DATA ACCURACY',
                color: 'var(--teal)',
                text:
                  'We make no guarantees regarding accuracy or timeliness. Market data may be delayed. Past performance does not guarantee future results.',
              },
              {
                title: 'LIABILITY LIMITATION',
                color: 'var(--text-danger, #ff5858)',
                text:
                  'We are not liable for any direct or indirect damages resulting from use of the platform.',
              },
              {
                title: 'INVESTMENT RISK',
                color: 'var(--amber)',
                text:
                  'Trading involves substantial risk. You may lose your entire investment. Always do your own research.',
              },
              {
                title: 'DATA SOURCES',
                color: 'var(--teal)',
                text:
                  'Data may come from third-party providers. Verify critical information independently.',
              },
              {
                title: 'REGULATORY COMPLIANCE',
                color: 'var(--text-danger, #ff5858)',
                text:
                  'Users are responsible for complying with applicable laws in their jurisdiction.',
              },
            ].map((item, idx) => (
              <div key={idx}>
                <h4
                  style={{
                    fontSize: isMobile ? '10px' : '11px',
                    fontWeight: 700,
                    color: item.color,
                    marginBottom: '6px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  {item.title}
                </h4>
                <p
                  style={{
                    fontSize: isMobile ? '10px' : '11px',
                    color: 'var(--text-muted)',
                    margin: 0,
                  }}
                >
                  {item.text}
                </p>
              </div>
            ))}
          </div>

          {/* FULL DISCLAIMER */}
          <div
            style={{
              background: 'rgba(0,0,0,0.3)',
              padding: isMobile ? '10px' : '12px',
              borderRadius: '4px',
              borderLeft: '3px solid var(--amber)',
              fontSize: isMobile ? '9px' : '10px',
              color: 'var(--text-muted)',
            }}
          >
            <strong style={{ color: '#fff' }}>Full Disclaimer:</strong> By using
            this platform, you accept full responsibility for your decisions. We
            do not recommend any specific investment and are not liable for
            losses.
          </div>
        </div>

        {/* LINKS */}
        <div
          style={{
            marginBottom: '20px',
            paddingBottom: '20px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: isMobile ? '12px' : '24px',
              flexWrap: 'wrap',
              fontSize: isMobile ? '10px' : '11px',
            }}
          >
            {[
              { label: 'Terms of Service',    href: '/terms' },
              { label: 'Privacy Policy',      href: '/privacy' },
              { label: 'Full Legal Disclaimer', href: '/legal' },
              { label: 'Contact Us',          href: '/contact' },
              { label: 'Accessibility',       href: '/accessibility' },
            ].map((link, idx) => (
              <Link
                key={idx}
                href={link.href}
                style={{
                  color: 'var(--teal)',
                  textDecoration: 'none',
                }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>

        {/* BRANDING + COPYRIGHT */}
        <div
          style={{
            display: 'flex',
            justifyContent: isMobile ? 'flex-start' : 'space-between',
            alignItems: isMobile ? 'flex-start' : 'center',
            flexDirection: isMobile ? 'column' : 'row',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                fontFamily: 'Syne, sans-serif',
                fontWeight: 800,
                fontSize: isMobile ? '14px' : '16px',
                color: '#fff',
              }}
            >
              NEX<span style={{ color: 'var(--amber)' }}>US</span>
            </div>
          </div>

          <div style={{ color: 'var(--text-muted)' }}>
            <div>© {currentYear} <strong style={{ color: '#fff' }}>UJJAWAL (UJ) PATEL</strong></div>
            <div style={{ fontSize: '10px' }}>
              All Rights Reserved. Patents Pending.
            </div>
          </div>
        </div>

        {/* FOOTNOTE */}
        <div
          style={{
            marginTop: '16px',
            padding: '10px',
            background: 'rgba(0,0,0,0.2)',
            borderRadius: '4px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0 }}>
            This platform is for educational purposes only and is not a
            registered financial advisor.
          </p>
        </div>
      </div>
    </footer>
  )
}