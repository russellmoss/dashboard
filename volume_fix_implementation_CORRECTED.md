# Volume Display Fix - Implementation Guide (CORRECTED)

## Overview

This document provides step-by-step instructions for Cursor.ai to implement the volume display fix. Each step includes a prompt, expected code changes, and verification steps.

**Goal**: 
1. Fix volume calculations in `buildPeriodModeQuery()` to show true periodic volumes (events that occurred in each period)
2. Hide cohort/periodic toggle when "Volumes" is selected in ConversionTrendChart
3. Add tooltip explaining that volumes show periodic data only

**Validated Expected Values**:
| Quarter | SQLs | SQOs | Joined |
|---------|------|------|--------|
| Q4 2025 | 193  | 144  | 17     |
| Q3 2025 | 221  | 133  | 15     |

**CRITICAL CORRECTIONS APPLIED**:
- ✅ API route uses POST with JSON body (not GET with query params)
- ✅ Component receives `trends` as props (doesn't fetch directly)
- ✅ Date range uses rolling window calculation (not full year)
- ✅ Filter field names corrected (SGA_Owner_Name__c, not Recruiting_Advisor_Owner_Name)
- ✅ Channel filter uses COALESCE pattern
- ✅ Includes advanced filters support
- ✅ Includes SGM filter
- ✅ Period function for monthly uses FORMAT_DATE (not FORMAT_TIMESTAMP)
- ✅ Uses same date range calculation as getConversionTrends

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
- [ ] Step 1: Fix SQO volume CTE in buildPeriodModeQuery()
- [ ] Step 2: Fix Joined volume CTE in buildPeriodModeQuery()
- [ ] Step 3: Update ConversionTrendChart component UI
- [ ] Step 4: Add volume tooltip
- [ ] Step 5: Run linter and type checks
- [ ] Step 6: Verify in browser
```

---

## Step 1: Fix Volume CTEs in buildPeriodModeQuery()

### Prompt 1.1: Fix SQO Volume CTE

```
Open `src/lib/queries/conversion-rates.ts` and locate the `buildPeriodModeQuery()` function.

Find the `sql_to_sqo_numer` CTE (around lines 664-690). This CTE currently:
1. Uses wrong period function: `periodFn('TIMESTAMP(v.converted_date_raw)')` - should use SQO date
2. Filters by wrong date field: `converted_date_raw` in WHERE clause - should filter by `Date_Became_SQO__c`
3. Has cohort restriction: `periodFn(converted_date_raw) = periodFn(Date_Became_SQO__c)` - should be removed

Fix it to:
1. Use `periodFn('v.Date_Became_SQO__c')` for period grouping
2. Filter WHERE clause by `Date_Became_SQO__c` (not converted_date_raw)
3. Remove the cohort restriction from the COUNTIF for `sqos` field
4. Keep the `sql_to_sqo_numer` calculation for conversion rates (with cohort restriction) - that's correct for rates
5. But make `sqos` field count ALL SQOs in the period (no cohort restriction)

Here's the corrected CTE:
```

**CORRECTED Code for `sql_to_sqo_numer` CTE**:

```typescript
-- ═══════════════════════════════════════════════════════════════════════════
-- SQL → SQO Numerator (Period-Resolved: SQL'd AND SQO'd in same period)
-- ═══════════════════════════════════════════════════════════════════════════
sql_to_sqo_numer AS (
  SELECT
    ${periodFn('TIMESTAMP(v.converted_date_raw)')} as period,  // Keep for conversion rate numerator
    COUNTIF(
      LOWER(v.SQO_raw) = 'yes'
      AND v.Date_Became_SQO__c IS NOT NULL
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = @recruitingRecordType
      -- Keep cohort restriction for conversion rate numerator
      AND ${periodFn('TIMESTAMP(v.converted_date_raw)')} = ${periodFn('v.Date_Became_SQO__c')}
    ) as sql_to_sqo_numer,
    -- ✅ FIX: sqos volume should count ALL SQOs in period, not just those matching SQL period
    -- We'll create a separate CTE for this
  FROM \`${FULL_TABLE}\` v
  LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
  WHERE v.converted_date_raw IS NOT NULL
    AND v.is_sql = 1
    AND DATE(v.converted_date_raw) >= DATE(@trendStartDate)
    AND DATE(v.converted_date_raw) <= DATE(@trendEndDate)
    ${filterWhereClause}
  GROUP BY period
),
```

**Actually, better approach**: Create a separate `sqo_volume` CTE for volumes, and keep `sql_to_sqo_numer` for conversion rate calculations. This keeps concerns separated.

### Prompt 1.2: Add Separate Volume CTEs

```
In `buildPeriodModeQuery()`, AFTER the `sqo_to_joined_denom` CTE (around line 783) and BEFORE the final SELECT, add two new CTEs:

1. `sqo_volume` - Counts ALL SQOs by Date_Became_SQO__c (no cohort restriction)
2. `joined_volume` - Counts ALL Joined by advisor_join_date__c (no cohort restriction)

These should be independent of the conversion rate CTEs.
```

**Code to Add** (insert after `sqo_to_joined_denom` CTE, before final SELECT):

```typescript
-- ═══════════════════════════════════════════════════════════════════════════
-- PERIODIC VOLUMES (Independent of conversion rate logic)
-- These count events by when they occurred, with no cohort restrictions
-- ═══════════════════════════════════════════════════════════════════════════
sqo_volume AS (
  SELECT
    ${periodFn('v.Date_Became_SQO__c')} as period,  -- ✅ Use SQO date for period grouping
    COUNT(*) as sqos
  FROM \`${FULL_TABLE}\` v
  LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
  WHERE v.Date_Became_SQO__c IS NOT NULL  -- ✅ Filter by SQO date
    AND LOWER(v.SQO_raw) = 'yes'
    AND v.is_sqo_unique = 1
    AND v.recordtypeid = @recruitingRecordType
    AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)  -- ✅ Use SQO date
    AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)   -- ✅ Use SQO date
    ${filterWhereClause}
  GROUP BY period
  -- ✅ NO cohort restriction - count ALL SQOs in period
),

joined_volume AS (
  SELECT
    ${periodFn('TIMESTAMP(v.advisor_join_date__c)')} as period,  -- ✅ Use Joined date for period grouping
    COUNT(*) as joined
  FROM \`${FULL_TABLE}\` v
  LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
  WHERE v.advisor_join_date__c IS NOT NULL  -- ✅ Filter by Joined date
    AND v.is_joined_unique = 1
    AND DATE(v.advisor_join_date__c) >= DATE(@trendStartDate)  -- ✅ Use Joined date
    AND DATE(v.advisor_join_date__c) <= DATE(@trendEndDate)   -- ✅ Use Joined date
    ${filterWhereClause}
  GROUP BY period
  -- ✅ NO cohort restriction - count ALL Joined in period
)
```

### Prompt 1.3: Update Final SELECT to Use New Volume CTEs

```
In the final SELECT statement of `buildPeriodModeQuery()` (around lines 788-809), update the volume fields:

OLD:
- COALESCE(s2sq_n.sqos, 0) as sqos  -- This comes from sql_to_sqo_numer (buggy)
- COALESCE(sq2j_n.joined, 0) as joined  -- This comes from sqo_to_joined_numer (buggy)

NEW:
- COALESCE(sqov.sqos, 0) as sqos  -- From new sqo_volume CTE
- COALESCE(jv.joined, 0) as joined  -- From new joined_volume CTE

Also add LEFT JOINs for the new CTEs:
- LEFT JOIN sqo_volume sqov ON ap.period = sqov.period
- LEFT JOIN joined_volume jv ON ap.period = jv.period
```

**Code Changes for Final SELECT**:

```typescript
SELECT
  ap.period,
  COALESCE(c2m.contacted_numer, 0) as contacted_to_mql_numer,
  COALESCE(c2m.contacted_denom, 0) as contacted_to_mql_denom,
  COALESCE(m2s_n.mql_to_sql_numer, 0) as mql_to_sql_numer,
  COALESCE(m2s_d.mql_to_sql_denom, 0) as mql_to_sql_denom,
  COALESCE(s2sq_n.sql_to_sqo_numer, 0) as sql_to_sqo_numer,
  COALESCE(s2sq_d.sql_to_sqo_denom, 0) as sql_to_sqo_denom,
  COALESCE(sq2j_n.sqo_to_joined_numer, 0) as sqo_to_joined_numer,
  COALESCE(sq2j_d.sqo_to_joined_denom, 0) as sqo_to_joined_denom,
  COALESCE(m2s_n.sqls, 0) as sqls,  -- ✅ Keep from mql_to_sql_numer (already correct)
  COALESCE(sqov.sqos, 0) as sqos,     -- ✅ FIX: Use new sqo_volume CTE
  COALESCE(jv.joined, 0) as joined    -- ✅ FIX: Use new joined_volume CTE
FROM all_periods ap
LEFT JOIN contacted_to_mql c2m ON ap.period = c2m.period
LEFT JOIN mql_to_sql_numer m2s_n ON ap.period = m2s_n.period
LEFT JOIN mql_to_sql_denom m2s_d ON ap.period = m2s_d.period
LEFT JOIN sql_to_sqo_numer s2sq_n ON ap.period = s2sq_n.period
LEFT JOIN sql_to_sqo_denom s2sq_d ON ap.period = s2sq_d.period
LEFT JOIN sqo_to_joined_numer sq2j_n ON ap.period = sq2j_n.period
LEFT JOIN sqo_to_joined_denom sq2j_d ON ap.period = sq2j_d.period
LEFT JOIN sqo_volume sqov ON ap.period = sqov.period  -- ✅ ADD: New volume CTE
LEFT JOIN joined_volume jv ON ap.period = jv.period    -- ✅ ADD: New volume CTE
ORDER BY ap.period
```

### Prompt 1.4: Remove Buggy Volume Fields from Existing CTEs

```
In the `sql_to_sqo_numer` CTE (line 675-681), remove the `sqos` field calculation since we're using a separate CTE now.

In the `sqo_to_joined_numer` CTE (line 735-740), remove the `joined` field calculation since we're using a separate CTE now.

This keeps the conversion rate numerator calculations intact while fixing volumes.
```

**Changes**:
- Remove lines 675-681 (the `sqos` COUNTIF) from `sql_to_sqo_numer` CTE
- Remove lines 735-740 (the `joined` COUNTIF) from `sqo_to_joined_numer` CTE

### Prompt 1.5: Verify Query Changes

```
Run TypeScript check:
npx tsc --noEmit

Run linter:
npm run lint

Fix any errors and log to volume_answers.md under "### Step 1 Verification".
```

### Prompt 1.6: Log Step 1 Completion

```
Append to volume_answers.md:

### Step 1: Fix Volume CTEs in buildPeriodModeQuery() - COMPLETE
- Added separate sqo_volume CTE (filters by Date_Became_SQO__c, no cohort restriction)
- Added separate joined_volume CTE (filters by advisor_join_date__c, no cohort restriction)
- Updated final SELECT to use new volume CTEs
- Removed buggy volume calculations from conversion rate CTEs
- TypeScript compilation: [PASS/FAIL]
- Lint check: [PASS/FAIL]
- Errors fixed: [LIST ANY]
```

---

## Step 2: Update ConversionTrendChart Component

### Prompt 2.1: Read Current Component Structure

```
Open `src/components/dashboard/ConversionTrendChart.tsx` and identify:

1. Where the "Volumes" / "Rates" toggle is rendered (line 299-321)
2. Where the "Cohort" / "Periodic" toggle is rendered (line 268-296)
3. What state variables control these toggles:
   - `selectedMetric` (line 129) - controls 'rates' vs 'volume'
   - `mode` prop (line 123) - controls 'cohort' vs 'period' (from parent)
4. How the component receives data: It receives `trends` as props (line 111, 120) - does NOT fetch directly

Log the structure to volume_answers.md under "### Step 2.1 Component Analysis".

Key Finding: Component receives trends as props from dashboard page. The dashboard page calls the API.
```

### Prompt 2.2: Hide Mode Toggle When Volumes Selected

```
Modify the ConversionTrendChart component to hide the Cohort/Periodic toggle when "Volumes" is selected.

Find the mode toggle section (around lines 268-296) and wrap it with a conditional:

{selectedMetric === 'rates' && onModeChange && (
  // ... existing mode toggle code ...
)}
```

**Code Change**:

```tsx
{/* Mode Toggle - Cohort first (default), Period second */}
{selectedMetric === 'rates' && onModeChange && (  // ✅ ADD: Only show when rates selected
  <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
    <button
      onClick={() => handleModeChange('cohort')}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
        mode === 'cohort'
          ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      }`}
    >
      Cohort
      <ModeTooltip mode="cohort">
        <InfoIcon className="ml-0.5" />
      </ModeTooltip>
    </button>
    <button
      onClick={() => handleModeChange('period')}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
        mode === 'period'
          ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      }`}
    >
      Period
      <ModeTooltip mode="period">
        <InfoIcon className="ml-0.5" />
      </ModeTooltip>
    </button>
  </div>
)}
```

### Prompt 2.3: Add Tooltip to Volumes Button

```
Add a tooltip to the "Volumes" button explaining that volumes show periodic data.

Find the "Volume" button (around line 311-320) and wrap it with a tooltip component.

The component already has an InfoIcon component and ModeTooltip pattern - use a similar approach.
```

**Code Change**:

```tsx
{/* Metric Toggle (Rates vs Volume) */}
<div className="flex gap-1 bg-gray-100 rounded-lg p-1">
  <button
    onClick={() => setSelectedMetric('rates')}
    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
      selectedMetric === 'rates'
        ? 'bg-white shadow text-blue-600 font-medium'
        : 'text-gray-600 hover:text-gray-900'
    }`}
  >
    Rates
  </button>
  
  {/* ✅ ADD: Volumes button with tooltip */}
  <div className="relative group">
    <button
      onClick={() => setSelectedMetric('volume')}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
        selectedMetric === 'volume'
          ? 'bg-white shadow text-blue-600 font-medium'
          : 'text-gray-600 hover:text-gray-900'
      }`}
    >
      Volumes
    </button>
    {/* Tooltip */}
    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 dark:bg-gray-700 text-white text-sm rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
      Shows the count of SQLs, SQOs, and Advisors Joined that occurred within each period
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-800 dark:border-t-gray-700"></div>
    </div>
  </div>
</div>
```

### Prompt 2.4: Update Legend Explanation for Volumes

```
Find the legend explanation section (around lines 416-437) and update it to show different text when volumes are selected.

When selectedMetric === 'volume', show text explaining periodic volumes.
When selectedMetric === 'rates', show the existing mode explanation.
```

**Code Change**:

```tsx
{/* Legend Explanation */}
<div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
  <div className="flex items-start gap-2">
    <InfoIcon className="mt-0.5 flex-shrink-0" />
    <Text className="text-xs text-gray-500 dark:text-gray-400">
      {selectedMetric === 'volume' ? (
        <>
          <strong>Volumes:</strong> Shows the count of SQLs, SQOs, and Advisors Joined that occurred within each time period. 
          These are periodic counts - events are counted by when they happened, regardless of when the record entered the funnel.
        </>
      ) : mode === 'cohort' ? (
        <>
          <strong>Cohort Mode:</strong> Tracks each cohort through the funnel over time.
          A Q3 SQL that becomes SQO in Q4 counts toward Q3&apos;s rate.
          Only includes resolved records (converted or closed). Open records still in progress are excluded.
          Rates are always 0-100%. Best for funnel efficiency analysis.
        </>
      ) : (
        <>
          <strong>Period Mode:</strong> Shows what completed within each period.
          Records must enter AND resolve (convert or close) in the same period to be counted.
          Excludes in-flight records for clean period comparisons.
          Rates are always 0-100%. Best for current period snapshots.
        </>
      )}
    </Text>
  </div>
</div>
```

### Prompt 2.5: Verify Component Changes

```
Run the following checks:

1. TypeScript check:
   npx tsc --noEmit

2. Lint check:
   npm run lint

3. Build check:
   npm run build

Fix any errors and log to volume_answers.md under "### Step 2 Verification".
```

### Prompt 2.6: Log Step 2 Completion

```
Append to volume_answers.md:

### Step 2: Update ConversionTrendChart Component - COMPLETE
- Hid Cohort/Periodic toggle when Volumes selected
- Added tooltip to Volumes button
- Updated legend explanation for volumes mode
- TypeScript compilation: [PASS/FAIL]
- Lint check: [PASS/FAIL]
- Build check: [PASS/FAIL]
- Errors fixed: [LIST ANY]
```

---

## Step 3: Verify No API Route Changes Needed

### Prompt 3.1: Verify API Route Structure

```
The API route (`src/app/api/dashboard/conversion-rates/route.ts`) already:
1. Uses POST method with JSON body ✅
2. Calls `getConversionTrends(filters, granularity, mode)` ✅
3. Returns `{ rates, trends, mode }` ✅

Since we fixed the volumes in `buildPeriodModeQuery()`, the API route will automatically return correct volumes.
The component receives trends as props, so no changes needed there either.

Log to volume_answers.md: "No API route changes needed - volumes fixed in query function"
```

---

## Step 4: Run Full Verification Suite

### Prompt 4.1: Run All Checks

```
Run the complete verification suite:

# 1. TypeScript compilation
npx tsc --noEmit

# 2. ESLint
npm run lint

# 3. Build
npm run build

Log ALL output to volume_answers.md under "### Step 4: Full Verification Suite".

If any checks fail:
1. Read the error messages carefully
2. Fix each error
3. Re-run the checks
4. Log what was fixed
```

### Prompt 4.2: Start Development Server

```
Start the development server:

npm run dev

Wait for it to compile successfully. Log any warnings or errors to volume_answers.md.
```

---

## Step 5: Browser Verification

### Prompt 5.1: Test Q4 2025 Volumes

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

Log results to volume_answers.md under "### Step 5.1: Q4 2025 Verification".
```

### Prompt 5.2: Test Q3 2025 Volumes

```
1. Change date filter to Q3 2025 (July 1 - September 30, 2025)
2. Ensure "Volumes" is still selected

VERIFY:
- [ ] Chart shows:
  - SQL: 221
  - SQO: 133
  - Joined: 15

Log results to volume_answers.md under "### Step 5.2: Q3 2025 Verification".
```

### Prompt 5.3: Test Rates Still Work

```
1. Click on "Rates" button
2. VERIFY:
   - [ ] Cohort/Periodic toggle APPEARS
   - [ ] Switching between Cohort and Periodic changes the data
   - [ ] Conversion rates are displayed (not volumes)

Log results to volume_answers.md under "### Step 5.3: Rates Mode Verification".
```

### Prompt 5.4: Test Full Year View

```
1. Set date filter to full year 2025
2. Click "Volumes"
3. VERIFY:
   - [ ] All 4 quarters are shown (Q1, Q2, Q3, Q4)
   - [ ] Q3 shows: 221 SQL, 133 SQO, 15 Joined
   - [ ] Q4 shows: 193 SQL, 144 SQO, 17 Joined

Log results to volume_answers.md under "### Step 5.4: Full Year Verification".
```

### Prompt 5.5: Test with Filters

```
1. Keep full year 2025 selected
2. Apply a channel or SGA filter
3. VERIFY:
   - [ ] Volumes update appropriately
   - [ ] No errors in console

Log results to volume_answers.md under "### Step 5.5: Filter Verification".
```

---

## Step 6: Final Documentation

### Prompt 6.1: Create Summary

```
Append to volume_answers.md:

---

## Phase 7: Implementation Summary

### Changes Made

**Files Modified:**
1. `src/lib/queries/conversion-rates.ts`
   - Modified: `buildPeriodModeQuery()` function
   - Added: Separate `sqo_volume` CTE (filters by Date_Became_SQO__c, no cohort restriction)
   - Added: Separate `joined_volume` CTE (filters by advisor_join_date__c, no cohort restriction)
   - Updated: Final SELECT to use new volume CTEs instead of buggy ones
   - Removed: Buggy volume calculations from conversion rate CTEs

2. `src/components/dashboard/ConversionTrendChart.tsx`
   - Modified: Hide Cohort/Periodic toggle when Volumes selected
   - Added: Tooltip on Volumes button
   - Updated: Legend explanation for volumes mode

**Files NOT Modified (No Changes Needed):**
- `src/app/api/dashboard/conversion-rates/route.ts` - Already correct, volumes fixed in query
- `src/app/dashboard/page.tsx` - Already correct, passes trends as props
- `src/lib/api-client.ts` - Already correct
- `src/types/dashboard.ts` - Already correct

**Root Cause of Original Bug:**
The volume CTEs in `buildPeriodModeQuery()` were designed for "period-resolved" conversion rate calculations. They incorrectly:
1. Filtered by wrong date fields (SQL date for SQOs, SQO date for Joined)
2. Applied cohort restrictions requiring entry and resolution in same period
3. This caused significant undercounting (e.g., Q3 SQL → Q4 SQO excluded from Q4 volumes)

**Solution Applied:**
Created separate volume CTEs that:
1. Filter by the correct date field for each metric (Date_Became_SQO__c for SQOs, advisor_join_date__c for Joined)
2. Have NO cohort restrictions - count ALL events in the period
3. Are independent of conversion rate logic
4. Match the pattern used in `funnel-metrics.ts` scorecard query

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

## Critical Corrections Summary

### Issues Found in Original Document:

1. ❌ **Wrong API Method**: Document suggested GET with query params, but actual route uses POST with JSON body
2. ❌ **Wrong Component Architecture**: Document assumed component fetches data, but it receives `trends` as props
3. ❌ **Wrong Date Range**: Document used full year, but actual code uses rolling window (selected quarter + 3 back)
4. ❌ **Wrong Filter Field Names**: 
   - `Recruiting_Advisor_Owner_Name` doesn't exist → should be `SGA_Owner_Name__c`
   - `nm.channel` doesn't exist → should use `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')`
5. ❌ **Missing Advanced Filters**: Document didn't include `buildAdvancedFilterClauses()` support
6. ❌ **Missing SGM Filter**: Document didn't include SGM filter
7. ❌ **Wrong Period Function**: Monthly used `FORMAT_TIMESTAMP` → should use `FORMAT_DATE('%Y-%m', DATE(...))`
8. ❌ **Wrong Approach**: Creating separate function instead of fixing existing `buildPeriodModeQuery()`

### Corrected Approach:

✅ **Fix existing `buildPeriodModeQuery()` function**:
- Add separate `sqo_volume` and `joined_volume` CTEs
- Update final SELECT to use new CTEs
- Keep conversion rate CTEs intact (they're correct for rates)
- Use same date range calculation as existing function
- Use same filter patterns as existing function

✅ **Component changes are minimal**:
- Hide mode toggle when volumes selected
- Add tooltip
- Update legend text

✅ **No API route changes needed**:
- API route already calls `getConversionTrends()` correctly
- Fixing the query function automatically fixes the API response

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
