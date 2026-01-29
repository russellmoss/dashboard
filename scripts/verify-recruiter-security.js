#!/usr/bin/env node
/**
 * Recruiter Security Verification Script
 *
 * This script verifies that recruiter users are properly blocked from
 * unauthorized endpoints and can access authorized endpoints.
 *
 * Usage:
 *   1. Start the dev server: npm run dev
 *   2. Get a recruiter session cookie from browser DevTools (Application > Cookies > next-auth.session-token)
 *   3. Run: node scripts/verify-recruiter-security.js <session-token>
 *
 * Or run with environment variable:
 *   RECRUITER_SESSION_TOKEN=<token> node scripts/verify-recruiter-security.js
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SESSION_TOKEN = process.argv[2] || process.env.RECRUITER_SESSION_TOKEN;

if (!SESSION_TOKEN) {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║           Recruiter Security Verification Script                  ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  This script tests recruiter access controls against a running     ║
║  development server.                                               ║
║                                                                    ║
║  SETUP:                                                           ║
║  1. Start the dev server: npm run dev                             ║
║  2. Login as a recruiter user in the browser                      ║
║  3. Open DevTools (F12) > Application > Cookies                   ║
║  4. Copy the value of 'next-auth.session-token'                   ║
║                                                                    ║
║  USAGE:                                                           ║
║  node scripts/verify-recruiter-security.js <session-token>        ║
║                                                                    ║
║  Or set environment variable:                                      ║
║  RECRUITER_SESSION_TOKEN=<token> node scripts/verify-recruiter-security.js
║                                                                    ║
╚══════════════════════════════════════════════════════════════════╝
`);
  process.exit(1);
}

// Endpoints that SHOULD return 403 for recruiters (FORBIDDEN)
const FORBIDDEN_ENDPOINTS = [
  // Dashboard endpoints
  { method: 'POST', path: '/api/dashboard/funnel-metrics', body: { filters: {} } },
  { method: 'POST', path: '/api/dashboard/conversion-rates', body: { filters: {} } },
  { method: 'POST', path: '/api/dashboard/detail-records', body: { filters: {} } },
  { method: 'POST', path: '/api/dashboard/source-performance', body: { filters: {}, groupBy: 'channel' } },
  { method: 'GET', path: '/api/dashboard/filters' },
  { method: 'POST', path: '/api/dashboard/export-sheets', body: { filters: {} } },
  { method: 'POST', path: '/api/dashboard/forecast', body: { filters: {} } },
  { method: 'POST', path: '/api/dashboard/open-pipeline', body: { filters: {} } },
  { method: 'POST', path: '/api/dashboard/pipeline-drilldown', body: { stage: 'Initial Call' } },
  { method: 'GET', path: '/api/dashboard/pipeline-sgm-options' },
  { method: 'POST', path: '/api/dashboard/pipeline-summary', body: {} },

  // SGA Hub endpoints
  { method: 'GET', path: '/api/sga-hub/weekly-goals' },
  { method: 'GET', path: '/api/sga-hub/weekly-actuals' },
  { method: 'GET', path: '/api/sga-hub/quarterly-progress' },
  { method: 'GET', path: '/api/sga-hub/closed-lost' },

  // Games endpoints
  { method: 'GET', path: '/api/games/pipeline-catcher/leaderboard' },
  { method: 'GET', path: '/api/games/pipeline-catcher/levels' },
  { method: 'GET', path: '/api/games/pipeline-catcher/play/2025-Q4' },

  // Explore endpoints
  { method: 'POST', path: '/api/explore/feedback', body: { questionId: 'test', templateId: 'test', question: 'test', feedback: 'positive' } },
  { method: 'POST', path: '/api/agent/query', body: { question: 'How many SQLs?' } },

  // Saved Reports endpoints
  { method: 'GET', path: '/api/saved-reports' },
  { method: 'POST', path: '/api/saved-reports', body: { name: 'Test', filters: {} } },

  // Admin endpoints
  { method: 'GET', path: '/api/admin/refresh-cache' },
];

// Endpoints that SHOULD be accessible to recruiters (200 or 404, but NOT 403)
const ALLOWED_ENDPOINTS = [
  { method: 'POST', path: '/api/recruiter-hub/prospects', body: { stages: ['All'] } },
  { method: 'GET', path: '/api/recruiter-hub/opportunities' },
  { method: 'GET', path: '/api/recruiter-hub/external-agencies' },
  { method: 'GET', path: '/api/dashboard/data-freshness' },
  // record-detail requires valid ID, will return 400/404 but not 403
  { method: 'GET', path: '/api/dashboard/record-detail/00QTEST123456', expectNotForbidden: true },
];

async function makeRequest(endpoint) {
  const url = `${BASE_URL}${endpoint.path}`;
  const options = {
    method: endpoint.method,
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `next-auth.session-token=${SESSION_TOKEN}`,
    },
  };

  if (endpoint.body) {
    options.body = JSON.stringify(endpoint.body);
  }

  try {
    const response = await fetch(url, options);
    return {
      status: response.status,
      ok: response.ok,
    };
  } catch (error) {
    return {
      status: 0,
      error: error.message,
    };
  }
}

async function runTests() {
  console.log('\n🔒 Recruiter Security Verification\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Session Token: ${SESSION_TOKEN.substring(0, 20)}...`);
  console.log('\n' + '='.repeat(70) + '\n');

  let passed = 0;
  let failed = 0;
  const failures = [];

  // Test forbidden endpoints (should return 403)
  console.log('📛 Testing FORBIDDEN endpoints (expect 403):\n');

  for (const endpoint of FORBIDDEN_ENDPOINTS) {
    const result = await makeRequest(endpoint);
    const label = `${endpoint.method} ${endpoint.path}`;

    if (result.status === 403) {
      console.log(`  ✅ ${label} → ${result.status}`);
      passed++;
    } else {
      console.log(`  ❌ ${label} → ${result.status} (expected 403)`);
      failed++;
      failures.push({ endpoint: label, expected: 403, got: result.status });
    }
  }

  console.log('\n' + '-'.repeat(70) + '\n');

  // Test allowed endpoints (should NOT return 403)
  console.log('✅ Testing ALLOWED endpoints (expect NOT 403):\n');

  for (const endpoint of ALLOWED_ENDPOINTS) {
    const result = await makeRequest(endpoint);
    const label = `${endpoint.method} ${endpoint.path}`;

    if (result.status !== 403) {
      console.log(`  ✅ ${label} → ${result.status}`);
      passed++;
    } else {
      console.log(`  ❌ ${label} → ${result.status} (should NOT be 403)`);
      failed++;
      failures.push({ endpoint: label, expected: 'NOT 403', got: result.status });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('\n📊 SUMMARY\n');
  console.log(`  Total tests: ${passed + failed}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);

  if (failures.length > 0) {
    console.log('\n❌ FAILURES:\n');
    for (const f of failures) {
      console.log(`  - ${f.endpoint}: expected ${f.expected}, got ${f.got}`);
    }
    console.log('\n⚠️  Some security tests failed! Review the endpoints above.\n');
    process.exit(1);
  } else {
    console.log('\n✅ All security tests passed!\n');
    process.exit(0);
  }
}

// Check if fetch is available (Node 18+)
if (typeof fetch === 'undefined') {
  console.error('Error: This script requires Node.js 18+ with native fetch support.');
  console.error('Or install node-fetch: npm install node-fetch');
  process.exit(1);
}

runTests().catch(error => {
  console.error('Error running tests:', error);
  process.exit(1);
});
