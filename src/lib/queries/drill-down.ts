// src/lib/queries/drill-down.ts

import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE, MAPPING_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { 
  InitialCallRecord, 
  QualificationCallRecord, 
  SQODrillDownRecord,
  RawInitialCallRecord,
  RawQualificationCallRecord,
  RawSQODrillDownRecord
} from '@/types/drill-down';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { toString, toNumber } from '@/types/bigquery-raw';

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
    aum: aum,
    aumFormatted: aum ? formatCurrency(aum) : '-',
    underwrittenAum: underwrittenAum,
    underwrittenAumFormatted: underwrittenAum ? formatCurrency(underwrittenAum) : '-',
    aumTier: raw.aum_tier ? toString(raw.aum_tier) : null,
    tofStage: toString(raw.TOF_Stage) || 'Unknown',
    stageName: raw.StageName ? toString(raw.StageName) : null,
    leadUrl: raw.lead_url ? toString(raw.lead_url) : null,
    opportunityUrl: raw.opportunity_url ? toString(raw.opportunity_url) : null,
  };
}

/**
 * Get Initial Calls drill-down records for a specific SGA and week
 */
export async function getInitialCallsDrillDown(
  sgaName: string,
  weekStartDate: string,
  weekEndDate: string
): Promise<InitialCallRecord[]> {
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
      v.opportunity_url
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm 
      ON v.Original_source = nm.original_source
    WHERE v.SGA_Owner_Name__c = @sgaName
      AND v.Initial_Call_Scheduled_Date__c IS NOT NULL
      AND v.Initial_Call_Scheduled_Date__c >= TIMESTAMP(@weekStartDate)
      AND v.Initial_Call_Scheduled_Date__c <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
    ORDER BY v.Initial_Call_Scheduled_Date__c DESC
  `;

  const params = {
    sgaName,
    weekStartDate,
    weekEndDate,
  };

  const results = await runQuery<RawInitialCallRecord>(query, params);
  return results.map(transformInitialCallRecord);
}

/**
 * Get Qualification Calls drill-down records for a specific SGA and week
 */
export async function getQualificationCallsDrillDown(
  sgaName: string,
  weekStartDate: string,
  weekEndDate: string
): Promise<QualificationCallRecord[]> {
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
      v.opportunity_url
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm 
      ON v.Original_source = nm.original_source
    WHERE v.SGA_Owner_Name__c = @sgaName
      AND v.Qualification_Call_Date__c IS NOT NULL
      AND v.Qualification_Call_Date__c >= TIMESTAMP(@weekStartDate)
      AND v.Qualification_Call_Date__c <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
    ORDER BY v.Qualification_Call_Date__c DESC
  `;

  const params = {
    sgaName,
    weekStartDate,
    weekEndDate,
  };

  const results = await runQuery<RawQualificationCallRecord>(query, params);
  return results.map(transformQualificationCallRecord);
}

/**
 * Get SQO drill-down records for a specific SGA and date range
 * Can be used for both weekly and quarterly views
 */
export async function getSQODrillDown(
  sgaName: string,
  startDate: string,
  endDate: string
): Promise<SQODrillDownRecord[]> {
  const query = `
    SELECT 
      v.primary_key,
      v.advisor_name,
      v.Date_Became_SQO__c,
      v.Original_source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      v.Opportunity_AUM,
      v.Underwritten_AUM__c,
      v.aum_tier,
      v.TOF_Stage,
      v.StageName,
      v.lead_url,
      v.opportunity_url
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm 
      ON v.Original_source = nm.original_source
    WHERE v.SGA_Owner_Name__c = @sgaName
      AND v.is_sqo_unique = 1
      AND v.Date_Became_SQO__c IS NOT NULL
      AND v.recordtypeid = @recruitingRecordType
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
    ORDER BY v.Date_Became_SQO__c DESC
  `;

  const params = {
    sgaName,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  const results = await runQuery<RawSQODrillDownRecord>(query, params);
  return results.map(transformSQODrillDownRecord);
}
