# Open Pipeline Page - Questions for Cursor.ai

## Purpose
This document contains questions that Cursor.ai needs to answer using its MCP connection to BigQuery and its access to the codebase. The answers will be used to create a step-by-step implementation guide for building the new **Open Pipeline** dedicated page in the dashboard.

**Output File**: After answering all questions, create `Open_pipeline_answers.md` in the project root directory.

---

## Context: What We're Building

A new dedicated page at `/dashboard/pipeline` with:
1. **Open Pipeline Scorecard** - Shows total AUM and advisor count (same as main dashboard)
2. **Side-by-Side Bar Chart** - X-axis: Opportunity Stage, Y-axis: Two bars per stage showing:
   - Sum of Opportunity AUM
   - Count of unique advisors (distinct by opportunity ID)
3. **Dynamic Stage Filtering** - Users can add/remove stages from the chart
4. **Drill-Down Modal** - Click any bar to see all candidates in that stage
5. **Record Detail Modal** - Click any candidate to see full details (existing component)

### Validation Targets
- **Expected Total**: $12.5B AUM, 109 advisors
- **Validation Data**: `detail-records_2026-01-21__2_.csv` (109 records exported from current Looker dashboard)

---

## SECTION 1: Codebase Architecture Questions

### Q1.1: Existing Page Structure
**Question**: What is the structure of an existing dashboard page file? Provide the full path and key patterns from `src/app/dashboard/page.tsx` or similar.

**Why This Matters**: We need to follow the same patterns for state management, data fetching, and component composition.

**Cursor Action**: 
```bash
# View the main dashboard page structure
cat src/app/dashboard/page.tsx | head -200
```

### Q1.2: Existing Pipeline Page Status
**Question**: Does `/dashboard/pipeline` already exist? If so, what's currently implemented?

**Why This Matters**: The ARCHITECTURE.md mentions "Page ID 3 - Open Pipeline at /dashboard/pipeline" but notes routes "may not be fully implemented yet."

**Cursor Action**:
```bash
# Check if pipeline page exists
ls -la src/app/dashboard/pipeline/
cat src/app/dashboard/pipeline/page.tsx 2>/dev/null || echo "Page does not exist"
```

### Q1.3: Open Pipeline API Route
**Question**: What is the current implementation of `/api/dashboard/open-pipeline`? Show the full route handler code.

**Why This Matters**: We need to understand if we can reuse or extend this endpoint.

**Cursor Action**:
```bash
cat src/app/api/dashboard/open-pipeline/route.ts
```

### Q1.4: Open Pipeline Query Functions
**Question**: Show the complete implementation of `src/lib/queries/open-pipeline.ts`.

**Why This Matters**: We need to understand the existing query structure and potentially add new aggregation queries.

**Cursor Action**:
```bash
cat src/lib/queries/open-pipeline.ts
```

### Q1.5: Constants Configuration
**Question**: What are the current values in `src/config/constants.ts` for:
- `OPEN_PIPELINE_STAGES`
- `RECRUITING_RECORD_TYPE`
- `FULL_TABLE`
- `MAPPING_TABLE`

**Why This Matters**: These constants define the business logic for what counts as "open pipeline."

**Cursor Action**:
```bash
cat src/config/constants.ts
```

### Q1.6: Sidebar Navigation
**Question**: How is the sidebar navigation configured? Where is the Open Pipeline page defined?

**Why This Matters**: We need to ensure the page appears in navigation and has proper permissions.

**Cursor Action**:
```bash
# Find sidebar component
grep -r "Open Pipeline" src/components/
cat src/components/Sidebar.tsx 2>/dev/null || cat src/components/layout/Sidebar.tsx
```

### Q1.7: Chart Components Available
**Question**: What chart components are available from Tremor and Recharts? Show examples of existing bar charts in the codebase.

**Why This Matters**: We need to use existing chart patterns for consistency.

**Cursor Action**:
```bash
# Find bar chart implementations
grep -r "BarChart" src/components/ --include="*.tsx" -l
grep -r "BarList" src/components/ --include="*.tsx" -l
```

---

## SECTION 2: BigQuery Schema & Data Validation Questions

### Q2.1: vw_funnel_master StageName Values
**Question**: What are all distinct StageName values in vw_funnel_master and their record counts?

**Why This Matters**: We need to understand all possible stages and verify our filtering logic.

**Cursor Action (BigQuery MCP)**:
```sql
SELECT 
  StageName,
  COUNT(*) as total_records,
  COUNT(DISTINCT Full_Opportunity_ID__c) as unique_opportunities,
  SUM(CASE WHEN is_sqo_unique = 1 THEN 1 ELSE 0 END) as sqo_unique_records
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Full_Opportunity_ID__c IS NOT NULL
GROUP BY StageName
ORDER BY 
  CASE StageName
    WHEN 'Qualifying' THEN 1
    WHEN 'Discovery' THEN 2
    WHEN 'Sales Process' THEN 3
    WHEN 'Negotiating' THEN 4
    WHEN 'Signed' THEN 5
    WHEN 'On Hold' THEN 6
    WHEN 'Closed Lost' THEN 7
    WHEN 'Joined' THEN 8
    WHEN 'Planned Nurture' THEN 9
    ELSE 10
  END;
```

### Q2.2: Validate Open Pipeline Definition
**Question**: Using the current open pipeline definition (Qualifying, Discovery, Sales Process, Negotiating) with is_sqo_unique=1 and Recruiting record type, what's the total AUM and advisor count?

**Why This Matters**: Should match validation targets ($12.5B AUM, 109 advisors).

**Cursor Action (BigQuery MCP)**:
```sql
SELECT
  COUNT(DISTINCT Full_Opportunity_ID__c) as advisor_count,
  SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum,
  ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) / 1000000000, 2) as total_aum_billions
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE recordtypeid = '012Dn000000mrO3IAI'  -- Recruiting only
  AND StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND is_sqo_unique = 1;
```

### Q2.3: Open Pipeline by Stage Breakdown
**Question**: What is the breakdown of AUM and advisor count by stage?

**Why This Matters**: This is exactly what the bar chart will display.

**Cursor Action (BigQuery MCP)**:
```sql
SELECT
  StageName as stage,
  COUNT(DISTINCT Full_Opportunity_ID__c) as advisor_count,
  SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum,
  ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) / 1000000000, 2) as aum_billions
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND is_sqo_unique = 1
GROUP BY StageName
ORDER BY 
  CASE StageName
    WHEN 'Qualifying' THEN 1
    WHEN 'Discovery' THEN 2
    WHEN 'Sales Process' THEN 3
    WHEN 'Negotiating' THEN 4
  END;
```

### Q2.4: All Stages AUM and Count (for Extended View)
**Question**: What is the AUM and count for ALL stages (including Signed, On Hold, etc.)?

**Why This Matters**: Users should be able to toggle additional stages on/off.

**Cursor Action (BigQuery MCP)**:
```sql
SELECT
  StageName as stage,
  COUNT(DISTINCT Full_Opportunity_ID__c) as advisor_count,
  SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum,
  ROUND(SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) / 1000000000, 2) as aum_billions
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE recordtypeid = '012Dn000000mrO3IAI'
  AND is_sqo_unique = 1
  AND StageName IS NOT NULL
  AND StageName NOT IN ('Closed Lost', 'Joined')  -- Always exclude terminal states
GROUP BY StageName
ORDER BY 
  CASE StageName
    WHEN 'Qualifying' THEN 1
    WHEN 'Discovery' THEN 2
    WHEN 'Sales Process' THEN 3
    WHEN 'Negotiating' THEN 4
    WHEN 'Signed' THEN 5
    WHEN 'On Hold' THEN 6
    WHEN 'Planned Nurture' THEN 7
    ELSE 8
  END;
```

### Q2.5: Sample Records for Drill-Down
**Question**: Show 5 sample records from the open pipeline with all fields needed for the drill-down modal.

**Why This Matters**: We need to understand the data structure for the drill-down display.

**Cursor Action (BigQuery MCP)**:
```sql
SELECT
  primary_key,
  Full_Opportunity_ID__c as opportunity_id,
  advisor_name,
  StageName as stage,
  COALESCE(Underwritten_AUM__c, Amount, 0) as aum,
  Original_source as source,
  Channel_Grouping_Name as channel,
  SGA_Owner_Name__c as sga,
  SGM_Owner_Name__c as sgm,
  Date_Became_SQO__c as sqo_date,
  salesforce_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND is_sqo_unique = 1
ORDER BY COALESCE(Underwritten_AUM__c, Amount, 0) DESC
LIMIT 5;
```

### Q2.6: Validate Against CSV Export
**Question**: Compare the BigQuery result against the validation CSV. Count records by stage in both and identify any discrepancies.

**Why This Matters**: Ensures our query logic matches the existing Looker dashboard.

**Cursor Action**:
```bash
# Count records by stage in the CSV
awk -F',' 'NR>1 {stages[$5]++} END {for (s in stages) print s, stages[s]}' /path/to/detail-records_2026-01-21__2_.csv | sort
```

And BigQuery:
```sql
-- Count by stage from BigQuery
SELECT
  StageName,
  COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND is_sqo_unique = 1
GROUP BY StageName
ORDER BY StageName;
```

---

## SECTION 3: Existing Component Reuse Questions

### Q3.1: Scorecard Component
**Question**: How is the Open Pipeline AUM scorecard implemented on the main dashboard? Show the component code.

**Why This Matters**: We want to reuse the same scorecard component on the dedicated page.

**Cursor Action**:
```bash
grep -r "openPipelineAum" src/components/ --include="*.tsx" -A 10 -B 5
cat src/components/dashboard/Scorecards.tsx
```

### Q3.2: OpenPipelineAumTooltip Component
**Question**: Show the full implementation of OpenPipelineAumTooltip.tsx.

**Why This Matters**: We should reuse this tooltip on the dedicated page.

**Cursor Action**:
```bash
cat src/components/dashboard/OpenPipelineAumTooltip.tsx
```

### Q3.3: DrillDown Modal Pattern
**Question**: How does the existing drill-down modal work for metric clicks? Show the MetricDrillDownModal or similar component.

**Why This Matters**: We need to implement bar-click drill-down with the same pattern.

**Cursor Action**:
```bash
cat src/components/sga-hub/MetricDrillDownModal.tsx 2>/dev/null
cat src/components/dashboard/VolumeDrillDownModal.tsx 2>/dev/null
# Find any drill-down modal patterns
grep -r "DrillDown" src/components/ --include="*.tsx" -l
```

### Q3.4: RecordDetailModal Integration
**Question**: How is RecordDetailModal invoked from other components? Show the props interface and usage pattern.

**Why This Matters**: We need to open record details when clicking a row in the drill-down.

**Cursor Action**:
```bash
grep -r "RecordDetailModal" src/ --include="*.tsx" -A 5 -B 2 | head -100
cat src/components/dashboard/RecordDetailModal.tsx | head -100
```

### Q3.5: DetailRecordsTable Component
**Question**: Show the DetailRecordsTable component implementation. Can it be reused for the drill-down list?

**Why This Matters**: We may be able to reuse this for the drill-down display.

**Cursor Action**:
```bash
cat src/components/dashboard/DetailRecordsTable.tsx
```

### Q3.6: Filter Components
**Question**: What filter components exist that could be used for stage selection? Show MultiSelect or similar.

**Why This Matters**: We need a stage filter that lets users toggle stages on/off.

**Cursor Action**:
```bash
grep -r "MultiSelect" src/components/ --include="*.tsx" -l
grep -r "Select" src/components/ui/ --include="*.tsx" -l
cat src/components/GlobalFilters.tsx 2>/dev/null || cat src/components/dashboard/GlobalFilters.tsx
```

---

## SECTION 4: API and Data Flow Questions

### Q4.1: API Client Pattern
**Question**: How are API calls made from the dashboard? Show the dashboardApi client.

**Why This Matters**: We need to follow the same pattern for the new endpoint.

**Cursor Action**:
```bash
cat src/lib/api-client.ts | head -150
```

### Q4.2: Existing getOpenPipelineSummary Function
**Question**: Does getOpenPipelineSummary already return by-stage breakdown? What's the response structure?

**Why This Matters**: We may be able to use this directly for the bar chart.

**Cursor Action**:
```bash
grep -A 50 "getOpenPipelineSummary" src/lib/queries/open-pipeline.ts
```

### Q4.3: Caching Pattern
**Question**: How is caching implemented for dashboard queries? Show the cachedQuery pattern.

**Why This Matters**: The new queries should use the same caching strategy.

**Cursor Action**:
```bash
cat src/lib/cache.ts | head -100
grep -r "cachedQuery" src/lib/queries/ --include="*.ts" | head -20
```

### Q4.4: Permission Checks
**Question**: How are page-level permissions enforced? Who can access /dashboard/pipeline?

**Why This Matters**: Page 3 (Open Pipeline) has restricted access (admin, manager, sgm only per ARCHITECTURE.md).

**Cursor Action**:
```bash
grep -r "pipeline" src/lib/permissions.ts
cat src/types/user.ts | grep -A 20 "UserPermissions"
```

---

## SECTION 5: Chart Implementation Questions

### Q5.1: Existing Bar Chart Example
**Question**: Show a complete example of a Tremor or Recharts bar chart used in the dashboard.

**Why This Matters**: We need to follow the same charting pattern.

**Cursor Action**:
```bash
# Find bar chart implementations
grep -r "BarChart" src/ --include="*.tsx" -l
# Show a complete example
grep -A 50 "BarChart" src/components/dashboard/SourcePerformanceChart.tsx 2>/dev/null
```

### Q5.2: Multi-Series Bar Chart
**Question**: Is there an existing example of a grouped/multi-series bar chart (two bars side by side)?

**Why This Matters**: We need two bars per stage (AUM and Count).

**Cursor Action**:
```bash
# Look for grouped bar charts
grep -r "grouped" src/components/ --include="*.tsx"
grep -r "dataKey" src/components/ --include="*.tsx" -A 3 -B 3 | head -50
```

### Q5.3: Chart Click Handlers
**Question**: How are bar click events handled in existing charts? Show the onClick pattern.

**Why This Matters**: Clicking a bar should open the drill-down modal.

**Cursor Action**:
```bash
grep -r "onClick" src/components/ --include="*.tsx" | grep -i "bar\|chart" | head -20
```

### Q5.4: Chart Formatting (Currency)
**Question**: How is AUM formatted in existing charts (billions, millions)?

**Why This Matters**: The AUM axis should show $XB or $XM format.

**Cursor Action**:
```bash
grep -r "formatCurrency\|AUM\|billion" src/lib/utils/ --include="*.ts"
cat src/lib/utils/date-helpers.ts | grep -A 10 "formatCurrency"
```

---

## SECTION 6: TypeScript Types Questions

### Q6.1: DetailRecord Type
**Question**: What is the DetailRecord type definition?

**Why This Matters**: The drill-down records need to match this type.

**Cursor Action**:
```bash
grep -A 50 "interface DetailRecord" src/types/dashboard.ts
# or
grep -A 50 "type DetailRecord" src/types/dashboard.ts
```

### Q6.2: Open Pipeline Types
**Question**: Are there existing types for open pipeline data?

**Why This Matters**: We may need to extend or create new types.

**Cursor Action**:
```bash
grep -r "OpenPipeline" src/types/ --include="*.ts"
```

---

## SECTION 7: State Management Questions

### Q7.1: Dashboard State Pattern
**Question**: How is state managed in the main dashboard page? (useState, useCallback, etc.)

**Why This Matters**: We should follow the same patterns.

**Cursor Action**:
```bash
grep -E "useState|useCallback|useEffect" src/app/dashboard/page.tsx | head -30
```

### Q7.2: Modal State Management
**Question**: How is modal state (open/close, selected record) managed?

**Why This Matters**: We need drill-down modal + record detail modal state.

**Cursor Action**:
```bash
grep -A 5 "selectedRecordId\|setSelectedRecordId" src/app/dashboard/page.tsx
grep -A 5 "DrillDown.*Open\|setDrillDown" src/app/dashboard/page.tsx 2>/dev/null
```

---

## SECTION 8: Implementation Verification Questions

### Q8.1: Compare CSV to BigQuery
**Question**: Load the validation CSV and compare record-by-record with BigQuery data to ensure matching.

**Why This Matters**: Final validation that our implementation will match existing Looker output.

**Cursor Action**:
1. Parse the CSV to extract opportunity IDs
2. Query BigQuery for those same IDs
3. Compare AUM, Stage, and other key fields

### Q8.2: Test Query Performance
**Question**: What is the query performance for the open pipeline queries? Run with dry_run to check bytes processed.

**Why This Matters**: Ensure queries are performant enough for real-time use.

**Cursor Action (BigQuery MCP)**:
```sql
-- Run with dry_run=true to see bytes processed
SELECT
  StageName as stage,
  COUNT(DISTINCT Full_Opportunity_ID__c) as advisor_count,
  SUM(COALESCE(Underwritten_AUM__c, Amount, 0)) as total_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND is_sqo_unique = 1
GROUP BY StageName;
```

---

## Output Format

After answering all questions, create `Open_pipeline_answers.md` in the project root with this structure:

```markdown
# Open Pipeline Implementation Answers

## Date Generated: [DATE]

## SECTION 1: Codebase Architecture Answers
### Q1.1 Answer: [...]
### Q1.2 Answer: [...]
[etc.]

## SECTION 2: BigQuery Data Validation Answers
### Q2.1 Answer: [...]
[etc.]

## SECTION 3: Component Reuse Answers
[...]

## Validation Summary
- Expected AUM: $12.5B | Actual: $[X]B | Match: Yes/No
- Expected Advisors: 109 | Actual: [X] | Match: Yes/No
- By Stage Validation: [table]

## Implementation Recommendations
Based on the answers above, here are the recommended implementation steps:
1. [...]
2. [...]
```

---

## Next Steps After Answers

Once all questions are answered in `Open_pipeline_answers.md`, the next document will be:
`Open_pipeline_implementation_guide.md` - A step-by-step agentic execution guide for Cursor.ai to build the page.
