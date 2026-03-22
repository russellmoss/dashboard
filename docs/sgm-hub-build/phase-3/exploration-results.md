# SGM Hub Phase 3: Quota Tracking Tab — Exploration Results

> Synthesized from code-inspector, data-verifier, and pattern-finder findings.
> Date: 2026-03-22

---

## 1. Feature Summary

**What:** Quota Tracking tab — the third and final tab of the SGM Hub (`/dashboard/sgm-hub`).

**Two views:**
- **SGM View:** Personal ARR quota tracking — progress bar, pacing badge, historical chart with goal overlay, open opportunities table
- **Admin View:** Team overview with filters, team progress bar, individual SGM breakdown table, editable quarterly quota table

**Scope:**
- Quarter selector + pacing calculation (ARR-based, adapted from SGA SQO pacing)
- Historical Quarterly Progress chart (8 quarters, bar + goal bar overlay, clickable bars → drilldown)
- Open Opportunities table with aging color coding
- Admin: team progress bar, individual SGM breakdown with drilldown, editable quota grid
- Admin: filters (quarter, SGM multi-select, channels, sources, pacing status)
- Prisma `SGMQuarterlyGoal` CRUD (model already migrated)
- Seed quota data for 11 SGMs

---

## 2. BigQuery Status — CRITICAL FLAG

### Actual_ARR__c Data Lag (BLOCKING)

**Actual_ARR__c is 0% populated for Q4 2025 and Q1 2026.** The field appears to be populated by a finance/underwriting reconciliation process that runs 6–9 months after join. Current quarter will show $0 for all SGMs.

| Quarter | Joined | Has Actual_ARR__c | Has Account_Total_ARR__c |
|---------|--------|-------------------|--------------------------|
| 2026-Q1 | 12 | 0 (0%) | 10 (83%) |
| 2025-Q4 | 17 | 0 (0%) | 17 (100%) |
| 2025-Q3 | 14 | 4 (29%) | 14 (100%) |
| 2025-Q2 | 12 | 11 (92%) | 12 (100%) |
| 2025-Q1 | 12 | 11 (92%) | 12 (100%) |
| 2024-Q4 | 13 | 10 (77%) | 12 (92%) |

**The two fields measure different things:**
- `Actual_ARR__c` (Opportunity) = ARR attributed to this specific join event (deal-level, point-in-time)
- `Account_Total_ARR__c` (Account) = advisor's total current ARR across all accounts (grows over time, inflated)

They are NEVER equal — Account_Total_ARR__c averages $337K higher when both are present.

**Recommendation:** Use `COALESCE(Actual_ARR__c, Account_Total_ARR__c)` as the ARR value for quota tracking. This gives deal-level precision when available (older quarters) and falls back to account-level ARR for recent quarters. Display an "(est)" indicator when falling back. **Flag to spec author before building.**

### Field Population Summary

| Field | Population | Notes |
|-------|-----------|-------|
| `Actual_ARR__c` | 0% Q1 2026, 0% Q4 2025, 92% Q2 2025+ | Lagged 6-9 months |
| `Account_Total_ARR__c` | 83-100% all quarters | Available immediately, slightly inflated |
| `SGM_Estimated_ARR__c` | 0% Qualifying/Signed, 49% Sales Process, 57% Negotiating | Pipeline only, never on joined |
| `Opportunity_AUM` | 100% Sales Process/Negotiating, 24% Qualifying | Well-populated mid-funnel+ |
| `CreatedDate` | 92.3% on pipeline records | Use for "Days Open" |
| `Stage_Entered_*` timestamps | 90-100% per stage | See mapping below |

### No View Changes Required

All needed fields already exist in `vw_funnel_master`.

---

## 3. Open Opportunity Definition

**Use exactly these 6 stages (confirmed by data):**
```sql
WHERE StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'On Hold', 'Signed')
```

**Excluded stages with rationale:**
- `Planned Nurture` (595 records): 0 have AUM, 0 have SGM_Estimated_ARR__c, only 2 have SGM assigned. Disqualified/recycled stage.
- `Outreach` (68): Pre-qualifying, no ARR/AUM data
- `Re-Engaged` (23): No ARR/AUM, 0 SGM assignments
- `Call Scheduled` (10), `Engaged` (4): No ARR/AUM data

### Open Pipeline by Stage (current data)

| Stage | Count | Has Est_ARR | Has AUM | Total Est_ARR | Total AUM |
|-------|-------|------------|---------|--------------|-----------|
| Sales Process | 74 | 36 (49%) | 74 (100%) | $22.4M | $9.76B |
| On Hold | 44 | 5 (11%) | 39 (89%) | $2.49M | $2.78B |
| Discovery | 42 | 9 (21%) | 41 (98%) | $10.3M | $10.5B |
| Qualifying | 42 | 0 (0%) | 10 (24%) | $0 | $3.09B |
| Negotiating | 28 | 16 (57%) | 28 (100%) | $12.3M | $2.19B |
| Signed | 3 | 0 (0%) | 3 (100%) | $0 | $551M |

---

## 4. Days in Stage — Field Mapping

**No `Stage_Entered_Qualifying__c` exists in the view.** Use `mql_stage_entered_ts` as proxy (90.5% populated on Qualifying records).

| Stage | Timestamp Field | Population |
|-------|----------------|------------|
| Qualifying | `mql_stage_entered_ts` | 90.5% |
| Discovery | `Stage_Entered_Discovery__c` | 97.6% |
| Sales Process | `Stage_Entered_Sales_Process__c` | 100% |
| Negotiating | `Stage_Entered_Negotiating__c` | 100% |
| On Hold | `Stage_Entered_On_Hold__c` | 97.7% |
| Signed | `Stage_Entered_Signed__c` | 100% |

**Days Open:** Use `DATE_DIFF(CURRENT_DATE(), DATE(CreatedDate), DAY)`. 92.3% populated on pipeline records.

**Warning:** Days open values are very high (avg 207–364 days across stages). Nearly all open pipeline records will render as red (90+ days). This is real data — not a bug.

---

## 5. SGM Email Verification

All 11 spec SGMs confirmed. One active SGM missing from spec.

| Spec Name | Email | Status |
|-----------|-------|--------|
| Bre McDaniel | bre.mcdaniel@savvywealth.com | MATCH |
| Corey Marcello | corey.marcello@savvywealth.com | MATCH |
| Bryan Belville | bryan.belville@savvywealth.com | MATCH |
| Erin Pearson | erin.pearson@savvywealth.com | MATCH |
| Jade Bingham | jade.bingham@savvywealth.com | MATCH |
| Tim Mackey | tim.mackey@savvywealth.com | MATCH |
| Arianna Butler | arianna.butler@savvywealth.com | MATCH |
| Lexi Harrison | lexi.harrison@savvywealth.com | MATCH |
| David Eubanks | david.eubanks@savvywealth.com | MATCH |
| Clayton Kennamer | clayton.kennamer@savvywealth.com | MATCH |
| Lena Allouche | lena.allouche@savvywealth.com | MATCH |
| **GinaRose Galli** | ginarose@savvywealth.com | **NOT IN SPEC** — active SGM, 2 joins Q1 2026 |

**Decision needed:** Add GinaRose Galli to the quota table with initial values, or explicitly exclude.

---

## 6. ARR Pacing Tolerance

**Actual_ARR__c distribution (n=65 joined records with value > 0):**

| Stat | Value |
|------|-------|
| P25 | $130,683 |
| Median | $227,716 |
| P75 | $494,618 |
| Mean | $355,973 |
| Std Dev | $352,649 |

**Context:** Quotas range from $325K (Lexi Q1) to $2M (Bre all quarters). A $1.3M quota represents ~6 joins at median ARR ($228K). Single-deal variance is enormous (std dev ≈ mean).

**Recommended tolerance: ±15% of expected pace.**

| Status | Condition | Rationale |
|--------|-----------|-----------|
| `ahead` | actual > expected × 1.15 | One median deal covers the band for small quotas |
| `on-track` | actual within ±15% of expected | Tight but meaningful — avoids false positive |
| `behind` | actual < expected × 0.85 | Recoverable gap signal |
| `no-goal` | goal is null or 0 | No quota set |

The SGA ±0.5 SQO analogy maps to roughly ±$114K at the $650K quota level. A 15% band at $650K = ±$97.5K — close match.

---

## 7. Historical Chart Depth

Actual_ARR__c data goes back to 2023-Q2 with good coverage from 2024-Q2 onward. **8 quarters back is feasible for the historical chart.** However, the most recent 2 quarters (Q4 2025, Q1 2026) will show $0 unless COALESCE fallback is used.

---

## 8. Code Patterns — Key Findings

### QuarterlyProgressCard.tsx (SGM view template)

**Props:** `{ progress: QuarterlyProgress, onSQOClick?: () => void }`

**Progress bar:** Pure div-based. Container `bg-gray-200 rounded-full h-3`. Inner fill div width% clamped 0–100. Colors:
- `≥ 100%` → `bg-green-500`
- `≥ 75%` → `bg-blue-500`
- `≥ 50%` → `bg-yellow-500`
- `< 50%` → `bg-red-500`

No progress bar renders when `hasGoal` is false.

**Badge:** Tremor `<Badge>` with pacing status:

| Status | Color | Icon | Label |
|--------|-------|------|-------|
| `ahead` | `bg-green-100 text-green-800` | `TrendingUp` | "Ahead by X" |
| `on-track` | `bg-yellow-100 text-yellow-800` | `Minus` | "On Track" |
| `behind` | `bg-red-100 text-red-800` | `TrendingDown` | "Behind by X" |
| `no-goal` | `bg-gray-100 text-gray-800` | `Target` | "No Goal Set" |

### calculateQuarterPacing — Cannot Reuse Directly

**File:** `src/lib/utils/sga-hub-helpers.ts` (line 139)

```ts
calculateQuarterPacing(
  quarter: string,       // "YYYY-QN"
  goal: number | null,
  actual: number,
  totalAum: number,
  formatCurrency: (n: number) => string
): QuarterlyProgress
```

**Why it can't be reused:**
1. Return type `QuarterlyProgress` has SQO-named fields: `sqoGoal`, `sqoActual`, `expectedSqos`
2. Tolerance band is ±0.5 (SQO-denominated, not percentage-based)
3. Label generates "X.X SQOs" strings

**Plan:** Create `calculateARRQuarterPacing()` in a new file or extend `sga-hub-helpers.ts`. Use ±15% tolerance band. Return a new `SGMQuotaProgress` type with ARR-named fields.

### Pacing Logic Inconsistency (3 implementations exist)

| Location | Tolerance | Used By |
|----------|-----------|---------|
| `calculateQuarterPacing` utility | ±0.5 SQO (absolute) | SGA individual view API route |
| `TeamProgressCard` inline | ±10% of expected | SGA admin team progress |
| `AdminQuarterlyProgressView` useMemo | ±10% of expected | SGA admin breakdown table |

Phase 3 should standardize on percentage-based tolerance (±15%) for all ARR pacing. Use the utility function approach (server-side calculation, not inline useMemo).

### Historical Chart (QuarterlyProgressChart.tsx)

- **Recharts:** `BarChart` with two `<Bar>` components (actual + goal). NOT ComposedChart, NOT ReferenceLine.
- **Goal overlay:** Second `<Bar>` at `opacity={0.6}`, conditional on `hasAnyGoal`
- **Clickable bars:** NOT clickable in SGA version (display-only). Phase 3 spec requires clickable bars → drilldown showing joined opportunities. This needs NEW onClick handler.
- **`isAnimationActive={false}`** on all bars (D3 crash fix)

### Stale Pipeline Color Thresholds

From `src/config/constants.ts`:
```ts
STALE_PIPELINE_THRESHOLDS = { warning: 30, stale: 60, critical: 90 }
```

| Tier | Days | Light Mode | Dark Mode |
|------|------|-----------|-----------|
| fresh | < 30 | `bg-green-100 text-green-800` | `dark:bg-green-900/30 dark:text-green-400` |
| warning | 30–59 | `bg-yellow-100 text-yellow-800` | `dark:bg-yellow-900/30 dark:text-yellow-400` |
| stale | 60–89 | `bg-orange-100 text-orange-800` | `dark:bg-orange-900/30 dark:text-orange-400` |
| critical | ≥ 90 | `bg-red-100 text-red-800` | `dark:bg-red-900/30 dark:text-red-400` |

Spec uses slightly different buckets for the Open Opps table: green 0–29, yellow 30–59, orange 60–86, red 90+. This exactly matches `STALE_PIPELINE_THRESHOLDS` (warning=30, stale=60, critical=90) — reuse the same thresholds. The spec's "86" appears to be a typo for "89" (matches the 60–89 stale band).

### SGMHubContent.tsx State Assessment

**Current state (Phase 1 + Phase 2):** 45 useState vars, 847 lines.

**Phase 3 adds ~12 more vars:** `quotaQuarter`, `quotaProgress`, `quotaProgressLoading`, `historicalQuarters`, `historicalLoading`, `openOpps`, `openOppsLoading`, `adminBreakdown`, `adminBreakdownLoading`, `quotas`, `quotasLoading`, `teamProgress`.

**Recommendation:** Extract a `useQuotaTracking()` custom hook to keep the component manageable. The hook encapsulates all Phase 3 state + fetch logic, exposing a clean interface to the render function. This follows the pattern-finder's observation that `AdminQuarterlyProgressView` in the SGA Hub is self-contained with its own state — the admin view component can own its own state too.

### Editable Cell Pattern

From `MetricScorecard.tsx` (canonical pattern):
- Local `editing` + `draft` useState per cell
- Commit on: Enter key or Check icon click (NOT on blur)
- Escape cancels editing
- Parent holds the actual API call via `onGoalChange(value)` prop
- After API success, parent calls full re-fetch (no optimistic update)
- Error: `setSaveError('Failed to save goal')` with red banner

For SGM quotas: `PUT /api/sgm-hub/quota` with body `{ userEmail, quarter, arrGoal }`. Prisma upsert:
```ts
prisma.sGMQuarterlyGoal.upsert({
  where: { userEmail_quarter: { userEmail, quarter } },
  update: { arrGoal, updatedBy: session.user.email },
  create: { userEmail, quarter, arrGoal, createdBy: session.user.email, updatedBy: session.user.email }
})
```

### Admin View Pattern

`AdminQuarterlyProgressView` is fully self-contained — owns its own state (14 useState vars), fetching, and rendering. The parent `SGAHubContent` just does `isAdmin ? <AdminQuarterlyProgressView ... /> : <SGAView ... />`.

**Key composition:**
1. `AdminQuarterlyFilters` — collapsible, apply-on-button, pacing status is CLIENT-SIDE only
2. `TeamProgressCard` — dual progress bar (vs individual aggregate, vs manager goal)
3. `SGABreakdownTable` — per-SGA rows with pacing filter applied client-side
4. `TeamGoalEditor` — inline editable manager goal

Phase 3 admin view should follow the same self-contained pattern: `SGMAdminQuotaView` component with its own state.

### Tab Transition Pattern

From `SGMHubContent.tsx`:
```tsx
{activeTab === 'quota-tracking' && (
  isSGM ? <SGMQuotaTrackingView ... /> : <SGMAdminQuotaView ... />
)}
```

Lazy-load guard:
```ts
useEffect(() => {
  if (activeTab !== 'quota-tracking') return;
  // fetch...
}, [activeTab, quotaQuarter, ...]);
```

---

## 9. Existing API Methods (SGM Hub, Phases 1 + 2)

| Method | Endpoint | Phase |
|--------|----------|-------|
| `getSGMLeaderboard` | `POST /api/sgm-hub/leaderboard` | 1 |
| `getLeaderboardSGMOptions` | `GET /api/sgm-hub/sgm-options` | 1 |
| `getJoinedDrillDown` | `GET /api/sgm-hub/drill-down/joined` | 1 |
| `getSGMDashboardMetrics` | `POST /api/sgm-hub/dashboard-metrics` | 2 |
| `getSGMConversions` | `POST /api/sgm-hub/conversions` | 2 |
| `getSGMConversionTrend` | `POST /api/sgm-hub/conversion-trend` | 2 |

### New Phase 3 API Methods Needed

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `getSGMQuotaProgress` | `GET /api/sgm-hub/quota-progress` | Individual SGM: ARR actual vs quota + pacing |
| `getSGMAdminQuotaProgress` | `GET /api/sgm-hub/admin-quota-progress` | All SGMs: breakdown + team totals |
| `getSGMQuotas` | `GET /api/sgm-hub/quota` | Read all quotas for a year |
| `setSGMQuota` | `PUT /api/sgm-hub/quota` | Upsert a single quota cell |
| `getSGMOpenOpps` | `GET /api/sgm-hub/open-opps` | Open opportunities for an SGM |
| `getSGMHistoricalARR` | `GET /api/sgm-hub/historical-arr` | 8 quarters of ARR + goals |

---

## 10. Files to Create

| File | Source Pattern | Purpose |
|------|---------------|---------|
| `src/components/sgm-hub/SGMQuotaTrackingView.tsx` | `QuarterlyProgressCard` + custom | SGM personal view: progress, chart, open opps |
| `src/components/sgm-hub/SGMAdminQuotaView.tsx` | `AdminQuarterlyProgressView` | Admin self-contained view |
| `src/components/sgm-hub/SGMQuotaFilters.tsx` | `AdminQuarterlyFilters` | Admin filters with pacing status |
| `src/components/sgm-hub/SGMQuotaTable.tsx` | `MetricScorecard` edit pattern | Editable quarterly quota grid |
| `src/components/sgm-hub/SGMOpenOppsTable.tsx` | `StalePipelineAlerts` aging | Open opps with color-coded aging |
| `src/components/sgm-hub/SGMHistoricalARRChart.tsx` | `QuarterlyProgressChart` | Bar chart + goal overlay + clickable bars |
| `src/components/sgm-hub/SGMTeamProgressCard.tsx` | `TeamProgressCard` | Team ARR vs team quota |
| `src/components/sgm-hub/SGMBreakdownTable.tsx` | `SGABreakdownTable` | Per-SGM breakdown with drilldown |
| `src/app/api/sgm-hub/quota/route.ts` | `quarterly-goals/route.ts` | GET/PUT quota CRUD |
| `src/app/api/sgm-hub/quota-progress/route.ts` | `quarterly-progress/route.ts` | Individual SGM pacing |
| `src/app/api/sgm-hub/admin-quota-progress/route.ts` | `admin-quarterly-progress/route.ts` | Admin team overview |
| `src/app/api/sgm-hub/open-opps/route.ts` | New | Open opps for an SGM |
| `src/app/api/sgm-hub/historical-arr/route.ts` | New | 8-quarter historical ARR |
| `src/lib/queries/sgm-quota.ts` | `quarterly-goals.ts` | Prisma CRUD for SGMQuarterlyGoal |
| `src/lib/utils/sgm-pacing.ts` | `sga-hub-helpers.ts` | `calculateARRQuarterPacing()` |

## 11. Files to Modify

| File | Change |
|------|--------|
| `src/app/dashboard/sgm-hub/SGMHubContent.tsx` | Add quota-tracking tab render (conditional SGM/admin view) + minimal state for tab switching |
| `src/types/sgm-hub.ts` | Add `SGMQuotaProgress`, `SGMOpenOpp`, `SGMBreakdownRow`, `SGMHistoricalQuarter` types |
| `src/lib/api-client.ts` | Add 6 new methods (see §9) |
| `src/types/drill-down.ts` | Add `'historical-arr'` metric type for chart drilldown (if using MetricDrillDownModal) |
| `src/components/sga-hub/MetricDrillDownModal.tsx` | Add `historical-arr` column config (or use VolumeDrillDownModal instead) |

---

## 12. Type Definitions Needed

### `src/types/sgm-hub.ts` — New types

```typescript
// ARR pacing result (parallel to QuarterlyProgress but ARR-named)
export interface SGMQuotaProgress {
  quarterLabel: string;
  arrGoal: number | null;
  hasGoal: boolean;
  arrActual: number;
  arrActualFormatted: string;
  totalAumFormatted: string;
  progressPercent: number;
  daysElapsed: number;
  daysInQuarter: number;
  daysRemaining: number;
  expectedArr: number;
  expectedArrFormatted: string;
  pacingDiff: number;
  pacingDiffFormatted: string;
  pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal';
  arrCoverageCount: number;    // n= advisors with ARR data
  arrCoverageTotal: number;    // total joined for this SGM in quarter
  usedFallback: boolean;       // true if COALESCE fell back to Account_Total_ARR__c
}

// Open opportunity row
export interface SGMOpenOpp {
  id: string;
  advisorName: string;
  sgmName: string;
  stageName: string;
  daysOpen: number | null;
  daysInStage: number | null;
  aum: number | null;
  aumFormatted: string;
  estimatedArr: number | null;
  estimatedArrFormatted: string;
  createdDate: string | null;
}

// Admin breakdown row
export interface SGMBreakdownRow {
  sgmName: string;
  openOppsCount: number;
  openOpps90PlusCount: number;
  openAum: number;
  openAumFormatted: string;
  openArr: number;
  openArrFormatted: string;
  arrGoal: number | null;
  arrActual: number;
  progressPercent: number;
  pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal';
}

// Historical quarter data point
export interface SGMHistoricalQuarter {
  quarter: string;        // "2025-Q1"
  quarterLabel: string;   // "Q1 2025"
  arrActual: number;
  arrGoal: number | null;
  joinedCount: number;
  hasGoal: boolean;
}

// Quota table row
export interface SGMQuotaRow {
  sgmName: string;
  userEmail: string;
  q1Goal: number | null;
  q2Goal: number | null;
  q3Goal: number | null;
  q4Goal: number | null;
}

// Admin quota filters
export interface SGMQuotaFilters {
  quarter: string;
  sgmNames: string[];
  channels: string[];
  sources: string[];
  pacingStatuses: string[];
}
```

---

## 13. Recommended Phase Order

### Phase 1: Types + Pacing Utility
1. Add types to `src/types/sgm-hub.ts`
2. Create `src/lib/utils/sgm-pacing.ts` with `calculateARRQuarterPacing()` (±15% tolerance)
3. Create `src/lib/queries/sgm-quota.ts` — Prisma CRUD for SGMQuarterlyGoal
4. **Validation gate:** `npm run build` passes

### Phase 2: API Routes
5. Create `GET/PUT /api/sgm-hub/quota` — quota CRUD
6. Create `GET /api/sgm-hub/quota-progress` — individual SGM pacing
7. Create `GET /api/sgm-hub/admin-quota-progress` — admin team overview
8. Create `GET /api/sgm-hub/open-opps` — open opportunities
9. Create `GET /api/sgm-hub/historical-arr` — 8-quarter history
10. Add 6 methods to `src/lib/api-client.ts`
11. **Validation gate:** `npm run build` passes

### Phase 3: SGM Personal View Components
12. Create `SGMHistoricalARRChart.tsx` — bar chart + goal overlay + clickable bars
13. Create `SGMOpenOppsTable.tsx` — aging color-coded table
14. Create `SGMQuotaTrackingView.tsx` — assembles progress + chart + open opps
15. **Validation gate:** Component renders with mock data

### Phase 4: Admin View Components
16. Create `SGMQuotaFilters.tsx` — admin filters with pacing status
17. Create `SGMTeamProgressCard.tsx` — team ARR vs quota
18. Create `SGMBreakdownTable.tsx` — per-SGM rows with drilldown
19. Create `SGMQuotaTable.tsx` — editable quarterly quota grid
20. Create `SGMAdminQuotaView.tsx` — self-contained admin view
21. **Validation gate:** Admin view renders, editable cells work

### Phase 5: Integration
22. Wire quota-tracking tab in `SGMHubContent.tsx` — add `isAdmin ? <Admin> : <SGM>` conditional
23. Add useEffect for tab activation + lazy-load
24. Wire drilldowns (historical chart bars → VolumeDrillDownModal, open opps → RecordDetailModal, breakdown → VolumeDrillDownModal)
25. **Validation gate:** Full tab works end-to-end

### Phase 6: Seed Data + Polish
26. Seed `SGMQuarterlyGoal` with spec quota values for 11 SGMs (+ GinaRose if decided)
27. Loading states, empty states, error handling
28. **Validation gate:** `npm run build` passes

### Phase 7: Doc Sync
29. `npx agent-guard sync`
30. `npm run gen:api-routes`
31. Write `.ai-session-context.md`
32. **Validation gate:** Build passes, docs up to date

---

## 14. Risks and Blockers

| Severity | Risk | Mitigation |
|----------|------|------------|
| **CRITICAL** | `Actual_ARR__c` is 0% for Q4 2025 + Q1 2026 — quota tracking will show $0 | Use `COALESCE(Actual_ARR__c, Account_Total_ARR__c)` with "(est)" indicator. **Flag to spec author.** |
| **HIGH** | GinaRose Galli is active SGM not in spec quota table | Add with $0 quotas or get spec decision |
| **MEDIUM** | No `Stage_Entered_Qualifying__c` column exists | Use `mql_stage_entered_ts` as proxy (90.5% populated) |
| **MEDIUM** | SGMHubContent.tsx already at 45 useState vars + 847 lines | Admin view self-contained (own state). SGM view needs ~6 vars in parent or also self-contained. |
| **LOW** | SGM_Estimated_ARR__c 0% at Qualifying/Signed stages | Show "—" for NULL values in Open Opps table |
| **LOW** | Most pipeline records are 90+ days old → table will be mostly red | Real data, communicate to stakeholders |
| **INFO** | Historical chart bars not clickable in SGA pattern | Need new onClick handler — straightforward addition |
| **INFO** | Pacing tolerance inconsistency in SGA codebase (±0.5 vs ±10%) | Phase 3 uses ±15% consistently via utility function |

---

## 15. Architectural Decisions

### ARR Value Strategy
Use `COALESCE(Actual_ARR__c, Account_Total_ARR__c)` everywhere ARR is displayed. Track which field was used per record. Display "(est)" suffix when using fallback. This is the pragmatic choice that keeps the current quarter functional.

### Pacing Calculation
Server-side via `calculateARRQuarterPacing()` utility — NOT inline in components. This avoids the SGA Hub's three-implementation inconsistency. The ±15% tolerance is percentage-based and scales with quota size.

### Admin View Architecture
Self-contained `SGMAdminQuotaView` component with own state (mirroring `AdminQuarterlyProgressView` pattern). This avoids bloating `SGMHubContent.tsx` with 12+ more useState vars. The parent just renders `{activeTab === 'quota-tracking' && (isSGM ? <SGMQuotaTrackingView /> : <SGMAdminQuotaView />)}`.

### Drilldown Strategy
- Historical chart bars → `VolumeDrillDownModal` (System 1) — already wired for Dashboard tab
- Admin breakdown "Open Opps" / "90+ days" clicks → `VolumeDrillDownModal` (System 1) — state vars already exist
- Open Opps table row click → `RecordDetailModal` directly (no list modal intermediate)

### Editable Quota Table
Follow `MetricScorecard` pattern: Enter/Check to save, Escape to cancel, no blur-save. Parent calls API, re-fetches on success. Role gate: `admin | manager | revops_admin` in both UI and API.
