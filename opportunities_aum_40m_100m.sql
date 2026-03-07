-- Opportunities with AUM between $40M and $100M (closed, closed-lost)
-- Source: savvy-gtm-analytics.SavvyGTMData.Opportunity
--
-- AUM: Underwritten_AUM__c preferred; fallback to Amount when NULL (both FLOAT, stored as full dollars e.g. 50000000).
-- Closed: IsClosed = TRUE, IsWon = FALSE (closed-lost) so Closed_Lost_Details__c / Closed_Lost_Reason__c apply.
-- No string normalization needed; AUM columns are numeric in BQ.

SELECT
  o.Name                      AS advisor_name,
  o.FA_CRD__c                 AS crd,
  o.Id                        AS opportunity_id,
  o.Closed_Lost_Details__c    AS closed_lost_details,
  o.Closed_Lost_Reason__c     AS closed_lost_reason,
  COALESCE(o.Underwritten_AUM__c, o.Amount) AS aum_used,
  o.CloseDate,
  o.StageName
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity` o
WHERE (o.IsDeleted IS NULL OR o.IsDeleted = FALSE)
  AND o.IsClosed = TRUE
  AND o.IsWon   = FALSE
  AND COALESCE(o.Underwritten_AUM__c, o.Amount) BETWEEN 40000000 AND 100000000
ORDER BY o.CloseDate DESC, o.Name;
