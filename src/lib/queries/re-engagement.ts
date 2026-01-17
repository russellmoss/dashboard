// src/lib/queries/re-engagement.ts

import { runQuery } from '@/lib/bigquery';
import { ReEngagementOpportunity } from '@/types/sga-hub';
import { toString, toNumber } from '@/types/bigquery-raw';
import { FULL_TABLE, RE_ENGAGEMENT_RECORD_TYPE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

/**
 * Raw BigQuery result interface
 */
interface RawReEngagementResult {
  id: string; // Full_Opportunity_ID__c
  primary_key: string | null;
  opp_name: string | null;
  opportunity_id: string;
  opportunity_url: string;
  salesforce_url: string;
  stage_name: string;
  created_date: string | null;
  last_activity_date: string | null;
  close_date: string | null;
  amount: number | null;
  underwritten_aum: number | null;
  sga_name: string | null;
  advisor_name: string | null;
  fa_crd: string | null;
}

/**
 * Get open re-engagement opportunities owned by the SGA
 * @param sgaName - Exact SGA name (from user.name)
 */
const _getReEngagementOpportunities = async (
  sgaName: string
): Promise<ReEngagementOpportunity[]> => {
  const query = `
    SELECT DISTINCT
      re.Full_Opportunity_ID__c as id,
      ANY_VALUE(v.primary_key) as primary_key,
      re.Name as opp_name,
      re.Full_Opportunity_ID__c as opportunity_id,
      CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', re.Full_Opportunity_ID__c, '/view') as opportunity_url,
      CONCAT('https://savvywealth.lightning.force.com/lightning/r/Opportunity/', re.Full_Opportunity_ID__c, '/view') as salesforce_url,
      re.StageName as stage_name,
      CAST(re.CreatedDate AS DATE) as created_date,
      CAST(re.LastActivityDate AS DATE) as last_activity_date,
      CAST(re.CloseDate AS DATE) as close_date,
      re.Amount as amount,
      re.Underwritten_AUM__c as underwritten_aum,
      COALESCE(owner_user.Name, re.Opportunity_Owner_Name__c) as sga_name,
      re.Name as advisor_name,
      re.FA_CRD__c as fa_crd
    FROM \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` re
    LEFT JOIN \`${FULL_TABLE}\` v
      ON re.Full_Opportunity_ID__c = v.Full_Opportunity_ID__c
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` owner_user
      ON re.OwnerId = owner_user.Id
    WHERE re.recordtypeid = @reEngagementRecordType
      AND re.StageName NOT IN ('Closed Lost', 'Closed Won', 'Closed')
      AND COALESCE(owner_user.Name, re.Opportunity_Owner_Name__c) = @sgaName
    GROUP BY
      re.Full_Opportunity_ID__c,
      re.Name,
      re.StageName,
      re.CreatedDate,
      re.LastActivityDate,
      re.CloseDate,
      re.Amount,
      re.Underwritten_AUM__c,
      re.Opportunity_Owner_Name__c,
      owner_user.Name,
      re.FA_CRD__c
    ORDER BY created_date DESC
  `;
  
  const params: Record<string, any> = {
    sgaName,
    reEngagementRecordType: RE_ENGAGEMENT_RECORD_TYPE,
  };
  
  const results = await runQuery<RawReEngagementResult>(query, params);
  return results.map(transformReEngagementOpportunity);
};

export const getReEngagementOpportunities = cachedQuery(
  _getReEngagementOpportunities,
  'getReEngagementOpportunities',
  CACHE_TAGS.SGA_HUB
);

/**
 * Transform raw BigQuery result to ReEngagementOpportunity
 */
function transformReEngagementOpportunity(row: RawReEngagementResult): ReEngagementOpportunity {
  const extractDate = (field: any): string => {
    if (!field) return '';
    if (typeof field === 'object' && field !== null && 'value' in field) {
      const dateStr = typeof field.value === 'string' ? field.value : String(field.value);
      return dateStr.split('T')[0];
    }
    if (typeof field === 'string') {
      return field.split('T')[0];
    }
    return String(field).split('T')[0];
  };
  
  const salesforceUrl = row.salesforce_url 
    ? toString(row.salesforce_url)
    : `https://savvywealth.lightning.force.com/lightning/r/Opportunity/${row.opportunity_id}/view`;
  
  return {
    id: toString(row.id),
    primaryKey: row.primary_key ? toString(row.primary_key) : row.id,
    oppName: toString(row.opp_name) || 'Unknown',
    opportunityId: toString(row.opportunity_id),
    opportunityUrl: row.opportunity_url ? toString(row.opportunity_url) : salesforceUrl,
    salesforceUrl,
    stageName: toString(row.stage_name) || 'Unknown',
    createdDate: extractDate(row.created_date),
    lastActivityDate: row.last_activity_date ? extractDate(row.last_activity_date) : null,
    closeDate: row.close_date ? extractDate(row.close_date) : null,
    amount: row.amount ? toNumber(row.amount) : null,
    underwrittenAum: row.underwritten_aum ? toNumber(row.underwritten_aum) : null,
    sgaName: row.sga_name ? toString(row.sga_name) : null,
    advisorName: row.advisor_name ? toString(row.advisor_name) : null,
    faCrd: row.fa_crd ? toString(row.fa_crd) : null,
  };
}
