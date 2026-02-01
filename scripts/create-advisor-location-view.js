/**
 * Create vw_joined_advisor_location view in BigQuery
 *
 * Usage: node scripts/create-advisor-location-view.js
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const LOCATION = 'northamerica-northeast2';

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('CREATE VW_JOINED_ADVISOR_LOCATION VIEW');
  console.log('='.repeat(60) + '\n');

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // Read the SQL file
  const sqlPath = path.join(__dirname, '..', 'views', 'vw_joined_advisor_location.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Executing CREATE OR REPLACE VIEW in BigQuery...\n');

  try {
    const [job] = await bigquery.createQueryJob({
      query: sql,
      location: LOCATION,
    });

    console.log(`Job ${job.id} started.`);

    // Wait for the query to finish
    await job.getQueryResults();

    console.log('\nView created successfully!');

    // Verify the view exists
    console.log('\n--- VERIFICATION ---\n');

    // 1. Check view exists
    console.log('1. Checking view exists...');
    const [viewRows] = await bigquery.query({
      query: `
        SELECT table_name, table_type
        FROM \`${PROJECT_ID}.Tableau_Views.INFORMATION_SCHEMA.TABLES\`
        WHERE table_name = 'vw_joined_advisor_location'
      `,
      location: LOCATION,
    });

    if (viewRows.length > 0) {
      console.log(`   View: ${viewRows[0].table_name} (${viewRows[0].table_type})`);
    } else {
      console.log('   ERROR: View not found!');
      process.exit(1);
    }

    // 2. Check row count and data quality
    console.log('\n2. Checking row count and data quality...');
    const [countRows] = await bigquery.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNTIF(has_full_address) as with_full_address,
          COUNTIF(has_address) as with_any_address,
          COUNTIF(sfdc_lat IS NOT NULL) as with_sfdc_coords,
          COUNTIF(address_city IS NOT NULL) as with_city,
          COUNTIF(address_state IS NOT NULL) as with_state
        FROM \`${PROJECT_ID}.Tableau_Views.vw_joined_advisor_location\`
      `,
      location: LOCATION,
    });

    const stats = countRows[0];
    console.log(`   Total advisors: ${stats.total}`);
    console.log(`   With full address: ${stats.with_full_address}`);
    console.log(`   With any address: ${stats.with_any_address}`);
    console.log(`   With SFDC coords: ${stats.with_sfdc_coords}`);
    console.log(`   With city: ${stats.with_city}`);
    console.log(`   With state: ${stats.with_state}`);

    // 3. Check key columns exist
    console.log('\n3. Checking key columns exist...');
    const [colRows] = await bigquery.query({
      query: `
        SELECT column_name
        FROM \`${PROJECT_ID}.Tableau_Views.INFORMATION_SCHEMA.COLUMNS\`
        WHERE table_name = 'vw_joined_advisor_location'
          AND column_name IN ('primary_key', 'advisor_name', 'address_lat', 'address_long', 'coord_source')
      `,
      location: LOCATION,
    });

    console.log(`   Found ${colRows.length}/5 key columns:`);
    colRows.forEach(row => console.log(`     - ${row.column_name}`));

    // 4. Sample data
    console.log('\n4. Sample data (first 3 rows)...');
    const [sampleRows] = await bigquery.query({
      query: `
        SELECT primary_key, advisor_name, address_city, address_state, address_lat, address_long, coord_source
        FROM \`${PROJECT_ID}.Tableau_Views.vw_joined_advisor_location\`
        LIMIT 3
      `,
      location: LOCATION,
    });

    sampleRows.forEach((row, i) => {
      console.log(`   [${i + 1}] ${row.advisor_name}`);
      console.log(`       City/State: ${row.address_city || 'N/A'}, ${row.address_state || 'N/A'}`);
      console.log(`       Lat/Long: ${row.address_lat || 'NULL'}, ${row.address_long || 'NULL'}`);
      console.log(`       Coord Source: ${row.coord_source || 'NULL'}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('PHASE 2 COMPLETE');
    console.log('='.repeat(60));
    console.log(`\nExpected: total~106, with_full_address~36, with_any_address~106`);
    console.log(`Actual:   total=${stats.total}, with_full_address=${stats.with_full_address}, with_any_address=${stats.with_any_address}`);

    if (stats.total >= 100 && stats.with_any_address >= 100) {
      console.log('\n*** VIEW VERIFICATION PASSED ***\n');
    } else {
      console.log('\n*** WARNING: Row counts lower than expected ***\n');
    }

  } catch (error) {
    console.error('Error creating view:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
