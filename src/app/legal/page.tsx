import type { Metadata } from 'next'
import LegalPage from '@/components/ui/LegalPage'

export const metadata: Metadata = {
  title: 'Legal Disclaimer — NEXUS Trading Intelligence',
}

export default function LegalPage_() {
  return (
    <LegalPage
      title="Full Legal Disclaimer"
      subtitle="Complete legal notice regarding the use of NEXUS Trading Intelligence."
      lastUpdated="April 2025"
      sections={[
        {
          heading: 'Not a Registered Financial Service',
          body: (
            <p>
              NEXUS Trading Intelligence is not a registered investment adviser, broker-dealer, financial planner, hedge fund, bank, or any other type of regulated financial institution in any jurisdiction. We are not licensed by SEBI (Securities and Exchange Board of India), the SEC (U.S. Securities and Exchange Commission), FCA (UK Financial Conduct Authority), or any other regulatory body. Nothing presented on this platform constitutes advice of any nature.
            </p>
          ),
        },
        {
          heading: 'Informational Purpose Only',
          body: (
            <p>
              All content, tools, data, charts, calculations, AI-generated analysis, signals, indicators, and commentary provided by NEXUS are strictly for informational and educational purposes. They do not constitute a recommendation, solicitation, or offer to buy or sell any financial instrument, security, derivative, commodity, or cryptocurrency. Past performance displayed on this platform is historical and does not guarantee future results.
            </p>
          ),
        },
        {
          heading: 'Trading Risk Warning',
          body: (
            <>
              <p>Trading and investing in financial markets involves significant risk and is not suitable for all investors. You may lose some or all of your capital. Specifically:</p>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                <li>Options and derivatives trading can result in losses exceeding your initial investment</li>
                <li>Margin trading amplifies both gains and losses</li>
                <li>Equities can become worthless</li>
                <li>Cryptocurrencies are highly volatile and largely unregulated</li>
                <li>Commodities and FX are subject to geopolitical and macroeconomic shocks</li>
              </ul>
              <p style={{ marginTop: 12 }}>Always understand the risks before trading and never invest money you cannot afford to lose.</p>
            </>
          ),
        },
        {
          heading: 'AI & Algorithm Disclaimer',
          body: (
            <p>
              AI-generated content (correlation analysis, news sentiment, earnings insights, market commentary) is produced by third-party language models including Grok (xAI), Claude (Anthropic), and Gemini (Google). These models may produce inaccurate, hallucinated, or outdated information. All AI output should be treated as unverified and experimental. NEXUS does not guarantee the accuracy of any AI-generated content.
            </p>
          ),
        },
        {
          heading: 'Data Disclaimer',
          body: (
            <p>
              Market data, prices, news, earnings, options chains, and macroeconomic indicators displayed on NEXUS are sourced from third-party providers and may be delayed, inaccurate, incomplete, or unavailable. We make no warranty, express or implied, as to the accuracy, completeness, timeliness, or fitness for any particular purpose of any data displayed. Always verify critical information from primary official sources before making any financial decision.
            </p>
          ),
        },
        {
          heading: 'No Liability',
          body: (
            <p>
              NEXUS, its creator Ujjawal Patel, and any affiliated parties expressly disclaim all liability for any direct, indirect, incidental, special, exemplary, or consequential damages including but not limited to: trading losses, lost profits, missed opportunities, data loss, business interruption, or any other financial or personal loss, arising from your reliance on any information presented on this platform, regardless of whether we were advised of the possibility of such damage.
            </p>
          ),
        },
        {
          heading: 'Third-Party Content',
          body: (
            <p>
              NEXUS aggregates and displays content from third parties including news publishers, data providers, and regulators. We do not endorse any third-party content and are not responsible for its accuracy or legality. Third-party trademarks and logos remain the property of their respective owners.
            </p>
          ),
        },
        {
          heading: 'Regulatory Compliance',
          body: (
            <p>
              Users are solely responsible for ensuring their use of NEXUS complies with the laws and regulations of their jurisdiction, including securities laws, tax obligations, data protection regulations, and any restrictions on access to financial information or trading tools. NEXUS may not be legal to use in all jurisdictions.
            </p>
          ),
        },
        {
          heading: 'Contact',
          body: (
            <p>
              Legal inquiries:{' '}
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
