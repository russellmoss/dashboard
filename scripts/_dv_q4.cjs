const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({
  keyFilename: 'C:/Users/russe/Documents/Dashboard/.json/savvy-gtm-analytics-2233e5984994.json',
  projectId: 'savvy-gtm-analytics'
});
async function run() {
  // Q4 2025 = Oct 1 - Dec 31 2025
  // Deals that were Neg or Signed with anticipated dates in Q4 2025 at the start of Q4 2025
  // vs what actually joined in Q4 2025
  const [rows] = await bq.query({ query: `
-- Step 1: Deals with anticipated start date in Q4 2025 that were Neg/Signed at some point
-- (We can only look at current stage, not historical stage, so we approximate with deals
-- that have an anticipated date in Q4 2025 and StageName is Joined, Neg, Signed, or Closed Lost)
WITH q4_anticipated AS (
  SELECT
    Id,
    StageName,
    COALESCE(Underwritten_AUM__c, Amount) AS aum,
    Earliest_Anticipated_Start_Date__c,
    advisor_join_date__c,
    CASE WHEN StageName = 'Joined' AND DATE(advisor_join_date__c) BETWEEN '2025-10-01' AND '2025-12-31' THEN 1 ELSE 0 END AS joined_in_q4
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
  WHERE SQO_raw = 'Yes' AND is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'
    AND Earliest_Anticipated_Start_Date__c IS NOT NULL
    AND DATE(Earliest_Anticipated_Start_Date__c) BETWEEN '2025-10-01' AND '2025-12-31'
    AND StageName IN ('Negotiating', 'Signed', 'Joined', 'Closed Lost')
    AND COALESCE(Underwritten_AUM__c, Amount) > 0
)
SELECT
  StageName,
  COUNT(*) AS cnt,
  ROUND(SUM(aum)/1e6, 1) AS aum_m,
  SUM(joined_in_q4) AS joined_in_q4_cnt
FROM q4_anticipated
GROUP BY StageName
ORDER BY StageName` });
  console.log("Q4 2025 deals with anticipated date in Q4 2025, by current stage:");
  console.log(JSON.stringify(rows, null, 2));

  // Summary: realization rate
  const [rows2] = await bq.query({ query: `
WITH q4_anticipated AS (
  SELECT
    Id,
    StageName,
    COALESCE(Underwritten_AUM__c, Amount) AS aum,
    Earliest_Anticipated_Start_Date__c,
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
  ROUND(COUNTIF(StageName = 'Joined' AND DATE(advisor_join_date__c) BETWEEN '2025-10-01' AND '2025-12-31') / COUNT(*), 3) AS realization_rate,
  ROUND(SUM(aum)/1e6, 1) AS total_aum_m,
  ROUND(SUM(CASE WHEN StageName = 'Joined' AND DATE(advisor_join_date__c) BETWEEN '2025-10-01' AND '2025-12-31' THEN aum ELSE 0 END)/1e6, 1) AS joined_aum_m
FROM q4_anticipated` });
  console.log("\nQ4 2025 realization summary:");
  console.log(JSON.stringify(rows2, null, 2));
}
run().catch(e => { console.error(e.message); process.exit(1); });
