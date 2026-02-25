# Data Verifier Findings: Stale Pipeline Alerts

**Date:** 2026-02-25
**Feature:** Stale Pipeline Alerts on Pipeline Tab
**Project:** savvy-gtm-analytics

---

## 1. Relevant BigQuery Views

The only relevant view for open pipeline is **savvy-gtm-analytics.Tableau_Views.vw_funnel_master**.

Full list of views in Tableau_Views dataset:
- vw_funnel_master: primary analytics view (relevant)
- vw_daily_forecast: forecast data (not relevant)
- vw_joined_advisor_location: geographic data (not relevant)
- vw_sga_activity_performance: SGA activity metrics (not relevant)
- geocoded_addresses: table (not relevant)

No vw_stale_pipeline, vw_open_pipeline, or similar views exist in savvy-gtm-analytics (Tableau_Views + SavvyGTMData both confirmed).

vw_t3_conference_enriched lives in savvy-gtm-analytics.ml_features for T3 conference ML -- not relevant to this feature.

---

## 2. daysInCurrentStage -- Does It Exist in BigQuery?

NO. daysInCurrentStage does NOT exist as a column in vw_funnel_master. It is entirely calculated at the application layer in src/lib/utils/date-helpers.ts:261.

The BigQuery view has all the raw stage entry date inputs:

| BQ Column | Type | Used For |
|-----------|------|----------|
| Stage_Entered_Discovery__c | TIMESTAMP | Discovery stage entry |
| Stage_Entered_Sales_Process__c | TIMESTAMP | Sales Process stage entry |
| Stage_Entered_Negotiating__c | TIMESTAMP | Negotiating stage entry |
| Stage_Entered_On_Hold__c | TIMESTAMP | On Hold stage entry |
| Stage_Entered_Signed__c | TIMESTAMP | Signed stage entry |
| Opp_CreatedDate | TIMESTAMP | Qualifying stage proxy (no Stage_Entered_Qualifying__c) |
| Date_Became_SQO__c | TIMESTAMP | SQO/fallback |

No view changes needed for this feature. All required data is present.

---

## 3. StageName / Opportunity Stage Field

Field: StageName (STRING, from Opportunity.StageName).

Open pipeline stage distribution (is_sqo=1, is_joined=0, StageName not in Closed/Signed/Joined, is_primary_opp_record=1):

| Stage | Count | % of Open Pipeline |
|-------|-------|--------------------|
| Sales Process | 56 | 32.4% |
| On Hold | 54 | 31.2% |
| Discovery | 38 | 22.0% |
| Negotiating | 19 | 11.0% |
| Qualifying | 6 | 3.5% |
| **Total** | **173** | **100%** |

All 173 open pipeline records have StageName populated (100%). All are is_primary_opp_record = 1.

Full dataset StageName values (NULL = lead-only records with no linked opportunity):
- NULL: 100,186
- Closed Lost: 1,920
- Planned Nurture: 530
- Joined: 111
- On Hold: 62 (total incl. historical)
- Sales Process: 56 (all open pipeline)
- Outreach: 53
- Qualifying: 51 (only 6 are open pipeline SQOs)
- Discovery: 38 (all open)
- Re-Engaged: 23
- Negotiating: 19 (all open)
- Call Scheduled: 9
- Signed: 7
- Engaged: 4

---

## 4. Stage Tracking Fields

- StageName: current opportunity stage (STRING), directly from Salesforce Opportunity
- TOF_Stage: computed highest milestone reached funnel stage (always populated), NOT the current stage. Values: Prospect, Contacted, MQL, SQL, SQO, Joined, Closed
- StageName_code: INT64, numeric encoding of StageName for sorting

For Stale Pipeline Alerts, StageName is the correct field to group by. No new fields needed.

---

## 5. stageEnteredDate / How daysInCurrentStage is Calculated

There is no unified stage entered date field. The app uses a CASE-based lookup in calculateDaysInStage() (src/lib/utils/date-helpers.ts:284):

- Qualifying    -> Opp_CreatedDate (proxy -- no Stage_Entered_Qualifying__c in Salesforce)
- Discovery     -> Stage_Entered_Discovery__c
- Sales Process -> Stage_Entered_Sales_Process__c
- Negotiating   -> Stage_Entered_Negotiating__c
- Signed        -> Stage_Entered_Signed__c
- On Hold       -> Stage_Entered_On_Hold__c
- Closed Lost   -> Stage_Entered_Closed__c
- Joined        -> advisor_join_date__c

This logic already exists in the codebase. daysInCurrentStage is already on DetailRecord. No new calculation logic needed.

---

## 6. Population Rates for Open Pipeline Records

| Metric | Value |
|--------|-------|
| Total open pipeline records | 173 |
| Records with calculable days_in_stage | 168 |
| **Population rate** | **97.1%** |
| Records with NULL (no entry date) | 5 |
| StageName populated | 173/173 (100%) |
| Opportunity_AUM populated | 173/173 (100%) |
| advisor_name populated | 173/173 (100%) |

The 5 NULL records are in Discovery (4) and On Hold (1) -- stage entry date missing from Salesforce.

---

## 7. Distribution of Days-in-Stage and Threshold Analysis

Overall statistics (173 open pipeline records):

| Metric | Value |
|--------|-------|
| Min days | 0 |
| Max days | 516 |
| Average days | 87.4 |
| P25 | 16 |
| Median | 47 |
| P75 | 118 |

Threshold flags:

| Threshold | Records Flagged | % of Open Pipeline |
|-----------|----------------|-------------------|
| No date (NULL) | 5 | 2.9% |
| < 30 days | 61 | 35.3% |
| 30-59 days | 33 | 19.1% |
| 60-89 days | 20 | 11.6% |
| 90+ days | 54 | 31.2% |
| **Flagged at 30-day threshold** | **107** | **61.8%** |
| **Flagged at 60-day threshold** | **74** | **42.8%** |
| **Flagged at 90-day threshold** | **54** | **31.2%** |

Per-stage breakdown:

| Stage | Total | Avg Days | Median | NULL | @30d | @60d | @90d |
|-------|-------|----------|--------|------|------|------|------|
| Sales Process | 56 | 49.8 | 27 | 0 | 27 (48%) | 16 (29%) | 10 (18%) |
| On Hold | 54 | 173.3 | 154 | 1 | 48 (89%) | 42 (78%) | 37 (69%) |
| Discovery | 38 | 27.3 | 16 | 4 | 14 (37%) | 5 (13%) | 0 (0%) |
| Negotiating | 19 | 69.8 | 51 | 0 | 15 (79%) | 9 (47%) | 5 (26%) |
| Qualifying | 6 | 74.8 | 27 | 0 | 3 (50%) | 2 (33%) | 2 (33%) |

Key finding: On Hold is the stalest segment (avg 173d, median 154d). 31% of all open pipeline has been in current stage 90+ days. Feature will surface meaningful data.

---

## 8. Existing Stale Pipeline Views

None exist. Confirmed by querying INFORMATION_SCHEMA.TABLES in both Tableau_Views and SavvyGTMData. No view name contains stale, pipeline, or open.

---

## 9. Edge Cases

| Edge Case | Count | Notes |
|-----------|-------|-------|
| NULL days_in_stage | 5 | 4 Discovery + 1 On Hold -- entry date missing in Salesforce |
| Negative days | 0 | No data quality issues |
| Zero days (entered today) | 1 | Valid |
| Days > 365 | 4 | Max 516 days -- all in On Hold, expected behavior |
| Days > 730 | 0 | No extreme outliers |
| NULL StageName on is_sqo=1 records | 0 | All 173 open pipeline have StageName populated |
| No Stage_Entered_Qualifying__c | 6 records | Uses Opp_CreatedDate as proxy |

Special handling needed:

1. Qualifying stage: uses Opp_CreatedDate as proxy (no Stage_Entered_Qualifying__c in Salesforce). Days = days since opp was created. Consider a UI footnote.
2. On Hold: deliberate pause state, not necessarily stuck. Consider treating separately (different section, different color, or configurable exclusion).
3. NULL days_in_stage (5 records): show N/A or sort to bottom in UI.

---

## 10. vw_open_pipeline Existence

Does not exist. Open pipeline is filtered from vw_funnel_master using:

    WHERE is_sqo = 1
      AND is_joined = 0
      AND StageName NOT IN (Closed Lost, Signed, Joined)
      AND is_primary_opp_record = 1

Consistent with existing dashboard query patterns.

---

## 11. vw_t3_conference_enriched Relevance

views/vw_t3_conference_enriched.sql targets savvy-gtm-analytics.ml_features.T3_conference_enriched. Enriches T3 conference ML data with CRM signals (replied, SQL, SQO). Not relevant to Stale Pipeline Alerts.

---

## 12. AUM Data (Useful for Display)

All 173 open pipeline records have Opportunity_AUM populated (100%):

| Stage | Avg AUM (M) | Max AUM (M) |
|-------|------------|------------|
| Discovery | 185.7 | 550 |
| Sales Process | 98.5 | 550 |
| Negotiating | 83.0 | 500 |
| On Hold | 63.7 | 238 |
| Qualifying | 53.3 | 130 |

---

## Summary: What Exists vs. What Is Needed

| Need | Status | Notes |
|------|--------|-------|
| StageName field | EXISTS in BQ | 100% populated for open pipeline |
| Stage entry dates per stage | EXISTS in BQ | 97.1% calculable days_in_stage |
| daysInCurrentStage on DetailRecord | ALREADY IMPLEMENTED | src/lib/utils/date-helpers.ts:261 |
| Open pipeline filter | NO VIEW NEEDED | Filter from vw_funnel_master |
| Stale pipeline BQ view | NOT NEEDED | App-layer calculation sufficient |
| vw_stale_pipeline view | DOES NOT EXIST | Not needed |

No BigQuery view changes are required for this feature. All data is available in vw_funnel_master and the daysInCurrentStage calculation logic already exists at src/lib/utils/date-helpers.ts:261.