-- ============================================================
-- AGENT GUIDE V4 — ANALYSIS SQL
-- Three sequential blocks:
--
-- BLOCK 1: Fixed Employment History Validation
--   Confirms the correct join produces non-null tenure and
--   prior_firm_count for the labeled $40M–$100M cohort.
--   Validates the fix before it's used in production.
--
-- BLOCK 2: Tier Overlap Analysis
--   Counts how many TIER_AUM_MID candidates already exist
--   in the current month's lead list under existing V3 tiers.
--   Segments overlap by tier so you can see exactly which
--   existing tiers are double-covering this population.
--
-- BLOCK 3: Production SQL Stub — TIER_AUM_MID
--   Generates the full TIER_AUM_MID candidate list in the
--   exact schema of the current lead list pipeline.
--   Output table: ml_features.aum_mid_tier_candidates
--   This is NOT inserted into the live lead list yet —
--   it is a shadow table for validation first.
--
-- Prerequisites:
--   • ml_features.aum_40_100m_signal_profile
--   • ml_features.aum_proxy_labeled_features
--   • ml_features.excluded_firm_crds
--   • ml_features.excluded_firms (pattern-based)
--   • Current month lead list table (auto-detected in Block 2)
-- ============================================================


-- ============================================================
-- BLOCK 1: FIXED EMPLOYMENT HISTORY VALIDATION
-- ============================================================
-- The prior investigations returned NULL for tenure_at_firm_years
-- and prior_firm_count because the CTE filtered to END_DATE IS NULL,
-- which only returns the current employer — leaving zero rows
-- for the aggregation that counts prior firms.
--
-- The fix is to split into two separate CTEs:
--   A) Current tenure: filter WHERE END_DATE IS NULL → get start date
--   B) Prior firm count: no end_date filter → count ALL distinct firms
--      then subtract 1 for the current firm
--
-- Run this block first. Validate before proceeding.
-- ============================================================

-- BLOCK 1A: Validate the fix on the labeled $40M–$100M cohort
WITH

labeled_crds AS (
  SELECT DISTINCT crd
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
  WHERE crd IS NOT NULL
),

-- Current firm tenure: only rows where rep is still employed (END_DATE IS NULL)
current_tenure AS (
  SELECT
    eh.RIA_CONTACT_CRD_ID                               AS crd,
    MAX(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE)     AS current_firm_start_date,
    DATE_DIFF(
      CURRENT_DATE(),
      MAX(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE),
      MONTH
    ) / 12.0                                             AS tenure_at_firm_years
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history` eh
  WHERE eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NULL
    AND eh.RIA_CONTACT_CRD_ID IN (SELECT crd FROM labeled_crds)
  GROUP BY eh.RIA_CONTACT_CRD_ID
),

-- Prior firm count: ALL employment records, no end_date filter
-- Subtract 1 to remove the current firm from the count
all_firms AS (
  SELECT
    eh.RIA_CONTACT_CRD_ID                               AS crd,
    COUNT(DISTINCT eh.PREVIOUS_REGISTRATION_COMPANY_CRD_ID) AS total_firm_count,
    GREATEST(
      COUNT(DISTINCT eh.PREVIOUS_REGISTRATION_COMPANY_CRD_ID) - 1, 0
    )                                                    AS prior_firm_count
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history` eh
  WHERE eh.RIA_CONTACT_CRD_ID IN (SELECT crd FROM labeled_crds)
  GROUP BY eh.RIA_CONTACT_CRD_ID
)

SELECT
  COUNT(lc.crd)                                         AS total_labeled,
  COUNTIF(ct.tenure_at_firm_years IS NOT NULL)          AS has_tenure,
  COUNTIF(af.prior_firm_count IS NOT NULL)              AS has_prior_firm_count,
  ROUND(AVG(ct.tenure_at_firm_years), 1)                AS avg_tenure_years,
  ROUND(APPROX_QUANTILES(ct.tenure_at_firm_years, 2)[OFFSET(1)], 1)
                                                        AS median_tenure_years,
  ROUND(AVG(af.prior_firm_count), 1)                    AS avg_prior_firms,
  ROUND(APPROX_QUANTILES(af.prior_firm_count, 2)[OFFSET(1)], 1)
                                                        AS median_prior_firms,
  -- TIER_2_PROVEN_MOVER criterion check: num_prior_firms >= 3
  COUNTIF(af.prior_firm_count >= 3)                     AS qualifies_proven_mover,
  ROUND(COUNTIF(af.prior_firm_count >= 3) * 100.0 / COUNT(lc.crd), 1)
                                                        AS pct_qualifies_proven_mover
FROM labeled_crds lc
LEFT JOIN current_tenure ct ON ct.crd = lc.crd
LEFT JOIN all_firms       af ON af.crd = lc.crd
;


-- BLOCK 1B: Distribution of prior_firm_count in labeled vs control cohort
-- After confirming the fix works, run this to see if the signal discriminates
WITH

get_prior_firms AS (
  SELECT
    'LABELED'                                           AS group_label,
    GREATEST(
      COUNT(DISTINCT eh.PREVIOUS_REGISTRATION_COMPANY_CRD_ID) - 1, 0
    )                                                   AS prior_firm_count
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` lf
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history` eh
    ON eh.RIA_CONTACT_CRD_ID = lf.crd
  GROUP BY lf.crd

  UNION ALL

  SELECT
    'CONTROL',
    GREATEST(
      COUNT(DISTINCT eh.PREVIOUS_REGISTRATION_COMPANY_CRD_ID) - 1, 0
    )
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features` cf
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history` eh
    ON eh.RIA_CONTACT_CRD_ID = cf.crd
  GROUP BY cf.crd
)

SELECT
  group_label,
  COUNT(*)                                              AS n,
  ROUND(AVG(prior_firm_count), 2)                       AS avg_prior_firms,
  ROUND(APPROX_QUANTILES(prior_firm_count, 2)[OFFSET(1)], 1) AS median_prior_firms,
  COUNTIF(prior_firm_count = 0)                         AS pct_zero_prior,
  COUNTIF(prior_firm_count >= 1)                        AS has_1plus_prior,
  COUNTIF(prior_firm_count >= 3)                        AS has_3plus_prior,
  ROUND(COUNTIF(prior_firm_count >= 3) * 100.0 / COUNT(*), 1)
                                                        AS pct_3plus_prior,
  -- Cohen's d approximation for discrimination score
  -- Computed externally from avg and stddev — record these
  ROUND(STDDEV(prior_firm_count), 2)                    AS stddev_prior_firms
FROM get_prior_firms
GROUP BY group_label
ORDER BY group_label
;


-- ============================================================
-- BLOCK 2: TIER OVERLAP ANALYSIS
-- ============================================================
-- Answers: Of the advisors who would qualify for TIER_AUM_MID
-- (Enhanced criteria + firm_aum < $1B), how many are already
-- being reached by existing V3 tiers in the current lead list?
--
-- Current lead list table: auto-detected by querying both
-- ml_features.march_2026_lead_list and january_2026_lead_list.
-- Use whichever is more recent / has more rows.
-- ============================================================

-- BLOCK 2A: Check which lead list table is current
SELECT
  'march_2026_lead_list'                                AS table_name,
  COUNT(*)                                              AS row_count,
  MAX(score_tier)                                       AS sample_tier
FROM `savvy-gtm-analytics.ml_features.march_2026_lead_list`

UNION ALL

SELECT
  'january_2026_lead_list',
  COUNT(*),
  MAX(score_tier)
FROM `savvy-gtm-analytics.ml_features.january_2026_lead_list`
;


-- BLOCK 2B: Core overlap analysis
-- Replace [CURRENT_LEAD_LIST] with whichever table Block 2A shows is current
-- (e.g., march_2026_lead_list)
WITH

excluded_firms_patterns AS (
  SELECT pattern FROM `savvy-gtm-analytics.ml_features.excluded_firms`
),

excluded_firm_crds_list AS (
  SELECT firm_crd FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

sfdc_crds AS (
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64), 0) AS INT64) AS crd
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE FA_CRD__c IS NOT NULL
  UNION DISTINCT
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64), 0) AS INT64)
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE FA_CRD__c IS NOT NULL
),

-- All advisors passing TIER_AUM_MID Enhanced criteria
-- (same as B1 from V3 but now with firm_aum < $1B ceiling added)
tier_aum_mid_candidates AS (
  SELECT
    c.RIA_CONTACT_CRD_ID                                AS crd,
    c.PRIMARY_FIRM                                      AS firm_crd,
    SAFE_CAST(f.TOTAL_AUM AS INT64)                     AS firm_aum
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
    ON f.CRD_ID = c.PRIMARY_FIRM
  WHERE c.PRODUCING_ADVISOR = 'true'
    AND c.PRIMARY_FIRM IS NOT NULL
    -- Standard exclusions
    AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
    AND c.PRIMARY_FIRM NOT IN (SELECT firm_crd FROM excluded_firm_crds_list)
    AND SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) <= 480  -- under ~70 yrs
    -- Not already in SFDC pipeline
    AND c.RIA_CONTACT_CRD_ID NOT IN (SELECT crd FROM sfdc_crds WHERE crd IS NOT NULL)
    -- ── Enhanced AUM proxy criteria ─────────────────────────────
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
    -- ── Ceiling: firm AUM < $1B ──────────────────────────────────
    AND SAFE_CAST(f.TOTAL_AUM AS INT64) < 1000000000
    -- ── Ceiling: no accolades (suggests >$100M) ─────────────────
    AND NOT EXISTS (
      SELECT 1
      FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_accolades_historicals` a
      WHERE a.RIA_CONTACT_CRD_ID = c.RIA_CONTACT_CRD_ID
    )
),

-- Current lead list (use most recent — update table name from Block 2A)
current_lead_list AS (
  SELECT
    SAFE_CAST(advisor_crd AS INT64)                     AS crd,
    score_tier,
    sga_owner,
    expected_rate_pct
  FROM `savvy-gtm-analytics.ml_features.march_2026_lead_list`
  -- If march doesn't exist yet, swap to: january_2026_lead_list
)

-- ── Overlap summary ─────────────────────────────────────────
SELECT
  COUNT(DISTINCT t.crd)                                 AS total_mid_candidates,
  COUNTIF(ll.crd IS NOT NULL)                           AS already_in_lead_list,
  COUNTIF(ll.crd IS NULL)                               AS net_new_to_pipeline,
  ROUND(COUNTIF(ll.crd IS NOT NULL) * 100.0 / COUNT(DISTINCT t.crd), 1)
                                                        AS pct_overlap
FROM tier_aum_mid_candidates t
LEFT JOIN current_lead_list ll ON ll.crd = t.crd
;


-- BLOCK 2C: Overlap breakdown BY existing tier
-- Shows exactly which tiers are double-covering TIER_AUM_MID candidates
WITH

excluded_firm_crds_list AS (
  SELECT firm_crd FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),
sfdc_crds AS (
  SELECT DISTINCT SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64) AS crd
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead` WHERE FA_CRD__c IS NOT NULL
  UNION DISTINCT
  SELECT DISTINCT SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64)
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` WHERE FA_CRD__c IS NOT NULL
),

tier_aum_mid_candidates AS (
  SELECT c.RIA_CONTACT_CRD_ID AS crd
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f ON f.CRD_ID = c.PRIMARY_FIRM
  WHERE c.PRODUCING_ADVISOR = 'true'
    AND c.PRIMARY_FIRM IS NOT NULL
    AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
    AND c.PRIMARY_FIRM NOT IN (SELECT firm_crd FROM excluded_firm_crds_list)
    AND SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) <= 480
    AND c.RIA_CONTACT_CRD_ID NOT IN (SELECT crd FROM sfdc_crds WHERE crd IS NOT NULL)
    AND (
      (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')
      OR ((UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%SCHWAB%'
           OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%FIDELITY%'
           OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%PERSHING%'
           OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%TD AMERITRADE%')
          AND c.REP_LICENSES NOT LIKE '%Series 7%')
    )
    AND SAFE_DIVIDE(SAFE_CAST(f.DISCRETIONARY_AUM AS INT64), NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64),0)) > 0.70
    AND SAFE_DIVIDE(SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64), NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64),0)) > 0.30
    AND COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0) < 3
    AND SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0 BETWEEN 7 AND 25
    AND SAFE_CAST(f.TOTAL_AUM AS INT64) < 1000000000
    AND NOT EXISTS (
      SELECT 1 FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_accolades_historicals` a
      WHERE a.RIA_CONTACT_CRD_ID = c.RIA_CONTACT_CRD_ID
    )
),

current_lead_list AS (
  SELECT SAFE_CAST(advisor_crd AS INT64) AS crd, score_tier
  FROM `savvy-gtm-analytics.ml_features.march_2026_lead_list`
)

SELECT
  COALESCE(ll.score_tier, '(not in lead list)')        AS existing_tier,
  COUNT(*)                                              AS advisor_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1)    AS pct_of_mid_candidates
FROM tier_aum_mid_candidates t
LEFT JOIN current_lead_list ll ON ll.crd = t.crd
GROUP BY 1
ORDER BY 2 DESC
;


-- ============================================================
-- BLOCK 3: PRODUCTION SQL STUB — TIER_AUM_MID
-- ============================================================
-- Creates ml_features.aum_mid_tier_candidates in the same
-- schema as the existing lead list pipeline output columns.
-- This is a SHADOW TABLE — not inserted into live pipeline yet.
-- After shadow validation, this stub gets integrated into the
-- monthly lead list SQL as an additional tier.
-- ============================================================
CREATE OR REPLACE TABLE `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates` AS

WITH

excluded_firm_crds_list AS (
  SELECT firm_crd FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

sfdc_crds AS (
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64) AS crd,
    Id                                                  AS salesforce_lead_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE FA_CRD__c IS NOT NULL
    AND IsDeleted = FALSE
),

-- Fixed employment history: split into current tenure + all-time prior count
current_tenure AS (
  SELECT
    eh.RIA_CONTACT_CRD_ID                               AS crd,
    MAX(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE)     AS current_firm_start,
    DATE_DIFF(
      CURRENT_DATE(),
      MAX(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE),
      MONTH
    )                                                    AS tenure_months
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history` eh
  WHERE eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NULL
  GROUP BY eh.RIA_CONTACT_CRD_ID
),

prior_firms AS (
  SELECT
    eh.RIA_CONTACT_CRD_ID                               AS crd,
    GREATEST(
      COUNT(DISTINCT eh.PREVIOUS_REGISTRATION_COMPANY_CRD_ID) - 1, 0
    )                                                    AS num_prior_firms
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_registered_employment_history` eh
  GROUP BY eh.RIA_CONTACT_CRD_ID
),

-- Accolade check for ceiling exclusion
has_accolade AS (
  SELECT DISTINCT RIA_CONTACT_CRD_ID AS crd
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_accolades_historicals`
),

-- V4 scores for ranking within tier
v4_scores AS (
  SELECT crd, v4_score, v4_percentile
  FROM `savvy-gtm-analytics.ml_features.v4_prospect_scores`
),

-- Base candidate pool
base_candidates AS (
  SELECT
    c.RIA_CONTACT_CRD_ID                                AS crd,
    -- Lead identity
    c.CONTACT_FIRST_NAME                                AS first_name,
    c.CONTACT_LAST_NAME                                 AS last_name,
    c.TITLE_NAME                                        AS job_title,
    c.EMAIL                                             AS email,
    c.OFFICE_PHONE_NUMBER                               AS phone,
    c.LINKEDIN_PROFILE_URL                              AS linkedin_url,
    (c.LINKEDIN_PROFILE_URL IS NOT NULL)                AS has_linkedin,
    c.PRODUCING_ADVISOR,

    -- Firm
    f.NAME                                              AS firm_name,
    c.PRIMARY_FIRM                                      AS firm_crd,
    SAFE_CAST(f.TOTAL_AUM AS INT64)                     AS firm_aum,

    -- Rep count (for scoring and narrative)
    (SELECT COUNT(DISTINCT c2.RIA_CONTACT_CRD_ID)
     FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c2
     WHERE c2.PRIMARY_FIRM = c.PRIMARY_FIRM
       AND c2.PRODUCING_ADVISOR = 'true')               AS firm_rep_count,

    -- Firm signals
    SAFE_DIVIDE(
      SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    )                                                   AS firm_disc_ratio,
    SAFE_DIVIDE(
      SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    )                                                   AS firm_hnw_ratio,
    f.CUSTODIAN_PRIMARY_BUSINESS_NAME                   AS custodian,

    -- License signals
    COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0)
                                                        AS license_count,
    (c.REP_LICENSES LIKE '%Series 65%'
     AND c.REP_LICENSES NOT LIKE '%Series 7%')          AS has_series_65_only,
    (c.REP_LICENSES LIKE '%Series 7%')                  AS has_series_7,

    -- Career
    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64)        AS industry_tenure_months,
    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0 AS industry_tenure_years,

    -- Firm type
    (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')  AS is_independent_ria,
    (
      UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%SCHWAB%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%FIDELITY%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%PERSHING%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%TD AMERITRADE%'
    )                                                   AS has_portable_custodian,

    -- SFDC status
    sc.salesforce_lead_id,
    CASE WHEN sc.crd IS NULL THEN 'NEW_PROSPECT' ELSE 'IN_PIPELINE' END
                                                        AS prospect_type

  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
    ON f.CRD_ID = c.PRIMARY_FIRM
  LEFT JOIN sfdc_crds sc ON sc.crd = c.RIA_CONTACT_CRD_ID
  WHERE c.PRODUCING_ADVISOR = 'true'
    AND c.PRIMARY_FIRM IS NOT NULL
    -- Standard exclusions
    AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
    AND c.PRIMARY_FIRM NOT IN (SELECT firm_crd FROM excluded_firm_crds_list)
    AND SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) <= 480
    -- Net new only (not already in pipeline)
    AND sc.crd IS NULL
    -- ── Enhanced AUM proxy criteria (floor signals) ──────────────
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
    -- ── Ceiling signals ──────────────────────────────────────────
    AND SAFE_CAST(f.TOTAL_AUM AS INT64) < 1000000000     -- firm AUM < $1B
    AND c.RIA_CONTACT_CRD_ID NOT IN (SELECT crd FROM has_accolade)
)

-- Final output matching lead list schema
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

  -- Employment signals (fixed join)
  ct.tenure_months,
  ROUND(ct.tenure_months / 12.0, 1)                   AS tenure_years,
  bc.industry_tenure_years,
  COALESCE(pf.num_prior_firms, 0)                      AS num_prior_firms,

  -- AUM proxy signals (for transparency and debugging)
  bc.firm_disc_ratio,
  bc.firm_hnw_ratio,
  bc.has_series_65_only,
  bc.has_series_7,
  bc.license_count,
  bc.is_independent_ria,
  bc.has_portable_custodian,
  bc.custodian,

  -- Tier assignment
  'TIER_AUM_MID'                                       AS score_tier,
  3.4                                                  AS expected_rate_pct,
  -- Human-readable narrative matching existing pipeline format
  CONCAT(
    'AUM-MID proxy: ',
    CASE WHEN bc.is_independent_ria THEN 'Indep RIA' ELSE 'Portable custodian' END,
    ', disc_ratio=', ROUND(bc.firm_disc_ratio, 2),
    ', hnw_ratio=', ROUND(bc.firm_hnw_ratio, 2),
    ', ', bc.license_count, ' licenses',
    ', ', ROUND(bc.industry_tenure_years, 0), 'yr exp'
  )                                                    AS score_narrative,

  -- V4 scores (for optional ML prioritization within tier)
  COALESCE(v4.v4_score, 0.5)                           AS v4_score,
  COALESCE(v4.v4_percentile, 50)                       AS v4_percentile,

  -- Pipeline metadata
  bc.prospect_type,
  'TIER_AUM_MID'                                       AS tier_category,
  'shadow_validation'                                  AS run_mode,  -- change to 'production' after validation

  -- Priority ranking within tier:
  -- Primary: V4 percentile DESC (best ML signal first)
  -- Secondary: firm_disc_ratio DESC (higher discretionary = stronger fit)
  -- Tertiary: firm_hnw_ratio DESC
  ROW_NUMBER() OVER (
    ORDER BY
      COALESCE(v4.v4_percentile, 50) DESC,
      bc.firm_disc_ratio DESC,
      bc.firm_hnw_ratio DESC,
      bc.crd
  )                                                    AS priority_rank

FROM base_candidates bc
LEFT JOIN current_tenure ct ON ct.crd = bc.crd
LEFT JOIN prior_firms    pf ON pf.crd = bc.crd
LEFT JOIN v4_scores      v4 ON v4.crd = bc.crd
;


-- ============================================================
-- BLOCK 3B: SHADOW VALIDATION QUERIES
-- Run these AFTER Block 3 creates the shadow table.
-- ============================================================

-- Quick summary
SELECT
  COUNT(*)                                             AS total_candidates,
  COUNT(DISTINCT advisor_crd)                          AS unique_crds,
  COUNT(DISTINCT firm_crd)                             AS unique_firms,
  COUNTIF(has_linkedin)                                AS has_linkedin,
  ROUND(COUNTIF(has_linkedin) * 100.0 / COUNT(*), 1)  AS pct_linkedin,
  ROUND(AVG(v4_percentile), 1)                         AS avg_v4_percentile,
  ROUND(AVG(firm_disc_ratio), 3)                       AS avg_disc_ratio,
  ROUND(AVG(firm_hnw_ratio), 3)                        AS avg_hnw_ratio,
  ROUND(AVG(num_prior_firms), 2)                       AS avg_prior_firms,
  ROUND(AVG(tenure_years), 1)                          AS avg_tenure_years,
  -- Top 10 firm cap check
  MAX(firm_count)                                      AS max_advisors_per_firm
FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
CROSS JOIN (
  SELECT firm_crd, COUNT(*) AS firm_count
  FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
  GROUP BY firm_crd
)
;

-- Prior firm count distribution (validates Block 1 fix is working)
SELECT
  num_prior_firms,
  COUNT(*)                                             AS advisor_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1)   AS pct
FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
GROUP BY num_prior_firms
ORDER BY num_prior_firms
;

-- Top 20 firms by advisor count (firm diversity check)
SELECT
  firm_name,
  firm_crd,
  COUNT(*)                                             AS advisor_count,
  ROUND(AVG(firm_aum) / 1e6, 0)                        AS avg_firm_aum_M
FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
GROUP BY firm_name, firm_crd
ORDER BY advisor_count DESC
LIMIT 20
;
