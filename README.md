# NEXUS Trading Intelligence

**An open-source market terminal for US and Indian markets.** Charts, quotes, news, options, fundamentals, filings, macro and a portfolio tracker in one multi-panel dashboard. No account, no subscription.

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

The app starts with no API keys. Charts, quotes and the pattern scanner work immediately; each key you add in `.env.local` unlocks more panels. Every provider has a free tier.

With Docker:

```bash
cp .env.example .env.local
docker compose up -d --build   # http://localhost:3000
```

Full instructions, reverse-proxy setup and the optional Postgres database are in [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

---

## What's in it

27 panels, arranged either as a draggable grid (**Classic**) or focused tabs (**Pro**). Click a ticker anywhere and the chart, news, options and research panels follow it.

| Area | Panels |
|---|---|
| **Markets** | Chart · Watchlist · Global Indices · Sector Heatmap · Commodities · Sentiment · World Clock |
| **Your data** | Portfolio (positions, live P&L, CSV import/export) |
| **News and events** | Intel Feed (AI-tagged news) · Economic Calendar · Earnings · IPO · Live TV |
| **Research** | Equity Research (5y SEC fundamentals) · Screener (7,600+ US filers) · Pattern Scanner · Stock Profile · Analyst Consensus |
| **Flows and filings** | Smart Money (13F) · Insider Deals · SEC Filings · Supply Chain · Alt Data |
| **Derivatives and rates** | Options (chain, Greeks, IV, OI, max pain) · Fixed Income · Macro Rates |
| **India** | India Markets (Nifty, Sensex, FII/DII) and `.NS` / `.BO` symbols across most panels |

Highlights:

- **Chart** with 1-minute to monthly timeframes, indicators, drawing tools, and a deterministic pattern engine (chart and candlestick patterns, composite technical rating). AI writes a note about what the engine found; it does not invent the patterns.
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
| SEC EDGAR | US fundamentals, filings, 13F holdings | none |
| NSE / BSE India (public site endpoints) | India indices, options, deals, FII/DII | none |
| CBOE | US options chains | none |
| Wikipedia, Reddit, Hacker News | Alt-data attention signals | none |
| Finnhub | Quote fallback, news, earnings, IPOs, analyst data | `FINNHUB_API_KEY` |
| FRED | Macro rates, yields, CPI | `FRED_API_KEY` |
| NewsAPI | Extra news coverage | `NEWS_API_KEY` |
| Alpha Vantage | News sentiment | `ALPHA_VANTAGE_KEY` |
| YouTube Data API | Live TV stream lookup | `YOUTUBE_API_KEY` |
| xAI, Anthropic, Google, Groq | AI summaries and notes (optional) | see `.env.example` |

Yahoo and NSE are unofficial integrations. They can change or rate-limit without notice; when that happens the affected panels show stale or unavailable data. Adding more providers is the most valuable contribution you can make, see [CONTRIBUTING.md](CONTRIBUTING.md).

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
db/                           Postgres schema for the Screener and Equity Research
scripts/                      Data ingestion (SEC fundamentals, company universe)
```

Stack: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Zustand, SWR, lightweight-charts, Drizzle ORM.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. It is short, and it lists the rules that keep keys safe.

---

## Limitations

- **Not real time.** Quotes come from free sources and can be delayed by 15 minutes or more. The quote stream pushes updates as the server sees them, roughly every 5 to 10 seconds; it is not a tick feed.
- **Unofficial sources can break.** See [Data sources](#data-sources).
- **India coverage is partial.** Equity Research and the Screener are built on SEC filings and are US-only today.
- **Screener and Equity Research need a database.** They require Postgres and an ingestion run ([db/SETUP.md](db/SETUP.md)). Without it they report "not configured" and the rest of the app works.
- **No accounts or sync.** Data is per browser. Use workspace backup to move it.
- **Portfolio P&L is unrealized only** and ignores fees, dividends, splits and FX.
- **AI output can be wrong.** It is generated text about the data shown, not advice.

---

## License

Copyright © 2025–2026 Ujjawal Patel and contributors.

NEXUS is free software under the [GNU Affero General Public License v3.0](LICENSE). In short: you may use, modify and redistribute it, and if you let others use a modified version over a network you must offer them its source code. See [NOTICE](NOTICE).

Third-party market data, logos and trademarks belong to their owners and are not covered by this license.

Contact: [nexus.trading.dev@gmail.com](mailto:nexus.trading.dev@gmail.com)
