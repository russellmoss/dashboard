# Source Inventory — vw_funnel_master

> Generated 2026-03-12 from `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`

## Complete Original_source × Finance_View__c Cross-Reference

| Original_source | Finance_View__c | Record Count |
|---|---|---|
| Advisor Referral | Advisor Referral | 57 |
| Blog | Marketing | 1 |
| Direct Traffic | Marketing | 1,296 |
| Direct Traffic | Other | 4 |
| Direct Traffic | Outbound | 1 |
| Employee Referral | Employee Referral | 10 |
| Events | Outbound + Marketing | 1,081 |
| Fintrx (Self-Sourced) | Marketing | 62 |
| Fintrx (Self-Sourced) | Outbound | 1,755 |
| Google Ads | Marketing | 9 |
| Job Applications | Job Applications | 2,675 |
| LinkedIn (Self Sourced) | Other | 51 |
| LinkedIn (Self Sourced) | Outbound | 27,993 |
| LinkedIn Ads | Marketing | 27 |
| LinkedIn Savvy | Marketing | 6 |
| Other | Other | 948 |
| Partnerships | Partnerships | 10 |
| Provided List (Lead Scoring) | Outbound | 69,885 |
| Provided List (Marketing) | Outbound + Marketing | 1,565 |
| Re-Engagement | Other | 1 |
| Re-Engagement | Re-Engagement | 141 |
| Recruitment Firm | Partnerships | 1 |
| Recruitment Firm | Recruitment Firm | 464 |
| Unknown | Other | 95 |

**Total distinct Original_source values: 18**
**Total distinct Finance_View__c values: 10**

## Multi-Finance_View Sources (Bug #1 Triggers)

These sources appear under multiple Finance_View__c values and cause SUMPRODUCT rate inflation:

| Original_source | Finance_View__c Values | Total Records |
|---|---|---|
| Direct Traffic | Marketing (1,296), Other (4), Outbound (1) | 1,301 |
| Fintrx (Self-Sourced) | Outbound (1,755), Marketing (62) | 1,817 |
| LinkedIn (Self Sourced) | Outbound (27,993), Other (51) | 28,044 |
| Re-Engagement | Re-Engagement (141), Other (1) | 142 |
| Recruitment Firm | Recruitment Firm (464), Partnerships (1) | 465 |

## Proposed Deterministic 1:1 Mapping (Phase 2 CASE Statement)

```sql
CASE
  WHEN Original_source = 'LinkedIn (Self Sourced)' THEN 'Outbound'
  WHEN Original_source = 'Fintrx (Self-Sourced)' THEN 'Outbound'
  WHEN Original_source = 'Direct Traffic' THEN 'Marketing'
  WHEN Original_source = 'Re-Engagement' THEN 'Re-Engagement'
  WHEN Original_source = 'Recruitment Firm' THEN 'Recruitment Firm'
  WHEN IFNULL(Finance_View__c, 'Other') IN ('Marketing', 'Job Applications') THEN 'Marketing'
  WHEN IFNULL(Finance_View__c, 'Other') = 'Outbound' THEN 'Outbound'
  WHEN IFNULL(Finance_View__c, 'Other') = 'Outbound + Marketing' THEN 'Outbound + Marketing'
  WHEN IFNULL(Finance_View__c, 'Other') IN ('Recruitment Firm', 'Employee Referral', 'Partnerships') THEN 'Partnerships'
  WHEN IFNULL(Finance_View__c, 'Other') = 'Advisor Referral' THEN 'Advisor Referrals'
  WHEN IFNULL(Finance_View__c, 'Other') = 'Re-Engagement' THEN 'Re-Engagement'
  ELSE 'Other'
END AS Finance_View
```

This ensures every Original_source resolves to exactly one Finance_View, eliminating the multi-FV inflation bug.
