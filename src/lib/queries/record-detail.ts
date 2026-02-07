// src/lib/queries/record-detail.ts

import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE, MAPPING_TABLE } from '@/config/constants';
import { RecordDetailFull, RecordDetailRaw } from '@/types/record-detail';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { toString, toNumber } from '@/types/bigquery-raw';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

/**
 * Fetches a single record by primary_key with all fields for modal display
 */
const _getRecordDetail = async (
  id: string,
  recruiterFilter?: string | null
): Promise<RecordDetailFull | null> => {
  const recruiterCondition = recruiterFilter ? 'AND v.External_Agency__c = @recruiterFilter' : '';
  const query = `
    SELECT
      -- Identifiers
      v.primary_key,
      v.Full_prospect_id__c,
      v.Full_Opportunity_ID__c,
      v.advisor_name,
      v.record_type_name,
      
      -- Attribution
      v.Original_source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as Channel_Grouping_Name,
      v.SGA_Owner_Name__c,
      v.SGM_Owner_Name__c,
      v.External_Agency__c,
      v.Next_Steps__c,
      v.NextStep,
      v.Lead_Score_Tier__c,
      v.Experimentation_Tag_Raw__c,
      v.Campaign_Id__c,
      v.Campaign_Name__c,
      
      -- Dates - Key Milestones
      v.CreatedDate,
      v.FilterDate,
      v.stage_entered_contacting__c,
      v.mql_stage_entered_ts,
      v.converted_date_raw,
      v.Date_Became_SQO__c,
      v.advisor_join_date__c,
      
      -- Dates - Calls
      v.Initial_Call_Scheduled_Date__c,
      v.Qualification_Call_Date__c,
      
      -- Dates - Stage Entry
      v.Stage_Entered_Discovery__c,
      v.Stage_Entered_Sales_Process__c,
      v.Stage_Entered_Negotiating__c,
      v.Stage_Entered_Signed__c,
      v.Stage_Entered_On_Hold__c,
      v.Stage_Entered_Closed__c,
      v.lead_closed_date,
      v.Opp_CreatedDate,
      
      -- Financials
      v.Opportunity_AUM,
      v.Underwritten_AUM__c,
      v.Amount,
      v.aum_tier,
      
      -- Status
      v.StageName,
      v.TOF_Stage,
      v.Conversion_Status,
      v.Disposition__c,
      v.Closed_Lost_Reason__c,
      v.Closed_Lost_Details__c,
      
      -- Funnel Flags
      v.is_contacted,
      v.is_mql,
      v.is_sql,
      v.is_sqo,
      v.is_joined,
      v.is_sqo_unique,
      v.is_joined_unique,
      v.is_primary_opp_record,
      
      -- Progression Flags
      v.contacted_to_mql_progression,
      v.mql_to_sql_progression,
      v.sql_to_sqo_progression,
      v.sqo_to_joined_progression,
      
      -- Eligibility Flags
      v.eligible_for_contacted_conversions,
      v.eligible_for_contacted_conversions_30d,
      v.eligible_for_mql_conversions,
      v.eligible_for_sql_conversions,
      v.eligible_for_sqo_conversions,
      
      -- URLs
      v.lead_url,
      v.opportunity_url,
      v.salesforce_url
      
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm
      ON v.Original_source = nm.original_source
    WHERE v.primary_key = @id
    ${recruiterCondition}
    LIMIT 1
  `;

  const params: Record<string, unknown> = { id };
  if (recruiterFilter) {
    params.recruiterFilter = recruiterFilter;
  }

  const results = await runQuery<RecordDetailRaw>(query, params);

  if (!results || results.length === 0) {
    return null;
  }

  const r = results[0];
  return transformToRecordDetail(r);
};

export const getRecordDetail = cachedQuery(
  _getRecordDetail,
  'getRecordDetail',
  CACHE_TAGS.DASHBOARD
);

/**
 * Transform raw BigQuery result to RecordDetailFull
 */
function transformToRecordDetail(r: RecordDetailRaw): RecordDetailFull {
  // Determine record type based on IDs
  let recordType: 'Lead' | 'Opportunity' | 'Converted';
  if (r.Full_prospect_id__c && r.Full_Opportunity_ID__c) {
    recordType = 'Converted';
  } else if (r.Full_Opportunity_ID__c) {
    recordType = 'Opportunity';
  } else {
    recordType = 'Lead';
  }

  return {
    // Identifiers
    id: toString(r.primary_key),
    fullProspectId: r.Full_prospect_id__c ? toString(r.Full_prospect_id__c) : null,
    fullOpportunityId: r.Full_Opportunity_ID__c ? toString(r.Full_Opportunity_ID__c) : null,
    advisorName: toString(r.advisor_name) || 'Unknown',
    recordType,
    recordTypeName: r.record_type_name ? toString(r.record_type_name) : null,

    // Attribution
    source: toString(r.Original_source) || 'Unknown',
    channel: toString(r.Channel_Grouping_Name) || 'Other',
    sga: r.SGA_Owner_Name__c ? toString(r.SGA_Owner_Name__c) : null,
    sgm: r.SGM_Owner_Name__c ? toString(r.SGM_Owner_Name__c) : null,
    externalAgency: r.External_Agency__c ? toString(r.External_Agency__c) : null,
    nextSteps: r.Next_Steps__c ? toString(r.Next_Steps__c) : null,
    opportunityNextStep: r.NextStep ? toString(r.NextStep) : null,
    leadScoreTier: r.Lead_Score_Tier__c ? toString(r.Lead_Score_Tier__c) : null,
    experimentationTag: r.Experimentation_Tag_Raw__c ? toString(r.Experimentation_Tag_Raw__c) : null,
    campaignId: r.Campaign_Id__c ? toString(r.Campaign_Id__c) : null,
    campaignName: r.Campaign_Name__c ? toString(r.Campaign_Name__c) : null,

    // Dates - Key Milestones
    createdDate: extractDateValue(r.CreatedDate),
    filterDate: extractDateValue(r.FilterDate),
    contactedDate: extractDateValue(r.stage_entered_contacting__c),
    mqlDate: extractDateValue(r.mql_stage_entered_ts),
    sqlDate: extractDateValue(r.converted_date_raw),  // DATE type - can be string or object
    sqoDate: extractDateValue(r.Date_Became_SQO__c),
    joinedDate: extractDateValue(r.advisor_join_date__c),  // DATE type - can be string or object

    // Dates - Calls (DATE types - can be string or object)
    initialCallScheduledDate: extractDateValue(r.Initial_Call_Scheduled_Date__c),
    qualificationCallDate: extractDateValue(r.Qualification_Call_Date__c),

    // Dates - Stage Entry
    stageEnteredDiscovery: extractDateValue(r.Stage_Entered_Discovery__c),
    stageEnteredSalesProcess: extractDateValue(r.Stage_Entered_Sales_Process__c),
    stageEnteredNegotiating: extractDateValue(r.Stage_Entered_Negotiating__c),
    stageEnteredSigned: extractDateValue(r.Stage_Entered_Signed__c),
    stageEnteredOnHold: extractDateValue(r.Stage_Entered_On_Hold__c),
    stageEnteredClosed: extractDateValue(r.Stage_Entered_Closed__c),
    leadClosedDate: extractDateValue(r.lead_closed_date),
    oppCreatedDate: extractDateValue(r.Opp_CreatedDate),

    // Financials
    aum: toNumber(r.Opportunity_AUM),
    aumFormatted: formatCurrency(r.Opportunity_AUM),
    underwrittenAum: toNumber(r.Underwritten_AUM__c),
    underwrittenAumFormatted: formatCurrency(r.Underwritten_AUM__c),
    amount: toNumber(r.Amount),
    amountFormatted: formatCurrency(r.Amount),
    aumTier: r.aum_tier ? toString(r.aum_tier) : null,

    // Status
    stageName: r.StageName ? toString(r.StageName) : null,
    tofStage: toString(r.TOF_Stage) || 'Unknown',
    conversionStatus: toString(r.Conversion_Status) || 'Open',
    disposition: r.Disposition__c ? toString(r.Disposition__c) : null,
    closedLostReason: r.Closed_Lost_Reason__c ? toString(r.Closed_Lost_Reason__c) : null,
    closedLostDetails: r.Closed_Lost_Details__c ? toString(r.Closed_Lost_Details__c) : null,

    // Funnel Flags
    funnelFlags: {
      isContacted: r.is_contacted === 1,
      isMql: r.is_mql === 1,
      isSql: r.is_sql === 1,
      isSqo: r.is_sqo === 1,
      isJoined: r.is_joined === 1,
    },

    progressionFlags: {
      contactedToMql: r.contacted_to_mql_progression === 1,
      mqlToSql: r.mql_to_sql_progression === 1,
      sqlToSqo: r.sql_to_sqo_progression === 1,
      sqoToJoined: r.sqo_to_joined_progression === 1,
    },

    eligibilityFlags: {
      eligibleForContactedConversions: r.eligible_for_contacted_conversions === 1,
      eligibleForContactedConversions30d: r.eligible_for_contacted_conversions_30d === 1,
      eligibleForMqlConversions: r.eligible_for_mql_conversions === 1,
      eligibleForSqlConversions: r.eligible_for_sql_conversions === 1,
      eligibleForSqoConversions: r.eligible_for_sqo_conversions === 1,
    },

    // URLs
    leadUrl: r.lead_url ? toString(r.lead_url) : null,
    opportunityUrl: r.opportunity_url ? toString(r.opportunity_url) : null,
    salesforceUrl: toString(r.salesforce_url) || '',

    // Deduplication flags
    isPrimaryOppRecord: r.is_primary_opp_record === 1,
    isSqoUnique: r.is_sqo_unique === 1,
    isJoinedUnique: r.is_joined_unique === 1,
  };
}

/**
 * Extract date string from BigQuery result (handles both TIMESTAMP and DATE types)
 * 
 * IMPORTANT: BigQuery timestamp fields can be returned in different formats:
 * - TIMESTAMP fields: Often returned as { value: string } objects
 * - DATE fields: Usually returned as strings directly
 * - Sometimes TIMESTAMP fields are returned as strings (depends on BigQuery client)
 * 
 * This helper handles all cases, but watch for edge cases during Phase 8 testing
 * where dates might display incorrectly. If dates show as "[object Object]" or
 * similar, the format may have changed and this function needs adjustment.
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
