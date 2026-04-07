-- =============================================================================
-- SQO-to-Signed and SQO-to-Joined Lag Distribution Analysis
-- =============================================================================
--
-- Run Date:        Evaluated at runtime via CURRENT_DATE()
-- Cohort Windows:  Last 2 years (DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
--                  Last 1 year  (DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR))
-- Dataset:         savvy-gtm-analytics.Tableau_Views.vw_funnel_master
-- Note:            CURRENT_DATE() is evaluated at query execution time (UTC).
--                  Results will shift slightly each day as new SQOs age into
--                  maturity gates and the rolling window advances.
--                  For reproducible snapshots, replace CURRENT_DATE() with a
--                  literal date (e.g., '2026-04-01').
-- =============================================================================


-- =============================================================================
-- SECTION 1: DATA VALIDATION CHECKS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Population rates for key date fields on SQO records
--
-- Calculates: % of unique recruiting SQOs with each date field populated,
--             plus anomaly counts (signed/joined before SQO).
-- Denominator: All unique recruiting SQOs (is_sqo_unique = 1, recruiting recordtype).
-- Caveats: None.
-- ---------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_sqo_unique,
  COUNTIF(Date_Became_SQO__c IS NOT NULL) AS has_sqo_date,
  ROUND(SAFE_DIVIDE(COUNTIF(Date_Became_SQO__c IS NOT NULL), COUNT(*)) * 100, 1) AS sqo_date_pct,
  COUNTIF(Stage_Entered_Signed__c IS NOT NULL) AS has_signed_date,
  COUNTIF(Stage_Entered_Joined__c IS NOT NULL) AS has_joined_date,
  COUNTIF(advisor_join_date__c IS NOT NULL) AS has_join_date_field,
  -- Anomaly checks: conversion date before SQO date
  COUNTIF(Stage_Entered_Signed__c IS NOT NULL
    AND TIMESTAMP(Stage_Entered_Signed__c) < TIMESTAMP(Date_Became_SQO__c)) AS signed_before_sqo,
  COUNTIF(Stage_Entered_Joined__c IS NOT NULL
    AND TIMESTAMP(Stage_Entered_Joined__c) < TIMESTAMP(Date_Became_SQO__c)) AS joined_before_sqo,
  -- Stage-skip check: joined without signing
  COUNTIF(Stage_Entered_Signed__c IS NULL
    AND Stage_Entered_Joined__c IS NOT NULL) AS joined_without_signed,
  COUNTIF(Stage_Entered_Signed__c IS NOT NULL
    AND Stage_Entered_Joined__c IS NULL) AS signed_without_joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI';

-- ---------------------------------------------------------------------------
-- 1b. SQO counts by year (cross-reference with dashboard known values)
--
-- Calculates: SQO volume, signed count, joined count per calendar year.
-- Denominator: All unique recruiting SQOs with Date_Became_SQO__c populated.
-- Caveats: None.
-- ---------------------------------------------------------------------------
SELECT
  FORMAT_DATE('%Y', DATE(Date_Became_SQO__c)) AS sqo_year,
  COUNT(*) AS sqo_count,
  COUNTIF(Stage_Entered_Signed__c IS NOT NULL) AS signed_count,
  COUNTIF(Stage_Entered_Joined__c IS NOT NULL) AS joined_ts_count,
  COUNTIF(advisor_join_date__c IS NOT NULL AND StageName != 'Closed Lost') AS joined_net_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND Date_Became_SQO__c IS NOT NULL
GROUP BY 1
ORDER BY 1;


-- =============================================================================
-- SECTION 2: VELOCITY STATISTICS (converted records only)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 2a. Median and mean days to Signed and Joined (2-year window)
--
-- Calculates: Median and mean calendar days from SQO to Signed/Joined,
--             for records that actually converted.
-- Denominator: Only SQOs that reached the respective stage.
-- Caveats: Right-skewed distribution (mean > median). These stats describe
--          converted deals only — not the full SQO population.
-- ---------------------------------------------------------------------------
SELECT
  'Signed (2yr)' AS metric,
  COUNT(*) AS n,
  APPROX_QUANTILES(
    DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY), 100
  )[OFFSET(50)] AS median_days,
  ROUND(AVG(
    DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
  ), 1) AS mean_days
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND Date_Became_SQO__c IS NOT NULL
  AND Stage_Entered_Signed__c IS NOT NULL
  AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)

UNION ALL

SELECT
  'Joined (2yr)',
  COUNT(*),
  APPROX_QUANTILES(
    DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY), 100
  )[OFFSET(50)],
  ROUND(AVG(
    DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY)
  ), 1)
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND Date_Became_SQO__c IS NOT NULL
  AND Stage_Entered_Joined__c IS NOT NULL
  AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR);


-- =============================================================================
-- SECTION 3: SQO -> SIGNED — LAST 2 YEARS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 3a. Discrete lag buckets — maturity-gated (2yr)
--
-- Calculates: What % of SQOs converted to Signed IN each 30-day window.
-- Denominator: For each bucket, only SQOs old enough to have had the chance
--              to convert within that window (e.g., 0-30d bucket requires
--              SQOs aged >= 30 days). Denominator shrinks per bucket.
-- Caveats: Bucket percentages use DIFFERENT denominators and are NOT additive.
--          See Section 3c for fixed-cohort additive distribution.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) AS days_since_sqo,
    CASE WHEN Stage_Entered_Signed__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
)
SELECT '0-30 days' AS lag_bucket, 1 AS sort_order,
  COUNTIF(days_since_sqo >= 30) AS denominator,
  COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30) AS converted,
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30),
    COUNTIF(days_since_sqo >= 30)) * 100, 2) AS pct
FROM sqo_base
UNION ALL
SELECT '31-60 days', 2,
  COUNTIF(days_since_sqo >= 60),
  COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 31 AND 60),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 31 AND 60),
    COUNTIF(days_since_sqo >= 60)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '61-90 days', 3,
  COUNTIF(days_since_sqo >= 90),
  COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 61 AND 90),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 61 AND 90),
    COUNTIF(days_since_sqo >= 90)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '91-120 days', 4,
  COUNTIF(days_since_sqo >= 120),
  COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 91 AND 120),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 91 AND 120),
    COUNTIF(days_since_sqo >= 120)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '121-150 days', 5,
  COUNTIF(days_since_sqo >= 150),
  COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 121 AND 150),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 121 AND 150),
    COUNTIF(days_since_sqo >= 150)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '151-180 days', 6,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 151 AND 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 151 AND 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '180+ days', 7,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event > 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event > 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
ORDER BY sort_order;

-- ---------------------------------------------------------------------------
-- 3b. Cumulative conversion — maturity-gated (2yr)
--
-- Calculates: What % of SQOs have converted to Signed BY each threshold.
-- Denominator: Same maturity gating as 3a — each row uses only SQOs old
--              enough for that threshold. Denominator shrinks per row.
-- Caveats: Raw cumulative counts may decrease across rows (expected).
--          Focus on the RATE column, which is monotonically non-decreasing.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) AS days_since_sqo,
    CASE WHEN Stage_Entered_Signed__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
)
SELECT 'By day 30' AS threshold, 1 AS sort_order,
  COUNTIF(days_since_sqo >= 30) AS denominator,
  COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30) AS cumulative_converted,
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30),
    COUNTIF(days_since_sqo >= 30)) * 100, 2) AS cumulative_rate
FROM sqo_base
UNION ALL
SELECT 'By day 60', 2,
  COUNTIF(days_since_sqo >= 60),
  COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 0 AND 60),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 0 AND 60),
    COUNTIF(days_since_sqo >= 60)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 90', 3,
  COUNTIF(days_since_sqo >= 90),
  COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 0 AND 90),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 0 AND 90),
    COUNTIF(days_since_sqo >= 90)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 120', 4,
  COUNTIF(days_since_sqo >= 120),
  COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 0 AND 120),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 0 AND 120),
    COUNTIF(days_since_sqo >= 120)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 150', 5,
  COUNTIF(days_since_sqo >= 150),
  COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 0 AND 150),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 0 AND 150),
    COUNTIF(days_since_sqo >= 150)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 180', 6,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 0 AND 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 0 AND 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
ORDER BY sort_order;

-- ---------------------------------------------------------------------------
-- 3c. Fixed-cohort distribution — Signed (2yr, SQOs aged 180+ days)
--
-- Calculates: True additive lag distribution using a SINGLE denominator.
--             All SQOs in the cohort are at least 180 days old, so every
--             bucket from 0-30 through 151-180 has the same denominator.
-- Denominator: All unique recruiting SQOs created in the last 2 years AND
--              aged at least 180 days from today.
-- Caveats: The 180+ bucket remains open-ended and indicative only.
--          Excludes SQOs created in the most recent 6 months.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    CASE WHEN Stage_Entered_Signed__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
    AND DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 180
)
SELECT
  COUNT(*) AS fixed_denominator,
  COUNTIF(days_to_event BETWEEN 0 AND 30) AS bucket_0_30,
  COUNTIF(days_to_event BETWEEN 31 AND 60) AS bucket_31_60,
  COUNTIF(days_to_event BETWEEN 61 AND 90) AS bucket_61_90,
  COUNTIF(days_to_event BETWEEN 91 AND 120) AS bucket_91_120,
  COUNTIF(days_to_event BETWEEN 121 AND 150) AS bucket_121_150,
  COUNTIF(days_to_event BETWEEN 151 AND 180) AS bucket_151_180,
  COUNTIF(days_to_event > 180) AS bucket_180_plus,
  COUNTIF(days_to_event >= 0) AS total_signed,
  -- Discrete rates
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 30), COUNT(*)) * 100, 2) AS pct_0_30,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 31 AND 60), COUNT(*)) * 100, 2) AS pct_31_60,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 61 AND 90), COUNT(*)) * 100, 2) AS pct_61_90,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 91 AND 120), COUNT(*)) * 100, 2) AS pct_91_120,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 121 AND 150), COUNT(*)) * 100, 2) AS pct_121_150,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 151 AND 180), COUNT(*)) * 100, 2) AS pct_151_180,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event > 180), COUNT(*)) * 100, 2) AS pct_180_plus,
  -- Cumulative rates
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 30), COUNT(*)) * 100, 2) AS cum_30,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 60), COUNT(*)) * 100, 2) AS cum_60,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 90), COUNT(*)) * 100, 2) AS cum_90,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 120), COUNT(*)) * 100, 2) AS cum_120,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 150), COUNT(*)) * 100, 2) AS cum_150,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 180), COUNT(*)) * 100, 2) AS cum_180,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event >= 0), COUNT(*)) * 100, 2) AS cum_total
FROM sqo_base;


-- =============================================================================
-- SECTION 4: SQO -> SIGNED — LAST 1 YEAR
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 4a. Discrete lag buckets — maturity-gated (1yr)
--
-- Calculates: Same as 3a but for SQOs created in the last 1 year only.
-- Denominator: Maturity-gated per bucket (same logic as 3a).
-- Caveats: Smaller sample; 180+ bucket only includes SQOs from ~6+ months ago.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) AS days_since_sqo,
    CASE WHEN Stage_Entered_Signed__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)
)
SELECT '0-30 days' AS lag_bucket, 1 AS sort_order,
  COUNTIF(days_since_sqo >= 30) AS denominator,
  COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30) AS converted,
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30),
    COUNTIF(days_since_sqo >= 30)) * 100, 2) AS pct
FROM sqo_base
UNION ALL
SELECT '31-60 days', 2,
  COUNTIF(days_since_sqo >= 60),
  COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 31 AND 60),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 31 AND 60),
    COUNTIF(days_since_sqo >= 60)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '61-90 days', 3,
  COUNTIF(days_since_sqo >= 90),
  COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 61 AND 90),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 61 AND 90),
    COUNTIF(days_since_sqo >= 90)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '91-120 days', 4,
  COUNTIF(days_since_sqo >= 120),
  COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 91 AND 120),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 91 AND 120),
    COUNTIF(days_since_sqo >= 120)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '121-150 days', 5,
  COUNTIF(days_since_sqo >= 150),
  COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 121 AND 150),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 121 AND 150),
    COUNTIF(days_since_sqo >= 150)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '151-180 days', 6,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 151 AND 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 151 AND 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '180+ days', 7,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event > 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event > 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
ORDER BY sort_order;

-- ---------------------------------------------------------------------------
-- 4b. Cumulative conversion — maturity-gated (1yr)
--
-- Calculates: Same as 3b but for 1-year cohort.
-- Denominator: Maturity-gated per threshold.
-- Caveats: Same as 3b.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) AS days_since_sqo,
    CASE WHEN Stage_Entered_Signed__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)
)
SELECT 'By day 30' AS threshold, 1 AS sort_order,
  COUNTIF(days_since_sqo >= 30) AS denominator,
  COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30) AS cumulative_converted,
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30),
    COUNTIF(days_since_sqo >= 30)) * 100, 2) AS cumulative_rate
FROM sqo_base
UNION ALL
SELECT 'By day 60', 2,
  COUNTIF(days_since_sqo >= 60),
  COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 0 AND 60),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 0 AND 60),
    COUNTIF(days_since_sqo >= 60)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 90', 3,
  COUNTIF(days_since_sqo >= 90),
  COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 0 AND 90),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 0 AND 90),
    COUNTIF(days_since_sqo >= 90)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 120', 4,
  COUNTIF(days_since_sqo >= 120),
  COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 0 AND 120),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 0 AND 120),
    COUNTIF(days_since_sqo >= 120)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 150', 5,
  COUNTIF(days_since_sqo >= 150),
  COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 0 AND 150),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 0 AND 150),
    COUNTIF(days_since_sqo >= 150)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 180', 6,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 0 AND 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 0 AND 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
ORDER BY sort_order;

-- ---------------------------------------------------------------------------
-- 4c. Fixed-cohort distribution — Signed (1yr, SQOs aged 180+ days)
--
-- Calculates: Same as 3c but restricted to the 1-year cohort window.
-- Denominator: SQOs created in last 1 year AND aged 180+ days.
-- Caveats: Very narrow window (only SQOs from ~6-12 months ago). Small N.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    CASE WHEN Stage_Entered_Signed__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)
    AND DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 180
)
SELECT
  COUNT(*) AS fixed_denominator,
  COUNTIF(days_to_event BETWEEN 0 AND 30) AS bucket_0_30,
  COUNTIF(days_to_event BETWEEN 31 AND 60) AS bucket_31_60,
  COUNTIF(days_to_event BETWEEN 61 AND 90) AS bucket_61_90,
  COUNTIF(days_to_event BETWEEN 91 AND 120) AS bucket_91_120,
  COUNTIF(days_to_event BETWEEN 121 AND 150) AS bucket_121_150,
  COUNTIF(days_to_event BETWEEN 151 AND 180) AS bucket_151_180,
  COUNTIF(days_to_event > 180) AS bucket_180_plus,
  COUNTIF(days_to_event >= 0) AS total_signed,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 30), COUNT(*)) * 100, 2) AS cum_30,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 60), COUNT(*)) * 100, 2) AS cum_60,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 90), COUNT(*)) * 100, 2) AS cum_90,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 120), COUNT(*)) * 100, 2) AS cum_120,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 150), COUNT(*)) * 100, 2) AS cum_150,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 180), COUNT(*)) * 100, 2) AS cum_180,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event >= 0), COUNT(*)) * 100, 2) AS cum_total
FROM sqo_base;


-- =============================================================================
-- SECTION 5: SQO -> JOINED — LAST 2 YEARS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 5a. Discrete lag buckets — maturity-gated (2yr)
--
-- Calculates: What % of SQOs entered Joined stage IN each 30-day window.
-- Denominator: Maturity-gated per bucket (same as Section 3 logic).
-- Caveats: Uses Stage_Entered_Joined__c (gross joins — includes advisors
--          who later churned to Closed Lost). Dashboard is_joined excludes
--          those. See analysis-plan.md Section 6 for discussion.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) AS days_since_sqo,
    CASE WHEN Stage_Entered_Joined__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
)
SELECT '0-30 days' AS lag_bucket, 1 AS sort_order,
  COUNTIF(days_since_sqo >= 30) AS denominator,
  COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30) AS converted,
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30),
    COUNTIF(days_since_sqo >= 30)) * 100, 2) AS pct
FROM sqo_base
UNION ALL
SELECT '31-60 days', 2,
  COUNTIF(days_since_sqo >= 60),
  COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 31 AND 60),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 31 AND 60),
    COUNTIF(days_since_sqo >= 60)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '61-90 days', 3,
  COUNTIF(days_since_sqo >= 90),
  COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 61 AND 90),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 61 AND 90),
    COUNTIF(days_since_sqo >= 90)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '91-120 days', 4,
  COUNTIF(days_since_sqo >= 120),
  COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 91 AND 120),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 91 AND 120),
    COUNTIF(days_since_sqo >= 120)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '121-150 days', 5,
  COUNTIF(days_since_sqo >= 150),
  COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 121 AND 150),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 121 AND 150),
    COUNTIF(days_since_sqo >= 150)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '151-180 days', 6,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 151 AND 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 151 AND 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '180+ days', 7,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event > 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event > 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
ORDER BY sort_order;

-- ---------------------------------------------------------------------------
-- 5b. Cumulative conversion — maturity-gated (2yr)
--
-- Calculates: What % of SQOs have entered Joined BY each threshold.
-- Denominator: Maturity-gated per threshold.
-- Caveats: Same as 5a (gross joins).
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) AS days_since_sqo,
    CASE WHEN Stage_Entered_Joined__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
)
SELECT 'By day 30' AS threshold, 1 AS sort_order,
  COUNTIF(days_since_sqo >= 30) AS denominator,
  COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30) AS cumulative_converted,
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30),
    COUNTIF(days_since_sqo >= 30)) * 100, 2) AS cumulative_rate
FROM sqo_base
UNION ALL
SELECT 'By day 60', 2,
  COUNTIF(days_since_sqo >= 60),
  COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 0 AND 60),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 0 AND 60),
    COUNTIF(days_since_sqo >= 60)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 90', 3,
  COUNTIF(days_since_sqo >= 90),
  COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 0 AND 90),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 0 AND 90),
    COUNTIF(days_since_sqo >= 90)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 120', 4,
  COUNTIF(days_since_sqo >= 120),
  COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 0 AND 120),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 0 AND 120),
    COUNTIF(days_since_sqo >= 120)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 150', 5,
  COUNTIF(days_since_sqo >= 150),
  COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 0 AND 150),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 0 AND 150),
    COUNTIF(days_since_sqo >= 150)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 180', 6,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 0 AND 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 0 AND 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
ORDER BY sort_order;

-- ---------------------------------------------------------------------------
-- 5c. Fixed-cohort distribution — Joined (2yr, SQOs aged 180+ days)
--
-- Calculates: True additive lag distribution for Joined stage.
-- Denominator: SQOs created in last 2 years AND aged 180+ days.
-- Caveats: Gross joins (see 5a). 180+ bucket is open-ended.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    CASE WHEN Stage_Entered_Joined__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
    AND DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 180
)
SELECT
  COUNT(*) AS fixed_denominator,
  COUNTIF(days_to_event BETWEEN 0 AND 30) AS bucket_0_30,
  COUNTIF(days_to_event BETWEEN 31 AND 60) AS bucket_31_60,
  COUNTIF(days_to_event BETWEEN 61 AND 90) AS bucket_61_90,
  COUNTIF(days_to_event BETWEEN 91 AND 120) AS bucket_91_120,
  COUNTIF(days_to_event BETWEEN 121 AND 150) AS bucket_121_150,
  COUNTIF(days_to_event BETWEEN 151 AND 180) AS bucket_151_180,
  COUNTIF(days_to_event > 180) AS bucket_180_plus,
  COUNTIF(days_to_event >= 0) AS total_joined,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 30), COUNT(*)) * 100, 2) AS cum_30,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 60), COUNT(*)) * 100, 2) AS cum_60,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 90), COUNT(*)) * 100, 2) AS cum_90,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 120), COUNT(*)) * 100, 2) AS cum_120,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 150), COUNT(*)) * 100, 2) AS cum_150,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 180), COUNT(*)) * 100, 2) AS cum_180,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event >= 0), COUNT(*)) * 100, 2) AS cum_total
FROM sqo_base;


-- =============================================================================
-- SECTION 6: SQO -> JOINED — LAST 1 YEAR
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 6a. Discrete lag buckets — maturity-gated (1yr)
--
-- Calculates: Same as 5a but for 1-year cohort.
-- Denominator: Maturity-gated per bucket.
-- Caveats: Smaller sample; gross joins.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) AS days_since_sqo,
    CASE WHEN Stage_Entered_Joined__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)
)
SELECT '0-30 days' AS lag_bucket, 1 AS sort_order,
  COUNTIF(days_since_sqo >= 30) AS denominator,
  COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30) AS converted,
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30),
    COUNTIF(days_since_sqo >= 30)) * 100, 2) AS pct
FROM sqo_base
UNION ALL
SELECT '31-60 days', 2,
  COUNTIF(days_since_sqo >= 60),
  COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 31 AND 60),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 31 AND 60),
    COUNTIF(days_since_sqo >= 60)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '61-90 days', 3,
  COUNTIF(days_since_sqo >= 90),
  COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 61 AND 90),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 61 AND 90),
    COUNTIF(days_since_sqo >= 90)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '91-120 days', 4,
  COUNTIF(days_since_sqo >= 120),
  COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 91 AND 120),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 91 AND 120),
    COUNTIF(days_since_sqo >= 120)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '121-150 days', 5,
  COUNTIF(days_since_sqo >= 150),
  COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 121 AND 150),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 121 AND 150),
    COUNTIF(days_since_sqo >= 150)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '151-180 days', 6,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 151 AND 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 151 AND 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT '180+ days', 7,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event > 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event > 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
ORDER BY sort_order;

-- ---------------------------------------------------------------------------
-- 6b. Cumulative conversion — maturity-gated (1yr)
--
-- Calculates: Same as 5b but for 1-year cohort.
-- Denominator: Maturity-gated per threshold.
-- Caveats: Same as 6a.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) AS days_since_sqo,
    CASE WHEN Stage_Entered_Joined__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)
)
SELECT 'By day 30' AS threshold, 1 AS sort_order,
  COUNTIF(days_since_sqo >= 30) AS denominator,
  COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30) AS cumulative_converted,
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 30 AND days_to_event BETWEEN 0 AND 30),
    COUNTIF(days_since_sqo >= 30)) * 100, 2) AS cumulative_rate
FROM sqo_base
UNION ALL
SELECT 'By day 60', 2,
  COUNTIF(days_since_sqo >= 60),
  COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 0 AND 60),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 60 AND days_to_event BETWEEN 0 AND 60),
    COUNTIF(days_since_sqo >= 60)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 90', 3,
  COUNTIF(days_since_sqo >= 90),
  COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 0 AND 90),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 90 AND days_to_event BETWEEN 0 AND 90),
    COUNTIF(days_since_sqo >= 90)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 120', 4,
  COUNTIF(days_since_sqo >= 120),
  COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 0 AND 120),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 120 AND days_to_event BETWEEN 0 AND 120),
    COUNTIF(days_since_sqo >= 120)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 150', 5,
  COUNTIF(days_since_sqo >= 150),
  COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 0 AND 150),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 150 AND days_to_event BETWEEN 0 AND 150),
    COUNTIF(days_since_sqo >= 150)) * 100, 2)
FROM sqo_base
UNION ALL
SELECT 'By day 180', 6,
  COUNTIF(days_since_sqo >= 180),
  COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 0 AND 180),
  ROUND(SAFE_DIVIDE(COUNTIF(days_since_sqo >= 180 AND days_to_event BETWEEN 0 AND 180),
    COUNTIF(days_since_sqo >= 180)) * 100, 2)
FROM sqo_base
ORDER BY sort_order;

-- ---------------------------------------------------------------------------
-- 6c. Fixed-cohort distribution — Joined (1yr, SQOs aged 180+ days)
--
-- Calculates: True additive lag distribution for 1-year Joined cohort.
-- Denominator: SQOs created in last 1 year AND aged 180+ days.
-- Caveats: Very narrow window. Small N. Gross joins.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    CASE WHEN Stage_Entered_Joined__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 1 YEAR)
    AND DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 180
)
SELECT
  COUNT(*) AS fixed_denominator,
  COUNTIF(days_to_event BETWEEN 0 AND 30) AS bucket_0_30,
  COUNTIF(days_to_event BETWEEN 31 AND 60) AS bucket_31_60,
  COUNTIF(days_to_event BETWEEN 61 AND 90) AS bucket_61_90,
  COUNTIF(days_to_event BETWEEN 91 AND 120) AS bucket_91_120,
  COUNTIF(days_to_event BETWEEN 121 AND 150) AS bucket_121_150,
  COUNTIF(days_to_event BETWEEN 151 AND 180) AS bucket_151_180,
  COUNTIF(days_to_event > 180) AS bucket_180_plus,
  COUNTIF(days_to_event >= 0) AS total_joined,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 30), COUNT(*)) * 100, 2) AS cum_30,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 60), COUNT(*)) * 100, 2) AS cum_60,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 90), COUNT(*)) * 100, 2) AS cum_90,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 120), COUNT(*)) * 100, 2) AS cum_120,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 150), COUNT(*)) * 100, 2) AS cum_150,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 180), COUNT(*)) * 100, 2) AS cum_180,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event >= 0), COUNT(*)) * 100, 2) AS cum_total
FROM sqo_base;


-- =============================================================================
-- SECTION 7: RECENT MATURE COHORT (Last 12 months, aged 180+ days)
-- =============================================================================
--
-- WHY THIS COHORT EXISTS: The 2-year fixed cohort blends older and newer
-- performance. This cohort isolates SQOs from approximately Apr-Oct 2025
-- (created in the last 12 months AND at least 180 days old) to test whether
-- conversion rates are declining vs the 2-year blended number.
-- If the recent rate diverges by >2pp, it signals a structural change that
-- should be reflected in forward planning.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 7a. Fixed-cohort distribution — Signed (recent mature)
--
-- Calculates: True additive lag distribution for Signed, recent cohort only.
-- Denominator: SQOs created in last 12 months AND aged 180+ days (~Apr-Oct 2025).
-- Caveats: Smaller N (~252) than the 2-year cohort (565). Excludes SQOs
--          created before Apr 2025 and after ~Oct 2025.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    CASE WHEN Stage_Entered_Signed__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
    AND DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 180
)
SELECT
  COUNT(*) AS fixed_denominator,
  COUNTIF(days_to_event BETWEEN 0 AND 30) AS bucket_0_30,
  COUNTIF(days_to_event BETWEEN 31 AND 60) AS bucket_31_60,
  COUNTIF(days_to_event BETWEEN 61 AND 90) AS bucket_61_90,
  COUNTIF(days_to_event BETWEEN 91 AND 120) AS bucket_91_120,
  COUNTIF(days_to_event BETWEEN 121 AND 150) AS bucket_121_150,
  COUNTIF(days_to_event BETWEEN 151 AND 180) AS bucket_151_180,
  COUNTIF(days_to_event > 180) AS bucket_180_plus,
  COUNTIF(days_to_event >= 0) AS total_signed,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 30), COUNT(*)) * 100, 2) AS cum_30,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 60), COUNT(*)) * 100, 2) AS cum_60,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 90), COUNT(*)) * 100, 2) AS cum_90,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 120), COUNT(*)) * 100, 2) AS cum_120,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 150), COUNT(*)) * 100, 2) AS cum_150,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 180), COUNT(*)) * 100, 2) AS cum_180,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event >= 0), COUNT(*)) * 100, 2) AS cum_total
FROM sqo_base;

-- ---------------------------------------------------------------------------
-- 7b. Fixed-cohort distribution — Joined (recent mature)
--
-- Calculates: True additive lag distribution for Joined, recent cohort only.
-- Denominator: Same as 7a.
-- Caveats: Gross joins (includes later Closed Lost). Smaller N.
-- ---------------------------------------------------------------------------
WITH sqo_base AS (
  SELECT
    CASE WHEN Stage_Entered_Joined__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Date_Became_SQO__c), DAY)
      ELSE NULL
    END AS days_to_event
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH)
    AND DATE_DIFF(CURRENT_DATE(), DATE(Date_Became_SQO__c), DAY) >= 180
)
SELECT
  COUNT(*) AS fixed_denominator,
  COUNTIF(days_to_event BETWEEN 0 AND 30) AS bucket_0_30,
  COUNTIF(days_to_event BETWEEN 31 AND 60) AS bucket_31_60,
  COUNTIF(days_to_event BETWEEN 61 AND 90) AS bucket_61_90,
  COUNTIF(days_to_event BETWEEN 91 AND 120) AS bucket_91_120,
  COUNTIF(days_to_event BETWEEN 121 AND 150) AS bucket_121_150,
  COUNTIF(days_to_event BETWEEN 151 AND 180) AS bucket_151_180,
  COUNTIF(days_to_event > 180) AS bucket_180_plus,
  COUNTIF(days_to_event >= 0) AS total_joined,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 30), COUNT(*)) * 100, 2) AS cum_30,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 60), COUNT(*)) * 100, 2) AS cum_60,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 90), COUNT(*)) * 100, 2) AS cum_90,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 120), COUNT(*)) * 100, 2) AS cum_120,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 150), COUNT(*)) * 100, 2) AS cum_150,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event BETWEEN 0 AND 180), COUNT(*)) * 100, 2) AS cum_180,
  ROUND(SAFE_DIVIDE(COUNTIF(days_to_event >= 0), COUNT(*)) * 100, 2) AS cum_total
FROM sqo_base;


-- =============================================================================
-- SECTION 8: SQO -> JOINED (FROM SIGNED ONLY)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 8a. Signed-to-Joined lag — fixed cohort (2yr, SQOs that reached Signed)
--
-- Calculates: Of SQOs that reached Signed, what % subsequently entered
--             Joined, and how quickly?
-- Denominator: Only SQOs with Stage_Entered_Signed__c IS NOT NULL
--              (i.e., the denominator is "signed SQOs", not all SQOs).
-- Caveats: Measures the Signed-to-Joined conversion specifically. This is
--          a fundamentally different question than SQO-to-Joined: it tells
--          you how long signing takes to convert to joining, conditional on
--          having already signed. Fixed cohort (aged 180+ days).
-- ---------------------------------------------------------------------------
WITH signed_base AS (
  SELECT
    CASE WHEN Stage_Entered_Joined__c IS NOT NULL
      THEN DATE_DIFF(DATE(Stage_Entered_Joined__c), DATE(Stage_Entered_Signed__c), DAY)
      ELSE NULL
    END AS days_signed_to_joined
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE is_sqo_unique = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND Date_Became_SQO__c IS NOT NULL
    AND Stage_Entered_Signed__c IS NOT NULL
    AND DATE(Date_Became_SQO__c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
    AND DATE_DIFF(CURRENT_DATE(), DATE(Stage_Entered_Signed__c), DAY) >= 120
)
SELECT
  COUNT(*) AS signed_denominator,
  COUNTIF(days_signed_to_joined BETWEEN 0 AND 30) AS joined_0_30,
  COUNTIF(days_signed_to_joined BETWEEN 31 AND 60) AS joined_31_60,
  COUNTIF(days_signed_to_joined BETWEEN 61 AND 90) AS joined_61_90,
  COUNTIF(days_signed_to_joined BETWEEN 91 AND 120) AS joined_91_120,
  COUNTIF(days_signed_to_joined >= 0) AS total_joined,
  ROUND(SAFE_DIVIDE(COUNTIF(days_signed_to_joined BETWEEN 0 AND 30), COUNT(*)) * 100, 2) AS pct_0_30,
  ROUND(SAFE_DIVIDE(COUNTIF(days_signed_to_joined BETWEEN 0 AND 60), COUNT(*)) * 100, 2) AS cum_60,
  ROUND(SAFE_DIVIDE(COUNTIF(days_signed_to_joined BETWEEN 0 AND 90), COUNT(*)) * 100, 2) AS cum_90,
  ROUND(SAFE_DIVIDE(COUNTIF(days_signed_to_joined BETWEEN 0 AND 120), COUNT(*)) * 100, 2) AS cum_120,
  ROUND(SAFE_DIVIDE(COUNTIF(days_signed_to_joined >= 0), COUNT(*)) * 100, 2) AS cum_total,
  APPROX_QUANTILES(
    CASE WHEN days_signed_to_joined >= 0 THEN days_signed_to_joined END, 100
  )[OFFSET(50)] AS median_days_signed_to_joined,
  ROUND(AVG(
    CASE WHEN days_signed_to_joined >= 0 THEN days_signed_to_joined END
  ), 1) AS mean_days_signed_to_joined
FROM signed_base;
