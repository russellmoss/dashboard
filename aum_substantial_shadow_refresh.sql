-- ============================================================
-- TIER_AUM_SUBSTANTIAL: SHADOW TABLE REFRESH
-- Changes from TIER_AUM_MID (V5):
--   1. Firm AUM ceiling raised: $1B → $2.5B
--   2. Priority ranking changed: v4_percentile DESC → aum_confidence_score DESC
--   3. AUM confidence score added as output column
--   4. Tier name updated: TIER_AUM_MID → TIER_AUM_SUBSTANTIAL
--
-- BLOCK 1: Validate existing shadow table before overwriting
-- BLOCK 2: Build refreshed shadow table
-- BLOCK 3: Post-build validation + comparison to V5 table
-- BLOCK 4: Score band distribution report
-- ============================================================


-- ============================================================
-- BLOCK 1: PRE-REFRESH SNAPSHOT
-- Captures current state before overwrite so we can compare.
-- ============================================================
SELECT
  'PRE-REFRESH (V5)'                                         AS snapshot,
  COUNT(*)                                                   AS total_candidates,
  COUNT(DISTINCT advisor_crd)                                AS unique_crds,
  COUNT(DISTINCT firm_crd)                                   AS unique_firms,
  ROUND(AVG(v4_percentile), 1)                               AS avg_v4_percentile,
  ROUND(AVG(firm_aum / 1000000000.0), 2)                     AS avg_firm_aum_b,
  COUNTIF(firm_aum < 1000000000)                             AS under_1b_count,
  COUNTIF(firm_aum BETWEEN 1000000000 AND 2500000000)        AS band_1b_2_5b_count,
  ROUND(AVG(tenure_at_firm_years), 1)                        AS avg_tenure,
  ROUND(AVG(num_prior_firms), 2)                             AS avg_prior_firms
FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
;


-- ============================================================
-- BLOCK 2: REFRESHED SHADOW TABLE
-- Stored as: ml_features.aum_substantial_tier_candidates
-- Keeps aum_mid_tier_candidates intact until validation passes.
-- Once validated, aum_mid_tier_candidates can be swapped.
-- ============================================================
CREATE OR REPLACE TABLE
  `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates` AS

WITH

excluded_firm_crds_list AS (
  SELECT firm_crd
  FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

sfdc_crds AS (
  SELECT DISTINCT
    SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64) AS crd,
    Id                                                           AS salesforce_lead_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE FA_CRD__c IS NOT NULL AND IsDeleted = FALSE
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
    c.RIA_CONTACT_CRD_ID                                         AS crd,
    c.CONTACT_FIRST_NAME                                         AS first_name,
    c.CONTACT_LAST_NAME                                          AS last_name,
    c.TITLE_NAME                                                 AS job_title,
    c.EMAIL                                                      AS email,
    c.OFFICE_PHONE_NUMBER                                        AS phone,
    c.LINKEDIN_PROFILE_URL                                       AS linkedin_url,
    (c.LINKEDIN_PROFILE_URL IS NOT NULL)                         AS has_linkedin,
    f.NAME                                                       AS firm_name,
    c.PRIMARY_FIRM                                               AS firm_crd,
    SAFE_CAST(f.TOTAL_AUM AS INT64)                              AS firm_aum,
    SAFE_CAST(f.NUMBER_OF_EMPLOYEES AS INT64)                    AS firm_rep_count,
    SAFE_DIVIDE(
      SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0))                AS firm_disc_ratio,
    SAFE_DIVIDE(
      SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0))                AS firm_hnw_ratio,
    COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0)
                                                                 AS license_count,
    (c.REP_LICENSES LIKE '%Series 7%')                           AS has_series_7,
    (c.REP_LICENSES LIKE '%Series 65%'
      AND c.REP_LICENSES NOT LIKE '%Series 7%')                  AS has_series_65_only,
    SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0          AS industry_tenure_years,
    (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%')           AS is_independent_ria,
    (
      UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%SCHWAB%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%FIDELITY%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%PERSHING%'
      OR UPPER(COALESCE(f.CUSTODIAN_PRIMARY_BUSINESS_NAME,'')) LIKE '%TD AMERITRADE%'
    )                                                            AS has_portable_custodian,
    -- V5: tenure and prior firms from ria_contacts_current directly
    DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0                                                     AS tenure_at_firm_years,
    CASE
      WHEN c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS IS NULL
        OR TRIM(c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS) = ''   THEN 0
      ELSE ARRAY_LENGTH(
        SPLIT(TRIM(c.PREVIOUS_REGISTRATION_COMPANY_CRD_IDS), ','))
    END                                                          AS num_prior_firms,
    sc.salesforce_lead_id,
    'NEW_PROSPECT'                                               AS prospect_type

  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` c
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` f
    ON f.CRD_ID = c.PRIMARY_FIRM
  LEFT JOIN sfdc_crds sc ON sc.crd = c.RIA_CONTACT_CRD_ID

  WHERE c.PRODUCING_ADVISOR = 'true'
    AND c.PRIMARY_FIRM IS NOT NULL
    AND NOT (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')
    AND c.PRIMARY_FIRM NOT IN (SELECT firm_crd FROM excluded_firm_crds_list)
    AND SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) <= 480
    AND sc.crd IS NULL                          -- not already in pipeline
    AND c.RIA_CONTACT_CRD_ID NOT IN (SELECT crd FROM has_accolade)

    -- ── Practice independence (unchanged from V5) ──────────────
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

    -- ── Practice quality (unchanged from V5) ───────────────────
    AND SAFE_DIVIDE(
      SAFE_CAST(f.DISCRETIONARY_AUM AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    ) > 0.70
    AND SAFE_DIVIDE(
      SAFE_CAST(f.AMT_OF_AUM_HIGH_NET_WORTH_INDIVIDUALS AS INT64),
      NULLIF(SAFE_CAST(f.TOTAL_AUM AS INT64), 0)
    ) > 0.30
    AND COALESCE(ARRAY_LENGTH(JSON_EXTRACT_ARRAY(c.REP_LICENSES)), 0) < 3

    -- ── Career stage (unchanged from V5) ───────────────────────
    AND SAFE_CAST(c.INDUSTRY_TENURE_MONTHS AS INT64) / 12.0 BETWEEN 7 AND 25

    -- ── Tenure ceiling (unchanged from V5) ─────────────────────
    AND DATE_DIFF(
      CURRENT_DATE(),
      SAFE.PARSE_DATE('%Y-%m-%d', c.PRIMARY_FIRM_START_DATE),
      MONTH
    ) / 12.0 < 10

    -- ── Firm AUM ceiling: RAISED from $1B to $2.5B ─────────────
    AND SAFE_CAST(f.TOTAL_AUM AS INT64) < 2500000000

),

-- ── AUM confidence score ──────────────────────────────────────
-- Weighted by Cohen's d / lift from V2 and V5 investigations.
-- Validated in band separation analysis: 28.5pt gap labeled vs
-- control. 55-60% of labeled advisors score >=50 vs 13.8%
-- of control — 4x precision lift at this threshold.
scored AS (
  SELECT
    *,
    LEAST(
      -- license_count (d=0.80 — strongest signal, fewer = better)
      CASE
        WHEN license_count = 1 THEN 20
        WHEN license_count = 2 THEN 15
        WHEN license_count = 3 THEN 5
        ELSE 0
      END
      -- firm_hnw_ratio (d=0.61)
      + CASE
          WHEN firm_hnw_ratio > 0.60 THEN 18
          WHEN firm_hnw_ratio > 0.40 THEN 12
          WHEN firm_hnw_ratio > 0.30 THEN 6
          ELSE 0
        END
      -- tenure_at_firm_years (d=0.55 — 1-5yr is sweet spot)
      + CASE
          WHEN tenure_at_firm_years BETWEEN 1 AND 5 THEN 16
          WHEN tenure_at_firm_years BETWEEN 5 AND 10 THEN 10
          WHEN tenure_at_firm_years > 10 THEN 0
          ELSE 5   -- <1yr (very new)
        END
      -- firm_disc_ratio (d=0.53)
      + CASE
          WHEN firm_disc_ratio > 0.90 THEN 15
          WHEN firm_disc_ratio > 0.70 THEN 10
          ELSE 0
        END
      -- is_independent_ria (2.88x lift)
      + CASE WHEN is_independent_ria THEN 15 ELSE 0 END
      -- has_portable_custodian without series 7 (2.41x lift)
      + CASE
          WHEN has_portable_custodian AND NOT has_series_7 THEN 10
          ELSE 0
        END
      -- has_series_7 (penalty — 0.54x lift, negative signal)
      + CASE WHEN has_series_7 THEN -10 ELSE 0 END,
      100   -- cap at 100
    )                                                            AS aum_confidence_score,

    -- Score tier label for easy filtering and reporting
    CASE
      WHEN LEAST(
        CASE WHEN license_count = 1 THEN 20 WHEN license_count = 2 THEN 15
          WHEN license_count = 3 THEN 5 ELSE 0 END
        + CASE WHEN firm_hnw_ratio > 0.60 THEN 18 WHEN firm_hnw_ratio > 0.40 THEN 12
          WHEN firm_hnw_ratio > 0.30 THEN 6 ELSE 0 END
        + CASE WHEN tenure_at_firm_years BETWEEN 1 AND 5 THEN 16
          WHEN tenure_at_firm_years BETWEEN 5 AND 10 THEN 10
          WHEN tenure_at_firm_years > 10 THEN 0 ELSE 5 END
        + CASE WHEN firm_disc_ratio > 0.90 THEN 15 WHEN firm_disc_ratio > 0.70 THEN 10
          ELSE 0 END
        + CASE WHEN is_independent_ria THEN 15 ELSE 0 END
        + CASE WHEN has_portable_custodian AND NOT has_series_7 THEN 10 ELSE 0 END
        + CASE WHEN has_series_7 THEN -10 ELSE 0 END,
        100
      ) >= 50 THEN 'HIGH'
      WHEN LEAST(
        CASE WHEN license_count = 1 THEN 20 WHEN license_count = 2 THEN 15
          WHEN license_count = 3 THEN 5 ELSE 0 END
        + CASE WHEN firm_hnw_ratio > 0.60 THEN 18 WHEN firm_hnw_ratio > 0.40 THEN 12
          WHEN firm_hnw_ratio > 0.30 THEN 6 ELSE 0 END
        + CASE WHEN tenure_at_firm_years BETWEEN 1 AND 5 THEN 16
          WHEN tenure_at_firm_years BETWEEN 5 AND 10 THEN 10
          WHEN tenure_at_firm_years > 10 THEN 0 ELSE 5 END
        + CASE WHEN firm_disc_ratio > 0.90 THEN 15 WHEN firm_disc_ratio > 0.70 THEN 10
          ELSE 0 END
        + CASE WHEN is_independent_ria THEN 15 ELSE 0 END
        + CASE WHEN has_portable_custodian AND NOT has_series_7 THEN 10 ELSE 0 END
        + CASE WHEN has_series_7 THEN -10 ELSE 0 END,
        100
      ) >= 30 THEN 'MODERATE'
      ELSE 'LOW'
    END                                                          AS aum_score_band
  FROM base_candidates
)

SELECT
  s.crd                                                          AS advisor_crd,
  s.salesforce_lead_id,
  s.first_name,
  s.last_name,
  s.job_title,
  s.email,
  s.phone,
  s.linkedin_url,
  s.has_linkedin,
  s.firm_name,
  s.firm_crd,
  s.firm_rep_count,
  s.firm_aum,
  ROUND(s.firm_aum / 1000000000.0, 2)                            AS firm_aum_b,
  CASE
    WHEN s.firm_aum < 1000000000              THEN 'Under $1B'
    WHEN s.firm_aum BETWEEN 1000000000
      AND 2500000000                          THEN '$1B-$2.5B'
  END                                                            AS firm_aum_band,
  ROUND(s.tenure_at_firm_years, 1)                               AS tenure_at_firm_years,
  s.num_prior_firms,
  s.industry_tenure_years,
  s.firm_disc_ratio,
  s.firm_hnw_ratio,
  s.license_count,
  s.has_series_65_only,
  s.has_series_7,
  s.is_independent_ria,
  s.has_portable_custodian,

  -- AUM confidence score (replaces v4_percentile as primary rank)
  s.aum_confidence_score,
  s.aum_score_band,

  -- V4 retained as secondary signal
  COALESCE(v4.v4_score, 0.5)                                     AS v4_score,
  COALESCE(v4.v4_percentile, 50)                                 AS v4_percentile,

  s.prospect_type,
  'TIER_AUM_SUBSTANTIAL'                                         AS score_tier,
  'shadow_validation'                                            AS run_mode,

  -- New priority rank: AUM confidence score primary, V4 secondary, firm quality tertiary
  ROW_NUMBER() OVER (
    ORDER BY
      s.aum_confidence_score DESC,
      COALESCE(v4.v4_percentile, 50) DESC,
      s.firm_disc_ratio DESC,
      s.firm_hnw_ratio DESC,
      s.crd
  )                                                              AS priority_rank,

  -- Firm diversity rank (for cap enforcement at pull time)
  ROW_NUMBER() OVER (
    PARTITION BY s.firm_crd
    ORDER BY s.aum_confidence_score DESC, s.crd
  )                                                              AS rank_within_firm

FROM scored s
LEFT JOIN v4_scores v4 ON v4.crd = s.crd
;


-- ============================================================
-- BLOCK 3: POST-BUILD VALIDATION
-- ============================================================

-- 3A: Side-by-side comparison vs V5 shadow table
SELECT
  snapshot,
  total_candidates,
  unique_crds,
  unique_firms,
  avg_aum_score,
  pct_high_confidence,
  avg_v4_percentile,
  avg_firm_aum_b,
  under_1b_count,
  band_1b_2_5b_count,
  pct_1b_2_5b,
  avg_tenure,
  max_per_firm
FROM (
  SELECT
    'V5 (pre-refresh)'                                           AS snapshot,
    COUNT(*)                                                     AS total_candidates,
    COUNT(DISTINCT advisor_crd)                                  AS unique_crds,
    COUNT(DISTINCT firm_crd)                                     AS unique_firms,
    NULL                                                         AS avg_aum_score,
    NULL                                                         AS pct_high_confidence,
    ROUND(AVG(v4_percentile), 1)                                 AS avg_v4_percentile,
    ROUND(AVG(firm_aum / 1000000000.0), 2)                       AS avg_firm_aum_b,
    COUNTIF(firm_aum < 1000000000)                               AS under_1b_count,
    0                                                            AS band_1b_2_5b_count,
    0.0                                                          AS pct_1b_2_5b,
    ROUND(AVG(tenure_at_firm_years), 1)                          AS avg_tenure,
    MAX(cnt)                                                     AS max_per_firm
  FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
  CROSS JOIN (
    SELECT firm_crd, COUNT(*) AS cnt
    FROM `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates`
    GROUP BY firm_crd
  )

  UNION ALL

  SELECT
    'V6 (post-refresh)'                                          AS snapshot,
    COUNT(*)                                                     AS total_candidates,
    COUNT(DISTINCT advisor_crd)                                  AS unique_crds,
    COUNT(DISTINCT firm_crd)                                     AS unique_firms,
    ROUND(AVG(aum_confidence_score), 1)                          AS avg_aum_score,
    ROUND(COUNTIF(aum_score_band = 'HIGH') * 100.0
      / COUNT(*), 1)                                             AS pct_high_confidence,
    ROUND(AVG(v4_percentile), 1)                                 AS avg_v4_percentile,
    ROUND(AVG(firm_aum / 1000000000.0), 2)                       AS avg_firm_aum_b,
    COUNTIF(firm_aum < 1000000000)                               AS under_1b_count,
    COUNTIF(firm_aum BETWEEN 1000000000 AND 2500000000)          AS band_1b_2_5b_count,
    ROUND(COUNTIF(firm_aum BETWEEN 1000000000 AND 2500000000)
      * 100.0 / COUNT(*), 1)                                     AS pct_1b_2_5b,
    ROUND(AVG(tenure_at_firm_years), 1)                          AS avg_tenure,
    MAX(cnt)                                                     AS max_per_firm
  FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
  CROSS JOIN (
    SELECT firm_crd, COUNT(*) AS cnt
    FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
    GROUP BY firm_crd
  )
)
ORDER BY snapshot
;

-- 3B: Overlap between new and old shadow tables
SELECT
  COUNTIF(new.advisor_crd IS NOT NULL
    AND old.advisor_crd IS NOT NULL)                             AS in_both,
  COUNTIF(new.advisor_crd IS NOT NULL
    AND old.advisor_crd IS NULL)                                 AS new_only,
  COUNTIF(old.advisor_crd IS NOT NULL
    AND new.advisor_crd IS NULL)                                 AS old_only,
  ROUND(COUNTIF(new.advisor_crd IS NOT NULL
    AND old.advisor_crd IS NOT NULL) * 100.0
    / COUNT(new.advisor_crd), 1)                                 AS pct_retained_from_v5
FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates` new
FULL OUTER JOIN `savvy-gtm-analytics.ml_features.aum_mid_tier_candidates` old
  ON old.advisor_crd = new.advisor_crd
;

-- 3C: Validation gates (all must pass before declaring READY)
SELECT
  'duplicate_check'                                              AS gate,
  COUNT(*) = COUNT(DISTINCT advisor_crd)                         AS passes,
  COUNT(*) AS total_rows,
  COUNT(DISTINCT advisor_crd) AS unique_crds
FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
UNION ALL
SELECT
  'no_pipeline_advisors',
  COUNTIF(advisor_crd IN (
    SELECT SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64)
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE FA_CRD__c IS NOT NULL
  )) = 0,
  COUNTIF(advisor_crd IN (
    SELECT SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64),0) AS INT64)
    FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
    WHERE FA_CRD__c IS NOT NULL
  )),
  NULL
FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
UNION ALL
SELECT
  'tenure_populated',
  ROUND(COUNTIF(tenure_at_firm_years IS NOT NULL) * 100.0
    / COUNT(*), 1) >= 85,
  COUNTIF(tenure_at_firm_years IS NOT NULL),
  COUNT(*)
FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
UNION ALL
SELECT
  'score_populated',
  COUNTIF(aum_confidence_score IS NULL) = 0,
  COUNTIF(aum_confidence_score IS NOT NULL),
  COUNT(*)
FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
UNION ALL
SELECT
  'firm_cap_ok',
  MAX(cnt) <= 50,
  MAX(cnt),
  NULL
FROM (
  SELECT firm_crd, COUNT(*) AS cnt
  FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
  GROUP BY firm_crd
)
;


-- ============================================================
-- BLOCK 4: SCORE BAND DISTRIBUTION REPORT
-- How the pool distributes across HIGH / MODERATE / LOW bands.
-- Used to set quota recommendations per band.
-- ============================================================

-- 4A: Score band summary
SELECT
  aum_score_band,
  COUNT(*)                                                       AS advisor_count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1)             AS pct_of_pool,
  ROUND(AVG(aum_confidence_score), 1)                           AS avg_score,
  ROUND(AVG(v4_percentile), 1)                                  AS avg_v4_pct,
  ROUND(AVG(firm_disc_ratio), 3)                                AS avg_disc_ratio,
  ROUND(AVG(firm_hnw_ratio), 3)                                 AS avg_hnw_ratio,
  ROUND(AVG(license_count), 2)                                  AS avg_license_count,
  ROUND(AVG(tenure_at_firm_years), 1)                           AS avg_tenure,
  ROUND(COUNTIF(firm_aum_band = '$1B-$2.5B') * 100.0
    / COUNT(*), 1)                                              AS pct_new_ceiling_band,
  ROUND(COUNT(*) / 12.0, 0)                                     AS monthly_at_this_band
FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
GROUP BY aum_score_band
ORDER BY avg_score DESC
;

-- 4B: Score distribution histogram
SELECT
  CONCAT(
    CAST(FLOOR(aum_confidence_score / 10) * 10 AS STRING),
    '-',
    CAST(FLOOR(aum_confidence_score / 10) * 10 + 9 AS STRING)
  )                                                              AS score_bucket,
  COUNT(*)                                                       AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1)             AS pct
FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
GROUP BY 1
ORDER BY MIN(aum_confidence_score)
;

-- 4C: Top 20 advisors by AUM confidence score
-- Spot check that top-ranked advisors look right
SELECT
  priority_rank,
  advisor_crd,
  first_name,
  last_name,
  firm_name,
  ROUND(firm_aum / 1000000000.0, 2)                             AS firm_aum_b,
  firm_aum_band,
  aum_confidence_score,
  aum_score_band,
  v4_percentile,
  license_count,
  ROUND(firm_hnw_ratio, 2)                                      AS hnw_ratio,
  ROUND(firm_disc_ratio, 2)                                     AS disc_ratio,
  ROUND(tenure_at_firm_years, 1)                                AS tenure_yrs,
  num_prior_firms,
  rank_within_firm
FROM `savvy-gtm-analytics.ml_features.aum_substantial_tier_candidates`
WHERE priority_rank <= 20
ORDER BY priority_rank
;
