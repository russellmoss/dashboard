# Open Pipeline Page - Enhancement Addendum v2

## Purpose
This document provides step-by-step instructions for Cursor.ai to enhance the existing `Open_Pipeline_Implementation_Guide.md` with:

1. **Global Filters Panel** - Collapsible filter panel with:
   - Stage multi-select checkboxes (defaults to Open Pipeline stages)
   - SGM multi-select checkboxes (defaults to all SGMs selected)
2. **PNG Export** - Export chart as image using existing `html-to-image` library

---

## Pre-Enhancement Checklist

Before starting, verify these exist in the codebase:

```bash
# Verify html-to-image is installed (used for PNG export)
npm list html-to-image

# Verify existing filter patterns
ls src/components/dashboard/GlobalFilters.tsx
ls src/components/dashboard/AdvancedFilters.tsx

# Verify ExportMenu component exists
ls src/components/dashboard/ExportMenu.tsx
```

---

## ENHANCEMENT 1: Add Types for Pipeline Filters

### Step E1.1: Add Pipeline Filter Types

**File**: `src/types/dashboard.ts`

**Add these interfaces** (after the existing `OpenPipelineSummary` interface added in Phase 2):

```typescript
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

/**
 * SGM option with active status
 */
export interface SgmOption {
  value: string;
  label: string;
  isActive: boolean;
}

/**
 * Default pipeline page filters
 */
export const DEFAULT_PIPELINE_FILTERS: PipelinePageFilters = {
  stages: {
    selectAll: false, // Not all stages, just open pipeline stages
    selected: [], // Will be populated with OPEN_PIPELINE_STAGES
  },
  sgms: {
    selectAll: true, // All SGMs selected by default
    selected: [],
  },
};
```

---

## ENHANCEMENT 2: Create SGM Options API Endpoint

### Step E2.1: Create SGM Options Route

**Create new file**: `src/app/api/dashboard/pipeline-sgm-options/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { runQuery } from '@/lib/bigquery';
import { FULL_TABLE, RECRUITING_RECORD_TYPE, OPEN_PIPELINE_STAGES } from '@/config/constants';

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
    
    // Check if user can access pipeline page (page ID 3)
    if (!permissions.allowedPages?.includes(3)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
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
      WHERE v.SGM_Owner_Name__c IS NOT NULL
        AND v.recordtypeid = @recruitingRecordType
        AND v.StageName IN (${stageParams.join(', ')})
        AND v.is_sqo_unique = 1
      ORDER BY v.SGM_Owner_Name__c
    `;
    
    const results = await runQuery<RawSgmResult>(query, params);
    
    const sgmOptions = results
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

## ENHANCEMENT 3: Update Pipeline Summary API to Accept Filters

### Step E3.1: Update Pipeline Summary Route

**File**: `src/app/api/dashboard/pipeline-summary/route.ts`

**Update the POST handler** to accept both stages and sgms filters:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getOpenPipelineSummary } from '@/lib/queries/open-pipeline';
import { formatCurrency } from '@/lib/utils/date-helpers';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Check if user can access pipeline page (page ID 3)
    if (!permissions.allowedPages?.includes(3)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await request.json();
    const { stages, sgms } = body;
    
    // Apply permission-based SGM filter if user has sgmFilter restriction
    let effectiveSgms = sgms;
    if (permissions.sgmFilter) {
      // User is restricted to specific SGM
      effectiveSgms = [permissions.sgmFilter];
    }
    
    const summary = await getOpenPipelineSummary({ stages, sgms: effectiveSgms });
    
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

---

## ENHANCEMENT 4: Update Query Function to Accept SGM Filter

### Step E4.1: Update getOpenPipelineSummary Function

**File**: `src/lib/queries/open-pipeline.ts`

**Replace the `_getOpenPipelineSummary` function** (from Phase 1.1) with this enhanced version:

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

### Step E4.2: Update getOpenPipelineRecordsByStage for SGM Filter

**File**: `src/lib/queries/open-pipeline.ts`

**Update the filters parameter** in `_getOpenPipelineRecordsByStage`:

Find:
```typescript
const _getOpenPipelineRecordsByStage = async (
  stage: string,
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string }
): Promise<DetailRecord[]> => {
```

Replace with:
```typescript
const _getOpenPipelineRecordsByStage = async (
  stage: string,
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string; sgms?: string[] }
): Promise<DetailRecord[]> => {
```

**Add SGMs array filter** after the existing `sgm` filter:

Find:
```typescript
  if (filters?.sgm) {
    conditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }
```

Add after it:
```typescript
  // Handle array of SGMs (from multi-select filter)
  if (filters?.sgms && filters.sgms.length > 0 && !filters?.sgm) {
    const sgmParams = filters.sgms.map((_, i) => `@sgmFilter${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgmFilter${i}`] = sgm;
    });
  }
```

---

## ENHANCEMENT 5: Update API Client

### Step E5.1: Add SGM Options Method

**File**: `src/lib/api-client.ts`

**Add this method** to the `dashboardApi` object:

```typescript
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
```

### Step E5.2: Update getPipelineSummary Signature

**File**: `src/lib/api-client.ts`

**Update the existing method**:

Find:
```typescript
getPipelineSummary: async (stages?: string[]): Promise<OpenPipelineSummary> => {
  const response = await fetch('/api/dashboard/pipeline-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stages }),
  });
```

Replace with:
```typescript
getPipelineSummary: async (stages?: string[], sgms?: string[]): Promise<OpenPipelineSummary> => {
  const response = await fetch('/api/dashboard/pipeline-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stages, sgms }),
  });
```

### Step E5.3: Update getPipelineDrilldown Signature

**File**: `src/lib/api-client.ts`

**Update the existing method**:

Find:
```typescript
getPipelineDrilldown: async (
  stage: string,
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string }
): Promise<{ records: DetailRecord[]; stage: string }> => {
  const response = await fetch('/api/dashboard/pipeline-drilldown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, filters }),
  });
```

Replace with:
```typescript
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
```

### Step E5.4: Add Type Import

**File**: `src/lib/api-client.ts`

**Add to imports**:

```typescript
import { 
  // ... existing imports
  SgmOption,
} from '@/types/dashboard';
```

---

## ENHANCEMENT 6: Create Pipeline Filters Component

### Step E6.1: Create the Filters Component

**Replace** `src/components/dashboard/PipelineStageFilter.tsx` **with** `src/components/dashboard/PipelineFilters.tsx`:

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

---

## ENHANCEMENT 7: Create PNG Export Button Component

### Step E7.1: Create Simple PNG Export Button

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

---

## ENHANCEMENT 8: Update Pipeline Page

### Step E8.1: Update Page with Filters and Export

**File**: `src/app/dashboard/pipeline/page.tsx`

**Replace the entire file** with the version from the original implementation guide, but with these key changes:

1. Import the new components:
```typescript
import { PipelineFilters } from '@/components/dashboard/PipelineFilters';
import { PipelineExportPng } from '@/components/dashboard/PipelineExportPng';
```

2. Add SGM state and fetching:
```typescript
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
```

3. Update fetchData to use SGM filter:
```typescript
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
```

4. Add the Filters component:
```typescript
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
```

5. Add chart wrapper with ID and export button:
```typescript
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
```

---

## ENHANCEMENT 9: Update Pipeline Drilldown API

### Step E9.1: Update Drilldown Route to Accept SGMs

**File**: `src/app/api/dashboard/pipeline-drilldown/route.ts`

**Update the route** to handle SGMs array (add `sgms` to body destructuring and pass to filters):

```typescript
const body = await request.json();
const { stage, filters, sgms } = body;

// In the filters application section:
if (permissions.sgmFilter) {
  pipelineFilters.sgm = permissions.sgmFilter;
} else if (sgms && sgms.length > 0) {
  pipelineFilters.sgms = sgms;
}
```

---

## Summary: Files to Create/Modify

### New Files (Create)
| File | Purpose |
|------|---------|
| `src/app/api/dashboard/pipeline-sgm-options/route.ts` | API to fetch SGM options |
| `src/components/dashboard/PipelineFilters.tsx` | Combined stage + SGM filter component |
| `src/components/dashboard/PipelineExportPng.tsx` | PNG export button |

### Modified Files (Update)
| File | Changes |
|------|---------|
| `src/types/dashboard.ts` | Add filter types (`SgmOption`, etc.) |
| `src/lib/queries/open-pipeline.ts` | Add SGMs filter support |
| `src/lib/api-client.ts` | Add `getPipelineSgmOptions`, update signatures |
| `src/app/api/dashboard/pipeline-summary/route.ts` | Accept SGMs filter |
| `src/app/api/dashboard/pipeline-drilldown/route.ts` | Accept SGMs filter |
| `src/app/dashboard/pipeline/page.tsx` | Use new filters and export |

### Removed Files (Delete)
| File | Reason |
|------|--------|
| `src/components/dashboard/PipelineStageFilter.tsx` | Replaced by `PipelineFilters.tsx` |

---

## Testing Checklist

### Filter Functionality
- [ ] Filters panel is collapsed by default with summary badges
- [ ] Click expands to show Stage and SGM filters
- [ ] Stage checkboxes work (can select any combination)
- [ ] Cannot deselect ALL stages (at least 1 required)
- [ ] "Open Pipeline" quick action selects default 4 stages
- [ ] "All Stages" quick action selects all 7 stages
- [ ] SGM checkboxes work (can select any combination)
- [ ] Cannot deselect ALL SGMs (at least 1 required)
- [ ] "Active Only" quick action selects only active SGMs
- [ ] "All SGMs" quick action selects all SGMs
- [ ] SGM search filters the list
- [ ] Reset button restores defaults
- [ ] "(Modified)" indicator shows when filters differ from defaults
- [ ] Chart updates when filters change
- [ ] Scorecards update when filters change

### PNG Export
- [ ] Export PNG button visible in chart card header
- [ ] Button disabled while chart is loading
- [ ] Button disabled when no data
- [ ] Clicking triggers PNG download
- [ ] PNG filename includes date
- [ ] PNG quality is good (high resolution)
- [ ] PNG includes axes, bars, legend

### Data Validation
- [ ] Default filters show ~$12.5B AUM, 109 advisors
- [ ] Filtering by single SGM shows subset
- [ ] Adding extended stages (Signed, On Hold) changes totals
- [ ] Drill-down respects active SGM filter

---

## BigQuery Validation Query

Run this to verify SGM filtering:

```sql
-- List SGMs in open pipeline with counts
SELECT
  SGM_Owner_Name__c as sgm,
  COUNT(DISTINCT Full_Opportunity_ID__c) as advisor_count,
  SUM(CASE WHEN is_primary_opp_record = 1 THEN COALESCE(Opportunity_AUM, 0) ELSE 0 END) as total_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND is_sqo_unique = 1
  AND SGM_Owner_Name__c IS NOT NULL
GROUP BY SGM_Owner_Name__c
ORDER BY total_aum DESC;
```

---

*Enhancement Addendum Version: 2.0*
*Created: January 2026*
