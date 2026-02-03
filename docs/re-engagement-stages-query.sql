-- Re-Engagement record type: list all StageName values and counts
-- Run in BigQuery (savvy-gtm-analytics) or any SQL client against SavvyGTMData.Opportunity
-- Record type ID for Re-Engagement: 012VS000009VoxrYAC

-- 1) All stages on Re-Engagement opportunities (with counts)
SELECT
  StageName,
  COUNT(*) AS record_count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE RecordTypeId = '012VS000009VoxrYAC'
  AND (IsDeleted IS NULL OR IsDeleted = FALSE)
GROUP BY StageName
ORDER BY record_count DESC;

-- 2) Same but include deleted (to see if any stages only appear on deleted rows)
-- SELECT
--   StageName,
--   COUNT(*) AS record_count,
--   LOGICAL_OR(IsDeleted = TRUE) AS has_deleted
-- FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
-- WHERE RecordTypeId = '012VS000009VoxrYAC'
-- GROUP BY StageName
-- ORDER BY record_count DESC;

-- 3) Sample of records per stage (Id, Name, StageName, CreatedDate)
-- SELECT
--   Id,
--   Name,
--   StageName,
--   CreatedDate,
--   Previous_Recruiting_Opportunity_ID__c
-- FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
-- WHERE RecordTypeId = '012VS000009VoxrYAC'
--   AND (IsDeleted IS NULL OR IsDeleted = FALSE)
-- ORDER BY StageName, CreatedDate DESC;
