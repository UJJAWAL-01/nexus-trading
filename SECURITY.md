# Security

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Email **nexus.trading.dev@gmail.com** with the details and steps to reproduce.
You should get a reply within a few days. Please give us reasonable time to fix
the issue before disclosing it publicly.

If you find a leaked credential in this repository or its history, report it
the same way so the key can be rotated first.

## How NEXUS protects provider API keys

NEXUS calls third-party data providers with keys that belong to whoever runs
the deployment. The design goal is that a key can only ever be used by the
server, for the specific requests the app needs.

| Layer | What it does | Where |
|---|---|---|
| Server-only keys | Keys are read from environment variables on the server. No key is ever sent to the browser. Never use a `NEXT_PUBLIC_` variable for a secret. | `.env.local` |
| Key vault | One module attaches keys to outbound requests. Routes never handle a key value. | `src/lib/providers/keys.ts` |
| Keys in headers | Finnhub, NewsAPI, Google (Gemini, YouTube), Groq, xAI and Anthropic keys are sent as request headers, so they never appear in URLs, logs or caches. FRED and Alpha Vantage only accept query-string keys; those URLs never leave the vault module. | `src/lib/providers/keys.ts` |
| Host allowlist | Keyed requests can only go to a fixed list of HTTPS hosts. User input cannot redirect a request elsewhere. | `src/lib/providers/http.ts` |
| Redacted errors | Upstream failures surface as errors that carry no URL or header. AI-provider errors are logged through `redact()`. | `src/lib/providers/http.ts` |
| No open proxy | `/api/finnhub` serves a fixed list of endpoints with validated parameters. | `src/app/api/finnhub/route.ts` |
| Input validation | Symbols, lists and free text are validated centrally before any route runs. | `src/proxy.ts`, `src/lib/api-guard.ts` |
| Cross-site block | Browsers on other websites cannot call this deployment's API. | `src/proxy.ts` |
| Rate limiting | Per-IP limits on every API route, tighter on expensive ones. | `src/proxy.ts` |
| Bounded caches | API route caches have a size cap, and concurrent identical requests share one upstream call. | `src/lib/providers/cache.ts` |
| CI | Every pull request is scanned for committed env files and key-shaped strings. CI uses no secrets. | `.github/workflows/ci.yml` |

## What these measures do not do

- **They do not stop a non-browser client** (a script) from calling your public
  API within the rate limit. Anything you host publicly can be called publicly.
- **Per-process rate limits** do not add up across instances. On serverless
  platforms set `RATE_LIMIT_DISTRIBUTED=1` with Upstash Redis configured.
- **The client IP is only as trustworthy as your proxy setup.** Set
  `TRUSTED_PROXY_HOPS` correctly and do not expose the Node server directly.
  See [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## If a key leaks

1. Revoke or rotate it in the provider's dashboard immediately. Removing it
   from the repository is not enough; assume it was copied.
2. Replace the value in your deployment's environment and redeploy.
3. Check the provider's usage page for calls you did not make.

## Operator checklist

- [ ] `.env.local` is not committed (`git ls-files | grep .env` shows only `.env.example`)
- [ ] Every key is a separate, least-privilege key created for this deployment
- [ ] Provider dashboards have usage alerts or hard spending caps where offered
- [ ] The app is behind HTTPS and a reverse proxy, with `TRUSTED_PROXY_HOPS` set
- [ ] `npm audit --omit=dev` reports no high or critical issues
