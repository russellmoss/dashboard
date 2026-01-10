/**
 * TEST 1: Basic BigQuery Connection Test
 * =======================================
 * This script verifies that:
 * 1. Your service account credentials are valid
 * 2. You can connect to BigQuery
 * 3. You have access to the savvy-gtm-analytics project
 * 
 * Run with: npm test (or node test-connection.js)
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

// Configuration
const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';

async function testConnection() {
  console.log('\n' + '='.repeat(60));
  console.log('🔌 BIGQUERY CONNECTION TEST');
  console.log('='.repeat(60) + '\n');

  // Step 1: Check credentials file exists
  console.log('Step 1: Checking credentials...');
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  
  if (!credentialsPath) {
    console.error('❌ GOOGLE_APPLICATION_CREDENTIALS not set in .env file');
    console.log('\n📋 Fix: Copy .env.example to .env and update the path');
    process.exit(1);
  }

  const fs = require('fs');
  if (!fs.existsSync(credentialsPath)) {
    console.error(`❌ Credentials file not found: ${credentialsPath}`);
    console.log('\n📋 Fix: Download your service account key and save it to this location');
    process.exit(1);
  }
  
  console.log(`✅ Credentials file found: ${credentialsPath}\n`);

  // Step 2: Initialize BigQuery client
  console.log('Step 2: Initializing BigQuery client...');
  let bigquery;
  
  try {
    bigquery = new BigQuery({
      projectId: PROJECT_ID,
      keyFilename: credentialsPath,
    });
    console.log(`✅ BigQuery client initialized for project: ${PROJECT_ID}\n`);
  } catch (error) {
    console.error('❌ Failed to initialize BigQuery client:', error.message);
    process.exit(1);
  }

  // Step 3: Test basic query
  console.log('Step 3: Testing basic query (SELECT 1)...');
  
  try {
    const [rows] = await bigquery.query('SELECT 1 as test_value');
    console.log('✅ Basic query successful:', rows[0]);
    console.log('');
  } catch (error) {
    console.error('❌ Basic query failed:', error.message);
    console.log('\n📋 This usually means:');
    console.log('   - Service account doesn\'t have BigQuery User role');
    console.log('   - Project ID is incorrect');
    process.exit(1);
  }

  // Step 4: List datasets to verify project access
  console.log('Step 4: Listing datasets in project...');
  
  try {
    const [datasets] = await bigquery.getDatasets();
    console.log(`✅ Found ${datasets.length} datasets:`);
    datasets.forEach(dataset => {
      const marker = dataset.id === 'Tableau_Views' ? ' ⭐ (target)' : '';
      console.log(`   - ${dataset.id}${marker}`);
    });
    console.log('');
    
    const hasTableauViews = datasets.some(d => d.id === 'Tableau_Views');
    if (!hasTableauViews) {
      console.warn('⚠️  Warning: Tableau_Views dataset not found');
      console.log('   This might be a permissions issue or different project');
    }
  } catch (error) {
    console.error('❌ Failed to list datasets:', error.message);
    process.exit(1);
  }

  // Step 5: Check access to vw_funnel_master
  console.log('Step 5: Checking access to vw_funnel_master view...');
  
  try {
    const query = `
      SELECT COUNT(*) as row_count
      FROM \`${PROJECT_ID}.Tableau_Views.vw_funnel_master\`
    `;
    const [rows] = await bigquery.query(query);
    console.log(`✅ View accessible! Total rows: ${rows[0].row_count.toLocaleString()}\n`);
  } catch (error) {
    console.error('❌ Cannot access vw_funnel_master:', error.message);
    console.log('\n📋 Fix: Grant BigQuery Data Viewer role on Tableau_Views dataset');
    process.exit(1);
  }

  // Step 6: Get table schema
  console.log('Step 6: Fetching view schema...');
  
  try {
    const dataset = bigquery.dataset('Tableau_Views');
    const table = dataset.table('vw_funnel_master');
    const [metadata] = await table.getMetadata();
    
    const fields = metadata.schema.fields;
    console.log(`✅ View has ${fields.length} columns. Key fields:\n`);
    
    // Show important fields for dashboard
    const keyFields = [
      'primary_key', 'advisor_name', 'Channel_Grouping_Name', 'Original_source',
      'SGA_Owner_Name__c', 'SGM_Owner_Name__c', 'StageName',
      'is_sql', 'is_sqo', 'is_joined', 'is_sqo_unique', 'is_joined_unique',
      'Opportunity_AUM', 'FilterDate', 'salesforce_url'
    ];
    
    keyFields.forEach(fieldName => {
      const field = fields.find(f => f.name === fieldName);
      if (field) {
        console.log(`   ✓ ${fieldName} (${field.type})`);
      } else {
        console.log(`   ✗ ${fieldName} (not found)`);
      }
    });
    console.log('');
  } catch (error) {
    console.error('❌ Failed to get schema:', error.message);
  }

  // Summary
  console.log('='.repeat(60));
  console.log('🎉 ALL TESTS PASSED - BigQuery connection is working!');
  console.log('='.repeat(60));
  console.log('\n📋 Next steps:');
  console.log('   1. Run: npm run test:query    (test filtered queries)');
  console.log('   2. Run: npm run test:dashboard (test dashboard data structure)');
  console.log('');
}

// Run the test
testConnection().catch(error => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});
