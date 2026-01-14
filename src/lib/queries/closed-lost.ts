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
    // Flatten all possible bucket values (excluding '180+' which is handled by filtering days_since_contact)
    const allBucketValues: string[] = [];
    for (const bucket of timeBuckets) {
      if (bucket !== '180+') {
        allBucketValues.push(...normalizeTimeBucket(bucket));
      }
    }
    
    if (allBucketValues.length > 0) {
      // Use IN with UNNEST for array parameter
      conditions.push('time_since_last_contact_bucket IN UNNEST(@timeBuckets)');
      params.timeBuckets = allBucketValues;
    }
    
    // If '180+' is selected, add filter for days >= 180
    // Note: The view only includes 30-179 days, so 180+ records won't be in the view
    // For now, we'll just filter what's available in the view and note that 180+ requires view modification
    if (timeBuckets.includes('180+')) {
      // The view doesn't include 180+ days, so this won't return results
      // But we keep the logic here for when the view is updated
      conditions.push('CAST(DATE_DIFF(CURRENT_DATE(), CAST(last_contact_date AS DATE), DAY) AS INT64) >= 180');
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
  
  // Filter results client-side for 180+ if needed (since view only has 30-179 days)
  let filteredResults = results;
  if (timeBuckets && timeBuckets.includes('180+') && !timeBuckets.some(b => b !== '180+' && b !== 'all')) {
    // If only 180+ is selected, filter by days_since_contact >= 180
    filteredResults = results.filter(r => {
      const days = r.days_since_contact;
      return days !== null && days >= 180;
    });
    // Update bucket label for 180+ records
    filteredResults = filteredResults.map(r => ({
      ...r,
      time_since_last_contact_bucket: r.days_since_contact && r.days_since_contact >= 180 
        ? '6+ months since last contact' 
        : r.time_since_last_contact_bucket
    }));
  } else if (timeBuckets && timeBuckets.includes('180+')) {
    // If 180+ is included with other buckets, add 180+ records from results
    const records180Plus = results
      .filter(r => r.days_since_contact !== null && r.days_since_contact >= 180)
      .map(r => ({
        ...r,
        time_since_last_contact_bucket: '6+ months since last contact'
      }));
    // Combine with other bucket results
    filteredResults = [...results.filter(r => !(r.days_since_contact !== null && r.days_since_contact >= 180)), ...records180Plus];
  }
  
  return filteredResults.map(transformClosedLostRecord);
}

/**
 * Transform raw BigQuery result to ClosedLostRecord
 */
function transformClosedLostRecord(row: RawClosedLostResult): ClosedLostRecord {
  // Extract date values (DATE fields can be strings or { value: string } objects)
  const extractDate = (field: any): string => {
    if (!field) return '';
    // Handle object format: { value: "2025-01-15" }
    if (typeof field === 'object' && field !== null && 'value' in field) {
      const dateStr = typeof field.value === 'string' ? field.value : String(field.value);
      return dateStr.split('T')[0]; // Extract YYYY-MM-DD part
    }
    // Handle string format: "2025-01-15"
    if (typeof field === 'string') {
      return field.split('T')[0]; // Extract YYYY-MM-DD part
    }
    // Fallback: convert to string
    return String(field).split('T')[0];
  };
  
  const lastContactDate = extractDate(row.last_contact_date);
  const closedLostDate = extractDate(row.closed_lost_date);
  const sqlDate = extractDate(row.sql_date);
  
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
