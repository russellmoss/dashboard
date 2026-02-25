# Agentic Implementation Guide: Stale Pipeline Alerts

**Generated:** 2026-02-25
**Based on:** exploration-results.md + code-inspector-findings.md + data-verifier-findings.md + pattern-finder-findings.md

---

## Reference Document

All decisions in this guide are based on the completed exploration files in the project root.
Those documents are the single source of truth for line numbers, field names, and patterns.

---

## Feature Summary

| What | Details |
|---|---|
| New section | Stale Pipeline Alerts card on Pipeline tab (By Stage view) |
| Data source | `POST /api/dashboard/pipeline-drilldown` — already returns `daysInCurrentStage` |
| Key field | `DetailRecord.daysInCurrentStage: number \| null` — already exists, no type changes |
| Grouping | Client-side grouping by `record.stage`, no new API routes |
| Thresholds | <30d green, 30–59d yellow, 60–89d orange, 90d+ red, null N/A |
| On Hold | 54 records averaging 173 days — shown in a "Deliberate Hold" sub-section |
| New files | 1 — `src/components/dashboard/StalePipelineAlerts.tsx` |
| Modified files | 2 — `src/config/constants.ts`, `src/app/dashboard/pipeline/page.tsx` |
| Type changes | None |
| API route changes | None |
| BigQuery changes | None |

---

## Architecture Rules

- Never use string interpolation in BigQuery queries — always `@paramName` (standing rule)
- Use `toString()` / `toNumber()` helpers for type-safe transforms
- Do NOT use `getOpenPipelineRecords` — it hardcodes `daysInCurrentStage: null`
- Use `POST /api/dashboard/pipeline-drilldown` (backed by `_getOpenPipelineRecordsByStage`) which correctly computes `daysInCurrentStage`

---

## Pre-Flight Checklist

Run this before making any changes:

```bash
cd /c/Users/russe/Documents/Dashboard && npm run build 2>&1 | tail -20
```

**Expected:** Build succeeds. Note the exact pre-existing error count.
If the build is already broken, STOP and report. Do not proceed with a broken baseline.

Also verify the key field exists:

```bash
grep -n "daysInCurrentStage" src/types/dashboard.ts
```

**Expected:** Line ~158 — `daysInCurrentStage: number | null;`

---

# PHASE 1: Constants

## Context

Add `STALE_PIPELINE_THRESHOLDS` and `ON_HOLD_STAGE` to `src/config/constants.ts`.
This makes thresholds configurable from a single location instead of scattered magic numbers.

## Step 1.1: Add constants to end of file

**File:** `src/config/constants.ts`

The file currently ends with `export const DEFAULT_DATE_PRESET = 'q4' as const;` (line 41).
Add after that line:

```typescript

export const STALE_PIPELINE_THRESHOLDS = {
  warning: 30,   // yellow badge: >= 30 days
  stale: 60,     // orange badge: >= 60 days
  critical: 90,  // red badge: >= 90 days
} as const;

// On Hold is excluded from OPEN_PIPELINE_STAGES (not actively progressing)
// but is included in stale alerts as a separate "Deliberate Hold" section
export const ON_HOLD_STAGE = 'On Hold' as const;
```

## PHASE 1 — VALIDATION GATE

```bash
grep -n "STALE_PIPELINE_THRESHOLDS\|ON_HOLD_STAGE" src/config/constants.ts
```

**Expected:** Two lines showing the new exports.

**STOP AND REPORT:**
- "Added `STALE_PIPELINE_THRESHOLDS` and `ON_HOLD_STAGE` to `src/config/constants.ts`"
- "Ready to proceed to Phase 2?"

---

# PHASE 2: StalePipelineAlerts Component

## Context

This is the primary new UI work. The component:
- Accepts `DetailRecord[]` already populated with `daysInCurrentStage`
- Groups records client-side by `record.stage` using `useMemo`
- Shows a summary header per stage (count by tier, clickable)
- Lists each record with advisor name, AUM, days badge, and next step preview
- Clicking a stage group header calls `onStageClick` → opens `VolumeDrillDownModal`
- On Hold records appear in a distinct sub-section with a deliberate-hold note
- Fully dark mode compatible

Key patterns followed:
- Badge classes: `px-2.5 py-0.5 text-xs font-semibold rounded-full` (from `RecordDetailModal.tsx`)
- Section wrapper: `<Card className="mb-6">` (standard pipeline page pattern)
- Color tiers: same green/yellow/orange/red pattern as `getStatusColor()` in `freshness-helpers.ts`
- Stage colors: `STAGE_COLORS` from `constants.ts`

## Step 2.1: Create the component

**File:** `src/components/dashboard/StalePipelineAlerts.tsx` (new file)

```tsx
'use client';

import React, { useMemo } from 'react';
import { Card, Text } from '@tremor/react';
import { AlertTriangle, Clock, ChevronRight } from 'lucide-react';
import { DetailRecord } from '@/types/dashboard';
import {
  OPEN_PIPELINE_STAGES,
  STAGE_COLORS,
  STALE_PIPELINE_THRESHOLDS,
  ON_HOLD_STAGE,
} from '@/config/constants';

// ─── Aging tier helpers ───────────────────────────────────────────────────────

type AgingTier = 'fresh' | 'warning' | 'stale' | 'critical' | 'unknown';

function getAgingTier(days: number | null): AgingTier {
  if (days === null) return 'unknown';
  if (days >= STALE_PIPELINE_THRESHOLDS.critical) return 'critical';
  if (days >= STALE_PIPELINE_THRESHOLDS.stale)    return 'stale';
  if (days >= STALE_PIPELINE_THRESHOLDS.warning)  return 'warning';
  return 'fresh';
}

const TIER_BADGE_CLASSES: Record<AgingTier, string> = {
  fresh:   'bg-green-100  text-green-800  dark:bg-green-900/30  dark:text-green-400',
  warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  stale:   'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  critical:'bg-red-100    text-red-800    dark:bg-red-900/30    dark:text-red-400',
  unknown: 'bg-gray-100   text-gray-500   dark:bg-gray-800      dark:text-gray-400',
};

const TIER_RANGE_LABEL: Record<AgingTier, string> = {
  fresh:   `<${STALE_PIPELINE_THRESHOLDS.warning}d`,
  warning: `${STALE_PIPELINE_THRESHOLDS.warning}–${STALE_PIPELINE_THRESHOLDS.stale - 1}d`,
  stale:   `${STALE_PIPELINE_THRESHOLDS.stale}–${STALE_PIPELINE_THRESHOLDS.critical - 1}d`,
  critical:`${STALE_PIPELINE_THRESHOLDS.critical}d+`,
  unknown: 'N/A',
};

function AgingBadge({ days }: { days: number | null }) {
  const tier = getAgingTier(days);
  const label = days === null ? 'N/A' : `${days}d`;
  return (
    <span className={`px-2.5 py-0.5 text-xs font-semibold rounded-full flex-shrink-0 ${TIER_BADGE_CLASSES[tier]}`}>
      {label}
    </span>
  );
}

function formatAum(aum: number): string {
  if (aum >= 1_000_000_000) return `$${(aum / 1_000_000_000).toFixed(1)}B`;
  if (aum >= 1_000_000)     return `$${(aum / 1_000_000).toFixed(0)}M`;
  return `$${aum.toLocaleString()}`;
}

// ─── Tier summary bar ────────────────────────────────────────────────────────

interface TierCounts {
  fresh: number;
  warning: number;
  stale: number;
  critical: number;
  unknown: number;
}

function TierSummaryBadges({ counts, total }: { counts: TierCounts; total: number }) {
  const tiers: AgingTier[] = ['critical', 'stale', 'warning', 'fresh', 'unknown'];
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tiers.map(tier => {
        const count = counts[tier];
        if (count === 0) return null;
        const pct = Math.round((count / total) * 100);
        return (
          <span key={tier} className={`px-2 py-0.5 text-xs font-medium rounded-full ${TIER_BADGE_CLASSES[tier]}`}>
            {count} {TIER_RANGE_LABEL[tier]} ({pct}%)
          </span>
        );
      })}
    </div>
  );
}

// ─── Stage section ───────────────────────────────────────────────────────────

interface StageSectionProps {
  stage: string;
  records: DetailRecord[];
  isOnHold?: boolean;
  onStageClick: (stage: string, records: DetailRecord[]) => void;
}

function StageSection({ stage, records, isOnHold = false, onStageClick }: StageSectionProps) {
  const stageColor = STAGE_COLORS[stage] ?? '#94a3b8';

  const counts = useMemo<TierCounts>(() => {
    return records.reduce(
      (acc, r) => {
        acc[getAgingTier(r.daysInCurrentStage)]++;
        return acc;
      },
      { fresh: 0, warning: 0, stale: 0, critical: 0, unknown: 0 }
    );
  }, [records]);

  // Sort: highest days first, nulls last
  const sorted = useMemo(() => {
    return [...records].sort((a, b) => {
      if (a.daysInCurrentStage === null && b.daysInCurrentStage === null) return 0;
      if (a.daysInCurrentStage === null) return 1;
      if (b.daysInCurrentStage === null) return -1;
      return b.daysInCurrentStage - a.daysInCurrentStage;
    });
  }, [records]);

  const staleCount = counts.critical + counts.stale + counts.warning;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Stage header — clickable */}
      <button
        onClick={() => onStageClick(stage, records)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: stageColor }}
          />
          <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
            {stage}
          </span>
          {isOnHold && (
            <span className="text-xs text-gray-400 dark:text-gray-500 italic hidden sm:inline">
              — deliberate pause
            </span>
          )}
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {records.length} record{records.length !== 1 ? 's' : ''}
            {staleCount > 0 && (
              <span className="ml-1 text-orange-600 dark:text-orange-400">
                · {staleCount} flagged
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <TierSummaryBadges counts={counts} total={records.length} />
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        </div>
      </button>

      {/* Record rows */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {sorted.map(record => (
          <div
            key={record.id}
            className="flex items-center justify-between px-4 py-2.5 text-sm"
          >
            <div className="flex items-center gap-3 min-w-0">
              <AgingBadge days={record.daysInCurrentStage} />
              <span className="font-medium text-gray-800 dark:text-gray-200 truncate">
                {record.advisorName}
              </span>
              {record.nextSteps && (
                <span className="text-xs text-gray-400 dark:text-gray-500 truncate hidden md:block max-w-xs">
                  {record.nextSteps}
                </span>
              )}
            </div>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
              {formatAum(record.aum)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface StalePipelineAlertsProps {
  records: DetailRecord[];
  loading: boolean;
  onStageClick: (stage: string, records: DetailRecord[]) => void;
}

export function StalePipelineAlerts({ records, loading, onStageClick }: StalePipelineAlertsProps) {
  // Group records by stage client-side
  const byStage = useMemo(() => {
    const map = new Map<string, DetailRecord[]>();
    for (const record of records) {
      const stage = record.stage || 'Unknown';
      const existing = map.get(stage) ?? [];
      existing.push(record);
      map.set(stage, existing);
    }
    return map;
  }, [records]);

  // Separate On Hold from actively-progressing stages
  const onHoldRecords = byStage.get(ON_HOLD_STAGE) ?? [];
  const activeStageRecords = OPEN_PIPELINE_STAGES
    .map(stage => ({ stage, records: byStage.get(stage) ?? [] }))
    .filter(({ records: r }) => r.length > 0);

  const totalFlagged = records.filter(
    r => r.daysInCurrentStage !== null && r.daysInCurrentStage >= STALE_PIPELINE_THRESHOLDS.warning
  ).length;

  const hasData = records.length > 0;

  if (!hasData && !loading) return null;

  return (
    <Card className="mb-6">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-4">
        <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Stale Pipeline Alerts
          </h2>
          {!loading && hasData && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {totalFlagged} of {records.length} records flagged at {STALE_PIPELINE_THRESHOLDS.warning}d+
              · Click a stage to view details
            </p>
          )}
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {/* Active pipeline stages */}
      {!loading && activeStageRecords.length > 0 && (
        <div className="space-y-3">
          {activeStageRecords.map(({ stage, records: stageRecords }) => (
            <StageSection
              key={stage}
              stage={stage}
              records={stageRecords}
              onStageClick={onStageClick}
            />
          ))}
        </div>
      )}

      {/* On Hold — always shown separately if records exist */}
      {!loading && onHoldRecords.length > 0 && (
        <div className={activeStageRecords.length > 0 ? 'mt-4 pt-4 border-t border-gray-200 dark:border-gray-700' : ''}>
          <div className="flex items-center gap-1.5 mb-2">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              On Hold
            </span>
          </div>
          <StageSection
            stage={ON_HOLD_STAGE}
            records={onHoldRecords}
            isOnHold
            onStageClick={onStageClick}
          />
        </div>
      )}

      {/* Qualifying footnote — only when Qualifying records are present */}
      {!loading && (byStage.get('Qualifying')?.length ?? 0) > 0 && (
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500 italic">
          * Qualifying: days counted from opportunity creation date (no Salesforce stage entry date available)
        </p>
      )}
    </Card>
  );
}
```

## Step 2.2: Verify field names against DetailRecord

Before saving, verify the field names used in the component match the actual `DetailRecord` type:

```bash
grep -n "advisorName\|record\.stage\|daysInCurrentStage\|nextSteps\|\.aum\b" src/types/dashboard.ts | head -20
```

**If `advisorName` is not found**, check the correct display name field (may be `name`, `fullName`, or similar) and update the component's record rows accordingly before saving.

## PHASE 2 — VALIDATION GATE

```bash
grep -n "export function StalePipelineAlerts\|getAgingTier\|AgingBadge\|TierSummaryBadges\|StageSection" src/components/dashboard/StalePipelineAlerts.tsx
```

**Expected:** All 5 identifiers found.

Then type-check:
```bash
cd /c/Users/russe/Documents/Dashboard && npx tsc --noEmit 2>&1 | head -30
```

**Expected:** Zero errors.

**STOP AND REPORT:**
- "Created `StalePipelineAlerts.tsx` with aging tier logic, per-stage sections, On Hold sub-section"
- "TypeScript: [N] errors (expected: 0)"
- "Ready to proceed to Phase 3?"

---

# PHASE 3: Pipeline Page Wiring

## Context

Wire `StalePipelineAlerts` into `src/app/dashboard/pipeline/page.tsx`.
Four changes: (1) merge imports, (2) add state, (3) add fetch logic + handler, (4) render component.
Follow the `handleAumClick` fetch pattern exactly (sequential for-loop, deduplicate by `record.id`).

The file currently has 571 lines. All line numbers below are approximate — verify visually.

## Step 3.1: Merge constants import

**Current line 11:**
```typescript
import { OPEN_PIPELINE_STAGES } from '@/config/constants';
```

**Replace with:**
```typescript
import { OPEN_PIPELINE_STAGES, ON_HOLD_STAGE } from '@/config/constants';
```

## Step 3.2: Add StalePipelineAlerts import

**Current line ~23 (after SgmConversionTable import):**
```typescript
import { SgmOption, SgmPipelineChartData } from '@/types/dashboard';
```

**Add immediately after that line:**
```typescript
import { StalePipelineAlerts } from '@/components/dashboard/StalePipelineAlerts';
```

## Step 3.3: Add state variables

**After line ~96** (the `drillDownConversionMetric` state declaration), add:
```typescript
  // Stale pipeline alerts
  const [staleRecords, setStaleRecords] = useState<DetailRecord[]>([]);
  const [staleLoading, setStaleLoading] = useState(false);
```

## Step 3.4: Add fetch logic

**After the `fetchConversionData` useCallback** (around line ~172) and before the `useEffect` that calls `fetchBySgmData`, add:

```typescript
  // Fetch all open pipeline records for stale alerts (both active stages and On Hold)
  const fetchStaleRecords = useCallback(async () => {
    if (sgmOptionsLoading || selectedSgms.length === 0) return;
    setStaleLoading(true);

    try {
      const sgmsToSend = selectedSgms.length === sgmOptions.length ? undefined : selectedSgms;
      const allRecords: DetailRecord[] = [];
      const recordIds = new Set<string>();

      // Include all selected active stages plus On Hold (always relevant for staleness)
      const stagesToFetch = [...selectedStages, ON_HOLD_STAGE];

      for (const stage of stagesToFetch) {
        try {
          const result = await dashboardApi.getPipelineDrilldown(stage, undefined, sgmsToSend);
          for (const record of result.records) {
            if (!recordIds.has(record.id)) {
              recordIds.add(record.id);
              allRecords.push(record);
            }
          }
        } catch (err) {
          console.error(`[StaleAlerts] Error fetching stage ${stage}:`, err);
        }
      }

      setStaleRecords(allRecords);
    } catch (err) {
      console.error('[StaleAlerts] Error:', err);
      setStaleRecords([]);
    } finally {
      setStaleLoading(false);
    }
  }, [selectedStages, selectedSgms, sgmOptions.length, sgmOptionsLoading]);

  useEffect(() => {
    if (status === 'authenticated') {
      fetchStaleRecords();
    }
  }, [status, fetchStaleRecords]);
```

## Step 3.5: Add stage click handler

**After the `handleCloseDrillDown` function** (around line ~350), add:

```typescript
  // Handle stale alert stage click — opens drill-down pre-filtered to that stage's records
  const handleStaleStageClick = (stage: string, stageRecords: DetailRecord[]) => {
    setDrillDownRecords(stageRecords);
    setDrillDownStage(stage);
    setDrillDownMetric(null);
    setDrillDownSgm(null);
    setDrillDownConversionMetric(null);
    setDrillDownOpen(true);
  };
```

## Step 3.6: Render the component

**After line 523** (the closing `</Card>` of the chart section) and **before line 525** (`{/* Conversion Table */}`), add:

```tsx
      {/* Stale Pipeline Alerts — By Stage tab only */}
      {activeTab === 'byStage' && (
        <StalePipelineAlerts
          records={staleRecords}
          loading={staleLoading}
          onStageClick={handleStaleStageClick}
        />
      )}
```

## PHASE 3 — VALIDATION GATE

Verify all identifiers are present:
```bash
grep -n "StalePipelineAlerts\|ON_HOLD_STAGE\|staleRecords\|staleLoading\|fetchStaleRecords\|handleStaleStageClick" src/app/dashboard/pipeline/page.tsx
```

**Expected:** All 6 identifiers found.

Check for duplicate imports from constants:
```bash
grep -n "from '@/config/constants'" src/app/dashboard/pipeline/page.tsx
```

**Expected:** Exactly 1 line.

**STOP AND REPORT:**
- "Wired `StalePipelineAlerts` into pipeline page"
- "6 identifiers present: [list them]"
- "Import count from constants: [N] (expected: 1)"
- "Ready to proceed to Phase 4 (build validation)?"

---

# PHASE 4: Build Validation

## Context

Run a full TypeScript build. This feature makes no type changes, so the build should
pass cleanly if all imports and props are correct.

## Step 4.1: Full build

```bash
cd /c/Users/russe/Documents/Dashboard && npm run build 2>&1 | tail -40
```

**Expected:** `✓ Compiled successfully` with zero TypeScript errors.

## Step 4.2: If errors appear — triage guide

| Error message | Cause | Fix |
|---|---|---|
| `Cannot find module '@/components/dashboard/StalePipelineAlerts'` | File not created | Verify file exists at exact path |
| `Property 'daysInCurrentStage' does not exist on type 'DetailRecord'` | Import path wrong | Check `src/types/dashboard.ts` line 158 |
| `Cannot find name 'ON_HOLD_STAGE'` | Import not merged | Check Step 3.1 merged the constants import |
| `Property 'nextSteps' does not exist` | Wrong field name | Check `src/types/dashboard.ts` lines 173–174 for exact name |
| `Property 'advisorName' does not exist` | Wrong field name | Check DetailRecord for correct display name field |
| Duplicate `import ... from '@/config/constants'` | Two separate import lines | Merge into one |
| `Object is possibly 'undefined'` | `byStage.get()` returns `undefined` | Verify `?? []` fallback in component |

## PHASE 4 — VALIDATION GATE

```bash
cd /c/Users/russe/Documents/Dashboard && npm run build 2>&1 | grep -E "error TS|✓ Compiled|Failed to compile" | head -20
```

**Expected:** `✓ Compiled successfully`

**STOP AND REPORT:**
- "Build result: [PASS / FAIL]"
- "Error count: [N] (expected: 0)"
- If fail: list each `error TS` line with file and line number
- "Ready to proceed to Phase 5 (doc sync)?" [only if build passes]

---

# PHASE 5: Documentation Sync

## Context

Run agent-guard to sync narrative docs (ARCHITECTURE.md, README.md) with the code changes.
Must happen after build passes, before UI validation.

## Step 5.1: Sync

```bash
cd /c/Users/russe/Documents/Dashboard && npx agent-guard sync
```

## Step 5.2: Review changes

```bash
git diff --stat docs/
git diff docs/ARCHITECTURE.md | head -60
```

## PHASE 5 — VALIDATION GATE

```bash
git status --short docs/
```

**Expected:** Modified or clean (no unexpected deletions).

**STOP AND REPORT:**
- "agent-guard sync complete — [N] docs updated"
- "ARCHITECTURE.md changes: [yes/no — brief summary if yes]"
- "Ready to proceed to Phase 6 (UI validation)?"

---

# PHASE 6: UI/UX Validation (Requires User)

## Context

Human-in-the-loop verification in the browser. Present each test group, wait for confirmation
before moving to the next. Do NOT mark this phase complete until the user confirms all groups.

**Start dev server if not running:**
```bash
cd /c/Users/russe/Documents/Dashboard && npm run dev
```

Navigate to: `http://localhost:3000/dashboard/pipeline`

---

### Test Group A: Section Renders

1. Navigate to the Pipeline tab (By Stage — the default)
2. Wait for data to load, scroll below the bar chart

**Verify:**
- [ ] "Stale Pipeline Alerts" section card appears below the chart
- [ ] `AlertTriangle` icon visible in header
- [ ] Summary line: "X of Y records flagged at 30d+"
- [ ] Stage sections visible (at least some of: Qualifying, Discovery, Sales Process, Negotiating)
- [ ] On Hold section appears separately, labeled with "deliberate pause"
- [ ] Badges show correct colors: green (<30d), yellow (30–59d), orange (60–89d), red (90d+)
- [ ] N/A badge for any records without a stage date
- [ ] Qualifying footnote visible if any Qualifying records present

**Ask user:** "Does the Stale Pipeline Alerts section appear with correctly colored aging badges?"

---

### Test Group B: Stage Click → Drill-Down

1. Click on any stage section header (e.g., "Negotiating")

**Verify:**
- [ ] `VolumeDrillDownModal` opens
- [ ] Modal title shows the stage name
- [ ] Records in the modal match those visible in the stale alerts section for that stage
- [ ] Record count is consistent

**Ask user:** "Does clicking a stage open the drill-down modal with the correct records?"

---

### Test Group C: Record Detail → Back

1. From the drill-down modal opened in Test B, click any record row

**Verify:**
- [ ] `RecordDetailModal` opens for that record
- [ ] Back button is present
- [ ] Clicking Back returns to the drill-down modal

**Ask user:** "Does clicking a record open the detail panel, and does Back return to the list?"

---

### Test Group D: Filter Interaction

1. Use PipelineFilters to deselect one stage (e.g., "Discovery"), click Apply
2. Wait for stale alerts to reload

**Verify:**
- [ ] Stale alerts re-fetches (loading skeleton briefly visible)
- [ ] Discovery section disappears from stale alerts
- [ ] On Hold section still appears (fetched independently of selectedStages)

**Ask user:** "Does the stale alerts section update correctly when stage filters change?"

---

### Test Group E: By SGM Tab

1. Switch to the "By SGM" tab (if revops_admin)

**Verify:**
- [ ] Stale Pipeline Alerts section does NOT appear on the By SGM tab
- [ ] Only the By Stage tab shows the section

**Ask user:** "Does the section correctly disappear on the By SGM tab?"

---

### Test Group F: Dark Mode

1. Toggle to dark mode

**Verify:**
- [ ] All badges readable (no invisible text)
- [ ] Stage headers readable
- [ ] Card backgrounds correct

**Ask user:** "Does the section look correct in dark mode?"

---

### Test Group G: Data Accuracy Spot-Check

1. Find a record with a red badge (90d+) in the stale alerts section
2. Click the stage to open the drill-down, then click that record to open the detail modal

**Verify:**
- [ ] The stage in the detail modal matches the stage it was listed under
- [ ] Days in stage is plausible (not zero, not thousands)

**Ask user:** "Do the days-in-stage values look accurate?"

---

## PHASE 6 — VALIDATION GATE

**STOP AND REPORT (after all test groups confirmed):**
- "All 7 UI test groups passed"
- "Stale Pipeline Alerts feature complete and validated"
- "Next: commit changes — remember to write `.ai-session-context.md` first (CLAUDE.md protocol)"

---

## Known Limitations

| Limitation | Rationale |
|---|---|
| Qualifying days = days since opp created | No `Stage_Entered_Qualifying__c` in Salesforce; `Opp_CreatedDate` is the standard proxy used throughout the codebase |
| On Hold always appears in stale alerts | Deliberate pause state, not a stuck deal; shown in distinct section with "deliberate pause" label |
| 5 records (2.9%) show N/A badge | Stage entry date missing from Salesforce for these records |
| Thresholds hardcoded | No admin UI for threshold configuration — consistent with existing codebase pattern; change values in `STALE_PIPELINE_THRESHOLDS` in `constants.ts` |
| Section only on By Stage tab | On Hold records are excluded from `OPEN_PIPELINE_STAGES` so By SGM tab doesn't reflect them; stale alerts is a stage-centric view |

---

## Appendix: Troubleshooting

### Records show `daysInCurrentStage: null` for all records

**Cause:** Wrong API endpoint. `GET /api/dashboard/pipeline-overview` → `getOpenPipelineRecords` hardcodes `null`.

**Fix:** Confirm `fetchStaleRecords` calls `dashboardApi.getPipelineDrilldown()` which hits `POST /api/dashboard/pipeline-drilldown`. Check the network tab in browser devtools — should see `POST /api/dashboard/pipeline-drilldown` calls, NOT `GET /api/dashboard/pipeline-overview`.

### Stale alerts section never appears

**Check 1:** Is `activeTab === 'byStage'`? The section only renders on By Stage tab.

**Check 2:** Is `staleRecords.length === 0` AND `staleLoading === false`? The component returns `null` when both are true. Open browser devtools Network tab — are the pipeline-drilldown POST requests being made?

**Check 3:** Is `sgmOptionsLoading` stuck `true`? The fetch guard `if (sgmOptionsLoading || selectedSgms.length === 0) return;` prevents fetching until SGM options load. Check if SGM options fetch is failing silently.

### On Hold records not appearing

**Check:** `ON_HOLD_STAGE` must be in `stagesToFetch` in `fetchStaleRecords`. Verify: `const stagesToFetch = [...selectedStages, ON_HOLD_STAGE];`

### TypeScript error: `advisorName` not found

The exact advisor display name field may differ. Run:
```bash
grep -n "advisorName\|advisor_name\|fullName\|displayName" src/types/dashboard.ts
```
Update the `StageSection` component's record row to use the correct field name.

### Build error: duplicate import from `@/config/constants`

If there are two `import { ... } from '@/config/constants'` lines, merge them:
```bash
grep -n "from '@/config/constants'" src/app/dashboard/pipeline/page.tsx
```
Use the Edit tool to combine them into one import statement.

### Stage color dot shows grey for a stage

`STAGE_COLORS` in `constants.ts` is keyed by exact Salesforce `StageName` values (case-sensitive). If a stage name doesn't match, the component falls back to `#94a3b8` (grey). The actual stage values confirmed by data-verifier: `Qualifying`, `Discovery`, `Sales Process`, `Negotiating`, `On Hold`.
