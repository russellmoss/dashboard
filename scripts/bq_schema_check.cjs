"use strict";
require("dotenv").config();
const { BigQuery } = require("@google-cloud/bigquery");
const bq = new BigQuery({
  projectId: "savvy-gtm-analytics",
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});
async function run() {
  const [rows] = await bq.query({
    query: `SELECT column_name, data_type, is_nullable
      FROM \`savvy-gtm-analytics\`.Tableau_Views.INFORMATION_SCHEMA.COLUMNS
      WHERE table_name = 'vw_funnel_master'
      ORDER BY ordinal_position`,
    useLegacySql: false
  });
  rows.forEach(r => console.log(JSON.stringify(r)));
}
run().catch(e => console.error("ERR:", e.message));
