-- ============================================================
-- $100M–$200M ADVISOR SIGNAL ANALYSIS
-- Option A: Signal discrimination using closed-lost as labeled cohort
-- Option C: Loss reason analysis for closed-lost SQLs
--
-- BLOCK 1: Environment + Cohort Size Check
-- BLOCK 2: Build Labeled Cohort Feature Table
-- BLOCK 3: Option C — Loss Reason Analysis
-- BLOCK 4: Option A — Signal Discrimination vs Control
-- BLOCK 5: Three-Way Comparison ($40-100M vs $100-200M vs Control)
-- BLOCK 6: Population Sizing + Overlap Check
-- BLOCK 7: Shadow Table Build (conditional — see agent guide)
-- ============================================================


-- ============================================================
-- BLOCK 1: ENVIRONMENT + COHORT VALIDATION
-- Confirm prereq tables exist and labeled cohort is viable.
-- ============================================================

-- 1A: Confirm cohort size and sub-band distribution
SELECT
  COUNT(*)                                                     AS total_opps,
  COUNT(DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64))
                                                               AS unique_crds,
  COUNTIF(LOWER(StageName) LIKE '%won%')                       AS closed_won,
  COUNTIF(LOWER(StageName) LIKE '%lost%')                      AS closed_lost,
  COUNTIF(LOWER(StageName) NOT LIKE '%won%'
    AND LOWER(StageName) NOT LIKE '%lost%')                    AS open,
  COUNTIF(SQL__c = 'Yes'
    AND LOWER(StageName) LIKE '%lost%')                        AS sql_closed_lost,
  COUNTIF(COALESCE(Underwritten_AUM__c, Amount)
    BETWEEN 100000000 AND 150000000)                           AS band_100_150m,
  COUNTIF(COALESCE(Underwritten_AUM__c, Amount)
    BETWEEN 150000000 AND 200000000)                           AS band_150_200m
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE IsDeleted = FALSE
  AND COALESCE(Underwritten_AUM__c, Amount) BETWEEN 100000000 AND 200000000
  AND FA_CRD__c IS NOT NULL
;

-- 1B: Confirm reusable tables from prior analysis
SELECT 'aum_proxy_control_features'     AS table_name,
  COUNT(*) AS rows
FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
UNION ALL
SELECT 'aum_proxy_labeled_features'     AS table_name,
  COUNT(*) AS rows
FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
UNION ALL
SELECT 'aum_mid_tier_candidates'        AS table_name,
  COUNT(*) AS rows
FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
UNION ALL
SELECT 'v4_prospect_scores'             AS table_name,
  COUNT(*) AS rows
FROM `savvy-gtm-analytics.ml_features.v4_prospect_scores`
;


-- ============================================================
-- BLOCK 2: BUILD LABELED COHORT
-- One row per unique CRD with confirmed $100M–$200M AUM.
-- All closed-lost + open opportunities included (no wins exist).
-- Features mirror the V2 labeled feature table exactly so
-- comparisons are apples-to-apples.
-- Stores to: ml_features.aum_100_200m_labeled_features
-- ============================================================
CREATE OR REPLACE TABLE
  `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features` AS

WITH

sfdc_spine AS (
  SELECT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64)
                                                             AS crd,
    MAX(COALESCE(Underwritten_AUM__c, Amount))               AS max_aum,
    MAX(CASE WHEN LOWER(StageName) LIKE '%lost%' THEN 1 ELSE 0 END)
                                                             AS is_closed_lost,
    MAX(CASE WHEN SQL__c = 'Yes'
      AND LOWER(StageName) LIKE '%lost%' THEN 1 ELSE 0 END) AS is_sql_lost,
    MAX(CASE WHEN LOWER(StageName) NOT LIKE '%won%'
      AND LOWER(StageName) NOT LIKE '%lost%' THEN 1 ELSE 0 END)
                                                             AS is_open,
    MIN(DATE(CreatedDate))                                   AS first_opp_date,
    MAX(Closed_Lost_Reason__c)                               AS closed_lost_reason,
    MAX(Closed_Lost_Details__c)                              AS closed_lost_details,
    MAX(Opportunity_Owner_Name__c)                           AS opportunity_owner
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE IsDeleted = FALSE
    AND COALESCE(Underwritten_AUM__c, Amount) BETWEEN 100000000 AND 200000000
    AND FA_CRD__c IS NOT NULL
  GROUP BY 1
),

has_accolade AS (
  SELECT DISTINCT RIA_CONTACT_CRD_ID AS crd
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_accolades_historicals`
),

prior_firms AS (
  SELECT
    RIA_CONTACT_CRD_ID                                       AS crd,
    CASE
      WHEN PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
        OR TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = '' THEN 0
      ELSE ARRAY_LENGTH(
        SPLIT(TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS), ','))
    END                                                      AS num_prior_firms,
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                                 AS tenure_at_firm_years
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
)

SELECT
  s.crd,
  s.max_aum,
  CASE
    WHEN s.max_aum BETWEEN 100000000  AND 150000000  THEN '$100M-$150M'
    WHEN s.max_aum BETWEEN 150000001  AND 200000000  THEN '$150M-$200M'
  END                                                        AS aum_sub_band,
  s.is_closed_lost,
  s.is_sql_lost,
  s.is_open,
  s.first_opp_date,
  s.closed_lost_reason,
  s.closed_lost_details,
  s.opportunity_owner,

  -- Firm features
  SAFE_CAST(f.TOTAL_AUM AS INT64)                            AS firm_aum,
  SAFE_CAST(f.NUMBER_OF_EMPLOYEES AS INT64)                  AS firm_rep_count,
  SAFE_DIVIDE(
    SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
    NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0))              AS firm_disc_ratio,
  SAFE_DIVIDE(
    SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
    NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0))              AS firm_hnw_ratio,
  f.ENTITY_CLASSIFICATION                                    AS firm_type,
  f.CUSTODIAN_PRIMARY_BUSINESS_NAME                          AS custodian,
  (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')         AS is_independent_ria,
  (
    UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%SCHWAB%'
    OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%FIDELITY%'
    OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%PERSHING%'
    OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%TD AMERITRADE%'
  )                                                          AS has_portable_custodian,
  (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')               AS is_wirehouse,
  SAFE_CAST(f.TOTAL_AUM AS INT64) >= 1000000000              AS firm_aum_over_1b,

  -- Contact features
  SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0        AS industry_tenure_years,
  pf.tenure_at_firm_years,
  pf.num_prior_firms,
  COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0)
                                                             AS license_count,
  (c.REP_LICENSES LIKE '%Series 7%')                         AS has_series_7,
  (c.REP_LICENSES LIKE '%Series 65%'
    AND c.REP_LICENSES NOT LIKE '%Series 7%')                AS has_series_65_only,
  (a.crd IS NOT NULL)                                        AS has_any_accolade,
  (c.REP_LICENSES LIKE '%CFP%')                              AS has_cfp,
  SAFE_CAST(c.PRIMARY_FIRM_EMPLOYEE_COUNT AS INT64)          AS firm_employee_count,
  (SAFE_CAST(f.NUMBER_OF_EMPLOYEES AS INT64) <= 3)           AS is_solo_micro_firm

FROM sfdc_spine s
JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  ON c.RIA_CONTACT_CRD_ID = s.crd
JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
  ON f.CRD_ID = c.PRIMARY_FIRM
LEFT JOIN has_accolade a ON a.crd = s.crd
LEFT JOIN prior_firms pf ON pf.crd = s.crd
;


-- ============================================================
-- BLOCK 3: OPTION C — LOSS REASON ANALYSIS
-- Based on vw_lost_to_competition pattern.
-- Scoped to SQL closed-lost only (real conversations).
-- Reports on: loss reasons, time to move after loss,
-- where they moved to, and advisor profile at time of loss.
-- ============================================================

-- 3A: Loss reason distribution
SELECT
  COALESCE(closed_lost_reason, '(not recorded)')             AS loss_reason,
  COUNT(*)                                                    AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1)          AS pct,
  ROUND(AVG(max_aum) / 1000000, 1)                           AS avg_aum_m,
  ROUND(AVG(industry_tenure_years), 1)                       AS avg_tenure_yrs,
  ROUND(AVG(firm_aum) / 1000000000, 2)                       AS avg_firm_aum_b,
  COUNTIF(is_independent_ria)                                AS pct_indep_ria,
  COUNTIF(has_any_accolade)                                  AS count_accolade
FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
WHERE is_sql_lost = 1
GROUP BY 1
ORDER BY count DESC
;

-- 3B: Post-loss movement (mirrors vw_lost_to_competition logic)
-- Shows whether advisors moved firms after we lost them
-- and how long it took
WITH closed_lost_sqos AS (
  SELECT
    o.Id                                                      AS opportunity_id,
    SAFE_CAST(ROUND(SAFE_CAST(o.FA_CRD__c AS FLOAT64),0) AS INT64)
                                                              AS crd,
    o.Firm_Name__c                                            AS firm_at_recruitment,
    DATE(o.Stage_Entered_Closed__c)                           AS closed_lost_date,
    o.Closed_Lost_Reason__c                                   AS closed_lost_reason,
    o.Closed_Lost_Details__c                                  AS closed_lost_details,
    COALESCE(o.Underwritten_AUM__c, o.Amount)                 AS aum
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.SQL__c = 'Yes'
    AND o.StageName = 'Closed Lost'
    AND o.FA_CRD__c IS NOT NULL
    AND o.IsDeleted = FALSE
    AND COALESCE(o.Underwritten_AUM__c, o.Amount) BETWEEN 100000000 AND 200000000
),

current_state AS (
  SELECT
    RIA_CONTACT_CRD_ID                                        AS crd,
    PRIMARY_FIRM_NAME                                         AS current_firm,
    SAFE.PARSE_DATE('%Y-%m-%d', PRIMARY_FIRM_START_DATE)      AS current_firm_start_date
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
)

SELECT
  cls.crd,
  cls.firm_at_recruitment                                     AS original_firm,
  cls.closed_lost_reason,
  cls.closed_lost_details,
  ROUND(cls.aum / 1000000, 1)                                 AS aum_m,
  cls.closed_lost_date,
  cs.current_firm_start_date                                  AS new_firm_start_date,
  ROUND(DATE_DIFF(cs.current_firm_start_date,
    cls.closed_lost_date, DAY) / 30.44)                       AS months_to_move,
  cs.current_firm                                             AS moved_to_firm,
  CASE
    WHEN cs.current_firm_start_date > cls.closed_lost_date
      THEN 'Moved after loss'
    WHEN cs.current_firm_start_date <= cls.closed_lost_date
      THEN 'Already at current firm at time of loss'
    ELSE 'No current firm date'
  END                                                         AS movement_status
FROM closed_lost_sqos cls
LEFT JOIN current_state cs ON cs.crd = cls.crd
ORDER BY months_to_move ASC NULLS LAST
;

-- 3C: Movement summary — how many moved vs stayed
WITH closed_lost_sqos AS (
  SELECT
    SAFE_CAST(ROUND(SAFE_CAST(o.FA_CRD__c AS FLOAT64),0) AS INT64)
                                                              AS crd,
    DATE(o.Stage_Entered_Closed__c)                           AS closed_lost_date
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.SQL__c = 'Yes'
    AND o.StageName = 'Closed Lost'
    AND o.FA_CRD__c IS NOT NULL
    AND o.IsDeleted = FALSE
    AND COALESCE(o.Underwritten_AUM__c, o.Amount) BETWEEN 100000000 AND 200000000
),
movement AS (
  SELECT
    cls.crd,
    CASE
      WHEN c.PRIMARY_FIRM_START_DATE IS NULL THEN 'No date available'
      WHEN SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE)
        > cls.closed_lost_date THEN 'Moved after loss'
      ELSE 'Stayed / already moved'
    END                                                       AS status,
    ROUND(DATE_DIFF(
      SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
      cls.closed_lost_date, DAY) / 30.44)                     AS months_to_move
  FROM closed_lost_sqos cls
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    ON c.RIA_CONTACT_CRD_ID = cls.crd
)
SELECT
  status,
  COUNT(*)                                                    AS advisor_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1)          AS pct,
  ROUND(AVG(CASE WHEN months_to_move > 0
    THEN months_to_move END), 1)                              AS avg_months_to_move,
  MIN(CASE WHEN months_to_move > 0
    THEN months_to_move END)                                  AS min_months_to_move,
  MAX(CASE WHEN months_to_move > 0
    THEN months_to_move END)                                  AS max_months_to_move
FROM movement
GROUP BY 1
ORDER BY advisor_count DESC
;


-- ============================================================
-- BLOCK 4: OPTION A — SIGNAL DISCRIMINATION
-- $100M–$200M labeled cohort vs existing control group.
-- Reuses aum_proxy_control_features from V2 — no new
-- control sampling needed.
-- Computes Cohen's d for continuous features and lift/delta
-- for binary features. Same methodology as V2.
-- ============================================================

-- 4A: Continuous feature comparison
WITH labeled AS (
  SELECT
    '$100M-$200M'                                            AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    firm_aum / 1000000.0                                     AS firm_aum_m,
    firm_rep_count,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count_f,
    firm_disc_ratio,
    firm_hnw_ratio,
    license_count,
    num_prior_firms,
    SAFE_DIVIDE(firm_aum, NULLIF(firm_rep_count, 0)) / 1000000.0
                                                             AS firm_aum_per_rep_m
  FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
  WHERE is_closed_lost = 1 OR is_open = 1
),
control AS (
  SELECT
    'Control'                                                AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    firm_aum / 1000000.0                                     AS firm_aum_m,
    firm_rep_count,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count_f,
    firm_disc_ratio,
    firm_hnw_ratio,
    license_count,
    num_prior_firms,
    SAFE_DIVIDE(firm_aum, NULLIF(firm_rep_count, 0)) / 1000000.0
                                                             AS firm_aum_per_rep_m
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
),
combined AS (
  SELECT * FROM labeled
  UNION ALL
  SELECT * FROM control
)
SELECT
  group_label,
  COUNT(*)                                                   AS n,

  -- Industry tenure
  ROUND(AVG(industry_tenure_years), 2)                       AS avg_industry_tenure,
  ROUND(STDDEV(industry_tenure_years), 2)                    AS std_industry_tenure,

  -- Tenure at current firm
  ROUND(AVG(tenure_at_firm_years), 2)                        AS avg_firm_tenure,
  ROUND(STDDEV(tenure_at_firm_years), 2)                     AS std_firm_tenure,

  -- Firm AUM
  ROUND(AVG(firm_aum_m), 1)                                  AS avg_firm_aum_m,
  ROUND(STDDEV(firm_aum_m), 1)                               AS std_firm_aum_m,
  ROUND(APPROX_QUANTILES(firm_aum_m, 2)[OFFSET(1)], 1)       AS median_firm_aum_m,

  -- Firm rep count
  ROUND(AVG(firm_rep_count_f), 1)                            AS avg_firm_rep_count,
  ROUND(STDDEV(firm_rep_count_f), 1)                         AS std_firm_rep_count,
  ROUND(APPROX_QUANTILES(firm_rep_count_f, 2)[OFFSET(1)], 0) AS median_firm_rep_count,

  -- Disc ratio
  ROUND(AVG(firm_disc_ratio), 3)                             AS avg_disc_ratio,
  ROUND(STDDEV(firm_disc_ratio), 3)                          AS std_disc_ratio,

  -- HNW ratio
  ROUND(AVG(firm_hnw_ratio), 3)                              AS avg_hnw_ratio,
  ROUND(STDDEV(firm_hnw_ratio), 3)                           AS std_hnw_ratio,

  -- License count
  ROUND(AVG(license_count), 2)                               AS avg_license_count,
  ROUND(STDDEV(license_count), 2)                            AS std_license_count,

  -- Prior firms
  ROUND(AVG(num_prior_firms), 2)                             AS avg_prior_firms,
  ROUND(STDDEV(num_prior_firms), 2)                          AS std_prior_firms,

  -- AUM per rep divisor
  ROUND(AVG(firm_aum_per_rep_m), 1)                          AS avg_aum_per_rep_m,
  ROUND(APPROX_QUANTILES(firm_aum_per_rep_m, 2)[OFFSET(1)], 1)
                                                             AS median_aum_per_rep_m

FROM combined
GROUP BY group_label
ORDER BY group_label
;

-- 4B: Binary feature comparison
WITH labeled AS (
  SELECT
    '$100M-$200M'                                            AS group_label,
    is_independent_ria,
    has_portable_custodian,
    is_wirehouse,
    has_series_7,
    has_series_65_only,
    has_any_accolade,
    is_solo_micro_firm,
    (num_prior_firms >= 3)                                   AS has_3plus_prior_firms,
    (tenure_at_firm_years < 10)                              AS tenure_under_10yr,
    (tenure_at_firm_years < 5)                               AS tenure_under_5yr,
    (industry_tenure_years BETWEEN 7 AND 25)                 AS mid_career
  FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
  WHERE is_closed_lost = 1 OR is_open = 1
),
control AS (
  SELECT
    'Control'                                                AS group_label,
    is_independent_ria,
    has_portable_custodian,
    is_wirehouse,
    has_series_7,
    has_series_65_only,
    has_any_accolade,
    is_solo_micro_firm,
    (num_prior_firms >= 3)                                   AS has_3plus_prior_firms,
    (tenure_at_firm_years < 10)                              AS tenure_under_10yr,
    (tenure_at_firm_years < 5)                              AS tenure_under_5yr,
    (industry_tenure_years BETWEEN 7 AND 25)                 AS mid_career
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
),
combined AS (SELECT * FROM labeled UNION ALL SELECT * FROM control)
SELECT
  group_label,
  COUNT(*)                                                   AS n,
  ROUND(COUNTIF(is_independent_ria) * 100.0 / COUNT(*), 1)  AS pct_indep_ria,
  ROUND(COUNTIF(has_portable_custodian) * 100.0 / COUNT(*), 1)
                                                             AS pct_portable_custodian,
  ROUND(COUNTIF(is_wirehouse) * 100.0 / COUNT(*), 1)        AS pct_wirehouse,
  ROUND(COUNTIF(has_series_7) * 100.0 / COUNT(*), 1)        AS pct_series_7,
  ROUND(COUNTIF(has_series_65_only) * 100.0 / COUNT(*), 1)  AS pct_series_65_only,
  ROUND(COUNTIF(has_any_accolade) * 100.0 / COUNT(*), 1)    AS pct_accolade,
  ROUND(COUNTIF(is_solo_micro_firm) * 100.0 / COUNT(*), 1)  AS pct_solo_micro,
  ROUND(COUNTIF(has_3plus_prior_firms) * 100.0 / COUNT(*), 1)
                                                             AS pct_3plus_prior_firms,
  ROUND(COUNTIF(tenure_under_10yr) * 100.0 / COUNT(*), 1)   AS pct_tenure_under_10yr,
  ROUND(COUNTIF(tenure_under_5yr) * 100.0 / COUNT(*), 1)    AS pct_tenure_under_5yr,
  ROUND(COUNTIF(mid_career) * 100.0 / COUNT(*), 1)          AS pct_mid_career
FROM combined
GROUP BY group_label
ORDER BY group_label
;


-- ============================================================
-- BLOCK 5: THREE-WAY COMPARISON
-- $40M–$100M (V2 labeled) vs $100M–$200M (new labeled) vs Control
-- This is the critical question: are these two bands distinguishable?
-- If they look the same, a separate tier is not justified.
-- ============================================================

WITH band_40_100 AS (
  SELECT
    '$40M-$100M'                                             AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    firm_disc_ratio,
    firm_hnw_ratio,
    license_count,
    num_prior_firms,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count,
    is_independent_ria,
    has_portable_custodian,
    has_series_7,
    has_any_accolade,
    firm_aum / 1000000.0                                     AS firm_aum_m
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
),
band_100_200 AS (
  SELECT
    '$100M-$200M'                                            AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    firm_disc_ratio,
    firm_hnw_ratio,
    license_count,
    num_prior_firms,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count,
    is_independent_ria,
    has_portable_custodian,
    has_series_7,
    has_any_accolade,
    firm_aum / 1000000.0                                     AS firm_aum_m
  FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
  WHERE is_closed_lost = 1 OR is_open = 1
),
control AS (
  SELECT
    'Control'                                                AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    firm_disc_ratio,
    firm_hnw_ratio,
    license_count,
    num_prior_firms,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count,
    is_independent_ria,
    has_portable_custodian,
    has_series_7,
    has_any_accolade,
    firm_aum / 1000000.0                                     AS firm_aum_m
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
),
combined AS (
  SELECT * FROM band_40_100
  UNION ALL SELECT * FROM band_100_200
  UNION ALL SELECT * FROM control
)
SELECT
  group_label,
  COUNT(*)                                                   AS n,
  ROUND(AVG(industry_tenure_years), 1)                       AS avg_industry_tenure,
  ROUND(AVG(tenure_at_firm_years), 1)                        AS avg_firm_tenure,
  ROUND(AVG(firm_disc_ratio), 3)                             AS avg_disc_ratio,
  ROUND(AVG(firm_hnw_ratio), 3)                              AS avg_hnw_ratio,
  ROUND(AVG(license_count), 2)                               AS avg_license_count,
  ROUND(AVG(num_prior_firms), 2)                             AS avg_prior_firms,
  ROUND(AVG(firm_rep_count), 0)                              AS avg_firm_rep_count,
  ROUND(APPROX_QUANTILES(firm_rep_count, 2)[OFFSET(1)], 0)   AS median_firm_rep_count,
  ROUND(COUNTIF(is_independent_ria) * 100.0 / COUNT(*), 1)  AS pct_indep_ria,
  ROUND(COUNTIF(has_portable_custodian) * 100.0 / COUNT(*), 1)
                                                             AS pct_portable_custodian,
  ROUND(COUNTIF(has_series_7) * 100.0 / COUNT(*), 1)        AS pct_series_7,
  ROUND(COUNTIF(has_any_accolade) * 100.0 / COUNT(*), 1)    AS pct_accolade,
  ROUND(AVG(firm_aum_m), 0)                                  AS avg_firm_aum_m,
  ROUND(APPROX_QUANTILES(firm_aum_m, 2)[OFFSET(1)], 0)       AS median_firm_aum_m
FROM combined
GROUP BY group_label
ORDER BY group_label
;


-- ============================================================
-- BLOCK 6: POPULATION SIZING + OVERLAP CHECK
-- ⚠️  READ BEFORE RUNNING:
-- Only run this block if Block 5 three-way comparison shows
-- the $100M–$200M band is meaningfully distinguishable from
-- both Control AND $40M–$100M.
-- Agent must make this determination from Block 5 results
-- before proceeding. See agent guide decision gates.
--
-- Criteria placeholders marked [CRITERION] must be replaced
-- by the agent based on Block 4/5 findings before execution.
-- ============================================================

-- 6A: Universe size under derived criteria
-- PLACEHOLDER — agent fills in [CRITERION_1..N] from Block 4/5
SELECT
  COUNT(DISTINCT c.RIA_CONTACT_CRD_ID)                      AS total_universe,
  COUNTIF(
    SAFE_CAST(f.TOTAL_AUM AS INT64) >= 1000000000)           AS at_1b_plus_firms,
  COUNTIF(
    SAFE_CAST(f.TOTAL_AUM AS INT64) < 1000000000)            AS under_1b_firms,
  COUNTIF(
    SAFE_CAST(f.TOTAL_AUM AS INT64) BETWEEN 1000000000
      AND 5000000000)                                        AS band_1b_5b,
  COUNTIF(
    SAFE_CAST(f.TOTAL_AUM AS INT64) > 5000000000)            AS over_5b
FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
  ON f.CRD_ID = c.PRIMARY_FIRM
WHERE c.PRODUCING_ADVISOR = 'true'
  AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
  AND c.RIA_CONTACT_CRD_ID NOT IN (
    SELECT SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64)
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE FA_CRD__c IS NOT NULL
    UNION DISTINCT
    SELECT SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64)
    FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
    WHERE FA_CRD__c IS NOT NULL
  )
  -- [CRITERION_1] — replace with derived criteria from Block 4/5
  -- [CRITERION_2]
  -- [CRITERION_N]
;

-- 6B: Overlap with existing tiers
-- Shows how many universe candidates are already in TIER_AUM_MID
-- or current lead list under any tier
WITH universe AS (
  SELECT DISTINCT c.RIA_CONTACT_CRD_ID AS crd
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
    ON f.CRD_ID = c.PRIMARY_FIRM
  WHERE c.PRODUCING_ADVISOR = 'true'
    AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
    -- [CRITERION_1..N] same as 6A
),
aum_mid AS (
  SELECT advisor_crd AS crd, 'TIER_AUM_MID' AS tier
  FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
),
lead_list AS (
  SELECT
    SAFE_CAST(advisor_crd AS INT64) AS crd,
    score_tier AS tier
  FROM `savvy-gtm-analytics.ml_features.march_2026_lead_list`
)
SELECT
  COALESCE(ll.tier, aum.tier, '(not in any tier)')           AS existing_tier,
  COUNT(DISTINCT u.crd)                                      AS count,
  ROUND(COUNT(DISTINCT u.crd) * 100.0
    / SUM(COUNT(DISTINCT u.crd)) OVER(), 1)                  AS pct
FROM universe u
LEFT JOIN aum_mid aum ON aum.crd = u.crd
LEFT JOIN lead_list ll ON ll.crd = u.crd
GROUP BY 1
ORDER BY count DESC
;


-- ============================================================
-- BLOCK 7: SHADOW TABLE BUILD
-- ⚠️  CONDITIONAL — only run if:
--   (a) Block 5 confirms $100M–$200M is distinguishable
--   (b) Block 6A universe >= 500 advisors net-new
--   (c) Criteria have been determined and filled in
--
-- Schema matches aum_mid_tier_candidates exactly for
-- consistency across both tiers.
-- ============================================================
CREATE OR REPLACE TABLE
  `savvy-gtm-analytics.ml_features.aum_high_tier_candidates` AS

WITH

excluded_firm_crds_list AS (
  SELECT firm_crd FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

sfdc_crds AS (
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64) AS crd,
    Id AS salesforce_lead_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE FA_CRD__c IS NOT NULL AND IsDeleted = FALSE
),

has_accolade AS (
  SELECT DISTINCT RIA_CONTACT_CRD_ID AS crd
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_accolades_historicals`
),

prior_firms AS (
  SELECT
    RIA_CONTACT_CRD_ID                                       AS crd,
    CASE
      WHEN PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
        OR TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = '' THEN 0
      ELSE ARRAY_LENGTH(
        SPLIT(TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS), ','))
    END                                                      AS num_prior_firms,
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                                 AS tenure_at_firm_years
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
),

v4_scores AS (
  SELECT crd, v4_score, v4_percentile
  FROM `savvy-gtm-analytics.ml_features.v4_prospect_scores`
),

base_candidates AS (
  SELECT
    c.RIA_CONTACT_CRD_ID                                     AS crd,
    c.CONTACT_FIRST_NAME                                     AS first_name,
    c.CONTACT_LAST_NAME                                      AS last_name,
    c.TITLE_NAME                                             AS job_title,
    c.EMAIL                                                  AS email,
    c.OFFICE_PHONE_NUMBER                                    AS phone,
    c.LINKEDIN_PROFILE_URL                                   AS linkedin_url,
    (c.LINKEDIN_PROFILE_URL IS NOT NULL)                     AS has_linkedin,
    f.NAME                                                   AS firm_name,
    c.PRIMARY_FIRM                                           AS firm_crd,
    SAFE_CAST(f.TOTAL_AUM AS INT64)                          AS firm_aum,
    SAFE_CAST(f.NUMBER_OF_EMPLOYEES AS INT64)                AS firm_rep_count,
    SAFE_DIVIDE(
      SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0))            AS firm_disc_ratio,
    SAFE_DIVIDE(
      SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0))            AS firm_hnw_ratio,
    COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0)
                                                             AS license_count,
    (c.REP_LICENSES LIKE '%Series 7%')                       AS has_series_7,
    (c.REP_LICENSES LIKE '%Series 65%'
      AND c.REP_LICENSES NOT LIKE '%Series 7%')              AS has_series_65_only,
    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0      AS industry_tenure_years,
    (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')       AS is_independent_ria,
    (
      UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%SCHWAB%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%FIDELITY%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%PERSHING%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%TD AMERITRADE%'
    )                                                        AS has_portable_custodian,
    sc.salesforce_lead_id,
    'NEW_PROSPECT'                                           AS prospect_type
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
    ON f.CRD_ID = c.PRIMARY_FIRM
  LEFT JOIN sfdc_crds sc ON sc.crd = c.RIA_CONTACT_CRD_ID
  WHERE c.PRODUCING_ADVISOR = 'true'
    AND c.PRIMARY_FIRM IS NOT NULL
    AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
    AND c.PRIMARY_FIRM NOT IN (SELECT firm_crd FROM excluded_firm_crds_list)
    AND SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) <= 480
    AND sc.crd IS NULL
    AND c.RIA_CONTACT_CRD_ID NOT IN (SELECT crd FROM has_accolade)
    -- ⚠️  CRITERIA PLACEHOLDER — agent fills these in from Block 4/5
    -- [CRITERION_1]
    -- [CRITERION_2]
    -- [CRITERION_N]
)

SELECT
  bc.crd                                                     AS advisor_crd,
  bc.salesforce_lead_id,
  bc.first_name,
  bc.last_name,
  bc.job_title,
  bc.email,
  bc.phone,
  bc.linkedin_url,
  bc.has_linkedin,
  bc.firm_name,
  bc.firm_crd,
  bc.firm_rep_count,
  bc.firm_aum,
  ROUND(pf.tenure_at_firm_years, 1)                          AS tenure_at_firm_years,
  ROUND(pf.tenure_at_firm_years * 12, 0)                     AS tenure_months,
  bc.industry_tenure_years,
  pf.num_prior_firms,
  bc.firm_disc_ratio,
  bc.firm_hnw_ratio,
  bc.has_series_65_only,
  bc.has_series_7,
  bc.license_count,
  bc.is_independent_ria,
  bc.has_portable_custodian,
  'TIER_AUM_HIGH'                                            AS score_tier,
  'shadow_validation'                                        AS run_mode,
  COALESCE(v4.v4_score, 0.5)                                 AS v4_score,
  COALESCE(v4.v4_percentile, 50)                             AS v4_percentile,
  bc.prospect_type,
  ROW_NUMBER() OVER (
    ORDER BY
      COALESCE(v4.v4_percentile, 50) DESC,
      bc.firm_disc_ratio DESC,
      bc.firm_hnw_ratio DESC,
      bc.crd
  )                                                          AS priority_rank
FROM base_candidates bc
LEFT JOIN prior_firms pf ON pf.crd = bc.crd
LEFT JOIN v4_scores   v4 ON v4.crd = bc.crd
;

-- 7B: Shadow table validation
SELECT
  COUNT(*)                                                   AS total_candidates,
  COUNT(DISTINCT advisor_crd)                                AS unique_crds,
  COUNT(DISTINCT firm_crd)                                   AS unique_firms,
  COUNTIF(tenure_at_firm_years IS NOT NULL)                  AS has_tenure,
  ROUND(AVG(v4_percentile), 1)                               AS avg_v4_percentile,
  ROUND(AVG(firm_disc_ratio), 3)                             AS avg_disc_ratio,
  ROUND(AVG(firm_hnw_ratio), 3)                              AS avg_hnw_ratio,
  ROUND(AVG(tenure_at_firm_years), 1)                        AS avg_tenure,
  MAX(firm_count)                                            AS max_per_firm
FROM `savvy-gtm-analytics.ml_features.aum_high_tier_candidates`
CROSS JOIN (
  SELECT firm_crd, COUNT(*) AS firm_count
  FROM `savvy-gtm-analytics.ml_features.aum_high_tier_candidates`
  GROUP BY firm_crd
)
;
