# Data Verifier Findings: Agentic Reporting Feature
**Generated:** 2026-03-17
**Project:** savvy-gtm-analytics

---

## Summary

All 8 views/tables queried successfully. No missing views. All required columns for `vw_lost_to_competition` and `vw_funnel_master` are present with expected types.

### View Existence Status

| View | Dataset | Status | Column Count |
|---|---|---|---|
| `vw_funnel_master` | Tableau_Views | EXISTS | 87 |
| `vw_sga_sms_timing_analysis_v2` | savvy_analytics | EXISTS | 48 |
| `vw_sga_activity_performance` | Tableau_Views | EXISTS | 57 |
| `sms_intent_classified` | savvy_analytics | EXISTS | 9 |
| `sms_weekly_metrics_daily` | savvy_analytics | EXISTS | 21 |
| `vw_lost_to_competition` | Tableau_Views | EXISTS | 12 |
| `Opportunity` | SavvyGTMData | EXISTS | 100 |
| `Task` | SavvyGTMData | EXISTS | 46 |

---

## Task 2: vw_lost_to_competition -- Required Column Verification

All 6 required columns are present.

| column_name | data_type | status |
|---|---|---|
| `moved_to_firm` | STRING | OK |
| `months_to_move` | FLOAT64 | OK |
| `closed_lost_date` | DATE | OK |
| `closed_lost_reason` | STRING | OK |
| `closed_lost_details` | STRING | OK |
| `opportunity_id` | STRING | OK |

**Type Notes:**
- months_to_move is FLOAT64 (not INT64) -- suitable for fractional months, may need ROUND() in display
- closed_lost_date is DATE (not TIMESTAMP) -- no time component, consistent with expected use
- closed_lost_reason and closed_lost_details are STRING -- map to Salesforce picklist/text fields

---

## Task 3: vw_funnel_master -- Required Column Verification

All 18 required columns are present.

| column_name | data_type | status |
|---|---|---|
| `is_joined` | INT64 | OK |
| `is_joined_unique` | INT64 | OK |
| `is_sqo_unique` | INT64 | OK |
| `is_sqo` | INT64 | OK |
| `is_sql` | INT64 | OK |
| `is_contacted` | INT64 | OK |
| `is_mql` | INT64 | OK |
| `is_primary_opp_record` | INT64 | OK |
| `SGA_Owner_Name__c` | STRING | OK |
| `SGM_Owner_Name__c` | STRING | OK |
| `Opportunity_AUM_M` | FLOAT64 | OK |
| `advisor_join_date__c` | DATE | OK |
| `Date_Became_SQO__c` | TIMESTAMP | OK |
| `StageName` | STRING | OK |
| `Original_source` | STRING | OK |
| `Channel_Grouping_Name` | STRING | OK |
| `contacted_to_mql_progression` | INT64 | OK |
| `eligible_for_sqo_conversions` | INT64 | OK |

**Type Notes:**
- Date_Became_SQO__c is TIMESTAMP (not DATE) -- callers must use DATE() cast or timestamp-aware comparisons
- advisor_join_date__c is DATE -- consistent, no cast needed
- All is_* flag columns are INT64 (0/1), not BOOL -- callers must use = 1 comparisons, not IS TRUE
- Opportunity_AUM_M is FLOAT64 -- already in millions, do not divide by 1M again

---

## Task 4: Full Column Listings by View

### 1. savvy-gtm-analytics.Tableau_Views.vw_funnel_master (87 columns)

| column_name | data_type | status |
|---|---|---|
| `primary_key` | STRING | OK |
| `Full_prospect_id__c` | STRING | OK |
| `Full_Opportunity_ID__c` | STRING | OK |
| `advisor_name` | STRING | OK |
| `opp_row_num` | INT64 | OK |
| `lead_url` | STRING | OK |
| `opportunity_url` | STRING | OK |
| `salesforce_url` | STRING | OK |
| `Original_source` | STRING | OK |
| `Finance_View__c` | STRING | OK |
| `External_Agency__c` | STRING | OK |
| `Opp_SGA_Name__c` | STRING | OK |
| `SGM_Owner_Name__c` | STRING | OK |
| `Next_Steps__c` | STRING | OK |
| `NextStep` | STRING | OK |
| `FilterDate` | TIMESTAMP | OK |
| `CreatedDate` | TIMESTAMP | OK |
| `stage_entered_contacting__c` | TIMESTAMP | OK |
| `mql_stage_entered_ts` | TIMESTAMP | OK |
| `converted_date_raw` | DATE | OK |
| `Initial_Call_Scheduled_Date__c` | DATE | OK |
| `Opp_CreatedDate` | TIMESTAMP | OK |
| `Date_Became_SQO__c` | TIMESTAMP | OK |
| `advisor_join_date__c` | DATE | OK |
| `Qualification_Call_Date__c` | DATE | OK |
| `Stage_Entered_Signed__c` | TIMESTAMP | OK |
| `Stage_Entered_Discovery__c` | TIMESTAMP | OK |
| `Stage_Entered_Sales_Process__c` | TIMESTAMP | OK |
| `Stage_Entered_Negotiating__c` | TIMESTAMP | OK |
| `Stage_Entered_On_Hold__c` | TIMESTAMP | OK |
| `Stage_Entered_Closed__c` | TIMESTAMP | OK |
| `lead_closed_date` | TIMESTAMP | OK |
| `is_contacted` | INT64 | OK |
| `is_mql` | INT64 | OK |
| `is_sql` | INT64 | OK |
| `is_sqo` | INT64 | OK |
| `is_joined` | INT64 | OK |
| `StageName` | STRING | OK |
| `SQO_raw` | STRING | OK |
| `Disposition__c` | STRING | OK |
| `DoNotCall` | BOOL | OK |
| `Closed_Lost_Reason__c` | STRING | OK |
| `Closed_Lost_Details__c` | STRING | OK |
| `Opportunity_AUM` | FLOAT64 | OK |
| `Underwritten_AUM__c` | FLOAT64 | OK |
| `Amount` | FLOAT64 | OK |
| `Experimentation_Tag_Raw__c` | STRING | OK |
| `Campaign_Id__c` | STRING | OK |
| `Lead_Campaign_Id__c` | STRING | OK |
| `Opp_Campaign_Id__c` | STRING | OK |
| `all_campaigns` | ARRAY<STRUCT<id STRING, name STRING>> | OK |
| `recordtypeid` | STRING | OK |
| `Lead_Score_Tier__c` | STRING | OK |
| `Previous_Recruiting_Opportunity_ID__c` | STRING | OK |
| `lead_record_source` | STRING | OK |
| `origin_opportunity_url` | STRING | OK |
| `Channel_Grouping_Name_Raw` | STRING | OK |
| `Channel_Grouping_Name` | STRING | OK |
| `Opp_SGA_User_Name` | STRING | OK |
| `Campaign_Name__c` | STRING | OK |
| `SGA_Owner_Name__c` | STRING | OK |
| `is_primary_opp_record` | INT64 | OK |
| `is_sqo_unique` | INT64 | OK |
| `is_joined_unique` | INT64 | OK |
| `filter_date_cohort_month` | STRING | OK |
| `contacted_cohort_month` | STRING | OK |
| `mql_cohort_month` | STRING | OK |
| `sql_cohort_month` | STRING | OK |
| `sqo_cohort_month` | STRING | OK |
| `joined_cohort_month` | STRING | OK |
| `Opportunity_AUM_M` | FLOAT64 | OK |
| `aum_tier` | STRING | OK |
| `Conversion_Status` | STRING | OK |
| `TOF_Stage` | STRING | OK |
| `StageName_code` | INT64 | OK |
| `record_type_name` | STRING | OK |
| `prospect_source_type` | STRING | OK |
| `Experimentation_Tag_List` | ARRAY<STRING> | OK |
| `eligible_for_contacted_conversions` | INT64 | OK |
| `eligible_for_contacted_conversions_30d` | INT64 | OK |
| `eligible_for_mql_conversions` | INT64 | OK |
| `eligible_for_sql_conversions` | INT64 | OK |
| `eligible_for_sqo_conversions` | INT64 | OK |
| `contacted_to_mql_progression` | INT64 | OK |
| `mql_to_sql_progression` | INT64 | OK |
| `sql_to_sqo_progression` | INT64 | OK |
| `sqo_to_joined_progression` | INT64 | OK |

---

### 2. savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2 (48 columns)

| column_name | data_type | status |
|---|---|---|
| `Full_prospect_id__c` | STRING | OK |
| `SGA_Owner_Name__c` | STRING | OK |
| `Original_source` | STRING | OK |
| `Channel_Grouping_Name` | STRING | OK |
| `prospect_created_date` | DATE | OK |
| `contacted_date` | DATE | OK |
| `mql_date` | DATE | OK |
| `sql_date` | DATE | OK |
| `sqo_date` | DATE | OK |
| `joined_date` | DATE | OK |
| `is_contacted` | INT64 | OK |
| `is_mql` | INT64 | OK |
| `is_sql` | INT64 | OK |
| `is_sqo` | INT64 | OK |
| `is_joined` | INT64 | OK |
| `eligible_for_contacted_conversions` | INT64 | OK |
| `contacted_to_mql_progression` | INT64 | OK |
| `mql_to_sql_progression` | INT64 | OK |
| `sql_to_sqo_progression` | INT64 | OK |
| `sqo_to_joined_progression` | INT64 | OK |
| `Opportunity_AUM` | FLOAT64 | OK |
| `received_any_sms` | INT64 | OK |
| `total_outbound_sms` | INT64 | OK |
| `total_inbound_sms` | INT64 | OK |
| `got_reply` | INT64 | OK |
| `first_sms_task_id` | STRING | OK |
| `first_sms_date` | DATE | OK |
| `first_sms_datetime` | DATETIME | OK |
| `days_to_first_sms` | INT64 | OK |
| `first_sms_same_day` | INT64 | OK |
| `first_sms_hour` | INT64 | OK |
| `first_sms_time_bucket` | STRING | OK |
| `first_sms_dow_num` | INT64 | OK |
| `first_sms_day_name` | STRING | OK |
| `first_sms_weekend_flag` | STRING | OK |
| `first_sms_speed_bucket` | STRING | OK |
| `first_sms_intent` | STRING | OK |
| `first_sms_has_link` | BOOL | OK |
| `had_true_double_tap` | INT64 | OK |
| `days_to_first_double_tap` | INT64 | OK |
| `double_tap_same_day_as_contact` | INT64 | OK |
| `first_reply_datetime` | DATETIME | OK |
| `sga_response_datetime` | DATETIME | OK |
| `response_time_minutes` | INT64 | OK |
| `response_speed_bucket` | STRING | OK |
| `sga_performance_tier` | STRING | OK |
| `sga_contacted_to_mql_rate` | FLOAT64 | OK |
| `sga_contacted_to_sqo_rate` | FLOAT64 | OK |

---

### 3. savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance (57 columns)

| column_name | data_type | status |
|---|---|---|
| `task_id` | STRING | OK |
| `task_created_date_utc` | TIMESTAMP | OK |
| `task_created_date` | DATE | OK |
| `task_created_date_est` | DATE | OK |
| `task_created_datetime_est` | DATETIME | OK |
| `task_activity_date` | DATE | OK |
| `activity_hour_est` | INT64 | OK |
| `activity_day_of_week` | STRING | OK |
| `task_status` | STRING | OK |
| `task_subject` | STRING | OK |
| `task_type` | STRING | OK |
| `task_subtype` | STRING | OK |
| `call_duration_seconds` | INT64 | OK |
| `task_who_id` | STRING | OK |
| `task_what_id` | STRING | OK |
| `task_executor_name` | STRING | OK |
| `task_executor_id` | STRING | OK |
| `task_executor_created_date` | TIMESTAMP | OK |
| `activity_ramp_status` | STRING | OK |
| `activity_channel` | STRING | OK |
| `activity_channel_group` | STRING | OK |
| `is_engagement_tracking` | INT64 | OK |
| `direction` | STRING | OK |
| `is_meaningful_connect` | INT64 | OK |
| `is_marketing_activity` | INT64 | OK |
| `SGA_Owner_Name__c` | STRING | OK |
| `sgm_name` | STRING | OK |
| `SGA_IsSGA__c` | BOOL | OK |
| `SGA_IsActive` | BOOL | OK |
| `Full_prospect_id__c` | STRING | OK |
| `Full_Opportunity_ID__c` | STRING | OK |
| `StageName` | STRING | OK |
| `TOF_Stage` | STRING | OK |
| `is_contacted` | INT64 | OK |
| `is_mql` | INT64 | OK |
| `is_sql` | INT64 | OK |
| `is_sqo` | INT64 | OK |
| `is_joined` | INT64 | OK |
| `Initial_Call_Scheduled_Date__c` | DATE | OK |
| `Qualification_Call_Date__c` | DATE | OK |
| `Date_Became_SQO__c` | TIMESTAMP | OK |
| `Stage_Entered_Closed__c` | TIMESTAMP | OK |
| `is_cold_call` | INT64 | OK |
| `call_type` | STRING | OK |
| `is_true_cold_call` | INT64 | OK |
| `cold_call_quality` | STRING | OK |
| `outbound_call_sequence_num` | INT64 | OK |
| `advisor_name` | STRING | OK |
| `Prospect_Name` | STRING | OK |
| `Opp_Name` | STRING | OK |
| `Company` | INT64 | OK |
| `Lead_Original_Source` | INT64 | OK |
| `Original_source` | STRING | OK |
| `Channel_Grouping_Name` | STRING | OK |
| `Opportunity_AUM` | FLOAT64 | OK |
| `Amount` | FLOAT64 | OK |
| `Underwritten_AUM__c` | FLOAT64 | OK |

---

### 4. savvy-gtm-analytics.savvy_analytics.sms_intent_classified (9 columns)

| column_name | data_type | status |
|---|---|---|
| `task_id` | STRING | OK |
| `who_id` | STRING | OK |
| `owner_id` | STRING | OK |
| `sms_type` | STRING | OK |
| `task_created_date` | TIMESTAMP | OK |
| `clean_body` | STRING | OK |
| `sms_intent` | STRING | OK |
| `classification_status` | STRING | OK |
| `classified_at` | TIMESTAMP | OK |

---

### 5. savvy-gtm-analytics.savvy_analytics.sms_weekly_metrics_daily (21 columns)

| column_name | data_type | status |
|---|---|---|
| `sga_name` | STRING | OK |
| `initial_sms_last_7d` | INT64 | OK |
| `historical_weekly_avg` | FLOAT64 | OK |
| `link_violation_count` | INT64 | OK |
| `self_sourced_contacted` | INT64 | OK |
| `self_sourced_texted` | INT64 | OK |
| `provided_list_contacted` | INT64 | OK |
| `provided_list_texted` | INT64 | OK |
| `eligible_for_double_tap` | INT64 | OK |
| `bookend_count` | INT64 | OK |
| `golden_window_fail_count` | INT64 | OK |
| `total_initial_sms_last_7d` | INT64 | OK |
| `team_avg_last_7d` | FLOAT64 | OK |
| `self_sourced_coverage_rate` | FLOAT64 | OK |
| `provided_list_coverage_rate` | FLOAT64 | OK |
| `bookend_adherence_rate` | FLOAT64 | OK |
| `golden_window_adherence_rate` | FLOAT64 | OK |
| `slow_response_details` | ARRAY<STRUCT<lead_id STRING, mins INT64, in_msg STRING, out_msg STRING>> | OK |
| `report_generated_date` | DATE | OK |
| `last_7_days_start` | DATE | OK |
| `last_7_days_end` | DATE | OK |

---

### 6. savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition (12 columns)

| column_name | data_type | status |
|---|---|---|
| `opportunity_id` | STRING | OK |
| `sfdc_url` | STRING | OK |
| `opportunity_name` | STRING | OK |
| `crd` | STRING | OK |
| `original_firm` | STRING | OK |
| `sqo_date` | TIMESTAMP | OK |
| `closed_lost_date` | DATE | OK |
| `new_firm_start_date` | DATE | OK |
| `months_to_move` | FLOAT64 | OK |
| `moved_to_firm` | STRING | OK |
| `closed_lost_reason` | STRING | OK |
| `closed_lost_details` | STRING | OK |

---

### 7. savvy-gtm-analytics.SavvyGTMData.Opportunity (100 columns)

| column_name | data_type | status |
|---|---|---|
| `Id` | STRING | OK |
| `IsDeleted` | BOOL | OK |
| `AccountId` | STRING | OK |
| `RecordTypeId` | STRING | OK |
| `IsPrivate` | BOOL | OK |
| `Name` | STRING | OK |
| `Description` | STRING | OK |
| `StageName` | STRING | OK |
| `Amount` | FLOAT64 | OK |
| `Probability` | FLOAT64 | OK |
| `ExpectedRevenue` | FLOAT64 | OK |
| `TotalOpportunityQuantity` | FLOAT64 | OK |
| `CloseDate` | DATE | OK |
| `Type` | STRING | OK |
| `NextStep` | STRING | OK |
| `LeadSource` | STRING | OK |
| `IsClosed` | BOOL | OK |
| `IsWon` | BOOL | OK |
| `ForecastCategory` | STRING | OK |
| `ForecastCategoryName` | STRING | OK |
| `CampaignId` | STRING | OK |
| `HasOpportunityLineItem` | BOOL | OK |
| `Pricebook2Id` | STRING | OK |
| `OwnerId` | STRING | OK |
| `CreatedDate` | TIMESTAMP | OK |
| `CreatedById` | STRING | OK |
| `LastModifiedDate` | TIMESTAMP | OK |
| `LastModifiedById` | STRING | OK |
| `SystemModstamp` | TIMESTAMP | OK |
| `LastActivityDate` | DATE | OK |
| `PushCount` | INT64 | OK |
| `LastStageChangeDate` | TIMESTAMP | OK |
| `FiscalQuarter` | INT64 | OK |
| `FiscalYear` | INT64 | OK |
| `Fiscal` | STRING | OK |
| `ContactId` | STRING | OK |
| `LastViewedDate` | TIMESTAMP | OK |
| `LastReferencedDate` | TIMESTAMP | OK |
| `SyncedQuoteId` | STRING | OK |
| `ContractId` | STRING | OK |
| `HasOpenActivity` | BOOL | OK |
| `HasOverdueTask` | BOOL | OK |
| `LastAmountChangedHistoryId` | STRING | OK |
| `LastCloseDateChangedHistoryId` | STRING | OK |
| `Budget_Confirmed__c` | BOOL | OK |
| `Discovery_Completed__c` | BOOL | OK |
| `ROI_Analysis_Completed__c` | BOOL | OK |
| `SGA__c` | STRING | OK |
| `Dover_Candidate_ID__c` | STRING | OK |
| `SQL__c` | STRING | OK |
| `Closed_Lost_Reason__c` | STRING | OK |
| `City_State__c` | STRING | OK |
| `Restrictive_Covenants__c` | STRING | OK |
| `Conversion_Channel__c` | STRING | OK |
| `FINRA__c` | BOOL | OK |
| `Gong__Gong_Count__c` | FLOAT64 | OK |
| `Gong__MainCompetitors__c` | STRING | OK |
| `Custodian__c` | STRING | OK |
| `FA_CRD__c` | STRING | OK |
| `Firm_Name__c` | STRING | OK |
| `Firm_Type_old__c` | STRING | OK |
| `Firm_Website__c` | STRING | OK |
| `Personal_AUM__c` | FLOAT64 | OK |
| `Personal_Email__c` | STRING | OK |
| `Referral_Name__c` | STRING | OK |
| `Transferability_Probability__c` | STRING | OK |
| `Underwritten_AUM__c` | FLOAT64 | OK |
| `Years_as_a_Rep__c` | FLOAT64 | OK |
| `Years_at_Firm__c` | FLOAT64 | OK |
| `Date_Became_SQO__c` | TIMESTAMP | OK |
| `Advisor_Notes_Doc__c` | STRING | OK |
| `Experimentation_Tag__c` | STRING | OK |
| `Week_Joined__c` | DATE | OK |
| `Stage_Entered_Discovery__c` | TIMESTAMP | OK |
| `Average_AUM_at_Firm__c` | FLOAT64 | OK |
| `Held_Intro_Call__c` | FLOAT64 | OK |
| `Start_of_Week__c` | DATE | OK |
| `WBR_Week__c` | DATE | OK |
| `To_be_Qualified__c` | FLOAT64 | OK |
| `Count_SQO__c` | FLOAT64 | OK |
| `typeform__Typeform_Form_Mapping__c` | STRING | OK |
| `Stage_Entered_Sales_Process__c` | TIMESTAMP | OK |
| `Stage_Entered_Negotiating__c` | TIMESTAMP | OK |
| `Stage_Entered_Signed__c` | TIMESTAMP | OK |
| `Stage_Entered_On_Hold__c` | TIMESTAMP | OK |
| `Stage_Entered_Closed__c` | TIMESTAMP | OK |
| `Stage_Entered_Joined__c` | TIMESTAMP | OK |
| `Full_Opportunity_ID__c` | STRING | OK |
| `Lead_List_Name__c` | STRING | OK |
| `Dover_Channel__c` | STRING | OK |
| `Qualification_Call_Date__c` | DATE | OK |
| `Advisor_Join_Date__c` | DATE | OK |
| `Underwriting_Doc_URL__c` | STRING | OK |
| `Advisor_Split__c` | FLOAT64 | OK |
| `Non_Standard_Marketing_Offer__c` | BOOL | OK |
| `Non__c` | FLOAT64 | OK |
| `Additional_Software__c` | BOOL | OK |
| `Additional_Software_Costs__c` | FLOAT64 | OK |
| `Additional_Software_Notes__c` | STRING | OK |
| `Other_Fixed_Costs__c` | BOOL | OK |

---

### 8. savvy-gtm-analytics.SavvyGTMData.Task (46 columns)

| column_name | data_type | status |
|---|---|---|
| `Id` | STRING | OK |
| `WhoId` | STRING | OK |
| `WhatId` | STRING | OK |
| `WhoCount` | INT64 | OK |
| `WhatCount` | INT64 | OK |
| `Subject` | STRING | OK |
| `ActivityDate` | DATE | OK |
| `Status` | STRING | OK |
| `Priority` | STRING | OK |
| `IsHighPriority` | BOOL | OK |
| `OwnerId` | STRING | OK |
| `Description` | STRING | OK |
| `Type` | STRING | OK |
| `IsDeleted` | BOOL | OK |
| `AccountId` | STRING | OK |
| `IsClosed` | BOOL | OK |
| `CreatedDate` | TIMESTAMP | OK |
| `CreatedById` | STRING | OK |
| `LastModifiedDate` | TIMESTAMP | OK |
| `LastModifiedById` | STRING | OK |
| `SystemModstamp` | TIMESTAMP | OK |
| `IsArchived` | BOOL | OK |
| `CallDurationInSeconds` | INT64 | OK |
| `CallType` | STRING | OK |
| `CallDisposition` | STRING | OK |
| `CallObject` | STRING | OK |
| `ReminderDateTime` | TIMESTAMP | OK |
| `IsReminderSet` | BOOL | OK |
| `RecurrenceActivityId` | STRING | OK |
| `IsRecurrence` | BOOL | OK |
| `RecurrenceStartDateOnly` | DATE | OK |
| `RecurrenceEndDateOnly` | DATE | OK |
| `RecurrenceTimeZoneSidKey` | STRING | OK |
| `RecurrenceType` | STRING | OK |
| `RecurrenceInterval` | INT64 | OK |
| `RecurrenceDayOfWeekMask` | INT64 | OK |
| `RecurrenceDayOfMonth` | INT64 | OK |
| `RecurrenceInstance` | STRING | OK |
| `RecurrenceMonthOfYear` | STRING | OK |
| `RecurrenceRegeneratedType` | STRING | OK |
| `TaskSubtype` | STRING | OK |
| `CompletedDateTime` | TIMESTAMP | OK |
| `Meeting_Booked_Date__c` | DATE | OK |
| `SGA__c` | STRING | OK |
| `Week_Joined__c` | DATE | OK |
| `Joined_Date__c` | DATE | OK |

---

## Findings and Flags

### Type Anomalies to Watch

| View | Column | Type | Flag |
|---|---|---|---|
| vw_funnel_master | Date_Became_SQO__c | TIMESTAMP | Requires DATE() cast if comparing to DATE values |
| vw_funnel_master | All is_* flags | INT64 | Use = 1 comparisons, not boolean operators |
| vw_funnel_master | Opportunity_AUM_M | FLOAT64 | Already in millions -- do not divide by 1M again |
| vw_lost_to_competition | months_to_move | FLOAT64 | Fractional months -- consider ROUND() in display |
| vw_sga_activity_performance | Company, Lead_Original_Source | INT64 | Unexpected INT64 for apparent name/label fields -- may be ID or count columns |
| sms_weekly_metrics_daily | slow_response_details | ARRAY(STRUCT) | Nested type -- requires UNNEST in queries, cannot be used in flat exports |

### Notable Finding: vw_sga_activity_performance -- INT64 Name Fields

The columns Company and Lead_Original_Source in vw_sga_activity_performance have type INT64 rather than STRING. This is unexpected if these are intended to be firm name or source label fields. They may be ID columns or count columns reusing misleading names. Any feature consuming these for display should verify actual values before rendering as text.

### No Missing Views

All 8 requested views and tables exist and returned schema data. No access errors were encountered.

### Join Key Availability

`Full_prospect_id__c` (STRING) is present in:
- vw_funnel_master
- vw_sga_sms_timing_analysis_v2
- vw_sga_activity_performance

This confirms the documented 100% match-rate join key is available across all relevant views for the Agentic Reporting feature.