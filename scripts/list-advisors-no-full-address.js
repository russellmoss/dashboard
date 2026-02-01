/**
 * List 5 joined advisors who do NOT have a full address (street + city + state)
 * in SFDC (Contact/Account) or FinTrx PRIMARY_LOCATION.
 *
 * Run with: node scripts/list-advisors-no-full-address.js
 * Requires: GOOGLE_APPLICATION_CREDENTIALS (or default ADC) and BigQuery access.
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');
const path = require('path');
const fs = require('fs');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';

const QUERY = `
WITH joined_funnel AS (
  SELECT
    f.primary_key,
    f.Full_Opportunity_ID__c,
    f.advisor_name,
    f.advisor_join_date__c,
    f.salesforce_url
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
  WHERE f.advisor_join_date__c IS NOT NULL
    AND f.advisor_join_date__c > DATE('2018-01-01')
    AND f.is_primary_opp_record = 1
),
opp_lead AS (
  SELECT
    j.primary_key,
    j.advisor_name,
    j.advisor_join_date__c,
    j.salesforce_url,
    o.ContactId,
    o.AccountId,
    o.FA_CRD__c AS opp_fa_crd,
    l.FA_CRD__c AS lead_fa_crd
  FROM joined_funnel j
  JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o
    ON o.Id = j.Full_Opportunity_ID__c
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
    ON l.ConvertedOpportunityId = o.Id
),
with_address AS (
  SELECT
    ol.primary_key,
    ol.advisor_name,
    ol.advisor_join_date__c,
    ol.salesforce_url,
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
    )) AS address_state
  FROM opp_lead ol
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Contact\` c
    ON c.Id = ol.ContactId AND (c.IsDeleted = false OR c.IsDeleted IS NULL)
  LEFT JOIN \`savvy-gtm-analytics.FinTrx_data.ria_contacts_current\` ft
    ON SAFE_CAST(NULLIF(TRIM(COALESCE(ol.opp_fa_crd, ol.lead_fa_crd)), '') AS INT64) = ft.RIA_CONTACT_CRD_ID
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Account\` a
    ON a.Id = ol.AccountId AND (a.IsDeleted = false OR a.IsDeleted IS NULL)
)
SELECT
  primary_key,
  advisor_name,
  advisor_join_date__c,
  address_city,
  address_state,
  salesforce_url
FROM with_address
WHERE (address_street_1 IS NULL OR address_street_1 = '')
  AND ((address_city IS NOT NULL AND address_city != '') OR (address_state IS NOT NULL AND address_state != ''))
ORDER BY advisor_name
LIMIT 5
`;

async function main() {
  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  console.log('\n5 joined advisors without full address (street + city + state) in SFDC or FinTrx:\n');

  try {
    const [rows] = await bigquery.query({ query: QUERY });
    if (!rows.length) {
      console.log('(None found — all joined advisors have full address.)');
      return;
    }
    rows.forEach((r, i) => {
      const loc = [r.address_city, r.address_state].filter(Boolean).join(', ');
      console.log(`${i + 1}. ${r.advisor_name} (${loc || 'no city/state'})`);
    });
    console.log('');
  } catch (err) {
    console.error('BigQuery error:', err.message);
    console.error('\nTo get the list manually, run the SQL in docs/data-transfer/joined-advisors-no-full-address.sql in BigQuery.');
    process.exit(1);
  }
}

main();
