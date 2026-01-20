# Funnel Performance Dashboard Enhancement - Investigation Checklist

## Purpose

This document is designed to be worked through by Cursor.ai (or any agentic AI) to systematically investigate the codebase before implementing the enhancements outlined in `funnel_performance_enhancement.md`. Each section contains discovery questions, verification steps, and update instructions.

**Workflow:**
1. Work through each phase sequentially
2. Document findings in the `### Findings` section under each question
3. After completing all phases, update `funnel_performance_enhancement.md` with discovered details
4. Use the final checklist to ensure the enhancement document is complete

---

## Phase 1: Verify Current Implementation State

### 1.1 Scorecard Component Analysis

**Objective:** Confirm the exact current implementation of scorecard click behavior.

#### Investigation Steps:

1. **Read `src/app/dashboard/page.tsx`** and locate:
   - [ ] The `handleMetricClick` function definition
   - [ ] How `selectedMetric` state is used
   - [ ] How `filters.metricFilter` is set when a scorecard is clicked
   - [ ] The `VolumeDrillDownModal` props and when it's rendered

   ```
   ### Findings:
   <!-- Cursor: Document the exact current handleMetricClick implementation -->
   <!-- Include line numbers for reference -->
   ```

2. **Read `src/components/dashboard/Scorecards.tsx`**:
   - [ ] What props does it accept? List all props and their types.
   - [ ] How is the `selectedMetric` prop used for visual highlighting?
   - [ ] What CSS classes are applied when a card is selected vs unselected?

   ```
   ### Findings:
   <!-- Cursor: Document the Scorecards props interface and selection logic -->
   ```

3. **Read `src/components/dashboard/FullFunnelScorecards.tsx`**:
   - [ ] Does it follow the same pattern as `Scorecards.tsx`?
   - [ ] Are there any differences in how selection is handled?

   ```
   ### Findings:
   <!-- Cursor: Document any differences between Scorecards and FullFunnelScorecards -->
   ```

### 1.2 VolumeDrillDownModal Analysis

**Objective:** Understand the current modal capabilities and limitations.

#### Investigation Steps:

1. **Read `src/components/dashboard/VolumeDrillDownModal.tsx`**:
   - [ ] What is the exact `metricFilter` type in the props interface?
   - [ ] Does the modal render a `DetailRecordsTable` internally?
   - [ ] How does the modal handle the `onRecordClick` callback?
   - [ ] What loading/error states does it support?

   ```
   ### Findings:
   <!-- Cursor: Document the VolumeDrillDownModal interface and current metric support -->
   ```

2. **Search for existing usage of VolumeDrillDownModal**:
   - [ ] Where else in the codebase is `VolumeDrillDownModal` used?
   - [ ] How is it currently being opened (what triggers it)?

   ```
   ### Findings:
   <!-- Cursor: Document all usages of VolumeDrillDownModal in the codebase -->
   ```

### 1.3 DetailRecordsTable Analysis

**Objective:** Understand the table component's current capabilities.

#### Investigation Steps:

1. **Read `src/components/dashboard/DetailRecordsTable.tsx`**:
   - [ ] What props does it accept? List the complete interface.
   - [ ] How does the `metricFilter` prop affect column display?
   - [ ] Is there any existing dropdown or filter UI in the component?
   - [ ] How is pagination implemented?
   - [ ] How is the search functionality implemented?

   ```
   ### Findings:
   <!-- Cursor: Document the DetailRecordsTable props interface and key behaviors -->
   ```

2. **Examine the date column logic**:
   - [ ] How does the table determine which date field to display?
   - [ ] What date field mappings exist for each metric type?

   ```
   ### Findings:
   <!-- Cursor: Document the date column selection logic -->
   ```

---

## Phase 2: Data Flow Investigation

### 2.1 API and Query Analysis

**Objective:** Understand how detail records are fetched and filtered.

#### Investigation Steps:

1. **Read `src/lib/queries/detail-records.ts`**:
   - [ ] What is the function signature for the detail records query?
   - [ ] How does the `metricFilter` parameter affect the SQL query?
   - [ ] What fields does the query return for each record?
   - [ ] Is `StageName` (opportunity stage) included in the returned fields?
   - [ ] What is the `is_*` flag pattern for each funnel stage?

   ```
   ### Findings:
   <!-- Cursor: Document the query structure and returned fields -->
   ```

2. **Read the API route `src/app/api/dashboard/detail-records/route.ts`** (or similar):
   - [ ] What parameters does the API accept?
   - [ ] How is the response structured?

   ```
   ### Findings:
   <!-- Cursor: Document the API endpoint signature and response structure -->
   ```

3. **Examine `src/lib/api-client.ts`**:
   - [ ] What is the signature for `dashboardApi.getDetailRecords()`?
   - [ ] What default limit is used?

   ```
   ### Findings:
   <!-- Cursor: Document the API client method signature -->
   ```

### 2.2 DetailRecord Type Analysis

**Objective:** Confirm the data structure returned by queries.

#### Investigation Steps:

1. **Read `src/types/dashboard.ts`** (or similar types file):
   - [ ] What is the complete `DetailRecord` interface?
   - [ ] Does it include: `isContacted`, `isMql`, `isSql`, `isSqo`, `isJoined`?
   - [ ] Does it include `isOpenPipeline` or similar?
   - [ ] Does it include `stage` or `stageName` for opportunity stages?

   ```
   ### Findings:
   <!-- Cursor: Document the DetailRecord interface with all fields -->
   ```

2. **Critical Question for Client-Side Filtering:**
   - [ ] When we fetch records with `metricFilter: 'prospect'`, do the returned records include the boolean flags needed to filter to other stages client-side?
   - [ ] If not, what additional data needs to be included in the prospect query?

   ```
   ### Findings:
   <!-- Cursor: Document whether prospect records include stage flags -->
   <!-- This is CRITICAL for the client-side filtering approach -->
   ```

---

## Phase 3: Edge Cases and Potential Issues

### 3.1 Data Completeness Check

**Objective:** Identify potential issues with the client-side filtering approach.

#### Investigation Steps:

1. **Verify Prospect vs Stage Relationship:**
   - [ ] Are all SQLs/SQOs/Joined records also counted as Prospects?
   - [ ] Or are Prospects a separate, non-overlapping set?
   - [ ] This determines if client-side filtering from Prospects is even possible.

   ```
   ### Findings:
   <!-- Cursor: Document the relationship between Prospects and other stages -->
   <!-- If Prospects are NOT a superset, the enhancement plan needs revision -->
   ```

2. **Check for Opportunity Stage Data:**
   - [ ] Does `vw_funnel_master` include the `StageName` field from opportunities?
   - [ ] What are the possible values for opportunity stages?
   - [ ] Are opportunity stages available on Lead-level records or only Opportunity-level?

   ```
   ### Findings:
   <!-- Cursor: Document opportunity stage data availability -->
   ```

### 3.2 Performance Considerations

**Objective:** Identify potential performance issues.

#### Investigation Steps:

1. **Check record volume:**
   - [ ] What is the typical count of Prospect records for a quarter?
   - [ ] Is loading 50,000 prospects a concern for performance?

   ```
   ### Findings:
   <!-- Cursor: Note any performance concerns discovered -->
   ```

2. **Check existing pagination:**
   - [ ] Does DetailRecordsTable paginate client-side or request paginated data?
   - [ ] If client-side filtering removes pagination benefits, document this risk.

   ```
   ### Findings:
   <!-- Cursor: Document pagination implementation details -->
   ```

---

## Phase 4: Existing Patterns and Reusable Code

### 4.1 Similar Modal Patterns

**Objective:** Find existing patterns to follow for consistency.

#### Investigation Steps:

1. **Search for other drill-down modals in the codebase:**
   - [ ] Is there a `MetricDrillDownModal` component?
   - [ ] How does SGA Hub implement drill-down? (check `src/components/sga-hub/`)
   - [ ] Are there reusable modal patterns?

   ```
   ### Findings:
   <!-- Cursor: Document similar modal patterns found -->
   ```

2. **Check SGA Hub implementation for reference:**
   - [ ] How does `src/components/sga-hub/MetricDrillDownModal.tsx` work?
   - [ ] Can this pattern be reused or adapted?

   ```
   ### Findings:
   <!-- Cursor: Document SGA Hub drill-down implementation -->
   ```

### 4.2 Dropdown Component Patterns

**Objective:** Find existing dropdown patterns to follow.

#### Investigation Steps:

1. **Search for existing filter dropdowns:**
   - [ ] How is the SGA/SGM dropdown implemented in `GlobalFilters.tsx`?
   - [ ] Is there a reusable Select component?
   - [ ] What styling patterns are used for dropdowns?

   ```
   ### Findings:
   <!-- Cursor: Document existing dropdown patterns and components -->
   ```

---

## Phase 5: State Management Verification

### 5.1 Dashboard Page State

**Objective:** Understand the current state management.

#### Investigation Steps:

1. **Inventory all state variables in `src/app/dashboard/page.tsx`:**
   - [ ] List all `useState` calls and their purposes
   - [ ] Identify which states are affected by this enhancement
   - [ ] Check for any state that might conflict with new additions

   ```
   ### Findings:
   <!-- Cursor: List relevant state variables -->
   ```

2. **Check for useCallback/useMemo dependencies:**
   - [ ] What are the dependencies of `fetchDashboardData`?
   - [ ] Will removing `selectedMetric` as a dependency break anything?

   ```
   ### Findings:
   <!-- Cursor: Document callback dependencies that will be affected -->
   ```

### 5.2 Filter State Structure

**Objective:** Understand the filter state structure.

#### Investigation Steps:

1. **Read `src/types/filters.ts`**:
   - [ ] What is the `DashboardFilters` interface?
   - [ ] What are the valid values for `metricFilter`?
   - [ ] Will the new stage filter need to be added here?

   ```
   ### Findings:
   <!-- Cursor: Document the DashboardFilters interface -->
   ```

---

## Phase 6: Testing and Verification Paths

### 6.1 Ground Truth Verification

**Objective:** Ensure changes can be validated.

#### Investigation Steps:

1. **Review `docs/GROUND-TRUTH.md`:**
   - [ ] Are there expected values for Prospect counts?
   - [ ] Can the new functionality be validated against known values?

   ```
   ### Findings:
   <!-- Cursor: Document relevant ground truth values for testing -->
   ```

### 6.2 Existing Test Coverage

**Objective:** Understand current test coverage.

#### Investigation Steps:

1. **Search for existing tests:**
   - [ ] Are there tests for `DetailRecordsTable`?
   - [ ] Are there tests for `Scorecards` or `FullFunnelScorecards`?
   - [ ] Are there integration tests for the dashboard page?

   ```
   ### Findings:
   <!-- Cursor: Document existing test coverage -->
   ```

---

## Phase 7: Final Document Updates

After completing all investigations above, update `funnel_performance_enhancement.md` with:

### 7.1 Required Updates Checklist

- [ ] **Update handleMetricClick implementation:** Add exact current code with line numbers
- [ ] **Confirm VolumeDrillDownModal type change:** Verify the exact type to change
- [ ] **Add DetailRecord interface:** Include the actual fields for client-side filtering
- [ ] **Document the stage flag fields:** Confirm exact field names (`isSql`, `is_sql`, etc.)
- [ ] **Add opportunity stage logic:** Document how to extract unique opportunity stages
- [ ] **Update the filteredDetailRecords logic:** Ensure it uses correct field names
- [ ] **Add performance warning:** If >10,000 records typical, note potential lag
- [ ] **Document API changes needed:** If prospect query needs additional fields, specify
- [ ] **Add rollback plan:** Document how to revert if issues occur
- [ ] **Add deployment notes:** Note any cache invalidation or build requirements

### 7.2 Enhancement Document Additions

Add the following new sections to `funnel_performance_enhancement.md`:

```markdown
## Prerequisites

### Required Code Knowledge
<!-- Add discovered details about existing code -->

### Dependencies
<!-- List any dependencies on other components or data -->

## Data Model Confirmation

### DetailRecord Interface
<!-- Include the actual interface from findings -->

### Field Name Mappings
<!-- Document exact field names for each stage filter -->

## Risk Assessment

### Performance Risks
<!-- Document any discovered performance concerns -->

### Data Completeness Risks
<!-- Document any issues with the client-side filtering approach -->

## Rollback Plan
<!-- Add steps to revert changes if needed -->
```

---

## Summary: Key Questions to Answer

Before implementation can proceed, ensure these critical questions are answered:

1. **Data Question:** Do Prospect records include all the boolean flags (`isSql`, `isSqo`, etc.) needed for client-side filtering?

2. **Type Question:** What is the exact current type of `metricFilter` in `VolumeDrillDownModal` and `DashboardFilters`?

3. **Field Names:** What are the exact field names on `DetailRecord` for each stage flag?

4. **Opportunity Stages:** Is `stageName` or `stage` available on detail records, and what are the possible values?

5. **Volume Question:** Is loading all Prospects (potentially 50,000+) and filtering client-side performant enough?

6. **Dependency Question:** What callbacks/effects depend on `selectedMetric` that will need updating?

---

*After completing this investigation, Cursor should have all the information needed to update `funnel_performance_enhancement.md` into a comprehensive, executable implementation plan.*
