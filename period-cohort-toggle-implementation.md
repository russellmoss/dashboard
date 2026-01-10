# Feature Implementation: Period vs Cohort Toggle for Conversion Trends Chart

## Overview

This feature adds a toggle to the Conversion Trends Chart allowing users to switch between:
- **Period View**: "What happened this quarter?" (activity-based)
- **Cohort View**: "How well do leads from this quarter convert?" (efficiency-based)

## Prerequisites

Complete the conversion trends chart bug fix first (cursor-ai-fix-instructions.md).

---

## Step 1: Update Types

### File: `src/types/dashboard.ts`

Add the new mode type and update TrendDataPoint:

```typescript
// Add this new type
export type ConversionTrendMode = 'period' | 'cohort';

// Update or verify TrendDataPoint exists (should already exist)
export interface TrendDataPoint {
  period: string;
  sqls: number;
  sqos: number;
  joined: number;
  contactedToMqlRate: number;
  mqlToSqlRate: number;
  sqlToSqoRate: number;
  sqoToJoinedRate: number;
}
```

---

## Step 2: Update the Query Function

### File: `src/lib/queries/conversion-rates.ts`

Replace the `getConversionTrends` function with this version that supports both modes:

```typescript
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * getConversionTrends - DUAL MODE VERSION
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This function calculates conversion rates and volumes per period (month/quarter)
 * for the trend chart visualization. Supports two modes:
 * 
 * PERIOD MODE (default):
 * ----------------------
 * Answers: "What happened in this period?"
 * - Numerators and denominators are grouped by their respective date fields
 * - SQL→SQO = (SQOs created in period) / (SQLs created in period)
 * - Can result in rates > 100% if converting old leads
 * - Best for: Activity tracking, sales performance, executive dashboards
 * 
 * COHORT MODE:
 * ------------
 * Answers: "How well do leads from this period convert?"
 * - Tracks each cohort through the funnel
 * - SQL→SQO = (Q4 SQLs that became SQO) / (Q4 SQLs)
 * - Rates are always 0-100%
 * - Best for: Funnel efficiency, forecasting, process improvement
 * - Note: Recent periods show lower rates (conversions still in progress)
 * 
 * DATE FIELD MAPPING:
 * -------------------
 * | Conversion     | Period Mode Numer     | Period Mode Denom           | Cohort Mode (both)          |
 * |----------------|----------------------|-----------------------------|-----------------------------|
 * | Contacted→MQL  | stage_entered_contacting__c | stage_entered_contacting__c | stage_entered_contacting__c |
 * | MQL→SQL        | converted_date_raw   | stage_entered_contacting__c | stage_entered_contacting__c |
 * | SQL→SQO        | Date_Became_SQO__c   | converted_date_raw          | converted_date_raw          |
 * | SQO→Joined     | advisor_join_date__c | Date_Became_SQO__c          | Date_Became_SQO__c          |
 * 
 * @param filters - Dashboard filters (channel, source, SGA, SGM, date range)
 * @param granularity - 'month' or 'quarter' for period grouping
 * @param mode - 'period' (default) or 'cohort' for calculation mode
 * @returns Array of TrendDataPoint objects, one per period
 */
export async function getConversionTrends(
  filters: DashboardFilters,
  granularity: 'month' | 'quarter' = 'month',
  mode: 'period' | 'cohort' = 'period'
): Promise<TrendDataPoint[]> {
  // ═══════════════════════════════════════════════════════════════════════════
  // DATE RANGE SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  const { startDate } = buildDateRangeFromFilters(filters);
  const selectedYear = new Date(startDate).getFullYear();
  const trendStartDate = `${selectedYear}-01-01`;
  const trendEndDate = `${selectedYear}-12-31 23:59:59`;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD FILTER CONDITIONS
  // ═══════════════════════════════════════════════════════════════════════════
  const conditions: string[] = [];
  const params: Record<string, any> = {
    trendStartDate,
    trendEndDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  if (filters.channel) {
    conditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') = @channel');
    params.channel = filters.channel;
  }
  if (filters.source) {
    conditions.push('v.Original_source = @source');
    params.source = filters.source;
  }
  if (filters.sga) {
    conditions.push('v.SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }
  if (filters.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }
  
  const filterWhereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PERIOD FORMAT FUNCTION
  // ═══════════════════════════════════════════════════════════════════════════
  const periodFormat = granularity === 'month' 
    ? `FORMAT_DATE('%Y-%m', DATE(DATE_FIELD))`
    : `CONCAT(CAST(EXTRACT(YEAR FROM DATE_FIELD) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM DATE_FIELD) AS STRING))`;
  
  const periodFn = (dateField: string) => periodFormat.replace(/DATE_FIELD/g, dateField);

  // ═══════════════════════════════════════════════════════════════════════════
  // SELECT QUERY BASED ON MODE
  // ═══════════════════════════════════════════════════════════════════════════
  const query = mode === 'cohort' 
    ? buildCohortQuery(periodFn, filterWhereClause)
    : buildPeriodQuery(periodFn, filterWhereClause);
  
  console.log(`[getConversionTrends] Executing ${mode} mode query for ${granularity} granularity`);
  
  const results = await runQuery<RawConversionTrendResult>(query, params);
  
  console.log(`[getConversionTrends] Returned ${results.length} periods`);
  
  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;
  
  return results.map(r => ({
    period: r.period,
    sqls: toNumber(r.sqls),
    sqos: toNumber(r.sqos),
    joined: toNumber(r.joined),
    contactedToMqlRate: safeDiv(toNumber(r.contacted_to_mql_numer), toNumber(r.contacted_to_mql_denom)),
    mqlToSqlRate: safeDiv(toNumber(r.mql_to_sql_numer), toNumber(r.mql_to_sql_denom)),
    sqlToSqoRate: safeDiv(toNumber(r.sql_to_sqo_numer), toNumber(r.sql_to_sqo_denom)),
    sqoToJoinedRate: safeDiv(toNumber(r.sqo_to_joined_numer), toNumber(r.sqo_to_joined_denom)),
  }));
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PERIOD MODE QUERY
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Groups numerators and denominators by their respective date fields.
 * This shows "what happened in each period" regardless of when leads entered.
 * 
 * Example: An SQL from July that becomes SQO in December counts toward Q4 SQO numbers.
 */
function buildPeriodQuery(periodFn: (field: string) => string, filterWhereClause: string): string {
  return `
    -- ═══════════════════════════════════════════════════════════════════════════
    -- PERIOD MODE: Activity-based conversion tracking
    -- Each metric grouped by its own date field
    -- ═══════════════════════════════════════════════════════════════════════════
    
    WITH contacted_to_mql AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        COUNTIF(v.is_mql = 1) as contacted_to_mql_numer,
        COUNT(*) as contacted_to_mql_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    mql_to_sql_numer AS (
      SELECT
        ${periodFn('v.converted_date_raw')} as period,
        COUNTIF(v.is_sql = 1) as mql_to_sql_numer,
        COUNTIF(v.is_sql = 1) as sqls
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    mql_to_sql_denom AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        COUNTIF(v.is_mql = 1) as mql_to_sql_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    sql_to_sqo_numer AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
        ) as sql_to_sqo_numer,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
        ) as sqos
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    sql_to_sqo_denom AS (
      SELECT
        ${periodFn('v.converted_date_raw')} as period,
        COUNTIF(v.is_sql = 1) as sql_to_sqo_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    sqo_to_joined_numer AS (
      SELECT
        ${periodFn('v.advisor_join_date__c')} as period,
        COUNTIF(v.is_joined_unique = 1) as sqo_to_joined_numer,
        COUNTIF(v.is_joined_unique = 1) as joined
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.advisor_join_date__c IS NOT NULL
        AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    sqo_to_joined_denom AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND LOWER(v.SQO_raw) = 'yes'
        ) as sqo_to_joined_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    all_periods AS (
      SELECT DISTINCT period FROM contacted_to_mql
      UNION DISTINCT SELECT DISTINCT period FROM mql_to_sql_numer
      UNION DISTINCT SELECT DISTINCT period FROM mql_to_sql_denom
      UNION DISTINCT SELECT DISTINCT period FROM sql_to_sqo_numer
      UNION DISTINCT SELECT DISTINCT period FROM sql_to_sqo_denom
      UNION DISTINCT SELECT DISTINCT period FROM sqo_to_joined_numer
      UNION DISTINCT SELECT DISTINCT period FROM sqo_to_joined_denom
    )
    
    SELECT
      ap.period,
      COALESCE(msn.sqls, 0) as sqls,
      COALESCE(ssn.sqos, 0) as sqos,
      COALESCE(sjn.joined, 0) as joined,
      COALESCE(ctm.contacted_to_mql_numer, 0) as contacted_to_mql_numer,
      COALESCE(ctm.contacted_to_mql_denom, 0) as contacted_to_mql_denom,
      COALESCE(msn.mql_to_sql_numer, 0) as mql_to_sql_numer,
      COALESCE(msd.mql_to_sql_denom, 0) as mql_to_sql_denom,
      COALESCE(ssn.sql_to_sqo_numer, 0) as sql_to_sqo_numer,
      COALESCE(ssd.sql_to_sqo_denom, 0) as sql_to_sqo_denom,
      COALESCE(sjn.sqo_to_joined_numer, 0) as sqo_to_joined_numer,
      COALESCE(sjd.sqo_to_joined_denom, 0) as sqo_to_joined_denom
    FROM all_periods ap
    LEFT JOIN contacted_to_mql ctm ON ap.period = ctm.period
    LEFT JOIN mql_to_sql_numer msn ON ap.period = msn.period
    LEFT JOIN mql_to_sql_denom msd ON ap.period = msd.period
    LEFT JOIN sql_to_sqo_numer ssn ON ap.period = ssn.period
    LEFT JOIN sql_to_sqo_denom ssd ON ap.period = ssd.period
    LEFT JOIN sqo_to_joined_numer sjn ON ap.period = sjn.period
    LEFT JOIN sqo_to_joined_denom sjd ON ap.period = sjd.period
    ORDER BY ap.period
  `;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * COHORT MODE QUERY
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Tracks each cohort through the funnel. All metrics for a conversion are grouped
 * by when the lead entered that stage (the denominator date).
 * 
 * Example: An SQL from July that becomes SQO in December counts toward Q3 
 * (because they became SQL in Q3).
 * 
 * IMPORTANT: Recent periods will show lower rates because conversions are still
 * in progress. A Q4 2025 SQL might not become SQO until Q1 2026.
 */
function buildCohortQuery(periodFn: (field: string) => string, filterWhereClause: string): string {
  return `
    -- ═══════════════════════════════════════════════════════════════════════════
    -- COHORT MODE: Track each cohort through the funnel
    -- All metrics grouped by when they entered that stage
    -- ═══════════════════════════════════════════════════════════════════════════
    
    -- Contacted→MQL: Cohort by when they were contacted
    -- (Same as period mode - both use stage_entered_contacting__c)
    WITH contacted_cohort AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        COUNT(*) as contacted,
        COUNTIF(v.is_mql = 1) as became_mql
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- MQL→SQL: Cohort by when they became MQL (stage_entered_contacting__c)
    -- Track how many of those MQLs eventually converted to SQL
    mql_cohort AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        COUNTIF(v.is_mql = 1) as mqls,
        COUNTIF(v.is_mql = 1 AND v.is_sql = 1) as became_sql
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- SQL→SQO: Cohort by when they became SQL (converted_date_raw)
    -- Track how many of those SQLs eventually became SQO
    sql_cohort AS (
      SELECT
        ${periodFn('v.converted_date_raw')} as period,
        COUNTIF(v.is_sql = 1) as sqls,
        COUNTIF(
          v.is_sql = 1 
          AND v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
        ) as became_sqo
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- SQO→Joined: Cohort by when they became SQO (Date_Became_SQO__c)
    -- Track how many of those SQOs eventually joined
    sqo_cohort AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND LOWER(v.SQO_raw) = 'yes'
        ) as sqos,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND LOWER(v.SQO_raw) = 'yes'
          AND v.is_joined_unique = 1
        ) as became_joined
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    all_periods AS (
      SELECT DISTINCT period FROM contacted_cohort
      UNION DISTINCT SELECT DISTINCT period FROM mql_cohort
      UNION DISTINCT SELECT DISTINCT period FROM sql_cohort
      UNION DISTINCT SELECT DISTINCT period FROM sqo_cohort
    )
    
    SELECT
      ap.period,
      
      -- Volumes: Show the cohort sizes (how many entered each stage in this period)
      COALESCE(mc.mqls, 0) as sqls,  -- Note: Using MQL cohort's SQL count for volume display
      COALESCE(sc.sqls, 0) as sqls,  -- Override with actual SQL cohort count
      COALESCE(sqc.sqos, 0) as sqos,
      COALESCE(sqc.became_joined, 0) as joined,
      
      -- Contacted→MQL (same as period mode)
      COALESCE(cc.became_mql, 0) as contacted_to_mql_numer,
      COALESCE(cc.contacted, 0) as contacted_to_mql_denom,
      
      -- MQL→SQL: Of MQLs from this period, how many became SQL?
      COALESCE(mc.became_sql, 0) as mql_to_sql_numer,
      COALESCE(mc.mqls, 0) as mql_to_sql_denom,
      
      -- SQL→SQO: Of SQLs from this period, how many became SQO?
      COALESCE(sc.became_sqo, 0) as sql_to_sqo_numer,
      COALESCE(sc.sqls, 0) as sql_to_sqo_denom,
      
      -- SQO→Joined: Of SQOs from this period, how many joined?
      COALESCE(sqc.became_joined, 0) as sqo_to_joined_numer,
      COALESCE(sqc.sqos, 0) as sqo_to_joined_denom
      
    FROM all_periods ap
    LEFT JOIN contacted_cohort cc ON ap.period = cc.period
    LEFT JOIN mql_cohort mc ON ap.period = mc.period
    LEFT JOIN sql_cohort sc ON ap.period = sc.period
    LEFT JOIN sqo_cohort sqc ON ap.period = sqc.period
    ORDER BY ap.period
  `;
}
```

---

## Step 3: Update API Route

### File: `src/app/api/dashboard/conversion-rates/route.ts`

Update to accept the mode parameter:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getConversionRates, getConversionTrends } from '@/lib/queries/conversion-rates';
import { getUserPermissions } from '@/lib/permissions';
import { DashboardFilters, ConversionTrendMode } from '@/types/dashboard';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    
    // Parse filters from query params
    const filters: DashboardFilters = {
      channel: searchParams.get('channel') || undefined,
      source: searchParams.get('source') || undefined,
      sga: searchParams.get('sga') || undefined,
      sgm: searchParams.get('sgm') || undefined,
      datePreset: searchParams.get('datePreset') || undefined,
      startDate: searchParams.get('startDate') || undefined,
      endDate: searchParams.get('endDate') || undefined,
    };

    // Apply permission-based filters
    const permissions = await getUserPermissions(session.user.email);
    // ... existing permission logic ...

    const includeTrends = searchParams.get('includeTrends') === 'true';
    const granularity = (searchParams.get('granularity') || 'quarter') as 'month' | 'quarter';
    
    // NEW: Get the mode parameter (defaults to 'period')
    const mode = (searchParams.get('mode') || 'period') as ConversionTrendMode;

    // Get scorecard data (always uses period logic)
    const rates = await getConversionRates(filters);

    // Get trend data if requested
    let trends = null;
    if (includeTrends) {
      try {
        // Pass the mode parameter to getConversionTrends
        trends = await getConversionTrends(filters, granularity, mode);
        console.log(`[Conversion Rates API] Returned ${trends?.length || 0} trend points (${mode} mode)`);
      } catch (trendError) {
        console.error('Conversion trends error:', trendError);
        trends = [];
      }
    }

    return NextResponse.json({
      rates,
      trends,
      mode, // Return the mode so the UI knows what it's displaying
    });
  } catch (error) {
    console.error('Conversion rates error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch conversion rates' },
      { status: 500 }
    );
  }
}
```

---

## Step 4: Update API Client

### File: `src/lib/api-client.ts`

Update the fetchConversionRates function:

```typescript
export interface ConversionRatesParams {
  filters: DashboardFilters;
  includeTrends?: boolean;
  granularity?: 'month' | 'quarter';
  mode?: 'period' | 'cohort';  // NEW
}

export async function fetchConversionRates({
  filters,
  includeTrends = false,
  granularity = 'quarter',
  mode = 'period',  // NEW - defaults to period
}: ConversionRatesParams) {
  const params = new URLSearchParams();
  
  if (filters.channel) params.set('channel', filters.channel);
  if (filters.source) params.set('source', filters.source);
  if (filters.sga) params.set('sga', filters.sga);
  if (filters.sgm) params.set('sgm', filters.sgm);
  if (filters.datePreset) params.set('datePreset', filters.datePreset);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  
  params.set('includeTrends', String(includeTrends));
  params.set('granularity', granularity);
  params.set('mode', mode);  // NEW
  
  const response = await fetch(`/api/dashboard/conversion-rates?${params}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch conversion rates');
  }
  
  return response.json();
}
```

---

## Step 5: Update the Chart Component

### File: `src/components/dashboard/ConversionTrendChart.tsx`

Add the toggle and update the component:

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, Title, Text } from '@tremor/react';
import { TrendDataPoint, ConversionTrendMode } from '@/types/dashboard';

interface ConversionTrendChartProps {
  data: TrendDataPoint[];
  isLoading?: boolean;
  mode: ConversionTrendMode;
  onModeChange: (mode: ConversionTrendMode) => void;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ConversionTrendChart - Dual Mode Support
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Displays conversion trends with a toggle between:
 * - Period Mode: Activity-based ("what happened this quarter")
 * - Cohort Mode: Efficiency-based ("how well do leads from this quarter convert")
 */
export function ConversionTrendChart({
  data,
  isLoading = false,
  mode,
  onModeChange,
}: ConversionTrendChartProps) {
  // Format data for chart display (convert rates to percentages)
  const chartData = data.map(d => ({
    period: d.period,
    'Contacted→MQL': (d.contactedToMqlRate * 100).toFixed(1),
    'MQL→SQL': (d.mqlToSqlRate * 100).toFixed(1),
    'SQL→SQO': (d.sqlToSqoRate * 100).toFixed(1),
    'SQO→Joined': (d.sqoToJoinedRate * 100).toFixed(1),
  }));

  if (isLoading) {
    return (
      <Card>
        <div className="animate-pulse h-80 bg-gray-200 rounded" />
      </Card>
    );
  }

  return (
    <Card>
      {/* Header with Toggle */}
      <div className="flex justify-between items-center mb-4">
        <div>
          <Title>Conversion Trends</Title>
          <Text className="text-gray-500">
            {mode === 'period' 
              ? 'Activity view: What happened in each period'
              : 'Cohort view: How well each cohort converts'
            }
          </Text>
        </div>
        
        {/* Mode Toggle */}
        <div className="flex items-center gap-2">
          <span className={`text-sm ${mode === 'period' ? 'font-semibold text-blue-600' : 'text-gray-500'}`}>
            Period
          </span>
          <button
            onClick={() => onModeChange(mode === 'period' ? 'cohort' : 'period')}
            className={`
              relative inline-flex h-6 w-11 items-center rounded-full transition-colors
              ${mode === 'cohort' ? 'bg-blue-600' : 'bg-gray-300'}
            `}
            aria-label="Toggle between period and cohort view"
          >
            <span
              className={`
                inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                ${mode === 'cohort' ? 'translate-x-6' : 'translate-x-1'}
              `}
            />
          </button>
          <span className={`text-sm ${mode === 'cohort' ? 'font-semibold text-blue-600' : 'text-gray-500'}`}>
            Cohort
          </span>
        </div>
      </div>

      {/* Cohort Mode Warning */}
      {mode === 'cohort' && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <Text className="text-amber-800 text-sm">
            <strong>Note:</strong> Recent periods may show lower rates as conversions are still in progress. 
            A Q4 SQL might not become SQO until Q1 next year.
          </Text>
        </div>
      )}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={350}>
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="period" />
          <YAxis 
            tickFormatter={(value) => `${value}%`}
            domain={mode === 'cohort' ? [0, 100] : ['auto', 'auto']}
          />
          <Tooltip 
            formatter={(value: string) => [`${value}%`, '']}
            labelFormatter={(label) => `Period: ${label}`}
          />
          <Legend />
          <Line 
            type="monotone" 
            dataKey="Contacted→MQL" 
            stroke="#8884d8" 
            strokeWidth={2}
            dot={{ r: 4 }}
          />
          <Line 
            type="monotone" 
            dataKey="MQL→SQL" 
            stroke="#82ca9d" 
            strokeWidth={2}
            dot={{ r: 4 }}
          />
          <Line 
            type="monotone" 
            dataKey="SQL→SQO" 
            stroke="#ffc658" 
            strokeWidth={2}
            dot={{ r: 4 }}
          />
          <Line 
            type="monotone" 
            dataKey="SQO→Joined" 
            stroke="#ff7300" 
            strokeWidth={2}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Legend Explanation */}
      <div className="mt-4 pt-4 border-t">
        <Text className="text-sm text-gray-600">
          {mode === 'period' ? (
            <>
              <strong>Period View:</strong> Shows conversion activity in each period. 
              An SQL from Q3 that becomes SQO in Q4 counts toward Q4's rate.
              Rates can exceed 100% when converting older leads.
            </>
          ) : (
            <>
              <strong>Cohort View:</strong> Tracks each cohort through the funnel. 
              An SQL from Q3 that becomes SQO in Q4 counts toward Q3's rate.
              Rates are always 0-100%. Best for measuring funnel efficiency.
            </>
          )}
        </Text>
      </div>
    </Card>
  );
}
```

---

## Step 6: Update Parent Component

### File: `src/app/dashboard/page.tsx` (or wherever the chart is used)

Add state management for the mode:

```tsx
'use client';

import React, { useState, useEffect } from 'react';
import { ConversionTrendChart } from '@/components/dashboard/ConversionTrendChart';
import { fetchConversionRates } from '@/lib/api-client';
import { TrendDataPoint, ConversionTrendMode, DashboardFilters } from '@/types/dashboard';

export default function DashboardPage() {
  const [filters, setFilters] = useState<DashboardFilters>({
    datePreset: 'thisQuarter',
  });
  const [trendMode, setTrendMode] = useState<ConversionTrendMode>('period');
  const [trendData, setTrendData] = useState<TrendDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch data when filters or mode changes
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const result = await fetchConversionRates({
          filters,
          includeTrends: true,
          granularity: 'quarter',
          mode: trendMode,  // Pass the current mode
        });
        setTrendData(result.trends || []);
      } catch (error) {
        console.error('Failed to load conversion data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadData();
  }, [filters, trendMode]);  // Re-fetch when mode changes

  // Handle mode toggle
  const handleModeChange = (newMode: ConversionTrendMode) => {
    setTrendMode(newMode);
  };

  return (
    <div className="p-6">
      {/* Other dashboard components... */}
      
      <ConversionTrendChart
        data={trendData}
        isLoading={isLoading}
        mode={trendMode}
        onModeChange={handleModeChange}
      />
    </div>
  );
}
```

---

## Verification Checklist

After implementation, verify:

### Period Mode (Default)
- [ ] Q4 2025 shows SQLs=193, SQOs=144, Joined=17
- [ ] SQL→SQO rate ≈ 74.6%
- [ ] SQO→Joined rate ≈ 11.6%
- [ ] Values match scorecard

### Cohort Mode
- [ ] Toggle switches to cohort view
- [ ] Warning banner appears about recent periods
- [ ] Rates are between 0-100%
- [ ] Y-axis is fixed 0-100
- [ ] Recent periods show lower rates (expected)
- [ ] Q1/Q2 2025 show more "complete" conversion rates

### Toggle UX
- [ ] Toggle is clearly visible
- [ ] Current mode is highlighted
- [ ] Explanation text updates when toggling
- [ ] Legend explanation updates when toggling

---

## Expected Differences Between Modes

| Period | Mode | SQL→SQO Rate | Why |
|--------|------|--------------|-----|
| Q1 2025 | Period | ~78% | Activity in Q1 |
| Q1 2025 | Cohort | ~75% | Q1 SQLs had time to convert |
| Q4 2025 | Period | ~74.6% | Activity in Q4 |
| Q4 2025 | Cohort | ~40-50% | Q4 SQLs haven't all converted yet |

The cohort rate for Q4 2025 will be lower because those SQLs haven't had time to become SQOs yet. As time passes and more Q4 SQLs convert, the cohort rate will increase.

---

## Future Enhancements

1. **Conversion Window Setting**: Let users specify "count conversions within 90 days" for cohort mode
2. **Cohort Maturity Indicator**: Show how "mature" each cohort is
3. **Forecast**: Use historical cohort rates to forecast future conversions
4. **Export**: Allow exporting both views to Excel
