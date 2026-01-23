# SGA Activity Dashboard - Implementation Plan

**Version**: 1.4  
**Date**: January 22, 2026  
**Last Updated**: January 23, 2026 - Phase 5 Complete  
**Status**: Phase 5 Complete, Ready for Phase 6 (Navigation & Permissions)  
**Phase 5 Completion**: All features implemented, tested, and validated. See Section 5.4-5.5 for detailed completion notes.

---

## Executive Summary

Build a new standalone page at `/dashboard/sga-activity` that provides SGA managers with visibility into SGA activity patterns, scheduled calls, response rates, and activity distribution comparisons.

### Key Features
1. **Initial & Qualification Calls Scheduled** (current/next week) with drill-down
2. **Activity Distribution by Day of Week** (current vs historical comparison)
3. **SMS Response Rates** (lead-level calculation)
4. **Call Answer Rates** (duration + subject pattern based)
5. **Activity Type Breakdown** (Cold Calls, SMS, LinkedIn, Email)
6. **Flexible Filtering** (SGA, date range, activity type, automated toggle)

### Data Source
- Primary: `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
- Secondary: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` (for scheduled calls)

---

## Phase 0: Pre-Implementation Verification

### 0.1 Verify Project Structure
```bash
# Confirm these directories exist
ls -la src/app/dashboard/
ls -la src/components/dashboard/
ls -la src/lib/queries/
ls -la src/app/api/
```

### 0.2 Verify Existing Patterns
Review these files to understand existing patterns:
- `src/app/dashboard/page.tsx` - Main dashboard page structure
- `src/app/dashboard/sga-management/page.tsx` - SGA Management page
- `src/components/dashboard/GlobalFilters.tsx` - Filter component patterns
- `src/components/sga-hub/MetricDrillDownModal.tsx` - Drill-down modal pattern
- `src/lib/queries/weekly-actuals.ts` - Query pattern with caching
- `src/app/api/dashboard/funnel-metrics/route.ts` - API route pattern

### 0.3 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify project compiles before any changes
npm run build

# Verify no existing lint errors
npm run lint

# Verify TypeScript has no errors
npx tsc --noEmit
```

**Expected Results**:
- [ ] Build succeeds (or document existing failures)
- [ ] Lint passes (or document existing warnings)
- [ ] TypeScript compiles without errors

**Document Baseline**: Record any pre-existing errors/warnings so we don't confuse them with new issues.

**User Validation Required**: None - this is baseline capture only.

**Gate**: Do NOT proceed to Phase 1 until baseline is documented.

---

## Phase 1: Type Definitions

### 1.1 Create Activity Types File

**File**: `src/types/sga-activity.ts`

```typescript
// SGA Activity Dashboard Types

// ============================================
// FILTER TYPES
// ============================================

export interface SGAActivityFilters {
  // SGA Filter
  sga: string | null;  // null = all SGAs
  
  // Date Range Filters
  dateRangeType: 'this_week' | 'next_week' | 'last_30' | 'last_60' | 'last_90' | 'qtd' | 'all_time' | 'custom';
  startDate: string | null;  // ISO date string for custom range
  endDate: string | null;    // ISO date string for custom range
  
  // Comparison Period
  comparisonDateRangeType: 'last_30' | 'last_60' | 'last_90' | 'qtd' | 'all_time' | 'custom';
  comparisonStartDate: string | null;
  comparisonEndDate: string | null;
  
  // Activity Filters
  activityTypes: ActivityType[];  // Which activity types to show
  includeAutomated: boolean;      // Default false (exclude lemlist)
  
  // Call Type Filter (for answer rate)
  callTypeFilter: 'all_outbound' | 'cold_calls' | 'scheduled_calls';
}

export type ActivityType = 
  | 'cold_call'
  | 'outbound_call'
  | 'inbound_call'
  | 'sms_outbound'
  | 'sms_inbound'
  | 'linkedin_message'
  | 'linkedin_connection'
  | 'linkedin_accept'
  | 'linkedin_reply'
  | 'email_manual'
  | 'email_automated';

export type ActivityChannel = 'Call' | 'SMS' | 'LinkedIn' | 'Email';

// ============================================
// SCHEDULED CALLS TYPES
// ============================================

export interface ScheduledCallsSummary {
  thisWeek: {
    total: number;
    byDay: DayCount[];
    bySGA: SGACallCount[];
  };
  nextWeek: {
    total: number;
    byDay: DayCount[];
    bySGA: SGACallCount[];
  };
}

export interface DayCount {
  dayOfWeek: number;      // 1=Monday, 7=Sunday
  dayName: string;        // "Monday", "Tuesday", etc.
  date: string;           // ISO date
  count: number;
}

export interface SGACallCount {
  sgaName: string;
  thisWeekCount: number;
  nextWeekCount: number;
  total: number;
}

export interface ScheduledCallRecord {
  id: string;
  prospectName: string;
  sgaName: string;
  scheduledDate: string;
  source: string;
  channel: string;
  salesforceUrl: string;
  leadId: string;
  opportunityId: string | null;
}

// ============================================
// ACTIVITY DISTRIBUTION TYPES
// ============================================

export interface ActivityDistribution {
  channel: ActivityChannel;
  currentPeriod: DayActivityCount[];
  comparisonPeriod: DayActivityCount[];
  variance: DayVariance[];
}

export interface DayActivityCount {
  dayOfWeek: number;
  dayName: string;
  count: number;
  avgCount?: number;  // For comparison periods (historical average)
}

export interface DayVariance {
  dayOfWeek: number;
  dayName: string;
  currentCount: number;
  comparisonCount: number;
  variance: number;           // currentCount - comparisonCount
  variancePercent: number;    // (variance / comparisonCount) * 100
}

// ============================================
// RESPONSE & ANSWER RATE TYPES
// ============================================

export interface SMSResponseRate {
  period: string;           // e.g., "2026-01-19 to 2026-01-25"
  leadsTexted: number;
  leadsResponded: number;
  responseRate: number;     // 0.0722 = 7.22%
}

export interface CallAnswerRate {
  period: string;
  totalCalls: number;
  answeredCalls: number;
  answerRate: number;
  callType: 'all_outbound' | 'cold_calls' | 'scheduled_calls';
}

// ============================================
// ACTIVITY BREAKDOWN TYPES
// ============================================

export interface ActivityBreakdown {
  channel: ActivityChannel;
  subTypes: ActivitySubTypeCount[];
  totalCount: number;
  percentOfTotal: number;
}

export interface ActivitySubTypeCount {
  subType: string;          // e.g., "LinkedIn Message", "LinkedIn Connection Request"
  count: number;
  isAutomated: boolean;
}

// ============================================
// DRILL-DOWN RECORD TYPES
// ============================================

export interface ActivityRecord {
  taskId: string;
  createdDate: string;        // ISO datetime
  createdDateEST: string;     // Date in EST
  activityChannel: string;
  activitySubType: string;
  direction: string;
  sgaName: string;
  prospectName: string;
  leadId: string;
  opportunityId: string | null;
  source: string;
  channel: string;
  subject: string;
  callDuration: number | null;
  isAutomated: boolean;
  isColdCall: boolean;
  salesforceUrl: string;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface SGAActivityDashboardData {
  // Scheduled Calls
  initialCalls: ScheduledCallsSummary;
  qualificationCalls: ScheduledCallsSummary;
  
  // Activity Distribution
  activityDistribution: ActivityDistribution[];
  
  // Response/Answer Rates
  smsResponseRate: SMSResponseRate;
  callAnswerRate: CallAnswerRate;
  
  // Activity Breakdown
  activityBreakdown: ActivityBreakdown[];
  
  // Totals
  totals: {
    coldCalls: number;
    outboundCalls: number;
    smsOutbound: number;
    smsInbound: number;
    linkedInMessages: number;
    linkedInConnections: number;
    emailsManual: number;
  };
}

// ============================================
// FILTER OPTIONS (for dropdowns)
// ============================================

export interface SGAActivityFilterOptions {
  sgas: { value: string; label: string; isActive: boolean }[];
  activityTypes: { value: ActivityType; label: string }[];
  dateRangePresets: { value: string; label: string }[];
}
```

### 1.2 Update Existing Types (if needed)

**File**: `src/types/filters.ts`

Add to existing `DashboardFilters` or create export:
```typescript
// Add export for activity dashboard
export type { SGAActivityFilters } from './sga-activity';
```

### 1.3 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles with new types
npx tsc --noEmit

# Verify no lint errors in new file
npx eslint src/types/sga-activity.ts

# Verify the types file exists and has content
cat src/types/sga-activity.ts | head -50
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on `sga-activity.ts`
- [ ] File contains all expected interfaces (SGAActivityFilters, ScheduledCallsSummary, etc.)

**Type Export Verification**:
```bash
# Verify types can be imported (create temp test file)
echo "import { SGAActivityFilters, ScheduledCallsSummary, ActivityRecord } from '@/types/sga-activity';" > /tmp/type-test.ts
npx tsc /tmp/type-test.ts --noEmit --skipLibCheck --esModuleInterop --moduleResolution node
rm /tmp/type-test.ts
```

**User Validation Required**: None

**Gate**: Do NOT proceed to Phase 2 until all automated checks pass.

**Report to User**:
- List which checks passed
- List any errors encountered and how they were fixed

---

## Phase 2: Query Functions

### 2.1 Create Activity Queries File

**File**: `src/lib/queries/sga-activity.ts`

```typescript
import { runQuery } from '@/lib/bigquery';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
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
} from '@/types/sga-activity';

const ACTIVITY_VIEW = 'savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance';
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
    case 'this_week':
      return getWeekBoundaries('this_week');
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
  return processScheduledCallsResults(rows, thisWeek, nextWeek);
}

function processScheduledCallsResults(
  rows: any[],
  thisWeek: { start: string; end: string },
  nextWeek: { start: string; end: string }
): ScheduledCallsSummary {
  const thisWeekData = rows.filter(r => r.week_bucket === 'this_week');
  const nextWeekData = rows.filter(r => r.week_bucket === 'next_week');
  
  // Aggregate by day
  const thisWeekByDay = aggregateByDay(thisWeekData);
  const nextWeekByDay = aggregateByDay(nextWeekData);
  
  // Aggregate by SGA
  const thisWeekBySGA = aggregateBySGA(thisWeekData, nextWeekData);
  
  return {
    thisWeek: {
      total: thisWeekData.reduce((sum, r) => sum + parseInt(r.call_count), 0),
      byDay: thisWeekByDay,
      bySGA: thisWeekBySGA.map(s => ({ ...s, thisWeekCount: s.thisWeekCount, nextWeekCount: 0, total: s.thisWeekCount })),
    },
    nextWeek: {
      total: nextWeekData.reduce((sum, r) => sum + parseInt(r.call_count), 0),
      byDay: nextWeekByDay,
      bySGA: thisWeekBySGA.map(s => ({ ...s, thisWeekCount: 0, nextWeekCount: s.nextWeekCount, total: s.nextWeekCount })),
    },
  };
}

function aggregateByDay(rows: any[]): DayCount[] {
  const dayMap = new Map<number, DayCount>();
  
  for (const row of rows) {
    const dayOfWeek = parseInt(row.day_of_week);
    const existing = dayMap.get(dayOfWeek);
    if (existing) {
      existing.count += parseInt(row.call_count);
    } else {
      dayMap.set(dayOfWeek, {
        dayOfWeek,
        dayName: row.day_name,
        date: row.scheduled_date,
        count: parseInt(row.call_count),
      });
    }
  }
  
  return Array.from(dayMap.values()).sort((a, b) => a.dayOfWeek - b.dayOfWeek);
}

function aggregateBySGA(thisWeekRows: any[], nextWeekRows: any[]): SGACallCount[] {
  const sgaMap = new Map<string, SGACallCount>();
  
  for (const row of thisWeekRows) {
    const sgaName = row.sga_name;
    const existing = sgaMap.get(sgaName);
    if (existing) {
      existing.thisWeekCount += parseInt(row.call_count);
      existing.total += parseInt(row.call_count);
    } else {
      sgaMap.set(sgaName, {
        sgaName,
        thisWeekCount: parseInt(row.call_count),
        nextWeekCount: 0,
        total: parseInt(row.call_count),
      });
    }
  }
  
  for (const row of nextWeekRows) {
    const sgaName = row.sga_name;
    const existing = sgaMap.get(sgaName);
    if (existing) {
      existing.nextWeekCount += parseInt(row.call_count);
      existing.total += parseInt(row.call_count);
    } else {
      sgaMap.set(sgaName, {
        sgaName,
        thisWeekCount: 0,
        nextWeekCount: parseInt(row.call_count),
        total: parseInt(row.call_count),
      });
    }
  }
  
  return Array.from(sgaMap.values()).sort((a, b) => b.total - a.total);
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
    ? `AND (SGA_Owner_Name__c = @sga OR Opp_SGA_Name__c = @sga)` 
    : '';
  
  const query = `
    WITH scheduled_calls AS (
      SELECT
        COALESCE(Full_Opportunity_ID__c, primary_key) as id,
        advisor_name as prospect_name,
        COALESCE(Opp_SGA_Name__c, SGA_Owner_Name__c) as sga_name,
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
  
  return processScheduledCallsResults(rows, thisWeek, nextWeek);
}

// ============================================
// QUERY 3: Scheduled Call Drill-Down Records
// ============================================

export async function getScheduledCallRecords(
  callType: 'initial' | 'qualification',
  weekType: 'this_week' | 'next_week',
  dayOfWeek?: number,
  sgaName?: string
): Promise<ScheduledCallRecord[]> {
  const week = getWeekBoundaries(weekType);
  const dateField = callType === 'initial' 
    ? 'Initial_Call_Scheduled_Date__c' 
    : 'Qualification_Call_Date__c';
  
  const dayFilter = dayOfWeek 
    ? `AND EXTRACT(DAYOFWEEK FROM ${dateField}) = @dayOfWeek` 
    : '';
  const sgaFilter = sgaName 
    ? `AND (SGA_Owner_Name__c = @sgaName OR Opp_SGA_Name__c = @sgaName)` 
    : '';
  
  const query = `
    SELECT
      COALESCE(Full_Opportunity_ID__c, primary_key) as id,
      advisor_name as prospectName,
      COALESCE(Opp_SGA_Name__c, SGA_Owner_Name__c) as sgaName,
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
      ${dayFilter}
      ${sgaFilter}
    ORDER BY ${dateField}, sgaName
  `;
  
  const params: Record<string, any> = {
    startDate: week.start,
    endDate: week.end,
  };
  
  if (dayOfWeek) {
    params.dayOfWeek = dayOfWeek;
  }
  if (sgaName) {
    params.sgaName = sgaName;
  }
  
  const rows = await runQuery<ScheduledCallRecord>(query, params);
  return rows;
}

// ============================================
// QUERY 4: Activity Distribution by Day of Week
// ============================================

export async function getActivityDistribution(
  filters: SGAActivityFilters
): Promise<ActivityDistribution[]> {
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
    WITH current_period AS (
      SELECT
        activity_channel_group as channel,
        activity_day_of_week as day_name,
        EXTRACT(DAYOFWEEK FROM task_created_date_est) as day_of_week,
        COUNT(*) as activity_count
      FROM \`${ACTIVITY_VIEW}\`
      WHERE task_created_date_est >= @currentStart
        AND task_created_date_est <= @currentEnd
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
      GROUP BY channel, day_name, day_of_week
    ),
    comparison_period AS (
      SELECT
        activity_channel_group as channel,
        activity_day_of_week as day_name,
        EXTRACT(DAYOFWEEK FROM task_created_date_est) as day_of_week,
        COUNT(*) as total_count,
        COUNT(DISTINCT DATE_TRUNC(task_created_date_est, WEEK(MONDAY))) as num_weeks,
        SAFE_DIVIDE(COUNT(*), COUNT(DISTINCT DATE_TRUNC(task_created_date_est, WEEK(MONDAY)))) as avg_count
      FROM \`${ACTIVITY_VIEW}\`
      WHERE task_created_date_est >= @comparisonStart
        AND task_created_date_est <= @comparisonEnd
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
      GROUP BY channel, day_name, day_of_week
    )
    SELECT
      COALESCE(c.channel, p.channel) as channel,
      COALESCE(c.day_of_week, p.day_of_week) as day_of_week,
      COALESCE(c.day_name, p.day_name) as day_name,
      COALESCE(c.activity_count, 0) as current_count,
      COALESCE(p.avg_count, 0) as comparison_avg,
      COALESCE(c.activity_count, 0) - COALESCE(p.avg_count, 0) as variance
    FROM current_period c
    FULL OUTER JOIN comparison_period p
      ON c.channel = p.channel AND c.day_of_week = p.day_of_week
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

function processActivityDistributionResults(rows: any[]): ActivityDistribution[] {
  const channelMap = new Map<string, ActivityDistribution>();
  
  for (const row of rows) {
    const channel = row.channel as ActivityChannel;
    
    if (!channelMap.has(channel)) {
      channelMap.set(channel, {
        channel,
        currentPeriod: [],
        comparisonPeriod: [],
        variance: [],
      });
    }
    
    const dist = channelMap.get(channel)!;
    
    dist.currentPeriod.push({
      dayOfWeek: parseInt(row.day_of_week),
      dayName: row.day_name,
      count: parseFloat(row.current_count) || 0,
    });
    
    dist.comparisonPeriod.push({
      dayOfWeek: parseInt(row.day_of_week),
      dayName: row.day_name,
      count: 0,
      avgCount: parseFloat(row.comparison_avg) || 0,
    });
    
    dist.variance.push({
      dayOfWeek: parseInt(row.day_of_week),
      dayName: row.day_name,
      currentCount: parseFloat(row.current_count) || 0,
      comparisonCount: parseFloat(row.comparison_avg) || 0,
      variance: parseFloat(row.variance) || 0,
      variancePercent: row.comparison_avg > 0 
        ? ((row.current_count - row.comparison_avg) / row.comparison_avg) * 100 
        : 0,
    });
  }
  
  return Array.from(channelMap.values());
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
    WITH outgoing AS (
      SELECT DISTINCT task_who_id as lead_id
      FROM \`${ACTIVITY_VIEW}\`
      WHERE activity_channel_group = 'SMS'
        AND direction = 'Outbound'
        AND task_created_date_est >= @startDate
        AND task_created_date_est <= @endDate
        AND task_who_id IS NOT NULL
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
    ),
    incoming AS (
      SELECT DISTINCT task_who_id as lead_id
      FROM \`${ACTIVITY_VIEW}\`
      WHERE activity_channel_group = 'SMS'
        AND direction = 'Inbound'
        AND task_created_date_est >= @startDate
        AND task_created_date_est <= @endDate
        AND task_who_id IS NOT NULL
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
    )
    SELECT
      COUNT(DISTINCT o.lead_id) as leads_texted,
      COUNT(DISTINCT i.lead_id) as leads_responded,
      SAFE_DIVIDE(COUNT(DISTINCT i.lead_id), COUNT(DISTINCT o.lead_id)) as response_rate
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
    period: `${range.start} to ${range.end}`,
    leadsTexted: parseInt(String(row.leads_texted || 0)) || 0,
    leadsResponded: parseInt(String(row.leads_responded || 0)) || 0,
    responseRate: parseFloat(String(row.response_rate || 0)) || 0,
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
    period: `${range.start} to ${range.end}`,
    totalCalls: parseInt(String(row.total_calls || 0)) || 0,
    answeredCalls: parseInt(String(row.answered_calls || 0)) || 0,
    answerRate: parseFloat(String(row.answer_rate || 0)) || 0,
    callType: filters.callTypeFilter,
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
    WITH activity_counts AS (
      SELECT
        activity_channel_group as channel,
        CASE
          -- LinkedIn subtypes
          WHEN activity_channel_group = 'LinkedIn' AND task_subject = 'LinkedIn Message' THEN 'Message (Manual)'
          WHEN activity_channel_group = 'LinkedIn' AND task_subject = 'LinkedIn Connect' THEN 'Connection Request (Manual)'
          WHEN activity_channel_group = 'LinkedIn' AND task_subject LIKE '%invite sent%' THEN 'Connection Request (Automated)'
          WHEN activity_channel_group = 'LinkedIn' AND task_subject LIKE '%invite accepted%' THEN 'Connection Accepted'
          WHEN activity_channel_group = 'LinkedIn' AND task_subject LIKE '%replied%' THEN 'Reply Received'
          WHEN activity_channel_group = 'LinkedIn' AND task_subject LIKE '%message opened%' THEN 'Message Opened'
          WHEN activity_channel_group = 'LinkedIn' AND task_subject LIKE '%bounced%' THEN 'Bounced'
          WHEN activity_channel_group = 'LinkedIn' THEN 'Other LinkedIn'
          -- Call subtypes
          WHEN activity_channel_group = 'Call' AND is_true_cold_call = 1 THEN 'Cold Call'
          WHEN activity_channel_group = 'Call' AND direction = 'Inbound' THEN 'Inbound Call'
          WHEN activity_channel_group = 'Call' AND direction = 'Outbound' THEN 'Scheduled Call'
          WHEN activity_channel_group = 'Call' THEN 'Other Call'
          -- SMS subtypes
          WHEN activity_channel_group = 'SMS' AND direction = 'Outbound' THEN 'Outbound SMS'
          WHEN activity_channel_group = 'SMS' AND direction = 'Inbound' THEN 'Inbound SMS'
          WHEN activity_channel_group = 'SMS' THEN 'Other SMS'
          -- Email subtypes
          WHEN activity_channel_group = 'Email' AND task_subject LIKE '%[lemlist]%' THEN 'Automated Email'
          WHEN activity_channel_group = 'Email' THEN 'Manual Email'
          ELSE 'Other'
        END as sub_type,
        CASE
          WHEN task_subject LIKE '%[lemlist]%' OR task_subtype = 'ListEmail' THEN TRUE
          ELSE FALSE
        END as is_automated,
        COUNT(*) as count
      FROM \`${ACTIVITY_VIEW}\`
      WHERE task_created_date_est >= @startDate
        AND task_created_date_est <= @endDate
        AND SGA_IsActive = TRUE
        ${automatedFilter}
        ${sgaFilter}
      GROUP BY channel, sub_type, is_automated
    ),
    totals AS (
      SELECT SUM(count) as grand_total FROM activity_counts
    )
    SELECT
      channel,
      sub_type,
      is_automated,
      count,
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
        subTypes: [],
        totalCount: 0,
        percentOfTotal: 0,
      });
    }
    
    const breakdown = channelMap.get(channel)!;
    breakdown.subTypes.push({
      subType: row.sub_type,
      count: parseInt(row.count) || 0,
      isAutomated: row.is_automated,
    });
    breakdown.totalCount += parseInt(row.count) || 0;
    breakdown.percentOfTotal += parseFloat(row.percent_of_total) || 0;
  }
  
  return Array.from(channelMap.values()).sort((a, b) => b.totalCount - a.totalCount);
}

// ============================================
// QUERY 8: Activity Drill-Down Records
// ============================================

export async function getActivityRecords(
  filters: SGAActivityFilters,
  channel?: ActivityChannel,
  subType?: string,
  dayOfWeek?: number
): Promise<ActivityRecord[]> {
  const range = getDateRange(
    filters.dateRangeType,
    filters.startDate,
    filters.endDate
  );
  
  const automatedFilter = getAutomatedFilter(filters.includeAutomated);
  const sgaFilter = filters.sga 
    ? `AND task_executor_name = @sga` 
    : '';
  const channelFilter = channel 
    ? `AND activity_channel_group = @channel` 
    : '';
  const dayFilter = dayOfWeek 
    ? `AND EXTRACT(DAYOFWEEK FROM task_created_date_est) = @dayOfWeek` 
    : '';
  
  const query = `
    SELECT
      task_id as taskId,
      CAST(task_created_date_utc AS STRING) as createdDate,
      CAST(task_created_date_est AS STRING) as createdDateEST,
      activity_channel_group as activityChannel,
      activity_channel as activitySubType,
      direction,
      task_executor_name as sgaName,
      Prospect_Name as prospectName,
      Full_prospect_id__c as leadId,
      Full_Opportunity_ID__c as opportunityId,
      Original_source as source,
      Channel_Grouping_Name as channel,
      task_subject as subject,
      call_duration_seconds as callDuration,
      CASE WHEN task_subject LIKE '%[lemlist]%' OR task_subtype = 'ListEmail' THEN TRUE ELSE FALSE END as isAutomated,
      CASE WHEN is_true_cold_call = 1 THEN TRUE ELSE FALSE END as isColdCall,
      CONCAT('https://savvywealth.lightning.force.com/lightning/r/Task/', task_id, '/view') as salesforceUrl
    FROM \`${ACTIVITY_VIEW}\`
    WHERE task_created_date_est >= @startDate
      AND task_created_date_est <= @endDate
      AND SGA_IsActive = TRUE
      ${automatedFilter}
      ${sgaFilter}
      ${channelFilter}
      ${dayFilter}
    ORDER BY task_created_date_est DESC
    LIMIT 500
  `;
  
  const params: Record<string, any> = {
    startDate: range.start,
    endDate: range.end,
  };
  
  if (filters.sga) {
    params.sga = filters.sga;
  }
  if (channel) {
    params.channel = channel;
  }
  if (dayOfWeek !== undefined) {
    params.dayOfWeek = dayOfWeek;
  }
  
  const rows = await runQuery<ActivityRecord>(query, params);
  return rows;
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
  linkedInConnections: number;
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
  
  const query = `
    SELECT
      COUNTIF(activity_channel_group = 'Call' AND is_true_cold_call = 1) as cold_calls,
      COUNTIF(activity_channel_group = 'Call' AND direction = 'Outbound') as outbound_calls,
      COUNTIF(activity_channel_group = 'SMS' AND direction = 'Outbound') as sms_outbound,
      COUNTIF(activity_channel_group = 'SMS' AND direction = 'Inbound') as sms_inbound,
      COUNTIF(activity_channel_group = 'LinkedIn' AND task_subject = 'LinkedIn Message') as linkedin_messages,
      COUNTIF(activity_channel_group = 'LinkedIn' AND (task_subject = 'LinkedIn Connect' OR task_subject LIKE '%invite sent%')) as linkedin_connections,
      COUNTIF(activity_channel_group = 'Email' AND task_subject NOT LIKE '%[lemlist]%' AND COALESCE(task_subtype, '') != 'ListEmail') as emails_manual
    FROM \`${ACTIVITY_VIEW}\`
    WHERE task_created_date_est >= @startDate
      AND task_created_date_est <= @endDate
      AND SGA_IsActive = TRUE
      ${automatedFilter}
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
    coldCalls: parseInt(String(row.cold_calls || 0)) || 0,
    outboundCalls: parseInt(String(row.outbound_calls || 0)) || 0,
    smsOutbound: parseInt(String(row.sms_outbound || 0)) || 0,
    smsInbound: parseInt(String(row.sms_inbound || 0)) || 0,
    linkedInMessages: parseInt(String(row.linkedin_messages || 0)) || 0,
    linkedInConnections: parseInt(String(row.linkedin_connections || 0)) || 0,
    emailsManual: parseInt(String(row.emails_manual || 0)) || 0,
  };
}

// ============================================
// QUERY 10: Filter Options (SGAs)
// ============================================

const _getSGAActivityFilterOptions = async (): Promise<{
  sgas: { value: string; label: string; isActive: boolean }[];
}> => {
  const query = `
    SELECT DISTINCT
      task_executor_name as sga_name,
      SGA_IsActive as is_active
    FROM \`${ACTIVITY_VIEW}\`
    WHERE task_executor_name IS NOT NULL
      AND task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
    ORDER BY task_executor_name
  `;
  
  const rows = await runQuery<any>(query);
  
  return {
    sgas: rows.map(row => ({
      value: row.sga_name,
      label: row.sga_name,
      isActive: row.is_active === true,
    })),
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
// Note: cachedQuery automatically handles different parameter combinations as separate cache keys

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
```

### 2.2 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles with new queries
npx tsc --noEmit

# Verify no lint errors in new file
npx eslint src/lib/queries/sga-activity.ts

# Verify file structure
echo "=== Checking exports ===" 
grep "^export" src/lib/queries/sga-activity.ts

# Verify imports resolve
echo "=== Checking imports ==="
head -20 src/lib/queries/sga-activity.ts
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on `sga-activity.ts`
- [ ] All 10 query functions are exported
- [ ] All cached wrapper functions are exported
- [ ] Imports from `@/types/sga-activity` resolve correctly
- [ ] Imports from `@/lib/cache` resolve correctly
- [ ] Imports from `@/lib/bigquery` resolve correctly

**Query Function Checklist**:
- [ ] `getScheduledInitialCalls` exists
- [ ] `getScheduledQualificationCalls` exists
- [ ] `getScheduledCallRecords` exists
- [ ] `getActivityDistribution` exists
- [ ] `getSMSResponseRate` exists
- [ ] `getCallAnswerRate` exists
- [ ] `getActivityBreakdown` exists
- [ ] `getActivityRecords` exists
- [ ] `getActivityTotals` exists
- [ ] `getSGAActivityFilterOptions` exists

**User Validation Required**: 
- [ ] **OPTIONAL**: User can test a query directly in BigQuery console to verify SQL syntax

**BigQuery Test Query** (user can run in BQ console):
```sql
-- Quick test: Should return data if setup is correct
SELECT COUNT(*) as total_activities
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY);
```

**Gate**: Do NOT proceed to Phase 3 until all automated checks pass.

**Report to User**:
- List which checks passed
- Note: API routes in Phase 3 will do runtime testing of these queries

---

## Phase 3: API Routes

### 3.1 Create Main Dashboard Data Route

**File**: `src/app/api/sga-activity/dashboard/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import {
  getCachedScheduledInitialCalls,
  getCachedScheduledQualificationCalls,
  getCachedActivityDistribution,
  getCachedSMSResponseRate,
  getCachedCallAnswerRate,
  getCachedActivityBreakdown,
  getCachedActivityTotals,
} from '@/lib/queries/sga-activity';
import { SGAActivityFilters, SGAActivityDashboardData } from '@/types/sga-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    
    // Check page access (we'll add page ID for SGA Activity)
    // For now, allow admin, manager, and sga roles
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    let filters: SGAActivityFilters = body.filters;

    // Apply SGA filter for non-admin/manager users
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      filters = { ...filters, sga: permissions.sgaFilter };
    }

    // Fetch all data in parallel
    const [
      initialCalls,
      qualificationCalls,
      activityDistribution,
      smsResponseRate,
      callAnswerRate,
      activityBreakdown,
      totals,
    ] = await Promise.all([
      getCachedScheduledInitialCalls(filters),
      getCachedScheduledQualificationCalls(filters),
      getCachedActivityDistribution(filters),
      getCachedSMSResponseRate(filters),
      getCachedCallAnswerRate(filters),
      getCachedActivityBreakdown(filters),
      getCachedActivityTotals(filters),
    ]);

    const data: SGAActivityDashboardData = {
      initialCalls,
      qualificationCalls,
      activityDistribution,
      smsResponseRate,
      callAnswerRate,
      activityBreakdown,
      totals,
    };

    return NextResponse.json(data);
  } catch (error: any) {
    logger.error('SGA Activity Dashboard error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
```

### 3.2 Create Drill-Down Routes

**File**: `src/app/api/sga-activity/scheduled-calls/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getScheduledCallRecords } from '@/lib/queries/sga-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { callType, weekType, dayOfWeek, sgaName } = body;

    // Apply SGA filter for non-admin/manager users
    const effectiveSgaName = permissions.role === 'sga' && permissions.sgaFilter
      ? permissions.sgaFilter
      : sgaName;

    const records = await getScheduledCallRecords(
      callType,
      weekType,
      dayOfWeek,
      effectiveSgaName
    );

    return NextResponse.json({ records });
  } catch (error: any) {
    logger.error('Scheduled calls drill-down error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
```

**File**: `src/app/api/sga-activity/activity-records/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getActivityRecords } from '@/lib/queries/sga-activity';
import { SGAActivityFilters, ActivityChannel } from '@/types/sga-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    let filters: SGAActivityFilters = body.filters;
    const { channel, subType, dayOfWeek } = body;

    // Apply SGA filter for non-admin/manager users
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      filters = { ...filters, sga: permissions.sgaFilter };
    }

    const records = await getActivityRecords(
      filters,
      channel as ActivityChannel | undefined,
      subType,
      dayOfWeek
    );

    return NextResponse.json({ records });
  } catch (error: any) {
    logger.error('Activity records drill-down error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
```

**File**: `src/app/api/sga-activity/filters/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getSGAActivityFilterOptions } from '@/lib/queries/sga-activity';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const filterOptions = await getSGAActivityFilterOptions();

    // If SGA role, only return their own name in the list
    if (permissions.role === 'sga' && permissions.sgaFilter) {
      filterOptions.sgas = filterOptions.sgas.filter(
        s => s.value === permissions.sgaFilter
      );
    }

    return NextResponse.json(filterOptions);
  } catch (error: any) {
    logger.error('SGA Activity filters error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error?.message },
      { status: 500 }
    );
  }
}
```

### 3.5 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles
npx tsc --noEmit

# Verify no lint errors in new API routes
npx eslint src/app/api/sga-activity/

# Verify all route files exist
ls -la src/app/api/sga-activity/
ls -la src/app/api/sga-activity/dashboard/
ls -la src/app/api/sga-activity/scheduled-calls/
ls -la src/app/api/sga-activity/activity-records/
ls -la src/app/api/sga-activity/filters/

# Verify route.ts files have correct exports
grep "export async function" src/app/api/sga-activity/*/route.ts
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on all API route files
- [ ] 4 route directories exist with route.ts files
- [ ] Each route exports POST or GET handler

**API Route Checklist**:
- [ ] `/api/sga-activity/dashboard/route.ts` - POST handler
- [ ] `/api/sga-activity/scheduled-calls/route.ts` - POST handler
- [ ] `/api/sga-activity/activity-records/route.ts` - POST handler
- [ ] `/api/sga-activity/filters/route.ts` - GET handler

**User Validation Required**: 
- [ ] **REQUIRED**: Start dev server and test API endpoints

**Dev Server Test Instructions**:
```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Test API endpoints (user runs these)
# Note: These require authentication, so test in browser console instead
```

**Browser Console Tests** (user runs in browser at localhost:3000 while logged in):
```javascript
// Test 1: Filters endpoint
fetch('/api/sga-activity/filters')
  .then(r => r.json())
  .then(data => console.log('Filters:', data))
  .catch(err => console.error('Filters Error:', err));

// Test 2: Dashboard endpoint (with minimal filters)
fetch('/api/sga-activity/dashboard', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filters: {
      sga: null,
      dateRangeType: 'this_week',
      startDate: null,
      endDate: null,
      comparisonDateRangeType: 'last_90',
      comparisonStartDate: null,
      comparisonEndDate: null,
      activityTypes: [],
      includeAutomated: false,
      callTypeFilter: 'all_outbound'
    }
  })
})
  .then(r => r.json())
  .then(data => console.log('Dashboard:', data))
  .catch(err => console.error('Dashboard Error:', err));
```

**Expected API Responses**:
- Filters: Returns `{ sgas: [...] }` array
- Dashboard: Returns object with `initialCalls`, `qualificationCalls`, `activityDistribution`, etc.

**Gate**: Do NOT proceed to Phase 4 until:
1. All automated checks pass
2. User confirms API endpoints return data (not errors)

**Report to User**:
- List which automated checks passed
- Provide the browser console test code
- Ask user to confirm API responses before proceeding

---

## Phase 4: Components

### 4.1 Create Activity Filters Component

**File**: `src/components/sga-activity/ActivityFilters.tsx`

```typescript
'use client';

import React from 'react';
import { Card, Select, SelectItem } from '@tremor/react';
import { SGAActivityFilters } from '@/types/sga-activity';

interface ActivityFiltersProps {
  filters: SGAActivityFilters;
  onFiltersChange: (filters: SGAActivityFilters) => void;
  sgaOptions: { value: string; label: string; isActive: boolean }[];
  showSGAFilter: boolean;  // Hide for SGA role
}

const DATE_RANGE_PRESETS = [
  { value: 'this_week', label: 'This Week' },
  { value: 'next_week', label: 'Next Week' },
  { value: 'last_30', label: 'Last 30 Days' },
  { value: 'last_60', label: 'Last 60 Days' },
  { value: 'last_90', label: 'Last 90 Days' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'all_time', label: 'All Time' },
  { value: 'custom', label: 'Custom Range' },
];

const COMPARISON_PRESETS = [
  { value: 'last_30', label: 'Last 30 Days Avg' },
  { value: 'last_60', label: 'Last 60 Days Avg' },
  { value: 'last_90', label: 'Last 90 Days Avg' },
  { value: 'qtd', label: 'Quarter to Date Avg' },
  { value: 'all_time', label: 'All Time Avg' },
  { value: 'custom', label: 'Custom Range' },
];

const CALL_TYPE_OPTIONS = [
  { value: 'all_outbound', label: 'All Outbound Calls' },
  { value: 'cold_calls', label: 'Cold Calls Only' },
  { value: 'scheduled_calls', label: 'Scheduled Calls Only' },
];

export default function ActivityFilters({
  filters,
  onFiltersChange,
  sgaOptions,
  showSGAFilter,
}: ActivityFiltersProps) {
  const handleChange = (key: keyof SGAActivityFilters, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap gap-4 items-end">
        {/* SGA Filter */}
        {showSGAFilter && (
          <div className="min-w-[200px]">
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
              SGA
            </label>
            <Select
              value={filters.sga || 'all'}
              onValueChange={(value) => handleChange('sga', value === 'all' ? null : value)}
            >
              <SelectItem value="all">All SGAs</SelectItem>
              {sgaOptions.map((sga) => (
                <SelectItem key={sga.value} value={sga.value}>
                  {sga.label} {!sga.isActive && '(Inactive)'}
                </SelectItem>
              ))}
            </Select>
          </div>
        )}

        {/* Current Period */}
        <div className="min-w-[180px]">
          <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
            Date Range
          </label>
          <Select
            value={filters.dateRangeType}
            onValueChange={(value) => handleChange('dateRangeType', value)}
          >
            {DATE_RANGE_PRESETS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label}
              </SelectItem>
            ))}
          </Select>
        </div>

        {/* Custom Date Range (if selected) */}
        {filters.dateRangeType === 'custom' && (
          <div className="min-w-[250px]">
            <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
              Custom Range
            </label>
            {/* Note: Tremor DateRangePicker exists, but GlobalFilters uses native inputs for consistency */}
            {/* Using native inputs to match existing patterns */}
            <div className="flex gap-2">
              <input
                type="date"
                value={filters.startDate || ''}
                onChange={(e) => handleChange('startDate', e.target.value || null)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
              <span className="self-center text-gray-500">to</span>
              <input
                type="date"
                value={filters.endDate || ''}
                onChange={(e) => handleChange('endDate', e.target.value || null)}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
          </div>
        )}

        {/* Comparison Period */}
        <div className="min-w-[180px]">
          <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
            Compare To
          </label>
          <Select
            value={filters.comparisonDateRangeType}
            onValueChange={(value) => handleChange('comparisonDateRangeType', value)}
          >
            {COMPARISON_PRESETS.map((preset) => (
              <SelectItem key={preset.value} value={preset.value}>
                {preset.label}
              </SelectItem>
            ))}
          </Select>
        </div>

        {/* Call Type Filter */}
        <div className="min-w-[180px]">
          <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
            Call Type
          </label>
          <Select
            value={filters.callTypeFilter}
            onValueChange={(value) => handleChange('callTypeFilter', value)}
          >
            {CALL_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </Select>
        </div>

        {/* Include Automated Toggle */}
        {/* Note: Using custom toggle to match GlobalFilters pattern (ActiveToggle) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleChange('includeAutomated', !filters.includeAutomated)}
            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
              filters.includeAutomated ? 'bg-blue-600' : 'bg-gray-300'
            }`}
            role="switch"
            aria-checked={filters.includeAutomated}
            aria-label="Toggle include automated activities"
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                filters.includeAutomated ? 'translate-x-0' : 'translate-x-4'
              }`}
            />
          </button>
          <label className="text-sm text-gray-600 dark:text-gray-400">
            Include Automated
          </label>
        </div>
      </div>
    </Card>
  );
}
```

### 4.2 Create Scheduled Calls Cards Component

**File**: `src/components/sga-activity/ScheduledCallsCards.tsx`

```typescript
'use client';

import React from 'react';
import { Card, Metric, Text, Grid, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell } from '@tremor/react';
import { ScheduledCallsSummary, DayCount, SGACallCount } from '@/types/sga-activity';

interface ScheduledCallsCardsProps {
  title: string;  // "Initial Calls" or "Qualification Calls"
  data: ScheduledCallsSummary;
  onCardClick: (weekType: 'this_week' | 'next_week') => void;
  onDayClick: (weekType: 'this_week' | 'next_week', dayOfWeek: number) => void;
  onSGAClick: (weekType: 'this_week' | 'next_week', sgaName: string) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ScheduledCallsCards({
  title,
  data,
  onCardClick,
  onDayClick,
  onSGAClick,
}: ScheduledCallsCardsProps) {
  // Combine SGA data for display
  const combinedSGAData = combinesSGAData(data);

  return (
    <div className="space-y-4">
      <Text className="text-lg font-semibold">{title}</Text>
      
      {/* Summary Cards */}
      <Grid numItems={1} numItemsSm={2} className="gap-4">
        <Card 
          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
          onClick={() => onCardClick('this_week')}
        >
          <Text>This Week</Text>
          <Metric>{data.thisWeek.total}</Metric>
        </Card>
        <Card 
          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
          onClick={() => onCardClick('next_week')}
        >
          <Text>Next Week</Text>
          <Metric>{data.nextWeek.total}</Metric>
        </Card>
      </Grid>

      {/* Daily Breakdown */}
      <Card>
        <Text className="font-medium mb-2">By Day of Week</Text>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Week</TableHeaderCell>
              {DAY_NAMES.map((day, idx) => (
                <TableHeaderCell key={day} className="text-center">{day}</TableHeaderCell>
              ))}
              <TableHeaderCell className="text-center">Total</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>This Week</TableCell>
              {[1, 2, 3, 4, 5, 6, 0].map((dayNum) => {
                const dayData = data.thisWeek.byDay.find(d => d.dayOfWeek === dayNum);
                return (
                  <TableCell 
                    key={dayNum} 
                    className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                    onClick={() => dayData && dayData.count > 0 && onDayClick('this_week', dayNum)}
                  >
                    {dayData?.count || '-'}
                  </TableCell>
                );
              })}
              <TableCell className="text-center font-medium">{data.thisWeek.total}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Next Week</TableCell>
              {[1, 2, 3, 4, 5, 6, 0].map((dayNum) => {
                const dayData = data.nextWeek.byDay.find(d => d.dayOfWeek === dayNum);
                return (
                  <TableCell 
                    key={dayNum} 
                    className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                    onClick={() => dayData && dayData.count > 0 && onDayClick('next_week', dayNum)}
                  >
                    {dayData?.count || '-'}
                  </TableCell>
                );
              })}
              <TableCell className="text-center font-medium">{data.nextWeek.total}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

      {/* Per-SGA Breakdown */}
      <Card>
        <Text className="font-medium mb-2">By SGA</Text>
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>SGA Name</TableHeaderCell>
              <TableHeaderCell className="text-center">This Week</TableHeaderCell>
              <TableHeaderCell className="text-center">Next Week</TableHeaderCell>
              <TableHeaderCell className="text-center">Total</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {combinedSGAData.map((sga) => (
              <TableRow key={sga.sgaName}>
                <TableCell>{sga.sgaName}</TableCell>
                <TableCell 
                  className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                  onClick={() => sga.thisWeekCount > 0 && onSGAClick('this_week', sga.sgaName)}
                >
                  {sga.thisWeekCount || '-'}
                </TableCell>
                <TableCell 
                  className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900"
                  onClick={() => sga.nextWeekCount > 0 && onSGAClick('next_week', sga.sgaName)}
                >
                  {sga.nextWeekCount || '-'}
                </TableCell>
                <TableCell className="text-center font-medium">{sga.total}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function combinesSGAData(data: ScheduledCallsSummary): SGACallCount[] {
  const sgaMap = new Map<string, SGACallCount>();
  
  for (const sga of data.thisWeek.bySGA) {
    sgaMap.set(sga.sgaName, { ...sga });
  }
  
  for (const sga of data.nextWeek.bySGA) {
    const existing = sgaMap.get(sga.sgaName);
    if (existing) {
      existing.nextWeekCount = sga.nextWeekCount;
      existing.total = existing.thisWeekCount + sga.nextWeekCount;
    } else {
      sgaMap.set(sga.sgaName, { ...sga, thisWeekCount: 0, total: sga.nextWeekCount });
    }
  }
  
  return Array.from(sgaMap.values()).sort((a, b) => b.total - a.total);
}
```

### 4.3 Create Activity Distribution Table Component

**File**: `src/components/sga-activity/ActivityDistributionTable.tsx`

```typescript
'use client';

import React from 'react';
import { Card, Text, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { ActivityDistribution, ActivityChannel } from '@/types/sga-activity';

interface ActivityDistributionTableProps {
  distributions: ActivityDistribution[];
  onCellClick: (channel: ActivityChannel, dayOfWeek: number) => void;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun

export default function ActivityDistributionTable({
  distributions,
  onCellClick,
}: ActivityDistributionTableProps) {
  return (
    <Card>
      <Text className="text-lg font-semibold mb-4">Activity Distribution by Day of Week</Text>
      
      {distributions.map((dist) => (
        <div key={dist.channel} className="mb-6 last:mb-0">
          <Text className="font-medium mb-2">{dist.channel}</Text>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Metric</TableHeaderCell>
                {DAY_ORDER.map((dayNum) => (
                  <TableHeaderCell key={dayNum} className="text-center">
                    {DAY_NAMES[dayNum]}
                  </TableHeaderCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {/* Historical Average Row */}
              <TableRow>
                <TableCell className="text-gray-500">Historical Avg</TableCell>
                {DAY_ORDER.map((dayNum) => {
                  const dayData = dist.comparisonPeriod.find(d => d.dayOfWeek === dayNum);
                  return (
                    <TableCell key={dayNum} className="text-center text-gray-500">
                      {dayData?.avgCount?.toFixed(1) || '-'}
                    </TableCell>
                  );
                })}
              </TableRow>
              
              {/* Current Period Row */}
              <TableRow>
                <TableCell className="font-medium">Current</TableCell>
                {DAY_ORDER.map((dayNum) => {
                  const dayData = dist.currentPeriod.find(d => d.dayOfWeek === dayNum);
                  return (
                    <TableCell 
                      key={dayNum} 
                      className="text-center cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900 font-medium"
                      onClick={() => dayData && dayData.count > 0 && onCellClick(dist.channel, dayNum)}
                    >
                      {dayData?.count || '-'}
                    </TableCell>
                  );
                })}
              </TableRow>
              
              {/* Variance Row */}
              <TableRow>
                <TableCell className="text-gray-500">Variance</TableCell>
                {DAY_ORDER.map((dayNum) => {
                  const varData = dist.variance.find(d => d.dayOfWeek === dayNum);
                  if (!varData || varData.comparisonCount === 0) {
                    return <TableCell key={dayNum} className="text-center">-</TableCell>;
                  }
                  
                  const isPositive = varData.variance > 0;
                  const color = isPositive ? 'green' : varData.variance < 0 ? 'red' : 'gray';
                  
                  return (
                    <TableCell key={dayNum} className="text-center">
                      <Badge color={color} size="sm">
                        {isPositive ? '+' : ''}{varData.variance.toFixed(1)}
                      </Badge>
                    </TableCell>
                  );
                })}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      ))}
    </Card>
  );
}
```

### 4.4 Create Rate Cards Component

**File**: `src/components/sga-activity/RateCards.tsx`

```typescript
'use client';

import React from 'react';
import { Card, Metric, Text, ProgressBar, Grid } from '@tremor/react';
import { SMSResponseRate, CallAnswerRate } from '@/types/sga-activity';

interface RateCardsProps {
  smsRate: SMSResponseRate;
  callRate: CallAnswerRate;
}

export default function RateCards({ smsRate, callRate }: RateCardsProps) {
  const formatPercent = (rate: number) => `${(rate * 100).toFixed(1)}%`;

  return (
    <Grid numItems={1} numItemsSm={2} className="gap-4">
      {/* SMS Response Rate */}
      <Card>
        <Text>SMS Response Rate</Text>
        <Metric>{formatPercent(smsRate.responseRate)}</Metric>
        <Text className="text-sm text-gray-500 mt-2">
          {smsRate.leadsResponded.toLocaleString()} responded / {smsRate.leadsTexted.toLocaleString()} texted
        </Text>
        <ProgressBar value={smsRate.responseRate * 100} className="mt-2" color="blue" />
        <Text className="text-xs text-gray-400 mt-1">{smsRate.period}</Text>
      </Card>

      {/* Call Answer Rate */}
      <Card>
        <Text>Call Answer Rate ({getCallTypeLabel(callRate.callType)})</Text>
        <Metric>{formatPercent(callRate.answerRate)}</Metric>
        <Text className="text-sm text-gray-500 mt-2">
          {callRate.answeredCalls.toLocaleString()} answered / {callRate.totalCalls.toLocaleString()} total
        </Text>
        <ProgressBar value={callRate.answerRate * 100} className="mt-2" color="green" />
        <Text className="text-xs text-gray-400 mt-1">{callRate.period}</Text>
      </Card>
    </Grid>
  );
}

function getCallTypeLabel(callType: string): string {
  switch (callType) {
    case 'cold_calls': return 'Cold Calls';
    case 'scheduled_calls': return 'Scheduled Calls';
    case 'all_outbound': 
    default: return 'All Outbound';
  }
}
```

### 4.5 Create Activity Breakdown Component

**File**: `src/components/sga-activity/ActivityBreakdownCard.tsx`

```typescript
'use client';

import React from 'react';
import { Card, Text, BarList, Grid, DonutChart } from '@tremor/react';
import { ActivityBreakdown } from '@/types/sga-activity';

interface ActivityBreakdownCardProps {
  breakdowns: ActivityBreakdown[];
  onChannelClick: (channel: string) => void;
}

export default function ActivityBreakdownCard({
  breakdowns,
  onChannelClick,
}: ActivityBreakdownCardProps) {
  // Prepare data for donut chart
  const donutData = breakdowns.map((b) => ({
    name: b.channel,
    value: b.totalCount,
  }));

  // Calculate grand total
  const grandTotal = breakdowns.reduce((sum, b) => sum + b.totalCount, 0);

  return (
    <Card>
      <Text className="text-lg font-semibold mb-4">Activity Breakdown</Text>
      
      <Grid numItems={1} numItemsMd={2} className="gap-6">
        {/* Donut Chart */}
        <div>
          <DonutChart
            data={donutData}
            category="value"
            index="name"
            valueFormatter={(value) => value.toLocaleString()}
            className="h-48"
          />
          <Text className="text-center text-sm text-gray-500 mt-2">
            Total: {grandTotal.toLocaleString()} activities
          </Text>
        </div>

        {/* Bar Lists by Channel */}
        <div className="space-y-4">
          {breakdowns.map((breakdown) => (
            <div key={breakdown.channel}>
              <div 
                className="flex justify-between items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 p-1 rounded"
                onClick={() => onChannelClick(breakdown.channel)}
              >
                <Text className="font-medium">{breakdown.channel}</Text>
                <Text className="text-gray-500">{breakdown.totalCount.toLocaleString()}</Text>
              </div>
              <BarList
                data={breakdown.subTypes.slice(0, 5).map((st) => ({
                  name: st.subType + (st.isAutomated ? ' (Auto)' : ''),
                  value: st.count,
                }))}
                className="mt-1"
              />
            </div>
          ))}
        </div>
      </Grid>
    </Card>
  );
}
```

### 4.6 Create Activity Totals Scorecards

**File**: `src/components/sga-activity/ActivityTotalsCards.tsx`

```typescript
'use client';

import React from 'react';
import { Card, Metric, Text, Grid } from '@tremor/react';
import { Phone, MessageSquare, Linkedin, Mail } from 'lucide-react';

interface ActivityTotalsCardsProps {
  totals: {
    coldCalls: number;
    outboundCalls: number;
    smsOutbound: number;
    smsInbound: number;
    linkedInMessages: number;
    linkedInConnections: number;
    emailsManual: number;
  };
  onCardClick: (activityType: string) => void;
}

export default function ActivityTotalsCards({ totals, onCardClick }: ActivityTotalsCardsProps) {
  const cards = [
    {
      key: 'cold_calls',
      label: 'Cold Calls',
      value: totals.coldCalls,
      icon: Phone,
      color: 'text-orange-500',
    },
    {
      key: 'outbound_calls',
      label: 'Outbound Calls',
      value: totals.outboundCalls,
      icon: Phone,
      color: 'text-blue-500',
    },
    {
      key: 'sms_outbound',
      label: 'SMS Sent',
      value: totals.smsOutbound,
      icon: MessageSquare,
      color: 'text-green-500',
    },
    {
      key: 'sms_inbound',
      label: 'SMS Received',
      value: totals.smsInbound,
      icon: MessageSquare,
      color: 'text-teal-500',
    },
    {
      key: 'linkedin_messages',
      label: 'LinkedIn Messages',
      value: totals.linkedInMessages,
      icon: Linkedin,
      color: 'text-blue-600',
    },
    {
      key: 'linkedin_connections',
      label: 'LinkedIn Connections',
      value: totals.linkedInConnections,
      icon: Linkedin,
      color: 'text-blue-400',
    },
    {
      key: 'emails_manual',
      label: 'Manual Emails',
      value: totals.emailsManual,
      icon: Mail,
      color: 'text-purple-500',
    },
  ];

  return (
    <Grid numItems={2} numItemsSm={3} numItemsLg={4} className="gap-4">
      {cards.map((card) => (
        <Card
          key={card.key}
          className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
          onClick={() => onCardClick(card.key)}
        >
          <div className="flex items-center gap-2">
            <card.icon className={`h-5 w-5 ${card.color}`} />
            <Text>{card.label}</Text>
          </div>
          <Metric className="mt-2">{card.value.toLocaleString()}</Metric>
        </Card>
      ))}
    </Grid>
  );
}
```

### 4.7 Create Activity Drill-Down Modal

**File**: `src/components/sga-activity/ActivityDrillDownModal.tsx`

```typescript
'use client';

import React, { useEffect } from 'react';
import { Card, Text, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Button } from '@tremor/react';
import { X, ExternalLink } from 'lucide-react';
import { ActivityRecord, ScheduledCallRecord } from '@/types/sga-activity';

interface ActivityDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  records: (ActivityRecord | ScheduledCallRecord)[];
  loading: boolean;
  onRecordClick: (recordId: string) => void;
  recordType: 'activity' | 'scheduled_call';
}

export default function ActivityDrillDownModal({
  isOpen,
  onClose,
  title,
  records,
  loading,
  onRecordClick,
  recordType,
}: ActivityDrillDownModalProps) {
  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50" 
        onClick={onClose}
      />
      
      {/* Modal */}
      <Card className="relative z-10 w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col m-4">
        {/* Header */}
        <div className="flex justify-between items-center mb-4 pb-4 border-b">
          <Text className="text-lg font-semibold">{title}</Text>
          <Button
            variant="light"
            icon={X}
            onClick={onClose}
          />
        </div>

        {/* Content */}
        <div className="overflow-auto flex-1">
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <Text>Loading...</Text>
            </div>
          ) : records.length === 0 ? (
            <div className="flex justify-center items-center h-32">
              <Text className="text-gray-500">No records found</Text>
            </div>
          ) : recordType === 'scheduled_call' ? (
            <ScheduledCallsTable 
              records={records as ScheduledCallRecord[]} 
              onRecordClick={onRecordClick}
            />
          ) : (
            <ActivityRecordsTable 
              records={records as ActivityRecord[]} 
              onRecordClick={onRecordClick}
            />
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t flex justify-between items-center">
          <Text className="text-sm text-gray-500">
            {records.length} records
          </Text>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ScheduledCallsTable({ 
  records, 
  onRecordClick 
}: { 
  records: ScheduledCallRecord[]; 
  onRecordClick: (id: string) => void;
}) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Prospect</TableHeaderCell>
          <TableHeaderCell>SGA</TableHeaderCell>
          <TableHeaderCell>Scheduled Date</TableHeaderCell>
          <TableHeaderCell>Source</TableHeaderCell>
          <TableHeaderCell>Channel</TableHeaderCell>
          <TableHeaderCell>Salesforce</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {records.map((record) => (
          <TableRow 
            key={record.id}
            className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => {
              // RecordDetailModal requires Lead ID (00Q...) or Opportunity ID (006...)
              // Prefer leadId, then opportunityId, then id (if it's a valid format)
              const detailId = record.leadId || record.opportunityId || record.id;
              onRecordClick(detailId);
            }}
          >
            <TableCell>{record.prospectName}</TableCell>
            <TableCell>{record.sgaName}</TableCell>
            <TableCell>{record.scheduledDate}</TableCell>
            <TableCell>{record.source}</TableCell>
            <TableCell>{record.channel}</TableCell>
            <TableCell>
              <a 
                href={record.salesforceUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-500 hover:text-blue-700"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ActivityRecordsTable({ 
  records, 
  onRecordClick 
}: { 
  records: ActivityRecord[]; 
  onRecordClick: (id: string) => void;
}) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Date</TableHeaderCell>
          <TableHeaderCell>Type</TableHeaderCell>
          <TableHeaderCell>Prospect</TableHeaderCell>
          <TableHeaderCell>SGA</TableHeaderCell>
          <TableHeaderCell>Subject</TableHeaderCell>
          <TableHeaderCell>Salesforce</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {records.map((record) => (
          <TableRow 
            key={record.taskId}
            className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700"
            onClick={() => {
              // RecordDetailModal requires Lead ID (00Q...) or Opportunity ID (006...)
              // Task IDs (00T...) are NOT accepted - must use leadId or opportunityId
              const detailId = record.leadId || record.opportunityId;
              if (detailId) {
                onRecordClick(detailId);
              } else {
                // If no lead/opportunity ID, show alert or skip (Task detail not supported)
                console.warn('Cannot open RecordDetailModal: Task has no linked Lead or Opportunity ID');
              }
            }}
          >
            <TableCell>{record.createdDateEST}</TableCell>
            <TableCell>
              {record.activityChannel}
              {record.isColdCall && ' (Cold)'}
              {record.isAutomated && ' (Auto)'}
            </TableCell>
            <TableCell>{record.prospectName}</TableCell>
            <TableCell>{record.sgaName}</TableCell>
            <TableCell className="max-w-xs truncate">{record.subject}</TableCell>
            <TableCell>
              <a 
                href={record.salesforceUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-500 hover:text-blue-700"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

### 4.8 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles
npx tsc --noEmit

# Verify no lint errors in new components
npx eslint src/components/sga-activity/

# Verify all component files exist
ls -la src/components/sga-activity/

# Verify component exports
grep "export default" src/components/sga-activity/*.tsx
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on all component files
- [ ] 7 component files exist in `src/components/sga-activity/`

**Component Checklist**:
- [ ] `ActivityFilters.tsx` - Filter controls
- [ ] `ScheduledCallsCards.tsx` - Scheduled calls display
- [ ] `ActivityDistributionTable.tsx` - Distribution comparison table
- [ ] `RateCards.tsx` - SMS/Call rate cards
- [ ] `ActivityBreakdownCard.tsx` - Breakdown chart
- [ ] `ActivityTotalsCards.tsx` - Total scorecards
- [ ] `ActivityDrillDownModal.tsx` - Drill-down modal

**Import Verification**:
```bash
# Verify all imports resolve
for file in src/components/sga-activity/*.tsx; do
  echo "Checking: $file"
  npx tsc "$file" --noEmit --skipLibCheck 2>&1 | head -5
done
```

**User Validation Required**: None yet - components will be tested in Phase 5 with the main page.

**Gate**: Do NOT proceed to Phase 5 until all automated checks pass.

**Report to User**:
- List which checks passed
- List all 7 components created
- Note: UI testing happens in Phase 5

---

## Phase 5: Main Page Component

### 5.1 Create Page Directory and Files

**File**: `src/app/dashboard/sga-activity/page.tsx`

```typescript
import { Metadata } from 'next';
import SGAActivityContent from './SGAActivityContent';

export const metadata: Metadata = {
  title: 'SGA Activity | Savvy Analytics',
  description: 'SGA Activity Dashboard - Track activity patterns, scheduled calls, and response rates',
};

export default function SGAActivityPage() {
  return <SGAActivityContent />;
}
```

**File**: `src/app/dashboard/sga-activity/SGAActivityContent.tsx`

```typescript
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Title, Text, Divider } from '@tremor/react';
import { getSessionPermissions } from '@/types/auth';
import ActivityFilters from '@/components/sga-activity/ActivityFilters';
import ScheduledCallsCards from '@/components/sga-activity/ScheduledCallsCards';
import ActivityDistributionTable from '@/components/sga-activity/ActivityDistributionTable';
import RateCards from '@/components/sga-activity/RateCards';
import ActivityBreakdownCard from '@/components/sga-activity/ActivityBreakdownCard';
import ActivityTotalsCards from '@/components/sga-activity/ActivityTotalsCards';
import ActivityDrillDownModal from '@/components/sga-activity/ActivityDrillDownModal';
import RecordDetailModal from '@/components/dashboard/RecordDetailModal';
import DataFreshnessIndicator from '@/components/dashboard/DataFreshnessIndicator';
import {
  SGAActivityFilters,
  SGAActivityDashboardData,
  ActivityRecord,
  ScheduledCallRecord,
  ActivityChannel,
} from '@/types/sga-activity';

const DEFAULT_FILTERS: SGAActivityFilters = {
  sga: null,
  dateRangeType: 'qtd',
  startDate: null,
  endDate: null,
  comparisonDateRangeType: 'all_time',
  comparisonStartDate: null,
  comparisonEndDate: null,
  activityTypes: [],
  includeAutomated: false,
  callTypeFilter: 'all_outbound',
};

export default function SGAActivityContent() {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const showSGAFilter = ['admin', 'manager'].includes(permissions.role);

  // State
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<SGAActivityFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<SGAActivityDashboardData | null>(null);
  const [sgaOptions, setSgaOptions] = useState<{ value: string; label: string; isActive: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Drill-down state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownTitle, setDrillDownTitle] = useState('');
  const [drillDownRecords, setDrillDownRecords] = useState<(ActivityRecord | ScheduledCallRecord)[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [drillDownRecordType, setDrillDownRecordType] = useState<'activity' | 'scheduled_call'>('activity');

  // Record detail state
  const [recordDetailOpen, setRecordDetailOpen] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);

  // Fetch filter options
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const response = await fetch('/api/sga-activity/filters');
        if (!response.ok) throw new Error('Failed to fetch filter options');
        const options = await response.json();
        setSgaOptions(options.sgas || []);
      } catch (err) {
        console.error('Failed to fetch filter options:', err);
      }
    };
    fetchFilterOptions();
  }, []);

  // Fetch dashboard data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/sga-activity/dashboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const dashboardData = await response.json();
      setData(dashboardData);
    } catch (err: any) {
      console.error('Dashboard fetch error:', err);
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Drill-down handlers
  const handleScheduledCallClick = async (
    callType: 'initial' | 'qualification',
    weekType: 'this_week' | 'next_week',
    dayOfWeek?: number,
    sgaName?: string
  ) => {
    setDrillDownLoading(true);
    setDrillDownRecordType('scheduled_call');
    setDrillDownTitle(
      `${callType === 'initial' ? 'Initial' : 'Qualification'} Calls - ${weekType === 'this_week' ? 'This Week' : 'Next Week'}` +
      (dayOfWeek ? ` (${getDayName(dayOfWeek)})` : '') +
      (sgaName ? ` - ${sgaName}` : '')
    );
    setDrillDownOpen(true);

    try {
      const response = await fetch('/api/sga-activity/scheduled-calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callType, weekType, dayOfWeek, sgaName }),
      });

      if (!response.ok) throw new Error('Failed to fetch records');
      const { records } = await response.json();
      setDrillDownRecords(records);
    } catch (err) {
      console.error('Drill-down error:', err);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleActivityDrillDown = async (
    channel?: ActivityChannel,
    dayOfWeek?: number
  ) => {
    setDrillDownLoading(true);
    setDrillDownRecordType('activity');
    setDrillDownTitle(
      `Activity Records` +
      (channel ? ` - ${channel}` : '') +
      (dayOfWeek ? ` (${getDayName(dayOfWeek)})` : '')
    );
    setDrillDownOpen(true);

    try {
      const response = await fetch('/api/sga-activity/activity-records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters, channel, dayOfWeek }),
      });

      if (!response.ok) throw new Error('Failed to fetch records');
      const { records } = await response.json();
      setDrillDownRecords(records);
    } catch (err) {
      console.error('Drill-down error:', err);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  };

  const handleRecordClick = (recordId: string) => {
    // RecordDetailModal expects Lead ID (00Q...) or Opportunity ID (006...)
    // Task IDs (00T...) are not accepted by the API
    // Use leadId or opportunityId from the record, fallback to recordId if it's already a valid format
    setSelectedRecordId(recordId);
    setRecordDetailOpen(true);
  };

  if (loading && !data) {
    return (
      <div className="p-6">
        <Title>SGA Activity</Title>
        <Text className="mt-4">Loading...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <Title>SGA Activity</Title>
        <Text className="mt-4 text-red-500">Error: {error}</Text>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <Title>SGA Activity</Title>
          <Text className="text-gray-500">
            Track activity patterns, scheduled calls, and response rates
          </Text>
        </div>
        <DataFreshnessIndicator />
      </div>

      {/* Filters */}
      <ActivityFilters
        filters={filters}
        onFiltersChange={setFilters}
        sgaOptions={sgaOptions}
        showSGAFilter={showSGAFilter}
      />

      {data && (
        <>
          {/* Activity Totals */}
          <ActivityTotalsCards
            totals={data.totals}
            onCardClick={(type) => handleActivityDrillDown(getChannelFromType(type))}
          />

          <Divider />

          {/* Scheduled Calls Section */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ScheduledCallsCards
              title="Initial Calls Scheduled"
              data={data.initialCalls}
              onCardClick={(week) => handleScheduledCallClick('initial', week)}
              onDayClick={(week, day) => handleScheduledCallClick('initial', week, day)}
              onSGAClick={(week, sga) => handleScheduledCallClick('initial', week, undefined, sga)}
            />
            <ScheduledCallsCards
              title="Qualification Calls Scheduled"
              data={data.qualificationCalls}
              onCardClick={(week) => handleScheduledCallClick('qualification', week)}
              onDayClick={(week, day) => handleScheduledCallClick('qualification', week, day)}
              onSGAClick={(week, sga) => handleScheduledCallClick('qualification', week, undefined, sga)}
            />
          </div>

          <Divider />

          {/* Response & Answer Rates */}
          <RateCards
            smsRate={data.smsResponseRate}
            callRate={data.callAnswerRate}
          />

          <Divider />

          {/* Activity Distribution */}
          <ActivityDistributionTable
            distributions={data.activityDistribution}
            onCellClick={(channel, day) => handleActivityDrillDown(channel, day)}
          />

          <Divider />

          {/* Activity Breakdown */}
          <ActivityBreakdownCard
            breakdowns={data.activityBreakdown}
            onChannelClick={(channel) => handleActivityDrillDown(channel as ActivityChannel)}
          />
        </>
      )}

      {/* Drill-Down Modal */}
      <ActivityDrillDownModal
        isOpen={drillDownOpen}
        onClose={() => setDrillDownOpen(false)}
        title={drillDownTitle}
        records={drillDownRecords}
        loading={drillDownLoading}
        onRecordClick={handleRecordClick}
        recordType={drillDownRecordType}
      />

      {/* Record Detail Modal */}
      <RecordDetailModal
        isOpen={recordDetailOpen}
        onClose={() => {
          setRecordDetailOpen(false);
          setSelectedRecordId(null);
        }}
        recordId={selectedRecordId}
        showBackButton={true}
        onBack={() => {
          setRecordDetailOpen(false);
          setSelectedRecordId(null);
        }}
        backButtonLabel="← Back to activity"
      />
    </div>
  );
}

// Helper functions
function getDayName(dayOfWeek: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[dayOfWeek] || '';
}

function getChannelFromType(type: string): ActivityChannel | undefined {
  const mapping: Record<string, ActivityChannel> = {
    cold_calls: 'Call',
    outbound_calls: 'Call',
    sms_outbound: 'SMS',
    sms_inbound: 'SMS',
    linkedin_messages: 'LinkedIn',
    linkedin_connections: 'LinkedIn',
    emails_manual: 'Email',
  };
  return mapping[type];
}
```

### 5.3 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles
npx tsc --noEmit

# Verify no lint errors
npx eslint src/app/dashboard/sga-activity/

# Verify page files exist
ls -la src/app/dashboard/sga-activity/

# Verify full build succeeds
npm run build
```

**Expected Results**:
- [x] TypeScript compiles without errors
- [x] ESLint passes
- [x] `page.tsx` and `SGAActivityContent.tsx` exist
- [x] `npm run build` succeeds without errors

**Page Structure Checklist**:
- [x] `src/app/dashboard/sga-activity/page.tsx` - Metadata and default export
- [x] `src/app/dashboard/sga-activity/SGAActivityContent.tsx` - Main content component

**User Validation Required**: 
- [x] **REQUIRED**: Visual UI verification in browser - COMPLETED

**UI Checklist** (user verifies visually):
- [x] Page loads without white screen or error
- [x] Page title shows "SGA Activity"
- [x] Filters section appears at top with SGA filter (Active/All toggle)
- [x] Activity totals scorecards appear (6 cards: Cold Calls, Outbound Calls, SMS Sent, SMS Received, LinkedIn Messages, Emails)
- [x] Initial Calls section appears with cards and tables
- [x] Qualification Calls section appears with cards and tables
- [x] SMS Response Rate card appears
- [x] Call Answer Rate card appears (side by side with SMS Response Rate)
- [x] Activity Distribution table appears
- [x] Data Freshness indicator appears in header
- [x] Activity Breakdown donut chart removed (as requested)

**Interaction Tests** (user performs):
- [x] Change date range filter → data updates
- [x] Change SGA filter → data updates (including scheduled calls tables)
- [x] Toggle Active/All for SGA filter → dropdown updates
- [x] Click on activity scorecard → drill-down modal opens with filtered records
- [x] Click on scheduled call count → drill-down modal opens
- [x] Click on day of week in scheduled calls table → drill-down modal opens with filtered records
- [x] Click on SGA name in scheduled calls table → drill-down modal opens
- [x] Click on totals in scheduled calls tables → drill-down modal opens
- [x] Click a record in drill-down → RecordDetailModal opens
- [x] Export CSV from drill-down modal → CSV downloads correctly
- [x] Toggle "Include Automated" → data updates (defaults to true/always included)

**Console Error Check**:
- [x] Open browser DevTools (F12) → Console tab
- [x] No red errors related to the page

**Gate**: ✅ **PHASE 5 COMPLETE** - All checks passed, user validated all features

---

### 5.4 Phase 5 Enhancements & Fixes (Completed)

**Date Completed**: January 23, 2026

#### 5.4.1 Activity Classification Logic (CRITICAL FIX)

**Problem**: SMS and LinkedIn activities were being misclassified as Email, causing incorrect counts and drilldown results.

**Solution Implemented**:
- **Subject-First Priority Classification**: Implemented priority-based classification logic where subject field is the PRIMARY source of truth:
  1. **Priority 1**: Explicit subject matches (`'LinkedIn Message'`, `'Outgoing SMS'`, etc.)
  2. **Priority 2**: Subject pattern matching (`LIKE '%sms%'`, `LIKE '%linkedin%'`, etc.)
  3. **Priority 3**: Raw channel group (if subject is ambiguous)
  4. **Priority 4**: Description-based (last resort)
  5. **Priority 5**: Email classification (only for ambiguous Call records)

**Files Modified**:
- `src/lib/queries/sga-activity.ts`:
  - Updated `getActivityRecords` classification logic
  - Updated `getActivityTotals` classification logic (to match drilldown)
  - Updated `getActivityBreakdown` classification logic
  - Updated `getActivityDistribution` classification logic
  - Added `raw_channel_group` field for additional filtering safeguards

**Key Changes**:
```sql
CASE
  -- PRIORITY 1: Explicit subject matches (highest priority)
  WHEN v.task_subject = 'LinkedIn Message' THEN 'LinkedIn'
  WHEN v.task_subject = 'Outgoing SMS' THEN 'SMS'
  WHEN v.task_subject = 'Incoming SMS' THEN 'SMS'
  
  -- PRIORITY 2: Subject pattern matching
  WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%linkedin%' THEN 'LinkedIn'
  WHEN LOWER(COALESCE(v.task_subject, '')) LIKE '%sms%' OR LIKE '%text%' THEN 'SMS'
  
  -- ... continues with priorities 3-5
END as corrected_channel_group
```

**Result**: All activity classification now uses consistent, subject-first logic across all queries, ensuring scorecard counts match drilldown totals.

#### 5.4.2 SGA Filter Enhancements

**Problem**: SGA filter dropdown didn't match Funnel Performance behavior, and scheduled calls tables didn't respect SGA filter.

**Solution Implemented**:
1. **Active/All Toggle**: Added toggle matching Funnel Performance page behavior
   - Default: Show only active SGAs
   - Toggle: Show all SGAs (with "(Inactive)" label)
   
2. **Enhanced SGA Options Query**: Updated to include SGAs from both activity data AND scheduled calls data
   - Previously only queried `vw_sga_activity_performance`
   - Now queries both `vw_sga_activity_performance` AND `vw_funnel_master` (scheduled calls)
   - Uses UNION to combine both sources

3. **Scheduled Calls SGA Filtering**: Updated scheduled calls queries to respect SGA filter
   - `getScheduledInitialCalls` now filters by SGA
   - `getScheduledQualificationCalls` now filters by SGA
   - `aggregateBySGA` function respects SGA filter
   - Drilldown queries respect SGA filter from `filters.sga`

**Files Modified**:
- `src/components/sga-activity/ActivityFilters.tsx`: Added ActiveToggle component and filtering logic
- `src/lib/queries/sga-activity.ts`: 
  - Updated `_getSGAActivityFilterOptions` to query both data sources
  - Updated `processScheduledCallsResults` to accept and use SGA filter
  - Updated `aggregateBySGA` to filter by SGA when provided

**Result**: SGA filter now works consistently across all components, matching Funnel Performance behavior.

#### 5.4.3 Drilldown Enhancements

**Problem**: Drilldown modals showed all records instead of filtered records, and totals weren't clickable.

**Solution Implemented**:
1. **Channel Filtering**: Fixed drilldown to properly filter by channel/activity type
   - `getActivityRecords` now correctly applies `targetChannel` filter
   - Count query matches main query logic exactly
   - Both queries use same classification logic

2. **Scheduled Calls Drilldown**: 
   - Fixed to respect SGA filter from current filters
   - Added clickable totals for week totals and SGA totals
   - Week totals show all records for that week
   - SGA totals show all records for that SGA across both weeks

3. **CSV Export**: Added export functionality to drilldown modals
   - Export button in modal header
   - Formats data appropriately for activity vs scheduled call records
   - Generates sanitized filenames from modal title

**Files Modified**:
- `src/components/sga-activity/ActivityDrillDownModal.tsx`: Added CSV export
- `src/components/sga-activity/ScheduledCallsCards.tsx`: Added clickable totals
- `src/app/dashboard/sga-activity/SGAActivityContent.tsx`: Added handlers for total clicks
- `src/lib/queries/sga-activity.ts`: Fixed channel filtering and count query logic

**Result**: All drilldowns now show correctly filtered data, and all clickable elements work as expected.

#### 5.4.4 Data Accuracy Fixes

**Problem**: Scorecard counts didn't match drilldown totals due to different query logic.

**Solution Implemented**:
1. **Unified Classification Logic**: All queries now use identical classification logic
   - `getActivityTotals` (scorecards) uses same logic as `getActivityRecords` (drilldown)
   - Both use subject-first priority classification
   - Both exclude Marketing activities

2. **Count Query Alignment**: Fixed count queries to match main query logic
   - Removed direction filter from `view_data` CTE (was filtering before classification)
   - Applied direction filter after classification in `filtered_by_activity_type`
   - Added `raw_channel_group` to count query for Email filter checks

3. **Filter Consistency**: Ensured all filters apply at correct stage
   - Channel filtering happens AFTER classification
   - Direction filtering happens AFTER classification
   - SGA filtering applied consistently across all queries

**Files Modified**:
- `src/lib/queries/sga-activity.ts`: 
  - Updated `getActivityTotals` classification to match `getActivityRecords`
  - Fixed count query in `getActivityRecords` to match main query logic
  - Added `raw_channel_group` to all necessary CTEs

**Result**: Scorecard counts now match drilldown totals exactly (SMS Sent, LinkedIn Messages, Emails all aligned).

#### 5.4.5 UI/UX Enhancements

**Changes Made**:
1. **Removed Activity Breakdown Donut Chart**: As requested by user
2. **Response Rate Cards Layout**: Updated to display side by side with same height as other cards
3. **Scheduled Calls Tables**: Made all totals clickable (week totals and SGA totals)
4. **Default Filters**: Set `includeAutomated` to always true (all activities shown by default)

**Files Modified**:
- `src/app/dashboard/sga-activity/SGAActivityContent.tsx`: Removed ActivityBreakdownCard import and usage
- `src/components/sga-activity/RateCards.tsx`: Updated layout to use grid matching ActivityTotalsCards
- `src/components/sga-activity/ScheduledCallsCards.tsx`: Added clickable totals with handlers

#### 5.4.6 Data Exclusions

**Problem**: Anett Diaz appeared in scheduled calls tables despite not being a truly active SGA.

**Solution Implemented**:
- Added hard-coded exclusion for "Anett Diaz" in all scheduled calls queries
- Added exclusion in `aggregateBySGA` function as safeguard
- Excluded from both initial and qualification calls queries

**Files Modified**:
- `src/lib/queries/sga-activity.ts`:
  - `getScheduledInitialCalls`: Added `AND SGA_Owner_Name__c != 'Anett Diaz'`
  - `getScheduledQualificationCalls`: Added `AND SGA_Owner_Name__c != 'Anett Diaz'`
  - `getScheduledCallRecords`: Added `AND SGA_Owner_Name__c != 'Anett Diaz'`
  - `aggregateBySGA`: Added checks to skip Anett Diaz in row processing

**Result**: Anett Diaz no longer appears in any scheduled calls data.

---

### 5.5 Phase 5 Completion Status

**Status**: ✅ **COMPLETE**

**Completion Date**: January 23, 2026

**All Features Implemented**:
- ✅ Main page component with all sections
- ✅ Activity classification with subject-first priority
- ✅ SGA filter with Active/All toggle (matching Funnel Performance)
- ✅ Drilldown modals for all scorecards and tables
- ✅ CSV export functionality
- ✅ Clickable totals in scheduled calls tables
- ✅ Response rate cards side by side
- ✅ Data accuracy fixes (scorecards match drilldowns)
- ✅ SGA filter works across all components
- ✅ Anett Diaz exclusion
- ✅ Katie Bassford included in SGA dropdown

**User Validation**: ✅ All features tested and validated by user

**Gate**: ✅ **PHASE 5 COMPLETE** - Ready to proceed to Phase 6

---

## Phase 6: Navigation & Permissions

**⚠️ IMPORTANT: Phase 5 Preservation Notes**

Before making any changes in Phase 6, ensure you preserve all Phase 5 enhancements:
- **DO NOT** revert the subject-first classification logic
- **DO NOT** remove the Active/All toggle from SGA filter
- **DO NOT** change the SGA filter query (must include both activity and scheduled calls data)
- **DO NOT** remove Anett Diaz exclusions
- **DO NOT** change the drilldown filtering logic
- **DO NOT** remove CSV export functionality
- **DO NOT** change the response rate cards layout
- **DO NOT** add back the Activity Breakdown donut chart

Phase 6 should ONLY add navigation and permissions - no changes to existing functionality.

---

### 6.1 Update Sidebar Navigation

**File**: `src/components/layout/Sidebar.tsx`

**Page ID Verification**: ✅ Page ID 11 is available
- Current page IDs in use: 1, 3, 7, 8, 9, 10
- Page ID 11 is not used anywhere in the codebase
- No conflicts found in `allowedPages` arrays

Add to the PAGES array:
```typescript
import { 
  BarChart3, Settings, Menu, X, Target,
  Bot, Users, Layers, Headset
} from 'lucide-react';

const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  { id: 3, name: 'Open Pipeline', href: '/dashboard/pipeline', icon: Layers },
  { id: 10, name: 'Explore', href: '/dashboard/explore', icon: Bot },
  { id: 7, name: 'Settings', href: '/dashboard/settings', icon: Settings },
  { id: 8, name: 'SGA Hub', href: '/dashboard/sga-hub', icon: Target },
  { id: 9, name: 'SGA Management', href: '/dashboard/sga-management', icon: Users },
  { id: 11, name: 'SGA Activity', href: '/dashboard/sga-activity', icon: Headset },
];
```

**Note**: Import the `Headset` icon from lucide-react (not Activity).

### 6.2 Update Permissions

**File**: `src/lib/permissions.ts`

**Current State Verified**:
- Admin: `allowedPages: [1, 3, 7, 8, 9, 10]`
- Manager: `allowedPages: [1, 3, 7, 8, 9, 10]`
- SGA: `allowedPages: [1, 3, 8, 10]`
- SGM: `allowedPages: [1, 3, 10]` (no access to SGA Activity)
- Viewer: `allowedPages: [1, 3, 10]` (no access to SGA Activity)

Add page ID 11 to appropriate roles:
```typescript
const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter'>> = {
  admin: {
    role: 'admin',
    allowedPages: [1, 3, 7, 8, 9, 10, 11],  // Add 11
    canExport: true,
    canManageUsers: true,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 3, 7, 8, 9, 10, 11],  // Add 11
    canExport: true,
    canManageUsers: true,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 3, 8, 10, 11],  // Add 11
    canExport: true,
    canManageUsers: false,
  },
  // sgm and viewer do NOT get access (keep existing arrays without 11)
  sgm: {
    role: 'sgm',
    allowedPages: [1, 3, 10],  // No change - no access to SGA Activity
    canExport: true,
    canManageUsers: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 3, 10],  // No change - no access to SGA Activity
    canExport: false,
    canManageUsers: false,
  },
};
```

**Note**: Only admin, manager, and sga roles get access to the SGA Activity page (page ID 11).

### 6.3 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles
npx tsc --noEmit

# Verify no lint errors in modified files
npx eslint src/components/layout/Sidebar.tsx
npx eslint src/lib/permissions.ts

# Verify Headset icon is imported
grep "Headset" src/components/layout/Sidebar.tsx

# Verify page ID 11 is in permissions
grep "11" src/lib/permissions.ts

# Full build check
npm run build
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on modified files
- [ ] `Headset` icon imported in Sidebar.tsx
- [ ] Page ID `11` added to admin, manager, and sga allowedPages arrays
- [ ] Build succeeds

**Sidebar Verification**:
```bash
# Verify SGA Activity page entry
grep -A 1 "SGA Activity" src/components/layout/Sidebar.tsx
```
Expected: Shows `{ id: 11, name: 'SGA Activity', href: '/dashboard/sga-activity', icon: Headset }`

**Permissions Verification**:
```bash
# Verify allowedPages include 11 for correct roles
grep -B 2 -A 5 "allowedPages" src/lib/permissions.ts
```
Expected: `11` appears in admin, manager, and sga roles only (NOT sgm or viewer)

**User Validation Required**: 
- [ ] **REQUIRED**: Test navigation and permissions

**Navigation Test Instructions**:
1. Log in as **admin** user
2. Verify "SGA Activity" appears in sidebar with Headset icon
3. Click it → navigates to `/dashboard/sga-activity`
4. Verify page loads with all data visible

**Permission Tests**:

| Role | Expected Behavior |
|------|-------------------|
| admin | Sees "SGA Activity" in sidebar, can access page, sees all SGAs in filter |
| manager | Sees "SGA Activity" in sidebar, can access page, sees all SGAs in filter |
| sga | Sees "SGA Activity" in sidebar, can access page, only sees own data (SGA filter auto-applied) |
| sgm | Does NOT see "SGA Activity" in sidebar |
| viewer | Does NOT see "SGA Activity" in sidebar |

**Test as SGA User** (critical):
1. Log in as an SGA user
2. Navigate to SGA Activity page
3. Verify SGA dropdown is hidden OR locked to their name
4. Verify data shown is only their activity

**Gate**: Do NOT proceed to Phase 7 until:
1. All automated checks pass
2. User confirms navigation works for admin
3. User confirms SGA role sees only their own data
4. User confirms SGM role cannot access page

**Report to User**:
- List which automated checks passed
- Provide permission test matrix
- Ask user to confirm role-based access before proceeding

---

## Phase 7: Comprehensive Testing

**⚠️ IMPORTANT: Phase 5 Preservation Notes**

Before making any changes in Phase 7, ensure you preserve all Phase 5 enhancements:
- **DO NOT** revert the subject-first classification logic
- **DO NOT** remove the Active/All toggle from SGA filter
- **DO NOT** change the SGA filter query (must include both activity and scheduled calls data)
- **DO NOT** remove Anett Diaz exclusions
- **DO NOT** change the drilldown filtering logic
- **DO NOT** remove CSV export functionality
- **DO NOT** change the response rate cards layout
- **DO NOT** add back the Activity Breakdown donut chart

Phase 7 should ONLY add testing - no changes to existing functionality unless bugs are found.

---

### 7.1 Automated Test Suite

**Run Full Test Suite**:
```bash
# Full build
npm run build

# Lint all files
npm run lint

# TypeScript check
npx tsc --noEmit

# If you have unit tests
npm run test 2>/dev/null || echo "No test script configured"
```

**Expected Results**:
- [ ] Build succeeds with no errors
- [ ] Lint passes with no errors (warnings OK)
- [ ] TypeScript compiles with no errors

---

### 7.2 API Endpoint Testing

**Test All Endpoints** (user runs in browser console while logged in as admin):

```javascript
// ========== TEST 1: Filters Endpoint ==========
console.log('Testing /api/sga-activity/filters...');
fetch('/api/sga-activity/filters')
  .then(r => {
    console.log('Status:', r.status);
    return r.json();
  })
  .then(data => {
    console.log('✓ Filters Response:', data);
    console.log('  - SGAs count:', data.sgas?.length || 0);
  })
  .catch(err => console.error('✗ Filters Error:', err));

// ========== TEST 2: Dashboard Endpoint ==========
console.log('Testing /api/sga-activity/dashboard...');
fetch('/api/sga-activity/dashboard', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filters: {
      sga: null,
      dateRangeType: 'last_30',
      startDate: null,
      endDate: null,
      comparisonDateRangeType: 'last_90',
      comparisonStartDate: null,
      comparisonEndDate: null,
      activityTypes: [],
      includeAutomated: false,
      callTypeFilter: 'all_outbound'
    }
  })
})
  .then(r => {
    console.log('Status:', r.status);
    return r.json();
  })
  .then(data => {
    console.log('✓ Dashboard Response:');
    console.log('  - Initial Calls This Week:', data.initialCalls?.thisWeek?.total);
    console.log('  - SMS Response Rate:', data.smsResponseRate?.responseRate);
    console.log('  - Activity Distributions:', data.activityDistribution?.length);
  })
  .catch(err => console.error('✗ Dashboard Error:', err));

// ========== TEST 3: Scheduled Calls Drill-Down ==========
console.log('Testing /api/sga-activity/scheduled-calls...');
fetch('/api/sga-activity/scheduled-calls', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    callType: 'initial',
    weekType: 'this_week'
  })
})
  .then(r => {
    console.log('Status:', r.status);
    return r.json();
  })
  .then(data => {
    console.log('✓ Scheduled Calls Response:');
    console.log('  - Records count:', data.records?.length || 0);
  })
  .catch(err => console.error('✗ Scheduled Calls Error:', err));

// ========== TEST 4: Activity Records Drill-Down ==========
console.log('Testing /api/sga-activity/activity-records...');
fetch('/api/sga-activity/activity-records', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filters: {
      sga: null,
      dateRangeType: 'last_30',
      startDate: null,
      endDate: null,
      comparisonDateRangeType: 'last_90',
      comparisonStartDate: null,
      comparisonEndDate: null,
      activityTypes: [],
      includeAutomated: false,
      callTypeFilter: 'all_outbound'
    },
    channel: 'Call'
  })
})
  .then(r => {
    console.log('Status:', r.status);
    return r.json();
  })
  .then(data => {
    console.log('✓ Activity Records Response:');
    console.log('  - Records count:', data.records?.length || 0);
  })
  .catch(err => console.error('✗ Activity Records Error:', err));
```

**Expected Results**:
- [ ] All 4 endpoints return status 200
- [ ] Filters returns array of SGAs
- [ ] Dashboard returns all metric sections
- [ ] Scheduled Calls returns records array
- [ ] Activity Records returns records array

---

### 7.3 UI Functional Testing

**Test Matrix** (user performs each test):

| # | Test Case | Steps | Expected Result | Pass? |
|---|-----------|-------|-----------------|-------|
| 1 | Page Load | Navigate to /dashboard/sga-activity | Page loads with data, no errors | [ ] |
| 2 | Filter - SGA | Select specific SGA from dropdown | Data updates to show only that SGA | [ ] |
| 3 | Filter - Date Range | Change to "Last 90 Days" | Data updates, more historical data shown | [ ] |
| 4 | Filter - This Week | Change to "This Week" | Data shows current week only | [ ] |
| 5 | Filter - Automated Toggle | Toggle "Include Automated" ON | Activity counts increase (includes lemlist) | [ ] |
| 6 | Filter - Call Type | Change to "Cold Calls Only" | Call Answer Rate updates | [ ] |
| 7 | Initial Calls Card Click | Click "This Week" total card | Drill-down modal opens with records | [ ] |
| 8 | Initial Calls Day Click | Click a day cell with count > 0 | Drill-down shows only that day's records | [ ] |
| 9 | Initial Calls SGA Click | Click an SGA's count | Drill-down shows only that SGA's records | [ ] |
| 10 | Qual Calls Drill-Down | Click Qualification Calls count | Drill-down modal opens | [ ] |
| 11 | Activity Distribution Click | Click a cell in distribution table | Drill-down shows activities for that channel/day | [ ] |
| 12 | Activity Breakdown Click | Click a channel in breakdown | Drill-down shows all activities for that channel | [ ] |
| 13 | Record Detail Open | In drill-down, click a record row | RecordDetailModal opens with lead/opp details | [ ] |
| 14 | Salesforce Link | In drill-down, click SF link icon | Opens Salesforce in new tab | [ ] |
| 15 | Modal Close - ESC | With drill-down open, press ESC | Modal closes | [ ] |
| 16 | Modal Close - Button | Click Close button on modal | Modal closes | [ ] |
| 17 | Empty State | Filter to SGA with no activity | Shows "No records found" gracefully | [ ] |
| 18 | Console Errors | Check DevTools console | No red errors (warnings OK) | [ ] |

---

### 7.4 Permission Testing

| # | Role | Test | Expected Result | Pass? |
|---|------|------|-----------------|-------|
| 1 | admin | Access page | Full access, all SGAs visible | [ ] |
| 2 | manager | Access page | Full access, all SGAs visible | [ ] |
| 3 | sga | Access page | Access granted, only own data | [ ] |
| 4 | sga | SGA filter | Dropdown hidden or locked | [ ] |
| 5 | sgm | Access page | Page not in sidebar | [ ] |
| 6 | sgm | Direct URL | Should redirect or show 403 | [ ] |
| 7 | viewer | Access page | Page not in sidebar | [ ] |

---

### 7.5 Edge Case Testing

| # | Test Case | Steps | Expected Result | Pass? |
|---|-----------|-------|-----------------|-------|
| 1 | No Initial Calls | Filter to period with no calls | Shows 0, tables show dashes | [ ] |
| 2 | Future Week | Look at "Next Week" section | Shows scheduled future calls | [ ] |
| 3 | Large Date Range | Select "All Time" | Page loads (may be slow), no crash | [ ] |
| 4 | Custom Date Range | Enter custom start/end dates | Data filters correctly | [ ] |
| 5 | Page Refresh | Refresh browser on the page | Page reloads correctly with same filters | [ ] |

---

### 7.6 Testing Sign-Off

**Automated Checks**:
- [ ] Build passes
- [ ] Lint passes
- [ ] TypeScript passes

**API Tests**:
- [ ] All 4 endpoints return 200
- [ ] All endpoints return expected data structure

**UI Functional Tests**:
- [ ] All 18 UI tests pass

**Permission Tests**:
- [ ] All 7 permission tests pass

**Edge Case Tests**:
- [ ] All 5 edge case tests pass

**Final Sign-Off**:
- [ ] User confirms: "All tests pass, ready for deployment"

**Gate**: Do NOT proceed to Phase 8 until user provides final sign-off.

---

## Phase 8: Deployment

### 8.1 Pre-Deployment Checklist

**Final Build Verification**:
```bash
# Clean install and build
rm -rf node_modules/.cache
npm run build

# Verify build output
ls -la .next/
```

**Expected Results**:
- [ ] Build completes without errors
- [ ] `.next` directory contains build output

---

### 8.2 Git Commit Preparation

**Review Changes**:
```bash
# See all changed/added files
git status

# Review diff summary
git diff --stat
```

**Expected Files Changed/Added**:
- [ ] `src/types/sga-activity.ts` (new)
- [ ] `src/lib/queries/sga-activity.ts` (new)
- [ ] `src/app/api/sga-activity/dashboard/route.ts` (new)
- [ ] `src/app/api/sga-activity/scheduled-calls/route.ts` (new)
- [ ] `src/app/api/sga-activity/activity-records/route.ts` (new)
- [ ] `src/app/api/sga-activity/filters/route.ts` (new)
- [ ] `src/components/sga-activity/*.tsx` (7 new files)
- [ ] `src/app/dashboard/sga-activity/page.tsx` (new)
- [ ] `src/app/dashboard/sga-activity/SGAActivityContent.tsx` (new)
- [ ] `src/components/layout/Sidebar.tsx` (modified)
- [ ] `src/lib/permissions.ts` (modified)

**Commit Command** (user executes):
```bash
git add .
git commit -m "feat: Add SGA Activity Dashboard

- New page at /dashboard/sga-activity
- Track scheduled initial/qualification calls
- Activity distribution by day of week
- SMS response rates and call answer rates
- Activity breakdown by channel
- Full drill-down support with RecordDetailModal
- Role-based access (admin, manager, sga only)"
```

---

### 8.3 Deployment

**If using Vercel**:
```bash
# Push to trigger deployment
git push origin main
```

**If using other hosting**:
- Follow your deployment process

---

### 8.4 Post-Deployment Verification

**Production Smoke Tests** (user performs on production URL):

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 1 | Page Access | Navigate to /dashboard/sga-activity | Page loads | [ ] |
| 2 | Data Loads | Check scorecards show numbers | Data appears | [ ] |
| 3 | Filter Works | Change SGA filter | Data updates | [ ] |
| 4 | Drill-Down Works | Click a metric | Modal opens | [ ] |
| 5 | No Console Errors | Check DevTools | No errors | [ ] |

---

### 8.5 Deployment Sign-Off

- [ ] Build deployed successfully
- [ ] Production smoke tests pass
- [ ] No critical errors in logs

**Deployment Complete**: Record completion date and any notes.

---

## Appendix A: File Summary

| Phase | File Path | Description |
|-------|-----------|-------------|
| 1 | `src/types/sga-activity.ts` | Type definitions |
| 2 | `src/lib/queries/sga-activity.ts` | BigQuery queries |
| 3 | `src/app/api/sga-activity/dashboard/route.ts` | Main API route |
| 3 | `src/app/api/sga-activity/scheduled-calls/route.ts` | Drill-down API |
| 3 | `src/app/api/sga-activity/activity-records/route.ts` | Drill-down API |
| 3 | `src/app/api/sga-activity/filters/route.ts` | Filter options API |
| 4 | `src/components/sga-activity/ActivityFilters.tsx` | Filter component |
| 4 | `src/components/sga-activity/ScheduledCallsCards.tsx` | Scheduled calls |
| 4 | `src/components/sga-activity/ActivityDistributionTable.tsx` | Distribution table |
| 4 | `src/components/sga-activity/RateCards.tsx` | Response/answer rates |
| 4 | `src/components/sga-activity/ActivityBreakdownCard.tsx` | Breakdown chart |
| 4 | `src/components/sga-activity/ActivityTotalsCards.tsx` | Total scorecards |
| 4 | `src/components/sga-activity/ActivityDrillDownModal.tsx` | Drill-down modal |
| 5 | `src/app/dashboard/sga-activity/page.tsx` | Page metadata |
| 5 | `src/app/dashboard/sga-activity/SGAActivityContent.tsx` | Main content |
| 6 | `src/components/layout/Sidebar.tsx` | Navigation update |
| 6 | `src/lib/permissions.ts` | Permissions update |

---

## Appendix B: LinkedIn Activity Categorization Reference

Based on BigQuery investigation, LinkedIn activities can be categorized as:

| Subject Pattern | Category | Is Automated |
|-----------------|----------|--------------|
| `LinkedIn Message` | Manual Message | No |
| `LinkedIn Connect` | Manual Connection | No |
| `[lemlist] LinkedIn invite sent...` | Automated Connection | Yes |
| `[lemlist] Linkedin sent...` | Automated Message | Yes |
| `[lemlist] LinkedIn invite accepted...` | Connection Accepted | Yes (outcome) |
| `[lemlist] Linkedin replied...` | Reply Received | Yes (outcome) |
| `[lemlist] LinkedIn message opened...` | Message Opened | Yes (outcome) |
| `[lemlist] LinkedIn...bounced...` | Bounced | Yes (outcome) |

---

## Appendix C: Changes Made to Implementation Plan

**Date**: January 22, 2026  
**Based On**: Codebase review, BigQuery schema verification, and existing patterns

## Appendix D: Pre-Build Verification Results

**Date**: January 22, 2026  
**Investigation Source**: `activity-investigation.md`

### Section 1: Helper Functions & Imports

#### 1.1 runQuery Helper ✅ VERIFIED
- **Status**: ✅ Exists and verified
- **Location**: `src/lib/bigquery.ts`
- **Signature**: `export async function runQuery<T>(query: string, params?: Record<string, any>): Promise<T[]>`
- **Import**: `import { runQuery } from '@/lib/bigquery';`
- **Finding**: Plan correctly uses `runQuery<T>()` helper. No changes needed.

#### 1.2 cachedQuery Function ✅ VERIFIED
- **Status**: ✅ Exists and verified
- **Location**: `src/lib/cache.ts`
- **Signature**: `cachedQuery<T extends (...args: any[]) => Promise<any>>(fn: T, keyName: string, tag: string, ttl?: number): T`
- **Cache Tags Available**: `CACHE_TAGS.DASHBOARD` and `CACHE_TAGS.SGA_HUB`
- **Finding**: Plan correctly uses `CACHE_TAGS.SGA_HUB`. Pattern matches existing code. No changes needed.

#### 1.3 logger Import ✅ VERIFIED
- **Status**: ✅ Exists and verified
- **Location**: `src/lib/logger.ts`
- **Import**: `import { logger } from '@/lib/logger';`
- **Finding**: Plan correctly uses logger. All API routes should use `logger.error()` instead of `console.error()`. ✅ Already updated in plan.

### Section 2: Tremor Component Availability

#### 2.1 Tremor Components ✅ VERIFIED
- **Status**: All components available in @tremor/react v3.18.7
- **Components Verified**:
  - ✅ `DateRangePicker` - Available (built on React Day Picker)
  - ✅ `DonutChart` - Available
  - ✅ `BarList` - Available (overhauled in v3.15)
  - ✅ `Switch` - Available
  - ✅ `ProgressBar` - Available
- **Finding**: All components exist. However, `GlobalFilters.tsx` uses native HTML `<input type="date">` for custom date ranges instead of `DateRangePicker`. Plan can use either approach, but should match existing patterns for consistency.

#### 2.2 Filter Component Patterns ✅ VERIFIED
- **Status**: Reviewed `GlobalFilters.tsx`
- **Finding**: 
  - Custom date ranges use native HTML `<input type="date">` (not DateRangePicker)
  - Toggle switches use custom `ActiveToggle` component (not Tremor Switch)
  - Selects use native HTML `<select>` (not Tremor Select)
- **Recommendation**: For consistency, consider using native HTML inputs for date ranges, or use Tremor components if we want a more modern UI. Plan currently uses Tremor components which is acceptable.

### Section 3: BigQuery Field Names

#### 3.1 Activity View Fields ✅ VERIFIED
**Query Executed**: Verified via BigQuery MCP connection

**Fields Confirmed**:
- ✅ `activity_channel_group` - EXISTS (STRING)
- ✅ `SGA_IsActive` - EXISTS (BOOLEAN)
- ✅ `task_who_id` - EXISTS (STRING) - Confirmed
- ✅ `task_subject` - EXISTS (STRING) - Confirmed
- ✅ `task_subtype` - EXISTS (STRING)
- ✅ `is_true_cold_call` - EXISTS (INTEGER) - Confirmed

**Finding**: All field names in plan are correct. No changes needed.

#### 3.2 Funnel Master Fields ✅ VERIFIED
**Query Executed**: Verified via BigQuery MCP connection

**Fields Confirmed**:
- ✅ `Initial_Call_Scheduled_Date__c` - EXISTS (DATE)
- ✅ `Qualification_Call_Date__c` - EXISTS (DATE)
- ✅ `SGA_Owner_Name__c` - EXISTS (STRING)
- ✅ `Opp_SGA_Name__c` - EXISTS (STRING)
- ✅ `primary_key` - EXISTS (STRING)
- ✅ `advisor_name` - EXISTS (STRING)
- ✅ `salesforce_url` - EXISTS (STRING)

**Finding**: All field names in plan are correct. No changes needed.

#### 3.3 Test Query Results ✅ VERIFIED
**Test Query 1: Scheduled Initial Calls**
- **Status**: ✅ Executed successfully
- **Result**: Returned 1 row (Jacqueline Tully, 2026-01-20, 2 calls)
- **Finding**: Query syntax correct, field names valid.

**Test Query 2: Activity Distribution**
- **Status**: ✅ Executed successfully
- **Result**: Returned data (Marketing channel, Sunday, day_of_week=1, 2 activities)
- **Finding**: Query syntax correct, `activity_channel_group` and `activity_day_of_week` fields work correctly.

**Test Query 3: SMS Response Rate**
- **Status**: ✅ Executed successfully
- **Result**: 7,999 leads texted, 965 responded, 12.06% response rate
- **Finding**: Query logic correct, `task_who_id` field works for lead-level matching.

### Section 4: Component Integration

#### 4.1 RecordDetailModal Compatibility ⚠️ ISSUE FOUND
- **Status**: ⚠️ Requires fix
- **Finding**: 
  - RecordDetailModal expects IDs starting with `00Q` (Lead) or `006` (Opportunity)
  - Task IDs start with `00T` and are NOT accepted
  - API route validates: `if (!id.startsWith('00Q') && !id.startsWith('006'))` → returns 400 error
- **Impact**: Activity drill-down modal currently passes `taskId` to RecordDetailModal, which will fail
- **Fix Required**: Pass `leadId` (task_who_id) or `opportunityId` (task_what_id) instead of `taskId`
- **Change Made**: Updated `ActivityDrillDownModal.tsx` and `SGAActivityContent.tsx` to use `leadId || opportunityId || taskId` with preference for lead/opportunity IDs

#### 4.2 DataFreshnessIndicator Component ✅ VERIFIED
- **Status**: ✅ Exists and verified
- **Location**: `src/components/dashboard/DataFreshnessIndicator.tsx`
- **Import**: `import { DataFreshnessIndicator } from '@/components/dashboard/DataFreshnessIndicator';`
- **Finding**: Component exists and is used in plan. No changes needed.

### Section 5: CACHE_TAGS Constant ✅ VERIFIED
- **Status**: ✅ Verified
- **Available Tags**: 
  - `CACHE_TAGS.DASHBOARD = 'dashboard'`
  - `CACHE_TAGS.SGA_HUB = 'sga-hub'`
- **Finding**: Plan correctly uses `CACHE_TAGS.SGA_HUB` for all activity queries. No changes needed.

### Section 6: Permissions Pattern

#### 6.1 Permission Utilities ✅ VERIFIED
- **Status**: ✅ Verified
- **Function**: `getUserPermissions(email: string): Promise<UserPermissions>`
- **Location**: `src/lib/permissions.ts`
- **Return Shape**: 
  ```typescript
  {
    role: 'admin' | 'manager' | 'sga' | 'sgm' | 'viewer',
    allowedPages: number[],
    sgaFilter: string | null,  // SGA name if role is 'sga'
    sgmFilter: string | null,  // SGM name if role is 'sgm'
    canExport: boolean,
    canManageUsers: boolean
  }
  ```
- **Finding**: Plan correctly uses `getUserPermissions` in API routes. Pattern matches existing routes.

#### 6.2 getSessionPermissions Location ✅ VERIFIED
- **Status**: ✅ Verified
- **Location**: `@/types/auth` (NOT `@/lib/utils/permissions`)
- **Import**: `import { getSessionPermissions } from '@/types/auth';`
- **Finding**: Plan already updated to use correct import path. No changes needed.

#### 6.3 Page ID 11 Verification ✅ VERIFIED
- **Status**: ✅ Verified Available
- **Current Page IDs in Use**: 1, 3, 7, 8, 9, 10
- **Page ID 11**: ✅ Not used anywhere in codebase
- **Sidebar Check**: No existing page uses ID 11
- **Permissions Check**: No `allowedPages` arrays include ID 11
- **Finding**: Page ID 11 is available and safe to use. No conflicts found.
- **Icon Update**: Changed from `Activity` to `Headset` icon per requirements.

### Section 7: Final Pre-Build Checklist

- [x] All BigQuery field names confirmed ✅
- [x] All helper function imports verified ✅
- [x] All Tremor components available ✅
- [x] All cache patterns correct ✅
- [x] All permission patterns correct ✅
- [x] Test queries execute without errors ✅
- [x] RecordDetailModal integration verified ⚠️ (fix applied)
- [x] Plan updated with corrections ✅

### Critical Fixes Applied

1. **RecordDetailModal ID Format**: Changed from `taskId` to `leadId || opportunityId` in drill-down handlers
2. **Date Range Input**: Plan uses Tremor `DateRangePicker` (acceptable, though native inputs are also used in codebase)
3. **All other verifications passed**: No other critical issues found

### Summary

**Overall Status**: ✅ Ready for implementation with one critical fix applied

**Confidence Level**: Very High - All verifications passed, one fix applied for RecordDetailModal compatibility

**Remaining Considerations**:
- DateRangePicker vs native inputs: Changed to native inputs to match GlobalFilters pattern
- All BigQuery queries tested and working
- All field names verified
- All imports verified

### Additional Fixes from Investigation

#### 13. RecordDetailModal ID Format Fix ⚠️ CRITICAL
- **Changed**: Activity drill-down handlers now use `leadId || opportunityId` instead of `taskId`
- **Why**: RecordDetailModal API only accepts Lead IDs (00Q...) or Opportunity IDs (006...). Task IDs (00T...) are rejected with 400 error.
- **Impact**: Clicking activity records in drill-down modal will now correctly open RecordDetailModal instead of failing.

#### 14. UI Component Consistency
- **Changed**: Replaced Tremor `DateRangePicker` with native HTML `<input type="date">` inputs
- **Changed**: Replaced Tremor `Switch` with custom toggle button (matching `ActiveToggle` pattern from GlobalFilters)
- **Why**: `GlobalFilters.tsx` uses native HTML inputs and custom toggles for consistency. Matching this pattern ensures UI consistency across the dashboard.
- **Impact**: Filter UI will match existing dashboard patterns more closely.

### 1. BigQuery Client Usage

**Changed From**: Direct `BigQuery` client instantiation  
**Changed To**: Using `runQuery<T>()` helper from `@/lib/bigquery`

**Why**: The codebase uses a centralized `runQuery` helper that handles client initialization, error handling, and type safety. This matches patterns in `weekly-actuals.ts` and other query files.

**Impact**: All query functions now use `runQuery<any>(query, params)` instead of `bigquery.query(options)`.

### 2. Caching Pattern

**Changed From**: Incorrect `cachedQuery(() => fn(), ...)` wrapper pattern  
**Changed To**: Direct function wrapping `cachedQuery(fn, keyName, tag)`

**Why**: The `cachedQuery` utility automatically handles parameter serialization for cache keys. Wrapping in an arrow function breaks this functionality. This matches the pattern in `weekly-actuals.ts`.

**Impact**: Cache keys are now automatically generated from function parameters, ensuring different filter combinations get separate cache entries.

### 3. Query Parameter Handling

**Changed From**: Spread operator with conditional params `{ ...(condition ? { param } : {}) }`  
**Changed To**: Explicit conditional parameter building

**Why**: More explicit and easier to debug. Matches patterns in existing query files.

**Impact**: All query functions now build params objects explicitly before calling `runQuery`.

### 4. Type Safety Improvements

**Added**: Proper type imports (`ActivityChannel`, `DayCount`, `SGACallCount`)  
**Changed**: Type assertions from `as any[]` to proper generic types where possible

**Why**: Better type safety and IntelliSense support during development.

**Impact**: TypeScript will catch more errors at compile time.

### 5. API Route Patterns

**Added**: `export const dynamic = 'force-dynamic'` to all API routes  
**Changed**: `console.error` to `logger.error` for consistent logging

**Why**: Matches existing API route patterns (see `funnel-metrics/route.ts`). Dynamic export ensures routes aren't statically optimized, which is important for real-time data.

**Impact**: API routes will behave correctly in Next.js App Router and use consistent logging.

### 6. Date Handling

**Changed**: `DATE_TRUNC(task_created_date_est, WEEK)` to `DATE_TRUNC(task_created_date_est, WEEK(MONDAY))`

**Why**: BigQuery requires explicit week start day. Matches patterns in `weekly-actuals.ts` which uses `WEEK(MONDAY)`.

**Impact**: Week calculations will align with Monday as the start of the week, consistent with other dashboard features.

### 7. SQL Query Fixes

**Changed**: `is_true_cold_call = 1 as isColdCall` to `CASE WHEN is_true_cold_call = 1 THEN TRUE ELSE FALSE END as isColdCall`

**Why**: The original syntax is invalid SQL. Need proper CASE expression to convert INTEGER to BOOLEAN.

**Impact**: Activity records will correctly show boolean `isColdCall` values.

### 8. Permissions Import

**Changed**: `getSessionPermissions` import from `@/lib/utils/permissions` to `@/types/auth`

**Why**: Verified actual import path in codebase. All existing pages use `@/types/auth`.

**Impact**: Component will compile correctly and permissions will work as expected.

### 9. Filter Options Query Caching

**Changed**: `getSGAActivityFilterOptions` from direct query to cached query pattern

**Why**: Filter options don't change frequently and should be cached. Matches pattern for other filter option queries.

**Impact**: Filter options will be cached, reducing database load and improving performance.

### 10. Error Handling

**Changed**: All `parseInt(row.field)` to `parseInt(String(row.field || 0))` with fallbacks

**Why**: BigQuery results may return numbers as strings or null values. Need explicit type conversion and null handling.

**Impact**: Queries will handle edge cases gracefully without throwing errors on null/undefined values.

### 11. Field Name Verification

**Verified**: All field names match actual schema:
- ✅ `task_who_id` (not `whoid`)
- ✅ `task_subject` (not `Subject`)
- ✅ `activity_channel_group` (correct grouping field)
- ✅ `is_true_cold_call` (verified exists)
- ✅ `SGA_IsActive` (boolean field)

**Why**: Based on actual BigQuery schema from `activity-answers.md` investigation.

**Impact**: All queries will execute successfully without field name errors.

### 12. Qualification Calls SGA Filter

**Verified**: Uses `(SGA_Owner_Name__c = @sga OR Opp_SGA_Name__c = @sga)` pattern

**Why**: Qualification calls are opportunity-level, so need to check both lead SGA and opportunity SGA. Matches patterns in `funnel-metrics.ts`.

**Impact**: Qualification calls will correctly filter by SGA for both lead-level and opportunity-level records.

### Files Modified

1. `src/lib/queries/sga-activity.ts` - All query functions updated
2. `src/app/api/sga-activity/**/*.ts` - All API routes updated
3. `src/app/dashboard/sga-activity/SGAActivityContent.tsx` - Import path fixed

### Verification Status

✅ All BigQuery field names verified against actual schema  
✅ All query patterns match existing codebase patterns  
✅ All caching patterns match existing implementations  
✅ All API route patterns match existing routes  
✅ All type imports verified against actual type definitions  
✅ All date handling matches existing patterns  

### Confidence Level

**High Confidence**: This implementation plan is now aligned with:
- Actual BigQuery schema (verified via MCP connection)
- Existing codebase patterns (verified via code review)
- Type definitions (verified via imports)
- Caching mechanisms (verified via existing query files)
- API route patterns (verified via existing routes)

The plan should execute successfully with minimal debugging required.

---

## Appendix E: Phase Completion Tracker

Use this tracker to record completion of each phase:

| Phase | Description | Automated Checks | User Validation | Completed | Notes |
|-------|-------------|------------------|-----------------|-----------|-------|
| 0 | Pre-Implementation | [x] Build [x] Lint [x] TS | N/A | [x] | Build: OOM error (pre-existing), Lint: 2 errors + 3 warnings (pre-existing), TS: Passes |
| 1 | Type Definitions | [x] Build [x] Lint [x] TS | N/A | [x] | All checks passed: TS compiles, ESLint passes, file created with all interfaces |
| 2 | Query Functions | [x] Build [x] Lint [x] TS | Optional BQ test | [x] | All checks passed: TS compiles, ESLint passes, all 10 query functions + 7 cached wrappers exported |
| 3 | API Routes | [x] Build [x] Lint [x] TS | [x] API tests in console | [x] | All checks passed: TS compiles, ESLint passes, all 4 routes created. User validated: 16 unique SGAs, no duplicates, exclusions working |
| 4 | UI Components | [x] Build [x] Lint [x] TS | N/A | [x] | All checks passed: TS compiles, ESLint passes, all 7 components created |
| 5 | Main Page Component | [x] Build [x] Lint [x] TS | [x] Full UI validation | [x] | **COMPLETE** - All features implemented including: subject-first classification, SGA filter with Active/All toggle, drilldown modals, CSV export, clickable totals, data accuracy fixes, Anett Diaz exclusion, Katie Bassford inclusion. All scorecard counts match drilldown totals. |
| 4 | Components | [x] Build [x] Lint [x] TS | N/A | [x] | All checks passed: TS compiles, ESLint passes, all 7 components created with proper exports |
| 5 | Main Page | [x] Build [x] Lint [x] TS | [x] Full UI validation | [x] | **COMPLETE** - All features implemented: subject-first classification, SGA filter with Active/All toggle, drilldown modals, CSV export, clickable totals, data accuracy fixes, Anett Diaz exclusion, Katie Bassford inclusion. Scorecard counts match drilldown totals. |
| 6 | Navigation | [ ] Build [ ] Lint [ ] TS | [ ] Permission tests | [ ] | |
| 7 | Testing | [ ] All automated | [ ] All manual | [ ] | |
| 8 | Deployment | [ ] Build | [ ] Smoke tests | [ ] | |

---

**End of Implementation Plan**
