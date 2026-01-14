# SGA Management & SGA Hub Upgrade - Investigation Answers

**Date**: January 27, 2026
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

**File**: `src/app/dashboard/sga-management/SGAManagementContent.tsx`

**Current Table Structure**:
The component does NOT render a table directly. Instead, it:
- Renders summary cards (Total SGAs, Behind Pacing, Missing Weekly Goals, Missing Quarterly Goals)
- Renders filter inputs (Week, Quarter, Select SGA dropdown)
- Renders `AdminSGATable` component (which contains the actual table)
- Renders a "Selected SGA Details" card when an SGA is selected

**Abbreviation Locations**:
- **Line 232**: `IC: ${selectedSGA.currentWeekGoal.initialCallsGoal}, QC: ${selectedSGA.currentWeekGoal.qualificationCallsGoal}, SQO: ${selectedSGA.currentWeekGoal.sqoGoal}`
- **Line 240**: `IC: ${selectedSGA.currentWeekActual.initialCalls}, QC: ${selectedSGA.currentWeekActual.qualificationCalls}, SQO: ${selectedSGA.currentWeekActual.sqos}`

These abbreviations appear in the "Selected SGA Details" card section (lines 217-325), NOT in the main table.

**State Management**:
```typescript
const [loading, setLoading] = useState(true);
const [sgaOverviews, setSgaOverviews] = useState<AdminSGAOverview[]>([]);
const [selectedSGAEmail, setSelectedSGAEmail] = useState<string | null>(null);
const [showBulkEditor, setShowBulkEditor] = useState(false);
const [showIndividualEditor, setShowIndividualEditor] = useState(false);
const [editingSGAEmail, setEditingSGAEmail] = useState<string | null>(null);
const [editingGoalType, setEditingGoalType] = useState<'weekly' | 'quarterly'>('weekly');
const [weekStartDate, setWeekStartDate] = useState<string>(formatDateISO(getWeekMondayDate(new Date())));
const [quarter, setQuarter] = useState<string>(getCurrentQuarter());
```

**Week and Quarter Selectors**:
- **Week Selector** (Lines 170-175): Native HTML `<input type="date">` with Tailwind styling
- **Quarter Selector** (Lines 179-185): Native HTML `<input type="text">` with placeholder "2025-Q1"
- Both use controlled state (`weekStartDate`, `quarter`)
- Both trigger `fetchSGAOverviews()` via `useEffect` dependency on `[weekStartDate, quarter]`

**Props Passed to AdminSGATable**:
```typescript
<AdminSGATable
  sgaOverviews={sgaOverviews}
  selectedSGAEmail={selectedSGAEmail}
  onSGASelect={setSelectedSGAEmail}
  onEditGoal={handleEditGoal}
  onRefresh={handleRefresh}
  weekStartDate={weekStartDate}
  quarter={quarter}
/>
```

### 1.2 AdminSGATable Component

**File**: `src/components/sga-hub/AdminSGATable.tsx`

**Current Table Columns**:
| Column | Header | Data Source |
|--------|--------|-------------|
| Expand | (chevron icon) | `expandedRows` state |
| Name | Name | `overview.userName` |
| Email | Email | `overview.userEmail` |
| Week Status | Week Status | Badge from `getWeekStatusBadge()` |
| Quarter Status | Quarter Status | Badge from `getQuarterStatusBadge()` |
| Alerts | Alerts | Badges from `getAlertsBadges()` |
| Actions | Actions | Edit Weekly, Edit Quarterly, View Hub buttons |

**Expandable Row Implementation**:
- Uses `expandedRows` state (Set<string>) to track which rows are expanded
- `toggleRow(email)` function adds/removes email from Set
- Expanded row renders as a `<TableRow>` with `colSpan={7}` containing:
  - Current Week section (grid layout)
  - Current Quarter section (grid layout)
  - Additional Info section (full width)

**Abbreviation Locations in Expanded Rows**:
- **Line 214**: `IC: ${overview.currentWeekGoal.initialCallsGoal}, QC: ${overview.currentWeekGoal.qualificationCallsGoal}, SQO: ${overview.currentWeekGoal.sqoGoal}`
- **Line 222**: `IC: ${overview.currentWeekActual.initialCalls}, QC: ${overview.currentWeekActual.qualificationCalls}, SQO: ${overview.currentWeekActual.sqos}`

**Data Types**:
- Props: `AdminSGATableProps` with `sgaOverviews: AdminSGAOverview[]`
- `AdminSGAOverview` includes:
  - `currentWeekGoal: WeeklyGoal | null`
  - `currentWeekActual: WeeklyActual | null`
  - `currentQuarterGoal: QuarterlyGoal | null`
  - `currentQuarterProgress: QuarterlyProgress | null`

**Edit Weekly/Quarterly Buttons**:
- Located in Actions column (Lines 167-198)
- Two separate buttons: "Edit Weekly" and "Edit Quarterly"
- Both call `onEditGoal(overview.userEmail, 'weekly' | 'quarterly')`
- `e.stopPropagation()` prevents row expansion on button click

**CSS/Tailwind Classes for Text Sizes**:
- **Expanded row labels**: `text-gray-600 dark:text-gray-400 font-medium` (Line 211, 234, 250)
- **Expanded row values**: `text-gray-900 dark:text-white` (Line 212, 220, 235, 243, 251)
- **Main table cells**: Default Tremor Table styling
- **Font sizes**: No explicit size classes - uses default `text-sm` from Tremor Table

### 1.3 Current Week/Quarter Tables in Expanded Rows

**Current Week Section Structure** (Lines 207-227):
```typescript
<div>
  <Text className="font-semibold mb-3 text-gray-900 dark:text-white">
    Current Week ({formatDate(weekStartDate)})
  </Text>
  <div className="space-y-2 text-sm">
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <Text className="text-gray-600 dark:text-gray-400 font-medium">Goal:</Text>
      <Text className="text-gray-900 dark:text-white">
        {overview.currentWeekGoal
          ? `IC: ${overview.currentWeekGoal.initialCallsGoal}, QC: ${overview.currentWeekGoal.qualificationCallsGoal}, SQO: ${overview.currentWeekGoal.sqoGoal}`
          : 'Not set'}
      </Text>
    </div>
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <Text className="text-gray-600 dark:text-gray-400 font-medium">Actual:</Text>
      <Text className="text-gray-900 dark:text-white">
        {overview.currentWeekActual
          ? `IC: ${overview.currentWeekActual.initialCalls}, QC: ${overview.currentWeekActual.qualificationCalls}, SQO: ${overview.currentWeekActual.sqos}`
          : 'No data'}
      </Text>
    </div>
  </div>
</div>
```

**Current Quarter Section Structure** (Lines 230-258):
```typescript
<div>
  <Text className="font-semibold mb-3 text-gray-900 dark:text-white">
    Current Quarter ({quarter})
  </Text>
  <div className="space-y-2 text-sm">
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <Text className="text-gray-600 dark:text-gray-400 font-medium">Goal:</Text>
      <Text className="text-gray-900 dark:text-white">
        {overview.currentQuarterGoal
          ? `${overview.currentQuarterGoal.sqoGoal} SQOs`
          : 'Not set'}
      </Text>
    </div>
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <Text className="text-gray-600 dark:text-gray-400 font-medium">Actual:</Text>
      <Text className="text-gray-900 dark:text-white">
        {overview.currentQuarterProgress
          ? `${overview.currentQuarterProgress.sqoActual} SQOs (${overview.currentQuarterProgress.progressPercent?.toFixed(0) || 0}%)`
          : 'No data'}
      </Text>
    </div>
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <Text className="text-gray-600 dark:text-gray-400 font-medium">Pacing:</Text>
      <Text className="text-gray-900 dark:text-white">
        {overview.currentQuarterProgress
          ? `${overview.currentQuarterProgress.pacingStatus} (${overview.currentQuarterProgress.pacingDiff > 0 ? '+' : ''}${overview.currentQuarterProgress.pacingDiff.toFixed(1)})`
          : 'N/A'}
      </Text>
    </div>
  </div>
</div>
```

**CSS Grid Layout**:
- Uses `grid grid-cols-[80px_1fr] gap-2` for label/value pairs
- 80px fixed width for labels
- `1fr` for values (takes remaining space)
- `gap-2` (0.5rem) spacing between columns

**Goal and Actual Value Display**:
- **Goal**: Displays as concatenated string: `"IC: X, QC: Y, SQO: Z"` (for week) or `"X SQOs"` (for quarter)
- **Actual**: Same format as Goal
- Both use `Text` component from Tremor with `text-gray-900 dark:text-white` classes
- No explicit font size (inherits `text-sm` from parent `space-y-2 text-sm`)

---

## 2. Current SGA Hub Page Analysis

### 2.1 SGA Hub Content Component

**File**: `src/app/dashboard/sga-hub/SGAHubContent.tsx`

**Tabs Structure**:
- Uses `SGAHubTabs` component with three tabs:
  - `'weekly-goals'` - Renders `WeeklyGoalsTable`
  - `'closed-lost'` - Renders `ClosedLostTable`
  - `'quarterly-progress'` - Renders `QuarterlyProgressCard`, `QuarterlyProgressChart`, `SQODetailTable`

**State Management**:
```typescript
const [activeTab, setActiveTab] = useState<SGAHubTab>('weekly-goals');
const [dateRange, setDateRange] = useState(getDefaultWeekRange());
const [weeklyGoals, setWeeklyGoals] = useState<WeeklyGoal[]>([]);
const [weeklyActuals, setWeeklyActuals] = useState<WeeklyActual[]>([]);
const [goalsWithActuals, setGoalsWithActuals] = useState<WeeklyGoalWithActuals[]>([]);
const [closedLostRecords, setClosedLostRecords] = useState<ClosedLostRecord[]>([]);
const [selectedQuarter, setSelectedQuarter] = useState<string>(getCurrentQuarter());
const [quarterlyProgress, setQuarterlyProgress] = useState<QuarterlyProgress | null>(null);
const [sqoDetails, setSqoDetails] = useState<SQODetail[]>([]);
const [historicalProgress, setHistoricalProgress] = useState<QuarterlyProgress[]>([]);
```

**Weekly Goals Tab Structure**:
- Date range inputs (Start Date, End Date, Reset to Default button)
- Export CSV button
- Error display (Card with red background)
- `WeeklyGoalsTable` component

**Quarterly Progress Tab Structure**:
- Quarter selector dropdown (native `<select>`)
- Export CSV button
- Error display
- `QuarterlyProgressCard` component
- `QuarterlyProgressChart` component
- `SQODetailTable` component

### 2.2 Weekly Goals Table

**File**: `src/components/sga-hub/WeeklyGoalsTable.tsx`

**Columns Displayed**:
| Column | Header | Data Source |
|--------|--------|-------------|
| Week | Week | `goal.weekLabel` |
| Initial Calls | Initial Calls | `goal.initialCallsActual` / `goal.initialCallsGoal` |
| Qualification Calls | Qualification Calls | `goal.qualificationCallsActual` / `goal.qualificationCallsGoal` |
| SQOs | SQOs | `goal.sqoActual` / `goal.sqoGoal` |
| Actions | Actions | Edit button |

**Abbreviations Used**:
- **NO abbreviations in column headers** - Full names: "Initial Calls", "Qualification Calls", "SQOs"
- Values are displayed as numbers only (no "IC:", "QC:" prefixes)

**Goal vs Actual Comparison Rendering**:
- **Lines 165-178**: Initial Calls column
  - Actual value: `<span className="font-medium">{goal.initialCallsActual}</span>`
  - Goal value: `<span className="text-xs text-gray-500 dark:text-gray-400">/ {goal.initialCallsGoal}</span>`
  - Difference: `<span className="text-xs font-medium ${initialCallsDiff.color}">{initialCallsDiff.text}</span>`
- Same pattern for Qualification Calls (Lines 180-194) and SQOs (Lines 195-209)

**Current Font Size for Numbers**:
- Actual numbers: `font-medium` (no explicit size, inherits default)
- Goal numbers: `text-xs` (extra small)
- Difference: `text-xs font-medium`
- **No explicit large font size** - numbers are relatively small

### 2.3 Quarterly Progress Card

**File**: `src/components/sga-hub/QuarterlyProgressCard.tsx`

**Quarterly Progress Display**:
- Header with quarter label and pacing status badge
- SQO progress bar with percentage
- Stats grid: Total AUM, Expected SQOs
- Time progress: Days Elapsed / Days in Quarter

**Clickable Elements**:
- **NO clickable elements** - All display-only
- SQO count is displayed but not clickable: `SQOs: {sqoActual.toFixed(0)} {hasGoal && sqoGoal ? `of ${sqoGoal.toFixed(0)}` : ''}`

**Data Received**:
- Props: `{ progress: QuarterlyProgress }`
- `QuarterlyProgress` includes: `sqoActual`, `sqoGoal`, `progressPercent`, `totalAumFormatted`, `expectedSqos`, `pacingStatus`, etc.

---

## 3. RecordDetailModal Pattern Analysis

### 3.1 RecordDetailModal Component

**File**: `src/components/dashboard/RecordDetailModal.tsx`

**Complete Component Structure**:
- Fixed backdrop with blur (`fixed inset-0 bg-black/50 backdrop-blur-sm`)
- Modal container: `max-w-4xl`, `max-h-[90vh]`, `overflow-hidden`, `flex flex-col`
- Header: Fixed, contains title, badges, close button
- Scrollable content: `flex-1 overflow-y-auto p-6`
- Footer: Fixed, contains Salesforce links

**Props**:
```typescript
interface RecordDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  recordId: string | null;
  initialRecord?: RecordDetailFull | null;
}
```

**Fetch Logic**:
- Uses `dashboardApi.getRecordDetail(recordId)` (Line 99)
- Only fetches if `isOpen && recordId && !initialRecord`
- Sets loading state, handles errors

**Sections Displayed**:
1. **Funnel Progress** (Lines 256-262): Uses `FunnelProgressStepper` component
2. **Attribution** (Lines 267-278): Source, Channel, SGA, SGM, External Agency, Lead Score Tier, Experiment Tag
3. **Key Dates** (Lines 281-293): Created, Contacted, MQL, Initial Call, SQL, Qualification Call, SQO, Joined
4. **Financials** (Lines 296-306): AUM, Underwritten AUM, Amount, AUM Tier (only for Opportunity/Converted records)
5. **Status** (Lines 309-323): Current Stage, TOF Stage, Conversion Status, Disposition, Closed Lost Reason/Details
6. **Stage Entry Dates** (Lines 327-342): Discovery, Sales Process, Negotiating, Signed, On Hold, Closed, Advisor Joined
7. **Record IDs** (Lines 345-352): Primary Key, Lead ID, Opportunity ID

**Helper Components**:
- `SectionHeader` (Lines 32-41): Icon + title with uppercase styling
- `DetailRow` (Lines 44-63): Label/value pair with optional highlight
- `DateRow` (Lines 66-81): Date label/value with formatting via `formatDate()`

**Loading State**:
- Uses `RecordDetailSkeleton` component (Line 250)
- Shows skeleton while `loading === true`

**Dark Mode Support**:
- All text uses `dark:` variants
- Backgrounds: `dark:bg-gray-800`, `dark:bg-gray-900/50`
- Borders: `dark:border-gray-700`
- Text colors: `dark:text-white`, `dark:text-gray-400`

**Modal Width and Max-Height**:
- Width: `max-w-4xl` (896px)
- Max-height: `max-h-[90vh]` (90% of viewport height)

### 3.2 FunnelProgressStepper Component

**File**: `src/components/dashboard/FunnelProgressStepper.tsx`

**Props**:
```typescript
interface FunnelProgressStepperProps {
  flags: FunnelStageFlags;
  tofStage: string;
}
```

**Funnel Stage Visualization**:
- Renders 5 stages: Contacted, MQL, SQL, SQO, Joined
- Each stage has a circle indicator (completed = green with check, current = blue with ring, future = gray)
- Connector lines between stages (green if next stage completed, gray otherwise)
- Stage labels below circles

### 3.3 RecordDetailSkeleton Component

**File**: `src/components/dashboard/RecordDetailSkeleton.tsx`

**Loading Skeleton Structure**:
- Header skeleton (title + badge placeholders)
- Funnel stepper skeleton (5 circles with connectors)
- Sections grid skeleton (4 sections with detail rows)
- Salesforce links skeleton

### 3.4 Record Detail Types

**File**: `src/types/record-detail.ts`

**RecordDetailFull Interface** (Complete):
```typescript
export interface RecordDetailFull {
  // Identifiers
  id: string;                          // primary_key
  fullProspectId: string | null;       // Full_prospect_id__c
  fullOpportunityId: string | null;    // Full_Opportunity_ID__c
  advisorName: string;
  recordType: 'Lead' | 'Opportunity' | 'Converted';
  recordTypeName: string | null;
  
  // Attribution
  source: string;
  channel: string;
  sga: string | null;
  sgm: string | null;
  externalAgency: string | null;
  leadScoreTier: string | null;
  experimentationTag: string | null;
  
  // Dates - Key Milestones
  createdDate: string | null;
  filterDate: string | null;
  contactedDate: string | null;
  mqlDate: string | null;
  sqlDate: string | null;
  sqoDate: string | null;
  joinedDate: string | null;
  
  // Dates - Calls
  initialCallScheduledDate: string | null;
  qualificationCallDate: string | null;
  
  // Dates - Stage Entry
  stageEnteredDiscovery: string | null;
  stageEnteredSalesProcess: string | null;
  stageEnteredNegotiating: string | null;
  stageEnteredSigned: string | null;
  stageEnteredOnHold: string | null;
  stageEnteredClosed: string | null;
  leadClosedDate: string | null;
  oppCreatedDate: string | null;
  
  // Financials
  aum: number | null;
  aumFormatted: string;
  underwrittenAum: number | null;
  underwrittenAumFormatted: string;
  amount: number | null;
  amountFormatted: string;
  aumTier: string | null;
  
  // Status
  stageName: string | null;
  tofStage: string;
  conversionStatus: string;
  disposition: string | null;
  closedLostReason: string | null;
  closedLostDetails: string | null;
  
  // Funnel Flags
  funnelFlags: FunnelStageFlags;
  progressionFlags: ProgressionFlags;
  eligibilityFlags: EligibilityFlags;
  
  // URLs
  leadUrl: string | null;
  opportunityUrl: string | null;
  salesforceUrl: string;
  
  // Deduplication flags
  isPrimaryOppRecord: boolean;
  isSqoUnique: boolean;
  isJoinedUnique: boolean;
}
```

### 3.5 Record Detail API Route

**File**: `src/app/api/dashboard/record-detail/[id]/route.ts`

**How API Fetches Single Record**:
- GET handler with `[id]` dynamic route parameter
- Validates ID format (must start with `00Q` or `006`)
- Calls `getRecordDetail(id)` from `@/lib/queries/record-detail`
- Returns `{ record: RecordDetailFull | null }`

**Error Handling**:
- 401: Unauthorized (no session)
- 400: Invalid record ID or format
- 404: Record not found
- 500: Server error

### 3.6 Record Detail Query

**File**: `src/lib/queries/record-detail.ts`

**BigQuery Query Structure**:
- SELECTs from `vw_funnel_master` (FULL_TABLE)
- LEFT JOINs `new_mapping` table for channel grouping
- WHERE clause: `v.primary_key = @id`
- Fetches all fields needed for `RecordDetailFull`

**Fields Fetched**:
- Identifiers: `primary_key`, `Full_prospect_id__c`, `Full_Opportunity_ID__c`, `advisor_name`, `record_type_name`
- Attribution: `Original_source`, `Channel_Grouping_Name`, `SGA_Owner_Name__c`, `SGM_Owner_Name__c`, etc.
- Dates: All milestone dates, call dates, stage entry dates
- Financials: `Opportunity_AUM`, `Underwritten_AUM__c`, `Amount`, `aum_tier`
- Status: `StageName`, `TOF_Stage`, `Conversion_Status`, etc.
- Flags: All funnel, progression, and eligibility flags
- URLs: `lead_url`, `opportunity_url`, `salesforce_url`

**Transformation**:
- `transformToRecordDetail()` function converts `RecordDetailRaw` to `RecordDetailFull`
- Uses `toString()`, `toNumber()`, `extractDateValue()` helpers
- Determines `recordType` based on presence of Lead/Opportunity IDs

---

## 4. BigQuery Data Analysis for Drill-Down Modals

**Note**: Based on existing query patterns in `weekly-actuals.ts` and `quarterly-progress.ts`, the following field availability is confirmed.

### 4.1 Initial Calls Records

**Query Structure** (based on `weekly-actuals.ts` pattern):
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
WHERE SGA_Owner_Name__c = @sgaName
  AND Initial_Call_Scheduled_Date__c IS NOT NULL
  AND Initial_Call_Scheduled_Date__c >= TIMESTAMP(@weekStartDate)
  AND Initial_Call_Scheduled_Date__c <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
ORDER BY Initial_Call_Scheduled_Date__c DESC
```

**Fields Available for Display**:
- `primary_key` - **CRITICAL**: Use this for RecordDetailModal `recordId`
- `advisor_name` - Advisor name
- `Initial_Call_Scheduled_Date__c` - Call date (TIMESTAMP, format as DATE)
- `Original_source` - Source
- `Channel_Grouping_Name` - Channel (may need LEFT JOIN with mapping table)
- `Lead_Score_Tier__c` - Lead score tier
- `AUM__c` - AUM (may be null for leads)
- `aum_tier` - AUM tier
- `TOF_Stage` - Current TOF stage
- `lead_url` - Constructed URL
- `opportunity_url` - Constructed URL

**Best Unique Identifier**:
- **`primary_key`** - This is the correct identifier for `RecordDetailModal`
- Format: Starts with `00Q` (Lead) or `006` (Opportunity)

**Date Format Returned**:
- `Initial_Call_Scheduled_Date__c` is a TIMESTAMP field
- Returns as `{ value: "2025-01-15T10:30:00Z" }` or string format
- Use `extractDateValue()` helper pattern from `record-detail.ts`

### 4.2 Qualification Calls Records

**Query Structure**:
```sql
SELECT 
  primary_key,
  advisor_name,
  SGA_Owner_Name__c,
  Qualification_Call_Date__c,
  Original_source,
  Channel_Grouping_Name,
  Lead_Score_Tier__c,
  Opportunity_AUM,
  aum_tier,
  TOF_Stage,
  Full_Opportunity_ID__c,
  opportunity_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = @sgaName
  AND Qualification_Call_Date__c IS NOT NULL
  AND Qualification_Call_Date__c >= TIMESTAMP(@weekStartDate)
  AND Qualification_Call_Date__c <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
ORDER BY Qualification_Call_Date__c DESC
```

**Fields Available for Display**:
- Same as Initial Calls, but:
- `Qualification_Call_Date__c` instead of `Initial_Call_Scheduled_Date__c`
- `Opportunity_AUM` instead of `AUM__c` (more likely to have value since qualification happens after conversion)
- `Full_Opportunity_ID__c` available (opportunity exists)

**How Data Differs from Initial Calls**:
- Qualification calls happen AFTER conversion (Lead → Opportunity)
- More likely to have financial data (AUM)
- Always has `Full_Opportunity_ID__c`

### 4.3 SQO Records

**Query Structure** (based on `quarterly-progress.ts` pattern):
```sql
SELECT 
  primary_key as id,
  advisor_name,
  SGA_Owner_Name__c,
  Date_Became_SQO__c,
  Original_source,
  COALESCE(nm.Channel_Grouping_Name, Channel_Grouping_Name, 'Other') as channel,
  Lead_Score_Tier__c,
  Opportunity_AUM,
  Underwritten_AUM__c,
  aum_tier,
  TOF_Stage,
  StageName,
  opportunity_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm 
  ON v.Original_source = nm.original_source
WHERE SGA_Owner_Name__c = @sgaName
  AND is_sqo_unique = 1
  AND Date_Became_SQO__c IS NOT NULL
  AND recordtypeid = '012Dn000000mrO3IAI'
  AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate)
  AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
ORDER BY Date_Became_SQO__c DESC
```

**Fields Available for SQO Drill-Down**:
- `primary_key` - **CRITICAL**: Use for RecordDetailModal
- `advisor_name`
- `Date_Became_SQO__c` - SQO date (TIMESTAMP)
- `Original_source` - Source
- `channel` - Channel (with mapping table join)
- `Opportunity_AUM` - AUM
- `Underwritten_AUM__c` - Underwritten AUM
- `aum_tier` - AUM tier
- `TOF_Stage` - Current stage
- `StageName` - Opportunity stage
- `opportunity_url` - Salesforce URL

**Financial Fields to Display**:
- `Opportunity_AUM` - Primary AUM value
- `Underwritten_AUM__c` - Underwritten AUM (may be null)
- `aum_tier` - Tier classification

**How SQO Record Structure Differs**:
- Always has `Full_Opportunity_ID__c` (must be converted)
- Always has financial data (AUM, Underwritten AUM)
- Includes `StageName` (opportunity stage)
- Requires `is_sqo_unique = 1` AND `recordtypeid = '012Dn000000mrO3IAI'` filters

---

## 5. Closed Lost Tab Analysis

### 5.1 ClosedLostTable Component

**File**: `src/components/sga-hub/ClosedLostTable.tsx`

**Columns Displayed**:
| Column | Header | Data Source |
|--------|--------|-------------|
| Opportunity Name | Opportunity Name | `record.oppName` |
| Last Contact Date | Last Contact Date | `formatDate(record.lastContactDate)` |
| Days Since Contact | Days Since Contact | `record.daysSinceContact` |
| Closed Lost Date | Closed Lost Date | `formatDate(record.closedLostDate)` |
| Closed Lost Reason | Closed Lost Reason | `record.closedLostReason` |
| Time Bucket | Time Bucket | `record.timeSinceContactBucket` (Badge) |
| Actions | Actions | Lead/Opportunity links |

**Row Click Functionality**:
- **Line 282**: `onClick={() => onRecordClick?.(record)}`
- **Line 280**: Conditional `cursor-pointer` class if `onRecordClick` prop provided
- **Currently**: `onRecordClick` prop exists but is optional - no handler passed from parent

**Data Type**:
- `records: ClosedLostRecord[]`
- `ClosedLostRecord` interface (see Section 5.2)

**Time Bucket Filter Implementation**:
- **Lines 115-126**: `availableBuckets` computed from records
- **Lines 129-136**: `filteredRecords` filters by `selectedBuckets` Set
- **Lines 162-172**: `toggleBucket()` adds/removes bucket from Set
- **Lines 222-250**: Filter buttons rendered above table

**Actions Available**:
- Lead link (if `record.leadUrl` exists) - Opens in new tab
- Opportunity link (if `record.opportunityUrl` exists) - Opens in new tab
- Both use `e.stopPropagation()` to prevent row click

### 5.2 Closed Lost Types

**File**: `src/types/sga-hub.ts`

**ClosedLostRecord Interface** (Lines 149-164):
```typescript
export interface ClosedLostRecord {
  id: string; // Full_Opportunity_ID__c
  oppName: string;
  leadId: string | null;
  opportunityId: string;
  leadUrl: string | null;
  opportunityUrl: string;
  salesforceUrl: string;
  lastContactDate: string;
  closedLostDate: string;
  sqlDate: string;
  closedLostReason: string;
  closedLostDetails: string | null;
  timeSinceContactBucket: string;
  daysSinceContact: number;
}
```

**Unique Identifier**:
- **`id`**: `Full_Opportunity_ID__c` - This is the opportunity ID, NOT the `primary_key`
- **For RecordDetailModal**: Need to use `primary_key` from `vw_funnel_master`
- **Issue**: `ClosedLostRecord` does NOT include `primary_key` field
- **Solution**: Need to add `primary_key` to `ClosedLostRecord` OR query it separately when opening detail modal

**Fields Available for Detail Display**:
- All fields from interface above
- Missing: `primary_key` (needed for RecordDetailModal)

### 5.3 Closed Lost API

**File**: `src/app/api/sga-hub/closed-lost/route.ts`

**How API Fetches Closed Lost Records**:
- GET handler
- Gets user name from Prisma
- Calls `getClosedLostRecords(sgaName, timeBuckets)` from `@/lib/queries/closed-lost`
- Returns `{ records: ClosedLostRecord[] }`

**BigQuery Query Used**:
- Queries `vw_sga_closed_lost_sql_followup` view
- Filters by `sga_name = @sgaName`
- Optionally filters by `time_since_last_contact_bucket IN UNNEST(@timeBuckets)`
- For 180+ days, queries base tables directly

**Fields Returned**:
- All fields from `ClosedLostRecord` interface
- **Missing**: `primary_key` - not included in view or query

### 5.4 Closed Lost Query

**File**: `src/lib/queries/closed-lost.ts`

**Full BigQuery Query Structure**:
- Queries `vw_sga_closed_lost_sql_followup` view (for 30-179 days)
- Queries base tables directly (for 180+ days)
- Combines results client-side

**Does it Include primary_key?**:
- **NO** - The view does not include `primary_key`
- Query selects: `Full_Opportunity_ID__c as id`, `opp_name`, `Full_prospect_id__c as lead_id`, etc.
- **Problem**: Cannot directly fetch record detail using `id` (which is `Full_Opportunity_ID__c`)
- **Current `id` field**: `Full_Opportunity_ID__c` (opportunity ID, not `primary_key`)

**Solution Options**:
1. **Modify query to join with `vw_funnel_master`** to get `primary_key`:
   ```sql
   SELECT 
     v.primary_key,
     cl.*
   FROM vw_sga_closed_lost_sql_followup cl
   JOIN vw_funnel_master v 
     ON cl.Full_Opportunity_ID__c = v.Full_Opportunity_ID__c
   WHERE cl.sga_name = @sgaName
   ```
   - **Pros**: Gets `primary_key` in one query
   - **Cons**: Requires join, may be slower

2. **Query `vw_funnel_master` separately** when opening record detail:
   - Use `Full_Opportunity_ID__c` to find matching record in `vw_funnel_master`
   - Query: `WHERE Full_Opportunity_ID__c = @opportunityId LIMIT 1`
   - **Pros**: Least invasive, reuses existing query pattern
   - **Cons**: Extra query when opening detail

3. **Add `primary_key` to closed lost view** (requires BigQuery view modification):
   - **Pros**: Cleanest solution long-term
   - **Cons**: Requires view modification, may affect other consumers

**Recommendation**: Option 2 (query separately) - least invasive, can be done in RecordDetailModal or API route

---

## 6. API Client Analysis

### 6.1 Dashboard API Client

**File**: `src/lib/api-client.ts`

**Structure of dashboardApi**:
```typescript
export const dashboardApi = {
  getFilterOptions: () => apiFetch<FilterOptions>('/api/dashboard/filters'),
  getFunnelMetrics: (filters, viewMode?) => apiFetch<FunnelMetricsWithGoals>(...),
  getConversionRates: (filters, options?) => apiFetch<{ rates, trends, mode }>(...),
  getChannelPerformance: (filters, viewMode?) => apiFetch<{ channels }>(...),
  getSourcePerformance: (filters, viewMode?) => apiFetch<{ sources }>(...),
  getDetailRecords: (filters, limit) => apiFetch<{ records }>(...),
  getRecordDetail: (id: string) => apiFetch<{ record: RecordDetailFull | null }>('/api/dashboard/record-detail/' + id),
  // SGA Hub functions...
};
```

**getRecordDetail Implementation**:
- **Line 152**: `getRecordDetail: (id: string) => apiFetch<{ record: RecordDetailFull | null }>('/api/dashboard/record-detail/' + id)`
- Uses `apiFetch` helper
- Returns `{ record: RecordDetailFull | null }`

**apiFetch Helper Pattern**:
- **Lines 72-97**: `async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T>`
- Handles URL construction (relative in browser, absolute on server)
- Sets `Content-Type: application/json` header
- Throws `ApiError` if response not ok
- Returns `response.json()`

### 6.2 SGA Hub API Functions

**Existing SGA Hub API Functions** (in `dashboardApi`):
```typescript
getWeeklyGoals: (startDate, endDate) => apiFetch<{ goals: WeeklyGoal[] }>(...),
getWeeklyActuals: (startDate, endDate) => apiFetch<{ actuals: WeeklyActual[] }>(...),
getQuarterlyProgress: (quarter) => apiFetch<QuarterlyProgress>(...),
getSQODetails: (quarter) => apiFetch<{ sqos: SQODetail[] }>(...),
getClosedLostRecords: (timeBuckets?) => apiFetch<{ records: ClosedLostRecord[] }>(...),
```

**Where New Drill-Down API Calls Would Be Added**:
- Add to `dashboardApi` object in `src/lib/api-client.ts`
- Functions needed:
  - `getInitialCallsDrillDown(sgaName, weekStartDate, weekEndDate)`
  - `getQualificationCallsDrillDown(sgaName, weekStartDate, weekEndDate)`
  - `getSQODrillDown(sgaName, weekStartDate?, weekEndDate?, quarter?)`

---

## 7. UI Components and Styling Analysis

### 7.1 Tremor Components Used

**SGA Tables**:
- `Table`, `TableHead`, `TableRow`, `TableHeaderCell`, `TableBody`, `TableCell` - All from `@tremor/react`
- `Badge` - For status indicators
- `Button` - For actions
- `Text` - For labels and values
- `Card` - Container component

**RecordDetailModal**:
- **NO Tremor components** - Uses native HTML and custom styling
- Uses Lucide React icons
- Custom badge styling (not Tremor Badge)

**Custom Styled Components**:
- `SectionHeader` - Custom helper in RecordDetailModal
- `DetailRow` - Custom helper in RecordDetailModal
- `DateRow` - Custom helper in RecordDetailModal

### 7.2 Modal Patterns

**Dialog Component**:
- **NOT using Tremor Dialog** - RecordDetailModal uses custom modal implementation
- Custom backdrop: `fixed inset-0 bg-black/50 backdrop-blur-sm`
- Custom modal container: `relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl`

**Standard Modal Width**:
- RecordDetailModal: `max-w-4xl` (896px)
- For drill-down modal: Should use `max-w-5xl` (1024px) or `max-w-6xl` (1152px) for table display

**Close Button Implementation**:
- X icon button in header (Line 229-235)
- ESC key handling via `useEffect` with `keydown` listener (Lines 120-136)
- Backdrop click also closes modal (Line 186)

**ESC Key Handling**:
- `useEffect` adds `keydown` event listener
- Checks for `e.key === 'Escape'`
- Calls `onClose()`
- Cleans up listener on unmount

### 7.3 Number Formatting

**Helper Functions**:
- `formatCurrency(n)` - Located in `src/lib/utils/date-helpers.ts`
- `formatDate(date)` - Located in `src/lib/utils/format-helpers.ts`
- `formatDateTime(date)` - Located in `src/lib/utils/format-helpers.ts`

**How Large Numbers Should Be Displayed**:
- Currently: No explicit formatting for numbers (just displayed as-is)
- Recommendation: Use `text-xl` or `text-2xl` for metric values
- For single digits: Display as "2" not "02" (no zero-padding)

### 7.4 Badge/Status Indicators

**Badge Styling in RecordDetailModal**:
- Custom badge classes (not Tremor Badge)
- Stage badges: `getStageBadgeClasses()` function (Lines 149-164)
- Record type badges: `getRecordTypeBadgeClasses()` function (Lines 167-179)
- Colors:
  - Joined: `bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200`
  - SQO: `bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200`
  - SQL: `bg-cyan-100 dark:bg-cyan-900/30 text-cyan-800 dark:text-cyan-200`
  - MQL: `bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-200`
  - Contacted: `bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200`

**Reusable Badge Components**:
- No shared badge component - each component defines its own badge styling
- Pattern: Custom `className` strings with Tailwind classes

---

## 8. New Components to Create

### 8.1 MetricDrillDownModal Component

**Purpose**: Display a table of records when clicking on IC/QC/SQO values

**Props Should Accept**:
```typescript
interface MetricDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  metricType: 'initial-calls' | 'qualification-calls' | 'sqos';
  records: DrillDownRecord[]; // See Section 10.1 for type definition
  title: string; // e.g., "Initial Calls - Week of Jan 13, 2026"
  sgaName: string;
  weekStartDate?: string;
  weekEndDate?: string;
  quarter?: string;
}
```

**Columns to Display** (by metric type):

**Initial Calls**:
- Advisor Name
- Initial Call Date
- Source
- Channel
- Lead Score Tier
- TOF Stage
- Actions (View Detail button)

**Qualification Calls**:
- Advisor Name
- Qualification Call Date
- Source
- Channel
- Lead Score Tier
- TOF Stage
- AUM (if available)
- Actions (View Detail button)

**SQOs**:
- Advisor Name
- SQO Date
- Source
- Channel
- AUM
- AUM Tier
- TOF Stage
- Actions (View Detail button)

**Row Click to Trigger RecordDetailModal**:
- Each row should be clickable
- On click: Open RecordDetailModal with `record.primaryKey` as `recordId`
- Use `cursor-pointer` and hover state

**Modal Width**:
- `max-w-5xl` (1024px) or `max-w-6xl` (1152px) to accommodate table

### 8.2 DrillDownTableRow Component

**Purpose**: Reusable table row that opens record detail on click

**Props Should Accept**:
```typescript
interface DrillDownTableRowProps {
  record: DrillDownRecord;
  columns: string[]; // Column keys to display
  onRowClick: (primaryKey: string) => void;
}
```

**Hover State Styling**:
- `hover:bg-blue-50 dark:hover:bg-blue-950/20`
- `cursor-pointer`
- Transition effect

**Click Handler Implementation**:
- `onClick={() => onRowClick(record.primaryKey)}`
- Prevent event bubbling if needed

### 8.3 Enhanced AdminSGATable Columns

**Purpose**: Replace "IC:", "QC:", "SQO:" with full names and clickable values

**Best Way to Make Numbers Clickable**:
- Wrap numbers in `<button>` or `<span>` with `onClick` handler
- Use `cursor-pointer` class
- Add hover effect: `hover:text-blue-600 dark:hover:text-blue-400 hover:underline`

**Hover States to Indicate Clickability**:
- `hover:text-blue-600 dark:hover:text-blue-400`
- `hover:underline`
- Optional: `hover:bg-blue-50 dark:hover:bg-blue-950/20` for background highlight

**Styling Changes for Larger, More Readable Numbers**:
- Change from default size to `text-lg` or `text-xl`
- Use `font-semibold` or `font-bold` for emphasis
- Increase padding if needed

---

## 9. API Routes to Create

### 9.1 Initial Calls Drill-Down API

**Route**: `GET /api/sga-hub/drill-down/initial-calls`

**Parameters**:
- `sgaName` (required) - SGA name for filtering
- `weekStartDate` (required) - Monday of week (ISO date string)
- `weekEndDate` (required) - Sunday of week (ISO date string)

**Fields to Return**:
- `primary_key` (for RecordDetailModal)
- `advisor_name`
- `Initial_Call_Scheduled_Date__c`
- `Original_source`
- `Channel_Grouping_Name`
- `Lead_Score_Tier__c`
- `TOF_Stage`
- `lead_url`
- `opportunity_url`

**Date Filtering**:
- Filter by `Initial_Call_Scheduled_Date__c >= @weekStartDate AND Initial_Call_Scheduled_Date__c <= @weekEndDate`
- Use `TIMESTAMP()` wrapper for BigQuery compatibility

**BigQuery Query Structure**:
```sql
SELECT 
  primary_key,
  advisor_name,
  Initial_Call_Scheduled_Date__c,
  Original_source,
  Channel_Grouping_Name,
  Lead_Score_Tier__c,
  TOF_Stage,
  lead_url,
  opportunity_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = @sgaName
  AND Initial_Call_Scheduled_Date__c IS NOT NULL
  AND Initial_Call_Scheduled_Date__c >= TIMESTAMP(@weekStartDate)
  AND Initial_Call_Scheduled_Date__c <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
ORDER BY Initial_Call_Scheduled_Date__c DESC
```

### 9.2 Qualification Calls Drill-Down API

**Route**: `GET /api/sga-hub/drill-down/qualification-calls`

**Parameters**: Same as Initial Calls

**Fields to Return**:
- Same as Initial Calls, plus:
- `Qualification_Call_Date__c` (instead of Initial_Call_Scheduled_Date__c)
- `Opportunity_AUM` (if available)
- `aum_tier` (if available)

**How It Differs from Initial Calls**:
- Filters by `Qualification_Call_Date__c` instead of `Initial_Call_Scheduled_Date__c`
- May include financial fields (AUM) since qualification calls happen after conversion

### 9.3 SQO Drill-Down API

**Route**: `GET /api/sga-hub/drill-down/sqos`

**Parameters**:
- `sgaName` (required)
- `weekStartDate` (optional) - For weekly filtering
- `weekEndDate` (optional) - For weekly filtering
- `quarter` (optional) - For quarterly filtering (format: "2026-Q1")

**Fields to Return**:
- `primary_key`
- `advisor_name`
- `Date_Became_SQO__c`
- `Original_source`
- `Channel_Grouping_Name`
- `Opportunity_AUM`
- `Underwritten_AUM__c`
- `aum_tier`
- `TOF_Stage`
- `StageName`
- `opportunity_url`

**Weekly vs Quarterly Filtering**:
- If `weekStartDate` and `weekEndDate` provided: Filter by `Date_Became_SQO__c` in week range
- If `quarter` provided: Filter by quarter (parse quarter to start/end dates)
- Must include: `is_sqo_unique = 1` AND `recordtypeid = '012Dn000000mrO3IAI'`

**Should This Reuse Existing sqo-details API?**:
- **Existing API**: `/api/sga-hub/sqo-details` returns `SQODetail[]` for a quarter
- **Difference**: Drill-down needs `primary_key` for RecordDetailModal
- **Decision**: Create new endpoint OR modify existing to include `primary_key`
- **Recommendation**: Create new endpoint to avoid breaking existing functionality

---

## 10. Type Definitions Needed

### 10.1 DrillDown Record Types

**InitialCallRecord Type**:
```typescript
export interface InitialCallRecord {
  primaryKey: string; // primary_key from vw_funnel_master
  advisorName: string;
  initialCallDate: string; // Initial_Call_Scheduled_Date__c
  source: string;
  channel: string;
  leadScoreTier: string | null;
  tofStage: string;
  leadUrl: string | null;
  opportunityUrl: string | null;
}
```

**QualificationCallRecord Type**:
```typescript
export interface QualificationCallRecord {
  primaryKey: string;
  advisorName: string;
  qualificationCallDate: string; // Qualification_Call_Date__c
  source: string;
  channel: string;
  leadScoreTier: string | null;
  tofStage: string;
  aum: number | null;
  aumTier: string | null;
  opportunityUrl: string | null;
}
```

**SQODrillDownRecord Type**:
```typescript
export interface SQODrillDownRecord {
  primaryKey: string;
  advisorName: string;
  sqoDate: string; // Date_Became_SQO__c
  source: string;
  channel: string;
  aum: number | null;
  underwrittenAum: number | null;
  aumTier: string | null;
  tofStage: string;
  stageName: string | null;
  opportunityUrl: string | null;
}
```

**Should These Extend a Base Type?**:
- **Recommendation**: Create a union type for the modal
- `type DrillDownRecord = InitialCallRecord | QualificationCallRecord | SQODrillDownRecord`
- OR create a base interface with common fields and extend it

### 10.2 MetricDrillDownModal Props Type

**Full Type Definition**:
```typescript
export type MetricType = 'initial-calls' | 'qualification-calls' | 'sqos';

export interface MetricDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  metricType: MetricType;
  records: DrillDownRecord[];
  title: string;
  sgaName: string;
  weekStartDate?: string;
  weekEndDate?: string;
  quarter?: string;
  onRecordClick: (primaryKey: string) => void;
}
```

**How metricType Should Be Typed**:
- Use `type MetricType = 'initial-calls' | 'qualification-calls' | 'sqos'`
- This ensures type safety and autocomplete

---

## 11. Implementation Cross-Cutting Concerns

### 11.1 Shared Modal Pattern

**How RecordDetailModal Can Be Reused**:
- **Current**: Used in Funnel Performance page via `DetailRecordsTable`
- **Reuse**: Import `RecordDetailModal` in SGA Hub and SGA Management components
- **Pattern**: Same component, different trigger points

**Should There Be a Shared Hook?**:
- **Recommendation**: Create `useRecordDetail()` hook
- Hook manages: `isOpen`, `recordId`, `loading`, `error`, `record`
- Hook provides: `openRecordDetail(id)`, `closeRecordDetail()`
- Components use hook instead of managing state directly

**Nested Modals (DrillDown → Record Detail)**:
- **Pattern**: Close drill-down modal when opening record detail
- **Flow**: Click metric value → Open drill-down modal → Click row → Close drill-down, open record detail
- **State Management**: Lift modal state to page level or use context

### 11.2 State Management

**State to Track for Drill-Down Flow**:
- `drillDownModalOpen: boolean`
- `drillDownMetricType: MetricType | null`
- `drillDownRecords: DrillDownRecord[]`
- `drillDownLoading: boolean`
- `recordDetailModalOpen: boolean`
- `recordDetailId: string | null`

**Should State Be Lifted to Page Level?**:
- **Yes** - For SGA Management: Lift to `SGAManagementContent`
- **Yes** - For SGA Hub: Lift to `SGAHubContent`
- **Reason**: Both modals need to be managed at the same level

**How Modal Stacking Should Be Handled**:
- **Option 1**: Close drill-down when opening record detail (recommended)
- **Option 2**: Keep both open (not recommended - confusing UX)
- **Implementation**: Set `drillDownModalOpen = false` when `recordDetailModalOpen = true`

### 11.3 Loading and Error States

**Loading Skeleton for Drill-Down Tables**:
- Reuse Tremor Table structure with skeleton rows
- Show 5-10 skeleton rows
- Use `animate-pulse` with gray backgrounds

**How Errors Should Be Displayed**:
- Card with red background (matching existing error pattern)
- Message: "Failed to load [metric type] records"
- Retry button optional

**What Happens if Record Detail Fetch Fails**:
- RecordDetailModal already handles this (shows error message)
- No additional handling needed in drill-down modal

---

## 12. CSS/Styling Changes

### 12.1 Number Size Increases

**Current Font Size for Numbers**:
- **Expanded rows**: No explicit size (inherits `text-sm` from parent)
- **Weekly Goals Table**: `font-medium` (no explicit size)
- **Default**: Tremor Table uses `text-sm` (14px)

**Recommended New Font Size**:
- **Metric values**: `text-xl` (20px) or `text-2xl` (24px)
- **Labels**: Keep `text-sm` or `text-base`
- **Example**: `className="text-xl font-bold text-gray-900 dark:text-white"`

**Padding/Spacing Adjustments**:
- May need to increase cell padding: `px-4 py-3` instead of default
- Ensure grid layout accommodates larger text

### 12.2 Full Label Names

**Current**: "IC:", "QC:", "SQO:"
**Desired**: "Initial Calls:", "Qualification Calls:", "SQO:"

**Where Abbreviated Labels Are Defined**:
- **AdminSGATable.tsx Line 214**: `IC: ${...}, QC: ${...}, SQO: ${...}`
- **AdminSGATable.tsx Line 222**: `IC: ${...}, QC: ${...}, SQO: ${...}`
- **SGAManagementContent.tsx Line 232**: `IC: ${...}, QC: ${...}, SQO: ${...}`
- **SGAManagementContent.tsx Line 240**: `IC: ${...}, QC: ${...}, SQO: ${...}`

**Width Changes Needed**:
- Current label column: `grid-cols-[80px_1fr]` (80px for labels)
- New width needed: `grid-cols-[140px_1fr]` or `grid-cols-[160px_1fr]` for "Initial Calls:" and "Qualification Calls:"

**Should "SQO" Be Expanded?**:
- **Recommendation**: Keep "SQO" as-is (commonly understood abbreviation)
- **Alternative**: "Sales Qualified Opportunity" (too long)
- **Decision**: Use "SQO:" in labels

### 12.3 Clickable Styling

**Cursor Style**:
- `cursor-pointer` class

**Hover Effect**:
- `hover:text-blue-600 dark:hover:text-blue-400`
- `hover:underline`
- Optional: `hover:bg-blue-50 dark:hover:bg-blue-950/20`

**Icon Indicating "Click to Expand"?**:
- **Optional**: Add `ExternalLink` or `ChevronRight` icon next to numbers
- **Recommendation**: Start without icon, add if users don't understand it's clickable
- **Alternative**: Tooltip on hover: "Click to view records"

---

## 13. Implementation Plan Summary

### Phase 1: Foundation (Types & Shared Components)

1. **Create Type Definitions** (`src/types/sga-hub.ts`):
   - Add `InitialCallRecord`, `QualificationCallRecord`, `SQODrillDownRecord` interfaces
   - Add `MetricType` type
   - Add `DrillDownRecord` union type

2. **Create MetricDrillDownModal Component** (`src/components/sga-hub/MetricDrillDownModal.tsx`):
   - Modal structure matching RecordDetailModal pattern
   - Table with columns based on `metricType`
   - Row click handler
   - Loading and error states

3. **Create useRecordDetail Hook** (`src/hooks/useRecordDetail.ts`):
   - Manages RecordDetailModal state
   - Provides `openRecordDetail(id)` and `closeRecordDetail()` functions
   - Handles fetching and error states

### Phase 2: SGA Management Upgrades

1. **Update AdminSGATable Expanded Rows**:
   - Replace "IC:", "QC:", "SQO:" with full labels
   - Increase label column width to `grid-cols-[160px_1fr]`
   - Make numbers larger (`text-xl font-bold`)
   - Make numbers clickable with hover effects
   - Add click handlers to open MetricDrillDownModal

2. **Add State Management to SGAManagementContent**:
   - Add drill-down modal state
   - Add record detail modal state
   - Integrate `useRecordDetail` hook

3. **Create Drill-Down API Routes**:
   - `/api/sga-hub/drill-down/initial-calls`
   - `/api/sga-hub/drill-down/qualification-calls`
   - `/api/sga-hub/drill-down/sqos`

4. **Add API Client Functions**:
   - Add drill-down functions to `dashboardApi` in `src/lib/api-client.ts`

### Phase 3: SGA Hub Upgrades

1. **Update Weekly Goals Table**:
   - Make Initial Calls, Qualification Calls, SQO numbers clickable
   - Increase font size to `text-xl`
   - Add click handlers

2. **Update Quarterly Progress Card**:
   - Make SQO count clickable
   - Add click handler for SQO drill-down

3. **Add Closed Lost Drill-Down**:
   - Update `ClosedLostTable` to accept `onRecordClick` handler
   - Pass handler from `SGAHubContent` that opens RecordDetailModal
   - **Issue**: Need `primary_key` in `ClosedLostRecord` - see Section 5.4

### Phase 4: Testing & Polish

1. **Test All Drill-Down Flows**:
   - Initial Calls → Record Detail
   - Qualification Calls → Record Detail
   - SQOs → Record Detail
   - Closed Lost → Record Detail

2. **Dark Mode Verification**:
   - Ensure all new components support dark mode
   - Test hover states in dark mode

3. **Responsive Design**:
   - Test modals on mobile/tablet
   - Ensure tables are scrollable on small screens

---

## 14. Open Questions / Blockers

- [x] **Question 1**: How to get `primary_key` for Closed Lost records?
  - **Answer**: Query `vw_funnel_master` separately using `Full_Opportunity_ID__c`
  - **Implementation**: Add helper function in `record-detail.ts` or modify API route to handle opportunity ID lookup
  - **Note**: `SQODetail.id` already contains `primary_key` (from `quarterly-progress.ts` Line 109), so SQO drill-down is straightforward

- [ ] **Question 2**: Should drill-down modals support filtering/sorting?
  - **Current**: No filtering in drill-down modals
  - **Recommendation**: Start without, add if needed

- [ ] **Question 3**: Should we show loading state in the main table while drill-down data loads?
  - **Recommendation**: Yes - disable click or show spinner on clicked value

- [ ] **Question 4**: What happens if drill-down returns 0 records?
  - **Recommendation**: Show empty state message in modal

- [ ] **Question 5**: Should drill-down modals be paginated?
  - **Current**: No pagination
  - **Recommendation**: Start without, add if records exceed 100

- [ ] **Question 6**: How to handle weekly vs quarterly SQO drill-down?
  - **Decision**: Support both via query parameters
  - **Implementation**: API route checks for `weekStartDate` OR `quarter` parameter

---

## Additional Findings

### SQODetail Already Has primary_key

**Important Discovery**: `SQODetail.id` already contains `primary_key` from `vw_funnel_master`:
- **File**: `src/lib/queries/quarterly-progress.ts` Line 109: `v.primary_key as id`
- **Implication**: SQO drill-down can directly use `sqo.id` for RecordDetailModal
- **No additional query needed** for SQO records

### Closed Lost primary_key Solution

**Recommended Approach**: Create a helper function to lookup `primary_key` from `Full_Opportunity_ID__c`:
```typescript
// In src/lib/queries/record-detail.ts
export async function getPrimaryKeyFromOpportunityId(opportunityId: string): Promise<string | null> {
  const query = `
    SELECT primary_key
    FROM \`${FULL_TABLE}\`
    WHERE Full_Opportunity_ID__c = @opportunityId
    LIMIT 1
  `;
  const results = await runQuery<{ primary_key: string }>(query, { opportunityId });
  return results.length > 0 ? results[0].primary_key : null;
}
```

Then in Closed Lost row click handler:
```typescript
const handleClosedLostRowClick = async (record: ClosedLostRecord) => {
  const primaryKey = await getPrimaryKeyFromOpportunityId(record.opportunityId);
  if (primaryKey) {
    openRecordDetail(primaryKey);
  }
};
```

---

**Document Status**: Sections 1-12 complete. Ready for implementation planning.
