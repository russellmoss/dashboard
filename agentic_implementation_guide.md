# Agentic Implementation Guide: Forecasting Module

## Reference Document
All decisions in this guide are based on the completed exploration files:
- `exploration-results.md` (synthesized findings — primary source of truth)
- `code-inspector-findings.md` (exact line numbers, code patterns)
- `data-verifier-findings.md` (BQ schema, data quality, edge cases)
- `pattern-finder-findings.md` (conventions to follow)
- `forecast_sheet_exploration.md` (updated sheet structure, formula patterns, data alignment validation)

Human-verified decisions from Appendix C of `forecasting_exploration.md` override all other assumptions.

The exploration confirmed the following sheet structure: 26 sub-sources across 7 Finance_View channels,
3-tier rollup (detail sections → channel summary → total), monthly-first waterfall calculations,
and SGA-based Created volumes for Outbound. See Phase 8 of the exploration for the canonical reference tables.

## Feature Summary

| Capability | Source | Notes |
|-----------|--------|-------|
| Source-first forecasting | Neon DB (Prisma) + BQ `vw_funnel_master` | Sources (`Original_source`) are the atomic unit; channels (`Finance_View__c`) are computed rollups |
| Auto-populated conversion rates | BQ trailing 90-day resolved-only actuals | 5 transitions: Created→Contacted→MQL→SQL→SQO→Joined |
| Lock/unlock per cell | Neon `ForecastOverride` model | Unlocked = auto-update from live data; locked = manual override with annotation |
| Waterfall volume calculations | Computed in app — monthly-first | Monthly: Created × rate chain. Quarterly = SUM(3 months). Rates are per-month, not per-quarter. |
| Forecast vs. actuals side-by-side | BQ `vw_funnel_master` for actuals | Updated daily via existing data transfer |
| Targets & gap tracking | Neon `ForecastTarget` model | Forecast (expected) vs. finance minimum (needed) vs. gap filler (stretch) |
| Full change tracking | Neon `ForecastOverride` model | Every override logged with user, timestamp, reason |
| Google Sheets export | Sheets API via Apps Script template | Read-only snapshot with live waterfall formulas |
| BQ sync (Neon → BQ) | Native BQ table `forecast_data` | `Total_*` + `Cohort_source` rows for `vw_daily_forecast` |

## Canonical Source Taxonomy (from exploration Phase 8.1)

26 sub-sources across 7 Finance_View channels. Dashboard must support all ACTIVE and NEW sources;
PLACEHOLDER sources should be available but hidden by default.

| # | Finance_View | Sub-Source | Status | BQ Original_source | Notes |
|---|-------------|-----------|--------|-------------------|-------|
| 1 | Outbound | Provided List (Lead Scoring) | ACTIVE | Provided List (Lead Scoring) | SGA-based: 200/SGA |
| 2 | Outbound | LinkedIn (Self Sourced) | ACTIVE | LinkedIn (Self Sourced) | SGA-based: 200/SGA |
| 3 | Outbound | Fintrx (Self-Sourced) | NEW | Fintrx (Self-Sourced) | SGA-based: 80/SGA. Rates seeded from LinkedIn SS. |
| 4 | Marketing | Direct Traffic | ACTIVE | Direct Traffic | Sheet has duplicate section — use 2nd (row 253) |
| 5 | Marketing | Google Ads + LinkedIn Ads | ACTIVE | ["Google Ads", "LinkedIn Ads"] | Combined — needs bqSourceMapping |
| 6 | Marketing | Job Applications | ACTIVE | Job Applications | |
| 7 | Outbound + Marketing | Events | ACTIVE | Events | |
| 8 | Outbound + Marketing | Provided List (Marketing) | ACTIVE | Provided List (Marketing) | |
| 9 | Re-Engagement | Re-Engagement | ACTIVE | Re-Engagement | Non-standard funnel: monthly rates ≠ quarterly |
| 10 | Partnerships | Recruitment Firm | ACTIVE | Recruitment Firm | High conversion rates (>90% at some stages) |
| 11 | Advisor Referrals | Advisor Referral | ACTIVE | Advisor Referral | Very small volumes |
| 12 | Other | Other | ACTIVE | Other | |
| 13-26 | Various | Blog, Search, LinkedIn Savvy, etc. | PLACEHOLDER | Various/N/A | Zero forecast, kept as future channel slots |

**BQ sources NOT in sheet:** Employee Referral (Partnerships), Partnerships (Partnerships) — tracked in BQ but no forecast section.
**Sheet has duplicate Direct Traffic:** Row 227 (superseded, no forecast) and row 253 (active). Dashboard enforces uniqueness.

## Architecture Rules
- Never use string interpolation in BigQuery queries — always `@paramName` syntax
- All BQ queries target views/tables via constants in `src/config/constants.ts`
- Use `toString()`/`toNumber()` helpers from `src/types/bigquery-raw.ts` for type-safe transforms
- Use centralized `extractDateValue()` for date fields — do NOT add another copy
- All new BQ query functions MUST use `cachedQuery` wrapper (anti-pattern: `forecast.ts` has no caching)
- Prisma queries are NEVER cached
- Do not modify API routes unless they transform data (most are pass-through)
- Source-first architecture: no hardcoded channel taxonomy, no `new_mapping` dependency, no CASE WHEN overrides
- Historical conversion rates MUST be pulled from `vw_channel_conversion_rates_pivoted` directly —
  do NOT derive rates from volume ratios in `vw_channel_funnel_volume_by_month`.
  The rate view uses cohorted attribution methodology that produces different values than simple division.
  (Exploration Phase 6.2: LinkedIn SS Q4 2025 rate=94.49% vs volume ratio=89.6%)

## Pre-Flight Checklist

```bash
npm run build 2>&1 | head -50
```

If pre-existing errors, **STOP AND REPORT**. Do not proceed with a broken baseline.

---

# PHASE 1: Resolve Blockers

## Context
Three blockers were identified during exploration. Two are resolved (Russell creates native BQ table). One requires a code fix.

## Step 1.1: Verify native BQ table exists
**Action**: Ask user to confirm `savvy-gtm-analytics.SavvyGTMData.forecast_data` native table is created, backfilled, and `vw_daily_forecast` FROM clause updated to point to it.

**STOP AND REPORT if not ready** — Phases 11-12 depend on this.

## Step 1.2: Fix `converted_date_raw` DATE→TIMESTAMP cast
**File**: All new query files created in Phase 4 must use `TIMESTAMP(v.converted_date_raw)` instead of bare `v.converted_date_raw` in any TIMESTAMP comparison. This is documented here as a standing rule — the actual queries are written in Phase 4.

## PHASE 1 — VALIDATION GATE

No code changes yet. Confirm blockers are resolved.

**STOP AND REPORT**: Tell the user:
- "Blocker status confirmed"
- "Ready to proceed to Phase 2?"

---

# PHASE 2: Database (Prisma Schema + Migration)

## Context
Add 8 new models and 3 enums to the Prisma schema. Write a manual migration SQL file. The `ForecastSource` model is the source-first atomic unit.

## Step 2.1: Add enums to `prisma/schema.prisma`
**File**: `prisma/schema.prisma` (append after line 200, after existing enums)

```prisma
// =============================================================================
// FORECASTING MODULE
// Source-first quarterly forecasting with lock/unlock overrides
// =============================================================================

enum ForecastStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

enum FunnelStage {
  CREATED
  CONTACTED
  MQL
  SQL
  SQO
  JOINED
}

enum StageTransition {
  CREATED_TO_CONTACTED
  CONTACTED_TO_MQL
  MQL_TO_SQL
  SQL_TO_SQO
  SQO_TO_JOINED
}
```

## Step 2.2: Add Forecast model
**File**: `prisma/schema.prisma` (append after enums)

```prisma
model Forecast {
  id        String         @id @default(cuid())
  quarter   String         // "2026-Q2" format
  year      Int
  status    ForecastStatus @default(DRAFT)
  notes     String?        @db.Text
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
  createdBy String?        // Email of creator
  updatedBy String?        // Email of last updater

  // Relations
  sources     ForecastSource[]
  lineItems   ForecastLineItem[]
  rateItems   ForecastRateItem[]
  assumptions ForecastAssumption[]
  targets     ForecastTarget[]

  @@unique([quarter])
  @@index([quarter])
  @@index([status])
}
```

## Step 2.3: Add ForecastSource model
**File**: `prisma/schema.prisma` (append after Forecast)

```prisma
// bqSourceMapping handles combined sub-sources (e.g., "Google Ads + LinkedIn Ads" maps to
// ["Google Ads", "LinkedIn Ads"] in BQ). When empty, subSource is used directly as the BQ key.
model ForecastSource {
  id              String   @id @default(cuid())
  forecastId      String
  forecast        Forecast @relation(fields: [forecastId], references: [id], onDelete: Cascade)
  subSource       String   // Original_source from BQ (e.g., "Provided Lead List")
  channel         String   // Finance_View__c from BQ (e.g., "Outbound")
  isActive        Boolean  @default(true)
  isManual        Boolean  @default(false) // true = user-added, not from BQ discovery
  bqSourceMapping String[] @default([]) // BQ Original_source values this maps to (e.g., ["Google Ads", "LinkedIn Ads"] for combined sources). Empty = subSource is the BQ key.
  sortOrder       Int      @default(0)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([forecastId, subSource])
  @@index([forecastId])
  @@index([channel])
}
```

## Step 2.4: Add ForecastLineItem model
**File**: `prisma/schema.prisma`

```prisma
model ForecastLineItem {
  id               String      @id @default(cuid())
  forecastId       String
  forecast         Forecast    @relation(fields: [forecastId], references: [id], onDelete: Cascade)
  channel          String      // Finance_View__c (copied from ForecastSource for query convenience)
  subSource        String      // Original_source
  month            String      // "2026-04" format
  stage            FunnelStage
  calculatedVolume Int         @default(0) // Waterfall-computed volume
  finalVolume      Int         @default(0) // = calculatedVolume unless overridden
  isLocked         Boolean     @default(false)
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  // Relations
  overrides ForecastOverride[]

  @@unique([forecastId, subSource, month, stage])
  @@index([forecastId])
  @@index([channel])
  @@index([subSource])
  @@index([month])
}
```

## Step 2.5: Add ForecastRateItem model
**File**: `prisma/schema.prisma`

```prisma
model ForecastRateItem {
  id             String          @id @default(cuid())
  forecastId     String
  forecast       Forecast        @relation(fields: [forecastId], references: [id], onDelete: Cascade)
  channel        String          // Finance_View__c
  subSource      String          // Original_source
  month          String          // "2026-04" format
  transition     StageTransition
  calculatedRate Float           @default(0) // From BQ trailing 90-day resolved
  finalRate      Float           @default(0) // = calculatedRate unless overridden
  isLocked       Boolean         @default(false)
  rateSource     String          @default("calculated") // "calculated" | "manual" | "business_assumption"
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  // Relations
  overrides ForecastOverride[]

  @@unique([forecastId, subSource, month, transition])
  @@index([forecastId])
  @@index([channel])
  @@index([subSource])
}
```

## Step 2.6: Add ForecastOverride model
**File**: `prisma/schema.prisma`

```prisma
model ForecastOverride {
  id            String            @id @default(cuid())
  lineItemId    String?
  lineItem      ForecastLineItem? @relation(fields: [lineItemId], references: [id], onDelete: Cascade)
  rateItemId    String?
  rateItem      ForecastRateItem? @relation(fields: [rateItemId], references: [id], onDelete: Cascade)
  fieldType     String            // "volume" | "rate"
  originalValue Float
  overrideValue Float
  reason        String            @db.Text // Required annotation
  overriddenBy  String            // Email of user
  createdAt     DateTime          @default(now())

  @@index([lineItemId])
  @@index([rateItemId])
  @@index([overriddenBy])
  @@index([createdAt])
}
```

## Step 2.7: Add ForecastAssumption model
**File**: `prisma/schema.prisma`

```prisma
// Standard assumption keys for Outbound:
//   "sga_count" — channel=Outbound, month="2026-04", value="14.5"
//   "sourcing_rate_per_sga" — channel=Outbound, subSource="Fintrx (Self-Sourced)", value="80"
//   "sourcing_rate_per_sga" — channel=Outbound, subSource="Provided List (Lead Scoring)", value="200"
//   "person_overlay" — channel=Outbound, subSource=NULL, month="2026-04", value="0.5" (e.g., Lauren partial allocation)
// SGA counts are shared across all Outbound sub-sources for a given month.
// Created volume = sourcing_rate_per_sga × (sga_count + person_overlay) for that month.
// Standard assumption keys for global:
//   "sqo_to_joined_override" — channel=NULL, value="0.15"
model ForecastAssumption {
  id              String   @id @default(cuid())
  forecastId      String
  forecast        Forecast @relation(fields: [forecastId], references: [id], onDelete: Cascade)
  channel         String?  // NULL = global assumption
  subSource       String?  // NULL = channel-level or global
  month           String?  // NULL = quarter-level
  assumptionKey   String   // "sga_count" | "lead_list_size" | "sourcing_rate_per_sga" | "person_overlay" | "sqo_to_joined_override" | "rate_seed_from" | custom
  assumptionValue String   // String-encoded value
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  updatedBy       String?

  @@unique([forecastId, channel, subSource, month, assumptionKey])
  @@index([forecastId])
}
```

## Step 2.8: Add ForecastTarget model
**File**: `prisma/schema.prisma`

```prisma
model ForecastTarget {
  id                   String   @id @default(cuid())
  forecastId           String
  forecast             Forecast @relation(fields: [forecastId], references: [id], onDelete: Cascade)
  channel              String   // Finance_View__c channel
  month                String   // "2026-04" format
  stage                FunnelStage
  minimumForecast      Int      @default(0) // What we expect
  financeMinimum       Int      @default(0) // What we need
  gapFillerAllocation  Int      @default(0) // Stretch allocation
  comments             String?  @db.Text
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  updatedBy            String?

  @@unique([forecastId, channel, month, stage])
  @@index([forecastId])
  @@index([channel])
}
```

## Step 2.9: Write migration SQL
**File**: `prisma/migrations/manual_forecasting_models_migration.sql` (new file)

Write a CREATE TABLE + CREATE UNIQUE INDEX + CREATE INDEX SQL file matching all 8 models above. Use the same naming conventions as existing migrations: table names are PascalCase matching model names, columns are camelCase in quotes.

Key rules:
- `id` TEXT PRIMARY KEY DEFAULT gen_random_uuid() — BUT since Prisma uses CUID, use TEXT with no DB default (app generates CUIDs)
- Actually, match existing migration pattern: `id TEXT NOT NULL` (Prisma generates CUIDs at app layer)
- All `DateTime` → `TIMESTAMP(3)`, `@db.Date` → `DATE`, `@db.Text` → `TEXT`
- `Int` → `INTEGER`, `Float` → `DOUBLE PRECISION`, `Boolean` → `BOOLEAN`
- Enum columns → `TEXT` with CHECK constraints matching enum values
- Foreign keys with `ON DELETE CASCADE`

**Important**: This file is applied manually in Neon SQL editor, NOT via `prisma migrate dev`.

## Step 2.10: Apply migration and generate client
```bash
# After Russell applies SQL in Neon:
npx prisma generate
npm run gen:models
```

## PHASE 2 — VALIDATION GATE

```bash
npx prisma validate
npx prisma generate 2>&1 | tail -5
```

**Expected**: `prisma validate` passes. `prisma generate` succeeds with no errors.

**STOP AND REPORT**: Tell the user:
- "8 forecast models + 3 enums added to Prisma schema"
- "Migration SQL written to `prisma/migrations/manual_forecasting_models_migration.sql`"
- "Apply the migration in Neon SQL editor, then confirm ready for Phase 3"
- "Ready to proceed to Phase 3?"

---

# PHASE 3: TypeScript Types

## Context
Create forecast-specific types and add raw BQ result interfaces. This phase produces NO build errors (types aren't consumed yet).

## Step 3.1: Create `src/types/forecast.ts`
**File**: `src/types/forecast.ts` (new file)

Define all forecast types. Key types:

```typescript
// Re-export Prisma enums for client-side use (Prisma types only available server-side)
export type ForecastStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
export type FunnelStage = 'CREATED' | 'CONTACTED' | 'MQL' | 'SQL' | 'SQO' | 'JOINED';
export type StageTransition =
  | 'CREATED_TO_CONTACTED'
  | 'CONTACTED_TO_MQL'
  | 'MQL_TO_SQL'
  | 'SQL_TO_SQO'
  | 'SQO_TO_JOINED';

// API response types
export interface ForecastSummary {
  id: string;
  quarter: string;
  year: number;
  status: ForecastStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface ForecastSourceItem {
  id: string;
  forecastId: string;
  subSource: string;
  channel: string;
  isActive: boolean;
  isManual: boolean;
  bqSourceMapping: string[]; // BQ Original_source values for combined sources; empty = use subSource
  sortOrder: number;
}

export interface ForecastLineItemData {
  id: string;
  channel: string;
  subSource: string;
  month: string;
  stage: FunnelStage;
  calculatedVolume: number;
  finalVolume: number;
  isLocked: boolean;
}

export interface ForecastRateItemData {
  id: string;
  channel: string;
  subSource: string;
  month: string;
  transition: StageTransition;
  calculatedRate: number;
  finalRate: number;
  isLocked: boolean;
  rateSource: string;
}

export interface ForecastOverrideData {
  id: string;
  lineItemId: string | null;
  rateItemId: string | null;
  fieldType: string;
  originalValue: number;
  overrideValue: number;
  reason: string;
  overriddenBy: string;
  createdAt: string;
}

export interface ForecastAssumptionData {
  id: string;
  channel: string | null;
  subSource: string | null;
  month: string | null;
  assumptionKey: string;
  assumptionValue: string;
}

export interface ForecastTargetData {
  id: string;
  channel: string;
  month: string;
  stage: FunnelStage;
  minimumForecast: number;
  financeMinimum: number;
  gapFillerAllocation: number;
  comments: string | null;
}

// Waterfall computation types
export interface WaterfallRow {
  subSource: string;
  channel: string;
  month: string;
  created: number;
  contactedRate: number;
  contacted: number;
  mqlRate: number;
  mqls: number;
  sqlRate: number;
  sqls: number;
  sqoRate: number;
  sqos: number;
  joinedRate: number;
  joined: number;
}

// BQ source discovery result
export interface DiscoveredSource {
  originalSource: string;
  financeViewC: string;
  recordCount: number;
  lastActivity: string;
}

// Actuals from BQ
export interface ForecastActuals {
  channel: string;
  subSource: string;
  month: string;
  stage: string;
  actualVolume: number;
}

// Sheets export data package
export interface ForecastExportData {
  forecast: ForecastSummary;
  sources: ForecastSourceItem[];
  lineItems: ForecastLineItemData[];
  rateItems: ForecastRateItemData[];
  targets: ForecastTargetData[];
  assumptions: ForecastAssumptionData[];
  actuals: ForecastActuals[];
  overrides: ForecastOverrideData[];
  exportedBy: string;
  exportDate: string;
}

// Channel-grouped UI display types
export interface ChannelGroup {
  channel: string;
  sources: ForecastSourceItem[];
  totalsByStage: Record<FunnelStage, number>;
}
```

## Step 3.2: Add raw BQ types to `src/types/bigquery-raw.ts`
**File**: `src/types/bigquery-raw.ts` (append to existing file)

```typescript
// Forecast module raw BQ types
export interface RawDiscoveredSource {
  Original_source: { value: string } | string;
  Finance_View__c: { value: string } | string;
  record_count: { value: string } | string;
  last_activity: { value: string } | string;
}

export interface RawTrailingRate {
  channel: { value: string } | string;
  sub_source: { value: string } | string;
  transition: { value: string } | string;
  numerator: { value: string } | string;
  denominator: { value: string } | string;
  rate: { value: string } | string;
}

export interface RawForecastActual {
  channel: { value: string } | string;
  sub_source: { value: string } | string;
  month_key: { value: string } | string;
  stage: { value: string } | string;
  volume: { value: string } | string;
}

export interface RawHistoricalActual {
  yr: { value: string } | string;
  qtr: { value: string } | string;
  channel: { value: string } | string;
  prospects: { value: string } | string;
  contacted: { value: string } | string;
  mqls: { value: string } | string;
  sqls: { value: string } | string;
  sqos: { value: string } | string;
  joined: { value: string } | string;
}
```

## Step 3.3: Add constant for new BQ table
**File**: `src/config/constants.ts` (add after line 37)

```typescript
export const FORECAST_DATA_TABLE = 'savvy-gtm-analytics.SavvyGTMData.forecast_data';
```

## PHASE 3 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | tail -10
```

**Expected**: Zero new errors (types defined but not yet consumed).

**STOP AND REPORT**: Tell the user:
- "Types created: `src/types/forecast.ts` with 15+ interfaces"
- "Raw BQ types added to `src/types/bigquery-raw.ts`"
- "Constant `FORECAST_DATA_TABLE` added to `src/config/constants.ts`"
- "Ready to proceed to Phase 4?"

---

# PHASE 4: Core Query Functions

## Context
Create 5 new query files in `src/lib/queries/`. All follow the `forecast-goals.ts` pattern: private `_fn` + exported `cachedQuery` wrapper. All use `@paramName` syntax, `toNumber()`/`toString()` coercers.

**Critical**: All queries comparing `converted_date_raw` MUST use `TIMESTAMP(v.converted_date_raw)` (it's DATE, not TIMESTAMP).

## Step 4.1: Create `src/lib/queries/forecast-sources.ts`
**File**: `src/lib/queries/forecast-sources.ts` (new file)

BQ source discovery query:
```sql
SELECT
  v.Original_source,
  v.Finance_View__c,
  COUNT(*) as record_count,
  MAX(v.FilterDate) as last_activity
FROM `{FULL_TABLE}` v
WHERE v.FilterDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)
  AND v.Original_source IS NOT NULL
  AND v.Finance_View__c IS NOT NULL
GROUP BY v.Original_source, v.Finance_View__c
ORDER BY record_count DESC
```

- Import `FULL_TABLE` from `src/config/constants.ts`
- Return type: `DiscoveredSource[]`
- Transform: `toString(row.Original_source)`, `toString(row.Finance_View__c)`, `toNumber(row.record_count)`, `toString(row.last_activity)`
- Cache: `cachedQuery(_fn, "forecast-sources", CACHE_TAGS.DASHBOARD)`

## Step 4.2: Create `src/lib/queries/forecast-rates.ts`
**File**: `src/lib/queries/forecast-rates.ts` (new file)

Trailing 90-day resolved-only rates. Five separate sub-queries per transition, matching the pattern from `conversion-rates.ts`:

**Created→Contacted**: Use `FilterDate` field, `is_contacted` flag
**Contacted→MQL**: Use `stage_entered_contacting__c` in [today-120d, today-30d] window, `contacted_to_mql_progression` flag, `eligible_for_contacted_conversions_30d` flag
**MQL→SQL**: Use `mql_stage_entered_ts`, `mql_to_sql_progression`, `eligible_for_mql_conversions`
**SQL→SQO**: Use `TIMESTAMP(converted_date_raw)` (**BLOCKER 2 fix**), `sql_to_sqo_progression`, `eligible_for_sql_conversions`, filter `recordtypeid = '012Dn000000mrO3IAI'`
**SQO→Joined**: Use `Date_Became_SQO__c`, `sqo_to_joined_progression`, `eligible_for_sqo_conversions`

Parameters: optional `@channel`, `@subSource` for filtering.
Return: rates grouped by `Finance_View__c` × `Original_source` × transition.
Cache: `cachedQuery(_fn, "forecast-rates", CACHE_TAGS.DASHBOARD)`

## Step 4.2b: Rate seeding fallback for new/sparse sources

When a source has insufficient trailing-90-day data (fewer than 5 records in the denominator),
the rate calculation should return `null` instead of a potentially meaningless rate.

The API route (Phase 5) must handle this by:
1. Running the trailing-90-day query for all sources
2. For any source where a transition returns `null`:
   a. Check if a `ForecastAssumption` exists with key `"rate_seed_from"` for that source
      (e.g., channel="Outbound", subSource="Fintrx (Self-Sourced)", value="LinkedIn (Self Sourced)")
   b. If found, copy that source's calculated rates as the default
   c. If not found, return null — the UI will show "Insufficient data — set manually or copy from another source"
3. The UI should offer a "Copy rates from..." dropdown that lists other sources in the same channel

This matches the sheet's pattern where Fintrx monthly rates were manually set to match LinkedIn Self Sourced:
- Created→Contacted: 87.69% (from LinkedIn SS)
- Contacted→MQL: 2.30% (from LinkedIn SS)
- MQL→SQL: 40.00% (from LinkedIn SS)
- SQL→SQO: 71.00% (from LinkedIn SS)

## Step 4.3: Create `src/lib/queries/forecast-actuals.ts`
**File**: `src/lib/queries/forecast-actuals.ts` (new file)

**CRITICAL: Period type filtering**
- For completed quarters: use `period_type = 'QUARTERLY'` ONLY
- For the current (in-progress) quarter: use `period_type = 'QTD'` ONLY
- NEVER combine both — the Google Sheet does this and it causes double-counting of prospects_created
  (exploration found +48 discrepancy for Provided List, +18 for LinkedIn SS in Q4 2025)

The dashboard should determine quarter completeness: if the current date is past the quarter's end date,
use QUARTERLY; otherwise use QTD.

Current quarter actuals from `vw_funnel_master`:
```sql
SELECT
  v.Finance_View__c as channel,
  v.Original_source as sub_source,
  FORMAT_TIMESTAMP('%Y-%m', v.FilterDate) as month_key,
  'created' as stage,
  COUNT(*) as volume
FROM `{FULL_TABLE}` v
WHERE v.FilterDate >= @startDate
  AND v.FilterDate < @endDate
GROUP BY 1, 2, 3, 4
-- UNION ALL for contacted (SUM(is_contacted)), mql, sql, sqo, joined stages
```

Parameters: `@startDate`, `@endDate` (quarter boundaries).
Return: `ForecastActuals[]`
Cache: `cachedQuery(_fn, "forecast-actuals", CACHE_TAGS.DASHBOARD)`

## Step 4.4: Create `src/lib/queries/forecast-historical.ts`
**File**: `src/lib/queries/forecast-historical.ts` (new file)

Historical actuals for 4+ quarters:
```sql
SELECT
  EXTRACT(YEAR FROM v.FilterDate) as yr,
  EXTRACT(QUARTER FROM v.FilterDate) as qtr,
  v.Finance_View__c as channel,
  COUNT(*) as prospects,
  SUM(CASE WHEN v.is_contacted = 1 THEN 1 ELSE 0 END) as contacted,
  -- ... mql, sql, sqo, joined similarly
FROM `{FULL_TABLE}` v
WHERE v.FilterDate >= @startDate
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3
```

Parameters: `@startDate` (e.g., 15 months ago).
Cache: `cachedQuery(_fn, "forecast-historical", CACHE_TAGS.DASHBOARD)`

## Step 4.5: Create `src/lib/queries/forecast-sync.ts`
**File**: `src/lib/queries/forecast-sync.ts` (new file)

Neon → BQ sync function. Uses `@google-cloud/bigquery` client directly (not `runQuery`):
- Read forecast data from Neon via Prisma
- Build two row types: `Total_*` (channel aggregates) + `Cohort_source` (sub-source detail)
- Stage name mapping: internal `CREATED` → export `prospects`; `CONTACTED` is NOT exported; `MQL`/`SQL`/`SQO`/`JOINED` lowercase
- Write to `FORECAST_DATA_TABLE` via BQ INSERT
- Delete existing rows for the quarter first (idempotent)

This function is NOT cached (it's a write operation).

## Waterfall Computation Rules (from exploration Phase 8.2)

The waterfall is computed **monthly-first**, matching the Google Sheet's proven methodology:

**Monthly calculation (for each sub-source × month):**
```
Created = [from SGA assumptions (Outbound) or manual input (other channels)]
Contacted = Created × Created→Contacted rate (monthly rate, not quarterly)
MQL = Contacted × Contacted→MQL rate
SQL = MQL × MQL→SQL rate
SQO = SQL × SQL→SQO rate
Joined = SQO × SQO→Joined rate
```

**Quarterly rollup:**
```
Q_Created = SUM(Apr_Created, May_Created, Jun_Created)
Q_Contacted = SUM(Apr_Contacted, May_Contacted, Jun_Contacted)
Q_MQL = SUM(Apr_MQL, May_MQL, Jun_MQL)
... (same for all stages)
```

**IMPORTANT: Quarterly rate ≠ AVERAGE of monthly rates.**
The quarterly rate column is DISPLAY ONLY — computed as Q_StageOut / Q_StageIn.
For example: Q_MQL_to_SQL_rate = Q_SQL / Q_MQL (not AVERAGE of monthly MQL→SQL rates).
The exploration confirmed this: Fintrx G137 (quarterly Contacted→MQL) = 0% via AVERAGE(C:E),
but the actual quarterly MQL volume (G138=75) is correct because it sums monthly volumes
which use the hardcoded monthly rate (2.3%), not the quarterly rate.

**Created volume sources (by channel type):**
- Outbound: `sourcing_rate_per_sga × sga_count_for_month` (from ForecastAssumption)
- All other channels: manually entered volume per month (stored directly on ForecastLineItem)

## PHASE 4 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

**Expected**: Zero TypeScript errors. All query functions compile.

```bash
grep -r "cachedQuery" src/lib/queries/forecast-*.ts | wc -l
```

**Expected**: 4 (sources, rates, actuals, historical — sync is not cached).

```bash
grep -r "TIMESTAMP(v.converted_date_raw)" src/lib/queries/forecast-rates.ts
```

**Expected**: At least 1 match (Blocker 2 fix applied).

**STOP AND REPORT**: Tell the user:
- "5 query files created with `cachedQuery` wrappers"
- "`converted_date_raw` TIMESTAMP cast applied"
- "Ready to proceed to Phase 5?"

---

# PHASE 5: Core API Routes (CRUD)

## Context
Create 13 API route files under `src/app/api/forecast/`. All follow the standard auth pattern: `getServerSession` → `getSessionPermissions` → role check → `forbidRecruiter` → `forbidCapitalPartner`.

Edit access (`canEditForecast`) restricted to `revops_admin` + `admin`. Read access for all non-blocked roles.

## Step 5.1: Create `src/app/api/forecast/route.ts`
**Methods**: GET (list forecasts), POST (create new forecast)
- GET: `prisma.forecast.findMany({ orderBy: { createdAt: 'desc' } })`
- POST: Validate quarter format, create forecast + run source discovery, return new forecast
- Role: GET = any non-recruiter/non-capital_partner; POST = `revops_admin` or `admin` only

## Step 5.2: Create `src/app/api/forecast/[id]/route.ts`
**Methods**: GET, PUT, DELETE
- GET: `prisma.forecast.findUnique({ include: { sources: true } })`
- PUT: Update status, notes. Only `revops_admin`/`admin`.
- DELETE: `prisma.forecast.delete()`. Only `revops_admin`.

## Step 5.3: Create `src/app/api/forecast/[id]/discover-sources/route.ts`
**Method**: POST
- Runs `discoverForecastSources()` BQ query
- Creates/updates `ForecastSource` records via Prisma upsert
- Auto-discovered sources default to `isActive: true`; zero-volume sources to `isActive: false`
- Only `revops_admin`/`admin`

## Step 5.4: Create `src/app/api/forecast/[id]/sources/route.ts`
**Methods**: GET, PUT
- GET: `prisma.forecastSource.findMany({ where: { forecastId } })`
- PUT: Toggle active/inactive, add manual sources, reorder
- Only `revops_admin`/`admin` for PUT

## Step 5.5: Create `src/app/api/forecast/[id]/line-items/route.ts`
**Methods**: GET, PUT
- GET: Return all line items for forecast
- PUT: Bulk update `finalVolume` values (only unlocked items)

## Step 5.6: Create `src/app/api/forecast/[id]/rate-items/route.ts`
**Methods**: GET, PUT
- GET: Return all rate items for forecast
- PUT: Bulk update `finalRate` values (only unlocked items)

## Step 5.7: Create `src/app/api/forecast/[id]/overrides/route.ts`
**Methods**: GET, POST
- GET: Return all overrides for forecast (join through line/rate items)
- POST: Create override (lock cell): validate `reason` required, record `overriddenBy`

## Step 5.8: Create `src/app/api/forecast/[id]/assumptions/route.ts`
**Methods**: GET, PUT
- Standard Prisma CRUD on `ForecastAssumption`

## Step 5.9: Create `src/app/api/forecast/[id]/targets/route.ts`
**Methods**: GET, PUT
- Standard Prisma CRUD on `ForecastTarget`

## Step 5.10: Create `src/app/api/forecast/[id]/calculate-rates/route.ts`
**Method**: POST
- Fetch trailing 90-day rates via `getTrailing90DayRates()` from Phase 4
- Populate `ForecastRateItem` records for all active sources
- Special handling: SQO→Joined uses ~15% business assumption (configurable via `ForecastAssumption` with key `sqo_to_joined_override`)
- Trigger waterfall recalculation
- Only `revops_admin`/`admin`

## Step 5.11: Create `src/app/api/forecast/[id]/actuals/route.ts`
**Method**: GET
- Fetch current actuals from BQ via `getForecastActuals()`
- Return actuals grouped by channel/source/stage/month

## Step 5.12: Create `src/app/api/forecast/[id]/export/route.ts`
**Method**: POST
- `export const maxDuration = 60`
- Builds `ForecastExportData` package
- Calls `ForecastSheetsExporter.exportToSheets()` (Phase 10)
- Returns `{ success, spreadsheetId, spreadsheetUrl }`
- Requires `permissions.canExport`

## Step 5.13: Create `src/app/api/forecast/[id]/sync-bq/route.ts`
**Method**: POST
- Calls `syncForecastToBQ()` from Phase 4
- Only `revops_admin`
- Returns sync results (rows written, row types)

## PHASE 5 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

**Expected**: Zero errors.

```bash
find src/app/api/forecast -name "route.ts" | wc -l
```

**Expected**: 13 route files.

```bash
grep -r "forbidRecruiter" src/app/api/forecast/ | wc -l
```

**Expected**: 13 (every route has recruiter guard).

```bash
npm run build 2>&1 | tail -10
```

**Expected**: Build passes.

**STOP AND REPORT**: Tell the user:
- "13 API routes created under `/api/forecast/`"
- "All routes have auth guards (session + role + recruiter/CP blocks)"
- "Edit operations restricted to `revops_admin`/`admin`"
- "Ready to proceed to Phase 6?"

---

# PHASE 6: API Client Methods

## Context
Add `forecastApi` to `src/lib/api-client.ts` so components can call the new endpoints.

## Step 6.1: Add forecast API client
**File**: `src/lib/api-client.ts`

Add a new exported object after the existing `notificationsApi`:

```typescript
import type {
  ForecastSummary,
  ForecastSourceItem,
  ForecastLineItemData,
  ForecastRateItemData,
  ForecastOverrideData,
  ForecastAssumptionData,
  ForecastTargetData,
  ForecastActuals,
} from '@/types/forecast';

export const forecastApi = {
  // Forecast CRUD
  list: () => apiFetch<{ forecasts: ForecastSummary[] }>('/api/forecast'),

  create: (data: { quarter: string; year: number; notes?: string }) =>
    apiFetch<{ forecast: ForecastSummary }>('/api/forecast', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  get: (id: string) =>
    apiFetch<{ forecast: ForecastSummary; sources: ForecastSourceItem[] }>(
      `/api/forecast/${encodeURIComponent(id)}`
    ),

  update: (id: string, data: { status?: string; notes?: string }) =>
    apiFetch<{ forecast: ForecastSummary }>(
      `/api/forecast/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(data) }
    ),

  delete: (id: string) =>
    apiFetch<{ success: boolean }>(
      `/api/forecast/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  // Source management
  discoverSources: (id: string) =>
    apiFetch<{ sources: ForecastSourceItem[]; discovered: number }>(
      `/api/forecast/${encodeURIComponent(id)}/discover-sources`,
      { method: 'POST' }
    ),

  getSources: (id: string) =>
    apiFetch<{ sources: ForecastSourceItem[] }>(
      `/api/forecast/${encodeURIComponent(id)}/sources`
    ),

  updateSources: (id: string, updates: Partial<ForecastSourceItem>[]) =>
    apiFetch<{ sources: ForecastSourceItem[] }>(
      `/api/forecast/${encodeURIComponent(id)}/sources`,
      { method: 'PUT', body: JSON.stringify({ updates }) }
    ),

  // Line items
  getLineItems: (id: string) =>
    apiFetch<{ lineItems: ForecastLineItemData[] }>(
      `/api/forecast/${encodeURIComponent(id)}/line-items`
    ),

  updateLineItems: (id: string, updates: Partial<ForecastLineItemData>[]) =>
    apiFetch<{ lineItems: ForecastLineItemData[] }>(
      `/api/forecast/${encodeURIComponent(id)}/line-items`,
      { method: 'PUT', body: JSON.stringify({ updates }) }
    ),

  // Rate items
  getRateItems: (id: string) =>
    apiFetch<{ rateItems: ForecastRateItemData[] }>(
      `/api/forecast/${encodeURIComponent(id)}/rate-items`
    ),

  updateRateItems: (id: string, updates: Partial<ForecastRateItemData>[]) =>
    apiFetch<{ rateItems: ForecastRateItemData[] }>(
      `/api/forecast/${encodeURIComponent(id)}/rate-items`,
      { method: 'PUT', body: JSON.stringify({ updates }) }
    ),

  // Overrides
  getOverrides: (id: string) =>
    apiFetch<{ overrides: ForecastOverrideData[] }>(
      `/api/forecast/${encodeURIComponent(id)}/overrides`
    ),

  createOverride: (id: string, data: {
    lineItemId?: string;
    rateItemId?: string;
    fieldType: string;
    originalValue: number;
    overrideValue: number;
    reason: string;
  }) =>
    apiFetch<{ override: ForecastOverrideData }>(
      `/api/forecast/${encodeURIComponent(id)}/overrides`,
      { method: 'POST', body: JSON.stringify(data) }
    ),

  // Assumptions & targets
  getAssumptions: (id: string) =>
    apiFetch<{ assumptions: ForecastAssumptionData[] }>(
      `/api/forecast/${encodeURIComponent(id)}/assumptions`
    ),

  updateAssumptions: (id: string, assumptions: Partial<ForecastAssumptionData>[]) =>
    apiFetch<{ assumptions: ForecastAssumptionData[] }>(
      `/api/forecast/${encodeURIComponent(id)}/assumptions`,
      { method: 'PUT', body: JSON.stringify({ assumptions }) }
    ),

  getTargets: (id: string) =>
    apiFetch<{ targets: ForecastTargetData[] }>(
      `/api/forecast/${encodeURIComponent(id)}/targets`
    ),

  updateTargets: (id: string, targets: Partial<ForecastTargetData>[]) =>
    apiFetch<{ targets: ForecastTargetData[] }>(
      `/api/forecast/${encodeURIComponent(id)}/targets`,
      { method: 'PUT', body: JSON.stringify({ targets }) }
    ),

  // Actions
  calculateRates: (id: string) =>
    apiFetch<{ rateItems: ForecastRateItemData[]; message: string }>(
      `/api/forecast/${encodeURIComponent(id)}/calculate-rates`,
      { method: 'POST' }
    ),

  getActuals: (id: string) =>
    apiFetch<{ actuals: ForecastActuals[] }>(
      `/api/forecast/${encodeURIComponent(id)}/actuals`
    ),

  exportToSheets: (id: string) =>
    apiFetch<{ success: boolean; spreadsheetId: string; spreadsheetUrl: string }>(
      `/api/forecast/${encodeURIComponent(id)}/export`,
      { method: 'POST' }
    ),

  syncToBQ: (id: string) =>
    apiFetch<{ success: boolean; rowsWritten: number; message: string }>(
      `/api/forecast/${encodeURIComponent(id)}/sync-bq`,
      { method: 'POST' }
    ),
};
```

## PHASE 6 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

**Expected**: Zero errors.

**STOP AND REPORT**: Tell the user:
- "API client `forecastApi` added with 20+ typed methods"
- "Ready to proceed to Phase 7?"

---

# PHASE 7: Permissions & Navigation

## Context
Add forecast page to permissions and sidebar navigation. Page ID = 17.

## Step 7.1: Update permissions
**File**: `src/lib/permissions.ts`

Add page 17 to `allowedPages` arrays:
- `revops_admin`: add `17` to array (line 16)
- `admin`: add `17` to array (line 23)
- `manager`: add `17` to array (line 30)
- `sgm`: add `17` to array (line 37)
- `sga`: add `17` to array (line 44)
- `viewer`: add `17` to array (line 51)
- `recruiter`: do NOT add (blocked)
- `capital_partner`: do NOT add (blocked)

Add `canEditForecast` to ROLE_PERMISSIONS:
- `revops_admin`: `canEditForecast: true`
- `admin`: `canEditForecast: true`
- All others: `canEditForecast: false`

## Step 7.2: Update `UserPermissions` type
**File**: `src/types/user.ts`

Add to `UserPermissions` interface:
```typescript
canEditForecast: boolean;
```

## Step 7.3: Add sidebar navigation
**File**: `src/components/layout/Sidebar.tsx`

Add to `PAGES` array (before Settings, which is id 7):
```typescript
{ id: 17, name: 'Forecast', href: '/dashboard/forecast', icon: TrendingUp },
```

Add `TrendingUp` to the lucide-react import.

## PHASE 7 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run build 2>&1 | tail -10
```

**Expected**: Build passes. The `canEditForecast` property must be added to all places that construct `UserPermissions` objects (check `getPermissionsFromToken` and `getUserPermissions` in permissions.ts — they spread from `ROLE_PERMISSIONS` so they should auto-inherit if added there, but verify the type satisfies the interface).

**STOP AND REPORT**: Tell the user:
- "Forecast page (id=17) added to permissions for 6 roles"
- "`canEditForecast` permission added (revops_admin + admin only)"
- "Sidebar nav entry added with TrendingUp icon"
- "Ready to proceed to Phase 8?"

---

# PHASE 8: UI — Forecast Page & Components

## Context
Create the forecast page and core UI components. Follows the server page + client content split pattern from SGA Hub.

## Step 8.1: Create server page
**File**: `src/app/dashboard/forecast/page.tsx` (new file)

```typescript
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import ForecastContent from './ForecastContent';

export const dynamic = 'force-dynamic';

export default async function ForecastPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect('/login');
  const permissions = getSessionPermissions(session);
  if (!permissions) redirect('/login');
  if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin', 'viewer'].includes(permissions.role)) {
    redirect('/dashboard');
  }
  return <ForecastContent />;
}
```

## Step 8.2: Create client content component
**File**: `src/app/dashboard/forecast/ForecastContent.tsx` (new file)

Pattern: `"use client"` + `useEffect` + `useState` + `forecastApi.*`
- State: `forecasts`, `selectedForecast`, `activeTab`, `loading`, `error`
- Fetch forecasts on mount via `forecastApi.list()`
- When forecast selected, parallel fetch: `Promise.all([getLineItems, getRateItems, getSources, getActuals, getAssumptions, getTargets])`
- Tabs: Summary, Channel Detail, Targets, Assumptions, History
- Admin controls (create, sync, calculate rates) conditionally rendered based on `canEditForecast`

## Step 8.3: Create tab component
**File**: `src/components/forecast/ForecastTabs.tsx` (new file)

Follow `GCHubTabs` pattern (full ARIA + keyboard nav):
```typescript
const TABS = [
  { id: 'summary', label: 'Summary' },
  { id: 'channel-detail', label: 'Channel Detail' },
  { id: 'targets', label: 'Targets' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'history', label: 'History' },
] as const;
```

## Step 8.4: Create ForecastHeader component
**File**: `src/components/forecast/ForecastHeader.tsx` (new file)

- Quarter selector dropdown
- Status badge (DRAFT/ACTIVE/ARCHIVED)
- Action buttons: Calculate Rates, Sync to BQ, Export to Sheets (conditional on `canEditForecast`)
- Create New Forecast button

## Step 8.5: Create ForecastSummaryTable component
**File**: `src/components/forecast/ForecastSummaryTable.tsx` (new file)

Tremor Table: channels × stages with quarterly totals.
- Channels are collapsible group headers (Finance_View__c)
- Sources nested under channel groups
- "Show inactive" toggle at top
- Sort: `useMemo` + sort fn outside component (AdminSGATable pattern)

## Step 8.6: Create ChannelDetailTable component
**File**: `src/components/forecast/ChannelDetailTable.tsx` (new file)

- Per-channel drill-down: sub-sources × stages × 3 monthly columns
- Waterfall display: volume = prev_volume × rate
- Rate cells editable (click to override)
- Lock/unlock icons on cells

## Step 8.7: Create ForecastCell component
**File**: `src/components/forecast/ForecastCell.tsx` (new file)

- Editable cell with lock/unlock indicator
- Override tooltip (hover shows history)
- Click to edit (if unlocked and `canEditForecast`)
- Visual: locked cells have lock icon + different background

## Step 8.8: Create OverrideModal component
**File**: `src/components/forecast/OverrideModal.tsx` (new file)

Follow `GCHubOverrideModal` pattern:
- Props: `{ isOpen, onClose, onSaved, currentValue, fieldType }`
- Guard: `if (!isOpen) return null`
- Override value input + required reason textarea
- `useCallback` for submit, `disabled={submitting}`

## Step 8.9: Create TargetsPanel component
**File**: `src/components/forecast/TargetsPanel.tsx` (new file)

- Finance minimum, gap filler allocation per channel × month × stage
- Monthly distribution percentages
- Clear separation: forecast (expected) vs. target (needed) vs. gap (delta)

## Step 8.10: Create AssumptionsPanel component
**File**: `src/components/forecast/AssumptionsPanel.tsx` (new file)

- SGA count, lead list size, custom assumptions
- Editable key-value pairs

## Step 8.11: Create ActualsComparisonColumns component
**File**: `src/components/forecast/ActualsComparisonColumns.tsx` (new file)

- Forecast vs. actual side-by-side with variance
- Color coding: green (ahead), red (behind), yellow (close)

## Step 8.12: Create ExportForecastButton component
**File**: `src/components/forecast/ExportForecastButton.tsx` (new file)

Follow `ExportToSheetsButton` pattern:
- Props: `{ forecastId, canExport, disabled? }`
- State: `isExporting`, `error`, `spreadsheetUrl`
- Calls `forecastApi.exportToSheets(forecastId)`
- Opens new tab on success

## PHASE 8 — VALIDATION GATE

```bash
npm run build 2>&1 | tail -20
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

**Expected**: Zero TypeScript errors. Build passes.

```bash
find src/components/forecast -name "*.tsx" | wc -l
```

**Expected**: 9 component files.

**STOP AND REPORT**: Tell the user:
- "Forecast page + 9 UI components created"
- "Source-first UI with channel grouping, lock/unlock cells, override modals"
- "Build passes with zero errors"
- "Ready to proceed to Phase 9?"

---

# PHASE 9: Google Sheets Export

## Context
Create forecast-specific Sheets exporter class. Separate from existing `GoogleSheetsExporter` to avoid coupling.

## Step 9.1: Create forecast sheets types
**File**: `src/lib/sheets/forecast-sheets-types.ts` (new file)

```typescript
export interface ForecastSheetsExportResult {
  success: boolean;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  error?: string;
}
```

## Step 9.2: Create forecast sheets exporter
**File**: `src/lib/sheets/forecast-sheets-exporter.ts` (new file)

Class `ForecastSheetsExporter`:
- Constructor: same auth pattern as `GoogleSheetsExporter` (JWT service account from env)
- `exportToSheets(data: ForecastExportData)`: main public method
  1. `copyTemplate()` — POST to Apps Script web app (new template for forecast)
  2. `populateSummarySheet()` — channels × stages with totals
  3. `populateChannelDetailSheets()` — one tab per channel with sub-sources × months
  4. `populateTargetsSheet()` — targets + gap tracking
  5. `populateAssumptionsSheet()` — key-value pairs
  6. `populateOverrideLogSheet()` — all overrides with timestamps
- Waterfall formulas: `=D{row}*D{row+1}` pattern
- Quarterly totals: `=SUM(D{row},G{row},J{row})`
- Variance: `=E{row}-D{row}`
- Conditional formatting: green (ahead), red (behind), yellow (close)
- Cell notes on overridden cells: original value, reason, who/when
- `writeInChunks()` for large data (1000 rows + 100ms delay)
- `valueInputOption: 'USER_ENTERED'` to support formulas
- ALWAYS explicit column mapping

## PHASE 9 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
npm run build 2>&1 | tail -10
```

**Expected**: Zero errors. Build passes.

**STOP AND REPORT**: Tell the user:
- "Forecast Sheets exporter created with 6 populate methods"
- "Waterfall formulas, conditional formatting, override annotations"
- "Ready to proceed to Phase 10?"

---

# PHASE 10: Documentation Sync

## Context
Run documentation generators and agent-guard sync to update architecture docs.

## Step 10.1: Regenerate inventories
```bash
npm run gen:all
```

## Step 10.2: Run agent-guard sync
```bash
npx agent-guard sync
```

Review changes to `ARCHITECTURE.md` and generated inventories. Stage if correct.

## PHASE 10 — VALIDATION GATE

```bash
npm run build 2>&1 | tail -10
```

**Expected**: Clean build.

```bash
git diff --stat
```

**Expected**: Updated docs showing new API routes, models, and env vars.

**STOP AND REPORT**: Tell the user:
- "Documentation synced: API routes, Prisma models, architecture docs updated"
- "Ready to proceed to Phase 11 (UI validation)?"

---

# PHASE 11: UI/UX Validation (Requires User)

## Context
This phase requires the user to verify the forecast module in the browser.

## Test Group 1: Forecast Creation & Source Discovery
1. Navigate to `/dashboard/forecast`
2. Click "Create New Forecast" for Q2 2026
3. Verify source discovery runs automatically
4. Check that sources are grouped under Finance_View__c channel headers
5. **Verify**: "Do you see sources grouped under channel headers (Outbound, Marketing, etc.)?"

## Test Group 2: Rate Calculation
1. Click "Calculate Rates" on the new forecast
2. Verify rates populate for all active sources
3. Check Outbound rates: ~82% Created→Contacted, ~3% Contacted→MQL
4. Check SQO→Joined shows ~15% (business assumption, not 0%)
5. **Verify**: "Do rates look reasonable? SQO→Joined should show ~15%."

## Test Group 3: Override System
1. Click a rate cell to lock it
2. Enter override value + reason
3. Verify lock icon appears
4. Hover to see override tooltip
5. Click again to unlock
6. **Verify**: "Does lock/unlock round-trip correctly? Does the tooltip show the override reason?"

## Test Group 4: Waterfall Calculations
1. Change a "Created" volume for a source
2. Verify downstream stages recalculate (Contacted = Created × rate, etc.)
3. **Verify**: "Do downstream volumes update when you change Created?"

## Test Group 5: Targets & Assumptions
1. Switch to Targets tab
2. Enter finance minimums for Outbound
3. Verify gap calculation = forecast - finance minimum
4. Switch to Assumptions tab
5. Enter SGA count
6. **Verify**: "Do target gaps calculate correctly?"

## Test Group 6: Sheets Export (if Apps Script template ready)
1. Click "Export to Sheets"
2. Verify new tab opens with Google Sheet
3. Check: waterfall formulas work, conditional formatting applied, override annotations present
4. **Verify**: "Does the exported Sheet have working formulas and formatting?"

## Test Group 7: BQ Sync (if native table ready)
1. Click "Sync to BQ"
2. Verify success message
3. Check `vw_daily_forecast` shows forecast data for the new quarter
4. **Verify**: "Does BQ sync succeed? Do scorecards show forecast goals?"

## Test Group 8: Role-Based Access
1. Log in as a `viewer` role user
2. Verify forecast page is accessible (read-only)
3. Verify edit controls (create, calculate, sync, lock) are hidden
4. **Verify**: "Are edit controls hidden for non-admin roles?"

**STOP AND REPORT**: Tell the user:
- "UI validation checklist complete"
- "All test groups passed / [list any failures]"
- "Implementation complete!"

---

# Troubleshooting Appendix

## Common TypeScript Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Property 'canEditForecast' does not exist on type 'UserPermissions'` | Missing from `UserPermissions` interface | Add to `src/types/user.ts` |
| `Type 'ForecastStatus' is not assignable to type 'string'` | Prisma enum vs string mismatch | Use string literal union type in `src/types/forecast.ts`, not Prisma enum directly |
| `Cannot find module '@/types/forecast'` | File not created or wrong path | Verify file exists at `src/types/forecast.ts` |
| `Argument of type 'X' is not assignable to parameter of type 'Y'` in query transforms | BQ raw type mismatch | Use `toNumber()` / `toString()` coercers |

## BigQuery Query Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `No matching signature for operator >= for argument types: DATE, TIMESTAMP` | `converted_date_raw` is DATE | Use `TIMESTAMP(v.converted_date_raw)` |
| `Permission denied while getting Drive credentials` | EXTERNAL table requires Drive access | Use native `forecast_data` table instead |
| `Table not found: forecast_data` | Native table not yet created | Russell must create it in BQ console |

## Data Edge Cases

| Issue | Details | Handling |
|-------|---------|----------|
| SQO→Joined rate = 0% in 90-day window | Lag exceeds window | Use ~15% business assumption via `ForecastAssumption` |
| NULL rates for small channels | Partnerships (4), Employee Referral (2) | Show "insufficient data" warning; fall back to channel-level average |
| Outbound Q4 2025 prospect surge (80% QoQ) | 17,905 vs 9,930 | Investigate before using as baseline; use Q1-Q3 2025 |
| `forecast_value` must be INT64 | BQ table constraint | Round to integer before writing |
| Fintrx quarterly rates = 0% | AVERAGE of 3 empty quarters | Monthly rates are the real forecast; quarterly G column is display-only (SUM of monthly volumes) |
| Duplicate Direct Traffic sections | Sheet has rows 227 AND 253 | Dashboard unique constraint prevents this; use row 253 data (has forecast) |
| Google Ads + LinkedIn Ads combined | No single BQ Original_source | Use bqSourceMapping ["Google Ads", "LinkedIn Ads"] to sum actuals |
| SUMPRODUCT double-counting | Sheet matches QTD+QUARTERLY | Dashboard uses QUARTERLY only for completed quarters, QTD only for current |
| Re-Engagement rate divergence | Quarterly avg=25% but monthly=92% for SQL→SQO | Monthly-first waterfall handles this correctly; quarterly rate is display-only |

## Known Limitations

| Limitation | Rationale |
|-----------|-----------|
| `contacted` stage not exported to BQ | `vw_daily_forecast` schema has no `contacted_daily` column |
| `month_key_test` written as empty string | Legacy artifact; preserved for backward compatibility |
| Source→channel mapping not 1:1 | `LinkedIn (Self Sourced)` maps to both Outbound and Other; source-first architecture handles this naturally |
| No velocity metric | Does not exist as aggregate query in codebase; would need to be built from scratch |
| `recordtypeid` hardcoded | `012Dn000000mrO3IAI` — verify still active in Salesforce org |
| Q1 2026 excluded from sheet's rate average | Sheet uses AVERAGE(Q2-Q4 2025), skipping Q1 2026. Dashboard uses trailing 90-day instead. |
| Fintrx rate labels use ">" not "→" | Sheet inconsistency. Dashboard normalizes all labels. Not a data issue. |
| Lauren Overlay assumption | 0.5 SGA adjustment for a specific person. Supported via person_overlay assumption key. |
| 3 Outbound sub-sources share SGA counts | SGA counts (14.5/16/16) are per-month, shared across Provided List, LinkedIn SS, and Fintrx. Each has its own sourcing_rate_per_sga. |
