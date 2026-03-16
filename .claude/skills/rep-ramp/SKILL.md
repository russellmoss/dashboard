---
name: rep-ramp
description: "Track SGM or SGA ramp-up trajectory. Analyzes a manager's team performance, pipeline progression, and SGA coaching effectiveness — or an individual SGA's activity curve and milestones. Usage: /rep-ramp [name]"
---

# Rep Ramp Tracker — SGM or SGA Analysis

You are analyzing the ramp-up trajectory of a team member at Savvy Wealth. The user will provide a name. Your first job is to determine whether they are an **SGM (Sales Growth Manager)** or an **SGA (Sales Growth Advisor)**, then run the appropriate analysis.

## Business Rule: Closed Lost Overrides Joined

If an advisor has an `advisor_join_date__c` but their current `StageName = 'Closed Lost'`, they are **not** counted as joined. The `is_joined` flag in `vw_funnel_master` already handles this (deployed 2026-03-16). When writing custom queries that reference `advisor_join_date__c` directly instead of `is_joined`, always add `AND StageName != 'Closed Lost'`.

## Business Rule: Close Rate = joined_unique / (joined_unique + closed_lost)

Close rate is calculated on **resolved, deduped deals only**: `SUM(is_joined_unique) / (SUM(is_joined_unique) + COUNTIF(StageName = 'Closed Lost' AND is_primary_opp_record = 1))`. Open pipeline SQOs are excluded from the denominator. Both numerator and denominator use deduped counts (`is_primary_opp_record = 1`) to avoid multi-lead inflation. This matches the dashboard's "Open Pipeline by SGM" tab.

## Business Rule: Use `_unique` Flags for Volume Counts

Multiple leads can convert to the same opportunity (e.g., Luis Rosa had 2 leads → 1 opp). When counting **SQO or Joined volume**, always use `is_sqo_unique` and `is_joined_unique` instead of `is_sqo` and `is_joined`. The `_unique` flags only count once per opportunity (via `opp_row_num = 1`). Use the non-unique flags only for per-lead analysis (e.g., "did this lead reach SQO?") or for `CASE WHEN` value lookups (AUM, dates).

---

## Step 0: Identify the Person and Role

Search both SGM and SGA fields:

```sql
-- Check if they're an SGM (manager)
SELECT 'SGM' AS role, SGM_Owner_Name__c AS name, COUNT(DISTINCT SGA_Owner_Name__c) AS sga_count,
  COUNT(DISTINCT Full_prospect_id__c) AS prospects, SUM(is_sqo_unique) AS sqo, SUM(is_joined_unique) AS joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE LOWER(SGM_Owner_Name__c) LIKE LOWER('%[name]%')
GROUP BY 2

UNION ALL

-- Check if they're an SGA (rep)
SELECT 'SGA' AS role, SGA_Owner_Name__c AS name, 0 AS sga_count,
  COUNT(DISTINCT Full_prospect_id__c) AS prospects, SUM(is_sqo_unique) AS sqo, SUM(is_joined_unique) AS joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE LOWER(SGA_Owner_Name__c) LIKE LOWER('%[name]%')
GROUP BY 2
```

**If SGM**: Follow the SGM Analysis path below.
**If SGA**: Follow the SGA Analysis path (at the bottom of this document).
**If both or ambiguous**: Ask the user which role they want analyzed.

---

## SGM ANALYSIS PATH

SGMs (Sales Growth Managers) don't contact prospects directly — they manage a team of SGAs. The analysis focuses on: **team composition, SGA development, pipeline management, and coaching effectiveness.**

Key fields:
- `vw_funnel_master.SGM_Owner_Name__c` — the SGM assigned to the opportunity
- `vw_sga_activity_performance.sgm_name` — the SGM linked to each activity
- SGMs appear in the pipeline "By SGM" tab in the dashboard

### SGM Step 1: Team Composition & History

```sql
-- Who are this SGM's SGAs and how have they performed?
SELECT
  f.SGA_Owner_Name__c AS sga,
  MIN(DATE(f.CreatedDate)) AS first_lead_date,
  MAX(DATE(f.CreatedDate)) AS latest_lead_date,
  COUNTIF(f.is_contacted = 1) AS contacted,
  SUM(f.contacted_to_mql_progression) AS mql,
  SUM(f.is_sqo_unique) AS sqo,
  SUM(f.is_joined_unique) AS joined,
  ROUND(SAFE_DIVIDE(SUM(f.contacted_to_mql_progression), COUNTIF(f.is_contacted = 1)) * 100, 2) AS contact_to_mql_pct,
  ROUND(SAFE_DIVIDE(SUM(f.is_sqo_unique), COUNTIF(f.is_contacted = 1)) * 100, 2) AS contact_to_sqo_pct,
  ROUND(AVG(CASE WHEN f.is_joined_unique = 1 THEN f.Opportunity_AUM_M END), 1) AS avg_joined_aum_m
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
WHERE f.SGM_Owner_Name__c = '[exact SGM name]'
GROUP BY 1
ORDER BY sqo DESC
```

### SGM Step 2: Pipeline Under Management

```sql
-- Current open pipeline for this SGM's book
SELECT
  f.StageName,
  COUNT(*) AS opps,
  COUNT(DISTINCT f.SGA_Owner_Name__c) AS sgas_with_opps,
  ROUND(SUM(f.Opportunity_AUM_M), 0) AS total_aum_m,
  ROUND(AVG(f.Opportunity_AUM_M), 1) AS avg_aum_m,
  ROUND(AVG(DATE_DIFF(CURRENT_DATE(), DATE(f.Date_Became_SQO__c), DAY)), 0) AS avg_days_in_stage
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
WHERE f.SGM_Owner_Name__c = '[exact SGM name]'
  AND f.is_sqo = 1
  AND f.StageName NOT LIKE '%Closed%'
  AND f.is_joined = 0
GROUP BY 1
ORDER BY opps DESC
```

### SGM Step 3: Quarterly Production Trend

```sql
-- How is this SGM's team producing over time?
SELECT
  FORMAT_DATE('%Y-Q', DATE(f.Date_Became_SQO__c)) ||
    CAST(EXTRACT(QUARTER FROM DATE(f.Date_Became_SQO__c)) AS STRING) AS sqo_quarter,
  SUM(f.is_sqo_unique) AS sqo,
  SUM(f.is_joined_unique) AS joined,
  ROUND(SUM(CASE WHEN f.is_sqo_unique = 1 THEN f.Opportunity_AUM_M END), 0) AS sqo_aum_m,
  COUNT(DISTINCT f.SGA_Owner_Name__c) AS active_sgas,
  ROUND(SAFE_DIVIDE(SUM(f.is_sqo_unique), COUNT(DISTINCT f.SGA_Owner_Name__c)), 1) AS sqo_per_sga
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
WHERE f.SGM_Owner_Name__c = '[exact SGM name]'
  AND f.Date_Became_SQO__c IS NOT NULL
GROUP BY 1, DATE(f.Date_Became_SQO__c)
ORDER BY MIN(DATE(f.Date_Became_SQO__c))
```

### SGM Step 4: SGA Behavior Under This SGM

How disciplined are this SGM's reps compared to other SGMs' reps?

```sql
-- SMS behavior metrics for SGAs under this SGM vs team average
WITH sgm_sgas AS (
  SELECT DISTINCT SGA_Owner_Name__c
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE SGM_Owner_Name__c = '[exact SGM name]'
)
SELECT
  '[exact SGM name] Team' AS cohort,
  COUNT(*) AS sms_leads,
  ROUND(AVG(CASE WHEN s.first_sms_same_day = 1 THEN 100.0 ELSE 0 END), 1) AS same_day_pct,
  ROUND(AVG(CASE WHEN s.got_reply = 1 THEN 100.0 ELSE 0 END), 1) AS reply_rate_pct,
  ROUND(AVG(CASE WHEN s.had_true_double_tap = 1 THEN 100.0 ELSE 0 END), 1) AS double_tap_pct,
  ROUND(AVG(CASE WHEN s.first_sms_has_link THEN 100.0 ELSE 0 END), 1) AS link_rate_pct,
  ROUND(AVG(s.response_time_minutes), 0) AS avg_response_min
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2` s
WHERE s.SGA_Owner_Name__c IN (SELECT SGA_Owner_Name__c FROM sgm_sgas)
  AND s.received_any_sms = 1

UNION ALL

SELECT
  'All Teams' AS cohort,
  COUNT(*),
  ROUND(AVG(CASE WHEN s.first_sms_same_day = 1 THEN 100.0 ELSE 0 END), 1),
  ROUND(AVG(CASE WHEN s.got_reply = 1 THEN 100.0 ELSE 0 END), 1),
  ROUND(AVG(CASE WHEN s.had_true_double_tap = 1 THEN 100.0 ELSE 0 END), 1),
  ROUND(AVG(CASE WHEN s.first_sms_has_link THEN 100.0 ELSE 0 END), 1),
  ROUND(AVG(s.response_time_minutes), 0)
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2` s
WHERE s.received_any_sms = 1
```

### SGM Step 5: Peer SGM Comparison

How does this SGM rank against other SGMs?

```sql
SELECT
  f.SGM_Owner_Name__c AS sgm,
  COUNT(DISTINCT f.SGA_Owner_Name__c) AS sga_count,
  SUM(f.is_sqo_unique) AS total_sqo,
  SUM(f.is_joined_unique) AS total_joined,
  COUNTIF(f.StageName = 'Closed Lost' AND f.is_primary_opp_record = 1) AS total_closed_lost,
  ROUND(SAFE_DIVIDE(
    SUM(f.is_joined_unique),
    SUM(f.is_joined_unique) + COUNTIF(f.StageName = 'Closed Lost' AND f.is_primary_opp_record = 1)
  ) * 100, 1) AS close_rate_pct,
  ROUND(SUM(CASE WHEN f.is_joined_unique = 1 THEN f.Opportunity_AUM_M ELSE 0 END), 0) AS joined_aum_m,
  ROUND(AVG(CASE WHEN f.is_joined_unique = 1 THEN
    DATE_DIFF(f.advisor_join_date__c, DATE(f.Date_Became_SQO__c), DAY)
  END), 0) AS avg_sqo_to_join_days
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
WHERE f.SGM_Owner_Name__c IS NOT NULL
  AND f.is_sqo = 1
GROUP BY 1
HAVING SUM(f.is_sqo_unique) >= 10
ORDER BY total_joined DESC
```

### SGM Step 6: Won/Lost Analysis for This SGM's Book

```sql
-- What sources produce wins for this SGM?
SELECT
  f.Original_source,
  f.Channel_Grouping_Name,
  SUM(f.is_sqo_unique) AS sqo,
  SUM(f.is_joined_unique) AS joined,
  COUNTIF(f.StageName = 'Closed Lost' AND f.is_primary_opp_record = 1) AS closed_lost,
  ROUND(SAFE_DIVIDE(
    SUM(f.is_joined_unique),
    SUM(f.is_joined_unique) + COUNTIF(f.StageName = 'Closed Lost' AND f.is_primary_opp_record = 1)
  ) * 100, 1) AS close_rate_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
WHERE f.SGM_Owner_Name__c = '[exact SGM name]'
  AND f.is_sqo = 1
GROUP BY 1, 2
HAVING SUM(f.is_sqo_unique) >= 3
ORDER BY sqo DESC
```

### SGM Report Structure

```markdown
# SGM Ramp & Performance Report: [Name]
*Generated: [date]*

## Summary
- **Role**: Sales Growth Manager
- **Team size**: [N] SGAs (active)
- **Total SQOs managed**: [N] | **Joined**: [N] | **Close rate**: [X]% (joined / resolved)
- **Total AUM joined**: $[X]M
- **Pipeline status**: [N] open SQOs worth $[X]M

## 1. Team Roster & Performance
[Table of all SGAs under this SGM with conversion rates, volume, AUM]

## 2. Pipeline Under Management
[Current open pipeline by stage with AUM and aging]

## 3. Production Trend
[Quarter-over-quarter SQO and join production, SQOs per SGA]

## 4. Team SMS Discipline
[This SGM's team vs company average on key behaviors]
| Behavior | This Team | Company Avg | Gap |
|----------|-----------|-------------|-----|
| Same-day first text | | | |
| Reply rate | | | |
| Response speed | | | |
| Double-tap rate | | | |
| Link violations | | | |

## 5. Peer SGM Comparison
[Rank among all SGMs on SQOs, joins, close rate, AUM]

## 6. Source Analysis
[Which sources/channels produce wins for this SGM's team]

## 7. Recommendations
- **Top coaching opportunity**: [specific SGA] should improve [behavior] — expected [impact]
- **Pipeline risk**: [N] opps have been in [stage] for [X]+ days
- **Source focus**: Shift allocation toward [high-converting source]
```

---

## SGA ANALYSIS PATH

If the person is an SGA (not an SGM), analyze their individual performance:

### SGA Step 1: Ramp Milestones

```sql
SELECT
  SGA_Owner_Name__c AS sga,
  MIN(DATE(CreatedDate)) AS first_lead_assigned,
  MIN(DATE(stage_entered_contacting__c)) AS first_contact,
  MIN(CASE WHEN is_mql = 1 THEN DATE(mql_stage_entered_ts) END) AS first_mql,
  MIN(CASE WHEN is_sql = 1 THEN converted_date_raw END) AS first_sql,
  MIN(CASE WHEN is_sqo_unique = 1 THEN DATE(Date_Became_SQO__c) END) AS first_sqo,
  MIN(CASE WHEN is_joined_unique = 1 THEN advisor_join_date__c END) AS first_joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = '[exact name]'
GROUP BY 1
```

### SGA Step 2: Weekly Activity Curve

```sql
SELECT
  DATE_TRUNC(task_activity_date, WEEK(MONDAY)) AS week_start,
  COUNTIF(activity_channel = 'SMS' AND direction = 'Outbound') AS outbound_sms,
  COUNTIF(activity_channel = 'SMS' AND direction = 'Inbound') AS inbound_sms,
  COUNTIF(is_cold_call = 1) AS cold_calls,
  COUNTIF(is_meaningful_connect = 1) AS meaningful_connects,
  COUNT(DISTINCT Full_prospect_id__c) AS unique_prospects_touched
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
WHERE task_executor_name = '[exact name]'
GROUP BY 1
ORDER BY 1
```

### SGA Step 3: Monthly Conversion Trajectory

```sql
SELECT
  DATE_TRUNC(DATE(stage_entered_contacting__c), MONTH) AS month,
  COUNTIF(is_contacted = 1) AS contacted,
  SUM(contacted_to_mql_progression) AS mql,
  ROUND(SAFE_DIVIDE(SUM(contacted_to_mql_progression), COUNTIF(is_contacted = 1)) * 100, 2) AS mql_rate,
  SUM(is_sqo_unique) AS sqo,
  SUM(is_joined_unique) AS joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = '[exact name]'
  AND is_contacted = 1
GROUP BY 1
ORDER BY 1
```

### SGA Step 4: SMS Behavior vs Team

```sql
SELECT
  s.SGA_Owner_Name__c AS sga,
  COUNT(*) AS sms_leads,
  ROUND(AVG(CASE WHEN s.first_sms_same_day = 1 THEN 100.0 ELSE 0 END), 1) AS same_day_pct,
  ROUND(AVG(CASE WHEN s.got_reply = 1 THEN 100.0 ELSE 0 END), 1) AS reply_rate_pct,
  ROUND(AVG(CASE WHEN s.had_true_double_tap = 1 THEN 100.0 ELSE 0 END), 1) AS double_tap_pct,
  ROUND(AVG(CASE WHEN s.first_sms_has_link THEN 100.0 ELSE 0 END), 1) AS link_rate_pct,
  ROUND(AVG(s.response_time_minutes), 0) AS avg_response_min
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2` s
WHERE s.SGA_Owner_Name__c = '[exact name]' AND s.received_any_sms = 1
GROUP BY 1

UNION ALL

SELECT 'Team Average', COUNT(*),
  ROUND(AVG(CASE WHEN s.first_sms_same_day = 1 THEN 100.0 ELSE 0 END), 1),
  ROUND(AVG(CASE WHEN s.got_reply = 1 THEN 100.0 ELSE 0 END), 1),
  ROUND(AVG(CASE WHEN s.had_true_double_tap = 1 THEN 100.0 ELSE 0 END), 1),
  ROUND(AVG(CASE WHEN s.first_sms_has_link THEN 100.0 ELSE 0 END), 1),
  ROUND(AVG(s.response_time_minutes), 0)
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2` s
WHERE s.received_any_sms = 1
```

### SGA Step 5: Peer Comparison

```sql
-- Compare to reps who started around the same time
WITH sga_starts AS (
  SELECT task_executor_name AS sga, DATE(task_executor_created_date) AS hire_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
  WHERE SGA_IsSGA__c = TRUE
  GROUP BY 1, 2
)
SELECT
  s.sga, s.hire_date,
  DATE_DIFF(CURRENT_DATE(), s.hire_date, DAY) AS tenure_days,
  COUNTIF(f.is_contacted = 1) AS contacted,
  COUNTIF(f.is_mql = 1) AS mql,
  SUM(f.is_sqo_unique) AS sqo,
  SUM(f.is_joined_unique) AS joined
FROM sga_starts s
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  ON s.sga = f.SGA_Owner_Name__c
WHERE s.hire_date >= DATE_SUB((
  SELECT DATE(task_executor_created_date)
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
  WHERE LOWER(task_executor_name) LIKE LOWER('%[name]%')
  LIMIT 1
), INTERVAL 90 DAY)
GROUP BY 1, 2
ORDER BY hire_date
```

### SGA Report Structure

```markdown
# SGA Ramp Report: [Name]
*Generated: [date]*

## Summary
- **Role**: Sales Growth Advisor
- **Manager (SGM)**: [SGM name]
- **Hire date**: [date] ([N] days ago)
- **Milestones**: First MQL at day [N], First SQO at day [N]

## 1. Ramp Timeline
## 2. Activity Curve (weekly SMS/call volume)
## 3. Conversion Trajectory (monthly rates)
## 4. Behavior Scorecard vs Team
## 5. Strengths & Improvement Opportunities
## 6. Peer Comparison
```

---

**IMPORTANT**:
- Replace `[exact name]` / `[exact SGM name]` with actual values from Step 0
- ALL numbers from BigQuery — never estimate
- If a person is both an SGM and handles some prospects directly (like Corey Marcello with 4 direct SQOs), note both roles
- Frame improvement areas constructively
- Save report to `rep-ramp-report-[name].md`
