# Source Name Mapping — Sheet ↔ BQ View

> Generated 2026-03-12

## Mapping Table

| # | Sheet Source Name | Sheet Row | Exists in BQ? | BQ Original_source | Action |
|---|---|---|---|---|---|
| 1 | Provided Lead List (Lead Scoring) | 107 | NO — old name | Provided List (Lead Scoring) | Rename in sheet formulas |
| 2 | LinkedIn (Self Sourced) | 120 | YES | LinkedIn (Self Sourced) | No change needed |
| 3 | Blog | 136 | YES | Blog | No change (1 record only) |
| 4 | Search | 149 | NO | — | Will return 0; no BQ records |
| 5 | LinkedIn Savvy | 162 | YES | LinkedIn Savvy | No change needed |
| 6 | LinkedIn Social | 175 | NO | — | Will return 0; no BQ records |
| 7 | LinkedIn (Content) | 188 | NO | — | Will return 0; no BQ records |
| 8 | LinkedIn (Automation) | 201 | NO | — | Will return 0; no BQ records |
| 9 | Direct Traffic | 214 | YES | Direct Traffic | No change needed |
| 10 | Website | 227 | NO | — | Will return 0; no BQ records |
| 11 | Advisor Waitlist | 240 | NO | — | Will return 0; no BQ records |
| 12 | Google Ads + LinkedIn Ads | 258 | COMPOSITE | Google Ads, LinkedIn Ads | Composite row; sums two sources |
| 13 | Ashby | 272 | NO | — | Will return 0; no BQ records |
| 14 | Google Ads | 285 | YES | Google Ads | No change needed |
| 15 | Meta | 298 | NO | — | Will return 0; no BQ records |
| 16 | LinkedIn Ads | 311 | YES | LinkedIn Ads | No change needed |
| 17 | Events | 348 | YES | Events | No change needed |
| 18 | Direct Mail | 362 | NO | — | Will return 0; no BQ records |
| 19 | Webinar | 375 | NO | — | Will return 0; no BQ records |
| 20 | Provided List (Marketing) | 388 | YES | Provided List (Marketing) | No change needed |
| 21 | Re-Engagement | 403 | YES | Re-Engagement | No change needed |
| 22 | Recruitment Firm | 420 | YES | Recruitment Firm | No change needed |
| 23 | Advisor Referral | 434 | YES | Advisor Referral | No change needed |
| 24 | Other | 448 | YES | Other | No change needed |
| 25 | Unknown | 462 | YES | Unknown | No change needed |

## Sources in BQ but NOT in Sheet

| BQ Original_source | Finance_View__c | Record Count | Action |
|---|---|---|---|
| Fintrx (Self-Sourced) | Outbound (1,755), Marketing (62) | 1,817 | Not in sheet; volumes uncaptured |
| Job Applications | Job Applications | 2,675 | Not in sheet; volumes uncaptured |
| Employee Referral | Employee Referral | 10 | Not in sheet; volumes uncaptured |
| Partnerships | Partnerships | 10 | Not in sheet; volumes uncaptured |
| Provided List (Lead Scoring) | Outbound | 69,885 | In sheet as "Provided Lead List" (old name) |

## Summary of Actions

### Bug #2 Fix — Source Name Mismatches (1 rename needed)
| Sheet Name (Old) | BQ Name (New) | Impact |
|---|---|---|
| Provided Lead List (Lead Scoring) | Provided List (Lead Scoring) | Currently returns 0 for all lookups |

### Sources That Will Return 0 (No BQ Records)
These 9 sources exist in the sheet but have zero records in vw_funnel_master. They returned data under the old SourceMapping CTE (which mapped from LeadSource), but `Final_Source__c` / `Original_source` never uses these labels:

1. Search (row 149)
2. LinkedIn Social (row 175)
3. LinkedIn (Content) (row 188)
4. LinkedIn (Automation) (row 201)
5. Website (row 227)
6. Advisor Waitlist (row 240)
7. Ashby (row 272)
8. Meta (row 298)
9. Direct Mail (row 362)
10. Webinar (row 375)

**These are NOT fixable by formula changes.** They represent sources that existed in the old LeadSource-based mapping but don't exist as Original_source values in vw_funnel_master. Fixing them would require either:
- Adding LeadSource-based aliases in vw_funnel_master (out of scope per instructions), OR
- The sheet accepting that these granular breakdowns are no longer available

### Uncaptured BQ Sources (Not in Sheet)
Fintrx (Self-Sourced), Job Applications, Employee Referral, and Partnerships exist in BQ but have no dedicated sheet rows. Their volumes roll up into Finance_View totals but aren't broken out at source level.
