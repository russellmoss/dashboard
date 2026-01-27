# SGA Leaderboard Feature - Phased Implementation Guide

**Purpose**: This document guides cursor.ai through building the SGA Leaderboard feature with a systematic, phase-by-phase approach. Cursor.ai will work through each phase, answer discovery questions, update the implementation document, and report findings before moving to the next phase.

---

## 📋 BEFORE YOU START

### Validation Data Reference
Keep these validation points handy throughout implementation:

**Q4 2025 Validation**:
- Perry Kalmeta: 5 SQOs

**QTD 2026 (Q1) Validation**:
- Perry Kalmeta: 0 SQOs
- Brian O'Hara: 4 SQOs
  - Daniel Di Lascia
  - John Goltermann
  - Ethan Freishtat
  - J. Ian Scroggs

### Active SGA Exclusion List
Based on codebase analysis, exclude these names from leaderboard:
- Anett Diaz
- Jacqueline Tully
- Savvy Operations
- Savvy Marketing
- Russell Moss
- Jed Entin

---

## PHASE 1: Discovery & Schema Validation

**Goal**: Verify BigQuery schema, understand existing query patterns, and validate the data before writing any code.

### Questions to Answer:

1. **BigQuery Schema Discovery**
   - [ ] What is the exact table/view name for SQO data? (Check `src/config/constants.ts` for `FUNNEL_VIEW`)
   - [ ] What are the exact column names for:
     - SGA name field?
     - SQO identification field?
     - SQO date field?
     - Quarter/year fields?
     - Channel field?
     - Source field?
   - [ ] Run a test query to verify these fields exist and have data

2. **Existing Pattern Analysis**
   - [ ] How does `src/lib/queries/quarterly-progress.ts` query SQO data?
   - [ ] What is the exact WHERE clause used to filter active SGAs?
   - [ ] How are quarters calculated in existing code?
   - [ ] What date field is used for SQO timing?

3. **Validation Query**
   - [ ] Write and execute a BigQuery query to verify the validation data:
     - Q4 2025: Perry Kalmeta should have 5 SQOs
     - QTD 2026: Perry Kalmeta should have 0, Brian O'Hara should have 4
   - [ ] Document the exact query used and the results

### Deliverables:
Update `C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md` with:
- Exact table/view name
- Column name mappings
- Sample validation query and results
- Any discrepancies found

### Report Back:
After completing this phase, provide:
1. Summary of schema findings
2. Validation query results (pass/fail)
3. Any issues or concerns discovered
4. Confirmation to proceed to Phase 2

---

## PHASE 2: Data Layer Design

**Goal**: Design the query function and type definitions needed for the leaderboard.

### Questions to Answer:

1. **Query Function Design**
   - [ ] What parameters does the leaderboard query need?
     - Quarter (Q1, Q2, Q3, Q4)
     - Year (2024, 2025, 2026)
     - Channels (array, default to ["Outbound", "Outbound + Marketing"])
     - Sources (array, optional)
   - [ ] How should we handle "QTD" logic?
   - [ ] Should the query return SQO IDs for drill-down, or just counts?

2. **Type Definitions**
   - [ ] What should the `LeaderboardEntry` type include?
     ```typescript
     type LeaderboardEntry = {
       sgaName: string;
       sqoCount: number;
       rank: number;
       // What else?
     }
     ```
   - [ ] Do we need a separate type for drill-down SQO details?

3. **File Structure**
   - [ ] Should we create `src/lib/queries/sga-leaderboard.ts`?
   - [ ] Should we add types to `src/types/sga-hub.ts` or create `src/types/leaderboard.ts`?

### Deliverables:
Update `C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md` with:
- Complete type definitions
- Query function signature
- Query SQL structure (don't write full SQL yet, just outline)
- File locations

### Report Back:
After completing this phase, provide:
1. Proposed type definitions
2. Query function design
3. Any design decisions made
4. Confirmation to proceed to Phase 3

---

## PHASE 3: Backend Implementation

**Goal**: Implement the query function and API route.

### Questions to Answer:

1. **Query Implementation**
   - [ ] Write the full BigQuery query in `src/lib/queries/sga-leaderboard.ts`
   - [ ] Does the query properly exclude inactive SGAs?
   - [ ] Does it handle the default channels correctly?
   - [ ] Does it calculate QTD correctly?

2. **API Route**
   - [ ] Create `src/app/api/sga-hub/leaderboard/route.ts`
   - [ ] Should it be GET or POST? (Check existing patterns in `src/app/api/sga-hub/`)
   - [ ] What authentication/authorization is needed? (SGA role can view all?)
   - [ ] How should we structure the request/response?

3. **Testing**
   - [ ] Test the query with validation data:
     - Q4 2025: Perry should have 5
     - QTD 2026: Perry should have 0, Brian should have 4
   - [ ] Test with different channel filters
   - [ ] Test with different quarters/years

### Deliverables:
Update `C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md` with:
- Complete query implementation
- API route implementation
- Test results against validation data
- Any bugs or issues found

### Report Back:
After completing this phase, provide:
1. Confirmation that validation data passes
2. Any query issues or adjustments made
3. API route structure
4. Confirmation to proceed to Phase 4

---

## PHASE 4: Drill-Down Implementation

**Goal**: Implement the drill-down modal to show individual SQOs.

### Questions to Answer:

1. **Drill-Down Query**
   - [ ] Do we need a separate query function for drill-down?
   - [ ] Should it reuse existing drill-down patterns from `src/lib/queries/drill-down.ts`?
   - [ ] What information should we show for each SQO?
     - Advisor name
     - Date became SQO
     - Source/Channel
     - What else?

2. **API Route**
   - [ ] Create `src/app/api/sga-hub/leaderboard/drill-down/route.ts`?
   - [ ] Or add drill-down logic to the main leaderboard route?
   - [ ] How should it accept parameters (sgaName, quarter, year, channels, sources)?

3. **Validation**
   - [ ] Can we drill down on Brian O'Hara's 4 SQOs and see:
     - Daniel Di Lascia
     - John Goltermann
     - Ethan Freishtat
     - J. Ian Scroggs

### Deliverables:
Update `C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md` with:
- Drill-down query design
- Drill-down API route (if separate)
- Test results showing Brian's 4 SQOs

### Report Back:
After completing this phase, provide:
1. Drill-down implementation approach
2. Validation results (can we see Brian's 4 specific SQOs?)
3. Any issues with drill-down data
4. Confirmation to proceed to Phase 5

---

## PHASE 5: Frontend Components

**Goal**: Create the leaderboard UI component and integrate with existing tabs.

### Questions to Answer:

1. **Tab Integration**
   - [ ] Look at `src/components/sga-hub/SGAHubTabs.tsx` - how are tabs defined?
   - [ ] How do we add "Leaderboard" as the first tab?
   - [ ] What's the tab value/ID? ("leaderboard"?)

2. **Leaderboard Component**
   - [ ] Create `src/components/sga-hub/LeaderboardTable.tsx`?
   - [ ] How should we display medals for 1st, 2nd, 3rd?
     - Unicode medals (🥇🥈🥉)?
     - Custom SVG icons?
     - Use lucide-react icons?
   - [ ] Should we use Tremor Table component or build custom?

3. **Filter Component**
   - [ ] How do we implement quarter/year filters?
   - [ ] How do we implement channel multi-select (default to Outbound + Outbound + Marketing)?
   - [ ] How do we implement source multi-select?
   - [ ] Should filters be in the component or in parent page?

4. **Drill-Down Modal**
   - [ ] Can we reuse `src/components/sga-hub/MetricDrillDownModal.tsx`?
   - [ ] Or do we need a custom modal?
   - [ ] How do we integrate with `RecordDetailModal` for clicking individual SQOs?

### Deliverables:
Update `C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md` with:
- Component file structure
- Filter implementation approach
- Medal/ranking UI design
- Drill-down modal integration plan

### Report Back:
After completing this phase, provide:
1. Component structure and file locations
2. UI/UX design decisions
3. Filter implementation approach
4. Confirmation to proceed to Phase 6

---

## PHASE 6: Integration & State Management

**Goal**: Wire up the leaderboard tab in the SGA Hub page.

### Questions to Answer:

1. **Page Integration**
   - [ ] Update `src/app/dashboard/sga-hub/SGAHubContent.tsx` to include leaderboard tab
   - [ ] How do we manage leaderboard state?
     - Selected quarter/year
     - Selected channels
     - Selected sources
     - Leaderboard data
     - Drill-down state
   - [ ] Where should we fetch the leaderboard data? (useEffect?)

2. **API Client**
   - [ ] Add leaderboard functions to `src/lib/api-client.ts`?
   - [ ] What should the function signatures be?

3. **Tab Routing**
   - [ ] When user clicks "Leaderboard" tab, what state changes?
   - [ ] Do we need URL query params to persist tab selection?

### Deliverables:
Update `C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md` with:
- State management approach
- API client functions
- Integration code snippets

### Report Back:
After completing this phase, provide:
1. State management decisions
2. Any issues with tab integration
3. Confirmation to proceed to Phase 7

---

## PHASE 7: Styling & Polish

**Goal**: Make the leaderboard beautiful and professional.

### Questions to Answer:

1. **Medal Styling**
   - [ ] How should we style the top 3 entries differently?
   - [ ] Should we use gradient backgrounds?
   - [ ] What colors for 1st, 2nd, 3rd place?

2. **Table Styling**
   - [ ] Should we use zebra striping?
   - [ ] How should we highlight the current user (if they're an SGA)?
   - [ ] Mobile responsiveness - how does it look on mobile?

3. **Loading States**
   - [ ] What should we show while loading?
   - [ ] Skeleton loaders?
   - [ ] Loading spinner?

4. **Empty States**
   - [ ] What if no SGAs have SQOs in the selected period?
   - [ ] What message should we show?

### Deliverables:
Update `C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md` with:
- Styling decisions
- Loading/empty state handling
- Mobile responsiveness notes

### Report Back:
After completing this phase, provide:
1. Styling approach and decisions
2. Screenshots or descriptions of loading/empty states
3. Mobile responsiveness status
4. Confirmation to proceed to Phase 8

---

## PHASE 8: Testing & Validation

**Goal**: Thoroughly test the feature against all validation criteria.

### Test Cases:

1. **Data Validation Tests**
   - [ ] Q4 2025: Verify Perry Kalmeta shows 5 SQOs
   - [ ] QTD 2026: Verify Perry shows 0, Brian shows 4
   - [ ] Drill-down on Brian: Verify 4 specific names appear
   - [ ] Verify excluded SGAs don't appear in leaderboard

2. **Filter Tests**
   - [ ] Default filters: QTD, Outbound + Outbound + Marketing selected
   - [ ] Change quarter: Verify data updates correctly
   - [ ] Change year: Verify data updates correctly
   - [ ] Change channels: Verify filtering works
   - [ ] Change sources: Verify filtering works
   - [ ] Combine multiple filters: Verify they work together

3. **UI/UX Tests**
   - [ ] Tab appears first in SGA Hub
   - [ ] Medals display correctly for top 3
   - [ ] Clicking SQO count opens drill-down modal
   - [ ] Drill-down modal shows correct data
   - [ ] Clicking individual SQO opens record detail modal
   - [ ] Back button works from record detail to drill-down
   - [ ] Loading states work correctly
   - [ ] Empty states work correctly

4. **Permission Tests**
   - [ ] SGA role can view leaderboard
   - [ ] Admin role can view leaderboard
   - [ ] Manager role can view leaderboard
   - [ ] Are there any permission restrictions? (Or is it open to all SGA Hub users?)

5. **Edge Cases**
   - [ ] What happens with tie scores?
   - [ ] What happens with 0 SQOs for everyone?
   - [ ] What happens with invalid quarter/year selection?
   - [ ] What happens if API fails?

### Deliverables:
Update `C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md` with:
- Test results for all test cases
- Any bugs found and fixes applied
- Edge case handling documentation

### Report Back:
After completing this phase, provide:
1. Full test results (pass/fail for each test case)
2. List of any bugs found and how they were fixed
3. Any remaining issues or concerns
4. Confirmation feature is ready for production

---

## PHASE 9: Documentation & Cleanup

**Goal**: Document the feature and clean up any code.

### Questions to Answer:

1. **Code Documentation**
   - [ ] Are all functions properly commented?
   - [ ] Are all types properly documented?
   - [ ] Are there any TODOs or FIXMEs left?

2. **Architecture Documentation**
   - [ ] Should we update `docs/ARCHITECTURE.md` with leaderboard feature?
   - [ ] Should we add to any other docs?

3. **Code Cleanup**
   - [ ] Remove any console.logs
   - [ ] Remove any commented-out code
   - [ ] Run linter and fix any issues
   - [ ] Verify TypeScript compiles with no errors

### Deliverables:
- Updated `docs/ARCHITECTURE.md` (if needed)
- Clean, documented code
- Final version of `C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md` with all implementation details

### Report Back:
After completing this phase, provide:
1. Confirmation all code is documented
2. Confirmation all linting/TypeScript errors are resolved
3. Final summary of the feature implementation
4. Feature is complete and ready for production

---

## 🎯 Cursor.ai Execution Instructions

**Use this prompt to start cursor.ai:**

```
I have a phased implementation document for building an SGA Leaderboard feature. The document is located at C:\Users\russe\Documents\Dashboard\SGA_Leaderboard_Phases.md.

Please work through this document ONE PHASE AT A TIME:

1. Start with Phase 1: Discovery & Schema Validation
2. Answer ALL questions in the phase by examining the codebase and running BigQuery queries via MCP
3. Update C:\Users\russe\Documents\Dashboard\SGA_leaderboard.md with your findings (append new sections, don't replace existing content)
4. After completing the phase, provide a summary of:
   - What you discovered
   - What decisions you made
   - Any issues or concerns
   - Test results (if applicable)
5. STOP and ask me: "Phase [N] complete. Should I proceed to Phase [N+1]?"
6. WAIT for my confirmation before moving to the next phase

DO NOT skip ahead to future phases. Complete each phase thoroughly before asking to proceed.

Let's begin with Phase 1: Discovery & Schema Validation.
```

---

## 📝 Notes for Cursor.ai

- **Always reference validation data**: Keep the validation numbers in mind when writing queries
- **Follow existing patterns**: Look at `src/lib/queries/quarterly-progress.ts` and `src/lib/queries/drill-down.ts` for patterns to follow
- **Use MCP for BigQuery**: Test all queries via MCP before implementing them in code
- **Document everything**: Update `SGA_leaderboard.md` with all findings, decisions, and code snippets
- **Don't rush**: Each phase builds on the previous one. Take time to get each phase right.
- **Ask questions**: If you're unsure about something, note it in your phase summary

---

## ✅ Success Criteria

The feature is complete when:
- [ ] All validation data passes (Perry's 5 SQOs in Q4 2025, Brian's 4 in QTD 2026)
- [ ] Leaderboard appears as first tab in SGA Hub
- [ ] Default filters work (QTD, Outbound + Outbound + Marketing)
- [ ] All filters work correctly
- [ ] Drill-down shows individual SQOs
- [ ] Record detail modal works for individual SQOs
- [ ] Medals display for top 3
- [ ] Excluded SGAs don't appear
- [ ] All tests pass
- [ ] Code is clean, documented, and linted
- [ ] TypeScript compiles with no errors
