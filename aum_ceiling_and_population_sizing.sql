-- ============================================================
-- CEILING COMPARISON + POPULATION SIZING
-- Two independent analyses in one file
--
-- ANALYSIS A: >$100M vs $40M–$100M Signal Comparison
--   Identifies which FINTRX signals indicate an advisor has
--   CROSSED $100M — so we can exclude them from targeting.
--   Method: same labeled-vs-labeled comparison as V2 but
--   using confirmed >$100M SFDC opps as the "high" cohort.
--
-- ANALYSIS B: Population Sizing
--   Counts how many FINTRX advisors currently pass the
--   Enhanced proxy criteria from V2, excluding the existing
--   pipeline. Tells us if the tier is viable at volume.
--
-- Prerequisites:
--   • ml_features.aum_40_100m_signal_profile (Phase 1 output)
--   • ml_features.aum_proxy_labeled_features (V2 Step 1 output)
--   • SavvyGTMData.Opportunity, SavvyGTMData.Lead accessible
-- ============================================================


-- ============================================================
-- ANALYSIS A — STEP A1: BUILD >$100M LABELED COHORT
-- Pull all SFDC opps with Underwritten_AUM__c or Amount > $100M
-- (no upper cap — we want everyone confirmed above the ceiling)
-- One row per CRD, most recent opp as anchor.
-- ============================================================
CREATE OR REPLACE TABLE `savvy-gtm-analytics.ml_features.aum_ceiling_labeled_features` AS

WITH

high_aum_spine AS (
  SELECT
    SAFE_CAST(
      ROUND(SAFE_CAST(o.FA_CRD__c AS FLOAT64), 0)
    AS INT64)                                           AS crd,
    MAX(DATE(o.CreatedDate))                            AS anchor_date,
    MAX(COALESCE(o.Underwritten_AUM__c, o.Amount))      AS sfdc_aum
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE (o.IsDeleted IS NULL OR o.IsDeleted = FALSE)
    AND COALESCE(o.Underwritten_AUM__c, o.Amount) > 100000000
    AND SAFE_CAST(
          ROUND(SAFE_CAST(o.FA_CRD__c AS FLOAT64), 0)
        AS INT64) IS NOT NULL
    -- Exclude anyone who also appears in the $40M–$100M cohort
    -- (some advisors may have multiple opps across the boundary)
    AND SAFE_CAST(
          ROUND(SAFE_CAST(o.FA_CRD__c AS FLOAT64), 0)
        AS INT64) NOT IN (
          SELECT DISTINCT crd
          FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
          WHERE crd IS NOT NULL
        )
  GROUP BY 1
),

firm_rep_count AS (
  SELECT
    PRIMARY_FIRM                                        AS firm_crd,
    COUNT(DISTINCT RIA_CONTACT_CRD_ID)                  AS rep_count
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`
  WHERE PRIMARY_FIRM IS NOT NULL
    AND PRODUCING_ADVISOR = 'true'
  GROUP BY PRIMARY_FIRM
),

firm_aum_data AS (
  SELECT
    CRD_ID                                              AS firm_crd,
    SAFE_CAST(TOTAL_AUM AS INT64)                       AS TOTAL_AUM,
    SAFE_CAST(DISCRETIONARY_AUM AS INT64)               AS DISCRETIONARY_AUM,
    SAFE_CAST(AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64) AS hnw_aum,
    CUSTODIAN_PRIMARY_BUSINESS_NAME                     AS custodian
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`
),

state_reg_data AS (
  SELECT
    contact_crd_id                                      AS crd,
    COUNT(DISTINCT registerations_regulator)            AS state_reg_count
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_state_registrations_historicals`
  WHERE active = TRUE
  GROUP BY contact_crd_id
),

accolade_data AS (
  SELECT
    RIA_CONTACT_CRD_ID                                  AS crd,
    COUNT(*)                                            AS accolade_count,
    COUNTIF(UPPER(OUTLET) LIKE '%FORBES%')              AS forbes_count,
    COUNTIF(UPPER(OUTLET) LIKE '%BARRON%')              AS barrons_count
  FROM `savvy-gtm-analytics.FinTrx_data_CA.contact_accolades_historicals`
  GROUP BY RIA_CONTACT_CRD_ID
)

SELECT
  hs.crd,
  c.PRIMARY_FIRM                                        AS firm_crd,
  '>$100M'                                              AS group_label,
  hs.sfdc_aum,

  -- Firm size
  COALESCE(frc.rep_count, 1)                            AS firm_rep_count,
  fa.TOTAL_AUM                                          AS firm_aum_current,
  SAFE_DIVIDE(fa.TOTAL_AUM, NULLIF(COALESCE(frc.rep_count,1), 0))
                                                        AS firm_aum_per_rep,
  SAFE_DIVIDE(fa.DISCRETIONARY_AUM, NULLIF(fa.TOTAL_AUM, 0))
                                                        AS firm_disc_ratio,
  SAFE_DIVIDE(fa.hnw_aum, NULLIF(fa.TOTAL_AUM, 0))     AS firm_hnw_ratio,
  CASE
    WHEN fa.TOTAL_AUM IS NULL             THEN 'Unknown'
    WHEN fa.TOTAL_AUM < 50000000          THEN 'Under $50M'
    WHEN fa.TOTAL_AUM < 100000000         THEN '$50M–$100M'
    WHEN fa.TOTAL_AUM < 250000000         THEN '$100M–$250M'
    WHEN fa.TOTAL_AUM < 500000000         THEN '$250M–$500M'
    WHEN fa.TOTAL_AUM < 1000000000        THEN '$500M–$1B'
    WHEN fa.TOTAL_AUM < 5000000000        THEN '$1B–$5B'
    ELSE '$5B+'
  END                                                   AS firm_aum_bucket,

  -- Career stage
  SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0  AS industry_tenure_years,
  CASE
    WHEN SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) IS NULL  THEN 'Unknown'
    WHEN SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) < 84     THEN 'Early (<7yr)'
    WHEN SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) < 180    THEN 'Mid (7–15yr)'
    WHEN SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) < 300    THEN 'Peak (15–25yr)'
    ELSE 'Late (25+yr)'
  END                                                   AS experience_bucket,

  -- Licenses
  (c.REP_LICENSES LIKE '%Series 65%'
   AND c.REP_LICENSES NOT LIKE '%Series 7%')            AS is_series_65_only,
  (c.REP_LICENSES LIKE '%Series 7%')                    AS has_series_7,
  COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0)
                                                        AS license_count,

  -- Practice signals
  COALESCE(srd.state_reg_count, 0)                      AS state_reg_count,
  (c.CONTACT_OWNERSHIP_PERCENTAGE IS NOT NULL
   AND c.CONTACT_OWNERSHIP_PERCENTAGE NOT LIKE '%No Ownership%')
                                                        AS has_ownership,
  (
    UPPER(COALESCE(fa.custodian,'')) LIKE '%SCHWAB%'
    OR UPPER(COALESCE(fa.custodian,'')) LIKE '%FIDELITY%'
    OR UPPER(COALESCE(fa.custodian,'')) LIKE '%PERSHING%'
    OR UPPER(COALESCE(fa.custodian,'')) LIKE '%TD AMERITRADE%'
  )                                                     AS is_portable_custodian,

  -- Firm type
  (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')    AS is_independent_ria,
  (COALESCE(frc.rep_count, 1) <= 3)                     AS is_solo_micro_firm,

  -- Accolades — key for ceiling detection
  -- Barron's Top 1200 requires substantially more AUM than Forbes Next Gen
  COALESCE(ad.accolade_count, 0)                        AS accolade_count,
  COALESCE(ad.forbes_count, 0)                          AS forbes_count,
  COALESCE(ad.barrons_count, 0)                         AS barrons_count,
  (COALESCE(ad.accolade_count, 0) > 0)                  AS has_any_accolade,
  (COALESCE(ad.barrons_count, 0) > 0)                   AS has_barrons_accolade,
  (COALESCE(ad.forbes_count, 0) > 0
   AND COALESCE(ad.barrons_count, 0) = 0)               AS has_forbes_not_barrons,

  -- Disclosure
  (
    COALESCE(c.CONTACT_HAS_DISCLOSED_BANKRUPT, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_CRIMINAL, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_REGULATORY_EVENT, FALSE)
    OR COALESCE(c.CONTACT_HAS_DISCLOSED_TERMINATION, FALSE)
  )                                                     AS has_any_disclosure,

  -- AUM band of the sfdc opp (for internal reference)
  CASE
    WHEN hs.sfdc_aum < 250000000   THEN '$100M–$250M'
    WHEN hs.sfdc_aum < 500000000   THEN '$250M–$500M'
    WHEN hs.sfdc_aum < 1000000000  THEN '$500M–$1B'
    ELSE '$1B+'
  END                                                   AS sfdc_aum_band

FROM high_aum_spine hs
JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  ON c.RIA_CONTACT_CRD_ID = hs.crd
LEFT JOIN firm_aum_data  fa  ON fa.firm_crd  = c.PRIMARY_FIRM
LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
  ON f.CRD_ID = c.PRIMARY_FIRM
LEFT JOIN firm_rep_count frc ON frc.firm_crd = c.PRIMARY_FIRM
LEFT JOIN state_reg_data srd ON srd.crd      = hs.crd
LEFT JOIN accolade_data  ad  ON ad.crd       = hs.crd
;


-- ============================================================
-- ANALYSIS A — STEP A2: THREE-WAY SIGNAL COMPARISON
-- Compare $40M–$100M vs >$100M vs Control across all features.
-- Run AFTER Step A1 completes.
-- This is the key output — look for features where:
--   >$100M differs FROM $40M–$100M (ceiling signal)
--   $40M–$100M differs FROM Control (floor/target signal)
-- ============================================================
WITH combined AS (
  -- $40M–$100M labeled (from V2)
  SELECT
    '$40M–$100M'    AS group_label,
    firm_rep_count,
    firm_aum_current / 1e6                              AS firm_aum_M,
    firm_disc_ratio,
    firm_hnw_ratio,
    CAST(license_count AS FLOAT64)                      AS license_count,
    industry_tenure_years,
    state_reg_count,
    CAST(is_series_65_only AS INT64)                    AS is_series_65_only,
    CAST(has_series_7 AS INT64)                         AS has_series_7,
    CAST(is_independent_ria AS INT64)                   AS is_independent_ria,
    CAST(is_solo_micro_firm AS INT64)                   AS is_solo_micro_firm,
    CAST(is_portable_custodian AS INT64)                AS is_portable_custodian,
    CAST(has_ownership AS INT64)                        AS has_ownership,
    CAST(has_any_accolade AS INT64)                     AS has_any_accolade,
    CAST(0 AS INT64)                                    AS has_barrons_accolade,
    CAST(0 AS INT64)                                    AS has_forbes_not_barrons
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`

  UNION ALL

  -- >$100M labeled (new)
  SELECT
    '>$100M'        AS group_label,
    firm_rep_count,
    firm_aum_current / 1e6,
    firm_disc_ratio,
    firm_hnw_ratio,
    CAST(license_count AS FLOAT64),
    industry_tenure_years,
    state_reg_count,
    CAST(is_series_65_only AS INT64),
    CAST(has_series_7 AS INT64),
    CAST(is_independent_ria AS INT64),
    CAST(is_solo_micro_firm AS INT64),
    CAST(is_portable_custodian AS INT64),
    CAST(has_ownership AS INT64),
    CAST(has_any_accolade AS INT64),
    CAST(has_barrons_accolade AS INT64),
    CAST(has_forbes_not_barrons AS INT64)
  FROM `savvy-gtm-analytics.ml_features.aum_ceiling_labeled_features`

  UNION ALL

  -- Control (from V2)
  SELECT
    'Control'       AS group_label,
    firm_rep_count,
    firm_aum_current / 1e6,
    firm_disc_ratio,
    firm_hnw_ratio,
    CAST(license_count AS FLOAT64),
    industry_tenure_years,
    state_reg_count,
    CAST(is_series_65_only AS INT64),
    CAST(has_series_7 AS INT64),
    CAST(is_independent_ria AS INT64),
    CAST(is_solo_micro_firm AS INT64),
    CAST(is_portable_custodian AS INT64),
    CAST(has_ownership AS INT64),
    CAST(has_any_accolade AS INT64),
    CAST(0 AS INT64),
    CAST(0 AS INT64)
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features`
)

SELECT
  group_label,
  COUNT(*)                                              AS n,

  -- Firm size
  ROUND(AVG(firm_rep_count), 0)                         AS avg_firm_rep_count,
  ROUND(APPROX_QUANTILES(firm_rep_count, 2)[OFFSET(1)], 0) AS median_firm_rep_count,
  ROUND(AVG(firm_aum_M), 0)                             AS avg_firm_aum_M,
  ROUND(APPROX_QUANTILES(firm_aum_M, 2)[OFFSET(1)], 0) AS median_firm_aum_M,

  -- Practice quality
  ROUND(AVG(firm_disc_ratio), 3)                        AS avg_disc_ratio,
  ROUND(AVG(firm_hnw_ratio), 3)                         AS avg_hnw_ratio,

  -- Career stage
  ROUND(AVG(industry_tenure_years), 1)                  AS avg_tenure_years,
  ROUND(APPROX_QUANTILES(industry_tenure_years, 2)[OFFSET(1)], 1)
                                                        AS median_tenure_years,
  -- License profile
  ROUND(AVG(license_count), 2)                          AS avg_license_count,
  ROUND(AVG(is_series_65_only) * 100, 1)                AS pct_series_65_only,
  ROUND(AVG(has_series_7) * 100, 1)                     AS pct_has_series_7,

  -- Firm type & custodian
  ROUND(AVG(is_independent_ria) * 100, 1)               AS pct_independent_ria,
  ROUND(AVG(is_solo_micro_firm) * 100, 1)               AS pct_solo_micro,
  ROUND(AVG(is_portable_custodian) * 100, 1)            AS pct_portable_custodian,
  ROUND(AVG(has_ownership) * 100, 1)                    AS pct_has_ownership,

  -- Accolades (key ceiling signal)
  ROUND(AVG(has_any_accolade) * 100, 1)                 AS pct_any_accolade,
  ROUND(AVG(has_barrons_accolade) * 100, 1)             AS pct_barrons,
  ROUND(AVG(has_forbes_not_barrons) * 100, 1)           AS pct_forbes_not_barrons

FROM combined
GROUP BY group_label
ORDER BY
  CASE group_label
    WHEN '$40M–$100M' THEN 1
    WHEN '>$100M'     THEN 2
    WHEN 'Control'    THEN 3
  END
;


-- ============================================================
-- ANALYSIS A — STEP A3: CEILING SIGNAL DELTA TABLE
-- Which features are MOST DIFFERENT between $40M–$100M and >$100M?
-- These are your ceiling exclusion criteria.
-- Run after Step A2.
-- ============================================================
WITH
mid_stats AS (
  SELECT
    AVG(CAST(is_series_65_only AS FLOAT64))   AS is_series_65_only,
    AVG(CAST(has_series_7 AS FLOAT64))        AS has_series_7,
    AVG(CAST(is_independent_ria AS FLOAT64))  AS is_independent_ria,
    AVG(CAST(is_solo_micro_firm AS FLOAT64))  AS is_solo_micro_firm,
    AVG(CAST(is_portable_custodian AS FLOAT64)) AS is_portable_custodian,
    AVG(CAST(has_ownership AS FLOAT64))       AS has_ownership,
    AVG(CAST(has_any_accolade AS FLOAT64))    AS has_any_accolade,
    AVG(CAST(license_count AS FLOAT64))       AS license_count,
    AVG(firm_hnw_ratio)                       AS firm_hnw_ratio,
    AVG(firm_disc_ratio)                      AS firm_disc_ratio,
    AVG(industry_tenure_years)                AS industry_tenure_years,
    AVG(CAST(firm_rep_count AS FLOAT64))      AS firm_rep_count,
    AVG(firm_aum_current / 1e6)               AS firm_aum_M
  FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features`
),
high_stats AS (
  SELECT
    AVG(CAST(is_series_65_only AS FLOAT64))   AS is_series_65_only,
    AVG(CAST(has_series_7 AS FLOAT64))        AS has_series_7,
    AVG(CAST(is_independent_ria AS FLOAT64))  AS is_independent_ria,
    AVG(CAST(is_solo_micro_firm AS FLOAT64))  AS is_solo_micro_firm,
    AVG(CAST(is_portable_custodian AS FLOAT64)) AS is_portable_custodian,
    AVG(CAST(has_ownership AS FLOAT64))       AS has_ownership,
    AVG(CAST(has_any_accolade AS FLOAT64))    AS has_any_accolade,
    AVG(CAST(license_count AS FLOAT64))       AS license_count,
    AVG(firm_hnw_ratio)                       AS firm_hnw_ratio,
    AVG(firm_disc_ratio)                      AS firm_disc_ratio,
    AVG(industry_tenure_years)                AS industry_tenure_years,
    AVG(CAST(firm_rep_count AS FLOAT64))      AS firm_rep_count,
    AVG(firm_aum_current / 1e6)               AS firm_aum_M
  FROM `savvy-gtm-analytics.ml_features.aum_ceiling_labeled_features`
)

SELECT
  feature,
  ROUND(mid_val, 3)                                     AS mid_aum_value,
  ROUND(high_val, 3)                                    AS high_aum_value,
  ROUND(high_val - mid_val, 3)                          AS delta_high_minus_mid,
  CASE
    WHEN ABS(high_val - mid_val) < 0.01 THEN 'No difference'
    WHEN high_val > mid_val             THEN 'Higher in >$100M'
    ELSE                                     'Lower in >$100M'
  END                                                   AS direction,
  -- If higher in >$100M: this signal could be used to EXCLUDE ceiling advisors
  -- If lower in >$100M: this signal could be used to FLOOR-qualify mid advisors
  CASE
    WHEN ABS(high_val - mid_val) >= 0.15 THEN 'Strong ceiling signal'
    WHEN ABS(high_val - mid_val) >= 0.05 THEN 'Moderate ceiling signal'
    ELSE                                      'Weak — skip'
  END                                                   AS ceiling_signal_strength
FROM (
  SELECT 'is_series_65_only'   AS feature, m.is_series_65_only   AS mid_val, h.is_series_65_only   AS high_val FROM mid_stats m, high_stats h
  UNION ALL SELECT 'has_series_7',          m.has_series_7,          h.has_series_7          FROM mid_stats m, high_stats h
  UNION ALL SELECT 'is_independent_ria',    m.is_independent_ria,    h.is_independent_ria    FROM mid_stats m, high_stats h
  UNION ALL SELECT 'is_solo_micro_firm',    m.is_solo_micro_firm,    h.is_solo_micro_firm    FROM mid_stats m, high_stats h
  UNION ALL SELECT 'is_portable_custodian', m.is_portable_custodian, h.is_portable_custodian FROM mid_stats m, high_stats h
  UNION ALL SELECT 'has_ownership',         m.has_ownership,         h.has_ownership         FROM mid_stats m, high_stats h
  UNION ALL SELECT 'has_any_accolade',      m.has_any_accolade,      h.has_any_accolade      FROM mid_stats m, high_stats h
  UNION ALL SELECT 'license_count',         m.license_count,         h.license_count         FROM mid_stats m, high_stats h
  UNION ALL SELECT 'firm_hnw_ratio',        m.firm_hnw_ratio,        h.firm_hnw_ratio        FROM mid_stats m, high_stats h
  UNION ALL SELECT 'firm_disc_ratio',       m.firm_disc_ratio,       h.firm_disc_ratio       FROM mid_stats m, high_stats h
  UNION ALL SELECT 'industry_tenure_years', m.industry_tenure_years, h.industry_tenure_years FROM mid_stats m, high_stats h
  UNION ALL SELECT 'firm_rep_count',        m.firm_rep_count,        h.firm_rep_count        FROM mid_stats m, high_stats h
  UNION ALL SELECT 'firm_aum_M',            m.firm_aum_M,            h.firm_aum_M            FROM mid_stats m, high_stats h
)
ORDER BY ABS(delta_high_minus_mid) DESC
;


-- ============================================================
-- ANALYSIS B — POPULATION SIZING
-- How many FINTRX advisors currently pass the Enhanced proxy
-- criteria from V2, and are not already in the pipeline?
--
-- Enhanced criteria (V2 recommendation):
--   (is_independent_ria OR (is_portable_custodian AND NOT has_series_7))
--   AND firm_disc_ratio > 0.70
--   AND firm_hnw_ratio > 0.30 (note: guide used 0.40, testing 0.30 for volume)
--   AND license_count < 3
--   AND industry_tenure_years BETWEEN 7 AND 25
--
-- We test THREE threshold variants to show volume sensitivity.
-- Run this AFTER Analysis A — it uses the ceiling signals
-- discovered in A3 to add ceiling exclusion criteria.
-- ============================================================
WITH

-- All CRDs already in SFDC pipeline (leads + opps)
sfdc_crds AS (
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64) AS crd
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE FA_CRD__c IS NOT NULL
  UNION DISTINCT
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64) AS crd
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE FA_CRD__c IS NOT NULL
),

excluded_firms AS (
  SELECT firm_crd FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

-- Full FINTRX producing advisor universe with features
fintrx_universe AS (
  SELECT
    c.RIA_CONTACT_CRD_ID                                AS crd,
    c.PRIMARY_FIRM                                      AS firm_crd,
    COALESCE(
      (SELECT COUNT(DISTINCT c2.RIA_CONTACT_CRD_ID)
       FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c2
       WHERE c2.PRIMARY_FIRM = c.PRIMARY_FIRM
         AND c2.PRODUCING_ADVISOR = 'true'), 1
    )                                                   AS firm_rep_count,
    SAFE_CAST(f.TOTAL_AUM AS INT64)                     AS firm_aum,
    SAFE_CAST(f.DISCRETIONARY_AUM AS INT64)             AS firm_disc_aum,
    SAFE_DIVIDE(
      SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    )                                                   AS firm_disc_ratio,
    SAFE_DIVIDE(
      SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    )                                                   AS firm_hnw_ratio,
    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0 AS industry_tenure_years,
    COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0)
                                                        AS license_count,
    (c.REP_LICENSES LIKE '%Series 7%')                  AS has_series_7,
    (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')  AS is_independent_ria,
    (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')        AS is_wirehouse,
    (
      UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%SCHWAB%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%FIDELITY%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%PERSHING%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%TD AMERITRADE%'
    )                                                   AS is_portable_custodian
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
    ON f.CRD_ID = c.PRIMARY_FIRM
  WHERE c.PRODUCING_ADVISOR = 'true'
    AND c.PRIMARY_FIRM IS NOT NULL
    -- Standard exclusions
    AND c.PRIMARY_FIRM NOT IN (SELECT firm_crd FROM excluded_firms)
    AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
    -- Not already in pipeline
    AND c.RIA_CONTACT_CRD_ID NOT IN (SELECT crd FROM sfdc_crds WHERE crd IS NOT NULL)
),

-- Apply ceiling exclusion from Analysis A results
-- PLACEHOLDER: after running A3, update this CTE to add ceiling filters
-- e.g., if firm_rep_count > 50 strongly signals >$100M, add that here
-- For now, running without ceiling filter so you can see the before/after delta
sized AS (
  SELECT
    crd,
    firm_rep_count,
    firm_aum,
    firm_disc_ratio,
    firm_hnw_ratio,
    industry_tenure_years,
    license_count,
    has_series_7,
    is_independent_ria,
    is_portable_custodian,

    -- VARIANT 1: Relaxed (highest volume, 60.6% labeled recall from V2)
    (
      (is_independent_ria = TRUE
       OR (is_portable_custodian = TRUE AND has_series_7 = FALSE))
    )                                                   AS passes_relaxed,

    -- VARIANT 2: Enhanced (balanced — 51.1% labeled recall, 3.96x precision)
    (
      (is_independent_ria = TRUE
       OR (is_portable_custodian = TRUE AND has_series_7 = FALSE))
      AND firm_disc_ratio > 0.70
      AND firm_hnw_ratio > 0.30
      AND license_count < 3
    )                                                   AS passes_enhanced,

    -- VARIANT 3: Tight (highest precision — 42% recall, 3.85x)
    (
      is_independent_ria = TRUE
      AND is_portable_custodian = TRUE
      AND has_series_7 = FALSE
      AND firm_disc_ratio > 0.70
      AND firm_hnw_ratio > 0.40
      AND license_count < 3
      AND industry_tenure_years BETWEEN 7 AND 25
    )                                                   AS passes_tight

  FROM fintrx_universe
)

-- Summary: volume at each criteria tier
SELECT
  'Relaxed'                                             AS criteria_variant,
  '(indep_ria OR portable_custodian) with no Series 7'  AS description,
  '60.6% labeled recall / 25.1% control pass'          AS v2_benchmark,
  COUNT(*)                                              AS total_universe,
  COUNTIF(passes_relaxed)                               AS passes_criteria,
  ROUND(COUNTIF(passes_relaxed) * 100.0 / COUNT(*), 1) AS pct_of_universe,
  ROUND(COUNTIF(passes_relaxed) / 12.0, 0)             AS est_monthly_new_prospects
FROM sized

UNION ALL SELECT
  'Enhanced',
  '+ disc_ratio>0.70, hnw_ratio>0.30, license_count<3',
  '51.1% labeled recall / 12.9% control pass',
  COUNT(*),
  COUNTIF(passes_enhanced),
  ROUND(COUNTIF(passes_enhanced) * 100.0 / COUNT(*), 1),
  ROUND(COUNTIF(passes_enhanced) / 12.0, 0)
FROM sized

UNION ALL SELECT
  'Tight',
  '+ tenure 7–25yr, hnw_ratio>0.40, all filters combined',
  '42.0% labeled recall / 10.9% control pass',
  COUNT(*),
  COUNTIF(passes_tight),
  ROUND(COUNTIF(passes_tight) * 100.0 / COUNT(*), 1),
  ROUND(COUNTIF(passes_tight) / 12.0, 0)
FROM sized

ORDER BY 1
;


-- ============================================================
-- ANALYSIS B — STEP B2: BREAKDOWN BY FIRM SIZE BUCKET
-- Of the Enhanced-criteria advisors, what does the firm size
-- distribution look like? Validates that we're not capturing
-- mostly large-firm advisors who won't be $40M–$100M.
-- ============================================================
WITH
excluded_firms AS (
  SELECT firm_crd FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),
sfdc_crds AS (
  SELECT DISTINCT SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64) AS crd
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead` WHERE FA_CRD__c IS NOT NULL
  UNION DISTINCT
  SELECT DISTINCT SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64) AS crd
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` WHERE FA_CRD__c IS NOT NULL
)

SELECT
  CASE
    WHEN SAFE_CAST(f.TOTAL_AUM AS INT64) IS NULL          THEN 'Unknown'
    WHEN SAFE_CAST(f.TOTAL_AUM AS INT64) < 50000000       THEN 'Under $50M'
    WHEN SAFE_CAST(f.TOTAL_AUM AS INT64) < 100000000      THEN '$50M–$100M'
    WHEN SAFE_CAST(f.TOTAL_AUM AS INT64) < 250000000      THEN '$100M–$250M'
    WHEN SAFE_CAST(f.TOTAL_AUM AS INT64) < 500000000      THEN '$250M–$500M'
    WHEN SAFE_CAST(f.TOTAL_AUM AS INT64) < 1000000000     THEN '$500M–$1B'
    WHEN SAFE_CAST(f.TOTAL_AUM AS INT64) < 5000000000     THEN '$1B–$5B'
    ELSE '$5B+'
  END                                                     AS firm_aum_bucket,
  COUNT(*)                                                AS advisor_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1)      AS pct_of_total
FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
  ON f.CRD_ID = c.PRIMARY_FIRM
WHERE c.PRODUCING_ADVISOR = 'true'
  AND c.PRIMARY_FIRM IS NOT NULL
  AND c.PRIMARY_FIRM NOT IN (SELECT firm_crd FROM excluded_firms)
  AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
  AND c.RIA_CONTACT_CRD_ID NOT IN (SELECT crd FROM sfdc_crds WHERE crd IS NOT NULL)
  -- Enhanced criteria
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
GROUP BY 1
ORDER BY
  CASE firm_aum_bucket
    WHEN 'Under $50M'    THEN 1
    WHEN '$50M–$100M'    THEN 2
    WHEN '$100M–$250M'   THEN 3
    WHEN '$250M–$500M'   THEN 4
    WHEN '$500M–$1B'     THEN 5
    WHEN '$1B–$5B'       THEN 6
    WHEN '$5B+'          THEN 7
    ELSE 8
  END
;
