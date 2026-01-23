# Pre-Implementation Updates - Verification & Validation Steps

**Purpose**: Add verification and validation checkpoints to each phase of the SGA Activity Dashboard implementation plan. This ensures issues are caught early, not at the end.

**Target File**: `C:\Users\russe\Documents\Dashboard\sga-activity-dashboard-implementation-plan.md`

---

## Instructions for Cursor.ai

Work through each prompt below sequentially. After completing each prompt:
1. Save the updated implementation plan
2. Confirm the changes were made
3. Move to the next prompt

---

## Prompt 1: Add Phase 0 Verification Section

Add the following section at the end of **Phase 0: Pre-Implementation Verification**:

```markdown
### 0.3 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify project compiles before any changes
npm run build

# Verify no existing lint errors
npm run lint

# Verify TypeScript has no errors
npx tsc --noEmit
```

**Expected Results**:
- [ ] Build succeeds (or document existing failures)
- [ ] Lint passes (or document existing warnings)
- [ ] TypeScript compiles without errors

**Document Baseline**: Record any pre-existing errors/warnings so we don't confuse them with new issues.

**User Validation Required**: None - this is baseline capture only.

**Gate**: Do NOT proceed to Phase 1 until baseline is documented.
```

---

## Prompt 2: Add Phase 1 Verification Section

Add the following section at the end of **Phase 1: Type Definitions**:

```markdown
### 1.3 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles with new types
npx tsc --noEmit

# Verify no lint errors in new file
npx eslint src/types/sga-activity.ts

# Verify the types file exists and has content
cat src/types/sga-activity.ts | head -50
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on `sga-activity.ts`
- [ ] File contains all expected interfaces (SGAActivityFilters, ScheduledCallsSummary, etc.)

**Type Export Verification**:
```bash
# Verify types can be imported (create temp test file)
echo "import { SGAActivityFilters, ScheduledCallsSummary, ActivityRecord } from '@/types/sga-activity';" > /tmp/type-test.ts
npx tsc /tmp/type-test.ts --noEmit --skipLibCheck --esModuleInterop --moduleResolution node
rm /tmp/type-test.ts
```

**User Validation Required**: None

**Gate**: Do NOT proceed to Phase 2 until all automated checks pass.

**Report to User**:
- List which checks passed
- List any errors encountered and how they were fixed
```

---

## Prompt 3: Add Phase 2 Verification Section

Add the following section at the end of **Phase 2: Query Functions**:

```markdown
### 2.2 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles with new queries
npx tsc --noEmit

# Verify no lint errors in new file
npx eslint src/lib/queries/sga-activity.ts

# Verify file structure
echo "=== Checking exports ===" 
grep "^export" src/lib/queries/sga-activity.ts

# Verify imports resolve
echo "=== Checking imports ==="
head -20 src/lib/queries/sga-activity.ts
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on `sga-activity.ts`
- [ ] All 10 query functions are exported
- [ ] All cached wrapper functions are exported
- [ ] Imports from `@/types/sga-activity` resolve correctly
- [ ] Imports from `@/lib/cache` resolve correctly
- [ ] Imports from `@/lib/bigquery` resolve correctly

**Query Function Checklist**:
- [ ] `getScheduledInitialCalls` exists
- [ ] `getScheduledQualificationCalls` exists
- [ ] `getScheduledCallRecords` exists
- [ ] `getActivityDistribution` exists
- [ ] `getSMSResponseRate` exists
- [ ] `getCallAnswerRate` exists
- [ ] `getActivityBreakdown` exists
- [ ] `getActivityRecords` exists
- [ ] `getActivityTotals` exists
- [ ] `getSGAActivityFilterOptions` exists

**User Validation Required**: 
- [ ] **OPTIONAL**: User can test a query directly in BigQuery console to verify SQL syntax

**BigQuery Test Query** (user can run in BQ console):
```sql
-- Quick test: Should return data if setup is correct
SELECT COUNT(*) as total_activities
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY);
```

**Gate**: Do NOT proceed to Phase 3 until all automated checks pass.

**Report to User**:
- List which checks passed
- Note: API routes in Phase 3 will do runtime testing of these queries
```

---

## Prompt 4: Add Phase 3 Verification Section

Add the following section at the end of **Phase 3: API Routes**:

```markdown
### 3.5 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles
npx tsc --noEmit

# Verify no lint errors in new API routes
npx eslint src/app/api/sga-activity/

# Verify all route files exist
ls -la src/app/api/sga-activity/
ls -la src/app/api/sga-activity/dashboard/
ls -la src/app/api/sga-activity/scheduled-calls/
ls -la src/app/api/sga-activity/activity-records/
ls -la src/app/api/sga-activity/filters/

# Verify route.ts files have correct exports
grep "export async function" src/app/api/sga-activity/*/route.ts
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on all API route files
- [ ] 4 route directories exist with route.ts files
- [ ] Each route exports POST or GET handler

**API Route Checklist**:
- [ ] `/api/sga-activity/dashboard/route.ts` - POST handler
- [ ] `/api/sga-activity/scheduled-calls/route.ts` - POST handler
- [ ] `/api/sga-activity/activity-records/route.ts` - POST handler
- [ ] `/api/sga-activity/filters/route.ts` - GET handler

**User Validation Required**: 
- [ ] **REQUIRED**: Start dev server and test API endpoints

**Dev Server Test Instructions**:
```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Test API endpoints (user runs these)
# Note: These require authentication, so test in browser console instead
```

**Browser Console Tests** (user runs in browser at localhost:3000 while logged in):
```javascript
// Test 1: Filters endpoint
fetch('/api/sga-activity/filters')
  .then(r => r.json())
  .then(data => console.log('Filters:', data))
  .catch(err => console.error('Filters Error:', err));

// Test 2: Dashboard endpoint (with minimal filters)
fetch('/api/sga-activity/dashboard', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filters: {
      sga: null,
      dateRangeType: 'this_week',
      startDate: null,
      endDate: null,
      comparisonDateRangeType: 'last_90',
      comparisonStartDate: null,
      comparisonEndDate: null,
      activityTypes: [],
      includeAutomated: false,
      callTypeFilter: 'all_outbound'
    }
  })
})
  .then(r => r.json())
  .then(data => console.log('Dashboard:', data))
  .catch(err => console.error('Dashboard Error:', err));
```

**Expected API Responses**:
- Filters: Returns `{ sgas: [...] }` array
- Dashboard: Returns object with `initialCalls`, `qualificationCalls`, `activityDistribution`, etc.

**Gate**: Do NOT proceed to Phase 4 until:
1. All automated checks pass
2. User confirms API endpoints return data (not errors)

**Report to User**:
- List which automated checks passed
- Provide the browser console test code
- Ask user to confirm API responses before proceeding
```

---

## Prompt 5: Add Phase 4 Verification Section

Add the following section at the end of **Phase 4: Components**:

```markdown
### 4.8 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles
npx tsc --noEmit

# Verify no lint errors in new components
npx eslint src/components/sga-activity/

# Verify all component files exist
ls -la src/components/sga-activity/

# Verify component exports
grep "export default" src/components/sga-activity/*.tsx
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on all component files
- [ ] 7 component files exist in `src/components/sga-activity/`

**Component Checklist**:
- [ ] `ActivityFilters.tsx` - Filter controls
- [ ] `ScheduledCallsCards.tsx` - Scheduled calls display
- [ ] `ActivityDistributionTable.tsx` - Distribution comparison table
- [ ] `RateCards.tsx` - SMS/Call rate cards
- [ ] `ActivityBreakdownCard.tsx` - Breakdown chart
- [ ] `ActivityTotalsCards.tsx` - Total scorecards
- [ ] `ActivityDrillDownModal.tsx` - Drill-down modal

**Import Verification**:
```bash
# Verify all imports resolve
for file in src/components/sga-activity/*.tsx; do
  echo "Checking: $file"
  npx tsc "$file" --noEmit --skipLibCheck 2>&1 | head -5
done
```

**User Validation Required**: None yet - components will be tested in Phase 5 with the main page.

**Gate**: Do NOT proceed to Phase 5 until all automated checks pass.

**Report to User**:
- List which checks passed
- List all 7 components created
- Note: UI testing happens in Phase 5
```

---

## Prompt 6: Add Phase 5 Verification Section

Add the following section at the end of **Phase 5: Main Page Component**:

```markdown
### 5.3 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles
npx tsc --noEmit

# Verify no lint errors
npx eslint src/app/dashboard/sga-activity/

# Verify page files exist
ls -la src/app/dashboard/sga-activity/

# Verify full build succeeds
npm run build
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes
- [ ] `page.tsx` and `SGAActivityContent.tsx` exist
- [ ] `npm run build` succeeds without errors

**Page Structure Checklist**:
- [ ] `src/app/dashboard/sga-activity/page.tsx` - Metadata and default export
- [ ] `src/app/dashboard/sga-activity/SGAActivityContent.tsx` - Main content component

**User Validation Required**: 
- [ ] **REQUIRED**: Visual UI verification in browser

**UI Verification Instructions**:
1. Ensure dev server is running (`npm run dev`)
2. Log in to the dashboard as admin
3. Navigate to: `http://localhost:3000/dashboard/sga-activity`

**UI Checklist** (user verifies visually):
- [ ] Page loads without white screen or error
- [ ] Page title shows "SGA Activity"
- [ ] Filters section appears at top
- [ ] Activity totals scorecards appear
- [ ] Initial Calls section appears with cards and tables
- [ ] Qualification Calls section appears with cards and tables
- [ ] SMS Response Rate card appears
- [ ] Call Answer Rate card appears
- [ ] Activity Distribution table appears
- [ ] Activity Breakdown chart appears
- [ ] Data Freshness indicator appears in header

**Interaction Tests** (user performs):
- [ ] Change date range filter → data updates
- [ ] Click on a scheduled call count → drill-down modal opens
- [ ] Click a record in drill-down → RecordDetailModal opens
- [ ] Toggle "Include Automated" → data updates

**Console Error Check**:
- [ ] Open browser DevTools (F12) → Console tab
- [ ] Verify no red errors related to the page
- [ ] Note: Some warnings are OK, errors are not

**Gate**: Do NOT proceed to Phase 6 until:
1. All automated checks pass
2. User confirms page loads and displays data
3. User confirms drill-down modals work
4. No console errors

**Report to User**:
- List which automated checks passed
- Provide UI verification checklist
- Ask user to confirm each UI item before proceeding
```

---

## Prompt 7: Add Phase 6 Verification Section

Add the following section at the end of **Phase 6: Navigation & Permissions**:

```markdown
### 6.3 Verification Checkpoint

**Automated Checks (Cursor.ai runs these)**:
```bash
# Verify TypeScript compiles
npx tsc --noEmit

# Verify no lint errors in modified files
npx eslint src/components/layout/Sidebar.tsx
npx eslint src/lib/permissions.ts

# Verify Headset icon is imported
grep "Headset" src/components/layout/Sidebar.tsx

# Verify page ID 11 is in permissions
grep "11" src/lib/permissions.ts

# Full build check
npm run build
```

**Expected Results**:
- [ ] TypeScript compiles without errors
- [ ] ESLint passes on modified files
- [ ] `Headset` icon imported in Sidebar.tsx
- [ ] Page ID `11` added to admin, manager, and sga allowedPages arrays
- [ ] Build succeeds

**Sidebar Verification**:
```bash
# Verify SGA Activity page entry
grep -A 1 "SGA Activity" src/components/layout/Sidebar.tsx
```
Expected: Shows `{ id: 11, name: 'SGA Activity', href: '/dashboard/sga-activity', icon: Headset }`

**Permissions Verification**:
```bash
# Verify allowedPages include 11 for correct roles
grep -B 2 -A 5 "allowedPages" src/lib/permissions.ts
```
Expected: `11` appears in admin, manager, and sga roles only (NOT sgm or viewer)

**User Validation Required**: 
- [ ] **REQUIRED**: Test navigation and permissions

**Navigation Test Instructions**:
1. Log in as **admin** user
2. Verify "SGA Activity" appears in sidebar with Headset icon
3. Click it → navigates to `/dashboard/sga-activity`
4. Verify page loads with all data visible

**Permission Tests**:

| Role | Expected Behavior |
|------|-------------------|
| admin | Sees "SGA Activity" in sidebar, can access page, sees all SGAs in filter |
| manager | Sees "SGA Activity" in sidebar, can access page, sees all SGAs in filter |
| sga | Sees "SGA Activity" in sidebar, can access page, only sees own data (SGA filter auto-applied) |
| sgm | Does NOT see "SGA Activity" in sidebar |
| viewer | Does NOT see "SGA Activity" in sidebar |

**Test as SGA User** (critical):
1. Log in as an SGA user
2. Navigate to SGA Activity page
3. Verify SGA dropdown is hidden OR locked to their name
4. Verify data shown is only their activity

**Gate**: Do NOT proceed to Phase 7 until:
1. All automated checks pass
2. User confirms navigation works for admin
3. User confirms SGA role sees only their own data
4. User confirms SGM role cannot access page

**Report to User**:
- List which automated checks passed
- Provide permission test matrix
- Ask user to confirm role-based access before proceeding
```

---

## Prompt 8: Add Phase 7 Enhanced Testing Section

Replace the existing **Phase 7: Testing Checklist** with this enhanced version:

```markdown
## Phase 7: Comprehensive Testing

### 7.1 Automated Test Suite

**Run Full Test Suite**:
```bash
# Full build
npm run build

# Lint all files
npm run lint

# TypeScript check
npx tsc --noEmit

# If you have unit tests
npm run test 2>/dev/null || echo "No test script configured"
```

**Expected Results**:
- [ ] Build succeeds with no errors
- [ ] Lint passes with no errors (warnings OK)
- [ ] TypeScript compiles with no errors

---

### 7.2 API Endpoint Testing

**Test All Endpoints** (user runs in browser console while logged in as admin):

```javascript
// ========== TEST 1: Filters Endpoint ==========
console.log('Testing /api/sga-activity/filters...');
fetch('/api/sga-activity/filters')
  .then(r => {
    console.log('Status:', r.status);
    return r.json();
  })
  .then(data => {
    console.log('✓ Filters Response:', data);
    console.log('  - SGAs count:', data.sgas?.length || 0);
  })
  .catch(err => console.error('✗ Filters Error:', err));

// ========== TEST 2: Dashboard Endpoint ==========
console.log('Testing /api/sga-activity/dashboard...');
fetch('/api/sga-activity/dashboard', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filters: {
      sga: null,
      dateRangeType: 'last_30',
      startDate: null,
      endDate: null,
      comparisonDateRangeType: 'last_90',
      comparisonStartDate: null,
      comparisonEndDate: null,
      activityTypes: [],
      includeAutomated: false,
      callTypeFilter: 'all_outbound'
    }
  })
})
  .then(r => {
    console.log('Status:', r.status);
    return r.json();
  })
  .then(data => {
    console.log('✓ Dashboard Response:');
    console.log('  - Initial Calls This Week:', data.initialCalls?.thisWeek?.total);
    console.log('  - SMS Response Rate:', data.smsResponseRate?.responseRate);
    console.log('  - Activity Distributions:', data.activityDistribution?.length);
  })
  .catch(err => console.error('✗ Dashboard Error:', err));

// ========== TEST 3: Scheduled Calls Drill-Down ==========
console.log('Testing /api/sga-activity/scheduled-calls...');
fetch('/api/sga-activity/scheduled-calls', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    callType: 'initial',
    weekType: 'this_week'
  })
})
  .then(r => {
    console.log('Status:', r.status);
    return r.json();
  })
  .then(data => {
    console.log('✓ Scheduled Calls Response:');
    console.log('  - Records count:', data.records?.length || 0);
  })
  .catch(err => console.error('✗ Scheduled Calls Error:', err));

// ========== TEST 4: Activity Records Drill-Down ==========
console.log('Testing /api/sga-activity/activity-records...');
fetch('/api/sga-activity/activity-records', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filters: {
      sga: null,
      dateRangeType: 'last_30',
      startDate: null,
      endDate: null,
      comparisonDateRangeType: 'last_90',
      comparisonStartDate: null,
      comparisonEndDate: null,
      activityTypes: [],
      includeAutomated: false,
      callTypeFilter: 'all_outbound'
    },
    channel: 'Call'
  })
})
  .then(r => {
    console.log('Status:', r.status);
    return r.json();
  })
  .then(data => {
    console.log('✓ Activity Records Response:');
    console.log('  - Records count:', data.records?.length || 0);
  })
  .catch(err => console.error('✗ Activity Records Error:', err));
```

**Expected Results**:
- [ ] All 4 endpoints return status 200
- [ ] Filters returns array of SGAs
- [ ] Dashboard returns all metric sections
- [ ] Scheduled Calls returns records array
- [ ] Activity Records returns records array

---

### 7.3 UI Functional Testing

**Test Matrix** (user performs each test):

| # | Test Case | Steps | Expected Result | Pass? |
|---|-----------|-------|-----------------|-------|
| 1 | Page Load | Navigate to /dashboard/sga-activity | Page loads with data, no errors | [ ] |
| 2 | Filter - SGA | Select specific SGA from dropdown | Data updates to show only that SGA | [ ] |
| 3 | Filter - Date Range | Change to "Last 90 Days" | Data updates, more historical data shown | [ ] |
| 4 | Filter - This Week | Change to "This Week" | Data shows current week only | [ ] |
| 5 | Filter - Automated Toggle | Toggle "Include Automated" ON | Activity counts increase (includes lemlist) | [ ] |
| 6 | Filter - Call Type | Change to "Cold Calls Only" | Call Answer Rate updates | [ ] |
| 7 | Initial Calls Card Click | Click "This Week" total card | Drill-down modal opens with records | [ ] |
| 8 | Initial Calls Day Click | Click a day cell with count > 0 | Drill-down shows only that day's records | [ ] |
| 9 | Initial Calls SGA Click | Click an SGA's count | Drill-down shows only that SGA's records | [ ] |
| 10 | Qual Calls Drill-Down | Click Qualification Calls count | Drill-down modal opens | [ ] |
| 11 | Activity Distribution Click | Click a cell in distribution table | Drill-down shows activities for that channel/day | [ ] |
| 12 | Activity Breakdown Click | Click a channel in breakdown | Drill-down shows all activities for that channel | [ ] |
| 13 | Record Detail Open | In drill-down, click a record row | RecordDetailModal opens with lead/opp details | [ ] |
| 14 | Salesforce Link | In drill-down, click SF link icon | Opens Salesforce in new tab | [ ] |
| 15 | Modal Close - ESC | With drill-down open, press ESC | Modal closes | [ ] |
| 16 | Modal Close - Button | Click Close button on modal | Modal closes | [ ] |
| 17 | Empty State | Filter to SGA with no activity | Shows "No records found" gracefully | [ ] |
| 18 | Console Errors | Check DevTools console | No red errors (warnings OK) | [ ] |

---

### 7.4 Permission Testing

| # | Role | Test | Expected Result | Pass? |
|---|------|------|-----------------|-------|
| 1 | admin | Access page | Full access, all SGAs visible | [ ] |
| 2 | manager | Access page | Full access, all SGAs visible | [ ] |
| 3 | sga | Access page | Access granted, only own data | [ ] |
| 4 | sga | SGA filter | Dropdown hidden or locked | [ ] |
| 5 | sgm | Access page | Page not in sidebar | [ ] |
| 6 | sgm | Direct URL | Should redirect or show 403 | [ ] |
| 7 | viewer | Access page | Page not in sidebar | [ ] |

---

### 7.5 Edge Case Testing

| # | Test Case | Steps | Expected Result | Pass? |
|---|-----------|-------|-----------------|-------|
| 1 | No Initial Calls | Filter to period with no calls | Shows 0, tables show dashes | [ ] |
| 2 | Future Week | Look at "Next Week" section | Shows scheduled future calls | [ ] |
| 3 | Large Date Range | Select "All Time" | Page loads (may be slow), no crash | [ ] |
| 4 | Custom Date Range | Enter custom start/end dates | Data filters correctly | [ ] |
| 5 | Page Refresh | Refresh browser on the page | Page reloads correctly with same filters | [ ] |

---

### 7.6 Testing Sign-Off

**Automated Checks**:
- [ ] Build passes
- [ ] Lint passes
- [ ] TypeScript passes

**API Tests**:
- [ ] All 4 endpoints return 200
- [ ] All endpoints return expected data structure

**UI Functional Tests**:
- [ ] All 18 UI tests pass

**Permission Tests**:
- [ ] All 7 permission tests pass

**Edge Case Tests**:
- [ ] All 5 edge case tests pass

**Final Sign-Off**:
- [ ] User confirms: "All tests pass, ready for deployment"

**Gate**: Do NOT proceed to Phase 8 until user provides final sign-off.
```

---

## Prompt 9: Add Phase 8 Verification Section

Replace or enhance **Phase 8: Deployment** with:

```markdown
## Phase 8: Deployment

### 8.1 Pre-Deployment Checklist

**Final Build Verification**:
```bash
# Clean install and build
rm -rf node_modules/.cache
npm run build

# Verify build output
ls -la .next/
```

**Expected Results**:
- [ ] Build completes without errors
- [ ] `.next` directory contains build output

---

### 8.2 Git Commit Preparation

**Review Changes**:
```bash
# See all changed/added files
git status

# Review diff summary
git diff --stat
```

**Expected Files Changed/Added**:
- [ ] `src/types/sga-activity.ts` (new)
- [ ] `src/lib/queries/sga-activity.ts` (new)
- [ ] `src/app/api/sga-activity/dashboard/route.ts` (new)
- [ ] `src/app/api/sga-activity/scheduled-calls/route.ts` (new)
- [ ] `src/app/api/sga-activity/activity-records/route.ts` (new)
- [ ] `src/app/api/sga-activity/filters/route.ts` (new)
- [ ] `src/components/sga-activity/*.tsx` (7 new files)
- [ ] `src/app/dashboard/sga-activity/page.tsx` (new)
- [ ] `src/app/dashboard/sga-activity/SGAActivityContent.tsx` (new)
- [ ] `src/components/layout/Sidebar.tsx` (modified)
- [ ] `src/lib/permissions.ts` (modified)

**Commit Command** (user executes):
```bash
git add .
git commit -m "feat: Add SGA Activity Dashboard

- New page at /dashboard/sga-activity
- Track scheduled initial/qualification calls
- Activity distribution by day of week
- SMS response rates and call answer rates
- Activity breakdown by channel
- Full drill-down support with RecordDetailModal
- Role-based access (admin, manager, sga only)"
```

---

### 8.3 Deployment

**If using Vercel**:
```bash
# Push to trigger deployment
git push origin main
```

**If using other hosting**:
- Follow your deployment process

---

### 8.4 Post-Deployment Verification

**Production Smoke Tests** (user performs on production URL):

| # | Test | Steps | Expected | Pass? |
|---|------|-------|----------|-------|
| 1 | Page Access | Navigate to /dashboard/sga-activity | Page loads | [ ] |
| 2 | Data Loads | Check scorecards show numbers | Data appears | [ ] |
| 3 | Filter Works | Change SGA filter | Data updates | [ ] |
| 4 | Drill-Down Works | Click a metric | Modal opens | [ ] |
| 5 | No Console Errors | Check DevTools | No errors | [ ] |

---

### 8.5 Deployment Sign-Off

- [ ] Build deployed successfully
- [ ] Production smoke tests pass
- [ ] No critical errors in logs

**Deployment Complete**: Record completion date and any notes.

---

## Appendix D: Phase Completion Tracker

Use this tracker to record completion of each phase:

| Phase | Description | Automated Checks | User Validation | Completed | Notes |
|-------|-------------|------------------|-----------------|-----------|-------|
| 0 | Pre-Implementation | [ ] Build [ ] Lint [ ] TS | N/A | [ ] | |
| 1 | Type Definitions | [ ] Build [ ] Lint [ ] TS | N/A | [ ] | |
| 2 | Query Functions | [ ] Build [ ] Lint [ ] TS | Optional BQ test | [ ] | |
| 3 | API Routes | [ ] Build [ ] Lint [ ] TS | [ ] API tests in console | [ ] | |
| 4 | Components | [ ] Build [ ] Lint [ ] TS | N/A | [ ] | |
| 5 | Main Page | [ ] Build [ ] Lint [ ] TS | [ ] UI checklist | [ ] | |
| 6 | Navigation | [ ] Build [ ] Lint [ ] TS | [ ] Permission tests | [ ] | |
| 7 | Testing | [ ] All automated | [ ] All manual | [ ] | |
| 8 | Deployment | [ ] Build | [ ] Smoke tests | [ ] | |
```

---

## Final Instructions for Cursor.ai

After adding all verification sections:

1. **Save the updated implementation plan**
2. **Add Appendix D** (Phase Completion Tracker) at the end of the document
3. **Verify the document structure** - each phase should now have a "Verification Checkpoint" subsection
4. **Confirm completion** - respond with a summary of all changes made

---

**End of Pre-Implementation Updates**
