-- ============================================================
-- FUNNEL DETAIL VIEW: One row per opportunity
-- Export to Google Sheets via BQ Console > Save Results > Google Sheets
--
-- Mirrors the monthly tabs in the GTM Funnel Analysis spreadsheet
-- with added: forward-order flags, pipeline status, days in current stage
-- ============================================================

SELECT
  Full_Opportunity_ID__c AS opp_id,
  advisor_name,
  FORMAT_DATE('%Y-%m', DATE(Opp_CreatedDate)) AS cohort_month,
  DATE(Opp_CreatedDate) AS created_date,
  SQO_raw AS sqo,
  StageName AS current_stage,
  ROUND(Opportunity_AUM / 1e6, 1) AS aum_m,
  Original_source,
  Finance_View__c AS channel,
  SGM_Owner_Name__c AS sgm,
  SGA_Owner_Name__c AS sga,
  Closed_Lost_Reason__c AS closed_reason,

  -- Raw stage dates
  DATE(Date_Became_SQO__c) AS sqo_date,
  DATE(Stage_Entered_Discovery__c) AS discovery_date,
  DATE(Stage_Entered_Sales_Process__c) AS sp_date,
  DATE(Stage_Entered_Negotiating__c) AS neg_date,
  DATE(Stage_Entered_Signed__c) AS signed_date,
  advisor_join_date__c AS joined_date,
  DATE(Stage_Entered_Closed__c) AS closed_date,

  -- Forward-order flags (FALSE = Salesforce data entry issue, exclude from analysis)
  CASE WHEN Stage_Entered_Sales_Process__c IS NULL THEN TRUE
       WHEN Stage_Entered_Sales_Process__c >=
         COALESCE(Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
       ELSE FALSE END AS sp_forward,
  CASE WHEN Stage_Entered_Negotiating__c IS NULL THEN TRUE
       WHEN Stage_Entered_Negotiating__c >=
         COALESCE(Stage_Entered_Sales_Process__c,
           Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
       ELSE FALSE END AS neg_forward,
  CASE WHEN Stage_Entered_Signed__c IS NULL THEN TRUE
       WHEN Stage_Entered_Signed__c >=
         COALESCE(Stage_Entered_Negotiating__c,
           Stage_Entered_Sales_Process__c,
           Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
       ELSE FALSE END AS signed_forward,
  CASE WHEN COALESCE(Stage_Entered_Joined__c,
         TIMESTAMP(advisor_join_date__c)) IS NULL THEN TRUE
       WHEN COALESCE(Stage_Entered_Joined__c,
         TIMESTAMP(advisor_join_date__c)) >=
         COALESCE(Stage_Entered_Signed__c,
           Stage_Entered_Negotiating__c,
           Stage_Entered_Sales_Process__c,
           Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
       ELSE FALSE END AS joined_forward,

  -- Computed days between stages
  ROUND(TIMESTAMP_DIFF(Date_Became_SQO__c, Opp_CreatedDate, SECOND) / 86400.0, 1) AS days_to_sqo,
  ROUND(TIMESTAMP_DIFF(
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Closed__c),
    COALESCE(Stage_Entered_Discovery__c, Date_Became_SQO__c),
    SECOND) / 86400.0, 1) AS days_to_sp,
  ROUND(TIMESTAMP_DIFF(
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Closed__c),
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c,
      Stage_Entered_Signed__c, Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)),
    SECOND) / 86400.0, 1) AS days_to_neg,
  ROUND(TIMESTAMP_DIFF(
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Closed__c),
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c,
      Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)),
    SECOND) / 86400.0, 1) AS days_to_signed,
  ROUND(TIMESTAMP_DIFF(
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c), Stage_Entered_Closed__c),
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)),
    SECOND) / 86400.0, 1) AS days_to_joined,
  ROUND(TIMESTAMP_DIFF(
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c), Stage_Entered_Closed__c),
    Opp_CreatedDate, SECOND) / 86400.0, 1) AS total_cycle_days,

  -- Pipeline status
  CASE
    WHEN StageName = 'Closed Lost' THEN 'Closed Lost'
    WHEN advisor_join_date__c IS NOT NULL OR StageName = 'Joined' THEN 'Joined'
    WHEN StageName = 'On Hold' THEN 'On Hold'
    ELSE 'Open'
  END AS pipeline_status,

  -- Days in current stage (open/on-hold opps only)
  CASE WHEN StageName NOT IN ('Closed Lost', 'Joined')
    THEN ROUND(TIMESTAMP_DIFF(CURRENT_TIMESTAMP(),
      COALESCE(
        CASE StageName
          WHEN 'Signed' THEN Stage_Entered_Signed__c
          WHEN 'Negotiating' THEN Stage_Entered_Negotiating__c
          WHEN 'Sales Process' THEN Stage_Entered_Sales_Process__c
          WHEN 'Discovery' THEN COALESCE(Stage_Entered_Discovery__c, Date_Became_SQO__c)
          WHEN 'Qualifying' THEN Opp_CreatedDate
          WHEN 'On Hold' THEN Stage_Entered_On_Hold__c
        END, Opp_CreatedDate), SECOND) / 86400.0, 0)
  END AS days_in_current_stage,

  CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/',
    Full_Opportunity_ID__c, '/view') AS sf_link

FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Full_Opportunity_ID__c IS NOT NULL
  AND is_primary_opp_record = 1
  AND Opp_CreatedDate IS NOT NULL
  AND DATE(Opp_CreatedDate) >= '2025-06-01'
ORDER BY Opp_CreatedDate, Full_Opportunity_ID__c
