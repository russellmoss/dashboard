# Attribution Phase 2.7 — Consolidation Validation Report

**Date:** 2026-04-21
**View under test:** `savvy-gtm-analytics.Tableau_Views_Dev.vw_lead_primary_sga` (consolidated)
**Source DDL:** `views/vw_lead_primary_sga.sql`
**Change:** inlined period-construction CTEs from `vw_ownership_periods` into `vw_lead_primary_sga`.
**Dropped from codebase:** `views/vw_ownership_periods.sql` (file only; BQ object retained for Phase 3 diagnostics).

---

## One-line summary

**PASS.** Row-count identity + zero column mismatches across all 119,262 leads. All 5 Phase 2.6 gates produce identical numbers. Semantically indistinguishable from the pre-consolidation view.

---

## 1. What changed

- The view previously JOINed `Tableau_Views_Dev.vw_ownership_periods`. That external dependency has been replaced with inlined CTEs covering lead base, terminal event, owner changes, seed owner, transitions, periods_raw, periods_clipped, periods_nonzero.
- One simplification carried out as part of the inline: `period_reason_end` for mid-lifecycle reassignments is now `'reassigned'` (single literal) instead of being split into `'reassigned_sga'` / `'reassigned_ops'`. The primary-SGA assignment logic only branches on `= 'still_open'` vs otherwise, so this does not affect the output. Confirmed empirically below (zero column mismatches).
- No change to the final SELECT columns, column semantics, or downstream consumer contract.
- `vw_ownership_periods` **remains in BigQuery** as a diagnostic artifact during Phase 3 rollout. It will be dropped after Phase 3 ships. The file-side SQL in `views/vw_ownership_periods.sql` has been removed since the consolidated view owns the logic.

---

## 2. Identity check

### 2.1 Row count

| View | Count |
|---|---:|
| `vw_lead_primary_sga_pre_consolidation` (snapshot of old output) | 119,262 |
| `vw_lead_primary_sga` (new, consolidated) | 119,262 |
| Δ | **0** |

### 2.2 Per-column equality

FULL OUTER JOIN on `lead_id`, using `IS DISTINCT FROM` so NULL-vs-NULL is counted as equal.

| Category | Mismatches |
|---|---:|
| Rows only in new (not in old) | 0 |
| Rows only in old (not in new) | 0 |
| `primary_sga_user_id` mismatches | 0 |
| `primary_sga_name` mismatches | 0 |
| `primary_sga_reason` mismatches | 0 |
| `is_orphan_mql` mismatches | 0 |
| `lead_final_source` mismatches | 0 |
| `lead_is_self_sourced` mismatches | 0 |
| `has_complete_history` mismatches | 0 |
| **Any-mismatch rows** | **0 / 119,262** |

**Zero mismatches across every column, every lead.** The consolidated view produces the exact same output as the two-view composition.

---

## 3. Phase 2.6 gate re-run

All 5 gates ran against the newly-consolidated view. Numbers compared to the Phase 2.6 validation report (`docs/attribution-validation-phase2_6.md`).

### Gate A — Q3 2025 self-sourced aggregate preservation

| Scope | Leads | Num | Den | Rate | Phase 2.6 rate | Match |
|---|---:|---:|---:|---:|---:|:---:|
| vfm alone | 2,536 | 165 | 2,536 | 6.5063 % | 6.5063 % | ✓ |
| vfm JOIN primary (real SGA) | 2,535 | 164 | 2,535 | 6.4694 % | 6.4694 % | ✓ |
| Δ vs baseline | | | | **−0.037 pp** | −0.037 pp | ✓ |

### Gate B — Spot-checks

| Lead | Primary (new) | Reason (new) | Phase 2.6 | Match |
|---|---|---|---|:---:|
| `00QDn000007DMuCMAW` | Lauren George | `last_real_sga_before_close` | Lauren George / `last_real_sga_before_close` | ✓ |
| `00QDn000007DOy9MAG` | Lauren George | `last_real_sga_before_close` | Lauren George / `last_real_sga_before_close` | ✓ |
| `00QVS00000DIwcN2AT` | Chris Morgan | `last_real_sga_before_close` | Chris Morgan / `last_real_sga_before_close` | ✓ |

### Gate C — Savvy Ops walkback

| Reason | Leads (new) | Phase 2.6 | Match |
|---|---:|---:|:---:|
| `last_real_sga_before_close` | 38,172 | 38,172 | ✓ |
| `mql_time` | 560 | 560 | ✓ |
| `none` | 931 | 931 | ✓ |
| `orphan` | 24 | 24 | ✓ |
| **Total resolved** | **38,732 / 39,687 = 97.59 %** | 97.59 % | ✓ |

### Gate D — Per-SGA top 10 (Q3 2025 self-sourced)

| SGA | Leads (new) | MQLs (new) | Rate (new) | Phase 2.6 | Match |
|---|---:|---:|---:|---:|:---:|
| Craig Suchodolski | 626 | 16 | 2.556 % | same | ✓ |
| Russell Armitage | 569 | 56 | 9.842 % | same | ✓ |
| Eleni Stefanopoulos | 405 | 45 | 11.111 % | same | ✓ |
| Anett Diaz | 284 | 12 | 4.225 % | same | ✓ |
| Lauren George | 272 | 9 | 3.309 % | same | ✓ |
| Perry Kalmeta | 156 | 4 | 2.564 % | same | ✓ |
| Ryan Crandall | 102 | 10 | 9.804 % | same | ✓ |
| Amy Waller | 53 | 4 | 7.547 % | same | ✓ |
| Chris Morgan | 40 | 5 | 12.500 % | same | ✓ |
| Helen Kamens | 7 | 3 | 42.857 % | same | ✓ |

### Gate E — Q1-Q4 × (self, other) 8-cell

| Q | Segment | vfm rate (new) | join rate (new) | Δ pp (new) | Phase 2.6 Δ | Match |
|---|---|---:|---:|---:|---:|:---:|
| Q1 | self-sourced | 8.5153 % | 8.5153 % | 0.00 | 0.00 | ✓ |
| Q1 | other | 4.5951 % | 4.5548 % | −0.04 | −0.04 | ✓ |
| Q2 | self-sourced | 6.7688 % | 6.6766 % | −0.09 | −0.09 | ✓ |
| Q2 | other | 3.9134 % | 3.7936 % | −0.12 | −0.12 | ✓ |
| Q3 | self-sourced | 6.5063 % | 6.4694 % | −0.04 | −0.04 | ✓ |
| Q3 | other | 4.1069 % | 3.9468 % | −0.16 | −0.16 | ✓ |
| Q4 | self-sourced | 4.4211 % | 4.4415 % | +0.02 | +0.02 | ✓ |
| Q4 | other | 3.0931 % | 2.8076 % | −0.29 | −0.29 | ✓ |

All 4 self-sourced cells still within 0.1 pp. The same 3 "other" cells still fail (structural, orphan + none — see Phase 2.6 §6.3).

---

## 4. Cleanup state

| Artifact | Status |
|---|---|
| `views/vw_lead_primary_sga.sql` | Rewritten, self-contained |
| `views/vw_ownership_periods.sql` | **Deleted from codebase** |
| `Tableau_Views_Dev.vw_lead_primary_sga` (BQ) | Redeployed (consolidated logic) |
| `Tableau_Views_Dev.vw_ownership_periods` (BQ) | **Retained** — diagnostic use during Phase 3 rollout; drop after Phase 3 ships |
| `Tableau_Views_Dev.vw_lead_primary_sga_pre_consolidation` (BQ) | Snapshot table for this validation; can be dropped after sign-off |
| `docs/attribution-validation-phase2.md`, `-phase2_6.md` | Unchanged |
| `src/` | Unchanged |

---

## 5. Appendix — diff SQL

```sql
-- Row-count identity
SELECT
  (SELECT COUNT(*) FROM Tableau_Views_Dev.vw_lead_primary_sga_pre_consolidation) AS old_n,
  (SELECT COUNT(*) FROM Tableau_Views_Dev.vw_lead_primary_sga)                    AS new_n;

-- Per-column equality (NULL-safe)
WITH diff AS (
  SELECT
    COALESCE(o.lead_id, n.lead_id) AS lead_id,
    (o.lead_id IS NULL)                                            AS only_in_new,
    (n.lead_id IS NULL)                                            AS only_in_old,
    (o.primary_sga_user_id  IS DISTINCT FROM n.primary_sga_user_id)   AS m1,
    (o.primary_sga_name     IS DISTINCT FROM n.primary_sga_name)      AS m2,
    (o.primary_sga_reason   IS DISTINCT FROM n.primary_sga_reason)    AS m3,
    (o.is_orphan_mql        IS DISTINCT FROM n.is_orphan_mql)         AS m4,
    (o.lead_final_source    IS DISTINCT FROM n.lead_final_source)     AS m5,
    (o.lead_is_self_sourced IS DISTINCT FROM n.lead_is_self_sourced)  AS m6,
    (o.has_complete_history IS DISTINCT FROM n.has_complete_history)  AS m7
  FROM Tableau_Views_Dev.vw_lead_primary_sga_pre_consolidation o
  FULL OUTER JOIN Tableau_Views_Dev.vw_lead_primary_sga n ON n.lead_id = o.lead_id
)
SELECT
  COUNTIF(only_in_new OR only_in_old OR m1 OR m2 OR m3 OR m4 OR m5 OR m6 OR m7) AS any_mismatch
FROM diff;
```
