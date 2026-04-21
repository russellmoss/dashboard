# Code Inspector Findings — Phase 3 Attribution Routing

Generated: 2026-04-21
Feature: Route SGA-filtered queries through `Tableau_Views.vw_lead_primary_sga` behind `ATTRIBUTION_MODEL` feature flag.

---

## 1. TypeScript Types That Need New Fields

**No new fields are required on `DetailRecord` or `DrillDownRecord` for Phase 3.**

The `vw_lead_primary_sga` columns (`primary_sga_name`, `primary_sga_reason`, `is_orphan_mql`, etc.) are JOIN-side routing data, not display data surfaced to components. The drill-down records being returned still describe the same lead/opp rows; only the filter predicate changes. No type interface gains a new field unless the ATTRIBUTION_DEBUG panel chooses to display `primary_sga_reason` — which would be a new, debug-only interface, not an extension of any existing wide type.

**One exception: the attribution-debug panel itself.** If it displays per-row debug info (v1 vs v2 rate comparison), that is a new local type and does not touch the five wide types listed in CONSTRAINTS.md.

Implication: **no construction-site cascade triggered by Phase 3** for existing types. Gate 5 ("all construction sites covered") passes trivially for the existing type surface if no new fields are added to `DetailRecord`, `DrillDownRecord`, `FunnelMetrics`, `RecordDetailFull`, or `SGMQuotaProgress`.

---

## 2. Construction Sites (All Wide Types — Complete Inventory)

Since Phase 3 adds no fields to existing wide types, the construction-site audit below is confirmatory / defensive.

### `DetailRecord` — 3 Construction Sites

- `src/lib/queries/detail-records.ts` lines 404–449 — the `results.map(r => { ... return { id, advisorName, ... } })` block at the end of `_getDetailRecords`. Authoritative construction site for all non-Explore detail records.
- `src/lib/queries/export-records.ts` — does NOT construct `DetailRecord`. It constructs `ExportDetailRecord` (separate type from `src/lib/sheets/sheets-types`). Not a construction site for `DetailRecord`.
- `src/components/dashboard/ExploreResults.tsx` lines 597–695 — the `detailData.result.rows.map((row, idx) => { ... return { id, advisorName, ..., tofStage, oppCreatedDate, daysInCurrentStage } })` block inside `handleDrillDown`. Manually builds `DetailRecord[]` from raw API row data.

The ExploreResults construction site at lines 650–695 maps:
- `sga` from `row.sga` or `row.sga_owner_name__c` (line 617–619)
- No field from `vw_lead_primary_sga` is mapped here — the drilldown is built via a fresh `/api/agent/query` call, not via the main funnel query with v2 routing. ExploreResults drilldown remains on v1 paths regardless of `ATTRIBUTION_MODEL`.

### `DrillDownRecord` Variants — 1 Construction Site Each

All 8 variants constructed exclusively in `src/lib/queries/drill-down.ts` via transform functions. Consumed by `MetricDrillDownModal.tsx` (SGA Hub), not the funnel page — **OUT OF SCOPE for Phase 3**.

---

## 3. Query Functions That Apply SGA Filters — Complete List

### In Scope (Funnel Page — `buildAdvancedFilterClauses` path)

| File | Lines | Mechanism | In Scope? |
|---|---|---|---|
| `src/lib/queries/funnel-metrics.ts` | 18 | `buildAdvancedFilterClauses(advancedFilters, 'adv')` + legacy `filters.sga` single-select at lines 44–51 | **YES** |
| `src/lib/queries/conversion-rates.ts` | 55 (`_getConversionRates`), 505 (`getConversionTrends`) | Both call `buildAdvancedFilterClauses` + apply `filters.sga` single-select (`v.SGA_Owner_Name__c = @sga`) | **YES** |
| `src/lib/queries/detail-records.ts` | 19 | `buildAdvancedFilterClauses` + `filters.sga` single-select (lines 43–54) | **YES** |
| `src/lib/queries/source-performance.ts` | 18, 229 | Calls `buildAdvancedFilterClauses`, applies `v.SGA_Owner_Name__c = @sga` at lines 34–35 and 251–252 | **YES** |

### Directly References `SGA_Owner_Name__c` Without `buildAdvancedFilterClauses` (Funnel Page)

- `src/lib/queries/export-records.ts` line 42: `filterConditions.push('v.SGA_Owner_Name__c = @sga')` — applies `filters.sga` single-select only; no multi-select path. **IN SCOPE** (export from funnel page).

### Out of Scope

- `src/lib/queries/outreach-effectiveness.ts` — excluded by brief (Phase 4 separate work).
- `src/lib/queries/sga-activity.ts`, `weekly-actuals.ts`, `quarterly-progress.ts`, `admin-quarterly-progress.ts`, `sga-leaderboard.ts` — SGA Hub, out of scope.
- `src/lib/queries/drill-down.ts` — SGA Hub drill-downs, out of scope.
- `src/lib/queries/open-pipeline.ts` — uses `buildAdvancedFilterClauses` but is pipeline page; needs confirmation if it shares SGA multi-select filter behavior.
- `src/lib/queries/forecast-pipeline.ts`, `closed-lost.ts`, `advisor-locations.ts`, `forecast-export.ts`, `filter-options.ts`, `sgm-dashboard.ts` — non-funnel, out of scope.
- `src/lib/semantic-layer/` — Explore AI, Blocked Area, out of scope.
- `src/lib/reporting/tools.ts` — Slack bot, out of scope.

---

## 4. API Routes That Call In-Scope Query Functions

All thin pass-throughs under `src/app/api/dashboard/`:

| Route File | Query Function Called |
|---|---|
| `funnel-metrics/route.ts` | `getFunnelMetrics()` |
| `conversion-rates/route.ts` | `getConversionRates()`, `getConversionTrends()` |
| `detail-records/route.ts` | `getDetailRecords()` |
| `source-performance/route.ts` | `getSourcePerformance()`, `getChannelPerformance()` |
| `export-sheets/route.ts` | `getExportDetailRecords()` |

None of these routes need structural changes — they are pass-throughs. The `attribution-mode.ts` utility is read from query-layer code.

---

## 5. Export Paths That Read `SGA_Owner_Name__c`

### Automatic (ExportButton / Object.keys)
`src/components/ui/ExportButton.tsx` — uses `Object.keys()` on data rows. Auto-includes any new column. No manual update.

### Explicit Column Mappings — Must Be Updated Manually
**ExportMenu** (`src/components/dashboard/ExportMenu.tsx`): Used in ExploreResults at lines 889–896 and 1093–1101. Drilldown export manually maps `DetailRecord` fields (`'SGA': r.sga || ''`). Under v2, `r.sga` still comes from `SGA_Owner_Name__c` (Explore does not route through v2). No change needed.

**MetricDrillDownModal** (`src/components/sga-hub/MetricDrillDownModal.tsx`): Uses `ExportButton` (auto). Column configs do NOT include an SGA column in any of the 8 metric types. No change needed.

---

## 6. The v1 Flaw in `filter-helpers.ts:106-109` — Exact Analysis

```typescript
if (!safeFilters.sgas.selectAll && safeFilters.sgas.selected.length > 0) {
  whereClauses.push(`v.SGA_Owner_Name__c IN UNNEST(@${paramPrefix}_sgas)`);
  params[`${paramPrefix}_sgas`] = safeFilters.sgas.selected;
}
```

**Trigger:** `selectAll === false AND selected.length > 0`.

**"All SGAs selected" tracking:** `src/components/dashboard/GlobalFilters.tsx` lines 159–169:
```typescript
const handleMultiSelectChange = (key: MainBarMultiKey, next: string[]) => {
  onFiltersChange({
    ...filters,
    advancedFilters: {
      ...adv,
      [key]: {
        selectAll: next.length === 0,  // ← ONLY when selection is empty
        selected: next,
      },
    },
  });
};
```

**Bug:** When user individually checks every SGA, `next` has all names; `next.length === 0` is false; `selectAll=false`; IN clause fires with all 14 names. Any lead swept to "Savvy Operations" is excluded.

**Fix for Rule 3:** In `handleMultiSelectChange`, compare `next.length` to total SGA options. If equal, set `selectAll: true, selected: []`. UI-layer fix — cleanest.

Alternative: filter-helpers compares `selected.length === totalAvailable`; component layer is cleaner.

**`IN UNNEST` syntax is correct BigQuery** — bug is in selectAll logic, not SQL.

---

## 7. ExploreResults.tsx Drilldown Under v2

Drilldown (`handleDrillDown`, lines 317–713) constructs NL question, sends to `/api/agent/query`. Rows mapped to `DetailRecord` at lines 597–695.

`sga` at line 617–619: `row.sga as string || row.sga_owner_name__c as string || null`.

Semantic layer is Blocked — Phase 3 does not modify it. Explore drilldown continues reading `v.SGA_Owner_Name__c AS sga` from query templates. **ExploreResults is unaffected by Phase 3.**

---

## 8. Existing Feature-Flag Utility Pattern

**No existing utility.** Closest patterns:
1. Direct `process.env` reads at module level (`src/lib/email.ts:4`, `src/lib/metabase.ts:10-11`)
2. Inline `process.env` reads inside functions (`src/lib/bigquery.ts:20`, `src/lib/data-transfer.ts:30`)
3. No boolean feature-flag utility exists

**Proposed `src/lib/utils/attribution-mode.ts`:**
```typescript
export type AttributionModel = 'v1' | 'v2';

export function getAttributionModel(): AttributionModel {
  const val = process.env.ATTRIBUTION_MODEL;
  return val === 'v2' ? 'v2' : 'v1';
}

export function isAttributionDebugEnabled(): boolean {
  return process.env.ATTRIBUTION_DEBUG === 'true';
}
```

---

## 9. Admin-Role Check Pattern for ATTRIBUTION_DEBUG Panel

**Server-side:**
```typescript
const session = await getServerSession(authOptions);
const permissions = getSessionPermissions(session);
```

`UserPermissions.role` field is the discriminant. For debug panel:
```typescript
const isAdminOrManager = ['admin', 'revops_admin', 'manager'].includes(permissions.role);
```

**Client-side:** `GlobalFilters` already receives `isAdmin?: boolean` prop (line 35). Page derives from session.

**Note:** No `canManageUsers` boolean covers "admin or manager" specifically. Debug panel needs explicit role-array check.

---

## Summary of Phase 3 Scope (Precise)

**Files that must change (in-scope):**
1. `src/lib/utils/filter-helpers.ts` — fix lines 106–109 (Rule 3: selectAll collapse) + add v2 routing branch
2. `src/lib/queries/funnel-metrics.ts` — v2 routing when flag + SGA filter active
3. `src/lib/queries/conversion-rates.ts` — both `_getConversionRates` and `getConversionTrends`
4. `src/lib/queries/detail-records.ts`
5. `src/lib/queries/source-performance.ts`
6. `src/lib/queries/export-records.ts` — applies `filters.sga` single-select only

**New files:**
7. `src/lib/utils/attribution-mode.ts` — env-var reader utility

**Export paths:** no changes needed for Phase 3 under current type scope.

**Construction sites:** no cascade. No new fields added to existing wide types. Gate 5 satisfied.

**`GlobalFilters.tsx`** — `handleMultiSelectChange` (lines 159–169) needs "all selected → collapse to selectAll=true" fix. UI side of the filter-helpers fix; both must change together.

**Out of scope:** `src/lib/semantic-layer/`, `outreach-effectiveness.ts`, `drill-down.ts`, `sga-activity.ts`, `weekly-actuals.ts`, `quarterly-progress.ts`, `MetricDrillDownModal.tsx`, `ExploreResults.tsx`, all API routes.
