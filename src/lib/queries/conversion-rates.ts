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

export async function getConversionTrends(
  filters: DashboardFilters,
  granularity: 'month' | 'quarter' = 'month'
): Promise<TrendDataPoint[]> {
  // For trend charts, we need to show ALL periods, not just the selected period
  // Expand the date range to include the full year of the selected period
  const { startDate } = buildDateRangeFromFilters(filters);
  const selectedYear = new Date(startDate).getFullYear();
  const trendStartDate = `${selectedYear}-01-01`;
  const trendEndDate = `${selectedYear}-12-31 23:59:59`;
  
  // Build conditions manually since we need table aliases
  const conditions: string[] = [];
  const params: Record<string, any> = {
    trendStartDate,
    trendEndDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  // For trend charts, filter by channel, source, SGA, SGM (same as getConversionRates)
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
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Period format functions
  const periodFormatFn = (dateField: string) => granularity === 'month' 
    ? `FORMAT_DATE('%Y-%m', DATE(${dateField}))`
    : `CONCAT(EXTRACT(YEAR FROM ${dateField}), '-Q', EXTRACT(QUARTER FROM ${dateField}))`;
  
  // For trend charts, calculate each conversion rate per period based on its relevant date field:
  // - Contacted→MQL: group by stage_entered_contacting__c period
  // - MQL→SQL: group by converted_date_raw period
  // - SQL→SQO: group by Date_Became_SQO__c period
  // - SQO→Joined: group by advisor_join_date__c period
  const query = `
    WITH contacted_to_mql_periods AS (
      SELECT
        ${periodFormatFn('v.stage_entered_contacting__c')} as period,
        COUNTIF(v.is_mql = 1) as contacted_to_mql_numer,
        SUM(v.eligible_for_contacted_conversions) as contacted_to_mql_denom,
        0 as mql_to_sql_numer,
        0 as mql_to_sql_denom,
        0 as sql_to_sqo_numer,
        0 as sql_to_sqo_denom,
        0 as sqo_to_joined_numer,
        0 as sqo_to_joined_denom,
        0 as sqls,
        0 as sqos,
        0 as joined
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm
        ON v.Original_source = nm.original_source
      ${whereClause}
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
      GROUP BY period
    ),
    mql_to_sql_periods AS (
      -- For MQL→SQL: Group by converted_date_raw period (when SQLs converted)
      -- Numerator: SQLs that converted in this period (based on converted_date_raw)
      -- Denominator: MQLs that became MQLs in this same period (based on stage_entered_contacting__c)
      -- This matches the scorecard logic: SQLs converted in period / MQLs that became MQLs in period
      SELECT
        ${periodFormatFn('v.converted_date_raw')} as period,
        0 as contacted_to_mql_numer,
        0 as contacted_to_mql_denom,
        COUNTIF(v.is_sql = 1) as mql_to_sql_numer,
        0 as mql_to_sql_denom, -- Will be joined from mql_to_sql_denom_periods
        0 as sql_to_sqo_numer,
        0 as sql_to_sqo_denom,
        0 as sqo_to_joined_numer,
        0 as sqo_to_joined_denom,
        COUNTIF(v.is_sql = 1) as sqls,
        0 as sqos,
        0 as joined
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm
        ON v.Original_source = nm.original_source
      ${whereClause}
      WHERE v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@trendEndDate)
      GROUP BY period
    ),
    mql_to_sql_denom_periods AS (
      -- Denominator: MQLs grouped by stage_entered_contacting__c period
      -- This matches the scorecard logic where denominator is based on when they became MQLs
      SELECT
        ${periodFormatFn('v.stage_entered_contacting__c')} as period,
        COUNTIF(v.is_mql = 1) as mql_count
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm
        ON v.Original_source = nm.original_source
      ${whereClause}
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
      GROUP BY period
    ),
    sql_to_sqo_periods AS (
      -- For SQL→SQO: Use cohort analysis - group by converted_date_raw period (cohort period)
      -- Numerator: SQOs that became SQO in this period (where Date_Became_SQO__c matches the cohort period)
      -- Denominator: SQLs that converted in this period
      SELECT
        ${periodFormatFn('v.converted_date_raw')} as period,
        0 as contacted_to_mql_numer,
        0 as contacted_to_mql_denom,
        0 as mql_to_sql_numer,
        0 as mql_to_sql_denom,
        COUNTIF(
          v.Date_Became_SQO__c IS NOT NULL
          AND ${periodFormatFn('v.Date_Became_SQO__c')} = ${periodFormatFn('v.converted_date_raw')}
          AND v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
        ) as sql_to_sqo_numer,
        COUNTIF(v.is_sql = 1) as sql_to_sqo_denom,
        0 as sqo_to_joined_numer,
        0 as sqo_to_joined_denom,
        0 as sqls,
        COUNTIF(
          v.Date_Became_SQO__c IS NOT NULL
          AND ${periodFormatFn('v.Date_Became_SQO__c')} = ${periodFormatFn('v.converted_date_raw')}
          AND v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
        ) as sqos,
        0 as joined
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm
        ON v.Original_source = nm.original_source
      ${whereClause}
      WHERE v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@trendEndDate)
      GROUP BY period
    ),
    sqo_to_joined_periods AS (
      -- For SQO→Joined: Use cohort analysis - group by Date_Became_SQO__c period (cohort period)
      -- Numerator: Joined that joined in this period (where advisor_join_date__c matches the cohort period)
      -- Denominator: SQOs that became SQO in this period
      SELECT
        ${periodFormatFn('v.Date_Became_SQO__c')} as period,
        0 as contacted_to_mql_numer,
        0 as contacted_to_mql_denom,
        0 as mql_to_sql_numer,
        0 as mql_to_sql_denom,
        0 as sql_to_sqo_numer,
        0 as sql_to_sqo_denom,
        COUNTIF(
          v.advisor_join_date__c IS NOT NULL
          AND ${periodFormatFn('v.advisor_join_date__c')} = ${periodFormatFn('v.Date_Became_SQO__c')}
          AND v.is_joined_unique = 1
        ) as sqo_to_joined_numer,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND LOWER(v.SQO_raw) = 'yes'
        ) as sqo_to_joined_denom,
        0 as sqls,
        0 as sqos,
        COUNTIF(
          v.advisor_join_date__c IS NOT NULL
          AND ${periodFormatFn('v.advisor_join_date__c')} = ${periodFormatFn('v.Date_Became_SQO__c')}
          AND v.is_joined_unique = 1
        ) as joined
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm
        ON v.Original_source = nm.original_source
      ${whereClause}
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        AND v.recordtypeid = @recruitingRecordType
      GROUP BY period
    ),
    all_periods AS (
      SELECT * FROM contacted_to_mql_periods
      UNION ALL
      SELECT * FROM mql_to_sql_periods
      UNION ALL
      SELECT * FROM sql_to_sqo_periods
      UNION ALL
      SELECT * FROM sqo_to_joined_periods
    ),
    aggregated_periods AS (
      SELECT
        period,
        SUM(sqls) as sqls,
        SUM(sqos) as sqos,
        SUM(joined) as joined,
        SUM(contacted_to_mql_numer) as contacted_to_mql_numer,
        SUM(contacted_to_mql_denom) as contacted_to_mql_denom,
        SUM(mql_to_sql_numer) as mql_to_sql_numer,
        SUM(sql_to_sqo_numer) as sql_to_sqo_numer,
        SUM(sql_to_sqo_denom) as sql_to_sqo_denom,
        SUM(sqo_to_joined_numer) as sqo_to_joined_numer,
        SUM(sqo_to_joined_denom) as sqo_to_joined_denom
      FROM all_periods
      GROUP BY period
    )
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
  `;
  
  const results = await runQuery<RawConversionTrendResult>(query, params);
  
  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;
  
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
