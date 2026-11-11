# Contributing to NEXUS

NEXUS aims to be the best open-source alternative to a Bloomberg terminal,
because market data should not be gatekept. Contributions of every size are
welcome: bug fixes, new data providers, new panels, tests, docs.

By contributing you agree that your work is licensed under the project's
[AGPL-3.0 license](LICENSE).

## Getting started

```bash
git clone https://github.com/UJJAWAL-01/nexus-trading.git
cd nexus-trading
npm ci
cp .env.example .env.local     # keys are optional; add the ones you have
npm run dev                    # http://localhost:3000
```

Requires Node.js 20.9+. The app runs without any API key; panels whose source
needs a key show an "unavailable" state.

> **Next.js 16.** This project is on Next.js 16, which differs from older
> versions (for example, `middleware.ts` is now `proxy.ts`). Check the bundled
> docs in `node_modules/next/dist/docs/` before using a Next.js API.

## Before you open a pull request

All four must pass. CI runs the same commands.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Lint currently reports a few hundred *warnings* from older code. That is known
debt. Do not add new ones, and fixing existing ones in files you touch is
appreciated.

## Rules that keep the project safe

These are checked in review. A pull request that breaks one will not be merged.

1. **Never commit a secret.** No keys in code, tests, fixtures, docs,
   screenshots or commit messages. CI scans for them. If you leak one, rotate
   it first, then tell a maintainer.
2. **Keys are attached in exactly one place:** `src/lib/providers/keys.ts`.
   A route or component must never read a provider key from `process.env` or
   build a URL containing one. Add a helper to the vault instead.
3. **All upstream calls that use a key go through `upstreamFetch`** in
   `src/lib/providers/http.ts`, which enforces HTTPS, the host allowlist and a
   timeout. Adding a provider means adding its host there.
4. **Never return or log raw upstream errors.** Use `redact()` for anything
   logged, and return a generic message to the client.
5. **Validate every request parameter** that reaches an upstream request or a
   cache key. Use the helpers in `src/lib/providers/symbols.ts`.
6. **No secret in a `NEXT_PUBLIC_` variable**, and no direct browser calls to a
   provider that needs a key. Browser code calls `/api/*` only.
7. **Caches must be bounded.** Use `createCache` or `BoundedMap` from
   `src/lib/providers/cache.ts`, never a bare module-level `Map` keyed on input.

## Project conventions

- **Both markets.** Features should handle US symbols (`AAPL`) and Indian ones
  (`RELIANCE.NS`, `^NSEI`). If something is US-only, say so in the UI.
- **Be honest about data.** Label what is live, delayed, modelled or
  synthetic. Never show a made-up number as if it were real, and prefer an
  explicit "unavailable" state over a silent fallback.
- **CSS variables, not hex colours.** Use `var(--amber)`, `var(--positive)`
  and friends from `src/app/globals.css`.
- **Shared data goes through SWR hooks** in `src/lib/data-hooks.ts`, so two
  panels asking for the same thing make one request.
- **Deterministic first, AI second.** Detection and maths are done in code and
  tested. AI may explain results; it must not invent them.
- **Accessibility.** Buttons are `<button>`, inputs have labels, and nothing
  depends on hover alone.

## Adding a data provider

1. Add the host to `ALLOWED_HOSTS` in `src/lib/providers/http.ts`.
2. If it needs a key, add a helper in `src/lib/providers/keys.ts` (header
   authentication wherever the provider supports it) and document the variable
   in `.env.example`.
3. Implement the provider interface in `src/lib/providers/market.ts` and add it
   to the fallback chain.
4. Add tests. Tests must not call the network or need a real key.
5. Note the provider's licence and rate limits in the README's data-source table.

## Adding a panel

1. Create `src/components/panels/YourPanel.tsx` (`'use client'`, root
   `<div className="panel">` with a `.panel-header`).
2. Register it in `src/components/dashboard/panelRegistry.tsx`
   (`PANEL_IDS` and `PANEL_META`).
3. Place it in `DEFAULT_LAYOUT`, `MOBILE_ORDER` and `PANEL_GROUPS` in
   `src/components/dashboard/GridLayout.tsx`, and in a tab in
   `src/components/dashboard/TabbedDashboard.tsx`.
4. Give it loading, empty and error states (`src/components/ui/PanelStates.tsx`).

## Reporting bugs and security issues

Open a GitHub issue for bugs and feature requests. For anything
security-related, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.
