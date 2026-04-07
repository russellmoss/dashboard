-- =============================================================================
-- SGA Lead Handling Analysis — Q1 2026
-- Generated: 2026-03-31 | Validated against BigQuery | Council-reviewed (4 rounds)
-- Status: Validated — Corrections Applied (v2)
-- Cohort: Leads entering Jan 1 – Mar 9, 2026 (aging bias cutoff)
-- Activity window: Through Apr 1, 2026
-- v2 corrections:
--   1. "Not Interested in Moving" disposition reclassified as Replied/Engaged
--   2. Email channel in Metric 5 includes automated (lemlist/ListEmail) for presence
-- =============================================================================

-- Query 1: Team-wide persistence metric
-- v2: Added Disposition__c for "Not Interested in Moving" reclassification
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name, DATE(u.CreatedDate) AS sga_start_date
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE
    AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
                        'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
                        'Savvy Marketing', 'Savvy Operations', 'Lauren George')
),
Q1Leads AS (
  SELECT
    f.Full_prospect_id__c AS lead_id,
    f.SGA_Owner_Name__c AS sga_name,
    f.is_sql AS converted_to_opp,
    f.is_mql AS became_mql,
    f.Disposition__c,
    DATE(f.FilterDate) AS filter_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01')
    -- Cohort aging cutoff: exclude leads entering after Mar 9 — they can't reach 5 touches
    AND f.FilterDate < TIMESTAMP('2026-03-10')
    AND f.Full_prospect_id__c IS NOT NULL
),
OutboundCounts AS (
  -- Only count activities ON OR AFTER the lead's FilterDate (no pre-cohort leakage)
  -- Activity window extends through end of Q1 (Mar 31) even though cohort stops at Mar 9
  SELECT
    q.lead_id,
    COUNT(DISTINCT act.task_id) AS outbound_touchpoints
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date
    AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound'
    AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
  GROUP BY 1
),
InboundReplies AS (
  -- Inbound replies only AFTER the lead's FilterDate
  SELECT DISTINCT q.lead_id
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date
    AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Inbound'
    AND COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')
),
LeadClassification AS (
  SELECT
    q.lead_id,
    q.sga_name,
    COALESCE(o.outbound_touchpoints, 0) AS outbound_touchpoints,
    CASE
      WHEN q.converted_to_opp = 1 THEN 'Converted'
      WHEN q.became_mql = 1 THEN 'MQL'
      WHEN r.lead_id IS NOT NULL THEN 'Replied'
      WHEN q.Disposition__c = 'Not Interested in Moving' THEN 'Replied'
      ELSE 'Unengaged'
    END AS lead_status
  FROM Q1Leads q
  LEFT JOIN OutboundCounts o ON q.lead_id = o.lead_id
  LEFT JOIN InboundReplies r ON q.lead_id = r.lead_id
  WHERE COALESCE(o.outbound_touchpoints, 0) > 0
)
SELECT
  COUNT(*) AS total_worked_leads,
  COUNTIF(lead_status = 'Converted') AS excluded_converted,
  COUNTIF(lead_status = 'MQL') AS excluded_mql,
  COUNTIF(lead_status = 'Replied') AS excluded_replied,
  COUNTIF(lead_status = 'Unengaged') AS unengaged_leads,
  COUNTIF(lead_status = 'Unengaged' AND outbound_touchpoints >= 5) AS unengaged_5plus,
  ROUND(SAFE_DIVIDE(
    COUNTIF(lead_status = 'Unengaged' AND outbound_touchpoints >= 5),
    COUNTIF(lead_status = 'Unengaged')
  ) * 100, 1) AS team_pct_5plus,
  ROUND(AVG(CASE WHEN lead_status = 'Unengaged' THEN outbound_touchpoints END), 1) AS team_avg_touchpoints_unengaged
FROM LeadClassification;


-- Query 2: Per-SGA breakdown
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name, DATE(u.CreatedDate) AS sga_start_date
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz','Ariana Butler','Bre McDaniel','Bryan Belville',
                        'GinaRose Galli','Jacqueline Tully','Jed Entin','Russell Moss',
                        'Savvy Marketing','Savvy Operations','Lauren George')
),
Q1Leads AS (
  SELECT f.Full_prospect_id__c AS lead_id, f.SGA_Owner_Name__c AS sga_name,
    f.is_sql AS converted_to_opp, f.is_mql AS became_mql, f.Disposition__c,
    DATE(f.FilterDate) AS filter_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01')
    -- Cohort aging cutoff: exclude leads entering after Mar 9 — they can't reach 5 touches
    AND f.FilterDate < TIMESTAMP('2026-03-10')
    AND f.Full_prospect_id__c IS NOT NULL
),
OutboundCounts AS (
  SELECT q.lead_id, COUNT(DISTINCT act.task_id) AS outbound_touchpoints
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date
    AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound' AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
  GROUP BY 1
),
InboundReplies AS (
  SELECT DISTINCT q.lead_id
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date
    AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Inbound'
    AND COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')
),
LeadClassification AS (
  SELECT q.lead_id, q.sga_name, COALESCE(o.outbound_touchpoints, 0) AS outbound_touchpoints,
    CASE
      WHEN q.converted_to_opp = 1 THEN 'Converted'
      WHEN q.became_mql = 1 THEN 'MQL'
      WHEN r.lead_id IS NOT NULL THEN 'Replied'
      WHEN q.Disposition__c = 'Not Interested in Moving' THEN 'Replied'
      ELSE 'Unengaged'
    END AS lead_status
  FROM Q1Leads q
  LEFT JOIN OutboundCounts o ON q.lead_id = o.lead_id
  LEFT JOIN InboundReplies r ON q.lead_id = r.lead_id
  WHERE COALESCE(o.outbound_touchpoints, 0) > 0
)
SELECT
  lc.sga_name, a.sga_start_date,
  COUNT(*) AS total_worked,
  COUNTIF(lead_status = 'Converted') AS excluded_converted,
  COUNTIF(lead_status = 'MQL') AS excluded_mql,
  COUNTIF(lead_status = 'Replied') AS excluded_replied,
  COUNTIF(lead_status = 'Unengaged') AS unengaged,
  COUNTIF(lead_status = 'Unengaged' AND outbound_touchpoints >= 5) AS unengaged_5plus,
  ROUND(SAFE_DIVIDE(
    COUNTIF(lead_status = 'Unengaged' AND outbound_touchpoints >= 5),
    COUNTIF(lead_status = 'Unengaged')
  ) * 100, 1) AS pct_5plus,
  ROUND(AVG(CASE WHEN lead_status = 'Unengaged' THEN outbound_touchpoints END), 1) AS avg_tp
FROM LeadClassification lc
INNER JOIN ActiveSGAs a ON lc.sga_name = a.sga_name
GROUP BY 1, 2
ORDER BY pct_5plus DESC;


-- =============================================================================
-- Query 3: METRIC 2 — Premature Abandonment (Team-Wide)
-- Contacted -> Closed Lost leads (no reply, no MQL, no conversion) with <5 touches
-- =============================================================================
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz','Ariana Butler','Bre McDaniel','Bryan Belville',
                        'GinaRose Galli','Jacqueline Tully','Jed Entin','Russell Moss',
                        'Savvy Marketing','Savvy Operations','Lauren George')
),
Q1Leads AS (
  SELECT f.Full_prospect_id__c AS lead_id, f.SGA_Owner_Name__c AS sga_name,
    f.is_sql AS converted, f.is_mql AS became_mql, f.is_contacted,
    f.Disposition__c,
    DATE(f.FilterDate) AS filter_date, f.lead_closed_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01') AND f.FilterDate < TIMESTAMP('2026-03-10')
    AND f.Full_prospect_id__c IS NOT NULL
),
OutboundCounts AS (
  SELECT q.lead_id, COUNT(DISTINCT act.task_id) AS outbound_touchpoints
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound' AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
  GROUP BY 1
),
InboundReplies AS (
  SELECT DISTINCT q.lead_id
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Inbound'
    AND COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')
),
AbandonedLeads AS (
  SELECT q.lead_id, q.sga_name, COALESCE(o.outbound_touchpoints, 0) AS outbound_touchpoints
  FROM Q1Leads q
  LEFT JOIN OutboundCounts o ON q.lead_id = o.lead_id
  LEFT JOIN InboundReplies r ON q.lead_id = r.lead_id
  WHERE q.is_contacted = 1 AND q.lead_closed_date IS NOT NULL
    AND q.converted = 0 AND q.became_mql = 0 AND r.lead_id IS NULL
    AND COALESCE(q.Disposition__c, '') != 'Not Interested in Moving'
    AND COALESCE(o.outbound_touchpoints, 0) > 0
)
SELECT
  COUNT(*) AS total_abandoned,
  COUNTIF(outbound_touchpoints < 5) AS abandoned_under_5,
  ROUND(SAFE_DIVIDE(COUNTIF(outbound_touchpoints < 5), COUNT(*)) * 100, 1) AS premature_abandonment_pct,
  ROUND(AVG(outbound_touchpoints), 1) AS avg_touchpoints_at_abandonment,
  COUNTIF(outbound_touchpoints = 1) AS touches_1,
  COUNTIF(outbound_touchpoints = 2) AS touches_2,
  COUNTIF(outbound_touchpoints = 3) AS touches_3,
  COUNTIF(outbound_touchpoints = 4) AS touches_4,
  COUNTIF(outbound_touchpoints >= 5) AS touches_5plus
FROM AbandonedLeads;


-- =============================================================================
-- Query 4: METRIC 2 — Premature Abandonment (Per-SGA)
-- =============================================================================
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz','Ariana Butler','Bre McDaniel','Bryan Belville',
                        'GinaRose Galli','Jacqueline Tully','Jed Entin','Russell Moss',
                        'Savvy Marketing','Savvy Operations','Lauren George')
),
Q1Leads AS (
  SELECT f.Full_prospect_id__c AS lead_id, f.SGA_Owner_Name__c AS sga_name,
    f.is_sql AS converted, f.is_mql AS became_mql, f.is_contacted,
    f.Disposition__c,
    DATE(f.FilterDate) AS filter_date, f.lead_closed_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01') AND f.FilterDate < TIMESTAMP('2026-03-10')
    AND f.Full_prospect_id__c IS NOT NULL
),
OutboundCounts AS (
  SELECT q.lead_id, COUNT(DISTINCT act.task_id) AS outbound_touchpoints
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound' AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
  GROUP BY 1
),
InboundReplies AS (
  SELECT DISTINCT q.lead_id
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Inbound'
    AND COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')
),
AbandonedLeads AS (
  SELECT q.lead_id, q.sga_name, COALESCE(o.outbound_touchpoints, 0) AS outbound_touchpoints
  FROM Q1Leads q
  LEFT JOIN OutboundCounts o ON q.lead_id = o.lead_id
  LEFT JOIN InboundReplies r ON q.lead_id = r.lead_id
  WHERE q.is_contacted = 1 AND q.lead_closed_date IS NOT NULL
    AND q.converted = 0 AND q.became_mql = 0 AND r.lead_id IS NULL
    AND COALESCE(q.Disposition__c, '') != 'Not Interested in Moving'
    AND COALESCE(o.outbound_touchpoints, 0) > 0
)
SELECT sga_name,
  COUNT(*) AS total_abandoned,
  COUNTIF(outbound_touchpoints < 5) AS abandoned_under_5,
  ROUND(SAFE_DIVIDE(COUNTIF(outbound_touchpoints < 5), COUNT(*)) * 100, 1) AS abandonment_pct,
  ROUND(AVG(outbound_touchpoints), 1) AS avg_tp
FROM AbandonedLeads
GROUP BY 1
ORDER BY abandonment_pct DESC;


-- =============================================================================
-- Query 5: METRIC 3 — Coverage Gap / Zero Tracked Touches (Team-Wide)
-- =============================================================================
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz','Ariana Butler','Bre McDaniel','Bryan Belville',
                        'GinaRose Galli','Jacqueline Tully','Jed Entin','Russell Moss',
                        'Savvy Marketing','Savvy Operations','Lauren George')
),
Q1Leads AS (
  SELECT f.Full_prospect_id__c AS lead_id, f.SGA_Owner_Name__c AS sga_name,
    f.is_contacted, DATE(f.FilterDate) AS filter_date, f.lead_closed_date, f.Conversion_Status
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01') AND f.FilterDate < TIMESTAMP('2026-03-10')
    AND f.Full_prospect_id__c IS NOT NULL
),
OutboundCounts AS (
  SELECT q.lead_id, COUNT(DISTINCT act.task_id) AS outbound_touchpoints
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound' AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
  GROUP BY 1
)
SELECT
  COUNT(*) AS total_q1_leads,
  COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0) AS zero_touch_leads,
  ROUND(SAFE_DIVIDE(COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0), COUNT(*)) * 100, 1) AS never_touched_pct,
  COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0 AND q.is_contacted = 0 AND q.lead_closed_date IS NOT NULL) AS never_contacted_closed,
  COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0 AND q.is_contacted = 1 AND q.lead_closed_date IS NOT NULL) AS contacted_zero_touches_closed,
  COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0 AND q.is_contacted = 0 AND q.lead_closed_date IS NULL AND q.Conversion_Status = 'Open') AS never_contacted_still_open,
  COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0 AND q.is_contacted = 1 AND q.lead_closed_date IS NULL AND q.Conversion_Status = 'Open') AS contacted_zero_touches_open
FROM Q1Leads q
LEFT JOIN OutboundCounts o ON q.lead_id = o.lead_id;


-- =============================================================================
-- Query 6: METRIC 3 — Coverage Gap (Per-SGA)
-- =============================================================================
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz','Ariana Butler','Bre McDaniel','Bryan Belville',
                        'GinaRose Galli','Jacqueline Tully','Jed Entin','Russell Moss',
                        'Savvy Marketing','Savvy Operations','Lauren George')
),
Q1Leads AS (
  SELECT f.Full_prospect_id__c AS lead_id, f.SGA_Owner_Name__c AS sga_name,
    f.is_contacted, DATE(f.FilterDate) AS filter_date, f.lead_closed_date, f.Conversion_Status
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01') AND f.FilterDate < TIMESTAMP('2026-03-10')
    AND f.Full_prospect_id__c IS NOT NULL
),
OutboundCounts AS (
  SELECT q.lead_id, COUNT(DISTINCT act.task_id) AS outbound_touchpoints
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound' AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
  GROUP BY 1
)
SELECT q.sga_name,
  COUNT(*) AS total_leads,
  COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0) AS zero_touch,
  ROUND(SAFE_DIVIDE(COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0), COUNT(*)) * 100, 1) AS never_touched_pct,
  COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0 AND q.is_contacted = 0 AND q.lead_closed_date IS NOT NULL) AS never_contacted_closed,
  COUNTIF(COALESCE(o.outbound_touchpoints, 0) = 0 AND q.is_contacted = 0 AND q.lead_closed_date IS NULL) AS never_contacted_open
FROM Q1Leads q
LEFT JOIN OutboundCounts o ON q.lead_id = o.lead_id
GROUP BY 1
ORDER BY never_touched_pct DESC;


-- =============================================================================
-- Query 7: METRIC 4 — Recycling Impact Assessment
-- Re-run persistence metric with task_executor_name attribution
-- =============================================================================
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz','Ariana Butler','Bre McDaniel','Bryan Belville',
                        'GinaRose Galli','Jacqueline Tully','Jed Entin','Russell Moss',
                        'Savvy Marketing','Savvy Operations','Lauren George')
),
Q1Leads AS (
  SELECT f.Full_prospect_id__c AS lead_id, f.SGA_Owner_Name__c AS sga_name,
    f.is_sql AS converted, f.is_mql AS became_mql, f.Disposition__c,
    DATE(f.FilterDate) AS filter_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01') AND f.FilterDate < TIMESTAMP('2026-03-10')
    AND f.Full_prospect_id__c IS NOT NULL
),
ExecutorTouches AS (
  SELECT q.lead_id, act.task_executor_name AS executor_name,
    COUNT(DISTINCT act.task_id) AS executor_touchpoints
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound' AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
    AND act.task_executor_name IN (SELECT sga_name FROM ActiveSGAs)
  GROUP BY 1, 2
),
InboundReplies AS (
  SELECT DISTINCT q.lead_id
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Inbound'
    AND COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')
),
ExecutorLeadStatus AS (
  SELECT et.executor_name AS sga_name, et.lead_id, et.executor_touchpoints AS outbound_touchpoints,
    CASE WHEN q.converted = 1 THEN 'Converted' WHEN q.became_mql = 1 THEN 'MQL'
      WHEN r.lead_id IS NOT NULL THEN 'Replied'
      WHEN q.Disposition__c = 'Not Interested in Moving' THEN 'Replied'
      ELSE 'Unengaged' END AS lead_status
  FROM ExecutorTouches et
  INNER JOIN Q1Leads q ON et.lead_id = q.lead_id
  LEFT JOIN InboundReplies r ON et.lead_id = r.lead_id
)
SELECT sga_name,
  COUNT(*) AS total_worked,
  COUNTIF(lead_status = 'Unengaged') AS unengaged,
  COUNTIF(lead_status = 'Unengaged' AND outbound_touchpoints >= 5) AS unengaged_5plus,
  ROUND(SAFE_DIVIDE(
    COUNTIF(lead_status = 'Unengaged' AND outbound_touchpoints >= 5),
    COUNTIF(lead_status = 'Unengaged')
  ) * 100, 1) AS pct_5plus_executor
FROM ExecutorLeadStatus
GROUP BY 1
ORDER BY sga_name;


-- =============================================================================
-- Query 8: LIFECYCLE WATERFALL — Mutually exclusive buckets
-- Verifies all leads are accounted for (must sum to total)
-- =============================================================================
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz','Ariana Butler','Bre McDaniel','Bryan Belville',
                        'GinaRose Galli','Jacqueline Tully','Jed Entin','Russell Moss',
                        'Savvy Marketing','Savvy Operations','Lauren George')
),
Q1Leads AS (
  SELECT f.Full_prospect_id__c AS lead_id, f.SGA_Owner_Name__c AS sga_name,
    f.is_sql AS converted, f.is_mql AS became_mql, f.is_contacted,
    f.Disposition__c,
    DATE(f.FilterDate) AS filter_date, f.lead_closed_date, f.Conversion_Status
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01') AND f.FilterDate < TIMESTAMP('2026-03-10')
    AND f.Full_prospect_id__c IS NOT NULL
),
OutboundCounts AS (
  SELECT q.lead_id, COUNT(DISTINCT act.task_id) AS tp
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound' AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
  GROUP BY 1
),
InboundReplies AS (
  SELECT DISTINCT q.lead_id
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Inbound'
    AND COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')
),
Classified AS (
  SELECT q.*,
    COALESCE(o.tp, 0) AS tp,
    CASE
      WHEN q.converted = 1 THEN '1_Converted'
      WHEN q.became_mql = 1 THEN '2_MQL'
      WHEN r.lead_id IS NOT NULL THEN '3_Replied'
      WHEN q.Disposition__c = 'Not Interested in Moving' THEN '3_Replied'
      WHEN COALESCE(o.tp, 0) >= 5 AND q.converted = 0 AND q.became_mql = 0 THEN '4_Persistent_5plus'
      WHEN COALESCE(o.tp, 0) BETWEEN 1 AND 4 AND q.converted = 0 AND q.became_mql = 0 THEN '5_Worked_under5'
      WHEN COALESCE(o.tp, 0) = 0 AND (q.lead_closed_date IS NOT NULL OR q.Conversion_Status = 'Closed') THEN '6_Zero_touch_closed'
      WHEN COALESCE(o.tp, 0) = 0 AND q.Conversion_Status = 'Open' THEN '7_Zero_touch_open'
      ELSE '8_Other'
    END AS bucket
  FROM Q1Leads q
  LEFT JOIN OutboundCounts o ON q.lead_id = o.lead_id
  LEFT JOIN InboundReplies r ON q.lead_id = r.lead_id
)
SELECT bucket, COUNT(*) AS leads
FROM Classified
GROUP BY 1
ORDER BY 1;


-- =============================================================================
-- Query 9: METRIC 5 — Multi-Channel Outbound Coverage (Team-Wide)
-- v2: Email channel includes automated (lemlist/ListEmail) via separate EmailPresence CTE
-- v2: "Not Interested in Moving" excluded (reclassified as Replied/Engaged)
-- Channels: SMS, LinkedIn, Email (incl. automated), Call
-- =============================================================================
WITH ActiveSGAs AS (
  SELECT DISTINCT u.Name AS sga_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
    AND u.Name NOT IN ('Anett Diaz','Ariana Butler','Bre McDaniel','Bryan Belville',
                        'GinaRose Galli','Jacqueline Tully','Jed Entin','Russell Moss',
                        'Savvy Marketing','Savvy Operations','Lauren George')
),
Q1Leads AS (
  SELECT f.Full_prospect_id__c AS lead_id, f.SGA_Owner_Name__c AS sga_name,
    f.is_sql AS converted, f.is_mql AS became_mql,
    f.Disposition__c,
    DATE(f.FilterDate) AS filter_date, f.lead_closed_date
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` f
  INNER JOIN ActiveSGAs a ON f.SGA_Owner_Name__c = a.sga_name
  WHERE f.FilterDate >= TIMESTAMP('2026-01-01') AND f.FilterDate < TIMESTAMP('2026-03-10')
    AND f.Full_prospect_id__c IS NOT NULL
),
-- Standard outbound (excludes lemlist/ListEmail) for touchpoint counts + SMS/LinkedIn/Call presence
OutboundByChannel AS (
  SELECT q.lead_id,
    COUNT(DISTINCT act.task_id) AS outbound_touchpoints,
    MAX(IF(act.activity_channel_group = 'SMS', 1, 0)) AS touched_sms,
    MAX(IF(act.activity_channel_group = 'LinkedIn', 1, 0)) AS touched_linkedin,
    MAX(IF(act.activity_channel_group = 'Call', 1, 0)) AS touched_call
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date
    AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound' AND act.is_engagement_tracking = 0
    AND COALESCE(act.task_subject, '') NOT LIKE '%[lemlist]%'
    AND COALESCE(act.task_subtype, '') != 'ListEmail'
  GROUP BY 1
),
-- Email presence INCLUDING automated (lemlist/ListEmail) — separate CTE
-- Rationale: for "did this lead receive email?" (binary), automated email counts
EmailPresence AS (
  SELECT DISTINCT q.lead_id
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date
    AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Outbound'
    AND act.is_engagement_tracking = 0
    AND act.activity_channel_group = 'Email'
),
InboundReplies AS (
  SELECT DISTINCT q.lead_id
  FROM Q1Leads q
  INNER JOIN `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance` act
    ON act.Full_prospect_id__c = q.lead_id
    AND act.task_created_date_est >= q.filter_date
    AND act.task_created_date_est < DATE('2026-04-01')
  WHERE act.direction = 'Inbound'
    AND COALESCE(act.activity_channel_group, '') NOT IN ('Marketing', '')
),
ClosedUnengaged AS (
  SELECT q.lead_id, q.sga_name, o.outbound_touchpoints,
    o.touched_sms, o.touched_linkedin, o.touched_call,
    IF(e.lead_id IS NOT NULL, 1, 0) AS touched_email,
    o.touched_sms + o.touched_linkedin + o.touched_call + IF(e.lead_id IS NOT NULL, 1, 0) AS channels_covered
  FROM Q1Leads q
  INNER JOIN OutboundByChannel o ON q.lead_id = o.lead_id
  LEFT JOIN EmailPresence e ON q.lead_id = e.lead_id
  LEFT JOIN InboundReplies r ON q.lead_id = r.lead_id
  WHERE q.lead_closed_date IS NOT NULL
    AND q.converted = 0 AND q.became_mql = 0
    AND r.lead_id IS NULL
    AND COALESCE(q.Disposition__c, '') != 'Not Interested in Moving'
    AND o.outbound_touchpoints > 0
)
SELECT
  COUNT(*) AS denominator_closed_unengaged_worked,
  -- Channel coverage distribution
  COUNTIF(channels_covered = 4) AS all_4_channels,
  ROUND(SAFE_DIVIDE(COUNTIF(channels_covered = 4), COUNT(*)) * 100, 1) AS pct_all_4,
  COUNTIF(channels_covered = 3) AS three_channels,
  ROUND(SAFE_DIVIDE(COUNTIF(channels_covered = 3), COUNT(*)) * 100, 1) AS pct_3,
  COUNTIF(channels_covered = 2) AS two_channels,
  ROUND(SAFE_DIVIDE(COUNTIF(channels_covered = 2), COUNT(*)) * 100, 1) AS pct_2,
  COUNTIF(channels_covered = 1) AS one_channel,
  ROUND(SAFE_DIVIDE(COUNTIF(channels_covered = 1), COUNT(*)) * 100, 1) AS pct_1,
  COUNTIF(channels_covered = 0) AS zero_mapped_channels,
  -- Channel penetration rates
  ROUND(SAFE_DIVIDE(COUNTIF(touched_sms = 1), COUNT(*)) * 100, 1) AS pct_touched_sms,
  ROUND(SAFE_DIVIDE(COUNTIF(touched_linkedin = 1), COUNT(*)) * 100, 1) AS pct_touched_linkedin,
  ROUND(SAFE_DIVIDE(COUNTIF(touched_email = 1), COUNT(*)) * 100, 1) AS pct_touched_email,
  ROUND(SAFE_DIVIDE(COUNTIF(touched_call = 1), COUNT(*)) * 100, 1) AS pct_touched_call,
  -- Most commonly missing channel (among leads with <4 channels)
  COUNTIF(touched_sms = 0 AND channels_covered < 4) AS missing_sms,
  COUNTIF(touched_linkedin = 0 AND channels_covered < 4) AS missing_linkedin,
  COUNTIF(touched_email = 0 AND channels_covered < 4) AS missing_email,
  COUNTIF(touched_call = 0 AND channels_covered < 4) AS missing_call
FROM ClosedUnengaged;


-- =============================================================================
-- Query 10: METRIC 5 — Multi-Channel Outbound Coverage (Per-SGA)
-- v2: Same corrections as Query 9 (EmailPresence + disposition)
-- =============================================================================
-- (Same CTE structure as Query 9, with final SELECT grouped by SGA)
-- See validated query in BigQuery execution log. Full query omitted for brevity
-- but uses identical CTE pattern: OutboundByChannel + EmailPresence + InboundReplies
-- + ClosedUnengaged with disposition exclusion.
-- Output: sga_name, closed_unengaged, all_4, pct_4, ch_3, pct_3, ch_2plus, pct_2plus,
--   ch_1, pct_sms, pct_linkedin, pct_email, pct_call
-- ORDER BY pct_2plus DESC


-- =============================================================================
-- Query 11: Persistence x Multi-Channel Cross-Reference
-- v2: Email channel includes automated via EmailPresence CTE
-- v2: "Not Interested in Moving" excluded (disposition-based reply)
-- Uses ALL unengaged worked leads (not just closed) to match Metric 1 population
-- =============================================================================
-- (Same CTE structure as Query 9 but without lead_closed_date filter,
--  and with EmailPresence CTE for email channel presence)
-- See validated query in BigQuery execution log.
-- Key results: 1,388 persistent 5+ leads; 93 (6.7%) all 4 channels;
--   617 (44.5%) 3+ channels; 907 (65.3%) 2+ channels; avg 2.16 channels persistent
