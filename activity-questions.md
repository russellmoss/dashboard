# BigQuery Investigation Questions for SGA Activity Dashboard

**Purpose**: These queries should be run via Cursor.ai's MCP connection to BigQuery to gather the data structure and availability information needed to build the SGA Manager Activity Dashboard.

---

## Section 1: vw_sga_activity_performance View Schema

The TASK_OBJECT_DETAILS.md references `vw_sga_activity_performance` as the production view for activity data. We need to understand its full schema.

### Query 1.1: Get Full Schema of vw_sga_activity_performance

```sql
SELECT 
  column_name,
  data_type,
  is_nullable
FROM `savvy-gtm-analytics.savvy_analytics.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_sga_activity_performance'
ORDER BY ordinal_position;
```

**What we need to know:**
- Full list of available fields
- Confirm `activity_channel`, `direction`, `is_true_cold_call`, `task_executor_name` exist
- Check for any SMS-specific fields
- Check for any response/reply tracking fields

### Query 1.2: Sample Records from vw_sga_activity_performance

```sql
SELECT *
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
LIMIT 10;
```

**What we need to know:**
- Sample data structure
- Field value examples

---

## Section 2: Activity Channel Distribution

### Query 2.1: Distinct Activity Channels

```sql
SELECT 
  activity_channel,
  COUNT(*) as task_count,
  COUNT(DISTINCT task_executor_name) as unique_sgas
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY activity_channel
ORDER BY task_count DESC;
```

**What we need to know:**
- All available activity channel categories
- Confirm we have: Call, Outgoing SMS, Incoming SMS, LinkedIn, Email
- Volume distribution

### Query 2.2: Activity Distribution by Day of Week (Historical Baseline)

```sql
SELECT 
  EXTRACT(DAYOFWEEK FROM task_created_date_est) as day_of_week,
  FORMAT_DATE('%A', task_created_date_est) as day_name,
  activity_channel,
  COUNT(*) as activity_count,
  COUNT(DISTINCT task_executor_name) as unique_sgas
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  AND task_created_date_est < CURRENT_DATE()  -- Exclude today for clean baselines
GROUP BY day_of_week, day_name, activity_channel
ORDER BY day_of_week, activity_channel;
```

**What we need to know:**
- Historical activity patterns by day of week
- Baseline for "expected" distribution

---

## Section 3: SMS Response Rate Analysis

### Query 3.1: SMS Types and Pairing Potential

```sql
SELECT 
  activity_channel,
  direction,
  COUNT(*) as count
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE activity_channel IN ('Outgoing SMS', 'Incoming SMS', 'SMS')
  OR activity_channel LIKE '%SMS%'
GROUP BY activity_channel, direction
ORDER BY count DESC;
```

**What we need to know:**
- How SMS activities are categorized
- Whether Incoming vs Outgoing is tracked separately or via direction field

### Query 3.2: SMS Lead-Level Response Tracking

```sql
-- Check if we can pair outgoing SMS to incoming responses at the lead level
SELECT 
  COUNT(DISTINCT whoid) as leads_with_outgoing_sms,
  COUNT(DISTINCT CASE 
    WHEN activity_channel = 'Incoming SMS' 
    OR (activity_channel = 'SMS' AND direction = 'Inbound')
    THEN whoid 
  END) as leads_with_incoming_sms
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY);
```

**What we need to know:**
- Can we match outgoing SMS to leads?
- Can we track which leads responded?

### Query 3.3: SMS Response Rate by Time Period

```sql
WITH outgoing AS (
  SELECT 
    DATE_TRUNC(task_created_date_est, WEEK) as week_start,
    COUNT(DISTINCT whoid) as leads_texted
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
  WHERE (activity_channel = 'Outgoing SMS' 
    OR (activity_channel LIKE '%SMS%' AND direction = 'Outbound'))
    AND task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  GROUP BY week_start
),
incoming AS (
  SELECT 
    DATE_TRUNC(task_created_date_est, WEEK) as week_start,
    COUNT(DISTINCT whoid) as leads_responded
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
  WHERE (activity_channel = 'Incoming SMS' 
    OR (activity_channel LIKE '%SMS%' AND direction = 'Inbound'))
    AND task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
  GROUP BY week_start
)
SELECT 
  o.week_start,
  o.leads_texted,
  COALESCE(i.leads_responded, 0) as leads_responded,
  SAFE_DIVIDE(COALESCE(i.leads_responded, 0), o.leads_texted) as response_rate
FROM outgoing o
LEFT JOIN incoming i ON o.week_start = i.week_start
ORDER BY o.week_start;
```

**What we need to know:**
- Can we calculate response rates at weekly granularity?
- Is the data quality sufficient?

---

## Section 4: Call Answer Rate Analysis

### Query 4.1: Call Disposition Values

```sql
SELECT 
  CallDisposition,
  COUNT(*) as call_count,
  AVG(CallDurationInSeconds) as avg_duration
FROM `savvy-gtm-analytics.SavvyGTMData.Task`
WHERE Type = 'Call'
  AND CallDisposition IS NOT NULL
  AND (IsDeleted = FALSE OR IsDeleted IS NULL)
  AND CreatedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY CallDisposition
ORDER BY call_count DESC;
```

**What we need to know:**
- All possible CallDisposition values
- Which values indicate "answered" vs "not answered"
- Can we calculate answer rates?

### Query 4.2: Call Disposition in Activity View

```sql
-- Check if CallDisposition is available in the activity view
SELECT 
  activity_channel,
  direction,
  call_type,  -- May or may not exist
  COUNT(*) as count
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE activity_channel = 'Call'
GROUP BY activity_channel, direction, call_type
ORDER BY count DESC;
```

**What we need to know:**
- How calls are categorized in the activity view
- Is there a call outcome/disposition field?

### Query 4.3: Outbound Call Answer Rate

```sql
SELECT 
  DATE_TRUNC(DATE(CreatedDate, 'America/New_York'), WEEK) as week_start,
  COUNT(*) as total_outbound_calls,
  COUNTIF(CallDurationInSeconds > 0 OR CallDisposition LIKE '%answer%' OR CallDisposition LIKE '%connect%') as answered_calls,
  SAFE_DIVIDE(
    COUNTIF(CallDurationInSeconds > 0 OR CallDisposition LIKE '%answer%' OR CallDisposition LIKE '%connect%'),
    COUNT(*)
  ) as answer_rate
FROM `savvy-gtm-analytics.SavvyGTMData.Task`
WHERE Type = 'Call'
  AND (IsDeleted = FALSE OR IsDeleted IS NULL)
  AND NOT (
    Subject LIKE '%Incoming%'
    OR Subject LIKE '%Inbound%'
  )
  AND CreatedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)
GROUP BY week_start
ORDER BY week_start;
```

**What we need to know:**
- Can we reliably identify answered vs unanswered calls?
- What's the data quality for answer rate calculation?

---

## Section 5: Initial Calls Scheduled

### Query 5.1: Initial Calls Scheduled for Upcoming Weeks

```sql
SELECT 
  Initial_Call_Scheduled_Date__c as scheduled_date,
  COUNT(DISTINCT primary_key) as initial_calls_count,
  COUNT(DISTINCT SGA_Owner_Name__c) as sgas_with_calls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Initial_Call_Scheduled_Date__c IS NOT NULL
  AND Initial_Call_Scheduled_Date__c >= CURRENT_DATE()
  AND Initial_Call_Scheduled_Date__c < DATE_ADD(CURRENT_DATE(), INTERVAL 14 DAY)
GROUP BY scheduled_date
ORDER BY scheduled_date;
```

**What we need to know:**
- Do we have future-dated initial calls?
- Can we see upcoming week's schedule?

### Query 5.2: Initial Calls by SGA for Current and Next Week

```sql
SELECT 
  SGA_Owner_Name__c as sga_name,
  CASE 
    WHEN Initial_Call_Scheduled_Date__c >= DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))
         AND Initial_Call_Scheduled_Date__c < DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 7 DAY)
    THEN 'Current Week'
    WHEN Initial_Call_Scheduled_Date__c >= DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 7 DAY)
         AND Initial_Call_Scheduled_Date__c < DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 14 DAY)
    THEN 'Next Week'
    ELSE 'Other'
  END as week_bucket,
  COUNT(DISTINCT primary_key) as initial_calls_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Initial_Call_Scheduled_Date__c IS NOT NULL
  AND Initial_Call_Scheduled_Date__c >= DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))
  AND Initial_Call_Scheduled_Date__c < DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 14 DAY)
GROUP BY sga_name, week_bucket
ORDER BY sga_name, week_bucket;
```

**What we need to know:**
- Initial calls per SGA for current/next week
- Data availability and reliability

### Query 5.3: Initial Call Detail for Drill-Down

```sql
SELECT 
  primary_key,
  advisor_name as Prospect_Name,
  SGA_Owner_Name__c as sga_name,
  Initial_Call_Scheduled_Date__c as scheduled_date,
  Original_source,
  Channel_Grouping_Name as channel,
  salesforce_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Initial_Call_Scheduled_Date__c IS NOT NULL
  AND Initial_Call_Scheduled_Date__c >= DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))
  AND Initial_Call_Scheduled_Date__c < DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 14 DAY)
ORDER BY Initial_Call_Scheduled_Date__c, SGA_Owner_Name__c;
```

**What we need to know:**
- Can we provide drill-down to individual scheduled calls?
- What details are available?

---

## Section 6: Active SGA Identification

### Query 6.1: Active SGAs from User Table

```sql
SELECT 
  Id,
  Name,
  Title,
  Email,
  IsActive,
  IsSGA__c
FROM `savvy-gtm-analytics.SavvyGTMData.User`
WHERE IsSGA__c = TRUE
  AND IsActive = TRUE
ORDER BY Name;
```

**What we need to know:**
- List of active SGAs
- Confirm IsSGA__c field exists and is populated

### Query 6.2: SGA Activity Recency

```sql
SELECT 
  u.Name as sga_name,
  u.IsActive,
  MAX(t.CreatedDate) as last_activity,
  COUNT(DISTINCT DATE(t.CreatedDate)) as active_days_last_30
FROM `savvy-gtm-analytics.SavvyGTMData.User` u
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Task` t ON u.Id = t.OwnerId
WHERE u.IsSGA__c = TRUE
  AND t.CreatedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND (t.IsDeleted = FALSE OR t.IsDeleted IS NULL)
GROUP BY u.Name, u.IsActive
ORDER BY last_activity DESC;
```

**What we need to know:**
- Which SGAs are currently active in Task data?
- Can we filter to only show active SGAs in the dashboard?

---

## Section 7: Cold Call Tracking Verification

### Query 7.1: Cold Call Counts by SGA (Current Week)

```sql
SELECT 
  task_executor_name as sga_name,
  COUNT(*) as cold_call_count
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE activity_channel = 'Call'
  AND direction = 'Outbound'
  AND is_true_cold_call = 1
  AND task_created_date_est >= DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))
GROUP BY sga_name
ORDER BY cold_call_count DESC;
```

**What we need to know:**
- Confirm cold call tracking works as documented
- Current week cold call counts by SGA

### Query 7.2: Cold Call Distribution by Day of Week

```sql
SELECT 
  EXTRACT(DAYOFWEEK FROM task_created_date_est) as day_of_week,
  FORMAT_DATE('%A', task_created_date_est) as day_name,
  task_executor_name as sga_name,
  COUNT(*) as cold_call_count
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE activity_channel = 'Call'
  AND direction = 'Outbound'
  AND is_true_cold_call = 1
  AND task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY day_of_week, day_name, sga_name
ORDER BY sga_name, day_of_week;
```

**What we need to know:**
- How cold calls are distributed across days of week
- Per-SGA patterns

---

## Section 8: LinkedIn and Email Activity

### Query 8.1: LinkedIn Activity Types

```sql
SELECT 
  Subject,
  COUNT(*) as count
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE activity_channel = 'LinkedIn'
  AND task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY Subject
ORDER BY count DESC
LIMIT 20;
```

**What we need to know:**
- Types of LinkedIn activities being tracked
- Subject patterns

### Query 8.2: Email Activity (Manual vs Automated)

```sql
SELECT 
  CASE 
    WHEN Subject LIKE '%lemlist%' OR TaskSubtype = 'ListEmail' THEN 'Automated'
    ELSE 'Manual'
  END as email_type,
  COUNT(*) as count,
  COUNT(DISTINCT task_executor_name) as unique_sgas
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE activity_channel = 'Email'
  AND task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
GROUP BY email_type;
```

**What we need to know:**
- Should we exclude automated emails from SGA activity counts?
- What proportion is manual vs automated?

---

## Section 9: Data Freshness Check

### Query 9.1: Most Recent Task Data

```sql
SELECT 
  MAX(CreatedDate) as most_recent_task,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(CreatedDate), HOUR) as hours_behind
FROM `savvy-gtm-analytics.SavvyGTMData.Task`
WHERE (IsDeleted = FALSE OR IsDeleted IS NULL);
```

**What we need to know:**
- How fresh is the Task data?
- Does 6-hour refresh match expectations?

### Query 9.2: Activity View Freshness

```sql
SELECT 
  MAX(task_created_date_est) as most_recent_activity
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`;
```

**What we need to know:**
- Is the activity view up to date?
- Any lag beyond Task table refresh?

---

## Summary: What to Report Back

After running these queries, please provide:

1. **Schema Details**: Full column list for `vw_sga_activity_performance`
2. **Activity Channels**: All distinct values and counts
3. **SMS Response Tracking**: Whether we can calculate response rates and how
4. **Call Answer Rates**: CallDisposition values and how to identify "answered"
5. **Initial Call Data**: Availability of future-dated scheduled calls
6. **Active SGAs**: List of active SGAs to include in filters
7. **Data Freshness**: Current data lag
8. **Any Missing Fields**: Fields we expected but don't exist

This will determine:
- What metrics we can build
- What calculations are possible
- What limitations we need to communicate to the SGA manager
