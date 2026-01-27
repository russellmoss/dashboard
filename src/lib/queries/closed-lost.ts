// src/lib/queries/closed-lost.ts

import { runQuery } from '@/lib/bigquery';
import { ClosedLostRecord, ClosedLostTimeBucket } from '@/types/sga-hub';
import { toString, toNumber } from '@/types/bigquery-raw';
import { FULL_TABLE, RE_ENGAGEMENT_RECORD_TYPE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';

const CLOSED_LOST_VIEW = 'savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup';

/**
 * Raw BigQuery result interface matching the view columns
 */
interface RawClosedLostResult {
  id: string; // Full_Opportunity_ID__c
  primary_key: string | null; // primary_key from vw_funnel_master (may be null if JOIN fails)
  opp_name: string | null;
  sga_name: string | null; // SGA name from the view
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
  days_since_closed_lost: number | null; // Days since closed lost
  time_since_closed_lost_bucket: string | null; // Time bucket for days since closed lost
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
 * Get closed lost records for a specific SGA or all SGAs
 * @param sgaName - Exact SGA name (from user.name, matches sga_name in view). Pass null to get all records.
 * @param timeBuckets - Optional array of time buckets to filter by ('all' means no filter)
 */
const _getClosedLostRecords = async (
  sgaName: string | null,
  timeBuckets?: ClosedLostTimeBucket[]
): Promise<ClosedLostRecord[]> => {
  // Separate 180+ from other buckets (view only has 30-179 days)
  const has180Plus = timeBuckets && timeBuckets.includes('180+');
  const otherBuckets = timeBuckets && timeBuckets.length > 0 && !timeBuckets.includes('all')
    ? timeBuckets.filter(b => b !== '180+')
    : undefined;

  const results: RawClosedLostResult[] = [];

  // Query view for 30-179 days (if other buckets are selected or all buckets)
  if (!has180Plus || (otherBuckets && otherBuckets.length > 0)) {
    const conditions: string[] = [];
    const params: Record<string, any> = {
      reEngagementRecordType: RE_ENGAGEMENT_RECORD_TYPE,
    };

    // Only filter by SGA if sgaName is provided
    if (sgaName) {
      conditions.push(`sga_name = @sgaName`);
      params.sgaName = sgaName;
    }

    // Handle time bucket filtering
    if (otherBuckets && otherBuckets.length > 0) {
      // Flatten all possible bucket values
      const allBucketValues: string[] = [];
      for (const bucket of otherBuckets) {
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
      SELECT DISTINCT
        cl.Full_Opportunity_ID__c as id,
        ANY_VALUE(v.primary_key) as primary_key,
        cl.opp_name,
        cl.sga_name,
        cl.Full_prospect_id__c as lead_id,
        cl.Full_Opportunity_ID__c as opportunity_id,
        CASE
          WHEN cl.Full_prospect_id__c IS NOT NULL
          THEN CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', cl.Full_prospect_id__c, '/view')
          ELSE NULL
        END as lead_url,
        cl.salesforce_url as opportunity_url,
        cl.salesforce_url,
        cl.last_contact_date,
        cl.closed_lost_date,
        cl.sql_date,
        cl.closed_lost_reason,
        cl.closed_lost_details,
        cl.time_since_last_contact_bucket,
        CAST(DATE_DIFF(CURRENT_DATE(), CAST(cl.last_contact_date AS DATE), DAY) AS INT64) as days_since_contact,
        CAST(DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) AS INT64) as days_since_closed_lost,
        CASE
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 180 THEN '6+ months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 150 THEN '5 months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 120 THEN '4 months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 90 THEN '3 months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 60 THEN '2 months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 30 THEN '1 month since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 0 THEN '< 1 month since closed lost'
          WHEN cl.closed_lost_date IS NOT NULL THEN '< 1 month since closed lost'  -- Handle future dates (negative days)
          ELSE NULL
        END as time_since_closed_lost_bucket
      FROM \`${CLOSED_LOST_VIEW}\` cl
      LEFT JOIN \`${FULL_TABLE}\` v
        ON cl.Full_Opportunity_ID__c = v.Full_Opportunity_ID__c
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o
        ON cl.Full_Opportunity_ID__c = o.Full_Opportunity_ID__c
      ${whereClause}
      ${whereClause ? 'AND' : 'WHERE'} NOT EXISTS (
        SELECT 1
        FROM \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` re
        WHERE re.recordtypeid = @reEngagementRecordType
          AND o.FA_CRD__c IS NOT NULL
          AND re.FA_CRD__c = o.FA_CRD__c
      )
      GROUP BY
        cl.Full_Opportunity_ID__c,
        cl.opp_name,
        cl.sga_name,
        cl.Full_prospect_id__c,
        cl.salesforce_url,
        cl.last_contact_date,
        cl.closed_lost_date,
        cl.sql_date,
        cl.closed_lost_reason,
        cl.closed_lost_details,
        cl.time_since_last_contact_bucket
      ORDER BY cl.closed_lost_date DESC, cl.last_contact_date DESC
    `;

    const viewResults = await runQuery<RawClosedLostResult>(query, params);
    results.push(...viewResults);
  }
  
  // Query base tables for 180+ days if needed
  if (has180Plus) {
    // Build the SGA filter clause conditionally
    const sgaFilterClause = sgaName
      ? `WHERE
            CASE
              WHEN s.SGA_Owner_Name__c = 'Savvy Marketing' THEN u.Name
              ELSE s.SGA_Owner_Name__c
            END = @sgaName`
      : '';

    // Use the same query structure as the view but for 180+ days
    const query180Plus = `
      WITH
        sql_opps AS (
          SELECT
            l.Full_prospect_id__c,
            l.SGA_Owner_Name__c,
            l.ConvertedDate AS sql_date,
            o.Id AS opportunity_salesforce_id,
            o.Full_Opportunity_ID__c,
            o.Name AS opp_name,
            o.StageName,
            o.SGA__c AS opportunity_sga_id,
            o.LastActivityDate,
            o.CloseDate,
            o.Closed_Lost_Reason__c,
            o.Closed_Lost_Details__c
          FROM
            \`savvy-gtm-analytics.SavvyGTMData.Lead\` AS l
          JOIN
            \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` AS o
            ON l.ConvertedOpportunityId = o.Full_Opportunity_ID__c
          WHERE
            l.IsConverted = TRUE
            AND o.StageName = 'Closed Lost'
            AND o.recordtypeid = '012Dn000000mrO3IAI'
            AND o.LastActivityDate IS NOT NULL
            AND DATE_DIFF(CURRENT_DATE(), o.LastActivityDate, DAY) >= 180
        ),
        sga_opp_user AS (
          SELECT Id, Name
          FROM \`savvy-gtm-analytics.SavvyGTMData.User\`
          WHERE IsActive = TRUE
        ),
        with_sga_name AS (
          SELECT
            CASE
              WHEN s.SGA_Owner_Name__c = 'Savvy Marketing' THEN u.Name
              ELSE s.SGA_Owner_Name__c
            END AS sga_name,
            s.opp_name,
            CONCAT("https://savvywealth.lightning.force.com/", s.Full_Opportunity_ID__c) AS salesforce_url,
            s.LastActivityDate AS last_contact_date,
            s.CloseDate AS closed_lost_date,
            s.sql_date,
            s.Closed_Lost_Reason__c AS closed_lost_reason,
            s.Closed_Lost_Details__c AS closed_lost_details,
            s.Full_prospect_id__c,
            s.Full_Opportunity_ID__c
          FROM sql_opps AS s
          LEFT JOIN sga_opp_user AS u ON s.opportunity_sga_id = u.Id
          ${sgaFilterClause}
        )
      SELECT DISTINCT
        w.Full_Opportunity_ID__c as id,
        ANY_VALUE(v.primary_key) as primary_key,
        w.opp_name,
        w.sga_name,
        w.Full_prospect_id__c as lead_id,
        w.Full_Opportunity_ID__c as opportunity_id,
        CASE
          WHEN w.Full_prospect_id__c IS NOT NULL
          THEN CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', w.Full_prospect_id__c, '/view')
          ELSE NULL
        END as lead_url,
        w.salesforce_url as opportunity_url,
        w.salesforce_url,
        w.last_contact_date,
        w.closed_lost_date,
        w.sql_date,
        w.closed_lost_reason,
        w.closed_lost_details,
        '6+ months since last contact' AS time_since_last_contact_bucket,
        CAST(DATE_DIFF(CURRENT_DATE(), CAST(w.last_contact_date AS DATE), DAY) AS INT64) as days_since_contact,
        CAST(DATE_DIFF(CURRENT_DATE(), CAST(w.closed_lost_date AS DATE), DAY) AS INT64) as days_since_closed_lost,
        CASE
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(w.closed_lost_date AS DATE), DAY) >= 180 THEN '6+ months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(w.closed_lost_date AS DATE), DAY) >= 150 THEN '5 months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(w.closed_lost_date AS DATE), DAY) >= 120 THEN '4 months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(w.closed_lost_date AS DATE), DAY) >= 90 THEN '3 months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(w.closed_lost_date AS DATE), DAY) >= 60 THEN '2 months since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(w.closed_lost_date AS DATE), DAY) >= 30 THEN '1 month since closed lost'
          WHEN DATE_DIFF(CURRENT_DATE(), CAST(w.closed_lost_date AS DATE), DAY) >= 0 THEN '< 1 month since closed lost'
          WHEN w.closed_lost_date IS NOT NULL THEN '< 1 month since closed lost'  -- Handle future dates (negative days)
          ELSE NULL
        END as time_since_closed_lost_bucket
      FROM with_sga_name w
      LEFT JOIN \`${FULL_TABLE}\` v
        ON w.Full_Opportunity_ID__c = v.Full_Opportunity_ID__c
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` o
        ON w.Full_Opportunity_ID__c = o.Full_Opportunity_ID__c
      WHERE NOT EXISTS (
        SELECT 1
        FROM \`savvy-gtm-analytics.SavvyGTMData.Opportunity\` re
        WHERE re.recordtypeid = @reEngagementRecordType
          AND o.FA_CRD__c IS NOT NULL
          AND re.FA_CRD__c = o.FA_CRD__c
      )
      GROUP BY
        w.Full_Opportunity_ID__c,
        w.opp_name,
        w.sga_name,
        w.Full_prospect_id__c,
        w.salesforce_url,
        w.last_contact_date,
        w.closed_lost_date,
        w.sql_date,
        w.closed_lost_reason,
        w.closed_lost_details
      ORDER BY w.closed_lost_date DESC, w.last_contact_date DESC
    `;

    const params180Plus: Record<string, any> = {
      reEngagementRecordType: RE_ENGAGEMENT_RECORD_TYPE,
    };
    if (sgaName) {
      params180Plus.sgaName = sgaName;
    }
    const results180Plus = await runQuery<RawClosedLostResult>(query180Plus, params180Plus);
    results.push(...results180Plus);
  }
  
  // Sort all results together
  results.sort((a, b) => {
    const aClosed = a.closed_lost_date ? new Date(a.closed_lost_date).getTime() : 0;
    const bClosed = b.closed_lost_date ? new Date(b.closed_lost_date).getTime() : 0;
    if (bClosed !== aClosed) return bClosed - aClosed;
    const aLast = a.last_contact_date ? new Date(a.last_contact_date).getTime() : 0;
    const bLast = b.last_contact_date ? new Date(b.last_contact_date).getTime() : 0;
    return bLast - aLast;
  });
  
  return results.map(transformClosedLostRecord);
};

export const getClosedLostRecords = cachedQuery(
  _getClosedLostRecords,
  'getClosedLostRecords',
  CACHE_TAGS.SGA_HUB
);

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
    primaryKey: row.primary_key ? toString(row.primary_key) : row.id, // Fallback to id if primary_key is null (will be populated in Phase 2)
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
    daysSinceClosedLost: toNumber(row.days_since_closed_lost),
    timeSinceClosedLostBucket: toString(row.time_since_closed_lost_bucket) || 'Unknown',
    sgaName: row.sga_name ? toString(row.sga_name) : undefined,
  };
}
