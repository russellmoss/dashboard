-- Quarterly cohort analysis: leads assigned to the quarter of their first outreach attempt (2025-01-01 to 2026-03-31).
-- Phone changes split into corrections (existing number replaced) vs populations (empty field filled). All downstream signals are lifetime — not restricted to the quarter.

CREATE TEMP FUNCTION norm_phone(p STRING) AS (
  (SELECT IF(LENGTH(d) = 11 AND STARTS_WITH(d, '1'), SUBSTR(d, 2), d)
   FROM (SELECT REGEXP_REPLACE(COALESCE(p, ''), r'[^0-9]', '') AS d))
);

WITH
-- Assign each lead to a quarter based on first outreach attempt
attempted_outreach AS (
  SELECT
    WhoId AS lead_id,
    CASE
      WHEN MIN(CreatedDate) >= '2025-01-01' AND MIN(CreatedDate) < '2025-04-01' THEN 'Q1 2025'
      WHEN MIN(CreatedDate) >= '2025-04-01' AND MIN(CreatedDate) < '2025-07-01' THEN 'Q2 2025'
      WHEN MIN(CreatedDate) >= '2025-07-01' AND MIN(CreatedDate) < '2025-10-01' THEN 'Q3 2025'
      WHEN MIN(CreatedDate) >= '2025-10-01' AND MIN(CreatedDate) < '2026-01-01' THEN 'Q4 2025'
      WHEN MIN(CreatedDate) >= '2026-01-01' AND MIN(CreatedDate) < '2026-04-01' THEN 'Q1 2026'
    END AS quarter
  FROM `savvy-gtm-analytics.SavvyGTMData.Task`
  WHERE Type IN ('Call', 'Outgoing SMS')
    AND CreatedDate >= '2025-01-01' AND CreatedDate < '2026-04-01'
    AND IsDeleted = FALSE AND WhoId IS NOT NULL
  GROUP BY WhoId
  HAVING quarter IS NOT NULL
),

-- Meaningful connections: ALL tasks for these leads (no date restriction — cohort-based)
meaningful_connections AS (
  SELECT
    t.WhoId AS lead_id,
    MAX(CASE WHEN t.Type = 'Call' AND STARTS_WITH(LOWER(t.Description), 'answered') THEN 1 ELSE 0 END) AS had_answered_call,
    MAX(CASE WHEN t.Type = 'Incoming SMS'
      AND NOT REGEXP_CONTAINS(LOWER(COALESCE(REGEXP_EXTRACT(t.Description, r'Message:\s*(.*?)\s*\nFrom:'), '')),
          r'^(stop|unsubscribe|opt.?out)$')
      THEN 1 ELSE 0 END) AS had_meaningful_sms
  FROM `savvy-gtm-analytics.SavvyGTMData.Task` t
  WHERE t.IsDeleted = FALSE AND t.WhoId IS NOT NULL
    AND ((t.Type = 'Call' AND STARTS_WITH(LOWER(t.Description), 'answered'))
      OR (t.Type = 'Incoming SMS'
          AND NOT REGEXP_CONTAINS(LOWER(COALESCE(REGEXP_EXTRACT(t.Description, r'Message:\s*(.*?)\s*\nFrom:'), '')),
              r'^(stop|unsubscribe|opt.?out)$')))
  GROUP BY t.WhoId
),

-- Phone changes: ALL history for these leads (no date restriction — cohort-based)
phone_changes_all AS (
  SELECT LeadId, OldValue, NewValue, change_date, CreatedById, old_norm, new_norm,
    IF(old_norm != '', 'correction', 'population') AS change_type
  FROM (
    SELECT lh.LeadId, lh.OldValue, lh.NewValue, lh.CreatedDate AS change_date, lh.CreatedById,
      norm_phone(lh.OldValue) AS old_norm, norm_phone(lh.NewValue) AS new_norm
    FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory` lh
    WHERE lh.Field = 'MobilePhone'
      AND norm_phone(lh.OldValue) != norm_phone(lh.NewValue)
  ) WHERE new_norm != ''
),

latest_correction AS (
  SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY LeadId ORDER BY change_date DESC) AS rn
    FROM phone_changes_all WHERE change_type = 'correction'
  ) WHERE rn = 1
),

latest_population AS (
  SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY LeadId ORDER BY change_date DESC) AS rn
    FROM phone_changes_all WHERE change_type = 'population'
  ) WHERE rn = 1
),

change_counts AS (
  SELECT LeadId,
    COUNTIF(change_type = 'correction') AS num_corrections,
    COUNTIF(change_type = 'population') AS num_populations
  FROM phone_changes_all GROUP BY LeadId
),

tried_old AS (
  SELECT DISTINCT lcorr.LeadId
  FROM latest_correction lcorr
  JOIN `savvy-gtm-analytics.SavvyGTMData.Task` t
    ON lcorr.LeadId = t.WhoId AND t.IsDeleted = FALSE
    AND t.Type IN ('Call', 'Outgoing SMS')
    AND t.CreatedDate >= TIMESTAMP_SUB(lcorr.change_date, INTERVAL 7 DAY)
    AND t.CreatedDate < lcorr.change_date
),

connected_after_correction AS (
  SELECT DISTINCT lcorr.LeadId
  FROM latest_correction lcorr
  JOIN `savvy-gtm-analytics.SavvyGTMData.Task` t
    ON lcorr.LeadId = t.WhoId AND t.IsDeleted = FALSE
    AND t.CreatedDate > lcorr.change_date
    AND ((t.Type = 'Call' AND STARTS_WITH(LOWER(t.Description), 'answered'))
      OR (t.Type = 'Incoming SMS'
          AND NOT REGEXP_CONTAINS(LOWER(COALESCE(REGEXP_EXTRACT(t.Description, r'Message:\s*(.*?)\s*\nFrom:'), '')),
              r'^(stop|unsubscribe|opt.?out)$')))
),

connected_after_population AS (
  SELECT DISTINCT lpop.LeadId
  FROM latest_population lpop
  JOIN `savvy-gtm-analytics.SavvyGTMData.Task` t
    ON lpop.LeadId = t.WhoId AND t.IsDeleted = FALSE
    AND t.CreatedDate > lpop.change_date
    AND ((t.Type = 'Call' AND STARTS_WITH(LOWER(t.Description), 'answered'))
      OR (t.Type = 'Incoming SMS'
          AND NOT REGEXP_CONTAINS(LOWER(COALESCE(REGEXP_EXTRACT(t.Description, r'Message:\s*(.*?)\s*\nFrom:'), '')),
              r'^(stop|unsubscribe|opt.?out)$')))
),

base AS (
  SELECT
    ao.quarter,
    ao.lead_id,
    COALESCE(l.SGA_Owner_Name__c, 'Unknown') AS sga_name,
    COALESCE(mc.had_answered_call, 0) AS had_answered_call,
    COALESCE(mc.had_meaningful_sms, 0) AS had_meaningful_sms,
    IF(COALESCE(mc.had_answered_call, 0) = 1 OR COALESCE(mc.had_meaningful_sms, 0) = 1, 1, 0) AS had_meaningful_connection,
    IF(COALESCE(cc.num_corrections, 0) > 0, 1, 0) AS phone_corrected,
    IF(COALESCE(cc.num_populations, 0) > 0, 1, 0) AS phone_populated,
    IF(tro.LeadId IS NOT NULL, 1, 0) AS tried_old_first,
    IF(cac.LeadId IS NOT NULL, 1, 0) AS connected_after_correction,
    IF(cap.LeadId IS NOT NULL, 1, 0) AS connected_after_population,
    IF(l.Disposition__c = 'Wrong Phone Number - Contacted', 1, 0) AS wrong_number_disp
  FROM attempted_outreach ao
  JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l ON ao.lead_id = l.Id
  LEFT JOIN meaningful_connections mc ON ao.lead_id = mc.lead_id
  LEFT JOIN change_counts cc ON ao.lead_id = cc.LeadId
  LEFT JOIN tried_old tro ON ao.lead_id = tro.LeadId
  LEFT JOIN connected_after_correction cac ON ao.lead_id = cac.LeadId
  LEFT JOIN connected_after_population cap ON ao.lead_id = cap.LeadId
)

-- ORG-WIDE per quarter
SELECT
  quarter,
  'ORG-WIDE' AS sga_name,
  COUNT(*) AS total_attempted,
  SUM(had_meaningful_connection) AS had_meaningful_connection,
  ROUND(SAFE_DIVIDE(SUM(had_meaningful_connection), COUNT(*)) * 100, 1) AS pct_connected,
  SUM(had_answered_call) AS via_answered_call,
  SUM(had_meaningful_sms) AS via_sms_reply,
  SUM(phone_corrected) AS num_corrected_leads,
  ROUND(SAFE_DIVIDE(SUM(phone_corrected), COUNT(*)) * 100, 1) AS pct_phone_corrected,
  SUM(phone_populated) AS num_populated_leads,
  ROUND(SAFE_DIVIDE(SUM(phone_populated), COUNT(*)) * 100, 1) AS pct_phone_populated,
  SUM(tried_old_first) AS tried_old_then_corrected,
  ROUND(SAFE_DIVIDE(SUM(tried_old_first), NULLIF(SUM(phone_corrected), 0)) * 100, 1) AS pct_tried_before_correcting,
  SUM(connected_after_correction) AS connected_after_correction,
  SUM(connected_after_population) AS connected_after_population,
  SUM(wrong_number_disp) AS wrong_number_disposition,
  ROUND(SAFE_DIVIDE(SUM(wrong_number_disp), COUNT(*)) * 100, 2) AS wrong_number_pct_of_all,
  ROUND(SAFE_DIVIDE(SUM(wrong_number_disp), NULLIF(SUM(had_meaningful_connection), 0)) * 100, 2) AS wrong_number_pct_of_connected,
  ROUND(SAFE_DIVIDE(SUM(wrong_number_disp), NULLIF(SUM(phone_corrected), 0)) * 100, 1) AS wrong_number_pct_of_corrected
FROM base
GROUP BY quarter

UNION ALL

-- Per-SGA per quarter
SELECT
  quarter, sga_name,
  COUNT(*), SUM(had_meaningful_connection),
  ROUND(SAFE_DIVIDE(SUM(had_meaningful_connection), COUNT(*)) * 100, 1),
  SUM(had_answered_call), SUM(had_meaningful_sms),
  SUM(phone_corrected), ROUND(SAFE_DIVIDE(SUM(phone_corrected), COUNT(*)) * 100, 1),
  SUM(phone_populated), ROUND(SAFE_DIVIDE(SUM(phone_populated), COUNT(*)) * 100, 1),
  SUM(tried_old_first), ROUND(SAFE_DIVIDE(SUM(tried_old_first), NULLIF(SUM(phone_corrected), 0)) * 100, 1),
  SUM(connected_after_correction), SUM(connected_after_population),
  SUM(wrong_number_disp),
  ROUND(SAFE_DIVIDE(SUM(wrong_number_disp), COUNT(*)) * 100, 2),
  ROUND(SAFE_DIVIDE(SUM(wrong_number_disp), NULLIF(SUM(had_meaningful_connection), 0)) * 100, 2),
  ROUND(SAFE_DIVIDE(SUM(wrong_number_disp), NULLIF(SUM(phone_corrected), 0)) * 100, 1)
FROM base
GROUP BY quarter, sga_name

ORDER BY
  CASE quarter
    WHEN 'Q1 2025' THEN 1
    WHEN 'Q2 2025' THEN 2
    WHEN 'Q3 2025' THEN 3
    WHEN 'Q4 2025' THEN 4
    WHEN 'Q1 2026' THEN 5
  END,
  IF(sga_name = 'ORG-WIDE', 0, 1),
  total_attempted DESC
