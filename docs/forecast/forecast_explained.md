# Pipeline Forecast System — Full Technical Reference

**Purpose:** Complete reference for understanding how the Savvy Wealth pipeline forecast works today, what the backtesting revealed, and what needs to be built next (two-component realization model with auditable Sheets export). Written for an LLM agent that will implement the next phase.

**Date:** March 25, 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Weighted Pipeline Forecast (Current Production Model)](#2-weighted-pipeline-forecast)
3. [Monte Carlo Simulation](#3-monte-carlo-simulation)
4. [SQO Target Calculator](#4-sqo-target-calculator)
5. [Google Sheets Export (Current)](#5-google-sheets-export)
6. [Backtesting Results and What They Revealed](#6-backtesting-results)
7. [Two-Component Realization Model (What Needs to Be Built)](#7-two-component-realization-model)
8. [Key Files Reference](#8-key-files-reference)

---

## 1. System Overview

The forecast system predicts how much AUM (Assets Under Management) will join Savvy Wealth by converting pipeline deals through four stages:

```
Discovery/Qualifying → Sales Process → Negotiating → Signed → Joined
```

Three models operate in parallel:

| Model | Question It Answers | Accuracy (MAPE) | Status |
|---|---|---|---|
| **Weighted Pipeline** (penalized + tiered) | "What is this pipeline worth in total?" | 70% vs eventual, 198% vs quarterly | Production |
| **Monte Carlo** (5,000 trials) | "What's the P10/P50/P90 range?" | 60% coverage (should be 80%) | Production |
| **SQO Target Calculator** | "How many SQOs do we need?" | +/-3-7 SQOs in stable quarters | Production |
| **Two-Component Realization** | "How much AUM will join THIS quarter?" | **17% MAPE** | **NOT YET BUILT** |

The weighted pipeline and Monte Carlo systematically overestimate quarterly AUM by 2-3x. They're useful for pipeline health trending and deal ranking, but not for quarterly dollar forecasting. The two-component model was designed specifically for quarterly prediction and achieves 17% MAPE in backtesting — an 8x improvement.

**Data source:** All models query `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` in BigQuery plus a pre-computed view `vw_forecast_p2` for the open pipeline.

---

## 2. Weighted Pipeline Forecast

### How P(Join) Is Calculated Per Deal

Each open pipeline deal gets a probability of joining (`P(Join)`) that is the product of its remaining stage transition rates, with the current-stage rate adjusted by a duration penalty.

**Stage transition rates** are computed from a trailing cohort (180d, 1yr, 2yr, or all-time) of resolved deals (Joined + Closed Lost). Four rates:

| Transition | What It Measures |
|---|---|
| SQO → SP | Fraction of SQOs that reach Sales Process (or beyond) |
| SP → Neg | Fraction of SP deals that reach Negotiating (or beyond) |
| Neg → Signed | Fraction of Neg deals that reach Signed (or beyond) |
| Signed → Joined | Fraction of Signed deals that actually Join |

The "reached or beyond" methodology uses COALESCE backfill — a deal that skipped from Discovery directly to Negotiating is counted as having reached SP. This prevents stage-skipping from deflating rates.

**A deal's P(Join) depends on its current stage.** A Negotiating deal only needs two more transitions:

```
P(Join) for Negotiating deal = Neg→Signed × Signed→Joined
P(Join) for Discovery deal   = SQO→SP × SP→Neg × Neg→Signed × Signed→Joined
```

### AUM Tier Segmentation

Deals are split into two tiers based on AUM:

| Tier | AUM Range | Behavior |
|---|---|---|
| **Lower** | < $75M | Higher conversion rates |
| **Upper** | ≥ $75M | Lower conversion rates (~half of Lower) but 5-10x more AUM per deal |

Each tier has its own set of four rates computed from the trailing cohort. If the Upper tier cohort has fewer than 15 resolved deals, the system falls back to flat (non-tiered) rates for that tier. This is the `TIER_FALLBACK_MIN_COHORT` constant in `forecast-config.ts`.

**The tier boundary ($75M) and fallback threshold (15 deals) are hardcoded constants**, not dynamically derived.

### Duration Penalties

Deals that have been in a stage longer than normal get their current-stage rate reduced. The penalty is based on standard deviation buckets from the 2-year resolved cohort:

| Stage | Within 1 SD (days) | 1-2 SD (days) | 2+ SD (days) |
|---|---|---|---|
| Discovery/Qualifying | 0-36 | 37-64 | 65+ |
| Sales Process | 0-67 | 68-105 | 106+ |
| Negotiating | 0-50 | 51-81 | 82+ |
| Signed | No penalty | No penalty | No penalty |

The multiplier reduces the current-stage rate only (subsequent stage rates are unchanged):

| Stage | Within 1 SD | 1-2 SD | 2+ SD |
|---|---|---|---|
| Discovery/Qualifying | 1.0 (no change) | 0.667 | 0.393 |
| Sales Process | 1.0 | 0.755 | 0.176 |
| Negotiating | 1.0 | 0.682 | 0.179 |
| Signed | 1.0 | 1.0 | 1.0 |

**Worked example:** A Negotiating deal at 90 days (2+ SD), Lower tier:

```
Base rates (Lower):  Neg→Signed = 0.53,  Signed→Joined = 0.85
Duration multiplier: 0.179 (Negotiating, 2+ SD)
Adjusted Neg→Signed: min(0.53 × 0.179, 1) = 0.095
P(Join): 0.095 × 0.85 = 0.081 (8.1%)
vs. baseline P(Join): 0.53 × 0.85 = 0.451 (45.1%)
```

The penalty is applied via `computeAdjustedDeal()` in `src/lib/forecast-penalties.ts`. This function is the single source of truth — both the UI (`page.tsx` useMemo) and the Sheets export (`recomputeP2WithRates`) call it.

### Expected AUM Calculation

```
Expected AUM = Opportunity_AUM × adjustedPJoin
```

Zero-AUM deals (flagged by `is_zero_aum`) contribute $0 regardless of probability. The total weighted pipeline is the sum of all deal Expected AUMs.

### Why It Overestimates

The penalized model averages 198% MAPE vs quarterly actuals (i.e., predicts $1-3B when $300M-$1B lands). Three structural causes:

1. **Zombie pipeline:** 50-65% of deals at any snapshot are 2+ SD stale. Even with 0.18x penalties, a $500M Discovery deal at 0.393 × 3% base ≈ 1.2% still contributes $6M. Multiply by 50 zombie deals = $300M phantom value.

2. **AUM concentration:** Upper-tier deals convert at half the rate but carry 5-10x more AUM. Small probability × huge AUM = large expected value that rarely materializes.

3. **Intra-quarter blind spot:** $27-288M per quarter (growing to ~20%) comes from deals that enter and close within the same quarter — invisible to any snapshot model.

4. **PIT rate inflation:** The point-in-time resolved cohort is enriched for fast-closers (which disproportionately join), so real-time rates are structurally higher than retrospective rates.

---

## 3. Monte Carlo Simulation

### How It Works

Instead of computing a single expected value, Monte Carlo runs 5,000 simulated trials per deal to produce a probability distribution of outcomes.

**Per trial, per deal:**
1. For each remaining stage transition, flip a weighted coin using the deal's adjusted rate
2. If all coin flips succeed → deal "joins" in that trial
3. If any flip fails → deal does not join

**Example:** A Sales Process deal with rates SP→Neg=0.60, Neg→Signed=0.53, Signed→Joined=0.85:
- Trial 1: RAND()=0.45 < 0.60 ✓, RAND()=0.71 > 0.53 ✗ → not joined
- Trial 2: RAND()=0.12 < 0.60 ✓, RAND()=0.31 < 0.53 ✓, RAND()=0.22 < 0.85 ✓ → joined
- ... repeat 4,998 more times

### Quarter Assignment

Each deal that "joins" in a trial gets assigned to a quarter using:
1. **Anticipated start date** (if set) → that quarter
2. **Model-projected date** (if no anticipated date) → today + remaining average days by stage

### Output

The simulation aggregates across all 5,000 trials to produce per-quarter:

| Metric | Definition |
|---|---|
| **P10 (Bear)** | 10th percentile of trial outcomes — "worst reasonable case" |
| **P50 (Base)** | Median trial outcome |
| **P90 (Bull)** | 90th percentile — "best reasonable case" |
| **Mean** | Average across all trials |

Plus per-deal: `win_pct` (% of trials where the deal joined), `avg_aum` (average AUM when won).

### Implementation

The simulation runs entirely in BigQuery SQL using `CROSS JOIN` of deals × trial IDs and `RAND()` for coin flips. This is expensive (~60s timeout) but avoids round-tripping thousands of rows to the application server.

Key code: `src/lib/queries/forecast-monte-carlo.ts` → `simulationCTE()` builds the SQL. The API endpoint is `POST /api/forecast/monte-carlo`.

### Limitations from Backtesting

| Quarter | Actual | MC P10 | MC P90 | In Range? |
|---|---|---|---|---|
| Q4 2024 | $562M | $530M | $1,590M | Yes |
| Q1 2025 | $298M | $280M | $1,260M | Yes (barely) |
| Q2 2025 | $588M | $510M | $1,750M | Yes |
| Q3 2025 | $590M | $1,310M | $3,590M | **No (below P10)** |
| Q4 2025 | $1,031M | $2,630M | $4,310M | **No (below P10)** |

60% coverage vs expected 80%. The MC inherits the weighted model's overestimation — it uses the same inflated rates and zombie pipeline. The P10 "bear case" has never actually been beaten by reality in later quarters.

---

## 4. SQO Target Calculator

### How It Works

Given a quarterly AUM target (user-entered), the calculator determines how many SQOs are needed:

```
Expected AUM per SQO = Mean Joined AUM × SQO→Joined Rate
SQOs Needed = Target AUM / Expected AUM per SQO
```

Where:
- **Mean Joined AUM** = average AUM of deals that joined in the trailing window
- **SQO→Joined Rate** = product of all four stage transition rates (flat, not tiered)

### SQO Entry Quarter

The calculator also computes when SQOs need to enter the pipeline to close in time:

```
Entry Date = Quarter Midpoint (day 45) - Average Days SQO→Joined
```

This is implemented as a Sheets formula in the export, referencing the velocity from the Rates tab.

### Limitations

- **Whale sensitivity:** A single $1.5B deal joining changes the mean joined AUM by 30-40%, making the calculator say far more SQOs are needed than is realistic.
- **PIT rate instability in early quarters:** When the resolved cohort is thin (<150 deals), the SQO→Joined rate is volatile. By Q2 2025+ (250+ resolved deals), the calculator stabilizes to +/-3-7 SQOs of reality.
- **Uses flat rates, not tiered:** The SQO calculator uses the overall SQO→Joined rate, not tier-specific rates. This is intentional — you don't know the AUM of future SQOs.

---

## 5. Google Sheets Export (Current)

### Architecture

The export creates a brand-new Google Spreadsheet per export (in a shared Drive folder) with 5 tabs:

| Tab | Contents | Row Count |
|---|---|---|
| **BQ Forecast P2** | Every open pipeline deal with rates, P(Join), expected AUM, duration penalties | ~200-300 rows |
| **BQ Audit Trail** | Every resolved deal in the trailing cohort with stage timestamps, denominator/numerator flags | ~400-600 rows |
| **BQ Monte Carlo** | P10/P50/P90 summary + per-deal win% detail | ~200-300 rows |
| **BQ Rates and Days** | Conversion rates (flat + tiered) and avg days, all as Sheets formulas referencing Audit Trail | ~60 rows |
| **BQ SQO Targets** | Gap analysis with model inputs, per-quarter coverage, incremental SQOs needed | ~30-40 rows |

### Auditability Design

The export is designed to be fully auditable — a RevOps user can click any cell and trace the math:

1. **Rates tab** contains only Sheets formulas (`SUMPRODUCT`, `AVERAGEIFS`) that reference the Audit Trail tab columns. No hardcoded values. If you change the audit trail data, the rates recalculate.

2. **P2 tab** rate columns (K-N) are Sheets `IF` formulas that pick the tier-appropriate rate from the Rates tab via named ranges (`Lower_SQO_to_SP_rate`, `Upper_SQO_to_SP_rate`, etc.). P(Join) in column Q is `=K*L*M*N`.

3. **Named ranges** are created programmatically after writing the Rates tab. They point to specific cells (e.g., `Lower_SQO_to_SP_rate` → `'BQ Rates and Days'!B14`).

4. **SQO Targets tab** model inputs reference the Rates tab cells directly (e.g., `='BQ Rates and Days'!$B$6` for the SQO→SP rate).

### Export Flow (Code)

```
POST /api/forecast/export
  ├── getForecastExportP2()          → raw pipeline from BigQuery
  ├── getForecastExportAudit()       → resolved cohort from BigQuery
  ├── getTieredForecastRates()       → historical rates
  ├── getDateRevisionMap()           → date revision counts per deal
  ├── getJoinedAumByQuarter()        → actual joined AUM
  ├── prisma.forecastQuarterTarget   → user-set targets from Postgres
  │
  ├── recomputeP2WithRates()         → applies computeAdjustedDeal() to every row
  ├── runMonteCarlo()                → 5,000-trial simulation in BigQuery
  │
  ├── drive.files.create()           → new spreadsheet in shared folder
  ├── writeTab() × 5                 → populate each tab (500-row chunks)
  ├── batchUpdate (named ranges)     → create 13 named ranges
  └── prisma.forecastExport.create() → log the export
```

### Key Implementation Details

- **Chunking:** 500 rows per `sheets.spreadsheets.values.update()` call to avoid rate limits
- **Sheet expansion:** If a tab needs more rows than the default 1,000, it auto-expands via `updateSheetProperties`
- **Sanitization:** BigQuery timestamps (`{ value: "2026-01-01T..." }`) are unwrapped; nulls become empty strings
- **Service account auth:** Uses `GOOGLE_SHEETS_CREDENTIALS_JSON` (Vercel) or file path (local)
- **Permissions:** User gets editor access via `drive.permissions.create`

---

## 6. Backtesting Results

### What Point-in-Time (PIT) Correction Means

A valid backtest must only use data that was available at the time. We found and corrected three sources of data leakage:

| Leakage Source | What Leaked | Fix | Impact |
|---|---|---|---|
| **Conversion rates** | Deals resolved after snapshot included in rate cohort | Added `resolution_date < snapshot_date` | **Largest** — rates 2-7 ppt higher, forecast 5-15% higher |
| **AUM values** | Current AUM used instead of snapshot-time AUM | Rolled back via `OpportunityFieldHistory` | Moderate — -$1.4B to +$1.6B pipeline shift |
| **Anticipated dates** | Final-revised dates used instead of first-set dates | Rolled back to pre-snapshot value | Moderate — 40%+ of pipeline affected by Q2 2025 |

### Why Earlier Accuracy Claims (28% MAPE) Were Wrong

Prior documents reported the enhanced model achieved 28% error. After PIT correction, the real error is **60-71% vs eventual** (for settled quarters). The three errors compounded:
- Rate leakage made the model look less over-estimated than it was
- AUM leakage introduced noise
- Date leakage made anticipated dates look more accurate than they are at forecast time

### Summary Accuracy (All PIT-Corrected)

| Method | MAPE vs Quarterly | MAPE vs Eventual | Best Use |
|---|---|---|---|
| **Two-component (bands)** | **17%** | — | Quarterly AUM forecasting |
| SQO target calculator | +3-7 SQO gap | — | SQO capacity planning |
| Weighted + penalties + tiers | 198% | 70% | Pipeline health trending |
| Straight weighted (no penalties) | 591% | 304% | Not recommended |
| Monte Carlo P50 | 65-195% | — | Scenario/risk ranges |

### Data Availability Constraints

- **OpportunityFieldHistory** only available from Sep 2024 (pre-Sep field changes can't be rolled back)
- **Thin PIT cohorts** in early quarters: Q4 2024 had only 94 resolved deals for rate computation
- **Q3/Q4 2025 "eventual"** numbers are incomplete — open deals may still join
- **Q2 2025 is the most trustworthy data point:** good cohort size (260 deals), good PIT coverage, 12 months for deals to resolve

---

## 7. Two-Component Realization Model (What Needs to Be Built)

### The Model

The two-component model was backtested at **17% MAPE** but is not yet implemented in the codebase or the Sheets export. This is what needs to be built.

**Component A — Late-stage committed deals:**
- Filter: Negotiating + Signed deals with an `Earliest_Anticipated_Start_Date__c` falling in the target quarter
- Value: Sum of their AUM
- Apply a **realization rate** (not P(Join) — see below)
- Formula: `Component_A_forecast = Sum(AUM of Neg+Signed dated deals) × realization_rate`

**Component B — Historical surprise baseline:**
- Value: Trailing 4-quarter average of "surprise" AUM
- "Surprise" = all AUM that joined in a quarter that was NOT from a Neg+Signed deal with a dated anticipated start at quarter start
- This captures: fast-tracking SP deals, intra-quarter new pipeline, undated deals, Discovery deals that somehow closed
- Formula: `Component_B = AVG(surprise_aum) over prior 4 quarters`

**Total forecast:**
```
Quarterly Forecast = (Component A AUM × realization rate) + Component B
```

### What the Realization Rate Is (and Is Not)

The realization rate is NOT a conversion rate. It is NOT P(Join). It is:

```
                  AUM that actually joined from Component A deals
Realization = ─────────────────────────────────────────────────────
                Total AUM of all Component A deals at quarter start
```

It measures the joint probability that a dated, late-stage deal:
1. Closes at all (conversion)
2. Closes **on time** (in the quarter its date says)
3. Closes at approximately the AUM estimated

### Deal-Count Bands (Recommended Approach)

The realization rate declines as more deals get anticipated dates (the field goes from a strong commitment signal to routine pipeline management):

| Quarter | Component A Deals | Realization Rate |
|---|---|---|
| Q4 2024 | 6 | 94% |
| Q1 2025 | 10 | 56% |
| Q2 2025 | 5 | 59% |
| Q3 2025 | 13 | 43% |
| Q4 2025 | 22 | 34% |

Deal-count bands encode this relationship:

| Dated Deals in Quarter | Realization Rate | Rationale |
|---|---|---|
| < 10 | 60% | Small pool = high selectivity, only most committed deals have dates |
| 10-15 | 45% | Moderate pool, mixed quality |
| 15+ | 35% | Large pool, dates are widespread, lower average commitment |

**These bands are derived from 5 data points.** They should be refined each quarter as more data accumulates. Eventually a continuous function (e.g., `realization = 0.80 - 0.02 × deal_count`) may replace the step function.

### Backtesting Results

| Quarter | Actual | Two-Component (Bands) | Error | Prob Model | Error |
|---|---|---|---|---|---|
| Q1 2025 | $463M | $428M | -8% | $1,047M | +126% |
| Q2 2025 | $578M | $387M | -33% | $1,351M | +130% |
| Q3 2025 | $765M | $851M | +11% | $2,169M | +183% |
| Q4 2025 | $1,318M | $1,104M | -16% | $3,223M | +145% |
| **MAPE** | | **17%** | | | **146%** |

### Known Limitations

1. **Whale deals break all models.** Q1 2026 actual was $2,411M vs $496M forecast — driven by a single $1.5B deal. Without the whale, remaining 11 deals totaled $911M, which is in range. Whale deals (>$500M) should be presented as separate upside scenarios.

2. **Q2 2025 structural weak spot.** Only 5 dated deals ($181M), but $578M joined. When late-stage pipeline is thin, Component B dominates, and a trailing average can't predict quarter-to-quarter spikes.

3. **Component B is growing.** Surprise AUM has trended from $145M to $568M over 8 quarters. A flat trailing average will systematically under-predict if this growth continues. Consider a growth-adjusted trailing average.

4. **Bands are from 5 data points.** Directionally correct but statistically thin. Refine annually.

5. **No PIT correction yet.** The production implementation will use current pipeline state (not PIT-reconstructed), which is correct for forward forecasting but means the realization bands were calibrated on PIT data.

### What Needs to Be Built in the Codebase

#### 1. Component A Pipeline Query

A new BigQuery query that, for each target quarter:
- Filters open pipeline to Negotiating + Signed deals
- Filters to deals with `Earliest_Anticipated_Start_Date__c` in the target quarter
- Returns: deal count, total AUM, individual deal details

#### 2. Component B Historical Surprise Computation

A query or computation that:
- For each of the prior 4 completed quarters, computes total joined AUM minus Component A realized AUM
- Returns the trailing 4-quarter average

#### 3. Band Selection Logic

```typescript
function getRealizationRate(datedDealCount: number): number {
  if (datedDealCount < 10) return 0.60;
  if (datedDealCount < 15) return 0.45;
  return 0.35;
}
```

Should be configurable (stored in `forecast-config.ts` alongside duration penalties).

#### 4. Quarter Forecast Calculation

```
Component A forecast = total_dated_aum × getRealizationRate(dated_deal_count)
Component B forecast = trailing_4q_surprise_average
Total = Component A + Component B
```

#### 5. API Endpoint

New route or extension of existing forecast routes to serve the two-component forecast per quarter.

#### 6. UI Integration

Display alongside or as an alternative to the weighted pipeline and Monte Carlo results. Should show:
- Component A: deal count, total AUM, realization band used, forecast
- Component B: trailing 4Q surprise values, average
- Total forecast per quarter
- Comparison to target (if set)

### What Needs to Be Built in the Sheets Export

The current export has 5 tabs. The two-component model needs a **6th tab** (or extension of the SQO Targets tab) that is fully auditable:

#### New Tab: "BQ Realization Forecast" (or similar)

**Section 1: Model Inputs**
- Deal-count band thresholds and rates (hardcoded but visible)
- Trailing 4Q surprise values and average (from historical data)

**Section 2: Component A Detail (per quarter)**
- List of every Neg+Signed deal with an anticipated date in the quarter
- Columns: Opp ID, Advisor, Stage, AUM, Anticipated Date, Realization Band
- Subtotal: deal count, total AUM
- Formula: `Total AUM × Band Rate = Component A Forecast`

**Section 3: Component B**
- Row per prior quarter: total joined AUM, Component A realized AUM, surprise AUM
- Average of last 4 quarters

**Section 4: Forecast Summary**
- Per quarter: Component A forecast + Component B = Total Forecast
- Comparison to user targets (from SQO Targets tab)
- Whale deal flags (any deal >$500M in Component A gets flagged)

**Auditability requirements:**
- Component A deal list must reference rows in the P2 tab (so you can trace a deal from the realization forecast back to its full probability details)
- Realization rates should be in named cells (not buried in formulas) so they can be overridden for scenario analysis
- Surprise AUM computation should be traceable: total joined AUM (from actuals) minus Component A realized AUM (from the list of deals that actually joined from the dated pool)

#### Integration with Existing Tabs

- The **P2 tab** already has anticipated dates (column T) and stage (column E) — Component A deals can be identified by filtering these
- The **Rates tab** has avg days per stage — useful for the SQO entry quarter calculation
- The **SQO Targets tab** has targets — the realization forecast should reference these for gap analysis

---

## 8. Key Files Reference

### Forecast Logic

| File | Purpose |
|---|---|
| `src/lib/forecast-config.ts` | Duration thresholds, multipliers, AUM tier boundary, whale threshold |
| `src/lib/forecast-penalties.ts` | `computeAdjustedDeal()` — single source of truth for tier + penalty math |
| `src/lib/queries/forecast-rates.ts` | Queries historical conversion rates (flat + tiered) from BigQuery |
| `src/lib/queries/forecast-pipeline.ts` | Fetches `vw_forecast_p2` (open pipeline) + `joined_aum_by_quarter` |
| `src/lib/queries/forecast-monte-carlo.ts` | Monte Carlo SQL with 5K trials, aggregates by quarter |
| `src/lib/queries/forecast-export.ts` | Fetches P2 + audit rows for Sheets export |
| `src/lib/queries/forecast-date-revisions.ts` | Date revision counts per deal from `OpportunityFieldHistory` |

### API Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/forecast/monte-carlo` | POST | Run 5K-trial Monte Carlo, returns P10/P50/P90 + per-deal |
| `/api/forecast/export` | POST | Export all forecast data to a new Google Spreadsheet |
| `/api/forecast/sqo-targets` | GET/POST | Read/write quarterly AUM targets (stored in Postgres) |

### UI

| File | Purpose |
|---|---|
| `src/app/dashboard/forecast/page.tsx` | Main forecast page, `useMemo` recomputes pipeline with `computeAdjustedDeal()` |
| `src/app/dashboard/forecast/components/MonteCarloPanel.tsx` | Renders percentile cards, drilldown by (quarter, percentile) |

### Backtesting Documentation

| File | Purpose |
|---|---|
| `docs/forecast/backtesting_sql.md` | Every SQL query used in the backtest with rationale |
| `docs/forecast/forecast_modeling_backtest_results.md` | Full backtest results, methodology, and recommendations |

### Data

| Source | Purpose |
|---|---|
| `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` | Primary analytics view — all funnel data |
| `savvy-gtm-analytics.Tableau_Views.vw_forecast_p2` | Pre-computed open pipeline with stage timestamps |
| `savvy-gtm-analytics.Tableau_Views.vw_funnel_audit` | Resolved cohort with denominator/numerator flags |
| `savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory` | Field change audit trail (from Sep 2024) |
| Postgres `ForecastQuarterTarget` | User-entered quarterly AUM targets |
| Postgres `ForecastExport` | Log of all Sheets exports |
