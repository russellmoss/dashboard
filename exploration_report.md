# Forecast Duration Penalty & Tiered Rates — Exploration Report

> Generated 2026-03-23. This report maps the codebase for an implementation agent building the P0 (Duration Penalty) and P1 (2-Tier AUM Rates) improvements identified in `forecasting_research.md`.

---

## Rate Flow Map

### End-to-end data flow

```
BigQuery vw_funnel_master
  │
  ├─► getForecastRates(windowDays)          [src/lib/queries/forecast-rates.ts:35]
  │     Returns: ForecastRates (single flat row: 4 rates + 4 avg_days)
  │     │
  │     ├─► /api/forecast/rates (GET)       [src/app/api/forecast/rates/route.ts]
  │     │     └─► page.tsx useMemo          [src/app/dashboard/forecast/page.tsx:61]
  │     │           Recomputes per-deal: p_join, expected_aum_weighted, projected dates
  │     │           └─► ForecastMetricCards, ExpectedAumChart, PipelineDetailTable
  │     │
  │     ├─► /api/forecast/monte-carlo (POST) [src/app/api/forecast/monte-carlo/route.ts]
  │     │     Passes rates as @rate_* BQ params
  │     │     └─► runMonteCarlo(rates, avgDays) [src/lib/queries/forecast-monte-carlo.ts:135]
  │     │           5000-trial Bernoulli simulation, per-opp win_pct
  │     │           └─► MonteCarloPanel (quarter cards + drilldown)
  │     │
  │     └─► /api/forecast/export (POST)      [src/app/api/forecast/export/route.ts]
  │           recomputeP2WithRates(rows, rates) at line 131
  │           Writes to Google Sheets
  │
  └─► vw_forecast_p2 (BQ view)              [sql/vw_forecast_p2.sql]
        Has its own hardcoded historical_rates CTE (Jun-Dec 2025 window)
        Client-side useMemo OVERWRITES view-baked p_join with dynamic rates
```

### Critical finding: ALL rate consumption is flat per-stage

Every touchpoint (view, client-side memo, Monte Carlo, Sheets export) uses the same 4 flat rates for every deal. No per-deal rate override exists anywhere. The change to support per-deal rates (based on AUM tier + duration bucket) touches ALL of these touchpoints.

---

## P(Join) Calculation Touchpoints

### Touchpoint 1: BigQuery view `vw_forecast_p2`

**File:** `sql/vw_forecast_p2.sql` (and identical `views/vw_forecast_p2.sql`)
**Location:** `forecast_results` CTE, lines 130-140

```sql
CASE
  WHEN StageName IN ('Discovery', 'Qualifying')
    THEN r.rate_sqo_to_sp * r.rate_sp_to_neg * r.rate_neg_to_signed * r.rate_signed_to_joined
  WHEN StageName = 'Sales Process'
    THEN r.rate_sp_to_neg * r.rate_neg_to_signed * r.rate_signed_to_joined
  WHEN StageName = 'Negotiating'
    THEN r.rate_neg_to_signed * r.rate_signed_to_joined
  WHEN StageName = 'Signed'
    THEN r.rate_signed_to_joined
  ELSE 0
END AS p_join
```

**Inputs:** `historical_rates` CTE (single row, CROSS JOINed). Uses hardcoded Jun-Dec 2025 cohort.
**Impact:** View-baked P(Join) is overwritten client-side, so this is NOT the display value. But it IS the value used by the raw Sheets export query before `recomputeP2WithRates` runs, and it's the baseline for the `/api/forecast/pipeline` endpoint.

### Touchpoint 2: Client-side `useMemo` in page.tsx

**File:** `src/app/dashboard/forecast/page.tsx`, lines 61-170
**Location:** `useMemo(() => { ... }, [pipeline, rates])`

```ts
// lines 71-86
let pJoin = 0;
switch (r.StageName) {
  case 'Discovery':
  case 'Qualifying':
    pJoin = sqo_to_sp * sp_to_neg * neg_to_signed * signed_to_joined; break;
  case 'Sales Process':
    pJoin = sp_to_neg * neg_to_signed * signed_to_joined; break;
  case 'Negotiating':
    pJoin = neg_to_signed * signed_to_joined; break;
  case 'Signed':
    pJoin = signed_to_joined; break;
}
// ...
const expectedAum = r.is_zero_aum ? 0 : aumRaw * pJoin;  // line 127
```

**Inputs:** Flat `rates` from `getForecastRates(windowDays)`, `r.Opportunity_AUM_M * 1e6`.
**This is the authoritative display value** — overwrites the view's baked-in P(Join).

**What changes:** This switch must incorporate AUM tier and duration bucket to compute per-deal adjusted rates. The memo already has access to `r.days_in_current_stage` and `r.aum_tier` from the pipeline record.

### Touchpoint 3: Monte Carlo simulation SQL

**File:** `src/lib/queries/forecast-monte-carlo.ts`, lines 85-132

```sql
-- Discovery/Qualifying branch:
(CASE WHEN RAND() < @rate_sqo_sp THEN 1 ELSE 0 END)
* (CASE WHEN RAND() < @rate_sp_neg THEN 1 ELSE 0 END)
* (CASE WHEN RAND() < @rate_neg_signed THEN 1 ELSE 0 END)
* (CASE WHEN RAND() < @rate_signed_joined THEN 1 ELSE 0 END) AS joined_in_trial
```

**Inputs:** `@rate_sqo_sp`, `@rate_sp_neg`, `@rate_neg_signed`, `@rate_signed_joined` (flat BQ params).
**Impact:** Same rates for every deal in every trial. No per-deal branching.

**What changes:** To support per-deal rates, the SQL needs a `deal_rates` CTE (computed from `days_in_current_stage` and `aum_tier` inline) that is JOINed to the `simulation` CTE. Each Bernoulli draw would use `CASE WHEN RAND() < dr.adjusted_rate_* THEN 1 ELSE 0 END` instead of the global `@rate_*` parameters.

### Touchpoint 4: Sheets export `recomputeP2WithRates`

**File:** `src/app/api/forecast/export/route.ts`, lines 131-202

```ts
// lines 138-148 (same switch logic as page.tsx)
if (stage === 'Discovery' || stage === 'Qualifying')
  pJoin = rates.sqo_to_sp * rates.sp_to_neg * rates.neg_to_signed * rates.signed_to_joined;
// ...
const expectedAum = r.is_zero_aum ? 0 : r.Opportunity_AUM * pJoin;
```

**Inputs:** Flat `rates` from `getForecastRates(windowDays)`, `r.Opportunity_AUM` (raw dollars).
**What changes:** Same per-deal adjustment logic as page.tsx. This function also needs `r.days_in_current_stage` and `r.aum_tier` (both available from the raw P2 export rows).

---

## Monte Carlo Architecture

### SQL structure (forecast-monte-carlo.ts)

| CTE | Lines | Purpose |
|-----|-------|---------|
| `open_pipeline` | 55-78 | Live pipeline from `vw_funnel_master` (same canonical filters) |
| `trials` | 80-83 | `GENERATE_ARRAY(1, 5000)` |
| `simulation` | 85-132 | `CROSS JOIN` pipeline × trials. Per-trial Bernoulli draws + projected_join_date |

**Rate injection:** 4 global `@rate_*` BQ named parameters, set from `getForecastRates()` or request body override. 3 `@days_*` parameters for timing.

**Aggregate query (lines 151-182):** Groups simulation results by quarter, computes `APPROX_QUANTILES` for P10/P50/P90.

**Per-opp query (lines 184-210):** Computes `win_pct = COUNTIF(joined_in_trial=1) / 5000` per deal. Used for drilldown sorting.

### Drilldown logic (MonteCarloPanel.tsx, lines 97-146)

Client-side only. Steps:
1. Filter pipeline to `projected_quarter === activeQuarter` and `!is_zero_aum`
2. Look up `simWinPct` from perOppMap (keyed by `${oppId}_${quarterLabel}`)
3. Compute `expectedAum = winPct * rawAum`
4. Sort descending by `simWinPct`, then `rawAum`
5. Running cumulative AUM, mark deals as "in scenario" while `cumulative <= target * 1.05`
6. Render dashed line separator after last "in" deal (colSpan=11)

### CSV export from drilldown (handleExportCSV, lines 152-187)

23 columns including: `#, Opp ID, Advisor, SGM, SGA, Stage, Days in Stage, AUM ($M), AUM Tier, P(Join), Won in (MC), Expected AUM, Running Total, In P10/P50/P90, Projected Quarter, dates, rates, SF URL`.

### What changes for per-deal rates in Monte Carlo

**Option A (recommended): Compute per-deal adjusted rates inline in the SQL**

Add a `deal_rates` CTE after `open_pipeline` that computes per-deal adjusted rates based on `days_in_current_stage`, `aum_tier`, and the duration penalty multipliers. The `simulation` CTE JOINs to `deal_rates` and uses `dr.adjusted_rate_sqo_sp` instead of `@rate_sqo_sp`.

The flat `@rate_*` parameters are still passed in as *base* rates, and the `deal_rates` CTE applies the tier adjustment and duration multiplier to produce the adjusted rate per deal. This preserves the current API signature while enabling per-deal variation.

**Option B (alternative): Pre-compute rates client-side, pass as JSON**

Build a rate override map client-side, serialize as JSON, pass to BQ via `UNNEST(JSON_QUERY_ARRAY(...))`. More complex, but allows the UI to show the exact rates being simulated.

---

## Sheets Export Architecture

### Files

| File | Purpose |
|------|---------|
| `src/app/api/forecast/export/route.ts` | POST handler, orchestrates data fetch + Sheets write |
| `src/lib/queries/forecast-export.ts` | Raw BQ queries for P2 and Audit data |

### Data flow

```
POST /api/forecast/export { windowDays, sgmFilter?, sgaFilter? }
  │
  ├── getForecastExportP2()        → SELECT * FROM vw_forecast_p2
  ├── getForecastExportAudit(win)  → SELECT * FROM vw_funnel_audit
  └── getForecastRates(win)        → Dynamic rates from vw_funnel_master
       │
       └── recomputeP2WithRates(p2Rows, rates)   [line 131]
            Overwrites: p_join, rate columns, expected_days_remaining,
            model_projected_join_date, final_projected_join_date,
            date_source, projected_quarter, expected_aum_weighted
            │
            └── writeTab('BQ Forecast P2', headers, rows)   [line 74]
                writeTab('BQ Audit Trail', headers, rows)
```

### Sheet details

- **Sheet ID:** `1Iz9X6HY-bsAGBNkuQWH-SYoB7Xzy-9Hkg2Kk8ipxKQY`
- **Tab 1: "BQ Forecast P2"** — 24 columns (A-X)
- **Tab 2: "BQ Audit Trail"** — 45 columns (A-AS)
- Write method: Clear entire tab, then write in 500-row chunks with `USER_ENTERED` (Sheets formulas evaluated)
- Return URL includes `gid=194360408`

### Current P2 columns (A-X)

| Col | Header | Source |
|-----|--------|--------|
| A | Opp ID | `Full_Opportunity_ID__c` |
| B | Advisor | `advisor_name` |
| C | SGM | `SGM_Owner_Name__c` |
| D | SGA | `SGA_Owner_Name__c` |
| E | Stage | `StageName` |
| F | Days in Stage | `days_in_current_stage` |
| G | Raw AUM | `Opportunity_AUM` |
| H | AUM ($M) | Sheets formula `=G{row}/1000000` |
| I | AUM Tier | `aum_tier` |
| J | Zero AUM | `is_zero_aum ? 'YES' : 'NO'` |
| K | Rate SQO→SP | `rate_sqo_to_sp` (blank if null) |
| L | Rate SP→Neg | `rate_sp_to_neg` (blank if null) |
| M | Rate Neg→Signed | `rate_neg_to_signed` |
| N | Rate Signed→Joined | `rate_signed_to_joined` |
| O | Stages Remaining | `stages_remaining` |
| P | P(Join) Workings | `buildWorkings(r)` — human-readable string |
| Q | P(Join) | Sheets formula `=IF(K<>"",K,1)*IF(L<>"",L,1)*IF(M<>"",M,1)*N` |
| R | Days Remaining | `expected_days_remaining` |
| S | Model Join Date | `model_projected_join_date` |
| T | Anticipated Date | `Earliest_Anticipated_Start_Date__c` |
| U | Final Join Date | `final_projected_join_date` |
| V | Date Source | `date_source` |
| W | Projected Quarter | `projected_quarter` |
| X | Expected AUM | Sheets formula `=IF(AND(W<>"",J="NO"),G*Q,0)` |

### New columns to add (append after X to avoid formula breakage)

| Col | Header | Source | Notes |
|-----|--------|--------|-------|
| Y | AUM Tier (2-tier) | `< $75M` or `≥ $75M` from `COALESCE(Underwritten_AUM__c, Amount)` | Or reuse existing col I with new bucket logic |
| Z | Duration Bucket | `Within 1 SD`, `1-2 SD`, `2+ SD` | Computed from `days_in_current_stage` vs stage thresholds |
| AA | Duration Multiplier | `1.0`, `0.667`, `0.393`, etc. | Lookup from bucket + stage |
| AB | Baseline P(Join) | Product of flat rates (no penalty) | The current Q column value |
| AC | Adjusted P(Join) | Baseline × duration multiplier (applied to current stage rate only) | The new authoritative P(Join) |
| AD | Baseline Expected AUM | `=IF(AND(W<>"",J="NO"),G*AB,0)` | For comparison |
| AE | Adjusted Expected AUM | `=IF(AND(W<>"",J="NO"),G*AC,0)` | The new authoritative expected AUM |

**Key: Append after col X.** This avoids shifting existing formula references (H, Q, X all use hardcoded column letters). The existing X column remains the "flat model" expected AUM; the new AE column becomes the "adjusted model" expected AUM.

---

## UI Component Map

### ForecastMetricCards

**File:** `src/app/dashboard/forecast/components/ForecastMetricCards.tsx`
**Props:** `{ summary: ForecastSummary, windowDays, rates: ForecastRates }`
**Reads:** `summary.quarters[].expected_aum`, `summary.pipeline_total_aum`, `summary.total_opps`
**Changes needed:**
- `QuarterSummary` interface needs a second field (e.g., `expected_aum_adjusted`) if we want to show both baseline and adjusted per-quarter expected AUM
- Or simply replace the existing `expected_aum` computation upstream (in the `useMemo` that builds `adjustedSummary`) with the duration-penalized value — **this is the simpler path** and matches the "replace the model" approach

### ExpectedAumChart

**File:** `src/app/dashboard/forecast/components/ExpectedAumChart.tsx`
**Props:** `{ pipeline: ForecastPipelineRecord[] }`
**Reads:** `r.projected_quarter`, `r.StageName`, `r.expected_aum_weighted`
**Changes needed:**
- If `expected_aum_weighted` is updated with the duration-penalized value upstream (in the `useMemo`), this component needs zero changes — it just renders whatever values are in the records
- If we want to show baseline vs adjusted as separate series, the chart would need two data keys per stage-quarter cell

### PipelineDetailTable

**File:** `src/app/dashboard/forecast/components/PipelineDetailTable.tsx`
**Props:** `{ records: ForecastPipelineRecord[], onRowClick }`
**Current columns:** Advisor, Stage, AUM, P(Join), Expected AUM, Days, Proj. Join, Source
**Changes needed:**
- Add **Duration Bucket** column (badge: green/yellow/red for Within 1SD/1-2SD/2+SD)
- `ForecastPipelineRecord` needs a `duration_bucket` field (computed in the `useMemo`)
- Add to `SortField` union and comparator if sortable
- Optional: show baseline vs adjusted P(Join) as a tooltip or secondary value

### MonteCarloPanel

**File:** `src/app/dashboard/forecast/components/MonteCarloPanel.tsx`
**Props:** `{ results: MonteCarloResponse, pipeline?: ForecastPipelineRecord[], onOppClick? }`
**Changes needed for drilldown:**
- Add Duration Bucket column to drilldown table header and rows
- Update `colSpan={11}` on dashed separator line to match new column count
- Add Duration Bucket to CSV export columns (handleExportCSV, lines 152-187)
- Optional: add confidence tier label to quarter cards

---

## BigQuery View Current State

### vw_forecast_p2 — What already exists

| Column | Present? | Notes |
|--------|----------|-------|
| `days_in_current_stage` | ✅ Yes | `DATE_DIFF(CURRENT_DATE(), DATE(current_stage_entry_ts), DAY)` |
| `aum_tier` | ✅ Yes | **BUT uses 4 buckets** (`< $25M, $25-75M, $75-150M, > $150M`), not the 2-tier split needed |
| `Opportunity_AUM` | ✅ Yes | Raw dollars |
| `Opportunity_AUM_M` | ✅ Yes | `/1e6` |
| `p_join` | ✅ Yes | Flat rates from hardcoded cohort |
| `expected_aum_weighted` | ✅ Yes | `Opportunity_AUM * p_join` |
| `duration_bucket` | ❌ Missing | Need: CASE on `days_in_current_stage` vs stage-specific thresholds |
| `duration_multiplier` | ❌ Missing | Need: lookup from `duration_bucket` + `StageName` |
| `aum_tier_2` (2-tier) | ❌ Missing | Need: `CASE WHEN AUM < 75M THEN 'Lower' ELSE 'Upper' END` |
| Tiered rates | ❌ Missing | `historical_rates` CTE is a single row; need per-tier rates |
| `baseline_p_join` | ❌ Missing | Flat-rate P(Join) before duration adjustment |
| `adjusted_p_join` | ❌ Missing | Duration-penalized P(Join) |

### What needs to change in the BQ view

**Option A: Update vw_forecast_p2 directly** — Add `duration_bucket`, `duration_multiplier`, `aum_tier_2`, and adjust the `historical_rates` CTE to produce per-tier rates. This makes the view self-contained but couples the penalty logic to the view's hardcoded cohort window.

**Option B (recommended): Keep the view simple, compute penalties client-side** — The view already provides `days_in_current_stage`, `aum_tier`, and `StageName`. The duration penalty and tiered rates can be computed entirely in the `useMemo` in page.tsx, in `recomputeP2WithRates`, and in the Monte Carlo SQL. This matches the existing pattern where the view provides raw data and the client-side memo applies dynamic rates from the selected window.

### vw_funnel_audit — Reusable duration data

Has `days_in_sp`, `days_in_negotiating`, `days_in_signed` for resolved deals. Could be used to compute percentile-based thresholds, but the research already provides fixed thresholds (from the 2yr cohort avg+stddev). No view changes needed for the audit trail.

---

## Key Implementation Risks

### 1. Monte Carlo SQL complexity (HIGH)

The current Monte Carlo uses global `@rate_*` parameters. Per-deal rates require restructuring the SQL to compute `deal_rates` inline (from `days_in_current_stage` and `aum_tier`) and JOIN them to the simulation CTE. This is the most complex change because:
- The rates must be computed inside the BQ query (not passable as per-deal parameters)
- The duration thresholds and multipliers need to be hardcoded in the SQL or passed as structured parameters
- Testing is hard — the simulation takes 30-60 seconds to run

**Mitigation:** Compute the per-deal adjusted rates in a `deal_rates` CTE that reads `days_in_current_stage` and `aum_tier` from `open_pipeline`. The Bernoulli draws use `dr.rate_*` instead of `@rate_*`. The flat `@rate_*` params become the *base* rates that the CTE adjusts.

### 2. Sheets formula column shift (MEDIUM)

Current Sheets formulas in columns H, Q, and X use hardcoded column letters (`=G{row}/1000000`, `=IF(K<>"",K,1)*...`). Inserting new columns before X would break these formulas. **Mitigation:** Append new columns after X (as cols Y-AE) instead of inserting them.

### 3. Four-place P(Join) synchronization (MEDIUM)

P(Join) is computed in 4 places: BQ view, page.tsx useMemo, Monte Carlo SQL, and Sheets export. All four must produce the same result for the same deal. The current codebase already has this synchronization challenge (the view uses a hardcoded window while the UI uses a dynamic window), and it's managed by having the client-side memo and export overwrite the view values.

**Mitigation:** Define the duration penalty logic once in a shared utility function and call it from page.tsx, the export route, and inline it in the Monte Carlo SQL.

### 4. `aum_tier` column conflict (LOW)

The existing `aum_tier` column in vw_forecast_p2 uses 4 buckets. The new model needs a 2-tier split at $75M. Options:
- Add a new `aum_tier_2` column (safest — no breaking change)
- Reuse the existing column with new logic (simpler but changes the view's existing output)
- Compute the 2-tier classification client-side from `Opportunity_AUM_M` (simplest — no view change)

**Recommendation:** Compute client-side: `const tier = (r.Opportunity_AUM_M * 1e6) < 75_000_000 ? 'Lower' : 'Upper'`. This avoids any view changes and is trivially testable.

### 5. Tiered rates computation (LOW)

The current `getForecastRates` returns a single flat row. For tiered rates, it needs to return rates per tier. Options:
- Modify the query to GROUP BY tier and return 2 rows → requires changing the `ForecastRates` interface and all consumers
- Run 2 separate queries (one per tier) → simple but doubles the query cost
- Compute both tiers in one query and return a `{ lower: ForecastRates, upper: ForecastRates, flat: ForecastRates }` object → cleanest API

**Recommendation:** Extend `getForecastRates` to return `{ flat: ForecastRates, lower: ForecastRates, upper: ForecastRates }` where `lower` and `upper` are filtered by the $75M AUM threshold. Fall back to `flat` when a tier's cohort_count < 15.

### 6. Duration penalty constants (LOW)

The multipliers (0.393, 0.667, 0.176, etc.) and thresholds (36d, 64d, 67d, etc.) are derived from the research and should be treated as configuration, not hardcoded magic numbers. Define them in a shared constants file so they can be updated when thresholds are recalibrated annually.
