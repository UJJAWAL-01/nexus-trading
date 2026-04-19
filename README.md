# NEXUS Trading Intelligence

> ** Terminal-style market research dashboard for retail and semi-professional traders.** Real-time data, AI-driven analysis, dual US & Indian market support — all in one interface.

![Next.js](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-61dafb) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![status](https://img.shields.io/badge/status-production-brightgreen)

---

## What is NEXUS?

NEXUS is a **free, open-access** trading intelligence platform designed to give retail traders the kind of multi-panel market overview previously only available on expensive institutional terminals. It aggregates live prices, AI-generated insights, options chains, earnings data, sector flows, macro rates, news sentiment, and more — across both **US and Indian markets**.

No account required. No subscription. Open the app and start trading smarter.

---

## Feature Overview

### 18 Specialized Dashboard Panels

| Panel | What It Shows |
|-------|--------------|
| **Chart** | Candlestick chart (15-min), Heikin Ashi, Fibonacci, Pivot Points, Donchian, Ichimoku |
| **Watchlist** | Your tickers with live prices, % change, and flash-on-update |
| **Global Indices** | SPX, DJI, Nasdaq, Nifty 50, Sensex, Nikkei, Hang Seng, USD/INR, EUR/USD |
| **Market Clock** | Real-time clocks: New York · London · Mumbai with open/closed status |
| **News Feed** | AI-tagged news (Bullish/Bearish/Neutral) filtered to your watchlist. Tabs: Relevant · Markets · Macro · India |
| **Sentiment** | Fear & Greed Index, VIX, SPY RSI, distance from 50-day MA |
| **Sector Heatmap** | All 11 S&P 500 sectors color-graded; hover for top 8 component movers |
| **India Markets** | NSE/BSE indices, FII/DII flow data, top movers |
| **Earnings** | Upcoming + recent earnings, EPS estimate vs. actual, AI one-line insights |
| **Economic Calendar** | FOMC, CPI, NFP, RBI policy events with impact levels |
| **Options Chain** | Full chain for US (Yahoo/CBOE) and India (NSE). OI chart, Greeks, Max Pain |
| **Correlation** | AI picks 18–22 related instruments; runs Pearson/Spearman/rolling correlation + lead-lag |
| **Macro Rates** | US Treasury yields (2Y–30Y), Fed Funds rate, RBI Repo, World Bank rates |
| **Commodities** | WTI Oil, Gold, Natural Gas, Copper with trend signals |
| **Insider Deals** | SEC Form 4 filings (US) + NSE insider transactions (India) |
| **IPO Screener** | Recent and upcoming IPOs with sector filters and sentiment |
| **Alternative Signals** | Seasonality, day-of-week patterns, lunar cycle indicators |
| **Live Finance TV** | 24/7 embedded streams: Bloomberg TV, CNBC, Reuters, Yahoo Finance, CNBC TV18, NDTV Profit, ET Now, Zee Business |

---

## User Manual

### Getting Started in 3 Steps

1. **Open the app** — dashboard loads instantly, no login needed
2. **Add your tickers** — click **+** in the Watchlist panel:
   - US stocks: `AAPL`, `NVDA`, `TSLA`, `SPY`, `QQQ`
   - Indian stocks: `RELIANCE.NS`, `TCS.NS`, `HDFCBANK.NS`
   - Indices: `^NSEI`, `^BSESN`, `^GSPC`, `^VIX`
3. **The chart and news automatically sync** to whichever ticker you click

### Customizing Your Layout (Desktop)

1. Click **Edit Layout** (pencil icon, top-right)
2. **Drag panels** by their header to rearrange
3. **Resize panels** by dragging the bottom-right corner handle
4. Click **Save Layout** — persists in your browser across sessions
5. Click **Reset Layout** to restore defaults

On **mobile** (< 768px): panels stack in a single column. Drag-and-drop is disabled.

---

### Chart Panel

- Click tickers in the **symbol bar** at the top to switch charts
- **Search** any symbol not in your watchlist via the search box
- Toggle **overlays**: Fibonacci · Pivot Points · Donchian · Ichimoku
- Toggle **Heikin Ashi** to smooth candles and make trends clearer
- Resize or collapse the **volume pane** from the toolbar

### Options Chain

1. Select **US** or **IN** market
2. Enter or click a ticker to load the chain
3. Pick an **expiry date** from the selector
4. **Chain view**: Calls (left) and Puts (right) per strike
5. **OI Chart** tab: Open Interest bar chart, useful for finding Max Pain
6. **Greeks** toggle: Delta, Gamma, Theta, Vega computed client-side via Black-Scholes-Merton

> Greeks are approximate — computed in your browser from the live chain data.

### Correlation Panel

1. Click a ticker in your watchlist or type one in the Correlation panel
2. AI analyzes the company and identifies 18–22 related instruments:
   - **Upstream** (suppliers) · **Downstream** (customers) · **Competitors** · **ETFs** · **Macro** (commodities, FX, yields) · **Peers**
3. 90 days of price history is fetched and correlations are computed
4. Results show coefficient, relationship type, and regime-shift detection

> First load: 15–30 seconds (AI + ~20 price fetches). Results cached 2 hours.

### News Feed

- **Relevant tab**: stories about your watchlist tickers
- Each headline has an **AI sentiment badge** (Bullish / Bearish / Neutral)
- **AI context line**: one sentence on what the news means for your positions
- Click any headline to open the full article
- Auto-refreshes every 60 seconds during market hours

### Paper Trading (`/trading`)

- Set your **starting balance** in Settings
- **Log trades** with entry/exit, size, and notes
- View **P&L**, win rate, and full trade journal
- Everything stays in your browser — nothing sent to servers

---

### Supported Symbols

| Type | Examples |
|------|---------|
| US Stocks | `AAPL`, `MSFT`, `NVDA`, `TSLA`, `AMZN`, `META` |
| US ETFs | `SPY`, `QQQ`, `IWM`, `XLK`, `XLF` |
| US Indices | `^GSPC`, `^DJI`, `^IXIC`, `^VIX`, `^TNX` |
| Indian Stocks (NSE) | `RELIANCE.NS`, `TCS.NS`, `INFY.NS`, `HDFCBANK.NS` |
| Indian Stocks (BSE) | `RELIANCE.BO`, `TCS.BO` |
| Indian Indices | `^NSEI`, `^BSESN`, `^NSEBANK` |
| Commodities | `CL=F`, `GC=F`, `NG=F`, `HG=F` |
| FX | `EURUSD=X`, `GBPUSD=X`, `USDINR=X` |

---

### Data Freshness

| Data | Source | Refresh |
|------|--------|---------|
| Live quotes | Yahoo Finance | 5–8 seconds |
| Chart candles | Yahoo Finance | 10 seconds |
| Global indices | Finnhub + Yahoo | 30 seconds |
| News | Finnhub + NewsAPI | 60 seconds |
| Options chains | Yahoo / CBOE / NSE | 2 minutes |
| Earnings | Yahoo + SEC EDGAR | 5 minutes |
| Macro rates | FRED | 30 minutes |
| Correlation analysis | AI + Yahoo | Cached 2 hours |

> Polling pauses automatically when markets are closed.

---

## Developer Setup

### Prerequisites

- Node.js 18+, npm

### Install & Run

```bash
git clone https://github.com/ujjawal-patel/nexus-trading.git
cd nexus-trading
npm install
npm run dev          # http://localhost:3000
npm run build        # production build
```

### Environment Variables

Create `.env.local` in the project root:

```env
# Market Data
FINNHUB_API_KEY=        # Free: finnhub.io (60 calls/min)
NEWS_API_KEY=           # Free: newsapi.org (100 req/day)
FRED_API_KEY=           # Free: fred.stlouisfed.org
YOUTUBE_API_KEY=        # Google Cloud Console

# AI Providers (at least one required)
GROK_API_KEY=           # Free ~$25/mo: console.x.ai  ← recommended
GEMINI_API_KEY=         # Free 15 RPM: aistudio.google.com
ANTHROPIC_API_KEY=      # Paid: anthropic.com
GROQ_API_KEY=           # Free tier: console.groq.com
```

**AI Priority order**: Grok → Claude → Gemini. The system automatically uses whichever keys are present.

---

## Deployment (AWS Amplify)

1. Push repo to GitHub
2. [AWS Amplify Console](https://console.aws.amazon.com/amplify/) → **New App → Host Web App → GitHub**
3. Select repository and `main` branch
4. Amplify auto-detects Next.js — confirm build settings
5. Add environment variables under **App Settings → Environment Variables**
6. Deploy

**Build command**: `npm run build`  
**Node.js**: 18+

CloudFront (built into Amplify) respects the `s-maxage` Cache-Control headers set in all API routes — concurrent users hitting the same ticker will share a cached response, keeping Lambda invocations low.

---

## Architecture Overview

```
src/
├── app/
│   ├── page.tsx                  # Main dashboard
│   ├── trading/page.tsx          # Paper trading
│   ├── terms | privacy | legal   # Legal pages
│   ├── contact | accessibility   # Info pages
│   └── api/                      # 22 server-side API routes
│       ├── globalquote/          # Live quotes
│       ├── finnhub/              # News + quotes
│       ├── options/              # Options chains
│       ├── correlation/          # AI correlation
│       ├── ai-context/           # AI news context
│       ├── edgar/                # SEC filings
│       ├── fixed-income/         # Yield curves
│       └── ...                   # 15 more routes
├── components/
│   ├── dashboard/GridLayout.tsx  # Draggable grid
│   └── panels/                   # 18 panel components
├── lib/
│   ├── ai-provider.ts            # AI fallback chain
│   └── ratelimiter.ts            # Per-IP rate limiting
└── store/watchlist.ts            # Zustand watchlist state
```

### AI Provider Chain (`lib/ai-provider.ts`)

```
Request → Grok (xAI, free) → Claude (Anthropic, paid) → Gemini Flash (Google, free) → "unavailable"
```

All AI calls go through `callAI()` — never add provider-specific code paths in components.

---

## Known Limitations

- **Options data**: Yahoo Finance has ~15-min delay. Real-time options requires a paid data feed.
- **India options**: NSE API is session-based; may be rate-limited during high traffic.
- **NewsAPI**: Free tier limited to 100 req/day and developer-plan restrictions outside localhost.
- **AI analysis**: Free-tier rate limits apply. During peak usage, AI responses may take 15–30 seconds.
- **Charts**: 1-day history only (15-min intervals). Extended history requires Yahoo Premium.
- **Mobile**: Full feature set on desktop. Mobile shows read-only stacked layout.

---

## Legal

NEXUS is for **informational and educational purposes only**. Not financial advice. Trading involves risk. See [Terms of Service](/terms) and [Legal Disclaimer](/legal).

**Contact**: [nexus.trading.dev@gmail.com](mailto:nexus.trading.dev@gmail.com)  
**Built by**: Ujjawal (UJ) Patel  
**© 2025 Ujjawal Patel. All rights reserved.**
