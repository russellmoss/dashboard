# SGM Conversion Table & SQL Date Filter — Agentic Implementation Guide

> **Purpose**: Step-by-step prompts for Claude Code to implement the SQL Date Filter and SGM Conversion & Velocity Table on the "By SGM" tab of the Open Pipeline page
> **Prerequisites**:
>   - The "By SGM" stacked bar chart tab is already implemented per `pipeline_by_sgm_implementation_guide.md`
>   - Read `sgm_conversion_table_findings.md` — it is the verified knowledge base for this feature
> **Date**: 2026-02-17

---

## ⚠️ IMPORTANT: Windows Environment

**This project runs on Windows (win32).** All verification commands in this guide use **PowerShell syntax** or cross-platform npm commands. Do NOT use Linux-specific commands like `grep`, `ls -la`, `head`, `wc -l`, or `diff` directly — use the PowerShell equivalents shown in each phase.

**Tremor v3.18.7**: Table components (`Table`, `TableHead`, `TableRow`, `TableHeaderCell`, `TableBody`, `TableCell`) are from `@tremor/react`.

**Lucide Icons**: Sort arrows use `ChevronUp`/`ChevronDown` from `lucide-react`.

---

## How to Use This Guide

1. Open Claude Code in your project root (`C:\Users\russe\Documents\Dashboard`)
2. Copy-paste each **PHASE PROMPT** into Claude Code one at a time
3. After each phase, Claude Code will run its own verification steps and report results
4. Where indicated, YOU perform manual UI/UX checks before proceeding
5. Do NOT skip phases — each phase depends on the previous one passing verification
6. After each phase, Claude Code will STOP and ask you to confirm before proceeding

---

## Quick Reference: All Files Created/Modified

| File | Action | Phase |
|------|--------|-------|
| `src/types/dashboard.ts` | Modified (added 2 interfaces) | Phase 1 |
| `src/lib/utils/date-helpers.ts` | Modified (added 1 function) | Phase 1 |
| `src/lib/queries/open-pipeline.ts` | Modified (added 1 query function, modified 3 existing functions) | Phase 2 |
| `src/app/api/dashboard/sgm-conversions/route.ts` | Created | Phase 3 |
| `src/app/api/dashboard/pipeline-by-sgm/route.ts` | Modified (accept dateRange param) | Phase 3 |
| `src/app/api/dashboard/pipeline-drilldown-sgm/route.ts` | Modified (accept dateRange param) | Phase 3 |
| `src/app/api/dashboard/pipeline-drilldown/route.ts` | Modified (accept dateRange param) | Phase 3 |
| `src/lib/api-client.ts` | Modified (added 1 function, modified 3 functions) | Phase 4 |
| `src/components/dashboard/SqlDateFilter.tsx` | Created | Phase 5 |
| `src/components/dashboard/SgmConversionTable.tsx` | Created | Phase 6 |
| `src/app/dashboard/pipeline/page.tsx` | Modified (state, fetch functions, rendering) | Phase 7 |

---

## PHASE 1: Types and Utilities

### Prompt

```
Read the file `sgm_conversion_table_findings.md` in the project root. This is the verified knowledge base for the feature you are building.

You are implementing Phase 1: Types and Utilities. Read the following files BEFORE writing any code:

1. Read `src/types/dashboard.ts` — search for "OpenPipelineBySgmResponse" and "SgmPipelineChartData" to confirm Phase 1 of the previous implementation is in place
2. Read `src/lib/utils/date-helpers.ts` in full — note all existing exports

Then make these changes:

--- FILE 1: src/types/dashboard.ts ---

Add these two new interfaces AFTER the existing OpenPipelineBySgmResponse interface. Do NOT modify any existing types.

/**
 * SGM Conversion data for the conversion table on the By SGM tab.
 * Returned by /api/dashboard/sgm-conversions endpoint.
 */
export interface SgmConversionData {
  sgm: string;
  sqlsReceived: number;
  sqlToSqoRate: number;
  sqosCount: number;
  sqoToJoinedRate: number;
  joinedCount: number;
  sqlToSqoNumer?: number;
  sqlToSqoDenom?: number;
  sqoToJoinedNumer?: number;
  sqoToJoinedDenom?: number;
}

/**
 * Date range state for the SQL Date Filter component.
 * null = "All Time" (no date filtering).
 */
export interface SqlDateRange {
  preset: 'alltime' | 'q1' | 'q2' | 'q3' | 'q4' | 'ytd' | 'qtd' | 'custom';
  year: number;
  startDate: string | null;
  endDate: string | null;
}

--- FILE 2: src/lib/utils/date-helpers.ts ---

Add this new export function at the END of the file. Add the import for SqlDateRange at the top of the file with the other imports.

Import to add at top:
import { SqlDateRange } from '@/types/dashboard';

Function to add at end:

/**
 * Converts a SqlDateRange filter state into start/end date strings for API calls.
 * Returns null for "All Time" (no date filtering).
 */
export function buildDateRangeFromSqlFilter(filter: SqlDateRange): { startDate: string; endDate: string } | null {
  const today = new Date().toISOString().split('T')[0];
  const year = filter.year;

  switch (filter.preset) {
    case 'alltime':
      return null;
    case 'ytd':
      return { startDate: `${year}-01-01`, endDate: today };
    case 'qtd': {
      const currentMonth = new Date().getMonth();
      const quarterStart = new Date(year, Math.floor(currentMonth / 3) * 3, 1);
      return { startDate: quarterStart.toISOString().split('T')[0], endDate: today };
    }
    case 'q1':
      return { startDate: `${year}-01-01`, endDate: `${year}-03-31` };
    case 'q2':
      return { startDate: `${year}-04-01`, endDate: `${year}-06-30` };
    case 'q3':
      return { startDate: `${year}-07-01`, endDate: `${year}-09-30` };
    case 'q4':
      return { startDate: `${year}-10-01`, endDate: `${year}-12-31` };
    case 'custom':
      if (filter.startDate && filter.endDate) {
        return { startDate: filter.startDate, endDate: filter.endDate };
      }
      return null;
    default:
      return null;
  }
}

Do NOT modify any existing types, functions, or exports. Only ADD the new ones.

--- VERIFICATION ---

After making changes, run these commands and report the results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Verify new types exist in dashboard.ts:
   Search src/types/dashboard.ts for "SgmConversionData" and "SqlDateRange"
   Both must exist.

3. Verify new function exists in date-helpers.ts:
   Search src/lib/utils/date-helpers.ts for "buildDateRangeFromSqlFilter"
   Must exist.

4. Verify the import of SqlDateRange was added to date-helpers.ts:
   Read the top 10 lines of src/lib/utils/date-helpers.ts and confirm the import is there.

Tell me exactly what you changed, what the verification results were, and whether Phase 1 passes.

STOP after Phase 1. Do not proceed to Phase 2 until I confirm.
```

### Expected Outcome
- `dashboard.ts` has `SgmConversionData` and `SqlDateRange` interfaces added
- `date-helpers.ts` has `buildDateRangeFromSqlFilter` function added with SqlDateRange import
- Zero type errors from `tsc --noEmit`
- No existing code modified

---

## PHASE 2: Query Layer

### Prompt

```
You are implementing Phase 2: Query Layer. This builds on Phase 1 (types and utilities).

Read these files BEFORE writing any code:

1. Read `src/lib/queries/open-pipeline.ts` in full — pay close attention to:
   - All imports at the top
   - The _getOpenPipelineBySgm function (its WHERE clause, params, signature)
   - The _getOpenPipelineRecordsBySgm function (its WHERE clause, params, signature)
   - The _getOpenPipelineRecordsByStage function (its WHERE clause, params, signature) — this is used by segment clicks
   - How cachedQuery wrapping works at the bottom of each function
2. Read `src/types/bigquery-raw.ts` — find toNumber and toString
3. Read `src/lib/cache.ts` — confirm cachedQuery signature and CACHE_TAGS
4. Read `src/config/constants.ts` — confirm FULL_TABLE and RECRUITING_RECORD_TYPE

Then make FIVE changes to `src/lib/queries/open-pipeline.ts`:

--- CHANGE 1: Add SgmConversionData import ---

At the top of the file, add to the existing import from '@/types/dashboard':
  SgmConversionData

(Add it to the existing destructured import list — do not create a new import line.)

--- CHANGE 2: Modify _getOpenPipelineBySgm to accept optional dateRange ---

Change the function signature from:
  filters?: { stages?: string[]; sgms?: string[] }
To:
  filters?: { stages?: string[]; sgms?: string[]; dateRange?: { startDate: string; endDate: string } | null }

Add the following date filter conditions AFTER the existing sgm filter block (after the "if (filters?.sgms)" block) and BEFORE the "conditions.push('v.is_sqo_unique = 1')" line:

  // Date filter on converted_date_raw (SQL creation date)
  if (filters?.dateRange?.startDate && filters?.dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = filters.dateRange.startDate;
    params.endDate = filters.dateRange.endDate;
  }

Do NOT change anything else in this function.

--- CHANGE 3: Modify _getOpenPipelineRecordsBySgm to accept optional dateRange ---

Change the function signature from:
  sgm: string, stages?: string[], sgms?: string[]
To:
  sgm: string, stages?: string[], sgms?: string[], dateRange?: { startDate: string; endDate: string } | null

Add the following date filter conditions AFTER the existing sgm filter block (after the "if (sgms && sgms.length > 0)" block) and BEFORE the whereClause construction:

  // Date filter on converted_date_raw (SQL creation date)
  if (dateRange?.startDate && dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = dateRange.startDate;
    params.endDate = dateRange.endDate;
  }

Do NOT change anything else in this function.

--- CHANGE 4: Modify _getOpenPipelineRecordsByStage to accept optional dateRange ---

CRITICAL: This function is used when clicking a bar SEGMENT in the By SGM chart (via handleSegmentClick). Without this change, segment drill-downs will ignore the date filter!

Find the _getOpenPipelineRecordsByStage function. Its current signature is:
  stage: string, filters?: { channel?: string; source?: string; sga?: string; sgm?: string; sgms?: string[] }

Change it to:
  stage: string, filters?: { channel?: string; source?: string; sga?: string; sgm?: string; sgms?: string[]; dateRange?: { startDate: string; endDate: string } | null }

Add the following date filter conditions AFTER the existing SGM array filter block (after "if (filters?.sgms && filters.sgms.length > 0 && !filters?.sgm)") and BEFORE the line `conditions.push('v.recordtypeid = @recruitingRecordType')`:

  // Date filter on converted_date_raw (SQL creation date)
  if (filters?.dateRange?.startDate && filters?.dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = filters.dateRange.startDate;
    params.endDate = filters.dateRange.endDate;
  }

Do NOT change anything else in this function.

--- CHANGE 5: Add new _getSgmConversionData function ---

Add this COMPLETE function AFTER the existing getOpenPipelineRecordsBySgm export (at the end of the file). Copy this EXACTLY:

interface SgmConversionFilters {
  sgms?: string[];
  dateRange?: { startDate: string; endDate: string } | null;
}

const _getSgmConversionData = async (
  filters?: SgmConversionFilters
): Promise<SgmConversionData[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');
  conditions.push('v.SGM_Owner_Name__c IS NOT NULL');

  // Date filter on converted_date_raw (SQL date)
  if (filters?.dateRange?.startDate && filters?.dateRange?.endDate) {
    conditions.push('v.converted_date_raw IS NOT NULL');
    conditions.push('DATE(v.converted_date_raw) >= DATE(@startDate)');
    conditions.push('DATE(v.converted_date_raw) <= DATE(@endDate)');
    params.startDate = filters.dateRange.startDate;
    params.endDate = filters.dateRange.endDate;
  }

  // SGM filter
  if (filters?.sgms && filters.sgms.length > 0) {
    const sgmParams = filters.sgms.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgms.forEach((sgm, i) => {
      params[`sgm${i}`] = sgm;
    });
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const query = `
    SELECT
      v.SGM_Owner_Name__c as sgm,
      COUNT(CASE WHEN v.is_sql = 1 AND v.is_primary_opp_record = 1 THEN 1 END) as sqls_received,
      SUM(v.sql_to_sqo_progression) as sql_to_sqo_numer,
      SUM(v.eligible_for_sql_conversions) as sql_to_sqo_denom,
      SUM(v.is_sqo_unique) as sqos_count,
      SUM(v.sqo_to_joined_progression) as sqo_to_joined_numer,
      SUM(v.eligible_for_sqo_conversions) as sqo_to_joined_denom,
      SUM(v.is_joined_unique) as joined_count
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
    GROUP BY v.SGM_Owner_Name__c
    ORDER BY sqls_received DESC
  `;

  const results = await runQuery<{
    sgm: string | null;
    sqls_received: number | null;
    sql_to_sqo_numer: number | null;
    sql_to_sqo_denom: number | null;
    sqos_count: number | null;
    sqo_to_joined_numer: number | null;
    sqo_to_joined_denom: number | null;
    joined_count: number | null;
  }>(query, params);

  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;

  return results.map(r => ({
    sgm: toString(r.sgm),
    sqlsReceived: toNumber(r.sqls_received),
    sqlToSqoNumer: toNumber(r.sql_to_sqo_numer),
    sqlToSqoDenom: toNumber(r.sql_to_sqo_denom),
    sqlToSqoRate: safeDiv(toNumber(r.sql_to_sqo_numer), toNumber(r.sql_to_sqo_denom)),
    sqosCount: toNumber(r.sqos_count),
    sqoToJoinedNumer: toNumber(r.sqo_to_joined_numer),
    sqoToJoinedDenom: toNumber(r.sqo_to_joined_denom),
    sqoToJoinedRate: safeDiv(toNumber(r.sqo_to_joined_numer), toNumber(r.sqo_to_joined_denom)),
    joinedCount: toNumber(r.joined_count),
  }));
};

export const getSgmConversionData = cachedQuery(
  _getSgmConversionData,
  'getSgmConversionData',
  CACHE_TAGS.DASHBOARD
);

--- VERIFICATION ---

After making all changes, run these commands and report the results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them. (Only show first 30 lines if many errors)

2. Verify _getOpenPipelineBySgm now accepts dateRange:
   Read the function signature line of _getOpenPipelineBySgm. It must include dateRange in the filters object type.

3. Verify _getOpenPipelineRecordsBySgm now accepts dateRange:
   Read the function signature line. It must include dateRange as the 4th parameter.

4. Verify _getOpenPipelineRecordsByStage now accepts dateRange:
   Read the function signature line. The filters object type must include dateRange.

5. Verify getSgmConversionData export exists:
   Search the file for "getSgmConversionData". Must appear as a cachedQuery export.

6. Verify the SgmConversionData import was added:
   Read the imports at the top of open-pipeline.ts. SgmConversionData must be in the import from '@/types/dashboard'.

7. Run: npx next lint
   Report: any lint errors? (warnings OK)

Tell me exactly what you changed, what the verification results were, and whether Phase 2 passes.

STOP after Phase 2. Do not proceed to Phase 3 until I confirm.
```

### Expected Outcome
- `_getOpenPipelineBySgm` accepts optional `dateRange` parameter and adds date conditions when provided
- `_getOpenPipelineRecordsBySgm` accepts optional `dateRange` parameter (4th param)
- `_getOpenPipelineRecordsByStage` accepts optional `dateRange` in its filters object
- `_getSgmConversionData` is a new function with its own `SgmConversionFilters` interface
- `getSgmConversionData` is exported via `cachedQuery`
- Zero type errors, zero lint errors

---

## PHASE 3: API Routes

### Prompt

```
You are implementing Phase 3: API Routes. This builds on Phase 2 (query layer).

Read these files BEFORE writing any code:

1. Read `src/app/api/dashboard/pipeline-by-sgm/route.ts` in full — note the auth pattern, body extraction, and response format
2. Read `src/app/api/dashboard/pipeline-drilldown-sgm/route.ts` in full — note how it calls getOpenPipelineRecordsBySgm
3. Read `src/app/api/dashboard/pipeline-drilldown/route.ts` in full — note how it calls getOpenPipelineRecordsByStage (this is used for segment clicks!)
4. Read `src/lib/api-authz.ts` — confirm forbidRecruiter and forbidCapitalPartner signatures

Then make these changes:

--- FILE 1: MODIFY src/app/api/dashboard/pipeline-by-sgm/route.ts ---

Find the line where the request body is destructured (should be something like):
  const { stages, sgms } = body;

Change it to:
  const { stages, sgms, dateRange } = body;

Find the line where getOpenPipelineBySgm is called (should be something like):
  const rows = await getOpenPipelineBySgm({ stages, sgms });

Change it to:
  const rows = await getOpenPipelineBySgm({ stages, sgms, dateRange });

Do NOT change anything else in this file. The auth checks, imports, and response format stay the same.

--- FILE 2: MODIFY src/app/api/dashboard/pipeline-drilldown-sgm/route.ts ---

Find the line where the request body is destructured (should be something like):
  const { sgm, stages, sgms } = body;

Change it to:
  const { sgm, stages, sgms, dateRange } = body;

Find the line where getOpenPipelineRecordsBySgm is called (should be something like):
  const records = await getOpenPipelineRecordsBySgm(sgm, stages, sgms);

Change it to:
  const records = await getOpenPipelineRecordsBySgm(sgm, stages, sgms, dateRange);

Do NOT change anything else in this file.

--- FILE 3: MODIFY src/app/api/dashboard/pipeline-drilldown/route.ts ---

CRITICAL: This route is used when clicking a bar SEGMENT in the By SGM chart. Without this change, segment drill-downs will NOT respect the date filter!

Find the line where the request body is destructured (should be something like):
  const { stage, filters, sgms } = body;

Change it to:
  const { stage, filters, sgms, dateRange } = body;

Find where pipelineFilters is constructed and passed to getOpenPipelineRecordsByStage. Currently:
  const pipelineFilters = { ...filters };
  if (sgms && sgms.length > 0) {
    pipelineFilters.sgms = sgms;
  }
  const records = await getOpenPipelineRecordsByStage(stage, pipelineFilters);

Change it to:
  const pipelineFilters = { ...filters };
  if (sgms && sgms.length > 0) {
    pipelineFilters.sgms = sgms;
  }
  if (dateRange) {
    pipelineFilters.dateRange = dateRange;
  }
  const records = await getOpenPipelineRecordsByStage(stage, pipelineFilters);

Do NOT change anything else in this file.

--- FILE 4: CREATE src/app/api/dashboard/sgm-conversions/route.ts ---

Create this file with the following EXACT contents. This follows the identical pattern as pipeline-by-sgm/route.ts:

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSgmConversionData } from '@/lib/queries/open-pipeline';
import { getSessionPermissions } from '@/types/auth';
import { forbidRecruiter, forbidCapitalPartner } from '@/lib/api-authz';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
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

    // revops_admin only
    if (permissions.role !== 'revops_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { sgms, dateRange } = body;

    const data = await getSgmConversionData({ sgms, dateRange });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error fetching SGM conversions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM conversions' },
      { status: 500 }
    );
  }
}

--- VERIFICATION ---

After making all changes, run these commands and report the results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Verify pipeline-by-sgm route now extracts dateRange:
   Read src/app/api/dashboard/pipeline-by-sgm/route.ts and confirm `dateRange` appears in destructuring AND in the function call.

3. Verify pipeline-drilldown-sgm route now passes dateRange:
   Read src/app/api/dashboard/pipeline-drilldown-sgm/route.ts and confirm `dateRange` appears in destructuring AND as the 4th argument to getOpenPipelineRecordsBySgm.

4. Verify pipeline-drilldown route now passes dateRange:
   Read src/app/api/dashboard/pipeline-drilldown/route.ts and confirm:
   a. `dateRange` appears in the body destructuring
   b. `dateRange` is added to pipelineFilters
   c. pipelineFilters is passed to getOpenPipelineRecordsByStage

5. Verify new sgm-conversions route exists:
   Read src/app/api/dashboard/sgm-conversions/route.ts. Confirm:
   a. It imports getSgmConversionData from '@/lib/queries/open-pipeline'
   b. It checks permissions.role !== 'revops_admin'
   c. It extracts { sgms, dateRange } from body
   d. It calls getSgmConversionData({ sgms, dateRange })

6. Run: npx next lint
   Report: any lint errors? (warnings OK)

Tell me exactly what you changed, what the verification results were, and whether Phase 3 passes.

STOP after Phase 3. Do not proceed to Phase 4 until I confirm.
```

### Expected Outcome
- `pipeline-by-sgm/route.ts` passes `dateRange` to query function
- `pipeline-drilldown-sgm/route.ts` passes `dateRange` as 4th arg
- `pipeline-drilldown/route.ts` passes `dateRange` via pipelineFilters object
- `sgm-conversions/route.ts` created with full auth checks and revops_admin guard
- Zero type errors, zero lint errors

---

## PHASE 4: API Client

### Prompt

```
You are implementing Phase 4: API Client. This builds on Phase 3 (API routes).

Read this file BEFORE writing any code:

1. Read `src/lib/api-client.ts` in full — pay close attention to:
   - The getPipelineBySgm function (its signature, body, return type)
   - The getPipelineDrilldownBySgm function (if it exists — it handles drill-down for the By SGM chart)
   - The pattern used for POST requests (headers, body, error handling)
   - All existing imports from '@/types/dashboard'

Then make these changes:

--- CHANGE 1: Add SgmConversionData import ---

At the top of the file, add SgmConversionData to the existing import from '@/types/dashboard'.

--- CHANGE 2: Modify getPipelineBySgm function ---

Find the existing getPipelineBySgm function. Change its signature to accept an optional dateRange parameter:

getPipelineBySgm: async (
  stages?: string[],
  sgms?: string[],
  dateRange?: { startDate: string; endDate: string } | null
): Promise<{ data: SgmPipelineChartData[] }> => {

Change the body to include dateRange:
  body: JSON.stringify({ stages, sgms, dateRange }),

Do NOT change the URL, headers, or error handling.

--- CHANGE 3: Modify getPipelineDrilldownBySgm function ---

Find the existing getPipelineDrilldownBySgm function (around line 403). Its current signature is:
  getPipelineDrilldownBySgm: async (sgm: string, stages?: string[], sgms?: string[])

Change it to:
  getPipelineDrilldownBySgm: async (
    sgm: string,
    stages?: string[],
    sgms?: string[],
    dateRange?: { startDate: string; endDate: string } | null
  )

Change the body to include dateRange:
  body: JSON.stringify({ sgm, stages, sgms, dateRange }),

Do NOT change the URL, headers, or error handling.

--- CHANGE 4: Modify getPipelineDrilldown function ---

CRITICAL: This function is used by handleSegmentClick (clicking a bar segment in the By SGM chart). Without this change, segment drill-downs will NOT respect the date filter!

Find the existing getPipelineDrilldown function (around line 356). Its current signature is:
  getPipelineDrilldown: async (
    stage: string,
    filters?: { channel?: string; source?: string; sga?: string; sgm?: string },
    sgms?: string[]
  )

Change it to:
  getPipelineDrilldown: async (
    stage: string,
    filters?: { channel?: string; source?: string; sga?: string; sgm?: string },
    sgms?: string[],
    dateRange?: { startDate: string; endDate: string } | null
  )

Change the body to include dateRange:
  body: JSON.stringify({ stage, filters: cleanFiltersObj, sgms, dateRange }),

Do NOT change the URL, headers, or error handling.

--- CHANGE 5: Add getSgmConversions function ---

Add this new function to the dashboardApi object (or wherever the other pipeline functions are defined). Place it AFTER the existing getPipelineBySgm function:

getSgmConversions: async (
  sgms?: string[],
  dateRange?: { startDate: string; endDate: string } | null
): Promise<{ data: SgmConversionData[] }> => {
  const response = await fetch('/api/dashboard/sgm-conversions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sgms, dateRange }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch SGM conversions');
  }

  return response.json();
},

--- VERIFICATION ---

After making all changes, run these commands and report the results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Verify getPipelineBySgm signature:
   Read the function and confirm the 3rd parameter is dateRange and it's included in the body.

3. Verify getPipelineDrilldownBySgm signature:
   Read the function and confirm dateRange is the 4th parameter and it's included in the body.

4. Verify getPipelineDrilldown signature:
   Read the function and confirm dateRange is the 4th parameter and it's included in the body.

5. Verify getSgmConversions exists:
   Search api-client.ts for "getSgmConversions". Must exist.

6. Verify SgmConversionData import:
   Read the imports at the top. SgmConversionData must be imported from '@/types/dashboard'.

7. Run: npx next lint
   Report: any lint errors? (warnings OK)

Tell me exactly what you changed, what the verification results were, and whether Phase 4 passes.

STOP after Phase 4. Do not proceed to Phase 5 until I confirm.
```

### Expected Outcome
- `getPipelineBySgm` accepts `dateRange` as 3rd param and includes it in the POST body
- `getPipelineDrilldownBySgm` accepts `dateRange` as 4th param and includes it in body
- `getPipelineDrilldown` accepts `dateRange` as 4th param and includes it in body
- `getSgmConversions` function added with correct URL, body, and error handling
- `SgmConversionData` imported
- Zero type errors, zero lint errors

---

## PHASE 5: SqlDateFilter Component

### Prompt

```
You are implementing Phase 5: SqlDateFilter Component. This is a new UI component.

Read these files BEFORE writing any code:

1. Read `src/components/dashboard/GlobalFilters.tsx` lines 34-45 — note the DATE_PRESETS array pattern
2. Read `src/components/dashboard/PipelineFilters.tsx` — note the Card wrapper and styling patterns
3. Read `src/types/dashboard.ts` — find the SqlDateRange interface you added in Phase 1

Then CREATE this new file:

--- FILE: src/components/dashboard/SqlDateFilter.tsx ---

'use client';

import { Card } from '@tremor/react';
import { Calendar } from 'lucide-react';
import { SqlDateRange } from '@/types/dashboard';

const DATE_PRESETS = [
  { value: 'alltime', label: 'All Time' },
  { value: 'ytd', label: 'Year to Date' },
  { value: 'qtd', label: 'Quarter to Date' },
  { value: 'q1', label: 'Q1' },
  { value: 'q2', label: 'Q2' },
  { value: 'q3', label: 'Q3' },
  { value: 'q4', label: 'Q4' },
  { value: 'custom', label: 'Custom Range' },
] as const;

interface SqlDateFilterProps {
  value: SqlDateRange | null;
  onChange: (value: SqlDateRange | null) => void;
  disabled?: boolean;
}

export function SqlDateFilter({ value, onChange, disabled = false }: SqlDateFilterProps) {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1, currentYear - 2];

  const preset = value?.preset || 'alltime';
  const year = value?.year || currentYear;

  const handlePresetChange = (newPreset: string) => {
    if (newPreset === 'alltime') {
      onChange(null);
      return;
    }
    onChange({
      preset: newPreset as SqlDateRange['preset'],
      year: ['ytd', 'qtd'].includes(newPreset) ? currentYear : year,
      startDate: value?.startDate || null,
      endDate: value?.endDate || null,
    });
  };

  const handleYearChange = (newYear: number) => {
    if (!value) return;
    onChange({ ...value, year: newYear });
  };

  const handleStartDateChange = (date: string) => {
    onChange({
      preset: 'custom',
      year: currentYear,
      startDate: date,
      endDate: value?.endDate || null,
    });
  };

  const handleEndDateChange = (date: string) => {
    onChange({
      preset: 'custom',
      year: currentYear,
      startDate: value?.startDate || null,
      endDate: date,
    });
  };

  const showYearSelector = ['q1', 'q2', 'q3', 'q4'].includes(preset);
  const showCustomDates = preset === 'custom';

  return (
    <Card className="mb-4 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          SQL Creation Date
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          (scopes chart and table to SQLs created in this period)
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* Preset Selector */}
        <select
          value={preset}
          onChange={(e) => handlePresetChange(e.target.value)}
          disabled={disabled}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                     focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                     disabled:opacity-50 disabled:cursor-not-allowed text-sm"
        >
          {DATE_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>

        {/* Year Selector (for Q1-Q4) */}
        {showYearSelector && (
          <select
            value={year}
            onChange={(e) => handleYearChange(parseInt(e.target.value))}
            disabled={disabled}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                       bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                       focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                       disabled:opacity-50 disabled:cursor-not-allowed text-sm"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        )}

        {/* Custom Date Range */}
        {showCustomDates && (
          <>
            <input
              type="date"
              value={value?.startDate || ''}
              onChange={(e) => handleStartDateChange(e.target.value)}
              disabled={disabled}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                         disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            />
            <span className="text-gray-500 dark:text-gray-400 text-sm">to</span>
            <input
              type="date"
              value={value?.endDate || ''}
              onChange={(e) => handleEndDateChange(e.target.value)}
              disabled={disabled}
              className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                         focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none
                         disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            />
          </>
        )}
      </div>
    </Card>
  );
}

--- VERIFICATION ---

After creating the file, run these commands and report the results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Verify the file exists and has correct exports:
   Read the first 5 lines and last 5 lines of src/components/dashboard/SqlDateFilter.tsx

3. Verify dark mode classes are present:
   Search the file for "dark:bg-gray-800". It should appear multiple times (on select, input elements).

4. Verify the component is a named export (not default):
   Confirm the export line reads "export function SqlDateFilter"

5. Run: npx next lint
   Report: any lint errors? (warnings OK)

Tell me exactly what you changed, what the verification results were, and whether Phase 5 passes.

STOP after Phase 5. Do not proceed to Phase 6 until I confirm.
```

### Expected Outcome
- `SqlDateFilter.tsx` created with full dark mode support
- Presets match the Full Funnel Efficiency page pattern (alltime, ytd, qtd, q1-q4, custom)
- Year selector appears for Q1-Q4, custom date inputs appear for custom
- "All Time" sets state to null
- Zero type errors, zero lint errors

---

## PHASE 6: SgmConversionTable Component

### Prompt

```
You are implementing Phase 6: SgmConversionTable Component. This is a new UI component.

Read these files BEFORE writing any code:

1. Read `src/components/dashboard/SourcePerformanceTable.tsx` — pay close attention to:
   - The SortableHeader pattern (lines 151-178)
   - The handleSort function
   - The Tremor Table imports
   - The zebra striping pattern
2. Read `src/lib/utils/date-helpers.ts` — find formatPercent and formatNumber function signatures
3. Read `src/types/dashboard.ts` — find the SgmConversionData interface

IMPORTANT: Verify how formatPercent works before proceeding:
- If formatPercent(0.75) returns "75.0%" — it multiplies by 100 internally. Good, we pass decimals directly.
- If formatPercent(0.75) returns "0.8%" — it does NOT multiply by 100. We would need to multiply first.
Read the function body and report which behavior it has. This determines how we display rates.

Then CREATE this new file:

--- FILE: src/components/dashboard/SgmConversionTable.tsx ---

'use client';

import { useState, useMemo } from 'react';
import {
  Card,
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
} from '@tremor/react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { SgmConversionData } from '@/types/dashboard';
import { formatPercent, formatNumber } from '@/lib/utils/date-helpers';

type SortColumn = 'sgm' | 'sqls' | 'sqlToSqo' | 'sqos' | 'sqoToJoined' | 'joined';
type SortDirection = 'asc' | 'desc';

interface SgmConversionTableProps {
  data: SgmConversionData[];
  loading?: boolean;
}

export function SgmConversionTable({ data, loading = false }: SgmConversionTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('sqls');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Sort data
  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'sgm':
          comparison = a.sgm.localeCompare(b.sgm);
          break;
        case 'sqls':
          comparison = a.sqlsReceived - b.sqlsReceived;
          break;
        case 'sqlToSqo':
          comparison = a.sqlToSqoRate - b.sqlToSqoRate;
          break;
        case 'sqos':
          comparison = a.sqosCount - b.sqosCount;
          break;
        case 'sqoToJoined':
          comparison = a.sqoToJoinedRate - b.sqoToJoinedRate;
          break;
        case 'joined':
          comparison = a.joinedCount - b.joinedCount;
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [data, sortColumn, sortDirection]);

  // Calculate team averages
  // NOTE: For conversion rates, we compute the AGGREGATE rate (total numer / total denom)
  // not the average of individual rates. This is statistically correct.
  const teamAverage = useMemo(() => {
    if (data.length === 0) return null;
    const totalSqls = data.reduce((sum, d) => sum + d.sqlsReceived, 0);
    const totalSqlToSqoNumer = data.reduce((sum, d) => sum + (d.sqlToSqoNumer || 0), 0);
    const totalSqlToSqoDenom = data.reduce((sum, d) => sum + (d.sqlToSqoDenom || 0), 0);
    const totalSqos = data.reduce((sum, d) => sum + d.sqosCount, 0);
    const totalSqoToJoinedNumer = data.reduce((sum, d) => sum + (d.sqoToJoinedNumer || 0), 0);
    const totalSqoToJoinedDenom = data.reduce((sum, d) => sum + (d.sqoToJoinedDenom || 0), 0);
    const totalJoined = data.reduce((sum, d) => sum + d.joinedCount, 0);

    return {
      sgm: 'Team Average',
      sqlsReceived: Math.round(totalSqls / data.length),
      sqlToSqoRate: totalSqlToSqoDenom > 0 ? totalSqlToSqoNumer / totalSqlToSqoDenom : 0,
      sqosCount: Math.round(totalSqos / data.length),
      sqoToJoinedRate: totalSqoToJoinedDenom > 0 ? totalSqoToJoinedNumer / totalSqoToJoinedDenom : 0,
      joinedCount: Math.round(totalJoined / data.length),
    };
  }, [data]);

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const SortableHeader = ({ column, children, alignRight = true }: {
    column: SortColumn;
    children: React.ReactNode;
    alignRight?: boolean;
  }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';

    return (
      <TableHeaderCell
        className={`cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none
                    ${alignRight ? 'text-right' : ''}`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : ''}`}>
          {children}
          <div className="flex flex-col">
            <ChevronUp className={`w-3 h-3 ${showAsc ? 'text-blue-600' : 'text-gray-300 dark:text-gray-600'}`} />
            <ChevronDown className={`w-3 h-3 -mt-1 ${showDesc ? 'text-blue-600' : 'text-gray-300 dark:text-gray-600'}`} />
          </div>
        </div>
      </TableHeaderCell>
    );
  };

  if (loading) {
    return (
      <Card className="mt-4 animate-pulse">
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded" />
      </Card>
    );
  }

  return (
    <Card className="mt-4">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          SGM Conversion & Velocity
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Post-SQL journey by SGM — click column headers to sort
        </p>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <SortableHeader column="sgm" alignRight={false}>SGM</SortableHeader>
              <SortableHeader column="sqls">SQLs</SortableHeader>
              <SortableHeader column="sqlToSqo">SQL→SQO %</SortableHeader>
              <SortableHeader column="sqos">SQO&apos;d</SortableHeader>
              <SortableHeader column="sqoToJoined">SQO→Joined %</SortableHeader>
              <SortableHeader column="joined">Joined</SortableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedData.map((row, idx) => (
              <TableRow
                key={row.sgm}
                className={idx % 2 === 0
                  ? 'bg-white dark:bg-gray-800'
                  : 'bg-gray-50 dark:bg-gray-900'}
              >
                <TableCell className="font-medium text-gray-900 dark:text-white">
                  {row.sgm}
                </TableCell>
                <TableCell className="text-right">{formatNumber(row.sqlsReceived)}</TableCell>
                <TableCell className="text-right">{formatPercent(row.sqlToSqoRate)}</TableCell>
                <TableCell className="text-right">{formatNumber(row.sqosCount)}</TableCell>
                <TableCell className="text-right">{formatPercent(row.sqoToJoinedRate)}</TableCell>
                <TableCell className="text-right">{formatNumber(row.joinedCount)}</TableCell>
              </TableRow>
            ))}

            {/* Team Average Row — pinned to bottom with visual separation */}
            {teamAverage && (
              <TableRow className="border-t-2 border-gray-300 dark:border-gray-600 bg-blue-50 dark:bg-blue-900/20">
                <TableCell className="font-bold text-gray-900 dark:text-white">
                  {teamAverage.sgm}
                </TableCell>
                <TableCell className="text-right font-bold">{formatNumber(teamAverage.sqlsReceived)}</TableCell>
                <TableCell className="text-right font-bold">{formatPercent(teamAverage.sqlToSqoRate)}</TableCell>
                <TableCell className="text-right font-bold">{formatNumber(teamAverage.sqosCount)}</TableCell>
                <TableCell className="text-right font-bold">{formatPercent(teamAverage.sqoToJoinedRate)}</TableCell>
                <TableCell className="text-right font-bold">{formatNumber(teamAverage.joinedCount)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data.length === 0 && !loading && (
        <div className="p-8 text-center text-gray-500 dark:text-gray-400">
          No conversion data available for selected filters
        </div>
      )}
    </Card>
  );
}

--- IMPORTANT: formatPercent VERIFICATION ---

BEFORE writing the file, read the formatPercent function in src/lib/utils/date-helpers.ts.

If formatPercent MULTIPLIES by 100 internally (e.g., formatPercent(0.75) → "75.0%"):
  → Use the code above as-is. We pass the decimal rate directly.

If formatPercent does NOT multiply by 100 (e.g., formatPercent(0.75) → "0.8%"):
  → Replace every `formatPercent(row.xxxRate)` with `formatPercent(row.xxxRate * 100)` or `(row.xxxRate * 100).toFixed(1) + '%'`
  → Same for the teamAverage rows.

Report which behavior formatPercent has and what you used.

--- VERIFICATION ---

After creating the file, run these commands and report the results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Verify the file exists and has correct structure:
   Read the first 10 lines and last 10 lines of src/components/dashboard/SgmConversionTable.tsx

3. Verify SortableHeader is defined:
   Search the file for "const SortableHeader". Must exist.

4. Verify Team Average row exists:
   Search the file for "Team Average". Must exist.

5. Verify dark mode classes on table rows:
   Search the file for "dark:bg-gray-800" and "dark:bg-gray-900". Both must exist.

6. Verify the formatPercent usage is correct (based on your finding above):
   Confirm the rates will display correctly (e.g., 75% not 0.75% or 7500%).

7. Run: npx next lint
   Report: any lint errors? (warnings OK)
   NOTE: If lint complains about the apostrophe in "SQO'd", use SQO&apos;d in the JSX instead.

Tell me exactly what you changed, what the verification results were, what formatPercent does, and whether Phase 6 passes.

STOP after Phase 6. Do not proceed to Phase 7 until I confirm.
```

### Expected Outcome
- `SgmConversionTable.tsx` created with full dark mode support
- SortableHeader pattern matches SourcePerformanceTable
- Team Average row uses aggregate rates (total numer / total denom), not average of rates
- formatPercent usage is verified correct
- Default sort: SQLs descending
- Zero type errors, zero lint errors

---

## PHASE 7: Pipeline Page Integration

### Prompt

```
You are implementing Phase 7: Pipeline Page Integration. This is the final wiring phase.

Read this file carefully BEFORE writing any code:

1. Read `src/app/dashboard/pipeline/page.tsx` in full — pay VERY close attention to:
   - All imports at the top (lines 1-20ish)
   - All state variables (lines 37-91ish)
   - The isRevOpsAdmin variable and how it's derived
   - The fetchBySgmData function (its useCallback, its dependencies, how it calls dashboardApi.getPipelineBySgm)
   - The useEffect that triggers fetchBySgmData
   - The handleSegmentClick and handleSgmClick functions — these trigger drill-down fetches and may need dateRange passed through
   - The tab toggle buttons and conditional rendering for 'bySgm' tab
   - Where <PipelineBySgmChart> is rendered
   - Where <VolumeDrillDownModal> is rendered

Then make these changes:

--- CHANGE 1: Add imports ---

Add these imports at the top of the file (with the existing component imports):

import { SqlDateFilter } from '@/components/dashboard/SqlDateFilter';
import { SgmConversionTable } from '@/components/dashboard/SgmConversionTable';

Add these to the existing import from '@/types/dashboard':
  SqlDateRange, SgmConversionData

Add this to the existing import from '@/lib/utils/date-helpers' (or create the import if it doesn't exist):
  buildDateRangeFromSqlFilter

--- CHANGE 2: Add state variables ---

Add these state variables AFTER the existing bySgm-related state (after drillDownSgm state, around line 90):

// SQL Date Filter state (null = "All Time")
const [sqlDateRange, setSqlDateRange] = useState<SqlDateRange | null>(null);

// Conversion Table state
const [conversionData, setConversionData] = useState<SgmConversionData[]>([]);
const [conversionLoading, setConversionLoading] = useState(false);

--- CHANGE 3: Modify fetchBySgmData ---

Find the existing fetchBySgmData useCallback. Make TWO changes:

1. Inside the try block, add the dateRange computation and pass it to getPipelineBySgm:

   BEFORE the dashboardApi.getPipelineBySgm call, add:
     const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;

   Change the getPipelineBySgm call to include dateRange as the 3rd argument:
     const result = await dashboardApi.getPipelineBySgm(
       selectedStages.length > 0 ? selectedStages : undefined,
       sgmsToSend,
       dateRange
     );

2. Add sqlDateRange to the useCallback dependency array.

--- CHANGE 4: Add fetchConversionData ---

Add this new useCallback function AFTER fetchBySgmData:

const fetchConversionData = useCallback(async () => {
  if (activeTab !== 'bySgm') return;
  setConversionLoading(true);
  try {
    const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
    const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;
    const result = await dashboardApi.getSgmConversions(sgmsToSend, dateRange);
    setConversionData(result.data);
  } catch (err) {
    console.error('Error fetching conversion data:', err);
    setConversionData([]);
  } finally {
    setConversionLoading(false);
  }
}, [activeTab, selectedSgms, sgmOptions.length, sqlDateRange]);

--- CHANGE 5: Modify the useEffect that triggers bySgm fetches ---

Find the useEffect that calls fetchBySgmData when activeTab === 'bySgm'. Add fetchConversionData:

useEffect(() => {
  if (activeTab === 'bySgm' && isRevOpsAdmin) {
    fetchBySgmData();
    fetchConversionData();
  }
}, [activeTab, isRevOpsAdmin, fetchBySgmData, fetchConversionData]);

--- CHANGE 6: Modify handleSegmentClick to pass dateRange ---

Find the handleSegmentClick function (around line 264). It is called when a bar SEGMENT is clicked in the By SGM chart.

Currently it looks like:
  const handleSegmentClick = async (sgm: string, stage: string) => {
    // ...
    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const result = await dashboardApi.getPipelineDrilldown(stage, { sgm }, sgmsToSend);
      // ...

Add the dateRange computation and pass it as the 4th argument:
  const handleSegmentClick = async (sgm: string, stage: string) => {
    // ...
    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;
      const result = await dashboardApi.getPipelineDrilldown(stage, { sgm }, sgmsToSend, dateRange);
      // ...

--- CHANGE 7: Modify handleSgmClick to pass dateRange ---

Find the handleSgmClick function (around line 284). It is called when an SGM NAME is clicked on the x-axis.

Currently it looks like:
  const handleSgmClick = async (sgm: string) => {
    // ...
    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const result = await dashboardApi.getPipelineDrilldownBySgm(
        sgm,
        selectedStages.length > 0 ? selectedStages : undefined,
        sgmsToSend
      );
      // ...

Add the dateRange computation and pass it as the 4th argument:
  const handleSgmClick = async (sgm: string) => {
    // ...
    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const dateRange = sqlDateRange ? buildDateRangeFromSqlFilter(sqlDateRange) : null;
      const result = await dashboardApi.getPipelineDrilldownBySgm(
        sgm,
        selectedStages.length > 0 ? selectedStages : undefined,
        sgmsToSend,
        dateRange
      );
      // ...

--- CHANGE 8: Add SqlDateFilter to render ---

Find the tab toggle buttons (the div with "By Stage" and "By SGM" buttons, around line 381). IMMEDIATELY AFTER the closing `</div>` of the tab toggle (but BEFORE the Chart Card), add:

{/* SQL Date Filter — only shown on By SGM tab */}
{activeTab === 'bySgm' && isRevOpsAdmin && (
  <SqlDateFilter
    value={sqlDateRange}
    onChange={setSqlDateRange}
    disabled={bySgmLoading || conversionLoading}
  />
)}

--- CHANGE 9: Add SgmConversionTable to render ---

Find the Chart Card (the <Card> that wraps PipelineBySgmChart, closing around line 457). AFTER the Chart Card's closing `</Card>` tag, add:

{/* Conversion Table — only shown on By SGM tab */}
{activeTab === 'bySgm' && isRevOpsAdmin && (
  <SgmConversionTable
    data={conversionData}
    loading={conversionLoading}
  />
)}

--- VERIFICATION ---

After making all changes, run these commands and report the results:

1. Run: npx tsc --noEmit
   Report: any type errors? If yes, fix them.

2. Verify new imports exist:
   Read the imports section. Confirm SqlDateFilter, SgmConversionTable, SqlDateRange, SgmConversionData, and buildDateRangeFromSqlFilter are all imported.

3. Verify new state variables exist:
   Search for "sqlDateRange" — should appear in useState, in fetchBySgmData, in fetchConversionData, in handleSegmentClick, in handleSgmClick, and in the JSX.
   Search for "conversionData" — should appear in useState and in the SgmConversionTable JSX.

4. Verify fetchConversionData exists:
   Search for "fetchConversionData". Must appear as a useCallback and in the useEffect.

5. Verify handleSegmentClick passes dateRange:
   Read handleSegmentClick. It must call buildDateRangeFromSqlFilter and pass dateRange to getPipelineDrilldown.

6. Verify handleSgmClick passes dateRange:
   Read handleSgmClick. It must call buildDateRangeFromSqlFilter and pass dateRange to getPipelineDrilldownBySgm.

7. Verify SqlDateFilter is rendered conditionally:
   Search for "<SqlDateFilter". Must appear inside an activeTab === 'bySgm' guard.

8. Verify SgmConversionTable is rendered conditionally:
   Search for "<SgmConversionTable". Must appear inside an activeTab === 'bySgm' guard.

9. Verify fetchBySgmData includes sqlDateRange in dependencies:
   Read the useCallback dependency array for fetchBySgmData. sqlDateRange must be listed.

10. Run: npx next lint
    Report: any lint errors? (warnings OK)

Tell me exactly what you changed, what the verification results were, and whether Phase 7 passes.

STOP after Phase 7. Do not proceed to Phase 8 until I confirm.
```

### Expected Outcome
- Pipeline page imports all new components and types
- New state variables for date filter and conversion table
- `fetchBySgmData` passes dateRange to API and has sqlDateRange in deps
- `fetchConversionData` added as separate useCallback
- Both fetches triggered by the same useEffect
- `handleSegmentClick` passes dateRange to getPipelineDrilldown
- `handleSgmClick` passes dateRange to getPipelineDrilldownBySgm
- SqlDateFilter renders between tab buttons and chart (only on bySgm tab)
- SgmConversionTable renders below the chart card (only on bySgm tab)
- Zero type errors, zero lint errors

---

## PHASE 8: Build and Type Check

### Prompt

```
You are implementing Phase 8: Full Build Verification. No new code — just validation.

Run these commands IN ORDER and report ALL results:

1. Run: npx tsc --noEmit
   Report: FULL output. Fix ANY type errors before proceeding.

2. Run: npx next lint
   Report: FULL output. Fix any errors (warnings are OK).

3. Run: npx next build
   Report: Does the build succeed? If not, paste the errors and fix them.

4. Verify imports in all new/modified API routes by reading:
   a. src/app/api/dashboard/sgm-conversions/route.ts — confirm it imports getSgmConversionData from '@/lib/queries/open-pipeline'
   b. src/app/api/dashboard/pipeline-by-sgm/route.ts — confirm dateRange is destructured and passed
   c. src/app/api/dashboard/pipeline-drilldown-sgm/route.ts — confirm dateRange is destructured and passed
   d. src/app/api/dashboard/pipeline-drilldown/route.ts — confirm dateRange is destructured and added to pipelineFilters

5. Cross-check the complete file inventory — confirm ALL 11 files exist and were modified/created:
   - src/types/dashboard.ts (modified — has SgmConversionData and SqlDateRange)
   - src/lib/utils/date-helpers.ts (modified — has buildDateRangeFromSqlFilter)
   - src/lib/queries/open-pipeline.ts (modified — has _getSgmConversionData, date params on _getOpenPipelineBySgm, _getOpenPipelineRecordsBySgm, and _getOpenPipelineRecordsByStage)
   - src/app/api/dashboard/sgm-conversions/route.ts (created)
   - src/app/api/dashboard/pipeline-by-sgm/route.ts (modified)
   - src/app/api/dashboard/pipeline-drilldown-sgm/route.ts (modified)
   - src/app/api/dashboard/pipeline-drilldown/route.ts (modified)
   - src/lib/api-client.ts (modified — has getSgmConversions, dateRange on getPipelineBySgm, getPipelineDrilldownBySgm, getPipelineDrilldown)
   - src/components/dashboard/SqlDateFilter.tsx (created)
   - src/components/dashboard/SgmConversionTable.tsx (created)
   - src/app/dashboard/pipeline/page.tsx (modified)

6. Query parity check:
   Read src/lib/queries/open-pipeline.ts and verify:
   a. _getOpenPipelineBySgm and _getSgmConversionData share these WHERE conditions:
      - v.recordtypeid = @recruitingRecordType ✓
      - v.SGM_Owner_Name__c IS NOT NULL ✓
      - Date filter (when provided) ✓
      - SGM filter (when provided) ✓
   b. _getOpenPipelineBySgm additionally has:
      - v.StageName IN (...) ✓
      - v.is_sqo_unique = 1 ✓
   c. _getSgmConversionData does NOT have stage or is_sqo_unique filters (it covers all stages for conversion counting)
   d. _getOpenPipelineRecordsByStage and _getOpenPipelineRecordsBySgm both accept dateRange filter
   Report: do the conditions match expectations?

If ALL checks pass, tell me: "Phase 8 PASSES — ready for UI/UX testing."
If any check fails, fix the issue and re-run that check until it passes.
```

### Expected Outcome
- Zero type errors
- Zero lint errors
- Build succeeds
- All 11 files verified
- Query conditions verified

---

## PHASE 9: UI/UX Manual Testing

> **This phase is for YOU (Russell), not Claude Code.** Start your dev server (`npm run dev`) and test the following.

### 9.1 — Access Control Testing

| Test | Steps | Expected Result |
|------|-------|-----------------|
| RevOps admin sees date filter | Log in as revops_admin → Go to Open Pipeline → Click "By SGM" tab | SQL Date Filter card visible above the chart |
| Non-admin sees nothing new | Log in as any other role → Go to Open Pipeline | No tab buttons, no date filter, no conversion table visible |
| Date filter only on By SGM | As revops_admin → "By Stage" tab | No SQL Date Filter visible |
| API blocks non-admin | In browser console: `fetch('/api/dashboard/sgm-conversions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: '{}' }).then(r => r.json()).then(console.log)` while logged in as non-revops_admin | Response: `{ error: 'Forbidden' }` with 403 |

### 9.2 — SQL Date Filter Behavior

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Default is "All Time" | Click "By SGM" tab | Dropdown shows "All Time". Chart and table show all data. |
| Quarter selection | Select "Q1" | Year dropdown appears. Chart and table update to show only Q1 data. |
| Year change | Select "Q1" → change year to previous year | Data updates to show Q1 of that year. |
| YTD | Select "Year to Date" | Data shows from Jan 1 of current year to today. |
| QTD | Select "Quarter to Date" | Data shows from start of current quarter to today. |
| Custom range | Select "Custom Range" | Two date inputs appear. Fill both. Data updates. |
| Custom with one date empty | Select "Custom Range" → fill only start date | Data should NOT update (both dates required). |
| Back to All Time | Switch from any preset to "All Time" | Data resets to show all-time data. Filter state resets. |
| Filter disabled during load | While data is loading | Dropdown should be disabled (grayed out, not clickable). |

### 9.3 — Chart + Date Filter Coordination

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Chart updates with date | Select "Q1 2025" | Chart bars change to show only pipeline from SQLs created in Q1 2025 |
| Chart + table same filter | Select any date filter | Both chart and table show data scoped to the same period |
| Empty date range | Select a quarter with no data (e.g., far future) | Chart shows "No data available". Table shows "No conversion data available". |
| Stage filters still work | Set date filter to Q1 2025 → change stage filters | Both chart and table respect BOTH filters |
| SGM filters still work | Set date filter → change SGM filters | Both chart and table respect BOTH filters |
| Filter state persists | Set date filter → switch to "By Stage" tab → switch back to "By SGM" | Date filter retains its selection |

### 9.4 — Conversion Table Rendering

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Table loads | Click "By SGM" tab | Table appears below the chart with SGM rows |
| Column headers | Observe headers | Should read: SGM, SQLs, SQL→SQO %, SQO'd, SQO→Joined %, Joined |
| Default sort | Observe rows | Sorted by SQLs descending (highest first). SQLs column arrow should be active (blue down arrow). |
| Sort by clicking | Click "SQL→SQO %" header | Rows re-sort by conversion rate descending. Arrow on that column turns blue. |
| Toggle sort direction | Click same column header again | Sort direction reverses (ascending). Up arrow turns blue. |
| Sort different column | Click "Joined" header | Rows re-sort by Joined count descending. Previous column arrow resets. |
| Team Average row | Observe last row | Bold text, "Team Average" label, blue-tinted background, border-top separator |
| Team Average stays at bottom | Sort by any column | Team Average row remains at the bottom regardless of sort |
| Percentage format | Observe % columns | Should display like "75.0%", not "0.75" or "7500%" |
| Number format | Observe count columns | Should display with thousands separators (e.g., "1,234") |
| Dark mode | Toggle dark mode | Table colors, text, zebra striping, Team Average row all adapt |
| Empty state | Filter to no data | Table shows "No conversion data available for selected filters" |

### 9.5 — Data Accuracy Spot Checks

| Test | Steps | Expected Result |
|------|-------|-----------------|
| SQL count sanity | Pick one SGM → note their SQLs count → compare to known Salesforce data | Count should match expected value |
| Conversion rate sanity | Pick one SGM with known outcomes → verify SQL→SQO % | Rate should be reasonable (not 0% or 100% unless correct) |
| All Time totals | Sum all SGMs' SQLs → compare to total funnel SQL count | Should match (minus any null-SGM records) |
| Date-filtered totals | Select Q1 2025 → sum SQLs across all SGMs | Should match what you'd see filtering Salesforce by converted date in Q1 |

### 9.6 — Drill-Down with Date Filter

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Segment click respects date | Set date filter to Q1 2025 → click a bar segment | Modal shows only records from Q1 2025 for that SGM + stage |
| SGM name click respects date | Set date filter to Q1 2025 → click an SGM name | Modal shows only records from Q1 2025 for that SGM |
| All Time drill-down | Set "All Time" → click a segment | Modal shows all records (same as before this feature) |

---

## PHASE 10: Post-Launch Fixes (If Needed)

### Prompt for fixing issues found in UI/UX testing

```
I completed UI/UX testing for the SGM Conversion Table & SQL Date Filter feature. Here are the issues I found:

[PASTE YOUR ISSUES HERE]

For each issue:
1. Read the relevant file before making changes
2. Make the minimal fix needed
3. Run npx tsc --noEmit after each fix
4. Tell me what you changed and why

Do NOT refactor or restructure anything. Only fix the specific issues listed above.
```

---

## Appendix A: Data Flow Diagram

```
                        ┌─────────────────────────────┐
                        │   Pipeline Page (page.tsx)   │
                        │                               │
                        │  State:                       │
                        │  - sqlDateRange (null=AllTime)│
                        │  - conversionData             │
                        │  - bySgmData                  │
                        │  - selectedStages             │
                        │  - selectedSgms               │
                        └───────┬───────────┬───────────┘
                                │           │
                 ┌──────────────┘           └──────────────┐
                 ▼                                          ▼
      fetchBySgmData()                          fetchConversionData()
          │                                          │
          ▼                                          ▼
     POST /api/dashboard/                   POST /api/dashboard/
      pipeline-by-sgm                        sgm-conversions
     { stages, sgms, dateRange }            { sgms, dateRange }
          │                                          │
          ▼                                          ▼
     getOpenPipelineBySgm()                 getSgmConversionData()
     GROUP BY SGM × Stage                  GROUP BY SGM
     → AUM per segment                     → SQL count, SQO count, Joined count
          │                                 → sql_to_sqo numerator/denom
          ▼                                 → sqo_to_joined numerator/denom
     PipelineBySgmChart                          │
     (stacked bar chart)                         ▼
          │                                SgmConversionTable
          │                                (sortable, team avg row)
          │
    ┌─────┴─────┐
    ▼           ▼
  Click       Click
 SEGMENT     SGM NAME
    │           │
    ▼           ▼
handleSegment  handleSgm
   Click()      Click()
    │           │
    ▼           ▼
 POST /api/    POST /api/
 pipeline-     pipeline-
 drilldown     drilldown-sgm
{ stage, sgm,  { sgm, stages,
  sgms,          sgms,
  dateRange }    dateRange }
    │           │
    ▼           ▼
getOpenPipeline getOpenPipeline
RecordsByStage  RecordsBySgm
    │           │
    └─────┬─────┘
          ▼
   VolumeDrillDownModal
   (list of records)
```

## Appendix B: Conversion Rate Definitions

| Rate | Numerator | Denominator | Notes |
|------|-----------|-------------|-------|
| SQL→SQO % | `sql_to_sqo_progression`: is_sql=1 AND SQO_raw='yes' | `eligible_for_sql_conversions`: is_sql=1 AND (SQO_raw='yes' OR StageName='Closed Lost') | Only resolved opps. Open pipeline excluded from denominator. |
| SQO→Joined % | `sqo_to_joined_progression`: SQO_raw='yes' AND (advisor_join_date IS NOT NULL OR StageName='Joined') | `eligible_for_sqo_conversions`: SQO_raw='yes' AND (Joined OR StageName='Closed Lost') | Only resolved SQOs. Open SQOs excluded from denominator. |

## Appendix C: SGM Attribution Note

`SGM_Owner_Name__c` reflects the **CURRENT** opportunity owner, not the owner at SQL creation time. If an opportunity is reassigned from SGM A to SGM B, all conversion data appears under SGM B. This is consistent with the existing stacked bar chart behavior.
