# Code Inspector Findings
Feature: Realization Forecast + What-If Panel + Sheets Tabs
Investigated: 2026-03-25
---

## 1. forecast/page.tsx Structure

File: C:/Users/russe/Documents/Dashboard/src/app/dashboard/forecast/page.tsx

### State variables (lines 49-65)

activeTab: ForecastTab
windowDays: 180|365|730|null
rates: TieredForecastRates|null -- flat + lower + upper from BQ
pipeline: ForecastPipelineRecord[]
summary: ForecastSummary|null
monteCarloResults: MonteCarloResponse|null
selectedOppId: string|null
modalOpen: boolean
loading: boolean
mcLoading: boolean
error: string|null
exporting: boolean
exportResult: object|null -- link to exported sheet
dateRevisions: Record<string,...>
targetAumByQuarter: Record<string,number> -- ALREADY EXISTS -- persisted SQO targets
joinedAumByQuarter: Record<string,...> -- already-closed deal AUM by quarter

### Fetch chain (lines 194-205)

fetchData() calls four parallel fetches: rates, pipeline, date-revisions, getSQOTargets().
targetAumByQuarter populated on mount. handleTargetChange (lines 278-287) auto-saves.

### Component render order in the pipeline tab (lines 335-419)

1. ForecastTopBar
2. Error banner (conditional)
3. Loading skeletons (conditional) OR:
4.   ForecastMetricCards (line 363)
     <<< REALIZATION BANNER SLOTS HERE (after line 370, before line 372) >>>
5.   ExpectedAumChart + ConversionRatesPanel (2-col grid)
6.   MonteCarloPanel (conditional on monteCarloResults)
     <<< WHAT-IF PANEL SLOTS HERE (after line 383, before line 385) >>>
7.   ScenarioRunner (conditional on canRunScenarios)
8.   SavedScenariosList
9.   PipelineDetailTable

Realization banner: after closing /> of ForecastMetricCards on line 370, before grid div on line 372.
What-if panel: after monteCarloResults conditional closes on line 383, before canRunScenarios on line 385.

### Target/goal state -- FULLY IMPLEMENTED

targetAumByQuarter state, handleTargetChange, getSQOTargets() on fetch,
saveSQOTarget() on edit, pass-through to ForecastMetricCards all present.
Phases 1-6 from sqo-target-exploration-results.md are complete.
---

## 2. ForecastMetricCards Component

File: C:/Users/russe/Documents/Dashboard/src/app/dashboard/forecast/components/ForecastMetricCards.tsx

### Props interface (lines 38-45)

  summary: SummaryShape | null
  windowDays: 180 | 365 | 730 | null
  rates: RateShape | null  (flat rates only -- rates?.flat from page.tsx)
  targetAumByQuarter: Record<string, number>
  joinedAumByQuarter: Record<string, { joined_aum: number; joined_count: number }>
  onTargetChange: (quarter: string, value: number) => void

The inline RateShape interface (lines 8-22) already includes mean_joined_aum and joined_deal_count.

### Already built in the quarter cards

- Editable Target AUM number input with debounced save and Saved flash confirmation
- Coverage progress bar (% of target covered by joined + projected AUM)
- On-track / gap detection with TrendingUp / TrendingDown icons
- Need X more SQOs to close the gap (incremental and total SQO counts)
- SQOs must enter pipeline in Q# YYYY entry quarter calculation
- Warning when entry quarter is already past
- Math breakdown: gap / expected AUM per SQO, rate product, avg velocity
- Low-confidence warning when joined_deal_count < 30

THE SQO TARGET INPUT AND SQO CALCULATOR ARE FULLY IMPLEMENTED.

### What is not yet built

ForecastMetricCards shows trailing rates in math breakdown but has no sliders.
The what-if panel will be a new component.
---

## 3. ScenarioRunner Component

File: C:/Users/russe/Documents/Dashboard/src/app/dashboard/forecast/components/ScenarioRunner.tsx

### Rate override state (lines 39-44)

useState: { sqo_to_sp, sp_to_neg, neg_to_signed, signed_to_joined }
Initialized from historical rates. Updated via useEffect when rates prop changes (lines 47-56).

### Rate change handler (lines 58-63)

handleRateChange(key, value) parses float in [0,1] and calls setOverrides.
Each field: type=number, step=0.01, min=0, max=1. No range sliders.

### DB save pattern (lines 65-98)

handleRunAndSave():
  1. Calls onRunMonteCarlo(overrides) -- triggers MC API call in page.tsx
  2. Calls dashboardApi.createScenario() saving: name, description, isPublic,
     4 rate overrides (Float), 3 avg-days overrides (from rates, NOT user-editable),
     4 historical rates snapshot, pipelineOppCount, pipelineTotalAum, quartersJson.

MC re-run is required before saving because the scenario stores quartersJson.

### Pattern for what-if panel

Same overrides state shape and handleRateChange signature.
Add meanAumOverride state for the AUM input.
Skip name/description/save/MC-run entirely.
Compute in useMemo: requiredSQOs = ceil(targetAum / (meanAumOverride * product(overrides))).
No API call needed.
---

## 4. Rates Query (forecast-rates.ts)

File: C:/Users/russe/Documents/Dashboard/src/lib/queries/forecast-rates.ts

### ForecastRates interface (lines 5-19)

  sqo_to_sp, sp_to_neg, neg_to_signed, signed_to_joined: number
  avg_days_sqo_to_sp, avg_days_in_sp, avg_days_in_neg, avg_days_in_signed: number
  window_start, window_end: string
  cohort_count: number
  mean_joined_aum: number    -- ALREADY PRESENT
  joined_deal_count: number  -- ALREADY PRESENT

### TieredForecastRates interface (lines 21-25)

  { flat: ForecastRates; lower: ForecastRates; upper: ForecastRates }

### mean_joined_aum in BQ query (lines 135-139)

SAFE_DIVIDE(SUM(aum WHERE is_joined=1 AND aum>0), COUNTIF(...)) AS mean_joined_aum.
Joined-only mean (backtest winner, MAE=16.5 SQOs).
Same RATES_SELECT block reused in tiered query so all three tiers return mean_joined_aum.
EMPTY_RATES (lines 248-251) includes mean_joined_aum: 0 and joined_deal_count: 0.

CONCLUSION: No changes required to forecast-rates.ts for the new features.
---

## 5. Export Route - Current State

File: C:/Users/russe/Documents/Dashboard/src/app/api/forecast/export/route.ts (~1100 lines)

### Tab constants (lines 19-23)

  FORECAST_TAB    = 'BQ Forecast P2'
  AUDIT_TAB       = 'BQ Audit Trail'
  MONTE_CARLO_TAB = 'BQ Monte Carlo'
  RATES_TAB       = 'BQ Rates and Days'
  SQO_TARGETS_TAB = 'BQ SQO Targets'

Five tabs defined. BQ Realization Forecast and BQ Scenario Runner do NOT exist yet.

### Tab write order (lines 1016-1083)

  writeTab(FORECAST_TAB)
  writeTab(AUDIT_TAB)
  writeTab(MONTE_CARLO_TAB)
  writeTab(RATES_TAB)
  Named ranges created via batchUpdate addNamedRange
  writeTab(SQO_TARGETS_TAB)

New tabs slot after SQO_TARGETS_TAB.

### P2 tab column count

buildP2Values headers (lines 248-262):
  Cols A-X   (1-24):  original pipeline columns
  Cols Y-AE  (25-31): duration penalty columns
  Cols AF-AH (32-34): date revision confidence columns
TOTAL: 34 columns (A through AH).

### Multi-section tab pattern (buildSQOTargetsValues lines 463-650)

  - Push header/title/blank rows into any[][] array
  - Track absolute row number via values.length + 1 for Sheets formula references
  - Return full array; writeTab clears + writes in 500-row chunks
  - Section separators: push empty array between sections
  - Row numbering: const row = values.length + 1; then values.push([...])

### Named range pattern (lines 1026-1081)

Named ranges created via batchUpdate addNamedRange after all tabs are written.
Each entry: { name, row (0-indexed), col (0-indexed) } pointing to Rates tab sheetId.

Rates tab cells can be referenced directly from Scenario Runner:
  const r = "'BQ Rates and Days'"  -- same approach as buildSQOTargetsValues line 509

### mean_joined_aum is NOT currently a named range

SQO Targets tab uses hardcoded cell value (B11) from flatRates.mean_joined_aum.
To expose as named range for Scenario Runner: add row to buildRatesAndDaysValues
and add entry to namedRanges array in POST handler (lines 1039-1056).

### Builder function signatures

Existing:
  buildP2Values(rows, dateRevisionMap): any[][]
  buildMonteCarloValues(mc): any[][]
  buildAuditValues(rows): any[][]
  buildRatesAndDaysValues(auditRowCount): any[][]
  buildSQOTargetsValues(targetAumByQuarter, flatRates, joinedByQuarter, projectedAumByQuarter): any[][]

To add:
  buildRealizationValues(p2Rows, joinedByQuarter): any[][]
  buildScenarioRunnerValues(flatRates, targetAumByQuarter): any[][]

p2Rows contain StageName, AUM, Earliest_Anticipated_Start_Date__c, projected_quarter.
buildRealizationValues can filter to Neg+Signed with future dates. No new BQ query needed.

### POST body (lines 924-926)
Accepts windowDays and targetAumByQuarter. No new body fields needed for new tabs.
---

## 6. Prisma Schema - Forecast Models

File: C:/Users/russe/Documents/Dashboard/prisma/schema.prisma

### ForecastQuarterTarget (lines 98-108) -- ALREADY EXISTS

  model ForecastQuarterTarget {
    id               String   @id @default(cuid())
    quarter          String   @unique
    targetAumDollars Float    @default(0)
    createdAt        DateTime @default(now())
    updatedAt        DateTime @updatedAt
    updatedBy        String?
    @@index([quarter])
    @@map("forecast_quarter_targets")
  }

Matches spec from sqo-target-exploration-results.md exactly.

### ForecastScenario (line 625)

Fields: id, name, description, createdAt, updatedAt, createdById, createdByName,
conversionWindowDays, isBaseForecast,
rateOverride_sqo_to_sp / sp_to_neg / neg_to_signed / signed_to_joined (Float x4),
avgDaysOverride_in_sp / neg / signed (Float x3),
historicalRate_sqo_to_sp / sp_to_neg / neg_to_signed / signed_to_joined (Float x4),
trialCount, quartersJson, pipelineOppCount, pipelineTotalAum, shareToken, isPublic.

No meanJoinedAum field. The what-if panel is pure client-side and needs no DB model.

### ForecastExport (lines 110-123)

Fields: id, spreadsheetId, spreadsheetUrl, name, createdAt, createdBy,
windowDays, p2RowCount, auditRowCount. No realization_row_count field.
---

## 7. Component Rendering Order - Exact Sequence

Lines 324-427 of page.tsx:

  [1] Title block (Title + Text)
  [2] ForecastTabs
  [3] ExportsPanel (only when activeTab === exports)
  [pipeline tab]:
  [4] ForecastTopBar
  [5] Error banner (conditional)
  [6] Loading skeletons OR:
      [7]  ForecastMetricCards  (line 363)
      >>>  REALIZATION BANNER SLOTS HERE (after line 370, before line 372)
      [8]  grid: ExpectedAumChart + ConversionRatesPanel
      [9]  MonteCarloPanel (conditional on monteCarloResults)
      >>>  WHAT-IF PANEL SLOTS HERE (after line 383, before line 385)
      [10] ScenarioRunner (conditional on canRunScenarios)
      [11] SavedScenariosList
      [12] PipelineDetailTable
  [13] AdvisorForecastModal (always mounted)
---

## 8. Already-Implemented Features - Do NOT Re-implement

ForecastQuarterTarget Prisma model -- DONE: prisma/schema.prisma lines 98-108
/api/forecast/sqo-targets GET+POST -- DONE: src/app/api/forecast/sqo-targets/route.ts
mean_joined_aum + joined_deal_count in rates query -- DONE: forecast-rates.ts lines 135-139
Target AUM input per quarter card -- DONE: ForecastMetricCards.tsx lines 234-251
Required SQOs display + entry quarter -- DONE: ForecastMetricCards.tsx lines 285-335
Low-confidence warning (N<30) -- DONE: ForecastMetricCards.tsx lines 338-343
targetAumByQuarter state in page.tsx -- DONE: page.tsx line 63
handleTargetChange + auto-save -- DONE: page.tsx lines 278-287
getSQOTargets() + saveSQOTarget() in api-client -- DONE: src/lib/api-client.ts
buildSQOTargetsValues() export function -- DONE: export/route.ts lines 463-650
BQ SQO Targets tab written in export -- DONE: export/route.ts line 1083

### What remains to be built

  1. Realization forecast banner component (Component A + B, above chart)
  2. What-if rate + AUM sliders component (client-side only, no DB)
  3. buildRealizationValues() in export/route.ts -- new BQ Realization Forecast tab
  4. buildScenarioRunnerValues() in export/route.ts -- new BQ Scenario Runner tab
  5. Query/function for Component A deals (Neg+Signed with future anticipated dates)
  6. Query/function for Component B history (last 4Q joined AUM by component)
---

## 9. Named Ranges in Rates Tab (Row Reference)

From buildRatesAndDaysValues comments (lines 693-698):
  Row 6  Col B: flat SQO to SP rate         Named range: SQO_to_SP_rate
  Row 7  Col B: flat SP to Neg rate          Named range: SP_to_Neg_rate
  Row 8  Col B: flat Neg to Signed rate      Named range: Neg_to_Signed_rate
  Row 9  Col B: flat Signed to Joined rate   Named range: Signed_to_Joined_rate
  Row 10 Col B: flat SQO to Joined product   Named range: SQO_to_Joined_rate
  Rows 14-17 Col B: Lower tier rates         Named ranges: Lower_* (4 ranges)
  Rows 22-25 Col B: Upper tier rates         Named ranges: Upper_* (4 ranges)
  Row 34 Col B: Total avg days SQO-Joined    Referenced as B34 in SQO Targets tab

mean_joined_aum is NOT a named range. To expose for Scenario Runner:
add row to buildRatesAndDaysValues and entry to namedRanges array (lines 1039-1056).
---

## 10. Key Files Reference

C:/Users/russe/Documents/Dashboard/src/app/dashboard/forecast/page.tsx
  Main page: all state variables, fetch chain, component render order

C:/Users/russe/Documents/Dashboard/src/app/dashboard/forecast/components/ForecastMetricCards.tsx
  Quarter cards with fully-built SQO target input and SQO calculator

C:/Users/russe/Documents/Dashboard/src/app/dashboard/forecast/components/ScenarioRunner.tsx
  Rate override UI + MC run + DB save pattern to follow for what-if panel

C:/Users/russe/Documents/Dashboard/src/lib/queries/forecast-rates.ts
  Rates query: already returns mean_joined_aum, joined_deal_count, and tiered rates

C:/Users/russe/Documents/Dashboard/src/app/api/forecast/export/route.ts
  Export route: 5 existing tabs, all builder function patterns

C:/Users/russe/Documents/Dashboard/src/app/api/forecast/sqo-targets/route.ts
  SQO targets GET/POST: already built, uses canRunScenarios auth

C:/Users/russe/Documents/Dashboard/prisma/schema.prisma
  ForecastQuarterTarget at line 98, ForecastScenario at line 625

C:/Users/russe/Documents/Dashboard/src/lib/api-client.ts
  getSQOTargets(), saveSQOTarget(), exportForecastToSheets() all present
