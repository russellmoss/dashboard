import { runQuery } from '../bigquery';
import { ExportDetailRecord, ConversionAnalysisRecord } from '../sheets/sheets-types';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { FULL_TABLE, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';

/**
 * Get all detail records for export with full field set
 * This query retrieves ALL fields needed for conversion rate validation
 */
export async function getExportDetailRecords(
  filters: DashboardFilters,
  limit: number = 10000
): Promise<ExportDetailRecord[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  const conditions: string[] = [];
  const params: Record<string, any> = {
    startDate,
    endDate: endDate + ' 23:59:59',
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    limit,
  };

  // Apply filters
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

  // Date filter - include records that have any activity in the period
  // Cast all date fields to TIMESTAMP to match parameter types
  conditions.push(`(
    (TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.FilterDate) <= TIMESTAMP(@endDate))
    OR (TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate))
    OR (TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate))
    OR (TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate))
    OR (TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP(@endDate))
  )`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT
      -- Identifiers
      v.Full_prospect_id__c as lead_id,
      NULL as contact_id,  -- Contact ID not available in vw_funnel_master
      v.Full_Opportunity_ID__c as opportunity_id,
      v.primary_key,
      
      -- Advisor Info
      v.advisor_name,
      v.salesforce_url,
      
      -- Attribution
      v.Original_source as original_source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      
      -- Stage Info
      v.StageName as stage_name,
      COALESCE(v.Underwritten_AUM__c, v.Amount, 0) as aum,
      
      -- Date Fields
      FORMAT_TIMESTAMP('%Y-%m-%d', v.FilterDate) as filter_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.stage_entered_contacting__c) as contacted_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.mql_stage_entered_ts) as mql_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.converted_date_raw) as sql_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.Date_Became_SQO__c) as sqo_date,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.advisor_join_date__c) as joined_date,
      
      -- Stage Flags
      v.is_contacted,
      v.is_mql,
      v.is_sql,
      CASE WHEN LOWER(v.SQO_raw) = 'yes' THEN 1 ELSE 0 END as is_sqo,
      CASE WHEN v.advisor_join_date__c IS NOT NULL OR v.StageName = 'Joined' THEN 1 ELSE 0 END as is_joined,
      
      -- Progression Flags (Numerators)
      v.contacted_to_mql_progression,
      v.mql_to_sql_progression,
      v.sql_to_sqo_progression,
      v.sqo_to_joined_progression,
      
      -- Eligibility Flags (Denominators)
      v.eligible_for_contacted_conversions,
      v.eligible_for_mql_conversions,
      v.eligible_for_sql_conversions,
      v.eligible_for_sqo_conversions,
      
      -- Deduplication Flags
      v.is_sqo_unique,
      v.is_joined_unique,
      v.is_primary_opp_record,
      
      -- Record Type
      v.recordtypeid as record_type_id,
      CASE 
        WHEN v.recordtypeid = @recruitingRecordType THEN 'Recruiting'
        WHEN v.recordtypeid = '012VS000009VoxrYAC' THEN 'Re-Engagement'
        ELSE 'Unknown'
      END as record_type_name

    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
    ${whereClause}
    ORDER BY v.FilterDate DESC
    LIMIT @limit
  `;

  interface RawExportRecord {
    lead_id: string | null;
    contact_id: string | null;
    opportunity_id: string | null;
    primary_key: string;
    advisor_name: string | null;
    salesforce_url: string | null;
    original_source: string | null;
    channel: string | null;
    sga: string | null;
    sgm: string | null;
    stage_name: string | null;
    aum: number | null;
    filter_date: string | null;
    contacted_date: string | null;
    mql_date: string | null;
    sql_date: string | null;
    sqo_date: string | null;
    joined_date: string | null;
    is_contacted: number;
    is_mql: number;
    is_sql: number;
    is_sqo: number;
    is_joined: number;
    contacted_to_mql_progression: number;
    mql_to_sql_progression: number;
    sql_to_sqo_progression: number;
    sqo_to_joined_progression: number;
    eligible_for_contacted_conversions: number;
    eligible_for_mql_conversions: number;
    eligible_for_sql_conversions: number;
    eligible_for_sqo_conversions: number;
    is_sqo_unique: number;
    is_joined_unique: number;
    is_primary_opp_record: number;
    record_type_id: string | null;
    record_type_name: string;
  }

  const results = await runQuery<RawExportRecord>(query, params);

  return results.map(r => ({
    leadId: r.lead_id,
    contactId: r.contact_id,
    opportunityId: r.opportunity_id,
    primaryKey: r.primary_key,
    advisorName: r.advisor_name || 'Unknown',
    salesforceUrl: r.salesforce_url,
    originalSource: r.original_source,
    channel: r.channel,
    sga: r.sga,
    sgm: r.sgm,
    stageName: r.stage_name,
    aum: Number(r.aum) || 0,
    aumFormatted: formatCurrency(Number(r.aum) || 0),
    filterDate: r.filter_date,
    contactedDate: r.contacted_date,
    mqlDate: r.mql_date,
    sqlDate: r.sql_date,
    sqoDate: r.sqo_date,
    joinedDate: r.joined_date,
    isContacted: r.is_contacted,
    isMql: r.is_mql,
    isSql: r.is_sql,
    isSqo: r.is_sqo,
    isJoined: r.is_joined,
    contactedToMqlProgression: r.contacted_to_mql_progression,
    mqlToSqlProgression: r.mql_to_sql_progression,
    sqlToSqoProgression: r.sql_to_sqo_progression,
    sqoToJoinedProgression: r.sqo_to_joined_progression,
    eligibleForContactedConversions: r.eligible_for_contacted_conversions,
    eligibleForMqlConversions: r.eligible_for_mql_conversions,
    eligibleForSqlConversions: r.eligible_for_sql_conversions,
    eligibleForSqoConversions: r.eligible_for_sqo_conversions,
    isSqoUnique: r.is_sqo_unique,
    isJoinedUnique: r.is_joined_unique,
    isPrimaryOppRecord: r.is_primary_opp_record,
    recordTypeId: r.record_type_id,
    recordTypeName: r.record_type_name,
  }));
}

/**
 * Build conversion analysis from detail records
 */
export function buildConversionAnalysis(records: ExportDetailRecord[]): {
  contactedToMql: ConversionAnalysisRecord[];
  mqlToSql: ConversionAnalysisRecord[];
  sqlToSqo: ConversionAnalysisRecord[];
  sqoToJoined: ConversionAnalysisRecord[];
} {
  const contactedToMql: ConversionAnalysisRecord[] = [];
  const mqlToSql: ConversionAnalysisRecord[] = [];
  const sqlToSqo: ConversionAnalysisRecord[] = [];
  const sqoToJoined: ConversionAnalysisRecord[] = [];

  for (const r of records) {
    // Contacted → MQL analysis
    if (r.eligibleForContactedConversions || r.contactedToMqlProgression) {
      contactedToMql.push({
        advisorName: r.advisorName,
        salesforceUrl: r.salesforceUrl,
        fromDate: r.contactedDate,
        toDate: r.mqlDate,
        inNumerator: r.contactedToMqlProgression === 1,
        inDenominator: r.eligibleForContactedConversions === 1,
        notes: buildNotes('Contacted→MQL', r),
      });
    }

    // MQL → SQL analysis
    if (r.eligibleForMqlConversions || r.mqlToSqlProgression) {
      mqlToSql.push({
        advisorName: r.advisorName,
        salesforceUrl: r.salesforceUrl,
        fromDate: r.mqlDate,
        toDate: r.sqlDate,
        inNumerator: r.mqlToSqlProgression === 1,
        inDenominator: r.eligibleForMqlConversions === 1,
        notes: buildNotes('MQL→SQL', r),
      });
    }

    // SQL → SQO analysis
    if (r.eligibleForSqlConversions || r.sqlToSqoProgression) {
      sqlToSqo.push({
        advisorName: r.advisorName,
        salesforceUrl: r.salesforceUrl,
        fromDate: r.sqlDate,
        toDate: r.sqoDate,
        inNumerator: r.sqlToSqoProgression === 1,
        inDenominator: r.eligibleForSqlConversions === 1,
        notes: buildNotes('SQL→SQO', r),
      });
    }

    // SQO → Joined analysis
    if (r.eligibleForSqoConversions || r.sqoToJoinedProgression) {
      sqoToJoined.push({
        advisorName: r.advisorName,
        salesforceUrl: r.salesforceUrl,
        fromDate: r.sqoDate,
        toDate: r.joinedDate,
        inNumerator: r.sqoToJoinedProgression === 1,
        inDenominator: r.eligibleForSqoConversions === 1,
        notes: buildNotes('SQO→Joined', r),
      });
    }
  }

  return { contactedToMql, mqlToSql, sqlToSqo, sqoToJoined };
}

function buildNotes(conversionType: string, record: ExportDetailRecord): string {
  const notes: string[] = [];
  
  if (record.stageName) {
    notes.push(`Stage: ${record.stageName}`);
  }
  
  if (record.isSqoUnique === 0 && conversionType.includes('SQO')) {
    notes.push('Duplicate SQO (not counted)');
  }
  
  if (record.isJoinedUnique === 0 && conversionType.includes('Joined')) {
    notes.push('Duplicate Joined (not counted)');
  }
  
  return notes.join('; ');
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  } else if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}
