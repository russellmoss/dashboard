-- Platform firms CRD verification and correction
-- Source of truth: savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current (CRD_ID, NAME)
-- Target: savvy-gtm-analytics.FinTrx_data_CA.platform_firms (firm_crd, firm_name)
--
-- Run this in BigQuery (Console or bq) where platform_firms Google Sheet is accessible.
-- If you get "Permission denied while getting Drive credentials", materialize platform_firms
-- into a native table first (see README below).
--
-- Name normalization: strip punctuation and collapse spaces so "Allworth Financial, L.P."
-- and "Allworth Financial LP" count as the same firm (no CRD change needed).

-- =============================================================================
-- STEP 0: Normalized name helper (use in all steps below)
-- =============================================================================
-- Inline: LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(name,''), r'[,\.]', ''), r'\s+', ' ')))

-- =============================================================================
-- STEP 1: Verification — current platform_firms vs ria_firms_current (NORMALIZED)
-- =============================================================================
-- MATCH when normalized(ria.NAME) = normalized(firm_name) so punctuation-only diffs are MATCH.
WITH verification AS (
  SELECT
    p.firm_name,
    p.firm_crd AS platform_firm_crd,
    r.CRD_ID   AS ria_crd_id,
    r.NAME     AS ria_name,
    CASE
      WHEN r.CRD_ID IS NULL
        THEN 'CRD_NOT_IN_RIA_FIRMS'
      WHEN LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(r.NAME, ''), r'[,\.]', ''), r'\s+', ' ')))
        <> LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p.firm_name, ''), r'[,\.]', ''), r'\s+', ' ')))
        THEN 'NAME_MISMATCH'
      ELSE 'MATCH'
    END AS verification_status
  FROM `savvy-gtm-analytics.FinTrx_data_CA.platform_firms` p
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` r
    ON r.CRD_ID = p.firm_crd
)
SELECT
  verification_status,
  COUNT(*) AS cnt
FROM verification
GROUP BY 1
ORDER BY 1;

-- =============================================================================
-- STEP 2: Mismatch detail (firm_name, current CRD, RIA name for that CRD) — NORMALIZED
-- =============================================================================
WITH verification AS (
  SELECT
    p.firm_name,
    p.firm_crd AS platform_firm_crd,
    r.NAME     AS ria_name_for_current_crd,
    CASE
      WHEN r.CRD_ID IS NULL THEN 'CRD_NOT_IN_RIA_FIRMS'
      WHEN LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(r.NAME, ''), r'[,\.]', ''), r'\s+', ' ')))
        <> LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p.firm_name, ''), r'[,\.]', ''), r'\s+', ' ')))
        THEN 'NAME_MISMATCH'
      ELSE 'MATCH'
    END AS verification_status
  FROM `savvy-gtm-analytics.FinTrx_data_CA.platform_firms` p
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` r
    ON r.CRD_ID = p.firm_crd
)
SELECT
  firm_name,
  platform_firm_crd,
  ria_name_for_current_crd,
  verification_status
FROM verification
WHERE verification_status <> 'MATCH'
ORDER BY firm_name;

-- =============================================================================
-- STEP 3: Correct CRD from ria_firms_current (NORMALIZED exact match on name)
-- =============================================================================
-- Only suggests CRD when ria_firms has a row with same normalized name (no SOUNDEX).
WITH norm AS (
  SELECT
    name,
    LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(name, ''), r'[,\.]', ''), r'\s+', ' '))) AS norm_name
  FROM (SELECT NAME AS name FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`)
),
mismatches AS (
  SELECT
    p.firm_name,
    p.firm_crd AS current_firm_crd,
    r.NAME     AS ria_name_for_current_crd,
    CASE
      WHEN r.CRD_ID IS NULL THEN 'CRD_NOT_IN_RIA_FIRMS'
      WHEN LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(r.NAME, ''), r'[,\.]', ''), r'\s+', ' ')))
        <> LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p.firm_name, ''), r'[,\.]', ''), r'\s+', ' ')))
        THEN 'NAME_MISMATCH'
      ELSE 'MATCH'
    END AS status
  FROM `savvy-gtm-analytics.FinTrx_data_CA.platform_firms` p
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` r
    ON r.CRD_ID = p.firm_crd
  WHERE (r.CRD_ID IS NULL)
     OR (LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(r.NAME, ''), r'[,\.]', ''), r'\s+', ' ')))
         <> LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p.firm_name, ''), r'[,\.]', ''), r'\s+', ' '))))
),
ria_norm AS (
  SELECT
    CRD_ID,
    NAME,
    LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(NAME, ''), r'[,\.]', ''), r'\s+', ' '))) AS norm_name
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`
),
exact_candidates AS (
  SELECT
    m.firm_name,
    m.current_firm_crd,
    m.ria_name_for_current_crd,
    m.status,
    r.CRD_ID AS suggested_crd,
    r.NAME   AS suggested_name,
    'NORMALIZED_EXACT' AS match_type
  FROM mismatches m
  INNER JOIN ria_norm r
    ON r.norm_name = LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(m.firm_name, ''), r'[,\.]', ''), r'\s+', ' ')))
)
SELECT
  firm_name,
  current_firm_crd,
  ria_name_for_current_crd,
  status,
  suggested_crd,
  suggested_name,
  match_type
FROM exact_candidates
ORDER BY firm_name, suggested_crd;

-- =============================================================================
-- STEP 4: Fuzzy match — MANUAL REVIEW ONLY (do not use for Sheet updates)
-- Use ria_firms_current with SOUNDEX / LIKE for firms that have no normalized-exact match.
-- =============================================================================
WITH mismatches AS (
  SELECT
    p.firm_name,
    p.firm_crd AS current_firm_crd
  FROM `savvy-gtm-analytics.FinTrx_data_CA.platform_firms` p
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` r
    ON r.CRD_ID = p.firm_crd
    AND LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(r.NAME, ''), r'[,\.]', ''), r'\s+', ' ')))
      = LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p.firm_name, ''), r'[,\.]', ''), r'\s+', ' ')))
  WHERE r.CRD_ID IS NULL
),
fuzzy_candidates AS (
  SELECT
    m.firm_name,
    m.current_firm_crd,
    r.CRD_ID AS suggested_crd,
    r.NAME   AS suggested_name,
    CASE
      WHEN SOUNDEX(TRIM(r.NAME)) = SOUNDEX(TRIM(m.firm_name)) THEN 'SOUNDEX'
      WHEN LOWER(r.NAME) LIKE CONCAT('%', LOWER(TRIM(m.firm_name)), '%')
        OR LOWER(m.firm_name) LIKE CONCAT('%', LOWER(TRIM(r.NAME)), '%')
        THEN 'LIKE'
      ELSE 'OTHER'
    END AS match_type
  FROM mismatches m
  CROSS JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` r
  WHERE (
    SOUNDEX(TRIM(r.NAME)) = SOUNDEX(TRIM(m.firm_name))
    OR LOWER(r.NAME) LIKE CONCAT('%', LOWER(TRIM(m.firm_name)), '%')
    OR LOWER(m.firm_name) LIKE CONCAT('%', LOWER(TRIM(r.NAME)), '%')
  )
)
SELECT
  firm_name,
  current_firm_crd,
  suggested_crd,
  suggested_name,
  match_type
FROM fuzzy_candidates
ORDER BY firm_name, match_type, suggested_name;

-- =============================================================================
-- STEP 5a: Consolidated correction list — NORMALIZED EXACT only (safe for Sheet updates)
-- Suggests new CRD only when ria_firms has a normalized-exact name match. No SOUNDEX.
-- Firms with no normalized match get suggested_crd = NULL, match_type = 'REVIEW_MANUAL'.
-- =============================================================================
WITH verification AS (
  SELECT
    p.firm_name,
    p.firm_crd AS current_crd,
    r.NAME     AS ria_name_for_current_crd,
    CASE
      WHEN r.CRD_ID IS NULL THEN 'CRD_NOT_IN_RIA_FIRMS'
      WHEN LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(r.NAME, ''), r'[,\.]', ''), r'\s+', ' ')))
        <> LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(p.firm_name, ''), r'[,\.]', ''), r'\s+', ' ')))
        THEN 'NAME_MISMATCH'
      ELSE 'MATCH'
    END AS status
  FROM `savvy-gtm-analytics.FinTrx_data_CA.platform_firms` p
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current` r
    ON r.CRD_ID = p.firm_crd
),
ria_norm AS (
  SELECT
    CRD_ID,
    NAME,
    LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(NAME, ''), r'[,\.]', ''), r'\s+', ' '))) AS norm_name
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_firms_current`
),
-- All platform mismatches that have at least one normalized-exact match in ria_firms
normalized_exact AS (
  SELECT
    v.firm_name,
    v.current_crd,
    v.ria_name_for_current_crd,
    v.status,
    r.CRD_ID AS suggested_crd,
    r.NAME   AS suggested_name,
    'NORMALIZED_EXACT' AS match_type
  FROM verification v
  INNER JOIN ria_norm r
    ON r.norm_name = LOWER(TRIM(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(v.firm_name, ''), r'[,\.]', ''), r'\s+', ' ')))
  WHERE v.status <> 'MATCH'
),
-- One row per firm: prefer current_crd if it appears in the match set, else MIN(suggested_crd)
correction_list AS (
  SELECT
    firm_name,
    MAX(current_crd) AS current_crd,
    MAX(ria_name_for_current_crd) AS ria_name_for_current_crd,
    MAX(status) AS status,
    COALESCE(
      MAX(CASE WHEN suggested_crd = current_crd THEN current_crd END),
      MIN(suggested_crd)
    ) AS suggested_crd,
    MIN(suggested_name) AS suggested_name,
    'NORMALIZED_EXACT' AS match_type
  FROM normalized_exact
  GROUP BY firm_name
),
-- Mismatches with no normalized match in ria_firms → REVIEW_MANUAL, no suggested CRD
remaining AS (
  SELECT
    v.firm_name,
    v.current_crd,
    v.ria_name_for_current_crd,
    v.status,
    CAST(NULL AS INT64) AS suggested_crd,
    CAST(NULL AS STRING) AS suggested_name,
    'REVIEW_MANUAL' AS match_type
  FROM verification v
  WHERE v.status <> 'MATCH'
    AND NOT EXISTS (SELECT 1 FROM correction_list c WHERE c.firm_name = v.firm_name)
)
SELECT
  firm_name,
  current_crd AS current_firm_crd,
  suggested_crd AS new_firm_crd_to_use,
  suggested_name,
  status,
  match_type
FROM (SELECT * FROM correction_list UNION ALL SELECT * FROM remaining)
ORDER BY (CASE WHEN match_type = 'REVIEW_MANUAL' THEN 1 ELSE 0 END), firm_name;

-- =============================================================================
-- STEP 5b (optional): Correct CRD from ria_contacts_current
-- Use when firm name appears as RIA_INVESTOR_NAME (JSON array); parse and match.
-- =============================================================================
-- ria_contacts_current has RIA_INVESTOR_CRD_ID and RIA_INVESTOR_NAME as string arrays
-- e.g. "[8158]", "[\"Robert W. Baird & Co Incorporated\"]"
-- Unnest and use for fuzzy backup:
/*
WITH contact_firms AS (
  SELECT
    CAST(TRIM(REPLACE(REPLACE(crds, '[', ''), ']', '')) AS INT64) AS crd_id,
    TRIM(REPLACE(REPLACE(REPLACE(names, '[', ''), ']', ''), '"', '')) AS firm_name_contact
  FROM `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current`,
  UNNEST(SPLIT(RIA_INVESTOR_CRD_ID, ',')) AS crds
  WITH OFFSET AS i
  JOIN UNNEST(SPLIT(RIA_INVESTOR_NAME, '","')) AS names WITH OFFSET AS j ON i = j
  WHERE RIA_INVESTOR_CRD_ID IS NOT NULL AND RIA_INVESTOR_NAME IS NOT NULL
  LIMIT 1000  -- tune or remove for full scan
)
SELECT * FROM contact_firms;
*/
