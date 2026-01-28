# SGA Admin Implementation Document - Updates Summary

## Overview
This document summarizes all changes made to `sga-admin-implementation.md` based on the questions in `SGA-admin-questions.md`.

---

## Phase 1: Closed Lost & Re-Engagement Tab Filters

### Key Changes Made:

1. **Removed Toggle for Admins**: 
   - Admins ALWAYS see "All Records" (no toggle option)
   - Only regular SGA users see "My Records / All Records" toggle
   - Updated `ClosedLostTable` usage to conditionally pass `onToggleShowAll` prop

2. **Added Comprehensive Filters**:
   - **SGA Picklist** (multi-select) - Query active SGAs from Prisma User table
   - **Days Bucket Picklist** (multi-select) - Hardcoded list of 7 bucket values
   - **Close Lost Reason Picklist** (multi-select) - Query from BigQuery view
   - **Apply Filters Button** - Reuses LeaderboardFilters pattern

3. **New Components Created**:
   - `ClosedLostFilters.tsx` - Filter component for Closed Lost tab
   - API endpoint `/api/sga-hub/closed-lost-reasons` - Fetch distinct Close Lost Reason values

4. **Query Updates**:
   - Updated `_getClosedLostRecords` to accept filter options
   - Days Bucket filtering at SQL level (more efficient)
   - SGA and Close Lost Reason filtering at SQL level

### Discovery Findings:

- **Close Lost Reason Field**: `closed_lost_reason` (lowercase) in view `vw_sga_closed_lost_sql_followup`
- **Days Bucket**: Calculated in SQL, NOT a BigQuery field
- **SGA Name Field**: `sga_name` in view
- **Toggle Logic**: Controlled by `onToggleShowAll` prop - only pass when user is NOT admin

---

## Phase 2: Database Schema - Manager Quarterly Goal

### Key Changes Made:

1. **Renamed Model**: Changed from `TeamQuarterlyGoal` to `ManagerQuarterlyGoal`
   - More accurate naming (manager's goal, not "team" goal)
   - One record per quarter (unique constraint on `quarter`)

2. **Schema Structure**:
   - Uses same quarter format as `QuarterlyGoal` ("2026-Q1" format)
   - Stores `createdBy` and `updatedBy` as email strings (not user IDs)

3. **Aggregation Logic**:
   - "SGA Individual Goals (Aggregate)" = Sum calculated on-the-fly
   - Query all `QuarterlyGoal` records for the quarter and sum `sqoGoal`
   - If SGA has no goal → contributes 0 to aggregate

### Discovery Findings:

- **Current QuarterlyGoal Model**: Stores individual SGA goals with `userEmail` = SGA's email
- **No Bulk Editor**: Goals set one at a time via API
- **Decision**: New table `ManagerQuarterlyGoal` (separate from individual goals)

---

## Phase 3: Manager Quarterly Goal API

### Key Changes Made:

1. **API Endpoint**: `/api/sga-hub/manager-quarterly-goal` (GET/POST)
   - GET: Fetch manager goal for quarter
   - POST: Set/update manager goal (admin/manager only)

2. **API Client Methods**:
   - `getManagerQuarterlyGoal(quarter: string)`
   - `setManagerQuarterlyGoal(quarter: string, sqoGoal: number)`

---

## Phase 4: Admin Quarterly Progress API

### Key Changes Made:

1. **Response Structure Updated**:
   - Added `sgaIndividualGoalsAggregate` field (sum of all SGA goals)
   - Added `sgaManagerGoal` field (manager's goal)
   - Both metrics returned in single API call

2. **Query Function**:
   - Reuses leaderboard query pattern for SQO aggregation
   - Fetches individual SGA goals and calculates aggregate
   - Fetches manager goal separately

3. **New File**: `src/lib/queries/admin-quarterly-progress.ts`

---

## Phase 5: Admin UI Components

### Key Changes Made:

1. **TeamProgressCard**:
   - Shows BOTH goal metrics side-by-side
   - Progress bars for both "vs. Aggregate" and "vs. Manager Goal"
   - Pacing calculated against Manager Goal (primary target)

2. **SGABreakdownTable**:
   - Added columns: Progress %, Pacing Diff
   - Sortable by all columns (default: Pacing Status ascending)
   - Filterable by SGA and Pacing Status
   - Shows individual SGA pacing status

3. **AdminQuarterlyFilters**:
   - Added Pacing Status filter (multi-select: Ahead, On-Track, Behind, No Goal)
   - Defaults match Leaderboard: Channels = ["Outbound", "Outbound + Marketing", "Re-Engagement"]

4. **TeamGoalEditor**:
   - Used for Manager Goal (not "team" goal)
   - Inline editable field with Save/Cancel buttons

---

## Phase 6: Integration

### Key Changes Made:

1. **Conditional Rendering**:
   - Quarterly Progress tab checks `isAdmin` flag
   - Admins see `AdminQuarterlyProgressView`
   - SGAs see existing quarterly progress view (UNCHANGED)

2. **Permission Check**:
   - Uses existing `isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager'`
   - Consistent with other admin features

3. **Drill-Down Integration**:
   - Reuses existing drill-down modal state
   - Passes admin filters (channels, sources) to drill-down query

---

## Phase 7: Testing & Verification

### Key Changes Made:

1. **Enhanced SGA User Verification**:
   - Explicit test case: "Verify SGA user sees NO changes"
   - Checklist includes all admin features that should NOT be visible

2. **Test Scenarios Updated**:
   - Test both goal metrics display
   - Test SGA breakdown table sorting and filtering
   - Test filter defaults match Leaderboard

---

## Critical Requirements Addressed

✅ **Admins ALWAYS see "All Records"** - No toggle for admins
✅ **SGAs see toggle** - "My Records / All Records" toggle for regular users
✅ **Two Goal Metrics** - Both "SGA Individual Goals (Aggregate)" and "SGA Manager Goal" displayed
✅ **SGA Breakdown Table** - Sortable, filterable, shows pacing per SGA
✅ **Filter Defaults** - Match Leaderboard defaults (channels, sources)
✅ **SGA Users Unchanged** - No changes to SGA user experience

---

## Files to Create/Modify

### New Files:
- `src/components/sga-hub/ClosedLostFilters.tsx`
- `src/components/sga-hub/TeamGoalEditor.tsx`
- `src/components/sga-hub/TeamProgressCard.tsx`
- `src/components/sga-hub/SGABreakdownTable.tsx`
- `src/components/sga-hub/AdminQuarterlyFilters.tsx`
- `src/components/sga-hub/AdminQuarterlyProgressView.tsx`
- `src/app/api/sga-hub/closed-lost-reasons/route.ts`
- `src/app/api/sga-hub/manager-quarterly-goal/route.ts`
- `src/app/api/sga-hub/admin-quarterly-progress/route.ts`
- `src/lib/queries/admin-quarterly-progress.ts`

### Modified Files:
- `src/types/sga-hub.ts` - Add types for filters, admin progress
- `src/lib/queries/closed-lost.ts` - Add filter parameters
- `src/lib/queries/re-engagement.ts` - Add showAll support
- `src/app/api/sga-hub/closed-lost/route.ts` - Add filter parameters
- `src/app/api/sga-hub/re-engagement/route.ts` - Add showAll parameter
- `src/components/sga-hub/ClosedLostTable.tsx` - Conditional toggle display
- `src/components/sga-hub/ReEngagementOpportunitiesTable.tsx` - Add SGA column
- `src/app/dashboard/sga-hub/SGAHubContent.tsx` - Conditional rendering, filter state
- `src/lib/api-client.ts` - Add new API methods
- `prisma/schema.prisma` - Add ManagerQuarterlyGoal model

---

## Implementation Status

**Document Updated**: ✅ Complete
**Ready for Implementation**: ✅ Yes
**All Questions Answered**: ✅ Yes
**Requirements Documented**: ✅ Yes
