/**
 * Diagnose joined advisor count discrepancy
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const LOCATION = 'northamerica-northeast2';

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('JOINED ADVISOR COUNT DIAGNOSIS');
  console.log('='.repeat(60) + '\n');

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // 1. Count using funnel metrics exact logic
  console.log('1. Funnel metrics logic (is_joined_unique = 1, date range 2018-01-01 to today):');
  const [funnelRows] = await bigquery.query({
    query: `
      SELECT COUNT(*) as count
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` v
      WHERE advisor_join_date__c IS NOT NULL
        AND DATE(advisor_join_date__c) >= DATE('2018-01-01')
        AND DATE(advisor_join_date__c) <= CURRENT_DATE()
        AND is_joined_unique = 1
    `,
    location: LOCATION,
  });
  console.log(`   Count: ${funnelRows[0].count}`);

  // 2. Count from the view
  console.log('\n2. Current view count:');
  const [viewRows] = await bigquery.query({
    query: `
      SELECT COUNT(*) as count
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_joined_advisor_location\`
    `,
    location: LOCATION,
  });
  console.log(`   Count: ${viewRows[0].count}`);

  // 3. Check is_primary_opp_record vs is_joined_unique
  console.log('\n3. Comparing is_primary_opp_record vs is_joined_unique:');
  const [compareRows] = await bigquery.query({
    query: `
      SELECT
        COUNT(*) as total,
        COUNTIF(is_primary_opp_record = 1) as primary_opp,
        COUNTIF(is_joined_unique = 1) as joined_unique,
        COUNTIF(is_primary_opp_record = 1 AND is_joined_unique = 1) as both
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` v
      WHERE advisor_join_date__c IS NOT NULL
        AND advisor_join_date__c > DATE('2018-01-01')
    `,
    location: LOCATION,
  });
  console.log(`   Total with join date > 2018-01-01: ${compareRows[0].total}`);
  console.log(`   is_primary_opp_record = 1: ${compareRows[0].primary_opp}`);
  console.log(`   is_joined_unique = 1: ${compareRows[0].joined_unique}`);
  console.log(`   Both flags = 1: ${compareRows[0].both}`);

  // 4. Find records that are in is_joined_unique but not is_primary_opp_record and vice versa
  console.log('\n4. Records with only one flag:');
  const [diffRows] = await bigquery.query({
    query: `
      SELECT
        COUNTIF(is_primary_opp_record = 1 AND (is_joined_unique = 0 OR is_joined_unique IS NULL)) as only_primary,
        COUNTIF(is_joined_unique = 1 AND (is_primary_opp_record = 0 OR is_primary_opp_record IS NULL)) as only_joined_unique
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` v
      WHERE advisor_join_date__c IS NOT NULL
        AND advisor_join_date__c > DATE('2018-01-01')
    `,
    location: LOCATION,
  });
  console.log(`   Only is_primary_opp_record = 1: ${diffRows[0].only_primary}`);
  console.log(`   Only is_joined_unique = 1: ${diffRows[0].only_joined_unique}`);

  // 5. Sample the extra records
  console.log('\n5. Sample records that are in view but might not be in funnel:');
  const [sampleRows] = await bigquery.query({
    query: `
      SELECT
        advisor_name,
        advisor_join_date__c,
        is_primary_opp_record,
        is_joined_unique,
        recordtypeid
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` v
      WHERE advisor_join_date__c IS NOT NULL
        AND advisor_join_date__c > DATE('2018-01-01')
        AND is_joined_unique = 1
        AND (is_primary_opp_record = 0 OR is_primary_opp_record IS NULL)
      LIMIT 10
    `,
    location: LOCATION,
  });

  if (sampleRows.length > 0) {
    console.log('   Records with is_joined_unique=1 but is_primary_opp_record!=1:');
    sampleRows.forEach((row, i) => {
      console.log(`   [${i + 1}] ${row.advisor_name} (joined: ${row.advisor_join_date__c?.value || row.advisor_join_date__c})`);
    });
  } else {
    console.log('   No records found');
  }

  // 6. Check if JOINs are creating duplicates
  console.log('\n6. Check for duplicates caused by JOINs:');
  const [joinRows] = await bigquery.query({
    query: `
      WITH joined_base AS (
        SELECT
          f.primary_key,
          f.Full_Opportunity_ID__c
        FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
        WHERE f.advisor_join_date__c IS NOT NULL
          AND f.advisor_join_date__c > DATE('2018-01-01')
          AND f.is_joined_unique = 1
      )
      SELECT
        COUNT(*) as before_join,
        COUNT(DISTINCT jb.primary_key) as distinct_pk
      FROM joined_base jb
    `,
    location: LOCATION,
  });
  console.log(`   Rows before Opportunity join: ${joinRows[0].before_join}`);
  console.log(`   Distinct primary_keys: ${joinRows[0].distinct_pk}`);

  // 7. Check if Lead join creates duplicates
  console.log('\n7. Check Lead join for duplicates:');
  const [leadRows] = await bigquery.query({
    query: `
      WITH joined_base AS (
        SELECT
          f.primary_key,
          f.Full_Opportunity_ID__c
        FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
        WHERE f.advisor_join_date__c IS NOT NULL
          AND f.advisor_join_date__c > DATE('2018-01-01')
          AND f.is_joined_unique = 1
      )
      SELECT
        COUNT(*) as after_lead_join
      FROM joined_base jb
      JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o
        ON jb.Full_Opportunity_ID__c = o.Id
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
        ON l.ConvertedOpportunityId = o.Id
    `,
    location: LOCATION,
  });
  console.log(`   Rows after Lead join: ${leadRows[0].after_lead_join}`);

  // 8. Check which opportunities have multiple leads
  console.log('\n8. ALL opportunities with multiple converted leads:');
  const [multiLeadRows] = await bigquery.query({
    query: `
      WITH joined_base AS (
        SELECT
          f.primary_key,
          f.Full_Opportunity_ID__c,
          f.advisor_name
        FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
        WHERE f.advisor_join_date__c IS NOT NULL
          AND f.advisor_join_date__c > DATE('2018-01-01')
          AND f.is_joined_unique = 1
      )
      SELECT
        jb.advisor_name,
        jb.Full_Opportunity_ID__c,
        COUNT(*) as lead_count
      FROM joined_base jb
      JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o
        ON jb.Full_Opportunity_ID__c = o.Id
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
        ON l.ConvertedOpportunityId = o.Id
      GROUP BY jb.advisor_name, jb.Full_Opportunity_ID__c
      HAVING COUNT(*) > 1
    `,
    location: LOCATION,
  });
  if (multiLeadRows.length > 0) {
    console.log('   Advisors with multiple leads:');
    let extraRows = 0;
    multiLeadRows.forEach((row, i) => {
      console.log(`   [${i + 1}] ${row.advisor_name}: ${row.lead_count} leads`);
      extraRows += (row.lead_count - 1);
    });
    console.log(`\n   Total extra rows from Lead duplicates: ${extraRows}`);
    console.log(`   Expected after Lead join: 106 + ${extraRows} = ${106 + extraRows}`);
  } else {
    console.log('   No opportunities with multiple leads');
  }

  // 9. Check full join chain for duplicates
  console.log('\n9. Full join chain row counts:');
  const [chainRows] = await bigquery.query({
    query: `
      WITH joined_base AS (
        SELECT
          f.primary_key,
          f.Full_Opportunity_ID__c,
          f.advisor_name
        FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
        WHERE f.advisor_join_date__c IS NOT NULL
          AND f.advisor_join_date__c > DATE('2018-01-01')
          AND f.is_joined_unique = 1
      ),
      with_opp AS (
        SELECT jb.*, o.ContactId, o.AccountId, o.FA_CRD__c AS opp_crd
        FROM joined_base jb
        JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o ON jb.Full_Opportunity_ID__c = o.Id
      ),
      with_lead AS (
        SELECT wo.*, l.FA_CRD__c AS lead_crd
        FROM with_opp wo
        LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Lead\` l ON l.ConvertedOpportunityId = wo.Full_Opportunity_ID__c
      ),
      with_contact AS (
        SELECT wl.*
        FROM with_lead wl
        LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Contact\` c ON wl.ContactId = c.Id AND c.IsDeleted = FALSE
      ),
      with_account AS (
        SELECT wc.*
        FROM with_contact wc
        LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Account\` a ON wc.AccountId = a.Id AND a.IsDeleted = FALSE
      ),
      with_fintrx AS (
        SELECT wa.*
        FROM with_account wa
        LEFT JOIN \`savvy-gtm-analytics.FinTrx_data_CA.ria_contacts_current\` ft
          ON SAFE_CAST(NULLIF(TRIM(COALESCE(wa.opp_crd, wa.lead_crd)), '') AS INT64) = ft.RIA_CONTACT_CRD_ID
      )
      SELECT
        (SELECT COUNT(*) FROM joined_base) as step1_base,
        (SELECT COUNT(*) FROM with_opp) as step2_opp,
        (SELECT COUNT(*) FROM with_lead) as step3_lead,
        (SELECT COUNT(*) FROM with_contact) as step4_contact,
        (SELECT COUNT(*) FROM with_account) as step5_account,
        (SELECT COUNT(*) FROM with_fintrx) as step6_fintrx
    `,
    location: LOCATION,
  });
  console.log(`   Step 1 - Base (funnel_master): ${chainRows[0].step1_base}`);
  console.log(`   Step 2 - After Opportunity JOIN: ${chainRows[0].step2_opp}`);
  console.log(`   Step 3 - After Lead LEFT JOIN: ${chainRows[0].step3_lead}`);
  console.log(`   Step 4 - After Contact LEFT JOIN: ${chainRows[0].step4_contact}`);
  console.log(`   Step 5 - After Account LEFT JOIN: ${chainRows[0].step5_account}`);
  console.log(`   Step 6 - After FinTrx LEFT JOIN: ${chainRows[0].step6_fintrx}`);

  // 10. Check for duplicates in the actual view
  console.log('\n10. Check for duplicates in actual view:');
  const [viewDupRows] = await bigquery.query({
    query: `
      SELECT
        primary_key,
        advisor_name,
        COUNT(*) as count
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_joined_advisor_location\`
      GROUP BY primary_key, advisor_name
      HAVING COUNT(*) > 1
    `,
    location: LOCATION,
  });
  if (viewDupRows.length > 0) {
    console.log('   Duplicate primary_keys in view:');
    viewDupRows.forEach((row, i) => {
      console.log(`   [${i + 1}] ${row.advisor_name} (pk: ${row.primary_key}): ${row.count} rows`);
    });
  } else {
    console.log('   No duplicate primary_keys in view');
  }

  // 11. Check actual view SQL definition issue - maybe it's stale
  console.log('\n11. View vs fresh query comparison:');
  const [freshQueryRows] = await bigquery.query({
    query: `
      WITH joined_base AS (
        SELECT
          f.primary_key,
          f.advisor_name
        FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` f
        WHERE f.advisor_join_date__c IS NOT NULL
          AND f.advisor_join_date__c > DATE('2018-01-01')
          AND f.is_joined_unique = 1
      )
      SELECT COUNT(*) as count FROM joined_base
    `,
    location: LOCATION,
  });
  console.log(`   Fresh query with is_joined_unique: ${freshQueryRows[0].count}`);
  console.log(`   Actual view count: 109 (from earlier query)`);

  console.log('\n' + '='.repeat(60));
  console.log('DIAGNOSIS COMPLETE');
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
