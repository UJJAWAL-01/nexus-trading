// Diagnostic: dump all stored Revenue + NetIncome rows for AMZN to see
// exactly what we ingested and whether YTD pollution is real.

import { db, sql_client, sql } from '../db/client'

async function main() {
  const rows = await db.execute<{
    metric: string
    period_type: string
    fiscal_year: number
    fiscal_quarter: number | null
    fiscal_period_end: string
    value: string
    as_of: string
    accession_number: string | null
  }>(sql`
    SELECT f.metric, f.period_type, f.fiscal_year, f.fiscal_quarter,
           f.fiscal_period_end::text, f.value::text, f.as_of::text, f.accession_number
    FROM fundamentals f
    JOIN companies c ON c.id = f.company_id
    WHERE c.ticker = 'AMZN'
      AND f.metric IN ('Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'NetIncomeLoss')
    ORDER BY f.metric, f.fiscal_period_end DESC, f.as_of DESC
    LIMIT 40
  `)

  console.log(`\nRows: ${rows.length}\n`)
  console.log('METRIC                                                | PT     | FY   Q | END        | VALUE              | AS_OF      | ACCN')
  console.log('-'.repeat(160))
  for (const r of rows) {
    const v = Number(r.value)
    const fmt = Math.abs(v) >= 1e9 ? `$${(v/1e9).toFixed(2)}B` : `$${(v/1e6).toFixed(1)}M`
    console.log(
      `${r.metric.padEnd(54)} | ${r.period_type.padEnd(6)} | ${String(r.fiscal_year).padEnd(4)} ${String(r.fiscal_quarter ?? '-').padEnd(2)} | ${r.fiscal_period_end} | ${fmt.padStart(18)} | ${r.as_of} | ${r.accession_number ?? '-'}`
    )
  }
  await sql_client.end()
}

main().catch(async e => { console.error(e); try { await sql_client.end() } catch {}; process.exit(1) })
