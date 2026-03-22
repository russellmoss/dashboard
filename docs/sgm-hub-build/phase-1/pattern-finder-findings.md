# Pattern Finder Findings: SGM Hub Leaderboard

Generated: 2026-03-21
Purpose: Document exact implementation patterns from the SGA Hub Leaderboard for replication in the SGM Hub.

---
## Pattern 1: SGA Leaderboard End-to-End Data Flow

### Entry Point

- src/lib/queries/sga-leaderboard.ts -- BigQuery query with two-CTE structure

### Full Data Flow

  BigQuery (vw_funnel_master + SavvyGTMData.User)
    -> src/lib/queries/sga-leaderboard.ts  (query + transform + calculateRanks + cachedQuery)
    -> src/app/api/sga-hub/leaderboard/route.ts  (POST auth + validate + call query)
    -> src/lib/api-client.ts  dashboardApi.getSGALeaderboard  (apiFetch POST)
    -> src/app/dashboard/sga-hub/SGAHubContent.tsx  fetchLeaderboard()  (state management)
    -> src/components/sga-hub/LeaderboardTable.tsx  (render)

### Key Files

- src/lib/queries/sga-leaderboard.ts
- src/app/api/sga-hub/leaderboard/route.ts
- src/lib/api-client.ts  (lines 635-650)
- src/app/dashboard/sga-hub/SGAHubContent.tsx  (lines 293-317, 319-332, 561-604)
- src/components/sga-hub/LeaderboardTable.tsx

### BigQuery Query Structure (sga-leaderboard.ts lines 98-129)

CTE 1 -- ActiveSGAs:
  SELECT DISTINCT u.Name as sga_name FROM SavvyGTMData.User u
  WHERE u.IsSGA__c = TRUE AND u.IsActive = TRUE
  Conditional: AND u.Name IN UNNEST(@sgaNames)  [when sgaNames provided]
  Default:     AND u.Name NOT IN UNNEST(@excludedSGAs)

CTE 2 -- SQOData:
  FROM vw_funnel_master (FULL_TABLE constant) with:
  - is_sqo_unique = 1, recordtypeid = @recruitingRecordType
  - Date_Became_SQO__c range via TIMESTAMP(@startDate) to TIMESTAMP(CONCAT(@endDate, 23:59:59))
  - Channel_Grouping_Name IN UNNEST(@channels)
  - Optional: Original_source IN UNNEST(@sources)
  SGA name: COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)
  via LEFT JOIN User sga_user ON v.Opp_SGA_Name__c = sga_user.Id

Final: LEFT JOIN ActiveSGAs to SQOData on name string.
Guarantees all active SGAs appear even with 0 SQOs.
ORDER BY sqo_count DESC, sga_name ASC.

KEY PATTERN FOR SGM HUB:
  SGM User field:     u.Is_SGM__c = TRUE  (NOT IsSGM__c -- underscore matters)
  SGM name in funnel: SGM_Owner_Name__c
  No Id join avail:   v.SGM_Owner_Name__c = u.Name  (string match, no COALESCE needed)

### Type Coercion (sga-leaderboard.ts line 7, lines 152-156)

Imports: import { toNumber, toString } from "@/types/bigquery-raw"

Raw result interface: sqo_count: number | null
toNumber coerces null -> 0. toString coerces null/undefined -> empty string.

Transform:
  results.map((row) => ({
    sgaName: toString(row.sga_name),
    sqoCount: toNumber(row.sqo_count),
    rank: 0,
  }))

### cachedQuery Wrapper (sga-leaderboard.ts lines 164-168)

  export const getSGALeaderboard = cachedQuery(
    _getSGALeaderboard,    // inner fn prefixed _ and NOT exported
    "getSGALeaderboard",   // unique cache key name across codebase
    CACHE_TAGS.SGA_HUB     // value: "sga-hub"
  );

For SGM Hub: add CACHE_TAGS.SGM_HUB = "sgm-hub" to src/lib/cache.ts.

### API Route Pattern (src/app/api/sga-hub/leaderboard/route.ts)

export const dynamic = "force-dynamic";  // top of every route file

POST handler 7 steps:
1. getServerSession + session?.user?.email guard -> 401
2. getSessionPermissions(session) + role check -> 403
   Allowed: ["admin", "manager", "sga", "sgm", "revops_admin"]
3. const body = await request.json() -- cast to LeaderboardFilters
4. Validate: startDate/endDate required; channels required non-empty array -> 400
5. Normalize: empty optional arrays become undefined
6. await getSGALeaderboard(filters)
7. return NextResponse.json({ entries })
Catch: console.error("[API] Error fetching leaderboard:", error) -> return 500

### api-client.ts Methods (lines 635-650)

getSGALeaderboard: POST /api/sga-hub/leaderboard with JSON body { startDate, endDate, channels, sources?, sgaNames? }
  Returns Promise<{ entries: LeaderboardEntry[] }>

getLeaderboardSGAOptions: GET /api/sga-hub/leaderboard-sga-options
  Returns Promise<{ sgaOptions: Array<{ value: string; label: string; isActive: boolean }> }>

---

## Pattern 2: LeaderboardFilters Pending State (src/components/sga-hub/LeaderboardFilters.tsx)

### Props Interface (lines 15-37)

Committed/applied values: selectedQuarter, selectedChannels, selectedSources, selectedSGAs.
Destructured with "initial" prefix: initialQuarter, initialChannels, initialSources, initialSGAs.

Options: channelOptions, sourceOptions, sgaOptions (type: {value,label,isActive}), sgaOptionsLoading

onApply callback signature:
  onApply: (filters: { quarter: string; channels: string[]; sources: string[]; sgas: string[] }) => void
Note: sources and sgas are never undefined in callback -- default to all if local empty.

### Local State vs. Applied State (lines 56-67)

Local state: localQuarter, localChannels, localSources, localSGAs.
User mutates local state; committed only when Apply clicked.

Sync-back useEffect (fires when parent props update after Apply):
  useEffect(() => {
    setLocalQuarter(initialQuarter);
    setLocalChannels(initialChannels);
    setLocalSources(initialSources);
    setLocalSGAs(initialSGAs);
  }, [initialQuarter, initialChannels, initialSources, initialSGAs]);

### hasPendingChanges (lines 191-201)

Full bi-directional set comparison across all four filter dimensions.
Checks both forward (local every in initial) and reverse (initial every in local) inclusion.
Apply button disabled when \!hasPendingChanges.
"(Pending)" badge in collapsed header when hasPendingChanges is true.
"(Modified)" badge when hasCustomFilters (applied state differs from defaults).

### handleApplyFilters (lines 149-162)

Guard: alert and return if zero channels selected.
Default-on-empty:
  sources: localSources.length > 0 ? localSources : sourceOptions  (all sources)
  sgas:    localSGAs.length > 0 ? localSGAs : sgaOptions.filter(s.isActive).map(s.value)

### Default Channel Selections

Reset handler (line 168):       ["Outbound", "Outbound + Marketing"]  -- 2 channels
Parent initial (line 96):       ["Outbound", "Outbound + Marketing", "Re-Engagement"]  -- 3 channels

INCONSISTENCY: Reset removes Re-Engagement. Pick one canonical default for SGM Hub.

### Quarter Selector

Last 8 quarters DESC from getCurrentQuarter() via getQuarterInfo()
from src/lib/utils/sga-hub-helpers.ts. Format: "YYYY-QN". Native <select>.

### Multi-Select Dropdown Pattern (Channels, Sources, SGAs)

All three use: hidden checkbox (sr-only) + custom visual div.
Select All / Deselect All link buttons.
SGAs: additional "Active Only" button + text search (useMemo filtered).
Sources: text search (useMemo filtered).
Color coding: purple=channels, green=sources, orange=SGAs.

---

## Pattern 3: Navigation Sidebar (src/components/layout/Sidebar.tsx)

### Page ID Assignments (PAGES array lines 49-61)

  1  = Funnel Performance    /dashboard
  3  = Open Pipeline         /dashboard/pipeline
  7  = Settings              /dashboard/settings
  8  = SGA Hub               /dashboard/sga-hub
  9  = SGA Management        /dashboard/sga-management
  10 = Explore               /dashboard/explore
  12 = Recruiter Hub         /dashboard/recruiter-hub
  13 = Dashboard Requests    /dashboard/requests
  14 = Chart Builder         /dashboard/chart-builder
  15 = Advisor Map           /dashboard/advisor-map
  16 = GC Hub                /dashboard/gc-hub
  17 = Reports (in ROLE_PERMISSIONS but NOT yet in PAGES array)

Next available ID: 18

### Adding a New Page (2 steps)

Step 1: Add to PAGES in src/components/layout/Sidebar.tsx:
  { id: 18, name: "SGM Hub", href: "/dashboard/sgm-hub", icon: SomeIcon }

Step 2: Add 18 to allowedPages for sgm, admin, manager, revops_admin in src/lib/permissions.ts

### Role Visibility

  const allowedPages = allowedPagesOverride || permissions?.allowedPages || [1, 2];
  const filteredPages = PAGES.filter(page => allowedPages.includes(page.id));

Current sgm allowedPages: [1, 3, 7, 10, 13, 15] -- does NOT include 8 (SGA Hub).

---

## Pattern 4: Tab Lazy-Loading (SGAHubContent.tsx lines 319-332)

  useEffect(() => {
    if (activeTab === "weekly-goals")            { fetchWeeklyData(); }
    else if (activeTab === "closed-lost")        { fetchClosedLostRecords(...); ... }
    else if (activeTab === "quarterly-progress") { fetchQuarterlyProgress(); }
    else if (activeTab === "leaderboard")        { fetchLeaderboard(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange.startDate, dateRange.endDate, activeTab, selectedQuarter,
      leaderboardQuarter, leaderboardChannels, leaderboardSources, leaderboardSGAs]);

Dependency array includes ALL filter state for ALL tabs.
activeTab guards prevent fetching inactive tabs when their deps change.

Initial activeTab = "leaderboard" (line 43) -> leaderboard fetched on first render.
Filter options and SGA options fetched unconditionally on mount (separate useEffect(fn, [])).

Per-tab loading state vars:
  loading/error (weekly), closedLostLoading/Error, quarterlyLoading/Error, leaderboardLoading/Error

---

## Pattern 5: calculateRanks (src/lib/queries/sga-leaderboard.ts lines 34-62)

Module-private (not exported). Called after BigQuery transform, before return.
Input must already be sorted DESC by sqoCount (SQL ORDER BY guarantees this).
Ties share same rank. Rank increments on count change only (not by array index).
Example: counts [5,4,4,4,2] -> ranks [1,2,2,2,3]

---

## Pattern 6: Auth Gate for New Pages (src/app/dashboard/sga-hub/page.tsx)

Server component pattern (verbatim from working file):

  import { redirect } from "next/navigation";
  import { getServerSession } from "next-auth";
  import { authOptions } from "@/lib/auth";
  import { getSessionPermissions } from "@/types/auth";
  export const dynamic = "force-dynamic";
  export default async function SGAHubPage() {
    const session = await getServerSession(authOptions);
    if (\!session?.user?.email) { redirect("/login"); }
    const permissions = getSessionPermissions(session);
    if (\!permissions) { redirect("/login"); }
    if (\!["admin","manager","sga","sgm","revops_admin"].includes(permissions.role)) {
      redirect("/dashboard");
    }
    return <SGAHubContent />;
  }

Server component passes NO data props to client component.
For SGM Hub: roles = ["admin","manager","sgm","revops_admin"]  (exclude sga).

---

## Pattern 7: API Route POST Pattern

Standard structure all POST routes follow (src/app/api/sga-hub/leaderboard/route.ts):

  export const dynamic = "force-dynamic";
  export async function POST(request: NextRequest) {
    try {
      // 1. getServerSession + session?.user?.email guard -> 401
      // 2. getSessionPermissions(session) + role check -> 403
      // 3. await request.json() cast to filter type
      // 4. validate required fields -> 400
      // 5. normalize empty optional arrays -> undefined
      // 6. call query function
      // 7. return NextResponse.json({ result })
    } catch (error) {
      console.error("[API] Error fetching leaderboard:", error);
      return NextResponse.json({ error: "Failed to fetch leaderboard" }, { status: 500 });
    }
  }

Error log prefix "[API]" is the consistent convention.

---

## Pattern 8: Drilldown Click Handler (SGAHubContent.tsx lines 561-604)

### handleLeaderboardSQOClick -- Five Steps

1. setDrillDownLoading(true), setDrillDownMetricType("sqos"), setDrillDownOpen(true)
   Modal opens immediately in loading state before API call.
2. Build title string; setDrillDownTitle(title)
3. setDrillDownContext({ metricType: "sqos", title, sgaName, quarter: leaderboardQuarter })
4. Await dashboardApi.getSQODrillDown(sgaName, { quarter }, undefined,
     leaderboardChannels.length > 0 ? leaderboardChannels : undefined,
     leaderboardSources.length > 0 ? leaderboardSources : undefined)
5. setDrillDownRecords on success; setDrillDownError on catch; finally setDrillDownLoading(false)

Committed filter state forwarded directly. Empty array -> undefined -> "all".

### 7 Modal State Variables (lines 77-83)

  const [drillDownOpen, setDrillDownOpen] = useState(false);
  const [drillDownMetricType, setDrillDownMetricType] = useState<MetricType | null>(null);
  const [drillDownRecords, setDrillDownRecords] = useState<DrillDownRecord[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);
  const [drillDownError, setDrillDownError] = useState<string | null>(null);
  const [drillDownTitle, setDrillDownTitle] = useState("");
  const [drillDownContext, setDrillDownContext] = useState<DrillDownContext | null>(null);

### Close/Back Navigation (lines 713-739)

To record detail: setDrillDownOpen(false); setRecordDetailId(pk); setRecordDetailOpen(true)
Back to drill-down: setRecordDetailOpen(false); setRecordDetailId(null); setDrillDownOpen(true)
Close entirely: setDrillDownOpen(false); setDrillDownRecords([]); setDrillDownContext(null)

---

## Pattern 9: SGA Options API (src/app/api/sga-hub/leaderboard-sga-options/route.ts)

### BigQuery Query (lines 65-73)

WHERE u.IsSGA__c = TRUE AND u.Name NOT IN UNNEST(@excludedSGAs)
Does NOT filter u.IsActive in SQL -- returns active + inactive SGAs for UI labeling.

### is_active Coercion (lines 82-88)

  const sgaOptions = results
    .filter(r => r.sga_name !== null)
    .map(r => ({
      value: toString(r.sga_name),
      label: toString(r.sga_name),
      isActive: r.is_active === true || r.is_active === 1,  // BQ returns bool or number
    }));

Response: { sgaOptions: Array<{ value: string; label: string; isActive: boolean }> }

### SGM Equivalent

Use u.Is_SGM__c = TRUE (confirmed in:
  src/lib/queries/open-pipeline.ts lines 527-528
  src/lib/queries/filter-options.ts line 134)

Apply identical is_active coercion. Rename response key: sgaOptions -> sgmOptions.

---

## Pattern 10: SGAHubTabs (src/components/sga-hub/SGAHubTabs.tsx)

Type: type SGAHubTab = "leaderboard" | "weekly-goals" | "closed-lost" | "quarterly-progress" | "activity"

Active styling:   border-b-2 -mb-px border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400
Inactive styling: border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900
Tab bar:          flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700

---

## CRITICAL: Field Name Inconsistency -- IsSGA__c vs Is_SGM__c

Entity  User Table Field  vw_funnel_master Fields
------  ---------------  -----------------------
SGA     IsSGA__c         SGA_Owner_Name__c, Opp_SGA_Name__c (Id field)
SGM     Is_SGM__c        SGM_Owner_Name__c (name string only, no Id field)

SGA name resolution: COALESCE chain with Id-based join.
  COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)
  LEFT JOIN User sga_user ON v.Opp_SGA_Name__c = sga_user.Id

SGM name resolution: direct string match, no COALESCE.
  v.SGM_Owner_Name__c = u.Name

Using IsSGM__c (without underscore) returns no rows silently. Verified working field: Is_SGM__c.

---

## IMPORTANT: EXCLUDED_SGAS Inconsistency

Two exclusion lists with different membership:

src/lib/queries/sga-leaderboard.ts (leaderboard query -- 6 entries):
  Anett Diaz, Jacqueline Tully, Savvy Operations, Savvy Marketing, Russell Moss, Jed Entin

src/app/api/sga-hub/leaderboard-sga-options/route.ts (picklist API -- 10 entries):
  Above 6 plus: Ariana Butler, Bre McDaniel, Bryan Belville, GinaRose Galli

The 4 extra names are NOT excluded from the leaderboard query.
They can appear in leaderboard results when not explicitly filtered.
SGM Hub should use one consolidated exclusion list in both files.

---

## Type Definitions (src/types/sga-hub.ts lines 329-345)

  LeaderboardEntry: { sgaName: string; sqoCount: number; rank: number }
  LeaderboardFilters: { startDate, endDate, channels (required non-empty), sources?, sgaNames? }

Create src/types/sgm-hub.ts with parallel types.
Rename: sgaName -> sgmName, sgaNames -> sgmNames.

---

## Summary: Files to Create/Modify for SGM Hub Leaderboard

### New Files

  src/types/sgm-hub.ts
    FROM: src/types/sga-hub.ts

  src/lib/queries/sgm-leaderboard.ts
    FROM: src/lib/queries/sga-leaderboard.ts
    CHANGES: IsSGA__c -> Is_SGM__c; remove COALESCE/Id join; SGM_Owner_Name__c = u.Name;
             rename sgaName->sgmName; rename export getSGMLeaderboard

  src/app/api/sgm-hub/leaderboard/route.ts
    FROM: src/app/api/sga-hub/leaderboard/route.ts
    CHANGES: allowed roles = ["admin","manager","sgm","revops_admin"]  (exclude sga)

  src/app/api/sgm-hub/leaderboard-sgm-options/route.ts
    FROM: src/app/api/sga-hub/leaderboard-sga-options/route.ts
    CHANGES: IsSGA__c -> Is_SGM__c; rename sgaOptions -> sgmOptions

  src/app/dashboard/sgm-hub/page.tsx
    FROM: src/app/dashboard/sga-hub/page.tsx
    CHANGES: roles = ["admin","manager","sgm","revops_admin"]

  src/app/dashboard/sgm-hub/SGMHubContent.tsx
    FROM: src/app/dashboard/sga-hub/SGAHubContent.tsx
    Start with leaderboard tab only

  src/components/sgm-hub/LeaderboardTable.tsx
    FROM: src/components/sga-hub/LeaderboardTable.tsx

  src/components/sgm-hub/LeaderboardFilters.tsx
    FROM: src/components/sga-hub/LeaderboardFilters.tsx
    CHANGES: rename SGA -> SGM in all labels and prop names

  src/components/sgm-hub/SGMHubTabs.tsx
    FROM: src/components/sga-hub/SGAHubTabs.tsx

### Files to Modify

  src/components/layout/Sidebar.tsx
    ADD: { id: 18, name: "SGM Hub", href: "/dashboard/sgm-hub", icon: SomeIcon }

  src/lib/permissions.ts
    ADD id 18 to allowedPages for: sgm, admin, manager, revops_admin

  src/lib/api-client.ts
    ADD: getSGMLeaderboard and getLeaderboardSGMOptions to dashboardApi

  src/lib/cache.ts
    ADD: SGM_HUB: "sgm-hub" to CACHE_TAGS

---

## Consistent Patterns (no drift)

- Auth/authz: getServerSession + getSessionPermissions -- identical across all route files
- export const dynamic="force-dynamic" -- present in all route files
- toString/toNumber from @/types/bigquery-raw -- consistent type coercion
- Error log prefix "[API]" -- consistent
- cachedQuery with _ prefixed non-exported inner function -- consistent
- Empty optional arrays normalized to undefined before passing to query -- consistent
- isActive = true||1 coercion -- consistent for BQ type ambiguity

## Patterns with Drift (flag for SGM Hub)

- EXCLUDED_SGAS: query has 6 names, picklist has 10 -- consolidate for SGM Hub
- Default channels: filter Reset uses 2, parent initializes with 3 (Re-Engagement gap)
- SGM field naming: Is_SGM__c (underscore prefix) vs IsSGA__c (no underscore) -- typo risk
- SGM name resolution: no Id field available, string name match only (simpler than SGA)
