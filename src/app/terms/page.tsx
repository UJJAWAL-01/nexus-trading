import type { Metadata } from 'next'
import LegalPage from '@/components/ui/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of Service — NEXUS Trading Intelligence',
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      subtitle="Please read these terms carefully before using NEXUS Trading Intelligence."
      lastUpdated="April 2025"
      sections={[
        {
          heading: '1. Acceptance of Terms',
          body: (
            <p>
              By accessing or using NEXUS Trading Intelligence ("NEXUS", "the Platform", "we", "us"), you agree to be bound by these Terms of Service. If you do not agree, you must not use the Platform. We reserve the right to update these terms at any time; continued use constitutes acceptance.
            </p>
          ),
        },
        {
          heading: '2. Nature of the Platform',
          body: (
            <>
              <p>NEXUS is an informational and educational research tool that aggregates publicly available market data, news, financial statistics, and AI-generated analysis. It is <strong style={{ color: '#fff' }}>not</strong> a registered investment adviser, broker-dealer, financial planner, or any other type of regulated financial service.</p>
              <p style={{ marginTop: 12 }}>Nothing on NEXUS constitutes financial, investment, legal, tax, or trading advice. All content is provided solely for informational and educational purposes.</p>
            </>
          ),
        },
        {
          heading: '3. No Investment Advice',
          body: (
            <p>
              The tools, data, charts, signals, AI analysis, and commentary displayed on NEXUS do not represent recommendations to buy, sell, or hold any security, derivative, cryptocurrency, or other financial instrument. You should not make any financial decision based solely on information from NEXUS. Always consult a qualified financial professional and conduct your own independent research before investing.
            </p>
          ),
        },
        {
          heading: '4. Risk Disclosure',
          body: (
            <>
              <p>Trading and investing in financial markets carries substantial risk of loss. Leveraged products such as options, futures, and margin accounts can result in losses exceeding your initial investment. Past performance — whether of markets, strategies, or any data shown — is not indicative of future results.</p>
              <p style={{ marginTop: 12 }}>You are solely responsible for any trades or investments you make. NEXUS bears no responsibility for losses incurred as a result of using or relying on information from the Platform.</p>
            </>
          ),
        },
        {
          heading: '5. Data Accuracy & Availability',
          body: (
            <p>
              Market data on NEXUS is sourced from third-party providers including Yahoo Finance, Finnhub, FRED (Federal Reserve), SEC EDGAR, NSE India, and others. Data may be delayed by 15 minutes or more, may contain errors, and is provided "as is" without warranty of any kind. We make no representation that data is accurate, complete, or current. Service may be interrupted, suspended, or discontinued at any time.
            </p>
          ),
        },
        {
          heading: '6. AI-Generated Content',
          body: (
            <p>
              NEXUS uses AI language models (including Grok, Claude, and Gemini) to generate market commentary, sentiment analysis, and correlation insights. AI-generated content may be inaccurate, outdated, or incomplete. It is produced algorithmically and does not reflect the views of a human financial analyst. Treat all AI-generated content as experimental and unverified.
            </p>
          ),
        },
        {
          heading: '7. Limitation of Liability',
          body: (
            <p>
              To the maximum extent permitted by applicable law, NEXUS and its creators shall not be liable for any direct, indirect, incidental, special, consequential, or punitive damages arising from your use of or inability to use the Platform, including but not limited to trading losses, lost profits, lost data, or business interruption, even if advised of the possibility of such damages.
            </p>
          ),
        },
        {
          heading: '8. Intellectual Property',
          body: (
            <p>
              The NEXUS platform, branding, UI design, and proprietary algorithms are owned by Ujjawal Patel. Third-party data, logos, and trademarks remain the property of their respective owners. You may not reproduce, distribute, or commercially exploit NEXUS content without written permission.
            </p>
          ),
        },
        {
          heading: '9. Prohibited Use',
          body: (
            <>
              <p>You agree not to:</p>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                <li>Use NEXUS for any unlawful purpose or in violation of applicable regulations</li>
                <li>Attempt to scrape, reverse-engineer, or systematically extract data from the Platform</li>
                <li>Abuse or overload API endpoints in ways that violate rate limits</li>
                <li>Use the Platform to commit market manipulation or any form of financial fraud</li>
                <li>Redistribute real-time or delayed data in violation of third-party data provider terms</li>
              </ul>
            </>
          ),
        },
        {
          heading: '10. Jurisdictional Restrictions',
          body: (
            <p>
              NEXUS is operated from India. Access may not be appropriate or legal in certain jurisdictions. You are solely responsible for compliance with the laws of your jurisdiction, including securities laws, data protection laws, and any regulations governing access to financial information.
            </p>
          ),
        },
        {
          heading: '11. Governing Law',
          body: (
            <p>
              These Terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of courts in India.
            </p>
          ),
        },
        {
          heading: '12. Contact',
          body: (
            <p>
              For questions about these Terms, contact us at{' '}
              <a href="mailto:nexus.trading.dev@gmail.com" style={{ color: 'var(--teal)' }}>
                nexus.trading.dev@gmail.com
              </a>.
            </p>
          ),
        },
      ]}
    />
  )
}
