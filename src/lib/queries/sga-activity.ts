import { runQuery } from '@/lib/bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { logger } from '@/lib/logger';
import {
  SGAActivityFilters,
  ScheduledCallsSummary,
  ScheduledCallRecord,
  SMSResponseRate,
  CallAnswerRate,
  ActivityRecord,
  ActivityChannel,
  DayCount,
  SGACallCount,
  SGADayCount,
  ActivityBreakdownRow,
  ActivityBreakdownWeekBounds,
  TrailingWeeksOption,
  ActivityBreakdownDrillDownRecord,
  ActivityBreakdownAuditRow,
} from '@/types/sga-activity';

const ACTIVITY_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance';
const FUNNEL_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';

// Shared metric classification CASE — must be identical in aggregation, drilldown, and export
// Scheduled Call = outbound call on the day Initial_Call_Scheduled_Date__c matches
// Cold Call = any other outbound call (no scheduled date or date doesn't match)
const METRIC_CASE_EXPRESSION = `
  CASE
    WHEN a.activity_channel_group = 'Call' AND a.direction = 'Outbound'
      AND a.Initial_Call_Scheduled_Date__c IS NOT NULL
      AND a.task_created_date_est = DATE(a.Initial_Call_Scheduled_Date__c)
      AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%' THEN 'Scheduled_Call'
    WHEN a.activity_channel_group = 'Call' AND a.direction = 'Outbound'
      AND (a.Initial_Call_Scheduled_Date__c IS NULL OR a.task_created_date_est != DATE(a.Initial_Call_Scheduled_Date__c))
      AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%' THEN 'Cold_Call'
    WHEN a.activity_channel_group = 'SMS' AND a.direction = 'Outbound' THEN 'Outbound_SMS'
    WHEN a.activity_channel_group = 'LinkedIn' THEN 'LinkedIn'
    WHEN a.activity_channel_group = 'Email' AND COALESCE(a.is_engagement_tracking, 0) = 0 AND COALESCE(a.is_marketing_activity, 0) = 0 THEN 'Manual_Email'
    WHEN a.activity_channel_group = 'Email (Engagement)' OR (a.activity_channel_group = 'Email' AND a.is_engagement_tracking = 1) THEN 'Email_Engagement'
    ELSE NULL
  END`;

const ACTIVE_SGAS_CTE = `
  active_sgas AS (
    SELECT TRIM(u.Name) as sga_name
    FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
    WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
      AND u.Name NOT IN (
        'Anett Diaz', 'Ariana Butler', 'Bre McDaniel', 'Bryan Belville',
        'GinaRose Galli', 'Jacqueline Tully', 'Jed Entin', 'Russell Moss',
        'Savvy Marketing', 'Savvy Operations', 'Lauren George'
      )
  )`;

const WEEK_BOUNDS_CTE = `
  week_bounds AS (
    SELECT
      DATE_TRUNC(CURRENT_DATE('America/New_York'), WEEK(MONDAY)) AS this_week_start,
      DATE_ADD(DATE_TRUNC(CURRENT_DATE('America/New_York'), WEEK(MONDAY)), INTERVAL 6 DAY) AS this_week_end,
      DATE_SUB(DATE_TRUNC(CURRENT_DATE('America/New_York'), WEEK(MONDAY)), INTERVAL 7 DAY) AS last_week_start,
      DATE_SUB(DATE_TRUNC(CURRENT_DATE('America/New_York'), WEEK(MONDAY)), INTERVAL 1 DAY) AS last_week_end
  )`;

// ============================================
// HELPER: Get Week Boundaries
// ============================================

function getWeekBoundaries(weekType: 'this_week' | 'next_week'): { start: string; end: string } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sunday, 1=Monday, etc.
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() + mondayOffset);
  thisMonday.setHours(0, 0, 0, 0);
  
  const thisSunday = new Date(thisMonday);
  thisSunday.setDate(thisMonday.getDate() + 6);
  
  if (weekType === 'this_week') {
    return {
      start: thisMonday.toISOString().split('T')[0],
      end: thisSunday.toISOString().split('T')[0],
    };
  } else {
    const nextMonday = new Date(thisMonday);
    nextMonday.setDate(thisMonday.getDate() + 7);
    const nextSunday = new Date(nextMonday);
    nextSunday.setDate(nextMonday.getDate() + 6);
    return {
      start: nextMonday.toISOString().split('T')[0],
      end: nextSunday.toISOString().split('T')[0],
    };
  }
}

// ============================================
// HELPER: Get Date Range from Filter Type
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
      // For "this week", only include dates up to today (not future dates)
      const weekBounds = getWeekBoundaries('this_week');
      return {
        start: weekBounds.start,
        end: today, // Cap to today, not the full week
      };
    }
    case 'next_week':
      return getWeekBoundaries('next_week');
    case 'last_30': {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { start: start.toISOString().split('T')[0], end: today };
    }
    case 'last_60': {
      const start = new Date(now);
      start.setDate(start.getDate() - 60);
      return { start: start.toISOString().split('T')[0], end: today };
    }
    case 'last_90': {
      const start = new Date(now);
      start.setDate(start.getDate() - 90);
      return { start: start.toISOString().split('T')[0], end: today };
    }
    case 'qtd': {
      const quarter = Math.floor(now.getMonth() / 3);
      const quarterStart = new Date(now.getFullYear(), quarter * 3, 1);
      return { start: quarterStart.toISOString().split('T')[0], end: today };
    }
    case 'all_time':
      return { start: '2023-01-01', end: today };
    case 'custom':
      if (customStart && customEnd) {
        return { start: customStart, end: customEnd };
      }
      // Fallback to last 30 days
      const fallbackStart = new Date(now);
      fallbackStart.setDate(fallbackStart.getDate() - 30);
      return { start: fallbackStart.toISOString().split('T')[0], end: today };
    default:
      return getWeekBoundaries('this_week');
  }
}

// ============================================
// HELPER: Build Automated Filter
// ============================================

function getAutomatedFilter(includeAutomated: boolean): string {
  if (includeAutomated) {
    return ''; // No filter, include everything
  }
  return `AND task_subject NOT LIKE '%[lemlist]%'
          AND COALESCE(task_subtype, '') != 'ListEmail'`;
}

// ============================================
// HELPER: Extract Date Value (for BigQuery DATE fields)
// ============================================

function extractDateValue(dateObj: any): string {
  if (!dateObj) return '';
  if (typeof dateObj === 'string') return dateObj;
  if (dateObj && typeof dateObj === 'object' && 'value' in dateObj) {
    return String(dateObj.value);
  }
  return String(dateObj);
}

// ============================================
// QUERY 1: Scheduled Initial Calls
// ============================================

export async function getScheduledInitialCalls(
  filters: SGAActivityFilters
): Promise<ScheduledCallsSummary> {
  const thisWeek = getWeekBoundaries('this_week');
  const nextWeek = getWeekBoundaries('next_week');
  
  const sgaFilter = filters.sga 
    ? `AND SGA_Owner_Name__c = @sga` 
    : '';
  
  const query = `
    WITH scheduled_calls AS (
      SELECT
        primary_key as id,
        advisor_name as prospect_name,
        SGA_Owner_Name__c as sga_name,
        Initial_Call_Scheduled_Date__c as scheduled_date,
        Original_source as source,
        Channel_Grouping_Name as channel,
        salesforce_url,
        Full_prospect_id__c as lead_id,
        Full_Opportunity_ID__c as opportunity_id,
        EXTRACT(DAYOFWEEK FROM Initial_Call_Scheduled_Date__c) as day_of_week,
        FORMAT_DATE('%A', Initial_Call_Scheduled_Date__c) as day_name,
        CASE 
          WHEN Initial_Call_Scheduled_Date__c >= @thisWeekStart 
               AND Initial_Call_Scheduled_Date__c <= @thisWeekEnd 
          THEN 'this_week'
          WHEN Initial_Call_Scheduled_Date__c >= @nextWeekStart 
               AND Initial_Call_Scheduled_Date__c <= @nextWeekEnd 
          THEN 'next_week'
          ELSE 'other'
        END as week_bucket
      FROM \`${FUNNEL_VIEW}\`
      WHERE Initial_Call_Scheduled_Date__c IS NOT NULL
        AND Initial_Call_Scheduled_Date__c >= @thisWeekStart
        AND Initial_Call_Scheduled_Date__c <= @nextWeekEnd
        AND SGA_Owner_Name__c != 'Anett Diaz'  -- Exclude Anett Diaz (not truly active SGA)
        AND SGA_Owner_Name__c != 'Jacqueline Tully'  -- Exclude Jacqueline Tully (not an SGA)
        ${sgaFilter}
    )
    SELECT
      week_bucket,
      day_of_week,
      day_name,
      DATE(scheduled_date) as scheduled_date,
      sga_name,
      COUNT(*) as call_count
    FROM scheduled_calls
    WHERE week_bucket IN ('this_week', 'next_week')
    GROUP BY week_bucket, day_of_week, day_name, scheduled_date, sga_name
    ORDER BY week_bucket, day_of_week, sga_name
  `;
  
  const params: Record<string, any> = {
    thisWeekStart: thisWeek.start,
    thisWeekEnd: thisWeek.end,
    nextWeekStart: nextWeek.start,
    nextWeekEnd: nextWeek.end,
  };
  
  if (filters.sga) {
    params.sga = filters.sga;
  }
  
  const rows = await runQuery<any>(query, params);
  
  // Process results into summary structure
  return await processScheduledCallsResults(rows, thisWeek, nextWeek, 'initial', filters.sga);
}

// ============================================
// QUERY 2: Scheduled Qualification Calls
// ============================================

export async function getScheduledQualificationCalls(
  filters: SGAActivityFilters
): Promise<ScheduledCallsSummary> {
  const thisWeek = getWeekBoundaries('this_week');
  const nextWeek = getWeekBoundaries('next_week');
  
  const sgaFilter = filters.sga 
    ? `AND SGA_Owner_Name__c = @sga` 
    : '';
  
  const query = `
    WITH scheduled_calls AS (
      SELECT
        COALESCE(Full_Opportunity_ID__c, primary_key) as id,
        advisor_name as prospect_name,
        SGA_Owner_Name__c as sga_name,
        Qualification_Call_Date__c as scheduled_date,
        Original_source as source,
        Channel_Grouping_Name as channel,
        salesforce_url,
        Full_prospect_id__c as lead_id,
        Full_Opportunity_ID__c as opportunity_id,
        EXTRACT(DAYOFWEEK FROM Qualification_Call_Date__c) as day_of_week,
        FORMAT_DATE('%A', Qualification_Call_Date__c) as day_name,
        CASE 
          WHEN Qualification_Call_Date__c >= @thisWeekStart 
               AND Qualification_Call_Date__c <= @thisWeekEnd 
          THEN 'this_week'
          WHEN Qualification_Call_Date__c >= @nextWeekStart 
               AND Qualification_Call_Date__c <= @nextWeekEnd 
          THEN 'next_week'
          ELSE 'other'
        END as week_bucket
      FROM \`${FUNNEL_VIEW}\`
      WHERE Qualification_Call_Date__c IS NOT NULL
        AND Qualification_Call_Date__c >= @thisWeekStart
        AND Qualification_Call_Date__c <= @nextWeekEnd
        AND SGA_Owner_Name__c != 'Anett Diaz'  -- Exclude Anett Diaz (not truly active SGA)
        AND SGA_Owner_Name__c != 'Jacqueline Tully'  -- Exclude Jacqueline Tully (not an SGA)
        ${sgaFilter}
    )
    SELECT
      week_bucket,
      day_of_week,
      day_name,
      DATE(scheduled_date) as scheduled_date,
      sga_name,
      COUNT(*) as call_count
    FROM scheduled_calls
    WHERE week_bucket IN ('this_week', 'next_week')
    GROUP BY week_bucket, day_of_week, day_name, scheduled_date, sga_name
    ORDER BY week_bucket, day_of_week, sga_name
  `;
  
  const params: Record<string, any> = {
    thisWeekStart: thisWeek.start,
    thisWeekEnd: thisWeek.end,
    nextWeekStart: nextWeek.start,
    nextWeekEnd: nextWeek.end,
  };
  
  if (filters.sga) {
    params.sga = filters.sga;
  }
  
  const rows = await runQuery<any>(query, params);
  
  return await processScheduledCallsResults(rows, thisWeek, nextWeek, 'qualification', filters.sga);
}

async function processScheduledCallsResults(
  rows: any[],
  thisWeek: { start: string; end: string },
  nextWeek: { start: string; end: string },
  callType: 'initial' | 'qualification',
  sgaFilter?: string | null
): Promise<ScheduledCallsSummary> {
  const thisWeekData = rows.filter(r => r.week_bucket === 'this_week');
  const nextWeekData = rows.filter(r => r.week_bucket === 'next_week');
  
  // Aggregate by day
  const thisWeekByDay = aggregateByDay(thisWeekData);
  const nextWeekByDay = aggregateByDay(nextWeekData);
  
  // Aggregate by SGA - filter by SGA if provided
  const thisWeekBySGA = await aggregateBySGA(thisWeekData, nextWeekData, callType, sgaFilter);
  
  // Aggregate by SGA and day
  const thisWeekBySGADay = aggregateBySGADay(thisWeekData);
  const nextWeekBySGADay = aggregateBySGADay(nextWeekData);
  
  return {
    thisWeek: {
      total: thisWeekData.reduce((sum, r) => sum + parseInt(r.call_count), 0),
      byDay: thisWeekByDay,
      bySGA: thisWeekBySGA,
      bySGADay: thisWeekBySGADay,
    },
    nextWeek: {
      total: nextWeekData.reduce((sum, r) => sum + parseInt(r.call_count), 0),
      byDay: nextWeekByDay,
      bySGA: thisWeekBySGA.map(s => ({ 
        sgaName: s.sgaName,
        thisWeek: 0,
        nextWeek: s.nextWeek,
        total: s.total 
      })),
      bySGADay: nextWeekBySGADay,
    },
  };
}

// Convert BigQuery DAYOFWEEK (1=Sun, 2=Mon, ..., 7=Sat) to UI format (0=Sun, 1=Mon, ..., 6=Sat)
function convertBigQueryDayToUI(bqDay: number): number {
  // BigQuery: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat
  // UI: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  if (bqDay === 1) return 0; // Sunday
  return bqDay - 1; // Monday-Saturday: 2->1, 3->2, 4->3, 5->4, 6->5, 7->6
}

function aggregateByDay(rows: any[]): DayCount[] {
  const dayMap = new Map<number, DayCount>();
  
  for (const row of rows) {
    const bqDayOfWeek = parseInt(row.day_of_week);
    const uiDayOfWeek = convertBigQueryDayToUI(bqDayOfWeek);
    const existing = dayMap.get(uiDayOfWeek);
    if (existing) {
      existing.count += parseInt(row.call_count);
    } else {
      dayMap.set(uiDayOfWeek, {
        dayOfWeek: uiDayOfWeek, // Store in UI format
        dayName: row.day_name,
        count: parseInt(row.call_count),
      });
    }
  }
  
  return Array.from(dayMap.values()).sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

function aggregateBySGADay(rows: any[]): SGADayCount[] {
  const sgaDayMap = new Map<string, SGADayCount>();
  
  for (const row of rows) {
    const sgaName = row.sga_name;
    const bqDayOfWeek = parseInt(row.day_of_week);
    const uiDayOfWeek = convertBigQueryDayToUI(bqDayOfWeek);
    const key = `${sgaName}_${uiDayOfWeek}`;
    
    const existing = sgaDayMap.get(key);
    if (existing) {
      existing.count += parseInt(row.call_count);
    } else {
      sgaDayMap.set(key, {
        sgaName,
        dayOfWeek: uiDayOfWeek, // Store in UI format
        dayName: row.day_name,
        count: parseInt(row.call_count),
      });
    }
  }
  
  return Array.from(sgaDayMap.values()).sort((a, b) => {
    // Sort by SGA name first, then by day of week
    const sgaCompare = a.sgaName.localeCompare(b.sgaName);
    if (sgaCompare !== 0) return sgaCompare;
    return a.dayOfWeek - b.dayOfWeek;
  });
}

async function aggregateBySGA(
  thisWeekRows: any[], 
  nextWeekRows: any[],
  callType: 'initial' | 'qualification',
  sgaFilter?: string | null
): Promise<SGACallCount[]> {
  const sgaMap = new Map<string, SGACallCount>();
  
  // If SGA filter is set, only include that SGA
  if (sgaFilter) {
    // Only initialize the filtered SGA
    sgaMap.set(sgaFilter, {
      sgaName: sgaFilter,
      thisWeek: 0,
      nextWeek: 0,
      total: 0,
    });
  } else {
    // Get all active SGAs (excluding Anett Diaz)
    const activeSGAsQuery = `
      SELECT DISTINCT
        u.Name as sga_name
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.IsSGA__c = TRUE
        AND u.IsActive = TRUE
        AND u.Name != 'Anett Diaz'
        AND u.Name != 'Jacqueline Tully'
        AND u.Name != 'Savvy Operations'
        AND u.Name != 'Savvy Marketing'
        AND u.Name != 'Russell Moss'
        AND u.Name != 'Jed Entin'
      ORDER BY u.Name
    `;
    
    const activeSGARows = await runQuery<any>(activeSGAsQuery);
    const allActiveSGAs = activeSGARows.map(r => r.sga_name);
    
    // Initialize all active SGAs with 0 counts
    for (const sgaName of allActiveSGAs) {
      sgaMap.set(sgaName, {
        sgaName,
        thisWeek: 0,
        nextWeek: 0,
        total: 0,
      });
    }
  }
  
  const excludedSgas = ['Anett Diaz', 'Jacqueline Tully'];

  // Add this week data
  for (const row of thisWeekRows) {
    const sgaName = row.sga_name;
    if (!sgaName || excludedSgas.includes(sgaName)) continue;
    const existing = sgaMap.get(sgaName);
    if (existing) {
      existing.thisWeek += parseInt(row.call_count);
      existing.total += parseInt(row.call_count);
    } else {
      if (!excludedSgas.includes(sgaName)) {
        sgaMap.set(sgaName, {
          sgaName,
          thisWeek: parseInt(row.call_count),
          nextWeek: 0,
          total: parseInt(row.call_count),
        });
      }
    }
  }

  // Add next week data
  for (const row of nextWeekRows) {
    const sgaName = row.sga_name;
    if (!sgaName || excludedSgas.includes(sgaName)) continue;
    const existing = sgaMap.get(sgaName);
    if (existing) {
      existing.nextWeek += parseInt(row.call_count);
      existing.total += parseInt(row.call_count);
    } else {
      const current = sgaMap.get(sgaName);
      if (current) {
        current.nextWeek += parseInt(row.call_count);
        current.total += parseInt(row.call_count);
      } else {
        if (!excludedSgas.includes(sgaName)) {
          sgaMap.set(sgaName, {
            sgaName,
            thisWeek: 0,
            nextWeek: parseInt(row.call_count),
            total: parseInt(row.call_count),
          });
        }
      }
    }
  }
  
  // Sort alphabetically by first name
  return Array.from(sgaMap.values()).sort((a, b) => {
    const aFirst = a.sgaName.split(' ')[0];
    const bFirst = b.sgaName.split(' ')[0];
    return aFirst.localeCompare(bFirst);
  });
}

// ============================================
// QUERY 3: Scheduled Call Drill-Down Records
// ============================================

export async function getScheduledCallRecords(
  filters: SGAActivityFilters,
  callType: 'initial' | 'qualification',
  weekType: 'this_week' | 'next_week',
  dayOfWeek?: number,
  sgaName?: string
): Promise<{ records: ScheduledCallRecord[]; total: number }> {
  const week = getWeekBoundaries(weekType);
  const dateField = callType === 'initial' 
    ? 'Initial_Call_Scheduled_Date__c' 
    : 'Qualification_Call_Date__c';
  
  const dayFilter = dayOfWeek !== undefined
    ? `AND EXTRACT(DAYOFWEEK FROM ${dateField}) = @dayOfWeek` 
    : '';
  const sgaFilter = sgaName 
    ? `AND SGA_Owner_Name__c = @sgaName` 
    : '';
  
  // Main query to get records
  const query = `
    SELECT
      COALESCE(Full_Opportunity_ID__c, primary_key) as id,
      advisor_name as prospectName,
      SGA_Owner_Name__c as sgaName,
      ${dateField} as scheduledDate,
      Original_source as source,
      Channel_Grouping_Name as channel,
      salesforce_url as salesforceUrl,
      Full_prospect_id__c as leadId,
      Full_Opportunity_ID__c as opportunityId
    FROM \`${FUNNEL_VIEW}\`
    WHERE ${dateField} IS NOT NULL
      AND ${dateField} >= @startDate
      AND ${dateField} <= @endDate
      AND SGA_Owner_Name__c != 'Anett Diaz'  -- Exclude Anett Diaz (not truly active SGA)
      AND SGA_Owner_Name__c != 'Jacqueline Tully'  -- Exclude Jacqueline Tully (not an SGA)
      ${dayFilter}
      ${sgaFilter}
    ORDER BY ${dateField}, sgaName
  `;
  
  // Count query to get total
  const countQuery = `
    SELECT COUNT(*) as total
    FROM \`${FUNNEL_VIEW}\`
    WHERE ${dateField} IS NOT NULL
      AND ${dateField} >= @startDate
      AND ${dateField} <= @endDate
      AND SGA_Owner_Name__c != 'Anett Diaz'  -- Exclude Anett Diaz (not truly active SGA)
      AND SGA_Owner_Name__c != 'Jacqueline Tully'  -- Exclude Jacqueline Tully (not an SGA)
      ${dayFilter}
      ${sgaFilter}
  `;
  
  const params: Record<string, any> = {
    startDate: week.start,
    endDate: week.end,
  };
  
  if (dayOfWeek !== undefined) {
    params.dayOfWeek = dayOfWeek;
  }
  if (sgaName) {
    params.sgaName = sgaName;
  }
  
  const [rows, countRows] = await Promise.all([
    runQuery<any>(query, params),
    runQuery<any>(countQuery, params),
  ]);
  
  const total = parseInt(String(countRows[0]?.total || 0)) || 0;
  
  // Extract date values from BigQuery DATE objects
  const records = rows.map(row => ({
    ...row,
    scheduledDate: extractDateValue(row.scheduledDate),
  }));
  
  return { records, total };
}

// ============================================
// QUERY 4: Activity Distribution by Day of Week
// ============================================

export async function getActivityDistribution(
  filters: SGAActivityFilters
): Promise<any[]> {
  // Use Period A/B if set, otherwise use main filters (handled by API route)
  const currentRange = getDateRange(
    filters.dateRangeType,
    filters.startDate,
    filters.endDate
  );
  const comparisonRange = getDateRange(
    filters.comparisonDateRangeType,
    filters.comparisonStartDate,
    filters.comparisonEndDate
  );
  
  const automatedFilter = getAutomatedFilter(filters.includeAutomated);
  const sgaFilter = filters.sga 
    ? `AND task_executor_name = @sga` 
    : '';
  
  const query = `
    WITH view_data AS (
      SELECT DISTINCT
        task_id,
        task_created_date_est,
        activity_day_of_week,
        task_subject,
        task_subtype,
        activity_channel_group
      FROM \`${ACTIVITY_VIEW}\`
      WHERE (
          (task_created_date_est >= @currentStart AND task_created_date_est <= @currentEnd AND task_created_date_est <= CURRENT_DATE('America/New_York'))
          OR (task_created_date_est >= @comparisonStart AND task_created_date_est <= @comparisonEnd)
        )
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
    ),
    task_descriptions AS (
      SELECT
        t.Id as task_id,
        t.Description as task_description
      FROM \`savvy-gtm-analytics.SavvyGTMData.Task\` t
      WHERE t.IsDeleted = FALSE
        AND t.Id IN (SELECT task_id FROM view_data)
    ),
    classified_activities AS (
      SELECT DISTINCT
        v.task_id,
        v.task_created_date_est,
        v.activity_day_of_week,
        -- Use the SAME priority-based classification logic as getActivityRecords
        -- This ensures distribution counts match drilldown counts exactly
        CASE
          -- ============================================
          -- PRIORITY 1: EXPLICIT SUBJECT-BASED CLASSIFICATION (HIGHEST PRIORITY)
          -- ============================================
          WHEN v.task_subject = 'LinkedIn Message' THEN 'LinkedIn'
          WHEN v.task_subject = 'LinkedIn Connect' THEN 'LinkedIn'
          WHEN v.task_subject = 'Outgoing SMS' THEN 'SMS'
          WHEN v.task_subject = 'Incoming SMS' THEN 'SMS'
          
          -- ============================================
          -- PRIORITY 2: SUBJECT PATTERN MATCHING
          -- ============================================
          WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%linkedin%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%linked in%'
          THEN 'LinkedIn'
          WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%sms%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%text%'
          THEN 'SMS'
          
          -- ============================================
          -- PRIORITY 3: RAW CHANNEL GROUP (if subject is ambiguous)
          -- ============================================
          WHEN v.activity_channel_group = 'SMS' THEN 'SMS'
          WHEN v.activity_channel_group = 'LinkedIn' THEN 'LinkedIn'
          WHEN v.activity_channel_group = 'Email' THEN 'Email'
          
          -- ============================================
          -- PRIORITY 4: DESCRIPTION-BASED (last resort)
          -- ============================================
          WHEN LOWER(COALESCE(td.task_description, '')) LIKE '%linkedin%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%sms%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%email%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%text%'
          THEN 'LinkedIn'
          WHEN LOWER(COALESCE(td.task_description, '')) LIKE '%sms%'
            OR LOWER(COALESCE(td.task_description, '')) LIKE '%text message%'
            OR LOWER(COALESCE(td.task_description, '')) LIKE '%text%'
          THEN 'SMS'
          
          -- ============================================
          -- PRIORITY 5: EMAIL CLASSIFICATION (only if Call and has email indicators)
          -- ============================================
          WHEN (LOWER(COALESCE(v.task_subject, '')) LIKE '%email%'
            OR LOWER(COALESCE(td.task_description, '')) LIKE '%email%')
            AND v.activity_channel_group = 'Call'
            AND v.activity_channel_group != 'SMS'
            AND v.activity_channel_group != 'LinkedIn'
            AND LOWER(COALESCE(v.task_subject, '')) NOT LIKE '%sms%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%sms%'
            AND LOWER(COALESCE(v.task_subject, '')) NOT LIKE '%text%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%text%'
            AND v.task_subject != 'LinkedIn Message'
            AND v.task_subject != 'Outgoing SMS'
            AND v.task_subject != 'Incoming SMS'
          THEN 'Email'
          
          -- ============================================
          -- ELSE: Preserve raw channel with safeguards
          -- ============================================
          ELSE CASE
            WHEN v.activity_channel_group = 'SMS' THEN 'SMS'
            WHEN v.activity_channel_group = 'LinkedIn' THEN 'LinkedIn'
            WHEN v.task_subject = 'LinkedIn Message' THEN 'LinkedIn'
            WHEN v.task_subject = 'Outgoing SMS' OR v.task_subject = 'Incoming SMS' THEN 'SMS'
            ELSE v.activity_channel_group
          END
        END as corrected_channel_group
      FROM view_data v
      LEFT JOIN task_descriptions td ON v.task_id = td.task_id
      WHERE v.activity_channel_group != 'Marketing'  -- Exclude Marketing
    ),
    date_range_days_current AS (
      SELECT
        date,
        EXTRACT(DAYOFWEEK FROM date) as day_of_week
      FROM UNNEST(GENERATE_DATE_ARRAY(@currentStart, LEAST(@currentEnd, CURRENT_DATE('America/New_York')))) as date
    ),
    day_occurrences_current AS (
      SELECT
        day_of_week,
        COUNT(*) as num_occurrences
      FROM date_range_days_current
      GROUP BY day_of_week
    ),
    current_period AS (
      SELECT
        ca.corrected_channel_group as channel,
        ca.activity_day_of_week as day_name,
        EXTRACT(DAYOFWEEK FROM ca.task_created_date_est) as day_of_week,
        COUNT(DISTINCT ca.task_id) as total_count,
        COALESCE(do.num_occurrences, 1) as num_occurrences,
        -- Average = total activities / number of times this day appears in the period
        SAFE_DIVIDE(COUNT(DISTINCT ca.task_id), GREATEST(COALESCE(do.num_occurrences, 1), 1)) as avg_count
      FROM classified_activities ca
      LEFT JOIN day_occurrences_current do ON EXTRACT(DAYOFWEEK FROM ca.task_created_date_est) = do.day_of_week
      WHERE ca.task_created_date_est >= @currentStart
        AND ca.task_created_date_est <= @currentEnd
        AND ca.task_created_date_est <= CURRENT_DATE('America/New_York')  -- Ensure we don't include future dates (use EST timezone to match task_created_date_est)
      GROUP BY channel, day_name, day_of_week, do.num_occurrences
    ),
    date_range_days AS (
      SELECT
        date,
        EXTRACT(DAYOFWEEK FROM date) as day_of_week
      FROM UNNEST(GENERATE_DATE_ARRAY(@comparisonStart, @comparisonEnd)) as date
    ),
    day_occurrences AS (
      SELECT
        day_of_week,
        COUNT(*) as num_occurrences
      FROM date_range_days
      GROUP BY day_of_week
    ),
    comparison_period AS (
      SELECT
        ca.corrected_channel_group as channel,
        ca.activity_day_of_week as day_name,
        EXTRACT(DAYOFWEEK FROM ca.task_created_date_est) as day_of_week,
        COUNT(DISTINCT ca.task_id) as total_count,
        COALESCE(do.num_occurrences, 1) as num_occurrences,
        -- Average = total activities / number of times this day appears in the period
        SAFE_DIVIDE(COUNT(DISTINCT ca.task_id), GREATEST(COALESCE(do.num_occurrences, 1), 1)) as avg_count
      FROM classified_activities ca
      LEFT JOIN day_occurrences do ON EXTRACT(DAYOFWEEK FROM ca.task_created_date_est) = do.day_of_week
      WHERE ca.task_created_date_est >= @comparisonStart
        AND ca.task_created_date_est <= @comparisonEnd
      GROUP BY channel, day_name, day_of_week, do.num_occurrences
    )
    SELECT
      COALESCE(c.channel, p.channel) as channel,
      COALESCE(c.day_of_week, p.day_of_week) as day_of_week,
      COALESCE(c.day_name, p.day_name) as day_name,
      COALESCE(c.avg_count, 0) as current_avg,
      COALESCE(c.total_count, 0) as current_total,
      COALESCE(p.avg_count, 0) as comparison_avg,
      COALESCE(p.total_count, 0) as comparison_total,
      COALESCE(c.avg_count, 0) - COALESCE(p.avg_count, 0) as variance_avg,
      COALESCE(c.total_count, 0) - COALESCE(p.total_count, 0) as variance_total
    FROM current_period c
    FULL OUTER JOIN comparison_period p
      ON c.channel = p.channel AND c.day_of_week = p.day_of_week
    WHERE COALESCE(c.channel, p.channel) != 'Marketing'  -- Exclude Marketing (Other is included for debugging/monitoring)
    ORDER BY channel, day_of_week
  `;
  
  const params: Record<string, any> = {
    currentStart: currentRange.start,
    currentEnd: currentRange.end,
    comparisonStart: comparisonRange.start,
    comparisonEnd: comparisonRange.end,
  };
  
  if (filters.sga) {
    params.sga = filters.sga;
  }
  
  const rows = await runQuery<any>(query, params);
  return processActivityDistributionResults(rows);
}

// Helper to convert BigQuery DAYOFWEEK to UI DAY_ORDER value
// BigQuery: 1=Sun, 2=Mon, 3=Tue, 4=Wed, 5=Thu, 6=Fri, 7=Sat
// UI DAY_ORDER: [1,2,3,4,5,6,0] displayed as [Mon,Tue,Wed,Thu,Fri,Sat,Sun]
// Conversion: BQ 1→UI 0 (Sun), BQ 2→UI 1 (Mon), BQ 3→UI 2 (Tue), BQ 4→UI 3 (Wed),
//             BQ 5→UI 4 (Thu), BQ 6→UI 5 (Fri), BQ 7→UI 6 (Sat)
function convertBigQueryToUIDayOfWeek(bqDayOfWeek: number): number {
  if (bqDayOfWeek === 1) return 0; // Sunday
  return bqDayOfWeek - 1; // BQ 2→UI 1, BQ 3→UI 2, etc.
}

// DAY_ORDER for sorting: [1, 2, 3, 4, 5, 6, 0] = [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
const DAY_ORDER_SORT = [1, 2, 3, 4, 5, 6, 0];

function getDayOrderIndex(dayOfWeek: number): number {
  const index = DAY_ORDER_SORT.indexOf(dayOfWeek);
  return index === -1 ? 999 : index; // Put unmapped days at the end
}

function processActivityDistributionResults(rows: any[]): any[] {
  const channelMap = new Map<string, any>();
  
  for (const row of rows) {
    const channel = String(row.channel || '') as ActivityChannel;
    
    // Skip Marketing channel only (Other is included for debugging/monitoring)
    const channelStr = String(channel || '');
    if (channelStr === 'Marketing') {
      continue;
    }
    
    if (!channelMap.has(channel)) {
      channelMap.set(channel, {
        channel,
        currentPeriod: [],
        comparisonPeriod: [],
        variance: [],
      });
    }
    
    const dist = channelMap.get(channel)!;
    
    // Convert BigQuery DAYOFWEEK (1-7) to UI DAY_ORDER value (0-6)
    const bqDayOfWeek = parseInt(row.day_of_week);
    const uiDayOfWeek = convertBigQueryToUIDayOfWeek(bqDayOfWeek);
    
    dist.currentPeriod.push({
      dayOfWeek: uiDayOfWeek,
      dayName: row.day_name,
      count: parseFloat(row.current_avg) || 0,  // Average count
      totalCount: parseFloat(row.current_total) || 0,  // Total count for sum mode
    });
    
    dist.comparisonPeriod.push({
      dayOfWeek: uiDayOfWeek,
      dayName: row.day_name,
      count: 0,
      avgCount: parseFloat(row.comparison_avg) || 0,
      totalCount: parseFloat(row.comparison_total) || 0,
    });
    
    dist.variance.push({
      dayOfWeek: uiDayOfWeek,
      dayName: row.day_name,
      currentCount: parseFloat(row.current_avg) || 0,
      comparisonCount: parseFloat(row.comparison_avg) || 0,
      variance: parseFloat(row.variance_avg) || 0,
      variancePercent: row.comparison_avg > 0 
        ? ((row.current_avg - row.comparison_avg) / row.comparison_avg) * 100 
        : 0,
      currentTotal: parseFloat(row.current_total) || 0,
      comparisonTotal: parseFloat(row.comparison_total) || 0,
      varianceTotal: parseFloat(row.variance_total) || 0,
    });
  }
  
  // Sort each distribution's arrays by DAY_ORDER to ensure column alignment
  const distributions = Array.from(channelMap.values());
  for (const dist of distributions) {
    dist.currentPeriod.sort((a: any, b: any) => getDayOrderIndex(a.dayOfWeek) - getDayOrderIndex(b.dayOfWeek));
    dist.comparisonPeriod.sort((a: any, b: any) => getDayOrderIndex(a.dayOfWeek) - getDayOrderIndex(b.dayOfWeek));
    dist.variance.sort((a: any, b: any) => getDayOrderIndex(a.dayOfWeek) - getDayOrderIndex(b.dayOfWeek));
  }
  
  return distributions;
}

// ============================================
// QUERY 5: SMS Response Rate
// ============================================

export async function getSMSResponseRate(
  filters: SGAActivityFilters
): Promise<SMSResponseRate> {
  const range = getDateRange(
    filters.dateRangeType,
    filters.startDate,
    filters.endDate
  );

  const sgaFilter = filters.sga
    ? `AND a.task_executor_name = @sga`
    : '';

  const query = `
    -- SMS Response Rate: Count distinct people texted in the date range,
    -- and of those people, how many responded (also within the same date range)
    WITH ${ACTIVE_SGAS_CTE},
    outgoing AS (
      SELECT DISTINCT a.task_who_id as lead_id
      FROM \`${ACTIVITY_VIEW}\` a
      INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
      WHERE a.activity_channel_group = 'SMS'
        AND a.direction = 'Outbound'
        AND a.task_created_date_est >= @startDate
        AND a.task_created_date_est <= @endDate
        AND a.task_created_date_est <= CURRENT_DATE('America/New_York')
        AND a.task_who_id IS NOT NULL
        AND COALESCE(a.is_marketing_activity, 0) = 0
        ${sgaFilter}
    ),
    incoming AS (
      SELECT DISTINCT a.task_who_id as lead_id
      FROM \`${ACTIVITY_VIEW}\` a
      INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
      WHERE a.activity_channel_group = 'SMS'
        AND a.direction = 'Inbound'
        AND a.task_created_date_est >= @startDate
        AND a.task_created_date_est <= @endDate
        AND a.task_created_date_est <= CURRENT_DATE('America/New_York')
        AND a.task_who_id IS NOT NULL
        AND COALESCE(a.is_marketing_activity, 0) = 0
        ${sgaFilter}
    )
    SELECT
      COUNT(DISTINCT o.lead_id) as leads_texted,
      COUNT(DISTINCT CASE WHEN i.lead_id IS NOT NULL THEN o.lead_id END) as leads_responded,
      SAFE_DIVIDE(
        COUNT(DISTINCT CASE WHEN i.lead_id IS NOT NULL THEN o.lead_id END),
        COUNT(DISTINCT o.lead_id)
      ) as response_rate
    FROM outgoing o
    LEFT JOIN incoming i ON o.lead_id = i.lead_id
  `;
  
  const params: Record<string, any> = {
    startDate: range.start,
    endDate: range.end,
  };
  
  if (filters.sga) {
    params.sga = filters.sga;
  }
  
  const rows = await runQuery<any>(query, params);
  const row = rows[0] || {};
  
  return {
    outboundCount: parseInt(String(row.leads_texted || 0)) || 0,
    inboundCount: parseInt(String(row.leads_responded || 0)) || 0,
    responseRate: parseFloat(String(row.response_rate || 0)) || 0,
    responseRatePercent: parseFloat(String(row.response_rate || 0)) * 100 || 0,
  };
}

// ============================================
// QUERY 6: Call Answer Rate
// ============================================

export async function getCallAnswerRate(
  filters: SGAActivityFilters
): Promise<CallAnswerRate> {
  const range = getDateRange(
    filters.dateRangeType,
    filters.startDate,
    filters.endDate
  );

  const sgaFilter = filters.sga
    ? `AND a.task_executor_name = @sga`
    : '';

  // Build call type filter
  let callTypeFilter = '';
  switch (filters.callTypeFilter) {
    case 'cold_calls':
      callTypeFilter = 'AND (a.Initial_Call_Scheduled_Date__c IS NULL OR a.task_created_date_est != DATE(a.Initial_Call_Scheduled_Date__c))';
      break;
    case 'scheduled_calls':
      callTypeFilter = 'AND a.Initial_Call_Scheduled_Date__c IS NOT NULL AND a.task_created_date_est = DATE(a.Initial_Call_Scheduled_Date__c)';
      break;
    case 'all_outbound':
    default:
      callTypeFilter = 'AND a.direction = \'Outbound\'';
      break;
  }

  const query = `
    WITH ${ACTIVE_SGAS_CTE}
    SELECT
      COUNT(*) as total_calls,
      COUNTIF(
        a.call_duration_seconds > 120
        OR a.task_subject LIKE '%answered%'
      ) as answered_calls,
      SAFE_DIVIDE(
        COUNTIF(
          a.call_duration_seconds > 120
          OR a.task_subject LIKE '%answered%'
        ),
        COUNT(*)
      ) as answer_rate
    FROM \`${ACTIVITY_VIEW}\` a
    INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
    WHERE a.activity_channel_group = 'Call'
      ${callTypeFilter}
      AND a.task_created_date_est >= @startDate
      AND a.task_created_date_est <= @endDate
      AND a.task_subject NOT LIKE '%voicemail%'
      AND a.task_subject NOT LIKE '%Left VM%'
      AND COALESCE(a.is_marketing_activity, 0) = 0
      ${sgaFilter}
  `;
  
  const params: Record<string, any> = {
    startDate: range.start,
    endDate: range.end,
  };
  
  if (filters.sga) {
    params.sga = filters.sga;
  }
  
  const rows = await runQuery<any>(query, params);
  const row = rows[0] || {};
  
  return {
    outboundCount: parseInt(String(row.total_calls || 0)) || 0,
    answeredCount: parseInt(String(row.answered_calls || 0)) || 0,
    answerRate: parseFloat(String(row.answer_rate || 0)) || 0,
    answerRatePercent: parseFloat(String(row.answer_rate || 0)) * 100 || 0,
  };
}

// ============================================
// QUERY 7: Activity Breakdown
// ============================================

export async function getActivityBreakdown(
  filters: SGAActivityFilters
): Promise<any[]> {
  const range = getDateRange(
    filters.dateRangeType,
    filters.startDate,
    filters.endDate
  );
  
  const automatedFilter = getAutomatedFilter(filters.includeAutomated);
  const sgaFilter = filters.sga 
    ? `AND task_executor_name = @sga` 
    : '';
  
  const query = `
    WITH view_data AS (
      SELECT DISTINCT
        task_id,
        task_subject,
        task_subtype,
        activity_channel_group,
        direction,
        is_true_cold_call,
        task_created_date_est,
        Initial_Call_Scheduled_Date__c
      FROM \`${ACTIVITY_VIEW}\`
      WHERE task_created_date_est >= @startDate
        AND task_created_date_est <= @endDate
        AND task_created_date_est <= CURRENT_DATE('America/New_York')  -- Exclude future dates
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
    ),
    task_descriptions AS (
      SELECT
        t.Id as task_id,
        t.Description as task_description
      FROM \`savvy-gtm-analytics.SavvyGTMData.Task\` t
      WHERE t.IsDeleted = FALSE
        AND t.Id IN (SELECT task_id FROM view_data)
    ),
    classified_activities AS (
      SELECT DISTINCT
        v.task_id,
        -- Apply same channel classification as Activity Totals
        -- Only override channel if raw channel is ambiguous (Call) or already LinkedIn
        -- Don't override SMS or Email channels - they're already correct
        CASE
          -- CRITICAL: Check for explicit subject-based classifications FIRST (highest priority)
          -- LinkedIn Message subject takes precedence over raw channel
          WHEN v.task_subject = 'LinkedIn Message' OR v.task_subject = 'LinkedIn Connect' THEN 'LinkedIn'
          WHEN v.task_subject = 'Outgoing SMS' OR v.task_subject = 'Incoming SMS' THEN 'SMS'
          -- SMS: Check for SMS indicators (but after explicit LinkedIn subjects)
          WHEN v.activity_channel_group = 'SMS' THEN 'SMS'
          WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%sms%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%text%'  -- Catch "text 2", "text message", etc.
            OR LOWER(COALESCE(td.task_description, '')) LIKE '%sms%'
            OR LOWER(COALESCE(td.task_description, '')) LIKE '%text message%'
            OR LOWER(COALESCE(td.task_description, '')) LIKE '%text%'  -- Catch any text-related descriptions
          THEN 'SMS'
          -- LinkedIn: Only classify as LinkedIn if:
          -- 1. Raw channel is already LinkedIn, OR
          -- 2. Raw channel is Call/ambiguous AND has clear LinkedIn indicators
          WHEN v.activity_channel_group = 'LinkedIn' THEN 'LinkedIn'
          WHEN v.activity_channel_group = 'Email' THEN 'Email'
          WHEN (LOWER(COALESCE(v.task_subject, '')) LIKE '%linkedin%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%linked in%'
            OR (LOWER(COALESCE(td.task_description, '')) LIKE '%linkedin%'
                AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%sms%'
                AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%email%'
                AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%text%'))
          THEN 'LinkedIn'
          -- Email: Only if raw channel is Call (ambiguous) and has email indicators
          -- BUT exclude if it's clearly SMS (subject contains SMS or text)
          -- CRITICAL: Also exclude if raw channel is SMS or LinkedIn (double-check)
          WHEN (LOWER(COALESCE(v.task_subject, '')) LIKE '%email%'
            OR LOWER(COALESCE(td.task_description, '')) LIKE '%email%')
            AND v.activity_channel_group = 'Call'  -- Only classify Call as Email if ambiguous
            AND v.activity_channel_group != 'SMS'  -- Double-check: never classify SMS as Email
            AND v.activity_channel_group != 'LinkedIn'  -- Never classify LinkedIn as Email
            AND LOWER(COALESCE(v.task_subject, '')) NOT LIKE '%sms%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%sms%'
            AND LOWER(COALESCE(v.task_subject, '')) NOT LIKE '%text%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%text%'
            AND v.task_subject != 'LinkedIn Message'  -- Explicitly exclude LinkedIn Message
            AND v.task_subject != 'Outgoing SMS'  -- Explicitly exclude Outgoing SMS
            AND v.task_subject != 'Incoming SMS'  -- Explicitly exclude Incoming SMS
          THEN 'Email'
          -- CRITICAL: In ELSE clause, preserve raw channel BUT ensure SMS/LinkedIn are never Email
          ELSE CASE
            WHEN v.activity_channel_group = 'SMS' THEN 'SMS'
            WHEN v.activity_channel_group = 'LinkedIn' THEN 'LinkedIn'
            WHEN v.task_subject = 'LinkedIn Message' THEN 'LinkedIn'
            WHEN v.task_subject = 'Outgoing SMS' OR v.task_subject = 'Incoming SMS' THEN 'SMS'
            ELSE v.activity_channel_group
          END
        END as corrected_channel_group,
        v.direction,
        v.is_true_cold_call,
        v.task_created_date_est,
        v.Initial_Call_Scheduled_Date__c,
        v.task_subject,
        v.task_subtype
      FROM view_data v
      LEFT JOIN task_descriptions td ON v.task_id = td.task_id
      WHERE v.activity_channel_group != 'Marketing'
    ),
    activity_counts AS (
      SELECT
        corrected_channel_group as channel,
        CASE
          -- LinkedIn subtypes
          WHEN corrected_channel_group = 'LinkedIn' AND task_subject = 'LinkedIn Message' THEN 'Message (Manual)'
          WHEN corrected_channel_group = 'LinkedIn' AND task_subject = 'LinkedIn Connect' THEN 'Connection Request (Manual)'
          WHEN corrected_channel_group = 'LinkedIn' AND task_subject LIKE '%invite sent%' THEN 'Connection Request (Automated)'
          WHEN corrected_channel_group = 'LinkedIn' AND task_subject LIKE '%invite accepted%' THEN 'Connection Accepted'
          WHEN corrected_channel_group = 'LinkedIn' AND task_subject LIKE '%replied%' THEN 'Reply Received'
          WHEN corrected_channel_group = 'LinkedIn' AND task_subject LIKE '%message opened%' THEN 'Message Opened'
          WHEN corrected_channel_group = 'LinkedIn' AND task_subject LIKE '%bounced%' THEN 'Bounced'
          WHEN corrected_channel_group = 'LinkedIn' THEN 'Other LinkedIn'
          -- Call subtypes (Scheduled = date matches Initial_Call_Scheduled_Date__c, else Cold Call)
          WHEN corrected_channel_group = 'Call' AND direction = 'Outbound'
            AND Initial_Call_Scheduled_Date__c IS NOT NULL
            AND task_created_date_est = DATE(Initial_Call_Scheduled_Date__c) THEN 'Scheduled Call'
          WHEN corrected_channel_group = 'Call' AND direction = 'Outbound' THEN 'Cold Call'
          WHEN corrected_channel_group = 'Call' THEN 'Other Call'
          -- SMS subtypes (only outbound to match scorecards)
          WHEN corrected_channel_group = 'SMS' AND direction = 'Outbound' THEN 'Outbound SMS'
          -- Email subtypes (all emails, manual and automated)
          WHEN corrected_channel_group = 'Email' THEN 'Email'
          ELSE 'Other'
        END as sub_type,
        COUNT(*) as count,
        CASE 
          WHEN task_subject LIKE '%[lemlist]%' OR task_subtype = 'ListEmail' THEN TRUE 
          ELSE FALSE 
        END as is_automated
      FROM classified_activities
      -- Exclude Email (Engagement) from rollup — rollup is "how much they are doing", not engagement alerts
      WHERE corrected_channel_group != 'Email (Engagement)'
        AND (
          (corrected_channel_group = 'SMS' AND direction = 'Outbound')
          OR (corrected_channel_group = 'Call' AND direction = 'Outbound')
          OR corrected_channel_group NOT IN ('SMS', 'Call')
        )
      GROUP BY channel, sub_type, is_automated
    ),
    totals AS (
      SELECT SUM(count) as grand_total
      FROM activity_counts
    )
    SELECT
      channel,
      sub_type,
      count,
      is_automated,
      SAFE_DIVIDE(count, (SELECT grand_total FROM totals)) as percent_of_total
    FROM activity_counts
    ORDER BY channel, count DESC
  `;
  
  const params: Record<string, any> = {
    startDate: range.start,
    endDate: range.end,
  };
  
  if (filters.sga) {
    params.sga = filters.sga;
  }
  
  const rows = await runQuery<any>(query, params);
  return processActivityBreakdownResults(rows);
}

function processActivityBreakdownResults(rows: any[]): any[] {
  const channelMap = new Map<string, any>();
  
  for (const row of rows) {
    const channel = row.channel as ActivityChannel;
    
    if (!channelMap.has(channel)) {
      channelMap.set(channel, {
        channel,
        subType: row.sub_type,
        count: parseInt(row.count) || 0,
        percentage: parseFloat(row.percent_of_total) * 100 || 0,
      });
    } else {
      const existing = channelMap.get(channel)!;
      existing.count += parseInt(row.count) || 0;
      existing.percentage += parseFloat(row.percent_of_total) * 100 || 0;
    }
  }
  
  return Array.from(channelMap.values()).sort((a, b) => b.count - a.count);
}

// ============================================
// QUERY 8: Activity Drill-Down Records
// ============================================

export async function getActivityRecords(
  filters: SGAActivityFilters,
  channel?: ActivityChannel,
  subType?: string,
  dayOfWeek?: number,
  activityType?: string,
  page: number = 1,
  pageSize: number = 100
): Promise<{ records: ActivityRecord[]; total: number }> {
  const range = getDateRange(
    filters.dateRangeType,
    filters.startDate,
    filters.endDate
  );

  const sgaFilter = filters.sga
    ? `AND a.task_executor_name = @sga`
    : '';

  // Map activityType to metric_type from shared METRIC_CASE_EXPRESSION
  // Note: sms_inbound is not in METRIC_CASE (breakdown excludes it) — handled separately
  const metricTypeMap: Record<string, string> = {
    'cold_calls': 'Cold_Call',
    'outbound_calls': 'Scheduled_Call',
    'sms_outbound': 'Outbound_SMS',
    'linkedin_messages': 'LinkedIn',
    'emails_manual': 'Manual_Email',
    'emails_engagement': 'Email_Engagement',
  };

  const isInboundSMS = activityType === 'sms_inbound';
  let targetMetricType: string | undefined = undefined;
  if (activityType && metricTypeMap[activityType]) {
    targetMetricType = metricTypeMap[activityType];
  }

  const metricFilter = isInboundSMS
    ? `AND activity_channel_group = 'SMS' AND direction = 'Inbound'`
    : targetMetricType
      ? `AND metric_type = @metricType`
      : `AND metric_type IS NOT NULL`;

  const dayFilter = (dayOfWeek !== undefined && dayOfWeek !== null)
    ? `AND EXTRACT(DAYOFWEEK FROM a.task_created_date_est) = @dayOfWeek`
    : '';

  // Use shared METRIC_CASE_EXPRESSION — identical to breakdown table and scorecards
  const query = `
    WITH ${ACTIVE_SGAS_CTE},
    classified_records AS (
      SELECT DISTINCT
        a.task_id,
        a.task_created_date_utc,
        a.task_created_date_est,
        a.task_subject,
        a.task_subtype,
        a.activity_channel_group,
        a.direction,
        a.task_executor_name,
        COALESCE(a.Prospect_Name, a.Opp_Name, 'Unknown') as prospect_name,
        a.Full_prospect_id__c,
        a.Full_Opportunity_ID__c,
        a.Original_source,
        a.Channel_Grouping_Name,
        a.call_duration_seconds,
        a.is_true_cold_call,
        ${METRIC_CASE_EXPRESSION} AS metric_type
      FROM \`${ACTIVITY_VIEW}\` a
      INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
      WHERE a.task_created_date_est >= @startDate
        AND a.task_created_date_est <= @endDate
        AND COALESCE(a.is_marketing_activity, 0) = 0
        ${sgaFilter}
        ${dayFilter}
    )
    SELECT
      task_id as taskId,
      CAST(task_created_date_utc AS STRING) as createdDate,
      CAST(task_created_date_est AS STRING) as createdDateEST,
      CASE
        WHEN activity_channel_group = 'SMS' AND direction = 'Inbound' THEN 'SMS'
        WHEN metric_type = 'Cold_Call' THEN 'Call'
        WHEN metric_type = 'Scheduled_Call' THEN 'Call'
        WHEN metric_type = 'Outbound_SMS' THEN 'SMS'
        WHEN metric_type = 'LinkedIn' THEN 'LinkedIn'
        WHEN metric_type = 'Manual_Email' THEN 'Email'
        WHEN metric_type = 'Email_Engagement' THEN 'Email (Engagement)'
        ELSE activity_channel_group
      END as activityChannel,
      CASE
        WHEN activity_channel_group = 'SMS' AND direction = 'Inbound' THEN 'Inbound SMS'
        WHEN metric_type = 'Cold_Call' THEN 'Cold Call'
        WHEN metric_type = 'Scheduled_Call' THEN 'Outbound Call'
        WHEN metric_type = 'Outbound_SMS' THEN 'Outbound SMS'
        WHEN metric_type = 'LinkedIn' THEN 'LinkedIn Message'
        WHEN metric_type = 'Manual_Email' THEN 'Email'
        WHEN metric_type = 'Email_Engagement' THEN 'Email (Engagement)'
        ELSE activity_channel_group
      END as activitySubType,
      direction,
      task_executor_name as sgaName,
      prospect_name as prospectName,
      Full_prospect_id__c as leadId,
      Full_Opportunity_ID__c as opportunityId,
      Original_source as source,
      Channel_Grouping_Name as channel,
      task_subject as subject,
      call_duration_seconds as callDuration,
      CASE WHEN task_subject LIKE '%[lemlist]%' OR task_subtype = 'ListEmail' THEN TRUE ELSE FALSE END as isAutomated,
      CASE WHEN is_true_cold_call = 1 THEN TRUE ELSE FALSE END as isColdCall,
      CONCAT('https://savvywealth.lightning.force.com/lightning/r/Task/', task_id, '/view') as salesforceUrl
    FROM classified_records
    WHERE 1=1
      ${metricFilter}
    ORDER BY task_created_date_est DESC
    LIMIT @pageSize
    OFFSET @offset
  `;

  // Count query uses same classification and filtering
  const countQuery = `
    WITH ${ACTIVE_SGAS_CTE},
    classified_records AS (
      SELECT DISTINCT
        a.task_id,
        a.activity_channel_group,
        a.direction,
        ${METRIC_CASE_EXPRESSION} AS metric_type
      FROM \`${ACTIVITY_VIEW}\` a
      INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
      WHERE a.task_created_date_est >= @startDate
        AND a.task_created_date_est <= @endDate
        AND COALESCE(a.is_marketing_activity, 0) = 0
        ${sgaFilter}
        ${dayFilter}
    )
    SELECT COUNT(DISTINCT task_id) as total
    FROM classified_records
    WHERE 1=1
      ${metricFilter}
  `;

  const params: Record<string, any> = {
    startDate: range.start,
    endDate: range.end,
    pageSize,
    offset: (page - 1) * pageSize,
  };

  if (filters.sga) {
    params.sga = filters.sga;
  }

  if (targetMetricType) {
    params.metricType = targetMetricType;
  }

  if (dayOfWeek !== undefined && dayOfWeek !== null) {
    params.dayOfWeek = dayOfWeek;
  }

  const [rows, countRows] = await Promise.all([
    runQuery<any>(query, params),
    runQuery<any>(countQuery, params),
  ]);

  const total = parseInt(String(countRows[0]?.total || 0)) || 0;

  // Extract date values from BigQuery DATE objects
  const records = rows.map(row => ({
    ...row,
    createdDate: extractDateValue(row.createdDate),
    createdDateEST: extractDateValue(row.createdDateEST),
  }));

  return { records, total };
}

// ============================================
// QUERY 9: Activity Totals Summary
// ============================================

export async function getActivityTotals(filters: SGAActivityFilters): Promise<{
  coldCalls: number;
  outboundCalls: number;
  smsOutbound: number;
  smsInbound: number;
  linkedInMessages: number;
  emailsManual: number;
  emailsEngagement: number;
}> {
  const range = getDateRange(
    filters.dateRangeType,
    filters.startDate,
    filters.endDate
  );

  const sgaFilter = filters.sga
    ? `AND a.task_executor_name = @sga`
    : '';

  // Use shared METRIC_CASE_EXPRESSION — identical to breakdown table
  // Inbound SMS counted separately (not in shared CASE — breakdown excludes it)
  const query = `
    WITH ${ACTIVE_SGAS_CTE},
    classified AS (
      SELECT DISTINCT
        a.task_id,
        ${METRIC_CASE_EXPRESSION} AS metric_type,
        a.activity_channel_group,
        a.direction
      FROM \`${ACTIVITY_VIEW}\` a
      INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
      WHERE a.task_created_date_est >= @startDate
        AND a.task_created_date_est <= @endDate
        AND COALESCE(a.is_marketing_activity, 0) = 0
        ${sgaFilter}
    )
    SELECT
      COUNTIF(metric_type = 'Cold_Call') as cold_calls,
      COUNTIF(metric_type = 'Scheduled_Call') as outbound_calls,
      COUNTIF(metric_type = 'Outbound_SMS') as sms_outbound,
      COUNTIF(activity_channel_group = 'SMS' AND direction = 'Inbound') as sms_inbound,
      COUNTIF(metric_type = 'LinkedIn') as linkedin_messages,
      COUNTIF(metric_type = 'Manual_Email') as emails_manual,
      COUNTIF(metric_type = 'Email_Engagement') as emails_engagement
    FROM classified
  `;

  const params: Record<string, any> = {
    startDate: range.start,
    endDate: range.end,
  };

  if (filters.sga) {
    params.sga = filters.sga;
  }

  const rows = await runQuery<any>(query, params);
  const row = rows[0] || {};

  return {
    coldCalls: parseInt(String(row.cold_calls || 0)) || 0,
    outboundCalls: parseInt(String(row.outbound_calls || 0)) || 0,
    smsOutbound: parseInt(String(row.sms_outbound || 0)) || 0,
    smsInbound: parseInt(String(row.sms_inbound || 0)) || 0,
    linkedInMessages: parseInt(String(row.linkedin_messages || 0)) || 0,
    emailsManual: parseInt(String(row.emails_manual || 0)) || 0,
    emailsEngagement: parseInt(String(row.emails_engagement || 0)) || 0,
  };
}

// ============================================
// QUERY 10: Filter Options (SGAs)
// ============================================

const _getSGAActivityFilterOptions = async (): Promise<{
  sgas: { value: string; label: string; isActive: boolean }[];
}> => {
  // Match the pattern from Funnel Performance dashboard filters exactly
  // Get SGAs who appear in EITHER activity data OR scheduled calls data
  // AND are marked as SGAs in User table
  // Only include users where IsSGA__c = TRUE
  // This ensures we show all SGAs who have any records (activity or scheduled calls)
  // Note: IsActive comes from User table, UI toggle filters by it (default: active only)
  const query = `
    WITH activity_sgas AS (
      SELECT DISTINCT
        v.task_executor_name AS sga_name,
        MAX(COALESCE(u.IsActive, FALSE)) as is_active
      FROM \`${ACTIVITY_VIEW}\` v
      INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
        ON v.task_executor_name = u.Name
        AND u.IsSGA__c = TRUE  -- Only include users marked as SGAs
      WHERE v.task_executor_name IS NOT NULL
        AND v.task_executor_name != 'Savvy Operations'
        AND v.task_executor_name != 'Savvy Marketing'
        AND v.task_created_date_est >= DATE_SUB(CURRENT_DATE('America/New_York'), INTERVAL 2 YEAR)
      GROUP BY v.task_executor_name
    ),
    scheduled_calls_sgas AS (
      SELECT DISTINCT
        f.SGA_Owner_Name__c AS sga_name,
        MAX(COALESCE(u.IsActive, FALSE)) as is_active
      FROM \`${FUNNEL_VIEW}\` f
      INNER JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u
        ON f.SGA_Owner_Name__c = u.Name
        AND u.IsSGA__c = TRUE  -- Only include users marked as SGAs
      WHERE f.SGA_Owner_Name__c IS NOT NULL
        AND f.SGA_Owner_Name__c != 'Savvy Operations'
        AND f.SGA_Owner_Name__c != 'Savvy Marketing'
        AND f.SGA_Owner_Name__c != 'Anett Diaz'  -- Exclude Anett Diaz
        AND f.SGA_Owner_Name__c != 'Jacqueline Tully'  -- Exclude Jacqueline Tully (not an SGA)
        AND (
          (f.Initial_Call_Scheduled_Date__c IS NOT NULL 
            AND f.Initial_Call_Scheduled_Date__c >= DATE_SUB(CURRENT_DATE('America/New_York'), INTERVAL 2 YEAR))
          OR
          (f.Qualification_Call_Date__c IS NOT NULL 
            AND f.Qualification_Call_Date__c >= DATE_SUB(CURRENT_DATE('America/New_York'), INTERVAL 2 YEAR))
        )
      GROUP BY f.SGA_Owner_Name__c
    ),
    combined_sgas AS (
      SELECT sga_name, is_active FROM activity_sgas
      UNION DISTINCT
      SELECT sga_name, is_active FROM scheduled_calls_sgas
    )
    SELECT 
      sga_name,
      MAX(is_active) as is_active
    FROM combined_sgas
    GROUP BY sga_name
    ORDER BY sga_name
  `;
  
  const rows = await runQuery<any>(query);
  
  // Force deduplication using Map
  const uniqueSgas = new Map<string, { value: string; label: string; isActive: boolean }>();
  
  const excludedFromSgaList = ['Jacqueline Tully'];

  for (const row of rows) {
    const sgaName = String(row.sga_name || '').trim();
    if (sgaName && !excludedFromSgaList.includes(sgaName)) {
      const isActive = Boolean(row.is_active);
      uniqueSgas.set(sgaName, {
        value: sgaName,
        label: sgaName,
        isActive,
      });
    }
  }
  
  // Convert to array and sort
  const result = Array.from(uniqueSgas.values()).sort((a, b) => a.value.localeCompare(b.value));
  
  return {
    sgas: result,
  };
};

export const getSGAActivityFilterOptions = cachedQuery(
  _getSGAActivityFilterOptions,
  'getSGAActivityFilterOptions',
  CACHE_TAGS.SGA_HUB
);

// ============================================
// CACHED WRAPPER FUNCTIONS
// ============================================

export const getCachedScheduledInitialCalls = cachedQuery(
  getScheduledInitialCalls,
  'getScheduledInitialCalls',
  CACHE_TAGS.SGA_HUB
);

export const getCachedScheduledQualificationCalls = cachedQuery(
  getScheduledQualificationCalls,
  'getScheduledQualificationCalls',
  CACHE_TAGS.SGA_HUB
);

export const getCachedActivityDistribution = cachedQuery(
  getActivityDistribution,
  'getActivityDistribution',
  CACHE_TAGS.SGA_HUB
);

export const getCachedSMSResponseRate = cachedQuery(
  getSMSResponseRate,
  'getSMSResponseRate',
  CACHE_TAGS.SGA_HUB
);

export const getCachedCallAnswerRate = cachedQuery(
  getCallAnswerRate,
  'getCallAnswerRate',
  CACHE_TAGS.SGA_HUB
);

export const getCachedActivityBreakdown = cachedQuery(
  getActivityBreakdown,
  'getActivityBreakdown',
  CACHE_TAGS.SGA_HUB
);

export const getCachedActivityTotals = cachedQuery(
  getActivityTotals,
  'getActivityTotals',
  CACHE_TAGS.SGA_HUB
);

// ============================================
// INDIVIDUAL SGA ACTIVITY BREAKDOWN QUERIES
// ============================================

export async function getActivityBreakdownAggregation(
  trailingWeeks: TrailingWeeksOption,
  sgaName?: string
): Promise<{ weekBounds: ActivityBreakdownWeekBounds; data: ActivityBreakdownRow[] }> {
  const sgaFilter = sgaName ? `AND a.task_executor_name = @sgaName` : '';

  const query = `
    WITH ${ACTIVE_SGAS_CTE},
    ${WEEK_BOUNDS_CTE},
    trailing_weeks AS (
      SELECT
        n AS week_num,
        DATE_SUB(wb.last_week_start, INTERVAL (n * 7) DAY) AS trail_start,
        DATE_SUB(wb.last_week_end, INTERVAL (n * 7) DAY) AS trail_end
      FROM week_bounds wb
      CROSS JOIN UNNEST(GENERATE_ARRAY(1, @trailingWeeks)) AS n
    )
    SELECT
      a.task_executor_name AS sga_name,
      CASE
        WHEN a.task_activity_date BETWEEN wb.this_week_start AND wb.this_week_end THEN 'This_Week'
        WHEN a.task_activity_date BETWEEN wb.last_week_start AND wb.last_week_end THEN 'Last_Week'
        ELSE CONCAT('Trailing_', tw.week_num)
      END AS week_bucket,
      ${METRIC_CASE_EXPRESSION} AS metric_type,
      COUNT(DISTINCT a.task_id) AS activity_count
    FROM \`${ACTIVITY_VIEW}\` a
    INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
    CROSS JOIN week_bounds wb
    LEFT JOIN trailing_weeks tw
      ON a.task_activity_date BETWEEN tw.trail_start AND tw.trail_end
    WHERE a.task_activity_date BETWEEN
        DATE_SUB((SELECT last_week_start FROM week_bounds), INTERVAL (@trailingWeeks * 7) DAY)
        AND (SELECT this_week_end FROM week_bounds)
      AND COALESCE(a.is_marketing_activity, 0) = 0
      ${sgaFilter}
    GROUP BY 1, 2, 3
    HAVING week_bucket IS NOT NULL AND metric_type IS NOT NULL
    ORDER BY 1, 2, 3
  `;

  const params: Record<string, any> = { trailingWeeks };
  if (sgaName) params.sgaName = sgaName;

  const boundsQuery = `
    WITH ${WEEK_BOUNDS_CTE},
    trailing_weeks AS (
      SELECT n AS week_num,
        DATE_SUB(wb.last_week_start, INTERVAL (n * 7) DAY) AS trail_start,
        DATE_SUB(wb.last_week_end, INTERVAL (n * 7) DAY) AS trail_end
      FROM week_bounds wb
      CROSS JOIN UNNEST(GENERATE_ARRAY(1, @trailingWeeks)) AS n
    )
    SELECT
      wb.this_week_start, wb.this_week_end,
      wb.last_week_start, wb.last_week_end,
      tw.week_num, tw.trail_start, tw.trail_end
    FROM week_bounds wb
    CROSS JOIN trailing_weeks tw
    ORDER BY tw.week_num
  `;

  const [dataRows, boundsRows] = await Promise.all([
    runQuery<any>(query, params),
    runQuery<any>(boundsQuery, { trailingWeeks }),
  ]);

  const firstBound = boundsRows[0];
  const weekBounds: ActivityBreakdownWeekBounds = {
    thisWeek: {
      start: extractDateValue(firstBound.this_week_start),
      end: extractDateValue(firstBound.this_week_end),
    },
    lastWeek: {
      start: extractDateValue(firstBound.last_week_start),
      end: extractDateValue(firstBound.last_week_end),
    },
    trailingWeeks: boundsRows.map((r: any) => ({
      weekNum: parseInt(String(r.week_num)),
      start: extractDateValue(r.trail_start),
      end: extractDateValue(r.trail_end),
    })),
  };

  const data: ActivityBreakdownRow[] = dataRows.map((r: any) => ({
    sgaName: String(r.sga_name),
    weekBucket: String(r.week_bucket),
    metricType: String(r.metric_type) as any,
    activityCount: parseInt(String(r.activity_count)) || 0,
  }));

  return { weekBounds, data };
}

export async function getActivityBreakdownDrillDown(
  sgaName: string,
  startDate: string,
  endDate: string,
  metricType: string | null,
  page: number = 1,
  pageSize: number = 100,
  search?: string
): Promise<{ records: ActivityBreakdownDrillDownRecord[]; total: number }> {
  const metricFilter = metricType
    ? `AND ${METRIC_CASE_EXPRESSION} = @metricType`
    : `AND ${METRIC_CASE_EXPRESSION} IS NOT NULL`;

  const searchFilter = search
    ? `AND LOWER(COALESCE(a.advisor_name, a.task_subject, '')) LIKE CONCAT('%', LOWER(@search), '%')`
    : '';

  const dataQuery = `
    WITH ${ACTIVE_SGAS_CTE},
    base_tasks AS (
      SELECT a.*
      FROM \`${ACTIVITY_VIEW}\` a
      INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
      WHERE a.task_executor_name = @sgaName
        AND a.task_activity_date BETWEEN @startDate AND @endDate
        AND COALESCE(a.is_marketing_activity, 0) = 0
        ${metricFilter}
        ${searchFilter}
    ),
    linked AS (
      SELECT
        COALESCE(a.advisor_name, 'Unknown') AS prospect_name,
        COALESCE(a.Full_prospect_id__c, a.Full_Opportunity_ID__c) AS record_id,
        COALESCE(NULLIF(a.TOF_Stage,''), NULLIF(a.StageName,''), 'Lead') AS stage,
        COUNTIF(a.activity_channel_group = 'Call' AND a.direction = 'Outbound' AND (a.Initial_Call_Scheduled_Date__c IS NULL OR a.task_created_date_est != DATE(a.Initial_Call_Scheduled_Date__c)) AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%') AS cold_calls,
        COUNTIF(a.activity_channel_group = 'Call' AND a.direction = 'Outbound' AND a.Initial_Call_Scheduled_Date__c IS NOT NULL AND a.task_created_date_est = DATE(a.Initial_Call_Scheduled_Date__c) AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%') AS scheduled_calls,
        COUNTIF(a.activity_channel_group = 'SMS' AND a.direction = 'Outbound') AS outbound_sms,
        COUNTIF(a.activity_channel_group = 'LinkedIn') AS linkedin,
        COUNTIF(a.activity_channel_group = 'Email' AND COALESCE(a.is_engagement_tracking, 0) = 0 AND COALESCE(a.is_marketing_activity, 0) = 0) AS manual_email,
        COUNTIF(a.activity_channel_group = 'Email (Engagement)' OR (a.activity_channel_group = 'Email' AND a.is_engagement_tracking = 1)) AS email_engagement
      FROM base_tasks a
      WHERE COALESCE(a.Full_prospect_id__c, a.Full_Opportunity_ID__c) IS NOT NULL
      GROUP BY 1, 2, 3
    ),
    unlinked AS (
      SELECT
        CONCAT('Unlinked — ', LEFT(COALESCE(a.task_subject, 'No Subject'), 50)) AS prospect_name,
        CAST(NULL AS STRING) AS record_id,
        a.activity_channel_group AS stage,
        IF(a.activity_channel_group = 'Call' AND a.direction = 'Outbound' AND (a.Initial_Call_Scheduled_Date__c IS NULL OR a.task_created_date_est != DATE(a.Initial_Call_Scheduled_Date__c)) AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%', 1, 0) AS cold_calls,
        IF(a.activity_channel_group = 'Call' AND a.direction = 'Outbound' AND a.Initial_Call_Scheduled_Date__c IS NOT NULL AND a.task_created_date_est = DATE(a.Initial_Call_Scheduled_Date__c) AND LOWER(COALESCE(a.task_subject, '')) NOT LIKE '%[lemlist]%', 1, 0) AS scheduled_calls,
        IF(a.activity_channel_group = 'SMS' AND a.direction = 'Outbound', 1, 0) AS outbound_sms,
        IF(a.activity_channel_group = 'LinkedIn', 1, 0) AS linkedin,
        IF(a.activity_channel_group = 'Email' AND COALESCE(a.is_engagement_tracking, 0) = 0 AND COALESCE(a.is_marketing_activity, 0) = 0, 1, 0) AS manual_email,
        IF(a.activity_channel_group = 'Email (Engagement)' OR (a.activity_channel_group = 'Email' AND a.is_engagement_tracking = 1), 1, 0) AS email_engagement
      FROM base_tasks a
      WHERE COALESCE(a.Full_prospect_id__c, a.Full_Opportunity_ID__c) IS NULL
    ),
    combined AS (
      SELECT *, (cold_calls + scheduled_calls + outbound_sms + linkedin + manual_email + email_engagement) AS total_activities FROM linked
      UNION ALL
      SELECT *, (cold_calls + scheduled_calls + outbound_sms + linkedin + manual_email + email_engagement) AS total_activities FROM unlinked
    )
    SELECT * FROM combined
    ORDER BY total_activities DESC
    LIMIT @pageSize OFFSET @offset
  `;

  const countQuery = `
    WITH ${ACTIVE_SGAS_CTE},
    base_tasks AS (
      SELECT a.*
      FROM \`${ACTIVITY_VIEW}\` a
      INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
      WHERE a.task_executor_name = @sgaName
        AND a.task_activity_date BETWEEN @startDate AND @endDate
        AND COALESCE(a.is_marketing_activity, 0) = 0
        ${metricFilter}
        ${searchFilter}
    ),
    linked AS (
      SELECT COALESCE(a.Full_prospect_id__c, a.Full_Opportunity_ID__c) AS record_id
      FROM base_tasks a
      WHERE COALESCE(a.Full_prospect_id__c, a.Full_Opportunity_ID__c) IS NOT NULL
      GROUP BY 1
    ),
    unlinked AS (
      SELECT a.task_id
      FROM base_tasks a
      WHERE COALESCE(a.Full_prospect_id__c, a.Full_Opportunity_ID__c) IS NULL
    )
    SELECT (SELECT COUNT(*) FROM linked) + (SELECT COUNT(*) FROM unlinked) AS total
  `;

  const params: Record<string, any> = {
    sgaName,
    startDate,
    endDate,
    pageSize,
    offset: (page - 1) * pageSize,
  };
  if (metricType) params.metricType = metricType;
  if (search) params.search = search;

  const [dataRows, countRows] = await Promise.all([
    runQuery<any>(dataQuery, params),
    runQuery<any>(countQuery, {
      sgaName, startDate, endDate,
      ...(metricType ? { metricType } : {}),
      ...(search ? { search } : {}),
    }),
  ]);

  const records: ActivityBreakdownDrillDownRecord[] = dataRows.map((r: any) => ({
    prospectName: String(r.prospect_name),
    recordId: r.record_id ? String(r.record_id) : null,
    stage: String(r.stage),
    coldCalls: parseInt(String(r.cold_calls)) || 0,
    scheduledCalls: parseInt(String(r.scheduled_calls)) || 0,
    outboundSms: parseInt(String(r.outbound_sms)) || 0,
    linkedin: parseInt(String(r.linkedin)) || 0,
    manualEmail: parseInt(String(r.manual_email)) || 0,
    emailEngagement: parseInt(String(r.email_engagement)) || 0,
    totalActivities: parseInt(String(r.total_activities)) || 0,
  }));

  const total = parseInt(String(countRows[0]?.total)) || 0;

  return { records, total };
}

export async function getActivityBreakdownExportData(
  trailingWeeks: TrailingWeeksOption,
  sgaName?: string
): Promise<{ aggregation: ActivityBreakdownRow[]; auditRows: ActivityBreakdownAuditRow[]; weekBounds: ActivityBreakdownWeekBounds }> {
  const { weekBounds, data: aggregation } = await getActivityBreakdownAggregation(trailingWeeks, sgaName);

  const sgaFilter = sgaName ? `AND a.task_executor_name = @sgaName` : '';

  const auditQuery = `
    WITH ${ACTIVE_SGAS_CTE},
    ${WEEK_BOUNDS_CTE},
    trailing_weeks AS (
      SELECT n AS week_num,
        DATE_SUB(wb.last_week_start, INTERVAL (n * 7) DAY) AS trail_start,
        DATE_SUB(wb.last_week_end, INTERVAL (n * 7) DAY) AS trail_end
      FROM week_bounds wb
      CROSS JOIN UNNEST(GENERATE_ARRAY(1, @trailingWeeks)) AS n
    )
    SELECT * FROM (
      SELECT DISTINCT
        a.task_id,
        a.task_executor_name AS sga_name,
        a.task_activity_date AS activity_date,
        CASE
          WHEN a.task_activity_date BETWEEN wb.this_week_start AND wb.this_week_end THEN 'This_Week'
          WHEN a.task_activity_date BETWEEN wb.last_week_start AND wb.last_week_end THEN 'Last_Week'
          ELSE CONCAT('Trailing_', tw.week_num)
        END AS week_bucket,
        ${METRIC_CASE_EXPRESSION} AS metric_type,
        a.activity_channel_group AS channel_group,
        a.direction,
        a.task_subject AS subject
      FROM \`${ACTIVITY_VIEW}\` a
      INNER JOIN active_sgas s ON a.task_executor_name = s.sga_name
      CROSS JOIN week_bounds wb
      LEFT JOIN trailing_weeks tw
        ON a.task_activity_date BETWEEN tw.trail_start AND tw.trail_end
      WHERE a.task_activity_date BETWEEN
          DATE_SUB((SELECT last_week_start FROM week_bounds), INTERVAL (@trailingWeeks * 7) DAY)
          AND (SELECT this_week_end FROM week_bounds)
        AND COALESCE(a.is_marketing_activity, 0) = 0
        ${sgaFilter}
    ) sub
    WHERE week_bucket IS NOT NULL AND metric_type IS NOT NULL
    ORDER BY sga_name, week_bucket, metric_type, activity_date
  `;

  const params: Record<string, any> = { trailingWeeks };
  if (sgaName) params.sgaName = sgaName;

  const auditDataRows = await runQuery<any>(auditQuery, params);

  const auditRows: ActivityBreakdownAuditRow[] = auditDataRows.map((r: any) => ({
    taskId: String(r.task_id),
    sgaName: String(r.sga_name),
    activityDate: extractDateValue(r.activity_date),
    weekBucket: String(r.week_bucket),
    metricType: String(r.metric_type),
    channelGroup: String(r.channel_group),
    direction: String(r.direction),
    subject: String(r.subject || ''),
  }));

  return { aggregation, auditRows, weekBounds };
}
