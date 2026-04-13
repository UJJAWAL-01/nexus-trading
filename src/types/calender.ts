export type Region =
  | 'US'
  | 'IN'
  | 'EU'
  | 'UK'
  | 'JP'
  | 'CN'
  | 'AU'
  | 'CA'
  | 'OTHER'

export type Impact = 'high' | 'medium' | 'low' | 'holiday'

export type Category =
  | 'inflation'
  | 'growth'
  | 'employment'
  | 'central_bank'
  | 'trade'
  | 'manufacturing'
  | 'consumer'
  | 'other'

export interface CalEvent {
  id: string
  title: string
  country: string
  region: Region
  date: string
  time: string
  impact: Impact
  forecast: string | null
  previous: string | null
  actual: string | null
  category: Category
}