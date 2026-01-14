# SGA Management & SGA Hub Upgrade - Cursor.ai Investigation Prompt

## Objective

Explore the Savvy Funnel Analytics Dashboard codebase to gather all information needed to implement the following upgrades to the SGA Hub and SGA Management pages:

1. **Improved Readability**: Larger numbers, full metric names (not abbreviations)
2. **Clickable Drill-Down**: Click on metric values (Initial Call, Qualification Call, SQO) to open a modal showing the underlying records
3. **Record Detail Integration**: Click on any row in the drill-down modal to see full record details (matching the existing RecordDetailModal pattern on Funnel Performance page)
4. **Closed Lost Follow-up Integration**: Add the same record detail drill-down capability to the Closed Lost tab in SGA Hub

**Output**: Create a comprehensive document at `SGA_MGMT_UPGRADE_ANSWERS.md` in the project root directory (`C:\Users\russe\Documents\Dashboard`) that answers ALL questions below.

---

## SECTION 1: Current SGA Management Page Analysis

### Questions to Answer:

#### 1.1 SGA Management Content Component
- **File**: `src/app/dashboard/sga-management/SGAManagementContent.tsx`
- **Questions**:
  - What is the exact current table structure (columns, headers)?
  - Where are the abbreviations "IC", "QC", "SQO" used and how are they rendered?
  - What state management is currently in place?
  - How are week and quarter selectors implemented?
  - What props does the AdminSGATable receive?

**Action**: Read the complete file and document the table rendering logic.

#### 1.2 AdminSGATable Component
- **File**: `src/components/sga-hub/AdminSGATable.tsx`
- **Questions**:
  - What columns are currently displayed in the main table?
  - How does the expandable row detail section work?
  - Where exactly are "IC:", "QC:", "SQO:" abbreviations rendered?
  - What data types are passed to this component?
  - How are the "Edit Weekly" and "Edit Quarterly" buttons implemented?
  - What CSS/Tailwind classes control the text sizes?

**Action**: Read the complete file and document:
- All column definitions
- The expandable row implementation
- All places where abbreviations appear
- Current font sizes and styling

#### 1.3 Current Week/Quarter Tables in Expanded Rows
- **Questions**:
  - What is the exact structure of the "Current Week" section in expanded rows?
  - What is the exact structure of the "Current Quarter" section?
  - What CSS grid layout is used (`grid-cols-[80px_1fr]`)?
  - How are Goal and Actual values displayed?

**Action**: Extract and document the exact JSX for the expanded row sections.

---

## SECTION 2: Current SGA Hub Page Analysis

### Questions to Answer:

#### 2.1 SGA Hub Content Component
- **File**: `src/app/dashboard/sga-hub/SGAHubContent.tsx`
- **Questions**:
  - What tabs exist and what components do they render?
  - What state is managed at the page level?
  - How is the Weekly Goals tab structured?
  - How is the Quarterly Progress tab structured?

**Action**: Read the complete file and document the tab structure.

#### 2.2 Weekly Goals Table
- **File**: `src/components/sga-hub/WeeklyGoalsTable.tsx`
- **Questions**:
  - What columns are displayed?
  - Are abbreviations used here too?
  - How are Goal vs Actual comparisons rendered?
  - What is the current font size for numbers?

**Action**: Read the complete file and document column structure and styling.

#### 2.3 Quarterly Progress Card
- **File**: `src/components/sga-hub/QuarterlyProgressCard.tsx`
- **Questions**:
  - How is the quarterly progress displayed?
  - Are there any clickable elements?
  - What data does it receive?

**Action**: Read and document the component structure.

---

## SECTION 3: RecordDetailModal Pattern Analysis

### Questions to Answer:

#### 3.1 RecordDetailModal Component
- **File**: `src/components/dashboard/RecordDetailModal.tsx`
- **Questions**:
  - What is the complete component structure?
  - What props does it accept (`isOpen`, `onClose`, `recordId`)?
  - How does it fetch record data (API call)?
  - What sections does it display (Funnel Progress, Attribution, Key Dates, Financials, Status)?
  - What helper components are used (`SectionHeader`, `DetailRow`, `DateRow`)?
  - How is loading state handled (`RecordDetailSkeleton`)?
  - How is dark mode supported?
  - What is the modal's width and max-height?

**Action**: Read the complete file and document:
- All props and their types
- The fetch logic (`dashboardApi.getRecordDetail`)
- Each section's structure and styling
- The helper components used internally

#### 3.2 FunnelProgressStepper Component
- **File**: `src/components/dashboard/FunnelProgressStepper.tsx`
- **Questions**:
  - What props does it accept?
  - How does it render the funnel stage visualization?

**Action**: Read and document the component.

#### 3.3 RecordDetailSkeleton Component
- **File**: `src/components/dashboard/RecordDetailSkeleton.tsx`
- **Questions**:
  - What is the loading skeleton structure?

**Action**: Read and document the component.

#### 3.4 Record Detail Types
- **File**: `src/types/record-detail.ts`
- **Questions**:
  - What is the `RecordDetailFull` interface structure?
  - What are all the fields available for display?

**Action**: Document the complete type definition.

#### 3.5 Record Detail API Route
- **File**: `src/app/api/dashboard/record-detail/[id]/route.ts`
- **Questions**:
  - How does the API fetch a single record?
  - What BigQuery query is used?
  - What error handling exists?

**Action**: Read and document the API implementation.

#### 3.6 Record Detail Query
- **File**: `src/lib/queries/record-detail.ts`
- **Questions**:
  - What is the full BigQuery query structure?
  - What fields are fetched from `vw_funnel_master`?
  - How is the raw data transformed to `RecordDetailFull`?

**Action**: Read and document the query function.

---

## SECTION 4: BigQuery Data Analysis for Drill-Down Modals

Use MCP to query BigQuery and answer:

### 4.1 Initial Calls Records
- **Query to run**:
```sql
SELECT 
  primary_key,
  advisor_name,
  SGA_Owner_Name__c,
  Initial_Call_Scheduled_Date__c,
  Original_source,
  Channel_Grouping_Name,
  Lead_Score_Tier__c,
  AUM__c,
  aum_tier,
  TOF_Stage,
  lead_url,
  opportunity_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = 'Tim Mackey'
  AND Initial_Call_Scheduled_Date__c IS NOT NULL
  AND Initial_Call_Scheduled_Date__c >= '2025-01-06'
  AND Initial_Call_Scheduled_Date__c <= '2025-01-12'
LIMIT 10
```
- **Questions**:
  - What fields are available for displaying in the drill-down modal?
  - What is the best unique identifier to use for fetching record details?
  - What date format is returned?

### 4.2 Qualification Calls Records
- **Query to run**:
```sql
SELECT 
  primary_key,
  advisor_name,
  SGA_Owner_Name__c,
  Qualification_Call_Date__c,
  Original_source,
  Channel_Grouping_Name,
  Lead_Score_Tier__c,
  AUM__c,
  aum_tier,
  TOF_Stage,
  Full_Opportunity_ID__c,
  opportunity_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = 'Tim Mackey'
  AND Qualification_Call_Date__c IS NOT NULL
  AND Qualification_Call_Date__c >= '2025-01-06'
  AND Qualification_Call_Date__c <= '2025-01-12'
LIMIT 10
```
- **Questions**:
  - What fields are available for displaying in the drill-down modal?
  - How does the data differ from Initial Calls?

### 4.3 SQO Records
- **Query to run**:
```sql
SELECT 
  primary_key,
  advisor_name,
  SGA_Owner_Name__c,
  Date_Became_SQO__c,
  Original_source,
  Channel_Grouping_Name,
  Lead_Score_Tier__c,
  AUM__c,
  Underwritten_AUM__c,
  aum_tier,
  TOF_Stage,
  StageName,
  opportunity_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = 'Tim Mackey'
  AND is_sqo_unique = 1
  AND Date_Became_SQO__c IS NOT NULL
  AND recordtypeid = '012Dn000000mrO3IAI'
ORDER BY Date_Became_SQO__c DESC
LIMIT 10
```
- **Questions**:
  - What fields are available for SQO drill-down?
  - What financial fields should be displayed (AUM, Underwritten AUM)?
  - How does the SQO record structure differ from Initial/Qual calls?

---

## SECTION 5: Closed Lost Tab Analysis

### Questions to Answer:

#### 5.1 ClosedLostTable Component
- **File**: `src/components/sga-hub/ClosedLostTable.tsx`
- **Questions**:
  - What columns are currently displayed?
  - Is there already row click functionality?
  - What data type is used (`ClosedLostRecord`)?
  - How is the time bucket filter implemented?
  - What actions are available on each row?

**Action**: Read the complete file and document:
- All column definitions
- Any existing click handlers
- The data structure being rendered

#### 5.2 Closed Lost Types
- **File**: `src/types/sga-hub.ts`
- **Questions**:
  - What is the `ClosedLostRecord` interface?
  - Does it include `primary_key` or another unique identifier?
  - What fields are available for detail display?

**Action**: Document the complete type definition.

#### 5.3 Closed Lost API
- **File**: `src/app/api/sga-hub/closed-lost/route.ts`
- **Questions**:
  - How does the API fetch closed lost records?
  - What BigQuery query is used?
  - What fields are returned?

**Action**: Read and document the API implementation.

#### 5.4 Closed Lost Query
- **File**: `src/lib/queries/closed-lost.ts` (if exists) or relevant query file
- **Questions**:
  - What is the full BigQuery query for closed lost records?
  - Does it include `primary_key` for record detail fetching?

**Action**: Find and document the query function.

---

## SECTION 6: API Client Analysis

### Questions to Answer:

#### 6.1 Dashboard API Client
- **File**: `src/lib/api-client.ts`
- **Questions**:
  - What is the structure of `dashboardApi`?
  - How is `getRecordDetail(id)` implemented?
  - What is the `apiFetch` helper pattern?

**Action**: Document the API client structure.

#### 6.2 SGA Hub API Functions
- **Questions**:
  - Is there an existing `sgaHubApi` or similar?
  - What functions exist for SGA Hub data fetching?
  - Where would new drill-down API calls be added?

**Action**: Document existing SGA Hub API functions.

---

## SECTION 7: UI Components and Styling Analysis

### Questions to Answer:

#### 7.1 Tremor Components Used
- **Questions**:
  - What Tremor components are used in the SGA tables (Table, TableHead, TableRow, TableCell)?
  - What Tremor components are used in the RecordDetailModal?
  - Are there custom styled components we should reuse?

**Action**: List all Tremor imports in SGA Hub and RecordDetailModal files.

#### 7.2 Modal Patterns
- **Questions**:
  - How is the Dialog component from Tremor used for modals?
  - What is the standard modal width (`max-w-4xl`, `max-w-5xl`)?
  - How is the close button implemented?
  - How is ESC key handling done?

**Action**: Document the modal implementation pattern.

#### 7.3 Number Formatting
- **Questions**:
  - What helper functions exist for number formatting (`formatCurrency`, `formatNumber`)?
  - Where are these located?
  - How should large numbers be displayed (e.g., "2" vs "02")?

**Action**: Document number formatting utilities.

#### 7.4 Badge/Status Indicators
- **Questions**:
  - How are status badges styled in RecordDetailModal?
  - What colors are used for different statuses?
  - Are there reusable badge components?

**Action**: Document badge styling patterns.

---

## SECTION 8: New Components to Create

Based on findings, design these new components:

### 8.1 MetricDrillDownModal Component
- **Purpose**: Display a table of records when clicking on IC/QC/SQO values
- **Questions to answer**:
  - What props should it accept? (`isOpen`, `onClose`, `metricType`, `records`, `title`)
  - What columns should be displayed for each metric type?
  - How should row click trigger RecordDetailModal?
  - What should the modal width be?

### 8.2 DrillDownTableRow Component
- **Purpose**: Reusable table row that opens record detail on click
- **Questions to answer**:
  - What props should it accept?
  - How should hover state be styled?
  - How should the click handler be implemented?

### 8.3 Enhanced AdminSGATable Columns
- **Purpose**: Replace "IC:", "QC:", "SQO:" with full names and clickable values
- **Questions to answer**:
  - What is the best way to make numbers clickable?
  - How should hover states indicate clickability?
  - What styling changes are needed for larger, more readable numbers?

---

## SECTION 9: API Routes to Create

### 9.1 Initial Calls Drill-Down API
- **Route**: `GET /api/sga-hub/drill-down/initial-calls`
- **Parameters**: `sgaName`, `weekStartDate`, `weekEndDate`
- **Questions**:
  - What fields should be returned?
  - How should date filtering work?
  - What BigQuery query structure?

### 9.2 Qualification Calls Drill-Down API
- **Route**: `GET /api/sga-hub/drill-down/qualification-calls`
- **Parameters**: `sgaName`, `weekStartDate`, `weekEndDate`
- **Questions**:
  - What fields should be returned?
  - How should it differ from initial calls?

### 9.3 SQO Drill-Down API
- **Route**: `GET /api/sga-hub/drill-down/sqos`
- **Parameters**: `sgaName`, `weekStartDate`, `weekEndDate` OR `quarter`
- **Questions**:
  - What fields should be returned?
  - How should weekly vs quarterly filtering work?
  - Should this reuse existing `sqo-details` API?

---

## SECTION 10: Type Definitions Needed

### 10.1 DrillDown Record Types
- **Questions**:
  - What type should `InitialCallRecord` have?
  - What type should `QualificationCallRecord` have?
  - What type should `SQODrillDownRecord` have?
  - Should these extend an existing base type?

### 10.2 MetricDrillDownModal Props Type
- **Questions**:
  - What is the full type definition for the modal props?
  - How should the `metricType` be typed?

---

## SECTION 11: Implementation Cross-Cutting Concerns

### 11.1 Shared Modal Pattern
- **Questions**:
  - How can the RecordDetailModal be reused in both Funnel Performance, SGA Hub, and SGA Management?
  - Should there be a shared hook like `useRecordDetail`?
  - How should nested modals work (DrillDown modal → Record Detail modal)?

### 11.2 State Management
- **Questions**:
  - What state needs to be tracked for the drill-down flow?
  - Should state be lifted to the page level or kept in components?
  - How should modal stacking be handled?

### 11.3 Loading and Error States
- **Questions**:
  - What loading skeleton should be used for drill-down tables?
  - How should errors be displayed?
  - What happens if the record detail fetch fails?

---

## SECTION 12: CSS/Styling Changes

### 12.1 Number Size Increases
- **Questions**:
  - Current font size for numbers (document with Tailwind classes)?
  - Recommended new font size (e.g., `text-lg`, `text-xl`, `text-2xl`)?
  - What padding/spacing adjustments are needed?

### 12.2 Full Label Names
- **Current**: "IC:", "QC:", "SQO:"
- **Desired**: "Initial Calls:", "Qualification Calls:", "SQO:"
- **Questions**:
  - Where exactly are the abbreviated labels defined?
  - What width changes are needed for the labels column?
  - Should "SQO" be expanded to "Sales Qualified Opportunity" or remain "SQO"?

### 12.3 Clickable Styling
- **Questions**:
  - What cursor style should be used (`cursor-pointer`)?
  - What hover effect should indicate clickability (`hover:bg-blue-50`, `hover:underline`)?
  - Should there be an icon indicating "click to expand"?

---

## OUTPUT FORMAT

Create `SGA_MGMT_UPGRADE_ANSWERS.md` with this structure:

```markdown
# SGA Management & SGA Hub Upgrade - Investigation Answers

**Date**: [Current Date]
**Investigator**: Cursor.ai
**Project**: Savvy Funnel Analytics Dashboard

---

## Table of Contents
1. Current SGA Management Page Analysis
2. Current SGA Hub Page Analysis
3. RecordDetailModal Pattern Analysis
4. BigQuery Data for Drill-Down Modals
5. Closed Lost Tab Analysis
6. API Client Analysis
7. UI Components and Styling
8. New Components Design
9. New API Routes Design
10. Type Definitions Needed
11. Implementation Cross-Cutting Concerns
12. CSS/Styling Changes
13. Implementation Plan Summary
14. Open Questions / Blockers

---

## 1. Current SGA Management Page Analysis

### 1.1 SGAManagementContent Component

**File Contents Summary**:
[Paste relevant code sections]

**Current Table Structure**:
| Column | Header | Data Source |
|--------|--------|-------------|
| ... | ... | ... |

**Abbreviation Locations**:
- Line X: `"IC: ${value}"`
- Line Y: `"QC: ${value}"`
- Line Z: `"SQO: ${value}"`

...

[Continue for each section]

---

## 13. Implementation Plan Summary

### Phase 1: Foundation (Types & Shared Components)
1. Create new type definitions
2. Create MetricDrillDownModal component
3. ...

### Phase 2: SGA Management Upgrades
1. Update AdminSGATable with full labels
2. Add clickable values
3. ...

### Phase 3: SGA Hub Upgrades
1. Update Weekly Goals Table
2. Add Closed Lost drill-down
3. ...

### Phase 4: Testing & Polish
1. Test all drill-down flows
2. Dark mode verification
3. ...

---

## 14. Open Questions / Blockers

- [ ] Question 1: ...
- [ ] Question 2: ...
```

---

## VERIFICATION CHECKLIST

Before completing, verify:
- [ ] All 12 sections have complete answers
- [ ] All code files have been read (not assumed)
- [ ] All BigQuery queries have been executed via MCP
- [ ] All type definitions have been documented
- [ ] Implementation plan is actionable with clear phases
- [ ] Open questions are clearly listed

---

## MCP USAGE NOTES

- Use MCP to query BigQuery for sample data
- Use MCP to verify field names and data types
- Use MCP to test any new queries before documenting them
- If MCP is unavailable, note which queries need verification

---

## IMPORTANT REMINDERS

1. **Read actual files** - Do not assume file contents
2. **Document exact code** - Copy relevant sections, not paraphrases
3. **Include line numbers** - For easy reference during implementation
4. **Note dependencies** - Between components, types, and APIs
5. **Flag unknowns** - Add to "Open Questions" section

---

**Save output to**: `C:\Users\russe\Documents\Dashboard\SGA_MGMT_UPGRADE_ANSWERS.md`
