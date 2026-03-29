const { BigQuery } = require('@google-cloud/bigquery');
const bq = new BigQuery({
  keyFilename: 'C:/Users/russe/Documents/Dashboard/.json/savvy-gtm-analytics-2233e5984994.json',
  projectId: 'savvy-gtm-analytics'
});
async function run() {
  const [rows] = await bq.query({ query: `SELECT '180d' AS window, COUNT(*) AS n, ROUND(AVG(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS mean_aum_m
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
  AND COALESCE(Underwritten_AUM__c, Amount) > 0
  AND DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 180 DAY)
UNION ALL
SELECT '1yr' AS window, COUNT(*) AS n, ROUND(AVG(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS mean_aum_m
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
  AND COALESCE(Underwritten_AUM__c, Amount) > 0
  AND DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 365 DAY)
UNION ALL
SELECT '2yr' AS window, COUNT(*) AS n, ROUND(AVG(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS mean_aum_m
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
  AND COALESCE(Underwritten_AUM__c, Amount) > 0
  AND DATE(Opp_CreatedDate) >= DATE_SUB(CURRENT_DATE(), INTERVAL 730 DAY)
UNION ALL
SELECT 'all-time' AS window, COUNT(*) AS n, ROUND(AVG(COALESCE(Underwritten_AUM__c, Amount)) / 1e6, 1) AS mean_aum_m
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE SQO_raw = 'Yes' AND is_primary_opp_record = 1 AND recordtypeid = '012Dn000000mrO3IAI'
  AND StageName = 'Joined' AND advisor_join_date__c IS NOT NULL
  AND COALESCE(Underwritten_AUM__c, Amount) > 0` });
  console.log(JSON.stringify(rows, null, 2));
}
run().catch(e => { console.error(e.message); process.exit(1); });
