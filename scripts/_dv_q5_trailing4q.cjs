const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({
  keyFilename: 'C:/Users/russe/Documents/Dashboard/.json/savvy-gtm-analytics-2233e5984994.json',
  projectId: 'savvy-gtm-analytics'
});
async function run() {
  // Trailing 4 complete quarters: Q1-Q4 2025
  // The Q3 query showed component_a_count == total_joined for most quarters.
  // This means the "surprise" component is near zero, which contradicts the backtest.
  // Let's investigate: are ALL joined deals showing up with matching anticipated dates?
  const [rows] = await bq.query({ query: `
SELECT
  join_quarter,
  total_joined,
  total_aum_m,
  component_a_count,
  component_a_aum_m,
  ROUND(total_aum_m - component_a_aum_m, 1) AS surprise_aum_m,
  ROUND((total_aum_m - component_a_aum_m) / NULLIF(total_aum_m, 0), 3) AS surprise_pct
FROM (
  SELECT
    CONCAT('Q', EXTRACT(QUARTER FROM DATE(advisor_join_date__c)), ' ', EXTRACT(YEAR FROM DATE(advisor_join_date__c))) AS join_quarter,
    COUNT(*) AS total_joined,
    ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS total_aum_m,
    COUNTIF(Earliest_Anticipated_Start_Date__c IS NOT NULL 
      AND CONCAT('Q', EXTRACT(QUARTER FROM DATE(Earliest_Anticipated_Start_Date__c)), ' ', EXTRACT(YEAR FROM DATE(Earliest_Anticipated_Start_Date__c))) = CONCAT('Q', EXTRACT(QUARTER FROM DATE(advisor_join_date__c)), ' ', EXTRACT(YEAR FROM DATE(advisor_join_date__c)))) AS component_a_count,
    ROUND(SUM(CASE WHEN Earliest_Anticipated_Start_Date__c IS NOT NULL 
      AND CONCAT('Q', EXTRACT(QUARTER FROM DATE(Earliest_Anticipated_Start_Date__c)), ' ', EXTRACT(YEAR FROM DATE(Earliest_Anticipated_Start_Date__c))) = CONCAT('Q', EXTRACT(QUARTER FROM DATE(advisor_join_date__c)), ' ', EXTRACT(YEAR FROM DATE(advisor_join_date__c)))
      THEN COALESCE(Underwritten_AUM__c, Amount) ELSE 0 END) / 1e6, 1) AS component_a_aum_m
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
  WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
    AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
    AND COALESCE(Underwritten_AUM__c, Amount) > 0
    AND DATE(advisor_join_date__c) BETWEEN '2025-01-01' AND '2025-12-31'
  GROUP BY join_quarter
)
ORDER BY join_quarter` });
  console.log("Component A vs B breakdown for 2025 quarters:");
  console.log(JSON.stringify(rows, null, 2));

  // Also check: how many joined deals have NULL anticipated dates?
  const [rows2] = await bq.query({ query: `
SELECT
  CONCAT('Q', EXTRACT(QUARTER FROM DATE(advisor_join_date__c)), ' ', EXTRACT(YEAR FROM DATE(advisor_join_date__c))) AS join_quarter,
  COUNT(*) AS total_joined,
  COUNTIF(Earliest_Anticipated_Start_Date__c IS NULL) AS null_date_count,
  ROUND(COUNTIF(Earliest_Anticipated_Start_Date__c IS NULL) / COUNT(*), 3) AS null_date_pct
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
  AND DATE(advisor_join_date__c) BETWEEN '2025-01-01' AND '2025-12-31'
GROUP BY join_quarter ORDER BY join_quarter` });
  console.log("\nNull anticipated date check for joined deals in 2025:");
  console.log(JSON.stringify(rows2, null, 2));
}
run().catch(e => { console.error(e.message); process.exit(1); });
