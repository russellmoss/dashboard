# Open Funnel: Agentic Implementation Plan

## Agent Execution Guide

- **Read first:** `open_funnel.md` in this repo for data logic, field names, and component structures. Do NOT deviate from it.
- **Execute in order:** Complete one phase (or sub-step) at a time. Run the verification for that step before starting the next.
- **One change per step:** Each numbered step is a single, atomic edit. Do not combine steps.
- **No codebase changes beyond this plan:** Only edit files and add content as specified below. Do not refactor or change unrelated code.
- **Locating code:** Use search (Grep) for the exact strings or patterns given. Line numbers are approximate; always confirm by matching the surrounding snippet.
- **Verification:** Where "Use the Grep tool" or "Search for" is specified, run that search to confirm the edit; do not skip verification.

## Reference Document
All findings referenced below come from `open_funnel.md` (the completed exploration document). Do NOT deviate from the data logic, field names, or component structures documented there.

## Business Decision Log
- **Signed SQOs = Converted.** A Signed SQO is treated as "Converted" in the SQO disposition toggle (sales process complete, awaiting onboarding). This means SQO "Converted" = `advisor_join_date__c IS NOT NULL OR StageName IN ('Joined', 'Signed')`.

## Feature Summary
Add a four-position segmented button group (`All | Open | Lost | Converted`) to the MQL, SQL, and SQO scorecards on the Funnel Performance & Efficiency dashboard. The toggle:
- Updates the scorecard number to show only records matching the selected disposition
- Carries the disposition filter into the drill-down modal when the card is clicked
- Hides the GoalDisplay bar for any position other than "All"
- Defaults to "All" on page load

---

## Architecture Overview

### Data Flow
```
BigQuery (vw_funnel_master) 
  → funnel-metrics.ts (adds 9 new SUM(CASE WHEN) blocks for disposition counts)
  → API route /api/dashboard/funnel-metrics (returns expanded FunnelMetrics)
  → Dashboard page.tsx (stores disposition state per card, passes to scorecards)
  → Scorecard components (render segmented control, display correct count)
  → handleMetricClick (passes disposition to drill-down filters)
  → detail-records.ts (adds disposition WHERE clauses)
  → VolumeDrillDownModal (shows filtered records)
```

### Files Modified (in execution order)
1. `src/types/dashboard.ts` — Expand `FunnelMetrics` interface
2. `src/types/filters.ts` — Add `metricDisposition` to `DashboardFilters`
3. `src/lib/queries/funnel-metrics.ts` — Add 9 disposition count columns
4. `src/lib/queries/detail-records.ts` — Add disposition filtering to drill-down query
5. `src/app/api/dashboard/funnel-metrics/route.ts` — Pass through new fields (likely no changes needed)
6. `src/app/api/dashboard/detail-records/route.ts` — Pass through disposition filter (likely no changes needed if filter flows through DashboardFilters)
7. `src/lib/api-client.ts` — Ensure `cleanFilters` passes `metricDisposition`
8. `src/components/dashboard/DispositionToggle.tsx` — **NEW FILE** — Reusable segmented control
9. `src/components/dashboard/FullFunnelScorecards.tsx` — Add toggle to MQL card
10. `src/components/dashboard/Scorecards.tsx` — Add toggle to SQL and SQO cards
11. `src/app/dashboard/page.tsx` — Add disposition state, wire into handleMetricClick

---

## PHASE 1: Types and Interfaces

### Step 1.1 — Expand `FunnelMetrics` interface

**File:** `src/types/dashboard.ts`

**Task:** Add disposition count fields to the `FunnelMetrics` interface. These will be populated by the expanded BigQuery query.

**Locate:** Search for `export interface FunnelMetrics` in `src/types/dashboard.ts`. Identify the line that ends with `openPipelineAum: number;` (with or without a trailing comma). Insert the new fields **after** that line, **before** the closing `}`.
```typescript
export interface FunnelMetrics {
  prospects: number;
  contacted: number;
  mqls: number;
  sqls: number;
  sqos: number;
  signed: number;
  signedAum: number;
  joined: number;
  joinedAum: number;
  pipelineAum: number;
  openPipelineAum: number;
}
```

**Add these fields after `openPipelineAum`:**
```typescript
  // MQL disposition counts
  mqls_open: number;
  mqls_lost: number;
  mqls_converted: number;
  // SQL disposition counts
  sqls_open: number;
  sqls_lost: number;
  sqls_converted: number;
  // SQO disposition counts
  sqos_open: number;
  sqos_lost: number;
  sqos_converted: number;
```

**Verification:** Use the Grep tool: pattern `openPipelineAum|mqls_open|mqls_converted` in `src/types/dashboard.ts`. Confirm the interface contains all of these; count total fields = 20 (11 existing + 9 new).

---

### Step 1.2 — Add `metricDisposition` to `DashboardFilters`

**File:** `src/types/filters.ts`

**Task:** Add an optional `metricDisposition` field to `DashboardFilters`. This will be used by the detail-records query to filter drill-down results.

**Locate:** Search for `export interface DashboardFilters` in `src/types/filters.ts`. Find the line containing `advancedFilters?: AdvancedFilters;`. Add the new field and type export as specified **after** that line (and before the closing `}` of the interface).
```typescript
export interface DashboardFilters {
  startDate: string;
  endDate: string;
  datePreset: 'ytd' | 'qtd' | 'q1' | 'q2' | 'q3' | 'q4' | 'custom' | 'last30' | 'last90' | 'alltime';
  year: number;
  channel: string | null;
  source: string | null;
  sga: string | null;
  sgm: string | null;
  stage: string | null;
  experimentationTag: string | null;
  campaignId: string | null;
  metricFilter: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'signed' | 'joined' | 'openPipeline';
  advancedFilters?: AdvancedFilters;
}
```

**Add after the `advancedFilters` line:**
```typescript
  metricDisposition?: 'all' | 'open' | 'lost' | 'converted';
```

**Also add a type export:** In the same file, search for an existing `export type` declaration (e.g. `export type SomeFilter = ...`). Add this new type in the same area (top of file or near other type exports):
```typescript
export type MetricDisposition = 'all' | 'open' | 'lost' | 'converted';
```

**Verification:** Use the Grep tool: pattern `metricDisposition|MetricDisposition` in `src/types/filters.ts`. Both the interface property and the type export should appear. Run `npm run build` (or tsc) to confirm TypeScript compiles; the `?` makes the property optional so existing code should not break.

---

## PHASE 2: Query Layer — Backend

### Step 2.1 — Add Disposition Counts to Funnel Metrics Query

**File:** `src/lib/queries/funnel-metrics.ts`

**Task:** Add 9 new `SUM(CASE WHEN ...)` blocks to the existing metrics query. These count MQL/SQL/SQO records by disposition (Open, Lost, Converted).

**CRITICAL — Disposition Logic (from open_funnel.md findings, with Signed = Converted):**

```sql
-- MQL OPEN: MQL'd but hasn't converted to SQL and hasn't closed
-- is_mql = 1 AND is_sql = 0 AND lead_closed_date IS NULL

-- MQL LOST: MQL'd, didn't convert to SQL, and lead was closed
-- is_mql = 1 AND is_sql = 0 AND lead_closed_date IS NOT NULL

-- MQL CONVERTED: MQL'd and converted to SQL
-- is_mql = 1 AND is_sql = 1

-- SQL OPEN: Converted to SQL/Opp but opp isn't SQO and isn't Closed Lost
-- is_sql = 1 AND LOWER(SQO_raw) != 'yes' AND StageName != 'Closed Lost'

-- SQL LOST: Converted to SQL/Opp, opp closed lost without becoming SQO
-- is_sql = 1 AND StageName = 'Closed Lost' AND LOWER(SQO_raw) != 'yes'

-- SQL CONVERTED: Converted to SQL/Opp and opp became SQO
-- is_sql = 1 AND LOWER(SQO_raw) = 'yes'

-- SQO OPEN: Became SQO but hasn't Joined/Signed and isn't Closed Lost
-- is_sqo_unique = 1 AND recordtypeid = RECRUITING AND StageName NOT IN ('Closed Lost', 'Joined', 'Signed') AND advisor_join_date__c IS NULL

-- SQO LOST: Became SQO and closed lost
-- is_sqo_unique = 1 AND recordtypeid = RECRUITING AND StageName = 'Closed Lost' AND advisor_join_date__c IS NULL
-- (StageName != 'Signed' is redundant: StageName cannot be both 'Closed Lost' and 'Signed')

-- SQO CONVERTED: Became SQO and Joined or Signed
-- is_sqo_unique = 1 AND recordtypeid = RECRUITING AND (advisor_join_date__c IS NOT NULL OR StageName IN ('Joined', 'Signed'))
```

**PRECEDENCE ORDER: Converted > Lost > Open** (handles edge cases where buckets could overlap, e.g., an SQL that became SQO then closed lost counts as Converted SQL).

**Locate the insertion point.** In `src/lib/queries/funnel-metrics.ts`, search for the SELECT list that includes a SUM(...) block whose alias is `sqos` (the total SQO count). The new blocks go **after** the last existing SUM(...) block in that SELECT list and **before** the `FROM` clause. Use the same template variables for SGA filtering as the rest of the file (e.g. `${sgaFilterForLead}` and `${sgaFilterForOpp}` or the exact names used in the file—do not invent new variable names). 

**Add these 9 blocks, using the same date field and SGA filter pattern as the parent metric:**

```sql
      -- ═══════════════════════════════════════
      -- MQL DISPOSITION COUNTS
      -- ═══════════════════════════════════════
      SUM(
        CASE
          WHEN mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
            AND is_mql = 1
            AND is_sql = 1
            ${sgaFilterForLead}
          THEN 1 ELSE 0
        END
      ) as mqls_converted,
      SUM(
        CASE
          WHEN mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
            AND is_mql = 1
            AND is_sql = 0
            AND lead_closed_date IS NOT NULL
            ${sgaFilterForLead}
          THEN 1 ELSE 0
        END
      ) as mqls_lost,
      SUM(
        CASE
          WHEN mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
            AND is_mql = 1
            AND is_sql = 0
            AND lead_closed_date IS NULL
            ${sgaFilterForLead}
          THEN 1 ELSE 0
        END
      ) as mqls_open,

      -- ═══════════════════════════════════════
      -- SQL DISPOSITION COUNTS
      -- ═══════════════════════════════════════
      SUM(
        CASE
          WHEN converted_date_raw IS NOT NULL
            AND DATE(converted_date_raw) >= DATE(@startDate)
            AND DATE(converted_date_raw) <= DATE(@endDate)
            AND is_sql = 1
            AND LOWER(SQO_raw) = 'yes'
            ${sgaFilterForLead}
          THEN 1 ELSE 0
        END
      ) as sqls_converted,
      SUM(
        CASE
          WHEN converted_date_raw IS NOT NULL
            AND DATE(converted_date_raw) >= DATE(@startDate)
            AND DATE(converted_date_raw) <= DATE(@endDate)
            AND is_sql = 1
            AND LOWER(COALESCE(SQO_raw, '')) != 'yes'
            AND StageName = 'Closed Lost'
            ${sgaFilterForLead}
          THEN 1 ELSE 0
        END
      ) as sqls_lost,
      SUM(
        CASE
          WHEN converted_date_raw IS NOT NULL
            AND DATE(converted_date_raw) >= DATE(@startDate)
            AND DATE(converted_date_raw) <= DATE(@endDate)
            AND is_sql = 1
            AND LOWER(COALESCE(SQO_raw, '')) != 'yes'
            AND (StageName IS NULL OR StageName != 'Closed Lost')
            ${sgaFilterForLead}
          THEN 1 ELSE 0
        END
      ) as sqls_open,

      -- ═══════════════════════════════════════
      -- SQO DISPOSITION COUNTS
      -- ═══════════════════════════════════════
      SUM(
        CASE
          WHEN Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND recordtypeid = @recruitingRecordType
            AND is_sqo_unique = 1
            AND (advisor_join_date__c IS NOT NULL OR StageName IN ('Joined', 'Signed'))
            ${sgaFilterForOpp}
          THEN 1 ELSE 0
        END
      ) as sqos_converted,
      SUM(
        CASE
          WHEN Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND recordtypeid = @recruitingRecordType
            AND is_sqo_unique = 1
            AND StageName = 'Closed Lost'
            AND advisor_join_date__c IS NULL
            ${sgaFilterForOpp}
          THEN 1 ELSE 0
        END
      ) as sqos_lost,
      SUM(
        CASE
          WHEN Date_Became_SQO__c IS NOT NULL
            AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
            AND recordtypeid = @recruitingRecordType
            AND is_sqo_unique = 1
            AND StageName NOT IN ('Closed Lost', 'Joined', 'Signed')
            AND advisor_join_date__c IS NULL
            ${sgaFilterForOpp}
          THEN 1 ELSE 0
        END
      ) as sqos_open,
```

**Then update the result mapping.** In the same file, search for the return statement that maps the query result to a `FunnelMetrics`-shaped object (e.g. `return { prospects:`, `contacted:`, `mqls:`, or `toNumber(row.`). Add the 9 new fields to that return object, using the same `toNumber(row.*)` pattern:

```typescript
  mqls_open: toNumber(row.mqls_open),
  mqls_lost: toNumber(row.mqls_lost),
  mqls_converted: toNumber(row.mqls_converted),
  sqls_open: toNumber(row.sqls_open),
  sqls_lost: toNumber(row.sqls_lost),
  sqls_converted: toNumber(row.sqls_converted),
  sqos_open: toNumber(row.sqos_open),
  sqos_lost: toNumber(row.sqos_lost),
  sqos_converted: toNumber(row.sqos_converted),
```

**Also update the `RawFunnelMetricsResult` type:** In `src/types/bigquery-raw.ts`, search for `RawFunnelMetricsResult` or an interface that types the funnel metrics query result. If you find a typed interface (with named properties like `mqls`, `sqls`, `sqos`), add the 9 new property names with type `number` (or the same type as other numeric fields). If the result is typed as `any` or there is no such interface, skip this sub-step.

**Verification:**
- Use the Grep tool: pattern `as mqls_converted|as sqos_open` in `src/lib/queries/funnel-metrics.ts`. All 9 new aliases should appear in the query.
- Count SUM blocks in the SELECT: total should be 19 (10 existing + 9 new).
- Sanity check: `mqls` should equal `mqls_open + mqls_lost + mqls_converted` for the same date/SGA scope; similarly for sqls and sqos.

---

### Step 2.2 — Add Disposition Filtering to Detail Records Query

**File:** `src/lib/queries/detail-records.ts`

**Task:** When `metricDisposition` is present on the filters object and is not `'all'`, add WHERE clauses to filter the drill-down records by disposition.

**Locate:** Search for `metricFilter` or `filters.metricFilter` or a switch on metric type in `src/lib/queries/detail-records.ts`. Find where the main metric switch ends and where the query (e.g. conditions array or SQL string) is built. Insert the new disposition block **after** the main switch that sets conditions per metric and **before** the final query construction (e.g. before `conditions.join` or equivalent).

**Add this block AFTER the main switch statement but BEFORE the query is built:**

```typescript
// Disposition filtering (Open/Lost/Converted sub-filter for MQL/SQL/SQO)
if (filters.metricDisposition && filters.metricDisposition !== 'all') {
  switch (filters.metricFilter) {
    case 'mql':
      switch (filters.metricDisposition) {
        case 'open':
          conditions.push('is_sql = 0');
          conditions.push('lead_closed_date IS NULL');
          break;
        case 'lost':
          conditions.push('is_sql = 0');
          conditions.push('lead_closed_date IS NOT NULL');
          break;
        case 'converted':
          conditions.push('is_sql = 1');
          break;
      }
      break;
    case 'sql':
      switch (filters.metricDisposition) {
        case 'open':
          conditions.push("(LOWER(COALESCE(SQO_raw, '')) != 'yes')");
          conditions.push("(StageName IS NULL OR StageName != 'Closed Lost')");
          break;
        case 'lost':
          conditions.push("(LOWER(COALESCE(SQO_raw, '')) != 'yes')");
          conditions.push("StageName = 'Closed Lost'");
          break;
        case 'converted':
          conditions.push("LOWER(SQO_raw) = 'yes'");
          break;
      }
      break;
    case 'sqo':
      switch (filters.metricDisposition) {
        case 'open':
          conditions.push("StageName NOT IN ('Closed Lost', 'Joined', 'Signed')");
          conditions.push('advisor_join_date__c IS NULL');
          break;
        case 'lost':
          conditions.push("StageName = 'Closed Lost'");
          conditions.push('advisor_join_date__c IS NULL');
          break;
        case 'converted':
          conditions.push("(advisor_join_date__c IS NOT NULL OR StageName IN ('Joined', 'Signed'))");
          break;
      }
      break;
    // No disposition filtering for other metrics (prospect, contacted, joined, etc.)
  }
}
```

**IMPORTANT — Column references in WHERE:** The exploration doc (Phase 3.5) confirms that `lead_closed_date` and `SQO_raw` are **not** currently in the SELECT list of `detail-records.ts`. They are available on `vw_funnel_master`, so they work in WHERE clauses. After implementing Step 2.2, do a quick eye-check: ensure the new conditions use the **same reference style** as the existing conditions in that file. If the query uses a table alias (e.g. `v` from `vw_funnel_master v`), use qualified names in the pushed strings (e.g. `v.lead_closed_date`, `v.SQO_raw`). If the existing conditions in the file use bare column names (e.g. `is_sql = 0`, `StageName = 'Closed Lost'`), bare names in the new conditions are fine. Matching the file’s existing style avoids runtime errors.

**Verification:** 
- Test each disposition + metric combination mentally:
  - MQL + Open: `is_mql = 1 AND is_sql = 0 AND lead_closed_date IS NULL`
  - MQL + Converted: `is_mql = 1 AND is_sql = 1`
  - SQL + Lost: `is_sql = 1 AND SQO_raw != 'yes' AND StageName = 'Closed Lost'`
  - SQO + Converted: `is_sqo_unique = 1 AND (advisor_join_date__c IS NOT NULL OR StageName IN ('Joined', 'Signed'))`
- Confirm precedence: Converted conditions are exclusive (they don't need to exclude Lost conditions because the precedence is handled by the CASE order in the aggregate query, and here we use explicit WHERE clauses).

---

### Step 2.3 — Verify API Routes Pass Through New Fields

**Files:** `src/app/api/dashboard/funnel-metrics/route.ts`, `src/app/api/dashboard/detail-records/route.ts`

**Task:** Verify that the API routes don't strip out the new fields. They may pass the full `DashboardFilters` object and query result; if so, no edit is needed. If they construct objects field-by-field, add the new fields.

1. **funnel-metrics route:** Use the Grep tool: pattern `metricFilter|prospects|mqls` in `src/app/api/dashboard/funnel-metrics/route.ts`. If the handler destructures the query result into specific fields (e.g. `const { prospects, mqls, ... } = result`), add the 9 new field names to that destructuring and to the returned object. If it returns the full result (e.g. `return NextResponse.json(result)`), no change.
2. **detail-records route:** Use the Grep tool: pattern `metricFilter|filters\.|body\.filters` in `src/app/api/dashboard/detail-records/route.ts`. If filters are built from the request as a whole (e.g. `const filters = body.filters as DashboardFilters` or spread from body), no change. If filters are built field-by-field, add `metricDisposition` from the request body into the filters object.

**Verification:** Use the Grep tool: pattern `metricFilter` in `src/app/api/dashboard/detail-records/route.ts` and in `src/app/api/dashboard/funnel-metrics/route.ts`. Confirm either full-object pass-through or that new fields are explicitly included.

---

### Step 2.4 — Verify API Client Passes Disposition

**File:** `src/lib/api-client.ts`

**Task:** Check the `cleanFilters()` function. It creates a clean copy of the filters object. Ensure it doesn't strip out `metricDisposition`.

**Locate:** Search for `cleanFilters` in `src/lib/api-client.ts`. If the function builds a new object by listing fields (e.g. `startDate: filters.startDate, endDate: filters.endDate, ...`), add:
```typescript
metricDisposition: filters.metricDisposition,
```
in the same list. If it returns a spread (e.g. `return { ...filters }` or similar), no change is needed.

**Verification:** Use the Grep tool: pattern `cleanFilters|metricDisposition` in `src/lib/api-client.ts`. Either `metricDisposition` appears in the cleaned object or the function uses a spread that preserves all keys.

---

## PHASE 3: Frontend Components

### Step 3.1 — Create `DispositionToggle` Component

**File:** `src/components/dashboard/DispositionToggle.tsx` — **NEW FILE**

**Task:** Create a compact, reusable segmented button group that follows the existing `ViewModeToggle` pattern but sized smaller for use inside scorecard cards.

```typescript
'use client';

import { MetricDisposition } from '@/types/filters';

interface DispositionToggleProps {
  value: MetricDisposition;
  onChange: (value: MetricDisposition) => void;
}

const OPTIONS: { value: MetricDisposition; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'lost', label: 'Lost' },
  { value: 'converted', label: 'Converted' },
];

export function DispositionToggle({ value, onChange }: DispositionToggleProps) {
  return (
    <div
      className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-md p-0.5 mt-2"
      onClick={(e) => e.stopPropagation()}
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={(e) => {
            e.stopPropagation();
            onChange(option.value);
          }}
          className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
            value === option.value
              ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
```

**CRITICAL DETAIL:** The `onClick={(e) => e.stopPropagation()}` on both the container and buttons is essential. Without it, clicking the toggle would also trigger the card's `onClick` (which opens the drill-down modal). The `stopPropagation` ensures toggle clicks only change the disposition, not open the modal.

**Styling notes:**
- `p-0.5` and `px-2 py-0.5` — smaller than `ViewModeToggle` which uses `p-1` and `px-4 py-2`
- `text-xs` — smaller than `ViewModeToggle` which uses `text-sm`
- `mt-2` — adds spacing between the metric number and the toggle
- `rounded-md` container, `rounded` buttons — slightly softer than page-level toggles
- Dark mode support via `dark:` variants

---

### Step 3.2 — Update `FullFunnelScorecards.tsx` (MQL Card)

**File:** `src/components/dashboard/FullFunnelScorecards.tsx`

**Task:** Add the `DispositionToggle` to the MQL card. The toggle state is controlled by the parent (dashboard page), passed in via new props.

**Step 3.2a — Update the props interface:**

Search for `FullFunnelScorecardsProps` or the props type of the component (e.g. `interface ... { metrics: ... }`) in `src/components/dashboard/FullFunnelScorecards.tsx`. Add these props to that interface:
```typescript
interface FullFunnelScorecardsProps {
  metrics: FunnelMetricsWithGoals | null;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
  loading?: boolean;
  visibleMetrics?: {
    prospects: boolean;
    contacted: boolean;
    mqls: boolean;
  };
  // NEW: Disposition toggle state
  mqlDisposition?: MetricDisposition;
  onMqlDispositionChange?: (value: MetricDisposition) => void;
}
```

Add the import at the top:
```typescript
import { MetricDisposition } from '@/types/filters';
import { DispositionToggle } from './DispositionToggle';
```

**Step 3.2b — Add helper to resolve the displayed count:**

Inside the component function, before the return:
```typescript
// Resolve MQL count based on disposition toggle
const getMqlCount = (): number => {
  if (!metrics) return 0;
  switch (mqlDisposition || 'all') {
    case 'open': return metrics.mqls_open ?? 0;
    case 'lost': return metrics.mqls_lost ?? 0;
    case 'converted': return metrics.mqls_converted ?? 0;
    default: return metrics.mqls;
  }
};
```

**Step 3.2c — Update the MQL card JSX:**

Search for `onMetricClick?.('mql')` or `onMetricClick('mql')` in `src/components/dashboard/FullFunnelScorecards.tsx` to locate the MQL card. Make these changes in that card only:

1. **Replace the metric number** — change `formatNumber(metrics.mqls)` to `formatNumber(getMqlCount())`

2. **Add the disposition toggle** — insert after the `<Text>Marketing Qualified Leads</Text>` line and BEFORE the GoalDisplay:
```tsx
{onMqlDispositionChange && (
  <DispositionToggle
    value={mqlDisposition || 'all'}
    onChange={onMqlDispositionChange}
  />
)}
```

3. **Conditionally hide GoalDisplay** — wrap the existing GoalDisplay in an additional condition:
```tsx
{(mqlDisposition || 'all') === 'all' && goals && goals.mqls > 0 && (
  <GoalDisplay actual={metrics.mqls} goal={goals.mqls} label="MQL" />
)}
```

---

### Step 3.3 — Update `Scorecards.tsx` (SQL and SQO Cards)

**File:** `src/components/dashboard/Scorecards.tsx`

**Task:** Add `DispositionToggle` to both the SQL and SQO cards. Same pattern as the MQL card.

**Step 3.3a — Update the props interface:**

```typescript
interface ScorecardsProps {
  metrics: FunnelMetricsWithGoals;
  selectedMetric?: string | null;
  onMetricClick?: (metric: string) => void;
  visibleMetrics?: {
    sqls: boolean;
    sqos: boolean;
    signed: boolean;
    signedAum: boolean;
    joined: boolean;
    joinedAum: boolean;
    openPipeline: boolean;
  };
  // NEW: Disposition toggle state
  sqlDisposition?: MetricDisposition;
  onSqlDispositionChange?: (value: MetricDisposition) => void;
  sqoDisposition?: MetricDisposition;
  onSqoDispositionChange?: (value: MetricDisposition) => void;
}
```

Add imports:
```typescript
import { MetricDisposition } from '@/types/filters';
import { DispositionToggle } from './DispositionToggle';
```

**Step 3.3b — Add count resolution helpers:**

```typescript
const getSqlCount = (): number => {
  switch (sqlDisposition || 'all') {
    case 'open': return metrics.sqls_open ?? 0;
    case 'lost': return metrics.sqls_lost ?? 0;
    case 'converted': return metrics.sqls_converted ?? 0;
    default: return metrics.sqls;
  }
};

const getSqoCount = (): number => {
  switch (sqoDisposition || 'all') {
    case 'open': return metrics.sqos_open ?? 0;
    case 'lost': return metrics.sqos_lost ?? 0;
    case 'converted': return metrics.sqos_converted ?? 0;
    default: return metrics.sqos;
  }
};
```

**Step 3.3c — Update SQL card:** Search for `onMetricClick?.('sql')` or `metrics.sqls` in `src/components/dashboard/Scorecards.tsx` to find the SQL card. Then: (1) Replace `formatNumber(metrics.sqls)` with `formatNumber(getSqlCount())`; (2) Add `<DispositionToggle value={...} onChange={...} />` after the subtitle text, before GoalDisplay (pass `sqlDisposition` and `onSqlDispositionChange`); (3) Wrap GoalDisplay: `{(sqlDisposition || 'all') === 'all' && goals && goals.sqls > 0 && (...)}`.

**Step 3.3d — Update SQO card:** Search for `onMetricClick?.('sqo')` or `metrics.sqos` in `src/components/dashboard/Scorecards.tsx` to find the SQO card. Then: (1) Replace `formatNumber(metrics.sqos)` with `formatNumber(getSqoCount())`; (2) Add `<DispositionToggle>` after the subtitle text, before GoalDisplay (pass `sqoDisposition` and `onSqoDispositionChange`); (3) Wrap GoalDisplay: `{(sqoDisposition || 'all') === 'all' && goals && goals.sqos > 0 && (...)}`.

---

## PHASE 4: Dashboard Page Wiring

### Step 4.1 — Add Disposition State Variables

**File:** `src/app/dashboard/page.tsx`

**Task:** Add state variables to track the disposition toggle position for each of the three cards.

**Locate:** Search for `useState` in `src/app/dashboard/page.tsx` and find a block of state declarations (e.g. for filters, viewMode, selectedMetric). Add the three new state declarations in that same block (after the existing useState calls, before any useCallback/useEffect):

```typescript
import { MetricDisposition } from '@/types/filters';

// Disposition toggle state for MQL/SQL/SQO cards
const [mqlDisposition, setMqlDisposition] = useState<MetricDisposition>('all');
const [sqlDisposition, setSqlDisposition] = useState<MetricDisposition>('all');
const [sqoDisposition, setSqoDisposition] = useState<MetricDisposition>('all');
```

---

### Step 4.2 — Update `handleMetricClick` to Pass Disposition

**File:** `src/app/dashboard/page.tsx`

**Task:** When a user clicks a scorecard card that has a disposition toggle set, pass the disposition through to the drill-down query.

**Locate:** Search for `handleMetricClick` or `function handleMetricClick` in `src/app/dashboard/page.tsx`. Modify that function as follows:

1. **Determine the active disposition for the clicked metric:**

Add this block BEFORE the `try` block (after `setVolumeDrillDownTitle`):

```typescript
    // Determine active disposition for the clicked metric
    let activeDisposition: MetricDisposition = 'all';
    if (metricFilter === 'mql') activeDisposition = mqlDisposition;
    else if (metricFilter === 'sql') activeDisposition = sqlDisposition;
    else if (metricFilter === 'sqo') activeDisposition = sqoDisposition;
```

2. **Update the title to include disposition:**

Replace the existing title line:
```typescript
    // OLD:
    setVolumeDrillDownTitle(`${metricLabels[metricFilter]} - ${dateRangeText}`);
    
    // NEW:
    const dispositionLabels: Record<MetricDisposition, string> = {
      all: '',
      open: 'Open ',
      lost: 'Lost ',
      converted: 'Converted ',
    };
    const dispositionPrefix = dispositionLabels[activeDisposition];
    setVolumeDrillDownTitle(`${dispositionPrefix}${metricLabels[metricFilter]} - ${dateRangeText}`);
```

3. **Pass disposition to the drill-down filters:**

Update the drillDownFilters object:
```typescript
    // OLD:
    const drillDownFilters: DashboardFilters = {
      ...appliedFilters,
      metricFilter: metricFilter,
    };
    
    // NEW:
    const drillDownFilters: DashboardFilters = {
      ...appliedFilters,
      metricFilter: metricFilter,
      metricDisposition: activeDisposition,
    };
```

---

### Step 4.3 — Wire Props to Scorecard Components

**File:** `src/app/dashboard/page.tsx`

**Task:** Pass the disposition state and change handlers to the scorecard components.

**Locate FullFunnelScorecards:** Use the Grep tool: pattern `<FullFunnelScorecards` in `src/app/dashboard/page.tsx`. Add the new props to that JSX element:

```tsx
<FullFunnelScorecards
  metrics={metrics}
  selectedMetric={selectedMetric}
  onMetricClick={handleMetricClick}
  loading={loading}
  visibleMetrics={...}
  // NEW
  mqlDisposition={mqlDisposition}
  onMqlDispositionChange={setMqlDisposition}
/>
```

**Locate Scorecards:** Use the Grep tool: pattern `<Scorecards` in `src/app/dashboard/page.tsx`. Add the new props to that JSX element:

```tsx
<Scorecards
  metrics={metrics}
  selectedMetric={selectedMetric}
  onMetricClick={handleMetricClick}
  visibleMetrics={...}
  // NEW
  sqlDisposition={sqlDisposition}
  onSqlDispositionChange={setSqlDisposition}
  sqoDisposition={sqoDisposition}
  onSqoDispositionChange={setSqoDisposition}
/>
```

---

### Step 4.4 — Reset Dispositions When Filters Change

**File:** `src/app/dashboard/page.tsx`

**Task:** When the user applies new global filters (date range, channel, source, etc.), reset all disposition toggles back to "All". This prevents stale disposition state from persisting across filter changes.

**Locate:** Use the Grep tool: pattern `setAppliedFilters|handleApplyFilters` in `src/app/dashboard/page.tsx`. Find the handler or callback that updates applied filters when the user applies new filters. In that same handler, immediately after the filters are set, add:

```typescript
// Reset disposition toggles when global filters change
setMqlDisposition('all');
setSqlDisposition('all');
setSqoDisposition('all');
```

**Also reset when switching view modes** (Focused ↔ Full Funnel), if appropriate. Use the Grep tool: pattern `handleViewModeChange|setViewMode` in `src/app/dashboard/page.tsx`. If there is a view-mode change handler that runs when the user switches between Focused and Full Funnel, add the same three `set*Disposition('all')` calls there.

---

## PHASE 5: Validation and Testing

Run these after all implementation steps are complete. Steps 5.1–5.2 can be executed by an agent (run the query or build); Step 5.2 checklist and 5.3 are for human verification after deployment.

### Step 5.1 — Arithmetic Validation

**Task:** After the query changes are deployed, run a validation query to confirm that for each stage, `All = Open + Lost + Converted`.

Create a test script or run this in BigQuery directly:

```sql
SELECT
  -- MQL validation
  SUM(CASE WHEN mql_stage_entered_ts IS NOT NULL AND is_mql = 1 THEN 1 ELSE 0 END) as mql_all,
  SUM(CASE WHEN mql_stage_entered_ts IS NOT NULL AND is_mql = 1 AND is_sql = 1 THEN 1 ELSE 0 END) as mql_converted,
  SUM(CASE WHEN mql_stage_entered_ts IS NOT NULL AND is_mql = 1 AND is_sql = 0 AND lead_closed_date IS NOT NULL THEN 1 ELSE 0 END) as mql_lost,
  SUM(CASE WHEN mql_stage_entered_ts IS NOT NULL AND is_mql = 1 AND is_sql = 0 AND lead_closed_date IS NULL THEN 1 ELSE 0 END) as mql_open,
  
  -- Verify: mql_all = mql_converted + mql_lost + mql_open
  
  -- SQL validation (with Converted > Lost precedence)
  SUM(CASE WHEN converted_date_raw IS NOT NULL AND is_sql = 1 THEN 1 ELSE 0 END) as sql_all,
  SUM(CASE WHEN converted_date_raw IS NOT NULL AND is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 1 ELSE 0 END) as sql_converted,
  SUM(CASE WHEN converted_date_raw IS NOT NULL AND is_sql = 1 AND LOWER(COALESCE(SQO_raw, '')) != 'yes' AND StageName = 'Closed Lost' THEN 1 ELSE 0 END) as sql_lost,
  SUM(CASE WHEN converted_date_raw IS NOT NULL AND is_sql = 1 AND LOWER(COALESCE(SQO_raw, '')) != 'yes' AND (StageName IS NULL OR StageName != 'Closed Lost') THEN 1 ELSE 0 END) as sql_open,

  -- SQO validation (Signed = Converted)
  SUM(CASE WHEN Date_Became_SQO__c IS NOT NULL AND recordtypeid = '012Dn000000mrO3IAI' AND is_sqo_unique = 1 THEN 1 ELSE 0 END) as sqo_all,
  SUM(CASE WHEN Date_Became_SQO__c IS NOT NULL AND recordtypeid = '012Dn000000mrO3IAI' AND is_sqo_unique = 1 AND (advisor_join_date__c IS NOT NULL OR StageName IN ('Joined', 'Signed')) THEN 1 ELSE 0 END) as sqo_converted,
  SUM(CASE WHEN Date_Became_SQO__c IS NOT NULL AND recordtypeid = '012Dn000000mrO3IAI' AND is_sqo_unique = 1 AND StageName = 'Closed Lost' AND advisor_join_date__c IS NULL AND StageName != 'Signed' THEN 1 ELSE 0 END) as sqo_lost,
  SUM(CASE WHEN Date_Became_SQO__c IS NOT NULL AND recordtypeid = '012Dn000000mrO3IAI' AND is_sqo_unique = 1 AND StageName NOT IN ('Closed Lost', 'Joined', 'Signed') AND advisor_join_date__c IS NULL THEN 1 ELSE 0 END) as sqo_open

FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
```

**Expected result:** For each stage, `_all = _converted + _lost + _open`. If they don't match, there are edge cases we missed.

---

### Step 5.2 — Frontend Testing Checklist

Run through this manually after deploying:

- [ ] **Default state:** All three toggles default to "All". Numbers match current dashboard.
- [ ] **MQL toggle:** Click each position. Number changes. Numbers add up to "All" total.
- [ ] **SQL toggle:** Same verification.
- [ ] **SQO toggle:** Same verification. Verify Signed records appear under "Converted."
- [ ] **Drill-down inheritance:** Set MQL toggle to "Open", click the MQL card. Modal title says "Open MQLs - [period]". Records shown are only open MQLs.
- [ ] **Goal bar hiding:** Toggle to "Open" — GoalDisplay disappears. Toggle back to "All" — GoalDisplay reappears.
- [ ] **Click propagation:** Clicking the toggle buttons does NOT open the drill-down modal.
- [ ] **Filter reset:** Apply a new date range or channel filter. All toggles reset to "All".
- [ ] **View mode switch:** Switch between Focused and Full Funnel. Toggles reset to "All".
- [ ] **Dark mode:** Toggle dark mode. Segmented control renders correctly.
- [ ] **SGA filter:** Apply an SGA filter. Disposition counts still add up correctly.
- [ ] **Loading state:** While data is loading, toggles should still be interactive (they just show the old cached counts until new data arrives). Or if metrics is null during load, the count shows "..." as it does currently.

---

### Step 5.3 — Edge Case Verification

- [ ] **Zero counts:** When a disposition has 0 records (e.g., 0 Lost MQLs), the card shows "0" — not blank.
- [ ] **All-time date range:** Disposition counts work correctly with "All Time" filter.
- [ ] **Re-engagement records:** MQL toggle includes re-engagement records (since they can have `is_mql = 1`). SQL/SQO toggles exclude them (via `recordtypeid` filter on SQOs, and SQLs naturally include all record types — same as current behavior).

---

## Guardrails and Anti-Patterns

### DO NOT:
1. **Do NOT create a separate API endpoint** for disposition counts. Add them to the existing funnel-metrics query.
2. **Do NOT use `Conversion_Status` field directly** for disposition. It's a record-level field, not stage-specific. Use the per-stage logic defined in Phase 2.
3. **Do NOT add date filters to the WHERE clause.** Date filtering is done per-metric in CASE WHEN blocks (existing pattern).
4. **Do NOT change the cache key.** Same function, same arguments, just more data returned.
5. **Do NOT create internal state in scorecard components.** All state lives in `page.tsx`, passed via props.
6. **Do NOT forget `e.stopPropagation()`** on the DispositionToggle. Without it, clicking the toggle opens the drill-down modal.
7. **Do NOT add disposition toggles to Prospects, Contacted, Signed, Joined, or Open Pipeline cards.** Only MQL, SQL, and SQO.
8. **Do NOT show GoalDisplay when disposition ≠ "All".** Goals are set against totals.

### DO:
1. **DO use `COALESCE(SQO_raw, '')` for null safety** when checking SQL disposition.
2. **DO use Converted > Lost > Open precedence** in the CASE WHEN ordering within the aggregate query.
3. **DO reset disposition toggles** when global filters change.
4. **DO follow the exact same date field + SGA filter pattern** as the existing metrics for each stage.
5. **DO treat Signed as Converted** for SQO disposition (business decision).

---

## Execution Order Summary

**Agent:** Execute phases in this exact order. After each phase (or sub-step where verification is listed), run that step's verification before starting the next. Do not skip phases or reorder. Each phase should compile and not break existing functionality before moving to the next.

1. **Phase 1** (Types) — Safe, just adding fields. No runtime changes.
2. **Phase 2, Steps 2.1-2.2** (Query changes) — Backend returns more data. Frontend ignores new fields until Phase 3.
3. **Phase 2, Steps 2.3-2.4** (API verification) — Ensure new fields flow through.
4. **Phase 3, Step 3.1** (DispositionToggle component) — New file, not yet imported.
5. **Phase 3, Steps 3.2-3.3** (Scorecard updates) — Toggles appear on cards. All new props are optional so nothing breaks if parent doesn't pass them yet.
6. **Phase 4** (Dashboard page wiring) — Everything connects. Feature is live.
7. **Phase 5** (Validation) — Verify correctness.
