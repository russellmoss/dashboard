// Check forecast views in savvy_analytics - what do they contain?
const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });

// Check view definitions for existing forecast views
const query = `SELECT view_definition
FROM \`savvy-gtm-analytics.savvy_analytics.INFORMATION_SCHEMA.VIEWS\`
WHERE table_name = 'vw_forecast_vs_actuals_enhanced'`;
bq.query(query).then(([rows]) => {
  if (rows.length > 0) {
    console.log('VIEW DEFINITION (first 2000 chars):');
    console.log(rows[0].view_definition.substring(0, 2000));
  } else {
    console.log('No view found');
  }
}).catch(e => console.error('ERROR:', e.message));
