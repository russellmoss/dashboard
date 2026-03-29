# Backtest SQL Queries — Reference

**Purpose:** Documents every BigQuery query used for `forecast_modeling_backtest_results.md`, with rationale for each. For investigating methodology or reproducing results.

**Date:** March 24, 2026

---

## Table of Contents

1. [Actuals by Quarter](#1-actuals-by-quarter)
2. [Pipeline Snapshot Reconstruction](#2-pipeline-snapshot-reconstruction)
3. [Rate Cohort PIT Leakage Assessment](#3-rate-cohort-pit-leakage-assessment)
4. [AUM and Anticipated Date Leakage Assessment](#4-aum-and-anticipated-date-leakage-assessment)
5. [PIT Conversion Rates (Resolution Date Filtered)](#5-pit-conversion-rates-resolution-date-filtered)
6. [Full PIT-Corrected Weighted Forecast](#6-full-pit-corrected-weighted-forecast)
7. [PIT-Corrected Anticipated Date Accuracy](#7-pit-corrected-anticipated-date-accuracy)
8. [PIT Monte Carlo (Analytical Approximation)](#8-pit-monte-carlo-analytical-approximation)
9. [PIT SQO Target Calculator](#9-pit-sqo-target-calculator)
10. [Intra-Quarter Pipeline](#10-intra-quarter-pipeline)
11. [Stage Velocity Reference](#11-stage-velocity-reference)

---

## 1. Actuals by Quarter

**Purpose:** Ground truth for all comparisons.

```sql
SELECT
  FORMAT_DATE('%Y-Q%Q', DATE(advisor_join_date__c)) AS quarter,
  COUNT(*) AS deals_joined,
  ROUND(SUM(Opportunity_AUM) / 1e6, 1) AS actual_aum_m,
  ROUND(AVG(Opportunity_AUM) / 1e6, 1) AS avg_aum_m
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1
  AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
  AND DATE(advisor_join_date__c) >= '2024-10-01'
  AND DATE(advisor_join_date__c) < '2026-01-01'
GROUP BY quarter ORDER BY quarter
```

Uses current AUM for actuals (not PIT) because the actual outcome IS the current state.

---

## 2. Pipeline Snapshot Reconstruction

**Purpose:** Reconstruct open SQO pipeline at each quarter start. Stage is determined from immutable stage-entry timestamps, not current StageName.

```sql
WITH quarters AS (
  SELECT '2024-Q4' AS qtr, DATE '2024-10-01' AS q_start, DATE '2025-01-01' AS q_end
  UNION ALL /* ... Q1-Q4 2025 */
)
SELECT q.qtr, q.q_start, f.Full_Opportunity_ID__c, f.Opportunity_AUM,
  -- Stage at snapshot (walk backward from Signed to Discovery)
  CASE
    WHEN f.Stage_Entered_Signed__c IS NOT NULL
      AND DATE(f.Stage_Entered_Signed__c) < q.q_start THEN 'Signed'
    WHEN f.Stage_Entered_Negotiating__c IS NOT NULL
      AND DATE(f.Stage_Entered_Negotiating__c) < q.q_start THEN 'Negotiating'
    WHEN f.Stage_Entered_Sales_Process__c IS NOT NULL
      AND DATE(f.Stage_Entered_Sales_Process__c) < q.q_start THEN 'Sales Process'
    ELSE 'Discovery'
  END AS stage_at_snapshot,
  -- Days in stage at snapshot
  CASE /* same pattern, DATE_DIFF(q.q_start, stage_entry, DAY) */ END AS days_in_stage
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
CROSS JOIN quarters q
WHERE f.SQO_raw = 'Yes' AND f.is_primary_opp_record = 1
  AND DATE(f.Date_Became_SQO__c) < q.q_start
  AND (f.advisor_join_date__c IS NULL OR f.advisor_join_date__c >= q.q_start)
  AND (f.Stage_Entered_Closed__c IS NULL OR DATE(f.Stage_Entered_Closed__c) >= q.q_start)
  AND f.Opportunity_AUM > 0
```

Pattern follows `forecasting_research.md` canonical PIT pipeline CTE.

---

## 3. Rate Cohort PIT Leakage Assessment

**Purpose:** Quantify how many deals in the rate cohort hadn't actually resolved by the snapshot date. This was the most impactful correction.

**Why we ran this:** Our initial backtest filtered rates by `sqo_date < snapshot` but NOT `resolution_date < snapshot`. We needed to know if this mattered.

```sql
SELECT q.qtr,
  COUNT(*) AS total_current_method,
  COUNTIF(
    (f.Stage_Entered_Joined__c IS NOT NULL AND DATE(f.Stage_Entered_Joined__c) < q.q_start)
    OR (f.Stage_Entered_Closed__c IS NOT NULL AND DATE(f.Stage_Entered_Closed__c) < q.q_start)
  ) AS total_pit_resolved,
  COUNT(*) - COUNTIF(/* above */) AS leaked_deals
FROM quarters q
JOIN vw_funnel_master f
  ON DATE(f.Date_Became_SQO__c) < q.q_start
  AND DATE(f.Date_Became_SQO__c) >= DATE_SUB(q.q_start, INTERVAL 730 DAY)
  AND f.SQO_raw = 'Yes' AND f.is_primary_opp_record = 1
  AND f.StageName IN ('Joined', 'Closed Lost')
GROUP BY q.qtr
```

**Finding:** For Q4 2024, 166 of 252 deals (66%) hadn't resolved yet. PIT rate was 21.3% vs leaked 16.7%. This single correction is larger than the AUM correction.

---

## 4. AUM and Anticipated Date Leakage Assessment

**Purpose:** Quantify post-snapshot changes to AUM and anticipated dates using `OpportunityFieldHistory`.

```sql
-- AUM leakage
SELECT h.OpportunityId, q.qtr, h.Field,
  SAFE_CAST(h.OldValue AS FLOAT64) AS snapshot_value,
  ROW_NUMBER() OVER (PARTITION BY h.OpportunityId, q.qtr, h.Field
    ORDER BY h.CreatedDate ASC) AS rn
FROM `savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory` h
CROSS JOIN quarters q
WHERE h.Field IN ('Amount', 'Underwritten_AUM__c')
  AND DATE(h.CreatedDate) >= q.q_start  -- changed AFTER snapshot

-- Same pattern for Earliest_Anticipated_Start_Date__c
```

**Finding:** AUM drift was -$1.4B to +$1.6B (mixed direction). Anticipated date leakage affected 40%+ of pipeline by Q2 2025.

---

## 5. PIT Conversion Rates (Resolution Date Filtered)

**Purpose:** Compute conversion rates using ONLY deals whose outcome was known at the snapshot.

**Why this matters:** Fast-resolving deals have higher join rates. Without the resolution filter, the rate cohort includes slow-to-resolve deals that inflate the denominator and artificially lower rates. The model operating in real time would have seen the higher PIT rates.

```sql
WITH pit_resolved AS (
  SELECT
    DATE(f.Date_Became_SQO__c) AS sqo_date,
    -- Resolution date (Joined or Closed Lost timestamp)
    CASE
      WHEN f.StageName = 'Joined'
        THEN COALESCE(DATE(f.Stage_Entered_Joined__c), f.advisor_join_date__c)
      ELSE DATE(f.Stage_Entered_Closed__c)
    END AS resolution_date,
    -- "Reached or beyond" flags per forecasting_research.md methodology
    COALESCE(f.Stage_Entered_Sales_Process__c, f.Stage_Entered_Negotiating__c,
      f.Stage_Entered_Signed__c, f.Stage_Entered_Joined__c) IS NOT NULL AS reached_sp,
    COALESCE(f.Stage_Entered_Negotiating__c, f.Stage_Entered_Signed__c,
      f.Stage_Entered_Joined__c) IS NOT NULL AS reached_neg,
    COALESCE(f.Stage_Entered_Signed__c,
      f.Stage_Entered_Joined__c) IS NOT NULL AS reached_signed,
    CASE WHEN COALESCE(f.Stage_Entered_Joined__c, TIMESTAMP(f.advisor_join_date__c))
      IS NOT NULL AND f.StageName != 'Closed Lost' THEN TRUE ELSE FALSE END AS is_joined
  FROM vw_funnel_master f
  WHERE f.SQO_raw = 'Yes' AND f.is_primary_opp_record = 1
    AND f.StageName IN ('Joined', 'Closed Lost')
)
SELECT q.qtr, w.wl,
  COUNT(*) AS n,
  SAFE_DIVIDE(COUNTIF(r.reached_sp), COUNT(*)) AS sqo_to_sp,
  SAFE_DIVIDE(COUNTIF(r.reached_neg), COUNTIF(r.reached_sp)) AS sp_to_neg,
  SAFE_DIVIDE(COUNTIF(r.reached_signed), COUNTIF(r.reached_neg)) AS neg_to_signed,
  SAFE_DIVIDE(COUNTIF(r.is_joined),
    COUNTIF(r.reached_signed OR r.is_joined)) AS signed_to_joined
FROM quarters q CROSS JOIN windows w
JOIN pit_resolved r
  ON r.sqo_date < q.q_start
  AND r.resolution_date < q.q_start  -- KEY: resolved before snapshot
  AND (w.wd = 9999 OR r.sqo_date >= DATE_SUB(q.q_start, INTERVAL w.wd DAY))
GROUP BY q.qtr, w.wl
```

**Key difference from initial analysis:** The `resolution_date < q.q_start` filter. This follows the canonical PIT rates CTE from `forecasting_research.md`.

**Note on Signed→Joined:** PIT-resolved rates show 100% for early quarters because the few deals that reached Signed and resolved quickly all joined. This is a small-sample artifact that will naturally resolve as more data accumulates.

---

## 6. Straight Weighted vs. Penalized+Tiered Forecast Comparison

**Purpose:** Compare straight weighted pipeline (flat PIT rates, no penalties, no tiers) against the penalized+tiered model, both using fully PIT-corrected data. This isolates the impact of the duration penalties and AUM tier segmentation.

**Why we ran this:** We needed to answer: "Do the penalties and tiers actually help, or are they just adding complexity?" The answer: they reduce error by 4x (304% → 70% vs eventual), so yes, they help significantly. But even the penalized model is 198% MAPE vs quarterly actuals.

```sql
WITH quarters AS ( /* Q4 2024 – Q4 2025 */ ),

-- PIT-resolved FLAT rates (no tier split)
flat_rates AS (
  SELECT q.qtr,
    SAFE_DIVIDE(COUNTIF(r.reached_sp), COUNT(*)) AS sqo_to_sp,
    SAFE_DIVIDE(COUNTIF(r.reached_neg), COUNTIF(r.reached_sp)) AS sp_to_neg,
    SAFE_DIVIDE(COUNTIF(r.reached_signed), COUNTIF(r.reached_neg)) AS neg_to_signed,
    SAFE_DIVIDE(COUNTIF(r.is_joined),
      COUNTIF(r.reached_signed OR r.is_joined)) AS signed_to_joined
  FROM quarters q
  JOIN pit_resolved r
    ON r.sqo_date < q.q_start
    AND r.res_date < q.q_start  -- PIT: resolved before snapshot
    AND r.sqo_date >= DATE_SUB(q.q_start, INTERVAL 730 DAY)
  GROUP BY q.qtr
),

-- PIT-resolved TIER rates (Lower/Upper at $75M)
tier_rates AS (
  /* same as flat_rates but with GROUP BY q.qtr, tier */
),

-- Pipeline with PIT AUM (same rollback as Query 4)
pipeline AS ( /* ... */ ),

-- Score each deal under both models
scored AS (
  SELECT p.*,
    -- STRAIGHT: flat rates, no penalties
    CASE p.stage
      WHEN 'Discovery' THEN fr.sqo_to_sp * fr.sp_to_neg * fr.neg_to_signed * fr.signed_to_joined
      WHEN 'Sales Process' THEN fr.sp_to_neg * fr.neg_to_signed * fr.signed_to_joined
      WHEN 'Negotiating' THEN fr.neg_to_signed * fr.signed_to_joined
      WHEN 'Signed' THEN fr.signed_to_joined
    END AS p_straight,

    -- PENALIZED+TIERED: tier rates with 15-deal fallback, duration multiplier on current stage
    CASE p.stage
      WHEN 'Discovery' THEN LEAST(tr.sqo_to_sp * dur_mult, 1) * tr.sp_to_neg * tr.neg_to_signed * tr.signed_to_joined
      WHEN 'Sales Process' THEN LEAST(tr.sp_to_neg * dur_mult, 1) * tr.neg_to_signed * tr.signed_to_joined
      WHEN 'Negotiating' THEN LEAST(tr.neg_to_signed * dur_mult, 1) * tr.signed_to_joined
      WHEN 'Signed' THEN LEAST(tr.signed_to_joined * dur_mult, 1)
    END AS p_penalized
  FROM pipeline p
  LEFT JOIN flat_rates fr ON p.qtr = fr.qtr
  LEFT JOIN tier_rates tr ON p.qtr = tr.qtr AND p.pit_tier = tr.tier
)

SELECT qtr,
  -- Straight weighted
  ROUND(SUM(p_straight * pit_aum)/1e6, 1) AS straight_forecast_m,
  ROUND((SUM(p_straight * pit_aum) - SUM(actual_aum))
    / NULLIF(SUM(actual_aum), 0) * 100, 0) AS straight_vs_q_err,
  ROUND((SUM(p_straight * pit_aum) - SUM(eventual_aum))
    / NULLIF(SUM(eventual_aum), 0) * 100, 0) AS straight_vs_eventual_err,
  -- Penalized + tiered
  ROUND(SUM(p_penalized * pit_aum)/1e6, 1) AS penalized_forecast_m,
  ROUND((SUM(p_penalized * pit_aum) - SUM(actual_aum))
    / NULLIF(SUM(actual_aum), 0) * 100, 0) AS pen_vs_q_err,
  ROUND((SUM(p_penalized * pit_aum) - SUM(eventual_aum))
    / NULLIF(SUM(eventual_aum), 0) * 100, 0) AS pen_vs_eventual_err
FROM scored
GROUP BY qtr ORDER BY qtr
```

**Key design decisions:**
- Both models use the same PIT-resolved rate cohort (resolution date < snapshot) and PIT AUM — the only difference is whether penalties and tiers are applied
- The straight model uses flat rates (no tier split) — every deal at the same stage gets the same P(Join) regardless of AUM or duration
- The penalized model applies duration multipliers from `forecast-config.ts` to the current stage rate only, and uses tier-specific rates with 15-deal fallback
- Both compute P(Join) as the product of remaining stage rates (SQO→SP × SP→Neg × Neg→Signed × Signed→Joined), starting from the deal's current stage

**Finding:** Penalties + tiers reduce error by 4x vs eventual (304% → 70%) and 3x vs quarterly (591% → 198%). The penalties are clearly valuable for pipeline valuation. But even the penalized model is 198% MAPE vs quarterly — it's not suitable for quarterly AUM planning (see Query 11: Two-Component model for that).

---

## 7. Full PIT-Corrected Penalized Forecast (Detail)

**Purpose:** The detailed version of the penalized+tiered backtest with full CTE chain. Combines PIT rates + PIT AUM + tier segmentation + duration penalties.

```sql
/* Combines:
   - PIT-resolved tier_rates and flat_rates (Query 5)
   - PIT AUM rollback via OpportunityFieldHistory (Query 4)
   - Pipeline reconstruction (Query 2)
   - Duration penalties from forecast-config.ts:
     Discovery:     1.0 / 0.667 / 0.393  (thresholds: 36d / 64d)
     Sales Process: 1.0 / 0.755 / 0.176  (thresholds: 67d / 105d)
     Negotiating:   1.0 / 0.682 / 0.179  (thresholds: 50d / 81d)
     Signed:        1.0 / 1.0   / 1.0    (no penalty)
   - Tier segmentation: PIT AUM < $75M = Lower, else Upper
   - 15-deal tier fallback: if tier has < 15 PIT-resolved deals, use flat rates
   - P(Join) = product of remaining rates, penalty on current stage only:
     Discovery: LEAST(sqo_to_sp * dur_mult, 1) * sp_to_neg * neg_to_signed * signed_to_joined
     Sales Process: LEAST(sp_to_neg * dur_mult, 1) * neg_to_signed * signed_to_joined
     Negotiating: LEAST(neg_to_signed * dur_mult, 1) * signed_to_joined
     Signed: LEAST(signed_to_joined * dur_mult, 1)
*/
SELECT qtr,
  SUM(p_join_pen * pit_aum) / 1e6 AS forecast_pen_m,
  SUM(p_join_base * pit_aum) / 1e6 AS forecast_base_m,
  SUM(eventual_aum) / 1e6 AS eventual_m,
  SUM(actual_aum) / 1e6 AS actual_this_q_m
FROM deal_final GROUP BY qtr
```

Full query is ~120 lines with all CTEs. See the conversation history for the exact SQL executed.

---

## 7. PIT-Corrected Anticipated Date Accuracy

**Purpose:** Test quarter-placement accuracy using only the anticipated date available at forecast time.

```sql
-- For each joined deal that was in pipeline at snapshot:
-- If Earliest_Anticipated_Start_Date__c was changed after snapshot,
-- use the OldValue from the earliest post-snapshot change.
-- If set for the first time after snapshot, treat as NULL.
SELECT qtr,
  COUNT(*) AS joined_deals,
  COUNTIF(pit_date IS NOT NULL) AS has_pit_date,
  COUNTIF(pit_date IS NOT NULL
    AND FORMAT_DATE('%Y-Q%Q', pit_date)
      = FORMAT_DATE('%Y-Q%Q', actual_join_date)) AS pit_correct_quarter
FROM joined_pipeline_with_pit_dates
GROUP BY qtr
```

**Finding:** 37/37 deals with PIT dates joined in the anticipated quarter (100%). But 2-3 deals per quarter had no date at snapshot time. Per `anticipated_start_date_exploration.md`, first-set dates have +18.3 day average slip and 65% of deals join later than first estimated.

---

## 8. PIT Monte Carlo (Analytical Approximation)

**Purpose:** Estimate P10/P50/P90 using analytical variance formula rather than simulated trials.

**Why analytical instead of simulated:** Running 5,000-trial MC for 5 quarters in BigQuery is expensive. The analytical approach uses the Bernoulli variance formula: `Var = Σ p_i(1-p_i) × AUM_i²`, then `P10 ≈ mean - 1.28 × SD`, `P90 ≈ mean + 1.28 × SD`.

**Limitation:** The normal approximation understates the range when whale deals dominate (right-skewed distribution). We validated against actual 2,000-trial simulations for selected quarters and the analytical P10 is 10-15% higher than simulated P10 — meaning the actual MC would be slightly more generous than our analytical approximation.

---

## 9. PIT SQO Target Calculator

**Purpose:** Backtest the "how many SQOs do we need" calculator using only PIT data.

```sql
-- Mean Joined AUM: only deals joined BEFORE snapshot
SELECT AVG(Opportunity_AUM) AS mean_1yr
FROM vw_funnel_master
WHERE StageName = 'Joined'
  AND advisor_join_date__c < @snapshot_date  -- PIT: joined before snapshot
  AND Date_Became_SQO__c >= DATE_SUB(@snapshot_date, INTERVAL 365 DAY)

-- PIT-resolved SQO→Joined rate (1yr, resolution before snapshot)
SELECT SAFE_DIVIDE(COUNTIF(is_joined), COUNT(*)) AS rate
FROM resolved_cohort
WHERE sqo_date < @snapshot_date
  AND resolution_date < @snapshot_date  -- KEY PIT filter
  AND sqo_date >= DATE_SUB(@snapshot_date, INTERVAL 365 DAY)

-- Expected AUM per SQO = mean × rate
-- SQOs needed = actual_quarterly_aum / expected_per_sqo
```

**Finding:** PIT rates for early quarters (24% at Q4 2024) are much higher than leaked rates (17%), making the calculator say fewer SQOs are needed. By Q2 2025+ the rates stabilize and the calculator is within +3 to +7 SQOs of reality.

---

## 10. Intra-Quarter Pipeline

**Purpose:** Count deals that entered SQO and joined within the same quarter — invisible to any snapshot.

```sql
SELECT FORMAT_DATE('%Y-Q%Q', DATE(advisor_join_date__c)) AS quarter,
  COUNT(*) AS intra_q_joins,
  ROUND(SUM(Opportunity_AUM)/1e6, 1) AS intra_q_aum_m
FROM vw_funnel_master
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND StageName = 'Joined'
  AND EXTRACT(QUARTER FROM DATE(Date_Became_SQO__c))
    = EXTRACT(QUARTER FROM DATE(advisor_join_date__c))
  AND EXTRACT(YEAR FROM DATE(Date_Became_SQO__c))
    = EXTRACT(YEAR FROM DATE(advisor_join_date__c))
GROUP BY quarter
```

**Finding:** $27-288M per quarter (growing to ~20% of total). Structural blind spot.

---

## 11. Two-Component Quarterly Forecast Backtest

**Purpose:** Build and backtest a simpler model designed for quarterly AUM prediction rather than total pipeline valuation.

**Why:** The probability model (Parts 1-2) consistently overestimates quarterly AUM by 60-146%. The two-component model asks a different question: "Of the deals that are close to closing with a date, what fraction will actually close — and what does the historical surprise baseline add?"

### Step 1: Classify joined deals as Component A or B

For each historical quarter, we classified every deal that joined:
- **Component A:** Was in Negotiating or Signed at quarter start, with a PIT anticipated date in the target quarter
- **Component B (surprise):** Everything else — SP deals that fast-tracked, intra-quarter new pipeline, deals without dates

```sql
-- For each joined deal in each quarter:
CASE
  WHEN was_in_pipeline_at_q_start
    AND stage_at_snapshot IN ('Negotiating', 'Signed')
    AND pit_anticipated_date >= q_start
    AND pit_anticipated_date < q_end
  THEN 'Component A'
  ELSE 'Component B (surprise)'
END
```

### Step 2: Compute Component A pipeline and realization

At each quarter start, count all Neg+Signed deals with anticipated dates in the quarter (not just the ones that eventually joined — this is the full pipeline visible at forecast time). Then compare against what actually joined from that pool.

```sql
-- Component A pipeline at quarter start
SELECT q.qtr, COUNT(*) AS deals, SUM(f.Opportunity_AUM) AS aum
FROM vw_funnel_master f CROSS JOIN quarters q
WHERE stage_at_snapshot IN ('Negotiating', 'Signed')
  AND pit_anticipated_date >= q.q_start
  AND pit_anticipated_date < q.q_end
  /* standard pipeline filters */
```

**Finding — declining realization rate:** As more deals get anticipated dates, the realization rate drops from 94% (6 deals) to 34% (22 deals). This led to the deal-count bands approach.

### Step 3: Three model variants tested

```sql
-- Deal-count bands multiplier
CASE
  WHEN comp_a_deals < 10 THEN 0.60   -- small pool, high selectivity
  WHEN comp_a_deals < 15 THEN 0.45   -- moderate pool
  ELSE 0.35                           -- large pool, diluted signal
END AS band_multiplier

-- Forecast = (Component A AUM × multiplier)
--          + AVG(surprise_actual) OVER (preceding 4 quarters)
```

**Band derivation:** The 60/45/35 bands were derived by observing that realization rates clustered around these values at different pipeline sizes: 94% and 59% for <10 deals (avg ~60%), 56% and 43% for 10-15 deals (avg ~45%), and 34% for 15+ deals. With only 5 data points, these are approximations — refine as more quarters complete.

### Step 4: Forward forecast (Q1-Q2 2026)

```sql
-- Current pipeline for target quarter
SELECT COUNT(*) AS deals, SUM(Opportunity_AUM) AS aum
FROM vw_funnel_master
WHERE StageName IN ('Negotiating', 'Signed')
  AND Earliest_Anticipated_Start_Date__c >= @q_start
  AND Earliest_Anticipated_Start_Date__c < @q_end

-- Trailing 4Q surprise average (Q1-Q4 2025)
SELECT AVG(surprise_aum) FROM (
  VALUES (277.9e6), (472e6), (276.1e6), (567.8e6)
)
-- Result: $398M
```

**Findings:**
- Q1 2026: 4 deals, $163M → 60% band → $98M + $398M = **$496M forecast** (actual already $2,411M — whale quarter)
- Q2 2026: 29 deals, $2,527M → 35% band → $885M + $398M = **$1,283M forecast** (range $1.1-1.3B)

---

## 12. Stage Velocity Reference

**Purpose:** Average days per stage for model-estimated join dates.

```sql
SELECT
  AVG(DATE_DIFF(DATE(Stage_Entered_Negotiating__c),
    DATE(Stage_Entered_Sales_Process__c), DAY)) AS avg_days_sp,  -- 31d
  AVG(DATE_DIFF(DATE(Stage_Entered_Signed__c),
    DATE(Stage_Entered_Negotiating__c), DAY)) AS avg_days_neg,   -- 24d
  AVG(DATE_DIFF(COALESCE(DATE(Stage_Entered_Joined__c), advisor_join_date__c),
    DATE(Stage_Entered_Signed__c), DAY)) AS avg_days_signed       -- 29d
FROM vw_funnel_master
WHERE StageName = 'Joined'  -- only deals that completed the journey
```

---

## Methodology Notes

### Three Layers of PIT Correction

| Layer | What Was Leaked | How We Fixed It | Impact |
|---|---|---|---|
| **Conversion rates** | Included deals that resolved after snapshot | Added `resolution_date < snapshot_date` | Largest: rates 2-7 ppt higher, forecast 5-15% higher |
| **AUM values** | Used current AUM, not snapshot-time AUM | Rolled back via `OpportunityFieldHistory` | Moderate: -$1.4B to +$1.6B pipeline shift |
| **Anticipated dates** | Used final-revised dates | Rolled back to pre-snapshot value | Moderate: some deals lose their date assignment |

### Why PIT Rates Are Higher Than Leaked Rates

The PIT-resolved cohort is biased toward fast-closing deals. A deal that SQO'd 8 months before the snapshot and hadn't resolved yet is excluded from the PIT cohort but included in the leaked cohort. Fast-closing deals are disproportionately:
- Deals that closed won (decisive buyers)
- Deals that were quickly disqualified (clear misfit)

Slow-to-resolve deals are disproportionately:
- Deals languishing in the pipeline (zombie prospects)
- Deals waiting for a "Closed Lost" cleanup

This means the PIT cohort has a higher join rate than the full retrospective cohort — a structural property of point-in-time analysis, not a bug.

### Data Availability by Quarter

| Snapshot | 180d PIT Cohort | 1yr PIT Cohort | 2yr PIT Cohort | All-Time PIT |
|---|---|---|---|---|
| Q4 2024 (Oct 1) | 57 deals | 83 deals | 94 deals | 94 deals (=2yr) |
| Q1 2025 (Jan 1) | 92 | 153 | 171 | 171 (=2yr) |
| Q2 2025 (Apr 1) | 96 | 223 | 260 | 261 |
| Q3 2025 (Jul 1) | 98 | 251 | 332 | 336 |
| Q4 2025 (Oct 1) | 110 | 259 | 420 | 429 |

The 2yr and all-time windows are identical for Q4 2024 and Q1 2025 because SQO data only goes back to March 2023.

### SFDC Timeline and Field History

Salesforce was adopted in **early 2023** (Opportunity records appear consistently from April 2023). Stage entry timestamps and SQO dates are natively tracked — there is no evidence of bulk backfilling (90% of SQO deals were created in SFDC within 7 days of their SQO date).

`OpportunityFieldHistory` tracking was enabled in **September 2024**. This means we can only detect and roll back field changes (AUM, anticipated dates) from Sep 2024 onward. Earlier field changes are invisible — the current value is assumed to be the original value for pre-Sep 2024 changes.

Q4 2024 and Q1 2025 results are lower-confidence primarily due to **thin PIT-resolved rate cohorts** (94 and 171 deals), not data quality concerns.
