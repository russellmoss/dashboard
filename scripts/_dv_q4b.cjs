const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({
  keyFilename: 'C:/Users/russe/Documents/Dashboard/.json/savvy-gtm-analytics-2233e5984994.json',
  projectId: 'savvy-gtm-analytics'
});
async function run() {
  // Check what ID column name exists
  const [rows0] = await bq.query({ query: `SELECT column_name FROM \`savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'vw_funnel_master' AND LOWER(column_name) IN ('id','opportunityid','opp_id','sfid') ORDER BY column_name LIMIT 5` });
  console.log("ID columns:", JSON.stringify(rows0));

  const [rows] = await bq.query({ query: `
WITH q4_anticipated AS (
  SELECT
    StageName,
    COALESCE(Underwritten_AUM__c, Amount) AS aum,
    advisor_join_date__c
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
  WHERE SQO_raw = 'Yes' AND is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'
    AND Earliest_Anticipated_Start_Date__c IS NOT NULL
    AND DATE(Earliest_Anticipated_Start_Date__c) BETWEEN '2025-10-01' AND '2025-12-31'
    AND StageName IN ('Negotiating', 'Signed', 'Joined', 'Closed Lost')
    AND COALESCE(Underwritten_AUM__c, Amount) > 0
)
SELECT
  COUNT(*) AS total_deals_anticipated_q4,
  COUNTIF(StageName = 'Joined' AND DATE(advisor_join_date__c) BETWEEN '2025-10-01' AND '2025-12-31') AS joined_in_q4,
  ROUND(SAFE_DIVIDE(
    COUNTIF(StageName = 'Joined' AND DATE(advisor_join_date__c) BETWEEN '2025-10-01' AND '2025-12-31'),
    COUNT(*)
  ), 3) AS realization_rate,
  ROUND(SUM(aum)/1e6, 1) AS total_aum_m,
  ROUND(SUM(CASE WHEN StageName = 'Joined' AND DATE(advisor_join_date__c) BETWEEN '2025-10-01' AND '2025-12-31' THEN aum ELSE 0 END)/1e6, 1) AS joined_aum_m
FROM q4_anticipated` });
  console.log("Q4 2025 realization summary:");
  console.log(JSON.stringify(rows, null, 2));

  const [rows2] = await bq.query({ query: `
SELECT
  StageName,
  COUNT(*) AS cnt,
  ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount))/1e6, 1) AS aum_m
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes' AND is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND Earliest_Anticipated_Start_Date__c IS NOT NULL
  AND DATE(Earliest_Anticipated_Start_Date__c) BETWEEN '2025-10-01' AND '2025-12-31'
  AND StageName IN ('Negotiating', 'Signed', 'Joined', 'Closed Lost')
  AND COALESCE(Underwritten_AUM__c, Amount) > 0
GROUP BY StageName
ORDER BY StageName` });
  console.log("Q4 2025 by current stage:");
  console.log(JSON.stringify(rows2, null, 2));
}
run().catch(e => { console.error(e.message); process.exit(1); });
