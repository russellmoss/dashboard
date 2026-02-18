# SGM Conversion Table — Codebase Investigation Findings

> **Date**: 2026-02-17
> **Purpose**: Document findings from exploration phases to inform implementation

---

## Phase 1: Date Filter Pattern Investigation

### Finding 1: Date filter component location
**Answer**: The main date filter component is `GlobalFilters.tsx` at `src/components/dashboard/GlobalFilters.tsx:34-45`. It implements a DATE_PRESETS array with options: alltime, ytd, qtd, q1-q4, last30, last90, custom.
**Evidence**: `src/components/dashboard/GlobalFilters.tsx:34-45`

### Finding 2: Date filter state management
**Answer**: The `DashboardFilters` type (in `src/types/filters.ts:115-130`) stores `datePreset`, `year`, `startDate`, `endDate`. Quarter presets (q1-q4) show a year selector; custom preset shows start/end date inputs.
**Evidence**: `src/types/filters.ts:115-130`, `src/components/dashboard/GlobalFilters.tsx:256-300`

### Finding 3: Date filter reusability
**Answer**: `GlobalFilters` is NOT directly reusable for the By SGM tab — it's tightly coupled with the main dashboard's filter system (SGA/SGM/Channel/Source multi-selects). We need a **new, simpler SqlDateFilter component** that only handles date range selection.
**Evidence**: `GlobalFilters` accepts `DashboardFilters` and `FilterOptions` props with many unrelated fields.

### Finding 4: "All Time" representation
**Answer**: "All Time" is represented by `datePreset: 'alltime'`. When this preset is active, no date filtering is applied in queries.
**Evidence**: `src/components/dashboard/GlobalFilters.tsx:34` — `{ value: 'alltime', label: 'All Time' }`

---

## Phase 2: Query Layer & Data Availability

### Finding 1: Table/View used
**Answer**: All open-pipeline queries use `FULL_TABLE` constant which equals `'savvy-gtm-analytics.Tableau_Views.vw_funnel_master'`. This is the same view that has all conversion rate fields.
**Evidence**: `src/config/constants.ts:36`

### Finding 2: _getOpenPipelineBySgm current implementation
**Answer**: The function accepts `{ stages?: string[]; sgms?: string[] }` but has **NO date parameters**. It's a snapshot query with these conditions: `recordtypeid = @recruitingRecordType`, `StageName IN (...)`, `is_sqo_unique = 1`, `SGM_Owner_Name__c IS NOT NULL`.
**Evidence**: `src/lib/queries/open-pipeline.ts:413-479`

### Finding 3: converted_date_raw usage pattern
**Answer**: `converted_date_raw` is heavily used across the codebase for date-range filtering. The standard pattern is: `DATE(v.converted_date_raw) >= DATE(@startDate) AND DATE(v.converted_date_raw) <= DATE(@endDate)`.
**Evidence**: `src/lib/queries/funnel-metrics.ts:120-122`, `src/lib/queries/conversion-rates.ts:162-164`

### Finding 4: Conversion rate fields exist
**Answer**: All required fields exist in the view and are used elsewhere:
- `sql_to_sqo_progression` — numerator for SQL→SQO rate
- `sqo_to_joined_progression` — numerator for SQO→Joined rate
- `eligible_for_sql_conversions` — denominator for SQL→SQO rate
- `eligible_for_sqo_conversions` — denominator for SQO→Joined rate
- `is_sqo_unique`, `is_joined_unique`, `is_primary_opp_record` — dedup flags
**Evidence**: `src/lib/queries/export-records.ts:95-108`, `src/lib/queries/source-performance.ts:163-186`

### Finding 5: Query architecture recommendation
**Answer**: We need **two separate queries** — the chart query (GROUP BY SGM × Stage for stacked bars) and the table query (GROUP BY SGM for conversion counts/rates) have different aggregation structures. They should share the same date filter parameters.
**Evidence**: Chart query groups by SGM+Stage; table query groups only by SGM with different SELECT fields.

### Finding 6: View field definitions verified (from vw_funnel_master.sql)

| Field | Line | Definition | Data Type |
|-------|------|------------|-----------|
| `converted_date_raw` | 13, 262 | `ConvertedDate` from Lead (or `DATE(Stage_Entered_Re_Engaged__c)` for Re-Engagement) | DATE |
| `SGM_Owner_Name__c` | 253 | `Opportunity_Owner_Name__c` from Opportunity | STRING |
| `is_sql` | 279 | `CASE WHEN l.IsConverted IS TRUE THEN 1 ELSE 0 END` | INT |
| `is_sqo_unique` | 401-406 | SQO flag deduplicated (only first lead per opp) | INT |
| `is_joined_unique` | 410-415 | Joined flag deduplicated (only first lead per opp) | INT |
| `is_primary_opp_record` | 393-397 | `1` if first lead per opp OR lead-only record | INT |
| `sql_to_sqo_progression` | 564 | `CASE WHEN is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 1 ELSE 0 END` | INT |
| `sqo_to_joined_progression` | 567-570 | `1` if SQO and (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') | INT |
| `eligible_for_sql_conversions` | 523-533 | `1` if SQL and (became SQO OR Closed Lost) | INT |
| `eligible_for_sqo_conversions` | 536-542 | `1` if SQO and (Joined OR Closed Lost) | INT |
| `Opportunity_AUM` | 292 | `COALESCE(Underwritten_AUM__c, Amount)` | NUMERIC |
| `StageName` | 284 | `COALESCE(o.StageName, l.lead_StageName)` | STRING |

### Finding 7: SGM Attribution RESOLVED
**Answer**: `SGM_Owner_Name__c` reflects the **CURRENT opportunity owner**, not the owner at SQL time. The field comes from `Opportunity_Owner_Name__c` (line 180: `Opportunity_Owner_Name__c AS Opp_SGM_Name`), which is the current owner field in Salesforce.
**Impact**: If opportunities are reassigned between SGMs after SQL date, the conversion table will show data under the CURRENT SGM, not the SGM who received the SQL. This is consistent with how the existing pipeline chart works.
**Evidence**: `views/vw_funnel_master.sql:180,253`

### Finding 8: Deduplication strategy for SQL count
**Answer**: To count SQLs received, use `is_sql = 1 AND is_primary_opp_record = 1`. The `is_primary_opp_record` flag ensures we count each opportunity only once even when multiple leads converted to the same opp.
**Evidence**: `views/vw_funnel_master.sql:393-397` defines the flag; `src/lib/queries/funnel-metrics.ts:146` uses this pattern

---

## Phase 3: Table Component Patterns

### Finding 1: Sortable table pattern exists
**Answer**: `SourcePerformanceTable.tsx` provides a complete sortable table pattern with:
- `SortColumn` union type for column identifiers (line 15)
- `SortDirection` type: `'asc' | 'desc'` (line 16)
- `sortColumn`/`sortDirection` useState hooks (lines 121-122)
- `handleSort` function that toggles direction or sets new column (lines 137-148)
- `SortableHeader` inline component with ChevronUp/ChevronDown icons (lines 151-178)
- `sortSources` function for sorting logic (lines 62-112)

**Evidence**: `src/components/dashboard/SourcePerformanceTable.tsx:15-178`

### Finding 2: Table component library
**Answer**: Tables use **Tremor v3.18.7** components:
- `Table`, `TableHead`, `TableRow`, `TableHeaderCell`, `TableBody`, `TableCell` from `@tremor/react`
- Sort arrows: `ChevronUp`/`ChevronDown` from `lucide-react`
- Card wrapper: `Card` from `@tremor/react`

**Evidence**: `src/components/dashboard/SourcePerformanceTable.tsx:4,13`, `package.json:30`

### Finding 3: Number/percent formatting utilities
**Answer**: Available formatting functions in `@/lib/utils/date-helpers`:
- `formatPercent(value)` — multiplies by 100, adds `%`, 1 decimal (line 90-93)
- `formatNumber(value)` — uses `toLocaleString()` for thousands separators (lines 95-98)
- `formatCurrency(value)` — formats as $XXK, $XXM, $XXB (lines 73-79)
- `formatAumCompact(value)` — more precise AUM formatting with decimals (lines 82-88)

**Evidence**: `src/lib/utils/date-helpers.ts:73-98`

### Finding 4: Summary/Team Average row pattern
**Answer**: **NO existing pattern found.** Searched for "Team Average", "Total row", "Summary row" across all components. Existing tables (`SourcePerformanceTable`, `LeaderboardTable`, `DetailRecordsTable`) render only data rows without summary rows.

**Implementation approach**: Create a dedicated "Team Average" row at the bottom of the table with:
- Bold styling: `font-bold` or `font-semibold`
- Visual separation: `border-t-2` or different background color
- Computed averages calculated in the component using `useMemo`

**Evidence**: `src/components/dashboard/SourcePerformanceTable.tsx:283-358` shows no summary row; `LeaderboardTable.tsx` same pattern.

### Finding 5: SortableHeader component pattern (copy this)
```tsx
const SortableHeader = ({ column, children, alignRight = true }: {
  column: SortColumn;
  children: React.ReactNode;
  alignRight?: boolean
}) => {
  const isActive = sortColumn === column;
  const showAsc = isActive && sortDirection === 'asc';
  const showDesc = isActive && sortDirection === 'desc';

  return (
    <TableHeaderCell
      className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 ${alignRight ? 'text-right' : ''}`}
      onClick={() => handleSort(column)}
    >
      <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : ''}`}>
        {children}
        <div className="flex flex-col">
          <ChevronUp className={`w-3 h-3 ${showAsc ? 'text-blue-600' : 'text-gray-300'}`} />
          <ChevronDown className={`w-3 h-3 -mt-1 ${showDesc ? 'text-blue-600' : 'text-gray-300'}`} />
        </div>
      </div>
    </TableHeaderCell>
  );
};
```
**Evidence**: `src/components/dashboard/SourcePerformanceTable.tsx:151-178`

### Finding 6: PipelineBySgmChart component structure
**Answer**: The chart component:
- Props: `data: SgmPipelineChartData[]`, `selectedStages: string[]`, `onSegmentClick`, `onSgmClick`, `loading`
- Uses Recharts: `BarChart`, `Bar`, `XAxis`, `YAxis`, `Tooltip`, `Legend`, `ResponsiveContainer`
- Renders stacked bars for AUM and Count with stage colors from `STAGE_COLORS` constant
- Has clickable X-axis labels (SGM names) that trigger `onSgmClick`
- Does NOT fetch its own data — receives `data` prop from parent page

**Evidence**: `src/components/dashboard/PipelineBySgmChart.tsx:19-25,162-382`

### Finding 7: Row styling patterns
**Answer**: Tables use alternating zebra striping:
```tsx
const zebraClass = idx % 2 === 0
  ? 'bg-white dark:bg-gray-800'
  : 'bg-gray-50 dark:bg-gray-900';
```
Selected rows use: `bg-blue-50 dark:bg-blue-900/30`
Hover: `hover:bg-gray-100 dark:hover:bg-gray-700`

**Evidence**: `src/components/dashboard/SourcePerformanceTable.tsx:286-298`

---

## Phase 4: Conversion Rate Logic & View Fields

### Finding 1: Exact CASE statements for conversion fields

**SQL→SQO Numerator** (`sql_to_sqo_progression`, line 564):
```sql
CASE WHEN is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 1 ELSE 0 END
```

**SQL→SQO Denominator** (`eligible_for_sql_conversions`, lines 523-533):
```sql
CASE
  WHEN is_sql = 1 AND (
    LOWER(SQO_raw) = 'yes' OR      -- Became SQO (progress)
    StageName = 'Closed Lost'       -- Closed without becoming SQO
  )
  THEN 1
  -- Include direct opportunities (no linked lead) that became SQO
  WHEN Full_prospect_id__c IS NULL AND LOWER(SQO_raw) = 'yes'
  THEN 1
  ELSE 0
END
```

**SQO→Joined Numerator** (`sqo_to_joined_progression`, lines 567-570):
```sql
CASE
  WHEN LOWER(SQO_raw) = 'yes' AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
  THEN 1 ELSE 0
END
```

**SQO→Joined Denominator** (`eligible_for_sqo_conversions`, lines 536-542):
```sql
CASE
  WHEN LOWER(SQO_raw) = 'yes' AND (
    (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') OR
    StageName = 'Closed Lost'
  )
  THEN 1 ELSE 0
END
```

**Evidence**: `views/vw_funnel_master.sql:523-570`

### Finding 2: Two computation approaches exist

**Approach A: SQL-side with SAFE_DIVIDE** (source-performance.ts)
```sql
SAFE_DIVIDE(
  SUM(CASE WHEN [date conditions] THEN v.sql_to_sqo_progression ELSE 0 END),
  SUM(CASE WHEN [date conditions] THEN v.eligible_for_sql_conversions ELSE 0 END)
) as sql_to_sqo_rate
```
- Returns rate directly as decimal (0.0 to 1.0)
- SAFE_DIVIDE handles division by zero automatically
**Evidence**: `src/lib/queries/source-performance.ts:158-171`

**Approach B: Client-side division** (conversion-rates.ts)
```typescript
const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;
// Returns numerator and denominator from SQL, computes rate in JS
sqlToSqo: {
  rate: safeDiv(toNumber(result.sql_numer), toNumber(result.sql_denom)),
  ...
}
```
- More flexible for displaying "X / Y resolved" labels
- Better for debugging (can see raw counts)
**Evidence**: `src/lib/queries/conversion-rates.ts:331-339`

**Recommendation for SGM table**: Use Approach A (SQL-side) for simplicity, OR return raw counts and compute client-side if we want to show both rate and counts.

### Finding 3: Date field mapping for cohort filtering

From `conversion-rates.ts:36-42` documentation:

| Conversion | Cohort Date Field | Why |
|------------|-------------------|-----|
| SQL→SQO | `converted_date_raw` | Filter by when lead became SQL |
| SQO→Joined | `Date_Became_SQO__c` | Filter by when opp became SQO |

**Important for our table**: We want to filter by SQL date (`converted_date_raw`) for BOTH rates. This means:
- SQL→SQO rate: Filter records by `converted_date_raw` in range, sum progression/eligibility flags
- SQO→Joined rate: ALSO filter by `converted_date_raw` to see "of SQLs created in this period, what % eventually joined"

This is a **cohort-based view**: "Of SQLs created in Q1, what happened to them?"

**Evidence**: `src/lib/queries/conversion-rates.ts:36-42`

### Finding 4: Deduplication strategy

**For SQL count** (use both flags):
```sql
COUNT(CASE WHEN is_sql = 1 AND is_primary_opp_record = 1 THEN 1 END) as sqls_received
```
- `is_sql = 1`: Record became SQL (lead converted)
- `is_primary_opp_record = 1`: First lead per opportunity (dedupe multiple leads → same opp)

**For SQO count** (use unique flag):
```sql
COUNT(CASE WHEN is_sqo_unique = 1 THEN 1 END) as sqos
-- OR equivalently:
SUM(is_sqo_unique) as sqos
```

**For Joined count** (use unique flag):
```sql
COUNT(CASE WHEN is_joined_unique = 1 THEN 1 END) as joined
-- OR equivalently:
SUM(is_joined_unique) as joined
```

**Dedup flag definitions** (lines 393-415):
- `is_primary_opp_record`: 1 if lead-only record OR first lead per opportunity (by CreatedDate)
- `is_sqo_unique`: 1 if SQO AND (lead-only OR first lead per opp)
- `is_joined_unique`: 1 if Joined AND (lead-only OR first lead per opp)

**Evidence**: `views/vw_funnel_master.sql:393-415`

### Finding 5: Closed Lost timing consideration

**Question from exploration doc**: When we filter by `converted_date_raw` (SQL date), the denominator includes records that are "Closed Lost" — but what if they closed lost BEFORE the date range?

**Answer**: This is NOT a problem because:
1. `eligible_for_sql_conversions` requires `is_sql = 1` (the record must have become SQL)
2. If we filter by `converted_date_raw IN range`, we only get SQLs created in that range
3. The Closed Lost status and date are AFTER the SQL date (you can't close lost before converting)
4. The eligibility flag checks the CURRENT state (became SQO OR is Closed Lost), not the timing

**Evidence**: The CASE statement at line 523-533 checks `is_sql = 1 AND (LOWER(SQO_raw) = 'yes' OR StageName = 'Closed Lost')` — it's about final state, not timing.

### Finding 6: SGM attribution CONFIRMED

**Answer**: `SGM_Owner_Name__c` reflects the **CURRENT opportunity owner** (from `Opportunity_Owner_Name__c`). This is consistent with the existing pipeline chart behavior.

**Risk**: If opportunities are reassigned between SGMs after SQL date, conversion data shows under the NEW SGM. This is acceptable because:
1. It's consistent with how the stacked bar chart already works
2. The current owner is responsible for the outcome
3. Historical owner tracking would require additional fields not present in the view

**Evidence**: `views/vw_funnel_master.sql:180,253`

---

## Phase 5: Integration Points & State Management

### Finding 1: Complete pipeline page state variables

**Current state** (from `src/app/dashboard/pipeline/page.tsx:37-91`):

| State Variable | Type | Line | Purpose |
|----------------|------|------|---------|
| `summary` | `OpenPipelineSummary \| null` | 37 | By-stage chart data |
| `loading` | `boolean` | 38 | By-stage loading state |
| `error` | `string \| null` | 39 | Error message |
| `sgmOptions` | `SgmOption[]` | 42 | SGM dropdown options |
| `sgmOptionsLoading` | `boolean` | 43 | SGM options loading |
| `selectedStages` | `string[]` | 46 | Selected pipeline stages |
| `selectedSgms` | `string[]` | 47 | Selected SGMs |
| `drillDownOpen` | `boolean` | 73 | Modal visibility |
| `drillDownRecords` | `DetailRecord[]` | 74 | Drill-down data |
| `drillDownLoading` | `boolean` | 75 | Drill-down loading |
| `drillDownStage` | `string \| null` | 76 | Stage being drilled |
| `drillDownMetric` | `'aum' \| 'count' \| null` | 77 | Metric being drilled |
| `selectedRecordId` | `string \| null` | 80 | Record detail modal |
| `activeTab` | `'byStage' \| 'bySgm'` | 83 | Current tab |
| `bySgmData` | `SgmPipelineChartData[]` | 86 | By-SGM chart data |
| `bySgmLoading` | `boolean` | 87 | By-SGM loading |
| `drillDownSgm` | `string \| null` | 90 | SGM being drilled |

**New state needed for conversion table**:
```typescript
// SQL Date Filter state
const [sqlDateRange, setSqlDateRange] = useState<{
  preset: 'alltime' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom';
  year: number;
  startDate: string | null;
  endDate: string | null;
} | null>(null);  // null = "All Time" default

// Conversion Table state
const [conversionData, setConversionData] = useState<SgmConversionData[]>([]);
const [conversionLoading, setConversionLoading] = useState(false);

// Sort state (could be in table component instead)
const [sortColumn, setSortColumn] = useState<SortColumn>('sqls');
const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
```

### Finding 2: Data fetching pattern

**Pattern from `fetchBySgmData`** (lines 123-140):
```typescript
const fetchBySgmData = useCallback(async () => {
  if (activeTab !== 'bySgm') return;  // Guard: only fetch when tab active
  setBySgmLoading(true);
  try {
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
    const result = await dashboardApi.getPipelineBySgm(
      selectedStages.length > 0 ? selectedStages : undefined,
      sgmsToSend
    );
    setBySgmData(result.data);
  } catch (err) {
    console.error('Error fetching by-SGM data:', err);
    setBySgmData([]);
  } finally {
    setBySgmLoading(false);
  }
}, [activeTab, selectedStages, selectedSgms, sgmOptions.length]);
```

**Trigger useEffect** (lines 142-146):
```typescript
useEffect(() => {
  if (activeTab === 'bySgm' && isRevOpsAdmin) {
    fetchBySgmData();
  }
}, [activeTab, isRevOpsAdmin, fetchBySgmData]);
```

**New pattern for coordinated fetching** (when date filter changes):
```typescript
// When sqlDateRange changes, refetch BOTH chart and table
useEffect(() => {
  if (activeTab === 'bySgm' && isRevOpsAdmin) {
    fetchBySgmData();      // Chart data (with date filter)
    fetchConversionData(); // Table data (with date filter)
  }
}, [activeTab, isRevOpsAdmin, sqlDateRange, fetchBySgmData, fetchConversionData]);
```

### Finding 3: API client patterns

**Current `getPipelineBySgm`** (lines 385-395):
```typescript
getPipelineBySgm: async (stages?: string[], sgms?: string[]): Promise<{ data: SgmPipelineChartData[] }> => {
  const response = await fetch('/api/dashboard/pipeline-by-sgm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stages, sgms }),
  });
  // ...
}
```

**Modified signature needed**:
```typescript
getPipelineBySgm: async (
  stages?: string[],
  sgms?: string[],
  dateRange?: { startDate: string; endDate: string } | null  // NEW
): Promise<{ data: SgmPipelineChartData[] }>
```

**New function for conversion table**:
```typescript
getSgmConversions: async (
  sgms?: string[],
  dateRange?: { startDate: string; endDate: string } | null
): Promise<{ data: SgmConversionData[] }> => {
  const response = await fetch('/api/dashboard/sgm-conversions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sgms, dateRange }),
  });
  // ...
}
```

### Finding 4: API route structure

**Current route** (`/api/dashboard/pipeline-by-sgm/route.ts`):
- Extracts `{ stages, sgms }` from body (line 84)
- Calls `getOpenPipelineBySgm({ stages, sgms })` (line 86)
- Pivots data and returns (lines 87-89)

**Modification needed**: Accept optional `dateRange` parameter
```typescript
const body = await request.json();
const { stages, sgms, dateRange } = body;  // Add dateRange

const rows = await getOpenPipelineBySgm({ stages, sgms, dateRange });
```

**New route needed** (`/api/dashboard/sgm-conversions/route.ts`):
```typescript
export async function POST(request: NextRequest) {
  // ... auth checks ...
  const { sgms, dateRange } = await request.json();
  const data = await getSgmConversionData({ sgms, dateRange });
  return NextResponse.json({ data });
}
```

### Finding 5: PipelineFilters component structure

**Props interface** (lines 19-29):
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

**Key insight**: PipelineFilters is a **controlled component** with local state. Changes are applied via `onApply` callback, which triggers refetch in the parent page.

**Date filter integration**: The SQL date filter should be a **separate component** rendered conditionally when `activeTab === 'bySgm'`. It should NOT be integrated into PipelineFilters because:
1. It's unique to the By SGM tab
2. PipelineFilters handles stages/SGMs, which apply to both tabs
3. Separation of concerns

### Finding 6: Render structure for By SGM tab

**Current structure** (lines 380-457):
```
{isRevOpsAdmin && (
  <div className="flex gap-1 mb-4">
    <button>By Stage</button>
    <button>By SGM</button>
  </div>
)}

<Card>  {/* Chart Card */}
  {activeTab === 'byStage' ? (
    <PipelineByStageChart ... />
  ) : (
    <PipelineBySgmChart ... />
  )}
</Card>
```

**New structure for By SGM tab**:
```
{isRevOpsAdmin && (
  <div className="flex gap-1 mb-4">
    <button>By Stage</button>
    <button>By SGM</button>
  </div>
)}

{/* NEW: SQL Date Filter - only shown on By SGM tab */}
{activeTab === 'bySgm' && isRevOpsAdmin && (
  <SqlDateFilter
    value={sqlDateRange}
    onChange={setSqlDateRange}
    disabled={bySgmLoading || conversionLoading}
  />
)}

<Card>  {/* Chart Card */}
  {activeTab === 'byStage' ? (
    <PipelineByStageChart ... />
  ) : (
    <PipelineBySgmChart ... />
  )}
</Card>

{/* NEW: Conversion Table - only shown on By SGM tab */}
{activeTab === 'bySgm' && isRevOpsAdmin && (
  <SgmConversionTable
    data={conversionData}
    loading={conversionLoading}
    sortColumn={sortColumn}
    sortDirection={sortDirection}
    onSort={(col, dir) => { setSortColumn(col); setSortDirection(dir); }}
  />
)}
```

### Finding 7: Drill-down route needs date filter

**Current drilldown** (`/api/dashboard/pipeline-drilldown-sgm/route.ts`):
```typescript
const { sgm, stages, sgms } = body;
const records = await getOpenPipelineRecordsBySgm(sgm, stages, sgms);
```

**Modification needed**: Accept `dateRange` parameter so drill-down respects the date filter
```typescript
const { sgm, stages, sgms, dateRange } = body;
const records = await getOpenPipelineRecordsBySgm(sgm, stages, sgms, dateRange);
```

---

## Summary: Key Decisions for Implementation

| Question | Answer | Impact |
|----------|--------|--------|
| Can we reuse GlobalFilters? | No — too coupled | Need new SqlDateFilter component |
| What table/view? | vw_funnel_master (FULL_TABLE) | Same as existing queries |
| Date filter field? | converted_date_raw | Standard pattern exists |
| Conversion rate computation? | SQL-side with SAFE_DIVIDE | Follow source-performance.ts pattern |
| Sortable table pattern? | Yes, copy from SourcePerformanceTable | SortableHeader component, Tremor Table |
| Chart fetches own data? | No — parent passes props | Coordinate both fetches on filter change |
| Need new API endpoint? | Yes — /api/dashboard/sgm-conversions | Separate from chart endpoint |
| Number of queries? | 2 — chart query + table query | Different GROUP BY structures |

---

## Files to Create/Modify

| File | Action | Notes |
|------|--------|-------|
| `src/components/dashboard/SqlDateFilter.tsx` | CREATE | Quarter/Year + custom range picker |
| `src/components/dashboard/SgmConversionTable.tsx` | CREATE | Sortable table with Team Average row |
| `src/lib/queries/open-pipeline.ts` | MODIFY | Add date params to _getOpenPipelineBySgm; add _getSgmConversionData |
| `src/app/api/dashboard/pipeline-by-sgm/route.ts` | MODIFY | Accept dateRange param |
| `src/app/api/dashboard/sgm-conversions/route.ts` | CREATE | New endpoint for conversion table |
| `src/lib/api-client.ts` | MODIFY | Add dateRange to getPipelineBySgm; add getSgmConversions |
| `src/types/dashboard.ts` | MODIFY | Add SgmConversionData interface |
| `src/app/dashboard/pipeline/page.tsx` | MODIFY | Add state, fetch functions, render components |

---

## Open Questions / NEEDS VERIFICATION

1. ~~**SGM reassignment risk**~~: **RESOLVED** — `SGM_Owner_Name__c` reflects the **CURRENT owner** (from `Opportunity_Owner_Name__c`). If reassigned, data shows under new SGM. This is consistent with the existing pipeline chart behavior.
2. **Team Average row**: No existing pattern found — will implement as bolded last row with computed averages.

---

## Phase 6: Implementation Plan

### Implementation Order

| Step | Task | Files | Dependencies |
|------|------|-------|--------------|
| 1 | Add TypeScript types | `src/types/dashboard.ts` | None |
| 2 | Create SQL query function | `src/lib/queries/open-pipeline.ts` | Step 1 |
| 3 | Modify chart query for date filter | `src/lib/queries/open-pipeline.ts` | Step 1 |
| 4 | Create conversion table API route | `src/app/api/dashboard/sgm-conversions/route.ts` | Step 2 |
| 5 | Modify chart API route for date filter | `src/app/api/dashboard/pipeline-by-sgm/route.ts` | Step 3 |
| 6 | Update API client | `src/lib/api-client.ts` | Steps 4, 5 |
| 7 | Create SqlDateFilter component | `src/components/dashboard/SqlDateFilter.tsx` | None |
| 8 | Create SgmConversionTable component | `src/components/dashboard/SgmConversionTable.tsx` | Step 1 |
| 9 | Integrate into pipeline page | `src/app/dashboard/pipeline/page.tsx` | Steps 6, 7, 8 |
| 10 | Update drilldown for date filter | `src/app/api/dashboard/pipeline-drilldown-sgm/route.ts` | Step 3 |

---

### Step 1: TypeScript Types

**File**: `src/types/dashboard.ts`

```typescript
// Add to existing file:

/**
 * SGM Conversion data for the conversion table
 */
export interface SgmConversionData {
  sgm: string;
  sqlsReceived: number;           // COUNT where is_sql=1 AND is_primary_opp_record=1
  sqlToSqoRate: number;           // sql_to_sqo_progression / eligible_for_sql_conversions
  sqosCount: number;              // SUM(is_sqo_unique)
  sqoToJoinedRate: number;        // sqo_to_joined_progression / eligible_for_sqo_conversions
  joinedCount: number;            // SUM(is_joined_unique)
  // Raw counts for rate calculation (if computing client-side)
  sqlToSqoNumer?: number;
  sqlToSqoDenom?: number;
  sqoToJoinedNumer?: number;
  sqoToJoinedDenom?: number;
}

/**
 * Date range for SQL date filter
 */
export interface SqlDateRange {
  preset: 'alltime' | 'q1' | 'q2' | 'q3' | 'q4' | 'ytd' | 'qtd' | 'custom';
  year: number;
  startDate: string | null;  // ISO format YYYY-MM-DD
  endDate: string | null;
}
```

---

### Step 2: SQL Query Function for Conversion Table

**File**: `src/lib/queries/open-pipeline.ts`

```typescript
// Add new function:

interface SgmConversionFilters {
  sgms?: string[];
  dateRange?: { startDate: string; endDate: string } | null;
}

const _getSgmConversionData = async (
  filters?: SgmConversionFilters
): Promise<SgmConversionData[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');
  conditions.push('v.SGM_Owner_Name__c IS NOT NULL');

  // Date filter on converted_date_raw (SQL date)
  if (filters?.dateRange?.startDate && filters?.dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = filters.dateRange.startDate;
    params.endDate = filters.dateRange.endDate;
  }

  // SGM filter
  if (filters?.sgms && filters.sgms.length > 0) {
    const sgmParams = filters.sgms.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgm${i}`] = sgm;
    });
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const query = `
    SELECT
      v.SGM_Owner_Name__c as sgm,
      -- SQLs received (deduplicated by opportunity)
      COUNT(CASE WHEN v.is_sql = 1 AND v.is_primary_opp_record = 1 THEN 1 END) as sqls_received,
      -- SQL→SQO rate components
      SUM(v.sql_to_sqo_progression) as sql_to_sqo_numer,
      SUM(v.eligible_for_sql_conversions) as sql_to_sqo_denom,
      -- SQO count
      SUM(v.is_sqo_unique) as sqos_count,
      -- SQO→Joined rate components
      SUM(v.sqo_to_joined_progression) as sqo_to_joined_numer,
      SUM(v.eligible_for_sqo_conversions) as sqo_to_joined_denom,
      -- Joined count
      SUM(v.is_joined_unique) as joined_count
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    GROUP BY v.SGM_Owner_Name__c
    ORDER BY sqls_received DESC
  `;

  const results = await runQuery<{
    sgm: string | null;
    sqls_received: number | null;
    sql_to_sqo_numer: number | null;
    sql_to_sqo_denom: number | null;
    sqos_count: number | null;
    sqo_to_joined_numer: number | null;
    sqo_to_joined_denom: number | null;
    joined_count: number | null;
  }>(query, params);

  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;

  return results.map(r => ({
    sgm: toString(r.sgm),
    sqlsReceived: toNumber(r.sqls_received),
    sqlToSqoNumer: toNumber(r.sql_to_sqo_numer),
    sqlToSqoDenom: toNumber(r.sql_to_sqo_denom),
    sqlToSqoRate: safeDiv(toNumber(r.sql_to_sqo_numer), toNumber(r.sql_to_sqo_denom)),
    sqosCount: toNumber(r.sqos_count),
    sqoToJoinedNumer: toNumber(r.sqo_to_joined_numer),
    sqoToJoinedDenom: toNumber(r.sqo_to_joined_denom),
    sqoToJoinedRate: safeDiv(toNumber(r.sqo_to_joined_numer), toNumber(r.sqo_to_joined_denom)),
    joinedCount: toNumber(r.joined_count),
  }));
};

export const getSgmConversionData = cachedQuery(
  _getSgmConversionData,
  'getSgmConversionData',
  CACHE_TAGS.DASHBOARD
);
```

---

### Step 3: Modify Chart Query for Date Filter

**File**: `src/lib/queries/open-pipeline.ts`

Modify `_getOpenPipelineBySgm` to accept optional dateRange:

```typescript
const _getOpenPipelineBySgm = async (
  filters?: {
    stages?: string[];
    sgms?: string[];
    dateRange?: { startDate: string; endDate: string } | null;  // NEW
  }
): Promise<{ sgm: string; stage: string; count: number; aum: number }[]> => {
  // ... existing code ...

  // ADD: Date filter on converted_date_raw
  if (filters?.dateRange?.startDate && filters?.dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = filters.dateRange.startDate;
    params.endDate = filters.dateRange.endDate;
  }

  // ... rest of existing code ...
};
```

---

### Step 4: Create Conversion Table API Route

**File**: `src/app/api/dashboard/sgm-conversions/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSgmConversionData } from '@/lib/queries/open-pipeline';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }

    const forbidden = forbidRecruiter(permissions);
    if (forbidden) return forbidden;

    const cpForbidden = forbidCapitalPartner(permissions);
    if (cpForbidden) return cpForbidden;

    // revops_admin only
    if (permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { sgms, dateRange } = body;

    const data = await getSgmConversionData({ sgms, dateRange });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching SGM conversions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM conversions' },
      { status: 500 }
    );
  }
}
```

---

### Step 5: Modify Chart API Route

**File**: `src/app/api/dashboard/pipeline-by-sgm/route.ts`

```typescript
// Change line 84:
const { stages, sgms, dateRange } = body;  // Add dateRange

// Change line 86:
const rows = await getOpenPipelineBySgm({ stages, sgms, dateRange });
```

---

### Step 6: Update API Client

**File**: `src/lib/api-client.ts`

```typescript
// Modify getPipelineBySgm (around line 385):
getPipelineBySgm: async (
  stages?: string[],
  sgms?: string[],
  dateRange?: { startDate: string; endDate: string } | null  // NEW
): Promise<{ data: SgmPipelineChartData[] }> => {
  const response = await fetch('/api/dashboard/pipeline-by-sgm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stages, sgms, dateRange }),  // Add dateRange
  });
  // ...
},

// Add new function:
getSgmConversions: async (
  sgms?: string[],
  dateRange?: { startDate: string; endDate: string } | null
): Promise<{ data: SgmConversionData[] }> => {
  const response = await fetch('/api/dashboard/sgm-conversions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sgms, dateRange }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch SGM conversions');
  }

  return response.json();
},
```

---

### Step 7: Create SqlDateFilter Component

**File**: `src/components/dashboard/SqlDateFilter.tsx`

```typescript
'use client';

import { useState, useMemo } from 'react';
import { Card } from '@tremor/react';
import { Calendar } from 'lucide-react';
import { SqlDateRange } from '@/types/dashboard';

const DATE_PRESETS = [
  { value: 'alltime', label: 'All Time' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'q1', label: 'Q1' },
  { value: 'q2', label: 'Q2' },
  { value: 'q3', label: 'Q3' },
  { value: 'q4', label: 'Q4' },
  { value: 'custom', label: 'Custom Range' },
] as const;

interface SqlDateFilterProps {
  value: SqlDateRange | null;
  onChange: (value: SqlDateRange | null) => void;
  disabled?: boolean;
}

export function SqlDateFilter({ value, onChange, disabled = false }: SqlDateFilterProps) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  const preset = value?.preset || 'alltime';
  const year = value?.year || currentYear;

  const handlePresetChange = (newPreset: string) => {
    if (newPreset === 'alltime') {
      onChange(null);
      return;
    }
    onChange({
      preset: newPreset as SqlDateRange['preset'],
      year: ['ytd', 'qtd'].includes(newPreset) ? currentYear : year,
      startDate: value?.startDate || null,
      endDate: value?.endDate || null,
    });
  };

  const handleYearChange = (newYear: number) => {
    if (!value) return;
    onChange({ ...value, year: newYear });
  };

  const handleStartDateChange = (date: string) => {
    onChange({
      preset: 'custom',
      year: currentYear,
      startDate: date,
      endDate: value?.endDate || null,
    });
  };

  const handleEndDateChange = (date: string) => {
    onChange({
      preset: 'custom',
      year: currentYear,
      startDate: value?.startDate || null,
      endDate: date,
    });
  };

  const showYearSelector = ['q1', 'q2', 'q3', 'q4'].includes(preset);
  const showCustomDates = preset === 'custom';

  return (
    <Card className="mb-4 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-gray-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          SQL Creation Date Filter
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          (scopes chart and table to SQLs created in this period)
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Preset Selector */}
        <select
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value)}
          disabled={disabled}
          className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900
                     focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        {/* Year Selector (for Q1-Q4) */}
        {showYearSelector && (
          <select
            value={year}
            onChange={(e) => handleYearChange(parseInt(e.target.value))}
            disabled={disabled}
            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}

        {/* Custom Date Range */}
        {showCustomDates && (
          <>
            <input
              type="date"
              value={value?.startDate || ''}
              onChange={(e) => handleStartDateChange(e.target.value)}
              disabled={disabled}
              className="px-3 py-2 border border-gray-300 rounded-lg
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <span className="text-gray-500">to</span>
            <input
              type="date"
              value={value?.endDate || ''}
              onChange={(e) => handleEndDateChange(e.target.value)}
              disabled={disabled}
              className="px-3 py-2 border border-gray-300 rounded-lg
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </>
        )}
      </div>
    </Card>
  );
}
```

---

### Step 8: Create SgmConversionTable Component

**File**: `src/components/dashboard/SgmConversionTable.tsx`

```typescript
'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@tremor/react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { SgmConversionData } from '@/types/dashboard';
import { formatPercent, formatNumber } from '@/lib/utils/date-helpers';

type SortColumn = 'sgm' | 'sqls' | 'sqlToSqo' | 'sqos' | 'sqoToJoined' | 'joined';
type SortDirection = 'asc' | 'desc';

interface SgmConversionTableProps {
  data: SgmConversionData[];
  loading?: boolean;
}

export function SgmConversionTable({ data, loading = false }: SgmConversionTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('sqls');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Sort data
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'sgm':
          comparison = a.sgm.localeCompare(b.sgm);
          break;
        case 'sqls':
          comparison = a.sqlsReceived - b.sqlsReceived;
          break;
        case 'sqlToSqo':
          comparison = a.sqlToSqoRate - b.sqlToSqoRate;
          break;
        case 'sqos':
          comparison = a.sqosCount - b.sqosCount;
          break;
        case 'sqoToJoined':
          comparison = a.sqoToJoinedRate - b.sqoToJoinedRate;
          break;
        case 'joined':
          comparison = a.joinedCount - b.joinedCount;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, sortColumn, sortDirection]);

  // Calculate team averages
  const teamAverage = useMemo(() => {
    if (data.length === 0) return null;
    const totalSqls = data.reduce((sum, d) => sum + d.sqlsReceived, 0);
    const totalSqlToSqoNumer = data.reduce((sum, d) => sum + (d.sqlToSqoNumer || 0), 0);
    const totalSqlToSqoDenom = data.reduce((sum, d) => sum + (d.sqlToSqoDenom || 0), 0);
    const totalSqos = data.reduce((sum, d) => sum + d.sqosCount, 0);
    const totalSqoToJoinedNumer = data.reduce((sum, d) => sum + (d.sqoToJoinedNumer || 0), 0);
    const totalSqoToJoinedDenom = data.reduce((sum, d) => sum + (d.sqoToJoinedDenom || 0), 0);
    const totalJoined = data.reduce((sum, d) => sum + d.joinedCount, 0);

    return {
      sgm: 'Team Average',
      sqlsReceived: Math.round(totalSqls / data.length),
      sqlToSqoRate: totalSqlToSqoDenom > 0 ? totalSqlToSqoNumer / totalSqlToSqoDenom : 0,
      sqosCount: Math.round(totalSqos / data.length),
      sqoToJoinedRate: totalSqoToJoinedDenom > 0 ? totalSqoToJoinedNumer / totalSqoToJoinedDenom : 0,
      joinedCount: Math.round(totalJoined / data.length),
    };
  }, [data]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // SortableHeader component
  const SortableHeader = ({ column, children, alignRight = true }: {
    column: SortColumn;
    children: React.ReactNode;
    alignRight?: boolean;
  }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';

    return (
      <TableHeaderCell
        className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none
                    ${alignRight ? 'text-right' : ''}`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : ''}`}>
          {children}
          <div className="flex flex-col">
            <ChevronUp className={`w-3 h-3 ${showAsc ? 'text-blue-600' : 'text-gray-300'}`} />
            <ChevronDown className={`w-3 h-3 -mt-1 ${showDesc ? 'text-blue-600' : 'text-gray-300'}`} />
          </div>
        </div>
      </TableHeaderCell>
    );
  };

  if (loading) {
    return (
      <Card className="animate-pulse">
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          SGM Conversion & Velocity
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Post-SQL journey by SGM (click column headers to sort)
        </p>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <SortableHeader column="sgm" alignRight={false}>SGM</SortableHeader>
              <SortableHeader column="sqls">SQLs</SortableHeader>
              <SortableHeader column="sqlToSqo">SQL→SQO %</SortableHeader>
              <SortableHeader column="sqos">SQO'd</SortableHeader>
              <SortableHeader column="sqoToJoined">SQO→Joined %</SortableHeader>
              <SortableHeader column="joined">Joined</SortableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedData.map((row, idx) => (
              <TableRow
                key={row.sgm}
                className={idx % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-900'}
              >
                <TableCell className="font-medium text-gray-900 dark:text-white">
                  {row.sgm}
                </TableCell>
                <TableCell className="text-right">{formatNumber(row.sqlsReceived)}</TableCell>
                <TableCell className="text-right">{formatPercent(row.sqlToSqoRate)}</TableCell>
                <TableCell className="text-right">{formatNumber(row.sqosCount)}</TableCell>
                <TableCell className="text-right">{formatPercent(row.sqoToJoinedRate)}</TableCell>
                <TableCell className="text-right">{formatNumber(row.joinedCount)}</TableCell>
              </TableRow>
            ))}

            {/* Team Average Row */}
            {teamAverage && (
              <TableRow className="border-t-2 border-gray-300 dark:border-gray-600 bg-blue-50 dark:bg-blue-900/20">
                <TableCell className="font-bold text-gray-900 dark:text-white">
                  {teamAverage.sgm}
                </TableCell>
                <TableCell className="text-right font-bold">{formatNumber(teamAverage.sqlsReceived)}</TableCell>
                <TableCell className="text-right font-bold">{formatPercent(teamAverage.sqlToSqoRate)}</TableCell>
                <TableCell className="text-right font-bold">{formatNumber(teamAverage.sqosCount)}</TableCell>
                <TableCell className="text-right font-bold">{formatPercent(teamAverage.sqoToJoinedRate)}</TableCell>
                <TableCell className="text-right font-bold">{formatNumber(teamAverage.joinedCount)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No conversion data available for selected filters
        </div>
      )}
    </Card>
  );
}
```

---

### Step 9: Integrate into Pipeline Page

**File**: `src/app/dashboard/pipeline/page.tsx`

**Add imports**:
```typescript
import { SqlDateFilter } from '@/components/dashboard/SqlDateFilter';
import { SgmConversionTable } from '@/components/dashboard/SgmConversionTable';
import { SqlDateRange, SgmConversionData } from '@/types/dashboard';
import { buildDateRangeFromSqlFilter } from '@/lib/utils/date-helpers'; // New helper
```

**Add state** (after line 90):
```typescript
// SQL Date Filter state (null = "All Time")
const [sqlDateRange, setSqlDateRange] = useState<SqlDateRange | null>(null);

// Conversion Table state
const [conversionData, setConversionData] = useState<SgmConversionData[]>([]);
const [conversionLoading, setConversionLoading] = useState(false);
```

**Add fetch function** (after fetchBySgmData):
```typescript
// Fetch Conversion Table data
const fetchConversionData = useCallback(async () => {
  if (activeTab !== 'bySgm') return;
  setConversionLoading(true);
  try {
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
    const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;
    const result = await dashboardApi.getSgmConversions(sgmsToSend, dateRange);
    setConversionData(result.data);
  } catch (err) {
    console.error('Error fetching conversion data:', err);
    setConversionData([]);
  } finally {
    setConversionLoading(false);
  }
}, [activeTab, selectedSgms, sgmOptions.length, sqlDateRange]);
```

**Modify fetchBySgmData** to include dateRange:
```typescript
const fetchBySgmData = useCallback(async () => {
  if (activeTab !== 'bySgm') return;
  setBySgmLoading(true);
  try {
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
    const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;  // NEW
    const result = await dashboardApi.getPipelineBySgm(
      selectedStages.length > 0 ? selectedStages : undefined,
      sgmsToSend,
      dateRange  // NEW
    );
    setBySgmData(result.data);
  } catch (err) {
    console.error('Error fetching by-SGM data:', err);
    setBySgmData([]);
  } finally {
    setBySgmLoading(false);
  }
}, [activeTab, selectedStages, selectedSgms, sgmOptions.length, sqlDateRange]);  // Add sqlDateRange
```

**Modify useEffect** to fetch both:
```typescript
useEffect(() => {
  if (activeTab === 'bySgm' && isRevOpsAdmin) {
    fetchBySgmData();
    fetchConversionData();  // NEW
  }
}, [activeTab, isRevOpsAdmin, fetchBySgmData, fetchConversionData]);
```

**Add components to render** (after tab buttons, before Chart Card):
```typescript
{/* SQL Date Filter - only shown on By SGM tab */}
{activeTab === 'bySgm' && isRevOpsAdmin && (
  <SqlDateFilter
    value={sqlDateRange}
    onChange={setSqlDateRange}
    disabled={bySgmLoading || conversionLoading}
  />
)}
```

**Add table after Chart Card**:
```typescript
{/* Conversion Table - only shown on By SGM tab */}
{activeTab === 'bySgm' && isRevOpsAdmin && (
  <SgmConversionTable
    data={conversionData}
    loading={conversionLoading}
  />
)}
```

---

### Step 10: Add Date Range Helper

**File**: `src/lib/utils/date-helpers.ts`

```typescript
import { SqlDateRange } from '@/types/dashboard';

export function buildDateRangeFromSqlFilter(filter: SqlDateRange): { startDate: string; endDate: string } | null {
  const today = new Date().toISOString().split('T')[0];
  const year = filter.year;

  switch (filter.preset) {
    case 'alltime':
      return null;
    case 'ytd':
      return { startDate: `${year}-01-01`, endDate: today };
    case 'qtd': {
      const currentMonth = new Date().getMonth();
      const quarterStart = new Date(year, Math.floor(currentMonth / 3) * 3, 1);
      return { startDate: quarterStart.toISOString().split('T')[0], endDate: today };
    }
    case 'q1':
      return { startDate: `${year}-01-01`, endDate: `${year}-03-31` };
    case 'q2':
      return { startDate: `${year}-04-01`, endDate: `${year}-06-30` };
    case 'q3':
      return { startDate: `${year}-07-01`, endDate: `${year}-09-30` };
    case 'q4':
      return { startDate: `${year}-10-01`, endDate: `${year}-12-31` };
    case 'custom':
      if (filter.startDate && filter.endDate) {
        return { startDate: filter.startDate, endDate: filter.endDate };
      }
      return null;
    default:
      return null;
  }
}
```

---

### Testing Checklist

- [ ] "All Time" (null dateRange) returns all data
- [ ] Q1-Q4 filters return only SQLs created in that quarter
- [ ] Custom date range works correctly
- [ ] Chart and table both update when date filter changes
- [ ] Team Average row shows correct aggregated rates
- [ ] Sorting works on all columns
- [ ] Drill-down respects date filter
- [ ] Loading states display correctly
- [ ] Empty state displays when no data
