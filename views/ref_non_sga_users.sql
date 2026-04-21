-- ============================================================================
-- ref_non_sga_users
--
-- Purpose: Exclusion list of User.Id values that should NEVER appear in
--          `is_real_sga = TRUE` classifications within vw_ownership_periods.
--
-- Why this exists:
--   Some Salesforce users carry `IsSGA__c = TRUE` but behave as system/process
--   accounts (e.g., "Savvy Marketing"). Others carry `IsSGA__c = FALSE` but
--   are the destination of automated reassignment sweeps (e.g., "Savvy
--   Operations", which receives self-sourced leads ~90 days after Contacting
--   without MQL). Both patterns distort SGA-filtered metrics if their
--   ownership periods are counted as real-SGA at-bats.
--
-- Maintenance:
--   Russell (or any revops admin) can add rows with plain INSERT:
--
--     INSERT INTO `savvy-gtm-analytics.Tableau_Views_Dev.ref_non_sga_users`
--     VALUES ('005XXXXXXXXXXXXXX', 'New System Account', 'automation sweep target',
--             CURRENT_TIMESTAMP(), 'russell.moss@savvywealth.com');
--
--   No view rebuild or code deploy required — vw_ownership_periods reads this
--   table at query time via LEFT JOIN.
--
-- Design doc: docs/attribution-design.md §1.5, §5, §9 Q1
-- Russell decisions: allowlist/denylist approach; exclude Savvy Operations
-- AND Savvy Marketing; IsSGA__c=TRUE at time of ownership (not IsActive).
-- ============================================================================

CREATE TABLE IF NOT EXISTS `savvy-gtm-analytics.Tableau_Views_Dev.ref_non_sga_users` (
  user_id      STRING   NOT NULL  OPTIONS(description="Salesforce User.Id (15- or 18-char). Prefix 005."),
  user_name    STRING             OPTIONS(description="Display name at time of entry. Informational only — join back to User table for current name."),
  reason       STRING             OPTIONS(description="Free text explaining why this user is excluded from is_real_sga."),
  added_at     TIMESTAMP          OPTIONS(description="When this exclusion was added."),
  added_by     STRING             OPTIONS(description="Email of the person who added the row.")
)
OPTIONS(
  description = 'Exclusion list for vw_ownership_periods.is_real_sga. Maintained by revops. Any ownership period whose owner_user_id is in this table has is_real_sga=FALSE regardless of User.IsSGA__c.'
);

-- Seed rows. Idempotent via MERGE to allow re-running this script.
MERGE `savvy-gtm-analytics.Tableau_Views_Dev.ref_non_sga_users` T
USING (
  SELECT '005VS000005ahzdYAA' AS user_id,
         'Savvy Operations'   AS user_name,
         'Automated reassignment target for stale Contacting leads (~90 days). IsSGA__c=FALSE but still receives ownership sweeps that would distort real-SGA metrics if counted.' AS reason,
         TIMESTAMP('2026-04-21T00:00:00Z') AS added_at,
         'russell.moss@savvywealth.com'    AS added_by
  UNION ALL
  SELECT '005Dn000007IYAAIA4',
         'Savvy Marketing',
         'System account flagged IsSGA__c=TRUE but used for marketing-automation-owned leads. Not a real human SGA; exclude from SGA-filtered metrics.',
         TIMESTAMP('2026-04-21T00:00:00Z'),
         'russell.moss@savvywealth.com'
) S
ON T.user_id = S.user_id
WHEN NOT MATCHED THEN INSERT ROW;
