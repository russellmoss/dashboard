# Pattern Finder Findings — Phase 3 Attribution Routing

Generated: 2026-04-21
Feature: Route SGA-filtered queries through `Tableau_Views.vw_lead_primary_sga` behind `ATTRIBUTION_MODEL` feature flag.

---

## Pre-read: bq-patterns.md

Read and confirmed. Covers DATE/TIMESTAMP types, deduplication flags, channel grouping, AUM COALESCE, SGA dual attribution, cohort vs period mode, re-engagement rules. Below documents patterns NOT covered there, or directly load-bearing for Phase 3.

---

## Pattern 1: Feature Flag / Env Var Reader

**No feature-flag library, no GrowthBook/LaunchDarkly, no dedicated env-var utility.**

Only pattern: raw `process.env.*` reads at module level or inside functions.
- `src/lib/bigquery.ts` lines 8, 20, 27, 67: GCP project vars
- `src/lib/logger.ts` lines 20–21: `this.isDevelopment = process.env.NODE_ENV === 'development'`
- `src/app/global-error.tsx` line 85: inline in JSX

**Canonical idiom:** read `process.env.VAR` at call time (server-side), assign to local `const`. No abstraction.

**Implication for `attribution-mode.ts`:** No existing abstraction. Minimal pattern:
```typescript
export const ATTRIBUTION_MODEL = (process.env.ATTRIBUTION_MODEL ?? 'v1') as 'v1' | 'v2';
export const ATTRIBUTION_DEBUG = process.env.ATTRIBUTION_DEBUG === 'true';
```

Client-side needs `NEXT_PUBLIC_` prefix. `ATTRIBUTION_MODEL` and `ATTRIBUTION_DEBUG` are server-only. For debug UI, use separate `NEXT_PUBLIC_ATTRIBUTION_DEBUG` OR fetch from API route.

---

## Pattern 2: SGA Filter Flow End-to-End

**Entry point:** `src/lib/utils/filter-helpers.ts` — bug at lines 106–109.

**Callers of `buildAdvancedFilterClauses`** — all use prefix `'adv'`:

| File | Lines | WHERE assembly |
|---|---|---|
| `src/lib/queries/funnel-metrics.ts` | 17–18 | Pushes adv into `conditions[]`, `conditions.join(' AND ')`, wraps `WHERE`. Separate CASE-expression SGA inline (`${sgaFilterForLead}`) for legacy single-SGA. |
| `src/lib/queries/conversion-rates.ts` | 53–55, 503–505 | Two functions; `'AND ' + conditions.join(' AND ')`. |
| `src/lib/queries/detail-records.ts` | 19–20 | Same `conditions[]` pattern. |
| `src/lib/queries/source-performance.ts` | 17–18, 229–230 | Same. |

**SGA field references:**
- `funnel-metrics.ts`: WHERE uses `v.SGA_Owner_Name__c`. Legacy `filters.sga` generates inline CASE (44–45) using both `v.SGA_Owner_Name__c` AND `v.Opp_SGA_Name__c`. FROM always LEFT JOINs `User sga_user` (416–417).
- `detail-records.ts`: Conditionally `LEFT JOIN User sga_user ON v.Opp_SGA_Name__c = sga_user.Id` (282) only when `isOpportunityLevelMetric && filters.sga`.
- `conversion-rates.ts`: Only `v.SGA_Owner_Name__c = @sga` (75) — no Opp dual attribution. No User join.
- `source-performance.ts`: Same `conditions[]` idiom.

**Inconsistency flagged:** `funnel-metrics.ts` always adds User join; `detail-records.ts` conditional; `conversion-rates.ts` none. For v2, all 4 callers need `vw_lead_primary_sga` JOIN added consistently.

**Splitting SGA from non-SGA clauses:** `buildAdvancedFilterClauses` returns a flat `whereClauses[]`. No current mechanism to extract the SGA clause. For v2, function must be split or return an optional `sgaWhereClause` separately.

---

## Pattern 3: JOIN Patterns

**Style A — LEFT JOIN for optional enrichment:**
```sql
-- funnel-metrics.ts 415–417:
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` sga_user
  ON v.Opp_SGA_Name__c = sga_user.Id
WHERE ...
```
Universal when secondary is optional. Always after FROM, before WHERE.

**Style B — INNER JOIN for filter-narrowing:**
```sql
-- filter-options.ts 114–118:
INNER JOIN `savvy-gtm-analytics.SavvyGTMData.User` u
  ON v.SGA_Owner_Name__c = u.Name AND u.IsSGA__c = TRUE
```
Only for filter options, not main funnel.

**Row-duplication risk for `vw_lead_primary_sga`:** view is one-row-per-lead (DDL line 44). JOIN `p.lead_id = v.Full_prospect_id__c` on `vw_funnel_master` will not fan out.

**BUT:** re-engagement records in `vw_funnel_master` may come from `Opportunity.Id`, not `Lead.Id`. Their `Full_prospect_id__c` may not match `vw_lead_primary_sga.lead_id`. The view's `lead_pool` UNION ALL handles this (lines 289–302) with NULL fields. **LEFT JOIN required**, not INNER, to preserve opp-only records.

**Canonical idiom for v2:**
```sql
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_lead_primary_sga` p
  ON p.lead_id = v.Full_prospect_id__c
WHERE ...
  AND p.primary_sga_name IN UNNEST(@adv_sgas)
```
NULL `primary_sga_name` naturally fails IN clause → excluded (correct for orphan/none).

---

## Pattern 4: Parameterized Query Pattern

`@paramName` is universal. Every file passes `Record<string, any>` to `runQuery<T>(query, params)` in `src/lib/bigquery.ts` line 81–85.

Canonical: `funnel-metrics.ts` line 88–90:
```typescript
AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate)
AND TIMESTAMP(v.FilterDate) <= TIMESTAMP(@endDate)
${sgaFilterForLead}   // expands to: AND v.SGA_Owner_Name__c = @sga
```

String interpolation used ONLY for structural SQL (table names, conditional JOIN fragments, CASE fragments with no user data). No user values ever interpolated.

**`sgaFilterForLead` pattern** — interpolated fragment containing `@sga` parameter — is the idiom for Phase 3's v2 SGA clause.

**No blockers.**

---

## Pattern 5: NULL Handling for Owner Fields

`SGA_Owner_Name__c` and `SGM_Owner_Name__c` nullable throughout:
- `detail-records.ts` 410–411: `sga: r.sga ? toString(r.sga) : null`
- `RawDetailRecordResult` in `src/types/bigquery-raw.ts` 89: `sga: string | null`
- `filter-options.ts` 118–119: NULLs filtered out for dropdown

`DetailRecord` has `sga: string | null`, `sgm: string | null`. Frontend displays null as blank/Unknown.

**`primary_sga_name` NULL convention:** NULL when `primary_sga_reason IN ('orphan', 'none')`. In v2 with SGA filter active, NULL fails IN clause → lead excluded. Correct behavior: these leads belong to no real SGA. No special NULL handling needed beyond LEFT JOIN.

---

## Pattern 6: CSV/Sheets Export Column Mapping

**Path A — ExportButton (automatic):**
`src/lib/utils/export-csv.ts` line 10–11: `const headers = Object.keys(data[0]);`
Adding a new field → auto-appears in CSV.

**Path B — ExportMenu (explicit):**
`src/components/dashboard/ExportMenu.tsx` 30–43 uses `data.columns` (explicit `QueryResultData.columns[]`). Driven by semantic-layer compiler output. Only used in ExploreResults.

`MetricDrillDownModal.tsx` line 30 imports `ExportButton` (automatic).

**Summary:** ExportButton = automatic; ExportMenu = manual (Explore only); MetricDrillDownModal = automatic.

---

## Pattern 7: Admin-Role Check Pattern

**Server-side:**
```typescript
// src/app/api/dashboard/funnel-metrics/route.ts 22–23:
const permissions = getSessionPermissions(session);
```

`src/lib/permissions.ts` — `ROLE_PERMISSIONS`: `revops_admin` and `admin` have `canManageUsers: true`; `manager` does not.

**Client-side:**
```typescript
// src/app/dashboard/page.tsx 256–257, 322:
const { data: session, status } = useSession();
const permissions = getSessionPermissions(session);
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager';
```
Drives conditional JSX.

**For ATTRIBUTION_DEBUG:**
```typescript
const isRevOpsAdmin = permissions?.role === 'revops_admin' || permissions?.role === 'admin';
const showAttributionDebug = isRevOpsAdmin && process.env.NEXT_PUBLIC_ATTRIBUTION_DEBUG === 'true';
```

---

## Pattern 8: ExploreResults.tsx Drilldown Handler

`src/components/dashboard/ExploreResults.tsx` 597–695: raw-row-to-`DetailRecord` with dual-name fallback:

```typescript
const sga = (row.sga as string) || (row.sga_owner_name__c as string) || null;
```

`tofStage` uses `'Prospect'` fallback (692), inconsistent with nullable — pre-existing. `oppCreatedDate` = null hardcoded (693), `daysInCurrentStage` = null hardcoded (694).

If Phase 3 added `primarySgaName`: add similar dual-name line + add to returned object + update `DetailRecord` type. **Current scope: no additions needed.**

---

## Pattern 9: Date Handling Helpers

Two local helpers, four implementations:

- **`extractDate`** (`detail-records.ts` 340–345, `sgm-leaderboard.ts` 59): mixed return types.
- **`extractDateValue`** (`record-detail.ts` 275–278, `forecast-pipeline.ts` 5, `sga-activity.ts` 179, `outreach-effectiveness.ts` 72): also mixed.

**Inconsistency:** 4 separate copies; 2 return `string | null`, 2 return `string`. No shared utility.

**For Phase 3:** Use `extractDateValue` from `record-detail.ts` (most typed). Don't add a fifth. Consider shared export to `src/lib/utils/date-helpers.ts`.

---

## Pattern 10: Debug/Dev-Only UI Panels

**Pattern A — `NODE_ENV === 'development'`** (build-time): `global-error.tsx` 85, `ErrorBoundary.tsx` 66, 130, `advisor-map/error.tsx` 87. Always-off in production.

**Pattern B — `NEXT_PUBLIC_*` runtime env:** `src/instrumentation-client.ts` 4. Works at runtime with prefix.

**For ATTRIBUTION_DEBUG:** Neither exactly fits. Need on-in-production for admins + env-var gate + role check.

Correct: `NEXT_PUBLIC_ATTRIBUTION_DEBUG` + `isRevOpsAdmin`. **No existing precedent** for this combination.

---

## Consistency Summary

**Consistent:**
- `@paramName` for user values; no interpolation
- `LEFT JOIN` before `WHERE` on funnel path
- `toNumber()`, `toString()` from `bigquery-raw.ts`
- `buildAdvancedFilterClauses` called identically in 4 callers
- `FULL_TABLE` constant for primary view

**Drift / inconsistencies:**
1. `extractDate` vs `extractDateValue` — 4 implementations, mixed return types.
2. `funnel-metrics.ts` always adds `sga_user` LEFT JOIN; `detail-records.ts` conditional; `conversion-rates.ts` none. Phase 3 must add `vw_lead_primary_sga` JOIN consistently.
3. `ExploreResults.tsx` dual-name fallback — any new field needs manual addition.
4. `conversion-rates.ts` single-SGA uses only `v.SGA_Owner_Name__c = @sga` (no Opp dual attribution unlike `funnel-metrics.ts`). Pre-existing.
5. `buildQueryParams` in `bigquery.ts` 93–135: legacy helper, hardcoded `SGA_Owner_Name__c = @sga` at 125. Not used by 4 main callers. Appears unused.

---

## Key Files for Phase 3

- `src/lib/utils/filter-helpers.ts` — bug at 106–109
- `src/lib/queries/funnel-metrics.ts` — 17–18, 44–45, 415–417
- `src/lib/queries/conversion-rates.ts` — 53–55, 503–505
- `src/lib/queries/detail-records.ts` — 19–20, 281–283
- `src/lib/queries/source-performance.ts` — 17–18, 229–230
- `src/types/filters.ts` — `MultiSelectFilter.selectAll` (22), `DEFAULT_ADVANCED_FILTERS` (42–81)
- `src/config/constants.ts` — `FULL_TABLE` (36)
- `src/lib/permissions.ts` — `ROLE_PERMISSIONS`
- `src/types/auth.ts` — `getSessionPermissions()` (23)
- `src/app/dashboard/page.tsx` — `isAdmin` pattern (322)
- `src/components/dashboard/ExploreResults.tsx` — drilldown (597–695), SGA at 617–619
- `src/types/bigquery-raw.ts` — `toNumber()`, `toString()`
- `views/vw_lead_primary_sga.sql` — new view DDL
