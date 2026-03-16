---
name: analyze-wins
description: "Analyze joined advisors to understand why we won, where they came from, and where to focus. Queries BigQuery funnel data, SMS activity, and deal characteristics to produce an actionable insights report."
---

# Analyze Wins — Won Deal Intelligence Agent

You are a RevOps intelligence agent analyzing Savvy Wealth's won deals (joined advisors). Your goal is to answer: **Why did we win? Where did winners come from? How do we win more?**

## Data Sources

All queries use BigQuery MCP (`mcp__bigquery__execute_sql`). Key tables:

- **`savvy-gtm-analytics.Tableau_Views.vw_funnel_master`** — Source of truth for all funnel stages, prospect/opp data, SGA assignments, AUM, sources, channels, timestamps
- **`savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2`** — SMS behavior per lead (timing, intent, double-tap, response speed) aligned to funnel master
- **`savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`** — Activity-level data (individual SMS/call records with direction, timestamps)
- **`savvy-gtm-analytics.savvy_analytics.sms_intent_classified`** — AI-classified SMS intent by task_id
- **`savvy-gtm-analytics.Tableau_Views.vw_lost_to_competition`** — Lost deals for contrast analysis

**Important**: Never use string interpolation in queries — always use literal values or @paramName syntax.

## Step 1: Pull the Joined Advisor Cohort

Run this query to get all joined advisors with their full journey:

```sql
SELECT
  f.advisor_name,
  f.Original_source,
  f.Channel_Grouping_Name,
  f.SGA_Owner_Name__c AS sga_name,
  f.SGM_Owner_Name__c AS sgm_name,
  f.Opportunity_AUM,
  f.Opportunity_AUM_M,
  f.aum_tier,
  DATE(f.CreatedDate) AS prospect_created,
  DATE(f.stage_entered_contacting__c) AS contacted_date,
  DATE(f.mql_stage_entered_ts) AS mql_date,
  f.converted_date_raw AS sql_date,
  DATE(f.Date_Became_SQO__c) AS sqo_date,
  f.advisor_join_date__c AS joined_date,
  -- Velocity metrics
  DATE_DIFF(DATE(f.stage_entered_contacting__c), DATE(f.CreatedDate), DAY) AS days_to_contact,
  DATE_DIFF(DATE(f.mql_stage_entered_ts), DATE(f.stage_entered_contacting__c), DAY) AS days_contact_to_mql,
  DATE_DIFF(f.converted_date_raw, DATE(f.mql_stage_entered_ts), DAY) AS days_mql_to_sql,
  DATE_DIFF(DATE(f.Date_Became_SQO__c), f.converted_date_raw, DAY) AS days_sql_to_sqo,
  DATE_DIFF(f.advisor_join_date__c, DATE(f.Date_Became_SQO__c), DAY) AS days_sqo_to_joined,
  DATE_DIFF(f.advisor_join_date__c, DATE(f.CreatedDate), DAY) AS total_days_to_join
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
WHERE f.is_joined = 1
ORDER BY f.advisor_join_date__c DESC
```

## Step 2: Source & Channel Analysis

Analyze where wins come from — identify which sources punch above their weight:

```sql
-- Win rates by source: which sources have highest conversion to joined?
SELECT
  Channel_Grouping_Name,
  Original_source,
  COUNTIF(is_contacted = 1) AS contacted,
  COUNTIF(is_mql = 1) AS mql,
  COUNTIF(is_sqo = 1) AS sqo,
  COUNTIF(is_joined = 1) AS joined,
  ROUND(SAFE_DIVIDE(COUNTIF(is_joined = 1), COUNTIF(is_sqo = 1)) * 100, 1) AS sqo_to_join_pct,
  ROUND(SAFE_DIVIDE(COUNTIF(is_joined = 1), COUNTIF(is_contacted = 1)) * 100, 2) AS contact_to_join_pct,
  ROUND(AVG(CASE WHEN is_joined = 1 THEN Opportunity_AUM_M END), 1) AS avg_joined_aum_m
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_contacted = 1
GROUP BY 1, 2
HAVING COUNTIF(is_contacted = 1) >= 50
ORDER BY joined DESC
```

## Step 3: SGA Win Analysis

Which SGAs close the most and what patterns do they share?

```sql
-- SGA win leaderboard with velocity
SELECT
  f.SGA_Owner_Name__c AS sga,
  COUNTIF(f.is_joined = 1) AS joined,
  COUNTIF(f.is_sqo = 1) AS sqo,
  ROUND(SAFE_DIVIDE(COUNTIF(f.is_joined = 1), COUNTIF(f.is_sqo = 1)) * 100, 1) AS sqo_to_join_pct,
  ROUND(AVG(CASE WHEN f.is_joined = 1 THEN f.Opportunity_AUM_M END), 1) AS avg_aum_m,
  ROUND(AVG(CASE WHEN f.is_joined = 1 THEN
    DATE_DIFF(f.advisor_join_date__c, DATE(f.CreatedDate), DAY)
  END), 0) AS avg_days_to_join,
  ROUND(AVG(CASE WHEN f.is_joined = 1 THEN
    DATE_DIFF(DATE(f.stage_entered_contacting__c), DATE(f.CreatedDate), DAY)
  END), 0) AS avg_days_to_contact
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
WHERE f.is_contacted = 1
  AND f.SGA_Owner_Name__c IS NOT NULL
GROUP BY 1
HAVING COUNTIF(f.is_sqo = 1) >= 5
ORDER BY joined DESC
```

## Step 4: SMS Behavior of Won Deals

What SMS patterns appear in deals that actually close?

```sql
-- SMS behavior for joined vs non-joined prospects
SELECT
  CASE WHEN f.is_joined = 1 THEN 'Joined' ELSE 'Not Joined' END AS outcome,
  COUNT(*) AS prospects,
  ROUND(AVG(s.total_outbound_sms), 1) AS avg_outbound_sms,
  ROUND(AVG(CASE WHEN s.got_reply = 1 THEN 1.0 ELSE 0 END) * 100, 1) AS reply_rate_pct,
  ROUND(AVG(CASE WHEN s.first_sms_has_link THEN 1.0 ELSE 0 END) * 100, 1) AS link_in_first_pct,
  ROUND(AVG(s.response_time_minutes), 0) AS avg_response_min,
  ROUND(AVG(CASE WHEN s.had_true_double_tap = 1 THEN 1.0 ELSE 0 END) * 100, 1) AS double_tap_pct
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
LEFT JOIN `savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2` s
  ON f.Full_prospect_id__c = s.Full_prospect_id__c
WHERE f.is_sqo = 1
GROUP BY 1
```

## Step 5: Velocity Analysis

How long does a won deal take at each stage? Where are bottlenecks?

```sql
-- Stage velocity for joined advisors by quarter
SELECT
  FORMAT_DATE('%Y-Q', advisor_join_date__c) ||
    CAST(EXTRACT(QUARTER FROM advisor_join_date__c) AS STRING) AS join_quarter,
  COUNT(*) AS joined,
  ROUND(AVG(DATE_DIFF(DATE(stage_entered_contacting__c), DATE(CreatedDate), DAY)), 0) AS avg_days_to_contact,
  ROUND(AVG(DATE_DIFF(DATE(mql_stage_entered_ts), DATE(stage_entered_contacting__c), DAY)), 0) AS avg_contact_to_mql,
  ROUND(AVG(DATE_DIFF(converted_date_raw, DATE(mql_stage_entered_ts), DAY)), 0) AS avg_mql_to_sql,
  ROUND(AVG(DATE_DIFF(DATE(Date_Became_SQO__c), converted_date_raw, DAY)), 0) AS avg_sql_to_sqo,
  ROUND(AVG(DATE_DIFF(advisor_join_date__c, DATE(Date_Became_SQO__c), DAY)), 0) AS avg_sqo_to_joined,
  ROUND(AVG(DATE_DIFF(advisor_join_date__c, DATE(CreatedDate), DAY)), 0) AS avg_total
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_joined = 1
GROUP BY 1, advisor_join_date__c
ORDER BY MIN(advisor_join_date__c) DESC
```

## Step 6: AUM Profile of Winners

```sql
-- AUM distribution of joined advisors
SELECT
  aum_tier,
  COUNT(*) AS joined,
  ROUND(AVG(Opportunity_AUM_M), 1) AS avg_aum_m,
  ROUND(MIN(Opportunity_AUM_M), 1) AS min_aum_m,
  ROUND(MAX(Opportunity_AUM_M), 1) AS max_aum_m,
  ROUND(SUM(Opportunity_AUM_M), 0) AS total_aum_m
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_joined = 1
  AND Opportunity_AUM_M IS NOT NULL
GROUP BY 1
ORDER BY avg_aum_m DESC
```

## Step 7: Contrast with Lost Deals

```sql
-- Compare won vs lost-to-competition characteristics
SELECT
  'Joined' AS outcome,
  COUNT(*) AS deals,
  ROUND(AVG(Opportunity_AUM_M), 1) AS avg_aum_m,
  ROUND(AVG(DATE_DIFF(advisor_join_date__c, DATE(CreatedDate), DAY)), 0) AS avg_cycle_days
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_joined = 1 AND Opportunity_AUM_M IS NOT NULL

UNION ALL

SELECT
  'Lost to Competition' AS outcome,
  COUNT(*) AS deals,
  ROUND(AVG(Opportunity_AUM_M), 1) AS avg_aum_m,
  ROUND(AVG(DATE_DIFF(DATE(Stage_Entered_Closed__c), DATE(CreatedDate), DAY)), 0) AS avg_cycle_days
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Closed_Lost_Reason__c LIKE '%Competition%'
  AND Opportunity_AUM_M IS NOT NULL
```

## Step 8: Synthesize & Recommend

After running all queries, produce a structured report with these sections:

### Report Structure

```markdown
# Won Deal Intelligence Report
*Generated: [date]*

## Executive Summary
- Total joined advisors: [N]
- Total AUM brought in: $[X]M
- Average deal cycle: [Y] days
- Top-performing source: [source] ([join rate]%)
- Top-performing SGA: [name] ([N] joins)

## 1. Where Winners Come From
[Source/channel breakdown with win rates. Highlight sources that convert at >2x average.]

## 2. What Winning SGAs Do Differently
[Compare top vs bottom SGA behaviors: speed to contact, SMS patterns, response time, persistence]

## 3. The Winning Deal Profile
[AUM range, velocity benchmarks, stage-by-stage timing]

## 4. SMS Patterns That Predict Wins
[First SMS timing, intent, link usage, response speed for joined vs non-joined]

## 5. Where to Focus to Win More
[Actionable recommendations ranked by expected impact:]
- Source allocation: shift [X]% of effort from [low-yield] to [high-yield]
- SGA coaching: replicate [top SGA behavior] across team
- Speed targets: contact within [N] hours, respond to replies within [M] minutes
- Deal profile: prioritize [AUM tier] prospects from [source]

## 6. Data Tables
[Include the raw query results as reference tables]
```

**IMPORTANT**:
- Run ALL queries via `mcp__bigquery__execute_sql` — do not assume or hallucinate data
- Present actual numbers, not estimates
- If a query returns no rows or errors, report that transparently
- Focus recommendations on **controllable actions** (SGA behaviors, source allocation) not uncontrollable factors (market conditions)
- Save the report to `won-deal-intelligence-report.md` in the project root
