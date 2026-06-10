// Re-exports all schema tables — every drizzle-kit migration + every API route
// importing the schema should pull from here, not the individual files.
//
// Convention: when adding a new table, define it in its own file under
// db/schema/ and re-export both the table and the inferred row types here.

export { companies,       type Company,       type NewCompany       } from './companies'
export { fundamentals,    type Fundamental,   type NewFundamental   } from './fundamentals'
export { patternSignals,  type PatternSignal, type NewPatternSignal } from './patternSignals'
export { ingestionRuns,   type IngestionRun,  type NewIngestionRun  } from './ingestionRuns'
