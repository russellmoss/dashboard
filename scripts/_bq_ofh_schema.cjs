const {BigQuery} = require('@google-cloud/bigquery');
const bq = new BigQuery({projectId: 'savvy-gtm-analytics'});
bq.query({
  query: `SELECT column_name, data_type
FROM \`savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.COLUMNS\`
WHERE table_name = 'OpportunityFieldHistory'
ORDER BY ordinal_position`
}).then(([rows]) => {
  console.log(JSON.stringify(rows, null, 2));
}).catch(e => console.error('ERROR:', e.message));
