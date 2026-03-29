"use strict";
require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const bq = new BigQuery({ projectId: "savvy-gtm-analytics", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
async function run() {
  // Sample of closed-won (Joined) deals with stage progression dates
  const [rows] = await bq.query({
    query: `SELECT
      Full_Opportunity_ID__c,
      advisor_name,
      StageName,
      SQO_raw,
      DATE(Opp_CreatedDate) AS opp_created,
      DATE(Date_Became_SQO__c) AS sqo_date,
      DATE(Stage_Entered_Discovery__c) AS entered_discovery,
      DATE(Stage_Entered_Sales_Process__c) AS entered_sp,
      DATE(Stage_Entered_Negotiating__c) AS entered_neg,
      DATE(Stage_Entered_Signed__c) AS entered_signed,
      DATE(Stage_Entered_Joined__c) AS entered_joined,
      advisor_join_date__c AS join_date,
      Earliest_Anticipated_Start_Date__c AS anticipated_start,
      Underwritten_AUM__c / 1e6 AS uw_aum_M,
      Amount / 1e6 AS amount_M,
      Opportunity_AUM / 1e6 AS opp_aum_M,
      Opportunity_AUM_M,
      aum_tier,
      Actual_ARR__c,
      SGM_Estimated_ARR__c
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1
      AND StageName = 'Joined'
      AND SQO_raw = 'Yes'
    ORDER BY advisor_join_date__c DESC
    LIMIT 20`,
    useLegacySql: false
  });
  rows.forEach(r => console.log(JSON.stringify(r)));
}
run().catch(e => console.error("ERR:", e.message));
