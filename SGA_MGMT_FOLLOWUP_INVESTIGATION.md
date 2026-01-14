# SGA Management Upgrade - Follow-Up Investigation & Document Update

## Objective

Review the corrected implementation plan and investigate any remaining gaps to ensure the plan is complete and accurate. Make necessary updates directly to `C:\Users\russe\Documents\Dashboard\SGA_MGMT_UPGRADE_IMPLEMENTATION.md`.

---

## SECTION 1: RecordDetailModal Back Button Integration

### Questions to Answer:

1. **Current RecordDetailModal props interface**:
   - Read `src/components/dashboard/RecordDetailModal.tsx`
   - Document the exact current props interface
   - Verify there are no existing props that conflict with `showBackButton`, `onBack`, `backButtonLabel`

2. **Current header structure**:
   - Document the exact JSX structure of the modal header
   - Identify the exact location where the back button should be inserted
   - Note any existing flex/grid layout that affects button placement

3. **Existing usage in Funnel Performance**:
   - Check `src/app/dashboard/page.tsx` for how RecordDetailModal is currently used
   - Verify adding new optional props won't break existing usage

**Action**: Update Phase 5.3 in the implementation document with the exact code changes needed, including the correct line numbers and surrounding context.

---

## SECTION 2: SGAHubContent Existing State Verification

### Questions to Answer:

1. **Existing state variables**:
   - Read `src/app/dashboard/sga-hub/SGAHubContent.tsx`
   - List ALL existing useState declarations
   - Identify if `session`, `userName`, or similar already exists
   - Note the exact variable names used

2. **Existing useSession usage**:
   - Is `useSession` already imported and used?
   - What variable names are used for session data?

3. **Where to add new state**:
   - Identify the exact line number where drill-down state should be added
   - Ensure no duplicate declarations

**Action**: Update Phase 10.1 in the implementation document with the exact state that needs to be added (avoiding duplicates) and the correct insertion point.

---

## SECTION 3: ClosedLostTable Current Implementation

### Questions to Answer:

1. **Current onRecordClick prop**:
   - Read `src/components/sga-hub/ClosedLostTable.tsx`
   - Document the exact prop interface
   - What type is passed to onRecordClick? `(record: ClosedLostRecord) => void`?

2. **Current row click implementation**:
   - Document the exact TableRow onClick code
   - Is cursor-pointer already conditional on onRecordClick?
   - Is e.stopPropagation() used for Salesforce links?

3. **How ClosedLostTable is currently rendered**:
   - Check `src/app/dashboard/sga-hub/SGAHubContent.tsx`
   - Is onRecordClick currently being passed? If so, what handler?
   - If not passed, document where to add it

**Action**: Update Phase 11 in the implementation document with verification that the existing implementation is correct OR the exact changes needed.

---

## SECTION 4: AdminSGATable Expanded Row Verification

### Questions to Answer:

1. **Exact expanded row JSX structure**:
   - Read `src/components/sga-hub/AdminSGATable.tsx`
   - Find the expanded row section (inside the `{isExpanded && ...}` block)
   - Document the exact structure of the Current Week section
   - Document the exact structure of the Current Quarter section

2. **Grid layout verification**:
   - Confirm the current grid class (`grid-cols-[80px_1fr]` or already `[160px_1fr]`?)
   - Note any parent container classes that affect layout

3. **String interpolation locations**:
   - Find exact line numbers for the "IC:", "QC:", "SQO:" strings
   - Document the exact code around these strings

**Action**: Update Phase 6.1 in the implementation document with the exact code to replace (using `str_replace` style old_str → new_str).

---

## SECTION 5: WeeklyGoalsTable Cell Structure

### Questions to Answer:

1. **Current cell rendering for metrics**:
   - Read `src/components/sga-hub/WeeklyGoalsTable.tsx`
   - Document the exact JSX for Initial Calls column cell
   - Document the exact JSX for Qualification Calls column cell
   - Document the exact JSX for SQOs column cell

2. **Current styling classes**:
   - What classes are used for the actual values?
   - What classes are used for the goal values?
   - What classes are used for the difference display?

3. **Props interface**:
   - Document the current `WeeklyGoalsTableProps` interface
   - Verify `canEdit` is NOT a prop (it uses `goal.canEdit` property)

**Action**: Update Phase 8.1 in the implementation document with the exact code changes, matching the existing patterns.

---

## SECTION 6: API Client Structure Verification

### Questions to Answer:

1. **dashboardApi object structure**:
   - Read `src/lib/api-client.ts`
   - Document where the SGA Hub functions are located
   - Find the exact location to add new drill-down functions

2. **Existing SGA Hub functions**:
   - List all existing SGA Hub related functions
   - Note their exact signatures
   - Note how they handle optional parameters

3. **Import statements needed**:
   - What imports already exist at the top of the file?
   - What new imports are needed for drill-down types?

**Action**: Update Phase 4.1 in the implementation document with the exact location and surrounding code for adding the new functions.

---

## SECTION 7: Helper Function Locations

### Questions to Answer:

1. **formatDate location**:
   - Is it in `date-helpers.ts` or `format-helpers.ts`?
   - What is the exact import path?

2. **formatCurrency location**:
   - Confirmed in `date-helpers.ts` per corrections
   - What other formatting functions are available there?

3. **getWeekSundayDate and getQuarterInfo**:
   - Read `src/lib/utils/sga-hub-helpers.ts`
   - Document the exact function signatures
   - Note the return types

**Action**: Update all import statements throughout the implementation document to use correct paths.

---

## SECTION 8: Type Definition Verification

### Questions to Answer:

1. **Existing types in sga-hub.ts**:
   - Read `src/types/sga-hub.ts`
   - List all existing interfaces
   - Verify ClosedLostRecord structure
   - Check if any drill-down related types already exist

2. **Existing types in record-detail.ts**:
   - Verify `RecordDetailFull` interface structure
   - Note any types that could be reused for drill-down

3. **bigquery-raw.ts helpers**:
   - Read `src/types/bigquery-raw.ts`
   - Document `toString()`, `toNumber()` helper signatures
   - Note any other useful helpers

**Action**: Update Phase 1 in the implementation document to avoid any type duplications and use existing helpers correctly.

---

## SECTION 9: Existing Modal Patterns

### Questions to Answer:

1. **How MetricDrillDownModal should match existing modals**:
   - Review RecordDetailModal's modal wrapper structure
   - Document the exact z-index, backdrop, and animation classes used
   - Note the ESC key handling pattern

2. **Tremor components used in tables**:
   - What exact Tremor imports are used in AdminSGATable?
   - What exact Tremor imports are used in ClosedLostTable?
   - Are there any custom wrapper components?

**Action**: Update Phase 5.2 in the implementation document to ensure MetricDrillDownModal matches existing patterns exactly.

---

## SECTION 10: Prisma User Query Pattern

### Questions to Answer:

1. **How user name is fetched in existing routes**:
   - Read `src/app/api/sga-hub/weekly-actuals/route.ts`
   - Document the exact Prisma query pattern
   - Note how userEmail param is handled

2. **User model structure**:
   - What fields are available on the User model?
   - Is `name` the correct field to use for SGA_Owner_Name__c matching?

**Action**: Verify the API route patterns in the implementation document match the existing pattern exactly.

---

## Output Instructions

After investigating all sections above:

1. **Update the implementation document directly**:
   - Make changes to `C:\Users\russe\Documents\Dashboard\SGA_MGMT_UPGRADE_IMPLEMENTATION.md`
   - Use exact code from the codebase (not assumptions)
   - Include correct line numbers where helpful

2. **Add a "Corrections Applied" section at the end**:
   ```markdown
   ---
   
   ## Corrections Applied (Follow-Up Investigation)
   
   **Date**: [Current Date]
   
   ### Changes Made:
   1. [Description of change 1]
   2. [Description of change 2]
   ...
   
   ### Verified Patterns:
   - [Pattern 1 verified as correct]
   - [Pattern 2 verified as correct]
   ...
   
   ### Remaining Considerations:
   - [Any edge cases or notes for implementation]
   ```

3. **Flag any blockers**:
   - If any investigation reveals a problem with the plan, document it clearly
   - If any code doesn't exist as expected, note it

---

## Verification Before Completing

- [ ] All 10 sections investigated
- [ ] All code snippets verified against actual files
- [ ] Implementation document updated with corrections
- [ ] No duplicate type definitions
- [ ] No duplicate state declarations
- [ ] Import paths all verified
- [ ] API route patterns match existing routes
- [ ] Modal patterns match existing modals

---

**Note**: Read the actual files - do not assume contents. If a file structure differs from what the original plan assumed, document the actual structure and update the plan accordingly.
