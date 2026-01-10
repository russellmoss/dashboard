import { runQuery } from '../bigquery';
import { ConversionRates, TrendDataPoint } from '@/types/dashboard';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
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
  granularity: 'month' | 'quarter' = 'month'
): Promise<TrendDataPoint[]> {
  // ═══════════════════════════════════════════════════════════════════════════
  // DATE RANGE SETUP
  // For trend charts, show ALL periods in the selected year (not just filtered period)
  // ═══════════════════════════════════════════════════════════════════════════
  const { startDate } = buildDateRangeFromFilters(filters);
  const selectedYear = new Date(startDate).getFullYear();
  const trendStartDate = `${selectedYear}-01-01`;
  const trendEndDate = `${selectedYear}-12-31 23:59:59`;
  
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
  // MAIN QUERY
  // Uses 7 CTEs to calculate each metric independently, then joins by period
  // This ensures no cohort restrictions and correct date field usage
  // ═══════════════════════════════════════════════════════════════════════════
  const query = `
    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 1: CONTACTED→MQL
    -- Date Field: stage_entered_contacting__c (for both numerator and denominator)
    -- 
    -- CRITICAL FIX: Denominator uses COUNT(*) instead of SUM(eligible_for_contacted_conversions)
    -- This matches the scorecard logic in getConversionRates()
    -- ═══════════════════════════════════════════════════════════════════════════
    WITH contacted_to_mql AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        COUNTIF(v.is_mql = 1) as contacted_to_mql_numer,
        COUNT(*) as contacted_to_mql_denom  -- FIXED: Was SUM(eligible_for_contacted_conversions)
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 2: MQL→SQL NUMERATOR
    -- Date Field: converted_date_raw (when SQLs converted)
    -- Also calculates SQL volumes (grouped by converted_date_raw)
    -- ═══════════════════════════════════════════════════════════════════════════
    mql_to_sql_numer AS (
      SELECT
        ${periodFn('v.converted_date_raw')} as period,
        COUNTIF(v.is_sql = 1) as mql_to_sql_numer,
        COUNTIF(v.is_sql = 1) as sqls  -- Volume: SQLs by converted_date_raw
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 3: MQL→SQL DENOMINATOR
    -- Date Field: stage_entered_contacting__c (when MQLs became MQL)
    -- 
    -- NOTE: This is grouped by a different date field than the numerator.
    -- The periods are joined later, which may result in rate > 100% for some periods
    -- if more SQLs converted in a period than MQLs entered in that same period.
    -- This is expected behavior matching the scorecard logic.
    -- ═══════════════════════════════════════════════════════════════════════════
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
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 4: SQL→SQO NUMERATOR
    -- Date Field: Date_Became_SQO__c (when SQOs became SQO)
    -- Also calculates SQO volumes (grouped by Date_Became_SQO__c)
    -- 
    -- CRITICAL FIX: NO COHORT RESTRICTION
    -- Previous buggy code required: Date_Became_SQO period = converted_date period
    -- This excluded SQOs that converted to SQL in one period but became SQO in another
    -- ═══════════════════════════════════════════════════════════════════════════
    sql_to_sqo_numer AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
        ) as sql_to_sqo_numer,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
        ) as sqos  -- Volume: SQOs by Date_Became_SQO__c
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 5: SQL→SQO DENOMINATOR
    -- Date Field: converted_date_raw (when SQLs converted)
    -- ═══════════════════════════════════════════════════════════════════════════
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
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 6: SQO→JOINED NUMERATOR
    -- Date Field: advisor_join_date__c (when advisors joined)
    -- Also calculates Joined volumes (grouped by advisor_join_date__c)
    -- 
    -- CRITICAL FIX: NO COHORT RESTRICTION
    -- Previous buggy code required: advisor_join_date period = Date_Became_SQO period
    -- This excluded Joined that became SQO in one period but joined in another
    -- ═══════════════════════════════════════════════════════════════════════════
    sqo_to_joined_numer AS (
      SELECT
        ${periodFn('v.advisor_join_date__c')} as period,
        COUNTIF(v.is_joined_unique = 1) as sqo_to_joined_numer,
        COUNTIF(v.is_joined_unique = 1) as joined  -- Volume: Joined by advisor_join_date__c
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.advisor_join_date__c IS NOT NULL
        AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- CTE 7: SQO→JOINED DENOMINATOR
    -- Date Field: Date_Became_SQO__c (when SQOs became SQO)
    -- ═══════════════════════════════════════════════════════════════════════════
    sqo_to_joined_denom AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND LOWER(v.SQO_raw) = 'yes'
        ) as sqo_to_joined_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- COLLECT ALL UNIQUE PERIODS
    -- This ensures we have a row for every period that appears in any CTE
    -- ═══════════════════════════════════════════════════════════════════════════
    all_periods AS (
      SELECT DISTINCT period FROM contacted_to_mql
      UNION DISTINCT
      SELECT DISTINCT period FROM mql_to_sql_numer
      UNION DISTINCT
      SELECT DISTINCT period FROM mql_to_sql_denom
      UNION DISTINCT
      SELECT DISTINCT period FROM sql_to_sqo_numer
      UNION DISTINCT
      SELECT DISTINCT period FROM sql_to_sqo_denom
      UNION DISTINCT
      SELECT DISTINCT period FROM sqo_to_joined_numer
      UNION DISTINCT
      SELECT DISTINCT period FROM sqo_to_joined_denom
    )
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- FINAL SELECT
    -- Join all CTEs by period to get complete trend data
    -- Each metric uses its own date field - no cohort restrictions
    -- ═══════════════════════════════════════════════════════════════════════════
    SELECT
      ap.period,
      
      -- Volumes (each from its own date field CTE)
      COALESCE(msn.sqls, 0) as sqls,
      COALESCE(ssn.sqos, 0) as sqos,
      COALESCE(sjn.joined, 0) as joined,
      
      -- Contacted→MQL (both from stage_entered_contacting__c CTE)
      COALESCE(ctm.contacted_to_mql_numer, 0) as contacted_to_mql_numer,
      COALESCE(ctm.contacted_to_mql_denom, 0) as contacted_to_mql_denom,
      
      -- MQL→SQL (numer from converted_date_raw, denom from stage_entered_contacting__c)
      COALESCE(msn.mql_to_sql_numer, 0) as mql_to_sql_numer,
      COALESCE(msd.mql_to_sql_denom, 0) as mql_to_sql_denom,
      
      -- SQL→SQO (numer from Date_Became_SQO__c, denom from converted_date_raw)
      COALESCE(ssn.sql_to_sqo_numer, 0) as sql_to_sqo_numer,
      COALESCE(ssd.sql_to_sqo_denom, 0) as sql_to_sqo_denom,
      
      -- SQO→Joined (numer from advisor_join_date__c, denom from Date_Became_SQO__c)
      COALESCE(sjn.sqo_to_joined_numer, 0) as sqo_to_joined_numer,
      COALESCE(sjd.sqo_to_joined_denom, 0) as sqo_to_joined_denom
      
    FROM all_periods ap
    LEFT JOIN contacted_to_mql ctm ON ap.period = ctm.period
    LEFT JOIN mql_to_sql_numer msn ON ap.period = msn.period
    LEFT JOIN mql_to_sql_denom msd ON ap.period = msd.period
    LEFT JOIN sql_to_sqo_numer ssn ON ap.period = ssn.period
    LEFT JOIN sql_to_sqo_denom ssd ON ap.period = ssd.period
    LEFT JOIN sqo_to_joined_numer sjn ON ap.period = sjn.period
    LEFT JOIN sqo_to_joined_denom sjd ON ap.period = sjd.period
    
    ORDER BY ap.period
  `;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTE QUERY AND TRANSFORM RESULTS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log('[getConversionTrends] Executing fixed query for', granularity, 'granularity');
  
  const results = await runQuery<RawConversionTrendResult>(query, params);
  
  console.log('[getConversionTrends] Returned', results.length, 'periods');
  
  // Safe division helper to avoid divide-by-zero errors
  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;
  
  // Transform raw results to TrendDataPoint objects
  return results.map(r => ({
    period: r.period,
    sqls: toNumber(r.sqls),
    sqos: toNumber(r.sqos),
    joined: toNumber(r.joined),
    contactedToMqlRate: safeDiv(toNumber(r.contacted_to_mql_numer), toNumber(r.contacted_to_mql_denom)),
    mqlToSqlRate: safeDiv(toNumber(r.mql_to_sql_numer), toNumber(r.mql_to_sql_denom)),
    sqlToSqoRate: safeDiv(toNumber(r.sql_to_sqo_numer), toNumber(r.sql_to_sqo_denom)),
    sqoToJoinedRate: safeDiv(toNumber(r.sqo_to_joined_numer), toNumber(r.sqo_to_joined_denom)),
  }));
}
