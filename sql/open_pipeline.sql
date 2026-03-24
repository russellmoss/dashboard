-- ============================================================
-- OPEN PIPELINE: All active SQOs for Monte Carlo forecasting
-- Export to Google Sheets via BQ Console > Save Results > Google Sheets
-- ============================================================

SELECT
  Full_Opportunity_ID__c AS opp_id,
  advisor_name,
  StageName AS current_stage,
  ROUND(Opportunity_AUM / 1e6, 1) AS aum_m,
  FORMAT_DATE('%Y-%m', DATE(Opp_CreatedDate)) AS created_cohort,
  DATE(Opp_CreatedDate) AS created_date,
  SGM_Owner_Name__c AS sgm,
  SGA_Owner_Name__c AS sga,
  Original_source,
  Finance_View__c AS channel,
  -- Current stage entry date
  DATE(CASE StageName
    WHEN 'Qualifying' THEN Opp_CreatedDate
    WHEN 'Discovery' THEN COALESCE(Stage_Entered_Discovery__c, Date_Became_SQO__c)
    WHEN 'Sales Process' THEN Stage_Entered_Sales_Process__c
    WHEN 'Negotiating' THEN Stage_Entered_Negotiating__c
    WHEN 'Signed' THEN Stage_Entered_Signed__c
    WHEN 'On Hold' THEN Stage_Entered_On_Hold__c
  END) AS stage_entry_date,
  -- Days in current stage
  ROUND(TIMESTAMP_DIFF(CURRENT_TIMESTAMP(),
    COALESCE(
      CASE StageName
        WHEN 'Qualifying' THEN Opp_CreatedDate
        WHEN 'Discovery' THEN COALESCE(Stage_Entered_Discovery__c, Date_Became_SQO__c)
        WHEN 'Sales Process' THEN Stage_Entered_Sales_Process__c
        WHEN 'Negotiating' THEN Stage_Entered_Negotiating__c
        WHEN 'Signed' THEN Stage_Entered_Signed__c
        WHEN 'On Hold' THEN Stage_Entered_On_Hold__c
      END, Opp_CreatedDate), SECOND) / 86400.0, 0) AS days_in_stage,
  -- Remaining stages to Joined
  CASE StageName
    WHEN 'Qualifying' THEN 5
    WHEN 'Discovery' THEN 4
    WHEN 'Sales Process' THEN 3
    WHEN 'Negotiating' THEN 2
    WHEN 'Signed' THEN 1
    WHEN 'On Hold' THEN NULL
  END AS stages_remaining,
  CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/',
    Full_Opportunity_ID__c, '/view') AS sf_link
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Full_Opportunity_ID__c IS NOT NULL
  AND is_primary_opp_record = 1
  AND LOWER(SQO_raw) = 'yes'
  AND StageName NOT IN ('Closed Lost', 'Joined')
ORDER BY
  CASE StageName
    WHEN 'Signed' THEN 1 WHEN 'Negotiating' THEN 2 WHEN 'Sales Process' THEN 3
    WHEN 'Discovery' THEN 4 WHEN 'Qualifying' THEN 5 WHEN 'On Hold' THEN 6
  END,
  Opp_CreatedDate
