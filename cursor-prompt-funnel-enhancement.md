# Cursor.ai Prompt: Finalize Funnel Performance Enhancement Document

## Context

You are working on the **Savvy Funnel Analytics Dashboard** (Next.js 14 + BigQuery). The file `C:\Users\russe\Documents\Dashboard\funnel_performance_enhancement.md` contains an implementation plan for enhancing the Funnel Performance dashboard.

**Your task**: Investigate the codebase, verify assumptions via BigQuery (you have MCP access), and update the enhancement document to be complete and ready for agentic implementation.

---

## Problem Statement (User-Provided)

The current UX issue is:
> "The problem with current behavior is that we have to scroll down to look at the record details, and that is really hard. Then you can't see the filters up top, so it's better just to click a card and dive into the record details from the card — because when I'm clicking the SQO card, I'm going to want to look at SQO details from that card anyway."

**Key insight**: Clicking a scorecard should give immediate access to those records in a modal (no scrolling), while the main detail table serves as a persistent, filterable view.

---

## Required Changes to Enhancement Document

### 1. Update Default Stage Filter

**Current (WRONG)**: The document says default to "Prospects"
**Correct**: Default to **SQO**

**Rationale from user**:
> "Generally people are just looking at SQOs anyways, so perhaps that's the best place to start because technically SQO is the beginning of our sort of like middle funnel."

**Action**: Find all references to "Prospects" as default and change to "SQO":
- Phase 2.1 section (line ~154-156)
- Phase 2.2 section (stageFilter initial state)
- Phase 2.3 (filteredDetailRecords default case)
- Testing checklist section
- Notes section

### 2. Verify & Document Date Column Behavior

When the user selects a stage from the dropdown, what date should display?

**Investigation needed**:
1. Check `src/lib/queries/detail-records.ts` for how `relevantDate` is set for each metric type
2. Determine: Should the date column change based on stage selection, or always show `FilterDate`?

**User expectation**: Probably wants to see the date relevant to that stage (e.g., `converted_date_raw` for SQLs, `Date_Became_SQO__c` for SQOs).

**Action**: 
- Use BigQuery MCP to check what date fields are available
- Update the document to specify whether date column is dynamic or static
- If dynamic, add logic to `DetailRecordsTable` to switch date display

### 3. Verify Opportunity Stage Data via BigQuery

**Run this query via MCP** to get current opportunity stages:

```sql
SELECT DISTINCT StageName, COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE StageName IS NOT NULL
  AND FilterDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
GROUP BY StageName
ORDER BY count DESC
```

**Action**: 
- Update the "Opportunity Stage Data" section with fresh results
- Confirm the stage names match what the document lists
- Note any new stages that should be included

### 4. Verify Boolean Flags Available on All Records

**Run this query via MCP** to confirm boolean flags are populated:

```sql
SELECT 
  COUNT(*) as total_records,
  COUNTIF(is_contacted = 1) as contacted_count,
  COUNTIF(is_mql = 1) as mql_count,
  COUNTIF(is_sql = 1) as sql_count,
  COUNTIF(is_sqo_unique = 1) as sqo_count,
  COUNTIF(is_joined_unique = 1) as joined_count,
  COUNTIF(StageName IS NOT NULL) as has_stage_name
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE FilterDate >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)
```

**Action**: Update the "Data Model Confirmation" section with fresh verification results.

### 5. Update the Problem Statement Section

**Current Overview section is generic**. Replace with clear problem statement:

```markdown
## Problem Statement

**Current UX Issue**: When users click a scorecard (e.g., SQOs), the page scrolls down to filter the detail table. This causes:
1. Loss of visual context (filters and scorecards scroll out of view)
2. Disorientation when trying to see both the metric count and its underlying records
3. Extra scrolling to return to the dashboard overview

**Solution**: 
- Scorecard clicks open a **drill-down modal** with records for that metric
- The detail table becomes an **independent, always-visible** component with its own stage filter
- Users can dive deep via modal OR browse via table — two complementary workflows
```

### 6. Add User Persona Context

Add a new section after Problem Statement:

```markdown
## User Personas & Workflows

| Persona | Primary Use Case | Key Workflow |
|---------|------------------|--------------|
| **SGA** | Check own pipeline | Click SQO card → Review deals → Click record for details |
| **Manager** | Team oversight | Filter by SGA → Review conversion rates → Drill into underperformers |
| **Executive** | High-level metrics | View scorecards → Spot trends → Occasional drill-down |
| **RevOps** | Analysis & reporting | Filter by channel/source → Export data → Compare periods |

**Default to SQO** because SGAs (primary users) focus on middle-funnel deals they're actively working.
```

### 7. Clarify Stage Dropdown Logic

The dropdown should show **both** funnel stages AND opportunity stages because:
> "They're going to only be filtering by one or the other. When someone becomes an SQO, they then roll into the different stage names."

**Update the Stage Dropdown section to clarify**:

```markdown
### Stage Dropdown Structure

The dropdown combines two types of stages in a single list:

**Funnel Stages** (Lead Lifecycle):
- SQO (default)
- Prospects
- Contacted  
- MQL
- SQL
- Joined
- Open Pipeline

**Opportunity Stages** (Sales Process — only visible when records have StageName):
- Discovery
- Qualifying
- Sales Process
- Negotiating
- Closed Won
- Closed Lost
- (dynamically populated from data)

**Why combined?**: Users filter by ONE stage at a time. Separating into two dropdowns adds unnecessary complexity. The optgroup label distinguishes funnel vs opportunity stages.
```

### 8. Add Implementation Verification Steps

After each phase, add verification commands Cursor should run:

```markdown
### Phase 1 Verification

After implementing scorecard click changes:

1. **Build check**: `npm run build` (should complete without errors)
2. **Type check**: `npx tsc --noEmit` (should pass)
3. **Manual test**: 
   - Click each scorecard → modal should open
   - Verify modal shows correct records
   - Verify main table does NOT change

### Phase 2 Verification

After implementing stage dropdown:

1. **Build check**: `npm run build`
2. **Manual test**:
   - Load dashboard → table should show SQOs by default
   - Select "Prospects" → table should show all prospects
   - Select "Discovery" → table should filter to Discovery stage
   - Verify record counts match scorecard numbers
```

### 9. Update Files to Modify Section

Add line numbers and specific change descriptions:

```markdown
## Files to Modify (with specifics)

### 1. `src/app/dashboard/page.tsx`

| Line(s) | Current | Change To |
|---------|---------|-----------|
| 173-182 | `handleMetricClick` sets `metricFilter` | Open modal instead |
| 105 | `useState<'sql' \| 'sqo' \| 'joined' \| null>` | Add all metric types |
| 164 | `fetchDashboardData` depends on `selectedMetric` | Remove dependency |
| NEW | - | Add `stageFilter` state (default: 'sqo') |
| NEW | - | Add `filteredDetailRecords` useMemo |
| NEW | - | Add `availableOpportunityStages` useMemo |

### 2. `src/components/dashboard/DetailRecordsTable.tsx`

| Change | Description |
|--------|-------------|
| Props interface | Add `stageFilter`, `onStageFilterChange`, `availableOpportunityStages` |
| UI | Add dropdown before search bar |
| Styling | Match existing filter dropdown styles |

### 3. `src/components/dashboard/VolumeDrillDownModal.tsx`

| Line | Current | Change To |
|------|---------|-----------|
| 16 | `metricFilter?: 'sql' \| 'sqo' \| 'joined'` | Add `'prospect' \| 'contacted' \| 'mql' \| 'openPipeline'` |

### 4. `src/components/dashboard/Scorecards.tsx`

| Change | Description |
|--------|-------------|
| Remove | `isSelected` function and usage |
| Remove | `ring-2 ring-blue-500` selection styling |
| Keep | `cursor-pointer` and `hover:bg-gray-50` |

### 5. `src/components/dashboard/FullFunnelScorecards.tsx`

Same changes as Scorecards.tsx
```

### 10. Add Ground Truth Validation

Add section to validate against known values:

```markdown
## Ground Truth Validation

After implementation, verify counts match `docs/GROUND-TRUTH.md`:

**Q1 2025 (use for validation)**:
- SQLs: 123
- SQOs: 96  
- Joined: 12

**Test procedure**:
1. Set date range to Q1 2025 (Jan 1 - Mar 31, 2025)
2. Click SQL scorecard → modal should show 123 records
3. Click SQO scorecard → modal should show 96 records
4. In detail table, select "SQL" from dropdown → should show 123 records
5. Select "SQO" → should show 96 records
```

---

## Final Checklist Before Implementation

After making all updates, verify the document includes:

- [ ] Clear problem statement with user quotes
- [ ] Default stage is SQO (not Prospects)
- [ ] User persona context added
- [ ] BigQuery verification results updated with fresh data
- [ ] Stage dropdown structure clarified (combined funnel + opportunity)
- [ ] Date column behavior specified (dynamic vs static)
- [ ] Line numbers for all code changes
- [ ] Verification steps after each phase
- [ ] Ground truth validation procedure
- [ ] Rollback plan is complete
- [ ] All code snippets are syntactically correct

---

## Execution Instructions for Cursor

1. **Read the current enhancement document** at `C:\Users\russe\Documents\Dashboard\funnel_performance_enhancement.md`

2. **Run BigQuery verification queries** via MCP:
   - Opportunity stages query
   - Boolean flags verification query
   - Record volume query

3. **Investigate the codebase** to verify:
   - Current `handleMetricClick` implementation and line numbers
   - Current `VolumeDrillDownModal` type definition
   - Current `DetailRecordsTable` props interface
   - Date field mapping logic in `detail-records.ts`

4. **Update the enhancement document** with:
   - All changes listed above
   - Fresh BigQuery verification results
   - Corrected line numbers from codebase investigation
   - Default changed from Prospects to SQO throughout

5. **Validate the document** is ready for agentic implementation:
   - No ambiguous instructions
   - All code snippets are complete
   - All line numbers are accurate
   - All file paths are correct

---

## Success Criteria

The updated `funnel_performance_enhancement.md` should be:

1. **Self-contained**: Another AI agent can implement it without asking questions
2. **Verified**: All data assumptions confirmed via BigQuery
3. **Specific**: Exact line numbers, exact file paths, exact code changes
4. **Testable**: Clear verification steps and ground truth validation
5. **Reversible**: Complete rollback plan if needed

**When complete**: The document should be ready for a fresh Cursor session to implement the feature end-to-end using Composer Agent mode.
