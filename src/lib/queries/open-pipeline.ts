import { runQuery, buildQueryParams } from '../bigquery';
import { DetailRecord } from '@/types/dashboard';
import { formatCurrency } from '../utils/date-helpers';
import { RawDetailRecordResult, RawOpenPipelineResult, toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

const _getOpenPipelineRecords = async (
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string }
): Promise<DetailRecord[]> => {
  // Build conditions manually since we need table aliases
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  if (filters?.channel) {
    // Use mapped channel from new_mapping table
    conditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') = @channel');
    params.channel = filters.channel;
  }
  if (filters?.source) {
    conditions.push('v.Original_source = @source');
    params.source = filters.source;
  }
  if (filters?.sga) {
    conditions.push('v.SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }
  if (filters?.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }
  
  conditions.push(`v.recordtypeid = @recruitingRecordType`);
  
  // Parameterize stage array
  const stageParams = OPEN_PIPELINE_STAGES.map((_, i) => `@stage${i}`);
  conditions.push(`v.StageName IN (${stageParams.join(', ')})`);
  OPEN_PIPELINE_STAGES.forEach((stage, i) => {
    params[`stage${i}`] = stage;
  });
  
  conditions.push('v.is_sqo_unique = 1');
  
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
      v.FilterDate as relevant_date,
      v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
      v.Qualification_Call_Date__c as qualification_call_date,
      v.is_contacted,
      v.is_mql,
      v.recordtypeid
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    ${whereClause}
    ORDER BY v.Opportunity_AUM DESC NULLS LAST
  `;
  
  const results = await runQuery<RawDetailRecordResult>(query, params);
  
  return results.map(r => {
    // Helper function to extract date values (handles both DATE and TIMESTAMP types)
    const extractDate = (field: any): string | null => {
      if (!field) return null;
      if (typeof field === 'string') return field;
      if (typeof field === 'object' && field.value) return field.value;
      return null;
    };
    
    // Extract all date fields
    const filterDate = extractDate(r.filter_date) || '';
    const contactedDate = extractDate(r.contacted_date);
    const mqlDate = extractDate(r.mql_date);
    const sqlDate = extractDate(r.sql_date);
    const sqoDate = extractDate(r.sqo_date);
    const joinedDate = extractDate(r.joined_date);
    
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
      relevantDate: filterDate,
      contactedDate: contactedDate,
      mqlDate: mqlDate,
      sqlDate: sqlDate,
      sqoDate: sqoDate,
      joinedDate: joinedDate,
      signedDate: null, // Open pipeline doesn't include signed opportunities
      discoveryDate: null,
      salesProcessDate: null,
      negotiatingDate: null,
      onHoldDate: null,
      closedDate: null,
      initialCallScheduledDate: initialCallDate,
      qualificationCallDate: qualCallDate,
      isContacted: r.is_contacted === 1,
      isMql: r.is_mql === 1,
      isSql: true,
      isSqo: true,
      isJoined: false,
      isOpenPipeline: OPEN_PIPELINE_STAGES.includes(toString(r.stage)),
      recordTypeId: r.recordtypeid ? toString(r.recordtypeid) : null,
      isPrimaryOppRecord: true, // Open pipeline records are already filtered to primary records
      opportunityId: null, // Not needed for open pipeline
    };
  });
};

export const getOpenPipelineRecords = cachedQuery(
  _getOpenPipelineRecords,
  'getOpenPipelineRecords',
  CACHE_TAGS.DASHBOARD
);

const _getOpenPipelineSummary = async (): Promise<{
  totalAum: number;
  recordCount: number;
  byStage: { stage: string; count: number; aum: number }[];
}> => {
  const { conditions, params } = buildQueryParams({}); // No date filters for summary
  
  conditions.push(`recordtypeid = @recruitingRecordType`);
  params.recruitingRecordType = RECRUITING_RECORD_TYPE;
  
  // Parameterize stage array
  const stageParams = OPEN_PIPELINE_STAGES.map((_, i) => `@stage${i}`);
  conditions.push(`StageName IN (${stageParams.join(', ')})`);
  OPEN_PIPELINE_STAGES.forEach((stage, i) => {
    params[`stage${i}`] = stage;
  });
  
  conditions.push('is_sqo_unique = 1');
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      StageName as stage,
      COUNT(*) as count,
      SUM(Opportunity_AUM) as aum
    FROM \`${FULL_TABLE}\`
    ${whereClause}
    GROUP BY StageName
    ORDER BY aum DESC
  `;
  
  const results = await runQuery<{ 
    stage: string | null; 
    count: number | null; 
    aum: number | null 
  }>(query, params);
  
  let totalAum = 0;
  let recordCount = 0;
  
  const byStage = results.map(r => {
    const aum = toNumber(r.aum);
    const count = toNumber(r.count);
    totalAum += aum;
    recordCount += count;
    
    return {
      stage: toString(r.stage),
      count,
      aum,
    };
  });
  
  return { totalAum, recordCount, byStage };
};

export const getOpenPipelineSummary = cachedQuery(
  _getOpenPipelineSummary,
  'getOpenPipelineSummary',
  CACHE_TAGS.DASHBOARD
);
