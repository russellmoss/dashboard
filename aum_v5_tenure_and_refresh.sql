-- ============================================================
-- V5: TENURE DISCRIMINATION + SHADOW TABLE REFRESH
-- Three sequential blocks:
--
-- BLOCK 1: Tenure Signal Discrimination
--   Tests PRIMARY_FIRM_START_DATE (current firm tenure) and
--   PREVIOUS_REGISTRATION_COMPANY_CRD_IDS (prior firm count)
--   against the labeled $40M–$100M cohort vs control.
--   Determines if either signal should be added to criteria.
--
-- BLOCK 2: Prior Firm Count Cross-Validation
--   Compares prior firm counts derived from the new field
--   against V4's history-table-based counts.
--   Confirms or revises the V4 Block 1B discrimination result.
--
-- BLOCK 3: Conditional Shadow Table Refresh
--   Only runs if Block 1 shows current firm tenure d > 0.30.
--   Regenerates ml_features.aum_mid_tier_candidates with
--   the new tenure criterion added and any updated prior
--   firm count logic.
--   If d <= 0.30, the existing shadow table stands unchanged.
-- ============================================================


-- ============================================================
-- BLOCK 1A: CURRENT FIRM TENURE DISCRIMINATION
-- PRIMARY_FIRM_START_DATE is on ria_contacts_current —
-- no join to employment history needed.
-- Compute tenure_at_current_firm_years for both groups
-- and run Cohen's d comparison.
-- ============================================================
WITH

labeled_tenure AS (
  SELECT
    lf.crd,
    '$40M-$100M'                                         AS group_label,
    SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE) AS firm_start_date,
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                             AS tenure_at_firm_years,
    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0  AS industry_tenure_years,
    -- Time at current firm as fraction of total career
    SAFE_DIVIDE(
      DATE_DIFF(
        CURRENT_DATE(),
        SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
        MONTH
      ),
      NULLIF(SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64), 0)
    )                                                    AS pct_career_at_current_firm
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` lf
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    ON c.RIA_CONTACT_CRD_ID = lf.crd
  WHERE c.PRIMARY_FIRM_START_DATE IS NOT NULL
),

control_tenure AS (
  SELECT
    cf.crd,
    'Control'                                            AS group_label,
    SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE) AS firm_start_date,
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                             AS tenure_at_firm_years,
    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0  AS industry_tenure_years,
    SAFE_DIVIDE(
      DATE_DIFF(
        CURRENT_DATE(),
        SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
        MONTH
      ),
      NULLIF(SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64), 0)
    )                                                    AS pct_career_at_current_firm
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features` cf
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    ON c.RIA_CONTACT_CRD_ID = cf.crd
  WHERE c.PRIMARY_FIRM_START_DATE IS NOT NULL
),

combined AS (
  SELECT * FROM labeled_tenure
  UNION ALL
  SELECT * FROM control_tenure
)

SELECT
  group_label,
  COUNT(*)                                              AS n,
  COUNT(tenure_at_firm_years)                           AS has_tenure,
  ROUND(COUNT(tenure_at_firm_years) * 100.0 / COUNT(*), 1)
                                                        AS pct_has_tenure,

  -- Tenure at current firm
  ROUND(AVG(tenure_at_firm_years), 2)                   AS avg_tenure_at_firm,
  ROUND(STDDEV(tenure_at_firm_years), 2)                AS stddev_tenure_at_firm,
  ROUND(APPROX_QUANTILES(tenure_at_firm_years, 4)[OFFSET(1)], 1)
                                                        AS p25_tenure,
  ROUND(APPROX_QUANTILES(tenure_at_firm_years, 2)[OFFSET(1)], 1)
                                                        AS median_tenure,
  ROUND(APPROX_QUANTILES(tenure_at_firm_years, 4)[OFFSET(3)], 1)
                                                        AS p75_tenure,

  -- Tenure bucket distribution
  ROUND(COUNTIF(tenure_at_firm_years < 1) * 100.0 / COUNT(tenure_at_firm_years), 1)
                                                        AS pct_under_1yr,
  ROUND(COUNTIF(tenure_at_firm_years BETWEEN 1 AND 4) * 100.0 / COUNT(tenure_at_firm_years), 1)
                                                        AS pct_1_4yr,         -- PRIME_MOVER window
  ROUND(COUNTIF(tenure_at_firm_years BETWEEN 4 AND 10) * 100.0 / COUNT(tenure_at_firm_years), 1)
                                                        AS pct_4_10yr,        -- Settled window
  ROUND(COUNTIF(tenure_at_firm_years > 10) * 100.0 / COUNT(tenure_at_firm_years), 1)
                                                        AS pct_over_10yr,     -- Long-tenured

  -- Pct of career at current firm
  ROUND(AVG(pct_career_at_current_firm), 3)             AS avg_pct_career_at_firm,
  ROUND(STDDEV(pct_career_at_current_firm), 3)          AS stddev_pct_career_at_firm

FROM combined
GROUP BY group_label
ORDER BY group_label
;


-- ============================================================
-- BLOCK 1B: PREVIOUS_REGISTRATION_COMPANY_CRD_IDS VALIDATION
-- This field is a pre-aggregated STRING of prior firm CRDs.
-- Count distinct values to get prior firm count without
-- needing the history table join.
-- Compare distribution to V4 Block 1B results (avg 2.76 labeled,
-- 2.29 control) to see if this is a cleaner measure.
-- ============================================================
WITH

labeled_prior AS (
  SELECT
    lf.crd,
    '$40M-$100M'                                         AS group_label,
    c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS,
    -- Count comma-separated entries in the CRD string
    -- Empty string or NULL = 0 prior firms
    CASE
      WHEN c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
        OR TRIM(c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = ''  THEN 0
      ELSE
        ARRAY_LENGTH(
          SPLIT(TRIM(c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS), ',')
        )
    END                                                  AS prior_firm_count_v5
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` lf
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    ON c.RIA_CONTACT_CRD_ID = lf.crd
),

control_prior AS (
  SELECT
    cf.crd,
    'Control'                                            AS group_label,
    c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS,
    CASE
      WHEN c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
        OR TRIM(c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = ''  THEN 0
      ELSE
        ARRAY_LENGTH(
          SPLIT(TRIM(c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS), ',')
        )
    END                                                  AS prior_firm_count_v5
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features` cf
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    ON c.RIA_CONTACT_CRD_ID = cf.crd
),

combined AS (
  SELECT * FROM labeled_prior
  UNION ALL
  SELECT * FROM control_prior
)

SELECT
  group_label,
  COUNT(*)                                               AS n,
  COUNTIF(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
    OR TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = '') AS null_or_empty,
  ROUND(AVG(prior_firm_count_v5), 2)                     AS avg_prior_firms_v5,
  ROUND(STDDEV(prior_firm_count_v5), 2)                  AS stddev_prior_firms_v5,
  ROUND(APPROX_QUANTILES(prior_firm_count_v5, 2)[OFFSET(1)], 1)
                                                         AS median_prior_firms_v5,
  COUNTIF(prior_firm_count_v5 = 0)                       AS count_zero_prior,
  COUNTIF(prior_firm_count_v5 >= 1)                      AS count_1plus,
  COUNTIF(prior_firm_count_v5 >= 3)                      AS count_3plus,
  ROUND(COUNTIF(prior_firm_count_v5 >= 3) * 100.0 / COUNT(*), 1)
                                                         AS pct_3plus
FROM combined
GROUP BY group_label
ORDER BY group_label
;


-- ============================================================
-- BLOCK 1C: LATEST_REGISTERED_EMPLOYMENT GAP ANALYSIS
-- How long ago did they leave their last prior firm?
-- Short gap (< 2yr) + current firm tenure 1–5yr = recent mover
--   → already captured by PRIME_MOVER, exclude from AUM_MID
-- Long gap (> 5yr) = truly settled → AUM_MID target profile
-- ============================================================
WITH

labeled_gap AS (
  SELECT
    lf.crd,
    '$40M-$100M'                                         AS group_label,
    SAFE.PARSE_DATE('%Y-%m-%d', c.LATEST_REGISTERED_EMPLOYMENT_END_DATE)
                                                         AS last_job_end_date,
    SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE)
                                                         AS current_firm_start,
    DATE_DIFF(
      SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
      SAFE.PARSE_DATE('%Y-%m-%d', c.LATEST_REGISTERED_EMPLOYMENT_END_DATE),
      MONTH
    ) / 12.0                                             AS gap_between_jobs_years,
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                             AS tenure_at_firm_years
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` lf
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    ON c.RIA_CONTACT_CRD_ID = lf.crd
  WHERE c.LATEST_REGISTERED_EMPLOYMENT_END_DATE IS NOT NULL
    AND c.PRIMARY_FIRM_START_DATE IS NOT NULL
),

control_gap AS (
  SELECT
    cf.crd,
    'Control'                                            AS group_label,
    SAFE.PARSE_DATE('%Y-%m-%d', c.LATEST_REGISTERED_EMPLOYMENT_END_DATE)
                                                         AS last_job_end_date,
    SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE)
                                                         AS current_firm_start,
    DATE_DIFF(
      SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
      SAFE.PARSE_DATE('%Y-%m-%d', c.LATEST_REGISTERED_EMPLOYMENT_END_DATE),
      MONTH
    ) / 12.0                                             AS gap_between_jobs_years,
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                             AS tenure_at_firm_years
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features` cf
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
    ON c.RIA_CONTACT_CRD_ID = cf.crd
  WHERE c.LATEST_REGISTERED_EMPLOYMENT_END_DATE IS NOT NULL
    AND c.PRIMARY_FIRM_START_DATE IS NOT NULL
),

combined AS (
  SELECT * FROM labeled_gap
  UNION ALL
  SELECT * FROM control_gap
)

SELECT
  group_label,
  COUNT(*)                                               AS n,
  ROUND(AVG(tenure_at_firm_years), 1)                    AS avg_current_tenure,
  ROUND(AVG(gap_between_jobs_years), 2)                  AS avg_gap_years,
  ROUND(STDDEV(gap_between_jobs_years), 2)               AS stddev_gap,
  ROUND(APPROX_QUANTILES(gap_between_jobs_years, 2)[OFFSET(1)], 1)
                                                         AS median_gap_years,

  -- PRIME_MOVER risk: short tenure at current firm suggests recent mover
  ROUND(COUNTIF(tenure_at_firm_years BETWEEN 1 AND 4) * 100.0 / COUNT(*), 1)
                                                         AS pct_prime_mover_window,

  -- Settled signal: long tenure = established, not recently mobile
  ROUND(COUNTIF(tenure_at_firm_years > 5) * 100.0 / COUNT(*), 1)
                                                         AS pct_settled_5plus,
  ROUND(COUNTIF(tenure_at_firm_years > 10) * 100.0 / COUNT(*), 1)
                                                         AS pct_settled_10plus

FROM combined
GROUP BY group_label
ORDER BY group_label
;


-- ============================================================
-- BLOCK 2: CROSS-VALIDATION — V5 vs V4 PRIOR FIRM COUNTS
-- Side-by-side: prior firms from PREVIOUS_REGISTRATION_COMPANY_CRD_IDS
-- vs. prior firms from the V4 history table join.
-- Look for systematic differences that would change Block 1B's
-- Cohen's d = 0.19 conclusion.
-- ============================================================
WITH

v5_counts AS (
  SELECT
    c.RIA_CONTACT_CRD_ID                                 AS crd,
    CASE
      WHEN c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
        OR TRIM(c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = ''  THEN 0
      ELSE
        ARRAY_LENGTH(SPLIT(TRIM(c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS), ','))
    END                                                  AS prior_firms_v5
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  WHERE c.RIA_CONTACT_CRD_ID IN (
    SELECT crd FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
    UNION DISTINCT
    SELECT crd FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
  )
),

v4_counts AS (
  SELECT
    RIA_CONTACT_CRD_ID                                   AS crd,
    COUNT(DISTINCT PREVIOUS_REGISTRATION_COMPANY_CRD_ID) AS prior_firms_v4
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history`
  WHERE RIA_CONTACT_CRD_ID IN (
    SELECT crd FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
    UNION DISTINCT
    SELECT crd FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
  )
  GROUP BY RIA_CONTACT_CRD_ID
)

SELECT
  CASE
    WHEN lf.crd IS NOT NULL THEN '$40M-$100M'
    ELSE 'Control'
  END                                                    AS group_label,
  COUNT(*)                                               AS n,
  ROUND(AVG(v5.prior_firms_v5), 2)                       AS avg_v5,
  ROUND(AVG(COALESCE(v4.prior_firms_v4, 0)), 2)          AS avg_v4,
  ROUND(AVG(v5.prior_firms_v5 - COALESCE(v4.prior_firms_v4, 0)), 2)
                                                         AS avg_delta_v5_minus_v4,
  -- How often do they agree within 1 firm
  ROUND(COUNTIF(ABS(v5.prior_firms_v5 - COALESCE(v4.prior_firms_v4, 0)) <= 1)
    * 100.0 / COUNT(*), 1)                               AS pct_agree_within_1,
  -- V5 consistently higher, lower, or same?
  COUNTIF(v5.prior_firms_v5 > COALESCE(v4.prior_firms_v4, 0))
                                                         AS v5_higher_count,
  COUNTIF(v5.prior_firms_v5 = COALESCE(v4.prior_firms_v4, 0))
                                                         AS same_count,
  COUNTIF(v5.prior_firms_v5 < COALESCE(v4.prior_firms_v4, 0))
                                                         AS v5_lower_count
FROM v5_counts v5
LEFT JOIN `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` lf
  ON lf.crd = v5.crd
LEFT JOIN v4_counts v4 ON v4.crd = v5.crd
GROUP BY 1
ORDER BY 1
;


-- ============================================================
-- BLOCK 3: CONDITIONAL SHADOW TABLE REFRESH
-- ============================================================
-- READ BEFORE RUNNING:
-- Only execute this block if Block 1A Cohen's d > 0.30.
-- Agent should compute Cohen's d from Block 1A results:
--   d = ABS(labeled_avg - control_avg) / ((labeled_stddev + control_stddev) / 2)
--
-- If d <= 0.30: SKIP this block. Existing shadow table stands.
--   Update methodology doc only.
--
-- If d > 0.30: ADD the tenure criterion that best separates
--   the groups based on Block 1A bucket distributions, then
--   run this block.
--
-- TENURE CRITERION DECISION LOGIC:
--   If labeled pct_1_4yr << control pct_1_4yr:
--     → ADD: tenure_at_firm_years > 4 (exclude recent movers)
--     → Rationale: $40-$100M advisors are MORE settled
--   If labeled pct_over_10yr >> control pct_over_10yr:
--     → ADD: tenure_at_firm_years > 5 (settled window)
--   If no clear directionality:
--     → Do not add as hard filter; consider soft scoring weight
--
-- PLACEHOLDER: Replace [TENURE_CRITERION] below with the
--   actual SQL expression determined from Block 1A results.
--   Example: "tenure_at_firm_years > 4"
-- ============================================================
CREATE OR REPLACE TABLE `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates` AS

WITH

excluded_firm_crds_list AS (
  SELECT CAST(firm_crd AS STRING) AS firm_crd FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

sfdc_crds AS (
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64) AS crd,
    Id                                                  AS salesforce_lead_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE FA_CRD__c IS NOT NULL
    AND IsDeleted = FALSE
),

-- V5: Prior firm count from pre-aggregated field on ria_contacts_current
-- No history table join needed. No -1 adjustment needed.
prior_firms_v5 AS (
  SELECT
    RIA_CONTACT_CRD_ID                                  AS crd,
    CASE
      WHEN PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
        OR TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = ''  THEN 0
      ELSE
        ARRAY_LENGTH(SPLIT(TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS), ','))
    END                                                 AS num_prior_firms,
    -- Current firm tenure from PRIMARY_FIRM_START_DATE
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                            AS tenure_at_firm_years
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
),

has_accolade AS (
  SELECT DISTINCT RIA_CONTACT_CRD_ID AS crd
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_accolades_historicals`
),

v4_scores AS (
  SELECT crd, v4_score, v4_percentile
  FROM `savvy-gtm-analytics.ml_features.v4_prospect_scores`
),

base_candidates AS (
  SELECT
    c.RIA_CONTACT_CRD_ID                                AS crd,
    c.CONTACT_FIRST_NAME                                AS first_name,
    c.CONTACT_LAST_NAME                                 AS last_name,
    c.TITLE_NAME                                        AS job_title,
    c.EMAIL                                             AS email,
    c.OFFICE_PHONE_NUMBER                               AS phone,
    c.LINKEDIN_PROFILE_URL                              AS linkedin_url,
    (c.LINKEDIN_PROFILE_URL IS NOT NULL)                AS has_linkedin,
    c.PRODUCING_ADVISOR,
    f.NAME                                              AS firm_name,
    c.PRIMARY_FIRM                                      AS firm_crd,
    SAFE_CAST(f.TOTAL_AUM AS INT64)                     AS firm_aum,

    (SELECT COUNT(DISTINCT c2.RIA_CONTACT_CRD_ID)
     FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c2
     WHERE c2.PRIMARY_FIRM = c.PRIMARY_FIRM
       AND c2.PRODUCING_ADVISOR = 'true')               AS firm_rep_count,

    SAFE_DIVIDE(
      SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    )                                                   AS firm_disc_ratio,
    SAFE_DIVIDE(
      SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    )                                                   AS firm_hnw_ratio,
    f.CUSTODIAN_PRIMARY_BUSINESS_NAME                   AS custodian,
    COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0)
                                                        AS license_count,
    (c.REP_LICENSES LIKE '%Series 65%'
     AND c.REP_LICENSES NOT LIKE '%Series 7%')          AS has_series_65_only,
    (c.REP_LICENSES LIKE '%Series 7%')                  AS has_series_7,
    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64)        AS industry_tenure_months,
    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0 AS industry_tenure_years,
    (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')  AS is_independent_ria,
    (
      UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%SCHWAB%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%FIDELITY%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%PERSHING%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%TD AMERITRADE%'
    )                                                   AS has_portable_custodian,
    sc.salesforce_lead_id,
    CASE WHEN sc.crd IS NULL THEN 'NEW_PROSPECT' ELSE 'IN_PIPELINE' END
                                                        AS prospect_type

  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
    ON f.CRD_ID = SAFE_CAST(c.PRIMARY_FIRM AS INT64)
  LEFT JOIN sfdc_crds sc ON sc.crd = c.RIA_CONTACT_CRD_ID
  WHERE c.PRODUCING_ADVISOR = 'true'
    AND c.PRIMARY_FIRM IS NOT NULL
    AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
    AND c.PRIMARY_FIRM NOT IN (SELECT firm_crd FROM excluded_firm_crds_list)
    AND SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) <= 480
    AND sc.crd IS NULL  -- not in pipeline
    -- ── Floor criteria ───────────────────────────────────────
    AND (
      (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')
      OR (
        (
          UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%SCHWAB%'
          OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%FIDELITY%'
          OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%PERSHING%'
          OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%TD AMERITRADE%'
        )
        AND c.REP_LICENSES NOT LIKE '%Series 7%'
      )
    )
    AND SAFE_DIVIDE(
      SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    ) > 0.70
    AND SAFE_DIVIDE(
      SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    ) > 0.30
    AND COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0) < 3
    AND SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0 BETWEEN 7 AND 25
    -- ── Ceiling criteria ────────────────────────────────────
    AND SAFE_CAST(f.TOTAL_AUM AS INT64) < 1000000000
    AND c.RIA_CONTACT_CRD_ID NOT IN (SELECT crd FROM has_accolade)
    -- ── V5 TENURE CRITERION — Block 1A d=0.549, labeled has SHORTER tenure
    -- Direction reversed: labeled avg=5.54yr vs control 9.30yr
    -- Ceiling on tenure: exclude very-long-tenured advisors (control profile)
    -- Labeled P75=7.8yr, pct_over_10yr=16.6% vs control 36.0%
    AND DATE_DIFF(CURRENT_DATE(), SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE), MONTH) / 12.0 < 10
)

SELECT
  bc.crd                                               AS advisor_crd,
  bc.salesforce_lead_id,
  bc.first_name,
  bc.last_name,
  bc.job_title,
  bc.email,
  bc.phone,
  bc.linkedin_url,
  bc.has_linkedin,
  bc.PRODUCING_ADVISOR                                 AS producing_advisor,
  bc.firm_name,
  bc.firm_crd,
  bc.firm_rep_count,
  bc.firm_aum,

  -- V5: clean tenure and prior firms from ria_contacts_current
  ROUND(pf.tenure_at_firm_years, 1)                   AS tenure_at_firm_years,  -- NEW in V5
  ROUND(pf.tenure_at_firm_years * 12, 0)              AS tenure_months,
  ROUND(pf.tenure_at_firm_years, 1)                   AS tenure_years,
  bc.industry_tenure_years,
  pf.num_prior_firms,                                  -- V5: from CRD_IDS field, no -1 adjustment

  bc.firm_disc_ratio,
  bc.firm_hnw_ratio,
  bc.has_series_65_only,
  bc.has_series_7,
  bc.license_count,
  bc.is_independent_ria,
  bc.has_portable_custodian,
  bc.custodian,

  'TIER_AUM_MID'                                       AS score_tier,
  3.4                                                  AS expected_rate_pct,
  CONCAT(
    'AUM-MID proxy: ',
    CASE WHEN bc.is_independent_ria THEN 'Indep RIA' ELSE 'Portable custodian' END,
    ', disc=', ROUND(bc.firm_disc_ratio, 2),
    ', hnw=', ROUND(bc.firm_hnw_ratio, 2),
    ', ', bc.license_count, ' lic',
    ', ', ROUND(bc.industry_tenure_years, 0), 'yr exp',
    ', ', ROUND(pf.tenure_at_firm_years, 1), 'yr at firm'  -- NEW in V5
  )                                                    AS score_narrative,

  COALESCE(v4.v4_score, 0.5)                           AS v4_score,
  COALESCE(v4.v4_percentile, 50)                       AS v4_percentile,
  bc.prospect_type,
  'TIER_AUM_MID'                                       AS tier_category,
  -- Change to 'production' after shadow validation complete
  CASE
    WHEN pf.tenure_at_firm_years IS NULL THEN 'shadow_no_tenure'
    ELSE 'shadow_validation'
  END                                                  AS run_mode,

  ROW_NUMBER() OVER (
    ORDER BY
      COALESCE(v4.v4_percentile, 50) DESC,
      bc.firm_disc_ratio DESC,
      bc.firm_hnw_ratio DESC,
      bc.crd
  )                                                    AS priority_rank

FROM base_candidates bc
LEFT JOIN prior_firms_v5 pf ON pf.crd = bc.crd
LEFT JOIN v4_scores      v4 ON v4.crd = bc.crd
;


-- ============================================================
-- BLOCK 3B: POST-REFRESH VALIDATION
-- Run immediately after Block 3 to confirm the refresh
-- produced expected results and tenure is now populated.
-- ============================================================

-- Summary comparison: V5 vs V4 shadow table
SELECT
  COUNT(*)                                             AS total_candidates,
  COUNT(DISTINCT advisor_crd)                          AS unique_crds,
  COUNT(DISTINCT firm_crd)                             AS unique_firms,
  COUNTIF(tenure_at_firm_years IS NOT NULL)            AS has_tenure,     -- should be > 0 now
  ROUND(COUNTIF(tenure_at_firm_years IS NOT NULL) * 100.0 / COUNT(*), 1)
                                                       AS pct_has_tenure,
  ROUND(AVG(tenure_at_firm_years), 1)                  AS avg_tenure_at_firm,
  ROUND(AVG(num_prior_firms), 2)                       AS avg_prior_firms_v5,
  ROUND(AVG(v4_percentile), 1)                         AS avg_v4_pct,
  MAX(firm_count)                                      AS max_per_firm,
  -- Compare to V4 shadow table count (3,998)
  -- If tenure criterion was added, this will be lower — record the delta
  COUNT(*) - 3998                                      AS delta_vs_v4_shadow
FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
CROSS JOIN (
  SELECT firm_crd, COUNT(*) AS firm_count
  FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
  GROUP BY firm_crd
)
;

-- Tenure distribution in refreshed shadow table
SELECT
  CASE
    WHEN tenure_at_firm_years IS NULL        THEN 'NULL (no start date)'
    WHEN tenure_at_firm_years < 1            THEN '< 1 year'
    WHEN tenure_at_firm_years BETWEEN 1 AND 4 THEN '1–4 years (PRIME_MOVER window)'
    WHEN tenure_at_firm_years BETWEEN 4 AND 10 THEN '4–10 years (settling)'
    WHEN tenure_at_firm_years > 10           THEN '10+ years (established)'
  END                                                  AS tenure_bucket,
  COUNT(*)                                             AS advisor_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1)   AS pct
FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
GROUP BY 1
ORDER BY 2 DESC
;
