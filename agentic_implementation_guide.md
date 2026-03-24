# Pipeline Forecast — Current Implementation Reference

> Last updated: 2026-03-23
> This document describes the **as-built** forecast page, not a planning guide.
> Use it as a reference for understanding the current logic, data flow, and methodology.

---

## Feature Summary

| Capability | Implementation | Key Files |
|-----------|---------------|-----------|
| Deterministic expected-value forecast | BQ view + client-side rate recomputation | `sql/vw_forecast_p2.sql`, `src/lib/queries/forecast-pipeline.ts` |
| Monte Carlo simulation (5K trials) | BQ SQL with dynamic quarter grouping | `src/lib/queries/forecast-monte-carlo.ts` |
| Historical conversion rates | Resolved-only cohort, "reached or beyond" denominators | `src/lib/queries/forecast-rates.ts` |
| Conversion window toggle | 180d / 1yr / 2yr / All time | `ForecastTopBar.tsx`, rates query, client-side recomputation |
| Monte Carlo drilldown + CSV export | Per-deal win frequency, P10/P50/P90 membership | `MonteCarloPanel.tsx` |
| Scenario runner | Rate overrides, persistent to Neon DB, shareable via URL | `ScenarioRunner.tsx`, `SavedScenariosList.tsx` |
| Google Sheets export | Two tabs: "BQ Forecast P2" + "BQ Audit Trail" | `src/app/api/forecast/export/route.ts` |
| Audit trail with rate flags | Numerator/denominator columns for each stage transition | `sql/vw_funnel_audit.sql` |

---

## Data Architecture

### BigQuery Views

**`vw_forecast_p2`** — Open pipeline with deterministic forecast
- Source: `vw_funnel_master` (open SQOs only: not On Hold, Closed Lost, or Joined)
- Bakes in historical rates from Jun-Dec 2025 resolved cohort
- Computes: `p_join`, `expected_days_remaining`, `model_projected_join_date`, `final_projected_join_date`, `projected_quarter`, `expected_aum_weighted`
- `final_projected_join_date` = `Earliest_Anticipated_Start_Date__c` if set, else model date
- `projected_quarter` = dynamic string like "Q2 2026" derived from `final_projected_join_date`
- Rate columns are NULLed out for stages the deal has already passed (e.g., a Negotiating deal has NULL for `rate_sqo_to_sp`)

**`vw_funnel_audit`** — Full stage history for all opps (no date filter)
- Source: `vw_funnel_master` (all primary opp records)
- Backfilled stage timestamps via COALESCE chains (does NOT include `Stage_Entered_Closed__c`)
- Conversion rate numerator/denominator flags baked in (pre-filtered to resolved SQOs)
- Date filtering applied at query time based on selected window

### Prisma Model

**`ForecastScenario`** — Saved Monte Carlo scenarios
- `quartersJson` (Json?) — Array of `{ label, p10, p50, p90, mean }` per quarter
- `perOppResults` (Json?) — Per-deal simulation data
- Rate overrides, historical rate snapshot, pipeline metadata
- Shareable via `shareToken` (unique, auto-generated)

---

## Conversion Rate Methodology

### Cohort Selection
- **Resolved SQOs only**: `SQO_raw = 'Yes' AND StageName IN ('Joined', 'Closed Lost')`
- Excludes open pipeline deals to avoid deflating rates with unresolved outcomes
- Aligns with SGM Hub methodology

### "Reached This Stage or Beyond" Denominators
- Prevents >100% rates when deals skip stages (e.g., join without a Signed timestamp)
- Each denominator includes deals that reached that stage OR any later stage

```
SQO→SP rate:
  Numerator   = reached SP or Neg or Signed or Joined
  Denominator = all resolved SQOs

SP→Neg rate:
  Numerator   = reached Neg or Signed or Joined
  Denominator = reached SP or Neg or Signed or Joined

Neg→Signed rate:
  Numerator   = reached Signed or Joined
  Denominator = reached Neg or Signed or Joined

Signed→Joined rate:
  Numerator   = Joined
  Denominator = reached Signed or Joined
```

### Stage Timestamp Backfill (COALESCE chains)
- `eff_sp_ts` = COALESCE(SP, Neg, Signed, Joined) — NOT Closed
- `eff_neg_ts` = COALESCE(Neg, Signed, Joined)
- `eff_signed_ts` = COALESCE(Signed, Joined)
- `eff_joined_ts` = COALESCE(Joined, advisor_join_date__c)
- `Stage_Entered_Closed__c` is **never** included — Closed Lost is a terminal state, not stage progression

### Window Toggle
- **180d / 1yr / 2yr**: `DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL N DAY)`
- **All time**: No date filter — uses all resolved SQOs in the system
- Default: 1yr (365 days)

### Velocity (Avg Days)
- `avg_days_sqo_to_sp`: Date_Became_SQO__c → eff_sp_ts
- `avg_days_in_sp`: eff_sp_ts → eff_neg_ts
- `avg_days_in_neg`: eff_neg_ts → eff_signed_ts
- `avg_days_in_signed`: eff_signed_ts → eff_joined_ts
- Only computed from deals with both timestamps and where entry <= exit

---

## P(Join) Calculation

Product of remaining stage conversion rates:

| Current Stage | P(Join) Formula |
|--------------|----------------|
| Discovery / Qualifying | sqo_to_sp × sp_to_neg × neg_to_signed × signed_to_joined |
| Sales Process | sp_to_neg × neg_to_signed × signed_to_joined |
| Negotiating | neg_to_signed × signed_to_joined |
| Signed | signed_to_joined |

### Client-Side Rate Recomputation

The BQ view (`vw_forecast_p2`) bakes in rates from a fixed Jun-Dec 2025 cohort. When the user changes the window toggle, the **client-side `useMemo`** in `page.tsx` recomputes `p_join`, `expected_aum_weighted`, `expected_days_remaining`, `final_projected_join_date`, `projected_quarter`, and the summary for all pipeline records using the dynamically-fetched rates.

This means what you see on screen always uses the selected window's rates, even though the raw BQ data has different baked-in values.

The Sheets export also recomputes P2 rows with the dynamic rates before writing (`recomputeP2WithRates()` in the export route).

---

## Weighted Pipeline (Expected AUM) Calculation

### What It Answers
"Given our historical conversion rates, what is the probability-weighted AUM we expect to close per quarter?"

### Formula
For each open deal:
```
Expected AUM = P(Join) × Raw AUM
```

Where `Raw AUM = COALESCE(Underwritten_AUM__c, Amount)` from Salesforce.

### Worked Example (1yr window, rates as of 2026-03-23)

Historical rates (1yr, resolved only):
```
SQO→SP:       68.4%
SP→Neg:       36.8%
Neg→Signed:   42.3%
Signed→Joined: 83.6%
```

**Deal A: $500M Discovery deal**
```
P(Join) = 0.684 × 0.368 × 0.423 × 0.836 = 0.089 (8.9%)
Expected AUM = $500M × 0.089 = $44.5M
```

**Deal B: $100M Negotiating deal**
```
P(Join) = 0.423 × 0.836 = 0.354 (35.4%)
Expected AUM = $100M × 0.354 = $35.4M
```

**Deal C: $200M Signed deal**
```
P(Join) = 0.836 = 83.6%
Expected AUM = $200M × 0.836 = $167.2M
```

### Quarter Assignment
Each deal's expected AUM is assigned to a quarter based on `final_projected_join_date`:
- If `Earliest_Anticipated_Start_Date__c` is set → use it (date source = "Anticipated")
- Otherwise → model date = today + expected_days_remaining (date source = "Model")

`expected_days_remaining` = sum of avg stage durations for remaining stages, minus days already spent in current stage, floored at 0.

### Metric Cards
The Expected AUM metric cards sum `expected_aum_weighted` across all deals projected for each quarter:
```
Expected Q2 2026 AUM = SUM(expected_aum_weighted) WHERE projected_quarter = 'Q2 2026'
```

### Rate Sensitivity
When the user changes the window toggle, all P(Join) values and expected AUM are recomputed client-side using the new rates. The metric cards, pipeline table, and expected AUM chart all update instantly — no BQ round-trip.

---

## Monte Carlo Simulation

### What It Answers
"Given uncertainty in which deals actually close, what's the range of total AUM outcomes per quarter?" The P10 is the bear case (only 10% of simulated outcomes were worse), P50 is the base case, P90 is the bull case.

### How It Differs From Weighted Pipeline
Weighted pipeline gives a single point estimate per deal. Monte Carlo captures the **distribution of outcomes** — especially important when a few whale deals dominate the pipeline and could swing total AUM by billions.

### SQL Structure (BigQuery)

```
open_pipeline CTE → get all open SQO deals with AUM, stage, dates
trials CTE → GENERATE_ARRAY(1, 5000)
simulation CTE → CROSS JOIN (deals × trials), Bernoulli draws per stage via RAND()
```

Each deal in each trial independently flips a coin at each remaining stage. If all flips succeed, the deal "joins" in that trial.

### Bernoulli Draw Logic (Exact SQL Pattern)

For each deal × trial combination, the simulation runs independent random draws per remaining stage:

```sql
CASE
  WHEN StageName IN ('Discovery', 'Qualifying')
  THEN (CASE WHEN RAND() < @rate_sqo_sp THEN 1 ELSE 0 END)
       * (CASE WHEN RAND() < @rate_sp_neg THEN 1 ELSE 0 END)
       * (CASE WHEN RAND() < @rate_neg_signed THEN 1 ELSE 0 END)
       * (CASE WHEN RAND() < @rate_signed_joined THEN 1 ELSE 0 END)
  WHEN StageName = 'Sales Process'
  THEN (CASE WHEN RAND() < @rate_sp_neg THEN 1 ELSE 0 END)
       * (CASE WHEN RAND() < @rate_neg_signed THEN 1 ELSE 0 END)
       * (CASE WHEN RAND() < @rate_signed_joined THEN 1 ELSE 0 END)
  WHEN StageName = 'Negotiating'
  THEN (CASE WHEN RAND() < @rate_neg_signed THEN 1 ELSE 0 END)
       * (CASE WHEN RAND() < @rate_signed_joined THEN 1 ELSE 0 END)
  WHEN StageName = 'Signed'
  THEN (CASE WHEN RAND() < @rate_signed_joined THEN 1 ELSE 0 END)
  ELSE 0
END AS joined_in_trial
```

Key properties:
- Each `RAND()` call is independent — a deal can pass one stage but fail the next
- The multiplication means ALL remaining stages must succeed (product = 1) for the deal to join
- A Discovery deal needs 4 independent successes; a Signed deal needs only 1
- Each trial produces a different random outcome — the same deal may join in trial #1 but not trial #2

### Projected Join Date in the Simulation

The simulation also computes a per-deal `projected_join_date` to assign deals to quarters:

```sql
CASE
  WHEN Earliest_Anticipated_Start_Date__c IS NOT NULL
  THEN Earliest_Anticipated_Start_Date__c
  ELSE DATE_ADD(CURRENT_DATE(), INTERVAL expected_days_remaining DAY)
END AS projected_join_date
```

This date is the same across all trials for a given deal — only the binary "joined or not" changes per trial.

### Trial Aggregation (Aggregate Query)

For each trial, sum the AUM of deals that joined, grouped by quarter:
```sql
SELECT trial_id, quarter_label, SUM(CASE WHEN joined_in_trial = 1 AND is_zero_aum = 0 THEN Opportunity_AUM ELSE 0 END) AS aum
FROM simulation
GROUP BY trial_id, quarter_label
```

Then take percentiles across the 5,000 trials:
```sql
SELECT quarter_label,
  APPROX_QUANTILES(aum, 100)[OFFSET(10)] AS p10,
  APPROX_QUANTILES(aum, 100)[OFFSET(50)] AS p50,
  APPROX_QUANTILES(aum, 100)[OFFSET(90)] AS p90,
  AVG(aum) AS mean
FROM trial_quarter_aum
GROUP BY quarter_label
```

### Per-Deal Win Frequency (Per-Opp Query)

For each deal × quarter, count what fraction of 5,000 trials it closed in:
```sql
SELECT opp_id, quarter_label,
  SAFE_DIVIDE(COUNTIF(joined_in_trial = 1 AND is_zero_aum = 0), 5000) AS win_pct,
  AVG(CASE WHEN joined_in_trial = 1 THEN Opportunity_AUM END) AS avg_aum
FROM simulation
GROUP BY opp_id, quarter_label
HAVING win_pct > 0
```

This `win_pct` is what appears in the drilldown's "Won in" column. It's the **empirical probability** from the simulation, not the deterministic P(Join). They're close but not identical because:
- P(Join) is the exact product of rates
- `win_pct` is the observed frequency from 5,000 random trials (subject to sampling noise)

### Worked Example

Given 5,000 trials and rates SQO→SP=68%, SP→Neg=37%, Neg→Signed=42%, Signed→Joined=84%:

**$500M Discovery deal:**
- P(Join) deterministic = 0.68 × 0.37 × 0.42 × 0.84 = 8.9%
- Monte Carlo win_pct ≈ 8.5-9.5% (varies per run)
- In ~450 of 5,000 trials, this deal closes and adds $500M to that trial's total
- In ~4,550 trials, it contributes $0

**$200M Signed deal:**
- P(Join) = 84%
- Monte Carlo win_pct ≈ 83-85%
- In ~4,200 trials, this deal adds $200M
- In ~800 trials, it contributes $0

The P10 total for a quarter is the AUM at the 500th-worst trial. If the pipeline is concentrated in a few whale deals, P10 and P90 will be far apart — accurately reflecting the uncertainty.

### Dynamic Quarter Grouping

Quarters are derived from `projected_join_date` via:
```sql
CONCAT('Q', EXTRACT(QUARTER FROM projected_join_date), ' ', EXTRACT(YEAR FROM projected_join_date))
```

No hardcoded Q2/Q3 — the simulation returns whatever quarters the pipeline projects into.

### Two Parallel Queries

1. **Aggregate query**: Groups by trial_id × quarter_label → P10/P50/P90/mean per quarter
2. **Per-opp query**: Groups by opp_id × quarter_label → win frequency and avg AUM per deal

Both run in parallel. Each gets independent RAND() draws (different random seeds but statistically stable at 5K trials).

### Response Type

```typescript
interface MonteCarloResponse {
  quarters: Array<{ label: string; p10: number; p50: number; p90: number; mean: number }>;
  perOpp: Array<{ oppId: string; quarterLabel: string; winPct: number; avgAum: number }>;
  trialCount: number;
  ratesUsed: { sqo_to_sp, sp_to_neg, neg_to_signed, signed_to_joined };
}
```

### Auto-Run Behavior
- Monte Carlo auto-runs on page load (after pipeline + rates load)
- Auto-re-runs when the window toggle changes
- Skipped on first load if a shared scenario URL param is present

---

## Monte Carlo Drilldown

### Sort Order
Deals are sorted by **simulation win rate** (descending), with raw AUM as tiebreaker. This puts the most reliable closers first — important for the bear case (P10) where only high-probability deals are likely in the winning set.

### P10/P50/P90 Membership
Each deal gets `inP10`, `inP50`, `inP90` flags based on whether its cumulative raw AUM (walking down the sorted list) is within the scenario's target AUM (with 5% tolerance). A deal can be in multiple scenarios (e.g., a Signed deal is typically in P10, P50, and P90).

### CSV Export
The drilldown Export CSV button produces a file with:
- All BQ Forecast P2 fields (Opp ID, Advisor, SGM, SGA, Stage, AUM, rates, dates, etc.)
- `Won in (MC)` — Monte Carlo simulation win percentage
- `In P10 (Bear)` / `In P50 (Base)` / `In P90 (Bull)` — YES/NO
- Salesforce URL for easy linking

---

## Google Sheets Export

### Target Sheet
`1Iz9X6HY-bsAGBNkuQWH-SYoB7Xzy-9Hkg2Kk8ipxKQY`

### Two Tabs

**BQ Forecast P2** — Open pipeline with recomputed rates
- P2 rows are recomputed with the selected window's dynamic rates before export
- Includes: Opp ID, Advisor, SGM, SGA, Stage, AUM, per-stage rates, P(Join), projected dates, projected quarter, expected AUM
- Projected Quarter and Expected AUM are dynamic columns

**BQ Audit Trail** — Historical funnel data
- Filtered by the selected window (180d/1yr/2yr/All time)
- Includes conversion rate numerator/denominator flags (9 columns)
- Flags are pre-filtered to resolved SQOs: `SUM(SP_Numerator)/SUM(SP_Denominator)` gives the SQO→SP rate without additional filtering
- Auto-expands sheet rows if data exceeds current grid limits

---

## UI Components

### Page: `src/app/dashboard/forecast/page.tsx`
- Fetches rates + pipeline on load, recomputes pipeline with dynamic rates via `useMemo`
- Auto-runs Monte Carlo after data loads
- Passes `adjustedPipeline` and `adjustedSummary` (rate-recomputed) to all child components

### ForecastTopBar
- Window toggle: 180d / 1yr / 2yr / All time
- Run Monte Carlo button (for manual re-runs)
- Export to Sheets button (passes windowDays)

### ForecastMetricCards
- Open Pipeline AUM (total)
- One card per dynamic quarter: Expected AUM + opp count
- Conversion Window card: cohort size + date range

### ExpectedAumChart
- Stacked bar chart: Expected AUM by stage × quarter
- Quarters and colors are dynamic (QUARTER_COLORS palette)

### ConversionRatesPanel
- Historical Conversion Rates table: SQO→SP, SP→Neg, Neg→Signed, Signed→Joined
- Shows rate + avg days for each transition
- SQO→Joined summary row (product of rates, sum of days)
- Cohort size and window range at bottom

### MonteCarloPanel
- Quarter cards with P10/P50/P90 values (dynamic, N quarters)
- Clickable cards open drilldown table
- Drilldown: sorted by win rate, P10/P50/P90 dots, Proj. Join date, CSV export
- Bar chart: P10/P50/P90 per quarter with dynamic colors

### PipelineDetailTable
- Sortable table: Advisor, Stage, AUM, P(Join), Expected AUM, Days, Proj. Join, Source
- Stage filter tabs
- Expected AUM column uses `expected_aum_weighted` (rate-recomputed)

### ScenarioRunner
- Rate override inputs (4 sliders)
- Run & Save / Run without saving
- Saves to Prisma with `quartersJson`

### SavedScenariosList
- Lists saved scenarios with quarter P50 values
- Load / Share / Delete actions

---

## Known Considerations

### AUM Variance
See `AUM_variance_consideration.md` for detailed analysis. Key issue: CV% exceeds 100% in 3 of 4 stages. Top 20 deals represent 49% of pipeline AUM. The Monte Carlo handles this correctly (wide P10/P90 spreads reflect real uncertainty), but the drilldown "above/below the line" concept can feel arbitrary when many deals have similar win rates.

### BQ View vs Client-Side Rates
The `vw_forecast_p2` view bakes in Jun-Dec 2025 rates. The dashboard overrides these client-side with the selected window's rates. The Sheets export also recomputes with dynamic rates. The view's baked-in rates are only used as a fallback if rates haven't loaded yet.

### Cache
- Pipeline data: cached via `unstable_cache` with 6-hour TTL, tag `dashboard`
- Rates: cached with 12-hour TTL
- Monte Carlo: not cached (POST request, fresh BQ query each time)
- Clear cache: `rm -rf .next/cache` locally, or hit `/api/admin/refresh-cache` in production

---

## File Index

| File | Purpose |
|------|---------|
| `sql/vw_forecast_p2.sql` | BQ view: open pipeline with deterministic forecast |
| `sql/vw_funnel_audit.sql` | BQ view: full stage history with rate flags |
| `src/lib/queries/forecast-pipeline.ts` | Pipeline query + ForecastPipelineRecord/ForecastSummary types |
| `src/lib/queries/forecast-monte-carlo.ts` | Monte Carlo query + MonteCarloResponse types |
| `src/lib/queries/forecast-rates.ts` | Conversion rates query + ForecastRates type |
| `src/lib/queries/forecast-export.ts` | Export queries for P2 + Audit rows |
| `src/app/api/forecast/monte-carlo/route.ts` | POST: run Monte Carlo simulation |
| `src/app/api/forecast/pipeline/route.ts` | GET: pipeline data (pass-through) |
| `src/app/api/forecast/rates/route.ts` | GET: conversion rates for selected window |
| `src/app/api/forecast/export/route.ts` | POST: Google Sheets export (recomputes P2 with dynamic rates) |
| `src/app/api/forecast/scenarios/route.ts` | GET/POST: saved scenarios |
| `src/app/api/forecast/scenarios/[id]/route.ts` | DELETE: remove scenario |
| `src/app/api/forecast/scenarios/share/[shareToken]/route.ts` | GET: load shared scenario |
| `src/app/dashboard/forecast/page.tsx` | Main page: data fetching, rate recomputation, auto-run MC |
| `src/app/dashboard/forecast/components/ForecastTopBar.tsx` | Window toggle + action buttons |
| `src/app/dashboard/forecast/components/ForecastMetricCards.tsx` | Summary metric cards (dynamic quarters) |
| `src/app/dashboard/forecast/components/ExpectedAumChart.tsx` | Bar chart: expected AUM by stage × quarter |
| `src/app/dashboard/forecast/components/ConversionRatesPanel.tsx` | Historical conversion rates table |
| `src/app/dashboard/forecast/components/MonteCarloPanel.tsx` | MC results: quarter cards, drilldown, chart, CSV export |
| `src/app/dashboard/forecast/components/PipelineDetailTable.tsx` | Sortable pipeline detail table |
| `src/app/dashboard/forecast/components/ScenarioRunner.tsx` | Rate override + save scenario |
| `src/app/dashboard/forecast/components/SavedScenariosList.tsx` | List/load/share/delete saved scenarios |
| `src/app/dashboard/forecast/components/AdvisorForecastModal.tsx` | Individual advisor drill-down modal |
| `src/lib/api-client.ts` | Client-side API types and fetch functions |
| `prisma/schema.prisma` | ForecastScenario model (quartersJson, perOppResults) |
