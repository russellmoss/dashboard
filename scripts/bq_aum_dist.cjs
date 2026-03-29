"use strict";
require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const bq = new BigQuery({ projectId: "savvy-gtm-analytics", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
async function run() {
  // AUM distribution by tier for Joined SQO deals
  const [rows] = await bq.query({
    query: `SELECT
      aum_tier,
      COUNT(*) AS cnt,
      ROUND(COUNT(*) / SUM(COUNT(*)) OVER (), 3) AS pct,
      ROUND(MIN(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS min_M,
      ROUND(APPROX_QUANTILES(COALESCE(Underwritten_AUM__c, Amount), 100)[OFFSET(50)] / 1e6, 1) AS median_M,
      ROUND(MAX(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS max_M,
      ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS total_M
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1
      AND SQO_raw = 'Yes'
      AND StageName = 'Joined'
      AND COALESCE(Underwritten_AUM__c, Amount) > 0
    GROUP BY aum_tier
    ORDER BY MIN(COALESCE(Underwritten_AUM__c, Amount))`,
    useLegacySql: false
  });
  console.log("=== Joined SQO AUM by Tier ===");
  rows.forEach(r => console.log(JSON.stringify(r)));

  // AUM in active pipeline (open SQO)
  const [rows2] = await bq.query({
    query: `SELECT
      aum_tier,
      COUNT(*) AS cnt,
      ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS total_aum_M
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1
      AND SQO_raw = 'Yes'
      AND StageName NOT IN ('Joined', 'Closed Lost')
      AND COALESCE(Underwritten_AUM__c, Amount) > 0
    GROUP BY aum_tier
    ORDER BY MIN(COALESCE(Underwritten_AUM__c, Amount))`,
    useLegacySql: false
  });
  console.log("=== Open SQO Pipeline AUM by Tier ===");
  rows2.forEach(r => console.log(JSON.stringify(r)));

  // Win rate (SQO -> Joined vs Closed Lost)
  const [rows3] = await bq.query({
    query: `SELECT
      COUNTIF(StageName = 'Joined') AS joined,
      COUNTIF(StageName = 'Closed Lost') AS closed_lost,
      ROUND(COUNTIF(StageName = 'Joined') / (COUNTIF(StageName = 'Joined') + COUNTIF(StageName = 'Closed Lost')), 3) AS win_rate,
      COUNTIF(StageName NOT IN ('Joined','Closed Lost')) AS still_open
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1
      AND SQO_raw = 'Yes'`,
    useLegacySql: false
  });
  console.log("=== SQO Win Rate ===");
  rows3.forEach(r => console.log(JSON.stringify(r)));
}
run().catch(e => console.error("ERR:", e.message));
