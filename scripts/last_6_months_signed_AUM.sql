SELECT
  COUNT(*) AS opp_count,
  ROUND(AVG(COALESCE(v.Underwritten_AUM__c, v.Amount)), 2) AS avg_aum,
  ROUND((
    APPROX_QUANTILES(COALESCE(v.Underwritten_AUM__c, v.Amount), 100)[OFFSET(49)] +
    APPROX_QUANTILES(COALESCE(v.Underwritten_AUM__c, v.Amount), 100)[OFFSET(50)]
  ) / 2, 2) AS median_aum,
  ROUND(MIN(COALESCE(v.Underwritten_AUM__c, v.Amount)), 2) AS min_aum,
  ROUND(MAX(COALESCE(v.Underwritten_AUM__c, v.Amount)), 2) AS max_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Stage_Entered_Signed__c IS NOT NULL
  AND TIMESTAMP(v.Stage_Entered_Signed__c) >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 6 MONTH))
  AND TIMESTAMP(v.Stage_Entered_Signed__c) <= TIMESTAMP(CURRENT_DATE())
  AND v.is_sqo_unique = 1
  AND COALESCE(v.Underwritten_AUM__c, v.Amount) IS NOT NULL
  AND COALESCE(v.Underwritten_AUM__c, v.Amount) > 0
