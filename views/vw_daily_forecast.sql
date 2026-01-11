-- =============================================================================
-- CREATE VIEW STATEMENT
-- Run this in BigQuery to create the view
-- =============================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_daily_forecast` AS

WITH
-- 1. Get monthly forecasts (Cohort_source metric only, exclude "All" sources)
Monthly_Forecasts AS (
  SELECT
    f.month_key,
    f.original_source,
    LOWER(f.stage) AS stage,
    COALESCE(SAFE_CAST(f.forecast_value AS FLOAT64), 0) AS forecast_value,
    -- Get channel grouping from mapping table, fallback to forecast channel
    COALESCE(nm.Channel_Grouping_Name, f.channel, 'Other') AS channel_grouping_name,
    -- Parse month_key to first day of month
    PARSE_DATE('%Y-%m', f.month_key) AS month_start_date
  FROM `savvy-gtm-analytics.SavvyGTMData.q4_2025_forecast` f
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm
    ON f.original_source = nm.original_source
  WHERE f.metric = 'Cohort_source'
    AND f.original_source != 'All'
    AND f.original_source IS NOT NULL
    AND f.forecast_value IS NOT NULL
),

-- 2. Calculate days in each month dynamically
Monthly_With_Days AS (
  SELECT
    month_key,
    original_source,
    stage,
    forecast_value,
    channel_grouping_name,
    month_start_date,
    -- Calculate days in month: difference between next month start and current month start
    DATE_DIFF(
      DATE_ADD(month_start_date, INTERVAL 1 MONTH),
      month_start_date,
      DAY
    ) AS days_in_month
  FROM Monthly_Forecasts
),

-- 3. Generate date spine - one row per day per source/stage
Date_Spine AS (
  SELECT
    date_day,
    m.month_key,
    m.original_source,
    m.channel_grouping_name,
    m.stage,
    m.forecast_value AS monthly_forecast,
    m.days_in_month,
    -- Daily rate: monthly forecast divided by days in that month
    m.forecast_value / m.days_in_month AS daily_rate
  FROM Monthly_With_Days m
  CROSS JOIN UNNEST(
    GENERATE_DATE_ARRAY(
      m.month_start_date,
      DATE_SUB(DATE_ADD(m.month_start_date, INTERVAL 1 MONTH), INTERVAL 1 DAY),
      INTERVAL 1 DAY
    )
  ) AS date_day
  WHERE m.forecast_value > 0  -- Only include non-zero forecasts
),

-- 4. Pivot stages into columns for easier querying
Pivoted AS (
  SELECT
    date_day,
    original_source,
    channel_grouping_name,
    -- Sum in case there are multiple entries (shouldn't happen, but defensive)
    SUM(CASE WHEN stage = 'prospects' THEN daily_rate ELSE 0 END) AS prospects_daily,
    SUM(CASE WHEN stage = 'mql' THEN daily_rate ELSE 0 END) AS mqls_daily,
    SUM(CASE WHEN stage = 'sql' THEN daily_rate ELSE 0 END) AS sqls_daily,
    SUM(CASE WHEN stage = 'sqo' THEN daily_rate ELSE 0 END) AS sqos_daily,
    SUM(CASE WHEN stage = 'joined' THEN daily_rate ELSE 0 END) AS joined_daily
  FROM Date_Spine
  GROUP BY date_day, original_source, channel_grouping_name
)

SELECT 
  date_day,
  original_source,
  channel_grouping_name,
  prospects_daily,
  mqls_daily,
  sqls_daily,
  sqos_daily,
  joined_daily,
  -- Add quarter identifier for easier filtering
  CONCAT(
    EXTRACT(YEAR FROM date_day), 
    '-Q', 
    EXTRACT(QUARTER FROM date_day)
  ) AS quarter_key
FROM Pivoted;


-- =============================================================================
-- GRANT ACCESS (if needed)
-- =============================================================================
-- GRANT SELECT ON `savvy-gtm-analytics.Tableau_Views.vw_daily_forecast` 
-- TO "serviceAccount:your-service-account@your-project.iam.gserviceaccount.com";