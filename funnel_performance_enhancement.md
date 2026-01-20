# Funnel Performance Dashboard Enhancement Plan

## Problem Statement

**Current UX Issue**: When users click a scorecard (e.g., SQOs), the page scrolls down to filter the detail table. This causes:
1. Loss of visual context (filters and scorecards scroll out of view)
2. Disorientation when trying to see both the metric count and its underlying records
3. Extra scrolling to return to the dashboard overview

**User Quote**:
> "The problem with current behavior is that we have to scroll down to look at the record details, and that is really hard. Then you can't see the filters up top, so it's better just to click a card and dive into the record details from the card — because when I'm clicking the SQO card, I'm going to want to look at SQO details from that card anyway."

**Solution**: 
- Scorecard clicks open a **drill-down modal** with records for that metric
- The detail table becomes an **independent, always-visible** component with its own stage filter
- Users can dive deep via modal OR browse via table — two complementary workflows

## User Personas & Workflows

| Persona | Primary Use Case | Key Workflow |
|---------|------------------|--------------|
| **SGA** | Check own pipeline | Click SQO card → Review deals → Click record for details |
| **Manager** | Team oversight | Filter by SGA → Review conversion rates → Drill into underperformers |
| **Executive** | High-level metrics | View scorecards → Spot trends → Occasional drill-down |
| **RevOps** | Analysis & reporting | Filter by channel/source → Export data → Compare periods |

**Default to SQO** because SGAs (primary users) focus on middle-funnel deals they're actively working.

> "Generally people are just looking at SQOs anyways, so perhaps that's the best place to start because technically SQO is the beginning of our sort of like middle funnel."

## Prerequisites

### Required Code Knowledge

#### Current Implementation Details

**handleMetricClick Function** (`src/app/dashboard/page.tsx`, lines 173-182):
```typescript
const handleMetricClick = (metric: string) => {
  const newMetric = selectedMetric === metric ? null : metric;
  setSelectedMetric(newMetric);
  
  // Update filters to fetch appropriate detail records
  setFilters(prev => ({
    ...prev,
    metricFilter: (newMetric || 'all') as DashboardFilters['metricFilter'],
  }));
};
```

**VolumeDrillDownModal Current Type** (`src/components/dashboard/VolumeDrillDownModal.tsx`, line 16):
```typescript
metricFilter?: 'sql' | 'sqo' | 'joined';
```

**VolumeDrillDownModal State** (`src/app/dashboard/page.tsx`, line 105):
```typescript
const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<'sql' | 'sqo' | 'joined' | null>(null);
```

**VolumeDrillDownModal Usage**: Currently only used in `src/app/dashboard/page.tsx` for volume trend chart bar clicks (line 467).

**Scorecards Component Props** (`src/components/dashboard/Scorecards.tsx`):
- `metrics: FunnelMetricsWithGoals`
- `selectedMetric?: string | null`
- `onMetricClick?: (metric: string) => void`

**FullFunnelScorecards Component Props** (`src/components/dashboard/FullFunnelScorecards.tsx`):
- Same pattern as Scorecards
- Uses same selection highlighting logic

**DetailRecordsTable Props** (`src/components/dashboard/DetailRecordsTable.tsx`, lines 16-25):
```typescript
interface DetailRecordsTableProps {
  records: DetailRecord[];
  title?: string;
  filterDescription?: string;
  canExport?: boolean;
  viewMode?: ViewMode;
  advancedFilters?: AdvancedFilters;
  metricFilter?: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
  onRecordClick?: (recordId: string) => void;
}
```

**fetchDashboardData Dependencies** (`src/app/dashboard/page.tsx`, line 164):
```typescript
}, [filters, selectedMetric, trendGranularity, trendMode, filterOptions, viewMode]);
```

### Dependencies

- `VolumeDrillDownModal` component exists and works for SQL/SQO/Joined
- `DetailRecordsTable` component supports pagination (50 records per page, client-side)
- `getDetailRecords` query function supports all metric filter types
- All boolean flags are returned in prospect queries

## Data Model Confirmation

### DetailRecord Interface

**Complete Interface** (`src/types/dashboard.ts`, lines 116-136):
```typescript
export interface DetailRecord {
  id: string;
  advisorName: string;
  source: string;
  channel: string;
  stage: string;  // StageName from opportunities
  sga: string | null;
  sgm: string | null;
  aum: number;
  aumFormatted: string;
  salesforceUrl: string;
  relevantDate: string;  // Currently FilterDate, but will need stage-specific dates
  initialCallScheduledDate: string | null;
  qualificationCallDate: string | null;
  // ⚠️ NEED TO ADD: Stage-specific date fields for dynamic date display
  // contactedDate?: string | null;  // stage_entered_contacting__c
  // mqlDate?: string | null;         // mql_stage_entered_ts
  // sqlDate?: string | null;         // converted_date_raw
  // sqoDate?: string | null;         // Date_Became_SQO__c
  // joinedDate?: string | null;      // advisor_join_date__c
  isContacted: boolean;    // ✅ Available for client-side filtering
  isMql: boolean;          // ✅ Available for client-side filtering
  isSql: boolean;          // ✅ Available for client-side filtering
  isSqo: boolean;          // ✅ Available for client-side filtering
  isJoined: boolean;       // ✅ Available for client-side filtering
  isOpenPipeline: boolean; // ✅ Available for client-side filtering
}
```

**⚠️ Interface Update Required**: The `DetailRecord` interface needs to be extended to include all stage-specific date fields so the table can display the correct date based on `stageFilter`.

### Field Name Mappings

**Boolean Flag Fields** (from `src/lib/queries/detail-records.ts`, lines 187-191):
- `is_contacted` → `isContacted` (boolean)
- `is_mql` → `isMql` (boolean)
- `is_sql` → `isSql` (boolean)
- `is_sqo_unique` → `isSqo` (boolean)
- `is_joined_unique` → `isJoined` (boolean)
- `StageName` → `stage` (string) - Available for opportunity stage filtering

**Critical Finding**: ✅ **Prospect records include ALL boolean flags needed for client-side filtering**

The `getDetailRecords` query with `metricFilter: 'prospect'` returns all records with all boolean flags populated (lines 187-191), making client-side filtering to other stages possible.

### Opportunity Stage Data

**BigQuery Verification Results** (Last 90 Days - Updated):
- Total Prospects: 23,456 records
- Records with StageName: 825 (3.5%)
- Unique Stage Names: 1 (most common: "Engaged")
- **Note**: Stage names are dynamically extracted from loaded records, so actual stages will vary by period

**Finding**: StageName is available on opportunity-level records and can be used for filtering. The dropdown will dynamically populate with stages present in the current dataset.

### Boolean Flags Verification

**BigQuery Verification Results** (Last 90 Days - Updated):
- Total Records: 23,456
- Records with `is_contacted = 1`: 17,029 (72.6%)
- Records with `is_mql = 1`: 559 (2.4%)
- Records with `is_sql = 1`: 139 (0.6%)
- Records with `is_sqo_unique = 1`: 102 (0.4%)
- Records with `is_joined_unique = 1`: 2 (0.01%)
- Records with `StageName IS NOT NULL`: 825 (3.5%)

**Assessment**: ✅ **All boolean flags are populated and available for client-side filtering**

## Current Behavior

### Scorecards
- **Location**: Top of dashboard (`Scorecards.tsx` and `FullFunnelScorecards.tsx`)
- **Metrics Displayed**:
  - **Full Funnel View**: Prospects, Contacted, MQLs
  - **Focused View**: SQLs, SQOs, Joined, Open Pipeline
- **Current Click Behavior**: Clicking a scorecard filters the `DetailRecordsTable` by setting `metricFilter` in the filters state
- **Implementation**: `handleMetricClick` in `src/app/dashboard/page.tsx` (lines 173-182) updates `filters.metricFilter` which triggers a refetch of detail records via `fetchDashboardData` (line 164 depends on `selectedMetric`)

### Record Details Table
- **Location**: Bottom of dashboard (`DetailRecordsTable.tsx`)
- **Current Behavior**: 
  - Displays records filtered by the selected metric (if a scorecard is clicked)
  - Shows different date columns based on `metricFilter` prop
  - Filters records based on `filters.metricFilter` value
  - Client-side pagination (50 records per page)
  - Client-side search functionality

## Desired Behavior

### Scorecards
- **New Click Behavior**: Clicking a scorecard should:
  1. Open a drill-down modal (similar to `VolumeDrillDownModal`) showing records for that metric
  2. Allow clicking on records in the modal to open the record detail modal
  3. **NOT** filter the main record details table
  4. Remove visual selection highlighting (no selected state)

### Record Details Table
- **Default State**: Always show **SQO** records for the given period and filters (changed from Prospects per user requirement)
- **Stage Dropdown**: Add a dropdown selector that allows filtering the table by:
  - **Funnel Stages** (Lead Lifecycle): SQO (default), Prospects, Contacted, MQL, SQL, Joined, Open Pipeline
  - **Opportunity Stages** (Sales Process): All unique `StageName` values from opportunities in the current period/filters (e.g., "Discovery", "Qualifying", "Sales Process", "Negotiating", "Closed Won", "Closed Lost", etc.)
- **Filter Behavior**: The dropdown should filter the already-loaded prospects data client-side (no additional API call needed)
- **Date Column**: Shows the **stage-specific date** based on the selected filter:
  - **SQO**: `Date_Became_SQO__c` (when they became SQO)
  - **SQL**: `converted_date_raw` (when they converted from MQL to SQL)
  - **Joined**: `advisor_join_date__c` (when they joined)
  - **Contacted**: `stage_entered_contacting__c` (when they entered Contacting stage)
  - **MQL**: `mql_stage_entered_ts` (when they became MQL)
  - **Prospects**: `FilterDate` (cohort date when record entered funnel)
  - **Opportunity Stages**: `FilterDate` (fallback, or opportunity-specific stage date if available)

**Stage Dropdown Structure**:

The dropdown combines two types of stages in a single list:

**Funnel Stages** (Lead Lifecycle):
- SQO (default)
- Prospects
- Contacted  
- MQL
- SQL
- Joined
- Open Pipeline

**Opportunity Stages** (Sales Process — only visible when records have StageName):
- Discovery
- Qualifying
- Sales Process
- Negotiating
- Closed Won
- Closed Lost
- (dynamically populated from data)

**Why combined?**: Users filter by ONE stage at a time. Separating into two dropdowns adds unnecessary complexity. The optgroup label distinguishes funnel vs opportunity stages.

> "They're going to only be filtering by one or the other. When someone becomes an SQO, they then roll into the different stage names."

## Implementation Plan

### Phase 1: Update Scorecard Click Handlers

#### 1.1 Modify `handleMetricClick` in `src/app/dashboard/page.tsx`

**Current Implementation** (lines 173-182):
```typescript
const handleMetricClick = (metric: string) => {
  const newMetric = selectedMetric === metric ? null : metric;
  setSelectedMetric(newMetric);
  
  // Update filters to fetch appropriate detail records
  setFilters(prev => ({
    ...prev,
    metricFilter: (newMetric || 'all') as DashboardFilters['metricFilter'],
  }));
};
```

**New Implementation**:
```typescript
const handleMetricClick = async (metric: string) => {
  // Don't filter the main table - open drill-down modal instead
  setSelectedMetric(null); // Clear selection (no visual highlight needed)
  
  // Open drill-down modal
  setVolumeDrillDownLoading(true);
  setVolumeDrillDownError(null);
  setVolumeDrillDownOpen(true);
  
  // Map metric IDs to proper metric filter values
  const metricMap: Record<string, 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline'> = {
    'prospect': 'prospect',
    'contacted': 'contacted',
    'mql': 'mql',
    'sql': 'sql',
    'sqo': 'sqo',
    'joined': 'joined',
    'openPipeline': 'openPipeline',
  };
  
  const metricFilter = metricMap[metric] || 'prospect';
  setVolumeDrillDownMetric(metricFilter);
  
  // Set title
  const metricLabels: Record<string, string> = {
    prospect: 'Prospects',
    contacted: 'Contacted',
    mql: 'MQLs',
    sql: 'SQLs',
    sqo: 'SQOs',
    joined: 'Joined',
    openPipeline: 'Open Pipeline',
  };
  
  const dateRange = buildDateRangeFromFilters(filters);
  const dateRangeText = filters.datePreset === 'custom' 
    ? `${dateRange.startDate} to ${dateRange.endDate}`
    : filters.datePreset || 'selected period';
  
  setVolumeDrillDownTitle(`${metricLabels[metricFilter]} - ${dateRangeText}`);
  
  try {
    // Build filters for the drill-down
    const drillDownFilters: DashboardFilters = {
      ...filters,
      metricFilter: metricFilter,
    };
    
    // Fetch records using getDetailRecords
    const response = await dashboardApi.getDetailRecords(drillDownFilters, 50000);
    setVolumeDrillDownRecords(response.records);
  } catch (error) {
    console.error('Error fetching drill-down records:', error);
    setVolumeDrillDownError('Failed to load records. Please try again.');
  } finally {
    setVolumeDrillDownLoading(false);
  }
};
```

#### 1.2 Update `VolumeDrillDownModal` to Support All Metrics

**Current Limitation**: `VolumeDrillDownModal` only accepts `'sql' | 'sqo' | 'joined'` for `metricFilter` (line 16 of `VolumeDrillDownModal.tsx`)

**Update Interface** in `src/components/dashboard/VolumeDrillDownModal.tsx`:
```typescript
interface VolumeDrillDownModalProps {
  // ... existing props
  metricFilter?: 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
  // ... rest of props
}
```

**Update State** in `src/app/dashboard/page.tsx` (line 105):
```typescript
const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<
  'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline' | null
>(null);
```

#### 1.3 Remove Visual Selection State

Since scorecards no longer filter the table, we can remove the visual selection highlighting:

**In `Scorecards.tsx` and `FullFunnelScorecards.tsx`**:
- Remove `selectedMetric` prop usage for visual highlighting (keep prop for backward compatibility but don't use it)
- Keep `onMetricClick` handler
- Remove selection styling (ring-2, bg-blue-50 classes)
- Cards should still be clickable but won't show selected state

**Update `Scorecards.tsx`** (lines 56-81, 84-109, 112-137, 140-165):
- Remove `isSelected` function usage
- Remove conditional classes for selection
- Keep hover effects

**Update `FullFunnelScorecards.tsx`** (lines 74-99, 102-125, 128-153):
- Same changes as Scorecards.tsx

### Phase 1 Verification

After implementing scorecard click changes:

1. **Build check**: `npm run build` (should complete without errors)
2. **Type check**: `npx tsc --noEmit` (should pass)
3. **Manual test**: 
   - Click each scorecard → modal should open
   - Verify modal shows correct records
   - Verify main table does NOT change
   - Verify scorecards do NOT show selected state

### Phase 2: Update Record Details Table

#### 2.1 Always Load Prospects by Default (for Client-Side Filtering)

**In `src/app/dashboard/page.tsx`**:

**Current Implementation** (lines 123-164):
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
      metricFilter: (selectedMetric || 'all') as DashboardFilters['metricFilter'],
    };
    
    // ... fetch data
    const recordsData = await dashboardApi.getDetailRecords(currentFilters, 50000);
    setDetailRecords(recordsData.records);
  } catch (error) {
    // ...
  } finally {
    setLoading(false);
  }
}, [filters, selectedMetric, trendGranularity, trendMode, filterOptions, viewMode]);
```

**New Implementation**:
```typescript
const fetchDashboardData = useCallback(async () => {
  if (!filterOptions) return;
  
  setLoading(true);
  
  try {
    const dateRange = buildDateRangeFromFilters(filters);
    
    // Always fetch prospects for the record details table (we'll filter client-side)
    const currentFilters: DashboardFilters = {
      ...filters,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      metricFilter: 'prospect', // Always prospects for client-side filtering
    };
    
    // ... fetch data (metrics, conversion rates, channels, sources)
    const recordsData = await dashboardApi.getDetailRecords(currentFilters, 50000);
    setDetailRecords(recordsData.records);
  } catch (error) {
    // ...
  } finally {
    setLoading(false);
  }
}, [filters, trendGranularity, trendMode, filterOptions, viewMode]); // Remove selectedMetric dependency
```

#### 2.2 Add Stage Filter State

**In `src/app/dashboard/page.tsx`** (add after line 97):
```typescript
// Add new state for stage filter - default to SQO per user requirement
const [stageFilter, setStageFilter] = useState<
  'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline' | string | null
>('sqo'); // Default to 'sqo' (changed from 'prospect')
```

#### 2.3 Extract Available Stages from Records

**In `src/app/dashboard/page.tsx`** (add after stageFilter state):
```typescript
// Extract unique opportunity stages from loaded records
const availableOpportunityStages = useMemo(() => {
  if (!detailRecords.length) return [];
  
  const stages = new Set<string>();
  detailRecords.forEach(record => {
    // Only include opportunity stages (not lead-level stages)
    // Lead-level stages are: Prospect, Contacted, MQL, SQL, SQO, Joined
    if (record.stage && 
        record.stage.trim() !== '' &&
        !['Prospect', 'Contacted', 'MQL', 'SQL', 'SQO', 'Joined'].includes(record.stage)) {
      stages.add(record.stage);
    }
  });
  
  return Array.from(stages).sort();
}, [detailRecords]);
```

#### 2.4 Filter Records Client-Side Based on Stage

**In `src/app/dashboard/page.tsx`** (add after availableOpportunityStages):
```typescript
// Filter records based on stage selection
const filteredDetailRecords = useMemo(() => {
  if (!stageFilter || stageFilter === 'prospect') {
    return detailRecords; // Show all prospects
  }
  
  return detailRecords.filter(record => {
    // Handle lead-level stages
    switch (stageFilter) {
      case 'contacted':
        return record.isContacted;
      case 'mql':
        return record.isMql;
      case 'sql':
        return record.isSql;
      case 'sqo':
        return record.isSqo;
      case 'joined':
        return record.isJoined;
      case 'openPipeline':
        return record.isOpenPipeline;
      default:
        // Handle opportunity stage names (e.g., "Qualifying", "Discovery", etc.)
        return record.stage === stageFilter;
    }
  });
}, [detailRecords, stageFilter]);
```

#### 2.5 Add Stage Dropdown to DetailRecordsTable

**Update `DetailRecordsTable` Component** in `src/components/dashboard/DetailRecordsTable.tsx`:

**Add Props** (update interface at lines 16-25):
```typescript
interface DetailRecordsTableProps {
  // ... existing props
  stageFilter?: 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline' | string | null;
  onStageFilterChange?: (stage: string | null) => void;
  availableOpportunityStages?: string[];
}
```

**Add Dropdown UI** (before the search bar, around line 250-300):
```typescript
// In DetailRecordsTable component, add before search bar
<div className="mb-4 flex items-center gap-4 flex-wrap">
  <div className="flex items-center gap-2">
    <label htmlFor="stage-filter" className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
      Stage:
    </label>
    <select
      id="stage-filter"
      value={stageFilter || 'sqo'}
      onChange={(e) => {
        const value = e.target.value;
        onStageFilterChange?.(value === 'sqo' ? null : value); // Default is 'sqo', but pass null to match state
      }}
      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[180px]"
    >
      <option value="sqo">SQO</option>
      <option value="prospect">Prospects</option>
      <option value="contacted">Contacted</option>
      <option value="mql">MQL</option>
      <option value="sql">SQL</option>
      <option value="joined">Joined</option>
      <option value="openPipeline">Open Pipeline</option>
      {availableOpportunityStages && availableOpportunityStages.length > 0 && (
        <optgroup label="Opportunity Stages">
          {availableOpportunityStages.map(stage => (
            <option key={stage} value={stage}>{stage}</option>
          ))}
        </optgroup>
      )}
    </select>
  </div>
  {/* Existing search bar continues here */}
</div>
```

**Update Component Usage** in `src/app/dashboard/page.tsx` (around line 437):
```typescript
<DetailRecordsTable
  records={filteredDetailRecords} // Use filtered records
  title="Record Details"
  filterDescription={getDetailDescription()}
  canExport={permissions?.canExport ?? false}
  viewMode={viewMode}
  advancedFilters={filters.advancedFilters}
  metricFilter="prospect" // Always prospect (for date column logic)
  stageFilter={stageFilter}
  onStageFilterChange={setStageFilter}
  availableOpportunityStages={availableOpportunityStages}
  onRecordClick={handleRecordClick}
/>
```

#### 2.6 Update getDetailDescription Function

**In `src/app/dashboard/page.tsx`** (update function at lines 285-308):
```typescript
// Build detail table description
const getDetailDescription = () => {
  const parts = [];
  
  // Add stage filter if not default
  if (stageFilter && stageFilter !== 'sqo') {
    const stageLabels: Record<string, string> = {
      prospect: 'Prospects',
      contacted: 'Contacted',
      mql: 'MQLs',
      sql: 'SQLs',
      sqo: 'SQOs',
      joined: 'Joined',
      openPipeline: 'Open Pipeline',
    };
    parts.push(stageLabels[stageFilter] || stageFilter);
  } else {
    parts.push('SQOs');
  }
  
  if (selectedChannel) parts.push(`Channel: ${selectedChannel}`);
  if (selectedSource) parts.push(`Source: ${selectedSource}`);
  
  if (parts.length > 0) {
    return `Filtered by: ${parts.join(', ')}`;
  }
  
  return 'All SQOs';
};
```

### Phase 2 Verification

After implementing stage dropdown:

1. **Build check**: `npm run build`
2. **Manual test**:
   - Load dashboard → table should show SQOs by default
   - Select "Prospects" → table should show all prospects
   - Select "SQL" → table should filter to SQL records
   - Select "Discovery" (if available) → table should filter to Discovery stage
   - Verify record counts match scorecard numbers
   - Verify date column shows stage-specific dates (SQO shows Date_Became_SQO__c, SQL shows converted_date_raw, etc.)

### Phase 3: Update Detail Records Query Logic

#### 3.1 Ensure Prospects Query Works Correctly

**Verify** `src/lib/queries/detail-records.ts` handles `'prospect'` metric filter correctly (lines 68-76):

The current implementation already handles this correctly:
```typescript
case 'prospect':
  // Prospects: Filter by FilterDate within date range (all records)
  dateField = 'FilterDate';
  dateFieldAlias = 'relevant_date';
  conditions.push('FilterDate IS NOT NULL');
  conditions.push('TIMESTAMP(FilterDate) >= TIMESTAMP(@startDate)');
  conditions.push('TIMESTAMP(FilterDate) <= TIMESTAMP(@endDate)');
  // No additional filters needed
  break;
```

✅ **This is correct and works as-is.**

#### 3.2 Verify Boolean Flags Are Returned

**Confirm** `src/lib/queries/detail-records.ts` returns all boolean flags (lines 187-191, 248-253):

The query already returns all necessary flags:
```typescript
v.is_contacted,
v.is_mql,
v.is_sql,
v.is_sqo_unique as is_sqo,
v.is_joined_unique as is_joined
```

And maps them correctly:
```typescript
isContacted: r.is_contacted === 1,
isMql: r.is_mql === 1,
isSql: r.is_sql === 1,
isSqo: r.is_sqo === 1,
isJoined: r.is_joined === 1,
isOpenPipeline: OPEN_PIPELINE_STAGES.includes(toString(r.stage)),
```

✅ **All flags are returned and available for client-side filtering.**

#### 3.3 Update Query to Include All Stage-Specific Dates

**Current Limitation**: The query only returns `relevant_date` (which is `FilterDate` for prospects). We need ALL stage-specific dates to display the correct date based on `stageFilter`.

**Update Query** in `src/lib/queries/detail-records.ts` (around line 173-198):

**Current SELECT**:
```typescript
SELECT
  v.primary_key as id,
  v.advisor_name,
  // ... other fields
  ${dateField} as relevant_date,  // Only one date field
  v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
  v.Qualification_Call_Date__c as qualification_call_date,
  // ... boolean flags
```

**New SELECT** (add all stage-specific dates):
```typescript
SELECT
  v.primary_key as id,
  v.advisor_name,
  // ... other fields
  v.FilterDate as filter_date,
  v.stage_entered_contacting__c as contacted_date,
  v.mql_stage_entered_ts as mql_date,
  v.converted_date_raw as sql_date,
  v.Date_Became_SQO__c as sqo_date,
  v.advisor_join_date__c as joined_date,
  v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
  v.Qualification_Call_Date__c as qualification_call_date,
  // ... boolean flags
```

**Update Mapping** in `src/lib/queries/detail-records.ts` (around line 202-255):

Add date field extraction for all dates:
```typescript
return results.map(r => {
  // Extract all date fields
  const extractDate = (field: any): string | null => {
    if (!field) return null;
    if (typeof field === 'string') return field;
    if (typeof field === 'object' && field.value) return field.value;
    return null;
  };
  
  return {
    // ... existing fields
    relevantDate: extractDate(r.filter_date) || '', // Default to FilterDate
    contactedDate: extractDate(r.contacted_date),
    mqlDate: extractDate(r.mql_date),
    sqlDate: extractDate(r.sql_date),
    sqoDate: extractDate(r.sqo_date),
    joinedDate: extractDate(r.joined_date),
    // ... rest of fields
  };
});
```

#### 3.4 Update DetailRecord Interface

**Update** `src/types/dashboard.ts` (lines 116-136):

```typescript
export interface DetailRecord {
  id: string;
  advisorName: string;
  source: string;
  channel: string;
  stage: string;
  sga: string | null;
  sgm: string | null;
  aum: number;
  aumFormatted: string;
  salesforceUrl: string;
  relevantDate: string;  // FilterDate (fallback)
  contactedDate: string | null;  // stage_entered_contacting__c
  mqlDate: string | null;         // mql_stage_entered_ts
  sqlDate: string | null;         // converted_date_raw
  sqoDate: string | null;         // Date_Became_SQO__c
  joinedDate: string | null;      // advisor_join_date__c
  initialCallScheduledDate: string | null;
  qualificationCallDate: string | null;
  isContacted: boolean;
  isMql: boolean;
  isSql: boolean;
  isSqo: boolean;
  isJoined: boolean;
  isOpenPipeline: boolean;
}
```

#### 3.5 Update DetailRecordsTable Date Column Logic

**Update** `src/components/dashboard/DetailRecordsTable.tsx` (around line 155-183):

**Current**: Shows `relevantDate` (always FilterDate)

**New**: Show stage-specific date based on `stageFilter` prop:

```typescript
// Determine which date to display based on stageFilter
const getDisplayDate = (record: DetailRecord): string => {
  switch (stageFilter) {
    case 'contacted':
      return record.contactedDate || record.relevantDate || '';
    case 'mql':
      return record.mqlDate || record.relevantDate || '';
    case 'sql':
      return record.sqlDate || record.relevantDate || '';
    case 'sqo':
      return record.sqoDate || record.relevantDate || '';
    case 'joined':
      return record.joinedDate || record.relevantDate || '';
    case 'prospect':
    default:
      return record.relevantDate || ''; // FilterDate
  }
};

// Update date column description
const getDateColumnDescription = (): string => {
  switch (stageFilter) {
    case 'contacted':
      return 'Shows the date when each person entered the Contacting stage.';
    case 'mql':
      return 'Shows the date when each person became an MQL (Marketing Qualified Lead).';
    case 'sql':
      return 'Shows the conversion date for each SQL (Sales Qualified Lead).';
    case 'sqo':
      return 'Shows the date when each person became an SQO (Sales Qualified Opportunity).';
    case 'joined':
      return 'Shows the advisor join date for each person who joined.';
    case 'prospect':
    default:
      return 'Shows the Filter Date (cohort date) for each prospect.';
  }
};
```

**Update date column rendering** to use `getDisplayDate(record)` instead of `record.relevantDate`.

### Phase 4: Update Modal Navigation

#### 4.1 Ensure Back Button Works

The existing back button logic in `RecordDetailModal` should work correctly:
- When opening record detail from drill-down modal, show back button
- Back button closes record detail and reopens drill-down modal

**Verify** in `src/app/dashboard/page.tsx` (lines 481-491):
```typescript
<RecordDetailModal
  isOpen={selectedRecordId !== null}
  onClose={handleCloseRecordModal}
  recordId={selectedRecordId}
  showBackButton={volumeDrillDownOpen} // Show back if drill-down is open
  onBack={() => {
    setSelectedRecordId(null);
    setVolumeDrillDownOpen(true);
  }}
  backButtonLabel="← Back to records"
/>
```

✅ **This should already work correctly.**

### Phase 5: Testing Checklist

#### 5.1 Scorecard Click Behavior
- [ ] Clicking "Prospects" scorecard opens drill-down modal with prospects
- [ ] Clicking "Contacted" scorecard opens drill-down modal with contacted records
- [ ] Clicking "MQL" scorecard opens drill-down modal with MQL records
- [ ] Clicking "SQL" scorecard opens drill-down modal with SQL records
- [ ] Clicking "SQO" scorecard opens drill-down modal with SQO records
- [ ] Clicking "Joined" scorecard opens drill-down modal with joined records
- [ ] Clicking "Open Pipeline" scorecard opens drill-down modal with open pipeline records
- [ ] Scorecard clicks do NOT filter the main record details table
- [ ] Main record details table always shows SQOs by default (not prospects)
- [ ] Scorecards do NOT show visual selection state

#### 5.2 Drill-Down Modal
- [ ] Modal displays correct records for each metric
- [ ] Modal title shows correct metric name and date range
- [ ] Clicking a record in modal opens record detail modal
- [ ] Back button in record detail returns to drill-down modal
- [ ] Closing drill-down modal works correctly
- [ ] Modal works for all metric types (prospect, contacted, mql, sql, sqo, joined, openPipeline)

#### 5.3 Record Details Table
- [ ] Table always loads prospects by default (for client-side filtering)
- [ ] Table displays SQOs by default (after client-side filtering)
- [ ] Stage dropdown appears above the table
- [ ] Dropdown includes: SQO (default), Prospects, Contacted, MQL, SQL, Joined, Open Pipeline
- [ ] Dropdown includes all unique opportunity stages from loaded records
- [ ] Selecting different stages filters the table client-side
- [ ] Filtering works correctly for each stage type:
  - [ ] SQO (default) filters by `isSqo === true`
  - [ ] Prospects shows all records
  - [ ] Contacted filters by `isContacted === true`
  - [ ] MQL filters by `isMql === true`
  - [ ] SQL filters by `isSql === true`
  - [ ] Joined filters by `isJoined === true`
  - [ ] Open Pipeline filters by `isOpenPipeline === true`
  - [ ] Opportunity stages filter by `stage === selectedStage`
- [ ] Date column shows stage-specific date:
  - [ ] SQO shows Date_Became_SQO__c
  - [ ] SQL shows converted_date_raw
  - [ ] Joined shows advisor_join_date__c
  - [ ] Contacted shows stage_entered_contacting__c
  - [ ] MQL shows mql_stage_entered_ts
  - [ ] Prospects shows FilterDate
- [ ] Table maintains other functionality (search, sort, pagination, export)
- [ ] Filter description updates based on selected stage

#### 5.4 Edge Cases
- [ ] Works correctly when no records match selected stage
- [ ] Works correctly when filters change (date range, channel, source, etc.)
- [ ] Works correctly in both fullFunnel and focused view modes
- [ ] Works correctly with advanced filters applied
- [ ] Export functionality works with stage filter applied
- [ ] Stage filter resets to 'sqo' when filters change (optional - may want to persist)

## Ground Truth Validation

After implementation, verify counts match `docs/GROUND-TRUTH.md`:

**Q1 2025 (use for validation)**:
- SQLs: 123
- SQOs: 96  
- Joined: 12

**Test procedure**:
1. Set date range to Q1 2025 (Jan 1 - Mar 31, 2025)
2. Click SQL scorecard → modal should show 123 records
3. Click SQO scorecard → modal should show 96 records
4. In detail table, select "SQL" from dropdown → should show 123 records
5. Select "SQO" → should show 96 records
6. Verify counts match exactly (tolerance: ±0)

**Q2 2025 (secondary validation)**:
- SQLs: 155
- SQOs: 110
- Joined: 13

**Test procedure**:
1. Set date range to Q2 2025 (Apr 1 - Jun 30, 2025)
2. Repeat validation steps above
3. Verify counts match exactly

## Implementation Order

1. **Phase 1**: Update scorecard click handlers to open drill-down modals
2. **Phase 2**: Update record details table to always show prospects (for filtering), default display to SQOs
3. **Phase 3**: Add stage dropdown and client-side filtering
4. **Phase 4**: Test and verify all functionality
5. **Phase 5**: Update any documentation or user guides

## Files to Modify (with specifics)

### 1. `src/app/dashboard/page.tsx`

| Line(s) | Current | Change To |
|---------|---------|-----------|
| 173-182 | `handleMetricClick` sets `metricFilter` | Open modal instead (see Phase 1.1) |
| 105 | `useState<'sql' \| 'sqo' \| 'joined' \| null>` | Add all metric types: `'prospect' \| 'contacted' \| 'mql' \| 'sql' \| 'sqo' \| 'joined' \| 'openPipeline' \| null` |
| 164 | `fetchDashboardData` depends on `selectedMetric` | Remove `selectedMetric` dependency, always use `metricFilter: 'prospect'` |
| NEW | - | Add `stageFilter` state (default: 'sqo') after line 97 |
| NEW | - | Add `availableOpportunityStages` useMemo |
| NEW | - | Add `filteredDetailRecords` useMemo |
| 285-308 | `getDetailDescription` function | Update to use `stageFilter` instead of `selectedMetric`, default to 'SQOs' |
| 437 | `DetailRecordsTable` props | Add `stageFilter`, `onStageFilterChange`, `availableOpportunityStages` props |

### 1a. `src/lib/queries/detail-records.ts`

| Line(s) | Current | Change To |
|---------|---------|-----------|
| 173-198 | SELECT only `${dateField} as relevant_date` | SELECT all stage-specific date fields (FilterDate, stage_entered_contacting__c, mql_stage_entered_ts, converted_date_raw, Date_Became_SQO__c, advisor_join_date__c) |
| 202-255 | Map only `relevantDate` | Map all date fields to DetailRecord (contactedDate, mqlDate, sqlDate, sqoDate, joinedDate) |

### 1b. `src/types/dashboard.ts`

| Line(s) | Current | Change To |
|---------|---------|-----------|
| 116-136 | `DetailRecord` interface has only `relevantDate` | Add `contactedDate`, `mqlDate`, `sqlDate`, `sqoDate`, `joinedDate` fields |

### 2. `src/components/dashboard/DetailRecordsTable.tsx`

| Change | Description |
|--------|-------------|
| Props interface (lines 16-25) | Add `stageFilter`, `onStageFilterChange`, `availableOpportunityStages` |
| UI (before search bar) | Add dropdown with SQO as first option, then other funnel stages, then opportunity stages in optgroup |
| Date column logic (lines 155-183) | Update to show stage-specific date based on `stageFilter` using `getDisplayDate()` helper |
| Date column description | Update `getDateColumnDescription()` to reflect stage-specific dates |
| Styling | Match existing filter dropdown styles from `GlobalFilters.tsx` |

### 3. `src/components/dashboard/VolumeDrillDownModal.tsx`

| Line | Current | Change To |
|------|---------|-----------|
| 16 | `metricFilter?: 'sql' \| 'sqo' \| 'joined'` | Add `'prospect' \| 'contacted' \| 'mql' \| 'openPipeline'` |

### 4. `src/components/dashboard/Scorecards.tsx`

| Change | Description |
|--------|-------------|
| Remove | `isSelected` function and usage |
| Remove | `ring-2 ring-blue-500` selection styling |
| Keep | `cursor-pointer` and `hover:bg-gray-50` |

### 5. `src/components/dashboard/FullFunnelScorecards.tsx`

Same changes as Scorecards.tsx

## Risk Assessment

### Performance Risks

**Volume Analysis** (Last 90 Days Data):
- Total Prospects: 23,456 records
- Typical quarter: ~15,000-25,000 prospects
- Current limit: 50,000 records

**Assessment**: 
- ✅ **Low Risk**: Loading 23,456 records is manageable for client-side filtering
- Client-side filtering is fast (boolean checks and string comparisons)
- Pagination (50 records per page) means only 50 records are rendered at a time
- Search and sort are already client-side, so adding stage filter is consistent

**Recommendation**: Monitor performance with larger datasets. If >30,000 records becomes slow, consider server-side filtering for stage dropdown.

### Data Completeness Risks

**Critical Finding**: ✅ **All Required Data Available**

- Prospect records include ALL boolean flags (`isContacted`, `isMql`, `isSql`, `isSqo`, `isJoined`, `isOpenPipeline`)
- StageName is available on opportunity-level records (825 out of 23,456 = 3.5%)
- All data needed for client-side filtering is present in the query results

**Assessment**: ✅ **No Data Completeness Issues**

The client-side filtering approach is viable because:
1. All boolean flags are returned in prospect queries
2. StageName is available for opportunity stages
3. No additional API calls needed

### Dependency Risks

**State Dependencies**:
- `fetchDashboardData` currently depends on `selectedMetric` (line 164)
- Removing this dependency is safe - we're always fetching prospects now
- No other callbacks depend on `selectedMetric` for data fetching

**Assessment**: ✅ **Low Risk**

Removing `selectedMetric` from `fetchDashboardData` dependencies is safe and will not break anything.

## Rollback Plan

If issues occur during implementation:

1. **Revert `handleMetricClick`**: Restore original implementation that sets `metricFilter` in filters
2. **Revert `fetchDashboardData`**: Restore `selectedMetric` dependency
3. **Remove stage filter state**: Remove `stageFilter`, `availableOpportunityStages`, and `filteredDetailRecords`
4. **Revert `DetailRecordsTable`**: Remove stage dropdown props and UI
5. **Revert `VolumeDrillDownModal`**: Restore original type to `'sql' | 'sqo' | 'joined'`

**Git Commands**:
```bash
git checkout HEAD -- src/app/dashboard/page.tsx
git checkout HEAD -- src/components/dashboard/Scorecards.tsx
git checkout HEAD -- src/components/dashboard/FullFunnelScorecards.tsx
git checkout HEAD -- src/components/dashboard/DetailRecordsTable.tsx
git checkout HEAD -- src/components/dashboard/VolumeDrillDownModal.tsx
```

## Deployment Notes

- **No cache invalidation needed**: Changes are client-side only
- **No database migrations needed**: Using existing query structure
- **No API changes needed**: Using existing endpoints
- **Build requirements**: Standard Next.js build process
- **Testing**: Manual testing required for all scorecard clicks and stage filter combinations

## Notes

- The stage filter is **client-side only** - no additional API calls needed
- All records are loaded once as prospects, then filtered in memory
- This approach is efficient because prospects is the largest dataset, and filtering down is fast
- The drill-down modals fetch their own data to ensure accuracy for each metric
- Opportunity stages are dynamically extracted from the loaded records, so they'll always match what's available
- **Default stage is SQO** (not Prospects) per user requirement - SGAs focus on middle-funnel deals
- **Date column shows stage-specific dates** based on selected filter:
  - SQO → Date_Became_SQO__c
  - SQL → converted_date_raw
  - Joined → advisor_join_date__c
  - Contacted → stage_entered_contacting__c
  - MQL → mql_stage_entered_ts
  - Prospects → FilterDate
- Stage filter does NOT persist across filter changes (resets to 'sqo') - this may be a future enhancement

## Future Enhancements (Optional)

1. **Persist Stage Filter**: Save selected stage filter in URL params or localStorage
2. **Multi-Select Stage Filter**: Allow selecting multiple stages at once
3. **Stage Filter in Drill-Down**: Add stage filter dropdown to drill-down modals as well
4. **Quick Filters**: Add quick filter buttons for common stage combinations
5. **Stage Statistics**: Show count of records for each stage in the dropdown
6. **Server-Side Stage Filtering**: If volume grows >30,000, consider server-side filtering for better performance
7. **Dynamic Date Column**: ✅ **IMPLEMENTED** - Date column now shows stage-specific dates based on filter selection
