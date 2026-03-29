const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const query = `SELECT
  COUNT(*) AS total_neg_signed,
  COUNTIF(Earliest_Anticipated_Start_Date__c IS NOT NULL) AS has_anticipated_date,
  ROUND(COUNTIF(Earliest_Anticipated_Start_Date__c IS NOT NULL) / COUNT(*) * 100, 1) AS pct_has_date,
  COUNTIF(Underwritten_AUM__c IS NOT NULL) AS has_underwritten_aum,
  ROUND(COUNTIF(Underwritten_AUM__c IS NOT NULL) / COUNT(*) * 100, 1) AS pct_has_underwritten,
  COUNTIF(Amount IS NOT NULL) AS has_amount,
  ROUND(COUNTIF(Amount IS NOT NULL) / COUNT(*) * 100, 1) AS pct_has_amount
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Negotiating', 'Signed')`;
bq.query(query).then(([rows]) => console.log(JSON.stringify(rows, null, 2))).catch(e => console.error('ERROR:', e.message));
