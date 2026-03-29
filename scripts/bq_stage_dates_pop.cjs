"use strict";
require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const bq = new BigQuery({ projectId: "savvy-gtm-analytics", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
async function run() {
  // Population rates for stage date fields (among primary opp records with SQO)
  const [rows] = await bq.query({
    query: `SELECT
      COUNT(*) AS total_sqo,
      COUNTIF(Date_Became_SQO__c IS NOT NULL) / COUNT(*) AS sqo_date_pop,
      COUNTIF(Stage_Entered_Discovery__c IS NOT NULL) / COUNT(*) AS discovery_pop,
      COUNTIF(Stage_Entered_Sales_Process__c IS NOT NULL) / COUNT(*) AS sp_pop,
      COUNTIF(Stage_Entered_Negotiating__c IS NOT NULL) / COUNT(*) AS neg_pop,
      COUNTIF(Stage_Entered_Signed__c IS NOT NULL) / COUNT(*) AS signed_pop,
      COUNTIF(Stage_Entered_Joined__c IS NOT NULL) / COUNT(*) AS joined_pop,
      COUNTIF(advisor_join_date__c IS NOT NULL) / COUNT(*) AS join_date_pop,
      COUNTIF(Earliest_Anticipated_Start_Date__c IS NOT NULL) / COUNT(*) AS anticipated_start_pop,
      COUNTIF(Qualification_Call_Date__c IS NOT NULL) / COUNT(*) AS qual_call_pop,
      -- For Joined specifically
      COUNTIF(StageName = 'Joined' AND Stage_Entered_Joined__c IS NOT NULL) AS joined_with_entry_ts,
      COUNTIF(StageName = 'Joined' AND advisor_join_date__c IS NOT NULL) AS joined_with_join_date,
      COUNTIF(StageName = 'Joined') AS total_joined
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1
      AND SQO_raw = 'Yes'`,
    useLegacySql: false
  });
  rows.forEach(r => console.log(JSON.stringify(r)));
}
run().catch(e => console.error("ERR:", e.message));
