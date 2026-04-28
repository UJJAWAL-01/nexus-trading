# Supply-chain extractor

Builds the verified supply-chain dataset shipped at `public/data/supply-chain.json`. The dataset is committed to the repo and shipped statically — **end users never run this script and never pay for AI calls**. The maintainer runs it once initially, then once per quarter to refresh.

## Cost

**Zero.** The extractor only calls free-tier APIs:

| Provider | Where to get a key | Free tier |
|---|---|---|
| Grok (xAI) | https://console.x.ai | $25/mo credits (resets monthly) |
| Gemini Flash | https://aistudio.google.com | 15 req/min |

Set either one — Grok is tried first, Gemini falls back. ~550 tickers ≈ 600 calls, well within either tier's monthly free quota.

## Setup

```bash
export GROK_API_KEY=xai-...
# or
export GEMINI_API_KEY=AIza...

# SEC EDGAR requires a contact in User-Agent
export CONTACT_EMAIL=you@example.com
```

## Usage

```bash
# inspect what would be sent (no API call)
npx tsx scripts/extract-supply-chain.ts AAPL --dry

# explicit ticker(s) to stdout
npx tsx scripts/extract-supply-chain.ts NVDA RELIANCE.NS

# explicit ticker(s) merged into the JSON file
npx tsx scripts/extract-supply-chain.ts AAPL NVDA --write

# entire NIFTY 50 (Wikipedia-based) merged
npx tsx scripts/extract-supply-chain.ts --in-all --write

# entire S&P 500 (SEC EDGAR-based) merged
npx tsx scripts/extract-supply-chain.ts --us-all --write

# full quarterly refresh
npx tsx scripts/extract-supply-chain.ts --us-all --in-all --write
```

## How it picks the source

| Region | Source | How |
|---|---|---|
| US (S&P 500) | SEC EDGAR 10-K Item 1 (Business) | Auto-resolves ticker → CIK via `company_tickers.json`, fetches latest 10-K, isolates Item 1, sends Item 1 text to AI with strict "named-counterparty + verbatim-quote" prompt. |
| India (NIFTY 50) | Wikipedia article | Looks up the ticker in `scripts/nifty50.json` to find its Wikipedia title, fetches the plain-text article via the Wikipedia API, sends it to AI with the same strict prompt. |

## Updating the ticker lists

* `scripts/sp500.txt` — one ticker per line. Edit by hand quarterly (S&P composition changes).
* `scripts/nifty50.json` — entries of `{ticker, name, wikiTitle}`. Edit when NSE rebalances NIFTY 50 (semiannually).

## Honest limits

- **Free models drift.** Grok-3-mini and Gemini-Flash are good but ~5–15% of edges will be wrong. The AI is told to refuse to guess and to cite verbatim quotes — but it still slips. Spot-check before merging large batches by running `--dry` and reading the output.
- **Wikipedia coverage of supply chains varies.** Large Indian companies (RELIANCE, TCS, MARUTI, TATAMOTORS) have substantial Wikipedia articles with named partners; smaller ones may yield few or zero edges. That's a Wikipedia coverage limit, not a script bug. For thinner companies, hand-add edges to the JSON from the company's annual report (PDF) directly.
- **10-K disclosures are limited.** US companies must name customers >10% of revenue (FASB ASC 280); below that they disclose nothing. Diversified companies (WMT, KO) often have zero named customers. Suppliers are even less commonly named. Many S&P 500 tickers will return zero edges — that's the disclosure regime, not a bug.
- **No NSE annual report parser.** Indian annual reports are PDFs on inconsistent BSE/NSE URLs. Adding a real PDF parser is a separate effort. Wikipedia is the most reliable free fallback for now.

## Refreshing

10-Ks are filed annually; Wikipedia changes continuously. Re-running quarterly picks up newer filings (`sourceDate` newer than existing → overwrites the same `(supplier, customer, category)` edge). Older edges aren't deleted — they're updated only when a newer source contradicts them.

## What gets written

`public/data/supply-chain.json` gains:
- New entries in the `companies` map (only if you also add them — the script does NOT auto-create company entries; it only adds edges for tickers already present in the map).
- Merged into `edges` (dedupe key: `supplier|customer|category`, newer `sourceDate` wins).
- `coverage.us` / `coverage.in` arrays updated.
- `generatedAt` bumped to today.

> **Important:** The script extracts edges but does not auto-add new company nodes. After running, manually add any new tickers (with `name`, `exchange`, `country`, `sector`, `industry`) to the `companies` block — otherwise the panel will show them as "Not in dataset" with a disabled link.
