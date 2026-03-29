// AUM value distribution for Neg+Signed deals - check for outliers
const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const query = `SELECT
  ROUND(COALESCE(Underwritten_AUM__c, Amount) / 1e6, 1) AS aum_m,
  StageName,
  Earliest_Anticipated_Start_Date__c
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Negotiating', 'Signed')
ORDER BY aum_m DESC
LIMIT 10`;
bq.query(query).then(([rows]) => console.log(JSON.stringify(rows, null, 2))).catch(e => console.error('ERROR:', e.message));
