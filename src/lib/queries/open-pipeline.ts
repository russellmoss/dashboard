import { runQuery, buildQueryParams } from '../bigquery';
import { DetailRecord } from '@/types/dashboard';
import { formatCurrency } from '../utils/date-helpers';
import { RawDetailRecordResult, RawOpenPipelineResult, toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE } from '@/config/constants';
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
    // Channel_Grouping_Name now comes directly from Finance_View__c in the view
    conditions.push('v.Channel_Grouping_Name = @channel');
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
      IFNULL(v.Channel_Grouping_Name, 'Other') as channel,
      v.StageName as stage,
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      v.Campaign_Id__c as campaign_id,
      v.Campaign_Name__c as campaign_name,
      v.Opportunity_AUM as aum,
      v.salesforce_url,
      v.FilterDate as relevant_date,
      v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
      v.Qualification_Call_Date__c as qualification_call_date,
      v.is_contacted,
      v.is_mql,
      v.recordtypeid
    FROM \`${FULL_TABLE}\` v
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
      campaignId: r.campaign_id ? toString(r.campaign_id) : null,
      campaignName: r.campaign_name ? toString(r.campaign_name) : null,
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

const _getOpenPipelineSummary = async (
  filters?: { stages?: string[]; sgms?: string[] }
): Promise<{
  totalAum: number;
  recordCount: number;
  byStage: { stage: string; count: number; aum: number }[];
}> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  conditions.push(`v.recordtypeid = @recruitingRecordType`);
  
  // Use custom stages if provided, otherwise default to OPEN_PIPELINE_STAGES
  const stagesToUse = filters?.stages && filters.stages.length > 0 
    ? filters.stages 
    : [...OPEN_PIPELINE_STAGES];
  
  const stageParams = stagesToUse.map((_, i) => `@stage${i}`);
  conditions.push(`v.StageName IN (${stageParams.join(', ')})`);
  stagesToUse.forEach((stage, i) => {
    params[`stage${i}`] = stage;
  });
  
  // Add SGM filter if provided (and not empty)
  if (filters?.sgms && filters.sgms.length > 0) {
    const sgmParams = filters.sgms.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgm${i}`] = sgm;
    });
  }
  
  conditions.push('v.is_sqo_unique = 1');
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      v.StageName as stage,
      COUNT(DISTINCT v.Full_Opportunity_ID__c) as count,
      SUM(CASE WHEN v.is_primary_opp_record = 1 THEN COALESCE(v.Opportunity_AUM, 0) ELSE 0 END) as aum
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    GROUP BY v.StageName
    ORDER BY 
      CASE v.StageName
        WHEN 'Qualifying' THEN 1
        WHEN 'Discovery' THEN 2
        WHEN 'Sales Process' THEN 3
        WHEN 'Negotiating' THEN 4
        WHEN 'Signed' THEN 5
        WHEN 'On Hold' THEN 6
        WHEN 'Planned Nurture' THEN 7
        ELSE 8
      END
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

/**
 * Get open pipeline records filtered by specific stage
 * Used for drill-down when clicking a bar in the chart
 */
const _getOpenPipelineRecordsByStage = async (
  stage: string,
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string; sgms?: string[] }
): Promise<DetailRecord[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    targetStage: stage,
  };
  
  if (filters?.channel) {
    conditions.push('v.Channel_Grouping_Name = @channel');
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
  
  // Handle array of SGMs (from multi-select filter)
  if (filters?.sgms && filters.sgms.length > 0 && !filters?.sgm) {
    const sgmParams = filters.sgms.map((_, i) => `@sgmFilter${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgmFilter${i}`] = sgm;
    });
  }
  
  conditions.push(`v.recordtypeid = @recruitingRecordType`);
  conditions.push(`v.StageName = @targetStage`);
  conditions.push('v.is_sqo_unique = 1');
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      v.primary_key as id,
      v.Full_Opportunity_ID__c as opportunity_id,
      v.advisor_name,
      v.Original_source as source,
      IFNULL(v.Channel_Grouping_Name, 'Other') as channel,
      v.StageName as stage,
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      v.Campaign_Id__c as campaign_id,
      v.Campaign_Name__c as campaign_name,
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
      v.is_contacted,
      v.is_mql,
      v.recordtypeid
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    ORDER BY v.Opportunity_AUM DESC NULLS LAST
    LIMIT 1000
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
      campaignId: r.campaign_id ? toString(r.campaign_id) : null,
      campaignName: r.campaign_name ? toString(r.campaign_name) : null,
      aum: toNumber(r.aum),
      aumFormatted: formatCurrency(r.aum),
      salesforceUrl: toString(r.salesforce_url) || '',
      relevantDate: filterDate,
      contactedDate,
      mqlDate,
      sqlDate,
      sqoDate,
      joinedDate,
      signedDate: null,
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
      isPrimaryOppRecord: (r.is_primary_opp_record ?? 0) === 1,
      opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
    };
  });
};

export const getOpenPipelineRecordsByStage = cachedQuery(
  _getOpenPipelineRecordsByStage,
  'getOpenPipelineRecordsByStage',
  CACHE_TAGS.DASHBOARD
);
