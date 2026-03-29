"use strict";
require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const bq = new BigQuery({ projectId: "savvy-gtm-analytics", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
async function run() {
  // Stage-to-stage velocity for all Joined deals
  const [rows] = await bq.query({
    query: `SELECT
      COUNT(*) AS n_joined,
      ROUND(AVG(DATE_DIFF(advisor_join_date__c, DATE(Date_Became_SQO__c), DAY))) AS avg_sqo_to_join_days,
      APPROX_QUANTILES(DATE_DIFF(advisor_join_date__c, DATE(Date_Became_SQO__c), DAY), 100)[OFFSET(25)] AS p25_days,
      APPROX_QUANTILES(DATE_DIFF(advisor_join_date__c, DATE(Date_Became_SQO__c), DAY), 100)[OFFSET(50)] AS median_days,
      APPROX_QUANTILES(DATE_DIFF(advisor_join_date__c, DATE(Date_Became_SQO__c), DAY), 100)[OFFSET(75)] AS p75_days,
      APPROX_QUANTILES(DATE_DIFF(advisor_join_date__c, DATE(Date_Became_SQO__c), DAY), 100)[OFFSET(90)] AS p90_days,
      -- SQO to SP
      ROUND(AVG(CASE WHEN Stage_Entered_Sales_Process__c IS NOT NULL AND Date_Became_SQO__c IS NOT NULL
        THEN DATE_DIFF(DATE(Stage_Entered_Sales_Process__c), DATE(Date_Became_SQO__c), DAY) END)) AS avg_sqo_to_sp_days,
      -- SP to Neg
      ROUND(AVG(CASE WHEN Stage_Entered_Negotiating__c IS NOT NULL AND Stage_Entered_Sales_Process__c IS NOT NULL
        THEN DATE_DIFF(DATE(Stage_Entered_Negotiating__c), DATE(Stage_Entered_Sales_Process__c), DAY) END)) AS avg_sp_to_neg_days,
      -- Neg to Signed
      ROUND(AVG(CASE WHEN Stage_Entered_Signed__c IS NOT NULL AND Stage_Entered_Negotiating__c IS NOT NULL
        THEN DATE_DIFF(DATE(Stage_Entered_Signed__c), DATE(Stage_Entered_Negotiating__c), DAY) END)) AS avg_neg_to_signed_days,
      -- Signed to Joined
      ROUND(AVG(CASE WHEN advisor_join_date__c IS NOT NULL AND Stage_Entered_Signed__c IS NOT NULL
        THEN DATE_DIFF(advisor_join_date__c, DATE(Stage_Entered_Signed__c), DAY) END)) AS avg_signed_to_join_days
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1
      AND SQO_raw = 'Yes'
      AND StageName = 'Joined'
      AND advisor_join_date__c IS NOT NULL
      AND Date_Became_SQO__c IS NOT NULL`,
    useLegacySql: false
  });
  console.log("=== Joined Deal Velocity ===");
  rows.forEach(r => console.log(JSON.stringify(r)));

  // Also look at sqo->join by year
  const [rows2] = await bq.query({
    query: `SELECT
      EXTRACT(YEAR FROM advisor_join_date__c) AS join_year,
      COUNT(*) AS n,
      ROUND(AVG(DATE_DIFF(advisor_join_date__c, DATE(Date_Became_SQO__c), DAY))) AS avg_sqo_to_join_days,
      ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS total_aum_M,
      ROUND(AVG(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS avg_aum_M
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1
      AND SQO_raw = 'Yes'
      AND StageName = 'Joined'
      AND advisor_join_date__c IS NOT NULL
      AND Date_Became_SQO__c IS NOT NULL
    GROUP BY join_year
    ORDER BY join_year`,
    useLegacySql: false
  });
  console.log("=== Joined by Year ===");
  rows2.forEach(r => console.log(JSON.stringify(r)));
}
run().catch(e => console.error("ERR:", e.message));
