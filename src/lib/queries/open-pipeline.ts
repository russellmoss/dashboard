import { runQuery, buildQueryParams } from '../bigquery';
import { DetailRecord, SgmConversionData } from '@/types/dashboard';
import { formatCurrency, calculateDaysInStage } from '../utils/date-helpers';
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
      v.Lead_Score_Tier__c as lead_score_tier,
      v.Opportunity_AUM as aum,
      v.salesforce_url,
      v.FilterDate as relevant_date,
      v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
      v.Qualification_Call_Date__c as qualification_call_date,
      v.is_contacted,
      v.is_mql,
      v.recordtypeid,
      v.Next_Steps__c as next_steps,
      v.NextStep as opportunity_next_step,
      v.TOF_Stage as tof_stage,
      v.Opp_CreatedDate as opp_created_date
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
      tofStage: toString(r.tof_stage) || 'Prospect',
      sga: r.sga ? toString(r.sga) : null,
      sgm: r.sgm ? toString(r.sgm) : null,
      campaignId: r.campaign_id ? toString(r.campaign_id) : null,
      campaignName: r.campaign_name ? toString(r.campaign_name) : null,
      leadScoreTier: r.lead_score_tier ? toString(r.lead_score_tier) : null,
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
      oppCreatedDate: extractDate(r.opp_created_date),
      daysInCurrentStage: null,
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
      nextSteps: r.next_steps ? toString(r.next_steps) : null,
      opportunityNextStep: r.opportunity_next_step ? toString(r.opportunity_next_step) : null,
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
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string; sgms?: string[]; dateRange?: { startDate: string; endDate: string } | null }
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

  // Date filter on converted_date_raw (SQL creation date)
  if (filters?.dateRange?.startDate && filters?.dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = filters.dateRange.startDate;
    params.endDate = filters.dateRange.endDate;
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
      v.Lead_Score_Tier__c as lead_score_tier,
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
      v.recordtypeid,
      v.Next_Steps__c as next_steps,
      v.NextStep as opportunity_next_step,
      v.TOF_Stage as tof_stage,
      v.Opp_CreatedDate as opp_created_date,
      v.Stage_Entered_Discovery__c as discovery_date,
      v.Stage_Entered_Sales_Process__c as sales_process_date,
      v.Stage_Entered_Negotiating__c as negotiating_date,
      v.Stage_Entered_Signed__c as signed_date,
      v.Stage_Entered_On_Hold__c as on_hold_date,
      v.Stage_Entered_Closed__c as closed_date
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
    const oppCreatedDate = extractDate(r.opp_created_date);
    const discoveryDate = extractDate(r.discovery_date);
    const salesProcessDate = extractDate(r.sales_process_date);
    const negotiatingDate = extractDate(r.negotiating_date);
    const signedDate = extractDate(r.signed_date);
    const onHoldDate = extractDate(r.on_hold_date);
    const closedDate = extractDate(r.closed_date);

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

    const stageForCalc = toString(r.stage) || 'Unknown';
    const tofStageForCalc = toString(r.tof_stage) || 'Prospect';
    const daysInCurrentStage = calculateDaysInStage({
      stage: stageForCalc,
      tofStage: tofStageForCalc,
      oppCreatedDate,
      discoveryDate,
      salesProcessDate,
      negotiatingDate,
      signedDate,
      onHoldDate,
      closedDate,
      joinedDate,
      contactedDate,
      mqlDate,
      sqlDate,
      sqoDate,
    });

    return {
      id: toString(r.id),
      advisorName: toString(r.advisor_name) || 'Unknown',
      source: toString(r.source) || 'Unknown',
      channel: toString(r.channel) || 'Unknown',
      stage: stageForCalc,
      tofStage: tofStageForCalc,
      sga: r.sga ? toString(r.sga) : null,
      sgm: r.sgm ? toString(r.sgm) : null,
      campaignId: r.campaign_id ? toString(r.campaign_id) : null,
      campaignName: r.campaign_name ? toString(r.campaign_name) : null,
      leadScoreTier: r.lead_score_tier ? toString(r.lead_score_tier) : null,
      aum: toNumber(r.aum),
      aumFormatted: formatCurrency(r.aum),
      salesforceUrl: toString(r.salesforce_url) || '',
      relevantDate: filterDate,
      contactedDate,
      mqlDate,
      sqlDate,
      sqoDate,
      joinedDate,
      signedDate,
      discoveryDate,
      salesProcessDate,
      negotiatingDate,
      onHoldDate,
      closedDate,
      oppCreatedDate,
      daysInCurrentStage,
      initialCallScheduledDate: initialCallDate,
      qualificationCallDate: qualCallDate,
      isContacted: r.is_contacted === 1,
      isMql: r.is_mql === 1,
      isSql: true,
      isSqo: true,
      isJoined: false,
      isOpenPipeline: OPEN_PIPELINE_STAGES.includes(stageForCalc),
      recordTypeId: r.recordtypeid ? toString(r.recordtypeid) : null,
      isPrimaryOppRecord: (r.is_primary_opp_record ?? 0) === 1,
      opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
      nextSteps: r.next_steps ? toString(r.next_steps) : null,
      opportunityNextStep: r.opportunity_next_step ? toString(r.opportunity_next_step) : null,
    };
  });
};

export const getOpenPipelineRecordsByStage = cachedQuery(
  _getOpenPipelineRecordsByStage,
  'getOpenPipelineRecordsByStage',
  CACHE_TAGS.DASHBOARD
);

const _getOpenPipelineBySgm = async (
  filters?: { stages?: string[]; sgms?: string[]; dateRange?: { startDate: string; endDate: string } | null }
): Promise<{ sgm: string; stage: string; count: number; aum: number }[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');

  // Use custom stages if provided, otherwise default to OPEN_PIPELINE_STAGES
  const stagesToUse = filters?.stages && filters.stages.length > 0
    ? filters.stages
    : [...OPEN_PIPELINE_STAGES];

  const stageParams = stagesToUse.map((_, i) => `@stage${i}`);
  conditions.push(`v.StageName IN (${stageParams.join(', ')})`);
  stagesToUse.forEach((stage, i) => {
    params[`stage${i}`] = stage;
  });

  // Add SGM filter if provided
  if (filters?.sgms && filters.sgms.length > 0) {
    const sgmParams = filters.sgms.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgm${i}`] = sgm;
    });
  }

  // Date filter on converted_date_raw (SQL creation date)
  if (filters?.dateRange?.startDate && filters?.dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = filters.dateRange.startDate;
    params.endDate = filters.dateRange.endDate;
  }

  conditions.push('v.is_sqo_unique = 1');
  conditions.push('v.SGM_Owner_Name__c IS NOT NULL');

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}` : '';

  // Restrict to bonafide active SGMs only (exclude SGAs): join User with Is_SGM__c = TRUE and IsActive = TRUE
  const query = `
    SELECT
      v.SGM_Owner_Name__c as sgm,
      v.StageName as stage,
      COUNT(DISTINCT v.Full_Opportunity_ID__c) as count,
      SUM(CASE WHEN v.is_primary_opp_record = 1 THEN COALESCE(v.Opportunity_AUM, 0) ELSE 0 END) as aum
    FROM \`${FULL_TABLE}\` v
    INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
      ON v.SGM_Owner_Name__c = u.Name
      AND u.Is_SGM__c = TRUE
      AND u.IsActive = TRUE
    ${whereClause}
    GROUP BY v.SGM_Owner_Name__c, v.StageName
  `;

  const results = await runQuery<{
    sgm: string | null;
    stage: string | null;
    count: number | null;
    aum: number | null;
  }>(query, params);

  return results.map(r => ({
    sgm: toString(r.sgm),
    stage: toString(r.stage),
    count: toNumber(r.count),
    aum: toNumber(r.aum),
  }));
};

export const getOpenPipelineBySgm = cachedQuery(
  _getOpenPipelineBySgm,
  'getOpenPipelineBySgm',
  CACHE_TAGS.DASHBOARD
);

const _getOpenPipelineRecordsBySgm = async (
  sgm: string,
  stages?: string[],
  sgms?: string[],
  dateRange?: { startDate: string; endDate: string } | null
): Promise<DetailRecord[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    targetSgm: sgm,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');
  conditions.push('v.SGM_Owner_Name__c = @targetSgm');

  // Use custom stages if provided, otherwise default to OPEN_PIPELINE_STAGES
  const stagesToUse = stages && stages.length > 0 ? stages : [...OPEN_PIPELINE_STAGES];
  const stageParams = stagesToUse.map((_, i) => `@stage${i}`);
  conditions.push(`v.StageName IN (${stageParams.join(', ')})`);
  stagesToUse.forEach((stage, i) => {
    params[`stage${i}`] = stage;
  });

  conditions.push('v.is_sqo_unique = 1');

  // Handle SGM multi-select filter (for consistency with page filters)
  // Note: This is in addition to the targetSgm filter - it ensures the targetSgm
  // is within the allowed SGM list if one is provided
  if (sgms && sgms.length > 0) {
    const sgmParams = sgms.map((_, i) => `@sgmFilter${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    sgms.forEach((s, i) => {
      params[`sgmFilter${i}`] = s;
    });
  }

  // Date filter on converted_date_raw (SQL creation date)
  if (dateRange?.startDate && dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = dateRange.startDate;
    params.endDate = dateRange.endDate;
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // EXACT same SELECT columns as _getOpenPipelineRecordsByStage
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
      v.Lead_Score_Tier__c as lead_score_tier,
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
      v.recordtypeid,
      v.is_primary_opp_record,
      v.Next_Steps__c as next_steps,
      v.NextStep as opportunity_next_step,
      v.TOF_Stage as tof_stage,
      v.Opp_CreatedDate as opp_created_date,
      v.Stage_Entered_Discovery__c as discovery_date,
      v.Stage_Entered_Sales_Process__c as sales_process_date,
      v.Stage_Entered_Negotiating__c as negotiating_date,
      v.Stage_Entered_Signed__c as signed_date,
      v.Stage_Entered_On_Hold__c as on_hold_date,
      v.Stage_Entered_Closed__c as closed_date
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    ORDER BY v.Opportunity_AUM DESC NULLS LAST
    LIMIT 1000
  `;

  const results = await runQuery<RawDetailRecordResult>(query, params);

  // EXACT same result mapping as _getOpenPipelineRecordsByStage
  return results.map(r => {
    const extractDate = (field: any): string | null => {
      if (!field) return null;
      if (typeof field === 'string') return field;
      if (typeof field === 'object' && field.value) return field.value;
      return null;
    };

    const filterDate = extractDate(r.filter_date) || '';
    const contactedDate = extractDate(r.contacted_date);
    const mqlDate = extractDate(r.mql_date);
    const sqlDate = extractDate(r.sql_date);
    const sqoDate = extractDate(r.sqo_date);
    const joinedDate = extractDate(r.joined_date);
    const oppCreatedDate = extractDate(r.opp_created_date);
    const discoveryDate = extractDate(r.discovery_date);
    const salesProcessDate = extractDate(r.sales_process_date);
    const negotiatingDate = extractDate(r.negotiating_date);
    const signedDate = extractDate(r.signed_date);
    const onHoldDate = extractDate(r.on_hold_date);
    const closedDate = extractDate(r.closed_date);

    let initialCallDate: string | null = null;
    if (r.initial_call_scheduled_date) {
      if (typeof r.initial_call_scheduled_date === 'string') {
        initialCallDate = r.initial_call_scheduled_date;
      } else if (typeof r.initial_call_scheduled_date === 'object' && r.initial_call_scheduled_date.value) {
        initialCallDate = r.initial_call_scheduled_date.value;
      }
    }

    let qualCallDate: string | null = null;
    if (r.qualification_call_date) {
      if (typeof r.qualification_call_date === 'string') {
        qualCallDate = r.qualification_call_date;
      } else if (typeof r.qualification_call_date === 'object' && r.qualification_call_date.value) {
        qualCallDate = r.qualification_call_date.value;
      }
    }

    const stageForCalc = toString(r.stage) || 'Unknown';
    const tofStageForCalc = toString(r.tof_stage) || 'Prospect';
    const daysInCurrentStage = calculateDaysInStage({
      stage: stageForCalc,
      tofStage: tofStageForCalc,
      oppCreatedDate,
      discoveryDate,
      salesProcessDate,
      negotiatingDate,
      signedDate,
      onHoldDate,
      closedDate,
      joinedDate,
      contactedDate,
      mqlDate,
      sqlDate,
      sqoDate,
    });

    return {
      id: toString(r.id),
      advisorName: toString(r.advisor_name) || 'Unknown',
      source: toString(r.source) || 'Unknown',
      channel: toString(r.channel) || 'Unknown',
      stage: stageForCalc,
      tofStage: tofStageForCalc,
      sga: r.sga ? toString(r.sga) : null,
      sgm: r.sgm ? toString(r.sgm) : null,
      campaignId: r.campaign_id ? toString(r.campaign_id) : null,
      campaignName: r.campaign_name ? toString(r.campaign_name) : null,
      leadScoreTier: r.lead_score_tier ? toString(r.lead_score_tier) : null,
      aum: toNumber(r.aum),
      aumFormatted: formatCurrency(r.aum),
      salesforceUrl: toString(r.salesforce_url) || '',
      relevantDate: filterDate,
      contactedDate,
      mqlDate,
      sqlDate,
      sqoDate,
      joinedDate,
      signedDate,
      discoveryDate,
      salesProcessDate,
      negotiatingDate,
      onHoldDate,
      closedDate,
      oppCreatedDate,
      daysInCurrentStage,
      initialCallScheduledDate: initialCallDate,
      qualificationCallDate: qualCallDate,
      isContacted: r.is_contacted === 1,
      isMql: r.is_mql === 1,
      isSql: true,
      isSqo: true,
      isJoined: false,
      isOpenPipeline: OPEN_PIPELINE_STAGES.includes(stageForCalc),
      recordTypeId: r.recordtypeid ? toString(r.recordtypeid) : null,
      isPrimaryOppRecord: (r.is_primary_opp_record ?? 0) === 1,
      opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
      nextSteps: r.next_steps ? toString(r.next_steps) : null,
      opportunityNextStep: r.opportunity_next_step ? toString(r.opportunity_next_step) : null,
    };
  });
};

export const getOpenPipelineRecordsBySgm = cachedQuery(
  _getOpenPipelineRecordsBySgm,
  'getOpenPipelineRecordsBySgm',
  CACHE_TAGS.DASHBOARD
);

interface SgmConversionFilters {
  sgms?: string[];
  dateRange?: { startDate: string; endDate: string } | null;
}

const _getSgmConversionData = async (
  filters?: SgmConversionFilters
): Promise<SgmConversionData[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');
  conditions.push('v.SGM_Owner_Name__c IS NOT NULL');

  // Date filter on converted_date_raw (SQL date)
  if (filters?.dateRange?.startDate && filters?.dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = filters.dateRange.startDate;
    params.endDate = filters.dateRange.endDate;
  }

  // SGM filter
  if (filters?.sgms && filters.sgms.length > 0) {
    const sgmParams = filters.sgms.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgm${i}`] = sgm;
    });
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // Restrict to bonafide active SGMs only (exclude SGAs): join User with Is_SGM__c = TRUE and IsActive = TRUE
  const query = `
    SELECT
      v.SGM_Owner_Name__c as sgm,
      COUNT(CASE WHEN v.is_sql = 1 AND v.is_primary_opp_record = 1 THEN 1 END) as sqls_received,
      SUM(v.sql_to_sqo_progression) as sql_to_sqo_numer,
      SUM(v.eligible_for_sql_conversions) as sql_to_sqo_denom,
      SUM(v.is_sqo_unique) as sqos_count,
      SUM(v.sqo_to_joined_progression) as sqo_to_joined_numer,
      SUM(v.eligible_for_sqo_conversions) as sqo_to_joined_denom,
      SUM(v.is_joined_unique) as joined_count
    FROM \`${FULL_TABLE}\` v
    INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
      ON v.SGM_Owner_Name__c = u.Name
      AND u.Is_SGM__c = TRUE
      AND u.IsActive = TRUE
    ${whereClause}
    GROUP BY v.SGM_Owner_Name__c
    ORDER BY sqls_received DESC
  `;

  const results = await runQuery<{
    sgm: string | null;
    sqls_received: number | null;
    sql_to_sqo_numer: number | null;
    sql_to_sqo_denom: number | null;
    sqos_count: number | null;
    sqo_to_joined_numer: number | null;
    sqo_to_joined_denom: number | null;
    joined_count: number | null;
  }>(query, params);

  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;

  return results.map(r => ({
    sgm: toString(r.sgm),
    sqlsReceived: toNumber(r.sqls_received),
    sqlToSqoNumer: toNumber(r.sql_to_sqo_numer),
    sqlToSqoDenom: toNumber(r.sql_to_sqo_denom),
    sqlToSqoRate: safeDiv(toNumber(r.sql_to_sqo_numer), toNumber(r.sql_to_sqo_denom)),
    sqosCount: toNumber(r.sqos_count),
    sqoToJoinedNumer: toNumber(r.sqo_to_joined_numer),
    sqoToJoinedDenom: toNumber(r.sqo_to_joined_denom),
    sqoToJoinedRate: safeDiv(toNumber(r.sqo_to_joined_numer), toNumber(r.sqo_to_joined_denom)),
    joinedCount: toNumber(r.joined_count),
  }));
};

export const getSgmConversionData = cachedQuery(
  _getSgmConversionData,
  'getSgmConversionData',
  CACHE_TAGS.DASHBOARD
);

/** Metric type for SGM conversion table drill-down (SQLs, SQO'd, Joined) */
export type SgmConversionDrilldownMetric = 'sql' | 'sqo' | 'joined';

interface SgmConversionDrilldownFilters {
  sgms?: string[];
  dateRange?: { startDate: string; endDate: string } | null;
}

const _getSgmConversionDrilldownRecords = async (
  sgm: string,
  metric: SgmConversionDrilldownMetric,
  filters?: SgmConversionDrilldownFilters
): Promise<DetailRecord[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    targetSgm: sgm,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');
  conditions.push('v.SGM_Owner_Name__c = @targetSgm');

  // Restrict to bonafide active SGMs only
  conditions.push('u.Is_SGM__c = TRUE');
  conditions.push('u.IsActive = TRUE');

  switch (metric) {
    case 'sql':
      conditions.push('v.is_sql = 1');
      conditions.push('v.is_primary_opp_record = 1');
      break;
    case 'sqo':
      conditions.push('v.is_sqo_unique = 1');
      break;
    case 'joined':
      conditions.push('v.is_joined_unique = 1');
      break;
  }

  // Date filter on converted_date_raw (SQL date) — scopes to same period as conversion table
  if (filters?.dateRange?.startDate && filters?.dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = filters.dateRange.startDate;
    params.endDate = filters.dateRange.endDate;
  }

  if (filters?.sgms && filters.sgms.length > 0) {
    const sgmParams = filters.sgms.map((_, i) => `@sgmFilter${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((s, i) => {
      params[`sgmFilter${i}`] = s;
    });
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

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
      v.Lead_Score_Tier__c as lead_score_tier,
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
      v.recordtypeid,
      v.is_primary_opp_record,
      v.Next_Steps__c as next_steps,
      v.NextStep as opportunity_next_step,
      v.TOF_Stage as tof_stage,
      v.Opp_CreatedDate as opp_created_date,
      v.Stage_Entered_Discovery__c as discovery_date,
      v.Stage_Entered_Sales_Process__c as sales_process_date,
      v.Stage_Entered_Negotiating__c as negotiating_date,
      v.Stage_Entered_Signed__c as signed_date,
      v.Stage_Entered_On_Hold__c as on_hold_date,
      v.Stage_Entered_Closed__c as closed_date
    FROM \`${FULL_TABLE}\` v
    INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
      ON v.SGM_Owner_Name__c = u.Name
      AND u.Is_SGM__c = TRUE
      AND u.IsActive = TRUE
    ${whereClause}
    ORDER BY v.Opportunity_AUM DESC NULLS LAST
    LIMIT 1000
  `;

  const results = await runQuery<RawDetailRecordResult>(query, params);

  return results.map(r => {
    const extractDate = (field: any): string | null => {
      if (!field) return null;
      if (typeof field === 'string') return field;
      if (typeof field === 'object' && field.value) return field.value;
      return null;
    };

    const filterDate = extractDate(r.filter_date) || '';
    const contactedDate = extractDate(r.contacted_date);
    const mqlDate = extractDate(r.mql_date);
    const sqlDate = extractDate(r.sql_date);
    const sqoDate = extractDate(r.sqo_date);
    const joinedDate = extractDate(r.joined_date);
    const oppCreatedDate = extractDate(r.opp_created_date);
    const discoveryDate = extractDate(r.discovery_date);
    const salesProcessDate = extractDate(r.sales_process_date);
    const negotiatingDate = extractDate(r.negotiating_date);
    const signedDate = extractDate(r.signed_date);
    const onHoldDate = extractDate(r.on_hold_date);
    const closedDate = extractDate(r.closed_date);

    let initialCallDate: string | null = null;
    if (r.initial_call_scheduled_date) {
      if (typeof r.initial_call_scheduled_date === 'string') {
        initialCallDate = r.initial_call_scheduled_date;
      } else if (typeof r.initial_call_scheduled_date === 'object' && r.initial_call_scheduled_date.value) {
        initialCallDate = r.initial_call_scheduled_date.value;
      }
    }

    let qualCallDate: string | null = null;
    if (r.qualification_call_date) {
      if (typeof r.qualification_call_date === 'string') {
        qualCallDate = r.qualification_call_date;
      } else if (typeof r.qualification_call_date === 'object' && r.qualification_call_date.value) {
        qualCallDate = r.qualification_call_date.value;
      }
    }

    const stage = toString(r.stage);
    const tofStageForCalc = toString(r.tof_stage) || 'Prospect';
    const daysInCurrentStage = calculateDaysInStage({
      stage: stage || 'Unknown',
      tofStage: tofStageForCalc,
      oppCreatedDate,
      discoveryDate,
      salesProcessDate,
      negotiatingDate,
      signedDate,
      onHoldDate,
      closedDate,
      joinedDate,
      contactedDate,
      mqlDate,
      sqlDate,
      sqoDate,
    });

    return {
      id: toString(r.id),
      advisorName: toString(r.advisor_name) || 'Unknown',
      source: toString(r.source) || 'Unknown',
      channel: toString(r.channel) || 'Unknown',
      stage,
      tofStage: tofStageForCalc,
      sga: r.sga ? toString(r.sga) : null,
      sgm: r.sgm ? toString(r.sgm) : null,
      campaignId: r.campaign_id ? toString(r.campaign_id) : null,
      campaignName: r.campaign_name ? toString(r.campaign_name) : null,
      leadScoreTier: r.lead_score_tier ? toString(r.lead_score_tier) : null,
      aum: toNumber(r.aum),
      aumFormatted: formatCurrency(r.aum),
      salesforceUrl: toString(r.salesforce_url) || '',
      relevantDate: filterDate,
      contactedDate,
      mqlDate,
      sqlDate,
      sqoDate,
      joinedDate,
      signedDate,
      discoveryDate,
      salesProcessDate,
      negotiatingDate,
      onHoldDate,
      closedDate,
      oppCreatedDate,
      daysInCurrentStage,
      initialCallScheduledDate: initialCallDate,
      qualificationCallDate: qualCallDate,
      isContacted: r.is_contacted === 1,
      isMql: r.is_mql === 1,
      isSql: true,
      isSqo: metric === 'sqo' || metric === 'joined',
      isJoined: metric === 'joined',
      isOpenPipeline: OPEN_PIPELINE_STAGES.includes(stage),
      recordTypeId: r.recordtypeid ? toString(r.recordtypeid) : null,
      isPrimaryOppRecord: (r.is_primary_opp_record ?? 0) === 1,
      opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
      nextSteps: r.next_steps ? toString(r.next_steps) : null,
      opportunityNextStep: r.opportunity_next_step ? toString(r.opportunity_next_step) : null,
    };
  });
};

export const getSgmConversionDrilldownRecords = cachedQuery(
  _getSgmConversionDrilldownRecords,
  'getSgmConversionDrilldownRecords',
  CACHE_TAGS.DASHBOARD
);
