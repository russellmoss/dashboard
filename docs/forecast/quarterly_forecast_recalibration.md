# Quarterly Forecast Recalibration Guide

> **Purpose:** Step-by-step process for recalibrating the pipeline forecast model each quarter. Run this at the start of each quarter (e.g., April 1, July 1, October 1, January 1).
>
> **Time required:** ~30 minutes (queries + review + optional config update)
>
> **Who runs it:** RevOps / whoever owns the forecast model
>
> **Where changes go:** `src/lib/forecast-config.ts` (thresholds + multipliers) and the Monte Carlo SQL in `src/lib/queries/forecast-monte-carlo.ts` (hardcoded constants must match)

---

## When to Recalibrate vs When to Leave It Alone

**Update the config if:**
- Any duration threshold (avg or stddev) has shifted by more than 10 days
- Any duration multiplier has moved by more than 0.05
- The AUM tier join-rate gap has changed direction (e.g., Upper tier now converts higher than Lower)
- A stage that previously had "no penalty" (Signed) now has enough data to support one (N ≥ 20 in the over-SD buckets)

**Leave it alone if:**
- Thresholds and multipliers have moved less than the above limits
- Sample sizes in any bucket have dropped below 10 (the old values are more trustworthy than noisy new ones)
- You're mid-quarter and want stability for finance planning — only update at quarter boundaries

---

## Step 1: Recompute Duration Thresholds

This query computes the average and standard deviation of days spent in each stage, using the trailing 2yr resolved cohort. These are the values that define what "within 1 SD" and "2+ SD" mean.

```sql
-- Duration thresholds: avg + stddev per stage (2yr trailing resolved cohort)
-- Source: vw_funnel_master
-- Run at: start of each quarter

WITH cohort AS (
  SELECT
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c,
             Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c,
             Stage_Entered_Joined__c) AS eff_neg_ts,
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts,
    Date_Became_SQO__c
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Full_Opportunity_ID__c IS NOT NULL
    AND is_primary_opp_record = 1
    AND SQO_raw = 'Yes'
    AND StageName IN ('Joined', 'Closed Lost')
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY)
),

stage_durations AS (
  SELECT
    'Discovery (SQO→SP)' AS stage,
    DATE_DIFF(DATE(eff_sp_ts), DATE(Date_Became_SQO__c), DAY) AS days_in_stage
  FROM cohort
  WHERE eff_sp_ts IS NOT NULL
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(eff_sp_ts) >= DATE(Date_Became_SQO__c)

  UNION ALL

  SELECT
    'Sales Process (SP→Neg)' AS stage,
    DATE_DIFF(DATE(eff_neg_ts), DATE(eff_sp_ts), DAY) AS days_in_stage
  FROM cohort
  WHERE eff_sp_ts IS NOT NULL
    AND eff_neg_ts IS NOT NULL
    AND DATE(eff_neg_ts) >= DATE(eff_sp_ts)

  UNION ALL

  SELECT
    'Negotiating (Neg→Signed)' AS stage,
    DATE_DIFF(DATE(eff_signed_ts), DATE(eff_neg_ts), DAY) AS days_in_stage
  FROM cohort
  WHERE eff_neg_ts IS NOT NULL
    AND eff_signed_ts IS NOT NULL
    AND DATE(eff_signed_ts) >= DATE(eff_neg_ts)

  UNION ALL

  SELECT
    'Signed (Signed→Joined)' AS stage,
    DATE_DIFF(DATE(eff_joined_ts), DATE(eff_signed_ts), DAY) AS days_in_stage
  FROM cohort
  WHERE eff_signed_ts IS NOT NULL
    AND eff_joined_ts IS NOT NULL
    AND DATE(eff_joined_ts) >= DATE(eff_signed_ts)
)

SELECT
  stage,
  COUNT(*) AS n,
  ROUND(AVG(days_in_stage), 1) AS avg_days,
  ROUND(STDDEV(days_in_stage), 1) AS stddev_days,
  ROUND(AVG(days_in_stage) + STDDEV(days_in_stage), 0) AS threshold_1sd,
  ROUND(AVG(days_in_stage) + 2 * STDDEV(days_in_stage), 0) AS threshold_2sd,
  MIN(days_in_stage) AS min_days,
  MAX(days_in_stage) AS max_days,
  APPROX_QUANTILES(days_in_stage, 100)[OFFSET(50)] AS median_days
FROM stage_durations
GROUP BY stage
ORDER BY stage
```

### How to read the results

Compare each row against the current values in `forecast-config.ts`:

| Stage | Current 1 SD | Current 2 SD | New 1 SD | New 2 SD | Delta 1 SD | Delta 2 SD | Update? |
|-------|-------------|-------------|---------|---------|-----------|-----------|---------|
| Discovery | 36d | 64d | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Sales Process | 67d | 105d | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Negotiating | 50d | 81d | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Signed | ∞ | ∞ | _fill in_ | _fill in_ | — | — | _see below_ |

**Decision rule:** Update if any threshold shifted by more than 10 days. Otherwise leave it.

**Signed special case:** If the Signed stage now has N ≥ 20 in both the 1-2 SD and 2+ SD buckets (check Step 2 results), it may be worth introducing a Signed penalty. If N is still thin, keep the thresholds at Infinity (no penalty).

---

## Step 2: Recompute Duration Multipliers

This query computes the join rate by stage × duration bucket, then derives the multiplier (bucket join rate ÷ "within 1 SD" join rate). These multipliers are the core of the duration penalty.

```sql
-- Duration multipliers: join rate by stage × duration bucket
-- Uses the thresholds from Step 1 (plug in current or updated values)
-- Source: vw_funnel_master (all-time resolved SQOs for maximum sample size)

WITH cohort AS (
  SELECT
    StageName,
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c,
             Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c,
             Stage_Entered_Joined__c) AS eff_neg_ts,
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts,
    Date_Became_SQO__c,
    CASE WHEN COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) IS NOT NULL
          AND StageName != 'Closed Lost' THEN 1 ELSE 0 END AS is_joined
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Full_Opportunity_ID__c IS NOT NULL
    AND is_primary_opp_record = 1
    AND SQO_raw = 'Yes'
    AND StageName IN ('Joined', 'Closed Lost')
    AND recordtypeid = '012Dn000000mrO3IAI'
    -- All-time for maximum sample size on multipliers
),

with_durations AS (
  SELECT
    *,
    -- Days in Discovery (SQO → SP entry)
    CASE WHEN eff_sp_ts IS NOT NULL AND Date_Became_SQO__c IS NOT NULL
              AND DATE(eff_sp_ts) >= DATE(Date_Became_SQO__c)
         THEN DATE_DIFF(DATE(eff_sp_ts), DATE(Date_Became_SQO__c), DAY)
         ELSE NULL END AS days_in_discovery,
    -- Days in Sales Process (SP → Neg entry)
    CASE WHEN eff_sp_ts IS NOT NULL AND eff_neg_ts IS NOT NULL
              AND DATE(eff_neg_ts) >= DATE(eff_sp_ts)
         THEN DATE_DIFF(DATE(eff_neg_ts), DATE(eff_sp_ts), DAY)
         ELSE NULL END AS days_in_sp,
    -- Days in Negotiating (Neg → Signed entry)
    CASE WHEN eff_neg_ts IS NOT NULL AND eff_signed_ts IS NOT NULL
              AND DATE(eff_signed_ts) >= DATE(eff_neg_ts)
         THEN DATE_DIFF(DATE(eff_signed_ts), DATE(eff_neg_ts), DAY)
         ELSE NULL END AS days_in_neg,
    -- Days in Signed (Signed → Joined)
    CASE WHEN eff_signed_ts IS NOT NULL AND eff_joined_ts IS NOT NULL
              AND DATE(eff_joined_ts) >= DATE(eff_signed_ts)
         THEN DATE_DIFF(DATE(eff_joined_ts), DATE(eff_signed_ts), DAY)
         ELSE NULL END AS days_in_signed
  FROM cohort
),

-- Plug in your thresholds here (use current values from forecast-config.ts
-- or updated values from Step 1 if thresholds changed)
bucketed AS (
  -- Discovery
  SELECT 'Discovery' AS stage,
    CASE
      WHEN days_in_discovery > 64 THEN '2+ SD'
      WHEN days_in_discovery > 36 THEN '1-2 SD'
      ELSE 'Within 1 SD'
    END AS duration_bucket,
    is_joined
  FROM with_durations
  WHERE days_in_discovery IS NOT NULL

  UNION ALL

  -- Sales Process
  SELECT 'Sales Process' AS stage,
    CASE
      WHEN days_in_sp > 105 THEN '2+ SD'
      WHEN days_in_sp > 67 THEN '1-2 SD'
      ELSE 'Within 1 SD'
    END AS duration_bucket,
    is_joined
  FROM with_durations
  WHERE days_in_sp IS NOT NULL

  UNION ALL

  -- Negotiating
  SELECT 'Negotiating' AS stage,
    CASE
      WHEN days_in_neg > 81 THEN '2+ SD'
      WHEN days_in_neg > 50 THEN '1-2 SD'
      ELSE 'Within 1 SD'
    END AS duration_bucket,
    is_joined
  FROM with_durations
  WHERE days_in_neg IS NOT NULL

  UNION ALL

  -- Signed
  SELECT 'Signed' AS stage,
    CASE
      WHEN days_in_signed > 80 THEN '2+ SD'
      WHEN days_in_signed > 54 THEN '1-2 SD'
      ELSE 'Within 1 SD'
    END AS duration_bucket,
    is_joined
  FROM with_durations
  WHERE days_in_signed IS NOT NULL
)

SELECT
  stage,
  duration_bucket,
  COUNT(*) AS n,
  SUM(is_joined) AS joined,
  ROUND(SAFE_DIVIDE(SUM(is_joined), COUNT(*)) * 100, 1) AS join_rate_pct,
  -- Within 1 SD join rate for this stage (for multiplier computation)
  ROUND(SAFE_DIVIDE(SUM(is_joined), COUNT(*)) /
    MAX(CASE WHEN duration_bucket = 'Within 1 SD'
         THEN SAFE_DIVIDE(SUM(is_joined), COUNT(*)) END)
    OVER (PARTITION BY stage), 3) AS multiplier
FROM bucketed
GROUP BY stage, duration_bucket
ORDER BY stage,
  CASE duration_bucket
    WHEN 'Within 1 SD' THEN 1
    WHEN '1-2 SD' THEN 2
    WHEN '2+ SD' THEN 3
  END
```

**Note:** The `multiplier` column uses a window function that may not compute correctly in all SQL dialects within a GROUP BY. If it returns NULL, compute the multiplier manually: `bucket_join_rate / within_1sd_join_rate` for each stage.

### How to read the results

Compare each multiplier against the current values in `forecast-config.ts`:

| Stage | Bucket | Current Multiplier | New Multiplier | N | Delta | Update? |
|-------|--------|-------------------|---------------|---|-------|---------|
| Discovery | 1-2 SD | 0.667 | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Discovery | 2+ SD | 0.393 | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Sales Process | 1-2 SD | 0.755 | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Sales Process | 2+ SD | 0.176 | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Negotiating | 1-2 SD | 0.682 | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Negotiating | 2+ SD | 0.179 | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Signed | 1-2 SD | 1.0 | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |
| Signed | 2+ SD | 1.0 | _fill in_ | _fill in_ | _fill in_ | _Y/N_ |

**Decision rules:**
- Update if any multiplier has moved by more than 0.05
- Flag any bucket with N < 10 — the multiplier is unreliable and should not be updated based on it
- If a multiplier is trending toward 0.0 (stale deals essentially never close), consider whether a hard floor is warranted

---

## Step 3: Recompute AUM Tier Conversion Rates

This query checks whether the 2-tier (< $75M vs ≥ $75M) rate gap is still present and whether the tier boundary should shift.

```sql
-- AUM tier join rates (all-time resolved SQOs)
-- Check if the tier split is still producing meaningfully different rates

WITH cohort AS (
  SELECT
    StageName,
    COALESCE(Underwritten_AUM__c, Amount) AS aum,
    CASE WHEN COALESCE(Underwritten_AUM__c, Amount) < 75000000
         THEN 'Lower (< $75M)' ELSE 'Upper (≥ $75M)' END AS aum_tier_2,
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c,
             Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c,
             Stage_Entered_Joined__c) AS eff_neg_ts,
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts,
    CASE WHEN COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) IS NOT NULL
          AND StageName != 'Closed Lost' THEN 1 ELSE 0 END AS is_joined
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Full_Opportunity_ID__c IS NOT NULL
    AND is_primary_opp_record = 1
    AND SQO_raw = 'Yes'
    AND StageName IN ('Joined', 'Closed Lost')
    AND recordtypeid = '012Dn000000mrO3IAI'
)

SELECT
  aum_tier_2,
  COUNT(*) AS total_resolved,
  SUM(is_joined) AS joined,
  ROUND(SAFE_DIVIDE(SUM(is_joined), COUNT(*)) * 100, 1) AS join_rate_pct,

  -- Stage transition rates (reached or beyond methodology)
  ROUND(SAFE_DIVIDE(
    COUNTIF(eff_sp_ts IS NOT NULL OR eff_neg_ts IS NOT NULL
            OR eff_signed_ts IS NOT NULL OR is_joined = 1),
    COUNT(*)
  ) * 100, 1) AS sqo_to_sp_pct,

  SAFE_DIVIDE(
    COUNTIF(eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1),
    COUNTIF(eff_sp_ts IS NOT NULL OR eff_neg_ts IS NOT NULL
            OR eff_signed_ts IS NOT NULL OR is_joined = 1)
  ) AS sp_to_neg,

  SAFE_DIVIDE(
    COUNTIF(eff_signed_ts IS NOT NULL OR is_joined = 1),
    COUNTIF(eff_neg_ts IS NOT NULL OR eff_signed_ts IS NOT NULL OR is_joined = 1)
  ) AS neg_to_signed,

  SAFE_DIVIDE(
    COUNTIF(is_joined = 1),
    COUNTIF(eff_signed_ts IS NOT NULL OR is_joined = 1)
  ) AS signed_to_joined

FROM cohort
GROUP BY aum_tier_2
ORDER BY aum_tier_2
```

### How to read the results

| Metric | Current Lower | Current Upper | New Lower | New Upper | Change |
|--------|-------------|-------------|----------|----------|--------|
| Total resolved | ~605 | ~212 | _fill in_ | _fill in_ | |
| Joined | ~94 | ~20 | _fill in_ | _fill in_ | |
| SQO→Joined rate | 15.5% | 9.4% | _fill in_ | _fill in_ | |
| SP→Neg | 44.2% | 30.2% | _fill in_ | _fill in_ | |
| Neg→Signed | 53.5% | 56.4% | _fill in_ | _fill in_ | |
| Signed→Joined | 94.9% | 90.9% | _fill in_ | _fill in_ | |

**Decision rules:**
- If the Lower-vs-Upper join rate gap has narrowed to < 3pp, the tier split may no longer be worth the complexity — consider reverting to flat rates
- If Upper tier total resolved is still < 30, the per-stage rates are fragile — note this
- If the SP→Neg gap (the key discriminator in the research) has reversed direction, investigate why

**Tier boundary check:** If you suspect the $75M boundary should move, run the same query with different CASE thresholds ($50M, $100M) and see which boundary produces the largest join rate gap. Only move the boundary if the improvement is substantial and the sample sizes support it.

---

## Step 4: Validate the Tier Fallback Threshold

Check whether the current 1yr trailing Upper tier cohort is above the fallback minimum (currently N ≥ 15).

```sql
-- Upper tier trailing cohort size by window
-- If the 1yr Upper tier is below 15, the model falls back to flat rates

SELECT
  'Upper (≥ $75M)' AS tier,
  SUM(CASE WHEN DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY) THEN 1 ELSE 0 END) AS window_180d,
  SUM(CASE WHEN DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY) THEN 1 ELSE 0 END) AS window_1yr,
  SUM(CASE WHEN DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY) THEN 1 ELSE 0 END) AS window_2yr,
  COUNT(*) AS all_time
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Full_Opportunity_ID__c IS NOT NULL
  AND is_primary_opp_record = 1
  AND SQO_raw = 'Yes'
  AND StageName IN ('Joined', 'Closed Lost')
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND COALESCE(Underwritten_AUM__c, Amount) >= 75000000
```

**If the 1yr Upper tier count is still below 15:** The fallback to flat rates is still appropriate. No change needed.

**If it has grown above 30:** Consider lowering the fallback threshold or removing it. The tiered rates are now reliable enough to use at the 1yr window.

---

## Step 5: Shadow Mode Comparison (Quarter-End)

At the end of the quarter, compare how the adjusted model performed against the baseline. This uses the Sheets export you created at the start of the quarter.

### 5a: Pull actual joined AUM for the quarter

```sql
-- Actual joined AUM for the quarter just ended
-- Adjust the date range to match the quarter you're evaluating

SELECT
  COUNT(*) AS joined_count,
  SUM(COALESCE(Underwritten_AUM__c, Amount)) AS joined_aum,
  ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS joined_aum_m
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SQO_raw = 'Yes'
  AND is_primary_opp_record = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined'
  AND DATE(advisor_join_date__c) >= '2026-04-01'  -- quarter start
  AND DATE(advisor_join_date__c) < '2026-07-01'   -- quarter end
```

### 5b: Compare against the Sheets export

Open the Google Sheet export you saved at the start of the quarter. Filter to deals with Projected Quarter = the quarter you're evaluating (col W). Then:

| Metric | Value | Source |
|--------|-------|--------|
| Actual joined AUM this quarter | _from 5a query_ | BigQuery |
| Sum of Baseline Expected AUM (col AD) for projected quarter | _from sheet_ | Sheets col AD |
| Sum of Adjusted Expected AUM (col AE) for projected quarter | _from sheet_ | Sheets col AE |
| Baseline error | _(baseline - actual) / actual_ | Computed |
| Adjusted error | _(adjusted - actual) / actual_ | Computed |

**The adjusted model should have a smaller absolute error than baseline.** If it doesn't, investigate:
- Did a whale deal close unexpectedly (or fail to close)?
- Did the trailing rates shift significantly during the quarter?
- Are the duration penalties too aggressive (adjusted model under-predicting)?

### 5c: Log the result

Add a row to the table below and commit to `forecasting_research.md` under a "Post-Launch Validation" section:

| Quarter | Actual Joined AUM | Baseline Predicted | Baseline Error | Adjusted Predicted | Adjusted Error | Notes |
|---------|-------------------|-------------------|----------------|-------------------|----------------|-------|
| Q2 2026 | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ | _fill in_ |
| Q3 2026 | | | | | | |
| Q4 2026 | | | | | | |
| Q1 2027 | | | | | | |

---

## Step 6: Apply Updates (If Needed)

If Steps 1-3 produced values that crossed the update thresholds, make the changes:

### 6a: Update `src/lib/forecast-config.ts`

Update the `DURATION_THRESHOLDS` object with new sd1/sd2 values:
```ts
export const DURATION_THRESHOLDS: Record<string, { sd1: number; sd2: number }> = {
  'Discovery':     { sd1: NEW_VALUE, sd2: NEW_VALUE },
  'Sales Process': { sd1: NEW_VALUE, sd2: NEW_VALUE },
  'Negotiating':   { sd1: NEW_VALUE, sd2: NEW_VALUE },
  'Signed':        { sd1: Infinity,  sd2: Infinity  }, // Update if data now supports a penalty
};
```

Update the `DURATION_MULTIPLIERS` object with new multiplier values:
```ts
export const DURATION_MULTIPLIERS: Record<string, { within1sd: number; between1and2sd: number; over2sd: number }> = {
  'Discovery':     { within1sd: 1.0, between1and2sd: NEW_VALUE, over2sd: NEW_VALUE },
  'Sales Process': { within1sd: 1.0, between1and2sd: NEW_VALUE, over2sd: NEW_VALUE },
  'Negotiating':   { within1sd: 1.0, between1and2sd: NEW_VALUE, over2sd: NEW_VALUE },
  'Signed':        { within1sd: 1.0, between1and2sd: 1.0,       over2sd: 1.0       },
};
```

Update `AUM_TIER_BOUNDARY` if the tier boundary moved (rare).

### 6b: Update Monte Carlo SQL constants

Open `src/lib/queries/forecast-monte-carlo.ts` and find the `deal_rates` CTE. Update the hardcoded threshold values and multipliers to match the new `forecast-config.ts` values. These are in the `CASE` statements for `duration_bucket`, `duration_multiplier`, and `adjusted_current_rate`.

**Every number in the SQL must match the corresponding number in `forecast-config.ts`.** There is no auto-sync — this is a manual step. The parity tests catch mistakes.

### 6c: Update parity test expected values

Open `src/lib/__tests__/forecast-penalties.test.ts` and update the expected values in the test cases to reflect the new thresholds and multipliers.

### 6d: Run tests and verify

```bash
npm test -- forecast-penalties
```

All tests must pass with the updated expected values. If any fail, the config and test expectations are out of sync — fix before committing.

### 6e: Commit as a single PR

All three files (`forecast-config.ts`, `forecast-monte-carlo.ts`, `forecast-penalties.test.ts`) must be updated in the same PR. The commit message should reference the recalibration:

```
feat(forecast): quarterly recalibration Q2 2026

Updated duration thresholds and multipliers from 2yr trailing cohort.
Changes:
- Discovery 2 SD: 64d → 68d
- SP 1-2 SD multiplier: 0.755 → 0.72
- [list all changes]

Source: quarterly_forecast_recalibration.md Step 1-2 queries
```

---

## Recalibration Log

Record each recalibration here for audit trail:

| Quarter | Thresholds Changed? | Multipliers Changed? | Tier Boundary Changed? | Notes |
|---------|--------------------|--------------------|----------------------|-------|
| Q2 2026 (initial) | Baseline established | Baseline established | $75M established | From forecasting_research.md Phase 3 |
| Q3 2026 | _Y/N_ | _Y/N_ | _Y/N_ | _fill in_ |
| Q4 2026 | _Y/N_ | _Y/N_ | _Y/N_ | _fill in_ |
| Q1 2027 | _Y/N_ | _Y/N_ | _Y/N_ | _fill in_ |

---

## Quick Reference: Current Configuration

_Update this section each time you recalibrate._

**As of: Q2 2026 (initial baseline)**

| Stage | 1 SD Threshold | 2 SD Threshold | 1-2 SD Multiplier | 2+ SD Multiplier |
|-------|---------------|---------------|-------------------|------------------|
| Discovery | 36d | 64d | 0.667 | 0.393 |
| Sales Process | 67d | 105d | 0.755 | 0.176 |
| Negotiating | 50d | 81d | 0.682 | 0.179 |
| Signed | — | — | 1.0 | 1.0 |

**AUM Tier Boundary:** $75,000,000
**Tier Fallback Threshold:** N ≥ 15 resolved deals in trailing cohort
**Source Data:** 2yr trailing resolved cohort (thresholds), all-time resolved (multipliers)
