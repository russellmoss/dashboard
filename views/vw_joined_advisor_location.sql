-- =============================================================================
-- vw_joined_advisor_location
-- One row per joined advisor with best available address for mapping
-- Location: savvy-gtm-analytics.Tableau_Views (northamerica-northeast2)
-- =============================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_joined_advisor_location` AS

-- State name to abbreviation mapping
WITH state_abbrev AS (
  SELECT state_name, abbrev FROM UNNEST([
    STRUCT('Alabama' AS state_name, 'AL' AS abbrev),
    STRUCT('Alaska', 'AK'), STRUCT('Arizona', 'AZ'), STRUCT('Arkansas', 'AR'),
    STRUCT('California', 'CA'), STRUCT('Colorado', 'CO'), STRUCT('Connecticut', 'CT'),
    STRUCT('Delaware', 'DE'), STRUCT('Florida', 'FL'), STRUCT('Georgia', 'GA'),
    STRUCT('Hawaii', 'HI'), STRUCT('Idaho', 'ID'), STRUCT('Illinois', 'IL'),
    STRUCT('Indiana', 'IN'), STRUCT('Iowa', 'IA'), STRUCT('Kansas', 'KS'),
    STRUCT('Kentucky', 'KY'), STRUCT('Louisiana', 'LA'), STRUCT('Maine', 'ME'),
    STRUCT('Maryland', 'MD'), STRUCT('Massachusetts', 'MA'), STRUCT('Michigan', 'MI'),
    STRUCT('Minnesota', 'MN'), STRUCT('Mississippi', 'MS'), STRUCT('Missouri', 'MO'),
    STRUCT('Montana', 'MT'), STRUCT('Nebraska', 'NE'), STRUCT('Nevada', 'NV'),
    STRUCT('New Hampshire', 'NH'), STRUCT('New Jersey', 'NJ'), STRUCT('New Mexico', 'NM'),
    STRUCT('New York', 'NY'), STRUCT('North Carolina', 'NC'), STRUCT('North Dakota', 'ND'),
    STRUCT('Ohio', 'OH'), STRUCT('Oklahoma', 'OK'), STRUCT('Oregon', 'OR'),
    STRUCT('Pennsylvania', 'PA'), STRUCT('Rhode Island', 'RI'), STRUCT('South Carolina', 'SC'),
    STRUCT('South Dakota', 'SD'), STRUCT('Tennessee', 'TN'), STRUCT('Texas', 'TX'),
    STRUCT('Utah', 'UT'), STRUCT('Vermont', 'VT'), STRUCT('Virginia', 'VA'),
    STRUCT('Washington', 'WA'), STRUCT('West Virginia', 'WV'), STRUCT('Wisconsin', 'WI'),
    STRUCT('Wyoming', 'WY'), STRUCT('District of Columbia', 'DC'),
    -- Canadian provinces
    STRUCT('Ontario', 'ON'), STRUCT('Quebec', 'QC'), STRUCT('British Columbia', 'BC'),
    STRUCT('Alberta', 'AB'), STRUCT('Manitoba', 'MB'), STRUCT('Saskatchewan', 'SK'),
    STRUCT('Nova Scotia', 'NS'), STRUCT('New Brunswick', 'NB'),
    STRUCT('Newfoundland and Labrador', 'NL'), STRUCT('Prince Edward Island', 'PE')
  ])
),

joined_base AS (
  -- Get joined advisors from funnel master (same criteria as funnel performance page)
  -- Uses is_joined_unique = 1 to match the funnel "joined" count exactly
  SELECT
    f.primary_key,
    f.Full_Opportunity_ID__c,
    f.Full_prospect_id__c,
    f.advisor_name,
    f.advisor_join_date__c,
    f.StageName,
    f.Opportunity_AUM,
    f.SGA_Owner_Name__c,
    f.SGM_Owner_Name__c,
    f.Original_source,
    f.Channel_Grouping_Name,
    f.recordtypeid,
    f.record_type_name
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  WHERE f.advisor_join_date__c IS NOT NULL
    AND f.advisor_join_date__c > DATE('2018-01-01')
    AND f.is_joined_unique = 1
),

-- Get one lead per opportunity (avoid duplicates when multiple leads convert to same opp)
lead_crd AS (
  SELECT
    ConvertedOpportunityId,
    -- Take the first non-null FA_CRD__c if there are multiple leads
    MAX(FA_CRD__c) AS FA_CRD__c
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE ConvertedOpportunityId IS NOT NULL
  GROUP BY ConvertedOpportunityId
),

with_addresses AS (
  SELECT
    jb.*,

    -- Opportunity and Contact IDs for joins
    o.ContactId,
    o.AccountId,
    o.FA_CRD__c AS opp_crd,
    l.FA_CRD__c AS lead_crd,

    -- Contact address fields
    c.MailingStreet AS contact_street,
    c.MailingCity AS contact_city,
    c.MailingState AS contact_state,
    c.MailingPostalCode AS contact_postal,
    c.MailingCountry AS contact_country,
    c.MailingLatitude AS contact_lat,
    c.MailingLongitude AS contact_long,

    -- Account address fields
    a.BillingStreet AS account_street,
    a.BillingCity AS account_city,
    a.BillingState AS account_state,
    a.BillingPostalCode AS account_postal,
    a.BillingCountry AS account_country,
    a.BillingLatitude AS account_lat,
    a.BillingLongitude AS account_long,

    -- FinTrx address fields (PRIMARY_LOCATION)
    ft.PRIMARY_LOCATION_STREET_1 AS fintrx_street_1,
    ft.PRIMARY_LOCATION_STREET_2 AS fintrx_street_2,
    ft.PRIMARY_LOCATION_CITY AS fintrx_city,
    ft.PRIMARY_LOCATION_STATE AS fintrx_state,
    ft.PRIMARY_LOCATION_POSTAL AS fintrx_postal,
    ft.PRIMARY_LOCATION_COUNTRY AS fintrx_country

  FROM joined_base jb

  -- Join to Opportunity for ContactId, AccountId, FA_CRD__c
  JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
    ON jb.Full_Opportunity_ID__c = o.Id

  -- Join to aggregated Lead CRD (one row per opportunity, avoids duplicates)
  LEFT JOIN lead_crd l
    ON l.ConvertedOpportunityId = o.Id

  -- Join to Contact
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Contact` c
    ON o.ContactId = c.Id AND c.IsDeleted = FALSE

  -- Join to Account
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Account` a
    ON o.AccountId = a.Id AND a.IsDeleted = FALSE

  -- Join to FinTrx (use Opp CRD, fallback to Lead CRD)
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current` ft
    ON SAFE_CAST(NULLIF(TRIM(COALESCE(o.FA_CRD__c, l.FA_CRD__c)), '') AS INT64) = ft.RIA_CONTACT_CRD_ID
),

with_coalesced_address AS (
  SELECT
    -- Core identifiers
    primary_key,
    Full_Opportunity_ID__c,
    Full_prospect_id__c,
    advisor_name,

    -- Dates
    advisor_join_date__c,

    -- Stage & metrics
    StageName,
    Opportunity_AUM,

    -- Ownership
    SGA_Owner_Name__c,
    SGM_Owner_Name__c,

    -- Source/Channel
    Original_source,
    Channel_Grouping_Name,

    -- Record type
    recordtypeid,
    record_type_name,

    -- COALESCED ADDRESS (Contact -> FinTrx -> Account)
    COALESCE(
      NULLIF(TRIM(contact_street), ''),
      NULLIF(TRIM(fintrx_street_1), ''),
      NULLIF(TRIM(account_street), '')
    ) AS address_street_1,

    NULLIF(TRIM(fintrx_street_2), '') AS address_street_2,

    COALESCE(
      NULLIF(TRIM(contact_city), ''),
      NULLIF(TRIM(fintrx_city), ''),
      NULLIF(TRIM(account_city), '')
    ) AS address_city,

    -- Raw state value before normalization (used for lookup)
    COALESCE(
      NULLIF(TRIM(contact_state), ''),
      NULLIF(TRIM(fintrx_state), ''),
      NULLIF(TRIM(account_state), '')
    ) AS address_state_raw,

    COALESCE(
      NULLIF(TRIM(contact_postal), ''),
      NULLIF(TRIM(fintrx_postal), ''),
      NULLIF(TRIM(account_postal), '')
    ) AS address_postal,

    COALESCE(
      NULLIF(TRIM(contact_country), ''),
      NULLIF(TRIM(fintrx_country), ''),
      NULLIF(TRIM(account_country), '')
    ) AS address_country,

    -- Address source indicator
    CASE
      WHEN NULLIF(TRIM(contact_city), '') IS NOT NULL OR NULLIF(TRIM(contact_state), '') IS NOT NULL THEN 'Contact'
      WHEN NULLIF(TRIM(fintrx_city), '') IS NOT NULL OR NULLIF(TRIM(fintrx_state), '') IS NOT NULL THEN 'FinTrx'
      WHEN NULLIF(TRIM(account_city), '') IS NOT NULL OR NULLIF(TRIM(account_state), '') IS NOT NULL THEN 'Account'
      ELSE 'Unknown'
    END AS address_source,

    -- SFDC lat/long (will be NULL for all 106, but include for future)
    COALESCE(contact_lat, account_lat) AS sfdc_lat,
    COALESCE(contact_long, account_long) AS sfdc_long,

    -- Full address flag (has street + city + state)
    CASE
      WHEN COALESCE(NULLIF(TRIM(contact_street), ''), NULLIF(TRIM(fintrx_street_1), ''), NULLIF(TRIM(account_street), '')) IS NOT NULL
        AND COALESCE(NULLIF(TRIM(contact_city), ''), NULLIF(TRIM(fintrx_city), ''), NULLIF(TRIM(account_city), '')) IS NOT NULL
        AND COALESCE(NULLIF(TRIM(contact_state), ''), NULLIF(TRIM(fintrx_state), ''), NULLIF(TRIM(account_state), '')) IS NOT NULL
      THEN TRUE
      ELSE FALSE
    END AS has_full_address,

    -- Has any address (city OR state - for filtering)
    CASE
      WHEN COALESCE(NULLIF(TRIM(contact_city), ''), NULLIF(TRIM(fintrx_city), ''), NULLIF(TRIM(account_city), '')) IS NOT NULL
        OR COALESCE(NULLIF(TRIM(contact_state), ''), NULLIF(TRIM(fintrx_state), ''), NULLIF(TRIM(account_state), '')) IS NOT NULL
      THEN TRUE
      ELSE FALSE
    END AS has_address

  FROM with_addresses
)

-- Final SELECT with geocoded coordinates joined and state normalization
SELECT
  b.primary_key,
  b.Full_Opportunity_ID__c,
  b.Full_prospect_id__c,
  b.advisor_name,
  b.advisor_join_date__c,
  b.StageName,
  b.Opportunity_AUM,
  b.SGA_Owner_Name__c,
  b.SGM_Owner_Name__c,
  b.Original_source,
  b.Channel_Grouping_Name,
  b.recordtypeid,
  b.record_type_name,
  b.address_street_1,
  b.address_street_2,
  b.address_city,

  -- Normalized state: convert full names to abbreviations
  -- First extract state from comma-separated values (e.g., "City, State, Country" -> "State")
  -- Then map full state names to abbreviations
  COALESCE(
    -- If already a 2-letter abbreviation, keep it
    CASE
      WHEN REGEXP_CONTAINS(UPPER(TRIM(b.address_state_raw)), r'^[A-Z]{2}$')
      THEN UPPER(TRIM(b.address_state_raw))
      ELSE NULL
    END,
    -- Try to find state name in the raw value and map to abbreviation
    sa.abbrev,
    -- If comma-separated, extract second part and try to map
    sa2.abbrev,
    -- Fallback: if nothing matched, return cleaned raw value
    CASE
      WHEN b.address_state_raw IS NOT NULL
      THEN UPPER(TRIM(SPLIT(b.address_state_raw, ',')[SAFE_OFFSET(0)]))
      ELSE NULL
    END
  ) AS address_state,

  b.address_postal,
  b.address_country,
  b.address_source,
  b.sfdc_lat,
  b.sfdc_long,
  b.has_full_address,
  b.has_address,

  -- Final lat/long: COALESCE SFDC -> Geocoded
  COALESCE(b.sfdc_lat, g.lat) AS address_lat,
  COALESCE(b.sfdc_long, g.lng) AS address_long,

  -- Coordinate source
  CASE
    WHEN b.sfdc_lat IS NOT NULL THEN 'SFDC'
    WHEN g.lat IS NOT NULL THEN 'Geocoded'
    ELSE NULL
  END AS coord_source,

  -- Geocode metadata
  g.geocode_accuracy,
  g.geocoded_at

FROM with_coalesced_address b
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.geocoded_addresses` g
  ON b.primary_key = g.primary_key
-- Join for direct state name match
LEFT JOIN state_abbrev sa
  ON LOWER(TRIM(b.address_state_raw)) = LOWER(sa.state_name)
-- Join for state name in comma-separated value (try second part like "City, California, USA")
LEFT JOIN state_abbrev sa2
  ON LOWER(TRIM(SPLIT(b.address_state_raw, ',')[SAFE_OFFSET(1)])) = LOWER(sa2.state_name);
