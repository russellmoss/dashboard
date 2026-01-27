# SGA Leaderboard - Agentic Implementation Plan

## 🎯 Overview

This document provides a **step-by-step agentic implementation plan** for adding a "Leaderboard" tab to the SGA Hub page. Each phase includes explicit verification and validation steps using BigQuery MCP, terminal commands, and UI/UX validation.

**CRITICAL INSTRUCTION FOR CURSOR.AI**: Execute ONE PHASE AT A TIME. After completing each phase, report your findings, document any decisions made, and ASK FOR PERMISSION before proceeding to the next phase. Do NOT auto-advance between phases.

**IMPORTANT**: This plan has been updated to align with the actual codebase patterns, BigQuery schema, and data handling. All code examples match the existing implementation patterns.

### ⚠️ CRITICAL CORRECTIONS APPLIED:

1. **Query Structure**: Uses `EXISTS` subquery (not CTEs) - matches existing pattern
2. **SGA Attribution**: `COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)` - prioritizes opportunity-level
3. **Date Format**: `CONCAT(@endDate, ' 23:59:59')` (space, not 'T') - matches existing pattern
4. **Types Location**: Types in `src/types/sga-hub.ts` (NOT in query file) - matches codebase pattern
5. **Quarter Format**: "YYYY-QN" format (e.g., "2026-Q1") with `getQuarterInfo()` helper - matches existing pattern
6. **Component Structure**: Integrate into `SGAHubContent.tsx` (NOT separate `SGALeaderboard.tsx`) - matches Quarterly Progress tab pattern
7. **Drill-Down Method**: Keep GET method with query params (NOT POST) - maintains consistency
8. **Medal Icons**: Use emoji medals (🥇 🥈 🥉) - matches game leaderboard pattern
9. **Filter Options**: Use existing `dashboardApi.getFilterOptions()` - reuses existing infrastructure
10. **Channel Handling**: Use `Channel_Grouping_Name` directly in drill-down (no MAPPING_TABLE) - matches leaderboard query

### 🆕 FILTER REQUIREMENTS (Updated):

11. **SGA Multi-Select Filter**: Added SGA filter picklist (similar to Pipeline page SGM filter)
    - "Active Only" button - selects all active, non-excluded SGAs (DEFAULT)
    - "All SGAs" button - selects all SGAs including inactive
    - "Deselect All" button
    - Search box to filter SGA names
    - Default: ALL active, non-excluded SGAs selected

12. **Source Filter Defaults**: Changed from "none = all" to "ALL sources selected by default"
    - "Select All" button
    - "Deselect All" button
    - Default: ALL sources checked

13. **Channel Filter Defaults**: Added "Select All" and "Deselect All" buttons
    - Default: "Outbound" and "Outbound + Marketing" checked (as specified)

14. **Apply/Reset Buttons**: Filters do NOT auto-apply (like Pipeline page)
    - "Apply Filters" button - applies current selections
    - "Reset" button - resets to defaults (all active SGAs, default channels, all sources)

15. **SGA Options API**: New `/api/sga-hub/leaderboard-sga-options` route returns all SGAs (active and inactive) except excluded ones

### 📋 FILES ALREADY EXIST:

**VERIFY THESE FILES MATCH THE CORRECTED PLAN**:
- ✅ `src/lib/queries/sga-leaderboard.ts` - Already exists, verify it matches corrected query pattern
- ✅ `src/app/api/sga-hub/leaderboard/route.ts` - Already exists, verify it matches corrected route pattern
- ✅ `src/types/sga-hub.ts` - Types already exist, verify `LeaderboardEntry` and `LeaderboardFilters` are present

**See `SGA_Leaderboard_Agentic_Implementation_CORRECTIONS.md` for detailed correction summary.**

---

## 📋 Validation Data (Use for Verification)

| Test Case | Expected Result |
|-----------|-----------------|
| Q4 2025 - Perry Kalmeta | 5 SQOs |
| Q1 2026 QTD - Perry Kalmeta | 0 SQOs |
| Q1 2026 QTD - Brian O'Hara | 4 SQOs |
| Brian O'Hara's SQOs in Q1 2026 | Daniel Di Lascia, John Goltermann, Ethan Freishtat, J. Ian Scroggs |

---

## 📁 Files to Create/Modify

### New Files
1. `src/lib/queries/sga-leaderboard.ts` - BigQuery query function (ALREADY EXISTS - verify it matches plan)
2. `src/app/api/sga-hub/leaderboard/route.ts` - API route (ALREADY EXISTS - verify it matches plan)
3. `src/app/api/sga-hub/leaderboard-sga-options/route.ts` - API route for SGA filter options (NEW)
4. `src/components/sga-hub/LeaderboardTable.tsx` - Leaderboard table with medals (NEW)
5. `src/components/sga-hub/LeaderboardFilters.tsx` - Filter component with SGA/Channel/Source multi-selects (NEW)

**NOTE**: `SGALeaderboard.tsx` is NOT needed - integrate directly into `SGAHubContent.tsx` (matches existing pattern)

### Modified Files
1. `src/components/sga-hub/SGAHubTabs.tsx` - Add leaderboard tab type and tab entry
2. `src/app/dashboard/sga-hub/SGAHubContent.tsx` - Add leaderboard tab content, state, and filter integration
3. `src/types/sga-hub.ts` - Add leaderboard types (with sgaNames parameter)
4. `src/lib/api-client.ts` - Add API client methods (getSGALeaderboard and getLeaderboardSGAOptions)
5. `src/lib/queries/sga-leaderboard.ts` - Add sgaNames parameter to filter query
6. `src/lib/queries/drill-down.ts` - Add channel/source filters to SQO drill-down
7. `src/app/api/sga-hub/leaderboard/route.ts` - Accept sgaNames parameter
8. `src/app/api/sga-hub/drill-down/sqos/route.ts` - Accept channel/source parameters

---

# 🚀 PHASE 1: Data Layer - BigQuery Query Function

## Objective
Create the BigQuery query function to fetch SGA leaderboard data.

---

## Step 1.1: Explore Existing Query Patterns

### Questions to Answer:

**Q1.1.1**: What is the exact structure of existing query functions in `src/lib/queries/`?

**Action**: Read these files to understand patterns:
```bash
# View existing query patterns
cat src/lib/queries/quarterly-progress.ts
cat src/lib/queries/drill-down.ts
cat src/lib/queries/sga-activity.ts
```

**Document**:
- Import patterns used
- How `runQuery` is called
- How parameters are passed
- How caching is applied
- How dates are handled (DATE vs TIMESTAMP)

---

**Q1.1.2**: What are the exact excluded SGA names used throughout the codebase?

**Action**: Search for excluded SGAs:
```bash
grep -r "Anett Diaz" src/lib/queries/ --include="*.ts"
grep -r "Jacqueline Tully" src/lib/queries/ --include="*.ts"
grep -r "excludedSGAs" src/lib/queries/ --include="*.ts"
```

**Expected Excluded SGAs**:
- Anett Diaz
- Jacqueline Tully
- Savvy Operations
- Savvy Marketing
- Russell Moss
- Jed Entin

**Document**: The complete list of SGAs to exclude from the leaderboard.

---

**Q1.1.3**: Verify the BigQuery schema for SQO attribution fields.

**Action**: Use MCP BigQuery to run this query:
```sql
SELECT 
  v.primary_key,
  v.advisor_name,
  v.SGA_Owner_Name__c,
  v.Opp_SGA_Name__c,
  v.Date_Became_SQO__c,
  v.Channel_Grouping_Name,
  v.Original_source,
  v.is_sqo_unique,
  v.recordtypeid
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.is_sqo_unique = 1
  AND v.recordtypeid = '012Dn000000mrO3IAI'
  AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2024-10-01')
LIMIT 10
```

**Document**: 
- Confirm all fields exist as expected
- Note any field name differences
- **CRITICAL**: `Date_Became_SQO__c` is a TIMESTAMP field - always use `TIMESTAMP()` wrapper for comparisons
- **CRITICAL**: Use `CONCAT(@endDate, ' 23:59:59')` format (space, not 'T') for end date inclusivity

---

## Step 1.2: Validate Query Logic with MCP BigQuery

### Q1.2.1: Validate Q4 2025 - Perry Kalmeta = 5 SQOs

**Action**: Run this validation query via MCP BigQuery:
```sql
-- Q4 2025 validation: Perry Kalmeta should have 5 SQOs
-- CRITICAL: Use correct SGA attribution pattern - prioritize Opp_SGA_Name__c
SELECT 
  COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) as resolved_sga,
  COUNT(DISTINCT v.primary_key) as sqo_count,
  ARRAY_AGG(v.advisor_name ORDER BY v.Date_Became_SQO__c) as advisor_names
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` sga_user
  ON v.Opp_SGA_Name__c = sga_user.Id
WHERE v.is_sqo_unique = 1
  AND v.recordtypeid = '012Dn000000mrO3IAI'
  AND v.Date_Became_SQO__c IS NOT NULL
  AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2025-10-01')
  AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT('2025-12-31', ' 23:59:59'))
  AND COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) = 'Perry Kalmeta'
GROUP BY resolved_sga
```

**Expected Result**: `sqo_count = 5` for Perry Kalmeta

**Document**: 
- Actual result
- If not 5, investigate which SQOs are missing and why
- Note the advisor names for verification
- **CRITICAL**: Must use `COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)` pattern to prioritize opportunity-level SGA

---

### Q1.2.2: Validate Q1 2026 QTD - Brian O'Hara = 4 SQOs

**Action**: Run this validation query via MCP BigQuery:
```sql
-- Q1 2026 QTD validation: Brian O'Hara should have 4 SQOs
-- CRITICAL: Use correct SGA attribution pattern and include channel filter
SELECT 
  COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) as resolved_sga,
  COUNT(DISTINCT v.primary_key) as sqo_count,
  ARRAY_AGG(v.advisor_name ORDER BY v.Date_Became_SQO__c) as advisor_names
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` sga_user
  ON v.Opp_SGA_Name__c = sga_user.Id
WHERE v.is_sqo_unique = 1
  AND v.recordtypeid = '012Dn000000mrO3IAI'
  AND v.Date_Became_SQO__c IS NOT NULL
  AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2026-01-01')
  AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT('2026-01-27', ' 23:59:59'))  -- Use current date for QTD
  AND v.Channel_Grouping_Name IN ('Outbound', 'Outbound + Marketing')
  AND COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) = 'Brian O\'Hara'
GROUP BY resolved_sga
```

**Expected Result**: 
- `sqo_count = 4`
- `advisor_names` should include: Daniel Di Lascia, John Goltermann, Ethan Freishtat, J. Ian Scroggs

**Document**: 
- Actual result
- Confirm all 4 advisor names match
- **CRITICAL**: Must include channel filter to match default filters

---

### Q1.2.3: Validate Channel Filtering (Outbound + Outbound + Marketing)

**Action**: Run this query via MCP BigQuery:
```sql
-- Validate channel filtering with default channels
SELECT 
  Channel_Grouping_Name,
  COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP('2026-01-01')
  AND Channel_Grouping_Name IN ('Outbound', 'Outbound + Marketing')
GROUP BY Channel_Grouping_Name
ORDER BY count DESC
```

**Document**: 
- Available channel values
- Confirm 'Outbound' and 'Outbound + Marketing' exist as expected
- Note exact spelling/capitalization

---

### Q1.2.4: Validate Active SGA Filter Logic

**Action**: Run this query via MCP BigQuery:
```sql
-- Get all active SGAs for leaderboard
SELECT DISTINCT
  u.Name as sga_name,
  u.IsActive,
  u.IsSGA__c
FROM `savvy-gtm-analytics.SavvyGTMData.User` u
WHERE u.IsSGA__c = TRUE
  AND u.IsActive = TRUE
  AND u.Name NOT IN (
    'Anett Diaz', 
    'Jacqueline Tully', 
    'Savvy Operations', 
    'Savvy Marketing', 
    'Russell Moss', 
    'Jed Entin'
  )
ORDER BY u.Name
```

**Document**: 
- List of active SGAs
- Confirm excluded SGAs are NOT in the list
- This is the universe of SGAs that should appear on the leaderboard

**CRITICAL**: The actual implementation uses an `EXISTS` subquery in the main query, not a separate CTE. This is more efficient and matches the existing pattern.

---

## Step 1.3: Create the Query Function

**File**: `src/lib/queries/sga-leaderboard.ts`

**Action**: Create this new file with the following structure:

```typescript
// src/lib/queries/sga-leaderboard.ts

import { runQuery } from '@/lib/bigquery';
import { LeaderboardEntry, LeaderboardFilters } from '@/types/sga-hub';
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
import { cachedQuery, CACHE_TAGS } from '@/lib/cache';
import { toNumber, toString } from '@/types/bigquery-raw';

/**
 * Raw BigQuery result for leaderboard entry
 */
interface RawLeaderboardResult {
  sga_name: string;
  sqo_count: number | null;
}

/**
 * Always-inactive SGAs to exclude from leaderboard
 */
const EXCLUDED_SGAS = [
  'Anett Diaz',
  'Jacqueline Tully',
  'Savvy Operations',
  'Savvy Marketing',
  'Russell Moss',
  'Jed Entin',
];

/**
 * Calculate ranks for leaderboard entries
 * Ties get the same rank, next rank skips (e.g., 1, 1, 3, 4)
 * 
 * CRITICAL: This function assumes entries are already sorted by sqoCount DESC, sgaName ASC
 */
function calculateRanks(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  let currentRank = 1;
  let previousCount: number | null = null;

  return entries.map((entry, index) => {
    // If this entry has a different count than the previous one, update rank
    if (previousCount !== null && entry.sqoCount < previousCount) {
      currentRank = index + 1;
    }
    
    previousCount = entry.sqoCount;
    return {
      ...entry,
      rank: currentRank,
    };
  });
}

/**
 * Get SGA leaderboard with SQO counts for a given date range and filters
 * @param filters - Date range, channels, and optional sources
 * @returns Array of leaderboard entries sorted by SQO count (descending)
 */
const _getSGALeaderboard = async (
  filters: LeaderboardFilters
): Promise<LeaderboardEntry[]> => {
  const { startDate, endDate, channels, sources, sgaNames } = filters;

  // Validate required parameters
  if (!startDate || !endDate) {
    throw new Error('startDate and endDate are required');
  }
  if (!channels || channels.length === 0) {
    throw new Error('At least one channel is required');
  }

  // Build SGA filter condition
  // If sgaNames is provided and not empty, filter to only those SGAs
  // Otherwise, use EXISTS subquery to filter to active SGAs only
  const sgaFilterCondition = sgaNames && sgaNames.length > 0
    ? `AND COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) IN UNNEST(@sgaNames)`
    : `AND EXISTS (
      SELECT 1
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.Name = COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)
        AND u.IsSGA__c = TRUE
        AND u.IsActive = TRUE
        AND u.Name NOT IN UNNEST(@excludedSGAs)
    )`;

  const query = `
    SELECT 
      -- For opportunity-level metrics (SQOs), prioritize Opp_SGA_Name__c over SGA_Owner_Name__c
      -- This ensures SQOs are attributed to the opportunity-level SGA when both fields are present
      COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) as sga_name,
      COUNT(DISTINCT v.primary_key) as sqo_count
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
    WHERE v.is_sqo_unique = 1
      AND v.recordtypeid = @recruitingRecordType
      AND v.Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      AND v.Channel_Grouping_Name IN UNNEST(@channels)
      -- Optional source filter
      AND (@sources IS NULL OR v.Original_source IN UNNEST(@sources))
      -- SGA filtering: either specific SGAs or all active SGAs
      ${sgaFilterCondition}
    GROUP BY sga_name
    ORDER BY sqo_count DESC, sga_name ASC
  `;

  const params: Record<string, any> = {
    startDate,
    endDate,
    channels,
    sources: sources && sources.length > 0 ? sources : null,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    excludedSGAs: EXCLUDED_SGAS,
  };

  // Add sgaNames parameter only if provided
  if (sgaNames && sgaNames.length > 0) {
    params.sgaNames = sgaNames;
  }

  const results = await runQuery<RawLeaderboardResult>(query, params);

  // Transform raw results to LeaderboardEntry
  const entries: LeaderboardEntry[] = results.map((row) => ({
    sgaName: toString(row.sga_name),
    sqoCount: toNumber(row.sqo_count),
    rank: 0, // Will be calculated below
  }));

  // Calculate ranks (handles ties)
  const rankedEntries = calculateRanks(entries);

  return rankedEntries;
};

export const getSGALeaderboard = cachedQuery(
  _getSGALeaderboard,
  'getSGALeaderboard',
  CACHE_TAGS.SGA_HUB
);
```

**CRITICAL NOTES**:
1. **Types Location**: Types (`LeaderboardEntry`, `LeaderboardFilters`) should be in `src/types/sga-hub.ts`, NOT exported from this file
2. **SGA Attribution**: Use `COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)` - this prioritizes opportunity-level SGA
3. **Date Format**: Use `CONCAT(@endDate, ' 23:59:59')` (space, not 'T') for end date inclusivity
4. **SGA Filtering**: If `sgaNames` is provided and not empty, filter to only those SGAs. Otherwise, use `EXISTS` subquery to filter to active SGAs only (default behavior)
5. **Type Transformations**: Use `toString()` and `toNumber()` helpers from `@/types/bigquery-raw`
6. **Ranking**: Entries are already sorted by SQL, so ranking function just assigns ranks based on count changes

---

## Step 1.4: Verify Query Function with Terminal

**Action**: After creating the file, run these terminal commands:

```bash
# Check for TypeScript errors in the new file
npx tsc --noEmit src/lib/queries/sga-leaderboard.ts

# Check for linting errors
npm run lint -- --fix src/lib/queries/sga-leaderboard.ts

# Verify the file was created correctly
cat src/lib/queries/sga-leaderboard.ts | head -50
```

**Document**:
- Any TypeScript errors and how they were fixed
- Any linting errors and how they were fixed

---

## Phase 1 Completion Checklist

Before proceeding, verify ALL items:

- [ ] Q1.1.1: Documented existing query patterns
- [ ] Q1.1.2: Confirmed excluded SGA list
- [ ] Q1.1.3: Verified BigQuery schema fields
- [ ] Q1.2.1: Validated Perry Kalmeta Q4 2025 = 5 SQOs
- [ ] Q1.2.2: Validated Brian O'Hara Q1 2026 = 4 SQOs with correct names
- [ ] Q1.2.3: Validated channel filtering works
- [ ] Q1.2.4: Confirmed active SGA list
- [ ] Q1.3: Created `src/lib/queries/sga-leaderboard.ts`
- [ ] Q1.4: No TypeScript or linting errors

---

## 🛑 STOP - PHASE 1 COMPLETE

**CURSOR.AI**: Report your findings for Phase 1:

1. What patterns did you observe in existing query files?
2. What is the complete list of excluded SGAs?
3. Did validation queries return expected results?
4. Any issues or decisions made during implementation?
5. Any TypeScript or linting errors fixed?

**Update this document** with your findings in a new section called "Phase 1 Results" below.

**ASK**: "Phase 1 complete. Ready to proceed to Phase 2 (API Route)?"

---

# 🚀 PHASE 2: API Route

## Objective
Create the API route to expose leaderboard data to the frontend.

---

## Step 2.1: Explore Existing API Route Patterns

### Q2.1.1: What is the structure of existing SGA Hub API routes?

**Action**: Read these files to understand patterns:
```bash
cat src/app/api/sga-hub/quarterly-progress/route.ts
cat src/app/api/sga-hub/drill-down/sqos/route.ts
```

**Document**:
- Authentication pattern used
- Authorization/permissions checking
- Request body parsing
- Error handling pattern
- Response format

---

## Step 2.2: Create the API Route

**File**: `src/app/api/sga-hub/leaderboard/route.ts`

**Action**: Create this new file:

```typescript
// src/app/api/sga-hub/leaderboard/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getSGALeaderboard } from '@/lib/queries/sga-leaderboard';
import { LeaderboardFilters } from '@/types/sga-hub';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sga-hub/leaderboard
 * Get SGA leaderboard with SQO counts for a given date range and filters
 * 
 * Request body:
 * {
 *   startDate: string;      // YYYY-MM-DD
 *   endDate: string;        // YYYY-MM-DD
 *   channels: string[];      // Array of channel names
 *   sources?: string[];     // Optional array of source names (defaults to all if undefined/empty)
 *   sgaNames?: string[];     // Optional array of SGA names (defaults to all active if undefined/empty)
 * }
 * 
 * Response:
 * {
 *   entries: LeaderboardEntry[];
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authorization check - SGA Hub is accessible to admin, manager, and sga roles
    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse request body
    const body = await request.json();
    const { startDate, endDate, channels, sources, sgaNames } = body as LeaderboardFilters;

    // Validate required fields
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

    // Build filters object
    const filters: LeaderboardFilters = {
      startDate,
      endDate,
      channels,
      sources: sources && sources.length > 0 ? sources : undefined,
      sgaNames: sgaNames && sgaNames.length > 0 ? sgaNames : undefined,
    };

    // Fetch leaderboard data
    const entries = await getSGALeaderboard(filters);

    return NextResponse.json({ entries });

  } catch (error) {
    console.error('[API] Error fetching leaderboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch leaderboard' },
      { status: 500 }
    );
  }
}
```

**CRITICAL NOTES**:
1. **Import Types**: Import `LeaderboardFilters` from `@/types/sga-hub`, NOT from query file
2. **Authorization**: Check for specific roles `['admin', 'manager', 'sga']`, not just `if (!permissions)`
3. **Error Logging**: Use `console.error` with `[API]` prefix for production debugging (acceptable)
4. **Dynamic Route**: Add `export const dynamic = 'force-dynamic'` for Next.js App Router

---

## Step 2.3: Add API Client Method

**File**: `src/lib/api-client.ts`

**Action**: Add the following method to the `dashboardApi` object (check if it already exists first):

```typescript
// Add to dashboardApi object (if not already present)

// Import LeaderboardEntry at top of file
import { LeaderboardEntry } from '@/types/sga-hub';

// Add to dashboardApi object:
getSGALeaderboard: (filters: {
  startDate: string;
  endDate: string;
  channels: string[];
  sources?: string[];
  sgaNames?: string[];
}) =>
  apiFetch<{ entries: LeaderboardEntry[] }>('/api/sga-hub/leaderboard', {
    method: 'POST',
    body: JSON.stringify(filters),
  }),

// Add method to fetch SGA options for leaderboard filter:
getLeaderboardSGAOptions: () =>
  apiFetch<{ sgaOptions: Array<{ value: string; label: string; isActive: boolean }> }>(
    '/api/sga-hub/leaderboard-sga-options'
  ),
```

**CRITICAL NOTES**:
1. **Type Import**: Import `LeaderboardEntry` from `@/types/sga-hub`, NOT from query file
2. **Already Exists**: This method may already exist - check before adding
3. **Type Safety**: Use `apiFetch<{ entries: LeaderboardEntry[] }>` for type safety

---

## Step 2.2.5: Create SGA Options API Route

**File**: `src/app/api/sga-hub/leaderboard-sga-options/route.ts` (NEW)

**Action**: Create this new file to return active SGAs for the filter picklist:

```typescript
// src/app/api/sga-hub/leaderboard-sga-options/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { runQuery } from '@/lib/bigquery';
import { toString } from '@/types/bigquery-raw';

export const dynamic = 'force-dynamic';

/**
 * Raw BigQuery result for SGA option
 */
interface RawSGAOption {
  sga_name: string | null;
  is_active: boolean | number | null;
}

/**
 * Always-excluded SGAs (never show in picklist)
 */
const EXCLUDED_SGAS = [
  'Anett Diaz',
  'Jacqueline Tully',
  'Savvy Operations',
  'Savvy Marketing',
  'Russell Moss',
  'Jed Entin',
];

/**
 * GET /api/sga-hub/leaderboard-sga-options
 * Get list of SGAs for leaderboard filter picklist
 * Returns all SGAs (active and inactive) except excluded ones
 * 
 * Response:
 * {
 *   sgaOptions: Array<{ value: string; label: string; isActive: boolean }>;
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Authorization check - SGA Hub is accessible to admin, manager, and sga roles
    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Query all SGAs from User table (excluding the always-excluded ones)
    const query = `
      SELECT DISTINCT
        u.Name as sga_name,
        u.IsActive as is_active
      FROM \`savvy-gtm-analytics.SavvyGTMData.User\` u
      WHERE u.IsSGA__c = TRUE
        AND u.Name NOT IN UNNEST(@excludedSGAs)
      ORDER BY u.Name
    `;

    const params: Record<string, any> = {
      excludedSGAs: EXCLUDED_SGAS,
    };

    const results = await runQuery<RawSGAOption>(query, params);

    // Transform to SGA options
    const sgaOptions = results
      .filter(r => r.sga_name !== null)
      .map(r => ({
        value: toString(r.sga_name),
        label: toString(r.sga_name),
        isActive: r.is_active === true || r.is_active === 1,
      }));

    return NextResponse.json({ sgaOptions });

  } catch (error) {
    console.error('[API] Error fetching SGA options:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGA options' },
      { status: 500 }
    );
  }
}
```

**CRITICAL NOTES**:
1. **Excluded SGAs**: Never show these SGAs in the picklist (matches query function)
2. **All SGAs**: Returns both active and inactive SGAs (user can filter with "Active Only" button)
3. **Authorization**: Same auth pattern as leaderboard route

---

## Step 2.4: Add Types to sga-hub.ts

**File**: `src/types/sga-hub.ts`

**Action**: Add these type exports at the end of the file (check if they already exist):

```typescript
// Add to src/types/sga-hub.ts (at the end, after other type definitions)

// ============================================================================
// LEADERBOARD
// ============================================================================

/** Leaderboard entry for a single SGA */
export interface LeaderboardEntry {
  sgaName: string;
  sqoCount: number;
  rank: number;
}

/** Filters for leaderboard query */
export interface LeaderboardFilters {
  startDate: string;      // YYYY-MM-DD format
  endDate: string;        // YYYY-MM-DD format
  channels: string[];     // Array of channel names (required)
  sources?: string[];     // Optional array of source names (defaults to all if undefined/empty)
  sgaNames?: string[];    // Optional array of SGA names to filter (defaults to all active if undefined/empty)
}
```

**CRITICAL NOTES**:
1. **Location**: Types MUST be in `src/types/sga-hub.ts`, NOT in the query file
2. **Already Exists**: These types may already exist - check before adding
3. **Format**: Follow existing type organization pattern in the file

---

## Step 2.5: Terminal Validation

**Action**: Run these commands:

```bash
# Check for TypeScript errors in all modified files
npx tsc --noEmit

# Check for linting errors
npm run lint

# Test that the API route file is valid
cat src/app/api/sga-hub/leaderboard/route.ts
```

---

## Step 2.6: API Testing (Manual - Local Dev Server)

**Action**: If the dev server is running, test the API with curl:

```bash
# Start dev server if not running
npm run dev

# In another terminal, test the API (you'll need a valid auth session)
# This curl won't work without auth, but verifies route exists
curl -X POST http://localhost:3000/api/sga-hub/leaderboard \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2025-10-01",
    "endDate": "2025-12-31",
    "channels": ["Outbound", "Outbound + Marketing"]
  }'
```

**Expected**: Either 401 (not authenticated) or 200 with data

---

## Phase 2 Completion Checklist

- [ ] Q2.1.1: Documented existing API route patterns
- [ ] Q2.2: Created `src/app/api/sga-hub/leaderboard/route.ts`
- [ ] Q2.2.5: Created `src/app/api/sga-hub/leaderboard-sga-options/route.ts`
- [ ] Q2.3: Added API client methods to `src/lib/api-client.ts` (getSGALeaderboard and getLeaderboardSGAOptions)
- [ ] Q2.4: Added types to `src/types/sga-hub.ts` (with sgaNames parameter)
- [ ] Q2.5: No TypeScript or linting errors
- [ ] Q2.6: API route responds (even if 401)

---

## 🛑 STOP - PHASE 2 COMPLETE

**CURSOR.AI**: Report your findings for Phase 2:

1. What auth/permissions pattern did existing routes use?
2. Any issues with TypeScript or linting?
3. Did you successfully add the API client method?
4. Any decisions or modifications made?

**Update this document** with your findings in a new section called "Phase 2 Results" below.

**ASK**: "Phase 2 complete. Ready to proceed to Phase 3 (Frontend Components)?"

---

# 🚀 PHASE 3: Frontend Components - Tab & Leaderboard Component

## Objective
Create the frontend components for the leaderboard tab and display.

---

## Step 3.1: Explore Existing Component Patterns

### Q3.1.1: How does SGAHubTabs.tsx define tabs?

**Action**: Read the tab component:
```bash
cat src/components/sga-hub/SGAHubTabs.tsx
```

**Document**:
- Tab type definition
- Tab array structure
- Icon imports used
- Styling patterns

---

### Q3.1.2: How does SGAHubContent.tsx handle tab state and content?

**Action**: Read the content component:
```bash
cat src/app/dashboard/sga-hub/SGAHubContent.tsx
```

**Document**:
- State variables for each tab
- How tab content is conditionally rendered
- Drill-down modal state management
- API call patterns

---

### Q3.1.3: What filter components exist for reuse?

**Action**: Check for existing multi-select or filter components:
```bash
ls -la src/components/ui/
ls -la src/components/dashboard/
grep -r "MultiSelect" src/components/ --include="*.tsx"
grep -r "select" src/components/sga-hub/ --include="*.tsx"
```

**Document**:
- Available filter/select components
- Styling patterns for filters

---

## Step 3.2: Update SGAHubTabs.tsx

**File**: `src/components/sga-hub/SGAHubTabs.tsx`

**Changes Required**:

1. Add `'leaderboard'` to the `SGAHubTab` type (as FIRST option)
2. Add Trophy icon import from lucide-react
3. Add leaderboard tab as FIRST item in tabs array

**Action**: Modify the file:

```typescript
// src/components/sga-hub/SGAHubTabs.tsx

'use client';

import { Button } from '@tremor/react';
import { Trophy, Target, AlertCircle, TrendingUp } from 'lucide-react';

// UPDATED: Added 'leaderboard' as first tab
export type SGAHubTab = 'leaderboard' | 'weekly-goals' | 'closed-lost' | 'quarterly-progress';

interface SGAHubTabsProps {
  activeTab: SGAHubTab;
  onTabChange: (tab: SGAHubTab) => void;
}

export function SGAHubTabs({ activeTab, onTabChange }: SGAHubTabsProps) {
  const tabs: { id: SGAHubTab; label: string; icon: React.ReactNode }[] = [
    // NEW: Leaderboard as first tab
    { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy className="w-4 h-4" /> },
    { id: 'weekly-goals', label: 'Weekly Goals', icon: <Target className="w-4 h-4" /> },
    { id: 'closed-lost', label: 'Closed Lost Follow-Up', icon: <AlertCircle className="w-4 h-4" /> },
    { id: 'quarterly-progress', label: 'Quarterly Progress', icon: <TrendingUp className="w-4 h-4" /> },
  ];
  
  return (
    <div className="flex gap-2 mb-6 border-b border-gray-200 dark:border-gray-700">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`
            px-4 py-2 text-sm font-medium transition-colors
            flex items-center gap-2
            border-b-2 -mb-px
            ${
              activeTab === tab.id
                ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-300 dark:hover:border-gray-600'
            }
          `}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

---

## Step 3.2.5: Create LeaderboardFilters Component

**File**: `src/components/sga-hub/LeaderboardFilters.tsx` (NEW)

**Action**: Create this new file following the pattern from `PipelineFilters.tsx`:

```typescript
// src/components/sga-hub/LeaderboardFilters.tsx

'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Check, Filter, RotateCcw } from 'lucide-react';
import { getQuarterInfo, getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';

interface SGAOption {
  value: string;
  label: string;
  isActive: boolean;
}

interface LeaderboardFiltersProps {
  // Applied filters (from parent)
  selectedQuarter: string; // "YYYY-QN" format
  selectedChannels: string[];
  selectedSources: string[];
  selectedSGAs: string[];
  
  // Options
  channelOptions: string[];
  sourceOptions: string[];
  sgaOptions: SGAOption[];
  sgaOptionsLoading: boolean;
  
  // Callbacks
  onApply: (filters: {
    quarter: string;
    channels: string[];
    sources: string[];
    sgas: string[];
  }) => void;
  
  disabled?: boolean;
}

export function LeaderboardFilters({
  selectedQuarter: initialQuarter,
  selectedChannels: initialChannels,
  selectedSources: initialSources,
  selectedSGAs: initialSGAs,
  channelOptions,
  sourceOptions,
  sgaOptions,
  sgaOptionsLoading,
  onApply,
  disabled = false,
}: LeaderboardFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sgaSearch, setSgaSearch] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  
  // Local state for filter selections (not applied until Apply is clicked)
  const [localQuarter, setLocalQuarter] = useState<string>(initialQuarter);
  const [localChannels, setLocalChannels] = useState<string[]>(initialChannels);
  const [localSources, setLocalSources] = useState<string[]>(initialSources);
  const [localSGAs, setLocalSGAs] = useState<string[]>(initialSGAs);
  
  // Sync local state when props change (e.g., after applying filters)
  useEffect(() => {
    setLocalQuarter(initialQuarter);
    setLocalChannels(initialChannels);
    setLocalSources(initialSources);
    setLocalSGAs(initialSGAs);
  }, [initialQuarter, initialChannels, initialSources, initialSGAs]);

  // Filter options by search
  const filteredSgaOptions = useMemo(() => {
    if (!sgaSearch.trim()) return sgaOptions;
    const search = sgaSearch.toLowerCase();
    return sgaOptions.filter(opt => opt.label.toLowerCase().includes(search));
  }, [sgaOptions, sgaSearch]);

  const filteredSourceOptions = useMemo(() => {
    if (!sourceSearch.trim()) return sourceOptions;
    const search = sourceSearch.toLowerCase();
    return sourceOptions.filter(opt => opt.toLowerCase().includes(search));
  }, [sourceOptions, sourceSearch]);

  // Channel handlers
  const handleChannelToggle = (channel: string) => {
    if (disabled) return;
    if (localChannels.includes(channel)) {
      setLocalChannels(localChannels.filter(c => c !== channel));
    } else {
      setLocalChannels([...localChannels, channel]);
    }
  };

  const handleSelectAllChannels = () => {
    if (disabled) return;
    setLocalChannels([...channelOptions]);
  };

  const handleDeselectAllChannels = () => {
    if (disabled) return;
    setLocalChannels([]);
  };

  // Source handlers
  const handleSourceToggle = (source: string) => {
    if (disabled) return;
    if (localSources.includes(source)) {
      setLocalSources(localSources.filter(s => s !== source));
    } else {
      setLocalSources([...localSources, source]);
    }
  };

  const handleSelectAllSources = () => {
    if (disabled) return;
    setLocalSources([...sourceOptions]);
  };

  const handleDeselectAllSources = () => {
    if (disabled) return;
    setLocalSources([]);
  };

  // SGA handlers
  const handleSgaToggle = (sga: string) => {
    if (disabled) return;
    if (localSGAs.includes(sga)) {
      setLocalSGAs(localSGAs.filter(s => s !== sga));
    } else {
      setLocalSGAs([...localSGAs, sga]);
    }
  };

  const handleSelectAllSgas = () => {
    if (disabled || sgaOptionsLoading) return;
    setLocalSGAs(sgaOptions.map(s => s.value));
  };

  const handleDeselectAllSgas = () => {
    if (disabled) return;
    setLocalSGAs([]);
  };

  const handleSelectActiveSgas = () => {
    if (disabled || sgaOptionsLoading) return;
    const activeSgas = sgaOptions.filter(s => s.isActive).map(s => s.value);
    setLocalSGAs(activeSgas.length > 0 ? activeSgas : sgaOptions.map(s => s.value));
  };

  // Apply filters
  const handleApplyFilters = () => {
    if (disabled) return;
    // Ensure at least one channel is selected
    if (localChannels.length === 0) {
      alert('Please select at least one channel.');
      return;
    }
    onApply({
      quarter: localQuarter,
      channels: localChannels,
      sources: localSources.length > 0 ? localSources : sourceOptions, // Default to all if empty
      sgas: localSGAs.length > 0 ? localSGAs : sgaOptions.filter(s => s.isActive).map(s => s.value), // Default to active if empty
    });
  };

  // Reset all filters to defaults
  const handleResetFilters = () => {
    if (disabled) return;
    const currentQuarter = getCurrentQuarter();
    const defaultChannels = ['Outbound', 'Outbound + Marketing'];
    setLocalQuarter(currentQuarter);
    setLocalChannels(defaultChannels);
    setLocalSources([...sourceOptions]); // All sources
    setLocalSGAs(sgaOptions.filter(s => s.isActive).map(s => s.value)); // All active SGAs
  };

  // Summary counts for header (based on applied filters, not local state)
  const channelsSummary = initialChannels.length === channelOptions.length 
    ? 'All Channels' 
    : `${initialChannels.length} Channels`;
  
  const sourcesSummary = initialSources.length === sourceOptions.length 
    ? 'All Sources' 
    : `${initialSources.length} Sources`;
  
  const sgasSummary = sgaOptionsLoading 
    ? 'Loading...'
    : initialSGAs.length === sgaOptions.filter(s => s.isActive).length 
      ? 'All Active SGAs' 
      : `${initialSGAs.length} SGAs`;

  // Check if local state differs from applied filters
  const hasPendingChanges = 
    localQuarter !== initialQuarter ||
    localChannels.length !== initialChannels.length ||
    !localChannels.every(c => initialChannels.includes(c)) ||
    !initialChannels.every(c => localChannels.includes(c)) ||
    localSources.length !== initialSources.length ||
    !localSources.every(s => initialSources.includes(s)) ||
    !initialSources.every(s => localSources.includes(s)) ||
    localSGAs.length !== initialSGAs.length ||
    !localSGAs.every(s => initialSGAs.includes(s)) ||
    !initialSGAs.every(s => localSGAs.includes(s));

  const hasCustomFilters = 
    initialChannels.length !== 2 || // Default is 2 channels
    !initialChannels.includes('Outbound') ||
    !initialChannels.includes('Outbound + Marketing') ||
    initialSources.length !== sourceOptions.length ||
    initialSGAs.length !== sgaOptions.filter(s => s.isActive).length;

  // Generate quarter options (last 8 quarters)
  const quarterOptions: string[] = [];
  const currentQuarterInfo = getQuarterInfo(getCurrentQuarter());
  let year = currentQuarterInfo.year;
  let quarterNum: 1 | 2 | 3 | 4 = currentQuarterInfo.quarterNumber;
  
  for (let i = 0; i < 8; i++) {
    const quarter = `${year}-Q${quarterNum}`;
    quarterOptions.push(quarter);
    if (quarterNum === 1) {
      quarterNum = 4;
      year--;
    } else {
      quarterNum = (quarterNum - 1) as 1 | 2 | 3 | 4;
    }
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden bg-white dark:bg-gray-800 mb-6">
      {/* Collapsed Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
      >
        <div className="flex items-center gap-3">
          <Filter className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          <span className="text-base font-medium text-gray-700 dark:text-gray-300">
            Filters
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
              {getQuarterInfo(localQuarter).label}
            </span>
            <span className="text-sm bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
              {channelsSummary}
            </span>
            <span className="text-sm bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full">
              {sourcesSummary}
            </span>
            <span className="text-sm bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-300 px-2 py-0.5 rounded-full">
              {sgasSummary}
            </span>
          </div>
          {hasCustomFilters && (
            <span className="text-sm text-orange-600 dark:text-orange-400">
              (Modified)
            </span>
          )}
          {hasPendingChanges && (
            <span className="text-sm text-blue-600 dark:text-blue-400">
              (Pending)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Quarter Selector */}
            <div>
              <label className="text-base font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                Quarter
              </label>
              <select
                value={localQuarter}
                onChange={(e) => setLocalQuarter(e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 disabled:opacity-50"
              >
                {quarterOptions.map(q => {
                  const info = getQuarterInfo(q);
                  return (
                    <option key={q} value={q}>
                      {info.label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Channel Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Channels
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllChannels}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllChannels}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {channelOptions.map(channel => {
                  const isSelected = localChannels.includes(channel);
                  return (
                    <label
                      key={channel}
                      className={`
                        flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                        ${isSelected 
                          ? 'bg-purple-50 dark:bg-purple-900/30' 
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }
                        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <div className={`
                        w-5 h-5 rounded border-2 flex items-center justify-center transition-colors
                        ${isSelected 
                          ? 'bg-purple-600 border-purple-600' 
                          : 'border-gray-300 dark:border-gray-600'
                        }
                      `}>
                        {isSelected && <Check className="w-4 h-4 text-white" />}
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleChannelToggle(channel)}
                        disabled={disabled}
                        className="sr-only"
                      />
                      <span className={`text-base ${isSelected ? 'text-purple-700 dark:text-purple-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                        {channel}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Source Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Sources
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAllSources}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllSources}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              
              {/* Search */}
              <input
                type="text"
                placeholder="Search sources..."
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                disabled={disabled}
                className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg mb-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
              />
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filteredSourceOptions.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    {sourceSearch ? 'No sources match your search' : 'No sources found'}
                  </div>
                ) : (
                  filteredSourceOptions.map(source => {
                    const isSelected = localSources.includes(source);
                    return (
                      <label
                        key={source}
                        className={`
                          flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                          ${isSelected 
                            ? 'bg-green-50 dark:bg-green-900/30' 
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }
                          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        <div className={`
                          w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                          ${isSelected 
                            ? 'bg-green-600 border-green-600' 
                            : 'border-gray-300 dark:border-gray-600'
                          }
                        `}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSourceToggle(source)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-green-700 dark:text-green-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {source}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            {/* SGA Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  SGAs
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectActiveSgas}
                    disabled={disabled || sgaOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Active Only
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleSelectAllSgas}
                    disabled={disabled || sgaOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    All SGAs
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={handleDeselectAllSgas}
                    disabled={disabled || sgaOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              
              {/* Search */}
              <input
                type="text"
                placeholder="Search SGAs..."
                value={sgaSearch}
                onChange={(e) => setSgaSearch(e.target.value)}
                disabled={disabled || sgaOptionsLoading}
                className="w-full px-3 py-2 text-base border border-gray-300 dark:border-gray-600 rounded-lg mb-2 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 disabled:opacity-50"
              />
              
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {sgaOptionsLoading ? (
                  <div className="flex items-center justify-center py-4 text-gray-400">
                    Loading SGAs...
                  </div>
                ) : filteredSgaOptions.length === 0 ? (
                  <div className="flex items-center justify-center py-4 text-gray-400 text-sm">
                    {sgaSearch ? 'No SGAs match your search' : 'No SGAs found'}
                  </div>
                ) : (
                  filteredSgaOptions.map(sga => {
                    const isSelected = localSGAs.includes(sga.value);
                    return (
                      <label
                        key={sga.value}
                        className={`
                          flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                          ${isSelected 
                            ? 'bg-orange-50 dark:bg-orange-900/30' 
                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }
                          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        <div className={`
                          w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                          ${isSelected 
                            ? 'bg-orange-600 border-orange-600' 
                            : 'border-gray-300 dark:border-gray-600'
                          }
                        `}>
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleSgaToggle(sga.value)}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-orange-700 dark:text-orange-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {sga.label}
                        </span>
                        {!sga.isActive && (
                          <span className="text-sm text-gray-400 dark:text-gray-500">
                            (Inactive)
                          </span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>
          
          {/* Footer with Apply and Reset buttons */}
          <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 bg-gray-50 dark:bg-gray-900 flex justify-between items-center mt-4">
            <span className="text-base text-gray-500 dark:text-gray-400">
              {hasPendingChanges ? 'Changes pending' : 'Filters applied'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleResetFilters}
                disabled={disabled}
                className="px-4 py-2 text-base text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reset
              </button>
              <button
                onClick={handleApplyFilters}
                disabled={disabled || !hasPendingChanges}
                className="px-5 py-2 text-base text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

**CRITICAL NOTES**:
1. **Pattern**: Follows `PipelineFilters.tsx` pattern exactly - local state until Apply is clicked
2. **Defaults**: 
   - Quarter: Current quarter
   - Channels: "Outbound" and "Outbound + Marketing" (2 channels)
   - Sources: ALL sources selected by default
   - SGAs: ALL active SGAs selected by default
3. **Reset**: Resets to defaults (all active SGAs, default channels, all sources)
4. **Apply Logic**: If sources empty, defaults to all. If SGAs empty, defaults to all active.

---

## Step 3.3: Create LeaderboardTable Component

**File**: `src/components/sga-hub/LeaderboardTable.tsx` (NEW)

**Action**: Create this new file (simplified - no filters, filters handled in parent):

**NOTE**: Based on Phase 5 findings, we should integrate leaderboard directly into `SGAHubContent.tsx` rather than creating a separate `SGALeaderboard.tsx` component. The filters will be in the parent component, matching the pattern used by the Quarterly Progress tab.

**File**: `src/components/sga-hub/LeaderboardTable.tsx` (NEW - simplified, no filters)

**Action**: Create this new file (filters will be added in SGAHubContent.tsx):

```typescript
// src/components/sga-hub/LeaderboardTable.tsx

'use client';

import { useMemo } from 'react';
import { Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Badge } from '@tremor/react';
import { Medal } from 'lucide-react';
import { LeaderboardEntry } from '@/types/sga-hub';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  isLoading?: boolean;
  onSQOClick?: (sgaName: string) => void;
  currentUserSgaName?: string; // For highlighting current user
}

/**
 * Get styling for top 3 ranks
 */
function getRankStyling(rank: number) {
  if (rank === 1) {
    return {
      rowClass: 'bg-yellow-50 dark:bg-yellow-900/20',
      medal: '🥇',
      textColor: 'text-yellow-600 dark:text-yellow-400',
    };
  } else if (rank === 2) {
    return {
      rowClass: 'bg-gray-50 dark:bg-gray-800/50',
      medal: '🥈',
      textColor: 'text-gray-600 dark:text-gray-400',
    };
  } else if (rank === 3) {
    return {
      rowClass: 'bg-orange-50 dark:bg-orange-900/20',
      medal: '🥉',
      textColor: 'text-orange-600 dark:text-orange-400',
    };
  }
  return {
    rowClass: '',
    medal: null,
    textColor: '',
  };
}

export function LeaderboardTable({ 
  entries, 
  isLoading = false, 
  onSQOClick,
  currentUserSgaName 
}: LeaderboardTableProps) {
  // Sort by rank (already sorted from API, but ensure consistency)
  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => a.rank - b.rank);
  }, [entries]);

  if (isLoading) {
    return (
      <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="py-12">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          SGA Leaderboard
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Ranked by SQO count for the selected period
        </p>
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <TableHeaderCell className="w-20 text-gray-600 dark:text-gray-400">
                Rank
              </TableHeaderCell>
              <TableHeaderCell className="text-gray-600 dark:text-gray-400">
                SGA Name
              </TableHeaderCell>
              <TableHeaderCell className="text-right text-gray-600 dark:text-gray-400">
                SQOs
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-gray-500 dark:text-gray-400 py-12">
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-lg font-medium">No SQOs found</p>
                    <p className="text-sm">Try adjusting your quarter, channels, or sources</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              sortedEntries.map((entry, idx) => {
                const rankStyling = getRankStyling(entry.rank);
                const baseZebraClass = idx % 2 === 0 
                  ? 'bg-white dark:bg-gray-800' 
                  : 'bg-gray-50 dark:bg-gray-900';
                
                const rowClass = entry.rank <= 3 
                  ? rankStyling.rowClass 
                  : baseZebraClass;
                
                const isCurrentUser = currentUserSgaName && entry.sgaName === currentUserSgaName;
                
                return (
                  <TableRow
                    key={entry.sgaName}
                    className={`
                      ${rowClass} 
                      hover:bg-gray-100 dark:hover:bg-gray-700 
                      transition-colors
                      ${isCurrentUser ? 'border-l-4 border-blue-500' : ''}
                    `}
                  >
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {rankStyling.medal && (
                          <span className="text-xl">{rankStyling.medal}</span>
                        )}
                        <span className={`font-semibold ${rankStyling.textColor || 'text-gray-900 dark:text-white'}`}>
                          {entry.rank}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-gray-900 dark:text-white">
                      <div className="flex items-center gap-2">
                        {entry.sgaName}
                        {isCurrentUser && (
                          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs">
                            You
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {onSQOClick ? (
                        <button
                          onClick={() => onSQOClick(entry.sgaName)}
                          className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {entry.sqoCount}
                        </button>
                      ) : (
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {entry.sqoCount}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
```

**CRITICAL NOTES**:
1. **No Filters**: This component only displays the table - filters are handled in parent (`SGAHubContent.tsx`)
2. **Medal Icons**: Use emoji medals (🥇 🥈 🥉) for consistency with game leaderboard
3. **Current User**: Highlight with border and badge if `currentUserSgaName` prop provided
4. **Loading State**: Use `LoadingSpinner` component (consistent with other tables)
5. **Empty State**: Show helpful message when no entries

---

## Step 3.5: Terminal Validation

**Action**: Run these commands:

```bash
# Check for TypeScript errors
npx tsc --noEmit

# Check for linting errors
npm run lint -- --fix

# Verify files were created
ls -la src/components/sga-hub/LeaderboardFilters.tsx
ls -la src/components/sga-hub/LeaderboardTable.tsx
```

---

## Phase 3 Completion Checklist

- [ ] Q3.1.1: Documented SGAHubTabs patterns
- [ ] Q3.1.2: Documented SGAHubContent patterns
- [ ] Q3.1.3: Identified reusable filter components
- [ ] Q3.2: Updated SGAHubTabs.tsx with leaderboard tab
- [ ] Q3.2.5: Created LeaderboardFilters.tsx component
- [ ] Q3.3: Created LeaderboardTable.tsx
- [ ] Q3.5: No TypeScript or linting errors

**NOTE**: SGALeaderboard.tsx is NOT needed - integrate directly into SGAHubContent.tsx (Phase 4)

---

## 🛑 STOP - PHASE 3 COMPLETE

**CURSOR.AI**: Report your findings for Phase 3:

1. What patterns did you observe in existing tab components?
2. What filter components exist for reuse?
3. Any modifications made to the suggested code?
4. Any TypeScript or linting errors fixed?

**Update this document** with your findings in a new section called "Phase 3 Results" below.

**ASK**: "Phase 3 complete. Ready to proceed to Phase 4 (Integration with SGAHubContent)?"

---

# 🚀 PHASE 4: Integration with SGAHubContent

## Objective
Integrate the leaderboard components into the SGAHubContent page.

---

## Step 4.1: Update SGAHubContent.tsx

**File**: `src/app/dashboard/sga-hub/SGAHubContent.tsx`

**Changes Required**:

1. Import LeaderboardTable component
2. Update default activeTab to 'leaderboard'
3. Add leaderboard state (entries, loading, error, filters)
4. Add filter options state (channels, sources)
5. Fetch filter options on mount
6. Add fetchLeaderboard function
7. Add leaderboard tab content with filters
8. Add drill-down handlers

**Action**: Modify the file with these changes:

### 4.1.1: Add imports at the top

```typescript
// Add these imports
import { LeaderboardTable } from '@/components/sga-hub/LeaderboardTable';
import { LeaderboardFilters } from '@/components/sga-hub/LeaderboardFilters';
import { LeaderboardEntry } from '@/types/sga-hub';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/sga-hub-helpers';
```

### 4.1.2: Change default activeTab

```typescript
// Change from:
const [activeTab, setActiveTab] = useState<SGAHubTab>('weekly-goals');

// To:
const [activeTab, setActiveTab] = useState<SGAHubTab>('leaderboard');
```

### 4.1.3: Add leaderboard state

```typescript
// Add these state variables after other state declarations
// Leaderboard state
const [leaderboardEntries, setLeaderboardEntries] = useState<LeaderboardEntry[]>([]);
const [leaderboardLoading, setLeaderboardLoading] = useState(false);
const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

// Leaderboard filters (applied filters)
const [leaderboardQuarter, setLeaderboardQuarter] = useState<string>(getCurrentQuarter());
const [leaderboardChannels, setLeaderboardChannels] = useState<string[]>(['Outbound', 'Outbound + Marketing']);
const [leaderboardSources, setLeaderboardSources] = useState<string[]>([]); // Empty array = all sources (default)
const [leaderboardSGAs, setLeaderboardSGAs] = useState<string[]>([]); // Empty array = all active SGAs (default)

// Filter options (for channel/source/SGA dropdowns)
const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
const [sgaOptions, setSgaOptions] = useState<Array<{ value: string; label: string; isActive: boolean }>>([]);
const [sgaOptionsLoading, setSgaOptionsLoading] = useState(false);
```

### 4.1.4: Add useEffect to fetch filter options

```typescript
// Add this useEffect to fetch filter options (if not already present)
useEffect(() => {
  const fetchFilterOptions = async () => {
    try {
      const options = await dashboardApi.getFilterOptions();
      setFilterOptions(options);
      // Set default sources to all sources
      if (options && options.sources) {
        setLeaderboardSources([...options.sources]);
      }
    } catch (err) {
      console.error('Error fetching filter options:', err);
    }
  };
  
  fetchFilterOptions();
}, []);

// Fetch SGA options for leaderboard filter
useEffect(() => {
  const fetchSGAOptions = async () => {
    try {
      setSgaOptionsLoading(true);
      const response = await dashboardApi.getLeaderboardSGAOptions();
      setSgaOptions(response.sgaOptions);
      // Set default SGAs to all active SGAs
      const activeSGAs = response.sgaOptions.filter(s => s.isActive).map(s => s.value);
      setLeaderboardSGAs(activeSGAs);
    } catch (err) {
      console.error('Error fetching SGA options:', err);
    } finally {
      setSgaOptionsLoading(false);
    }
  };
  
  fetchSGAOptions();
}, []);
```

### 4.1.5: Add fetchLeaderboard function

```typescript
// Add this function after other fetch functions
const fetchLeaderboard = async () => {
  try {
    setLeaderboardLoading(true);
    setLeaderboardError(null);
    
    // Convert quarter to date range
    const quarterInfo = getQuarterInfo(leaderboardQuarter);
    
    // Call API
    const response = await dashboardApi.getSGALeaderboard({
      startDate: quarterInfo.startDate,
      endDate: quarterInfo.endDate,
      channels: leaderboardChannels,
      sources: leaderboardSources.length > 0 ? leaderboardSources : undefined,
      sgaNames: leaderboardSGAs.length > 0 ? leaderboardSGAs : undefined,
    });
    
    setLeaderboardEntries(response.entries);
  } catch (err) {
    setLeaderboardError(handleApiError(err));
  } finally {
    setLeaderboardLoading(false);
  }
};
```

### 4.1.6: Update useEffect to include leaderboard

```typescript
// Update existing useEffect to include leaderboard
useEffect(() => {
  if (activeTab === 'weekly-goals') {
    fetchWeeklyData();
  } else if (activeTab === 'closed-lost') {
    fetchClosedLostRecords();
    fetchReEngagementOpportunities();
  } else if (activeTab === 'quarterly-progress') {
    fetchQuarterlyProgress();
  } else if (activeTab === 'leaderboard') {
    fetchLeaderboard();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeTab, dateRange.startDate, dateRange.endDate, selectedQuarter, 
    leaderboardQuarter, leaderboardChannels, leaderboardSources, leaderboardSGAs]);
```

### 4.1.7: Add leaderboard drill-down handler

```typescript
// Add this handler after other drill-down handlers
const handleLeaderboardSQOClick = async (sgaName: string) => {
  setDrillDownLoading(true);
  setDrillDownError(null);
  setDrillDownMetricType('sqos');
  setDrillDownOpen(true);
  
  const quarterInfo = getQuarterInfo(leaderboardQuarter);
  const title = `${sgaName} - SQOs - ${leaderboardQuarter}`;
  setDrillDownTitle(title);
  
  setDrillDownContext({
    metricType: 'sqos',
    title,
    sgaName: sgaName,
    quarter: leaderboardQuarter,
  });
  
  try {
    // Call drill-down API with channels/sources filters
    const response = await dashboardApi.getSQODrillDown(
      sgaName, 
      { quarter: leaderboardQuarter },
      undefined, // userEmail
      leaderboardChannels.length > 0 ? leaderboardChannels : undefined,
      leaderboardSources.length > 0 ? leaderboardSources : undefined
    );
    setDrillDownRecords(response.records);
  } catch (error) {
    console.error('Error fetching SQO drill-down:', error);
    setDrillDownError('Failed to load SQO records. Please try again.');
  } finally {
    setDrillDownLoading(false);
  }
};
```

### 4.1.8: Add leaderboard tab content

```typescript
// Add this as the FIRST tab content (before weekly-goals)
{activeTab === 'leaderboard' && (
  <>
    {/* Leaderboard Filters Component */}
    {filterOptions && (
      <LeaderboardFilters
        selectedQuarter={leaderboardQuarter}
        selectedChannels={leaderboardChannels}
        selectedSources={leaderboardSources}
        selectedSGAs={leaderboardSGAs}
        channelOptions={filterOptions.channels}
        sourceOptions={filterOptions.sources}
        sgaOptions={sgaOptions}
        sgaOptionsLoading={sgaOptionsLoading}
        onApply={(filters) => {
          setLeaderboardQuarter(filters.quarter);
          setLeaderboardChannels(filters.channels);
          setLeaderboardSources(filters.sources);
          setLeaderboardSGAs(filters.sgas);
          // fetchLeaderboard will be called automatically via useEffect dependency
        }}
        disabled={leaderboardLoading}
      />
    )}
    
    {/* Error Display */}
    {leaderboardError && (
      <Card className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
        <Text className="text-red-600 dark:text-red-400">{leaderboardError}</Text>
      </Card>
    )}
    
    {/* Leaderboard Table */}
    <LeaderboardTable
      entries={leaderboardEntries}
      isLoading={leaderboardLoading}
      onSQOClick={handleLeaderboardSQOClick}
      currentUserSgaName={sgaName}
    />
  </>
)}
```

**CRITICAL NOTES**:
1. **Filter Component**: Use `LeaderboardFilters` component (created in Step 3.2.5) - handles all filter UI
2. **Filter State**: Filters are managed in parent component state, passed to filter component as props
3. **Apply Handler**: When "Apply Filters" is clicked, update state which triggers `useEffect` to fetch new data
4. **Defaults**: 
   - Sources default to ALL (empty array = all sources)
   - SGAs default to ALL active (empty array = all active SGAs)
   - Channels default to ['Outbound', 'Outbound + Marketing']
5. **Reuse Modal State**: Use existing `drillDownOpen`, `drillDownRecords`, etc. state (already exists in component)

---

## Step 4.2: Update Drill-Down API to Support Channel/Source Filters

**File**: `src/lib/queries/drill-down.ts`

**Changes Required**: Add optional `channels` and `sources` parameters to `_getSQODrillDown` function.

**Action**: Update the function signature and query:

```typescript
// Update the _getSQODrillDown function signature
const _getSQODrillDown = async (
  sgaName: string,
  startDate: string,
  endDate: string,
  options?: {
    channels?: string[];
    sources?: string[];
  }
): Promise<SQODrillDownRecord[]> => {
  const { channels, sources } = options || {};
  
  // Build channel filter clause (optional)
  const channelFilter = channels && channels.length > 0
    ? 'AND v.Channel_Grouping_Name IN UNNEST(@channels)'
    : '';
  
  // Build source filter clause (optional)
  const sourceFilter = sources && sources.length > 0
    ? 'AND v.Original_source IN UNNEST(@sources)'
    : '';

  const query = `
    SELECT 
      v.primary_key,
      v.advisor_name,
      v.Date_Became_SQO__c,
      v.Original_source,
      -- Use Channel_Grouping_Name directly (no MAPPING_TABLE for leaderboard drill-down)
      v.Channel_Grouping_Name as channel,
      v.Opportunity_AUM,
      v.Underwritten_AUM__c,
      v.aum_tier,
      v.TOF_Stage,
      v.StageName,
      v.lead_url,
      v.opportunity_url
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
    WHERE (v.SGA_Owner_Name__c = @sgaName OR v.Opp_SGA_Name__c = @sgaName OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sgaName)
      AND v.is_sqo_unique = 1
      AND v.Date_Became_SQO__c IS NOT NULL
      AND v.recordtypeid = @recruitingRecordType
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      ${channelFilter}
      ${sourceFilter}
    ORDER BY v.Date_Became_SQO__c DESC
  `;

  const params: Record<string, any> = {
    sgaName,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  if (channels && channels.length > 0) {
    params.channels = channels;
  }
  if (sources && sources.length > 0) {
    params.sources = sources;
  }

  const results = await runQuery<RawSQODrillDownRecord>(query, params);
  return results.map(transformSQODrillDownRecord);
};
```

**CRITICAL NOTES**:
1. **Backward Compatibility**: Make `options` parameter optional - existing calls continue to work
2. **Channel Handling**: Use `Channel_Grouping_Name` directly (no MAPPING_TABLE join) for leaderboard drill-down
3. **Date Format**: Use `CONCAT(@endDate, ' 23:59:59')` (space, not 'T')
4. **SGA Attribution**: Use correct pattern: `(v.SGA_Owner_Name__c = @sgaName OR v.Opp_SGA_Name__c = @sgaName OR COALESCE(sga_user.Name, v.Opp_SGA_Name__c) = @sgaName)`

---

## Step 4.3: Update Drill-Down API Route

**File**: `src/app/api/sga-hub/drill-down/sqos/route.ts`

**Changes Required**: Accept channels and sources as query parameters (maintains GET method consistency).

**Action**: Update the route to handle new parameters:

```typescript
// Parse query parameters (add channels and sources)
const { searchParams } = new URL(request.url);
const targetUserEmail = searchParams.get('userEmail');
const weekStartDate = searchParams.get('weekStartDate');
const weekEndDate = searchParams.get('weekEndDate');
const quarter = searchParams.get('quarter');
const channels = searchParams.getAll('channels'); // Returns array
const sources = searchParams.getAll('sources');   // Returns array

// ... existing validation and user lookup code ...

// Determine date range (existing code)
let startDate: string;
let endDate: string;

if (quarter) {
  const quarterInfo = getQuarterInfo(quarter);
  startDate = quarterInfo.startDate;
  endDate = quarterInfo.endDate;
} else {
  startDate = weekStartDate!;
  endDate = weekEndDate!;
}

// Fetch drill-down records with optional filters
const records = await getSQODrillDown(
  user.name, 
  startDate, 
  endDate,
  {
    channels: channels.length > 0 ? channels : undefined,
    sources: sources.length > 0 ? sources : undefined,
  }
);
```

**CRITICAL NOTES**:
1. **GET Method**: Keep GET method (consistent with existing drill-down routes)
2. **Query Parameters**: Use `searchParams.getAll()` for array parameters
3. **Backward Compatibility**: Make channels/sources optional - existing calls work without them

---

## Step 4.4: Update API Client

**File**: `src/lib/api-client.ts`

**Changes Required**: Update `getSQODrillDown` to accept channels and sources as query parameters.

**Action**: Update the method signature:

```typescript
// Update existing getSQODrillDown method
getSQODrillDown: (
  sgaName: string,
  options: { weekStartDate?: string; weekEndDate?: string; quarter?: string },
  userEmail?: string,
  channels?: string[],
  sources?: string[]
) => {
  const params = new URLSearchParams({
    ...(options.weekStartDate && { weekStartDate: options.weekStartDate }),
    ...(options.weekEndDate && { weekEndDate: options.weekEndDate }),
    ...(options.quarter && { quarter: options.quarter }),
    ...(userEmail && { userEmail }),
  });
  
  // Add array parameters (channels and sources)
  if (channels && channels.length > 0) {
    channels.forEach(channel => params.append('channels', channel));
  }
  if (sources && sources.length > 0) {
    sources.forEach(source => params.append('sources', source));
  }
  
  return apiFetch<{ records: SQODrillDownRecord[] }>(
    `/api/sga-hub/drill-down/sqos?${params.toString()}`
  );
},
```

**CRITICAL NOTES**:
1. **GET Method**: Keep GET method (not POST) - consistent with existing pattern
2. **Query Parameters**: Use `URLSearchParams` with `append()` for array parameters
3. **Backward Compatibility**: Make channels/sources optional - existing calls work without them

---

## Step 4.5: Terminal Validation

**Action**: Run these commands:

```bash
# Check for TypeScript errors
npx tsc --noEmit

# Check for linting errors  
npm run lint -- --fix

# Verify imports are correct
grep -n "SGALeaderboard" src/app/dashboard/sga-hub/SGAHubContent.tsx
```

---

## Phase 4 Completion Checklist

- [ ] Step 4.1: Updated SGAHubContent.tsx with leaderboard integration
- [ ] Step 4.2: Updated drill-down query to support channel/source filters
- [ ] Step 4.3: Updated drill-down API route
- [ ] Step 4.4: Updated API client method
- [ ] Step 4.5: No TypeScript or linting errors

---

## 🛑 STOP - PHASE 4 COMPLETE

**CURSOR.AI**: Report your findings for Phase 4:

1. What changes were made to SGAHubContent.tsx?
2. Were there any issues with the drill-down query modifications?
3. Any TypeScript or linting errors fixed?
4. Any additional modifications needed?

**Update this document** with your findings in a new section called "Phase 4 Results" below.

**ASK**: "Phase 4 complete. Ready to proceed to Phase 5 (Testing & Validation)?"

---

# 🚀 PHASE 5: Testing & Validation

## Objective
Comprehensive testing of the leaderboard feature with data validation.

---

## Step 5.1: Start Development Server

**Action**: Start the dev server and verify no startup errors:

```bash
npm run dev
```

**Document**:
- Server started successfully (Y/N)
- Any compilation errors or warnings

---

## Step 5.2: UI/UX Validation (User performs these)

**INSTRUCTION TO USER**: Perform these manual validations in the browser.

### Test 5.2.1: Tab Navigation

1. Navigate to `/dashboard/sga-hub`
2. Verify "Leaderboard" is the first tab (leftmost)
3. Verify Trophy icon appears next to "Leaderboard" label
4. Click through all tabs - verify each works
5. Refresh page - verify leaderboard is default tab

**Expected Results**:
- [ ] Leaderboard tab is first/leftmost
- [ ] Trophy icon is visible
- [ ] All tabs are functional
- [ ] Leaderboard is default after refresh

---

### Test 5.2.2: Default Filters

1. On Leaderboard tab, verify default filters:
   - Quarter: Current quarter (e.g., "2026-Q1" format)
   - Channels: "Outbound" and "Outbound + Marketing" checked
   - Sources: None selected (empty array = all sources)

**Expected Results**:
- [ ] Quarter matches current quarter (format: "YYYY-QN", e.g., "2026-Q1")
- [ ] Both default channels are checked
- [ ] No sources selected by default (shows all sources)

---

### Test 5.2.3: Leaderboard Data Display

1. Verify leaderboard table shows data
2. Verify medals appear for ranks 1, 2, 3 (Trophy for 1st, Medal for 2nd/3rd)
3. Verify rank numbers appear for 4th and below
4. Verify top 3 rows have subtle yellow background

**Expected Results**:
- [ ] Data displays in table
- [ ] Medals display correctly
- [ ] Rank numbers display for 4+
- [ ] Visual distinction for top 3

---

### Test 5.2.4: Filter Functionality

1. Change quarter to "2025-Q4" (use full format, not separate Q4/year)
2. Verify leaderboard refreshes
3. Look for Perry Kalmeta - should have 5 SQOs
4. Change back to "2026-Q1" (or current quarter)
5. Look for Brian O'Hara - should have 4 SQOs
6. Verify Perry Kalmeta has 0 SQOs in Q1 2026

**Expected Results**:
- [ ] Q4 2025: Perry Kalmeta = 5 SQOs
- [ ] Q1 2026: Brian O'Hara = 4 SQOs
- [ ] Q1 2026: Perry Kalmeta = 0 SQOs (or not on list)

**CRITICAL**: Quarter selector uses "YYYY-QN" format (e.g., "2026-Q1"), not separate quarter/year dropdowns

---

### Test 5.2.5: Drill-Down Modal

1. Click on Brian O'Hara's SQO count (4) in Q1 2026
2. Verify drill-down modal opens
3. Verify title shows "Brian O'Hara - SQOs - 2026-Q1" (or similar format)
4. Verify 4 records appear
5. Verify advisor names: Daniel Di Lascia, John Goltermann, Ethan Freishtat, J. Ian Scroggs
6. Verify records match current channel/source filters

**Expected Results**:
- [ ] Modal opens on click
- [ ] Correct title displayed (includes quarter in "YYYY-QN" format)
- [ ] 4 records shown
- [ ] Correct advisor names
- [ ] Records respect channel/source filters from leaderboard

---

### Test 5.2.6: Record Detail Modal

1. From drill-down modal, click on any SQO record
2. Verify record detail modal opens
3. Verify "← Back to SQOs" button appears
4. Click back button
5. Verify returns to drill-down modal with same data

**Expected Results**:
- [ ] Record detail opens
- [ ] Back button visible
- [ ] Back returns to drill-down
- [ ] Drill-down data preserved

---

## Step 5.3: Console Validation (User performs these)

**INSTRUCTION TO USER**: Open browser DevTools (F12) and check Console tab.

### Test 5.3.1: No Console Errors

1. Open DevTools → Console
2. Navigate through leaderboard tabs
3. Apply filters
4. Open drill-down modal
5. Open record detail modal

**Expected**: No red errors in console

**Document any errors seen**:
- Error 1: ___
- Error 2: ___

---

### Test 5.3.2: Network Tab Validation

1. Open DevTools → Network tab
2. Refresh leaderboard page
3. Verify `/api/sga-hub/leaderboard` request
4. Check response is 200 OK
5. Check response contains `entries` array

**Expected Results**:
- [ ] API request made
- [ ] 200 OK status
- [ ] Valid response structure

---

## Step 5.4: BigQuery MCP Final Validation

**Action**: Run final validation queries via MCP BigQuery:

### Test 5.4.1: Validate Full Leaderboard Query (Q1 2026)

```sql
-- Full leaderboard validation for Q1 2026
-- CRITICAL: Use actual implementation pattern (no CTEs, use EXISTS subquery)
SELECT 
  COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) as sga_name,
  COUNT(DISTINCT v.primary_key) as sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` sga_user
  ON v.Opp_SGA_Name__c = sga_user.Id
WHERE v.is_sqo_unique = 1
  AND v.recordtypeid = '012Dn000000mrO3IAI'
  AND v.Date_Became_SQO__c IS NOT NULL
  AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2026-01-01')
  AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT('2026-01-27', ' 23:59:59'))  -- Use current date for QTD
  AND v.Channel_Grouping_Name IN ('Outbound', 'Outbound + Marketing')
  -- Active SGA filtering (EXISTS subquery pattern)
  AND EXISTS (
    SELECT 1 
    FROM `savvy-gtm-analytics.SavvyGTMData.User` u
    WHERE u.Name = COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)
      AND u.IsSGA__c = TRUE
      AND u.IsActive = TRUE
      AND u.Name NOT IN ('Anett Diaz', 'Jacqueline Tully', 'Savvy Operations', 'Savvy Marketing', 'Russell Moss', 'Jed Entin')
  )
GROUP BY sga_name
ORDER BY sqo_count DESC, sga_name ASC
```

**Document**:
- Total rows returned
- Verify Brian O'Hara has 4 SQOs
- Verify no excluded SGAs appear
- **CRITICAL**: Query matches actual implementation pattern (no CTEs, EXISTS subquery)

---

## Step 5.5: Final TypeScript & Linting Check

**Action**: Run final checks:

```bash
# Full TypeScript check
npx tsc --noEmit

# Full linting
npm run lint

# Build test
npm run build
```

**Document**:
- TypeScript errors: ___
- Linting errors: ___
- Build successful: Y/N

---

## Phase 5 Completion Checklist

- [ ] Step 5.1: Dev server starts without errors
- [ ] Step 5.2.1: Tab navigation works
- [ ] Step 5.2.2: Default filters correct
- [ ] Step 5.2.3: Leaderboard displays correctly
- [ ] Step 5.2.4: Filter functionality works
- [ ] Step 5.2.5: Drill-down modal works
- [ ] Step 5.2.6: Record detail modal works
- [ ] Step 5.3.1: No console errors
- [ ] Step 5.3.2: Network requests successful
- [ ] Step 5.4.1: BigQuery validation passed
- [ ] Step 5.5: TypeScript, linting, build all pass

---

## 🛑 STOP - PHASE 5 COMPLETE

**CURSOR.AI**: Report your findings for Phase 5:

1. Did the dev server start without errors?
2. What issues were found during testing?
3. Were any fixes required?
4. Final build status?

**Update this document** with your findings in a new section called "Phase 5 Results" below.

**ASK**: "Phase 5 complete. Ready to proceed to Phase 6 (Documentation & Cleanup)?"

---

# 🚀 PHASE 6: Documentation & Cleanup

## Objective
Update documentation and perform final cleanup.

---

## Step 6.1: Update ARCHITECTURE.md

**File**: `docs/ARCHITECTURE.md`

**Action**: Add Leaderboard Tab documentation in Section 8 (SGA Hub & Management) as the first tab:

```markdown
### SGA Hub Tabs

#### 0. Leaderboard Tab

Displays active SGAs ranked by SQO count for a selected period.

**Features**:
- Ranked list of SGAs by SQO count
- Medal icons for top 3 (🏆 Gold trophy for 1st, Silver/Bronze medals for 2nd/3rd)
- Filtering by quarter, year, channels, and sources
- Default filters: Current quarter, "Outbound" + "Outbound + Marketing" channels
- Clickable SQO counts open drill-down modal showing individual SQOs
- Nested modal flow: Leaderboard → Drill-down → Record Detail → Back to Drill-down

**Data Source**: `vw_funnel_master` with SQO filtering
**API Route**: `POST /api/sga-hub/leaderboard`
**Query Function**: `getSGALeaderboard()` in `src/lib/queries/sga-leaderboard.ts`

**SGA Attribution Logic**:
- Prioritizes `Opp_SGA_Name__c` (opportunity-level) over `SGA_Owner_Name__c` (lead-level)
- Resolves User IDs via `User` table join (when `Opp_SGA_Name__c` starts with '005')
- Only includes active SGAs (`IsSGA__c = TRUE`, `IsActive = TRUE`)
- Excludes always-inactive SGAs: Anett Diaz, Jacqueline Tully, Savvy Operations, Savvy Marketing, Russell Moss, Jed Entin

**Ranking Logic**:
- Ties receive same rank, next rank skips (e.g., 1, 1, 3, 4, 4, 6)
- Secondary sort: alphabetical by SGA name

**Drill-Down with Filters**:
- When clicking SQO count, drill-down respects current channel/source filters
- Passes `channels` and `sources` parameters to `/api/sga-hub/drill-down/sqos`

**Default Filters**:
- Quarter: Current quarter (QTD)
- Year: Current year
- Channels: "Outbound" and "Outbound + Marketing" (both selected)
- Sources: All sources (no filter)

**API Route Details**:
- Method: POST
- Authentication: Required
- Request Body: `{ startDate, endDate, channels, sources? }`
- Response: `{ entries: LeaderboardEntry[] }`

#### 1. Weekly Goals Tab
[... existing content ...]
```

---

## Step 6.2: Remove Debug Code

**Action**: Search for and remove any debug code:

```bash
# Check for console.log statements (should not be in production code)
grep -r "console.log" src/lib/queries/sga-leaderboard.ts
grep -r "console.log" src/components/sga-hub/SGALeaderboard.tsx
grep -r "console.log" src/components/sga-hub/LeaderboardTable.tsx

# Check for TODO/FIXME comments
grep -r "TODO\|FIXME" src/lib/queries/sga-leaderboard.ts
grep -r "TODO\|FIXME" src/components/sga-hub/SGALeaderboard.tsx
```

**Document**: Any debug code found and removed

---

## Step 6.3: Add JSDoc Comments

**Action**: Verify all new functions have JSDoc comments:

1. `src/lib/queries/sga-leaderboard.ts`:
   - `_getSGALeaderboard` - documented
   - `calculateRanks` - documented
   - Interfaces - documented

2. `src/components/sga-hub/LeaderboardTable.tsx`:
   - `RankDisplay` - add comment if missing
   - `LeaderboardTable` - add comment if missing

3. `src/components/sga-hub/SGALeaderboard.tsx`:
   - Main component - add comment if missing
   - Helper functions - add comments if missing

---

## Step 6.4: Final File Review

**Action**: Verify all files are in place:

```bash
# List all new/modified files
ls -la src/lib/queries/sga-leaderboard.ts
ls -la src/app/api/sga-hub/leaderboard/route.ts
ls -la src/components/sga-hub/SGALeaderboard.tsx
ls -la src/components/sga-hub/LeaderboardTable.tsx
```

---

## Step 6.5: Final Build & Deploy Check

**Action**: Run final build:

```bash
# Clean build
rm -rf .next
npm run build

# Verify no errors
echo "Build exit code: $?"
```

---

## Phase 6 Completion Checklist

- [ ] Step 6.1: ARCHITECTURE.md updated
- [ ] Step 6.2: No debug code remaining
- [ ] Step 6.3: JSDoc comments added
- [ ] Step 6.4: All files verified
- [ ] Step 6.5: Build successful

---

## 🛑 STOP - PHASE 6 COMPLETE

**CURSOR.AI**: Report your findings for Phase 6:

1. What documentation was added/updated?
2. Was any debug code removed?
3. Final build status?
4. Feature ready for deployment?

**Update this document** with your findings in a new section called "Phase 6 Results" below.

---

# ✅ IMPLEMENTATION COMPLETE

## Final Summary

After completing all 6 phases, the SGA Leaderboard feature should be fully implemented with:

### Files Created
1. `src/lib/queries/sga-leaderboard.ts` - BigQuery query function
2. `src/app/api/sga-hub/leaderboard/route.ts` - API route
3. `src/components/sga-hub/SGALeaderboard.tsx` - Main component
4. `src/components/sga-hub/LeaderboardTable.tsx` - Table with medals

### Files Modified
1. `src/components/sga-hub/SGAHubTabs.tsx` - Added leaderboard tab
2. `src/app/dashboard/sga-hub/SGAHubContent.tsx` - Integrated leaderboard
3. `src/types/sga-hub.ts` - Added leaderboard types
4. `src/lib/api-client.ts` - Added API client method
5. `src/lib/queries/drill-down.ts` - Added channel/source filters
6. `src/app/api/sga-hub/drill-down/sqos/route.ts` - Accept filters
7. `docs/ARCHITECTURE.md` - Added documentation

### Validation Passed
- Perry Kalmeta Q4 2025 = 5 SQOs ✅
- Brian O'Hara Q1 2026 = 4 SQOs ✅
- Drill-down shows correct advisor names ✅
- TypeScript compilation ✅
- Linting ✅
- Build ✅

---

# 📝 PHASE RESULTS LOG

(This section will be filled in by Cursor.AI after each phase)

## Phase 1 Results

**Status**: ✅ COMPLETE

### Step 1.1: Existing Query Patterns

**Q1.1.1 - Query Function Patterns**:
- ✅ Import pattern: `runQuery` from `@/lib/bigquery`
- ✅ Caching: Uses `cachedQuery` wrapper with `CACHE_TAGS.SGA_HUB`
- ✅ Parameters: Parameterized queries with `@paramName` syntax
- ✅ Date handling: Uses `TIMESTAMP()` wrapper for `Date_Became_SQO__c` (TIMESTAMP field)
- ✅ End date format: `CONCAT(@endDate, ' 23:59:59')` (space, not 'T')
- ✅ Type transformations: Uses `toString()` and `toNumber()` from `@/types/bigquery-raw`
- ✅ SGA Attribution: Uses `COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c)` pattern with User table join

**Q1.1.2 - Excluded SGAs**:
- ✅ Confirmed complete list:
  - Anett Diaz
  - Jacqueline Tully
  - Savvy Operations
  - Savvy Marketing
  - Russell Moss
  - Jed Entin

**Q1.1.3 - BigQuery Schema Verification**:
- ✅ All fields exist as expected:
  - `primary_key`, `advisor_name`, `SGA_Owner_Name__c`, `Opp_SGA_Name__c`
  - `Date_Became_SQO__c` (TIMESTAMP field - confirmed via sample data)
  - `Channel_Grouping_Name`, `Original_source`
  - `is_sqo_unique`, `recordtypeid`
- ✅ **CRITICAL**: `Date_Became_SQO__c` is a TIMESTAMP field - must use `TIMESTAMP()` wrapper
- ✅ **CRITICAL**: `Opp_SGA_Name__c` can contain User IDs (e.g., "005VS000000KWLVYA4") - requires User table join

### Step 1.2: Validation Queries

**Q1.2.1 - Perry Kalmeta Q4 2025 = 5 SQOs**:
- ✅ **PASSED**: Query returned exactly 5 SQOs
- ✅ Advisor names verified: Shang Chou, Tim Dern, Chris Lee, David Bigelow, CFP®, MBA, Dan Meyers
- ✅ SGA attribution pattern works correctly

**Q1.2.2 - Brian O'Hara Q1 2026 = 4 SQOs**:
- ✅ **PASSED**: Query returned exactly 4 SQOs
- ✅ Advisor names verified: Ethan Freishtat, Daniel Di Lascia, John Goltermann, J. Ian Scroggs
- ✅ Channel filter works correctly (Outbound + Marketing)

**Q1.2.3 - Channel Filtering**:
- ✅ **PASSED**: Channel values exist as expected
- ✅ "Outbound + Marketing" channel confirmed in data

**Q1.2.4 - Active SGA Filter Logic**:
- ✅ **PASSED**: Query returns active SGAs correctly
- ✅ Excluded SGAs are properly filtered out
- ✅ Sample active SGA: Ryan Crandall (verified)

### Step 1.3: Query Function Updates

**Changes Made**:
1. ✅ Added `sgaNames` parameter support to `_getSGALeaderboard` function
2. ✅ Implemented conditional SGA filtering:
   - If `sgaNames` provided and not empty → filter to only those SGAs
   - Otherwise → use EXISTS subquery to filter to active SGAs (default behavior)
3. ✅ Updated `LeaderboardFilters` type to include optional `sgaNames?: string[]`
4. ✅ Query uses `EXISTS` subquery pattern (matches existing codebase pattern)

**File Modified**: `src/lib/queries/sga-leaderboard.ts`
**Type Modified**: `src/types/sga-hub.ts`

### Step 1.4: Terminal Validation

**TypeScript Check**:
- ✅ **PASSED**: `npx tsc --noEmit` - No errors

**Linting Check**:
- ✅ **PASSED**: `npm run lint` - No errors (only pre-existing warnings in other files)

### Decisions Made

1. **SGA Filtering Logic**: Used conditional logic (if `sgaNames` provided, use direct filter; otherwise use EXISTS subquery) to maintain backward compatibility while adding new functionality.

2. **Type Updates**: Added `sgaNames` as optional parameter to `LeaderboardFilters` interface to match implementation plan requirements.

3. **Query Pattern**: Maintained `EXISTS` subquery pattern for active SGA filtering (matches existing codebase patterns) rather than using CTEs.

### Issues Found

None - all validation queries passed and code compiles successfully.

## Phase 2 Results

**Status**: ✅ COMPLETE

### Step 2.1: Existing API Route Patterns

**Q2.1.1 - API Route Structure**:
- ✅ **Authentication**: Uses `getServerSession(authOptions)` from `next-auth`
- ✅ **Authorization**: Uses `getUserPermissions(session.user.email)` and checks for specific roles `['admin', 'manager', 'sga']`
- ✅ **Request Body Parsing**: Uses `await request.json()` for POST requests
- ✅ **Error Handling**: Try-catch blocks with `console.error` logging and appropriate HTTP status codes
- ✅ **Response Format**: Returns `NextResponse.json()` with typed response objects
- ✅ **Dynamic Route**: Uses `export const dynamic = 'force-dynamic'` for Next.js App Router

**Pattern Observed**:
- Both `quarterly-progress/route.ts` and `drill-down/sqos/route.ts` follow the same pattern
- Authorization checks happen after authentication
- Error responses use consistent format: `{ error: string }` with appropriate status codes
- Query parameters parsed from `searchParams` for GET requests
- Request body parsed from `request.json()` for POST requests

### Step 2.2: API Route Updates

**Changes Made**:
1. ✅ Updated existing `/api/sga-hub/leaderboard/route.ts` to include `sgaNames` parameter:
   - Added `sgaNames` to request body parsing
   - Added `sgaNames` to filters object (with undefined handling)
   - Updated JSDoc comments to document `sgaNames` parameter

**File Modified**: `src/app/api/sga-hub/leaderboard/route.ts`

### Step 2.2.5: SGA Options API Route

**Created**:
1. ✅ New file: `src/app/api/sga-hub/leaderboard-sga-options/route.ts`
   - GET endpoint to fetch all SGAs (active and inactive) for filter picklist
   - Excludes always-excluded SGAs (matches query function)
   - Returns `{ sgaOptions: Array<{ value: string; label: string; isActive: boolean }> }`
   - Uses same auth/authorization pattern as leaderboard route
   - Queries `User` table with `IsSGA__c = TRUE` filter

**File Created**: `src/app/api/sga-hub/leaderboard-sga-options/route.ts`

### Step 2.3: API Client Methods

**Changes Made**:
1. ✅ Updated existing `getSGALeaderboard` method in `api-client.ts`:
   - Added `sgaNames?: string[]` parameter to filters type
   - Method signature now matches updated `LeaderboardFilters` interface

2. ✅ Created new `getLeaderboardSGAOptions` method:
   - Returns `{ sgaOptions: Array<{ value: string; label: string; isActive: boolean }> }`
   - Uses GET method (no body required)
   - Type-safe with proper return type

**File Modified**: `src/lib/api-client.ts`

### Step 2.4: Types Verification

**Status**:
- ✅ Types already exist in `src/types/sga-hub.ts` (added in Phase 1)
- ✅ `LeaderboardEntry` interface: `{ sgaName: string; sqoCount: number; rank: number }`
- ✅ `LeaderboardFilters` interface: Includes `sgaNames?: string[]` parameter

**File Verified**: `src/types/sga-hub.ts`

### Step 2.5: Terminal Validation

**TypeScript Check**:
- ✅ **PASSED**: `npx tsc --noEmit` - No errors

**Linting Check**:
- ✅ **PASSED**: `npm run lint` - No errors (only pre-existing warnings in other files)

### Step 2.6: API Testing

**Status**: Manual testing not performed (requires authenticated session)
- API routes created and validated via TypeScript compilation
- Route structure matches existing patterns
- Ready for frontend integration testing in Phase 3

### Decisions Made

1. **API Route Updates**: Updated existing route rather than recreating, maintaining consistency with codebase.

2. **SGA Options Route**: Created new GET endpoint following RESTful patterns (no body needed for simple data fetch).

3. **Type Safety**: All API client methods use proper TypeScript types for request/response validation.

4. **Error Handling**: Maintained consistent error handling pattern with existing routes (try-catch, console.error logging, appropriate HTTP status codes).

### Issues Found

None - all files compile successfully and follow existing patterns.

## Phase 3 Results

**Status**: ✅ COMPLETE

### Step 3.1: Existing Component Patterns

**Q3.1.1 - SGAHubTabs Patterns**:
- ✅ **Tab Type**: `export type SGAHubTab = 'weekly-goals' | 'closed-lost' | 'quarterly-progress'`
- ✅ **Tab Array Structure**: Array of objects with `{ id: SGAHubTab; label: string; icon: React.ReactNode }`
- ✅ **Icon Imports**: Uses `lucide-react` icons (Target, AlertCircle, TrendingUp)
- ✅ **Styling**: Uses Tailwind classes with dark mode support, border-bottom for active tab
- ✅ **Component Pattern**: Client component (`'use client'`), receives `activeTab` and `onTabChange` props

**Q3.1.2 - SGAHubContent Patterns**:
- ✅ **State Management**: Each tab has its own state variables (loading, error, data)
- ✅ **Tab Content Rendering**: Conditional rendering based on `activeTab` value
- ✅ **Drill-Down Modal State**: Shared modal state (`drillDownOpen`, `drillDownRecords`, etc.) reused across tabs
- ✅ **API Call Patterns**: Uses `dashboardApi` methods, handles errors with `handleApiError`
- ✅ **useEffect Pattern**: Fetches data when `activeTab` changes or when filter dependencies change

**Q3.1.3 - Filter Components**:
- ✅ **PipelineFilters.tsx**: Found existing filter component with collapsible design
  - Uses local state until "Apply Filters" is clicked
  - Has "Select All", "Deselect All", and "Active Only" buttons
  - Search functionality for SGM filter
  - Shows summary badges in collapsed header
  - Shows "Pending" and "Modified" indicators
- ✅ **AdvancedFilters.tsx**: Found multi-select filter control component
  - Uses `MultiSelectFilterControl` component for channels/sources
  - Searchable filters with search input
  - Checkbox-based selection UI
- ✅ **Pattern**: Filters use local state, only apply when "Apply Filters" button clicked (not auto-apply)

### Step 3.2: SGAHubTabs Updates

**Changes Made**:
1. ✅ Added `'leaderboard'` to `SGAHubTab` type as FIRST option
2. ✅ Added `Trophy` icon import from `lucide-react`
3. ✅ Added leaderboard tab as FIRST item in tabs array

**File Modified**: `src/components/sga-hub/SGAHubTabs.tsx`

### Step 3.2.5: LeaderboardFilters Component

**Created**:
1. ✅ New file: `src/components/sga-hub/LeaderboardFilters.tsx`
   - Follows `PipelineFilters.tsx` pattern exactly
   - Local state until "Apply Filters" is clicked
   - Quarter selector (last 8 quarters)
   - Channel multi-select with "Select All" / "Deselect All"
   - Source multi-select with search and "Select All" / "Deselect All"
   - SGA multi-select with "Active Only", "All SGAs", "Deselect All" and search
   - Summary badges in collapsed header
   - "Pending" and "Modified" indicators
   - Apply/Reset buttons in footer
   - Default values:
     - Quarter: Current quarter
     - Channels: "Outbound" and "Outbound + Marketing"
     - Sources: ALL sources (defaults to all if empty)
     - SGAs: ALL active SGAs (defaults to active if empty)

**File Created**: `src/components/sga-hub/LeaderboardFilters.tsx`

### Step 3.3: LeaderboardTable Component

**Created**:
1. ✅ New file: `src/components/sga-hub/LeaderboardTable.tsx`
   - Displays leaderboard entries in table format
   - Medal icons (🥇 🥈 🥉) for top 3 ranks
   - Rank numbers for 4th and below
   - Top 3 rows have colored backgrounds (yellow, gray, orange)
   - Current user highlighting with border and "You" badge
   - Clickable SQO counts (if `onSQOClick` provided)
   - Loading state with `LoadingSpinner`
   - Empty state with helpful message
   - Uses Tremor `Card`, `Table` components for consistency

**File Created**: `src/components/sga-hub/LeaderboardTable.tsx`

### Step 3.5: Terminal Validation

**TypeScript Check**:
- ✅ **PASSED**: `npx tsc --noEmit` - No errors

**Linting Check**:
- ✅ **PASSED**: `npm run lint` - No errors (only pre-existing warnings in other files)

### Decisions Made

1. **Filter Component Pattern**: Followed `PipelineFilters.tsx` pattern exactly - local state until Apply is clicked, not auto-apply. This matches the existing codebase pattern.

2. **Medal Icons**: Used emoji medals (🥇 🥈 🥉) as specified in the implementation plan, matching the game leaderboard pattern.

3. **Component Structure**: Created separate `LeaderboardFilters` and `LeaderboardTable` components (not integrated into single component) to match the pattern used by other tabs (filters separate from table).

4. **Default Filters**: 
   - Sources default to ALL (empty array = all sources)
   - SGAs default to ALL active (empty array = all active SGAs)
   - Channels default to ['Outbound', 'Outbound + Marketing']

5. **Color Coding**: Used different colors for each filter type in summary badges:
   - Quarter: Blue
   - Channels: Purple
   - Sources: Green
   - SGAs: Orange

### Issues Found

None - all components compile successfully and follow existing patterns.

## Phase 4 Results

**Status**: ✅ COMPLETE

### Step 4.1: SGAHubContent Integration

**Changes Made**:
1. ✅ Added imports:
   - `LeaderboardTable` component
   - `LeaderboardFilters` component
   - `LeaderboardEntry` type
   - `FilterOptions` type

2. ✅ Updated default `activeTab` from `'weekly-goals'` to `'leaderboard'`

3. ✅ Added leaderboard state variables:
   - `leaderboardEntries`, `leaderboardLoading`, `leaderboardError`
   - `leaderboardQuarter`, `leaderboardChannels`, `leaderboardSources`, `leaderboardSGAs`
   - `filterOptions`, `sgaOptions`, `sgaOptionsLoading`

4. ✅ Added `useEffect` hooks to fetch filter options:
   - Fetches channel/source options via `dashboardApi.getFilterOptions()`
   - Fetches SGA options via `dashboardApi.getLeaderboardSGAOptions()`
   - Sets default sources to all sources
   - Sets default SGAs to all active SGAs

5. ✅ Added `fetchLeaderboard` function:
   - Converts quarter to date range using `getQuarterInfo()`
   - Calls `dashboardApi.getSGALeaderboard()` with filters
   - Handles errors with `handleApiError()`

6. ✅ Updated main `useEffect` to include leaderboard:
   - Added `else if (activeTab === 'leaderboard')` condition
   - Added leaderboard filter dependencies to dependency array

7. ✅ Added `handleLeaderboardSQOClick` function:
   - Opens drill-down modal with SQO records
   - Passes channel/source filters to drill-down API
   - Uses existing drill-down modal state

8. ✅ Added leaderboard tab content:
   - Renders `LeaderboardFilters` component (when filterOptions loaded)
   - Renders error display card
   - Renders `LeaderboardTable` component
   - Positioned as FIRST tab content (before weekly-goals)

**File Modified**: `src/app/dashboard/sga-hub/SGAHubContent.tsx`

### Step 4.2: Drill-Down Query Updates

**Changes Made**:
1. ✅ Updated `_getSQODrillDown` function signature:
   - Added optional `options` parameter with `channels` and `sources`
   - Maintains backward compatibility (options parameter is optional)

2. ✅ Updated query logic:
   - Conditionally uses MAPPING_TABLE join (only when no channel filter)
   - For leaderboard drill-down: uses `Channel_Grouping_Name` directly (no mapping)
   - For other drill-downs: uses MAPPING_TABLE join (existing behavior)
   - Adds channel filter clause when channels provided
   - Adds source filter clause when sources provided

3. ✅ Updated parameters:
   - Conditionally adds `channels` and `sources` to params object

**File Modified**: `src/lib/queries/drill-down.ts`

### Step 4.3: Drill-Down API Route Updates

**Changes Made**:
1. ✅ Added query parameter parsing:
   - `channels = searchParams.getAll('channels')` (returns array)
   - `sources = searchParams.getAll('sources')` (returns array)

2. ✅ Updated `getSQODrillDown` call:
   - Passes channels/sources in options object
   - Maintains backward compatibility (undefined if not provided)

**File Modified**: `src/app/api/sga-hub/drill-down/sqos/route.ts`

### Step 4.4: API Client Updates

**Changes Made**:
1. ✅ Updated `getSQODrillDown` method signature:
   - Added optional `channels?: string[]` parameter
   - Added optional `sources?: string[]` parameter

2. ✅ Updated query parameter building:
   - Uses `URLSearchParams` with `append()` for array parameters
   - Maintains backward compatibility (only appends if arrays provided)

**File Modified**: `src/lib/api-client.ts`

### Step 4.5: Terminal Validation

**TypeScript Check**:
- ✅ **PASSED**: `npx tsc --noEmit` - No errors

**Linting Check**:
- ✅ **PASSED**: `npm run lint` - No errors (only pre-existing warnings in other files)

### Decisions Made

1. **Default Tab**: Changed default `activeTab` to `'leaderboard'` so leaderboard is the first tab users see.

2. **Filter Options Loading**: Added separate `useEffect` hooks for filter options to ensure they load on mount, independent of tab selection.

3. **Drill-Down Channel Handling**: Used conditional logic to determine whether to use MAPPING_TABLE join:
   - If channels filter provided → use `Channel_Grouping_Name` directly (matches leaderboard query)
   - If no channels filter → use MAPPING_TABLE join (maintains existing behavior for other drill-downs)

4. **Backward Compatibility**: All changes maintain backward compatibility:
   - Drill-down query `options` parameter is optional
   - API route channels/sources are optional
   - API client channels/sources are optional

5. **State Management**: Reused existing drill-down modal state (`drillDownOpen`, `drillDownRecords`, etc.) rather than creating separate state for leaderboard drill-down.

### Issues Found

None - all files compile successfully and maintain backward compatibility.

## Phase 5 Results
_To be filled after Phase 5 completion_

## Phase 6 Results
_To be filled after Phase 6 completion_
