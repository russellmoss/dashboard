import { runQuery } from '@/lib/bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { logger } from '@/lib/logger';
import {
  SGAActivityFilters,
  ScheduledCallsSummary,
  ScheduledCallRecord,
  ActivityDistribution,
  SMSResponseRate,
  CallAnswerRate,
  ActivityBreakdown,
  ActivityRecord,
  ActivityChannel,
  DayCount,
  SGACallCount,
  SGADayCount,
} from '@/types/sga-activity';

const ACTIVITY_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance';
const FUNNEL_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';

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
): Promise<ActivityDistribution[]> {
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

function processActivityDistributionResults(rows: any[]): ActivityDistribution[] {
  const channelMap = new Map<string, ActivityDistribution>();
  
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
    dist.currentPeriod.sort((a, b) => getDayOrderIndex(a.dayOfWeek) - getDayOrderIndex(b.dayOfWeek));
    dist.comparisonPeriod.sort((a, b) => getDayOrderIndex(a.dayOfWeek) - getDayOrderIndex(b.dayOfWeek));
    dist.variance.sort((a, b) => getDayOrderIndex(a.dayOfWeek) - getDayOrderIndex(b.dayOfWeek));
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
  
  const automatedFilter = getAutomatedFilter(filters.includeAutomated);
  const sgaFilter = filters.sga 
    ? `AND task_executor_name = @sga` 
    : '';
  
  const query = `
    -- SMS Response Rate: Count distinct people texted in the date range,
    -- and of those people, how many responded (also within the same date range)
    WITH outgoing AS (
      -- People who received outbound SMS in the selected date range
      SELECT DISTINCT task_who_id as lead_id
      FROM \`${ACTIVITY_VIEW}\`
      WHERE activity_channel_group = 'SMS'
        AND direction = 'Outbound'
        AND task_created_date_est >= @startDate
        AND task_created_date_est <= @endDate
        AND task_created_date_est <= CURRENT_DATE('America/New_York')  -- Exclude future dates
        AND task_who_id IS NOT NULL
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
    ),
    incoming AS (
      -- People who sent inbound SMS in the selected date range
      SELECT DISTINCT task_who_id as lead_id
      FROM \`${ACTIVITY_VIEW}\`
      WHERE activity_channel_group = 'SMS'
        AND direction = 'Inbound'
        AND task_created_date_est >= @startDate
        AND task_created_date_est <= @endDate
        AND task_created_date_est <= CURRENT_DATE('America/New_York')  -- Exclude future dates
        AND task_who_id IS NOT NULL
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
    )
    SELECT
      COUNT(DISTINCT o.lead_id) as leads_texted,
      -- Only count people who were texted (in outgoing) AND responded (in incoming)
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
    ? `AND task_executor_name = @sga` 
    : '';
  
  // Build call type filter
  let callTypeFilter = '';
  switch (filters.callTypeFilter) {
    case 'cold_calls':
      callTypeFilter = 'AND is_true_cold_call = 1';
      break;
    case 'scheduled_calls':
      callTypeFilter = 'AND is_true_cold_call = 0 AND direction = \'Outbound\'';
      break;
    case 'all_outbound':
    default:
      callTypeFilter = 'AND direction = \'Outbound\'';
      break;
  }
  
  const query = `
    SELECT
      COUNT(*) as total_calls,
      COUNTIF(
        call_duration_seconds > 120
        OR task_subject LIKE '%answered%'
      ) as answered_calls,
      SAFE_DIVIDE(
        COUNTIF(
          call_duration_seconds > 120
          OR task_subject LIKE '%answered%'
        ),
        COUNT(*)
      ) as answer_rate
    FROM \`${ACTIVITY_VIEW}\`
    WHERE activity_channel_group = 'Call'
      ${callTypeFilter}
      AND task_created_date_est >= @startDate
      AND task_created_date_est <= @endDate
      AND task_subject NOT LIKE '%voicemail%'
      AND task_subject NOT LIKE '%Left VM%'
      AND SGA_IsActive = TRUE
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
): Promise<ActivityBreakdown[]> {
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
        is_true_cold_call
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
          -- Call subtypes (only outbound to match scorecards)
          WHEN corrected_channel_group = 'Call' AND is_true_cold_call = 1 THEN 'Cold Call'
          WHEN corrected_channel_group = 'Call' AND direction = 'Outbound' THEN 'Scheduled Call'
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

function processActivityBreakdownResults(rows: any[]): ActivityBreakdown[] {
  const channelMap = new Map<string, ActivityBreakdown>();
  
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
  
  const automatedFilter = getAutomatedFilter(filters.includeAutomated);
  const sgaFilter = filters.sga 
    ? `AND task_executor_name = @sga` 
    : '';
  
  // Determine target channel for filtering (must be defined before SQL template)
  // CRITICAL: This determines which channel to filter by in the drilldown
  let targetChannel: ActivityChannel | undefined = undefined;
  if (activityType && activityType.trim() !== '') {
    const activityTypeMap: Record<string, ActivityChannel> = {
      'cold_calls': 'Call',
      'outbound_calls': 'Call',
      'sms_outbound': 'SMS',
      'sms_inbound': 'SMS',
      'linkedin_messages': 'LinkedIn',
      'emails_manual': 'Email',
      'emails_engagement': 'Email (Engagement)',
    };
    targetChannel = activityTypeMap[activityType] || channel;
  } else if (channel) {
    targetChannel = channel;
  }
  
  // Debug: Log targetChannel to help diagnose filtering issues
  if (process.env.NODE_ENV === 'development') {
    console.log('[getActivityRecords] targetChannel:', targetChannel, 'activityType:', activityType, 'channel:', channel);
  }
  
  // Build activity type filter - only apply direction/cold_call filters early
  // Channel filtering happens AFTER classification to match getActivityBreakdown logic
  let activityTypeFilter = '';
  if (activityType === 'cold_calls') {
    activityTypeFilter = ` AND is_true_cold_call = 1`;
  } else if (activityType === 'outbound_calls') {
    activityTypeFilter = ` AND direction = 'Outbound'`;
  } else if (activityType === 'sms_outbound') {
    activityTypeFilter = ` AND direction = 'Outbound'`;
  } else if (activityType === 'sms_inbound') {
    activityTypeFilter = ` AND direction = 'Inbound'`;
  }
  
  const dayFilter = (dayOfWeek !== undefined && dayOfWeek !== null)
    ? `AND EXTRACT(DAYOFWEEK FROM task_created_date_est) = @dayOfWeek` 
    : '';
  
  // Get task descriptions for classification override
  const query = `
    WITH view_data AS (
      SELECT DISTINCT
        task_id,
        task_created_date_utc,
        task_created_date_est,
        task_subject,
        task_subtype,
        activity_channel_group,
        direction,
        task_executor_name,
        Prospect_Name,
        Opp_Name,
        Full_prospect_id__c,
        Full_Opportunity_ID__c,
        Original_source,
        Channel_Grouping_Name,
        call_duration_seconds,
        is_true_cold_call
      FROM \`${ACTIVITY_VIEW}\`
      WHERE task_created_date_est >= @startDate
        AND task_created_date_est <= @endDate
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
        ${activityTypeFilter}
        ${dayFilter}
    ),
    task_descriptions AS (
      SELECT
        t.Id as task_id,
        t.Description as task_description
      FROM \`savvy-gtm-analytics.SavvyGTMData.Task\` t
      WHERE t.IsDeleted = FALSE
        AND t.Id IN (SELECT task_id FROM view_data)
    ),
    classified_records AS (
      SELECT DISTINCT
        v.task_id,
        v.task_created_date_utc,
        v.task_created_date_est,
        v.task_subject,
        v.task_subtype,
        v.activity_channel_group as raw_channel_group,  -- Keep raw channel for additional filtering
        -- Override activity_channel_group based on task_subject AND task_description
        -- CRITICAL: Subject field is PRIMARY source of truth - check it FIRST
        CASE
          -- ============================================
          -- PRIORITY 1: EXPLICIT SUBJECT-BASED CLASSIFICATION (HIGHEST PRIORITY)
          -- ============================================
          -- These subjects ALWAYS map to their channels, regardless of raw channel
          WHEN v.task_subject = 'LinkedIn Message' THEN 'LinkedIn'
          WHEN v.task_subject = 'LinkedIn Connect' THEN 'LinkedIn'
          WHEN v.task_subject = 'Outgoing SMS' THEN 'SMS'
          WHEN v.task_subject = 'Incoming SMS' THEN 'SMS'
          
          -- ============================================
          -- PRIORITY 2: SUBJECT PATTERN MATCHING
          -- ============================================
          -- Check subject patterns (subject is more reliable than raw channel)
          WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%linkedin%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%linked in%'
          THEN 'LinkedIn'
          WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%sms%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%text%'  -- Catch "text 2", "text message", etc.
          THEN 'SMS'
          
          -- ============================================
          -- PRIORITY 3: RAW CHANNEL GROUP (if subject is ambiguous)
          -- ============================================
          -- Only use raw channel if subject doesn't give us clear signal
          WHEN v.activity_channel_group = 'SMS' THEN 'SMS'
          WHEN v.activity_channel_group = 'LinkedIn' THEN 'LinkedIn'
          WHEN v.activity_channel_group = 'Email (Engagement)' THEN 'Email (Engagement)'
          WHEN v.activity_channel_group = 'Email' THEN 'Email'
          
          -- ============================================
          -- PRIORITY 4: DESCRIPTION-BASED (last resort)
          -- ============================================
          -- Only check description if subject and raw channel are ambiguous
          WHEN LOWER(COALESCE(td.task_description, '')) LIKE '%linkedin%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%sms%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%email%'
            AND LOWER(COALESCE(td.task_description, '')) NOT LIKE '%text%'
          THEN 'LinkedIn'
          WHEN LOWER(COALESCE(td.task_description, '')) LIKE '%sms%'
            OR LOWER(COALESCE(td.task_description, '')) LIKE '%text message%'
            OR LOWER(COALESCE(td.task_description, '')) LIKE '%text%'
          THEN 'SMS'
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
        v.task_executor_name,
        COALESCE(v.Prospect_Name, v.Opp_Name, 'Unknown') as prospect_name,
        v.Full_prospect_id__c,
        v.Full_Opportunity_ID__c,
        v.Original_source,
        v.Channel_Grouping_Name,
        v.call_duration_seconds,
        v.is_true_cold_call
      FROM view_data v
      LEFT JOIN task_descriptions td ON v.task_id = td.task_id
      WHERE v.activity_channel_group != 'Marketing'  -- Exclude Marketing
    ),
    filtered_by_activity_type AS (
      SELECT DISTINCT
        cr.task_id,
        cr.task_created_date_utc,
        cr.task_created_date_est,
        cr.task_subject,
        cr.task_subtype,
        cr.corrected_channel_group,
        cr.raw_channel_group,  -- Include raw channel for additional filtering
        cr.direction,
        cr.task_executor_name,
        cr.prospect_name,
        cr.Full_prospect_id__c,
        cr.Full_Opportunity_ID__c,
        cr.Original_source,
        cr.Channel_Grouping_Name,
        cr.call_duration_seconds,
        cr.is_true_cold_call
      FROM classified_records cr
      WHERE 1=1
        ${targetChannel ? `
          -- CRITICAL: Filter by target channel - this ensures we only show records for the selected channel
          -- This filter MUST be applied when targetChannel is set (e.g., when clicking Email card)
          AND cr.corrected_channel_group = @activityChannel
          -- CRITICAL: Double-check to prevent SMS/LinkedIn from appearing in Email drilldown
          ${targetChannel === 'Email' ? `
            -- CRITICAL: Subject field is PRIMARY - if subject indicates SMS/LinkedIn, exclude
            AND cr.task_subject != 'Outgoing SMS'
            AND cr.task_subject != 'Incoming SMS'
            AND cr.task_subject != 'LinkedIn Message'
            AND cr.task_subject != 'LinkedIn Connect'
            AND LOWER(COALESCE(cr.task_subject, '')) NOT LIKE '%sms%'
            AND LOWER(COALESCE(cr.task_subject, '')) NOT LIKE '%linkedin%'
            AND LOWER(COALESCE(cr.task_subject, '')) NOT LIKE '%text%'
            -- Double-check corrected and raw channel groups
            AND cr.raw_channel_group != 'SMS'
            AND cr.raw_channel_group != 'LinkedIn'
            AND cr.corrected_channel_group != 'SMS'
            AND cr.corrected_channel_group != 'LinkedIn'
          ` : ''}
          ${activityType === 'cold_calls' ? `AND cr.is_true_cold_call = 1` : ''}
          ${activityType === 'outbound_calls' ? `AND cr.direction = 'Outbound'` : ''}
          ${activityType === 'sms_outbound' ? `AND cr.direction = 'Outbound'` : ''}
          ${activityType === 'sms_inbound' ? `AND cr.direction = 'Inbound'` : ''}
        ` : `
          -- WARNING: No targetChannel set - showing ALL records (this should not happen for scorecard clicks)
        `}
    )
    SELECT
      task_id as taskId,
      CAST(task_created_date_utc AS STRING) as createdDate,
      CAST(task_created_date_est AS STRING) as createdDateEST,
      corrected_channel_group as activityChannel,
      CASE
        WHEN corrected_channel_group = 'LinkedIn' THEN 'LinkedIn Message'
        WHEN corrected_channel_group = 'Email' THEN 'Email'
        WHEN corrected_channel_group = 'Email (Engagement)' THEN 'Email (Engagement)'
        WHEN corrected_channel_group = 'Call' AND is_true_cold_call = 1 THEN 'Cold Call'
        WHEN corrected_channel_group = 'Call' AND direction = 'Inbound' THEN 'Inbound Call'
        WHEN corrected_channel_group = 'Call' THEN 'Outbound Call'
        WHEN corrected_channel_group = 'SMS' AND direction = 'Outbound' THEN 'Outbound SMS'
        WHEN corrected_channel_group = 'SMS' THEN 'Inbound SMS'
        ELSE corrected_channel_group
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
    FROM filtered_by_activity_type
    ORDER BY task_created_date_est DESC
    LIMIT @pageSize
    OFFSET @offset
  `;
  
  // Count query for total - use same filter logic as main query
  // CRITICAL: Do NOT apply direction/cold_call filters in view_data
  // Apply them AFTER classification in filtered_by_activity_type, just like the main query
  const countQuery = `
    WITH view_data AS (
      SELECT DISTINCT
        task_id,
        task_created_date_est,
        task_subject,
        task_subtype,
        activity_channel_group,
        direction,
        task_executor_name,
        is_true_cold_call
      FROM \`${ACTIVITY_VIEW}\`
      WHERE task_created_date_est >= @startDate
        AND task_created_date_est <= @endDate
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
        ${dayFilter}
    ),
    task_descriptions AS (
      SELECT
        t.Id as task_id,
        t.Description as task_description
      FROM \`savvy-gtm-analytics.SavvyGTMData.Task\` t
      WHERE t.IsDeleted = FALSE
        AND t.Id IN (SELECT task_id FROM view_data)
    ),
    classified_records AS (
      SELECT DISTINCT
        v.task_id,
        v.task_subject,  -- Include subject for filtering
        v.activity_channel_group as raw_channel_group,  -- Keep raw channel for additional filtering (needed for Email filter)
        CASE
          -- ============================================
          -- PRIORITY 1: EXPLICIT SUBJECT-BASED CLASSIFICATION (HIGHEST PRIORITY)
          -- ============================================
          -- These subjects ALWAYS map to their channels, regardless of raw channel
          WHEN v.task_subject = 'LinkedIn Message' THEN 'LinkedIn'
          WHEN v.task_subject = 'LinkedIn Connect' THEN 'LinkedIn'
          WHEN v.task_subject = 'Outgoing SMS' THEN 'SMS'
          WHEN v.task_subject = 'Incoming SMS' THEN 'SMS'
          
          -- ============================================
          -- PRIORITY 2: SUBJECT PATTERN MATCHING
          -- ============================================
          -- Check subject patterns (subject is more reliable than raw channel)
          WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%linkedin%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%linked in%'
          THEN 'LinkedIn'
          WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%sms%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%text%'  -- Catch "text 2", "text message", etc.
          THEN 'SMS'
          
          -- ============================================
          -- PRIORITY 3: RAW CHANNEL GROUP (if subject is ambiguous)
          -- ============================================
          -- Only use raw channel if subject doesn't give us clear signal
          WHEN v.activity_channel_group = 'SMS' THEN 'SMS'
          WHEN v.activity_channel_group = 'LinkedIn' THEN 'LinkedIn'
          WHEN v.activity_channel_group = 'Email (Engagement)' THEN 'Email (Engagement)'
          WHEN v.activity_channel_group = 'Email' THEN 'Email'
          
          -- ============================================
          -- PRIORITY 4: DESCRIPTION-BASED (last resort)
          -- ============================================
          -- Only check description if subject and raw channel are ambiguous
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
        END as corrected_channel_group,
        v.direction,
        v.is_true_cold_call
      FROM view_data v
      LEFT JOIN task_descriptions td ON v.task_id = td.task_id
      WHERE v.activity_channel_group != 'Marketing'
    ),
    filtered_by_activity_type AS (
      SELECT DISTINCT 
        task_id,
        corrected_channel_group,
        raw_channel_group,  -- Include for Email filter checks
        direction,
        is_true_cold_call
      FROM classified_records
      WHERE 1=1
        ${targetChannel ? `
          -- CRITICAL: Filter by target channel - this ensures we only show records for the selected channel
          AND corrected_channel_group = @activityChannel
          -- CRITICAL: Double-check to prevent SMS/LinkedIn from appearing in Email drilldown
          ${targetChannel === 'Email' ? `
            -- CRITICAL: Subject field is PRIMARY - if subject indicates SMS/LinkedIn, exclude
            -- We check both raw and corrected channel groups, and also check subject patterns
            AND raw_channel_group != 'SMS'
            AND raw_channel_group != 'LinkedIn'
            AND corrected_channel_group != 'SMS'
            AND corrected_channel_group != 'LinkedIn'
            -- Note: task_subject is available in classified_records but not selected in filtered_by_activity_type
            -- The classification logic should have already handled this, but we double-check channels
          ` : ''}
          ${activityType === 'cold_calls' ? `AND is_true_cold_call = 1` : ''}
          ${activityType === 'outbound_calls' ? `AND direction = 'Outbound'` : ''}
          ${activityType === 'sms_outbound' ? `AND direction = 'Outbound'` : ''}
          ${activityType === 'sms_inbound' ? `AND direction = 'Inbound'` : ''}
        ` : ''}
    )
    SELECT COUNT(DISTINCT task_id) as total
    FROM filtered_by_activity_type
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
  
  // CRITICAL: Always set activityChannel parameter if targetChannel is defined
  // This ensures the filter is applied in the SQL query
  if (targetChannel) {
    params.activityChannel = targetChannel;
    // Debug log to verify parameter is set
    if (process.env.NODE_ENV === 'development') {
      console.log('[getActivityRecords] Setting activityChannel param:', targetChannel);
    }
  } else {
    // Debug log if targetChannel is not set when it should be
    if (process.env.NODE_ENV === 'development') {
      console.warn('[getActivityRecords] WARNING: targetChannel is not set!', { activityType, channel });
    }
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
}> {
  const range = getDateRange(
    filters.dateRangeType,
    filters.startDate,
    filters.endDate
  );
  
  const automatedFilter = getAutomatedFilter(filters.includeAutomated);
  const sgaFilter = filters.sga 
    ? `AND task_executor_name = @sga` 
    : '';
  
  // Get task descriptions for classification
  const query = `
    WITH view_data AS (
      SELECT DISTINCT
        task_id,
        task_subject,
        task_subtype,
        activity_channel_group,
        direction,
        is_true_cold_call
      FROM \`${ACTIVITY_VIEW}\`
      WHERE task_created_date_est >= @startDate
        AND task_created_date_est <= @endDate
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
    classified_records AS (
      SELECT DISTINCT
        v.task_id,
        -- CRITICAL: Use the SAME priority-based classification logic as getActivityRecords
        -- This ensures scorecard and drilldown counts match exactly
        CASE
          -- ============================================
          -- PRIORITY 1: EXPLICIT SUBJECT-BASED CLASSIFICATION (HIGHEST PRIORITY)
          -- ============================================
          -- These subjects ALWAYS map to their channels, regardless of raw channel
          WHEN v.task_subject = 'LinkedIn Message' THEN 'LinkedIn'
          WHEN v.task_subject = 'LinkedIn Connect' THEN 'LinkedIn'
          WHEN v.task_subject = 'Outgoing SMS' THEN 'SMS'
          WHEN v.task_subject = 'Incoming SMS' THEN 'SMS'
          
          -- ============================================
          -- PRIORITY 2: SUBJECT PATTERN MATCHING
          -- ============================================
          -- Check subject patterns (subject is more reliable than raw channel)
          WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%linkedin%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%linked in%'
          THEN 'LinkedIn'
          WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%sms%' 
            OR LOWER(COALESCE(v.task_subject, '')) LIKE '%text%'  -- Catch "text 2", "text message", etc.
          THEN 'SMS'
          
          -- ============================================
          -- PRIORITY 3: RAW CHANNEL GROUP (if subject is ambiguous)
          -- ============================================
          -- Only use raw channel if subject doesn't give us clear signal
          WHEN v.activity_channel_group = 'SMS' THEN 'SMS'
          WHEN v.activity_channel_group = 'LinkedIn' THEN 'LinkedIn'
          WHEN v.activity_channel_group = 'Email (Engagement)' THEN 'Email (Engagement)'
          WHEN v.activity_channel_group = 'Email' THEN 'Email'
          
          -- ============================================
          -- PRIORITY 4: DESCRIPTION-BASED (last resort)
          -- ============================================
          -- Only check description if subject and raw channel are ambiguous
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
        END as corrected_channel_group,
        v.direction,
        v.is_true_cold_call
      FROM view_data v
      LEFT JOIN task_descriptions td ON v.task_id = td.task_id
      WHERE v.activity_channel_group != 'Marketing'
    )
    SELECT
      COUNTIF(corrected_channel_group = 'Call' AND is_true_cold_call = 1) as cold_calls,
      COUNTIF(corrected_channel_group = 'Call' AND direction = 'Outbound') as outbound_calls,
      COUNTIF(corrected_channel_group = 'SMS' AND direction = 'Outbound') as sms_outbound,
      COUNTIF(corrected_channel_group = 'SMS' AND direction = 'Inbound') as sms_inbound,
      COUNTIF(corrected_channel_group = 'LinkedIn') as linkedin_messages,
      COUNTIF(corrected_channel_group = 'Email') as emails_manual,
      COUNTIF(corrected_channel_group = 'Email (Engagement)') as emails_engagement
    FROM classified_records
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
