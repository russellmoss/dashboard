/**
 * Run Phase 1 BigQuery queries for location_investigation_qanda.md
 * Requires: GOOGLE_APPLICATION_CREDENTIALS, location northamerica-northeast2
 * Run: node scripts/run-location-investigation-queries.js
 */
require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const LOCATION = 'northamerica-northeast2';

const QUERIES = {
  '1.1 Contact lat/long': `
SELECT 
  COUNT(*) as total_joined,
  COUNTIF(c.MailingLatitude IS NOT NULL AND c.MailingLongitude IS NOT NULL) as has_contact_coords,
  COUNTIF(c.MailingLatitude IS NULL OR c.MailingLongitude IS NULL) as missing_contact_coords
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o ON f.Full_Opportunity_ID__c = o.Id
LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Contact\` c ON o.ContactId = c.Id
WHERE f.advisor_join_date__c IS NOT NULL 
  AND f.advisor_join_date__c > DATE('2018-01-01')
  AND f.is_primary_opp_record = 1
`,
  '1.2 Account lat/long': `
SELECT 
  COUNT(*) as total_joined,
  COUNTIF(a.BillingLatitude IS NOT NULL AND a.BillingLongitude IS NOT NULL) as has_account_coords,
  COUNTIF(a.BillingLatitude IS NULL OR a.BillingLongitude IS NULL) as missing_account_coords
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o ON f.Full_Opportunity_ID__c = o.Id
LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Account\` a ON o.AccountId = a.Id
WHERE f.advisor_join_date__c IS NOT NULL 
  AND f.advisor_join_date__c > DATE('2018-01-01')
  AND f.is_primary_opp_record = 1
`,
  '1.3 Combined lat/long': `
SELECT 
  COUNT(*) as total_joined,
  COUNTIF(
    COALESCE(c.MailingLatitude, a.BillingLatitude) IS NOT NULL 
    AND COALESCE(c.MailingLongitude, a.BillingLongitude) IS NOT NULL
  ) as has_any_coords,
  COUNTIF(
    COALESCE(c.MailingLatitude, a.BillingLatitude) IS NULL 
    OR COALESCE(c.MailingLongitude, a.BillingLongitude) IS NULL
  ) as needs_geocoding
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o ON f.Full_Opportunity_ID__c = o.Id
LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Contact\` c ON o.ContactId = c.Id
LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Account\` a ON o.AccountId = a.Id
WHERE f.advisor_join_date__c IS NOT NULL 
  AND f.advisor_join_date__c > DATE('2018-01-01')
  AND f.is_primary_opp_record = 1
`,
  '1.4 Geocoding input quality': `
WITH joined_advisors AS (
  SELECT 
    f.advisor_name,
    f.Full_Opportunity_ID__c,
    c.MailingStreet as contact_street,
    c.MailingCity as contact_city,
    c.MailingState as contact_state,
    c.MailingPostalCode as contact_postal,
    c.MailingLatitude as contact_lat,
    c.MailingLongitude as contact_long,
    a.BillingStreet as account_street,
    a.BillingCity as account_city,
    a.BillingState as account_state,
    a.BillingPostalCode as account_postal,
    a.BillingLatitude as account_lat,
    a.BillingLongitude as account_long,
    ft.PRIMARY_LOCATION_STREET_1 as fintrx_street,
    ft.PRIMARY_LOCATION_CITY as fintrx_city,
    ft.PRIMARY_LOCATION_STATE as fintrx_state,
    ft.PRIMARY_LOCATION_POSTAL as fintrx_postal
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
  JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o ON f.Full_Opportunity_ID__c = o.Id
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l ON l.ConvertedOpportunityId = o.Id
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Contact\` c ON o.ContactId = c.Id
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Account\` a ON o.AccountId = a.Id
  LEFT JOIN \`savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current\` ft 
    ON SAFE_CAST(NULLIF(TRIM(COALESCE(o.FA_CRD__c, l.FA_CRD__c)), '') AS INT64) = ft.RIA_CONTACT_CRD_ID
  WHERE f.advisor_join_date__c IS NOT NULL 
    AND f.advisor_join_date__c > DATE('2018-01-01')
    AND f.is_primary_opp_record = 1
)
SELECT 
  COUNT(*) as needs_geocoding,
  COUNTIF(
    COALESCE(contact_street, fintrx_street, account_street) IS NOT NULL
    AND COALESCE(contact_city, fintrx_city, account_city) IS NOT NULL
    AND COALESCE(contact_state, fintrx_state, account_state) IS NOT NULL
  ) as has_full_address_for_geocoding,
  COUNTIF(
    COALESCE(contact_city, fintrx_city, account_city) IS NOT NULL
    AND COALESCE(contact_state, fintrx_state, account_state) IS NOT NULL
    AND COALESCE(contact_street, fintrx_street, account_street) IS NULL
  ) as has_city_state_only,
  COUNTIF(
    COALESCE(contact_state, fintrx_state, account_state) IS NOT NULL
    AND COALESCE(contact_city, fintrx_city, account_city) IS NULL
  ) as has_state_only
FROM joined_advisors
WHERE COALESCE(contact_lat, account_lat) IS NULL 
   OR COALESCE(contact_long, account_long) IS NULL
`,
  '4.2 View exists': `
SELECT column_name, data_type
FROM \`savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS\`
WHERE table_name = 'vw_joined_advisor_location'
ORDER BY ordinal_position
`
};

async function main() {
  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });
  for (const [name, sql] of Object.entries(QUERIES)) {
    try {
      const [rows] = await bigquery.query({ query: sql, location: LOCATION });
      console.log('\n---', name, '---');
      console.log(JSON.stringify(rows, null, 2));
    } catch (err) {
      console.log('\n---', name, '--- ERROR:', err.message);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
