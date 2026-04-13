import { runQuery } from '@/lib/bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { logger } from '@/lib/logger';
import type {
  OutreachEffectivenessFilters,
  OutreachEffectivenessDashboardData,
  PersistenceMetrics,
  AvgTouchesMetrics,
  MultiChannelMetrics,
  ZeroTouchMetrics,
  AvgCallsMetrics,
  SGABreakdownRow,
  CampaignSummaryData,
  OutreachLeadRecord,
  ZeroTouchLeadRecord,
  WeeklyCallBreakdownRow,
  OutreachFilterOptions,
} from '@/types/outreach-effectiveness';

const ACTIVITY_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance';
const FUNNEL_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';
const USER_TABLE = 'savvy-gtm-analytics.SavvyGTMData.User';

// ============================================
// HELPERS
// ============================================

function getDateRange(
  rangeType: string,
  customStart?: string | null,
  customEnd?: string | null
): { start: string; end: string } {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  switch (rangeType) {
    case 'this_week': {
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const thisMonday = new Date(now);
      thisMonday.setDate(now.getDate() + mondayOffset);
      return { start: thisMonday.toISOString().split('T')[0], end: today };
    }
    case 'last_30': {
      const s = new Date(now); s.setDate(s.getDate() - 30);
      return { start: s.toISOString().split('T')[0], end: today };
    }
    case 'last_60': {
      const s = new Date(now); s.setDate(s.getDate() - 60);
      return { start: s.toISOString().split('T')[0], end: today };
    }
    case 'last_90': {
      const s = new Date(now); s.setDate(s.getDate() - 90);
      return { start: s.toISOString().split('T')[0], end: today };
    }
    case 'qtd': {
      const quarter = Math.floor(now.getMonth() / 3);
      const quarterStart = new Date(now.getFullYear(), quarter * 3, 1);
      return { start: quarterStart.toISOString().split('T')[0], end: today };
    }
    case 'all_time':
      return { start: '2023-01-01', end: today };
    case 'custom':
      if (customStart && customEnd) return { start: customStart, end: customEnd };
      const fb = new Date(now); fb.setDate(fb.getDate() - 30);
      return { start: fb.toISOString().split('T')[0], end: today };
    default:
      return { start: '2023-01-01', end: today };
  }
}

function extractDateValue(dateObj: any): string {
  if (!dateObj) return '';
  if (typeof dateObj === 'string') return dateObj;
  if (dateObj && typeof dateObj === 'object' && 'value' in dateObj) return String(dateObj.value);
  return String(dateObj);
}

// Self-sourced values in vw_funnel_master.Original_source. Verified via BQ on
// 2026-04-13: LinkedIn (Self Sourced) = 31,183 rows, Fintrx (Self-Sourced) =
// 2,402 rows. Note the inconsistent punctuation across the two values — match
// exact strings. If the product adds a new self-sourced channel, update both
// this constant and the synthetic option label in _getOutreachFilterOptions.
const SELF_SOURCED_ORIGINAL_SOURCES = [
  'LinkedIn (Self Sourced)',
  'Fintrx (Self-Sourced)',
];

function buildSgaFilter(filters: OutreachEffectivenessFilters): string {
  return filters.sga ? 'AND TRIM(f.SGA_Owner_Name__c) = @sga' : '';
}

/**
 * Compile the multi-select campaign filter. Treats the two sentinel IDs
 * ('no_campaign', '__self_sourced__') as synthetic chips that expand to
 * different predicates, then UNIONs with the real-campaign IN-clause.
 * Empty array → no filter.
 */
function buildCampaignFilter(filters: OutreachEffectivenessFilters): string {
  const ids = filters.campaignIds ?? [];
  if (ids.length === 0) return '';

  const hasNoCampaign = ids.includes('no_campaign');
  const hasSelfSourced = ids.includes('__self_sourced__');
  const realIds = ids.filter(id => id !== 'no_campaign' && id !== '__self_sourced__');

  const clauses: string[] = [];
  if (realIds.length > 0) {
    // Matches either the primary campaign or any entry in the all_campaigns array.
    clauses.push(`f.Campaign_Id__c IN UNNEST(@campaignIds)`);
    clauses.push(`(SELECT COUNT(1) FROM UNNEST(IFNULL(f.all_campaigns, [])) AS camp WHERE camp.id IN UNNEST(@campaignIds)) > 0`);
  }
  if (hasNoCampaign) {
    clauses.push(`f.Campaign_Id__c IS NULL`);
  }
  if (hasSelfSourced) {
    clauses.push(`f.Original_source IN UNNEST(@selfSourcedSources)`);
  }

  return `AND (${clauses.join(' OR ')})`;
}

function buildParams(filters: OutreachEffectivenessFilters): Record<string, any> {
  const range = getDateRange(filters.dateRangeType, filters.startDate, filters.endDate);
  const params: Record<string, any> = {
    startDate: range.start,
    endDate: range.end,
    endDateTs: range.end + ' 23:59:59', // Include full end date for TIMESTAMP comparisons
  };
  if (filters.sga) params.sga = filters.sga;

  const ids = filters.campaignIds ?? [];
  const realIds = ids.filter(id => id !== 'no_campaign' && id !== '__self_sourced__');
  if (realIds.length > 0) params.campaignIds = realIds;
  if (ids.includes('__self_sourced__')) params.selfSourcedSources = SELF_SOURCED_ORIGINAL_SOURCES;

  return params;
}

const SGA_EXCLUSION_LIST = `
  'Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
  'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
  'Savvy Marketing', 'Savvy Operations', 'Lauren George'
`;

// ============================================
// SHARED CTE (metrics 1-4)
// ============================================

function buildSharedCTE(sgaFilter: string, campaignFilter: string): string {
  return `
    WITH lead_population AS (
      SELECT
        f.Full_prospect_id__c,
        f.advisor_name,
        TRIM(f.SGA_Owner_Name__c) AS SGA_Owner_Name__c,
        f.is_mql,
        f.is_sql,
        f.is_sqo_unique,
        f.lead_closed_date,
        f.stage_entered_contacting__c,
        f.mql_stage_entered_ts,
        f.is_contacted,
        f.Disposition__c,
        f.Campaign_Name__c,
        f.Full_Opportunity_ID__c,
        f.TOF_Stage,
        DATE(f.FilterDate) AS filter_date,
        -- Terminal: lead has reached a final state in its CURRENT lifecycle
        -- Uses TOF_Stage (current stage) not lead_closed_date (may be from prior lifecycle)
        CASE
          WHEN f.TOF_Stage IN ('MQL', 'SQL', 'SQO', 'Joined') THEN TRUE
          WHEN f.TOF_Stage = 'Closed' THEN TRUE
          WHEN f.TOF_Stage = 'Contacted'
            AND f.stage_entered_contacting__c IS NOT NULL
            AND DATE(f.stage_entered_contacting__c) >= DATE(f.FilterDate)
            AND DATE(f.stage_entered_contacting__c) + 30 <= CURRENT_DATE('America/New_York')
            THEN TRUE
          ELSE FALSE
        END AS is_terminal,
        -- Open: currently active, not closed or progressed
        CASE
          WHEN f.TOF_Stage IN ('Closed', 'MQL', 'SQL', 'SQO', 'Joined') THEN FALSE
          ELSE TRUE
        END AS is_open
      FROM \`${FUNNEL_VIEW}\` f
      WHERE DATE(f.FilterDate) >= @startDate
        AND DATE(f.FilterDate) <= @endDate
        AND f.Full_prospect_id__c IS NOT NULL
        AND TRIM(f.SGA_Owner_Name__c) IN (
          SELECT TRIM(u.Name) FROM \`${USER_TABLE}\` u
          WHERE u.IsSGA__c = TRUE
            AND u.Name NOT IN (${SGA_EXCLUSION_LIST})
        )
        ${sgaFilter}
        ${campaignFilter}
    ),
    outbound_touches AS (
      SELECT
        lp.Full_prospect_id__c,
        COUNT(*) AS touch_count,
        COUNT(DISTINCT CASE
          WHEN a.activity_channel IN ('SMS') THEN 'SMS'
          WHEN a.activity_channel IN ('LinkedIn') THEN 'LinkedIn'
          WHEN a.activity_channel IN ('Call') THEN 'Call'
          WHEN a.activity_channel LIKE 'Email%' THEN 'Email'
          ELSE NULL
        END) AS channel_count,
        MAX(CASE WHEN a.activity_channel = 'SMS' THEN 1 ELSE 0 END) AS has_sms,
        MAX(CASE WHEN a.activity_channel = 'LinkedIn' THEN 1 ELSE 0 END) AS has_linkedin,
        MAX(CASE WHEN a.activity_channel = 'Call' THEN 1 ELSE 0 END) AS has_call,
        MAX(CASE WHEN a.activity_channel LIKE 'Email%' THEN 1 ELSE 0 END) AS has_email
      FROM lead_population lp
      INNER JOIN \`${ACTIVITY_VIEW}\` a ON lp.Full_prospect_id__c = a.Full_prospect_id__c
      WHERE a.direction = 'Outbound'
        AND a.is_engagement_tracking = 0
        AND COALESCE(a.activity_channel_group, '') NOT IN ('Marketing', '')
        AND a.task_created_date_est >= DATE_SUB(lp.filter_date, INTERVAL 1 DAY)
        AND a.task_created_date_est <= CURRENT_DATE('America/New_York')
        AND TRIM(a.task_executor_name) = lp.SGA_Owner_Name__c
      GROUP BY lp.Full_prospect_id__c
    ),
    email_presence AS (
      SELECT DISTINCT lp.Full_prospect_id__c
      FROM lead_population lp
      INNER JOIN \`${ACTIVITY_VIEW}\` a ON lp.Full_prospect_id__c = a.Full_prospect_id__c
      WHERE a.direction = 'Outbound'
        AND a.activity_channel LIKE 'Email%'
        AND a.task_created_date_est >= DATE_SUB(lp.filter_date, INTERVAL 1 DAY)
        AND a.task_created_date_est <= CURRENT_DATE('America/New_York')
        AND TRIM(a.task_executor_name) = lp.SGA_Owner_Name__c
    ),
    inbound_activity AS (
      -- Only count inbound activity that occurred during the current lifecycle
      -- (after the lead's FilterDate). Recycled leads carry prior-lifecycle
      -- replies that should not count as "Replied" in the new pass.
      SELECT DISTINCT lp.Full_prospect_id__c
      FROM lead_population lp
      INNER JOIN \`${ACTIVITY_VIEW}\` a ON lp.Full_prospect_id__c = a.Full_prospect_id__c
      WHERE a.direction = 'Inbound'
        AND COALESCE(a.activity_channel_group, '') NOT IN ('Marketing', '')
        AND a.task_created_date_est >= DATE_SUB(lp.filter_date, INTERVAL 1 DAY)
    ),
    classified_leads AS (
      SELECT
        lp.*,
        COALESCE(ot.touch_count, 0) AS outbound_touchpoints,
        COALESCE(ot.channel_count, 0) AS outbound_channel_count,
        COALESCE(ot.has_sms, 0) AS has_sms,
        COALESCE(ot.has_linkedin, 0) AS has_linkedin,
        COALESCE(ot.has_call, 0) AS has_call,
        CASE WHEN ep.Full_prospect_id__c IS NOT NULL THEN 1 ELSE COALESCE(ot.has_email, 0) END AS has_email_any,
        COALESCE(ot.has_email, 0) AS has_email_manual,
        CASE
          WHEN lp.is_sql = 1 THEN 'Converted'
          WHEN lp.is_mql = 1 THEN 'MQL'
          WHEN ia.Full_prospect_id__c IS NOT NULL THEN 'Replied'
          -- Only count disposition-based replies if the close happened in the
          -- current lifecycle.  Recycled leads carry stale Disposition__c from
          -- a prior lifecycle; ignore those by comparing lead_closed_date to
          -- the current lifecycle start (filter_date).
          WHEN lp.Disposition__c IN (
            'Not Interested in Moving', 'Timing',
            'No Book', 'AUM / Revenue too Low', 'Book Not Transferable',
            'Restrictive Covenants', 'Compensation Model Issues',
            'Interested in M&A', 'Wants Platform Only',
            'Other', 'Withdrawn or Rejected Application'
          ) AND (lp.lead_closed_date IS NULL OR DATE(lp.lead_closed_date) >= lp.filter_date)
          THEN 'Replied'
          ELSE 'Unengaged'
        END AS lead_status,
        -- Bad leads: excluded from persistence/avg-touches/multi-channel denominators
        -- Not a Fit = SGA culled them, not a performance issue
        -- Bad Contact Info = data quality issue, not SGA's fault
        CASE WHEN lp.Disposition__c IN ('Not a Fit', 'Bad Contact Info - Uncontacted', 'Bad Lead Provided', 'Wrong Phone Number - Contacted') THEN TRUE ELSE FALSE END AS is_bad_lead,
        CASE WHEN COALESCE(ot.touch_count, 0) > 0 THEN TRUE ELSE FALSE END AS is_worked,
        -- Currently in contacting in this lifecycle (for persistence/multi-channel: include open contacting leads)
        CASE WHEN lp.TOF_Stage = 'Contacted'
          AND lp.stage_entered_contacting__c IS NOT NULL
          AND DATE(lp.stage_entered_contacting__c) >= lp.filter_date
          THEN TRUE ELSE FALSE END AS is_in_contacting,
        (COALESCE(ot.has_sms, 0) + COALESCE(ot.has_linkedin, 0) + COALESCE(ot.has_call, 0) +
         CASE WHEN ep.Full_prospect_id__c IS NOT NULL THEN 1 ELSE COALESCE(ot.has_email, 0) END
        ) AS multi_channel_count,
        CASE
          WHEN lp.stage_entered_contacting__c IS NOT NULL
            AND DATE(lp.stage_entered_contacting__c) >= lp.filter_date THEN
            DATE_DIFF(CURRENT_DATE('America/New_York'), DATE(lp.stage_entered_contacting__c), DAY)
          ELSE NULL
        END AS days_in_contacting
      FROM lead_population lp
      LEFT JOIN outbound_touches ot ON lp.Full_prospect_id__c = ot.Full_prospect_id__c
      LEFT JOIN email_presence ep ON lp.Full_prospect_id__c = ep.Full_prospect_id__c
      LEFT JOIN inbound_activity ia ON lp.Full_prospect_id__c = ia.Full_prospect_id__c
    )`;
}

// ============================================
// ZERO-TOUCH MODE FILTER
// ============================================

// "all" = all zero-touch leads (default was this before)
// "stale" = only leads that have been sitting 30+ days with no activity, OR are already closed
function buildZeroTouchStaleFilter(prefix: string = ''): string {
  const p = prefix ? prefix + '.' : '';
  return `AND (
    ${p}TOF_Stage = 'Closed'
    OR (${p}filter_date <= DATE_SUB(CURRENT_DATE('America/New_York'), INTERVAL 30 DAY))
  )`;
}

// ============================================
// MAIN DASHBOARD QUERY
// ============================================

async function _getOutreachDashboard(
  filters: OutreachEffectivenessFilters
): Promise<OutreachEffectivenessDashboardData> {
  const params = buildParams(filters);
  const sgaFilter = buildSgaFilter(filters);
  const campaignFilter = buildCampaignFilter(filters);
  const sharedCTE = buildSharedCTE(sgaFilter, campaignFilter);
  const ztStale = filters.zeroTouchMode === 'stale' ? buildZeroTouchStaleFilter() : '';
  const ztStaleCl = filters.zeroTouchMode === 'stale' ? buildZeroTouchStaleFilter('cl') : '';

  // MQL/SQL/SQO counts by event date — matches funnel performance page logic exactly
  // Each metric gates on its own event timestamp, not FilterDate
  const eventCountsCTE = `
    , event_date_counts AS (
      SELECT
        TRIM(f.SGA_Owner_Name__c) AS sga_name,
        COUNTIF(f.mql_stage_entered_ts IS NOT NULL
          AND TIMESTAMP(f.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(f.mql_stage_entered_ts) <= TIMESTAMP(@endDateTs)) AS mql_by_event,
        COUNTIF(f.converted_date_raw IS NOT NULL
          AND DATE(f.converted_date_raw) >= DATE(@startDate)
          AND DATE(f.converted_date_raw) <= DATE(@endDate)
          AND f.is_sql = 1) AS sql_by_event,
        COUNTIF(f.Date_Became_SQO__c IS NOT NULL
          AND TIMESTAMP(f.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(f.Date_Became_SQO__c) <= TIMESTAMP(@endDateTs)
          AND f.recordtypeid = '012Dn000000mrO3IAI'
          AND f.is_sqo_unique = 1) AS sqo_by_event
      FROM \`${FUNNEL_VIEW}\` f
      WHERE f.Full_prospect_id__c IS NOT NULL
        AND TRIM(f.SGA_Owner_Name__c) IN (
          SELECT TRIM(u.Name) FROM \`${USER_TABLE}\` u
          WHERE u.IsSGA__c = TRUE
            AND u.Name NOT IN (${SGA_EXCLUSION_LIST})
        )
        ${sgaFilter}
        ${campaignFilter}
      GROUP BY 1
    )
  `;

  const metricsQuery = `
    ${sharedCTE}
    ${eventCountsCTE}

    SELECT
      'rollup' AS row_type,
      'ALL' AS sga_name,
      COUNT(*) AS total_assigned,
      COUNTIF(is_worked) AS worked_leads,
      COUNTIF(Disposition__c IN ('Not a Fit', 'Bad Contact Info - Uncontacted', 'Bad Lead Provided', 'Wrong Phone Number - Contacted')) AS bad_leads,
      (SELECT SUM(mql_by_event) FROM event_date_counts) AS mql,
      (SELECT SUM(sql_by_event) FROM event_date_counts) AS sql_count,
      (SELECT SUM(sqo_by_event) FROM event_date_counts) AS sqo_count,
      COUNTIF(lead_status = 'Replied') AS replied,
      COUNTIF(lead_status = 'Unengaged') AS unengaged,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND outbound_touchpoints >= 5) AS five_plus_touches,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting)) AS terminal_unengaged,
      AVG(CASE WHEN lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) THEN outbound_touchpoints END) AS avg_touchpoints,
      AVG(CASE WHEN lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) THEN outbound_touchpoints END) AS avg_touches_before_terminal,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND outbound_touchpoints < 5) AS premature_count,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND outbound_touchpoints = 1) AS dist_1,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND outbound_touchpoints = 2) AS dist_2,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND outbound_touchpoints = 3) AS dist_3,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND outbound_touchpoints = 4) AS dist_4,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND outbound_touchpoints >= 5) AS dist_5plus,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND multi_channel_count >= 2) AS mc_2plus,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND multi_channel_count >= 3) AS mc_3plus,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND multi_channel_count = 4) AS mc_all4,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND multi_channel_count = 1) AS mc_1only,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND has_sms = 1) AS mc_has_sms,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND has_linkedin = 1) AS mc_has_linkedin,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND has_call = 1) AS mc_has_call,
      COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND has_email_any = 1) AS mc_has_email,
      COUNTIF(outbound_touchpoints = 0 AND is_contacted = 0 AND NOT is_bad_lead AND lead_status = 'Unengaged' AND COALESCE(Disposition__c, '') != 'No Response' ${ztStale}) AS zero_touch_count,
      COUNTIF(outbound_touchpoints = 0 AND is_contacted = 0 AND NOT is_bad_lead AND lead_status = 'Unengaged' AND COALESCE(Disposition__c, '') != 'No Response' ${ztStale} AND is_open) AS zero_touch_open,
      COUNTIF(outbound_touchpoints = 0 AND is_contacted = 0 AND NOT is_bad_lead AND lead_status = 'Unengaged' AND COALESCE(Disposition__c, '') != 'No Response' ${ztStale} AND NOT is_open) AS zero_touch_closed
    FROM classified_leads

    UNION ALL

    SELECT
      'sga' AS row_type,
      cl.SGA_Owner_Name__c AS sga_name,
      COUNT(*) AS total_assigned,
      COUNTIF(cl.is_worked) AS worked_leads,
      COUNTIF(cl.Disposition__c IN ('Not a Fit', 'Bad Contact Info - Uncontacted', 'Bad Lead Provided', 'Wrong Phone Number - Contacted')) AS bad_leads,
      MAX(edc.mql_by_event) AS mql,
      MAX(edc.sql_by_event) AS sql_count,
      MAX(edc.sqo_by_event) AS sqo_count,
      COUNTIF(cl.lead_status = 'Replied') AS replied,
      COUNTIF(cl.lead_status = 'Unengaged') AS unengaged,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.outbound_touchpoints >= 5) AS five_plus_touches,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting)) AS terminal_unengaged,
      AVG(CASE WHEN cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) THEN cl.outbound_touchpoints END) AS avg_touchpoints,
      AVG(CASE WHEN cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) THEN cl.outbound_touchpoints END) AS avg_touches_before_terminal,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.outbound_touchpoints < 5) AS premature_count,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.outbound_touchpoints = 1) AS dist_1,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.outbound_touchpoints = 2) AS dist_2,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.outbound_touchpoints = 3) AS dist_3,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.outbound_touchpoints = 4) AS dist_4,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.outbound_touchpoints >= 5) AS dist_5plus,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.multi_channel_count >= 2) AS mc_2plus,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.multi_channel_count >= 3) AS mc_3plus,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.multi_channel_count = 4) AS mc_all4,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.multi_channel_count = 1) AS mc_1only,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.has_sms = 1) AS mc_has_sms,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.has_linkedin = 1) AS mc_has_linkedin,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.has_call = 1) AS mc_has_call,
      COUNTIF(cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.has_email_any = 1) AS mc_has_email,
      COUNTIF(cl.outbound_touchpoints = 0 AND cl.is_contacted = 0 AND NOT cl.is_bad_lead AND cl.lead_status = 'Unengaged' AND COALESCE(cl.Disposition__c, '') != 'No Response' ${ztStaleCl}) AS zero_touch_count,
      COUNTIF(cl.outbound_touchpoints = 0 AND cl.is_contacted = 0 AND NOT cl.is_bad_lead AND cl.lead_status = 'Unengaged' AND COALESCE(cl.Disposition__c, '') != 'No Response' ${ztStaleCl} AND cl.is_open) AS zero_touch_open,
      COUNTIF(cl.outbound_touchpoints = 0 AND cl.is_contacted = 0 AND NOT cl.is_bad_lead AND cl.lead_status = 'Unengaged' AND COALESCE(cl.Disposition__c, '') != 'No Response' ${ztStaleCl} AND NOT cl.is_open) AS zero_touch_closed
    FROM classified_leads cl
    LEFT JOIN event_date_counts edc ON cl.SGA_Owner_Name__c = edc.sga_name
    GROUP BY cl.SGA_Owner_Name__c
  `;

  // Metric 5: Avg Calls/Week (separate query — different source data)
  const sgaFilterForCalls = filters.sga ? 'AND TRIM(u.Name) = @sga' : '';
  const callsQuery = `
    WITH active_sgas AS (
      SELECT TRIM(u.Name) AS sga_name, DATE(u.CreatedDate) AS sga_start_date
      FROM \`${USER_TABLE}\` u
      WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
        AND u.Name NOT IN (${SGA_EXCLUSION_LIST})
        ${sgaFilterForCalls}
    ),
    week_series AS (
      SELECT
        s.sga_name,
        s.sga_start_date,
        week_start
      FROM active_sgas s
      CROSS JOIN UNNEST(
        GENERATE_DATE_ARRAY(
          GREATEST(DATE_TRUNC(@startDate, WEEK(MONDAY)), DATE_TRUNC(s.sga_start_date, WEEK(MONDAY))),
          DATE_TRUNC(@endDate, WEEK(MONDAY)),
          INTERVAL 1 WEEK
        )
      ) AS week_start
      WHERE week_start >= DATE_TRUNC(s.sga_start_date, WEEK(MONDAY))
    ),
    initial_call_events AS (
      SELECT
        TRIM(f.SGA_Owner_Name__c) AS sga_name,
        DATE_TRUNC(f.Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) AS week_start,
        COUNT(*) AS call_count
      FROM \`${FUNNEL_VIEW}\` f
      WHERE TRIM(f.SGA_Owner_Name__c) IN (SELECT sga_name FROM active_sgas)
        AND f.Initial_Call_Scheduled_Date__c BETWEEN @startDate AND @endDate
        AND f.Initial_Call_Scheduled_Date__c IS NOT NULL
      GROUP BY 1, 2
    ),
    qual_call_events AS (
      SELECT
        TRIM(f.SGA_Owner_Name__c) AS sga_name,
        DATE_TRUNC(f.Qualification_Call_Date__c, WEEK(MONDAY)) AS week_start,
        COUNT(*) AS call_count
      FROM \`${FUNNEL_VIEW}\` f
      WHERE TRIM(f.SGA_Owner_Name__c) IN (SELECT sga_name FROM active_sgas)
        AND f.Qualification_Call_Date__c BETWEEN @startDate AND @endDate
        AND f.Qualification_Call_Date__c IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT
      ws.sga_name,
      ws.sga_start_date,
      COUNT(DISTINCT ws.week_start) AS eligible_weeks,
      SUM(COALESCE(ic.call_count, 0)) AS total_initial_calls,
      SAFE_DIVIDE(SUM(COALESCE(ic.call_count, 0)), COUNT(DISTINCT ws.week_start)) AS avg_initial_per_week,
      SUM(COALESCE(qc.call_count, 0)) AS total_qual_calls,
      SAFE_DIVIDE(SUM(COALESCE(qc.call_count, 0)), COUNT(DISTINCT ws.week_start)) AS avg_qual_per_week
    FROM week_series ws
    LEFT JOIN initial_call_events ic ON ws.sga_name = ic.sga_name AND ws.week_start = ic.week_start
    LEFT JOIN qual_call_events qc ON ws.sga_name = qc.sga_name AND ws.week_start = qc.week_start
    GROUP BY ws.sga_name, ws.sga_start_date
    ORDER BY avg_initial_per_week DESC
  `;

  // Campaign summary: only meaningful when exactly ONE real campaign is
  // selected (synthetic sentinels and multi-campaign selections don't roll up
  // cleanly — MAX(Campaign_Name__c) would collapse to one of several names).
  let campaignSummaryPromise: Promise<any[]> | null = null;
  const realCampaignIds = (filters.campaignIds ?? []).filter(
    id => id !== 'no_campaign' && id !== '__self_sourced__'
  );
  if (realCampaignIds.length === 1) {
    const campaignQuery = `
      ${sharedCTE}
      SELECT
        MAX(Campaign_Name__c) AS campaign_name,
        COUNT(*) AS total_leads,
        COUNTIF(is_contacted = 1) AS contacted_leads,
        AVG(CASE WHEN lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) THEN outbound_touchpoints END) AS avg_touches,
        SAFE_DIVIDE(
          COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND outbound_touchpoints >= 5),
          COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting))
        ) * 100 AS pct_5plus,
        SAFE_DIVIDE(
          COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting) AND multi_channel_count >= 2),
          COUNTIF(lead_status = 'Unengaged' AND is_worked AND NOT is_bad_lead AND (is_terminal OR is_in_contacting))
        ) * 100 AS multi_channel_pct
      FROM classified_leads
    `;
    campaignSummaryPromise = runQuery<any>(campaignQuery, params);
  }

  const promises: Promise<any[]>[] = [
    runQuery<any>(metricsQuery, params),
    runQuery<any>(callsQuery, params),
  ];
  if (campaignSummaryPromise) promises.push(campaignSummaryPromise);

  const results = await Promise.all(promises);
  const metricsRows = results[0];
  const callsRows = results[1];
  const campaignRows = results[2] || null;

  return transformDashboardResults(metricsRows, callsRows, campaignRows);
}

// ============================================
// TRANSFORM
// ============================================

function transformDashboardResults(
  metricsRows: any[],
  callsRows: any[],
  campaignRows?: any[] | null
): OutreachEffectivenessDashboardData {
  const rollup = metricsRows.find((r: any) => String(r.row_type) === 'rollup');
  const sgaMetrics = metricsRows.filter((r: any) => String(r.row_type) === 'sga');

  const toInt = (v: any) => parseInt(String(v || 0)) || 0;
  const toFloat = (v: any) => parseFloat(String(v || 0)) || 0;
  const safePct = (num: number, den: number) => den > 0 ? Math.round((num / den) * 1000) / 10 : 0;

  const terminalUnengaged = toInt(rollup?.terminal_unengaged);
  const totalAssigned = toInt(rollup?.total_assigned);

  const persistence: PersistenceMetrics = {
    pct5Plus: safePct(toInt(rollup?.five_plus_touches), terminalUnengaged),
    totalTerminalUnengaged: terminalUnengaged,
    totalWith5Plus: toInt(rollup?.five_plus_touches),
    avgTouchpoints: toFloat(rollup?.avg_touchpoints),
  };

  const avgTouches: AvgTouchesMetrics = {
    avgTouches: toFloat(rollup?.avg_touches_before_terminal),
    totalTerminalUnengagedWorked: terminalUnengaged,
    prematureCount: toInt(rollup?.premature_count),
    prematureRate: safePct(toInt(rollup?.premature_count), terminalUnengaged),
    distribution: {
      one: toInt(rollup?.dist_1),
      two: toInt(rollup?.dist_2),
      three: toInt(rollup?.dist_3),
      four: toInt(rollup?.dist_4),
      fivePlus: toInt(rollup?.dist_5plus),
    },
  };

  const multiChannel: MultiChannelMetrics = {
    pct2Plus: safePct(toInt(rollup?.mc_2plus), terminalUnengaged),
    pct3Plus: safePct(toInt(rollup?.mc_3plus), terminalUnengaged),
    totalTerminalUnengaged: terminalUnengaged,
    channelGaps: [
      { channel: 'SMS', coveragePct: safePct(toInt(rollup?.mc_has_sms), terminalUnengaged) },
      { channel: 'LinkedIn', coveragePct: safePct(toInt(rollup?.mc_has_linkedin), terminalUnengaged) },
      { channel: 'Call', coveragePct: safePct(toInt(rollup?.mc_has_call), terminalUnengaged) },
      { channel: 'Email', coveragePct: safePct(toInt(rollup?.mc_has_email), terminalUnengaged) },
    ],
  };

  const zeroTouch: ZeroTouchMetrics = {
    zeroTouchCount: toInt(rollup?.zero_touch_count),
    totalAssigned,
    zeroTouchPct: safePct(toInt(rollup?.zero_touch_count), totalAssigned),
    stillOpen: toInt(rollup?.zero_touch_open),
    closedZeroTouch: toInt(rollup?.zero_touch_closed),
  };

  // Merge calls data
  const callsMap = new Map<string, any>();
  for (const row of callsRows) {
    callsMap.set(String(row.sga_name), row);
  }

  let totalInitial = 0, totalQual = 0, totalWeeks = 0, sgaCount = 0;
  for (const row of callsRows) {
    totalInitial += toInt(row.total_initial_calls);
    totalQual += toInt(row.total_qual_calls);
    totalWeeks += toInt(row.eligible_weeks);
    sgaCount++;
  }

  const avgCalls: AvgCallsMetrics = {
    avgInitialPerWeek: totalWeeks > 0 ? Math.round((totalInitial / totalWeeks) * 100) / 100 : 0,
    avgQualPerWeek: totalWeeks > 0 ? Math.round((totalQual / totalWeeks) * 100) / 100 : 0,
    sgaCount,
    weekCount: totalWeeks,
  };

  const sgaBreakdown: SGABreakdownRow[] = sgaMetrics.map((row: any) => {
    const callsData = callsMap.get(String(row.sga_name));
    const sgaTerminal = toInt(row.terminal_unengaged);
    const sgaTotal = toInt(row.total_assigned);
    return {
      sgaName: String(row.sga_name || ''),
      totalAssigned: sgaTotal,
      workedLeads: toInt(row.worked_leads),
      badLeads: toInt(row.bad_leads),
      mql: toInt(row.mql),
      sql: toInt(row.sql_count),
      sqo: toInt(row.sqo_count),
      replied: toInt(row.replied),
      unengaged: toInt(row.unengaged),
      fivePlusTouches: toInt(row.five_plus_touches),
      pct5Plus: safePct(toInt(row.five_plus_touches), sgaTerminal),
      avgTouchpoints: toFloat(row.avg_touchpoints),
      terminalUnengagedWorked: sgaTerminal,
      avgTouchesBeforeTerminal: toFloat(row.avg_touches_before_terminal),
      prematureCount: toInt(row.premature_count),
      prematureRate: safePct(toInt(row.premature_count), sgaTerminal),
      pct2PlusChannels: safePct(toInt(row.mc_2plus), sgaTerminal),
      pct3PlusChannels: safePct(toInt(row.mc_3plus), sgaTerminal),
      pctAllChannels: safePct(toInt(row.mc_all4), sgaTerminal),
      pct1Only: safePct(toInt(row.mc_1only), sgaTerminal),
      smsPct: safePct(toInt(row.mc_has_sms), sgaTerminal),
      linkedInPct: safePct(toInt(row.mc_has_linkedin), sgaTerminal),
      callPct: safePct(toInt(row.mc_has_call), sgaTerminal),
      emailPct: safePct(toInt(row.mc_has_email), sgaTerminal),
      zeroTouchCount: toInt(row.zero_touch_count),
      zeroTouchPct: safePct(toInt(row.zero_touch_count), sgaTotal),
      zeroTouchStillOpen: toInt(row.zero_touch_open),
      zeroTouchClosed: toInt(row.zero_touch_closed),
      sgaStartDate: callsData ? extractDateValue(callsData.sga_start_date) : '',
      eligibleWeeks: callsData ? toInt(callsData.eligible_weeks) : 0,
      totalInitialCalls: callsData ? toInt(callsData.total_initial_calls) : 0,
      avgInitialPerWeek: callsData ? toFloat(callsData.avg_initial_per_week) : 0,
      totalQualCalls: callsData ? toInt(callsData.total_qual_calls) : 0,
      avgQualPerWeek: callsData ? toFloat(callsData.avg_qual_per_week) : 0,
    };
  });

  let campaignSummary: CampaignSummaryData | null = null;
  if (campaignRows && campaignRows.length > 0) {
    const cr = campaignRows[0];
    campaignSummary = {
      campaignName: String(cr.campaign_name || ''),
      totalLeads: toInt(cr.total_leads),
      contactedLeads: toInt(cr.contacted_leads),
      avgTouchesBeforeClose: toFloat(cr.avg_touches),
      pct5PlusTouchpoints: toFloat(cr.pct_5plus),
      multiChannelPct: toFloat(cr.multi_channel_pct),
    };
  }

  return {
    persistence,
    avgTouches,
    multiChannel,
    zeroTouch,
    avgCalls,
    sgaBreakdown,
    campaignSummary,
  };
}

// ============================================
// DRILL-DOWN: Lead-level
// ============================================

function buildColumnFilterClause(columnFilter?: string | null, zeroTouchMode?: string): string {
  if (!columnFilter) return '';
  const ztStale = zeroTouchMode === 'stale' ? buildZeroTouchStaleFilter('cl') : '';
  switch (columnFilter) {
    case 'assigned': return ''; // all leads for this SGA
    case 'worked': return 'AND cl.is_worked';
    case 'badLeads': return "AND cl.Disposition__c IN ('Not a Fit', 'Bad Contact Info - Uncontacted', 'Bad Lead Provided', 'Wrong Phone Number - Contacted')";
    case 'mql': return 'AND cl.is_mql = 1';
    case 'sql': return 'AND cl.is_sql = 1';
    case 'sqo': return 'AND cl.is_sqo_unique = 1';
    case 'replied': return "AND cl.lead_status = 'Replied'";
    case 'unengaged': return "AND cl.lead_status = 'Unengaged'";
    case 'fivePlus': return "AND cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.outbound_touchpoints >= 5";
    case 'terminalUnengaged': return "AND cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting)";
    case 'premature': return "AND cl.lead_status = 'Unengaged' AND cl.is_worked AND NOT cl.is_bad_lead AND (cl.is_terminal OR cl.is_in_contacting) AND cl.outbound_touchpoints < 5";
    case 'zeroTouchOpen': return `AND cl.outbound_touchpoints = 0 AND cl.is_contacted = 0 AND NOT cl.is_bad_lead AND cl.lead_status = 'Unengaged' AND COALESCE(cl.Disposition__c, '') != 'No Response' ${ztStale} AND cl.is_open`;
    case 'zeroTouchClosed': return `AND cl.outbound_touchpoints = 0 AND cl.is_contacted = 0 AND NOT cl.is_bad_lead AND cl.lead_status = 'Unengaged' AND COALESCE(cl.Disposition__c, '') != 'No Response' ${ztStale} AND NOT cl.is_open`;
    default: return '';
  }
}

// Event-date drill-down for MQL/SQL/SQO — queries by event timestamp, not FilterDate
function buildEventDateDrillDown(
  columnFilter: string,
  sgaFilter: string,
  campaignFilter: string
): { dateClause: string; selectSuffix: string } {
  switch (columnFilter) {
    case 'mql':
      return {
        dateClause: `AND f.mql_stage_entered_ts IS NOT NULL
          AND TIMESTAMP(f.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(f.mql_stage_entered_ts) <= TIMESTAMP(@endDateTs)`,
        selectSuffix: "CASE WHEN f.is_sql = 1 THEN 'Converted' WHEN f.is_mql = 1 THEN 'MQL' ELSE 'Unknown' END",
      };
    case 'sql':
      return {
        dateClause: `AND f.converted_date_raw IS NOT NULL
          AND DATE(f.converted_date_raw) >= DATE(@startDate)
          AND DATE(f.converted_date_raw) <= DATE(@endDate)
          AND f.is_sql = 1`,
        selectSuffix: "CASE WHEN f.is_sqo_unique = 1 THEN 'SQO' ELSE 'SQL' END",
      };
    case 'sqo':
      return {
        dateClause: `AND f.Date_Became_SQO__c IS NOT NULL
          AND TIMESTAMP(f.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(f.Date_Became_SQO__c) <= TIMESTAMP(@endDateTs)
          AND f.recordtypeid = '012Dn000000mrO3IAI'
          AND f.is_sqo_unique = 1`,
        selectSuffix: "'SQO'",
      };
    default:
      return { dateClause: '', selectSuffix: "'Unknown'" };
  }
}

async function _getOutreachLeadDrillDown(
  filters: OutreachEffectivenessFilters,
  sgaName: string,
  statusFilter?: string | null,
  page: number = 1,
  pageSize: number = 100,
  columnFilter?: string | null
): Promise<{ records: OutreachLeadRecord[]; total: number }> {
  const params = buildParams(filters);
  params.sgaName = sgaName;
  params.pageSize = pageSize;
  params.offset = (page - 1) * pageSize;

  const sgaFilter = buildSgaFilter(filters);
  const campaignFilter = buildCampaignFilter(filters);

  // MQL/SQL/SQO use event-date queries (matches funnel performance page)
  if (columnFilter && ['mql', 'sql', 'sqo'].includes(columnFilter)) {
    const { dateClause, selectSuffix } = buildEventDateDrillDown(columnFilter, sgaFilter, campaignFilter);

    const query = `
      SELECT
        f.Full_prospect_id__c AS prospect_id,
        f.advisor_name,
        TRIM(f.SGA_Owner_Name__c) AS sga_name,
        0 AS outbound_touchpoints,
        '' AS channels_used,
        NULL AS days_in_contacting,
        ${selectSuffix} AS lead_status,
        f.Campaign_Name__c AS campaign_name,
        f.Disposition__c AS disposition,
        CONCAT('https://savvywealth.lightning.force.com/', f.Full_prospect_id__c) AS salesforce_url,
        f.Full_Opportunity_ID__c AS opportunity_id
      FROM \`${FUNNEL_VIEW}\` f
      WHERE TRIM(f.SGA_Owner_Name__c) = @sgaName
        AND f.Full_prospect_id__c IS NOT NULL
        ${dateClause}
        ${campaignFilter}
      ORDER BY f.advisor_name
      LIMIT @pageSize OFFSET @offset
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM \`${FUNNEL_VIEW}\` f
      WHERE TRIM(f.SGA_Owner_Name__c) = @sgaName
        AND f.Full_prospect_id__c IS NOT NULL
        ${dateClause}
        ${campaignFilter}
    `;

    const [rows, countRows] = await Promise.all([
      runQuery<any>(query, params),
      runQuery<any>(countQuery, params),
    ]);

    const records: OutreachLeadRecord[] = rows.map((r: any) => ({
      prospectId: String(r.prospect_id || ''),
      advisorName: String(r.advisor_name || ''),
      sgaName: String(r.sga_name || ''),
      outboundTouchpoints: parseInt(String(r.outbound_touchpoints || 0)) || 0,
      channelsUsed: String(r.channels_used || ''),
      daysInContacting: null,
      status: String(r.lead_status || 'Unknown') as OutreachLeadRecord['status'],
      campaignName: r.campaign_name ? String(r.campaign_name) : null,
      disposition: r.disposition ? String(r.disposition) : null,
      salesforceUrl: String(r.salesforce_url || ''),
      opportunityId: r.opportunity_id ? String(r.opportunity_id) : null,
    }));

    return {
      records,
      total: parseInt(String(countRows[0]?.total || 0)) || 0,
    };
  }

  // All other drill-downs use classified_leads CTE (FilterDate-based)
  const sharedCTE = buildSharedCTE(sgaFilter, campaignFilter);
  const filterClause = buildColumnFilterClause(columnFilter, filters.zeroTouchMode) || (statusFilter ? `AND cl.lead_status = '${statusFilter}'` : '');

  const query = `
    ${sharedCTE}
    SELECT
      cl.Full_prospect_id__c AS prospect_id,
      cl.advisor_name,
      cl.SGA_Owner_Name__c AS sga_name,
      cl.outbound_touchpoints,
      ARRAY_TO_STRING(ARRAY(
        SELECT channel FROM UNNEST([
          IF(cl.has_sms = 1, 'SMS', NULL),
          IF(cl.has_linkedin = 1, 'LinkedIn', NULL),
          IF(cl.has_call = 1, 'Call', NULL),
          IF(cl.has_email_any = 1, 'Email', NULL)
        ]) AS channel WHERE channel IS NOT NULL
      ), ', ') AS channels_used,
      cl.days_in_contacting,
      cl.lead_status,
      cl.Campaign_Name__c AS campaign_name,
      cl.Disposition__c AS disposition,
      CONCAT('https://savvywealth.lightning.force.com/', cl.Full_prospect_id__c) AS salesforce_url,
      cl.Full_Opportunity_ID__c AS opportunity_id
    FROM classified_leads cl
    WHERE cl.SGA_Owner_Name__c = @sgaName
      ${filterClause}
    ORDER BY cl.outbound_touchpoints DESC
    LIMIT @pageSize OFFSET @offset
  `;

  const countQuery = `
    ${sharedCTE}
    SELECT COUNT(*) AS total
    FROM classified_leads cl
    WHERE cl.SGA_Owner_Name__c = @sgaName
      ${filterClause}
  `;

  const [rows, countRows] = await Promise.all([
    runQuery<any>(query, params),
    runQuery<any>(countQuery, params),
  ]);

  const records: OutreachLeadRecord[] = rows.map((r: any) => ({
    prospectId: String(r.prospect_id || ''),
    advisorName: String(r.advisor_name || ''),
    sgaName: String(r.sga_name || ''),
    outboundTouchpoints: parseInt(String(r.outbound_touchpoints || 0)) || 0,
    channelsUsed: String(r.channels_used || ''),
    daysInContacting: r.days_in_contacting != null ? parseInt(String(r.days_in_contacting)) || 0 : null,
    status: String(r.lead_status || 'Unengaged') as OutreachLeadRecord['status'],
    campaignName: r.campaign_name ? String(r.campaign_name) : null,
    disposition: r.disposition ? String(r.disposition) : null,
    salesforceUrl: String(r.salesforce_url || ''),
    opportunityId: r.opportunity_id ? String(r.opportunity_id) : null,
  }));

  return {
    records,
    total: parseInt(String(countRows[0]?.total || 0)) || 0,
  };
}

// ============================================
// DRILL-DOWN: Zero-Touch
// ============================================

async function _getZeroTouchDrillDown(
  filters: OutreachEffectivenessFilters,
  sgaName: string,
  page: number = 1,
  pageSize: number = 100
): Promise<{ records: ZeroTouchLeadRecord[]; total: number }> {
  const params = buildParams(filters);
  params.sgaName = sgaName;
  params.pageSize = pageSize;
  params.offset = (page - 1) * pageSize;

  const sgaFilter = buildSgaFilter(filters);
  const campaignFilter = buildCampaignFilter(filters);
  const sharedCTE = buildSharedCTE(sgaFilter, campaignFilter);
  const ztStaleCl = filters.zeroTouchMode === 'stale' ? buildZeroTouchStaleFilter('cl') : '';

  const query = `
    ${sharedCTE}
    SELECT
      cl.Full_prospect_id__c AS prospect_id,
      cl.advisor_name,
      cl.SGA_Owner_Name__c AS sga_name,
      DATE_DIFF(CURRENT_DATE('America/New_York'), cl.filter_date, DAY) AS days_since_assignment,
      COALESCE(cl.TOF_Stage, 'Unknown') AS current_stage,
      cl.Disposition__c AS disposition,
      cl.Campaign_Name__c AS campaign_name,
      cl.is_open,
      CONCAT('https://savvywealth.lightning.force.com/', cl.Full_prospect_id__c) AS salesforce_url,
      cl.Full_Opportunity_ID__c AS opportunity_id
    FROM classified_leads cl
    WHERE cl.SGA_Owner_Name__c = @sgaName
      AND cl.outbound_touchpoints = 0
      AND cl.is_contacted = 0
      AND NOT cl.is_bad_lead
      AND cl.lead_status = 'Unengaged'
      AND COALESCE(cl.Disposition__c, '') != 'No Response'
      ${ztStaleCl}
    ORDER BY days_since_assignment DESC
    LIMIT @pageSize OFFSET @offset
  `;

  const countQuery = `
    ${sharedCTE}
    SELECT COUNT(*) AS total
    FROM classified_leads cl
    WHERE cl.SGA_Owner_Name__c = @sgaName
      AND cl.outbound_touchpoints = 0
      AND cl.is_contacted = 0
      AND NOT cl.is_bad_lead
      AND cl.lead_status = 'Unengaged'
      AND COALESCE(cl.Disposition__c, '') != 'No Response'
      ${ztStaleCl}
  `;

  const [rows, countRows] = await Promise.all([
    runQuery<any>(query, params),
    runQuery<any>(countQuery, params),
  ]);

  const records: ZeroTouchLeadRecord[] = rows.map((r: any) => ({
    prospectId: String(r.prospect_id || ''),
    advisorName: String(r.advisor_name || ''),
    sgaName: String(r.sga_name || ''),
    daysSinceAssignment: parseInt(String(r.days_since_assignment || 0)) || 0,
    currentStage: String(r.current_stage || ''),
    disposition: r.disposition ? String(r.disposition) : null,
    campaignName: r.campaign_name ? String(r.campaign_name) : null,
    isOpen: Boolean(r.is_open),
    salesforceUrl: String(r.salesforce_url || ''),
    opportunityId: r.opportunity_id ? String(r.opportunity_id) : null,
  }));

  return {
    records,
    total: parseInt(String(countRows[0]?.total || 0)) || 0,
  };
}

// ============================================
// DRILL-DOWN: Weekly Calls
// ============================================

async function _getWeeklyCallsDrillDown(
  filters: OutreachEffectivenessFilters,
  sgaName: string
): Promise<WeeklyCallBreakdownRow[]> {
  const params = buildParams(filters);
  params.sgaName = sgaName;

  const query = `
    WITH sga_info AS (
      SELECT TRIM(u.Name) AS sga_name, DATE(u.CreatedDate) AS sga_start_date
      FROM \`${USER_TABLE}\` u
      WHERE TRIM(u.Name) = @sgaName
        AND u.IsSGA__c = TRUE
      LIMIT 1
    ),
    week_series AS (
      SELECT
        s.sga_name,
        week_start
      FROM sga_info s
      CROSS JOIN UNNEST(
        GENERATE_DATE_ARRAY(
          GREATEST(DATE_TRUNC(@startDate, WEEK(MONDAY)), DATE_TRUNC(s.sga_start_date, WEEK(MONDAY))),
          DATE_TRUNC(@endDate, WEEK(MONDAY)),
          INTERVAL 1 WEEK
        )
      ) AS week_start
      WHERE week_start >= DATE_TRUNC(s.sga_start_date, WEEK(MONDAY))
    ),
    initial_call_events AS (
      SELECT
        TRIM(f.SGA_Owner_Name__c) AS sga_name,
        DATE_TRUNC(f.Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) AS week_start,
        COUNT(*) AS call_count
      FROM \`${FUNNEL_VIEW}\` f
      WHERE TRIM(f.SGA_Owner_Name__c) = @sgaName
        AND f.Initial_Call_Scheduled_Date__c BETWEEN @startDate AND @endDate
        AND f.Initial_Call_Scheduled_Date__c IS NOT NULL
      GROUP BY 1, 2
    ),
    qual_call_events AS (
      SELECT
        TRIM(f.SGA_Owner_Name__c) AS sga_name,
        DATE_TRUNC(f.Qualification_Call_Date__c, WEEK(MONDAY)) AS week_start,
        COUNT(*) AS call_count
      FROM \`${FUNNEL_VIEW}\` f
      WHERE TRIM(f.SGA_Owner_Name__c) = @sgaName
        AND f.Qualification_Call_Date__c BETWEEN @startDate AND @endDate
        AND f.Qualification_Call_Date__c IS NOT NULL
      GROUP BY 1, 2
    )
    SELECT
      ws.sga_name,
      FORMAT_DATE('%Y-%m-%d', ws.week_start) AS week_starting,
      COALESCE(ic.call_count, 0) AS initial_calls,
      COALESCE(qc.call_count, 0) AS qual_calls
    FROM week_series ws
    LEFT JOIN initial_call_events ic ON ws.sga_name = ic.sga_name AND ws.week_start = ic.week_start
    LEFT JOIN qual_call_events qc ON ws.sga_name = qc.sga_name AND ws.week_start = qc.week_start
    ORDER BY ws.week_start ASC
  `;

  const rows = await runQuery<any>(query, params);
  return rows.map((r: any) => ({
    sgaName: String(r.sga_name || ''),
    weekStarting: String(r.week_starting || ''),
    initialCalls: parseInt(String(r.initial_calls || 0)) || 0,
    qualCalls: parseInt(String(r.qual_calls || 0)) || 0,
  }));
}

// ============================================
// FILTER OPTIONS
// ============================================

async function _getOutreachFilterOptions(): Promise<OutreachFilterOptions> {
  const sgasQuery = `
    SELECT DISTINCT
      TRIM(u.Name) AS value,
      TRIM(u.Name) AS label,
      COALESCE(u.IsActive, FALSE) AS isActive
    FROM \`${USER_TABLE}\` u
    WHERE u.IsSGA__c = TRUE
      AND u.Name NOT IN (${SGA_EXCLUSION_LIST})
    ORDER BY value
  `;

  const campaignsQuery = `
    SELECT DISTINCT
      f.Campaign_Id__c AS value,
      f.Campaign_Name__c AS label
    FROM \`${FUNNEL_VIEW}\` f
    WHERE f.Campaign_Id__c IS NOT NULL
      AND f.Campaign_Name__c IS NOT NULL
    ORDER BY label ASC
  `;

  const [sgaRows, campaignRows] = await Promise.all([
    runQuery<any>(sgasQuery),
    runQuery<any>(campaignsQuery),
  ]);

  // Prepend synthetic campaign chips to the real-campaign list. These are not
  // actual Salesforce campaigns — the backend (buildCampaignFilter) detects
  // them via reserved sentinel IDs and expands each to a different SQL
  // predicate. Surfacing them inside the same multi-select keeps the UX a
  // single control; the user can combine "Self Sourced" with real campaigns
  // to union the result sets.
  const SYNTHETIC_CAMPAIGNS = [
    { value: '__self_sourced__', label: 'Self Sourced (LinkedIn + FinTrx)' },
  ];

  return {
    sgas: sgaRows.map((r: any) => ({
      value: String(r.value || ''),
      label: String(r.label || ''),
      isActive: Boolean(r.isActive),
    })),
    campaigns: [
      ...SYNTHETIC_CAMPAIGNS,
      ...campaignRows.map((r: any) => ({
        value: String(r.value || ''),
        label: String(r.label || ''),
      })),
    ],
  };
}

// ============================================
// CACHE EXPORTS
// ============================================

export const getOutreachDashboard = cachedQuery(
  _getOutreachDashboard,
  'getOutreachDashboard',
  CACHE_TAGS.SGA_HUB
);

export const getOutreachFilterOptions = cachedQuery(
  _getOutreachFilterOptions,
  'getOutreachFilterOptions',
  CACHE_TAGS.SGA_HUB
);

export const getOutreachLeadDrillDown = cachedQuery(
  _getOutreachLeadDrillDown,
  'getOutreachLeadDrillDown',
  CACHE_TAGS.SGA_HUB
);

export const getZeroTouchDrillDown = cachedQuery(
  _getZeroTouchDrillDown,
  'getZeroTouchDrillDown',
  CACHE_TAGS.SGA_HUB
);

export const getWeeklyCallsDrillDown = cachedQuery(
  _getWeeklyCallsDrillDown,
  'getWeeklyCallsDrillDown',
  CACHE_TAGS.SGA_HUB
);
