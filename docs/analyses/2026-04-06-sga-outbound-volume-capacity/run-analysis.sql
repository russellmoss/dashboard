-- =============================================================================
-- SGA Outbound Volume Capacity Analysis
-- Run date: 2026-04-06
-- Purpose: Average outbound calls + SMS per SGA per month (Oct 2025 - Mar 2026)
--          to project capacity at 18 and 20 SGAs.
--
-- Uses exact METRIC_CASE_EXPRESSION and ACTIVE_SGAS_CTE from dashboard codebase.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Query 1: Per-SGA monthly breakdown (detail rows)
-- ---------------------------------------------------------------------------
WITH active_sgas AS (
  SELECT TRIM(u.Name) as sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN (
      'Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
      'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
      'Savvy Marketing', 'Savvy Operations', 'Lauren George'
    )
),
classified AS (
  SELECT DISTINCT
    a.task_id,
    a.task_executor_name,
    FORMAT_DATE('%Y-%m', a.task_activity_date) AS activity_month,
    CASE
      WHEN a.activity_channel_group = 'Call' AND a.is_true_cold_call = 1 THEN 'Cold_Call'
      WHEN a.activity_channel_group = 'Call' AND COALESCE(a.is_true_cold_call, 0) = 0
           AND a.direction = 'Outbound'
           AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%' THEN 'Scheduled_Call'
      WHEN a.activity_channel_group = 'SMS' AND a.direction = 'Outbound' THEN 'Outbound_SMS'
      ELSE NULL
    END AS metric_type
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
  WHERE a.task_activity_date >= DATE('2025-10-01')
    AND a.task_activity_date < DATE('2026-04-01')
    AND COALESCE(a.is_marketing_activity, 0) = 0
),
sga_monthly AS (
  SELECT
    task_executor_name AS sga_name,
    activity_month,
    COUNTIF(metric_type = 'Cold_Call') AS cold_calls,
    COUNTIF(metric_type = 'Scheduled_Call') AS scheduled_calls,
    COUNTIF(metric_type IN ('Cold_Call', 'Scheduled_Call')) AS total_outbound_calls,
    COUNTIF(metric_type = 'Outbound_SMS') AS outbound_sms
  FROM classified
  GROUP BY 1, 2
)
SELECT
  sga_name,
  activity_month,
  cold_calls,
  scheduled_calls,
  total_outbound_calls,
  outbound_sms
FROM sga_monthly
ORDER BY sga_name, activity_month;


-- ---------------------------------------------------------------------------
-- Query 2: Per-SGA averages (summary)
-- ---------------------------------------------------------------------------
WITH active_sgas AS (
  SELECT TRIM(u.Name) as sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN (
      'Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
      'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
      'Savvy Marketing', 'Savvy Operations', 'Lauren George'
    )
),
classified AS (
  SELECT DISTINCT
    a.task_id,
    a.task_executor_name,
    FORMAT_DATE('%Y-%m', a.task_activity_date) AS activity_month,
    CASE
      WHEN a.activity_channel_group = 'Call' AND a.is_true_cold_call = 1 THEN 'Cold_Call'
      WHEN a.activity_channel_group = 'Call' AND COALESCE(a.is_true_cold_call, 0) = 0
           AND a.direction = 'Outbound'
           AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%' THEN 'Scheduled_Call'
      WHEN a.activity_channel_group = 'SMS' AND a.direction = 'Outbound' THEN 'Outbound_SMS'
      ELSE NULL
    END AS metric_type
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
  WHERE a.task_activity_date >= DATE('2025-10-01')
    AND a.task_activity_date < DATE('2026-04-01')
    AND COALESCE(a.is_marketing_activity, 0) = 0
),
sga_monthly AS (
  SELECT
    task_executor_name AS sga_name,
    activity_month,
    COUNTIF(metric_type IN ('Cold_Call', 'Scheduled_Call')) AS total_outbound_calls,
    COUNTIF(metric_type = 'Outbound_SMS') AS outbound_sms
  FROM classified
  GROUP BY 1, 2
)
SELECT
  sga_name,
  COUNT(DISTINCT activity_month) AS active_months,
  SUM(total_outbound_calls) AS total_outbound_calls,
  SUM(outbound_sms) AS total_outbound_sms,
  ROUND(AVG(total_outbound_calls), 1) AS avg_calls_per_month,
  ROUND(AVG(outbound_sms), 1) AS avg_sms_per_month
FROM sga_monthly
GROUP BY 1
ORDER BY avg_calls_per_month DESC;


-- ---------------------------------------------------------------------------
-- Query 3: Monthly team totals with per-SGA averages
-- ---------------------------------------------------------------------------
WITH active_sgas AS (
  SELECT TRIM(u.Name) as sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN (
      'Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
      'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
      'Savvy Marketing', 'Savvy Operations', 'Lauren George'
    )
),
classified AS (
  SELECT DISTINCT
    a.task_id,
    a.task_executor_name,
    FORMAT_DATE('%Y-%m', a.task_activity_date) AS activity_month,
    CASE
      WHEN a.activity_channel_group = 'Call' AND a.is_true_cold_call = 1 THEN 'Cold_Call'
      WHEN a.activity_channel_group = 'Call' AND COALESCE(a.is_true_cold_call, 0) = 0
           AND a.direction = 'Outbound'
           AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%' THEN 'Scheduled_Call'
      WHEN a.activity_channel_group = 'SMS' AND a.direction = 'Outbound' THEN 'Outbound_SMS'
      ELSE NULL
    END AS metric_type
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
  WHERE a.task_activity_date >= DATE('2025-10-01')
    AND a.task_activity_date < DATE('2026-04-01')
    AND COALESCE(a.is_marketing_activity, 0) = 0
)
SELECT
  activity_month,
  COUNT(DISTINCT task_executor_name) AS active_sga_count,
  COUNTIF(metric_type = 'Cold_Call') AS cold_calls,
  COUNTIF(metric_type = 'Scheduled_Call') AS scheduled_calls,
  COUNTIF(metric_type IN ('Cold_Call', 'Scheduled_Call')) AS total_outbound_calls,
  COUNTIF(metric_type = 'Outbound_SMS') AS outbound_sms,
  ROUND(SAFE_DIVIDE(
    COUNTIF(metric_type IN ('Cold_Call', 'Scheduled_Call')),
    COUNT(DISTINCT task_executor_name)
  ), 1) AS avg_calls_per_sga,
  ROUND(SAFE_DIVIDE(
    COUNTIF(metric_type = 'Outbound_SMS'),
    COUNT(DISTINCT task_executor_name)
  ), 1) AS avg_sms_per_sga
FROM classified
GROUP BY 1
ORDER BY 1;


-- ---------------------------------------------------------------------------
-- Query 4: Team projection summary (SGAs with 3+ months data)
-- ---------------------------------------------------------------------------
WITH active_sgas AS (
  SELECT TRIM(u.Name) as sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN (
      'Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
      'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
      'Savvy Marketing', 'Savvy Operations', 'Lauren George'
    )
),
classified AS (
  SELECT DISTINCT
    a.task_id,
    a.task_executor_name,
    FORMAT_DATE('%Y-%m', a.task_activity_date) AS activity_month,
    CASE
      WHEN a.activity_channel_group = 'Call' AND a.is_true_cold_call = 1 THEN 'Cold_Call'
      WHEN a.activity_channel_group = 'Call' AND COALESCE(a.is_true_cold_call, 0) = 0
           AND a.direction = 'Outbound'
           AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%' THEN 'Scheduled_Call'
      WHEN a.activity_channel_group = 'SMS' AND a.direction = 'Outbound' THEN 'Outbound_SMS'
      ELSE NULL
    END AS metric_type
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
  WHERE a.task_activity_date >= DATE('2025-10-01')
    AND a.task_activity_date < DATE('2026-04-01')
    AND COALESCE(a.is_marketing_activity, 0) = 0
),
sga_monthly AS (
  SELECT
    task_executor_name AS sga_name,
    activity_month,
    COUNTIF(metric_type IN ('Cold_Call', 'Scheduled_Call')) AS total_outbound_calls,
    COUNTIF(metric_type = 'Outbound_SMS') AS outbound_sms
  FROM classified
  GROUP BY 1, 2
),
sga_avgs AS (
  SELECT
    sga_name,
    COUNT(DISTINCT activity_month) AS active_months,
    ROUND(AVG(total_outbound_calls), 1) AS avg_calls,
    ROUND(AVG(outbound_sms), 1) AS avg_sms
  FROM sga_monthly
  GROUP BY 1
  HAVING COUNT(DISTINCT activity_month) >= 3
)
SELECT
  COUNT(*) AS sgas_in_sample,
  ROUND(AVG(avg_calls), 1) AS mean_calls_per_sga_month,
  ROUND(AVG(avg_sms), 1) AS mean_sms_per_sga_month,
  ROUND(AVG(avg_calls) * 18, 0) AS proj_calls_18_sgas,
  ROUND(AVG(avg_calls) * 20, 0) AS proj_calls_20_sgas,
  ROUND(AVG(avg_sms) * 18, 0) AS proj_sms_18_sgas,
  ROUND(AVG(avg_sms) * 20, 0) AS proj_sms_20_sgas
FROM sga_avgs;
