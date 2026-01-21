# Custom Reporting Feature - Codebase Questions for Cursor AI

## Purpose

This document contains comprehensive questions about the existing codebase implementation. The answers will be used to create a step-by-step agentic development plan for implementing a "Saved Reports" feature with customizable feature selection.

**Goal**: Users can save filter presets AND choose which dashboard components (scorecards, charts, tables) appear in their saved report. When they load a saved report, it applies both the filters AND shows only their selected features.

---

## Section 1: Dashboard Page Structure

### 1.1 Main Dashboard Component

**Questions:**

1. What is the exact file path and component name for the main Funnel Performance dashboard page?

2. Please provide the complete list of child components rendered on this page, in order of appearance, with their import paths. For example:
   ```typescript
   // Example format needed:
   import { FunnelScorecard } from '@/components/dashboard/FunnelScorecard';
   import { ConversionTrendsChart } from '@/components/dashboard/ConversionTrendsChart';
   // etc.
   ```

3. How is the dashboard page structured? Please provide the JSX structure showing where each major section (scorecards, charts, tables) is rendered, including any wrapper divs, grid layouts, or conditional rendering.

4. Is there an existing "view mode" concept (e.g., "Full Funnel" vs other modes)? If so:
   - What are the available view modes?
   - Where is the view mode state managed?
   - How does view mode affect which components are shown?

---

## Section 2: Scorecards Implementation

### 2.1 Volume Scorecards (SQLs, SQOs, Signed, Joined, Open Pipeline)

**Questions:**

1. What is the component file path for the volume scorecards?

2. What props does this component accept? Please provide the full TypeScript interface.

3. How is the data for these scorecards fetched? What API endpoint(s) provide the data?

4. Are all 5 volume scorecards rendered by a single component, or are they individual components? If single, how does it know which metrics to display?

5. Is there any existing conditional rendering logic (e.g., hiding certain cards based on props or state)?

### 2.2 Full Funnel Scorecards (Prospects, Contacted, MQLs)

**Questions:**

1. What is the component file path for the full funnel scorecards (Prospects, Contacted, MQLs)?

2. Are these part of the same component as volume scorecards, or a separate component?

3. What is the conditional logic that shows/hides these based on "Full Funnel" view mode? Please provide the exact code snippet.

4. What props control visibility of these cards?

### 2.3 Conversion Rate Cards

**Questions:**

1. What is the component file path for the conversion rate cards?

2. What props does this component accept? Please provide the full TypeScript interface.

3. Are all 4 conversion rate cards (Contacted→MQL, MQL→SQL, SQL→SQO, SQO→Joined) rendered together or separately?

4. How is conversion rate data calculated — on the frontend from raw counts, or pre-calculated by the API?

---

## Section 3: Charts Implementation

### 3.1 Conversion Trends Chart

**Questions:**

1. What is the exact file path for the Conversion Trends Chart component?

2. What props does this component accept? Please provide the full TypeScript interface.

3. What charting library is used (Recharts, Chart.js, Tremor charts, etc.)?

4. How does the Cohort vs Period toggle work? Please provide:
   - Where is this toggle state managed?
   - What is the state variable name?
   - How does it affect the data displayed?

5. How does the Monthly/Quarterly granularity toggle work?

6. What API endpoint provides the data for this chart?

7. Does this chart have any click/drill-down functionality? If so, how is it implemented?

### 3.2 Volume Trends Chart

**Questions:**

1. What is the exact file path for the Volume Trends Chart component?

2. What props does this component accept? Please provide the full TypeScript interface.

3. How do the clickable bars for drill-down work? Please provide:
   - The click handler function
   - What modal or action is triggered
   - How the clicked data point is passed to the drill-down

4. What API endpoint provides the data for this chart?

---

## Section 4: Tables Implementation

### 4.1 Channel Performance Table

**Questions:**

1. What is the exact file path for the Channel Performance Table component?

2. What props does this component accept? Please provide the full TypeScript interface.

3. How does column visibility work based on view mode (e.g., "fullFunnel only" columns)?
   - Is this controlled by props, internal state, or both?
   - Please provide the conditional rendering code for fullFunnel-only columns.

4. How do clickable rows work to filter by channel?
   - What function is called on row click?
   - How does it update the global filters?

5. How is sorting implemented? Is it client-side or server-side?

6. What API endpoint provides the data?

### 4.2 Source Performance Table

**Questions:**

1. What is the exact file path for the Source Performance Table component?

2. What props does this component accept? Please provide the full TypeScript interface.

3. How does the "filtered by selected channel" logic work?

4. How do clickable rows work to filter by source?

5. What API endpoint provides the data?

### 4.3 Detail Records Table

**Questions:**

1. What is the exact file path for the Detail Records Table component?

2. What props does this component accept? Please provide the full TypeScript interface.

3. How does the stage filter dropdown work?
   - What are all the stage options?
   - How does selecting a stage affect the API query?

4. How does the search functionality work?
   - Is it debounced?
   - Does it filter client-side or make new API calls?

5. How does pagination work?
   - Is it client-side or server-side pagination?
   - What state variables control current page?

6. How do clickable rows work to view record details?
   - What modal is opened?
   - What data is passed to the modal?

7. How do the conditional columns work (Initial Call Scheduled, Qualification Call shown only when advanced filters are enabled)?

8. What API endpoint provides the data?

---

## Section 5: Drill-Down & Modal Functionality

### 5.1 Record Detail Modal

**Questions:**

1. What is the exact file path for the RecordDetailModal component?

2. What props does this component accept? Please provide the full TypeScript interface.

3. How is the modal opened and closed?
   - What state variable controls visibility?
   - Where is this state managed (parent component)?

4. What data does the modal display and how is it structured?

5. Does the modal fetch additional data, or does it use data passed via props?

### 5.2 Volume Drill-Down Modal

**Questions:**

1. What is the exact file path for the VolumeDrillDownModal component?

2. What props does this component accept? Please provide the full TypeScript interface.

3. When is this modal triggered (which chart/scorecard clicks)?

4. What data does it display?

### 5.3 Other Drill-Down Modals

**Questions:**

1. Are there any other drill-down or detail modals in the dashboard?

2. For each one found, please provide:
   - File path
   - Props interface
   - Trigger condition
   - Purpose

---

## Section 6: Data Fetching Patterns

### 6.1 Dashboard Data Fetching

**Questions:**

1. In `src/app/dashboard/page.tsx`, how is dashboard data fetched? Please provide:
   - The `fetchDashboardData` function (or equivalent)
   - All API endpoints called
   - How data is stored in state
   - How data is passed to child components

2. Is data fetching done in parallel or sequentially?

3. Is there any caching or memoization of dashboard data?

4. How are loading states managed for each section?

5. How are error states managed for each section?

### 6.2 API Response Structures

**Questions:**

For each of these API endpoints, please provide the TypeScript response type:

1. `/api/dashboard/funnel-metrics` (or equivalent for scorecards)
2. `/api/dashboard/conversion-trends` (or equivalent for conversion chart)
3. `/api/dashboard/volume-trends` (or equivalent for volume chart)
4. `/api/dashboard/channel-performance`
5. `/api/dashboard/source-performance`
6. `/api/dashboard/detail-records`

---

## Section 7: Existing Visibility/Toggle Patterns

### 7.1 View Mode Implementation

**Questions:**

1. If there's an existing view mode system, please provide:
   - The ViewMode type definition
   - Where view mode state is stored
   - How components check view mode to conditionally render
   - The UI element that toggles view mode

2. Are there any other existing "show/hide" toggles for dashboard components? If so, how are they implemented?

### 7.2 User Preferences

**Questions:**

1. Is there any existing user preferences system that stores UI preferences?

2. If users can already customize any aspect of the dashboard view, how is that implemented?

---

## Section 8: Component Identification for Feature Selection

### 8.1 Component Registry

Based on the features the user wants to toggle, please confirm or correct the following component mapping:

| Feature Name | Expected Component | File Path | Confirm/Correct |
|-------------|-------------------|-----------|-----------------|
| Prospects Scorecard | ? | ? | |
| Contacted Scorecard | ? | ? | |
| MQLs Scorecard | ? | ? | |
| SQLs Scorecard | ? | ? | |
| SQOs Scorecard | ? | ? | |
| Signed Scorecard | ? | ? | |
| Joined Scorecard | ? | ? | |
| Open Pipeline Scorecard | ? | ? | |
| Contacted→MQL Rate Card | ? | ? | |
| MQL→SQL Rate Card | ? | ? | |
| SQL→SQO Rate Card | ? | ? | |
| SQO→Joined Rate Card | ? | ? | |
| Conversion Trends Chart | ? | ? | |
| Volume Trends Chart | ? | ? | |
| Channel Performance Table | ? | ? | |
| Source Performance Table | ? | ? | |
| Detail Records Table | ? | ? | |

### 8.2 Component Granularity

**Questions:**

1. For scorecards: Can individual scorecards be hidden independently, or are they rendered as a group that must be shown/hidden together?

2. For conversion rate cards: Same question — individual or group?

3. For tables: Can each table be independently shown/hidden?

4. What is the minimum viable "feature selection" granularity given the current component structure? (i.e., what groupings make sense?)

---

## Section 9: State Management Details

### 9.1 Filter State

**Questions:**

1. Please provide the complete `DashboardFilters` type definition from `src/types/filters.ts`.

2. Please provide the `DEFAULT_FILTERS` constant.

3. Please provide the complete `AdvancedFilters` type definition if not already shown.

### 9.2 Dashboard State

**Questions:**

1. What other state variables exist in the main dashboard page besides `filters`? Please list all `useState` hooks with their types.

2. Is there any derived state or `useMemo` for computed values?

---

## Section 10: Layout and Styling

### 10.1 Dashboard Layout

**Questions:**

1. What CSS/layout system is used for the dashboard grid (Tailwind, CSS Grid, Flexbox)?

2. How are the scorecards laid out (grid columns, responsive breakpoints)?

3. How are the charts laid out relative to each other?

4. How are the tables laid out?

5. Is there a consistent pattern for section spacing and organization?

### 10.2 Dark Mode

**Questions:**

1. How is dark mode implemented?

2. Do components need any special handling for dark mode, or is it automatic via Tailwind classes?

---

## Section 11: Feature Selection Schema Design

### 11.1 Proposed Schema

Based on the answers above, I'll need to design a `FeatureSelection` type to store in the saved report. Please review this proposed structure and suggest improvements based on actual component granularity:

```typescript
interface FeatureSelection {
  scorecards: {
    prospects: boolean;      // Full Funnel only
    contacted: boolean;      // Full Funnel only
    mqls: boolean;          // Full Funnel only
    sqls: boolean;
    sqos: boolean;
    signed: boolean;
    joined: boolean;
    openPipeline: boolean;
  };
  conversionRates: {
    contactedToMql: boolean;
    mqlToSql: boolean;
    sqlToSqo: boolean;
    sqoToJoined: boolean;
  };
  charts: {
    conversionTrends: boolean;
    volumeTrends: boolean;
  };
  tables: {
    channelPerformance: boolean;
    sourcePerformance: boolean;
    detailRecords: boolean;
  };
}
```

**Questions:**

1. Does this structure match the actual component granularity, or do some items need to be grouped differently?

2. Are there any features I'm missing that should be toggleable?

3. Are there any features that should NOT be independently toggleable (must always show together)?

---

## Section 12: Implementation Considerations

### 12.1 Performance

**Questions:**

1. If a user hides certain components, should the API calls for those components still be made? Or should we skip fetching data for hidden components?

2. If we skip fetching, how would we modify `fetchDashboardData` to conditionally fetch based on feature selection?

### 12.2 Default Feature Selection

**Questions:**

1. When a user creates a new saved report without explicitly selecting features, what should the default be? (All features visible? Match current view?)

2. For admin templates, should admins be able to lock certain features as always-visible or always-hidden?

### 12.3 Edge Cases

**Questions:**

1. What happens if a user in "non-Full Funnel" mode saves a report with Full Funnel scorecards selected? Should those be hidden anyway, or should the saved report override view mode?

2. Should feature selection be independent of view mode, or tied to it?

---

## Section 13: Existing Similar Patterns

### 13.1 Reference Implementations

**Questions:**

1. Are there any existing features in the codebase where users can customize which components are shown? If so, please provide the implementation as a reference.

2. Are there any existing "save configuration" patterns in the codebase?

3. Is there any existing use of localStorage for UI preferences?

---

## Section 14: GlobalFilters Component Deep Dive

### 14.1 Current Structure

**Questions:**

1. Please provide the complete props interface for the GlobalFilters component.

2. Please provide the complete JSX return statement of GlobalFilters (the render structure).

3. How much vertical/horizontal space does GlobalFilters currently take?

4. Is there room in the existing layout to add a "Saved Reports" dropdown and "Save" button, or will the layout need restructuring?

### 14.2 Dropdown Implementation

**Questions:**

1. Please provide an example of an existing dropdown/select implementation in GlobalFilters showing the pattern used.

2. If using Tremor Select component, please provide an import example and usage pattern from the codebase.

---

## Section 15: Error Boundaries

### 15.1 Error Handling

**Questions:**

1. How are error boundaries implemented for dashboard components?

2. Is there a shared ErrorBoundary component? If so, provide the file path and usage pattern.

3. How should errors in individual feature components be handled when other features are still working?

---

## Output Format

Please answer each section's questions with:

1. **Direct answers** with code snippets where requested
2. **File paths** always as full paths from project root
3. **Complete type definitions** — don't abbreviate with "..."
4. **Actual code** from the codebase, not pseudo-code
5. **Corrections** to any assumptions I've made that are incorrect

If any question cannot be answered because the feature doesn't exist, please state that clearly and suggest how it should be implemented.

---

## After Answering

Once these questions are answered, please update the `custom_reporting.md` file with a new section called "## Feature Selection Implementation Details" that summarizes:

1. The confirmed component mapping (feature name → component → file path)
2. The recommended `FeatureSelection` type structure
3. Any groupings or constraints discovered
4. Recommended approach for conditional rendering
5. Recommended approach for conditional data fetching
