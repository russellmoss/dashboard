-- ============================================================
-- FUNNEL SUMMARY: Conversion rates + avg days by cohort month
-- Export to Google Sheets via BQ Console > Save Results > Google Sheets
-- ============================================================

WITH base AS (
  SELECT
    FORMAT_DATE('%Y-%m', DATE(Opp_CreatedDate)) AS cohort_month,
    Full_Opportunity_ID__c, Opp_CreatedDate, Date_Became_SQO__c, SQO_raw, StageName,
    advisor_join_date__c, Opportunity_AUM,
    Stage_Entered_Discovery__c, Stage_Entered_Sales_Process__c,
    Stage_Entered_Negotiating__c, Stage_Entered_Signed__c,
    Stage_Entered_Joined__c, Stage_Entered_Closed__c,
    COALESCE(Stage_Entered_Discovery__c, Date_Became_SQO__c) AS bf_discovery,
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c,
      Stage_Entered_Signed__c, Stage_Entered_Joined__c,
      TIMESTAMP(advisor_join_date__c)) AS bf_sp,
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c,
      Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS bf_neg,
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c,
      TIMESTAMP(advisor_join_date__c)) AS bf_signed,
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS bf_joined,
    -- Forward-order flags
    CASE WHEN Stage_Entered_Sales_Process__c IS NULL THEN TRUE
         WHEN Stage_Entered_Sales_Process__c >= COALESCE(Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
         ELSE FALSE END AS sp_fwd,
    CASE WHEN Stage_Entered_Negotiating__c IS NULL THEN TRUE
         WHEN Stage_Entered_Negotiating__c >= COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
         ELSE FALSE END AS neg_fwd,
    CASE WHEN Stage_Entered_Signed__c IS NULL THEN TRUE
         WHEN Stage_Entered_Signed__c >= COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Sales_Process__c, Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
         ELSE FALSE END AS sign_fwd,
    CASE WHEN COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) IS NULL THEN TRUE
         WHEN COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) >= COALESCE(Stage_Entered_Signed__c, Stage_Entered_Negotiating__c, Stage_Entered_Sales_Process__c, Stage_Entered_Discovery__c, Date_Became_SQO__c) THEN TRUE
         ELSE FALSE END AS join_fwd
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Full_Opportunity_ID__c IS NOT NULL AND is_primary_opp_record = 1
    AND Opp_CreatedDate IS NOT NULL
    AND DATE(Opp_CreatedDate) >= '2025-06-01' AND DATE(Opp_CreatedDate) < '2026-04-01'
)
SELECT
  cohort_month,
  -- Counts
  COUNT(*) AS created,
  COUNTIF(LOWER(SQO_raw) = 'yes') AS sqo,
  COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_sp IS NOT NULL AND sp_fwd) AS sales_process,
  COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_neg IS NOT NULL AND sp_fwd AND neg_fwd) AS negotiating,
  COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_signed IS NOT NULL AND sp_fwd AND neg_fwd AND sign_fwd) AS signed,
  COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_joined IS NOT NULL AND COALESCE(StageName,'') != 'Closed Lost'
    AND sp_fwd AND neg_fwd AND sign_fwd AND join_fwd) AS joined,
  -- Stage-to-stage conversion rates
  ROUND(SAFE_DIVIDE(COUNTIF(LOWER(SQO_raw) = 'yes'), COUNT(*)), 3) AS sqo_rate,
  ROUND(SAFE_DIVIDE(
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_sp IS NOT NULL AND sp_fwd),
    COUNTIF(LOWER(SQO_raw) = 'yes')), 3) AS sp_rate,
  ROUND(SAFE_DIVIDE(
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_neg IS NOT NULL AND sp_fwd AND neg_fwd),
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_sp IS NOT NULL AND sp_fwd)), 3) AS neg_rate,
  ROUND(SAFE_DIVIDE(
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_signed IS NOT NULL AND sp_fwd AND neg_fwd AND sign_fwd),
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_neg IS NOT NULL AND sp_fwd AND neg_fwd)), 3) AS signed_rate,
  ROUND(SAFE_DIVIDE(
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_joined IS NOT NULL AND COALESCE(StageName,'') != 'Closed Lost' AND sp_fwd AND neg_fwd AND sign_fwd AND join_fwd),
    COUNTIF(LOWER(SQO_raw) = 'yes' AND bf_signed IS NOT NULL AND sp_fwd AND neg_fwd AND sign_fwd)), 3) AS joined_rate,
  -- AUM totals
  ROUND(SUM(CASE WHEN LOWER(SQO_raw) = 'yes' THEN COALESCE(Opportunity_AUM,0) END) / 1e6, 1) AS total_sqo_aum_m,
  ROUND(SUM(CASE WHEN LOWER(SQO_raw) = 'yes' AND bf_joined IS NOT NULL AND COALESCE(StageName,'') != 'Closed Lost'
    THEN COALESCE(Opportunity_AUM,0) END) / 1e6, 1) AS total_joined_aum_m,
  -- Avg days between stages
  ROUND(AVG(CASE WHEN LOWER(SQO_raw) = 'yes' AND Date_Became_SQO__c IS NOT NULL
    THEN TIMESTAMP_DIFF(Date_Became_SQO__c, Opp_CreatedDate, SECOND) / 86400.0 END), 1) AS avg_days_to_sqo,
  ROUND(AVG(CASE WHEN LOWER(SQO_raw) = 'yes' AND bf_sp IS NOT NULL AND bf_discovery IS NOT NULL AND sp_fwd
    THEN TIMESTAMP_DIFF(COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Closed__c, bf_sp), bf_discovery, SECOND) / 86400.0 END), 1) AS avg_days_to_sp,
  ROUND(AVG(CASE WHEN LOWER(SQO_raw) = 'yes' AND bf_neg IS NOT NULL AND bf_sp IS NOT NULL AND sp_fwd AND neg_fwd
    THEN TIMESTAMP_DIFF(COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Closed__c, bf_neg), bf_sp, SECOND) / 86400.0 END), 1) AS avg_days_to_neg,
  ROUND(AVG(CASE WHEN LOWER(SQO_raw) = 'yes' AND bf_signed IS NOT NULL AND bf_neg IS NOT NULL AND sp_fwd AND neg_fwd AND sign_fwd
    THEN TIMESTAMP_DIFF(COALESCE(Stage_Entered_Signed__c, Stage_Entered_Closed__c, bf_signed), bf_neg, SECOND) / 86400.0 END), 1) AS avg_days_to_signed,
  ROUND(AVG(CASE WHEN LOWER(SQO_raw) = 'yes' AND bf_joined IS NOT NULL AND bf_signed IS NOT NULL AND COALESCE(StageName,'') != 'Closed Lost'
    AND sp_fwd AND neg_fwd AND sign_fwd AND join_fwd
    THEN TIMESTAMP_DIFF(bf_joined, bf_signed, SECOND) / 86400.0 END), 1) AS avg_days_to_joined,
  -- Data quality
  COUNTIF(NOT sp_fwd OR NOT neg_fwd OR NOT sign_fwd OR NOT join_fwd) AS out_of_order_opps
FROM base
GROUP BY cohort_month
ORDER BY cohort_month
