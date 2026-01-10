# Conversion Rates Chart Bug Documentation

## ✅ STATUS: RESOLVED

### Resolution Summary
- **Fixed Date**: January 2026
- **Fixed By**: Automated fix via cursor-ai-fix-instructions.md
- **Root Cause**: Cohort restrictions in `getConversionTrends()` excluded cross-period conversions, and Contacted→MQL denominator used incorrect field
- **Solution**: Rewrote function to calculate each metric independently per period using 7 separate CTEs, removed cohort restrictions, and fixed denominator logic

### Validated Results (Q4 2025)
| Metric | Before Fix | After Fix | Expected |
|--------|------------|-----------|----------|
| SQLs | 193 | 193 ✓ | 193 |
| SQOs | 114 | 144 ✓ | 144 |
| Joined | 6 | 17 ✓ | 17 |
| Contacted→MQL | 8.6% | 3.6% ✓ | 3.6% |
| SQL→SQO | 59.1% | 74.6% ✓ | 74.6% |
| SQO→Joined | 4.1% | 11.6% ✓ | 11.6% |

### Key Changes Made
1. **Denominator Fix**: Changed Contacted→MQL denominator from `SUM(eligible_for_contacted_conversions)` to `COUNT(*)` to match scorecard logic
2. **Removed Cohort Restrictions**: SQL→SQO and SQO→Joined no longer require date periods to match - counts all conversions where the conversion date falls in the period
3. **Architecture Change**: Now uses 7 separate CTEs (contacted_to_mql, mql_to_sql_numer, mql_to_sql_denom, sql_to_sqo_numer, sql_to_sqo_denom, sqo_to_joined_numer, sqo_to_joined_denom) joined by period instead of UNION ALL with cohort restrictions
4. **Volume Calculation**: Volumes (SQLs, SQOs, Joined) are now calculated independently using their respective date fields without cohort restrictions

### Implementation Details
- **File Modified**: `src/lib/queries/conversion-rates.ts`
- **Function**: `getConversionTrends(filters, granularity)`
- **Backup Created**: `src/lib/queries/conversion-rates.backup.ts`
- **Reference**: See `cursor-ai-fix-instructions.md` for step-by-step fix process

---

## Original Issue Summary

The Conversion Trends chart displays incorrect conversion rates and volumes that do not align with the scorecard values. When filtering to Q4 2025 with all sources and channels, there are significant discrepancies between the scorecard (which appears correct) and the trend chart.

### Observed Discrepancies for Q4 2025

#### Scorecard Values (Believed to be Correct)
- **Contacted → MQL**: 3.6%
- **MQL → SQL**: 34.2%
- **SQL → SQO**: 74.6%
- **SQO → Joined**: 11.6%

#### Trend Chart Values (Incorrect)
- **Contacted → MQL**: 8.6% (should be 3.6%)
- **MQL → SQL**: 34.2% (matches scorecard ✓)
- **SQL → SQO**: 59.1% (should be 74.6%)
- **SQO → Joined**: 4.1% (should be 11.6%)

#### Volume Discrepancies for Q4 2025

| Metric | Scorecard | Trend Chart | Difference |
|--------|-----------|-------------|------------|
| SQLs   | 193       | 193         | ✓ Correct  |
| SQOs   | 144       | 114         | -30 (-20.8%)|
| Joined | 17        | 6           | -11 (-64.7%)|

## Architecture Overview

### Data Flow

1. **Frontend** (`src/app/dashboard/page.tsx`)
   - Calls API route `/api/dashboard/conversion-rates` with filters
   - Receives both `rates` (for scorecards) and `trends` (for charts)
   - Passes data to `ConversionRateCards` and `ConversionTrendChart` components

2. **API Route** (`src/app/api/dashboard/conversion-rates/route.ts`)
   - Calls `getConversionRates(filters)` for scorecard data
   - Calls `getConversionTrends(filters, granularity)` for chart data
   - Returns both in a single response

3. **Query Functions** (`src/lib/queries/conversion-rates.ts`)
   - `getConversionRates()`: Calculates rates for the selected date range
   - `getConversionTrends()`: Calculates rates for all periods in the selected year

## Scorecard Implementation (Correct)

### Function: `getConversionRates(filters: DashboardFilters)`

**Location**: `src/lib/queries/conversion-rates.ts:8-138`

**Date Range**: Uses `buildDateRangeFromFilters(filters)` to get `startDate` and `endDate` based on the selected filter period (e.g., Q4 2025 = 2025-10-01 to 2025-12-31).

**Query Logic**:

Each conversion rate uses its specific date dimension:

1. **Contacted → MQL**
   - **Numerator**: `COUNTIF(stage_entered_contacting__c IN date range AND is_mql = 1)`
   - **Denominator**: `COUNTIF(stage_entered_contacting__c IN date range)`
   - **Date Field**: `stage_entered_contacting__c`

2. **MQL → SQL**
   - **Numerator**: `COUNTIF(converted_date_raw IN date range AND is_sql = 1)`
   - **Denominator**: `COUNTIF(stage_entered_contacting__c IN date range AND is_mql = 1)`
   - **Date Fields**: Numerator uses `converted_date_raw`, Denominator uses `stage_entered_contacting__c`

3. **SQL → SQO**
   - **Numerator**: `COUNTIF(Date_Became_SQO__c IN date range AND recordtypeid = recruitingRecordType AND is_sqo_unique = 1)`
   - **Denominator**: `COUNTIF(converted_date_raw IN date range AND is_sql = 1)`
   - **Date Fields**: Numerator uses `Date_Became_SQO__c`, Denominator uses `converted_date_raw`

4. **SQO → Joined**
   - **Numerator**: `COUNTIF(advisor_join_date__c IN date range AND is_joined_unique = 1)`
   - **Denominator**: `COUNTIF(Date_Became_SQO__c IN date range AND recordtypeid = recruitingRecordType AND LOWER(SQO_raw) = 'yes')`
   - **Date Fields**: Numerator uses `advisor_join_date__c`, Denominator uses `Date_Became_SQO__c`

**Key Points**:
- All calculations are done in a single query
- Filters (channel, source, SGA, SGM) are applied via WHERE clause
- Date range is applied to each date field independently
- Uses actual counts (`COUNTIF`) not progression flags

## Trend Chart Implementation (Incorrect)

### Function: `getConversionTrends(filters: DashboardFilters, granularity: 'month' | 'quarter')`

**Location**: `src/lib/queries/conversion-rates.ts:140-386`

**Date Range**: 
- Expands to full year: `trendStartDate = 'YYYY-01-01'`, `trendEndDate = 'YYYY-12-31 23:59:59'`
- Uses the year from the selected filter period
- Example: If filter is Q4 2025, trend chart shows Q1-Q4 2025

**Query Structure**:

Uses multiple CTEs (Common Table Expressions) with `UNION ALL`:

1. **`contacted_to_mql_periods`**
   - Groups by: `FORMAT_DATE('%Y-%m', DATE(stage_entered_contacting__c))` or quarter equivalent
   - Numerator: `COUNTIF(is_mql = 1)`
   - Denominator: `SUM(eligible_for_contacted_conversions)`
   - **Issue**: Uses `eligible_for_contacted_conversions` instead of `COUNT(*)` like scorecard

2. **`mql_to_sql_periods`**
   - Groups by: `FORMAT_DATE('%Y-%m', DATE(converted_date_raw))` or quarter equivalent
   - Numerator: `COUNTIF(is_sql = 1)` where `converted_date_raw` is in period
   - Denominator: 0 (joined from separate CTE)

3. **`mql_to_sql_denom_periods`**
   - Groups by: `FORMAT_DATE('%Y-%m', DATE(stage_entered_contacting__c))` or quarter equivalent
   - Denominator: `COUNTIF(is_mql = 1)` where `stage_entered_contacting__c` is in period
   - **Issue**: Periods from numerator (based on `converted_date_raw`) may not match periods from denominator (based on `stage_entered_contacting__c`)

4. **`sql_to_sqo_periods`**
   - Groups by: `FORMAT_DATE('%Y-%m', DATE(converted_date_raw))` or quarter equivalent
   - Numerator: `COUNTIF(Date_Became_SQO__c period = converted_date_raw period AND is_sqo_unique = 1)`
   - Denominator: `COUNTIF(is_sql = 1)` where `converted_date_raw` is in period
   - **Issue**: Only counts SQOs where `Date_Became_SQO__c` period matches `converted_date_raw` period (cohort restriction)
   - **Issue**: This is why volumes are wrong - SQOs that became SQO in a different period than when they converted to SQL are excluded

5. **`sqo_to_joined_periods`**
   - Groups by: `FORMAT_DATE('%Y-%m', DATE(Date_Became_SQO__c))` or quarter equivalent
   - Numerator: `COUNTIF(advisor_join_date__c period = Date_Became_SQO__c period AND is_joined_unique = 1)`
   - Denominator: `COUNTIF(recordtypeid = recruitingRecordType AND LOWER(SQO_raw) = 'yes')`
   - **Issue**: Only counts Joined where `advisor_join_date__c` period matches `Date_Became_SQO__c` period (cohort restriction)
   - **Issue**: This is why volumes are wrong - Joined that joined in a different period than when they became SQO are excluded

**Final SELECT**:
```sql
SELECT
  ap.period,
  ap.sqls,
  ap.sqos,
  ap.joined,
  ap.contacted_to_mql_numer,
  ap.contacted_to_mql_denom,
  ap.mql_to_sql_numer,
  COALESCE(md.mql_count, 0) as mql_to_sql_denom,
  ap.sql_to_sqo_numer,
  ap.sql_to_sqo_denom,
  ap.sqo_to_joined_numer,
  ap.sqo_to_joined_denom
FROM aggregated_periods ap
LEFT JOIN mql_to_sql_denom_periods md ON ap.period = md.period
ORDER BY ap.period
```

**Key Issues**:

1. **Period Mismatch**: Numerators and denominators are grouped by different date fields, so periods may not align when joined
   - Example: MQL→SQL numerator grouped by `converted_date_raw` period, but denominator grouped by `stage_entered_contacting__c` period
   - If an MQL from October converts to SQL in November, the numerator appears in November but denominator in October

2. **Cohort Restrictions**: SQL→SQO and SQO→Joined only count conversions where both dates fall in the same period
   - This artificially restricts counts and causes volume discrepancies
   - A SQL that converted in Q3 but became SQO in Q4 won't be counted in either period

3. **Different Denominator Logic**: Contacted→MQL uses `SUM(eligible_for_contacted_conversions)` instead of `COUNT(*)` like the scorecard

4. **Volume Calculation**: Volumes (SQLs, SQOs, Joined) are calculated within the same CTEs that calculate rates, but with cohort restrictions applied

## Component Implementation

### ConversionRateCards Component

**Location**: `src/components/dashboard/ConversionRateCards.tsx`

- Simply displays the rates returned from `getConversionRates()`
- No data transformation
- Shows rate, numerator, and denominator

### ConversionTrendChart Component

**Location**: `src/components/dashboard/ConversionTrendChart.tsx`

- Maps trend data points to chart format
- Converts rates from decimal (0-1) to percentage (0-100) by multiplying by 100
- Displays volumes (SQLs, SQOs, Joined) directly from trend data
- No data transformation beyond formatting

## Debugging Attempts

### Attempt 1: Initial Implementation
- **Issue**: Charts not showing at all
- **Fix**: Removed conditional rendering, ensured chart always renders

### Attempt 2: Chart Library Issues
- **Issue**: Tremor charts not rendering, showing "00%"
- **Fix**: Switched from Tremor to Recharts library

### Attempt 3: Rate Calculation Issues
- **Issue**: Rates showing 0% or 100% incorrectly
- **Fix**: Fixed rate conversion from decimal to percentage in component

### Attempt 4: Denominator Alignment
- **Issue**: MQL→SQL showing >100% rates
- **Fix**: Changed denominator to use `stage_entered_contacting__c` instead of `FilterDate`

### Attempt 5: SQO→Joined Denominator
- **Issue**: SQO→Joined showing 94% instead of ~15%
- **Fix**: Changed denominator to use `Date_Became_SQO__c` instead of `advisor_join_date__c`

### Attempt 6: Cohort-Based Approach
- **Issue**: Rates still not matching scorecard
- **Fix**: Implemented cohort-based approach where conversions only count if both dates fall in same period
- **Result**: This caused volume discrepancies (SQOs and Joined counts dropped)

### Attempt 7: Period Alignment for MQL→SQL
- **Issue**: MQL→SQL numerator and denominator grouped by different date fields
- **Fix**: Separated numerator (grouped by `converted_date_raw`) and denominator (grouped by `stage_entered_contacting__c`) into separate CTEs, then joined by period
- **Result**: Still has period mismatch issues when dates don't align

## Root Cause Analysis

### Primary Issues

1. **Period Grouping Mismatch**
   - Trend chart groups numerators and denominators by different date fields
   - When joined by period, periods may not match (e.g., MQL from Oct, SQL in Nov)
   - This causes incorrect rate calculations

2. **Cohort Restrictions**
   - SQL→SQO and SQO→Joined only count conversions where both dates fall in the same period
   - This excludes valid conversions that span periods
   - Causes volume discrepancies (114 SQOs vs 144, 6 Joined vs 17)

3. **Inconsistent Denominator Logic**
   - Contacted→MQL uses `eligible_for_contacted_conversions` in trend chart but `COUNT(*)` in scorecard
   - This may cause rate discrepancies

4. **Volume Calculation in Rate CTEs**
   - Volumes are calculated within the same CTEs that calculate rates
   - Cohort restrictions applied to rates also affect volumes
   - Should volumes be calculated independently?

### Expected Behavior

For Q4 2025, the trend chart should show:
- **Contacted → MQL**: 3.6% (same as scorecard)
- **MQL → SQL**: 34.2% (matches scorecard ✓)
- **SQL → SQO**: 74.6% (same as scorecard)
- **SQO → Joined**: 11.6% (same as scorecard)
- **Volumes**: 193 SQLs, 144 SQOs, 17 Joined (same as scorecard)

## Proposed Solutions

### Option 1: Match Scorecard Logic Exactly
- For each period, calculate rates using the same logic as scorecard
- Apply the date range filter to each period independently
- Remove cohort restrictions
- Use `COUNT(*)` instead of `eligible_for_*` fields

### Option 2: Separate Volume Calculation
- Calculate volumes independently from rates
- Use the same date field for grouping volumes as used in scorecard
- Remove cohort restrictions from volume calculations

### Option 3: Period-Based Rate Calculation
- For each period, calculate the rate as: conversions in that period / eligible pool in that period
- Use the same date field for both numerator and denominator grouping
- This may require rethinking the date field used for each rate

### Option 4: Cohort Analysis with Lag
- Track conversions across periods (e.g., MQL from Oct that converts in Nov)
- Calculate rates based on when conversions actually happened, not when they entered the stage
- This is more complex but may be more accurate

## Questions for Further Investigation

1. Should the trend chart show rates based on when conversions happened (numerator date) or when records entered the stage (denominator date)?
2. Should volumes be calculated independently from rates, or should they match the rate calculation logic?
3. For SQL→SQO, should we count all SQOs that became SQO in a period, or only those that converted from SQL in the same period?
4. Should the trend chart use the same denominator logic as the scorecard (`COUNT(*)` vs `eligible_for_*` fields)?
5. How should we handle conversions that span multiple periods (e.g., MQL in Oct, SQL in Nov)?

## Files Involved

- `src/lib/queries/conversion-rates.ts` - Core query logic
- `src/components/dashboard/ConversionRateCards.tsx` - Scorecard display
- `src/components/dashboard/ConversionTrendChart.tsx` - Chart display
- `src/app/api/dashboard/conversion-rates/route.ts` - API endpoint
- `src/app/dashboard/page.tsx` - Dashboard page that calls API
- `src/types/dashboard.ts` - Type definitions
- `src/types/bigquery-raw.ts` - Raw query result types

## Next Steps

1. Verify the scorecard calculations are correct by comparing against BigQuery view `vw_funnel_master`
2. Test trend chart query directly in BigQuery to see raw results
3. Compare period-by-period calculations between scorecard and trend chart
4. Determine the correct date field to use for grouping each rate in the trend chart
5. Remove cohort restrictions or implement proper cohort tracking across periods
6. Ensure volume calculations match scorecard logic
