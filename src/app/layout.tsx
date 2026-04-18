import type { Metadata, Viewport } from 'next'
import './globals.css'
import Providers from './providers'

export const metadata: Metadata = {
  title: 'NEXUS - Trading Intelligence',
  description: 'Real-time trading intelligence dashboard',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
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
      </body>
    </html>
  )
}