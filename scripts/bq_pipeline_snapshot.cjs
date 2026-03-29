"use strict";
require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const bq = new BigQuery({ projectId: "savvy-gtm-analytics", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
async function run() {
  // Active pipeline: open SQO deals by stage with AUM
  const [rows] = await bq.query({
    query: `SELECT
      StageName,
      COUNT(*) AS cnt,
      COUNTIF(COALESCE(Underwritten_AUM__c, Amount) > 0) AS with_aum,
      ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS total_aum_M,
      ROUND(AVG(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS avg_aum_M,
      ROUND(APPROX_QUANTILES(COALESCE(Underwritten_AUM__c, Amount), 100)[OFFSET(50)] / 1e6, 1) AS median_aum_M,
      COUNTIF(Earliest_Anticipated_Start_Date__c IS NOT NULL) AS with_anticipated_start,
      ROUND(AVG(DATE_DIFF(Earliest_Anticipated_Start_Date__c, CURRENT_DATE(), DAY))) AS avg_days_to_start
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1
      AND SQO_raw = 'Yes'
      AND StageName NOT IN ('Joined', 'Closed Lost')
    GROUP BY StageName
    ORDER BY MIN(StageName_code)`,
    useLegacySql: false
  });
  console.log("=== Active SQO Pipeline by Stage ===");
  rows.forEach(r => console.log(JSON.stringify(r)));
}
run().catch(e => console.error("ERR:", e.message));
