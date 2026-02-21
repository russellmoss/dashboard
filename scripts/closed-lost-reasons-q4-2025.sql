-- Closed Lost reasons: count of opportunities by reason (Recruiting record type only)
-- Period: Oct 1, 2025 – Dec 31, 2025 (Stage_Entered_Closed__c)
-- Source: SavvyGTMData.Opportunity
-- Record type: Recruiting only (012Dn000000mrO3IAI) to match SFDC recruiting reports

-- ---------------------------------------------------------------------------
-- Query 1: Counts per reason (only reasons that have at least one opportunity)
-- ---------------------------------------------------------------------------
SELECT
  COALESCE(TRIM(Closed_Lost_Reason__c), '(blank)') AS Closed_Lost_Reason,
  COUNT(*) AS Opportunity_Count
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
WHERE (IsDeleted IS NULL OR IsDeleted = FALSE)
  AND RecordTypeId = '012Dn000000mrO3IAI'   -- Recruiting only
  AND StageName = 'Closed Lost'
  AND Stage_Entered_Closed__c IS NOT NULL
  AND DATE(Stage_Entered_Closed__c) >= DATE('2025-10-01')
  AND DATE(Stage_Entered_Closed__c) <= DATE('2025-12-31')
GROUP BY Closed_Lost_Reason__c
ORDER BY Opportunity_Count DESC, Closed_Lost_Reason;


-- ---------------------------------------------------------------------------
-- Query 2: All listed reasons with counts (0 where none) – same period
-- ---------------------------------------------------------------------------
WITH reason_list AS (
  SELECT reason FROM UNNEST([
    'Candidate Declined - Timing',
    'No Longer Responsive',
    'Candidate Declined - Economics',
    'Candidate Declined - Lost to Competitor',
    'Candidate Declined - Fear of Change',
    'Savvy Declined – Book Not Transferable',
    'Savvy Declined - Insufficient Revenue',
    'Other',
    'Savvy Declined - Poor Culture Fit',
    'Savvy Declined - No Book of Business',
    'Candidate Declined - Operational Constraints',
    'Savvy Declined - Compliance',
    'No Show – Intro Call'
  ]) AS reason
),
counts AS (
  SELECT
    TRIM(Closed_Lost_Reason__c) AS Closed_Lost_Reason__c,
    COUNT(*) AS Opportunity_Count
  FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`
  WHERE (IsDeleted IS NULL OR IsDeleted = FALSE)
    AND RecordTypeId = '012Dn000000mrO3IAI'   -- Recruiting only
    AND StageName = 'Closed Lost'
    AND Stage_Entered_Closed__c IS NOT NULL
    AND DATE(Stage_Entered_Closed__c) >= DATE('2025-10-01')
    AND DATE(Stage_Entered_Closed__c) <= DATE('2025-12-31')
  GROUP BY Closed_Lost_Reason__c
)
SELECT
  r.reason AS Closed_Lost_Reason,
  COALESCE(c.Opportunity_Count, 0) AS Opportunity_Count
FROM reason_list r
LEFT JOIN counts c ON c.Closed_Lost_Reason__c = r.reason
ORDER BY Opportunity_Count DESC, r.reason;
