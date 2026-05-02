# Data Verifier Findings — Dashboard Phase 3 Attribution Routing

**Date:** 2026-04-21
**Analyst:** data-verifier (Claude Code agent)
**Scope:** Verification of vw_lead_primary_sga for Phase 3 feature flag routing (ATTRIBUTION_MODEL=v1|v2)
**View under test:** savvy-gtm-analytics.Tableau_Views.vw_lead_primary_sga (promoted, 119,262 rows)

---

## Executive Summary

All four numeric validation gates PASS. The JOIN is 100% coverage, zero NULLs on lead_id, zero empty strings in primary_sga_name. The view is safe for Phase 3 routing. No BQ-side blockers identified.

| Gate | Expected | Actual | Status |
|------|----------|--------|--------|
| Gate 1 - v1 baseline (vfm unfiltered) | 6.5063% | 6.5063% | PASS |
| Gate 2 - v2 unfiltered (full JOIN no filter) | 6.5063% | 6.5063% | PASS |
| Gate 3 - v2 all real SGAs (primary_sga_user_id IS NOT NULL) | 6.4694% | 6.4694% | PASS |
| Gate 4 - v2 Lauren George only | 3.309% | 3.3088% | PASS |
| Gate 5 - npm run build | out of scope | - | - |

---

## 1. Gate 1 - v1 Mode Baseline

SQL: SELECT COUNT(*) AS total_leads, SUM(contacted_to_mql_progression) AS numerator, SUM(eligible_for_contacted_conversions_30d) AS denominator, ROUND(SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions_30d)) * 100, 4) AS rate_pct FROM savvy-gtm-analytics.Tableau_Views.vw_funnel_master WHERE Original_source IN (Fintrx (Self-Sourced), LinkedIn (Self Sourced)) AND is_contacted = 1 AND DATE(stage_entered_contacting__c) BETWEEN 2025-07-01 AND 2025-09-30

Result: total_leads=2536 | numerator=165 | denominator=2536 | rate_pct=6.5063%
Status: CONFIRMED. Matches brief exactly.

---

## 2. Gate 2 - v2 Mode Unfiltered (No Leak Check)

SQL: Same cohort CTE + JOIN savvy-gtm-analytics.Tableau_Views.vw_lead_primary_sga p ON p.lead_id = c.lead_id (no additional filter)

Result: total_leads=2536 | numerator=165 | denominator=2536 | rate_pct=6.5063%
Status: PASS. Zero leads dropped by the JOIN. Exact match to Gate 1 confirms 100% JOIN coverage.

---

## 3. Gate 3 - v2 Mode, All Real SGAs (Bug Fix Check)

SQL: Same cohort CTE + JOIN vw_lead_primary_sga WHERE primary_sga_user_id IS NOT NULL

Result: total_leads=2535 | numerator=164 | denominator=2535 | rate_pct=6.4694%
Status: PASS. Bug is fixed. All real SGAs selected returns 6.4694%, not 39.2%.

The 0.037 pp gap from unfiltered (6.5063% vs 6.4694%) is explained by exactly 1 orphan MQL lead (is_orphan_mql=true, primary_sga_reason=orphan). Matches Phase 2.6 Gate A exactly.

Per-SGA breakdown confirming sum-weight identity (164/2535 = 6.4694%):

| SGA | Leads | MQLs | Rate |
|-----|-------|------|------|
| Craig Suchodolski | 626 | 16 | 2.5559% |
| Russell Armitage | 569 | 56 | 9.8418% |
| Eleni Stefanopoulos | 405 | 45 | 11.1111% |
| Anett Diaz | 284 | 12 | 4.2254% |
| Lauren George | 272 | 9 | 3.3088% |
| Perry Kalmeta | 156 | 4 | 2.5641% |
| Ryan Crandall | 102 | 10 | 9.8039% |
| Amy Waller | 53 | 4 | 7.5472% |
| Chris Morgan | 40 | 5 | 12.5% |
| Helen Kamens | 7 | 3 | 42.857% |
| Katie Bassford | 5 | 0 | 0% |
| Jason Ainsworth | 5 | 0 | 0% |
| Holly Huffman | 5 | 0 | 0% |
| Marisa Saucedo | 3 | 0 | 0% |
| Andrew Moody | 1 | 0 | 0% |
| Dan Clifford | 1 | 0 | 0% |
| Jacqueline Tully | 1 | 0 | 0% |
| **TOTAL** | **2,535** | **164** | **6.4694%** |

Sum-weight identity: 164/2535 = 6.4694% — exact match. No double-counting, no drops.

---

## 4. Gate 4 - v2 Mode, Lauren George Only

SQL: Same cohort CTE + JOIN vw_lead_primary_sga WHERE primary_sga_name = Lauren George

Result: total_leads=272 | numerator=9 | denominator=272 | rate_pct=3.3088%
Status: PASS. 272 leads, 9 MQLs, 3.3088%. Phase 2.6 reported 3.309% which is 9/272 rounded to 3dp (3.3088... truncated = 3.309). Same number — no discrepancy.

---

## 5. Column Types and NULL Behavior

SQL used: SELECT column_name, data_type, is_nullable FROM savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS WHERE table_name = vw_lead_primary_sga ORDER BY ordinal_position

| Column | Type | NULL Count | NULL Rate | Notes |
|--------|------|-----------|-----------|-------|
| lead_id | STRING | 0 | 0% | Safe join key |
| primary_sga_user_id | STRING | 16,787 | 14.08% | reason=none or orphan |
| primary_sga_name | STRING | 16,787 | 14.08% | Matches user_id NULL count exactly |
| primary_sga_reason | STRING | 0 | 0% | Always populated |
| is_orphan_mql | BOOL | 0 | 0% | Always populated |
| lead_final_source | STRING | 1,088 | 0.91% | Archival leads with no SavvyGTMData.Lead record |
| lead_is_self_sourced | BOOL | 7 | 0.006% | Only on leads where lead_final_source is NULL |
| has_complete_history | BOOL | 0 | 0% | Always populated |

Total rows: 119,262. Rows with primary SGA assigned: 102,475 (85.92%).

Max field lengths:
- primary_sga_name: 19 chars (longest value: Eleni Stefanopoulos)
- primary_sga_reason: 26 chars (longest value: last_real_sga_before_close)
- lead_id: 18 chars (standard SF Lead ID)
- lead_final_source: 28 chars

Empty string counts: 0 in primary_sga_name, 0 in primary_sga_user_id.

primary_sga_reason distribution:
| Reason | Count | Pct |
|--------|-------|-----|
| last_real_sga_before_close | 66,863 | 56.06% |
| last_real_sga_still_open | 31,726 | 26.60% |
| none | 16,465 | 13.81% |
| mql_time | 3,886 | 3.26% |
| orphan | 322 | 0.27% |

Note: Phase 2.6 showed none=15,384 (13.0%). Current none=16,465 (13.81%) reflects ~1,081 new leads since validation. Not an issue.

is_orphan_mql distribution: false=118,940 | true=322 (0.27%)

lead_is_self_sourced NULL breakdown: All 7 NULLs have lead_final_source=NULL (archival vfm-only leads). None appear in the Q3 2025 self-sourced cohort. Feature code should use COALESCE(lead_is_self_sourced, FALSE) when filtering on this column.

---

## 6. Join Key Mapping: Full_prospect_id__c vs lead_id

Full_prospect_id__c prefix distribution in vw_funnel_master (non-NULL rows):
- 00Q prefix: 118,181 rows (Salesforce Lead IDs — the intended join targets)
- 006 prefix: 1,081 rows (Opportunity IDs for opp-only rows from the FULL OUTER JOIN in vw_funnel_master)

The 1,081 006-prefix rows have no match in vw_lead_primary_sga. However these opp-only rows have no stage_entered_contacting__c populated and do not appear in Contacted->MQL queries. For Phase 3 INNER JOIN pattern on SGA-filtered metrics, this is not a concern.

JOIN coverage check SQL: LEFT JOIN vw_lead_primary_sga on Q3 2025 self-sourced cohort
Result: cohort_total=2536 | matched=2536 | unmatched=0 | match_pct=100.0000%

NULL lead_id in vw_lead_primary_sga: 0
NULL Full_prospect_id__c in Q3 2025 self-sourced cohort: 0
JOIN match rate: 100.0% — zero NO_JOIN drops.

---

## 7. Real SGA Enumeration (23 SGAs)

Full list of names appearing as primary_sga_name (primary_sga_user_id IS NOT NULL) in vw_lead_primary_sga.

Active (IsSGA__c=TRUE, IsActive=TRUE, not in ref_non_sga_users):
| Name | User ID | Total Assigned Leads |
|------|---------|---------------------|
| Amy Waller | 005VS000006CwUbYAK | 3,524 |
| Brian O'Hara | 005VS000007yUATYA2 | 3,888 |
| Craig Suchodolski | 005VS000001PFsvYAG | 10,926 |
| Dan Clifford | 005VS000009oQq9YAE | 767 |
| Eleni Stefanopoulos | 005VS000000KWADYA4 | 11,362 |
| Helen Kamens | 005VS000006CwUdYAK | 3,922 |
| Holly Huffman | 005VS000008UVplYAG | 4,051 |
| Jacqueline Tully | 005VS000000KWLVYA4 | 2,478 |
| Jason Ainsworth | 005VS000008UWCLYA4 | 3,221 |
| Kai Jean-Simon | 005VS000009oQrlYAE | 1,074 |
| Katie Bassford | 005VS0000092JNxYAM | 2,571 |
| Lauren George | 005VS0000011Rs1YAE | 10,153 |
| Marisa Saucedo | 005VS000006poVaYAI | 5,834 |
| Perry Kalmeta | 005VS000000QHlBYAW | 9,255 |
| Rashard Wade | 005VS000009bvF3YAI | 714 |
| Russell Armitage | 005VS000001T4pFYAS | 10,328 |
| Ryan Crandall | 005VS000006CwUcYAK | 5,403 |

Inactive (IsSGA__c=TRUE, IsActive=FALSE — historical attribution valid, not in dropdown):
| Name | User ID | Total Assigned Leads |
|------|---------|---------------------|
| Andrew Moody | 005VS000000YDZ7YAO | 3,249 |
| Anett Diaz | 005VS0000055Vl3YAE | 1,501 |
| Channing Guyer | 005VS000006poVZYAY | 3,443 |
| Chris Morgan | 005VS00000395I5YAI | 1,719 |
| Dustin Parsons | 005VS000002t6ejYAA | 678 |
| Eric Uchoa | 005VS000000KWIHYA4 | 2,414 |

The User table has 24 IsSGA__c=TRUE rows: the 23 real SGAs above plus Savvy Marketing (005Dn000007IYAAIA4), excluded via ref_non_sga_users.

Inactive SGAs appear correctly in vw_lead_primary_sga because the IsSGA__c flag is sticky per role and correct for historical attribution.

---

## 8. Savvy Operations and Savvy Marketing Exclusion

ref_non_sga_users table schema: user_id STRING | user_name STRING | reason STRING | added_at TIMESTAMP | added_by STRING

Rows in ref_non_sga_users (2):
| user_id | user_name | reason |
|---------|-----------|--------|
| 005Dn000007IYAAIA4 | Savvy Marketing | System account flagged IsSGA__c=TRUE but used for marketing-automation-owned leads. Not a real human SGA. |
| 005VS000005ahzdYAA | Savvy Operations | Automated reassignment target for stale Contacting leads. IsSGA__c=FALSE but receives ownership sweeps. |

User flag verification:
| Name | Id | IsSGA__c | IsActive |
|------|----|----------|----------|
| Savvy Marketing | 005Dn000007IYAAIA4 | TRUE | TRUE |
| Savvy Operations | 005VS000005ahzdYAA | FALSE | TRUE |
| Jed Entin | 005VS000000IXtZYAW | FALSE | TRUE |
| Tim Mackey | 005VS00000767pBYAQ | FALSE | TRUE |

Exclusion verification: COUNTIF(primary_sga_name = Savvy Operations) = 0 and COUNTIF(primary_sga_name = Savvy Marketing) = 0 across all 119,262 rows.

View exclusion mechanism: in periods_clipped CTE, is_real_sga = (COALESCE(u.IsSGA__c, FALSE) = TRUE AND ru.user_id IS NULL). Savvy Marketing fails the ru.user_id IS NULL check (it is in the denylist). Savvy Operations fails the IsSGA__c=TRUE check. Jed Entin and Tim Mackey are IsSGA__c=FALSE and correctly classified without needing a denylist entry.

---

## 9. Scan Cost (Gate 4 Query)

Method: BigQuery dry-run via createQueryJob({ dryRun: true }).
Query: Gate 4 — vw_funnel_master JOIN vw_lead_primary_sga WHERE primary_sga_name = Lauren George.

Result: 99,011,151 bytes = **0.092 GB**

Well inside the single-digit GB acceptable cost ceiling. The low cost reflects that vw_lead_primary_sga (119K rows) is compact and the vw_funnel_master cohort is pre-filtered to a small self-sourced Q3 slice before the join.

---

## 10. BQ-Side Issues That Would Block Phase 3

None identified.

Complete data quality checklist:

| Check | Result |
|-------|--------|
| NULL lead_id in vw_lead_primary_sga | 0 (safe join key) |
| NULL Full_prospect_id__c in Q3 2025 self-sourced cohort | 0 |
| JOIN match rate (INNER JOIN, Q3 2025 self-sourced is_contacted=1) | 100.0% (2536/2536) |
| Empty strings in primary_sga_name | 0 (safe for IN UNNEST filter) |
| Savvy Operations in primary_sga_name | 0 (correctly excluded) |
| Savvy Marketing in primary_sga_name | 0 (correctly excluded via ref_non_sga_users) |
| Orphan MQL rate in Q3 cohort | 0.04% (1/2536, expected — explains the 0.037 pp Gate 3 gap) |
| Scan cost (Gate 4 JOIN query) | 0.092 GB |
| primary_sga_reason NULL rate | 0% |
| is_orphan_mql NULL rate | 0% |
| has_complete_history NULL rate | 0% |

One minor data note: 7 lead_is_self_sourced NULLs exist (archival vfm-only leads, none in Q3 2025 cohort). Feature code should use COALESCE(lead_is_self_sourced, FALSE) when filtering on this column to prevent NULL propagation.

One structural note on 006-prefix rows: 1,081 vw_funnel_master rows have Full_prospect_id__c starting with 006 (Opportunity IDs, not Lead IDs). These have no match in vw_lead_primary_sga. They do not affect Contacted->MQL queries. Phase 3 INNER JOIN is correct for SGA-filtered metrics; a LEFT JOIN would be needed only if unfiltered opp-only rows must be preserved, which is outside Phase 3 scope.

---

## Reference Files

- C:/Users/russe/Documents/Dashboard/views/vw_lead_primary_sga.sql
- C:/Users/russe/Documents/Dashboard/docs/attribution-design.md
- C:/Users/russe/Documents/Dashboard/docs/attribution-validation-phase2_6.md
- C:/Users/russe/Documents/Dashboard/docs/attribution-validation-phase2_7.md
