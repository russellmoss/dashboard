# Agentic Implementation Guide — Phase 3 Attribution Routing (post-council-review)

**Generated:** 2026-04-21 (refined post council feedback)
**Feature:** Route SGA-filtered queries through `Tableau_Views.vw_lead_primary_sga` behind `ATTRIBUTION_MODEL` feature flag. Fix Savvy Ops sweep attribution bug.

**Scope limitation (Q5 decision):** v2 uses the LEAD-era primary SGA from `vw_lead_primary_sga`. Opp-era metrics (SQO, Joined, AUM) filtered by SGA may slightly understate for leads where the lead-era primary was orphan/none but `Opp_SGA_Name__c` at the opp stage was a real SGA. This is an intentional Phase 3 scope cut — Phase 4 will add a dedicated opp-era view (e.g. `vw_opp_primary_sga`) with its own attribution logic. Do NOT add a COALESCE-fallback on the filter predicate; that reintroduces Savvy-Ops-sweep noise this feature is designed to eliminate.

---

## How to Read This Guide

Execute phases in order. Each phase ends with a **validation gate** containing exact bash/grep/SQL commands — do not proceed past a failing gate. At each **STOP AND REPORT** checkpoint, post results in chat; do not continue silently.

Source of truth: `exploration-results.md`, `code-inspector-findings.md`, `data-verifier-findings.md`, `pattern-finder-findings.md`, `council-feedback.md`, `triage-results.md`.

---

## Pre-Flight

Starting state:
- `Tableau_Views.vw_lead_primary_sga` deployed (119,262 rows), validated through Phase 2.8.
- `Tableau_Views.ref_non_sga_users` deployed (2 rows).
- Current dashboard unfiltered Q3 2025 self-sourced Contacted→MQL = **6.5063 %**. Do not move this number.

### Pre-flight SQL assertions (add as preflight/phase3.sql or run inline)

```sql
-- Assert 1: vw_lead_primary_sga is strictly one-row-per-lead.
-- If dupes > 0 → STOP, do not proceed. Fail-closed (per Q7 triage decision).
SELECT COUNT(*) AS rows, COUNT(DISTINCT lead_id) AS unique_ids,
  COUNT(*) - COUNT(DISTINCT lead_id) AS dupes
FROM `savvy-gtm-analytics.Tableau_Views.vw_lead_primary_sga`;
-- Expected: dupes = 0.

-- Assert 2: every column the helper references exists and has expected type.
-- Runs via SELECT with LIMIT 0 — fails fast on missing/mis-cased columns.
SELECT lead_id, primary_sga_user_id, primary_sga_name, primary_sga_reason,
  is_orphan_mql, lead_final_source, lead_is_self_sourced, has_complete_history
FROM `savvy-gtm-analytics.Tableau_Views.vw_lead_primary_sga`
LIMIT 0;

-- Assert 3: Gate 1 baseline reproduces from vw_funnel_master.
-- 165 / 2,536 = 6.5063 %
SELECT COUNT(*) AS n, SUM(IFNULL(v.contacted_to_mql_progression,0)) AS num,
  SUM(IFNULL(v.eligible_for_contacted_conversions_30d,0)) AS den
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Original_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND v.is_contacted = 1
  AND DATE(v.stage_entered_contacting__c) BETWEEN '2025-07-01' AND '2025-09-30';
```

### Pre-flight — Baseline invariance snapshot

Capture these six numbers from the v1 dashboard (`ATTRIBUTION_MODEL` unset) for the Q3 2025 self-sourced cohort. All six MUST remain byte-identical under v2 unfiltered. Any drift indicates JOIN fanout or predicate leakage. The Phase 3 duplication audit and Phase 7 Gate 6 both diff against this snapshot.

Run against the running app or directly in BigQuery:

```sql
SELECT
  SUM(is_contacted)                 AS contacted_count,
  SUM(is_mql)                       AS mql_count,
  SUM(is_sql)                       AS sql_count,
  SUM(is_sqo_unique)                AS sqo_count,
  SUM(is_joined_unique)             AS joined_count,
  SUM(COALESCE(Opportunity_AUM, 0)) AS total_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Original_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND is_contacted = 1
  AND DATE(stage_entered_contacting__c) BETWEEN '2025-07-01' AND '2025-09-30';
```

Write the six numbers to `docs/phase3-baseline-snapshot.md`. Every subsequent duplication-sensitive validation references this file.

### Pre-flight build

```bash
npm run build 2>&1 | tee /tmp/phase3-preflight-build.log
# Expected: build succeeds, zero errors.
```

**STOP AND REPORT**: Asserts all pass? `dupes=0`? Build clean? Baseline = 6.5063 %? If any fail, do not proceed.

---

## Phase 1 — Utility: `attribution-mode.ts`

**What:** Single env-var reader. Everything downstream imports from here. No scattered `process.env` reads. Server-side only per fixed env contract — no NEXT_PUBLIC_ twin.

**Files to create:**
- `src/lib/utils/attribution-mode.ts`

**Content:**
```typescript
// src/lib/utils/attribution-mode.ts

export type AttributionModel = 'v1' | 'v2';

/**
 * Returns 'v1' when ATTRIBUTION_MODEL is unset, empty, or any value other than 'v2'.
 * 'v1' preserves today's behavior — reads vw_funnel_master.SGA_Owner_Name__c directly.
 * 'v2' routes SGA-filtered queries through vw_lead_primary_sga.
 */
export function getAttributionModel(): AttributionModel {
  return process.env.ATTRIBUTION_MODEL === 'v2' ? 'v2' : 'v1';
}

/**
 * When true AND server is computing an SGA-filtered query for an authorized admin,
 * compute BOTH v1 and v2 numbers. The extra payload is attached for side-by-side display.
 * Server-side only — client gates on payload presence + role, not its own env var.
 */
export function isAttributionDebugEnabled(): boolean {
  return process.env.ATTRIBUTION_DEBUG === 'true';
}
```

**Validation gate:**
```bash
test -f src/lib/utils/attribution-mode.ts && \
  grep -q "export function getAttributionModel" src/lib/utils/attribution-mode.ts && \
  grep -q "export function isAttributionDebugEnabled" src/lib/utils/attribution-mode.ts && \
  ! grep -q "NEXT_PUBLIC_" src/lib/utils/attribution-mode.ts
# Expected: all greps succeed; NEXT_PUBLIC_ does not appear.

npm run build 2>&1 | tail -20
```

**STOP AND REPORT**: File created, both functions exported, no NEXT_PUBLIC_ references, build clean.

---

## Phase 2 — Filter-helpers refactor (Codex C2, C7, C12)

**What:**
(a) Add a new helper `buildSgaFilterClause(sgasFilter, paramPrefix, forceMode?)` that returns the SGA predicate + optional JOIN fragment + params.
(b) Remove the old SGA block from `buildAdvancedFilterClauses` (lines 106–109).

**No `availableCount` in the backend helper** (per Q7/Gemini C7). The UI owns the collapse — Phase 4 ensures the client sends `selected: []` when all SGAs are ticked. Backend strictly filters by whatever array it receives.

**`forceMode` is introduced HERE in Phase 2** (per C12) so Phase 5's debug branch can use it.

**Files to edit:**
- `src/lib/utils/filter-helpers.ts`

**Design:**

```typescript
import { getAttributionModel, AttributionModel } from './attribution-mode';

export interface SgaFilterClause {
  joinClause: string;
  whereClause: string;
  params: Record<string, unknown>;
}

/**
 * Build the SGA filter clause. Respects ATTRIBUTION_MODEL unless forceMode is given.
 *
 * @param sgasFilter { selectAll, selected } from advancedFilters.sgas, or a synthetic
 *                   wrapper for legacy single-SGA: { selectAll: false, selected: [filters.sga] }
 * @param paramPrefix e.g. 'adv' (default, matches existing caller prefix)
 * @param forceMode   optional override; if given, ignores getAttributionModel(). Used by
 *                    the debug double-query in Phase 5 to compute both v1 and v2 in parallel.
 */
export function buildSgaFilterClause(
  sgasFilter: { selectAll: boolean; selected: string[] } | undefined,
  paramPrefix: string = 'adv',
  forceMode?: AttributionModel
): SgaFilterClause {
  const selected = sgasFilter?.selected ?? [];
  const selectAll = sgasFilter?.selectAll ?? true;

  // No-op: client sent no filter (selectAll or empty list).
  if (selectAll || selected.length === 0) {
    return { joinClause: '', whereClause: '', params: {} };
  }

  const mode = forceMode ?? getAttributionModel();
  const paramName = `${paramPrefix}_sgas`;

  if (mode === 'v2') {
    return {
      joinClause:
        'LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_lead_primary_sga` p ON p.lead_id = v.Full_prospect_id__c',
      whereClause: `p.primary_sga_name IN UNNEST(@${paramName})`,
      params: { [paramName]: selected },
    };
  }

  // v1 — unchanged behavior (before the selectAll-collapse bug fix in the UI).
  return {
    joinClause: '',
    whereClause: `v.SGA_Owner_Name__c IN UNNEST(@${paramName})`,
    params: { [paramName]: selected },
  };
}
```

**Changes to existing `buildAdvancedFilterClauses`:** remove lines 106–109 (the old SGA block). Keep everything else (channels, sources, SGMs, campaigns, lead score tiers, dates) as-is.

**Validation gate:**
```bash
# Old broken SGA block gone:
grep -n "v.SGA_Owner_Name__c IN UNNEST" src/lib/utils/filter-helpers.ts
# Expected: no matches.

# New helper exported with all three parameters including forceMode:
grep -n "export function buildSgaFilterClause" src/lib/utils/filter-helpers.ts
grep -n "forceMode?: AttributionModel" src/lib/utils/filter-helpers.ts
# Expected: both match.

# No availableCount in backend helper:
grep -n "availableCount" src/lib/utils/filter-helpers.ts
# Expected: no matches.

# Build MAY break in query files that still rely on the old SGA clause — expected, fixed in Phase 3.
npm run build 2>&1 | tail -40
```

**STOP AND REPORT**: helper exported with 3 params including `forceMode`; old block removed; `availableCount` absent. Note which query files break (expected).

---

## Phase 3 — Query-layer wiring (the main surgery) (Codex C1, C2, C8)

**What:** Apply `buildSgaFilterClause` to every in-scope query function. **Explicitly REMOVE** the legacy `v.SGA_Owner_Name__c = @sga` fragments (C2 — council was clear: route-through-helper without removal leads to double-filtering).

**Files to edit:**
- `src/lib/queries/funnel-metrics.ts`
- `src/lib/queries/conversion-rates.ts` (three SQL builders — see C8)
- `src/lib/queries/detail-records.ts`
- `src/lib/queries/source-performance.ts` (both `getSourcePerformance` and `getChannelPerformance`)
- `src/lib/queries/export-records.ts` (per C1 — also threads `advancedFilters`)

### Pattern to apply per file

For each query function:

1. **Import**: add/merge `import { buildSgaFilterClause } from '@/lib/utils/filter-helpers';`. Do NOT add a second import line from that module.

2. **Delete the legacy `v.SGA_Owner_Name__c = @sga` fragment**. The new helper subsumes both the legacy single-SGA path and the multi-SGA path.

3. **Compute the SGA clause**. For files that consume `advancedFilters`:
   ```typescript
   const sgaClause = buildSgaFilterClause(advancedFilters.sgas, 'adv');
   ```
   For legacy single-SGA callers (`filters.sga`), synthesize a wrapper:
   ```typescript
   const sgaClause = filters.sga
     ? buildSgaFilterClause({ selectAll: false, selected: [filters.sga] }, 'adv')
     : { joinClause: '', whereClause: '', params: {} };
   ```
   A function that has BOTH legacy `filters.sga` and multi-select `advancedFilters.sgas` should call the helper once for whichever is active. If both are set, prefer `advancedFilters.sgas` (mult-select supersedes legacy).

4. **JOIN insertion**: insert `${sgaClause.joinClause}` in the SQL string AFTER every existing `FROM ... v` block (and after any pre-existing `LEFT JOIN User sga_user` clause). For `conversion-rates.ts`, insert in all three builders (C8).

5. **WHERE insertion**: `if (sgaClause.whereClause) conditions.push(sgaClause.whereClause);`

6. **Param merge**: `const allParams = { ...existingParams, ...advClauses.params, ...sgaClause.params };`

### File-specific notes

**`funnel-metrics.ts`**
- Remove `v.SGA_Owner_Name__c = @sga` at lines 44–45 (both the lead and opp CASE inlines). Replace with helper.
- Keep the existing `LEFT JOIN User sga_user` — unrelated to attribution routing. Insert `${sgaClause.joinClause}` AFTER it.
- Note: `funnel-metrics.ts` currently also references `v.Opp_SGA_Name__c` for Opp-side dual attribution. Under v2, this dual-attribution is NOT replaced — Q5 design question is deferred to Russell. For now: the new helper's WHERE clause acts on `p.primary_sga_name` (lead-era), leaving `Opp_SGA_Name__c` checks alone.

**`conversion-rates.ts`** (C8)
- Three SQL builders — all need the JOIN:
  - `_getConversionRates` (top-level FROM at line 53-55)
  - `getConversionTrends` trends_base CTE FROM (line 567)
  - `getConversionTrends` periods CTE FROM (line 635)
  - `getConversionTrends` period-comparisons FROM (line 907)
- Remove `v.SGA_Owner_Name__c = @sga` at line 74.
- This file has NO Opp-side dual attribution today; do not add one (brief scope creep warning).

**`detail-records.ts`**
- Remove legacy `v.SGA_Owner_Name__c = @sga` at lines 43–54.
- Conditional `LEFT JOIN User sga_user` at line 282 exists for a different purpose (name resolution). Leave alone.
- Insert `${sgaClause.joinClause}` unconditionally — empty string in v1 is safe.
- **Per Q1 (b) — display SGA swap under v2:** when `sgaClause.joinClause` is non-empty (i.e., v2 mode with SGA filter active), the `SELECT` must use `COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c)` for the `sga` column so table rows match filter math. Pattern:
  ```typescript
  const sgaDisplayCol = sgaClause.joinClause
    ? 'COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c)'
    : 'v.SGA_Owner_Name__c';
  ```
  Then in the SQL template replace `v.SGA_Owner_Name__c as sga` (line 292) with `${sgaDisplayCol} as sga`. When no SGA filter is active (`joinClause` empty), the legacy display is preserved — Gate 2 (v2 unfiltered invariance) not affected.

**`source-performance.ts`**
- Both `getSourcePerformance` and `getChannelPerformance`. Remove the legacy `v.SGA_Owner_Name__c = @sga` at lines 34–35 and 251–252.

**`export-records.ts`** (C1 — multi-SGA support must be added)
- Currently: `getExportDetailRecords(filters: DashboardFilters)` only reads `filters.sga` — IGNORES `advancedFilters.sgas`.
- **Change signature** (or pass through `filters.advancedFilters` — the DashboardFilters type already carries it):
  ```typescript
  export async function getExportDetailRecords(
    filters: DashboardFilters,
    limit: number = 50000
  ): Promise<ExportDetailRecord[]> {
    // ... existing
    const advancedFilters = filters.advancedFilters ?? DEFAULT_ADVANCED_FILTERS;
    const advClauses = buildAdvancedFilterClauses(advancedFilters, 'adv');

    // Prefer advanced multi-SGA; fall back to legacy single-SGA.
    const sgasFilter =
      advancedFilters.sgas && !advancedFilters.sgas.selectAll && advancedFilters.sgas.selected.length > 0
        ? advancedFilters.sgas
        : filters.sga
          ? { selectAll: false, selected: [filters.sga] }
          : undefined;
    const sgaClause = buildSgaFilterClause(sgasFilter, 'adv');
    // ... existing channel/source filter conditions, then push advClauses.whereClauses and sgaClause.whereClause
  }
  ```
- Remove the hardcoded `filterConditions.push('v.SGA_Owner_Name__c = @sga')` at line 42.
- Insert `${sgaClause.joinClause}` after `FROM \`${FULL_TABLE}\` v` at line 125.
- **Per Q1 (b):** under v2 with SGA filter active, swap the `sga` SELECT column to `COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c)`. Same pattern as `detail-records.ts`:
  ```typescript
  const sgaDisplayCol = sgaClause.joinClause
    ? 'COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c)'
    : 'v.SGA_Owner_Name__c';
  ```
  Replace `v.SGA_Owner_Name__c as sga` (line 70) with `${sgaDisplayCol} as sga`. Exported Sheet will match dashboard under v2 filter.
- **Duplication check for export:** After v2 routing is wired, run a single-filtered export (SGA = Lauren George, Q3 2025 self-sourced) and confirm the exported CSV has **exactly 272 rows** (matches Gate 4's denominator). If the CSV has > 272 rows, the JOIN fanned out. If < 272, the filter is over-eager. The number must be exactly 272.

### Phase 3 — Duplication audit (run before the validation gate)

After all 6 query files are wired but before declaring Phase 3 complete, run the unfiltered six-number query from `docs/phase3-baseline-snapshot.md` against the dashboard in BOTH modes:

- `ATTRIBUTION_MODEL` unset or `'v1'` → all 6 numbers must equal the snapshot **exactly**.
- `ATTRIBUTION_MODEL=v2` with **no SGA filter applied** → all 6 numbers must **still** equal the snapshot **exactly** (zero tolerance — this is the bit-identity check).

Additionally, run this row-count parity check directly in BigQuery:

```sql
-- Expected: row counts identical between the two queries below
SELECT COUNT(*) AS row_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE Original_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND is_contacted = 1
  AND DATE(stage_entered_contacting__c) BETWEEN '2025-07-01' AND '2025-09-30';

SELECT COUNT(*) AS row_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.vw_lead_primary_sga` p
  ON p.lead_id = v.Full_prospect_id__c
WHERE Original_source IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND is_contacted = 1
  AND DATE(stage_entered_contacting__c) BETWEEN '2025-07-01' AND '2025-09-30';
```

Both `COUNT(*)` values MUST be identical. If the JOIN produces more rows than `vw_funnel_master` alone, `vw_lead_primary_sga` has a duplicate `lead_id` that the pre-flight assertion missed — **STOP AND REPORT**.

If any of the 6 unfiltered numbers drifts between v1 and v2, or if the row-count parity fails, **STOP AND REPORT**. Do not proceed to Phase 4.

**Validation gate:**
```bash
# Every in-scope file calls the new helper:
grep -l "buildSgaFilterClause" src/lib/queries/ | sort
# Expected: all six files: funnel-metrics.ts, conversion-rates.ts, detail-records.ts,
#                          source-performance.ts, export-records.ts
# (conversion-rates counts as one file though it has three insertion points.)

# No in-scope file still has raw v1-only SGA clause for the funnel path:
grep -nE "v\.SGA_Owner_Name__c\s*=\s*@sga" src/lib/queries/funnel-metrics.ts \
  src/lib/queries/conversion-rates.ts \
  src/lib/queries/detail-records.ts \
  src/lib/queries/source-performance.ts \
  src/lib/queries/export-records.ts
# Expected: no matches. If a match appears, verify it's OUT OF SCOPE (not one of these 5 files).

# No raw `v.SGA_Owner_Name__c IN UNNEST` outside out-of-scope files:
grep -n "v.SGA_Owner_Name__c IN UNNEST" src/lib/queries/
# Expected: matches only in outreach-effectiveness, sga-activity, weekly-actuals,
# quarterly-progress, admin-quarterly-progress, sga-leaderboard, drill-down.ts (all out of scope).

# export-records now accepts advancedFilters:
grep -n "advancedFilters" src/lib/queries/export-records.ts
# Expected: at least one match.

# Parameterized queries preserved; no string interpolation of user data:
grep -nE "\\\$\\{filters\.sga[^:}]" src/lib/queries/ | head
# Expected: no matches.

# Build clean:
npm run build 2>&1 | tee /tmp/phase3-p3-build.log | tail -20
```

**STOP AND REPORT**: all 6 files wired; legacy `= @sga` fragments removed from in-scope files; build clean.

---

## Phase 4 — GlobalFilters UI fix for Rule 3 (Codex C9 + Gemini S2)

**What:** UI side of the selectAll-collapse bug. When user manually ticks every SGA visible in the dropdown, treat it as unfiltered.

**Per Q2 (deferred pending Russell's answer):** compare against `filteredSgaOptions.length` (visible set — council recommendation) by default. If Russell decides the full set, swap to `filterOptions.sgas.length`.

**Files to edit:**
- `src/components/dashboard/GlobalFilters.tsx`

**Change:** In `handleMultiSelectChange` (lines 159–169):

```typescript
const handleMultiSelectChange = (key: MainBarMultiKey, next: string[]) => {
  // Rule 3 bug fix: when the user individually ticks every VISIBLE SGA/SGM,
  // collapse to selectAll=true. Prevents the Savvy-Ops-sweep distortion in v1
  // and removes ambiguity at the v2 boundary.
  //
  // Compares against filteredSgaOptions / filteredSgmOptions (visible after Active/All
  // toggle) per Q2 council recommendation. See agentic_implementation_guide Refinement Log.
  const visibleCount =
    key === 'sgas' ? (filteredSgaOptions?.length ?? 0) :
    key === 'sgms' ? (filteredSgmOptions?.length ?? 0) :
    0;

  const allVisibleSelected = visibleCount > 0 && next.length >= visibleCount;

  onFiltersChange({
    ...filters,
    advancedFilters: {
      ...adv,
      [key]: {
        selectAll: next.length === 0 || allVisibleSelected,
        selected: allVisibleSelected ? [] : next,
      },
    },
  });
};
```

Optional-chain every `.length` access. If `filteredSgaOptions` isn't in closure, derive it inline from `filterOptions.sgas.filter(opt => sgaActiveOnly ? opt.isActive : true)` — matches existing memoization pattern at line 112.

Same collapse for `sgms` — the same bug exists symmetrically.

**Validation gate:**
```bash
# Collapse logic present:
grep -n "allVisibleSelected" src/components/dashboard/GlobalFilters.tsx
# Expected: at least one match.

# Uses filtered (visible) set, not filterOptions.sgas.length directly:
grep -n "filteredSgaOptions" src/components/dashboard/GlobalFilters.tsx | head -5
# Expected: referenced in handleMultiSelectChange.

# Build clean:
npm run build 2>&1 | tail -20
```

**STOP AND REPORT**: UI collapse applied using visible-set; build clean.

---

## Phase 5 — ATTRIBUTION_DEBUG side-by-side payload (Codex C3, C4, C11, C12)

**What:** Server-side. When `isAttributionDebugEnabled()` is true AND the user is an admin (`revops_admin`/`admin`) AND the SGA filter is active, run the funnel-metrics query twice (v1 and v2 via `forceMode`). Attach a `debug: { v1, v2 }` payload to the response.

**Files to edit:**
- `src/lib/queries/funnel-metrics.ts` — compute both v1 and v2 when eligible
- `src/types/dashboard.ts` — widen `FunnelMetrics` (C3): add `debug?: AttributionDebugPayload`
- `src/app/api/dashboard/funnel-metrics/route.ts` — pass the session role into the query function (C11)
- `src/lib/api-client.ts:343` — widen the client contract to accept `debug?`
- `src/app/dashboard/page.tsx:742` — pass `debug` through to the debug panel (Phase 6)

**Type additions** (C3 fix):

```typescript
// src/types/dashboard.ts

export interface AttributionDebugFigure {
  num: number;
  den: number;
  rate: number;  // 0..1 scale
}

export interface AttributionDebugPayload {
  v1: AttributionDebugFigure;
  v2: AttributionDebugFigure;
}

// widen existing FunnelMetrics:
export interface FunnelMetrics {
  // ... existing fields
  debug?: AttributionDebugPayload;
}
```

**Server-side role gate** (C11 fix):

In `src/app/api/dashboard/funnel-metrics/route.ts`, pass the session role into the query function:
```typescript
const session = await getServerSession(authOptions);
const permissions = getSessionPermissions(session);
const isAdmin = permissions?.role === 'revops_admin' || permissions?.role === 'admin';
const metrics = await getFunnelMetrics(filters, viewMode, { isAdmin });
```

In `src/lib/queries/funnel-metrics.ts`:
```typescript
export async function getFunnelMetrics(
  filters: DashboardFilters,
  viewMode: ViewMode,
  ctx?: { isAdmin?: boolean }
): Promise<FunnelMetrics> {
  // ... existing
  const sgaFilterIsActive = /* advancedFilters.sgas has selected or legacy filters.sga present */;

  let debug: AttributionDebugPayload | undefined;
  if (ctx?.isAdmin && isAttributionDebugEnabled() && sgaFilterIsActive) {
    const v1Clause = buildSgaFilterClause(sgasFilter, 'advv1', 'v1');
    const v2Clause = buildSgaFilterClause(sgasFilter, 'advv2', 'v2');
    // Run each query with the forced mode clause, collecting num/den.
    // Rate = num / den (0..1).
    debug = {
      v1: { num: v1Num, den: v1Den, rate: v1Num / (v1Den || 1) },
      v2: { num: v2Num, den: v2Den, rate: v2Num / (v2Den || 1) },
    };
  }

  return { ...metrics, debug };
}
```

**Scope decision (Russell confirmed in brief):** Only `funnel-metrics` for initial rollout. If Russell wants conversion-rates, detail-records, etc. covered by the debug panel, add as follow-up.

**Validation gate:**
```bash
# Debug branch wired with admin guard:
grep -n "isAttributionDebugEnabled" src/lib/queries/funnel-metrics.ts
grep -n "ctx?.isAdmin" src/lib/queries/funnel-metrics.ts
# Expected: at least one match each.

# Type widening present:
grep -n "AttributionDebugPayload" src/types/dashboard.ts
grep -n "debug?: AttributionDebugPayload" src/types/dashboard.ts
# Expected: match.

# API route passes isAdmin:
grep -n "isAdmin" src/app/api/dashboard/funnel-metrics/route.ts
# Expected: at least one match.

# No NEXT_PUBLIC_ATTRIBUTION_DEBUG anywhere in the repo (C4):
grep -rn "NEXT_PUBLIC_ATTRIBUTION_DEBUG" src/ | head
# Expected: no matches.

# Build clean:
npm run build 2>&1 | tail -20
```

**STOP AND REPORT**: debug branch wired with server-side role gate; type widened; no NEXT_PUBLIC_ATTRIBUTION_DEBUG introduced; build clean.

---

## Phase 6 — AttributionDebugPanel component (Codex C4)

**What:** Small admin-only panel. Gates solely on presence of the `debug` payload in the response + user role. No client-side env var (per C4).

**Files to create:**
- `src/components/dashboard/AttributionDebugPanel.tsx`

**Files to edit:**
- `src/app/dashboard/page.tsx` — mount the panel, pass `metrics?.debug`

**Content:**

```typescript
// src/components/dashboard/AttributionDebugPanel.tsx
'use client';

import { useSession } from 'next-auth/react';
import { getSessionPermissions } from '@/types/auth';
import type { AttributionDebugPayload } from '@/types/dashboard';

export function AttributionDebugPanel({ debug }: { debug?: AttributionDebugPayload }) {
  const { data: session } = useSession();
  const permissions = getSessionPermissions(session);
  const isAdmin =
    permissions?.role === 'revops_admin' || permissions?.role === 'admin';

  // Gate purely on payload presence + role. Server-side already honored ATTRIBUTION_DEBUG
  // and only emitted `debug` for admin users.
  if (!debug || !isAdmin) return null;

  const deltaPp = (debug.v2.rate - debug.v1.rate) * 100;

  return (
    <div className="rounded border border-yellow-300 bg-yellow-50 p-3 text-xs text-gray-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-gray-100">
      <div className="font-medium mb-1">Attribution Debug (admin-only)</div>
      <div className="grid grid-cols-4 gap-2">
        <div><span className="text-gray-500">v1 num/den</span> {debug.v1.num} / {debug.v1.den}</div>
        <div><span className="text-gray-500">v1 rate</span> {(debug.v1.rate * 100).toFixed(4)}%</div>
        <div><span className="text-gray-500">v2 num/den</span> {debug.v2.num} / {debug.v2.den}</div>
        <div>
          <span className="text-gray-500">v2 rate</span>
          {' '}{(debug.v2.rate * 100).toFixed(4)}%
          {' '}({deltaPp >= 0 ? '+' : ''}{deltaPp.toFixed(4)} pp)
        </div>
      </div>
      {/* Q5 (a) scope note — document the opp-era limitation where admins will see it */}
      <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-300">
        v2 uses lead-era primary SGA. Opp-era metrics (SQO, Joined, AUM) may understate for leads
        attributed to a real SGA only at opp stages — Phase 4 adds a dedicated opp-era view.
      </div>
    </div>
  );
}
```

In `src/app/dashboard/page.tsx`, mount above or below `GlobalFilters`:
```tsx
<AttributionDebugPanel debug={metrics?.debug} />
```

**Validation gate:**
```bash
# Component exists, no NEXT_PUBLIC_ reference, gates on role + payload:
grep -n "NEXT_PUBLIC_" src/components/dashboard/AttributionDebugPanel.tsx
# Expected: no matches.
grep -n "revops_admin" src/components/dashboard/AttributionDebugPanel.tsx
grep -n "if (!debug || !isAdmin)" src/components/dashboard/AttributionDebugPanel.tsx
# Expected: matches.

# Mounted on page:
grep -n "AttributionDebugPanel" src/app/dashboard/page.tsx
# Expected: import + JSX.

npm run build 2>&1 | tail -20
```

**STOP AND REPORT**: panel created, no client env var, gates correctly, mounted; build clean.

---

## Phase 7 — Validation gates (hard — all must pass)

Run each gate with the dashboard running locally. Record observed numbers.

### Gate 1 — v1 regression

```bash
export ATTRIBUTION_MODEL=v1   # (or unset)
unset ATTRIBUTION_DEBUG
npm run build && npm run start
```
Funnel Performance & Efficiency → no SGA filter → cohort: Q3 2025 self-sourced.
**Expected: Contacted→MQL = 6.5063 %.**

### Gate 2 — v2 unfiltered invariance

```bash
export ATTRIBUTION_MODEL=v2
unset ATTRIBUTION_DEBUG
npm run start
```
Same cohort, no SGA filter. **Expected: 6.5063 %** (no leak).

### Gate 3 — Savvy Ops sweep bug fix

`ATTRIBUTION_MODEL=v2`. Same cohort. Open SGA multi-select, tick every option individually. **Expected: 6.5063 %** (was 39.2 %). Also verify with `ATTRIBUTION_MODEL=v1` — the UI collapse should produce 6.5063 % too.

### Gate 4 — per-SGA attribution

`ATTRIBUTION_MODEL=v2`. Tick only "Lauren George". **Expected: 3.309 %** (= 9/272, Phase 2.6).

### Gate 5 — Build clean

```bash
npm run build 2>&1 | tail -20
# Expected: build succeeds, zero errors.
```

### Gate 6 — Unfiltered invariance across all metrics

With `ATTRIBUTION_MODEL=v2`, **no SGA filter applied**, Q3 2025 self-sourced cohort: all six baseline numbers (`contacted`, `mql`, `sql`, `sqo`, `joined`, `total_aum`) must equal `docs/phase3-baseline-snapshot.md` **exactly**. Zero tolerance on this gate.

Gates 1–4 only cover the Contacted→MQL rate. Gate 6 covers the full funnel plus AUM, which is where any JOIN-induced duplication would surface first.

If `total_aum` drifts by even one dollar, the JOIN is producing extra rows somewhere. **STOP AND REPORT**.

**STOP AND REPORT**: all 6 gates pass. Include observed number per gate.

---

## Phase 7.5 — Doc sync

Per CLAUDE.md:
```bash
npx agent-guard sync
```

Update `docs/ARCHITECTURE.md` if any section references SGA filtering — add a sub-section explaining v1/v2 attribution modes and env-var toggles. Do not edit auto-generated files in `docs/_generated/`.

**Validation gate:**
```bash
git status docs/
# Expected: modified ARCHITECTURE.md (if any section touched) and/or _generated/ files.
```

---

## Phase 8 — Human browser validation (I4: expanded matrix)

Run the dashboard locally. Verify each scenario by eye:

### Attribution model / debug matrix

| ATTRIBUTION_MODEL | ATTRIBUTION_DEBUG | User role | Expected |
|---|---|---|---|
| unset | unset | any | Today's behavior byte-identical. No debug panel. |
| v1 | unset | any | Same as above. |
| v1 | true | revops_admin | Debug panel visible showing v1/v2 side-by-side for Contacted→MQL. v1 and v2 match when no SGA filter. |
| v1 | true | viewer | No debug panel (server-side role gate). |
| v2 | unset | any | SGA filter uses vw_lead_primary_sga. Unfiltered still = 6.5063 %. |
| v2 | true | revops_admin | SGA filter uses v2. Debug panel visible. v1 ≠ v2 when per-SGA filter is active. |
| v2 | true | viewer | No debug panel, but v2 routing active. |

### Rule 3 UI collapse cases (per Codex C9, Gemini Q6)

- **Case A (collapse fires — acceptable):** `ATTRIBUTION_MODEL=v1`, Active/All toggle = Active, user ticks all 17 visible SGAs → UI collapses → rate = 6.5063 %. Pass.
- **Case B (collapse does NOT fire — 22-SGA cliff per Q6):** `ATTRIBUTION_MODEL=v1`, Active/All toggle = Active, user ticks 16 of 17 visible SGAs → UI does NOT collapse → rate may display the pre-fix 39 %-class distortion for the filtered subset, because Savvy Ops sweep is excluded. Document this as known limitation during rollout.
- **Case C (v2 fixes Case B):** switch to `ATTRIBUTION_MODEL=v2` with the same 16/17 selection → rate should be a legitimate weighted rate for those 16 SGAs' primary leads, substantially lower than 39 %. Verify.

### Export path

- Export Google Sheet with multi-SGA filter active under v1 → sheet rows match dashboard rows.
- Export under v2 → sheet rows match dashboard rows (filter-math coherent).
- Verify Outreach Effectiveness tab untouched (no regression).

**STOP AND REPORT**: per-scenario sign-off.

---

## Appendix — Out of scope reminders

- DO NOT modify `vw_funnel_master` or any BQ view.
- DO NOT touch `src/lib/semantic-layer/`.
- DO NOT touch `src/lib/queries/outreach-effectiveness.ts` (Phase 4).
- DO NOT touch `src/lib/queries/drill-down.ts`, `sga-activity.ts`, `weekly-actuals.ts`, `quarterly-progress.ts`, `admin-quarterly-progress.ts`, `sga-leaderboard.ts` (SGA Hub).
- DO NOT add IsSGA__c checks in TypeScript; `ref_non_sga_users` is authoritative.
- DO NOT add a fifth `extractDate`/`extractDateValue` local copy.
- DO NOT introduce `NEXT_PUBLIC_ATTRIBUTION_DEBUG` (C4: violates fixed env-var contract).
- DO NOT COALESCE the v2 filter predicate (Q5: e.g., `COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c) IN UNNEST(...)`). That reintroduces Savvy-Ops-sweep noise on opp-only rows. Opp-era attribution belongs to Phase 4 with a dedicated view. The COALESCE from Q1 (b) applies ONLY to the SELECT display column, not the WHERE predicate.

---

## Refinement Log

Applied post-council-review (see `council-feedback.md`, `triage-results.md`).

### Bucket 1 — Applied autonomously (15 items)

- **C1 (Codex)**: `export-records.ts` now threads `advancedFilters` and uses the SGA helper. Was: `getExportDetailRecords` only read legacy `filters.sga`. Now: multi-SGA filter flows through the helper. Scope-critical for dashboard/export consistency.
- **C2 (Codex)**: Phase 3 sub-sections rewritten to **explicitly remove** the legacy `v.SGA_Owner_Name__c = @sga` fragments per file, not just "route through helper". Prevents double-filtering or legacy-ownership regression under v2.
- **C3 (Codex)**: Phase 5 now explicitly widens the `FunnelMetrics` type with `debug?: AttributionDebugPayload` and enumerates consumer updates (`api-client.ts:343`, `page.tsx:742`, `sheets-types.ts:103`). The original guide incorrectly claimed "no type changes".
- **C4 (Codex)**: Replaced `NEXT_PUBLIC_ATTRIBUTION_DEBUG` with server-payload-presence gating. Client gates purely on `!!debug && isAdmin`. Respects the fixed env-var contract in the brief. Out-of-scope reminder added.
- **C5 (Codex)**: Pre-flight now includes a uniqueness assertion (`COUNT(*) - COUNT(DISTINCT lead_id) AS dupes`, must equal 0). Fail-closed per Q7 triage. Also a schema LIMIT-0 SELECT that catches casing/name drift (S3).
- **C7 (Gemini)**: Dropped `availableCount` from the backend helper signature. Backend strictly filters by the array the client sends; UI (Phase 4) owns the collapse.
- **C8 (Codex)**: Phase 3 sub-section for `conversion-rates.ts` now itemizes all three SQL builders (top-level FROM, trends_base CTE, periods CTE, period-comparisons FROM) that must each receive `${sgaClause.joinClause}`.
- **C11 (Gemini)**: Phase 5 adds a server-side role check (`ctx.isAdmin`) before running the double-query. Prevents 2× BQ cost for non-admin users even when `ATTRIBUTION_DEBUG=true` is set globally.
- **C12 (Codex)**: `forceMode?: AttributionModel` optional parameter is now declared in Phase 2's `buildSgaFilterClause` signature. Phase 5 depends on it; phase ordering fixed.
- **S1 (Codex)**: Helper uses fully qualified backticked view name. Caller-discipline note added to Phase 3: do not concatenate unqualified table names.
- **S2 (Gemini)**: Phase 4's UI length check uses optional-chained `filteredSgaOptions?.length ?? 0` and compares only when > 0.
- **S3 (Codex)**: Pre-flight LIMIT-0 SELECT enumerates every column the helper references. Catches schema drift before any code runs.
- **Q4 (brief + council agreement)**: Silent exclusion of orphan/`none` primary_sga leads when a specific SGA is selected. Matches brief default; council confirmed. Applied as default behavior (no code change — structural outcome of IN-clause).
- **Q7 (Codex)**: Fail-closed on duplicate `lead_id`. Applied via pre-flight assertion rather than defensive SQL dedupe.
- **I4 (orchestrator)**: Phase 8 matrix expanded to 4 rollup scenarios (model × debug × role) + 3 Rule 3 collapse cases + export-path + out-of-scope regression check.

### Bucket 3 — Noted but deferred (3 items)

- **I2 (Gemini)**: Expose `primary_sga_reason` in detail table. Deferred — scope creep; follow-up PR.
- **I3 (Gemini)**: Single-query conditional aggregation for debug. Deferred — premature optimization; double-query is clearer initially.
- **I6 (Gemini)**: Upstream COALESCE for `lead_is_self_sourced` in `vw_funnel_master`. Deferred — brief forbids modifying `vw_funnel_master`.

### Bucket 2 — Resolved by human input (5 items, all answered 2026-04-21)

- **Q1 (b) applied — Display SGA swap under v2.** `detail-records.ts` and `export-records.ts` now use `${sgaDisplayCol} as sga` where `sgaDisplayCol = sgaClause.joinClause ? 'COALESCE(p.primary_sga_name, v.SGA_Owner_Name__c)' : 'v.SGA_Owner_Name__c'`. Display matches filter math under v2 with SGA filter active. Unfiltered v2 preserves legacy display (no JOIN = no COALESCE needed). Russell's rationale: "Table/export match filter math."
- **Q2 (b) applied — Visible-set collapse.** `handleMultiSelectChange` compares against `filteredSgaOptions.length` / `filteredSgmOptions.length` (the visible set after Active/All toggle), not the full option set. Matches user intent. Russell's rationale: "What-you-see matches. Active-only toggle is user intent."
- **Q3 (b) applied — Admin-role + env-var gating.** Server checks `ctx?.isAdmin` (`role in {revops_admin, admin}`) before running the debug double-query. Client gates on `!!debug && isAdmin`. No cost doubling for non-admins. Russell's rationale: "Cost doubling for all users is unacceptable during observation window."
- **Q5 (a) applied — Accept opp-era limitation; do NOT COALESCE-fallback on filter predicate.** Added scope-limitation note to the top of the guide and to the admin-only AttributionDebugPanel UI. No change to `buildSgaFilterClause`'s filter predicate — it remains strict `p.primary_sga_name IN UNNEST(@...)`. Russell's rationale: "Opp-era attribution is Phase 4 work with its own view. Do NOT COALESCE-fallback — that reintroduces Savvy-Ops-sweep noise we worked to eliminate."
  - Note the asymmetry: Q1 (b) COALESCE applies to the SELECT display column only (to reconcile row-level display with the filter that was applied). Q5 (a) rejects COALESCE in the WHERE predicate (to preserve the strict lead-era attribution semantics). These are two different SQL locations with opposite answers — both correct.
- **Q6 (a) applied — No "22-SGA cliff" UI warning.** Phase 8 documents the case as a known Rule-3 collapse edge behavior under v1; no UI change. The cliff disappears when v2 becomes default. Russell's rationale: "Not worth building UX for a behavior we're retiring."

### Pre-execution hardening (2026-04-21)

1. Added baseline-invariance snapshot step to Pre-Flight. Captures 6 numbers (`contacted`, `mql`, `sql`, `sqo`, `joined`, `total_aum`) that must remain identical between v1 and v2 unfiltered.
2. Added duplication audit to Phase 3 that runs the 6-number diff and a `COUNT(*)` parity check between `vw_funnel_master` alone vs `vw_funnel_master JOIN vw_lead_primary_sga`.
3. Added Gate 6 to Phase 7 — unfiltered invariance across all 6 metrics including AUM. Gates 1–4 only cover the one Contacted→MQL ratio; Gate 6 catches JOIN fanout that affects other metrics.
4. Added duplication check to `export-records.ts` subsection — Lauren George Q3 2025 self-sourced export must have exactly 272 rows.
5. Rationale: `vw_funnel_master` can produce multiple rows per `lead_id` via the FULL OUTER JOIN + `ROW_NUMBER()` pattern at lines 180–183 (exposed via `is_primary_opp_record`, `is_sqo_unique`, `is_joined_unique`). `vw_lead_primary_sga` is one-row-per-lead and will not fanout on its own, but the combined behavior needs explicit validation at multiple stages, not just via the single Contacted→MQL gate.
