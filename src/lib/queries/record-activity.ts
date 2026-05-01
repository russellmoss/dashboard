// src/lib/queries/record-activity.ts

import { runQuery } from '@/lib/bigquery';
import { ActivityRecord, ActivityRecordRaw } from '@/types/record-activity';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { toString, toNumber } from '@/types/bigquery-raw';

const TASK_TABLE = 'savvy-gtm-analytics.SavvyGTMData.Task';
const USER_TABLE = 'savvy-gtm-analytics.SavvyGTMData.User';
const LEAD_TABLE = 'savvy-gtm-analytics.SavvyGTMData.Lead';
const OPP_TABLE = 'savvy-gtm-analytics.SavvyGTMData.Opportunity';

/**
 * Fetches all activity (Tasks) for a record, bridging Lead → Contact for converted leads.
 *
 * For lead-only records: queries by WhoId = leadId
 * For converted records: queries by WhoId IN (leadId, convertedContactId) + WhatId IN (oppIds)
 * For re-engagement: includes original recruiting opp and re-engagement opp
 *
 * NOTE: BigQuery client cannot pass null params without explicit types.
 * We build the WHERE clause dynamically to avoid null param values entirely.
 */
const _getRecordActivity = async (
  leadId: string | null,
  opportunityId: string | null,
  originRecruitingOppId: string | null,
  isReEngagement: boolean,
  contactId: string | null = null
): Promise<{ activities: ActivityRecord[]; totalCount: number }> => {
  // For re-engagement records, the "leadId" is actually the re-engagement opp ID (006 prefix)
  const isReEngagementLead = isReEngagement && leadId?.startsWith('006');
  const actualLeadId = isReEngagementLead ? null : leadId;
  const reEngagementOppId = isReEngagementLead ? leadId : null;

  // Build params — only include non-null values
  const params: Record<string, string> = {};
  if (actualLeadId) params.leadId = actualLeadId;
  if (opportunityId) params.opportunityId = opportunityId;
  if (reEngagementOppId) params.reEngagementOppId = reEngagementOppId;
  if (originRecruitingOppId) params.originRecruitingOppId = originRecruitingOppId;
  if (contactId) params.contactId = contactId;

  // Build contact bridge CTEs — only include the ones we need
  const contactBridgeCTEs: string[] = [];

  if (actualLeadId) {
    contactBridgeCTEs.push(`
      lead_contact AS (
        SELECT ConvertedContactId AS contact_id
        FROM \`${LEAD_TABLE}\`
        WHERE Id = @leadId
          AND IsConverted = TRUE
          AND ConvertedContactId IS NOT NULL
      )`);
  }

  if (reEngagementOppId) {
    // Try ContactId on the re-engagement opp itself (often NULL),
    // then fall back to the original recruiting opp's ContactId,
    // then fall back to the Lead's ConvertedContactId.
    contactBridgeCTEs.push(`
      reeng_contact AS (
        -- 1. ContactId on the re-engagement opp
        SELECT ContactId AS contact_id
        FROM \`${OPP_TABLE}\`
        WHERE Id = @reEngagementOppId
          AND ContactId IS NOT NULL
        UNION DISTINCT
        -- 2. ContactId on the original recruiting opp (usually populated)
        SELECT o2.ContactId AS contact_id
        FROM \`${OPP_TABLE}\` o1
        INNER JOIN \`${OPP_TABLE}\` o2
          ON o1.Previous_Recruiting_Opportunity_ID__c = o2.Id
        WHERE o1.Id = @reEngagementOppId
          AND o2.ContactId IS NOT NULL
        UNION DISTINCT
        -- 3. ConvertedContactId from the Lead that created the original opp
        SELECT l.ConvertedContactId AS contact_id
        FROM \`${OPP_TABLE}\` o1
        INNER JOIN \`${OPP_TABLE}\` o2
          ON o1.Previous_Recruiting_Opportunity_ID__c = o2.Id
        INNER JOIN \`${LEAD_TABLE}\` l
          ON l.ConvertedOpportunityId = o2.Id
          AND l.IsConverted = TRUE
          AND l.ConvertedContactId IS NOT NULL
        WHERE o1.Id = @reEngagementOppId
      )`);
  }

  // Also look up contact via the origin recruiting opp directly
  if (originRecruitingOppId) {
    contactBridgeCTEs.push(`
      origin_opp_contact AS (
        SELECT ContactId AS contact_id
        FROM \`${OPP_TABLE}\`
        WHERE Id = @originRecruitingOppId
          AND ContactId IS NOT NULL
      )`);
  }

  // Union all contact bridges into one CTE
  const hasContactBridge = contactBridgeCTEs.length > 0;
  let allContactsCTE = '';
  if (hasContactBridge) {
    const unionParts = [];
    if (actualLeadId) unionParts.push('SELECT contact_id FROM lead_contact');
    if (reEngagementOppId) unionParts.push('SELECT contact_id FROM reeng_contact');
    if (originRecruitingOppId) unionParts.push('SELECT contact_id FROM origin_opp_contact');
    allContactsCTE = `all_contact_ids AS (
      ${unionParts.join('\n      UNION DISTINCT\n      ')}
    )`;
  }

  // Build WHERE conditions for task matching — only for non-null IDs
  const whereConditions: string[] = [];

  if (actualLeadId) {
    whereConditions.push('t.WhoId = @leadId');
  }
  if (hasContactBridge) {
    whereConditions.push('c.contact_id IS NOT NULL');
  }
  if (contactId) {
    // Direct Contact match for advisor-grain rows (Joined/Signed drill-downs).
    whereConditions.push('t.WhoId = @contactId');
  }
  if (opportunityId) {
    whereConditions.push('t.WhatId = @opportunityId');
  }
  if (reEngagementOppId) {
    whereConditions.push('t.WhatId = @reEngagementOppId');
  }
  if (originRecruitingOppId) {
    whereConditions.push('t.WhatId = @originRecruitingOppId');
  }

  if (whereConditions.length === 0) {
    // No IDs to query — return empty
    return { activities: [], totalCount: 0 };
  }

  // Build linked_object_type CASE — only include branches for available IDs
  const linkedTypeCases: string[] = [];
  if (actualLeadId) linkedTypeCases.push("WHEN t.WhoId = @leadId THEN 'Lead'");
  if (hasContactBridge) linkedTypeCases.push("WHEN c.contact_id IS NOT NULL THEN 'Contact'");
  if (contactId) linkedTypeCases.push("WHEN t.WhoId = @contactId THEN 'Contact'");
  if (opportunityId) linkedTypeCases.push("WHEN t.WhatId = @opportunityId THEN 'Opportunity'");
  if (reEngagementOppId) linkedTypeCases.push("WHEN t.WhatId = @reEngagementOppId THEN 'Re-Engagement Opp'");
  if (originRecruitingOppId) linkedTypeCases.push("WHEN t.WhatId = @originRecruitingOppId THEN 'Original Opp'");

  // Assemble the full CTEs
  const cteParts = [...contactBridgeCTEs];
  if (allContactsCTE) cteParts.push(allContactsCTE);

  const cteClause = cteParts.length > 0
    ? `WITH ${cteParts.join(',\n')}`
    : '';

  const contactJoin = hasContactBridge
    ? 'LEFT JOIN all_contact_ids c ON t.WhoId = c.contact_id'
    : '';

  const query = `
    ${cteClause}
    SELECT
      t.Id AS task_id,
      t.CreatedDate AS created_date_utc,
      CAST(DATETIME(t.CreatedDate, 'America/New_York') AS STRING) AS created_datetime_est,
      t.Subject AS subject,
      CASE
        WHEN t.Type LIKE '%SMS%' AND t.Description IS NOT NULL
        THEN LEFT(REGEXP_REPLACE(t.Description, r'\\nFrom:.*$', ''), 500)
        ELSE NULL
      END AS message_preview,
      t.CallDurationInSeconds AS call_duration_seconds,
      u.Name AS executor_name,

      -- Channel classification (from vw_sga_activity_performance_v2 waterfall)
      CASE
        WHEN t.Subject LIKE '%Step skipped%' THEN NULL
        WHEN t.Subject LIKE '[lemlist] Call -%' THEN 'Reminder'
        WHEN t.Subject LIKE '[lemlist] Task -%' THEN 'Reminder'
        WHEN t.Subject LIKE 'Submitted Form%' OR t.Subject LIKE '%HubSpot%' THEN 'Marketing'
        WHEN t.Type LIKE '%SMS%' OR t.Subject LIKE '%SMS%' OR t.Subject LIKE '%Text%' THEN 'SMS'
        WHEN t.Subject LIKE '%LinkedIn%' OR t.TaskSubtype = 'LinkedIn' OR t.Subject LIKE '%LI %' THEN 'LinkedIn'
        WHEN t.Type = 'Call'
          OR t.TaskSubtype = 'Call'
          OR t.Subject LIKE '%Call%'
          OR t.Subject LIKE '%answered%'
          OR t.Subject LIKE '%Left VM%'
          OR t.Subject LIKE '%Voicemail%'
          OR t.Subject LIKE 'missed:%'
        THEN 'Call'
        WHEN t.Subject LIKE 'Sent Savvy raised%' THEN 'Email (Blast)'
        WHEN t.Subject LIKE '%[lemlist]%Clicked on link%' OR t.Subject LIKE '%Clicked on link%' THEN 'Email (Engagement)'
        WHEN t.Subject LIKE '%[lemlist]%'
          OR t.Subject LIKE '%List Email%'
          OR t.TaskSubtype = 'ListEmail'
        THEN 'Email (Campaign)'
        WHEN t.Type = 'Email'
          OR t.TaskSubtype = 'Email'
          OR t.Subject LIKE 'Email:%'
          OR t.Subject LIKE 'Sent %'
        THEN 'Email (Manual)'
        WHEN t.TaskSubtype = 'Event'
          OR t.Subject LIKE '%Meeting%'
          OR t.Subject LIKE '%In Person%'
          OR t.Subject LIKE '%Zoom%'
          OR t.Subject LIKE '%Demo%'
        THEN 'Meeting'
        ELSE 'Other'
      END AS activity_channel,

      -- Channel group (high-level bucket)
      CASE
        WHEN t.Subject LIKE '%Step skipped%' THEN NULL
        WHEN t.Subject LIKE '[lemlist] Call -%' THEN 'Reminder'
        WHEN t.Subject LIKE '[lemlist] Task -%' THEN 'Reminder'
        WHEN t.Subject LIKE 'Submitted Form%' OR t.Subject LIKE '%HubSpot%' THEN 'Marketing'
        WHEN t.Type LIKE '%SMS%' OR t.Subject LIKE '%SMS%' OR t.Subject LIKE '%Text%' THEN 'SMS'
        WHEN t.Subject LIKE '%LinkedIn%' OR t.TaskSubtype = 'LinkedIn' OR t.Subject LIKE '%LI %' THEN 'LinkedIn'
        WHEN t.Type = 'Call' OR t.TaskSubtype = 'Call' OR t.Subject LIKE '%Call%' OR t.Subject LIKE '%answered%' OR t.Subject LIKE '%Left VM%' OR t.Subject LIKE '%Voicemail%' OR t.Subject LIKE 'missed:%' THEN 'Call'
        WHEN t.Subject LIKE '%[lemlist]%Clicked on link%' OR t.Subject LIKE '%Clicked on link%' THEN 'Email (Engagement)'
        WHEN t.Subject LIKE '%[lemlist]%'
          OR t.Subject LIKE '%List Email%'
          OR t.TaskSubtype = 'ListEmail'
          OR t.Subject LIKE 'Sent Savvy raised%'
          OR t.Type = 'Email'
          OR t.TaskSubtype = 'Email'
          OR t.Subject LIKE 'Email:%'
          OR t.Subject LIKE 'Sent %'
        THEN 'Email'
        WHEN t.TaskSubtype = 'Event' OR t.Subject LIKE '%Meeting%' OR t.Subject LIKE '%In Person%' OR t.Subject LIKE '%Zoom%' OR t.Subject LIKE '%Demo%' THEN 'Meeting'
        ELSE 'Other'
      END AS activity_channel_group,

      -- Direction
      CASE
        WHEN t.Type LIKE 'Incoming%'
          OR t.Subject LIKE '%Incoming%'
          OR t.Subject LIKE '%Inbound%'
          OR t.Subject LIKE 'Submitted Form%'
        THEN 'Inbound'
        ELSE 'Outbound'
      END AS direction,

      -- Meaningful connect
      CASE
        WHEN t.Type = 'Incoming SMS' OR t.Subject LIKE '%Incoming SMS%' THEN 1
        WHEN t.Subject LIKE '%answered%' AND t.Subject NOT LIKE '%missed:%' THEN 1
        WHEN t.CallDurationInSeconds > 120 THEN 1
        ELSE 0
      END AS is_meaningful_connect,

      -- Linked object type
      CASE
        ${linkedTypeCases.join('\n        ')}
        ELSE 'Unknown'
      END AS linked_object_type

    FROM \`${TASK_TABLE}\` t
    INNER JOIN \`${USER_TABLE}\` u ON t.OwnerId = u.Id
    ${contactJoin}
    WHERE t.IsDeleted = FALSE
      AND t.Subject NOT LIKE '%Step skipped%'
      AND (${whereConditions.join('\n        OR ')})
    ORDER BY t.CreatedDate DESC
  `;

  const results = await runQuery<ActivityRecordRaw>(query, params);
  const activities = (results || []).map(transformActivityRecord);

  return {
    activities,
    totalCount: activities.length,
  };
};

export const getRecordActivity = cachedQuery(
  _getRecordActivity,
  'getRecordActivity',
  CACHE_TAGS.DASHBOARD
);

function transformActivityRecord(r: ActivityRecordRaw): ActivityRecord {
  // Handle BigQuery timestamp format
  let createdDateUtc = '';
  if (r.created_date_utc) {
    if (typeof r.created_date_utc === 'object' && 'value' in r.created_date_utc) {
      createdDateUtc = r.created_date_utc.value;
    } else if (typeof r.created_date_utc === 'string') {
      createdDateUtc = r.created_date_utc;
    }
  }

  return {
    taskId: toString(r.task_id),
    createdDate: createdDateUtc,
    createdDateEst: r.created_datetime_est || '',
    activityChannel: r.activity_channel || 'Other',
    activityChannelGroup: r.activity_channel_group || 'Other',
    direction: r.direction === 'Inbound' ? 'Inbound' : 'Outbound',
    subject: r.subject || '',
    messagePreview: r.message_preview || null,
    executorName: r.executor_name || 'Unknown',
    callDurationSeconds: toNumber(r.call_duration_seconds),
    isMeaningfulConnect: r.is_meaningful_connect === 1,
    linkedObjectType: (r.linked_object_type as ActivityRecord['linkedObjectType']) || 'Unknown',
  };
}
