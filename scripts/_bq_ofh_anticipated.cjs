const {BigQuery} = require('@google-cloud/bigquery');
const bq = new BigQuery({projectId: 'savvy-gtm-analytics'});
bq.query({
  query: `SELECT Field, OldValue, NewValue, CreatedDate, OpportunityId
FROM \`savvy-gtm-analytics.SavvyGTMData.OpportunityFieldHistory\`
WHERE Field LIKE '%Anticipated%' OR Field LIKE '%anticipated%'
LIMIT 10`
}).then(([rows]) => {
  console.log(JSON.stringify(rows, null, 2));
}).catch(e => console.error('ERROR:', e.message));
