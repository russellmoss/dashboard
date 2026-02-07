import { runQuery } from '../bigquery';
import { SourcePerformance, ChannelPerformance } from '@/types/dashboard';
import { DashboardFilters, DEFAULT_ADVANCED_FILTERS } from '@/types/filters';
import { buildAdvancedFilterClauses } from '../utils/filter-helpers';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { RawSourcePerformanceResult, toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

const _getChannelPerformance = async (filters: DashboardFilters): Promise<ChannelPerformance[]> => {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Extract advancedFilters from filters object
  const advancedFilters = filters.advancedFilters || DEFAULT_ADVANCED_FILTERS;
  
  // Build advanced filter clauses
  const { whereClauses: advFilterClauses, params: advFilterParams } = 
    buildAdvancedFilterClauses(advancedFilters, 'adv');
  
  // Build conditions manually since we need table aliases
  const conditions: string[] = [];
  // Use separate DATE and TIMESTAMP parameters to avoid type conflicts
  // DATE parameters: plain date strings (YYYY-MM-DD)
  // TIMESTAMP parameters: date strings with time (YYYY-MM-DD HH:MM:SS)
  const params: Record<string, any> = {
    startDate, // Used for DATE() comparisons
    endDate, // Used for DATE() comparisons (without time)
    startDateTimestamp: startDate + ' 00:00:00', // Used for TIMESTAMP() comparisons
    endDateTimestamp: endDate + ' 23:59:59', // Used for TIMESTAMP() comparisons
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  if (filters.sga) {
    conditions.push('v.SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }
  if (filters.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }
  if (filters.experimentationTag) {
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
  
  // Channel_Grouping_Name now comes directly from Finance_View__c in the view
  conditions.push('v.Channel_Grouping_Name IS NOT NULL');
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      v.Channel_Grouping_Name as channel,
      -- FIX: prospects filtered by FilterDate (the cohort date that handles recycled leads)
      SUM(
        CASE 
          WHEN v.FilterDate IS NOT NULL
            AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.FilterDate) <= TIMESTAMP(@endDateTimestamp)
          THEN 1 
          ELSE 0 
        END
      ) as prospects,
      -- FIX: contacted filtered by stage_entered_contacting__c (Contacting stage) AND is_contacted = 1
      SUM(
        CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDateTimestamp)
            AND v.is_contacted = 1
          THEN 1 
          ELSE 0 
        END
      ) as contacted,
      -- FIX: MQLs filtered by mql_stage_entered_ts (Call Scheduled stage = Stage_Entered_Call_Scheduled__c)
      SUM(
        CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDateTimestamp)
          THEN 1 
          ELSE 0 
        END
      ) as mqls,
      SUM(
        CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND DATE(v.converted_date_raw) >= DATE(@startDate) 
            AND DATE(v.converted_date_raw) <= DATE(@endDate)
            AND v.is_sql = 1
          THEN 1 
          ELSE 0 
        END
      ) as sqls,
      SUM(
        CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDateTimestamp)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
          THEN 1 
          ELSE 0 
        END
      ) as sqos,
      SUM(
        CASE 
          WHEN v.advisor_join_date__c IS NOT NULL
            AND DATE(v.advisor_join_date__c) >= DATE(@startDate) 
            AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
            AND v.is_joined_unique = 1
          THEN 1 
          ELSE 0 
        END
      ) as joined,
      -- Contacted→MQL (cohort by stage_entered_contacting__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDateTimestamp)
          THEN v.contacted_to_mql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDateTimestamp)
          THEN v.eligible_for_contacted_conversions_30d ELSE 0 
        END)
      ) as contacted_to_mql_rate,
      -- MQL→SQL (cohort by mql_stage_entered_ts - people who became MQL in the period)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDateTimestamp)
          THEN v.mql_to_sql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDateTimestamp)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END)
      ) as mql_to_sql_rate,
      -- SQL→SQO (cohort by converted_date_raw)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND DATE(v.converted_date_raw) >= DATE(@startDate)
            AND DATE(v.converted_date_raw) <= DATE(@endDate)
          THEN v.sql_to_sqo_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND DATE(v.converted_date_raw) >= DATE(@startDate)
            AND DATE(v.converted_date_raw) <= DATE(@endDate)
          THEN v.eligible_for_sql_conversions ELSE 0 
        END)
      ) as sql_to_sqo_rate,
      -- SQO→Joined (cohort by Date_Became_SQO__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDateTimestamp)
          THEN v.sqo_to_joined_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDateTimestamp)
          THEN v.eligible_for_sqo_conversions ELSE 0 
        END)
      ) as sqo_to_joined_rate,
      SUM(
        CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDateTimestamp)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
          THEN v.Opportunity_AUM 
          ELSE 0 
        END
      ) as aum
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    GROUP BY v.Channel_Grouping_Name
    ORDER BY sqls DESC
  `;
  
  const results = await runQuery<RawSourcePerformanceResult>(query, params);
  
  return results.map(r => ({
    channel: toString(r.channel),
    prospects: toNumber(r.prospects),
    contacted: toNumber(r.contacted),
    mqls: toNumber(r.mqls),
    sqls: toNumber(r.sqls),
    sqos: toNumber(r.sqos),
    joined: toNumber(r.joined),
    contactedToMqlRate: toNumber(r.contacted_to_mql_rate),
    mqlToSqlRate: toNumber(r.mql_to_sql_rate),
    sqlToSqoRate: toNumber(r.sql_to_sqo_rate),
    sqoToJoinedRate: toNumber(r.sqo_to_joined_rate),
    aum: toNumber(r.aum),
  }));
};

const _getSourcePerformance = async (filters: DashboardFilters): Promise<SourcePerformance[]> => {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Extract advancedFilters from filters object
  const advancedFilters = filters.advancedFilters || DEFAULT_ADVANCED_FILTERS;
  
  // Build advanced filter clauses
  const { whereClauses: advFilterClauses, params: advFilterParams } = 
    buildAdvancedFilterClauses(advancedFilters, 'adv');
  
  // Build conditions manually since we need table aliases
  const conditions: string[] = [];
  // Use separate DATE and TIMESTAMP parameters to avoid type conflicts
  // DATE parameters: plain date strings (YYYY-MM-DD)
  // TIMESTAMP parameters: date strings with time (YYYY-MM-DD HH:MM:SS)
  const params: Record<string, any> = {
    startDate, // Used for DATE() comparisons
    endDate, // Used for DATE() comparisons (without time)
    startDateTimestamp: startDate + ' 00:00:00', // Used for TIMESTAMP() comparisons
    endDateTimestamp: endDate + ' 23:59:59', // Used for TIMESTAMP() comparisons
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  if (filters.channel) {
    // Channel_Grouping_Name now comes directly from Finance_View__c in the view
    conditions.push('v.Channel_Grouping_Name = @channel');
    params.channel = filters.channel;
  }
  if (filters.sga) {
    conditions.push('v.SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }
  if (filters.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }
  if (filters.experimentationTag) {
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
  
  conditions.push('v.Original_source IS NOT NULL');
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      v.Original_source as source,
      v.Channel_Grouping_Name as channel,
      -- FIX: prospects filtered by FilterDate (the cohort date that handles recycled leads)
      SUM(
        CASE 
          WHEN v.FilterDate IS NOT NULL
            AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.FilterDate) <= TIMESTAMP(@endDateTimestamp)
          THEN 1 
          ELSE 0 
        END
      ) as prospects,
      -- FIX: contacted filtered by stage_entered_contacting__c (Contacting stage) AND is_contacted = 1
      SUM(
        CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDateTimestamp)
            AND v.is_contacted = 1
          THEN 1 
          ELSE 0 
        END
      ) as contacted,
      -- FIX: MQLs filtered by mql_stage_entered_ts (Call Scheduled stage = Stage_Entered_Call_Scheduled__c)
      SUM(
        CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDateTimestamp)
          THEN 1 
          ELSE 0 
        END
      ) as mqls,
      SUM(
        CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND DATE(v.converted_date_raw) >= DATE(@startDate) 
            AND DATE(v.converted_date_raw) <= DATE(@endDate)
            AND v.is_sql = 1
          THEN 1 
          ELSE 0 
        END
      ) as sqls,
      SUM(
        CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDateTimestamp)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
          THEN 1 
          ELSE 0 
        END
      ) as sqos,
      SUM(
        CASE 
          WHEN v.advisor_join_date__c IS NOT NULL
            AND DATE(v.advisor_join_date__c) >= DATE(@startDate) 
            AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
            AND v.is_joined_unique = 1
          THEN 1 
          ELSE 0 
        END
      ) as joined,
      -- Contacted→MQL (cohort by stage_entered_contacting__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDateTimestamp)
          THEN v.contacted_to_mql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDateTimestamp)
          THEN v.eligible_for_contacted_conversions_30d ELSE 0 
        END)
      ) as contacted_to_mql_rate,
      -- MQL→SQL (cohort by mql_stage_entered_ts - people who became MQL in the period)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDateTimestamp)
          THEN v.mql_to_sql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDateTimestamp)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END)
      ) as mql_to_sql_rate,
      -- SQL→SQO (cohort by converted_date_raw)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND DATE(v.converted_date_raw) >= DATE(@startDate)
            AND DATE(v.converted_date_raw) <= DATE(@endDate)
          THEN v.sql_to_sqo_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND DATE(v.converted_date_raw) >= DATE(@startDate)
            AND DATE(v.converted_date_raw) <= DATE(@endDate)
          THEN v.eligible_for_sql_conversions ELSE 0 
        END)
      ) as sql_to_sqo_rate,
      -- SQO→Joined (cohort by Date_Became_SQO__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDateTimestamp)
          THEN v.sqo_to_joined_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDateTimestamp)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDateTimestamp)
          THEN v.eligible_for_sqo_conversions ELSE 0 
        END)
      ) as sqo_to_joined_rate,
      SUM(
        CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDateTimestamp) 
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDateTimestamp)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
          THEN v.Opportunity_AUM 
          ELSE 0 
        END
      ) as aum
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    GROUP BY v.Original_source, v.Channel_Grouping_Name
    ORDER BY sqls DESC
  `;
  
  const results = await runQuery<RawSourcePerformanceResult>(query, params);
  
  return results.map(r => ({
    source: toString(r.source),
    channel: toString(r.channel),
    prospects: toNumber(r.prospects),
    contacted: toNumber(r.contacted),
    mqls: toNumber(r.mqls),
    sqls: toNumber(r.sqls),
    sqos: toNumber(r.sqos),
    joined: toNumber(r.joined),
    contactedToMqlRate: toNumber(r.contacted_to_mql_rate),
    mqlToSqlRate: toNumber(r.mql_to_sql_rate),
    sqlToSqoRate: toNumber(r.sql_to_sqo_rate),
    sqoToJoinedRate: toNumber(r.sqo_to_joined_rate),
    aum: toNumber(r.aum),
  }));
};

export const getChannelPerformance = cachedQuery(
  _getChannelPerformance,
  'getChannelPerformance',
  CACHE_TAGS.DASHBOARD
);

export const getSourcePerformance = cachedQuery(
  _getSourcePerformance,
  'getSourcePerformance',
  CACHE_TAGS.DASHBOARD
);
