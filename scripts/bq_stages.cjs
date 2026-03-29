"use strict";
require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const bq = new BigQuery({ projectId: "savvy-gtm-analytics", keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
async function run() {
  const [rows] = await bq.query({
    query: `SELECT StageName, StageName_code, COUNT(*) AS cnt,
      COUNTIF(SQO_raw = 'Yes') AS sqo_cnt,
      ROUND(COUNTIF(SQO_raw = 'Yes') / COUNT(*), 3) AS sqo_rate
    FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
    WHERE is_primary_opp_record = 1
    GROUP BY StageName, StageName_code
    ORDER BY StageName_code`,
    useLegacySql: false
  });
  rows.forEach(r => console.log(JSON.stringify(r)));
}
run().catch(e => console.error("ERR:", e.message));
