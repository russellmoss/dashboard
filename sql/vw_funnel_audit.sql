-- vw_funnel_audit — created 2026-03-23
-- Full stage history audit trail for all opps created Jun 2025+
-- Sources from vw_funnel_master

CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_funnel_audit` AS

WITH base AS (
  SELECT *
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE Full_Opportunity_ID__c IS NOT NULL
    AND is_primary_opp_record = 1
    AND DATE(Opp_CreatedDate) >= '2025-06-01'
),

backfilled AS (
  SELECT
    *,
    -- Backfilled stage timestamps (SQO -> SP -> Neg -> Signed -> Joined, no Discovery)
    -- IMPORTANT: Do NOT include Stage_Entered_Closed__c — Closed Lost is a terminal state,
    -- not a stage progression. Including it backfills fake timestamps for deals that never
    -- actually reached SP/Neg/Signed, inflating apparent conversion rates.
    COALESCE(Stage_Entered_Sales_Process__c, Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_sp_ts,
    COALESCE(Stage_Entered_Negotiating__c, Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_neg_ts,
    COALESCE(Stage_Entered_Signed__c, Stage_Entered_Joined__c) AS eff_signed_ts,
    COALESCE(Stage_Entered_Joined__c, TIMESTAMP(advisor_join_date__c)) AS eff_joined_ts,
    -- Current stage entry timestamp for days_in_current_stage
    CASE StageName
      WHEN 'Sales Process' THEN Stage_Entered_Sales_Process__c
      WHEN 'Negotiating'   THEN Stage_Entered_Negotiating__c
      WHEN 'Signed'        THEN Stage_Entered_Signed__c
      WHEN 'Qualifying'    THEN Date_Became_SQO__c
      WHEN 'Discovery'     THEN Date_Became_SQO__c
      WHEN 'On Hold'       THEN Stage_Entered_On_Hold__c
      ELSE NULL
    END AS current_stage_entry_ts
  FROM base
)

SELECT
  -- Identity & Attribution
  Full_Opportunity_ID__c,
  salesforce_url,
  advisor_name,
  FORMAT_DATE('%Y-%m', DATE(Opp_CreatedDate)) AS cohort_month,
  Opp_CreatedDate,
  SGM_Owner_Name__c,
  SGA_Owner_Name__c,
  Original_source,
  Finance_View__c,
  lead_record_source,

  -- SQO
  SQO_raw,
  Date_Became_SQO__c,
  DATE_DIFF(DATE(Date_Became_SQO__c), DATE(Opp_CreatedDate), DAY) AS days_to_sqo,

  -- Raw stage timestamps
  Stage_Entered_Sales_Process__c,
  Stage_Entered_Negotiating__c,
  Stage_Entered_Signed__c,
  Stage_Entered_On_Hold__c,
  Stage_Entered_Joined__c,
  Stage_Entered_Closed__c,
  advisor_join_date__c,
  Earliest_Anticipated_Start_Date__c,

  -- Backfilled stage timestamps
  eff_sp_ts,
  eff_neg_ts,
  eff_signed_ts,
  eff_joined_ts,

  -- Days in stage (backfilled; NULL for stages not yet exited on open opps)
  DATE_DIFF(DATE(eff_neg_ts), DATE(eff_sp_ts), DAY)         AS days_in_sp,
  DATE_DIFF(DATE(eff_signed_ts), DATE(eff_neg_ts), DAY)     AS days_in_negotiating,
  DATE_DIFF(DATE(eff_joined_ts), DATE(eff_signed_ts), DAY)  AS days_in_signed,
  DATE_DIFF(DATE(eff_joined_ts), DATE(Date_Became_SQO__c), DAY) AS days_total_sqo_to_joined,
  CASE
    WHEN Conversion_Status = 'Open' AND current_stage_entry_ts IS NOT NULL
    THEN DATE_DIFF(CURRENT_DATE(), DATE(current_stage_entry_ts), DAY)
    ELSE NULL
  END AS days_in_current_stage,

  -- AUM & Financial
  Opportunity_AUM,
  Opportunity_AUM_M,
  aum_tier,
  CASE WHEN COALESCE(Opportunity_AUM, 0) = 0 THEN 1 ELSE 0 END AS is_zero_aum,
  Account_Total_ARR__c,
  Actual_ARR__c,
  SGM_Estimated_ARR__c,

  -- Status & Flags
  StageName,
  StageName_code,
  Conversion_Status,
  Closed_Lost_Reason__c,
  Closed_Lost_Details__c,
  CASE WHEN StageName = 'On Hold' THEN 1 ELSE 0 END AS is_on_hold,
  CASE WHEN Earliest_Anticipated_Start_Date__c IS NOT NULL THEN 1 ELSE 0 END AS has_anticipated_date,
  (
    CASE WHEN Stage_Entered_Sales_Process__c IS NULL AND eff_neg_ts IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN Stage_Entered_Negotiating__c IS NULL AND eff_signed_ts IS NOT NULL THEN 1 ELSE 0 END +
    CASE WHEN Stage_Entered_Signed__c IS NULL AND eff_joined_ts IS NOT NULL THEN 1 ELSE 0 END
  ) AS stages_skipped,

  CURRENT_DATE() AS as_of_date

FROM backfilled
ORDER BY DATE(Opp_CreatedDate) DESC, advisor_name ASC
