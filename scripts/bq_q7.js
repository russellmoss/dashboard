const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const query = `SELECT
  CONCAT('Q', EXTRACT(QUARTER FROM Joined_Date__c), ' ', EXTRACT(YEAR FROM Joined_Date__c)) AS quarter,
  COUNT(*) AS joined_count,
  ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS total_aum_m
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined'
  AND Joined_Date__c >= '2025-01-01'
GROUP BY quarter
ORDER BY quarter`;
bq.query(query).then(([rows]) => console.log(JSON.stringify(rows, null, 2))).catch(e => console.error('ERROR:', e.message));
