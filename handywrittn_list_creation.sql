-- Handwritten List Creation Query
-- Purpose: Combine craig-list, perry-list, and pirate-list with FinTrx contact data
-- Created: 2026-01-30
--
-- Notes:
-- - craig-list and perry-list use "FA_CRD" column
-- - pirate-list uses "CRD" column
-- - Matches against RIA_CONTACT_CRD_ID in ria_contacts_current
-- - Not all records will have CRD matches (some CRDs are missing in source lists)
-- - Records without valid CRDs will have NULL address/business info
--
-- Schema reference:
--   craig-list: First_Name, Last_Name, FA_CRD (INTEGER)
--   perry-list: First_Name, Last_Name, FA_CRD (INTEGER)
--   pirate-list: Name (combined), CRD (INTEGER)
--   ria_contacts_current: RIA_CONTACT_CRD_ID, CONTACT_FIRST_NAME, CONTACT_LAST_NAME, 
--                         PRIMARY_FIRM_NAME, PRIMARY_LOCATION_* fields, LINKEDIN_PROFILE_URL

WITH combined_lists AS (
  -- Craig's List (uses FA_CRD)
  SELECT 
    SAFE_CAST(FA_CRD AS INT64) AS crd,
    First_Name AS first_name,
    Last_Name AS last_name,
    'craig-list' AS list_source
  FROM `savvy-gtm-analytics.savvy_analytics.craig-list`

  UNION ALL

  -- Perry's List (uses FA_CRD)
  SELECT 
    SAFE_CAST(FA_CRD AS INT64) AS crd,
    First_Name AS first_name,
    Last_Name AS last_name,
    'perry-list' AS list_source
  FROM `savvy-gtm-analytics.savvy_analytics.perry-list`

  UNION ALL

  -- Pirate List (uses CRD, has combined Name field)
  SELECT 
    SAFE_CAST(CRD AS INT64) AS crd,
    -- Split the Name field on first space for first name
    SPLIT(Name, ' ')[SAFE_OFFSET(0)] AS first_name,
    -- Everything after the first space is the last name
    CASE 
      WHEN ARRAY_LENGTH(SPLIT(Name, ' ')) > 1 
      THEN TRIM(SUBSTR(Name, STRPOS(Name, ' ') + 1))
      ELSE NULL 
    END AS last_name,
    'pirate-list' AS list_source
  FROM `savvy-gtm-analytics.savvy_analytics.pirate-list`
)

SELECT 
  -- Use FinTrx first/last name if available (more accurate), fall back to list names
  COALESCE(ria.CONTACT_FIRST_NAME, cl.first_name) AS first_name,
  COALESCE(ria.CONTACT_LAST_NAME, cl.last_name) AS last_name,
  ria.PRIMARY_FIRM_NAME AS business_name,
  ria.PRIMARY_LOCATION_STREET_1 AS address_line_1,
  ria.PRIMARY_LOCATION_STREET_2 AS address_line_2,
  ria.PRIMARY_LOCATION_CITY AS city,
  ria.PRIMARY_LOCATION_STATE AS state,
  ria.PRIMARY_LOCATION_POSTAL AS postal_code,
  'United States' AS country,
  cl.list_source AS list,
  ria.LINKEDIN_PROFILE_URL AS linkedin

FROM combined_lists cl
LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` ria
  ON cl.crd = ria.RIA_CONTACT_CRD_ID

ORDER BY 
  cl.list_source,
  COALESCE(ria.CONTACT_LAST_NAME, cl.last_name),
  COALESCE(ria.CONTACT_FIRST_NAME, cl.first_name);


-- =============================================================================
-- ALTERNATIVE: Only records WITH valid CRD matches (excludes null/unmatched CRDs)
-- Uncomment and run this instead if you only want records with address data
-- =============================================================================
/*
WITH combined_lists AS (
  SELECT 
    SAFE_CAST(FA_CRD AS INT64) AS crd,
    First_Name AS first_name,
    Last_Name AS last_name,
    'craig-list' AS list_source
  FROM `savvy-gtm-analytics.savvy_analytics.craig-list`
  WHERE FA_CRD IS NOT NULL

  UNION ALL

  SELECT 
    SAFE_CAST(FA_CRD AS INT64) AS crd,
    First_Name AS first_name,
    Last_Name AS last_name,
    'perry-list' AS list_source
  FROM `savvy-gtm-analytics.savvy_analytics.perry-list`
  WHERE FA_CRD IS NOT NULL

  UNION ALL

  SELECT 
    SAFE_CAST(CRD AS INT64) AS crd,
    SPLIT(Name, ' ')[SAFE_OFFSET(0)] AS first_name,
    CASE 
      WHEN ARRAY_LENGTH(SPLIT(Name, ' ')) > 1 
      THEN TRIM(SUBSTR(Name, STRPOS(Name, ' ') + 1))
      ELSE NULL 
    END AS last_name,
    'pirate-list' AS list_source
  FROM `savvy-gtm-analytics.savvy_analytics.pirate-list`
  WHERE CRD IS NOT NULL
)

SELECT 
  COALESCE(ria.CONTACT_FIRST_NAME, cl.first_name) AS first_name,
  COALESCE(ria.CONTACT_LAST_NAME, cl.last_name) AS last_name,
  ria.PRIMARY_FIRM_NAME AS business_name,
  ria.PRIMARY_LOCATION_STREET_1 AS address_line_1,
  ria.PRIMARY_LOCATION_STREET_2 AS address_line_2,
  ria.PRIMARY_LOCATION_CITY AS city,
  ria.PRIMARY_LOCATION_STATE AS state,
  ria.PRIMARY_LOCATION_POSTAL AS postal_code,
  'United States' AS country,
  cl.list_source AS list,
  ria.LINKEDIN_PROFILE_URL AS linkedin

FROM combined_lists cl
INNER JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` ria
  ON cl.crd = ria.RIA_CONTACT_CRD_ID

ORDER BY 
  cl.list_source,
  ria.CONTACT_LAST_NAME,
  ria.CONTACT_FIRST_NAME;
*/
