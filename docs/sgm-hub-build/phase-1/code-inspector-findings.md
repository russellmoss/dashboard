# Code Inspector Findings: SGM Hub Phase 1 - Leaderboard Tab

Generated: 2026-03-21
Purpose: Reference for building SGM Hub Phase 1 Leaderboard tab, modeled on SGA Hub.

---

## 1. SGA Leaderboard Data Flow (End-to-End)

### Query Function: _getSGALeaderboard

**File:** src/lib/queries/sga-leaderboard.ts

**Signature (lines 69-71):**

    const _getSGALeaderboard = async (
      filters: LeaderboardFilters
    ): Promise<LeaderboardEntry[]>

**Params destructured (line 72):**
    const { startDate, endDate, channels, sources, sgaNames } = filters;

**BigQuery query structure:**
- CTE ActiveSGAs: queries savvy-gtm-analytics.SavvyGTMData.User where IsSGA__c = TRUE AND IsActive = TRUE. If sgaNames provided, filters IN UNNEST(@sgaNames); otherwise excludes hardcoded EXCLUDED_SGAS (lines 20-27: Anett Diaz, Jacqueline Tully, Savvy Operations, Savvy Marketing, Russell Moss, Jed Entin).
- CTE SQOData: queries FULL_TABLE (vw_funnel_master) where is_sqo_unique = 1, recordtypeid = @recruitingRecordType, Date_Became_SQO__c in date range, Channel_Grouping_Name IN UNNEST(@channels). Optional AND v.Original_source IN UNNEST(@sources).
- Main SELECT: LEFT JOIN ActiveSGAs to SQOData on sga_name, COUNT(DISTINCT s.primary_key) as sqo_count, ordered sqo_count DESC, sga_name ASC.
- All SGAs appear even with 0 SQOs due to LEFT JOIN.

**Params object (lines 131-147):** Always present: startDate, endDate, channels, recruitingRecordType, excludedSGAs. Conditionally added: sources, sgaNames (only when non-empty arrays).

**Transform (lines 151-156):**
    const entries: LeaderboardEntry[] = results.map((row) => ({
      sgaName: toString(row.sga_name),
      sqoCount: toNumber(row.sqo_count),
      rank: 0, // filled by calculateRanks
    }));

**Export (lines 164-168):** Wrapped with cachedQuery(_getSGALeaderboard, getSGALeaderboard, CACHE_TAGS.SGA_HUB).

---

### API Route: POST /api/sga-hub/leaderboard

**File:** src/app/api/sga-hub/leaderboard/route.ts

- export const dynamic = force-dynamic at line 10.
- Auth: getServerSession + getSessionPermissions (lines 33-46).
- Role guard (line 44): [admin, manager, sga, sgm, revops_admin].
- Parses body as LeaderboardFilters (line 50). Validates startDate, endDate, channels.
- Normalizes empty arrays to undefined before calling getSGALeaderboard(filters) (lines 72-74).
- Response: { entries: LeaderboardEntry[] } (line 79).

---

### API Client: getSGALeaderboard

**File:** src/lib/api-client.ts, lines 635-645

    getSGALeaderboard: (filters: {
      startDate: string;
      endDate: string;
      channels: string[];
      sources?: string[];
      sgaNames?: string[];
    }) =>
      apiFetch<{ entries: LeaderboardEntry[] }>(/api/sga-hub/leaderboard, {
        method: POST,
        body: JSON.stringify(filters),
      }),

Pattern: POST with JSON body, typed via generic apiFetch<T>.

---

### Content Component: fetchLeaderboard()

**File:** src/app/dashboard/sga-hub/SGAHubContent.tsx, lines 294-317

    const fetchLeaderboard = async () => {
      setLeaderboardLoading(true);
      setLeaderboardError(null);
      const quarterInfo = getQuarterInfo(leaderboardQuarter);
      const response = await dashboardApi.getSGALeaderboard({
        startDate: quarterInfo.startDate,
        endDate: quarterInfo.endDate,
        channels: leaderboardChannels,
        sources: leaderboardSources.length > 0 ? leaderboardSources : undefined,
        sgaNames: leaderboardSGAs.length > 0 ? leaderboardSGAs : undefined,
      });
      setLeaderboardEntries(response.entries);
    };

Triggered by useEffect (lines 319-332) when activeTab === leaderboard or any of leaderboardQuarter, leaderboardChannels, leaderboardSources, leaderboardSGAs change.

---

### LeaderboardTable Component

**File:** src/components/sga-hub/LeaderboardTable.tsx

**Props interface (lines 10-15):**
    interface LeaderboardTableProps {
      entries: LeaderboardEntry[];
      isLoading?: boolean;
      onSQOClick?: (sgaName: string) => void;
      currentUserSgaName?: string;
    }

**Columns:** Rank | SGA Name | SQOs (3 columns, using Tremor Table/TableHead/TableBody).

**Medal/color logic getRankStyling(rank) (lines 20-45):**
- Rank 1: bg-yellow-50 background, gold medal emoji, text-yellow-600
- Rank 2: bg-gray-50 background, silver medal emoji, text-gray-600
- Rank 3: bg-orange-50 background, bronze medal emoji, text-orange-600
- Other: no special styling; zebra-stripe applied (bg-white / bg-gray-50).

**You badge (lines 143-147):** When entry.sgaName === currentUserSgaName, renders a blue Tremor Badge with You text plus border-l-4 border-blue-500 on the row.

**Click handler (lines 151-157):** SQO count column renders as a blue button when onSQOClick is provided; invokes onSQOClick(entry.sgaName).

## 2. LeaderboardFilters Pattern

**File:** src/components/sga-hub/LeaderboardFilters.tsx

### Props Interface (lines 15-37):
- selectedQuarter: string (applied state from parent, YYYY-QN)
- selectedChannels: string[] (applied state)
- selectedSources: string[] (applied state)
- selectedSGAs: string[] (applied state)
- channelOptions: string[]
- sourceOptions: string[]
- sgaOptions: SGAOption[] -- { value: string; label: string; isActive: boolean }
- sgaOptionsLoading: boolean
- onApply callback: (filters: { quarter, channels, sources, sgas }) => void
- disabled?: boolean

### Pending vs. Committed State Pattern (lines 55-67):
Local state (localQuarter, localChannels, localSources, localSGAs) holds in-progress edits.
Props renamed to initialXxx on destructure = last applied committed state.
useEffect syncs local state from props after Apply.
hasPendingChanges (lines 191-201): deep equality check, shows (Pending) in header.
hasCustomFilters (lines 203-208): non-default detection, shows (Modified) in header.

### onApply normalizes empty to defaults (lines 149-162):
  sources: empty array -> all sourceOptions
  sgas: empty array -> all active sgaOptions

### Default Channel Selections:
- handleResetFilters (line 168): [Outbound, Outbound + Marketing]
- SGAHubContent.tsx initial state (line 96): [Outbound, Outbound + Marketing, Re-Engagement]

### Multi-Select Controls:
- Quarter: HTML select, last 8 quarters (lines 210-225)
- Channels: checkbox list, Select All / Deselect All (no search)
- Sources: checkbox list with text search, Select All / Deselect All
- SGAs: checkbox list with text search, Active Only / All SGAs / Deselect All

### Collapsed Header Summary (lines 176-188):
Four colored pills: quarter=blue, channels=purple, sources=green, SGAs=orange.
Counts computed from APPLIED props state, not local pending state.

---

## 3. SGAHubTabs Pattern

**File:** src/components/sga-hub/SGAHubTabs.tsx

### Exported type and props (lines 6-11):
export type SGAHubTab = leaderboard | weekly-goals | closed-lost | quarterly-progress | activity

Props: { activeTab: SGAHubTab; onTabChange: (tab: SGAHubTab) => void }

### Tabs array (lines 14-19):
  { id: leaderboard, label: Leaderboard, icon: Trophy }
  { id: weekly-goals, label: Weekly Goals vs. Actuals, icon: Target }
  { id: closed-lost, label: Closed Lost Follow-Up, icon: AlertCircle }
  { id: quarterly-progress, label: Quarterly Progress, icon: TrendingUp }
  { id: activity, label: Activity, icon: PhoneCall }

### Active state styling (lines 28-37):
Container: flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700
Each button: border-b-2 -mb-px
Active: border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400
Inactive: border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 hover:border-gray-300

For SGM Hub: create SGMHubTab type and SGMHubTabs component. Phase 1 only needs the leaderboard tab.

---

## 4. Drilldown Wiring

### handleLeaderboardSQOClick in SGAHubContent.tsx (lines 562-604):

1. Sets drillDownLoading=true, drillDownMetricType=sqos, drillDownOpen=true (modal opens in loading state).
2. Builds title: sgaName - SQOs - leaderboardQuarter
3. Sets drillDownContext: { metricType: sqos, title, sgaName, quarter: leaderboardQuarter }
4. Calls dashboardApi.getSQODrillDown(sgaName, { quarter }, undefined, channels, sources) -- passes current filter state.
5. Stores response.records in drillDownRecords state.

### Row click pattern (lines 714-725):
  handleRecordClick: drillDownOpen=false, recordDetailId=primaryKey, recordDetailOpen=true
  handleBackToDrillDown: recordDetailOpen=false, recordDetailId=null, drillDownOpen=true

### MetricDrillDownModal - COLUMN_CONFIGS

**File:** src/components/sga-hub/MetricDrillDownModal.tsx, lines 65-135

COLUMN_CONFIGS is Record<MetricType, col[]>. For sqos metric (lines 84-93):
  advisorName (Advisor Name, w-44), sqoDate (SQO Date, w-28), source (Source, w-28)
  channel (Channel, w-28), aumFormatted (AUM, w-28), aumTier (Tier, w-20)
  stageName (Stage, w-24), actions (empty label, w-20)

Export data mapped per metricType in useMemo (lines 181-249).
SGM Hub Phase 1 reuses existing sqos metric type -- no changes needed to MetricDrillDownModal.

Import path in SGAHubContent (line 26): @/components/sga-hub/MetricDrillDownModal

### DrillDownRecord Type Union

**File:** src/types/drill-down.ts

Line 96: DrillDownRecord = InitialCallRecord | QualificationCallRecord | SQODrillDownRecord
  | OpenSQLDrillDownRecord | MQLDrillDownRecord | SQLDrillDownRecord
  | LeadsSourcedRecord | LeadsContactedRecord

Line 8: MetricType = initial-calls | qualification-calls | sqos | open-sqls
  | mqls | sqls | leads-sourced | leads-contacted

SGM Hub Phase 1 reuses sqos MetricType and SQODrillDownRecord. No additions needed.

---

## 5. API Client Pattern

**File:** src/lib/api-client.ts

### apiFetch base function (line 230):
  async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T>
Browser uses relative URLs. Server constructs absolute URL via getBaseUrl().

### All SGA Hub API methods (section starts line 490):

| Method | HTTP | Endpoint |
|--------|------|----------|
| getWeeklyGoals | GET | /api/sga-hub/weekly-goals |
| saveWeeklyGoal | POST | /api/sga-hub/weekly-goals |
| getWeeklyActuals | GET | /api/sga-hub/weekly-actuals |
| getAllSGAWeeklyGoals | GET | /api/sga-hub/weekly-goals?allSGAs=true |
| getAllSGAWeeklyActuals | GET | /api/sga-hub/weekly-actuals?allSGAs=true |
| getQuarterlyGoals | GET | /api/sga-hub/quarterly-goals |
| saveQuarterlyGoal | POST | /api/sga-hub/quarterly-goals |
| getClosedLostRecords | GET | /api/sga-hub/closed-lost |
| getReEngagementOpportunities | GET | /api/sga-hub/re-engagement |
| getQuarterlyProgress | GET | /api/sga-hub/quarterly-progress |
| getSQODetails | GET | /api/sga-hub/sqo-details |
| getManagerQuarterlyGoal | GET | /api/sga-hub/manager-quarterly-goal |
| setManagerQuarterlyGoal | POST | /api/sga-hub/manager-quarterly-goal |
| getAdminQuarterlyProgress | GET | /api/sga-hub/admin-quarterly-progress |
| getSGAQuarterlyGoals | GET | /api/sga-hub/quarterly-goals (multi-SGA) |
| getSGALeaderboard | POST | /api/sga-hub/leaderboard |
| getLeaderboardSGAOptions | GET | /api/sga-hub/leaderboard-sga-options |
| getInitialCallsDrillDown | GET | /api/sga-hub/drill-down/initial-calls |
| getQualificationCallsDrillDown | GET | /api/sga-hub/drill-down/qualification-calls |
| getSQODrillDown | GET | /api/sga-hub/drill-down/sqos |
| getOpenSQLDrillDown | GET | /api/sga-hub/drill-down/open-sqls |
| getMQLDrillDown | GET | /api/sga-hub/drill-down/mqls |
| getSQLDrillDown | GET | /api/sga-hub/drill-down/sqls |
| getLeadsSourcedDrillDown | GET | /api/sga-hub/drill-down/leads-sourced |
| getLeadsContactedDrillDown | GET | /api/sga-hub/drill-down/leads-contacted |

**SGM Hub additions needed in api-client.ts:**
  getSGMLeaderboard: POST to /api/sgm-hub/leaderboard with JSON body
    filters: { startDate, endDate, channels, sources?, sgmNames? }
    returns: { entries: SGMLeaderboardEntry[] }

  getLeaderboardSGMOptions: GET /api/sgm-hub/leaderboard-sgm-options
    returns: { sgmOptions: Array<{ value: string; label: string; isActive: boolean }> }

---

## 6. Permissions & Navigation

### Permissions File

**File:** src/lib/permissions.ts

**Current page numbers in ROLE_PERMISSIONS (lines 14-70):**
- SGA Hub = page 8 (in sga role allowedPages at line 44: [1, 3, 7, 8, 10, 11, 13, 15])
- SGM Hub should be page 18 (next available after GC Hub=16, Reports=17)

**Role allowedPages arrays:**
- revops_admin (line 16): [1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] -- add 18
- admin (line 22): [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17] -- add 18
- manager (line 29): [1, 3, 7, 8, 9, 10, 11, 12, 13, 15] -- add 18
- sgm (line 36): [1, 3, 7, 10, 13, 15] -- add 18 (currently no SGA Hub access, correct)
- sga (line 43): [1, 3, 7, 8, 10, 11, 13, 15] -- do NOT add 18

**sgmFilter already exists (line 82):**
  sgmFilter: tokenData.role === sgm ? tokenData.name : null
Use permissions.sgmFilter in SGMHubContent to scope data to logged-in SGM.

### Navigation Sidebar

**File:** src/components/layout/Sidebar.tsx

**PAGES array (lines 49-61):**
  { id: 1,  name: Funnel Performance, href: /dashboard }
  { id: 3,  name: Open Pipeline,      href: /dashboard/pipeline }
  { id: 10, name: Explore,            href: /dashboard/explore }
  { id: 8,  name: SGA Hub,            href: /dashboard/sga-hub, icon: Target }
  { id: 9,  name: SGA Management,     href: /dashboard/sga-management }
  ...etc

**Current icon imports (line 10):**
  BarChart3, BarChart2, Settings, Menu, X, Target, Bot, Users, Layers, Briefcase, MessageSquarePlus, MapPin, Banknote

**Changes needed:**
1. Add Trophy to the import line (already available from lucide-react, used in SGAHubTabs.tsx).
2. Insert after SGA Hub entry: { id: 18, name: SGM Hub, href: /dashboard/sgm-hub, icon: Trophy }

---
## 7. calculateRanks Utility

**File:** src/lib/queries/sga-leaderboard.ts, lines 34-62

Not exported. Private to sga-leaderboard.ts. No shared version exists.

**Implementation (lines 34-62):**
  function calculateRanks(entries: LeaderboardEntry[]): LeaderboardEntry[]
  - Iterates in already-sorted order (query ORDER BY sqo_count DESC)
  - Tracks currentRank (starts 1) and previousCount (null)
  - entry.sqoCount !== previousCount -> increment currentRank
  - Same count = same rank (ties share rank, no gap)
  - Example: [5, 4, 4, 4, 2] -> ranks [1, 2, 2, 2, 3]

**Reusability for SGM Hub:**
Hardcodes entry.sqoCount. For SGM ranked by AUM:
Option A: Copy into sgm-leaderboard.ts, swap sqoCount for aumJoined.
Option B: Extract generic: calculateRanks<T>(entries: T[], getValue: (e: T) => number)

---

## 8. SGA Hub Page Structure

### Page File

**File:** src/app/dashboard/sga-hub/page.tsx

Auth gate pattern:
  export const dynamic = force-dynamic
  export default async function SGAHubPage()
  getServerSession + getSessionPermissions
  Redirect /login if no session or permissions
  Role check: [admin, manager, sga, sgm, revops_admin] else redirect /dashboard
  return <SGAHubContent />

Mirror for sgm-hub/page.tsx: change names, role list to [admin, manager, sgm, revops_admin].

### SGAHubContent.tsx State Declarations (lines 37-109):

Session/role (lines 37-42):
  useSession(), getSessionPermissions(session)
  isAdmin = role is admin or manager or revops_admin
  sgaName = session?.user?.name or Unknown
  activeTab state defaults to leaderboard

Leaderboard state block (lines 89-98):
  leaderboardEntries: LeaderboardEntry[] (default [])
  leaderboardLoading: boolean (false)
  leaderboardError: string | null
  leaderboardQuarter: string (getCurrentQuarter())
  leaderboardChannels: string[] ([Outbound, Outbound + Marketing, Re-Engagement])
  leaderboardSources: string[] ([]) -- empty = all sources
  leaderboardSGAs: string[] ([]) -- empty = all active SGAs

Filter options: two separate useEffect mounts:
  Lines 243-259: getFilterOptions() -> filterOptions (channels + sources)
  Lines 261-279: getLeaderboardSGAOptions() -> sgaOptions, sets leaderboardSGAs to all active

useEffect dependency array (lines 331-332) includes all leaderboard filter state vars.
onApply wiring (lines 790-796): sets 4 filter state vars; useEffect fires fetch.

---

## 9. Types

### LeaderboardEntry

**File:** src/types/sga-hub.ts, lines 332-336

  export interface LeaderboardEntry {
    sgaName: string;
    sqoCount: number;
    rank: number;
  }

### LeaderboardFilters

**File:** src/types/sga-hub.ts, lines 339-345

  export interface LeaderboardFilters {
    startDate: string;    // YYYY-MM-DD
    endDate: string;      // YYYY-MM-DD
    channels: string[];   // required
    sources?: string[];   // optional; omit = all
    sgaNames?: string[];  // optional; omit = all active SGAs
  }

NOTE: LeaderboardEntry is NOT in src/types/dashboard.ts. Lives exclusively in src/types/sga-hub.ts.
dashboard.ts contains funnel types: FunnelMetrics, DetailRecord, SgmConversionData, etc.

### New file to create: src/types/sgm-hub.ts

Minimum viable types for Phase 1:

  export interface SGMLeaderboardEntry {
    sgmName: string;
    aumJoined: number;       // Total AUM of joined advisors in period
    aumFormatted: string;    // Pre-formatted display string e.g. 2.3M
    joinedCount: number;     // Number of joined advisors
    rank: number;
  }

  export interface SGMLeaderboardFilters {
    startDate: string;       // YYYY-MM-DD
    endDate: string;         // YYYY-MM-DD
    channels: string[];      // required
    sources?: string[];
    sgmNames?: string[];     // optional; omit = all active SGMs
  }

  export type SGMHubTab = leaderboard;  // extend as phases progress

NOTE: Confirm ranking metric (AUM joined vs. SQO count) with business before finalizing.

---

## 10. Summary: Files to Create / Modify for SGM Hub Phase 1

### New Files to Create

| File | Purpose |
|------|---------|
| src/types/sgm-hub.ts | SGMLeaderboardEntry, SGMLeaderboardFilters, SGMHubTab |
| src/lib/queries/sgm-leaderboard.ts | BigQuery query function + calculateRanks pattern |
| src/app/api/sgm-hub/leaderboard/route.ts | POST endpoint -- mirror sga-hub/leaderboard/route.ts |
| src/app/api/sgm-hub/leaderboard-sgm-options/route.ts | GET active SGMs for filter dropdown |
| src/app/dashboard/sgm-hub/page.tsx | Server component auth gate |
| src/app/dashboard/sgm-hub/SGMHubContent.tsx | Client content with tab + leaderboard state |
| src/components/sgm-hub/SGMHubTabs.tsx | Tab bar -- mirror SGAHubTabs.tsx |
| src/components/sgm-hub/LeaderboardFilters.tsx | Filter panel -- adapt from sga-hub version |
| src/components/sgm-hub/LeaderboardTable.tsx | Table -- adapt columns for SGM metrics |

### Files to Modify

| File | Change |
|------|--------|
| src/lib/permissions.ts | Add page 18 to revops_admin, admin, manager, sgm allowedPages |
| src/components/layout/Sidebar.tsx | Import Trophy; add { id: 18, name: SGM Hub, href: /dashboard/sgm-hub, icon: Trophy } |
| src/lib/api-client.ts | Add getSGMLeaderboard and getLeaderboardSGMOptions methods |

### Key Open Questions for Phase 1

1. **Ranking metric:** SGA leaderboard ranks by sqoCount. SGM Hub likely ranks by AUM joined.
   Confirm with business before writing the BigQuery query.

2. **SGM User flag in BigQuery:** SGA query uses IsSGA__c = TRUE on User table.
   Verify equivalent SGM flag (IsSGM__c or similar) before building the query.

3. **calculateRanks:** Must be copied or generalized -- not exported from sga-leaderboard.ts.

4. **Drilldown reuse:** getSQODrillDown API and SQODrillDownRecord can be reused without changes.
   MetricDrillDownModal at src/components/sga-hub/MetricDrillDownModal can be imported directly.
