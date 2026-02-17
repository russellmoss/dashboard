# Pipeline by SGM — Agentic Implementation Guide

> **Purpose**: Step-by-step prompts for Claude Code to implement the "By SGM" stacked bar chart tab on the Open Pipeline page
> **Prerequisite**: Read `open_pipeline_exploration.md` first — it is the verified knowledge base for this feature
> **Date**: 2026-02-17
> **Estimated Time**: ~2-3 hours across all phases

---

## ⚠️ IMPORTANT: Windows Environment

**This project runs on Windows (win32).** All verification commands in this guide use **PowerShell syntax** or cross-platform npm commands. Do NOT use Linux-specific commands like `grep`, `ls -la`, `head`, `wc -l`, or `diff` directly — use the PowerShell equivalents shown in each phase.

**Recharts Import Note**: Recharts v3.6.0 is imported **directly** from 'recharts', NOT bundled via @tremor/react. Always use `import { ... } from 'recharts'`.

---

## How to Use This Guide

1. Open Claude Code in your project root (`C:\Users\russe\Documents\Dashboard`)
2. Copy-paste each **PHASE PROMPT** into Claude Code one at a time
3. After each phase, Claude Code will run its own verification steps and report results
4. Where indicated, YOU perform manual UI/UX checks before proceeding
5. Do NOT skip phases — each phase depends on the previous one passing verification

---

## PHASE 1: Constants and Types

### Prompt

```
Read the file `open_pipeline_exploration.md` in the project root. This is the verified knowledge base for the feature you are building.

You are implementing Phase 1: Constants and Types. Read the following files BEFORE writing any code:

1. Read `src/config/constants.ts` in full
2. Read `src/types/dashboard.ts` — search for "OpenPipeline" and "SgmOption"

Then make these changes:

--- FILE 1: src/config/constants.ts ---

Add these two new exports AFTER the existing OPEN_PIPELINE_STAGES constant:

export const STAGE_STACK_ORDER: readonly string[] = [
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

--- FILE 2: src/types/dashboard.ts ---

Add these two new interfaces AFTER the existing OpenPipelineSummary interface:

export interface SgmPipelineChartData {
  sgm: string;
  totalAum: number;
  totalCount: number;
  // Per-stage AUM values (camelCase keys for Recharts dataKey)
  plannedNurture: number;
  qualifying: number;
  discovery: number;
  salesProcess: number;
  negotiating: number;
  signed: number;
  onHold: number;
  // Per-stage counts (for tooltip display)
  plannedNurtureCount: number;
  qualifyingCount: number;
  discoveryCount: number;
  salesProcessCount: number;
  negotiatingCount: number;
  signedCount: number;
  onHoldCount: number;
}

export interface OpenPipelineBySgmResponse {
  data: SgmPipelineChartData[];
}

Do NOT modify any existing types or constants. Only ADD the new ones.

--- VERIFICATION ---

After making changes, run these commands and report the results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them. (Only show first 30 lines if many errors)

2. Search constants.ts for new exports:
   Run: npx tsx -e "const fs = require('fs'); const c = fs.readFileSync('src/config/constants.ts', 'utf8'); console.log(c.includes('STAGE_STACK_ORDER') && c.includes('STAGE_COLORS') ? 'PASS: Both constants found' : 'FAIL: Missing constants')"
   Or manually verify both STAGE_STACK_ORDER and STAGE_COLORS exist in src/config/constants.ts

3. Search dashboard.ts for new interfaces:
   Run: npx tsx -e "const fs = require('fs'); const c = fs.readFileSync('src/types/dashboard.ts', 'utf8'); console.log(c.includes('SgmPipelineChartData') && c.includes('OpenPipelineBySgmResponse') ? 'PASS: Both interfaces found' : 'FAIL: Missing interfaces')"
   Or manually verify both SgmPipelineChartData and OpenPipelineBySgmResponse exist in src/types/dashboard.ts

4. Read src/config/constants.ts and count exports manually. Should be previous count + 2.

Tell me exactly what you changed, what the verification results were, and whether Phase 1 passes.
```

### Expected Outcome
- `constants.ts` has `STAGE_STACK_ORDER` and `STAGE_COLORS` added
- `dashboard.ts` has `SgmPipelineChartData` and `OpenPipelineBySgmResponse` added
- Zero type errors from `tsc --noEmit`
- No existing code modified

---

## PHASE 2: Query Layer

### Prompt

```
You are implementing Phase 2: Query Layer. This builds on Phase 1 (constants and types).

Read these files BEFORE writing any code:

1. Read `src/lib/queries/open-pipeline.ts` in full — pay close attention to:
   - All imports at the top
   - The _getOpenPipelineSummary function (its WHERE clause construction, parameterization, and return)
   - The _getOpenPipelineRecordsByStage function (how it handles sgm and sgms filters)
   - How cachedQuery wrapping works at the bottom of each function
2. Read `src/types/bigquery-raw.ts` — find toNumber, toString, and any Raw types used
3. Read `src/lib/cache.ts` — confirm cachedQuery signature and CACHE_TAGS

Then add TWO new functions to `src/lib/queries/open-pipeline.ts`. Add them AFTER the existing getOpenPipelineRecordsByStage export.

--- FUNCTION 1: _getOpenPipelineBySgm ---

This function returns raw rows grouped by SGM and Stage. It must use IDENTICAL WHERE conditions as _getOpenPipelineSummary. The ONLY differences are:
- GROUP BY adds SGM_Owner_Name__c
- SELECT adds SGM_Owner_Name__c
- WHERE adds SGM_Owner_Name__c IS NOT NULL (exclude null SGMs)
- ORDER BY is removed (sorting happens client-side by totalAum)

Here is the exact function to add:

const _getOpenPipelineBySgm = async (
  filters?: { stages?: string[]; sgms?: string[] }
): Promise<{ sgm: string; stage: string; count: number; aum: number }[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');

  // Use custom stages if provided, otherwise default to OPEN_PIPELINE_STAGES
  const stagesToUse = filters?.stages && filters.stages.length > 0
    ? filters.stages
    : [...OPEN_PIPELINE_STAGES];

  const stageParams = stagesToUse.map((_, i) => `@stage${i}`);
  conditions.push(`v.StageName IN (${stageParams.join(', ')})`);
  stagesToUse.forEach((stage, i) => {
    params[`stage${i}`] = stage;
  });

  // Add SGM filter if provided
  if (filters?.sgms && filters.sgms.length > 0) {
    const sgmParams = filters.sgms.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgm${i}`] = sgm;
    });
  }

  conditions.push('v.is_sqo_unique = 1');
  conditions.push('v.SGM_Owner_Name__c IS NOT NULL');

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}` : '';

  const query = `
    SELECT
      v.SGM_Owner_Name__c as sgm,
      v.StageName as stage,
      COUNT(DISTINCT v.Full_Opportunity_ID__c) as count,
      SUM(CASE WHEN v.is_primary_opp_record = 1 THEN COALESCE(v.Opportunity_AUM, 0) ELSE 0 END) as aum
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    GROUP BY v.SGM_Owner_Name__c, v.StageName
  `;

  const results = await runQuery<{
    sgm: string | null;
    stage: string | null;
    count: number | null;
    aum: number | null;
  }>(query, params);

  return results.map(r => ({
    sgm: toString(r.sgm),
    stage: toString(r.stage),
    count: toNumber(r.count),
    aum: toNumber(r.aum),
  }));
};

export const getOpenPipelineBySgm = cachedQuery(
  _getOpenPipelineBySgm,
  'getOpenPipelineBySgm',
  CACHE_TAGS.DASHBOARD
);

--- FUNCTION 2: _getOpenPipelineRecordsBySgm ---

This function returns DetailRecord[] for a specific SGM across multiple stages. It follows the EXACT same pattern as _getOpenPipelineRecordsByStage but filters by SGM and uses `StageName IN (...)` instead of a single stage.

Here is the COMPLETE function to add (copy this exactly):

const _getOpenPipelineRecordsBySgm = async (
  sgm: string,
  stages?: string[],
  sgms?: string[]
): Promise<DetailRecord[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    targetSgm: sgm,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');
  conditions.push('v.SGM_Owner_Name__c = @targetSgm');

  // Use custom stages if provided, otherwise default to OPEN_PIPELINE_STAGES
  const stagesToUse = stages && stages.length > 0 ? stages : [...OPEN_PIPELINE_STAGES];
  const stageParams = stagesToUse.map((_, i) => `@stage${i}`);
  conditions.push(`v.StageName IN (${stageParams.join(', ')})`);
  stagesToUse.forEach((stage, i) => {
    params[`stage${i}`] = stage;
  });

  conditions.push('v.is_sqo_unique = 1');

  // Handle SGM multi-select filter (for consistency with page filters)
  // Note: This is in addition to the targetSgm filter - it ensures the targetSgm
  // is within the allowed SGM list if one is provided
  if (sgms && sgms.length > 0) {
    const sgmParams = sgms.map((_, i) => `@sgmFilter${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    sgms.forEach((s, i) => {
      params[`sgmFilter${i}`] = s;
    });
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // EXACT same SELECT columns as _getOpenPipelineRecordsByStage
  const query = `
    SELECT
      v.primary_key as id,
      v.Full_Opportunity_ID__c as opportunity_id,
      v.advisor_name,
      v.Original_source as source,
      IFNULL(v.Channel_Grouping_Name, 'Other') as channel,
      v.StageName as stage,
      v.SGA_Owner_Name__c as sga,
      v.SGM_Owner_Name__c as sgm,
      v.Campaign_Id__c as campaign_id,
      v.Campaign_Name__c as campaign_name,
      v.Lead_Score_Tier__c as lead_score_tier,
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
      v.recordtypeid,
      v.is_primary_opp_record
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    ORDER BY v.Opportunity_AUM DESC NULLS LAST
    LIMIT 1000
  `;

  const results = await runQuery<RawDetailRecordResult>(query, params);

  // EXACT same result mapping as _getOpenPipelineRecordsByStage
  return results.map(r => {
    const extractDate = (field: any): string | null => {
      if (!field) return null;
      if (typeof field === 'string') return field;
      if (typeof field === 'object' && field.value) return field.value;
      return null;
    };

    const filterDate = extractDate(r.filter_date) || '';
    const contactedDate = extractDate(r.contacted_date);
    const mqlDate = extractDate(r.mql_date);
    const sqlDate = extractDate(r.sql_date);
    const sqoDate = extractDate(r.sqo_date);
    const joinedDate = extractDate(r.joined_date);

    let initialCallDate: string | null = null;
    if (r.initial_call_scheduled_date) {
      if (typeof r.initial_call_scheduled_date === 'string') {
        initialCallDate = r.initial_call_scheduled_date;
      } else if (typeof r.initial_call_scheduled_date === 'object' && r.initial_call_scheduled_date.value) {
        initialCallDate = r.initial_call_scheduled_date.value;
      }
    }

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
      campaignId: r.campaign_id ? toString(r.campaign_id) : null,
      campaignName: r.campaign_name ? toString(r.campaign_name) : null,
      leadScoreTier: r.lead_score_tier ? toString(r.lead_score_tier) : null,
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

export const getOpenPipelineRecordsBySgm = cachedQuery(
  _getOpenPipelineRecordsBySgm,
  'getOpenPipelineRecordsBySgm',
  CACHE_TAGS.DASHBOARD
);

--- VERIFICATION ---

After making changes, run these commands and report results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Verify new functions exist in open-pipeline.ts:
   Read src/lib/queries/open-pipeline.ts and confirm these 4 items exist:
   - Function: _getOpenPipelineBySgm
   - Export: getOpenPipelineBySgm (wrapped with cachedQuery)
   - Function: _getOpenPipelineRecordsBySgm
   - Export: getOpenPipelineRecordsBySgm (wrapped with cachedQuery)

3. WHERE clause parity check — Read BOTH _getOpenPipelineBySgm and _getOpenPipelineSummary and confirm they share these identical conditions:
   - v.recordtypeid = @recruitingRecordType ✓
   - v.StageName IN (parameterized stage list) ✓
   - v.is_sqo_unique = 1 ✓
   - SGM filter (if provided) ✓
   The ONLY additional condition in _getOpenPipelineBySgm should be: v.SGM_Owner_Name__c IS NOT NULL
   Report: do the WHERE conditions match?

4. Count cachedQuery exports — Read open-pipeline.ts and count how many `cachedQuery(` calls exist.
   Should be previous count (3) + 2 = 5 total.

5. SELECT column parity check — Read both _getOpenPipelineRecordsBySgm and _getOpenPipelineRecordsByStage.
   Confirm the SELECT columns are IDENTICAL (same fields, same aliases).
   Report: do they match?

Tell me exactly what you changed, what the verification results were, and whether Phase 2 passes.
```

### Expected Outcome
- Two new query functions added to `open-pipeline.ts`
- WHERE conditions in `_getOpenPipelineBySgm` match `_getOpenPipelineSummary` exactly (plus `IS NOT NULL`)
- SELECT columns in `_getOpenPipelineRecordsBySgm` match `_getOpenPipelineRecordsByStage` exactly
- Both wrapped with `cachedQuery`
- Zero type errors

---

## PHASE 3: API Routes

### Prompt

```
You are implementing Phase 3: API Routes. This builds on Phases 1-2.

Read these files BEFORE writing any code:

1. Read `src/app/api/dashboard/pipeline-summary/route.ts` in full (this is your template for route 1)
2. Read `src/app/api/dashboard/pipeline-drilldown/route.ts` in full (this is your template for route 2)
3. Read `src/lib/api-authz.ts` in full (for forbidRecruiter, forbidCapitalPartner)
4. Read `src/types/auth.ts` — find getSessionPermissions
5. Read `src/lib/auth.ts` — find authOptions export

Then create TWO new route files:

--- FILE 1: src/app/api/dashboard/pipeline-by-sgm/route.ts ---

Model this EXACTLY on pipeline-summary/route.ts with these differences:
- Add a revops_admin role check AFTER the forbidRecruiter/forbidCapitalPartner checks
- Import getOpenPipelineBySgm from '@/lib/queries/open-pipeline'
- Import SgmPipelineChartData from '@/types/dashboard'
- Import STAGE_STACK_ORDER from '@/config/constants'
- Pivot the raw query results into SgmPipelineChartData[] format
- Sort by totalAum descending before returning

The pivot logic (put this in a helper function inside the route file):

function stageToKey(stage: string): string {
  const map: Record<string, string> = {
    'Planned Nurture': 'plannedNurture',
    'Qualifying': 'qualifying',
    'Discovery': 'discovery',
    'Sales Process': 'salesProcess',
    'Negotiating': 'negotiating',
    'Signed': 'signed',
    'On Hold': 'onHold',
  };
  return map[stage] || stage.toLowerCase().replace(/\s+/g, '');
}

function pivotBySgm(
  rows: { sgm: string; stage: string; count: number; aum: number }[]
): SgmPipelineChartData[] {
  const sgmMap = new Map<string, SgmPipelineChartData>();

  for (const row of rows) {
    if (!sgmMap.has(row.sgm)) {
      sgmMap.set(row.sgm, {
        sgm: row.sgm,
        totalAum: 0,
        totalCount: 0,
        plannedNurture: 0, qualifying: 0, discovery: 0,
        salesProcess: 0, negotiating: 0, signed: 0, onHold: 0,
        plannedNurtureCount: 0, qualifyingCount: 0, discoveryCount: 0,
        salesProcessCount: 0, negotiatingCount: 0, signedCount: 0, onHoldCount: 0,
      });
    }
    const entry = sgmMap.get(row.sgm)!;
    const key = stageToKey(row.stage);

    // Set AUM for this stage
    (entry as any)[key] = row.aum;
    // Set count for this stage
    (entry as any)[`${key}Count`] = row.count;
    // Accumulate totals
    entry.totalAum += row.aum;
    entry.totalCount += row.count;
  }

  // Sort by totalAum descending (highest pipeline first)
  return [...sgmMap.values()].sort((a, b) => b.totalAum - a.totalAum);
}

The route handler:

export async function POST(request: NextRequest) {
  // 1. Auth check — copy EXACT pattern from pipeline-summary/route.ts
  // 2. ADDITIONAL CHECK — revops_admin only:
  //    if (permissions.role !== 'revops_admin') {
  //      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  //    }
  // 3. Parse body: const { stages, sgms } = await request.json();
  // 4. Call getOpenPipelineBySgm({ stages, sgms })
  // 5. Pivot with pivotBySgm(rows)
  // 6. Return NextResponse.json({ data: pivotedData })
}

Include: export const dynamic = 'force-dynamic';

--- FILE 2: src/app/api/dashboard/pipeline-drilldown-sgm/route.ts ---

Model this EXACTLY on pipeline-drilldown/route.ts with these differences:
- Import getOpenPipelineRecordsBySgm from '@/lib/queries/open-pipeline'
- Accept body: { sgm: string, stages?: string[], sgms?: string[] }
- Validate that sgm is provided (return 400 if not)
- Call getOpenPipelineRecordsBySgm(sgm, stages, sgms)
- Return { records, sgm }
- Do NOT add a revops_admin check (the summary endpoint gates access; the drilldown just needs standard auth)

Include: export const dynamic = 'force-dynamic';

--- VERIFICATION ---

After creating both files, run these commands and report results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Confirm both route files exist:
   - Read: src/app/api/dashboard/pipeline-by-sgm/route.ts
   - Read: src/app/api/dashboard/pipeline-drilldown-sgm/route.ts
   Report: do both files exist and contain valid route handlers?

3. Read src/app/api/dashboard/pipeline-by-sgm/route.ts and confirm:
   - Has `permissions?.role !== 'revops_admin'` check that returns 403
   - Imports and uses: forbidRecruiter, forbidCapitalPartner, getSessionPermissions, getServerSession
   - Has `export const dynamic = 'force-dynamic'`

4. Read src/app/api/dashboard/pipeline-drilldown-sgm/route.ts and confirm:
   - Has NO revops_admin check (only standard auth)
   - Imports and uses: forbidRecruiter, forbidCapitalPartner, getSessionPermissions, getServerSession
   - Has `export const dynamic = 'force-dynamic'`

Tell me exactly what you created, what the verification results were, and whether Phase 3 passes.
```

### Expected Outcome
- Two new API route files created
- `pipeline-by-sgm` has revops_admin check + standard auth
- `pipeline-drilldown-sgm` has standard auth only (no revops_admin check)
- Both have `force-dynamic` export
- Zero type errors

---

## PHASE 4: API Client Functions

### Prompt

```
You are implementing Phase 4: API Client Functions. This builds on Phases 1-3.

Read this file BEFORE writing any code:

1. Read `src/lib/api-client.ts` — find the existing getPipelineSummary and getPipelineDrilldown functions (around lines 320-379)

Then add TWO new functions to the dashboardApi object in `src/lib/api-client.ts`. Add them AFTER the existing getPipelineDrilldown function.

--- FUNCTION 1: getPipelineBySgm ---

Match the EXACT pattern of getPipelineSummary (fetch, error handling, return):

getPipelineBySgm: async (stages?: string[], sgms?: string[]): Promise<{ data: SgmPipelineChartData[] }> => {
  const response = await fetch('/api/dashboard/pipeline-by-sgm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stages, sgms }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch pipeline by SGM data');
  }

  return response.json();
},

--- FUNCTION 2: getPipelineDrilldownBySgm ---

Match the EXACT pattern of getPipelineDrilldown:

getPipelineDrilldownBySgm: async (
  sgm: string,
  stages?: string[],
  sgms?: string[]
): Promise<{ records: DetailRecord[]; sgm: string }> => {
  const response = await fetch('/api/dashboard/pipeline-drilldown-sgm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sgm, stages, sgms }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch SGM drill-down data');
  }

  return response.json();
},

IMPORTANT: You also need to add the SgmPipelineChartData import at the top of api-client.ts. Find the existing import from '@/types/dashboard' and add SgmPipelineChartData to it.

--- VERIFICATION ---

After making changes, run these commands and report results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Read src/lib/api-client.ts and confirm:
   - `getPipelineBySgm` function exists in dashboardApi object
   - `getPipelineDrilldownBySgm` function exists in dashboardApi object
   - `SgmPipelineChartData` is imported from '@/types/dashboard'

3. Verify the new functions:
   - `getPipelineBySgm` calls `/api/dashboard/pipeline-by-sgm` with POST method
   - `getPipelineDrilldownBySgm` calls `/api/dashboard/pipeline-drilldown-sgm` with POST method
   - Both have proper error handling matching existing patterns

Tell me exactly what you changed, what the verification results were, and whether Phase 4 passes.
```

### Expected Outcome
- Two new functions added to `dashboardApi`
- `SgmPipelineChartData` imported
- Both functions match the existing fetch/error pattern
- Zero type errors

---

## PHASE 5: Chart Component

### Prompt

```
You are implementing Phase 5: Chart Component. This is the most complex phase.

Read these files BEFORE writing any code:

1. Read `src/components/dashboard/PipelineByStageChart.tsx` in full — this is your template for:
   - Recharts imports
   - Dark mode theming pattern (useTheme, isDark, color variables)
   - AUM formatters (formatAumAxis, formatAumTooltip, formatAumLabel)
   - Custom tooltip component pattern
   - LabelList custom content renderer pattern
   - ResponsiveContainer / BarChart setup
   - Loading and empty states
2. Read `src/config/constants.ts` — confirm STAGE_STACK_ORDER and STAGE_COLORS are present (from Phase 1)
3. Read `src/types/dashboard.ts` — confirm SgmPipelineChartData interface (from Phase 1)

Then create: src/components/dashboard/PipelineBySgmChart.tsx

This component renders a STACKED bar chart where:
- X-axis = SGM names (clickable)
- Y-axis = AUM in millions (left axis only, no dual axis)
- Each SGM has one stacked bar with segments per stage
- Stages stack bottom-to-top per STAGE_STACK_ORDER
- Only stages present in selectedStages prop are rendered
- Data is pre-sorted by totalAum descending (done in API route)

Here is the component structure. Write the FULL component:

IMPORTS (use these exact import statements):
```typescript
import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LabelList,
} from 'recharts';  // IMPORTANT: Import directly from 'recharts', NOT from @tremor/react
import { useTheme } from 'next-themes';
import { STAGE_STACK_ORDER, STAGE_COLORS } from '@/config/constants';
import { SgmPipelineChartData } from '@/types/dashboard';
```

HELPER: stageToKey function (same as in API route — converts 'Sales Process' → 'salesProcess')

function stageToKey(stage: string): string {
  const map: Record<string, string> = {
    'Planned Nurture': 'plannedNurture',
    'Qualifying': 'qualifying',
    'Discovery': 'discovery',
    'Sales Process': 'salesProcess',
    'Negotiating': 'negotiating',
    'Signed': 'signed',
    'On Hold': 'onHold',
  };
  return map[stage] || stage.toLowerCase().replace(/\s+/g, '');
}

AUM FORMATTERS: Copy these EXACTLY from PipelineByStageChart.tsx (lines 33-70):

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

const formatAumLabel = (value: number) => {
  if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`;
  if (value >= 1000000) return `$${Math.round(value / 1000000)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return `$${value.toLocaleString()}`;
};

PROPS INTERFACE:
interface PipelineBySgmChartProps {
  data: SgmPipelineChartData[];
  selectedStages: string[];
  onSegmentClick: (sgm: string, stage: string) => void;
  onSgmClick: (sgm: string) => void;
  loading?: boolean;
}

CUSTOM X-AXIS TICK (for clickable SGM names):
const CustomXAxisTick = ({ x, y, payload, onClick, isDark }: any) => {
  const name = payload?.value || '';
  // Truncate long names to 15 chars with ellipsis
  const displayName = name.length > 15 ? name.substring(0, 14) + '…' : name;
  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={16}
        textAnchor="middle"
        fill={isDark ? '#60a5fa' : '#2563eb'}
        fontSize={13}
        fontWeight={600}
        style={{ cursor: 'pointer', textDecoration: 'underline' }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(name);
        }}
      >
        {displayName}
      </text>
    </g>
  );
};

CUSTOM TOOLTIP (shows all stages for the hovered SGM):
Build a CustomTooltip component that:
- Shows the SGM name as the header
- Lists each stage that has aum > 0 OR count > 0, showing both AUM (formatted) and count
- Shows a total row at the bottom with totalAum and totalCount
- Shows "Click a segment to drill down" footer text
- Uses the same dark mode styling pattern as PipelineByStageChart's CustomTooltip
- For each stage row, show the stage color dot (from STAGE_COLORS)

Access the data: The tooltip payload from a stacked bar contains all dataKeys. You need to access the original data entry. Use: const dataEntry = payload?.[0]?.payload as SgmPipelineChartData;

LABEL LIST RENDERER:
Create a renderTotalAumLabel function that:
- Shows the total AUM above each stacked bar
- Uses formatAumLabel to format the value
- The value comes from the data entry's totalAum field
- Position it above the topmost segment
- Match the text styling from PipelineByStageChart's renderAumLabel

KEY IMPLEMENTATION DETAIL FOR LABEL ON STACKED BAR:
Attach the LabelList to the LAST Bar rendered (which is the topmost segment). However, use a custom content renderer that accesses the data entry's totalAum field, NOT the segment's own value. This way the label always shows the total regardless of which segment is on top.

const renderTotalAumLabel = (props: any) => {
  const { x = 0, y = 0, width = 0, index } = props;
  if (index === undefined || !data[index]) return null;
  const entry = data[index];
  if (!entry.totalAum || entry.totalAum === 0) return null;

  const displayValue = formatAumLabel(entry.totalAum);
  return (
    <text
      x={x + width / 2}
      y={y - 8}
      fill={isDark ? '#f9fafb' : '#111827'}
      textAnchor="middle"
      fontSize={13}
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

CHART STRUCTURE:
1. Wrap in <div className="h-[75vh] min-h-[600px]">
2. <ResponsiveContainer width="100%" height="100%">
3. <BarChart data={data} margin={{ top: 40, right: 30, left: 20, bottom: 20 }} barCategoryGap="15%">
4. <CartesianGrid strokeDasharray="5 5" stroke={gridColor} vertical={false} />
5. <XAxis dataKey="sgm" tick={<CustomXAxisTick onClick={onSgmClick} isDark={isDark} />} axisLine={{ stroke: gridColor }} interval={0} />
6. <YAxis tickFormatter={formatAumAxis} tick styling matching existing chart, label "AUM ($)" on left
7. <Tooltip content={<CustomTooltip />} />
8. <Legend formatter that maps camelCase keys back to stage display names />
9. For each stage in STAGE_STACK_ORDER: IF that stage is in selectedStages, render a <Bar>:
   - dataKey={stageToKey(stage)}
   - stackId="pipeline"
   - fill={STAGE_COLORS[stage]}
   - name={stage} (for legend display)
   - cursor="pointer"
   - onClick handler that extracts sgm from the clicked data entry and calls onSegmentClick(sgm, stage)
10. The LAST rendered <Bar> (topmost in stack) gets: <LabelList content={renderTotalAumLabel} />

LOADING STATE: Match PipelineByStageChart loading state pattern
EMPTY STATE: Match PipelineByStageChart empty state pattern

Export the component as a named export: export function PipelineBySgmChart({ ... })

--- VERIFICATION ---

After creating the file, run these commands and report results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them. Recharts type issues are common — use `as any` for event handler props if needed.

2. Read src/components/dashboard/PipelineBySgmChart.tsx and verify:
   - File exists and compiles
   - Has named export: `export function PipelineBySgmChart`
   - Imports from 'recharts' (NOT from @tremor/react): BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList
   - Imports from '@/config/constants': STAGE_STACK_ORDER, STAGE_COLORS
   - Imports from '@/types/dashboard': SgmPipelineChartData
   - Uses `stackId="pipeline"` on Bar components
   - Has `onSegmentClick` and `onSgmClick` props wired up
   - Has CustomXAxisTick component with onClick handler
   - Has CustomTooltip component
   - Has renderTotalAumLabel function
   - File is approximately 200-350 lines

Tell me exactly what you created, what the verification results were, and whether Phase 5 passes.
```

### Expected Outcome
- New chart component created with stacked bars, clickable x-axis, custom tooltip
- All Recharts imports from same path as existing chart
- Dark mode theming matches existing chart
- Zero type errors (or only Recharts `any` casts)

---

## PHASE 6: Pipeline Page Integration

### Prompt

```
You are implementing Phase 6: Pipeline Page Integration. This is the final code phase.

Read this file BEFORE writing any code:

1. Read `src/app/dashboard/pipeline/page.tsx` in full — understand every state variable, every handler, every piece of JSX

Then modify `src/app/dashboard/pipeline/page.tsx` with these changes:

--- NEW IMPORTS ---

Add to the existing imports:
- import { PipelineBySgmChart } from '@/components/dashboard/PipelineBySgmChart';
- import { SgmPipelineChartData } from '@/types/dashboard';

--- NEW STATE VARIABLES ---

Add after the existing selectedRecordId state (around line 70):

// Tab state (By Stage vs By SGM) — revops_admin only feature
const [activeTab, setActiveTab] = useState<'byStage' | 'bySgm'>('byStage');

// By SGM data
const [bySgmData, setBySgmData] = useState<SgmPipelineChartData[]>([]);
const [bySgmLoading, setBySgmLoading] = useState(false);

// SGM drill-down tracking
const [drillDownSgm, setDrillDownSgm] = useState<string | null>(null);

--- PERMISSION CHECK ---

Add after the existing permissions line (around line 24):

const isRevOpsAdmin = permissions?.role === 'revops_admin';

--- NEW FETCH FUNCTION ---

Add a fetchBySgmData function (similar pattern to existing fetchData):

const fetchBySgmData = useCallback(async () => {
  if (activeTab !== 'bySgm') return;
  setBySgmLoading(true);
  try {
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined :
      selectedSgms.length === 0 ? undefined : selectedSgms;
    const result = await dashboardApi.getPipelineBySgm(
      selectedStages.length > 0 ? selectedStages : undefined,
      sgmsToSend
    );
    setBySgmData(result.data);
  } catch (err) {
    console.error('Error fetching by-SGM data:', err);
    setBySgmData([]);
  } finally {
    setBySgmLoading(false);
  }
}, [activeTab, selectedStages, selectedSgms, sgmOptions.length]);

--- NEW useEffect ---

Add a useEffect to trigger fetchBySgmData:

useEffect(() => {
  if (activeTab === 'bySgm' && isRevOpsAdmin) {
    fetchBySgmData();
  }
}, [activeTab, isRevOpsAdmin, fetchBySgmData]);

--- NEW CLICK HANDLERS ---

Add handleSegmentClick (drill down to specific SGM + stage):

const handleSegmentClick = async (sgm: string, stage: string) => {
  setDrillDownStage(stage);
  setDrillDownSgm(sgm);
  setDrillDownMetric('aum');
  setDrillDownOpen(true);
  setDrillDownLoading(true);

  try {
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
    const result = await dashboardApi.getPipelineDrilldown(stage, { sgm }, sgmsToSend);
    setDrillDownRecords(result.records);
  } catch (err) {
    console.error('Error fetching segment drill-down:', err);
    setDrillDownRecords([]);
  } finally {
    setDrillDownLoading(false);
  }
};

Add handleSgmClick (drill down to all stages for one SGM):

const handleSgmClick = async (sgm: string) => {
  setDrillDownStage(null);
  setDrillDownSgm(sgm);
  setDrillDownMetric(null);
  setDrillDownOpen(true);
  setDrillDownLoading(true);

  try {
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
    const result = await dashboardApi.getPipelineDrilldownBySgm(
      sgm,
      selectedStages.length > 0 ? selectedStages : undefined,
      sgmsToSend
    );
    setDrillDownRecords(result.records);
  } catch (err) {
    console.error('Error fetching SGM drill-down:', err);
    setDrillDownRecords([]);
  } finally {
    setDrillDownLoading(false);
  }
};

--- MODIFY handleCloseDrillDown ---

Find the existing handleCloseDrillDown function and add drillDownSgm reset:

Add this line: setDrillDownSgm(null);
(alongside the existing setDrillDownRecords([]), setDrillDownStage(null), setDrillDownMetric(null) calls)

--- MODIFY DRILL-DOWN MODAL TITLE ---

Find the existing VolumeDrillDownModal JSX. Replace its `title` prop with logic that includes SGM name when available:

title={
  drillDownSgm
    ? drillDownStage
      ? `${drillDownSgm} — ${drillDownStage}`
      : `${drillDownSgm} — All Open Pipeline`
    : drillDownStage
      ? `${drillDownStage} Stage`
      : selectedStages.length === OPEN_PIPELINE_STAGES.length &&
        OPEN_PIPELINE_STAGES.every(s => selectedStages.includes(s))
        ? 'Open Pipeline - All Stages'
        : `Open Pipeline - ${selectedStages.length} Stage${selectedStages.length > 1 ? 's' : ''}`
}

--- MODIFY RecordDetailModal BACK BUTTON ---

Find the existing RecordDetailModal JSX. Update the backButtonLabel to include SGM context:

backButtonLabel={`← Back to ${drillDownSgm ? drillDownSgm + (drillDownStage ? ' — ' + drillDownStage : '') : drillDownStage || 'list'}`}

--- ADD TAB TOGGLE UI ---

Find the {/* Bar Chart with Export */} comment and the <Card> that wraps the chart. Insert the tab toggle BEFORE this Card, but AFTER the PipelineFilters div:

{/* Tab Toggle — revops_admin only */}
{isRevOpsAdmin && (
  <div className="flex gap-1 mb-4">
    <button
      onClick={() => setActiveTab('byStage')}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        activeTab === 'byStage'
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      By Stage
    </button>
    <button
      onClick={() => setActiveTab('bySgm')}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        activeTab === 'bySgm'
          ? 'bg-blue-600 text-white'
          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      By SGM
    </button>
  </div>
)}

--- MODIFY CHART CARD ---

Replace the existing chart Card content with conditional rendering. Keep the Card wrapper. The changes:

1. Update the header text inside the Card:
   - If activeTab === 'byStage': keep existing "Pipeline by Stage" / "Click any bar..."
   - If activeTab === 'bySgm': use "Pipeline by SGM" / "Click a segment or SGM name to drill down"

2. Update the PipelineExportPng:
   - If activeTab === 'byStage': keep existing chartElementId="pipeline-by-stage-chart"
   - If activeTab === 'bySgm': use chartElementId="pipeline-by-sgm-chart"

3. Conditionally render the chart:
   - If activeTab === 'byStage': render existing PipelineByStageChart exactly as before (no changes)
   - If activeTab === 'bySgm': render:
     <div id="pipeline-by-sgm-chart" className="bg-white dark:bg-gray-800 p-4 rounded-lg"
       style={{ backgroundColor: resolvedTheme === 'dark' ? '#1f2937' : '#ffffff' }}>
       <PipelineBySgmChart
         data={bySgmData}
         selectedStages={selectedStages}
         onSegmentClick={handleSegmentClick}
         onSgmClick={handleSgmClick}
         loading={bySgmLoading}
       />
     </div>

IMPORTANT: The existing PipelineByStageChart rendering and its wrapper div with id="pipeline-by-stage-chart" must remain UNTOUCHED. Only wrap it in a conditional.

--- VERIFICATION ---

After making changes, run these commands and report results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Read src/app/dashboard/pipeline/page.tsx and verify these NEW items exist:
   - Import: `import { PipelineBySgmChart } from '@/components/dashboard/PipelineBySgmChart'`
   - Import: `SgmPipelineChartData` from '@/types/dashboard'
   - State: `activeTab` with type `'byStage' | 'bySgm'`
   - State: `bySgmData` with type `SgmPipelineChartData[]`
   - State: `bySgmLoading` with type `boolean`
   - State: `drillDownSgm` with type `string | null`
   - Variable: `isRevOpsAdmin` checking `permissions?.role === 'revops_admin'`
   - Function: `fetchBySgmData` (useCallback)
   - Function: `handleSegmentClick(sgm, stage)`
   - Function: `handleSgmClick(sgm)`
   - Tab toggle UI (only visible when isRevOpsAdmin)
   - Conditional rendering: PipelineByStageChart when activeTab === 'byStage', PipelineBySgmChart when activeTab === 'bySgm'

3. Verify handleCloseDrillDown includes: `setDrillDownSgm(null)`

4. Verify VolumeDrillDownModal title includes drillDownSgm logic

5. Run: npx next lint
   Report: any lint errors? (warnings OK)

Tell me exactly what you changed, what the verification results were, and whether Phase 6 passes.
```

### Expected Outcome
- Pipeline page has tab toggle (revops_admin only)
- "By Stage" view unchanged for all users
- "By SGM" view renders stacked bar chart
- Both drill-down interactions wired up
- Modal titles include SGM context
- Zero type errors, zero lint errors

---

## PHASE 7: Build and Type Check

### Prompt

```
You are implementing Phase 7: Full Build Verification. No new code — just validation.

Run these commands IN ORDER and report ALL results:

1. Run: npx tsc --noEmit
   Report: FULL output. Fix ANY type errors before proceeding.

2. Run: npx next lint
   Report: FULL output. Fix any errors (warnings are OK).

3. Run: npx next build
   Report: Does the build succeed? If not, paste the errors and fix them.

4. Verify imports in new API routes by reading:
   - src/app/api/dashboard/pipeline-by-sgm/route.ts — confirm it imports getOpenPipelineBySgm from '@/lib/queries/open-pipeline'
   - src/app/api/dashboard/pipeline-drilldown-sgm/route.ts — confirm it imports getOpenPipelineRecordsBySgm from '@/lib/queries/open-pipeline'

5. Verify PipelineBySgmChart import:
   Read src/app/dashboard/pipeline/page.tsx and confirm it's the ONLY file importing PipelineBySgmChart

6. Cross-check the complete file inventory — confirm ALL 8 files exist:
   - src/config/constants.ts (modified)
   - src/types/dashboard.ts (modified)
   - src/lib/queries/open-pipeline.ts (modified)
   - src/lib/api-client.ts (modified)
   - src/components/dashboard/PipelineBySgmChart.tsx (created)
   - src/app/api/dashboard/pipeline-by-sgm/route.ts (created)
   - src/app/api/dashboard/pipeline-drilldown-sgm/route.ts (created)
   - src/app/dashboard/pipeline/page.tsx (modified)

7. Final WHERE clause parity check:
   Read src/lib/queries/open-pipeline.ts and compare _getOpenPipelineBySgm vs _getOpenPipelineSummary.
   List every WHERE condition in each. Confirm they share:
   - v.recordtypeid = @recruitingRecordType ✓
   - v.StageName IN (parameterized) ✓
   - v.is_sqo_unique = 1 ✓
   - SGM filter (if provided) ✓
   And _getOpenPipelineBySgm additionally has:
   - v.SGM_Owner_Name__c IS NOT NULL ✓
   Report: do they match? Any discrepancies?

If ALL checks pass, tell me: "Phase 7 PASSES — ready for UI/UX testing."
If any check fails, fix the issue and re-run that check until it passes.
```

### Expected Outcome
- Zero type errors
- Zero lint errors
- Build succeeds
- All files exist
- WHERE clause parity confirmed

---

## PHASE 8: UI/UX Manual Testing

> **This phase is for YOU (Russell), not Claude Code.** Start your dev server (`npm run dev`) and test the following.

### 8.1 — Access Control Testing

| Test | Steps | Expected Result |
|------|-------|-----------------|
| RevOps admin sees tabs | Log in as revops_admin → Go to Open Pipeline | Two tab buttons visible: "By Stage" and "By SGM" |
| Non-admin sees no tabs | Log in as any other role → Go to Open Pipeline | No tab buttons visible. Page looks identical to before. |
| "By Stage" is default | Log in as revops_admin → Go to Open Pipeline | "By Stage" tab is active (blue). Existing chart shows. |
| API blocks non-admin | In browser console: `fetch('/api/dashboard/pipeline-by-sgm', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }).then(r => r.json()).then(console.log)` while logged in as non-revops_admin | Response: `{ error: 'Forbidden' }` with 403 status |

### 8.2 — Chart Rendering

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Chart loads | Click "By SGM" tab | Stacked bar chart appears with SGM names on x-axis |
| Sort order | Observe bars left-to-right | Leftmost bar has highest total AUM, rightmost has lowest |
| Stage colors | Observe bar segments | Each stage has a distinct color matching the legend |
| Stage stack order | Observe segment order within a bar | Bottom-to-top: Planned Nurture → Qualifying → Discovery → Sales Process → Negotiating → Signed → On Hold (only stages in filter appear) |
| Default stages | No filter changes | Only 4 segments visible: Qualifying, Discovery, Sales Process, Negotiating |
| AUM labels | Observe above each bar | Total AUM shown (e.g., "$9.2B", "$2.2B") |
| Tooltip | Hover over any segment | Shows SGM name, all stages with AUM + count, total row |
| SGM names clickable | Observe x-axis labels | Names are blue, underlined, cursor changes to pointer on hover |
| Dark mode | Toggle dark mode | Chart colors, grid, text all adapt properly |
| Empty state | Filter to stages with no data | Shows "No data available" message |

### 8.3 — Drill-Down Testing

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Segment click | Click a colored segment (e.g., Discovery for Bre McDaniel) | Modal opens titled "Bre McDaniel — Discovery" showing only Discovery records for that SGM |
| SGM name click | Click an SGM name on x-axis | Modal opens titled "[SGM Name] — All Open Pipeline" showing all records across all selected stages |
| Record count check | Click a segment → count records in modal | Count matches the number shown in the tooltip for that segment |
| Record detail | Click any row in the drill-down modal | Record detail modal opens with Salesforce link |
| Back button | In record detail, click back button | Returns to drill-down list. Back button label includes SGM name. |
| Close modal | Click X or outside modal | Modal closes. Chart remains on "By SGM" tab. |

### 8.4 — Filter Interaction Testing

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Add stages | Open filters → add "Signed" and "On Hold" → Apply | New segments appear in the stacked bars for those stages |
| Remove stages | Open filters → deselect "Qualifying" → Apply | Qualifying segments disappear from all bars. Totals update. |
| Filter SGMs | Open filters → deselect some SGMs → Apply | Deselected SGMs disappear from chart |
| Filters persist across tabs | Set custom filters → switch to "By Stage" → switch back to "By SGM" | Same filters are still applied. Chart shows filtered data. |
| Reset filters | Click reset → Apply | Returns to default 4 stages + all SGMs |
| Scorecard consistency | Compare scorecard totals on "By Stage" and "By SGM" tabs | Totals should be identical (same underlying data, same filters) |

### 8.5 — Data Parity Testing

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Total AUM matches | Sum all bar totals visually on "By SGM" tab | Should match the AUM scorecard number and the "By Stage" total |
| Per-SGM spot check | Pick one SGM → note their total from "By SGM" tooltip → switch to "By Stage" → filter to just that SGM | AUM should match |
| Per-stage spot check | Pick one stage → sum that stage's segment across all SGMs on "By SGM" → compare to "By Stage" bar for that stage | AUM should match |

### 8.6 — PNG Export Testing

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Export "By SGM" chart | Click export PNG button while on "By SGM" tab | Downloads a PNG image of the stacked bar chart |
| Export preserves colors | Open the exported PNG | All stage colors, labels, and SGM names are visible and readable |

---

## PHASE 9: Post-Launch Fixes (If Needed)

### Prompt for fixing issues found in UI/UX testing

```
I completed UI/UX testing for the Pipeline by SGM feature. Here are the issues I found:

[PASTE YOUR ISSUES HERE]

For each issue:
1. Read the relevant file before making changes
2. Make the minimal fix needed
3. Run npx tsc --noEmit after each fix
4. Tell me what you changed and why

Do NOT refactor or restructure anything. Only fix the specific issues listed above.
```

---

## Quick Reference: All Files Created/Modified

| File | Action | Phase |
|------|--------|-------|
| `src/config/constants.ts` | Modified (added 2 exports) | Phase 1 |
| `src/types/dashboard.ts` | Modified (added 2 interfaces) | Phase 1 |
| `src/lib/queries/open-pipeline.ts` | Modified (added 2 query functions) | Phase 2 |
| `src/app/api/dashboard/pipeline-by-sgm/route.ts` | Created | Phase 3 |
| `src/app/api/dashboard/pipeline-drilldown-sgm/route.ts` | Created | Phase 3 |
| `src/lib/api-client.ts` | Modified (added 2 client functions) | Phase 4 |
| `src/components/dashboard/PipelineBySgmChart.tsx` | Created | Phase 5 |
| `src/app/dashboard/pipeline/page.tsx` | Modified (tab toggle, handlers, conditional rendering) | Phase 6 |
