/**
 * Test Script: Verify BigQuery Data Transfer Permissions
 * 
 * This script tests if the dashboard-bigquery-reader service account
 * can trigger manual data transfer runs.
 * 
 * Run with: node test-data-transfer.js
 */

const { DataTransferServiceClient } = require('@google-cloud/bigquery-data-transfer');

// Your transfer config from the analysis document
const TRANSFER_CONFIG_ID = 'projects/154995667624/locations/northamerica-northeast2/transferConfigs/68d12521-0000-207a-b4fa-ac3eb14e17d8';

async function testPermissions() {
  console.log('🔍 Testing BigQuery Data Transfer permissions...\n');

  try {
    // Initialize client (uses GOOGLE_APPLICATION_CREDENTIALS automatically)
    const client = new DataTransferServiceClient();

    // Test 1: Can we READ the transfer config?
    console.log('Test 1: Reading transfer config...');
    const [config] = await client.getTransferConfig({
      name: TRANSFER_CONFIG_ID,
    });
    console.log('✅ SUCCESS: Can read transfer config');
    console.log(`   Name: ${config.displayName}`);
    console.log(`   Schedule: ${config.schedule}`);
    console.log(`   State: ${config.state}`);
    console.log(`   Next Run: ${config.nextRunTime?.seconds ? new Date(config.nextRunTime.seconds * 1000).toISOString() : 'N/A'}\n`);

    // Test 2: Can we LIST recent runs?
    console.log('Test 2: Listing recent transfer runs...');
    const [runs] = await client.listTransferRuns({
      parent: TRANSFER_CONFIG_ID,
      pageSize: 3,
    });
    console.log(`✅ SUCCESS: Can list transfer runs (${runs.length} recent runs)`);
    if (runs.length > 0) {
      const lastRun = runs[0];
      console.log(`   Last run: ${lastRun.runTime?.seconds ? new Date(lastRun.runTime.seconds * 1000).toISOString() : 'N/A'}`);
      console.log(`   State: ${lastRun.state}`);
    }
    console.log('');

    // Test 3: Can we TRIGGER a manual run?
    console.log('Test 3: Triggering manual transfer run...');
    console.log('   ⚠️  This will actually start a data transfer!\n');
    
    const response = await client.startManualTransferRuns({
      parent: TRANSFER_CONFIG_ID,
      requestedRunTime: {
        seconds: Math.floor(Date.now() / 1000),
      },
    });

    console.log('✅ SUCCESS: Manual transfer triggered!');
    if (response[0]?.runs?.length > 0) {
      const run = response[0].runs[0];
      console.log(`   Run ID: ${run.name}`);
      console.log(`   State: ${run.state}`);
      console.log(`   Started: ${run.runTime?.seconds ? new Date(run.runTime.seconds * 1000).toISOString() : 'N/A'}`);
    }

    console.log('\n========================================');
    console.log('🎉 ALL TESTS PASSED!');
    console.log('========================================');
    console.log('\nYour service account has the required permissions.');
    console.log('You can now implement the on-demand refresh feature.');

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    
    if (error.code === 7) { // PERMISSION_DENIED
      console.error('\n🔒 Permission denied. Possible causes:');
      console.error('   1. BigQuery Admin role not yet propagated (wait 1-2 minutes)');
      console.error('   2. Role was added to wrong service account');
      console.error('   3. Need to update transfer config credentials');
    } else if (error.code === 5) { // NOT_FOUND
      console.error('\n🔍 Transfer config not found. Check the TRANSFER_CONFIG_ID.');
    } else {
      console.error('\nFull error:', error);
    }
    
    process.exit(1);
  }
}

// Run the test
testPermissions();
