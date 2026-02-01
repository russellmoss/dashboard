/**
 * Verify geocoding results in BigQuery
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const LOCATION = 'northamerica-northeast2';

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('GEOCODING VERIFICATION');
  console.log('='.repeat(60) + '\n');

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // 1. Check geocoded_addresses table
  console.log('1. geocoded_addresses table:');
  const [tableRows] = await bigquery.query({
    query: `SELECT COUNT(*) as count FROM \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\``,
    location: LOCATION,
  });
  console.log(`   Total rows: ${tableRows[0].count}`);

  // 2. Accuracy distribution
  console.log('\n2. Accuracy distribution:');
  const [accuracyRows] = await bigquery.query({
    query: `
      SELECT geocode_accuracy, COUNT(*) as count
      FROM \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\`
      GROUP BY geocode_accuracy
      ORDER BY count DESC
    `,
    location: LOCATION,
  });
  accuracyRows.forEach(row => {
    console.log(`   ${row.geocode_accuracy}: ${row.count}`);
  });

  // 3. View stats
  console.log('\n3. View stats (vw_joined_advisor_location):');
  const [viewRows] = await bigquery.query({
    query: `
      SELECT
        COUNT(*) as total,
        COUNTIF(address_lat IS NOT NULL) as with_coords,
        COUNTIF(coord_source = 'Geocoded') as geocoded,
        COUNTIF(coord_source = 'SFDC') as from_sfdc,
        COUNTIF(coord_source IS NULL) as no_coords
      FROM \`${PROJECT_ID}.Tableau_Views.vw_joined_advisor_location\`
    `,
    location: LOCATION,
  });
  const stats = viewRows[0];
  console.log(`   Total advisors: ${stats.total}`);
  console.log(`   With coordinates: ${stats.with_coords}`);
  console.log(`   From Geocoding: ${stats.geocoded}`);
  console.log(`   From SFDC: ${stats.from_sfdc}`);
  console.log(`   No coordinates: ${stats.no_coords}`);

  // 4. Sample geocoded data
  console.log('\n4. Sample geocoded advisors:');
  const [sampleRows] = await bigquery.query({
    query: `
      SELECT advisor_name, address_city, address_state, address_lat, address_long, coord_source, geocode_accuracy
      FROM \`${PROJECT_ID}.Tableau_Views.vw_joined_advisor_location\`
      WHERE address_lat IS NOT NULL
      LIMIT 5
    `,
    location: LOCATION,
  });
  sampleRows.forEach((row, i) => {
    console.log(`   [${i + 1}] ${row.advisor_name}`);
    console.log(`       ${row.address_city}, ${row.address_state}`);
    console.log(`       Coords: ${row.address_lat.toFixed(4)}, ${row.address_long.toFixed(4)}`);
    console.log(`       Source: ${row.coord_source}, Accuracy: ${row.geocode_accuracy}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('VERIFICATION COMPLETE');
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
