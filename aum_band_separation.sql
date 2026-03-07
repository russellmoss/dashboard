-- ============================================================
-- AUM BAND SEPARATION ANALYSIS
-- Can we distinguish $40-100M from $100-200M advisors?
--
-- BLOCK 1: Rebuild feature tables with V5 methods
--   Patches both V2 labeled tables with tenure_at_firm_years
--   and num_prior_firms from ria_contacts_current.
--   Creates: aum_labeled_40_100m_v5 and aum_control_v5
--
-- BLOCK 2: Full three-way comparison (all features including V5)
--   The definitive test of whether bands are separable.
--
-- BLOCK 3: Sub-band analysis
--   Splits $100-200M into $100-150M and $150-200M.
--   Tests each sub-band against $40-100M separately.
--
-- BLOCK 4: Expanded firm-level features
--   Tests features not in V1-V5: firm age, state registrations,
--   firm disclosure count. May reveal separation not visible
--   in contact-level features.
--
-- BLOCK 5: AUM confidence scoring (fallback)
--   If Blocks 2-4 show no separation, build a logistic-style
--   scoring model using all discriminating signals to estimate
--   P(advisor AUM > $100M). Run only if instructed after
--   reviewing Block 2-4 results.
-- ============================================================


-- ============================================================
-- BLOCK 1A: REBUILD $40-100M LABELED TABLE WITH V5 METHODS
-- Patches aum_proxy_labeled_features with:
--   - tenure_at_firm_years (from PRIMARY_FIRM_START_DATE)
--   - num_prior_firms (from PREVIOUS_REGISTRATION_COMPANY_CRD_IDS)
-- Stores to: ml_features.aum_labeled_40_100m_v5
-- ============================================================
CREATE OR REPLACE TABLE
  `savvy-gtm-analytics.ml_features.aum_labeled_40_100m_v5` AS

WITH v5_fields AS (
  SELECT
    RIA_CONTACT_CRD_ID                                       AS crd,
    CASE
      WHEN PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
        OR TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = '' THEN 0
      ELSE ARRAY_LENGTH(
        SPLIT(TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS), ','))
    END                                                      AS num_prior_firms_v5,
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                                 AS tenure_at_firm_years_v5,
    -- Additional V5 fields for expanded feature set
    SAFE_CAST(PRIMARY_FIRM_EMPLOYEE_COUNT AS INT64)          AS firm_employee_count,
    c.PRIMARY_FIRM                                           AS primary_firm_crd
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
)

SELECT
  lf.*,
  -- Replace V4 null/undercounted fields with V5 values
  v5.num_prior_firms_v5                                      AS num_prior_firms,
  v5.tenure_at_firm_years_v5                                 AS tenure_at_firm_years,
  v5.firm_employee_count,
  '$40M-$100M'                                               AS aum_band
FROM `savvy-gtm-analytics.ml_features.aum_proxy_labeled_features` lf
LEFT JOIN v5_fields v5 ON v5.crd = lf.crd
;


-- ============================================================
-- BLOCK 1B: REBUILD CONTROL TABLE WITH V5 METHODS
-- Patches aum_proxy_control_features with same V5 fields.
-- Stores to: ml_features.aum_control_v5
-- ============================================================
CREATE OR REPLACE TABLE
  `savvy-gtm-analytics.ml_features.aum_control_v5` AS

WITH v5_fields AS (
  SELECT
    RIA_CONTACT_CRD_ID                                       AS crd,
    CASE
      WHEN PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
        OR TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = '' THEN 0
      ELSE ARRAY_LENGTH(
        SPLIT(TRIM(PREVIOUS_REGISTRATION_COMPANY_CRD_IDS), ','))
    END                                                      AS num_prior_firms_v5,
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                                 AS tenure_at_firm_years_v5,
    SAFE_CAST(PRIMARY_FIRM_EMPLOYEE_COUNT AS INT64)          AS firm_employee_count
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
)

SELECT
  cf.*,
  v5.num_prior_firms_v5                                      AS num_prior_firms,
  v5.tenure_at_firm_years_v5                                 AS tenure_at_firm_years,
  v5.firm_employee_count,
  'Control'                                                  AS aum_band
FROM `savvy-gtm-analytics.ml_features.aum_proxy_control_features` cf
LEFT JOIN v5_fields v5 ON v5.crd = cf.crd
;


-- ============================================================
-- BLOCK 1C: VALIDATE REBUILT TABLES
-- ============================================================
SELECT
  'aum_labeled_40_100m_v5'                                   AS table_name,
  COUNT(*)                                                   AS total_rows,
  COUNTIF(tenure_at_firm_years IS NOT NULL)                  AS has_tenure,
  ROUND(COUNTIF(tenure_at_firm_years IS NOT NULL) * 100.0
    / COUNT(*), 1)                                           AS pct_has_tenure,
  COUNTIF(num_prior_firms IS NOT NULL)                       AS has_prior_firms,
  ROUND(AVG(tenure_at_firm_years), 2)                        AS avg_tenure,
  ROUND(AVG(num_prior_firms), 2)                             AS avg_prior_firms
FROM `savvy-gtm-analytics.ml_features.aum_labeled_40_100m_v5`
UNION ALL
SELECT
  'aum_control_v5'                                           AS table_name,
  COUNT(*)                                                   AS total_rows,
  COUNTIF(tenure_at_firm_years IS NOT NULL)                  AS has_tenure,
  ROUND(COUNTIF(tenure_at_firm_years IS NOT NULL) * 100.0
    / COUNT(*), 1)                                           AS pct_has_tenure,
  COUNTIF(num_prior_firms IS NOT NULL)                       AS has_prior_firms,
  ROUND(AVG(tenure_at_firm_years), 2)                        AS avg_tenure,
  ROUND(AVG(num_prior_firms), 2)                             AS avg_prior_firms
FROM `savvy-gtm-analytics.ml_features.aum_control_v5`
UNION ALL
SELECT
  'aum_100_200m_labeled_features'                            AS table_name,
  COUNT(*)                                                   AS total_rows,
  COUNTIF(tenure_at_firm_years IS NOT NULL)                  AS has_tenure,
  ROUND(COUNTIF(tenure_at_firm_years IS NOT NULL) * 100.0
    / COUNT(*), 1)                                           AS pct_has_tenure,
  COUNTIF(num_prior_firms IS NOT NULL)                       AS has_prior_firms,
  ROUND(AVG(tenure_at_firm_years), 2)                        AS avg_tenure,
  ROUND(AVG(num_prior_firms), 2)                             AS avg_prior_firms
FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
;


-- ============================================================
-- BLOCK 2: FULL THREE-WAY COMPARISON (ALL FEATURES)
-- The definitive test. All three groups now have V5 fields.
-- Computes Cohen's d for every continuous feature including
-- the two that were missing from the Block 5 comparison.
-- ============================================================

-- 2A: Continuous features (all groups)
WITH band_40_100 AS (
  SELECT
    '$40M-$100M'                                             AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    num_prior_firms,
    firm_disc_ratio,
    firm_hnw_ratio,
    SAFE_CAST(license_count AS FLOAT64)                      AS license_count,
    firm_aum / 1000000.0                                     AS firm_aum_m,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count
  FROM `savvy-gtm-analytics.ml_features.aum_labeled_40_100m_v5`
),
band_100_200 AS (
  SELECT
    '$100M-$200M'                                            AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    SAFE_CAST(num_prior_firms AS FLOAT64)                    AS num_prior_firms,
    firm_disc_ratio,
    firm_hnw_ratio,
    SAFE_CAST(license_count AS FLOAT64)                      AS license_count,
    firm_aum / 1000000.0                                     AS firm_aum_m,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count
  FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
  WHERE is_closed_lost = 1 OR is_open = 1
),
ctrl AS (
  SELECT
    'Control'                                                AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    SAFE_CAST(num_prior_firms AS FLOAT64)                    AS num_prior_firms,
    firm_disc_ratio,
    firm_hnw_ratio,
    SAFE_CAST(license_count AS FLOAT64)                      AS license_count,
    firm_aum / 1000000.0                                     AS firm_aum_m,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count
  FROM `savvy-gtm-analytics.ml_features.aum_control_v5`
),
combined AS (
  SELECT * FROM band_40_100
  UNION ALL SELECT * FROM band_100_200
  UNION ALL SELECT * FROM ctrl
)
SELECT
  group_label,
  COUNT(*)                                                   AS n,

  -- Industry tenure
  ROUND(AVG(industry_tenure_years), 2)                       AS avg_industry_tenure,
  ROUND(STDDEV(industry_tenure_years), 2)                    AS sd_industry_tenure,
  ROUND(APPROX_QUANTILES(industry_tenure_years, 2)[OFFSET(1)], 1)
                                                             AS median_industry_tenure,

  -- Tenure at current firm (V5 — was NULL in prior comparison)
  ROUND(AVG(tenure_at_firm_years), 2)                        AS avg_firm_tenure,
  ROUND(STDDEV(tenure_at_firm_years), 2)                     AS sd_firm_tenure,
  ROUND(APPROX_QUANTILES(tenure_at_firm_years, 2)[OFFSET(1)], 1)
                                                             AS median_firm_tenure,
  ROUND(COUNTIF(tenure_at_firm_years < 5) * 100.0 / COUNT(*), 1)
                                                             AS pct_tenure_under_5yr,
  ROUND(COUNTIF(tenure_at_firm_years BETWEEN 5 AND 10) * 100.0 / COUNT(*), 1)
                                                             AS pct_tenure_5_10yr,
  ROUND(COUNTIF(tenure_at_firm_years > 10) * 100.0 / COUNT(*), 1)
                                                             AS pct_tenure_over_10yr,

  -- Prior firms (V5 — was 0 in prior comparison)
  ROUND(AVG(num_prior_firms), 2)                             AS avg_prior_firms,
  ROUND(STDDEV(num_prior_firms), 2)                          AS sd_prior_firms,
  ROUND(APPROX_QUANTILES(num_prior_firms, 2)[OFFSET(1)], 1)  AS median_prior_firms,
  ROUND(COUNTIF(num_prior_firms >= 3) * 100.0 / COUNT(*), 1) AS pct_3plus_firms,

  -- Practice quality
  ROUND(AVG(firm_disc_ratio), 3)                             AS avg_disc_ratio,
  ROUND(STDDEV(firm_disc_ratio), 3)                          AS sd_disc_ratio,
  ROUND(AVG(firm_hnw_ratio), 3)                              AS avg_hnw_ratio,
  ROUND(STDDEV(firm_hnw_ratio), 3)                           AS sd_hnw_ratio,

  -- Licenses
  ROUND(AVG(license_count), 2)                               AS avg_license_count,
  ROUND(STDDEV(license_count), 2)                            AS sd_license_count,

  -- Firm size
  ROUND(AVG(firm_aum_m), 0)                                  AS avg_firm_aum_m,
  ROUND(APPROX_QUANTILES(firm_aum_m, 2)[OFFSET(1)], 0)       AS median_firm_aum_m,
  ROUND(AVG(firm_rep_count), 0)                              AS avg_firm_rep_count,
  ROUND(APPROX_QUANTILES(firm_rep_count, 2)[OFFSET(1)], 0)   AS median_firm_rep_count

FROM combined
GROUP BY group_label
ORDER BY group_label
;

-- 2B: Binary features three-way
WITH band_40_100 AS (
  SELECT
    '$40M-$100M'                                             AS group_label,
    is_independent_ria,
    has_portable_custodian,
    has_series_7,
    has_series_65_only,
    has_any_accolade,
    is_solo_micro_firm,
    (num_prior_firms >= 3)                                   AS has_3plus_firms,
    (tenure_at_firm_years < 5)                               AS tenure_under_5yr,
    (tenure_at_firm_years < 10)                              AS tenure_under_10yr,
    (tenure_at_firm_years > 10)                              AS tenure_over_10yr,
    (industry_tenure_years BETWEEN 7 AND 25)                 AS mid_career,
    (firm_aum < 1000000000)                                  AS firm_under_1b,
    (firm_aum BETWEEN 1000000000 AND 3000000000)             AS firm_1b_3b
  FROM `savvy-gtm-analytics.ml_features.aum_labeled_40_100m_v5`
),
band_100_200 AS (
  SELECT
    '$100M-$200M'                                            AS group_label,
    is_independent_ria,
    has_portable_custodian,
    has_series_7,
    has_series_65_only,
    has_any_accolade,
    is_solo_micro_firm,
    (num_prior_firms >= 3)                                   AS has_3plus_firms,
    (tenure_at_firm_years < 5)                               AS tenure_under_5yr,
    (tenure_at_firm_years < 10)                              AS tenure_under_10yr,
    (tenure_at_firm_years > 10)                              AS tenure_over_10yr,
    (industry_tenure_years BETWEEN 7 AND 25)                 AS mid_career,
    (firm_aum < 1000000000)                                  AS firm_under_1b,
    (firm_aum BETWEEN 1000000000 AND 3000000000)             AS firm_1b_3b
  FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
  WHERE is_closed_lost = 1 OR is_open = 1
),
ctrl AS (
  SELECT
    'Control'                                                AS group_label,
    is_independent_ria,
    has_portable_custodian,
    has_series_7,
    has_series_65_only,
    has_any_accolade,
    is_solo_micro_firm,
    (num_prior_firms >= 3)                                   AS has_3plus_firms,
    (tenure_at_firm_years < 5)                               AS tenure_under_5yr,
    (tenure_at_firm_years < 10)                              AS tenure_under_10yr,
    (tenure_at_firm_years > 10)                              AS tenure_over_10yr,
    (industry_tenure_years BETWEEN 7 AND 25)                 AS mid_career,
    (firm_aum < 1000000000)                                  AS firm_under_1b,
    (firm_aum BETWEEN 1000000000 AND 3000000000)             AS firm_1b_3b
  FROM `savvy-gtm-analytics.ml_features.aum_control_v5`
),
combined AS (
  SELECT * FROM band_40_100
  UNION ALL SELECT * FROM band_100_200
  UNION ALL SELECT * FROM ctrl
)
SELECT
  group_label,
  COUNT(*)                                                   AS n,
  ROUND(COUNTIF(is_independent_ria) * 100.0 / COUNT(*), 1)  AS pct_indep_ria,
  ROUND(COUNTIF(has_portable_custodian) * 100.0 / COUNT(*), 1)
                                                             AS pct_portable,
  ROUND(COUNTIF(has_series_7) * 100.0 / COUNT(*), 1)        AS pct_series_7,
  ROUND(COUNTIF(has_series_65_only) * 100.0 / COUNT(*), 1)  AS pct_65_only,
  ROUND(COUNTIF(has_any_accolade) * 100.0 / COUNT(*), 1)    AS pct_accolade,
  ROUND(COUNTIF(is_solo_micro_firm) * 100.0 / COUNT(*), 1)  AS pct_solo_micro,
  ROUND(COUNTIF(has_3plus_firms) * 100.0 / COUNT(*), 1)     AS pct_3plus_firms,
  ROUND(COUNTIF(tenure_under_5yr) * 100.0 / COUNT(*), 1)    AS pct_tenure_u5,
  ROUND(COUNTIF(tenure_under_10yr) * 100.0 / COUNT(*), 1)   AS pct_tenure_u10,
  ROUND(COUNTIF(tenure_over_10yr) * 100.0 / COUNT(*), 1)    AS pct_tenure_o10,
  ROUND(COUNTIF(mid_career) * 100.0 / COUNT(*), 1)          AS pct_mid_career,
  ROUND(COUNTIF(firm_under_1b) * 100.0 / COUNT(*), 1)       AS pct_firm_under_1b,
  ROUND(COUNTIF(firm_1b_3b) * 100.0 / COUNT(*), 1)          AS pct_firm_1b_3b
FROM combined
GROUP BY group_label
ORDER BY group_label
;


-- ============================================================
-- BLOCK 3: SUB-BAND ANALYSIS
-- Split $100-200M into $100-150M and $150-200M.
-- Compares each sub-band to $40-100M directly.
-- Larger AUM advisors ($150-200M) may show cleaner separation.
-- ============================================================

-- 3A: Sub-band continuous features
WITH sub_bands AS (
  SELECT
    CASE
      WHEN max_aum BETWEEN 100000000 AND 150000000 THEN '$100M-$150M'
      WHEN max_aum BETWEEN 150000001 AND 200000000 THEN '$150M-$200M'
    END                                                      AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    SAFE_CAST(num_prior_firms AS FLOAT64)                    AS num_prior_firms,
    firm_disc_ratio,
    firm_hnw_ratio,
    SAFE_CAST(license_count AS FLOAT64)                      AS license_count,
    firm_aum / 1000000.0                                     AS firm_aum_m,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count,
    has_any_accolade
  FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
  WHERE (is_closed_lost = 1 OR is_open = 1)
    AND max_aum IS NOT NULL
),
band_40_100 AS (
  SELECT
    '$40M-$100M'                                             AS group_label,
    industry_tenure_years,
    tenure_at_firm_years,
    SAFE_CAST(num_prior_firms AS FLOAT64)                    AS num_prior_firms,
    firm_disc_ratio,
    firm_hnw_ratio,
    SAFE_CAST(license_count AS FLOAT64)                      AS license_count,
    firm_aum / 1000000.0                                     AS firm_aum_m,
    SAFE_CAST(firm_rep_count AS FLOAT64)                     AS firm_rep_count,
    has_any_accolade
  FROM `savvy-gtm-analytics.ml_features.aum_labeled_40_100m_v5`
),
combined AS (
  SELECT * FROM sub_bands
  UNION ALL SELECT * FROM band_40_100
)
SELECT
  group_label,
  COUNT(*)                                                   AS n,
  ROUND(AVG(industry_tenure_years), 1)                       AS avg_industry_tenure,
  ROUND(STDDEV(industry_tenure_years), 1)                    AS sd_industry_tenure,
  ROUND(AVG(tenure_at_firm_years), 1)                        AS avg_firm_tenure,
  ROUND(STDDEV(tenure_at_firm_years), 1)                     AS sd_firm_tenure,
  ROUND(AVG(num_prior_firms), 2)                             AS avg_prior_firms,
  ROUND(STDDEV(num_prior_firms), 2)                          AS sd_prior_firms,
  ROUND(AVG(firm_disc_ratio), 3)                             AS avg_disc_ratio,
  ROUND(AVG(firm_hnw_ratio), 3)                              AS avg_hnw_ratio,
  ROUND(AVG(license_count), 2)                               AS avg_license_count,
  ROUND(STDDEV(license_count), 2)                            AS sd_license_count,
  ROUND(APPROX_QUANTILES(firm_aum_m, 2)[OFFSET(1)], 0)       AS median_firm_aum_m,
  ROUND(APPROX_QUANTILES(firm_rep_count, 2)[OFFSET(1)], 0)   AS median_firm_rep_count,
  ROUND(COUNTIF(has_any_accolade) * 100.0 / COUNT(*), 1)    AS pct_accolade,
  ROUND(COUNTIF(tenure_at_firm_years > 10) * 100.0 / COUNT(*), 1)
                                                             AS pct_tenure_over_10yr,
  ROUND(COUNTIF(num_prior_firms >= 3) * 100.0 / COUNT(*), 1) AS pct_3plus_firms
FROM combined
GROUP BY group_label
ORDER BY group_label
;

-- 3B: Sub-band Cohen's d matrix
-- Computes pairwise d for each feature across all three groups:
-- $40-100M vs $100-150M, $40-100M vs $150-200M, $100-150M vs $150-200M
WITH stats AS (
  SELECT
    CASE
      WHEN src = '40_100'    THEN '$40M-$100M'
      WHEN src = '100_150'   THEN '$100M-$150M'
      WHEN src = '150_200'   THEN '$150M-$200M'
    END                                                      AS group_label,
    AVG(industry_tenure_years)                               AS mean_ind_tenure,
    STDDEV(industry_tenure_years)                            AS sd_ind_tenure,
    AVG(tenure_at_firm_years)                                AS mean_firm_tenure,
    STDDEV(tenure_at_firm_years)                             AS sd_firm_tenure,
    AVG(SAFE_CAST(num_prior_firms AS FLOAT64))               AS mean_prior_firms,
    STDDEV(SAFE_CAST(num_prior_firms AS FLOAT64))            AS sd_prior_firms,
    AVG(firm_disc_ratio)                                     AS mean_disc,
    STDDEV(firm_disc_ratio)                                  AS sd_disc,
    AVG(firm_hnw_ratio)                                      AS mean_hnw,
    STDDEV(firm_hnw_ratio)                                   AS sd_hnw,
    AVG(SAFE_CAST(license_count AS FLOAT64))                 AS mean_lic,
    STDDEV(SAFE_CAST(license_count AS FLOAT64))              AS sd_lic
  FROM (
    SELECT '40_100' AS src, industry_tenure_years,
      tenure_at_firm_years, num_prior_firms, firm_disc_ratio,
      firm_hnw_ratio, license_count
    FROM `savvy-gtm-analytics.ml_features.aum_labeled_40_100m_v5`
    UNION ALL
    SELECT
      CASE WHEN max_aum <= 150000000 THEN '100_150' ELSE '150_200' END AS src,
      industry_tenure_years, tenure_at_firm_years, num_prior_firms,
      firm_disc_ratio, firm_hnw_ratio, license_count
    FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
    WHERE (is_closed_lost = 1 OR is_open = 1) AND max_aum IS NOT NULL
  )
  GROUP BY 1
)
SELECT
  a.group_label                                              AS group_a,
  b.group_label                                              AS group_b,
  ROUND(ABS(a.mean_ind_tenure - b.mean_ind_tenure) /
    NULLIF((a.sd_ind_tenure + b.sd_ind_tenure) / 2, 0), 3)  AS d_industry_tenure,
  ROUND(ABS(a.mean_firm_tenure - b.mean_firm_tenure) /
    NULLIF((a.sd_firm_tenure + b.sd_firm_tenure) / 2, 0), 3) AS d_firm_tenure,
  ROUND(ABS(a.mean_prior_firms - b.mean_prior_firms) /
    NULLIF((a.sd_prior_firms + b.sd_prior_firms) / 2, 0), 3) AS d_prior_firms,
  ROUND(ABS(a.mean_disc - b.mean_disc) /
    NULLIF((a.sd_disc + b.sd_disc) / 2, 0), 3)              AS d_disc_ratio,
  ROUND(ABS(a.mean_hnw - b.mean_hnw) /
    NULLIF((a.sd_hnw + b.sd_hnw) / 2, 0), 3)                AS d_hnw_ratio,
  ROUND(ABS(a.mean_lic - b.mean_lic) /
    NULLIF((a.sd_lic + b.sd_lic) / 2, 0), 3)                AS d_license_count
FROM stats a
JOIN stats b ON a.group_label < b.group_label
ORDER BY a.group_label
;


-- ============================================================
-- BLOCK 4: EXPANDED FIRM-LEVEL FEATURES
-- Tests features not in any prior analysis:
--   - Firm registration age (how long firm has existed)
--   - Number of states the firm is registered in
--   - Firm-level disclosure count
-- These are from ria_firms_current and have not been tested.
-- ============================================================

-- 4A: Compute expanded firm features for all three groups
WITH firm_features AS (
  SELECT
    f.CRD_ID                                                 AS firm_crd,
    -- Firm age: how long since the firm was registered
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', f.DATE_REGISTERED),
      YEAR
    )                                                        AS firm_age_years,
    -- Number of states firm is registered in
    SAFE_CAST(f.NUM_OF_STATES_REGISTERED AS INT64)           AS num_states_registered,
    -- Firm-level disclosures
    SAFE_CAST(f.NUMBER_OF_DISCLOSURES AS INT64)              AS firm_disclosures,
    -- Primary AUM source type
    f.TYPE_OF_CLIENT                                         AS client_type,
    -- Firm website (proxy for professionalism/marketing)
    (f.WEBSITE IS NOT NULL AND TRIM(f.WEBSITE) != '')        AS has_website,
    -- Number of owners
    SAFE_CAST(f.NUMBER_OF_OWNERS AS INT64)                   AS num_owners
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
),
band_40_100 AS (
  SELECT '$40M-$100M' AS group_label, ff.*
  FROM `savvy-gtm-analytics.ml_features.aum_labeled_40_100m_v5` lf
  JOIN firm_features ff ON ff.firm_crd = lf.firm_crd
),
band_100_200 AS (
  SELECT '$100M-$200M' AS group_label, ff.*
  FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features` lf
  JOIN firm_features ff ON ff.firm_crd = lf.firm_crd
  WHERE lf.is_closed_lost = 1 OR lf.is_open = 1
),
ctrl AS (
  SELECT 'Control' AS group_label, ff.*
  FROM `savvy-gtm-analytics.ml_features.aum_control_v5` cf
  JOIN firm_features ff ON ff.firm_crd = cf.firm_crd
),
combined AS (
  SELECT * FROM band_40_100
  UNION ALL SELECT * FROM band_100_200
  UNION ALL SELECT * FROM ctrl
)
SELECT
  group_label,
  COUNT(*)                                                   AS n,
  -- Firm age
  ROUND(AVG(firm_age_years), 1)                              AS avg_firm_age_yrs,
  ROUND(STDDEV(firm_age_years), 1)                           AS sd_firm_age,
  ROUND(APPROX_QUANTILES(firm_age_years, 2)[OFFSET(1)], 1)   AS median_firm_age,
  -- State registrations
  ROUND(AVG(num_states_registered), 1)                       AS avg_states_registered,
  ROUND(STDDEV(num_states_registered), 1)                    AS sd_states,
  ROUND(APPROX_QUANTILES(num_states_registered, 2)[OFFSET(1)], 0)
                                                             AS median_states,
  -- Firm disclosures
  ROUND(AVG(firm_disclosures), 2)                            AS avg_firm_disclosures,
  ROUND(COUNTIF(firm_disclosures = 0) * 100.0 / COUNT(*), 1) AS pct_clean_record,
  -- Owners
  ROUND(AVG(num_owners), 1)                                  AS avg_num_owners,
  -- Website
  ROUND(COUNTIF(has_website) * 100.0 / COUNT(*), 1)          AS pct_has_website
FROM combined
GROUP BY group_label
ORDER BY group_label
;

-- 4B: Check what fields actually exist on ria_firms_current
-- (Run this first if 4A errors — field names may differ)
SELECT column_name, data_type
FROM `savvy-gtm-analytics.FinTrx_data_CA.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'ria_firms_current'
  AND (
    LOWER(column_name) LIKE '%state%'
    OR LOWER(column_name) LIKE '%register%'
    OR LOWER(column_name) LIKE '%disclos%'
    OR LOWER(column_name) LIKE '%age%'
    OR LOWER(column_name) LIKE '%date%'
    OR LOWER(column_name) LIKE '%owner%'
    OR LOWER(column_name) LIKE '%website%'
    OR LOWER(column_name) LIKE '%client%'
  )
ORDER BY column_name
;


-- ============================================================
-- BLOCK 5: AUM CONFIDENCE SCORING (FALLBACK)
-- Only run if instructed after reviewing Blocks 2-4.
-- If no feature separates the bands, this approach accepts
-- that separation is impossible and instead scores advisors
-- by their likelihood of being ABOVE the floor ($40M+) rather
-- than trying to distinguish sub-bands.
--
-- Builds a points-based score (0-100) using all discriminating
-- signals from V2/V5 weighted by Cohen's d.
-- High-scoring advisors are most likely to have substantial AUM.
-- The tier would be renamed TIER_AUM_SUBSTANTIAL and the
-- output would be the existing TIER_AUM_MID shadow table
-- re-ranked by this score.
-- ============================================================
WITH signal_scores AS (
  SELECT
    c.RIA_CONTACT_CRD_ID                                     AS crd,
    c.CONTACT_FIRST_NAME                                     AS first_name,
    c.CONTACT_LAST_NAME                                      AS last_name,
    c.EMAIL                                                  AS email,

    -- Score each signal weighted by Cohen's d from V2/V5
    -- license_count (d=0.70): fewer = better
    CASE
      WHEN COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)),0) = 1 THEN 20
      WHEN COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)),0) = 2 THEN 15
      WHEN COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)),0) = 3 THEN 5
      ELSE 0
    END                                                      AS score_license,

    -- firm_hnw_ratio (d=0.61): higher = better
    CASE
      WHEN SAFE_DIVIDE(SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
        NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64),0)) > 0.60    THEN 18
      WHEN SAFE_DIVIDE(SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
        NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64),0)) > 0.40    THEN 12
      WHEN SAFE_DIVIDE(SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
        NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64),0)) > 0.30    THEN 6
      ELSE 0
    END                                                      AS score_hnw,

    -- firm_disc_ratio (d=0.53): higher = better
    CASE
      WHEN SAFE_DIVIDE(SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
        NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64),0)) > 0.90    THEN 15
      WHEN SAFE_DIVIDE(SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
        NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64),0)) > 0.70    THEN 10
      ELSE 0
    END                                                      AS score_disc,

    -- tenure_at_firm (d=0.549): shorter = better for target profile
    CASE
      WHEN DATE_DIFF(CURRENT_DATE(),
        SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
        MONTH) / 12.0 BETWEEN 1 AND 5 THEN 16
      WHEN DATE_DIFF(CURRENT_DATE(),
        SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
        MONTH) / 12.0 BETWEEN 5 AND 10 THEN 10
      WHEN DATE_DIFF(CURRENT_DATE(),
        SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
        MONTH) / 12.0 > 10 THEN 0
      ELSE 5
    END                                                      AS score_tenure,

    -- is_independent_ria (2.82x lift): binary bonus
    CASE WHEN f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%' THEN 15 ELSE 0 END
                                                             AS score_indep_ria,

    -- has_portable_custodian (2.31x lift): binary bonus
    CASE WHEN (
      UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%SCHWAB%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%FIDELITY%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%PERSHING%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%TD AMERITRADE%'
    ) AND c.REP_LICENSES NOT LIKE '%Series 7%'
    THEN 10 ELSE 0
    END                                                      AS score_portable,

    -- has_series_7: negative signal
    CASE WHEN c.REP_LICENSES LIKE '%Series 7%' THEN -10 ELSE 0 END
                                                             AS score_series7_penalty,

    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0      AS industry_tenure_years,
    SAFE_CAST(f.TOTAL_AUM AS INT64)                          AS firm_aum,
    c.PRIMARY_FIRM                                           AS firm_crd

  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
    ON f.CRD_ID = c.PRIMARY_FIRM
  WHERE c.PRODUCING_ADVISOR = 'true'
)

SELECT
  crd,
  first_name,
  last_name,
  email,
  industry_tenure_years,
  firm_aum / 1000000.0                                       AS firm_aum_m,
  -- Total AUM confidence score (0-100 scale)
  LEAST(
    score_license + score_hnw + score_disc + score_tenure
    + score_indep_ria + score_portable + score_series7_penalty,
    100
  )                                                          AS aum_confidence_score,
  score_license,
  score_hnw,
  score_disc,
  score_tenure,
  score_indep_ria,
  score_portable,
  score_series7_penalty
FROM signal_scores
WHERE industry_tenure_years BETWEEN 7 AND 25
  AND firm_aum < 3000000000
ORDER BY aum_confidence_score DESC
LIMIT 100
;

-- 5B: Validate score distribution against known labeled groups
WITH labeled_scores AS (
  SELECT
    '$40M-$100M'                                             AS group_label,
    LEAST(
      -- license score
      CASE WHEN license_count = 1 THEN 20
           WHEN license_count = 2 THEN 15
           WHEN license_count = 3 THEN 5 ELSE 0 END
      -- hnw score
      + CASE WHEN firm_hnw_ratio > 0.60 THEN 18
             WHEN firm_hnw_ratio > 0.40 THEN 12
             WHEN firm_hnw_ratio > 0.30 THEN 6 ELSE 0 END
      -- disc score
      + CASE WHEN firm_disc_ratio > 0.90 THEN 15
             WHEN firm_disc_ratio > 0.70 THEN 10 ELSE 0 END
      -- tenure score
      + CASE WHEN tenure_at_firm_years BETWEEN 1 AND 5 THEN 16
             WHEN tenure_at_firm_years BETWEEN 5 AND 10 THEN 10
             WHEN tenure_at_firm_years > 10 THEN 0 ELSE 5 END
      -- indep_ria score
      + CASE WHEN is_independent_ria THEN 15 ELSE 0 END
      -- portable score
      + CASE WHEN has_portable_custodian
               AND NOT has_series_7 THEN 10 ELSE 0 END
      -- series 7 penalty
      + CASE WHEN has_series_7 THEN -10 ELSE 0 END,
      100
    )                                                        AS aum_score
  FROM `savvy-gtm-analytics.ml_features.aum_labeled_40_100m_v5`
),
labeled_100_200 AS (
  SELECT
    '$100M-$200M'                                            AS group_label,
    LEAST(
      CASE WHEN license_count = 1 THEN 20
           WHEN license_count = 2 THEN 15
           WHEN license_count = 3 THEN 5 ELSE 0 END
      + CASE WHEN firm_hnw_ratio > 0.60 THEN 18
             WHEN firm_hnw_ratio > 0.40 THEN 12
             WHEN firm_hnw_ratio > 0.30 THEN 6 ELSE 0 END
      + CASE WHEN firm_disc_ratio > 0.90 THEN 15
             WHEN firm_disc_ratio > 0.70 THEN 10 ELSE 0 END
      + CASE WHEN tenure_at_firm_years BETWEEN 1 AND 5 THEN 16
             WHEN tenure_at_firm_years BETWEEN 5 AND 10 THEN 10
             WHEN tenure_at_firm_years > 10 THEN 0 ELSE 5 END
      + CASE WHEN is_independent_ria THEN 15 ELSE 0 END
      + CASE WHEN has_portable_custodian
               AND NOT has_series_7 THEN 10 ELSE 0 END
      + CASE WHEN has_series_7 THEN -10 ELSE 0 END,
      100
    )                                                        AS aum_score
  FROM `savvy-gtm-analytics.ml_features.aum_100_200m_labeled_features`
  WHERE is_closed_lost = 1 OR is_open = 1
),
ctrl AS (
  SELECT
    'Control'                                                AS group_label,
    LEAST(
      CASE WHEN license_count = 1 THEN 20
           WHEN license_count = 2 THEN 15
           WHEN license_count = 3 THEN 5 ELSE 0 END
      + CASE WHEN firm_hnw_ratio > 0.60 THEN 18
             WHEN firm_hnw_ratio > 0.40 THEN 12
             WHEN firm_hnw_ratio > 0.30 THEN 6 ELSE 0 END
      + CASE WHEN firm_disc_ratio > 0.90 THEN 15
             WHEN firm_disc_ratio > 0.70 THEN 10 ELSE 0 END
      + CASE WHEN tenure_at_firm_years BETWEEN 1 AND 5 THEN 16
             WHEN tenure_at_firm_years BETWEEN 5 AND 10 THEN 10
             WHEN tenure_at_firm_years > 10 THEN 0 ELSE 5 END
      + CASE WHEN is_independent_ria THEN 15 ELSE 0 END
      + CASE WHEN has_portable_custodian
               AND NOT has_series_7 THEN 10 ELSE 0 END
      + CASE WHEN has_series_7 THEN -10 ELSE 0 END,
      100
    )                                                        AS aum_score
  FROM `savvy-gtm-analytics.ml_features.aum_control_v5`
),
all_groups AS (
  SELECT * FROM labeled_scores
  UNION ALL SELECT * FROM labeled_100_200
  UNION ALL SELECT * FROM ctrl
)
SELECT
  group_label,
  COUNT(*)                                                   AS n,
  ROUND(AVG(aum_score), 1)                                   AS avg_score,
  ROUND(STDDEV(aum_score), 1)                                AS sd_score,
  ROUND(APPROX_QUANTILES(aum_score, 2)[OFFSET(1)], 0)        AS median_score,
  ROUND(APPROX_QUANTILES(aum_score, 4)[OFFSET(1)], 0)        AS p25_score,
  ROUND(APPROX_QUANTILES(aum_score, 4)[OFFSET(3)], 0)        AS p75_score,
  COUNTIF(aum_score >= 50)                                   AS count_high_confidence,
  ROUND(COUNTIF(aum_score >= 50) * 100.0 / COUNT(*), 1)      AS pct_high_confidence
FROM all_groups
GROUP BY group_label
ORDER BY group_label
;
