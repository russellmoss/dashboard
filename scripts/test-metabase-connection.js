// scripts/test-metabase-connection.js
// Test script to verify Metabase instance is reachable
// Run with: node scripts/test-metabase-connection.js

const METABASE_URL = 'https://metabase-production-e2dd.up.railway.app';

async function testConnection() {
  console.log('Metabase Connection Test\n');
  console.log('='.repeat(50));
  console.log(`Testing: ${METABASE_URL}\n`);

  try {
    // Test 1: Basic connectivity (health check)
    console.log('Test 1: Basic connectivity...');
    const healthResponse = await fetch(`${METABASE_URL}/api/health`);

    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      console.log(`  Status: ${healthResponse.status}`);
      console.log(`  Health: ${JSON.stringify(healthData)}`);
      console.log('  Result: PASS\n');
    } else {
      console.log(`  Status: ${healthResponse.status}`);
      console.log('  Result: FAIL (unhealthy)\n');
    }

    // Test 2: Main page loads
    console.log('Test 2: Main page accessibility...');
    const mainResponse = await fetch(METABASE_URL, {
      redirect: 'follow',
    });

    console.log(`  Status: ${mainResponse.status}`);
    console.log(`  Content-Type: ${mainResponse.headers.get('content-type')}`);

    if (mainResponse.ok) {
      console.log('  Result: PASS\n');
    } else {
      console.log('  Result: FAIL\n');
    }

    // Test 3: API is responding
    console.log('Test 3: API endpoint check...');
    const apiResponse = await fetch(`${METABASE_URL}/api/session/properties`, {
      headers: {
        'Accept': 'application/json',
      },
    });

    console.log(`  Status: ${apiResponse.status}`);

    if (apiResponse.ok) {
      const apiData = await apiResponse.json();
      console.log(`  Version: ${apiData.version?.tag || 'unknown'}`);
      console.log(`  Setup Complete: ${apiData['setup-token'] ? 'No' : 'Yes'}`);
      console.log('  Result: PASS\n');
    } else {
      console.log('  Result: FAIL\n');
    }

    console.log('='.repeat(50));
    console.log('Connection test complete!');
    console.log('\nMetabase URL for .env files:');
    console.log(`  METABASE_SITE_URL=${METABASE_URL}`);
    console.log(`  NEXT_PUBLIC_METABASE_SITE_URL=${METABASE_URL}`);

  } catch (error) {
    console.error('Connection test failed with error:');
    console.error(`  ${error.message}`);
    console.log('\n='.repeat(50));
    console.log('Metabase instance may not be running or is unreachable.');
    process.exit(1);
  }
}

testConnection();
