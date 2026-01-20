# Funnel Performance Enhancement - Implementation Guide

## Overview

This document provides step-by-step instructions for implementing the Funnel Performance Dashboard enhancement. Each step includes a Cursor.ai prompt, exact code to implement, and verification gates.

**Feature Summary:**
- Scorecard clicks open drill-down modals (instead of filtering the detail table)
- Detail table has its own stage dropdown filter (defaults to SQO)
- Remove scorecard selection highlighting
- Support all funnel stages + opportunity stages in filtering
- **Date column shows stage-specific dates** (e.g., Date_Became_SQO__c for SQOs, converted_date_raw for SQLs) - **This requires query and interface updates (Phase 5)**

---

## Pre-Implementation Checklist

Before starting, verify your environment:

```bash
# 1. Ensure you're on a clean branch
git status
git checkout -b feature/funnel-performance-enhancement

# 2. Verify build passes
npm run build

# 3. Verify no type errors
npx tsc --noEmit

# 4. Start dev server (keep running in separate terminal)
npm run dev
```

**Expected**: All commands pass without errors.

---

## Phase 1: Expand VolumeDrillDownModal Type Support

### Step 1.1: Update VolumeDrillDownModal Props Interface

**Cursor Prompt:**
```
Open src/components/dashboard/VolumeDrillDownModal.tsx

Find the VolumeDrillDownModalProps interface (around line 10-20).

Update the metricFilter prop type to support all funnel stages.
```

**Current Code:**
```typescript
interface VolumeDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: DetailRecord[];
  title: string;
  loading: boolean;
  error: string | null;
  onRecordClick: (recordId: string) => void;
  metricFilter?: 'sql' | 'sqo' | 'joined';
  canExport?: boolean;
}
```

**Replace With:**
```typescript
interface VolumeDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: DetailRecord[];
  title: string;
  loading: boolean;
  error: string | null;
  onRecordClick: (recordId: string) => void;
  metricFilter?: 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
  canExport?: boolean;
}
```

### Step 1.1 Verification

```bash
# Check for type errors
npx tsc --noEmit

# Expected: No errors (or only pre-existing errors unrelated to this change)
```

---

## Phase 2: Update Dashboard Page State

### Step 2.1: Update volumeDrillDownMetric State Type

**Cursor Prompt:**
```
Open src/app/dashboard/page.tsx

Find the volumeDrillDownMetric useState declaration (search for "volumeDrillDownMetric").

Update its type to support all funnel stages.
```

**Find This Code:**
```typescript
const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<'sql' | 'sqo' | 'joined' | null>(null);
```

**Replace With:**
```typescript
const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<
  'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline' | null
>(null);
```

### Step 2.2: Add Stage Filter State

**Cursor Prompt:**
```
In src/app/dashboard/page.tsx, add new state for the stage filter dropdown.

Add this near the other useState declarations (after volumeDrillDownMetric state).
```

**Add This Code:**
```typescript
// Stage filter for DetailRecordsTable (defaults to SQO - middle funnel focus)
const [stageFilter, setStageFilter] = useState<string>('sqo');
```

### Step 2.3: Add Available Opportunity Stages Memo

**Cursor Prompt:**
```
In src/app/dashboard/page.tsx, add a useMemo to extract unique opportunity stages from loaded records.

Add this after the state declarations, before the useCallback functions.
```

**Add This Code:**
```typescript
// Extract unique opportunity stages from loaded detail records
const availableOpportunityStages = useMemo(() => {
  if (!detailRecords || detailRecords.length === 0) return [];
  
  const stages = new Set<string>();
  const funnelStages = ['Prospect', 'Contacted', 'MQL', 'SQL', 'SQO', 'Joined', 'Open Pipeline'];
  
  detailRecords.forEach(record => {
    if (record.stage && !funnelStages.includes(record.stage)) {
      stages.add(record.stage);
    }
  });
  
  // Sort alphabetically
  return Array.from(stages).sort();
}, [detailRecords]);
```

### Step 2.4: Add Filtered Detail Records Memo

**Cursor Prompt:**
```
In src/app/dashboard/page.tsx, add a useMemo to filter detail records based on the stage filter.

Add this right after the availableOpportunityStages memo.
```

**Add This Code:**
```typescript
// Filter detail records based on stage filter selection
const filteredDetailRecords = useMemo(() => {
  if (!detailRecords || detailRecords.length === 0) return [];
  
  return detailRecords.filter(record => {
    switch (stageFilter) {
      case 'prospect':
        return true; // All records are prospects
      case 'contacted':
        return record.isContacted === true;
      case 'mql':
        return record.isMql === true;
      case 'sql':
        return record.isSql === true;
      case 'sqo':
        return record.isSqo === true;
      case 'joined':
        return record.isJoined === true;
      case 'openPipeline':
        return record.isOpenPipeline === true;
      default:
        // Handle opportunity stage names (e.g., "Discovery", "Qualifying")
        return record.stage === stageFilter;
    }
  });
}, [detailRecords, stageFilter]);
```

### Step 2.5 Verification

```bash
# Check for type errors
npx tsc --noEmit

# Check for linting errors
npm run lint

# Expected: No new errors
```

---

## Phase 3: Update handleMetricClick Function

### Step 3.1: Replace handleMetricClick Implementation

**Cursor Prompt:**
```
In src/app/dashboard/page.tsx, find the handleMetricClick function.

Replace it entirely with a new implementation that opens the drill-down modal instead of filtering the table.
```

**Find This Code:**
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

**Replace With:**
```typescript
const handleMetricClick = async (metric: string) => {
  // Open drill-down modal instead of filtering the main table
  // Clear any previous selection state (no visual highlighting)
  setSelectedMetric(null);
  
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
  
  const metricFilter = metricMap[metric];
  if (!metricFilter) {
    console.warn(`Unknown metric: ${metric}`);
    return;
  }
  
  // Set modal state
  setVolumeDrillDownMetric(metricFilter);
  setVolumeDrillDownLoading(true);
  setVolumeDrillDownError(null);
  setVolumeDrillDownOpen(true);
  
  // Build title with metric name and date range
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
    : filters.datePreset?.toUpperCase() || 'Selected Period';
  
  setVolumeDrillDownTitle(`${metricLabels[metricFilter]} - ${dateRangeText}`);
  
  try {
    // Build filters for the drill-down query
    const drillDownFilters: DashboardFilters = {
      ...filters,
      metricFilter: metricFilter,
    };
    
    // Fetch records for the selected metric
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

### Step 3.2 Verification

```bash
# Check for type errors
npx tsc --noEmit

# Check for linting errors  
npm run lint

# Expected: No new errors
```

---

## Phase 4: Update fetchDashboardData

### Step 4.1: Always Fetch SQO Records for Detail Table

**Cursor Prompt:**
```
In src/app/dashboard/page.tsx, find the fetchDashboardData function.

Find where it builds currentFilters for the detail records query.

Change metricFilter from using selectedMetric to always fetching 'sqo' (or all prospects for client-side filtering).
```

**Find This Section (inside fetchDashboardData):**
```typescript
const currentFilters: DashboardFilters = {
  ...filters,
  startDate: dateRange.startDate,
  endDate: dateRange.endDate,
  metricFilter: (selectedMetric || 'all') as DashboardFilters['metricFilter'],
};
```

**Replace With:**
```typescript
const currentFilters: DashboardFilters = {
  ...filters,
  startDate: dateRange.startDate,
  endDate: dateRange.endDate,
  // Always fetch all records (prospects) for client-side filtering via stage dropdown
  metricFilter: 'prospect' as DashboardFilters['metricFilter'],
};
```

### Step 4.2: Remove selectedMetric from Dependencies

**Cursor Prompt:**
```
In src/app/dashboard/page.tsx, find the useCallback dependency array for fetchDashboardData.

Remove selectedMetric from the dependencies since we no longer use it for data fetching.
```

**Find This:**
```typescript
}, [filters, selectedMetric, trendGranularity, trendMode, filterOptions, viewMode]);
```

**Replace With:**
```typescript
}, [filters, trendGranularity, trendMode, filterOptions, viewMode]);
```

### Step 4.3 Verification

```bash
# Check for type errors
npx tsc --noEmit

# Check for linting errors
npm run lint

# Build to catch any runtime issues
npm run build

# Expected: All pass
```

---

## Phase 5: Update Query to Include Stage-Specific Dates

**⚠️ Implementation Order**: 
1. **Step 5.1**: Update SELECT clause (can be done first)
2. **Step 5.2**: Update RawDetailRecordResult interface (do this BEFORE Step 5.3)
3. **Step 5.3**: Update query mapping (needs Step 5.2 done first)
4. **Step 5.4**: Update DetailRecord interface (can be done anytime, but do before Step 6.4)

### Step 5.1: Update Detail Records Query to SELECT All Date Fields

**Cursor Prompt:**
```
Open src/lib/queries/detail-records.ts

Find the SELECT statement in the query (around line 173-198).

Add all stage-specific date fields to the SELECT clause so we can display the correct date based on stage filter.
```

**Find This SELECT (around line 173-198):**
```typescript
const query = `
  SELECT
    v.primary_key as id,
    v.advisor_name,
    v.Original_source as source,
    COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
    v.StageName as stage,
    v.SGA_Owner_Name__c as sga,
    v.SGM_Owner_Name__c as sgm,
    v.Opportunity_AUM as aum,
    v.salesforce_url,
    ${dateField} as relevant_date,
    v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
    v.Qualification_Call_Date__c as qualification_call_date,
    v.is_contacted,
    v.is_mql,
    v.is_sql,
    v.is_sqo_unique as is_sqo,
    v.is_joined_unique as is_joined
  FROM \`${FULL_TABLE}\` v
  LEFT JOIN \`${MAPPING_TABLE}\` nm
    ON v.Original_source = nm.original_source
  ${whereClause}
  ORDER BY v.Opportunity_AUM DESC NULLS LAST
  LIMIT @limit
`;
```

**Replace With:**
```typescript
const query = `
  SELECT
    v.primary_key as id,
    v.advisor_name,
    v.Original_source as source,
    COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
    v.StageName as stage,
    v.SGA_Owner_Name__c as sga,
    v.SGM_Owner_Name__c as sgm,
    v.Opportunity_AUM as aum,
    v.salesforce_url,
    v.FilterDate as filter_date,
    v.stage_entered_contacting__c as contacted_date,
    v.mql_stage_entered_ts as mql_date,
    v.converted_date_raw as sql_date,
    v.Date_Became_SQO__c as sqo_date,
    v.advisor_join_date__c as joined_date,
    v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
    v.Qualification_Call_Date__c as qualification_call_date,
    v.is_contacted,
    v.is_mql,
    v.is_sql,
    v.is_sqo_unique as is_sqo,
    v.is_joined_unique as is_joined
  FROM \`${FULL_TABLE}\` v
  LEFT JOIN \`${MAPPING_TABLE}\` nm
    ON v.Original_source = nm.original_source
  ${whereClause}
  ORDER BY v.Opportunity_AUM DESC NULLS LAST
  LIMIT @limit
`;
```

**Important Notes**: 
- The `dateField` variable (lines 63-169) is still used for WHERE clause date filtering - **DO NOT REMOVE** this logic
- We're adding additional date fields to the SELECT, but the WHERE clause still uses `dateField` for filtering
- The SELECT now includes all date fields so we can display stage-specific dates in the UI

### Step 5.2: Update RawDetailRecordResult Interface (Do This First)

**⚠️ Do this BEFORE Step 5.3** to avoid TypeScript errors when updating the query mapping.

**Cursor Prompt:**
```
Open src/types/bigquery-raw.ts

Find the RawDetailRecordResult interface (around line 60-79).

Add the new stage-specific date fields that will be returned from the query.
```

**Find This Interface:**
```typescript
export interface RawDetailRecordResult {
  id: string;
  advisor_name: string | null;
  source: string | null;
  channel: string | null;
  stage: string | null;
  sga: string | null;
  sgm: string | null;
  aum: number | null;
  salesforce_url: string | null;
  filter_date?: { value: string } | null;
  relevant_date?: string | { value: string } | null;
  initial_call_scheduled_date?: string | { value: string } | null;
  qualification_call_date?: string | { value: string } | null;
  is_contacted: number;
  is_mql: number;
  is_sql: number;
  is_sqo: number;
  is_joined: number;
}
```

**Replace With:**
```typescript
export interface RawDetailRecordResult {
  id: string;
  advisor_name: string | null;
  source: string | null;
  channel: string | null;
  stage: string | null;
  sga: string | null;
  sgm: string | null;
  aum: number | null;
  salesforce_url: string | null;
  filter_date?: string | { value: string } | null;
  contacted_date?: string | { value: string } | null; // stage_entered_contacting__c (TIMESTAMP)
  mql_date?: string | { value: string } | null; // mql_stage_entered_ts (TIMESTAMP)
  sql_date?: string | { value: string } | null; // converted_date_raw (DATE)
  sqo_date?: string | { value: string } | null; // Date_Became_SQO__c (TIMESTAMP)
  joined_date?: string | { value: string } | null; // advisor_join_date__c (DATE)
  relevant_date?: string | { value: string } | null; // Legacy - keep for backward compatibility
  initial_call_scheduled_date?: string | { value: string } | null;
  qualification_call_date?: string | { value: string } | null;
  is_contacted: number;
  is_mql: number;
  is_sql: number;
  is_sqo: number;
  is_joined: number;
}
```

### Step 5.3: Update Date Field Mapping

**Cursor Prompt:**
```
In src/lib/queries/detail-records.ts, find the return results.map() section (around line 202-255).

Update it to extract and map all stage-specific date fields.
```

**Find This Section:**
```typescript
return results.map(r => {
  // Extract date value - handle both DATE and TIMESTAMP types, and both field names
  let dateValue = '';
  const dateField = r.relevant_date || r.filter_date;
  if (dateField) {
    if (typeof dateField === 'object' && dateField.value) {
      dateValue = dateField.value;
    } else if (typeof dateField === 'string') {
      dateValue = dateField;
    }
  }
  
  // ... rest of mapping
  return {
    // ...
    relevantDate: dateValue,
    // ...
  };
});
```

**Replace With:**
```typescript
return results.map(r => {
  // Helper function to extract date values (handles both DATE and TIMESTAMP types)
  // BigQuery returns DATE fields as strings, TIMESTAMP fields as objects with .value
  const extractDate = (field: any): string | null => {
    if (!field) return null;
    if (typeof field === 'string') return field;
    if (typeof field === 'object' && field.value) return field.value;
    return null;
  };
  
  // Extract all date fields
  // Note: FilterDate, stage_entered_contacting__c, mql_stage_entered_ts, Date_Became_SQO__c are TIMESTAMP
  // converted_date_raw and advisor_join_date__c are DATE
  const filterDate = extractDate(r.filter_date) || '';
  const contactedDate = extractDate(r.contacted_date);
  const mqlDate = extractDate(r.mql_date);
  const sqlDate = extractDate(r.sql_date); // DATE field
  const sqoDate = extractDate(r.sqo_date);
  const joinedDate = extractDate(r.joined_date); // DATE field
  
  // Extract Initial Call Scheduled Date (DATE field - direct string)
  let initialCallDate: string | null = null;
  if (r.initial_call_scheduled_date) {
    if (typeof r.initial_call_scheduled_date === 'string') {
      initialCallDate = r.initial_call_scheduled_date;
    } else if (typeof r.initial_call_scheduled_date === 'object' && r.initial_call_scheduled_date.value) {
      initialCallDate = r.initial_call_scheduled_date.value;
    }
  }
  
  // Extract Qualification Call Date (DATE field - direct string)
  let qualCallDate: string | null = null;
  if (r.qualification_call_date) {
    if (typeof r.qualification_call_date === 'string') {
      qualCallDate = r.qualification_call_date;
    } else if (typeof r.qualification_call_date === 'object' && r.qualification_call_date.value) {
      qualCallDate = r.qualification_call_date.value;
    }
  }
  
  return {
    id: toString(r.id),
    advisorName: toString(r.advisor_name) || 'Unknown',
    source: toString(r.source) || 'Unknown',
    channel: toString(r.channel) || 'Unknown',
    stage: toString(r.stage) || 'Unknown',
    sga: r.sga ? toString(r.sga) : null,
    sgm: r.sgm ? toString(r.sgm) : null,
    aum: toNumber(r.aum),
    aumFormatted: formatCurrency(r.aum),
    salesforceUrl: toString(r.salesforce_url) || '',
    relevantDate: filterDate, // FilterDate as fallback
    contactedDate: contactedDate,
    mqlDate: mqlDate,
    sqlDate: sqlDate,
    sqoDate: sqoDate,
    joinedDate: joinedDate,
    initialCallScheduledDate: initialCallDate,
    qualificationCallDate: qualCallDate,
    isContacted: r.is_contacted === 1,
    isMql: r.is_mql === 1,
    isSql: r.is_sql === 1,
    isSqo: r.is_sqo === 1,
    isJoined: r.is_joined === 1,
    isOpenPipeline: OPEN_PIPELINE_STAGES.includes(toString(r.stage)),
  };
});
```

### Step 5.4: Update DetailRecord Interface

**Cursor Prompt:**
```
Open src/types/dashboard.ts

Find the DetailRecord interface (around line 116-136).

Add the new stage-specific date fields.
```

**Find This Interface:**
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
  relevantDate: string; // The relevant date field based on metric filter
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

**Replace With:**
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
  relevantDate: string; // FilterDate (fallback)
  contactedDate: string | null; // stage_entered_contacting__c
  mqlDate: string | null; // mql_stage_entered_ts
  sqlDate: string | null; // converted_date_raw
  sqoDate: string | null; // Date_Became_SQO__c
  joinedDate: string | null; // advisor_join_date__c
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

### Step 5.5 Verification

```bash
# Check for type errors
npx tsc --noEmit

# Check for linting errors
npm run lint

# Expected: No new errors
```

---

## Phase 6: Update DetailRecordsTable Component

### Step 6.1: Update Props Interface

**Cursor Prompt:**
```
Open src/components/dashboard/DetailRecordsTable.tsx

Find the DetailRecordsTableProps interface and add the new props for stage filtering.
```

**Find This Interface:**
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

**Replace With:**
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
  // New props for stage filter dropdown
  stageFilter?: string;
  onStageFilterChange?: (stage: string) => void;
  availableOpportunityStages?: string[];
}
```

### Step 6.2: Destructure New Props

**Cursor Prompt:**
```
In src/components/dashboard/DetailRecordsTable.tsx, find the component function declaration and destructure the new props.
```

**Find the destructuring:**
```typescript
export function DetailRecordsTable({
  records,
  title = 'Records',
  filterDescription,
  canExport = false,
  viewMode = 'focused',
  advancedFilters,
  metricFilter,
  onRecordClick,
}: DetailRecordsTableProps) {
```

**Replace With:**
```typescript
export function DetailRecordsTable({
  records,
  title = 'Records',
  filterDescription,
  canExport = false,
  viewMode = 'focused',
  advancedFilters,
  metricFilter,
  onRecordClick,
  stageFilter = 'sqo',
  onStageFilterChange,
  availableOpportunityStages = [],
}: DetailRecordsTableProps) {
```

### Step 6.3: Add Stage Dropdown UI

**Cursor Prompt:**
```
In src/components/dashboard/DetailRecordsTable.tsx, find the section with the search input.

Add a stage filter dropdown BEFORE the search input, in a flex container.
```

**Find the search section (around line 317-378):**
```typescript
{/* Search Input */}
<div className="mb-4">
  {/* Search Field Selector */}
  <div className="flex items-center gap-2 mb-2">
    <span className="text-sm text-gray-600 dark:text-gray-400">Search by:</span>
    <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
      {/* ... search field buttons ... */}
    </div>
  </div>
  
  <div className="relative">
    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
    <TextInput
      type="text"
      placeholder={getPlaceholderText(searchField)}
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      className="pl-10 pr-10"
    />
    {/* ... clear button ... */}
  </div>
  {/* ... search results message ... */}
</div>
```

**Replace With:**
```typescript
{/* Stage Filter Dropdown - Add BEFORE the search section */}
<div className="mb-4">
  <div className="flex items-center gap-2">
    <label 
      htmlFor="stage-filter" 
      className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap"
    >
      Stage:
    </label>
    <select
      id="stage-filter"
      value={stageFilter}
      onChange={(e) => onStageFilterChange?.(e.target.value)}
      className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[160px]"
    >
      <optgroup label="Funnel Stages">
        <option value="sqo">SQO</option>
        <option value="prospect">Prospects</option>
        <option value="contacted">Contacted</option>
        <option value="mql">MQL</option>
        <option value="sql">SQL</option>
        <option value="joined">Joined</option>
        <option value="openPipeline">Open Pipeline</option>
      </optgroup>
      {availableOpportunityStages.length > 0 && (
        <optgroup label="Opportunity Stages">
          {availableOpportunityStages.map(stage => (
            <option key={stage} value={stage}>{stage}</option>
          ))}
        </optgroup>
      )}
    </select>
  </div>
</div>

{/* Search Input - Keep existing structure, no changes needed */}
<div className="mb-4">
  {/* ... existing search field selector and input ... */}
</div>
```

### Step 6.4: Update Date Column Display Logic

**Cursor Prompt:**
```
In src/components/dashboard/DetailRecordsTable.tsx, find the getDateColumnDescription function (around line 155-183).

Update it to show stage-specific dates based on stageFilter instead of metricFilter.

Also find where the date column is rendered in the table and update it to use a helper function that selects the correct date field.
```

**Add the getDisplayDate helper function BEFORE getDateColumnDescription (around line 154):**
```typescript
// Helper function to get the display date based on stage filter
const getDisplayDate = (record: DetailRecord): string => {
  // Check advanced filters first (they take precedence)
  if (advancedFilters?.initialCallScheduled?.enabled) {
    return record.initialCallScheduledDate || record.relevantDate || '';
  }
  if (advancedFilters?.qualificationCallDate?.enabled) {
    return record.qualificationCallDate || record.relevantDate || '';
  }
  
  // Then check stage filter
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
```

**Find the getDateColumnDescription function (around line 155-183):**
```typescript
const getDateColumnDescription = (): string => {
  // Check advanced filters first
  if (advancedFilters?.initialCallScheduled?.enabled) {
    return 'Shows the Initial Call Scheduled Date for each record. This is the date when the initial call was scheduled, regardless of when they entered other stages.';
  }
  if (advancedFilters?.qualificationCallDate?.enabled) {
    return 'Shows the Opportunity Created Date for each record. This is the date when the opportunity was created, filtered by Qualification Call Date.';
  }
  
  // Then check metric filter
  switch (metricFilter) {
    case 'prospect':
      return 'Shows the Filter Date (cohort date) for each prospect. This is the date when they became a prospect in the system.';
    case 'contacted':
      return 'Shows the date when each person entered the Contacting stage. This is when they were first contacted.';
    // ... other cases
  }
};
```

**Replace With:**
```typescript
const getDateColumnDescription = (): string => {
  // Check advanced filters first
  if (advancedFilters?.initialCallScheduled?.enabled) {
    return 'Shows the Initial Call Scheduled Date for each record. This is the date when the initial call was scheduled, regardless of when they entered other stages.';
  }
  if (advancedFilters?.qualificationCallDate?.enabled) {
    return 'Shows the Opportunity Created Date for each record. This is the date when the opportunity was created, filtered by Qualification Call Date.';
  }
  
  // Then check stage filter (not metricFilter)
  switch (stageFilter) {
    case 'prospect':
      return 'Shows the Filter Date (cohort date) for each prospect. This is the date when they became a prospect in the system.';
    case 'contacted':
      return 'Shows the date when each person entered the Contacting stage. This is when they were first contacted.';
    case 'mql':
      return 'Shows the date when each person became an MQL (Marketing Qualified Lead). This is when they entered the Call Scheduled stage.';
    case 'sql':
      return 'Shows the conversion date for each SQL (Sales Qualified Lead). This is when they converted from MQL to SQL.';
    case 'sqo':
      return 'Shows the date when each person became an SQO (Sales Qualified Opportunity). This is when they entered the SQO stage.';
    case 'joined':
      return 'Shows the advisor join date for each person who joined. This is when they officially joined as an advisor.';
    case 'openPipeline':
      return 'Shows the Filter Date for open pipeline records. These are current opportunities in active stages.';
    default:
      // Opportunity stages - show FilterDate
      return 'Shows the Filter Date (cohort date) for each record.';
  }
};
```

**Find the date column rendering (around line 388-430):**
```typescript
<TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
  {record.relevantDate ? formatDate(record.relevantDate) : '-'}
</TableCell>
```

**Replace With:**
```typescript
<TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
  {getDisplayDate(record) ? formatDate(getDisplayDate(record)) : '-'}
</TableCell>
```

### Step 6.5 Verification

```bash
# Check for type errors
npx tsc --noEmit

# Check for linting errors
npm run lint

# Expected: No new errors
```

---

## Phase 7: Update Dashboard Page to Use New Props

### Step 7.1: Update DetailRecordsTable Usage

**Cursor Prompt:**
```
In src/app/dashboard/page.tsx, find where DetailRecordsTable is rendered.

Update it to pass the new stage filter props and use filteredDetailRecords instead of detailRecords.
```

**Find This:**
```typescript
<DetailRecordsTable
  records={detailRecords}
  title="Record Details"
  filterDescription={getDetailDescription()}
  canExport={permissions?.canExport ?? false}
  viewMode={viewMode}
  advancedFilters={filters.advancedFilters}
  metricFilter={filters.metricFilter}
  onRecordClick={handleRecordClick}
/>
```

**Replace With:**
```typescript
<DetailRecordsTable
  records={filteredDetailRecords}
  title="Record Details"
  filterDescription={getDetailDescription()}
  canExport={permissions?.canExport ?? false}
  viewMode={viewMode}
  advancedFilters={filters.advancedFilters}
  metricFilter="prospect"
  onRecordClick={handleRecordClick}
  stageFilter={stageFilter}
  onStageFilterChange={setStageFilter}
  availableOpportunityStages={availableOpportunityStages}
/>
```

### Step 7.2: Update getDetailDescription Function

**Cursor Prompt:**
```
In src/app/dashboard/page.tsx, find the getDetailDescription function.

Update it to reflect the stage filter instead of selectedMetric.
```

**Find This Function (around line 285-308):**
```typescript
const getDetailDescription = () => {
  const parts = [];
  if (selectedMetric) {
    const metricLabels: Record<string, string> = {
      prospect: 'Prospects',
      contacted: 'Contacted',
      mql: 'MQLs',
      sql: 'SQLs',
      sqo: 'SQOs',
      joined: 'Joined',
      openPipeline: 'Open Pipeline',
    };
    parts.push(metricLabels[selectedMetric] || selectedMetric.toUpperCase());
  }
  if (selectedChannel) parts.push(`Channel: ${selectedChannel}`);
  if (selectedSource) parts.push(`Source: ${selectedSource}`);
  
  if (parts.length > 0) {
    return `Filtered by: ${parts.join(', ')}`;
  }
  
  // Default description based on view mode
  return viewMode === 'fullFunnel' ? 'All Records' : 'All SQLs';
};
```

**Replace With:**
```typescript
const getDetailDescription = () => {
  const parts = [];
  
  // Add stage filter to description (replaces selectedMetric)
  const stageLabels: Record<string, string> = {
    prospect: 'Prospects',
    contacted: 'Contacted',
    mql: 'MQLs',
    sql: 'SQLs',
    sqo: 'SQOs',
    joined: 'Joined',
    openPipeline: 'Open Pipeline',
  };
  const stageLabel = stageLabels[stageFilter] || stageFilter;
  parts.push(stageLabel);
  
  if (selectedChannel) parts.push(`Channel: ${selectedChannel}`);
  if (selectedSource) parts.push(`Source: ${selectedSource}`);
  
  if (parts.length > 0) {
    return `Filtered by: ${parts.join(', ')}`;
  }
  
  // Default to SQOs (since that's the default stage filter)
  return 'All SQOs';
};
```

### Step 7.3 Verification

```bash
# Check for type errors
npx tsc --noEmit

# Check for linting errors
npm run lint

# Build the project
npm run build

# Expected: All pass
```

---

## Phase 8: Remove Scorecard Selection Highlighting

### Step 8.1: Update Scorecards Component

**Cursor Prompt:**
```
Open src/components/dashboard/Scorecards.tsx

Remove the selection highlighting logic. Cards should still be clickable but not show a selected state.

Find all instances of isSelected and the ring-2 ring-blue-500 selection styling.
```

**Find This Pattern (repeated for each card):**
```typescript
<Card 
  className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
    onMetricClick 
      ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
          isSelected('sql') 
            ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
            : ''
        }` 
      : ''
  }`}
  onClick={() => onMetricClick?.('sql')}
>
```

**Replace With (for each card):**
```typescript
<Card 
  className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
    onMetricClick 
      ? 'cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 hover:shadow-md' 
      : ''
  }`}
  onClick={() => onMetricClick?.('sql')}
>
```

**Also remove the isSelected function:**
```typescript
// DELETE THIS LINE:
const isSelected = (id: string) => selectedMetric === id;
```

**And remove selectedMetric from props destructuring if it's only used for highlighting:**
```typescript
// If selectedMetric is no longer needed, you can remove it from destructuring
// But keep it if it's used elsewhere - just don't use it for styling
```

### Step 8.2: Update FullFunnelScorecards Component

**Cursor Prompt:**
```
Open src/components/dashboard/FullFunnelScorecards.tsx

Apply the same changes as Scorecards.tsx - remove selection highlighting but keep click functionality.
```

**Apply the same pattern changes:**
1. Remove `isSelected` function
2. Remove `ring-2 ring-blue-500` and `bg-blue-50` conditional classes
3. Keep `cursor-pointer`, `hover:bg-gray-50`, and `hover:shadow-md`

### Step 8.3 Verification

```bash
# Check for type errors
npx tsc --noEmit

# Check for linting errors
npm run lint

# Build the project
npm run build

# Expected: All pass
```

---

## Phase 9: Functional Testing

### Step 9.1: Manual Testing Checklist

**Cursor Prompt:**
```
Start the dev server and manually test each feature:

npm run dev

Open http://localhost:3000/dashboard
```

**Test Each Item:**

```markdown
## Scorecard Click Tests
- [ ] Click "SQLs" scorecard → Modal opens with SQL records
- [ ] Click "SQOs" scorecard → Modal opens with SQO records  
- [ ] Click "Joined" scorecard → Modal opens with Joined records
- [ ] Click "Prospects" scorecard (Full Funnel view) → Modal opens with Prospects
- [ ] Click "Contacted" scorecard (Full Funnel view) → Modal opens with Contacted
- [ ] Click "MQLs" scorecard (Full Funnel view) → Modal opens with MQLs
- [ ] Scorecard does NOT show selection ring after clicking
- [ ] Main detail table does NOT change when scorecard clicked

## Modal Tests
- [ ] Modal shows correct record count in header
- [ ] Clicking a record in modal opens Record Detail Modal
- [ ] Back button in Record Detail returns to drill-down modal
- [ ] Closing modal (X or ESC) works correctly
- [ ] Modal loading state shows spinner
- [ ] Modal error state shows error message

## Stage Dropdown Tests
- [ ] Dropdown defaults to "SQO" on page load
- [ ] Selecting "Prospects" shows all records
- [ ] Selecting "Contacted" filters to contacted records
- [ ] Selecting "MQL" filters to MQL records
- [ ] Selecting "SQL" filters to SQL records
- [ ] Selecting "Joined" filters to joined records
- [ ] Selecting "Open Pipeline" filters to open pipeline records
- [ ] Selecting opportunity stage (e.g., "Discovery") filters correctly
- [ ] Dropdown shows opportunity stages in separate optgroup
- [ ] Filter description updates when stage changes
- [ ] Date column shows correct date for each stage:
  - [ ] SQO shows Date_Became_SQO__c
  - [ ] SQL shows converted_date_raw
  - [ ] Joined shows advisor_join_date__c
  - [ ] Contacted shows stage_entered_contacting__c
  - [ ] MQL shows mql_stage_entered_ts
  - [ ] Prospects shows FilterDate

## Integration Tests
- [ ] Changing date filter reloads data, dropdown still works
- [ ] Changing SGA/SGM filter reloads data, dropdown still works
- [ ] Search within filtered records works
- [ ] Pagination within filtered records works
- [ ] Export filtered records works
- [ ] Toggle between Focused/Full Funnel view works
```

### Step 9.2: BigQuery Validation

**Cursor Prompt (if MCP available):**
```
Run this query to validate record counts match the dashboard:

SELECT 
  COUNT(*) as total_prospects,
  COUNTIF(is_sql = 1) as sqls,
  COUNTIF(is_sqo_unique = 1) as sqos,
  COUNTIF(is_joined_unique = 1) as joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE FilterDate >= '2025-01-01' AND FilterDate <= '2025-03-31'
```

**Compare results with dashboard Q1 2025 values:**
- SQLs should be ~123
- SQOs should be ~96
- Joined should be ~12

---

## Phase 10: Final Verification

### Step 9.1: Complete Build Test

```bash
# Clean build
rm -rf .next
npm run build

# Expected: Build completes without errors
```

### Step 9.2: Type Check

```bash
npx tsc --noEmit

# Expected: No type errors
```

### Step 9.3: Lint Check

```bash
npm run lint

# Expected: No linting errors (or only pre-existing ones)
```

### Step 9.4: Commit Changes

```bash
# Stage all changes
git add -A

# Review changes
git status
git diff --staged

# Commit with descriptive message
git commit -m "feat: Scorecard drill-down modals and stage filter dropdown

- Scorecard clicks now open drill-down modal instead of filtering table
- Added stage filter dropdown to DetailRecordsTable (defaults to SQO)
- Removed scorecard selection highlighting
- Added support for all funnel stages in VolumeDrillDownModal
- Client-side filtering for stage dropdown (no additional API calls)
- Opportunity stages dynamically populated from data"
```

---

## Rollback Instructions

If issues occur, rollback with:

```bash
# Revert all changes
git checkout HEAD -- src/app/dashboard/page.tsx
git checkout HEAD -- src/components/dashboard/Scorecards.tsx
git checkout HEAD -- src/components/dashboard/FullFunnelScorecards.tsx
git checkout HEAD -- src/components/dashboard/DetailRecordsTable.tsx
git checkout HEAD -- src/components/dashboard/VolumeDrillDownModal.tsx
git checkout HEAD -- src/lib/queries/detail-records.ts
git checkout HEAD -- src/types/dashboard.ts

# Or reset entire branch
git reset --hard HEAD~1
```

---

## Troubleshooting

### Common Issues

**Issue: Type error on metricFilter**
```
Solution: Ensure VolumeDrillDownModal and DashboardFilters types are updated consistently
```

**Issue: filteredDetailRecords is undefined**
```
Solution: Ensure the useMemo is placed after detailRecords state is declared
```

**Issue: Dropdown not showing opportunity stages**
```
Solution: Verify detailRecords contains records with non-null stage field
Check: console.log(availableOpportunityStages) in browser console
```

**Issue: Modal not opening on scorecard click**
```
Solution: Verify handleMetricClick is properly connected to onMetricClick prop
Check: Add console.log at start of handleMetricClick
```

**Issue: Records not filtering correctly**
```
Solution: Verify DetailRecord interface includes boolean flags (isSql, isSqo, etc.)
Check: console.log(detailRecords[0]) to see available fields
```

**Issue: Date column shows wrong date**
```
Solution: Verify all date fields are being selected in the query
Check: console.log(detailRecords[0]) to see if contactedDate, mqlDate, sqlDate, sqoDate, joinedDate exist
Verify: getDisplayDate() function is using stageFilter (not metricFilter)
```

**Issue: Type error on date fields**
```
Solution: Ensure DetailRecord interface includes all new date fields (contactedDate, mqlDate, etc.)
Verify: src/types/dashboard.ts has been updated with all date fields
```

---

## Summary of Files Changed

| File | Changes |
|------|---------|
| `src/components/dashboard/VolumeDrillDownModal.tsx` | Updated metricFilter type to include all stages (line 16) |
| `src/app/dashboard/page.tsx` | Updated state (line 105), handleMetricClick (lines 173-182), fetchDashboardData (line 164), added memos, updated getDetailDescription (lines 285-308) |
| `src/lib/queries/detail-records.ts` | Added all stage-specific date fields to SELECT (lines 173-198) and mapping (lines 202-255) |
| `src/types/bigquery-raw.ts` | Added stage-specific date fields to RawDetailRecordResult interface (lines 60-79) |
| `src/types/dashboard.ts` | Added stage-specific date fields to DetailRecord interface (lines 116-136) |
| `src/components/dashboard/DetailRecordsTable.tsx` | Added stage dropdown props (lines 16-25), UI (before line 317), getDisplayDate helper, updated date column (line 437), updated sort (line 117) |
| `src/components/dashboard/Scorecards.tsx` | Removed selection highlighting (isSelected function and ring-2 classes) |
| `src/components/dashboard/FullFunnelScorecards.tsx` | Removed selection highlighting (isSelected function and ring-2 classes) |

---

## Success Criteria

✅ Scorecard clicks open modal (not filter table)
✅ Modal shows correct records for each metric
✅ Detail table has stage dropdown (defaults to SQO)
✅ Dropdown includes funnel stages + opportunity stages
✅ Client-side filtering works for all stages
✅ Date column shows stage-specific dates (SQO shows Date_Became_SQO__c, etc.)
✅ All date fields are loaded and available in DetailRecord
✅ No type errors
✅ No linting errors
✅ Build passes
✅ All manual tests pass
