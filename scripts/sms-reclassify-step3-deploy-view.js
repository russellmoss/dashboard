/**
 * Step 3: Deploy vw_sga_sms_timing_analysis_v2 and validate alignment
 *
 * Creates the new view anchored on vw_funnel_master, then runs validation
 * queries to confirm stage counts match between the views.
 *
 * Run: node scripts/sms-reclassify-step3-deploy-view.js
 */

const fs = require('fs');
const path = require('path');
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const bigquery = new BigQuery({
  projectId: PROJECT_ID,
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

async function main() {
  console.log('Step 3: Deploying vw_sga_sms_timing_analysis_v2...\n');

  // Read and execute the view SQL
  const sqlPath = path.join(__dirname, 'deploy-sms-timing-view-v2.sql');
  const viewSql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Creating view...');
  const [job] = await bigquery.createQueryJob({ query: viewSql });
  await job.getQueryResults();
  console.log('  ✓ View created\n');

  // ── Validation: compare v2 against funnel master ──
  console.log('Running alignment validation...\n');

  // Test 1: Row count & stage totals
  const [v2Stats] = await bigquery.query(`
    SELECT
      COUNT(*) AS total_leads,
      COUNTIF(received_any_sms = 1) AS sms_leads,
      COUNTIF(got_reply = 1) AS replied_leads,
      SUM(is_mql) AS is_mql,
      SUM(contacted_to_mql_progression) AS contacted_to_mql,
      SUM(is_sql) AS is_sql,
      SUM(is_sqo) AS is_sqo,
      SUM(is_joined) AS is_joined
    FROM \`savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2\`
  `);

  const [fmStats] = await bigquery.query(`
    SELECT
      COUNTIF(is_contacted = 1) AS total_contacted,
      SUM(is_mql) AS is_mql,
      SUM(contacted_to_mql_progression) AS contacted_to_mql,
      SUM(is_sql) AS is_sql,
      SUM(is_sqo) AS is_sqo,
      SUM(is_joined) AS is_joined
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE SGA_Owner_Name__c IS NOT NULL
      AND SGA_Owner_Name__c != 'Savvy Operations'
      AND is_contacted = 1
  `);

  console.log('--- v2 View Stats ---');
  const v2 = v2Stats[0];
  console.log(`  Total leads:     ${fmt(v2.total_leads)}`);
  console.log(`  With SMS:        ${fmt(v2.sms_leads)}`);
  console.log(`  Got reply:       ${fmt(v2.replied_leads)}`);
  console.log(`  is_mql:          ${fmt(v2.is_mql)}`);
  console.log(`  contacted→mql:   ${fmt(v2.contacted_to_mql)}`);
  console.log(`  is_sql:          ${fmt(v2.is_sql)}`);
  console.log(`  is_sqo:          ${fmt(v2.is_sqo)}`);
  console.log(`  is_joined:       ${fmt(v2.is_joined)}`);

  console.log('\n--- Funnel Master Stats (same filters) ---');
  const fm = fmStats[0];
  console.log(`  Total contacted: ${fmt(fm.total_contacted)}`);
  console.log(`  is_mql:          ${fmt(fm.is_mql)}`);
  console.log(`  contacted→mql:   ${fmt(fm.contacted_to_mql)}`);
  console.log(`  is_sql:          ${fmt(fm.is_sql)}`);
  console.log(`  is_sqo:          ${fmt(fm.is_sqo)}`);
  console.log(`  is_joined:       ${fmt(fm.is_joined)}`);

  // Test 2: Check alignment
  console.log('\n--- Alignment Check ---');
  const checks = [
    ['is_mql', v2.is_mql, fm.is_mql],
    ['contacted_to_mql', v2.contacted_to_mql, fm.contacted_to_mql],
    ['is_sql', v2.is_sql, fm.is_sql],
    ['is_sqo', v2.is_sqo, fm.is_sqo],
    ['is_joined', v2.is_joined, fm.is_joined],
  ];

  let allPass = true;
  for (const [name, v2Val, fmVal] of checks) {
    const match = Number(v2Val) === Number(fmVal);
    const icon = match ? '✓' : '✗';
    console.log(`  ${icon} ${name}: v2=${fmt(v2Val)} vs fm=${fmt(fmVal)}`);
    if (!match) allPass = false;
  }

  // Test 3: v1 vs v2 comparison
  const [v1Stats] = await bigquery.query(`
    SELECT
      COUNT(*) AS total_leads,
      SUM(contacted_to_mql_progression) AS contacted_to_mql
    FROM \`savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis\`
  `);

  console.log('\n--- v1 → v2 Comparison ---');
  console.log(`  v1 leads: ${fmt(v1Stats[0].total_leads)} (365-day window)`);
  console.log(`  v2 leads: ${fmt(v2.total_leads)} (all history)`);
  console.log(`  v1 contacted→mql: ${fmt(v1Stats[0].contacted_to_mql)}`);
  console.log(`  v2 contacted→mql: ${fmt(v2.contacted_to_mql)}`);

  // Test 4: Intent classification coverage
  const [intentCoverage] = await bigquery.query(`
    SELECT
      COUNTIF(first_sms_intent IS NOT NULL) AS has_intent,
      COUNTIF(first_sms_intent IS NULL AND received_any_sms = 1) AS missing_intent,
      COUNTIF(received_any_sms = 1) AS total_sms_leads
    FROM \`savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2\`
  `);

  const ic = intentCoverage[0];
  const pct = (Number(ic.has_intent) / Number(ic.total_sms_leads) * 100).toFixed(1);
  console.log(`\n--- Intent Classification Coverage ---`);
  console.log(`  Has intent:    ${fmt(ic.has_intent)} / ${fmt(ic.total_sms_leads)} (${pct}%)`);
  console.log(`  Missing:       ${fmt(ic.missing_intent)}`);

  console.log(allPass
    ? '\n✅ All stage counts align with funnel master.'
    : '\n⚠️  Stage count mismatches detected — investigate above.'
  );
}

function fmt(n) {
  return Number(n).toLocaleString();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
