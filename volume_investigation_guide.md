# Conversion Trends Volume Display - Investigation & Fix Guide

## Overview

**Issue**: The Conversion Trends chart volume display is showing incorrect numbers and has confusing cohort/periodic logic. We need to simplify volumes to show only **periodic volumes** - the actual count of events that occurred in each time period.

**Expected Values for Validation**:
| Quarter | SQLs | SQOs | Joined |
|---------|------|------|--------|
| Q4 2025 | 193  | 144  | 17     |
| Q3 2025 | 221  | 133  | 15     |

**Current Problem**: When viewing volumes:
- Periodic view shows: 193 SQL, 114 SQO, 6 Joined (WRONG for SQO and Joined)
- Cohort view shows: 193 SQL, 144 SQO, 6 Joined (WRONG for Joined)

**Goal**: Simplify volume display to always show periodic volumes only - the count of events that actually occurred in each period, regardless of cohort/periodic toggle.

---

## Investigation Instructions

> **IMPORTANT**: Throughout this investigation, append all findings, query results, and code snippets to a file called `volume_answers.md` in the root directory of the project. Create this file at the start and maintain it as a running log.

---

## Phase 1: Initialize Investigation Log

### Prompt 1.1: Create the Investigation Log

```
Create a file called `volume_answers.md` in the root directory of the project with the following initial content:

# Volume Investigation Log

**Date**: [Current Date]
**Issue**: Conversion Trends volume display showing incorrect values
**Expected Q4 2025**: 193 SQL, 144 SQO, 17 Joined
**Expected Q3 2025**: 221 SQL, 133 SQO, 15 Joined

---

## Investigation Progress

[Findings will be logged here as we progress through each phase]
```

---

## Phase 2: Validate Ground Truth Data in BigQuery

### Prompt 2.1: Validate Q4 2025 SQL Count

```
Using your MCP connection to BigQuery, run the following query and log the results to volume_answers.md:

SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw >= '2025-10-01' 
  AND converted_date_raw <= '2025-12-31'

Expected: 193 SQLs

Log the result under "## Phase 2: Ground Truth Validation" in volume_answers.md
```

### Prompt 2.2: Validate Q4 2025 SQO Count

```
Using your MCP connection to BigQuery, run the following query and log the results to volume_answers.md:

SELECT COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Date_Became_SQO__c >= '2025-10-01' 
  AND Date_Became_SQO__c <= '2025-12-31'
  AND is_sqo_unique = TRUE
  AND recordtypeid = '012Dn000000mrO3IAI'

Expected: 144 SQOs

Log the result under "## Phase 2: Ground Truth Validation" in volume_answers.md
```

### Prompt 2.3: Validate Q4 2025 Joined Count

```
Using your MCP connection to BigQuery, run the following query and log the results to volume_answers.md:

SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_join_date__c >= '2025-10-01' 
  AND advisor_join_date__c <= '2025-12-31'
  AND is_joined_unique = TRUE

Expected: 17 Joined

Log the result under "## Phase 2: Ground Truth Validation" in volume_answers.md
```

### Prompt 2.4: Validate Q3 2025 Values

```
Using your MCP connection to BigQuery, run the following queries and log ALL results to volume_answers.md:

-- Q3 2025 SQLs
SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw >= '2025-07-01' 
  AND converted_date_raw <= '2025-09-30';

-- Q3 2025 SQOs
SELECT COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Date_Became_SQO__c >= '2025-07-01' 
  AND Date_Became_SQO__c <= '2025-09-30'
  AND is_sqo_unique = TRUE
  AND recordtypeid = '012Dn000000mrO3IAI';

-- Q3 2025 Joined
SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_join_date__c >= '2025-07-01' 
  AND advisor_join_date__c <= '2025-09-30'
  AND is_joined_unique = TRUE;

Expected: 221 SQL, 133 SQO, 15 Joined

Log all results under "## Phase 2: Ground Truth Validation" in volume_answers.md
```

---

## Phase 3: Understand Current Code Structure

### Prompt 3.1: Examine the Main Query File

```
Read the file `src/lib/queries/conversion-rates.ts` and log the following to volume_answers.md under "## Phase 3: Current Code Analysis":

1. List all exported functions in this file
2. Identify which function(s) are used for the conversion trends chart
3. Copy the FULL SQL query used in getConversionTrends() function
4. Note any parameters or logic that distinguishes "cohort" vs "periodic" views
5. Identify how volumes are calculated (numerator counts)
```

### Prompt 3.2: Examine the Trend Chart Component

```
Read the file `src/components/dashboard/ConversionTrendChart.tsx` and log the following to volume_answers.md:

1. How does the component handle the "volumes" toggle?
2. What data fields does it expect for volume display?
3. Is there any client-side transformation of volume data?
4. What props does it receive related to view mode (cohort/periodic)?
5. Copy any relevant code snippets that handle volume display
```

### Prompt 3.3: Examine the API Route

```
Read the file `src/app/api/dashboard/conversion-trends/route.ts` (or similar path for conversion trends API) and log the following to volume_answers.md:

1. What parameters does it accept?
2. How does it call the query function?
3. Does it transform data before returning?
4. Is there any cohort/periodic logic in the API layer?
```

### Prompt 3.4: Examine Types and Interfaces

```
Read the relevant type definitions in `src/types/dashboard.ts` and `src/types/bigquery-raw.ts`. Log to volume_answers.md:

1. What is the structure of ConversionTrendDataPoint (or similar)?
2. What volume-related fields exist in the types?
3. Are there separate fields for cohort vs periodic volumes?
```

### Prompt 3.5: Examine the Correct Scorecard Query

```
In `src/lib/queries/conversion-rates.ts`, find and examine the `getConversionRates()` function (this is the CORRECT implementation used for scorecards). Log to volume_answers.md:

1. How does it calculate SQL, SQO, and Joined counts?
2. What date fields does it use for each metric?
3. What deduplication logic does it apply?
4. Copy the relevant SQL snippets for volume calculations
```

---

## Phase 4: Identify the Discrepancy

### Prompt 4.1: Compare Volume Calculations

```
Based on your analysis in Phase 3, create a comparison table in volume_answers.md under "## Phase 4: Discrepancy Analysis":

| Metric | Scorecard Query Logic | Trend Chart Query Logic | Difference |
|--------|----------------------|------------------------|------------|
| SQL    | [describe]           | [describe]             | [describe] |
| SQO    | [describe]           | [describe]             | [describe] |
| Joined | [describe]           | [describe]             | [describe] |

Specifically identify:
1. Which date field is used for filtering each metric
2. Whether deduplication (is_sqo_unique, is_joined_unique) is applied
3. Whether recordtypeid filter is applied for SQO
4. Any cohort restrictions that might limit counts
```

### Prompt 4.2: Trace the Data Flow

```
Document the complete data flow in volume_answers.md:

1. User selects Q4 2025 and clicks "Volumes" toggle
2. What API endpoint is called?
3. What query function is invoked?
4. What SQL is executed?
5. How is the response transformed?
6. What reaches the chart component?
7. How is it rendered?

Identify at which step(s) the volume counts diverge from expected values.
```

---

## Phase 5: Design the Fix

### Prompt 5.1: Define the Correct Volume Query

```
Based on the ground truth queries from Phase 2 and the correct scorecard logic from Phase 3, write the CORRECT SQL query that should be used for periodic volumes. Log to volume_answers.md under "## Phase 5: Solution Design":

The query should:
1. Group by time period (quarter/month/year based on granularity)
2. Count SQLs filtered by converted_date_raw within the period
3. Count SQOs filtered by Date_Became_SQO__c within the period, with is_sqo_unique=TRUE and recordtypeid filter
4. Count Joined filtered by advisor_join_date__c within the period, with is_joined_unique=TRUE

Provide the complete SQL query that returns periodic volumes by time period.
```

### Prompt 5.2: Validate the Fix Query

```
Using your MCP connection to BigQuery, run your proposed fix query for 2025 data and log results to volume_answers.md:

The query should return quarterly volumes for 2025. Verify:
- Q4 2025: 193 SQL, 144 SQO, 17 Joined
- Q3 2025: 221 SQL, 133 SQO, 15 Joined

Log the actual results and confirm they match expected values.
```

### Prompt 5.3: Plan Code Changes

```
Based on all findings, document the required code changes in volume_answers.md under "## Phase 5: Implementation Plan":

1. Changes needed in `src/lib/queries/conversion-rates.ts`:
   - Specific function(s) to modify
   - Old logic to remove
   - New logic to add
   
2. Changes needed in component(s):
   - Remove cohort/periodic toggle for volumes (or simplify)
   - Update data field references if needed

3. Changes needed in API route (if any):
   - Parameter handling changes
   - Response transformation changes

4. Type changes needed (if any):
   - New fields
   - Removed fields
   - Modified interfaces
```

---

## Phase 6: Implementation

### Prompt 6.1: Implement Query Changes

```
Based on the implementation plan in Phase 5, modify `src/lib/queries/conversion-rates.ts`:

1. Create a new function `getPeriodicVolumes()` OR modify `getConversionTrends()` to include correct periodic volumes
2. The function should:
   - Accept date range and granularity parameters
   - Return periodic volumes (SQL, SQO, Joined) grouped by time period
   - Use the correct date fields for each metric
   - Apply proper deduplication and filters

After making changes, log the modified code to volume_answers.md under "## Phase 6: Implementation".
```

### Prompt 6.2: Update Component Logic

```
Modify `src/components/dashboard/ConversionTrendChart.tsx`:

1. When "volumes" is selected, display only periodic volumes
2. Remove or hide the cohort/periodic distinction for volume view
3. Ensure the chart displays the correct data fields

Log all component changes to volume_answers.md.
```

### Prompt 6.3: Update API if Needed

```
If the API route needs changes, update it to:

1. Call the correct query function for volumes
2. Return the expected data structure
3. Handle any new/changed parameters

Log all API changes to volume_answers.md.
```

---

## Phase 7: Validation

### Prompt 7.1: Test the Implementation

```
After implementing changes:

1. Start the development server (npm run dev)
2. Navigate to the dashboard
3. Select Q4 2025 date range
4. Click on "Volumes" toggle in conversion trends chart
5. Verify displayed values match:
   - SQL: 193
   - SQO: 144
   - Joined: 17

6. Change to Q3 2025 and verify:
   - SQL: 221
   - SQO: 133
   - Joined: 15

Log test results to volume_answers.md under "## Phase 7: Validation Results".
```

### Prompt 7.2: Test Edge Cases

```
Test additional scenarios and log results to volume_answers.md:

1. Test with monthly granularity - do volumes sum correctly?
2. Test with full year view - do all quarters show correct volumes?
3. Test with filters applied (channel, SGA) - do volumes still work?
4. Verify conversion rate display still works correctly when toggled back

Document any issues found.
```

---

## Phase 8: Final Documentation

### Prompt 8.1: Summarize Changes

```
Create a final summary in volume_answers.md under "## Phase 8: Summary":

1. Root cause of the original issue
2. All files modified
3. Key logic changes made
4. Validation results
5. Any remaining issues or future improvements needed
```

---

## Reference: Key Files to Examine

| File | Purpose |
|------|---------|
| `src/lib/queries/conversion-rates.ts` | Main query functions for conversion data |
| `src/lib/queries/funnel-metrics.ts` | Volume metrics queries |
| `src/components/dashboard/ConversionTrendChart.tsx` | Trend chart component |
| `src/app/api/dashboard/conversion-trends/route.ts` | API endpoint |
| `src/types/dashboard.ts` | Dashboard type definitions |
| `src/types/bigquery-raw.ts` | BigQuery result types |
| `src/lib/utils/date-helpers.ts` | Date range utilities |
| `src/config/constants.ts` | Table names and constants |

## Reference: Critical Constants

```typescript
// Table name
const TABLE = 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master';

// Record type for SQO (Recruiting)
const RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI';

// Date fields by metric
const DATE_FIELDS = {
  sql: 'converted_date_raw',
  sqo: 'Date_Became_SQO__c',
  joined: 'advisor_join_date__c'
};

// Deduplication fields
const DEDUP_FIELDS = {
  sqo: 'is_sqo_unique',
  joined: 'is_joined_unique'
};
```

## Reference: Expected Query Structure

```sql
-- Periodic Volumes Query Template
SELECT
  FORMAT_DATE('%Y-Q%Q', [DATE_FIELD]) as period,
  COUNT(DISTINCT CASE 
    WHEN converted_date_raw BETWEEN @startDate AND @endDate 
    THEN lead_id 
  END) as sql_count,
  COUNT(DISTINCT CASE 
    WHEN Date_Became_SQO__c BETWEEN @startDate AND @endDate 
      AND is_sqo_unique = TRUE 
      AND recordtypeid = '012Dn000000mrO3IAI'
    THEN opportunity_id 
  END) as sqo_count,
  COUNT(DISTINCT CASE 
    WHEN advisor_join_date__c BETWEEN @startDate AND @endDate 
      AND is_joined_unique = TRUE 
    THEN opportunity_id 
  END) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE [appropriate date filters]
GROUP BY period
ORDER BY period
```

---

## Troubleshooting Tips

1. **If BigQuery returns different counts**: Check that all filters (recordtypeid, is_sqo_unique, is_joined_unique) are properly applied

2. **If component doesn't update**: Check that the API response structure matches what the component expects

3. **If only some values are wrong**: Check which specific metric's date field or deduplication is incorrect

4. **If values change with filters**: Ensure filter logic is applied consistently to numerator counts

---

## Success Criteria

The fix is complete when:

- [ ] Q4 2025 volumes show: 193 SQL, 144 SQO, 17 Joined
- [ ] Q3 2025 volumes show: 221 SQL, 133 SQO, 15 Joined
- [ ] Volume display is simplified (no confusing cohort/periodic distinction)
- [ ] Conversion rate display still works correctly
- [ ] All changes are documented in volume_answers.md
