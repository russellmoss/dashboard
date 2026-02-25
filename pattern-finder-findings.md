# Pattern Finder Findings: Stale Pipeline Alerts Feature

Generated: 2026-02-25

---

## Summary

8 pattern areas investigated for the Stale Pipeline Alerts feature.
CRITICAL FINDING: daysInCurrentStage has NEVER been displayed in the UI (only CSV exports).
The new Stale Pipeline Alerts section will be the first UI display of this field.

---

## Pattern 1: daysInCurrentStage Data Flow

### Entry Point
BigQuery vw_funnel_master -> open-pipeline.ts query functions -> DetailRecord type -> API route -> component

### Type Definition
File: src/types/dashboard.ts line 158

  daysInCurrentStage: number | null;

### Calculation Function
File: src/lib/utils/date-helpers.ts lines 261-319

  calculateDaysInStage(stage, oppCreatedDate, discoveryDate, salesProcessDate, negotiatingDate): number | null

Stage-to-date mapping:
  Qualifying -> oppCreatedDate (used as proxy, no dedicated column)
  Discovery -> discoveryDate
  Sales Process -> salesProcessDate
  Negotiating -> negotiatingDate

Returns Math.max(0, Math.floor(diffMs / 86400000)) or null if date unavailable.

### CRITICAL BUG: _getOpenPipelineRecords hardcodes null
File: src/lib/queries/open-pipeline.ts line 144

  daysInCurrentStage: null, // BUG: never calculated

This function is called by GET /api/dashboard/pipeline-overview.
It omits all stage-entry date columns from its SELECT.
Any UI reading from this endpoint will always see null.

### Correct Implementation: _getOpenPipelineRecordsByStage
File: src/lib/queries/open-pipeline.ts lines 262+

  daysInCurrentStage: calculateDaysInStage(
    toString(raw.Stage__c),
    extractDate(raw.Opp_Created_Date__c),
    extractDate(raw.Discovery_Date__c),
    extractDate(raw.Sales_Process_Date__c),
    extractDate(raw.Negotiating_Date__c)
  ),

This is called by POST /api/dashboard/pipeline-drilldown.
Use this endpoint for the Stale Pipeline Alerts feature.

### API Route
File: src/app/api/dashboard/pipeline-drilldown/route.ts

  POST body: { stage, filters?, sgms?, dateRange? }
  Returns: { records: DetailRecord[], stage: string }

### Only existing use of daysInCurrentStage in output
File: src/components/sga-hub/MetricDrillDownModal.tsx lines 127, 140, 155

  csv column: daysInCurrentStage ?? empty string

daysInCurrentStage is NOT in any visible UI column (DetailRecordsTable).
The Stale Pipeline Alerts section will be the FIRST UI display of this field.

---

## Pattern 2: Next Steps Fields

### Fields in DetailRecord (src/types/dashboard.ts)

  nextSteps: string | null         (line 173) -- from Next_Steps__c
  opportunityNextStep: string | null (line 174) -- from Opportunity_Next_Step__c

CONFIRMED: nextStepDate and daysUntilNextStep do NOT exist in DetailRecord.
Neither field exists in any type file or BigQuery schema.

### Transform pattern (src/lib/queries/drill-down.ts)

  nextSteps: raw.Next_Steps__c ? toString(raw.Next_Steps__c) : null,

### Rendering pattern (src/components/dashboard/RecordDetailModal.tsx lines 349-372)

Displayed in gray card, conditional render:
  {record.nextSteps || record.opportunityNextStep} && <section>...</section>

Two-field display: Next Steps (primary), Opportunity Next Step (secondary).
Shows only when at least one field is non-null.

---

## Pattern 3: Pipeline Tab Grouping and Display

File: src/app/dashboard/pipeline/page.tsx

### Stage constants (src/config/constants.ts)

  OPEN_PIPELINE_STAGES = [Qualifying, Discovery, Sales Process, Negotiating]

  STAGE_COLORS:
    Qualifying: #60a5fa
    Discovery:  #34d399
    Sales Process: #fbbf24
    Negotiating:   #f97316

### Section card pattern

  <Card className=mb-6>
    ... content ...
  </Card>

Use this card wrapper for the new Stale Pipeline Alerts section.

### Tab toggle pattern (lines 438-461)

  active:   bg-blue-600 text-white
  inactive: bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400

### Drill-down state management (lines 77-84)

  drillDownOpen: boolean
  drillDownRecords: DetailRecord[]
  drillDownLoading: boolean
  drillDownStage: string
  drillDownMetric: string

Entry point: handleBarClick (line 182)

---

## Pattern 4: Badge and Color Patterns for Status/Age

### 4-tier severity color system
File: src/lib/utils/freshness-helpers.ts lines 55-92

Function: getStatusColor(status: fresh | recent | stale | very_stale)

  fresh:      bg-green-50  dark:bg-green-900/20  text-green-700  dark:text-green-400
  recent:     bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400
  stale:      bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-400
  very_stale: bg-red-50    dark:bg-red-900/20    text-red-700    dark:text-red-400

Use this for the days-in-stage badge in Stale Pipeline Alerts.

### Stage badge pattern
File: src/components/dashboard/RecordDetailModal.tsx lines 157-173

Function: getStageBadgeClasses(stage)

  px-2.5 py-1 text-xs font-semibold rounded-full
  bg-{color}-100 dark:bg-{color}-900/30
  text-{color}-800 dark:text-{color}-200

---

## Pattern 5: Drilldown / Detail Panel

### Modal components
  VolumeDrillDownModal -- outer shell, fixed modal
  DetailRecordsTable  -- inner table, 50 records per page (line 160)
  RecordDetailModal   -- full record detail panel

### Pipeline page wiring
File: src/app/dashboard/pipeline/page.tsx

  <VolumeDrillDownModal
    open={drillDownOpen}
    records={drillDownRecords}
    loading={drillDownLoading}
    stage={drillDownStage}
    metricFilter=openPipeline
  />
  <RecordDetailModal
    record={selectedRecord}
    open={detailOpen}
  />

metricFilter=openPipeline is the correct value for pipeline drilldowns.

### CSV export in DetailRecordsTable
Uses ExportButton with Object.keys(data[0]) -- auto column mapping.
daysInCurrentStage is in DetailRecord so it WILL appear in auto CSV exports.
But it is NOT in any visible table column.

---

## Pattern 6: Configurable Thresholds

No configurable threshold UI exists in this codebase.
Thresholds are hardcoded in helper functions.

Example: freshness-helpers.ts uses hardcoded day boundaries.
No database table, no admin UI, no constants file for user-editable thresholds.

Recommendation for Stale Pipeline Alerts:
Follow existing pattern -- hardcode threshold in a constant or helper function.
Suggested: STALE_PIPELINE_THRESHOLDS in src/config/constants.ts

  const STALE_PIPELINE_THRESHOLDS = {
    Qualifying: 14,
    Discovery: 21,
    Sales_Process: 30,
    Negotiating: 21,
  };

---

## Pattern 7: Section Header Pattern

### Local SectionHeader component pattern
File: src/components/dashboard/RecordDetailModal.tsx lines 37-46

  const SectionHeader = ({ icon: Icon, title }) => (
    <div className=flex items-center gap-2 mb-3>
      <Icon className=h-4 w-4 text-gray-500 />
      <h3 className=text-sm font-semibold uppercase tracking-wide text-gray-500>
        {title}
      </h3>
    </div>
  );

Icon source: lucide-react
Used throughout RecordDetailModal for each section.

### Pipeline page section pattern
Sections are wrapped in <Card className=mb-6>.
Section title uses inline h2/h3 with font-semibold class, not a reusable component.

---

## Pattern 8: Null/Undefined Handling for Numeric Fields

### Type coercion helpers (src/types/bigquery-raw.ts lines 148-154)

  toNumber(value): number
    return Number(value) || 0;
    ALWAYS returns number, NEVER null.

  toString(value): string
    return value ?? empty string;
    ALWAYS returns string, NEVER null.

### Convention for nullable fields

Use explicit ternary for nullable semantics:
  raw.SomeField ? toNumber(raw.SomeField) : null

Do NOT use toNumber() alone if null is a valid/meaningful value.
toNumber(null) returns 0 -- this masks missing data.

daysInCurrentStage: number | null follows this convention correctly.
calculateDaysInStage() returns null when date is unavailable.

### CSV null handling pattern
  daysInCurrentStage ?? empty string
Nullish coalescing to empty string for CSV output.

---

---

## Drift Analysis: Inconsistencies Found

### 1. extractDate vs extractDateValue -- 3 different implementations

open-pipeline.ts: 4 inline extractDate() copies (one per query function)
  - Each function defines its own local extractDate()
  - No shared import

drill-down.ts: module-level extractDateValue() function
  - More defensive than open-pipeline inline versions
  - Different name, different location

Recommendation: consolidate into one exported function in date-helpers.ts

### 2. daysInCurrentStage calculation -- correct in 3 of 4 query functions

_getOpenPipelineRecords: hardcodes null (BUG)
_getOpenPipelineRecordsByStage: correct (uses calculateDaysInStage)
_getOpenPipelineRecordsBySgm: correct (uses calculateDaysInStage)
_getSgmConversionDrilldownRecords: correct (uses calculateDaysInStage)

The bug in _getOpenPipelineRecords is NOT relevant to Stale Pipeline Alerts
because the feature uses _getOpenPipelineRecordsByStage via pipeline-drilldown endpoint.

### 3. No shared type for stage-grouped records

Each query function returns DetailRecord[] with same fields but no shared intermediate type.
This is consistent with the rest of the codebase -- no intermediate types.

---

## Implementation Guidance for Stale Pipeline Alerts

### Data source
Use POST /api/dashboard/pipeline-drilldown
Body: { stage: StageName, filters: currentFilters }
This endpoint correctly populates daysInCurrentStage.

### Threshold logic
Add STALE_PIPELINE_THRESHOLDS constant to src/config/constants.ts.
Filter records server-side or client-side where daysInCurrentStage >= threshold.

### Color coding
Use getStatusColor() from src/lib/utils/freshness-helpers.ts.
Map days to status tier: fresh/recent/stale/very_stale.

### Section placement
Add as new <Card className=mb-6> section in pipeline page.
Position: after existing stage breakdown section.

### Drill-down
Can reuse existing VolumeDrillDownModal + DetailRecordsTable.
Pass metricFilter=openPipeline.
Pre-filter records to only stale ones before passing to modal.

### No new API route needed
pipeline-drilldown already provides what is needed.
The feature is entirely client-side filtering of existing data.

---

## Key Files Reference

src/types/dashboard.ts -- DetailRecord type
src/lib/utils/date-helpers.ts -- calculateDaysInStage()
src/lib/queries/open-pipeline.ts -- query functions
src/lib/utils/freshness-helpers.ts -- getStatusColor()
src/components/dashboard/RecordDetailModal.tsx -- badge + section patterns
src/app/dashboard/pipeline/page.tsx -- pipeline page
src/components/dashboard/VolumeDrillDownModal.tsx -- drilldown modal
src/components/dashboard/DetailRecordsTable.tsx -- records table
src/config/constants.ts -- stage names + colors
src/types/bigquery-raw.ts -- toNumber(), toString()

