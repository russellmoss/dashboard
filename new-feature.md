Where:
- Mean Joined AUM = mean AUM of deals that actually Joined (NOT all resolved deals) in the trailing window. Currently ~$65.5M all-time, ~$97.3M at 1yr. Use mean, not median — the backtest showed mean has MAE of 16.5 SQOs vs 74.7 for median.
- SQO→Joined Rate = product of all 4 stage conversion rates from the trailing window
- Both respond to the existing window toggle (180d / 1yr / 2yr / all-time)

### UI components:

1. **Target AUM input** — editable per quarter card, persisted to Neon DB
   - Prisma model: ForecastQuarterTarget { quarter: String @unique, targetAumDollars: Float, updatedAt, updatedBy }

2. **Required SQOs display** — computed from target ÷ (mean AUM × rate)
   - Show: "Need ~[X] SQOs from prior quarter to hit $[Y]M target"
   - Show the trailing velocity: "Based on ~[Z]-day avg SQO→Joined cycle"
   - Show sample size warning when joined deal count < 30 in the trailing window

3. **What-if rate sliders** — let users adjust each stage conversion rate independently
   - Default values = current trailing rates (from the selected window)
   - Sliders for: SQO→SP, SP→Neg, Neg→Signed, Signed→Joined
   - When adjusted, the SQO→Joined product recalculates, and Required SQOs updates in real time
   - "What if SP→Neg improves from 40% to 50%? Required SQOs drops from 118 to 94"

4. **What-if mean AUM slider** — let users adjust the mean joined AUM
   - "What if we target larger books ($100M avg instead of $65M)? Required SQOs drops from 118 to 77"

The what-if adjustments do NOT change the realization forecast or weighted pipeline. They only affect the SQO calculator output.

### Key query for mean_joined_aum (may already be in the rates query):
```sql
-- Mean AUM of Joined deals (NOT all resolved — Closed Lost deals have higher AUM and inflate the mean)
SELECT
  ROUND(AVG(COALESCE(Underwritten_AUM__c, Amount)), 0) AS mean_joined_aum,
  COUNT(*) AS joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SQO_raw = 'Yes'
  AND is_primary_opp_record = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined'
  AND advisor_join_date__c IS NOT NULL
  AND COALESCE(Underwritten_AUM__c, Amount) > 0
  -- Add window filter: AND DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
```

---

## Feature 3: Google Sheets — Realization Forecast Tab

A new "BQ Realization Forecast" tab in the Sheets export. Must be FULLY AUDITABLE — every number traceable to deal-level data through Sheets formulas.

### Tab layout:

**Section 1: Forecast Summary (rows 1-12)**
One row per future quarter:

| Col A | Col B | Col C | Col D | Col E | Col F | Col G |
|-------|-------|-------|-------|-------|-------|-------|
| Quarter | Neg+Signed Dated Deals | Component A AUM | Realization Band | Pipeline Contribution | Surprise Baseline | **Total Forecast** |
| Q2 2026 | =COUNTIF(deal range, "Q2 2026") | =SUMIFS(AUM range, quarter range, "Q2 2026") | =IF(B2<10, 0.60, IF(B2<15, 0.45, 0.35)) | =C2*D2 | $398,000,000 | =E2+F2 |

The COUNTIF and SUMIFS reference the deal-level detail in Section 2.

**Section 2: Component A Deal Detail (rows 15+)**
One row per Neg+Signed deal with an anticipated date in a future quarter:

| Opp ID | Advisor | Stage | AUM | Anticipated Date | Target Quarter | Date Confidence | Date Revisions | Duration Bucket |
|--------|---------|-------|-----|-----------------|----------------|-----------------|----------------|-----------------|

Sorted by target quarter, then AUM descending.

The SUM formulas in Section 1 reference this range. Someone can see "Q2 total = $2.5B" and scroll down to see exactly which 29 deals make up that number.

**Section 3: Component B History (rows at bottom)**
Shows the trailing 4 quarters of surprise AUM:

| Quarter | Total Joined AUM | Component A AUM | Component B (Surprise) |
|---------|-----------------|-----------------|----------------------|
| Q1 2025 | $463M | $185M | $278M |
| Q2 2025 | $578M | $106M | $472M |
| ... | | | |
| Trailing Avg | | | =AVERAGE(D range) |

The surprise baseline in Section 1 references this trailing average via formula.

---

## Feature 4: Google Sheets — Scenario Runner Tab

A new "BQ Scenario Runner" tab that lets leadership play with conversion rates, velocity, and mean AUM in the spreadsheet to see how SQO requirements change. This is the sheet version of the what-if panel — but more powerful because they can duplicate the tab and save multiple scenarios.

### Tab layout:

**Section 1: Current Trailing Rates (read-only reference, rows 1-10)**

| Col A | Col B | Col C |
|-------|-------|-------|
| **Transition** | **Current Rate** | **Current Avg Days** |
| SQO → SP | =SQO_to_SP_rate (named range from Rates tab) | =avg_days_sqo_to_sp |
| SP → Neg | =SP_to_Neg_rate | =avg_days_in_sp |
| Neg → Signed | =Neg_to_Signed_rate | =avg_days_in_neg |
| Signed → Joined | =Signed_to_Joined_rate | =avg_days_in_signed |
| **SQO → Joined** | =B2*B3*B4*B5 | =SUM(C2:C5) |
| Mean Joined AUM | =mean_joined_aum (named range) | |
| Trailing Window | "1yr" (or whatever was selected) | |
| Cohort Size | =cohort_count | |

**Section 2: Scenario Inputs (editable, rows 12-22)**

Same structure but the rate and AUM cells are editable — user types in their own values:

| Col A | Col B | Col C |
|-------|-------|-------|
| **Transition** | **Scenario Rate** | **Scenario Days** |
| SQO → SP | 70% ← user edits this | 4 |
| SP → Neg | 50% ← "what if we improve this?" | 18 |
| Neg → Signed | 55% | 16 |
| Signed → Joined | 90% | 34 |
| **SQO → Joined** | =B13*B14*B15*B16 | =SUM(C13:C16) |
| Mean Joined AUM | $80,000,000 ← user edits | |
| Expected AUM per SQO | =B18*B17 | |

**Section 3: Target Analysis (rows 24+)**

One row per quarter with a target:

| Quarter | Target AUM | Expected AUM/SQO (Scenario) | Required SQOs (Scenario) | Expected AUM/SQO (Current) | Required SQOs (Current) | SQO Difference |
|---------|-----------|---------------------------|------------------------|--------------------------|------------------------|----------------|
| Q3 2026 | $1,200,000,000 | =B19 from Section 2 | =CEILING(B25/C25) | =$B$7*$B$6 from Section 1 | =CEILING(B25/E25) | =D25-F25 |

The key insight: columns C-D use the scenario rates, columns E-F use the current trailing rates. The "SQO Difference" column shows: "If you improve SP→Neg from 40% to 50%, you need 24 fewer SQOs to hit the same target."

**Section 4: Sensitivity Table (optional, rows 35+)**

A small matrix showing required SQOs at different combinations of conversion rate and mean AUM:

| | Mean $50M | Mean $65M | Mean $80M | Mean $100M |
|---|---|---|---|---|
| 12% e2e rate | 167 | 128 | 104 | 83 |
| 14% e2e rate | 143 | 110 | 89 | 71 |
| 16% e2e rate | 125 | 96 | 78 | 63 |
| 18% e2e rate | 111 | 85 | 69 | 56 |

Each cell = CEILING($target / (column_mean × row_rate)). Uses a single target AUM that the user sets.

This is the "one-page strategy view" — leadership can see at a glance how different levers interact.

---

## What the exploration agents need to find:

### Code Inspector:

1. **Current forecast/page.tsx structure:**
   - What state variables exist (rates, pipeline, monteCarlo, scenarios)?
   - What components does it render and in what order?
   - How much room is there to add a banner section above ForecastMetricCards?
   - Does it already have any target/goal state management?

2. **ForecastMetricCards component:**
   - Current props, layout, and quarter card structure
   - Has the SQO target input been built already? (Check for ForecastQuarterTarget Prisma model, /api/forecast/sqo-targets route, or target-related state in page.tsx)

3. **ScenarioRunner component:**
   - How it handles rate overrides (slider state, rate objects, re-run logic)
   - What it saves to the DB (the ForecastScenario Prisma model)
   - How the what-if panel can follow the same pattern but simpler (no Monte Carlo re-run, just multiplication)

4. **Rates query (forecast-rates.ts):**
   - Does it already return mean_joined_aum? (The SQO exploration spec'd adding this)
   - Does it already return tiered rates (flat/lower/upper)? (The enhancement added this)
   - Current ForecastRates / TieredForecastRates interface shape

5. **Export route (forecast/export/route.ts):**
   - Current tab list (what tabs exist now — P2, Audit, Rate Reference?, Monte Carlo Summary?)
   - How multi-section tabs are built (the realization tab needs summary + deal detail in one tab)
   - How named ranges are referenced across tabs
   - Current column count on the P2 tab (should be AF-AH after date confidence addition)
   - The buildP2Values, buildAuditValues pattern — we need buildRealizationValues, buildScenarioRunnerValues, buildSQOTargetsValues

6. **Prisma schema:**
   - Does ForecastQuarterTarget model exist already?
   - What's the current ForecastScenario model shape?

7. **Component rendering order in forecast/page.tsx:**
   - Exact sequence of components rendered
   - Where the realization banner would slot in (above ForecastMetricCards)
   - Where the what-if panel would slot in (near or replacing ScenarioRunner?)

### Data Verifier:

Run these queries to confirm current data state:

1. **Component A pipeline for upcoming quarters:**
```sql
SELECT
  CONCAT('Q', EXTRACT(QUARTER FROM DATE(Earliest_Anticipated_Start_Date__c)),
         ' ', EXTRACT(YEAR FROM DATE(Earliest_Anticipated_Start_Date__c))) AS target_quarter,
  COUNT(*) AS deal_count,
  ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS aum_m,
  COUNTIF(StageName = 'Negotiating') AS neg_count,
  COUNTIF(StageName = 'Signed') AS signed_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SQO_raw = 'Yes' AND is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Negotiating', 'Signed')
  AND Earliest_Anticipated_Start_Date__c IS NOT NULL
  AND DATE(Earliest_Anticipated_Start_Date__c) >= CURRENT_DATE()
GROUP BY target_quarter ORDER BY target_quarter
```

2. **Confirm mean joined AUM values by window:**
```sql
SELECT
  '180d' AS window,
  COUNT(*) AS n,
  ROUND(AVG(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS mean_aum_m
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
  AND COALESCE(Underwritten_AUM__c, Amount) > 0
  AND DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
UNION ALL
-- Repeat for 1yr (365), 2yr (730), all-time (no date filter)
```

3. **Verify realization rate against most recent completed quarter (Q4 2025):**
```sql
-- Deals that were Neg+Signed with Q4 2025 dates at the start of Q4
-- vs what actually joined in Q4
-- The backtest found 34% realization for Q4 2025 — verify this is still the reference
```

4. **Check Component B surprise AUM for recent quarters:**
```sql
-- For each of Q1-Q4 2025: total joined AUM minus Component A AUM = surprise AUM
-- Trailing 4Q average should be ~$398M
```

5. **Check if "BQ Rates and Days" tab exists in the Sheets export** — the scenario runner needs to reference named ranges from it.

### Pattern Finder:

1. **ScenarioRunner state management:** How rate overrides flow from sliders → state → API call → results display. The what-if panel uses a simpler version (no API call — just client-side multiplication).

2. **Multi-section Sheets tab pattern:** How are tabs with multiple logical sections built? (Header rows, blank separator rows, section titles). The realization tab needs a summary section referencing a detail section below it.

3. **Named range pattern in Sheets export:** How does the existing export create or reference named ranges? The scenario runner tab needs to reference rates from the Rates tab. Check if buildRatesAndDaysValues or similar already sets up named ranges.

4. **ForecastMetricCards layout:** How quarter cards are rendered (map over quarters array?). The realization banner needs to sit above this. Is there a wrapper component or is it direct in page.tsx?

5. **Editable input pattern in dashboard:** How does TeamGoalEditor or similar components handle inline editing with persistence? The target AUM input needs the same pattern.

6. **How the export route handles multiple tabs:** Does it write tabs sequentially? Can it handle 5-6 tabs (P2, Audit, Rate Reference, Realization, Scenario Runner, SQO Targets) without hitting Google Sheets API limits?

### Reference documents (read for context, don't re-analyze the data — it's already done):

- C:\Users\russe\Documents\Dashboard\forecast_modeling_backtest_results.md — realization model backtest results, two-component model mechanics, deal-count bands derivation, Q2 2026 forward forecast
- C:\Users\russe\Documents\Dashboard\backtesting_sql.md — all SQL queries used in the backtest, including Component A/B classification, realization rate computation, SQO target calculator, intra-quarter pipeline
- C:\Users\russe\Documents\Dashboard\sqo-target-exploration-results.md — SQO calculator math, backtest (Joined Mean wins at MAE=16.5), recommended phases, Prisma model spec, Sheets formula layout
- C:\Users\russe\Documents\Dashboard\forecast_explained.md — current model overview
- C:\Users\russe\Documents\Dashboard\anticipated_start_date_exploration.md — date confidence data, revision patterns
- C:\Users\russe\Documents\Dashboard\forecast_enhancement_guide.md — the already-implemented enhancement (duration penalties + tiered rates + date confidence)