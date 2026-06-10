// ─── Cloudflare R2 client (S3-compatible) ─────────────────────────────────────
//
// Stores OHLCV history as Parquet files, partitioned by ticker and year:
//   ohlcv/us/AAPL/2024.parquet
//   ohlcv/us/AAPL/2023.parquet
//   ohlcv/in/RELIANCE.NS/2024.parquet
//
// Why parquet (not CSV / JSON):
//   • ~10× smaller than CSV at this cardinality
//   • Columnar — DuckDB scans only the columns we need (e.g. close + volume)
//   • DuckDB reads parquet over HTTPS directly from R2 with zero copy
//   • Standard format — easy to hand to Python/Pandas for ML later
//
// Why R2 (not S3):
//   • 10GB storage free forever (vs S3's 5GB for 12 months)
//   • Zero egress fees — critical because DuckDB will read these files often
//   • S3-compatible API — works with @aws-sdk/client-s3 as-is
//
// Falls back to a NO-OP if R2 vars are missing.

import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

const accountId = process.env.R2_ACCOUNT_ID
const accessKey = process.env.R2_ACCESS_KEY_ID
const secretKey = process.env.R2_SECRET_ACCESS_KEY
const bucket    = process.env.R2_BUCKET ?? 'nexus-ohlcv'

declare global {
  // eslint-disable-next-line no-var
  var __nexusR2: S3Client | undefined
}

function createClient(): S3Client | null {
  if (!accountId || !accessKey || !secretKey) {
    console.warn('[r2] R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY not set — OHLCV warehouse disabled')
    return null
  }
  return new S3Client({
    region:   'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     accessKey,
      secretAccessKey: secretKey,
    },
  })
}

if (!globalThis.__nexusR2) {
  const client = createClient()
  if (client) globalThis.__nexusR2 = client
}

export const r2: S3Client | null = globalThis.__nexusR2 ?? null

export const R2_BUCKET = bucket

// ── Convenience helpers ─────────────────────────────────────────────────────

export function ohlcvKey(market: 'us' | 'in', ticker: string, year: number): string {
  // S3 keys don't accept dot in path segment in a few edge tools — sanitize defensively.
  // Ticker should already be normalized (AAPL or RELIANCE.NS), but we tolerate both.
  return `ohlcv/${market}/${encodeURIComponent(ticker)}/${year}.parquet`
}

/** Read raw parquet bytes from R2.  Returns null if object missing. */
export async function getObject(key: string): Promise<Uint8Array | null> {
  if (!r2) throw new Error('[r2] client not configured')
  try {
    const r = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const stream = r.Body as ReadableStream<Uint8Array>
    if (!stream) return null
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch (e) {
    if ((e as { name?: string }).name === 'NoSuchKey') return null
    throw e
  }
}

/** Upload (or overwrite) an object — used by the OHLCV ingestion worker. */
export async function putObject(key: string, body: Uint8Array | string): Promise<void> {
  if (!r2) throw new Error('[r2] client not configured')
  await r2.send(new PutObjectCommand({
    Bucket:      bucket,
    Key:         key,
    Body:        body,
    ContentType: key.endsWith('.parquet') ? 'application/octet-stream' : 'application/json',
  }))
}

/** Enumerate keys under a prefix — used to discover which tickers/years exist. */
export async function listObjects(prefix: string): Promise<string[]> {
  if (!r2) throw new Error('[r2] client not configured')
  const r = await r2.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }))
  return (r.Contents ?? []).map(c => c.Key!).filter(Boolean)
}
