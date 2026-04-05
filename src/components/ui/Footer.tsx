'use client'

import React from 'react'

export default function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <footer style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-panel)',
      padding: '32px 20px',
      marginTop: '40px',
      fontSize: '12px',
      color: 'var(--text-2)',
      fontFamily: 'Inter, sans-serif',
      lineHeight: 1.6,
    }}>
      {/* ── Disclaimer Section ────────────────────────────────────────── */}
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Legal Disclaimer */}
        <div style={{ marginBottom: '28px', paddingBottom: '28px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{
            fontSize: '14px',
            fontWeight: 700,
            color: '#fff',
            marginBottom: '12px',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}>
            ⚠️ IMPORTANT DISCLAIMER
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginBottom: '16px' }}>

            {/* Column 1: Financial Advice Disclaimer */}
            <div>
              <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--amber)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                NOT FINANCIAL ADVICE
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                The information, data, tools, and analysis provided by Nexus Trading Intelligence ("Platform") are for informational and educational purposes only. Nothing on this Platform constitutes financial advice, investment advice, trading advice, tax advice, legal advice, or any recommendation to buy, sell, hold, or trade any security or financial instrument.
              </p>
            </div>

            {/* Column 2: No Accuracy Guarantee */}
            <div>
              <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--teal)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                DATA ACCURACY
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                While we strive to provide accurate and timely information, we make no representations or warranties regarding the accuracy, completeness, or timeliness of the data. Market data may be delayed. Historical performance does not guarantee future results.
              </p>
            </div>

            {/* Column 3: Liability Limitation */}
            <div>
              <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-danger, #ff5858)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                LIABILITY LIMITATION
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                TO THE MAXIMUM EXTENT PERMITTED BY LAW: The Platform, its creators, developers, and operators shall not be liable for any direct, indirect, incidental, special, consequential, or punitive damages from your use of or inability to use the Platform.
              </p>
            </div>

            {/* Column 4: Risk Acknowledgment */}
            <div>
              <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--amber)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                INVESTMENT RISK
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                Trading and investing in securities, commodities, and derivatives involve substantial risk of loss. Past performance is not indicative of future results. You may lose your entire investment. Do your own research and consult qualified professionals.
              </p>
            </div>

            {/* Column 5: Data Sources */}
            <div>
              <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--teal)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                DATA SOURCES
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                Data sourced from Yahoo Finance, CoinGecko, and other third-party providers. We do not control these sources and cannot guarantee their accuracy. Verify critical data independently before making trading decisions.
              </p>
            </div>

            {/* Column 6: Terms & Conditions */}
            <div>
              <h4 style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-danger, #ff5858)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                REGULATORY COMPLIANCE
              </h4>
              <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                This Platform is provided "AS IS" without warranty. Users are responsible for compliance with all applicable laws and regulations in their jurisdiction. Always verify information through official sources before acting.
              </p>
            </div>
          </div>

          {/* Full Disclaimer Paragraph */}
          <div style={{
            background: 'rgba(0,0,0,0.3)',
            padding: '12px',
            borderRadius: '4px',
            borderLeft: '3px solid var(--amber)',
            fontSize: '10px',
            color: 'var(--text-muted)',
            lineHeight: 1.6,
          }}>
            <strong style={{ color: '#fff' }}>Full Disclaimer:</strong> By using this Platform, you acknowledge that you have read this disclaimer, understand the risks involved in financial markets, and accept full responsibility for any decisions made based on information obtained from this Platform. We do not recommend any particular investment and make no claim regarding the suitability of any security for any investor. You assume all risks associated with your investment decisions. Neither Nexus Trading Intelligence, its creators, nor any associated parties are liable for losses or damages arising from your use of this Platform.
          </div>
        </div>

        {/* Links Section */}
        <div style={{ marginBottom: '24px', paddingBottom: '24px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '11px' }}>
            <a href="#/terms" style={{ color: 'var(--teal)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--amber)')} onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--teal)')}>
              Terms of Service
            </a>
            <a href="#/privacy" style={{ color: 'var(--teal)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--amber)')} onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--teal)')}>
              Privacy Policy
            </a>
            <a href="#/disclaimer" style={{ color: 'var(--teal)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--amber)')} onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--teal)')}>
              Full Legal Disclaimer
            </a>
            <a href="#/contact" style={{ color: 'var(--teal)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--amber)')} onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--teal)')}>
              Contact Us
            </a>
            <a href="#/accessibility" style={{ color: 'var(--teal)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--amber)')} onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--teal)')}>
              Accessibility
            </a>
          </div>
        </div>

        {/* Copyright & Branding */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          fontSize: '11px',
        }}>
          {/* Left: Branding */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              fontFamily: 'Syne, sans-serif',
              fontWeight: 800,
              fontSize: '16px',
              color: '#fff',
              letterSpacing: '-0.02em',
            }}>
              NEX<span style={{ color: 'var(--amber)' }}>US</span>
            </div>
            <div style={{ borderLeft: '1px solid var(--border)', paddingLeft: '12px', color: 'var(--text-muted)', fontSize: '9px', letterSpacing: '0.08em' }}>
              TRADING INTELLIGENCE
            </div>
          </div>

          {/* Right: Copyright */}
          <div style={{ textAlign: 'right', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: '11px', marginBottom: '2px' }}>
              © {currentYear} <strong style={{ color: '#fff' }}>UJJAWAL (UJ) PATEL</strong>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              All Rights Reserved. Patents Pending.
            </div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px', letterSpacing: '0.05em' }}>
              Nexus Trading Intelligence™ | Made with <span style={{ color: 'var(--amber)' }}>⚡</span> for Modern Traders
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div style={{
          marginTop: '16px',
          padding: '10px',
          background: 'rgba(0,0,0,0.2)',
          borderRadius: '4px',
          fontSize: '9px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          borderTop: '1px solid var(--border)',
          paddingTop: '12px',
        }}>
          <p style={{ margin: '0 0 6px 0' }}>
            This platform is designed for educational and informational purposes. Nexus Trading Intelligence is not a registered investment advisor, broker-dealer, or financial institution.
          </p>
          <p style={{ margin: 0 }}>
            By using this platform, you agree to be bound by our Terms of Service and acknowledge our disclaimer. For detailed information, consult the complete legal documentation.
          </p>
        </div>
      </div>
    </footer>
  )
}
