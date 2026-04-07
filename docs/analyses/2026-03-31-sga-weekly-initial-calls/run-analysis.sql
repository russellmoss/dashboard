-- =============================================================================
-- SGA Weekly Initial Calls Scheduled — Q1 2026
-- Generated: 2026-03-31 | Validated against BigQuery | Council-reviewed
-- =============================================================================

-- Query 1: Team-wide average (tenure-bounded, zero-filled)
-- Result: 3.01 avg initial calls per SGA per week
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name, DATE(u.CreatedDate) AS sga_start_date
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE
    AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville', 'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss', 'Savvy Marketing', 'Savvy Operations', 'Lauren George')
),
AllWeeks AS (
  SELECT DATE_TRUNC(d, WEEK(MONDAY)) AS week_start
  FROM UNNEST(GENERATE_DATE_ARRAY(DATE('2026-01-01'), DATE('2026-03-29'), INTERVAL 7 DAY)) AS d
),
SGAWeekCross AS (
  SELECT a.sga_name, w.week_start
  FROM ActiveSGAs a
  CROSS JOIN AllWeeks w
  WHERE w.week_start >= DATE_TRUNC(a.sga_start_date, WEEK(MONDAY))
),
WeeklyCallsBySGA AS (
  SELECT
    v.SGA_Owner_Name__c AS sga_name,
    DATE_TRUNC(v.Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) AS week_start,
    COUNT(DISTINCT v.primary_key) AS calls_scheduled
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  INNER JOIN ActiveSGAs a ON v.SGA_Owner_Name__c = a.sga_name
  WHERE v.Initial_Call_Scheduled_Date__c >= DATE('2026-01-01')
    AND v.Initial_Call_Scheduled_Date__c <= DATE('2026-03-29')
    AND v.Initial_Call_Scheduled_Date__c IS NOT NULL
  GROUP BY 1, 2
),
FilledWeeks AS (
  SELECT
    c.sga_name,
    c.week_start,
    COALESCE(w.calls_scheduled, 0) AS calls_scheduled
  FROM SGAWeekCross c
  LEFT JOIN WeeklyCallsBySGA w ON c.sga_name = w.sga_name AND c.week_start = w.week_start
)
SELECT
  COUNT(DISTINCT sga_name) AS active_sgas,
  COUNT(DISTINCT week_start) AS total_weeks,
  SUM(calls_scheduled) AS total_calls,
  ROUND(AVG(calls_scheduled), 2) AS avg_initial_calls_per_sga_per_week
FROM FilledWeeks;


-- Query 2: Per-SGA breakdown (tenure-bounded)
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name, DATE(u.CreatedDate) AS sga_start_date
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE
    AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville', 'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss', 'Savvy Marketing', 'Savvy Operations', 'Lauren George')
),
AllWeeks AS (
  SELECT DATE_TRUNC(d, WEEK(MONDAY)) AS week_start
  FROM UNNEST(GENERATE_DATE_ARRAY(DATE('2026-01-01'), DATE('2026-03-29'), INTERVAL 7 DAY)) AS d
),
SGAWeekCross AS (
  SELECT a.sga_name, a.sga_start_date, w.week_start
  FROM ActiveSGAs a
  CROSS JOIN AllWeeks w
  WHERE w.week_start >= DATE_TRUNC(a.sga_start_date, WEEK(MONDAY))
),
WeeklyCallsBySGA AS (
  SELECT
    v.SGA_Owner_Name__c AS sga_name,
    DATE_TRUNC(v.Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) AS week_start,
    COUNT(DISTINCT v.primary_key) AS calls_scheduled
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  INNER JOIN ActiveSGAs a ON v.SGA_Owner_Name__c = a.sga_name
  WHERE v.Initial_Call_Scheduled_Date__c >= DATE('2026-01-01')
    AND v.Initial_Call_Scheduled_Date__c <= DATE('2026-03-29')
    AND v.Initial_Call_Scheduled_Date__c IS NOT NULL
  GROUP BY 1, 2
),
FilledWeeks AS (
  SELECT
    c.sga_name,
    c.sga_start_date,
    c.week_start,
    COALESCE(w.calls_scheduled, 0) AS calls_scheduled
  FROM SGAWeekCross c
  LEFT JOIN WeeklyCallsBySGA w ON c.sga_name = w.sga_name AND c.week_start = w.week_start
)
SELECT
  sga_name,
  sga_start_date,
  COUNT(DISTINCT week_start) AS eligible_weeks,
  SUM(calls_scheduled) AS total_calls,
  ROUND(AVG(calls_scheduled), 2) AS avg_calls_per_week
FROM FilledWeeks
GROUP BY 1, 2
ORDER BY avg_calls_per_week DESC;
