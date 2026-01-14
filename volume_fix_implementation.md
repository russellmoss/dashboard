# Volume Display Fix - Implementation Guide

## Overview

This document provides step-by-step instructions for Cursor.ai to implement the volume display fix. Each step includes a prompt, expected code changes, and verification steps.

**Goal**: 
1. Fix volume calculations to show true periodic volumes (events that occurred in each period)
2. Hide cohort/periodic toggle when "Volumes" is selected
3. Add tooltip explaining that volumes show periodic data only

**Validated Expected Values**:
| Quarter | SQLs | SQOs | Joined |
|---------|------|------|--------|
| Q4 2025 | 193  | 144  | 17     |
| Q3 2025 | 221  | 133  | 15     |

---

## Pre-Implementation: Update Investigation Log

### Prompt 0.1: Log Implementation Start

```
Append the following to volume_answers.md:

---

## Phase 6: Implementation

**Start Time**: [Current Timestamp]
**Status**: In Progress

### Implementation Checklist
- [ ] Step 1: Create new getPeriodicVolumes() function
- [ ] Step 2: Update getConversionTrends() to use periodic volumes
- [ ] Step 3: Update ConversionTrendChart component UI
- [ ] Step 4: Add volume tooltip
- [ ] Step 5: Run linter and type checks
- [ ] Step 6: Verify in browser
```

---

## Step 1: Create the Periodic Volumes Query Function

### Prompt 1.1: Add New Function to conversion-rates.ts

```
Open `src/lib/queries/conversion-rates.ts` and add a new exported function called `getPeriodicVolumes()` AFTER the existing imports and BEFORE the `getConversionRates()` function.

This function should:
1. Accept filters (DashboardFilters) and granularity ('month' | 'quarter')
2. Return an array of objects with: period, sqls, sqos, joined
3. Use the CORRECT date fields validated in our investigation:
   - SQLs: Filter by `converted_date_raw`
   - SQOs: Filter by `Date_Became_SQO__c` with `is_sqo_unique = 1` and recordtypeid filter
   - Joined: Filter by `advisor_join_date__c` with `is_joined_unique = 1`
4. NO cohort restrictions - just count events that occurred in each period

Here is the exact code to add:
```

**Code to Add** (add after imports, before `getConversionRates`):

```typescript
/**
 * Get periodic volumes - counts events that occurred in each time period
 * This is independent of cohort logic - just counts SQLs, SQOs, and Joined by when they happened
 */
export async function getPeriodicVolumes(
  filters: DashboardFilters,
  granularity: 'month' | 'quarter' = 'quarter'
): Promise<{ period: string; sqls: number; sqos: number; joined: number }[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Expand to full year for trend data
  const year = new Date(startDate).getFullYear();
  const trendStartDate = `${year}-01-01`;
  const trendEndDate = `${year}-12-31`;
  
  // Build period function based on granularity
  const periodFn = granularity === 'quarter'
    ? (dateField: string) => `CONCAT(CAST(EXTRACT(YEAR FROM ${dateField}) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM ${dateField}) AS STRING))`
    : (dateField: string) => `FORMAT_TIMESTAMP('%Y-%m', ${dateField})`;

  // Build filter conditions
  const filterConditions: string[] = [];
  const params: Record<string, unknown> = {
    trendStartDate,
    trendEndDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  // Add optional filters
  if (filters.channel) {
    filterConditions.push('nm.channel = @channel');
    params.channel = filters.channel;
  }
  if (filters.sga) {
    filterConditions.push('v.Recruiting_Advisor_Owner_Name = @sga');
    params.sga = filters.sga;
  }
  if (filters.source) {
    filterConditions.push('v.Original_source = @source');
    params.source = filters.source;
  }

  const filterWhereClause = filterConditions.length > 0 
    ? `AND ${filterConditions.join(' AND ')}` 
    : '';

  const query = `
    -- SQL Volume: Count SQLs by converted_date_raw
    WITH sql_volume AS (
      SELECT
        ${periodFn('TIMESTAMP(v.converted_date_raw)')} as period,
        COUNT(*) as sqls
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND v.is_sql = 1
        AND DATE(v.converted_date_raw) >= DATE(@trendStartDate)
        AND DATE(v.converted_date_raw) <= DATE(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- SQO Volume: Count SQOs by Date_Became_SQO__c (NOT by SQL date!)
    sqo_volume AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNT(*) as sqos
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND LOWER(v.SQO_raw) = 'yes'
        AND v.is_sqo_unique = 1
        AND v.recordtypeid = @recruitingRecordType
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@trendEndDate, ' 23:59:59'))
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- Joined Volume: Count Joined by advisor_join_date__c (NOT by SQO date!)
    joined_volume AS (
      SELECT
        ${periodFn('TIMESTAMP(v.advisor_join_date__c)')} as period,
        COUNT(*) as joined
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.advisor_join_date__c IS NOT NULL
        AND v.is_joined_unique = 1
        AND DATE(v.advisor_join_date__c) >= DATE(@trendStartDate)
        AND DATE(v.advisor_join_date__c) <= DATE(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- Generate all periods in range
    all_periods AS (
      SELECT DISTINCT period FROM sql_volume
      UNION DISTINCT
      SELECT DISTINCT period FROM sqo_volume
      UNION DISTINCT
      SELECT DISTINCT period FROM joined_volume
    )
    
    SELECT
      ap.period,
      COALESCE(sv.sqls, 0) as sqls,
      COALESCE(sqov.sqos, 0) as sqos,
      COALESCE(jv.joined, 0) as joined
    FROM all_periods ap
    LEFT JOIN sql_volume sv ON ap.period = sv.period
    LEFT JOIN sqo_volume sqov ON ap.period = sqov.period
    LEFT JOIN joined_volume jv ON ap.period = jv.period
    ORDER BY ap.period
  `;

  const results = await runQuery<{
    period: string;
    sqls: number;
    sqos: number;
    joined: number;
  }>(query, params);

  return results;
}
```

### Prompt 1.2: Verify Function Added Correctly

```
After adding the function, run the following commands to verify no syntax or type errors:

npx tsc --noEmit

If there are errors, fix them and log the errors and fixes to volume_answers.md under "### Step 1 Verification".

Also verify the function is exported by checking that `export async function getPeriodicVolumes` appears in the file.
```

### Prompt 1.3: Log Step 1 Completion

```
Append to volume_answers.md:

### Step 1: Create getPeriodicVolumes() - COMPLETE
- Added new function at line [LINE_NUMBER]
- TypeScript compilation: [PASS/FAIL]
- Errors fixed: [LIST ANY ERRORS AND FIXES]
```

---

## Step 2: Update getConversionTrends to Use Periodic Volumes

### Prompt 2.1: Understand Current getConversionTrends Structure

```
Read the `getConversionTrends()` function in `src/lib/queries/conversion-rates.ts`. 

Identify:
1. Where the function returns volume data (sqls, sqos, joined fields)
2. Whether we should:
   a) Modify getConversionTrends to call getPeriodicVolumes internally, OR
   b) Have the API route call both functions separately

Log your analysis to volume_answers.md under "### Step 2.1 Analysis".

Recommendation: Option (b) is cleaner - keep getConversionTrends for conversion rates and use getPeriodicVolumes for volumes. The API route or component can merge them.
```

### Prompt 2.2: Update the API Route to Support Volume Mode

```
Open `src/app/api/dashboard/conversion-rates/route.ts` (or the conversion-trends route if separate).

Modify it to:
1. Accept a new optional parameter `volumeOnly?: boolean`
2. When `volumeOnly` is true, call `getPeriodicVolumes()` instead of `getConversionTrends()`
3. Return only volume data (no conversion rates needed)

Here's the modification pattern:
```

**Code Changes for API Route**:

Find the handler function and modify it:

```typescript
// Add import at top of file
import { getConversionTrends, getPeriodicVolumes } from '@/lib/queries/conversion-rates';

// In the handler, add volumeOnly parameter handling:
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    
    // Parse existing parameters
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;
    const channel = searchParams.get('channel') || undefined;
    const sga = searchParams.get('sga') || undefined;
    const source = searchParams.get('source') || undefined;
    const granularity = (searchParams.get('granularity') as 'month' | 'quarter') || 'quarter';
    const mode = (searchParams.get('mode') as 'period' | 'cohort') || 'period';
    
    // NEW: Check for volumeOnly parameter
    const volumeOnly = searchParams.get('volumeOnly') === 'true';

    const filters: DashboardFilters = {
      startDate,
      endDate,
      channel,
      sga,
      source,
    };

    // Apply permission-based filters
    const permissions = await getUserPermissions(session);
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }

    // NEW: If volumeOnly, use getPeriodicVolumes
    if (volumeOnly) {
      const volumes = await getPeriodicVolumes(filters, granularity);
      return NextResponse.json({ 
        trends: volumes.map(v => ({
          period: v.period,
          sqls: v.sqls,
          sqos: v.sqos,
          joined: v.joined,
          // Set rates to 0 since we're only returning volumes
          contactedToMql: 0,
          mqlToSql: 0,
          sqlToSqo: 0,
          sqoToJoined: 0,
        }))
      });
    }

    // Existing logic for conversion trends with rates
    const trends = await getConversionTrends(filters, granularity, mode);
    return NextResponse.json({ trends });

  } catch (error) {
    console.error('Error fetching conversion trends:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conversion trends' },
      { status: 500 }
    );
  }
}
```

### Prompt 2.3: Verify API Route Changes

```
Run TypeScript check:
npx tsc --noEmit

Run linter:
npm run lint

Fix any errors and log to volume_answers.md under "### Step 2 Verification".
```

### Prompt 2.4: Log Step 2 Completion

```
Append to volume_answers.md:

### Step 2: Update API Route - COMPLETE
- Added volumeOnly parameter support
- When volumeOnly=true, calls getPeriodicVolumes()
- TypeScript compilation: [PASS/FAIL]
- Lint check: [PASS/FAIL]
- Errors fixed: [LIST ANY]
```

---

## Step 3: Update ConversionTrendChart Component

### Prompt 3.1: Read Current Component Structure

```
Open `src/components/dashboard/ConversionTrendChart.tsx` and identify:

1. Where the "Volumes" / "Rates" toggle is rendered
2. Where the "Cohort" / "Periodic" toggle is rendered
3. What state variables control these toggles
4. How the component fetches data (does it call the API directly or receive data as props?)

Log the structure to volume_answers.md under "### Step 3.1 Component Analysis".
```

### Prompt 3.2: Modify Component to Hide Mode Toggle for Volumes

```
Modify the ConversionTrendChart component to:

1. When "Volumes" is selected, hide the "Cohort/Periodic" toggle
2. When "Volumes" is selected, always fetch with volumeOnly=true parameter
3. Add a tooltip to the "Volumes" button explaining the data shown

Here is the pattern for the changes:
```

**Code Changes for Component**:

```tsx
// 1. Add tooltip import if not already present
import { Tooltip } from '@/components/ui/tooltip'; // or use Tremor's Tooltip

// 2. Find the state for display mode (volumes vs rates) - likely something like:
const [displayMode, setDisplayMode] = useState<'rates' | 'volumes'>('rates');

// 3. Find the state for period mode (cohort vs period) - likely something like:
const [periodMode, setPeriodMode] = useState<'cohort' | 'period'>('period');

// 4. In the useEffect or data fetching logic, modify to use volumeOnly:
useEffect(() => {
  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate: filters.startDate || '',
        endDate: filters.endDate || '',
        granularity,
        // CHANGE: When displaying volumes, use volumeOnly and ignore periodMode
        ...(displayMode === 'volumes' 
          ? { volumeOnly: 'true' } 
          : { mode: periodMode }
        ),
      });
      
      // Add optional filters
      if (filters.channel) params.set('channel', filters.channel);
      if (filters.sga) params.set('sga', filters.sga);
      if (filters.source) params.set('source', filters.source);

      const response = await fetch(`/api/dashboard/conversion-rates?${params}`);
      // ... rest of fetch logic
    } catch (error) {
      // ... error handling
    } finally {
      setLoading(false);
    }
  };
  
  fetchData();
}, [filters, granularity, displayMode, periodMode]); // Include displayMode in deps

// 5. Update the toggle section in the JSX:
// Find where the Cohort/Periodic toggle is rendered and wrap it:

{/* Display Mode Toggle (Rates/Volumes) */}
<div className="flex items-center gap-2">
  <button
    onClick={() => setDisplayMode('rates')}
    className={`px-3 py-1 rounded ${displayMode === 'rates' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
  >
    Rates
  </button>
  
  {/* Volumes button with tooltip */}
  <div className="relative group">
    <button
      onClick={() => setDisplayMode('volumes')}
      className={`px-3 py-1 rounded ${displayMode === 'volumes' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
    >
      Volumes
    </button>
    {/* Tooltip */}
    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-sm rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
      Shows the count of SQLs, SQOs, and Advisors Joined that occurred within each period
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-800"></div>
    </div>
  </div>
</div>

{/* Cohort/Periodic Toggle - ONLY show when displaying rates */}
{displayMode === 'rates' && (
  <div className="flex items-center gap-2">
    <button
      onClick={() => setPeriodMode('period')}
      className={`px-3 py-1 rounded ${periodMode === 'period' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
    >
      Periodic
    </button>
    <button
      onClick={() => setPeriodMode('cohort')}
      className={`px-3 py-1 rounded ${periodMode === 'cohort' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
    >
      Cohort
    </button>
  </div>
)}
```

### Prompt 3.3: Alternative - Using Tremor or Existing UI Components

```
If the component uses Tremor or shadcn components for the toggles, adapt the above pattern to use those components. For example, with Tremor:

// Using Tremor's TabGroup
<TabGroup>
  <TabList>
    <Tab>Rates</Tab>
    <Tab>
      <div className="relative group">
        Volumes
        <span className="absolute ...tooltip styles...">
          Shows periodic volumes: SQLs, SQOs, and Joined counts by when they occurred
        </span>
      </div>
    </Tab>
  </TabList>
</TabGroup>

Examine the existing component and use the same UI library/patterns already in use.
```

### Prompt 3.4: Verify Component Changes

```
Run the following checks:

1. TypeScript check:
   npx tsc --noEmit

2. Lint check:
   npm run lint

3. Build check (catches more errors):
   npm run build

Fix any errors and log to volume_answers.md under "### Step 3 Verification".

Common issues to watch for:
- Missing imports
- Type mismatches in props
- Incorrect state variable names
- Missing dependencies in useEffect
```

### Prompt 3.5: Log Step 3 Completion

```
Append to volume_answers.md:

### Step 3: Update ConversionTrendChart Component - COMPLETE
- Hid Cohort/Periodic toggle when Volumes selected
- Added volumeOnly parameter to API call when in Volumes mode
- Added tooltip to Volumes button
- TypeScript compilation: [PASS/FAIL]
- Lint check: [PASS/FAIL]
- Build check: [PASS/FAIL]
- Errors fixed: [LIST ANY]
```

---

## Step 4: Create/Update API Client Function

### Prompt 4.1: Check API Client Structure

```
Open `src/lib/api-client.ts` and check if there's a function for fetching conversion trends.

If it exists, it may need to be updated to support the volumeOnly parameter.
If the component calls the API directly, skip this step.

Log findings to volume_answers.md under "### Step 4.1 API Client Analysis".
```

### Prompt 4.2: Update API Client if Needed

```
If there's a `getConversionTrends` or similar function in the API client, update it:

export async function getConversionTrends(
  filters: DashboardFilters,
  granularity: 'month' | 'quarter' = 'quarter',
  mode: 'period' | 'cohort' = 'period',
  volumeOnly: boolean = false  // ADD THIS PARAMETER
): Promise<TrendDataPoint[]> {
  const params = new URLSearchParams({
    granularity,
    ...(volumeOnly ? { volumeOnly: 'true' } : { mode }),
  });
  
  // ... rest of function
}
```

### Prompt 4.3: Log Step 4 Completion

```
Append to volume_answers.md:

### Step 4: API Client Updates - COMPLETE
- [Describe changes made or "No changes needed - component calls API directly"]
```

---

## Step 5: Run Full Verification Suite

### Prompt 5.1: Run All Checks

```
Run the complete verification suite:

# 1. TypeScript compilation
echo "=== TypeScript Check ===" 
npx tsc --noEmit
echo ""

# 2. ESLint
echo "=== Lint Check ==="
npm run lint
echo ""

# 3. Build
echo "=== Build Check ==="
npm run build
echo ""

Log ALL output to volume_answers.md under "### Step 5: Full Verification Suite".

If any checks fail:
1. Read the error messages carefully
2. Fix each error
3. Re-run the checks
4. Log what was fixed
```

### Prompt 5.2: Start Development Server

```
Start the development server:

npm run dev

Wait for it to compile successfully. Log any warnings or errors to volume_answers.md.
```

---

## Step 6: Browser Verification

### Prompt 6.1: Test Q4 2025 Volumes

```
In the browser:

1. Navigate to the dashboard
2. Set date filter to Q4 2025 (October 1 - December 31, 2025)
3. Go to the Conversion Trends chart
4. Click on "Volumes" button

VERIFY:
- [ ] Cohort/Periodic toggle is HIDDEN
- [ ] Tooltip appears when hovering over Volumes button
- [ ] Chart shows:
  - SQL: 193
  - SQO: 144
  - Joined: 17

Take a screenshot or note the actual values displayed.

Log results to volume_answers.md under "### Step 6.1: Q4 2025 Verification".
```

### Prompt 6.2: Test Q3 2025 Volumes

```
1. Change date filter to Q3 2025 (July 1 - September 30, 2025)
2. Ensure "Volumes" is still selected

VERIFY:
- [ ] Chart shows:
  - SQL: 221
  - SQO: 133
  - Joined: 15

Log results to volume_answers.md under "### Step 6.2: Q3 2025 Verification".
```

### Prompt 6.3: Test Rates Still Work

```
1. Click on "Rates" button
2. VERIFY:
   - [ ] Cohort/Periodic toggle APPEARS
   - [ ] Switching between Cohort and Periodic changes the data
   - [ ] Conversion rates are displayed (not volumes)

Log results to volume_answers.md under "### Step 6.3: Rates Mode Verification".
```

### Prompt 6.4: Test Full Year View

```
1. Set date filter to full year 2025
2. Click "Volumes"
3. VERIFY:
   - [ ] All 4 quarters are shown (Q1, Q2, Q3, Q4)
   - [ ] Q3 shows: 221 SQL, 133 SQO, 15 Joined
   - [ ] Q4 shows: 193 SQL, 144 SQO, 17 Joined

Log results to volume_answers.md under "### Step 6.4: Full Year Verification".
```

### Prompt 6.5: Test with Filters

```
1. Keep full year 2025 selected
2. Apply a channel or SGA filter
3. VERIFY:
   - [ ] Volumes update appropriately
   - [ ] No errors in console

Log results to volume_answers.md under "### Step 6.5: Filter Verification".
```

---

## Step 7: Final Documentation

### Prompt 7.1: Create Summary

```
Append to volume_answers.md:

---

## Phase 7: Implementation Summary

### Changes Made

**Files Modified:**
1. `src/lib/queries/conversion-rates.ts`
   - Added: `getPeriodicVolumes()` function
   - Purpose: Returns true periodic volumes without cohort restrictions

2. `src/app/api/dashboard/conversion-rates/route.ts` (or conversion-trends)
   - Added: `volumeOnly` parameter support
   - Purpose: Returns only volume data when requested

3. `src/components/dashboard/ConversionTrendChart.tsx`
   - Modified: Toggle visibility logic
   - Added: Tooltip on Volumes button
   - Changed: API call to use volumeOnly when in Volumes mode

**Root Cause of Original Bug:**
[Describe the cohort restriction issue found in investigation]

**Solution Applied:**
[Describe how the new getPeriodicVolumes function fixes the issue]

### Verification Results

| Test Case | Expected | Actual | Status |
|-----------|----------|--------|--------|
| Q4 2025 SQLs | 193 | [ACTUAL] | [✅/❌] |
| Q4 2025 SQOs | 144 | [ACTUAL] | [✅/❌] |
| Q4 2025 Joined | 17 | [ACTUAL] | [✅/❌] |
| Q3 2025 SQLs | 221 | [ACTUAL] | [✅/❌] |
| Q3 2025 SQOs | 133 | [ACTUAL] | [✅/❌] |
| Q3 2025 Joined | 15 | [ACTUAL] | [✅/❌] |
| Toggle Hidden | Yes | [Y/N] | [✅/❌] |
| Tooltip Works | Yes | [Y/N] | [✅/❌] |
| Rates Still Work | Yes | [Y/N] | [✅/❌] |

### Remaining Issues (if any)
[List any issues that couldn't be resolved]

### Recommendations for Future
[Any suggestions for improvements]

---

**Implementation Complete**: [TIMESTAMP]
```

---

## Troubleshooting Guide

### If Volumes Still Show Wrong Numbers

```
1. Check the API response in browser DevTools:
   - Network tab > find the conversion-rates request
   - Check if volumeOnly=true is in the URL
   - Check the response JSON for sqls, sqos, joined values

2. If API returns wrong values:
   - Add console.log in getPeriodicVolumes() to see the raw query
   - Run the query directly in BigQuery console
   - Compare with validated queries from investigation

3. If API returns correct values but chart shows wrong:
   - Check component state - is it using the correct data fields?
   - Add console.log in component to see what data it receives
```

### If TypeScript Errors Occur

```
Common fixes:

1. "Cannot find name 'FULL_TABLE'" or similar:
   - Ensure constants are imported: 
     import { FULL_TABLE, MAPPING_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';

2. "Type 'string | undefined' is not assignable to type 'string'":
   - Add default values or null checks
   - Use optional chaining: filters?.startDate

3. "Property 'volumeOnly' does not exist":
   - Make sure the API route parameter parsing is correct
   - Check that searchParams.get() is being used properly
```

### If Component Doesn't Update

```
1. Check useEffect dependencies:
   - displayMode should be in the dependency array
   - Changing displayMode should trigger refetch

2. Check state updates:
   - console.log the displayMode state changes
   - Verify setDisplayMode is being called on button click

3. Force refetch:
   - Add a key prop to the chart component that changes with displayMode
   - Or add a manual refetch trigger
```

---

## Quick Reference: Validated Queries

### SQL Volume Query (CORRECT)
```sql
SELECT
  CONCAT(CAST(EXTRACT(YEAR FROM converted_date_raw) AS STRING), '-Q', 
         CAST(EXTRACT(QUARTER FROM converted_date_raw) AS STRING)) as period,
  COUNT(*) as sqls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw IS NOT NULL
  AND is_sql = 1
  AND DATE(converted_date_raw) >= DATE(@startDate)
  AND DATE(converted_date_raw) <= DATE(@endDate)
GROUP BY period
```

### SQO Volume Query (CORRECT)
```sql
SELECT
  CONCAT(CAST(EXTRACT(YEAR FROM Date_Became_SQO__c) AS STRING), '-Q', 
         CAST(EXTRACT(QUARTER FROM Date_Became_SQO__c) AS STRING)) as period,
  COUNT(*) as sqos
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Date_Became_SQO__c IS NOT NULL
  AND LOWER(SQO_raw) = 'yes'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
  AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
GROUP BY period
```

### Joined Volume Query (CORRECT)
```sql
SELECT
  CONCAT(CAST(EXTRACT(YEAR FROM advisor_join_date__c) AS STRING), '-Q', 
         CAST(EXTRACT(QUARTER FROM advisor_join_date__c) AS STRING)) as period,
  COUNT(*) as joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_join_date__c IS NOT NULL
  AND is_joined_unique = 1
  AND DATE(advisor_join_date__c) >= DATE(@startDate)
  AND DATE(advisor_join_date__c) <= DATE(@endDate)
GROUP BY period
```

---

## Success Criteria Checklist

Before marking implementation complete, verify ALL of the following:

- [ ] `npm run build` passes with no errors
- [ ] `npm run lint` passes with no errors
- [ ] Q4 2025 shows: 193 SQL, 144 SQO, 17 Joined
- [ ] Q3 2025 shows: 221 SQL, 133 SQO, 15 Joined
- [ ] Cohort/Periodic toggle is hidden when Volumes is selected
- [ ] Tooltip appears on hover over Volumes button
- [ ] Rates mode still works correctly with Cohort/Periodic toggle
- [ ] Filters (channel, SGA) work with Volumes mode
- [ ] No console errors in browser DevTools
- [ ] All changes documented in volume_answers.md
