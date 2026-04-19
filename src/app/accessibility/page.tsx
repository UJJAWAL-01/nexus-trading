import type { Metadata } from 'next'
import LegalPage from '@/components/ui/LegalPage'

export const metadata: Metadata = {
  title: 'Accessibility — NEXUS Trading Intelligence',
}

export default function AccessibilityPage() {
  return (
    <LegalPage
      title="Accessibility Statement"
      subtitle="Our commitment to making NEXUS usable for everyone."
      lastUpdated="April 2025"
      sections={[
        {
          heading: 'Our Commitment',
          body: (
            <p>
              NEXUS Trading Intelligence is committed to ensuring digital accessibility for people with disabilities. We continually improve the user experience for everyone and apply relevant accessibility standards where feasible for a highly dynamic, data-dense trading terminal interface.
            </p>
          ),
        },
        {
          heading: 'Current Accessibility Features',
          body: (
            <>
              <p>NEXUS currently supports the following accessibility features:</p>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                <li><strong style={{ color: '#fff' }}>Keyboard navigation</strong> — core actions and panel interactions are keyboard-accessible</li>
                <li><strong style={{ color: '#fff' }}>High contrast color scheme</strong> — the terminal dark theme provides strong contrast ratios for data readability</li>
                <li><strong style={{ color: '#fff' }}>Scalable text</strong> — the viewport supports user-initiated zoom up to 500%</li>
                <li><strong style={{ color: '#fff' }}>Semantic HTML</strong> — panels and navigation use proper heading hierarchy</li>
                <li><strong style={{ color: '#fff' }}>Mobile-responsive layout</strong> — single-column stacked layout on screens narrower than 768px</li>
                <li><strong style={{ color: '#fff' }}>Reduced motion</strong> — animations are intentionally minimal throughout the interface</li>
              </ul>
            </>
          ),
        },
        {
          heading: 'Known Limitations',
          body: (
            <>
              <p>Due to the complex, interactive nature of a financial data terminal, some areas may present accessibility challenges:</p>
              <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                <li>Interactive charts (TradingView Lightweight Charts) are visual-only with limited screen reader support</li>
                <li>Draggable/resizable dashboard panels require mouse or touch interaction in desktop edit mode</li>
                <li>Heatmap panels use color coding that may be difficult for users with color vision deficiencies</li>
                <li>Real-time price updates may trigger frequent screen reader announcements</li>
              </ul>
              <p style={{ marginTop: 12 }}>
                We recognize these limitations and plan to address them in future updates.
              </p>
            </>
          ),
        },
        {
          heading: 'Feedback & Assistance',
          body: (
            <p>
              If you encounter accessibility barriers while using NEXUS, please contact us at{' '}
              <a href="mailto:nexus.trading.dev@gmail.com" style={{ color: 'var(--teal)' }}>
                nexus.trading.dev@gmail.com
              </a>{' '}
              with the subject line "Accessibility". Describe the barrier you encountered, your assistive technology (if any), and the section of the application affected. We will make every reasonable effort to provide you with accessible alternatives or address the issue.
            </p>
          ),
        },
        {
          heading: 'Technical Standards',
          body: (
            <p>
              NEXUS targets conformance with WCAG 2.1 Level AA where technically feasible given the constraints of a real-time financial data interface. We use Next.js and React, which implement ARIA roles and semantic HTML by default.
            </p>
          ),
        },
      ]}
    />
  )
}
