-- ============================================================================
-- vw_sga_sms_timing_analysis_v2
--
-- CHANGES from v1:
--   1. Anchored on Tableau_Views.vw_funnel_master (not savvy_analytics.vw_sga_funnel)
--   2. Removed 365-day window filter — includes all historical data
--   3. Added full funnel stages (is_sql, is_sqo, is_joined) not just MQL
--   4. Joins sms_intent_classified by task_id for first-SMS intent
--   5. Added response speed metrics (time from inbound reply to SGA response)
--   6. Added first_sms_has_link flag
--   7. Uses vw_funnel_master progression flags directly (no redefinition)
-- ============================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.savvy_analytics.vw_sga_sms_timing_analysis_v2` AS

WITH

-- ── Step 1: Base Population — All Contacted Leads ────────────────────────
Contacted_Leads AS (
  SELECT
    f.Full_prospect_id__c,
    f.SGA_Owner_Name__c,
    f.Original_source,
    f.Channel_Grouping_Name,
    DATE(f.CreatedDate)                       AS prospect_created_date,
    DATE(f.stage_entered_contacting__c)       AS contacted_date,
    DATE(f.mql_stage_entered_ts)              AS mql_date,
    f.converted_date_raw                      AS sql_date,
    DATE(f.Date_Became_SQO__c)               AS sqo_date,
    f.advisor_join_date__c                    AS joined_date,
    -- Flags from funnel master (source of truth)
    f.is_contacted,
    f.is_mql,
    f.is_sql,
    f.is_sqo,
    f.is_joined,
    -- Progression flags from funnel master (source of truth)
    f.eligible_for_contacted_conversions,
    f.contacted_to_mql_progression,
    f.mql_to_sql_progression,
    f.sql_to_sqo_progression,
    f.sqo_to_joined_progression,
    f.Opportunity_AUM,
    -- SMS cutoff: only count SMS before MQL (or 7 days after contact if no MQL)
    CASE
      WHEN f.mql_stage_entered_ts IS NOT NULL
        THEN DATE(f.mql_stage_entered_ts)
      ELSE DATE_ADD(DATE(f.stage_entered_contacting__c), INTERVAL 7 DAY)
    END AS sms_cutoff_date,
    f.mql_stage_entered_ts IS NOT NULL AS has_mql
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  WHERE f.is_contacted = 1
    AND f.SGA_Owner_Name__c IS NOT NULL
    AND f.SGA_Owner_Name__c NOT IN ('Savvy Operations')
),

-- ── Step 2: SGA Performance Tiers ────────────────────────────────────────
SGA_Stats AS (
  SELECT
    SGA_Owner_Name__c,
    SUM(eligible_for_contacted_conversions) AS volume,
    SAFE_DIVIDE(
      SUM(contacted_to_mql_progression),
      SUM(eligible_for_contacted_conversions)
    ) AS contacted_to_mql_rate,
    SAFE_DIVIDE(
      SUM(CASE WHEN is_sqo = 1 THEN 1 ELSE 0 END),
      SUM(eligible_for_contacted_conversions)
    ) AS contacted_to_sqo_rate
  FROM Contacted_Leads
  GROUP BY 1
  HAVING SUM(eligible_for_contacted_conversions) >= 10
),
SGA_Tiers AS (
  SELECT
    *,
    CASE
      WHEN PERCENT_RANK() OVER (ORDER BY contacted_to_mql_rate) >= 0.75 THEN 'Top'
      WHEN PERCENT_RANK() OVER (ORDER BY contacted_to_mql_rate) <= 0.25 THEN 'Bottom'
      ELSE 'Middle'
    END AS sga_performance_tier
  FROM SGA_Stats
),

-- ── Step 3: All SMS Activities (Inbound + Outbound) ──────────────────────
All_SMS AS (
  SELECT
    a.task_id,
    a.SGA_Owner_Name__c,
    a.Full_prospect_id__c,
    a.task_activity_date,
    a.task_created_datetime_est,
    a.direction,
    a.activity_channel,
    ROW_NUMBER() OVER (
      PARTITION BY a.Full_prospect_id__c, a.task_activity_date
      ORDER BY a.task_created_datetime_est
    ) AS sms_seq_in_day,
    ROW_NUMBER() OVER (
      PARTITION BY a.Full_prospect_id__c, a.direction
      ORDER BY a.task_created_datetime_est
    ) AS sms_seq_by_direction
  FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` a
  INNER JOIN Contacted_Leads c
    ON a.Full_prospect_id__c = c.Full_prospect_id__c
  WHERE a.activity_channel = 'SMS'
    AND a.is_marketing_activity = 0
    AND a.task_activity_date >= c.contacted_date
    AND (
      (c.has_mql = TRUE  AND a.task_activity_date < c.sms_cutoff_date)
      OR
      (c.has_mql = FALSE AND a.task_activity_date <= c.sms_cutoff_date)
    )
),

-- ── Step 4: First Outbound SMS per lead ──────────────────────────────────
First_Outbound AS (
  SELECT
    s.Full_prospect_id__c,
    s.task_id                                      AS first_sms_task_id,
    s.task_activity_date                           AS first_sms_date,
    s.task_created_datetime_est                    AS first_sms_datetime,
    EXTRACT(HOUR FROM s.task_created_datetime_est) AS first_sms_hour,
    EXTRACT(DAYOFWEEK FROM s.task_created_datetime_est) AS first_sms_dow_num,
    FORMAT_DATE('%A', DATE(s.task_created_datetime_est)) AS first_sms_day_name
  FROM All_SMS s
  WHERE s.direction = 'Outbound' AND s.sms_seq_by_direction = 1
),

-- ── Step 5: First Inbound Reply per lead ─────────────────────────────────
First_Inbound AS (
  SELECT
    s.Full_prospect_id__c,
    s.task_created_datetime_est AS first_reply_datetime
  FROM All_SMS s
  WHERE s.direction = 'Inbound' AND s.sms_seq_by_direction = 1
),

-- ── Step 6: SGA Response to First Inbound ────────────────────────────────
-- First outbound SMS AFTER the first inbound reply
SGA_Response AS (
  SELECT
    s.Full_prospect_id__c,
    MIN(s.task_created_datetime_est) AS response_datetime
  FROM All_SMS s
  INNER JOIN First_Inbound fi ON s.Full_prospect_id__c = fi.Full_prospect_id__c
  WHERE s.direction = 'Outbound'
    AND s.task_created_datetime_est > fi.first_reply_datetime
  GROUP BY 1
),

-- ── Step 7: Daily SMS frequency & double-tap detection ───────────────────
Daily_SMS AS (
  SELECT
    Full_prospect_id__c,
    task_activity_date,
    COUNTIF(direction = 'Outbound') AS outbound_cnt,
    COUNTIF(direction = 'Inbound')  AS inbound_cnt
  FROM All_SMS
  GROUP BY 1, 2
),

-- Identify interrupted days (outbound → inbound → outbound = conversation, not double tap)
Interrupted_Days AS (
  SELECT DISTINCT a1.Full_prospect_id__c, a1.task_activity_date
  FROM All_SMS a1
  JOIN All_SMS a2 ON a1.Full_prospect_id__c = a2.Full_prospect_id__c
    AND a1.task_activity_date = a2.task_activity_date
  JOIN All_SMS a3 ON a1.Full_prospect_id__c = a3.Full_prospect_id__c
    AND a1.task_activity_date = a3.task_activity_date
  WHERE a1.direction = 'Outbound' AND a2.direction = 'Inbound' AND a3.direction = 'Outbound'
    AND a1.sms_seq_in_day < a2.sms_seq_in_day
    AND a2.sms_seq_in_day < a3.sms_seq_in_day
),

True_Double_Tap_Days AS (
  SELECT d.Full_prospect_id__c, d.task_activity_date
  FROM Daily_SMS d
  LEFT JOIN Interrupted_Days i
    ON d.Full_prospect_id__c = i.Full_prospect_id__c
    AND d.task_activity_date = i.task_activity_date
  WHERE d.outbound_cnt = 2 AND i.task_activity_date IS NULL
),

-- ── Step 8: Lead-level SMS aggregation ───────────────────────────────────
Lead_SMS AS (
  SELECT
    d.Full_prospect_id__c,
    SUM(outbound_cnt)  AS total_outbound_sms,
    SUM(inbound_cnt)   AS total_inbound_sms,
    MAX(CASE WHEN t.task_activity_date IS NOT NULL THEN 1 ELSE 0 END) AS had_true_double_tap,
    MIN(t.task_activity_date) AS first_double_tap_date
  FROM Daily_SMS d
  LEFT JOIN True_Double_Tap_Days t
    ON d.Full_prospect_id__c = t.Full_prospect_id__c
    AND d.task_activity_date = t.task_activity_date
  GROUP BY 1
),

-- ── Step 9: First SMS intent + link detection ────────────────────────────
First_SMS_Intent AS (
  SELECT
    fo.Full_prospect_id__c,
    ic.sms_intent                              AS first_sms_intent,
    ic.clean_body                              AS first_sms_body,
    REGEXP_CONTAINS(IFNULL(ic.clean_body, ''), r'https?://') AS first_sms_has_link
  FROM First_Outbound fo
  LEFT JOIN `savvy-gtm-analytics.savvy_analytics.sms_intent_classified` ic
    ON fo.first_sms_task_id = ic.task_id
)

-- ══════════════════════════════════════════════════════════════════════════
-- FINAL OUTPUT
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  c.Full_prospect_id__c,
  c.SGA_Owner_Name__c,
  c.Original_source,
  c.Channel_Grouping_Name,
  c.prospect_created_date,
  c.contacted_date,
  c.mql_date,
  c.sql_date,
  c.sqo_date,
  c.joined_date,

  -- Funnel flags (from vw_funnel_master — source of truth)
  c.is_contacted,
  c.is_mql,
  c.is_sql,
  c.is_sqo,
  c.is_joined,
  c.eligible_for_contacted_conversions,
  c.contacted_to_mql_progression,
  c.mql_to_sql_progression,
  c.sql_to_sqo_progression,
  c.sqo_to_joined_progression,
  c.Opportunity_AUM,

  -- SMS coverage
  CASE WHEN ls.Full_prospect_id__c IS NOT NULL THEN 1 ELSE 0 END AS received_any_sms,
  COALESCE(ls.total_outbound_sms, 0)   AS total_outbound_sms,
  COALESCE(ls.total_inbound_sms, 0)    AS total_inbound_sms,
  CASE WHEN ls.total_inbound_sms > 0 THEN 1 ELSE 0 END AS got_reply,

  -- First SMS timing
  fo.first_sms_task_id,
  fo.first_sms_date,
  fo.first_sms_datetime,
  DATE_DIFF(fo.first_sms_date, c.contacted_date, DAY) AS days_to_first_sms,
  CASE WHEN fo.first_sms_date = c.contacted_date THEN 1 ELSE 0 END AS first_sms_same_day,
  fo.first_sms_hour,
  CASE
    WHEN fo.first_sms_hour BETWEEN 6  AND 8  THEN 'Early Morning (6-8am)'
    WHEN fo.first_sms_hour BETWEEN 9  AND 11 THEN 'Morning (9-11am)'
    WHEN fo.first_sms_hour BETWEEN 12 AND 13 THEN 'Lunch (12-1pm)'
    WHEN fo.first_sms_hour BETWEEN 14 AND 16 THEN 'Afternoon (2-4pm)'
    WHEN fo.first_sms_hour BETWEEN 17 AND 19 THEN 'Evening (5-7pm)'
    ELSE 'Off Hours'
  END AS first_sms_time_bucket,
  fo.first_sms_dow_num,
  fo.first_sms_day_name,
  CASE WHEN fo.first_sms_dow_num IN (1, 7) THEN 'Weekend' ELSE 'Weekday' END AS first_sms_weekend_flag,

  -- First SMS speed bucket
  CASE
    WHEN DATE_DIFF(fo.first_sms_date, c.contacted_date, DAY) = 0 THEN 'Same Day'
    WHEN DATE_DIFF(fo.first_sms_date, c.contacted_date, DAY) = 1 THEN 'Next Day'
    WHEN DATE_DIFF(fo.first_sms_date, c.contacted_date, DAY) <= 3 THEN '2-3 Days'
    WHEN DATE_DIFF(fo.first_sms_date, c.contacted_date, DAY) <= 7 THEN '4-7 Days'
    ELSE '7+ Days'
  END AS first_sms_speed_bucket,

  -- First SMS content analysis (from sms_intent_classified)
  fsi.first_sms_intent,
  fsi.first_sms_has_link,

  -- Double tap
  COALESCE(ls.had_true_double_tap, 0) AS had_true_double_tap,
  DATE_DIFF(ls.first_double_tap_date, c.contacted_date, DAY) AS days_to_first_double_tap,
  CASE WHEN ls.first_double_tap_date = c.contacted_date THEN 1 ELSE 0 END AS double_tap_same_day_as_contact,

  -- Reply & response speed
  fi.first_reply_datetime,
  sr.response_datetime AS sga_response_datetime,
  DATETIME_DIFF(sr.response_datetime, fi.first_reply_datetime, MINUTE) AS response_time_minutes,
  CASE
    WHEN sr.response_datetime IS NULL AND fi.first_reply_datetime IS NOT NULL THEN 'No Response'
    WHEN DATETIME_DIFF(sr.response_datetime, fi.first_reply_datetime, MINUTE) <= 60 THEN 'Fast (<1hr)'
    WHEN DATETIME_DIFF(sr.response_datetime, fi.first_reply_datetime, MINUTE) <= 240 THEN 'Medium (1-4hr)'
    WHEN DATETIME_DIFF(sr.response_datetime, fi.first_reply_datetime, MINUTE) <= 1440 THEN 'Slow (4-24hr)'
    ELSE 'Very Slow (>24hr)'
  END AS response_speed_bucket,

  -- SGA tier
  COALESCE(t.sga_performance_tier, 'Unknown') AS sga_performance_tier,
  t.contacted_to_mql_rate                     AS sga_contacted_to_mql_rate,
  t.contacted_to_sqo_rate                     AS sga_contacted_to_sqo_rate

FROM Contacted_Leads c
LEFT JOIN Lead_SMS ls      ON c.Full_prospect_id__c = ls.Full_prospect_id__c
LEFT JOIN First_Outbound fo ON c.Full_prospect_id__c = fo.Full_prospect_id__c
LEFT JOIN First_Inbound fi  ON c.Full_prospect_id__c = fi.Full_prospect_id__c
LEFT JOIN SGA_Response sr   ON c.Full_prospect_id__c = sr.Full_prospect_id__c
LEFT JOIN First_SMS_Intent fsi ON c.Full_prospect_id__c = fsi.Full_prospect_id__c
LEFT JOIN SGA_Tiers t       ON c.SGA_Owner_Name__c = t.SGA_Owner_Name__c;
