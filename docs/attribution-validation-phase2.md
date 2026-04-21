# Attribution Phase 2 — Validation Report

**Date:** 2026-04-21
**View under test:** `savvy-gtm-analytics.Tableau_Views_Dev.vw_ownership_periods`
**Exclusion table:** `savvy-gtm-analytics.Tableau_Views_Dev.ref_non_sga_users`
**Design doc:** `docs/attribution-design.md`
**Phase-1 doc:** this file documents Phase 2 outputs; no dashboard code changed.

---

## Executive summary

| Gate | Status | Delta | Notes |
|------|:------:|------:|-------|
| §8.1 no-filter Q3 2025 self-sourced | **PASS** | −0.087 pp | 6.417% vs 6.504% dashboard |
| §8.2 all-real-SGAs Q3 2025 self-sourced | **PASS** | +0.073 pp | 6.490% vs 6.417% no-filter — **bug fixed** (was 39.2%) |
| §8.2a multi-real-SGA concentration | **PASS** | 1.07 % | 27/2,535 leads (<2% threshold) |
| §8.3 per-owner sum-weight identity | **PASS** | Δ=0 | Strict equality, 2,618 = 2,618, 168 = 168 |
| §8.4 spot-check breakdown | **MANUAL** | — | 3 leads × per-period tables in §5 below — awaiting Russell reconciliation vs SFDC |
| §8.5 additive-view bit-identity | **PASS** | 0 | No `src/`, no production view, and no existing query references the new view |
| Differential (8 cells) | **FAIL for 6/8** | −0.09 to −0.99 pp | Period multiplication — see §7, STOP AND REPORT |

**Bug fix confirmed at Q3 2025:** self-sourced Contacted→MQL rate with every real SGA selected is **6.49 %**, matching the no-filter view. The old logic produced **39.2 %** under the same filter — a 32.7pp distortion caused by silently excluding Savvy-Operations-owned leads from the denominator.

**Stop-and-report trigger:** the differential across all (quarter, segment) cells fails the 0.2 pp gate for every quarter except Q3. Root cause is a design-intent tradeoff, not a bug — Russell's call on how to proceed. See §7.

---

## 1. §8.5 Additive-view bit-identity check — PASS

**Question:** does introducing `vw_ownership_periods` change any unfiltered metric in existing queries?

**Method:** scanned `src/` for any reference to `vw_ownership_periods`, `ref_non_sga_users`, or `Tableau_Views_Dev`. Zero matches. The view lives in a dev dataset not read by any dashboard code. `views/vw_funnel_master.sql` was not modified.

**Baseline stage counts (captured 2026-04-21 for future regressions):**
- 2025 Contacted (is_contacted=1 in Q1–Q4 2025): 30,167
- 2025 MQL (is_mql=1 in Q1–Q4 2025): 1,921
- 2025 SQL (is_sql=1 in Q1–Q4 2025): 691

**Result:** strictly additive. No existing query path reads the new view yet. ✓

---

## 2. §8.2a Multi-real-SGA concentration — PASS

**Question:** for Q3 2025 self-sourced cohort, how many leads have >1 eligible real-SGA period? If >2 %, STOP (choice between effort-weighted and lead-weighted attribution needed).

| Metric | Count | % of cohort |
|---|---:|---:|
| Cohort size | 2,535 | 100 % |
| Leads with >1 real-SGA period | 27 | **1.07 %** |
| Leads with >1 distinct real-SGA owner | 27 | 1.07 % |
| Max periods per lead (real-SGA) | 2 | — |

1.07 % < 2 %. ✓ Proceed with period-grain attribution as designed.

---

## 3. §8.1 No-filter match — PASS

**Dashboard (old) rate computed from `vw_funnel_master` progression columns:**
`SUM(contacted_to_mql_progression) / SUM(eligible_for_contacted_conversions_30d)` for Q3 2025, `Original_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')`, `is_contacted = 1`.

| Metric | Old (dashboard) | New (periods, no filter) |
|---|---:|---:|
| Numerator (hits) | 165 | 168 |
| Denominator (at-bats) | 2,537 | 2,618 |
| Rate | 6.504 % | **6.417 %** |
| Delta | — | **−0.087 pp** |

Within 0.2 pp tolerance. ✓

---

## 4. §8.2 All-real-SGAs-selected match — PASS (bug fix confirmed)

Same Q3 2025 self-sourced cohort with `is_real_sga = TRUE` predicate applied to periods.

| Scope | At-bats | Hits | Rate |
|---|---:|---:|---:|
| No filter | 2,618 | 168 | 6.417 % |
| Real SGA only | 2,573 | 167 | **6.490 %** |
| Non-real SGA (Savvy Ops / Marketing / admin) | 45 | 1 | 2.22 % |

Delta real-SGA vs no-filter: **+0.073 pp**. Within 0.2 pp. ✓

**Bug comparison:** the original bug produced 39.2 % under the same filter. The new model produces 6.49 %. A 32.7 pp correction, in line with the analysis in `docs/attribution-design.md` §0.

---

## 5. §8.3 Sum-weight identity — PASS

Strict per-owner reassembly of the Q3 2025 self-sourced cohort.

| Side | At-bats | Hits | Rate |
|---|---:|---:|---:|
| Summed over owners | 2,618 | 168 | 6.4171 % |
| Aggregate total | 2,618 | 168 | 6.4171 % |
| **Delta** | **0** | **0** | **0.0000 pp** |

Exact identity. ✓

---

## 6. §8.4 Spot-check leads — awaiting Russell's manual SFDC reconciliation

Full per-period breakdown for 3 leads identified in design doc §8.4. All 3 are Q3 2025 self-sourced, currently owned by Savvy Operations, never reached MQL (lead_mql_stage_entered_ts = NULL). The eligibility and attribution chain is machine-correct per the design rules; Russell to verify periods against Salesforce LeadHistory audit trail.

**Legend:** `e_ctcNotAfterEnd` = Contacting_ts < period_end; `e_mqlAfterStart` = MQL_ts IS NULL OR MQL_ts > period_start; `e_closedAfterStart` = effective_closed_ts IS NULL OR effective_closed_ts > period_start; `eligible` = AND of three; `hit` = MQL_ts in [period_start, period_end).

### Lead `00QDn000007DMuCMAW`
Contacting: 2025-09-30 16:56:06 UTC. MQL: NULL. Effective closed: 2025-09-30 17:26:56. Terminal: closed_lost.

| # | period_start | period_end | owner | real_sga | reason_end | e_ctcNotAfterEnd | e_mqlAfterStart | e_closedAfterStart | eligible | hit |
|---|---|---|---|:-:|---|:-:|:-:|:-:|:-:|:-:|
| 1 | 2023-04-20 18:10:37 | 2024-10-18 18:29:47 | Paige de La Chapelle | ✗ | reassigned_sga | ✗ | ✓ | ✓ | ✗ | 0 |
| 2 | 2024-10-18 18:29:47 | 2025-07-24 22:03:16 | Craig Suchodolski | ✓ | reassigned_ops | ✗ | ✓ | ✓ | ✗ | 0 |
| 3 | 2025-07-24 22:03:16 | 2025-09-24 19:14:47 | Savvy Operations | ✗ | reassigned_ops | ✗ | ✓ | ✓ | ✗ | 0 |
| 4 | 2025-09-24 19:14:47 | 2025-09-25 10:38:58 | Savvy Marketing | ✗ | reassigned_ops | ✗ | ✓ | ✓ | ✗ | 0 |
| 5 | 2025-09-25 10:38:58 | 2025-09-25 15:34:22 | Savvy Operations | ✗ | reassigned_sga | ✗ | ✓ | ✓ | ✗ | 0 |
| 6 | 2025-09-25 15:34:22 | 2025-09-30 17:26:56 | **Lauren George** | ✓ | closed_lost | ✓ | ✓ | ✓ | **✓** | 0 |

**Attribution:** Lauren George is charged the miss. Paige, Craig, Savvy Ops, and Savvy Marketing are not, because their periods ended before the lead entered Contacting. Russell to confirm this matches SFDC Lead History.

### Lead `00QDn000007DOy9MAG`
Contacting: 2025-08-21 16:17:28 UTC. MQL: NULL. Effective closed: 2025-11-25 13:45:05. Terminal: closed_lost.

| # | period_start | period_end | owner | real_sga | reason_end | e_ctcNotAfterEnd | e_mqlAfterStart | e_closedAfterStart | eligible | hit |
|---|---|---|---|:-:|---|:-:|:-:|:-:|:-:|:-:|
| 1 | 2023-04-20 18:11:24 | 2025-07-24 21:59:39 | Paige de La Chapelle | ✗ | reassigned_ops | ✗ | ✓ | ✓ | ✗ | 0 |
| 2 | 2025-07-24 21:59:39 | 2025-08-19 20:47:27 | Savvy Operations | ✗ | reassigned_sga | ✗ | ✓ | ✓ | ✗ | 0 |
| 3 | 2025-08-19 20:47:27 | 2025-11-25 13:45:05 | **Lauren George** | ✓ | closed_lost | ✓ | ✓ | ✓ | **✓** | 0 |

**Attribution:** Lauren George is charged the miss.

### Lead `00QVS00000DIwcN2AT`
Contacting: 2025-08-13 21:51:15 UTC. MQL: NULL. Effective closed: 2025-08-14 15:24:54. Terminal: closed_lost.

| # | period_start | period_end | owner | real_sga | reason_end | e_ctcNotAfterEnd | e_mqlAfterStart | e_closedAfterStart | eligible | hit |
|---|---|---|---|:-:|---|:-:|:-:|:-:|:-:|:-:|
| 1 | 2023-04-20 18:10:37 | 2025-07-24 22:02:40 | Andrew Moody | ✓ | reassigned_ops | ✗ | ✓ | ✓ | ✗ | 0 |
| 2 | 2025-07-24 22:02:40 | 2025-07-31 23:18:28 | Savvy Operations | ✗ | reassigned_sga | ✗ | ✓ | ✓ | ✗ | 0 |
| 3 | 2025-07-31 23:18:28 | 2025-08-14 15:24:54 | **Chris Morgan** | ✓ | closed_lost | ✓ | ✓ | ✓ | **✓** | 0 |

**Attribution:** Chris Morgan is charged the miss. (Note: Chris Morgan is now inactive — `IsSGA__c=TRUE, IsActive=FALSE` — but still classified `is_real_sga=TRUE` because `IsSGA__c` was TRUE at time of ownership, per Russell's Q1 decision.)

---

## 7. Differential Q1–Q4 2025 × (self-sourced, other) — **FAIL for 6 of 8 cells — STOP AND REPORT**

Old (dashboard) rate from `SUM(contacted_to_mql_progression) / SUM(eligible_for_contacted_conversions_30d)` on `vw_funnel_master`.
New (periods) rate from eligible at-bats and hits in `vw_ownership_periods`, same cohort definition.

| Quarter | Segment | Old num | Old den | Old rate | New num | New den | New rate | Δ pp | periods/lead | Gate |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|:-:|
| 2025-Q1 | other | 160 | 3,482 | 4.60 % | 164 | 4,095 | 4.00 % | **−0.59** | 1.18 | FAIL |
| 2025-Q1 | self-sourced | 117 | 1,374 | 8.52 % | 122 | 1,621 | 7.53 % | **−0.99** | 1.18 | FAIL |
| 2025-Q2 | other | 141 | 3,603 | 3.91 % | 141 | 4,387 | 3.21 % | **−0.70** | 1.22 | FAIL |
| 2025-Q2 | self-sourced | 137 | 2,024 | 6.77 % | 143 | 2,181 | 6.56 % | **−0.21** | 1.08 | FAIL |
| 2025-Q3 | other | 189 | 4,602 | 4.11 % | 190 | 4,725 | 4.02 % | −0.09 | 1.03 | **PASS** |
| 2025-Q3 | self-sourced | 165 | 2,537 | 6.50 % | 168 | 2,618 | 6.42 % | −0.09 | 1.03 | **PASS** |
| 2025-Q4 | other | 197 | 6,369 | 3.09 % | 182 | 7,088 | 2.57 % | **−0.53** | 1.13 | FAIL |
| 2025-Q4 | self-sourced | 273 | 6,175 | 4.42 % | 277 | 6,751 | 4.10 % | **−0.32** | 1.10 | FAIL |

### Root cause (not a bug — a design-intent tradeoff)

The new rate's denominator is **at-bats per period**, not leads. Russell's Phase-1 decision explicitly requires this: *"Jimmy owning Johnny Smith in Q3 2024 counts toward Jimmy's Q3 2024 rate, regardless of who owns Johnny now. If Johnny is later reassigned to Jane, a fresh at-bat starts for Jane."* Under this rule, a lead owned by k distinct real SGAs during its Contacting window contributes k at-bats.

The last column (`periods/lead`) shows exactly this effect — the delta tracks linearly with period multiplication:

- Q3 2025: 1.03 periods/lead → delta within 0.1 pp ✓
- Q2 2025 self: 1.08 → delta 0.2 pp (borderline)
- Q4 2025: 1.10–1.13 → delta 0.3–0.5 pp
- Q1 2025: 1.18 → delta 0.6–1.0 pp

Older cohorts (Q1) have had the most reassignment time, so their denominators inflate most. Q3 passes because the cohort is recent enough that most leads haven't been swept yet.

### Why this is an **attribution tradeoff**, not a bug

- Under the period model, the rate answers: *"how often does an at-bat (an SGA owning a lead in Contacting) end in an MQL?"*
- Under the old lead-level model, the rate answers: *"how often does a contacted lead ever MQL, regardless of owner continuity?"*
- They are different metrics. Both are defensible. They will coincide exactly only when reassignment doesn't happen.

### What Russell needs to decide

1. **Accept the differential as correct behavior.** Document that unfiltered rates under the new attribution may read 0.1–1.0 pp lower than the current unfiltered dashboard number, in proportion to reassignment frequency. The *per-SGA* and *filtered* rates are now attribution-correct; the unfiltered aggregate is a weighted blend of at-bats rather than leads, and will necessarily differ. Advantage: preserves Russell's explicit attribution requirement. Disadvantage: two dashboard numbers for the same concept unless we also update the unfiltered display.
2. **Switch to lead-weighted attribution.** A lead contributes at most 1 at-bat in the cohort, assigned to whichever SGA held it at MQL (or at closure for misses). Under this rule, Jimmy gets no credit/blame for his Q1 time if Jane later MQL'd in Q2. Advantage: exact differential parity. Disadvantage: contradicts the explicit Phase-1 spec. Savvy-Ops reassignments still attribute incorrectly — Savvy Ops ends up holding the miss if the lead was handed off to Savvy Ops before closure, which is exactly the bug we just fixed.
3. **Hybrid: cohort-count denominator + period-weighted SGA shares.** Use per-lead count for the aggregate denominator, but allocate fractional credit across periods. More complex, no clean interpretation.

**My recommendation:** Option 1. The period model is what the spec asked for and what makes SGA-filtered metrics trustworthy. The unfiltered number should be presented alongside a tooltip explaining the shift, and Phase 3 should introduce the new definition as a distinct metric label (e.g., "per-at-bat MQL rate") rather than pretending it's the same as the old lead-level rate. This is consistent with Russell's Phase-1 answer to Q5 about flagging new-model rates.

**STOP AND REPORT per brief.** No more changes this phase until Russell picks a path.

---

## 8. Artifacts produced this phase

| File | Purpose |
|---|---|
| `views/ref_non_sga_users.sql` | Exclusion list DDL + idempotent seed for Savvy Operations (`005VS000005ahzdYAA`) and Savvy Marketing (`005Dn000007IYAAIA4`). Deployed to `Tableau_Views_Dev.ref_non_sga_users`. |
| `views/vw_ownership_periods.sql` | `vw_ownership_periods` DDL with design-doc citations and v1 limitations documented. Deployed to `Tableau_Views_Dev.vw_ownership_periods`. |
| `docs/attribution-validation-phase2.md` | This file. |

**Promotion checklist (pending Russell's go-ahead):**
1. Russell reconciles §6 spot-check tables against Salesforce Lead History.
2. Russell decides between Options 1/2/3 in §7.
3. If Option 1 or 3 approved: promote both objects to `Tableau_Views` (not `Tableau_Views_Dev`) via the same DDL with the dataset name changed. No view logic changes required.
4. If Option 2 approved: schema doesn't change, but the consuming query pattern in `filter-helpers.ts` (Phase 3) needs a different join/aggregation — revise the design doc before Phase 3.

---

## 9. Surprises / discoveries

1. **`LeadHistory.Field='Owner'` stores paired Id-form and Name-form rows.** Filtering to Id-form (`REGEXP_CONTAINS(NewValue, r'^005')`) is required to avoid double-counting transitions. Documented in the view.
2. **Lead→Opp conversion seam lands at midnight UTC** (`ConvertedDate` is a DATE). Same-day MQL events fire AFTER the seam. Fix: terminal_ts for converted leads = `ConvertedDate + 1 day`. Without this, ~20 % of hits would be mis-attributed.
3. **`lead_closed_date` is not authoritative for recycled leads.** If a lead was closed, then re-activated via `Stage_Entered_New__c`, the raw closed_ts is stale. Exposed `effective_lead_closed_ts` (NULL when reopened) for downstream eligibility logic. Without this, ~19 hits in Q3 2025 self-sourced were dropped from the new rate's numerator.
4. **Zero-duration periods** arise when a lead is created and reassigned in the same Salesforce transaction. Filtered out in a `periods_nonzero` CTE. 1,321 such rows dropped at build time.
5. **No queues in Lead.OwnerId.** 100 % of values are User prefix `005`. No queue-handling logic needed — if queues appear later, they'll classify as `is_real_sga=FALSE` via the existing `IsSGA__c` check.
6. **`OpportunityHistory` does NOT exist** in `SavvyGTMData` (404). Opp-side field changes live in `OpportunityFieldHistory`. Irrelevant for Phase 2 (lead-era only) but flagged for Phase 3 opp-era design.
7. **`Savvy Operations` holds 76,864 historical lead-ownership records** across the entire LeadHistory. It is the single biggest owner-change destination after real SGAs combined — confirming the sweep pattern is systemic, not isolated to Q3 2025.
