import { runQuery, buildQueryParams } from '../bigquery';
import { FunnelMetrics } from '@/types/dashboard';
import { DashboardFilters, DEFAULT_ADVANCED_FILTERS } from '@/types/filters';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { buildAdvancedFilterClauses } from '../utils/filter-helpers';
import { RawFunnelMetricsResult, RawOpenPipelineResult, toNumber } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

const _getFunnelMetrics = async (filters: DashboardFilters): Promise<FunnelMetrics> => {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Extract advancedFilters from filters object
  const advancedFilters = filters.advancedFilters || DEFAULT_ADVANCED_FILTERS;
  
  // Build advanced filter clauses
  const { whereClauses: advFilterClauses, params: advFilterParams } = 
    buildAdvancedFilterClauses(advancedFilters, 'adv');
  
  // Build parameterized query conditions (EXCLUDE FilterDate - we count by specific date fields)
  // Only include channel, source, sga, sgm filters - NOT date filters
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
  // Note: SGA filter is applied per-metric in CASE statements below
  // Lead-level metrics use SGA_Owner_Name__c, Opportunity-level use Opp_SGA_Name__c
  // We still add it to WHERE for lead-level metrics, but SQO/Joined need Opp_SGA_Name__c in CASE
  // SGA filter application:
  // - Lead-level metrics (Prospects, Contacted, MQL, SQL): Use SGA_Owner_Name__c
  // - Opportunity-level metrics (SQO, Joined): Check BOTH SGA_Owner_Name__c AND Opp_SGA_Name__c
  //   because an SQO can be associated via either field (lead-level or opportunity-level ownership)
  // NOTE: Opp_SGA_Name__c may contain either a name or a Salesforce User ID (005...)
  // We join with User table to resolve IDs to names for proper filtering
  // Only apply if explicitly provided in filters (not automatically applied for main dashboard)
  const sgaFilterForLead = filters.sga ? ' AND v.SGA_Owner_Name__c = @sga' : '';
  const sgaFilterForOpp = filters.sga ? ' AND (v.SGA_Owner_Name__c = @sga OR v.Opp_SGA_Name__c = @sga OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sga)' : '';
  if (filters.sga) {
    // Use OR in WHERE to include records that match either field, then filter correctly in each CASE
    // Also check resolved SGA name from User table (Opp_SGA_Name__c may be an ID)
    conditions.push('(v.SGA_Owner_Name__c = @sga OR v.Opp_SGA_Name__c = @sga OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sga)');
    params.sga = filters.sga;
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
  
  // Add advanced filter clauses to existing conditions
  conditions.push(...advFilterClauses);
  Object.assign(params, advFilterParams);
  
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
            ${sgaFilterForLead}
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
            ${sgaFilterForLead}
          THEN 1 
          ELSE 0 
        END
      ) as contacted,
      -- FIX: MQLs use mql_stage_entered_ts (Call Scheduled), NOT stage_entered_contacting__c
      SUM(
        CASE 
          WHEN mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
            ${sgaFilterForLead}
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
            ${sgaFilterForLead}
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
            ${sgaFilterForOpp}
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
            ${sgaFilterForOpp}
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
            ${sgaFilterForOpp}
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
            ${sgaFilterForOpp}
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
            ${sgaFilterForOpp}
          THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0)
          ELSE 0 
        END
      ) as joined_aum
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
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
  
  const [metrics] = await runQuery<RawFunnelMetricsResult>(metricsQuery, metricsParams);
  const [openPipeline] = await runQuery<RawOpenPipelineResult>(openPipelineQuery, openPipelineParams);
  
  return {
    prospects: toNumber(metrics.prospects),
    contacted: toNumber(metrics.contacted),
    mqls: toNumber(metrics.mqls),
    sqls: toNumber(metrics.sqls),
    sqos: toNumber(metrics.sqos),
    signed: toNumber(metrics.signed),
    signedAum: toNumber(metrics.signed_aum),
    joined: toNumber(metrics.joined),
    pipelineAum: toNumber(metrics.pipeline_aum),
    joinedAum: toNumber(metrics.joined_aum),
    openPipelineAum: toNumber(openPipeline.open_pipeline_aum),
  };
};

export const getFunnelMetrics = cachedQuery(
  _getFunnelMetrics,
  'getFunnelMetrics',
  CACHE_TAGS.DASHBOARD
);
