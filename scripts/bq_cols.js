const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const query = `SELECT column_name, data_type
FROM \`savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS\`
WHERE table_name = 'vw_funnel_master'
ORDER BY ordinal_position`;
bq.query(query).then(([rows]) => console.log(JSON.stringify(rows, null, 2))).catch(e => console.error('ERROR:', e.message));
