# SGM Hub Phase 2: Dashboard Tab — Exploration Results

**Date:** 2026-03-22
**Agents:** code-inspector, data-verifier, pattern-finder
**Status:** Exploration complete

---

## 1. Feature Summary

Building the **SGM Dashboard tab** — the second tab of the SGM Hub page. Includes:
- Dashboard-scoped filters (date range, channels, sources, SGM selector)
- Scorecards (7 standard + 2 ARR metrics — see spec changes below)
- Conversion trend charts (quarterly cohorted, rate + volume)
- Pipeline by Stage chart (reuse existing)
- SGM Conversion & Velocity table (reuse + new velocity column)
- Stale Pipeline alerts (reuse existing)

### Spec Changes Required (from data findings)

**CRITICAL — 2 scorecard changes from original spec:**

1. **"Estimated ARR" scorecard: REPURPOSE to Pipeline Estimated ARR** — `SGM_Estimated_ARR__c` is 0% populated on Joined records (Salesforce clears it at close). It's only populated on active pipeline stages (Sales Process, Negotiating, Discovery, On Hold). Rename to "Pipeline Est. ARR" and source from active pipeline records, not joined.

2. **"Est. ARR:Actual ARR Ratio" scorecard: REMOVE** — Since Estimated and Actual ARR are mutually exclusive across deal lifecycle stages (0 records have both), a ratio is meaningless. Replace with **"Joined ARR Coverage"** showing `n/N` (e.g., "72 of 116 advisors") or drop to 2 ARR scorecards total.

3. **Account_Total_ARR__c has team duplication** — Multiple advisors on the same Salesforce Account share the same Account-level ARR value. Cannot SUM directly for portfolio totals. Use `Actual_ARR__c` for the "Joined ARR" scorecard (individual, no duplication, 62.1% coverage). Display n= count alongside.

---

## 2. BigQuery Status

| Field | In View | Type | Population (Joined) | Status |
|-------|---------|------|---------------------|--------|
| `Actual_ARR__c` | ✅ | FLOAT64 | 62.1% (72/116) | Use for Joined ARR scorecard. Show n= count. |
| `SGM_Estimated_ARR__c` | ✅ | FLOAT64 | 0% on Joined, 100% on active pipeline | Pipeline only. Never use on joined queries. |
| `Account_Total_ARR__c` | ✅ | FLOAT64 | 92.2% on Joined | Per-advisor display OK. Never SUM across rows (duplication). |
| `Stage_Entered_Joined__c` | ✅ | TIMESTAMP | 91.4% (106/116) | Use for velocity calc. Fallback: `advisor_join_date__c`. |
| `Date_Became_SQO__c` | ✅ | TIMESTAMP | 94.0% on Joined | Correct SQO date field. No `Stage_Entered_SQO__c` exists. |
| `SGM_Owner_Name__c` | ✅ | STRING | 100% on Joined | Filter key. Always filter via User WHERE Is_SGM__c=TRUE. |

**SQO→Joined velocity:** 101 of 116 joined records (87.1%) have both dates. Avg: 82.9 days, median: 74 days, IQR: 36-108 days. No negative values. Clean data.

**Quarterly data depth:** 12 quarters available (2023-Q2 to 2026-Q1). SQL/SQO counts 92-216/quarter — robust. Joined counts 5-17/quarter — sufficient for totals, marginal for per-SGM-per-quarter breakdowns.

**No view changes required.**

---

## 3. Files to Modify

### New Files to Create

| File | Purpose |
|------|---------|
| `src/components/sgm-hub/SGMDashboardFilters.tsx` | Dashboard tab filter bar + advanced slide-out |
| `src/components/sgm-hub/SGMDashboardScorecards.tsx` | Scorecard grid (9 cards: 7 standard + 2 ARR) |
| `src/components/sgm-hub/SGMConversionCharts.tsx` | Quarterly conversion rate trend + volume bar chart |
| `src/components/sgm-hub/SGMQuarterSelector.tsx` | Quarter count selector (4-8 quarters) |
| `src/app/api/sgm-hub/dashboard-metrics/route.ts` | Funnel metrics scoped to SGM |
| `src/app/api/sgm-hub/conversions/route.ts` | SGM conversion data (broader role access) |
| `src/app/api/sgm-hub/conversion-trend/route.ts` | Quarterly cohorted conversion data |

### Existing Files to Modify

| File | Change |
|------|--------|
| `src/app/dashboard/sgm-hub/SGMHubContent.tsx` | Add Dashboard tab state, fetch logic, System 1 drilldown state (6 vars), render Dashboard tab sections |
| `src/types/sgm-hub.ts` | Add `SGMDashboardFilters`, `SGMDashboardMetrics`, `SGMConversionTrend` types |
| `src/types/dashboard.ts` | Add `actualArr?`, `estimatedArr?` to `FunnelMetrics`. Add `avgDaysSqoToJoined?` to `SgmConversionData`. |
| `src/lib/api-client.ts` | Add `getSGMDashboardMetrics()`, `getSGMConversionTrend()`, `getSGMConversions()` methods |
| `src/lib/queries/open-pipeline.ts` | Add velocity column to `getSgmConversionData` SQL: `AVG(DATE_DIFF(Stage_Entered_Joined__c, Date_Became_SQO__c, DAY))` |
| `src/components/dashboard/PipelineFilters.tsx` | Add `hideSgmFilter?: boolean` prop, conditional render around SGM section |
| `src/components/dashboard/SgmConversionTable.tsx` | Add `avgDaysSqoToJoined` column rendering, optional `hideTeamAverage?: boolean` prop |

---

## 4. Type Changes

### `src/types/dashboard.ts` — FunnelMetrics

```typescript
// Add to existing interface (optional fields, backward compatible)
actualArr?: number;       // SUM(Actual_ARR__c) from joined records
estimatedArr?: number;    // SUM(SGM_Estimated_ARR__c) from active pipeline
arrCoverageCount?: number; // count of joined records with Actual_ARR__c
```

### `src/types/dashboard.ts` — SgmConversionData

```typescript
// Add to existing interface
avgDaysSqoToJoined?: number;  // AVG days from SQO to Joined
```

### `src/types/sgm-hub.ts` — New types

```typescript
// Dashboard tab filters
export interface SGMDashboardFilters {
  startDate: string;
  endDate: string;
  channels: string[];
  sources?: string[];
  sgmNames?: string[];
}

// Dashboard tab metrics (extends FunnelMetrics concept)
export interface SGMDashboardMetrics {
  // Standard 7 from Funnel Performance
  sqls: number;
  sqos: number;
  signed: number;
  signedAum: number;
  joined: number;
  joinedAum: number;
  openPipelineAum: number;
  // ARR additions
  actualArr: number;
  arrCoverageCount: number;  // n= advisors with ARR data
  estimatedArr: number;      // pipeline-only
}

// Quarterly conversion trend data point
export interface SGMConversionTrend {
  quarter: string;           // "2025-Q1" format
  sqlCount: number;
  sqoCount: number;
  joinedCount: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  sqlToSqoNumer?: number;
  sqlToSqoDenom?: number;
  sqoToJoinedNumer?: number;
  sqoToJoinedDenom?: number;
}
```

---

## 5. Construction Site Inventory

Every location that builds a modified type:

### FunnelMetrics construction sites
| File | Function/Location | Change |
|------|-------------------|--------|
| `src/lib/queries/funnel-metrics.ts` | Main metrics query | Add `actualArr`, `estimatedArr`, `arrCoverageCount` to result |
| `src/app/api/dashboard/funnel-metrics/route.ts` | Response builder | Pass through new fields |
| New: `src/app/api/sgm-hub/dashboard-metrics/route.ts` | New route | Build full metrics response with ARR |

### SgmConversionData construction sites
| File | Function/Location | Change |
|------|-------------------|--------|
| `src/lib/queries/open-pipeline.ts` | `getSgmConversionData` (~line 830) | Add AVG velocity column to SQL + map to `avgDaysSqoToJoined` |
| `src/app/api/dashboard/sgm-conversions/route.ts` | Response passthrough | No change needed (passthrough) |
| New: `src/app/api/sgm-hub/conversions/route.ts` | New route | Passthrough with broader role access |

### SgmConversionTable rendering
| File | Location | Change |
|------|----------|--------|
| `src/components/dashboard/SgmConversionTable.tsx` | Column render + header | Add "SQO → Joined (days)" column, `hideTeamAverage` prop |

---

## 6. Recommended Phase Order

### Phase 1: Types & API Foundation
1. Add types to `sgm-hub.ts` and `dashboard.ts`
2. Add velocity column to `getSgmConversionData` SQL
3. Create 3 new API routes (`dashboard-metrics`, `conversions`, `conversion-trend`)
4. Add 3 new methods to `api-client.ts`
5. **Validation gate:** `npm run build` passes

### Phase 2: Filter Component
1. Create `SGMDashboardFilters.tsx` mirroring System B pattern (direct-apply)
2. Add Dashboard tab filter state vars to `SGMHubContent.tsx`
3. Wire filter state → component → onApply → state update
4. **Validation gate:** Filters render, state changes logged in console

### Phase 3: Scorecards
1. Create `SGMDashboardScorecards.tsx` (9 cards: 7 standard + 2 ARR)
2. Add dashboard metrics fetch to `SGMHubContent.tsx` (useEffect watching filter state)
3. Wire System 1 drilldown state (6 vars) + `VolumeDrillDownModal`
4. **Validation gate:** Scorecards display with real data, drilldowns work

### Phase 4: Conversion Charts
1. Create `SGMQuarterSelector.tsx`
2. Create `SGMConversionCharts.tsx` (rate trend line + volume bar chart)
3. Wire quarterly data fetch → charts
4. Add clickable bars → drilldown
5. **Validation gate:** Charts render with 4-quarter default, expandable to 8

### Phase 5: Reused Components
1. Add `hideSgmFilter` prop to `PipelineFilters.tsx`
2. Embed `PipelineByStageChart` with SGM-scoped data
3. Add velocity column to `SgmConversionTable.tsx`, add `hideTeamAverage` prop
4. Embed `SgmConversionTable` with SGM-scoped data via new API route
5. Embed `StalePipelineAlerts` with SGM-scoped data
6. **Validation gate:** All 3 reused components render with SGM-filtered data

### Phase 6: Polish & Documentation
1. Loading states for all sections
2. Empty state handling (no data for selected filters)
3. `npx agent-guard sync`
4. **Validation gate:** Full tab works end-to-end, build passes

---

## 7. Risks and Blockers

| Severity | Risk | Mitigation |
|----------|------|------------|
| **CRITICAL** | `SGM_Estimated_ARR__c` is 0% on Joined records — spec assumed it would be available | Repurpose to "Pipeline Est. ARR" sourced from active pipeline stages |
| **CRITICAL** | `Account_Total_ARR__c` duplicated across team members on same Account | Use `Actual_ARR__c` for totals (62.1% coverage). Show n= count. Per-row display of Account ARR is OK. |
| **HIGH** | `Actual_ARR__c` only 62.1% populated | Display n= alongside any ARR aggregate. Do not impute. |
| **MEDIUM** | Joined counts marginal per-SGM-per-quarter (5-17 total/quarter) | Display n= counts with percentages. Warn users about small sample sizes. |
| **MEDIUM** | `getSgmConversionData` anchors on `converted_date_raw` (SQL creation date), not SQO or joined date | Document date anchor explicitly. New conversion trend query should use cohort mode (each stage → own date). |
| **LOW** | `extractDate()` local helper in `open-pipeline.ts` duplicates shared `extractDateValue()` | Use local `extractDate()` within that file. Do not mix. |
| **LOW** | GinaRose Galli shows anomalous near-zero SQLs in Q4 2025 / Q1 2026 by FilterDate | Investigate lead ownership attribution. Join counts healthy via `advisor_join_date__c`. |
| **INFO** | Two new SGM names (Russell Armitage, Channing Guyer) not in Phase 1 | Always filter via `User WHERE Is_SGM__c = TRUE AND IsActive = TRUE` |

---

## 8. Key Architectural Decisions

### Drilldown System
- **Dashboard tab scorecards → System 1** (`DetailRecord[]` + `VolumeDrillDownModal`) per spec
- **Leaderboard tab → System 2** (`DrillDownRecord[]` + `MetricDrillDownModal`) already built
- Both coexist in `SGMHubContent.tsx` with separate state var sets. Only one open at a time.
- Pattern finder noted System 2 is already imported in SGMHubContent — System 1 needs additional import of `VolumeDrillDownModal`

### Filter Architecture
- Follow **System B** (direct-apply, single-state) matching existing leaderboard pattern
- Dashboard tab gets its own parallel state vars (`dashboardDateRange`, `dashboardChannels`, etc.) per spec
- Spec explicitly requires separate filter state from leaderboard (different filter types: date range vs quarter)
- Filter options reuse existing `dashboardApi.getFilterOptions()` and `sgmOptions` already fetched on mount

### Component Reuse
- `PipelineByStageChart`: props-only, pass SGM-filtered data from existing API
- `StalePipelineAlerts`: props-only, pass SGM-filtered `DetailRecord[]` from existing API
- `SgmConversionTable`: props-only, no role gate in component (gate is in API route). Create new `/api/sgm-hub/conversions/` with broader roles.
- `Scorecards.tsx` from Funnel Performance: **NOT reused directly** — create `SGMDashboardScorecards.tsx` with 9 cards (7 standard + 2 ARR). The existing Scorecards component's `visibleMetrics` doesn't support ARR cards.

### Recharts Mandates
- `isAnimationActive={false}` on ALL Bar/Line/Area components (D3 crash fix)
- Dark mode via `useTheme().resolvedTheme === "dark"`
- `CustomTooltip` with null guard pattern
- Type coercion: always `toNumber()` / `toString()` from `@/types/bigquery-raw.ts`
- All queries wrapped in `cachedQuery(..., CACHE_TAGS.DASHBOARD, { revalidate: 300 })`

---

## 9. Documentation

Implementation guide must include:
- Phase 7.5: `npx agent-guard sync` after code changes pass build
- Update `docs/ARCHITECTURE.md` SGM Hub section with Dashboard tab details
- Auto-generated docs via `npm run gen:api-routes` after adding new API routes

---

## 10. Reference: Existing API Endpoints (Reusable Without Changes)

| Endpoint | Method | Supports SGM Filter | Used By |
|----------|--------|---------------------|---------|
| `/api/dashboard/open-pipeline` | GET | `?sgm=Name` | StalePipelineAlerts |
| `/api/dashboard/pipeline-summary` | POST | `sgms: [Name]` | PipelineByStageChart |
| `/api/dashboard/pipeline-drilldown` | GET | `?sgm=Name` | Pipeline bar click |
| `/api/dashboard/sgm-conversion-drilldown` | GET | `?sgm=Name` | Conversion table click |

---

## 11. Detailed Findings

See individual agent reports:
- `docs/code-inspector-findings.md` — 516 lines, component props, query functions, type analysis
- `docs/data-verifier-findings.md` — 463 lines, field verification, ARR analysis, velocity stats
- `docs/pattern-finder-findings.md` — 543 lines, end-to-end patterns, Recharts conventions, filter architecture
