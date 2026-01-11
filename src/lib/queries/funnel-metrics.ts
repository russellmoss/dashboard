import { runQuery, buildQueryParams } from '../bigquery';
import { FunnelMetrics } from '@/types/dashboard';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { RawFunnelMetricsResult, RawOpenPipelineResult, toNumber } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';

export async function getFunnelMetrics(filters: DashboardFilters): Promise<FunnelMetrics> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Build parameterized query conditions (EXCLUDE FilterDate - we count by specific date fields)
  // Only include channel, source, sga, sgm filters - NOT date filters
  const conditions: string[] = [];
  const params: Record<string, any> = {};
  
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
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Main metrics query with parameterized values
  // MQLs: Count leads where mql_stage_entered_ts (Call Scheduled) is within date range
  // SQLs: Count leads where converted_date_raw is within date range (is_sql = 1)
  // SQOs: Count opportunities where Date_Became_SQO__c is within date range AND record type is recruiting
  // Joined: Count opportunities where advisor_join_date__c is within date range
  // NOTE: We do NOT filter by FilterDate in WHERE clause - we count by specific date fields
  const metricsQuery = `
    SELECT
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
            AND TIMESTAMP(converted_date_raw) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(converted_date_raw) <= TIMESTAMP(@endDate)
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
          WHEN advisor_join_date__c IS NOT NULL
            AND TIMESTAMP(advisor_join_date__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(advisor_join_date__c) <= TIMESTAMP(@endDate)
            AND is_joined_unique = 1
          THEN 1 
          ELSE 0 
        END
      ) as joined,
      -- Pipeline AUM removed - we only show Open Pipeline AUM (current state, not filtered by date)
      0 as pipeline_aum,
      SUM(
        CASE 
          WHEN advisor_join_date__c IS NOT NULL
            AND TIMESTAMP(advisor_join_date__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(advisor_join_date__c) <= TIMESTAMP(@endDate)
            AND is_joined_unique = 1
          THEN Opportunity_AUM 
          ELSE 0 
        END
      ) as joined_aum
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
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
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    WHERE ${openPipelineConditions.join(' AND ')}
  `;
  
  const [metrics] = await runQuery<RawFunnelMetricsResult>(metricsQuery, metricsParams);
  const [openPipeline] = await runQuery<RawOpenPipelineResult>(openPipelineQuery, openPipelineParams);
  
  return {
    sqls: toNumber(metrics.sqls),
    sqos: toNumber(metrics.sqos),
    joined: toNumber(metrics.joined),
    pipelineAum: toNumber(metrics.pipeline_aum),
    joinedAum: toNumber(metrics.joined_aum),
    openPipelineAum: toNumber(openPipeline.open_pipeline_aum),
  };
}
