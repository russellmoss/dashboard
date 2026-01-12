# Forecast Goals Integration - Implementation Guide

## Overview

This guide provides step-by-step instructions for integrating daily-ized forecast goals into the Savvy Funnel Analytics Dashboard. The implementation adds goal tracking to:
- **Scorecards**: SQL and SQO cards with actual vs goal comparison
- **Channel Performance Table**: Goals for Prospects, MQLs, SQLs, SQOs, Joined by channel
- **Source Performance Table**: Goals for Prospects, MQLs, SQLs, SQOs, Joined by source

## Prerequisites

- ✅ BigQuery view created: `savvy-gtm-analytics.Tableau_Views.vw_daily_forecast`
- ✅ View verified with test queries (Advisor Waitlist SQOs = 1.42 for Jan 1-11, 2026)
- ✅ Existing dashboard working with current functionality
- ✅ **Google Drive API enabled** in GCP project (required for external tables referencing Drive files)
- ✅ **Service account has Drive access**: If `vw_daily_forecast` references a Google Drive file, the service account must:
  - Have Viewer access to the Drive file
  - Have `drive.readonly` scope in BigQuery client (see Phase 0 below)

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Data Flow                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   vw_daily_forecast (BQ)                                            │
│          │                                                           │
│          ▼                                                           │
│   forecast-goals.ts (Query Function)                                │
│          │                                                           │
│          ▼                                                           │
│   API Routes (funnel-metrics, source-performance)                   │
│          │                                                           │
│          ▼                                                           │
│   api-client.ts (Frontend API)                                      │
│          │                                                           │
│          ▼                                                           │
│   Components (Scorecards, Tables) ─── Display with variance         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## PHASE 1: Constants and Type Definitions

### Step 1.1: Update Constants

**Cursor.ai Prompt:**
```
Update src/config/constants.ts to add the DAILY_FORECAST_VIEW constant for the new BigQuery view that contains daily-ized forecast goals.
```

**Code to add to `src/config/constants.ts`:**
```typescript
// Add after existing constants
export const DAILY_FORECAST_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_daily_forecast';
```

**Full file should look like:**
```typescript
// Application-wide constants

export const OPEN_PIPELINE_STAGES = [
  'Engaged', 
  'Qualifying', 
  'Call Scheduled', 
  'Discovery', 
  'Sales Process', 
  'Negotiating', 
  'Outreach', 
  'Re-Engaged'
];

export const RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI';
export const RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC';

export const FULL_TABLE = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';
export const FORECAST_TABLE = 'savvy-gtm-analytics.SavvyGTMData.q4_2025_forecast';
export const MAPPING_TABLE = 'savvy-gtm-analytics.SavvyGTMData.new_mapping';
export const DAILY_FORECAST_VIEW = 'savvy-gtm-analytics.Tableau_Views.vw_daily_forecast';

export const DEFAULT_YEAR = 2025;
export const DEFAULT_DATE_PRESET = 'q4' as const;
```

**✅ VERIFICATION GATE 1.1:**
```bash
# Run TypeScript check
npx tsc --noEmit

# Expected: No errors related to constants.ts
```

---

### Step 1.2: Update BigQuery Raw Types

**Cursor.ai Prompt:**
```
Update src/types/bigquery-raw.ts to add raw result interfaces for forecast goal queries. Add RawForecastGoalsResult, RawChannelForecastResult, and RawSourceForecastResult interfaces.
```

**Code to add to `src/types/bigquery-raw.ts`:**
```typescript
// Add at the end of the file, before the helper functions

// Forecast Goals Raw Results
export interface RawForecastGoalsResult {
  prospects_goal: number | null;
  mqls_goal: number | null;
  sqls_goal: number | null;
  sqos_goal: number | null;
  joined_goal: number | null;
}

export interface RawChannelForecastResult extends RawForecastGoalsResult {
  channel_grouping_name: string | null;
}

export interface RawSourceForecastResult extends RawForecastGoalsResult {
  original_source: string | null;
  channel_grouping_name: string | null;
}
```

**✅ VERIFICATION GATE 1.2:**
```bash
npx tsc --noEmit
# Expected: No TypeScript errors
```

---

### Step 1.3: Update Dashboard Types

**Cursor.ai Prompt:**
```
Update src/types/dashboard.ts to add forecast goal types. Add ForecastGoals interface, extend FunnelMetrics with optional goals, add WithGoals variants for ChannelPerformance and SourcePerformance, and add a GoalVariance helper type for displaying variances.
```

**Code to add to `src/types/dashboard.ts`:**
```typescript
// Add after FunnelMetrics interface

// Forecast goals for any metric level
export interface ForecastGoals {
  prospects: number;
  mqls: number;
  sqls: number;
  sqos: number;
  joined: number;
}

// Variance calculation result
export interface GoalVariance {
  actual: number;
  goal: number;
  difference: number;      // actual - goal (positive = ahead, negative = behind)
  percentVariance: number; // ((actual - goal) / goal) * 100
  isOnTrack: boolean;      // actual >= goal
}

// Extended types with goals
export interface FunnelMetricsWithGoals extends FunnelMetrics {
  goals: ForecastGoals | null;
}

export interface ChannelPerformanceWithGoals extends ChannelPerformance {
  goals?: {
    prospects: number;
    mqls: number;
    sqls: number;
    sqos: number;
    joined: number;
  };
}

export interface SourcePerformanceWithGoals extends SourcePerformance {
  goals?: {
    prospects: number;
    mqls: number;
    sqls: number;
    sqos: number;
    joined: number;
  };
}
```

**✅ VERIFICATION GATE 1.3:**
```bash
npx tsc --noEmit
# Expected: No TypeScript errors
```

---

## PHASE 2: Query Functions

### Step 2.1: Create Forecast Goals Query Function

**Cursor.ai Prompt:**
```
Create a new file src/lib/queries/forecast-goals.ts that queries the vw_daily_forecast BigQuery view. Create three functions:
1. getAggregateForecastGoals - Returns total goals for a date range (for scorecards)
2. getChannelForecastGoals - Returns goals grouped by channel
3. getSourceForecastGoals - Returns goals grouped by source, with optional channel filter

Use parameterized queries with @paramName syntax. The view has columns: date_day, original_source, channel_grouping_name, prospects_daily, mqls_daily, sqls_daily, sqos_daily, joined_daily. SUM the daily columns across the date range to get pro-rated goals.

Important: The view only has data from 2025-10-01 onwards. Return null/empty array for date ranges before this.
```

**Create `src/lib/queries/forecast-goals.ts`:**
```typescript
// src/lib/queries/forecast-goals.ts
// Query functions for daily-ized forecast goals from vw_daily_forecast view

import { runQuery } from '../bigquery';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters } from '../utils/date-helpers';
import { 
  RawForecastGoalsResult, 
  RawChannelForecastResult, 
  RawSourceForecastResult,
  toNumber, 
  toString 
} from '@/types/bigquery-raw';
import { DAILY_FORECAST_VIEW } from '@/config/constants';
import { ForecastGoals } from '@/types/dashboard';

// Output types for channel and source goals
export interface ChannelForecastGoals extends ForecastGoals {
  channel: string;
}

export interface SourceForecastGoals extends ForecastGoals {
  source: string;
  channel: string;
}

// The earliest date with forecast data
const FORECAST_START_DATE = '2025-10-01';

/**
 * Check if the date range has forecast data available
 */
function hasForecastData(startDate: string): boolean {
  const filterStart = new Date(startDate);
  const forecastStart = new Date(FORECAST_START_DATE);
  return filterStart >= forecastStart;
}

/**
 * Get aggregate forecast goals for the entire period (for scorecards)
 * Sums daily rates across the date range to get pro-rated goals
 */
export async function getAggregateForecastGoals(
  filters: DashboardFilters
): Promise<ForecastGoals | null> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Check if we have forecast data for this date range
  if (!hasForecastData(startDate)) {
    return null;
  }
  
  const query = `
    SELECT
      ROUND(SUM(prospects_daily), 2) AS prospects_goal,
      ROUND(SUM(mqls_daily), 2) AS mqls_goal,
      ROUND(SUM(sqls_daily), 2) AS sqls_goal,
      ROUND(SUM(sqos_daily), 2) AS sqos_goal,
      ROUND(SUM(joined_daily), 2) AS joined_goal
    FROM \`${DAILY_FORECAST_VIEW}\`
    WHERE date_day BETWEEN @startDate AND @endDate
  `;
  
  const params = { startDate, endDate };
  
  const results = await runQuery<RawForecastGoalsResult>(query, params);
  
  if (results.length === 0) {
    return null;
  }
  
  const r = results[0];
  
  // Check if we got any data (all nulls means no forecast data)
  if (r.sqls_goal === null && r.sqos_goal === null && r.joined_goal === null) {
    return null;
  }
  
  return {
    prospects: toNumber(r.prospects_goal),
    mqls: toNumber(r.mqls_goal),
    sqls: toNumber(r.sqls_goal),
    sqos: toNumber(r.sqos_goal),
    joined: toNumber(r.joined_goal),
  };
}

/**
 * Get forecast goals grouped by channel (for Channel Performance table)
 */
export async function getChannelForecastGoals(
  filters: DashboardFilters
): Promise<ChannelForecastGoals[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  if (!hasForecastData(startDate)) {
    return [];
  }
  
  const query = `
    SELECT
      channel_grouping_name,
      ROUND(SUM(prospects_daily), 2) AS prospects_goal,
      ROUND(SUM(mqls_daily), 2) AS mqls_goal,
      ROUND(SUM(sqls_daily), 2) AS sqls_goal,
      ROUND(SUM(sqos_daily), 2) AS sqos_goal,
      ROUND(SUM(joined_daily), 2) AS joined_goal
    FROM \`${DAILY_FORECAST_VIEW}\`
    WHERE date_day BETWEEN @startDate AND @endDate
    GROUP BY channel_grouping_name
    HAVING SUM(sqls_daily) > 0 OR SUM(sqos_daily) > 0 OR SUM(joined_daily) > 0
    ORDER BY SUM(sqos_daily) DESC
  `;
  
  const params = { startDate, endDate };
  
  const results = await runQuery<RawChannelForecastResult>(query, params);
  
  return results.map(r => ({
    channel: toString(r.channel_grouping_name),
    prospects: toNumber(r.prospects_goal),
    mqls: toNumber(r.mqls_goal),
    sqls: toNumber(r.sqls_goal),
    sqos: toNumber(r.sqos_goal),
    joined: toNumber(r.joined_goal),
  }));
}

/**
 * Get forecast goals grouped by source (for Source Performance table)
 * Optionally filter by channel
 */
export async function getSourceForecastGoals(
  filters: DashboardFilters,
  channelFilter?: string | null
): Promise<SourceForecastGoals[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  if (!hasForecastData(startDate)) {
    return [];
  }
  
  // Build WHERE conditions
  const conditions = ['date_day BETWEEN @startDate AND @endDate'];
  const params: Record<string, string> = { startDate, endDate };
  
  if (channelFilter) {
    conditions.push('channel_grouping_name = @channelFilter');
    params.channelFilter = channelFilter;
  }
  
  const query = `
    SELECT
      original_source,
      channel_grouping_name,
      ROUND(SUM(prospects_daily), 2) AS prospects_goal,
      ROUND(SUM(mqls_daily), 2) AS mqls_goal,
      ROUND(SUM(sqls_daily), 2) AS sqls_goal,
      ROUND(SUM(sqos_daily), 2) AS sqos_goal,
      ROUND(SUM(joined_daily), 2) AS joined_goal
    FROM \`${DAILY_FORECAST_VIEW}\`
    WHERE ${conditions.join(' AND ')}
    GROUP BY original_source, channel_grouping_name
    HAVING SUM(sqls_daily) > 0 OR SUM(sqos_daily) > 0 OR SUM(joined_daily) > 0
    ORDER BY channel_grouping_name, SUM(sqos_daily) DESC
  `;
  
  const results = await runQuery<RawSourceForecastResult>(query, params);
  
  return results.map(r => ({
    source: toString(r.original_source),
    channel: toString(r.channel_grouping_name),
    prospects: toNumber(r.prospects_goal),
    mqls: toNumber(r.mqls_goal),
    sqls: toNumber(r.sqls_goal),
    sqos: toNumber(r.sqos_goal),
    joined: toNumber(r.joined_goal),
  }));
}
```

**✅ VERIFICATION GATE 2.1:**
```bash
npx tsc --noEmit
# Expected: No TypeScript errors
```

**BigQuery MCP Verification (run in Cursor with MCP):**
```sql
-- Verify aggregate goals for Q1 2026 QTD (Jan 1-11)
SELECT
  ROUND(SUM(prospects_daily), 2) AS prospects_goal,
  ROUND(SUM(mqls_daily), 2) AS mqls_goal,
  ROUND(SUM(sqls_daily), 2) AS sqls_goal,
  ROUND(SUM(sqos_daily), 2) AS sqos_goal,
  ROUND(SUM(joined_daily), 2) AS joined_goal
FROM `savvy-gtm-analytics.Tableau_Views.vw_daily_forecast`
WHERE date_day BETWEEN '2026-01-01' AND '2026-01-11';

-- Expected: sqos_goal should be ~13.82 (sum of all channels)
-- Outbound: 7.1, Partnerships: 2.48, Marketing: 1.77, Re-engagement: 1.77, etc.
```

---

## PHASE 3: API Routes

### Step 3.1: Update Funnel Metrics API Route

**Cursor.ai Prompt:**
```
Update src/app/api/dashboard/funnel-metrics/route.ts to include forecast goals in the response. Import getAggregateForecastGoals from forecast-goals.ts and call it alongside the existing getFunnelMetrics. Return the goals in the response. The response shape should be FunnelMetricsWithGoals (metrics + goals property).
```

**Update `src/app/api/dashboard/funnel-metrics/route.ts`:**

**Note:** This implementation uses `Promise.allSettled` to ensure goals failures don't break the dashboard. Goals are optional enhancements.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getFunnelMetrics } from '@/lib/queries/funnel-metrics';
import { getAggregateForecastGoals } from '@/lib/queries/forecast-goals';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters } from '@/types/filters';
import { buildDateRangeFromFilters } from '@/lib/utils/date-helpers';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const filters: DashboardFilters = await request.json();
    
    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user?.email || '');
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filters.sgm = permissions.sgmFilter;
    }
    
    // Fetch metrics and goals in parallel
    // Use allSettled so goals failure doesn't break the entire request
    const [metricsResult, goalsResult] = await Promise.allSettled([
      getFunnelMetrics(filters),
      getAggregateForecastGoals(filters).catch((error) => {
        // Log but don't fail - goals are optional
        console.error('Forecast goals query failed (non-critical):', error.message || error);
        return null;
      }),
    ]);
    
    // If metrics failed, throw error
    if (metricsResult.status === 'rejected') {
      throw metricsResult.reason;
    }
    
    const metrics = metricsResult.value;
    const goals = goalsResult.status === 'fulfilled' ? goalsResult.value : null;
    
    // Return combined response
    return NextResponse.json({
      ...metrics,
      goals,
    });
  } catch (error) {
    console.error('Funnel metrics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**✅ VERIFICATION GATE 3.1:**
```bash
npx tsc --noEmit
npm run build
# Expected: No errors
```

---

### Step 3.2: Update Source Performance API Route

**Cursor.ai Prompt:**
```
Update src/app/api/dashboard/source-performance/route.ts to include forecast goals. When groupBy is 'channel', call getChannelForecastGoals and merge goals into each channel. When groupBy is 'source', call getSourceForecastGoals and merge goals into each source. Create a helper function to merge performance data with goals by matching on channel or source name.
```

**Update `src/app/api/dashboard/source-performance/route.ts`:**

**Note:** This implementation uses `Promise.allSettled` for error resilience and matches sources by both source AND channel (composite key) since a source can appear in multiple channels.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getChannelPerformance, getSourcePerformance } from '@/lib/queries/source-performance';
import { getChannelForecastGoals, getSourceForecastGoals } from '@/lib/queries/forecast-goals';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters } from '@/types/filters';
import { 
  ChannelPerformance, 
  SourcePerformance,
  ChannelPerformanceWithGoals,
  SourcePerformanceWithGoals 
} from '@/types/dashboard';

// Helper to merge channel performance with goals
function mergeChannelGoals(
  channels: ChannelPerformance[],
  goals: { channel: string; prospects: number; mqls: number; sqls: number; sqos: number; joined: number }[]
): ChannelPerformanceWithGoals[] {
  const goalsMap = new Map(goals.map(g => [g.channel, g]));
  
  return channels.map(channel => ({
    ...channel,
    goals: goalsMap.get(channel.channel) || undefined,
  }));
}

// Helper to merge source performance with goals
function mergeSourceGoals(
  sources: SourcePerformance[],
  goals: { source: string; channel: string; prospects: number; mqls: number; sqls: number; sqos: number; joined: number }[]
): SourcePerformanceWithGoals[] {
  // Match on both source and channel since a source can appear in multiple channels
  const goalsMap = new Map(goals.map(g => [`${g.source}::${g.channel}`, g]));
  
  return sources.map(source => ({
    ...source,
    goals: goalsMap.get(`${source.source}::${source.channel}`) || undefined,
  }));
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const filters: DashboardFilters = body.filters;
    const groupBy: 'channel' | 'source' = body.groupBy || 'source';
    
    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user?.email || '');
    if (permissions.sgaFilter) {
      filters.sga = permissions.sgaFilter;
    }
    if (permissions.sgmFilter) {
      filters.sgm = permissions.sgmFilter;
    }
    
    if (groupBy === 'channel') {
      // Fetch channel performance and goals in parallel
      // Use allSettled so goals failure doesn't break the entire request
      const [channelsResult, channelGoalsResult] = await Promise.allSettled([
        getChannelPerformance(filters),
        getChannelForecastGoals(filters).catch((error) => {
          // Log but don't fail - goals are optional
          console.error('Channel forecast goals query failed (non-critical):', error.message || error);
          return [];
        }),
      ]);
      
      // If channels failed, throw error
      if (channelsResult.status === 'rejected') {
        throw channelsResult.reason;
      }
      
      const channels = channelsResult.value;
      const channelGoals = channelGoalsResult.status === 'fulfilled' ? channelGoalsResult.value : [];
      
      const channelsWithGoals = mergeChannelGoals(channels, channelGoals);
      
      return NextResponse.json({ channels: channelsWithGoals });
    } else {
      // Fetch source performance and goals in parallel
      // Pass channel filter to goals query if filtering by channel
      // Use allSettled so goals failure doesn't break the entire request
      const [sourcesResult, sourceGoalsResult] = await Promise.allSettled([
        getSourcePerformance(filters),
        getSourceForecastGoals(filters, filters.channel).catch((error) => {
          // Log but don't fail - goals are optional
          console.error('Source forecast goals query failed (non-critical):', error.message || error);
          return [];
        }),
      ]);
      
      // If sources failed, throw error
      if (sourcesResult.status === 'rejected') {
        throw sourcesResult.reason;
      }
      
      const sources = sourcesResult.value;
      const sourceGoals = sourceGoalsResult.status === 'fulfilled' ? sourceGoalsResult.value : [];
      
      const sourcesWithGoals = mergeSourceGoals(sources, sourceGoals);
      
      return NextResponse.json({ sources: sourcesWithGoals });
    }
  } catch (error) {
    console.error('Source performance error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**✅ VERIFICATION GATE 3.2:**
```bash
npx tsc --noEmit
npm run build
# Expected: No errors
```

---

## PHASE 4: API Client

### Step 4.1: Update API Client Types

**Cursor.ai Prompt:**
```
Update src/lib/api-client.ts to handle the new response types with goals. Update the getFunnelMetrics return type to FunnelMetricsWithGoals, getChannelPerformance to return ChannelPerformanceWithGoals[], and getSourcePerformance to return SourcePerformanceWithGoals[].
```

**Update `src/lib/api-client.ts`:**

Find these imports and update:
```typescript
import { 
  FunnelMetrics, 
  FunnelMetricsWithGoals,
  ConversionRates, 
  ConversionRatesResponse, 
  ChannelPerformance, 
  ChannelPerformanceWithGoals,
  SourcePerformance, 
  SourcePerformanceWithGoals,
  DetailRecord, 
  TrendDataPoint 
} from '@/types/dashboard';
```

Update the method signatures:
```typescript
export const dashboardApi = {
  getFilterOptions: () => apiFetch<FilterOptions>('/api/dashboard/filters'),

  // Updated to return FunnelMetricsWithGoals
  getFunnelMetrics: (filters: DashboardFilters) =>
    apiFetch<FunnelMetricsWithGoals>('/api/dashboard/funnel-metrics', {
      method: 'POST',
      body: JSON.stringify(filters),
    }),

  getConversionRates: (
    filters: DashboardFilters, 
    options?: { 
      includeTrends?: boolean; 
      granularity?: 'month' | 'quarter'; 
      mode?: 'period' | 'cohort';
    }
  ) =>
    apiFetch<{ 
      rates: ConversionRatesResponse; 
      trends: TrendDataPoint[] | null; 
      mode?: string;
    }>('/api/dashboard/conversion-rates', {
      method: 'POST',
      body: JSON.stringify({ 
        filters, 
        includeTrends: options?.includeTrends ?? false,
        granularity: options?.granularity ?? 'quarter',
        mode: options?.mode ?? 'period',
      }),
    }),

  // Updated to return ChannelPerformanceWithGoals[]
  getChannelPerformance: (filters: DashboardFilters) =>
    apiFetch<{ channels: ChannelPerformanceWithGoals[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters, groupBy: 'channel' }),
    }),

  // Updated to return SourcePerformanceWithGoals[]
  getSourcePerformance: (filters: DashboardFilters) =>
    apiFetch<{ sources: SourcePerformanceWithGoals[] }>('/api/dashboard/source-performance', {
      method: 'POST',
      body: JSON.stringify({ filters, groupBy: 'source' }),
    }),

  // ... rest of methods unchanged
};
```

**✅ VERIFICATION GATE 4.1:**
```bash
npx tsc --noEmit
# Expected: No TypeScript errors
```

---

## PHASE 5: Utility Functions

### Step 5.1: Create Goal Variance Helper

**Cursor.ai Prompt:**
```
Add a helper function to src/lib/utils/date-helpers.ts (or create a new file src/lib/utils/goal-helpers.ts) that calculates goal variance. The function should take actual and goal values, return the difference, percent variance, and whether on track. Also add a formatVariance function that formats the variance for display with + or - prefix.
```

**Create `src/lib/utils/goal-helpers.ts`:**
```typescript
// src/lib/utils/goal-helpers.ts
// Helper functions for goal variance calculations and formatting

import { GoalVariance } from '@/types/dashboard';

/**
 * Calculate variance between actual and goal values
 */
export function calculateVariance(actual: number, goal: number): GoalVariance {
  const difference = actual - goal;
  const percentVariance = goal > 0 ? (difference / goal) * 100 : 0;
  
  return {
    actual,
    goal,
    difference,
    percentVariance,
    isOnTrack: actual >= goal,
  };
}

/**
 * Format variance for display
 * Returns something like "+3 (+15.2%)" or "-2 (-10.5%)"
 */
export function formatVariance(variance: GoalVariance, decimalPlaces: number = 1): string {
  const diffSign = variance.difference >= 0 ? '+' : '';
  const pctSign = variance.percentVariance >= 0 ? '+' : '';
  
  const diffStr = `${diffSign}${variance.difference.toFixed(decimalPlaces)}`;
  const pctStr = `${pctSign}${variance.percentVariance.toFixed(1)}%`;
  
  return `${diffStr} (${pctStr})`;
}

/**
 * Format just the numeric difference with sign
 */
export function formatDifference(difference: number, decimalPlaces: number = 1): string {
  const sign = difference >= 0 ? '+' : '';
  return `${sign}${difference.toFixed(decimalPlaces)}`;
}

/**
 * Format just the percent variance with sign
 */
export function formatPercentVariance(percentVariance: number): string {
  const sign = percentVariance >= 0 ? '+' : '';
  return `${sign}${percentVariance.toFixed(1)}%`;
}

/**
 * Get color class based on whether on track
 * Returns Tailwind classes for text color
 */
export function getVarianceColorClass(isOnTrack: boolean): string {
  return isOnTrack 
    ? 'text-green-600 dark:text-green-400' 
    : 'text-red-600 dark:text-red-400';
}

/**
 * Get background color class based on whether on track
 * Returns Tailwind classes for background color (subtle)
 */
export function getVarianceBgClass(isOnTrack: boolean): string {
  return isOnTrack
    ? 'bg-green-50 dark:bg-green-900/20'
    : 'bg-red-50 dark:bg-red-900/20';
}

/**
 * Get Tremor Badge color based on whether on track
 */
export function getVarianceBadgeColor(isOnTrack: boolean): 'green' | 'red' {
  return isOnTrack ? 'green' : 'red';
}
```

**✅ VERIFICATION GATE 5.1:**
```bash
npx tsc --noEmit
# Expected: No TypeScript errors
```

---

## PHASE 6: Component Updates

### Step 6.1: Update Scorecards Component

**Cursor.ai Prompt:**
```
Update src/components/dashboard/Scorecards.tsx to display goal comparison for SQL and SQO cards. 

Requirements:
1. Accept FunnelMetricsWithGoals instead of FunnelMetrics
2. For SQL and SQO cards, if goals exist, show:
   - The goal value (e.g., "Goal: 7.1")
   - The variance as both number and percentage (e.g., "+2.9 (+40.8%)")
   - Color the variance green if on track, red if behind
3. Use the calculateVariance and formatDifference/formatPercentVariance helpers
4. Only show goal info if metrics.goals is not null
5. Keep the existing card styling and click functionality
```

**Update `src/components/dashboard/Scorecards.tsx`:**
```typescript
'use client';

import { Card, Metric, Text, Badge } from '@tremor/react';
import { FunnelMetricsWithGoals, ForecastGoals } from '@/types/dashboard';
import { formatCurrency, formatNumber } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference, 
  formatPercentVariance,
  getVarianceColorClass,
  getVarianceBadgeColor 
} from '@/lib/utils/goal-helpers';
import { TrendingUp, Users, DollarSign, Package } from 'lucide-react';

interface ScorecardsProps {
  metrics: FunnelMetricsWithGoals;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
}

// Sub-component for displaying goal variance
function GoalDisplay({ 
  actual, 
  goal, 
  label 
}: { 
  actual: number; 
  goal: number; 
  label: string;
}) {
  const variance = calculateVariance(actual, goal);
  const colorClass = getVarianceColorClass(variance.isOnTrack);
  
  return (
    <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 dark:text-gray-400">
          Goal: {goal.toFixed(1)}
        </span>
        <span className={`font-medium ${colorClass}`}>
          {formatDifference(variance.difference)} ({formatPercentVariance(variance.percentVariance)})
        </span>
      </div>
    </div>
  );
}

export function Scorecards({ metrics, selectedMetric, onMetricClick }: ScorecardsProps) {
  const isSelected = (id: string) => selectedMetric === id;
  const goals = metrics.goals;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {/* SQLs Card */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('sql') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('sql')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">SQLs</Text>
          <Users className="w-5 h-5 text-blue-500 dark:text-blue-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatNumber(metrics.sqls)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Sales Qualified Leads
        </Text>
        {goals && goals.sqls > 0 && (
          <GoalDisplay actual={metrics.sqls} goal={goals.sqls} label="SQL" />
        )}
      </Card>

      {/* SQOs Card */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('sqo') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('sqo')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">SQOs</Text>
          <TrendingUp className="w-5 h-5 text-green-500 dark:text-green-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatNumber(metrics.sqos)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Sales Qualified Opportunities
        </Text>
        {goals && goals.sqos > 0 && (
          <GoalDisplay actual={metrics.sqos} goal={goals.sqos} label="SQO" />
        )}
      </Card>

      {/* Joined Card */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('joined') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('joined')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">Joined</Text>
          <Package className="w-5 h-5 text-purple-500 dark:text-purple-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatNumber(metrics.joined)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Advisors Joined
        </Text>
        {goals && goals.joined > 0 && (
          <GoalDisplay actual={metrics.joined} goal={goals.joined} label="Joined" />
        )}
      </Card>

      {/* Open Pipeline Card - No goals */}
      <Card 
        className={`p-4 dark:bg-gray-800 dark:border-gray-700 ${
          onMetricClick 
            ? `cursor-pointer transition-all hover:bg-gray-50 dark:hover:bg-gray-700 ${
                isSelected('openPipeline') 
                  ? 'ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50 dark:bg-blue-900/30' 
                  : ''
              }` 
            : ''
        }`}
        onClick={() => onMetricClick?.('openPipeline')}
      >
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400">Open Pipeline</Text>
          <DollarSign className="w-5 h-5 text-amber-500 dark:text-amber-400" />
        </div>
        <Metric className="text-2xl font-bold text-gray-900 dark:text-white">
          {formatCurrency(metrics.openPipelineAum)}
        </Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Pipeline AUM
        </Text>
      </Card>
    </div>
  );
}
```

**✅ VERIFICATION GATE 6.1:**
```bash
npx tsc --noEmit
# Expected: No TypeScript errors
```

---

### Step 6.2: Update Channel Performance Table

**Cursor.ai Prompt:**
```
Update src/components/dashboard/ChannelPerformanceTable.tsx to display goals.

Requirements:
1. Accept ChannelPerformanceWithGoals[] instead of ChannelPerformance[]
2. Add new columns for goals: "SQLs Goal", "SQOs Goal", "Joined Goal"
3. If a channel has goals, display the goal value and variance inline or in separate columns
4. Color the variance indicators green (on track) or red (behind)
5. If no goals data exists for the date range, hide the goal columns entirely
6. Maintain existing click functionality and styling

Design option: Show goals as "Actual / Goal (Variance)" in the cell, e.g., "10 / 7.1 (+2.9)"
```

**Update `src/components/dashboard/ChannelPerformanceTable.tsx`:**
```typescript
'use client';

import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { ChannelPerformanceWithGoals } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference,
  getVarianceColorClass 
} from '@/lib/utils/goal-helpers';
import { ExportButton } from '@/components/ui/ExportButton';

interface ChannelPerformanceTableProps {
  channels: ChannelPerformanceWithGoals[];
  selectedChannel?: string | null;
  onChannelClick?: (channel: string | null) => void;
}

// Helper component for displaying metric with goal
function MetricWithGoal({ 
  actual, 
  goal 
}: { 
  actual: number; 
  goal?: number;
}) {
  if (!goal || goal === 0) {
    return <span>{formatNumber(actual)}</span>;
  }
  
  const variance = calculateVariance(actual, goal);
  const colorClass = getVarianceColorClass(variance.isOnTrack);
  
  return (
    <div className="flex flex-col items-end">
      <span className="font-medium">{formatNumber(actual)}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        / {goal.toFixed(1)}
      </span>
      <span className={`text-xs font-medium ${colorClass}`}>
        {formatDifference(variance.difference)}
      </span>
    </div>
  );
}

export function ChannelPerformanceTable({ 
  channels, 
  selectedChannel, 
  onChannelClick 
}: ChannelPerformanceTableProps) {
  // Check if any channel has goals to determine if we show goal info
  const hasGoals = channels.some(c => c.goals && (c.goals.sqls > 0 || c.goals.sqos > 0));
  
  // Prepare data for CSV export
  const exportData = channels.map(channel => ({
    Channel: channel.channel,
    SQLs: channel.sqls,
    'SQLs Goal': channel.goals?.sqls ?? '',
    SQOs: channel.sqos,
    'SQOs Goal': channel.goals?.sqos ?? '',
    'SQL→SQO Rate': (channel.sqlToSqoRate * 100).toFixed(2) + '%',
    Joined: channel.joined,
    'Joined Goal': channel.goals?.joined ?? '',
    'SQO→Joined Rate': (channel.sqoToJoinedRate * 100).toFixed(2) + '%',
    AUM: channel.aum,
  }));

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Channel Performance
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Click a row to filter by channel
            {hasGoals && ' • Goals shown below actuals'}
          </p>
        </div>
        <ExportButton data={exportData} filename="channel-performance" />
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Channel
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQLs{hasGoals && ' / Goal'}
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQOs{hasGoals && ' / Goal'}
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQL→SQO
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Joined{hasGoals && ' / Goal'}
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQO→Joined
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-gray-600 dark:text-gray-400">
                AUM
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {channels.map((channel, idx) => {
              const isSelected = selectedChannel === channel.channel;
              const zebraClass = idx % 2 === 0 
                ? 'bg-white dark:bg-gray-800' 
                : 'bg-gray-50 dark:bg-gray-900';
              
              return (
                <TableRow
                  key={channel.channel}
                  className={`
                    cursor-pointer transition-colors
                    ${isSelected 
                      ? 'bg-blue-50 dark:bg-blue-900/30' 
                      : `${zebraClass} hover:bg-gray-100 dark:hover:bg-gray-700`
                    }
                  `}
                  onClick={() => onChannelClick?.(
                    isSelected ? null : channel.channel
                  )}
                >
                  <TableCell className="border-r border-gray-100 dark:border-gray-800">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {channel.channel}
                    </span>
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={channel.sqls} goal={channel.goals?.sqls} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={channel.sqos} goal={channel.goals?.sqos} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge 
                      size="sm" 
                      color={channel.sqlToSqoRate >= 0.5 ? 'green' : channel.sqlToSqoRate >= 0.3 ? 'yellow' : 'red'}
                    >
                      {formatPercent(channel.sqlToSqoRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={channel.joined} goal={channel.goals?.joined} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge 
                      size="sm" 
                      color={channel.sqoToJoinedRate >= 0.15 ? 'green' : channel.sqoToJoinedRate >= 0.08 ? 'yellow' : 'red'}
                    >
                      {formatPercent(channel.sqoToJoinedRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-gray-900 dark:text-white">
                    {formatCurrency(channel.aum)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {channels.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No channel data available
        </div>
      )}
    </Card>
  );
}
```

**✅ VERIFICATION GATE 6.2:**
```bash
npx tsc --noEmit
# Expected: No TypeScript errors
```

---

### Step 6.3: Update Source Performance Table

**Cursor.ai Prompt:**
```
Update src/components/dashboard/SourcePerformanceTable.tsx similar to Channel Performance.

Requirements:
1. Accept SourcePerformanceWithGoals[] instead of SourcePerformance[]
2. Display goals inline with actuals using the same MetricWithGoal pattern
3. Show goals for SQLs, SQOs, and Joined columns
4. Color variance indicators appropriately
5. Hide goal info if no goals exist for the date range
6. Maintain existing filtering and styling
```

**Update `src/components/dashboard/SourcePerformanceTable.tsx`:**
```typescript
'use client';

import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { SourcePerformanceWithGoals } from '@/types/dashboard';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/utils/date-helpers';
import { 
  calculateVariance, 
  formatDifference,
  getVarianceColorClass 
} from '@/lib/utils/goal-helpers';
import { ExportButton } from '@/components/ui/ExportButton';

interface SourcePerformanceTableProps {
  sources: SourcePerformanceWithGoals[];
  selectedSource?: string | null;
  onSourceClick?: (source: string | null) => void;
  channelFilter?: string | null;
}

// Helper component for displaying metric with goal
function MetricWithGoal({ 
  actual, 
  goal 
}: { 
  actual: number; 
  goal?: number;
}) {
  if (!goal || goal === 0) {
    return <span>{formatNumber(actual)}</span>;
  }
  
  const variance = calculateVariance(actual, goal);
  const colorClass = getVarianceColorClass(variance.isOnTrack);
  
  return (
    <div className="flex flex-col items-end">
      <span className="font-medium">{formatNumber(actual)}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        / {goal.toFixed(1)}
      </span>
      <span className={`text-xs font-medium ${colorClass}`}>
        {formatDifference(variance.difference)}
      </span>
    </div>
  );
}

export function SourcePerformanceTable({ 
  sources, 
  selectedSource, 
  onSourceClick, 
  channelFilter 
}: SourcePerformanceTableProps) {
  const filteredSources = channelFilter 
    ? sources.filter(s => s.channel === channelFilter)
    : sources;
  
  // Check if any source has goals
  const hasGoals = filteredSources.some(s => s.goals && (s.goals.sqls > 0 || s.goals.sqos > 0));
  
  // Prepare data for CSV export
  const exportData = filteredSources.map(source => ({
    Source: source.source,
    Channel: source.channel,
    Prospects: source.prospects,
    Contacted: source.contacted,
    MQLs: source.mqls,
    SQLs: source.sqls,
    'SQLs Goal': source.goals?.sqls ?? '',
    SQOs: source.sqos,
    'SQOs Goal': source.goals?.sqos ?? '',
    Joined: source.joined,
    'Joined Goal': source.goals?.joined ?? '',
    'MQL→SQL Rate': (source.mqlToSqlRate * 100).toFixed(2) + '%',
    'SQL→SQO Rate': (source.sqlToSqoRate * 100).toFixed(2) + '%',
    'SQO→Joined Rate': (source.sqoToJoinedRate * 100).toFixed(2) + '%',
    AUM: source.aum,
  }));

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Source Performance
            {channelFilter && (
              <span className="ml-2 text-sm font-normal text-gray-500 dark:text-gray-400">
                (Filtered by: {channelFilter})
              </span>
            )}
          </h3>
          {hasGoals && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Goals shown below actuals
            </p>
          )}
        </div>
        <ExportButton data={exportData} filename="source-performance" />
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Source
              </TableHeaderCell>
              <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Channel
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                MQLs
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQLs{hasGoals && ' / Goal'}
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQOs{hasGoals && ' / Goal'}
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQL→SQO
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                Joined{hasGoals && ' / Goal'}
              </TableHeaderCell>
              <TableHeaderCell className="text-right border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                SQO→Joined
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-gray-600 dark:text-gray-400">
                AUM
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredSources.map((source, idx) => {
              const isSelected = selectedSource === source.source;
              const zebraClass = idx % 2 === 0 
                ? 'bg-white dark:bg-gray-800' 
                : 'bg-gray-50 dark:bg-gray-900';
              
              return (
                <TableRow
                  key={source.source}
                  className={`
                    cursor-pointer transition-colors
                    ${isSelected 
                      ? 'bg-blue-50 dark:bg-blue-900/30' 
                      : `${zebraClass} hover:bg-gray-100 dark:hover:bg-gray-700`
                    }
                  `}
                  onClick={() => onSourceClick?.(
                    isSelected ? null : source.source
                  )}
                >
                  <TableCell className="border-r border-gray-100 dark:border-gray-800">
                    <span className="font-medium text-gray-900 dark:text-white">
                      {source.source}
                    </span>
                  </TableCell>
                  <TableCell className="border-r border-gray-100 dark:border-gray-800 text-gray-600 dark:text-gray-400">
                    {source.channel}
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    {formatNumber(source.mqls)}
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={source.sqls} goal={source.goals?.sqls} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={source.sqos} goal={source.goals?.sqos} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge 
                      size="sm" 
                      color={source.sqlToSqoRate >= 0.5 ? 'green' : source.sqlToSqoRate >= 0.3 ? 'yellow' : 'red'}
                    >
                      {formatPercent(source.sqlToSqoRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <MetricWithGoal actual={source.joined} goal={source.goals?.joined} />
                  </TableCell>
                  <TableCell className="text-right border-r border-gray-100 dark:border-gray-800">
                    <Badge 
                      size="sm" 
                      color={source.sqoToJoinedRate >= 0.15 ? 'green' : source.sqoToJoinedRate >= 0.08 ? 'yellow' : 'red'}
                    >
                      {formatPercent(source.sqoToJoinedRate)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-gray-900 dark:text-white">
                    {formatCurrency(source.aum)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      
      {filteredSources.length === 0 && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No source data available
        </div>
      )}
    </Card>
  );
}
```

**✅ VERIFICATION GATE 6.3:**
```bash
npx tsc --noEmit
# Expected: No TypeScript errors
```

---

## PHASE 7: Dashboard Page Integration

### Step 7.1: Update Dashboard Page State Types

**Cursor.ai Prompt:**
```
Update src/app/dashboard/page.tsx to use the new types with goals.

Requirements:
1. Update metrics state type from FunnelMetrics to FunnelMetricsWithGoals
2. Update channels state type from ChannelPerformance[] to ChannelPerformanceWithGoals[]
3. Update sources state type from SourcePerformance[] to SourcePerformanceWithGoals[]
4. The API responses already include goals, so no fetch logic changes needed
5. Pass the updated data to components - they handle the goal display
```

**Update imports in `src/app/dashboard/page.tsx`:**
```typescript
import { 
  FunnelMetricsWithGoals,  // Changed from FunnelMetrics
  ConversionRatesResponse, 
  ChannelPerformanceWithGoals,  // Changed from ChannelPerformance
  SourcePerformanceWithGoals,   // Changed from SourcePerformance
  DetailRecord, 
  TrendDataPoint, 
  ConversionTrendMode 
} from '@/types/dashboard';
```

**Update state declarations:**
```typescript
// Data state - update these three types
const [metrics, setMetrics] = useState<FunnelMetricsWithGoals | null>(null);
const [channels, setChannels] = useState<ChannelPerformanceWithGoals[]>([]);
const [sources, setSources] = useState<SourcePerformanceWithGoals[]>([]);
```

**✅ VERIFICATION GATE 7.1:**
```bash
npx tsc --noEmit
npm run build
# Expected: No errors
```

---

## PHASE 8: Final Verification

### Step 8.1: TypeScript and Lint Check

**Cursor.ai Prompt:**
```
Run full TypeScript check and ESLint to ensure no errors or warnings were introduced.
```

```bash
# Full type check
npx tsc --noEmit

# Lint check
npm run lint

# Build test
npm run build
```

**✅ VERIFICATION GATE 8.1:**
- [ ] No TypeScript errors
- [ ] No ESLint errors or warnings
- [ ] Build completes successfully

---

### Step 8.2: Data Verification via BigQuery MCP

**Cursor.ai Prompt:**
```
Use BigQuery MCP to verify the forecast goals are calculating correctly for Q1 2026 QTD (Jan 1-11, 2026).
```

**Run these verification queries:**

```sql
-- Query 1: Verify aggregate goals match expected
SELECT
  ROUND(SUM(sqls_daily), 2) AS sqls_goal,
  ROUND(SUM(sqos_daily), 2) AS sqos_goal,
  ROUND(SUM(joined_daily), 2) AS joined_goal
FROM `savvy-gtm-analytics.Tableau_Views.vw_daily_forecast`
WHERE date_day BETWEEN '2026-01-01' AND '2026-01-11';

-- Expected: sqls ~21.93, sqos ~13.82, joined ~0
```

```sql
-- Query 2: Verify Outbound channel goals
SELECT
  channel_grouping_name,
  ROUND(SUM(sqos_daily), 2) AS sqos_goal
FROM `savvy-gtm-analytics.Tableau_Views.vw_daily_forecast`
WHERE date_day BETWEEN '2026-01-01' AND '2026-01-11'
  AND channel_grouping_name = 'Outbound'
GROUP BY channel_grouping_name;

-- Expected: sqos_goal = 7.1
```

```sql
-- Query 3: Verify Advisor Waitlist source goals
SELECT
  original_source,
  ROUND(SUM(sqos_daily), 2) AS sqos_goal
FROM `savvy-gtm-analytics.Tableau_Views.vw_daily_forecast`
WHERE date_day BETWEEN '2026-01-01' AND '2026-01-11'
  AND original_source = 'Advisor Waitlist'
GROUP BY original_source;

-- Expected: sqos_goal = 1.42
```

**✅ VERIFICATION GATE 8.2:**
- [ ] Aggregate goals match expected values
- [ ] Channel goals match verification data
- [ ] Source goals match verification data

---

### Step 8.3: Runtime Testing

**Cursor.ai Prompt:**
```
Start the development server and manually test the forecast goals integration.
```

```bash
npm run dev
```

**Test Checklist:**

1. **Scorecards (Q1 2026 QTD - Jan 1-11)**
   - [ ] SQLs card shows goal and variance
   - [ ] SQOs card shows goal (~13.82) and variance
   - [ ] Joined card shows goal if > 0
   - [ ] Open Pipeline card has no goal (expected)
   - [ ] Green color for on-track, red for behind

2. **Channel Performance Table (Q1 2026 QTD)**
   - [ ] Goals appear below actuals in SQLs, SQOs, Joined columns
   - [ ] Outbound shows ~7.1 SQO goal
   - [ ] Marketing shows ~1.77 SQO goal
   - [ ] Variance is colored correctly

3. **Source Performance Table (Q1 2026 QTD)**
   - [ ] Goals appear for each source
   - [ ] Advisor Waitlist shows ~1.42 SQO goal
   - [ ] LinkedIn (Self Sourced) shows ~3.9 SQO goal
   - [ ] Filtering by channel still shows correct goals

4. **No Goals Period (Q2 2025)**
   - [ ] Select Q2 2025 from filters
   - [ ] Scorecards should NOT show goal section
   - [ ] Tables should NOT show goal columns/info
   - [ ] No errors in console

**✅ VERIFICATION GATE 8.3 (Final):**
- [ ] All runtime tests pass
- [ ] No console errors
- [ ] Goals display correctly for periods with data
- [ ] Goals hide gracefully for periods without data
- [ ] Variance colors are correct (green/red)

---

## Summary of Files Changed

| File | Change Type | Description |
|------|-------------|-------------|
| `src/config/constants.ts` | Modified | Added DAILY_FORECAST_VIEW constant |
| `src/types/bigquery-raw.ts` | Modified | Added forecast result interfaces |
| `src/types/dashboard.ts` | Modified | Added ForecastGoals, WithGoals types, GoalVariance |
| `src/lib/queries/forecast-goals.ts` | **New** | Query functions for forecast goals |
| `src/lib/utils/goal-helpers.ts` | **New** | Variance calculation helpers |
| `src/lib/bigquery.ts` | Modified | Added Drive API scopes for external table access |
| `src/app/api/dashboard/funnel-metrics/route.ts` | Modified | Added goals to response with error handling |
| `src/app/api/dashboard/source-performance/route.ts` | Modified | Added goals to channel/source responses with error handling |
| `src/lib/api-client.ts` | Modified | Updated return types |
| `src/components/dashboard/Scorecards.tsx` | Modified | Display goals on SQL/SQO cards |
| `src/components/dashboard/ChannelPerformanceTable.tsx` | Modified | Display goals in table |
| `src/components/dashboard/SourcePerformanceTable.tsx` | Modified | Display goals in table |
| `src/lib/bigquery.ts` | Modified | Added Drive API scopes for external table access |
| `src/app/dashboard/page.tsx` | Modified | Updated state types |

---

## Implementation Notes

### Error Handling

The implementation uses `Promise.allSettled` in API routes to ensure that forecast goals query failures don't break the dashboard. Goals are treated as optional enhancements - if they fail to load, the dashboard still functions normally with all other data.

### Debug Logging

Debug logging was added to `forecast-goals.ts` and API routes during implementation. These can be removed in production if desired, or kept for troubleshooting. Look for `console.log('[Forecast Goals]...` and `console.log('[Funnel Metrics API]...` statements.

### BigQuery Drive Access

If `vw_daily_forecast` references a Google Drive file (external table), ensure:
1. Google Drive API is enabled in GCP project
2. Service account has Viewer access to the Drive file
3. BigQuery client includes `drive.readonly` scope (see Phase 0)

### Source Goals Matching

Source goals are matched using a composite key (`source::channel`) because the same source can appear in multiple channels. This ensures accurate goal assignment.

---

## Rollback Plan

If issues arise, revert changes in this order:
1. Revert dashboard page state types
2. Revert component changes
3. Revert API routes
4. Remove new files (forecast-goals.ts, goal-helpers.ts)
5. Revert type changes

The BigQuery view can remain as it doesn't affect existing functionality.

---

## Implementation Notes

### Error Handling

The implementation uses `Promise.allSettled` in API routes to ensure that forecast goals query failures don't break the dashboard. Goals are treated as optional enhancements - if they fail to load, the dashboard still functions normally with all other data.

### Debug Logging

Debug logging was added to `forecast-goals.ts` and API routes during implementation. These can be removed in production if desired, or kept for troubleshooting. Look for `console.log('[Forecast Goals]...` and `console.log('[Funnel Metrics API]...` statements.

### BigQuery Drive Access

If `vw_daily_forecast` references a Google Drive file (external table), ensure:
1. Google Drive API is enabled in GCP project
2. Service account has Viewer access to the Drive file
3. BigQuery client includes `drive.readonly` scope (see Phase 0)

### Source Goals Matching

Source goals are matched using a composite key (`source::channel`) because the same source can appear in multiple channels. This ensures accurate goal assignment.
