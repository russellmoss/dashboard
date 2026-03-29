const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const query = `SELECT
  StageName,
  COUNT(*) AS count,
  ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS aum_m,
  ROUND(AVG(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 2) AS avg_aum_m
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName NOT IN ('Closed Lost', 'Joined')
GROUP BY StageName
ORDER BY count DESC`;
bq.query(query).then(([rows]) => console.log(JSON.stringify(rows, null, 2))).catch(e => console.error('ERROR:', e.message));
