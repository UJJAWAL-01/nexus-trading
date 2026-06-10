'use client'

import { type ReactNode } from 'react'

// ── Panel imports ─────────────────────────────────────────────────────────────
import ChartPanel               from '@/components/panels/ChartPanel'
import SupplyChainPanel         from '@/components/panels/SupplyChainPanel'
import EarningsPanel            from '@/components/panels/EarningsPanel'
import EconomicCalendarPanel    from '@/components/panels/EconomicCalendarPanel'
import GlobalIndicesPanel       from '@/components/panels/GlobalIndicesPanel'
import IndiaMarketsPanel        from '@/components/panels/IndiaMarketsPanel'
import LiveFinanceVideoPanel    from '@/components/panels/LiveFinanceVideoPanel'
import MacroRatesPanel          from '@/components/panels/MacroRatesPanel'
import MarketClockPanel         from '@/components/panels/MarketClockPanel'
import NewsFeedPanel            from '@/components/panels/NewsFeedPanel'
import SectorHeatmapPanel       from '@/components/panels/SectorHeatmapPanel'
import SentimentPanel           from '@/components/panels/SentimentPanel'
import WatchlistPanel           from '@/components/panels/WatchlistPanel'
import CommoditiesPanel         from '@/components/panels/CommoditiesPanel'
import InsiderDealsPanel        from '@/components/panels/InsiderDealsPanel'
import IpoScreenerPanel         from '@/components/panels/IpoScreenerPanel'
import OptionsPanel             from '@/components/panels/OptionsPanel'
import FixedIncomePanel         from '@/components/panels/FixedIncomePanel'
import AlternativeDataPanel     from '@/components/panels/AlternativeDataPanel'
import SecFilingsPanel          from '@/components/panels/SecFilingsPanel'
import SmartMoneyPanel          from '@/components/panels/SmartMoneyPanel'
import StockProfilePanel        from '@/components/panels/StockProfilePanel'
import AnalystConsensusPanel    from '@/components/panels/AnalystConsensusPanel'
import EquityResearchPanel      from '@/components/panels/EquityResearchPanel'
import ScreenerPanel            from '@/components/panels/ScreenerPanel'

// ── Panel id list ─────────────────────────────────────────────────────────────

export const PANEL_IDS = [
  'livevideo', 'news', 'watchlist',
  'indices', 'mktclock', 'chart',
  'sentiment', 'calendar', 'earnings',
  'heatmap', 'indiamarkets', 'macrorates',
  'insiderdeals', 'commodities', 'supplychain',
  'options', 'ipo', 'fixedincome',
  'altdata', 'secfilings', 'smartmoney',
  // Equity research (per-stock deep dives, driven by global active symbol)
  'stockprofile', 'analystconsensus', 'equityresearch',
  // Cross-universe screening (independent of active symbol)
  'screener',
] as const

export type PanelId = (typeof PANEL_IDS)[number]

export type PanelMeta = {
  component:   ReactNode
  label:       string
  color:       string
  mobileH:     number   // px height on mobile
  description: string
}

export const PANEL_META: Record<PanelId, PanelMeta> = {
  livevideo:    { component: <LiveFinanceVideoPanel />,    label: 'LIVE TV',       color: '#ff4560',      mobileH: 420, description: '24/7 finance news streams · US + India' },
  news:         { component: <NewsFeedPanel />,            label: 'INTEL FEED',    color: 'var(--amber)', mobileH: 480, description: 'AI-powered financial news feed' },
  watchlist:    { component: <WatchlistPanel />,           label: 'WATCHLIST',     color: 'var(--amber)', mobileH: 400, description: 'Live prices + watchlist' },
  indices:      { component: <GlobalIndicesPanel />,       label: 'INDICES',       color: '#1e90ff',      mobileH: 520, description: 'US · India · Asia global indices' },
  mktclock:     { component: <MarketClockPanel />,         label: 'WORLD CLOCK',   color: '#00c97a',      mobileH: 460, description: 'Live global market hours' },
  chart:        { component: <ChartPanel />,               label: 'CHART',         color: 'var(--teal)',  mobileH: 480, description: 'Candlestick + FIB + Supertrend' },
  sentiment:    { component: <SentimentPanel />,           label: 'SENTIMENT',     color: 'var(--teal)',  mobileH: 360, description: 'Fear & Greed Index' },
  calendar:     { component: <EconomicCalendarPanel />,    label: 'ECON CALENDAR', color: '#ff4560',      mobileH: 380, description: 'FOMC · CPI · NFP · RBI' },
  earnings:     { component: <EarningsPanel />,            label: 'EARNINGS',      color: '#a78bfa',      mobileH: 440, description: 'US + India earnings calendar' },
  heatmap:      { component: <SectorHeatmapPanel />,       label: 'HEATMAP',       color: 'var(--teal)',  mobileH: 340, description: 'US sector performance' },
  indiamarkets: { component: <IndiaMarketsPanel />,        label: 'INDIA MKTS',    color: '#f97316',      mobileH: 500, description: 'NIFTY · SENSEX · FII/DII' },
  macrorates:   { component: <MacroRatesPanel />,          label: 'MACRO RATES',   color: 'var(--teal)',  mobileH: 520, description: 'FED · RBI live rates + World Bank' },
  commodities:  { component: <CommoditiesPanel />,         label: 'COMMODITIES',   color: '#f97316',      mobileH: 380, description: 'Gold · Oil · Crypto signals' },
  insiderdeals: { component: <InsiderDealsPanel />,        label: 'INSIDER DEALS', color: '#f97316',      mobileH: 380, description: 'US & India insider transactions' },
  supplychain:  { component: <SupplyChainPanel />,         label: 'SUPPLY CHAIN',  color: '#1e90ff',      mobileH: 500, description: 'Verified supplier/customer map' },
  ipo:          { component: <IpoScreenerPanel />,         label: 'IPO',           color: '#1e90ff',      mobileH: 380, description: 'Upcoming and recent IPOs' },
  options:      { component: <OptionsPanel />,             label: 'OPTIONS',       color: '#a78bfa',      mobileH: 560, description: 'BSM · IV · Greeks · OI · Max Pain' },
  fixedincome:  { component: <FixedIncomePanel />,         label: 'FIXED INCOME',  color: '#38bdf8',      mobileH: 560, description: 'India yield curve · credit spreads' },
  altdata:      { component: <AlternativeDataPanel />,     label: 'ALT DATA',      color: '#a78bfa',      mobileH: 620, description: 'Wikipedia · Reddit · Google Trends' },
  secfilings:   { component: <SecFilingsPanel />,          label: 'SEC FILINGS',   color: '#f97316',      mobileH: 540, description: '8-K · S-1 · 13D with AI summaries' },
  smartmoney:   { component: <SmartMoneyPanel />,          label: 'SMART MONEY',   color: '#a78bfa',      mobileH: 560, description: 'Top hedge funds · India MFs · consensus' },
  stockprofile: { component: <StockProfilePanel />,        label: 'STOCK PROFILE', color: '#a78bfa',      mobileH: 620, description: 'Active ticker · key stats · 52w range · margins' },
  analystconsensus: { component: <AnalystConsensusPanel />, label: 'ANALYST CONSENSUS', color: 'var(--teal)', mobileH: 540, description: 'Buy/Sell/Hold breakdown · score trend · live coverage' },
  equityresearch:   { component: <EquityResearchPanel />,    label: 'EQUITY RESEARCH',   color: '#a78bfa',     mobileH: 720, description: '5y SEC fundamentals · revenue · margins · EPS · FCF time-series' },
  screener:         { component: <ScreenerPanel />,          label: 'SCREENER',          color: '#22d3ee',     mobileH: 720, description: '7,600+ US filers · filter by sector / margin / ROE · click to focus' },
}

// Panels that mount eagerly in classic mode (above-the-fold).
// All others gated behind LazyMount + IntersectionObserver.
export const EAGER_MOUNT: Set<PanelId> = new Set([
  'livevideo', 'news', 'watchlist',
  'indices', 'mktclock', 'chart',
  'indiamarkets', 'heatmap', 'commodities',
  'earnings', 'calendar', 'insiderdeals', 'sentiment',
])
