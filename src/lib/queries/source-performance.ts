import { runQuery } from '../bigquery';
import { SourcePerformance, ChannelPerformance } from '@/types/dashboard';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { RawSourcePerformanceResult, toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';

export async function getChannelPerformance(filters: DashboardFilters): Promise<ChannelPerformance[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Build conditions manually since we need table aliases
  const conditions: string[] = [];
  const params: Record<string, any> = {
    startDate,
    endDate: endDate + ' 23:59:59',
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
  
  // Use mapped channel from new_mapping table
  conditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') IS NOT NULL');
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      COUNT(*) as prospects,
      SUM(v.is_contacted) as contacted,
      SUM(
        CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN 1 
          ELSE 0 
        END
      ) as mqls,
      SUM(
        CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate)
            AND v.is_sql = 1
          THEN 1 
          ELSE 0 
        END
      ) as sqls,
      SUM(
        CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
          THEN 1 
          ELSE 0 
        END
      ) as sqos,
      SUM(
        CASE 
          WHEN v.advisor_join_date__c IS NOT NULL
            AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP(@endDate)
            AND v.is_joined_unique = 1
          THEN 1 
          ELSE 0 
        END
      ) as joined,
      -- Contacted→MQL (cohort by stage_entered_contacting__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.contacted_to_mql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_contacted_conversions ELSE 0 
        END)
      ) as contacted_to_mql_rate,
      -- MQL→SQL (cohort by stage_entered_contacting__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.mql_to_sql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END)
      ) as mql_to_sql_rate,
      -- SQL→SQO (cohort by converted_date_raw)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate)
          THEN v.sql_to_sqo_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_sql_conversions ELSE 0 
        END)
      ) as sql_to_sqo_rate,
      -- SQO→Joined (cohort by Date_Became_SQO__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
          THEN v.sqo_to_joined_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_sqo_conversions ELSE 0 
        END)
      ) as sqo_to_joined_rate,
      SUM(
        CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
          THEN v.Opportunity_AUM 
          ELSE 0 
        END
      ) as aum
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    ${whereClause}
    GROUP BY COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')
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
}

export async function getSourcePerformance(filters: DashboardFilters): Promise<SourcePerformance[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Build conditions manually since we need table aliases
  const conditions: string[] = [];
  const params: Record<string, any> = {
    startDate,
    endDate: endDate + ' 23:59:59',
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  if (filters.channel) {
    // Use mapped channel from new_mapping table
    conditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') = @channel');
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
  
  conditions.push('v.Original_source IS NOT NULL');
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      v.Original_source as source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      COUNT(*) as prospects,
      SUM(v.is_contacted) as contacted,
      SUM(
        CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN 1 
          ELSE 0 
        END
      ) as mqls,
      SUM(
        CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate)
            AND v.is_sql = 1
          THEN 1 
          ELSE 0 
        END
      ) as sqls,
      SUM(
        CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
          THEN 1 
          ELSE 0 
        END
      ) as sqos,
      SUM(
        CASE 
          WHEN v.advisor_join_date__c IS NOT NULL
            AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP(@endDate)
            AND v.is_joined_unique = 1
          THEN 1 
          ELSE 0 
        END
      ) as joined,
      -- Contacted→MQL (cohort by stage_entered_contacting__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.contacted_to_mql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_contacted_conversions ELSE 0 
        END)
      ) as contacted_to_mql_rate,
      -- MQL→SQL (cohort by stage_entered_contacting__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.mql_to_sql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END)
      ) as mql_to_sql_rate,
      -- SQL→SQO (cohort by converted_date_raw)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate)
          THEN v.sql_to_sqo_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.converted_date_raw IS NOT NULL
            AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_sql_conversions ELSE 0 
        END)
      ) as sql_to_sqo_rate,
      -- SQO→Joined (cohort by Date_Became_SQO__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
          THEN v.sqo_to_joined_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_sqo_conversions ELSE 0 
        END)
      ) as sqo_to_joined_rate,
      SUM(
        CASE 
          WHEN v.Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND v.recordtypeid = @recruitingRecordType
            AND v.is_sqo_unique = 1
          THEN v.Opportunity_AUM 
          ELSE 0 
        END
      ) as aum
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    ${whereClause}
    GROUP BY v.Original_source, COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')
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
}
