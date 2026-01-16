# Data Freshness Feature - Investigation Guide for Cursor.ai

## Overview

This document guides you through investigating the BigQuery setup and codebase to gather all information needed to implement a "Data Last Updated" indicator throughout the dashboard.

**Your Mission**: Answer all questions below and record your findings in a new file called `data_freshness_answers.md` in the project root directory.

**Important**: You have MCP access to BigQuery and can query it directly. Use this to explore metadata, schemas, and test queries.

---

## Instructions

1. Work through each section sequentially
2. Run the provided queries (modify as needed based on what you discover)
3. Record ALL findings in `data_freshness_answers.md` using the template provided at the end
4. Include actual query results, not just descriptions
5. Note any errors or unexpected results

---

## SECTION 1: BigQuery Metadata Discovery

### 1.1 Identify Available Datasets

**Goal**: Understand the dataset structure in the `savvy-gtm-analytics` project.

**Query to run**:
```sql
SELECT 
  schema_name as dataset_name,
  creation_time,
  last_modified_time
FROM `savvy-gtm-analytics.INFORMATION_SCHEMA.SCHEMATA`
ORDER BY schema_name;
```

**Record**: List all datasets and their last modified times.

---

### 1.2 Identify Tables in Key Datasets

**Goal**: Find all tables/views in the datasets we care about.

**Query to run**:
```sql
-- Tables in Tableau_Views dataset
SELECT 
  table_name,
  table_type,
  creation_time,
  -- Note: Views may not have last_modified_time populated the same way
  TIMESTAMP_MILLIS(last_modified_time) as last_modified
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.TABLES`
ORDER BY table_name;
```

```sql
-- Tables in SavvyGTMData dataset (source tables)
SELECT 
  table_name,
  table_type,
  creation_time,
  TIMESTAMP_MILLIS(last_modified_time) as last_modified
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.TABLES`
ORDER BY table_name;
```

**Record**: 
- List all tables/views in both datasets
- Note which are VIEWS vs BASE TABLES
- Note the `last_modified` timestamps

---

### 1.3 Check View Dependencies

**Goal**: Understand what tables `vw_funnel_master` depends on.

**Query to run**:
```sql
-- Get the view definition to see source tables
SELECT 
  table_name,
  view_definition
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.VIEWS`
WHERE table_name = 'vw_funnel_master';
```

**Record**: 
- The source tables referenced in the view
- This tells us which base tables to monitor for freshness

---

### 1.4 Check Source Table Metadata

**Goal**: Get last modified times for the actual source tables (likely Lead, Opportunity, etc.).

Based on what you found in 1.3, query the source tables. Example:

```sql
-- Check Lead table metadata (adjust table name if different)
SELECT 
  table_name,
  TIMESTAMP_MILLIS(last_modified_time) as last_modified,
  row_count,
  size_bytes
FROM `savvy-gtm-analytics.SavvyGTMData.INFORMATION_SCHEMA.TABLES`
WHERE table_name IN ('Lead', 'Opportunity', 'User')
ORDER BY last_modified DESC;
```

**Record**: 
- Exact table names for source data
- Their last modified timestamps
- This is likely what we'll use for the freshness indicator

---

## SECTION 2: Data Transfer/Job History

### 2.1 Check Recent Jobs

**Goal**: See if there are scheduled queries or data transfer jobs we can track.

**Query to run**:
```sql
-- Check recent jobs in the project (last 7 days)
SELECT 
  job_id,
  job_type,
  state,
  creation_time,
  start_time,
  end_time,
  destination_table.dataset_id,
  destination_table.table_id,
  total_bytes_processed
FROM `savvy-gtm-analytics.region-us.INFORMATION_SCHEMA.JOBS`
WHERE creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
  AND job_type = 'LOAD'  -- or 'QUERY' for scheduled queries
ORDER BY creation_time DESC
LIMIT 20;
```

**Note**: If this query fails due to permissions, record that. We may need to use table metadata instead.

**Record**:
- Whether job history is accessible
- Types of jobs running (LOAD, QUERY, etc.)
- Any patterns in timing (e.g., daily at midnight)

---

### 2.2 Check for Scheduled Queries

**Query to run**:
```sql
-- Alternative: Check if there are scheduled query configs
-- This may require different permissions
SELECT *
FROM `savvy-gtm-analytics.region-us.INFORMATION_SCHEMA.JOBS`
WHERE job_type = 'QUERY'
  AND creation_time > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 2 DAY)
  AND destination_table.table_id IS NOT NULL
ORDER BY creation_time DESC
LIMIT 10;
```

**Record**: Any scheduled queries that populate your tables.

---

## SECTION 3: Data Timestamps Within Tables

### 3.1 Check Maximum Timestamps in Source Data

**Goal**: Alternative approach - find the most recent record timestamps in the actual data.

**Query to run**:
```sql
-- Check the most recent data in vw_funnel_master
SELECT 
  MAX(FilterDate) as max_filter_date,
  MAX(CreatedDate) as max_created_date,
  MAX(converted_date_raw) as max_converted_date,
  COUNT(*) as total_records
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`;
```

```sql
-- If Lead table exists, check its timestamps
SELECT 
  MAX(CreatedDate) as max_created,
  MAX(LastModifiedDate) as max_modified,
  COUNT(*) as total_records
FROM `savvy-gtm-analytics.SavvyGTMData.Lead`;
```

```sql
-- Same for Opportunity table
SELECT 
  MAX(CreatedDate) as max_created,
  MAX(LastModifiedDate) as max_modified,
  COUNT(*) as total_records
FROM `savvy-gtm-analytics.SavvyGTMData.Opportunity`;
```

**Record**:
- Maximum timestamps found
- Whether `LastModifiedDate` exists and is populated
- This could be an alternative freshness indicator

---

## SECTION 4: Codebase Investigation

### 4.1 Current BigQuery Client Setup

**Goal**: Understand how the app currently connects to BigQuery.

**Files to examine**:
- `src/lib/bigquery.ts`
- `src/config/constants.ts`
- `.env.example` or `.env` (note: don't record actual secrets)

**Record**:
- How the BigQuery client is instantiated
- What constants are defined for table names
- Authentication method (service account file vs JSON env var)

---

### 4.2 Existing API Route Patterns

**Goal**: Understand the pattern used for dashboard API routes.

**Files to examine**:
- `src/app/api/dashboard/funnel-metrics/route.ts`
- `src/app/api/dashboard/filters/route.ts`
- Any other API route in `src/app/api/dashboard/`

**Record**:
- Pattern for creating API routes
- How errors are handled
- How BigQuery queries are executed
- Response format

---

### 4.3 Header Component Structure

**Goal**: Understand where to place the freshness indicator.

**Files to examine**:
- `src/components/layout/Header.tsx`
- `src/app/dashboard/layout.tsx`

**Record**:
- Current Header component structure
- Available space for a freshness indicator
- Any existing patterns for status indicators

---

### 4.4 GlobalFilters Component

**Goal**: Alternative placement location for freshness indicator.

**Files to examine**:
- `src/components/dashboard/GlobalFilters.tsx` (if it exists)
- Any filter-related components

**Record**:
- Whether GlobalFilters exists
- Its structure and where freshness could fit
- How it's used across dashboard pages

---

## SECTION 5: Determine Best Approach

Based on your findings, answer these questions:

### 5.1 Data Freshness Source

Which of these is the best source for "last updated" time?

| Option | Pros | Cons | Viable? |
|--------|------|------|---------|
| `INFORMATION_SCHEMA.TABLES.last_modified_time` on source tables | Accurate, reflects actual data changes | May not update for views | ? |
| `INFORMATION_SCHEMA.JOBS` history | Shows exact job completion times | May have permission issues | ? |
| `MAX(LastModifiedDate)` from Lead/Opportunity tables | Always accessible, reflects data state | Requires querying actual data | ? |

**Record**: Your recommendation and reasoning.

---

### 5.2 UI Placement

Where should the freshness indicator appear?

- [ ] Header component (visible on all pages)
- [ ] GlobalFilters component (visible on filter-enabled pages)
- [ ] Both locations
- [ ] Other: _______________

**Record**: Your recommendation based on codebase structure.

---

### 5.3 Caching Strategy

Should we cache the freshness check?

- [ ] No caching - always query fresh
- [ ] Cache for 5 minutes (reduces BQ calls)
- [ ] Cache for 1 hour (minimal BQ calls)
- [ ] Use React Query/SWR with stale-while-revalidate

**Record**: Your recommendation.

---

## SECTION 6: Edge Cases & Considerations

Answer these questions:

1. **What happens if the data is more than 24 hours old?**
   - Should we show a warning?
   - What color/style should indicate "stale" data?

2. **What timezone should we display?**
   - User's local timezone?
   - A specific timezone (ET, PT)?
   - UTC?

3. **What format should the timestamp use?**
   - "Jan 15, 2026 12:03 AM"
   - "2 hours ago"
   - "Today at 12:03 AM"
   - Relative when recent, absolute when older?

4. **Should we show different freshness for different data sources?**
   - e.g., "Lead data: 2 hours ago, Opportunity data: 4 hours ago"
   - Or just show the oldest/most recent?

**Record**: Your recommendations for each.

---

## Answer Template

Create a new file called `data_freshness_answers.md` in the project root with this structure:

```markdown
# Data Freshness Investigation Answers

**Investigation Date**: [DATE]
**Investigated By**: Cursor.ai

---

## Section 1: BigQuery Metadata Discovery

### 1.1 Available Datasets

**Query Result**:
\`\`\`
[PASTE ACTUAL QUERY RESULTS HERE]
\`\`\`

**Observations**: [Your notes]

### 1.2 Tables in Key Datasets

**Tableau_Views Dataset**:
\`\`\`
[PASTE ACTUAL QUERY RESULTS HERE]
\`\`\`

**SavvyGTMData Dataset**:
\`\`\`
[PASTE ACTUAL QUERY RESULTS HERE]
\`\`\`

**Observations**: [Your notes]

### 1.3 View Dependencies

**vw_funnel_master View Definition** (summarized):
[List the source tables referenced]

**Source Tables Identified**:
- Table 1: [name]
- Table 2: [name]
- etc.

### 1.4 Source Table Metadata

**Query Result**:
\`\`\`
[PASTE ACTUAL QUERY RESULTS HERE]
\`\`\`

**Key Finding**: The source tables were last modified at [TIMESTAMP].

---

## Section 2: Data Transfer/Job History

### 2.1 Recent Jobs

**Query Result** (or "Permission Denied" if inaccessible):
\`\`\`
[PASTE ACTUAL QUERY RESULTS HERE]
\`\`\`

**Observations**: [Your notes on job patterns]

### 2.2 Scheduled Queries

**Finding**: [What you discovered about scheduled queries]

---

## Section 3: Data Timestamps Within Tables

### 3.1 Maximum Timestamps

**vw_funnel_master**:
\`\`\`
[PASTE ACTUAL QUERY RESULTS HERE]
\`\`\`

**Lead Table**:
\`\`\`
[PASTE ACTUAL QUERY RESULTS HERE]
\`\`\`

**Opportunity Table**:
\`\`\`
[PASTE ACTUAL QUERY RESULTS HERE]
\`\`\`

**Observations**: [Your notes]

---

## Section 4: Codebase Investigation

### 4.1 BigQuery Client Setup

**File**: `src/lib/bigquery.ts`

**Key Findings**:
- Authentication method: [describe]
- Client instantiation pattern: [describe]
- Query execution helper: [describe]

**Relevant Code Snippet**:
\`\`\`typescript
[PASTE KEY CODE HERE]
\`\`\`

### 4.2 API Route Patterns

**Example Route Examined**: `src/app/api/dashboard/[route]/route.ts`

**Pattern**:
\`\`\`typescript
[PASTE PATTERN/STRUCTURE HERE]
\`\`\`

**Error Handling**: [describe]

### 4.3 Header Component Structure

**File**: `src/components/layout/Header.tsx`

**Current Structure**:
[Describe the layout and where freshness indicator could fit]

**Recommended Placement**: [Your recommendation]

### 4.4 GlobalFilters Component

**File**: [path if exists]

**Exists**: Yes/No

**Structure**: [Describe if exists]

---

## Section 5: Recommendations

### 5.1 Best Data Freshness Source

**Recommended Approach**: [Your recommendation]

**Reasoning**: [Why this approach is best]

**Query to Use**:
\`\`\`sql
[THE EXACT QUERY THAT SHOULD BE USED IN PRODUCTION]
\`\`\`

### 5.2 UI Placement

**Recommended Location**: [Header / GlobalFilters / Both / Other]

**Reasoning**: [Why]

### 5.3 Caching Strategy

**Recommended Strategy**: [Your recommendation]

**Reasoning**: [Why]

---

## Section 6: Edge Cases & Recommendations

### Stale Data Warning
- **Threshold**: [e.g., 24 hours]
- **Visual Treatment**: [e.g., yellow/orange warning color]

### Timezone
- **Recommendation**: [Which timezone to use]
- **Reasoning**: [Why]

### Timestamp Format
- **Recommendation**: [Format to use]
- **Examples**: 
  - Recent: "2 hours ago"
  - Older: "Jan 15, 2026 at 12:03 AM ET"

### Multiple Data Sources
- **Recommendation**: [Single timestamp vs multiple]
- **Reasoning**: [Why]

---

## Summary

**Best Approach for Data Freshness**:
[One paragraph summary of the recommended implementation approach]

**Key Query**:
\`\`\`sql
[The final query to use]
\`\`\`

**Expected Result Format**:
\`\`\`json
{
  "lastUpdated": "2026-01-15T05:03:00Z",
  "source": "Lead table metadata",
  "isStale": false
}
\`\`\`

---

## Additional Notes

[Any other observations, warnings, or suggestions]
```

---

## Completion Checklist

Before finishing, verify you have:

- [ ] Run all BigQuery metadata queries
- [ ] Examined all specified codebase files
- [ ] Answered all questions in Sections 5 and 6
- [ ] Created `data_freshness_answers.md` with complete findings
- [ ] Included actual query results (not placeholders)
- [ ] Provided clear recommendations with reasoning

---

## Next Steps

Once you've completed this investigation and created `data_freshness_answers.md`, the findings will be used to create a detailed implementation plan for the data freshness feature.
