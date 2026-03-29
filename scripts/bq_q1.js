const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const query = `SELECT
  CONCAT('Q', EXTRACT(QUARTER FROM DATE(Earliest_Anticipated_Start_Date__c)),
         ' ', EXTRACT(YEAR FROM DATE(Earliest_Anticipated_Start_Date__c))) AS target_quarter,
  COUNT(*) AS deal_count,
  ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS aum_m
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Negotiating', 'Signed')
  AND Earliest_Anticipated_Start_Date__c IS NOT NULL
  AND DATE(Earliest_Anticipated_Start_Date__c) >= CURRENT_DATE()
GROUP BY target_quarter
ORDER BY target_quarter`;
bq.query(query).then(([rows]) => console.log(JSON.stringify(rows, null, 2))).catch(e => console.error('ERROR:', e.message));
