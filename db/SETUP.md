# NEXUS — Database & Infrastructure Setup (Phase 1)

This is your runbook for getting the new persistent stack online.  All services are on **free tiers** — total cost: $0/month.

If anything in this doc doesn't match what you see in the dashboards, ping me — providers tweak their onboarding regularly.

---

## TL;DR — what you'll do

1. Create a **Supabase** project, copy the pooler URL into `DATABASE_URL`
2. Create a **Cloudflare R2** bucket, copy the access keys into `R2_*`
3. Create an **Upstash Redis** database, copy the REST URL/token into `UPSTASH_*`
4. Run `npm run db:push` to create all tables
5. Confirm with `npm run db:studio`

Total time: ~20 minutes.  No code changes from you.

---

## 1. Supabase (Postgres)

### 1.1 Create the project
1. Go to [supabase.com](https://supabase.com) → **New project**
2. Name: `nexus-trading-prod` (or whatever)
3. **Region**: pick the closest to your Vercel deployment region.  If you don't know, use `East US (Ohio)` — matches Vercel's default `iad1`.
4. Database password: generate + store in 1Password / Bitwarden — you'll need it next step
5. Plan: **Free** (500MB DB, 50K monthly active users, daily backups)

Wait ~2 minutes for provisioning.

### 1.2 Get the pooled connection string
1. Project dashboard → **Settings** (gear) → **Database**
2. Scroll to **Connection string** → tab **URI**
3. Click **Transaction mode** (NOT Session mode).  This is the pooler URL on port **6543**.
4. Reveal the password and copy the full URL.  Format will be:
   ```
   postgresql://postgres.<project_ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
5. Add `?pgbouncer=true` to the end (Supabase shows this in the connection string tip).

**Put it in `.env.local`:**
```bash
DATABASE_URL=postgresql://postgres.xxxxx:YOURPW@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true
```

### 1.3 Apply the schema
```bash
npm run db:push
```

This pushes our 4 tables (`companies`, `fundamentals`, `pattern_signals`, `ingestion_runs`) directly without going through the migration generation step — fast iteration during early dev.  Once we're stable I'll switch us to versioned migrations (`db:generate` → commit → `db:migrate`).

You should see:
```
✓ Changes applied
[i] No changes detected   (if you re-run it)
```

### 1.4 Verify with Drizzle Studio
```bash
npm run db:studio
```
Opens [local.drizzle.studio](https://local.drizzle.studio) in your browser — shows all 4 tables, empty.  Great.

---

## 2. Cloudflare R2 (OHLCV warehouse)

### 2.1 Create the bucket
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**
2. If first time: enable R2 (no credit card required for the free tier, but they'll ask you to add billing info as a security measure — you won't be charged)
3. **Create bucket** → name `nexus-ohlcv` → location: `Eastern North America` (cheapest egress + closest to Vercel iad1)

### 2.2 Get the API token
1. R2 dashboard sidebar → **Manage R2 API tokens** → **Create API token**
2. Permissions: **Object Read & Write**
3. Specify bucket: select `nexus-ohlcv` (NOT account-wide)
4. TTL: leave blank (no expiry — we'll rotate manually if needed)
5. Click **Create**

You'll get **three** values shown once.  Copy all three immediately:
- Token value (this is the `R2_SECRET_ACCESS_KEY`)
- Access Key ID (this is `R2_ACCESS_KEY_ID`)
- Account ID (top-right of R2 dashboard, in your URL `dash.cloudflare.com/<ACCOUNT_ID>/r2/`)

**Put in `.env.local`:**
```bash
R2_ACCOUNT_ID=abc123def456…
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_BUCKET=nexus-ohlcv
```

---

## 3. Upstash Redis (hot cache)

### 3.1 Create the database
1. Go to [console.upstash.com](https://console.upstash.com) → **Create Database**
2. Name: `nexus-trading-cache`
3. Type: **Regional** (not Global — global is paid)
4. Region: pick same continent as your Vercel deployment (`us-east-1` if iad1)
5. Eviction: **enable** → policy `allkeys-lru` (cache, not data store)

### 3.2 Get the REST credentials
1. After creation, scroll to **REST API** tab on the database details page
2. Copy both:
   - `UPSTASH_REDIS_REST_URL` (e.g. `https://eager-mongoose-12345.upstash.io`)
   - `UPSTASH_REDIS_REST_TOKEN` (long token)

**Put in `.env.local`:**
```bash
UPSTASH_REDIS_REST_URL=https://eager-mongoose-12345.upstash.io
UPSTASH_REDIS_REST_TOKEN=…
```

> **Optional**: if you skip this step, the app falls back to in-memory caching automatically.  Per-Vercel-instance only (no cross-instance hits), but the app still works.  Set up Upstash whenever convenient.

---

## 4. Verify everything works

After all three providers are configured:

```bash
# Schema applied?
npm run db:studio   # check tables exist + are empty

# App starts cleanly?
npm run dev
```

Visit `http://localhost:3000` — should see no new warnings in the terminal.  If you see "[redis] in-memory shim" warnings, Upstash isn't configured (fine for now).  If you see "[r2] client not configured" — that's OK until we run ingestion.

---

## What's next (Phase 2)

Once you confirm Phase 1 works, I'll deliver:

1. **One-off backfill workflow** (GitHub Action) that populates `companies` from iShares IWV + Nifty 500, then pulls 10 years of fundamentals from SEC EDGAR Frames API
2. **Daily ingestion cron** that keeps fundamentals + OHLCV fresh
3. **`/api/fundamentals?ticker=AAPL`** route reading from Postgres
4. **`/api/screener`** route with filterable query interface
5. **Equity Research panel** — full company deep dive
6. **Screener panel** with the sliders

ETA per Phase 2 item: ~1 day each.

---

## Cost monitor (you'll never hit these but keep in mind)

| Service | Free tier limit | First paid tier |
|---|---|---|
| Supabase | 500MB DB, 2GB egress, 50K MAU | $25/mo Pro (8GB DB, unlimited MAU) |
| Cloudflare R2 | 10GB storage, 10M class A ops/mo | $0.015/GB/mo storage above 10GB |
| Upstash Redis | 10K req/day, 256MB | Pay-as-you-go $0.20/100K req |
| Vercel | 100GB bandwidth, 100K func/day | $20/mo Pro |

Phase 1's daily ingestion = ~1K SEC requests + ~3K OHLCV writes/day.  Both well under limits.

---

## Troubleshooting

### `error: password authentication failed`
Wrong password in `DATABASE_URL`.  Double-check by clicking "Reveal" in the Supabase connection string panel.

### `error: connection terminated unexpectedly`
You used the **direct** URL (port 5432) instead of the **pooler** URL (port 6543).  Use the pooler URL.

### Migrations create unexpected columns
Drizzle reads schema files under `db/schema/`.  Make sure you haven't accidentally committed local schema changes.

### Tables exist but are empty after ingestion runs
Check `ingestion_runs` table → `status` column.  Failed runs will have the error in `error_message`.
