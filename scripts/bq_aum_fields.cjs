"use strict";
require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const bq = new BigQuery({ projectId: "savvy-gtm-analytics", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
async function run() {
  const [rows] = await bq.query({
    query: `SELECT
      COUNTIF(Underwritten_AUM__c IS NOT NULL) / COUNT(*) AS uw_aum_pop_rate,
      COUNTIF(Amount IS NOT NULL) / COUNT(*) AS amount_pop_rate,
      COUNTIF(Opportunity_AUM IS NOT NULL) / COUNT(*) AS opp_aum_pop_rate,
      COUNTIF(Actual_ARR__c IS NOT NULL) / COUNT(*) AS actual_arr_pop_rate,
      COUNTIF(SGM_Estimated_ARR__c IS NOT NULL) / COUNT(*) AS sgm_est_arr_pop_rate,
      COUNTIF(COALESCE(Underwritten_AUM__c, Amount) IS NOT NULL) / COUNT(*) AS any_aum_pop_rate,
      COUNTIF(COALESCE(Underwritten_AUM__c, Amount) > 0) / COUNT(*) AS any_aum_positive_rate,
      -- For SQO+Joined only
      COUNTIF(SQO_raw = 'Yes' AND StageName = 'Joined' AND COALESCE(Underwritten_AUM__c, Amount) > 0) AS joined_sqo_with_aum,
      COUNTIF(SQO_raw = 'Yes' AND StageName = 'Joined') AS joined_sqo_total,
      MAX(COALESCE(Underwritten_AUM__c, Amount)) / 1e6 AS max_aum_M,
      APPROX_QUANTILES(COALESCE(Underwritten_AUM__c, Amount), 100)[OFFSET(50)] / 1e6 AS median_aum_M
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1`,
    useLegacySql: false
  });
  rows.forEach(r => console.log(JSON.stringify(r)));
}
run().catch(e => console.error("ERR:", e.message));
