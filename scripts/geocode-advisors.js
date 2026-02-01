/**
 * Geocode Advisors Script
 *
 * Geocodes all joined advisors that don't have coordinates.
 * Uses Google Geocoding API (requires GOOGLE_MAPS_API_KEY env var).
 *
 * Handles both full addresses (36 advisors) and city/state only (69 advisors).
 * City/state geocoding returns city center coordinates with 'APPROXIMATE' accuracy.
 *
 * Usage:
 *   node scripts/geocode-advisors.js           # Dry run (no writes)
 *   node scripts/geocode-advisors.js --commit  # Actually write to BigQuery
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const LOCATION = 'northamerica-northeast2';
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const COMMIT_MODE = process.argv.includes('--commit');

async function geocodeAddress(address) {
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
  url.searchParams.set('components', 'country:US'); // Restrict to US

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status === 'OK' && data.results.length > 0) {
    const result = data.results[0];
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      accuracy: result.geometry.location_type,
      formatted_address: result.formatted_address,
    };
  } else if (data.status === 'ZERO_RESULTS') {
    return null;
  } else {
    throw new Error(`Geocoding failed: ${data.status} - ${data.error_message || 'Unknown error'}`);
  }
}

function buildAddressString(row) {
  // Build the best address string for geocoding
  // For full addresses: street, city, state, postal
  // For city/state only: city, state (returns city center)
  const parts = [];

  if (row.address_street_1) {
    parts.push(row.address_street_1);
  }
  if (row.address_city) {
    parts.push(row.address_city);
  }
  if (row.address_state) {
    parts.push(row.address_state);
  }
  if (row.address_postal) {
    parts.push(row.address_postal);
  }

  return parts.join(', ');
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('ADVISOR GEOCODING SCRIPT');
  console.log('='.repeat(60));
  console.log(`Mode: ${COMMIT_MODE ? 'COMMIT (will write to BigQuery)' : 'DRY RUN (no writes)'}`);
  console.log('');

  // Check for API key
  if (!GOOGLE_MAPS_API_KEY) {
    console.error('ERROR: GOOGLE_MAPS_API_KEY environment variable is required');
    console.error('Add it to your .env file: GOOGLE_MAPS_API_KEY=your_key_here');
    process.exit(1);
  }
  console.log('GOOGLE_MAPS_API_KEY: ' + GOOGLE_MAPS_API_KEY.substring(0, 10) + '...');

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // 1. Get advisors that need geocoding
  console.log('\nFetching advisors that need geocoding...\n');

  const query = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.address_street_1,
      v.address_city,
      v.address_state,
      v.address_postal,
      v.has_full_address,
      v.sfdc_lat,
      v.sfdc_long
    FROM \`${PROJECT_ID}.Tableau_Views.vw_joined_advisor_location\` v
    LEFT JOIN \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\` g
      ON v.primary_key = g.primary_key
    WHERE v.has_address = TRUE
      AND v.sfdc_lat IS NULL
      AND g.primary_key IS NULL
    ORDER BY v.advisor_name
  `;

  const options = { query, location: LOCATION };
  const [rows] = await bigquery.query(options);

  const fullAddressCount = rows.filter(r => r.has_full_address).length;
  const cityStateCount = rows.filter(r => !r.has_full_address).length;

  console.log(`Found ${rows.length} advisors to geocode`);
  console.log(`  - Full address (street+city+state): ${fullAddressCount}`);
  console.log(`  - City/state only: ${cityStateCount}\n`);

  if (rows.length === 0) {
    console.log('All advisors already have coordinates!');
    return;
  }

  // 2. Geocode each advisor
  const results = [];
  let successCount = 0;
  let failCount = 0;
  const accuracyCounts = {};

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const addressString = buildAddressString(row);
    const addressType = row.has_full_address ? 'FULL' : 'CITY/STATE';

    // Truncate name for display
    const displayName = row.advisor_name.length > 25
      ? row.advisor_name.substring(0, 22) + '...'
      : row.advisor_name.padEnd(25);

    process.stdout.write(`[${String(i + 1).padStart(3)}/${rows.length}] ${displayName} (${addressType.padEnd(10)}) `);

    if (!addressString || addressString.trim() === '') {
      console.log('No address to geocode');
      failCount++;
      continue;
    }

    try {
      // Rate limit: 50 requests/sec for Google, but we'll be conservative
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      }

      const geo = await geocodeAddress(addressString);

      if (geo) {
        console.log(`${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)} (${geo.accuracy})`);

        // Track accuracy counts
        accuracyCounts[geo.accuracy] = (accuracyCounts[geo.accuracy] || 0) + 1;

        results.push({
          primary_key: row.primary_key,
          address_input: addressString,
          lat: geo.lat,
          lng: geo.lng,
          geocode_accuracy: geo.accuracy,
          geocode_source: 'google',
          geocoded_at: new Date().toISOString(),
        });
        successCount++;
      } else {
        console.log('No results found');
        failCount++;
      }
    } catch (error) {
      console.log(`Error: ${error.message}`);
      failCount++;
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log('RESULTS SUMMARY');
  console.log('-'.repeat(60));
  console.log(`Total processed: ${rows.length}`);
  console.log(`Successfully geocoded: ${successCount}`);
  console.log(`Failed: ${failCount}`);
  console.log('\nAccuracy distribution:');
  console.log(`  - ROOFTOP (street-level): ${accuracyCounts['ROOFTOP'] || 0}`);
  console.log(`  - RANGE_INTERPOLATED: ${accuracyCounts['RANGE_INTERPOLATED'] || 0}`);
  console.log(`  - GEOMETRIC_CENTER (city center): ${accuracyCounts['GEOMETRIC_CENTER'] || 0}`);
  console.log(`  - APPROXIMATE: ${accuracyCounts['APPROXIMATE'] || 0}`);

  // 3. Write to BigQuery (if commit mode)
  if (COMMIT_MODE && results.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('WRITING TO BIGQUERY...');
    console.log('-'.repeat(60));

    const table = bigquery
      .dataset('Tableau_Views', { location: LOCATION })
      .table('geocoded_addresses');

    await table.insert(results);

    console.log(`Inserted ${results.length} rows into geocoded_addresses`);

    // Verify the insert
    console.log('\nVerifying insert...');
    const [verifyRows] = await bigquery.query({
      query: `
        SELECT COUNT(*) as count
        FROM \`${PROJECT_ID}.Tableau_Views.geocoded_addresses\`
      `,
      location: LOCATION,
    });
    console.log(`Total rows in geocoded_addresses: ${verifyRows[0].count}`);

    // Check view now has coordinates
    const [viewRows] = await bigquery.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNTIF(address_lat IS NOT NULL) as with_coords,
          COUNTIF(coord_source = 'Geocoded') as geocoded
        FROM \`${PROJECT_ID}.Tableau_Views.vw_joined_advisor_location\`
      `,
      location: LOCATION,
    });
    console.log(`\nView stats after geocoding:`);
    console.log(`  Total advisors: ${viewRows[0].total}`);
    console.log(`  With coordinates: ${viewRows[0].with_coords}`);
    console.log(`  Geocoded source: ${viewRows[0].geocoded}`);

  } else if (results.length > 0) {
    console.log('\n' + '-'.repeat(60));
    console.log('DRY RUN - No data written');
    console.log('-'.repeat(60));
    console.log('Run with --commit to write to BigQuery.');
    console.log('\nSample results (first 5):');
    results.slice(0, 5).forEach((r, i) => {
      console.log(`  [${i + 1}] ${r.primary_key.substring(0, 20)}...`);
      console.log(`      ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)} (${r.geocode_accuracy})`);
      console.log(`      Address: ${r.address_input.substring(0, 50)}...`);
    });
  }

  console.log('\n' + '='.repeat(60));
  console.log(COMMIT_MODE ? 'GEOCODING COMPLETE' : 'DRY RUN COMPLETE');
  console.log('='.repeat(60) + '\n');
}

main().catch(error => {
  console.error('\nFATAL ERROR:', error.message);
  process.exit(1);
});
