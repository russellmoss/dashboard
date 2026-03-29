// Query 3: Historical SQO -> Joined conversion rates, grouped by SQO quarter
// Using Date_Became_SQO__c as the quarter anchor (no CloseDate in this view)
const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const query = `SELECT
  CONCAT('Q', EXTRACT(QUARTER FROM DATE(Date_Became_SQO__c)), ' ', EXTRACT(YEAR FROM DATE(Date_Became_SQO__c))) AS sqo_quarter,
  COUNT(*) AS total_sqos,
  COUNTIF(StageName = 'Joined') AS joined,
  ROUND(COUNTIF(StageName = 'Joined') / COUNT(*) * 100, 1) AS conversion_pct,
  ROUND(AVG(CASE WHEN StageName = 'Joined' THEN COALESCE(Underwritten_AUM__c, Amount) END) / 1e6, 1) AS avg_joined_aum_m
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND Date_Became_SQO__c >= '2024-01-01'
GROUP BY sqo_quarter
ORDER BY sqo_quarter`;
bq.query(query).then(([rows]) => console.log(JSON.stringify(rows, null, 2))).catch(e => console.error('ERROR:', e.message));
