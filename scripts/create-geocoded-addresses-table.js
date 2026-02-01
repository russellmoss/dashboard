/**
 * Create geocoded_addresses table in BigQuery
 *
 * Usage: node scripts/create-geocoded-addresses-table.js
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const LOCATION = 'northamerica-northeast2';

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('CREATE GEOCODED_ADDRESSES TABLE');
  console.log('='.repeat(60) + '\n');

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // Read the SQL file
  const sqlPath = path.join(__dirname, '..', 'views', 'geocoded_addresses_table.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Executing DDL in BigQuery (location: northamerica-northeast2)...\n');
  console.log(sql);
  console.log('\n');

  try {
    const [job] = await bigquery.createQueryJob({
      query: sql,
      location: LOCATION,
    });

    console.log(`Job ${job.id} started.`);

    // Wait for the query to finish
    const [rows] = await job.getQueryResults();

    console.log('\nTable created successfully!');

    // Verify the table exists
    console.log('\nVerifying table exists...');
    const [verifyRows] = await bigquery.query({
      query: `
        SELECT table_name, creation_time
        FROM \`${PROJECT_ID}.Tableau_Views.INFORMATION_SCHEMA.TABLES\`
        WHERE table_name = 'geocoded_addresses'
      `,
      location: LOCATION,
    });

    if (verifyRows.length > 0) {
      console.log(`  Table: ${verifyRows[0].table_name}`);
      console.log(`  Created: ${verifyRows[0].creation_time}`);
    } else {
      console.log('  WARNING: Table not found in INFORMATION_SCHEMA');
    }

    // Show schema
    console.log('\nTable schema:');
    const [schemaRows] = await bigquery.query({
      query: `
        SELECT column_name, data_type
        FROM \`${PROJECT_ID}.Tableau_Views.INFORMATION_SCHEMA.COLUMNS\`
        WHERE table_name = 'geocoded_addresses'
        ORDER BY ordinal_position
      `,
      location: LOCATION,
    });

    schemaRows.forEach(row => {
      console.log(`  ${row.column_name}: ${row.data_type}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('PHASE 1 COMPLETE');
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    if (error.message && error.message.includes('Already Exists')) {
      console.log('\nTable already exists (this is OK - CREATE TABLE IF NOT EXISTS)');

      // Still verify the table
      console.log('\nVerifying existing table...');
      const [schemaRows] = await bigquery.query({
        query: `
          SELECT column_name, data_type
          FROM \`${PROJECT_ID}.Tableau_Views.INFORMATION_SCHEMA.COLUMNS\`
          WHERE table_name = 'geocoded_addresses'
          ORDER BY ordinal_position
        `,
        location: LOCATION,
      });

      console.log('Table schema:');
      schemaRows.forEach(row => {
        console.log(`  ${row.column_name}: ${row.data_type}`);
      });

      console.log('\n' + '='.repeat(60));
      console.log('PHASE 1 COMPLETE (table already existed)');
      console.log('='.repeat(60) + '\n');
    } else {
      console.error('Error creating table:', error.message);
      process.exit(1);
    }
  }
}

main().catch(console.error);
