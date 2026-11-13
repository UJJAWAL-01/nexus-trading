// scripts/build-screener.ts
//
// Builds public/data/screener.json: one row of annual fundamentals for every
// SEC filer that has a ticker and reported revenue or net income. The file is
// shipped statically and filtered entirely in the browser, so the Screener
// panel needs no server, no database and no API key.
//
// Sources (all public and keyless):
//   data.sec.gov/api/xbrl/frames/…        one call returns a metric for ALL filers
//   www.sec.gov/files/company_tickers.json CIK → ticker
//   data.sec.gov/submissions/CIK….json     SIC industry code (only for new CIKs)
//
// Cost: zero. Runtime: a few seconds when the SIC map is already in the
// existing file, ~10 minutes on a first build (SEC allows 10 requests/second;
// this stays under 8).
//
// Usage:
//   npm run data:screener
//   CONTACT_EMAIL=you@example.com npm run data:screener     (SEC asks for a contact)
//
// A scheduled GitHub Action (.github/workflows/data-refresh.yml) runs this
// weekly and commits the result.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sicToSector } from '../src/lib/sec-fundamentals'
import { SCREENER_COLUMNS, type ScreenerFile, type ScreenerRow } from '../src/lib/screener'

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/screener.json')
const UA  = `NEXUS Trading Intelligence nexus-app/1.0 ${process.env.CONTACT_EMAIL ?? 'contact@nexustrading.app'}`

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function sec<T>(url: string, tries = 3): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
      if (res.status === 404) return null
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (i + 1)); continue }
      if (!res.ok) return null
      return (await res.json()) as T
    } catch { await sleep(1000 * (i + 1)) }
  }
  return null
}

interface Frame { data?: Array<{ cik: number; entityName: string; loc?: string; start?: string; end: string; val: number }> }

async function frame(tag: string, unit: string, period: string): Promise<Map<number, number>> {
  const f = await sec<Frame>(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/${unit}/${period}.json`)
  const out = new Map<number, number>()
  for (const r of f?.data ?? []) if (Number.isFinite(r.val)) out.set(r.cik, r.val)
  await sleep(150)
  return out
}

async function pickYear(): Promise<number> {
  // The latest calendar year for which most filers have reported an annual figure.
  const thisYear = new Date().getUTCFullYear()
  for (const y of [thisYear - 1, thisYear - 2]) {
    const f = await sec<Frame>(`https://data.sec.gov/api/xbrl/frames/us-gaap/NetIncomeLoss/USD/CY${y}.json`)
    if ((f?.data?.length ?? 0) > 2500) return y
    await sleep(150)
  }
  throw new Error('SEC frames returned too little data; aborting without touching the existing file.')
}

async function main() {
  const year = await pickYear()
  console.log(`Building screener for fiscal year ${year}…`)

  const A = `CY${year}`, I = `CY${year}Q4I`
  const [rev1, rev2, gross, opInc, netInc, ocf, capex, eps, assets, liab, equity] = [
    await frame('Revenues', 'USD', A),
    await frame('RevenueFromContractWithCustomerExcludingAssessedTax', 'USD', A),
    await frame('GrossProfit', 'USD', A),
    await frame('OperatingIncomeLoss', 'USD', A),
    await frame('NetIncomeLoss', 'USD', A),
    await frame('NetCashProvidedByUsedInOperatingActivities', 'USD', A),
    await frame('PaymentsToAcquirePropertyPlantAndEquipment', 'USD', A),
    await frame('EarningsPerShareDiluted', 'USD-per-shares', A),
    await frame('Assets', 'USD', I),
    await frame('Liabilities', 'USD', I),
    await frame('StockholdersEquity', 'USD', I),
  ]
  console.log(`  frames: revenue ${rev1.size}+${rev2.size}, net income ${netInc.size}, assets ${assets.size}`)

  // Names + state/country come with the frames; re-read one frame for them.
  const meta = new Map<number, { name: string; loc: string }>()
  for (const tag of ['NetIncomeLoss', 'Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax']) {
    const f = await sec<Frame>(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${A}.json`)
    for (const r of f?.data ?? []) if (!meta.has(r.cik)) meta.set(r.cik, { name: r.entityName, loc: r.loc ?? '' })
    await sleep(150)
  }

  const tickersRaw = await sec<Record<string, { cik_str: number; ticker: string; title: string }>>('https://www.sec.gov/files/company_tickers.json')
  if (!tickersRaw) throw new Error('Could not load SEC ticker list; aborting.')
  // The file is ordered by market value; the first ticker seen per CIK is the primary listing.
  const tickerOf = new Map<number, string>()
  for (const row of Object.values(tickersRaw)) if (!tickerOf.has(row.cik_str)) tickerOf.set(row.cik_str, row.ticker.toUpperCase())

  // Reuse SIC codes from the existing file so a refresh only looks up new filers.
  const knownSic = new Map<number, string>()
  if (existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, 'utf8')) as ScreenerFile
      const iCik = prev.columns.indexOf('cik'), iSic = prev.columns.indexOf('sic')
      for (const r of prev.rows) if (r[iSic]) knownSic.set(Number(r[iCik]), String(r[iSic]))
    } catch { /* rebuild from scratch */ }
  }

  const ciks = [...tickerOf.keys()].filter(c => (rev1.has(c) || rev2.has(c) || netInc.has(c)))
  const missing = ciks.filter(c => !knownSic.has(c))
  console.log(`  ${ciks.length} filers with a ticker; looking up SIC for ${missing.length} new ones…`)

  let done = 0
  for (const cik of missing) {
    const sub = await sec<{ sic?: string }>(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`)
    if (sub?.sic) knownSic.set(cik, sub.sic)
    if (++done % 250 === 0) console.log(`    ${done}/${missing.length}`)
    await sleep(130)                      // < 8 requests/second
  }

  const ratio = (a: number | undefined, b: number | undefined): number | null =>
    a === undefined || b === undefined || b === 0 ? null : Math.round((a / b) * 10000) / 10000
  const num = (n: number | undefined): number | null => (n === undefined ? null : n)

  const rows: ScreenerRow[] = []
  for (const cik of ciks) {
    const revenue = rev1.get(cik) ?? rev2.get(cik)
    const ni = netInc.get(cik), eq = equity.get(cik), as = assets.get(cik), li = liab.get(cik)
    const o = ocf.get(cik), cx = capex.get(cik)
    const sic = knownSic.get(cik) ?? ''
    const m = meta.get(cik)
    // Guard against obviously broken filings (negative or absurd revenue).
    if (revenue !== undefined && (revenue < 0 || revenue > 2e12)) continue
    rows.push([
      tickerOf.get(cik)!, m?.name ?? '', cik, sic, sicToSector(sic) ?? 'Other', (m?.loc ?? '').replace(/^US-/, ''),
      num(revenue), num(ni), num(opInc.get(cik)),
      ratio(gross.get(cik), revenue), ratio(opInc.get(cik), revenue), ratio(ni, revenue),
      eq !== undefined && eq > 0 ? ratio(ni, eq) : null,            // ROE is meaningless on negative equity
      ratio(ni, as),
      eq !== undefined && eq > 0 ? ratio(li, eq) : null,
      num(eps.get(cik)),
      o !== undefined && cx !== undefined ? o - cx : null,
      num(as), num(eq),
    ])
  }
  rows.sort((a, b) => (Number(b[6]) || 0) - (Number(a[6]) || 0))

  if (rows.length < 1500) throw new Error(`Only ${rows.length} rows built; refusing to overwrite the dataset.`)

  const file: ScreenerFile = {
    generatedAt: new Date().toISOString(),
    fiscalYear:  year,
    source:      'SEC EDGAR XBRL frames (public domain)',
    note:        'Annual figures in USD as reported by each filer for the fiscal year closest to the calendar year. Ratios are computed by NEXUS. Not adjusted, not audited by NEXUS.',
    columns:     [...SCREENER_COLUMNS],
    rows,
  }
  writeFileSync(OUT, JSON.stringify(file))
  console.log(`✓ wrote ${rows.length} companies to public/data/screener.json (${(JSON.stringify(file).length / 1024).toFixed(0)} KB)`)
}

main().catch(err => { console.error('build-screener failed:', err instanceof Error ? err.message : err); process.exit(1) })
