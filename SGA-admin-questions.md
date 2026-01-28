# SGA Admin Implementation - Cursor.ai Discovery & Refinement Questions

## Purpose
This document contains phased questions for Cursor.ai to answer using its codebase understanding and BigQuery MCP access. After each phase, Cursor.ai should update `C:\Users\russe\Documents\Dashboard\sga-admin-implementation.md` to reflect the findings and align with the actual requirements.

---

## KEY REQUIREMENTS SUMMARY (From Stakeholder Clarification)

### Re-Engagement & Closed Lost Tabs (Admin View)
- **Admins should ONLY see "All Records"** - no "My Records" toggle needed for admin/manager role
- **"My Records" toggle is ONLY for regular SGA users**
- **New Filters Required** (applies to BOTH Closed Lost and Re-Engagement tabs):
  - SGA picklist (multi-select)
  - Days Since Closed Lost Bucket picklist
  - Close Lost Reason picklist
  - "Apply Filters" button

### Admin Quarterly Progress View
- **Two Goal Metrics to Display**:
  1. **"SGA Individual Goals"** = Aggregate SUM of all individual SGA quarterly goals
  2. **"SGA Manager Goal"** = Manager's own quarterly target (set independently)
- **Both should be visible** so manager can compare team progress against both targets
- **SGA Breakdown Table** should show each SGA's pacing status (ahead/on-track/behind) relative to their individual quarterly goals
- **Linear pacing logic is acceptable**

### Breakdown Table Features
- **Sortable** by multiple dimensions
- **Filterable** with picklists for:
  - SGAs (multi-select)
  - Pacing Status (ahead/on-track/behind)
- **Sort Options**:
  - By pacing (most behind → most ahead)
  - By SQO count (leaderboard style)
- **Same filters as Leaderboard tab** (channel, source, etc.) with identical defaults

### Relationship to Existing Pages
- **Complements** (not replaces) SGA Management page
- Focus on **beautiful, easy-to-read UI/UX**
- Purpose: **Goal tracking, accountability, and SGA coaching**

---

# PHASE 1: Closed Lost & Re-Engagement Tab Discovery

## Objective
Understand the current implementation and data structure for Closed Lost and Re-Engagement tabs to design the admin filter experience.

---

### Question 1.1: Current Toggle Implementation
**Task**: Review the current "My Records / All Records" toggle implementation in `ClosedLostTable.tsx` and `ClosedLostFollowUpTabs.tsx`.

**Questions to Answer**:
1. How does the current toggle determine if the user is admin/manager vs SGA?
2. What props control the toggle visibility?
3. How does the `showAllRecords` state flow from `SGAHubContent.tsx` to the table components?

**Action**: Document the current flow and identify what needs to change so that:
- Admins ALWAYS see "All Records" (no toggle)
- SGAs see the "My Records / All Records" toggle

---

### Question 1.2: Closed Lost Data Structure
**Task**: Review the Closed Lost query and BigQuery view to understand filter field sources.

**KNOWN INFORMATION - Days Since Closed Lost Buckets**:
> ⚠️ **Important**: The "Days Since Closed Lost" buckets are **NOT BigQuery fields** — they are calculated in the dashboard codebase.

**Location**: `src/lib/queries/closed-lost.ts` (lines 128-138)

**Calculation**: Computed via SQL CASE statement using `closed_lost_date` from BigQuery:
```sql
CASE
  WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 180 THEN '6+ months since closed lost'
  WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 150 THEN '5 months since closed lost'
  WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 120 THEN '4 months since closed lost'
  WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 90 THEN '3 months since closed lost'
  WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 60 THEN '2 months since closed lost'
  WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 30 THEN '1 month since closed lost'
  WHEN DATE_DIFF(CURRENT_DATE(), CAST(cl.closed_lost_date AS DATE), DAY) >= 0 THEN '< 1 month since closed lost'
  ELSE NULL
END as time_since_closed_lost_bucket
```

**Bucket Values** (for filter picklist):
- `< 1 month since closed lost` (0-29 days)
- `1 month since closed lost` (30-59 days)
- `2 months since closed lost` (60-89 days)
- `3 months since closed lost` (90-119 days)
- `4 months since closed lost` (120-149 days)
- `5 months since closed lost` (150-179 days)
- `6+ months since closed lost` (180+ days)

**Result Field**: `time_since_closed_lost_bucket` in query results, used in `ClosedLostTable.tsx`

**Questions to Answer** (for remaining fields):
1. What is the exact field name for "Close Lost Reason" in the BigQuery view `vw_sga_closed_lost_sql_followup`?
2. What are the distinct values for Close Lost Reason? (Use BigQuery MCP to query)
3. What field is used for SGA name filtering? (likely `sga_name`)

**BigQuery Query to Run** (for Close Lost Reason only):
```sql
-- Get distinct Close Lost Reason values
SELECT DISTINCT closed_lost_reason_or_equivalent_field
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`
WHERE closed_lost_reason_or_equivalent_field IS NOT NULL
ORDER BY 1;
```

**Action**: 
1. ✅ Days Bucket filter values are already known (use hardcoded list above)
2. Query BigQuery for Close Lost Reason distinct values
3. Confirm SGA name field for filtering

---

### Question 1.3: Re-Engagement Data Structure
**Task**: Review `src/lib/queries/re-engagement.ts` and the Re-Engagement API route.

**Questions to Answer**:
1. What table/view does Re-Engagement data come from?
2. Does Re-Engagement have a "Days Since" concept, or is it different (e.g., days since opportunity created)?
3. What fields are available for filtering Re-Engagement records?
4. Is there a "Close Lost Reason" equivalent for Re-Engagement, or does it inherit from the original Closed Lost record?

**Action**: Document the Re-Engagement data structure and identify which filters make sense for this tab specifically.

---

### Question 1.4: Filter Component Pattern
**Task**: Review the existing Leaderboard filter implementation in `src/components/sga-hub/LeaderboardTab.tsx` or similar.

**Questions to Answer**:
1. How are the channel/source filters implemented (component, state management)?
2. Is there a reusable filter component, or is it inline?
3. How does "Apply Filters" work - does it trigger an API call or filter client-side?

**Action**: Determine if we should create a shared `<SGAHubFilters>` component or extend the existing pattern.

---

## PHASE 1 DELIVERABLE

After answering the above questions, **UPDATE** `sga-admin-implementation.md`:

1. **Revise Phase 1** to remove the "My Records / All Records" toggle for admins
2. **Add new steps** for implementing the filter picklists:
   - SGA picklist (query active SGAs from Prisma User table)
   - Days Bucket picklist (✅ values already known - use hardcoded list from Question 1.2)
   - Close Lost Reason picklist (from BigQuery query results)
3. **Document the Close Lost Reason field name and values** from BigQuery
4. **Specify the filter component approach** (shared vs inline)
5. **Note**: Days Bucket is calculated at query time in `src/lib/queries/closed-lost.ts`, so filtering should happen at the SQL level or client-side post-fetch

**Report Back**: 
- Summarize findings for each question
- List the specific changes made to the implementation document
- Confirm ready to proceed to Phase 2

---

# PHASE 2: Admin Quarterly Progress - Goal Structure Discovery

## Objective
Understand the current quarterly goal data model and determine how to support both "SGA Individual Goals (Aggregate)" and "SGA Manager Goal" as separate metrics.

---

### Question 2.1: Current Quarterly Goal Schema
**Task**: Review the Prisma schema for `QuarterlyGoal` in `prisma/schema.prisma`.

**Questions to Answer**:
1. What is the current schema for quarterly goals?
2. Is there a distinction between "SGA goal" and "Manager goal" currently?
3. How is `userEmail` used - does it store the SGA's email or the goal-setter's email?

**Action**: Document the current schema and propose changes if needed to support:
- Individual SGA goals (one per SGA per quarter)
- Manager/Team goal (one per quarter, set by manager)

---

### Question 2.2: Goal Setting Flow
**Task**: Review `src/app/api/sga-hub/quarterly-goals/route.ts` and any related goal-setting UI.

**Questions to Answer**:
1. Who can currently set quarterly goals? (SGA for themselves? Admin for anyone?)
2. Is there a bulk goal editor for admins?
3. How would we distinguish between:
   - An SGA setting their own goal
   - A manager setting the "team goal" (manager's target)

**Action**: Determine if we need a new database table (e.g., `TeamQuarterlyGoal`) or if we can use a convention (e.g., manager's email + special flag).

---

### Question 2.3: Aggregating Individual Goals
**Task**: Determine how to calculate "SGA Individual Goals (Aggregate)".

**Questions to Answer**:
1. Should this be calculated on-the-fly (sum of all SGA goals for the quarter)?
2. Or should it be stored as a computed/cached value?
3. What happens if an SGA doesn't have a goal set - do they contribute 0 to the aggregate?

**Action**: Document the calculation approach and any edge cases.

---

### Question 2.4: Manager Goal Storage
**Task**: Design the storage approach for the "SGA Manager Goal".

**Questions to Answer**:
1. Should this be a new table `ManagerQuarterlyGoal` with fields like:
   - `quarter` (string, e.g., "2026-Q1")
   - `sqoGoal` (int)
   - `createdBy` / `updatedBy` (manager email)
2. Or should it be stored in the existing `QuarterlyGoal` table with a special `userEmail` value (e.g., "TEAM" or manager's email)?
3. Can there be multiple managers, or is there one "SGA Manager" role?

**Action**: Propose the schema change and document it for the implementation plan.

---

## PHASE 2 DELIVERABLE

After answering the above questions, **UPDATE** `sga-admin-implementation.md`:

1. **Add/Revise schema changes** for supporting both goal types
2. **Add API endpoint** for setting/getting the Manager Goal (separate from individual goals)
3. **Document the aggregation logic** for "SGA Individual Goals"
4. **Update the UI mockup** to show both metrics clearly

**Report Back**:
- Summarize the goal structure decision
- List schema changes required
- Confirm ready to proceed to Phase 3

---

# PHASE 3: Admin Quarterly Progress - UI Component Discovery

## Objective
Design the Admin Quarterly Progress view UI with the correct metrics, breakdown table, and filter capabilities.

---

### Question 3.1: Progress Card Design
**Task**: Design the "Team Progress Card" that shows both goal metrics.

**Questions to Answer**:
1. What should the card layout be? Suggested structure:
   ```
   ┌─────────────────────────────────────────────────────────┐
   │  TEAM QUARTERLY PROGRESS - Q1 2026                     │
   ├─────────────────────────────────────────────────────────┤
   │  Current SQOs: 47                                      │
   │                                                        │
   │  vs. SGA Individual Goals (Aggregate): 60   [78% | ▲]  │
   │  vs. SGA Manager Goal: 55                   [85% | ▲]  │
   │                                                        │
   │  Pacing: 12 days elapsed / 90 days in quarter          │
   │  Expected SQOs (linear): 8                             │
   │  Status: AHEAD (+39)                                   │
   └─────────────────────────────────────────────────────────┘
   ```
2. Should pacing be calculated against Manager Goal, Aggregate Goal, or both?
3. What visual indicators should show ahead/on-track/behind?

**Action**: Finalize the card design and add to implementation document.

---

### Question 3.2: SGA Breakdown Table Columns
**Task**: Define the columns for the SGA Breakdown Table.

**Proposed Columns**:
| Column | Description | Sortable? |
|--------|-------------|-----------|
| SGA Name | Name of the SGA | Yes (A-Z) |
| SQO Count | Current quarter SQOs | Yes (High-Low) |
| Individual Goal | Their quarterly goal (or "-" if not set) | Yes |
| Progress % | SQO Count / Individual Goal * 100 | Yes |
| Pacing Status | Ahead / On-Track / Behind / No Goal | Yes |
| Pacing Diff | +X or -X from expected | Yes |

**Questions to Answer**:
1. Is this the right set of columns?
2. Should we include AUM totals?
3. Should clicking the SQO Count open the drill-down modal (like Leaderboard)?

**Action**: Finalize column definitions and add to implementation document.

---

### Question 3.3: Filter Panel Design
**Task**: Design the filter panel that matches Leaderboard defaults.

**Questions to Answer**:
1. What are the exact Leaderboard default filters? Review `LeaderboardTab.tsx` or `LeaderboardFilters` type.
2. The filters needed:
   - Year (dropdown)
   - Quarter (dropdown) 
   - SGAs (multi-select picklist)
   - Channels (multi-select, default: "Outbound" + "Outbound + Marketing")
   - Sources (multi-select, default: all)
   - Pacing Status (multi-select: Ahead, On-Track, Behind, No Goal)
3. Should there be a "Reset to Defaults" button?

**Action**: Document the exact filter configuration with defaults.

---

### Question 3.4: Sorting Implementation
**Task**: Define the sorting options for the breakdown table.

**Questions to Answer**:
1. What should the default sort be? (Suggestion: Pacing Status ascending = worst first)
2. Should sorting be single-column or multi-column?
3. How should "No Goal" SGAs be sorted relative to others?

**Action**: Document sorting logic and defaults.

---

## PHASE 3 DELIVERABLE

After answering the above questions, **UPDATE** `sga-admin-implementation.md`:

1. **Add detailed UI mockups** (ASCII or description) for:
   - Team Progress Card with both goal metrics
   - SGA Breakdown Table with all columns
   - Filter Panel with all options
2. **Document sorting behavior** and defaults
3. **Specify drill-down behavior** for SQO counts

**Report Back**:
- Summarize UI decisions
- Confirm component structure
- Confirm ready to proceed to Phase 4

---

# PHASE 4: API & Query Discovery

## Objective
Design the API endpoints and BigQuery queries needed to support the Admin Quarterly Progress view.

---

### Question 4.1: Existing Leaderboard Query
**Task**: Review `src/lib/queries/sga-leaderboard.ts` to understand how SQO aggregation by SGA is done.

**Questions to Answer**:
1. What is the exact query for getting SQO counts by SGA?
2. How does it handle channel/source filtering?
3. Can this query be reused/extended for the Admin Progress view?

**Action**: Document the query pattern and identify reuse opportunities.

---

### Question 4.2: New API Endpoint Design
**Task**: Design the API endpoint for Admin Quarterly Progress.

**Proposed Endpoint**: `GET /api/sga-hub/admin-quarterly-progress`

**Query Parameters**:
- `quarter` (string, e.g., "2026-Q1")
- `channels` (comma-separated, optional)
- `sources` (comma-separated, optional)
- `sgaNames` (comma-separated, optional - for filtering breakdown)

**Response Shape**:
```typescript
interface AdminQuarterlyProgressResponse {
  quarter: string;
  quarterLabel: string;
  
  // Aggregate metrics
  teamSQOCount: number;
  teamTotalAum: number;
  
  // Goals
  sgaIndividualGoalsAggregate: number; // Sum of all SGA goals
  sgaManagerGoal: number | null;       // Manager's goal
  
  // Pacing (against Manager Goal)
  daysInQuarter: number;
  daysElapsed: number;
  expectedSQOs: number;
  pacingDiff: number;
  pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal';
  
  // SGA Breakdown
  sgaBreakdown: Array<{
    sgaName: string;
    sgaEmail: string;
    sqoCount: number;
    totalAum: number;
    individualGoal: number | null;
    progressPercent: number | null;
    expectedSQOs: number;
    pacingDiff: number;
    pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal';
  }>;
}
```

**Questions to Answer**:
1. Is this response shape correct?
2. Should pacing be calculated server-side or client-side?
3. How do we handle channel/source filters - do they affect goal display or just SQO counts?

**Action**: Finalize the API contract and add to implementation document.

---

### Question 4.3: Manager Goal API
**Task**: Design the API for setting/getting the Manager Goal.

**Endpoints**:
- `GET /api/admin/manager-quarterly-goal?quarter=2026-Q1`
- `POST /api/admin/manager-quarterly-goal` with body `{ quarter, sqoGoal }`

**Questions to Answer**:
1. Should only admin/manager roles be able to set this?
2. Should there be a history of goal changes (audit log)?
3. Is one Manager Goal per quarter sufficient, or could there be multiple managers with different goals?

**Action**: Document the API endpoints and add to implementation document.

---

## PHASE 4 DELIVERABLE

After answering the above questions, **UPDATE** `sga-admin-implementation.md`:

1. **Add complete API specifications** for:
   - Admin Quarterly Progress endpoint
   - Manager Goal endpoints
2. **Add TypeScript interfaces** for request/response types
3. **Document query reuse strategy** from Leaderboard

**Report Back**:
- Summarize API design decisions
- List any new database migrations needed
- Confirm ready to proceed to Phase 5

---

# PHASE 5: Integration & Conditional Rendering

## Objective
Ensure the Admin Quarterly Progress view integrates correctly with existing SGAHubContent and that regular SGA users see NO changes.

---

### Question 5.1: Tab Structure
**Task**: Review current tab structure in `SGAHubContent.tsx`.

**Questions to Answer**:
1. What is the current tab order?
2. Should Admin Quarterly Progress be a new tab or a conditional view within the existing "Quarterly Progress" tab?
3. How do we ensure SGAs see the original Quarterly Progress view unchanged?

**Recommendation**: Within "Quarterly Progress" tab:
- If user is `admin` or `manager`: Show Admin Quarterly Progress view
- If user is `sga`: Show existing individual Quarterly Progress view

**Action**: Document the conditional rendering approach.

---

### Question 5.2: Permissions Check
**Task**: Review how role is determined in `SGAHubContent.tsx`.

**Questions to Answer**:
1. How is `permissions.role` passed to SGAHubContent?
2. Is there a `usePermissions()` hook or is it passed as props?
3. How do other admin-only features (like the Closed Lost toggle) check permissions?

**Action**: Document the permission check pattern to use consistently.

---

### Question 5.3: State Management
**Task**: Determine state management approach for Admin view filters.

**Questions to Answer**:
1. Should admin filter state be separate from SGA filter state?
2. How should filter state persist across tab switches?
3. Should URL query params be used for shareable filter states?

**Action**: Document state management approach.

---

## PHASE 5 DELIVERABLE

After answering the above questions, **UPDATE** `sga-admin-implementation.md`:

1. **Add conditional rendering logic** for the Quarterly Progress tab
2. **Document permission checking pattern**
3. **Specify state management approach**
4. **Add explicit test case**: "Verify SGA user sees NO changes to Quarterly Progress tab"

**Report Back**:
- Summarize integration approach
- Confirm SGA experience is unchanged
- Confirm ready to proceed to Phase 6

---

# PHASE 6: Final Implementation Document Review

## Objective
Review the updated implementation document for completeness and correctness.

---

### Question 6.1: Completeness Check
**Task**: Review the updated `sga-admin-implementation.md` against the requirements.

**Checklist**:
- [ ] Closed Lost tab: Admins see all records (no toggle), with SGA/Bucket/Reason filters
- [ ] Re-Engagement tab: Admins see all records (no toggle), with appropriate filters
- [ ] Admin Quarterly Progress: Shows both "SGA Individual Goals (Aggregate)" and "SGA Manager Goal"
- [ ] SGA Breakdown Table: Sortable, filterable, shows pacing status per SGA
- [ ] Filters match Leaderboard defaults (channel, source)
- [ ] SGA users see NO changes to their experience
- [ ] All API endpoints documented
- [ ] All TypeScript types documented
- [ ] All database schema changes documented

**Action**: Mark off each item and note any gaps.

---

### Question 6.2: Implementation Order
**Task**: Verify the phase order makes sense for incremental development.

**Suggested Order**:
1. Database schema changes (if any)
2. API endpoints
3. UI components
4. Integration into SGAHubContent
5. Testing

**Questions to Answer**:
1. Are there any dependencies that require reordering?
2. Can any phases be parallelized?

**Action**: Finalize phase order in implementation document.

---

### Question 6.3: Edge Cases
**Task**: Document edge cases and how to handle them.

**Edge Cases to Consider**:
1. No SGAs have individual goals set → Aggregate = 0
2. Manager Goal not set → Show "Set Goal" prompt
3. SGA has 0 SQOs → Show 0, not blank
4. Quarter hasn't started yet → Pacing = "Not Started" or 0%
5. Quarter is complete → Pacing should show final status, not "in progress"

**Action**: Add edge case handling to implementation document.

---

## PHASE 6 DELIVERABLE

**Final UPDATE** to `sga-admin-implementation.md`:

1. Ensure all requirements are addressed
2. Add edge case handling section
3. Add final testing checklist that covers all requirements
4. Mark document as "READY FOR IMPLEMENTATION"

**Report Back**:
- Confirm document is complete
- List any remaining open questions for stakeholder
- Provide summary of all changes made to the document

---

# APPENDIX: Quick Reference

## File Locations (Codebase)
- `src/app/dashboard/sga-hub/SGAHubContent.tsx` - Main SGA Hub page component
- `src/components/sga-hub/ClosedLostFollowUpTabs.tsx` - Closed Lost / Re-Engagement tabs
- `src/components/sga-hub/ClosedLostTable.tsx` - Closed Lost table with toggle
- `src/components/sga-hub/ReEngagementOpportunitiesTable.tsx` - Re-Engagement table
- `src/components/sga-hub/LeaderboardTab.tsx` - Leaderboard with filters (reference)
- `src/lib/queries/sga-leaderboard.ts` - Leaderboard query (reference)
- `src/lib/queries/closed-lost.ts` - Closed Lost query
- `src/lib/queries/re-engagement.ts` - Re-Engagement query
- `src/lib/queries/quarterly-progress.ts` - Quarterly progress query
- `src/app/api/sga-hub/quarterly-progress/route.ts` - Quarterly progress API
- `src/app/api/sga-hub/quarterly-goals/route.ts` - Quarterly goals API
- `prisma/schema.prisma` - Database schema

## BigQuery Tables/Views
- `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` - Main funnel view
- `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup` - Closed Lost view
- `savvy-gtm-analytics.SavvyGTMData.User` - User table for SGA name resolution

## Known Values (Pre-Discovered)

### Days Since Closed Lost Bucket Values
> **Source**: Calculated in `src/lib/queries/closed-lost.ts` (lines 128-138), NOT a BigQuery field
> **Field Name**: `time_since_closed_lost_bucket`

| Bucket Label | Days Range |
|-------------|------------|
| `< 1 month since closed lost` | 0-29 days |
| `1 month since closed lost` | 30-59 days |
| `2 months since closed lost` | 60-89 days |
| `3 months since closed lost` | 90-119 days |
| `4 months since closed lost` | 120-149 days |
| `5 months since closed lost` | 150-179 days |
| `6+ months since closed lost` | 180+ days |

**Note**: These buckets are computed at query time using `closed_lost_date` from BigQuery. They update automatically as time passes.

## Implementation Document Location
- `C:\Users\russe\Documents\Dashboard\sga-admin-implementation.md`

---

## Instructions for Cursor.ai

1. **Work through each phase sequentially**
2. **Answer all questions** using codebase search and BigQuery MCP as needed
3. **After each phase**, update the implementation document with findings
4. **Report back** with a summary before proceeding to the next phase
5. **Ask for clarification** if any requirement is ambiguous
6. **Do not skip phases** - each builds on the previous

**Start with**: "Beginning Phase 1: Closed Lost & Re-Engagement Tab Discovery. I'll review the current toggle implementation first."
