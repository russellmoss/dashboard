# Exploration Results — Phase 3 Attribution Routing

Generated: 2026-04-21
Feature: Route SGA-filtered queries through `Tableau_Views.vw_lead_primary_sga` behind `ATTRIBUTION_MODEL` feature flag. Fix Savvy Ops sweep attribution bug.

---

## Pre-Flight Summary

The feature is **smaller than it looks**. Gate 5 (build) is trivially satisfied — no new fields are added to any existing wide type, so no construction-site cascade. Scope reduces to: a new env-var reader utility, a surgical edit to `filter-helpers.ts` (split SGA clause out, add v2 JOIN branch, fix the selectAll-collapse bug), matching JOIN additions in 4 query files that consume the helper, a one-line UI fix in `GlobalFilters.tsx`. All four validation gate numbers (6.5063 %, 6.5063 %, 6.5063 %, 3.309 %) have been reproduced against the live prod view. The debug side-by-side panel is the most novel piece; no existing codebase pattern mirrors it precisely, so we borrow `NEXT_PUBLIC_*` + `isRevOpsAdmin` and compose them.

---

## 1. BigQuery Status

| Item | Status |
|---|---|
| `Tableau_Views.vw_lead_primary_sga` exists | ✅ 119,262 rows |
| `Tableau_Views.ref_non_sga_users` exists | ✅ 2 rows (Savvy Ops, Savvy Marketing) |
| Join key `vw_lead_primary_sga.lead_id = vw_funnel_master.Full_prospect_id__c` | ✅ 100 % match for Q3 2025 self-sourced cohort (2,536/2,536) |
| Gate 1 reproduction (vfm unfiltered Q3 2025 self-sourced) | ✅ **6.5063 %** (165/2,536) |
| Gate 2 reproduction (INNER JOIN, no filter) | ✅ **6.5063 %** (165/2,536, no leak) |
| Gate 3 reproduction (`primary_sga_user_id IS NOT NULL`) | ✅ **6.4694 %** (164/2,535) — the 0.037 pp gap is the single orphan MQL |
| Gate 4 reproduction (Lauren George only) | ✅ **3.309 %** (9/272) |
| Dry-run scan cost for Gate 4 query | ✅ 0.092 GB, well under single-digit ceiling |
| `primary_sga_name` NULL rate overall | 14.08 % (16,787 rows) — correct; `'orphan'` and `'none'` reasons |
| 7 leads with `lead_is_self_sourced IS NULL` (archival) | ⚠ Handle with `COALESCE` if ever filtered; none in Q3 self cohort |
| Real SGA enumeration | 23 unique `primary_sga_name` values (17 active + 6 inactive-but-historical) |
| Savvy Operations / Savvy Marketing in primary_sga | ✅ 0 occurrences (denylist working) |

**No BigQuery-side changes required.** No blockers.

---

## 2. Files to Modify

### Edit (in scope)

| File | Purpose |
|---|---|
| `src/lib/utils/filter-helpers.ts` | (a) Fix selectAll-collapse bug at lines 106–109, (b) extend `buildAdvancedFilterClauses` to return SGA clause separately OR add a new helper `buildSgaFilterClause` so callers can choose v1 vs v2 SGA filter logic per query. |
| `src/lib/queries/funnel-metrics.ts` | Call the new helper; add `LEFT JOIN vw_lead_primary_sga p ON p.lead_id = v.Full_prospect_id__c` when v2 AND SGA filter active. |
| `src/lib/queries/conversion-rates.ts` | Same JOIN + helper change in both `_getConversionRates` and `getConversionTrends`. |
| `src/lib/queries/detail-records.ts` | Same JOIN + helper change. |
| `src/lib/queries/source-performance.ts` | Same JOIN + helper change in both `getSourcePerformance` and `getChannelPerformance`. |
| `src/lib/queries/export-records.ts` | Apply v2 routing for the single-SGA filter path (`filters.sga`) when flag=v2. |
| `src/components/dashboard/GlobalFilters.tsx` | `handleMultiSelectChange` lines 159–169: when `next.length === filterOptions.sgas.length`, collapse to `selectAll: true, selected: []`. UI side of Rule 3. |

### Create (new)

| File | Purpose |
|---|---|
| `src/lib/utils/attribution-mode.ts` | Server-side env reader: `getAttributionModel(): 'v1' \| 'v2'`, `isAttributionDebugEnabled(): boolean`. No scattered `process.env` reads. |
| `src/components/dashboard/AttributionDebugPanel.tsx` (tentative) | Admin-only panel. Gated by `NEXT_PUBLIC_ATTRIBUTION_DEBUG=true` + role in {revops_admin, admin}. Shows v1 vs v2 numerator/denominator/rate side-by-side. |

### Out of Scope (do not touch)

- `src/lib/semantic-layer/*` (Explore AI — Blocked Area)
- `src/lib/queries/outreach-effectiveness.ts` (Phase 4)
- `src/lib/queries/drill-down.ts`, `sga-activity.ts`, `weekly-actuals.ts`, `quarterly-progress.ts`, `sga-leaderboard.ts`, `admin-quarterly-progress.ts` (SGA Hub)
- `src/components/sga-hub/MetricDrillDownModal.tsx`
- `src/components/dashboard/ExploreResults.tsx` (Explore drilldown continues using vw_funnel_master SGA field)
- Any API route (`src/app/api/dashboard/**/route.ts` are pass-throughs)
- `vw_funnel_master` and all other BigQuery views

---

## 3. Type Changes

**None required** for Phase 3 under the current design.

All `vw_lead_primary_sga` columns are JOIN-side routing data — they don't need to surface on `DetailRecord`, `DrillDownRecord`, `FunnelMetrics`, `RecordDetailFull`, or `SGMQuotaProgress`. The dashboard shows the same rows; only the predicate differs.

**One optional addition** the guide may include: a local type for the `AttributionDebugPanel` component (`{ v1Rate, v2Rate, v1Num, v1Den, v2Num, v2Den }`) and an extension of the API route response shape to include a v1+v2 side-by-side payload when `ATTRIBUTION_DEBUG=true`. Self-contained; does not touch any existing wide type.

---

## 4. Construction Site Inventory

**No construction-site cascade** because no wide type gains a field.

Confirmatory (unchanged):
- `DetailRecord`: 3 sites — `detail-records.ts:404-449`, `ExploreResults.tsx:597-695`, (`export-records.ts` → different type `ExportDetailRecord`)
- `DrillDownRecord` (8 variants): `drill-down.ts` — out of scope
- `FunnelMetrics`, `RecordDetailFull`, `SGMQuotaProgress`: untouched

**Gate 5 passes without modifying any construction site.**

If a future iteration surfaces `primary_sga_name`/`primary_sga_reason` on detail records: sites are `detail-records.ts` line 404 and `ExploreResults.tsx` line 650. Dual-name fallback pattern already established.

---

## 5. Recommended Phase Order

1. **Pre-Flight**: `npm run build` clean; capture Gate 1 unfiltered rate from running dashboard.
2. **Utility**: create `src/lib/utils/attribution-mode.ts`.
3. **Filter-helpers refactor**: split SGA clause out; add v2 branch; fix selectAll-collapse bug.
4. **GlobalFilters UI fix**: `handleMultiSelectChange` collapses to `selectAll=true` when `next.length` equals total available. Requires passing `filterOptions.sgas` length into the handler.
5. **Query-layer wiring**: apply to 6 in-scope query files (funnel-metrics, conversion-rates × 2, detail-records, source-performance × 2, export-records). Same JOIN + helper swap pattern each.
6. **ATTRIBUTION_DEBUG side-by-side payload**: extend API route responses to include v1+v2 when debug on. Shape: `{ primary: <existing>, debug?: { v1: {...}, v2: {...} } }`. Server computes BOTH; client hides panel unless `NEXT_PUBLIC_ATTRIBUTION_DEBUG=true && isRevOpsAdmin`.
7. **AttributionDebugPanel component**: consumes `debug` payload, renders a compact v1-vs-v2 table. Gated by role + env var.
8. **Validation gates** (in-app against live dashboard):
   - Gate 1: flag unset/v1, unfiltered Q3 2025 self-sourced = **6.5063 %**
   - Gate 2: flag=v2, unfiltered = **6.5063 %** (no leak)
   - Gate 3: flag=v2, all SGAs ticked = **6.5063 %** (was 39.2 %)
   - Gate 4: flag=v2, Lauren only = **3.309 %**
   - Gate 5: `npm run build` clean
9. **Doc sync**: `npx agent-guard sync`. Update `docs/ARCHITECTURE.md` if any section references SGA filtering.
10. **UI/browser validation**: human runs dashboard, toggles flag via env, verifies filters + debug panel visually.

Phases 2–5 are linear. Phases 6–7 pair up. Phase 8 is the promotion gate.

---

## 6. Risks and Blockers

### No blockers

Data layer, view availability, cost all pass.

### Risks to manage in the guide

1. **Helper refactor blast radius.** `buildAdvancedFilterClauses` is called in 4 files with identical shape. If we split the return type, every caller changes. Preferred: add a NEW helper `buildSgaFilterClause(filters, mode, paramPrefix, joinAlias)` that returns just the SGA predicate + params + JOIN fragment. Leave `buildAdvancedFilterClauses` to return non-SGA clauses only. Callers concatenate.

2. **Consistency of JOIN addition across 4 files.** `funnel-metrics.ts` always has `LEFT JOIN User sga_user`; `detail-records.ts` has it conditionally; `conversion-rates.ts` has none. When we add `LEFT JOIN vw_lead_primary_sga p`, it must go into all four. Phase-5 validation gate: `grep -nE "vw_lead_primary_sga" src/lib/queries/` shows all six call sites reference the new view.

3. **`conversion-rates.ts` single-SGA asymmetry.** Uses only `v.SGA_Owner_Name__c = @sga`, no Opp dual attribution unlike `funnel-metrics.ts`. Pre-existing quirk. Under v2, single-SGA path should also route through `vw_lead_primary_sga`. DO NOT re-introduce Opp dual attribution — scope creep.

4. **Re-engagement / opp-only rows.** Some `vw_funnel_master.Full_prospect_id__c` values are `006`-prefixed (Opp IDs). The view's `lead_pool` UNION handles 00Q Lead IDs plus funnel_master-only rows with NULL source fields. **LEFT JOIN** preserves all these. Under v2 SGA filter, `primary_sga_name IS NULL` for opp-only rows → they correctly drop out of per-SGA metrics.

5. **Debug panel env-var gating.** Server-side `ATTRIBUTION_DEBUG` controls whether server computes v1+v2. Client-side `NEXT_PUBLIC_ATTRIBUTION_DEBUG` controls whether UI shows the panel. Both must be true + user must be revops_admin/admin. Simpler alternative: server always computes v1 when flag=v2 (cheap extra query) and returns unconditionally; client gates display. Decide in guide.

6. **`lead_is_self_sourced` NULL leak.** 7 archival leads have `lead_is_self_sourced IS NULL`. None in Q3 2025 self-sourced cohort today. If any query filters on `p.lead_is_self_sourced = TRUE`, wrap in `COALESCE(p.lead_is_self_sourced, FALSE)`. Current SGA filter does NOT filter on this column. Guardrail.

7. **`GlobalFilters.tsx` fix requires knowing total SGAs available.** `handleMultiSelectChange` receives `next: string[]` but not total count. Pass `filterOptions.sgas.length` via a closure or derive in-place. Small prop change.

8. **Two bugs, one fix.** Rule 3 (selectAll collapse) alone fixes 6.5 % → 39.2 % at UI level WITHOUT needing v2. v2 adds richer per-SGA attribution. Guide must ship both but distinguish — Rule 3 is the immediate fix, v2 is the promotion-ready richer model.

### Pattern drift already surfaced (don't re-litigate)

- `extractDate` / `extractDateValue` — 4 local implementations. Phase 3 does not add a fifth.
- Debug UI panel pattern — no precedent. Compose `NEXT_PUBLIC_*` + role check.
