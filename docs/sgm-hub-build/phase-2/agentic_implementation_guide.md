# Agentic Implementation Guide: SGM Hub Phase 2 — Dashboard Tab

## Reference Documents
All decisions in this guide are based on the completed exploration files:
- `docs/sgm-hub-build/phase-2/exploration-results.md` — synthesized findings
- `docs/code-inspector-findings.md` — component props, query functions, type analysis
- `docs/data-verifier-findings.md` — BigQuery field verification, ARR analysis, velocity stats
- `docs/pattern-finder-findings.md` — end-to-end patterns, Recharts conventions, filter architecture

## Feature Summary

| Capability | Source Fields | Notes |
|---|---|---|
| Standard scorecards (SQLs, SQOs, Signed, Signed AUM, Joined, Joined AUM, Open Pipeline AUM) | Existing vw_funnel_master fields | Same as Funnel Performance Focused View |
| Joined ARR (Actual) scorecard | `Actual_ARR__c` (FLOAT64) | 62.1% populated on joined. Show n= count. |
| Pipeline Est. ARR scorecard | `SGM_Estimated_ARR__c` (FLOAT64) | Active pipeline only. 0% on joined records. |
| SQO→Joined velocity column | `Date_Became_SQO__c` → `Stage_Entered_Joined__c` | 87.1% coverage. Avg 82.9 days. |
| Quarterly conversion trend charts | Cohorted quarterly grouping | 12 quarters available. SQL/SQO robust, Joined marginal per-SGM. |
| Pipeline by Stage chart | Reuse existing `PipelineByStageChart` | Props-only, no changes needed |
| SGM Conversion table + velocity | Reuse `SgmConversionTable` + new column | Add `avgDaysSqoToJoined` |
| Stale Pipeline alerts | Reuse existing `StalePipelineAlerts` | Props-only, no changes needed |

### CRITICAL Spec Changes (from data verification)
1. **Original "Estimated ARR" scorecard → "Pipeline Est. ARR"**: `SGM_Estimated_ARR__c` is 0% on Joined records (Salesforce clears at close). Source from active pipeline stages only.
2. **Original "Est. ARR:Actual ARR Ratio" → REMOVED**: Estimated and Actual ARR are mutually exclusive (0 overlap). Ratio is meaningless.
3. **`Account_Total_ARR__c` has team duplication**: Use `Actual_ARR__c` for aggregates (no duplication, 62.1% coverage).

## Architecture Rules
- Never use string interpolation in BigQuery queries — always `@paramName` syntax
- All queries target `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` via the `FULL_TABLE` constant
- Use `toString()` / `toNumber()` from `@/types/bigquery-raw` for type-safe BQ transforms
- Use the LOCAL `extractDate()` helper within `open-pipeline.ts` (NOT the shared `extractDateValue()`)
- All query functions wrapped in `cachedQuery(..., CACHE_TAGS.DASHBOARD, { revalidate: 300 })`
- `isAnimationActive={false}` on ALL Recharts Bar/Line/Area components (D3 crash fix)
- Dark mode: `useTheme().resolvedTheme === "dark"` for color switching
- Filter pattern: System B (direct-apply, single-state) matching SGMHubContent.tsx leaderboard

## Pre-Flight Checklist
```bash
npm run build 2>&1 | tail -5
```
If pre-existing errors, stop and report. Do not proceed with a broken baseline.

---

# PHASE 1: BigQuery Field Verification

## Context
Before writing any code, confirm the 4 new fields exist and are populated in the live view.

## Step 1.1: Verify fields via BigQuery MCP
Run these queries against `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`:

```sql
-- Confirm field existence
SELECT column_name, data_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
  AND column_name IN ('Actual_ARR__c', 'SGM_Estimated_ARR__c', 'Account_Total_ARR__c', 'Stage_Entered_Joined__c')
ORDER BY column_name;
```

Expected: 4 rows — Actual_ARR__c (FLOAT64), SGM_Estimated_ARR__c (FLOAT64), Account_Total_ARR__c (FLOAT64), Stage_Entered_Joined__c (TIMESTAMP).

```sql
-- Confirm population on joined records
SELECT
  COUNT(*) as total_joined,
  COUNTIF(Actual_ARR__c IS NOT NULL) as has_actual_arr,
  COUNTIF(SGM_Estimated_ARR__c IS NOT NULL) as has_estimated_arr,
  COUNTIF(Stage_Entered_Joined__c IS NOT NULL) as has_stage_entered_joined,
  COUNTIF(Date_Became_SQO__c IS NOT NULL) as has_sqo_date
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_joined_unique = 1;
```

Expected: ~116 total joined, ~72 actual_arr, 0 estimated_arr (confirming it's pipeline-only), ~106 stage_entered_joined, ~109 sqo_date.

## PHASE 1 — VALIDATION GATE
**Expected**: All 4 fields exist with expected population rates.
**If fields are missing**: STOP. The view update has not been deployed. This is a blocker.

**STOP AND REPORT**: Tell the user:
- "BigQuery fields verified: [results]"
- "Ready to proceed to Phase 2 (Types)?"

---

# PHASE 2: Type Definitions

## Context
Add all new TypeScript types needed for the Dashboard tab. Types are added as OPTIONAL fields to existing interfaces to avoid breaking existing code. New interfaces are added to `sgm-hub.ts`.

## Step 2.1: Extend `SgmConversionData` in `src/types/dashboard.ts`
**File**: `src/types/dashboard.ts`

Add `avgDaysSqoToJoined` to the existing `SgmConversionData` interface (after line 272):

```typescript
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
  avgDaysSqoToJoined?: number;  // ADD: Average days from SQO to Joined
}
```

## Step 2.2: Add Dashboard tab types to `src/types/sgm-hub.ts`
**File**: `src/types/sgm-hub.ts`

Append after line 41 (after the `SGMOption` interface):

```typescript
// ============================================
// Phase 2: Dashboard Tab Types
// ============================================

/**
 * Filters for SGM Dashboard tab
 * Uses date range (not quarter) since it mirrors Funnel Performance
 */
export interface SGMDashboardFilters {
  startDate: string;        // YYYY-MM-DD
  endDate: string;          // YYYY-MM-DD
  channels: string[];       // Required, non-empty
  sources?: string[];       // Optional; omit = all sources
  sgmNames?: string[];      // Optional; omit = all active SGMs
}

/**
 * Dashboard tab metrics — standard funnel + ARR additions
 */
export interface SGMDashboardMetrics {
  // Standard 7 from Funnel Performance Focused View
  sqls: number;
  sqos: number;
  signed: number;
  signedAum: number;
  joined: number;
  joinedAum: number;
  openPipelineAum: number;
  // ARR additions
  actualArr: number;          // SUM(Actual_ARR__c) from joined records
  arrCoverageCount: number;   // n= advisors with Actual_ARR__c
  estimatedArr: number;       // SUM(SGM_Estimated_ARR__c) from active pipeline
  estimatedArrCount: number;  // n= pipeline records with SGM_Estimated_ARR__c
}

/**
 * Quarterly conversion trend data point for cohorted charts
 */
export interface SGMConversionTrend {
  quarter: string;           // "2025-Q1" format (lexicographic sortable)
  sqlCount: number;
  sqoCount: number;
  joinedCount: number;
  sqlToSqoRate: number;      // Calculated JS-side via safeDiv
  sqoToJoinedRate: number;   // Calculated JS-side via safeDiv
  sqlToSqoNumer: number;
  sqlToSqoDenom: number;
  sqoToJoinedNumer: number;
  sqoToJoinedDenom: number;
}
```

## PHASE 2 — VALIDATION GATE
```bash
npx tsc --noEmit 2>&1 | tail -10
```
**Expected**: Zero new errors (all new fields are optional or in new interfaces). Build should pass cleanly.

**STOP AND REPORT**: Tell the user:
- "Types added: `SGMDashboardFilters`, `SGMDashboardMetrics`, `SGMConversionTrend` in `sgm-hub.ts`; `avgDaysSqoToJoined` in `SgmConversionData`"
- "Ready to proceed to Phase 3 (Queries)?"

---

# PHASE 3: Query Functions

## Context
Create a new query file for dashboard-specific queries and modify the existing conversion query for the velocity column.

## Step 3.1: Add velocity column to `getSgmConversionData` in `src/lib/queries/open-pipeline.ts`
**File**: `src/lib/queries/open-pipeline.ts`

### 3.1a: Add velocity SELECT column
In the SQL query inside `_getSgmConversionData` (~line 796-813), add after the `SUM(v.is_joined_unique) as joined_count` line:

```sql
      SUM(v.is_joined_unique) as joined_count,
      ROUND(AVG(
        CASE WHEN v.is_joined_unique = 1
          AND v.Stage_Entered_Joined__c IS NOT NULL
          AND v.Date_Became_SQO__c IS NOT NULL
        THEN DATE_DIFF(DATE(v.Stage_Entered_Joined__c), DATE(v.Date_Became_SQO__c), DAY)
        END
      ), 1) as avg_days_sqo_to_joined
```

### 3.1b: Add to the `runQuery` type parameter
In the generic type (~line 816-825), add:

```typescript
    avg_days_sqo_to_joined: number | null;
```

### 3.1c: Add to the results.map transform
In the return mapping (~line 829-840), add after `joinedCount`:

```typescript
    joinedCount: toNumber(r.joined_count),
    avgDaysSqoToJoined: r.avg_days_sqo_to_joined != null ? toNumber(r.avg_days_sqo_to_joined) : undefined,
```

## Step 3.2: Create `src/lib/queries/sgm-dashboard.ts`
**File**: `src/lib/queries/sgm-dashboard.ts` (NEW)

```typescript
import { runQuery, FULL_TABLE, RECRUITING_RECORD_TYPE } from './bigquery-client';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { toNumber, toString } from '@/types/bigquery-raw';
import { SGMDashboardMetrics, SGMConversionTrend } from '@/types/sgm-hub';

// ============================================
// Dashboard Metrics (Scorecards)
// ============================================

interface DashboardMetricsFilters {
  startDate: string;
  endDate: string;
  channels: string[];
  sources?: string[];
  sgmNames?: string[];
}

const _getSgmDashboardMetrics = async (
  filters: DashboardMetricsFilters
): Promise<SGMDashboardMetrics> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');
  conditions.push('v.FilterDate IS NOT NULL');
  conditions.push('DATE(v.FilterDate) >= DATE(@startDate)');
  conditions.push('DATE(v.FilterDate) <= DATE(@endDate)');

  // Channel filter
  if (filters.channels.length > 0) {
    const chParams = filters.channels.map((_, i) => `@ch${i}`);
    conditions.push(`IFNULL(v.Channel_Grouping_Name, 'Other') IN (${chParams.join(', ')})`);
    filters.channels.forEach((ch, i) => { params[`ch${i}`] = ch; });
  }

  // Source filter
  if (filters.sources && filters.sources.length > 0) {
    const srcParams = filters.sources.map((_, i) => `@src${i}`);
    conditions.push(`v.Original_source IN (${srcParams.join(', ')})`);
    filters.sources.forEach((src, i) => { params[`src${i}`] = src; });
  }

  // SGM filter
  if (filters.sgmNames && filters.sgmNames.length > 0) {
    const sgmParams = filters.sgmNames.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgmNames.forEach((sgm, i) => { params[`sgm${i}`] = sgm; });
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const query = `
    SELECT
      -- Standard funnel metrics
      COUNT(CASE WHEN v.is_sql = 1 AND v.is_primary_opp_record = 1 THEN 1 END) as sqls,
      SUM(v.is_sqo_unique) as sqos,
      COUNTIF(v.StageName = 'Signed' AND v.is_primary_opp_record = 1) as signed,
      COALESCE(SUM(CASE WHEN v.StageName = 'Signed' AND v.is_primary_opp_record = 1 THEN v.Opportunity_AUM END), 0) as signed_aum,
      SUM(v.is_joined_unique) as joined,
      COALESCE(SUM(CASE WHEN v.is_joined_unique = 1 THEN v.Opportunity_AUM END), 0) as joined_aum,
      -- Open pipeline AUM (active stages only)
      COALESCE(SUM(CASE WHEN v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'Signed', 'On Hold', 'Planned Nurture')
        AND v.is_primary_opp_record = 1 THEN v.Opportunity_AUM END), 0) as open_pipeline_aum,
      -- ARR metrics
      COALESCE(SUM(CASE WHEN v.is_joined_unique = 1 THEN v.Actual_ARR__c END), 0) as actual_arr,
      COUNT(CASE WHEN v.is_joined_unique = 1 AND v.Actual_ARR__c IS NOT NULL THEN 1 END) as arr_coverage_count,
      -- Pipeline estimated ARR (active pipeline stages only)
      COALESCE(SUM(CASE WHEN v.StageName IN ('Sales Process', 'Negotiating', 'Discovery', 'On Hold')
        AND v.SGM_Estimated_ARR__c IS NOT NULL THEN v.SGM_Estimated_ARR__c END), 0) as estimated_arr,
      COUNT(CASE WHEN v.StageName IN ('Sales Process', 'Negotiating', 'Discovery', 'On Hold')
        AND v.SGM_Estimated_ARR__c IS NOT NULL THEN 1 END) as estimated_arr_count
    FROM \`${FULL_TABLE}\` v
    ${whereClause}
  `;

  const results = await runQuery<{
    sqls: number | null;
    sqos: number | null;
    signed: number | null;
    signed_aum: number | null;
    joined: number | null;
    joined_aum: number | null;
    open_pipeline_aum: number | null;
    actual_arr: number | null;
    arr_coverage_count: number | null;
    estimated_arr: number | null;
    estimated_arr_count: number | null;
  }>(query, params);

  const r = results[0] || {};
  return {
    sqls: toNumber(r.sqls),
    sqos: toNumber(r.sqos),
    signed: toNumber(r.signed),
    signedAum: toNumber(r.signed_aum),
    joined: toNumber(r.joined),
    joinedAum: toNumber(r.joined_aum),
    openPipelineAum: toNumber(r.open_pipeline_aum),
    actualArr: toNumber(r.actual_arr),
    arrCoverageCount: toNumber(r.arr_coverage_count),
    estimatedArr: toNumber(r.estimated_arr),
    estimatedArrCount: toNumber(r.estimated_arr_count),
  };
};

export const getSgmDashboardMetrics = cachedQuery(
  _getSgmDashboardMetrics,
  'getSgmDashboardMetrics',
  CACHE_TAGS.DASHBOARD
);

// ============================================
// Conversion Trend (Quarterly Cohorted)
// ============================================

interface ConversionTrendFilters {
  startDate: string;        // Earliest quarter start
  endDate: string;          // Latest quarter end
  channels?: string[];
  sources?: string[];
  sgmNames?: string[];
}

const _getSgmConversionTrend = async (
  filters: ConversionTrendFilters
): Promise<SGMConversionTrend[]> => {
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };

  conditions.push('v.recordtypeid = @recruitingRecordType');
  conditions.push('v.SGM_Owner_Name__c IS NOT NULL');

  // Channel filter
  if (filters.channels && filters.channels.length > 0) {
    const chParams = filters.channels.map((_, i) => `@ch${i}`);
    conditions.push(`IFNULL(v.Channel_Grouping_Name, 'Other') IN (${chParams.join(', ')})`);
    filters.channels.forEach((ch, i) => { params[`ch${i}`] = ch; });
  }

  // Source filter
  if (filters.sources && filters.sources.length > 0) {
    const srcParams = filters.sources.map((_, i) => `@src${i}`);
    conditions.push(`v.Original_source IN (${srcParams.join(', ')})`);
    filters.sources.forEach((src, i) => { params[`src${i}`] = src; });
  }

  // SGM filter
  if (filters.sgmNames && filters.sgmNames.length > 0) {
    const sgmParams = filters.sgmNames.map((_, i) => `@sgm${i}`);
    conditions.push(`v.SGM_Owner_Name__c IN (${sgmParams.join(', ')})`);
    filters.sgmNames.forEach((sgm, i) => { params[`sgm${i}`] = sgm; });
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  // COHORTED: each stage uses its own date field for quarter bucketing
  // SQL count anchored on converted_date_raw, SQO on Date_Became_SQO__c, Joined on advisor_join_date__c
  const query = `
    WITH quarters AS (
      SELECT DISTINCT
        CONCAT(CAST(EXTRACT(YEAR FROM d) AS STRING), '-Q',
               CAST(EXTRACT(QUARTER FROM d) AS STRING)) AS quarter
      FROM UNNEST(GENERATE_DATE_ARRAY(DATE(@startDate), DATE(@endDate), INTERVAL 1 DAY)) AS d
    ),
    sql_data AS (
      SELECT
        CONCAT(CAST(EXTRACT(YEAR FROM v.converted_date_raw) AS STRING), '-Q',
               CAST(EXTRACT(QUARTER FROM v.converted_date_raw) AS STRING)) AS quarter,
        COUNT(CASE WHEN v.is_sql = 1 AND v.is_primary_opp_record = 1 THEN 1 END) as sql_count,
        SUM(v.sql_to_sqo_progression) as sql_to_sqo_numer,
        SUM(v.eligible_for_sql_conversions) as sql_to_sqo_denom
      FROM \`${FULL_TABLE}\` v
      ${whereClause}
        AND v.converted_date_raw IS NOT NULL
        AND DATE(v.converted_date_raw) >= DATE(@startDate)
        AND DATE(v.converted_date_raw) <= DATE(@endDate)
      GROUP BY quarter
    ),
    sqo_data AS (
      SELECT
        CONCAT(CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), '-Q',
               CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)) AS quarter,
        SUM(v.is_sqo_unique) as sqo_count
      FROM \`${FULL_TABLE}\` v
      ${whereClause}
        AND v.Date_Became_SQO__c IS NOT NULL
        AND DATE(v.Date_Became_SQO__c) >= DATE(@startDate)
        AND DATE(v.Date_Became_SQO__c) <= DATE(@endDate)
      GROUP BY quarter
    ),
    joined_data AS (
      SELECT
        CONCAT(CAST(EXTRACT(YEAR FROM v.advisor_join_date__c) AS STRING), '-Q',
               CAST(EXTRACT(QUARTER FROM v.advisor_join_date__c) AS STRING)) AS quarter,
        SUM(v.is_joined_unique) as joined_count,
        SUM(v.is_joined_unique) + COUNTIF(v.StageName = 'Closed Lost' AND v.is_sqo_unique = 1) as sqo_to_joined_denom
      FROM \`${FULL_TABLE}\` v
      ${whereClause}
        AND v.advisor_join_date__c IS NOT NULL
        AND v.advisor_join_date__c >= DATE(@startDate)
        AND v.advisor_join_date__c <= DATE(@endDate)
      GROUP BY quarter
    )
    SELECT
      q.quarter,
      COALESCE(s.sql_count, 0) as sql_count,
      COALESCE(sq.sqo_count, 0) as sqo_count,
      COALESCE(j.joined_count, 0) as joined_count,
      COALESCE(s.sql_to_sqo_numer, 0) as sql_to_sqo_numer,
      COALESCE(s.sql_to_sqo_denom, 0) as sql_to_sqo_denom,
      COALESCE(sq.sqo_count, 0) as sqo_to_joined_numer,
      COALESCE(j.sqo_to_joined_denom, 0) as sqo_to_joined_denom
    FROM quarters q
    LEFT JOIN sql_data s ON q.quarter = s.quarter
    LEFT JOIN sqo_data sq ON q.quarter = sq.quarter
    LEFT JOIN joined_data j ON q.quarter = j.quarter
    ORDER BY q.quarter ASC
  `;

  const results = await runQuery<{
    quarter: string | null;
    sql_count: number | null;
    sqo_count: number | null;
    joined_count: number | null;
    sql_to_sqo_numer: number | null;
    sql_to_sqo_denom: number | null;
    sqo_to_joined_numer: number | null;
    sqo_to_joined_denom: number | null;
  }>(query, params);

  const safeDiv = (n: number, d: number) => d === 0 ? 0 : n / d;

  return results
    .filter(r => r.quarter != null)
    .map(r => ({
      quarter: toString(r.quarter),
      sqlCount: toNumber(r.sql_count),
      sqoCount: toNumber(r.sqo_count),
      joinedCount: toNumber(r.joined_count),
      sqlToSqoNumer: toNumber(r.sql_to_sqo_numer),
      sqlToSqoDenom: toNumber(r.sql_to_sqo_denom),
      sqlToSqoRate: safeDiv(toNumber(r.sql_to_sqo_numer), toNumber(r.sql_to_sqo_denom)),
      sqoToJoinedNumer: toNumber(r.sqo_to_joined_numer),
      sqoToJoinedDenom: toNumber(r.sqo_to_joined_denom),
      sqoToJoinedRate: safeDiv(toNumber(r.sqo_to_joined_numer), toNumber(r.sqo_to_joined_denom)),
    }))
    .sort((a, b) => a.quarter.localeCompare(b.quarter));
};

export const getSgmConversionTrend = cachedQuery(
  _getSgmConversionTrend,
  'getSgmConversionTrend',
  CACHE_TAGS.DASHBOARD
);
```

## PHASE 3 — VALIDATION GATE
```bash
npx tsc --noEmit 2>&1 | tail -10
```
**Expected**: Zero errors. New query file compiles, velocity column added to existing query.

**STOP AND REPORT**: Tell the user:
- "Query functions created: `getSgmDashboardMetrics`, `getSgmConversionTrend` in new `sgm-dashboard.ts`"
- "Velocity column added to `getSgmConversionData` in `open-pipeline.ts`"
- "Ready to proceed to Phase 4 (API Routes)?"

---

# PHASE 4: API Routes + API Client

## Context
Create 3 new API routes for the Dashboard tab and add corresponding client methods. Existing pipeline routes already support SGM filtering — no new routes needed for pipeline chart, stale pipeline, or pipeline drilldowns.

## Step 4.1: Create `src/app/api/sgm-hub/dashboard-metrics/route.ts` (NEW)
**File**: `src/app/api/sgm-hub/dashboard-metrics/route.ts`

Follow the auth pattern from `src/app/api/sgm-hub/leaderboard/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPermissionsFromToken } from '@/lib/permissions';
import { getSgmDashboardMetrics } from '@/lib/queries/sgm-dashboard';

const ALLOWED_ROLES = ['admin', 'manager', 'sgm', 'revops_admin'];

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getPermissionsFromToken(session);
    if (!ALLOWED_ROLES.includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { startDate, endDate, channels, sources, sgmNames } = body;

    if (!startDate || !endDate || !channels || channels.length === 0) {
      return NextResponse.json({ error: 'startDate, endDate, and channels are required' }, { status: 400 });
    }

    // Auto-scope SGM users to their own data if no sgmNames filter provided
    const effectiveSgmNames = permissions.role === 'sgm' && (!sgmNames || sgmNames.length === 0)
      ? [permissions.sgmFilter].filter(Boolean) as string[]
      : sgmNames;

    const metrics = await getSgmDashboardMetrics({
      startDate,
      endDate,
      channels,
      sources,
      sgmNames: effectiveSgmNames,
    });

    return NextResponse.json({ metrics });
  } catch (error) {
    console.error('SGM Dashboard metrics error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

## Step 4.2: Create `src/app/api/sgm-hub/conversions/route.ts` (NEW)
**File**: `src/app/api/sgm-hub/conversions/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPermissionsFromToken } from '@/lib/permissions';
import { getSgmConversionData } from '@/lib/queries/open-pipeline';

const ALLOWED_ROLES = ['admin', 'manager', 'sgm', 'revops_admin'];

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getPermissionsFromToken(session);
    if (!ALLOWED_ROLES.includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { sgmNames, dateRange } = body;

    // Auto-scope SGM users
    const effectiveSgms = permissions.role === 'sgm' && (!sgmNames || sgmNames.length === 0)
      ? [permissions.sgmFilter].filter(Boolean) as string[]
      : sgmNames;

    const data = await getSgmConversionData({
      sgms: effectiveSgms,
      dateRange: dateRange || null,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('SGM Hub conversions error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

## Step 4.3: Create `src/app/api/sgm-hub/conversion-trend/route.ts` (NEW)
**File**: `src/app/api/sgm-hub/conversion-trend/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getPermissionsFromToken } from '@/lib/permissions';
import { getSgmConversionTrend } from '@/lib/queries/sgm-dashboard';

const ALLOWED_ROLES = ['admin', 'manager', 'sgm', 'revops_admin'];

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getPermissionsFromToken(session);
    if (!ALLOWED_ROLES.includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { startDate, endDate, channels, sources, sgmNames } = body;

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate and endDate are required' }, { status: 400 });
    }

    const effectiveSgmNames = permissions.role === 'sgm' && (!sgmNames || sgmNames.length === 0)
      ? [permissions.sgmFilter].filter(Boolean) as string[]
      : sgmNames;

    const data = await getSgmConversionTrend({
      startDate,
      endDate,
      channels,
      sources,
      sgmNames: effectiveSgmNames,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('SGM Hub conversion trend error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

## Step 4.4: Add API client methods to `src/lib/api-client.ts`
**File**: `src/lib/api-client.ts`

Add after the `getJoinedDrillDown` method (~line 694), before the SGA drill-down section:

```typescript
  // SGM Hub Dashboard methods
  getSGMDashboardMetrics: (filters: {
    startDate: string;
    endDate: string;
    channels: string[];
    sources?: string[];
    sgmNames?: string[];
  }) =>
    apiFetch<{ metrics: import('@/types/sgm-hub').SGMDashboardMetrics }>(
      '/api/sgm-hub/dashboard-metrics',
      { method: 'POST', body: JSON.stringify(filters) }
    ),

  getSGMConversions: (filters: {
    sgmNames?: string[];
    dateRange?: { startDate: string; endDate: string } | null;
  }) =>
    apiFetch<{ data: import('@/types/dashboard').SgmConversionData[] }>(
      '/api/sgm-hub/conversions',
      { method: 'POST', body: JSON.stringify(filters) }
    ),

  getSGMConversionTrend: (filters: {
    startDate: string;
    endDate: string;
    channels?: string[];
    sources?: string[];
    sgmNames?: string[];
  }) =>
    apiFetch<{ data: import('@/types/sgm-hub').SGMConversionTrend[] }>(
      '/api/sgm-hub/conversion-trend',
      { method: 'POST', body: JSON.stringify(filters) }
    ),
```

## PHASE 4 — VALIDATION GATE
```bash
npx tsc --noEmit 2>&1 | tail -10
```
**Expected**: Zero errors. 3 new routes compile, 3 new client methods typed correctly.

**STOP AND REPORT**: Tell the user:
- "3 API routes created: `dashboard-metrics`, `conversions`, `conversion-trend`"
- "3 client methods added: `getSGMDashboardMetrics`, `getSGMConversions`, `getSGMConversionTrend`"
- "Ready to proceed to Phase 5 (Filter Component)?"

---

# PHASE 5: Dashboard Filter Component

## Context
Create `SGMDashboardFilters.tsx` following the System B (direct-apply) pattern used by the leaderboard tab. Includes date range picker, channels, sources, SGM selector, and an advanced filters slide-out panel.

## Step 5.1: Create `src/components/sgm-hub/SGMDashboardFilters.tsx` (NEW)
**File**: `src/components/sgm-hub/SGMDashboardFilters.tsx`

Build this component with:
- **Props**: `selectedDateRange`, `selectedChannels`, `selectedSources`, `selectedSGMs`, channel/source/sgm option arrays, `onApply` callback, `disabled` boolean
- **Local state**: pending copies of all filter values
- **Apply button**: calls `onApply({dateRange, channels, sources, sgms})` → parent state updates
- **Date range**: Tremor `DateRangePicker` or custom preset selector (QTD, YTD, Q1-Q4, custom) + year selector — mirror the `GlobalFilters.tsx` date range pattern
- **Advanced filters button**: toggles `advancedOpen` state → renders slide-out panel with multi-select checkboxes for channels, sources, SGMs with search
- **No experimentation tag filters** per spec
- **Layout**: Single row with date range + "Advanced Filters" button, matching the `GlobalFilters` + `AdvancedFiltersButton` layout pattern

Reference: `src/components/sgm-hub/SGMLeaderboardFilters.tsx` for the SGM Hub filter component pattern, and `src/components/dashboard/GlobalFilters.tsx` + `src/components/dashboard/AdvancedFilters.tsx` for the date range + slide-out pattern.

Key architectural decisions:
- Use System B (direct-apply, no pending/applied split) — filter state IS applied state
- Date range defaults to QTD (same as Funnel Performance)
- All channels + all sources selected by default
- SGM user: auto-apply `sgmFilter` as default SGM selection, can change
- Admin/RevOps: no default SGM filter, sees everyone

## Step 5.2: Create `src/components/sgm-hub/SGMQuarterSelector.tsx` (NEW)
**File**: `src/components/sgm-hub/SGMQuarterSelector.tsx`

Simple selector component:
- Props: `quarterCount: number`, `onQuarterCountChange: (count: number) => void`
- Renders button group: 4, 5, 6, 7, 8 quarters
- Default: 4 (current + 3 prior)
- Styling: small button group matching card theme (`bg-gray-100 dark:bg-gray-700` for unselected, `bg-blue-600 text-white` for selected)

## PHASE 5 — VALIDATION GATE
```bash
npx tsc --noEmit 2>&1 | tail -10
```
**Expected**: Zero errors. Components compile.

**STOP AND REPORT**: Tell the user:
- "Filter components created: `SGMDashboardFilters.tsx`, `SGMQuarterSelector.tsx`"
- "Ready to proceed to Phase 6 (Scorecards)?"

---

# PHASE 6: Scorecards Component

## Context
Create `SGMDashboardScorecards.tsx` — a new component that displays 9 metric cards (7 standard + 2 ARR). This is NOT reusing the existing `Scorecards.tsx` directly because its `visibleMetrics` interface doesn't support ARR cards. Instead, build a new component following the same display patterns.

## Step 6.1: Create `src/components/sgm-hub/SGMDashboardScorecards.tsx` (NEW)
**File**: `src/components/sgm-hub/SGMDashboardScorecards.tsx`

Build with:
- **Props**: `metrics: SGMDashboardMetrics | null`, `loading: boolean`, `onMetricClick?: (metric: string) => void`
- **9 cards** in responsive grid (`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6`):
  1. SQLs → `metrics.sqls` — click fires `onMetricClick('sql')`
  2. SQOs → `metrics.sqos` — click fires `onMetricClick('sqo')`
  3. Signed → `metrics.signed`
  4. Signed AUM → `metrics.signedAum` — format as currency
  5. Joined → `metrics.joined` — click fires `onMetricClick('joined')`
  6. Joined AUM → `metrics.joinedAum` — format as currency
  7. Open Pipeline AUM → `metrics.openPipelineAum` — click fires `onMetricClick('openPipeline')`
  8. **Joined ARR (Actual)** → `metrics.actualArr` — format as currency, show `(n=${metrics.arrCoverageCount})` subtitle
  9. **Pipeline Est. ARR** → `metrics.estimatedArr` — format as currency, show `(n=${metrics.estimatedArrCount})` subtitle
- **No disposition toggles** (unlike Funnel Performance)
- **No goal variance display** (no goals for this view)
- **Card styling**: `bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4`
- **Clickable cards**: `cursor-pointer hover:border-blue-500 transition-colors`
- **Loading state**: when `loading=true` or `metrics=null`, show skeleton placeholders (`animate-pulse bg-gray-200 dark:bg-gray-700 h-8 w-24 rounded`)
- **Currency formatting**: use existing `formatAum` or similar helper for AUM values, `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })` for ARR values

## PHASE 6 — VALIDATION GATE
```bash
npx tsc --noEmit 2>&1 | tail -10
```
**Expected**: Zero errors.

**STOP AND REPORT**: Tell the user:
- "Scorecards component created with 9 metric cards including 2 ARR metrics"
- "Ready to proceed to Phase 7 (Conversion Charts)?"

---

# PHASE 7: Conversion Charts Component

## Context
Create `SGMConversionCharts.tsx` — two quarterly charts (rate trend + volume bars). Cohorted only, quarterly only, with quarter count selector.

## Step 7.1: Create `src/components/sgm-hub/SGMConversionCharts.tsx` (NEW)
**File**: `src/components/sgm-hub/SGMConversionCharts.tsx`

Build with:
- **Props**: `data: SGMConversionTrend[]`, `loading: boolean`, `quarterCount: number`, `onQuarterCountChange: (n: number) => void`, `onVolumeBarClick?: (quarter: string, metric: 'sql' | 'sqo' | 'joined') => void`
- **Data slicing**: Take the last `quarterCount` entries from `data` array
- **Two charts side-by-side** (`grid grid-cols-1 xl:grid-cols-2 gap-6`):

### Chart 1: Conversion Rate Trend (Line chart)
- Recharts `LineChart` with `ResponsiveContainer` height 350
- Two lines: SQL→SQO% (blue `#3B82F6`) and SQO→Joined% (green `#10B981`)
- YAxis: percentage format (`tickFormatter={(v) => \`${(v * 100).toFixed(0)}%\`}`)
- XAxis: `dataKey="quarter"` (display-ready, no formatter needed)
- `isAnimationActive={false}` on both Lines
- `CustomTooltip` with guard pattern
- Legend below chart

### Chart 2: Conversion Volume Trend (Stacked bar chart)
- Recharts `BarChart` with `ResponsiveContainer` height 350
- Three bars: SQLs (blue), SQOs (amber `#F59E0B`), Joined (green)
- All bars: `isAnimationActive={false}`, `cursor="pointer"`
- Click handler: `onClick={(data) => onVolumeBarClick?.(data.quarter, metricKey)}`
- `LabelList` for above-bar labels (count values)
- `Cell` children for hover effect

### Both charts:
- Dark mode via `useTheme().resolvedTheme === "dark"`
- `CartesianGrid` with `strokeDasharray="3 3"` and dark mode colors
- Loading skeleton: `h-[350px] animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg`
- Empty state: "No conversion data available"

### Quarter selector integration:
- Render `SGMQuarterSelector` above the charts with `quarterCount` and `onQuarterCountChange`

## PHASE 7 — VALIDATION GATE
```bash
npx tsc --noEmit 2>&1 | tail -10
```
**Expected**: Zero errors.

**STOP AND REPORT**: Tell the user:
- "Conversion charts component created: rate trend line chart + volume bar chart with quarter selector"
- "Ready to proceed to Phase 8 (Reused Components)?"

---

# PHASE 8: Modify Reused Components

## Context
Add `hideSgmFilter` prop to `PipelineFilters` and add the velocity column + `hideTeamAverage` prop to `SgmConversionTable`.

## Step 8.1: Add `hideSgmFilter` to `PipelineFilters.tsx`
**File**: `src/components/dashboard/PipelineFilters.tsx`

### 8.1a: Add to props interface (~line 19-29)
```typescript
interface PipelineFiltersProps {
  selectedStages: string[];
  onApply: (stages: string[], sgms: string[]) => void;
  selectedSgms: string[];
  sgmOptions: SgmOption[];
  sgmOptionsLoading: boolean;
  disabled?: boolean;
  hideSgmFilter?: boolean;  // ADD: Hide SGM owner filter when global SGM filter exists
}
```

### 8.1b: Destructure in component signature
Add `hideSgmFilter = false` to destructuring.

### 8.1c: Wrap SGM filter section in conditional
Find the SGM Owner filter section (~line 285) and wrap it:
```tsx
{!hideSgmFilter && (
  // ... existing SGM filter section through ~line 379
)}
```

## Step 8.2: Add velocity column and `hideTeamAverage` to `SgmConversionTable.tsx`
**File**: `src/components/dashboard/SgmConversionTable.tsx`

### 8.2a: Add to props interface (~line 22-27)
```typescript
interface SgmConversionTableProps {
  data: SgmConversionData[];
  loading?: boolean;
  onMetricClick?: (sgm: string, metric: SgmConversionMetricType) => void;
  hideTeamAverage?: boolean;  // ADD: Hide team average row for single-SGM view
}
```

### 8.2b: Add 'velocity' to SortColumn type (~line 17)
```typescript
type SortColumn = 'sgm' | 'sqls' | 'sqlToSqo' | 'sqos' | 'sqoToJoined' | 'joined' | 'velocity';
```

### 8.2c: Add velocity sort case in `sortedData` useMemo (~line 34-58)
```typescript
        case 'velocity':
          comparison = (a.avgDaysSqoToJoined ?? 999) - (b.avgDaysSqoToJoined ?? 999);
          break;
```

### 8.2d: Add velocity to team average calculation (~line 64-82)
After `totalJoined` calculation:
```typescript
    const velocityValues = data.filter(d => d.avgDaysSqoToJoined != null).map(d => d.avgDaysSqoToJoined!);
    const avgVelocity = velocityValues.length > 0
      ? Math.round(velocityValues.reduce((sum, v) => sum + v, 0) / velocityValues.length * 10) / 10
      : undefined;
```
And add to the returned team average object:
```typescript
      avgDaysSqoToJoined: avgVelocity,
```

### 8.2e: Add column header after "Joined" in TableHead (~line 148)
```tsx
              <SortableHeader column="velocity" className="w-[12%]">SQO→Joined (days)</SortableHeader>
```
Adjust other column widths from `w-1/6` to `w-[15%]` to accommodate the new column.

### 8.2f: Add velocity cell in data rows (~line 206, after the Joined cell)
```tsx
                  <TableCell className="w-[12%] text-right text-gray-600 dark:text-gray-400">
                    {row.avgDaysSqoToJoined != null ? `${row.avgDaysSqoToJoined}d` : '—'}
                  </TableCell>
```

### 8.2g: Add velocity cell in team average row (~line 221)
```tsx
                <TableCell className="w-[12%] text-right font-bold">
                  {teamAverage.avgDaysSqoToJoined != null ? `${teamAverage.avgDaysSqoToJoined}d` : '—'}
                </TableCell>
```

### 8.2h: Conditional team average rendering (~line 212)
Change from:
```tsx
            {teamAverage && (
```
To:
```tsx
            {teamAverage && !hideTeamAverage && (
```

## PHASE 8 — VALIDATION GATE
```bash
npx tsc --noEmit 2>&1 | tail -10
```
**Expected**: Zero errors. Both modified components compile with new props.

**STOP AND REPORT**: Tell the user:
- "`PipelineFilters`: added `hideSgmFilter` prop"
- "`SgmConversionTable`: added velocity column + `hideTeamAverage` prop"
- "Ready to proceed to Phase 9 (Wire Dashboard Tab)?"

---

# PHASE 9: Wire Dashboard Tab in SGMHubContent.tsx

## Context
This is the largest phase. Add all Dashboard tab state, fetch logic, and rendering to the existing `SGMHubContent.tsx`. This replaces the "Coming soon" placeholder at lines 257-262.

## Step 9.1: Add imports
**File**: `src/app/dashboard/sgm-hub/SGMHubContent.tsx`

Add to existing imports:

```typescript
import { SGMDashboardMetrics, SGMConversionTrend } from '@/types/sgm-hub';
import { SgmConversionData, DetailRecord, OpenPipelineByStage } from '@/types/dashboard';
import { VolumeDrillDownModal } from '@/components/dashboard/VolumeDrillDownModal';
import { SGMDashboardFilters as SGMDashboardFiltersComponent } from '@/components/sgm-hub/SGMDashboardFilters';
import { SGMDashboardScorecards } from '@/components/sgm-hub/SGMDashboardScorecards';
import { SGMConversionCharts } from '@/components/sgm-hub/SGMConversionCharts';
import { PipelineByStageChart } from '@/components/dashboard/PipelineByStageChart';
import { PipelineFilters } from '@/components/dashboard/PipelineFilters';
import { SgmConversionTable, SgmConversionMetricType } from '@/components/dashboard/SgmConversionTable';
import { StalePipelineAlerts } from '@/components/dashboard/StalePipelineAlerts';
```

NOTE: Use dynamic imports (`next/dynamic`) for chart components to avoid SSR issues:
```typescript
import nextDynamic from 'next/dynamic';

const SGMConversionCharts = nextDynamic(
  () => import('@/components/sgm-hub/SGMConversionCharts').then(m => ({ default: m.SGMConversionCharts })),
  { ssr: false, loading: () => <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" /> }
);

const PipelineByStageChart = nextDynamic(
  () => import('@/components/dashboard/PipelineByStageChart').then(m => ({ default: m.PipelineByStageChart })),
  { ssr: false, loading: () => <div className="h-64 animate-pulse bg-gray-100 dark:bg-gray-700 rounded-lg" /> }
);
```

## Step 9.2: Add Dashboard tab state vars
Add after the Record Detail modal state (~line 59):

```typescript
  // ============================================
  // Dashboard tab state
  // ============================================

  // Dashboard filters (separate from leaderboard — date range vs quarter)
  const [dashboardDateRange, setDashboardDateRange] = useState<{ startDate: string; endDate: string }>(() => {
    // Default to QTD
    const now = new Date();
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
    const quarterStart = new Date(now.getFullYear(), quarterMonth, 1);
    return {
      startDate: quarterStart.toISOString().split('T')[0],
      endDate: now.toISOString().split('T')[0],
    };
  });
  const [dashboardChannels, setDashboardChannels] = useState<string[]>([]);
  const [dashboardSources, setDashboardSources] = useState<string[]>([]);
  const [dashboardSGMs, setDashboardSGMs] = useState<string[]>([]);

  // Dashboard data
  const [dashboardMetrics, setDashboardMetrics] = useState<SGMDashboardMetrics | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Conversion trend
  const [conversionTrend, setConversionTrend] = useState<SGMConversionTrend[]>([]);
  const [conversionTrendLoading, setConversionTrendLoading] = useState(false);
  const [quarterCount, setQuarterCount] = useState(4);

  // Pipeline by stage
  const [pipelineByStage, setPipelineByStage] = useState<OpenPipelineByStage[]>([]);
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<string[]>([
    'Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'Signed', 'On Hold', 'Planned Nurture'
  ]);

  // SGM Conversion table
  const [conversionData, setConversionData] = useState<SgmConversionData[]>([]);
  const [conversionLoading, setConversionLoading] = useState(false);

  // Stale pipeline
  const [staleRecords, setStaleRecords] = useState<DetailRecord[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);

  // System 1 drilldown (Dashboard tab — DetailRecord[] + VolumeDrillDownModal)
  const [volumeDrillDownOpen, setVolumeDrillDownOpen] = useState(false);
  const [volumeDrillDownRecords, setVolumeDrillDownRecords] = useState<DetailRecord[]>([]);
  const [volumeDrillDownLoading, setVolumeDrillDownLoading] = useState(false);
  const [volumeDrillDownError, setVolumeDrillDownError] = useState<string | null>(null);
  const [volumeDrillDownTitle, setVolumeDrillDownTitle] = useState('');
  const [volumeDrillDownMetric, setVolumeDrillDownMetric] = useState<
    'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline' | null
  >(null);
```

## Step 9.3: Initialize dashboard filters from filterOptions
In the existing `useEffect` that fetches filter options (~line 62-80), after setting leaderboard defaults, also set dashboard defaults:

```typescript
        // Also initialize dashboard filters
        if (options && options.channels) {
          setDashboardChannels([...options.channels]);
        }
        if (options && options.sources) {
          setDashboardSources([...options.sources]);
        }
```

And after SGM options load (~line 82-100), set default dashboard SGMs:
```typescript
        // Dashboard SGM default: SGM user → own name, Admin → all active
        if (isSGM && currentUserSgmName) {
          setDashboardSGMs([currentUserSgmName]);
        } else {
          setDashboardSGMs(activeSGMs);
        }
```

## Step 9.4: Add Dashboard tab fetch functions
Add after `handleFilterApply` (~line 215):

```typescript
  // ============================================
  // Dashboard tab fetch functions
  // ============================================

  const fetchDashboardData = async () => {
    if (dashboardChannels.length === 0) return;
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const response = await dashboardApi.getSGMDashboardMetrics({
        startDate: dashboardDateRange.startDate,
        endDate: dashboardDateRange.endDate,
        channels: dashboardChannels,
        sources: dashboardSources.length > 0 ? dashboardSources : undefined,
        sgmNames: dashboardSGMs.length > 0 ? dashboardSGMs : undefined,
      });
      setDashboardMetrics(response.metrics);
    } catch (err) {
      setDashboardError(handleApiError(err));
    } finally {
      setDashboardLoading(false);
    }
  };

  const fetchConversionTrend = async () => {
    if (dashboardChannels.length === 0) return;
    setConversionTrendLoading(true);
    try {
      // Calculate start date for N quarters back
      const now = new Date();
      const currentQ = Math.floor(now.getMonth() / 3);
      const startQ = new Date(now.getFullYear(), currentQ * 3, 1);
      startQ.setMonth(startQ.getMonth() - (quarterCount - 1) * 3);

      const response = await dashboardApi.getSGMConversionTrend({
        startDate: startQ.toISOString().split('T')[0],
        endDate: dashboardDateRange.endDate,
        channels: dashboardChannels.length > 0 ? dashboardChannels : undefined,
        sources: dashboardSources.length > 0 ? dashboardSources : undefined,
        sgmNames: dashboardSGMs.length > 0 ? dashboardSGMs : undefined,
      });
      setConversionTrend(response.data);
    } catch (err) {
      console.error('Error fetching conversion trend:', err);
    } finally {
      setConversionTrendLoading(false);
    }
  };

  const fetchPipelineByStage = async () => {
    setPipelineLoading(true);
    try {
      const response = await dashboardApi.getPipelineSummary(
        pipelineStages,
        dashboardSGMs.length > 0 ? dashboardSGMs : undefined
      );
      setPipelineByStage(response.byStage || []);
    } catch (err) {
      console.error('Error fetching pipeline by stage:', err);
    } finally {
      setPipelineLoading(false);
    }
  };

  const fetchConversionTable = async () => {
    setConversionLoading(true);
    try {
      const response = await dashboardApi.getSGMConversions({
        sgmNames: dashboardSGMs.length > 0 ? dashboardSGMs : undefined,
        dateRange: dashboardDateRange,
      });
      setConversionData(response.data);
    } catch (err) {
      console.error('Error fetching conversion data:', err);
    } finally {
      setConversionLoading(false);
    }
  };

  const fetchStaleRecords = async () => {
    setStaleLoading(true);
    try {
      const sgmFilter = dashboardSGMs.length === 1 ? dashboardSGMs[0] : undefined;
      const response = await dashboardApi.getOpenPipeline({ sgm: sgmFilter });
      setStaleRecords(response.records || []);
    } catch (err) {
      console.error('Error fetching stale pipeline:', err);
    } finally {
      setStaleLoading(false);
    }
  };
```

## Step 9.5: Add Dashboard tab useEffect
```typescript
  // Fetch dashboard data when tab or filters change
  useEffect(() => {
    if (activeTab !== 'dashboard' || dashboardChannels.length === 0) return;
    fetchDashboardData();
    fetchConversionTrend();
    fetchPipelineByStage();
    fetchConversionTable();
    fetchStaleRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, dashboardDateRange, dashboardChannels, dashboardSources, dashboardSGMs]);

  // Refetch conversion trend when quarter count changes
  useEffect(() => {
    if (activeTab !== 'dashboard' || dashboardChannels.length === 0) return;
    fetchConversionTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quarterCount]);

  // Refetch pipeline when stages change
  useEffect(() => {
    if (activeTab !== 'dashboard') return;
    fetchPipelineByStage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineStages]);
```

## Step 9.6: Add Dashboard tab drilldown handlers
```typescript
  // Dashboard tab scorecard click → System 1 drilldown
  const handleDashboardMetricClick = async (metric: string) => {
    const metricMap: Record<string, typeof volumeDrillDownMetric> = {
      sql: 'sql', sqo: 'sqo', signed: 'signed', joined: 'joined', openPipeline: 'openPipeline',
    };
    const drillDownMetric = metricMap[metric];
    if (!drillDownMetric) return;

    setVolumeDrillDownMetric(drillDownMetric);
    setVolumeDrillDownOpen(true);
    setVolumeDrillDownLoading(true);
    setVolumeDrillDownTitle(`${metric.toUpperCase()} Records`);
    try {
      const response = await dashboardApi.getDetailRecords({
        metricFilter: drillDownMetric,
        dateRange: dashboardDateRange,
        channels: dashboardChannels,
        sources: dashboardSources,
        sgms: dashboardSGMs.length > 0 ? dashboardSGMs : undefined,
      }, 50000);
      setVolumeDrillDownRecords(response.records || []);
    } catch (err) {
      setVolumeDrillDownError(handleApiError(err));
    } finally {
      setVolumeDrillDownLoading(false);
    }
  };

  // Pipeline bar click → System 1 drilldown
  const handlePipelineBarClick = async (stage: string) => {
    setVolumeDrillDownMetric('openPipeline');
    setVolumeDrillDownOpen(true);
    setVolumeDrillDownLoading(true);
    setVolumeDrillDownTitle(`Pipeline — ${stage}`);
    try {
      const response = await dashboardApi.getPipelineDrilldown(
        stage,
        {},
        dashboardSGMs.length > 0 ? dashboardSGMs : undefined,
      );
      setVolumeDrillDownRecords(response.records || []);
    } catch (err) {
      setVolumeDrillDownError(handleApiError(err));
    } finally {
      setVolumeDrillDownLoading(false);
    }
  };

  // Conversion table metric click → System 1 drilldown
  const handleConversionMetricClick = async (sgm: string, metric: SgmConversionMetricType) => {
    setVolumeDrillDownMetric(metric === 'sql' ? 'sql' : metric === 'sqo' ? 'sqo' : 'joined');
    setVolumeDrillDownOpen(true);
    setVolumeDrillDownLoading(true);
    setVolumeDrillDownTitle(`${sgm} — ${metric.toUpperCase()} Records`);
    try {
      const response = await dashboardApi.getSgmConversionDrilldown(sgm, metric, {
        sgms: dashboardSGMs.length > 0 ? dashboardSGMs : undefined,
        dateRange: dashboardDateRange,
      });
      setVolumeDrillDownRecords(response.records || []);
    } catch (err) {
      setVolumeDrillDownError(handleApiError(err));
    } finally {
      setVolumeDrillDownLoading(false);
    }
  };

  // Volume drilldown record click → RecordDetailModal (reuse existing handler pattern)
  const handleVolumeDrillDownRecordClick = (recordId: string) => {
    setVolumeDrillDownOpen(false);
    setRecordDetailId(recordId);
    setRecordDetailOpen(true);
  };

  const handleCloseVolumeDrillDown = () => {
    setVolumeDrillDownOpen(false);
    setVolumeDrillDownRecords([]);
    setVolumeDrillDownMetric(null);
    setVolumeDrillDownError(null);
  };

  // Dashboard filter apply handler
  const handleDashboardFilterApply = (filters: {
    dateRange: { startDate: string; endDate: string };
    channels: string[];
    sources: string[];
    sgms: string[];
  }) => {
    setDashboardDateRange(filters.dateRange);
    setDashboardChannels(filters.channels);
    setDashboardSources(filters.sources);
    setDashboardSGMs(filters.sgms);
  };

  // Stale pipeline handlers
  const handleStaleStageClick = (stage: string, records: DetailRecord[]) => {
    setVolumeDrillDownMetric('openPipeline');
    setVolumeDrillDownRecords(records);
    setVolumeDrillDownTitle(`Stale Pipeline — ${stage}`);
    setVolumeDrillDownOpen(true);
  };
```

## Step 9.7: Replace Dashboard tab placeholder
Replace lines 257-262:

```tsx
      {activeTab === 'dashboard' && (
        <div>
          {/* Dashboard Filters */}
          <SGMDashboardFiltersComponent
            selectedDateRange={dashboardDateRange}
            selectedChannels={dashboardChannels}
            selectedSources={dashboardSources}
            selectedSGMs={dashboardSGMs}
            channelOptions={filterOptions?.channels || []}
            sourceOptions={filterOptions?.sources || []}
            sgmOptions={sgmOptions}
            sgmOptionsLoading={sgmOptionsLoading}
            onApply={handleDashboardFilterApply}
            disabled={dashboardLoading}
          />

          {dashboardError && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              {dashboardError}
            </div>
          )}

          {/* Scorecards */}
          <SGMDashboardScorecards
            metrics={dashboardMetrics}
            loading={dashboardLoading}
            onMetricClick={handleDashboardMetricClick}
          />

          {/* Conversion Charts */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Conversion Trends
              </h2>
            </div>
            <SGMConversionCharts
              data={conversionTrend}
              loading={conversionTrendLoading}
              quarterCount={quarterCount}
              onQuarterCountChange={setQuarterCount}
              onVolumeBarClick={(quarter, metric) => {
                // TODO: drill-down for volume bar clicks by quarter
                console.log('Volume bar click:', quarter, metric);
              }}
            />
          </div>

          {/* Pipeline by Stage */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Pipeline by Stage
              </h2>
            </div>
            <PipelineFilters
              selectedStages={pipelineStages}
              onApply={(stages, sgms) => setPipelineStages(stages)}
              selectedSgms={dashboardSGMs}
              sgmOptions={sgmOptions.map(s => ({ value: s.value, label: s.label }))}
              sgmOptionsLoading={sgmOptionsLoading}
              hideSgmFilter={true}
            />
            <PipelineByStageChart
              data={pipelineByStage}
              onBarClick={(stage) => handlePipelineBarClick(stage)}
              loading={pipelineLoading}
            />
          </div>

          {/* SGM Conversion & Velocity Table */}
          <div className="mb-6">
            <SgmConversionTable
              data={conversionData}
              loading={conversionLoading}
              onMetricClick={handleConversionMetricClick}
              hideTeamAverage={dashboardSGMs.length === 1}
            />
          </div>

          {/* Stale Pipeline Alerts */}
          <StalePipelineAlerts
            records={staleRecords}
            loading={staleLoading}
            onStageClick={handleStaleStageClick}
            onRecordClick={handleVolumeDrillDownRecordClick}
          />
        </div>
      )}
```

## Step 9.8: Add VolumeDrillDownModal to JSX
Add after the existing `MetricDrillDownModal` component (~line 282):

```tsx
      {/* Volume Drill-Down Modal (Dashboard tab — System 1) */}
      {volumeDrillDownMetric && (
        <VolumeDrillDownModal
          isOpen={volumeDrillDownOpen}
          onClose={handleCloseVolumeDrillDown}
          records={volumeDrillDownRecords}
          title={volumeDrillDownTitle}
          loading={volumeDrillDownLoading}
          error={volumeDrillDownError}
          onRecordClick={handleVolumeDrillDownRecordClick}
          metricFilter={volumeDrillDownMetric}
          canExport={true}
        />
      )}
```

## PHASE 9 — VALIDATION GATE
```bash
npm run build 2>&1 | tail -20
```
**Expected**: Zero errors. Full Dashboard tab wired and compiling.

**STOP AND REPORT**: Tell the user:
- "Dashboard tab fully wired in SGMHubContent.tsx"
- "Sections: Filters → Scorecards → Conversion Charts → Pipeline by Stage → Conversion Table → Stale Pipeline"
- "System 1 drilldown (VolumeDrillDownModal) coexists with System 2 (MetricDrillDownModal)"
- "Build status: [pass/fail]"
- "Ready to proceed to Phase 10 (Documentation Sync)?"

---

# PHASE 10: Documentation Sync

## Step 10.1: Run agent-guard sync
```bash
npx agent-guard sync
```

## Step 10.2: Regenerate API route inventory
```bash
npm run gen:api-routes
```

## Step 10.3: Review generated docs
Read `docs/ARCHITECTURE.md` and `docs/_generated/api-routes.md` to confirm SGM Hub Phase 2 is documented.

## PHASE 10 — VALIDATION GATE
```bash
npm run build 2>&1 | tail -5
```
**Expected**: Build passes. Docs updated.

**STOP AND REPORT**: Tell the user:
- "Documentation synced. `npm run build` passes."
- "Ready for Phase 11 (UI Validation)?"

---

# PHASE 11: UI Validation (Requires User)

## Context
The user needs to verify the Dashboard tab works correctly in the browser. Present test groups for manual verification.

## Test Group 1: SGM User View
1. Log in as an SGM user (or impersonate SGM role)
2. Navigate to SGM Hub → Dashboard tab
3. **Verify**: Filters default to QTD date range, all channels, all sources, own SGM name
4. **Verify**: 9 scorecards display with data — ARR scorecards show n= counts
5. **Verify**: Click a scorecard → VolumeDrillDownModal opens with records

## Test Group 2: Admin/RevOps View
1. Log in as admin or revops_admin
2. Navigate to SGM Hub → Dashboard tab
3. **Verify**: No default SGM filter — sees all SGMs
4. **Verify**: Scorecards show aggregate data across all SGMs

## Test Group 3: Conversion Charts
1. On Dashboard tab, scroll to Conversion Trends
2. **Verify**: Rate trend chart shows SQL→SQO% and SQO→Joined% lines for 4 quarters
3. **Verify**: Volume chart shows SQL/SQO/Joined bars for 4 quarters
4. **Verify**: Click quarter count selector (5, 6, 7, 8) — charts update
5. **Verify**: Click a volume bar — drilldown opens

## Test Group 4: Pipeline & Conversion Table
1. **Verify**: Pipeline by Stage chart renders with default stages, NO SGM filter visible
2. **Verify**: Click a pipeline bar — drilldown opens
3. **Verify**: SGM Conversion table shows velocity column "SQO→Joined (days)"
4. **Verify**: Click SQLs/SQOs/Joined in table → drilldown opens
5. **Verify**: If single SGM selected, Team Average row is hidden

## Test Group 5: Stale Pipeline
1. **Verify**: Stale Pipeline alerts section renders
2. **Verify**: Click stage → drilldown shows records
3. **Verify**: Click individual record → RecordDetailModal opens

## Test Group 6: Data Accuracy
1. Pick one SGM (e.g., Bre McDaniel)
2. Filter to that SGM on Dashboard tab
3. **Verify**: Joined ARR (Actual) scorecard shows dollar amount with n= count
4. **Verify**: Pipeline Est. ARR shows pipeline-stage ARR (not joined)
5. Cross-reference SQLs/SQOs/Joined counts against direct BQ query for that SGM

**STOP AND REPORT**: Present test groups to user and await results.

---

## Troubleshooting Appendix

### Common Issues

| Issue | Cause | Fix |
|---|---|---|
| `TypeError: Cannot read properties of null` in scorecard | `dashboardMetrics` is null during loading | Check `loading` prop is passed and component handles `metrics=null` |
| Recharts D3 crash | Missing `isAnimationActive={false}` | Add to ALL Bar, Line, Area components |
| Empty conversion data | `dashboardChannels.length === 0` guard blocks fetch | Ensure channels are initialized from filterOptions before dashboard tab loads |
| Pipeline chart empty | `sgmOptions` not yet loaded | Guard with `sgmOptionsLoading` check |
| Velocity column shows "—" everywhere | Field not in SQL query or type transform missing | Verify `avg_days_sqo_to_joined` in `getSgmConversionData` SQL and `runQuery` type param |
| ARR values are $0 | `Actual_ARR__c` is NULL for that SGM's joined records | Expected — 38% of joined records lack ARR data. Show n= count. |
| Pipeline Est. ARR is $0 | SGM has no active pipeline with `SGM_Estimated_ARR__c` populated | Expected for some SGMs. |
| Duplicate records in pipeline drilldown | Not deduplicating by primary_key | Ensure API uses `is_primary_opp_record = 1` in pipeline queries |

### Known Limitations

1. **Actual_ARR__c coverage**: Only 62.1% of joined records have this field. The "Joined ARR" scorecard will undercount. Show n= alongside.
2. **SGM_Estimated_ARR__c lifecycle**: Salesforce clears this field when a deal joins. It's ONLY available on active pipeline stages. Never query it for joined records.
3. **Account_Total_ARR__c duplication**: Multiple advisors on the same Account share this value. Do NOT SUM for portfolio totals. Phase 3 view enhancement could add a deduplicated column.
4. **Velocity coverage**: 87.1% of joined records have both SQO date and Joined date. 13% excluded from velocity calculations.
5. **Quarterly data density**: Per-SGM-per-quarter joined counts are small (1-5 per quarter for most SGMs). Display n= counts alongside percentages.
6. **Date anchor inconsistency**: `getSgmConversionData` anchors on `converted_date_raw` (SQL creation date), while the conversion trend uses cohort mode (each stage → own date). These will show different numbers for the same quarter — this is by design.
