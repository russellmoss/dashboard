# Open Pipeline Page - Agentic Implementation Guide

## Purpose
This document provides step-by-step instructions for Cursor.ai to autonomously implement the **Open Pipeline** dedicated dashboard page. Execute each step in order, verifying completion before proceeding.

---

## Pre-Implementation Checklist

Before starting, verify these prerequisites:

```bash
# Verify codebase access
ls src/app/dashboard/
ls src/components/dashboard/
ls src/lib/queries/

# Verify BigQuery MCP connection
# Run a test query to confirm connection
```

**Expected Outputs at Completion**:
- New page at `/dashboard/pipeline`
- Sidebar updated with Open Pipeline link
- Bar chart showing AUM and Advisor count by stage
- Stage filter allowing users to add/remove stages
- Drill-down modal on bar click
- Record detail modal on row click
- Validation: $12.5B AUM, 109 advisors total

---

## PHASE 1: Fix Existing Query Function

### Step 1.1: Update getOpenPipelineSummary

**File**: `src/lib/queries/open-pipeline.ts`

**Problem**: Current implementation uses `COUNT(*)` and `SUM(Opportunity_AUM)` which may double-count when multiple leads convert to the same opportunity.

**Action**: Replace the `_getOpenPipelineSummary` function with corrected aggregations.

**Find this code**:
```typescript
const _getOpenPipelineSummary = async (): Promise<{
  totalAum: number;
  recordCount: number;
  byStage: { stage: string; count: number; aum: number }[];
}> => {
```

**Replace the entire function with**:
```typescript
const _getOpenPipelineSummary = async (
  filters?: { stages?: string[]; sgms?: string[] }
): Promise<{
  totalAum: number;
  recordCount: number;
  byStage: { stage: string; count: number; aum: number }[];
}> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  conditions.push(`v.recordtypeid = @recruitingRecordType`);
  
  // Use custom stages if provided, otherwise default to OPEN_PIPELINE_STAGES
  const stagesToUse = filters?.stages && filters.stages.length > 0 
    ? filters.stages 
    : [...OPEN_PIPELINE_STAGES];
  
  const stageParams = stagesToUse.map((_, i) => `@stage${i}`);
  conditions.push(`v.StageName IN (${stageParams.join(', ')})`);
  stagesToUse.forEach((stage, i) => {
    params[`stage${i}`] = stage;
  });
  
  // Add SGM filter if provided (and not empty)
  if (filters?.sgms && filters.sgms.length > 0) {
    const sgmParams = filters.sgms.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgm${i}`] = sgm;
    });
  }
  
  conditions.push('v.is_sqo_unique = 1');
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      v.StageName as stage,
      COUNT(DISTINCT v.Full_Opportunity_ID__c) as count,
      SUM(CASE WHEN v.is_primary_opp_record = 1 THEN COALESCE(v.Opportunity_AUM, 0) ELSE 0 END) as aum
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    GROUP BY v.StageName
    ORDER BY 
      CASE v.StageName
        WHEN 'Qualifying' THEN 1
        WHEN 'Discovery' THEN 2
        WHEN 'Sales Process' THEN 3
        WHEN 'Negotiating' THEN 4
        WHEN 'Signed' THEN 5
        WHEN 'On Hold' THEN 6
        WHEN 'Planned Nurture' THEN 7
        ELSE 8
      END
  `;
  
  // Note: No LEFT JOIN with MAPPING_TABLE needed for summary query (no channel filtering in summary)
  
  const results = await runQuery<{ 
    stage: string | null; 
    count: number | null; 
    aum: number | null 
  }>(query, params);
  
  let totalAum = 0;
  let recordCount = 0;
  
  const byStage = results.map(r => {
    const aum = toNumber(r.aum);
    const count = toNumber(r.count);
    totalAum += aum;
    recordCount += count;
    
    return {
      stage: toString(r.stage),
      count,
      aum,
    };
  });
  
  return { totalAum, recordCount, byStage };
};
```

**Also update the cached export** to accept filters:
```typescript
export const getOpenPipelineSummary = cachedQuery(
  _getOpenPipelineSummary,
  'getOpenPipelineSummary',
  CACHE_TAGS.DASHBOARD
);
```

### Step 1.2: Add getOpenPipelineRecordsByStage Function

**File**: `src/lib/queries/open-pipeline.ts`

**Ensure these imports exist at the top of the file** (add if missing):
```typescript
import { runQuery, buildQueryParams } from '../bigquery';
import { DetailRecord } from '@/types/dashboard';
import { formatCurrency } from '../utils/date-helpers';
import { RawDetailRecordResult, toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
```

**IMPORTANT**: Verify that `RawDetailRecordResult` in `src/types/bigquery-raw.ts` includes the `is_primary_opp_record` field. 

**Status**: ✅ Verified - `RawDetailRecordResult` already includes `is_primary_opp_record?: number | null;` (line 92 in `src/types/bigquery-raw.ts`). No changes needed.

**Add this new function** after `getOpenPipelineSummary`:

```typescript
/**
 * Get open pipeline records filtered by specific stage
 * Used for drill-down when clicking a bar in the chart
 */
const _getOpenPipelineRecordsByStage = async (
  stage: string,
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string }
): Promise<DetailRecord[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    targetStage: stage,
  };
  
  if (filters?.channel) {
    conditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') = @channel');
    params.channel = filters.channel;
  }
  if (filters?.source) {
    conditions.push('v.Original_source = @source');
    params.source = filters.source;
  }
  if (filters?.sga) {
    conditions.push('v.SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }
  if (filters?.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }
  
  // Handle array of SGMs (from multi-select filter)
  if (filters?.sgms && filters.sgms.length > 0 && !filters?.sgm) {
    const sgmParams = filters.sgms.map((_, i) => `@sgmFilter${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgmFilter${i}`] = sgm;
    });
  }
  
  conditions.push(`v.recordtypeid = @recruitingRecordType`);
  conditions.push(`v.StageName = @targetStage`);
  conditions.push('v.is_sqo_unique = 1');
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT
      v.primary_key as id,
      v.Full_Opportunity_ID__c as opportunity_id,
      v.advisor_name,
      v.Original_source as source,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      v.StageName as stage,
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      v.Opportunity_AUM as aum,
      v.salesforce_url,
      v.FilterDate as filter_date,
      v.stage_entered_contacting__c as contacted_date,
      v.mql_stage_entered_ts as mql_date,
      v.converted_date_raw as sql_date,
      v.Date_Became_SQO__c as sqo_date,
      v.advisor_join_date__c as joined_date,
      v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
      v.Qualification_Call_Date__c as qualification_call_date,
      v.is_contacted,
      v.is_mql,
      v.recordtypeid
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
    ${whereClause}
    ORDER BY v.Opportunity_AUM DESC NULLS LAST
    LIMIT 1000
  `;
  
  const results = await runQuery<RawDetailRecordResult>(query, params);
  
  return results.map(r => {
    // Helper function to extract date values (handles both DATE and TIMESTAMP types)
    const extractDate = (field: any): string | null => {
      if (!field) return null;
      if (typeof field === 'string') return field;
      if (typeof field === 'object' && field.value) return field.value;
      return null;
    };
    
    // Extract all date fields
    const filterDate = extractDate(r.filter_date) || '';
    const contactedDate = extractDate(r.contacted_date);
    const mqlDate = extractDate(r.mql_date);
    const sqlDate = extractDate(r.sql_date);
    const sqoDate = extractDate(r.sqo_date);
    const joinedDate = extractDate(r.joined_date);
    
    // Extract Initial Call Scheduled Date (DATE field - direct string)
    let initialCallDate: string | null = null;
    if (r.initial_call_scheduled_date) {
      if (typeof r.initial_call_scheduled_date === 'string') {
        initialCallDate = r.initial_call_scheduled_date;
      } else if (typeof r.initial_call_scheduled_date === 'object' && r.initial_call_scheduled_date.value) {
        initialCallDate = r.initial_call_scheduled_date.value;
      }
    }
    
    // Extract Qualification Call Date (DATE field - direct string)
    let qualCallDate: string | null = null;
    if (r.qualification_call_date) {
      if (typeof r.qualification_call_date === 'string') {
        qualCallDate = r.qualification_call_date;
      } else if (typeof r.qualification_call_date === 'object' && r.qualification_call_date.value) {
        qualCallDate = r.qualification_call_date.value;
      }
    }
    
    return {
      id: toString(r.id),
      advisorName: toString(r.advisor_name) || 'Unknown',
      source: toString(r.source) || 'Unknown',
      channel: toString(r.channel) || 'Unknown',
      stage: toString(r.stage) || 'Unknown',
      sga: r.sga ? toString(r.sga) : null,
      sgm: r.sgm ? toString(r.sgm) : null,
      aum: toNumber(r.aum),
      aumFormatted: formatCurrency(r.aum),
      salesforceUrl: toString(r.salesforce_url) || '',
      relevantDate: filterDate,
      contactedDate,
      mqlDate,
      sqlDate,
      sqoDate,
      joinedDate,
      signedDate: null,
      discoveryDate: null,
      salesProcessDate: null,
      negotiatingDate: null,
      onHoldDate: null,
      closedDate: null,
      initialCallScheduledDate: initialCallDate,
      qualificationCallDate: qualCallDate,
      isContacted: r.is_contacted === 1,
      isMql: r.is_mql === 1,
      isSql: true,
      isSqo: true,
      isJoined: false,
      isOpenPipeline: OPEN_PIPELINE_STAGES.includes(toString(r.stage)),
      recordTypeId: r.recordtypeid ? toString(r.recordtypeid) : null,
      isPrimaryOppRecord: (r.is_primary_opp_record ?? 0) === 1,
      opportunityId: r.opportunity_id ? toString(r.opportunity_id) : null,
    };
  });
};

export const getOpenPipelineRecordsByStage = cachedQuery(
  _getOpenPipelineRecordsByStage,
  'getOpenPipelineRecordsByStage',
  CACHE_TAGS.DASHBOARD
);
```

### Step 1.3: Verify Query Correctness

**Run this validation query via BigQuery MCP**:

```sql
SELECT
  StageName as stage,
  COUNT(DISTINCT Full_Opportunity_ID__c) as advisor_count,
  SUM(CASE WHEN is_primary_opp_record = 1 THEN COALESCE(Opportunity_AUM, 0) ELSE 0 END) as total_aum,
  ROUND(SUM(CASE WHEN is_primary_opp_record = 1 THEN COALESCE(Opportunity_AUM, 0) ELSE 0 END) / 1000000000, 2) as aum_billions
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND is_sqo_unique = 1
GROUP BY StageName
ORDER BY 
  CASE StageName
    WHEN 'Qualifying' THEN 1
    WHEN 'Discovery' THEN 2
    WHEN 'Sales Process' THEN 3
    WHEN 'Negotiating' THEN 4
  END;
```

**Expected Results**:
- Total advisors: ~109
- Total AUM: ~$12.5B

✅ **Checkpoint**: Query returns expected values before proceeding.

---

## PHASE 2: Add TypeScript Types

### Step 2.1: Add OpenPipeline Types

**File**: `src/types/dashboard.ts`

**Add these interfaces** (find appropriate location, typically near other interface definitions):

```typescript
/**
 * Open Pipeline stage breakdown for bar chart
 */
export interface OpenPipelineByStage {
  stage: string;
  advisorCount: number;
  totalAum: number;
  aumFormatted: string;
  aumInBillions: number;
}

/**
 * Open Pipeline summary with totals and by-stage breakdown
 */
export interface OpenPipelineSummary {
  totalAum: number;
  totalAumFormatted: string;
  advisorCount: number;
  byStage: OpenPipelineByStage[];
}

/**
 * Available stages for filtering
 */
export interface PipelineStageOption {
  value: string;
  label: string;
  isDefault: boolean;
}

/**
 * SGM option with active status (for pipeline filters)
 */
export interface SgmOption {
  value: string;
  label: string;
  isActive: boolean;
}

/**
 * Multi-select filter state
 */
export interface MultiSelectFilterState {
  selectAll: boolean;
  selected: string[];
}

/**
 * Pipeline page filter state
 */
export interface PipelinePageFilters {
  stages: MultiSelectFilterState;
  sgms: MultiSelectFilterState;
}
```

### Step 2.2: Export Types

**Verify** these types are exported from `src/types/dashboard.ts` or the appropriate index file.

---

## PHASE 2.5: Create SGM Options API Endpoint (Enhancement)

### Step 2.5.1: Create SGM Options Route

**Create new file**: `src/app/api/dashboard/pipeline-sgm-options/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE, RECRUITING_RECORD_TYPE, OPEN_PIPELINE_STAGES } from '@/config/constants';
import { SgmOption } from '@/types/dashboard';

interface RawSgmResult {
  sgm: string | null;
  isActive: boolean | number | null;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Note: Permission check removed - all authenticated users can access pipeline data
    
    // Build stage parameters
    const stageParams = OPEN_PIPELINE_STAGES.map((_, i) => `@stage${i}`);
    const params: Record<string, any> = {
      recruitingRecordType: RECRUITING_RECORD_TYPE,
    };
    OPEN_PIPELINE_STAGES.forEach((stage, i) => {
      params[`stage${i}`] = stage;
    });
    
    // Query distinct SGMs from open pipeline opportunities
    // Join with User table to get isActive status
    const query = `
      SELECT DISTINCT 
        v.SGM_Owner_Name__c as sgm,
        COALESCE(u.IsActive, FALSE) as isActive
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u 
        ON v.SGM_Owner_Name__c = u.Name
        AND u.Is_SGM__c = TRUE
      WHERE v.SGM_Owner_Name__c IS NOT NULL
        AND v.recordtypeid = @recruitingRecordType
        AND v.StageName IN (${stageParams.join(', ')})
        AND v.is_sqo_unique = 1
      ORDER BY v.SGM_Owner_Name__c
    `;
    
    const results = await runQuery<RawSgmResult>(query, params);
    
    const sgmOptions: SgmOption[] = results
      .filter(r => r.sgm !== null)
      .map(r => ({
        value: r.sgm as string,
        label: r.sgm as string,
        isActive: r.isActive === true || r.isActive === 1,
      }));
    
    return NextResponse.json({ sgmOptions });
  } catch (error) {
    console.error('Error fetching SGM options:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM options' },
      { status: 500 }
    );
  }
}
```

---

## PHASE 3: Create API Endpoint

### Step 3.1: Create Pipeline Summary API Route

**Create new file**: `src/app/api/dashboard/pipeline-summary/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpenPipelineSummary } from '@/lib/queries/open-pipeline';
import { formatCurrency } from '@/lib/utils/date-helpers';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Note: No permission checks or data restrictions - all authenticated users can access all pipeline data
    
    const body = await request.json();
    const { stages, sgms } = body;
    
    // No permission-based data restrictions - all users see all data
    const summary = await getOpenPipelineSummary({ stages, sgms });
    
    // Format response
    const response = {
      totalAum: summary.totalAum,
      totalAumFormatted: formatCurrency(summary.totalAum),
      advisorCount: summary.recordCount,
      byStage: summary.byStage.map(s => ({
        stage: s.stage,
        advisorCount: s.count,
        totalAum: s.aum,
        aumFormatted: formatCurrency(s.aum),
        aumInBillions: Math.round(s.aum / 1000000000 * 100) / 100,
      })),
    };
    
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching pipeline summary:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline summary' },
      { status: 500 }
    );
  }
}
```

### Step 3.2: Create Pipeline Drill-Down API Route

**Create new file**: `src/app/api/dashboard/pipeline-drilldown/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOpenPipelineRecordsByStage } from '@/lib/queries/open-pipeline';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Note: No permission checks or data restrictions - all authenticated users can access all pipeline data
    
    const body = await request.json();
    const { stage, filters, sgms } = body;
    
    if (!stage) {
      return NextResponse.json(
        { error: 'Stage parameter is required' },
        { status: 400 }
      );
    }
    
    // No permission-based data restrictions - all users see all data
    // Apply user's SGM filter selection if provided
    const pipelineFilters = { ...filters };
    if (sgms && sgms.length > 0) {
      pipelineFilters.sgms = sgms;
    }
    
    const records = await getOpenPipelineRecordsByStage(stage, pipelineFilters);
    
    return NextResponse.json({ records, stage });
  } catch (error) {
    console.error('Error fetching pipeline drilldown:', error);
    return NextResponse.json(
      { error: 'Failed to fetch pipeline drilldown' },
      { status: 500 }
    );
  }
}
```

---

## PHASE 4: Update API Client

### Step 4.1: Add API Client Methods

**File**: `src/lib/api-client.ts`

**Add these methods** to the `dashboardApi` object:

```typescript
// Inside dashboardApi object, add:

/**
 * Get SGM options for pipeline page filter
 */
getPipelineSgmOptions: async (): Promise<{ sgmOptions: SgmOption[] }> => {
  const response = await fetch('/api/dashboard/pipeline-sgm-options', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch SGM options');
  }
  
  return response.json();
},

/**
 * Get open pipeline summary with by-stage breakdown
 */
getPipelineSummary: async (stages?: string[], sgms?: string[]): Promise<OpenPipelineSummary> => {
  const response = await fetch('/api/dashboard/pipeline-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stages, sgms }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch pipeline summary');
  }
  
  return response.json();
},

/**
 * Get pipeline records for a specific stage (drill-down)
 */
getPipelineDrilldown: async (
  stage: string,
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string },
  sgms?: string[]
): Promise<{ records: DetailRecord[]; stage: string }> => {
  const response = await fetch('/api/dashboard/pipeline-drilldown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, filters, sgms }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch pipeline drilldown');
  }
  
  return response.json();
},
```

### Step 4.2: Import Required Types

**At the top of** `src/lib/api-client.ts`, ensure these types are imported:

```typescript
import { 
  // ... existing imports (FunnelMetrics, ConversionRates, etc.)
  OpenPipelineSummary,
  DetailRecord,
  SgmOption,
} from '@/types/dashboard';
```

**Note**: The `dashboardApi` object structure uses method definitions, not a class. Add the new methods directly to the object.

---

## PHASE 5: Create UI Components

### Step 5.1: Create Pipeline Filters Component (Replaces Stage Filter)

**Create new file**: `src/components/dashboard/PipelineFilters.tsx`

**Note**: This replaces the simpler `PipelineStageFilter.tsx` from the original plan. It includes both Stage and SGM multi-select filters in a collapsible panel.

```typescript
'use client';

import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, Check, Filter, RotateCcw } from 'lucide-react';
import { OPEN_PIPELINE_STAGES } from '@/config/constants';
import { SgmOption } from '@/types/dashboard';

// All possible opportunity stages
const ALL_STAGES = [
  { value: 'Qualifying', label: 'Qualifying', isOpenPipeline: true },
  { value: 'Discovery', label: 'Discovery', isOpenPipeline: true },
  { value: 'Sales Process', label: 'Sales Process', isOpenPipeline: true },
  { value: 'Negotiating', label: 'Negotiating', isOpenPipeline: true },
  { value: 'Signed', label: 'Signed', isOpenPipeline: false },
  { value: 'On Hold', label: 'On Hold', isOpenPipeline: false },
  { value: 'Planned Nurture', label: 'Planned Nurture', isOpenPipeline: false },
];

interface PipelineFiltersProps {
  // Stage filter
  selectedStages: string[];
  onStagesChange: (stages: string[]) => void;
  // SGM filter
  selectedSgms: string[];
  onSgmsChange: (sgms: string[]) => void;
  sgmOptions: SgmOption[];
  sgmOptionsLoading: boolean;
  // State
  disabled?: boolean;
}

export function PipelineFilters({
  selectedStages,
  onStagesChange,
  selectedSgms,
  onSgmsChange,
  sgmOptions,
  sgmOptionsLoading,
  disabled = false,
}: PipelineFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sgmSearch, setSgmSearch] = useState('');

  // Filter SGM options by search
  const filteredSgmOptions = useMemo(() => {
    if (!sgmSearch.trim()) return sgmOptions;
    const search = sgmSearch.toLowerCase();
    return sgmOptions.filter(opt => opt.label.toLowerCase().includes(search));
  }, [sgmOptions, sgmSearch]);

  // Stage handlers
  const handleStageToggle = (stage: string) => {
    if (disabled) return;
    if (selectedStages.includes(stage)) {
      // Don't allow removing all stages
      if (selectedStages.length > 1) {
        onStagesChange(selectedStages.filter(s => s !== stage));
      }
    } else {
      onStagesChange([...selectedStages, stage]);
    }
  };

  const handleSelectAllStages = () => {
    if (disabled) return;
    onStagesChange(ALL_STAGES.map(s => s.value));
  };

  const handleSelectOpenPipelineStages = () => {
    if (disabled) return;
    onStagesChange([...OPEN_PIPELINE_STAGES]);
  };

  // SGM handlers
  const handleSgmToggle = (sgm: string) => {
    if (disabled) return;
    if (selectedSgms.includes(sgm)) {
      // Don't allow removing all SGMs
      if (selectedSgms.length > 1) {
        onSgmsChange(selectedSgms.filter(s => s !== sgm));
      }
    } else {
      onSgmsChange([...selectedSgms, sgm]);
    }
  };

  const handleSelectAllSgms = () => {
    if (disabled) return;
    onSgmsChange(sgmOptions.map(s => s.value));
  };

  const handleSelectActiveSgms = () => {
    if (disabled) return;
    const activeSgms = sgmOptions.filter(s => s.isActive).map(s => s.value);
    onSgmsChange(activeSgms.length > 0 ? activeSgms : sgmOptions.map(s => s.value));
  };

  // Reset all filters to defaults
  const handleResetFilters = () => {
    if (disabled) return;
    onStagesChange([...OPEN_PIPELINE_STAGES]);
    onSgmsChange(sgmOptions.map(s => s.value));
  };

  // Summary counts for header
  const stagesSummary = selectedStages.length === ALL_STAGES.length 
    ? 'All Stages' 
    : selectedStages.length === OPEN_PIPELINE_STAGES.length && 
      OPEN_PIPELINE_STAGES.every(s => selectedStages.includes(s))
      ? 'Open Pipeline'
      : `${selectedStages.length} Stages`;
  
  const sgmsSummary = sgmOptionsLoading 
    ? 'Loading...'
    : selectedSgms.length === sgmOptions.length 
      ? 'All SGMs' 
      : `${selectedSgms.length} SGMs`;

  const hasCustomFilters = 
    selectedStages.length !== OPEN_PIPELINE_STAGES.length ||
    !OPEN_PIPELINE_STAGES.every(s => selectedStages.includes(s)) ||
    selectedSgms.length !== sgmOptions.length;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800">
      {/* Collapsed Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Filters
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
              {stagesSummary}
            </span>
            <span className="text-xs bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
              {sgmsSummary}
            </span>
          </div>
          {hasCustomFilters && (
            <span className="text-xs text-orange-600 dark:text-orange-400">
              (Modified)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasCustomFilters && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleResetFilters();
              }}
              className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 flex items-center gap-1"
              title="Reset to defaults"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          )}
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stage Filter */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Opportunity Stages
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectOpenPipelineStages}
                    disabled={disabled}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Open Pipeline
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleSelectAllStages}
                    disabled={disabled}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    All Stages
                  </button>
                </div>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {ALL_STAGES.map(stage => {
                  const isSelected = selectedStages.includes(stage.value);
                  return (
                    <label
                      key={stage.value}
                      className={`
                        flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                        ${isSelected 
                          ? 'bg-blue-50 dark:bg-blue-900/30' 
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }
                        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <div className={`
                        w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                        ${isSelected 
                          ? 'bg-blue-600 border-blue-600' 
                          : 'border-gray-300 dark:border-gray-600'
                        }
                      `}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleStageToggle(stage.value)}
                        disabled={disabled}
                        className="sr-only"
                      />
                      <span className={`text-sm ${isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                        {stage.label}
                      </span>
                      {stage.isOpenPipeline && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          (Open Pipeline)
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* SGM Filter */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  SGM Owners
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectActiveSgms}
                    disabled={disabled || sgmOptionsLoading}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Active Only
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleSelectAllSgms}
                    disabled={disabled || sgmOptionsLoading}
                    className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    All SGMs
                  </button>
                </div>
              </div>
              
              {/* Search */}
              <input
                type="text"
                placeholder="Search SGMs..."
                value={sgmSearch}
                onChange={(e) => setSgmSearch(e.target.value)}
                disabled={disabled || sgmOptionsLoading}
                className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg mb-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
              />
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {sgmOptionsLoading ? (
                  <div className="flex items-center justify-center py-4 text-gray-400">
                    Loading SGMs...
                  </div>
                ) : filteredSgmOptions.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    {sgmSearch ? 'No SGMs match your search' : 'No SGMs found'}
                  </div>
                ) : (
                  filteredSgmOptions.map(sgm => {
                    const isSelected = selectedSgms.includes(sgm.value);
                    return (
                      <label
                        key={sgm.value}
                        className={`
                          flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                          ${isSelected 
                            ? 'bg-green-50 dark:bg-green-900/30' 
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }
                          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        <div className={`
                          w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                          ${isSelected 
                            ? 'bg-green-600 border-green-600' 
                            : 'border-gray-300 dark:border-gray-600'
                          }
                        `}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSgmToggle(sgm.value)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-sm ${isSelected ? 'text-green-700 dark:text-green-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {sgm.label}
                        </span>
                        {!sgm.isActive && (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            (Inactive)
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 5.2: Create Pipeline Bar Chart Component

**Create new file**: `src/components/dashboard/PipelineByStageChart.tsx`

```typescript
'use client';

import React from 'react';
import { useTheme } from 'next-themes';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
} from 'recharts';
import { OpenPipelineByStage } from '@/types/dashboard';

interface PipelineByStageChartProps {
  data: OpenPipelineByStage[];
  onBarClick: (stage: string, metric: 'aum' | 'count') => void;
  loading?: boolean;
}

const COLORS = {
  aum: '#3B82F6',      // Blue
  count: '#10B981',    // Green
  aumHover: '#2563EB',
  countHover: '#059669',
};

const formatAumAxis = (value: number) => {
  if (value >= 1000000000) {
    return `$${(value / 1000000000).toFixed(1)}B`;
  }
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(0)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
};

const formatAumTooltip = (value: number) => {
  if (value >= 1000000000) {
    return `$${(value / 1000000000).toFixed(2)}B`;
  }
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toLocaleString()}`;
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-3">
      <p className="font-semibold text-gray-900 dark:text-white mb-2">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <div
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-600 dark:text-gray-400">
            {entry.name}:
          </span>
          <span className="font-medium text-gray-900 dark:text-white">
            {entry.name === 'AUM' 
              ? formatAumTooltip(entry.value)
              : entry.value.toLocaleString()
            }
          </span>
        </div>
      ))}
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 border-t border-gray-200 dark:border-gray-600 pt-2">
        Click a bar to see details
      </p>
    </div>
  );
};

export function PipelineByStageChart({
  data,
  onBarClick,
  loading = false,
}: PipelineByStageChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  if (loading) {
    return (
      <div className="h-80 flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading chart...</div>
      </div>
    );
  }
  
  if (!data || data.length === 0) {
    return (
      <div className="h-80 flex items-center justify-center text-gray-500 dark:text-gray-400">
        No data available for selected stages
      </div>
    );
  }
  
  const textColor = isDark ? '#9CA3AF' : '#6B7280';
  const gridColor = isDark ? '#374151' : '#E5E7EB';
  
  // Find max values for scaling
  const maxAum = Math.max(...data.map(d => d.totalAum));
  const maxCount = Math.max(...data.map(d => d.advisorCount));
  
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 20, right: 80, left: 20, bottom: 20 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis 
            dataKey="stage" 
            tick={{ fill: textColor, fontSize: 12 }}
            axisLine={{ stroke: gridColor }}
          />
          <YAxis
            yAxisId="aum"
            orientation="left"
            tickFormatter={formatAumAxis}
            tick={{ fill: textColor, fontSize: 11 }}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
            label={{ 
              value: 'AUM', 
              angle: -90, 
              position: 'insideLeft',
              style: { fill: COLORS.aum, fontSize: 12 },
            }}
          />
          <YAxis
            yAxisId="count"
            orientation="right"
            tick={{ fill: textColor, fontSize: 11 }}
            tickFormatter={(value) => value.toLocaleString()}
            axisLine={{ stroke: gridColor }}
            tickLine={{ stroke: gridColor }}
            label={{ 
              value: 'Advisors', 
              angle: 90, 
              position: 'insideRight',
              style: { fill: COLORS.count, fontSize: 12 },
            }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{ paddingTop: 10 }}
            formatter={(value) => (
              <span style={{ color: textColor, fontSize: 12 }}>{value}</span>
            )}
          />
          <Bar
            yAxisId="aum"
            dataKey="totalAum"
            name="AUM"
            fill={COLORS.aum}
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(data) => onBarClick(data.stage, 'aum')}
          >
            {data.map((entry, index) => (
              <Cell 
                key={`aum-${index}`} 
                fill={COLORS.aum}
                className="hover:opacity-80 transition-opacity"
              />
            ))}
          </Bar>
          <Bar
            yAxisId="count"
            dataKey="advisorCount"
            name="Advisors"
            fill={COLORS.count}
            radius={[4, 4, 0, 0]}
            cursor="pointer"
            onClick={(data) => onBarClick(data.stage, 'count')}
          >
            {data.map((entry, index) => (
              <Cell 
                key={`count-${index}`} 
                fill={COLORS.count}
                className="hover:opacity-80 transition-opacity"
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

### Step 5.2: Create PNG Export Button Component

**Create new file**: `src/components/dashboard/PipelineExportPng.tsx`

```typescript
'use client';

import React, { useState } from 'react';
import { Image, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';

interface PipelineExportPngProps {
  chartElementId: string;
  filename?: string;
  disabled?: boolean;
}

export function PipelineExportPng({
  chartElementId,
  filename = 'open-pipeline-chart',
  disabled = false,
}: PipelineExportPngProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    const element = document.getElementById(chartElementId);
    if (!element) {
      console.error('Chart element not found:', chartElementId);
      alert('Chart not available for export');
      return;
    }

    setIsExporting(true);
    try {
      const dataUrl = await toPng(element, {
        backgroundColor: '#ffffff',
        pixelRatio: 2, // Higher quality
        style: {
          // Ensure the element is rendered properly
          transform: 'scale(1)',
        },
      });
      
      const timestamp = new Date().toISOString().split('T')[0];
      const link = document.createElement('a');
      link.download = `${filename}_${timestamp}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('PNG export failed:', err);
      alert('Failed to export PNG. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      onClick={handleExport}
      disabled={disabled || isExporting}
      className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-gray-200 
                 dark:border-gray-700 bg-white dark:bg-gray-800 
                 hover:bg-gray-50 dark:hover:bg-gray-700 
                 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Export chart as PNG image"
    >
      {isExporting ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <Image className="w-4 h-4" />
      )}
      <span>Export PNG</span>
    </button>
  );
}
```

### Step 5.3: Create Pipeline Scorecard Component

**Create new file**: `src/components/dashboard/PipelineScorecard.tsx`

```typescript
'use client';

import React from 'react';
import { Card, Metric, Text } from '@tremor/react';
import { OpenPipelineAumTooltip } from './OpenPipelineAumTooltip';

interface PipelineScorecardProps {
  totalAum: number;
  totalAumFormatted: string;
  advisorCount: number;
  loading?: boolean;
}

export function PipelineScorecard({
  totalAum,
  totalAumFormatted,
  advisorCount,
  loading = false,
}: PipelineScorecardProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
        </Card>
        <Card className="animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-2" />
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
        </Card>
      </div>
    );
  }
  
  const aumInBillions = (totalAum / 1000000000).toFixed(2);
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card decoration="top" decorationColor="blue">
        <div className="flex items-center gap-2">
          <Text>Open Pipeline AUM</Text>
          <OpenPipelineAumTooltip />
        </div>
        <Metric className="mt-1">${aumInBillions}B</Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          {totalAumFormatted}
        </Text>
      </Card>
      
      <Card decoration="top" decorationColor="green">
        <Text>Open Pipeline Advisors</Text>
        <Metric className="mt-1">{advisorCount.toLocaleString()}</Metric>
        <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Unique opportunities in pipeline
        </Text>
      </Card>
    </div>
  );
}
```

---

## PHASE 6: Create Pipeline Page

### Pre-Phase 6 Verification: VolumeDrillDownModal Props

**Before creating the page, verify the VolumeDrillDownModal component props match our usage:**

**Status**: ✅ Verified - `VolumeDrillDownModal` props match exactly:
- `isOpen: boolean` ✅
- `onClose: () => void` ✅
- `records: DetailRecord[]` ✅
- `title: string` ✅
- `loading: boolean` ✅
- `error: string | null` ✅
- `onRecordClick: (recordId: string) => void` ✅
- `metricFilter?: 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline'` ✅ (includes 'openPipeline')
- `canExport?: boolean` ✅

All props exist and match our usage. No adjustments needed.

### Step 6.1: Create Page Directory and File

**Create new file**: `src/app/dashboard/pipeline/page.tsx`

```typescript
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useTheme } from 'next-themes';
import { Title, Text, Card } from '@tremor/react';
import { Loader2 } from 'lucide-react';

import { dashboardApi } from '@/lib/api-client';
import { getSessionPermissions } from '@/types/auth';
import { OPEN_PIPELINE_STAGES } from '@/config/constants';
import { OpenPipelineSummary, DetailRecord } from '@/types/dashboard';

import { PipelineScorecard } from '@/components/dashboard/PipelineScorecard';
import { PipelineByStageChart } from '@/components/dashboard/PipelineByStageChart';
import { PipelineFilters } from '@/components/dashboard/PipelineFilters';
import { PipelineExportPng } from '@/components/dashboard/PipelineExportPng';
import { VolumeDrillDownModal } from '@/components/dashboard/VolumeDrillDownModal';
import { RecordDetailModal } from '@/components/dashboard/RecordDetailModal';
import { SgmOption } from '@/types/dashboard';

export default function PipelinePage() {
  const { data: session, status } = useSession();
  const permissions = getSessionPermissions(session);
  
  // Data state
  const [summary, setSummary] = useState<OpenPipelineSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // SGM options state
  const [sgmOptions, setSgmOptions] = useState<SgmOption[]>([]);
  const [sgmOptionsLoading, setSgmOptionsLoading] = useState(true);
  
  // Filter state - defaults
  const [selectedStages, setSelectedStages] = useState<string[]>([...OPEN_PIPELINE_STAGES]);
  const [selectedSgms, setSelectedSgms] = useState<string[]>([]);
  
  // Fetch SGM options on mount
  useEffect(() => {
    const fetchSgmOptions = async () => {
      setSgmOptionsLoading(true);
      try {
        const { sgmOptions: options } = await dashboardApi.getPipelineSgmOptions();
        setSgmOptions(options);
        // Default: select all SGMs
        setSelectedSgms(options.map(o => o.value));
      } catch (err) {
        console.error('Error fetching SGM options:', err);
        setSgmOptions([]);
        setSelectedSgms([]);
      } finally {
        setSgmOptionsLoading(false);
      }
    };
    
    if (status === 'authenticated') {
      fetchSgmOptions();
    }
  }, [status]);
  
  // Drill-down modal state
  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownRecords, setDrillDownRecords] = useState<DetailRecord[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [drillDownStage, setDrillDownStage] = useState<string | null>(null);
  const [drillDownMetric, setDrillDownMetric] = useState<'aum' | 'count' | null>(null);
  
  // Record detail modal state
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  
  // Dark mode detection (for chart component - chart uses useTheme internally)
  const { resolvedTheme } = useTheme();
  
  // Fetch pipeline data
  const fetchData = useCallback(async () => {
    if (sgmOptionsLoading || selectedSgms.length === 0) return;
    
    setLoading(true);
    setError(null);
    
    try {
      // Only pass SGMs if not all are selected (optimization)
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const data = await dashboardApi.getPipelineSummary(selectedStages, sgmsToSend);
      setSummary(data);
    } catch (err) {
      console.error('Error fetching pipeline data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load pipeline data');
    } finally {
      setLoading(false);
    }
  }, [selectedStages, selectedSgms, sgmOptions.length, sgmOptionsLoading]);
  
  // Fetch on mount and when stages change
  useEffect(() => {
    if (status === 'authenticated') {
      fetchData();
    }
  }, [status, fetchData]);
  
  // Handle bar click for drill-down
  const handleBarClick = async (stage: string, metric: 'aum' | 'count') => {
    setDrillDownStage(stage);
    setDrillDownMetric(metric);
    setDrillDownOpen(true);
    setDrillDownLoading(true);
    
    try {
      // Pass SGMs filter to drill-down (only if not all selected)
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const result = await dashboardApi.getPipelineDrilldown(stage, undefined, sgmsToSend);
      setDrillDownRecords(result.records);
    } catch (err) {
      console.error('Error fetching drill-down data:', err);
      setDrillDownRecords([]);
    } finally {
      setDrillDownLoading(false);
    }
  };
  
  // Handle record click from drill-down
  const handleRecordClick = (recordId: string) => {
    setDrillDownOpen(false);
    setSelectedRecordId(recordId);
  };
  
  // Handle back from record detail to drill-down
  const handleBackToDrillDown = () => {
    setSelectedRecordId(null);
    setDrillDownOpen(true);
  };
  
  // Close drill-down modal
  const handleCloseDrillDown = () => {
    setDrillDownOpen(false);
    setDrillDownRecords([]);
    setDrillDownStage(null);
    setDrillDownMetric(null);
  };
  
  // Note: Stage and SGM filter changes are handled directly via setSelectedStages and setSelectedSgms
  // The fetchData callback will automatically trigger when these change
  
  // Loading state
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }
  
  // Note: Permission check removed - all authenticated users can access the pipeline page
  
  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="mb-6">
        <Title>Open Pipeline</Title>
        <Text>
          Real-time view of active opportunities in the recruitment pipeline
        </Text>
      </div>
      
      {/* Error State */}
      {error && (
        <Card className="mb-6 border-red-200 dark:border-red-800">
          <Text className="text-red-600 dark:text-red-400">{error}</Text>
          <button
            onClick={fetchData}
            className="mt-2 text-sm text-blue-600 hover:text-blue-700"
          >
            Try Again
          </button>
        </Card>
      )}
      
      {/* Scorecards */}
      <div className="mb-6">
        <PipelineScorecard
          totalAum={summary?.totalAum || 0}
          totalAumFormatted={summary?.totalAumFormatted || '$0'}
          advisorCount={summary?.advisorCount || 0}
          loading={loading}
        />
      </div>
      
      {/* Filters */}
      <div className="mb-6">
        <PipelineFilters
          selectedStages={selectedStages}
          onStagesChange={setSelectedStages}
          selectedSgms={selectedSgms}
          onSgmsChange={setSelectedSgms}
          sgmOptions={sgmOptions}
          sgmOptionsLoading={sgmOptionsLoading}
          disabled={loading}
        />
      </div>
      
      {/* Bar Chart with Export */}
      <Card className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Text className="font-semibold">Pipeline by Stage</Text>
            <Text className="text-sm text-gray-500 dark:text-gray-400">
              Click any bar to see the advisors in that stage
            </Text>
          </div>
          <PipelineExportPng
            chartElementId="pipeline-by-stage-chart"
            filename="open-pipeline-chart"
            disabled={loading || !summary?.byStage?.length}
          />
        </div>
        {/* Wrap chart in div with ID for PNG export */}
        <div id="pipeline-by-stage-chart" className="bg-white dark:bg-gray-800">
          <PipelineByStageChart
            data={summary?.byStage || []}
            onBarClick={handleBarClick}
            loading={loading}
          />
        </div>
      </Card>
      
      {/* Drill-Down Modal - Reuse existing VolumeDrillDownModal component */}
      <VolumeDrillDownModal
        isOpen={drillDownOpen}
        onClose={handleCloseDrillDown}
        records={drillDownRecords}
        title={drillDownStage ? `${drillDownStage} Stage` : 'Pipeline Drill-Down'}
        loading={drillDownLoading}
        error={null}
        onRecordClick={handleRecordClick}
        metricFilter="openPipeline"
        canExport={permissions?.canExport || false}
      />
      
      {/* Record Detail Modal */}
      <RecordDetailModal
        isOpen={selectedRecordId !== null}
        onClose={() => setSelectedRecordId(null)}
        recordId={selectedRecordId}
        showBackButton={drillDownRecords.length > 0}
        onBack={handleBackToDrillDown}
        backButtonLabel={`← Back to ${drillDownStage || 'list'}`}
      />
    </div>
  );
}
```

---

## PHASE 7: Update Navigation

### Step 7.1: Add Pipeline Page to Sidebar

**File**: `src/components/layout/Sidebar.tsx`

**Find the PAGES array and add the pipeline page**:

```typescript
// Find this array:
const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  // ... other pages
];

// Add this entry (in appropriate position, typically after Funnel Performance):
{ id: 3, name: 'Open Pipeline', href: '/dashboard/pipeline', icon: Target },
```

**Import the icon** at the top of the file (if not already imported):
```typescript
import { 
  BarChart3, 
  Settings, 
  Menu, 
  X, 
  Layers,  // For Open Pipeline (represents pipeline stages stacked)
  Bot, 
  Target,
  Users 
} from 'lucide-react';
```

**Note**: Using `Layers` icon for Open Pipeline to represent pipeline stages. The PAGES array should be updated to position Open Pipeline between Funnel Performance and Explore:
```typescript
const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  { id: 3, name: 'Open Pipeline', href: '/dashboard/pipeline', icon: Layers }, // Positioned here, between Funnel Performance and Explore
  { id: 10, name: 'Explore', href: '/dashboard/explore', icon: Bot },
  { id: 7, name: 'Settings', href: '/dashboard/settings', icon: Settings },
  { id: 8, name: 'SGA Hub', href: '/dashboard/sga-hub', icon: Target },
  { id: 9, name: 'SGA Management', href: '/dashboard/sga-management', icon: Users },
];
```

### Step 7.2: Update Permissions Configuration

**File**: `src/lib/permissions.ts`

**Update ROLE_PERMISSIONS** to include page ID 3 for ALL roles:

**Action Required**: Add page 3 to ALL roles (admin, manager, sgm, sga, viewer):

```typescript
const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter'>> = {
  admin: {
    role: 'admin',
    allowedPages: [1, 3, 7, 8, 9, 10], // Added 3
    canExport: true,
    canManageUsers: true,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 3, 7, 8, 9, 10], // Added 3
    canExport: true,
    canManageUsers: true,
  },
  sgm: {
    role: 'sgm',
    allowedPages: [1, 3, 10], // Added 3
    canExport: true,
    canManageUsers: false,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 3, 8, 10], // Added 3 - ALL users get access
    canExport: false,
    canManageUsers: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 3, 10], // Added 3 - ALL users get access
    canExport: false,
    canManageUsers: false,
  },
};
```

---

## PHASE 8: Testing & Validation

### Step 8.1: Build Verification

```bash
# Run TypeScript compilation check
npm run build

# Fix any TypeScript errors before proceeding
```

### Step 8.2: Manual Testing Checklist

Run the development server and test:

```bash
npm run dev
```

**Test Cases**:

1. **Page Access**:
   - [ ] Page loads at `/dashboard/pipeline`
   - [ ] Sidebar shows "Open Pipeline" link for admin/manager/sgm
   - [ ] Sidebar hides "Open Pipeline" for sga/viewer roles

2. **Scorecards**:
   - [ ] Total AUM displays (should be ~$12.5B)
   - [ ] Advisor count displays (should be ~109)
   - [ ] Tooltip appears on hover

3. **Stage Filter**:
   - [ ] Default stages are pre-selected (Qualifying, Discovery, Sales Process, Negotiating)
   - [ ] Can toggle additional stages (Signed, On Hold, Planned Nurture)
   - [ ] Reset button works
   - [ ] Chart updates when stages change

4. **Bar Chart**:
   - [ ] Shows both AUM and Advisor count bars
   - [ ] Bars are clickable
   - [ ] Tooltip shows values on hover
   - [ ] Legend displays correctly

5. **Drill-Down Modal**:
   - [ ] Opens when clicking a bar
   - [ ] Shows correct stage name in title
   - [ ] Displays records for that stage
   - [ ] Records can be clicked

6. **Record Detail Modal**:
   - [ ] Opens when clicking a record
   - [ ] Shows all record details
   - [ ] Back button returns to drill-down
   - [ ] Close button works

### Step 8.3: Data Validation

**Run this BigQuery query to validate totals**:

```sql
SELECT
  SUM(CASE WHEN is_primary_opp_record = 1 THEN COALESCE(Opportunity_AUM, 0) ELSE 0 END) as total_aum,
  COUNT(DISTINCT Full_Opportunity_ID__c) as advisor_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND is_sqo_unique = 1;
```

**Expected**:
- Total AUM: ~$12,500,000,000 ($12.5B)
- Advisor count: 109

**Compare with page display** - values should match.

---

## PHASE 9: Final Cleanup

### Step 9.1: Code Review Checklist

- [ ] All new files have proper TypeScript types
- [ ] No `any` types used unnecessarily
- [ ] Error handling in all API calls
- [ ] Loading states for all async operations
- [ ] Dark mode support in all components
- [ ] Consistent code style with existing codebase

### Step 9.2: Remove Debug Code

- [ ] Remove any `console.log` statements added during development
- [ ] Remove any TODO comments that were addressed

### Step 9.3: Documentation

**Update** `docs/ARCHITECTURE.md` if needed:

```markdown
### Open Pipeline Page

**Route**: `/dashboard/pipeline`
**Page ID**: 3
**Access**: admin, manager, sgm

**Features**:
- Total AUM and advisor count scorecards
- Stage filter (customizable pipeline stages)
- Side-by-side bar chart (AUM and advisor count by stage)
- Click-through to drill-down modal
- Record detail modal integration

**API Routes**:
- POST `/api/dashboard/pipeline-summary` - Get summary and by-stage breakdown
- POST `/api/dashboard/pipeline-drilldown` - Get records for a specific stage
```

---

## Summary: Files Created/Modified

### New Files
1. `src/app/dashboard/pipeline/page.tsx` - Main page component
2. `src/app/api/dashboard/pipeline-summary/route.ts` - Summary API
3. `src/app/api/dashboard/pipeline-drilldown/route.ts` - Drill-down API
4. `src/app/api/dashboard/pipeline-sgm-options/route.ts` - SGM options API (Enhancement)
5. `src/components/dashboard/PipelineByStageChart.tsx` - Bar chart
6. `src/components/dashboard/PipelineFilters.tsx` - Combined stage + SGM filter (replaces PipelineStageFilter)
7. `src/components/dashboard/PipelineScorecard.tsx` - Scorecards
8. `src/components/dashboard/PipelineExportPng.tsx` - PNG export button (Enhancement)

### Modified Files
1. `src/lib/queries/open-pipeline.ts` - Fixed aggregations, added new function, added SGM filter support
2. `src/types/dashboard.ts` - Added new types (OpenPipeline types, SgmOption, filter types)
3. `src/lib/api-client.ts` - Added API client methods (getPipelineSgmOptions, updated signatures)
4. `src/components/layout/Sidebar.tsx` - Added pipeline page
5. `src/lib/permissions.ts` - Ensured page 3 permissions

### Removed Files (Replaced)
1. `src/components/dashboard/PipelineStageFilter.tsx` - Replaced by `PipelineFilters.tsx` (if created in original plan)

---

## Validation Targets

| Metric | Expected | Source |
|--------|----------|--------|
| Total AUM | $12.5B | Looker export |
| Advisor Count | 109 | Looker export |
| Default Stages | Qualifying, Discovery, Sales Process, Negotiating | OPEN_PIPELINE_STAGES constant |

---

---

## Validation Log

**Validated By**: Cursor.ai  
**Validation Date**: January 2026  
**Final Review Applied**: January 2026 (5 additional fixes)

### Pre-Execution Fixes Applied (Final Review)

| Issue | Priority | Status | Fix Applied |
|-------|----------|--------|-------------|
| Issue 1: Missing optional chaining in API routes | HIGH | ✅ Fixed | Changed `permissions.allowedPages.includes(3)` → `permissions.allowedPages?.includes(3)` in Phase 3.1 and 3.2 (later removed entirely) |
| Issue 2: Duplicate Target icon | LOW | ✅ Fixed | Changed Open Pipeline icon from `Target` to `TrendingUp` in Phase 7.1 |
| Issue 3: Missing explicit imports | MEDIUM | ✅ Fixed | Added import block note at beginning of Phase 1.2 |
| Issue 4: RawDetailRecordResult verification | MEDIUM | ✅ Verified | Confirmed `is_primary_opp_record` field exists (line 92) - no changes needed |
| Issue 5: VolumeDrillDownModal props | MEDIUM | ✅ Verified | Confirmed all props match usage - no changes needed |

### Changes Made

| Section | Issue Found | Correction Made |
|---------|-------------|-----------------|
| Phase 1.1 | Query missing table alias `v.` prefix | Added `v.` prefix to all column references in query |
| Phase 1.1 | Unnecessary LEFT JOIN | Removed LEFT JOIN with MAPPING_TABLE from summary query (not needed for summary) |
| Phase 1.2 | Using `RawOpenPipelineResult` type incorrectly | Changed to `RawDetailRecordResult` which matches actual query structure |
| Phase 1.2 | Query missing table alias | Added `v.` prefix to all column references in WHERE clause |
| Phase 1.2 | Missing date fields in query | Added all required date fields matching `getOpenPipelineRecords` pattern |
| Phase 1.2 | Date extraction logic incomplete | Added proper `extractDate` helper matching existing pattern in `getOpenPipelineRecords` |
| Phase 3.1 | Missing null check for `allowedPages` | Added optional chaining: `permissions.allowedPages?.includes(3)` (later removed - all users have access) |
| Phase 4.1 | API client structure unclear | Added note that `dashboardApi` is an object with methods, not a class |
| Phase 5.2 | Dark mode prop not needed | Removed `isDark` prop, use `useTheme` hook inside component instead |
| Phase 6.1 | Incorrect import for `getSessionPermissions` | Changed from `@/lib/permissions` to `@/types/auth` (verified in codebase) |
| Phase 6.1 | Dark mode detection pattern incorrect | Changed to use `useTheme` from `next-themes` matching existing chart components |
| Phase 6.1 | Drill-down modal implementation too complex | Changed to reuse existing `VolumeDrillDownModal` component |
| Phase 6.1 | Removed unused `X` import | Removed `X` from lucide-react imports (not needed with VolumeDrillDownModal) |
| Phase 7.2 | Page 3 not in permissions | Updated to add page 3 to ALL roles (admin, manager, sgm, sga, viewer) - all users get access |
| Phase 4.1 | Missing getPipelineSgmOptions method | Added `getPipelineSgmOptions` method to API client |
| Phase 4.1 | getPipelineSummary missing sgms parameter | Updated signature to accept `sgms?: string[]` as second parameter |
| Phase 4.2 | Missing SgmOption import | Added `SgmOption` to type imports |
| Phase 2.5.1 | Permission check removed | Removed page 3 permission check - all authenticated users can access |
| Phase 3.1 | Permission check removed | Removed page 3 permission check - all authenticated users can access |
| Phase 3.1 | Permission-based SGM filter removed | Removed sgmFilter override - all users see all data based on their filter selections |
| Phase 3.2 | Permission check removed | Removed page 3 permission check - all authenticated users can access |
| Phase 3.2 | Permission-based filters removed | Removed sgaFilter and sgmFilter overrides - all users see all data based on their filter selections |
| Phase 6.1 | Permission check removed | Removed page 3 permission check - all authenticated users can access |
| Phase 7.1 | Icon and position updated | Changed icon to `Layers`, positioned between Funnel Performance and Explore |
| Phase 7.2 | Page 3 added to ALL roles | Added page 3 to admin, manager, sgm, sga, and viewer roles |

### Files Verified Against Codebase

- [x] `src/lib/queries/open-pipeline.ts` - Verified function signatures, imports, query structure, date extraction pattern
- [x] `src/lib/api-client.ts` - Verified API client structure (object with methods), existing `getOpenPipeline` method
- [x] `src/app/api/dashboard/open-pipeline/route.ts` - Verified API route pattern, authentication, permissions
- [x] `src/components/dashboard/DetailRecordsTable.tsx` - Verified props interface (`onRecordClick`, `canExport`, `metricFilter`)
- [x] `src/components/dashboard/RecordDetailModal.tsx` - Verified props interface (`showBackButton`, `onBack`, `backButtonLabel`)
- [x] `src/components/dashboard/VolumeDrillDownModal.tsx` - Verified exists, supports `openPipeline` metricFilter, can be reused
- [x] `src/components/dashboard/Scorecards.tsx` - Verified scorecard pattern, Tremor imports
- [x] `src/components/dashboard/OpenPipelineAumTooltip.tsx` - Verified exists and can be reused
- [x] `src/config/constants.ts` - Verified OPEN_PIPELINE_STAGES values, RECRUITING_RECORD_TYPE, table names
- [x] `src/lib/cache.ts` - Verified cachedQuery pattern, CACHE_TAGS.DASHBOARD, TTL values
- [x] `src/lib/permissions.ts` - Verified ROLE_PERMISSIONS structure (page 3 NOT currently included - must be added)
- [x] `src/lib/auth.ts` - Verified authOptions export path
- [x] `src/types/auth.ts` - Verified getSessionPermissions function and import path
- [x] `src/types/dashboard.ts` - Verified DetailRecord type structure
- [x] `src/types/bigquery-raw.ts` - Verified RawDetailRecordResult structure (not RawOpenPipelineResult for drill-down)
- [x] `src/components/layout/Sidebar.tsx` - Verified PAGES array structure, icon imports
- [x] `src/components/dashboard/VolumeTrendChart.tsx` - Verified dark mode pattern (`useTheme` from `next-themes`)
- [x] `src/lib/utils/date-helpers.ts` - Verified formatCurrency function signature and import path
- [x] `src/lib/bigquery.ts` - Verified runQuery function signature
- [x] `src/app/dashboard/page.tsx` - Verified page structure pattern, state management, imports

### Key Findings

1. **Query Function Fix Required**: `_getOpenPipelineSummary` currently uses `COUNT(*)` and `SUM(Opportunity_AUM)` - needs to be fixed to use `COUNT(DISTINCT Full_Opportunity_ID__c)` and `SUM(CASE WHEN is_primary_opp_record = 1 THEN Opportunity_AUM ELSE 0 END)`

2. **Permissions Update Required**: Page ID 3 must be manually added to `ROLE_PERMISSIONS` in `src/lib/permissions.ts` for ALL roles (admin, manager, sgm, sga, viewer) - see Phase 7.2. **Note**: Permission checks have been removed from API routes - all authenticated users can access the data.

3. **Component Reuse**: `VolumeDrillDownModal` already exists and supports `openPipeline` metricFilter - should be reused instead of creating custom modal

4. **Dark Mode Pattern**: Existing charts use `useTheme` from `next-themes`, not manual DOM checking

5. **Type Compatibility**: `RawOpenPipelineResult` exists but only has `open_pipeline_aum` field. For drill-down queries, use `RawDetailRecordResult` instead

6. **Date Extraction**: Must use the same `extractDate` helper pattern as `getOpenPipelineRecords` to handle both DATE and TIMESTAMP types

### Access Control Changes

**IMPORTANT**: Permission restrictions have been removed from all API routes and the page component. All authenticated users can access the Open Pipeline page and its data.

**Data Access**: All users see the same data - no permission-based filtering (SGA/SGM restrictions removed). Users can filter data using the UI filters, but there are no automatic restrictions based on their role.

**Permissions Update**: Page ID 3 has been added to ALL roles (admin, manager, sgm, sga, viewer) in Phase 7.2 to ensure all users can see the page in the sidebar.

### Confidence Level

**HIGH** - All file paths, imports, function signatures, and component props have been verified against the actual codebase. The implementation guide should work correctly when executed, with the following prerequisites:

1. Page ID 3 must be added to permissions for ALL roles (manual step in Phase 7.2) - **ALL USERS GET ACCESS**
2. Query function fix must be applied (Phase 1.1)
3. All imports match actual codebase structure
4. No permission restrictions - all authenticated users have access

---

---

## ENHANCEMENTS INTEGRATED (v2.0)

This implementation guide has been enhanced with the following features from `Open_Pipeline_Enhancement_Addendum_v2.md`:

### Enhancement 1: Global Filters Panel ✅
- **Collapsible filter panel** with summary badges in header
- **Stage multi-select checkboxes** (defaults to Open Pipeline stages)
- **SGM multi-select checkboxes** (defaults to all SGMs selected)
- Quick actions: "Open Pipeline", "All Stages", "Active Only", "All SGMs"
- SGM search functionality
- Reset button when filters differ from defaults
- "(Modified)" indicator when custom filters are applied

### Enhancement 2: PNG Export ✅
- **PNG export button** in chart card header
- Uses existing `html-to-image` library (already installed)
- High-quality export (pixelRatio: 2)
- Filename includes date timestamp
- Disabled during loading or when no data

### Implementation Details

**New API Endpoint**:
- `GET /api/dashboard/pipeline-sgm-options` - Fetches SGM options with active status

**Updated Query Functions**:
- `_getOpenPipelineSummary` now accepts `sgms?: string[]` filter
- `_getOpenPipelineRecordsByStage` now accepts `sgms?: string[]` filter

**Updated API Routes**:
- `pipeline-summary` accepts `sgms` in request body
- `pipeline-drilldown` accepts `sgms` in request body

**New Components**:
- `PipelineFilters.tsx` - Replaces `PipelineStageFilter.tsx` with enhanced functionality
- `PipelineExportPng.tsx` - PNG export button component

**Updated Page**:
- Fetches SGM options on mount
- Defaults to all SGMs selected
- Passes SGM filter to summary and drill-down queries
- Integrates filters and export button into UI

### Validation Notes

✅ **BigQuery Validation**: SGM query verified - joins with `User` table to get `IsActive` status  
✅ **Library Verification**: `html-to-image` confirmed installed in `package.json`  
✅ **Pattern Alignment**: Filter component follows existing `GlobalFilters` and `AdvancedFilters` patterns  
✅ **Type Safety**: All new types added to `dashboard.ts`, matching existing `FilterOption` pattern

---

*Implementation Guide Version: 2.3*  
*Last Updated: January 2026*  
*Validated: January 2026*  
*Final Review Fixes Applied: January 2026*  
*Enhancements Integrated: January 2026*  
*Critical API Client Fix Applied: January 2026*  
*Permission Restrictions Removed: January 2026*  
*All Users Granted Access: January 2026*  
*Permission-Based Data Filtering Removed: January 2026*  
*Status: READY FOR EXECUTION*
