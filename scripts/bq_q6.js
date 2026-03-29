const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const query = `SELECT table_id, row_count, size_bytes
FROM \`savvy-gtm-analytics.savvy_analytics.__TABLES__\`
WHERE table_id LIKE '%forecast%'`;
bq.query(query).then(([rows]) => console.log(JSON.stringify(rows, null, 2))).catch(e => console.error('ERROR:', e.message));
