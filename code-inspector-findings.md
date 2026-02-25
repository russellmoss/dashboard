# Code Inspector Findings: Stale Pipeline Alerts

## 1. DetailRecord and DrillDownRecordBase Types

### DetailRecord
File: src/types/dashboard.ts  Lines: 130-175

daysInCurrentStage ALREADY EXISTS on DetailRecord at line 158:
  daysInCurrentStage: number | null;  // days since entering current stage

Stage-entry dates available for aging calculation:
  discoveryDate: string|null   line 152 - Stage_Entered_Discovery__c
  salesProcessDate: string|null line 153 - Stage_Entered_Sales_Process__c
  negotiatingDate: string|null  line 154 - Stage_Entered_Negotiating__c
  onHoldDate: string|null       line 155 - Stage_Entered_On_Hold__c
  oppCreatedDate: string|null   line 157 - Opp_CreatedDate (Qualifying proxy)
  signedDate: string|null       line 151 - Stage_Entered_Signed__c
  stage: string                 line 135 - StageName (current opportunity stage)

### DrillDownRecordBase
File: src/types/drill-down.ts  Lines: 11-22
daysInCurrentStage: number | null at line 21.

Conclusion: No type changes required. Both types already have daysInCurrentStage.

---

## 2. calculateDaysInStage Utility
File: src/lib/utils/date-helpers.ts  Lines: 261-319

Fully implemented. Returns integer days from stage entry to today, or null.

Stage-to-date mapping:
  Qualifying    -> oppCreatedDate (no Stage_Entered_Qualifying__c exists)
  Discovery     -> discoveryDate
  Sales Process -> salesProcessDate
  Negotiating   -> negotiatingDate
  Signed        -> signedDate
  On Hold       -> onHoldDate
  Closed Lost   -> closedDate
  Joined        -> joinedDate

---

## 3. Pipeline Tab Component
File: src/app/dashboard/pipeline/page.tsx  Lines: 1-571

Current render structure (top to bottom):
1. PipelineScorecard (line 412) - AUM + advisor count, both clickable
2. PipelineFilters (line 424) - stage multi-select, SGM multi-select
3. Tab Toggle By Stage / By SGM (line 438) - revops_admin only
4. SqlDateFilter (line 464) - By SGM tab only
5. Card with chart (lines 472-523) - PipelineByStageChart or PipelineBySgmChart
6. SgmConversionTable (line 526) - By SGM tab only
7. VolumeDrillDownModal (line 535) - reused for all drill-down lists
8. RecordDetailModal (line 561) - opens from drill-down row click

NEW SECTION INSERT POINT:
After line 523 (closing chart Card), before line 534 (VolumeDrillDownModal).
Condition: activeTab === byStage

---

## 4. Open Pipeline Data Fetching

API Routes in src/app/api/dashboard/:
  pipeline-summary/        -> getOpenPipelineSummary (aggregates only, no DetailRecords)
  pipeline-drilldown/      -> getOpenPipelineRecordsByStage (DetailRecords WITH daysInCurrentStage)
  pipeline-drilldown-sgm/  -> getOpenPipelineRecordsBySgm (DetailRecords WITH daysInCurrentStage)
  pipeline-by-sgm/         -> getOpenPipelineBySgm (aggregates by SGM)

Query Functions in src/lib/queries/open-pipeline.ts:

getOpenPipelineRecords (exported, line 162):
  Does NOT compute daysInCurrentStage - hardcodes null at line 144.
  Does NOT select stage entry date columns.
  Not called by pipeline drill-down. Do NOT use for stale alerts.

getOpenPipelineRecordsByStage (exported, line 466):
  Called by pipeline-drilldown route.
  DOES compute daysInCurrentStage via calculateDaysInStage() at line 403.
  SELECT includes discovery_date, sales_process_date, negotiating_date,
  signed_date, on_hold_date, closed_date.

getOpenPipelineRecordsBySgm (exported, line 753):
  Called by pipeline-drilldown-sgm route.
  DOES compute daysInCurrentStage at line 690.
  SELECT includes all stage entry dates.

getSgmConversionDrilldownRecords (exported, line 1061):
  DOES compute daysInCurrentStage at line 998.

KEY: Existing drill-down queries already return daysInCurrentStage populated.
Stale alerts reuse these routes without modification.

---

## 5. All DetailRecord Construction Sites

SITE 1 - getOpenPipelineRecords (intentional null)
  File: src/lib/queries/open-pipeline.ts  Lines: 116-159
  daysInCurrentStage: null  (line 144)
  Not used by pipeline drill-down. No stage-entry columns in SELECT.

SITE 2 - _getOpenPipelineRecordsByStage (full calculation)
  File: src/lib/queries/open-pipeline.ts  Lines: 357-463
  calculateDaysInStage({...}) at line 403
  return { ..., daysInCurrentStage } at line 448

SITE 3 - _getOpenPipelineRecordsBySgm (full calculation)
  File: src/lib/queries/open-pipeline.ts  Lines: 554-751
  calculateDaysInStage({...}) at line 690
  return { ..., daysInCurrentStage } at line 735

SITE 4 - _getSgmConversionDrilldownRecords (full calculation)
  File: src/lib/queries/open-pipeline.ts  Lines: 857-1059
  calculateDaysInStage({...}) at line 998
  return { ..., daysInCurrentStage } at line 1043

SITE 5 - _getDetailRecords (main dashboard funnel)
  File: src/lib/queries/detail-records.ts  Lines: 322-435
  calculateDaysInStage({...}) at line 372
  return { ..., daysInCurrentStage } at line 417

SITE 6 - ExploreResults.tsx (AI Explore, inline construction)
  File: src/components/dashboard/ExploreResults.tsx  Lines: 893-938
  daysInCurrentStage: null  (line 937) - intentional, AI lacks stage entry dates

Total: 6 construction sites.
Sites 2, 3, 4, 5 fully compute daysInCurrentStage.
Sites 1 and 6 intentionally null (expected for those data paths).
No new construction sites needed for Stale Pipeline Alerts.

---

## 6. Existing Stage Grouping Patterns

No existing component groups DetailRecord[] by stage client-side.

Closest existing patterns:
  PipelineByStageChart: groups aggregated OpenPipelineByStage summary data (not DetailRecords)
  RecruiterHubContent.tsx (src/app/dashboard/recruiter-hub/RecruiterHubContent.tsx) lines 52-87:
    Defines OPEN_OPPORTUNITY_STAGES_RH and OPPORTUNITY_STAGE_COLORS
    Best reference for stage-grouped display with color coding per stage.

OPPORTUNITY_STAGE_COLORS (RecruiterHubContent.tsx lines 76-87):
  Qualifying:      bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400
  Discovery:       bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400
  Sales Process:   bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400
  Negotiating:     bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400
  Signed:          bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400
  On Hold:         bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300

STAGE_COLORS hex values (src/config/constants.ts lines 23-31):
  Qualifying: #60a5fa  Discovery: #34d399  Sales Process: #fbbf24
  Negotiating: #f97316  Signed: #a78bfa  On Hold: #f87171

---

## 7. Drilldown / Detail Click Pattern

Established in src/app/dashboard/pipeline/page.tsx:
  1. Bar/segment click -> handleBarClick(stage, metric) -> fetches -> VolumeDrillDownModal
  2. Row click -> handleRecordClick(record.id) line 284 -> closes modal -> RecordDetailModal
  3. RecordDetailModal fetches full record by ID
  4. Back button -> handleBackToDrillDown() line 290 -> re-opens VolumeDrillDownModal

VolumeDrillDownModal (src/components/dashboard/VolumeDrillDownModal.tsx):
  Wraps DetailRecordsTable.
  Props: records: DetailRecord[], title, loading, error, onRecordClick, metricFilter, canExport

For Stale Pipeline Alerts: reuse the same VolumeDrillDownModal + RecordDetailModal stack.
Stage group click -> setDrillDownRecords(stageRecords), setDrillDownStage(stage), setDrillDownOpen(true).

---

## 8. Existing Threshold / Alert UI Patterns

DataFreshnessIndicator: green/red dot + background.
  bg-green-50 text-green-700 / bg-red-50 text-red-700

DetailRecordsTable stage flag spans (lines 578-582):
  text-red-600 dark:text-red-400       Contacted flag
  text-orange-600 dark:text-orange-400 MQL flag
  text-blue-600 dark:text-blue-400     SQL flag
  text-green-600 dark:text-green-400   SQO flag

Tremor Badge: imported in DetailRecordsTable.tsx line 4. Available.

Recommended aging badge pattern (needs to be created):
  >90 days:   bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400
  60-90 days: bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400
  30-60 days: bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400
  <30 days:   bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400

---

## 9. Where the New Section Slots In

File: src/app/dashboard/pipeline/page.tsx

INSERT AFTER line 523 (closing chart Card), BEFORE line 534 (VolumeDrillDownModal comment).
Render condition: activeTab === byStage

Existing page state for reuse:
  selectedStages (line 50)   - current stage filter
  selectedSgms (line 51)     - current SGM filter
  sgmOptions (line 46)
  sgmOptionsLoading (line 47)
  drillDownRecords (line 78)  - reuse drill-down list state
  drillDownOpen (line 77)
  drillDownLoading (line 79)
  drillDownStage (line 80)
  selectedRecordId (line 84)
  handleRecordClick (line 284)
  handleCloseDrillDown (line 343)

---

## 10. Exists vs Needs to Be Built

ALREADY EXISTS (reuse):
  DetailRecord.daysInCurrentStage - src/types/dashboard.ts line 158
  calculateDaysInStage() - src/lib/utils/date-helpers.ts lines 261-319
  getOpenPipelineRecordsByStage() - src/lib/queries/open-pipeline.ts line 262
  getOpenPipelineRecordsBySgm() - src/lib/queries/open-pipeline.ts line 554
  VolumeDrillDownModal component
  RecordDetailModal component
  OPPORTUNITY_STAGE_COLORS pattern - RecruiterHubContent.tsx lines 76-87
  STAGE_COLORS hex constants - src/config/constants.ts lines 23-31
  OPEN_PIPELINE_STAGES constant - src/config/constants.ts line 6
  PipelineFilters component
  pipeline-drilldown API route (already returns daysInCurrentStage)
  dashboardApi.getPipelineDrilldown() - src/lib/api-client.ts line 357
  Drill-down state in pipeline/page.tsx

NEEDS TO BE BUILT NEW:

  1. StalePipelineAlerts component
     Path: src/components/dashboard/StalePipelineAlerts.tsx
     - Groups DetailRecord[] by record.stage client-side
     - Per-stage aging distribution at 30/60/90 day thresholds
     - Aging badges on each row
     - Stage group click triggers existing drill-down state

  2. Fetch logic in pipeline/page.tsx
     - New state: stalePipelineRecords, stalePipelineLoading
     - Parallel getPipelineDrilldown() per selectedStages entry
     - Deduplication by record.id (same as handleAumClick, lines 215-228)
     - Triggered by selectedStages/selectedSgms changes

  3. getAgingBadgeStyle(days: number | null): string helper function

API ROUTE CHANGES: None required.
NEW BIGQUERY FIELDS: None required.

---

## 11. Important Architecture Notes

1. Do NOT use getOpenPipelineRecords for stale alerts.
   It hardcodes daysInCurrentStage: null and omits stage-entry date columns.
   Use getOpenPipelineRecordsByStage (pipeline-drilldown route) instead.

2. Follow handleAumClick pattern (pipeline/page.tsx lines 202-240) for fetch logic.
   It fetches one stage at a time in parallel, then deduplicates by record.id.
   This is the correct model for fetching all open pipeline records across stages.

3. OPEN_PIPELINE_STAGES = [Qualifying, Discovery, Sales Process, Negotiating]
   src/config/constants.ts line 6. Only these 4 stages are open pipeline.
   Signed and On Hold are excluded from open pipeline but present in DetailRecord.stage.

4. Stale alerts must respect selectedStages filter from PipelineFilters.
   If selectedStages is empty, show all OPEN_PIPELINE_STAGES.
   If selectedStages has entries, only fetch and display those stages.

5. Export path: no changes needed.
   ExportButton uses Object.keys - automatically includes daysInCurrentStage.
   ExportMenu and MetricDrillDownModal use explicit column mappings - no new fields added.

6. The cachedQuery wrapper is used by all query functions.
   Exported functions (getOpenPipelineRecordsByStage etc.) are the cached wrappers.
   Internal functions (prefixed _) contain the actual BigQuery logic.

7. StalePipelineAlerts component should accept:
   props: { records: DetailRecord[], loading: boolean, onStageClick: (stage: string, records: DetailRecord[]) => void }
   It groups records client-side by record.stage, no extra API calls needed.

---
