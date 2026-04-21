-- ============================================================================
-- vw_lead_primary_sga   (Tableau_Views — Phase 2.8 promoted)
--
-- Promotion note (2026-04-21, Phase 2.8)
-- --------------------------------------
-- This DDL now targets the production `Tableau_Views` dataset. The
-- `Tableau_Views_Dev.vw_lead_primary_sga` view built in Phase 2.7 is
-- retained in BigQuery as a diagnostic snapshot but is no longer the
-- source of truth — this file is. The two dataset references changed
-- from Dev to prod are: (1) the CREATE OR REPLACE target and (2) the
-- ref_non_sga_users LEFT JOIN. No view logic changed.
-- Validation: docs/attribution-validation-phase2_8.md.
--
-- Purpose
-- -------
-- Thin derivation over Lead + LeadHistory that assigns ONE primary SGA per
-- lead, so that vw_funnel_master JOIN vw_lead_primary_sga preserves the
-- existing lead-level aggregate rate by construction while fixing the
-- Savvy-Operations sweep attribution bug documented in
-- docs/attribution-design.md.
--
-- Consolidation note (2026-04-21, Phase 2.7)
-- ------------------------------------------
-- This view previously JOINed `Tableau_Views_Dev.vw_ownership_periods`.
-- For production simplicity the period-construction logic has been inlined
-- below as CTEs (sections 1–8). `vw_ownership_periods` remains in
-- BigQuery for diagnostic use during Phase 3 rollout but is NO LONGER
-- referenced by this view. It can be dropped after Phase 3 ships.
--
-- Validation of the consolidation — row-count identity + per-column
-- equality vs the pre-consolidation output — is in
-- docs/attribution-validation-phase2_7.md.
--
-- Design pivot (Phase 2.6 task brief, 2026-04-21)
-- -----------------------------------------------
-- Per-lead grain rejected the v1.5 at-bat grain (which multiplied the
-- denominator by ~35 % and was contaminated by bulk-status artifacts —
-- see docs/attribution-v1.5-feasibility.md). Per-lead preserves the
-- unfiltered dashboard rate exactly because the join is 1:1 and no
-- lead-level flag changes.
--
-- Grain
-- -----
-- One row per lead_id. Lead-era only.
--
-- Assignment rules (per Russell's Phase 2.6 task brief)
-- -----------------------------------------------------
-- Rule 1. If lead_mql_stage_entered_ts IS NOT NULL:
--   primary_sga = the real SGA (is_real_sga = TRUE) whose ownership period
--   contains the MQL timestamp (period_start <= mql_ts < period_end).
--   If no real-SGA period contains it → primary_sga IS NULL and
--   is_orphan_mql = TRUE. Reason = 'orphan'.
--
-- Rule 2. Else (no MQL):
--   primary_sga = owner of the most recent period where is_real_sga = TRUE.
--   If no such period exists → primary_sga IS NULL. Reason = 'none'.
--
-- Reason codes
-- ------------
--   'mql_time'                    — Rule 1 match
--   'last_real_sga_before_close'  — Rule 2 match, lead terminated
--   'last_real_sga_still_open'    — Rule 2 match, lead still open
--   'orphan'                      — MQL present but no real-SGA period contained it
--   'none'                        — No MQL, no real-SGA period ever existed
--
-- Inlined v1 limitations (from vw_ownership_periods header)
-- ---------------------------------------------------------
-- * Owner reassignment only. Stage_Entered_New__c recycles are NOT
--   reconstructed — vw_funnel_master exposes only the latest recycle lap's
--   stage timestamps, so prior-lap attribution is not available.
-- * `is_real_sga` uses `User.IsSGA__c` CURRENT value (User is not
--   history-tracked). Stable in practice — flag is sticky per role.
-- * LeadHistory retention begins 2024-10-15. Leads whose first owner
--   change predates that carry a single reconstructed period from
--   Lead.CreatedDate to first observed change. Exposed via
--   `has_complete_history` flag.
-- * Queues not observed in OwnerId (100% User prefix 005). If queues
--   appear later, they classify as is_real_sga = FALSE.
--
-- Consumers
-- ---------
-- Phase 3 dashboard filter-helpers.ts will JOIN:
--   JOIN vw_lead_primary_sga p ON p.lead_id = v.Full_prospect_id__c
-- and apply the SGA multi-select as:
--   WHERE p.primary_sga_name IN UNNEST(@sgas)
-- replacing the current
--   WHERE v.SGA_Owner_Name__c IN UNNEST(@sgas)
-- which was the source of the Savvy-Ops-sweep distortion.
--
-- Design doc: docs/attribution-design.md
-- Phase 2 validation: docs/attribution-validation-phase2.md
-- Phase 2.6 validation: docs/attribution-validation-phase2_6.md
-- Phase 2.7 consolidation validation: docs/attribution-validation-phase2_7.md
-- Russell open-question decisions: §9 Q1 denylist, Q2 v1 reassign-only,
--   Q3 non-SGA=FALSE, Q4 flag-don't-hide, Q5 lead-era-only, Q6 view-first.
-- ============================================================================

CREATE OR REPLACE VIEW `savvy-gtm-analytics.Tableau_Views.vw_lead_primary_sga` AS

WITH
-- ---------------------------------------------------------------------------
-- 1. Lead base: lead-level facts
-- ---------------------------------------------------------------------------
lead_base AS (
  SELECT
    l.Id                               AS lead_id,
    l.OwnerId                          AS current_owner_id,
    l.CreatedDate                      AS lead_created_ts,
    l.Stage_Entered_Contacting__c      AS lead_stage_entered_contacting_ts,
    l.Stage_Entered_Call_Scheduled__c  AS lead_mql_stage_entered_ts,
    l.Stage_Entered_New__c             AS lead_stage_entered_new_ts,
    l.Stage_Entered_Closed__c          AS lead_stage_entered_closed_ts,
    l.ConvertedDate                    AS lead_converted_date,
    l.IsConverted                      AS lead_is_converted,
    l.Final_Source__c                  AS lead_final_source
  FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
  WHERE l.IsDeleted = FALSE
),

-- ---------------------------------------------------------------------------
-- 2. Terminal event per lead — when lead-era ends
-- ---------------------------------------------------------------------------
-- Precedence: converted > closed_lost > still_open (CURRENT_TIMESTAMP).
-- Closed_lost only honored if it is the LATEST stage event; otherwise
-- the lead was reopened (recycled) and treated as still_open.
-- Converted: terminal at END of ConvertedDate (DATE→TIMESTAMP is midnight,
-- but MQL/activities can fire later the same day — add 1 day).
lead_terminal AS (
  SELECT
    lb.*,
    CASE
      WHEN lb.lead_is_converted AND lb.lead_converted_date IS NOT NULL
        THEN TIMESTAMP_ADD(TIMESTAMP(lb.lead_converted_date), INTERVAL 1 DAY)
      WHEN lb.lead_stage_entered_closed_ts IS NOT NULL
           AND lb.lead_stage_entered_closed_ts >= GREATEST(
             IFNULL(lb.lead_stage_entered_new_ts,         TIMESTAMP('1900-01-01')),
             IFNULL(lb.lead_stage_entered_contacting_ts,  TIMESTAMP('1900-01-01')),
             IFNULL(lb.lead_mql_stage_entered_ts,         TIMESTAMP('1900-01-01'))
           )
        THEN lb.lead_stage_entered_closed_ts
      ELSE CURRENT_TIMESTAMP()
    END AS terminal_ts,
    CASE
      WHEN lb.lead_is_converted AND lb.lead_converted_date IS NOT NULL THEN 'converted'
      WHEN lb.lead_stage_entered_closed_ts IS NOT NULL
           AND lb.lead_stage_entered_closed_ts >= GREATEST(
             IFNULL(lb.lead_stage_entered_new_ts,         TIMESTAMP('1900-01-01')),
             IFNULL(lb.lead_stage_entered_contacting_ts,  TIMESTAMP('1900-01-01')),
             IFNULL(lb.lead_mql_stage_entered_ts,         TIMESTAMP('1900-01-01'))
           ) THEN 'closed_lost'
      ELSE                                                                  'still_open'
    END AS terminal_reason
  FROM lead_base lb
),

-- ---------------------------------------------------------------------------
-- 3. Owner changes (Id-form only) — dedup paired Name rows
-- ---------------------------------------------------------------------------
owner_changes AS (
  SELECT
    LeadId       AS lead_id,
    CreatedDate  AS event_ts,
    OldValue     AS prior_owner_id,
    NewValue     AS new_owner_id
  FROM `savvy-gtm-analytics.SavvyGTMData.LeadHistory`
  WHERE Field = 'Owner'
    AND IsDeleted = FALSE
    AND NewValue IS NOT NULL
    AND REGEXP_CONTAINS(NewValue, r'^005')
),

-- Seed the first period's owner: earliest LeadHistory change's OldValue,
-- or Lead.OwnerId if the lead has no Owner changes in the retention window.
seed_owner AS (
  SELECT
    lead_id,
    ARRAY_AGG(prior_owner_id ORDER BY event_ts ASC LIMIT 1)[OFFSET(0)] AS seed_owner_id
  FROM owner_changes
  WHERE REGEXP_CONTAINS(prior_owner_id, r'^005')
  GROUP BY lead_id
),

-- ---------------------------------------------------------------------------
-- 4. Transition events = lead creation + each owner change
-- ---------------------------------------------------------------------------
transitions AS (
  -- Creation event
  SELECT
    lt.lead_id,
    lt.lead_created_ts  AS event_ts,
    COALESCE(so.seed_owner_id, lt.current_owner_id)  AS owner_id,
    0                   AS event_order
  FROM lead_terminal lt
  LEFT JOIN seed_owner so ON so.lead_id = lt.lead_id
  WHERE COALESCE(so.seed_owner_id, lt.current_owner_id) IS NOT NULL

  UNION ALL

  -- Each reassignment
  SELECT
    oc.lead_id,
    oc.event_ts,
    oc.new_owner_id      AS owner_id,
    1                    AS event_order
  FROM owner_changes oc
),

-- ---------------------------------------------------------------------------
-- 5. Build periods via LEAD() window
-- ---------------------------------------------------------------------------
periods_raw AS (
  SELECT
    t.lead_id,
    t.event_ts                     AS period_start,
    t.owner_id                     AS owner_user_id,
    LEAD(t.event_ts) OVER w_lead   AS next_event_ts,
    ROW_NUMBER()     OVER w_lead   AS period_ordinal
  FROM transitions t
  WINDOW w_lead AS (PARTITION BY t.lead_id ORDER BY t.event_ts, t.event_order)
),

-- Clip period_end to the lead's terminal_ts and drop post-terminal periods.
-- Attach owner classification (is_real_sga) and period_reason_end.
-- Note: the full owner_is_sga_flag_current / owner_is_active_current /
-- effective_lead_closed_ts / self-sourced flag columns from the original
-- vw_ownership_periods view are NOT carried here because the primary-SGA
-- assignment logic below doesn't need them. Self-sourced flag is derived
-- at the final SELECT from lead_final_source.
periods_clipped AS (
  SELECT
    pr.lead_id,
    pr.period_ordinal,
    pr.period_start,
    LEAST(
      COALESCE(pr.next_event_ts, lt.terminal_ts),
      lt.terminal_ts
    )                                       AS period_end,
    pr.owner_user_id,
    u.Name                                  AS owner_name,
    (
      COALESCE(u.IsSGA__c, FALSE) = TRUE
      AND ru.user_id IS NULL
    )                                       AS is_real_sga,
    -- What ended this period?
    CASE
      WHEN pr.next_event_ts IS NOT NULL AND pr.next_event_ts < lt.terminal_ts
        THEN 'reassigned'
      WHEN lt.terminal_reason = 'converted'    THEN 'converted'
      WHEN lt.terminal_reason = 'closed_lost'  THEN 'closed_lost'
      ELSE                                          'still_open'
    END                                     AS period_reason_end,
    lt.lead_mql_stage_entered_ts
  FROM periods_raw pr
  JOIN lead_terminal lt
    ON lt.lead_id = pr.lead_id
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u
    ON u.Id = pr.owner_user_id
  LEFT JOIN `savvy-gtm-analytics.Tableau_Views.ref_non_sga_users` ru
    ON ru.user_id = pr.owner_user_id
  WHERE pr.period_start < lt.terminal_ts
),

-- Drop zero-duration periods (creation+reassignment in the same transaction).
periods_nonzero AS (
  SELECT * FROM periods_clipped
  WHERE period_end > period_start
),

-- ---------------------------------------------------------------------------
-- 6. Lead pool — every lead_id that vw_funnel_master knows about
-- ---------------------------------------------------------------------------
-- Base: non-deleted Lead records plus any Full_prospect_id__c in
-- vw_funnel_master that is missing from the Lead table (rare — archival
-- artifact; as of 2026-04 there are 1,613 such rows across the whole view).
-- We include them with NULL source fields and no MQL so they fall through
-- to reason='none' and don't cause NO_JOIN drops when vw_funnel_master
-- JOINs this view.
lead_pool AS (
  SELECT
    lb.lead_id,
    lb.lead_final_source,
    (lb.lead_final_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)'))
                                              AS lead_is_self_sourced,
    (lb.lead_created_ts >= TIMESTAMP('2024-10-15'))
                                              AS has_complete_history,
    lb.lead_mql_stage_entered_ts
  FROM lead_base lb

  UNION ALL

  SELECT
    v.Full_prospect_id__c                     AS lead_id,
    CAST(NULL AS STRING)                      AS lead_final_source,
    FALSE                                     AS lead_is_self_sourced,
    FALSE                                     AS has_complete_history,
    CAST(NULL AS TIMESTAMP)                   AS lead_mql_stage_entered_ts
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  LEFT JOIN lead_base lb
    ON lb.lead_id = v.Full_prospect_id__c
  WHERE lb.lead_id IS NULL
    AND v.Full_prospect_id__c IS NOT NULL
),

-- ---------------------------------------------------------------------------
-- 7. Rule 1: MQL leads — the real SGA whose period contains the MQL moment
-- ---------------------------------------------------------------------------
-- Periods do not overlap, so at most one period matches per lead.
-- If the matching period is NOT real-SGA, no row emitted here → falls
-- through to the orphan branch in the final combine.
mql_assignment AS (
  SELECT
    p.lead_id,
    p.owner_user_id                     AS primary_sga_user_id,
    p.owner_name                        AS primary_sga_name
  FROM periods_nonzero p
  WHERE p.lead_mql_stage_entered_ts IS NOT NULL
    AND p.is_real_sga = TRUE
    AND p.lead_mql_stage_entered_ts >= p.period_start
    AND p.lead_mql_stage_entered_ts <  p.period_end
),

-- ---------------------------------------------------------------------------
-- 8. Rule 2: no-MQL leads — walk back to the most recent real-SGA period
-- ---------------------------------------------------------------------------
-- Periods clipped to terminal_ts already, so "ended at or before terminal_ts"
-- is structurally guaranteed. Pick the latest by period_end, tie-break on
-- period_ordinal.
nonmql_assignment AS (
  SELECT
    p.lead_id,
    p.owner_user_id                     AS primary_sga_user_id,
    p.owner_name                        AS primary_sga_name,
    CASE
      WHEN p.period_reason_end = 'still_open' THEN 'last_real_sga_still_open'
      ELSE                                         'last_real_sga_before_close'
    END                                 AS nonmql_reason
  FROM periods_nonzero p
  WHERE p.lead_mql_stage_entered_ts IS NULL
    AND p.is_real_sga = TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY p.lead_id
    ORDER BY p.period_end DESC, p.period_ordinal DESC
  ) = 1
),

-- ---------------------------------------------------------------------------
-- 9. Combine — one row per lead; resolve to Rule 1, Rule 2, orphan, or none
-- ---------------------------------------------------------------------------
combined AS (
  SELECT
    lp.lead_id,
    COALESCE(m.primary_sga_user_id, nm.primary_sga_user_id)   AS primary_sga_user_id,
    COALESCE(m.primary_sga_name,    nm.primary_sga_name)      AS primary_sga_name,
    CASE
      WHEN m.primary_sga_user_id IS NOT NULL THEN 'mql_time'
      WHEN nm.primary_sga_user_id IS NOT NULL THEN nm.nonmql_reason
      WHEN lp.lead_mql_stage_entered_ts IS NOT NULL THEN 'orphan'
      ELSE 'none'
    END                                                       AS primary_sga_reason,
    (m.primary_sga_user_id IS NULL AND lp.lead_mql_stage_entered_ts IS NOT NULL)
                                                              AS is_orphan_mql,
    lp.lead_final_source,
    lp.lead_is_self_sourced,
    lp.has_complete_history
  FROM lead_pool lp
  LEFT JOIN mql_assignment    m  ON m.lead_id  = lp.lead_id
  LEFT JOIN nonmql_assignment nm ON nm.lead_id = lp.lead_id
)

SELECT
  lead_id,
  primary_sga_user_id,
  primary_sga_name,
  primary_sga_reason,
  is_orphan_mql,
  lead_final_source,
  lead_is_self_sourced,
  has_complete_history
FROM combined;
