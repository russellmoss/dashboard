# SGM Hub — Phase 2 State Report & Phase 3 Prerequisites

## 1. Dashboard Tab Filter State in SGMHubContent.tsx

### useState Variables (Dashboard tab)

| Variable | Type | Purpose |
|---|---|---|
| `dashboardDateRange` | `{ startDate: string; endDate: string }` | Main date range; defaults to current QTD |
| `dashboardChannels` | `string[]` | Channel multi-select; from filterOptions on mount |
| `dashboardSources` | `string[]` | Source multi-select; from filterOptions on mount |
| `dashboardSGMs` | `string[]` | SGM multi-select; defaults to all active (or own name if SGM role) |
| `dashboardMetrics` | `SGMDashboardMetrics \| null` | Scorecard data |
| `dashboardLoading` | `boolean` | Loading flag for scorecards |
| `dashboardError` | `string \| null` | Error message for scorecards |
| `conversionTrend` | `SGMConversionTrend[]` | Quarterly trend chart data |
| `conversionTrendLoading` | `boolean` | Loading flag for trend chart |
| `quarterCount` | `number` | Quarters to show in trend; default 4 |
| `pipelineByStage` | `OpenPipelineByStage[]` | Pipeline bar chart data |
| `pipelineLoading` | `boolean` | Loading for pipeline chart |
| `pipelineStages` | `string[]` | Stage filter for pipeline chart; default 7 stages |
| `conversionData` | `SgmConversionData[]` | SGM Conversion table data |
| `conversionLoading` | `boolean` | Loading for conversion table |
| `conversionDateRange` | `{ startDate: string; endDate: string } \| null` | Separate date filter for conversion table; default null (all-time) |
| `staleRecords` | `DetailRecord[]` | Pipeline records for stale alerts |
| `staleLoading` | `boolean` | Loading for stale pipeline |
| `volumeDrillDownOpen` | `boolean` | System 1 drilldown modal open state |
| `volumeDrillDownRecords` | `DetailRecord[]` | Records in System 1 modal |
| `volumeDrillDownLoading` | `boolean` | Loading for System 1 modal |
| `volumeDrillDownError` | `string \| null` | Error for System 1 modal |
| `volumeDrillDownTitle` | `string` | Title for System 1 modal |
| `volumeDrillDownMetric` | `'prospect' \| ... \| 'openPipeline' \| null` | Which metric is drilled into |

### Fetch Functions

| Function | API call | Sets |
|---|---|---|
| `fetchDashboardData` | `dashboardApi.getSGMDashboardMetrics` | `dashboardMetrics` |
| `fetchConversionTrend` | `dashboardApi.getSGMConversionTrend` | `conversionTrend` |
| `fetchPipelineByStage` | `dashboardApi.getPipelineSummary` | `pipelineByStage` |
| `fetchConversionTable` | `dashboardApi.getSGMConversions` | `conversionData` |
| `fetchStaleRecords` | `dashboardApi.getPipelineDrilldown` per stage | `staleRecords` |

### useEffect Triggers

- **Primary** (`[activeTab, dashboardDateRange, dashboardChannels, dashboardSources, dashboardSGMs]`): fires all 5 fetches; guard: `activeTab !== 'dashboard' || dashboardChannels.length === 0`
- **Quarter count** (`[quarterCount]`): fires `fetchConversionTrend`; same guard
- **Conversion table date** (`[conversionDateRange]`): fires `fetchConversionTable`; guard: `activeTab !== 'dashboard'`
- **Pipeline stages** (`[pipelineStages]`): fires `fetchPipelineByStage`; guard: `activeTab !== 'dashboard'`

### effectiveSgmFilter

```ts
const activeSgmNames = sgmOptions.filter(s => s.isActive).map(s => s.value);
const isDefaultSgmFilter = dashboardSGMs.length === activeSgmNames.length &&
  activeSgmNames.every(s => dashboardSGMs.includes(s));
const effectiveSgmFilter = isDefaultSgmFilter ? undefined : (dashboardSGMs.length > 0 ? dashboardSGMs : undefined);
```

When "All Active SGMs" is selected (default), `effectiveSgmFilter` is `undefined` — no SGM WHERE clause — so records owned by inactive/departed SGMs are included in aggregates. When user narrows, the explicit array is passed.

---

## 2. Phase 2 Types in src/types/sgm-hub.ts

### `SGMDashboardFilters` (line 51)
- `startDate: string` (YYYY-MM-DD)
- `endDate: string` (YYYY-MM-DD)
- `channels: string[]` (required, non-empty)
- `sources?: string[]`
- `sgmNames?: string[]`

### `SGMDashboardMetrics` (line 62)
- `sqls`, `sqos`, `signed`, `signedAum`, `joined`, `joinedAum`, `openPipelineAum`: `number`
- `actualArr`, `arrCoverageCount`, `estimatedArr`, `estimatedArrCount`: `number`

### `SGMConversionTrend` (line 81)
- `quarter: string` ("2025-Q1" format)
- `sqlCount`, `sqoCount`, `joinedCount`: `number`
- `sqlToSqoRate`, `sqoToJoinedRate`: `number`
- `sqlToSqoNumer`, `sqlToSqoDenom`, `sqoToJoinedNumer`, `sqoToJoinedDenom`: `number`

### Also modified: `SgmConversionData` in `src/types/dashboard.ts`
- Added `avgDaysSqoToJoined?: number`

---

## 3. Drilldown Approach — System 1 vs System 2

Two entirely separate state groups sharing one `RecordDetailModal`.

### System 2 — MetricDrillDownModal (Leaderboard tab)
- State: `drillDownOpen`, `drillDownMetricType`, `drillDownRecords`, `drillDownLoading`, `drillDownError`, `drillDownTitle`, `drillDownContext`
- Handlers: `handleJoinedClick`, `handleAumClick`, `handleRecordClick`, `handleBackToDrillDown`, `handleCloseDrillDown`

### System 1 — VolumeDrillDownModal (Dashboard tab)
- State: `volumeDrillDownOpen`, `volumeDrillDownRecords`, `volumeDrillDownLoading`, `volumeDrillDownError`, `volumeDrillDownTitle`, `volumeDrillDownMetric`
- Handlers: `handleDashboardMetricClick`, `handlePipelineBarClick`, `handleConversionMetricClick`, `handleVolumeDrillDownRecordClick`, `handleCloseVolumeDrillDown`, `handleStaleStageClick`

Both close their modal and open `RecordDetailModal` on record row click.

---

## 4. New Query Functions

### New file: `src/lib/queries/sgm-dashboard.ts`

| Export | Returns | Purpose |
|---|---|---|
| `getSgmDashboardMetrics` | `SGMDashboardMetrics` | Scorecard metrics (cohort-based per-metric date anchoring) |
| `getSgmConversionCohortData` | `SgmConversionData[]` | Conversion table (cohort-based: SQL→SQO on SQL date, SQO→Joined on SQO date, Joined on join date) |
| `getSgmConversionTrend` | `SGMConversionTrend[]` | Quarterly trend (rates cohort-based, volumes event-based) |

### Modified: `src/lib/queries/open-pipeline.ts`
- `_getSgmConversionData`: added `avg_days_sqo_to_joined` SQL column → `avgDaysSqoToJoined` TypeScript field

---

## 5. New API Routes (Phase 2)

| Route | Method | Query Function |
|---|---|---|
| `/api/sgm-hub/dashboard-metrics` | POST | `getSgmDashboardMetrics` |
| `/api/sgm-hub/conversion-trend` | POST | `getSgmConversionTrend` |
| `/api/sgm-hub/conversions` | POST | `getSgmConversionCohortData` |

Pre-existing Phase 1 routes: `leaderboard`, `sgm-options`, `drill-down/joined`

---

## 6. SGM Conversion Table Velocity Column

Yes. SQL alias: `avg_days_sqo_to_joined`. TypeScript field: `avgDaysSqoToJoined` (`number | undefined`). Calculated as:

```sql
ROUND(AVG(CASE WHEN v.is_joined_unique = 1
  AND v.Stage_Entered_Joined__c IS NOT NULL
  AND v.Date_Became_SQO__c IS NOT NULL
THEN DATE_DIFF(DATE(v.Stage_Entered_Joined__c), DATE(v.Date_Became_SQO__c), DAY) END), 1)
```

Present in both `open-pipeline.ts` (`_getSgmConversionData`) and `sgm-dashboard.ts` (`_getSgmConversionCohortData`).

---

## 7. Forecasting / Editable Table Patterns

### No Forecast UI Components
No `.tsx` components with "Forecast" in the name exist. Forecast models exist only at DB layer.

### Prisma Models
- `Forecast` — per quarter; has `status` (enum), `notes`, `createdBy`, `updatedBy`, `createdAt`, `updatedAt`
- `ForecastAssumption` — per channel/subSource/month/key
- `ForecastLineItem` — per channel/subSource/month/stage; `calculatedVolume`, `finalVolume`, `isLocked`
- `ForecastOverride` — stores original vs override value and reason
- `ForecastRateItem` — per channel/subSource/month/transition; `calculatedRate`, `finalRate`, `isLocked`
- `ForecastSource` — per forecastId/subSource; `isActive`, `isManual`, `sortOrder`
- `ForecastTarget` — per channel/month/stage; `minimumForecast`, `financeMinimum`, `gapFillerAllocation`
- `SGMQuarterlyGoal` — `userEmail`, `quarter`, `arrGoal: Float`; unique on `[userEmail, quarter]`

### Goal/Quota Prisma Models
- `WeeklyGoal` — per userEmail/weekStartDate; 7 goal fields
- `QuarterlyGoal` — per userEmail/quarter; `sqoGoal`
- `ManagerQuarterlyGoal` — per quarter; team-level `sqoGoal`
- `SGMQuarterlyGoal` — per userEmail/quarter; `arrGoal: Float`

### Editable Cell Save Pattern
- **Inline on-blur / on-Enter** — no debounce
- `MetricScorecard.tsx`: local `editing` + `draft` state. `submitGoal()` fires on Enter or blur
- `WeeklyGoalsVsActuals.tsx`: `handleGoalChange(weekStartDate, field, value)` calls `dashboardApi.saveWeeklyGoal(goalInput, userEmail)` with `savingGoal = true` flag
- Weekly goals: `PUT /api/sga-hub/weekly-goals` → `prisma.weeklyGoal.upsert`
- Quarterly goals: `POST /api/sga-hub/quarterly-goals` → `prisma.quarterlyGoal.upsert`

---

## 8. SGA Hub Pacing Calculation

### Location
Utility function: `calculateQuarterPacing` in `src/lib/utils/sga-hub-helpers.ts` (line 139)

### Formula
```
daysInQuarter = ceil((endDate - startDate) / msPerDay) + 1
daysElapsed = clamp(0, daysInQuarter, ceil((today - startDate) / msPerDay) + 1)
expectedSqos = round((goal / daysInQuarter) * daysElapsed, 1)   // linear prorated
pacingDiff = actual - expectedSqos
pacingStatus = pacingDiff >= 0.5 → 'ahead' | >= -0.5 → 'on-track' | else → 'behind'
progressPercent = round((actual / goal) * 100)
```

±0.5 SQO tolerance band defines "on-track".

### UI Component: `QuarterlyProgressCard.tsx`
- **No gauge or ring**
- Text badge (Tremor `Badge`) with pacing label + icon (TrendingUp/TrendingDown/Minus)
- Progress bar (`<div>` with width%): green ≥100%, blue ≥75%, yellow ≥50%, red <50%
- Text stats grid below (AUM, days elapsed/remaining, expected vs actual SQOs)

### Callers
- `GET /api/sga-hub/quarterly-progress/route.ts` (line 73) — server-side
- `GET /api/admin/sga-overview/route.ts` (line 113) — server-side
- `TeamProgressCard.tsx` has its own inline `calculatePacingStatus` (lines 40–78) for admin aggregate view
