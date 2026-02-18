# SGM Conversion & Velocity Table — Codebase Exploration & Knowledge Base

> **Feature**: SQL Date filter + SGM Conversion/Velocity table on the "By SGM" tab of the Open Pipeline page
> **Date**: 2026-02-17
> **Status**: 🔍 Investigation Required — Use this document to guide Claude Code exploration
> **Prerequisite**: The "By SGM" stacked bar chart tab has already been implemented per `pipeline_by_sgm_implementation_guide.md`

---

## Table of Contents

1. [Feature Requirements Summary](#1-feature-requirements-summary)
2. [Phase 1: Date Filter Pattern Investigation](#2-phase-1-date-filter-pattern-investigation)
3. [Phase 2: Query Layer & Data Availability](#3-phase-2-query-layer--data-availability)
4. [Phase 3: Table Component Patterns](#4-phase-3-table-component-patterns)
5. [Phase 4: Conversion Rate Logic & View Fields](#5-phase-4-conversion-rate-logic--view-fields)
6. [Phase 5: Integration Points & State Management](#6-phase-5-integration-points--state-management)
7. [Phase 6: Implementation Plan Outline](#7-phase-6-implementation-plan-outline)
8. [Gap Analysis & Open Questions](#8-gap-analysis--open-questions)

---

## 1. Feature Requirements Summary

### Context & Strategic Goal

The "By SGM" tab currently shows a **current-state snapshot** of open pipeline distributed across SGMs. We are extending it with a **time-based lens** that answers two critical questions:

1. **Redistribution**: Are we giving too many SQLs to SGMs who aren't converting them?
2. **Capacity/Velocity**: Are some SGMs bottlenecked with too much pipeline to work effectively?

### What We're Adding

#### A) SQL Creation Date Filter (scopes the entire "By SGM" tab)

- **Unique to the "By SGM" tab** — does NOT appear on the "By Stage" tab
- **Default**: "All Time" (no date restriction)
- **Options**: Custom date range picker + Quarter/Year selector
- **Filter field**: `converted_date_raw` from `vw_funnel_master` (this is the SQL date — when the lead converted to an opportunity)
- **Behavior**: When a date range is selected, BOTH the stacked bar chart AND the conversion table re-scope to only show opportunities that became SQL within that window
- **Pattern reference**: Should match the date filter UX on the Full Funnel Efficiency page's global filters (quarter + year selector + custom date range)

#### B) SGM Conversion & Velocity Table (below the stacked bar chart)

A single table showing the full post-SQL journey per SGM, read left-to-right:

| Column | Description | Source Logic |
|--------|-------------|-------------|
| **SGM** | SGM name | `SGM_Owner_Name__c` (from `Opportunity_Owner_Name__c`) |
| **SQLs** | Count of SQLs received in the period | Count of records where `is_sql = 1` AND `converted_date_raw` in date range, deduplicated by `is_primary_opp_record = 1` |
| **SQL→SQO %** | Conversion rate from SQL to SQO | `SUM(sql_to_sqo_progression) / COUNT(eligible SQLs)` — see denominator note below |
| **SQO'd** | Count that reached SQO | Count where `is_sqo_unique = 1` |
| **SQO→Joined %** | Conversion rate from SQO to Joined | `SUM(sqo_to_joined_progression) / COUNT(eligible SQOs)` |
| **Joined** | Count that joined | Count where `is_joined_unique = 1` |

> **Design Decision**: We collapsed SQO→Signed→Joined into a single **SQO→Joined** conversion. Signed is not tracked as a separate conversion stage in this table.

#### Table UX Requirements

- **Sortable columns**: All columns sortable with up/down arrow indicators on column headers. Default sort: SQLs descending (highest volume first)
- **Team Average row**: Bolded row at the bottom showing team-wide averages as a benchmark
- **Date-scoped**: Respects the SQL Creation Date filter — all counts and rates recalculate based on the selected period

#### Denominator Handling for Conversion Rates

- **SQL→SQO %**: Use `eligible_for_sql_conversions` flag from the view (counts only resolved opps: those that became SQO OR closed lost). This gives accurate conversion rates but excludes still-open pipeline. This is the right choice because "All Time" default means most pipeline will be resolved.
- **SQO→Joined %**: Use `eligible_for_sqo_conversions` flag from the view (counts only SQOs that joined OR closed lost).
- When filtering to recent time periods, conversion rates may appear lower because fewer opps have resolved. This is expected and correct behavior — it reflects reality.

---

## 2. Phase 1: Date Filter Pattern Investigation

### Goal
Understand how the Full Funnel Efficiency page implements its date filters (quarter/year selector + custom date range) so we can replicate the same UX pattern on the "By SGM" tab.

### Prompt for Claude Code

```
You are investigating the date filter patterns used on the Full Funnel Efficiency page. Read the feature requirements in the "Feature Requirements Summary" section above before starting.

Read these files IN ORDER and document your findings:

1. Find the Full Funnel Efficiency page component:
   - Search for files related to "funnel" or "efficiency" in src/app/dashboard/
   - Read the full page component file
   - Document: What date filter component(s) are used? What props do they accept? How is the selected date range stored in state?

2. Find the date filter component itself:
   - It's likely in src/components/dashboard/ or src/components/ui/
   - Read the full component file
   - Document:
     a. Component name and file path
     b. All props (with TypeScript types)
     c. Does it support "All Time" as a default?
     d. Does it support quarter + year selection?
     e. Does it support custom date ranges?
     f. What format does it output? (Date objects? ISO strings? { start, end } tuple?)
     g. Does it have any hardcoded date options (like "Last 30 days", "Last 90 days")?

3. Find how the date filter value flows into API calls:
   - In the funnel efficiency page, trace how the selected date range is passed to the fetch function / API call
   - Document: What parameter name is used? How is "All Time" represented (null? undefined? specific dates?)

4. Find the API route that receives the date filter:
   - Read the relevant API route handler
   - Document: How does it receive the date range? How does it construct the WHERE clause for date filtering?

5. Check if the date filter component is reusable:
   - Does it accept callbacks like `onChange`?
   - Can it be dropped into another page without modification?
   - Are there any page-specific dependencies?

Report your findings in this format:
- Component name and path
- Props interface (exact TypeScript)
- State management pattern
- API parameter format
- Reusability assessment (can we use it as-is, or do we need to modify/duplicate?)
```

### Expected Findings
- The date filter component name, location, and full props interface
- How "All Time" is represented in state (likely null or undefined)
- The quarter/year selection mechanism
- Whether the component can be reused directly on the pipeline page

---

## 3. Phase 2: Query Layer & Data Availability

### Goal
Understand what query changes are needed to support date-filtered SGM data and the conversion/velocity table. Verify all required fields exist in the view and in the existing query patterns.

### Prompt for Claude Code

```
You are investigating the query layer for the SGM Conversion & Velocity Table feature. Read the feature requirements in the "Feature Requirements Summary" section of this document before starting.

Read these files IN ORDER and document your findings:

1. Read `src/lib/queries/open-pipeline.ts` in full:
   - Find _getOpenPipelineBySgm (the function added in the previous implementation)
   - Document its current WHERE clause, SELECT, GROUP BY
   - Identify: Does it currently accept any date parameters? (It should NOT — it was built as a snapshot query)
   - Document: What would need to change to add a date filter on converted_date_raw?

2. Verify view fields exist for the conversion table:
   Read the vw_funnel_master.sql view (or check the BigQuery schema) and confirm these fields are available:
   - converted_date_raw (SQL date — this is the date filter field)
   - SGM_Owner_Name__c (SGM attribution)
   - is_sql (flag: record reached SQL)
   - is_sqo_unique (deduplicated SQO flag)
   - is_joined_unique (deduplicated Joined flag)
   - sql_to_sqo_progression (numerator: SQL→SQO)
   - sqo_to_joined_progression (numerator: SQO→Joined)
   - eligible_for_sql_conversions (denominator: resolved SQLs)
   - eligible_for_sqo_conversions (denominator: resolved SQOs)
   - is_primary_opp_record (dedup flag for opp-level counts)
   - Opportunity_AUM (for the stacked bar chart AUM values)
   - StageName (for the stacked bar chart stage segments)

   For each field, confirm:
   a. It exists in the view
   b. Its data type
   c. Any NULL handling considerations

3. Read the existing _getOpenPipelineSummary function:
   - Document how it constructs parameterized queries
   - Note the pattern for adding optional filters (stages, sgms)
   - This is the pattern we'll follow for adding the date filter

4. Check if there's an existing query function that uses converted_date_raw:
   - Search across all files in src/lib/queries/ for references to converted_date_raw or converted_date
   - If found, document how other queries filter by this field
   - This tells us if there's a precedent for date-range parameterization

5. Check the BigQuery table/view reference:
   - What table does the open pipeline query currently use? (Likely FULL_TABLE from constants)
   - Is vw_funnel_master the same table, or a different one?
   - Document the exact table reference used in open-pipeline.ts queries

6. Investigate: Can we write ONE new query function that returns both the chart data AND the table data?
   - Or do we need separate queries?
   - The chart needs: SGM × Stage grouping with AUM sums
   - The table needs: SGM grouping with conversion counts and rates
   - These are fundamentally different GROUP BY structures, so likely separate queries
   - Document your recommendation

Report your findings with exact field names, data types, and any discrepancies between what we need and what exists.
```

### Expected Findings
- Confirmation that all required fields exist in the view
- The table/view reference used in queries
- Whether converted_date_raw is already used elsewhere (gives us a pattern to follow)
- Whether we need one or two new query functions
- Any NULL handling or deduplication concerns

---

## 4. Phase 3: Table Component Patterns

### Goal
Understand existing table component patterns in the codebase so the new conversion table matches the app's design language. Specifically investigate sortable table patterns.

### Prompt for Claude Code

```
You are investigating table component patterns for the SGM Conversion & Velocity Table feature.

Read these files and document your findings:

1. Search for existing sortable tables in the codebase:
   - Search src/components/ for any table components that support column sorting
   - Look for sort state patterns (sortColumn, sortDirection, onClick handlers)
   - Search for "sort" or "arrow" or "ascending" or "descending" in component files
   - Document: Is there an existing SortableTable component? Or do individual tables implement their own sorting?

2. Read the DetailRecordsTable component:
   - Path: src/components/dashboard/DetailRecordsTable.tsx
   - Document: Does it support sorting? What's the column definition pattern?
   - What styling/framework is used (Tremor Table? Custom HTML table? Tailwind?)

3. Search for any table in the app that has a "Team Average" or "Total" summary row:
   - Search for "average", "total", "summary" in table components
   - Document: How are summary rows typically rendered (separate row? footer? bold styling?)

4. Check Tremor table components:
   - Search for imports from '@tremor/react' that relate to tables
   - Document: Does the app use Tremor's Table component? Or custom tables?
   - What version of Tremor is installed? (check package.json)

5. Read the PipelineScorecard component:
   - Path: src/components/dashboard/PipelineScorecard.tsx
   - Document: How does it format numbers (AUM, counts, percentages)?
   - Are there shared formatting utilities we should reuse?

6. Check for existing percentage/conversion rate formatting:
   - Search across the codebase for percentage formatting patterns
   - Look in src/lib/utils/ for any formatPercent or similar functions
   - Document: What formatting pattern should we use for "75%" style display?

7. Read the existing PipelineBySgmChart component:
   - Path: src/components/dashboard/PipelineBySgmChart.tsx
   - Document: How is it structured? What props does it accept?
   - This is important because the new table will live alongside this chart
   - Note: Does the chart component handle its own data fetching, or does the parent page pass data down?

Report: Exact component patterns, styling approach, and whether we can reuse existing table infrastructure or need to build a new sortable table component.
```

### Expected Findings
- Whether a reusable sortable table exists or if we need to build one
- The styling framework used for tables (Tremor vs custom Tailwind)
- Number/percentage formatting utilities available
- How the chart component receives its data (important for coordinating with the table)

---

## 5. Phase 4: Conversion Rate Logic & View Fields

### Goal
Deep-dive into the conversion rate calculation logic to ensure the table produces accurate numbers. Verify the eligibility flags work correctly for our use case.

### Prompt for Claude Code

```
You are investigating conversion rate calculation patterns for the SGM Conversion & Velocity Table.

Read the vw_funnel_master.sql view definition and answer these questions:

1. SQL→SQO Conversion Rate:
   - NUMERATOR: sql_to_sqo_progression — what's the exact logic?
     Document the CASE statement verbatim.
   - DENOMINATOR: eligible_for_sql_conversions — what's the exact logic?
     Document the CASE statement verbatim.
   - QUESTION: When we filter by converted_date_raw (SQL date), the denominator includes records that are "Closed Lost" — but what if they closed lost BEFORE the date range? Is there a risk of including stale closed-lost records?
   - QUESTION: The is_primary_opp_record flag — do we need to apply this when counting SQLs? Or does is_sql already handle deduplication?

2. SQO→Joined Conversion Rate:
   - NUMERATOR: sqo_to_joined_progression — what's the exact logic?
     Document the CASE statement verbatim.
   - DENOMINATOR: eligible_for_sqo_conversions — what's the exact logic?
     Document the CASE statement verbatim.
   - QUESTION: We're using converted_date_raw as the date filter, but SQO happens AFTER SQL. If we filter SQLs created in Q1 2025, we want to see how many of THOSE became SQO and then Joined — even if the SQO and Joined dates are in Q2/Q3. Confirm: filtering by converted_date_raw and then counting downstream progression fields will correctly capture this "cohort-based" view.

3. Deduplication concerns:
   - is_sqo_unique: What's the exact logic? Does it already handle the case where multiple leads convert to the same opportunity?
   - is_joined_unique: Same question.
   - is_primary_opp_record: When should we use this vs the _unique flags?
   - For the "SQLs Received" count: should we count rows where is_sql = 1 AND is_primary_opp_record = 1? Or just is_sql = 1?

4. Check if existing funnel efficiency queries compute conversion rates:
   - Search src/lib/queries/ for any query that computes conversion percentages
   - Document: Do they compute rates in SQL (server-side) or in the frontend?
   - What pattern should we follow?

5. SGM attribution:
   - Confirm: SGM_Owner_Name__c comes from Opportunity_Owner_Name__c (the SGM who owns the opportunity)
   - When we filter by converted_date_raw (SQL date), we want the SGM who owned the opportunity at that time — is SGM_Owner_Name__c the current owner, or the owner at conversion time?
   - Is there a risk of SGM reassignment skewing the data? (e.g., opp was SQLd under SGM A, then transferred to SGM B)

Report: Exact field logic, any deduplication risks, and recommended approach for computing conversion rates (SQL-side vs frontend).
```

### Expected Findings
- Verbatim CASE statement logic for all progression and eligibility flags
- Confirmation that cohort-based filtering (by SQL date) correctly captures downstream conversions
- Deduplication strategy for counts
- Whether conversion rates are computed server-side or client-side
- Any SGM reassignment risks

---

## 6. Phase 5: Integration Points & State Management

### Goal
Understand how the new date filter and table integrate with the existing "By SGM" tab's state management, data fetching, and rendering flow.

### Prompt for Claude Code

```
You are investigating integration points for adding a date filter and conversion table to the existing "By SGM" tab.

Read the pipeline page component and answer these questions:

1. Read `src/app/dashboard/pipeline/page.tsx` in full:
   - Document ALL state variables (including any added by the By SGM implementation)
   - Document the activeTab state and how tab switching works
   - Document how fetchBySgmData is called (useCallback? useEffect? manual trigger?)
   - Document: When filters change, how does the page re-fetch data? Is there a single useEffect watching filter state?

2. Identify where new state would live:
   - The SQL date filter state (start date, end date, or null for "All Time")
   - The conversion table data state
   - The conversion table loading state
   - The conversion table sort state (column + direction)
   - Should these be in the page component or in a child component?

3. Data fetching coordination:
   - When the SQL date filter changes, BOTH the chart AND the table need to re-fetch
   - Currently, does the chart (PipelineBySgmChart) fetch its own data, or does the page fetch and pass it down?
   - Document: Will we need one combined API call that returns both chart + table data? Or two separate calls?
   - What's the loading UX pattern? (Show skeleton? Show spinner? Show stale data until new data arrives?)

4. Check the existing filter component (PipelineFilters):
   - Read `src/components/dashboard/PipelineFilters.tsx`
   - Document its full props interface
   - Does it have a slot or extension point where we could add the date filter?
   - Or should the date filter be a separate component rendered only when activeTab === 'bySgm'?

5. Check API route patterns:
   - Read `src/app/api/dashboard/pipeline-by-sgm/route.ts`
   - Document the current request body schema
   - How would we add optional date range parameters to this route?
   - Read `src/app/api/dashboard/pipeline-drilldown-sgm/route.ts`
   - Same questions — drill-down data should also respect the date filter

6. API client patterns:
   - Read `src/lib/api-client.ts`
   - Find the fetchPipelineBySgm function (or equivalent)
   - Document how parameters are passed to API calls
   - What would the new fetchSgmConversionTable function signature look like?

Report: Complete state management plan, data fetching strategy, and integration approach.
```

### Expected Findings
- Full picture of current state management on the pipeline page
- Whether the date filter should be a separate component or integrated into PipelineFilters
- Whether we need one or two API endpoints for the new data
- Loading/error state patterns to follow
- How drill-down queries need to be updated to respect the date filter

---

## 7. Phase 6: Implementation Plan Outline

> **This section is NOT for investigation — it documents the agreed-upon implementation plan to be refined after all investigation phases complete.**

### Estimated New/Modified Files

| File | Action | Purpose |
|------|--------|---------|
| `src/components/dashboard/SqlDateFilter.tsx` | **Create** (or reuse existing date filter component) | Quarter/Year + custom date range picker for SQL creation date |
| `src/components/dashboard/SgmConversionTable.tsx` | **Create** | Sortable table with SGM conversion rates and team averages |
| `src/lib/queries/open-pipeline.ts` | **Modify** | Add date range parameter to `_getOpenPipelineBySgm`; add new `_getSgmConversionData` query function |
| `src/app/api/dashboard/pipeline-by-sgm/route.ts` | **Modify** | Accept optional date range params |
| `src/app/api/dashboard/sgm-conversions/route.ts` | **Create** | New endpoint for conversion table data |
| `src/lib/api-client.ts` | **Modify** | Add `fetchSgmConversions` client function; add date params to `fetchPipelineBySgm` |
| `src/types/dashboard.ts` | **Modify** | Add `SgmConversionData` interface |
| `src/app/dashboard/pipeline/page.tsx` | **Modify** | Add date filter state, conversion table state, render SqlDateFilter + SgmConversionTable when on bySgm tab |

### Query Architecture

**Query 1: Modified `_getOpenPipelineBySgm`** (chart data)
- Add optional `dateRange?: { start: string; end: string }` parameter
- When provided: add `WHERE DATE(v.converted_date_raw) BETWEEN @startDate AND @endDate`
- When null/undefined: no date filter (All Time = current behavior)

**Query 2: New `_getSgmConversionData`** (table data)
- GROUP BY `SGM_Owner_Name__c`
- SELECT:
  - `COUNT(CASE WHEN is_sql = 1 AND is_primary_opp_record = 1 THEN 1 END) AS sqls_received`
  - `SUM(sql_to_sqo_progression) AS sqo_count` (or use is_sqo_unique — investigation will confirm)
  - `SUM(eligible_for_sql_conversions) AS sql_eligible` (denominator for SQL→SQO %)
  - `SUM(sqo_to_joined_progression) AS joined_count` (or use is_joined_unique)
  - `SUM(eligible_for_sqo_conversions) AS sqo_eligible` (denominator for SQO→Joined %)
  - `COUNT(CASE WHEN is_joined_unique = 1 THEN 1 END) AS joined_count`
- WHERE: Same base conditions as chart query + optional date range on converted_date_raw
- Conversion rates computed **client-side** (avoids division by zero in SQL; easier to format)

### Table Component Design

```
SgmConversionTable
├── Column headers with sort arrows (▲▼)
├── Data rows (one per SGM)
│   ├── SGM name
│   ├── SQLs received (count)
│   ├── SQL→SQO % (percentage)
│   ├── SQO'd (count)
│   ├── SQO→Joined % (percentage)
│   └── Joined (count)
└── Team Average row (bolded, pinned to bottom)
```

### Date Filter Component Design

- Render ONLY when `activeTab === 'bySgm'`
- Position: Above the chart card, below the existing PipelineFilters
- Options:
  - "All Time" (default)
  - Quarter selector (Q1-Q4) + Year selector
  - Custom date range (start/end date pickers)
- On change: Triggers re-fetch of both chart data and table data

---

## 8. Gap Analysis & Open Questions

> **Fill this section in AFTER all investigation phases complete.**

### A) Codebase Questions to Resolve

| Question | Phase | Status |
|----------|-------|--------|
| What date filter component exists on the Full Funnel Efficiency page? | Phase 1 | ⬜ |
| Can the date filter component be reused as-is? | Phase 1 | ⬜ |
| What table/view does open-pipeline.ts query against? Is it vw_funnel_master? | Phase 2 | ⬜ |
| Is converted_date_raw available in that table/view? | Phase 2 | ⬜ |
| Are all conversion rate fields available? | Phase 2 | ⬜ |
| Is there an existing sortable table component? | Phase 3 | ⬜ |
| How are conversion rates computed elsewhere (SQL vs frontend)? | Phase 4 | ⬜ |
| Does SGM_Owner_Name__c reflect current owner or owner at SQL time? | Phase 4 | ⬜ |
| Does PipelineBySgmChart fetch its own data or receive props? | Phase 5 | ⬜ |
| Can we extend the existing pipeline-by-sgm API or need new endpoints? | Phase 5 | ⬜ |

### B) Implementation Decisions (Pre-Confirmed)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Date filter scope | SQL creation date (`converted_date_raw`) | SGMs receive pipeline at SQL stage |
| Default date range | All Time | Most pipeline will be resolved, giving accurate conversion rates |
| SQO→Signed→Joined | Collapsed to SQO→Joined | Signed not tracked as separate conversion |
| Avg Days columns | Removed | Not needed for initial version |
| Denominator approach | Use eligibility flags (resolved opps only) | More accurate; "All Time" default means most opps resolved |
| Table sorting | Client-side with column arrows | Default by SQLs descending |
| Team Average row | Bolded at bottom | Provides immediate benchmark |
| Date filter UX | Match Full Funnel Efficiency page pattern | Quarter/Year + custom date range |

### C) Data Flow Diagram

```
SQL Date Filter (state: dateRange)
         │
         ├──► fetchBySgmData(filters, dateRange)
         │         │
         │         ▼
         │    /api/dashboard/pipeline-by-sgm
         │         │
         │         ▼
         │    _getOpenPipelineBySgm(filters, dateRange)
         │         │
         │         ▼
         │    PipelineBySgmChart (stacked bar chart, date-scoped)
         │
         └──► fetchSgmConversions(filters, dateRange)
                   │
                   ▼
              /api/dashboard/sgm-conversions
                   │
                   ▼
              _getSgmConversionData(filters, dateRange)
                   │
                   ▼
              SgmConversionTable (sortable, with team avg row)
```

### D) Future Considerations (Out of Scope)

- Color-coding cells green/yellow/red relative to team average (potential v2 enhancement)
- Scatter plot visualization (SQLs received vs conversion rate) for redistribution analysis
- Drill-down from table cells (e.g., click "18" in SQO'd column to see those 18 records)
- Adding Avg Days columns back if velocity tracking becomes a priority
- Export table to CSV/Excel
