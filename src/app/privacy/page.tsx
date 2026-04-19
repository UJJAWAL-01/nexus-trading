import type { Metadata } from 'next'
import LegalPage from '@/components/ui/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy Policy — NEXUS Trading Intelligence',
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      subtitle="How NEXUS collects, uses, and protects your information."
      lastUpdated="April 2025"
      sections={[
        {
          heading: '1. Overview',
          body: (
            <p>
              NEXUS Trading Intelligence ("we", "us", "NEXUS") is committed to protecting your privacy. This Privacy Policy explains what data we collect, how we use it, and your rights with respect to that data. By using NEXUS, you consent to the practices described here.
            </p>
          ),
        },
        {
          heading: '2. Data We Do NOT Collect',
          body: (
            <>
              <p>NEXUS is designed with minimal data collection as a core principle:</p>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                <li>We do not require account registration or login</li>
                <li>We do not collect your name, email address, or personal identifying information</li>
                <li>We do not sell or share your data with advertisers</li>
                <li>We do not store your trading journal, watchlist, or preferences on our servers — these are saved exclusively in your browser's local storage</li>
              </ul>
            </>
          ),
        },
        {
          heading: '3. Data Stored in Your Browser (localStorage)',
          body: (
            <>
              <p>The following data is stored locally in your browser only and never transmitted to our servers:</p>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                <li><strong style={{ color: '#fff' }}>Watchlist</strong> — tickers you add (key: <code style={{ color: 'var(--teal)' }}>nexus-watchlist</code>)</li>
                <li><strong style={{ color: '#fff' }}>Dashboard layout</strong> — panel positions and sizes (key: <code style={{ color: 'var(--teal)' }}>nexus-layout-v8</code>)</li>
                <li><strong style={{ color: '#fff' }}>Paper trading data</strong> — simulated account balance, trade journal, settings (keys: <code style={{ color: 'var(--teal)' }}>trading_*</code>)</li>
              </ul>
              <p style={{ marginTop: 12 }}>You can clear this data at any time by clearing your browser's local storage or resetting the dashboard.</p>
            </>
          ),
        },
        {
          heading: '4. Server-Side Data Processing',
          body: (
            <p>
              When you use NEXUS, your browser sends requests to our API server (hosted on AWS Amplify). These requests include stock ticker symbols you query, news search terms, and options data requests. These requests are processed to fetch data from third-party providers and are not stored on our servers beyond the in-memory cache used to reduce API calls. Server logs (which may include IP addresses) are managed by AWS and retained per AWS's standard log retention policies.
            </p>
          ),
        },
        {
          heading: '5. Third-Party Data Providers',
          body: (
            <>
              <p>NEXUS aggregates data from the following third-party services. Your usage may be subject to their privacy policies:</p>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                <li>Yahoo Finance (market data, quotes, options)</li>
                <li>Finnhub (real-time quotes, news, company data)</li>
                <li>Federal Reserve Economic Data — FRED (macro indicators)</li>
                <li>SEC EDGAR (financial filings)</li>
                <li>NSE India (Indian market data)</li>
                <li>NewsAPI (financial news)</li>
                <li>xAI / Grok, Anthropic / Claude, Google / Gemini (AI analysis — only ticker symbols and news headlines are sent, not personal data)</li>
                <li>YouTube (embedded live financial news streams)</li>
              </ul>
            </>
          ),
        },
        {
          heading: '6. Cookies',
          body: (
            <p>
              NEXUS does not use tracking cookies or advertising cookies. We do not use Google Analytics or any third-party analytics service. YouTube video embeds may set cookies governed by Google's Privacy Policy.
            </p>
          ),
        },
        {
          heading: '7. Children\'s Privacy',
          body: (
            <p>
              NEXUS is intended for adults who understand financial markets. It is not directed at individuals under 18 years of age. We do not knowingly collect data from minors.
            </p>
          ),
        },
        {
          heading: '8. Data Security',
          body: (
            <p>
              All communication between your browser and NEXUS servers is encrypted via HTTPS/TLS. API keys for third-party data providers are stored server-side only and never exposed to the browser. Your local storage data is subject to the security of your own device and browser.
            </p>
          ),
        },
        {
          heading: '9. Your Rights',
          body: (
            <>
              <p>Since we do not store personal data on our servers, there is nothing to access, correct, or delete on our end. For data stored in your browser, you have full control:</p>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                <li>Clear watchlist: use the Remove button in the Watchlist panel</li>
                <li>Reset dashboard: use the Reset Layout option</li>
                <li>Clear all local data: clear your browser's local storage for the NEXUS domain</li>
              </ul>
            </>
          ),
        },
        {
          heading: '10. Changes to This Policy',
          body: (
            <p>
              We may update this Privacy Policy from time to time. Changes will be reflected on this page with an updated date. Continued use of NEXUS after changes constitutes acceptance.
            </p>
          ),
        },
        {
          heading: '11. Contact',
          body: (
            <p>
              Privacy questions or concerns:{' '}
              <a href="mailto:nexus.trading.dev@gmail.com" style={{ color: 'var(--teal)' }}>
                nexus.trading.dev@gmail.com
              </a>
            </p>
          ),
        },
      ]}
    />
  )
}
