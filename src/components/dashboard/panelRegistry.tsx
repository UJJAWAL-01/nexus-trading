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
import EquityResearchPanel      from '@/components/panels/EquityResearchPanel'
import PatternScreenerPanel     from '@/components/panels/PatternScreenerPanel'
import PortfolioPanel           from '@/components/panels/PortfolioPanel'
import ScreenerPanel            from '@/components/panels/ScreenerPanel'
import BacktestPanel            from '@/components/panels/BacktestPanel'
import RiskPanel                from '@/components/panels/RiskPanel'
import SeasonalityPanel         from '@/components/panels/SeasonalityPanel'
import AlertsPanel              from '@/components/panels/AlertsPanel'
import RotationPanel            from '@/components/panels/RotationPanel'
import StrategyPanel            from '@/components/panels/StrategyPanel'
import PositioningPanel         from '@/components/panels/PositioningPanel'
import VolatilityPanel          from '@/components/panels/VolatilityPanel'

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
  'stockprofile', 'equityresearch',
  // Cross-universe screening (independent of active symbol)
  'patternscanner',
  // User data (stored in this browser only)
  'portfolio',
  // Offline analytics (computed in the browser, no server or key)
  'screener', 'backtest', 'risk', 'seasonality',
  'alerts', 'rotation', 'strategy', 'positioning', 'volatility',
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
  equityresearch:   { component: <EquityResearchPanel />,    label: 'EQUITY RESEARCH',   color: '#a78bfa',     mobileH: 720, description: '5y SEC fundamentals · revenue · margins · EPS · FCF time-series' },
  portfolio:        { component: <PortfolioPanel />,         label: 'PORTFOLIO',         color: 'var(--amber)', mobileH: 520, description: 'Positions · live P&L · CSV import/export · stored in your browser' },
  screener:         { component: <ScreenerPanel />,          label: 'SCREENER',          color: 'var(--teal)',  mobileH: 640, description: 'Filter every SEC filer by revenue, margins, ROE, cash flow · runs in your browser' },
  backtest:         { component: <BacktestPanel />,          label: 'BACKTEST',          color: 'var(--amber)', mobileH: 680, description: 'Test MA-cross, RSI and breakout strategies vs buy-and-hold · runs in your browser' },
  risk:             { component: <RiskPanel />,              label: 'PORTFOLIO RISK',    color: 'var(--negative)', mobileH: 640, description: 'Volatility · beta · value-at-risk · drawdown · correlations · runs in your browser' },
  seasonality:      { component: <SeasonalityPanel />,       label: 'SEASONALITY',       color: 'var(--teal)',  mobileH: 560, description: 'Average return and win rate by calendar month, with sample sizes' },
  alerts:           { component: <AlertsPanel />,            label: 'PRICE ALERTS',      color: 'var(--amber)', mobileH: 520, description: 'Price-level and daily-move alerts with desktop notifications · stored in your browser' },
  rotation:         { component: <RotationPanel />,          label: 'ROTATION',          color: 'var(--teal)',  mobileH: 680, description: 'Which sectors lead or lag the index, and whether the lead is growing or fading' },
  strategy:         { component: <StrategyPanel />,          label: 'OPTIONS STRATEGY',  color: '#a78bfa',      mobileH: 720, description: 'Payoff diagram · break-evens · max profit and loss · probability of profit' },
  positioning:      { component: <PositioningPanel />,       label: 'POSITIONING',       color: 'var(--teal)',  mobileH: 640, description: 'Futures positioning of large speculators (CFTC) · daily short-sale volume (FINRA)' },
  volatility:       { component: <VolatilityPanel />,        label: 'VOLATILITY',        color: '#a78bfa',      mobileH: 720, description: 'Implied volatility by expiry and by strike · the move the options market is pricing' },
  patternscanner:   { component: <PatternScreenerPanel />,   label: 'PATTERN SCANNER',   color: '#00e5c0',     mobileH: 720, description: 'Scan US + India for chart & candlestick patterns · click to chart' },
}

// Panels that mount eagerly in classic mode (above-the-fold).
// All others gated behind LazyMount + IntersectionObserver.
export const EAGER_MOUNT: Set<PanelId> = new Set([
  'livevideo', 'news', 'watchlist',
  'indices', 'mktclock', 'chart',
  'indiamarkets', 'heatmap', 'commodities',
  'earnings', 'calendar', 'insiderdeals', 'sentiment',
])
