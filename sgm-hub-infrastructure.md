# SGM Hub Infrastructure Investigation

> Reference document for all SGM Hub build phases.
> Traces exact patterns from the SGA Hub, Funnel Performance, and Open Pipeline pages.

---

## 1. Tab Routing Pattern

**Pattern:** Single route, client-side tab state via `useState`. No nested routes.

**SGA Hub files:**
- `src/app/dashboard/sga-hub/page.tsx` — Server component. Auth gate + renders `<SGAHubContent />`
- `src/app/dashboard/sga-hub/SGAHubContent.tsx` — `'use client'`. Owns all state, data fetching, and tab rendering

**Tab state:**
```tsx
const [activeTab, setActiveTab] = useState<SGAHubTab>('leaderboard');
```
No URL params, no Zustand, no context. Pure `useState`.

**Tab bar component:** `src/components/sga-hub/SGAHubTabs.tsx`
- Exports type `SGAHubTab = 'leaderboard' | 'weekly-goals' | 'closed-lost' | 'quarterly-progress' | 'activity'`
- Renders `<button>` row; active tab gets `border-blue-600` bottom border
- Props: `{ activeTab, onTabChange }`

**Tab content rendering:** Conditional blocks in `SGAHubContent.tsx`:
```tsx
{activeTab === 'leaderboard' && ( <LeaderboardFilters ... /> <LeaderboardTable ... /> )}
{activeTab === 'weekly-goals' && ( isAdmin ? <AdminGoalsRollupView /> : <WeeklyGoalsVsActuals /> )}
// ... etc
```

**Data fetching:** `useEffect` watches `activeTab` + filter state → calls fetch function for current tab. Lazy-loads per tab.

### SGM Hub plan
Create the same pattern:
- `src/app/dashboard/sgm-hub/page.tsx` — server component, auth gate
- `src/app/dashboard/sgm-hub/SGMHubContent.tsx` — client component, all state
- `src/components/sgm-hub/SGMHubTabs.tsx` — tab bar with 3 tabs: `'leaderboard' | 'dashboard' | 'quota-tracking'`

---

## 2. Shared Filter State Management

**Pattern:** All filter state lives in `useState` inside the main content component. No context, no Zustand, no URL params. Filter components hold local pending state and commit via `onApply` callback.

### SGA Hub filters (all in `src/components/sga-hub/`)

| Component | Tab | Filters |
|---|---|---|
| `LeaderboardFilters.tsx` | Leaderboard | Quarter, channels (multi), sources (multi+search), SGAs (multi+search) |
| `AdminQuarterlyFilters.tsx` | Quarterly Progress (admin) | Year, quarter, channels, sources, SGAs, pacing status |
| `ClosedLostFilters.tsx` | Closed Lost | SGA name, days bucket, reason (derived client-side) |
| `ReEngagementFilters.tsx` | Re-Engagement | SGA name, opp stage (derived client-side) |

### Funnel Performance filters (in `src/components/dashboard/`)

| Component | Used on | Filters |
|---|---|---|
| `GlobalFilters.tsx` | Funnel Performance only | Date preset, year, channel (single), source (single), SGA (single), SGM (single), experimentation tag, campaign |
| `AdvancedFilters.tsx` | Funnel Performance only | Slide-out panel with multi-select for channels, sources, SGAs, SGMs, campaigns, lead score tiers, date range filters |

### Filter options source
- `GET /api/dashboard/filters` → returns `FilterOptions` type (`src/types/filters.ts` line 132)
- SGA-specific options: `GET /api/sga-hub/leaderboard-sga-options` → queries `SavvyGTMData.User` where `IsSGA__c = TRUE`

### Flow pattern
1. Filter component holds local state for pending changes
2. Tracks `hasPendingChanges` by comparing local vs props
3. "Apply Filters" commits → calls `onApply(filters)` → parent updates `useState`
4. Parent's `useEffect` dependency array includes filter state → triggers fetch
5. Drilldowns receive active filters directly (e.g., leaderboard channels forwarded to SQO drilldown)

### Key insight: SGA Hub and Funnel Performance share NO filter components
They share only the `FilterOptions` type and the `/api/dashboard/filters` endpoint. All UI components are independent.

### SGM Hub plan
- **Leaderboard tab:** Create `SGMLeaderboardFilters.tsx` — mirror `LeaderboardFilters.tsx` but swap SGA multi-select for SGM multi-select, default all channels selected
- **Dashboard tab:** Create `SGMDashboardFilters.tsx` — mirror `GlobalFilters` + `AdvancedFilters` pattern. Needs date range, channels (multi), sources (multi), SGM selector. No experimentation tag. SGM user defaults to self.
- **Quota Tracking tab:** Admin view gets `SGMQuotaFilters.tsx`; SGM view has no filters (own data only)
- **Filter options:** Reuse existing `/api/dashboard/filters` endpoint. Need new `GET /api/sgm-hub/sgm-options` for SGM name list (query `SavvyGTMData.User` where role/field indicates SGM)

---

## 3. User Type Gating

### How role flows
1. **Source:** `User.role` in Prisma (string column, default `"viewer"`)
2. **Type:** `UserRole = 'admin' | 'manager' | 'sgm' | 'sga' | 'viewer' | 'recruiter' | 'revops_admin' | 'capital_partner'` (`src/types/user.ts`)
3. **JWT:** At sign-in, `src/lib/auth.ts` writes `role` + `externalAgency` into JWT token (single DB query)
4. **Session:** On every request, `getPermissionsFromToken(tokenData)` in `src/lib/permissions.ts` derives `UserPermissions`:
   - `sgaFilter = tokenData.name` if role is `sga`, else `null`
   - `sgmFilter = tokenData.name` if role is `sgm`, else `null`
5. **Components:** `useSession()` → `getSessionPermissions(session)` → `permissions.role`, `permissions.sgmFilter`

### SGA Hub gating pattern

**Page-level gate** (`src/app/dashboard/sga-hub/page.tsx` line 23):
```tsx
if (!['admin', 'manager', 'sga', 'sgm', 'revops_admin'].includes(permissions.role)) {
  redirect('/dashboard');
}
```

**Primary branching variable** (`SGAHubContent.tsx` line 39):
```tsx
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';
```
Note: `sgm` is NOT included in `isAdmin` — SGMs get the individual (own-data) view.

**Per-tab rendering:**
| Tab | Admin path | Non-admin path |
|---|---|---|
| Weekly Goals | `AdminGoalsRollupView` (all SGAs) | `WeeklyGoalsVsActuals` (own data) |
| Quarterly Progress | `AdminQuarterlyProgressView` (team totals + breakdown) | `QuarterlyProgressCard` (own quarter) |
| Leaderboard | Same for all | Same for all |
| Closed Lost | `showAllRecords=true` | Toggle available |

**API enforcement:** Routes independently check role. Example: `/api/sga-hub/quarterly-progress` returns 403 if non-admin tries to view another user's data.

### SGM Hub plan
**Page-level gate:** Allow `admin`, `manager`, `sgm`, `revops_admin`. (No `sga`, no `viewer`)

**Primary branching:**
```tsx
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';
const isSGM = permissions?.role === 'sgm';
```

**Per-tab defaults:**
| Tab | SGM user | Admin/RevOps |
|---|---|---|
| Leaderboard | All SGMs visible, all channels default | Same |
| Dashboard | `sgmFilter` auto-applied (own data), can change | No filter default (all SGMs) |
| Quota Tracking | Own data only, no filter UI | Global view with SGM/channel/pacing filters |

**API routes:** Each SGM Hub API route must check role and enforce `sgmFilter` for SGM users.

---

## 4. Leaderboard Component

### SGA Leaderboard data flow
```
vw_funnel_master + SavvyGTMData.User
  → _getSGALeaderboard() [src/lib/queries/sga-leaderboard.ts]
    → POST /api/sga-hub/leaderboard [src/app/api/sga-hub/leaderboard/route.ts]
      → dashboardApi.getSGALeaderboard() [src/lib/api-client.ts:635]
        → fetchLeaderboard() in SGAHubContent.tsx
          → <LeaderboardTable entries={...} />
```

### Component: `src/components/sga-hub/LeaderboardTable.tsx`
- Props: `{ entries: LeaderboardEntry[], isLoading?, onSQOClick?, currentUserSgaName? }`
- Columns: Rank, SGA Name, SQOs (clickable)
- Top 3 get medal emoji + color-coded backgrounds
- Current user's row gets blue left border + "You" badge
- Ranking: done in TypeScript via `calculateRanks()` — ties share rank, no skip

### BigQuery query (`src/lib/queries/sga-leaderboard.ts`)
- CTE `ActiveSGAs`: from `SavvyGTMData.User` where `IsSGA__c = TRUE AND IsActive = TRUE`
- CTE `SQOData`: from `vw_funnel_master` where `is_sqo_unique = 1`, `recordtypeid = @recruitingRecordType`, date range, channels, sources
- LEFT JOIN → COUNT DISTINCT → ORDER BY sqo_count DESC
- SGA name resolution: `COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)`

### Drilldown from leaderboard
Click SQO count → `handleLeaderboardSQOClick(sgaName)` → `dashboardApi.getSQODrillDown(sgaName, ...)` → `MetricDrillDownModal` opens

### SGM Hub plan
Create `src/components/sgm-hub/SGMLeaderboardTable.tsx` — mirror `LeaderboardTable` but:
- Columns: Rank, SGM Name, # Joined (clickable), Joined AUM (clickable)
- Ranked by Joined AUM (not count)
- Click # Joined or Joined AUM → drilldown showing joined advisors with details
- All channels selected by default (unlike SGA which defaults to 3 outbound channels)
- SGM multi-select instead of SGA

Query: group by `SGM_Owner_Name__c` from `vw_funnel_master` where `is_joined_unique = 1`, sum `Opportunity_AUM`, count joined.

---

## 5. Drilldown Modal Pattern

### Two parallel drilldown systems exist

**System 1 — Main Dashboard:** `DetailRecord` → `VolumeDrillDownModal` → `DetailRecordsTable` → `RecordDetailModal`
- Used by: Funnel Performance scorecards, volume charts, pipeline drilldowns
- API: `POST /api/dashboard/detail-records`
- Type: `DetailRecord` (`src/types/dashboard.ts` line 130)

**System 2 — SGA Hub:** `DrillDownRecord` → `MetricDrillDownModal` → `RecordDetailModal`
- Used by: SGA Hub weekly goals, quarterly progress, leaderboard
- API: `GET /api/sga-hub/drill-down/{metric}` (7 metric-specific routes)
- Type: `DrillDownRecord` union (`src/types/drill-down.ts` line 96)
- Column configs per metric type in `MetricDrillDownModal`

**Both converge on:** `RecordDetailModal` (`src/components/dashboard/RecordDetailModal.tsx`)
- Fetches: `GET /api/dashboard/record-detail/[id]`
- Query: `src/lib/queries/record-detail.ts` — single record from `vw_funnel_master`
- Type: `RecordDetailFull` (`src/types/record-detail.ts` line 35)
- No dedicated detail page — always a modal with z-index layering
- Back button: closes detail modal, reopens list modal (records still in state)

### Pipeline-specific drilldowns
- `POST /api/dashboard/pipeline-drilldown` → `getOpenPipelineRecordsByStage` → `DetailRecord[]`
- `POST /api/dashboard/pipeline-drilldown-sgm` → `getOpenPipelineRecordsBySgm` → `DetailRecord[]`
- `POST /api/dashboard/sgm-conversion-drilldown` → `getSgmConversionDrilldownRecords` → `DetailRecord[]` (revops_admin only)

### Full click chain
1. Click metric value in scorecard/chart/table
2. Parent sets `drillDownOpen=true`, `drillDownLoading=true`, calls API
3. API returns records → stored in state → passed to modal
4. Modal renders table with metric-specific columns
5. Click row → `onRecordClick(id)` → close list modal → open `RecordDetailModal`
6. `RecordDetailModal` fetches full record via `/api/dashboard/record-detail/[id]`
7. Back button reopens list modal (records still in memory)

### SGM Hub plan
Reuse `MetricDrillDownModal` for leaderboard drilldowns (add `'joined'` and `'joined-aum'` metric types to `DrillDownRecord` union if needed). Reuse `VolumeDrillDownModal` for dashboard tab drilldowns (scorecards, pipeline chart, volume charts). Reuse `RecordDetailModal` as-is.

New drilldown API routes needed:
- `GET /api/sgm-hub/drill-down/joined` — joined advisors for an SGM
- `POST /api/sgm-hub/drill-down/pipeline` — open pipeline records for an SGM (or reuse existing pipeline-drilldown-sgm)

---

## 6. Scorecard Pattern

### Funnel Performance Focused View scorecards

**Components:**
- `src/components/dashboard/Scorecards.tsx` — SQLs, SQOs, Signed, Signed AUM, Joined, Joined AUM, Open Pipeline AUM
- `src/components/dashboard/FullFunnelScorecards.tsx` — Prospects, Contacted, MQLs (full funnel only)

**Data flow:** Scorecards are purely display components — no internal fetching.
```
DashboardPage.fetchDashboardData()
  → dashboardApi.getFunnelMetrics(filters, viewMode)
    → POST /api/dashboard/funnel-metrics
      → metrics: FunnelMetricsWithGoals stored in state
        → <Scorecards metrics={metrics} /> (props only)
```

**Types:**
- `FunnelMetrics` (`src/types/dashboard.ts` line 7): sqls, sqos, signed, signedAum, joined, joinedAum, openPipelineAum, disposition sub-counts
- `FunnelMetricsWithGoals` (line 52): extends with `goals: ForecastGoals | null`
- `ForecastGoals` (line 34): prospects, mqls, sqls, sqos, joined

**Loading:** Parent holds single `loading: boolean`. Shows `<LoadingSpinner />` while loading. `FullFunnelScorecards` also accepts `loading` prop and renders `'...'` placeholder.

**Click → drilldown:** Each card has `onClick={() => onMetricClick?.('sql')}` etc. Parent `handleMetricClick` calls `dashboardApi.getDetailRecords(drillDownFilters, 50000)` and opens `VolumeDrillDownModal`.

**Disposition toggles:** `DispositionToggle` component on SQLs/SQOs/MQLs cards — switches between all/open/lost/converted sub-counts. State held in parent.

**View mode toggle:** `ViewModeToggle` (`src/components/dashboard/ViewModeToggle.tsx`) — `'focused' | 'fullFunnel'`. Switching clears full-funnel-only metric selections.

### Open Pipeline components

**Pipeline by Stage chart:** `src/components/dashboard/PipelineByStageChart.tsx`
- Props: `{ data: OpenPipelineByStage[], onBarClick, loading? }`
- Dual-axis Recharts BarChart (AUM left axis, count right axis)
- Click bar → `onBarClick(stage, 'aum' | 'count')` → pipeline drilldown fetch

**Pipeline filters:** `src/components/dashboard/PipelineFilters.tsx`
- Stage multi-select + SGM owner multi-select
- Default stages: Qualifying, Discovery, Sales Process, Negotiating, Signed, On Hold, Planned Nurture
- Apply button triggers refetch

**SGM Conversion & Velocity table:** `src/components/dashboard/SgmConversionTable.tsx`
- Props: `{ data: SgmConversionData[], loading?, onMetricClick? }`
- Columns: SGM, SQLs, SQL→SQO%, SQOs, SQO→Joined%, Joined — all sortable
- Pinned "Team Average" row
- Click metric cells → `onMetricClick(sgm, metric)` → drilldown
- Data type: `SgmConversionData` (`src/types/dashboard.ts` line 261)
- Query: `getSgmConversionData` in `src/lib/queries/open-pipeline.ts` (line 764+)
- Currently **revops_admin only** (gated in PipelinePage)

**Stale Pipeline Alerts:** `src/components/dashboard/StalePipelineAlerts.tsx`
- Props: `{ records: DetailRecord[], loading, onStageClick, onRecordClick }`
- Groups records by stage, shows aging badges (fresh/warning/stale/critical)
- Thresholds: `STALE_PIPELINE_THRESHOLDS` in `src/config/constants.ts`
- Data: parent fetches all selected stages serially via `getPipelineDrilldown`, deduplicates, passes records

### SGM Hub Dashboard tab plan
- Reuse `Scorecards` pattern (props-only display) for SQLs, SQOs, Signed, Joined, Joined AUM, Open Pipeline AUM
- Add 3 new scorecard values: Joined ARR (actual), Estimated ARR, Est:Actual ARR ratio — requires new query fields
- Reuse `PipelineByStageChart` as-is (remove SGM filter since global filters handle it)
- Reuse `SgmConversionTable` as-is (currently revops_admin only — need to expose to SGM role too). Add `SQO→Joined (days)` column.
- Reuse `StalePipelineAlerts` as-is
- New volume/conversion trend charts: quarterly cohorted only (no monthly, no periodic). Quarter count selector (default 4, max 8).

---

## 7. vw_funnel_master Gap Analysis

### Available today (no view changes needed)

| Field/Capability | Source |
|---|---|
| SGM identity | `SGM_Owner_Name__c` (aliased from `Opportunity_Owner_Name__c`) |
| SQL→SQO conversion | `sql_to_sqo_progression`, `eligible_for_sql_conversions` |
| SQO→Joined conversion | `is_joined_unique`, `is_sqo_unique`, `StageName` |
| Joined count/AUM | `is_joined_unique`, `Opportunity_AUM` |
| Open pipeline by stage | `StageName`, `Opportunity_AUM`, stage entry dates |
| Stale pipeline aging | Stage entry timestamps (Discovery, Sales Process, Negotiating, Signed, On Hold) |
| All scorecard metrics (SQLs, SQOs, Signed, Joined, AUM) | Existing funnel flags |

### Requires vw_funnel_master update

| Field | Raw source | Why needed |
|---|---|---|
| `Actual_ARR__c` | `SavvyGTMData.Opportunity` (FLOAT64) | Quota Tracking: actual ARR per quarter |
| `SGM_Estimated_ARR__c` | `SavvyGTMData.Opportunity` (FLOAT64) | Dashboard: Estimated ARR scorecard, Open Opps table |
| `Account_Total_ARR__c` | `SavvyGTMData.Account` (FLOAT64) | Dashboard: Joined ARR (actual) scorecard |
| `Stage_Entered_Joined__c` | `SavvyGTMData.Opportunity` (TIMESTAMP) | Dashboard: SQO→Joined velocity (days) |

### View modification needed
Add to the opportunity CTE in `vw_funnel_master.sql`:
```sql
-- In the opportunity subquery (around line 175-200):
Actual_ARR__c,
SGM_Estimated_ARR__c,
Stage_Entered_Joined__c,

-- For Account_Total_ARR__c, need a new JOIN:
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.Account` a
  ON o.AccountId = a.Id
-- Then select:
a.Account_Total_ARR__c,
```

### Prisma model needed
New `SGMQuarterlyGoal` model (mirrors `QuarterlyGoal` but for SGM ARR quotas):
```prisma
model SGMQuarterlyGoal {
  id        String   @id @default(cuid())
  userEmail String
  quarter   String   // "2026-Q1"
  arrGoal   Float    @default(0)  // ARR quota in dollars
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdBy String?
  updatedBy String?

  @@unique([userEmail, quarter])
  @@index([userEmail])
  @@index([quarter])
}
```

---

## 8. New Files Needed

### Route / Page files
```
src/app/dashboard/sgm-hub/
  page.tsx                    # Server component, auth gate
  SGMHubContent.tsx           # Client component, all state + tab rendering
```

### Components (`src/components/sgm-hub/`)
```
SGMHubTabs.tsx                # Tab bar (leaderboard | dashboard | quota-tracking)
SGMLeaderboardTable.tsx       # Ranked table: SGM, #Joined, Joined AUM
SGMLeaderboardFilters.tsx     # Quarter, channels, sources, SGMs multi-select
SGMDashboardFilters.tsx       # Date range, channels, sources, SGM selector + advanced
SGMDashboardScorecards.tsx    # SQLs, SQOs, Joined, Joined AUM + ARR cards
SGMConversionCharts.tsx       # Quarterly cohorted conversion rates + volumes
SGMQuarterSelector.tsx        # "Show N quarters" selector for trend charts
SGMQuotaTrackingView.tsx      # SGM-user view: gauge, pacing, historical chart, open opps
SGMAdminQuotaView.tsx         # Admin view: team progress, individual breakdown, quota editor
SGMQuotaTable.tsx             # Editable quarterly quota grid (admin only)
SGMOpenOppsTable.tsx           # Open opportunities list with aging colors
```

### API Routes (`src/app/api/sgm-hub/`)
```
leaderboard/route.ts          # POST: SGM joined leaderboard
sgm-options/route.ts          # GET: SGM name list for filters
drill-down/joined/route.ts    # GET: Joined advisor drilldown for an SGM
quota/route.ts                # GET/PUT: SGM quarterly quotas (Prisma)
quota-progress/route.ts       # GET: SGM quota vs actual ARR
admin-quota-progress/route.ts # GET: All SGMs quota overview (admin only)
dashboard-metrics/route.ts    # POST: SGM dashboard scorecards + ARR metrics
conversion-trends/route.ts    # POST: Quarterly cohorted conversion data
open-opps/route.ts            # GET: Open opportunities for an SGM
```

### Query functions (`src/lib/queries/`)
```
sgm-leaderboard.ts            # Joined leaderboard query
sgm-dashboard.ts              # Dashboard metrics + ARR queries
sgm-quota.ts                  # Quota progress queries
```

### Types (`src/types/`)
```
sgm-hub.ts                    # SGMLeaderboardEntry, SGMDashboardMetrics, SGMQuotaProgress, etc.
```

### Prisma
```
prisma/schema.prisma           # Add SGMQuarterlyGoal model
```

---

## 9. Reusability Assessment

### Can reuse as-is
| Component | Where used in SGM Hub |
|---|---|
| `RecordDetailModal` | All drilldowns → record detail |
| `VolumeDrillDownModal` + `DetailRecordsTable` | Dashboard tab scorecard/chart drilldowns |
| `PipelineByStageChart` | Dashboard tab pipeline chart |
| `SgmConversionTable` | Dashboard tab (add SQO→Joined days column) |
| `StalePipelineAlerts` | Dashboard tab stale pipeline section |
| `PipelineFilters` | Dashboard tab pipeline stage selector (remove SGM filter) |
| `ExportButton` | All drilldown modals |
| `ViewModeToggle` | Not needed (no full funnel view) |
| `DispositionToggle` | Not needed per spec |

### Can reuse with modification
| Component | Modification needed |
|---|---|
| `MetricDrillDownModal` | Add `'joined'` metric type with joined-specific columns |
| `SgmConversionTable` | Add `SQO→Joined (days)` column using `Stage_Entered_Joined__c` |
| `LeaderboardFilters` | Pattern can be copied; swap SGA→SGM, change channel defaults |
| `Scorecards` | Pattern can be copied; add ARR-specific cards |

### Need SGM-specific variants
| What | Why |
|---|---|
| Leaderboard query + table | Ranked by Joined AUM (not SQO count), different columns |
| Dashboard filters | Mirrors GlobalFilters+AdvancedFilters but scoped for SGM context |
| Quota tracking | Entirely new — ARR-based (not SQO-based like SGA), gauge + pacing |
| Quarterly trend charts | Cohorted-only, quarter count selector, no monthly/periodic toggle |
| Open Opps table | New component with aging colors, days-in-stage, Est. ARR column |
| SGMQuarterlyGoal Prisma model | ARR quota (Float) vs SGA's SQO quota (Int) |

### Shared types/utilities that need SGM variants
- `LeaderboardEntry` → `SGMLeaderboardEntry` (add joinedCount, joinedAum)
- `LeaderboardFilters` → `SGMLeaderboardFilters` (SGM names instead of SGA names)
- `QuarterlyGoal` (Prisma) → `SGMQuarterlyGoal` (arrGoal:Float instead of sqoGoal:Int)
- `FunnelMetrics` → extend or create `SGMDashboardMetrics` (add actualArr, estimatedArr, arrRatio)

---

## 10. Permissions Update Needed

`src/lib/permissions.ts` — Add SGM Hub page ID to allowed pages for `sgm`, `admin`, `manager`, `revops_admin` roles.

`src/app/dashboard/sgm-hub/page.tsx` — Gate:
```tsx
if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
  redirect('/dashboard');
}
```

Navigation sidebar — Add SGM Hub link, visible to same roles.
