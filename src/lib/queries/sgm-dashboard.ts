import { runQuery } from '../bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { toNumber, toString } from '@/types/bigquery-raw';
import { SGMDashboardMetrics, SGMConversionTrend } from '@/types/sgm-hub';
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';

// ============================================
// Dashboard Metrics (Scorecards)
// ============================================

interface DashboardMetricsFilters {
  startDate: string;
  endDate: string;
  channels: string[];
  sources?: string[];
  sgmNames?: string[];
}

const _getSgmDashboardMetrics = async (
  filters: DashboardMetricsFilters
): Promise<SGMDashboardMetrics> => {
  // Following funnel-metrics.ts pattern: NO date filter in WHERE clause.
  // Each metric uses its own date field inside CASE WHEN.
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };

  // Channel filter
  if (filters.channels.length > 0) {
    const chParams = filters.channels.map((_, i) => `@ch${i}`);
    conditions.push(`IFNULL(v.Channel_Grouping_Name, 'Other') IN (${chParams.join(', ')})`);
    filters.channels.forEach((ch, i) => { params[`ch${i}`] = ch; });
  }

  // Source filter
  if (filters.sources && filters.sources.length > 0) {
    const srcParams = filters.sources.map((_, i) => `@src${i}`);
    conditions.push(`v.Original_source IN (${srcParams.join(', ')})`);
    filters.sources.forEach((src, i) => { params[`src${i}`] = src; });
  }

  // SGM filter
  if (filters.sgmNames && filters.sgmNames.length > 0) {
    const sgmParams = filters.sgmNames.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgmNames.forEach((sgm, i) => { params[`sgm${i}`] = sgm; });
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT
      -- SQLs: anchored on converted_date_raw (lead-level, no is_primary_opp_record)
      SUM(CASE
        WHEN v.converted_date_raw IS NOT NULL
          AND DATE(v.converted_date_raw) >= DATE(@startDate)
          AND DATE(v.converted_date_raw) <= DATE(@endDate)
          AND v.is_sql = 1
        THEN 1 ELSE 0
      END) as sqls,
      -- SQOs: anchored on Date_Became_SQO__c
      SUM(CASE
        WHEN v.Date_Became_SQO__c IS NOT NULL
          AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
          AND v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
        THEN 1 ELSE 0
      END) as sqos,
      -- Signed: anchored on Stage_Entered_Signed__c
      SUM(CASE
        WHEN v.Stage_Entered_Signed__c IS NOT NULL
          AND TIMESTAMP(v.Stage_Entered_Signed__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Stage_Entered_Signed__c) <= TIMESTAMP(@endDate)
          AND v.is_primary_opp_record = 1
        THEN 1 ELSE 0
      END) as signed,
      -- Signed AUM
      SUM(CASE
        WHEN v.Stage_Entered_Signed__c IS NOT NULL
          AND TIMESTAMP(v.Stage_Entered_Signed__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Stage_Entered_Signed__c) <= TIMESTAMP(@endDate)
          AND v.is_primary_opp_record = 1
        THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) ELSE 0
      END) as signed_aum,
      -- Joined: anchored on advisor_join_date__c
      SUM(CASE
        WHEN v.advisor_join_date__c IS NOT NULL
          AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
          AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
          AND v.is_joined_unique = 1
        THEN 1 ELSE 0
      END) as joined,
      -- Joined AUM
      SUM(CASE
        WHEN v.advisor_join_date__c IS NOT NULL
          AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
          AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
          AND v.is_joined_unique = 1
        THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) ELSE 0
      END) as joined_aum,
      -- Open pipeline AUM (current state, not filtered by date)
      -- Matches Open Pipeline page: OPEN_PIPELINE_STAGES only + is_sqo_unique dedup
      COALESCE(SUM(CASE WHEN v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
        AND v.is_sqo_unique = 1
        AND v.is_primary_opp_record = 1 THEN v.Opportunity_AUM END), 0) as open_pipeline_aum,
      -- Joined ARR: anchored on advisor_join_date__c
      SUM(CASE
        WHEN v.advisor_join_date__c IS NOT NULL
          AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
          AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
          AND v.is_joined_unique = 1
          AND v.Actual_ARR__c IS NOT NULL
        THEN v.Actual_ARR__c ELSE 0
      END) as actual_arr,
      SUM(CASE
        WHEN v.advisor_join_date__c IS NOT NULL
          AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
          AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
          AND v.is_joined_unique = 1
          AND v.Actual_ARR__c IS NOT NULL
        THEN 1 ELSE 0
      END) as arr_coverage_count,
      -- Pipeline estimated ARR (active pipeline stages only, not date-filtered)
      COALESCE(SUM(CASE WHEN v.StageName IN ('Sales Process', 'Negotiating', 'Discovery', 'On Hold')
        AND v.SGM_Estimated_ARR__c IS NOT NULL THEN v.SGM_Estimated_ARR__c END), 0) as estimated_arr,
      COUNT(CASE WHEN v.StageName IN ('Sales Process', 'Negotiating', 'Discovery', 'On Hold')
        AND v.SGM_Estimated_ARR__c IS NOT NULL THEN 1 END) as estimated_arr_count
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
  `;

  const results = await runQuery<{
    sqls: number | null;
    sqos: number | null;
    signed: number | null;
    signed_aum: number | null;
    joined: number | null;
    joined_aum: number | null;
    open_pipeline_aum: number | null;
    actual_arr: number | null;
    arr_coverage_count: number | null;
    estimated_arr: number | null;
    estimated_arr_count: number | null;
  }>(query, params);

  const r = results[0] || {};
  return {
    sqls: toNumber(r.sqls),
    sqos: toNumber(r.sqos),
    signed: toNumber(r.signed),
    signedAum: toNumber(r.signed_aum),
    joined: toNumber(r.joined),
    joinedAum: toNumber(r.joined_aum),
    openPipelineAum: toNumber(r.open_pipeline_aum),
    actualArr: toNumber(r.actual_arr),
    arrCoverageCount: toNumber(r.arr_coverage_count),
    estimatedArr: toNumber(r.estimated_arr),
    estimatedArrCount: toNumber(r.estimated_arr_count),
  };
};

export const getSgmDashboardMetrics = cachedQuery(
  _getSgmDashboardMetrics,
  'getSgmDashboardMetrics',
  CACHE_TAGS.DASHBOARD
);

// ============================================
// SGM Conversion Table (Cohort-based)
// ============================================
// Each metric anchored on its own date field, matching the chart logic:
// - SQLs: converted_date_raw
// - SQL→SQO: converted_date_raw cohort
// - SQOs: Date_Became_SQO__c
// - SQO→Joined: Date_Became_SQO__c cohort (resolved outcomes)
// - Joined: advisor_join_date__c
// - Velocity: Date_Became_SQO__c cohort

import { SgmConversionData } from '@/types/dashboard';

interface SgmConversionCohortFilters {
  sgms?: string[];
  dateRange?: { startDate: string; endDate: string } | null;
}

const _getSgmConversionCohortData = async (
  filters?: SgmConversionCohortFilters
): Promise<SgmConversionData[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  // SGM filter
  if (filters?.sgms && filters.sgms.length > 0) {
    const sgmParams = filters.sgms.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => { params[`sgm${i}`] = sgm; });
  }

  const hasDateRange = filters?.dateRange?.startDate && filters?.dateRange?.endDate;
  if (hasDateRange) {
    params.startDate = filters!.dateRange!.startDate;
    params.endDate = filters!.dateRange!.endDate;
  }

  const sgmWhereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  // Date conditions per-metric (only applied when dateRange is provided)
  const sqlDateFilter = hasDateRange
    ? 'AND v.converted_date_raw IS NOT NULL AND DATE(v.converted_date_raw) >= DATE(@startDate) AND DATE(v.converted_date_raw) <= DATE(@endDate)'
    : '';
  const sqoDateFilter = hasDateRange
    ? 'AND v.Date_Became_SQO__c IS NOT NULL AND DATE(v.Date_Became_SQO__c) >= DATE(@startDate) AND DATE(v.Date_Became_SQO__c) <= DATE(@endDate)'
    : '';
  const joinedDateFilter = hasDateRange
    ? 'AND v.advisor_join_date__c IS NOT NULL AND DATE(v.advisor_join_date__c) >= DATE(@startDate) AND DATE(v.advisor_join_date__c) <= DATE(@endDate)'
    : '';

  const query = `
    WITH active_sgms AS (
      SELECT DISTINCT u.Name AS sgm_name
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.Is_SGM__c = TRUE AND u.IsActive = TRUE
    ),
    -- SQL cohort: anchored on converted_date_raw
    sql_cohort AS (
      SELECT
        v.SGM_Owner_Name__c as sgm,
        COUNT(CASE WHEN v.is_sql = 1 THEN 1 END) as sqls_received,
        SUM(v.sql_to_sqo_progression) as sql_to_sqo_numer,
        SUM(v.eligible_for_sql_conversions) as sql_to_sqo_denom
      FROM \`${FULL_TABLE}\` v
      WHERE v.recordtypeid = @recruitingRecordType
        AND v.SGM_Owner_Name__c IS NOT NULL
        ${sgmWhereClause}
        ${sqlDateFilter}
      GROUP BY v.SGM_Owner_Name__c
    ),
    -- SQO cohort: anchored on Date_Became_SQO__c
    sqo_cohort AS (
      SELECT
        v.SGM_Owner_Name__c as sgm,
        SUM(v.is_sqo_unique) as sqos_count,
        SUM(CASE WHEN v.is_sqo_unique = 1 AND v.is_joined_unique = 1 THEN 1 ELSE 0 END) as sqo_to_joined_numer,
        SUM(CASE WHEN v.is_sqo_unique = 1 AND v.is_joined_unique = 1 THEN 1 ELSE 0 END)
          + SUM(CASE WHEN v.is_sqo_unique = 1 AND v.StageName = 'Closed Lost' THEN 1 ELSE 0 END) as sqo_to_joined_denom,
        ROUND(AVG(
          CASE WHEN v.is_sqo_unique = 1 AND v.is_joined_unique = 1
            AND v.Stage_Entered_Joined__c IS NOT NULL
            AND v.Date_Became_SQO__c IS NOT NULL
          THEN DATE_DIFF(DATE(v.Stage_Entered_Joined__c), DATE(v.Date_Became_SQO__c), DAY)
          END
        ), 1) as avg_days_sqo_to_joined
      FROM \`${FULL_TABLE}\` v
      WHERE v.recordtypeid = @recruitingRecordType
        AND v.SGM_Owner_Name__c IS NOT NULL
        ${sgmWhereClause}
        ${sqoDateFilter}
      GROUP BY v.SGM_Owner_Name__c
    ),
    -- Joined cohort: anchored on advisor_join_date__c
    joined_cohort AS (
      SELECT
        v.SGM_Owner_Name__c as sgm,
        SUM(v.is_joined_unique) as joined_count
      FROM \`${FULL_TABLE}\` v
      WHERE v.recordtypeid = @recruitingRecordType
        AND v.SGM_Owner_Name__c IS NOT NULL
        ${sgmWhereClause}
        ${joinedDateFilter}
      GROUP BY v.SGM_Owner_Name__c
    )
    SELECT
      a.sgm_name as sgm,
      COALESCE(s.sqls_received, 0) as sqls_received,
      COALESCE(s.sql_to_sqo_numer, 0) as sql_to_sqo_numer,
      COALESCE(s.sql_to_sqo_denom, 0) as sql_to_sqo_denom,
      COALESCE(sq.sqos_count, 0) as sqos_count,
      COALESCE(sq.sqo_to_joined_numer, 0) as sqo_to_joined_numer,
      COALESCE(sq.sqo_to_joined_denom, 0) as sqo_to_joined_denom,
      COALESCE(j.joined_count, 0) as joined_count,
      sq.avg_days_sqo_to_joined
    FROM active_sgms a
    LEFT JOIN sql_cohort s ON a.sgm_name = s.sgm
    LEFT JOIN sqo_cohort sq ON a.sgm_name = sq.sgm
    LEFT JOIN joined_cohort j ON a.sgm_name = j.sgm
    WHERE COALESCE(s.sqls_received, 0) > 0
       OR COALESCE(sq.sqos_count, 0) > 0
       OR COALESCE(j.joined_count, 0) > 0
    ORDER BY COALESCE(s.sqls_received, 0) DESC
  `;

  const results = await runQuery<{
    sgm: string | null;
    sqls_received: number | null;
    sql_to_sqo_numer: number | null;
    sql_to_sqo_denom: number | null;
    sqos_count: number | null;
    sqo_to_joined_numer: number | null;
    sqo_to_joined_denom: number | null;
    joined_count: number | null;
    avg_days_sqo_to_joined: number | null;
  }>(query, params);

  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;

  return results.map(r => ({
    sgm: toString(r.sgm),
    sqlsReceived: toNumber(r.sqls_received),
    sqlToSqoNumer: toNumber(r.sql_to_sqo_numer),
    sqlToSqoDenom: toNumber(r.sql_to_sqo_denom),
    sqlToSqoRate: safeDiv(toNumber(r.sql_to_sqo_numer), toNumber(r.sql_to_sqo_denom)),
    sqosCount: toNumber(r.sqos_count),
    sqoToJoinedNumer: toNumber(r.sqo_to_joined_numer),
    sqoToJoinedDenom: toNumber(r.sqo_to_joined_denom),
    sqoToJoinedRate: safeDiv(toNumber(r.sqo_to_joined_numer), toNumber(r.sqo_to_joined_denom)),
    joinedCount: toNumber(r.joined_count),
    avgDaysSqoToJoined: r.avg_days_sqo_to_joined != null ? toNumber(r.avg_days_sqo_to_joined) : undefined,
  }));
};

export const getSgmConversionCohortData = cachedQuery(
  _getSgmConversionCohortData,
  'getSgmConversionCohortData',
  CACHE_TAGS.DASHBOARD
);

// ============================================
// Conversion Trend (Quarterly Cohorted)
// ============================================

interface ConversionTrendFilters {
  startDate: string;        // Earliest quarter start
  endDate: string;          // Latest quarter end
  channels?: string[];
  sources?: string[];
  sgmNames?: string[];
}

const _getSgmConversionTrend = async (
  filters: ConversionTrendFilters
): Promise<SGMConversionTrend[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };

  // Note: recordtypeid and SGM_Owner_Name__c filters are applied per-CTE,
  // not in the shared WHERE, because SQLs are lead-level (no record type / SGM requirement)

  // Channel filter
  if (filters.channels && filters.channels.length > 0) {
    const chParams = filters.channels.map((_, i) => `@ch${i}`);
    conditions.push(`IFNULL(v.Channel_Grouping_Name, 'Other') IN (${chParams.join(', ')})`);
    filters.channels.forEach((ch, i) => { params[`ch${i}`] = ch; });
  }

  // Source filter
  if (filters.sources && filters.sources.length > 0) {
    const srcParams = filters.sources.map((_, i) => `@src${i}`);
    conditions.push(`v.Original_source IN (${srcParams.join(', ')})`);
    filters.sources.forEach((src, i) => { params[`src${i}`] = src; });
  }

  // SGM filter
  if (filters.sgmNames && filters.sgmNames.length > 0) {
    const sgmParams = filters.sgmNames.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgmNames.forEach((sgm, i) => { params[`sgm${i}`] = sgm; });
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // COHORT-BASED conversion rates:
  // SQL→SQO: Anchored on SQL date (converted_date_raw). Of SQLs created in quarter X,
  //   how many progressed to SQO? Uses existing sql_to_sqo_progression / eligible_for_sql_conversions.
  // SQO→Joined: Anchored on SQO date (Date_Became_SQO__c). Of SQOs created in quarter X,
  //   how many eventually Joined vs Closed Lost? Outcome can happen in any future quarter.
  const query = `
    WITH quarters AS (
      SELECT DISTINCT
        CONCAT(CAST(EXTRACT(YEAR FROM d) AS STRING), '-Q',
               CAST(EXTRACT(QUARTER FROM d) AS STRING)) AS quarter
      FROM UNNEST(GENERATE_DATE_ARRAY(DATE(@startDate), DATE(@endDate), INTERVAL 1 DAY)) AS d
    ),
    -- SQL cohort: anchored on converted_date_raw
    sql_cohort AS (
      SELECT
        CONCAT(CAST(EXTRACT(YEAR FROM v.converted_date_raw) AS STRING), '-Q',
               CAST(EXTRACT(QUARTER FROM v.converted_date_raw) AS STRING)) AS quarter,
        COUNT(CASE WHEN v.is_sql = 1 THEN 1 END) as sql_count,
        SUM(v.sql_to_sqo_progression) as sql_to_sqo_numer,
        SUM(v.eligible_for_sql_conversions) as sql_to_sqo_denom
      FROM \`${FULL_TABLE}\` v
      ${whereClause}
        ${conditions.length > 0 ? 'AND' : 'WHERE'} v.converted_date_raw IS NOT NULL
        AND DATE(v.converted_date_raw) >= DATE(@startDate)
        AND DATE(v.converted_date_raw) <= DATE(@endDate)
      GROUP BY quarter
    ),
    -- SQO cohort: anchored on Date_Became_SQO__c
    -- Looks at all SQOs created in quarter X and their eventual outcomes (regardless of when)
    sqo_cohort AS (
      SELECT
        CONCAT(CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), '-Q',
               CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)) AS quarter,
        SUM(v.is_sqo_unique) as sqo_count,
        -- Joined: resolved as won
        SUM(CASE WHEN v.is_sqo_unique = 1 AND v.is_joined_unique = 1 THEN 1 ELSE 0 END) as joined_count,
        -- Denominator: fully resolved SQOs (Joined + Closed Lost)
        SUM(CASE WHEN v.is_sqo_unique = 1 AND v.is_joined_unique = 1 THEN 1 ELSE 0 END)
          + SUM(CASE WHEN v.is_sqo_unique = 1 AND v.StageName = 'Closed Lost' THEN 1 ELSE 0 END) as sqo_resolved_count
      FROM \`${FULL_TABLE}\` v
      ${whereClause}
        ${conditions.length > 0 ? 'AND' : 'WHERE'} v.Date_Became_SQO__c IS NOT NULL
        AND DATE(v.Date_Became_SQO__c) >= DATE(@startDate)
        AND DATE(v.Date_Became_SQO__c) <= DATE(@endDate)
        AND v.recordtypeid = @recruitingRecordType
      GROUP BY quarter
    ),
    -- Joined volume: anchored on advisor_join_date__c (event-based, not cohort)
    -- Shows how many actually joined in each quarter, matching the scorecard count
    joined_volume AS (
      SELECT
        CONCAT(CAST(EXTRACT(YEAR FROM v.advisor_join_date__c) AS STRING), '-Q',
               CAST(EXTRACT(QUARTER FROM v.advisor_join_date__c) AS STRING)) AS quarter,
        SUM(v.is_joined_unique) as joined_count
      FROM \`${FULL_TABLE}\` v
      ${whereClause}
        ${conditions.length > 0 ? 'AND' : 'WHERE'} v.advisor_join_date__c IS NOT NULL
        AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
        AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
        AND v.is_joined_unique = 1
      GROUP BY quarter
    )
    SELECT
      q.quarter,
      COALESCE(s.sql_count, 0) as sql_count,
      COALESCE(sq.sqo_count, 0) as sqo_count,
      COALESCE(j.joined_count, 0) as joined_count,
      COALESCE(s.sql_to_sqo_numer, 0) as sql_to_sqo_numer,
      COALESCE(s.sql_to_sqo_denom, 0) as sql_to_sqo_denom,
      COALESCE(sq.joined_count, 0) as sqo_to_joined_numer,
      COALESCE(sq.sqo_resolved_count, 0) as sqo_to_joined_denom
    FROM quarters q
    LEFT JOIN sql_cohort s ON q.quarter = s.quarter
    LEFT JOIN sqo_cohort sq ON q.quarter = sq.quarter
    LEFT JOIN joined_volume j ON q.quarter = j.quarter
    ORDER BY q.quarter ASC
  `;

  const results = await runQuery<{
    quarter: string | null;
    sql_count: number | null;
    sqo_count: number | null;
    joined_count: number | null;
    sql_to_sqo_numer: number | null;
    sql_to_sqo_denom: number | null;
    sqo_to_joined_numer: number | null;
    sqo_to_joined_denom: number | null;
  }>(query, params);

  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;

  return results
    .filter(r => r.quarter != null)
    .map(r => ({
      quarter: toString(r.quarter),
      sqlCount: toNumber(r.sql_count),
      sqoCount: toNumber(r.sqo_count),
      joinedCount: toNumber(r.joined_count),
      sqlToSqoNumer: toNumber(r.sql_to_sqo_numer),
      sqlToSqoDenom: toNumber(r.sql_to_sqo_denom),
      sqlToSqoRate: safeDiv(toNumber(r.sql_to_sqo_numer), toNumber(r.sql_to_sqo_denom)),
      sqoToJoinedNumer: toNumber(r.sqo_to_joined_numer),
      sqoToJoinedDenom: toNumber(r.sqo_to_joined_denom),
      sqoToJoinedRate: safeDiv(toNumber(r.sqo_to_joined_numer), toNumber(r.sqo_to_joined_denom)),
    }))
    .sort((a, b) => a.quarter.localeCompare(b.quarter));
};

export const getSgmConversionTrend = cachedQuery(
  _getSgmConversionTrend,
  'getSgmConversionTrend',
  CACHE_TAGS.DASHBOARD
);
