-- find_duplicate_accounts.sql
-- Finds advisors with multiple Account records where at least one Account
-- has a Closed Lost Recruiting opportunity.
--
-- Logic:
--   1. Normalize Account names (strip " - Account" suffix) before grouping
--   2. Group by normalized name to find advisors with 2+ Account records
--   3. Filter to groups where at least one Account has a Closed Lost Recruiting opp
--   4. Return one row per duplicate pair with both Account IDs, Opp details, and CRD
--
-- RecordTypeIds (verified from BQ):
--   012Dn000000mrO3IAI = Recruiting
--   012VS000009VoxrYAC = Re-engagement
--
-- CRD lives on Contact (FA_CRD__c), not Account — joined via Contact.AccountId

WITH recruiting_opps AS (
  -- All Recruiting opportunities (not deleted)
  SELECT
    o.Id           AS opp_id,
    o.Name         AS opp_name,
    o.AccountId    AS account_id,
    o.StageName,
    o.CloseDate,
    o.RecordTypeId
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
  WHERE o.IsDeleted = false
    AND o.RecordTypeId = '012Dn000000mrO3IAI'  -- Recruiting
),

account_with_crd AS (
  -- Each Account with its CRD from Contact (if any)
  SELECT
    a.Id           AS account_id,
    a.Name         AS account_name,
    a.Full_Account_ID__c,
    a.CreatedDate,
    c.FA_CRD__c    AS crd
  FROM `savvy-gtm-analytics.SavvyGTMData.Account` a
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Contact` c
    ON c.AccountId = a.Id
    AND c.IsDeleted = false
  WHERE a.IsDeleted = false
),

-- Deduplicate: an Account may have multiple Contacts; take the first non-null CRD
-- Also normalize the name: strip trailing " - Account" (case-insensitive)
account_deduped AS (
  SELECT
    account_id,
    account_name,
    TRIM(REGEXP_REPLACE(account_name, r'(?i)\s*-\s*Account$', '')) AS normalized_name,
    Full_Account_ID__c,
    CreatedDate,
    -- Prefer non-null CRD
    MAX(crd) AS crd
  FROM account_with_crd
  GROUP BY account_id, account_name, Full_Account_ID__c, CreatedDate
),

-- Normalized names that appear on more than one Account
duplicate_names AS (
  SELECT normalized_name
  FROM account_deduped
  GROUP BY normalized_name
  HAVING COUNT(DISTINCT account_id) > 1
),

-- Accounts belonging to duplicate-name advisors
dup_accounts AS (
  SELECT ad.*
  FROM account_deduped ad
  INNER JOIN duplicate_names dn
    ON ad.normalized_name = dn.normalized_name
),

-- Among those, find groups where at least one Account has a Closed Lost Recruiting opp
names_with_closed_lost AS (
  SELECT DISTINCT da.normalized_name
  FROM dup_accounts da
  INNER JOIN recruiting_opps ro
    ON ro.account_id = da.account_id
  WHERE ro.StageName = 'Closed Lost'
)

-- Final output: one row per Account in each duplicate group,
-- with its Recruiting opp details (if any)
SELECT
  da.normalized_name                    AS advisor_name,
  da.account_name                       AS raw_account_name,
  da.account_id,
  da.Full_Account_ID__c                 AS full_account_id,
  da.crd,
  da.CreatedDate                        AS account_created,
  CASE
    WHEN da.account_id LIKE '001Dn%' THEN 'older (001Dn)'
    WHEN da.account_id LIKE '001VS%' THEN 'newer (001VS)'
    ELSE 'other'
  END                                   AS account_generation,
  ro.opp_id,
  ro.opp_name,
  ro.StageName                          AS opp_stage,
  ro.CloseDate                          AS opp_close_date
FROM dup_accounts da
INNER JOIN names_with_closed_lost ncl
  ON da.normalized_name = ncl.normalized_name
LEFT JOIN recruiting_opps ro
  ON ro.account_id = da.account_id
ORDER BY
  da.normalized_name,
  da.CreatedDate,
  ro.CloseDate
