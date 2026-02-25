-- T3 Conference Enrichment View
-- Adds crm_replied, crm_lead_nurture, crm_opp_planned_nurture, crm_sql, crm_sqo to ml_features.T3-conference.
-- See t3-enrichment-exploration.md for definitions.
-- Lead nurture: Status LIKE '%Nurture%' (update when team confirms exact Lead field/values).

CREATE OR REPLACE VIEW `savvy-gtm-analytics.ml_features.T3_conference_enriched` AS
WITH t3_parsed AS (
  SELECT
    t.*,
    COALESCE(
      REGEXP_EXTRACT(CAST(t.lead_url AS STRING), r'/([0-9A-Za-z]{18})/?'),
      CASE WHEN SUBSTR(CAST(t.CRM_ID AS STRING), 1, 3) = '00Q' THEN CAST(t.CRM_ID AS STRING) END
    ) AS _lead_id,
    COALESCE(
      REGEXP_EXTRACT(CAST(t.opp_url AS STRING), r'/([0-9A-Za-z]{18})/?'),
      CASE WHEN SUBSTR(CAST(t.CRM_ID AS STRING), 1, 3) = '006' THEN CAST(t.CRM_ID AS STRING) END
    ) AS _opp_id_t3
  FROM `savvy-gtm-analytics.ml_features.T3-conference` t
),
with_conv_opp AS (
  SELECT
    p.*,
    l.ConvertedOpportunityId AS _conv_opp_id
  FROM t3_parsed p
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l
    ON l.Id = p._lead_id AND l.IsDeleted = FALSE
),
with_opp_id AS (
  SELECT
    *,
    COALESCE(_opp_id_t3, _conv_opp_id) AS _opp_id
  FROM with_conv_opp
),
enrich AS (
  SELECT
    w.person_id,
    w._lead_id,
    w._opp_id,
    CASE WHEN l.Id IS NOT NULL AND l.IsConverted = TRUE THEN TRUE ELSE FALSE END AS crm_sql,
    -- Lead nurture: Status contains 'Nurture' (update when team confirms exact values)
    CASE WHEN l.Id IS NOT NULL AND LOWER(TRIM(CAST(l.Status AS STRING))) LIKE '%nurture%' THEN TRUE ELSE FALSE END AS crm_lead_nurture,
    CASE WHEN o.Id IS NOT NULL AND LOWER(TRIM(CAST(o.SQL__c AS STRING))) = 'yes' AND (o.RecordTypeId = '012Dn000000mrO3IAI' OR o.RecordTypeId IS NULL) THEN TRUE ELSE FALSE END AS crm_sqo,
    CASE WHEN o.Id IS NOT NULL AND (CAST(o.StageName AS STRING) = 'Planned Nurture' OR o.Stage_Entered_Planned_Nurture__c IS NOT NULL) THEN TRUE ELSE FALSE END AS crm_opp_planned_nurture
  FROM with_opp_id w
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Lead` l ON l.Id = w._lead_id AND l.IsDeleted = FALSE
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Opportunity` o ON o.Id = w._opp_id AND o.IsDeleted = FALSE
),
replied AS (
  SELECT DISTINCT
    w.person_id
  FROM with_opp_id w
  INNER JOIN `savvy-gtm-analytics.SavvyGTMData.Task` t
    ON t.IsDeleted = FALSE
   AND (t.WhoId = w._lead_id OR t.WhatId = w._opp_id)
   AND (t.Subject LIKE '%replied%' OR t.Subject LIKE '%Incoming%' OR t.Subject LIKE '%Inbound%'
        OR (t.Subject LIKE '%answered%' AND (t.Subject NOT LIKE '%missed%' OR t.Subject IS NULL)))
)
SELECT
  w.person_id,
  w.first_name,
  w.last_name,
  w.full_name,
  w.crd,
  w.company,
  w.fintrx_firm_crd,
  w.email,
  w.phone,
  w.address,
  w.city,
  w.state,
  w.zip,
  w.country,
  w.attendee_type,
  w.linkedin_url,
  w.confidence,
  w.fintrx_producing_advisor,
  w.lead_status,
  w.lead_disposition,
  w.lead_url,
  w.CRM_ID,
  w.opp_stage,
  w.opp_is_closed,
  w.opp_is_won,
  w.opp_closed_lost_reason,
  w.opp_closed_lost_details,
  w.opp_url,
  w.match_tier,
  w.match_confidence,
  w.match_status,
  e.crm_sql,
  e.crm_lead_nurture,
  e.crm_opp_planned_nurture,
  e.crm_sqo,
  CASE WHEN r.person_id IS NOT NULL THEN TRUE ELSE FALSE END AS crm_replied,
  (e.crm_lead_nurture OR e.crm_opp_planned_nurture) AS crm_any_nurture
FROM with_opp_id w
LEFT JOIN enrich e ON e.person_id = w.person_id
LEFT JOIN replied r ON r.person_id = w.person_id;
