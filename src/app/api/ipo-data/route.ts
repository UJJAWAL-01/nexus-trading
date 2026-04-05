import { NextRequest, NextResponse } from 'next/server'

interface IPOData {
  ticker: string
  company: string
  industry: string
  ipoDate: string
  priceRange: string
  shares: string
  rating: 'bullish' | 'neutral' | 'bearish'
  status: 'upcoming' | 'recent'
  prospectusUrl?: string
  underwriter?: string
  marketCap?: string
}

// Mock IPO data - replace with real API data later
const mockIPOs: IPOData[] = [
  {
    ticker: 'NVIO',
    company: 'Nvidia Ventures Inc.',
    industry: 'Technology',
    ipoDate: '2024-04-15',
    priceRange: '$18 - $22',
    shares: '15M',
    rating: 'bullish',
    status: 'upcoming',
    underwriter: 'Goldman Sachs',
    marketCap: '$330M - $402M',
  },
  {
    ticker: 'SKYB',
    company: 'SkyBridge Analytics',
    industry: 'Software',
    ipoDate: '2024-04-08',
    priceRange: '$24 - $28',
    shares: '8.5M',
    rating: 'bullish',
    status: 'recent',
    underwriter: 'Morgan Stanley',
    marketCap: '$204M - $238M',
  },
  {
    ticker: 'QUANT',
    company: 'Quantum Insight Labs',
    industry: 'Technology',
    ipoDate: '2024-03-28',
    priceRange: '$32 - $36',
    shares: '12M',
    rating: 'neutral',
    status: 'recent',
    underwriter: 'JP Morgan',
    marketCap: '$384M - $432M',
  },
  {
    ticker: 'HEALX',
    company: 'HealthX Medical Systems',
    industry: 'Healthcare',
    ipoDate: '2024-04-22',
    priceRange: '$20 - $25',
    shares: '10M',
    rating: 'bullish',
    status: 'upcoming',
    underwriter: 'Citigroup',
    marketCap: '$200M - $250M',
  },
  {
    ticker: 'ECOEF',
    company: 'EcoDynamics',
    industry: 'Energy',
    ipoDate: '2024-05-05',
    priceRange: '$28 - $32',
    shares: '9M',
    rating: 'neutral',
    status: 'upcoming',
    underwriter: 'Bank of America',
    marketCap: '$252M - $288M',
  },
  {
    ticker: 'FINTECH',
    company: 'PayFlow Solutions',
    industry: 'Fintech',
    ipoDate: '2024-04-01',
    priceRange: '$35 - $42',
    shares: '7M',
    rating: 'bullish',
    status: 'recent',
    underwriter: 'Goldman Sachs',
    marketCap: '$245M - $294M',
  },
  {
    ticker: 'BIOTECH',
    company: 'GenePrecision Biotech',
    industry: 'Biotechnology',
    ipoDate: '2024-04-30',
    priceRange: '$16 - $20',
    shares: '6.5M',
    rating: 'bearish',
    status: 'upcoming',
    underwriter: 'Canaccord Genuity',
    marketCap: '$104M - $130M',
  },
  {
    ticker: 'CLOUD9',
    company: 'CloudScale Infrastructure',
    industry: 'Cloud Services',
    ipoDate: '2024-03-20',
    priceRange: '$38 - $45',
    shares: '11M',
    rating: 'bullish',
    status: 'recent',
    underwriter: 'Morgan Stanley',
    marketCap: '$418M - $495M',
  },
]

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') as 'upcoming' | 'recent' | null
  const industry = searchParams.get('industry') as string | null
  const rating = searchParams.get('rating') as 'bullish' | 'neutral' | 'bearish' | null

  let filtered = [...mockIPOs]

  if (status) {
    filtered = filtered.filter(ipo => ipo.status === status)
  }

  if (industry) {
    filtered = filtered.filter(ipo => ipo.industry.toLowerCase().includes(industry.toLowerCase()))
  }

  if (rating) {
    filtered = filtered.filter(ipo => ipo.rating === rating)
  }

  // Sort by date (most recent first)
  filtered.sort((a, b) => new Date(b.ipoDate).getTime() - new Date(a.ipoDate).getTime())

  return NextResponse.json(
    { ipos: filtered, total: filtered.length, lastUpdated: new Date().toISOString() },
    { headers: { 'Cache-Control': 'public, s-maxage=300' } }
  )
}
