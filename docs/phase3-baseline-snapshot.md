# Phase 3 — Baseline Invariance Snapshot

Captured 2026-04-21 from production `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
(v1 equivalent, no JOIN to `vw_lead_primary_sga`).

**Cohort:** Q3 2025 self-sourced
- `Original_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')`
- `is_contacted = 1`
- `DATE(stage_entered_contacting__c) BETWEEN '2025-07-01' AND '2025-09-30'`

## The six baseline numbers

| Metric | Value |
|---|---:|
| `contacted_count` (SUM is_contacted) | **2,536** |
| `mql_count` (SUM is_mql) | **169** |
| `sql_count` (SUM is_sql) | **62** |
| `sqo_count` (SUM is_sqo_unique) | **41** |
| `joined_count` (SUM is_joined_unique) | **5** |
| `total_aum` (SUM COALESCE(Opportunity_AUM, 0)) | **2,947,525,513** |

All six values MUST remain byte-identical when:
- `ATTRIBUTION_MODEL` unset / `'v1'` (baseline)
- `ATTRIBUTION_MODEL=v2` with **no SGA filter applied** (JOIN must be LEFT and preserve row count)

Gate 6 in Phase 7 and the Phase 3 duplication audit both diff against this file.

## Related gate

Gate 1 baseline (Contacted→MQL):
- Source: `SUM(contacted_to_mql_progression) / SUM(eligible_for_contacted_conversions_30d)`
- Numerator: 165
- Denominator: 2,536
- **Rate: 6.5063 %**

Note: `mql_count` (169) differs slightly from the Gate 1 numerator (165) because Gate 1
uses the 30-day progression metric, not raw `is_mql`. This is expected.

## Uniqueness assertion (Assert 1 result)

| Metric | Value |
|---|---:|
| `row_ct` | 119,262 |
| `unique_ids` | 119,262 |
| `dupes` | **0** |

`vw_lead_primary_sga` is confirmed strictly one-row-per-lead.
