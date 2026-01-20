import { runQuery } from '../bigquery';
import { DetailRecord } from '@/types/dashboard';
import { DashboardFilters, DEFAULT_ADVANCED_FILTERS } from '@/types/filters';
import { buildAdvancedFilterClauses } from '../utils/filter-helpers';
import { buildDateRangeFromFilters, formatCurrency } from '../utils/date-helpers';
import { RawDetailRecordResult, toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS, DETAIL_RECORDS_TTL } from '@/lib/cache';

const _getDetailRecords = async (
  filters: DashboardFilters,
  limit: number = 10000  // Reduced to prevent Next.js cache errors (2MB limit)
): Promise<DetailRecord[]> => {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Extract advancedFilters from filters object
  const advancedFilters = filters.advancedFilters || DEFAULT_ADVANCED_FILTERS;
  
  // Build advanced filter clauses
  const { whereClauses: advFilterClauses, params: advFilterParams } = 
    buildAdvancedFilterClauses(advancedFilters, 'adv');
  
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
  if (filters.experimentationTag) {
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
  
  // Determine date field and metric filter based on metricFilter
  let dateField = '';
  let dateFieldAlias = '';
  let metricCondition = '';
  
  switch (filters.metricFilter) {
    case 'prospect':
      // Prospects: Include ALL records where ANY stage date is within the date range
      // This allows client-side filtering to show all SQOs/SQLs/MQLs/Signed/etc that entered those stages in the period,
      // not just records that became prospects in the period
      // NOTE: Do NOT filter by recordtypeid here - match scorecard behavior (MQLs/SQLs/Contacted count all record types)
      // SQOs will be filtered by recordtypeid in the client-side filter to match scorecard behavior
      dateField = 'FilterDate';
      dateFieldAlias = 'relevant_date';
      // Include records where any stage date is in range (including all opportunity stage_entered dates)
      conditions.push(`(
        (FilterDate IS NOT NULL AND TIMESTAMP(FilterDate) >= TIMESTAMP(@startDate) AND TIMESTAMP(FilterDate) <= TIMESTAMP(@endDate))
        OR (Date_Became_SQO__c IS NOT NULL AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate))
        OR (converted_date_raw IS NOT NULL AND DATE(converted_date_raw) >= DATE(@startDate) AND DATE(converted_date_raw) <= DATE(@endDate))
        OR (mql_stage_entered_ts IS NOT NULL AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate) AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate))
        OR (stage_entered_contacting__c IS NOT NULL AND TIMESTAMP(stage_entered_contacting__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(stage_entered_contacting__c) <= TIMESTAMP(@endDate))
        OR (advisor_join_date__c IS NOT NULL AND DATE(advisor_join_date__c) >= DATE(@startDate) AND DATE(advisor_join_date__c) <= DATE(@endDate))
        OR (Stage_Entered_Signed__c IS NOT NULL AND TIMESTAMP(Stage_Entered_Signed__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_Signed__c) <= TIMESTAMP(@endDate))
        OR (Stage_Entered_Discovery__c IS NOT NULL AND TIMESTAMP(Stage_Entered_Discovery__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_Discovery__c) <= TIMESTAMP(@endDate))
        OR (Stage_Entered_Sales_Process__c IS NOT NULL AND TIMESTAMP(Stage_Entered_Sales_Process__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_Sales_Process__c) <= TIMESTAMP(@endDate))
        OR (Stage_Entered_Negotiating__c IS NOT NULL AND TIMESTAMP(Stage_Entered_Negotiating__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_Negotiating__c) <= TIMESTAMP(@endDate))
        OR (Stage_Entered_On_Hold__c IS NOT NULL AND TIMESTAMP(Stage_Entered_On_Hold__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(Stage_Entered_On_Hold__c) <= TIMESTAMP(@endDate))
      )`);
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
      conditions.push('DATE(converted_date_raw) >= DATE(@startDate)');
      conditions.push('DATE(converted_date_raw) <= DATE(@endDate)');
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
    case 'signed':
      // Signed: Filter by Stage_Entered_Signed__c within date range AND is_primary_opp_record = 1 (deduplicate)
      dateField = 'Stage_Entered_Signed__c';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_primary_opp_record = 1');
      conditions.push('Stage_Entered_Signed__c IS NOT NULL');
      conditions.push('TIMESTAMP(Stage_Entered_Signed__c) >= TIMESTAMP(@startDate)');
      conditions.push('TIMESTAMP(Stage_Entered_Signed__c) <= TIMESTAMP(@endDate)');
      break;
    case 'joined':
      // Joined: Filter by advisor_join_date__c within date range
      dateField = 'advisor_join_date__c';
      dateFieldAlias = 'relevant_date';
      conditions.push('is_joined_unique = 1');
      conditions.push('advisor_join_date__c IS NOT NULL');
      conditions.push('DATE(advisor_join_date__c) >= DATE(@startDate)');
      conditions.push('DATE(advisor_join_date__c) <= DATE(@endDate)');
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
      // 'all' - Default behavior depends on active advanced filters
      // If Initial Call Scheduled filter is active, show all records with Initial_Call_Scheduled_Date__c in range
      // If Qualification Call filter is active, show all opportunities with Qualification_Call_Date__c in range
      // Otherwise, default to SQLs filtered by converted_date_raw
      if (advancedFilters.initialCallScheduled.enabled) {
        // Show all records with Initial_Call_Scheduled_Date__c in the date range
        // The advanced filter already filters by Initial_Call_Scheduled_Date__c, so we just need to set the display date
        // Use Initial_Call_Scheduled_Date__c as the display date (the actual date we're filtering by)
        dateField = 'Initial_Call_Scheduled_Date__c';
        dateFieldAlias = 'relevant_date';
        // No additional date filters needed - the advanced filter handles Initial_Call_Scheduled_Date__c filtering
        // We want to show ALL records with initial calls in the period, regardless of when they entered contacting
        // This includes records that were MQL'd in previous quarters but had initial calls scheduled in this period
      } else if (advancedFilters.qualificationCallDate.enabled) {
        // Show all opportunities with Qualification_Call_Date__c in the date range
        // The advanced filter already filters by Qualification_Call_Date__c, so we just need to set the display date
        // Use Opp_CreatedDate as the display date
        dateField = 'Opp_CreatedDate';
        dateFieldAlias = 'relevant_date';
        conditions.push('Full_Opportunity_ID__c IS NOT NULL'); // Only opportunities
        // No additional date filters needed - the advanced filter handles Qualification_Call_Date__c filtering
      } else {
        // Default: Show SQLs filtered by converted_date_raw
        dateField = 'converted_date_raw';
        dateFieldAlias = 'relevant_date';
        conditions.push('is_sql = 1');
        conditions.push('converted_date_raw IS NOT NULL');
        conditions.push('DATE(converted_date_raw) >= DATE(@startDate)');
        conditions.push('DATE(converted_date_raw) <= DATE(@endDate)');
      }
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
      v.FilterDate as filter_date,
      v.stage_entered_contacting__c as contacted_date,
      v.mql_stage_entered_ts as mql_date,
      v.converted_date_raw as sql_date,
      v.Date_Became_SQO__c as sqo_date,
      v.advisor_join_date__c as joined_date,
      v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
      v.Qualification_Call_Date__c as qualification_call_date,
      v.Stage_Entered_Signed__c as signed_date,
      v.Stage_Entered_Discovery__c as discovery_date,
      v.Stage_Entered_Sales_Process__c as sales_process_date,
      v.Stage_Entered_Negotiating__c as negotiating_date,
      v.Stage_Entered_On_Hold__c as on_hold_date,
      v.is_contacted,
      v.is_mql,
      v.is_sql,
      v.is_sqo_unique as is_sqo,
      v.is_joined_unique as is_joined,
      v.recordtypeid,
      v.is_primary_opp_record,
      v.Full_Opportunity_ID__c as opportunity_id
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    ${whereClause}
    ORDER BY v.Opportunity_AUM DESC NULLS LAST
    LIMIT @limit
  `;
  
  const results = await runQuery<RawDetailRecordResult>(query, params);
  
  return results.map(r => {
    // Helper function to extract date values (handles both DATE and TIMESTAMP types)
    // BigQuery returns DATE fields as strings, TIMESTAMP fields as objects with .value
    const extractDate = (field: any): string | null => {
      if (!field) return null;
      if (typeof field === 'string') return field;
      if (typeof field === 'object' && field.value) return field.value;
      return null;
    };
    
    // Extract all date fields
    // Note: FilterDate, stage_entered_contacting__c, mql_stage_entered_ts, Date_Became_SQO__c are TIMESTAMP
    // converted_date_raw and advisor_join_date__c are DATE
    // Stage_Entered_* fields are TIMESTAMP
    const filterDate = extractDate(r.filter_date) || '';
    const contactedDate = extractDate(r.contacted_date);
    const mqlDate = extractDate(r.mql_date);
    const sqlDate = extractDate(r.sql_date); // DATE field
    const sqoDate = extractDate(r.sqo_date);
    const joinedDate = extractDate(r.joined_date); // DATE field
    const signedDate = extractDate(r.signed_date);
    const discoveryDate = extractDate(r.discovery_date);
    const salesProcessDate = extractDate(r.sales_process_date);
    const negotiatingDate = extractDate(r.negotiating_date);
    const onHoldDate = extractDate(r.on_hold_date);
    
    // Extract Initial Call Scheduled Date (DATE field - direct string)
    let initialCallDate: string | null = null;
    if (r.initial_call_scheduled_date) {
      if (typeof r.initial_call_scheduled_date === 'string') {
        initialCallDate = r.initial_call_scheduled_date;
      } else if (typeof r.initial_call_scheduled_date === 'object' && r.initial_call_scheduled_date.value) {
        initialCallDate = r.initial_call_scheduled_date.value;
      }
    }
    
    // Extract Qualification Call Date (DATE field - direct string)
    let qualCallDate: string | null = null;
    if (r.qualification_call_date) {
      if (typeof r.qualification_call_date === 'string') {
        qualCallDate = r.qualification_call_date;
      } else if (typeof r.qualification_call_date === 'object' && r.qualification_call_date.value) {
        qualCallDate = r.qualification_call_date.value;
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
      relevantDate: filterDate, // FilterDate as fallback
      contactedDate: contactedDate,
      mqlDate: mqlDate,
      sqlDate: sqlDate,
      sqoDate: sqoDate,
      joinedDate: joinedDate,
      signedDate: signedDate,
      discoveryDate: discoveryDate,
      salesProcessDate: salesProcessDate,
      negotiatingDate: negotiatingDate,
      onHoldDate: onHoldDate,
      initialCallScheduledDate: initialCallDate,
      qualificationCallDate: qualCallDate,
      isContacted: r.is_contacted === 1,
      isMql: r.is_mql === 1,
      isSql: r.is_sql === 1,
      isSqo: r.is_sqo === 1,
      isJoined: r.is_joined === 1,
      isOpenPipeline: OPEN_PIPELINE_STAGES.includes(toString(r.stage)),
      recordTypeId: r.recordtypeid ? toString(r.recordtypeid) : null,
      isPrimaryOppRecord: (r.is_primary_opp_record ?? 0) === 1,
      opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
    };
  });
};

export const getDetailRecords = cachedQuery(
  _getDetailRecords,
  'getDetailRecords',
  CACHE_TAGS.DASHBOARD,
  DETAIL_RECORDS_TTL
);
