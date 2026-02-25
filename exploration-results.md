# Exploration Results: Stale Pipeline Alerts

**Date:** 2026-02-25
**Feature:** Stale Pipeline Alerts section on Pipeline tab
**Status:** Ready to implement — no blockers

---

## 1. Feature Summary

Add a **Stale Pipeline Alerts** card section to the Pipeline tab (By Stage view) that:
- Groups all open pipeline `DetailRecord`s by `record.stage` client-side
- Shows per-stage aging summaries (count flagged at configurable thresholds)
- Displays aging badges per record: green (<30d), yellow (30–60d), orange (60–90d), red (90d+)
- Clicking a stage group opens `VolumeDrillDownModal` pre-filtered to stale records in that stage
- Clicking a record in the modal opens `RecordDetailModal` (existing behavior, no changes)

**Data source:** `daysInCurrentStage` already exists on `DetailRecord` and is fully populated by
`POST /api/dashboard/pipeline-drilldown`. No new fields, no new API routes, no BigQuery changes.

**On Hold consideration:** On Hold records average 173 days (deliberate pause state). Recommend
displaying them in a visually distinct sub-section with a note, or a separate "On Hold Aging" row.

---

## 2. BigQuery Status

| Check | Result |
|---|---|
| `daysInCurrentStage` in BigQuery | ❌ Not a BQ column — calculated at app layer |
| Stage entry dates in `vw_funnel_master` | ✅ All 6 stage dates present |
| `StageName` population (open pipeline) | ✅ 173/173 (100%) |
| `daysInCurrentStage` calculable | ✅ 168/173 (97.1%) — 5 NULLs (4 Discovery, 1 On Hold) |
| View changes needed | ✅ None |
| New BQ view needed | ✅ None |

**Open pipeline = 173 records** (is_sqo=1, is_joined=0, StageName not Closed/Signed/Joined):

| Stage | Count | Avg Days | @30d flagged | @60d flagged | @90d flagged |
|---|---|---|---|---|---|
| Sales Process | 56 | 49.8d | 27 (48%) | 16 (29%) | 10 (18%) |
| On Hold | 54 | **173.3d** | 48 (89%) | 42 (78%) | 37 (69%) |
| Discovery | 38 | 27.3d | 14 (37%) | 5 (13%) | 0 (0%) |
| Negotiating | 19 | 69.8d | 15 (79%) | 9 (47%) | 5 (26%) |
| Qualifying | 6 | 74.8d | 3 (50%) | 2 (33%) | 2 (33%) |

**61.8% of open pipeline is flagged at 30-day threshold** — feature will surface meaningful data.

---

## 3. Files to Modify

### New Files (1)
| File | Purpose |
|---|---|
| `src/components/dashboard/StalePipelineAlerts.tsx` | New UI component — groups records by stage, aging badges, stage click handler |

### Modified Files (2)
| File | Change |
|---|---|
| `src/app/dashboard/pipeline/page.tsx` | Add fetch logic (new state + useEffect), render `<StalePipelineAlerts>` after line 523 |
| `src/config/constants.ts` | Add `STALE_PIPELINE_THRESHOLDS` constant |

### No Changes Needed
| File | Why Not Changed |
|---|---|
| `src/types/dashboard.ts` | `DetailRecord.daysInCurrentStage` already exists (line 158) |
| `src/types/drill-down.ts` | `DrillDownRecordBase.daysInCurrentStage` already exists (line 21) |
| `src/lib/queries/open-pipeline.ts` | `_getOpenPipelineRecordsByStage` already calculates `daysInCurrentStage` |
| `src/app/api/dashboard/pipeline-drilldown/route.ts` | Already returns `daysInCurrentStage` populated |
| Any other API routes | No new routes needed |
| Any BQ query functions | No new fields, no SELECT changes |

---

## 4. Type Changes

**None required.** Both relevant types already have `daysInCurrentStage`:

```typescript
// src/types/dashboard.ts line 158
daysInCurrentStage: number | null;  // days since entering current stage

// src/types/drill-down.ts line 21
daysInCurrentStage: number | null;
```

---

## 5. Construction Site Inventory

All 6 `DetailRecord` construction sites documented. **No changes needed to any of them.**

| Site | File | Line | `daysInCurrentStage` | Status |
|---|---|---|---|---|
| `_getOpenPipelineRecordsByStage` | `open-pipeline.ts` | 403 | `calculateDaysInStage(...)` | ✅ Correct — use this |
| `_getOpenPipelineRecordsBySgm` | `open-pipeline.ts` | 690 | `calculateDaysInStage(...)` | ✅ Correct |
| `_getSgmConversionDrilldownRecords` | `open-pipeline.ts` | 998 | `calculateDaysInStage(...)` | ✅ Correct |
| `_getDetailRecords` | `detail-records.ts` | 372 | `calculateDaysInStage(...)` | ✅ Correct |
| `getOpenPipelineRecords` | `open-pipeline.ts` | 144 | `null` (hardcoded) | ⚠️ Bug (see §7) — NOT used by this feature |
| `ExploreResults.tsx` (inline) | `ExploreResults.tsx` | 937 | `null` (intentional) | ✅ Intentional — AI lacks stage dates |

> **Key rule:** Use `POST /api/dashboard/pipeline-drilldown` (backed by `_getOpenPipelineRecordsByStage`).
> Do NOT use `GET /api/dashboard/pipeline-overview` (backed by the buggy `getOpenPipelineRecords`).

---

## 6. Recommended Phase Order

### Phase 1 — Constants (5 min)
Add to `src/config/constants.ts`:
```typescript
export const STALE_PIPELINE_THRESHOLDS = {
  fresh: 30,      // < 30d → green
  warning: 60,    // 30–59d → yellow
  stale: 90,      // 60–89d → orange
  // >= 90d → red
} as const;
```
Also export `ON_HOLD_STAGE = 'On Hold'` if not already there (check line 6 area).

### Phase 2 — StalePipelineAlerts Component
Create `src/components/dashboard/StalePipelineAlerts.tsx`:

**Props:**
```typescript
interface StalePipelineAlertsProps {
  records: DetailRecord[];
  loading: boolean;
  onStageClick: (stage: string, records: DetailRecord[]) => void;
}
```

**Component logic:**
1. Group `records` by `record.stage` client-side using `useMemo`
2. For each stage group: count records by tier (<30/30-60/60-90/90+/null)
3. Render a card per stage with a summary row + per-record aging badges
4. On Hold gets a visual distinction (muted color, note: "Deliberate pause state")
5. Stage header click → `onStageClick(stage, stageRecords)` → opens `VolumeDrillDownModal`
6. Use `getStatusColor()` from `src/lib/utils/freshness-helpers.ts` for tier colors
7. Use `getStageBadgeClasses()` from `RecordDetailModal.tsx` pattern for stage chips
8. Badge pattern: `px-2.5 py-1 text-xs font-semibold rounded-full`
9. Section wrapper: `<Card className="mb-6">`

**Aging badge helper (define inside or in freshness-helpers.ts):**
```typescript
function getAgingBadgeStyle(days: number | null): string {
  if (days === null) return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
  if (days < 30)  return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
  if (days < 60)  return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
  if (days < 90)  return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
}
```

### Phase 3 — Pipeline Page Wiring
Modify `src/app/dashboard/pipeline/page.tsx`:

**New state (near existing drill-down state ~line 77):**
```typescript
const [staleRecords, setStaleRecords] = useState<DetailRecord[]>([]);
const [staleLoading, setStaleLoading] = useState(false);
```

**New fetch logic (follow `handleAumClick` pattern at lines 202–240):**
- On mount and when `selectedStages` / `selectedSgms` changes, fetch all open pipeline stages via `dashboardApi.getPipelineDrilldown()`
- Parallel fetch per stage (use `Promise.all`), deduplicate by `record.id`
- Use `OPEN_PIPELINE_STAGES` from constants; respect `selectedStages` filter

**Stage click handler:**
```typescript
const handleStaleStageClick = (stage: string, records: DetailRecord[]) => {
  setDrillDownRecords(records);
  setDrillDownStage(stage);
  setDrillDownOpen(true);
};
```

**Render (insert after line 523, inside `activeTab === 'byStage'` block):**
```tsx
<StalePipelineAlerts
  records={staleRecords}
  loading={staleLoading}
  onStageClick={handleStaleStageClick}
/>
```

### Phase 4 — Validation Gates
- `npm run build` must pass with zero errors
- Open Pipeline tab → By Stage → stale alerts section appears
- Stage click opens `VolumeDrillDownModal` with correct filtered records
- Record row click opens `RecordDetailModal`
- On Hold records show distinct visual treatment
- NULL `daysInCurrentStage` records show "N/A" without crashing
- `selectedStages` filter properly scopes which stages appear

### Phase 5 — Doc Sync
```bash
npx agent-guard sync
```

---

## 7. Risks and Blockers

### No Blockers
This feature is UI-only. All data is already available and flowing correctly.

### Risks to Handle

| Risk | Severity | Mitigation |
|---|---|---|
| **On Hold = deliberate pause** (avg 173d) | Medium | Show in separate sub-section with label "Intentional Hold"; still display aging for visibility |
| **5 NULL `daysInCurrentStage` records** (2.9%) | Low | Show "N/A" badge, sort to bottom of each group |
| **Qualifying uses `Opp_CreatedDate` proxy** | Low | Add tooltip/footnote: "Days since opportunity created (no stage entry date)" |
| **61.8% flagged at 30d** — high volume | Low | Default display threshold to 60d with toggle; show all stages regardless |
| **CRITICAL BUG (unrelated)**: `getOpenPipelineRecords` hardcodes `daysInCurrentStage: null` | Low for this feature | Do NOT use that function; log as a separate tech debt item |

### Side Fix Opportunity (optional, not required for this feature)
`src/lib/queries/open-pipeline.ts` line 144 (`getOpenPipelineRecords`): hardcodes `daysInCurrentStage: null`
and omits all stage-entry date columns from its SELECT. This affects `GET /api/dashboard/pipeline-overview`.
This is a separate bug that could be fixed independently — not blocking this feature.

---

## 8. Documentation

- After code changes pass build and UI validation, run: `npx agent-guard sync`
- Implementation guide must include a Phase 5 doc sync step
- `docs/_generated/` files are auto-maintained — do not edit manually
- The pre-commit hook runs generators automatically

---

## Key File Reference

| Purpose | File | Line(s) |
|---|---|---|
| `DetailRecord` type | `src/types/dashboard.ts` | 130–175 |
| `daysInCurrentStage` on `DetailRecord` | `src/types/dashboard.ts` | 158 |
| `calculateDaysInStage()` | `src/lib/utils/date-helpers.ts` | 261–319 |
| `getStatusColor()` (4-tier badge colors) | `src/lib/utils/freshness-helpers.ts` | 55–92 |
| `getStageBadgeClasses()` pattern | `src/components/dashboard/RecordDetailModal.tsx` | 157–173 |
| `OPEN_PIPELINE_STAGES`, `STAGE_COLORS` | `src/config/constants.ts` | 6, 23–31 |
| `OPPORTUNITY_STAGE_COLORS` (Tailwind) | `src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx` | 76–87 |
| Pipeline page insert point | `src/app/dashboard/pipeline/page.tsx` | after 523 |
| `handleAumClick` fetch pattern | `src/app/dashboard/pipeline/page.tsx` | 202–240 |
| Drill-down state vars | `src/app/dashboard/pipeline/page.tsx` | 77–84 |
| `VolumeDrillDownModal` | `src/components/dashboard/VolumeDrillDownModal.tsx` | — |
| `dashboardApi.getPipelineDrilldown()` | `src/lib/api-client.ts` | 357 |
| `_getOpenPipelineRecordsByStage` (correct fn) | `src/lib/queries/open-pipeline.ts` | 262+ |
| `getOpenPipelineRecords` (BUG — avoid) | `src/lib/queries/open-pipeline.ts` | 162 |
