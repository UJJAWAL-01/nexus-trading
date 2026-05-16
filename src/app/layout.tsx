import type { Metadata, Viewport } from 'next'
import './globals.css'
import Providers from './providers'
import ServiceWorker from '@/components/dashboard/ServiceWorker'

export const metadata: Metadata = {
  title:       'NEXUS — Trading Intelligence',
  description: 'Bloomberg-style real-time trading intelligence for US and Indian markets — chart, smart money, options, news, all in one terminal.',
  applicationName: 'NEXUS',
  authors:     [{ name: 'NEXUS Trading' }],
  generator:   'Next.js',
  keywords:    ['trading', 'stocks', 'options', 'smart money', '13F', 'India markets', 'NSE', 'BSE', 'NYSE', 'NASDAQ', 'finance', 'terminal'],
  referrer:    'origin-when-cross-origin',
  // Tells iOS / Android this is a PWA capable of running standalone
  appleWebApp: {
    capable:    true,
    title:      'NEXUS',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
    email:     false,
    address:   false,
  },
  openGraph: {
    type:        'website',
    siteName:    'NEXUS',
    title:       'NEXUS — Trading Intelligence',
    description: 'Bloomberg-style real-time trading intelligence for US and Indian markets.',
  },
}

export const viewport: Viewport = {
  width:         'device-width',
  initialScale:  1,
  maximumScale:  5,
  userScalable:  true,
  viewportFit:   'cover',           // honor iOS notch / home indicator safe areas
  themeColor:    '#000000',          // matches pitch-black background
  colorScheme:   'dark',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
        <ServiceWorker />
      </body>
    </html>
  )
}
