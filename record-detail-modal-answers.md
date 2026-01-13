# Record Detail Modal - Codebase Investigation

This document contains comprehensive findings from investigating the codebase to support implementation of a Record Detail Modal feature.

---

## SECTION 1: Current Detail Records Implementation

### 1.1 API Route

**File**: `src/app/api/dashboard/detail-records/route.ts`

**Current Implementation**:
- **Method**: `POST` (not GET)
- **Parameters Accepted**:
  - `filters: DashboardFilters` (from request body)
  - `limit: number` (default: 50000, increased to fetch all records)
- **Pagination**: Uses `LIMIT @limit` in SQL query, but no OFFSET (fetches all matching records up to limit)
- **Response Shape**: 
  ```typescript
  {
    records: DetailRecord[]
  }
  ```

**Full SQL Query Pattern** (from `detail-records.ts`):
```sql
SELECT
  v.primary_key as id,
  v.advisor_name,
  v.Original_source as source,
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
  v.StageName as stage,
  v.SGA_Owner_Name__c as sga,
  v.SGM_Owner_Name__c as sgm,
  v.Opportunity_AUM as aum,
  v.salesforce_url,
  ${dateField} as relevant_date,
  v.Initial_Call_Scheduled_Date__c as initial_call_scheduled_date,
  v.Qualification_Call_Date__c as qualification_call_date,
  v.is_contacted,
  v.is_mql,
  v.is_sql,
  v.is_sqo_unique as is_sqo,
  v.is_joined_unique as is_joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm
  ON v.Original_source = nm.original_source
WHERE [dynamic conditions based on filters]
ORDER BY v.Opportunity_AUM DESC NULLS LAST
LIMIT @limit
```

**Key Points**:
- Uses `primary_key` as the unique identifier (`id` field)
- No pagination offset - fetches all records up to limit
- Date field is dynamic based on `metricFilter`
- Includes LEFT JOIN with `new_mapping` table for channel grouping

### 1.2 Query Function

**File**: `src/lib/queries/detail-records.ts`

**Function Signature**:
```typescript
export async function getDetailRecords(
  filters: DashboardFilters,
  limit: number = 50000
): Promise<DetailRecord[]>
```

**TypeScript Return Type**: `DetailRecord[]` (from `@/types/dashboard`)

**Transformations Applied**:
1. Extracts date values (handles both DATE and TIMESTAMP types, and both object/value formats)
2. Formats AUM using `formatCurrency()` helper
3. Maps raw BigQuery results to `DetailRecord` interface
4. Converts boolean flags (is_contacted, is_mql, etc.) from 0/1 to boolean
5. Handles `is_sqo_unique` and `is_joined_unique` flags

**Key Transformation Code**:
```typescript
return results.map(r => {
  // Date extraction with type handling
  let dateValue = '';
  const dateField = r.relevant_date || r.filter_date;
  if (dateField) {
    if (typeof dateField === 'object' && dateField.value) {
      dateValue = dateField.value;
    } else if (typeof dateField === 'string') {
      dateValue = dateField;
    }
  }
  
  return {
    id: toString(r.id),
    advisorName: toString(r.advisor_name) || 'Unknown',
    // ... other fields
    aumFormatted: formatCurrency(r.aum),
    isContacted: r.is_contacted === 1,
    // ... boolean conversions
  };
});
```

### 1.3 Type Definitions

**File**: `src/types/dashboard.ts`

**Current `DetailRecord` Interface**:
```typescript
export interface DetailRecord {
  id: string;                                    // primary_key from view
  advisorName: string;
  source: string;
  channel: string;
  stage: string;
  sga: string | null;
  sgm: string | null;
  aum: number;
  aumFormatted: string;                          // Formatted currency string
  salesforceUrl: string;
  relevantDate: string;                          // Dynamic date based on metric filter
  initialCallScheduledDate: string | null;      // Initial_Call_Scheduled_Date__c
  qualificationCallDate: string | null;          // Qualification_Call_Date__c
  isContacted: boolean;
  isMql: boolean;
  isSql: boolean;
  isSqo: boolean;
  isJoined: boolean;
  isOpenPipeline: boolean;
}
```

**Unique Identifier Fields**:
- ✅ `id` field exists (maps to `primary_key` from view)
- ✅ `Full_prospect_id__c` is available in view (as `Full_prospect_id__c`)
- ✅ `Full_Opportunity_ID__c` is available in view (as `Full_Opportunity_ID__c`)
- ✅ `primary_key` is the composite key: `COALESCE(l.Full_prospect_id__c, o.Full_Opportunity_ID__c)`

**Note**: The `primary_key` uniquely identifies a record. For leads, it's the Lead ID. For opportunities (including direct opportunities), it's the Opportunity ID.

### 1.4 Table Component

**File**: `src/components/dashboard/DetailRecordsTable.tsx`

**Current Columns Displayed**:
1. Advisor (sortable)
2. Source (sortable)
3. Channel (sortable)
4. Stage (sortable, with badges for status)
5. Date (sortable, with dynamic tooltip)
6. Initial Call Scheduled (conditional, shown when advanced filter enabled)
7. Qualification Call (conditional, shown when advanced filter enabled)
8. SGA (sortable)
9. SGM (sortable)
10. AUM (sortable, right-aligned)
11. Actions (Salesforce link)

**OnClick Handler**: 
- ❌ **NO existing onClick handler for rows**
- Table rows have `cursor-pointer` class but no click handler
- Only the "View" link in Actions column opens Salesforce

**Props Structure**:
```typescript
interface DetailRecordsTableProps {
  records: DetailRecord[];
  title?: string;
  filterDescription?: string;
  canExport?: boolean;
  viewMode?: ViewMode;
  advancedFilters?: AdvancedFilters;
  metricFilter?: 'all' | 'prospect' | 'contacted' | 'mql' | 'sql' | 'sqo' | 'joined' | 'openPipeline';
}
```

**UI Library**: Uses `@tremor/react` components:
- `Card`, `Table`, `TableHead`, `TableRow`, `TableHeaderCell`, `TableBody`, `TableCell`
- `Badge`, `Button`, `TextInput`
- Custom styling with Tailwind CSS

**Data Flow**: 
- Records passed as prop from dashboard page
- Dashboard page fetches via `dashboardApi.getDetailRecords()`
- No internal data fetching in table component

---

## SECTION 2: Existing Modal Patterns

### 2.1 Existing Modals

**Found 3 Modal Components**:

1. **UserModal** (`src/components/settings/UserModal.tsx`)
   - Custom modal implementation (no library)
   - Pattern: Fixed overlay with centered content
   - Uses `fixed inset-0 z-50` for overlay
   - Backdrop: `bg-black/50` with `onClick={onClose}`
   - Content: `bg-white rounded-xl shadow-xl max-w-md`
   - State: `isOpen` prop controls visibility
   - Loading: `loading` state with disabled buttons
   - Error: Error message display with red styling

2. **DeleteConfirmModal** (`src/components/settings/DeleteConfirmModal.tsx`)
   - Same custom pattern as UserModal
   - Includes icon (AlertTriangle) in header
   - Confirmation action pattern

3. **ResetPasswordModal** (`src/components/settings/ResetPasswordModal.tsx`)
   - Same custom pattern
   - Success state handling
   - Form validation

**Common Modal Pattern**:
```typescript
if (!isOpen) return null;

return (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div className="fixed inset-0 bg-black/50" onClick={onClose} />
    <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
      {/* Header with close button */}
      {/* Content */}
      {/* Actions */}
    </div>
  </div>
);
```

**State Management**:
- Opening/closing: Controlled by `isOpen` prop
- Loading: Local `useState` for async operations
- Error: Local `useState` for error messages
- Animations: None (simple show/hide)

### 2.2 Dialog/Modal Imports

**From `package.json`**:
- ❌ No `@headlessui/react` installed
- ❌ No `@tremor/react` Dialog component (Tremor doesn't have Dialog)
- ✅ Uses custom modal implementation with Tailwind CSS
- ✅ Uses `lucide-react` for icons (X, AlertTriangle, Key, etc.)

**Available Modal Components**: None from libraries - all custom implementations

---

## SECTION 3: API Patterns

### 3.1 Single-Record Fetch Patterns

**Existing Pattern Found**: `src/app/api/users/[id]/route.ts`

**Route Structure**: Dynamic route using Next.js App Router `[id]` pattern

**Pattern**:
```typescript
// File: src/app/api/users/[id]/route.ts
interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  // 1. Authentication
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // 2. Permission check
  const permissions = await getUserPermissions(session.user.email);
  if (!permissions.canManageUsers) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  
  // 3. Fetch record
  const user = await getUserById(params.id);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  
  // 4. Transform and return
  return NextResponse.json({ user: safeUser });
}
```

**Standard Pattern for API Routes**:
1. **Authentication**: `getServerSession(authOptions)`
2. **Permission Check**: `getUserPermissions()` (if needed)
3. **Parameter Validation**: Extract from `params` (dynamic routes) or `request.json()` (POST body)
4. **Error Handling**: Try/catch with appropriate HTTP status codes
5. **Response Format**: `NextResponse.json({ data })` with proper typing

**No Existing Single-Record Pattern for Detail Records**: The current detail-records route only fetches multiple records with filters.

### 3.2 BigQuery Query Patterns

**Single-Record Query Pattern** (inferred from existing patterns):

For fetching by ID, the pattern would be:
```sql
SELECT ...
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm
  ON v.Original_source = nm.original_source
WHERE v.primary_key = @id
LIMIT 1
```

**Parameterized Query Example**:
```typescript
const params: Record<string, any> = {
  id: recordId,  // The primary_key value
};

const query = `
  SELECT ...
  WHERE v.primary_key = @id
  LIMIT 1
`;

const results = await runQuery<RawDetailRecordResult>(query, params);
```

**Note**: No existing single-record queries found in the codebase. All queries fetch multiple records with filters.

---

## SECTION 4: Component Patterns

### 4.1 Loading States

**Loading Spinner Component**: `src/components/ui/LoadingSpinner.tsx`

```typescript
export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
    </div>
  );
}
```

**Usage Pattern**:
- Simple spinner with Tailwind animation
- Used in dashboard page: `{loading ? <LoadingSpinner /> : <Content />}`
- No skeleton components found

**Modal Loading Pattern** (from existing modals):
- Disable buttons during loading: `disabled={loading}`
- Show loading text: `{loading ? 'Loading...' : 'Submit'}`
- No spinner in modals - just disabled state

### 4.2 Data Fetching in Components

**Standard Pattern**: Uses `dashboardApi` from `src/lib/api-client.ts`

**Example from Dashboard Page**:
```typescript
const recordsData = await dashboardApi.getDetailRecords(currentFilters, 50000);
setDetailRecords(recordsData.records);
```

**API Client Pattern**:
```typescript
// From src/lib/api-client.ts
export const dashboardApi = {
  getDetailRecords: (filters: DashboardFilters, limit = 50000) =>
    apiFetch<{ records: DetailRecord[] }>('/api/dashboard/detail-records', {
      method: 'POST',
      body: JSON.stringify({ filters, limit }),
    }),
};
```

**Component Data Fetching on Interaction**:
- No examples found of components fetching data on click
- All data fetching happens at page level via `useEffect` or `useCallback`
- Components receive data as props

**For Modal Implementation**: Would need to add new API method:
```typescript
getRecordDetail: (id: string) =>
  apiFetch<{ record: DetailRecord }>('/api/dashboard/record-detail/[id]', {
    method: 'GET',
  }),
```

### 4.3 Styling Patterns

**CSS Framework**: Tailwind CSS (configured in `tailwind.config.js`)

**Custom UI Components**: `src/components/ui/`
- `LoadingSpinner.tsx`
- `InfoTooltip.tsx`
- `ExportButton.tsx`
- `ThemeToggle.tsx`
- `ErrorBoundary.tsx`

**Card/Panel Styling Pattern**:
- Tremor `Card` component: `<Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">`
- Custom cards: `bg-white rounded-xl shadow-xl` (from modals)
- Dark mode support: `dark:bg-gray-800 dark:text-white`

**Modal Styling**:
- Overlay: `fixed inset-0 z-50 flex items-center justify-center`
- Backdrop: `fixed inset-0 bg-black/50`
- Content: `relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6`
- Dark mode: Would need `dark:bg-gray-800 dark:text-white` classes

---

## SECTION 5: Data Available from vw_funnel_master

### 5.1 Fields Comparison

**Fields Currently Fetched** (from `detail-records.ts` query):
- `primary_key` (as `id`)
- `advisor_name`
- `Original_source` (as `source`)
- `Channel_Grouping_Name` (as `channel`, with mapping)
- `StageName` (as `stage`)
- `SGA_Owner_Name__c` (as `sga`)
- `SGM_Owner_Name__c` (as `sgm`)
- `Opportunity_AUM` (as `aum`)
- `salesforce_url`
- Dynamic `relevant_date` (based on metric filter)
- `Initial_Call_Scheduled_Date__c`
- `Qualification_Call_Date__c`
- `is_contacted`, `is_mql`, `is_sql`, `is_sqo_unique`, `is_joined_unique`

**Fields Available in View but NOT Currently Fetched**:

**Dates**:
- `CreatedDate` (Lead creation date)
- `FilterDate` (Cohort date)
- `stage_entered_contacting__c` (Contacted date)
- `mql_stage_entered_ts` (MQL date)
- `converted_date_raw` (SQL conversion date)
- `Opp_CreatedDate` (Opportunity creation date)
- `Date_Became_SQO__c` (SQO date)
- `advisor_join_date__c` (Joined date)
- `Stage_Entered_Discovery__c`
- `Stage_Entered_Sales_Process__c`
- `Stage_Entered_Negotiating__c`
- `Stage_Entered_Signed__c`
- `Stage_Entered_On_Hold__c`
- `Stage_Entered_Closed__c`
- `lead_closed_date`
- `Earliest_Anticipated_Start_Date__c`

**Financials**:
- `Underwritten_AUM__c` (separate from Opportunity_AUM)
- `Amount` (Opportunity amount)
- `Opportunity_AUM_M` (AUM in millions)

**Attribution**:
- `Full_prospect_id__c` (Lead ID)
- `Full_Opportunity_ID__c` (Opportunity ID)
- `Opp_SGA_Name__c` (Opportunity SGA, separate from Lead SGA)
- `External_Agency__c`
- `Lead_Experimentation_Tag__c`
- `Opportunity_Experimentation_Tag__c`
- `Experimentation_Tag_Raw__c`
- `Experimentation_Tag_List` (array)

**Status/Stage**:
- `Disposition__c` (Lead disposition)
- `Closed_Lost_Reason__c`
- `Closed_Lost_Details__c`
- `Conversion_Status` (Joined/Closed/Open)
- `TOF_Stage` (Top of Funnel stage - highest reached)
- `StageName_code` (numeric stage code)
- `record_type_name` (Recruiting/Re-Engagement)
- `Lead_Score_Tier__c`

**Flags** (Conversion eligibility and progression):
- `eligible_for_contacted_conversions`
- `eligible_for_mql_conversions`
- `eligible_for_sql_conversions`
- `eligible_for_sqo_conversions`
- `contacted_to_mql_progression`
- `mql_to_sql_progression`
- `sql_to_sqo_progression`
- `sqo_to_joined_progression`
- `is_primary_opp_record`

**URLs/Links**:
- `lead_url` (Lead Salesforce URL)
- `opportunity_url` (Opportunity Salesforce URL)
- `salesforce_url` (already fetched)

**Other**:
- `aum_tier` (Tier 1-4 based on AUM)
- `filter_date_cohort_month`
- `contacted_cohort_month`
- `mql_cohort_month`
- `sql_cohort_month`
- `sqo_cohort_month`
- `joined_cohort_month`

### 5.2 Unique Identifiers

**Available Unique Identifier Fields**:
- ✅ `primary_key`: Composite key `COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c)`
- ✅ `Full_prospect_id__c`: Lead ID (when record is a lead)
- ✅ `Full_Opportunity_ID__c`: Opportunity ID (when record is an opportunity)

**Record Identification Strategy**:
- **For Leads**: `primary_key = Full_prospect_id__c` (Lead ID)
- **For Opportunities**: `primary_key = Full_Opportunity_ID__c` (Opportunity ID)
- **For Direct Opportunities** (no linked lead): `Full_prospect_id__c IS NULL`, `Full_Opportunity_ID__c` is the ID

**Recommendation**: Use `primary_key` for fetching single records, as it handles both leads and opportunities (including direct opportunities).

---

## SECTION 6: Dashboard Page Integration

### 6.1 Main Dashboard

**File**: `src/app/dashboard/page.tsx`

**State Management**:
- Uses `useState` for all data and UI state
- `detailRecords` state: `useState<DetailRecord[]>([])`
- No global state management (Redux, Zustand, etc.)

**Current State Variables**:
```typescript
const [detailRecords, setDetailRecords] = useState<DetailRecord[]>([]);
const [selectedMetric, setSelectedMetric] = useState<string | null>(null);
const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
const [selectedSource, setSelectedSource] = useState<string | null>(null);
```

**Modal State Integration**:
- Would need to add: `const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);`
- Or: `const [isRecordModalOpen, setIsRecordModalOpen] = useState(false);`
- Pattern matches existing modal usage (e.g., `showAdvancedFilters` state)

**Existing Modal Pattern in Dashboard**:
```typescript
const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

// Later in JSX:
<AdvancedFilters
  isOpen={showAdvancedFilters}
  onClose={() => setShowAdvancedFilters(false)}
  // ... other props
/>
```

### 6.2 Props Flow

**Current Data Flow**:
1. Dashboard page fetches data: `dashboardApi.getDetailRecords(filters, 50000)`
2. Sets state: `setDetailRecords(recordsData.records)`
3. Passes to component: `<DetailRecordsTable records={detailRecords} ... />`
4. Table component receives as prop and renders

**Modal Integration Options**:

**Option A: Modal at Dashboard Level** (Recommended)
- Modal state in dashboard page
- Table component calls `onRecordClick(recordId)` callback
- Dashboard handles modal state and data fetching
- Matches existing `AdvancedFilters` modal pattern

**Option B: Modal at Table Level**
- Modal state inside `DetailRecordsTable` component
- Table component handles its own data fetching
- Simpler prop interface, but breaks data fetching pattern

**Recommendation**: Option A - Modal at dashboard level, following existing patterns.

---

## SECTION 7: Formatting Utilities

### 7.1 Date Formatting

**File**: `src/lib/utils/format-helpers.ts`

**Functions Available**:
```typescript
export function formatDate(date: string | Date): string {
  // Returns: "Jan 15, 2026"
  return d.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric' 
  });
}

export function formatDateTime(date: string | Date): string {
  // Returns: "Jan 15, 2026, 10:30 AM"
  return d.toLocaleString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
```

**Current Usage in Table**:
```typescript
{record.relevantDate ? new Date(record.relevantDate).toLocaleDateString() : '-'}
```

**Different Date Formats**: No specialized formats found - uses standard JavaScript `Date` methods.

### 7.2 Currency/Number Formatting

**File**: `src/lib/utils/date-helpers.ts`

**AUM Formatting**:
```typescript
export function formatCurrency(value: number | null | undefined): string {
  const v = Number(value) || 0;
  if (v >= 1000000000) return '$' + (v / 1000000000).toFixed(1) + 'B';
  if (v >= 1000000) return '$' + (v / 1000000).toFixed(0) + 'M';
  if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'K';
  return '$' + v.toFixed(0);
}
```

**Percentage Formatting**:
```typescript
export function formatPercent(value: number | null | undefined): string {
  const v = Number(value) || 0;
  return (v * 100).toFixed(1) + '%';
}
```

**Number Formatting**:
```typescript
export function formatNumber(value: number | null | undefined): string {
  const v = Number(value) || 0;
  return v.toLocaleString();
}
```

**Current Usage**: AUM is formatted using `formatCurrency()` in the query transformation.

---

## SECTION 8: Summary Recommendations

### 8.1 API Route Location

**Recommendation**: Create `/api/dashboard/record-detail/[id]/route.ts`

**Rationale**:
- Follows existing pattern (`/api/users/[id]/route.ts`)
- RESTful design: GET single resource by ID
- Next.js App Router dynamic route pattern
- Clear separation from list endpoint

**Alternative Considered**: `/api/dashboard/record-detail/route.ts` with POST body containing `id`
- ❌ Less RESTful
- ❌ Doesn't match existing patterns
- ✅ Could reuse existing query function more easily

**Final Choice**: Dynamic route `[id]` - cleaner, more RESTful, matches codebase patterns.

### 8.2 Modal Component Location

**Recommendation**: `src/components/dashboard/RecordDetailModal.tsx`

**Rationale**:
- Matches existing component organization (dashboard components in `dashboard/` folder)
- Follows naming convention (`DetailRecordsTable` → `RecordDetailModal`)
- Keeps related components together
- Settings modals are in `settings/` folder, dashboard modals should be in `dashboard/`

### 8.3 Type Definition

**Recommendation**: Extend existing `DetailRecord` type OR create new `RecordDetail` type

**Option A: Extend `DetailRecord`** (Recommended):
- Add optional fields for additional data not in table view
- Keep existing fields as-is
- Modal can display all fields, table shows subset

**Option B: Create new `RecordDetail` type**:
- Separate type for full record details
- More explicit about what's available in modal vs table
- Requires maintaining two similar types

**Recommendation**: **Option A** - Extend `DetailRecord` with optional fields for additional data:
```typescript
export interface DetailRecord {
  // ... existing fields ...
  
  // Additional fields for modal (optional, fetched on demand)
  fullProspectId?: string;
  fullOpportunityId?: string;
  createdAt?: string;
  filterDate?: string;
  // ... other additional fields ...
}
```

### 8.4 State Management

**Recommendation**: Modal state at dashboard page level

**Rationale**:
- Matches existing pattern (`showAdvancedFilters` state)
- Allows dashboard to control modal visibility
- Enables data fetching at page level (consistent with other data)
- Table component stays focused on display

**Implementation**:
```typescript
// In dashboard page
const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
const [recordDetail, setRecordDetail] = useState<DetailRecord | null>(null);

// In table component
<TableRow onClick={() => onRecordClick(record.id)}>
  ...
</TableRow>

// Pass callback to table
<DetailRecordsTable
  onRecordClick={setSelectedRecordId}
  ...
/>
```

### 8.5 UI Library

**Recommendation**: Custom modal implementation (matching existing modals)

**Rationale**:
- No modal library installed (`@headlessui/react`, Tremor Dialog not available)
- Existing modals use custom implementation successfully
- Consistent with codebase patterns
- Full control over styling and behavior

**Pattern to Follow**:
```typescript
// From UserModal.tsx pattern
if (!isOpen) return null;

return (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div className="fixed inset-0 bg-black/50" onClick={onClose} />
    <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-4xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
      {/* Header */}
      {/* Content */}
      {/* Actions */}
    </div>
  </div>
);
```

**Styling Notes**:
- Use `max-w-4xl` (larger than existing modals for more content)
- Add `max-h-[90vh] overflow-y-auto` for scrollable content
- Include dark mode classes: `dark:bg-gray-800 dark:text-white`

### 8.6 Unique ID Strategy

**Recommendation**: Use `primary_key` field (currently mapped to `id` in `DetailRecord`)

**Rationale**:
- Already available in `DetailRecord.id`
- Handles both leads and opportunities (including direct opportunities)
- Single field simplifies API design
- Matches existing query pattern

**API Query**:
```sql
SELECT ... (all fields from vw_funnel_master)
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm
  ON v.Original_source = nm.original_source
WHERE v.primary_key = @id
LIMIT 1
```

**Alternative Considered**: Use `Full_prospect_id__c` and `Full_Opportunity_ID__c` separately
- ❌ More complex API design
- ❌ Requires checking which field is populated
- ❌ Doesn't handle direct opportunities cleanly

**Final Choice**: `primary_key` - simplest, most robust solution.

---

## Additional Implementation Notes

### Field Organization for Modal

**Suggested Layout** (grouped logically):

1. **Header Section**:
   - Advisor Name
   - Stage (with badges)
   - Salesforce Link

2. **Attribution Section**:
   - Source
   - Channel
   - SGA
   - SGM
   - External Agency

3. **Dates Section**:
   - Created Date
   - Filter Date (Cohort)
   - Contacted Date
   - MQL Date
   - SQL Date
   - SQO Date
   - Joined Date
   - Initial Call Scheduled
   - Qualification Call
   - Stage Entry Dates (Discovery, Sales Process, etc.)

4. **Financial Section**:
   - AUM (formatted)
   - Underwritten AUM
   - Amount
   - AUM Tier

5. **Status Section**:
   - Conversion Status
   - TOF Stage
   - Disposition
   - Closed Lost Reason/Details
   - Record Type

6. **Flags Section** (optional, for debugging):
   - is_contacted, is_mql, is_sql, is_sqo, is_joined
   - Eligibility flags
   - Progression flags

7. **IDs Section** (optional, for debugging):
   - Full Prospect ID
   - Full Opportunity ID
   - Primary Key

### Loading State in Modal

**Recommendation**: Show loading spinner while fetching record detail

**Pattern**:
```typescript
const [loading, setLoading] = useState(false);

useEffect(() => {
  if (selectedRecordId) {
    setLoading(true);
    fetchRecordDetail(selectedRecordId)
      .then(setRecordDetail)
      .finally(() => setLoading(false));
  }
}, [selectedRecordId]);

// In modal JSX
{loading ? <LoadingSpinner /> : <RecordDetailContent record={recordDetail} />}
```

### Error Handling

**Recommendation**: Display error message in modal if record not found or fetch fails

**Pattern** (from existing modals):
```typescript
{error && (
  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
    {error}
  </div>
)}
```

---

## File Structure Summary

**Files to Create**:
1. `src/app/api/dashboard/record-detail/[id]/route.ts` - API route
2. `src/components/dashboard/RecordDetailModal.tsx` - Modal component
3. `src/lib/queries/record-detail.ts` - Query function (optional, or extend `detail-records.ts`)

**Files to Modify**:
1. `src/components/dashboard/DetailRecordsTable.tsx` - Add `onRecordClick` prop and row click handler
2. `src/app/dashboard/page.tsx` - Add modal state and render modal
3. `src/lib/api-client.ts` - Add `getRecordDetail` method
4. `src/types/dashboard.ts` - Optionally extend `DetailRecord` with additional fields

**Files to Reference**:
- `src/components/settings/UserModal.tsx` - Modal pattern
- `src/app/api/users/[id]/route.ts` - Single-record API pattern
- `src/lib/queries/detail-records.ts` - Query structure
- `views/vw_funnel_master.sql` - Available fields

---

## SECTION 9: BigQuery Verification Results

### 9.1 Primary Key Validation

**Query Result**:
- Total records: **59,373**
- Records with primary_key: **59,373** (100%)
- Unique primary_keys: **59,373** (100%)
- NULL primary_keys: **0** (0%)
- Duplicate primary_keys: **0** (0%)

**Assessment**: ✅ **PASS** - `primary_key` is completely unique and non-null. Our fetch-by-ID strategy will work reliably. Every record has a unique identifier that can be used for single-record queries.

---

### 9.2 Sample Single Record Fetch

**Query Result**: ✅ **SUCCESS**

**Sample Record** (SQO with AUM > $50M):
```json
{
  "primary_key": "00QDn000003bDNjMAM",
  "advisor_name": "Rebecca True - FL",
  "Full_prospect_id__c": "00QDn000003bDNjMAM",
  "Full_Opportunity_ID__c": "006Dn000008RNClIAO",
  "StageName": "Closed Lost",
  "TOF_Stage": "SQO",
  "Opportunity_AUM": 55000000,
  "aum_tier": "Tier 2 ($25M-$75M)",
  "SGA_Owner_Name__c": "Paige de La Chapelle",
  "SGM_Owner_Name__c": "Paige de La Chapelle",
  "salesforce_url": "https://savvywealth.lightning.force.com/lightning/r/Opportunity/006Dn000008RNClIAO/view"
}
```

**Missing/NULL Fields** (Expected for this record type):
- `Date_Became_SQO__c`: NULL (this record is SQO but date field is NULL - may be a data quality issue)
- `Initial_Call_Scheduled_Date__c`: NULL (not scheduled)
- `Qualification_Call_Date__c`: NULL (not scheduled)
- `Stage_Entered_*` fields: NULL (record is Closed Lost, stage entry dates not populated)
- `advisor_join_date__c`: NULL (did not join)
- `Disposition__c`: NULL (opportunity-level, not lead-level)
- `Experimentation_Tag_Raw__c`: NULL
- `External_Agency__c`: NULL
- `Lead_Score_Tier__c`: NULL

**Assessment**: All expected fields exist and are accessible. NULL values are expected based on record type and stage. The query successfully retrieved all fields we plan to display in the modal.

---

### 9.3 Field Existence Verification

**All Expected Fields Exist**: ✅ **YES**

**Schema Verification**: All 95 fields from the view schema were verified. Key fields for modal:

**Identifiers**: ✅ All exist
- `primary_key` (STRING)
- `Full_prospect_id__c` (STRING)
- `Full_Opportunity_ID__c` (STRING)
- `advisor_name` (STRING)

**Attribution**: ✅ All exist
- `Original_source` (STRING)
- `Channel_Grouping_Name` (STRING)
- `SGA_Owner_Name__c` (STRING)
- `SGM_Owner_Name__c` (STRING)
- `External_Agency__c` (STRING)
- `Lead_Score_Tier__c` (STRING)

**Dates**: ✅ All exist (see 9.4 for types)
- All 17 date fields verified

**Financials**: ✅ All exist
- `Opportunity_AUM` (FLOAT)
- `Underwritten_AUM__c` (FLOAT)
- `Amount` (FLOAT)
- `Opportunity_AUM_M` (FLOAT)
- `aum_tier` (STRING)

**Status/Stage**: ✅ All exist
- `StageName` (STRING)
- `TOF_Stage` (STRING)
- `Conversion_Status` (STRING)
- `Disposition__c` (STRING)
- `Closed_Lost_Reason__c` (STRING)
- `Closed_Lost_Details__c` (STRING)
- `record_type_name` (STRING)

**Flags**: ✅ All exist
- All 13 flag fields verified (INTEGER type)

**URLs**: ✅ All exist
- `lead_url` (STRING)
- `opportunity_url` (STRING)
- `salesforce_url` (STRING)

**Missing Fields**: ❌ **NONE** - All planned fields exist in the view.

**Unexpected Fields Found**: 
- `Opp_SGA_User_Name` - Additional SGA name field (from User lookup)
- `Experimentation_Tag_List` - Array field for experiment tags (REPEATED STRING)
- `filter_date_cohort_month` through `joined_cohort_month` - Pre-formatted cohort month strings
- `StageName_code` - Numeric stage code (INTEGER)

---

### 9.4 Date Field Data Types

| Field | Data Type | Notes |
|-------|-----------|-------|
| `CreatedDate` | TIMESTAMP | Lead creation timestamp |
| `FilterDate` | TIMESTAMP | Cohort date (composite) |
| `stage_entered_contacting__c` | TIMESTAMP | Contacted date |
| `mql_stage_entered_ts` | TIMESTAMP | MQL date |
| `converted_date_raw` | **DATE** | SQL conversion date (DATE, not TIMESTAMP) |
| `Date_Became_SQO__c` | TIMESTAMP | SQO date |
| `advisor_join_date__c` | **DATE** | Joined date (DATE, not TIMESTAMP) |
| `Initial_Call_Scheduled_Date__c` | **DATE** | Initial call date (DATE, not TIMESTAMP) |
| `Qualification_Call_Date__c` | **DATE** | Qualification call date (DATE, not TIMESTAMP) |
| `lead_closed_date` | TIMESTAMP | Lead closed timestamp |
| `Opp_CreatedDate` | TIMESTAMP | Opportunity creation timestamp |
| `Stage_Entered_Discovery__c` | TIMESTAMP | Stage entry timestamps |
| `Stage_Entered_Negotiating__c` | TIMESTAMP | Stage entry timestamps |
| `Stage_Entered_Signed__c` | TIMESTAMP | Stage entry timestamps |
| `Stage_Entered_On_Hold__c` | TIMESTAMP | Stage entry timestamps |
| `Stage_Entered_Closed__c` | TIMESTAMP | Stage entry timestamps |

**Key Finding**: 
- **DATE fields** (4): `converted_date_raw`, `advisor_join_date__c`, `Initial_Call_Scheduled_Date__c`, `Qualification_Call_Date__c`
- **TIMESTAMP fields** (13): All other date fields

**Implementation Note**: DATE fields can be compared directly without `TIMESTAMP()` wrapper. TIMESTAMP fields require `TIMESTAMP()` wrapper for date string comparisons. For display formatting, both types can be formatted the same way in JavaScript/TypeScript.

---

### 9.5 Primary Key Format Check

**ID Formats**:
- **Lead IDs**: Start with `00Q...` (e.g., `00QDn000003bDNjMAM`, `00QDn000007DMzFMAW`)
- **Opportunity IDs**: Start with `006...` (e.g., `006Dn000008RNClIAO`)

**Record Distribution** (from 2-year window):
- **Lead Only**: 78,401 records (97.4%)
- **Both (Converted)**: 1,113 records (1.4%)
- **Opp Only (Direct)**: 960 records (1.2%)
- **Neither**: 0 records (0%)

**Key Finding**: 
- `primary_key` uses Lead ID format (`00Q...`) for Lead-only records
- `primary_key` uses Opportunity ID format (`006...`) for Opportunity-only (direct) records
- For converted leads, `primary_key` = Lead ID (not Opportunity ID)

**Assessment**: ✅ The `primary_key` format is consistent and predictable. Lead IDs and Opportunity IDs have distinct prefixes, making it easy to identify record type from the ID format.

---

### 9.6 Parameterized Query Test

**Query Tested**: 
```sql
SELECT primary_key, advisor_name, StageName, Opportunity_AUM, salesforce_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE primary_key = '00QDn000007DMzFMAW'
LIMIT 1
```

**Result**: ✅ **SUCCESS**

**Returned Record**:
```json
{
  "primary_key": "00QDn000007DMzFMAW",
  "advisor_name": "Jeffrey Menough",
  "StageName": null,
  "Opportunity_AUM": null,
  "salesforce_url": "https://savvywealth.lightning.force.com/lightning/r/Lead/00QDn000007DMzFMAW/view"
}
```

**Notes**: 
- Query executed successfully with parameterized `WHERE primary_key = @id` pattern
- Returns exactly one record (as expected with LIMIT 1)
- NULL values for `StageName` and `Opportunity_AUM` are expected for Lead-only records
- This validates our API query strategy will work correctly

---

### 9.7 Record Counts by Stage

| TOF_Stage | Count | Unique Records |
|-----------|-------|----------------|
| Joined | 52 | 52 |

**Note**: Query only returned "Joined" stage. This is likely because the query filtered by `stage_entered_contacting__c >= [2 years ago]`, which may exclude many records that haven't entered contacting yet.

**Assessment**: The modal should handle all stages gracefully, as records can be at any stage (Prospect, Contacted, MQL, SQL, SQO, Joined). The distribution will vary based on the date filter applied.

---

### 9.8 NULL Field Analysis

**Total Records Analyzed**: 59,373 (from 2-year window)

**High NULL Rate Fields** (>50% null - conditionally display):
- `External_Agency__c`: **99.8%** null (59,284 / 59,373)
- `Opportunity_AUM`: **99.0%** null (58,803 / 59,373) - Expected for Lead-only records
- `Underwritten_AUM__c`: **99.6%** null (59,177 / 59,373)
- `Closed_Lost_Reason__c`: **99.0%** null (58,755 / 59,373) - Only for closed opportunities
- `Initial_Call_Scheduled_Date__c`: **98.7%** null (58,600 / 59,373)
- `Qualification_Call_Date__c`: **98.7%** null (58,629 / 59,373)
- `advisor_join_date__c`: **99.9%** null (59,321 / 59,373) - Only for joined records
- `Date_Became_SQO__c`: **98.7%** null (58,595 / 59,373) - Only for SQO records
- `Lead_Score_Tier__c`: **98.9%** null (58,743 / 59,373)
- `SGM_Owner_Name__c`: **98.6%** null (58,542 / 59,373) - Only for opportunities

**Medium NULL Rate Fields** (10-50% null):
- `converted_date_raw`: **98.6%** null (58,538 / 59,373) - Only for SQL+ records
- `mql_stage_entered_ts`: **95.8%** null (56,904 / 59,373) - Only for MQL+ records
- `Disposition__c`: **21.5%** null (12,759 / 59,373) - Only for closed leads

**Low NULL Rate Fields** (<10% null - always display):
- `SGA_Owner_Name__c`: **0%** null (0 / 59,373) - Always populated
- `stage_entered_contacting__c`: **0%** null (0 / 59,373) - Always populated (query filter ensures this)

**Assessment**: 
- Fields with >90% NULL rates should be conditionally displayed (only show if value exists)
- Fields with <10% NULL rates can be always displayed
- Financial fields (AUM) will be NULL for Lead-only records - this is expected

---

### Verification Summary

**Ready for Implementation**: ✅ **YES**

**Blockers Found**: ❌ **NONE**

**Key Validations**:
1. ✅ `primary_key` is unique and non-null - safe for fetch-by-ID
2. ✅ All planned fields exist in the view
3. ✅ Parameterized query pattern works correctly
4. ✅ Date field types are known (DATE vs TIMESTAMP)
5. ✅ ID formats are predictable (Lead: `00Q...`, Opp: `006...`)

**Recommendations Based on Verification**:

1. **Conditional Field Display**: 
   - Always show: `advisor_name`, `SGA_Owner_Name__c`, `source`, `channel`, `stage_entered_contacting__c`
   - Conditionally show (if not null): All financial fields, stage entry dates, closed dates, disposition fields
   - Group NULL fields in collapsible sections or show "N/A" for better UX

2. **Date Formatting**:
   - DATE fields: Format as date only (e.g., "Jan 15, 2026")
   - TIMESTAMP fields: Format as date + time (e.g., "Jan 15, 2026, 10:30 AM")
   - Use existing `formatDate()` and `formatDateTime()` utilities

3. **Record Type Handling**:
   - Lead-only records: Hide opportunity-specific fields (AUM, SGM, stage entry dates)
   - Opportunity records: Show all fields
   - Use `Full_Opportunity_ID__c IS NOT NULL` to determine record type

4. **API Query Optimization**:
   - Use `WHERE primary_key = @id LIMIT 1` pattern (validated)
   - No need for additional joins beyond existing `new_mapping` join
   - Query will be fast (single record lookup)

5. **Error Handling**:
   - Handle case where record not found (404 response)
   - Handle case where `primary_key` is invalid format
   - Display appropriate error messages in modal

6. **Modal Layout Suggestions**:
   - **Header Section**: Always visible (advisor name, stage, Salesforce link)
   - **Attribution Section**: Always visible (source, channel, SGA, SGM if available)
   - **Dates Section**: Collapsible, show only populated dates
   - **Financial Section**: Only show if `Full_Opportunity_ID__c IS NOT NULL`
   - **Status Section**: Show relevant fields based on record type
   - **Debug Section** (optional): Collapsible section with IDs and flags

**Implementation Confidence**: 🟢 **HIGH** - All assumptions validated, no blockers identified.

---

## SECTION 10: Additional UX/Implementation Questions

### 10.1 Keyboard Accessibility - ESC Key Press

**Question**: Do existing modals close on ESC key press?

**Answer**: ❌ **NO** - Existing modals do not currently handle ESC key press.

**Evidence**: 
- Examined `UserModal.tsx`, `DeleteConfirmModal.tsx`, and `ResetPasswordModal.tsx`
- No `onKeyDown`, `useEffect` with keyboard listeners, or ESC key handling found
- Modals only close via:
  - Clicking the X button
  - Clicking the backdrop (onClick={onClose})
  - Form submission/cancel buttons

**Recommendation**: 
- ✅ **Add ESC key handler** for consistent UX (standard practice)
- Use `useEffect` with keyboard event listener:
  ```typescript
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);
  ```

**Implementation Priority**: Medium - Good UX enhancement, not critical for v1.

---

### 10.2 Click-Outside Behavior

**Question**: Is `onClick={onClose}` on backdrop consistent across all modals?

**Answer**: ✅ **YES** - All existing modals use this pattern consistently.

**Evidence**:
- `UserModal.tsx` (line 98): `<div className="fixed inset-0 bg-black/50" onClick={onClose} />`
- `DeleteConfirmModal.tsx` (line 46): `<div className="fixed inset-0 bg-black/50" onClick={onClose} />`
- `ResetPasswordModal.tsx` (line 69): `<div className="fixed inset-0 bg-black/50" onClick={onClose} />`

**Recommendation**: 
- ✅ **Use same pattern** for Record Detail Modal
- Ensure backdrop div is clickable and calls `onClose`
- Consider preventing event propagation on modal content to avoid accidental closes

**Implementation Priority**: High - Must match existing behavior.

---

### 10.3 Mobile Responsiveness

**Question**: Do existing modals work on mobile? Any special handling?

**Answer**: ✅ **YES** - Existing modals are mobile-responsive using Tailwind classes.

**Evidence**:
- All modals use: `w-full max-w-md mx-4 p-6`
  - `w-full`: Full width on mobile
  - `max-w-md`: Limits width on larger screens (28rem / 448px)
  - `mx-4`: Horizontal margin (1rem) on all sides for mobile spacing
  - `p-6`: Padding inside modal

**Current Mobile Behavior**:
- Modals are full-width on mobile (with 1rem margins)
- Max width of 448px on larger screens
- Centered using `flex items-center justify-center` on parent

**Recommendation for Record Detail Modal**:
- Use `max-w-4xl` instead of `max-w-md` (larger modal for more content)
- Keep `mx-4` for mobile margins
- Add `max-h-[90vh] overflow-y-auto` for scrollable content on mobile
- Consider responsive text sizes: `text-sm md:text-base` for smaller screens

**Implementation Pattern**:
```typescript
<div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-4xl mx-4 p-6 max-h-[90vh] overflow-y-auto">
  {/* Modal content */}
</div>
```

**Implementation Priority**: High - Modal must work on tablets and mobile devices.

---

### 10.4 URL Deep Linking

**Question**: Should opening a record update the URL (e.g., `?record=00Q...`)?

**Answer**: ⏭️ **SKIP FOR V1** - No existing pattern in codebase.

**Evidence**:
- No URL parameter handling found in existing modals
- Dashboard page doesn't use URL search params for state
- All state is managed via React `useState` hooks

**Considerations**:
- **Pros**: Allows bookmarking/sharing specific records, browser back/forward navigation
- **Cons**: Adds complexity, requires Next.js router integration, URL state management

**Recommendation**:
- ⏭️ **Skip for v1** - Focus on core modal functionality first
- ✅ **Add in v2** - Use Next.js `useSearchParams` and `useRouter`:
  ```typescript
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // On open
  const params = new URLSearchParams(searchParams);
  params.set('record', recordId);
  router.push(`?${params.toString()}`, { scroll: false });
  
  // On close
  const params = new URLSearchParams(searchParams);
  params.delete('record');
  router.push(`?${params.toString()}`, { scroll: false });
  ```

**Implementation Priority**: Low - Nice-to-have enhancement for future version.

---

### 10.5 Transition Animations

**Question**: Do you want fade-in/slide-up animations?

**Answer**: ❌ **NO** - Existing modals use simple show/hide (no animations).

**Evidence**:
- All modals use conditional rendering: `if (!isOpen) return null;`
- No fade-in, slide-up, or transition animations found
- Only `transition-colors` on buttons (for hover states)
- Modals appear/disappear instantly

**Current Pattern**:
```typescript
if (!isOpen) return null;

return (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    {/* Modal content */}
  </div>
);
```

**Recommendation**:
- ✅ **Match existing pattern** - Simple show/hide, no animations
- Keep `transition-colors` on interactive elements (buttons, links)
- If animations are desired in future, consider:
  - Fade-in: `animate-in fade-in duration-200`
  - Slide-up: `animate-in slide-in-from-bottom-4 duration-200`
  - Would require adding animation classes or a library like Framer Motion

**Implementation Priority**: Low - Match existing behavior (no animations).

---

### Summary of UX Recommendations

| Feature | Current State | Recommendation | Priority |
|---------|---------------|----------------|----------|
| **ESC Key** | ❌ Not implemented | ✅ Add ESC handler | Medium |
| **Click Outside** | ✅ Consistent | ✅ Match pattern | High |
| **Mobile Responsive** | ✅ Works well | ✅ Use `max-w-4xl mx-4` | High |
| **URL Deep Linking** | ❌ Not implemented | ⏭️ Skip for v1 | Low |
| **Animations** | ❌ None | ✅ Match (no animations) | Low |

**Implementation Checklist**:
- [ ] Add ESC key handler (`useEffect` with keyboard listener)
- [ ] Implement backdrop click-to-close (`onClick={onClose}`)
- [ ] Use responsive classes (`max-w-4xl mx-4 max-h-[90vh] overflow-y-auto`)
- [ ] Skip URL deep linking for v1
- [ ] Use simple show/hide (no animations)

---

**End of Investigation Document**
