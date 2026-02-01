/**
 * Remove duplicate geocoded addresses
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const LOCATION = 'northamerica-northeast2';

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('CLEANUP DUPLICATE GEOCODED ADDRESSES');
  console.log('='.repeat(60) + '\n');

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // 1. Check for duplicates
  console.log('1. Checking for duplicates in geocoded_addresses...');
  const [dupRows] = await bigquery.query({
    query: `
      SELECT primary_key, COUNT(*) as count
      FROM \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\`
      GROUP BY primary_key
      HAVING COUNT(*) > 1
    `,
    location: LOCATION,
  });

  if (dupRows.length === 0) {
    console.log('   No duplicates found!');
    return;
  }

  console.log(`   Found ${dupRows.length} primary_keys with duplicates:`);
  dupRows.forEach(r => console.log(`   - ${r.primary_key}: ${r.count} rows`));

  // 2. Delete duplicates keeping only the latest one
  console.log('\n2. Removing duplicates (keeping newest)...');

  // Use MERGE to deduplicate - keep the row with latest geocoded_at
  const [job] = await bigquery.createQueryJob({
    query: `
      CREATE OR REPLACE TABLE \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\` AS
      SELECT * EXCEPT(row_num) FROM (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY primary_key ORDER BY geocoded_at DESC) as row_num
        FROM \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\`
      )
      WHERE row_num = 1
    `,
    location: LOCATION,
  });

  console.log(`   Job ${job.id} started.`);
  await job.getQueryResults();
  console.log('   Duplicates removed!');

  // 3. Verify
  console.log('\n3. Verifying cleanup...');
  const [verifyRows] = await bigquery.query({
    query: `
      SELECT COUNT(*) as count
      FROM \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\`
    `,
    location: LOCATION,
  });
  console.log(`   Total rows after cleanup: ${verifyRows[0].count}`);

  const [dupCheckRows] = await bigquery.query({
    query: `
      SELECT COUNT(*) as dup_count
      FROM (
        SELECT primary_key
        FROM \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\`
        GROUP BY primary_key
        HAVING COUNT(*) > 1
      )
    `,
    location: LOCATION,
  });
  console.log(`   Remaining duplicates: ${dupCheckRows[0].dup_count}`);

  console.log('\n' + '='.repeat(60));
  console.log('CLEANUP COMPLETE');
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
