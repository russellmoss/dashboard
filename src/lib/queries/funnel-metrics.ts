import { runQuery, buildQueryParams } from '../bigquery';
import { FunnelMetrics, AttributionDebugPayload } from '@/types/dashboard';
import { DashboardFilters, DEFAULT_ADVANCED_FILTERS } from '@/types/filters';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { buildAdvancedFilterClauses, buildSgaFilterClause } from '../utils/filter-helpers';
import { isAttributionDebugEnabled } from '../utils/attribution-mode';
import { RawFunnelMetricsResult, RawOpenPipelineResult, toNumber } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

const _getFunnelMetrics = async (
  filters: DashboardFilters,
  ctx?: { isAdmin?: boolean }
): Promise<FunnelMetrics> => {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);

  // Extract advancedFilters from filters object
  const advancedFilters = filters.advancedFilters || DEFAULT_ADVANCED_FILTERS;

  // Build advanced filter clauses (SGA moved out — see buildSgaFilterClause below)
  const { whereClauses: advFilterClauses, params: advFilterParams } =
    buildAdvancedFilterClauses(advancedFilters, 'adv');

  // SGA clause: prefer multi-select; fall back to legacy single-SGA. v2 routes through
  // vw_lead_primary_sga (lead-era); v1 filters on v.SGA_Owner_Name__c (current owner).
  const sgasFilter =
    advancedFilters.sgas && !advancedFilters.sgas.selectAll && advancedFilters.sgas.selected.length > 0
      ? advancedFilters.sgas
      : filters.sga
        ? { selectAll: false, selected: [filters.sga] }
        : undefined;
  const sgaClause = buildSgaFilterClause(sgasFilter, 'adv');

  // Build parameterized query conditions (EXCLUDE FilterDate - we count by specific date fields)
  const conditions: string[] = [];
  const params: Record<string, any> = {};

  if (filters.channel) {
    // Channel_Grouping_Name now comes directly from Finance_View__c in the view
    conditions.push('v.Channel_Grouping_Name = @channel');
    params.channel = filters.channel;
  }
  if (filters.source) {
    conditions.push('v.Original_source = @source');
    params.source = filters.source;
  }
  if (filters.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }
  if (filters.experimentationTag) {
    // Check if the selected tag exists in the Experimentation_Tag_List array
    conditions.push(`EXISTS (
      SELECT 1
      FROM UNNEST(v.Experimentation_Tag_List) as tag
      WHERE tag = @experimentationTag
    )`);
    params.experimentationTag = filters.experimentationTag;
  }
  if (filters.campaignId) {
    conditions.push('(v.Campaign_Id__c = @campaignId OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = @campaignId) > 0)');
    params.campaignId = filters.campaignId;
  }

  // Add advanced filter clauses to existing conditions
  conditions.push(...advFilterClauses);
  Object.assign(params, advFilterParams);

  // Apply the attribution-aware SGA clause.
  if (sgaClause.whereClause) {
    conditions.push(sgaClause.whereClause);
  }
  Object.assign(params, sgaClause.params);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Main metrics query with parameterized values
  // MQLs: Count leads where mql_stage_entered_ts (Call Scheduled) is within date range
  // SQLs: Count leads where converted_date_raw is within date range (is_sql = 1)
  // SQOs: Count opportunities where Date_Became_SQO__c is within date range AND record type is recruiting
  // Joined: Count opportunities where advisor_join_date__c is within date range
  // NOTE: We do NOT filter by FilterDate in WHERE clause - we count by specific date fields
  const metricsQuery = `
    SELECT
      -- Prospects: Count records where FilterDate is in range (no additional conditions)
      SUM(
        CASE
          WHEN v.FilterDate IS NOT NULL
            AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.FilterDate) <= TIMESTAMP(@endDate)
          THEN 1
          ELSE 0
        END
      ) as prospects,
      -- Contacted: Count records where stage_entered_contacting__c is in range AND is_contacted = 1
      SUM(
        CASE
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
            AND v.is_contacted = 1
          THEN 1
          ELSE 0
        END
      ) as contacted,

      -- ═══════════════════════════════════════
      -- CONTACTED DISPOSITION COUNTS
      -- Cohort: entered Contacting stage in the period (is_contacted = 1)
      -- converted: advanced to MQL (is_mql = 1)
      -- lost:      never MQL'd AND lead is closed
      -- open:      never MQL'd AND still not closed
      -- ═══════════════════════════════════════
      SUM(
        CASE
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
            AND v.is_contacted = 1
            AND v.is_mql = 1
          THEN 1 ELSE 0
        END
      ) as contacted_converted,
      SUM(
        CASE
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
            AND v.is_contacted = 1
            AND v.is_mql = 0
            AND v.lead_closed_date IS NOT NULL
          THEN 1 ELSE 0
        END
      ) as contacted_lost,
      SUM(
        CASE
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
            AND v.is_contacted = 1
            AND v.is_mql = 0
            AND v.lead_closed_date IS NULL
          THEN 1 ELSE 0
        END
      ) as contacted_open,

      -- FIX: MQLs use mql_stage_entered_ts (Call Scheduled), NOT stage_entered_contacting__c
      SUM(
        CASE
          WHEN mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          THEN 1
          ELSE 0
        END
      ) as mqls,
      SUM(
        CASE
          WHEN converted_date_raw IS NOT NULL
            AND DATE(converted_date_raw) >= DATE(@startDate)
            AND DATE(converted_date_raw) <= DATE(@endDate)
            AND is_sql = 1
          THEN 1
          ELSE 0
        END
      ) as sqls,
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
      ) as sqos,
      SUM(
        CASE
          WHEN Stage_Entered_Signed__c IS NOT NULL
            AND TIMESTAMP(Stage_Entered_Signed__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(Stage_Entered_Signed__c) <= TIMESTAMP(@endDate)
            AND is_primary_opp_record = 1
          THEN 1
          ELSE 0
        END
      ) as signed,
      SUM(
        CASE
          WHEN v.Stage_Entered_Signed__c IS NOT NULL
            AND TIMESTAMP(v.Stage_Entered_Signed__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.Stage_Entered_Signed__c) <= TIMESTAMP(@endDate)
            AND v.is_primary_opp_record = 1
          THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0)
          ELSE 0
        END
      ) as signed_aum,
      SUM(
        CASE
          WHEN advisor_join_date__c IS NOT NULL
            AND DATE(advisor_join_date__c) >= DATE(@startDate)
            AND DATE(advisor_join_date__c) <= DATE(@endDate)
            AND is_joined_unique = 1
          THEN 1
          ELSE 0
        END
      ) as joined,
      -- Pipeline AUM removed - we only show Open Pipeline AUM (current state, not filtered by date)
      0 as pipeline_aum,
      SUM(
        CASE
          WHEN v.advisor_join_date__c IS NOT NULL
            AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
            AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
            AND v.is_joined_unique = 1
          THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0)
          ELSE 0
        END
      ) as joined_aum,

      -- ═══════════════════════════════════════
      -- MQL DISPOSITION COUNTS
      -- ═══════════════════════════════════════
      SUM(
        CASE
          WHEN mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
            AND is_mql = 1
            AND is_sql = 1
          THEN 1 ELSE 0
        END
      ) as mqls_converted,
      SUM(
        CASE
          WHEN mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
            AND is_mql = 1
            AND is_sql = 0
            AND lead_closed_date IS NOT NULL
          THEN 1 ELSE 0
        END
      ) as mqls_lost,
      SUM(
        CASE
          WHEN mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
            AND is_mql = 1
            AND is_sql = 0
            AND lead_closed_date IS NULL
          THEN 1 ELSE 0
        END
      ) as mqls_open,

      -- ═══════════════════════════════════════
      -- SQL DISPOSITION COUNTS
      -- ═══════════════════════════════════════
      SUM(
        CASE
          WHEN converted_date_raw IS NOT NULL
            AND DATE(converted_date_raw) >= DATE(@startDate)
            AND DATE(converted_date_raw) <= DATE(@endDate)
            AND is_sql = 1
            AND LOWER(SQO_raw) = 'yes'
          THEN 1 ELSE 0
        END
      ) as sqls_converted,
      SUM(
        CASE
          WHEN converted_date_raw IS NOT NULL
            AND DATE(converted_date_raw) >= DATE(@startDate)
            AND DATE(converted_date_raw) <= DATE(@endDate)
            AND is_sql = 1
            AND LOWER(COALESCE(SQO_raw, '')) != 'yes'
            AND StageName = 'Closed Lost'
          THEN 1 ELSE 0
        END
      ) as sqls_lost,
      SUM(
        CASE
          WHEN converted_date_raw IS NOT NULL
            AND DATE(converted_date_raw) >= DATE(@startDate)
            AND DATE(converted_date_raw) <= DATE(@endDate)
            AND is_sql = 1
            AND LOWER(COALESCE(SQO_raw, '')) != 'yes'
            AND (StageName IS NULL OR StageName != 'Closed Lost')
          THEN 1 ELSE 0
        END
      ) as sqls_open,

      -- ═══════════════════════════════════════
      -- SQO DISPOSITION COUNTS
      -- ═══════════════════════════════════════
      SUM(
        CASE
          WHEN Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND recordtypeid = @recruitingRecordType
            AND is_sqo_unique = 1
            AND (advisor_join_date__c IS NOT NULL OR StageName IN ('Joined', 'Signed'))
          THEN 1 ELSE 0
        END
      ) as sqos_converted,
      SUM(
        CASE
          WHEN Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND recordtypeid = @recruitingRecordType
            AND is_sqo_unique = 1
            AND StageName = 'Closed Lost'
            AND advisor_join_date__c IS NULL
          THEN 1 ELSE 0
        END
      ) as sqos_lost,
      SUM(
        CASE
          WHEN Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND recordtypeid = @recruitingRecordType
            AND is_sqo_unique = 1
            AND StageName NOT IN ('Closed Lost', 'Joined', 'Signed')
            AND advisor_join_date__c IS NULL
          THEN 1 ELSE 0
        END
      ) as sqos_open,

      -- ═══════════════════════════════════════
      -- SQO AUM (all + by disposition)
      -- AUM = COALESCE(Underwritten_AUM__c, Amount, 0)
      -- Uses both is_sqo_unique = 1 AND is_primary_opp_record = 1 to dedupe
      -- (matches Slack bot analysis authoritative pattern)
      -- ═══════════════════════════════════════
      SUM(
        CASE
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
            AND v.is_primary_opp_record = 1
          THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0)
          ELSE 0
        END
      ) as sqo_aum,
      SUM(
        CASE
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
            AND v.is_primary_opp_record = 1
            AND (v.advisor_join_date__c IS NOT NULL OR v.StageName IN ('Joined', 'Signed'))
          THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0)
          ELSE 0
        END
      ) as sqo_aum_converted,
      SUM(
        CASE
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
            AND v.is_primary_opp_record = 1
            AND v.StageName = 'Closed Lost'
            AND v.advisor_join_date__c IS NULL
          THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0)
          ELSE 0
        END
      ) as sqo_aum_lost,
      SUM(
        CASE
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
            AND v.is_primary_opp_record = 1
            AND v.StageName NOT IN ('Closed Lost', 'Joined', 'Signed')
            AND v.advisor_join_date__c IS NULL
          THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0)
          ELSE 0
        END
      ) as sqo_aum_open
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
    ${sgaClause.joinClause}
    ${whereClause}
  `;

  // Add date range and recruiting record type to params
  const metricsParams = {
    ...params,
    startDate,
    endDate: endDate + ' 23:59:59', // Include full end date
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  // Open pipeline AUM query - NO FILTERS (always shows current state, all time, all channels/sources)
  // This is a snapshot of current open pipeline, not filtered by date, channel, source, sga, or sgm
  const openPipelineConditions = [
    `v.recordtypeid = @recruitingRecordType`,
    `v.StageName IN (${OPEN_PIPELINE_STAGES.map((_, i) => `@stage${i}`).join(', ')})`,
    'v.is_sqo_unique = 1',
  ];

  const openPipelineParams: Record<string, any> = { recruitingRecordType: RECRUITING_RECORD_TYPE };
  OPEN_PIPELINE_STAGES.forEach((stage, i) => {
    openPipelineParams[`stage${i}`] = stage;
  });

  const openPipelineQuery = `
    SELECT
      SUM(CASE WHEN v.is_primary_opp_record = 1 THEN v.Opportunity_AUM ELSE 0 END) as open_pipeline_aum
    FROM \`${FULL_TABLE}\` v
    WHERE ${openPipelineConditions.join(' AND ')}
  `;

  // Advisor-level metrics for the Joined/Signed scorecards (individual advisors,
  // not opportunities). Driven by vw_close_won and vw_signed_advisors, which use
  // Team_Role='Advisor' with FA_CRD fallback. AUM is once-per-Account (Option A).
  // Alltime preset includes advisors with NULL joined_date (e.g., advisors on a Joined
  // Account who have no joining Opportunity in SFDC — Michael McCarthy is one). For any
  // narrower range we still require a known joined_date so we don't double-count NULL-date
  // advisors into a specific period they may not belong to.
  const isAlltime = filters.datePreset === 'alltime';
  const joinedDateClause = isAlltime
    ? '(joined_date IS NULL OR (joined_date >= DATE(@startDate) AND joined_date <= DATE(@endDate)))'
    : '(joined_date >= DATE(@startDate) AND joined_date <= DATE(@endDate))';
  const advisorMetricsQuery = `
    WITH joined_cohort AS (
      SELECT contact_id, account_id, account_status, account_aum, account_total_aum
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_close_won\`
      WHERE ${joinedDateClause}
    ),
    joined_account_aum AS (
      SELECT
        account_id,
        account_status,
        ANY_VALUE(account_aum) AS underwritten_aum,
        ANY_VALUE(account_total_aum) AS actual_aum
      FROM joined_cohort
      GROUP BY account_id, account_status
    ),
    signed_cohort AS (
      SELECT contact_id, account_id, cohort, account_aum
      FROM \`savvy-gtm-analytics.Tableau_Views.vw_signed_advisors\`
      WHERE signed_date >= DATE(@startDate) AND signed_date <= DATE(@endDate)
    ),
    signed_account_aum AS (
      SELECT account_id, cohort, ANY_VALUE(account_aum) AS aum
      FROM signed_cohort
      GROUP BY account_id, cohort
    )
    SELECT
      (SELECT COUNT(DISTINCT contact_id) FROM joined_cohort) AS joined_all,
      (SELECT COUNT(DISTINCT contact_id) FROM joined_cohort WHERE account_status = 'Joined') AS joined_current,
      (SELECT COUNT(DISTINCT contact_id) FROM joined_cohort WHERE account_status = 'Churned') AS joined_churned,
      (SELECT COALESCE(SUM(underwritten_aum), 0) FROM joined_account_aum) AS joined_aum_all,
      (SELECT COALESCE(SUM(COALESCE(actual_aum, underwritten_aum)), 0) FROM joined_account_aum WHERE account_status = 'Joined') AS joined_aum_current,
      (SELECT COALESCE(SUM(underwritten_aum), 0) FROM joined_account_aum WHERE account_status = 'Churned') AS joined_aum_churned,
      (SELECT COUNT(DISTINCT contact_id) FROM signed_cohort) AS signed_all,
      (SELECT COUNT(DISTINCT contact_id) FROM signed_cohort WHERE cohort = 'joined') AS signed_joined,
      (SELECT COUNT(DISTINCT contact_id) FROM signed_cohort WHERE cohort = 'lost') AS signed_lost,
      (SELECT COALESCE(SUM(aum), 0) FROM signed_account_aum) AS signed_aum_all,
      (SELECT COALESCE(SUM(aum), 0) FROM signed_account_aum WHERE cohort = 'joined') AS signed_aum_joined,
      (SELECT COALESCE(SUM(aum), 0) FROM signed_account_aum WHERE cohort = 'lost') AS signed_aum_lost
  `;
  const advisorMetricsParams = { startDate, endDate };

  const [metrics] = await runQuery<RawFunnelMetricsResult>(metricsQuery, metricsParams);
  const [openPipeline] = await runQuery<RawOpenPipelineResult>(openPipelineQuery, openPipelineParams);
  const [advisorMetrics] = await runQuery<{
    joined_all: number; joined_current: number; joined_churned: number;
    joined_aum_all: number; joined_aum_current: number; joined_aum_churned: number;
    signed_all: number; signed_joined: number; signed_lost: number;
    signed_aum_all: number; signed_aum_joined: number; signed_aum_lost: number;
  }>(advisorMetricsQuery, advisorMetricsParams);

  // ATTRIBUTION_DEBUG side-by-side payload. Admin-only, opt-in via env var, only runs when
  // an SGA filter is active — cheap Contacted→MQL rate for v1 vs v2 comparison during rollout.
  let debug: AttributionDebugPayload | undefined;
  if (ctx?.isAdmin && isAttributionDebugEnabled() && sgasFilter) {
    const baseConditions: string[] = [];
    const baseParams: Record<string, any> = {};
    if (filters.channel) { baseConditions.push('v.Channel_Grouping_Name = @channel'); baseParams.channel = filters.channel; }
    if (filters.source) { baseConditions.push('v.Original_source = @source'); baseParams.source = filters.source; }
    if (filters.sgm) { baseConditions.push('v.SGM_Owner_Name__c = @sgm'); baseParams.sgm = filters.sgm; }
    if (filters.experimentationTag) {
      baseConditions.push(`EXISTS (SELECT 1 FROM UNNEST(v.Experimentation_Tag_List) as tag WHERE tag = @experimentationTag)`);
      baseParams.experimentationTag = filters.experimentationTag;
    }
    if (filters.campaignId) {
      baseConditions.push('(v.Campaign_Id__c = @campaignId OR (SELECT COUNT(1) FROM UNNEST(IFNULL(v.all_campaigns, [])) AS camp WHERE camp.id = @campaignId) > 0)');
      baseParams.campaignId = filters.campaignId;
    }
    baseConditions.push(...advFilterClauses);
    Object.assign(baseParams, advFilterParams);

    const v1SgaClause = buildSgaFilterClause(sgasFilter, 'advv1', 'v1');
    const v2SgaClause = buildSgaFilterClause(sgasFilter, 'advv2', 'v2');
    const debugBaseWhere = baseConditions.length > 0 ? 'AND ' + baseConditions.join(' AND ') : '';

    const buildDebugQuery = (joinClause: string, whereClause: string) => `
      SELECT
        SUM(IFNULL(v.contacted_to_mql_progression, 0)) AS num,
        SUM(IFNULL(v.eligible_for_contacted_conversions_30d, 0)) AS den
      FROM \`${FULL_TABLE}\` v
      ${joinClause}
      WHERE 1=1
        ${debugBaseWhere}
        ${whereClause ? 'AND ' + whereClause : ''}
        AND v.is_contacted = 1
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
    `;

    const dateParams = { startDate, endDate: endDate + ' 23:59:59' };
    const v1Params = { ...baseParams, ...dateParams, ...v1SgaClause.params };
    const v2Params = { ...baseParams, ...dateParams, ...v2SgaClause.params };

    const [v1Res] = await runQuery<{ num: number; den: number }>(
      buildDebugQuery(v1SgaClause.joinClause, v1SgaClause.whereClause),
      v1Params,
    );
    const [v2Res] = await runQuery<{ num: number; den: number }>(
      buildDebugQuery(v2SgaClause.joinClause, v2SgaClause.whereClause),
      v2Params,
    );

    const v1Num = toNumber(v1Res.num);
    const v1Den = toNumber(v1Res.den);
    const v2Num = toNumber(v2Res.num);
    const v2Den = toNumber(v2Res.den);

    debug = {
      v1: { num: v1Num, den: v1Den, rate: v1Num / (v1Den || 1) },
      v2: { num: v2Num, den: v2Den, rate: v2Num / (v2Den || 1) },
    };
  }

  return {
    prospects: toNumber(metrics.prospects),
    contacted: toNumber(metrics.contacted),
    // Contacted disposition counts
    contacted_open: toNumber(metrics.contacted_open),
    contacted_lost: toNumber(metrics.contacted_lost),
    contacted_converted: toNumber(metrics.contacted_converted),
    mqls: toNumber(metrics.mqls),
    sqls: toNumber(metrics.sqls),
    sqos: toNumber(metrics.sqos),
    signed: toNumber(metrics.signed),
    signedAum: toNumber(metrics.signed_aum),
    joined: toNumber(metrics.joined),
    pipelineAum: toNumber(metrics.pipeline_aum),
    joinedAum: toNumber(metrics.joined_aum),
    openPipelineAum: toNumber(openPipeline.open_pipeline_aum),
    // MQL disposition counts
    mqls_open: toNumber(metrics.mqls_open),
    mqls_lost: toNumber(metrics.mqls_lost),
    mqls_converted: toNumber(metrics.mqls_converted),
    // SQL disposition counts
    sqls_open: toNumber(metrics.sqls_open),
    sqls_lost: toNumber(metrics.sqls_lost),
    sqls_converted: toNumber(metrics.sqls_converted),
    // SQO disposition counts
    sqos_open: toNumber(metrics.sqos_open),
    sqos_lost: toNumber(metrics.sqos_lost),
    sqos_converted: toNumber(metrics.sqos_converted),
    // SQO AUM (all + by disposition) — respects disposition toggle in UI
    sqoAum: toNumber(metrics.sqo_aum),
    sqoAum_open: toNumber(metrics.sqo_aum_open),
    sqoAum_lost: toNumber(metrics.sqo_aum_lost),
    sqoAum_converted: toNumber(metrics.sqo_aum_converted),
    joined_all: toNumber(advisorMetrics.joined_all),
    joined_current: toNumber(advisorMetrics.joined_current),
    joined_churned: toNumber(advisorMetrics.joined_churned),
    joinedAum_all: toNumber(advisorMetrics.joined_aum_all),
    joinedAum_current: toNumber(advisorMetrics.joined_aum_current),
    joinedAum_churned: toNumber(advisorMetrics.joined_aum_churned),
    signed_all: toNumber(advisorMetrics.signed_all),
    signed_joined: toNumber(advisorMetrics.signed_joined),
    signed_lost: toNumber(advisorMetrics.signed_lost),
    signedAum_all: toNumber(advisorMetrics.signed_aum_all),
    signedAum_joined: toNumber(advisorMetrics.signed_aum_joined),
    signedAum_lost: toNumber(advisorMetrics.signed_aum_lost),
    ...(debug ? { debug } : {}),
  };
};

export const getFunnelMetrics = cachedQuery(
  _getFunnelMetrics,
  'getFunnelMetrics',
  CACHE_TAGS.DASHBOARD
);
