# Coach AI Implementation - BigQuery Follow-Up Questions

> **Purpose**: Additional data exploration based on gaps identified from initial analysis and SMS research findings
> **For**: Cursor.ai with MCP connection to BigQuery
> **Instructions**: Answer each question and then APPEND the answers to the original document at `C:\Users\russe\Documents\Dashboard\Coach_AI_BQ_Questions.md` under a new section "# PHASE 12: FOLLOW-UP QUESTIONS"
> **Note**: Eric Uchoa is NOT a current SGA and wasn't around long - exclude from analysis.

---

# PHASE 12: SMS Activity Data (Critical for Coaching)

The SMS analysis report reveals critical coaching metrics that weren't fully explored. These are essential for actionable coaching.

## 12.1 SMS Activity Table Schema
**Goal**: Understand the `vw_sga_activity_performance` view for SMS metrics

**Q12.1.1**: What is the schema of `vw_sga_activity_performance`?
```sql
SELECT column_name, data_type
FROM `savvy-gtm-analytics.savvy_analytics.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
WHERE table_name = 'vw_sga_activity_performance';
```
Document:
- SMS-related fields (timestamps, direction, content indicators)
- How to identify outbound vs inbound SMS
- How to calculate response time

**Answer:**
- **View location**: The activity view lives in **`savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`** (not savvy_analytics). Local definition: `views/vw_sga_activity_performance_v2.sql`.
- **Schema (relevant for SMS)**: `activity_channel` ('SMS' when Type/Subject like SMS/Text), `direction` ('Inbound' / 'Outbound'), `task_created_date_utc`, `task_created_datetime_est`, `task_activity_date` (DATE, EST), `activity_hour_est` (hour in EST), `Full_prospect_id__c` / `task_who_id` (lead), `SGA_Owner_Name__c`, `task_executor_name`. No column named `activity_type` or `activity_date`—use `activity_channel = 'SMS'` and `task_activity_date`.
- **Outbound vs Inbound**: `direction = 'Outbound'` vs `'Inbound'` (from Type/Subject: Incoming/Inbound/Submitted Form → Inbound).
- **Response time**: Pair lead’s Inbound message with next Outbound by same lead using LEAD() over `COALESCE(Full_prospect_id__c, task_who_id)` ordered by `task_created_date_utc`; TIMESTAMP_DIFF(next_ts, activity_timestamp, MINUTE).

**Q12.1.2**: What SMS activity data is available for the last 7 days by SGA?
```sql
SELECT 
  SGA_Owner_Name__c,
  COUNT(*) AS total_sms_activities,
  SUM(CASE WHEN direction = 'Outbound' THEN 1 ELSE 0 END) AS outbound_sms,
  SUM(CASE WHEN direction = 'Inbound' THEN 1 ELSE 0 END) AS inbound_sms,
  COUNT(DISTINCT lead_id) AS unique_leads_contacted
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE activity_type = 'SMS'
  AND activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz', 'Eric Uchoa')
GROUP BY SGA_Owner_Name__c
ORDER BY total_sms_activities DESC;
```

**Answer:**
- **Data source**: Use **`Tableau_Views.vw_sga_activity_performance`** with `activity_channel = 'SMS'` and `task_activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)`. Use `COALESCE(SGA_Owner_Name__c, task_executor_name)` for SGA and exclude Eric Uchoa and test names.
- **Last 7 days (sample)**: 5,742 SMS activities total. Per-SGA sample: Katie Bassford 6 outbound, 0 inbound, 6 unique leads; Jacqueline Tully 1 outbound. Many rows have null SGA_Owner_Name__c (funnel join); executor is fallback. Run the doc query with the column mappings above for full table.

---

## 12.2 Response Time Calculation
**Goal**: Calculate SGA response speed to lead replies (critical coaching metric - 7x conversion difference)

**Q12.2.1**: How can we calculate average response time per SGA?
```sql
-- Calculate time between lead's inbound SMS and SGA's next outbound
WITH SMS_Pairs AS (
  SELECT 
    SGA_Owner_Name__c,
    lead_id,
    activity_timestamp,
    direction,
    LEAD(activity_timestamp) OVER (
      PARTITION BY lead_id 
      ORDER BY activity_timestamp
    ) AS next_activity_timestamp,
    LEAD(direction) OVER (
      PARTITION BY lead_id 
      ORDER BY activity_timestamp
    ) AS next_direction
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
  WHERE activity_type = 'SMS'
    AND activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz', 'Eric Uchoa')
)
SELECT 
  SGA_Owner_Name__c,
  COUNT(*) AS response_opportunities,
  AVG(TIMESTAMP_DIFF(next_activity_timestamp, activity_timestamp, MINUTE)) AS avg_response_minutes,
  APPROX_QUANTILES(TIMESTAMP_DIFF(next_activity_timestamp, activity_timestamp, MINUTE), 100)[OFFSET(50)] AS median_response_minutes,
  SUM(CASE WHEN TIMESTAMP_DIFF(next_activity_timestamp, activity_timestamp, MINUTE) <= 60 THEN 1 ELSE 0 END) AS responses_within_1hr,
  SUM(CASE WHEN TIMESTAMP_DIFF(next_activity_timestamp, activity_timestamp, MINUTE) > 60 THEN 1 ELSE 0 END) AS responses_over_1hr
FROM SMS_Pairs
WHERE direction = 'Inbound' 
  AND next_direction = 'Outbound'  -- SGA responded to lead's message
GROUP BY SGA_Owner_Name__c
ORDER BY avg_response_minutes;
```
**Critical**: Research shows responding within 1 hour yields 17.2% MQL rate vs 2.5% for 16-24 hour delays.

**Answer:**
- **Calculation**: Use LEAD() over lead_id (Full_prospect_id__c or task_who_id) ordered by task_created_date_utc; filter direction = 'Inbound' AND next_direction = 'Outbound'; TIMESTAMP_DIFF(next_ts, activity_timestamp, MINUTE). Use **Tableau_Views.vw_sga_activity_performance** and activity_channel = 'SMS'.
- **Sample (last 90d)**: Perry Kalmeta — 233 response opportunities, avg response 939 min (~15.6 hr), 185 within 1 hr, 48 over 1 hr. Research: &lt;1 hr → 17.2% MQL vs 16–24 hr → 2.5%; Coach AI should surface “response within 1 hr” rate and slow-response examples from `sms_weekly_metrics_daily.slow_response_details`.

---

## 12.3 Link Violations
**Goal**: Identify SGAs sending links in first SMS (reduces MQL by 81%)

**Q12.3.1**: Is there a way to detect links in first SMS messages?
```sql
-- Check if Task table has message content
SELECT 
  Description,
  Subject,
  -- Look for URL patterns
  REGEXP_CONTAINS(COALESCE(Description, ''), r'https?://|www\.') AS has_link
FROM `savvy-gtm-analytics.SavvyGTMData.Task`
WHERE Subject LIKE '%SMS%'
LIMIT 10;
```
If Task table has SMS content, we can identify link violations.

**Answer:**
- **Yes.** `SavvyGTMData.Task` has `Description` (message content) and `Subject`. Use `REGEXP_CONTAINS(COALESCE(Description, ''), r'https?://|www\\.')` to flag links. Sample: Subject 'Outgoing SMS', Description contains message text (no link in sample). Last 90d: 54,506 SMS tasks, 1,615 with link (~3%). Filter by Subject/Type like '%SMS%' and first-outbound per lead to get “first SMS with link” for link-violation rate by SGA.

**Q12.3.2**: Can we calculate link violation rate by SGA for coaching?
```sql
-- Count first SMS messages with links per SGA (if data available)
-- This query depends on Q12.3.1 findings
```

**Answer:**
- **Option A**: Join Task (Subject/Type SMS, Description with REGEXP link) to first-outbound per lead/SGA (ROW_NUMBER by lead, ORDER BY CreatedDate), then count where rn=1 and has_link; group by SGA for rate. **Option B**: Use **`savvy_analytics.sms_weekly_metrics_daily`** which already has `link_violation_count` per SGA per report period (e.g. Brian O'Hara: 1 in latest report). Prefer B for Coach AI to avoid re-computing.

---

## 12.4 Intent Classification Data
**Goal**: Check if SMS intent classification data exists from the analysis

**Q12.4.1**: Does the `sms_intent_map` table exist and what does it contain?
```sql
-- Check if intent classification table exists
SELECT column_name, data_type
FROM `savvy-gtm-analytics.savvy_analytics.INFORMATION_SCHEMA.COLUMN_FIELD_PATHS`
WHERE table_name = 'sms_intent_map';
```

**Answer:**
- **sms_intent_map**: Does **not** exist in `savvy_analytics`. Table list shows `sms_weekly_metrics_daily` but no `sms_intent_map`. Intent classification from the SMS analysis is not present as a BigQuery table; would need to be built (e.g. from Task Description + model) or sourced elsewhere.

**Q12.4.2**: If intent data exists, what is the distribution by SGA?
```sql
-- Intent distribution by SGA (if table exists)
SELECT 
  sga_name,
  intent,
  COUNT(*) AS count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(PARTITION BY sga_name), 1) AS pct
FROM `savvy-gtm-analytics.savvy_analytics.sms_intent_map`
GROUP BY sga_name, intent
ORDER BY sga_name, count DESC;
```

**Answer:**
- **N/A** — `sms_intent_map` does not exist. If intent data is added later, the distribution query in the doc can be run; until then, Coach AI cannot use intent-by-SGA from BigQuery.

---

## 12.5 AM/PM Bookend Strategy
**Goal**: Identify SGAs using the bookend strategy (60% higher reply rates)

**Q12.5.1**: Can we identify same-day AM/PM follow-up patterns?
```sql
WITH First_Texts AS (
  SELECT 
    SGA_Owner_Name__c,
    lead_id,
    DATE(activity_timestamp) AS sms_date,
    MIN(activity_timestamp) AS first_sms_time,
    MAX(activity_timestamp) AS last_sms_time,
    COUNT(*) AS texts_that_day,
    EXTRACT(HOUR FROM MIN(activity_timestamp)) AS first_hour,
    EXTRACT(HOUR FROM MAX(activity_timestamp)) AS last_hour
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
  WHERE activity_type = 'SMS'
    AND direction = 'Outbound'
    AND activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz', 'Eric Uchoa')
  GROUP BY SGA_Owner_Name__c, lead_id, DATE(activity_timestamp)
)
SELECT 
  SGA_Owner_Name__c,
  COUNT(*) AS total_first_contact_days,
  SUM(CASE 
    WHEN texts_that_day >= 2 
    AND first_hour BETWEEN 8 AND 10 
    AND last_hour BETWEEN 17 AND 19 
    THEN 1 ELSE 0 
  END) AS bookend_strategy_used,
  ROUND(SUM(CASE 
    WHEN texts_that_day >= 2 
    AND first_hour BETWEEN 8 AND 10 
    AND last_hour BETWEEN 17 AND 19 
    THEN 1 ELSE 0 
  END) * 100.0 / COUNT(*), 1) AS bookend_pct
FROM First_Texts
WHERE texts_that_day <= 3  -- First contact day (not ongoing conversations)
GROUP BY SGA_Owner_Name__c
ORDER BY bookend_pct DESC;
```

**Answer:**
- **Logic**: First-contact days (per SGA, lead, date) with outbound SMS; bookend = texts_that_day ≥ 2 AND first_hour 8–10 AND last_hour 17–19 (EST). Use `task_created_date_utc` and EXTRACT(HOUR FROM DATETIME(..., 'America/New_York')). Filter activity_channel = 'SMS', direction = 'Outbound', task_activity_date last 90d, exclude Eric Uchoa and test names.
- **Sample**: Ryan Crandall 4,128 first-contact days, 0 bookend_used, 0% (first row). **Pre-built**: `sms_weekly_metrics_daily` has `bookend_count` and `bookend_adherence_rate` per SGA (e.g. Brian O'Hara 113 bookend, 70.2% adherence). Use that table for Coach AI.

---

## 12.6 Golden Hour Timing
**Goal**: Track if SGAs send first texts during optimal window (8-10 AM local time)

**Q12.6.1**: What percentage of first texts are sent in the golden window by SGA?
```sql
-- Note: This assumes timezone correction is available or uses server time as proxy
WITH First_Texts AS (
  SELECT 
    SGA_Owner_Name__c,
    lead_id,
    MIN(activity_timestamp) AS first_sms_time,
    EXTRACT(HOUR FROM MIN(activity_timestamp)) AS first_hour
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
  WHERE activity_type = 'SMS'
    AND direction = 'Outbound'
    AND activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz', 'Eric Uchoa')
  GROUP BY SGA_Owner_Name__c, lead_id
)
SELECT 
  SGA_Owner_Name__c,
  COUNT(*) AS total_first_texts,
  SUM(CASE WHEN first_hour BETWEEN 8 AND 10 THEN 1 ELSE 0 END) AS golden_window_texts,
  ROUND(SUM(CASE WHEN first_hour BETWEEN 8 AND 10 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS golden_window_pct
FROM First_Texts
GROUP BY SGA_Owner_Name__c
ORDER BY golden_window_pct DESC;
```

**Answer:**
- **Logic**: First outbound SMS per lead (MIN(task_created_date_utc)); EXTRACT(HOUR FROM DATETIME(..., 'America/New_York')) BETWEEN 8 AND 10 = golden window. Use Tableau_Views.vw_sga_activity_performance, activity_channel = 'SMS', direction = 'Outbound', last 90d.
- **Sample**: Holly Huffman 1,110 first texts, 65 in 8–10 AM (5.9%). **Pre-built**: `sms_weekly_metrics_daily` has `golden_window_adherence_rate` and `golden_window_fail_count` (e.g. Brian O'Hara 31.7% adherence, 299 fail count). Use for Coach AI.

---

# PHASE 13: Persistence Patterns

## 13.1 Text Count Distribution
**Goal**: Identify SGAs who over-text (persistence cliff at text 3)

**Q13.1.1**: What is the text count distribution by SGA for non-responsive leads?
```sql
WITH Lead_Text_Counts AS (
  SELECT 
    SGA_Owner_Name__c,
    lead_id,
    COUNT(*) AS outbound_texts,
    MAX(CASE WHEN direction = 'Inbound' THEN 1 ELSE 0 END) AS got_reply
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
  WHERE activity_type = 'SMS'
    AND activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz', 'Eric Uchoa')
  GROUP BY SGA_Owner_Name__c, lead_id
)
SELECT 
  SGA_Owner_Name__c,
  SUM(CASE WHEN got_reply = 0 AND outbound_texts > 2 THEN 1 ELSE 0 END) AS over_texted_no_reply,
  SUM(CASE WHEN got_reply = 0 THEN 1 ELSE 0 END) AS total_no_reply,
  ROUND(SUM(CASE WHEN got_reply = 0 AND outbound_texts > 2 THEN 1 ELSE 0 END) * 100.0 / 
        NULLIF(SUM(CASE WHEN got_reply = 0 THEN 1 ELSE 0 END), 0), 1) AS over_text_pct
FROM Lead_Text_Counts
GROUP BY SGA_Owner_Name__c
ORDER BY over_text_pct DESC;
```
**Context**: Research shows 59% decline in reply probability after text 2.

**Answer:**
- **Logic**: Per lead, count outbound SMS and whether any inbound (got_reply). Over-text = got_reply=0 AND outbound_texts > 2. Use Tableau_Views.vw_sga_activity_performance, activity_channel = 'SMS', last 90d, SGA = COALESCE(SGA_Owner_Name__c, task_executor_name), exclude Eric Uchoa and test names.
- **Sample**: Brian O'Hara 57.1% over-texted no reply (636 of 1,114 no-reply leads had >2 texts). Research: 59% decline after text 2; Coach AI can surface “% no-reply leads where you sent >2 texts” and recommend capping at 2–3.

---

# PHASE 14: SGA Behavioral Compliance Score

## 14.1 Composite Behavior Score
**Goal**: Calculate an overall behavioral compliance score per SGA

**Q14.1.1**: Can we create a composite "Behavior Score" similar to the SMS analysis?
Based on the SMS analysis report, the behavior score components are:
- SMS Coverage rate
- % Morning sends (golden window)
- % Fast response (within 30 min of lead assignment)
- Link violation rate (penalty)
- Bookend strategy usage

```sql
-- Build a composite behavior score
-- This is a template - adjust based on available data from previous questions
WITH SGA_Metrics AS (
  SELECT 
    SGA_Owner_Name__c AS sga_name,
    -- Add metrics from previous queries here
    COUNT(*) AS sample_size
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
  WHERE activity_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz', 'Eric Uchoa')
  GROUP BY SGA_Owner_Name__c
)
SELECT * FROM SGA_Metrics;
```

**Answer:**
- **Pre-built source**: Use **`savvy_analytics.sms_weekly_metrics_daily`** — it already has per-SGA: `initial_sms_last_7d`, `historical_weekly_avg`, `link_violation_count`, `bookend_count` / `bookend_adherence_rate`, `golden_window_fail_count` / `golden_window_adherence_rate`, `slow_response_details` (lead_id, mins, in_msg, out_msg), `self_sourced_coverage_rate`, `provided_list_coverage_rate`, `report_generated_date`, `last_7_days_start/end`. Composite score: weight SMS coverage, golden_window_adherence_rate, (1 − penalty for link_violation_count), bookend_adherence_rate, and fast-response rate (e.g. 1 − slow_response_count/opportunities). Response speed: derive from slow_response_details or from vw_sga_activity_performance LEAD() pattern. Exclude Eric Uchoa when joining to SGA list.

---

# PHASE 15: Lead Quality Controls

## 15.1 Lead Source Quality by SGA
**Goal**: Understand if SGAs get different quality leads (affects fair comparison)

**Q15.1.1**: What is the lead source distribution by SGA?
```sql
SELECT 
  SGA_Owner_Name__c,
  Channel_Grouping_Name,
  COUNT(*) AS lead_count,
  SUM(is_mql) AS mqls,
  ROUND(SUM(is_mql) * 100.0 / COUNT(*), 2) AS mql_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE stage_entered_contacting__c >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
  AND SGA_Owner_Name__c NOT IN ('Savvy Marketing', 'Corey Marcello', 'Bryan Belville', 'Anett Diaz', 'Eric Uchoa')
GROUP BY SGA_Owner_Name__c, Channel_Grouping_Name
ORDER BY SGA_Owner_Name__c, lead_count DESC;
```
**Use case**: If SGA X gets 80% Outbound leads while SGA Y gets 50% Inbound, their MQL rates aren't directly comparable.

**Answer:**
- **Query**: Use vw_funnel_master, filter stage_entered_contacting last 90d, SGA_Owner_Name__c NOT IN (test names, Eric Uchoa). Group by SGA_Owner_Name__c, Channel_Grouping_Name; COUNT(*), SUM(is_mql), rate = mqls/lead_count. Sample: Channing Guyer, Marketing, 2 leads, 0 MQL. Run full query in BigQuery for all SGAs/channels. **Use case**: If SGA X gets 80% Outbound vs SGA Y 50% Inbound, compare MQL rates within channel or use segment benchmarks (Phase 7).

---

# PHASE 16: Quarterly Goals Integration

## 16.1 Goals Data Location
**Goal**: Understand where quarterly goals are stored for comparison

**Q16.1.1**: Are quarterly goals stored in BigQuery or only in Prisma/PostgreSQL?

From the codebase analysis, goals are in Prisma. But check if there's a BigQuery sync:
```sql
-- Check for goals-related tables
SELECT table_name
FROM `savvy-gtm-analytics.savvy_analytics.INFORMATION_SCHEMA.TABLES`
WHERE LOWER(table_name) LIKE '%goal%';
```

**Answer:**
- **BigQuery**: `savvy_analytics.sga_qtly_goals_ext` exists (sga_name, sqo_goal, quarter_key, year_key); source is **Google Sheets** (external table). Query returned Access Denied (Drive credentials)—may need OAuth or service account with Drive access for Coach AI to read from BQ. If accessible, use for quarterly SQO goal vs actual.
- **Tables with 'goal'**: savvy_analytics has `sga_qtly_goals_ext`; no other goal tables in that dataset.

**Q16.1.2**: If goals are only in Prisma, Coach AI will need to fetch from PostgreSQL. Document the Prisma schema for goals (from codebase answers):
- `QuarterlyGoal`: userEmail, quarter, sqoGoal
- `WeeklyGoal`: userEmail, weekStartDate, initialCallsGoal, qualificationCallsGoal, sqoGoal

**Answer:**
- **Prisma (source of truth for app)**: QuarterlyGoal: userEmail, quarter, sqoGoal. WeeklyGoal: userEmail, weekStartDate, initialCallsGoal, qualificationCallsGoal, sqoGoal. Coach AI should **fetch goals from PostgreSQL/Prisma** for weekly and quarterly comparisons unless BQ `sga_qtly_goals_ext` is reliably accessible (Drive permission fixed). Use Prisma for SGA Hub parity; use BQ goals only if synced and accessible.

---

# PHASE 17: Data Freshness & Timing

## 17.1 Data Latency
**Goal**: Understand data freshness for weekly coaching generation

**Q17.1.1**: What is the typical data latency from Salesforce to BigQuery?
```sql
-- Check most recent record timestamps
SELECT 
  'vw_funnel_master' AS source,
  MAX(FilterDate) AS latest_record,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(FilterDate), HOUR) AS hours_ago
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
UNION ALL
SELECT 
  'vw_sga_activity_performance' AS source,
  MAX(activity_timestamp) AS latest_record,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(activity_timestamp), HOUR) AS hours_ago
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`;
```

**Answer:**
- **vw_funnel_master**: latest_record ~11 hours ago (e.g. 2026-02-01 04:33 UTC). **vw_sga_activity_performance**: latest_record ~5 hours ago (e.g. 2026-02-01 09:55 UTC). Activity is fresher than funnel. For weekly coaching generation, assume same-day or next-day freshness after overnight sync; document actual transfer schedule (e.g. from docs/DATA_FRESHNESS_FEATURE.md) for precise latency.

---

# SUMMARY OF FOLLOW-UP FINDINGS

## Key New Data Sources Identified
- **Tableau_Views.vw_sga_activity_performance**: Task-based activity with activity_channel ('SMS', 'Call', etc.), direction (Inbound/Outbound), task_activity_date, task_created_date_utc, SGA_Owner_Name__c / task_executor_name, Full_prospect_id__c / task_who_id. Use for SMS volume, response-time pairs, bookend/golden-window logic.
- **savvy_analytics.sms_weekly_metrics_daily**: Pre-aggregated SMS metrics per SGA per 7-day window: initial_sms_last_7d, bookend_count/adherence, golden_window adherence/fail, link_violation_count, slow_response_details (lead_id, mins, in_msg, out_msg), coverage rates. **Primary source for Coach AI SMS behavior.**
- **SavvyGTMData.Task**: Description has message content; REGEXP for links. Use for custom link-violation logic if not using sms_weekly_metrics_daily.
- **savvy_analytics.sga_qtly_goals_ext**: Quarterly goals (sga_name, sqo_goal, quarter_key, year_key) from Google Sheets; access may require Drive credentials.

## SMS Behavioral Metrics Available
- **From sms_weekly_metrics_daily**: SMS coverage (initial_sms_last_7d, historical_weekly_avg, team_avg_last_7d), bookend_adherence_rate, golden_window_adherence_rate, link_violation_count, slow_response_details (for “respond within 1 hr” coaching).
- **From vw_sga_activity_performance**: Response time (LEAD() Inbound→Outbound), over-text rate (no-reply leads with >2 outbound), first-text hour distribution. Exclude Eric Uchoa; use COALESCE(SGA_Owner_Name__c, task_executor_name) for SGA; activity_channel = 'SMS', task_activity_date.

## Data Gaps/Limitations
- **sms_intent_map**: Does not exist; intent classification not in BQ.
- **sga_qtly_goals_ext**: External Google Sheets; 403 on query—Coach AI may need to use Prisma for quarterly goals.
- **SGA attribution on activity**: Many activity rows have null SGA_Owner_Name__c; use task_executor_name as fallback for SMS-by-SGA.
- **Timezone**: Golden window 8–10 AM is EST (task_created_datetime_est / activity_hour_est in view).

## Recommended Additional Queries for Coach AI
1. **SMS behavior summary**: SELECT * FROM savvy_analytics.sms_weekly_metrics_daily WHERE report_generated_date = (SELECT MAX(report_generated_date) ...) AND sga_name NOT IN (..., 'Eric Uchoa').
2. **Response time by SGA**: LEAD() over lead_id, direction Inbound → next Outbound; avg/minutes, % within 60 min; from Tableau_Views.vw_sga_activity_performance, activity_channel = 'SMS'.
3. **Over-text rate by SGA**: Per lead, outbound count and got_reply; over_text_pct = no_reply AND outbound_texts > 2; from same view.
4. **Lead source by SGA**: vw_funnel_master, stage_entered_contacting last 90d, GROUP BY SGA_Owner_Name__c, Channel_Grouping_Name (exclude Eric Uchoa).
5. **Goals**: Prefer Prisma (QuarterlyGoal, WeeklyGoal); if BQ goals accessible, use sga_qtly_goals_ext for quarterly SQO goal vs actual.

---

*Follow-up questions created: 2026-02-01*
*Answers to be appended to: C:\Users\russe\Documents\Dashboard\Coach_AI_BQ_Questions.md*
