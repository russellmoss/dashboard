/**
 * Count joined advisors with full address (street + city + state) using
 * CRD from Salesforce → FinTrx_data.ria_contacts_current (RIA_CONTACT_CRD_ID) → PRIMARY_LOCATION,
 * with Contact and Account as fallback.
 *
 * Run with: node scripts/count-joined-advisors-full-address.js
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';

const QUERY = `
WITH joined_funnel AS (
  SELECT f.primary_key, f.Full_Opportunity_ID__c, f.advisor_name
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
  WHERE f.advisor_join_date__c IS NOT NULL
    AND f.advisor_join_date__c > DATE('2018-01-01')
    AND f.is_primary_opp_record = 1
),
opp_lead AS (
  SELECT j.primary_key, j.advisor_name, o.ContactId, o.AccountId,
    o.FA_CRD__c AS opp_fa_crd, l.FA_CRD__c AS lead_fa_crd
  FROM joined_funnel j
  JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o ON o.Id = j.Full_Opportunity_ID__c
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l ON l.ConvertedOpportunityId = o.Id
),
with_address AS (
  SELECT
    ol.primary_key,
    TRIM(COALESCE(NULLIF(TRIM(c.MailingStreet), ''), NULLIF(TRIM(ft.PRIMARY_LOCATION_STREET_1), ''), NULLIF(TRIM(a.BillingStreet), ''))) AS address_street_1,
    TRIM(COALESCE(NULLIF(TRIM(c.MailingCity), ''), NULLIF(TRIM(ft.PRIMARY_LOCATION_CITY), ''), NULLIF(TRIM(a.BillingCity), ''))) AS address_city,
    TRIM(COALESCE(NULLIF(TRIM(c.MailingState), ''), NULLIF(TRIM(ft.PRIMARY_LOCATION_STATE), ''), NULLIF(TRIM(a.BillingState), ''))) AS address_state,
    CASE WHEN ft.RIA_CONTACT_CRD_ID IS NOT NULL THEN 1 ELSE 0 END AS has_fintrx_match,
    CASE WHEN NULLIF(TRIM(ft.PRIMARY_LOCATION_STREET_1), '') IS NOT NULL AND NULLIF(TRIM(ft.PRIMARY_LOCATION_CITY), '') IS NOT NULL AND NULLIF(TRIM(ft.PRIMARY_LOCATION_STATE), '') IS NOT NULL THEN 1 ELSE 0 END AS fintrx_primary_location_full
  FROM opp_lead ol
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Contact\` c ON c.Id = ol.ContactId AND (c.IsDeleted = false OR c.IsDeleted IS NULL)
  LEFT JOIN \`savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current\` ft ON SAFE_CAST(NULLIF(TRIM(COALESCE(ol.opp_fa_crd, ol.lead_fa_crd)), '') AS INT64) = ft.RIA_CONTACT_CRD_ID
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Account\` a ON a.Id = ol.AccountId AND (a.IsDeleted = false OR a.IsDeleted IS NULL)
),
with_full_flag AS (
  SELECT *,
    CASE WHEN (address_street_1 IS NOT NULL AND address_street_1 != '') AND (address_city IS NOT NULL AND address_city != '') AND (address_state IS NOT NULL AND address_state != '') THEN 1 ELSE 0 END AS has_full_address
  FROM with_address
)
SELECT
  COUNT(*) AS total_joined_advisors,
  SUM(has_full_address) AS with_full_address,
  SUM(has_fintrx_match) AS with_fintrx_crd_match,
  SUM(fintrx_primary_location_full) AS with_fintrx_primary_location_full,
  SUM(has_full_address) - SUM(fintrx_primary_location_full) AS full_address_from_contact_or_account_only
FROM with_full_flag
`;

async function main() {
  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // Data is in Toronto (northamerica-northeast2) — must set location or job fails in US
  const LOCATION = 'northamerica-northeast2';
  try {
    const [rows] = await bigquery.query({ query: QUERY, location: LOCATION });
    const r = rows[0];
    console.log('\nJoined advisors (advisor_join_date > 2018-01-01, is_primary_opp_record = 1):\n');
    console.log('  Total joined advisors:                    ', r.total_joined_advisors);
    console.log('  With full address (street + city + state): ', r.with_full_address);
    console.log('  With FinTrx CRD match (ria_contacts_current):', r.with_fintrx_crd_match);
    console.log('  With FinTrx PRIMARY_LOCATION full address: ', r.with_fintrx_primary_location_full);
    console.log('  Full address from Contact/Account only:   ', r.full_address_from_contact_or_account_only);
    console.log('\n(Full address uses COALESCE: Contact → FinTrx PRIMARY_LOCATION → Account.)\n');
  } catch (err) {
    console.error('BigQuery error:', err.message);
    process.exit(1);
  }
}

main();
