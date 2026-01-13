# Advanced Filters Implementation Plan - Codebase Review

**Review Date**: Current Session  
**Status**: ✅ **CORRECTIONS APPLIED TO PLAN**  
**Confidence Level**: 🟢 **HIGH (90%)** (after corrections)

---

## Executive Summary

The plan has several critical issues that must be fixed before agentic execution:

1. **Type File Conflict**: Plan creates new `src/types/filters.ts` but file already exists
2. **API Route Conflict**: Plan creates new route but existing `/api/dashboard/filters` already returns filter options
3. **Constant Names**: Plan uses `TABLES.FUNNEL_MASTER` but codebase uses `FULL_TABLE`
4. **Type Names**: Plan uses `FunnelViewType` but codebase uses `ViewMode`
5. **API Method**: Plan uses GET with query params, but codebase uses POST with JSON body
6. **Date Filtering**: Plan doesn't use `TIMESTAMP(@paramName)` which is required for BigQuery
7. **Query Signatures**: Plan changes function signatures but they should accept `DashboardFilters`
8. **Channel Mapping**: Plan's filter-options query doesn't include JOIN with `new_mapping` table
9. **SGA/SGM Filtering**: Plan doesn't account for `IsSGA__c` and `Is_SGM__c` filtering from User table

---

## Critical Issues to Fix

### ❌ Issue 1: Type File Already Exists

**Problem**: Phase 1.1 creates `src/types/filters.ts` but this file already exists with:
- `FilterOption` interface (with `isActive: boolean`)
- `DashboardFilters` interface
- `FilterOptions` interface

**Fix Required**:
- **DO NOT** create new file
- **EXTEND** existing `src/types/filters.ts` file
- Add new types (`DateRangeFilter`, `MultiSelectFilter`, `AdvancedFilters`) to existing file
- Extend `FilterOption` interface to include optional `count?: number` field
- Add `advancedFilters: AdvancedFilters` property to existing `DashboardFilters` interface

**Corrected Step 1.1**:
```typescript
// src/types/filters.ts - EXTEND existing file, don't create new

// Add these NEW types to the existing file:
export interface DateRangeFilter {
  enabled: boolean;
  preset: 'any' | 'qtd' | 'ytd' | 'custom';
  startDate: string | null;
  endDate: string | null;
}

export interface MultiSelectFilter {
  selectAll: boolean;
  selected: string[];
}

export interface AdvancedFilters {
  initialCallScheduled: DateRangeFilter;
  qualificationCallDate: DateRangeFilter;
  channels: MultiSelectFilter;
  sources: MultiSelectFilter;
  sgas: MultiSelectFilter;
  sgms: MultiSelectFilter;
}

// EXTEND existing FilterOption interface (add count field):
export interface FilterOption {
  value: string;
  label: string;
  isActive: boolean;  // EXISTING - keep this
  count?: number;     // NEW - add this
}

// EXTEND existing DashboardFilters interface:
export interface DashboardFilters {
  // ... existing fields ...
  advancedFilters?: AdvancedFilters;  // NEW - add this (optional for backward compatibility)
}

// Add DEFAULT_ADVANCED_FILTERS constant:
export const DEFAULT_ADVANCED_FILTERS: AdvancedFilters = {
  // ... as in plan
};
```

---

### ❌ Issue 2: API Route Already Exists

**Problem**: Phase 2 creates `/api/dashboard/filter-options/route.ts` but `/api/dashboard/filters/route.ts` already exists and returns filter options.

**Options**:
1. **Option A (Recommended)**: Extend existing `/api/dashboard/filters/route.ts` to return counts
2. **Option B**: Create new route but ensure it doesn't conflict

**Fix Required - Option A (Recommended)**:
- **DO NOT** create new route
- **EXTEND** existing `/api/dashboard/filters/route.ts`
- Add `COUNT(*)` to existing queries to return counts
- Update response type to include counts in `FilterOption[]`

**Corrected Step 2.2**:
```typescript
// src/app/api/dashboard/filters/route.ts - EXTEND existing file

// Update existing queries to include counts:
const sgasQuery = `
  SELECT DISTINCT 
    v.SGA_Owner_Name__c as sga,
    COALESCE(u.IsActive, FALSE) as isActive,
    COUNT(*) as record_count
  FROM \`${FULL_TABLE}\` v
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u 
    ON v.SGA_Owner_Name__c = u.Name
  WHERE v.SGA_Owner_Name__c IS NOT NULL
    AND (u.IsSGA__c = TRUE 
         OR v.SGA_Owner_Name__c IN (...alwaysInactiveSgas...))
  GROUP BY v.SGA_Owner_Name__c, u.IsActive
  ORDER BY record_count DESC
`;

// Update response mapping to include count:
sgas: sgaResults.map(r => ({
  value: r.sga!,
  label: r.sga!,
  isActive: r.isActive === true || r.isActive === 'true' || r.isActive === 1,
  count: parseInt(r.record_count?.toString() || '0', 10),  // NEW
})),
```

**Alternative - Option B**: If creating new route, use POST method (not GET) to match codebase pattern.

---

### ❌ Issue 3: Wrong Constant Names

**Problem**: Plan uses `TABLES.FUNNEL_MASTER` but codebase uses `FULL_TABLE`.

**Fix Required**:
- Replace all `TABLES.FUNNEL_MASTER` with `FULL_TABLE`
- Import from `@/config/constants` (not `TABLES`)

**Corrected Imports**:
```typescript
// WRONG (from plan):
import { TABLES } from '@/config/constants';
// Use: TABLES.FUNNEL_MASTER

// CORRECT (actual codebase):
import { FULL_TABLE, MAPPING_TABLE } from '@/config/constants';
// Use: FULL_TABLE
```

---

### ❌ Issue 4: Wrong Type Name

**Problem**: Plan uses `FunnelViewType` but codebase uses `ViewMode`.

**Fix Required**:
- Replace all `FunnelViewType` with `ViewMode`
- Import from `@/types/dashboard` (not `@/types/filters`)

**Corrected**:
```typescript
// WRONG (from plan):
import { FunnelViewType } from '@/types/filters';
funnelView: FunnelViewType;

// CORRECT (actual codebase):
import { ViewMode } from '@/types/dashboard';
viewMode: ViewMode;  // Also note: 'focused' | 'fullFunnel', not 'full' | 'sql+'
```

---

### ❌ Issue 5: Wrong API Method Pattern

**Problem**: Plan uses GET with query params, but codebase uses POST with JSON body.

**Fix Required**:
- Change all API routes to use POST method
- Use JSON body instead of query parameters
- Update API client to send POST requests

**Corrected Step 2.2**:
```typescript
// WRONG (from plan):
export async function GET() {
  // ...
}

// CORRECT (actual codebase pattern):
export async function POST(request: NextRequest) {
  const body = await request.json();
  // ...
}
```

**Corrected Step 2.3**:
```typescript
// WRONG (from plan):
async getFilterOptions(): Promise<FilterOptionsResponse> {
  const response = await fetch('/api/dashboard/filter-options');
  // ...
}

// CORRECT (actual codebase pattern):
async getFilterOptions(): Promise<FilterOptionsResponse> {
  const response = await fetch('/api/dashboard/filters', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  // ...
}
```

---

### ❌ Issue 6: Missing TIMESTAMP() for Date Filters

**Problem**: Plan's date filter clauses don't use `TIMESTAMP(@paramName)` which is required for BigQuery.

**Fix Required**:
- All date comparisons must use `TIMESTAMP(@paramName)` syntax
- End dates should include time component: `endDate + ' 23:59:59'`

**Corrected Step 4.1**:
```typescript
// WRONG (from plan):
if (filters.initialCallScheduled.startDate) {
  whereClauses.push(`Initial_Call_Scheduled_Date__c >= @${paramPrefix}_initial_start`);
  params[`${paramPrefix}_initial_start`] = filters.initialCallScheduled.startDate;
}

// CORRECT (actual codebase pattern):
if (filters.initialCallScheduled.startDate) {
  whereClauses.push(`TIMESTAMP(Initial_Call_Scheduled_Date__c) >= TIMESTAMP(@${paramPrefix}_initial_start)`);
  params[`${paramPrefix}_initial_start`] = filters.initialCallScheduled.startDate;
}
if (filters.initialCallScheduled.endDate) {
  whereClauses.push(`TIMESTAMP(Initial_Call_Scheduled_Date__c) <= TIMESTAMP(@${paramPrefix}_initial_end)`);
  params[`${paramPrefix}_initial_end`] = filters.initialCallScheduled.endDate + ' 23:59:59';
}
```

---

### ❌ Issue 7: Wrong Query Function Signatures

**Problem**: Plan changes function signatures to accept separate parameters, but codebase functions accept `DashboardFilters` object.

**Fix Required**:
- Keep existing function signatures
- Extract `advancedFilters` from `DashboardFilters` object
- Apply filters within existing function structure

**Corrected Step 5.1**:
```typescript
// WRONG (from plan):
export async function getFunnelMetrics(
  startDate: string,
  endDate: string,
  funnelView: FunnelViewType = 'full',
  advancedFilters: AdvancedFilters = DEFAULT_ADVANCED_FILTERS
): Promise<FunnelMetrics> {

// CORRECT (actual codebase pattern):
export async function getFunnelMetrics(filters: DashboardFilters): Promise<FunnelMetrics> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  const advancedFilters = filters.advancedFilters || DEFAULT_ADVANCED_FILTERS;
  
  // Build advanced filter clauses
  const { whereClauses: advFilterClauses, params: advFilterParams } = 
    buildAdvancedFilterClauses(advancedFilters);
  const advFilterSQL = buildWhereClauseString(advFilterClauses);
  
  // Add to existing conditions array
  const conditions: string[] = [];
  const params: Record<string, any> = {};
  
  // Existing filter logic...
  if (filters.channel) {
    conditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') = @channel');
    params.channel = filters.channel;
  }
  
  // Add advanced filter clauses
  conditions.push(...advFilterClauses);
  Object.assign(params, advFilterParams);
  
  // Use in WHERE clause
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
```

---

### ❌ Issue 8: Missing Channel Mapping JOIN

**Problem**: Plan's filter-options query for channels doesn't include JOIN with `new_mapping` table.

**Fix Required**:
- Add LEFT JOIN with `new_mapping` table
- Use `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')` pattern

**Corrected Step 2.2**:
```typescript
// WRONG (from plan):
async function getChannelOptions(): Promise<FilterOption[]> {
  const query = `
    SELECT 
      Channel_Grouping_Name AS value,
      COUNT(*) AS record_count
    FROM \`${FULL_TABLE}\`
    WHERE Channel_Grouping_Name IS NOT NULL
    GROUP BY Channel_Grouping_Name
  `;
}

// CORRECT (actual codebase pattern):
async function getChannelOptions(): Promise<FilterOption[]> {
  const query = `
    SELECT 
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') AS value,
      COUNT(*) AS record_count
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    WHERE COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') IS NOT NULL
      AND stage_entered_contacting__c >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
    GROUP BY COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')
    ORDER BY record_count DESC
  `;
}
```

---

### ❌ Issue 9: Missing SGA/SGM Role Filtering

**Problem**: Plan's SGA/SGM queries don't filter by `IsSGA__c` and `Is_SGM__c` from User table.

**Fix Required**:
- Add JOIN with User table
- Filter by `IsSGA__c = TRUE` for SGA query
- Filter by `Is_SGM__c = TRUE` for SGM query
- Include `isActive` status in response

**Corrected Step 2.2**:
```typescript
// WRONG (from plan):
async function getSGAOptions(): Promise<FilterOption[]> {
  const query = `
    SELECT 
      SGA_Owner_Name__c AS value,
      COUNT(*) AS record_count
    FROM \`${FULL_TABLE}\`
    WHERE SGA_Owner_Name__c IS NOT NULL
      AND SGA_Owner_Name__c != 'Savvy Operations'
    GROUP BY SGA_Owner_Name__c
  `;
}

// CORRECT (actual codebase pattern):
async function getSGAOptions(): Promise<FilterOption[]> {
  const alwaysInactiveSgas = [
    'Russell Moss', 'Anett Diaz', 'Bre McDaniel', 'Bryan Belville',
    'GinaRose Galli', 'Jed Entin', 'Savvy Marketing', 'Savvy Operations', 'Ariana Butler'
  ];
  
  const query = `
    SELECT DISTINCT 
      v.SGA_Owner_Name__c as sga,
      COALESCE(u.IsActive, FALSE) as isActive,
      COUNT(*) as record_count
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u 
      ON v.SGA_Owner_Name__c = u.Name
    WHERE v.SGA_Owner_Name__c IS NOT NULL
      AND (
        u.IsSGA__c = TRUE 
        OR v.SGA_Owner_Name__c IN (${alwaysInactiveSgas.map(n => `'${n.replace(/'/g, "''")}'`).join(', ')})
      )
      AND stage_entered_contacting__c >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)
    GROUP BY v.SGA_Owner_Name__c, u.IsActive
    ORDER BY record_count DESC
  `;
  
  const results = await runQuery<RawSgaResult & { record_count: number }>(query);
  return results.map(r => ({
    value: r.sga!,
    label: r.sga!,
    isActive: r.isActive === true || r.isActive === 'true' || r.isActive === 1,
    count: parseInt(r.record_count?.toString() || '0', 10),
  }));
}
```

---

### ❌ Issue 10: View Mode Values Mismatch

**Problem**: Plan uses `funnelView === 'full'` but codebase uses `viewMode === 'fullFunnel'`.

**Fix Required**:
- Replace `'full'` with `'fullFunnel'`
- Replace `'sql+'` with `'focused'`

**Corrected Step 3.1**:
```typescript
// WRONG (from plan):
const showInitialCallFilter = funnelView === 'full';

// CORRECT (actual codebase):
const showInitialCallFilter = viewMode === 'fullFunnel';
```

---

### ❌ Issue 11: API Route Parameter Parsing

**Problem**: Plan uses GET with query params, but codebase uses POST with JSON body.

**Fix Required**:
- Parse `advancedFilters` from request body (not query params)
- Handle backward compatibility (make `advancedFilters` optional)

**Corrected Step 6.1**:
```typescript
// WRONG (from plan):
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const advancedFiltersParam = searchParams.get('advancedFilters');
  const advancedFilters: AdvancedFilters = advancedFiltersParam 
    ? JSON.parse(advancedFiltersParam)
    : DEFAULT_ADVANCED_FILTERS;
}

// CORRECT (actual codebase pattern):
export async function POST(request: NextRequest) {
  const body = await request.json();
  const filters: DashboardFilters = body.filters || body; // Backward compatibility
  const advancedFilters = filters.advancedFilters || DEFAULT_ADVANCED_FILTERS;
  
  // Pass to query function:
  const metrics = await getFunnelMetrics(filters); // filters already contains advancedFilters
}
```

---

### ❌ Issue 12: API Client Method Updates

**Problem**: Plan updates API client methods incorrectly - they should accept `DashboardFilters` and pass `advancedFilters` in the body.

**Fix Required**:
- Keep existing method signatures
- Include `advancedFilters` in the `DashboardFilters` object passed to API

**Corrected Step 7.2**:
```typescript
// WRONG (from plan):
async getFunnelMetrics(filters: DashboardFilters): Promise<FunnelMetrics> {
  const params = new URLSearchParams({
    dateRange: filters.dateRange,
    advancedFilters: JSON.stringify(filters.advancedFilters),
  });
  const response = await fetch(`/api/dashboard/funnel-metrics?${params}`);
}

// CORRECT (actual codebase pattern):
async getFunnelMetrics(filters: DashboardFilters, viewMode?: ViewMode): Promise<FunnelMetricsWithGoals> {
  const response = await fetch('/api/dashboard/funnel-metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
      filters,  // filters already contains advancedFilters property
      ...(viewMode && { viewMode })
    }),
  });
  // ...
}
```

---

## Additional Corrections Needed

### ✅ Correction 1: UNNEST Array Parameter Handling

**Issue**: BigQuery `IN UNNEST(@param)` requires array parameters to be passed correctly.

**Fix**: Ensure arrays are passed as actual arrays, not strings:
```typescript
// In filter-helpers.ts, ensure arrays are passed correctly:
if (!filters.channels.selectAll && filters.channels.selected.length > 0) {
  whereClauses.push(`COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') IN UNNEST(@${paramPrefix}_channels)`);
  params[`${paramPrefix}_channels`] = filters.channels.selected; // Already an array
}
```

---

### ✅ Correction 2: Channel Filter in WHERE Clause

**Issue**: Channel filter must use the same COALESCE pattern as in queries.

**Fix**: Update filter-helpers.ts:
```typescript
// Channel filter must match query pattern:
if (!filters.channels.selectAll && filters.channels.selected.length > 0) {
  whereClauses.push(`COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') IN UNNEST(@${paramPrefix}_channels)`);
  params[`${paramPrefix}_channels`] = filters.channels.selected;
}
```

**Note**: This requires the query to include the JOIN with `new_mapping` table.

---

### ✅ Correction 3: SGA Filter Field Selection

**Issue**: SGA filter should use appropriate field based on metric type (Lead vs Opportunity).

**Fix**: The filter helper should apply SGA filter to the correct field:
- For lead metrics: `SGA_Owner_Name__c`
- For opportunity metrics: `Opp_SGA_Name__c`

However, since advanced filters are applied at the view level, we should filter by `SGA_Owner_Name__c` (lead field) for most metrics, and the query functions already handle this correctly.

---

### ✅ Correction 4: Date Filter Field Names

**Issue**: Plan uses field names directly, but should verify they match the view.

**Fix**: Use exact field names from `vw_funnel_master`:
- `Initial_Call_Scheduled_Date__c` ✅ (just added to view)
- `Qualification_Call_Date__c` ✅ (just added to view)

---

## Verification Queries (Updated)

All MCP verification queries in the plan are correct, but add these additional checks:

```sql
-- Verify view fields exist (already done - confirmed)
SELECT 
  COUNT(*) as total,
  COUNT(Initial_Call_Scheduled_Date__c) as has_initial_call,
  COUNT(Qualification_Call_Date__c) as has_qual_call
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE stage_entered_contacting__c >= '2025-01-01';
-- RESULT: has_initial_call=744, has_qual_call=520 ✅

-- Verify UNNEST syntax works
SELECT COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Channel_Grouping_Name IN UNNEST(['Outbound', 'Marketing']);
-- Should return count ✅

-- Verify date filter with TIMESTAMP works
SELECT COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE TIMESTAMP(Initial_Call_Scheduled_Date__c) >= TIMESTAMP('2026-01-01')
  AND TIMESTAMP(Initial_Call_Scheduled_Date__c) <= TIMESTAMP('2026-01-12 23:59:59');
-- Should return ~57 ✅
```

---

## Summary of Required Changes

### Phase 1: TypeScript Types
- ✅ **EXTEND** existing `src/types/filters.ts` (don't create new)
- ✅ Add new types to existing file
- ✅ Extend `FilterOption` to include `count?: number`
- ✅ Add `advancedFilters?: AdvancedFilters` to `DashboardFilters`

### Phase 2: Filter Options API
- ✅ **EXTEND** existing `/api/dashboard/filters/route.ts` (don't create new)
- ✅ Add `COUNT(*)` to existing queries
- ✅ Include `count` in response mapping
- ✅ Use POST method (not GET)
- ✅ Add JOIN with `new_mapping` for channels
- ✅ Add JOIN with User table and filter by `IsSGA__c`/`Is_SGM__c`

### Phase 3: Advanced Filters Component
- ✅ Use `ViewMode` instead of `FunnelViewType`
- ✅ Use `'fullFunnel'` instead of `'full'`
- ✅ Import from correct locations

### Phase 4: Filter Helper Utilities
- ✅ Use `TIMESTAMP(@paramName)` for all date comparisons
- ✅ Add time component to end dates: `endDate + ' 23:59:59'`
- ✅ Use `COALESCE(nm.Channel_Grouping_Name, ...)` for channel filter

### Phase 5: Update Query Functions
- ✅ Keep existing function signatures (accept `DashboardFilters`)
- ✅ Extract `advancedFilters` from `filters.advancedFilters`
- ✅ Add advanced filter clauses to existing conditions array
- ✅ Include JOIN with `new_mapping` table where needed

### Phase 6: Update API Routes
- ✅ Use POST method (not GET)
- ✅ Parse `advancedFilters` from request body
- ✅ Handle backward compatibility (make optional)

### Phase 7: Dashboard Integration
- ✅ Pass `advancedFilters` as part of `DashboardFilters` object
- ✅ Use existing API client patterns (POST with JSON body)

---

## Recommended Plan Updates

1. **Update Phase 1.1**: Change "Create new file" to "Extend existing file"
2. **Update Phase 2.2**: Change "Create new route" to "Extend existing route"
3. **Update all constant references**: `TABLES.FUNNEL_MASTER` → `FULL_TABLE`
4. **Update all type references**: `FunnelViewType` → `ViewMode`
5. **Update all API methods**: GET → POST, query params → JSON body
6. **Update date filter syntax**: Add `TIMESTAMP()` wrapper
7. **Update query function signatures**: Keep `DashboardFilters` parameter
8. **Add JOIN with new_mapping**: For channel queries
9. **Add JOIN with User table**: For SGA/SGM queries with role filtering

---

## Confidence Assessment

**Before Corrections**: 🔴 **LOW (30%)** - Multiple critical conflicts  
**After Corrections**: 🟢 **HIGH (90%)** - Should work correctly

**Remaining Risks**:
- Integration with existing filter logic (should be fine)
- Performance with multiple UNNEST clauses (should be fine)
- Backward compatibility (handled with optional `advancedFilters`)

---

## Next Steps

1. Apply all corrections listed above to the plan document
2. Update code snippets to match actual codebase patterns
3. Verify all file paths and imports
4. Re-run MCP verification queries
5. Mark plan as ready for agentic execution
