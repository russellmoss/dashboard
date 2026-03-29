"use strict";
require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const bq = new BigQuery({ projectId: "savvy-gtm-analytics", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
async function run() {
  const [rows] = await bq.query({
    query: `SELECT
      MIN(DATE(Opp_CreatedDate)) AS min_opp_created,
      MAX(DATE(Opp_CreatedDate)) AS max_opp_created,
      MIN(DATE(CreatedDate)) AS min_created,
      MAX(DATE(CreatedDate)) AS max_created,
      MIN(advisor_join_date__c) AS min_join_date,
      MAX(advisor_join_date__c) AS max_join_date,
      MIN(DATE(Date_Became_SQO__c)) AS min_sqo_date,
      MAX(DATE(Date_Became_SQO__c)) AS max_sqo_date,
      COUNT(*) AS total_rows,
      COUNTIF(is_primary_opp_record = 1) AS primary_opp_rows,
      COUNTIF(StageName = 'Joined') AS joined_count,
      COUNTIF(StageName = 'Closed Lost') AS closed_lost_count,
      COUNTIF(SQO_raw = 'Yes' AND is_primary_opp_record = 1) AS sqo_primary_count
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\``,
    useLegacySql: false
  });
  rows.forEach(r => console.log(JSON.stringify(r)));
}
run().catch(e => console.error("ERR:", e.message));
