import type { Metadata } from 'next'
import TradingApp from '@/components/trading/TradingApp'

export const metadata: Metadata = {
  title: 'NEXUS — Forex & Crypto Trading Suite',
  description: 'Risk calculator, live dashboard, trade journal, analytics, economic calendar, correlation matrix, prop firm mode',
}

export default function TradingPage() {
  return <TradingApp />
}
