-- ============================================================
-- AUM PROXY SIGNAL COMPARISON
-- $40M–$100M Labeled Cohort vs. General FINTRX Universe
-- ============================================================
-- Purpose  : Identify which FINTRX signals best discriminate
--            advisors with $40M–$100M AUM from the general
--            producing advisor population. These signals become
--            the proxy features for a new FINTRX prospecting tier.
--
-- Method   : Compare feature distributions between two groups:
--            GROUP A — 336 advisors confirmed $40M–$100M AUM in SFDC
--            GROUP B — 5,000 producing advisors never in SFDC pipeline
--            (random sample, stratified by firm type to avoid bias)
--
-- Output 1 : savvy-gtm-analytics.ml_features.aum_proxy_labeled_features
--            (one row per labeled advisor with all features computed)
--
-- Output 2 : savvy-gtm-analytics.ml_features.aum_proxy_control_features
--            (one row per control advisor with same features)
--
-- Output 3 : Run comparison query (STEP 3) after both tables exist
--            to produce ranked signal discrimination table
--
-- Prerequisites:
--   • ml_features.aum_40_100m_signal_profile must exist (Phase 1 output)
--   • SavvyGTMData.Lead and SavvyGTMData.Opportunity must be accessible
-- ============================================================


-- ============================================================
-- SHARED FEATURE CTE LIBRARY
-- These CTEs are used by BOTH the labeled and control queries.
-- They are defined once here as a reference — copy into each
-- CREATE OR REPLACE TABLE statement below as needed.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- FEATURE DEFINITION REFERENCE
-- This block shows every feature being computed and why.
-- Used in both STEP 1 and STEP 2 table builds.
-- ─────────────────────────────────────────────────────────────

/*
FEATURE INVENTORY (20 features across 6 categories):

CATEGORY 1 — FIRM SIZE / SCALE
  F01  firm_rep_count          : # advisors at same firm (CRD match in ria_contacts_current)
  F02  firm_aum_current        : Firm total AUM (ria_firms_current.TOTAL_AUM)
  F03  firm_aum_per_rep        : firm_aum / firm_rep_count (the divisor proxy — test it)
  F04  firm_disc_ratio         : DISCRETIONARY_AUM / TOTAL_AUM (relationship depth proxy)
  F05  firm_hnw_ratio          : HNW client AUM / TOTAL_AUM (client quality proxy)
  F06  firm_aum_bucket         : Categorical band of firm AUM

CATEGORY 2 — ADVISOR CAREER STAGE
  F07  industry_tenure_years   : INDUSTRY_TENURE_MONTHS / 12 (career progression proxy)
  F08  tenure_at_firm_years    : Years at current firm (from employment history)
  F09  prior_firm_count        : # prior employers (mobility signal)
  F10  experience_bucket       : Categorical: Early(<7yr), Mid(7-15yr), Peak(15-25yr), Late(25+yr)

CATEGORY 3 — LICENSE / CREDENTIAL PROFILE
  F11  is_series_65_only       : Pure RIA (no Series 7) — own-book advisor signal
  F12  has_series_7            : Dual registration — wirehouse/BD background
  F13  has_cfp                 : CFP credential
  F14  has_cfa                 : CFA credential
  F15  license_count           : Total # licenses held

CATEGORY 4 — PRACTICE MATURITY
  F16  state_reg_count         : # states registered (geographic spread proxy)
  F17  has_ownership           : Any ownership stake in firm
  F18  is_portable_custodian   : Schwab/Fidelity/Pershing/TDA custodian

CATEGORY 5 — FIRM TYPE
  F19  is_independent_ria      : Independent RIA firm type
  F20  is_solo_micro_firm      : firm_rep_count <= 3

CATEGORY 6 — QUALITY / DISQUALIFIER
  F21  has_any_accolade        : Any Forbes/Barron's/AdvisorHub recognition
  F22  has_any_disclosure      : Any compliance disclosure

NOTE ON FIRM AUM / REP COUNT (F03):
  This is included as a feature to TEST whether it discriminates,
  not because we assume it works. The comparison output will tell us
  definitively if the distributions differ between the two groups.
  If the labeled cohort shows a significantly tighter F03 range
  (e.g., $15M–$80M per rep), it's a usable proxy. If not, we discard it.
*/


-- ============================================================
-- STEP 1: BUILD LABELED COHORT FEATURE TABLE
-- Source: advisors confirmed $40M–$100M AUM in SFDC
-- Deduplicated to one row per unique CRD (some advisors appear
-- as multiple opps — take their most recent opp as the anchor)
-- ============================================================
CREATE OR REPLACE TABLE `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` AS

WITH

-- Deduplicate to one row per CRD — most recent opp wins
labeled_spine AS (
  SELECT
    crd,
    MAX(opp_created_date)   AS anchor_date,
    MAX(aum_used)           AS sfdc_aum,           -- confirmed AUM label
    MAX(is_won)             AS ever_won,
    firm_crd
  FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
  WHERE crd IS NOT NULL
  GROUP BY crd, firm_crd
),

-- Firm rep count (current state)
firm_rep_count AS (
  SELECT
    PRIMARY_FIRM            AS firm_crd,
    COUNT(DISTINCT RIA_CONTACT_CRD_ID) AS rep_count
  FROM `savvy-gtm-analytics.FinTrx_data.ria_contacts_current`
  WHERE PRIMARY_FIRM IS NOT NULL
    AND PRODUCING_ADVISOR = TRUE
  GROUP BY PRIMARY_FIRM
),

-- Most recent firm AUM snapshot (current)
firm_aum_data AS (
  SELECT
    f.CRD_ID                AS firm_crd,
    f.TOTAL_AUM,
    f.DISCRETIONARY_AUM,
    f.NUM_OF_CLIENTS_HIGH_NET_WORTH_INDIVIDUALS AS hnw_client_count,
    f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS     AS hnw_aum,
    f.CUSTODIAN_PRIMARY_BUSINESS_NAME           AS custodian
  FROM `savvy-gtm-analytics.FinTrx_data.ria_firms_current` f
),

-- Tenure at current firm and prior firm count from employment history
tenure_data AS (
  SELECT
    eh.RIA_CONTACT_CRD_ID                       AS crd,
    -- Tenure at current employer as of today
    MAX(DATE_DIFF(
      CURRENT_DATE(),
      eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE,
      MONTH
    )) / 12.0                                    AS tenure_at_firm_years,
    -- Prior firm count
    GREATEST(COUNT(DISTINCT eh.PREVIOUS_REGISTRATION_COMPANY_CRD_ID) - 1, 0)
                                                 AS prior_firm_count
  FROM `savvy-gtm-analytics.FinTrx_data.contact_registered_employment_history` eh
  WHERE eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NULL
     OR eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE >= CURRENT_DATE()
  GROUP BY eh.RIA_CONTACT_CRD_ID
),

-- State registration count
state_reg_data AS (
  SELECT
    contact_crd_id          AS crd,
    COUNT(DISTINCT registerations_regulator) AS state_reg_count
  FROM `savvy-gtm-analytics.FinTrx_data.contact_state_registrations_historicals`
  WHERE active = TRUE
  GROUP BY contact_crd_id
),

-- Accolade presence
accolade_data AS (
  SELECT
    RIA_CONTACT_CRD_ID      AS crd,
    COUNT(*)                AS accolade_count,
    COUNTIF(UPPER(OUTLET) LIKE '%FORBES%')   AS forbes_count,
    COUNTIF(UPPER(OUTLET) LIKE '%BARRON%')   AS barrons_count
  FROM `savvy-gtm-analytics.FinTrx_data.contact_accolades_historicals`
  GROUP BY RIA_CONTACT_CRD_ID
)

SELECT
  -- ── Identifiers ──────────────────────────────────────────
  ls.crd,
  ls.firm_crd,
  'LABELED'                                           AS group_label,
  ls.sfdc_aum,
  ls.ever_won,

  -- ── F01: Firm Rep Count ──────────────────────────────────
  COALESCE(frc.rep_count, 1)                          AS firm_rep_count,

  -- ── F02: Firm AUM (current) ──────────────────────────────
  fa.TOTAL_AUM                                        AS firm_aum_current,

  -- ── F03: Firm AUM Per Rep (THE DIVISOR — test it) ────────
  SAFE_DIVIDE(fa.TOTAL_AUM, NULLIF(COALESCE(frc.rep_count, 1), 0))
                                                      AS firm_aum_per_rep,

  -- ── F04: Discretionary Ratio ─────────────────────────────
  SAFE_DIVIDE(fa.DISCRETIONARY_AUM, NULLIF(fa.TOTAL_AUM, 0))
                                                      AS firm_disc_ratio,

  -- ── F05: HNW Client AUM Ratio ────────────────────────────
  SAFE_DIVIDE(fa.hnw_aum, NULLIF(fa.TOTAL_AUM, 0))   AS firm_hnw_ratio,

  -- ── F06: Firm AUM Bucket ─────────────────────────────────
  CASE
    WHEN fa.TOTAL_AUM IS NULL              THEN 'Unknown'
    WHEN fa.TOTAL_AUM < 50000000           THEN 'Under $50M'
    WHEN fa.TOTAL_AUM < 100000000          THEN '$50M–$100M'
    WHEN fa.TOTAL_AUM < 250000000          THEN '$100M–$250M'
    WHEN fa.TOTAL_AUM < 500000000          THEN '$250M–$500M'
    WHEN fa.TOTAL_AUM < 1000000000         THEN '$500M–$1B'
    WHEN fa.TOTAL_AUM < 5000000000         THEN '$1B–$5B'
    ELSE '$5B+'
  END                                                 AS firm_aum_bucket,

  -- ── F07: Industry Tenure Years ───────────────────────────
  c.INDUSTRY_TENURE_MONTHS / 12.0                     AS industry_tenure_years,

  -- ── F08: Tenure at Current Firm ──────────────────────────
  td.tenure_at_firm_years,

  -- ── F09: Prior Firm Count ────────────────────────────────
  COALESCE(td.prior_firm_count, 0)                    AS prior_firm_count,

  -- ── F10: Experience Bucket ───────────────────────────────
  CASE
    WHEN c.INDUSTRY_TENURE_MONTHS IS NULL         THEN 'Unknown'
    WHEN c.INDUSTRY_TENURE_MONTHS < 84            THEN 'Early (<7yr)'
    WHEN c.INDUSTRY_TENURE_MONTHS < 180           THEN 'Mid (7–15yr)'
    WHEN c.INDUSTRY_TENURE_MONTHS < 300           THEN 'Peak (15–25yr)'
    ELSE 'Late (25+yr)'
  END                                                 AS experience_bucket,

  -- ── F11–F15: Licenses ────────────────────────────────────
  (c.REP_LICENSES LIKE '%Series 65%'
   AND c.REP_LICENSES NOT LIKE '%Series 7%')          AS is_series_65_only,
  (c.REP_LICENSES LIKE '%Series 7%')                  AS has_series_7,
  (c.REP_LICENSES LIKE '%CFP%')                       AS has_cfp,
  (c.REP_LICENSES LIKE '%CFA%')                       AS has_cfa,
  COALESCE(
    ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0
  )                                                   AS license_count,

  -- ── F16: State Registration Count ───────────────────────
  COALESCE(srd.state_reg_count, 0)                    AS state_reg_count,

  -- ── F17: Ownership Stake ─────────────────────────────────
  (c.CONTACT_OWNERSHIP_PERCENTAGE IS NOT NULL
   AND c.CONTACT_OWNERSHIP_PERCENTAGE NOT LIKE '%No Ownership%')
                                                      AS has_ownership,

  -- ── F18: Portable Custodian ──────────────────────────────
  (
    UPPER(COALESCE(fa.custodian, '')) LIKE '%SCHWAB%'
    OR UPPER(COALESCE(fa.custodian, '')) LIKE '%FIDELITY%'
    OR UPPER(COALESCE(fa.custodian, '')) LIKE '%PERSHING%'
    OR UPPER(COALESCE(fa.custodian, '')) LIKE '%TD AMERITRADE%'
  )                                                   AS is_portable_custodian,

  -- ── F19: Independent RIA ─────────────────────────────────
  (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')  AS is_independent_ria,

  -- ── F20: Solo / Micro Firm ───────────────────────────────
  (COALESCE(frc.rep_count, 1) <= 3)                   AS is_solo_micro_firm,

  -- ── F21: Accolades ───────────────────────────────────────
  (COALESCE(ad.accolade_count, 0) > 0)                AS has_any_accolade,
  COALESCE(ad.forbes_count, 0)                        AS forbes_accolade_count,
  COALESCE(ad.barrons_count, 0)                       AS barrons_accolade_count,

  -- ── F22: Disclosures ─────────────────────────────────────
  (
    COALESCE(c.CONTACT_HAS_DISCLOSED_BANKRUPT, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_CRIMINAL, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_REGULATORY_EVENT, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_TERMINATION, FALSE)
  )                                                   AS has_any_disclosure

FROM labeled_spine ls
JOIN `savvy-gtm-analytics.FinTrx_data.ria_contacts_current` c
  ON c.RIA_CONTACT_CRD_ID = ls.crd
LEFT JOIN firm_aum_data  fa  ON fa.firm_crd  = ls.firm_crd
LEFT JOIN `savvy-gtm-analytics.FinTrx_data.ria_firms_current` f
  ON f.CRD_ID = ls.firm_crd
LEFT JOIN firm_rep_count frc ON frc.firm_crd = ls.firm_crd
LEFT JOIN tenure_data    td  ON td.crd        = ls.crd
LEFT JOIN state_reg_data srd ON srd.crd        = ls.crd
LEFT JOIN accolade_data  ad  ON ad.crd         = ls.crd
;


-- ============================================================
-- STEP 2: BUILD CONTROL GROUP FEATURE TABLE
-- Source: producing advisors in FINTRX never in SFDC pipeline
-- Sample: 5,000 advisors (random, PRODUCING_ADVISOR = TRUE)
-- Exclusion: same wirehouse/excluded-CRD filters as production
--
-- NOTE: 5,000 is large enough to give stable distributions for
-- all features including rare ones (accolades, CFP, etc.)
-- without blowing up query cost. Adjust if needed.
-- ============================================================
CREATE OR REPLACE TABLE `savvy-gtm-analytics.ml_features.aum_proxy_control_features` AS

WITH

-- All SFDC CRDs (anyone who has ever been in pipeline — exclude from control)
sfdc_crds AS (
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64), 0) AS INT64) AS crd
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE FA_CRD__c IS NOT NULL
  UNION DISTINCT
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64), 0) AS INT64) AS crd
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE FA_CRD__c IS NOT NULL
),

-- Excluded firm CRDs (wirehouses + exclusion list)
excluded_firms AS (
  SELECT firm_crd FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

-- Random sample of 5,000 producing advisors not in SFDC
control_spine AS (
  SELECT
    c.RIA_CONTACT_CRD_ID    AS crd,
    c.PRIMARY_FIRM          AS firm_crd
  FROM `savvy-gtm-analytics.FinTrx_data.ria_contacts_current` c
  WHERE c.PRODUCING_ADVISOR = TRUE
    AND c.PRIMARY_FIRM IS NOT NULL
    -- Not already in SFDC pipeline
    AND c.RIA_CONTACT_CRD_ID NOT IN (SELECT crd FROM sfdc_crds WHERE crd IS NOT NULL)
    -- Not at an excluded firm
    AND c.PRIMARY_FIRM NOT IN (SELECT firm_crd FROM excluded_firms)
    -- Not a wirehouse (using same ENTITY_CLASSIFICATION flag)
    AND NOT EXISTS (
      SELECT 1
      FROM `savvy-gtm-analytics.FinTrx_data.ria_firms_current` f2
      WHERE f2.CRD_ID = c.PRIMARY_FIRM
        AND f2.ENTITY_CLASSIFICATION LIKE '%Wirehouse%'
    )
    -- Random sample — FARM_FINGERPRINT gives stable random ordering
    AND MOD(ABS(FARM_FINGERPRINT(CAST(c.RIA_CONTACT_CRD_ID AS STRING))), 100) < 2
  LIMIT 5000
),

-- Same feature CTEs as Step 1 (repeated for self-contained execution)
firm_rep_count AS (
  SELECT
    PRIMARY_FIRM            AS firm_crd,
    COUNT(DISTINCT RIA_CONTACT_CRD_ID) AS rep_count
  FROM `savvy-gtm-analytics.FinTrx_data.ria_contacts_current`
  WHERE PRIMARY_FIRM IS NOT NULL
    AND PRODUCING_ADVISOR = TRUE
  GROUP BY PRIMARY_FIRM
),

firm_aum_data AS (
  SELECT
    f.CRD_ID                AS firm_crd,
    f.TOTAL_AUM,
    f.DISCRETIONARY_AUM,
    f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS     AS hnw_aum,
    f.CUSTODIAN_PRIMARY_BUSINESS_NAME           AS custodian
  FROM `savvy-gtm-analytics.FinTrx_data.ria_firms_current` f
),

tenure_data AS (
  SELECT
    eh.RIA_CONTACT_CRD_ID                       AS crd,
    MAX(DATE_DIFF(
      CURRENT_DATE(),
      eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE,
      MONTH
    )) / 12.0                                    AS tenure_at_firm_years,
    GREATEST(COUNT(DISTINCT eh.PREVIOUS_REGISTRATION_COMPANY_CRD_ID) - 1, 0)
                                                 AS prior_firm_count
  FROM `savvy-gtm-analytics.FinTrx_data.contact_registered_employment_history` eh
  WHERE eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NULL
     OR eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE >= CURRENT_DATE()
  GROUP BY eh.RIA_CONTACT_CRD_ID
),

state_reg_data AS (
  SELECT
    contact_crd_id          AS crd,
    COUNT(DISTINCT registerations_regulator) AS state_reg_count
  FROM `savvy-gtm-analytics.FinTrx_data.contact_state_registrations_historicals`
  WHERE active = TRUE
  GROUP BY contact_crd_id
),

accolade_data AS (
  SELECT
    RIA_CONTACT_CRD_ID      AS crd,
    COUNT(*)                AS accolade_count,
    COUNTIF(UPPER(OUTLET) LIKE '%FORBES%')   AS forbes_count,
    COUNTIF(UPPER(OUTLET) LIKE '%BARRON%')   AS barrons_count
  FROM `savvy-gtm-analytics.FinTrx_data.contact_accolades_historicals`
  GROUP BY RIA_CONTACT_CRD_ID
)

-- Exact same SELECT structure as Step 1, group_label = 'CONTROL'
SELECT
  cs.crd,
  cs.firm_crd,
  'CONTROL'                                           AS group_label,
  NULL                                                AS sfdc_aum,
  NULL                                                AS ever_won,
  COALESCE(frc.rep_count, 1)                          AS firm_rep_count,
  fa.TOTAL_AUM                                        AS firm_aum_current,
  SAFE_DIVIDE(fa.TOTAL_AUM, NULLIF(COALESCE(frc.rep_count, 1), 0))
                                                      AS firm_aum_per_rep,
  SAFE_DIVIDE(fa.DISCRETIONARY_AUM, NULLIF(fa.TOTAL_AUM, 0))
                                                      AS firm_disc_ratio,
  SAFE_DIVIDE(fa.hnw_aum, NULLIF(fa.TOTAL_AUM, 0))   AS firm_hnw_ratio,
  CASE
    WHEN fa.TOTAL_AUM IS NULL              THEN 'Unknown'
    WHEN fa.TOTAL_AUM < 50000000           THEN 'Under $50M'
    WHEN fa.TOTAL_AUM < 100000000          THEN '$50M–$100M'
    WHEN fa.TOTAL_AUM < 250000000          THEN '$100M–$250M'
    WHEN fa.TOTAL_AUM < 500000000          THEN '$250M–$500M'
    WHEN fa.TOTAL_AUM < 1000000000         THEN '$500M–$1B'
    WHEN fa.TOTAL_AUM < 5000000000         THEN '$1B–$5B'
    ELSE '$5B+'
  END                                                 AS firm_aum_bucket,
  c.INDUSTRY_TENURE_MONTHS / 12.0                     AS industry_tenure_years,
  td.tenure_at_firm_years,
  COALESCE(td.prior_firm_count, 0)                    AS prior_firm_count,
  CASE
    WHEN c.INDUSTRY_TENURE_MONTHS IS NULL         THEN 'Unknown'
    WHEN c.INDUSTRY_TENURE_MONTHS < 84            THEN 'Early (<7yr)'
    WHEN c.INDUSTRY_TENURE_MONTHS < 180           THEN 'Mid (7–15yr)'
    WHEN c.INDUSTRY_TENURE_MONTHS < 300           THEN 'Peak (15–25yr)'
    ELSE 'Late (25+yr)'
  END                                                 AS experience_bucket,
  (c.REP_LICENSES LIKE '%Series 65%'
   AND c.REP_LICENSES NOT LIKE '%Series 7%')          AS is_series_65_only,
  (c.REP_LICENSES LIKE '%Series 7%')                  AS has_series_7,
  (c.REP_LICENSES LIKE '%CFP%')                       AS has_cfp,
  (c.REP_LICENSES LIKE '%CFA%')                       AS has_cfa,
  COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0)
                                                      AS license_count,
  COALESCE(srd.state_reg_count, 0)                    AS state_reg_count,
  (c.CONTACT_OWNERSHIP_PERCENTAGE IS NOT NULL
   AND c.CONTACT_OWNERSHIP_PERCENTAGE NOT LIKE '%No Ownership%')
                                                      AS has_ownership,
  (
    UPPER(COALESCE(fa.custodian, '')) LIKE '%SCHWAB%'
    OR UPPER(COALESCE(fa.custodian, '')) LIKE '%FIDELITY%'
    OR UPPER(COALESCE(fa.custodian, '')) LIKE '%PERSHING%'
    OR UPPER(COALESCE(fa.custodian, '')) LIKE '%TD AMERITRADE%'
  )                                                   AS is_portable_custodian,
  (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')  AS is_independent_ria,
  (COALESCE(frc.rep_count, 1) <= 3)                   AS is_solo_micro_firm,
  (COALESCE(ad.accolade_count, 0) > 0)                AS has_any_accolade,
  COALESCE(ad.forbes_count, 0)                        AS forbes_accolade_count,
  COALESCE(ad.barrons_count, 0)                       AS barrons_accolade_count,
  (
    COALESCE(c.CONTACT_HAS_DISCLOSED_BANKRUPT, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_CRIMINAL, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_REGULATORY_EVENT, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_TERMINATION, FALSE)
  )                                                   AS has_any_disclosure
FROM control_spine cs
JOIN `savvy-gtm-analytics.FinTrx_data.ria_contacts_current` c
  ON c.RIA_CONTACT_CRD_ID = cs.crd
LEFT JOIN firm_aum_data  fa  ON fa.firm_crd  = cs.firm_crd
LEFT JOIN `savvy-gtm-analytics.FinTrx_data.ria_firms_current` f
  ON f.CRD_ID = cs.firm_crd
LEFT JOIN firm_rep_count frc ON frc.firm_crd = cs.firm_crd
LEFT JOIN tenure_data    td  ON td.crd        = cs.crd
LEFT JOIN state_reg_data srd ON srd.crd        = cs.crd
LEFT JOIN accolade_data  ad  ON ad.crd         = cs.crd
;


-- ============================================================
-- STEP 3: SIGNAL DISCRIMINATION COMPARISON
-- Run this AFTER both tables above are built.
-- Produces a ranked table of which features best separate
-- the labeled $40M–$100M cohort from the general population.
--
-- For continuous features: compare means and medians
-- For binary features: compare rates and compute lift ratio
-- Discrimination score = ABS(labeled_rate - control_rate)
--   for binary; standardized difference for continuous.
-- ============================================================

WITH

-- ── Binary feature comparison ────────────────────────────────
binary_signals AS (
  SELECT
    feature_name,
    labeled_rate,
    control_rate,
    ROUND(labeled_rate - control_rate, 3)             AS rate_delta,
    ROUND(SAFE_DIVIDE(labeled_rate, NULLIF(control_rate, 0)), 2)
                                                      AS lift_ratio,
    ABS(labeled_rate - control_rate)                  AS discrimination_score
  FROM (
    SELECT
      'is_solo_micro_firm'                            AS feature_name,
      AVG(IF(group_label='LABELED', IF(is_solo_micro_firm,  1.0,0.0), NULL)) AS labeled_rate,
      AVG(IF(group_label='CONTROL', IF(is_solo_micro_firm,  1.0,0.0), NULL)) AS control_rate
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL
          SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)

    UNION ALL SELECT 'is_series_65_only',
      AVG(IF(group_label='LABELED', IF(is_series_65_only,   1.0,0.0), NULL)),
      AVG(IF(group_label='CONTROL', IF(is_series_65_only,   1.0,0.0), NULL))
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)

    UNION ALL SELECT 'has_series_7',
      AVG(IF(group_label='LABELED', IF(has_series_7,        1.0,0.0), NULL)),
      AVG(IF(group_label='CONTROL', IF(has_series_7,        1.0,0.0), NULL))
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)

    UNION ALL SELECT 'has_cfp',
      AVG(IF(group_label='LABELED', IF(has_cfp,             1.0,0.0), NULL)),
      AVG(IF(group_label='CONTROL', IF(has_cfp,             1.0,0.0), NULL))
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)

    UNION ALL SELECT 'has_cfa',
      AVG(IF(group_label='LABELED', IF(has_cfa,             1.0,0.0), NULL)),
      AVG(IF(group_label='CONTROL', IF(has_cfa,             1.0,0.0), NULL))
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)

    UNION ALL SELECT 'is_independent_ria',
      AVG(IF(group_label='LABELED', IF(is_independent_ria,  1.0,0.0), NULL)),
      AVG(IF(group_label='CONTROL', IF(is_independent_ria,  1.0,0.0), NULL))
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)

    UNION ALL SELECT 'has_ownership',
      AVG(IF(group_label='LABELED', IF(has_ownership,       1.0,0.0), NULL)),
      AVG(IF(group_label='CONTROL', IF(has_ownership,       1.0,0.0), NULL))
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)

    UNION ALL SELECT 'is_portable_custodian',
      AVG(IF(group_label='LABELED', IF(is_portable_custodian,1.0,0.0), NULL)),
      AVG(IF(group_label='CONTROL', IF(is_portable_custodian,1.0,0.0), NULL))
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)

    UNION ALL SELECT 'has_any_accolade',
      AVG(IF(group_label='LABELED', IF(has_any_accolade,    1.0,0.0), NULL)),
      AVG(IF(group_label='CONTROL', IF(has_any_accolade,    1.0,0.0), NULL))
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)

    UNION ALL SELECT 'has_any_disclosure',
      AVG(IF(group_label='LABELED', IF(has_any_disclosure,  1.0,0.0), NULL)),
      AVG(IF(group_label='CONTROL', IF(has_any_disclosure,  1.0,0.0), NULL))
    FROM (SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
          UNION ALL SELECT * FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`)
  )
),

-- ── Continuous feature comparison ────────────────────────────
continuous_signals AS (
  SELECT
    feature_name,
    labeled_mean,
    control_mean,
    ROUND(labeled_mean - control_mean, 2)             AS mean_delta,
    -- Standardized difference (Cohen's d approximation):
    -- |delta| / pooled_stddev — >0.5 = meaningful separation
    ROUND(
      SAFE_DIVIDE(
        ABS(labeled_mean - control_mean),
        NULLIF((labeled_stddev + control_stddev) / 2.0, 0)
      ), 3
    )                                                 AS std_discrimination_score,
    labeled_median,
    control_median,
    ROUND(labeled_median - control_median, 2)         AS median_delta
  FROM (
    SELECT
      feature_name,
      AVG(IF(group_label='LABELED', val, NULL))                           AS labeled_mean,
      STDDEV(IF(group_label='LABELED', val, NULL))                        AS labeled_stddev,
      AVG(IF(group_label='CONTROL', val, NULL))                           AS control_mean,
      STDDEV(IF(group_label='CONTROL', val, NULL))                        AS control_stddev,
      APPROX_QUANTILES(IF(group_label='LABELED', val, NULL), 2)[OFFSET(1)] AS labeled_median,
      APPROX_QUANTILES(IF(group_label='CONTROL', val, NULL), 2)[OFFSET(1)] AS control_median
    FROM (
      -- firm_rep_count
      SELECT group_label, 'firm_rep_count' AS feature_name, CAST(firm_rep_count AS FLOAT64) AS val
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'firm_rep_count', CAST(firm_rep_count AS FLOAT64)
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
      -- firm_aum_current (in $M for readability)
      UNION ALL SELECT group_label, 'firm_aum_current_M', firm_aum_current / 1e6
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'firm_aum_current_M', firm_aum_current / 1e6
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
      -- firm_aum_per_rep (in $M)
      UNION ALL SELECT group_label, 'firm_aum_per_rep_M', firm_aum_per_rep / 1e6
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'firm_aum_per_rep_M', firm_aum_per_rep / 1e6
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
      -- firm_disc_ratio
      UNION ALL SELECT group_label, 'firm_disc_ratio', firm_disc_ratio
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'firm_disc_ratio', firm_disc_ratio
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
      -- firm_hnw_ratio
      UNION ALL SELECT group_label, 'firm_hnw_ratio', firm_hnw_ratio
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'firm_hnw_ratio', firm_hnw_ratio
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
      -- industry_tenure_years
      UNION ALL SELECT group_label, 'industry_tenure_years', industry_tenure_years
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'industry_tenure_years', industry_tenure_years
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
      -- tenure_at_firm_years
      UNION ALL SELECT group_label, 'tenure_at_firm_years', tenure_at_firm_years
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'tenure_at_firm_years', tenure_at_firm_years
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
      -- prior_firm_count
      UNION ALL SELECT group_label, 'prior_firm_count', CAST(prior_firm_count AS FLOAT64)
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'prior_firm_count', CAST(prior_firm_count AS FLOAT64)
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
      -- license_count
      UNION ALL SELECT group_label, 'license_count', CAST(license_count AS FLOAT64)
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'license_count', CAST(license_count AS FLOAT64)
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
      -- state_reg_count
      UNION ALL SELECT group_label, 'state_reg_count', CAST(state_reg_count AS FLOAT64)
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
      UNION ALL SELECT group_label, 'state_reg_count', CAST(state_reg_count AS FLOAT64)
      FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
    )
    GROUP BY feature_name
  )
)

-- ── Final ranked output ──────────────────────────────────────
-- Binary features ranked by discrimination score
SELECT
  'BINARY'                                            AS feature_type,
  feature_name,
  ROUND(labeled_rate * 100, 1)                        AS labeled_pct,
  ROUND(control_rate * 100, 1)                        AS control_pct,
  ROUND(rate_delta * 100, 1)                          AS delta_pct_points,
  lift_ratio,
  ROUND(discrimination_score * 100, 1)                AS discrimination_score,
  CAST(NULL AS FLOAT64)                               AS labeled_mean,
  CAST(NULL AS FLOAT64)                               AS control_mean,
  CAST(NULL AS FLOAT64)                               AS std_discrimination
FROM binary_signals

UNION ALL

-- Continuous features ranked by standardized discrimination score
SELECT
  'CONTINUOUS'                                        AS feature_type,
  feature_name,
  CAST(NULL AS FLOAT64)                               AS labeled_pct,
  CAST(NULL AS FLOAT64)                               AS control_pct,
  CAST(NULL AS FLOAT64)                               AS delta_pct_points,
  CAST(NULL AS FLOAT64)                               AS lift_ratio,
  ROUND(std_discrimination_score * 100, 1)            AS discrimination_score,
  ROUND(labeled_mean, 2)                              AS labeled_mean,
  ROUND(control_mean, 2)                              AS control_mean,
  std_discrimination_score                            AS std_discrimination
FROM continuous_signals

ORDER BY discrimination_score DESC
;


-- ============================================================
-- STEP 4: FIRM AUM / REP COUNT DISTRIBUTION DEEP DIVE
-- Run this separately to specifically evaluate whether the
-- divisor proxy (F03) produces a usable AUM band estimate.
-- If the labeled cohort clusters tightly in a $20M–$90M per-rep
-- range while the control group is spread wide, it's usable.
-- ============================================================
SELECT
  group_label,
  COUNT(*)                                            AS n,
  ROUND(AVG(firm_aum_per_rep) / 1e6, 1)              AS mean_aum_per_rep_M,
  ROUND(APPROX_QUANTILES(firm_aum_per_rep, 4)[OFFSET(1)] / 1e6, 1) AS p25_M,
  ROUND(APPROX_QUANTILES(firm_aum_per_rep, 4)[OFFSET(2)] / 1e6, 1) AS median_M,
  ROUND(APPROX_QUANTILES(firm_aum_per_rep, 4)[OFFSET(3)] / 1e6, 1) AS p75_M,
  ROUND(APPROX_QUANTILES(firm_aum_per_rep, 100)[OFFSET(10)] / 1e6, 1) AS p10_M,
  ROUND(APPROX_QUANTILES(firm_aum_per_rep, 100)[OFFSET(90)] / 1e6, 1) AS p90_M,
  -- % of group that falls in the $15M–$120M per-rep range
  -- (the plausible $40M–$100M advisor band with some margin)
  ROUND(
    COUNTIF(firm_aum_per_rep BETWEEN 15000000 AND 120000000)
    * 100.0 / COUNT(*), 1
  )                                                   AS pct_in_proxy_band
FROM (
  SELECT group_label, firm_aum_per_rep
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
  WHERE firm_aum_per_rep IS NOT NULL
  UNION ALL
  SELECT group_label, firm_aum_per_rep
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
  WHERE firm_aum_per_rep IS NOT NULL
)
GROUP BY group_label
ORDER BY group_label
;
