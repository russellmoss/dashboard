# Admin SGA Hub Enhancements - Agentic Implementation Plan

**Updated 2026-01-27**: Added StatusSummaryStrip, fixed table columns/sorting, completed filters

## Overview
Enhance SGA Hub for admin/manager users with:
1. **Closed Lost & Re-Engagement Tab Filters** - Add SGA, Days Bucket, and Close Lost Reason filters. **Admins ALWAYS see "All Records" (no toggle)**. Regular SGA users see "My Records / All Records" toggle.
2. **Admin Quarterly Progress View** - Team-level goal setting with TWO metrics:
   - **SGA Individual Goals (Aggregate)** = Sum of all individual SGA quarterly goals
   - **SGA Manager Goal** = Manager's own quarterly target (set independently)
   - Individual SGA breakdown table with pacing status, sortable and filterable

**CRITICAL CONSTRAINT:** Regular SGA users must see NO changes - their experience remains identical.

---

# 🚀 PHASE 1: Closed Lost & Re-Engagement Tab Filters

## Objective
Add comprehensive filters to Closed Lost and Re-Engagement tabs for admin/manager users. **CRITICAL**: Admins should ALWAYS see "All Records" (no toggle). Regular SGA users see "My Records / All Records" toggle.

---

## Phase 1 Discovery Results

### Question 1.1: Current Toggle Implementation
**Findings**:
- Toggle visibility is controlled by `onToggleShowAll` prop in `ClosedLostTable.tsx`
- If `onToggleShowAll` is provided, toggle is shown (line 230: `{onToggleShowAll && ...}`)
- State flows: `SGAHubContent.tsx` → `showAllClosedLost` state → `handleToggleShowAllClosedLost` → passed as `onToggleShowAll` prop
- Admin check: `isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager'` (line 36 in SGAHubContent.tsx)
- **Change Required**: Only pass `onToggleShowAll` prop when user is NOT admin/manager

### Question 1.2: Closed Lost Data Structure
**Findings**:
- **Close Lost Reason Field**: `closed_lost_reason` (lowercase) in view `vw_sga_closed_lost_sql_followup`
- **SGA Name Field**: `sga_name` in view (already used for filtering)
- **Days Bucket**: Calculated in SQL (lines 128-138 in `closed-lost.ts`), NOT a BigQuery field
- **Days Bucket Values** (hardcoded list):
  - `< 1 month since closed lost` (0-29 days)
  - `1 month since closed lost` (30-59 days)
  - `2 months since closed lost` (60-89 days)
  - `3 months since closed lost` (90-119 days)
  - `4 months since closed lost` (120-149 days)
  - `5 months since closed lost` (150-179 days)
  - `6+ months since closed lost` (180+ days)
- **Close Lost Reason Values**: Query returned limited results. Will need to query for all distinct values or use dynamic extraction from records.

### Question 1.3: Re-Engagement Data Structure
**Findings**:
- **Source Table**: `savvy-gtm-analytics.SavvyGTMData.Opportunity` with `recordtypeid = RE_ENGAGEMENT_RECORD_TYPE`
- **No "Days Since Closed Lost" concept**: Re-Engagement opportunities are based on opportunity creation/activity dates, not closed lost dates
- **No Close Lost Reason field**: Re-Engagement opportunities don't have a Close Lost Reason (they're new opportunities, not the original closed lost ones)
- **Available Fields**: `StageName`, `CreatedDate`, `LastActivityDate`, `CloseDate`, `Amount`, `Underwritten_AUM__c`, SGA name
- **Filter Options for Re-Engagement**: SGA picklist, Stage picklist (maybe), Date ranges (created/activity)

### Question 1.4: Filter Component Pattern
**Findings**:
- **Component**: `LeaderboardFilters.tsx` is a reusable component with expandable UI
- **Pattern**: 
  - Local state for filter selections (not applied until "Apply" clicked)
  - Collapsible header with filter summaries
  - Multi-select picklists with search functionality
  - "Apply Filters" button triggers parent callback
- **State Management**: Parent component manages applied filters, child manages local/pending filters
- **Approach**: Create similar filter component for Closed Lost/Re-Engagement tabs

---

## Step 1.1: Update ReEngagementRecord Type

**File**: `src/types/sga-hub.ts`

**Action**: Add `sgaName` field to `ReEngagementOpportunity` interface.

```typescript
export interface ReEngagementOpportunity {
  id: string;
  advisorName: string;
  opportunityName: string;
  stageName: string;
  closeDate: string | null;
  aum: number | null;
  aumFormatted: string;
  daysSinceClose: number;
  sgaName?: string; // Add this field for admin "show all" view
  primaryKey?: string;
  opportunityUrl?: string | null;
}
```

**Validation**: Run `npx tsc --noEmit` to verify no type errors.

---

## Step 1.2: Update Re-Engagement Query

**File**: `src/lib/queries/re-engagement.ts`

**Action**: Modify query to accept optional `sgaName` parameter and include SGA name in results.

**Current Query Pattern** (review first):
```typescript
// Review existing _getReEngagementOpportunities function
```

**Changes Required**:
1. Update function signature to accept `sgaName: string | null`
2. Add `sga_name` to SELECT clause (use SGA attribution logic)
3. Conditionally filter by SGA when `sgaName` is not null

**Implementation**:
```typescript
const _getReEngagementOpportunities = async (
  sgaName: string | null
): Promise<ReEngagementOpportunity[]> => {
  // Build SGA filter condition
  const sgaFilter = sgaName 
    ? `AND v.SGA_Owner_Name__c = @sgaName`
    : ''; // No filter = show all

  const query = `
    SELECT 
      v.Id as id,
      v.advisor_name,
      v.Opportunity_Name__c as opportunity_name,
      v.StageName,
      v.CloseDate,
      v.Opportunity_AUM,
      v.primary_key,
      v.opportunity_url,
      -- Add SGA name for admin "show all" view
      COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) as sga_name
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
      ON v.Opp_SGA_Name__c = sga_user.Id
    WHERE v.is_reengagement = 1
      AND v.recordtypeid = @recruitingRecordType
      ${sgaFilter}
    ORDER BY v.CloseDate DESC NULLS LAST, v.advisor_name ASC
  `;

  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  if (sgaName) {
    params.sgaName = sgaName;
  }

  const results = await runQuery<RawReEngagementOpportunity>(query, params);
  return results.map(transformReEngagementOpportunity);
};
```

**Update Transform Function**:
```typescript
function transformReEngagementOpportunity(raw: RawReEngagementOpportunity): ReEngagementOpportunity {
  // ... existing transformation ...
  return {
    // ... existing fields ...
    sgaName: raw.sga_name ? toString(raw.sga_name) : undefined,
  };
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 1.3: Update Re-Engagement API Route

**File**: `src/app/api/sga-hub/re-engagement/route.ts`

**Action**: Add `showAll` query parameter handling.

**Changes Required**:
1. Parse `showAll` query parameter
2. Pass `null` as `sgaName` to query when `showAll=true` (admin/manager only)
3. Otherwise, use logged-in user's name

**Implementation**:
```typescript
export async function GET(request: NextRequest) {
  try {
    // ... existing auth checks ...

    const { searchParams } = new URL(request.url);
    const showAll = searchParams.get('showAll') === 'true';

    // Only admins/managers can use showAll
    if (showAll && !['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Determine SGA name to filter by
    const sgaName = showAll ? null : session.user.name;

    const opportunities = await getReEngagementOpportunities(sgaName);

    return NextResponse.json({ opportunities });
  } catch (error) {
    // ... error handling ...
  }
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 1.4: Modify Closed Lost Toggle Logic

**File**: `src/app/dashboard/sga-hub/SGAHubContent.tsx`

**Action**: Change toggle behavior so admins ALWAYS see all records (no toggle), SGAs see toggle.

**Changes Required**:
1. For admins: Always set `showAllClosedLost = true` (no toggle option)
2. For SGAs: Keep existing toggle behavior
3. Only pass `onToggleShowAll` prop when user is NOT admin/manager

**Implementation**:
```typescript
// In SGAHubContent.tsx, modify ClosedLostFollowUpTabs usage:
<ClosedLostFollowUpTabs
  closedLostRecords={closedLostRecords}
  reEngagementOpportunities={reEngagementOpportunities}
  closedLostLoading={closedLostLoading}
  reEngagementLoading={reEngagementLoading}
  onClosedLostRecordClick={handleClosedLostRecordClick}
  onReEngagementClick={handleReEngagementClick}
  showAllRecords={isAdmin ? true : showAllClosedLost} // Admins always see all
  onToggleShowAll={isAdmin ? undefined : handleToggleShowAllClosedLost} // No toggle for admins
/>
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 1.5: Create Closed Lost Filter Component

**File**: `src/components/sga-hub/ClosedLostFilters.tsx` (NEW)

**Action**: Create filter component for Closed Lost tab with SGA, Days Bucket, and Close Lost Reason picklists.

**Requirements**:
- Reuse `LeaderboardFilters.tsx` pattern (expandable, local state, Apply button)
- Filters: SGA (multi-select), Days Bucket (multi-select), Close Lost Reason (multi-select)
- Days Bucket values: Use hardcoded list from discovery
- Close Lost Reason: Extract distinct values from records or query API endpoint
- SGA options: Query from Prisma User table (active SGAs)

**Implementation Pattern** (similar to LeaderboardFilters):
```typescript
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Check, Filter } from 'lucide-react';

interface ClosedLostFiltersProps {
  selectedSGAs: string[];
  selectedDaysBuckets: string[];
  selectedCloseLostReasons: string[];
  sgaOptions: Array<{ value: string; label: string; isActive: boolean }>;
  daysBucketOptions: string[]; // Hardcoded list
  closeLostReasonOptions: string[]; // From records or API
  onApply: (filters: {
    sgas: string[];
    daysBuckets: string[];
    closeLostReasons: string[];
  }) => void;
  disabled?: boolean;
}

export function ClosedLostFilters({ ... }: ClosedLostFiltersProps) {
  // Similar pattern to LeaderboardFilters
  // Local state, expandable UI, Apply/Reset buttons
}
```

**Days Bucket Options** (hardcoded):
```typescript
const DAYS_BUCKET_OPTIONS = [
  '< 1 month since closed lost',
  '1 month since closed lost',
  '2 months since closed lost',
  '3 months since closed lost',
  '4 months since closed lost',
  '5 months since closed lost',
  '6+ months since closed lost',
];
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 1.6: Update Closed Lost Query to Support Filters

**File**: `src/lib/queries/closed-lost.ts`

**Action**: Add filter parameters for SGA names, days buckets, and close lost reasons.

**Changes Required**:
1. Update function signature to accept filter options
2. Add WHERE conditions for SGA names (if provided)
3. Add WHERE conditions for days buckets (filter on calculated `time_since_closed_lost_bucket`)
4. Add WHERE conditions for close lost reasons

**Implementation**:
```typescript
const _getClosedLostRecords = async (
  sgaName: string | null,
  filters?: {
    sgaNames?: string[];
    daysBuckets?: string[];
    closeLostReasons?: string[];
  }
): Promise<ClosedLostRecord[]> => {
  const { sgaNames, daysBuckets, closeLostReasons } = filters || {};
  
  const conditions: string[] = [];
  const params: Record<string, any> = {
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  // SGA filter (if specific SGAs selected)
  if (sgaNames && sgaNames.length > 0) {
    conditions.push('cl.sga_name IN UNNEST(@sgaNames)');
    params.sgaNames = sgaNames;
  } else if (sgaName) {
    // Single SGA filter (legacy behavior)
    conditions.push('cl.sga_name = @sgaName');
    params.sgaName = sgaName;
  }
  // If sgaName is null and no sgaNames, show all (no filter)

  // Days Bucket filter (on calculated field)
  if (daysBuckets && daysBuckets.length > 0) {
    conditions.push(`(
      CASE
        WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 180 THEN '6+ months since closed lost'
        WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 150 THEN '5 months since closed lost'
        WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 120 THEN '4 months since closed lost'
        WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 90 THEN '3 months since closed lost'
        WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 60 THEN '2 months since closed lost'
        WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 30 THEN '1 month since closed lost'
        WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 0 THEN '< 1 month since closed lost'
        ELSE NULL
      END
    ) IN UNNEST(@daysBuckets)`);
    params.daysBuckets = daysBuckets;
  }

  // Close Lost Reason filter
  if (closeLostReasons && closeLostReasons.length > 0) {
    conditions.push('cl.closed_lost_reason IN UNNEST(@closeLostReasons)');
    params.closeLostReasons = closeLostReasons;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // ... rest of query ...
};
```

**Note**: Days Bucket filtering happens at SQL level (more efficient than client-side).

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 1.7: Update Closed Lost API Route for Filters

**File**: `src/app/api/sga-hub/closed-lost/route.ts`

**Action**: Add query parameters for new filters.

**Implementation**:
```typescript
// Parse query parameters
const sgaNames = searchParams.getAll('sgaNames');
const daysBuckets = searchParams.getAll('daysBuckets');
const closeLostReasons = searchParams.getAll('closeLostReasons');

// Build filters object
const filters: {
  sgaNames?: string[];
  daysBuckets?: string[];
  closeLostReasons?: string[];
} = {};

if (sgaNames.length > 0) {
  filters.sgaNames = sgaNames;
}
if (daysBuckets.length > 0) {
  filters.daysBuckets = daysBuckets;
}
if (closeLostReasons.length > 0) {
  filters.closeLostReasons = closeLostReasons;
}

// For admins: always pass null as sgaName (show all), with optional sgaNames filter
// For SGAs: pass their name as sgaName
const finalSgaName = showAll ? null : (targetUser?.name || user.name);

const records = await getClosedLostRecords(finalSgaName, Object.keys(filters).length > 0 ? filters : undefined);
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 1.8: Update ReEngagementTable Component

**File**: `src/components/sga-hub/ReEngagementOpportunitiesTable.tsx`

**Action**: Add SGA column for admin view (when showing all records).

**Changes Required**:
1. Add `showAllRecords` prop (no toggle - admins always true, SGAs always false)
2. Conditionally show SGA column when `showAllRecords=true`
3. Update table header and rows

**Implementation**:
```typescript
interface ReEngagementTableProps {
  opportunities: ReEngagementOpportunity[];
  isLoading?: boolean;
  onOpportunityClick?: (opportunity: ReEngagementOpportunity) => void;
  showAllRecords?: boolean; // Add this
  onShowAllChange?: (showAll: boolean) => void; // Add this
  isAdmin?: boolean; // Add this
}

export function ReEngagementTable({
  opportunities,
  isLoading = false,
  onOpportunityClick,
  showAllRecords = false,
  onShowAllChange,
  isAdmin = false,
}: ReEngagementTableProps) {
  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      {/* Toggle Header (only show if admin) */}
      {isAdmin && onShowAllChange && (
        <div className="mb-4 flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Show:
            </label>
            <button
              onClick={() => onShowAllChange(false)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                !showAllRecords
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              My Records
            </button>
            <button
              onClick={() => onShowAllChange(true)}
              className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                showAllRecords
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              All Records
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              {showAllRecords && (
                <TableHeaderCell className="text-gray-600 dark:text-gray-400">
                  SGA
                </TableHeaderCell>
              )}
              <TableHeaderCell className="text-gray-600 dark:text-gray-400">
                Advisor Name
              </TableHeaderCell>
              {/* ... rest of headers ... */}
            </TableRow>
          </TableHead>
          <TableBody>
            {opportunities.map((opp) => (
              <TableRow key={opp.id}>
                {showAllRecords && (
                  <TableCell className="font-medium text-gray-900 dark:text-white">
                    {opp.sgaName || 'Unknown'}
                  </TableCell>
                )}
                <TableCell>{opp.advisorName}</TableCell>
                {/* ... rest of cells ... */}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 1.9: Create API Endpoint for Close Lost Reason Options

**File**: `src/app/api/sga-hub/closed-lost-reasons/route.ts` (NEW)

**Action**: Create endpoint to fetch distinct Close Lost Reason values.

**Implementation**:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { runQuery } from '@/lib/bigquery';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const query = `
      SELECT DISTINCT closed_lost_reason
      FROM \`savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup\`
      WHERE closed_lost_reason IS NOT NULL
      ORDER BY closed_lost_reason
    `;

    const results = await runQuery<{ closed_lost_reason: string }>(query, {});
    const reasons = results.map(r => r.closed_lost_reason).filter(Boolean);

    return NextResponse.json({ reasons });
  } catch (error) {
    console.error('Error fetching close lost reasons:', error);
    return NextResponse.json(
      { error: 'Failed to fetch close lost reasons' },
      { status: 500 }
    );
  }
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 1.10: Integrate Filters into Closed Lost Tab

**File**: `src/app/dashboard/sga-hub/SGAHubContent.tsx`

**Action**: Add filter state and integrate ClosedLostFilters component.

**Changes Required**:
1. Add filter state: `selectedSGAs`, `selectedDaysBuckets`, `selectedCloseLostReasons`
2. Fetch SGA options and Close Lost Reason options on mount
3. Pass filters to `fetchClosedLostRecords`
4. Render `ClosedLostFilters` component above table

**Implementation**:
```typescript
// Add filter state
const [selectedClosedLostSGAs, setSelectedClosedLostSGAs] = useState<string[]>([]);
const [selectedDaysBuckets, setSelectedDaysBuckets] = useState<string[]>([]);
const [selectedCloseLostReasons, setSelectedCloseLostReasons] = useState<string[]>([]);
const [closeLostReasonOptions, setCloseLostReasonOptions] = useState<string[]>([]);

// Fetch Close Lost Reason options
useEffect(() => {
  const fetchCloseLostReasons = async () => {
    try {
      const response = await dashboardApi.getCloseLostReasons();
      setCloseLostReasonOptions(response.reasons);
    } catch (err) {
      console.error('Error fetching close lost reasons:', err);
    }
  };
  fetchCloseLostReasons();
}, []);

// Update fetchClosedLostRecords to accept filters
const fetchClosedLostRecords = async (showAll: boolean = showAllClosedLost) => {
  try {
    setClosedLostLoading(true);
    setClosedLostError(null);
    
    const filters: {
      sgaNames?: string[];
      daysBuckets?: string[];
      closeLostReasons?: string[];
    } = {};
    
    if (selectedClosedLostSGAs.length > 0) {
      filters.sgaNames = selectedClosedLostSGAs;
    }
    if (selectedDaysBuckets.length > 0) {
      filters.daysBuckets = selectedDaysBuckets;
    }
    if (selectedCloseLostReasons.length > 0) {
      filters.closeLostReasons = selectedCloseLostReasons;
    }
    
    const response = await dashboardApi.getClosedLostRecords(
      undefined, // timeBuckets (legacy)
      undefined, // userEmail
      showAll,
      Object.keys(filters).length > 0 ? filters : undefined
    );
    setClosedLostRecords(response.records);
  } catch (err) {
    setClosedLostError(handleApiError(err));
  } finally {
    setClosedLostLoading(false);
  }
};

// Render filters (only for admins)
{activeTab === 'closed-lost' && isAdmin && filterOptions && (
  <ClosedLostFilters
    selectedSGAs={selectedClosedLostSGAs}
    selectedDaysBuckets={selectedDaysBuckets}
    selectedCloseLostReasons={selectedCloseLostReasons}
    sgaOptions={sgaOptions}
    daysBucketOptions={DAYS_BUCKET_OPTIONS}
    closeLostReasonOptions={closeLostReasonOptions}
    onApply={(filters) => {
      setSelectedClosedLostSGAs(filters.sgas);
      setSelectedDaysBuckets(filters.daysBuckets);
      setSelectedCloseLostReasons(filters.closeLostReasons);
      // fetchClosedLostRecords will be called via useEffect dependency
    }}
    disabled={closedLostLoading}
  />
)}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 1.11: Update API Client for Filters

**File**: `src/lib/api-client.ts`

**Action**: Update `getClosedLostRecords` and add `getCloseLostReasons`.

**Implementation**:
```typescript
getClosedLostRecords: (
  timeBuckets?: ClosedLostTimeBucket[],
  userEmail?: string,
  showAll?: boolean,
  filters?: {
    sgaNames?: string[];
    daysBuckets?: string[];
    closeLostReasons?: string[];
  }
) => {
  const params = new URLSearchParams();
  if (timeBuckets && timeBuckets.length > 0) {
    params.set('timeBuckets', timeBuckets.join(','));
  }
  if (userEmail) {
    params.set('userEmail', userEmail);
  }
  if (showAll) {
    params.set('showAll', 'true');
  }
  if (filters) {
    if (filters.sgaNames && filters.sgaNames.length > 0) {
      filters.sgaNames.forEach(sga => params.append('sgaNames', sga));
    }
    if (filters.daysBuckets && filters.daysBuckets.length > 0) {
      filters.daysBuckets.forEach(bucket => params.append('daysBuckets', bucket));
    }
    if (filters.closeLostReasons && filters.closeLostReasons.length > 0) {
      filters.closeLostReasons.forEach(reason => params.append('closeLostReasons', reason));
    }
  }
  
  return apiFetch<{ records: ClosedLostRecord[] }>(
    `/api/sga-hub/closed-lost?${params.toString()}`
  );
},

getCloseLostReasons: () =>
  apiFetch<{ reasons: string[] }>('/api/sga-hub/closed-lost-reasons'),
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Phase 1 Completion Checklist

- [ ] Step 1.1: Updated ReEngagementOpportunity type
- [ ] Step 1.2: Updated re-engagement query to support showAll
- [ ] Step 1.3: Updated re-engagement API route
- [ ] Step 1.4: Updated ReEngagementTable component
- [ ] Step 1.5: Updated SGAHubContent integration
- [ ] Step 1.6: Updated API client
- [ ] No TypeScript errors
- [ ] No linting errors

---

## 🛑 STOP - PHASE 1 COMPLETE

**CURSOR.AI**: Report your findings for Phase 1:
1. What changes were made to the re-engagement query?
2. Were there any issues with the API route modifications?
3. Any TypeScript or linting errors fixed?
4. Any additional modifications needed?

**Update this document** with your findings in a new section called "Phase 1 Results" below.

**ASK**: "Phase 1 complete. Ready to proceed to Phase 2 (Database Schema)?"

---

# 🚀 PHASE 2: Database Schema - Manager Quarterly Goal

## Objective
Add Prisma model for SGA Manager's quarterly goal (separate from individual SGA goals).

## Phase 2 Discovery Results

### Question 2.1: Current Quarterly Goal Schema
**Findings**:
- **Current Schema**: `QuarterlyGoal` model in `prisma/schema.prisma`
  - Fields: `id`, `userEmail` (links to User.email), `quarter` (string, e.g., "2026-Q1"), `sqoGoal`, `createdBy`, `updatedBy`
  - Unique constraint: `@@unique([userEmail, quarter])`
  - **No distinction** between "SGA goal" and "Manager goal" currently
  - `userEmail` stores the SGA's email (the goal is FOR that SGA)

### Question 2.2: Goal Setting Flow
**Findings**:
- **Current API**: `/api/sga-hub/quarterly-goals` (GET/POST)
- **Who can set**: Only admin/manager can set goals (POST endpoint checks role)
- **Bulk editor**: No bulk goal editor currently - goals set one at a time
- **Distinction needed**: 
  - Individual SGA goals: Stored in `QuarterlyGoal` with `userEmail` = SGA's email
  - Manager goal: Need new table `ManagerQuarterlyGoal` (one per quarter, set by manager)

### Question 2.3: Aggregating Individual Goals
**Decision**: Calculate on-the-fly (sum of all SGA goals for the quarter)
- More flexible (updates automatically when individual goals change)
- No caching needed (fast query)
- If SGA doesn't have goal set → contributes 0 to aggregate

### Question 2.4: Manager Goal Storage
**Decision**: New table `ManagerQuarterlyGoal`
- One record per quarter
- Set by manager/admin
- Separate from individual SGA goals
- Fields: `quarter`, `sqoGoal`, `createdBy`, `updatedBy`

---

---

## Step 2.1: Review Existing QuarterlyGoal Model

**File**: `prisma/schema.prisma`

**Action**: Review existing `QuarterlyGoal` model to understand structure.

**Expected Pattern**:
```prisma
model QuarterlyGoal {
  id          String   @id @default(uuid())
  sgaName     String
  year        Int
  quarter     Int
  sqoGoal     Int
  // ... other fields
  @@unique([sgaName, year, quarter])
}
```

**Note**: Document the existing structure before adding new model.

---

## Step 2.2: Add ManagerQuarterlyGoal Model

**File**: `prisma/schema.prisma`

**Action**: Add new model for manager's quarterly goal (separate from individual SGA goals).

**Implementation**:
```prisma
model ManagerQuarterlyGoal {
  id          String   @id @default(cuid())
  quarter     String   // Format: "2026-Q1", "2026-Q2", etc. (matches QuarterlyGoal format)
  sqoGoal     Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String?  // Email of admin/manager who created
  updatedBy   String?  // Email of admin/manager who last updated

  @@unique([quarter])
  @@index([quarter])
  @@map("manager_quarterly_goals")
}
```

**Note**: Uses same quarter format as `QuarterlyGoal` for consistency.

**Validation**: 
- Run `npx prisma format` to verify schema syntax
- Run `npx prisma validate` to verify schema

---

## Step 2.3: Create Migration

**Action**: Generate and apply Prisma migration.

**Commands**:
```bash
npx prisma migrate dev --name add_manager_quarterly_goals
```

**Validation**: 
- Verify migration file created in `prisma/migrations/`
- Verify migration applied successfully
- Check database to confirm table exists

---

## Phase 2 Completion Checklist

- [ ] Step 2.1: Reviewed existing QuarterlyGoal model
- [ ] Step 2.2: Added ManagerQuarterlyGoal model to schema
- [ ] Step 2.3: Created and applied migration
- [ ] Database table exists and is accessible

---

## 🛑 STOP - PHASE 2 COMPLETE

**CURSOR.AI**: Report your findings for Phase 2:
1. What is the structure of the existing QuarterlyGoal model?
2. Were there any migration issues?
3. Is the database table created successfully?

**Update this document** with your findings in a new section called "Phase 2 Results" below.

**ASK**: "Phase 2 complete. Ready to proceed to Phase 3 (Team Goals API)?"

---

# 🚀 PHASE 3: Manager Quarterly Goal API

## Objective
Create API endpoint for setting and retrieving manager's quarterly goal (separate from individual SGA goals).

---

## Step 3.1: Create Manager Goal API Route

**File**: `src/app/api/sga-hub/manager-quarterly-goal/route.ts` (NEW)

**Action**: Create API route for GET and POST operations.

**Implementation**:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const quarter = searchParams.get('quarter');

    if (!year || !quarter) {
      return NextResponse.json(
        { error: 'Missing required parameters: year and quarter' },
        { status: 400 }
      );
    }

    const yearNum = parseInt(year, 10);
    const quarterNum = parseInt(quarter, 10);

    if (isNaN(yearNum) || isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
      return NextResponse.json(
        { error: 'Invalid year or quarter' },
        { status: 400 }
      );
    }

    // Fetch manager goal
    const managerGoal = await prisma.managerQuarterlyGoal.findUnique({
      where: {
        quarter: `${yearNum}-Q${quarterNum}`,
      },
    });

    return NextResponse.json({
      goal: managerGoal ? managerGoal.sqoGoal : null,
    });
  } catch (error) {
    console.error('Error fetching team quarterly goal:', error);
    return NextResponse.json(
      { error: 'Failed to fetch team goal' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    // Only admins/managers can set team goals
    if (!['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { year, quarter, sqoGoal } = body;

    if (!year || !quarter || sqoGoal === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: year, quarter, sqoGoal' },
        { status: 400 }
      );
    }

    const yearNum = parseInt(year, 10);
    const quarterNum = parseInt(quarter, 10);
    const sqoGoalNum = parseInt(sqoGoal, 10);

    if (isNaN(yearNum) || isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4 || isNaN(sqoGoalNum) || sqoGoalNum < 0) {
      return NextResponse.json(
        { error: 'Invalid year, quarter, or sqoGoal' },
        { status: 400 }
      );
    }

    // Get user ID for createdBy
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const quarterStr = `${yearNum}-Q${quarterNum}`;

    // Upsert manager goal
    const managerGoal = await prisma.managerQuarterlyGoal.upsert({
      where: {
        quarter: quarterStr,
      },
      update: {
        sqoGoal: sqoGoalNum,
        updatedBy: session.user.email,
      },
      create: {
        quarter: quarterStr,
        sqoGoal: sqoGoalNum,
        createdBy: session.user.email,
        updatedBy: session.user.email,
      },
    });

    return NextResponse.json({
      goal: managerGoal.sqoGoal,
      message: 'Manager goal saved successfully',
    });
  } catch (error) {
    console.error('Error saving team quarterly goal:', error);
    return NextResponse.json(
      { error: 'Failed to save team goal' },
      { status: 500 }
    );
  }
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 3.2: Update API Client

**File**: `src/lib/api-client.ts`

**Action**: Add methods for manager quarterly goal.

**Implementation**:
```typescript
getManagerQuarterlyGoal: (quarter: string) =>
  apiFetch<{ goal: number | null }>(
    `/api/sga-hub/manager-quarterly-goal?quarter=${quarter}`
  ),

setManagerQuarterlyGoal: (quarter: string, sqoGoal: number) =>
  apiFetch<{ goal: number; message: string }>(
    '/api/sga-hub/manager-quarterly-goal',
    {
      method: 'POST',
      body: JSON.stringify({ quarter, sqoGoal }),
    }
  ),
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Phase 3 Completion Checklist

- [ ] Step 3.1: Created manager quarterly goal API route
- [ ] Step 3.2: Updated API client
- [ ] No TypeScript errors
- [ ] No linting errors

---

## 🛑 STOP - PHASE 3 COMPLETE

**CURSOR.AI**: Report your findings for Phase 3:
1. Were there any issues with the Prisma queries?
2. Any TypeScript or linting errors fixed?
3. Any additional modifications needed?

**Update this document** with your findings in a new section called "Phase 3 Results" below.

**ASK**: "Phase 3 complete. Ready to proceed to Phase 4 (Admin Progress API)?"

---

# 🚀 PHASE 4: Admin Quarterly Progress API

## Objective
Create API endpoint that returns team progress summary and individual SGA breakdown.

---

## Step 4.1: Review Existing Quarterly Progress Query

**File**: `src/lib/queries/quarterly-progress.ts`

**Action**: Review existing `getQuarterlyProgress` function to understand structure.

**Note**: Document the existing query pattern and data structure.

---

## Step 4.2: Create Admin Progress Query Function

**File**: `src/lib/queries/admin-quarterly-progress.ts` (NEW)

**Action**: Create query function for admin quarterly progress.

**Requirements**:
1. Accept filters: year, quarter, sgaNames[], channels[], sources[]
2. Return team-level aggregation (total SQOs across all SGAs)
3. Return individual SGA breakdown (SQOs per SGA)
4. Use existing SGA attribution logic (reuse from leaderboard query)

**Implementation Pattern**:
```typescript
interface AdminQuarterlyProgress {
  year: number;
  quarter: number;
  teamTotalSQOs: number;
  sgaIndividualGoalsAggregate: number; // Sum of all individual SGA goals
  sgaManagerGoal: number | null;       // Manager's goal
  sgaBreakdown: Array<{
    sgaName: string;
    sqoCount: number;
  }>;
}

const _getAdminQuarterlyProgress = async (
  year: number,
  quarter: number,
  filters?: {
    sgaNames?: string[];
    channels?: string[];
    sources?: string[];
  }
): Promise<AdminQuarterlyProgress> => {
  // Build date range from year/quarter
  const quarterInfo = getQuarterInfo(`${year}-Q${quarter}`);
  
  // Build filter conditions
  const sgaFilter = filters?.sgaNames && filters.sgaNames.length > 0
    ? `AND COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) IN UNNEST(@sgaNames)`
    : '';
  
  const channelFilter = filters?.channels && filters.channels.length > 0
    ? `AND v.Channel_Grouping_Name IN UNNEST(@channels)`
    : '';
  
  const sourceFilter = filters?.sources && filters.sources.length > 0
    ? `AND v.Original_source IN UNNEST(@sources)`
    : '';

  const query = `
    WITH SQOData AS (
      SELECT 
        COALESCE(COALESCE(sga_user.Name, v.Opp_SGA_Name__c), v.SGA_Owner_Name__c) as sga_name,
        v.primary_key
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` sga_user
        ON v.Opp_SGA_Name__c = sga_user.Id
      WHERE v.is_sqo_unique = 1
        AND v.recordtypeid = @recruitingRecordType
        AND v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
        ${sgaFilter}
        ${channelFilter}
        ${sourceFilter}
    )
    SELECT 
      sga_name,
      COUNT(DISTINCT primary_key) as sqo_count
    FROM SQOData
    GROUP BY sga_name
    ORDER BY sqo_count DESC, sga_name ASC
  `;

  const params: Record<string, any> = {
    startDate: quarterInfo.startDate,
    endDate: quarterInfo.endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };

  if (filters?.sgaNames && filters.sgaNames.length > 0) {
    params.sgaNames = filters.sgaNames;
  }
  if (filters?.channels && filters.channels.length > 0) {
    params.channels = filters.channels;
  }
  if (filters?.sources && filters.sources.length > 0) {
    params.sources = filters.sources;
  }

  const results = await runQuery<{ sga_name: string; sqo_count: number | null }>(query, params);

  // Calculate team total
  const teamTotalSQOs = results.reduce((sum, row) => sum + (toNumber(row.sqo_count) || 0), 0);

  // Build breakdown
  const sgaBreakdown = results.map(row => ({
    sgaName: toString(row.sga_name),
    sqoCount: toNumber(row.sqo_count) || 0,
  }));

  // Fetch individual SGA goals and calculate aggregate
  const sgaGoals = await getAllSGAQuarterlyGoals(`${year}-Q${quarter}`);
  const sgaIndividualGoalsAggregate = sgaGoals.reduce((sum, goal) => sum + goal.sqoGoal, 0);

  // Fetch manager goal
  const managerGoal = await prisma.managerQuarterlyGoal.findUnique({
    where: { quarter: `${year}-Q${quarter}` },
  });

  return {
    year,
    quarter,
    teamTotalSQOs,
    sgaIndividualGoalsAggregate,
    sgaManagerGoal: managerGoal ? managerGoal.sqoGoal : null,
    sgaBreakdown,
  };
};

export const getAdminQuarterlyProgress = cachedQuery(
  _getAdminQuarterlyProgress,
  'getAdminQuarterlyProgress',
  CACHE_TAGS.SGA_HUB
);
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 4.3: Create Admin Progress API Route

**File**: `src/app/api/sga-hub/admin-quarterly-progress/route.ts` (NEW)

**Action**: Create API route for admin quarterly progress.

**Implementation**:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getAdminQuarterlyProgress } from '@/lib/queries/quarterly-progress';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    // Only admins/managers can access
    if (!['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const quarter = searchParams.get('quarter');
    const sgaNames = searchParams.getAll('sgaNames');
    const channels = searchParams.getAll('channels');
    const sources = searchParams.getAll('sources');

    if (!year || !quarter) {
      return NextResponse.json(
        { error: 'Missing required parameters: year and quarter' },
        { status: 400 }
      );
    }

    const yearNum = parseInt(year, 10);
    const quarterNum = parseInt(quarter, 10);

    if (isNaN(yearNum) || isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
      return NextResponse.json(
        { error: 'Invalid year or quarter' },
        { status: 400 }
      );
    }

    // Build filters
    const filters: {
      sgaNames?: string[];
      channels?: string[];
      sources?: string[];
    } = {};

    if (sgaNames.length > 0) {
      filters.sgaNames = sgaNames;
    }
    if (channels.length > 0) {
      filters.channels = channels;
    }
    if (sources.length > 0) {
      filters.sources = sources;
    }

    const progress = await getAdminQuarterlyProgress(yearNum, quarterNum, filters);

    return NextResponse.json(progress);
  } catch (error) {
    console.error('Error fetching admin quarterly progress:', error);
    return NextResponse.json(
      { error: 'Failed to fetch admin progress' },
      { status: 500 }
    );
  }
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 4.4: Update API Client

**File**: `src/lib/api-client.ts`

**Action**: Add method for admin quarterly progress.

**Implementation**:
```typescript
getAdminQuarterlyProgress: (params: {
  year: number;
  quarter: number;
  sgaNames?: string[];
  channels?: string[];
  sources?: string[];
}) => {
  const searchParams = new URLSearchParams({
    year: params.year.toString(),
    quarter: params.quarter.toString(),
  });
  
  if (params.sgaNames && params.sgaNames.length > 0) {
    params.sgaNames.forEach(sga => searchParams.append('sgaNames', sga));
  }
  if (params.channels && params.channels.length > 0) {
    params.channels.forEach(ch => searchParams.append('channels', ch));
  }
  if (params.sources && params.sources.length > 0) {
    params.sources.forEach(src => searchParams.append('sources', src));
  }
  
  return apiFetch<AdminQuarterlyProgress>(
    `/api/sga-hub/admin-quarterly-progress?${searchParams.toString()}`
  );
},
```

**Add Type Import**:
```typescript
import { AdminQuarterlyProgress } from '@/types/sga-hub';
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 4.5: Add Type Definitions

**File**: `src/types/sga-hub.ts`

**Action**: Add type definitions for admin quarterly progress.

**Implementation**:
```typescript
export interface AdminQuarterlyProgress {
  year: number;
  quarter: number;
  teamTotalSQOs: number;
  sgaIndividualGoalsAggregate: number; // Sum of all SGA goals
  sgaManagerGoal: number | null;       // Manager's goal
  sgaBreakdown: Array<{
    sgaName: string;
    sqoCount: number;
    // Note: individual goal, progress%, pacing are calculated client-side
  }>;
}
```

**Validation**: 
- Run `npx tsc --noEmit`

---

## Phase 4 Completion Checklist

- [ ] Step 4.1: Reviewed existing quarterly progress query
- [ ] Step 4.2: Created admin progress query function
- [ ] Step 4.3: Created admin progress API route
- [ ] Step 4.4: Updated API client
- [ ] Step 4.5: Added type definitions
- [ ] No TypeScript errors
- [ ] No linting errors

---

## 🛑 STOP - PHASE 4 COMPLETE

**CURSOR.AI**: Report your findings for Phase 4:
1. What query structure was used for team aggregation?
2. Were there any issues with the filter logic?
3. Any TypeScript or linting errors fixed?

**Update this document** with your findings in a new section called "Phase 4 Results" below.

**ASK**: "Phase 4 complete. Ready to proceed to Phase 5 (Admin UI Components)?"

---

# 🚀 PHASE 5: Admin UI Components

## Objective
Create UI components for admin quarterly progress view.

---

## Step 5.1a: Create StatusSummaryStrip Component

**File**: `src/components/sga-hub/StatusSummaryStrip.tsx` (NEW)

**Action**: Create at-a-glance status summary showing team pacing distribution.

**Requirements**:
- Single horizontal card/strip
- Shows total SGAs count
- Shows count of SGAs by pacing status (Ahead, On-Track, Behind, No Goal)
- Color-coded badges (green, yellow, red, gray)
- Place ABOVE TeamProgressCard in layout

**Implementation**:
```typescript
'use client';

import { Card, Text } from '@tremor/react';
import { TrendingUp, TrendingDown, Minus, Circle } from 'lucide-react';

interface StatusSummaryStripProps {
  quarterLabel: string;
  totalSGAs: number;
  aheadCount: number;
  onTrackCount: number;
  behindCount: number;
  noGoalCount: number;
}

export function StatusSummaryStrip({
  quarterLabel,
  totalSGAs,
  aheadCount,
  onTrackCount,
  behindCount,
  noGoalCount,
}: StatusSummaryStripProps) {
  return (
    <Card className="mb-4 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Text className="text-lg font-semibold text-gray-900 dark:text-white">
            {quarterLabel} TEAM STATUS
          </Text>
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            {totalSGAs} Total SGAs
          </Text>
        </div>
        
        <div className="flex items-center gap-4 flex-wrap">
          {/* Ahead */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
            <Text className="text-sm font-medium text-gray-900 dark:text-white">
              {aheadCount} Ahead
            </Text>
          </div>
          
          {/* On-Track */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <Text className="text-sm font-medium text-gray-900 dark:text-white">
              {onTrackCount} On-Track
            </Text>
          </div>
          
          {/* Behind */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <Text className="text-sm font-medium text-gray-900 dark:text-white">
              {behindCount} Behind
            </Text>
          </div>
          
          {/* No Goal */}
          {noGoalCount > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-400"></div>
              <Text className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {noGoalCount} No Goal
              </Text>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 5.1: Create TeamGoalEditor Component

**File**: `src/components/sga-hub/TeamGoalEditor.tsx` (NEW)

**Action**: Create inline editable goal field for admins.

**Implementation**:
```typescript
'use client';

import { useState } from 'react';
import { Button } from '@tremor/react';
import { Save, Edit2 } from 'lucide-react';

interface TeamGoalEditorProps {
  year: number;
  quarter: number;
  currentGoal: number | null;
  onSave: (goal: number) => Promise<void>;
  isLoading?: boolean;
}

export function TeamGoalEditor({
  year,
  quarter,
  currentGoal,
  onSave,
  isLoading = false,
}: TeamGoalEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [goalValue, setGoalValue] = useState<string>(currentGoal?.toString() || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const goalNum = parseInt(goalValue, 10);
    if (isNaN(goalNum) || goalNum < 0) {
      alert('Please enter a valid goal (non-negative number)');
      return;
    }

    setSaving(true);
    try {
      await onSave(goalNum);
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving team goal:', error);
      alert('Failed to save team goal');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setGoalValue(currentGoal?.toString() || '');
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={goalValue}
          onChange={(e) => setGoalValue(e.target.value)}
          className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white w-24"
          min="0"
          autoFocus
        />
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || isLoading}
          icon={Save}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCancel}
          disabled={saving}
        >
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-lg font-semibold text-gray-900 dark:text-white">
        {currentGoal ?? 'Not set'}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setIsEditing(true)}
        disabled={isLoading}
        icon={Edit2}
      >
        Edit
      </Button>
    </div>
  );
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 5.2: Create TeamProgressCard Component

**File**: `src/components/sga-hub/TeamProgressCard.tsx` (NEW)

**Action**: Create card displaying BOTH goal metrics, current SQOs, and pacing status.

**Requirements**:
- Display TWO goal metrics:
  1. **SGA Individual Goals (Aggregate)**: Sum of all individual SGA goals
  2. **SGA Manager Goal**: Manager's own quarterly target
- Show progress against BOTH goals
- Pacing calculated against Manager Goal (primary target)
- Linear pacing: `expectedSQOs = (managerGoal / daysInQuarter) * daysElapsed`

**Pacing Calculation** (against Manager Goal):
- `daysInQuarter`: Total days in the quarter
- `daysElapsed`: Days from quarter start to today (or quarter end if past)
- `expectedSQOs = (managerGoal / daysInQuarter) * daysElapsed`
- Status:
  - "Ahead": currentSQOs > expectedSQOs * 1.1 (10% buffer)
  - "On-track": currentSQOs >= expectedSQOs * 0.9
  - "Behind": currentSQOs < expectedSQOs * 0.9
  - "No goal": managerGoal is null

**Implementation**:
```typescript
'use client';

import { Card, Text } from '@tremor/react';
import { Target, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

interface TeamProgressCardProps {
  year: number;
  quarter: number;
  sgaIndividualGoalsAggregate: number; // Sum of all SGA goals
  sgaManagerGoal: number | null;       // Manager's goal
  currentSQOs: number;
}

export function TeamProgressCard({
  year,
  quarter,
  sgaIndividualGoalsAggregate,
  sgaManagerGoal,
  currentSQOs,
}: TeamProgressCardProps) {
  const quarterInfo = getQuarterInfo(`${year}-Q${quarter}`);
  const startDate = new Date(quarterInfo.startDate);
  const endDate = new Date(quarterInfo.endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Calculate days
  const daysInQuarter = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.min(
    Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1),
    daysInQuarter
  );

  // Calculate pacing (against Manager Goal)
  let expectedSQOs = 0;
  let status: 'ahead' | 'on-track' | 'behind' | 'no-goal' = 'no-goal';
  let statusColor = 'text-gray-500';
  let StatusIcon = Minus;

  if (sgaManagerGoal && sgaManagerGoal > 0) {
    expectedSQOs = Math.round((sgaManagerGoal / daysInQuarter) * daysElapsed);
    
    if (currentSQOs > expectedSQOs * 1.1) {
      status = 'ahead';
      statusColor = 'text-green-600 dark:text-green-400';
      StatusIcon = TrendingUp;
    } else if (currentSQOs >= expectedSQOs * 0.9) {
      status = 'on-track';
      statusColor = 'text-yellow-600 dark:text-yellow-400';
      StatusIcon = Minus;
    } else {
      status = 'behind';
      statusColor = 'text-red-600 dark:text-red-400';
      StatusIcon = TrendingDown;
    }
  }

  // Progress percentages against both goals
  const progressVsAggregate = sgaIndividualGoalsAggregate > 0
    ? Math.min(100, Math.round((currentSQOs / sgaIndividualGoalsAggregate) * 100))
    : 0;
  
  const progressVsManager = sgaManagerGoal && sgaManagerGoal > 0
    ? Math.min(100, Math.round((currentSQOs / sgaManagerGoal) * 100))
    : 0;

  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <Text className="text-lg font-semibold text-gray-900 dark:text-white">
            Team Progress - {quarterInfo.label}
          </Text>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <Text className="text-sm text-gray-500 dark:text-gray-400 mb-1">Current SQOs</Text>
          <Text className="text-3xl font-bold text-gray-900 dark:text-white">
            {currentSQOs}
          </Text>
        </div>

        <div>
          <Text className="text-sm text-gray-500 dark:text-gray-400 mb-1">Pacing Status</Text>
          <div className="flex items-center gap-2">
            <StatusIcon className={`w-5 h-5 ${statusColor}`} />
            <Text className={`text-lg font-semibold ${statusColor}`}>
              {status === 'ahead' ? 'Ahead' : status === 'on-track' ? 'On-track' : status === 'behind' ? 'Behind' : 'No goal set'}
            </Text>
          </div>
          {sgaManagerGoal && sgaManagerGoal > 0 && (
            <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Expected: {expectedSQOs} ({daysElapsed}/{daysInQuarter} days)
            </Text>
          )}
        </div>
      </div>

      {/* Two Goal Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* vs. SGA Individual Goals (Aggregate) */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <Text className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            vs. SGA Individual Goals (Aggregate)
          </Text>
          <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {sgaIndividualGoalsAggregate}
          </Text>
          <div className="flex items-center justify-between mb-2">
            <Text className="text-xs text-gray-500 dark:text-gray-400">Progress</Text>
            <Text className="text-sm font-medium text-gray-900 dark:text-white">
              {progressVsAggregate}%
            </Text>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, progressVsAggregate)}%` }}
            />
          </div>
          <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {currentSQOs >= sgaIndividualGoalsAggregate ? '✓' : ''} {currentSQOs} / {sgaIndividualGoalsAggregate}
          </Text>
        </div>

        {/* vs. SGA Manager Goal */}
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <Text className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            vs. SGA Manager Goal
          </Text>
          <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {sgaManagerGoal ?? 'Not set'}
          </Text>
          {sgaManagerGoal && sgaManagerGoal > 0 && (
            <>
              <div className="flex items-center justify-between mb-2">
                <Text className="text-xs text-gray-500 dark:text-gray-400">Progress</Text>
                <Text className="text-sm font-medium text-gray-900 dark:text-white">
                  {progressVsManager}%
                </Text>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, progressVsManager)}%` }}
                />
              </div>
              <Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {currentSQOs >= sgaManagerGoal ? '✓' : ''} {currentSQOs} / {sgaManagerGoal}
              </Text>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 5.3: Create SGABreakdownTable Component

**File**: `src/components/sga-hub/SGABreakdownTable.tsx` (NEW)

**Action**: Create table showing individual SGA breakdown with goals, SQOs, progress, and pacing.

**Requirements**:
- **Columns**: SGA Name, Individual Goal, SQO Count, Progress %, Pacing Status, Pacing Diff
- **Sortable** by: SGA Name, SQO Count, Individual Goal, Progress %, Pacing Status, Pacing Diff
- **Filterable** by: SGA (multi-select), Pacing Status (multi-select: Ahead, On-Track, Behind, No Goal)
- **Default Sort**: Pacing Status ascending (worst first = most behind first)
- **Clickable SQO numbers** for drill-down modal
- Uses individual SGA goals from existing `QuarterlyGoal` model

**Implementation**:
```typescript
'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@tremor/react';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { TrendingUp, TrendingDown, Minus, ChevronUp, ChevronDown } from 'lucide-react';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

interface SGABreakdownRow {
  sgaName: string;
  goal: number | null;
  sqoCount: number;
  progressPercent: number | null; // SQO Count / Goal * 100
  expectedSQOs: number;
  pacingDiff: number; // currentSQOs - expectedSQOs
  pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal';
}

interface SGABreakdownTableProps {
  year: number;
  quarter: number;
  breakdown: SGABreakdownRow[];
  isLoading?: boolean;
  onSQOClick?: (sgaName: string) => void; // Note: AdminQuarterlyProgressView wraps this to pass filters
  // Filter props
  selectedSGAs?: string[];
  selectedPacingStatuses?: string[];
  onSGAFilterChange?: (sgas: string[]) => void;
  onPacingStatusFilterChange?: (statuses: string[]) => void;
  sgaOptions?: Array<{ value: string; label: string; isActive: boolean }>;
}

type SortColumn = 'sgaName' | 'goal' | 'sqoCount' | 'progressPercent' | 'pacingStatus' | 'pacingDiff' | null;
type SortDirection = 'asc' | 'desc';

export function SGABreakdownTable({
  year,
  quarter,
  breakdown,
  isLoading = false,
  onSQOClick,
  selectedSGAs = [],
  selectedPacingStatuses = [],
}: SGABreakdownTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('pacingStatus');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc'); // Default: Behind first

  // Get quarter info for display
  const quarterInfo = getQuarterInfo(`${year}-Q${quarter}`);

  // Filter breakdown by selected SGAs and Pacing Statuses
  const filteredBreakdown = useMemo(() => {
    let filtered = breakdown;
    
    if (selectedSGAs.length > 0) {
      filtered = filtered.filter(row => selectedSGAs.includes(row.sgaName));
    }
    
    if (selectedPacingStatuses.length > 0) {
      filtered = filtered.filter(row => selectedPacingStatuses.includes(row.pacingStatus));
    }
    
    return filtered;
  }, [breakdown, selectedSGAs, selectedPacingStatuses]);

  // Sort filtered breakdown
  const sortedBreakdown = useMemo(() => {
    if (!sortColumn) return filteredBreakdown;
    
    return [...filteredBreakdown].sort((a, b) => {
      let comparison = 0;
      
      switch (sortColumn) {
        case 'sgaName':
          comparison = a.sgaName.toLowerCase().localeCompare(b.sgaName.toLowerCase());
          break;
        case 'goal':
          comparison = (a.goal || 0) - (b.goal || 0);
          break;
        case 'sqoCount':
          comparison = a.sqoCount - b.sqoCount;
          break;
        case 'progressPercent':
          comparison = (a.progressPercent || 0) - (b.progressPercent || 0);
          break;
        case 'pacingStatus':
          // Order: behind (0) < on-track (1) < ahead (2) < no-goal (3)
          const statusOrder: Record<string, number> = {
            'behind': 0,
            'on-track': 1,
            'ahead': 2,
            'no-goal': 3,
          };
          comparison = (statusOrder[a.pacingStatus] || 99) - (statusOrder[b.pacingStatus] || 99);
          break;
        case 'pacingDiff':
          comparison = a.pacingDiff - b.pacingDiff;
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredBreakdown, sortColumn, sortDirection]);

  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (column === null) return;
    
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default direction
      setSortColumn(column);
      if (column === 'sgaName') {
        setSortDirection('asc'); // A-Z default
      } else if (column === 'pacingStatus') {
        setSortDirection('asc'); // Behind first default
      } else {
        setSortDirection('desc'); // High-Low default for numbers
      }
    }
  };

  // Sortable header cell component (reuse pattern from ClosedLostTable)
  const SortableHeader = ({ column, children, alignRight = false, alignCenter = false }: { 
    column: SortColumn; 
    children: React.ReactNode; 
    alignRight?: boolean;
    alignCenter?: boolean;
  }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';
    
    return (
      <TableHeaderCell 
        className={`text-gray-600 dark:text-gray-400 ${
          column !== null ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none' : ''
        } ${alignRight ? 'text-right' : alignCenter ? 'text-center' : ''}`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : alignCenter ? 'justify-center' : ''}`}>
          {children}
          {column !== null && (
            <div className="flex flex-col">
              <ChevronUp 
                className={`w-3 h-3 ${showAsc ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
              />
              <ChevronDown 
                className={`w-3 h-3 -mt-1 ${showDesc ? 'text-blue-600 dark:text-blue-400' : 'text-gray-300 dark:text-gray-600'}`} 
              />
            </div>
          )}
        </div>
      </TableHeaderCell>
    );
  };

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
          Individual SGA Breakdown
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          SQO performance by SGA for {quarterInfo.label}
        </p>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow className="bg-gray-50 dark:bg-gray-900">
              <SortableHeader column="sgaName">SGA Name</SortableHeader>
              <SortableHeader column="goal" alignRight>Individual Goal</SortableHeader>
              <SortableHeader column="sqoCount" alignRight>SQO Count</SortableHeader>
              <SortableHeader column="progressPercent" alignRight>Progress %</SortableHeader>
              <SortableHeader column="pacingStatus" alignCenter>Pacing Status</SortableHeader>
              <SortableHeader column="pacingDiff" alignRight>Pacing Diff</SortableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedBreakdown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-500 dark:text-gray-400 py-12">
                  No data available
                </TableCell>
              </TableRow>
            ) : (
              sortedBreakdown.map((row) => {
                const StatusIcon = row.pacingStatus === 'ahead' ? TrendingUp 
                  : row.pacingStatus === 'behind' ? TrendingDown 
                  : Minus;
                
                const statusColor = row.pacingStatus === 'ahead' 
                  ? 'text-green-600 dark:text-green-400'
                  : row.pacingStatus === 'on-track'
                  ? 'text-yellow-600 dark:text-yellow-400'
                  : row.pacingStatus === 'behind'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-500 dark:text-gray-400';
                
                const statusLabel = row.pacingStatus === 'ahead' ? 'Ahead'
                  : row.pacingStatus === 'on-track' ? 'On-Track'
                  : row.pacingStatus === 'behind' ? 'Behind'
                  : 'No Goal';

                return (
                  <TableRow
                    key={row.sgaName}
                    className="hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <TableCell className="font-medium text-gray-900 dark:text-white">
                      {row.sgaName}
                    </TableCell>
                    <TableCell className="text-right text-gray-900 dark:text-white">
                      {row.goal ?? '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {onSQOClick ? (
                        <button
                          onClick={() => onSQOClick(row.sgaName)}
                          className="font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                        >
                          {row.sqoCount}
                        </button>
                      ) : (
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {row.sqoCount}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-gray-900 dark:text-white">
                      {row.progressPercent !== null ? `${row.progressPercent}%` : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <StatusIcon className={`w-4 h-4 ${statusColor}`} />
                        <span className={`text-sm font-medium ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className={`text-right font-medium ${row.pacingDiff >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {row.pacingDiff >= 0 ? '+' : ''}{row.pacingDiff}
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

**Note**: This component will need to fetch individual SGA goals. We'll integrate that in Phase 6.

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 5.4: Create AdminQuarterlyFilters Component

**File**: `src/components/sga-hub/AdminQuarterlyFilters.tsx` (NEW)

**Action**: Create filter component reusing logic from LeaderboardFilters.

**Requirements**:
- **Filters**: Year, Quarter, SGA (multi-select), Channel, Source, Pacing Status (multi-select)
- **Defaults**: 
  - Current quarter
  - All active SGAs
  - Channels: "Outbound", "Outbound + Marketing", "Re-Engagement" (match Leaderboard defaults)
  - Sources: All sources
  - Pacing Status: All statuses
- **UI Pattern**: Reuse `LeaderboardFilters.tsx` pattern (expandable, local state, Apply button)

**Implementation** (simplified - reuse LeaderboardFilters pattern):
```typescript
'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronUp, Check, Filter } from 'lucide-react';
import { getQuarterInfo, getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';

interface SGAOption {
  value: string;
  label: string;
  isActive: boolean;
}

interface AdminQuarterlyFiltersProps {
  selectedYear: number;
  selectedQuarter: number;
  selectedSGAs: string[];
  selectedChannels: string[];
  selectedSources: string[];
  selectedPacingStatuses: string[]; // NEW: Pacing Status filter
  sgaOptions: SGAOption[];
  channelOptions: string[];
  sourceOptions: string[];
  sgaOptionsLoading: boolean;
  onApply: (filters: {
    year: number;
    quarter: number;
    sgas: string[];
    channels: string[];
    sources: string[];
    pacingStatuses: string[]; // NEW
  }) => void;
  disabled?: boolean;
}

export function AdminQuarterlyFilters({
  selectedYear: initialYear,
  selectedQuarter: initialQuarter,
  selectedSGAs: initialSGAs,
  selectedChannels: initialChannels,
  selectedSources: initialSources,
  selectedPacingStatuses: initialPacingStatuses = ['ahead', 'on-track', 'behind', 'no-goal'], // Default: all
  sgaOptions,
  channelOptions,
  sourceOptions,
  sgaOptionsLoading,
  onApply,
  disabled = false,
}: AdminQuarterlyFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [sgaSearch, setSgaSearch] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');

  const [localYear, setLocalYear] = useState<number>(initialYear);
  const [localQuarter, setLocalQuarter] = useState<number>(initialQuarter);
  const [localSGAs, setLocalSGAs] = useState<string[]>(initialSGAs);
  const [localChannels, setLocalChannels] = useState<string[]>(initialChannels);
  const [localSources, setLocalSources] = useState<string[]>(initialSources);
  const [localPacingStatuses, setLocalPacingStatuses] = useState<string[]>(initialPacingStatuses || ['ahead', 'on-track', 'behind', 'no-goal']); // Default: all selected

  // Sync local state with props
  useEffect(() => {
    setLocalYear(initialYear);
    setLocalQuarter(initialQuarter);
    setLocalSGAs(initialSGAs);
    setLocalChannels(initialChannels);
    setLocalSources(initialSources);
    setLocalPacingStatuses(initialPacingStatuses);
  }, [initialYear, initialQuarter, initialSGAs, initialChannels, initialSources, initialPacingStatuses]);

  // Generate year options (current year ± 2 years)
  const currentYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  // Generate quarter options
  const quarterOptions = [1, 2, 3, 4];

  // Filter SGA options by search
  const filteredSgaOptions = useMemo(() => {
    if (!sgaSearch) return sgaOptions;
    const searchLower = sgaSearch.toLowerCase();
    return sgaOptions.filter(sga =>
      sga.label.toLowerCase().includes(searchLower)
    );
  }, [sgaOptions, sgaSearch]);

  // Filter source options by search
  const filteredSourceOptions = useMemo(() => {
    if (!sourceSearch) return sourceOptions;
    const searchLower = sourceSearch.toLowerCase();
    return sourceOptions.filter(source =>
      source.toLowerCase().includes(searchLower)
    );
  }, [sourceOptions, sourceSearch]);

  const handleApplyFilters = () => {
    if (disabled) return;
    // Ensure at least one channel is selected
    if (localChannels.length === 0) {
      alert('Please select at least one channel.');
      return;
    }
    onApply({
      year: localYear,
      quarter: localQuarter,
      sgas: localSGAs.length > 0 ? localSGAs : sgaOptions.filter(s => s.isActive).map(s => s.value),
      channels: localChannels,
      sources: localSources.length > 0 ? localSources : sourceOptions,
      pacingStatuses: localPacingStatuses.length > 0 ? localPacingStatuses : ['ahead', 'on-track', 'behind', 'no-goal'],
    });
  };

  const handleResetFilters = () => {
    if (disabled) return;
    const currentQuarterInfo = getQuarterInfo(getCurrentQuarter());
    setLocalYear(currentQuarterInfo.year);
    setLocalQuarter(currentQuarterInfo.quarterNumber);
    setLocalSGAs(sgaOptions.filter(s => s.isActive).map(s => s.value));
    setLocalChannels(['Outbound', 'Outbound + Marketing', 'Re-Engagement']);
    setLocalSources([...sourceOptions]);
    setLocalPacingStatuses(['ahead', 'on-track', 'behind', 'no-goal']); // Reset to all selected
  };

  const hasPendingChanges = 
    localYear !== initialYear ||
    localQuarter !== initialQuarter ||
    JSON.stringify([...localSGAs].sort()) !== JSON.stringify([...initialSGAs].sort()) ||
    JSON.stringify([...localChannels].sort()) !== JSON.stringify([...initialChannels].sort()) ||
    JSON.stringify([...localSources].sort()) !== JSON.stringify([...initialSources].sort()) ||
    JSON.stringify([...localPacingStatuses].sort()) !== JSON.stringify([...initialPacingStatuses].sort());

  const sgasSummary = sgaOptionsLoading 
    ? 'Loading...' 
    : localSGAs.length === sgaOptions.filter(s => s.isActive).length 
      ? 'All Active SGAs' 
      : `${localSGAs.length} SGAs`;

  const channelsSummary = localChannels.length === channelOptions.length 
    ? 'All Channels' 
    : `${localChannels.length} Channels`;

  const sourcesSummary = localSources.length === sourceOptions.length 
    ? 'All Sources' 
    : `${localSources.length} Sources`;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg mb-6 bg-white dark:bg-gray-800">
      {/* Collapsed Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        disabled={disabled}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors rounded-lg"
      >
        <div className="flex items-center gap-3">
          <Filter className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          <span className="text-base font-medium text-gray-900 dark:text-white">Filters</span>
          <div className="flex items-center gap-2">
            <span className="text-sm bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-0.5 rounded">
              {localYear}-Q{localQuarter}
            </span>
            <span className="text-sm bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-0.5 rounded">
              {channelsSummary}
            </span>
            <span className="text-sm bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-0.5 rounded">
              {sourcesSummary}
            </span>
            <span className="text-sm bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200 px-2 py-0.5 rounded">
              {sgasSummary}
            </span>
          </div>
          {hasPendingChanges && (
            <span className="text-xs text-orange-600 dark:text-orange-400">Changes pending</span>
          )}
        </div>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Year Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Year
              </label>
              <select
                value={localYear}
                onChange={(e) => setLocalYear(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                {yearOptions.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            {/* Quarter Selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Quarter
              </label>
              <select
                value={localQuarter}
                onChange={(e) => setLocalQuarter(parseInt(e.target.value, 10))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                {quarterOptions.map(q => (
                  <option key={q} value={q}>Q{q}</option>
                ))}
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
                    onClick={() => setLocalChannels([...channelOptions])}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => setLocalChannels([])}
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
                        onChange={() => {
                          if (disabled) return;
                          if (isSelected) {
                            setLocalChannels(localChannels.filter(c => c !== channel));
                          } else {
                            setLocalChannels([...localChannels, channel]);
                          }
                        }}
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

            {/* SGA Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  SGAs
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      if (disabled || sgaOptionsLoading) return;
                      const activeSGAs = sgaOptions.filter(s => s.isActive).map(s => s.value);
                      setLocalSGAs(activeSGAs.length > 0 ? activeSGAs : sgaOptions.map(s => s.value));
                    }}
                    disabled={disabled || sgaOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Active Only
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => {
                      if (disabled || sgaOptionsLoading) return;
                      setLocalSGAs(sgaOptions.map(s => s.value));
                    }}
                    disabled={disabled || sgaOptionsLoading}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    All SGAs
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => {
                      if (disabled) return;
                      setLocalSGAs([]);
                    }}
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
                          onChange={() => {
                            if (disabled) return;
                            if (isSelected) {
                              setLocalSGAs(localSGAs.filter(s => s !== sga.value));
                            } else {
                              setLocalSGAs([...localSGAs, sga.value]);
                            }
                          }}
                          disabled={disabled}
                          className="sr-only"
                        />
                        <span className={`text-base ${isSelected ? 'text-orange-700 dark:text-orange-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                          {sga.label}
                        </span>
                      </label>
                    );
                  })
                )}
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
                    onClick={() => setLocalSources([...sourceOptions])}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => setLocalSources([])}
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
                          onChange={() => {
                            if (disabled) return;
                            if (isSelected) {
                              setLocalSources(localSources.filter(s => s !== source));
                            } else {
                              setLocalSources([...localSources, source]);
                            }
                          }}
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

            {/* Pacing Status Multi-Select - NEW */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-base font-medium text-gray-700 dark:text-gray-300">
                  Pacing Status
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setLocalPacingStatuses(['ahead', 'on-track', 'behind', 'no-goal'])}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Select All
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={() => setLocalPacingStatuses([])}
                    disabled={disabled}
                    className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 disabled:opacity-50"
                  >
                    Deselect All
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {['ahead', 'on-track', 'behind', 'no-goal'].map(status => {
                  const isSelected = localPacingStatuses.includes(status);
                  const statusLabels: Record<string, string> = {
                    'ahead': 'Ahead',
                    'on-track': 'On-Track',
                    'behind': 'Behind',
                    'no-goal': 'No Goal',
                  };
                  return (
                    <label
                      key={status}
                      className={`
                        flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors
                        ${isSelected 
                          ? 'bg-indigo-50 dark:bg-indigo-900/30' 
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                        }
                        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
                      `}
                    >
                      <div className={`
                        w-4 h-4 rounded border-2 flex items-center justify-center transition-colors
                        ${isSelected 
                          ? 'bg-indigo-600 border-indigo-600' 
                          : 'border-gray-300 dark:border-gray-600'
                        }
                      `}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {
                          if (disabled) return;
                          if (isSelected) {
                            setLocalPacingStatuses(localPacingStatuses.filter(s => s !== status));
                          } else {
                            setLocalPacingStatuses([...localPacingStatuses, status]);
                          }
                        }}
                        disabled={disabled}
                        className="sr-only"
                      />
                      <span className={`text-base ${isSelected ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-gray-700 dark:text-gray-300'}`}>
                        {statusLabels[status]}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer with Apply and Reset buttons */}
          <div className="border-t border-gray-200 dark:border-gray-700 mt-4 pt-4 flex items-center justify-between">
            <span className="text-base font-medium text-gray-900 dark:text-white">
              {hasPendingChanges ? 'Changes pending' : 'Filters applied'}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleResetFilters}
                disabled={disabled}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Reset
              </button>
              <button
                onClick={handleApplyFilters}
                disabled={disabled || !hasPendingChanges}
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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

**Note**: This is a simplified version. Full implementation should include all filter UI patterns from LeaderboardFilters (channel/source/SGA multi-select with search, select all/deselect all, etc.).

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 5.5: Update TeamGoalEditor for Manager Goal

**File**: `src/components/sga-hub/TeamGoalEditor.tsx` (from Step 5.1)

**Action**: Update to handle manager goal (not team goal).

**Note**: Component created in Step 5.1, but ensure it's used for Manager Goal specifically.

---

## Step 5.6: Create AdminQuarterlyProgressView Component

**File**: `src/components/sga-hub/AdminQuarterlyProgressView.tsx` (NEW)

**Action**: Create container component that orchestrates all admin quarterly progress components.

**Implementation**:
```typescript
'use client';

import { useState, useEffect, useMemo } from 'react';
import { TeamGoalEditor } from './TeamGoalEditor';
import { TeamProgressCard } from './TeamProgressCard';
import { SGABreakdownTable } from './SGABreakdownTable';
import { AdminQuarterlyFilters } from './AdminQuarterlyFilters';
import { StatusSummaryStrip } from './StatusSummaryStrip';
import { dashboardApi } from '@/lib/api-client';
import { getCurrentQuarter, getQuarterInfo } from '@/lib/utils/sga-hub-helpers';
import { FilterOptions } from '@/types/filters';

interface AdminQuarterlyProgressViewProps {
  onSQOClick?: (sgaName: string, filters: { year: number; quarter: number; channels: string[]; sources: string[] }) => void;
}

export function AdminQuarterlyProgressView({
  onSQOClick,
}: AdminQuarterlyProgressViewProps) {
  const currentQuarterInfo = getQuarterInfo(getCurrentQuarter());
  
  const [year, setYear] = useState<number>(currentQuarterInfo.year);
  const [quarter, setQuarter] = useState<number>(currentQuarterInfo.quarterNumber);
  const [selectedSGAs, setSelectedSGAs] = useState<string[]>([]);
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['Outbound', 'Outbound + Marketing', 'Re-Engagement']);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedPacingStatuses, setSelectedPacingStatuses] = useState<string[]>(['ahead', 'on-track', 'behind', 'no-goal']); // Default: all

  const [sgaManagerGoal, setSgaManagerGoal] = useState<number | null>(null);
  const [adminProgress, setAdminProgress] = useState<any>(null);
  const [sgaGoals, setSgaGoals] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [savingGoal, setSavingGoal] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [sgaOptions, setSgaOptions] = useState<Array<{ value: string; label: string; isActive: boolean }>>([]);
  const [sgaOptionsLoading, setSgaOptionsLoading] = useState(false);

  // Fetch filter options
  useEffect(() => {
    const fetchFilterOptions = async () => {
      try {
        const options = await dashboardApi.getFilterOptions();
        setFilterOptions(options);
        if (options && options.sources) {
          setSelectedSources([...options.sources]);
        }
      } catch (err) {
        console.error('Error fetching filter options:', err);
      }
    };
    fetchFilterOptions();
  }, []);

  // Fetch SGA options
  useEffect(() => {
    const fetchSGAOptions = async () => {
      try {
        setSgaOptionsLoading(true);
        const response = await dashboardApi.getLeaderboardSGAOptions();
        setSgaOptions(response.sgaOptions);
        const activeSGAs = response.sgaOptions.filter(s => s.isActive).map(s => s.value);
        setSelectedSGAs(activeSGAs);
      } catch (err) {
        console.error('Error fetching SGA options:', err);
      } finally {
        setSgaOptionsLoading(false);
      }
    };
    fetchSGAOptions();
  }, []);

  // Fetch manager goal
  useEffect(() => {
    const fetchManagerGoal = async () => {
      try {
        const response = await dashboardApi.getManagerQuarterlyGoal(`${year}-Q${quarter}`);
        setSgaManagerGoal(response.goal);
      } catch (err) {
        console.error('Error fetching manager goal:', err);
      }
    };
    fetchManagerGoal();
  }, [year, quarter]);

  // Fetch admin progress and SGA breakdown
  useEffect(() => {
    const fetchProgress = async () => {
      try {
        setLoading(true);
        const progress = await dashboardApi.getAdminQuarterlyProgress({
          year,
          quarter,
          sgaNames: selectedSGAs.length > 0 ? selectedSGAs : undefined,
          channels: selectedChannels.length > 0 ? selectedChannels : undefined,
          sources: selectedSources.length > 0 ? selectedSources : undefined,
        });
        setAdminProgress(progress);

        // Fetch individual SGA goals for breakdown
        // TODO: Create API endpoint to fetch all SGA goals for a quarter
        // For now, we'll need to fetch them individually or create a batch endpoint
      } catch (err) {
        console.error('Error fetching admin progress:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchProgress();
  }, [year, quarter, selectedSGAs, selectedChannels, selectedSources]);

  const handleSaveManagerGoal = async (goal: number) => {
    setSavingGoal(true);
    try {
      await dashboardApi.setManagerQuarterlyGoal(`${year}-Q${quarter}`, goal);
      setSgaManagerGoal(goal);
    } catch (err) {
      console.error('Error saving manager goal:', err);
      throw err;
    } finally {
      setSavingGoal(false);
    }
  };

  const handleApplyFilters = (filters: {
    year: number;
    quarter: number;
    sgas: string[];
    channels: string[];
    sources: string[];
    pacingStatuses: string[];
  }) => {
    setYear(filters.year);
    setQuarter(filters.quarter);
    setSelectedSGAs(filters.sgas);
    setSelectedChannels(filters.channels);
    setSelectedSources(filters.sources);
    setSelectedPacingStatuses(filters.pacingStatuses);
  };

  // Build SGA breakdown with goals, progress, and pacing
  const sgaBreakdown = adminProgress?.sgaBreakdown.map((item: any) => {
    const goal = sgaGoals[item.sgaName] || null;
    const progressPercent = goal && goal > 0 
      ? Math.round((item.sqoCount / goal) * 100)
      : null;
    
    // Calculate pacing (same logic as TeamProgressCard)
    const quarterInfo = getQuarterInfo(`${year}-Q${quarter}`);
    const startDate = new Date(quarterInfo.startDate);
    const endDate = new Date(quarterInfo.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const daysInQuarter = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    const daysElapsed = Math.min(
      Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1),
      daysInQuarter
    );
    
    let expectedSQOs = 0;
    let pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal' = 'no-goal';
    
    if (goal && goal > 0) {
      expectedSQOs = Math.round((goal / daysInQuarter) * daysElapsed);
      if (item.sqoCount > expectedSQOs * 1.1) {
        pacingStatus = 'ahead';
      } else if (item.sqoCount >= expectedSQOs * 0.9) {
        pacingStatus = 'on-track';
      } else {
        pacingStatus = 'behind';
      }
    }
    
    const pacingDiff = item.sqoCount - expectedSQOs;
    
    return {
      sgaName: item.sgaName,
      goal,
      sqoCount: item.sqoCount,
      progressPercent,
      expectedSQOs,
      pacingDiff,
      pacingStatus,
    };
  }) || [];

  // Calculate status counts for StatusSummaryStrip
  const statusCounts = useMemo(() => {
    const counts = {
      ahead: 0,
      onTrack: 0,
      behind: 0,
      noGoal: 0,
      total: sgaBreakdown.length,
    };
    sgaBreakdown.forEach(row => {
      if (row.pacingStatus === 'ahead') counts.ahead++;
      else if (row.pacingStatus === 'on-track') counts.onTrack++;
      else if (row.pacingStatus === 'behind') counts.behind++;
      else if (row.pacingStatus === 'no-goal') counts.noGoal++;
    });
    return counts;
  }, [sgaBreakdown]);

  if (!filterOptions) {
    return <div>Loading filters...</div>;
  }

  return (
    <div>
      {/* 1. AdminQuarterlyFilters (collapsible) */}
      <AdminQuarterlyFilters
        selectedYear={year}
        selectedQuarter={quarter}
        selectedSGAs={selectedSGAs}
        selectedChannels={selectedChannels}
        selectedSources={selectedSources}
        selectedPacingStatuses={selectedPacingStatuses}
        sgaOptions={sgaOptions}
        channelOptions={filterOptions.channels}
        sourceOptions={filterOptions.sources}
        sgaOptionsLoading={sgaOptionsLoading}
        onApply={(filters) => {
          setYear(filters.year);
          setQuarter(filters.quarter);
          setSelectedSGAs(filters.sgas);
          setSelectedChannels(filters.channels);
          setSelectedSources(filters.sources);
          setSelectedPacingStatuses(filters.pacingStatuses);
        }}
        disabled={loading}
      />

      {/* 2. StatusSummaryStrip (at-a-glance stats) */}
      {adminProgress && (
        <StatusSummaryStrip
          quarterLabel={getQuarterInfo(`${year}-Q${quarter}`).label}
          totalSGAs={statusCounts.total}
          aheadCount={statusCounts.ahead}
          onTrackCount={statusCounts.onTrack}
          behindCount={statusCounts.behind}
          noGoalCount={statusCounts.noGoal}
        />
      )}

      {/* 3. Manager Goal Editor (inline, smaller) */}
      <div className="mb-4">
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            SGA Manager Quarterly Goal:
          </span>
          <TeamGoalEditor
            year={year}
            quarter={quarter}
            currentGoal={sgaManagerGoal}
            onSave={handleSaveManagerGoal}
            isLoading={savingGoal}
          />
        </div>
      </div>

      {/* 4. TeamProgressCard (the two goal metrics comparison) */}
      {adminProgress && (
        <TeamProgressCard
          year={year}
          quarter={quarter}
          sgaIndividualGoalsAggregate={adminProgress.sgaIndividualGoalsAggregate}
          sgaManagerGoal={adminProgress.sgaManagerGoal}
          currentSQOs={adminProgress.teamTotalSQOs}
        />
      )}

      {/* 5. SGABreakdownTable (with sorting and full columns) */}
      <SGABreakdownTable
        year={year}
        quarter={quarter}
        breakdown={sgaBreakdown}
        isLoading={loading}
        onSQOClick={onSQOClick ? (sgaName) => onSQOClick(sgaName, { year, quarter, channels: selectedChannels, sources: selectedSources }) : undefined}
        selectedSGAs={selectedSGAs}
        selectedPacingStatuses={selectedPacingStatuses}
        sgaOptions={sgaOptions}
      />
    </div>
  );
}
```

**Note**: This component needs an API endpoint to fetch individual SGA goals. We'll add that in Phase 6.

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Phase 5 Completion Checklist

- [ ] Step 5.1a: Created StatusSummaryStrip component
- [ ] Step 5.1: Created TeamGoalEditor component
- [ ] Step 5.2: Created TeamProgressCard component
- [ ] Step 5.3: Created SGABreakdownTable component (with all 6 columns, sorting, filtering)
- [ ] Step 5.4: Created AdminQuarterlyFilters component (with Pacing Status filter, all multi-selects)
- [ ] Step 5.5: Updated TeamGoalEditor for Manager Goal
- [ ] Step 5.6: Created AdminQuarterlyProgressView component (with correct layout order)
- [ ] No TypeScript errors
- [ ] No linting errors

---

## 🛑 STOP - PHASE 5 COMPLETE

**CURSOR.AI**: Report your findings for Phase 5:
1. Were there any issues with component creation?
2. Any TypeScript or linting errors fixed?
3. Any additional modifications needed?

**Update this document** with your findings in a new section called "Phase 5 Results" below.

**ASK**: "Phase 5 complete. Ready to proceed to Phase 6 (Integration)?"

---

# 🚀 PHASE 6: Integration

## Objective
Integrate admin quarterly progress view into SGA Hub and add missing API endpoints.

---

## Step 6.1: Create API Endpoint for Individual SGA Goals

**File**: `src/app/api/sga-hub/quarterly-goals/route.ts` (NEW or modify existing)

**Action**: Create endpoint to fetch all SGA goals for a given quarter.

**Implementation**:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const year = searchParams.get('year');
    const quarter = searchParams.get('quarter');
    const sgaNames = searchParams.getAll('sgaNames'); // Optional: filter by specific SGAs

    if (!year || !quarter) {
      return NextResponse.json(
        { error: 'Missing required parameters: year and quarter' },
        { status: 400 }
      );
    }

    const yearNum = parseInt(year, 10);
    const quarterNum = parseInt(quarter, 10);

    if (isNaN(yearNum) || isNaN(quarterNum) || quarterNum < 1 || quarterNum > 4) {
      return NextResponse.json(
        { error: 'Invalid year or quarter' },
        { status: 400 }
      );
    }

    // Build where clause
    const where: any = {
      year: yearNum,
      quarter: quarterNum,
    };

    if (sgaNames.length > 0) {
      where.sgaName = { in: sgaNames };
    }

    // Fetch SGA goals
    const goals = await prisma.quarterlyGoal.findMany({
      where,
      select: {
        sgaName: true,
        sqoGoal: true,
      },
    });

    // Convert to record format
    const goalsRecord: Record<string, number | null> = {};
    goals.forEach(goal => {
      goalsRecord[goal.sgaName] = goal.sqoGoal;
    });

    return NextResponse.json({ goals: goalsRecord });
  } catch (error) {
    console.error('Error fetching SGA goals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGA goals' },
      { status: 500 }
    );
  }
}
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 6.2: Update API Client for SGA Goals

**File**: `src/lib/api-client.ts`

**Action**: Add method to fetch SGA goals.

**Implementation**:
```typescript
getSGAQuarterlyGoals: (year: number, quarter: number, sgaNames?: string[]) => {
  const params = new URLSearchParams({
    year: year.toString(),
    quarter: quarter.toString(),
  });
  
  if (sgaNames && sgaNames.length > 0) {
    sgaNames.forEach(sga => params.append('sgaNames', sga));
  }
  
  return apiFetch<{ goals: Record<string, number | null> }>(
    `/api/sga-hub/quarterly-goals?${params.toString()}`
  );
},
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 6.3: Update AdminQuarterlyProgressView to Fetch SGA Goals

**File**: `src/components/sga-hub/AdminQuarterlyProgressView.tsx`

**Action**: Add logic to fetch individual SGA goals and merge with breakdown data.

**Implementation**:
```typescript
// Add this useEffect after the team progress fetch
useEffect(() => {
  const fetchSGAGoals = async () => {
    if (!teamProgress || teamProgress.sgaBreakdown.length === 0) return;
    
    try {
      const sgaNames = teamProgress.sgaBreakdown.map((item: any) => item.sgaName);
      const response = await dashboardApi.getSGAQuarterlyGoals(year, quarter, sgaNames);
      setSgaGoals(response.goals);
    } catch (err) {
      console.error('Error fetching SGA goals:', err);
    }
  };
  
  fetchSGAGoals();
}, [year, quarter, teamProgress]);
```

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 6.4: Modify Quarterly Progress Tab to Conditionally Render

**File**: `src/app/dashboard/sga-hub/SGAHubContent.tsx`

**Action**: Check user role and conditionally render admin view vs. SGA view.

**Current Structure**: Quarterly Progress is rendered directly in SGAHubContent.tsx (not a separate component).

**Implementation**:
```typescript
// In SGAHubContent.tsx, find the quarterly-progress tab content
{activeTab === 'quarterly-progress' && (
  isAdmin ? (
    // Admin view: Show AdminQuarterlyProgressView
    <AdminQuarterlyProgressView
      onSQOClick={handleAdminQuarterlySQOClick}
    />
  ) : (
    // SGA view: Show existing quarterly progress (UNCHANGED)
    <>
      {/* Existing quarterly progress UI - DO NOT MODIFY */}
      <div className="mb-4 flex items-end justify-between gap-4">
        {/* Quarter selector */}
      </div>
      {quarterlyProgress && (
        <QuarterlyProgressCard
          progress={quarterlyProgress}
          onSQOClick={handleQuarterlySQOClick}
        />
      )}
      <QuarterlyProgressChart ... />
      <SQODetailTable ... />
    </>
  )
)}
```

**CRITICAL**: Ensure SGA users see EXACTLY the same quarterly progress view as before (no changes).

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Step 6.5: Add Drill-Down Handler for Admin View

**File**: `src/app/dashboard/sga-hub/SGAHubContent.tsx`

**Action**: Add handler for SQO click from admin breakdown table (reuse existing drill-down modal state).

**Implementation**:
```typescript
const handleAdminQuarterlySQOClick = async (
  sgaName: string,
  filters: { year: number; quarter: number; channels: string[]; sources: string[] }
) => {
  setDrillDownLoading(true);
  setDrillDownError(null);
  setDrillDownMetricType('sqos');
  setDrillDownOpen(true);
  
  // Use filters passed from AdminQuarterlyProgressView
  const title = `${sgaName} - SQOs - ${filters.year}-Q${filters.quarter}`;
  setDrillDownTitle(title);
  
  setDrillDownContext({
    metricType: 'sqos',
    title,
    sgaName: sgaName,
    quarter: `${filters.year}-Q${filters.quarter}`,
  });
  
  try {
    const response = await dashboardApi.getSQODrillDown(
      sgaName,
      { quarter: `${filters.year}-Q${filters.quarter}` },
      undefined, // userEmail
      filters.channels.length > 0 ? filters.channels : undefined,
      filters.sources.length > 0 ? filters.sources : undefined
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

**Note**: AdminQuarterlyProgressView manages its own filter state and passes it to the drill-down handler.

**Validation**: 
- Run `npx tsc --noEmit`
- Run `npm run lint`

---

## Phase 6 Completion Checklist

- [ ] Step 6.1: Created API endpoint for SGA goals
- [ ] Step 6.2: Updated API client
- [ ] Step 6.3: Updated AdminQuarterlyProgressView to fetch goals
- [ ] Step 6.4: Modified quarterly progress to conditionally render
- [ ] Step 6.5: Added drill-down handler
- [ ] No TypeScript errors
- [ ] No linting errors

---

## 🛑 STOP - PHASE 6 COMPLETE

**CURSOR.AI**: Report your findings for Phase 6:
1. What integration points were modified?
2. Were there any issues with conditional rendering?
3. Any TypeScript or linting errors fixed?

**Update this document** with your findings in a new section called "Phase 6 Results" below.

**ASK**: "Phase 6 complete. Ready to proceed to Phase 7 (Testing & Verification)?"

---

# 🚀 PHASE 7: Testing & Verification

## Objective
Comprehensive testing of admin enhancements with verification that SGA users see no changes.

---

## Step 7.1: Test Re-Engagement Toggle

**Actions**:
1. Login as admin user
2. Navigate to SGA Hub > Closed Lost Follow-Up > Re-engagement tab
3. Verify "My Records" / "All Records" toggle appears
4. Click "All Records" - verify all SGAs shown with SGA column
5. Click "My Records" - verify only current user's records shown
6. Switch between Closed Lost and Re-Engagement tabs - verify toggle state persists

**Expected Results**:
- Toggle only visible to admins/managers
- "All Records" shows SGA column
- Data filters correctly

---

## Step 7.2: Test Team Goal Setting

**Actions**:
1. Login as admin user
2. Navigate to SGA Hub > Quarterly Progress
3. Verify Team Goal Editor appears
4. Click "Edit" - verify input field appears
5. Enter a goal (e.g., 100) and click "Save"
6. Refresh page - verify goal persists
7. Try to set goal as SGA user - verify forbidden (if applicable)

**Expected Results**:
- Goal saves successfully
- Goal persists after refresh
- Only admins/managers can set goals

---

## Step 7.3: Test Team Progress & Pacing

**Actions**:
1. As admin, view Quarterly Progress
2. Verify Team Progress Card shows:
   - Team Goal
   - Current SQOs (sum of all SGAs)
   - Pacing Status (Ahead/On-track/Behind)
3. Verify pacing calculation:
   - Check expected SQOs = (goal / daysInQuarter) * daysElapsed
   - Verify status matches calculation
4. Test with different quarters (past, current, future)

**Expected Results**:
- Pacing calculation is accurate
- Status indicators are correct
- Progress bar shows correct percentage

---

## Step 7.4: Test SGA Breakdown Table

**Actions**:
1. As admin, view Quarterly Progress
2. Verify StatusSummaryStrip shows:
   - Correct total SGAs count
   - Correct counts for Ahead, On-Track, Behind, No Goal
   - Color-coded badges (green, yellow, red, gray)
3. Verify SGABreakdownTable shows ALL 6 columns:
   - SGA Name (left-aligned)
   - Individual Goal (right-aligned, shows "-" if no goal)
   - SQO Count (right-aligned, clickable)
   - Progress % (right-aligned, shows "-" if no goal)
   - Pacing Status (center-aligned, with icon)
   - Pacing Diff (right-aligned, shows +X or -X)
4. Verify default sort:
   - Table is sorted by Pacing Status ascending
   - "Behind" SGAs appear at the top
   - "On-Track" SGAs appear next
   - "Ahead" SGAs appear after
   - "No Goal" SGAs appear last
5. Test sorting functionality:
   - Click "SGA Name" column header - verify sort changes to A-Z
   - Click again - verify sort changes to Z-A
   - Click "SQO Count" column header - verify sort changes to High-Low
   - Click again - verify sort changes to Low-High
   - Test all sortable columns: Goal, Progress %, Pacing Status, Pacing Diff
6. Verify StatusSummaryStrip counts match breakdown table totals:
   - Count SGAs in each status category in the table
   - Verify counts match the StatusSummaryStrip badges
7. Test Pacing Status filter:
   - In AdminQuarterlyFilters, select only "Behind"
   - Verify only "Behind" SGAs are shown in table
   - Select "Ahead" and "On-Track" - verify correct filtering
   - Deselect all - verify no SGAs shown
8. Click on SQO number - verify drill-down modal opens
9. Verify drill-down shows correct records for that SGA with applied filters (channels, sources)

**Expected Results**:
- StatusSummaryStrip displays correct counts
- All 6 columns display correctly
- Default sort shows "Behind" SGAs at top
- Sorting works for all columns
- StatusSummaryStrip counts match breakdown table totals
- Pacing Status filter works correctly
- All SGAs listed
- Goals displayed correctly
- Pacing status accurate per SGA
- Drill-down works correctly with filters

---

## Step 7.5: Test Filters

**Actions**:
1. As admin, view Quarterly Progress
2. Test each filter:
   - Change Year - verify data updates
   - Change Quarter - verify data updates
   - Select specific SGAs - verify breakdown filters
   - Select specific Channels - verify data filters
   - Select specific Sources - verify data filters
3. Click "Reset" - verify filters return to defaults
4. Click "Apply Filters" - verify data updates

**Expected Results**:
- All filters work correctly
- Data updates when filters change
- Reset returns to defaults

---

## Step 7.6: Verify SGA User Experience Unchanged

**Actions**:
1. Login as regular SGA user (not admin/manager)
2. Navigate to SGA Hub
3. Verify:
   - **Closed Lost tab**: Shows "My Records / All Records" toggle (existing behavior)
   - **Re-Engagement tab**: Shows "My Records / All Records" toggle (if implemented)
   - **Quarterly Progress tab**: Shows EXACTLY the same view as before:
     - Quarter selector dropdown
     - QuarterlyProgressCard (individual SGA progress)
     - QuarterlyProgressChart
     - SQODetailTable
   - **NO admin controls visible**:
     - No filter picklists on Closed Lost/Re-Engagement
     - No Manager Goal editor
     - No Team Progress Card
     - No SGA Breakdown Table
     - No AdminQuarterlyFilters

**Expected Results**:
- SGA users see NO changes to their experience
- Original quarterly progress view works identically
- No admin features visible
- All existing functionality preserved

---

## Step 7.7: Terminal Validation

**Actions**: Run validation commands:

```bash
# Check for TypeScript errors
npx tsc --noEmit

# Check for linting errors
npm run lint

# Verify no console errors in browser
# Check network tab for API calls
```

**Expected Results**:
- No TypeScript errors
- No linting errors (or only pre-existing warnings)
- No console errors
- API calls return correct data

---

## Phase 7 Completion Checklist

- [ ] Step 7.1: Re-engagement toggle tested
- [ ] Step 7.2: Team goal setting tested
- [ ] Step 7.3: Team progress & pacing tested
- [ ] Step 7.4: SGA breakdown table tested
- [ ] Step 7.5: Filters tested
- [ ] Step 7.6: SGA user experience verified unchanged
- [ ] Step 7.7: Terminal validation passed

---

## 🛑 STOP - PHASE 7 COMPLETE

**CURSOR.AI**: Report your findings for Phase 7:
1. Were all features working correctly?
2. Any issues found during testing?
3. SGA user experience confirmed unchanged?
4. Any bugs or edge cases discovered?

**Update this document** with your findings in a new section called "Phase 7 Results" below.

**ASK**: "Phase 7 complete. All testing passed. Ready for deployment?"

---

## Summary

This implementation plan provides a comprehensive, phase-by-phase approach to implementing Admin SGA Hub enhancements while ensuring regular SGA users see no changes to their experience.

**Key Features Implemented**:
1. ✅ **Closed Lost & Re-Engagement Tab Filters**:
   - Admins ALWAYS see "All Records" (no toggle)
   - SGAs see "My Records / All Records" toggle
   - Filter picklists: SGA, Days Bucket, Close Lost Reason
   - Apply Filters button pattern

2. ✅ **Admin Quarterly Progress View**:
   - **TWO Goal Metrics**:
     - SGA Individual Goals (Aggregate) = Sum of all individual SGA goals
     - SGA Manager Goal = Manager's own quarterly target
   - Team progress tracking with pacing (against Manager Goal)
   - Individual SGA breakdown table with:
     - Sortable columns (default: Pacing Status ascending)
     - Filterable by SGA and Pacing Status
     - Progress %, Pacing Status, Pacing Diff per SGA
   - Leaderboard-style filters (Year, Quarter, SGA, Channel, Source, Pacing Status)
   - Default filters match Leaderboard: Channels = ["Outbound", "Outbound + Marketing", "Re-Engagement"]

**Critical Constraint Maintained**:
- ✅ Regular SGA users see NO changes to their experience
- ✅ Quarterly Progress tab shows original view for SGAs
- ✅ All existing functionality preserved

**Database Schema Changes**:
- ✅ New `ManagerQuarterlyGoal` model (separate from individual SGA goals)
- ✅ Individual SGA goals remain in existing `QuarterlyGoal` model

**Next Steps After Completion**:
- Deploy to production
- Monitor for any issues
- Gather user feedback
- Verify SGA user experience is unchanged

---

## Phase 1 Results
_To be filled after Phase 1 completion_

## Phase 2 Results
_To be filled after Phase 2 completion_

## Phase 3 Results
_To be filled after Phase 3 completion_

## Phase 4 Results
_To be filled after Phase 4 completion_

## Phase 5 Results
_To be filled after Phase 5 completion_

## Phase 6 Results
_To be filled after Phase 6 completion_

## Phase 7 Results
_To be filled after Phase 7 completion_
