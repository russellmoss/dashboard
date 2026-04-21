-- Denominator: all leads with attempted outreach (call or outgoing SMS) in last 180 days, not just meaningful connections.
-- Phone changes split into corrections (existing number replaced with different digits) vs populations (empty field filled for first time).

CREATE TEMP FUNCTION norm_phone(p STRING) AS (
  (SELECT IF(LENGTH(d) = 11 AND STARTS_WITH(d, '1'), SUBSTR(d, 2), d)
   FROM (SELECT REGEXP_REPLACE(COALESCE(p, ''), r'[^0-9]', '') AS d))
);

WITH
attempted_outreach AS (
  SELECT DISTINCT WhoId AS lead_id
  FROM `savvy-gtm-analytics.SavvyGTMData.Task`
  WHERE Type IN ('Call', 'Outgoing SMS')
    AND CreatedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)
    AND IsDeleted = FALSE
    AND WhoId IS NOT NULL
),

meaningful_connections AS (
  SELECT
    t.WhoId AS lead_id,
    MAX(CASE WHEN t.Type = 'Call' AND STARTS_WITH(LOWER(t.Description), 'answered') THEN 1 ELSE 0 END) AS had_answered_call,
    MAX(CASE WHEN t.Type = 'Incoming SMS'
      AND NOT REGEXP_CONTAINS(LOWER(COALESCE(REGEXP_EXTRACT(t.Description, r'Message:\s*(.*?)\s*\nFrom:'), '')),
          r'^(stop|unsubscribe|opt.?out)$')
      THEN 1 ELSE 0 END) AS had_meaningful_sms,
    COUNT(CASE WHEN t.Type = 'Call' AND STARTS_WITH(LOWER(t.Description), 'answered') THEN 1 END) AS total_answered_calls,
    COUNT(CASE WHEN t.Type = 'Incoming SMS'
      AND NOT REGEXP_CONTAINS(LOWER(COALESCE(REGEXP_EXTRACT(t.Description, r'Message:\s*(.*?)\s*\nFrom:'), '')),
          r'^(stop|unsubscribe|opt.?out)$')
      THEN 1 END) AS total_meaningful_sms_replies
  FROM `savvy-gtm-analytics.SavvyGTMData.Task` t
  WHERE t.CreatedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)
    AND t.IsDeleted = FALSE
    AND t.WhoId IS NOT NULL
    AND ((t.Type = 'Call' AND STARTS_WITH(LOWER(t.Description), 'answered'))
      OR (t.Type = 'Incoming SMS'
          AND NOT REGEXP_CONTAINS(LOWER(COALESCE(REGEXP_EXTRACT(t.Description, r'Message:\s*(.*?)\s*\nFrom:'), '')),
              r'^(stop|unsubscribe|opt.?out)$')))
  GROUP BY t.WhoId
),

phone_changes_all AS (
  SELECT LeadId, OldValue, NewValue, change_date, CreatedById, old_norm, new_norm,
    IF(old_norm != '', 'correction', 'population') AS change_type
  FROM (
    SELECT lh.LeadId, lh.OldValue, lh.NewValue, lh.CreatedDate AS change_date, lh.CreatedById,
      norm_phone(lh.OldValue) AS old_norm, norm_phone(lh.NewValue) AS new_norm
    FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory` lh
    WHERE lh.Field = 'MobilePhone'
      AND lh.CreatedDate >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 180 DAY)
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
  FROM phone_changes_all
  GROUP BY LeadId
),

tried_old AS (
  SELECT DISTINCT lcorr.LeadId
  FROM latest_correction lcorr
  JOIN `savvy-gtm-analytics.SavvyGTMData.Task` t
    ON lcorr.LeadId = t.WhoId
    AND t.IsDeleted = FALSE
    AND t.Type IN ('Call', 'Outgoing SMS')
    AND t.CreatedDate >= TIMESTAMP_SUB(lcorr.change_date, INTERVAL 7 DAY)
    AND t.CreatedDate < lcorr.change_date
),

connected_after_correction AS (
  SELECT DISTINCT lcorr.LeadId
  FROM latest_correction lcorr
  JOIN `savvy-gtm-analytics.SavvyGTMData.Task` t
    ON lcorr.LeadId = t.WhoId
    AND t.IsDeleted = FALSE
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
    ON lpop.LeadId = t.WhoId
    AND t.IsDeleted = FALSE
    AND t.CreatedDate > lpop.change_date
    AND ((t.Type = 'Call' AND STARTS_WITH(LOWER(t.Description), 'answered'))
      OR (t.Type = 'Incoming SMS'
          AND NOT REGEXP_CONTAINS(LOWER(COALESCE(REGEXP_EXTRACT(t.Description, r'Message:\s*(.*?)\s*\nFrom:'), '')),
              r'^(stop|unsubscribe|opt.?out)$')))
)

SELECT
  ao.lead_id,
  l.Name AS advisor_name,
  COALESCE(l.SGA_Owner_Name__c, 'Unknown') AS sga_name,
  COALESCE(l.LeadSource, 'Unknown') AS lead_source,
  l.Disposition__c AS disposition,
  l.MobilePhone AS current_mobile_phone,
  CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', ao.lead_id, '/view') AS lead_url,

  COALESCE(mc.had_answered_call, 0) AS had_answered_call,
  COALESCE(mc.had_meaningful_sms, 0) AS had_meaningful_sms,
  COALESCE(mc.total_answered_calls, 0) AS total_answered_calls,
  COALESCE(mc.total_meaningful_sms_replies, 0) AS total_meaningful_sms_replies,

  IF(COALESCE(cc.num_corrections, 0) > 0, 'YES', 'NO') AS phone_corrected,
  COALESCE(cc.num_corrections, 0) AS num_corrections,
  lcorr.OldValue AS latest_correction_old_number,
  lcorr.NewValue AS latest_correction_new_number,
  lcorr.change_date AS latest_correction_date,
  u_corr.Name AS latest_correction_by,

  IF(COALESCE(cc.num_populations, 0) > 0, 'YES', 'NO') AS phone_populated,
  COALESCE(cc.num_populations, 0) AS num_populations,
  lpop.NewValue AS latest_population_new_number,
  lpop.change_date AS latest_population_date,
  u_pop.Name AS latest_population_by,

  IF(tro.LeadId IS NOT NULL, 'YES', 'NO') AS tried_old_number_before_correction,
  IF(cac.LeadId IS NOT NULL, 'YES', 'NO') AS connected_after_correction,
  IF(cap.LeadId IS NOT NULL, 'YES', 'NO') AS connected_after_population,

  IF(l.Disposition__c = 'Wrong Phone Number - Contacted', 'YES', 'NO') AS is_wrong_number_disposition

FROM attempted_outreach ao
JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l ON ao.lead_id = l.Id
LEFT JOIN meaningful_connections mc ON ao.lead_id = mc.lead_id
LEFT JOIN latest_correction lcorr ON ao.lead_id = lcorr.LeadId
LEFT JOIN latest_population lpop ON ao.lead_id = lpop.LeadId
LEFT JOIN change_counts cc ON ao.lead_id = cc.LeadId
LEFT JOIN tried_old tro ON ao.lead_id = tro.LeadId
LEFT JOIN connected_after_correction cac ON ao.lead_id = cac.LeadId
LEFT JOIN connected_after_population cap ON ao.lead_id = cap.LeadId
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u_corr ON lcorr.CreatedById = u_corr.Id
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u_pop ON lpop.CreatedById = u_pop.Id

ORDER BY sga_name, advisor_name
