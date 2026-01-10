/**
 * TEST 2: Filtered Query Test
 * ===========================
 * This script tests the types of queries your dashboard will run:
 * - Date range filtering
 * - Channel/Source filtering
 * - Aggregations for scorecards
 * 
 * Run with: npm run test:query
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const FULL_TABLE = `${PROJECT_ID}.Tableau_Views.vw_funnel_master`;

async function testQueries() {
  console.log('\n' + '='.repeat(60));
  console.log('🔍 FILTERED QUERY TESTS');
  console.log('='.repeat(60) + '\n');

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // Test 1: Get distinct values for filters
  console.log('Test 1: Getting filter dropdown values...\n');
  
  try {
    // Channels
    const [channels] = await bigquery.query(`
      SELECT DISTINCT Channel_Grouping_Name 
      FROM \`${FULL_TABLE}\`
      WHERE Channel_Grouping_Name IS NOT NULL
      ORDER BY Channel_Grouping_Name
    `);
    console.log('📊 Channels available:');
    channels.forEach(c => console.log(`   - ${c.Channel_Grouping_Name}`));
    console.log('');

    // Sources (top 10)
    const [sources] = await bigquery.query(`
      SELECT DISTINCT Original_source, COUNT(*) as cnt
      FROM \`${FULL_TABLE}\`
      WHERE Original_source IS NOT NULL
      GROUP BY Original_source
      ORDER BY cnt DESC
      LIMIT 10
    `);
    console.log('📊 Top 10 Sources:');
    sources.forEach(s => console.log(`   - ${s.Original_source} (${s.cnt} records)`));
    console.log('');

    // SGAs (active ones with records)
    const [sgas] = await bigquery.query(`
      SELECT DISTINCT SGA_Owner_Name__c, COUNT(*) as cnt
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
      GROUP BY SGA_Owner_Name__c
      ORDER BY cnt DESC
      LIMIT 10
    `);
    console.log('📊 Top 10 SGAs:');
    sgas.forEach(s => console.log(`   - ${s.SGA_Owner_Name__c} (${s.cnt} leads)`));
    console.log('');

    // Stages
    const [stages] = await bigquery.query(`
      SELECT DISTINCT StageName, COUNT(*) as cnt
      FROM \`${FULL_TABLE}\`
      WHERE StageName IS NOT NULL
      GROUP BY StageName
      ORDER BY cnt DESC
    `);
    console.log('📊 Stages:');
    stages.forEach(s => console.log(`   - ${s.StageName} (${s.cnt})`));
    console.log('');

  } catch (error) {
    console.error('❌ Filter query failed:', error.message);
    process.exit(1);
  }

  // Test 2: Date-filtered funnel metrics
  console.log('─'.repeat(60));
  console.log('Test 2: Funnel metrics with date filter (last 90 days)...\n');

  try {
    const [metrics] = await bigquery.query(`
      SELECT
        COUNT(*) as total_records,
        SUM(is_contacted) as contacted,
        SUM(is_mql) as mqls,
        SUM(is_sql) as sqls,
        SUM(is_sqo_unique) as sqos,
        SUM(is_joined_unique) as joined,
        ROUND(SUM(CASE WHEN is_sqo_unique = 1 THEN Opportunity_AUM ELSE 0 END) / 1000000, 1) as pipeline_aum_millions
      FROM \`${FULL_TABLE}\`
      WHERE FilterDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
    `);
    
    const m = metrics[0];
    console.log('📈 Funnel Metrics (Last 90 Days):');
    console.log(`   Total Records:  ${Number(m.total_records).toLocaleString()}`);
    console.log(`   Contacted:      ${Number(m.contacted).toLocaleString()}`);
    console.log(`   MQLs:           ${Number(m.mqls).toLocaleString()}`);
    console.log(`   SQLs:           ${Number(m.sqls).toLocaleString()}`);
    console.log(`   SQOs:           ${Number(m.sqos).toLocaleString()}`);
    console.log(`   Joined:         ${Number(m.joined).toLocaleString()}`);
    console.log(`   Pipeline AUM:   $${m.pipeline_aum_millions}M`);
    console.log('');
  } catch (error) {
    console.error('❌ Metrics query failed:', error.message);
    process.exit(1);
  }

  // Test 3: Conversion rates
  console.log('─'.repeat(60));
  console.log('Test 3: Conversion rates calculation...\n');

  try {
    const [rates] = await bigquery.query(`
      SELECT
        SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions)) as contacted_to_mql_rate,
        SAFE_DIVIDE(SUM(mql_to_sql_progression), SUM(eligible_for_mql_conversions)) as mql_to_sql_rate,
        SAFE_DIVIDE(SUM(sql_to_sqo_progression), SUM(eligible_for_sql_conversions)) as sql_to_sqo_rate,
        SAFE_DIVIDE(SUM(sqo_to_joined_progression), SUM(eligible_for_sqo_conversions)) as sqo_to_joined_rate
      FROM \`${FULL_TABLE}\`
      WHERE FilterDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
    `);
    
    const r = rates[0];
    console.log('📊 Conversion Rates (Last 90 Days):');
    console.log(`   Contacted → MQL: ${(r.contacted_to_mql_rate * 100).toFixed(1)}%`);
    console.log(`   MQL → SQL:       ${(r.mql_to_sql_rate * 100).toFixed(1)}%`);
    console.log(`   SQL → SQO:       ${(r.sql_to_sqo_rate * 100).toFixed(1)}%`);
    console.log(`   SQO → Joined:    ${(r.sqo_to_joined_rate * 100).toFixed(1)}%`);
    console.log('');
  } catch (error) {
    console.error('❌ Conversion rates query failed:', error.message);
    process.exit(1);
  }

  // Test 4: Source breakdown (like your Tableau dashboard)
  console.log('─'.repeat(60));
  console.log('Test 4: Source performance breakdown...\n');

  try {
    const [sources] = await bigquery.query(`
      SELECT
        Original_source,
        SUM(is_sql) as sqls,
        SUM(is_sqo_unique) as sqos,
        SAFE_DIVIDE(SUM(sql_to_sqo_progression), SUM(eligible_for_sql_conversions)) as sql_to_sqo_rate,
        SUM(is_joined_unique) as joined,
        ROUND(SUM(CASE WHEN is_sqo_unique = 1 THEN Opportunity_AUM ELSE 0 END) / 1000000, 1) as aum_millions
      FROM \`${FULL_TABLE}\`
      WHERE FilterDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
        AND Original_source IS NOT NULL
      GROUP BY Original_source
      HAVING SUM(is_sql) > 0
      ORDER BY sqls DESC
      LIMIT 10
    `);
    
    console.log('📊 Source Performance (Top 10 by SQLs):');
    console.log('─'.repeat(70));
    console.log('Source                      | SQLs | SQOs | SQL→SQO | Joined | AUM');
    console.log('─'.repeat(70));
    sources.forEach(s => {
      const rate = s.sql_to_sqo_rate ? (s.sql_to_sqo_rate * 100).toFixed(0) + '%' : 'N/A';
      console.log(
        `${s.Original_source.padEnd(27)} | ${String(s.sqls).padStart(4)} | ${String(s.sqos).padStart(4)} | ${rate.padStart(7)} | ${String(s.joined).padStart(6)} | $${s.aum_millions}M`
      );
    });
    console.log('');
  } catch (error) {
    console.error('❌ Source breakdown query failed:', error.message);
    process.exit(1);
  }

  // Test 5: Sample detail records (for drilldown table)
  console.log('─'.repeat(60));
  console.log('Test 5: Sample detail records (for drilldown)...\n');

  try {
    const [records] = await bigquery.query(`
      SELECT
        advisor_name,
        Original_source,
        StageName,
        SGA_Owner_Name__c as sga,
        SGM_Owner_Name__c as sgm,
        ROUND(Opportunity_AUM / 1000000, 1) as aum_millions,
        salesforce_url
      FROM \`${FULL_TABLE}\`
      WHERE is_sqo_unique = 1
        AND FilterDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
      ORDER BY Opportunity_AUM DESC
      LIMIT 5
    `);
    
    console.log('📋 Top 5 SQOs by AUM:');
    console.log('─'.repeat(90));
    records.forEach((r, i) => {
      console.log(`${i + 1}. ${r.advisor_name || 'Unknown'}`);
      console.log(`   Source: ${r.Original_source} | Stage: ${r.StageName} | AUM: $${r.aum_millions}M`);
      console.log(`   SGA: ${r.sga || 'N/A'} | SGM: ${r.sgm || 'N/A'}`);
      console.log(`   SF: ${r.salesforce_url || 'N/A'}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ Detail records query failed:', error.message);
    process.exit(1);
  }

  // Summary
  console.log('='.repeat(60));
  console.log('🎉 ALL QUERY TESTS PASSED!');
  console.log('='.repeat(60));
  console.log('\n📋 Your view supports all the queries needed for the dashboard.');
  console.log('   Run: npm run test:dashboard  (to see the full data structure)\n');
}

testQueries().catch(error => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});
