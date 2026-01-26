// src/lib/queries/quarterly-progress.ts

import { runQuery } from '@/lib/bigquery';
import { SQODetail } from '@/types/sga-hub';
import { toNumber, toString } from '@/types/bigquery-raw';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { FULL_TABLE, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

/**
 * Raw BigQuery result for quarterly SQO count
 */
interface RawQuarterlySQOCount {
  quarter: string;
  sqo_count: number | null;
  total_aum: number | null;
}

/**
 * Raw BigQuery result for SQO detail record
 */
interface RawSQODetailResult {
  id: string; // primary_key
  advisor_name: string | null;
  sqo_date: string | null; // Date_Became_SQO__c (TIMESTAMP, formatted as DATE)
  aum: number | null; // Opportunity_AUM
  aum_tier: string | null;
  channel: string | null; // Channel_Grouping_Name
  source: string | null; // Original_source
  stage_name: string | null; // StageName
  lead_id: string | null; // Full_prospect_id__c
  opportunity_id: string | null; // Full_Opportunity_ID__c
  salesforce_url: string | null;
}

/**
 * Get quarterly SQO count and total AUM for a specific SGA and quarter
 * @param sgaName - Exact SGA name (from user.name, matches SGA_Owner_Name__c)
 * @param quarter - Quarter string in format "YYYY-QN" (e.g., "2025-Q1")
 */
const _getQuarterlySQOCount = async (
  sgaName: string,
  quarter: string
): Promise<{ sqoCount: number; totalAum: number }> => {
  const quarterInfo = getQuarterInfo(quarter);
  const startDate = quarterInfo.startDate; // YYYY-MM-DD
  const endDate = quarterInfo.endDate; // YYYY-MM-DD
  
  const query = `
    SELECT 
      CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) as quarter,
      COUNT(*) as sqo_count,
      SUM(v.Opportunity_AUM) as total_aum
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
    WHERE (v.SGA_Owner_Name__c = @sgaName OR v.Opp_SGA_Name__c = @sgaName OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sgaName)
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = @recruitingRecordType
      AND v.Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      AND CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) = @quarter
    GROUP BY quarter
  `;
  
  const params = {
    sgaName,
    quarter,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawQuarterlySQOCount>(query, params);
  
  if (results.length === 0) {
    return { sqoCount: 0, totalAum: 0 };
  }
  
  const result = results[0];
  return {
    sqoCount: toNumber(result.sqo_count),
    totalAum: toNumber(result.total_aum),
  };
};

export const getQuarterlySQOCount = cachedQuery(
  _getQuarterlySQOCount,
  'getQuarterlySQOCount',
  CACHE_TAGS.SGA_HUB
);

/**
 * Get detailed SQO records for a specific SGA and quarter
 * @param sgaName - Exact SGA name (from user.name, matches SGA_Owner_Name__c)
 * @param quarter - Quarter string in format "YYYY-QN" (e.g., "2025-Q1")
 */
const _getQuarterlySQODetails = async (
  sgaName: string,
  quarter: string
): Promise<SQODetail[]> => {
  const quarterInfo = getQuarterInfo(quarter);
  const startDate = quarterInfo.startDate; // YYYY-MM-DD
  const endDate = quarterInfo.endDate; // YYYY-MM-DD
  
  const query = `
    SELECT 
      v.primary_key as id,
      v.advisor_name,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.Date_Became_SQO__c) as sqo_date,
      v.Opportunity_AUM as aum,
      v.aum_tier,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      v.Original_source as source,
      v.StageName as stage_name,
      v.Full_prospect_id__c as lead_id,
      v.Full_Opportunity_ID__c as opportunity_id,
      v.salesforce_url
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
    WHERE (v.SGA_Owner_Name__c = @sgaName OR v.Opp_SGA_Name__c = @sgaName OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sgaName)
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = @recruitingRecordType
      AND v.Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      AND CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) = @quarter
    ORDER BY v.Date_Became_SQO__c DESC, v.Opportunity_AUM DESC
  `;
  
  const params = {
    sgaName,
    quarter,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawSQODetailResult>(query, params);
  
  return results.map(transformSQODetail);
};

export const getQuarterlySQODetails = cachedQuery(
  _getQuarterlySQODetails,
  'getQuarterlySQODetails',
  CACHE_TAGS.SGA_HUB
);

/**
 * Get quarterly progress for multiple quarters for a specific SGA
 * @param sgaName - Exact SGA name (from user.name, matches SGA_Owner_Name__c)
 * @param quarters - Array of quarter strings in format "YYYY-QN" (e.g., ["2025-Q1", "2025-Q2"])
 */
const _getQuarterlyProgressForSGA = async (
  sgaName: string,
  quarters: string[]
): Promise<Array<{ quarter: string; sqoCount: number; totalAum: number }>> => {
  if (quarters.length === 0) {
    return [];
  }
  
  // Build date range from first to last quarter
  const quarterInfos = quarters.map(q => getQuarterInfo(q)).sort((a, b) => 
    a.startDate.localeCompare(b.startDate)
  );
  const startDate = quarterInfos[0].startDate;
  const endDate = quarterInfos[quarterInfos.length - 1].endDate;
  
  const query = `
    SELECT 
      CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) as quarter,
      COUNT(*) as sqo_count,
      SUM(v.Opportunity_AUM) as total_aum
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
    WHERE (v.SGA_Owner_Name__c = @sgaName OR v.Opp_SGA_Name__c = @sgaName OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sgaName)
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = @recruitingRecordType
      AND v.Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      AND CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) IN UNNEST(@quarters)
    GROUP BY quarter
    ORDER BY quarter DESC
  `;
  
  const params = {
    sgaName,
    quarters,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawQuarterlySQOCount>(query, params);
  
  // Map results to include all requested quarters (with 0s for missing ones)
  const resultMap = new Map<string, { sqoCount: number; totalAum: number }>();
  results.forEach(r => {
    resultMap.set(r.quarter, {
      sqoCount: toNumber(r.sqo_count),
      totalAum: toNumber(r.total_aum),
    });
  });
  
  return quarters.map(quarter => ({
    quarter,
    sqoCount: resultMap.get(quarter)?.sqoCount || 0,
    totalAum: resultMap.get(quarter)?.totalAum || 0,
  }));
};

export const getQuarterlyProgressForSGA = cachedQuery(
  _getQuarterlyProgressForSGA,
  'getQuarterlyProgressForSGA',
  CACHE_TAGS.SGA_HUB
);

/**
 * Transform raw BigQuery result to SQODetail
 */
function transformSQODetail(row: RawSQODetailResult): SQODetail {
  // Extract SQO date (formatted as YYYY-MM-DD from FORMAT_TIMESTAMP)
  const sqoDate = row.sqo_date ? toString(row.sqo_date).split('T')[0] : '';
  
  // Build Salesforce URLs
  const leadUrl = row.lead_id 
    ? `https://savvywealth.lightning.force.com/lightning/r/Lead/${row.lead_id}/view`
    : null;
  
  const opportunityUrl = row.opportunity_id
    ? `https://savvywealth.lightning.force.com/lightning/r/Opportunity/${row.opportunity_id}/view`
    : null;
  
  // Use salesforce_url if available, otherwise construct from opportunity_id
  const salesforceUrl = row.salesforce_url 
    ? toString(row.salesforce_url)
    : (opportunityUrl || '');
  
  const aum = toNumber(row.aum);
  
  return {
    id: toString(row.id),
    advisorName: toString(row.advisor_name) || 'Unknown',
    sqoDate,
    aum,
    aumFormatted: formatCurrency(aum),
    aumTier: toString(row.aum_tier) || 'Unknown',
    channel: toString(row.channel) || 'Unknown',
    source: toString(row.source) || 'Unknown',
    stageName: toString(row.stage_name) || 'Unknown',
    leadUrl,
    opportunityUrl,
    salesforceUrl,
  };
}
