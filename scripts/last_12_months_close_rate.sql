-- 3a) SQO → Joined conversion rate, cohorted by month (last 12 months, resolved-only)
SELECT
  FORMAT_DATE('%Y-%m', DATE(v.Date_Became_SQO__c)) AS cohort_month,
  SUM(v.eligible_for_sqo_conversions) AS eligible_sqos,
  SUM(v.sqo_to_joined_progression) AS joined,
  ROUND(SAFE_DIVIDE(SUM(v.sqo_to_joined_progression), SUM(v.eligible_for_sqo_conversions)) * 100, 2) AS conversion_rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Date_Became_SQO__c IS NOT NULL
  AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH))
  AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CURRENT_DATE())
  AND v.recordtypeid = '012Dn000000mrO3IAI'
  AND v.is_sqo_unique = 1
GROUP BY cohort_month
ORDER BY cohort_month;

-- 3b) Overall blended SQO → Joined conversion rate (last 12 months, resolved-only)
SELECT
  SUM(v.eligible_for_sqo_conversions) AS total_eligible_sqos,
  SUM(v.sqo_to_joined_progression) AS total_joined,
  ROUND(SAFE_DIVIDE(SUM(v.sqo_to_joined_progression), SUM(v.eligible_for_sqo_conversions)) * 100, 2) AS blended_conversion_rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Date_Became_SQO__c IS NOT NULL
  AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 12 MONTH))
  AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CURRENT_DATE())
  AND v.recordtypeid = '012Dn000000mrO3IAI'
  AND v.is_sqo_unique = 1;
