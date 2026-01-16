# Data Freshness Investigation Answers

**Investigation Date**: January 16, 2026
**Investigated By**: Cursor.ai

---

## Section 1: BigQuery Metadata Discovery

### 1.1 Available Datasets

**Query Result**:
```
Dataset: FinTrx_data
  Creation Time: 2025-12-19T16:45:42.368Z
  Last Modified: 2025-12-19T16:45:42.368Z

Dataset: Tableau_Views
  Creation Time: 2026-01-08T13:44:02.819-05:00
  Last Modified: 2026-01-08T13:44:02.819-05:00

Dataset: SavvyGTMData
  Creation Time: 2025-09-23T14:40:12.618-04:00
  Last Modified: 2025-09-23T14:45:51.031-04:00

Dataset: savvy_analytics
  Creation Time: 2025-09-23T18:29:04.688-04:00
  Last Modified: 2025-09-23T18:29:04.688-04:00
```

**Observations**: 
- The main datasets are `SavvyGTMData` (source tables) and `Tableau_Views` (views)
- `SavvyGTMData` has a service account with WRITER role, indicating automated data transfers
- `INFORMATION_SCHEMA.SCHEMATA` does not expose `last_modified_time` field (query failed)

### 1.2 Tables in Key Datasets

**Tableau_Views Dataset**:
```
Tables/Views Found:
- vw_funnel_master (VIEW)
  Creation Time: 2026-01-13T17:50:02.419-05:00
  Last Modified: 2026-01-13T17:50:02.419-05:00

- vw_sga_funnel_team_agg_improved (VIEW)
```

**SavvyGTMData Dataset**:
```
Key Tables Found (from get_table_info):
- Lead (TABLE)
  Creation Time: 2025-09-23T14:48:02.509-04:00
  Last Modified: 2026-01-16T14:39:23.716-05:00
  Rows: 93,807
  Size: 72,193,895 bytes

- Opportunity (TABLE)
  Creation Time: 2025-09-23T14:48:02.359-04:00
  Last Modified: 2026-01-16T14:39:18.736-05:00
  Rows: 2,739
  Size: 2,369,777 bytes

- User (TABLE)
- new_mapping (TABLE)
```

**Observations**: 
- `INFORMATION_SCHEMA.TABLES` queries failed due to `last_modified_time` not being available in that schema
- Used `get_table_info` MCP function instead, which provides `LastModifiedTime`
- Source tables (`Lead`, `Opportunity`) have recent `LastModifiedTime` values (today: 2026-01-16)
- Views have `LastModifiedTime` but this reflects view definition changes, not data freshness

### 1.3 View Dependencies

**vw_funnel_master View Definition** (summarized):
The view is a complex CTE-based view that combines data from multiple source tables:

**Source Tables Identified**:
- `savvy-gtm-analytics.SavvyGTMData.Lead` - Primary lead data source
- `savvy-gtm-analytics.SavvyGTMData.Opportunity` - Primary opportunity data source
- `savvy-gtm-analytics.SavvyGTMData.User` - User lookup for SGA/SGM names
- `savvy-gtm-analytics.SavvyGTMData.new_mapping` - Channel mapping table

**View Structure**:
1. `Lead_Base` CTE - Selects from `Lead` table
2. `Opp_Base` CTE - Selects from `Opportunity` table (filtered by RecordTypeId)
3. `Combined` CTE - FULL OUTER JOIN of Lead_Base and Opp_Base
4. `With_Channel_Mapping` CTE - LEFT JOIN to `new_mapping` table
5. `With_SGA_Lookup` CTE - LEFT JOIN to `User` table
6. `Final` CTE - Final transformations and derived fields

### 1.4 Source Table Metadata

**Query Result** (from get_table_info):
```
Lead Table:
  Last Modified: 2026-01-16T14:39:23.716-05:00
  Rows: 93,807
  Size: 72,193,895 bytes

Opportunity Table:
  Last Modified: 2026-01-16T14:39:18.736-05:00
  Rows: 2,739
  Size: 2,369,777 bytes
```

**Key Finding**: The source tables were last modified at:
- **Lead**: 2026-01-16T14:39:23.716-05:00 (approximately 2:39 PM ET today)
- **Opportunity**: 2026-01-16T14:39:18.736-05:00 (approximately 2:39 PM ET today)

**Note**: These timestamps reflect when data was last loaded into BigQuery, not necessarily when the most recent record was created in Salesforce.

---

## Section 2: Data Transfer/Job History

### 2.1 Recent Jobs

**Query Result**:
```
LOAD Jobs: 0 rows returned (no LOAD jobs found in last 7 days)

QUERY Jobs: 1 row returned
  Job ID: SUMMDbWrBDU4Le05oag4TGLVGYp
  Job Type: QUERY
  State: DONE
  Creation Time: 2026-01-16T18:43:40.496Z
  Start Time: 2026-01-16T18:43:40.519Z
  End Time: 2026-01-16T18:43:40.692Z
  Destination: Anonymous temporary table
```

**Observations**: 
- No LOAD jobs found in the last 7 days, which suggests data transfers may:
  1. Use a different job type (e.g., scheduled queries that write to tables)
  2. Run less frequently than daily
  3. Use a different mechanism (e.g., Data Transfer Service, which doesn't show in JOBS table)
- The presence of a service account (`service-154995667624@gcp-sa-bigquerydatatransfer.iam.gserviceaccount.com`) with WRITER role on `SavvyGTMData` suggests **BigQuery Data Transfer Service** is being used
- Data Transfer Service jobs do NOT appear in `INFORMATION_SCHEMA.JOBS` - they have their own API

### 2.2 Scheduled Queries

**Finding**: 
- Only 1 QUERY job found in last 2 days, and it was an anonymous temporary table (likely a user query)
- No scheduled queries that write to destination tables were found
- This confirms that data is likely loaded via **BigQuery Data Transfer Service** (Salesforce connector), which doesn't appear in JOBS table

---

## Section 3: Data Timestamps Within Tables

### 3.1 Maximum Timestamps

**vw_funnel_master**:
```
max_filter_date: 2026-01-16T19:29:35Z
max_created_date: 2026-01-16T19:24:34Z
max_converted_date: 2026-01-16
total_records: 95,119
```

**Lead Table**:
```
max_created: 2026-01-16T19:24:34Z
max_modified: 2026-01-16T19:34:21Z
total_records: 93,807
```

**Opportunity Table**:
```
max_created: 2026-01-16T19:12:23Z
max_modified: 2026-01-16T19:22:42Z
total_records: 2,739
```

**Observations**: 
- **Most recent data**: Records exist with timestamps from today (January 16, 2026)
- **Lead table**: Most recent modification at 19:34:21Z (approximately 2:34 PM ET)
- **Opportunity table**: Most recent modification at 19:22:42Z (approximately 2:22 PM ET)
- **`LastModifiedDate` field exists** and is populated in both tables
- The `max_modified` timestamps are more recent than the table `LastModifiedTime` metadata, suggesting data is being updated frequently

---

## Section 4: Codebase Investigation

### 4.1 BigQuery Client Setup

**File**: `src/lib/bigquery.ts`

**Key Findings**:
- **Authentication method**: Uses `@google-cloud/bigquery` library
- **Vercel deployment**: Uses `GOOGLE_APPLICATION_CREDENTIALS_JSON` environment variable (JSON string)
- **Local development**: Uses `GOOGLE_APPLICATION_CREDENTIALS` environment variable (file path)
- **Client instantiation pattern**: Singleton pattern with lazy initialization
- **Query execution helper**: `runQuery<T>(query: string, params?: Record<string, any>)` function

**Relevant Code Snippet**:
```typescript
export function getBigQueryClient(): BigQuery {
  if (bigqueryClient) return bigqueryClient;

  const projectId = process.env.GCP_PROJECT_ID || 'savvy-gtm-analytics';

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    bigqueryClient = new BigQuery({
      projectId,
      credentials,
      scopes: ['https://www.googleapis.com/auth/bigquery', ...],
    });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    bigqueryClient = new BigQuery({
      projectId,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: [...],
    });
  }
  
  return bigqueryClient;
}

export async function runQuery<T>(query: string, params?: Record<string, any>): Promise<T[]> {
  const client = getBigQueryClient();
  const options: Query = { query, params: params || {} };
  const [rows] = await client.query(options);
  return rows as T[];
}
```

### 4.2 API Route Patterns

**Example Route Examined**: `src/app/api/dashboard/funnel-metrics/route.ts` and `src/app/api/dashboard/filters/route.ts`

**Pattern**:
```typescript
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    // ... process request ...
    
    const result = await someQueryFunction(filters);
    
    return NextResponse.json(result);
  } catch (error) {
    logger.error('Error message', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Error Handling**: 
- Uses try/catch blocks
- Returns appropriate HTTP status codes (401 for unauthorized, 500 for server errors)
- Uses logger for error logging
- Returns JSON error responses

**Response Format**: 
- Successful responses return JSON with data
- Error responses return JSON with `{ error: string }` format

### 4.3 Header Component Structure

**File**: `src/components/layout/Header.tsx`

**Current Structure**:
```tsx
<header className="h-16 bg-white dark:bg-gray-800 border-b ...">
  <div className="flex items-center gap-4">
    {/* Savvy Logo and "Funnel Dashboard" text */}
  </div>
  <div className="flex items-center gap-4">
    <ThemeToggle />
    {/* User email and Sign Out button */}
  </div>
</header>
```

**Recommended Placement**: 
- **Best location**: Right side of header, between ThemeToggle and user email
- **Alternative**: Below the "Funnel Dashboard" text on the left side
- The header is visible on all dashboard pages, making it ideal for a global freshness indicator

### 4.4 GlobalFilters Component

**File**: `src/components/dashboard/GlobalFilters.tsx`

**Exists**: Yes

**Structure**: 
- Large filter panel with multiple dropdowns (Date Range, Channel, Source, SGA, SGM, etc.)
- Has a "Reset" button in the top-right
- Uses a grid layout with responsive columns
- Could accommodate a freshness indicator in the header area (next to "Filters" title) or as a small badge below the filters

**Recommended Placement**: 
- **Option 1**: Small badge/text in the top-right corner of the GlobalFilters card (next to Reset button)
- **Option 2**: Below the filter grid as a subtle footer
- **Option 3**: Both Header (always visible) and GlobalFilters (contextual)

---

## Section 5: Recommendations

### 5.1 Best Data Freshness Source

**Recommended Approach**: Use `MAX(LastModifiedDate)` from source tables (Lead and Opportunity)

**Reasoning**: 
1. **Most Accurate**: `LastModifiedDate` reflects actual data changes in Salesforce, not just when data was loaded to BigQuery
2. **Always Accessible**: No permission issues (unlike JOBS table)
3. **Reflects Real Data State**: Shows when records were actually modified, not just when the table metadata was updated
4. **Works for Views**: Can query the view itself to get max timestamps without needing table-level metadata
5. **Table Metadata Limitations**: `INFORMATION_SCHEMA.TABLES.last_modified_time` may not update for views, and we primarily query views

**Alternative Considered**: 
- `INFORMATION_SCHEMA.TABLES.last_modified_time` - Not viable because:
  - Doesn't work for views (only base tables)
  - May not reflect actual data freshness (only when table structure changed)
  - Query failed due to schema limitations

**Query to Use**:
```sql
-- Get the most recent data modification across all source tables
SELECT 
  'Data Last Updated' as label,
  GREATEST(
    COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Lead`), TIMESTAMP('1900-01-01')),
    COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`), TIMESTAMP('1900-01-01'))
  ) as last_updated,
  TIMESTAMP_DIFF(
    CURRENT_TIMESTAMP(),
    GREATEST(
      COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Lead`), TIMESTAMP('1900-01-01')),
      COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`), TIMESTAMP('1900-01-01'))
    ),
    HOUR
  ) as hours_ago
```

**Note**: Verified that `vw_funnel_master` does NOT have a `LastModifiedDate` field (query returned 0 columns). We must query source tables directly.

**Best Query** (Recommended):
```sql
-- Get freshness from source tables directly
SELECT 
  GREATEST(
    COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Lead`), TIMESTAMP('1900-01-01')),
    COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`), TIMESTAMP('1900-01-01'))
  ) as last_updated
```

### 5.2 UI Placement

**Recommended Location**: **Both Header and GlobalFilters**

**Reasoning**: 
- **Header**: Always visible, provides constant awareness of data freshness
- **GlobalFilters**: Contextual placement for users actively filtering data
- **Header placement**: Small, subtle indicator (e.g., "Data: 2 hours ago" or icon with tooltip)
- **GlobalFilters placement**: More detailed (e.g., "Last updated: Jan 16, 2026 at 2:34 PM ET")

**Implementation Strategy**:
1. Create a reusable `DataFreshnessIndicator` component
2. Use it in Header (compact version) and GlobalFilters (detailed version)
3. Share the same data source via React Query/SWR for caching

### 5.3 Caching Strategy

**Recommended Strategy**: **React Query/SWR with stale-while-revalidate (5 minute cache)**

**Reasoning**: 
- **5 minute cache**: Reduces BigQuery calls while keeping data reasonably fresh
- **Stale-while-revalidate**: Shows cached data immediately, then updates in background
- **User Experience**: Fast page loads, automatic background updates
- **Cost**: Minimal BigQuery usage (12 queries per hour per user, but shared across all users)
- **Alternative**: Could use 1 hour cache if cost is a concern, but 5 minutes is better for user trust

**Implementation**:
```typescript
// Using React Query
const { data: freshness } = useQuery(
  'data-freshness',
  () => fetchDataFreshness(),
  {
    staleTime: 5 * 60 * 1000, // 5 minutes
    cacheTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60 * 1000, // Auto-refetch every 5 minutes
  }
);
```

---

## Section 6: Edge Cases & Recommendations

### Stale Data Warning
- **Threshold**: 24 hours
- **Visual Treatment**: 
  - **< 1 hour**: Green indicator (✓ or green dot)
  - **1-6 hours**: Yellow indicator (⚠ or yellow dot)
  - **6-24 hours**: Orange indicator (⚠ or orange dot)
  - **> 24 hours**: Red indicator (⚠ or red dot) with warning text
- **Tooltip**: Show exact timestamp and hours/minutes ago on hover

### Timezone
- **Recommendation**: **Eastern Time (ET)** with automatic DST handling
- **Reasoning**: 
  - Business operates in Eastern Time
  - Most users are in ET timezone
  - Can use `America/New_York` timezone for proper DST handling
  - Display format: "Jan 16, 2026 at 2:34 PM ET"

### Timestamp Format
- **Recommendation**: **Relative when recent, absolute when older**
- **Examples**: 
  - **< 1 hour**: "Updated 15 minutes ago"
  - **1-6 hours**: "Updated 2 hours ago"
  - **6-24 hours**: "Updated 8 hours ago"
  - **> 24 hours**: "Last updated: Jan 15, 2026 at 2:34 PM ET"
  - **> 7 days**: "Last updated: Jan 9, 2026 at 2:34 PM ET" (with warning style)

### Multiple Data Sources
- **Recommendation**: **Single timestamp (most recent of all sources)**
- **Reasoning**: 
  - Simpler UX - users don't need to understand multiple timestamps
  - Shows the "worst case" freshness (most stale source)
  - If one source is stale, that's what matters
  - Can show breakdown in tooltip if needed: "Lead data: 2 hours ago, Opportunity data: 4 hours ago"

---

## Summary

**Best Approach for Data Freshness**:
Use `MAX(LastModifiedDate)` from the `Lead` and `Opportunity` source tables, taking the most recent timestamp between them. This provides the most accurate representation of when data was actually modified in Salesforce. Create a new API endpoint `/api/dashboard/data-freshness` that queries these source tables and returns a single timestamp. Display this in both the Header (compact) and GlobalFilters (detailed) components using React Query with 5-minute caching and stale-while-revalidate pattern.

**Key Query**:
```sql
SELECT 
  GREATEST(
    COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Lead`), TIMESTAMP('1900-01-01')),
    COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`), TIMESTAMP('1900-01-01'))
  ) as last_updated,
  TIMESTAMP_DIFF(
    CURRENT_TIMESTAMP(),
    GREATEST(
      COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Lead`), TIMESTAMP('1900-01-01')),
      COALESCE((SELECT MAX(LastModifiedDate) FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`), TIMESTAMP('1900-01-01'))
    ),
    HOUR
  ) as hours_ago
```

**Expected Result Format**:
```json
{
  "lastUpdated": "2026-01-16T20:38:05Z",
  "lastUpdatedET": "2026-01-16T15:38:05-05:00",
  "hoursAgo": 0,
  "minutesAgo": 9,
  "isStale": false,
  "status": "fresh" // "fresh" | "recent" | "stale" | "very_stale"
}
```

**Test Query Result** (executed 2026-01-16 at ~8:47 PM ET):
- Last Updated: 2026-01-16T20:38:05Z (3:38 PM ET)
- Hours Ago: 0
- Minutes Ago: 9
- **Status**: Data is very fresh (updated 9 minutes ago)

---

## Additional Notes

1. **Data Transfer Service**: The presence of `service-154995667624@gcp-sa-bigquerydatatransfer.iam.gserviceaccount.com` with WRITER role confirms BigQuery Data Transfer Service is used. This service typically syncs Salesforce data on a schedule (likely daily or multiple times per day).

2. **View Refresh**: The `vw_funnel_master` view is materialized/refreshed when queried, so it always reflects current source table data. The view's `LastModifiedTime` only changes when the view definition is updated, not when source data changes.

3. **Performance Consideration**: The recommended query uses subqueries which may be slower. Consider:
   - Caching aggressively (5+ minutes)
   - Using a simpler query if performance is an issue: `SELECT MAX(LastModifiedDate) FROM vw_funnel_master` (if we add this field to the view)
   - Or creating a lightweight metadata table that gets updated during data transfers

4. **Alternative Implementation**: If querying source tables directly is too slow, we could:
   - Add a `data_last_updated` metadata table that gets updated by the data transfer process
   - Or add `MAX(LastModifiedDate)` as a computed field in `vw_funnel_master` view
   - Or use table metadata `LastModifiedTime` as a fallback (though less accurate)

5. **Current Data State**: Based on investigation, data appears to be very fresh:
   - Lead table last modified: Today at 2:39 PM ET
   - Opportunity table last modified: Today at 2:39 PM ET
   - Most recent record modifications: Today around 2:22-2:34 PM ET
   - This suggests data is syncing multiple times per day, likely every few hours

---

## Follow-Up Investigation (Data Transfer Verification)

**Investigation Date**: January 16, 2026
**Time of Investigation**: ~8:55 PM ET (20:55 UTC)
**Purpose**: Verify recent data transfer (~3:30 PM EST) and determine best freshness reporting approach

### A. Data Transfer Verification

#### A.1 Table Metadata Timestamps

**Query Time**: 2026-01-16T20:55:33.538155Z (8:55 PM ET)

**Lead Table** (from `get_table_info`):
- LastModifiedTime: `2026-01-16T15:39:22.827-05:00` (3:39 PM EST)
- From `__TABLES__`: `2026-01-16T20:39:22.827Z` (3:39 PM EST)
- Row Count: 93,807
- Size: 72,195,081 bytes

**Opportunity Table** (from `get_table_info`):
- LastModifiedTime: `2026-01-16T15:39:17.894-05:00` (3:39 PM EST)
- From `__TABLES__`: `2026-01-16T20:39:17.894Z` (3:39 PM EST)
- Row Count: 2,740
- Size: 2,371,101 bytes

**Observation**: ✅ **YES - The table metadata timestamps match the ~3:30 PM EST transfer!**
- Both tables show `last_modified_time` of approximately **3:39 PM EST** (20:39 UTC)
- This is very close to the user's stated transfer time of ~3:30 PM EST
- The slight difference (3:39 vs 3:30) is likely due to the transfer process taking a few minutes to complete

#### A.2 MAX Record Timestamps

**Query Result**:
```json
{
  "table_name": "Lead",
  "max_created": "2026-01-16T20:16:27Z",
  "max_modified": "2026-01-16T20:38:05Z",
  "row_count": 93807
}
```

```json
{
  "table_name": "Opportunity",
  "max_created": "2026-01-16T20:16:27Z",
  "max_modified": "2026-01-16T20:31:40Z",
  "row_count": 2740
}
```

**Comparison**:
| Source | Lead Timestamp | Opportunity Timestamp |
|--------|---------------|----------------------|
| Table Metadata (`__TABLES__.last_modified_time`) | 2026-01-16T20:39:22.827Z (3:39 PM EST) | 2026-01-16T20:39:17.894Z (3:39 PM EST) |
| MAX(LastModifiedDate) from records | 2026-01-16T20:38:05Z (3:38 PM EST) | 2026-01-16T20:31:40Z (3:31 PM EST) |

**Difference Explained**: 
- **Table Metadata** shows when the BigQuery table was last written to (i.e., when the data transfer completed)
- **MAX(LastModifiedDate)** shows the most recent Salesforce record modification timestamp that exists in our data
- The table metadata (3:39 PM) is **slightly newer** than MAX(LastModifiedDate) (3:31-3:38 PM), which makes sense because:
  1. Records were modified in Salesforce at 3:31-3:38 PM
  2. The data transfer process then pulled those changes and completed loading to BigQuery at 3:39 PM
  3. The table metadata reflects the **completion time** of the transfer, not the record modification time

### B. Timestamp Type Clarification

**Key Understanding**: There are TWO different timestamps with different meanings:

| Type | Source | What It Means | When It Updates |
|------|--------|---------------|-----------------|
| **Table Metadata** | `__TABLES__.last_modified_time` | When data was **loaded/synced** to BigQuery | Every time a data transfer completes |
| **MAX(LastModifiedDate)** | Query actual records | Most recent Salesforce **record modification** timestamp in our data | Reflects when records were modified in Salesforce (may be older than transfer time) |

**Why They Differ**:
- A record modified in Salesforce at 4:00 PM won't appear in BigQuery until the **next** data transfer runs
- The table metadata shows when we **LOADED** data, not when records were modified
- MAX(LastModifiedDate) shows the most recent Salesforce activity that's **already in our data**

**User's Problem Statement**: "People get confused by the data if they did something today"

**What Users Want to Know**: **"When was the data last synced from Salesforce to BigQuery?"**

**Conclusion**: Users want to know **"When did we last pull fresh data?"** - This is answered by **Table Metadata**, NOT by MAX(LastModifiedDate).

### C. Recommended Approach

#### C.1 __TABLES__ Metadata Query Test

**Query Result**:
```json
{
  "table_name": "Lead",
  "last_data_load": "2026-01-16T20:39:22.827Z",
  "row_count": 93807,
  "size_bytes": 72195081
}
```

```json
{
  "table_name": "Opportunity",
  "last_data_load": "2026-01-16T20:39:17.894Z",
  "row_count": 2740,
  "size_bytes": 2371101
}
```

**Does it show the 3:30 PM transfer?**: ✅ **YES**
- Lead: 3:39 PM EST (20:39:22 UTC)
- Opportunity: 3:39 PM EST (20:39:17 UTC)
- Both timestamps are within 10 minutes of the stated 3:30 PM transfer time

**Query Used**:
```sql
SELECT 
  table_id as table_name,
  TIMESTAMP_MILLIS(last_modified_time) as last_data_load,
  row_count,
  size_bytes
FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
WHERE table_id IN ('Lead', 'Opportunity')
ORDER BY last_modified_time DESC
```

**Status**: ✅ Query works perfectly and accurately reflects data transfer times

### D. All Tables Analysis

**All Tables in SavvyGTMData** (Top 20 by last_modified_time):
```
Opportunity: 2026-01-16T20:39:17.894Z (3:39 PM EST) - 2,740 rows
Lead: 2026-01-16T20:39:22.827Z (3:39 PM EST) - 93,807 rows
new_mapping: 2026-01-10T01:27:26.525Z - 339 rows
AreaCode_Timezone: 2025-12-04T15:57:32.738Z - 339 rows
[Other tables with older timestamps...]
```

**Observation**: 
- ✅ **Lead and Opportunity have nearly identical transfer times** (within 5 seconds of each other)
- This confirms they are **transferred together** as part of the same data sync process
- Other tables (like `new_mapping`, `User`) have much older timestamps, suggesting they're updated separately or less frequently
- The fact that Lead and Opportunity sync together means we can use **either one** or take the **GREATEST** of both

### E. Final Recommendations

#### E.1 Timestamp Source
**Recommendation**: ✅ **Table Metadata (`__TABLES__.last_modified_time`)**

**Reasoning**: 
1. **Answers the Right Question**: Users want to know "when was data last synced?" - table metadata answers this directly
2. **More Accurate for User Intent**: If a user does something in Salesforce at 4:00 PM, they want to know "is my 4:00 PM change in the dashboard yet?" - table metadata tells them when the last sync completed
3. **Simpler Query**: `__TABLES__` is a lightweight metadata table, faster than querying actual data
4. **No Permission Issues**: Always accessible, unlike JOBS table
5. **Reflects Transfer Completion**: Shows when the sync actually finished, which is what matters for "is my data fresh?"

**Previous Recommendation (MAX(LastModifiedDate)) Was Incorrect**:
- MAX(LastModifiedDate) shows when records were modified in Salesforce
- But if a transfer runs at 3:39 PM, and a user modifies a record at 4:00 PM, MAX(LastModifiedDate) would still show 3:38 PM (the most recent record in the data)
- This doesn't tell users "when was the last sync?" - it tells them "what's the newest record we have?"
- **These are different questions!**

#### E.2 Tables to Monitor
**Recommendation**: ✅ **GREATEST of Lead and Opportunity (both tables)**

**Reasoning**: 
- Lead and Opportunity are transferred together (within 5 seconds)
- They're the primary data sources for the dashboard
- Taking GREATEST ensures we show the most recent sync time
- Other tables (User, new_mapping) are reference/lookup tables updated less frequently and not critical for "data freshness"

#### E.3 Final Production Query
```sql
-- Get the most recent data transfer time from table metadata
SELECT 
  GREATEST(
    COALESCE(
      (SELECT TIMESTAMP_MILLIS(last_modified_time) 
       FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__` 
       WHERE table_id = 'Lead'),
      TIMESTAMP('1900-01-01')
    ),
    COALESCE(
      (SELECT TIMESTAMP_MILLIS(last_modified_time) 
       FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__` 
       WHERE table_id = 'Opportunity'),
      TIMESTAMP('1900-01-01')
    )
  ) as last_updated,
  TIMESTAMP_DIFF(
    CURRENT_TIMESTAMP(),
    GREATEST(
      COALESCE(
        (SELECT TIMESTAMP_MILLIS(last_modified_time) 
         FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__` 
         WHERE table_id = 'Lead'),
        TIMESTAMP('1900-01-01')
      ),
      COALESCE(
        (SELECT TIMESTAMP_MILLIS(last_modified_time) 
         FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__` 
         WHERE table_id = 'Opportunity'),
        TIMESTAMP('1900-01-01')
      )
    ),
    HOUR
  ) as hours_ago,
  TIMESTAMP_DIFF(
    CURRENT_TIMESTAMP(),
    GREATEST(
      COALESCE(
        (SELECT TIMESTAMP_MILLIS(last_modified_time) 
         FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__` 
         WHERE table_id = 'Lead'),
        TIMESTAMP('1900-01-01')
      ),
      COALESCE(
        (SELECT TIMESTAMP_MILLIS(last_modified_time) 
         FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__` 
         WHERE table_id = 'Opportunity'),
        TIMESTAMP('1900-01-01')
      )
    ),
    MINUTE
  ) as minutes_ago
```

**Simplified Alternative** (if subqueries are slow):
```sql
-- Simpler version using a single query with UNION
SELECT 
  MAX(last_data_load) as last_updated,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), HOUR) as hours_ago,
  TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), MAX(last_data_load), MINUTE) as minutes_ago
FROM (
  SELECT TIMESTAMP_MILLIS(last_modified_time) as last_data_load
  FROM `savvy-gtm-analytics.SavvyGTMData.__TABLES__`
  WHERE table_id IN ('Lead', 'Opportunity')
)
```

#### E.4 API Response Format
```json
{
  "lastUpdated": "2026-01-16T20:39:22.827Z",
  "source": "table_metadata",
  "tablesChecked": ["Lead", "Opportunity"],
  "individualTables": {
    "Lead": "2026-01-16T20:39:22.827Z",
    "Opportunity": "2026-01-16T20:39:17.894Z"
  },
  "hoursAgo": 0,
  "minutesAgo": 16,
  "isStale": false,
  "status": "fresh"
}
```

### F. Summary

**Key Finding**: 
✅ **Table Metadata (`__TABLES__.last_modified_time`) is the correct source** for data freshness because it shows **when data was last synced from Salesforce to BigQuery**, which is what users want to know.

**The "Data Last Updated" indicator should show**: 
The timestamp from `__TABLES__.last_modified_time` for Lead and Opportunity tables (taking the GREATEST), which represents **when the most recent data transfer completed**.

**This tells users**: 
"Your dashboard data was last synced from Salesforce at [timestamp]. Any changes you made in Salesforce after this time may not yet be reflected in the dashboard."

**Example Message**:
- If transfer completed at 3:39 PM: "Data last synced: 3:39 PM ET" or "Updated 16 minutes ago"
- If transfer is > 24 hours old: "⚠ Data last synced: Jan 15, 2026 at 3:39 PM ET" (with warning styling)

**Previous Recommendation Correction**:
The initial recommendation to use `MAX(LastModifiedDate)` was **incorrect** for this use case. While it shows when records were modified in Salesforce, it doesn't answer "when was the last sync?" - it answers "what's the newest record we have?". Table metadata is the correct approach.
