import { runQuery } from '../bigquery';
import { ConversionRates, TrendDataPoint } from '@/types/dashboard';
import { DashboardFilters } from '@/types/filters';
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
import { RawConversionRatesResult, RawConversionTrendResult, toNumber } from '@/types/bigquery-raw';
import { FULL_TABLE, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';

export async function getConversionRates(filters: DashboardFilters): Promise<ConversionRates> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Build conditions manually since we need table aliases
  const conditions: string[] = [];
  const params: Record<string, any> = {
    startDate,
    endDate: endDate + ' 23:59:59',
  };
  
  if (filters.channel) {
    // Use mapped channel from new_mapping table
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
  
  params.recruitingRecordType = RECRUITING_RECORD_TYPE;
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Each conversion rate is tied to its own date field:
  // - Contacted→MQL: stage_entered_contacting__c
  // - MQL→SQL: converted_date_raw
  // - SQL→SQO: Date_Became_SQO__c
  // - SQO→Joined: advisor_join_date__c
  // Use actual counts (not progression fields) for numerators, eligible_for for denominators
  const query = `
    SELECT
      -- Contacted→MQL: Anyone that was contacted (stage_entered_contacting__c in date range)
      -- that also MQL'ed (is_mql = 1)
      -- Numerator: Those that MQL'ed (is_mql = 1)
      COUNTIF(
        v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
        AND v.is_mql = 1
      ) as contacted_numer,
      -- Denominator: All records where stage_entered_contacting__c is in date range
      COUNTIF(
        v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
      ) as contacted_denom,
      -- MQL→SQL: SQLs that converted in date range / MQLs where stage_entered_contacting__c is in date range
      -- The denominator should be MQLs that became MQLs in this period, not FilterDate
      COUNTIF(
        v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate)
        AND v.is_sql = 1
      ) as mql_numer,
      COUNTIF(
        v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
        AND v.is_mql = 1
      ) as mql_denom,
      -- SQL→SQO: SQOs that became SQO in date range / SQLs where converted_date_raw is in date range
      COUNTIF(
        v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
        AND v.recordtypeid = @recruitingRecordType
        AND v.is_sqo_unique = 1
      ) as sql_numer,
      COUNTIF(
        v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate)
        AND v.is_sql = 1
      ) as sql_denom,
      -- SQO→Joined: Joined that joined in date range / SQOs where Date_Became_SQO__c is in date range
      -- The denominator should be SQOs that became SQOs in this period, not where they joined
      COUNTIF(
        v.advisor_join_date__c IS NOT NULL
        AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP(@endDate)
        AND v.is_joined_unique = 1
      ) as sqo_numer,
      COUNTIF(
        v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
        AND v.recordtypeid = @recruitingRecordType
        AND LOWER(v.SQO_raw) = 'yes'
      ) as sqo_denom
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    ${whereClause}
  `;
  
  const [result] = await runQuery<RawConversionRatesResult>(query, params);
  
  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;
  
  return {
    contactedToMql: {
      rate: safeDiv(toNumber(result.contacted_numer), toNumber(result.contacted_denom)),
      numerator: toNumber(result.contacted_numer),
      denominator: toNumber(result.contacted_denom),
    },
    mqlToSql: {
      rate: safeDiv(toNumber(result.mql_numer), toNumber(result.mql_denom)),
      numerator: toNumber(result.mql_numer),
      denominator: toNumber(result.mql_denom),
    },
    sqlToSqo: {
      rate: safeDiv(toNumber(result.sql_numer), toNumber(result.sql_denom)),
      numerator: toNumber(result.sql_numer),
      denominator: toNumber(result.sql_denom),
    },
    sqoToJoined: {
      rate: safeDiv(toNumber(result.sqo_numer), toNumber(result.sqo_denom)),
      numerator: toNumber(result.sqo_numer),
      denominator: toNumber(result.sqo_denom),
    },
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * getConversionTrends - FIXED VERSION
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This function calculates conversion rates and volumes per period (month/quarter)
 * for the trend chart visualization.
 * 
 * BUG FIX APPLIED (January 2026):
 * --------------------------------
 * Previous implementation had three critical bugs:
 * 
 * 1. CONTACTED→MQL DENOMINATOR BUG:
 *    - Buggy: Used SUM(eligible_for_contacted_conversions) = ~6,594
 *    - Fixed: Uses COUNT(*) = ~15,768 (matches scorecard logic)
 * 
 * 2. SQL→SQO COHORT RESTRICTION BUG:
 *    - Buggy: Only counted SQOs where Date_Became_SQO quarter matched converted_date quarter
 *    - Fixed: Counts ALL SQOs where Date_Became_SQO__c is in the period (no cohort restriction)
 *    - Impact: Was showing 114 SQOs instead of 144 for Q4 2025
 * 
 * 3. SQO→JOINED COHORT RESTRICTION BUG:
 *    - Buggy: Only counted Joined where advisor_join_date quarter matched Date_Became_SQO quarter
 *    - Fixed: Counts ALL Joined where advisor_join_date__c is in the period (no cohort restriction)
 *    - Impact: Was showing 6 Joined instead of 17 for Q4 2025
 * 
 * ARCHITECTURE:
 * -------------
 * The fix uses 7 separate CTEs, one for each metric's numerator or denominator,
 * then joins them by period. This ensures each metric is calculated independently
 * using its correct date field without any cohort restrictions.
 * 
 * DATE FIELD MAPPING (must match scorecard in getConversionRates):
 * ----------------------------------------------------------------
 * | Conversion     | Numerator Date Field      | Denominator Date Field        |
 * |----------------|---------------------------|-------------------------------|
 * | Contacted→MQL  | stage_entered_contacting__c | stage_entered_contacting__c |
 * | MQL→SQL        | converted_date_raw        | stage_entered_contacting__c   |
 * | SQL→SQO        | Date_Became_SQO__c        | converted_date_raw            |
 * | SQO→Joined     | advisor_join_date__c      | Date_Became_SQO__c            |
 * 
 * VOLUME DATE FIELDS:
 * -------------------
 * | Volume  | Date Field              |
 * |---------|-------------------------|
 * | SQLs    | converted_date_raw      |
 * | SQOs    | Date_Became_SQO__c      |
 * | Joined  | advisor_join_date__c    |
 * 
 * VALIDATED VALUES (Q4 2025):
 * ---------------------------
 * SQLs: 193, SQOs: 144, Joined: 17
 * Contacted→MQL: 3.6%, MQL→SQL: 34.2%, SQL→SQO: 74.6%, SQO→Joined: 11.6%
 * 
 * @param filters - Dashboard filters (channel, source, SGA, SGM, date range)
 * @param granularity - 'month' or 'quarter' for period grouping
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
    console.log(`[getConversionTrends] Selected: ${selectedYear}-Q${selectedQuarter}`);
    console.log(`[getConversionTrends] Calculated quarters:`, quarters.map(q => `${q.year}-Q${q.quarter}`).join(', '));
    
    const dateRange = getQuarterWindowDateRange(quarters);
    trendStartDate = dateRange.startDate;
    trendEndDate = dateRange.endDate + ' 23:59:59';
    expectedPeriods = quarters.map(q => formatQuarterString(q.year, q.quarter));
    selectedPeriodString = formatQuarterString(selectedYear, selectedQuarter);
    
    console.log(`[getConversionTrends] Date range: ${trendStartDate} to ${trendEndDate}`);
    console.log(`[getConversionTrends] Expected periods: ${expectedPeriods.join(', ')}`);
    console.log(`[getConversionTrends] Selected period string: ${selectedPeriodString}`);
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
  
  // Additional logging for monthly granularity
  if (granularity === 'month') {
    console.log(`[getConversionTrends] Selected: ${selectedYear}-Q${selectedQuarter}`);
    console.log(`[getConversionTrends] Date range: ${trendStartDate} to ${trendEndDate}`);
    console.log(`[getConversionTrends] Expected periods: ${expectedPeriods.join(', ')}`);
  }
  
  console.log(`[getConversionTrends] Mode: ${mode}, Granularity: ${granularity}`);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD FILTER CONDITIONS
  // These are applied in each CTE to filter by channel, source, SGA, SGM
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
  
  // Build WHERE clause for filters (applied in each CTE after date filter)
  const filterWhereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PERIOD FORMAT FUNCTION
  // Generates SQL expression to format dates into period strings
  // Month: '2025-01', '2025-02', etc.
  // Quarter: '2025-Q1', '2025-Q2', etc.
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
  
  console.log(`[getConversionTrends] Executing query with params:`, {
    trendStartDate,
    trendEndDate,
    expectedPeriodCount: expectedPeriods.length,
  });
  
  const results = await runQuery<RawConversionTrendResult>(query, params);
  
  console.log(`[getConversionTrends] Query returned ${results.length} rows`);
  console.log(`[getConversionTrends] Returned periods:`, results.map(r => r.period).join(', '));
  console.log(`[getConversionTrends] Missing periods:`, expectedPeriods.filter(p => !results.some(r => r.period === p)).join(', '));
  
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
  
  console.log(`[getConversionTrends] Final results: ${finalResults.length} periods`);
  console.log(`[getConversionTrends] Final periods:`, finalResults.map(r => r.period).join(', '));
  console.log(`[getConversionTrends] Selected period (${selectedPeriodString}) in results:`, finalResults.some(r => r.period === selectedPeriodString));
  
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
