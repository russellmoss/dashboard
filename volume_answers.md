# Volume Investigation Log

**Date**: January 2026
**Issue**: Conversion Trends volume display showing incorrect values
**Expected Q4 2025**: 193 SQL, 144 SQO, 17 Joined
**Expected Q3 2025**: 221 SQL, 133 SQO, 15 Joined

---

## Investigation Progress

[Findings will be logged here as we progress through each phase]

---

## Phase 2: Ground Truth Validation

### Q4 2025 Validation Results

**SQL Count Query:**
```sql
SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw >= '2025-10-01' 
  AND converted_date_raw <= '2025-12-31'
```

**Result**: 193 SQLs ✅ (Matches expected: 193)

---

**SQO Count Query:**
```sql
SELECT COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Date_Became_SQO__c >= '2025-10-01' 
  AND Date_Became_SQO__c <= '2025-12-31'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
```

**Result**: 143 SQOs ⚠️ (Expected: 144, Difference: -1)

---

**Joined Count Query:**
```sql
SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_join_date__c >= '2025-10-01' 
  AND advisor_join_date__c <= '2025-12-31'
  AND is_joined_unique = 1
```

**Result**: 17 Joined ✅ (Matches expected: 17)

---

### Q3 2025 Validation Results

**SQL Count Query:**
```sql
SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw >= '2025-07-01' 
  AND converted_date_raw <= '2025-09-30'
```

**Result**: 221 SQLs ✅ (Matches expected: 221)

---

**SQO Count Query:**
```sql
SELECT COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Date_Became_SQO__c >= '2025-07-01' 
  AND Date_Became_SQO__c <= '2025-09-30'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
```

**Result**: 131 SQOs ⚠️ (Expected: 133, Difference: -2)

---

**Joined Count Query:**
```sql
SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_join_date__c >= '2025-07-01' 
  AND advisor_join_date__c <= '2025-09-30'
  AND is_joined_unique = 1
```

**Result**: 15 Joined ✅ (Matches expected: 15)

---

### Summary

| Quarter | Metric | Actual Count | Expected | Status |
|---------|--------|--------------|----------|--------|
| Q4 2025 | SQL | 193 | 193 | ✅ Match |
| Q4 2025 | SQO | 143 | 144 | ⚠️ -1 difference |
| Q4 2025 | Joined | 17 | 17 | ✅ Match |
| Q3 2025 | SQL | 221 | 221 | ✅ Match |
| Q3 2025 | SQO | 131 | 133 | ⚠️ -2 difference |
| Q3 2025 | Joined | 15 | 15 | ✅ Match |

### Notes
- Boolean fields in BigQuery are stored as INT64 (0/1), not BOOL type
- Queries must use `= 1` instead of `= TRUE` for boolean comparisons
- SQL and Joined counts match expected values exactly
- SQO counts are slightly lower than expected (1-2 records difference)
  - This may be due to data updates or slight differences in expected calculation logic
  - The actual BigQuery results will be used as the ground truth for fixing the volume display

---

## Phase 3: Current Code Analysis

### 3.1: Main Query File (`src/lib/queries/conversion-rates.ts`)

**Exported Functions:**
1. `getConversionRates(filters, mode)` - Returns conversion rates for scorecards
2. `getConversionTrends(filters, granularity, mode)` - Returns trend data for chart
3. `buildPeriodModeQuery()` - Helper function for period-resolved mode
4. `buildCohortModeQuery()` - Helper function for cohort mode

**Function Used for Conversion Trends Chart:**
- `getConversionTrends()` is the main function used for the trend chart
- It accepts: `filters`, `granularity` ('month' | 'quarter'), and `mode` ('period' | 'cohort')
- Returns: `TrendDataPoint[]` with volumes (sqls, sqos, joined) and rates

**Volume Calculation in `getConversionTrends()`:**

**PERIOD MODE** (lines 573-811):
- **SQLs Volume** (line 627): Counts records where `converted_date_raw` is in period
  ```sql
  COUNT(*) as sqls
  FROM vw_funnel_master
  WHERE converted_date_raw IS NOT NULL
    AND is_sql = 1
    AND DATE(converted_date_raw) >= DATE(@trendStartDate)
    AND DATE(converted_date_raw) <= DATE(@trendEndDate)
  ```
  ✅ **CORRECT** - Uses `converted_date_raw` directly

- **SQOs Volume** (lines 675-681): Counts SQOs where BOTH SQL date AND SQO date are in SAME period
  ```sql
  COUNTIF(
    LOWER(v.SQO_raw) = 'yes'
    AND v.Date_Became_SQO__c IS NOT NULL
    AND v.is_sqo_unique = 1
    AND v.recordtypeid = @recruitingRecordType
    -- ⚠️ BUG: Requires SQL date period = SQO date period
    AND ${periodFn('TIMESTAMP(v.converted_date_raw)')} = ${periodFn('v.Date_Became_SQO__c')}
  ) as sqos
  ```
  ❌ **BUG IDENTIFIED**: Line 673 and 680 - Only counts SQOs where the SQL date period matches the SQO date period. This is a **cohort restriction** that should NOT apply to volumes. Volumes should count ALL SQOs where `Date_Became_SQO__c` is in the period, regardless of when they SQL'd.

- **Joined Volume** (lines 735-740): Counts Joined where BOTH SQO date AND Joined date are in SAME period
  ```sql
  COUNTIF(
    v.advisor_join_date__c IS NOT NULL
    AND v.is_joined_unique = 1
    AND v.recordtypeid = @recruitingRecordType
    -- ⚠️ BUG: Requires SQO date period = Joined date period
    AND ${periodFn('v.Date_Became_SQO__c')} = ${periodFn('TIMESTAMP(v.advisor_join_date__c)')}
  ) as joined
  ```
  ❌ **BUG IDENTIFIED**: Line 733 and 739 - Only counts Joined where the SQO date period matches the Joined date period. This is a **cohort restriction** that should NOT apply to volumes. Volumes should count ALL Joined where `advisor_join_date__c` is in the period, regardless of when they SQO'd.

**COHORT MODE** (lines 819-938):
- **SQLs Volume** (line 873): Counts all SQLs where `converted_date_raw` is in period
  ```sql
  COUNTIF(v.is_sql = 1) as sqls
  WHERE converted_date_raw IS NOT NULL
    AND TIMESTAMP(converted_date_raw) >= TIMESTAMP(@trendStartDate)
    AND TIMESTAMP(converted_date_raw) <= TIMESTAMP(@trendEndDate)
  ```
  ✅ **CORRECT** - Uses `converted_date_raw` directly

- **SQOs Volume** (line 890): Counts SQOs where `Date_Became_SQO__c` is in period
  ```sql
  COUNTIF(v.recordtypeid = @recruitingRecordType AND v.is_sqo_unique = 1) as sqos
  WHERE Date_Became_SQO__c IS NOT NULL
    AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
    AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
  ```
  ✅ **CORRECT** - Uses `Date_Became_SQO__c` directly, no cohort restriction

- **Joined Volume** (line 891): Counts Joined where `advisor_join_date__c` is in period
  ```sql
  COUNTIF(v.is_joined_unique = 1) as joined
  WHERE Date_Became_SQO__c IS NOT NULL  -- ⚠️ NOTE: This filters by SQO date, not joined date!
  ```
  ❌ **BUG IDENTIFIED**: The WHERE clause filters by `Date_Became_SQO__c` but should filter by `advisor_join_date__c` for the joined volume. However, the COUNTIF correctly uses `is_joined_unique = 1`, so this might be intentional for cohort mode (only showing joined records from SQO cohort). But for **periodic volumes**, we should filter by `advisor_join_date__c`.

**Key Finding**: The volume display should show **periodic volumes only** - the count of events that occurred in each period, regardless of cohort/periodic mode. The current implementation incorrectly applies cohort restrictions to volumes in PERIOD mode.

---

### 3.2: Trend Chart Component (`src/components/dashboard/ConversionTrendChart.tsx`)

**Volume Toggle Handling:**
- Component has a `selectedMetric` state that toggles between 'rates' and 'volume' (line 129)
- When 'volume' is selected, it displays `SQLs`, `SQOs`, and `Joined` from the `TrendDataPoint` data (lines 153-155)
- No client-side transformation of volume data - it directly uses `t.sqls`, `t.sqos`, `t.joined` from the data

**Data Fields Expected:**
- `sqls: number` - SQL volume count
- `sqos: number` - SQO volume count  
- `joined: number` - Joined volume count

**View Mode Handling:**
- Component receives `mode` prop ('period' | 'cohort') but this only affects rate calculations
- The volume display does NOT distinguish between cohort/periodic - it just shows the volume fields from the data
- This is correct - volumes should always be periodic regardless of mode

**No Client-Side Transformation:**
- The component directly maps `t.sqls`, `t.sqos`, `t.joined` to chart data (lines 153-155)
- No filtering or transformation applied to volumes

---

### 3.3: API Route (`src/app/api/dashboard/conversion-rates/route.ts`)

**Parameters Accepted:**
- `filters: DashboardFilters` - Date range, channel, source, SGA, SGM filters
- `includeTrends: boolean` - Whether to include trend data
- `granularity: 'month' | 'quarter'` - Time period granularity
- `mode: 'period' | 'cohort'` - Conversion rate calculation mode

**How It Calls Query Function:**
- Line 43: `trends = await getConversionTrends(filters, granularity, mode)`
- Passes the `mode` parameter directly to `getConversionTrends()`

**Data Transformation:**
- No transformation applied - returns trends array directly (line 51)
- The mode is passed through to the query function

**Cohort/Periodic Logic:**
- The API route passes the `mode` parameter to `getConversionTrends()`
- The mode affects both rates AND volumes in the query function
- This is the issue - volumes should NOT be affected by mode

---

### 3.4: Types and Interfaces (`src/types/dashboard.ts`)

**TrendDataPoint Interface** (lines 147-157):
```typescript
export interface TrendDataPoint {
  period: string;
  sqls: number;           // Volume field
  sqos: number;           // Volume field
  joined: number;         // Volume field
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  isSelectedPeriod?: boolean;
}
```

**Volume-Related Fields:**
- `sqls: number` - SQL volume count
- `sqos: number` - SQO volume count
- `joined: number` - Joined volume count

**No Separate Fields for Cohort vs Periodic:**
- The interface does NOT have separate fields like `sqlsCohort` vs `sqlsPeriod`
- This is correct - volumes should always be periodic

---

### 3.5: Correct Scorecard Query (`src/lib/queries/funnel-metrics.ts`)

**How It Calculates Volumes:**

**SQLs** (lines 87-96):
```sql
SUM(
  CASE 
    WHEN converted_date_raw IS NOT NULL
      AND TIMESTAMP(converted_date_raw) >= TIMESTAMP(@startDate) 
      AND TIMESTAMP(converted_date_raw) <= TIMESTAMP(@endDate)
      AND is_sql = 1
    THEN 1 
    ELSE 0 
  END
) as sqls
```
✅ **CORRECT**: Filters by `converted_date_raw` within date range, with `is_sql = 1`

**SQOs** (lines 97-107):
```sql
SUM(
  CASE 
    WHEN Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
      AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
      AND recordtypeid = @recruitingRecordType
      AND is_sqo_unique = 1
    THEN 1 
    ELSE 0 
  END
) as sqos
```
✅ **CORRECT**: Filters by `Date_Became_SQO__c` within date range, with `is_sqo_unique = 1` and `recordtypeid` filter

**Joined** (lines 108-117):
```sql
SUM(
  CASE 
    WHEN advisor_join_date__c IS NOT NULL
      AND TIMESTAMP(advisor_join_date__c) >= TIMESTAMP(@startDate) 
      AND TIMESTAMP(advisor_join_date__c) <= TIMESTAMP(@endDate)
      AND is_joined_unique = 1
    THEN 1 
    ELSE 0 
  END
) as joined
```
✅ **CORRECT**: Filters by `advisor_join_date__c` within date range, with `is_joined_unique = 1`

**Key Insight**: The scorecard query correctly calculates volumes by:
1. Using the appropriate date field for each metric
2. Applying proper deduplication flags (`is_sqo_unique`, `is_joined_unique`)
3. Applying record type filter for SQO
4. **NO cohort restrictions** - just counts events in the date range

This is the pattern that should be used for trend chart volumes!

---

## Phase 4: Discrepancy Analysis

### 4.1: Volume Calculation Comparison Table

| Metric | Scorecard Query Logic (`funnel-metrics.ts`) | Trend Chart Query Logic (`conversion-rates.ts` PERIOD mode) | Difference |
|--------|--------------------------------------------|------------------------------------------------------------|------------|
| **SQL** | ✅ Filters by `converted_date_raw` in date range<br>✅ Uses `is_sql = 1`<br>✅ No cohort restrictions | ✅ Filters by `converted_date_raw` in date range (line 632-633)<br>✅ Uses `is_sql = 1` (line 631)<br>✅ No cohort restrictions (line 627) | ✅ **MATCHES** - Both correct |
| **SQO** | ✅ Filters by `Date_Became_SQO__c` in date range<br>✅ Uses `is_sqo_unique = 1`<br>✅ Uses `recordtypeid = '012Dn000000mrO3IAI'`<br>✅ **NO cohort restrictions** | ❌ Filters by `converted_date_raw` in date range (line 686-687)<br>✅ Uses `is_sqo_unique = 1` (line 678)<br>✅ Uses `recordtypeid` (line 679)<br>❌ **COHORT RESTRICTION**: Requires SQL date period = SQO date period (lines 673, 680)<br>❌ **WRONG WHERE CLAUSE**: Filters by SQL date instead of SQO date | ❌ **MAJOR DIFFERENCE**:<br>1. Wrong WHERE clause (filters by SQL date, not SQO date)<br>2. Cohort restriction excludes SQOs that SQL'd in different period<br>3. This causes undercounting (e.g., Q4 SQL that became SQO in Q4 but SQL'd in Q3 would be excluded) |
| **Joined** | ✅ Filters by `advisor_join_date__c` in date range<br>✅ Uses `is_joined_unique = 1`<br>✅ **NO cohort restrictions** | ❌ Filters by `Date_Became_SQO__c` in date range (line 747-748)<br>✅ Uses `is_joined_unique = 1` (line 730, 737)<br>❌ **COHORT RESTRICTION**: Requires SQO date period = Joined date period (lines 733, 739)<br>❌ **WRONG WHERE CLAUSE**: Filters by SQO date instead of Joined date | ❌ **MAJOR DIFFERENCE**:<br>1. Wrong WHERE clause (filters by SQO date, not Joined date)<br>2. Cohort restriction excludes Joined that SQO'd in different period<br>3. This causes severe undercounting (e.g., Q4 Joined that SQO'd in Q3 would be excluded) |

### 4.2: Specific Date Field Analysis

**Scorecard Query Date Fields:**
- SQL: `converted_date_raw` ✅
- SQO: `Date_Became_SQO__c` ✅
- Joined: `advisor_join_date__c` ✅

**Trend Chart Query Date Fields (PERIOD mode):**
- SQL: `converted_date_raw` ✅ (correct)
- SQO: `converted_date_raw` ❌ (should be `Date_Became_SQO__c`)
- Joined: `Date_Became_SQO__c` ❌ (should be `advisor_join_date__c`)

### 4.3: Deduplication and Filter Analysis

**Scorecard Query:**
- SQL: No deduplication needed (all SQLs counted)
- SQO: `is_sqo_unique = 1` ✅, `recordtypeid = '012Dn000000mrO3IAI'` ✅
- Joined: `is_joined_unique = 1` ✅

**Trend Chart Query (PERIOD mode):**
- SQL: No deduplication ✅
- SQO: `is_sqo_unique = 1` ✅, `recordtypeid` ✅ (correct)
- Joined: `is_joined_unique = 1` ✅ (correct)

**Verdict**: Deduplication logic is correct in both. The issue is with date field selection and cohort restrictions.

### 4.4: Cohort Restriction Impact

**Example Scenario - Q4 2025:**

**SQO Volume Bug:**
- A record SQL'd in Q3 2025 (`converted_date_raw = '2025-09-15'`)
- Same record became SQO in Q4 2025 (`Date_Became_SQO__c = '2025-10-20'`)
- **Scorecard Query**: ✅ Counts this as Q4 SQO (filters by SQO date)
- **Trend Chart Query**: ❌ Does NOT count this as Q4 SQO because:
  - WHERE clause filters by `converted_date_raw` (Q3), so record is excluded from Q4 query
  - Even if included, the cohort restriction `periodFn(converted_date_raw) = periodFn(Date_Became_SQO__c)` would fail (Q3 ≠ Q4)

**Joined Volume Bug:**
- A record SQO'd in Q3 2025 (`Date_Became_SQO__c = '2025-09-20'`)
- Same record Joined in Q4 2025 (`advisor_join_date__c = '2025-10-15'`)
- **Scorecard Query**: ✅ Counts this as Q4 Joined (filters by Joined date)
- **Trend Chart Query**: ❌ Does NOT count this as Q4 Joined because:
  - WHERE clause filters by `Date_Became_SQO__c` (Q3), so record is excluded from Q4 query
  - Even if included, the cohort restriction `periodFn(Date_Became_SQO__c) = periodFn(advisor_join_date__c)` would fail (Q3 ≠ Q4)

**Impact**: The cohort restrictions cause significant undercounting, especially for SQO and Joined volumes, because many records convert across quarter boundaries.

---

### 4.5: Complete Data Flow Trace

**Step 1: User Interaction**
- User selects Q4 2025 date range
- User clicks "Volume" toggle in ConversionTrendChart
- Component state: `selectedMetric = 'volume'` (line 129 in ConversionTrendChart.tsx)

**Step 2: Dashboard Page Data Fetch**
- `src/app/dashboard/page.tsx` line 132: Calls `dashboardApi.getConversionRates()` with:
  - `filters`: Q4 2025 date range
  - `includeTrends: true`
  - `granularity: 'quarter'` (from state)
  - `mode: 'cohort'` or `'period'` (from state, default 'cohort')

**Step 3: API Client Call**
- `src/lib/api-client.ts` line 98-118: `getConversionRates()` makes POST request to `/api/dashboard/conversion-rates`
- Request body includes: `{ filters, includeTrends: true, granularity: 'quarter', mode: 'cohort' }`

**Step 4: API Route Processing**
- `src/app/api/dashboard/conversion-rates/route.ts` line 43: Calls `getConversionTrends(filters, granularity, mode)`
- Mode is passed through directly (no transformation)

**Step 5: Query Function Execution**
- `src/lib/queries/conversion-rates.ts` line 409: `getConversionTrends()` is called
- Line 504-506: Based on mode, calls either `buildPeriodModeQuery()` or `buildCohortModeQuery()`
- **For PERIOD mode**: `buildPeriodModeQuery()` is called (lines 573-811)

**Step 6: SQL Query Execution (PERIOD Mode)**
- **SQL Volume CTE** (lines 623-636): ✅ Correct - counts by `converted_date_raw`
- **SQO Volume CTE** (lines 664-690): ❌ **BUG HERE**:
  - WHERE clause filters by `converted_date_raw` (line 686-687) - **WRONG**
  - Should filter by `Date_Became_SQO__c`
  - COUNTIF includes cohort restriction (line 673, 680): `periodFn(converted_date_raw) = periodFn(Date_Became_SQO__c)` - **WRONG**
- **Joined Volume CTE** (lines 725-751): ❌ **BUG HERE**:
  - WHERE clause filters by `Date_Became_SQO__c` (line 747-748) - **WRONG**
  - Should filter by `advisor_join_date__c`
  - COUNTIF includes cohort restriction (line 733, 739): `periodFn(Date_Became_SQO__c) = periodFn(advisor_join_date__c)` - **WRONG**

**Step 7: Query Results Transformation**
- Lines 533-558: Results are transformed into `TrendDataPoint[]`
- Volumes are extracted directly: `sqls: toNumber(row.sqls)`, `sqos: toNumber(row.sqos)`, `joined: toNumber(row.joined)`
- No transformation applied - buggy values pass through

**Step 8: API Response**
- `src/app/api/dashboard/conversion-rates/route.ts` line 51: Returns `{ rates, trends, mode }`
- Trends array contains buggy volume values

**Step 9: Component Receives Data**
- `src/app/dashboard/page.tsx` line 140: `setTrends(conversionData.trends || [])`
- Trends array with buggy volumes is stored in state

**Step 10: Chart Rendering**
- `src/components/dashboard/ConversionTrendChart.tsx` line 145-156: Maps trends to chart data
- Line 153-155: Directly uses `t.sqls`, `t.sqos`, `t.joined` from data
- No client-side transformation - buggy values are displayed

**Divergence Point**: The volume counts diverge at **Step 6** (SQL Query Execution) in the `buildPeriodModeQuery()` function. The buggy CTEs for SQO and Joined volumes apply incorrect WHERE clauses and cohort restrictions.

---

### 4.6: Root Cause Summary

**Primary Issues:**
1. **SQO Volume CTE** (`sql_to_sqo_numer`, lines 664-690):
   - ❌ WHERE clause filters by `converted_date_raw` instead of `Date_Became_SQO__c`
   - ❌ Cohort restriction: `periodFn(converted_date_raw) = periodFn(Date_Became_SQO__c)`
   - **Impact**: Excludes SQOs that SQL'd in a different period, causing undercounting

2. **Joined Volume CTE** (`sqo_to_joined_numer`, lines 725-751):
   - ❌ WHERE clause filters by `Date_Became_SQO__c` instead of `advisor_join_date__c`
   - ❌ Cohort restriction: `periodFn(Date_Became_SQO__c) = periodFn(advisor_join_date__c)`
   - **Impact**: Excludes Joined records that SQO'd in a different period, causing severe undercounting

**Why This Happened:**
- The volume CTEs were designed to support "period-resolved" conversion rate calculations
- They were incorrectly reused for volume display, which should be independent of conversion rate logic
- Volumes should always be periodic (count events in period), regardless of mode

**Expected Behavior:**
- Volumes should match the scorecard query pattern: count events by their occurrence date, with no cohort restrictions
- SQLs: Count by `converted_date_raw`
- SQOs: Count by `Date_Became_SQO__c` (with deduplication and record type filter)
- Joined: Count by `advisor_join_date__c` (with deduplication)
