-- ============================================================================
-- Joined advisors: count with full address (CRD → FinTrx ria_contacts_current → PRIMARY_LOCATION)
-- ============================================================================
-- Uses: SFDC CRD (Opportunity.FA_CRD__c or Lead.FA_CRD__c) → FinTrx_data.ria_contacts_current.RIA_CONTACT_CRD_ID
--       and PRIMARY_LOCATION_* for street, city, state. COALESCE with Contact and Account.
-- ============================================================================

WITH joined_funnel AS (
  SELECT
    f.primary_key,
    f.Full_Opportunity_ID__c,
    f.advisor_name
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  WHERE f.advisor_join_date__c IS NOT NULL
    AND f.advisor_join_date__c > DATE('2018-01-01')
    AND f.is_primary_opp_record = 1
),
opp_lead AS (
  SELECT
    j.primary_key,
    j.advisor_name,
    o.ContactId,
    o.AccountId,
    o.FA_CRD__c AS opp_fa_crd,
    l.FA_CRD__c AS lead_fa_crd
  FROM joined_funnel j
  JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
    ON o.Id = j.Full_Opportunity_ID__c
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l
    ON l.ConvertedOpportunityId = o.Id
),
with_address AS (
  SELECT
    ol.primary_key,
    ol.advisor_name,
    TRIM(COALESCE(
      NULLIF(TRIM(c.MailingStreet), ''),
      NULLIF(TRIM(ft.PRIMARY_LOCATION_STREET_1), ''),
      NULLIF(TRIM(a.BillingStreet), '')
    )) AS address_street_1,
    TRIM(COALESCE(
      NULLIF(TRIM(c.MailingCity), ''),
      NULLIF(TRIM(ft.PRIMARY_LOCATION_CITY), ''),
      NULLIF(TRIM(a.BillingCity), '')
    )) AS address_city,
    TRIM(COALESCE(
      NULLIF(TRIM(c.MailingState), ''),
      NULLIF(TRIM(ft.PRIMARY_LOCATION_STATE), ''),
      NULLIF(TRIM(a.BillingState), '')
    )) AS address_state,
    CASE WHEN ft.RIA_CONTACT_CRD_ID IS NOT NULL THEN 1 ELSE 0 END AS has_fintrx_match,
    CASE
      WHEN NULLIF(TRIM(ft.PRIMARY_LOCATION_STREET_1), '') IS NOT NULL
       AND NULLIF(TRIM(ft.PRIMARY_LOCATION_CITY), '') IS NOT NULL
       AND NULLIF(TRIM(ft.PRIMARY_LOCATION_STATE), '') IS NOT NULL
      THEN 1 ELSE 0
    END AS fintrx_primary_location_full
  FROM opp_lead ol
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Contact` c
    ON c.Id = ol.ContactId AND (c.IsDeleted = false OR c.IsDeleted IS NULL)
  LEFT JOIN `savvy-gtm-analytics.FinTrx_data.ria_contacts_current` ft
    ON SAFE_CAST(NULLIF(TRIM(COALESCE(ol.opp_fa_crd, ol.lead_fa_crd)), '') AS INT64) = ft.RIA_CONTACT_CRD_ID
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Account` a
    ON a.Id = ol.AccountId AND (a.IsDeleted = false OR a.IsDeleted IS NULL)
),
with_full_flag AS (
  SELECT
    *,
    CASE
      WHEN (address_street_1 IS NOT NULL AND address_street_1 != '')
       AND (address_city IS NOT NULL AND address_city != '')
       AND (address_state IS NOT NULL AND address_state != '')
      THEN 1 ELSE 0
    END AS has_full_address
  FROM with_address
)
SELECT
  COUNT(*) AS total_joined_advisors,
  SUM(has_full_address) AS with_full_address,
  SUM(has_fintrx_match) AS with_fintrx_crd_match,
  SUM(fintrx_primary_location_full) AS with_fintrx_primary_location_full,
  SUM(has_full_address) - SUM(fintrx_primary_location_full) AS full_address_from_contact_or_account_only
FROM with_full_flag;
