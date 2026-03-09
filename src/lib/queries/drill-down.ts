// src/lib/queries/drill-down.ts

import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE, MAPPING_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import {
  InitialCallRecord,
  QualificationCallRecord,
  SQODrillDownRecord,
  OpenSQLDrillDownRecord,
  MQLDrillDownRecord,
  SQLDrillDownRecord,
  LeadsSourcedRecord,
  LeadsContactedRecord,
  RawInitialCallRecord,
  RawQualificationCallRecord,
  RawSQODrillDownRecord,
  RawOpenSQLDrillDownRecord,
  RawMQLDrillDownRecord,
  RawSQLDrillDownRecord,
  RawLeadsSourcedRecord,
  RawLeadsContactedRecord,
} from '@/types/drill-down';
import { formatCurrency, calculateDaysInStage } from '@/lib/utils/date-helpers';
import { toString, toNumber } from '@/types/bigquery-raw';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

/**
 * Extract date value from BigQuery DATE/TIMESTAMP field
 * Handles both string format and { value: string } object format
 * 
 * Reference: Same pattern as extractDateValue in src/lib/queries/record-detail.ts
 */
function extractDateValue(
  field: { value: string } | string | null | undefined
): string | null {
  if (!field) return null;
  
  // Handle object format: { value: "2025-01-15T10:30:00Z" }
  if (typeof field === 'object' && field !== null && 'value' in field) {
    return typeof field.value === 'string' ? field.value : null;
  }
  
  // Handle string format: "2025-01-15" or "2025-01-15T10:30:00Z"
  if (typeof field === 'string') {
    return field;
  }
  
  // Fallback for unexpected formats
  return null;
}

/**
 * Transform raw Initial Call record to typed interface
 */
function transformInitialCallRecord(raw: RawInitialCallRecord): InitialCallRecord {
  const dateValue = extractDateValue(raw.Initial_Call_Scheduled_Date__c);
  return {
    primaryKey: toString(raw.primary_key),
    advisorName: toString(raw.advisor_name) || 'Unknown',
    initialCallDate: dateValue ? dateValue.split('T')[0] : '', // Extract YYYY-MM-DD part
    source: toString(raw.Original_source) || 'Unknown',
    channel: toString(raw.Channel_Grouping_Name) || 'Other',
    leadScoreTier: raw.Lead_Score_Tier__c ? toString(raw.Lead_Score_Tier__c) : null,
    tofStage: toString(raw.TOF_Stage) || 'Unknown',
    leadUrl: raw.lead_url ? toString(raw.lead_url) : null,
    opportunityUrl: raw.opportunity_url ? toString(raw.opportunity_url) : null,
    nextSteps: raw.Next_Steps__c ? toString(raw.Next_Steps__c) : null,
    opportunityNextStep: raw.NextStep ? toString(raw.NextStep) : null,
    daysInCurrentStage: calculateDaysInStage({
      stage: 'Unknown', // Initial call records are lead-level — no StageName
      tofStage: toString(raw.TOF_Stage) || 'Unknown',
      contactedDate: extractDateValue(raw.stage_entered_contacting__c),
      mqlDate: extractDateValue(raw.mql_stage_entered_ts),
    }),
  };
}

/**
 * Transform raw Qualification Call record to typed interface
 */
function transformQualificationCallRecord(raw: RawQualificationCallRecord): QualificationCallRecord {
  const aum = toNumber(raw.Opportunity_AUM);
  const dateValue = extractDateValue(raw.Qualification_Call_Date__c);
  return {
    primaryKey: toString(raw.primary_key),
    advisorName: toString(raw.advisor_name) || 'Unknown',
    qualificationCallDate: dateValue ? dateValue.split('T')[0] : '', // Extract YYYY-MM-DD part
    source: toString(raw.Original_source) || 'Unknown',
    channel: toString(raw.Channel_Grouping_Name) || 'Other',
    leadScoreTier: raw.Lead_Score_Tier__c ? toString(raw.Lead_Score_Tier__c) : null,
    tofStage: toString(raw.TOF_Stage) || 'Unknown',
    aum: aum,
    aumFormatted: aum ? formatCurrency(aum) : '-',
    aumTier: raw.aum_tier ? toString(raw.aum_tier) : null,
    leadUrl: raw.lead_url ? toString(raw.lead_url) : null,
    opportunityUrl: raw.opportunity_url ? toString(raw.opportunity_url) : null,
    nextSteps: raw.Next_Steps__c ? toString(raw.Next_Steps__c) : null,
    opportunityNextStep: raw.NextStep ? toString(raw.NextStep) : null,
    daysInCurrentStage: calculateDaysInStage({
      stage: raw.StageName ? toString(raw.StageName) : 'Unknown',
      tofStage: toString(raw.TOF_Stage) || 'Unknown',
      mqlDate: extractDateValue(raw.mql_stage_entered_ts),
      sqlDate: extractDateValue(raw.converted_date_raw),
      sqoDate: extractDateValue(raw.Date_Became_SQO__c),
      oppCreatedDate: extractDateValue(raw.Opp_CreatedDate),
      discoveryDate: extractDateValue(raw.Stage_Entered_Discovery__c),
      salesProcessDate: extractDateValue(raw.Stage_Entered_Sales_Process__c),
      negotiatingDate: extractDateValue(raw.Stage_Entered_Negotiating__c),
    }),
  };
}

/**
 * Transform raw SQO record to typed interface
 */
function transformSQODrillDownRecord(raw: RawSQODrillDownRecord): SQODrillDownRecord {
  const aum = toNumber(raw.Opportunity_AUM);
  const underwrittenAum = toNumber(raw.Underwritten_AUM__c);
  const dateValue = extractDateValue(raw.Date_Became_SQO__c);
  return {
    primaryKey: toString(raw.primary_key),
    advisorName: toString(raw.advisor_name) || 'Unknown',
    sqoDate: dateValue ? dateValue.split('T')[0] : '', // Extract YYYY-MM-DD part
    source: toString(raw.Original_source) || 'Unknown',
    channel: toString(raw.channel) || 'Other',
    sgaName: raw.sga_name ? toString(raw.sga_name) : null,
    aum: aum,
    aumFormatted: aum ? formatCurrency(aum) : '-',
    underwrittenAum: underwrittenAum,
    underwrittenAumFormatted: underwrittenAum ? formatCurrency(underwrittenAum) : '-',
    aumTier: raw.aum_tier ? toString(raw.aum_tier) : null,
    tofStage: toString(raw.TOF_Stage) || 'Unknown',
    stageName: raw.StageName ? toString(raw.StageName) : null,
    leadUrl: raw.lead_url ? toString(raw.lead_url) : null,
    opportunityUrl: raw.opportunity_url ? toString(raw.opportunity_url) : null,
    nextSteps: raw.Next_Steps__c ? toString(raw.Next_Steps__c) : null,
    opportunityNextStep: raw.NextStep ? toString(raw.NextStep) : null,
    daysInCurrentStage: calculateDaysInStage({
      stage: raw.StageName ? toString(raw.StageName) : 'Unknown',
      tofStage: toString(raw.TOF_Stage) || 'Unknown',
      sqoDate: extractDateValue(raw.Date_Became_SQO__c),
      oppCreatedDate: extractDateValue(raw.Opp_CreatedDate),
      discoveryDate: extractDateValue(raw.Stage_Entered_Discovery__c),
      salesProcessDate: extractDateValue(raw.Stage_Entered_Sales_Process__c),
      negotiatingDate: extractDateValue(raw.Stage_Entered_Negotiating__c),
      signedDate: extractDateValue(raw.Stage_Entered_Signed__c),
      onHoldDate: extractDateValue(raw.Stage_Entered_On_Hold__c),
      closedDate: extractDateValue(raw.Stage_Entered_Closed__c),
    }),
  };
}

/**
 * Get Initial Calls drill-down records for a specific SGA and week
 */
const _getInitialCallsDrillDown = async (
  sgaName: string | null,
  weekStartDate: string,
  weekEndDate: string
): Promise<InitialCallRecord[]> => {
  const sgaFilter = sgaName !== null ? 'AND v.SGA_Owner_Name__c = @sgaName' : '';
  const query = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.Initial_Call_Scheduled_Date__c,
      v.Original_source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as Channel_Grouping_Name,
      v.Lead_Score_Tier__c,
      v.TOF_Stage,
      v.lead_url,
      v.opportunity_url,
      v.Next_Steps__c,
      v.NextStep,
      v.stage_entered_contacting__c,
      v.mql_stage_entered_ts
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    WHERE v.Initial_Call_Scheduled_Date__c IS NOT NULL
      AND v.Initial_Call_Scheduled_Date__c >= @weekStartDate
      AND v.Initial_Call_Scheduled_Date__c <= @weekEndDate
      ${sgaFilter}
    ORDER BY v.Initial_Call_Scheduled_Date__c DESC
  `;

  const params: Record<string, any> = { weekStartDate, weekEndDate };
  if (sgaName !== null) params.sgaName = sgaName;

  const results = await runQuery<RawInitialCallRecord>(query, params);
  return results.map(transformInitialCallRecord);
};

export const getInitialCallsDrillDown = cachedQuery(
  _getInitialCallsDrillDown,
  'getInitialCallsDrillDown',
  CACHE_TAGS.DASHBOARD
);

/**
 * Get Qualification Calls drill-down records for a specific SGA and week
 */
const _getQualificationCallsDrillDown = async (
  sgaName: string | null,
  weekStartDate: string,
  weekEndDate: string
): Promise<QualificationCallRecord[]> => {
  const sgaFilter = sgaName !== null ? 'AND v.SGA_Owner_Name__c = @sgaName' : '';
  const query = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.Qualification_Call_Date__c,
      v.Original_source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as Channel_Grouping_Name,
      v.Lead_Score_Tier__c,
      v.TOF_Stage,
      v.Opportunity_AUM,
      v.aum_tier,
      v.lead_url,
      v.opportunity_url,
      v.Next_Steps__c,
      v.NextStep,
      v.StageName,
      v.mql_stage_entered_ts,
      v.converted_date_raw,
      v.Date_Became_SQO__c,
      v.Opp_CreatedDate,
      v.Stage_Entered_Discovery__c,
      v.Stage_Entered_Sales_Process__c,
      v.Stage_Entered_Negotiating__c
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    WHERE v.Qualification_Call_Date__c IS NOT NULL
      AND v.Qualification_Call_Date__c >= @weekStartDate
      AND v.Qualification_Call_Date__c <= @weekEndDate
      ${sgaFilter}
    ORDER BY v.Qualification_Call_Date__c DESC
  `;

  const params: Record<string, any> = { weekStartDate, weekEndDate };
  if (sgaName !== null) params.sgaName = sgaName;

  const results = await runQuery<RawQualificationCallRecord>(query, params);
  return results.map(transformQualificationCallRecord);
};

export const getQualificationCallsDrillDown = cachedQuery(
  _getQualificationCallsDrillDown,
  'getQualificationCallsDrillDown',
  CACHE_TAGS.DASHBOARD
);

/**
 * Get SQO drill-down records for a specific SGA and date range
 * Can be used for both weekly and quarterly views
 * Supports optional channel and source filters for leaderboard drill-down
 * Supports team-level drill-down when sgaName is null (returns all SGAs)
 */
const _getSQODrillDown = async (
  sgaName: string | null,
  startDate: string,
  endDate: string,
  options?: {
    channels?: string[];
    sources?: string[];
  }
): Promise<SQODrillDownRecord[]> => {
  const { channels, sources } = options || {};
  
  // Build channel filter clause (optional)
  // For leaderboard drill-down, use Channel_Grouping_Name directly (no MAPPING_TABLE)
  // For other drill-downs, use MAPPING_TABLE join
  const useMappingTable = !channels || channels.length === 0;
  const channelFilter = channels && channels.length > 0
    ? 'AND v.Channel_Grouping_Name IN UNNEST(@channels)'
    : '';
  
  // Build source filter clause (optional)
  const sourceFilter = sources && sources.length > 0
    ? 'AND v.Original_source IN UNNEST(@sources)'
    : '';

  // Build SGA filter clause (optional - if sgaName is null, don't filter by SGA)
  const sgaFilter = sgaName !== null
    ? 'AND COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) = @sgaName'
    : '';

  const query = `
    SELECT 
      v.primary_key,
      v.advisor_name,
      v.Date_Became_SQO__c,
      v.Original_source,
      ${useMappingTable 
        ? 'COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') as channel'
        : 'v.Channel_Grouping_Name as channel'
      },
      COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) as sga_name,
      v.Opportunity_AUM,
      v.Underwritten_AUM__c,
      v.aum_tier,
      v.TOF_Stage,
      v.StageName,
      v.lead_url,
      v.opportunity_url,
      v.Next_Steps__c,
      v.NextStep,
      v.Opp_CreatedDate,
      v.Stage_Entered_Discovery__c,
      v.Stage_Entered_Sales_Process__c,
      v.Stage_Entered_Negotiating__c,
      v.Stage_Entered_Signed__c,
      v.Stage_Entered_On_Hold__c,
      v.Stage_Entered_Closed__c
    FROM \`${FULL_TABLE}\` v
    ${useMappingTable ? `LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source` : ''}
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
    WHERE v.is_sqo_unique = 1
      AND v.Date_Became_SQO__c IS NOT NULL
      AND v.recordtypeid = @recruitingRecordType
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      ${sgaFilter}
      ${channelFilter}
      ${sourceFilter}
    ORDER BY v.Date_Became_SQO__c DESC
  `;

  const params: Record<string, any> = {
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  // Only add sgaName to params if it's not null
  if (sgaName !== null) {
    params.sgaName = sgaName;
  }

  if (channels && channels.length > 0) {
    params.channels = channels;
  }
  if (sources && sources.length > 0) {
    params.sources = sources;
  }

  const results = await runQuery<RawSQODrillDownRecord>(query, params);
  return results.map(transformSQODrillDownRecord);
};

export const getSQODrillDown = cachedQuery(
  _getSQODrillDown,
  'getSQODrillDown',
  CACHE_TAGS.DASHBOARD
);

/**
 * Transform raw Open SQL record to typed interface
 */
function transformOpenSQLDrillDownRecord(raw: RawOpenSQLDrillDownRecord): OpenSQLDrillDownRecord {
  const aum = toNumber(raw.Opportunity_AUM);
  const dateValue = extractDateValue(raw.converted_date_raw);
  return {
    primaryKey: toString(raw.primary_key),
    advisorName: toString(raw.advisor_name) || 'Unknown',
    sqlDate: dateValue ? dateValue.split('T')[0] : '',
    source: toString(raw.Original_source) || 'Unknown',
    channel: toString(raw.Channel_Grouping_Name) || 'Other',
    sgaName: raw.SGA_Owner_Name__c ? toString(raw.SGA_Owner_Name__c) : null,
    aum: aum,
    aumFormatted: aum ? formatCurrency(aum) : '-',
    aumTier: raw.aum_tier ? toString(raw.aum_tier) : null,
    tofStage: toString(raw.TOF_Stage) || 'Unknown',
    stageName: raw.StageName ? toString(raw.StageName) : null,
    leadUrl: raw.lead_url ? toString(raw.lead_url) : null,
    opportunityUrl: raw.opportunity_url ? toString(raw.opportunity_url) : null,
    nextSteps: raw.Next_Steps__c ? toString(raw.Next_Steps__c) : null,
    opportunityNextStep: raw.NextStep ? toString(raw.NextStep) : null,
    daysInCurrentStage: calculateDaysInStage({
      stage: raw.StageName ? toString(raw.StageName) : 'Unknown',
      tofStage: toString(raw.TOF_Stage) || 'Unknown',
      sqoDate: null,
      oppCreatedDate: extractDateValue(raw.Opp_CreatedDate),
      discoveryDate: extractDateValue(raw.Stage_Entered_Discovery__c),
      salesProcessDate: extractDateValue(raw.Stage_Entered_Sales_Process__c),
      negotiatingDate: extractDateValue(raw.Stage_Entered_Negotiating__c),
    }),
  };
}

/**
 * Get Open SQL drill-down records for a specific SGA and date range
 */
const _getOpenSQLDrillDown = async (
  sgaName: string,
  startDate: string,
  endDate: string,
  options?: {
    channels?: string[];
    sources?: string[];
  }
): Promise<OpenSQLDrillDownRecord[]> => {
  const { channels, sources } = options || {};

  const channelFilter = channels && channels.length > 0
    ? 'AND v.Channel_Grouping_Name IN UNNEST(@channels)'
    : '';

  const sourceFilter = sources && sources.length > 0
    ? 'AND v.Original_source IN UNNEST(@sources)'
    : '';

  const query = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.converted_date_raw,
      v.Original_source,
      v.Channel_Grouping_Name,
      v.SGA_Owner_Name__c,
      v.Opportunity_AUM,
      v.aum_tier,
      v.TOF_Stage,
      v.StageName,
      v.lead_url,
      v.opportunity_url,
      v.Next_Steps__c,
      v.NextStep,
      v.Opp_CreatedDate,
      v.Stage_Entered_Discovery__c,
      v.Stage_Entered_Sales_Process__c,
      v.Stage_Entered_Negotiating__c
    FROM \`${FULL_TABLE}\` v
    WHERE v.is_sql = 1
      AND LOWER(COALESCE(v.SQO_raw, '')) != 'yes'
      AND (v.StageName IS NULL OR v.StageName != 'Closed Lost')
      AND v.recordtypeid = @recruitingRecordType
      AND v.converted_date_raw IS NOT NULL
      AND DATE(v.converted_date_raw) >= DATE(@startDate)
      AND DATE(v.converted_date_raw) <= DATE(@endDate)
      AND v.SGA_Owner_Name__c = @sgaName
      ${channelFilter}
      ${sourceFilter}
    ORDER BY v.converted_date_raw DESC
  `;

  const params: Record<string, any> = {
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    sgaName,
  };

  if (channels && channels.length > 0) {
    params.channels = channels;
  }
  if (sources && sources.length > 0) {
    params.sources = sources;
  }

  const results = await runQuery<RawOpenSQLDrillDownRecord>(query, params);
  return results.map(transformOpenSQLDrillDownRecord);
};

export const getOpenSQLDrillDown = cachedQuery(
  _getOpenSQLDrillDown,
  'getOpenSQLDrillDown',
  CACHE_TAGS.DASHBOARD
);

// ============================================================================
// MQL DRILL-DOWN
// ============================================================================

function transformMQLDrillDownRecord(raw: RawMQLDrillDownRecord): MQLDrillDownRecord {
  return {
    primaryKey: toString(raw.primary_key),
    advisorName: toString(raw.advisor_name) || 'Unknown',
    source: toString(raw.Original_source) || 'Unknown',
    channel: toString(raw.Channel_Grouping_Name) || 'Other',
    tofStage: toString(raw.TOF_Stage) || 'Unknown',
    mqlDate: extractDateValue(raw.mql_stage_entered_ts) || '',
    initialCallDate: extractDateValue(raw.Initial_Call_Scheduled_Date__c),
    leadUrl: raw.lead_url ? toString(raw.lead_url) : null,
    opportunityUrl: raw.opportunity_url ? toString(raw.opportunity_url) : null,
    nextSteps: raw.Next_Steps__c ? toString(raw.Next_Steps__c) : null,
    opportunityNextStep: raw.NextStep ? toString(raw.NextStep) : null,
    daysInCurrentStage: null,
  };
}

const _getMQLDrillDown = async (
  sgaName: string | null,
  weekStartDate: string,
  weekEndDate: string
): Promise<MQLDrillDownRecord[]> => {
  const sgaFilter = sgaName !== null ? 'AND v.SGA_Owner_Name__c = @sgaName' : '';
  const query = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.mql_stage_entered_ts,
      v.Original_source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as Channel_Grouping_Name,
      v.TOF_Stage,
      v.Initial_Call_Scheduled_Date__c,
      v.lead_url,
      v.opportunity_url,
      v.Next_Steps__c,
      v.NextStep
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    WHERE v.mql_stage_entered_ts IS NOT NULL
      AND v.mql_stage_entered_ts >= TIMESTAMP(@weekStartDate)
      AND v.mql_stage_entered_ts <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
      ${sgaFilter}
    ORDER BY v.mql_stage_entered_ts DESC
  `;

  const params: Record<string, any> = { weekStartDate, weekEndDate };
  if (sgaName !== null) params.sgaName = sgaName;
  const results = await runQuery<RawMQLDrillDownRecord>(query, params);
  return results.map(transformMQLDrillDownRecord);
};

export const getMQLDrillDown = cachedQuery(
  _getMQLDrillDown,
  'getMQLDrillDown',
  CACHE_TAGS.DASHBOARD
);

// ============================================================================
// SQL DRILL-DOWN
// ============================================================================

function transformSQLDrillDownRecord(raw: RawSQLDrillDownRecord): SQLDrillDownRecord {
  return {
    primaryKey: toString(raw.primary_key),
    advisorName: toString(raw.advisor_name) || 'Unknown',
    source: toString(raw.Original_source) || 'Unknown',
    channel: toString(raw.Channel_Grouping_Name) || 'Other',
    tofStage: toString(raw.TOF_Stage) || 'Unknown',
    sqlDate: extractDateValue(raw.converted_date_raw) || '',
    qualificationCallDate: extractDateValue(raw.Qualification_Call_Date__c),
    leadUrl: raw.lead_url ? toString(raw.lead_url) : null,
    opportunityUrl: raw.opportunity_url ? toString(raw.opportunity_url) : null,
    nextSteps: raw.Next_Steps__c ? toString(raw.Next_Steps__c) : null,
    opportunityNextStep: raw.NextStep ? toString(raw.NextStep) : null,
    daysInCurrentStage: null,
  };
}

const _getSQLDrillDown = async (
  sgaName: string | null,
  weekStartDate: string,
  weekEndDate: string
): Promise<SQLDrillDownRecord[]> => {
  const sgaFilter = sgaName !== null ? 'AND v.SGA_Owner_Name__c = @sgaName' : '';
  const query = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.converted_date_raw,
      v.Original_source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as Channel_Grouping_Name,
      v.TOF_Stage,
      v.Qualification_Call_Date__c,
      v.lead_url,
      v.opportunity_url,
      v.Next_Steps__c,
      v.NextStep
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    WHERE v.converted_date_raw IS NOT NULL
      AND v.converted_date_raw >= @weekStartDate
      AND v.converted_date_raw <= @weekEndDate
      AND v.is_sql = 1
      ${sgaFilter}
    ORDER BY v.converted_date_raw DESC
  `;

  const params: Record<string, any> = { weekStartDate, weekEndDate };
  if (sgaName !== null) params.sgaName = sgaName;
  const results = await runQuery<RawSQLDrillDownRecord>(query, params);
  return results.map(transformSQLDrillDownRecord);
};

export const getSQLDrillDown = cachedQuery(
  _getSQLDrillDown,
  'getSQLDrillDown',
  CACHE_TAGS.DASHBOARD
);

// ============================================================================
// LEADS SOURCED DRILL-DOWN
// ============================================================================

function transformLeadsSourcedRecord(raw: RawLeadsSourcedRecord): LeadsSourcedRecord {
  return {
    primaryKey: raw.Id,
    leadId: raw.Id,
    advisorName: toString(raw.Name) || 'Unknown',
    company: toString(raw.Company) || '',
    source: toString(raw.Final_Source__c) || 'Unknown',
    createdDate: extractDateValue(raw.CreatedDate) || '',
    isSelfSourced: ['Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)'].includes(raw.Final_Source__c),
    leadUrl: `https://savvywealth.lightning.force.com/lightning/r/Lead/${raw.Id}/view`,
  };
}

const _getLeadsSourcedDrillDown = async (
  sgaName: string | null,
  weekStartDate: string,
  weekEndDate: string,
  selfSourcedOnly?: boolean
): Promise<LeadsSourcedRecord[]> => {
  const sgaFilter = sgaName !== null ? 'AND l.SGA_Owner_Name__c = @sgaName' : '';
  const selfSourcedFilter = selfSourcedOnly
    ? "AND l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')"
    : '';

  const query = `
    SELECT
      l.Id,
      l.Name,
      l.Company,
      l.Final_Source__c,
      l.CreatedDate,
      l.SGA_Owner_Name__c
    FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
    WHERE l.CreatedDate >= TIMESTAMP(@weekStartDate)
      AND l.CreatedDate <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
      ${sgaFilter}
      ${selfSourcedFilter}
    ORDER BY l.CreatedDate DESC
  `;

  const params: Record<string, any> = { weekStartDate, weekEndDate };
  if (sgaName !== null) params.sgaName = sgaName;
  const results = await runQuery<RawLeadsSourcedRecord>(query, params);
  return results.map(transformLeadsSourcedRecord);
};

export const getLeadsSourcedDrillDown = cachedQuery(
  _getLeadsSourcedDrillDown,
  'getLeadsSourcedDrillDown',
  CACHE_TAGS.DASHBOARD
);

// ============================================================================
// LEADS CONTACTED DRILL-DOWN
// ============================================================================

function transformLeadsContactedRecord(raw: RawLeadsContactedRecord): LeadsContactedRecord {
  return {
    primaryKey: toString(raw.primary_key),
    advisorName: toString(raw.advisor_name) || 'Unknown',
    source: toString(raw.Original_source) || 'Unknown',
    channel: toString(raw.Channel_Grouping_Name) || toString(raw.Original_source) || 'Other',
    contactedDate: extractDateValue(raw.stage_entered_contacting__c) || '',
    leadUrl: raw.lead_url || `https://savvywealth.lightning.force.com/lightning/r/Lead/${raw.primary_key}/view`,
  };
}

const _getLeadsContactedDrillDown = async (
  sgaName: string | null,
  weekStartDate: string,
  weekEndDate: string,
  selfSourcedOnly?: boolean
): Promise<LeadsContactedRecord[]> => {
  const sgaFilterFunnel = sgaName !== null ? 'AND v.SGA_Owner_Name__c = @sgaName' : '';
  const sgaFilterLead = sgaName !== null ? 'AND l.SGA_Owner_Name__c = @sgaName' : '';

  const defaultQuery = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.Original_source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as Channel_Grouping_Name,
      v.stage_entered_contacting__c,
      v.lead_url
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    WHERE v.stage_entered_contacting__c IS NOT NULL
      AND v.stage_entered_contacting__c >= TIMESTAMP(@weekStartDate)
      AND v.stage_entered_contacting__c <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
      ${sgaFilterFunnel}
    ORDER BY v.stage_entered_contacting__c DESC
  `;

  const selfSourcedQuery = `
    SELECT
      l.Id as primary_key,
      l.Name as advisor_name,
      l.Final_Source__c as Original_source,
      l.Final_Source__c as Channel_Grouping_Name,
      l.Stage_Entered_Contacting__c as stage_entered_contacting__c,
      CAST(NULL AS STRING) as lead_url
    FROM \`savvy-gtm-analytics.SavvyGTMData.Lead\` l
    WHERE l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
      AND l.Stage_Entered_Contacting__c IS NOT NULL
      AND l.Stage_Entered_Contacting__c >= TIMESTAMP(@weekStartDate)
      AND l.Stage_Entered_Contacting__c <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
      ${sgaFilterLead}
    ORDER BY l.Stage_Entered_Contacting__c DESC
  `;

  const query = selfSourcedOnly ? selfSourcedQuery : defaultQuery;
  const params: Record<string, any> = { weekStartDate, weekEndDate };
  if (sgaName !== null) params.sgaName = sgaName;
  const results = await runQuery<RawLeadsContactedRecord>(query, params);
  return results.map(transformLeadsContactedRecord);
};

export const getLeadsContactedDrillDown = cachedQuery(
  _getLeadsContactedDrillDown,
  'getLeadsContactedDrillDown',
  CACHE_TAGS.DASHBOARD
);
