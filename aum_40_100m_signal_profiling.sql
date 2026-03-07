-- ============================================================
-- $40M–$100M AUM ADVISOR SIGNAL PROFILING
-- ============================================================
-- Purpose  : Two-phase data exploration to describe the $40M–$100M
--            advisor cohort and build the foundation for a new
--            FINTRX prospecting tier.
--
-- PHASE 1  : Wide enrichment table (CREATE OR REPLACE + run once)
--            Saves to: savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile
--
-- PHASE 2  : Aggregation queries run against Phase 1 output.
--            Each block is independently runnable.
--
-- Key design decisions:
--   • CRD join: SAFE_CAST(ROUND(SAFE_CAST(FA_CRD__c AS FLOAT64), 0) AS INT64)
--     to handle string/float/int inconsistencies in Salesforce
--   • PIT anchor: o.CreatedDate (when advisor entered funnel)
--   • Firm_historicals range: Jan 2024–Nov 2025. Opps created before 2024
--     fall back to ria_firms_current for firm AUM. Flag added.
--   • Exclusion firms are FLAGGED not filtered in Phase 1 — lets you
--     see what % of the cohort is disqualified before deciding on tier rules.
--   • Age exclusion (>70 yrs): proxied by INDUSTRY_TENURE_MONTHS > 480.
--     TODO: Replace with a direct AGE or BIRTH_YEAR field if it exists
--     in your schema (it's used in V4 but not documented in data dictionary).
-- ============================================================


-- ============================================================
-- PHASE 1: WIDE ENRICHMENT TABLE
-- ============================================================
-- Expected runtime: 60–120s depending on BQ slot availability
-- Save as: savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile

CREATE OR REPLACE TABLE `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile` AS

WITH

-- ─────────────────────────────────────────────────────────────
-- STEP 1: SFDC Opportunity Spine
-- All opps with $40M–$100M AUM, all time, all outcomes.
-- FA_CRD__c is the bridge to FINTRX; cast defensively.
-- ─────────────────────────────────────────────────────────────
sfdc_opps AS (
  SELECT
    SAFE_CAST(
      ROUND(SAFE_CAST(o.FA_CRD__c AS FLOAT64), 0)
    AS INT64)                                           AS crd,
    o.Id                                                AS opportunity_id,
    o.Name                                              AS advisor_name_sfdc,
    o.AccountId                                         AS account_id,
    o.CreatedDate                                       AS opp_created_at,
    DATE(o.CreatedDate)                                 AS opp_created_date,
    EXTRACT(YEAR  FROM o.CreatedDate)                   AS opp_year,
    EXTRACT(MONTH FROM o.CreatedDate)                   AS opp_month,
    o.CloseDate,
    o.StageName,
    o.IsClosed,
    o.IsWon,
    COALESCE(o.Underwritten_AUM__c, o.Amount)           AS aum_used,
    o.Underwritten_AUM__c,
    o.Amount                                            AS sfdc_amount,
    o.Closed_Lost_Reason__c,
    o.Closed_Lost_Details__c
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE (o.IsDeleted IS NULL OR o.IsDeleted = FALSE)
    AND COALESCE(o.Underwritten_AUM__c, o.Amount) BETWEEN 40000000 AND 100000000
    -- Require a valid CRD to join to FINTRX
    AND SAFE_CAST(
          ROUND(SAFE_CAST(o.FA_CRD__c AS FLOAT64), 0)
        AS INT64) IS NOT NULL
),

-- ─────────────────────────────────────────────────────────────
-- STEP 2: FINTRX Contact Profile (current state)
-- Licenses, titles, disclosures, ownership — all current-state only.
-- Age proxy: exclude INDUSTRY_TENURE_MONTHS > 480 (~40+ yrs in industry)
-- which reliably identifies advisors likely over 70.
-- ─────────────────────────────────────────────────────────────
contact_profile AS (
  SELECT
    c.RIA_CONTACT_CRD_ID                              AS crd,
    c.CONTACT_FIRST_NAME,
    c.CONTACT_LAST_NAME,
    c.PRIMARY_FIRM_NAME,
    c.PRIMARY_FIRM                                    AS firm_crd,
    c.TITLE_NAME,
    c.REP_TYPE,
    c.PRODUCING_ADVISOR,
    c.INDUSTRY_TENURE_MONTHS,
    c.PRIMARY_FIRM_START_DATE,
    c.LATEST_REGISTERED_EMPLOYMENT_START_DATE,
    c.CONTACT_OWNERSHIP_PERCENTAGE,
    c.REP_LICENSES,
    c.LINKEDIN_PROFILE_URL,
    c.EMAIL,
    -- ── License flags (current state only) ─────────────────
    (c.REP_LICENSES LIKE '%Series 7%')                AS has_series_7,
    (c.REP_LICENSES LIKE '%Series 65%')               AS has_series_65,
    (c.REP_LICENSES LIKE '%Series 66%')               AS has_series_66,
    (c.REP_LICENSES LIKE '%Series 24%')               AS has_series_24,
    (c.REP_LICENSES LIKE '%CFP%')                     AS has_cfp,
    (c.REP_LICENSES LIKE '%CFA%')                     AS has_cfa,
    -- Pure RIA (Series 65 only, no dual-registration via Series 7)
    (c.REP_LICENSES LIKE '%Series 65%'
     AND c.REP_LICENSES NOT LIKE '%Series 7%')        AS is_series_65_only,
    -- Ownership (non-null and not "No Ownership" = some stake in the firm)
    (c.CONTACT_OWNERSHIP_PERCENTAGE IS NOT NULL
     AND c.CONTACT_OWNERSHIP_PERCENTAGE NOT LIKE '%No Ownership%') AS has_ownership,
    -- ── Disclosure flags ────────────────────────────────────
    c.CONTACT_HAS_DISCLOSED_BANKRUPT,
    c.CONTACT_HAS_DISCLOSED_CRIMINAL,
    c.CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE,
    c.CONTACT_HAS_DISCLOSED_REGULATORY_EVENT,
    c.CONTACT_HAS_DISCLOSED_TERMINATION,
    c.CONTACT_HAS_DISCLOSED_JUDGMENT_OR_LIEN,
    (
      COALESCE(c.CONTACT_HAS_DISCLOSED_BANKRUPT, FALSE)
      OR COALESCE(c.CONTACT_HAS_DISCLOSED_CRIMINAL, FALSE)
      OR COALESCE(c.CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE, FALSE)
      OR COALESCE(c.CONTACT_HAS_DISCLOSED_REGULATORY_EVENT, FALSE)
      OR COALESCE(c.CONTACT_HAS_DISCLOSED_TERMINATION, FALSE)
      OR COALESCE(c.CONTACT_HAS_DISCLOSED_JUDGMENT_OR_LIEN, FALSE)
    )                                                 AS has_any_disclosure,
    -- Age-proxy exclusion flag (not filtered here — flagged for analysis)
    (COALESCE(c.INDUSTRY_TENURE_MONTHS, 0) > 480)    AS likely_over_70
  FROM `savvy-gtm-analytics.FinTrx_data.ria_contacts_current` c
),

-- ─────────────────────────────────────────────────────────────
-- STEP 3: FINTRX Firm Profile (current state)
-- Entity classification, employee count, fee structure.
-- Used for wirehouse/exclusion flags and firm-size signals.
-- ─────────────────────────────────────────────────────────────
firm_profile AS (
  SELECT
    f.CRD_ID                                          AS firm_crd,
    f.NAME                                            AS firm_name_fintrx,
    f.ENTITY_CLASSIFICATION,
    f.TYPE_ENTITY,
    f.TOTAL_AUM                                       AS firm_aum_current,
    f.DISCRETIONARY_AUM                               AS firm_discretionary_aum_current,
    SAFE_DIVIDE(f.DISCRETIONARY_AUM, NULLIF(f.TOTAL_AUM, 0))
                                                      AS firm_disc_ratio_current,
    f.NUM_OF_EMPLOYEES                                AS firm_num_employees,
    f.MAIN_OFFICE_STATE                               AS firm_state,
    f.MAIN_OFFICE_CITY_NAME                           AS firm_city,
    f.CUSTODIAN_PRIMARY_BUSINESS_NAME                 AS custodian_current,
    f.AUM_YOY                                         AS firm_aum_yoy,
    f.FEE_STRUCTURE,
    f.INVESTMENTS_UTILIZED,
    -- ── Firm type flags (ENTITY_CLASSIFICATION is JSON string) ─
    (f.ENTITY_CLASSIFICATION LIKE '%Wirehouse%')      AS is_wirehouse,
    (f.ENTITY_CLASSIFICATION LIKE '%Bank%')           AS is_bank,
    (f.ENTITY_CLASSIFICATION LIKE '%Insurance%')      AS is_insurance,
    (f.ENTITY_CLASSIFICATION LIKE '%Independent RIA%') AS is_independent_ria,
    (f.ENTITY_CLASSIFICATION LIKE '%Hybrid RIA%')     AS is_hybrid_ria,
    (f.ENTITY_CLASSIFICATION LIKE '%Broker-Dealer%')  AS is_broker_dealer,
    -- ── Fee structure flags ─────────────────────────────────
    (f.FEE_STRUCTURE LIKE '%Percentage of AUM%')      AS fee_aum_pct,
    (f.FEE_STRUCTURE LIKE '%Fixed Fees%')             AS fee_fixed,
    (f.FEE_STRUCTURE LIKE '%Performance-Based Fees%') AS fee_performance
  FROM `savvy-gtm-analytics.FinTrx_data.ria_firms_current` f
),

-- ─────────────────────────────────────────────────────────────
-- STEP 4: Exclusion Lookups (flagged, not filtered)
-- Pulling from the same centralized tables used in lead scoring.
-- ─────────────────────────────────────────────────────────────
excluded_firm_crds_list AS (
  SELECT firm_crd
  FROM `savvy-gtm-analytics.ml_features.excluded_firm_crds`
),

-- ─────────────────────────────────────────────────────────────
-- STEP 5: PIT Firm AUM from Firm_historicals
-- Strategy: Use the most recent monthly snapshot AT OR BEFORE the
-- opp created date. Firm_historicals covers Jan 2024–Nov 2025.
-- Opps created before Jan 2024 will have no matching row here —
-- those fall back to firm_aum_current in the final SELECT.
-- A flag (firm_aum_is_pit) tells you which source was used.
-- ─────────────────────────────────────────────────────────────
pit_firm_aum_ranked AS (
  SELECT
    o.opportunity_id,
    fh.TOTAL_AUM                                      AS firm_aum_at_opp,
    fh.DISCRETIONARY_AUM                              AS firm_disc_aum_at_opp,
    SAFE_DIVIDE(fh.DISCRETIONARY_AUM, NULLIF(fh.TOTAL_AUM, 0))
                                                      AS firm_disc_ratio_at_opp,
    fh.YEAR                                           AS firm_aum_snapshot_year,
    fh.MONTH                                          AS firm_aum_snapshot_month,
    ROW_NUMBER() OVER (
      PARTITION BY o.opportunity_id
      ORDER BY fh.YEAR DESC, fh.MONTH DESC
    )                                                 AS rn
  FROM sfdc_opps o
  JOIN contact_profile cp ON cp.crd = o.crd
  JOIN `savvy-gtm-analytics.FinTrx_data.Firm_historicals` fh
    ON fh.RIA_INVESTOR_CRD_ID = cp.firm_crd
   AND (
     fh.YEAR < o.opp_year
     OR (fh.YEAR = o.opp_year AND fh.MONTH <= o.opp_month)
   )
),

pit_firm_aum AS (
  SELECT * FROM pit_firm_aum_ranked WHERE rn = 1
),

-- ─────────────────────────────────────────────────────────────
-- STEP 6: PIT Tenure at Current Firm
-- Calculates months the advisor had been at their current employer
-- when the opp was created. Also counts distinct prior firms as
-- a mobility/portability signal.
-- ─────────────────────────────────────────────────────────────
pit_tenure AS (
  SELECT
    o.opportunity_id,
    -- Start date of the employment record active at opp creation
    MAX(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE)  AS firm_start_date_at_opp,
    DATE_DIFF(
      o.opp_created_date,
      MAX(eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE),
      MONTH
    )                                                 AS tenure_months_at_opp,
    -- Total distinct firms in history (subtract 1 to get "prior" count)
    GREATEST(
      COUNT(DISTINCT eh.PREVIOUS_REGISTRATION_COMPANY_CRD_ID) - 1,
      0
    )                                                 AS prior_firm_count
  FROM sfdc_opps o
  JOIN `savvy-gtm-analytics.FinTrx_data.contact_registered_employment_history` eh
    ON eh.RIA_CONTACT_CRD_ID = o.crd
   AND eh.PREVIOUS_REGISTRATION_COMPANY_START_DATE <= o.opp_created_date
   AND (
     eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NULL
     OR eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE >= o.opp_created_date
   )
  GROUP BY o.opportunity_id, o.opp_created_date
),

-- Most recent PRIOR firm (left before opp date) — "recent mover" signal
recent_prior_firm_ranked AS (
  SELECT
    o.opportunity_id,
    eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE         AS prior_firm_end_date,
    eh.PREVIOUS_REGISTRATION_COMPANY_NAME             AS most_recent_prior_firm,
    DATE_DIFF(
      o.opp_created_date,
      eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE,
      MONTH
    )                                                 AS months_since_left_prior_firm,
    ROW_NUMBER() OVER (
      PARTITION BY o.opportunity_id
      ORDER BY eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE DESC
    )                                                 AS rn
  FROM sfdc_opps o
  JOIN `savvy-gtm-analytics.FinTrx_data.contact_registered_employment_history` eh
    ON eh.RIA_CONTACT_CRD_ID = o.crd
   AND eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE IS NOT NULL
   AND eh.PREVIOUS_REGISTRATION_COMPANY_END_DATE < o.opp_created_date
),

recent_prior_firm AS (
  SELECT * FROM recent_prior_firm_ranked WHERE rn = 1
),

-- ─────────────────────────────────────────────────────────────
-- STEP 7: PIT Accolades
-- Count accolades earned at or before the opp year.
-- Low overall coverage (~1.8%) but high signal when present.
-- ─────────────────────────────────────────────────────────────
pit_accolades AS (
  SELECT
    o.opportunity_id,
    COUNT(*)                                          AS accolades_total_at_opp,
    COUNTIF(UPPER(a.OUTLET) LIKE '%FORBES%')          AS accolades_forbes,
    COUNTIF(UPPER(a.OUTLET) LIKE '%BARRON%')          AS accolades_barrons,
    COUNTIF(UPPER(a.OUTLET) LIKE '%ADVISORHUB%')      AS accolades_advisorhub,
    MAX(CAST(a.YEAR AS INT64))                        AS most_recent_accolade_year
  FROM sfdc_opps o
  JOIN `savvy-gtm-analytics.FinTrx_data.contact_accolades_historicals` a
    ON a.RIA_CONTACT_CRD_ID = o.crd
   AND CAST(a.YEAR AS INT64) <= o.opp_year
  GROUP BY o.opportunity_id
),

-- ─────────────────────────────────────────────────────────────
-- STEP 8: PIT Primary Custodian
-- Most recent custodian snapshot at or before opp month.
-- Portable custodians (Schwab, Fidelity, Pershing, TDA) signal
-- easier transition mechanics.
-- ─────────────────────────────────────────────────────────────
pit_custodian_ranked AS (
  SELECT
    o.opportunity_id,
    ch.PRIMARY_BUSINESS_NAME                          AS custodian_at_opp,
    (
      UPPER(ch.PRIMARY_BUSINESS_NAME) LIKE '%SCHWAB%'
      OR UPPER(ch.PRIMARY_BUSINESS_NAME) LIKE '%FIDELITY%'
      OR UPPER(ch.PRIMARY_BUSINESS_NAME) LIKE '%PERSHING%'
      OR UPPER(ch.PRIMARY_BUSINESS_NAME) LIKE '%TD AMERITRADE%'
      OR UPPER(ch.PRIMARY_BUSINESS_NAME) LIKE '%TDAMERITRADE%'
    )                                                 AS is_portable_custodian,
    ROW_NUMBER() OVER (
      PARTITION BY o.opportunity_id
      ORDER BY ch.period DESC
    )                                                 AS rn
  FROM sfdc_opps o
  JOIN contact_profile cp ON cp.crd = o.crd
  JOIN `savvy-gtm-analytics.FinTrx_data.custodians_historicals` ch
    ON ch.RIA_INVESTOR_CRD_ID = cp.firm_crd
   AND ch.period <= FORMAT_DATE('%Y-%m', o.opp_created_date)
   AND ch.CURRENT_DATA = TRUE
),

pit_custodian AS (
  SELECT * FROM pit_custodian_ranked WHERE rn = 1
),

-- ─────────────────────────────────────────────────────────────
-- STEP 9: State Registration Count at Opp Date
-- Multi-state registration (>5 states) is a proxy for a
-- geographically broad practice and larger AUM.
-- ─────────────────────────────────────────────────────────────
pit_state_registrations AS (
  SELECT
    o.opportunity_id,
    COUNT(DISTINCT sr.registerations_regulator)       AS state_reg_count_at_opp
  FROM sfdc_opps o
  JOIN `savvy-gtm-analytics.FinTrx_data.contact_state_registrations_historicals` sr
    ON sr.contact_crd_id = o.crd
   AND sr.period <= FORMAT_DATE('%Y-%m', o.opp_created_date)
   AND sr.active = TRUE
  GROUP BY o.opportunity_id
),

-- ─────────────────────────────────────────────────────────────
-- STEP 10: Firm Rep Count
-- Count of advisors currently at the same firm CRD.
-- Small shops (1–3 reps) at this AUM level strongly suggest
-- a self-built, portable book.
-- Note: This is current state, not PIT — acceptable leakage
-- for exploratory analysis; flag for tier logic.
-- ─────────────────────────────────────────────────────────────
firm_rep_count AS (
  SELECT
    PRIMARY_FIRM                                      AS firm_crd,
    COUNT(DISTINCT RIA_CONTACT_CRD_ID)                AS fintrx_rep_count
  FROM `savvy-gtm-analytics.FinTrx_data.ria_contacts_current`
  WHERE PRIMARY_FIRM IS NOT NULL
  GROUP BY PRIMARY_FIRM
)

-- ─────────────────────────────────────────────────────────────
-- FINAL SELECT: Join all CTEs into the wide output table
-- ─────────────────────────────────────────────────────────────
SELECT

  -- ── Identifiers ──────────────────────────────────────────────────────
  o.opportunity_id,
  o.crd,
  o.advisor_name_sfdc,
  cp.CONTACT_FIRST_NAME,
  cp.CONTACT_LAST_NAME,

  -- ── SFDC Opportunity Context ─────────────────────────────────────────
  o.opp_created_date,
  o.opp_year,
  o.opp_month,
  o.CloseDate                                         AS close_date,
  o.StageName                                         AS stage_name,
  o.IsClosed                                          AS is_closed,
  o.IsWon                                             AS is_won,
  o.aum_used,
  o.Underwritten_AUM__c                               AS underwritten_aum,
  o.sfdc_amount,
  o.Closed_Lost_Reason__c                             AS closed_lost_reason,
  o.Closed_Lost_Details__c                            AS closed_lost_details,
  -- AUM band within cohort (for cross-tabs)
  CASE
    WHEN o.aum_used < 60000000 THEN '$40M–$60M'
    WHEN o.aum_used < 80000000 THEN '$60M–$80M'
    ELSE '$80M–$100M'
  END                                                 AS aum_band,

  -- ── Contact Profile ──────────────────────────────────────────────────
  cp.PRIMARY_FIRM_NAME,
  cp.firm_crd,
  cp.TITLE_NAME,
  cp.REP_TYPE,
  cp.PRODUCING_ADVISOR,
  cp.INDUSTRY_TENURE_MONTHS,
  cp.CONTACT_OWNERSHIP_PERCENTAGE,
  cp.has_ownership,
  cp.REP_LICENSES,
  cp.has_series_7,
  cp.has_series_65,
  cp.has_series_66,
  cp.has_series_24,
  cp.has_cfp,
  cp.has_cfa,
  cp.is_series_65_only,
  cp.has_any_disclosure,
  cp.CONTACT_HAS_DISCLOSED_BANKRUPT,
  cp.CONTACT_HAS_DISCLOSED_CRIMINAL,
  cp.CONTACT_HAS_DISCLOSED_CUSTOMER_DISPUTE,
  cp.CONTACT_HAS_DISCLOSED_REGULATORY_EVENT,
  cp.CONTACT_HAS_DISCLOSED_TERMINATION,
  cp.LINKEDIN_PROFILE_URL,
  cp.likely_over_70,

  -- ── Firm Profile ─────────────────────────────────────────────────────
  fp.firm_name_fintrx,
  fp.ENTITY_CLASSIFICATION,
  fp.firm_state,
  fp.firm_city,
  fp.firm_num_employees,
  fp.firm_aum_current,
  fp.firm_disc_ratio_current,
  fp.is_wirehouse,
  fp.is_independent_ria,
  fp.is_hybrid_ria,
  fp.is_bank,
  fp.is_insurance,
  fp.is_broker_dealer,
  fp.fee_aum_pct,
  fp.fee_fixed,
  fp.fee_performance,
  fp.custodian_current,

  -- ── Exclusion Flags (flagged, not filtered) ──────────────────────────
  -- TRUE = this advisor would be excluded from a prospecting tier
  CASE
    WHEN fp.is_wirehouse = TRUE     THEN TRUE
    WHEN cp.likely_over_70 = TRUE   THEN TRUE
    WHEN efc.firm_crd IS NOT NULL   THEN TRUE
    ELSE FALSE
  END                                                 AS is_excluded,
  CASE
    WHEN fp.is_wirehouse = TRUE     THEN 'Wirehouse'
    WHEN cp.likely_over_70 = TRUE   THEN 'Likely Over 70'
    WHEN efc.firm_crd IS NOT NULL   THEN 'Excluded Firm CRD'
    ELSE NULL
  END                                                 AS exclusion_reason,

  -- ── PIT: Firm AUM at Opp Creation ────────────────────────────────────
  pfa.firm_aum_at_opp,
  pfa.firm_disc_aum_at_opp,
  pfa.firm_disc_ratio_at_opp,
  pfa.firm_aum_snapshot_year,
  pfa.firm_aum_snapshot_month,
  -- Was the AUM from a PIT historical snapshot (TRUE) or current fallback (FALSE)?
  (pfa.firm_aum_at_opp IS NOT NULL)                   AS firm_aum_is_pit,
  -- Best available firm AUM: historical if available, current otherwise
  COALESCE(pfa.firm_aum_at_opp, fp.firm_aum_current)  AS firm_aum_best,
  CASE
    WHEN COALESCE(pfa.firm_aum_at_opp, fp.firm_aum_current) < 100000000  THEN 'Under $100M'
    WHEN COALESCE(pfa.firm_aum_at_opp, fp.firm_aum_current) < 500000000  THEN '$100M–$500M'
    WHEN COALESCE(pfa.firm_aum_at_opp, fp.firm_aum_current) < 1000000000 THEN '$500M–$1B'
    WHEN COALESCE(pfa.firm_aum_at_opp, fp.firm_aum_current) < 5000000000 THEN '$1B–$5B'
    WHEN COALESCE(pfa.firm_aum_at_opp, fp.firm_aum_current) >= 5000000000 THEN '$5B+'
    ELSE 'Unknown'
  END                                                 AS firm_aum_bucket,

  -- ── PIT: Tenure at Current Firm ──────────────────────────────────────
  pt.firm_start_date_at_opp,
  pt.tenure_months_at_opp,
  pt.prior_firm_count,
  CASE
    WHEN pt.tenure_months_at_opp IS NULL THEN 'Unknown'
    WHEN pt.tenure_months_at_opp < 12    THEN '< 1 yr (Recent Mover)'
    WHEN pt.tenure_months_at_opp < 36    THEN '1–3 yrs'
    WHEN pt.tenure_months_at_opp < 60    THEN '3–5 yrs'
    WHEN pt.tenure_months_at_opp < 120   THEN '5–10 yrs'
    ELSE '10+ yrs'
  END                                                 AS tenure_bucket,
  -- Recent mover flags (signals portability / timing window)
  COALESCE(rpf.months_since_left_prior_firm <= 6,  FALSE) AS is_very_recent_mover,
  COALESCE(rpf.months_since_left_prior_firm <= 12, FALSE) AS is_recent_mover_12m,
  rpf.most_recent_prior_firm,
  rpf.months_since_left_prior_firm,

  -- ── PIT: Accolades ───────────────────────────────────────────────────
  COALESCE(pa.accolades_total_at_opp, 0)              AS accolades_total,
  COALESCE(pa.accolades_forbes, 0)                    AS accolades_forbes,
  COALESCE(pa.accolades_barrons, 0)                   AS accolades_barrons,
  COALESCE(pa.accolades_advisorhub, 0)                AS accolades_advisorhub,
  (COALESCE(pa.accolades_total_at_opp, 0) > 0)        AS has_any_accolade,

  -- ── PIT: Custodian ───────────────────────────────────────────────────
  pc.custodian_at_opp,
  COALESCE(pc.is_portable_custodian, FALSE)           AS is_portable_custodian,

  -- ── PIT: State Registrations ─────────────────────────────────────────
  COALESCE(psr.state_reg_count_at_opp, 0)             AS state_reg_count,
  (COALESCE(psr.state_reg_count_at_opp, 0) > 5)       AS is_multi_state,

  -- ── Firm Rep Count ───────────────────────────────────────────────────
  COALESCE(frc.fintrx_rep_count, 0)                   AS firm_rep_count,
  CASE
    WHEN COALESCE(frc.fintrx_rep_count, 0) <= 3   THEN 'Solo/Micro (1–3)'
    WHEN COALESCE(frc.fintrx_rep_count, 0) <= 10  THEN 'Small (4–10)'
    WHEN COALESCE(frc.fintrx_rep_count, 0) <= 50  THEN 'Mid (11–50)'
    ELSE 'Large (51+)'
  END                                                 AS firm_size_bucket

FROM sfdc_opps o
LEFT JOIN contact_profile          cp  ON cp.crd = o.crd
LEFT JOIN firm_profile             fp  ON fp.firm_crd = cp.firm_crd
LEFT JOIN excluded_firm_crds_list  efc ON efc.firm_crd = cp.firm_crd
LEFT JOIN pit_firm_aum             pfa ON pfa.opportunity_id = o.opportunity_id
LEFT JOIN pit_tenure               pt  ON pt.opportunity_id = o.opportunity_id
LEFT JOIN recent_prior_firm        rpf ON rpf.opportunity_id = o.opportunity_id
LEFT JOIN pit_accolades            pa  ON pa.opportunity_id = o.opportunity_id
LEFT JOIN pit_custodian            pc  ON pc.opportunity_id = o.opportunity_id
LEFT JOIN pit_state_registrations  psr ON psr.opportunity_id = o.opportunity_id
LEFT JOIN firm_rep_count           frc ON frc.firm_crd = cp.firm_crd
;


-- ============================================================
-- PHASE 2: AGGREGATION QUERIES
-- Run each block independently against the Phase 1 table.
-- Recommended order: 2A → 2B → 2C → 2D → 2E → 2F → 2G
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 2A: Cohort Overview
-- Start here. Understand the size of the cohort, how much is
-- disqualified, and what the outcome split looks like before
-- you read too much into signal distributions.
-- ─────────────────────────────────────────────────────────────
SELECT
  COUNT(*)                                            AS total_opps,
  COUNT(DISTINCT crd)                                 AS unique_advisors,
  COUNTIF(is_excluded)                                AS excluded_count,
  ROUND(COUNTIF(is_excluded) * 100.0 / COUNT(*), 1)  AS pct_excluded,
  COUNTIF(has_any_disclosure)                         AS has_disclosure,
  COUNTIF(likely_over_70)                             AS likely_over_70,
  -- Outcome split
  COUNTIF(is_won = TRUE)                              AS closed_won,
  COUNTIF(is_closed = TRUE AND is_won = FALSE)        AS closed_lost,
  COUNTIF(is_closed = FALSE)                          AS open_pipeline,
  -- Win rate among closed opps
  ROUND(
    SAFE_DIVIDE(
      COUNTIF(is_won = TRUE),
      COUNTIF(is_closed = TRUE)
    ) * 100, 1
  )                                                   AS closed_win_rate_pct,
  -- AUM data completeness
  COUNTIF(firm_aum_is_pit = TRUE)                     AS aum_from_historical_snapshot,
  COUNTIF(firm_aum_is_pit = FALSE OR firm_aum_is_pit IS NULL) AS aum_from_current_fallback
FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`;


-- ─────────────────────────────────────────────────────────────
-- 2B: Signal Distributions by Outcome
-- The core exploratory query. Compares won vs. lost vs. open
-- across every key signal. Look for the largest deltas —
-- those are your tier inclusion criteria.
-- Filter: exclude known-disqualified firms for cleaner signal.
-- ─────────────────────────────────────────────────────────────
SELECT
  CASE
    WHEN is_won = TRUE                      THEN '1. Won'
    WHEN is_closed = TRUE AND is_won = FALSE THEN '2. Lost'
    ELSE '3. Open'
  END                                                 AS outcome,
  COUNT(*)                                            AS opp_count,

  -- ── License profile ──────────────────────────────────────
  ROUND(AVG(IF(has_series_65,      1, 0)) * 100, 1)  AS pct_series_65,
  ROUND(AVG(IF(has_series_7,       1, 0)) * 100, 1)  AS pct_series_7,
  ROUND(AVG(IF(is_series_65_only,  1, 0)) * 100, 1)  AS pct_series_65_only,
  ROUND(AVG(IF(has_cfp,            1, 0)) * 100, 1)  AS pct_cfp,
  ROUND(AVG(IF(has_cfa,            1, 0)) * 100, 1)  AS pct_cfa,

  -- ── Firm type ────────────────────────────────────────────
  ROUND(AVG(IF(is_independent_ria, 1, 0)) * 100, 1)  AS pct_independent_ria,
  ROUND(AVG(IF(is_hybrid_ria,      1, 0)) * 100, 1)  AS pct_hybrid_ria,
  ROUND(AVG(IF(is_broker_dealer,   1, 0)) * 100, 1)  AS pct_broker_dealer,

  -- ── Firm size ────────────────────────────────────────────
  ROUND(AVG(firm_rep_count), 1)                       AS avg_firm_rep_count,
  ROUND(AVG(IF(firm_size_bucket = 'Solo/Micro (1–3)', 1, 0)) * 100, 1) AS pct_solo_micro,
  ROUND(AVG(IF(firm_size_bucket = 'Small (4–10)',     1, 0)) * 100, 1) AS pct_small_firm,

  -- ── Mobility / Portability ───────────────────────────────
  ROUND(AVG(IF(is_recent_mover_12m,   1, 0)) * 100, 1) AS pct_recent_mover_12m,
  ROUND(AVG(IF(is_very_recent_mover,  1, 0)) * 100, 1) AS pct_very_recent_mover_6m,
  ROUND(AVG(COALESCE(prior_firm_count, 0)), 1)          AS avg_prior_firm_count,

  -- ── Tenure ───────────────────────────────────────────────
  ROUND(AVG(tenure_months_at_opp), 1)                 AS avg_tenure_months,
  ROUND(APPROX_QUANTILES(tenure_months_at_opp, 4)[OFFSET(2)], 0) AS median_tenure_months,

  -- ── Custodian & Portability ──────────────────────────────
  ROUND(AVG(IF(is_portable_custodian, 1, 0)) * 100, 1) AS pct_portable_custodian,

  -- ── Ownership ────────────────────────────────────────────
  ROUND(AVG(IF(has_ownership, 1, 0)) * 100, 1)        AS pct_has_ownership,

  -- ── Accolades ────────────────────────────────────────────
  ROUND(AVG(IF(has_any_accolade, 1, 0)) * 100, 1)     AS pct_has_accolade,

  -- ── Disclosures ──────────────────────────────────────────
  ROUND(AVG(IF(has_any_disclosure, 1, 0)) * 100, 1)   AS pct_has_disclosure,

  -- ── Firm AUM context ─────────────────────────────────────
  ROUND(AVG(firm_aum_best) / 1e6, 1)                  AS avg_firm_aum_m,
  ROUND(APPROX_QUANTILES(firm_aum_best, 4)[OFFSET(2)] / 1e6, 1) AS median_firm_aum_m,

  -- ── Geographic footprint ─────────────────────────────────
  ROUND(AVG(state_reg_count), 1)                       AS avg_state_reg_count,
  ROUND(AVG(IF(is_multi_state, 1, 0)) * 100, 1)        AS pct_multi_state

FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
WHERE is_excluded = FALSE
GROUP BY 1
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────
-- 2C: Tenure Bucket × Outcome
-- Understand where in the tenure lifecycle these advisors sit
-- and whether shorter or longer tenure predicts better outcomes.
-- ─────────────────────────────────────────────────────────────
SELECT
  tenure_bucket,
  COUNT(*)                                            AS total,
  COUNTIF(is_won = TRUE)                              AS won,
  COUNTIF(is_closed = TRUE AND is_won = FALSE)        AS lost,
  COUNTIF(is_closed = FALSE)                          AS open,
  ROUND(
    SAFE_DIVIDE(COUNTIF(is_won = TRUE), COUNTIF(is_closed = TRUE)) * 100, 1
  )                                                   AS win_rate_pct
FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
WHERE is_excluded = FALSE
GROUP BY 1
ORDER BY
  CASE tenure_bucket
    WHEN '< 1 yr (Recent Mover)' THEN 1
    WHEN '1–3 yrs'               THEN 2
    WHEN '3–5 yrs'               THEN 3
    WHEN '5–10 yrs'              THEN 4
    WHEN '10+ yrs'               THEN 5
    ELSE 6
  END;


-- ─────────────────────────────────────────────────────────────
-- 2D: Firm AUM Bucket × Outcome
-- Helps define the firm-AUM guardrails for the new tier.
-- A $40M–$100M advisor at a $5B+ firm is different from one
-- at a $100M firm — the latter owns their book.
-- ─────────────────────────────────────────────────────────────
SELECT
  firm_aum_bucket,
  firm_size_bucket,
  COUNT(*)                                            AS total,
  COUNTIF(is_won = TRUE)                              AS won,
  COUNTIF(is_closed = TRUE AND is_won = FALSE)        AS lost,
  ROUND(
    SAFE_DIVIDE(COUNTIF(is_won = TRUE), COUNTIF(is_closed = TRUE)) * 100, 1
  )                                                   AS win_rate_pct
FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
WHERE is_excluded = FALSE
GROUP BY 1, 2
ORDER BY 1, 6 DESC;


-- ─────────────────────────────────────────────────────────────
-- 2E: AUM Band × License Type Cross-Tab
-- Are $80M–$100M advisors disproportionately Series 65-only
-- (pure RIA) vs. $40M–$60M who might still be dual-reg?
-- This could support sub-tier logic within the 40–100 range.
-- ─────────────────────────────────────────────────────────────
SELECT
  aum_band,
  COUNT(*)                                            AS total,
  ROUND(AVG(IF(is_series_65_only, 1, 0)) * 100, 1)   AS pct_series_65_only,
  ROUND(AVG(IF(has_series_7,      1, 0)) * 100, 1)   AS pct_series_7,
  ROUND(AVG(IF(has_cfp,           1, 0)) * 100, 1)   AS pct_cfp,
  ROUND(AVG(IF(has_cfa,           1, 0)) * 100, 1)   AS pct_cfa,
  ROUND(AVG(IF(is_won = TRUE,     1, 0)) * 100, 1)   AS overall_won_pct
FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
WHERE is_excluded = FALSE
  AND is_closed = TRUE
GROUP BY 1
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────
-- 2F: Closed-Lost Reason Breakdown
-- What's killing these deals? Helps you interpret which signals
-- are "objection risks" vs. true disqualifiers.
-- ─────────────────────────────────────────────────────────────
SELECT
  closed_lost_reason,
  closed_lost_details,
  COUNT(*)                                            AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1)  AS pct_of_lost
FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
WHERE is_closed = TRUE
  AND is_won = FALSE
  AND is_excluded = FALSE
GROUP BY 1, 2
ORDER BY 3 DESC
LIMIT 30;


-- ─────────────────────────────────────────────────────────────
-- 2G: Exclusion Analysis
-- Before finalizing tier rules, understand how many of the opps
-- in this cohort are disqualified and why. Also surfaces the
-- wirehouse/large-firm advisors that may still be recruitable
-- as special cases (e.g., M&A disruption like V3.5.0 tier).
-- ─────────────────────────────────────────────────────────────
SELECT
  exclusion_reason,
  COUNT(*)                                            AS total_opps,
  COUNTIF(is_won = TRUE)                              AS won,
  COUNTIF(is_closed = TRUE AND is_won = FALSE)        AS lost,
  -- Win rate among excluded opps (may still signal opportunity)
  ROUND(
    SAFE_DIVIDE(COUNTIF(is_won = TRUE), COUNTIF(is_closed = TRUE)) * 100, 1
  )                                                   AS win_rate_pct
FROM `savvy-gtm-analytics.ml_features.aum_40_100m_signal_profile`
GROUP BY 1
ORDER BY 2 DESC;
