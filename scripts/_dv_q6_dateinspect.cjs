const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({
  keyFilename: 'C:/Users/russe/Documents/Dashboard/.json/savvy-gtm-analytics-2233e5984994.json',
  projectId: 'savvy-gtm-analytics'
});
async function run() {
  // Understand relationship between Earliest_Anticipated_Start_Date__c and advisor_join_date__c
  // for joined deals — are they the same? Is the anticipated date being updated to match the join date?
  const [rows] = await bq.query({ query: `
SELECT
  DATE_DIFF(DATE(advisor_join_date__c), DATE(Earliest_Anticipated_Start_Date__c), DAY) AS days_diff,
  COUNT(*) AS cnt
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
  AND Earliest_Anticipated_Start_Date__c IS NOT NULL
  AND DATE(advisor_join_date__c) >= '2024-01-01'
GROUP BY days_diff
ORDER BY cnt DESC
LIMIT 20` });
  console.log("Distribution of (advisor_join_date - anticipated_start_date) for joined deals (2024+):");
  console.log(JSON.stringify(rows, null, 2));

  // Also check if anticipated date IS the join date (exact match)
  const [rows2] = await bq.query({ query: `
SELECT
  COUNTIF(DATE(Earliest_Anticipated_Start_Date__c) = DATE(advisor_join_date__c)) AS exact_match,
  COUNTIF(DATE(Earliest_Anticipated_Start_Date__c) != DATE(advisor_join_date__c)) AS different,
  COUNT(*) AS total,
  ROUND(COUNTIF(DATE(Earliest_Anticipated_Start_Date__c) = DATE(advisor_join_date__c)) / COUNT(*), 3) AS exact_match_pct
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
  AND Earliest_Anticipated_Start_Date__c IS NOT NULL` });
  console.log("\nExact match: anticipated == join date:");
  console.log(JSON.stringify(rows2, null, 2));

  // Check: for Neg/Signed deals, do anticipated dates cluster differently?
  const [rows3] = await bq.query({ query: `
SELECT
  StageName,
  COUNT(*) AS cnt,
  COUNTIF(Earliest_Anticipated_Start_Date__c IS NOT NULL) AS has_date,
  ROUND(COUNTIF(Earliest_Anticipated_Start_Date__c IS NOT NULL) / COUNT(*), 3) AS date_pop_rate
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes' AND is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Negotiating', 'Signed', 'Joined', 'Closed Lost')
GROUP BY StageName
ORDER BY StageName` });
  console.log("\nAnticipated date population rate by stage:");
  console.log(JSON.stringify(rows3, null, 2));
}
run().catch(e => { console.error(e.message); process.exit(1); });
