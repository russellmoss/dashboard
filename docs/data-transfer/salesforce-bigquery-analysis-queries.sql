-- ============================================================================
-- SALESFORCE TO BIGQUERY DATA TRANSFER ANALYSIS QUERIES
-- ============================================================================
-- Purpose: Comprehensive query set for analyzing data transfer costs, 
--          freshness, and usage patterns to inform sync frequency decisions
-- 
-- Target Project: savvy-gtm-analytics
-- Target Dataset: SavvyGTMData
-- Objects Analyzed: Lead, Opportunity
--
-- Created: January 17, 2026
-- ============================================================================


-- ============================================================================
-- QUERY 1: DATA VOLUMES & STORAGE COSTS
-- ============================================================================
-- Purpose: Understand current data sizes and storage costs
-- Expected Output: Table sizes, record counts, monthly storage costs
-- Run Frequency: Monthly or when evaluating storage
-- ============================================================================

SELECT
  table_id AS object_name,
  row_count AS total_records,
  ROUND(size_bytes / POW(1024, 2), 2) AS size_mb,
  ROUND(size_bytes / POW(1024, 3), 4) AS size_gb,
  ROUND(size_bytes / POW(1024, 3) * 0.02, 4) AS monthly_storage_cost_usd,
  TIMESTAMP_MILLIS(last_modified_time) AS last_sync_time,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), TIMESTAMP_MILLIS(last_modified_time), HOUR) AS hours_since_sync
FROM
  `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
WHERE
  table_id IN ('Lead', 'Opportunity')
ORDER BY
  size_bytes DESC;


-- ============================================================================
-- QUERY 2: DATA STALENESS ANALYSIS
-- ============================================================================
-- Purpose: Compare most recent Salesforce activity vs. BigQuery sync time
-- Expected Output: Sync lag in minutes, freshness status indicator
-- Run Frequency: Daily or when investigating data freshness issues
-- ============================================================================

WITH last_sync AS (
  SELECT MAX(TIMESTAMP_MILLIS(last_modified_time)) AS last_bq_sync
  FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
  WHERE table_id IN ('Lead', 'Opportunity')
),
recent_sf_activity AS (
  SELECT 
    'Lead' AS object,
    MAX(LastModifiedDate) AS most_recent_sf_change,
    COUNT(*) AS records_modified_last_24h
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE LastModifiedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
  
  UNION ALL
  
  SELECT 
    'Opportunity' AS object,
    MAX(LastModifiedDate) AS most_recent_sf_change,
    COUNT(*) AS records_modified_last_24h
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE LastModifiedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 24 HOUR)
)
SELECT
  r.object,
  r.most_recent_sf_change,
  s.last_bq_sync,
  TIMESTAMP_DIFF(s.last_bq_sync, r.most_recent_sf_change, MINUTE) AS sync_lag_minutes,
  r.records_modified_last_24h,
  CASE 
    WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), s.last_bq_sync, HOUR) > 24 THEN '🔴 Very Stale (>24h)'
    WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), s.last_bq_sync, HOUR) > 6 THEN '🟠 Stale (6-24h)'
    WHEN TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), s.last_bq_sync, HOUR) > 1 THEN '🟡 Aging (1-6h)'
    ELSE '🟢 Fresh (<1h)'
  END AS freshness_status
FROM recent_sf_activity r
CROSS JOIN last_sync s;


-- ============================================================================
-- QUERY 3: SALESFORCE ACTIVITY PATTERNS (WHEN DO RECORDS CHANGE?)
-- ============================================================================
-- Purpose: Identify peak activity hours to optimize sync scheduling
-- Expected Output: Day/hour breakdown of record modifications
-- Run Frequency: Monthly or when adjusting sync schedule
-- Note: hour_est assumes EST (UTC-5). Adjust for daylight saving if needed.
-- ============================================================================

WITH hourly_activity AS (
  SELECT 
    'Lead' AS object,
    EXTRACT(DAYOFWEEK FROM LastModifiedDate) AS day_of_week,
    EXTRACT(HOUR FROM LastModifiedDate) AS hour_utc,
    COUNT(*) AS modifications
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
  WHERE LastModifiedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  GROUP BY 1, 2, 3
  
  UNION ALL
  
  SELECT 
    'Opportunity' AS object,
    EXTRACT(DAYOFWEEK FROM LastModifiedDate) AS day_of_week,
    EXTRACT(HOUR FROM LastModifiedDate) AS hour_utc,
    COUNT(*) AS modifications
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE LastModifiedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  GROUP BY 1, 2, 3
)
SELECT
  CASE day_of_week
    WHEN 1 THEN 'Sunday'
    WHEN 2 THEN 'Monday'
    WHEN 3 THEN 'Tuesday'
    WHEN 4 THEN 'Wednesday'
    WHEN 5 THEN 'Thursday'
    WHEN 6 THEN 'Friday'
    WHEN 7 THEN 'Saturday'
  END AS day_name,
  hour_utc,
  hour_utc - 5 AS hour_est,  -- Adjust for EST (UTC-5)
  SUM(CASE WHEN object = 'Lead' THEN modifications ELSE 0 END) AS lead_changes,
  SUM(CASE WHEN object = 'Opportunity' THEN modifications ELSE 0 END) AS opp_changes,
  SUM(modifications) AS total_changes
FROM hourly_activity
GROUP BY day_of_week, day_name, hour_utc, hour_est
ORDER BY total_changes DESC
LIMIT 20;


-- ============================================================================
-- QUERY 4: BIGQUERY QUERY COSTS (LAST 30 DAYS)
-- ============================================================================
-- Purpose: Establish baseline query costs for ROI analysis
-- Expected Output: Daily query counts, TB scanned, estimated costs
-- Run Frequency: Monthly for cost monitoring
-- Note: $6.25 per TB is standard BigQuery on-demand pricing
-- ============================================================================

SELECT
  DATE(creation_time) AS date,
  COUNT(*) AS query_count,
  ROUND(SUM(total_bytes_processed) / POW(1024, 4), 6) AS tb_scanned,
  ROUND(SUM(total_bytes_processed) / POW(1024, 4) * 6.25, 2) AS cost_usd,
  ROUND(AVG(total_bytes_processed) / POW(1024, 3), 2) AS avg_gb_per_query,
  ROUND(SUM(total_slot_ms) / 1000 / 60, 1) AS total_slot_minutes
FROM
  `region-us`.INFORMATION_SCHEMA.JOBS
WHERE
  creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND state = 'DONE'
  AND job_type = 'QUERY'
  AND error_result IS NULL
GROUP BY date
ORDER BY date DESC;


-- ============================================================================
-- QUERY 5: COST PROJECTIONS BY CACHE TTL
-- ============================================================================
-- Purpose: Project costs under different caching/refresh scenarios
-- Expected Output: Comparison of monthly costs at different cache intervals
-- Run Frequency: When evaluating caching strategy changes
-- ============================================================================

WITH daily_stats AS (
  SELECT
    DATE(creation_time) AS date,
    COUNT(*) AS queries,
    SUM(total_bytes_processed) AS bytes_processed
  FROM `region-us`.INFORMATION_SCHEMA.JOBS
  WHERE
    creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
    AND state = 'DONE'
    AND job_type = 'QUERY'
  GROUP BY date
),
averages AS (
  SELECT
    AVG(queries) AS avg_daily_queries,
    AVG(bytes_processed) AS avg_daily_bytes
  FROM daily_stats
)
SELECT
  'Current (12h cache)' AS scenario,
  ROUND(avg_daily_queries, 0) AS daily_queries,
  ROUND(avg_daily_bytes / POW(1024, 4) * 6.25 * 30, 2) AS monthly_cost_usd
FROM averages

UNION ALL

SELECT
  '6-hour cache (2x queries)' AS scenario,
  ROUND(avg_daily_queries * 2, 0) AS daily_queries,
  ROUND(avg_daily_bytes * 2 / POW(1024, 4) * 6.25 * 30, 2) AS monthly_cost_usd
FROM averages

UNION ALL

SELECT
  '1-hour cache (12x queries)' AS scenario,
  ROUND(avg_daily_queries * 12, 0) AS daily_queries,
  ROUND(avg_daily_bytes * 12 / POW(1024, 4) * 6.25 * 30, 2) AS monthly_cost_usd
FROM averages

UNION ALL

SELECT
  'No cache (24x queries)' AS scenario,
  ROUND(avg_daily_queries * 24, 0) AS daily_queries,
  ROUND(avg_daily_bytes * 24 / POW(1024, 4) * 6.25 * 30, 2) AS monthly_cost_usd
FROM averages

ORDER BY monthly_cost_usd;


-- ============================================================================
-- QUERY 6: DASHBOARD USAGE PATTERNS
-- ============================================================================
-- Purpose: Identify when users access the dashboard (peak usage times)
-- Expected Output: Hour/day breakdown of dashboard queries
-- Run Frequency: Monthly or when optimizing sync schedule
-- Note: Filters for queries hitting vw_funnel_master (main dashboard view)
-- ============================================================================

SELECT
  EXTRACT(HOUR FROM creation_time) AS hour_utc,
  EXTRACT(HOUR FROM creation_time) - 5 AS hour_est,
  CASE EXTRACT(DAYOFWEEK FROM creation_time)
    WHEN 1 THEN 'Sunday'
    WHEN 2 THEN 'Monday'
    WHEN 3 THEN 'Tuesday'
    WHEN 4 THEN 'Wednesday'
    WHEN 5 THEN 'Thursday'
    WHEN 6 THEN 'Friday'
    WHEN 7 THEN 'Saturday'
  END AS day_name,
  COUNT(*) AS query_count,
  COUNT(DISTINCT user_email) AS unique_users
FROM
  `region-us`.INFORMATION_SCHEMA.JOBS
WHERE
  creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 14 DAY)
  AND state = 'DONE'
  AND job_type = 'QUERY'
  AND LOWER(query) LIKE '%vw_funnel_master%'
GROUP BY 1, 2, 3
ORDER BY query_count DESC
LIMIT 20;


-- ============================================================================
-- QUERY 7A: FUNNEL VELOCITY - TODAY'S ACTIVITY
-- ============================================================================
-- Purpose: Quick snapshot of today's funnel activity
-- Expected Output: Count of stage changes, new records, conversions today
-- Run Frequency: Daily for operational monitoring
-- ============================================================================

SELECT
  'Stage changes today' AS metric,
  COUNT(*) AS count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE 
  LastModifiedDate >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), DAY)
  AND StageName IS NOT NULL

UNION ALL

SELECT
  'New opportunities today' AS metric,
  COUNT(*) AS count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE CreatedDate >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), DAY)

UNION ALL

SELECT
  'New leads today' AS metric,
  COUNT(*) AS count
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE CreatedDate >= TIMESTAMP_TRUNC(CURRENT_TIMESTAMP(), DAY)

UNION ALL

SELECT
  'Leads converted today' AS metric,
  COUNT(*) AS count
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE 
  ConvertedDate >= CURRENT_DATE()  -- ConvertedDate is DATE type, not TIMESTAMP
  AND IsConverted = TRUE;


-- ============================================================================
-- QUERY 7B: FUNNEL VELOCITY - 7-DAY AVERAGES
-- ============================================================================
-- Purpose: Establish baseline daily activity levels for capacity planning
-- Expected Output: 7-day totals and daily averages for key funnel events
-- Run Frequency: Weekly for trend analysis
-- ============================================================================

SELECT
  'Opportunities modified (last 7 days)' AS metric,
  COUNT(*) AS total_count,
  ROUND(COUNT(*) / 7.0, 1) AS daily_avg
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE LastModifiedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)

UNION ALL

SELECT
  'New opportunities (last 7 days)' AS metric,
  COUNT(*) AS total_count,
  ROUND(COUNT(*) / 7.0, 1) AS daily_avg
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE CreatedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)

UNION ALL

SELECT
  'New leads (last 7 days)' AS metric,
  COUNT(*) AS total_count,
  ROUND(COUNT(*) / 7.0, 1) AS daily_avg
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE CreatedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)

UNION ALL

SELECT
  'Leads converted (last 7 days)' AS metric,
  COUNT(*) AS total_count,
  ROUND(COUNT(*) / 7.0, 1) AS daily_avg
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE 
  ConvertedDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)
  AND IsConverted = TRUE;


-- ============================================================================
-- QUERY 8: EXECUTIVE SUMMARY
-- ============================================================================
-- Purpose: One-stop summary for management presentations
-- Expected Output: Key metrics in presentation-ready format
-- Run Frequency: As needed for reporting
-- ============================================================================

SELECT
  '📊 Data Volume' AS category,
  'Lead + Opportunity tables' AS metric,
  CAST(ROUND(SUM(size_bytes) / POW(1024, 2), 1) AS STRING) || ' MB' AS value
FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
WHERE table_id IN ('Lead', 'Opportunity')

UNION ALL

SELECT
  '💰 Monthly Storage Cost' AS category,
  'BigQuery storage' AS metric,
  '$' || CAST(ROUND(SUM(size_bytes) / POW(1024, 3) * 0.02, 2) AS STRING) AS value
FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
WHERE table_id IN ('Lead', 'Opportunity')

UNION ALL

SELECT
  '🔄 Data Transfer Cost' AS category,
  'Salesforce connector' AS metric,
  '$0.00 (Free)' AS value

UNION ALL

SELECT
  '⏱️ Current Sync Frequency' AS category,
  'Lead + Opportunity' AS metric,
  'Every 24 hours' AS value

UNION ALL

SELECT
  '📈 Records Modified Daily' AS category,
  'Avg last 7 days' AS metric,
  CAST(ROUND(COUNT(*) / 7.0, 1) AS STRING) || ' records/day' AS value
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE LastModifiedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY);


-- ============================================================================
-- QUERY 9: DASHBOARD-SPECIFIC QUERY COSTS
-- ============================================================================
-- Purpose: Isolate costs specifically from dashboard queries (vs. other BQ usage)
-- Expected Output: Query details for vw_funnel_master queries
-- Run Frequency: When investigating dashboard performance/costs
-- ============================================================================

SELECT
  DATE(creation_time) AS date,
  SUBSTR(query, 1, 100) AS query_preview,
  ROUND(total_bytes_processed / POW(1024, 3), 2) AS gb_processed,
  ROUND(total_bytes_processed / POW(1024, 4) * 6.25, 4) AS cost_usd,
  total_slot_ms / 1000 AS slot_seconds,
  user_email
FROM
  `region-us`.INFORMATION_SCHEMA.JOBS
WHERE
  creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND state = 'DONE'
  AND job_type = 'QUERY'
  AND LOWER(query) LIKE '%vw_funnel_master%'
ORDER BY
  total_bytes_processed DESC
LIMIT 50;


-- ============================================================================
-- QUERY 10: DATA TRANSFER HISTORY
-- ============================================================================
-- Purpose: Review historical data transfer runs and their status
-- Expected Output: List of recent data transfer jobs
-- Run Frequency: When troubleshooting sync issues
-- Note: Requires appropriate permissions on INFORMATION_SCHEMA
-- ============================================================================

SELECT
  job_id,
  job_type,
  user_email,
  state,
  creation_time,
  start_time,
  end_time,
  TIMESTAMP_DIFF(end_time, start_time, SECOND) AS duration_seconds,
  total_bytes_processed,
  error_result
FROM
  `region-us`.INFORMATION_SCHEMA.JOBS
WHERE
  creation_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND job_type = 'LOAD'
  AND destination_table.dataset_id = 'SavvyGTMData'
ORDER BY
  creation_time DESC
LIMIT 50;


-- ============================================================================
-- QUERY 11: SALESFORCE API USAGE ESTIMATION
-- ============================================================================
-- Purpose: Estimate API calls consumed per sync based on record counts
-- Expected Output: Estimated API calls for Lead and Opportunity syncs
-- Run Frequency: When evaluating sync frequency changes
-- Note: Actual API usage depends on Salesforce connector configuration
-- ============================================================================

SELECT
  'Lead' AS object,
  COUNT(*) AS total_records,
  -- Estimate: 1 API call per 2000 records (bulk API) + overhead
  CEIL(COUNT(*) / 2000.0) + 5 AS estimated_api_calls_per_sync,
  -- With 24h sync
  (CEIL(COUNT(*) / 2000.0) + 5) * 1 AS daily_api_calls_24h_sync,
  -- With 6h sync (4x per day)
  (CEIL(COUNT(*) / 2000.0) + 5) * 4 AS daily_api_calls_6h_sync,
  -- With 1h sync (24x per day)
  (CEIL(COUNT(*) / 2000.0) + 5) * 24 AS daily_api_calls_1h_sync
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`

UNION ALL

SELECT
  'Opportunity' AS object,
  COUNT(*) AS total_records,
  CEIL(COUNT(*) / 2000.0) + 5 AS estimated_api_calls_per_sync,
  (CEIL(COUNT(*) / 2000.0) + 5) * 1 AS daily_api_calls_24h_sync,
  (CEIL(COUNT(*) / 2000.0) + 5) * 4 AS daily_api_calls_6h_sync,
  (CEIL(COUNT(*) / 2000.0) + 5) * 24 AS daily_api_calls_1h_sync
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`;


-- ============================================================================
-- QUERY 12: RECORD CHANGE VELOCITY BY STAGE (OPPORTUNITIES)
-- ============================================================================
-- Purpose: Understand which stages have the most activity
-- Expected Output: Modification counts by opportunity stage
-- Run Frequency: When analyzing funnel bottlenecks
-- ============================================================================

SELECT
  StageName AS stage,
  COUNT(*) AS modifications_last_7_days,
  ROUND(COUNT(*) / 7.0, 1) AS daily_avg,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct_of_total
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE 
  LastModifiedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND StageName IS NOT NULL
GROUP BY StageName
ORDER BY modifications_last_7_days DESC;


-- ============================================================================
-- QUERY 13: HOURLY MODIFICATION HEATMAP DATA
-- ============================================================================
-- Purpose: Generate data for a heatmap visualization of activity by hour/day
-- Expected Output: Pivot-ready data showing modifications by hour and day
-- Run Frequency: Monthly for schedule optimization
-- ============================================================================

SELECT
  CASE EXTRACT(DAYOFWEEK FROM LastModifiedDate)
    WHEN 1 THEN '1_Sunday'
    WHEN 2 THEN '2_Monday'
    WHEN 3 THEN '3_Tuesday'
    WHEN 4 THEN '4_Wednesday'
    WHEN 5 THEN '5_Thursday'
    WHEN 6 THEN '6_Friday'
    WHEN 7 THEN '7_Saturday'
  END AS day_name,
  EXTRACT(HOUR FROM LastModifiedDate) - 5 AS hour_est,  -- Convert to EST
  'Lead' AS object,
  COUNT(*) AS modifications
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`
WHERE LastModifiedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY 1, 2, 3

UNION ALL

SELECT
  CASE EXTRACT(DAYOFWEEK FROM LastModifiedDate)
    WHEN 1 THEN '1_Sunday'
    WHEN 2 THEN '2_Monday'
    WHEN 3 THEN '3_Tuesday'
    WHEN 4 THEN '4_Wednesday'
    WHEN 5 THEN '5_Thursday'
    WHEN 6 THEN '6_Friday'
    WHEN 7 THEN '7_Saturday'
  END AS day_name,
  EXTRACT(HOUR FROM LastModifiedDate) - 5 AS hour_est,
  'Opportunity' AS object,
  COUNT(*) AS modifications
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE LastModifiedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
GROUP BY 1, 2, 3

ORDER BY day_name, hour_est;


-- ============================================================================
-- END OF QUERY FILE
-- ============================================================================
-- 
-- USAGE NOTES:
-- 
-- 1. Run queries individually or as needed for specific analysis
-- 2. Query 4 and 6 require access to INFORMATION_SCHEMA (may need additional permissions)
-- 3. Adjust UTC-to-EST offset (-5) if running during Daylight Saving Time (-4)
-- 4. Cost calculations assume BigQuery on-demand pricing ($6.25/TB)
-- 5. API call estimates in Query 11 are rough approximations
-- 
-- For questions, contact: russell.moss@savvywealth.com
-- ============================================================================
