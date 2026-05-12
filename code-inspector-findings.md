# Code Inspector Findings -- Needs Linking Sub-Tab for Coaching Usage

Feature: Add Needs Linking sub-tab to /dashboard/call-intelligence
Date: 2026-05-12

---

## CRITICAL SCHEMA FINDING -- confidence_tier is NOT a call_notes column

The feature spec references confidence_tier IN (possible, unlikely) and
linkage_strategy IN (calendar_title, lead_contact_name, summary_name, manual_entry).
Three problems with this definition:

Problem 1 -- confidence_tier does not exist on call_notes.
It only exists inside slack_review_messages.sfdc_suggestion JSONB
as a per-candidate field on the waterfall candidates array.
Source A: sales-coaching/src/lib/db/types.ts -- no confidence_tier on CallNote interface.
Source B: src/lib/sales-coaching-client/schemas.ts:828 -- confidence_tier is on
BridgeSfdcCandidateSchema inside the suggestion JSONB, not on call_notes.

Problem 2 -- lead_contact_name and summary_name are not valid linkage_strategy values.
Valid enum: crd_prefix | attendee_email | calendar_title | manual_entry | kixie_task_link.
Source: migrations/001_initial_schema.sql:133-134 and 009_extend_call_notes_for_kixie.sql:106-113.

Problem 3 -- manual_entry rows ARE already resolved. They must be EXCLUDED.
linkage_strategy=manual_entry means the rep manually selected an SFDC record.
sfdc_record_id is always set in that write (setCallNoteSfdcLink DAL).
Source: sales-coaching/src/lib/db/call-notes.ts:1304-1342 (setCallNoteSfdcLink).
Source: src/app/dashboard/call-intelligence/review/[callNoteId]/NoteReviewClient.tsx:200
confirms Dashboard writes linkage_strategy=manual_entry on rep pick.

Corrected orphan predicate (schema-accurate):

    WHERE cn.source_deleted_at IS NULL
      AND cn.status = pending
      AND cn.linkage_strategy IN (crd_prefix, attendee_email, calendar_title)

kixie_task_link and manual_entry are excluded by the IN clause.
If confidence_tier filtering is required, query must LEFT JOIN slack_review_messages
and extract candidates[0].confidence_tier from JSONB -- non-trivial, requires SME input.

---

## Pre-Existing Code Discrepancy (not introduced by this feature)

File: C:/Users/russe/Documents/Dashboard/src/app/dashboard/call-intelligence/page.tsx:12

page.tsx VALID_TABS is missing cost-analysis:
  [queue, settings, admin-users, admin-refinements, rubrics, coaching-usage, insights]

But CallIntelligenceClient.tsx:22 has 8 tabs including cost-analysis, and
call-intelligence.ts:210-218 defines 8 variants in CallIntelligenceTab.
Deep-linking to ?tab=cost-analysis silently falls back to queue.
Fix both arrays together when adding needs-linking.

---

## 1. TypeScript Types That Need Changes

### 1a. CallIntelligenceTab union

File: C:/Users/russe/Documents/Dashboard/src/types/call-intelligence.ts:210-218
Add: | needs-linking

Construction sites and consumers (exhaustive):

  src/types/call-intelligence.ts:210
    -- Type definition, add needs-linking variant

  src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx:22
    -- VALID_TABS array, add needs-linking

  src/app/dashboard/call-intelligence/page.tsx:12
    -- VALID_TABS array, add cost-analysis (bug fix) AND needs-linking

### 1b. New NeedsLinkingRow interface (net-new; no existing construction sites)

Define in src/types/call-intelligence.ts or in the new query file.

Required fields:
  callNoteId: string
  callDate: string
  source: granola | kixie
  advisorHint: string | null  -- best-available: attendees JSONB / invitee_emails / title
  repName: string | null
  managerName: string | null
  linkageStrategy: string  -- the call_notes.linkage_strategy column value
  daysSinceCall: number  -- floor(EXTRACT(EPOCH FROM NOW() - call_started_at) / 86400)
  confidenceTier?: string | null  -- OPTIONAL; requires JSONB extraction if included

No existing construction sites. Net-new interface.

---

## 2. New Query Function Needed

New file: C:/Users/russe/Documents/Dashboard/src/lib/queries/call-intelligence/needs-linking.ts

Pattern: direct-pg from src/app/api/admin/coaching-usage/route.ts
+ RBAC scoping from src/lib/queries/call-intelligence/dimension-heatmap.ts.

Key design:
  - Uses getCoachingPool() from src/lib/coachingDb.ts
  - Joins: call_notes cn, reps sga ON cn.rep_id, reps mgr ON sga.manager_id
  - LEFT JOIN slack_review_messages srm ON srm.call_note_id=cn.id AND srm.surface=dm
    (only if confidence_tier extraction is needed)
  - Date filter: parameterized (14d default; no lower bound for all)
  - RBAC: WHERE cn.rep_id = ANY($N::uuid[]) with repIds from getRepIdsVisibleToActor()
  - Sort: call_started_at DESC
  - No BigQuery round-trip -- advisor hint uses local columns only

Advisor hint cascade (direct call_notes columns only):
  1. cn.attendees JSONB {name,email} -- first non-savvy name
  2. cn.invitee_emails TEXT[] -- first non-savvy email
  3. cn.calendar_title TEXT
  4. cn.title TEXT

Savvy-internal filter: @savvywealth.com, @savvyadvisors.com
(same as isSavvyInternal in coaching-usage/route.ts:33-37).

---

## 3. New API Route Needed

New file: C:/Users/russe/Documents/Dashboard/src/app/api/call-intelligence/needs-linking/route.ts

NOT under src/app/api/admin/ -- SGMs access it.

  GET /api/call-intelligence/needs-linking?range=14d|all

Auth pattern mirrors src/app/api/call-intelligence/insights/heatmap/route.ts:37-110:

  1. getServerSession + getSessionPermissions
  2. allowedPages.includes(20) gate
  3. Role gate: [manager, admin, revops_admin, sgm]
     (widens from revops_admin-only coaching-usage route)
  4. getRepIdByEmail(session.user.email) -> actorRepId (fail-open for privileged)
  5. getRepIdsVisibleToActor({repId, role, email}) -> visibleRepIds
  6. Call needs-linking query with visibleRepIds

Caching: Do NOT reuse CACHE_TAGS.COACHING_USAGE.
Coaching-usage cache entries are revops_admin-only; mixing exposes cross-role data.
Either no caching or a new CACHE_TAGS.NEEDS_LINKING tag in src/lib/cache.ts.

---

## 4. New Components Needed

### NeedsLinkingTab

New file: C:/Users/russe/Documents/Dashboard/src/app/dashboard/call-intelligence/tabs/NeedsLinkingTab.tsx

Pattern: CoachingUsageTab.tsx (range toggle, fetch effect, table render).

Differences from CoachingUsageTab:
  - No KPI strip
  - No complex filter set (no tri-state controls, no stage filter)
  - Table: call date, source, advisor hint, rep, manager, linkage_strategy, days since call, action
  - Row action: router.push to /dashboard/call-intelligence/review/[callNoteId]
  - Default range: 14d (not 30d)
  - No advisorEmailExtras complexity -- hint only
  - No sort dropdown -- fixed call_started_at DESC from server

Fetches from: /api/call-intelligence/needs-linking?range=14d|all

### No changes to CallDetailModal.tsx

CallDetailRowSummary at src/components/call-intelligence/CallDetailModal.tsx:13-33
does NOT need changes. Needs Linking rows navigate to review page, not the modal.

---

## 5. Changes to CallIntelligenceClient.tsx

File: C:/Users/russe/Documents/Dashboard/src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx

  1. Add import NeedsLinkingTab from ./tabs/NeedsLinkingTab
  2. Line 22: add needs-linking to VALID_TABS
  3. Add tab button -- visibility: isManagerOrAdmin || role === sgm
  4. Add render branch:
     {(isManagerOrAdmin || role===sgm) && activeTab===needs-linking && <NeedsLinkingTab/>}
  5. safeInitial fallback (lines 28-33): no changes -- falls back gracefully

Suggested icon: Link from lucide-react.

---

## 6. Changes to page.tsx

File: C:/Users/russe/Documents/Dashboard/src/app/dashboard/call-intelligence/page.tsx:12

Replace (current -- missing cost-analysis):
  [queue,settings,admin-users,admin-refinements,rubrics,coaching-usage,insights]

With (fix bug + add needs-linking):
  [queue,settings,admin-users,admin-refinements,rubrics,
   coaching-usage,insights,cost-analysis,needs-linking]

---

## 7. Existing Coaching Usage View -- ZERO CHANGES

Must remain byte-for-byte unchanged:
  C:/Users/russe/Documents/Dashboard/src/app/api/admin/coaching-usage/route.ts
  C:/Users/russe/Documents/Dashboard/src/app/dashboard/call-intelligence/tabs/CoachingUsageTab.tsx

New tab is fully independent. CoachingUsageClient render guarded by
isRevopsAdmin && activeTab===coaching-usage. Adding a new branch does not touch it.

---

## 8. Export Paths -- No Changes Required

ExportButton (src/components/dashboard/ExportButton.tsx): Object.keys() -- not applicable.
ExportMenu (src/components/dashboard/ExportMenu.tsx): Explicit columns -- not applicable.
MetricDrillDownModal (src/components/sga-hub/MetricDrillDownModal.tsx): Not applicable.

Needs Linking is an action queue, not an export surface. No export path changes needed.

---

## 9. RBAC Summary

| Role         | Access | Scope                                    |
|--------------|--------|------------------------------------------|
| revops_admin | Yes    | All reps                                 |
| admin        | Yes    | All reps                                 |
| manager      | Yes    | Direct reports + pod members + observers |
| sgm          | Yes    | Direct reports + pod members             |
| sga          | No     | Tab reviews others calls                 |
| viewer       | No     | No page 20 access                        |

getRepIdsVisibleToActor() at src/lib/queries/call-intelligence/visible-reps.ts
handles all cases. No changes to that function needed.

RBAC pattern to copy from src/app/api/call-intelligence/insights/heatmap/route.ts:54-93:

  const isPrivileged = permissions.role===admin || permissions.role===revops_admin;
  const rep = await getRepIdByEmail(session.user.email);
  if (!rep && !isPrivileged) return 403;
  const actorRepId = rep?.id ?? empty-string;
  const visibleRepIds = await getRepIdsVisibleToActor({repId:actorRepId, role:permissions.role, email});
  // SQL: WHERE cn.rep_id = ANY($N::uuid[])

---

## 10. Full File Change List

MODIFY:
  src/types/call-intelligence.ts
    -- Add needs-linking to CallIntelligenceTab; add NeedsLinkingRow interface
  src/app/dashboard/call-intelligence/CallIntelligenceClient.tsx
    -- Import, VALID_TABS, tab button, render branch
  src/app/dashboard/call-intelligence/page.tsx
    -- Add cost-analysis (pre-existing bug fix) + needs-linking to VALID_TABS

CREATE:
  src/app/dashboard/call-intelligence/tabs/NeedsLinkingTab.tsx
  src/app/api/call-intelligence/needs-linking/route.ts
  src/lib/queries/call-intelligence/needs-linking.ts

NOT changed:
  src/app/api/admin/coaching-usage/route.ts
  src/app/dashboard/call-intelligence/tabs/CoachingUsageTab.tsx
  src/lib/coachingDb.ts
  src/lib/cache.ts  (add NEEDS_LINKING tag only if caching is wanted)
  src/components/call-intelligence/CallDetailModal.tsx
  src/lib/queries/call-intelligence/visible-reps.ts
  src/lib/permissions.ts

---

## 11. Advisor Hint -- Available call_notes Columns

All are direct call_notes columns (no BigQuery resolution needed):
  cn.attendees JSONB      -- {name,email} array, extract first non-savvy name
  cn.invitee_emails TEXT[] -- first non-savvy email fallback
  cn.calendar_title TEXT  -- event title, may contain advisor name
  cn.title TEXT           -- Granola note title

Savvy-internal filter: @savvywealth.com and @savvyadvisors.com
(same as isSavvyInternal in coaching-usage/route.ts:33-37).

---

## 12. manual_entry Validation -- Confirmed: EXCLUDE

Per sales-coaching/src/lib/db/call-notes.ts:1304-1342 (setCallNoteSfdcLink):
manual_entry always sets sfdc_record_id (required non-null argument). Confirmed-linked.

Per NoteReviewClient.tsx:200: Dashboard writes linkage_strategy=manual_entry on rep pick.

Conclusion: manual_entry rows are resolved, not orphaned.
The spec inclusion of manual_entry in the predicate is incorrect.

---

## 13. Open Questions for Implementation Team

Q1. Is confidence_tier extraction required?
    If yes: LEFT JOIN slack_review_messages + extract candidates[0].confidence_tier from JSONB.
    If no: use simpler linkage_strategy-only predicate.

Q2. Kixie edge cases.
    kixie_task_link excluded by IN clause. If a Kixie call has crd_prefix or
    attendee_email as linkage_strategy (edge case), it correctly appears.
    Confirm intended behavior with SME.

Q3. SGM access to /dashboard/call-intelligence/review/[callNoteId].
    NoteReviewPage calls salesCoachingClient.getCallNoteReview(email, callNoteId)
    which has RBAC inside the bridge. Verify bridge allows SGM-role users to access
    call notes in their visible-rep set (not only their own calls).
    If not, Open SFDC search will 404 for SGMs accessing a coachee call.
