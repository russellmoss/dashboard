# Custom Reporting Feature - Codebase Questions - ANSWERS

## Section 1: Dashboard Page Structure

### 1.1 Main Dashboard Component

**1. What is the exact file path and component name for the main Funnel Performance dashboard page?**
- **File Path**: `src/app/dashboard/page.tsx`
- **Component Name**: `DashboardPage` (default export)

**2. Complete list of child components rendered on this page, in order of appearance:**

```typescript
// Import paths from src/app/dashboard/page.tsx:
import { GlobalFilters } from '@/components/dashboard/GlobalFilters';
import { Scorecards } from '@/components/dashboard/Scorecards';
import { ConversionRateCards } from '@/components/dashboard/ConversionRateCards';
import { ConversionTrendChart } from '@/components/dashboard/ConversionTrendChart';
import { VolumeTrendChart } from '@/components/dashboard/VolumeTrendChart';
import { ChannelPerformanceTable } from '@/components/dashboard/ChannelPerformanceTable';
import { SourcePerformanceTable } from '@/components/dashboard/SourcePerformanceTable';
import { DetailRecordsTable } from '@/components/dashboard/DetailRecordsTable';
import { ExportToSheetsButton } from '@/components/dashboard/ExportToSheetsButton';
import { AdvancedFilters, AdvancedFiltersButton } from '@/components/dashboard/AdvancedFilters';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ChartErrorBoundary, TableErrorBoundary, CardErrorBoundary, FilterErrorBoundary } from '@/components/ui';
import { ViewModeToggle } from '@/components/dashboard/ViewModeToggle';
import { FullFunnelScorecards } from '@/components/dashboard/FullFunnelScorecards';
import { VolumeDrillDownModal } from '@/components/dashboard/VolumeDrillDownModal';
```

**3. Dashboard page JSX structure:**

```tsx
<div className="w-full max-w-full overflow-x-hidden">
  {/* Header Section */}
  <div className="mb-6">
    <div className="flex justify-between items-center mb-4">
      <div>
        <Title>Funnel Performance & Efficiency</Title>
        <Text>Track volume, conversion rates, and pipeline health</Text>
      </div>
      <ViewModeToggle value={viewMode} onChange={handleViewModeChange} />
    </div>
  </div>
  
  {/* Global Filters */}
  <FilterErrorBoundary>
    <GlobalFilters ... />
    <AdvancedFiltersButton ... />
  </FilterErrorBoundary>

  {/* Export Button */}
  <ExportToSheetsButton ... />

  {/* Loading State */}
  {loading ? <LoadingSpinner /> : (
    <>
      {/* Full Funnel Scorecards (conditional on viewMode === 'fullFunnel') */}
      {viewMode === 'fullFunnel' && metrics && (
        <CardErrorBoundary>
          <FullFunnelScorecards ... />
        </CardErrorBoundary>
      )}

      {/* Volume Scorecards (always shown) */}
      {metrics && (
        <CardErrorBoundary>
          <Scorecards ... />
        </CardErrorBoundary>
      )}
      
      {/* Conversion Rate Cards */}
      {conversionRates && (
        <CardErrorBoundary>
          <ConversionRateCards ... />
        </CardErrorBoundary>
      )}
      
      {/* Conversion Trends Chart */}
      <ChartErrorBoundary>
        <ConversionTrendChart ... />
      </ChartErrorBoundary>
      
      {/* Volume Trends Chart */}
      <ChartErrorBoundary>
        <VolumeTrendChart ... />
      </ChartErrorBoundary>
      
      {/* Channel Performance Table */}
      <TableErrorBoundary>
        <ChannelPerformanceTable ... />
      </TableErrorBoundary>
      
      {/* Source Performance Table */}
      <TableErrorBoundary>
        <SourcePerformanceTable ... />
      </TableErrorBoundary>
      
      {/* Detail Records Table */}
      <TableErrorBoundary>
        <DetailRecordsTable ... />
      </TableErrorBoundary>
    </>
  )}
  
  {/* Modals */}
  <AdvancedFilters ... />
  <VolumeDrillDownModal ... />
  <RecordDetailModal ... />
</div>
```

**4. View Mode Implementation:**
- **Available View Modes**: `'focused' | 'fullFunnel'` (defined in `src/types/dashboard.ts`)
- **State Management**: `const [viewMode, setViewMode] = useState<ViewMode>('focused')` in `src/app/dashboard/page.tsx`
- **Toggle Component**: `ViewModeToggle` at `src/components/dashboard/ViewModeToggle.tsx`
- **How it affects components**:
  - `FullFunnelScorecards` only shown when `viewMode === 'fullFunnel'`
  - `ChannelPerformanceTable` and `SourcePerformanceTable` show additional columns in fullFunnel mode
  - `DetailRecordsTable` shows additional badges in fullFunnel mode

---

## Section 2: Scorecards Implementation

### 2.1 Volume Scorecards (SQLs, SQOs, Signed, Joined, Open Pipeline)

**1. Component file path**: `src/components/dashboard/Scorecards.tsx`

**2. Props interface:**
```typescript
interface ScorecardsProps {
  metrics: FunnelMetricsWithGoals;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
}
```

**3. Data fetching**: 
- API endpoint: `/api/dashboard/funnel-metrics` (POST)
- Called via: `dashboardApi.getFunnelMetrics(filters, viewMode)`
- Returns: `FunnelMetricsWithGoals` type

**4. Component structure**: 
- All 5 volume scorecards (SQLs, SQOs, Signed, Joined, Open Pipeline) are rendered by a single `Scorecards` component
- Each card is rendered conditionally based on the `metrics` prop
- Cards are laid out in a grid: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`

**5. Conditional rendering**: 
- Cards are always shown if `metrics` exists
- No props control individual card visibility currently
- Each card has an `onClick` handler that calls `onMetricClick` with the metric ID ('sql', 'sqo', 'signed', 'joined', 'openPipeline')

### 2.2 Full Funnel Scorecards (Prospects, Contacted, MQLs)

**1. Component file path**: `src/components/dashboard/FullFunnelScorecards.tsx`

**2. Separate component**: Yes, separate from volume scorecards

**3. Conditional logic**:
```tsx
{viewMode === 'fullFunnel' && metrics && (
  <CardErrorBoundary>
    <FullFunnelScorecards
      metrics={metrics}
      selectedMetric={selectedMetric}
      onMetricClick={handleMetricClick}
      loading={loading}
    />
  </CardErrorBoundary>
)}
```

**4. Props interface:**
```typescript
interface FullFunnelScorecardsProps {
  metrics: FunnelMetricsWithGoals | null;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
  loading?: boolean;
}
```

### 2.3 Conversion Rate Cards

**1. Component file path**: `src/components/dashboard/ConversionRateCards.tsx`

**2. Props interface:**
```typescript
interface ConversionRateCardsProps {
  conversionRates: ConversionRatesResponse;
  previousRates?: ConversionRatesResponse;
  isLoading?: boolean;
}
```

**3. All 4 cards rendered together**: Yes, all 4 conversion rate cards (Contacted→MQL, MQL→SQL, SQL→SQO, SQO→Joined) are rendered together in a single component using a `Grid` layout

**4. Data calculation**: 
- Pre-calculated by the API endpoint `/api/dashboard/conversion-rates`
- Returns `ConversionRatesResponse` with rates already calculated
- Rates are calculated server-side based on mode ('period' or 'cohort')

---

## Section 3: Charts Implementation

### 3.1 Conversion Trends Chart

**1. File path**: `src/components/dashboard/ConversionTrendChart.tsx`

**2. Props interface:**
```typescript
interface ConversionTrendChartProps {
  trends: TrendDataPoint[];
  onGranularityChange?: (granularity: 'month' | 'quarter') => void;
  granularity?: 'month' | 'quarter';
  mode?: ConversionTrendMode;
  onModeChange?: (mode: ConversionTrendMode) => void;
  isLoading?: boolean;
}
```

**3. Charting library**: Recharts (`recharts`)

**4. Cohort vs Period toggle:**
- State managed in parent (`src/app/dashboard/page.tsx`): `const [trendMode, setTrendMode] = useState<ConversionTrendMode>('cohort')`
- State variable name: `trendMode`
- Toggle UI is inside the `ConversionTrendChart` component itself
- When mode changes, `onModeChange` callback triggers `fetchDashboardData()` in parent
- Mode affects data calculation: cohort mode tracks leads from each period through the funnel, period mode shows what completed within each period

**5. Monthly/Quarterly granularity:**
- State managed in parent: `const [trendGranularity, setTrendGranularity] = useState<'month' | 'quarter'>('quarter')`
- Toggle UI is inside the `ConversionTrendChart` component
- When granularity changes, `onGranularityChange` callback updates state, which triggers `fetchDashboardData()`

**6. API endpoint**: `/api/dashboard/conversion-rates` (POST) with `includeTrends: true` and `granularity` and `mode` parameters

**7. Click/drill-down functionality**: No, this chart does not have click functionality

### 3.2 Volume Trends Chart

**1. File path**: `src/components/dashboard/VolumeTrendChart.tsx`

**2. Props interface:**
```typescript
interface VolumeTrendChartProps {
  trends: TrendDataPoint[];
  onGranularityChange?: (granularity: 'month' | 'quarter') => void;
  granularity?: 'month' | 'quarter';
  isLoading?: boolean;
  onBarClick?: (metric: 'sql' | 'sqo' | 'joined', period: string) => void;
}
```

**3. Clickable bars implementation:**
```typescript
// In VolumeTrendChart component:
onClick={onBarClick ? (data: any, index: number, e: any) => {
  const period = data?.period;
  const metricMap: Record<string, 'sql' | 'sqo' | 'joined'> = {
    'SQLs': 'sql',
    'SQOs': 'sqo',
    'Joined': 'joined',
  };
  const metric = metricMap[cat];
  if (metric && period) {
    e?.stopPropagation?.();
    onBarClick(metric, period);
  }
} : undefined}
```

**Handler in parent (`src/app/dashboard/page.tsx`):**
```typescript
const handleVolumeBarClick = useCallback(async (metric: 'sql' | 'sqo' | 'joined', period: string) => {
  setVolumeDrillDownLoading(true);
  setVolumeDrillDownError(null);
  setVolumeDrillDownOpen(true);
  setVolumeDrillDownMetric(metric);
  
  const { startDate, endDate } = parsePeriodToDateRange(period);
  
  const metricLabels: Record<'sql' | 'sqo' | 'joined', string> = {
    sql: 'SQLs',
    sqo: 'SQOs',
    joined: 'Joined',
  };
  setVolumeDrillDownTitle(`${metricLabels[metric]} - ${period}`);
  
  const drillDownFilters: DashboardFilters = {
    ...filters,
    startDate,
    endDate,
    metricFilter: metric,
    datePreset: 'custom',
  };
  
  const response = await dashboardApi.getDetailRecords(drillDownFilters, 50000);
  setVolumeDrillDownRecords(response.records);
}, [filters]);
```

**4. API endpoint**: Same as conversion trends - `/api/dashboard/conversion-rates` (POST) with `includeTrends: true` (returns both conversion rates and volume trends)

---

## Section 4: Tables Implementation

### 4.1 Channel Performance Table

**1. File path**: `src/components/dashboard/ChannelPerformanceTable.tsx`

**2. Props interface:**
```typescript
interface ChannelPerformanceTableProps {
  channels: ChannelPerformanceWithGoals[];
  selectedChannel?: string | null;
  onChannelClick?: (channel: string | null) => void;
  viewMode?: 'focused' | 'fullFunnel';
}
```

**3. Column visibility based on view mode:**
- Controlled by `viewMode` prop
- Conditional rendering code:
```tsx
{viewMode === 'fullFunnel' && (
  <>
    <SortableHeader column="prospects">Prospects</SortableHeader>
    <SortableHeader column="contacted">Contacted</SortableHeader>
    <SortableHeader column="mqls">MQLs{hasGoals && ' / Goal'}</SortableHeader>
    <SortableHeader column="contactedToMql">Contacted→MQL</SortableHeader>
    <SortableHeader column="mqlToSql">MQL→SQL</SortableHeader>
  </>
)}
```

**4. Clickable rows:**
```tsx
onClick={() => onChannelClick?.(
  isSelected ? null : channel.channel
)}
```
- Handler in parent: `handleChannelClick` updates `filters.channel` directly via `setFilters`

**5. Sorting**: Client-side sorting using `useMemo` and `sortChannels` function

**6. API endpoint**: `/api/dashboard/source-performance` (POST) with `groupBy: 'channel'` and optional `viewMode`

### 4.2 Source Performance Table

**1. File path**: `src/components/dashboard/SourcePerformanceTable.tsx`

**2. Props interface:**
```typescript
interface SourcePerformanceTableProps {
  sources: SourcePerformanceWithGoals[];
  selectedSource?: string | null;
  onSourceClick?: (source: string | null) => void;
  channelFilter?: string | null;
  viewMode?: 'focused' | 'fullFunnel';
}
```

**3. Filtered by selected channel:**
```typescript
const filteredSources = channelFilter 
  ? sources.filter(s => s.channel === channelFilter)
  : sources;
```
- Filtering happens client-side after data is fetched

**4. Clickable rows**: Same pattern as ChannelPerformanceTable - calls `onSourceClick` which updates `filters.source`

**5. API endpoint**: `/api/dashboard/source-performance` (POST) with `groupBy: 'source'` and optional `viewMode`

### 4.3 Detail Records Table

**1. File path**: `src/components/dashboard/DetailRecordsTable.tsx`

**2. Props interface:**
```typescript
interface DetailRecordsTableProps {
  records: DetailRecord[];
  title?: string;
  filterDescription?: string;
  canExport?: boolean;
  viewMode?: ViewMode;
  advancedFilters?: AdvancedFilters;
  metricFilter?: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
  onRecordClick?: (recordId: string) => void;
  stageFilter?: string;
  onStageFilterChange?: (stage: string) => void;
  availableOpportunityStages?: string[];
}
```

**3. Stage filter dropdown:**
- All stage options:
  - Funnel Stages: prospect, contacted, mql, sql, sqo
  - Opportunity Stages: Qualifying, Discovery, Sales Process, Negotiating, Signed, On Hold, Closed Lost, Joined
- Selecting a stage filters records client-side using `filteredDetailRecords` useMemo
- Filtering logic checks stage-specific date fields and boolean flags

**4. Search functionality:**
- Client-side filtering using fuzzy matching
- Not debounced - filters immediately as user types
- Can search by: advisor, SGA, SGM, source, or channel
- Uses `fuzzyMatch` function for flexible matching

**5. Pagination:**
- Client-side pagination
- State variables: `const [currentPage, setCurrentPage] = useState(1)`
- Records per page: `const recordsPerPage = 50`
- Calculated: `const paginatedRecords = sortedRecords.slice(startIndex, endIndex)`

**6. Clickable rows:**
- Calls `onRecordClick(record.id)` which opens `RecordDetailModal`
- Modal state: `const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)`
- Modal fetches record detail via `dashboardApi.getRecordDetail(recordId)`

**7. Conditional columns:**
```typescript
const showInitialCallColumn = advancedFilters?.initialCallScheduled?.enabled ?? false;
const showQualCallColumn = advancedFilters?.qualificationCallDate?.enabled ?? false;
```
- Columns shown conditionally based on `advancedFilters` prop

**8. API endpoint**: `/api/dashboard/detail-records` (POST) with filters and limit (default 50000)

---

## Section 5: Drill-Down & Modal Functionality

### 5.1 Record Detail Modal

**1. File path**: `src/components/dashboard/RecordDetailModal.tsx`

**2. Props interface:**
```typescript
interface RecordDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordId: string | null;
  initialRecord?: RecordDetailFull | null;
  showBackButton?: boolean;
  onBack?: () => void;
  backButtonLabel?: string;
}
```

**3. Modal state:**
- Visibility controlled by: `isOpen` prop
- State managed in parent: `const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null)`
- Opened via: `onRecordClick` handler sets `selectedRecordId`
- Closed via: `handleCloseRecordModal` sets `selectedRecordId` to `null`

**4. Data displayed:**
- Uses `RecordDetailFull` type from `@/types/record-detail`
- Displays: advisor info, funnel progression, dates, AUM, Salesforce link, stage badges, etc.
- Includes `FunnelProgressStepper` component showing visual funnel progression

**5. Data fetching:**
- Fetches additional data if `initialRecord` not provided
- API call: `dashboardApi.getRecordDetail(recordId)` → `/api/dashboard/record-detail/[id]` (GET)

### 5.2 Volume Drill-Down Modal

**1. File path**: `src/components/dashboard/VolumeDrillDownModal.tsx`

**2. Props interface:**
```typescript
interface VolumeDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: DetailRecord[];
  title: string;
  loading: boolean;
  error: string | null;
  onRecordClick: (recordId: string) => void;
  metricFilter?: 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
  canExport?: boolean;
}
```

**3. Trigger conditions:**
- Clicking on volume scorecards (SQLs, SQOs, Signed, Joined, Open Pipeline)
- Clicking on volume trend chart bars (SQLs, SQOs, Joined)
- Handler: `handleMetricClick` or `handleVolumeBarClick` in parent

**4. Data displayed:**
- Uses `DetailRecordsTable` component to display records
- Records are pre-fetched and passed as prop

### 5.3 Other Drill-Down Modals

**1. Other modals found:**
- `AdvancedFilters` modal (not a drill-down, but a modal)
- No other drill-down modals found in the funnel performance dashboard

---

## Section 6: Data Fetching Patterns

### 6.1 Dashboard Data Fetching

**1. fetchDashboardData function:**
```typescript
const fetchDashboardData = useCallback(async () => {
  if (!filterOptions) return;
  
  setLoading(true);
  
  try {
    const dateRange = buildDateRangeFromFilters(filters);
    const currentFilters: DashboardFilters = {
      ...filters,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      metricFilter: 'prospect' as DashboardFilters['metricFilter'],
    };
    
    // Fetch all data in parallel
    const [metricsData, conversionData, channelsData, sourcesData, recordsData] = await Promise.all([
      dashboardApi.getFunnelMetrics(currentFilters, viewMode),
      dashboardApi.getConversionRates(currentFilters, { includeTrends: true, granularity: trendGranularity, mode: trendMode }),
      dashboardApi.getChannelPerformance(currentFilters, viewMode),
      dashboardApi.getSourcePerformance(currentFilters, viewMode),
      dashboardApi.getDetailRecords(currentFilters, 50000),
    ]);
    
    setMetrics(metricsData);
    setConversionRates(conversionData.rates);
    setTrends(conversionData.trends || []);
    setChannels(channelsData.channels);
    setSources(sourcesData.sources);
    setDetailRecords(recordsData.records);
  } catch (error) {
    console.error('Failed to fetch dashboard data:', error);
    const errorMessage = handleApiError(error);
  } finally {
    setLoading(false);
  }
}, [filters, trendGranularity, trendMode, filterOptions, viewMode]);
```

**2. Data fetching**: Parallel using `Promise.all()`

**3. Caching/memoization**: No explicit caching - data refetches on filter/viewMode changes

**4. Loading states**: Single `loading` state for entire dashboard

**5. Error states**: Errors caught and logged, but no per-section error handling (rely on ErrorBoundaries)

### 6.2 API Response Structures

**1. `/api/dashboard/funnel-metrics`**: Returns `FunnelMetricsWithGoals`
```typescript
interface FunnelMetricsWithGoals extends FunnelMetrics {
  goals: ForecastGoals | null;
}
```

**2. `/api/dashboard/conversion-rates`**: Returns `{ rates: ConversionRatesResponse; trends: TrendDataPoint[] | null; mode?: string }`

**3. `/api/dashboard/source-performance`**: Returns `{ channels: ChannelPerformanceWithGoals[] }` or `{ sources: SourcePerformanceWithGoals[] }` depending on `groupBy` param

**4. `/api/dashboard/detail-records`**: Returns `{ records: DetailRecord[] }`

---

## Section 7: Existing Visibility/Toggle Patterns

### 7.1 View Mode Implementation

**1. ViewMode type definition:**
```typescript
export type ViewMode = 'focused' | 'fullFunnel';
```

**2. State storage**: `const [viewMode, setViewMode] = useState<ViewMode>('focused')` in `src/app/dashboard/page.tsx`

**3. Component checking:**
- Components receive `viewMode` as prop
- Conditional rendering: `{viewMode === 'fullFunnel' && <Component />}`
- Or: `viewMode={viewMode}` prop passed to child components

**4. Toggle UI**: `ViewModeToggle` component at `src/components/dashboard/ViewModeToggle.tsx`

### 7.2 User Preferences

**1. Existing user preferences**: No existing user preferences system found

**2. Customization**: No existing dashboard customization features found

---

## Section 8: Component Identification for Feature Selection

### 8.1 Component Registry

| Feature Name | Component | File Path | Confirm/Correct |
|-------------|-----------|-----------|-----------------|
| Prospects Scorecard | FullFunnelScorecards | `src/components/dashboard/FullFunnelScorecards.tsx` | ✅ Confirmed |
| Contacted Scorecard | FullFunnelScorecards | `src/components/dashboard/FullFunnelScorecards.tsx` | ✅ Confirmed |
| MQLs Scorecard | FullFunnelScorecards | `src/components/dashboard/FullFunnelScorecards.tsx` | ✅ Confirmed |
| SQLs Scorecard | Scorecards | `src/components/dashboard/Scorecards.tsx` | ✅ Confirmed |
| SQOs Scorecard | Scorecards | `src/components/dashboard/Scorecards.tsx` | ✅ Confirmed |
| Signed Scorecard | Scorecards | `src/components/dashboard/Scorecards.tsx` | ✅ Confirmed |
| Joined Scorecard | Scorecards | `src/components/dashboard/Scorecards.tsx` | ✅ Confirmed |
| Open Pipeline Scorecard | Scorecards | `src/components/dashboard/Scorecards.tsx` | ✅ Confirmed |
| Contacted→MQL Rate Card | ConversionRateCards | `src/components/dashboard/ConversionRateCards.tsx` | ✅ Confirmed |
| MQL→SQL Rate Card | ConversionRateCards | `src/components/dashboard/ConversionRateCards.tsx` | ✅ Confirmed |
| SQL→SQO Rate Card | ConversionRateCards | `src/components/dashboard/ConversionRateCards.tsx` | ✅ Confirmed |
| SQO→Joined Rate Card | ConversionRateCards | `src/components/dashboard/ConversionRateCards.tsx` | ✅ Confirmed |
| Conversion Trends Chart | ConversionTrendChart | `src/components/dashboard/ConversionTrendChart.tsx` | ✅ Confirmed |
| Volume Trends Chart | VolumeTrendChart | `src/components/dashboard/VolumeTrendChart.tsx` | ✅ Confirmed |
| Channel Performance Table | ChannelPerformanceTable | `src/components/dashboard/ChannelPerformanceTable.tsx` | ✅ Confirmed |
| Source Performance Table | SourcePerformanceTable | `src/components/dashboard/SourcePerformanceTable.tsx` | ✅ Confirmed |
| Detail Records Table | DetailRecordsTable | `src/components/dashboard/DetailRecordsTable.tsx` | ✅ Confirmed |

### 8.2 Component Granularity

**1. Scorecards**: 
- Full Funnel scorecards (Prospects, Contacted, MQLs) are rendered as a group in `FullFunnelScorecards` component
- Volume scorecards (SQLs, SQOs, Signed, Joined, Open Pipeline) are rendered as a group in `Scorecards` component
- **Recommendation**: Can hide entire groups independently, but individual cards within a group cannot be hidden separately without code changes

**2. Conversion rate cards**: All 4 cards rendered together in single component - cannot hide individually without code changes

**3. Tables**: Each table is an independent component - can be hidden individually ✅

**4. Minimum viable granularity**:
- Full Funnel Scorecards (group of 3)
- Volume Scorecards (group of 5)
- Conversion Rate Cards (group of 4)
- Conversion Trends Chart (individual)
- Volume Trends Chart (individual)
- Channel Performance Table (individual)
- Source Performance Table (individual)
- Detail Records Table (individual)

---

## Section 9: State Management Details

### 9.1 Filter State

**1. DashboardFilters type:**
```typescript
export interface DashboardFilters {
  startDate: string;
  endDate: string;
  datePreset: 'ytd' | 'qtd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom' | 'last30' | 'last90' | 'alltime';
  year: number;
  channel: string | null;
  source: string | null;
  sga: string | null;
  sgm: string | null;
  stage: string | null;
  experimentationTag: string | null;
  metricFilter: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
  advancedFilters?: AdvancedFilters;
}
```

**2. DEFAULT_FILTERS:**
```typescript
const DEFAULT_FILTERS: DashboardFilters = {
  startDate: qtdDates.startDate,
  endDate: qtdDates.endDate,
  datePreset: 'qtd',
  year: new Date().getFullYear(),
  channel: null,
  source: null,
  sga: null,
  sgm: null,
  stage: null,
  experimentationTag: null,
  metricFilter: 'all',
  advancedFilters: DEFAULT_ADVANCED_FILTERS,
};
```

**3. AdvancedFilters type:** (from Section 1, already provided in custom_reporting.md)

### 9.2 Dashboard State

**1. Other state variables in dashboard page:**
```typescript
const [loading, setLoading] = useState(true);
const [filters, setFilters] = useState<DashboardFilters>(DEFAULT_FILTERS);
const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
const [metrics, setMetrics] = useState<FunnelMetricsWithGoals | null>(null);
const [conversionRates, setConversionRates] = useState<ConversionRatesResponse | null>(null);
const [trends, setTrends] = useState<TrendDataPoint[]>([]);
const [channels, setChannels] = useState<ChannelPerformanceWithGoals[]>([]);
const [sources, setSources] = useState<SourcePerformanceWithGoals[]>([]);
const [detailRecords, setDetailRecords] = useState<DetailRecord[]>([]);
const [viewMode, setViewMode] = useState<ViewMode>('focused');
const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
const [selectedSource, setSelectedSource] = useState<string | null>(null);
const [trendGranularity, setTrendGranularity] = useState<'month' | 'quarter'>('quarter');
const [trendMode, setTrendMode] = useState<ConversionTrendMode>('cohort');
const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
const [volumeDrillDownOpen, setVolumeDrillDownOpen] = useState(false);
const [volumeDrillDownRecords, setVolumeDrillDownRecords] = useState<DetailRecord[]>([]);
const [volumeDrillDownLoading, setVolumeDrillDownLoading] = useState(false);
const [volumeDrillDownError, setVolumeDrillDownError] = useState<string | null>(null);
const [volumeDrillDownTitle, setVolumeDrillDownTitle] = useState('');
const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline' | null>(null);
const [stageFilter, setStageFilter] = useState<string>('sqo');
```

**2. Derived state:**
```typescript
const filteredDetailRecords = useMemo(() => {
  // Complex filtering logic based on stageFilter and filters
}, [detailRecords, stageFilter, filters]);

const availableOpportunityStages = useMemo(() => {
  // Computed from detailRecords
}, [detailRecords]);
```

---

## Section 10: Layout and Styling

### 10.1 Dashboard Layout

**1. CSS/Layout system**: Tailwind CSS

**2. Scorecards layout**: 
- Full Funnel: `grid grid-cols-1 md:grid-cols-3 gap-4`
- Volume: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4`
- Conversion Rates: `Grid numItemsSm={2} numItemsLg={4}` (Tremor Grid component)

**3. Charts layout**: Each chart is in its own `Card` component with `mb-6` spacing

**4. Tables layout**: Each table is in its own `Card` component with `mb-6` spacing

**5. Section spacing**: Consistent `mb-6` spacing between major sections

### 10.2 Dark Mode

**1. Implementation**: Next.js `next-themes` package with Tailwind dark mode classes

**2. Component handling**: Automatic via Tailwind `dark:` classes (e.g., `dark:bg-gray-800`, `dark:text-white`)

---

## Section 11: Feature Selection Schema Design

### 11.1 Proposed Schema Review

**Questions:**

**1. Does this structure match actual component granularity?**
- **Partially**: The structure groups scorecards correctly, but:
  - Full Funnel scorecards (prospects, contacted, mqls) are in one component - cannot hide individually
  - Volume scorecards (sqls, sqos, signed, joined, openPipeline) are in one component - cannot hide individually
  - Conversion rate cards are in one component - cannot hide individually
- **Recommendation**: Group by component, not by individual feature:
```typescript
interface FeatureSelection {
  scorecards: {
    fullFunnel: boolean;  // Controls Prospects, Contacted, MQLs together
    volume: boolean;      // Controls SQLs, SQOs, Signed, Joined, Open Pipeline together
  };
  conversionRates: boolean;  // Controls all 4 rate cards together
  charts: {
    conversionTrends: boolean;
    volumeTrends: boolean;
  };
  tables: {
    channelPerformance: boolean;
    sourcePerformance: boolean;
    detailRecords: boolean;
  };
}
```

**2. Missing features**: None identified

**3. Features that must show together**: 
- Full Funnel scorecards must show/hide together
- Volume scorecards must show/hide together
- Conversion rate cards must show/hide together

---

## Section 12: Implementation Considerations

### 12.1 Performance

**1. Skip API calls for hidden components?**
- **Recommendation**: Yes, skip API calls for hidden components to improve performance
- Modify `fetchDashboardData` to conditionally fetch based on feature selection

**2. How to modify fetchDashboardData:**
```typescript
const fetchDashboardData = useCallback(async () => {
  if (!filterOptions) return;
  
  setLoading(true);
  
  try {
    const dateRange = buildDateRangeFromFilters(filters);
    const currentFilters: DashboardFilters = { ...filters, ... };
    
    const promises = [];
    
    if (featureSelection.scorecards.fullFunnel || featureSelection.scorecards.volume || featureSelection.tables.channelPerformance || featureSelection.tables.sourcePerformance) {
      promises.push(dashboardApi.getFunnelMetrics(currentFilters, viewMode).then(setMetrics));
    }
    
    if (featureSelection.conversionRates || featureSelection.charts.conversionTrends || featureSelection.charts.volumeTrends) {
      promises.push(dashboardApi.getConversionRates(...).then(data => {
        setConversionRates(data.rates);
        setTrends(data.trends || []);
      }));
    }
    
    // ... etc
    
    await Promise.all(promises);
  } finally {
    setLoading(false);
  }
}, [filters, featureSelection, ...]);
```

### 12.2 Default Feature Selection

**1. Default when creating new report**: 
- **Recommendation**: All features visible by default (matches current dashboard behavior)

**2. Admin templates**: 
- **Recommendation**: Admins can lock features as always-visible, but not force-hide (users can still hide if they want)

### 12.3 Edge Cases

**1. Full Funnel scorecards in non-Full Funnel mode:**
- **Recommendation**: Hide Full Funnel scorecards if `viewMode !== 'fullFunnel'`, regardless of feature selection
- Feature selection should respect view mode constraints

**2. Feature selection vs view mode:**
- **Recommendation**: Feature selection should be independent of view mode, but respect view mode constraints (e.g., Full Funnel scorecards only available in fullFunnel mode)

---

## Section 13: Existing Similar Patterns

### 13.1 Reference Implementations

**1. Customizable component visibility**: No existing patterns found

**2. Save configuration patterns**: No existing patterns found

**3. localStorage usage**: No localStorage usage found in codebase

---

## Section 14: GlobalFilters Component Deep Dive

### 14.1 Current Structure

**1. Props interface:**
```typescript
interface GlobalFiltersProps {
  filters: DashboardFilters;
  filterOptions: FilterOptions;
  onFiltersChange: (filters: DashboardFilters) => void;
  onReset: () => void;
}
```

**2. JSX structure:**
```tsx
<div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 mb-6">
  <div className="flex items-center justify-between mb-4">
    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Filters</h3>
    <Button onClick={onReset}>Reset</Button>
  </div>
  
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    {/* Date Preset, Year, Custom Dates, Channel, Source, SGA, SGM, Experimentation Tag */}
  </div>
  
  <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
    <DataFreshnessIndicator variant="detailed" />
  </div>
</div>
```

**3. Space taken**: 
- Vertical: ~200-250px (depending on number of filter rows)
- Horizontal: Full width with responsive grid

**4. Room for Saved Reports UI**: 
- **Recommendation**: Add a new row above or below the filter grid for Saved Reports dropdown and Save button
- Could also add to the header row next to Reset button

### 14.2 Dropdown Implementation

**1. Existing dropdown pattern:**
```tsx
<select
  value={filters.channel || ''}
  onChange={(e) => handleChannelChange(e.target.value)}
  className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors"
>
  <option value="">All Channels</option>
  {filterOptions.channels.map((channel) => (
    <option key={channel} value={channel}>
      {channel}
    </option>
  ))}
</select>
```

**2. Tremor Select**: Not used - codebase uses native HTML `<select>` elements

---

## Section 15: Error Boundaries

### 15.1 Error Handling

**1. Error boundaries implementation**: 
- Shared `ErrorBoundary` component at `src/components/ui/ErrorBoundary.tsx`
- Specialized boundaries: `ChartErrorBoundary`, `TableErrorBoundary`, `CardErrorBoundary`, `FilterErrorBoundary` at `src/components/ui/DashboardErrorBoundaries.tsx`

**2. Usage pattern:**
```tsx
<CardErrorBoundary>
  <Scorecards ... />
</CardErrorBoundary>
```

**3. Error handling for individual features**: 
- Each major section wrapped in appropriate ErrorBoundary
- Errors in one feature don't affect others
- **Recommendation**: Continue this pattern for feature selection - each feature should be wrapped in its own ErrorBoundary

---

## Summary

All questions have been answered based on thorough codebase analysis. Key findings:

1. **Component Granularity**: Features are grouped by component, not individual cards/charts
2. **View Mode**: Full Funnel scorecards are tied to view mode
3. **Data Fetching**: All data fetched in parallel, can be optimized for feature selection
4. **No Existing Patterns**: No existing customization or save patterns to reference
5. **Error Boundaries**: Well-implemented, should continue pattern for feature selection
