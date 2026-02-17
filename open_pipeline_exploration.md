# Open Pipeline by SGM — Feature Exploration & Knowledge Base

> **Feature**: Stacked bar chart tab on the Open Pipeline page showing AUM by SGM, segmented by opportunity stage
> **Date**: 2026-02-17
> **Status**: ✅ Investigation Complete — Verified Against Codebase — Ready for Implementation

---

## Table of Contents

1. [Feature Requirements Summary](#1-feature-requirements-summary)
2. [Phase 1: Existing Infrastructure Inventory](#2-phase-1-existing-infrastructure-inventory)
3. [Phase 2: Data Layer Investigation](#3-phase-2-data-layer-investigation)
4. [Phase 3: UI Component Architecture](#4-phase-3-ui-component-architecture)
5. [Phase 4: Permission & Access Control](#5-phase-4-permission--access-control)
6. [Phase 5: Drill-Down Behavior Specification](#6-phase-5-drill-down-behavior-specification)
7. [Phase 6: Implementation Plan](#7-phase-6-implementation-plan)
8. [Gap Analysis & Open Questions](#8-gap-analysis--open-questions) *(Added after verification)*

---

## 1. Feature Requirements Summary

### Core Feature
A new **tab** on the Open Pipeline page (`/dashboard/pipeline`) that shows a **stacked bar chart**:
- **X-axis**: SGM names (Strategic Growth Managers)
- **Y-axis**: Opportunity AUM in millions
- **Bar segments**: Stacked by opportunity stage, color-coded
- **Sort**: Left-to-right by total pipeline AUM (highest → lowest)

### Stage Stack Order (bottom → top)
1. Planned Nurture (bottom)
2. Qualifying
3. Discovery
4. Sales Process
5. Negotiating
6. Signed
7. On Hold (top)

> **Note**: Not all stages will appear by default. The chart respects the same stage filters as the existing pipeline page. Default = `OPEN_PIPELINE_STAGES` (Qualifying, Discovery, Sales Process, Negotiating). If a user applies filters to include Signed, On Hold, or Planned Nurture, those segments appear in the chart per the ordering above.

### Drill-Down Interactions
1. **Click a stage segment** within an SGM's bar → Drill down to records for that **specific SGM + specific stage**
2. **Click an SGM name** on the x-axis → Drill down to **all open records for that SGM** across all currently selected stages

### Filter Behavior
- Shares the **same `PipelineFilters` component** as the existing "By Stage" tab (stage multi-select + SGM multi-select)
- Filter state is shared between tabs — switching tabs preserves filters
- Defaults match current open pipeline defaults: `OPEN_PIPELINE_STAGES` + all SGMs

### Access Control
- The "By SGM" tab is **only visible to `revops_admin` role**
- All other roles see only the existing "By Stage" view (no tab UI shown)
- API endpoint for by-SGM data should also enforce `revops_admin` check

---

## 2. Phase 1: Existing Infrastructure Inventory

### 2.1 — What is the current pipeline page structure?

**Question**: What components make up the pipeline page, and how is state managed?

**Finding**: ✅ VERIFIED (with minor corrections below)

**File**: `src/app/dashboard/pipeline/page.tsx` (client component)

**All imports at top of file**:
```typescript
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
```

**Current component tree**: ⚠️ CORRECTED
```
Pipeline Page
├── <Title> + <Text> (header)
├── <PipelineScorecard> (total AUM + advisor count, with onAumClick/onAdvisorsClick)
├── <PipelineFilters> (stage + SGM multi-select)
├── <Card>
│   ├── Header with <Text> + <PipelineExportPng>
│   └── <div id="pipeline-by-stage-chart"> containing <PipelineByStageChart>
├── <VolumeDrillDownModal> (drill-down modal, NOT DetailRecordsTable directly)
└── <RecordDetailModal> (opens on row click within drill-down)
```

**Session and permissions access**: ⚠️ CORRECTED
```typescript
// Line 23-24 — actual code (NOT useSession({ required: true }))
const { data: session, status } = useSession();
const permissions = getSessionPermissions(session);
```

**Dark mode hook** (also used):
```typescript
// Line 73
const { resolvedTheme } = useTheme();
```

**State variables on the page**: ✅ VERIFIED — exact matches
```typescript
// Data state (lines 27-29)
const [summary, setSummary] = useState<OpenPipelineSummary | null>(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState<string | null>(null);

// SGM options state (lines 32-33)
const [sgmOptions, setSgmOptions] = useState<SgmOption[]>([]);
const [sgmOptionsLoading, setSgmOptionsLoading] = useState(true);

// Filter state - defaults (lines 36-37)
const [selectedStages, setSelectedStages] = useState<string[]>([...OPEN_PIPELINE_STAGES]);
const [selectedSgms, setSelectedSgms] = useState<string[]>([]);

// Drill-down modal state (lines 63-67)
const [drillDownOpen, setDrillDownOpen] = useState(false);
const [drillDownRecords, setDrillDownRecords] = useState<DetailRecord[]>([]);
const [drillDownLoading, setDrillDownLoading] = useState(false);
const [drillDownStage, setDrillDownStage] = useState<string | null>(null);
const [drillDownMetric, setDrillDownMetric] = useState<'aum' | 'count' | null>(null);

// Record detail modal state (line 70)
const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
```

**Permission/role check on page**: ✅ VERIFIED — None exists
```typescript
// Line 236 confirms:
// Note: Permission check removed - all authenticated users can access the pipeline page
```

**Key observation**: Filter state, drill-down state, and scorecard are all at the page level. The new tab can share all of this — we just need to conditionally render a different chart component based on the active tab.

### 2.2 — What chart library is in use?

**Question**: What chart library renders the current pipeline chart, and does it support stacked bars?

**Finding**: ⚠️ CORRECTED

**Library versions** (from package.json):
- `"recharts": "^3.6.0"` — ⚠️ NOT v2.15.4 as originally stated
- `"@tremor/react": "^3.18.7"`

**Import path**: Recharts is imported **DIRECTLY** from 'recharts', NOT bundled via Tremor:
```typescript
// src/components/dashboard/PipelineByStageChart.tsx lines 5-17
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
  LabelList,
  ReferenceLine,  // imported but not currently used
} from 'recharts';
```

**Current chart**: `src/components/dashboard/PipelineByStageChart.tsx`
- ✅ Uses `<BarChart>`, `<Bar>`, `<Cell>`, `<XAxis>`, `<YAxis>`, `<Tooltip>`, `<Legend>`, `<LabelList>`
- ✅ Also uses `<CartesianGrid>`, `<ResponsiveContainer>` (missing from original doc)
- ✅ Dual y-axes (AUM left `yAxisId="aum"`, Advisors right `yAxisId="count"`)
- ✅ Custom tooltip component (`CustomTooltip`)
- ✅ Click handlers on `<Bar>` via `onClick` prop
- ✅ Dark mode support via `useTheme()` from 'next-themes'

**Recharts v3 stacked bar support**: ✅ Native support confirmed. Adding `stackId="someId"` to multiple `<Bar>` components creates a stacked bar chart. Each `<Bar>` represents one stack segment.

**Example pattern**:
```tsx
<BarChart data={data}>
  <Bar dataKey="qualifying" stackId="stack" fill="#color1" />
  <Bar dataKey="discovery" stackId="stack" fill="#color2" />
  <Bar dataKey="salesProcess" stackId="stack" fill="#color3" />
  <Bar dataKey="negotiating" stackId="stack" fill="#color4" />
</BarChart>
```

**Note**: Current chart does NOT use `stackId` — it renders grouped bars (AUM and Advisors side-by-side), not stacked.

### 2.3 — What API endpoints serve the current pipeline page?

**Question**: What API routes does the pipeline page call, and what query functions back them?

**Finding**: ✅ VERIFIED (with corrections)

| Endpoint | Method | Purpose | Query Function |
|----------|--------|---------|----------------|
| `/api/dashboard/pipeline-sgm-options` | GET | Fetch SGM list for filter dropdown | ⚠️ **Inline SQL in route** (no separate query function) |
| `/api/dashboard/pipeline-summary` | POST | Fetch by-stage summary (count + AUM) | `getOpenPipelineSummary({ stages, sgms })` ✅ |
| `/api/dashboard/pipeline-drilldown` | POST | Fetch records for a specific stage | `getOpenPipelineRecordsByStage(stage, pipelineFilters)` ✅ |

**Client-side calls** (from `src/lib/api-client.ts` lines 320-379):
```typescript
// Line 320-332
getPipelineSgmOptions: async (): Promise<{ sgmOptions: SgmOption[] }> => {
  const response = await fetch('/api/dashboard/pipeline-sgm-options', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  // ...
  return response.json();
},

// Line 337-350
getPipelineSummary: async (stages?: string[], sgms?: string[]): Promise<OpenPipelineSummary> => {
  const response = await fetch('/api/dashboard/pipeline-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stages, sgms }),
  });
  // ...
  return response.json();
},

// Line 355-379
getPipelineDrilldown: async (
  stage: string,
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string },
  sgms?: string[]
): Promise<{ records: DetailRecord[]; stage: string }> => {
  const cleanFiltersObj = filters ? {
    channel: filters.channel,
    source: filters.source,
    sga: filters.sga,
    sgm: filters.sgm,
  } : undefined;
  const response = await fetch('/api/dashboard/pipeline-drilldown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stage, filters: cleanFiltersObj, sgms }),
  });
  // ...
  return response.json();
},
```

**API Route Auth Pattern** (same across all three routes):
```typescript
// From pipeline-summary/route.ts lines 14-30
const session = await getServerSession(authOptions);

if (!session?.user?.email) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const permissions = getSessionPermissions(session);
if (!permissions) {
  return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
}

const forbidden = forbidRecruiter(permissions);
if (forbidden) return forbidden;

const cpForbidden = forbidCapitalPartner(permissions);
if (cpForbidden) return cpForbidden;
```

### 2.4 — What does the existing query return?

**Question**: What does `getOpenPipelineSummary` query and return?

**Finding**: ✅ VERIFIED

**File**: `src/lib/queries/open-pipeline.ts`

**Imports at top of file** (lines 1-6):
```typescript
import { runQuery, buildQueryParams } from '../bigquery';
import { DetailRecord } from '@/types/dashboard';
import { formatCurrency } from '../utils/date-helpers';
import { RawDetailRecordResult, RawOpenPipelineResult, toNumber, toString } from '@/types/bigquery-raw';
import { FULL_TABLE, OPEN_PIPELINE_STAGES, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
```

**Function signature** (lines 159-165):
```typescript
const _getOpenPipelineSummary = async (
  filters?: { stages?: string[]; sgms?: string[] }
): Promise<{
  totalAum: number;
  recordCount: number;
  byStage: { stage: string; count: number; aum: number }[];
}>
```

**Actual SQL** (lines 197-216):
```sql
SELECT
  v.StageName as stage,
  COUNT(DISTINCT v.Full_Opportunity_ID__c) as count,
  SUM(CASE WHEN v.is_primary_opp_record = 1 THEN COALESCE(v.Opportunity_AUM, 0) ELSE 0 END) as aum
FROM `${FULL_TABLE}` v
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
```

**WHERE clause construction** (lines 166-195):
```typescript
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
```

**cachedQuery wrapper pattern** (lines 243-247):
```typescript
export const getOpenPipelineSummary = cachedQuery(
  _getOpenPipelineSummary,
  'getOpenPipelineSummary',
  CACHE_TAGS.DASHBOARD
);
```

**Return shape**: `{ totalAum, recordCount, byStage: [{ stage, count, aum }] }` ✅

**Key filters applied**:
- `recordtypeid = @recruitingRecordType` (Recruiting only) ✅
- `is_sqo_unique = 1` (SQO-qualified only, deduplicated) ✅
- `is_primary_opp_record = 1` for AUM summation (one AUM per opportunity) ✅
- Stage filter from user selection (parameterized) ✅
- SGM filter from user selection (optional, parameterized) ✅

### 2.5 — What tab patterns exist in the codebase?

**Question**: Do any existing pages use a tab UI, and what component/pattern do they use?

**Finding**:

The codebase uses client-side tab state with conditional rendering. No formal `<Tabs>` component from Tremor is imported on the pipeline page currently.

**Patterns found**:
- SGA Hub uses role-based conditional sections
- GC Hub uses card-based navigation

**For this feature**: A simple `useState<'byStage' | 'bySgm'>` toggle with styled buttons (matching the existing dashboard aesthetic) is the cleanest approach. No new dependency needed.

---

## 3. Phase 2: Data Layer Investigation

### 3.1 — What new query do we need?

**Question**: What SQL query produces the data needed for a stacked bar chart of AUM by SGM × Stage?

**Finding**:

We need a new query function `getOpenPipelineBySgm` that groups by **both** `SGM_Owner_Name__c` and `StageName`:

```sql
SELECT
  v.SGM_Owner_Name__c as sgm,
  v.StageName as stage,
  COUNT(DISTINCT v.Full_Opportunity_ID__c) as count,
  SUM(CASE WHEN v.is_primary_opp_record = 1 THEN COALESCE(v.Opportunity_AUM, 0) ELSE 0 END) as aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.recordtypeid = @recruitingRecordType
  AND v.StageName IN (@stage0, @stage1, ...)
  AND v.is_sqo_unique = 1
  [AND v.SGM_Owner_Name__c IN (...)]  -- if SGM filter applied
GROUP BY v.SGM_Owner_Name__c, v.StageName
ORDER BY v.SGM_Owner_Name__c, v.StageName
```

**Key details**:
- Same filters as existing `getOpenPipelineSummary` (record type, SQO unique, stages, SGMs)
- Same AUM calculation: `COALESCE(v.Opportunity_AUM, 0)` with `is_primary_opp_record = 1`
- Grouping adds `SGM_Owner_Name__c` as additional dimension
- No date filter (open pipeline is a current-state snapshot)

### 3.2 — How should the query results be reshaped for Recharts?

**Question**: Recharts stacked bar expects a specific data shape. What transformation is needed?

**Finding**: ✅ VERIFIED — proposed shape is correct

**Raw query result**: Array of `{ sgm, stage, count, aum }` rows (one row per SGM×Stage combo)

**Recharts stacked bar needs**: One object per x-axis category (SGM), with a key per stack segment (stage):

```typescript
// Target shape for chart (NEW TYPE TO ADD to src/types/dashboard.ts)
interface SgmPipelineChartData {
  sgm: string;
  totalAum: number;           // For sorting left-to-right
  qualifying: number;         // AUM in Qualifying
  discovery: number;          // AUM in Discovery
  salesProcess: number;       // AUM in Sales Process
  negotiating: number;        // AUM in Negotiating
  signed: number;             // AUM in Signed (if filter applied)
  onHold: number;             // AUM in On Hold (if filter applied)
  plannedNurture: number;     // AUM in Planned Nurture (if filter applied)
  // Counts for tooltips
  qualifyingCount: number;
  discoveryCount: number;
  salesProcessCount: number;
  negotiatingCount: number;
  signedCount: number;
  onHoldCount: number;
  plannedNurtureCount: number;
}
```

**Existing related types from `src/types/dashboard.ts`:**

```typescript
// OpenPipelineByStage (lines 208-214) - used by existing chart
export interface OpenPipelineByStage {
  stage: string;
  advisorCount: number;
  totalAum: number;
  aumFormatted: string;
  aumInBillions: number;
}

// OpenPipelineSummary (lines 219-224) - returned by pipeline-summary API
export interface OpenPipelineSummary {
  totalAum: number;
  totalAumFormatted: string;
  advisorCount: number;
  byStage: OpenPipelineByStage[];
}

// SgmOption (lines 238-242) - used for SGM filter dropdown
export interface SgmOption {
  value: string;
  label: string;
  isActive: boolean;
}
```

**Transformation logic** (in the API route or a helper):
```typescript
// Pivot the flat rows into the chart-ready shape
const sgmMap = new Map<string, SgmPipelineChartData>();

for (const row of queryResults) {
  if (!sgmMap.has(row.sgm)) {
    sgmMap.set(row.sgm, { sgm: row.sgm, totalAum: 0, /* all stages: 0 */ });
  }
  const entry = sgmMap.get(row.sgm)!;
  const stageKey = stageToKey(row.stage); // 'Sales Process' → 'salesProcess'
  entry[stageKey] = row.aum;
  entry[`${stageKey}Count`] = row.count;
  entry.totalAum += row.aum;
}

// Sort by totalAum descending
const chartData = [...sgmMap.values()].sort((a, b) => b.totalAum - a.totalAum);
```

### 3.3 — What AUM field does the view use?

**Question**: Which field maps to `Opportunity_AUM` in the BQ view?

**Finding**: ✅ VERIFIED

From `views/vw_funnel_master.sql` (line 292):
```sql
-- AUM
COALESCE(o.Underwritten_AUM__c, o.Amount) AS Opportunity_AUM,
```

Also available (line 426):
```sql
-- AUM in Millions
ROUND(COALESCE(Underwritten_AUM__c, Amount) / 1000000, 2) AS Opportunity_AUM_M,
```

The existing open pipeline query in `open-pipeline.ts` uses `v.Opportunity_AUM` directly (the pre-computed view column). The new query should use the same field to maintain consistency.

**Validated**: This produces $15.44B total AUM matching the current dashboard (confirmed via CSV export comparison on 2026-02-17).

---

### 3.3a — Verified Constants and Type Definitions

**OPEN_PIPELINE_STAGES** (from `src/config/constants.ts` lines 6-11):
```typescript
export const OPEN_PIPELINE_STAGES: readonly string[] = [
  'Qualifying',
  'Discovery',
  'Sales Process',
  'Negotiating'
];
```

**RECRUITING_RECORD_TYPE** (from `src/config/constants.ts` line 13):
```typescript
export const RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI';
```

**FULL_TABLE** (from `src/config/constants.ts` line 16):
```typescript
export const FULL_TABLE = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';
```

**ALL_STAGES** (from `src/components/dashboard/PipelineFilters.tsx` lines 9-17):
```typescript
const ALL_STAGES = [
  { value: 'Qualifying', label: 'Qualifying', isOpenPipeline: true },
  { value: 'Discovery', label: 'Discovery', isOpenPipeline: true },
  { value: 'Sales Process', label: 'Sales Process', isOpenPipeline: true },
  { value: 'Negotiating', label: 'Negotiating', isOpenPipeline: true },
  { value: 'Signed', label: 'Signed', isOpenPipeline: false },
  { value: 'On Hold', label: 'On Hold', isOpenPipeline: false },
  { value: 'Planned Nurture', label: 'Planned Nurture', isOpenPipeline: false },
];
```

**DetailRecord interface** (from `src/types/dashboard.ts` lines 130-170):
```typescript
export interface DetailRecord {
  id: string;
  advisorName: string;
  source: string;
  channel: string;
  stage: string;
  sga: string | null;
  sgm: string | null;
  campaignId: string | null;
  campaignName: string | null;
  leadScoreTier: string | null;
  aum: number;
  aumFormatted: string;
  salesforceUrl: string;
  relevantDate: string;
  contactedDate: string | null;
  mqlDate: string | null;
  sqlDate: string | null;
  sqoDate: string | null;
  joinedDate: string | null;
  signedDate: string | null;
  discoveryDate: string | null;
  salesProcessDate: string | null;
  negotiatingDate: string | null;
  onHoldDate: string | null;
  closedDate: string | null;
  initialCallScheduledDate: string | null;
  qualificationCallDate: string | null;
  isContacted: boolean;
  isMql: boolean;
  isSql: boolean;
  isSqo: boolean;
  isJoined: boolean;
  isOpenPipeline: boolean;
  recordTypeId: string | null;
  isPrimaryOppRecord: boolean;
  opportunityId: string | null;
  prospectSourceType?: string | null;
  originRecruitingOppId?: string | null;
  originOpportunityUrl?: string | null;
}
```

**Note on proposed SgmPipelineChartData**: The proposed type in Section 3.2 does NOT exist yet — it needs to be added to `src/types/dashboard.ts` during implementation.

### 3.4 — Can the existing drill-down query handle SGM + Stage filtering?

**Question**: Can `getOpenPipelineRecordsByStage` accept both an SGM and stage filter simultaneously?

**Finding**: ✅ VERIFIED — Yes, it can!

**Exact function signature** (from `src/lib/queries/open-pipeline.ts` lines 253-256):
```typescript
const _getOpenPipelineRecordsByStage = async (
  stage: string,
  filters?: { channel?: string; source?: string; sga?: string; sgm?: string; sgms?: string[] }
): Promise<DetailRecord[]>
```

**How sgm and sgms filters work** (lines 275-287):
```typescript
// Single SGM filter
if (filters?.sgm) {
  conditions.push('v.SGM_Owner_Name__c = @sgm');
  params.sgm = filters.sgm;
}

// Handle array of SGMs (from multi-select filter)
// Note: sgms is only used if sgm is NOT provided (sgm takes precedence)
if (filters?.sgms && filters.sgms.length > 0 && !filters?.sgm) {
  const sgmParams = filters.sgms.map((_, i) => `@sgmFilter${i}`);
  conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
  filters.sgms.forEach((sgm, i) => {
    params[`sgmFilter${i}`] = sgm;
  });
}
```

**Key observation**: The function uses `StageName = @targetStage` (line 290), meaning it only returns records for ONE stage at a time.

For the "click a stage segment" drill-down, we pass:
- `stage` = the clicked stage
- `filters.sgm` = the SGM whose bar was clicked

For the "click SGM name" drill-down (all stages for one SGM), we need a new variant. Two approaches:

**Option A**: Call the existing drilldown endpoint **once per selected stage** and combine client-side. This is simple but creates N API calls.

**Option B (Better)**: Add a new query function `getOpenPipelineRecordsBySgm(sgm, stages, sgms)` that filters by SGM without a single-stage restriction. The SQL is essentially the same but with `StageName IN (...)` instead of `StageName = @targetStage`.

**Recommendation**: Option B — create `getOpenPipelineRecordsBySgm`. It follows the existing pattern and avoids N API calls.

**Note**: The pipeline page currently uses Option A approach in `handleAumClick` (lines 123-161) — it loops through all selected stages and makes N API calls. The new feature could follow this pattern initially, then optimize with Option B.

### 3.5 — Where should the new query function live?

**Question**: New file or extend existing?

**Finding**: ✅ VERIFIED

Add to **`src/lib/queries/open-pipeline.ts`** — this file already contains:
- `_getOpenPipelineRecords` (lines 8-151) → exported as `getOpenPipelineRecords` (lines 153-157)
- `_getOpenPipelineSummary` (lines 159-241) → exported as `getOpenPipelineSummary` (lines 243-247)
- `_getOpenPipelineRecordsByStage` (lines 253-405) → exported as `getOpenPipelineRecordsByStage` (lines 407-411)

Adding `_getOpenPipelineBySgm` and `_getOpenPipelineRecordsBySgm` here keeps all open pipeline queries co-located.

**Pattern to follow for new functions**:
```typescript
// 1. Create internal function with _ prefix
const _getOpenPipelineBySgm = async (
  filters?: { stages?: string[]; sgms?: string[] }
): Promise<{ /* return type */ }> => {
  // Build conditions, params, query
  // Run query
  // Transform results
};

// 2. Export wrapped with cachedQuery
export const getOpenPipelineBySgm = cachedQuery(
  _getOpenPipelineBySgm,
  'getOpenPipelineBySgm',  // Unique cache key
  CACHE_TAGS.DASHBOARD     // Cache tag for invalidation
);
```

---

## 4. Phase 3: UI Component Architecture

### 4.1 — How should the tab UI work?

**Question**: What's the minimal change to the pipeline page to add a tab toggle?

**Finding**:

Add a `useState` for the active tab and conditionally render the chart:

```typescript
// New state
const [activeTab, setActiveTab] = useState<'byStage' | 'bySgm'>('byStage');

// In JSX, replace the chart Card with:
{/* Tab Toggle - only show if revops_admin */}
{isRevOpsAdmin && (
  <div className="flex gap-2 mb-4">
    <button onClick={() => setActiveTab('byStage')}
      className={activeTab === 'byStage' ? 'active-style' : 'inactive-style'}>
      By Stage
    </button>
    <button onClick={() => setActiveTab('bySgm')}
      className={activeTab === 'bySgm' ? 'active-style' : 'inactive-style'}>
      By SGM
    </button>
  </div>
)}

{/* Chart */}
{activeTab === 'byStage' ? (
  <PipelineByStageChart ... />
) : (
  <PipelineBySgmChart ... />
)}
```

**Permission check**: The page already has access to session/permissions via `useSession()`. Check `permissions.role === 'revops_admin'` to conditionally show the tab toggle. If the user is not `revops_admin`, the tab toggle is hidden and only the "By Stage" chart renders (current behavior, zero change for non-revops users).

### 4.2 — What does the new chart component need?

**Question**: What props and features does `PipelineBySgmChart` need?

**Finding**: ✅ VERIFIED with additional details from existing chart patterns

**File**: `src/components/dashboard/PipelineBySgmChart.tsx` (new component)

**Props**:
```typescript
interface PipelineBySgmChartProps {
  data: SgmPipelineChartData[];          // Pre-sorted by totalAum desc
  selectedStages: string[];               // Which stages are active (for segment visibility)
  onSegmentClick: (sgm: string, stage: string) => void;  // Click a stage segment
  onSgmClick: (sgm: string) => void;      // Click an SGM name on x-axis
  loading?: boolean;
}
```

#### Existing Bar onClick pattern (from PipelineByStageChart.tsx lines 271-275):
```typescript
<Bar
  yAxisId="aum"
  dataKey="totalAum"
  name="AUM"
  fill={COLORS.aum}
  radius={[4, 4, 0, 0]}
  cursor="pointer"
  onClick={(data: any) => {
    if (data && data.stage) {
      onBarClick(data.stage, 'aum');
    }
  }}
>
```

#### Existing height, margins, ResponsiveContainer setup (lines 204-210):
```typescript
<div className="h-[75vh] min-h-[600px]">
  <ResponsiveContainer width="100%" height="100%">
    <BarChart
      data={data}
      margin={{ top: 40, right: 80, left: 20, bottom: 20 }}
      barCategoryGap="20%"
    >
```

#### Existing dark mode theming pattern (lines 113-114, 131-133):
```typescript
const { resolvedTheme } = useTheme();
const isDark = resolvedTheme === 'dark';

const textColor = isDark ? '#9CA3AF' : '#6B7280';
const gridColor = isDark ? '#4B5563' : '#D1D5DB';
const labelColor = isDark ? '#f9fafb' : '#111827';
```

#### Existing XAxis tick styling (lines 220-224) — NOT a custom tick component:
```typescript
<XAxis
  dataKey="stage"
  tick={{ fill: isDark ? '#f9fafb' : '#111827', fontSize: 15, fontWeight: 500 }}
  axisLine={{ stroke: gridColor }}
/>
```
⚠️ **Note**: The current chart uses a simple tick style object, NOT a custom tick component. For clickable SGM labels, we WILL need a custom tick component (see Section 4.3).

#### Existing LabelList custom content renderer (lines 140-169):
```typescript
const renderAumLabel = (props: any) => {
  const { x = 0, y = 0, width = 0, value } = props;

  if (!value || value === 0) return null;

  const displayValue = formatAumLabel(value);
  const labelX = x + width / 2;
  const labelY = y - 8;

  // Use darker color for better visibility in PNG export
  const textFill = isDark ? '#f9fafb' : '#111827';

  return (
    <text
      x={labelX}
      y={labelY}
      fill={textFill}
      textAnchor="middle"
      fontSize={14}
      fontWeight={700}
      style={{
        textShadow: isDark
          ? '0 0 2px rgba(0,0,0,0.5)'
          : '0 0 2px rgba(255,255,255,0.8)',
      }}
    >
      {displayValue}
    </text>
  );
};

// Usage:
<LabelList dataKey="totalAum" content={renderAumLabel} />
```

#### Existing CustomTooltip component (lines 72-106):
```typescript
interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4">
      <p className="font-semibold text-base text-gray-900 dark:text-white mb-2">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2 text-base">
          <div
            className="w-4 h-4 rounded-full"
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
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 border-t border-gray-200 dark:border-gray-600 pt-2">
        Click a bar to see details
      </p>
    </div>
  );
};

// Usage:
<Tooltip content={<CustomTooltip />} />
```

#### Existing AUM formatters (lines 33-70):
```typescript
const formatAumAxis = (value: number) => {
  if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(0)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
};

const formatAumTooltip = (value: number) => {
  if (value >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
};
```

**Stage color map**: Define a `STAGE_COLORS` constant with distinct, accessible colors for each of the 7 stages. Ensure contrast in both light and dark modes.

**Suggested palette** (optimized for stacked bars):
```typescript
const STAGE_COLORS = {
  plannedNurture: '#94a3b8',  // Slate 400
  qualifying:     '#60a5fa',  // Blue 400
  discovery:      '#34d399',  // Emerald 400
  salesProcess:   '#fbbf24',  // Amber 400
  negotiating:    '#f97316',  // Orange 500
  signed:         '#a78bfa',  // Violet 400
  onHold:         '#f87171',  // Red 400
};
```

### 4.3 — How should the x-axis SGM label click work?

**Question**: Recharts `<XAxis>` doesn't have a native `onClick` per tick label. How do we make SGM names clickable?

**Finding**: ✅ VERIFIED — custom tick component IS needed

**Current chart uses simple tick styling** (from PipelineByStageChart.tsx lines 220-224):
```typescript
<XAxis
  dataKey="stage"
  tick={{ fill: isDark ? '#f9fafb' : '#111827', fontSize: 15, fontWeight: 500 }}
  axisLine={{ stroke: gridColor }}
/>
```

This does NOT support click handlers. For the new chart, we need a **custom tick component**.

**Recharts custom tick pattern** (required for clickable SGM labels):

```tsx
// Custom tick component for clickable x-axis labels
const CustomXAxisTick = ({ x, y, payload, onClick }: any) => {
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={16}
        textAnchor="middle"
        fill={isDark ? '#f9fafb' : '#111827'}
        fontSize={15}
        fontWeight={500}
        style={{ cursor: 'pointer' }}
        onClick={() => onClick(payload.value)}
      >
        {payload.value}
      </text>
    </g>
  );
};

// Usage:
<XAxis
  dataKey="sgm"
  tick={<CustomXAxisTick onClick={onSgmClick} />}
  axisLine={{ stroke: gridColor }}
/>
```

**Key implementation notes**:
- The `tick` prop accepts a React element (not just a style object) for custom rendering
- `payload.value` contains the SGM name string
- Must handle dark mode via `isDark` check
- Add `cursor: pointer` and optional hover styling for UX
- Consider truncating long SGM names with ellipsis if needed

### 4.4 — What tooltip information should be shown?

**Question**: What data should the tooltip display on hover?

**Finding**:

When hovering over a stage segment or the entire bar, show:

```
[SGM Name]
─────────────────────
Qualifying:     $210M  (4 advisors)
Discovery:    $8,524M  (41 advisors)
Sales Process: $4,992M  (59 advisors)
Negotiating:  $1,712M  (19 advisors)
─────────────────────
Total:       $15,438M  (123 advisors)

Click a segment to drill down
```

This requires both `aum` and `count` values per stage per SGM, which is why the chart data shape includes both `[stage]` (AUM) and `[stage]Count` fields.

### 4.5 — How do we label the bars?

**Question**: Should AUM totals appear above each bar?

**Finding**:

Yes — show the **total AUM** above each SGM's stacked bar using Recharts `<LabelList>`. The existing `PipelineByStageChart` already uses custom `<LabelList>` renderers for this. Replicate the same pattern:

```tsx
// Only the topmost visible Bar gets the label
<Bar dataKey={topMostStageKey} stackId="pipeline" ...>
  <LabelList dataKey="totalAum" content={renderTotalLabel} position="top" />
</Bar>
```

Alternatively, compute the label position as a custom Recharts label renderer that reads `totalAum` from the data entry regardless of which segment it's attached to.

---

## 5. Phase 4: Permission & Access Control

### 5.1 — How does the pipeline page currently handle permissions?

**Question**: Does the pipeline page check any permissions, and how does it get user role info?

**Finding**: ✅ VERIFIED

**File**: `src/app/dashboard/pipeline/page.tsx`

The pipeline page is a **client component** that uses `useSession()` from `next-auth/react`. From line 236:
```typescript
// Note: Permission check removed - all authenticated users can access the pipeline page
```

The page has **no page-level permission check**. All authenticated users (except recruiter/capital_partner, which are blocked at the API level) can access it.

**Session and permissions access pattern** (from lines 23-24):
```typescript
const { data: session, status } = useSession();
const permissions = getSessionPermissions(session);
```

**UserRole type** (from `src/types/user.ts` line 2):
```typescript
export type UserRole = 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter' | 'revops_admin' | 'capital_partner';
```

**UserPermissions interface** (from `src/types/user.ts` lines 17-28):
```typescript
export interface UserPermissions {
  role: UserRole;
  allowedPages: number[];
  sgaFilter: string | null;
  sgmFilter: string | null;
  recruiterFilter: string | null;
  capitalPartnerFilter?: string | null;
  canExport: boolean;
  canManageUsers: boolean;
  canManageRequests: boolean;  // RevOps Admin only
  userId?: string | null;
}
```

**getSessionPermissions function** (from `src/types/auth.ts` lines 23-30):
```typescript
export function getSessionPermissions(
  session: Session | ExtendedSession | null | undefined
): UserPermissions | null {
  if (hasPermissions(session)) {
    return session.permissions;
  }
  return null;
}
```

### 5.2 — How should we restrict the "By SGM" tab to revops_admin?

**Question**: What's the correct way to check if the current user is `revops_admin` on a client component?

**Finding**: ✅ VERIFIED

**revops_admin permissions** (from `src/lib/permissions.ts` lines 14-20):
```typescript
revops_admin: {
  role: 'revops_admin',
  allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],  // All pages
  canExport: true,
  canManageUsers: true,
  canManageRequests: true,  // UNIQUE to revops_admin
},
```

**Client-side check pattern** (using existing permissions from pipeline page):
```typescript
// Already available from lines 23-24
const { data: session, status } = useSession();
const permissions = getSessionPermissions(session);

// Check role
const isRevOpsAdmin = permissions?.role === 'revops_admin';
```

**UI enforcement**: Conditionally render the tab toggle:
```tsx
{isRevOpsAdmin && <TabToggle activeTab={activeTab} onTabChange={setActiveTab} />}
```

If not `revops_admin`, the user never sees the tab UI and `activeTab` stays at `'byStage'` (default), so the page behavior is unchanged.

**API enforcement**: The new `/api/dashboard/pipeline-by-sgm` endpoint should check:
```typescript
const permissions = getSessionPermissions(session);
if (permissions?.role !== 'revops_admin') {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**Existing pattern for revops_admin-only checks** (from dashboard-requests routes):
```typescript
// From src/app/api/dashboard-requests/analytics/route.ts lines 27-30
// Only RevOps Admin can view analytics
if (!permissions.canManageRequests) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

Note: `canManageRequests` is ONLY true for revops_admin, so either check works. For clarity, the new pipeline-by-sgm endpoint should use `permissions?.role !== 'revops_admin'` to be explicit.

### 5.3 — Does the drill-down endpoint need permission changes?

**Question**: When a revops_admin clicks a segment and triggers a drill-down, does the existing drilldown API need changes?

**Finding**: ✅ VERIFIED

**Existing auth pattern** (from `src/app/api/dashboard/pipeline-drilldown/route.ts` lines 13-29):
```typescript
const session = await getServerSession(authOptions);

if (!session?.user?.email) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const permissions = getSessionPermissions(session);
if (!permissions) {
  return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
}

const forbidden = forbidRecruiter(permissions);
if (forbidden) return forbidden;

const cpForbidden = forbidCapitalPartner(permissions);
if (cpForbidden) return cpForbidden;
```

**forbidRecruiter function** (from `src/lib/api-authz.ts` lines 11-14):
```typescript
export function forbidRecruiter(permissions: UserPermissions) {
  if (permissions.role !== 'recruiter') return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**forbidCapitalPartner function** (from `src/lib/api-authz.ts` lines 21-24):
```typescript
export function forbidCapitalPartner(permissions: UserPermissions) {
  if (permissions.role !== 'capital_partner') return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

**No changes needed for the existing endpoint**. The drill-down for "click a stage segment" uses the same `getPipelineDrilldown` endpoint with an added `sgm` filter. The endpoint already accepts `filters.sgm` and `filters.sgms`.

For the "click SGM name" drill-down (all stages for one SGM), we need a **new API endpoint** or extend the existing one. Best approach: add a new endpoint `/api/dashboard/pipeline-drilldown-sgm` that accepts `{ sgm, stages, sgms }` and calls the new `getOpenPipelineRecordsBySgm` query. This keeps the existing endpoint unchanged and its contract stable.

**New endpoint auth pattern** should match existing pipeline routes:
```typescript
// Auth check (same as existing routes)
const session = await getServerSession(authOptions);
if (!session?.user?.email) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

const permissions = getSessionPermissions(session);
if (!permissions) {
  return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
}

const forbidden = forbidRecruiter(permissions);
if (forbidden) return forbidden;

const cpForbidden = forbidCapitalPartner(permissions);
if (cpForbidden) return cpForbidden;

// Note: NO revops_admin check for drilldown — any non-recruiter/non-capital_partner
// can use drilldown IF they have access to the by-SGM data. The by-SGM summary
// endpoint already restricts to revops_admin, so this is defense-in-depth.
```

---

## 6. Phase 5: Drill-Down Behavior Specification

### 6.1 — Click a stage segment

**Trigger**: User clicks on e.g. the "Discovery" segment of "Bre McDaniel"'s bar

**Finding**: ✅ VERIFIED — Existing infrastructure supports this

**Existing handleBarClick function** (from `pipeline/page.tsx` lines 103-120):
```typescript
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
```

**For the new chart**, we need a similar handler:
```typescript
const handleSegmentClick = async (sgm: string, stage: string) => {
  setDrillDownStage(stage);
  setDrillDownSgm(sgm);  // NEW state variable needed
  setDrillDownOpen(true);
  setDrillDownLoading(true);

  try {
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
    // Pass sgm in filters to get records for that specific SGM + stage
    const result = await dashboardApi.getPipelineDrilldown(stage, { sgm }, sgmsToSend);
    setDrillDownRecords(result.records);
  } catch (err) {
    console.error('Error fetching drill-down data:', err);
    setDrillDownRecords([]);
  } finally {
    setDrillDownLoading(false);
  }
};
```

**No new API endpoint needed** — existing drill-down with `filters.sgm` handles this.

### 6.2 — Click an SGM name on x-axis

**Trigger**: User clicks "Bre McDaniel" text on the x-axis

**Finding**: ✅ VERIFIED — Existing pattern shows how to fetch all stages

**Existing handleAumClick function** (from `pipeline/page.tsx` lines 123-161):
```typescript
const handleAumClick = async () => {
  setDrillDownStage(null);
  setDrillDownMetric(null);
  setDrillDownOpen(true);
  setDrillDownLoading(true);

  try {
    // Fetch records for all selected stages and combine them
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
    const allRecords: DetailRecord[] = [];
    const recordIds = new Set<string>(); // To deduplicate if needed

    // Fetch records for each selected stage
    for (const stage of selectedStages) {
      try {
        const result = await dashboardApi.getPipelineDrilldown(stage, undefined, sgmsToSend);
        // Add records, avoiding duplicates by ID
        for (const record of result.records) {
          if (!recordIds.has(record.id)) {
            recordIds.add(record.id);
            allRecords.push(record);
          }
        }
      } catch (err) {
        console.error(`Error fetching records for stage ${stage}:`, err);
      }
    }

    // Sort by AUM descending
    allRecords.sort((a, b) => b.aum - a.aum);

    setDrillDownRecords(allRecords);
  } catch (err) {
    console.error('Error fetching AUM drill-down data:', err);
    setDrillDownRecords([]);
  } finally {
    setDrillDownLoading(false);
  }
};
```

**For the new chart SGM click**, we can follow this pattern:
```typescript
const handleSgmClick = async (sgm: string) => {
  setDrillDownStage(null);  // All stages
  setDrillDownSgm(sgm);
  setDrillDownOpen(true);
  setDrillDownLoading(true);

  try {
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
    const allRecords: DetailRecord[] = [];
    const recordIds = new Set<string>();

    // Fetch records for each selected stage, filtered to this SGM
    for (const stage of selectedStages) {
      try {
        const result = await dashboardApi.getPipelineDrilldown(stage, { sgm }, sgmsToSend);
        for (const record of result.records) {
          if (!recordIds.has(record.id)) {
            recordIds.add(record.id);
            allRecords.push(record);
          }
        }
      } catch (err) {
        console.error(`Error fetching records for stage ${stage}:`, err);
      }
    }

    allRecords.sort((a, b) => b.aum - a.aum);
    setDrillDownRecords(allRecords);
  } catch (err) {
    console.error('Error fetching SGM drill-down data:', err);
    setDrillDownRecords([]);
  } finally {
    setDrillDownLoading(false);
  }
};
```

**Option A (N API calls)**: Use existing endpoint with `filters.sgm`, loop through stages (as shown above). Simple but creates N requests.

**Option B (1 API call)**: Create new endpoint `/api/dashboard/pipeline-drilldown-sgm` with `{ sgm, stages, sgms }`. Better performance.

**Recommendation**: Start with Option A for initial implementation (no new endpoint). Optimize to Option B if performance is an issue.

### 6.3 — Drill-down modal JSX and title pattern

**Finding**: ✅ VERIFIED

**Existing drill-down modal JSX** (from `pipeline/page.tsx` lines 320-337):
```tsx
<VolumeDrillDownModal
  isOpen={drillDownOpen}
  onClose={handleCloseDrillDown}
  records={drillDownRecords}
  title={
    drillDownStage
      ? `${drillDownStage} Stage`
      : selectedStages.length === OPEN_PIPELINE_STAGES.length &&
        OPEN_PIPELINE_STAGES.every(s => selectedStages.includes(s))
        ? 'Open Pipeline - All Stages'
        : `Open Pipeline - ${selectedStages.length} Stage${selectedStages.length > 1 ? 's' : ''}`
  }
  loading={drillDownLoading}
  error={null}
  onRecordClick={handleRecordClick}
  metricFilter="openPipeline"
  canExport={permissions?.canExport || false}
/>
```

**For the new chart**, title construction needs to include SGM name:
```typescript
const drillDownTitle = useMemo(() => {
  if (drillDownSgm) {
    if (drillDownStage) {
      return `${drillDownSgm} — ${drillDownStage}`;  // "Bre McDaniel — Discovery"
    }
    return `${drillDownSgm} — All Open Pipeline`;     // "Bre McDaniel — All Open Pipeline"
  }
  // Fallback to existing logic for non-SGM drilldowns
  if (drillDownStage) {
    return `${drillDownStage} Stage`;
  }
  return 'Open Pipeline - All Stages';
}, [drillDownSgm, drillDownStage]);
```

**VolumeDrillDownModal props interface** (from `VolumeDrillDownModal.tsx` lines 8-18):
```typescript
interface VolumeDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  records: DetailRecord[];
  title: string;
  loading: boolean;
  error: string | null;
  onRecordClick: (recordId: string) => void;
  metricFilter?: 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
  canExport?: boolean;
}
```

**DetailRecordsTable props interface** (from `DetailRecordsTable.tsx` lines 16-29):
```typescript
interface DetailRecordsTableProps {
  records: DetailRecord[];
  title?: string;
  filterDescription?: string;
  canExport?: boolean;
  viewMode?: ViewMode;
  advancedFilters?: AdvancedFilters;
  metricFilter?: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
  onRecordClick?: (recordId: string) => void;
  // Stage filter dropdown props (EXISTING!)
  stageFilter?: string;
  onStageFilterChange?: (stage: string) => void;
  availableOpportunityStages?: string[];
}
```

**Key discovery**: `DetailRecordsTable` ALREADY has `stageFilter`, `onStageFilterChange`, and `availableOpportunityStages` props! These can be used when drilling down by SGM to let users filter by stage within the modal.

**RecordDetailModal props interface** (from `RecordDetailModal.tsx` lines 25-34):
```typescript
interface RecordDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordId: string | null;
  initialRecord?: RecordDetailFull | null;
  showBackButton?: boolean;
  onBack?: () => void;
  backButtonLabel?: string;
}
```

**Existing RecordDetailModal JSX** (from `pipeline/page.tsx` lines 340-347):
```tsx
<RecordDetailModal
  isOpen={selectedRecordId !== null}
  onClose={() => setSelectedRecordId(null)}
  recordId={selectedRecordId}
  showBackButton={drillDownRecords.length > 0}
  onBack={handleBackToDrillDown}
  backButtonLabel={`← Back to ${drillDownStage || 'list'}`}
/>
```

### 6.4 — Gap analysis for drill-down

**Current infrastructure supports:**
- ✅ Opening drill-down modal with filtered records
- ✅ Displaying records in table with sorting, search, pagination
- ✅ Stage filter dropdown within the table (`stageFilter` props)
- ✅ Clicking a row to view full record detail
- ✅ Back button to return to drill-down from record detail
- ✅ Export to CSV (if `canExport` permission)

**New state variable needed:**
- `drillDownSgm: string | null` — to track which SGM was clicked (for title construction and back button label)

**No new components needed** — existing `VolumeDrillDownModal`, `DetailRecordsTable`, and `RecordDetailModal` can be fully reused.

---

## 7. Phase 6: Implementation Plan

### File Touchpoint Summary

| File | Action | Description |
|------|--------|-------------|
| `src/lib/queries/open-pipeline.ts` | **Modify** | Add `getOpenPipelineBySgm()` and `getOpenPipelineRecordsBySgm()` query functions |
| `src/types/dashboard.ts` | **Modify** | Add `SgmPipelineChartData` and `OpenPipelineBySgmSummary` types |
| `src/app/api/dashboard/pipeline-by-sgm/route.ts` | **Create** | New API route for by-SGM summary data (revops_admin only) |
| `src/app/api/dashboard/pipeline-drilldown-sgm/route.ts` | **Create** | New API route for SGM-level drill-down (all stages for one SGM) |
| `src/lib/api-client.ts` | **Modify** | Add `getPipelineBySgm()` and `getPipelineDrilldownBySgm()` client functions |
| `src/components/dashboard/PipelineBySgmChart.tsx` | **Create** | New stacked bar chart component |
| `src/app/dashboard/pipeline/page.tsx` | **Modify** | Add tab state, tab toggle (revops_admin only), conditional chart rendering, new click handlers |
| `src/config/constants.ts` | **Modify** | Add `STAGE_COLORS` constant and `STAGE_STACK_ORDER` constant |

### Implementation Order

**Step 1: Types** (5 min)
- Add `SgmPipelineChartData` interface to `dashboard.ts`
- Add `OpenPipelineBySgmSummary` return type

**Step 2: Query Layer** (15 min)
- Add `_getOpenPipelineBySgm(stages, sgms)` to `open-pipeline.ts`
- Add `_getOpenPipelineRecordsBySgm(sgm, stages, sgms)` to `open-pipeline.ts`
- Wrap both with `cachedQuery()` using `CACHE_TAGS.DASHBOARD`
- Export both

**Step 3: API Routes** (15 min)
- Create `/api/dashboard/pipeline-by-sgm/route.ts`
  - POST handler
  - Auth check + `revops_admin` role check
  - Accepts `{ stages, sgms }` body
  - Calls `getOpenPipelineBySgm()`, pivots results, sorts by totalAum desc
  - Returns `{ data: SgmPipelineChartData[] }`
- Create `/api/dashboard/pipeline-drilldown-sgm/route.ts`
  - POST handler
  - Auth check + recruiter/capital_partner block
  - Accepts `{ sgm, stages, sgms }` body
  - Calls `getOpenPipelineRecordsBySgm()`
  - Returns `{ records: DetailRecord[], sgm }`

**Step 4: API Client** (5 min)
- Add `getPipelineBySgm(stages, sgms)` to `dashboardApi`
- Add `getPipelineDrilldownBySgm(sgm, stages, sgms)` to `dashboardApi`

**Step 5: Chart Component** (30 min)
- Create `PipelineBySgmChart.tsx`
- Stacked `<BarChart>` with one `<Bar>` per stage (ordered per stack order)
- Only render `<Bar>` components for stages present in `selectedStages`
- Custom tooltip showing all stages + counts + total
- Custom x-axis tick with clickable SGM names
- `<LabelList>` showing total AUM above each bar
- Dark mode support via `useTheme()`
- Loading and empty states

**Step 6: Pipeline Page Integration** (20 min)
- Add `activeTab` state
- Add `isRevOpsAdmin` check from session
- Add tab toggle UI (conditionally rendered)
- Add `bySgmData` state and fetch function
- Fetch by-SGM data when tab is active and filters change
- Wire up `handleSegmentClick` and `handleSgmClick` handlers
- Reuse existing drill-down modal and `DetailRecordsTable`

**Step 7: Constants** (5 min)
- Add to `src/config/constants.ts`:
```typescript
export const STAGE_STACK_ORDER = [
  'Planned Nurture',
  'Qualifying',
  'Discovery',
  'Sales Process',
  'Negotiating',
  'Signed',
  'On Hold',
];

export const STAGE_COLORS: Record<string, string> = {
  'Planned Nurture': '#94a3b8',
  'Qualifying':      '#60a5fa',
  'Discovery':       '#34d399',
  'Sales Process':   '#fbbf24',
  'Negotiating':     '#f97316',
  'Signed':          '#a78bfa',
  'On Hold':         '#f87171',
};
```

### Guardrails for Agentic Implementation

**DO**:
- ✅ Use `v.Opportunity_AUM` (the pre-calculated view column) for AUM, not raw `Underwritten_AUM__c` or `Amount`
- ✅ Use `is_sqo_unique = 1` filter in all pipeline queries
- ✅ Use `is_primary_opp_record = 1` for AUM summation
- ✅ Use `recordtypeid = @recruitingRecordType` (Recruiting only)
- ✅ Use `getSessionPermissions(session)` for auth (no DB query)
- ✅ Use `forbidRecruiter()` and `forbidCapitalPartner()` in new API routes
- ✅ Check `permissions.role === 'revops_admin'` for the by-SGM endpoint
- ✅ Use `cachedQuery()` wrapper with `CACHE_TAGS.DASHBOARD` for new query functions
- ✅ Match the existing chart styling (dark mode, font sizes, grid colors) from `PipelineByStageChart.tsx`
- ✅ Reuse existing `DetailRecordsTable` and `RecordDetailModal` for drill-downs
- ✅ Sort bars left-to-right by `totalAum` descending
- ✅ Stack stages bottom-to-top per `STAGE_STACK_ORDER`

**DO NOT**:
- ❌ Do NOT use `COALESCE(Underwritten_AUM__c, Amount, 0)` in the query — the view already computes this as `Opportunity_AUM`
- ❌ Do NOT add date filters — open pipeline is a current-state snapshot
- ❌ Do NOT modify the existing `PipelineByStageChart` component
- ❌ Do NOT modify the existing `PipelineFilters` component
- ❌ Do NOT modify the existing `/api/dashboard/pipeline-summary` or `/api/dashboard/pipeline-drilldown` endpoints
- ❌ Do NOT create a new page — this is a tab within the existing pipeline page
- ❌ Do NOT use `getUserPermissions()` (triggers DB query) — use `getSessionPermissions()` only
- ❌ Do NOT allow non-revops_admin users to see the tab or call the by-SGM API
- ❌ Do NOT add `SGA_Owner_Name__c` or `Opp_SGA_Name__c` filters — this view is by SGM only

### Testing Checklist

- [ ] By-SGM chart renders with correct data matching the "By Stage" totals
- [ ] Bars are sorted left-to-right by total AUM (highest first)
- [ ] Stage segments stack in correct order (Planned Nurture bottom → On Hold top)
- [ ] Only selected stages appear as segments (filter-responsive)
- [ ] Clicking a stage segment opens drill-down with correct SGM + stage filter
- [ ] Clicking an SGM name opens drill-down with all records for that SGM
- [ ] Drill-down records match what the existing pipeline page shows for those filters
- [ ] Tab toggle only appears for `revops_admin` users
- [ ] Non-revops_admin users see no visual change to the pipeline page
- [ ] API returns 403 for non-revops_admin users calling `/api/dashboard/pipeline-by-sgm`
- [ ] Dark mode renders correctly
- [ ] Chart tooltip shows all stage breakdowns with AUM and count
- [ ] Scorecard totals remain consistent between tabs
- [ ] PNG export works for the by-SGM chart
- [ ] Filter changes while on "By SGM" tab trigger data refresh
- [ ] Switching tabs preserves filter state

---

## 8. Gap Analysis & Open Questions

> **Added after codebase verification on 2026-02-17**

### A) DISCREPANCIES — Findings that were wrong or outdated in the original document

| Original Claim | Actual Finding | Impact |
|----------------|----------------|--------|
| Recharts version: v2.15.4 | **v3.6.0** (from package.json) | Minor — v3 API is compatible |
| Recharts bundled via `@tremor/react` | **Imported directly** from 'recharts' | None — same components available |
| `useSession({ required: true })` | `useSession()` without required option | None — page still checks auth |
| Drill-down uses `DetailRecordsTable` directly | Uses **`VolumeDrillDownModal`** which wraps `DetailRecordsTable` | None — modal provides better UX |
| Pipeline SGM options uses `getActiveSgmOptions()` | **Inline SQL in route** (no separate query function) | None — pattern is fine |
| XAxis uses custom tick component | Uses **simple tick style object** (no custom tick) | Medium — custom tick IS needed for new chart |
| Chart components: BarChart, Bar, Cell, XAxis, YAxis, Tooltip, Legend, LabelList | **Also includes**: CartesianGrid, ResponsiveContainer, ReferenceLine | None — just more complete list |

### B) EDGE CASES — Things the implementation needs to handle

| Edge Case | How to Handle |
|-----------|---------------|
| **Null SGM name** (`SGM_Owner_Name__c IS NULL`) | Query already filters `WHERE v.SGM_Owner_Name__c IS NOT NULL` in pipeline-sgm-options route. New query should do the same. |
| **Zero AUM for a stage** | Recharts handles this — segment just won't appear. Tooltip should still show "$0" if count > 0. |
| **Empty stages** (no records) | Don't render a `<Bar>` for stages with no data across any SGM. Check `selectedStages` to filter. |
| **SGM with no open pipeline** | Won't appear in query results (GROUP BY produces no rows). No special handling needed. |
| **Long SGM names** | May overlap on x-axis. Consider: (1) angle the labels 45°, (2) truncate with ellipsis and show full name in tooltip, (3) use first name only with hover for full name. |
| **Many SGMs (10+)** | Chart may become crowded. Consider: (1) horizontal scrolling, (2) pagination, (3) "Top 10" toggle, (4) wider chart container. Start simple, iterate if needed. |
| **Dark mode color contrast** | Test all 7 stage colors against both `bg-gray-800` (dark) and `bg-white` (light). Adjust saturation/lightness if needed. |
| **SGM name contains special characters** | BigQuery parameterized queries handle this. No escaping needed in application code. |
| **Simultaneous filter changes** | Use `useCallback` with dependencies and debounce if needed to prevent race conditions. |

### C) REUSABLE UTILITIES — Existing functions to use (don't reinvent)

| Utility | File Path | Usage |
|---------|-----------|-------|
| `formatAumAxis(value)` | `src/components/dashboard/PipelineByStageChart.tsx:33` | Y-axis tick formatter |
| `formatAumTooltip(value)` | `src/components/dashboard/PipelineByStageChart.tsx:46` | Tooltip value formatter |
| `formatAumLabel(value)` | `src/components/dashboard/PipelineByStageChart.tsx:59` | Bar label formatter |
| `formatCurrency(value)` | `src/lib/utils/date-helpers.ts` | General currency formatting |
| `toNumber(value)`, `toString(value)` | `src/types/bigquery-raw.ts` | Safe BigQuery result parsing |
| `runQuery(sql, params)` | `src/lib/bigquery.ts` | Execute parameterized BigQuery |
| `cachedQuery(fn, key, tag)` | `src/lib/cache.ts` | Cache wrapper for query functions |
| `CACHE_TAGS.DASHBOARD` | `src/lib/cache.ts` | Cache invalidation tag |
| `forbidRecruiter(permissions)` | `src/lib/api-authz.ts:11` | API route guard |
| `forbidCapitalPartner(permissions)` | `src/lib/api-authz.ts:21` | API route guard |
| `getSessionPermissions(session)` | `src/types/auth.ts:23` | Extract permissions from session |
| `getServerSession(authOptions)` | `next-auth` + `src/lib/auth.ts` | Get server-side session |
| `OPEN_PIPELINE_STAGES` | `src/config/constants.ts:6` | Default stage list |
| `RECRUITING_RECORD_TYPE` | `src/config/constants.ts:13` | Record type filter value |
| `FULL_TABLE` | `src/config/constants.ts:16` | BigQuery table reference |
| Dark mode pattern: `useTheme()` → `isDark` → color vars | `PipelineByStageChart.tsx:113-133` | Consistent theming |

### D) POTENTIAL ISSUES — Concerns with the proposed approach

| Issue | Severity | Mitigation |
|-------|----------|------------|
| **N API calls for SGM name click** — `handleSgmClick` loops through `selectedStages` making one API call per stage | Medium | Start with Option A (N calls). If performance is bad (>1s latency), implement Option B (single endpoint with `StageName IN (...)`). |
| **LabelList position on stacked bar** — Need to show total AUM above the topmost segment, but topmost segment varies by which stages are selected | Low | Attach `<LabelList>` to the topmost `<Bar>` in render order. Since bars stack in order, the last one rendered is on top. Use `dataKey="totalAum"` regardless of which Bar it's attached to. |
| **Custom XAxis tick required** — Standard tick doesn't support onClick | Low | Custom tick component is well-documented Recharts pattern. Code example provided in Section 4.3. |
| **Stage color accessibility** — Proposed colors may not have sufficient contrast in all contexts | Low | Test with color blindness simulators. Consider using patterns/textures in addition to colors. The suggested Tailwind palette is generally accessible. |
| **Chart width with many SGMs** — 15+ SGMs may make bars too narrow | Medium | Set minimum bar width. If exceeded, enable horizontal scroll or show "Top N" with expand option. |
| **PNG export compatibility** — New chart needs to work with existing `PipelineExportPng` component | Low | The export component uses `html-to-image` which works on any DOM element. Just ensure the new chart has a wrapper div with the appropriate ID. |

### E) READY FOR IMPLEMENTATION?

## ✅ YES — Ready for implementation

**No blocking issues identified.** All infrastructure exists. The implementation can proceed following the plan in Section 7.

**Minor considerations before starting:**
1. Decide on Option A vs B for SGM name click drill-down (recommend Option A initially)
2. Decide on long SGM name handling strategy (recommend truncation with tooltip)
3. Confirm the 7-color palette works in both light/dark mode (quick visual check)

**Files verified to exist and match documented interfaces:**
- ✅ `src/app/dashboard/pipeline/page.tsx`
- ✅ `src/components/dashboard/PipelineByStageChart.tsx`
- ✅ `src/components/dashboard/VolumeDrillDownModal.tsx`
- ✅ `src/components/dashboard/DetailRecordsTable.tsx`
- ✅ `src/components/dashboard/RecordDetailModal.tsx`
- ✅ `src/lib/queries/open-pipeline.ts`
- ✅ `src/lib/api-client.ts`
- ✅ `src/lib/api-authz.ts`
- ✅ `src/lib/permissions.ts`
- ✅ `src/types/dashboard.ts`
- ✅ `src/types/auth.ts`
- ✅ `src/types/user.ts`
- ✅ `src/config/constants.ts`
- ✅ `src/app/api/dashboard/pipeline-summary/route.ts`
- ✅ `src/app/api/dashboard/pipeline-drilldown/route.ts`
- ✅ `src/app/api/dashboard/pipeline-sgm-options/route.ts`

**Estimated implementation effort:** ~2-3 hours for a developer familiar with the codebase.
