# Pattern Finder Findings: SGM Hub Dashboard Tab (Phase 2)

Generated: 2026-03-22  |  Investigator: pattern-finder agent (read-only)

---

## Pattern 1: Funnel Performance Scorecard Flow (End-to-End)

### Entry Point
/src/app/dashboard/page.tsx is both the Next.js page and content component (no separate Content file).

### Filter State Architecture
Two-state model: pending filters (user editing) vs applied filters (triggers fetch).

    const [filters, setFilters] = useState(DEFAULT_FILTERS);
    const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);

DEFAULT_FILTERS: QTD date range, all channels, all sources, metricFilter: all.

### Filter Apply Flow
1. User edits via GlobalFilters or AdvancedFilters slide-out.
2. Both call onFiltersChange -> setFilters (pending state, no fetch).
3. Apply button -> handleApplyFilters() -> setAppliedFilters(filters)
   only if !filtersAreEqual(filters, appliedFilters).
4. useEffect([fetchDashboardData, filterOptions]) fires when appliedFilters changes.
5. Guard: if (filterOptions) { fetchDashboardData(); }

### Fetch Architecture
fetchDashboardData is a useCallback using Promise.all with conditional pushes:

    const fetchDashboardData = useCallback(async () => {
      const promises = [];
      if (featureSelection.showFunnelMetrics) promises.push(fetchFunnelMetrics());
      if (featureSelection.showSgmConversions) promises.push(fetchSgmConversions());
      // ... more per feature flag
      await Promise.all(promises);
    }, [appliedFilters, featureSelection]);

### State Update -> Scorecards Props
fetchFunnelMetrics() -> GET /api/dashboard/funnel-metrics
-> setFunnelMetrics(data.metrics) // FunnelMetricsWithGoals
-> Scorecards metrics={funnelMetrics} onMetricClick={handleMetricClick}

Scorecards props interface (Scorecards.tsx):
  metrics: FunnelMetricsWithGoals
  onMetricClick?: (metric: string) => void
  visibleMetrics: { [key: string]: boolean }
  showSignedAum?: boolean
  showJoinedAum?: boolean

Grid: grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6
Signed+SignedAum and Joined+JoinedAum stacked in flex flex-col gap-4 within one cell.

### Click -> Drilldown Flow
User clicks scorecard -> onMetricClick(key) -> handleMetricClick(metric)
-> setVolumeDrillDownMetric + setVolumeDrillDownOpen(true) + setVolumeDrillDownLoading(true)
-> dashboardApi.getVolumeDrillDown(metric, appliedFilters)
-> GET /api/dashboard/drill-down?metric=joined&...
-> setVolumeDrillDownRecords(data.records)
-> VolumeDrillDownModal renders

### Drilldown State (6 vars)
    volumeDrillDownOpen: boolean
    volumeDrillDownRecords: DetailRecord[]
    volumeDrillDownLoading: boolean
    volumeDrillDownError: string | null
    volumeDrillDownTitle: string
    volumeDrillDownMetric: MetricKey | null

### Key Files
- /src/app/dashboard/page.tsx
- /src/components/dashboard/Scorecards.tsx
- /src/components/dashboard/GlobalFilters.tsx
- /src/components/dashboard/AdvancedFilters.tsx
- /src/components/dashboard/VolumeDrillDownModal.tsx
- /src/app/api/dashboard/funnel-metrics/route.ts
---

## Pattern 2: getSgmConversionData Query Pattern

### Entry Point
/src/lib/queries/open-pipeline.ts, function getSgmConversionData (~lines 764-847).

### SQL (simplified)
  SELECT
    v.SGM_Owner_Name__c as sgm,
    COUNT(CASE WHEN v.is_sql=1 AND v.is_primary_opp_record=1 THEN 1 END) as sqls_received,
    SUM(v.sql_to_sqo_progression) as sql_to_sqo_numer,
    SUM(v.eligible_for_sql_conversions) as sql_to_sqo_denom,
    SUM(v.is_sqo_unique) as sqos_count,
    SUM(v.is_joined_unique) as sqo_to_joined_numer,
    SUM(v.is_joined_unique) + COUNTIF(v.StageName=Closed Lost AND v.is_sqo_unique=1)
      as sqo_to_joined_denom,
    SUM(v.is_joined_unique) as joined_count
  FROM vw_funnel_master v
  INNER JOIN SavvyGTMData.User u ON v.SGM_Owner_Name__c=u.Name
    AND u.Is_SGM__c=TRUE AND u.IsActive=TRUE
  WHERE v.converted_date_raw BETWEEN @startDate AND @endDate
  GROUP BY v.SGM_Owner_Name__c
  ORDER BY sqls_received DESC

### DATE ANCHOR INCONSISTENCY FLAGGED
Filters on converted_date_raw (SQL creation / Salesforce converted date),
NOT the SQO date or joined date. The leaderboard query uses different anchors per metric.
New Dashboard tab queries must explicitly document which date field they anchor on.

### Rate Calculation: JS-Side Only
    const safeDiv = (n, d) => d === 0 ? 0 : n / d;
    sql_to_sqo_rate: safeDiv(row.sql_to_sqo_numer, row.sql_to_sqo_denom),
    sqo_to_joined_rate: safeDiv(row.sqo_to_joined_numer, row.sqo_to_joined_denom),

### AVG Velocity Column
No AVG velocity column exists in getSgmConversionData as of 2026-03-22.
Pattern if adding: AVG(CASE WHEN cond THEN TIMESTAMP_DIFF(end_ts, start_ts, DAY) END) as avg_days

### Type Coercion Pattern
    import { toNumber, toString } from @/types/bigquery-raw;
    sqls_received: toNumber(row.sqls_received),
    sgm: toString(row.sgm),

### Caching
    return cachedQuery(
      async () => { /* BigQuery call */ },
      CACHE_TAGS.DASHBOARD,
      { revalidate: 300 }
    );

### extractDate() vs extractDateValue() -- DRIFT FLAGGED
open-pipeline.ts defines a LOCAL inline extractDate() helper (not importing shared extractDateValue()).
Other query files use the shared extractDateValue() utility.
When adding date fields to open-pipeline.ts, use the existing local extractDate().
Do NOT introduce extractDateValue() into that file without migrating all existing calls.

Local helper definition:
    const extractDate = (val) => {
      if (val && typeof val === object && value in val) return String(val.value);
      return String(val ?? );
    };

### Key Files
- /src/lib/queries/open-pipeline.ts
- /src/types/bigquery-raw.ts
- /src/app/api/dashboard/sgm-conversions/route.ts
- /src/app/dashboard/pipeline/page.tsx
---

## Pattern 3: Component Composition (JSX Layout)

### Page-Level Layout Wrapper
    <div className="w-full max-w-full overflow-x-hidden">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1"><GlobalFilters ... /></div>
        <AdvancedFiltersButton ... />
      </div>
      {/* content sections */}
    </div>

### Section Header Pattern
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Section Title
      </h2>
      <div className="flex items-center gap-2">{/* action buttons */}</div>
    </div>

### Card Wrapper Pattern
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      {/* card content */}
    </div>

### Dynamic Import for Charts/Tables (ssr: false with skeleton fallback)
    import nextDynamic from next/dynamic;

    const MyChart = nextDynamic(
      () => import(@/components/MyChart).then(m => ({ default: m.MyChart })),
      {
        ssr: false,
        loading: () => <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" />
      }
    );

### Key Files
- /src/app/dashboard/page.tsx -- page-level layout reference
- /src/app/dashboard/pipeline/page.tsx -- section header + dynamic import pattern
- /src/components/dashboard/Scorecards.tsx -- scorecard grid

---

## Pattern 4: PipelineByStageChart and StalePipelineAlerts Embedding

Both components are props-based (no self-fetching). Parent owns all data and handlers.

### PipelineByStageChart Props Interface
    interface PipelineByStageChartProps {
      data: OpenPipelineByStage[];  // parent fetches and passes down
      onBarClick: (stage: string, metric: aum | count) => void;
      loading?: boolean;
    }

Embedding pattern in pipeline/page.tsx:
    <div id=pipeline-by-stage-chart>  // id attr used for PNG export
      <PipelineByStageChart data={pipelineByStage} onBarClick={handleBarClick}
        loading={loadingStates.pipelineByStage} />
    </div>

### StalePipelineAlerts Props Interface
    interface StalePipelineAlertsProps {
      records: DetailRecord[];
      loading: boolean;
      onStageClick: (stage: string, records: DetailRecord[]) => void;
      onRecordClick: (recordId: string) => void;
    }

Groups records by stage client-side via useMemo.
Returns null when empty and not loading (no empty state UI rendered).

Embedding pattern:
    {activeTab === byStage && (
      <StalePipelineAlerts records={staleRecords} loading={loadingStates.staleRecords}
        onStageClick={handleStageAlertClick} onRecordClick={handleRecordDetailOpen} />
    )}

### Tab-Gated Pattern
Both rendering AND data fetching are gated on active tab.
For SGM Hub Dashboard tab: only fetch/render when activeTab === dashboard.

### Key Files
- /src/components/dashboard/PipelineByStageChart.tsx
- /src/components/dashboard/StalePipelineAlerts.tsx
- /src/app/dashboard/pipeline/page.tsx -- embedding reference
---

## Pattern 5: Cohort Conversion Pattern

### Quarter String Format (Pattern A)
SQL-side generation:
  CONCAT(CAST(EXTRACT(YEAR FROM date_field) AS STRING), "-Q",
         CAST(EXTRACT(QUARTER FROM date_field) AS STRING)) AS quarter
Output examples: 2025-Q1, 2025-Q2, 2025-Q3, 2025-Q4

### Cohort vs Period Mode (from /src/lib/queries/conversion-rates.ts)
- Period mode: all stage counts anchor on a single date field (e.g., converted_date_raw)
- Cohort mode: each stage uses its own date field:
  - prospect_date for prospect count
  - converted_date for SQL count
  - sqo_date for SQO count
  - joined_date for joined count

### Rate Calculation: JS-Side Only
    const safeDiv = (n, d) => d === 0 ? 0 : n / d;
    // Used in results.map():
    sql_to_sqo_rate: safeDiv(row.sql_to_sqo_numer, row.sql_to_sqo_denom),
    sqo_to_joined_rate: safeDiv(row.sqo_to_joined_numer, row.sqo_to_joined_denom),

### Quarterly Grouping SQL Template
    SELECT
      CONCAT(CAST(EXTRACT(YEAR FROM date_field) AS STRING), "-Q",
             CAST(EXTRACT(QUARTER FROM date_field) AS STRING)) AS quarter,
      COUNT(*) AS count,
      SUM(aum_field) AS total_aum
    FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
    WHERE date_field BETWEEN @startDate AND @endDate
    GROUP BY quarter
    ORDER BY quarter ASC

### JS-Side Quarter Sort
    results.sort((a, b) => a.quarter.localeCompare(b.quarter));
    // Lexicographic sort works: 2024-Q3 < 2024-Q4 < 2025-Q1

### Key Files
- /src/lib/queries/conversion-rates.ts
- /src/lib/queries/open-pipeline.ts

---

## Pattern 6: Recharts Bar Chart (Clickable, Quarterly X-Axis, Drilldown)

### MANDATORY: isAnimationActive={false} on Every Bar
Global fix for D3 selectAll crash (commit bc7ae3c). Omitting causes runtime crash.
Applies to Bar, Line, and Area components.

### Dual Y-Axis Pattern (from PipelineByStageChart.tsx)
Left axis: yAxisId="aum" orientation="left" tickFormatter=formatAumAxis
Right axis: yAxisId="count" orientation="right" tickFormatter=v.toLocaleString()
Each Bar specifies its yAxisId. Both have isAnimationActive={false}.
BarChart margin: top 40 right 80 left 20 bottom 20

### Quarterly X-Axis
XAxis dataKey="quarter" -- no tickFormatter needed, "2025-Q1" is display-ready.
tick fill: isDark ? "#f9fafb" : "#111827", fontSize 13

### Clickable Bar Pattern
Bar cursor="pointer" isAnimationActive={false}
onClick receives the data row object -- access data.quarter or data.stage
Children: Cell per entry for hover effect + LabelList for above-bar labels

### Dark Mode Pattern
    const isDark = useTheme().resolvedTheme === "dark";
    textColor: isDark ? "#9CA3AF" : "#6B7280"
    gridColor: isDark ? "#4B5563" : "#D1D5DB"
    labelColor: isDark ? "#f9fafb" : "#111827"

### Height Conventions
- Full-page chart (PipelineByStageChart pattern): h-[75vh] min-h-[600px]
- Dashboard-tab card-embedded charts: h-[400px] or h-[350px]

### Loading Skeleton
Wrapper div: h-[400px] flex items-center justify-center
Inner: animate-pulse text-gray-400, text "Loading chart..."

### CustomTooltip Pattern
Guard: if (!active || !payload || payload.length === 0) return null
Wrapper: bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4
Label: font-semibold text-base text-gray-900 dark:text-white mb-2
Each entry row: color dot + name + formatted value
Used via: Tooltip content={CustomTooltip component}

### Key Files
- /src/components/dashboard/PipelineByStageChart.tsx -- full reference implementation
- /src/app/dashboard/pipeline/page.tsx -- embedding + bar click handler
---

## Pattern 7: Filter Architecture Comparison

### System A: Funnel Performance (page.tsx) -- Two-State + Apply Button

  filters (pending state)  <-- user edits GlobalFilters or AdvancedFilters
       |
       | handleApplyFilters() -- gated by !filtersAreEqual()
       v
  appliedFilters  <-- change fires useEffect -> fetchDashboardData()

Key characteristics:
- GlobalFilters: date picker + channel/source checkboxes inline in filter bar
- AdvancedFilters: slide-out panel, fixed inset-0 z-50, absolute right-0 top-0 h-full w-96
- filtersAreEqual() helper prevents unnecessary re-fetches
- Filter options from /api/dashboard/filter-options gate ALL data fetches
- Default: QTD date range, all channels, all sources, metricFilter: all

### System B: SGM Hub Leaderboard (SGMHubContent.tsx) -- Immediate-Apply

  leaderboardQuarter / leaderboardChannels / leaderboardSources / leaderboardSGMs
       |
       | handleFilterApply({quarter, channels, sources, sgms})
       | calls setLeaderboard*() state setters directly
       v
  useEffect([activeTab, leaderboardQuarter, leaderboardChannels, leaderboardSources, leaderboardSGMs])
       -> fetchLeaderboard()

Key characteristics:
- No pending/applied split -- filter state IS applied state
- SGM-specific filter: leaderboardSGMs array populated from /api/sgm-hub/sgm-options
- SGMLeaderboardFilters component encapsulates all filter controls
- Guard: if (leaderboardChannels.length === 0) return; -- waits for options to load
- Default: current quarter, all channels, all sources, all active SGMs

### Recommendation for SGM Hub Dashboard Tab
Follow System B. SGMHubContent.tsx already uses it for the leaderboard.
The Dashboard tab can share existing state vars:
  leaderboardQuarter, leaderboardChannels, leaderboardSources, leaderboardSGMs.
No new filter state needed if Dashboard tab reads from the same filters.

### AdvancedFilters: No Actual Slide Animation
Despite CSS class names (transform, transition-transform), there is no slide animation.
Implementation: if (!isOpen) return null -- instant open/close via early return.
No conditional translate-x class is toggled. The slide effect is missing entirely.

### Key Files
- /src/app/dashboard/page.tsx -- System A reference
- /src/app/dashboard/sgm-hub/SGMHubContent.tsx -- System B reference
- /src/components/dashboard/AdvancedFilters.tsx -- slide-out panel (no real animation)
- /src/components/sgm-hub/SGMLeaderboardFilters.tsx -- System B filter component
---

## Pattern 8: Drilldown Modal Systems Comparison

### System 1: VolumeDrillDownModal
File: /src/components/dashboard/VolumeDrillDownModal.tsx

Props interface:
    isOpen: boolean
    onClose: () => void
    records: DetailRecord[]          -- generic record type
    title: string
    loading: boolean
    error: string | null
    onRecordClick: (primaryKey: string) => void
    metricFilter: MetricKey | null    -- affects column visibility in DetailRecordsTable
    canExport: boolean

Characteristics:
- max-w-7xl max-h-[90vh]
- ESC key handler via useEffect (System 2 does NOT have this)
- bg-black/50 backdrop-blur-sm backdrop
- Body scroll lock when open
- Renders DetailRecordsTable internally, column config driven by metricFilter

### System 2: MetricDrillDownModal
File: /src/components/sga-hub/MetricDrillDownModal.tsx

Props interface:
    isOpen: boolean
    onClose: () => void
    metricType: MetricType            -- selects column config from COLUMN_CONFIGS dict
    records: DrillDownRecord[]        -- discriminated union, specialized per metricType
    title: string
    loading: boolean
    error: string | null
    onRecordClick: (primaryKey: string) => void
    canExport: boolean
    // No metricFilter prop -- metricType IS the config selector

Characteristics:
- max-w-5xl max-h-[85vh]
- 5 skeleton rows when loading (not a spinner)
- No ESC key handler
- ExportButton with explicit exportData useMemo per metricType
- Row key: record.primaryKey
- COLUMN_CONFIGS: Record where MetricType maps to ColumnConfig[] array

### SGM Hub Must Use System 2
SGMHubContent.tsx already imports MetricDrillDownModal for leaderboard drilldowns.
All SGM Hub Dashboard tab drilldowns must use MetricDrillDownModal (System 2).

### DrillDownRecord Type
File: /src/types/drill-down.ts

    type MetricType = "joined" | "sqo" | "pipeline" | "sql" | ...;

    type DrillDownRecord =
      | JoinedDrillDownRecord
      | SqoDrillDownRecord
      | PipelineDrillDownRecord
      | ...;

    interface JoinedDrillDownRecord {
      primaryKey: string;       // REQUIRED -- React key + RecordDetailModal navigation
      advisorName: string;
      joinedDate: string;
      aum: number | null;       // nullable display field
      sgaName: string;
      sgmName: string | null;   // nullable -- not all records have an SGM
    }

### CRITICAL: primaryKey is Required on Every DrillDownRecord
From CLAUDE.md: every code path constructing a DetailRecord or DrillDownRecord must
include ALL required fields. Missing even one causes build failure.
primaryKey is always required. Never omit it from any record construction.

### DrillDownContext
    interface DrillDownContext {
      metricType: MetricType;
      title: string;
      sgaName: string | null;
      sgmName: string | null;  // nullable -- set when drilling from an SGM row
      quarter: string;
    }

Used by SGMHubContent.tsx to restore drilldown when returning from RecordDetailModal.
Set to null in handleCloseRecordDetail to prevent back-navigation after full close.

### Key Files
- /src/components/dashboard/VolumeDrillDownModal.tsx -- System 1 (Funnel page only)
- /src/components/sga-hub/MetricDrillDownModal.tsx -- System 2 (all SGM Hub modals)
- /src/types/drill-down.ts -- DrillDownRecord, MetricType, DrillDownContext types
- /src/app/dashboard/sgm-hub/SGMHubContent.tsx -- System 2 usage reference
---

## Cross-Cutting Findings: Inconsistencies and Drift

### 1. Date Helper Drift: extractDate() vs extractDateValue()
open-pipeline.ts defines a LOCAL inline extractDate() helper.
Other query files import extractDateValue() from a shared utility module.
The local version is a duplication of shared logic.
Within open-pipeline.ts: always use the local extractDate() to stay consistent.
Do NOT introduce extractDateValue() into that file without migrating all existing calls.

### 2. Date Anchor Inconsistency in getSgmConversionData
getSgmConversionData filters on converted_date_raw (SQL creation / Salesforce converted date),
not the SQO date or joined date.
The leaderboard query uses different date anchors per metric.
New Dashboard tab queries must explicitly document which date field they anchor on.

### 3. Two Filter Systems (Intentionally Different)
page.tsx (Funnel Performance): two-state pending/applied with filtersAreEqual() guard.
SGMHubContent.tsx (SGM Hub): direct-apply single-state.
These serve different UX needs. Not a bug.
SGM Hub Dashboard tab must follow SGMHubContent.tsx (System B).

### 4. Modal Size Inconsistency
System 1 VolumeDrillDownModal: max-w-7xl max-h-[90vh]
System 2 MetricDrillDownModal: max-w-5xl max-h-[85vh]
Use System 2 sizes for all new SGM Hub modals.

### 5. ESC Key: Only in System 1
VolumeDrillDownModal handles ESC key via useEffect. MetricDrillDownModal does not.
Feature gap in System 2. Not a bug, but worth noting for future UX improvement.

### 6. isAnimationActive={false} -- Global Mandate
All Recharts Bar/Line/Area components must have this prop.
Global fix for D3 selectAll crash (commit bc7ae3c).
Any new chart omitting it will crash at runtime.

### 7. Type Coercion Convention
Always use toNumber() / toString() from @/types/bigquery-raw.ts for BigQuery results.
Never use Number(), parseInt(), parseFloat(), or direct .value access on BQ objects.

### 8. NULL Handling Convention
- toNumber() returns 0 for null -- safe for arithmetic on required numeric fields
- toString() returns empty string for null
- Nullable display fields (e.g., aum on a record): typed as number | null
  and the JS layer handles null before rendering
- Required identity fields (primaryKey, sgm name on conversion row):
  typed as non-nullable string even if BigQuery could theoretically return null

### 9. cachedQuery Wrapper is Mandatory
Every BigQuery query function wraps its call in cachedQuery(..., CACHE_TAGS.DASHBOARD).
Standard revalidation: { revalidate: 300 } (5 minutes).
Never call the BigQuery client directly from an API route.
Always go through a query function in src/lib/queries/.

---

## Quick Reference: Key File Paths

| Role | Path |
|------|------|
| Funnel Performance page | /src/app/dashboard/page.tsx |
| Pipeline page | /src/app/dashboard/pipeline/page.tsx |
| SGM Hub content | /src/app/dashboard/sgm-hub/SGMHubContent.tsx |
| Scorecards | /src/components/dashboard/Scorecards.tsx |
| GlobalFilters | /src/components/dashboard/GlobalFilters.tsx |
| AdvancedFilters | /src/components/dashboard/AdvancedFilters.tsx |
| System 1 modal | /src/components/dashboard/VolumeDrillDownModal.tsx |
| System 2 modal | /src/components/sga-hub/MetricDrillDownModal.tsx |
| PipelineByStageChart | /src/components/dashboard/PipelineByStageChart.tsx |
| StalePipelineAlerts | /src/components/dashboard/StalePipelineAlerts.tsx |
| SGM conversion query | /src/lib/queries/open-pipeline.ts |
| Conversion rates query | /src/lib/queries/conversion-rates.ts |
| BigQuery coercion utils | /src/types/bigquery-raw.ts |
| Drilldown types | /src/types/drill-down.ts |
| API client | /src/lib/api-client.ts |
| Leaderboard filters | /src/components/sgm-hub/SGMLeaderboardFilters.tsx |
