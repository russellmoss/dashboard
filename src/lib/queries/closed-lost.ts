// src/lib/queries/closed-lost.ts

import { runQuery } from '@/lib/bigquery';
import { ClosedLostRecord, ClosedLostTimeBucket } from '@/types/sga-hub';
import { toString, toNumber } from '@/types/bigquery-raw';

const CLOSED_LOST_VIEW = 'savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup';

/**
 * Raw BigQuery result interface matching the view columns
 */
interface RawClosedLostResult {
  id: string; // Full_Opportunity_ID__c
  opp_name: string | null;
  lead_id: string | null; // Full_prospect_id__c
  opportunity_id: string; // Full_Opportunity_ID__c
  lead_url: string | null; // Constructed in query
  opportunity_url: string | null; // salesforce_url
  salesforce_url: string | null;
  last_contact_date: string | null; // Last_Contact_Date__c (DATE field)
  closed_lost_date: string | null; // Closed_Lost_Date__c (DATE field)
  sql_date: string | null; // SQL_Date__c (DATE field)
  closed_lost_reason: string | null; // Closed_Lost_Reason__c
  closed_lost_details: string | null; // Closed_Lost_Details__c
  time_since_last_contact_bucket: string | null; // time_since_last_contact_bucket
  days_since_contact: number | null; // Days_Since_Last_Contact__c
}

/**
 * Map time bucket values from UI format to view format
 * View may have values like "1 month since last contact", "30-60 days", etc.
 * We need to handle both formats
 */
function normalizeTimeBucket(bucket: ClosedLostTimeBucket): string[] {
  if (bucket === 'all') {
    return []; // Empty array means no filter
  }
  
  // Map UI bucket values to possible view values
  // The view may have different formats, so we include common variations
  const bucketMap: Record<string, string[]> = {
    '30-60': ['30-60', '30-60 days', '1 month since last contact'],
    '60-90': ['60-90', '60-90 days', '2 months since last contact'],
    '90-120': ['90-120', '90-120 days', '3 months since last contact'],
    '120-150': ['120-150', '120-150 days', '4 months since last contact'],
    '150-180': ['150-180', '150-180 days', '5 months since last contact'],
  };
  
  return bucketMap[bucket] || [bucket];
}

/**
 * Get closed lost records for a specific SGA
 * @param sgaName - Exact SGA name (from user.name, matches sga_name in view)
 * @param timeBuckets - Optional array of time buckets to filter by ('all' means no filter)
 */
export async function getClosedLostRecords(
  sgaName: string,
  timeBuckets?: ClosedLostTimeBucket[]
): Promise<ClosedLostRecord[]> {
  // Build WHERE conditions
  const conditions: string[] = [`sga_name = @sgaName`];
  const params: Record<string, any> = { sgaName };
  
  // Handle time bucket filtering
  if (timeBuckets && timeBuckets.length > 0 && !timeBuckets.includes('all')) {
    // Flatten all possible bucket values
    const allBucketValues: string[] = [];
    for (const bucket of timeBuckets) {
      allBucketValues.push(...normalizeTimeBucket(bucket));
    }
    
    if (allBucketValues.length > 0) {
      // Use IN with UNNEST for array parameter
      conditions.push('time_since_last_contact_bucket IN UNNEST(@timeBuckets)');
      params.timeBuckets = allBucketValues;
    }
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT 
      Full_Opportunity_ID__c as id,
      opp_name,
      Full_prospect_id__c as lead_id,
      Full_Opportunity_ID__c as opportunity_id,
      CASE 
        WHEN Full_prospect_id__c IS NOT NULL 
        THEN CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', Full_prospect_id__c, '/view')
        ELSE NULL
      END as lead_url,
      salesforce_url as opportunity_url,
      salesforce_url,
      last_contact_date,
      closed_lost_date,
      sql_date,
      closed_lost_reason,
      closed_lost_details,
      time_since_last_contact_bucket,
      CAST(DATE_DIFF(CURRENT_DATE(), CAST(last_contact_date AS DATE), DAY) AS INT64) as days_since_contact
    FROM \`${CLOSED_LOST_VIEW}\`
    ${whereClause}
    ORDER BY closed_lost_date DESC, last_contact_date DESC
  `;
  
  const results = await runQuery<RawClosedLostResult>(query, params);
  
  return results.map(transformClosedLostRecord);
}

/**
 * Transform raw BigQuery result to ClosedLostRecord
 */
function transformClosedLostRecord(row: RawClosedLostResult): ClosedLostRecord {
  // Extract date values (DATE fields return as strings in YYYY-MM-DD format)
  const lastContactDate = row.last_contact_date 
    ? toString(row.last_contact_date).split('T')[0] // Ensure YYYY-MM-DD format
    : '';
  
  const closedLostDate = row.closed_lost_date 
    ? toString(row.closed_lost_date).split('T')[0]
    : '';
  
  const sqlDate = row.sql_date 
    ? toString(row.sql_date).split('T')[0]
    : '';
  
  // Extract lead URL (constructed in query or null)
  const leadUrl = row.lead_url ? toString(row.lead_url) : null;
  
  // Use opportunity_url (salesforce_url) as primary salesforceUrl
  // Fallback to constructed URL if needed
  const salesforceUrl = row.salesforce_url 
    ? toString(row.salesforce_url)
    : (row.opportunity_id 
        ? `https://savvywealth.lightning.force.com/lightning/r/Opportunity/${row.opportunity_id}/view`
        : '');
  
  const opportunityUrl = row.opportunity_url || salesforceUrl;
  
  return {
    id: toString(row.id),
    oppName: toString(row.opp_name) || 'Unknown',
    leadId: row.lead_id ? toString(row.lead_id) : null,
    opportunityId: toString(row.opportunity_id),
    leadUrl,
    opportunityUrl,
    salesforceUrl,
    lastContactDate,
    closedLostDate,
    sqlDate,
    closedLostReason: toString(row.closed_lost_reason) || 'Unknown',
    closedLostDetails: row.closed_lost_details ? toString(row.closed_lost_details) : null,
    timeSinceContactBucket: toString(row.time_since_last_contact_bucket) || 'Unknown',
    daysSinceContact: toNumber(row.days_since_contact),
  };
}
