# SGA/SGM Active Filter Toggle - Implementation Guide

**Status**: ✅ **READY FOR AGENTIC DEVELOPMENT**  
**Confidence Level**: 🟢 **HIGH (100%)**  
**Review Date**: Current Session  
**Readiness Review**: See `SGA_SGM_ACTIVE_FILTER_READINESS_REVIEW.md`

## Feature Overview

**Goal**: Add an "Active/All" toggle next to the SGA and SGM filter dropdowns that allows users to filter the dropdown options to show only active team members (default) or all team members including inactive ones.

**Current State**: Dropdowns show ALL distinct SGA/SGM names from `vw_funnel_master`, including people who are no longer active.

**Target State**: Dropdowns default to showing only active SGAs/SGMs, with a toggle to show all.

---

## Pre-Implementation Verification

### Step 0.1: Verify BigQuery Data Structure

**MCP BigQuery Validation** - Run these queries to confirm data structure before coding:

```sql
-- Query 1: Verify User table has IsActive field and check counts
SELECT 
  COUNT(*) as total_users,
  COUNTIF(IsActive = TRUE) as active_users,
  COUNTIF(IsActive = FALSE OR IsActive IS NULL) as inactive_users
FROM `savvy-gtm-analytics.SavvyGTMData.User`
-- Expected: ~55 total, ~43 active, ~12 inactive
```

```sql
-- Query 2: Verify SGA name matching between funnel and User table
SELECT 
  COUNT(DISTINCT v.SGA_Owner_Name__c) as total_sgas_in_funnel,
  COUNT(DISTINCT CASE WHEN u.Name IS NOT NULL THEN v.SGA_Owner_Name__c END) as matched_sgas,
  COUNT(DISTINCT CASE WHEN u.Name IS NULL THEN v.SGA_Owner_Name__c END) as unmatched_sgas
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON v.SGA_Owner_Name__c = u.Name
WHERE v.SGA_Owner_Name__c IS NOT NULL
-- Expected: Most SGAs should match (matched > unmatched)
```

```sql
-- Query 3: Verify SGM name matching between funnel and User table
SELECT 
  COUNT(DISTINCT v.SGM_Owner_Name__c) as total_sgms_in_funnel,
  COUNT(DISTINCT CASE WHEN u.Name IS NOT NULL THEN v.SGM_Owner_Name__c END) as matched_sgms,
  COUNT(DISTINCT CASE WHEN u.Name IS NULL THEN v.SGM_Owner_Name__c END) as unmatched_sgms
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON v.SGM_Owner_Name__c = u.Name
WHERE v.SGM_Owner_Name__c IS NOT NULL
-- Expected: Most SGMs should match (matched > unmatched)
```

```sql
-- Query 4: Preview the exact data the new API will return for SGAs
SELECT DISTINCT 
  v.SGA_Owner_Name__c as sga,
  COALESCE(u.IsActive, FALSE) as isActive
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u 
  ON v.SGA_Owner_Name__c = u.Name
WHERE v.SGA_Owner_Name__c IS NOT NULL
ORDER BY v.SGA_Owner_Name__c
-- Verify: Should show mix of true/false isActive values
```

```sql
-- Query 5: Preview the exact data the new API will return for SGMs
SELECT DISTINCT 
  v.SGM_Owner_Name__c as sgm,
  COALESCE(u.IsActive, FALSE) as isActive
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u 
  ON v.SGM_Owner_Name__c = u.Name
WHERE v.SGM_Owner_Name__c IS NOT NULL
ORDER BY v.SGM_Owner_Name__c
-- Verify: Should show mix of true/false isActive values
```

**✅ Verification Gate**: All 5 queries return expected results before proceeding.

---

## Phase 1: Update TypeScript Types

### Step 1.1: Add FilterOption Interface

**File**: `src/types/filters.ts`

**Cursor Prompt**:
```
In src/types/filters.ts, add a new interface for filter options that include active status.

Add this interface (place it near the top with other interfaces):

/**
 * Represents a filter option with active status for SGA/SGM dropdowns
 */
export interface FilterOption {
  value: string;
  label: string;
  isActive: boolean;
}

IMPORTANT: Ensure FilterOption is exported so it can be imported in other files:
export interface FilterOption { ... }

Do NOT modify DashboardFilters - the toggle state will be managed locally in the component.
```

**Verification Gate**:
```bash
npm run build
# Should pass with no TypeScript errors
```

---

### Step 1.2: Update API Response Types

**File**: `src/types/filters.ts` or `src/types/api.ts` (wherever FiltersResponse is defined)

**Cursor Prompt**:
```
Find where the filters API response type is defined (likely in src/types/filters.ts, src/types/api.ts, 
or src/lib/api-client.ts).

Update the type for sgas and sgms from string[] to FilterOption[]:

Before:
  sgas: string[];
  sgms: string[];

After:
  sgas: FilterOption[];
  sgms: FilterOption[];

Make sure FilterOption is imported if it's in a different file.
Import path: `import { FilterOption } from '@/types/filters';`

If there's a type like RawFiltersResult for BigQuery results, add a new type:

interface RawSgaResult {
  sga: string;
  isActive: boolean;
}

interface RawSgmResult {
  sgm: string;
  isActive: boolean;
}
```

**Verification Gate**:
```bash
npm run build
# May show errors in files that consume these types - that's expected, we'll fix them next
```

---

## Phase 2: Update Filters API Route

### Step 2.1: Modify BigQuery Queries

**File**: `src/app/api/dashboard/filters/route.ts`

**Cursor Prompt**:
```
In src/app/api/dashboard/filters/route.ts, modify the SGA and SGM queries to JOIN with 
the User table and return isActive status.

Find the existing sgasQuery (around line 35-40) that looks like:
const sgasQuery = `
  SELECT DISTINCT SGA_Owner_Name__c as sga
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
  WHERE SGA_Owner_Name__c IS NOT NULL
  ORDER BY SGA_Owner_Name__c
`;

Replace it with:
const sgasQuery = `
  SELECT DISTINCT 
    v.SGA_Owner_Name__c as sga,
    COALESCE(u.IsActive, FALSE) as isActive
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` v
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u 
    ON v.SGA_Owner_Name__c = u.Name
  WHERE v.SGA_Owner_Name__c IS NOT NULL
  ORDER BY v.SGA_Owner_Name__c
`;

Find the existing sgmsQuery (around line 41-46) that looks like:
const sgmsQuery = `
  SELECT DISTINCT SGM_Owner_Name__c as sgm
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
  WHERE SGM_Owner_Name__c IS NOT NULL
  ORDER BY SGM_Owner_Name__c
`;

Replace it with:
const sgmsQuery = `
  SELECT DISTINCT 
    v.SGM_Owner_Name__c as sgm,
    COALESCE(u.IsActive, FALSE) as isActive
  FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\` v
  LEFT JOIN \`savvy-gtm-analytics.SavvyGTMData.User\` u 
    ON v.SGM_Owner_Name__c = u.Name
  WHERE v.SGM_Owner_Name__c IS NOT NULL
  ORDER BY v.SGM_Owner_Name__c
`;

IMPORTANT NOTES:
- Use ${FULL_TABLE} constant for the funnel master table (already in use)
- No USER_TABLE constant exists in constants.ts - use the full path 'savvy-gtm-analytics.SavvyGTMData.User' directly
- The User table path is hardcoded as shown above
```

---

### Step 2.2: Update Response Transformation

**File**: `src/app/api/dashboard/filters/route.ts`

**Cursor Prompt**:
```
In src/app/api/dashboard/filters/route.ts, update the response transformation to include 
isActive in the returned objects.

Find where the response is constructed (likely near the end of the function) and update 
the sgas and sgms mapping:

Before (something like):
sgas: sgaResults.map(row => row.sga),
sgms: sgmResults.map(row => row.sgm),

After:
sgas: sgaResults.map(row => ({ 
  value: row.sga, 
  label: row.sga, 
  isActive: row.isActive === true || row.isActive === 'true' || row.isActive === 1
})),
sgms: sgmResults.map(row => ({ 
  value: row.sgm, 
  label: row.sgm, 
  isActive: row.isActive === true || row.isActive === 'true' || row.isActive === 1
})),

Note: BigQuery boolean handling can be inconsistent, so we check multiple truthy forms.

Also add TypeScript types for the raw results if not already present:

interface RawSgaResult {
  sga: string;
  isActive: boolean | string | number;
}

interface RawSgmResult {
  sgm: string;
  isActive: boolean | string | number;
}

Use these in the runQuery calls:
const sgaResults = await runQuery<RawSgaResult>(sgasQuery);
const sgmResults = await runQuery<RawSgmResult>(sgmsQuery);
```

**Verification Gate**:
```bash
npm run build
npm run dev
# Test the API endpoint:
curl http://localhost:3000/api/dashboard/filters | jq '.sgas[0:3], .sgms[0:3]'
# Should return objects with value, label, and isActive fields
```

---

## Phase 3: Update GlobalFilters Component

### Step 3.1: Add Toggle State

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Cursor Prompt**:
```
In src/components/dashboard/GlobalFilters.tsx, add state for the Active/All toggles.

Near the top of the component (with other useState declarations), add:

// Toggle state for showing only active SGAs/SGMs (default: true = active only)
const [sgaActiveOnly, setSgaActiveOnly] = useState<boolean>(true);
const [sgmActiveOnly, setSgmActiveOnly] = useState<boolean>(true);

Import useState from React if not already imported.
```

---

### Step 3.2: Add Filtered Options Logic

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Cursor Prompt**:
```
In src/components/dashboard/GlobalFilters.tsx, add logic to filter the dropdown options 
based on toggle state.

After the state declarations and before the return statement, add:

// Filter SGA options based on active toggle
const filteredSgaOptions = useMemo(() => {
  if (!filterOptions.sgas || filterOptions.sgas.length === 0) return [];
  return sgaActiveOnly 
    ? filterOptions.sgas.filter(opt => opt.isActive) 
    : filterOptions.sgas;
}, [filterOptions.sgas, sgaActiveOnly]);

// Filter SGM options based on active toggle
const filteredSgmOptions = useMemo(() => {
  if (!filterOptions.sgms || filterOptions.sgms.length === 0) return [];
  return sgmActiveOnly 
    ? filterOptions.sgms.filter(opt => opt.isActive) 
    : filterOptions.sgms;
}, [filterOptions.sgms, sgmActiveOnly]);

Import useMemo from React if not already imported.

IMPORTANT NOTE: In GlobalFilters component, the options come from props:
- filterOptions.sgas = array of FilterOption objects from props (not sgaOptions)
- filterOptions.sgms = array of FilterOption objects from props (not sgmOptions)
- These are passed in via the filterOptions prop of type FilterOptions
```

---

### Step 3.3: Create Toggle Switch Component

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Cursor Prompt**:
```
In src/components/dashboard/GlobalFilters.tsx, create a reusable toggle switch component 
inside the file (or as a separate component if preferred).

Add this above the main component or inside it as an inline component:

/**
 * Small toggle switch for Active/All filter
 */
const ActiveToggle = ({ 
  isActiveOnly, 
  onToggle, 
  label 
}: { 
  isActiveOnly: boolean; 
  onToggle: () => void; 
  label: string;
}) => (
  <div className="flex items-center gap-1.5 ml-2">
    <span className={`text-xs ${isActiveOnly ? 'text-blue-600 font-medium' : 'text-gray-400'}`}>
      Active
    </span>
    <button
      type="button"
      onClick={onToggle}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 ${
        isActiveOnly ? 'bg-blue-600' : 'bg-gray-300'
      }`}
      role="switch"
      aria-checked={isActiveOnly}
      aria-label={`Toggle ${label} active filter`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
          isActiveOnly ? 'translate-x-0' : 'translate-x-4'
        }`}
      />
    </button>
    <span className={`text-xs ${!isActiveOnly ? 'text-gray-600 font-medium' : 'text-gray-400'}`}>
      All
    </span>
  </div>
);
```

---

### Step 3.4: Add Toggle to SGA Filter Section

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Cursor Prompt**:
```
In src/components/dashboard/GlobalFilters.tsx, find where the SGA dropdown/select is rendered.
Add the ActiveToggle component next to the SGA label.

Look for something like:
<label>SGA</label>
<select ... >

Or if using a custom Select component:
<div>
  <label>SGA</label>
  <Select ... />
</div>

Modify it to include the toggle:

<div className="flex flex-col gap-1">
  <div className="flex items-center justify-between">
    <label className="text-sm font-medium text-gray-700">SGA</label>
    <ActiveToggle 
      isActiveOnly={sgaActiveOnly} 
      onToggle={() => setSgaActiveOnly(!sgaActiveOnly)} 
      label="SGA"
    />
  </div>
  {/* Existing dropdown/select component using filteredSgaOptions instead of sgaOptions */}
</div>

IMPORTANT: Update the dropdown to use filteredSgaOptions instead of the original sgaOptions.

If the dropdown options are rendered like:
{sgaOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}

Change to:
{filteredSgaOptions.map(opt => (
  <option key={opt.value} value={opt.value}>
    {opt.label}{!sgaActiveOnly && !opt.isActive ? ' (Inactive)' : ''}
  </option>
))}
```

---

### Step 3.5: Add Toggle to SGM Filter Section

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Cursor Prompt**:
```
In src/components/dashboard/GlobalFilters.tsx, find where the SGM dropdown/select is rendered.
Add the ActiveToggle component next to the SGM label (same pattern as SGA).

<div className="flex flex-col gap-1">
  <div className="flex items-center justify-between">
    <label className="text-sm font-medium text-gray-700">SGM</label>
    <ActiveToggle 
      isActiveOnly={sgmActiveOnly} 
      onToggle={() => setSgmActiveOnly(!sgmActiveOnly)} 
      label="SGM"
    />
  </div>
  {/* Existing dropdown/select component using filteredSgmOptions instead of sgmOptions */}
</div>

Update the dropdown to use filteredSgmOptions and add (Inactive) suffix when in "All" mode:

{filteredSgmOptions.map(opt => (
  <option key={opt.value} value={opt.value}>
    {opt.label}{!sgmActiveOnly && !opt.isActive ? ' (Inactive)' : ''}
  </option>
))}
```

**Verification Gate**:
```bash
npm run build
npm run dev
# Visual check: Toggle should appear next to SGA and SGM labels
# Functional check: Toggle should filter dropdown options
```

---

## Phase 4: Handle Edge Cases

### Step 4.1: Clear Invalid Selections on Toggle

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Cursor Prompt**:
```
In src/components/dashboard/GlobalFilters.tsx, add useEffect hooks to clear selections 
when toggling from "All" to "Active" if the selected value is inactive.

Add these effects after the state declarations:

// Clear SGA selection if toggling to "Active" and current selection is inactive
useEffect(() => {
  if (sgaActiveOnly && filters.sga) {
    const selectedOption = filterOptions.sgas?.find(opt => opt.value === filters.sga);
    if (selectedOption && !selectedOption.isActive) {
      // Clear the selection by calling handleSgaChange with empty string
      handleSgaChange('');
    }
  }
}, [sgaActiveOnly, filters.sga, filterOptions.sgas, handleSgaChange]);

// Clear SGM selection if toggling to "Active" and current selection is inactive
useEffect(() => {
  if (sgmActiveOnly && filters.sgm) {
    const selectedOption = filterOptions.sgms?.find(opt => opt.value === filters.sgm);
    if (selectedOption && !selectedOption.isActive) {
      // Clear the selection by calling handleSgmChange with empty string
      handleSgmChange('');
    }
  }
}, [sgmActiveOnly, filters.sgm, filterOptions.sgms, handleSgmChange]);

IMPORTANT: In GlobalFilters component, use these variable names:
- filters.sga = current selected SGA value (from props)
- filters.sgm = current selected SGM value (from props)
- filterOptions.sgas = array of FilterOption objects (from props)
- filterOptions.sgms = array of FilterOption objects (from props)
- handleSgaChange = handler function that calls onFiltersChange with updated filters
- handleSgmChange = handler function that calls onFiltersChange with updated filters

These are already defined in the component - use them as shown above.
```

---

### Step 4.2: Visual Indicator for Inactive Users

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Cursor Prompt**:
```
In src/components/dashboard/GlobalFilters.tsx, ensure inactive users are visually 
distinguished when viewing "All" mode.

If using native <select> with <option> elements:
- Add "(Inactive)" suffix to inactive user labels (already done in Step 3.4/3.5)
- Note: Native <option> elements have limited styling capabilities

If using a custom Select component (like Tremor Select, Headless UI, or similar):
- Add styling for inactive options:

{filteredSgaOptions.map(opt => (
  <SelectItem 
    key={opt.value} 
    value={opt.value}
    className={!opt.isActive ? 'text-gray-400 italic' : ''}
  >
    {opt.label}{!sgaActiveOnly && !opt.isActive ? ' (Inactive)' : ''}
  </SelectItem>
))}

The key behaviors should be:
1. In "Active" mode: Only active users shown, no special styling needed
2. In "All" mode: Inactive users shown with "(Inactive)" suffix and/or gray/italic styling
```

**Verification Gate**:
```bash
npm run build
npm run lint
npm run dev
# Test: Select an inactive user in "All" mode, then toggle to "Active" - selection should clear
# Test: Inactive users should show "(Inactive)" suffix in "All" mode
```

---

## Phase 5: Update Consuming Components (if needed)

### Step 5.1: Check API Client

**File**: `src/lib/api-client.ts`

**Cursor Prompt**:
```
In src/lib/api-client.ts (or wherever the dashboardApi is defined), check if there are 
any transformations or type definitions for the filters endpoint response.

If the file has type definitions like:
interface FiltersResponse {
  sgas: string[];
  sgms: string[];
  ...
}

Update them to:
interface FiltersResponse {
  sgas: FilterOption[];
  sgms: FilterOption[];
  ...
}

Import FilterOption from src/types/filters.ts if needed.

If there are any transformations that assume sgas/sgms are strings, update them to handle objects.
```

---

### Step 5.2: Check Other Components Using Filter Options

**Cursor Prompt**:
```
Search the codebase for other components that might be using sgas or sgms filter options:

grep -r "sgaOptions\|sgmOptions\|\.sgas\|\.sgms" src/

For each file found, check if it assumes sgas/sgms are strings and update if needed.

Common places to check:
- Dashboard page (src/app/dashboard/page.tsx)
- Other filter components
- Export functionality
- Any component that renders SGA/SGM lists

If a component just needs the string values (not isActive), it can map:
const sgaNames = sgaOptions.map(opt => opt.value);
```

**Verification Gate**:
```bash
npm run build
# All TypeScript errors should be resolved
npm run lint
# No linting errors
```

---

## Phase 6: Final Verification

### Step 6.1: Build Verification

```bash
npm run build
npm run lint
```

Both commands should pass with no errors.

---

### Step 6.2: Manual Testing Checklist

Start the dev server: `npm run dev`

**Test 1: API Response Structure**
```bash
curl http://localhost:3000/api/dashboard/filters | jq '.sgas[0:3]'
```
Expected: Array of objects with `value`, `label`, `isActive` fields

**Test 2: Default Behavior (Active Only)**
1. Open dashboard in browser
2. Click SGA dropdown - should only show active SGAs
3. Click SGM dropdown - should only show active SGMs
4. Count should be less than total (some inactive users filtered out)

**Test 3: Toggle to "All" Mode**
1. Click the toggle next to SGA to switch to "All"
2. Dropdown should now show all SGAs
3. Inactive SGAs should show "(Inactive)" suffix
4. Repeat for SGM toggle

**Test 4: Selection Clearing**
1. Set SGA toggle to "All"
2. Select an inactive SGA (one with "(Inactive)" suffix)
3. Toggle back to "Active"
4. SGA selection should be cleared (dropdown shows placeholder/empty)

**Test 5: Filtering Works Correctly**
1. Select an active SGA
2. Verify dashboard data filters correctly
3. Toggle between Active/All - filter should still work
4. Repeat for SGM

**Test 6: Persistence Across Page Navigation**
1. Set filters and toggle states
2. Navigate away and back
3. Note: Toggle state may reset (local state) - this is expected
4. Filter selections should persist if using URL params or global state

---

### Step 6.3: MCP BigQuery Validation

After implementation, run these queries to verify the feature is working correctly:

```sql
-- Verify active SGA count matches UI "Active" mode
SELECT COUNT(DISTINCT v.SGA_Owner_Name__c) as active_sga_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
JOIN `savvy-gtm-analytics.SavvyGTMData.User` u 
  ON v.SGA_Owner_Name__c = u.Name
WHERE v.SGA_Owner_Name__c IS NOT NULL
  AND u.IsActive = TRUE
-- Compare this count with dropdown count in "Active" mode
```

```sql
-- Verify total SGA count matches UI "All" mode
SELECT COUNT(DISTINCT v.SGA_Owner_Name__c) as total_sga_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.SGA_Owner_Name__c IS NOT NULL
-- Compare this count with dropdown count in "All" mode
```

```sql
-- List inactive SGAs (should match those showing "(Inactive)" in UI)
SELECT DISTINCT v.SGA_Owner_Name__c as inactive_sga
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.User` u 
  ON v.SGA_Owner_Name__c = u.Name
WHERE v.SGA_Owner_Name__c IS NOT NULL
  AND (u.IsActive = FALSE OR u.IsActive IS NULL)
ORDER BY v.SGA_Owner_Name__c
-- These names should all show "(Inactive)" in UI when in "All" mode
```

---

## Rollback Plan

If issues are discovered after deployment:

### Quick Fix (Disable Toggle)
In `GlobalFilters.tsx`, force the toggle states to always be `false` (All mode):
```typescript
const [sgaActiveOnly, setSgaActiveOnly] = useState<boolean>(false); // Changed from true
const [sgmActiveOnly, setSgmActiveOnly] = useState<boolean>(false); // Changed from true
```

And hide the toggle UI by wrapping it in `{false && <ActiveToggle ... />}`

### Full Rollback
Revert changes to:
- `src/types/filters.ts`
- `src/app/api/dashboard/filters/route.ts`
- `src/components/dashboard/GlobalFilters.tsx`

The feature is additive and doesn't modify core query logic, so rollback should be straightforward.

---

## Summary

| Phase | Files Modified | Risk Level | Status |
|-------|---------------|------------|--------|
| 1. Types | `src/types/filters.ts` | Low | ⏳ Pending |
| 2. API | `src/app/api/dashboard/filters/route.ts` | Low | ⏳ Pending |
| 3. UI | `src/components/dashboard/GlobalFilters.tsx` | Low | ⏳ Pending |
| 4. Edge Cases | `src/components/dashboard/GlobalFilters.tsx` | Low | ⏳ Pending |
| 5. Cleanup | Various | Low | ⏳ Pending |

**Total Estimated Time**: 2-3 hours

**Readiness Status**: ✅ **READY FOR AGENTIC DEVELOPMENT**
- All pre-implementation queries verified ✅
- File paths confirmed ✅
- Variable names clarified ✅
- Code patterns verified ✅

**Key Design Decisions**:
1. Uses LEFT JOIN - won't break if names don't match
2. COALESCE(IsActive, FALSE) - safe default for unmatched users
3. Default to "Active Only" - conservative UX default
4. No changes to vw_funnel_master - purely frontend/API change
5. Backward compatible - existing functionality unchanged

---

## Files Changed Summary

```
src/types/filters.ts                           + FilterOption interface
src/app/api/dashboard/filters/route.ts         + JOIN with User table, return isActive
src/components/dashboard/GlobalFilters.tsx     + Toggle state, filtered options, UI toggle
src/lib/api-client.ts                          + Updated types (if needed)
```

---

## Questions for Implementation

If Cursor encounters ambiguity, here are clarifying answers:

1. **Q: What if a name appears in vw_funnel_master but not in User table?**
   A: Use COALESCE(u.IsActive, FALSE) - treat as inactive by default

2. **Q: Should toggle state persist across sessions?**
   A: No, local component state is fine. Default to "Active" on each page load.

3. **Q: What about the "All" option in dropdowns?**
   A: The "All" option (meaning "don't filter by this field") should always appear regardless of toggle state

4. **Q: Should permission-based filtering still work?**
   A: Yes, if a user can only see their own SGA data, the toggle only affects what they see in the dropdown, not their data access.
