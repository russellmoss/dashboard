# SGM Hub Phase 1: Leaderboard Tab — Exploration Results

> Synthesized from code-inspector, data-verifier, and pattern-finder findings.
> Date: 2026-03-21

---

## 1. Feature Summary

**What:** New SGM Hub page (`/dashboard/sgm-hub`) with tab infrastructure and a Leaderboard tab ranking SGMs by Joined AUM.

**Scope (Phase 1 only):**
- Page infrastructure: server component auth gate, client content component, tab bar (3 tabs defined, only leaderboard active)
- Leaderboard table: Rank, SGM Name, # Joined (clickable), Joined AUM (clickable) — ranked by AUM DESC
- Filters: quarter selector, channels (multi, ALL selected by default), sources (multi+search), SGMs (multi+search)
- Drilldown: click # Joined or Joined AUM → MetricDrillDownModal showing joined advisors → RecordDetailModal
- Navigation: sidebar link visible to admin, manager, sgm, revops_admin
- Permissions: page 18 added to allowed pages for those 4 roles

---

## 2. BigQuery Status — All Green

**No view changes required.** All fields exist and are well-populated.

| Field | Table | Population (joined) | Notes |
|---|---|---|---|
| `SGM_Owner_Name__c` | vw_funnel_master | **100%** (115/115) | Name string, direct match to User.Name |
| `is_joined_unique` | vw_funnel_master | n/a (filter) | Use `= 1`, NOT `is_joined` |
| `Opportunity_AUM` | vw_funnel_master | **100%** | Range $0–$1.5B, median $30.2M, 3 zero-AUM records |
| `joined_cohort_month` | vw_funnel_master | **100%** | STRING 'YYYY-MM', use for quarter filtering |
| `advisor_join_date__c` | vw_funnel_master | **100%** | DATE type, use for quarter display labels |
| `Channel_Grouping_Name` | vw_funnel_master | present | 7 distinct values |
| `Original_source` | vw_funnel_master | present | 18 distinct, 9 with joins |
| `Is_SGM__c` | SavvyGTMData.User | n/a | **BOOL** — note underscore before SGM (unlike `IsSGA__c`) |
| `IsActive` | SavvyGTMData.User | n/a | 12 active SGMs, 2 inactive |

### Data Characteristics
- **115 total joined records** across all time, 12 distinct SGMs
- **Q1 2026:** 8 SGMs with joins (12 total), led by GinaRose Galli ($1.566B) and Corey Marcello ($458M)
- **3 active SGMs with zero all-time joins:** David Eubanks, Clayton Kennamer, Lena Allouche (new hires with SQO pipeline)
- **Outlier:** GinaRose has a single $1.5B advisor in Q1 2026 — legitimate but skews AUM totals

### Data Flags
| Severity | Issue | Mitigation |
|---|---|---|
| LOW | "Savvy Marketing" (SGA) appears as SGM_Owner_Name__c on 1 record | LEFT JOIN from User WHERE Is_SGM__c = TRUE auto-excludes |
| LOW | 3 zero-AUM joined records | Display as $0, don't hide |
| LOW | $1.5B outlier advisor | UI shows both count and AUM columns for context |
| INFO | Jacqueline Tully (inactive SGM) has 4 historical joins | User table join with IsActive = TRUE excludes her |
| INFO | `Stage_Entered_Closed__c` is 99.1% NULL for joined | Use `advisor_join_date__c` / `joined_cohort_month` instead |

---

## 3. Files to Modify (Existing)

| File | Change | Lines |
|---|---|---|
| `src/lib/permissions.ts` | Add page 18 to `allowedPages` for revops_admin, admin, manager, sgm | Lines 16, 22, 29, 36 |
| `src/components/layout/Sidebar.tsx` | Import `Trophy` icon; add `{ id: 18, name: "SGM Hub", href: "/dashboard/sgm-hub", icon: Trophy }` after SGA Hub entry | Lines 10, 49-61 |
| `src/lib/api-client.ts` | Add `getSGMLeaderboard` (POST) and `getLeaderboardSGMOptions` (GET) methods | After line 650 |
| `src/lib/cache.ts` | Add `SGM_HUB: "sgm-hub"` to CACHE_TAGS | In CACHE_TAGS object |
| `src/types/drill-down.ts` | Add `'joined' | 'joined-aum'` to MetricType union; add `JoinedDrillDownRecord` to DrillDownRecord union | Lines 8, 96 |
| `src/components/sga-hub/MetricDrillDownModal.tsx` | Add `joined` and `joined-aum` column configs to COLUMN_CONFIGS; add export data mapping | Lines 65-135, 181-249 |

---

## 4. Files to Create (New)

| File | Source Pattern | Purpose |
|---|---|---|
| `src/types/sgm-hub.ts` | `src/types/sga-hub.ts` | SGMLeaderboardEntry, SGMLeaderboardFilters, SGMHubTab types |
| `src/lib/queries/sgm-leaderboard.ts` | `src/lib/queries/sga-leaderboard.ts` | BigQuery query + calculateRanks + cachedQuery |
| `src/app/api/sgm-hub/leaderboard/route.ts` | `src/app/api/sga-hub/leaderboard/route.ts` | POST endpoint for leaderboard data |
| `src/app/api/sgm-hub/leaderboard-sgm-options/route.ts` | `src/app/api/sga-hub/leaderboard-sga-options/route.ts` | GET endpoint for SGM name list |
| `src/app/api/sgm-hub/drill-down/joined/route.ts` | `src/app/api/sga-hub/drill-down/sqos/route.ts` | GET endpoint for joined advisor drilldown |
| `src/app/dashboard/sgm-hub/page.tsx` | `src/app/dashboard/sga-hub/page.tsx` | Server component auth gate |
| `src/app/dashboard/sgm-hub/SGMHubContent.tsx` | `src/app/dashboard/sga-hub/SGAHubContent.tsx` | Client component — leaderboard tab only |
| `src/components/sgm-hub/SGMHubTabs.tsx` | `src/components/sga-hub/SGAHubTabs.tsx` | Tab bar: leaderboard / dashboard / quota-tracking |
| `src/components/sgm-hub/SGMLeaderboardTable.tsx` | `src/components/sga-hub/LeaderboardTable.tsx` | Ranked table: SGM, # Joined, Joined AUM |
| `src/components/sgm-hub/SGMLeaderboardFilters.tsx` | `src/components/sga-hub/LeaderboardFilters.tsx` | Filters with ALL channels default |

**Total: 10 new files, 6 modified files**

---

## 5. Type Changes

### New file: `src/types/sgm-hub.ts`

```typescript
export type SGMHubTab = 'leaderboard' | 'dashboard' | 'quota-tracking';

export interface SGMLeaderboardEntry {
  sgmName: string;
  joinedCount: number;
  joinedAum: number;       // raw number for sorting
  joinedAumFormatted: string; // pre-formatted display e.g. "$2.3M"
  rank: number;
}

export interface SGMLeaderboardFilters {
  startDate: string;       // YYYY-MM-DD
  endDate: string;         // YYYY-MM-DD
  channels: string[];      // required, non-empty
  sources?: string[];      // omit = all
  sgmNames?: string[];     // omit = all active SGMs
}
```

### Modify: `src/types/drill-down.ts`

```typescript
// Add to MetricType union (line 8):
| 'joined' | 'joined-aum'

// Add JoinedDrillDownRecord interface:
export interface JoinedDrillDownRecord extends DrillDownRecordBase {
  advisorName: string;
  joinDate: string;
  source: string;
  channel: string;
  aum: number;
  aumFormatted: string;
  sgmName: string;
}

// Add to DrillDownRecord union (line 96):
| JoinedDrillDownRecord
```

---

## 6. Construction Site Inventory

Every location that constructs or consumes modified types:

| File | Function/Location | What It Does |
|---|---|---|
| `src/lib/queries/sgm-leaderboard.ts` (NEW) | `_getSGMLeaderboard()` | Constructs `SGMLeaderboardEntry[]` from BigQuery rows |
| `src/lib/queries/sgm-leaderboard.ts` (NEW) | `calculateRanks()` | Mutates `entry.rank` on `SGMLeaderboardEntry[]` |
| `src/app/api/sgm-hub/drill-down/joined/route.ts` (NEW) | `GET handler` | Constructs `JoinedDrillDownRecord[]` from BigQuery rows |
| `src/components/sga-hub/MetricDrillDownModal.tsx` (MODIFY) | `COLUMN_CONFIGS` | Add `joined` and `joined-aum` column configs |
| `src/components/sga-hub/MetricDrillDownModal.tsx` (MODIFY) | `useMemo exportData` | Add export mapping for joined metrics |

---

## 7. Recommended Phase Order

### Phase 1: Types & Permissions (no UI, build should pass)
1. Create `src/types/sgm-hub.ts` with types
2. Update `src/types/drill-down.ts` with joined metric types
3. Update `src/lib/permissions.ts` — add page 18
4. Update `src/lib/cache.ts` — add SGM_HUB cache tag

### Phase 2: BigQuery Query Layer
5. Create `src/lib/queries/sgm-leaderboard.ts` — query + transform + calculateRanks + cachedQuery

### Phase 3: API Routes
6. Create `POST /api/sgm-hub/leaderboard/route.ts`
7. Create `GET /api/sgm-hub/leaderboard-sgm-options/route.ts`
8. Create `GET /api/sgm-hub/drill-down/joined/route.ts`

### Phase 4: API Client
9. Add `getSGMLeaderboard`, `getLeaderboardSGMOptions`, `getJoinedDrillDown` to `api-client.ts`

### Phase 5: Drilldown Support
10. Update `MetricDrillDownModal` — add `joined` / `joined-aum` column configs + export mapping

### Phase 6: Components
11. Create `SGMHubTabs.tsx`
12. Create `SGMLeaderboardFilters.tsx`
13. Create `SGMLeaderboardTable.tsx`

### Phase 7: Page Assembly
14. Create `src/app/dashboard/sgm-hub/page.tsx` (server, auth gate)
15. Create `SGMHubContent.tsx` (client, state + tab rendering + drilldown wiring)
16. Update `Sidebar.tsx` — add SGM Hub nav link

### Phase 8: Doc Sync & Validation
17. Run `npx agent-guard sync`
18. Run `npm run gen:api-routes`
19. Build verification: `npm run build`
20. Manual smoke test

---

## 8. Risks and Blockers

| Risk | Severity | Mitigation |
|---|---|---|
| `Is_SGM__c` field name typo (underscore before SGM unlike `IsSGA__c`) | **HIGH** | Pattern-finder confirmed correct field. Use `Is_SGM__c` everywhere. Silent failure if wrong. |
| MetricDrillDownModal lives in `src/components/sga-hub/` | MEDIUM | SGM Hub must import from sga-hub directory. Consider moving to shared location in future, but for Phase 1 just cross-import. |
| `calculateRanks()` is private to sga-leaderboard.ts, hardcoded to sqoCount | MEDIUM | Copy into sgm-leaderboard.ts, modify to rank by `joinedAum`. Consider extracting shared util in future. |
| Default channel selections inconsistent in SGA Hub (2 in reset vs 3 in init) | LOW | SGM Hub spec says ALL channels by default — no ambiguity for our build. |
| GinaRose $1.5B outlier skews AUM display | LOW | UI shows both count and AUM columns. No code change needed. |
| EXCLUDED_SGAS drift between leaderboard query and picklist API in SGA Hub | LOW | SGM Hub should use a single exclusion list (or none, if User table filtering is sufficient). |

### No Blockers
- All required BigQuery fields exist with 100% population on joined records
- No view changes needed
- No Prisma changes needed for Phase 1 (quota model is Phase 3)
- All SGA patterns are clean and replicable

---

## 9. Key Implementation Notes

### BigQuery Query Pattern (verified by data-verifier)
```sql
WITH ActiveSGMs AS (
  SELECT DISTINCT u.Name AS sgm_name
  FROM `savvy-gtm-analytics.SavvyGTMData.User` u
  WHERE u.Is_SGM__c = TRUE AND u.IsActive = TRUE
  -- Optional: AND u.Name IN UNNEST(@sgmNames)
),
JoinedData AS (
  SELECT
    v.SGM_Owner_Name__c AS sgm_name,
    v.Full_prospect_id__c AS primary_key,
    v.Opportunity_AUM
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
  WHERE v.is_joined_unique = 1
    AND v.joined_cohort_month IN UNNEST(@quarterMonths)
    AND v.Channel_Grouping_Name IN UNNEST(@channels)
    -- Optional: AND v.Original_source IN UNNEST(@sources)
)
SELECT
  a.sgm_name,
  COUNT(DISTINCT j.primary_key) AS joined_count,
  COALESCE(SUM(j.Opportunity_AUM), 0) AS total_aum
FROM ActiveSGMs a
LEFT JOIN JoinedData j ON j.sgm_name = a.sgm_name
GROUP BY a.sgm_name
ORDER BY total_aum DESC, a.sgm_name ASC
```

### Quarter Month Mapping
Use `joined_cohort_month` (STRING 'YYYY-MM') for filtering. Map quarters to months:
- Q1 2026 → `['2026-01', '2026-02', '2026-03']`
- Q4 2025 → `['2025-10', '2025-11', '2025-12']`

### SGM Name Resolution (simpler than SGA)
- SGA: requires COALESCE chain + Id-based join (`Opp_SGA_Name__c` → User.Id → User.Name)
- SGM: direct string match (`SGM_Owner_Name__c = User.Name`) — no COALESCE needed

### Key Helper Imports
- `getCurrentQuarter()`, `getQuarterInfo()` from `src/lib/utils/sga-hub-helpers.ts`
- `toNumber()`, `toString()` from `src/types/bigquery-raw`
- `cachedQuery`, `CACHE_TAGS` from `src/lib/cache.ts`
- `runQuery` from `src/lib/bigquery`

---

## 10. Documentation

The implementation guide must include:
- Phase 7.5: Run `npx agent-guard sync` after code changes pass build
- Phase 8: Run `npm run gen:api-routes` to update API route inventory
- Final: Write `.ai-session-context.md` before commit (Wrike integration)
