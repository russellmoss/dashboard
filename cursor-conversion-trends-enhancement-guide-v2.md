# Cursor AI Implementation Guide: Conversion Trends Chart Enhancements (v2)

## Overview

This guide provides step-by-step instructions to implement two key enhancements to the Conversion Trends Chart:

1. **Rolling Window Date Logic**: Show selected period + 3 quarters back (or 12+ months back for monthly granularity)
2. **Period vs Cohort Mode Toggle**: Allow users to switch between activity-based and efficiency-based views with explanatory tooltips

## Key Insight: Resolved-Only Cohort Logic

The `vw_funnel_master` view already has pre-calculated fields that implement **resolved-only logic**:

| Conversion | Eligibility Field (Denominator) | Progression Field (Numerator) | Cohort Date Field |
|------------|--------------------------------|------------------------------|-------------------|
| Contacted→MQL | `eligible_for_contacted_conversions` | `contacted_to_mql_progression` | `stage_entered_contacting__c` |
| MQL→SQL | `eligible_for_mql_conversions` | `mql_to_sql_progression` | `stage_entered_contacting__c` |
| SQL→SQO | `eligible_for_sql_conversions` | `sql_to_sqo_progression` | `converted_date_raw` |
| SQO→Joined | `eligible_for_sqo_conversions` | `sqo_to_joined_progression` | `Date_Became_SQO__c` |

**What "resolved" means:**
- A record is **resolved** when it either progressed to the next stage OR was closed/lost
- Open records (still in progress) are **excluded** from cohort denominators
- This prevents recent periods from showing artificially low rates

**Benefits of using these fields:**
- No warning banner needed for recent periods
- Rates are always 0-100%
- Uses battle-tested logic from the view
- Simpler SQL queries

---

## Implementation Order

**CRITICAL**: Follow this exact order to avoid breaking changes:

1. Phase 1: Add utility functions (no breaking changes)
2. Phase 2: Update types (no breaking changes)
3. Phase 3: Update query function (backward compatible)
4. Phase 4: Update API route (backward compatible)
5. Phase 5: Update API client (backward compatible)
6. Phase 6: Update UI component (all pieces in place)

---

## Phase 1: Add Utility Functions

### File: `src/lib/utils/date-helpers.ts`

Add these new functions at the end of the file (after existing exports):

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ROLLING WINDOW UTILITIES FOR CONVERSION TRENDS CHART
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/**
 * Extract quarter information from a date string or Date object
 */
export function getQuarterFromDate(date: string | Date): { year: number; quarter: number } {
  const d = typeof date === 'string' ? new Date(date) : date;
  const month = d.getMonth(); // 0-11
  const quarter = Math.floor(month / 3) + 1; // 1-4
  return { year: d.getFullYear(), quarter };
}

/**
 * Get the number of days in a specific month
 */
export function getDaysInMonth(year: number, month: number): number {
  // month is 1-12
  return new Date(year, month, 0).getDate();
}

/**
 * Calculate the rolling window of quarters for the trend chart
 * Shows selected quarter + 3 quarters behind it (4 quarters total)
 * 
 * @example
 * Q1 2026 selected → Q2 2025, Q3 2025, Q4 2025, Q1 2026
 * Q4 2025 selected → Q1 2025, Q2 2025, Q3 2025, Q4 2025
 */
export function calculateQuarterRollingWindow(
  selectedYear: number,
  selectedQuarter: number
): { year: number; quarter: number }[] {
  const quarters: { year: number; quarter: number }[] = [];
  
  for (let i = 3; i >= 0; i--) {
    let q = selectedQuarter - i;
    let year = selectedYear;
    
    // Handle year boundary (if q <= 0, go to previous year)
    if (q <= 0) {
      q = q + 4;
      year = selectedYear - 1;
    }
    
    quarters.push({ year, quarter: q });
  }
  
  return quarters;
}

/**
 * Calculate the rolling window of months for the trend chart
 * Shows 12 months back from the start of the selected quarter + completed months in selected quarter
 * 
 * @example
 * Q1 2026 selected, today = Feb 15, 2026 → Feb 2025 - Feb 2026 (13 months)
 * Q4 2025 selected, today = Dec 20, 2025 → Nov 2024 - Dec 2025 (14 months)
 */
export function calculateMonthRollingWindow(
  selectedYear: number,
  selectedQuarter: number
): { year: number; month: number }[] {
  const today = new Date();
  const months: { year: number; month: number }[] = [];
  
  // Get the first month of the selected quarter
  const quarterStartMonth = (selectedQuarter - 1) * 3 + 1; // 1, 4, 7, or 10
  
  // Calculate 12 months back from the quarter start month
  for (let i = 11; i >= 0; i--) {
    const date = new Date(selectedYear, quarterStartMonth - 1 - i, 1);
    months.push({ year: date.getFullYear(), month: date.getMonth() + 1 });
  }
  
  // Add months in the selected quarter that are completed or current
  for (let m = quarterStartMonth; m < quarterStartMonth + 3; m++) {
    const quarterDate = new Date(selectedYear, m - 1, 1);
    // Only add if this month is in the past or current month
    if (quarterDate <= today) {
      // Check if already added (the 12 months back might overlap)
      const alreadyExists = months.some(
        existing => existing.year === quarterDate.getFullYear() && existing.month === m
      );
      if (!alreadyExists) {
        months.push({ year: quarterDate.getFullYear(), month: m });
      }
    }
  }
  
  // Sort chronologically
  months.sort((a, b) => {
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
  
  return months;
}

/**
 * Get the date range for a rolling window of quarters
 * Returns startDate (first day of first quarter) and endDate (last day of last quarter)
 */
export function getQuarterWindowDateRange(
  quarters: { year: number; quarter: number }[]
): { startDate: string; endDate: string } {
  if (quarters.length === 0) {
    const now = new Date();
    return { startDate: now.toISOString().split('T')[0], endDate: now.toISOString().split('T')[0] };
  }
  
  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  
  // First day of first quarter
  const startMonth = (first.quarter - 1) * 3 + 1;
  const startDate = `${first.year}-${String(startMonth).padStart(2, '0')}-01`;
  
  // Last day of last quarter
  const endMonth = last.quarter * 3;
  const endDay = getDaysInMonth(last.year, endMonth);
  const endDate = `${last.year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  
  return { startDate, endDate };
}

/**
 * Get the date range for a rolling window of months
 */
export function getMonthWindowDateRange(
  months: { year: number; month: number }[]
): { startDate: string; endDate: string } {
  if (months.length === 0) {
    const now = new Date();
    return { startDate: now.toISOString().split('T')[0], endDate: now.toISOString().split('T')[0] };
  }
  
  const first = months[0];
  const last = months[months.length - 1];
  
  const startDate = `${first.year}-${String(first.month).padStart(2, '0')}-01`;
  
  const endDay = getDaysInMonth(last.year, last.month);
  const endDate = `${last.year}-${String(last.month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
  
  return { startDate, endDate };
}

/**
 * Format a quarter to string: "2025-Q4"
 */
export function formatQuarterString(year: number, quarter: number): string {
  return `${year}-Q${quarter}`;
}

/**
 * Format a month to string: "2025-01"
 */
export function formatMonthString(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}
```

---

## Phase 2: Update Types

### File: `src/types/dashboard.ts`

Add this new type after the existing type definitions (around line 10, after FunnelMetrics):

```typescript
/**
 * Mode for conversion trends chart:
 * - 'period': Activity-based view - "What happened in this period?"
 * - 'cohort': Efficiency-based view - "How well do leads from this period convert?" (resolved-only)
 */
export type ConversionTrendMode = 'period' | 'cohort';
```

Also update the TrendDataPoint interface to add optional flags:

```typescript
export interface TrendDataPoint {
  period: string;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
  isSelectedPeriod?: boolean; // Flag for highlighting the selected period in the chart
}
```

---

## Phase 3: Update Query Function

### File: `src/lib/queries/conversion-rates.ts`

**Step 3.1**: Update imports at the top of the file:

```typescript
import { 
  buildDateRangeFromFilters,
  getQuarterFromDate,
  calculateQuarterRollingWindow,
  calculateMonthRollingWindow,
  getQuarterWindowDateRange,
  getMonthWindowDateRange,
  formatQuarterString,
  formatMonthString
} from '../utils/date-helpers';
```

**Step 3.2**: Replace the existing `getConversionTrends` function with this enhanced version:

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * getConversionTrends - ENHANCED VERSION WITH ROLLING WINDOW + DUAL MODE
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This function calculates conversion rates and volumes per period for the
 * trend chart visualization. Supports:
 * 
 * 1. ROLLING WINDOW: Shows selected period + 3 quarters back (quarterly)
 *    or 12 months back + completed months in selected quarter (monthly)
 * 
 * 2. DUAL MODE SUPPORT:
 * 
 *    PERIOD MODE (Activity-Based):
 *    - "What happened in this period?"
 *    - Groups numerators and denominators by their respective date fields
 *    - Includes ALL records, regardless of resolution status
 *    - Rates can exceed 100% if converting older leads
 *    - Best for: Activity tracking, sales performance, executive dashboards
 * 
 *    COHORT MODE (Efficiency-Based, Resolved-Only):
 *    - "How well do leads from this period convert?"
 *    - Uses pre-calculated eligibility fields from vw_funnel_master
 *    - ONLY includes resolved records (converted OR closed/lost)
 *    - Open records are excluded from denominators
 *    - Rates are always 0-100%
 *    - Best for: Funnel efficiency, forecasting, process improvement
 * 
 * COHORT MODE FIELD MAPPING (from vw_funnel_master):
 * ───────────────────────────────────────────────────────────────────────────────
 * | Conversion     | Denominator Field                  | Numerator Field              | Cohort Date           |
 * |----------------|-----------------------------------|-----------------------------|-----------------------|
 * | Contacted→MQL  | eligible_for_contacted_conversions | contacted_to_mql_progression | stage_entered_contacting__c |
 * | MQL→SQL        | eligible_for_mql_conversions       | mql_to_sql_progression       | stage_entered_contacting__c |
 * | SQL→SQO        | eligible_for_sql_conversions       | sql_to_sqo_progression       | converted_date_raw    |
 * | SQO→Joined     | eligible_for_sqo_conversions       | sqo_to_joined_progression    | Date_Became_SQO__c    |
 * 
 * @param filters - Dashboard filters (channel, source, SGA, SGM, date range)
 * @param granularity - 'month' or 'quarter' for period grouping
 * @param mode - 'period' (default) or 'cohort' for calculation mode
 * @returns Array of TrendDataPoint objects, one per period
 */
export async function getConversionTrends(
  filters: DashboardFilters,
  granularity: 'month' | 'quarter' = 'month',
  mode: 'period' | 'cohort' = 'period'
): Promise<TrendDataPoint[]> {
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: CALCULATE ROLLING WINDOW DATE RANGE
  // ═══════════════════════════════════════════════════════════════════════════
  const { startDate: selectedStartDate, endDate: selectedEndDate } = buildDateRangeFromFilters(filters);
  const { year: selectedYear, quarter: selectedQuarter } = getQuarterFromDate(selectedStartDate);
  
  // Calculate the periods to show based on granularity
  let trendStartDate: string;
  let trendEndDate: string;
  let expectedPeriods: string[];
  let selectedPeriodString: string;
  
  if (granularity === 'quarter') {
    // Quarterly: Selected quarter + 3 quarters back
    const quarters = calculateQuarterRollingWindow(selectedYear, selectedQuarter);
    const dateRange = getQuarterWindowDateRange(quarters);
    trendStartDate = dateRange.startDate;
    trendEndDate = dateRange.endDate + ' 23:59:59';
    expectedPeriods = quarters.map(q => formatQuarterString(q.year, q.quarter));
    selectedPeriodString = formatQuarterString(selectedYear, selectedQuarter);
  } else {
    // Monthly: 12 months back + completed months in selected quarter
    const months = calculateMonthRollingWindow(selectedYear, selectedQuarter);
    const dateRange = getMonthWindowDateRange(months);
    trendStartDate = dateRange.startDate;
    trendEndDate = dateRange.endDate + ' 23:59:59';
    expectedPeriods = months.map(m => formatMonthString(m.year, m.month));
    // For monthly, the selected period is any month in the selected quarter
    const quarterStartMonth = (selectedQuarter - 1) * 3 + 1;
    selectedPeriodString = formatMonthString(selectedYear, quarterStartMonth);
  }
  
  console.log(`[getConversionTrends] Rolling window: ${trendStartDate} to ${trendEndDate}`);
  console.log(`[getConversionTrends] Expected periods: ${expectedPeriods.join(', ')}`);
  console.log(`[getConversionTrends] Mode: ${mode}, Granularity: ${granularity}`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: BUILD FILTER CONDITIONS
  // ═══════════════════════════════════════════════════════════════════════════
  const conditions: string[] = [];
  const params: Record<string, any> = {
    trendStartDate,
    trendEndDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  if (filters.channel) {
    conditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') = @channel');
    params.channel = filters.channel;
  }
  if (filters.source) {
    conditions.push('v.Original_source = @source');
    params.source = filters.source;
  }
  if (filters.sga) {
    conditions.push('v.SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }
  if (filters.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }
  
  const filterWhereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: BUILD PERIOD FORMAT SQL
  // ═══════════════════════════════════════════════════════════════════════════
  const periodFormat = granularity === 'month' 
    ? `FORMAT_DATE('%Y-%m', DATE(DATE_FIELD))`
    : `CONCAT(CAST(EXTRACT(YEAR FROM DATE_FIELD) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM DATE_FIELD) AS STRING))`;
  
  const periodFn = (dateField: string) => periodFormat.replace(/DATE_FIELD/g, dateField);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: BUILD AND EXECUTE QUERY BASED ON MODE
  // ═══════════════════════════════════════════════════════════════════════════
  const query = mode === 'cohort' 
    ? buildCohortModeQuery(periodFn, filterWhereClause, expectedPeriods, granularity)
    : buildPeriodModeQuery(periodFn, filterWhereClause, expectedPeriods, granularity);
  
  const results = await runQuery<RawConversionTrendResult>(query, params);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: TRANSFORM RESULTS AND ENSURE ALL PERIODS ARE PRESENT
  // ═══════════════════════════════════════════════════════════════════════════
  const resultMap = new Map<string, TrendDataPoint>();
  
  // Initialize all expected periods with zeros
  for (const period of expectedPeriods) {
    resultMap.set(period, {
      period,
      sqls: 0,
      sqos: 0,
      joined: 0,
      contactedToMqlRate: 0,
      mqlToSqlRate: 0,
      sqlToSqoRate: 0,
      sqoToJoinedRate: 0,
      isSelectedPeriod: granularity === 'quarter' 
        ? period === selectedPeriodString
        : period.startsWith(formatMonthString(selectedYear, (selectedQuarter - 1) * 3 + 1).slice(0, 7)),
    });
  }
  
  // Populate with actual results
  for (const row of results) {
    if (!row.period) continue;
    
    const safeDiv = (n: number, d: number) => (d === 0 ? 0 : n / d);
    
    const numer_c2m = toNumber(row.contacted_to_mql_numer);
    const denom_c2m = toNumber(row.contacted_to_mql_denom);
    const numer_m2s = toNumber(row.mql_to_sql_numer);
    const denom_m2s = toNumber(row.mql_to_sql_denom);
    const numer_s2sq = toNumber(row.sql_to_sqo_numer);
    const denom_s2sq = toNumber(row.sql_to_sqo_denom);
    const numer_sq2j = toNumber(row.sqo_to_joined_numer);
    const denom_sq2j = toNumber(row.sqo_to_joined_denom);
    
    resultMap.set(row.period, {
      period: row.period,
      sqls: toNumber(row.sqls),
      sqos: toNumber(row.sqos),
      joined: toNumber(row.joined),
      contactedToMqlRate: safeDiv(numer_c2m, denom_c2m),
      mqlToSqlRate: safeDiv(numer_m2s, denom_m2s),
      sqlToSqoRate: safeDiv(numer_s2sq, denom_s2sq),
      sqoToJoinedRate: safeDiv(numer_sq2j, denom_sq2j),
      isSelectedPeriod: resultMap.get(row.period)?.isSelectedPeriod || false,
    });
  }
  
  // Convert to array and sort chronologically
  const finalResults = Array.from(resultMap.values()).sort((a, b) => 
    a.period.localeCompare(b.period)
  );
  
  console.log(`[getConversionTrends] Returning ${finalResults.length} periods`);
  
  return finalResults;
}

/**
 * Build the SQL query for PERIOD MODE (activity-based)
 * Each metric uses its own date field for grouping
 * Includes ALL records, regardless of resolution status
 */
function buildPeriodModeQuery(
  periodFn: (field: string) => string,
  filterWhereClause: string,
  expectedPeriods: string[],
  granularity: 'month' | 'quarter'
): string {
  return `
    -- ═══════════════════════════════════════════════════════════════════════════
    -- PERIOD MODE: Activity-based conversion tracking
    -- "What happened in this period?"
    -- Each metric grouped by its own date field (no cohort restrictions)
    -- Includes ALL records, regardless of resolution status
    -- ═══════════════════════════════════════════════════════════════════════════
    
    -- CTE 1: CONTACTED→MQL (both numerator and denominator by stage_entered_contacting__c)
    WITH contacted_to_mql AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        COUNTIF(v.is_mql = 1) as contacted_to_mql_numer,
        COUNT(*) as contacted_to_mql_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- CTE 2: MQL→SQL NUMERATOR (by converted_date_raw) + SQL volumes
    mql_to_sql_numer AS (
      SELECT
        ${periodFn('v.converted_date_raw')} as period,
        COUNTIF(v.is_sql = 1) as mql_to_sql_numer,
        COUNTIF(v.is_sql = 1) as sqls
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- CTE 3: MQL→SQL DENOMINATOR (by stage_entered_contacting__c)
    mql_to_sql_denom AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        COUNTIF(v.is_mql = 1) as mql_to_sql_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- CTE 4: SQL→SQO NUMERATOR (by Date_Became_SQO__c) + SQO volumes
    sql_to_sqo_numer AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNTIF(v.recordtypeid = @recruitingRecordType AND v.is_sqo_unique = 1) as sql_to_sqo_numer,
        COUNTIF(v.recordtypeid = @recruitingRecordType AND v.is_sqo_unique = 1) as sqos
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- CTE 5: SQL→SQO DENOMINATOR (by converted_date_raw)
    sql_to_sqo_denom AS (
      SELECT
        ${periodFn('v.converted_date_raw')} as period,
        COUNTIF(v.is_sql = 1) as sql_to_sqo_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- CTE 6: SQO→JOINED NUMERATOR (by advisor_join_date__c) + Joined volumes
    sqo_to_joined_numer AS (
      SELECT
        ${periodFn('v.advisor_join_date__c')} as period,
        COUNTIF(v.is_joined_unique = 1) as sqo_to_joined_numer,
        COUNTIF(v.is_joined_unique = 1) as joined
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.advisor_join_date__c IS NOT NULL
        AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- CTE 7: SQO→JOINED DENOMINATOR (by Date_Became_SQO__c)
    sqo_to_joined_denom AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNTIF(v.recordtypeid = @recruitingRecordType AND LOWER(v.SQO_raw) = 'yes') as sqo_to_joined_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- Generate all expected periods
    all_periods AS (
      SELECT period FROM UNNEST([${expectedPeriods.map(p => `'${p}'`).join(', ')}]) as period
    )
    
    -- Join all CTEs
    SELECT
      ap.period,
      COALESCE(c2m.contacted_to_mql_numer, 0) as contacted_to_mql_numer,
      COALESCE(c2m.contacted_to_mql_denom, 0) as contacted_to_mql_denom,
      COALESCE(m2s_n.mql_to_sql_numer, 0) as mql_to_sql_numer,
      COALESCE(m2s_d.mql_to_sql_denom, 0) as mql_to_sql_denom,
      COALESCE(s2sq_n.sql_to_sqo_numer, 0) as sql_to_sqo_numer,
      COALESCE(s2sq_d.sql_to_sqo_denom, 0) as sql_to_sqo_denom,
      COALESCE(sq2j_n.sqo_to_joined_numer, 0) as sqo_to_joined_numer,
      COALESCE(sq2j_d.sqo_to_joined_denom, 0) as sqo_to_joined_denom,
      COALESCE(m2s_n.sqls, 0) as sqls,
      COALESCE(s2sq_n.sqos, 0) as sqos,
      COALESCE(sq2j_n.joined, 0) as joined
    FROM all_periods ap
    LEFT JOIN contacted_to_mql c2m ON ap.period = c2m.period
    LEFT JOIN mql_to_sql_numer m2s_n ON ap.period = m2s_n.period
    LEFT JOIN mql_to_sql_denom m2s_d ON ap.period = m2s_d.period
    LEFT JOIN sql_to_sqo_numer s2sq_n ON ap.period = s2sq_n.period
    LEFT JOIN sql_to_sqo_denom s2sq_d ON ap.period = s2sq_d.period
    LEFT JOIN sqo_to_joined_numer sq2j_n ON ap.period = sq2j_n.period
    LEFT JOIN sqo_to_joined_denom sq2j_d ON ap.period = sq2j_d.period
    ORDER BY ap.period
  `;
}

/**
 * Build the SQL query for COHORT MODE (efficiency-based, resolved-only)
 * Uses pre-calculated eligibility and progression fields from vw_funnel_master
 * ONLY includes resolved records (converted OR closed/lost)
 * Open records are excluded from denominators
 */
function buildCohortModeQuery(
  periodFn: (field: string) => string,
  filterWhereClause: string,
  expectedPeriods: string[],
  granularity: 'month' | 'quarter'
): string {
  return `
    -- ═══════════════════════════════════════════════════════════════════════════
    -- COHORT MODE: Efficiency-based conversion tracking (RESOLVED-ONLY)
    -- "How well do leads from this period convert?"
    -- Uses pre-calculated eligibility fields from vw_funnel_master
    -- ONLY includes resolved records (converted OR closed/lost)
    -- Open records are EXCLUDED from denominators
    -- ═══════════════════════════════════════════════════════════════════════════
    
    -- CTE 1: CONTACTED COHORT (by stage_entered_contacting__c)
    -- Uses eligible_for_contacted_conversions (resolved only) and contacted_to_mql_progression
    WITH contacted_cohort AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        SUM(v.eligible_for_contacted_conversions) as eligible_contacts,
        SUM(v.contacted_to_mql_progression) as progressed_to_mql
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- CTE 2: MQL COHORT (by stage_entered_contacting__c)
    -- Uses eligible_for_mql_conversions (resolved only) and mql_to_sql_progression
    mql_cohort AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        SUM(v.eligible_for_mql_conversions) as eligible_mqls,
        SUM(v.mql_to_sql_progression) as progressed_to_sql
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- CTE 3: SQL COHORT (by converted_date_raw)
    -- Uses eligible_for_sql_conversions (resolved only) and sql_to_sqo_progression
    sql_cohort AS (
      SELECT
        ${periodFn('v.converted_date_raw')} as period,
        SUM(v.eligible_for_sql_conversions) as eligible_sqls,
        SUM(v.sql_to_sqo_progression) as progressed_to_sqo,
        COUNTIF(v.is_sql = 1) as sqls  -- Volume: all SQLs (for display)
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- CTE 4: SQO COHORT (by Date_Became_SQO__c)
    -- Uses eligible_for_sqo_conversions (resolved only) and sqo_to_joined_progression
    sqo_cohort AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        SUM(v.eligible_for_sqo_conversions) as eligible_sqos,
        SUM(v.sqo_to_joined_progression) as progressed_to_joined,
        COUNTIF(v.recordtypeid = @recruitingRecordType AND v.is_sqo_unique = 1) as sqos,
        COUNTIF(v.is_joined_unique = 1) as joined  -- Volume: joined (for display)
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- Generate all expected periods
    all_periods AS (
      SELECT period FROM UNNEST([${expectedPeriods.map(p => `'${p}'`).join(', ')}]) as period
    )
    
    -- Join all cohort CTEs
    SELECT
      ap.period,
      
      -- Contacted→MQL: Resolved contacts that became MQL / Resolved contacts
      COALESCE(cc.progressed_to_mql, 0) as contacted_to_mql_numer,
      COALESCE(cc.eligible_contacts, 0) as contacted_to_mql_denom,
      
      -- MQL→SQL: Resolved MQLs that became SQL / Resolved MQLs
      COALESCE(mc.progressed_to_sql, 0) as mql_to_sql_numer,
      COALESCE(mc.eligible_mqls, 0) as mql_to_sql_denom,
      
      -- SQL→SQO: Resolved SQLs that became SQO / Resolved SQLs
      COALESCE(sc.progressed_to_sqo, 0) as sql_to_sqo_numer,
      COALESCE(sc.eligible_sqls, 0) as sql_to_sqo_denom,
      
      -- SQO→Joined: Resolved SQOs that Joined / Resolved SQOs
      COALESCE(sqc.progressed_to_joined, 0) as sqo_to_joined_numer,
      COALESCE(sqc.eligible_sqos, 0) as sqo_to_joined_denom,
      
      -- Volumes (for display purposes - all records, not just resolved)
      COALESCE(sc.sqls, 0) as sqls,
      COALESCE(sqc.sqos, 0) as sqos,
      COALESCE(sqc.joined, 0) as joined
      
    FROM all_periods ap
    LEFT JOIN contacted_cohort cc ON ap.period = cc.period
    LEFT JOIN mql_cohort mc ON ap.period = mc.period
    LEFT JOIN sql_cohort sc ON ap.period = sc.period
    LEFT JOIN sqo_cohort sqc ON ap.period = sqc.period
    ORDER BY ap.period
  `;
}
```

---

## Phase 4: Update API Route

### File: `src/app/api/dashboard/conversion-rates/route.ts`

Update the POST handler to accept the mode parameter:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getConversionRates, getConversionTrends } from '@/lib/queries/conversion-rates';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters } from '@/types/filters';
import { ConversionTrendMode } from '@/types/dashboard';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { 
      filters, 
      includeTrends = false, 
      granularity = 'quarter',
      mode = 'period' as ConversionTrendMode  // NEW: Mode parameter with default
    } = body;

    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user?.email || '');
    const filteredFilters: DashboardFilters = { ...filters };
    
    if (permissions.sgaFilter) {
      filteredFilters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filteredFilters.sgm = permissions.sgmFilter;
    }

    // Get scorecard data (always uses period logic for consistency)
    const rates = await getConversionRates(filteredFilters);

    // Get trend data if requested
    let trends = null;
    if (includeTrends) {
      try {
        // Pass the mode parameter to getConversionTrends
        trends = await getConversionTrends(filteredFilters, granularity, mode);
        console.log(`[Conversion Rates API] Returned ${trends?.length || 0} trend points (${mode} mode)`);
      } catch (trendError) {
        console.error('Conversion trends error:', trendError);
        trends = [];
      }
    }

    return NextResponse.json({
      rates,
      trends,
      mode, // Return the mode so the UI knows what it's displaying
    });
  } catch (error) {
    console.error('Conversion rates error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conversion rates' },
      { status: 500 }
    );
  }
}
```

---

## Phase 5: Update API Client

### File: `src/lib/api-client.ts`

Update the `getConversionRates` method in `dashboardApi`:

```typescript
// Update the getConversionRates method to include mode parameter
getConversionRates: (
  filters: DashboardFilters, 
  options?: { 
    includeTrends?: boolean; 
    granularity?: 'month' | 'quarter';
    mode?: 'period' | 'cohort';  // NEW
  }
) =>
  apiFetch<{ 
    rates: ConversionRates; 
    trends: TrendDataPoint[] | null;
    mode?: 'period' | 'cohort';  // NEW
  }>('/api/dashboard/conversion-rates', {
    method: 'POST',
    body: JSON.stringify({ 
      filters, 
      includeTrends: options?.includeTrends ?? false,
      granularity: options?.granularity ?? 'quarter',
      mode: options?.mode ?? 'period',  // NEW
    }),
  }),
```

---

## Phase 6: Update UI Component

### File: `src/components/dashboard/ConversionTrendChart.tsx`

Replace the entire file with this enhanced version that includes tooltips explaining each mode:

```typescript
'use client';

import { Card, Title, Text } from '@tremor/react';
import { TrendDataPoint, ConversionTrendMode } from '@/types/dashboard';
import { useState } from 'react';
import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Info icon component for tooltips
const InfoIcon = ({ className = '' }: { className?: string }) => (
  <svg 
    xmlns="http://www.w3.org/2000/svg" 
    className={`h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help ${className}`}
    fill="none" 
    viewBox="0 0 24 24" 
    stroke="currentColor"
  >
    <path 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      strokeWidth={2} 
      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" 
    />
  </svg>
);

// Tooltip component for mode explanations
const ModeTooltip = ({ mode, children }: { mode: ConversionTrendMode; children: React.ReactNode }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  const explanations = {
    period: {
      title: 'Period Mode (Activity-Based)',
      description: 'Shows conversion activity that occurred in each period.',
      example: 'An SQL from Q3 that becomes SQO in Q4 counts toward Q4\'s rate.',
      details: [
        'Answers: "What happened in this period?"',
        'Includes ALL records, including those still in progress',
        'Rates can exceed 100% when converting older leads',
        'Best for: Activity tracking, sales performance, executive dashboards',
      ],
      calculation: 'SQL→SQO Rate = (SQOs created in period) ÷ (SQLs created in period)',
    },
    cohort: {
      title: 'Cohort Mode (Efficiency-Based)',
      description: 'Tracks how well leads from each period convert over time.',
      example: 'An SQL from Q3 that becomes SQO in Q4 counts toward Q3\'s rate.',
      details: [
        'Answers: "How well do leads from this period convert?"',
        'Only includes RESOLVED records (converted OR closed/lost)',
        'Open records are excluded from denominators',
        'Rates are always 0-100%',
        'Best for: Funnel efficiency, forecasting, process improvement',
      ],
      calculation: 'SQL→SQO Rate = (Resolved SQLs that became SQO) ÷ (Resolved SQLs)',
      resolvedNote: 'Resolved = either converted to next stage OR closed/lost',
    },
  };
  
  const content = explanations[mode];
  
  return (
    <div className="relative inline-block">
      <div 
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        onClick={() => setIsOpen(!isOpen)}
      >
        {children}
      </div>
      {isOpen && (
        <div className="absolute z-50 w-96 p-4 bg-white rounded-lg shadow-xl border border-gray-200 -left-2 mt-2">
          <div className="absolute -top-2 left-4 w-4 h-4 bg-white border-l border-t border-gray-200 transform rotate-45" />
          <h4 className="font-semibold text-gray-900 mb-2">{content.title}</h4>
          <p className="text-sm text-gray-600 mb-3">{content.description}</p>
          
          <div className="bg-blue-50 p-2 rounded text-sm text-blue-800 mb-3">
            <strong>Example:</strong> {content.example}
          </div>
          
          <ul className="text-sm text-gray-600 space-y-1.5 mb-3">
            {content.details.map((detail, i) => (
              <li key={i} className="flex items-start">
                <span className="mr-2 text-gray-400">•</span>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
          
          <div className="bg-gray-50 p-2 rounded text-xs text-gray-700 font-mono mb-2">
            {content.calculation}
          </div>
          
          {content.resolvedNote && (
            <div className="text-xs text-gray-500 italic">
              {content.resolvedNote}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface ConversionTrendChartProps {
  trends: TrendDataPoint[];
  onGranularityChange?: (granularity: 'month' | 'quarter') => void;
  mode?: ConversionTrendMode;
  onModeChange?: (mode: ConversionTrendMode) => void;
  isLoading?: boolean;
}

export function ConversionTrendChart({ 
  trends, 
  onGranularityChange,
  mode = 'period',
  onModeChange,
  isLoading = false,
}: ConversionTrendChartProps) {
  const [selectedMetric, setSelectedMetric] = useState<'rates' | 'volume'>('rates');
  const [granularity, setGranularity] = useState<'month' | 'quarter'>('quarter');
  
  const handleGranularityChange = (value: 'month' | 'quarter') => {
    setGranularity(value);
    onGranularityChange?.(value);
  };

  const handleModeChange = (newMode: ConversionTrendMode) => {
    onModeChange?.(newMode);
  };

  // Transform data for chart display
  const chartData = trends.map(t => ({
    period: t.period,
    isSelectedPeriod: t.isSelectedPeriod || false,
    // Convert rates from decimal (0-1) to percentage (0-100)
    'Contacted→MQL': (Number(t.contactedToMqlRate) || 0) * 100,
    'MQL→SQL': (Number(t.mqlToSqlRate) || 0) * 100,
    'SQL→SQO': (Number(t.sqlToSqoRate) || 0) * 100,
    'SQO→Joined': (Number(t.sqoToJoinedRate) || 0) * 100,
    SQLs: Number(t.sqls) || 0,
    SQOs: Number(t.sqos) || 0,
    Joined: Number(t.joined) || 0,
  }));

  const rateCategories = ['Contacted→MQL', 'MQL→SQL', 'SQL→SQO', 'SQO→Joined'];
  const volumeCategories = ['SQLs', 'SQOs', 'Joined'];

  const rateColors = ['#3b82f6', '#10b981', '#eab308', '#a855f7']; // blue, green, yellow, purple
  const volumeColors = ['#3b82f6', '#10b981', '#a855f7']; // blue, green, purple

  const categories = selectedMetric === 'rates' ? rateCategories : volumeCategories;
  const colors = selectedMetric === 'rates' ? rateColors : volumeColors;

  const formatValue = (value: number) => {
    if (selectedMetric === 'rates') {
      return `${Number(value).toFixed(1)}%`;
    }
    return value.toLocaleString();
  };

  if (isLoading) {
    return (
      <Card className="mb-6">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-48 mb-4" />
          <div className="h-80 bg-gray-200 rounded" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Title>Conversion Trends</Title>
            <ModeTooltip mode={mode}>
              <InfoIcon />
            </ModeTooltip>
          </div>
          <Text className="text-gray-500 text-sm mt-1">
            {mode === 'period' 
              ? 'Activity view: What happened in each period'
              : 'Cohort view: How well resolved leads from each period convert'
            }
          </Text>
        </div>
        
        {/* Controls Row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Mode Toggle */}
          {onModeChange && (
            <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => handleModeChange('period')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
                  mode === 'period'
                    ? 'bg-white shadow text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Period
                <ModeTooltip mode="period">
                  <InfoIcon className="ml-0.5" />
                </ModeTooltip>
              </button>
              <button
                onClick={() => handleModeChange('cohort')}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
                  mode === 'cohort'
                    ? 'bg-white shadow text-blue-600 font-medium'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Cohort
                <ModeTooltip mode="cohort">
                  <InfoIcon className="ml-0.5" />
                </ModeTooltip>
              </button>
            </div>
          )}
          
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
            <button
              onClick={() => setSelectedMetric('volume')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                selectedMetric === 'volume'
                  ? 'bg-white shadow text-blue-600 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Volume
            </button>
          </div>
          
          {/* Granularity Toggle */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => handleGranularityChange('month')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                granularity === 'month'
                  ? 'bg-white shadow text-blue-600 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => handleGranularityChange('quarter')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                granularity === 'quarter'
                  ? 'bg-white shadow text-blue-600 font-medium'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Quarterly
            </button>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <RechartsLineChart
            data={chartData}
            margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis 
              dataKey="period" 
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickLine={{ stroke: '#d1d5db' }}
            />
            <YAxis 
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickLine={{ stroke: '#d1d5db' }}
              tickFormatter={(value) => 
                selectedMetric === 'rates' ? `${value}%` : value.toLocaleString()
              }
              domain={selectedMetric === 'rates' ? [0, 'auto'] : ['auto', 'auto']}
            />
            <RechartsTooltip
              contentStyle={{ 
                backgroundColor: '#fff', 
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
              }}
              formatter={(value: number, name: string) => [formatValue(value), name]}
              labelStyle={{ fontWeight: 600, marginBottom: '4px' }}
            />
            <Legend 
              wrapperStyle={{ paddingTop: '10px' }}
              iconType="circle"
            />
            {categories.map((cat, idx) => (
              <Line
                key={cat}
                type="monotone"
                dataKey={cat}
                stroke={colors[idx]}
                strokeWidth={2}
                dot={{ r: 4, fill: colors[idx] }}
                activeDot={{ r: 6 }}
              />
            ))}
          </RechartsLineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend Explanation */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex items-start gap-2">
          <InfoIcon className="mt-0.5 flex-shrink-0" />
          <Text className="text-xs text-gray-500">
            {mode === 'period' ? (
              <>
                <strong>Period Mode:</strong> Shows conversion activity in each period. 
                An SQL from Q3 that becomes SQO in Q4 counts toward Q4's rate.
                Includes all records. Rates can exceed 100% when converting older leads.
              </>
            ) : (
              <>
                <strong>Cohort Mode:</strong> Tracks each cohort through the funnel using only resolved records.
                An SQL from Q3 that becomes SQO in Q4 counts toward Q3's rate.
                Open records (still in progress) are excluded. Rates are always 0-100%.
              </>
            )}
          </Text>
        </div>
      </div>
    </Card>
  );
}
```

---

## Phase 7: Update Dashboard Page

### File: `src/app/dashboard/page.tsx`

Add state for the mode and pass it to the chart:

```typescript
// Add to imports
import { ConversionTrendMode } from '@/types/dashboard';

// Add to state declarations (near other useState hooks)
const [trendMode, setTrendMode] = useState<ConversionTrendMode>('period');
const [trendGranularity, setTrendGranularity] = useState<'month' | 'quarter'>('quarter');

// Update the fetchData function to include mode and add to dependencies
const fetchConversionData = useCallback(async () => {
  try {
    const conversionData = await dashboardApi.getConversionRates(filters, { 
      includeTrends: true, 
      granularity: trendGranularity,
      mode: trendMode,
    });
    setConversionRates(conversionData.rates);
    setTrends(conversionData.trends || []);
  } catch (error) {
    console.error('Failed to fetch conversion data:', error);
  }
}, [filters, trendMode, trendGranularity]);

// Call this when mode or granularity changes
useEffect(() => {
  fetchConversionData();
}, [fetchConversionData]);

// Update the ConversionTrendChart component usage
<ConversionTrendChart
  trends={trends}
  onGranularityChange={(g) => setTrendGranularity(g)}
  mode={trendMode}
  onModeChange={(m) => setTrendMode(m)}
  isLoading={loading}
/>
```

---

## Testing Checklist

After implementation, verify:

### Rolling Window Tests

| Selected Filter | Granularity | Expected X-Axis |
|----------------|-------------|-----------------|
| Q1 2026 | Quarterly | 2025-Q2, 2025-Q3, 2025-Q4, 2026-Q1 |
| Q4 2025 | Quarterly | 2025-Q1, 2025-Q2, 2025-Q3, 2025-Q4 |
| Q2 2026 | Quarterly | 2025-Q3, 2025-Q4, 2026-Q1, 2026-Q2 |
| Q1 2026 | Monthly | 2025-02 through 2026-01 (or later) |

### Period Mode Tests (Q4 2025)

- [ ] SQLs = 193
- [ ] SQOs = 144
- [ ] Joined = 17
- [ ] SQL→SQO ≈ 74.6%
- [ ] SQO→Joined ≈ 11.6%
- [ ] Values match scorecard

### Cohort Mode Tests

- [ ] Toggle switches to cohort view
- [ ] NO warning banner (resolved-only logic handles this)
- [ ] Rates are between 0-100%
- [ ] Rates reflect true conversion efficiency (resolved records only)
- [ ] Older periods show stable rates (all records have resolved)

### UI Tests

- [ ] Mode toggle works correctly
- [ ] Tooltips display on hover with full explanation
- [ ] Info icons show explanations for each mode
- [ ] X-axis labels show correct rolling window periods
- [ ] Chart handles year boundaries correctly
- [ ] Loading state works
- [ ] Granularity toggle re-fetches data

---

## Key Differences: Period vs Cohort Mode

| Aspect | Period Mode | Cohort Mode |
|--------|-------------|-------------|
| Question | "What happened this period?" | "How well do leads convert?" |
| Records included | ALL records | Only RESOLVED records |
| Open records | Included in denominator | EXCLUDED from denominator |
| Rate range | Can exceed 100% | Always 0-100% |
| SQL in Q3 → SQO in Q4 | Counts toward Q4 | Counts toward Q3 |
| Denominator field | COUNT(*) or COUNTIF | `eligible_for_*` fields |
| Numerator field | COUNTIF with is_* flags | `*_progression` fields |
| Best for | Activity tracking | Funnel efficiency |

---

## Files Modified Summary

1. `src/lib/utils/date-helpers.ts` - Added rolling window utilities
2. `src/types/dashboard.ts` - Added ConversionTrendMode type
3. `src/lib/queries/conversion-rates.ts` - Enhanced getConversionTrends with rolling window + dual mode
4. `src/app/api/dashboard/conversion-rates/route.ts` - Added mode parameter handling
5. `src/lib/api-client.ts` - Updated getConversionRates to pass mode
6. `src/components/dashboard/ConversionTrendChart.tsx` - Added mode toggle with tooltips
7. `src/app/dashboard/page.tsx` - Added trendMode state and passed to chart

---

## Rollback Instructions

If issues arise, revert in reverse order (Phase 7 → Phase 1). The key file to revert is `src/lib/queries/conversion-rates.ts` - keep a backup before making changes.
