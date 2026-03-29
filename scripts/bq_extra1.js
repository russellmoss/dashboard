// Check anticipated start dates that are in the past (for deals currently Neg/Signed)
const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({ projectId: 'savvy-gtm-analytics' });
const query = `SELECT
  COUNT(*) AS total_neg_signed,
  COUNTIF(Earliest_Anticipated_Start_Date__c IS NULL) AS null_date,
  COUNTIF(DATE(Earliest_Anticipated_Start_Date__c) < CURRENT_DATE()) AS past_date,
  COUNTIF(DATE(Earliest_Anticipated_Start_Date__c) >= CURRENT_DATE()) AS future_date,
  MIN(Earliest_Anticipated_Start_Date__c) AS earliest_date,
  MAX(Earliest_Anticipated_Start_Date__c) AS latest_date
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Negotiating', 'Signed')`;
bq.query(query).then(([rows]) => console.log(JSON.stringify(rows, null, 2))).catch(e => console.error('ERROR:', e.message));
