# Additional Phases for Lead List Touchpoint Exploration v2

**Add these phases to the end of the document (before the Run Log) to complete the analysis.**

**Key Goals These Phases Address:**
1. Do SGAs treat self-sourced leads differently from lead list leads?
2. What is the winning cadence of activities?
3. What is the winning sequence of activities?

---

# Phase 8: Data Quality Validation

**Goal**: Verify our methodology is sound — confirm we're counting true outbound touches and not accidentally including inbound or duplicate activities.

### Q8.1: Spot-check "Outbound" classification — sample task subjects by direction

```sql
WITH sample_tasks AS (
  SELECT 
    a.direction,
    a.activity_channel_group,
    a.task_subject,
    COUNT(*) AS occurrences
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.task_created_date_utc >= '2026-01-01'
  GROUP BY a.direction, a.activity_channel_group, a.task_subject
)
SELECT 
  direction,
  activity_channel_group,
  task_subject,
  occurrences
FROM sample_tasks
WHERE occurrences >= 10
ORDER BY direction, activity_channel_group, occurrences DESC
LIMIT 50
```

**Validation goal**: Review task subjects to confirm "Outbound" tasks are truly SGA-initiated (e.g., "Outgoing SMS", "Email sent", "Call - Left VM") and "Inbound" tasks are lead-initiated (e.g., "Incoming SMS", "Inbound Call").

**Answer:**

---

### Q8.2: Check for any remaining engagement/tracking tasks that might be miscounted

```sql
SELECT 
  a.activity_channel_group,
  a.direction,
  a.is_engagement_tracking,
  CASE 
    WHEN a.task_subject LIKE '%Clicked%' THEN 'Contains "Clicked"'
    WHEN a.task_subject LIKE '%Opened%' THEN 'Contains "Opened"'
    WHEN a.task_subject LIKE '%Viewed%' THEN 'Contains "Viewed"'
    WHEN a.task_subject LIKE '%Delivered%' THEN 'Contains "Delivered"'
    WHEN a.task_subject LIKE '%Bounced%' THEN 'Contains "Bounced"'
    ELSE 'Other'
  END AS subject_pattern,
  COUNT(*) AS task_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
WHERE a.task_created_date_utc >= '2026-01-01'
  AND a.activity_channel_group IS NOT NULL
GROUP BY 1, 2, 3, 4
HAVING task_count >= 5
ORDER BY task_count DESC
```

**Validation goal**: Confirm tasks with "Clicked", "Opened", "Viewed", "Delivered", "Bounced" are properly classified as Email (Engagement) or excluded.

**Answer:**

---

### Q8.3: Verify no duplicate task_ids in our touch counts

```sql
WITH jan_list_contacted AS (
  SELECT v.Full_prospect_id__c AS lead_id
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_contacted = 1
),
task_occurrences AS (
  SELECT 
    a.task_id,
    COUNT(*) AS times_appearing
  FROM jan_list_contacted j
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON j.lead_id = a.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
  GROUP BY a.task_id
)
SELECT 
  times_appearing,
  COUNT(*) AS num_task_ids,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 2) AS pct
FROM task_occurrences
GROUP BY times_appearing
ORDER BY times_appearing
```

**Validation goal**: Confirm nearly all task_ids appear exactly once (times_appearing = 1). Any duplicates indicate a join issue.

**Answer:**

---

# Phase 9: Self-Sourced vs List Leads (Goal 1)

**Goal**: Determine if SGAs treat self-sourced (LinkedIn) leads differently from scored list leads.

### Q9.1: Comprehensive comparison — List vs LinkedIn vs Old Unscored (Jan 2026 contacted)

```sql
WITH active_sgas AS (
  SELECT Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User`
  WHERE IsSGA__c = TRUE AND IsActive = TRUE
    AND Name NOT IN ('Anett Diaz', 'Jacqueline Tully', 'Savvy Operations', 'Savvy Marketing', 'Russell Moss', 'Jed Entin', 'Eric Uchoa')
),
leads_by_source AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.SGA_Owner_Name__c AS sga_name,
    v.is_mql,
    CASE
      WHEN EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
           OR v.Campaign_Id__c = '701VS00000ZtS4NYAV' THEN 'Scored Jan List'
      WHEN v.Original_source = 'LinkedIn (Self Sourced)' THEN 'LinkedIn (Self-Sourced)'
      WHEN v.Original_source = 'Provided List (Lead Scoring)' 
           AND (v.Lead_Score_Tier__c IS NULL OR TRIM(v.Lead_Score_Tier__c) = '') THEN 'Old Unscored List'
      ELSE 'Other'
    END AS lead_source
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  INNER JOIN active_sgas s ON v.SGA_Owner_Name__c = s.sga_name
  WHERE v.is_contacted = 1
    AND v.stage_entered_contacting__c >= '2026-01-01'
),
lead_activity AS (
  SELECT 
    l.lead_id,
    l.lead_source,
    l.is_mql,
    COUNT(DISTINCT CASE WHEN a.direction = 'Outbound' THEN a.task_id END) AS outbound_touches,
    COUNT(DISTINCT CASE WHEN a.direction = 'Inbound' THEN a.task_id END) AS inbound_touches,
    MAX(CASE WHEN a.direction = 'Inbound' THEN 1 ELSE 0 END) AS has_response,
    COUNT(DISTINCT a.activity_channel_group) AS channels_used
  FROM leads_by_source l
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON l.lead_id = a.Full_prospect_id__c
    AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
  WHERE l.lead_source != 'Other'
  GROUP BY l.lead_id, l.lead_source, l.is_mql
)
SELECT
  lead_source,
  COUNT(*) AS contacted_leads,
  ROUND(AVG(outbound_touches), 2) AS avg_outbound_touches,
  ROUND(AVG(channels_used), 2) AS avg_channels_used,
  ROUND(100.0 * SUM(has_response) / COUNT(*), 1) AS response_rate_pct,
  ROUND(100.0 * SUM(is_mql) / COUNT(*), 1) AS mql_rate_pct,
  SUM(is_mql) AS total_mqls
FROM lead_activity
GROUP BY lead_source
ORDER BY avg_outbound_touches DESC
```

**Interpretation goal**: Do list leads get more/fewer touches? Higher/lower response rates? Different MQL conversion?

**Answer:**

---

### Q9.2: Channel mix comparison — List vs LinkedIn

```sql
WITH active_sgas AS (
  SELECT Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User`
  WHERE IsSGA__c = TRUE AND IsActive = TRUE
    AND Name NOT IN ('Anett Diaz', 'Jacqueline Tully', 'Savvy Operations', 'Savvy Marketing', 'Russell Moss', 'Jed Entin', 'Eric Uchoa')
),
leads_by_source AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    CASE
      WHEN EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
           OR v.Campaign_Id__c = '701VS00000ZtS4NYAV' THEN 'Scored Jan List'
      WHEN v.Original_source = 'LinkedIn (Self Sourced)' THEN 'LinkedIn (Self-Sourced)'
      ELSE 'Other'
    END AS lead_source
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  INNER JOIN active_sgas s ON v.SGA_Owner_Name__c = s.sga_name
  WHERE v.is_contacted = 1
    AND v.stage_entered_contacting__c >= '2026-01-01'
),
channel_by_source AS (
  SELECT 
    l.lead_source,
    a.activity_channel_group AS channel,
    COUNT(DISTINCT a.task_id) AS touches
  FROM leads_by_source l
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON l.lead_id = a.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
    AND l.lead_source IN ('Scored Jan List', 'LinkedIn (Self-Sourced)')
  GROUP BY l.lead_source, a.activity_channel_group
)
SELECT
  lead_source,
  channel,
  touches,
  ROUND(100.0 * touches / SUM(touches) OVER(PARTITION BY lead_source), 1) AS pct_of_source
FROM channel_by_source
ORDER BY lead_source, touches DESC
```

**Interpretation goal**: Do SGAs use different channels for list leads vs LinkedIn leads? (e.g., more SMS for list, more LinkedIn messages for self-sourced?)

**Answer:**

---

### Q9.3: Same-SGA comparison — Do individual SGAs treat sources differently?

```sql
WITH active_sgas AS (
  SELECT Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User`
  WHERE IsSGA__c = TRUE AND IsActive = TRUE
    AND Name NOT IN ('Anett Diaz', 'Jacqueline Tully', 'Savvy Operations', 'Savvy Marketing', 'Russell Moss', 'Jed Entin', 'Eric Uchoa')
),
leads_by_source AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.SGA_Owner_Name__c AS sga_name,
    CASE
      WHEN EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
           OR v.Campaign_Id__c = '701VS00000ZtS4NYAV' THEN 'Scored Jan List'
      WHEN v.Original_source = 'LinkedIn (Self Sourced)' THEN 'LinkedIn'
      ELSE 'Other'
    END AS lead_source
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  INNER JOIN active_sgas s ON v.SGA_Owner_Name__c = s.sga_name
  WHERE v.is_contacted = 1
    AND v.stage_entered_contacting__c >= '2026-01-01'
),
sga_source_touches AS (
  SELECT 
    l.sga_name,
    l.lead_source,
    l.lead_id,
    COUNT(DISTINCT a.task_id) AS touches
  FROM leads_by_source l
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON l.lead_id = a.Full_prospect_id__c
    AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
  WHERE l.lead_source IN ('Scored Jan List', 'LinkedIn')
  GROUP BY l.sga_name, l.lead_source, l.lead_id
)
SELECT
  sga_name,
  lead_source,
  COUNT(*) AS leads,
  ROUND(AVG(touches), 2) AS avg_touches
FROM sga_source_touches
GROUP BY sga_name, lead_source
HAVING COUNT(*) >= 5  -- Only SGAs with 5+ leads in that source
ORDER BY sga_name, lead_source
```

**Interpretation goal**: For each SGA, compare their avg touches on List vs LinkedIn. Large gaps indicate differential treatment.

**Answer:**

---

# Phase 10: Winning Cadence Analysis (Goal 2)

**Goal**: Identify the optimal timing/frequency of touches that correlates with MQL conversion.

### Q10.1: Time from first touch to MQL (for MQLs)

```sql
WITH jan_list_mqls AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.mql_stage_entered_ts
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_mql = 1
),
first_touch AS (
  SELECT 
    m.lead_id,
    m.mql_stage_entered_ts,
    MIN(a.task_created_date_utc) AS first_outbound_touch
  FROM jan_list_mqls m
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON m.lead_id = a.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
  GROUP BY m.lead_id, m.mql_stage_entered_ts
)
SELECT
  COUNT(*) AS mqls_with_activity,
  ROUND(AVG(TIMESTAMP_DIFF(mql_stage_entered_ts, first_outbound_touch, DAY)), 1) AS avg_days_to_mql,
  APPROX_QUANTILES(TIMESTAMP_DIFF(mql_stage_entered_ts, first_outbound_touch, DAY), 100)[OFFSET(50)] AS median_days_to_mql,
  MIN(TIMESTAMP_DIFF(mql_stage_entered_ts, first_outbound_touch, DAY)) AS min_days,
  MAX(TIMESTAMP_DIFF(mql_stage_entered_ts, first_outbound_touch, DAY)) AS max_days
FROM first_touch
WHERE mql_stage_entered_ts >= first_outbound_touch  -- MQL after first touch
```

**Interpretation goal**: How long does it typically take from first outbound touch to MQL?

**Answer:**

---

### Q10.2: Average days between touches — MQLs vs Non-MQLs

```sql
WITH active_sgas AS (
  SELECT Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User`
  WHERE IsSGA__c = TRUE AND IsActive = TRUE
    AND Name NOT IN ('Anett Diaz', 'Jacqueline Tully', 'Savvy Operations', 'Savvy Marketing', 'Russell Moss', 'Jed Entin', 'Eric Uchoa')
),
jan_list_contacted AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.is_mql
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  INNER JOIN active_sgas s ON v.SGA_Owner_Name__c = s.sga_name
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_contacted = 1
),
sequenced_outbound AS (
  SELECT
    j.lead_id,
    j.is_mql,
    a.task_created_date_utc,
    LAG(a.task_created_date_utc) OVER(PARTITION BY j.lead_id ORDER BY a.task_created_date_utc) AS prev_touch_ts
  FROM jan_list_contacted j
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON j.lead_id = a.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
),
touch_gaps AS (
  SELECT
    lead_id,
    is_mql,
    TIMESTAMP_DIFF(task_created_date_utc, prev_touch_ts, HOUR) / 24.0 AS days_since_prev_touch
  FROM sequenced_outbound
  WHERE prev_touch_ts IS NOT NULL
)
SELECT
  CASE WHEN is_mql = 1 THEN 'MQL' ELSE 'Non-MQL' END AS segment,
  COUNT(*) AS touch_gaps,
  ROUND(AVG(days_since_prev_touch), 2) AS avg_days_between_touches,
  APPROX_QUANTILES(days_since_prev_touch, 100)[OFFSET(50)] AS median_days_between_touches,
  ROUND(AVG(CASE WHEN days_since_prev_touch <= 1 THEN 1 ELSE 0 END) * 100, 1) AS pct_within_24hrs,
  ROUND(AVG(CASE WHEN days_since_prev_touch <= 7 THEN 1 ELSE 0 END) * 100, 1) AS pct_within_7days
FROM touch_gaps
GROUP BY is_mql
ORDER BY is_mql DESC
```

**Interpretation goal**: Are MQLs touched more frequently (shorter gaps) than non-MQLs?

**Answer:**

---

### Q10.3: Touch velocity in first 7 days — MQLs vs Non-MQLs

```sql
WITH jan_list_contacted AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.is_mql,
    v.stage_entered_contacting__c AS contacted_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_contacted = 1
),
first_week_touches AS (
  SELECT
    j.lead_id,
    j.is_mql,
    COUNT(DISTINCT a.task_id) AS touches_in_first_7_days
  FROM jan_list_contacted j
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON j.lead_id = a.Full_prospect_id__c
    AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
    AND DATE(a.task_created_date_utc) BETWEEN DATE(j.contacted_date) AND DATE_ADD(DATE(j.contacted_date), INTERVAL 7 DAY)
  GROUP BY j.lead_id, j.is_mql
)
SELECT
  CASE WHEN is_mql = 1 THEN 'MQL' ELSE 'Non-MQL' END AS segment,
  COUNT(*) AS leads,
  ROUND(AVG(touches_in_first_7_days), 2) AS avg_touches_first_7_days,
  APPROX_QUANTILES(touches_in_first_7_days, 100)[OFFSET(50)] AS median_touches_first_7_days
FROM first_week_touches
GROUP BY is_mql
ORDER BY is_mql DESC
```

**Interpretation goal**: Do MQLs receive more intensive early outreach (higher velocity in week 1)?

**Answer:**

---

### Q10.4: Optimal touch count buckets — MQL rate by # of touches

```sql
WITH jan_list_contacted AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.is_mql
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_contacted = 1
),
lead_touches AS (
  SELECT
    j.lead_id,
    j.is_mql,
    COUNT(DISTINCT a.task_id) AS total_touches
  FROM jan_list_contacted j
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON j.lead_id = a.Full_prospect_id__c
    AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
  GROUP BY j.lead_id, j.is_mql
)
SELECT
  CASE 
    WHEN total_touches = 0 THEN '0 touches'
    WHEN total_touches BETWEEN 1 AND 2 THEN '1-2 touches'
    WHEN total_touches BETWEEN 3 AND 5 THEN '3-5 touches'
    WHEN total_touches BETWEEN 6 AND 10 THEN '6-10 touches'
    ELSE '11+ touches'
  END AS touch_bucket,
  COUNT(*) AS leads,
  SUM(is_mql) AS mqls,
  ROUND(100.0 * SUM(is_mql) / COUNT(*), 2) AS mql_rate_pct
FROM lead_touches
GROUP BY 1
ORDER BY 
  CASE 
    WHEN total_touches = 0 THEN 1
    WHEN total_touches BETWEEN 1 AND 2 THEN 2
    WHEN total_touches BETWEEN 3 AND 5 THEN 3
    WHEN total_touches BETWEEN 6 AND 10 THEN 4
    ELSE 5
  END
```

**Interpretation goal**: Is there a "sweet spot" number of touches that maximizes MQL rate? (e.g., 6-10 touches = highest conversion?)

**Answer:**

---

# Phase 11: Winning Sequence Analysis (Goal 3)

**Goal**: Identify the optimal sequence/order of channels that correlates with MQL conversion and response.

### Q11.1: First touch channel — MQLs vs Non-MQLs

```sql
WITH jan_list_contacted AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.is_mql
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_contacted = 1
),
first_touch AS (
  SELECT
    j.lead_id,
    j.is_mql,
    a.activity_channel_group AS first_channel,
    ROW_NUMBER() OVER(PARTITION BY j.lead_id ORDER BY a.task_created_date_utc) AS rn
  FROM jan_list_contacted j
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON j.lead_id = a.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
)
SELECT
  first_channel,
  COUNT(*) AS leads_with_this_first_touch,
  SUM(is_mql) AS mqls,
  ROUND(100.0 * SUM(is_mql) / COUNT(*), 2) AS mql_rate_pct
FROM first_touch
WHERE rn = 1
GROUP BY first_channel
ORDER BY leads_with_this_first_touch DESC
```

**Interpretation goal**: Does the first touch channel matter? (e.g., leads whose first touch is a Call convert at higher rates than SMS-first?)

**Answer:**

---

### Q11.2: "Breakthrough" channel — Which channel gets the first response?

```sql
WITH jan_list_contacted AS (
  SELECT v.Full_prospect_id__c AS lead_id
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_contacted = 1
),
sequenced_activities AS (
  SELECT
    j.lead_id,
    a.task_id,
    a.activity_channel_group,
    a.direction,
    a.task_created_date_utc,
    ROW_NUMBER() OVER(PARTITION BY j.lead_id ORDER BY a.task_created_date_utc) AS seq
  FROM jan_list_contacted j
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON j.lead_id = a.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
),
first_inbound AS (
  SELECT 
    lead_id, 
    activity_channel_group AS response_channel,
    seq AS response_seq
  FROM sequenced_activities
  WHERE direction = 'Inbound'
  QUALIFY ROW_NUMBER() OVER(PARTITION BY lead_id ORDER BY seq) = 1
),
last_outbound_before_response AS (
  SELECT 
    s.lead_id,
    s.activity_channel_group AS breakthrough_channel
  FROM sequenced_activities s
  INNER JOIN first_inbound f ON s.lead_id = f.lead_id AND s.seq = f.response_seq - 1
  WHERE s.direction = 'Outbound'
)
SELECT
  breakthrough_channel,
  COUNT(*) AS times_preceded_first_response,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct_of_breakthroughs
FROM last_outbound_before_response
GROUP BY breakthrough_channel
ORDER BY times_preceded_first_response DESC
```

**Interpretation goal**: Which outbound channel most often immediately precedes the first inbound response? This is the "breakthrough" channel.

**Answer:**

---

### Q11.3: Multi-channel vs single-channel — MQL rates

```sql
WITH jan_list_contacted AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.is_mql
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_contacted = 1
),
lead_channel_diversity AS (
  SELECT
    j.lead_id,
    j.is_mql,
    COUNT(DISTINCT a.activity_channel_group) AS distinct_channels_used,
    STRING_AGG(DISTINCT a.activity_channel_group, ', ' ORDER BY a.activity_channel_group) AS channels_list
  FROM jan_list_contacted j
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON j.lead_id = a.Full_prospect_id__c
    AND a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
  GROUP BY j.lead_id, j.is_mql
)
SELECT
  CASE 
    WHEN distinct_channels_used = 0 THEN '0 channels (no outbound)'
    WHEN distinct_channels_used = 1 THEN '1 channel (single)'
    WHEN distinct_channels_used = 2 THEN '2 channels'
    ELSE '3+ channels'
  END AS channel_diversity,
  COUNT(*) AS leads,
  SUM(is_mql) AS mqls,
  ROUND(100.0 * SUM(is_mql) / COUNT(*), 2) AS mql_rate_pct
FROM lead_channel_diversity
GROUP BY 1
ORDER BY 
  CASE 
    WHEN distinct_channels_used = 0 THEN 1
    WHEN distinct_channels_used = 1 THEN 2
    WHEN distinct_channels_used = 2 THEN 3
    ELSE 4
  END
```

**Interpretation goal**: Do leads touched via multiple channels convert at higher rates? (Multi-channel = more effective?)

**Answer:**

---

### Q11.4: Common 2-touch sequences for MQLs

```sql
WITH jan_list_mqls AS (
  SELECT v.Full_prospect_id__c AS lead_id
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_mql = 1
),
sequenced_outbound AS (
  SELECT
    m.lead_id,
    a.activity_channel_group AS channel,
    ROW_NUMBER() OVER(PARTITION BY m.lead_id ORDER BY a.task_created_date_utc) AS touch_num
  FROM jan_list_mqls m
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON m.lead_id = a.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
),
touch_pairs AS (
  SELECT
    t1.lead_id,
    t1.channel AS touch_1,
    t2.channel AS touch_2
  FROM sequenced_outbound t1
  INNER JOIN sequenced_outbound t2 ON t1.lead_id = t2.lead_id AND t2.touch_num = t1.touch_num + 1
  WHERE t1.touch_num = 1  -- First two touches only
)
SELECT
  touch_1 || ' → ' || touch_2 AS sequence,
  COUNT(*) AS mql_leads_with_this_sequence,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER(), 1) AS pct_of_mqls
FROM touch_pairs
GROUP BY touch_1, touch_2
ORDER BY mql_leads_with_this_sequence DESC
LIMIT 10
```

**Interpretation goal**: What are the most common opening sequences (touch 1 → touch 2) for leads that became MQLs?

**Answer:**

---

### Q11.5: Sequence comparison — MQLs vs Non-MQLs (first 3 touches)

```sql
WITH jan_list_contacted AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.is_mql
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_contacted = 1
),
sequenced_outbound AS (
  SELECT
    j.lead_id,
    j.is_mql,
    a.activity_channel_group AS channel,
    ROW_NUMBER() OVER(PARTITION BY j.lead_id ORDER BY a.task_created_date_utc) AS touch_num
  FROM jan_list_contacted j
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON j.lead_id = a.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
),
first_three AS (
  SELECT
    lead_id,
    is_mql,
    MAX(CASE WHEN touch_num = 1 THEN channel END) AS touch_1,
    MAX(CASE WHEN touch_num = 2 THEN channel END) AS touch_2,
    MAX(CASE WHEN touch_num = 3 THEN channel END) AS touch_3
  FROM sequenced_outbound
  WHERE touch_num <= 3
  GROUP BY lead_id, is_mql
),
sequences AS (
  SELECT
    is_mql,
    CONCAT(
      COALESCE(touch_1, '?'), ' → ', 
      COALESCE(touch_2, '?'), ' → ', 
      COALESCE(touch_3, '?')
    ) AS sequence_3
  FROM first_three
  WHERE touch_1 IS NOT NULL
)
SELECT
  sequence_3,
  COUNT(*) AS total_leads,
  SUM(is_mql) AS mqls,
  ROUND(100.0 * SUM(is_mql) / COUNT(*), 2) AS mql_rate_pct
FROM sequences
GROUP BY sequence_3
HAVING COUNT(*) >= 10  -- Only sequences with 10+ leads
ORDER BY mql_rate_pct DESC
LIMIT 15
```

**Interpretation goal**: Which 3-touch sequences have the highest MQL conversion rates?

**Answer:**

---

### Q11.6: Does a Call in the first 3 touches improve MQL rate?

```sql
WITH jan_list_contacted AS (
  SELECT 
    v.Full_prospect_id__c AS lead_id,
    v.is_mql
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE (
    EXISTS (SELECT 1 FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = '701VS00000ZtS4NYAV')
    OR v.Campaign_Id__c = '701VS00000ZtS4NYAV'
  )
  AND v.is_contacted = 1
),
sequenced_outbound AS (
  SELECT
    j.lead_id,
    j.is_mql,
    a.activity_channel_group AS channel,
    ROW_NUMBER() OVER(PARTITION BY j.lead_id ORDER BY a.task_created_date_utc) AS touch_num
  FROM jan_list_contacted j
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
    ON j.lead_id = a.Full_prospect_id__c
  WHERE a.activity_channel_group NOT IN ('Marketing', 'Other', 'Email (Engagement)')
    AND a.activity_channel_group IS NOT NULL
    AND a.direction = 'Outbound'
),
leads_with_early_call AS (
  SELECT
    lead_id,
    is_mql,
    MAX(CASE WHEN touch_num <= 3 AND channel = 'Call' THEN 1 ELSE 0 END) AS has_call_in_first_3
  FROM sequenced_outbound
  GROUP BY lead_id, is_mql
)
SELECT
  CASE WHEN has_call_in_first_3 = 1 THEN 'Has Call in first 3 touches' ELSE 'No Call in first 3 touches' END AS segment,
  COUNT(*) AS leads,
  SUM(is_mql) AS mqls,
  ROUND(100.0 * SUM(is_mql) / COUNT(*), 2) AS mql_rate_pct
FROM leads_with_early_call
GROUP BY has_call_in_first_3
ORDER BY has_call_in_first_3 DESC
```

**Interpretation goal**: Does including a Call early in the sequence improve outcomes?

**Answer:**

---

# Phase 12: Synthesis & Recommendations

### Q12.1: Executive Summary

After completing Phases 8-11, synthesize findings into actionable recommendations:

1. **Self-Sourced vs List Leads**: Do SGAs treat them differently? Should they?
2. **Winning Cadence**: What touch frequency/velocity correlates with MQL conversion?
3. **Winning Sequence**: What channel order works best?

**Answer:**

---

### Q12.2: Recommended SGA Playbook

Based on the data, what should the "ideal" outreach cadence look like?

| Element | Recommendation | Supporting Data |
|---------|----------------|-----------------|
| **First touch** | ___ | Q11.1 |
| **Touches in first 7 days** | ___ | Q10.3 |
| **Total touches before stopping** | ___ | Q10.4 |
| **Channel mix** | ___ | Q11.3 |
| **Include a Call by touch #** | ___ | Q11.6 |
| **Days between touches** | ___ | Q10.2 |

**Answer:**

---

*Add these phases to the document and update the Run Log when complete.*
