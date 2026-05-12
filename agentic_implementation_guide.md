# Agentic Implementation Guide — Needs Linking Sub-Tab

## Reference Documents
All decisions in this guide are based on the completed exploration files:
- `exploration-results.md` — synthesized findings (primary)
- `code-inspector-findings.md` — types, construction sites, file dependencies
- `data-verifier-findings.md` — schema verification, data quality, value distributions
- `pattern-finder-findings.md` — established patterns, data flow architecture

## Feature Summary

| Capability | Source | Notes |
|---|---|---|
| Needs Linking queue table | `call_notes` (sales-coaching Neon, direct pg) | `status='pending'` filter — spec's `confidence_tier` column doesn't exist as scalar |
| Advisor hint extraction | `call_notes.attendees` JSONB + `invitee_emails` text[] + `title` | Cascade: first non-internal attendee name → first non-internal email → title |
| Rep + Manager names | `reps` table self-join on `manager_id` | 5 reps lack `manager_id` — managerName nullable |
| Confidence tier display | `slack_review_messages.sfdc_suggestion` JSONB | LEFT JOIN, display-only column, NULL for ~61% of rows |
| Days since call | SQL-computed `FLOOR(EXTRACT(EPOCH FROM (now() - call_started_at)) / 86400)::int` | Integer, no client date math |
| RBAC scoping | `getRepIdsVisibleToActor()` + actor self-union | admins=global, SGMs=own + coachees. SGM data linkage gap exists (data-setup, not code) |
| Row action | Link to `/dashboard/call-intelligence/review/[callNoteId]` | Existing NoteReviewClient SFDC search flow |

## Architecture Rules
- All queries use parameterized `$N` syntax — never string interpolation
- Direct-pg via `getCoachingPool()` from `src/lib/coachingDb.ts`
- Date coercion: `instanceof Date ? .toISOString() : String(x)`
- No caching — actor-scoped data (`export const dynamic = 'force-dynamic'`)
- Import merges — never add a second import from the same module
- Neon `pg` driver returns TIMESTAMPTZ as JS Date, BIGINT as string (cast `::text` or `::int`)

## Pre-Flight Checklist

```bash
npm run build 2>&1 | head -50
```

If pre-existing errors, stop and report. Do not proceed with a broken baseline.

---

# PHASE 1: Type Definitions

## Context
Define the new `NeedsLinkingRow` interface. Do NOT extend `CallIntelligenceTab` — Needs Linking is a sub-tab inside Coaching Usage, not a top-level tab. The sub-tab state is managed locally inside the Coaching Usage wrapper component (Phase 5).

## Step 1.1: Add `NeedsLinkingRow` interface

**File**: `src/types/call-intelligence.ts` (after the existing interfaces)

```typescript
export interface NeedsLinkingRow {
  callNoteId: string;
  callDate: string;
  source: string;
  advisorHint: string;
  repName: string;
  managerName: string | null;
  linkageStrategy: string;
  confidenceTier: string | null;
  daysSinceCall: number;
}
```

## PHASE 1 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Expected**: Zero new errors. `NeedsLinkingRow` is net-new with no consumers yet.

**STOP AND REPORT**:
- "Added `NeedsLinkingRow` interface and extended `CallIntelligenceTab` union in `src/types/call-intelligence.ts`"
- "Zero build errors expected — net-new type with no consumers"
- "Ready to proceed to Phase 2 (Query Layer)?"

---

# PHASE 2: Query Layer

## Context
Create the direct-pg query function that fetches needs-linking rows from the sales-coaching Neon DB. Uses `getCoachingPool()`, RBAC via `repIds` parameter, and the corrected orphan predicate (`status='pending'`).

## Step 2.1: Create query function

**File**: `src/lib/queries/call-intelligence/needs-linking.ts` (NEW)

```typescript
import { getCoachingPool } from '@/lib/coachingDb';
import type { NeedsLinkingRow } from '@/types/call-intelligence';

interface NeedsLinkingQueryRow {
  call_note_id: string;
  call_started_at: Date;
  source: string;
  linkage_strategy: string;
  advisor_hint: string | null;
  rep_name: string;
  manager_name: string | null;
  top_confidence_tier: string | null;
  days_since_call: number;
}

export async function getNeedsLinkingRows(
  repIds: string[],
  showAll: boolean
): Promise<NeedsLinkingRow[]> {
  if (repIds.length === 0) return [];

  const pool = getCoachingPool();

  const { rows } = await pool.query<NeedsLinkingQueryRow>(
    `SELECT
      cn.id AS call_note_id,
      cn.call_started_at,
      cn.source,
      cn.linkage_strategy,
      COALESCE(
        (SELECT a->>'name'
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(cn.attendees) = 'array' THEN cn.attendees ELSE '[]'::jsonb END
           ) AS a
          WHERE NULLIF(TRIM(a->>'name'), '') IS NOT NULL
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE '%@savvywealth.com'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE '%@savvyadvisors.com'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE '%resource.calendar.google.com'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE 'noreply@%'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE 'reply@%'
            AND LOWER(COALESCE(a->>'email', '')) NOT LIKE 'invites@%'
          LIMIT 1),
        (SELECT eml FROM unnest(cn.invitee_emails) AS eml
          WHERE LOWER(eml) NOT LIKE '%@savvywealth.com'
            AND LOWER(eml) NOT LIKE '%@savvyadvisors.com'
            AND LOWER(eml) NOT LIKE '%resource.calendar.google.com'
            AND LOWER(eml) NOT LIKE 'noreply@%'
            AND LOWER(eml) NOT LIKE 'reply@%'
          LIMIT 1),
        cn.title
      ) AS advisor_hint,
      sga.full_name AS rep_name,
      sgm.full_name AS manager_name,
      lat_srm.top_confidence_tier,
      FLOOR(EXTRACT(EPOCH FROM (now() - cn.call_started_at)) / 86400)::int AS days_since_call
    FROM call_notes cn
    LEFT JOIN reps sga ON sga.id = cn.rep_id AND sga.is_system = false
    LEFT JOIN reps sgm ON sgm.id = sga.manager_id AND sgm.is_system = false
    LEFT JOIN LATERAL (
      SELECT srm.sfdc_suggestion->'candidates'->0->>'confidence_tier' AS top_confidence_tier
      FROM slack_review_messages srm
      WHERE srm.call_note_id = cn.id AND srm.surface = 'dm'
      ORDER BY srm.created_at DESC
      LIMIT 1
    ) lat_srm ON true
    WHERE cn.source_deleted_at IS NULL
      AND cn.status = 'pending'
      AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')
      AND cn.rep_id = ANY($1::uuid[])
      AND ($2::boolean OR cn.call_started_at >= date_trunc('day', now()) - interval '14 days')
    ORDER BY cn.call_started_at DESC NULLS LAST`,
    [repIds, showAll]
  );

  return rows.map((r) => ({
    callNoteId: r.call_note_id,
    callDate: r.call_started_at instanceof Date ? r.call_started_at.toISOString() : String(r.call_started_at),
    source: r.source,
    advisorHint: r.advisor_hint ?? r.source,
    repName: r.rep_name,
    managerName: r.manager_name,
    linkageStrategy: r.linkage_strategy,
    confidenceTier: r.top_confidence_tier,
    daysSinceCall: r.days_since_call,
  }));
}
```

Key design decisions:
- `status='pending'` is the sole orphan filter (corrected from spec)
- Advisor-call filter: `cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call'` (matches coaching-usage scope)
- Confidence tier is display-only via LATERAL subquery to `slack_review_messages` (prevents row duplication)
- JSONB safety: `jsonb_typeof` guard on `cn.attendees` before `jsonb_array_elements`
- Advisor hint cascade: attendee name → invitee email → title
- Domain filtering: `@savvywealth.com`, `@savvyadvisors.com`, `resource.calendar.google.com`, `noreply@`, `reply@`, `invites@`
- `showAll=false` → last 14 days; `showAll=true` → no date limit
- `repIds` parameter enables RBAC without duplicating the visibility logic

## PHASE 2 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Expected**: Zero new errors. The query function imports `NeedsLinkingRow` from Phase 1 and `getCoachingPool` from existing code.

Verify the file exists and imports resolve:
```bash
grep -n "import.*getCoachingPool" src/lib/queries/call-intelligence/needs-linking.ts
grep -n "import.*NeedsLinkingRow" src/lib/queries/call-intelligence/needs-linking.ts
```

**STOP AND REPORT**:
- "Created `src/lib/queries/call-intelligence/needs-linking.ts` with `getNeedsLinkingRows()` function"
- "Corrected orphan predicate: `status='pending'` only (spec's `confidence_tier` column doesn't exist as scalar)"
- "Ready to proceed to Phase 3 (API Route)?"

---

# PHASE 3: API Route

## Context
Create the API route at `/api/call-intelligence/needs-linking`. Placed under `call-intelligence/` (NOT `admin/`) because SGMs need access. Auth follows the insights/heatmap pattern. No caching — results are actor-scoped.

## Step 3.1: Create API route

**File**: `src/app/api/call-intelligence/needs-linking/route.ts` (NEW)

Follow auth pattern from `src/app/api/call-intelligence/insights/heatmap/route.ts`.

```typescript
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getSessionPermissions } from '@/lib/permissions';
import { getRepIdByEmail } from '@/lib/queries/call-intelligence/visible-reps';
import { getRepIdsVisibleToActor } from '@/lib/queries/call-intelligence/visible-reps';
import { getNeedsLinkingRows } from '@/lib/queries/call-intelligence/needs-linking';

export const dynamic = 'force-dynamic';

const ALLOWED_ROLES = ['manager', 'admin', 'revops_admin', 'sgm'] as const;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const permissions = await getSessionPermissions(session);
  if (!permissions.allowedPages.includes(20)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!(ALLOWED_ROLES as readonly string[]).includes(permissions.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const isPrivileged = permissions.role === 'admin' || permissions.role === 'revops_admin';
  const rep = await getRepIdByEmail(session.user.email);

  if (!rep && !isPrivileged) {
    return NextResponse.json({ error: 'Rep not found' }, { status: 403 });
  }

  const actorRepId = rep?.id ?? '';
  const visibleRepIds = await getRepIdsVisibleToActor({
    repId: actorRepId,
    role: permissions.role,
    email: session.user.email,
  });

  // Union actor's own rep ID so SGMs see their own pending notes
  const allRepIds = actorRepId && !visibleRepIds.includes(actorRepId)
    ? [actorRepId, ...visibleRepIds]
    : visibleRepIds;

  const { searchParams } = new URL(request.url);
  const showAll = searchParams.get('showAll') === 'true';

  const rows = await getNeedsLinkingRows(allRepIds, showAll);

  return NextResponse.json({ rows, total: rows.length });
}
```

**Important**: Verify that `getRepIdByEmail` and `getRepIdsVisibleToActor` are both exported from `visible-reps.ts`. If `getRepIdByEmail` is not exported from there, find where it's exported from and adjust the import. The heatmap route uses it — match that pattern exactly.

## PHASE 3 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Expected**: Zero new errors. All imports reference existing exports.

Verify route structure:
```bash
ls src/app/api/call-intelligence/needs-linking/route.ts
```

Verify imports resolve:
```bash
grep -n "getRepIdByEmail\|getRepIdsVisibleToActor" src/app/api/call-intelligence/needs-linking/route.ts
```

**STOP AND REPORT**:
- "Created `/api/call-intelligence/needs-linking` route with auth, role gate, and RBAC"
- "Auth: page 20 + role in [manager, admin, revops_admin, sgm]"
- "No caching — actor-scoped data"
- "Ready to proceed to Phase 4 (Component)?"

---

# PHASE 4: Component — NeedsLinkingTab

## Context
Create the tab component with a data table, "last 14 days" / "all" toggle, ExportButton, and per-row "Review" action that links to the existing NoteReviewClient. No sub-tab wrapper needed — this is a top-level tab in CallIntelligenceClient, not a sub-tab of Coaching Usage.

## Step 4.1: Create the component

**File**: `src/app/dashboard/call-intelligence/tabs/NeedsLinkingTab.tsx` (NEW)

Follow the pattern of existing tabs in the same directory. Use Tremor React components (`Table`, `TableHead`, `TableRow`, `TableHeaderCell`, `TableBody`, `TableCell`, `Badge`, `Button`) consistent with the existing Call Intelligence UI.

Key requirements:
- Fetch from `/api/call-intelligence/needs-linking?showAll=false|true`
- Default state: `showAll = false` (last 14 days)
- Toggle button to switch between "Last 14 Days" and "All"
- Columns: Call Date, Source, Advisor Hint, Rep, Manager, Strategy, Confidence, Days
- "Review" link per row → `/dashboard/call-intelligence/review/${row.callNoteId}?returnTab=coaching-usage`
- ExportButton for CSV export with human-friendly column headers
- Loading state and empty state
- Sort: server-side `call_started_at DESC` (no client sorting needed)

```typescript
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell,
  Badge, Button, Text,
} from '@tremor/react';
import ExportButton from '@/components/dashboard/ExportButton';
import type { NeedsLinkingRow } from '@/types/call-intelligence';

const STRATEGY_LABELS: Record<string, string> = {
  manual_entry: 'Manual Entry',
  kixie_task_link: 'Kixie Task',
  crd_prefix: 'CRD Match',
  calendar_title: 'Calendar Title',
  attendee_email: 'Attendee Email',
};

function strategyLabel(raw: string): string {
  return STRATEGY_LABELS[raw] ?? raw;
}

export default function NeedsLinkingTab() {
  const [rows, setRows] = useState<NeedsLinkingRow[]>([]);
  const [total, setTotal] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/call-intelligence/needs-linking?showAll=${showAll}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setRows(data.rows ?? []);
          setTotal(data.total ?? 0);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [showAll]);

  const exportData = rows.map((r) => ({
    'Call Date': new Date(r.callDate).toLocaleDateString(),
    'Source': r.source,
    'Advisor Hint': r.advisorHint,
    'Rep': r.repName,
    'Manager': r.managerName ?? '',
    'Linkage Strategy': strategyLabel(r.linkageStrategy),
    'Confidence Tier': r.confidenceTier ?? '',
    'Days Since Call': r.daysSinceCall,
  }));

  if (loading) {
    return <Text className="p-4">Loading needs-linking queue...</Text>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Text className="font-medium">
            {total} call{total !== 1 ? 's' : ''} need linking
          </Text>
          <Button
            size="xs"
            variant={showAll ? 'secondary' : 'primary'}
            onClick={() => setShowAll(false)}
          >
            Last 14 Days
          </Button>
          <Button
            size="xs"
            variant={showAll ? 'primary' : 'secondary'}
            onClick={() => setShowAll(true)}
          >
            All
          </Button>
        </div>
        {rows.length > 0 && (
          <ExportButton data={exportData} filename="needs-linking" />
        )}
      </div>

      {rows.length === 0 ? (
        <Text className="p-4 text-center text-gray-500">
          No calls need linking{showAll ? '' : ' in the last 14 days'}.
        </Text>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Call Date</TableHeaderCell>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Advisor Hint</TableHeaderCell>
              <TableHeaderCell>Rep</TableHeaderCell>
              <TableHeaderCell>Manager</TableHeaderCell>
              <TableHeaderCell>Strategy</TableHeaderCell>
              <TableHeaderCell>Confidence</TableHeaderCell>
              <TableHeaderCell>Days</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.callNoteId}>
                <TableCell>{new Date(r.callDate).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Badge color={r.source === 'granola' ? 'blue' : 'amber'} size="xs">
                    {r.source}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-[200px] truncate">{r.advisorHint}</TableCell>
                <TableCell>{r.repName}</TableCell>
                <TableCell>{r.managerName ?? '—'}</TableCell>
                <TableCell>
                  <Badge color="gray" size="xs">{strategyLabel(r.linkageStrategy)}</Badge>
                </TableCell>
                <TableCell>
                  {r.confidenceTier ? (
                    <Badge
                      color={r.confidenceTier === 'unlikely' ? 'red' : r.confidenceTier === 'possible' ? 'yellow' : 'green'}
                      size="xs"
                    >
                      {r.confidenceTier}
                    </Badge>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </TableCell>
                <TableCell>{r.daysSinceCall}d</TableCell>
                <TableCell>
                  <Link
                    href={`/dashboard/call-intelligence/review/${r.callNoteId}?returnTab=coaching-usage`}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    Review
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

**Adaptation note**: The executing agent should check the exact Tremor component import paths and prop APIs used by existing tabs in the same directory (`CoachingUsageTab.tsx`, `InsightsTab.tsx`, etc.) and match them. If `ExportButton` uses a different API, adjust accordingly.

## PHASE 4 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -20
```

**Expected**: Zero new errors. Component imports `NeedsLinkingRow` from Phase 1, uses standard Tremor components.

Verify component structure:
```bash
grep -n "export default function NeedsLinkingTab" src/app/dashboard/call-intelligence/tabs/NeedsLinkingTab.tsx
grep -n "returnTab=coaching-usage" src/app/dashboard/call-intelligence/tabs/NeedsLinkingTab.tsx
```

**STOP AND REPORT**:
- "Created `NeedsLinkingTab.tsx` with table, 14-day/all toggle, CSV export, and review links"
- "Review links include `?returnTab=coaching-usage` for proper return navigation"
- "Ready to proceed to Phase 5 (Integration)?"

---

# PHASE 5: Integration — Sub-Tab Inside Coaching Usage

## Context
Wire Needs Linking as a sub-tab inside the Coaching Usage view. This requires:
1. Creating a wrapper component that manages sub-tab state (Overview vs Needs Linking)
2. Widening the Coaching Usage tab visibility to include SGMs and managers
3. The existing `CoachingUsageTab.tsx` (now the "Overview" sub-tab) remains byte-for-byte unchanged

**Important**: Do NOT add `'needs-linking'` to `CallIntelligenceTab`, `VALID_TABS`, or `page.tsx`. This is an internal sub-tab, not a top-level tab.

## Step 5.1: Create the Coaching Usage wrapper component

**File**: `src/app/dashboard/call-intelligence/tabs/CoachingUsageWrapper.tsx` (NEW)

This wrapper renders either the existing `CoachingUsageTab` (Overview) or `NeedsLinkingTab` based on local state. Only the Overview sub-tab is gated to `revops_admin`; Needs Linking is accessible to `manager`, `admin`, `revops_admin`, and `sgm`.

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@tremor/react';
import CoachingUsageTab from './CoachingUsageTab';
import NeedsLinkingTab from './NeedsLinkingTab';

type CoachingSubTab = 'overview' | 'needs-linking';

interface CoachingUsageWrapperProps {
  role: string;
}

export default function CoachingUsageWrapper({ role }: CoachingUsageWrapperProps) {
  const isRevopsAdmin = role === 'revops_admin';
  const defaultTab: CoachingSubTab = isRevopsAdmin ? 'overview' : 'needs-linking';
  const [subTab, setSubTab] = useState<CoachingSubTab>(defaultTab);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-gray-200 pb-2">
        {isRevopsAdmin && (
          <Button
            size="xs"
            variant={subTab === 'overview' ? 'primary' : 'secondary'}
            onClick={() => setSubTab('overview')}
          >
            Overview
          </Button>
        )}
        <Button
          size="xs"
          variant={subTab === 'needs-linking' ? 'primary' : 'secondary'}
          onClick={() => setSubTab('needs-linking')}
        >
          Needs Linking
        </Button>
      </div>

      {subTab === 'overview' && isRevopsAdmin && <CoachingUsageTab />}
      {subTab === 'needs-linking' && <NeedsLinkingTab />}
    </div>
  );
}
```

**Key design**: Non-revops_admin users (SGM, manager) only see the "Needs Linking" sub-tab button — no "Overview" button, no access to coaching analytics. `revops_admin` users see both sub-tabs and default to Overview. `CoachingUsageTab` is never modified — it renders inside the wrapper unchanged.

## Step 5.2: Update CallIntelligenceClient.tsx

**File**: `src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx`

1. Replace the `CoachingUsageTab` import with `CoachingUsageWrapper`:
   ```typescript
   // REMOVE: import CoachingUsageTab from './tabs/CoachingUsageTab';
   // ADD:
   import CoachingUsageWrapper from './tabs/CoachingUsageWrapper';
   ```

2. Widen the Coaching Usage tab button visibility. Find the condition that gates the "Coaching Usage" tab button (currently `isRevopsAdmin`) and change it to:
   ```typescript
   {(isRevopsAdmin || isManagerOrAdmin || role === 'sgm') && (
     // tab button for coaching-usage
   )}
   ```
   Read the file to find the exact condition pattern — it may use a different variable structure.

3. Replace the Coaching Usage render branch:
   ```typescript
   // REMOVE: {isRevopsAdmin && activeTab === 'coaching-usage' && <CoachingUsageTab />}
   // ADD:
   {activeTab === 'coaching-usage' && <CoachingUsageWrapper role={role} />}
   ```

   The render branch no longer needs a role gate because the tab button is already gated. The wrapper handles sub-tab visibility internally.

**Do NOT**: Modify `VALID_TABS`, add `'needs-linking'` to any array, or change `page.tsx`.

## Step 5.3: Fix pre-existing VALID_TABS mismatch (optional)

**File**: `src/app/dashboard/call-intelligence/page.tsx` (line 12)

Add `'cost-analysis'` to the server-side `VALID_TABS` array to fix the pre-existing mismatch with the client. This is a separate bug fix, not related to Needs Linking.

## PHASE 5 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -20
npm run build 2>&1 | tail -20
```

**Expected**: Zero errors. Build succeeds.

Verify integration:
```bash
grep -n "CoachingUsageWrapper" src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx
grep -rn "CoachingUsageTab" src/app/dashboard/call-intelligence/tabs/CoachingUsageWrapper.tsx
```

**Expected**: `CoachingUsageWrapper` imported and rendered in client. Wrapper imports `CoachingUsageTab` (unchanged) and `NeedsLinkingTab`.

**STOP AND REPORT**:
- "Created `CoachingUsageWrapper` with Overview/Needs Linking sub-tabs"
- "Widened Coaching Usage tab visibility to include SGMs and managers"
- "Existing `CoachingUsageTab.tsx` remains byte-for-byte unchanged (rendered inside wrapper)"
- "Build passes with zero errors"
- "Ready to proceed to Phase 6 (Return Navigation Fix)?"

---

# PHASE 6: Return Navigation Fix

## Context
`NoteReviewClient.tsx` hardcodes return navigation to `?tab=queue` after submit/reject. SGMs arriving from the Needs Linking tab will be deposited at the wrong tab. Fix: read `returnTab` from search params and use it for return navigation.

## Step 6.1: Fix NoteReviewClient return URL

**File**: `src/app/dashboard/call-intelligence/review/[callNoteId]/NoteReviewClient.tsx`

Read the file first to find the exact return-navigation code. The code-inspector found:
- `handleSubmit` and `handleReject` both push to `/dashboard/call-intelligence?tab=queue`
- `NoteReviewPage` (server component) reads `searchParams.returnTab` but doesn't use it

Update the return navigation to respect the `returnTab` parameter:

1. In the client component, use `useSearchParams()` from `next/navigation` to read `returnTab`.
2. Replace the hardcoded `?tab=queue` with `?tab=${returnTab || 'queue'}`.
3. Both `handleSubmit` and `handleReject` should use the same return URL.

**Pattern**:
```typescript
const VALID_RETURN_TABS = ['queue', 'record-notes', 'coaching-usage', 'insights', 'settings', 'usage-analytics', 'cost-analysis'];

const searchParams = useSearchParams();
const rawReturnTab = searchParams.get('returnTab');
const returnTab = rawReturnTab && VALID_RETURN_TABS.includes(rawReturnTab) ? rawReturnTab : 'queue';
// ... in handleSubmit/handleReject:
router.push(`/dashboard/call-intelligence?tab=${returnTab}`);
```

**Important**: Only modify the return URL construction — do not change any other behavior of `handleSubmit` or `handleReject`. The `VALID_RETURN_TABS` allowlist prevents invalid tab values from breaking navigation.

## PHASE 6 — VALIDATION GATE

```bash
npx tsc --noEmit 2>&1 | head -20
```

Verify the fix:
```bash
grep -n "returnTab" src/app/dashboard/call-intelligence/review/[callNoteId]/NoteReviewClient.tsx
```

**Expected**: `returnTab` appears in both the searchParams read and the router.push calls.

```bash
npm run build 2>&1 | tail -20
```

**Expected**: Build passes.

**STOP AND REPORT**:
- "Fixed NoteReviewClient return navigation to respect `returnTab` search param"
- "SGMs arriving from Needs Linking tab will return to the correct tab after review"
- "Build passes"
- "Ready to proceed to Phase 7 (Documentation Sync)?"

---

# PHASE 7: Documentation Sync

## Step 7.1: Run generators

```bash
npm run gen:api-routes
```

This regenerates `docs/_generated/api-routes.md` to include the new `/api/call-intelligence/needs-linking` route.

## Step 7.2: Update ARCHITECTURE.md

Read `docs/ARCHITECTURE.md` and find the Call Intelligence section. Add a brief mention of the Needs Linking tab and its API route. Match the existing format.

## Step 7.3: Write session context

Write `.ai-session-context.md` (required before git commit per project protocol):

```markdown
### Session Summary
Added "Needs Linking" sub-tab to the Call Intelligence page, surfacing call_notes not confidently attached to a Salesforce record.

### Business Context
SGMs and managers need visibility into unlinked coaching calls so they can manually attach them to Salesforce records via the existing NoteReviewClient search flow.

### Technical Approach
Direct-pg query against sales-coaching Neon DB using status='pending' as the orphan filter. RBAC via getRepIdsVisibleToActor(). New API route at /api/call-intelligence/needs-linking (not under /api/admin/ — SGMs need access). No schema migrations needed.

### What Changed
- New type: NeedsLinkingRow in call-intelligence.ts
- New query: needs-linking.ts with advisor hint extraction from JSONB
- New API route: /api/call-intelligence/needs-linking (with actor self-union for SGMs)
- New component: NeedsLinkingTab.tsx with 14-day/all toggle and export
- New component: CoachingUsageWrapper.tsx (sub-tab orchestration for Overview/Needs Linking)
- Modified: CallIntelligenceClient.tsx (widened Coaching Usage visibility, replaced CoachingUsageTab with CoachingUsageWrapper)
- Fixed: NoteReviewClient return navigation to respect returnTab param

### Verification
TypeScript build passes. API route has auth + role gate + RBAC.
```

## PHASE 7 — VALIDATION GATE

```bash
npm run build 2>&1 | tail -10
```

**Expected**: Clean build. All generators ran without errors.

**STOP AND REPORT**:
- "Documentation synced — API route inventory regenerated, ARCHITECTURE.md updated"
- "Session context written for Wrike integration"
- "Ready to proceed to Phase 8 (UI Validation)?"

---

# PHASE 8: UI/UX Validation (Requires Human)

## Test Group 1: Tab Visibility and Sub-Tab Navigation

1. Log in as `revops_admin` → navigate to `/dashboard/call-intelligence`
2. Click "Coaching Usage" tab → verify two sub-tab buttons: "Overview" and "Needs Linking"
3. Verify "Overview" is selected by default for revops_admin
4. Click "Needs Linking" → verify sub-tab switches to the Needs Linking table
5. Click "Overview" → verify the original Coaching Usage analytics view (KPI strip + table) appears unchanged
6. Log in as `sgm` → navigate to `/dashboard/call-intelligence`
7. Click "Coaching Usage" tab → verify only "Needs Linking" sub-tab button appears (no "Overview")
8. Verify the Needs Linking table loads directly
9. Log in as `sga` → verify "Coaching Usage" tab is NOT visible

## Test Group 2: Needs Linking Table

1. Click "Needs Linking" tab
2. Verify table loads with columns: Call Date, Source, Advisor Hint, Rep, Manager, Strategy, Confidence, Days, Action
3. Verify default shows "Last 14 Days" data
4. Click "All" toggle → verify more rows appear (if applicable)
5. Click "Last 14 Days" toggle → verify filters back to 14-day window
6. Verify rows are sorted by call date descending (newest first)

## Test Group 3: Advisor Hint Quality

1. Spot-check several rows:
   - Granola rows should show external attendee names (not Savvy employees)
   - Kixie rows should show prospect name or email
   - If both attendees and invitee_emails are internal-only, title should appear

## Test Group 4: Review Action

1. Click "Review" link on any row
2. Verify navigation to `/dashboard/call-intelligence/review/[callNoteId]`
3. Verify the NoteReviewClient SFDC search interface loads
4. Click back or submit/reject → verify return to `?tab=coaching-usage` (not `?tab=queue`)

## Test Group 5: CSV Export

1. Click the export/download button
2. Verify CSV downloads with correct columns and data
3. Verify no data corruption (advisor hints with commas, special characters)

## Test Group 6: Coaching Usage Preservation

1. Navigate to Coaching Usage tab (as revops_admin)
2. Verify KPI strip and main table are completely unchanged
3. Verify data loads correctly — no regressions

---

# Troubleshooting Appendix

## Common Issues

### `getRepIdByEmail` returns null for admin users
Expected behavior. The `isPrivileged` check handles this — admins get all reps without needing a coaching DB rep record.

### SGM sees empty Needs Linking table
Most likely cause: SGM has no coachee linkage in `reps.manager_id` or `coaching_teams`. This is a data-setup issue. Verify with:
```sql
SELECT id, full_name, manager_id FROM reps WHERE is_active = true AND role = 'SGA';
```
If no SGAs have `manager_id` pointing to the SGM's rep record, the visibility function returns an empty set.

### Confidence tier shows "—" for most rows
Expected. Only ~87/224 pending call_notes have a corresponding `slack_review_messages` row with waterfall candidates. The confidence_tier column is display-only and NULL for rows without waterfall data.

### `invitee_emails` shows email instead of name
Expected fallback. When no non-internal attendee name is available, the cascade falls through to the email from `invitee_emails`, then to `title`. This is by design.

### Return navigation goes to queue tab
The `NoteReviewClient` fix (Phase 6) reads `returnTab` from search params. If the review link doesn't include `?returnTab=coaching-usage`, the fix won't help. Verify the link in `NeedsLinkingTab.tsx` includes the query param.

## Known Limitations

1. **SGM RBAC data gap**: SGMs have zero coachee linkage in the coaching DB today. The code is correct but will show an empty table until `reps.manager_id` or `coaching_observers` rows are populated for SGMs.

2. **Confidence tier coverage**: Only ~39% of pending rows have confidence_tier data (via `slack_review_messages` JOIN). The rest show "—". This is a data coverage issue in the waterfall pipeline, not a query bug.

3. **No real-time updates**: After an SGM reviews a call (submit/reject), the row remains in the Needs Linking list until the next fetch. No WebSocket or polling. The user must manually refresh or toggle the date filter.

4. **`linkage_strategy` values are sparse**: Currently only 3 values exist in production (`manual_entry`, `kixie_task_link`, `crd_prefix`). `calendar_title` and `attendee_email` exist in the DB CHECK constraint but have zero rows. As the ingestion pipeline matures, more strategies may appear.

---

# Refinement Log

## Bucket 1 — Applied Autonomously

| # | Change | Reviewer | Rationale |
|---|---|---|---|
| C1 | Replaced LEFT JOIN slack_review_messages with LATERAL subquery + LIMIT 1 | Gemini | Prevents row duplication if multiple slack_review_messages exist per call_note |
| C2 | Added `CASE WHEN jsonb_typeof(cn.attendees) = 'array'` guard around `jsonb_array_elements` | Gemini | Prevents fatal PG error if attendees JSONB is not an array |
| S1 | Added `AND (cn.source = 'kixie' OR cn.likely_call_type = 'advisor_call')` to WHERE clause | Codex | Matches coaching-usage scope — prevents internal/practice calls from appearing |
| S2 | Added `VALID_RETURN_TABS` allowlist for returnTab validation in NoteReviewClient | Codex | Prevents broken navigation from invalid search param values |
| S4 | Added `noreply@`, `reply@`, `invites@` prefix exclusions to advisor hint extraction | Gemini | Prevents calendar tool artifacts from appearing as advisor hints |
| S5 | Added `STRATEGY_LABELS` mapping and `strategyLabel()` helper in component | Gemini | Human-friendly labels in table and CSV export (e.g., "Kixie Task" instead of "kixie_task_link") |

## Human Decisions Applied

| # | Question | Decision | Rationale |
|---|---|---|---|
| Q1 | Sub-tab vs top-level tab | **Sub-tab of Coaching Usage** | Created CoachingUsageWrapper with Overview/Needs Linking sub-tabs. Widened Coaching Usage visibility to SGMs/managers. CoachingUsageTab unchanged. |
| Q2 | SGM self-inclusion | **Yes, include self** | Union actor's own rep ID in API route. SGMs see both their own and coachees' unlinked calls. |
| Q3 | Advisor-call filter | **Advisor calls only** | Matches Coaching Usage scope. Already applied in S1. |

## Bucket 3 — Noted, Not Applied

| # | Item | Reviewer | Reason Deferred |
|---|---|---|---|
| I2 | Centralize VALID_TABS in shared constant | Codex | Good idea but scope expansion — fix in a separate cleanup PR |
| I3 | Business days vs calendar days for days_since_call | Gemini | Calendar days match existing patterns; business days add complexity for v1 |
| S3 | NoteReviewPage error fallback also hardcodes queue | Codex | Edge case (page load failure) — address in follow-up |
| G1 | Exclude manual_entry from query | Gemini | DISMISSED — data verifier confirms manual_entry+pending rows (192) are genuinely unresolved (sfdc_record_id=0) |
