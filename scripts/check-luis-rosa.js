/**
 * Check Luis Rosa duplicates
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const LOCATION = 'northamerica-northeast2';

async function main() {
  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // Check Luis Rosa in the view
  console.log('1. Luis Rosa rows in the view:');
  const [viewRows] = await bigquery.query({
    query: `
      SELECT
        primary_key,
        advisor_name,
        address_city,
        address_state,
        address_lat,
        address_long
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_joined_advisor_location\`
      WHERE advisor_name = 'Luis Rosa'
    `,
    location: LOCATION,
  });
  viewRows.forEach((r, i) => {
    console.log(`   [${i + 1}] PK: ${r.primary_key}`);
    console.log(`       City: ${r.address_city}, State: ${r.address_state}`);
    console.log(`       Lat/Lng: ${r.address_lat}, ${r.address_long}`);
  });

  // Check if FinTrx is causing duplicates
  console.log('\n2. Check FinTrx for CRD duplicates:');
  const [fintrxRows] = await bigquery.query({
    query: `
      SELECT
        RIA_CONTACT_CRD_ID,
        COUNT(*) as count
      FROM \`savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current\`
      GROUP BY RIA_CONTACT_CRD_ID
      HAVING COUNT(*) > 1
      LIMIT 10
    `,
    location: LOCATION,
  });
  if (fintrxRows.length > 0) {
    console.log('   CRDs with multiple FinTrx records:');
    fintrxRows.forEach((r, i) => {
      console.log(`   [${i + 1}] CRD: ${r.RIA_CONTACT_CRD_ID}, Count: ${r.count}`);
    });
  } else {
    console.log('   No duplicate CRDs in FinTrx');
  }

  // Check Luis Rosa's opportunity and CRD
  console.log('\n3. Luis Rosa opportunity details:');
  const [oppRows] = await bigquery.query({
    query: `
      SELECT
        v.advisor_name,
        v.Full_Opportunity_ID__c,
        o.FA_CRD__c as opp_crd
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` v
      JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o ON v.Full_Opportunity_ID__c = o.Id
      WHERE v.advisor_name = 'Luis Rosa'
        AND v.is_joined_unique = 1
    `,
    location: LOCATION,
  });
  oppRows.forEach((r, i) => {
    console.log(`   [${i + 1}] Opp: ${r.Full_Opportunity_ID__c}, CRD: ${r.opp_crd}`);
  });
}

main().catch(console.error);
