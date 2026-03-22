# Code Inspector Findings -- SGM Hub Phase 2 (Dashboard Tab)

Generated: 2026-03-22

---

## 1. Scorecards Component

**File:** `src/components/dashboard/Scorecards.tsx`

### Props Interface (lines 18-36)

```typescript
interface ScorecardsProps {
  metrics: FunnelMetricsWithGoals;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
  visibleMetrics?: {
    sqls: boolean; sqos: boolean; signed: boolean; signedAum: boolean;
    joined: boolean; joinedAum: boolean; openPipeline: boolean;
  };
  sqlDisposition?: MetricDisposition;
  onSqlDispositionChange?: (value: MetricDisposition) => void;
  sqoDisposition?: MetricDisposition;
  onSqoDispositionChange?: (value: MetricDisposition) => void;
}
```

Default for `visibleMetrics`: all fields `true`.

The component renders 7 metric cards (SQLs, SQOs, Signed, Signed AUM, Joined, Joined AUM, Open Pipeline AUM). Cards are conditionally shown via `visibleMetrics`. Cards fire `onMetricClick` when clicked, which opens a `VolumeDrillDownModal` in the parent. Goal variance is shown for SQLs, SQOs, and Joined when `metrics.goals` is non-null and goal > 0. Open Pipeline has no goal display. Disposition toggles (All/Open/Lost/Converted) for SQLs and SQOs are driven by `sqlDisposition`/`sqoDisposition` props -- the component reads from `metrics.sqls_open`, `metrics.sqls_lost`, etc. for sub-counts.

---

## 2. Funnel Performance Page -- Fetch to State to Scorecards Data Flow

**File:** `src/app/dashboard/page.tsx` (the page IS the content component -- no separate file; the page is 'use client')

### State variables feeding Scorecards

- Line 268: `const [metrics, setMetrics] = useState<FunnelMetricsWithGoals | null>(null);`
- Lines 286-288: Disposition toggles: `mqlDisposition`, `sqlDisposition`, `sqoDisposition` (type `MetricDisposition`)

### Fetch orchestration (lines 700-806, `fetchDashboardData` callback)

1. `useEffect` at line 819 fires when `filterOptions` loads and whenever `appliedFilters`, `featureSelection`, `viewMode`, or `trendGranularity` changes.
2. `fetchDashboardData` assembles `currentFilters` from `appliedFilters` and conditionally calls `dashboardApi.getFunnelMetrics(currentFilters, viewMode)` -- only if `needsMetrics` is true (checked against `featureSelection.scorecards.*`).
3. The result is passed to `setMetrics`.
4. Filters are two-tier: `filters` (live/pending from dropdowns) and `appliedFilters` (only updated when user presses Apply). Data fetches only run on `appliedFilters` changes.

### Scorecards render

```tsx
<Scorecards
  metrics={metrics}
  selectedMetric={selectedMetric}
  onMetricClick={handleMetricClick}
  visibleMetrics={featureSelection.scorecards}
  sqlDisposition={sqlDisposition}
  onSqlDispositionChange={setSqlDisposition}
  sqoDisposition={sqoDisposition}
  onSqoDispositionChange={setSqoDisposition}
/>
```

`handleMetricClick` (line 826) maps metric ID to `volumeDrillDownMetric` enum value, opens `VolumeDrillDownModal`, then calls `dashboardApi.getDetailRecords(drillDownFilters, 50000)` to populate `volumeDrillDownRecords` (`DetailRecord[]`).

---

## 3. Functions in `src/lib/queries/open-pipeline.ts`

All exported functions are wrapped in `cachedQuery(...)` with `CACHE_TAGS.DASHBOARD`.

| Export Line | Exported Name | Signature | Returns | API Route | Component |
|-------------|--------------|-----------|---------|-----------|-----------|
| 162 | `getOpenPipelineRecords` | `(filters?: { channel?, source?, sga?, sgm? })` | `Promise<DetailRecord[]>` | `/api/dashboard/open-pipeline` | `StalePipelineAlerts` |
| 252 | `getOpenPipelineSummary` | `(filters?: { stages?, sgms? })` | `Promise<{ totalAum, recordCount, byStage[] }>` | `/api/dashboard/open-pipeline` + `/api/dashboard/pipeline-summary` | `PipelineByStageChart` (via byStage transform) |
| 466 | `getOpenPipelineRecordsByStage` | `(stage: string, filters?: { channel?, source?, sga?, sgm?, sgms?, dateRange? })` | `Promise<DetailRecord[]>` | `/api/dashboard/pipeline-drilldown` | Bar-click drill-down on `PipelineByStageChart` |
| 548 | `getOpenPipelineBySgm` | `(filters?: { stages?, sgms?, dateRange? })` | `Promise<{sgm, stage, count, aum}[]>` | `/api/dashboard/pipeline-by-sgm` | SGM stacked chart in pipeline page |
| 753 | `getOpenPipelineRecordsBySgm` | `(sgm: string, stages?, sgms?, dateRange?)` | `Promise<DetailRecord[]>` | `/api/dashboard/pipeline-drilldown-sgm` | SGM bar-click drill-down |
| ~830 | `getSgmConversionData` | `(filters?: SgmConversionFilters)` | `Promise<SgmConversionData[]>` | `/api/dashboard/sgm-conversions` | `SgmConversionTable` |
| 1061 | `getSgmConversionDrilldownRecords` | `(sgm, metric: sql/sqo/joined, filters?)` | `Promise<DetailRecord[]>` | `/api/dashboard/sgm-conversion-drilldown` | `SgmConversionTable` click-through |

**Component routing:**
- `PipelineByStageChart` receives `OpenPipelineByStage[]` -- parent calls `getPipelineSummary` which calls `getOpenPipelineSummary`, then transforms the `byStage` array.
- `SgmConversionTable` receives `SgmConversionData[]` -- sourced from `getSgmConversionData` via `/api/dashboard/sgm-conversions`.
- `StalePipelineAlerts` receives `DetailRecord[]` -- sourced from `getOpenPipelineRecords` via `/api/dashboard/open-pipeline`.

---

## 4. `SgmConversionData` Type

**File:** `src/types/dashboard.ts` lines 261-272

```typescript
export interface SgmConversionData {
  sgm: string;
  sqlsReceived: number;
  sqlToSqoRate: number;
  sqosCount: number;
  sqoToJoinedRate: number;
  joinedCount: number;
  sqlToSqoNumer?: number;
  sqlToSqoDenom?: number;
  sqoToJoinedNumer?: number;
  sqoToJoinedDenom?: number;
}
```

The optional Numer/Denom fields are used by `SgmConversionTable` to compute statistically-correct team averages (aggregate rate = total numer / total denom, not average of per-row rates).

---

## 5. `PipelineFilters.tsx` -- SGM Owner Filter

**File:** `src/components/dashboard/PipelineFilters.tsx`

### Props interface (lines 19-29)

```typescript
interface PipelineFiltersProps {
  selectedStages: string[];
  onApply: (stages: string[], sgms: string[]) => void;
  selectedSgms: string[];
  sgmOptions: SgmOption[];
  sgmOptionsLoading: boolean;
  disabled?: boolean;
}
```

### SGM filter behavior

The SGM Owner filter section is **hardcoded into the layout** at line 285. There is **no prop to conditionally hide it**. It shows a search box, checkboxes for each `SgmOption`, and three quick-select buttons (Active Only, All SGMs, Deselect All). `localSgms` tracks pending state; `initialSgms` reflects applied state. `handleApplyFilters` (line 113) enforces at least one SGM selected before calling `onApply`.

**For SGM Dashboard tab:** A `hideSgmFilter?: boolean` prop would need to be added to `PipelineFiltersProps` with a conditional render around the SGM filter section (lines 285-379). Alternatively, pass a single-element `sgmOptions` array pre-scoped to the user's SGM name to effectively lock scope without hiding the UI.

---

## 6. `AdvancedFilters.tsx` -- Slide-Out Panel

**File:** `src/components/dashboard/AdvancedFilters.tsx`

### Props interface (lines 16-24)

```typescript
interface AdvancedFiltersProps {
  filters: AdvancedFiltersType;
  onFiltersChange: (filters: AdvancedFiltersType) => void;
  onApply?: (updatedFilters?: AdvancedFiltersType) => void;
  viewMode: ViewMode;
  onClose: () => void;
  isOpen: boolean;
  filterOptions: FilterOptions;
}
```

### Open/close state pattern

The component is **stateless for open/close** -- controlled entirely by the parent via `isOpen: boolean` and `onClose: () => void`. The component renders `null` when `!isOpen` (line 177). No internal toggle.

The panel renders as a fixed right-side slide-out (`fixed inset-0 z-50`, right-aligned `w-96` panel, line 188). Backdrop click (line 184) calls `onClose`. Local state `localFilters` is kept inside and synced from props. `handleApply` (line 162) calls `onFiltersChange(localFilters)`, then `onApply(localFilters)` if provided, then `onClose()`.

**For SGM Dashboard tab:** Same component can be reused with `isOpen`/`setIsOpen` state vars in `SGMHubContent`. The Dashboard tab may only need a subset of the advanced filters -- but the component passes all or nothing.

---

## 7. Types Needing Extension for 3 New ARR Metrics

**File:** `src/types/dashboard.ts`

### `FunnelMetrics` (lines 7-31) -- add optional fields

```typescript
export interface FunnelMetrics {
  // ... existing 20 fields ...
  actualArr?: number;       // Actual ARR from joined advisors
  estimatedArr?: number;    // Estimated ARR (pipeline-based)
  arrRatio?: number;        // actualArr / estimatedArr
}
```

Making them optional (`?`) preserves backward compatibility with all existing construction sites (ExploreResults.tsx, all query transforms, all API routes that build a metrics response).

### `FunnelMetricsWithGoals` (lines 52-54) -- no change needed

It extends `FunnelMetrics`, so optional fields are inherited automatically.

### `ForecastGoals` (lines 34-40) -- extend if ARR goals are needed

```typescript
export interface ForecastGoals {
  // ... existing fields ...
  actualArr?: number;
  estimatedArr?: number;
}
```

### `Scorecards.tsx` changes needed

`visibleMetrics` in `ScorecardsProps` would need 3 new boolean flags (`actualArr`, `estimatedArr`, `arrRatio`) and corresponding card render blocks. ARR cards would likely not show goal variance unless `ForecastGoals` is also extended.

---

## 8. Phase 1 Types in `src/types/sgm-hub.ts`

**File:** `src/types/sgm-hub.ts` (42 lines total)

### Existing types

| Type | Purpose |
|------|---------|
| `SGMHubTab = 'leaderboard' | 'dashboard' | 'quota-tracking'` | Tab identifiers -- `dashboard` and `quota-tracking` already declared for future phases |
| `SGMLeaderboardEntry` | One row per SGM: `sgmName`, `joinedCount`, `joinedAum`, `joinedAumFormatted`, `rank` |
| `SGMLeaderboardFilters` | API request payload: `startDate`, `endDate`, `channels`, `sources?`, `sgmNames?` |
| `SGMOption` | Filter picklist item: `value`, `label`, `isActive` |

### How Dashboard tab types should integrate

Add directly to `src/types/sgm-hub.ts` in a labeled section. Do NOT duplicate `FunnelMetricsWithGoals` -- import it from `src/types/dashboard.ts`. Suggested addition:

```typescript
// Phase 2: Dashboard Tab
export interface SGMDashboardFilters {
  quarter: string;            // e.g. "2025-Q1"
  sgmName?: string | null;    // null = all SGMs (admin view), string = scoped SGM
  channels?: string[];
  sources?: string[];
}
```

---

## 9. Phase 1 Additions to `src/types/drill-down.ts`

**File:** `src/types/drill-down.ts`

### Added for Phase 1 (SGM Leaderboard)

**`JoinedDrillDownRecord`** (lines 86-93) -- extends `DrillDownRecordBase`:
```typescript
export interface JoinedDrillDownRecord extends DrillDownRecordBase {
  joinDate: string;
  sgmName: string;
  aum: number;
  aumFormatted: string;
  aumTier: string | null;
  stageName: string | null;
}
```

**`RawJoinedDrillDownRecord`** (lines 254-269) -- BigQuery raw response type with `SGM_Owner_Name__c` and `advisor_join_date__c`.

`MetricType` union (line 8) was extended with `'joined'`.

`DrillDownRecord` union (line 106) now includes `JoinedDrillDownRecord`.

`DrillDownContext` (lines 282-290) was extended with optional `sgmName?: string | null` for SGM Hub back-button context.

### What Phase 2 Dashboard tab needs

The `VolumeDrillDownModal` path uses `DetailRecord[]` from `src/types/dashboard.ts`, NOT `DrillDownRecord[]`. No changes to `drill-down.ts` are needed for the Dashboard tab's volume scorecard drill-downs. If SGM-specific drill-down records beyond the leaderboard joined drill-down are added, new types would be warranted then.

---

## 10. Funnel Performance Drilldown State Management

**File:** `src/app/dashboard/page.tsx` lines 291-298

### State vars -- System 1 (`DetailRecord[]` + `VolumeDrillDownModal`)

```typescript
const [volumeDrillDownOpen, setVolumeDrillDownOpen] = useState(false);
const [volumeDrillDownRecords, setVolumeDrillDownRecords] = useState<DetailRecord[]>([]);
const [volumeDrillDownLoading, setVolumeDrillDownLoading] = useState(false);
const [volumeDrillDownError, setVolumeDrillDownError] = useState<string | null>(null);
const [volumeDrillDownTitle, setVolumeDrillDownTitle] = useState('');
const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<
  'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline' | null
>(null);
```

Yes -- Funnel Performance uses `VolumeDrillDownModal` with `DetailRecord[]`. `handleMetricClick` (line 826) populates these vars and calls `dashboardApi.getDetailRecords(drillDownFilters, 50000)`.

The record detail modal is a second layer: `selectedRecordId` + `RecordDetailModal`, with a Back button that re-opens the volume drill-down.

---

## 11. SGMHubContent Drilldown State -- How Both Systems Coexist

**File:** `src/app/dashboard/sgm-hub/SGMHubContent.tsx`

### System 2 (Phase 1 -- `DrillDownRecord[]` + `MetricDrillDownModal`)

Lines 49-55 -- current state vars:
```typescript
const [drillDownOpen, setDrillDownOpen] = useState(false);
const [drillDownMetricType, setDrillDownMetricType] = useState<MetricType | null>(null);
const [drillDownRecords, setDrillDownRecords] = useState<DrillDownRecord[]>([]);
const [drillDownLoading, setDrillDownLoading] = useState(false);
const [drillDownError, setDrillDownError] = useState<string | null>(null);
const [drillDownTitle, setDrillDownTitle] = useState('');
const [drillDownContext, setDrillDownContext] = useState<DrillDownContext | null>(null);
```

Uses `MetricDrillDownModal` from `src/components/sga-hub/MetricDrillDownModal.tsx`. Active for the leaderboard Joined click-through.

### System 1 (Phase 2 -- `DetailRecord[]` + `VolumeDrillDownModal`)

Add a separate set of state vars alongside the existing ones:

```typescript
// Dashboard tab -- Volume drill-down (System 1)
const [volumeDrillDownOpen, setVolumeDrillDownOpen] = useState(false);
const [volumeDrillDownRecords, setVolumeDrillDownRecords] = useState<DetailRecord[]>([]);
const [volumeDrillDownLoading, setVolumeDrillDownLoading] = useState(false);
const [volumeDrillDownError, setVolumeDrillDownError] = useState<string | null>(null);
const [volumeDrillDownTitle, setVolumeDrillDownTitle] = useState('');
const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<
  'sql' | 'sqo' | 'joined' | 'openPipeline' | null
>(null);
```

Render `VolumeDrillDownModal` in the JSX separately from the existing `MetricDrillDownModal`. Both coexist because they serve different tabs and are conditionally rendered. Only one will be open at a time.

**Pattern from main dashboard (line 1285):**
```tsx
{volumeDrillDownMetric && (
  <VolumeDrillDownModal
    isOpen={volumeDrillDownOpen}
    onClose={() => setVolumeDrillDownOpen(false)}
    records={volumeDrillDownRecords}
    title={volumeDrillDownTitle}
    loading={volumeDrillDownLoading}
    error={volumeDrillDownError}
    metricFilter={volumeDrillDownMetric}
  />
)}
```

---

## 12. `PipelineByStageChart.tsx` -- Data Source and Embedding

**File:** `src/components/dashboard/PipelineByStageChart.tsx`

**Does it fetch its own data?** No. Pure presentational component.

### Props interface (lines 20-24)

```typescript
interface PipelineByStageChartProps {
  data: OpenPipelineByStage[];  // from src/types/dashboard.ts
  onBarClick: (stage: string, metric: 'aum' | 'count') => void;
  loading?: boolean;
}
```

`OpenPipelineByStage` shape: `stage`, `advisorCount`, `totalAum`, `aumFormatted`, `aumInBillions`.

**How it is embedded:** The parent page fetches `OpenPipelineSummary` (containing `byStage: OpenPipelineByStage[]`), stores it in state, and passes `summary.byStage` as the `data` prop. The `onBarClick` handler in the parent opens a drill-down modal and fetches `DetailRecord[]` via `dashboardApi.getPipelineDrilldown(stage, filters, sgms, dateRange)`.

**For SGM Dashboard tab reuse:** Pass `data` from `dashboardApi.getPipelineSummary(stages, [sgmName])` for a single-SGM filtered view. The existing API and query already support this with no changes.

---

## 13. `StalePipelineAlerts.tsx` -- Data Source and Embedding

**File:** `src/components/dashboard/StalePipelineAlerts.tsx`

**Does it fetch its own data?** No. Pure presentational component.

### Props interface (lines 217-222)

```typescript
interface StalePipelineAlertsProps {
  records: DetailRecord[];
  loading: boolean;
  onStageClick: (stage: string, records: DetailRecord[]) => void;
  onRecordClick: (recordId: string) => void;
}
```

**How it works internally:** Groups `records` by `record.stage` client-side via `useMemo`. Separates On Hold from active pipeline stages. Each stage section is an expandable accordion. "View all" fires `onStageClick(stage, stageRecords)` to open a drill-down modal. Individual rows fire `onRecordClick(record.id)` to open `RecordDetailModal`. No pre-grouping needed from the parent.

**For SGM Dashboard tab reuse:** Pass `records` from `dashboardApi.getOpenPipeline({ sgm: sgmName })`. The component handles all grouping internally. No changes to the component needed.

---

## 14. `SgmConversionTable.tsx` -- Props, Role Gate, and SGM Access

**File:** `src/components/dashboard/SgmConversionTable.tsx`

### Props interface (lines 22-27)

```typescript
interface SgmConversionTableProps {
  data: SgmConversionData[];
  loading?: boolean;
  onMetricClick?: (sgm: string, metric: SgmConversionMetricType) => void;
}
// SgmConversionMetricType = 'sql' | 'sqo' | 'joined'
```

The component itself has **no role gate**. It renders whatever data is passed.

### Role gate location

`/api/dashboard/sgm-conversions/route.ts` line 30:
```typescript
if (permissions.role !== 'revops_admin') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**To make `SgmConversionTable` accessible to SGM users (recommended approach):**

Create a new route `/api/sgm-hub/conversions/route.ts` that:
1. Accepts roles `['sgm', 'admin', 'manager', 'revops_admin']`
2. When `role === 'sgm'`, auto-scopes to `sgmNames: [permissions.sgmFilter]`
3. Calls `getSgmConversionData({ sgms: [sgmName] })`

The `getSgmConversionData` query function already accepts `sgms?: string[]`. No query-layer changes needed.

**Team Average row:** When displaying single-SGM data, the Team Average row is identical to the data row. Adding a `hideTeamAverage?: boolean` prop would allow suppressing it in the SGM self-view.

---

## 15. API Client -- Phase 1 SGM Hub Methods and Phase 2 Gaps

**File:** `src/lib/api-client.ts` lines 654-694

### Existing SGM Hub methods

```typescript
// SGM Hub section begins at line 654

getSGMLeaderboard(filters: { startDate, endDate, channels, sources?, sgmNames? })
  // POST /api/sgm-hub/leaderboard
  // Returns { entries: SGMLeaderboardEntry[] }

getLeaderboardSGMOptions()
  // GET /api/sgm-hub/sgm-options
  // Returns { sgmOptions: Array<{ value, label, isActive }> }

getJoinedDrillDown(sgmName, { quarter }, channels?, sources?)
  // GET /api/sgm-hub/drill-down/joined
  // Returns { records: JoinedDrillDownRecord[] }
```

### Phase 2 Dashboard tab methods to add

These do not yet exist and should be added after `getJoinedDrillDown`:

```typescript
// Funnel metrics scoped to one SGM
getSGMDashboardMetrics(sgmName: string, filters: SGMDashboardFilters)
  // POST /api/sgm-hub/dashboard-metrics
  // Returns FunnelMetricsWithGoals

// Conversion data scoped to one SGM
getSGMConversionData(sgmName: string, filters: SGMDashboardFilters)
  // POST /api/sgm-hub/conversions
  // Returns { data: SgmConversionData[] }
```

**Already usable without new methods (no changes needed):**
- `dashboardApi.getOpenPipeline({ sgm: sgmName })` works today via `/api/dashboard/open-pipeline` with sgm filter
- `dashboardApi.getPipelineSummary(stages, [sgmName])` works today via `/api/dashboard/pipeline-summary` with sgms array
- `dashboardApi.getPipelineDrilldown(stage, { sgm: sgmName })` works today via `/api/dashboard/pipeline-drilldown`

---

## 16. Existing Phase 1 API Routes in `src/app/api/sgm-hub/`

```
src/app/api/sgm-hub/
  leaderboard/route.ts          -- POST
  sgm-options/route.ts          -- GET
  drill-down/
    joined/route.ts             -- GET
```

### `leaderboard/route.ts` auth pattern

Accepted roles: `['admin', 'manager', 'sgm', 'revops_admin']`. The SGM role is allowed. No automatic scoping in the route -- the client passes the SGM's own name via `SGMLeaderboardFilters.sgmNames`. This is the precedent for Dashboard tab routes.

### New routes needed for Phase 2

| Route | Method | Roles | Notes |
|-------|--------|-------|-------|
| `src/app/api/sgm-hub/dashboard-metrics/route.ts` | POST | sgm/admin/manager/revops_admin | Funnel metrics for one SGM's scope + quarter. When role=sgm, auto-scope. |
| `src/app/api/sgm-hub/conversions/route.ts` | POST | sgm/admin/manager/revops_admin | `SgmConversionData[]` for one SGM. Calls `getSgmConversionData({ sgms: [sgmName] })`. |

Open pipeline chart, stale pipeline alerts, and bar-click drill-downs reuse existing `/api/dashboard/` routes -- both already support an sgm/sgms filter. No new routes needed for those.

---

## Summary: Key Architectural Constraints for Phase 2

1. **`Scorecards` requires `FunnelMetricsWithGoals`** -- the full type with 20+ fields. Any new SGM-scoped metrics query must return this complete shape (optional ARR fields can be added with `?`).

2. **`PipelineByStageChart` and `StalePipelineAlerts` are pure presentational** -- accept `OpenPipelineByStage[]` and `DetailRecord[]` respectively. Both are directly reusable in the Dashboard tab with SGM-scoped data, no modifications needed.

3. **`SgmConversionTable` is pure presentational** -- the role gate lives entirely in the API route. Creating a new SGM Hub conversions route with appropriate scoping is the correct approach. Do not modify the existing revops_admin-only route.

4. **`PipelineFilters` has no prop to hide the SGM owner filter** -- a `hideSgmFilter?: boolean` prop addition is the minimal change needed if the Dashboard tab locks to the logged-in SGM's scope.

5. **Two drill-down systems can coexist in `SGMHubContent`** -- System 2 (`DrillDownRecord[]` + `MetricDrillDownModal`) for the leaderboard tab; System 1 (`DetailRecord[]` + `VolumeDrillDownModal`) for the dashboard tab. Separate state var sets, both sharing the same `RecordDetailModal` layer.

6. **`AdvancedFilters` is open/close stateless** -- the parent manages `isOpen`. Reusable as-is for the Dashboard tab.

7. **`getSgmConversionData` already accepts `sgms?: string[]`** -- no query-layer changes needed to support single-SGM scoping. Only a new route with appropriate auth is needed.

8. **`getSgmConversionDrilldownRecords` returns `DetailRecord[]`** -- this means the conversion table drill-down on the Dashboard tab can use `VolumeDrillDownModal` (System 1) rather than the SGA Hub-style `MetricDrillDownModal`, keeping the Dashboard tab fully in System 1.

