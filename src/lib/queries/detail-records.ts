import { runQuery } from '../bigquery';
import { DetailRecord } from '@/types/dashboard';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters, formatCurrency } from '../utils/date-helpers';
import { RawDetailRecordResult, toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';

export async function getDetailRecords(
  filters: DashboardFilters,
  limit: number = 50000
): Promise<DetailRecord[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Build parameterized query conditions
  const conditions: string[] = [];
  const params: Record<string, any> = {
    startDate,
    endDate: endDate + ' 23:59:59',
    limit,
  };
  
  // Add channel/source/sga/sgm filters (no date filter here - we'll add date filter based on metric)
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
  
  // Determine date field and metric filter based on metricFilter
  let dateField = '';
  let dateFieldAlias = '';
  let metricCondition = '';
  
  switch (filters.metricFilter) {
    case 'prospect':
      // Prospects: Filter by FilterDate within date range (all records)
      dateField = 'FilterDate';
      dateFieldAlias = 'relevant_date';
      conditions.push('FilterDate IS NOT NULL');
      conditions.push('TIMESTAMP(FilterDate) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(FilterDate) <= TIMESTAMP(@endDate)');
      // No additional filters needed
      break;
    case 'contacted':
      // Contacted: Filter by stage_entered_contacting__c within date range AND is_contacted = 1
      dateField = 'stage_entered_contacting__c';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_contacted = 1');
      conditions.push('stage_entered_contacting__c IS NOT NULL');
      conditions.push('TIMESTAMP(stage_entered_contacting__c) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(stage_entered_contacting__c) <= TIMESTAMP(@endDate)');
      break;
    case 'mql':
      // MQLs: Filter by mql_stage_entered_ts within date range AND is_mql = 1
      dateField = 'mql_stage_entered_ts';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_mql = 1');
      conditions.push('mql_stage_entered_ts IS NOT NULL');
      conditions.push('TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)');
      break;
    case 'sql':
      // SQLs: Filter by converted_date_raw within date range
      dateField = 'converted_date_raw';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_sql = 1');
      conditions.push('converted_date_raw IS NOT NULL');
      conditions.push('TIMESTAMP(converted_date_raw) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(converted_date_raw) <= TIMESTAMP(@endDate)');
      break;
    case 'sqo':
      // SQOs: Filter by Date_Became_SQO__c within date range AND recruiting record type
      dateField = 'Date_Became_SQO__c';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_sqo_unique = 1');
      conditions.push('recordtypeid = @recruitingRecordType');
      conditions.push('Date_Became_SQO__c IS NOT NULL');
      conditions.push('TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)');
      params.recruitingRecordType = RECRUITING_RECORD_TYPE;
      break;
    case 'joined':
      // Joined: Filter by advisor_join_date__c within date range
      dateField = 'advisor_join_date__c';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_joined_unique = 1');
      conditions.push('advisor_join_date__c IS NOT NULL');
      conditions.push('TIMESTAMP(advisor_join_date__c) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(advisor_join_date__c) <= TIMESTAMP(@endDate)');
      break;
    case 'openPipeline':
      // Open Pipeline: No date filter (current state), but filter by stages
      dateField = 'FilterDate'; // Fallback for display
      dateFieldAlias = 'relevant_date';
      const stageParams = OPEN_PIPELINE_STAGES.map((_, i) => `@stage${i}`);
      conditions.push(`StageName IN (${stageParams.join(', ')})`);
      OPEN_PIPELINE_STAGES.forEach((stage, i) => {
        params[`stage${i}`] = stage;
      });
      conditions.push('is_sqo_unique = 1');
      conditions.push('recordtypeid = @recruitingRecordType');
      params.recruitingRecordType = RECRUITING_RECORD_TYPE;
      // No date filter for open pipeline - it's current state
      break;
    default:
      // 'all' - Show SQLs filtered by converted_date_raw
      dateField = 'converted_date_raw';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_sql = 1');
      conditions.push('converted_date_raw IS NOT NULL');
      conditions.push('TIMESTAMP(converted_date_raw) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(converted_date_raw) <= TIMESTAMP(@endDate)');
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      v.primary_key as id,
      v.advisor_name,
      v.Original_source as source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      v.StageName as stage,
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      v.Opportunity_AUM as aum,
      v.salesforce_url,
      ${dateField} as relevant_date,
      v.is_contacted,
      v.is_mql,
      v.is_sql,
      v.is_sqo_unique as is_sqo,
      v.is_joined_unique as is_joined
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    ${whereClause}
    ORDER BY v.Opportunity_AUM DESC NULLS LAST
    LIMIT @limit
  `;
  
  const results = await runQuery<RawDetailRecordResult>(query, params);
  
  return results.map(r => {
    // Extract date value - handle both DATE and TIMESTAMP types, and both field names
    let dateValue = '';
    const dateField = r.relevant_date || r.filter_date;
    if (dateField) {
      if (typeof dateField === 'object' && dateField.value) {
        dateValue = dateField.value;
      } else if (typeof dateField === 'string') {
        dateValue = dateField;
      }
    }
    
    return {
      id: toString(r.id),
      advisorName: toString(r.advisor_name) || 'Unknown',
      source: toString(r.source) || 'Unknown',
      channel: toString(r.channel) || 'Unknown',
      stage: toString(r.stage) || 'Unknown',
      sga: r.sga ? toString(r.sga) : null,
      sgm: r.sgm ? toString(r.sgm) : null,
      aum: toNumber(r.aum),
      aumFormatted: formatCurrency(r.aum),
      salesforceUrl: toString(r.salesforce_url) || '',
      relevantDate: dateValue,
      isContacted: r.is_contacted === 1,
      isMql: r.is_mql === 1,
      isSql: r.is_sql === 1,
      isSqo: r.is_sqo === 1,
      isJoined: r.is_joined === 1,
      isOpenPipeline: OPEN_PIPELINE_STAGES.includes(toString(r.stage)),
    };
  });
}
