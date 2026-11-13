# NEXUS Trading Intelligence

**An open-source market terminal for US and Indian markets.** Charts, quotes, news, options, fundamentals, filings, macro and a portfolio tracker in one multi-panel dashboard. No account, no subscription, no API keys, no database, and no running costs.

Market data should not be gatekept. NEXUS is licensed under the [GNU AGPL-3.0](LICENSE): you can run it, study it, change it and share it, and anyone who runs a modified version as a service has to share their changes too.

![CI](https://github.com/UJJAWAL-01/nexus-trading/actions/workflows/ci.yml/badge.svg) ![License](https://img.shields.io/badge/license-AGPL--3.0-blue) ![Next.js](https://img.shields.io/badge/Next.js-16-black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

> NEXUS is for information and education only. It is not financial advice. Data can be delayed, incomplete or wrong. See [Limitations](#limitations).

---

## Quick start

Requires Node.js 20.9 or newer.

```bash
git clone https://github.com/UJJAWAL-01/nexus-trading.git
cd nexus-trading
npm ci
cp .env.example .env.local     # optional: add the keys you have
npm run dev                    # http://localhost:3000
```

That is the whole setup. NEXUS runs on public, keyless data sources, so there is nothing to sign up for and nothing to pay. A few optional free-tier keys in `.env.local` add extra news and macro coverage; none of them can bill you.

With Docker:

```bash
cp .env.example .env.local
docker compose up -d --build   # http://localhost:3000
```

Full instructions and reverse-proxy setup are in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

---

## What's in it

29 panels, arranged either as a draggable grid (**Classic**) or focused tabs (**Pro**). Click a ticker anywhere and the chart, news, options and research panels follow it.

| Area | Panels |
|---|---|
| **Markets** | Chart · Watchlist · Global Indices · Sector Heatmap · Commodities · Sentiment · World Clock |
| **Your data** | Portfolio (positions, live P&L, CSV import/export) · Portfolio Risk (volatility, beta, VaR, drawdown, correlations) |
| **News and events** | Intel Feed (AI-tagged news) · Economic Calendar · Earnings · IPO · Live TV |
| **Research** | Equity Research (10+ years of SEC fundamentals) · Screener (5,300 US filers) · Backtest · Seasonality · Pattern Scanner · Stock Profile |
| **Flows and filings** | Smart Money (13F) · Insider Deals · SEC Filings · Supply Chain · Alt Data |
| **Derivatives and rates** | Options (chain, Greeks, IV, OI, max pain) · Fixed Income · Macro Rates |
| **India** | India Markets (Nifty, Sensex, FII/DII) and `.NS` / `.BO` symbols across most panels |

Highlights:

- **Chart** with 1-minute to monthly timeframes, indicators, drawing tools, and a deterministic pattern engine (chart and candlestick patterns, composite technical rating). The analyst note is written by rules from what the engine found, so it works offline of any AI and cannot invent a pattern or a price.
- **Backtester** that runs in your browser: moving-average, RSI and breakout strategies against buy-and-hold, with trading costs and no look-ahead.
- **Screener** over every SEC filer with a ticker, filtered instantly in the browser from a static dataset rebuilt weekly from public SEC data.
- **Portfolio** with live P&L pushed over a single streaming connection. Totals are kept per currency.
- **Export everything you own.** Watchlist and portfolio export to CSV. One file backs up and restores your whole workspace (watchlist, portfolio, layouts, chart drawings).
- **Your data stays in your browser.** There are no accounts. Watchlists, positions and layouts are stored in `localStorage` and are never uploaded.
- **Honest labels.** Panels mark data as live, official, modelled or synthetic rather than passing estimates off as real.

Symbol format follows Yahoo conventions: `AAPL`, `BRK-B`, `RELIANCE.NS`, `TCS.BO`, `^NSEI`, `^GSPC`, `CL=F`, `EURUSD=X`, `BTC-USD`.

---

## Data sources

NEXUS aggregates public and free-tier sources. The license covers the NEXUS code, **not the data**: every provider has its own terms, and you are responsible for following them on your deployment.

| Source | Used for | Key |
|---|---|---|
| Yahoo Finance (unofficial endpoints) | Charts, quotes, search, India fundamentals | none |
| SEC EDGAR | US fundamentals (XBRL company facts), screener dataset, filings, 13F holdings | none |
| FRED (public CSV) | Macro rates, yields, CPI, credit spreads | none |
| Nasdaq (public calendars) | Earnings and IPO calendars | none |
| NSE / BSE India (public site endpoints) | India indices, options, deals, FII/DII | none |
| CBOE | US options chains | none |
| Wikipedia, Reddit, Hacker News | Alt-data attention signals | none |
| Finnhub (optional, free) | Company profile panel, extra news | `FINNHUB_API_KEY` |
| NewsAPI (optional, free) | Extra news coverage | `NEWS_API_KEY` |
| Alpha Vantage (optional, free) | News sentiment | `ALPHA_VANTAGE_KEY` |
| YouTube embeds | Live TV | none |
| Groq (optional, free) | One-line AI context on news headlines | `GROQ_API_KEY` |

Yahoo and NSE are unofficial integrations. They can change or rate-limit without notice; when that happens the affected panels show stale or unavailable data. Adding more providers is the most valuable contribution you can make, see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Zero cost, by rule

NEXUS is built so that running it cannot cost money on API usage or AI tokens:

- It works with **no keys**. The default experience uses only keyless public sources.
- Every optional key is a **free tier that needs no payment method**. When a limit is reached the provider stops answering; it does not bill.
- **Pay-per-use providers are not supported**, including paid AI APIs. Commentary is generated by deterministic rules; the only AI integration is Groq's free tier, and it is off unless you add a key.
- A test in CI (`src/lib/__tests__/zero-cost.test.ts`) fails the build if a billable provider host, key name or SDK is added anywhere.

The one cost NEXUS cannot control is where you host it. It runs on a laptop, a home server or a free hosting tier.

---

## Security

The server holds the provider keys, and the design keeps them there:

- Keys are read only on the server and attached to requests in one module (`src/lib/providers/keys.ts`). They are sent as headers wherever the provider allows, so they stay out of URLs and logs.
- Keyed requests can only go to an allowlist of HTTPS hosts, with timeouts and redacted errors.
- Every `/api` route sits behind one guard (`src/proxy.ts`): input validation, a block on other websites calling your API from a browser, and per-IP rate limits.
- CI scans every pull request for committed secrets and uses none itself.

Details, limits of these measures, and how to report a vulnerability: [SECURITY.md](SECURITY.md).

---

## Development

```bash
npm run dev          # start the dev server
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm test             # unit tests (Vitest)
npm run build        # production build
npm run data:screener  # rebuild the SEC screener dataset (free, ~10 min first time)
```

```
src/
├── proxy.ts                  Guard in front of every /api route
├── app/
│   ├── page.tsx              Dashboard
│   └── api/                  Server routes (the only code that talks to providers)
├── components/
│   ├── dashboard/            Grid, tabs, panel registry
│   └── panels/               One file per panel
├── lib/
│   ├── providers/            Key vault, guarded HTTP, shared cache, provider chain
│   ├── patterns/             Deterministic pattern + rating engine (tested)
│   ├── api-guard.ts          Client IP, cross-site check, parameter validation
│   └── export.ts             CSV export and workspace backup
└── store/                    Client state (watchlist, portfolio, layout)
db/redis.ts                   Optional shared cache client (in-memory by default)
scripts/                      Maintainer tooling for the static supply-chain dataset
```

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Zustand, SWR, lightweight-charts.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. It is short, and it lists the rules that keep keys safe.

---

## Limitations

- **Not real time.** Quotes come from free sources and can be delayed by 15 minutes or more. The quote stream pushes updates as the server sees them, roughly every 5 to 10 seconds; it is not a tick feed.
- **Unofficial sources can break.** See [Data sources](#data-sources).
- **India coverage is partial.** Equity Research is built on SEC filings and is US-only today.
- **Screener coverage has gaps.** It uses standard XBRL tags for one fiscal year; companies that report revenue or income under non-standard tags (some large ones included) are missing or partly blank. US filers only.
- **Stock Profile needs a free Finnhub key.** It is the one panel without a keyless source yet.
- **No accounts or sync.** Data is per browser. Use workspace backup to move it.
- **Portfolio P&L is unrealized only** and ignores fees, dividends, splits and FX.
- **Generated commentary can be wrong.** Rule-based notes and optional AI lines describe the data shown; they are not advice.

---

## License

Copyright © 2025–2026 Ujjawal Patel and contributors.

NEXUS is free software under the [GNU Affero General Public License v3.0](LICENSE). In short: you may use, modify and redistribute it, and if you let others use a modified version over a network you must offer them its source code. See [NOTICE](NOTICE).

Third-party market data, logos and trademarks belong to their owners and are not covered by this license.

Contact: [nexus.trading.dev@gmail.com](mailto:nexus.trading.dev@gmail.com)
