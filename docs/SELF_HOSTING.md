# Self-hosting NEXUS

NEXUS is a standard Next.js app. You can run it with Docker, with plain Node,
or on a platform such as Vercel or AWS Amplify.

## 1. Configure

```bash
cp .env.example .env.local
```

This step is optional. NEXUS runs fully on keyless public data, so you can skip
it. The few keys in the template are free tiers that need no payment method and
only add extra news and macro coverage. The file is gitignored
and is never copied into a Docker image.

If you do add keys, use your **own** and create a fresh one per deployment so
you can revoke it without affecting another. Never add a key for a provider
that can bill you; NEXUS does not support any.

## 2. Run

### Docker (recommended)

Requires Docker Compose v2.24 or newer.

```bash
docker compose up -d --build
# → http://localhost:3000
```

### Plain Node

Requires Node.js 20.9 or newer.

```bash
npm ci
npm run build
npm start            # http://localhost:3000
```

### Vercel / AWS Amplify

Import the repository and add the same variables in the platform's
environment settings. On these platforms each request may run on a different
instance, so also configure Upstash Redis and set `RATE_LIMIT_DISTRIBUTED=1`
to get rate limits and caches that hold across instances.

## 3. Put it behind a reverse proxy

Do not expose the Node server directly to the internet. Terminate TLS in a
reverse proxy (Caddy, nginx, Traefik, a cloud load balancer). The compose file
binds the app to `127.0.0.1` for this reason.

Minimal Caddy example:

```
nexus.example.com {
    reverse_proxy 127.0.0.1:3000 {
        flush_interval -1
    }
}
```

`flush_interval -1` disables response buffering so the live quote stream
(`/api/stream/quotes`, Server-Sent Events) is delivered immediately. For nginx
use `proxy_buffering off;` and `proxy_read_timeout 360s;` on that location.

### Client IP and rate limiting

Rate limits are per client IP, read from the `X-Forwarded-For` header your
proxy sets. NEXUS trusts the entry added by the proxy nearest to it and ignores
anything the client sent, controlled by:

| Setup | `TRUSTED_PROXY_HOPS` |
|---|---|
| One proxy in front of the app (default) | `1` |
| CDN → your proxy → app | `2` |

If this is too low, every visitor shares your proxy's IP and gets rate limited
together. If it is too high, a client can forge its address and bypass limits.

## 4. Verify

```bash
curl -s http://localhost:3000/api/health            # {"ok":true}
curl -s "http://localhost:3000/api/yquote?symbol=AAPL"
```

## Updating

```bash
git pull
docker compose up -d --build
```

## Data provider terms

The AGPL license covers the NEXUS code, not the data. Each provider has its own
terms of use, and some restrict redistribution or commercial use of their data.
You are responsible for complying with the terms of every provider you enable,
especially if your deployment is public.
