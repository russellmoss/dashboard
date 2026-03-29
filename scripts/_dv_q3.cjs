const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({
  keyFilename: 'C:/Users/russe/Documents/Dashboard/.json/savvy-gtm-analytics-2233e5984994.json',
  projectId: 'savvy-gtm-analytics'
});
async function run() {
  const [rows] = await bq.query({ query: `WITH joined_deals AS (
  SELECT
    CONCAT('Q', EXTRACT(QUARTER FROM DATE(advisor_join_date__c)), ' ', EXTRACT(YEAR FROM DATE(advisor_join_date__c))) AS join_quarter,
    COALESCE(Underwritten_AUM__c, Amount) AS aum,
    StageName,
    Earliest_Anticipated_Start_Date__c
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
  WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
    AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
    AND COALESCE(Underwritten_AUM__c, Amount) > 0
    AND DATE(advisor_join_date__c) >= '2025-01-01'
)
SELECT
  join_quarter,
  COUNT(*) AS total_joined,
  ROUND(SUM(aum) / 1e6, 1) AS total_aum_m,
  COUNTIF(Earliest_Anticipated_Start_Date__c IS NOT NULL 
    AND CONCAT('Q', EXTRACT(QUARTER FROM DATE(Earliest_Anticipated_Start_Date__c)), ' ', EXTRACT(YEAR FROM DATE(Earliest_Anticipated_Start_Date__c))) = join_quarter) AS component_a_count,
  ROUND(SUM(CASE WHEN Earliest_Anticipated_Start_Date__c IS NOT NULL 
    AND CONCAT('Q', EXTRACT(QUARTER FROM DATE(Earliest_Anticipated_Start_Date__c)), ' ', EXTRACT(YEAR FROM DATE(Earliest_Anticipated_Start_Date__c))) = join_quarter 
    THEN aum ELSE 0 END) / 1e6, 1) AS component_a_aum_m
FROM joined_deals
GROUP BY join_quarter
ORDER BY join_quarter` });
  console.log(JSON.stringify(rows, null, 2));
}
run().catch(e => { console.error(e.message); process.exit(1); });
