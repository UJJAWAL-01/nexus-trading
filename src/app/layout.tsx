import type { Metadata } from 'next'
import './globals.css'
import Providers from './providers'

export const metadata: Metadata = {
  title: 'NEXUS - Trading Intelligence',
  description: 'Real-time trading intelligence dashboard',
  viewport: 'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes',
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