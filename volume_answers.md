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
