/**
 * TEST 3: Dashboard Data Structure Test
 * ======================================
 * This script simulates what your Next.js API routes will return.
 * It builds the exact JSON structure your React dashboard will consume.
 * 
 * Run with: npm run test:dashboard
 */

require('dotenv').config();
const { BigQuery } = require('@google-cloud/bigquery');

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';
const FULL_TABLE = `${PROJECT_ID}.Tableau_Views.vw_funnel_master`;

// Simulated filter parameters (what would come from frontend)
const filters = {
  startDate: '2024-10-01',
  endDate: '2025-01-09',
  channel: null,        // null means "all"
  source: null,
  sga: null,
  sgm: null,
  stage: null,
};

async function buildDashboardData() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 DASHBOARD DATA STRUCTURE TEST');
  console.log('='.repeat(60) + '\n');

  const bigquery = new BigQuery({
    projectId: PROJECT_ID,
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  });

  // Build WHERE clause from filters
  function buildWhereClause(filters) {
    const conditions = [
      `FilterDate >= TIMESTAMP('${filters.startDate}')`,
      `FilterDate <= TIMESTAMP('${filters.endDate} 23:59:59')`,
    ];
    
    if (filters.channel) {
      conditions.push(`Channel_Grouping_Name = '${filters.channel}'`);
    }
    if (filters.source) {
      conditions.push(`Original_source = '${filters.source}'`);
    }
    if (filters.sga) {
      conditions.push(`SGA_Owner_Name__c = '${filters.sga}'`);
    }
    if (filters.sgm) {
      conditions.push(`SGM_Owner_Name__c = '${filters.sgm}'`);
    }
    if (filters.stage) {
      conditions.push(`StageName = '${filters.stage}'`);
    }
    
    return conditions.join(' AND ');
  }

  const whereClause = buildWhereClause(filters);
  console.log('📅 Filters applied:', filters);
  console.log('📝 WHERE clause:', whereClause);
  console.log('');

  // Build the dashboard response object
  const dashboardData = {
    filters: {
      applied: filters,
      available: {},
    },
    scorecards: {},
    conversionRates: {},
    sourcePerformance: [],
    detailRecords: [],
    metadata: {
      generatedAt: new Date().toISOString(),
      queryTimeMs: 0,
    },
  };

  const startTime = Date.now();

  try {
    // 1. Get available filter values
    console.log('Fetching available filter values...');
    
    const [channelRows] = await bigquery.query(`
      SELECT DISTINCT Channel_Grouping_Name as value
      FROM \`${FULL_TABLE}\`
      WHERE Channel_Grouping_Name IS NOT NULL
      ORDER BY value
    `);
    dashboardData.filters.available.channels = channelRows.map(r => r.value);

    const [sourceRows] = await bigquery.query(`
      SELECT DISTINCT Original_source as value
      FROM \`${FULL_TABLE}\`
      WHERE Original_source IS NOT NULL
      ORDER BY value
    `);
    dashboardData.filters.available.sources = sourceRows.map(r => r.value);

    const [sgaRows] = await bigquery.query(`
      SELECT DISTINCT SGA_Owner_Name__c as value
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
      ORDER BY value
    `);
    dashboardData.filters.available.sgas = sgaRows.map(r => r.value);

    const [sgmRows] = await bigquery.query(`
      SELECT DISTINCT SGM_Owner_Name__c as value
      FROM \`${FULL_TABLE}\`
      WHERE SGM_Owner_Name__c IS NOT NULL
      ORDER BY value
    `);
    dashboardData.filters.available.sgms = sgmRows.map(r => r.value);

    const [stageRows] = await bigquery.query(`
      SELECT DISTINCT StageName as value
      FROM \`${FULL_TABLE}\`
      WHERE StageName IS NOT NULL
      ORDER BY value
    `);
    dashboardData.filters.available.stages = stageRows.map(r => r.value);

    console.log('✅ Filter values loaded\n');

    // 2. Get scorecard metrics
    console.log('Fetching scorecard metrics...');
    
    const [metrics] = await bigquery.query(`
      SELECT
        SUM(is_sql) as sqls,
        SUM(is_sqo_unique) as sqos,
        SUM(is_joined_unique) as joined,
        SUM(CASE WHEN is_sqo_unique = 1 THEN Opportunity_AUM ELSE 0 END) as pipeline_aum,
        SUM(CASE WHEN is_joined_unique = 1 THEN Opportunity_AUM ELSE 0 END) as joined_aum
      FROM \`${FULL_TABLE}\`
      WHERE ${whereClause}
    `);

    dashboardData.scorecards = {
      sqls: {
        value: Number(metrics[0].sqls) || 0,
        forecast: null, // Would come from vw_daily_forecast
        variance: null,
      },
      sqos: {
        value: Number(metrics[0].sqos) || 0,
        forecast: null,
        variance: null,
      },
      joined: {
        value: Number(metrics[0].joined) || 0,
        forecast: null,
        variance: null,
      },
      pipelineAum: {
        value: Number(metrics[0].pipeline_aum) || 0,
        formatted: formatCurrency(metrics[0].pipeline_aum),
      },
      joinedAum: {
        value: Number(metrics[0].joined_aum) || 0,
        formatted: formatCurrency(metrics[0].joined_aum),
      },
    };

    console.log('✅ Scorecards loaded\n');

    // 3. Get conversion rates
    console.log('Fetching conversion rates...');
    
    const [rates] = await bigquery.query(`
      SELECT
        SUM(eligible_for_contacted_conversions) as contacted_denom,
        SUM(contacted_to_mql_progression) as contacted_numer,
        SUM(eligible_for_mql_conversions) as mql_denom,
        SUM(mql_to_sql_progression) as mql_numer,
        SUM(eligible_for_sql_conversions) as sql_denom,
        SUM(sql_to_sqo_progression) as sql_numer,
        SUM(eligible_for_sqo_conversions) as sqo_denom,
        SUM(sqo_to_joined_progression) as sqo_numer
      FROM \`${FULL_TABLE}\`
      WHERE ${whereClause}
    `);

    const r = rates[0];
    dashboardData.conversionRates = {
      contactedToMql: {
        rate: safeDiv(r.contacted_numer, r.contacted_denom),
        numerator: Number(r.contacted_numer) || 0,
        denominator: Number(r.contacted_denom) || 0,
      },
      mqlToSql: {
        rate: safeDiv(r.mql_numer, r.mql_denom),
        numerator: Number(r.mql_numer) || 0,
        denominator: Number(r.mql_denom) || 0,
      },
      sqlToSqo: {
        rate: safeDiv(r.sql_numer, r.sql_denom),
        numerator: Number(r.sql_numer) || 0,
        denominator: Number(r.sql_denom) || 0,
      },
      sqoToJoined: {
        rate: safeDiv(r.sqo_numer, r.sqo_denom),
        numerator: Number(r.sqo_numer) || 0,
        denominator: Number(r.sqo_denom) || 0,
      },
    };

    console.log('✅ Conversion rates loaded\n');

    // 4. Get source performance table
    console.log('Fetching source performance...');
    
    const [sources] = await bigquery.query(`
      SELECT
        Original_source as source,
        SUM(is_sql) as sqls,
        SUM(is_sqo_unique) as sqos,
        SUM(eligible_for_sql_conversions) as sql_denom,
        SUM(sql_to_sqo_progression) as sql_numer,
        SUM(is_joined_unique) as joined,
        SUM(eligible_for_sqo_conversions) as sqo_denom,
        SUM(sqo_to_joined_progression) as sqo_numer,
        SUM(CASE WHEN is_sqo_unique = 1 THEN Opportunity_AUM ELSE 0 END) as aum
      FROM \`${FULL_TABLE}\`
      WHERE ${whereClause}
        AND Original_source IS NOT NULL
      GROUP BY Original_source
      HAVING SUM(is_sql) > 0
      ORDER BY sqls DESC
    `);

    dashboardData.sourcePerformance = sources.map(s => ({
      source: s.source,
      sqls: Number(s.sqls) || 0,
      sqos: Number(s.sqos) || 0,
      sqlToSqoRate: safeDiv(s.sql_numer, s.sql_denom),
      joined: Number(s.joined) || 0,
      sqoToJoinedRate: safeDiv(s.sqo_numer, s.sqo_denom),
      aum: Number(s.aum) || 0,
      aumFormatted: formatCurrency(s.aum),
    }));

    console.log('✅ Source performance loaded\n');

    // 5. Get detail records for drilldown
    console.log('Fetching detail records...');
    
    const [records] = await bigquery.query(`
      SELECT
        primary_key as id,
        advisor_name,
        Original_source as source,
        StageName as stage,
        SGA_Owner_Name__c as sga,
        SGM_Owner_Name__c as sgm,
        Opportunity_AUM as aum,
        salesforce_url,
        FilterDate as created_date
      FROM \`${FULL_TABLE}\`
      WHERE ${whereClause}
        AND is_sqo_unique = 1
      ORDER BY Opportunity_AUM DESC
      LIMIT 100
    `);

    dashboardData.detailRecords = records.map(r => ({
      id: r.id,
      advisorName: r.advisor_name,
      source: r.source,
      stage: r.stage,
      sga: r.sga,
      sgm: r.sgm,
      aum: Number(r.aum) || 0,
      aumFormatted: formatCurrency(r.aum),
      salesforceUrl: r.salesforce_url,
      createdDate: r.created_date?.value || null,
    }));

    console.log('✅ Detail records loaded\n');

  } catch (error) {
    console.error('❌ Query failed:', error.message);
    process.exit(1);
  }

  dashboardData.metadata.queryTimeMs = Date.now() - startTime;

  // Output the final JSON structure
  console.log('='.repeat(60));
  console.log('📦 FINAL DASHBOARD DATA STRUCTURE');
  console.log('='.repeat(60));
  console.log('\nThis is what your React app will receive from the API:\n');
  
  // Pretty print with truncation for readability
  const output = {
    ...dashboardData,
    filters: {
      applied: dashboardData.filters.applied,
      available: {
        channels: `[${dashboardData.filters.available.channels?.length || 0} items]`,
        sources: `[${dashboardData.filters.available.sources?.length || 0} items]`,
        sgas: `[${dashboardData.filters.available.sgas?.length || 0} items]`,
        sgms: `[${dashboardData.filters.available.sgms?.length || 0} items]`,
        stages: dashboardData.filters.available.stages,
      },
    },
    sourcePerformance: `[${dashboardData.sourcePerformance.length} sources]`,
    detailRecords: `[${dashboardData.detailRecords.length} records]`,
  };
  
  console.log(JSON.stringify(output, null, 2));

  console.log('\n' + '─'.repeat(60));
  console.log('📊 SCORECARDS DETAIL:');
  console.log('─'.repeat(60));
  console.log(JSON.stringify(dashboardData.scorecards, null, 2));

  console.log('\n' + '─'.repeat(60));
  console.log('📈 CONVERSION RATES DETAIL:');
  console.log('─'.repeat(60));
  Object.entries(dashboardData.conversionRates).forEach(([key, val]) => {
    console.log(`${key}: ${(val.rate * 100).toFixed(1)}% (${val.numerator}/${val.denominator})`);
  });

  console.log('\n' + '─'.repeat(60));
  console.log('📋 TOP 5 SOURCES:');
  console.log('─'.repeat(60));
  dashboardData.sourcePerformance.slice(0, 5).forEach((s, i) => {
    console.log(`${i + 1}. ${s.source}: ${s.sqls} SQLs, ${s.sqos} SQOs, ${(s.sqlToSqoRate * 100).toFixed(0)}% rate, ${s.aumFormatted}`);
  });

  console.log('\n' + '─'.repeat(60));
  console.log('👤 TOP 5 RECORDS:');
  console.log('─'.repeat(60));
  dashboardData.detailRecords.slice(0, 5).forEach((r, i) => {
    console.log(`${i + 1}. ${r.advisorName || 'Unknown'} - ${r.aumFormatted} (${r.stage})`);
  });

  console.log('\n' + '='.repeat(60));
  console.log(`⏱️  Total query time: ${dashboardData.metadata.queryTimeMs}ms`);
  console.log('='.repeat(60));
  console.log('\n🎉 Dashboard data structure is ready for your React app!\n');

  // Write to file for reference
  const fs = require('fs');
  fs.writeFileSync(
    './dashboard-data-sample.json', 
    JSON.stringify(dashboardData, null, 2)
  );
  console.log('📁 Full data written to: dashboard-data-sample.json\n');
}

// Utility functions
function safeDiv(numerator, denominator) {
  const n = Number(numerator) || 0;
  const d = Number(denominator) || 0;
  return d === 0 ? 0 : n / d;
}

function formatCurrency(value) {
  const v = Number(value) || 0;
  if (v >= 1000000000) return '$' + (v / 1000000000).toFixed(1) + 'B';
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(0) + 'M';
  if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}

buildDashboardData().catch(error => {
  console.error('\n💥 Unexpected error:', error);
  process.exit(1);
});
