# Agentic Implementation Guide: SGM Hub — Phase 1 (Leaderboard Tab)

## Reference Documents
All decisions in this guide are based on the completed exploration files:
- `docs/exploration-results.md` — synthesized findings (single source of truth)
- `docs/code-inspector-findings.md` — code patterns, types, file paths
- `docs/data-verifier-findings.md` — BigQuery field verification, data quality
- `docs/pattern-finder-findings.md` — end-to-end flow patterns
- `sgm-hub-infrastructure.md` — infrastructure investigation

## Feature Summary

| Capability | Source | Notes |
|---|---|---|
| SGM Leaderboard ranked by Joined AUM | `vw_funnel_master` + `SavvyGTMData.User` | 100% field population for joined records |
| Leaderboard filters (quarter, channels, sources, SGMs) | Mirrors SGA `LeaderboardFilters.tsx` | ALL channels default (not 3 like SGA) |
| Drilldown on # Joined and Joined AUM | `MetricDrillDownModal` (cross-import from sga-hub) | Add `joined` metric type |
| Tab infrastructure (3 tabs, only leaderboard active) | Mirrors SGA `SGAHubTabs.tsx` | Dashboard + Quota Tracking = "Coming Soon" |
| Navigation + permissions | Page ID 18 | Roles: admin, manager, sgm, revops_admin |

## Architecture Rules
- Never use string interpolation in BigQuery queries — always `@paramName` syntax
- All queries target `vw_funnel_master` via `FULL_TABLE` constant from `@/config/constants`
- Use `toString()` / `toNumber()` helpers from `@/types/bigquery-raw` for type-safe transforms
- Use `cachedQuery()` wrapper from `@/lib/cache` for all exported query functions
- SGM User table field is `Is_SGM__c` (with underscore) — NOT `IsSGM__c`. Using wrong name returns 0 rows silently.
- SGM name resolution is direct string match: `v.SGM_Owner_Name__c = u.Name` (no COALESCE chain like SGA)

## Pre-Flight Checklist

```bash
npm run build 2>&1 | tail -5
```

If pre-existing errors, stop and report. Do not proceed with a broken baseline.

---

# PHASE 1: Permissions + Navigation

## Context
Add SGM Hub as page 18 to the permissions system and navigation sidebar. After this phase, the sidebar link will appear for the correct roles, but will 404 until the page route is created in Phase 3.

## Step 1.1: Update permissions.ts — add page 18

**File**: `src/lib/permissions.ts`

Add `18` to the `allowedPages` array for these 4 roles:

**revops_admin** (line 16): Change:
```typescript
allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
```
To:
```typescript
allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
```

**admin** (line 23): Change:
```typescript
allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17],
```
To:
```typescript
allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18],
```

**manager** (line 30): Change:
```typescript
allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15],
```
To:
```typescript
allowedPages: [1, 3, 7, 8, 9, 10, 11, 12, 13, 15, 18],
```

**sgm** (line 37): Change:
```typescript
allowedPages: [1, 3, 7, 10, 13, 15],
```
To:
```typescript
allowedPages: [1, 3, 7, 10, 13, 15, 18],
```

**Do NOT add 18 to**: `sga`, `viewer`, `recruiter`, `capital_partner`.

## Step 1.2: Update Sidebar.tsx — add SGM Hub nav link

**File**: `src/components/layout/Sidebar.tsx`

Add `Trophy` to the existing lucide-react import (line 9-12):
```typescript
import {
  BarChart3, BarChart2, Settings, Menu, X, Target,
  Bot, Users, Layers, Briefcase, MessageSquarePlus, MapPin, Banknote, Trophy
} from 'lucide-react';
```

Add SGM Hub entry to the `PAGES` array (after the SGA Hub entry, line 53):
```typescript
{ id: 18, name: 'SGM Hub', href: '/dashboard/sgm-hub', icon: Trophy },
```

Insert it after `{ id: 8, name: 'SGA Hub', ... }` so the sidebar reads: SGA Hub, SGM Hub, SGA Management, ...

## Step 1.3: Update cache.ts — add SGM_HUB cache tag

**File**: `src/lib/cache.ts`

Add to the `CACHE_TAGS` object (line 11-14):
```typescript
export const CACHE_TAGS = {
  DASHBOARD: 'dashboard',
  SGA_HUB: 'sga-hub',
  SGM_HUB: 'sgm-hub',
} as const;
```

## PHASE 1 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | tail -5
```

**Expected**: Zero new TypeScript errors. The only changes are array values and an import addition.

```bash
grep -n "18" src/lib/permissions.ts
grep -n "SGM Hub" src/components/layout/Sidebar.tsx
grep -n "SGM_HUB" src/lib/cache.ts
```

**Expected**: All three greps find the new entries.

**STOP AND REPORT**: Tell the user:
- "Phase 1 complete: permissions (page 18 for 4 roles), sidebar nav link, cache tag added."
- "Ready to proceed to Phase 2 (Types)?"

---

# PHASE 2: Type Definitions

## Context
Create new TypeScript types for the SGM Hub. These are entirely new types in a new file — we do NOT modify existing SGA types. We also add the `joined` metric type to the drill-down type system.

## Step 2.1: Create src/types/sgm-hub.ts

**File**: `src/types/sgm-hub.ts` (NEW)

```typescript
// src/types/sgm-hub.ts

/**
 * SGM Hub tab identifiers
 * Phase 1: only 'leaderboard' is active
 * Phase 2+: 'dashboard' and 'quota-tracking' will be implemented
 */
export type SGMHubTab = 'leaderboard' | 'dashboard' | 'quota-tracking';

/**
 * SGM Leaderboard entry — one row per SGM
 * Ranked by joinedAum descending
 */
export interface SGMLeaderboardEntry {
  sgmName: string;
  joinedCount: number;
  joinedAum: number;            // Raw number for sorting/ranking
  joinedAumFormatted: string;   // Pre-formatted display string e.g. "$458.0M"
  rank: number;                 // Calculated after query, ties share rank
}

/**
 * Filters for SGM Leaderboard API
 * Mirrors SGA LeaderboardFilters but with sgmNames instead of sgaNames
 */
export interface SGMLeaderboardFilters {
  startDate: string;       // YYYY-MM-DD (quarter start)
  endDate: string;         // YYYY-MM-DD (quarter end)
  channels: string[];      // Required, non-empty. Default: ALL channels
  sources?: string[];      // Optional; omit = all sources
  sgmNames?: string[];     // Optional; omit = all active SGMs
}

/**
 * SGM option for filter picklist
 */
export interface SGMOption {
  value: string;
  label: string;
  isActive: boolean;
}
```

## Step 2.2: Update src/types/drill-down.ts — add joined metric types

**File**: `src/types/drill-down.ts`

**2.2a** — Add `'joined'` to `MetricType` union (line 8):

Change:
```typescript
export type MetricType = 'initial-calls' | 'qualification-calls' | 'sqos' | 'open-sqls' | 'mqls' | 'sqls' | 'leads-sourced' | 'leads-contacted';
```
To:
```typescript
export type MetricType = 'initial-calls' | 'qualification-calls' | 'sqos' | 'open-sqls' | 'mqls' | 'sqls' | 'leads-sourced' | 'leads-contacted' | 'joined';
```

**2.2b** — Add `JoinedDrillDownRecord` interface (after `LeadsContactedRecord`, before the union type):

```typescript
// Joined Advisor Drill-Down Record (SGM Hub leaderboard)
export interface JoinedDrillDownRecord extends DrillDownRecordBase {
  joinDate: string;
  sgmName: string;
  aum: number;
  aumFormatted: string;
  aumTier: string | null;
  stageName: string | null;
}
```

**2.2c** — Add to `DrillDownRecord` union (line 96):

Change:
```typescript
export type DrillDownRecord = InitialCallRecord | QualificationCallRecord | SQODrillDownRecord | OpenSQLDrillDownRecord | MQLDrillDownRecord | SQLDrillDownRecord | LeadsSourcedRecord | LeadsContactedRecord;
```
To:
```typescript
export type DrillDownRecord = InitialCallRecord | QualificationCallRecord | SQODrillDownRecord | OpenSQLDrillDownRecord | MQLDrillDownRecord | SQLDrillDownRecord | LeadsSourcedRecord | LeadsContactedRecord | JoinedDrillDownRecord;
```

**2.2d** — Add raw BigQuery type for joined drill-down (after existing raw types, before the DrillDownContext):

```typescript
export interface RawJoinedDrillDownRecord {
  primary_key: string;
  advisor_name: string;
  advisor_join_date__c: string | { value: string } | null;
  Original_source: string;
  Channel_Grouping_Name: string | null;
  SGM_Owner_Name__c: string | null;
  Opportunity_AUM: number | null;
  aum_tier: string | null;
  TOF_Stage: string;
  StageName: string | null;
  lead_url: string | null;
  opportunity_url: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
}
```

**2.2e** — Update `DrillDownContext` to support SGM context (add `sgmName` field):

Change the existing `DrillDownContext` interface:
```typescript
export interface DrillDownContext {
  metricType: MetricType;
  title: string;
  sgaName: string | null;
  weekStartDate?: string;
  weekEndDate?: string;
  quarter?: string;
}
```
To:
```typescript
export interface DrillDownContext {
  metricType: MetricType;
  title: string;
  sgaName: string | null;
  sgmName?: string | null;
  weekStartDate?: string;
  weekEndDate?: string;
  quarter?: string;
}
```

## PHASE 2 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | tail -10
```

**Expected**: May see errors in `MetricDrillDownModal.tsx` because `COLUMN_CONFIGS` doesn't have a `'joined'` key yet. Count these errors — they will be fixed in Phase 8.

```bash
grep -c "joined" src/types/drill-down.ts
grep -c "SGMLeaderboardEntry" src/types/sgm-hub.ts
```

**Expected**: Multiple matches in drill-down.ts; at least 1 in sgm-hub.ts.

**STOP AND REPORT**: Tell the user:
- "Phase 2 complete: SGM Hub types created, joined drill-down types added."
- "Expected build errors from MetricDrillDownModal (missing 'joined' column config) — will be fixed in Phase 8."
- "Ready to proceed to Phase 3 (Page scaffold + tabs)?"

---

# PHASE 3: Page Scaffold + Tabs

## Context
Create the SGM Hub route, client content component, and tab bar. After this phase, navigating to `/dashboard/sgm-hub` will render the tab bar with a "Coming Soon" placeholder for each tab (leaderboard will be wired in Phase 7).

## Step 3.1: Create SGMHubTabs component

**File**: `src/components/sgm-hub/SGMHubTabs.tsx` (NEW)

Create the directory first, then the file. Mirror `src/components/sga-hub/SGAHubTabs.tsx` exactly:

```typescript
// src/components/sgm-hub/SGMHubTabs.tsx

'use client';

import { Trophy, LayoutDashboard, Target } from 'lucide-react';
import { SGMHubTab } from '@/types/sgm-hub';

export type { SGMHubTab };

interface SGMHubTabsProps {
  activeTab: SGMHubTab;
  onTabChange: (tab: SGMHubTab) => void;
}

const tabs: { id: SGMHubTab; label: string; icon: typeof Trophy }[] = [
  { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'quota-tracking', label: 'Quota Tracking', icon: Target },
];

export function SGMHubTabs({ activeTab, onTabChange }: SGMHubTabsProps) {
  return (
    <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
              isActive
                ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300'
            }`}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
```

## Step 3.2: Create SGMHubContent client component

**File**: `src/app/dashboard/sgm-hub/SGMHubContent.tsx` (NEW)

This is the main client component. For Phase 3, it only renders the tab bar and placeholder content. Leaderboard data fetching will be added in Phase 7.

```typescript
// src/app/dashboard/sgm-hub/SGMHubContent.tsx

'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { getSessionPermissions } from '@/types/auth';
import { SGMHubTabs } from '@/components/sgm-hub/SGMHubTabs';
import { SGMHubTab } from '@/types/sgm-hub';

export function SGMHubContent() {
  const { data: session } = useSession();
  const permissions = session ? getSessionPermissions(session) : null;

  const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';
  const isSGM = permissions?.role === 'sgm';
  const sgmName = session?.user?.name || 'Unknown';

  // Tab state
  const [activeTab, setActiveTab] = useState<SGMHubTab>('leaderboard');

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4 text-gray-900 dark:text-gray-100">
        SGM Hub
      </h1>

      <SGMHubTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab content */}
      {activeTab === 'leaderboard' && (
        <div className="text-gray-500 dark:text-gray-400 py-12 text-center">
          Leaderboard loading... (will be wired in Phase 7)
        </div>
      )}

      {activeTab === 'dashboard' && (
        <div className="text-gray-500 dark:text-gray-400 py-12 text-center">
          <p className="text-lg font-medium">Dashboard</p>
          <p className="mt-2">Coming soon in Phase 2 of the SGM Hub build.</p>
        </div>
      )}

      {activeTab === 'quota-tracking' && (
        <div className="text-gray-500 dark:text-gray-400 py-12 text-center">
          <p className="text-lg font-medium">Quota Tracking</p>
          <p className="mt-2">Coming soon in Phase 3 of the SGM Hub build.</p>
        </div>
      )}
    </div>
  );
}
```

## Step 3.3: Create page.tsx server component

**File**: `src/app/dashboard/sgm-hub/page.tsx` (NEW)

Mirror `src/app/dashboard/sga-hub/page.tsx` exactly, changing only the role list and component import:

```typescript
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { SGMHubContent } from './SGMHubContent';

export const dynamic = 'force-dynamic';

export default async function SGMHubPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect('/login');
  }

  const permissions = getSessionPermissions(session);
  if (!permissions) {
    redirect('/login');
  }

  // Only SGM, admin, manager, and revops_admin roles can access
  if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
    redirect('/dashboard');
  }

  return <SGMHubContent />;
}
```

## PHASE 3 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

**Expected**: Only the MetricDrillDownModal errors from Phase 2 (missing 'joined' in COLUMN_CONFIGS). No new errors from Phase 3 files.

```bash
ls -la src/app/dashboard/sgm-hub/
ls -la src/components/sgm-hub/
```

**Expected**: `page.tsx`, `SGMHubContent.tsx` in the route dir; `SGMHubTabs.tsx` in the components dir.

**STOP AND REPORT**: Tell the user:
- "Phase 3 complete: Page scaffold, tab bar, and placeholder content created."
- "You can now navigate to `/dashboard/sgm-hub` and see the tab bar."
- "Ready to proceed to Phase 4 (Query function)?"

---

# PHASE 4: BigQuery Query Function

## Context
Create the SGM leaderboard query function mirroring `src/lib/queries/sga-leaderboard.ts`. Key differences from SGA:
- Uses `Is_SGM__c = TRUE` (not `IsSGA__c`)
- Direct string match `SGM_Owner_Name__c = u.Name` (no COALESCE chain)
- Groups by SGM name, counts joined advisors, sums AUM
- Ranks by `joinedAum` descending (not sqoCount)
- Uses `joined_cohort_month` for date filtering (not `Date_Became_SQO__c`)
- No `recordtypeid` filter needed (is_joined_unique already handles it)
- No excluded names list needed (User table Is_SGM__c filter handles it)

## Step 4.1: Create src/lib/queries/sgm-leaderboard.ts

**File**: `src/lib/queries/sgm-leaderboard.ts` (NEW)

```typescript
// src/lib/queries/sgm-leaderboard.ts

import { runQuery } from '@/lib/bigquery';
import { SGMLeaderboardEntry, SGMLeaderboardFilters } from '@/types/sgm-hub';
import { FULL_TABLE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { toNumber, toString } from '@/types/bigquery-raw';

/**
 * Raw BigQuery result for SGM leaderboard entry
 */
interface RawSGMLeaderboardResult {
  sgm_name: string;
  joined_count: number | null;
  total_aum: number | null;
}

/**
 * Format AUM for display
 * Examples: $0, $18.4M, $458.0M, $1.57B
 */
function formatAum(aum: number): string {
  if (aum === 0) return '$0';
  if (aum >= 1_000_000_000) return `$${(aum / 1_000_000_000).toFixed(2)}B`;
  if (aum >= 1_000_000) return `$${(aum / 1_000_000).toFixed(1)}M`;
  if (aum >= 1_000) return `$${(aum / 1_000).toFixed(0)}K`;
  return `$${aum.toFixed(0)}`;
}

/**
 * Calculate ranks for SGM leaderboard entries
 * Ranked by joinedAum (descending). Ties share rank, next rank increments by 1.
 * Input must already be sorted by total_aum DESC (SQL ORDER BY guarantees this).
 * Example: AUMs [500M, 300M, 300M, 100M] -> ranks [1, 2, 2, 3]
 */
function calculateRanks(entries: SGMLeaderboardEntry[]): SGMLeaderboardEntry[] {
  if (entries.length === 0) return [];

  let currentRank = 1;
  let previousAum: number | null = null;

  return entries.map((entry, index) => {
    if (index === 0) {
      previousAum = entry.joinedAum;
      return { ...entry, rank: currentRank };
    }

    if (entry.joinedAum !== previousAum) {
      currentRank++;
      previousAum = entry.joinedAum;
    }

    return { ...entry, rank: currentRank };
  });
}

/**
 * Convert quarter string "YYYY-QN" to array of month strings for joined_cohort_month filtering
 * Example: "2026-Q1" -> ["2026-01", "2026-02", "2026-03"]
 */
function quarterToMonths(quarter: string): string[] {
  const [yearStr, qStr] = quarter.split('-Q');
  const year = parseInt(yearStr, 10);
  const q = parseInt(qStr, 10);
  const startMonth = (q - 1) * 3 + 1;
  return [
    `${year}-${String(startMonth).padStart(2, '0')}`,
    `${year}-${String(startMonth + 1).padStart(2, '0')}`,
    `${year}-${String(startMonth + 2).padStart(2, '0')}`,
  ];
}

/**
 * Get SGM leaderboard with Joined counts and AUM for a given quarter and filters
 */
const _getSGMLeaderboard = async (
  filters: SGMLeaderboardFilters
): Promise<SGMLeaderboardEntry[]> => {
  const { startDate, endDate, channels, sources, sgmNames } = filters;

  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required');
  }
  if (!channels || channels.length === 0) {
    throw new Error('At least one channel is required');
  }

  // Build optional filter clauses
  const sourceFilter = sources && sources.length > 0
    ? 'AND v.Original_source IN UNNEST(@sources)'
    : '';

  // SGM name filter: if specific SGMs selected, filter to those; otherwise get all active SGMs
  const sgmWhereClause = sgmNames && sgmNames.length > 0
    ? 'AND u.Name IN UNNEST(@sgmNames)'
    : '';

  // Derive quarter months from the date range for joined_cohort_month filtering
  // The startDate/endDate come from getQuarterInfo() so we can derive months
  const startYear = parseInt(startDate.substring(0, 4), 10);
  const startMonth = parseInt(startDate.substring(5, 7), 10);
  const endMonth = parseInt(endDate.substring(5, 7), 10);
  const quarterMonths: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    quarterMonths.push(`${startYear}-${String(m).padStart(2, '0')}`);
  }

  const query = `
    WITH ActiveSGMs AS (
      SELECT DISTINCT u.Name AS sgm_name
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.Is_SGM__c = TRUE
        AND u.IsActive = TRUE
        ${sgmWhereClause}
    ),
    JoinedData AS (
      SELECT
        v.SGM_Owner_Name__c AS sgm_name,
        v.Full_prospect_id__c AS primary_key,
        v.Opportunity_AUM
      FROM \`${FULL_TABLE}\` v
      WHERE v.is_joined_unique = 1
        AND v.joined_cohort_month IN UNNEST(@quarterMonths)
        AND v.Channel_Grouping_Name IN UNNEST(@channels)
        ${sourceFilter}
    )
    SELECT
      a.sgm_name,
      COUNT(DISTINCT j.primary_key) AS joined_count,
      COALESCE(SUM(j.Opportunity_AUM), 0) AS total_aum
    FROM ActiveSGMs a
    LEFT JOIN JoinedData j ON j.sgm_name = a.sgm_name
    GROUP BY a.sgm_name
    ORDER BY total_aum DESC, a.sgm_name ASC
  `;

  const params: Record<string, any> = {
    quarterMonths,
    channels,
  };

  if (sources && sources.length > 0) {
    params.sources = sources;
  }
  if (sgmNames && sgmNames.length > 0) {
    params.sgmNames = sgmNames;
  }

  const results = await runQuery<RawSGMLeaderboardResult>(query, params);

  const entries: SGMLeaderboardEntry[] = results.map((row) => {
    const aum = toNumber(row.total_aum);
    return {
      sgmName: toString(row.sgm_name),
      joinedCount: toNumber(row.joined_count),
      joinedAum: aum,
      joinedAumFormatted: formatAum(aum),
      rank: 0,
    };
  });

  return calculateRanks(entries);
};

export const getSGMLeaderboard = cachedQuery(
  _getSGMLeaderboard,
  'getSGMLeaderboard',
  CACHE_TAGS.SGM_HUB
);
```

## Step 4.2: Create joined drill-down query function

**File**: `src/lib/queries/sgm-leaderboard.ts` (append to same file)

Add this after the `getSGMLeaderboard` export:

```typescript
/**
 * Raw BigQuery result for joined drill-down
 */
interface RawJoinedDrillDown {
  primary_key: string;
  advisor_name: string;
  advisor_join_date__c: string | { value: string } | null;
  Original_source: string;
  Channel_Grouping_Name: string | null;
  SGM_Owner_Name__c: string | null;
  Opportunity_AUM: number | null;
  aum_tier: string | null;
  TOF_Stage: string;
  StageName: string | null;
  lead_url: string | null;
  opportunity_url: string | null;
  Next_Steps__c: string | null;
  NextStep: string | null;
}

/**
 * Extract date string from BigQuery result (handles both string and {value: string} formats)
 */
function extractDate(val: string | { value: string } | null | undefined): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && 'value' in val) return val.value;
  return '';
}

/**
 * Get joined advisor drill-down records for a specific SGM
 */
const _getJoinedDrillDown = async (
  sgmName: string,
  startDate: string,
  endDate: string,
  options?: {
    channels?: string[];
    sources?: string[];
  }
): Promise<import('@/types/drill-down').JoinedDrillDownRecord[]> => {
  const { channels, sources } = options || {};

  const channelFilter = channels && channels.length > 0
    ? 'AND v.Channel_Grouping_Name IN UNNEST(@channels)'
    : '';
  const sourceFilter = sources && sources.length > 0
    ? 'AND v.Original_source IN UNNEST(@sources)'
    : '';

  // Derive quarter months from date range
  const startMonth = parseInt(startDate.substring(5, 7), 10);
  const endMonth = parseInt(endDate.substring(5, 7), 10);
  const startYear = parseInt(startDate.substring(0, 4), 10);
  const quarterMonths: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    quarterMonths.push(`${startYear}-${String(m).padStart(2, '0')}`);
  }

  const query = `
    SELECT
      v.primary_key,
      v.advisor_name,
      v.advisor_join_date__c,
      v.Original_source,
      v.Channel_Grouping_Name,
      v.SGM_Owner_Name__c,
      v.Opportunity_AUM,
      v.aum_tier,
      v.TOF_Stage,
      v.StageName,
      v.lead_url,
      v.opportunity_url,
      v.Next_Steps__c,
      v.NextStep
    FROM \`${FULL_TABLE}\` v
    WHERE v.is_joined_unique = 1
      AND v.joined_cohort_month IN UNNEST(@quarterMonths)
      AND v.SGM_Owner_Name__c = @sgmName
      ${channelFilter}
      ${sourceFilter}
    ORDER BY v.advisor_join_date__c DESC
  `;

  const params: Record<string, any> = {
    quarterMonths,
    sgmName,
  };
  if (channels && channels.length > 0) params.channels = channels;
  if (sources && sources.length > 0) params.sources = sources;

  const results = await runQuery<RawJoinedDrillDown>(query, params);

  return results.map((row) => {
    const aum = row.Opportunity_AUM ?? 0;
    return {
      primaryKey: toString(row.primary_key),
      advisorName: toString(row.advisor_name),
      joinDate: extractDate(row.advisor_join_date__c),
      source: toString(row.Original_source),
      channel: toString(row.Channel_Grouping_Name) || 'Other',
      sgmName: toString(row.SGM_Owner_Name__c),
      aum,
      aumFormatted: formatAum(aum),
      aumTier: row.aum_tier ?? null,
      tofStage: toString(row.TOF_Stage),
      leadUrl: row.lead_url ?? null,
      opportunityUrl: row.opportunity_url ?? null,
      nextSteps: row.Next_Steps__c ?? null,
      opportunityNextStep: row.NextStep ?? null,
      daysInCurrentStage: null,
      stageName: row.StageName ?? null,
    };
  });
};

export const getJoinedDrillDown = cachedQuery(
  _getJoinedDrillDown,
  'getJoinedDrillDown',
  CACHE_TAGS.SGM_HUB
);
```

## PHASE 4 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep "sgm-leaderboard" | head -5
```

**Expected**: Zero errors from the new query file.

```bash
grep -c "getSGMLeaderboard\|getJoinedDrillDown" src/lib/queries/sgm-leaderboard.ts
```

**Expected**: At least 4 matches (2 function defs + 2 exports).

**STOP AND REPORT**: Tell the user:
- "Phase 4 complete: SGM leaderboard query + joined drill-down query created."
- "Ready to proceed to Phase 5 (API Routes)?"

---

# PHASE 5: API Routes

## Context
Create 3 API routes for the SGM Hub leaderboard. Each mirrors an SGA Hub equivalent.

## Step 5.1: Create POST /api/sgm-hub/leaderboard

**File**: `src/app/api/sgm-hub/leaderboard/route.ts` (NEW)

```typescript
// src/app/api/sgm-hub/leaderboard/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getSGMLeaderboard } from '@/lib/queries/sgm-leaderboard';
import { SGMLeaderboardFilters } from '@/types/sgm-hub';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { startDate, endDate, channels, sources, sgmNames } = body as SGMLeaderboardFilters;

    if (!startDate || !endDate) {
      return NextResponse.json(
        { error: 'startDate and endDate are required' },
        { status: 400 }
      );
    }

    if (!channels || !Array.isArray(channels) || channels.length === 0) {
      return NextResponse.json(
        { error: 'At least one channel is required' },
        { status: 400 }
      );
    }

    const filters: SGMLeaderboardFilters = {
      startDate,
      endDate,
      channels,
      sources: sources && sources.length > 0 ? sources : undefined,
      sgmNames: sgmNames && sgmNames.length > 0 ? sgmNames : undefined,
    };

    const entries = await getSGMLeaderboard(filters);

    return NextResponse.json({ entries });

  } catch (error) {
    console.error('[API] Error fetching SGM leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM leaderboard' },
      { status: 500 }
    );
  }
}
```

## Step 5.2: Create GET /api/sgm-hub/sgm-options

**File**: `src/app/api/sgm-hub/sgm-options/route.ts` (NEW)

```typescript
// src/app/api/sgm-hub/sgm-options/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { runQuery } from '@/lib/bigquery';
import { toString } from '@/types/bigquery-raw';

export const dynamic = 'force-dynamic';

interface RawSGMOption {
  sgm_name: string | null;
  is_active: boolean | number | null;
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const query = `
      SELECT DISTINCT
        u.Name as sgm_name,
        u.IsActive as is_active
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.Is_SGM__c = TRUE
      ORDER BY u.Name
    `;

    const results = await runQuery<RawSGMOption>(query);

    const sgmOptions = results
      .filter(r => r.sgm_name !== null)
      .map(r => ({
        value: toString(r.sgm_name),
        label: toString(r.sgm_name),
        isActive: r.is_active === true || r.is_active === 1,
      }));

    return NextResponse.json({ sgmOptions });

  } catch (error) {
    console.error('[API] Error fetching SGM options:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGM options' },
      { status: 500 }
    );
  }
}
```

## Step 5.3: Create GET /api/sgm-hub/drill-down/joined

**File**: `src/app/api/sgm-hub/drill-down/joined/route.ts` (NEW)

```typescript
// src/app/api/sgm-hub/drill-down/joined/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/types/auth';
import { getJoinedDrillDown } from '@/lib/queries/sgm-leaderboard';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = getSessionPermissions(session);
    if (!permissions) {
      return NextResponse.json({ error: 'Session invalid' }, { status: 401 });
    }
    if (!['admin', 'manager', 'sgm', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const sgmName = searchParams.get('sgmName');
    const quarter = searchParams.get('quarter');
    const channels = searchParams.getAll('channels');
    const sources = searchParams.getAll('sources');

    if (!sgmName) {
      return NextResponse.json({ error: 'sgmName is required' }, { status: 400 });
    }
    if (!quarter) {
      return NextResponse.json({ error: 'quarter is required' }, { status: 400 });
    }

    const quarterInfo = getQuarterInfo(quarter);

    const records = await getJoinedDrillDown(
      sgmName,
      quarterInfo.startDate,
      quarterInfo.endDate,
      {
        channels: channels.length > 0 ? channels : undefined,
        sources: sources.length > 0 ? sources : undefined,
      }
    );

    return NextResponse.json({ records });

  } catch (error) {
    console.error('[API] Error fetching joined drill-down:', error);
    return NextResponse.json(
      { error: 'Failed to fetch joined advisor records' },
      { status: 500 }
    );
  }
}
```

## PHASE 5 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep "sgm-hub" | head -10
```

**Expected**: Zero errors from the new API route files.

```bash
ls -R src/app/api/sgm-hub/
```

**Expected**: `leaderboard/route.ts`, `sgm-options/route.ts`, `drill-down/joined/route.ts`

**STOP AND REPORT**: Tell the user:
- "Phase 5 complete: 3 API routes created (leaderboard, sgm-options, drill-down/joined)."
- "Ready to proceed to Phase 6 (API Client)?"

---

# PHASE 6: API Client

## Context
Add SGM Hub methods to the dashboard API client so frontend components can call the new API routes.

## Step 6.1: Add SGM Hub methods to api-client.ts

**File**: `src/lib/api-client.ts`

First, add the import for SGM types. Find the existing import from `@/types/sga-hub` and add a new import below it:

```typescript
import { SGMLeaderboardEntry } from '@/types/sgm-hub';
import { JoinedDrillDownRecord } from '@/types/drill-down';
```

Then add these methods inside the `dashboardApi` object, after the SGA Hub methods section (after `getLeaderboardSGAOptions`, around line 650):

```typescript
  // ============================================
  // SGM Hub methods
  // ============================================

  getSGMLeaderboard: (filters: {
    startDate: string;
    endDate: string;
    channels: string[];
    sources?: string[];
    sgmNames?: string[];
  }) =>
    apiFetch<{ entries: SGMLeaderboardEntry[] }>('/api/sgm-hub/leaderboard', {
      method: 'POST',
      body: JSON.stringify(filters),
    }),

  getLeaderboardSGMOptions: () =>
    apiFetch<{ sgmOptions: Array<{ value: string; label: string; isActive: boolean }> }>(
      '/api/sgm-hub/sgm-options'
    ),

  getJoinedDrillDown: (
    sgmName: string,
    options: { quarter: string },
    channels?: string[],
    sources?: string[],
  ) => {
    const params = new URLSearchParams({
      sgmName,
      quarter: options.quarter,
    });
    if (channels && channels.length > 0) {
      channels.forEach(ch => params.append('channels', ch));
    }
    if (sources && sources.length > 0) {
      sources.forEach(src => params.append('sources', src));
    }
    return apiFetch<{ records: JoinedDrillDownRecord[] }>(
      `/api/sgm-hub/drill-down/joined?${params.toString()}`
    );
  },
```

## PHASE 6 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep "api-client" | head -5
```

**Expected**: Zero errors from api-client.ts changes.

```bash
grep -c "sgm-hub" src/lib/api-client.ts
```

**Expected**: At least 3 matches (the 3 endpoint URLs).

**STOP AND REPORT**: Tell the user:
- "Phase 6 complete: 3 SGM Hub methods added to API client."
- "Ready to proceed to Phase 7 (Components)?"

---

# PHASE 7: Components + Page Assembly

## Context
Create the leaderboard filter and table components, then wire everything into SGMHubContent. This is the largest phase.

## Step 7.1: Create SGMLeaderboardFilters component

**File**: `src/components/sgm-hub/SGMLeaderboardFilters.tsx` (NEW)

This component mirrors `src/components/sga-hub/LeaderboardFilters.tsx` with these differences:
- Prop `selectedSGAs` → `selectedSGMs`, `sgaOptions` → `sgmOptions`
- Default channels = ALL (not 3 outbound channels)
- Filter labels say "SGMs" not "SGAs"
- Color coding: orange pills for SGMs (same as SGAs in SGA Hub)

Read `src/components/sga-hub/LeaderboardFilters.tsx` in full, then create the SGM variant. The component must implement:

1. **Props**: `selectedQuarter`, `selectedChannels`, `selectedSources`, `selectedSGMs`, `channelOptions`, `sourceOptions`, `sgmOptions`, `sgmOptionsLoading`, `onApply`, `disabled`
2. **Local pending state**: `localQuarter`, `localChannels`, `localSources`, `localSGMs`
3. **Sync-back useEffect**: syncs local state from props after Apply
4. **hasPendingChanges**: bi-directional set comparison across all 4 dimensions
5. **hasCustomFilters**: non-default detection
6. **handleApplyFilters**: normalizes empty arrays to defaults before calling onApply
7. **handleResetFilters**: resets to ALL channels (not 2 like SGA), current quarter, empty sources/SGMs
8. **Quarter selector**: last 8 quarters DESC
9. **Channel checkboxes**: Select All / Deselect All
10. **Source checkboxes**: with text search
11. **SGM checkboxes**: with text search, Active Only toggle

**Critical difference from SGA**: `handleResetFilters` must set channels to `channelOptions` (all channels), not a hardcoded subset.

Copy the full `LeaderboardFilters.tsx` from `src/components/sga-hub/` and make these changes:
- Rename all `sga` → `sgm`, `SGA` → `SGM` in props, state, labels
- Change `handleResetFilters` default channels from `['Outbound', 'Outbound + Marketing']` to `channelOptions` (all channels)
- Update the `onApply` callback key from `sgas` to `sgms`

## Step 7.2: Create SGMLeaderboardTable component

**File**: `src/components/sgm-hub/SGMLeaderboardTable.tsx` (NEW)

Mirror `src/components/sga-hub/LeaderboardTable.tsx` with these changes:
- Props: `entries: SGMLeaderboardEntry[]`, `onJoinedClick`, `onAumClick`, `currentUserSgmName`
- Columns: Rank, SGM Name, # Joined (clickable), Joined AUM (clickable)
- Same medal/color logic for top 3 ranks
- Same "You" badge pattern using `currentUserSgmName`

```typescript
// src/components/sgm-hub/SGMLeaderboardTable.tsx

'use client';

import {
  Table,
  TableHead,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  Badge,
} from '@tremor/react';
import { SGMLeaderboardEntry } from '@/types/sgm-hub';

interface SGMLeaderboardTableProps {
  entries: SGMLeaderboardEntry[];
  isLoading?: boolean;
  onJoinedClick?: (sgmName: string) => void;
  onAumClick?: (sgmName: string) => void;
  currentUserSgmName?: string;
}

function getRankStyling(rank: number) {
  switch (rank) {
    case 1:
      return {
        bg: 'bg-yellow-50 dark:bg-yellow-950/30',
        medal: '\u{1F947}',
        textColor: 'text-yellow-600 dark:text-yellow-400',
      };
    case 2:
      return {
        bg: 'bg-gray-50 dark:bg-gray-800/50',
        medal: '\u{1F948}',
        textColor: 'text-gray-600 dark:text-gray-400',
      };
    case 3:
      return {
        bg: 'bg-orange-50 dark:bg-orange-950/30',
        medal: '\u{1F949}',
        textColor: 'text-orange-600 dark:text-orange-400',
      };
    default:
      return { bg: '', medal: '', textColor: 'text-gray-700 dark:text-gray-300' };
  }
}

export function SGMLeaderboardTable({
  entries,
  isLoading,
  onJoinedClick,
  onAumClick,
  currentUserSgmName,
}: SGMLeaderboardTableProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-gray-400">
        No SGM data found for the selected filters.
      </div>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell className="w-16">Rank</TableHeaderCell>
          <TableHeaderCell className="w-48">SGM Name</TableHeaderCell>
          <TableHeaderCell className="w-28 text-right"># Joined</TableHeaderCell>
          <TableHeaderCell className="w-36 text-right">Joined AUM</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {entries.map((entry, index) => {
          const styling = getRankStyling(entry.rank);
          const isCurrentUser = currentUserSgmName && entry.sgmName === currentUserSgmName;
          const zebraClass = !styling.bg ? (index % 2 === 0 ? 'bg-white dark:bg-gray-900' : 'bg-gray-50 dark:bg-gray-800/50') : '';

          return (
            <TableRow
              key={entry.sgmName}
              className={`${styling.bg || zebraClass} ${isCurrentUser ? 'border-l-4 border-blue-500' : ''}`}
            >
              <TableCell>
                <span className={`font-semibold ${styling.textColor}`}>
                  {styling.medal && <span className="mr-1">{styling.medal}</span>}
                  {entry.rank}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {entry.sgmName}
                  </span>
                  {isCurrentUser && (
                    <Badge color="blue" size="xs">You</Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                {onJoinedClick ? (
                  <button
                    onClick={() => onJoinedClick(entry.sgmName)}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium hover:underline"
                  >
                    {entry.joinedCount}
                  </button>
                ) : (
                  <span className="text-gray-700 dark:text-gray-300">{entry.joinedCount}</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {onAumClick ? (
                  <button
                    onClick={() => onAumClick(entry.sgmName)}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium hover:underline"
                  >
                    {entry.joinedAumFormatted}
                  </button>
                ) : (
                  <span className="text-gray-700 dark:text-gray-300">{entry.joinedAumFormatted}</span>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
```

## Step 7.3: Wire everything into SGMHubContent.tsx

**File**: `src/app/dashboard/sgm-hub/SGMHubContent.tsx` (REWRITE)

Replace the Phase 3 placeholder with the full implementation. This is the largest file. Read `src/app/dashboard/sga-hub/SGAHubContent.tsx` for the exact pattern, then create the SGM version with:

1. **Session/permissions** (same pattern as SGA)
2. **Leaderboard state**: entries, loading, error, quarter, channels, sources, SGMs
3. **Filter options state**: channelOptions, sourceOptions, sgmOptions
4. **Drilldown state**: 7 modal state variables (same as SGA)
5. **Record detail state**: recordDetailOpen, recordDetailId
6. **useEffect mount**: fetch filter options + SGM options
7. **useEffect data fetch**: watches activeTab + all filter state
8. **fetchLeaderboard()**: calls `dashboardApi.getSGMLeaderboard()`
9. **handleJoinedClick(sgmName)**: opens drilldown modal, calls `dashboardApi.getJoinedDrillDown()`
10. **handleAumClick(sgmName)**: same drilldown as handleJoinedClick (same data, different title)
11. **handleRecordClick / handleBackToDrillDown**: same close/back pattern as SGA
12. **onApply handler**: sets filter state, triggers useEffect

**Key differences from SGA**:
- Default channels = ALL channels (set in useEffect after loading filter options)
- Filter onApply key is `sgms` not `sgas`
- `currentUserSgmName` derived from `permissions?.sgmFilter || sgmName`
- Import `MetricDrillDownModal` from `@/components/sga-hub/MetricDrillDownModal` (cross-import)
- Import `RecordDetailModal` from `@/components/dashboard/RecordDetailModal`

The executing agent should read `SGAHubContent.tsx` in full and adapt it. The key fetch function:

```typescript
const fetchLeaderboard = async () => {
  setLeaderboardLoading(true);
  setLeaderboardError(null);
  try {
    const quarterInfo = getQuarterInfo(leaderboardQuarter);
    const response = await dashboardApi.getSGMLeaderboard({
      startDate: quarterInfo.startDate,
      endDate: quarterInfo.endDate,
      channels: leaderboardChannels,
      sources: leaderboardSources.length > 0 ? leaderboardSources : undefined,
      sgmNames: leaderboardSGMs.length > 0 ? leaderboardSGMs : undefined,
    });
    setLeaderboardEntries(response.entries);
  } catch (err) {
    console.error('Error fetching SGM leaderboard:', err);
    setLeaderboardError('Failed to load leaderboard data');
  } finally {
    setLeaderboardLoading(false);
  }
};
```

The drilldown handler:

```typescript
const handleJoinedClick = async (sgmName: string) => {
  setDrillDownLoading(true);
  setDrillDownMetricType('joined');
  setDrillDownOpen(true);
  const title = `${sgmName} - Joined Advisors - ${leaderboardQuarter}`;
  setDrillDownTitle(title);
  setDrillDownContext({ metricType: 'joined', title, sgaName: null, sgmName, quarter: leaderboardQuarter });
  try {
    const response = await dashboardApi.getJoinedDrillDown(
      sgmName,
      { quarter: leaderboardQuarter },
      leaderboardChannels.length > 0 ? leaderboardChannels : undefined,
      leaderboardSources.length > 0 ? leaderboardSources : undefined,
    );
    setDrillDownRecords(response.records);
  } catch (err) {
    console.error('Error fetching joined drill-down:', err);
    setDrillDownError('Failed to load joined advisor records');
  } finally {
    setDrillDownLoading(false);
  }
};

const handleAumClick = async (sgmName: string) => {
  // Same drill-down as joined click, different title
  setDrillDownLoading(true);
  setDrillDownMetricType('joined');
  setDrillDownOpen(true);
  const title = `${sgmName} - Joined AUM - ${leaderboardQuarter}`;
  setDrillDownTitle(title);
  setDrillDownContext({ metricType: 'joined', title, sgaName: null, sgmName, quarter: leaderboardQuarter });
  try {
    const response = await dashboardApi.getJoinedDrillDown(
      sgmName,
      { quarter: leaderboardQuarter },
      leaderboardChannels.length > 0 ? leaderboardChannels : undefined,
      leaderboardSources.length > 0 ? leaderboardSources : undefined,
    );
    setDrillDownRecords(response.records);
  } catch (err) {
    console.error('Error fetching joined AUM drill-down:', err);
    setDrillDownError('Failed to load joined advisor records');
  } finally {
    setDrillDownLoading(false);
  }
};
```

## PHASE 7 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | grep -c "error TS"
```

**Expected**: Only remaining errors should be from `MetricDrillDownModal` missing the `'joined'` column config (Phase 8).

```bash
ls src/components/sgm-hub/
```

**Expected**: `SGMHubTabs.tsx`, `SGMLeaderboardFilters.tsx`, `SGMLeaderboardTable.tsx`

**STOP AND REPORT**: Tell the user:
- "Phase 7 complete: Filter, table, and content components created and wired."
- "Ready to proceed to Phase 8 (Drilldown wiring)?"

---

# PHASE 8: Drilldown Modal Configuration

## Context
Add `'joined'` metric type configuration to `MetricDrillDownModal` so the drilldown modal knows which columns to show and how to export joined advisor records.

## Step 8.1: Add type guard for JoinedDrillDownRecord

**File**: `src/components/sga-hub/MetricDrillDownModal.tsx`

Add import for `JoinedDrillDownRecord` to the existing import block (line 7-27):

```typescript
import {
  MetricDrillDownModalProps,
  MetricType,
  InitialCallRecord,
  QualificationCallRecord,
  SQODrillDownRecord,
  OpenSQLDrillDownRecord,
  MQLDrillDownRecord,
  SQLDrillDownRecord,
  LeadsSourcedRecord,
  LeadsContactedRecord,
  JoinedDrillDownRecord,
  DrillDownRecord
} from '@/types/drill-down';
```

Add type guard function (after existing type guards, around line 62):

```typescript
function isJoinedDrillDownRecord(record: DrillDownRecord): record is JoinedDrillDownRecord {
  return 'joinDate' in record && 'sgmName' in record;
}
```

## Step 8.2: Add 'joined' to COLUMN_CONFIGS

Add the `'joined'` entry to the `COLUMN_CONFIGS` object (after `'leads-contacted'`, before the closing `}`):

```typescript
  'joined': [
    { key: 'advisorName', label: 'Advisor Name', width: 'w-44' },
    { key: 'joinDate', label: 'Join Date', width: 'w-28' },
    { key: 'source', label: 'Source', width: 'w-28' },
    { key: 'channel', label: 'Channel', width: 'w-28' },
    { key: 'aumFormatted', label: 'AUM', width: 'w-28' },
    { key: 'aumTier', label: 'Tier', width: 'w-20' },
    { key: 'stageName', label: 'Stage', width: 'w-24' },
    { key: 'actions', label: '', width: 'w-20' },
  ],
```

## Step 8.3: Add 'joined' to exportData useMemo

In the `exportData` useMemo block (around lines 181-282), add a new `else if` branch before the final `else` clause:

```typescript
    } else if (metricType === 'joined') {
      return (records as JoinedDrillDownRecord[]).map(record => ({
        'Advisor Name': record.advisorName,
        'Join Date': formatDate(record.joinDate) || '',
        'Source': record.source,
        'Channel': record.channel,
        'AUM': record.aumFormatted,
        'Tier': record.aumTier || '',
        'Stage': record.stageName || record.tofStage,
        'SGM Name': record.sgmName || '',
        'Salesforce URL': record.opportunityUrl || record.leadUrl || '',
      }));
```

## PHASE 8 — VALIDATION GATE

```bash
npm run build 2>&1 | tail -10
```

**Expected**: Build succeeds with ZERO errors. This is the critical validation gate — all types, queries, routes, components, and configurations should be complete.

If build fails, check the error messages. Common issues:
- Missing import for `JoinedDrillDownRecord`
- `COLUMN_CONFIGS` not having all `MetricType` keys
- `formatDate` import missing for joined export

**STOP AND REPORT**: Tell the user:
- "Phase 8 complete: MetricDrillDownModal configured for joined metric type."
- "Build status: [PASS/FAIL with error count]"
- "Ready to proceed to Phase 8.5 (Documentation sync)?"

---

# PHASE 8.5: Documentation Sync

## Context
Sync auto-generated documentation and update architecture docs.

## Step 8.5.1: Run agent-guard sync

```bash
npx agent-guard sync
```

Review any changes to `docs/ARCHITECTURE.md` and generated inventory files. Stage if correct.

## Step 8.5.2: Regenerate API route inventory

```bash
npm run gen:api-routes
```

This will pick up the 3 new API routes under `/api/sgm-hub/`.

## PHASE 8.5 — VALIDATION GATE

```bash
git diff --stat docs/
```

**Expected**: Changes in `docs/_generated/api-routes.md` (3 new routes) and possibly `docs/ARCHITECTURE.md`.

**STOP AND REPORT**: Tell the user:
- "Phase 8.5 complete: Documentation synced, API route inventory updated."
- "Ready to proceed to Phase 9 (UI/UX Validation)?"

---

# PHASE 9: UI/UX Validation (Requires User)

## Context
Manual browser testing. The user must verify the following test groups.

## Test Group 1: Navigation & Access
1. Log in as an **admin** user
2. Verify "SGM Hub" appears in the sidebar (with Trophy icon)
3. Click it → should navigate to `/dashboard/sgm-hub`
4. Verify the tab bar shows: Leaderboard, Dashboard, Quota Tracking
5. Click Dashboard tab → "Coming soon" placeholder
6. Click Quota Tracking tab → "Coming soon" placeholder
7. Log in as an **SGA** user → verify SGM Hub does NOT appear in sidebar
8. Navigate directly to `/dashboard/sgm-hub` → should redirect to `/dashboard`

## Test Group 2: Leaderboard Data
1. Leaderboard tab should load data automatically (current quarter)
2. Verify 12 SGM names appear (including 3–4 with zero joins)
3. Verify ranking is by Joined AUM descending
4. Verify top 3 have medal emojis and colored backgrounds
5. Verify AUM formatting looks reasonable (e.g., "$458.0M", "$1.57B")
6. Cross-check Q1 2026 data against data-verifier findings:
   - GinaRose Galli: 2 joins, ~$1.57B
   - Corey Marcello: 4 joins, ~$458M

## Test Group 3: Filters
1. Change quarter to Q4 2025 → leaderboard should update
2. Deselect some channels → results should change
3. Select specific SGMs only → only those SGMs should appear
4. Click "Apply Filters" with pending changes → data refreshes
5. "Reset" should set ALL channels (verify all 7 are checked after reset)

## Test Group 4: Drilldown
1. Click a # Joined number → MetricDrillDownModal opens
2. Verify columns: Advisor Name, Join Date, Source, Channel, AUM, Tier, Stage, Actions
3. Click "Joined AUM" value → same modal opens (different title)
4. Click a row in the drilldown → RecordDetailModal opens with advisor details
5. Click "Back" in RecordDetailModal → returns to drilldown list
6. Close drilldown modal → returns to leaderboard

## Test Group 5: SGM User View
1. Log in as an **SGM** user
2. Navigate to SGM Hub → leaderboard loads
3. Verify the SGM's own row has a blue left border + "You" badge
4. Verify the SGM can see all other SGMs (not restricted to own data on leaderboard)

## Test Group 6: Build Verification
```bash
npm run build
```
**Expected**: Zero errors.

**STOP AND REPORT**: Tell the user:
- "Phase 9 validation checklist presented. Please test each group in the browser."
- "Report any issues and I'll fix them before we commit."

---

# Troubleshooting Appendix

## Common Issues

### "No SGM data found" — Empty leaderboard
- Verify `Is_SGM__c` (with underscore) is used everywhere, NOT `IsSGM__c`
- Check that `quarterMonths` array is being constructed correctly
- Test the BigQuery query directly with known good parameters

### MetricDrillDownModal TypeScript error
- Ensure `COLUMN_CONFIGS` has entries for ALL MetricType values including `'joined'`
- Ensure `JoinedDrillDownRecord` is added to the `DrillDownRecord` union

### Drilldown returns empty records
- Verify `is_joined_unique = 1` filter (not `is_joined = 1`)
- Verify `joined_cohort_month` values match expected format ('YYYY-MM')
- Check `SGM_Owner_Name__c = @sgmName` matches exactly (case-sensitive string)

### "Savvy Marketing" appears in leaderboard
- This should NOT happen if using `Is_SGM__c = TRUE` on User table as left side of join
- If it appears, check that the User table join is correctly excluding non-SGM users

### AUM shows as $0 for some joined advisors
- 3 records have legitimate $0 AUM — this is expected behavior, not a bug
- Display $0 rather than hiding these records

---

# Known Limitations

1. **MetricDrillDownModal cross-import**: Lives in `src/components/sga-hub/`. SGM Hub imports across directory boundaries. Future refactor should move to shared `src/components/shared/`.
2. **calculateRanks duplication**: Copied from sga-leaderboard.ts (private function). Future refactor should extract to shared utility.
3. **No excluded names list**: Unlike SGA Hub, SGM Hub has no EXCLUDED_SGMS list. All filtering is done via `Is_SGM__c = TRUE` on User table, which is cleaner.
4. **Both click handlers (joined/AUM) return same data**: Different titles but same records. This matches the spec requirement.
