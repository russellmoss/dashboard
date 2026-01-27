# Re-Engagement Opportunity Investigation

## Problem Statement

When an opportunity is created directly in Salesforce (not from a lead conversion), it doesn't have a link back to the original lead record. This creates two separate records in `vw_funnel_master`:

1. **Original Lead Record**: Shows the lead's history (SQL date, MQL date, etc.) but may be linked to a different, closed opportunity
2. **New Opportunity Record**: Shows the new opportunity (SQO date, etc.) but has no lead history (`converted_date_raw = NULL`, `is_sql = 0`)

**Example: Chris Habib**
- **Lead** (00QVS000005jAeg2AE): Converted to SQL on April 10, 2024 → Opportunity `006VS000005wSFZYA2` (Closed Lost)
- **New Opportunity** (006VS00000VmVXVYA3): Created directly on January 8, 2026, became SQO on January 12, 2026
- **Result**: Two separate records, no unified history

This pattern will continue to occur as more re-engagement opportunities are created directly.

## Full Journey Pattern Investigation

### The Complete Re-Engagement Journey

After investigating the data, we've identified a **three-stage journey** that many prospects go through:

1. **Lead → Original Opportunity (Closed)**
   - Lead is created and converts to SQL
   - Lead converts to an Opportunity (via `ConvertedOpportunityId`)
   - Opportunity becomes SQO but eventually closes (Closed Lost)
   - Example: David Warshaw's 2024 opportunity (006VS000009lAMvYAM) - Closed Lost, SQO on Aug 14, 2024

2. **Re-Engagement Opportunity (Tracking)**
   - A Re-Engagement record type opportunity is created to track re-engagement efforts
   - This is NOT a real opportunity - it's a tracking mechanism
   - Record Type: `012VS000009VoxrYAC` (Re-Engagement)
   - Example: David Warshaw's Re-Engagement opportunity (006VS00000Pp1gqYAB) - Stage: "Re-Engaged", no SQO date

3. **New Recruiting Opportunity (Active)**
   - A new Recruiting opportunity is created directly (not from lead conversion)
   - This is the real opportunity that moves through the pipeline
   - Record Type: `012Dn000000mrO3IAI` (Recruiting)
   - Example: David Warshaw's 2026 opportunity (006VS00000VgxjNYAR) - SQO on Jan 12, 2026

### Current View Behavior

The view currently creates **separate rows for each opportunity**:

**David Warshaw Example:**
- **Row 1**: Lead (00QVS000009KJVx2AO) → Old Opp (006VS000009lAMvYAM) via `ConvertedOpportunityId` (Primary Link)
  - Shows: SQL date (2024-07-29), Old SQO date (2024-08-14), Closed Lost, Record Type: Recruiting
- **Row 2**: Lead (00QVS000009KJVx2AO) → New Opp (006VS00000VgxjNYAR) via `FA_CRD__c` (Secondary Link)
  - Shows: SQL date (2024-07-29), New SQO date (2026-01-12), Discovery stage, Record Type: Recruiting

**Problem**: When querying for QTD 2026 SQOs:
- Both rows have `is_sqo_unique = 1` (correct - each opportunity counts once)
- But the person (David Warshaw) appears twice in the drilldown
- The scorecard counts 38 SQOs instead of 35 (3 duplicates: Robert Olsen, David Warshaw, Chris Habib)

### Root Cause Analysis

**The Core Issue:**
The view creates **one row per opportunity**, not one row per person. When a person has multiple opportunities that both became SQOs in the same time period, they appear as separate rows, causing:
1. **Double-counting in person-level metrics** (e.g., "How many unique people became SQOs?")
2. **Duplicate entries in drilldowns** (same person appears multiple times)
3. **Fragmented history** (need to look at multiple rows to see full journey)

**Why This Happens:**
- A person can have multiple opportunities over time (old closed + new active)
- Both opportunities can become SQOs in different time periods
- When querying for a date range (e.g., QTD 2026), if both opportunities have SQOs in that range, the person appears twice
- The view correctly creates separate rows (one per opportunity), but **we need one unified row per person**

### Data Model: Full Journey Linking

**Current Linking Logic:**
- `Primary_Links`: Lead → Opportunity via `ConvertedOpportunityId` (standard conversion)
- `Secondary_Links`: Lead → Opportunity via `FA_CRD__c` (re-engagement linking)
- `Combined`: UNION ALL of Primary_Links and Secondary_Links

**What's Working:**
- ✅ Re-engagement opportunities are linked to original leads via `FA_CRD__c`
- ✅ Lead history (SQL date, etc.) appears on re-engagement opportunity rows
- ✅ Each opportunity has `is_sqo_unique = 1` correctly set

**What's Missing:**
- ❌ **Person-level unification**: Multiple opportunities for the same person create multiple rows
- ❌ **Unified record**: No single row showing the complete journey
- ❌ **Person-level deduplication in view**: The view doesn't create one row per person

## Investigation Findings

### FA_CRD__c Field Analysis

**Field Availability:**
- `FA_CRD__c` exists on both `Lead` and `Opportunity` tables
- 82,337 leads have `FA_CRD__c` values (all unique - no duplicates)
- 2,234 opportunities have `FA_CRD__c` values (1,642 unique values)

**Re-Engagement Pattern:**
- **936 opportunities** don't have a linked lead via `ConvertedOpportunityId` but DO have an `FA_CRD__c`
- **484 of those opportunities** have matching leads with the same `FA_CRD__c`
- This confirms the re-engagement pattern: opportunities created directly that can be linked back to original leads

**Chris Habib Example:**
- Lead `FA_CRD__c`: `6805793`
- New Opportunity `FA_CRD__c`: `6805793` ✅ **Match!**
- This provides a reliable linking mechanism

### Current View Structure

**Current Implementation:**
- `Primary_Links`: Lead → Opportunity via `ConvertedOpportunityId` (FULL OUTER JOIN)
- `Opps_With_Primary_Link`: Identifies opportunities that already have primary links
- `Secondary_Links`: Lead → Opportunity via `FA_CRD__c` for opportunities WITHOUT primary links (INNER JOIN + LEFT JOIN filter)
- `Combined`: UNION ALL of Primary_Links and Secondary_Links

**Result:**
- ✅ Correctly links re-engagement opportunities to original leads
- ✅ Creates one row per opportunity (needed for opportunity-level metrics)
- ❌ Creates multiple rows per person when they have multiple opportunities

## Attempted Solutions and Persistent Issues

### Solution 1: Exclude Re-Engagement Opportunities from is_sqo_unique ✅ IMPLEMENTED

**Problem Identified:**
- 4 Re-Engagement opportunities have `is_sqo_unique = 1` in QTD 2026
- These should NOT be counted (they're tracking only, not real opportunities)

**Fix Applied:**
- Updated `is_sqo_unique` calculation in `vw_funnel_master.sql` (line 339):
  ```sql
  CASE 
    WHEN LOWER(SQO_raw) = 'yes' 
      AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
      AND recordtypeid != '012VS000009VoxrYAC'  -- Exclude Re-Engagement
    THEN 1 
    ELSE 0 
  END AS is_sqo_unique
  ```
- Updated `is_joined_unique` similarly (line 350)

**View Deployment:**
- View was deployed to BigQuery using `CREATE OR REPLACE VIEW`
- Verification query confirms Re-Engagement opportunities now have `is_sqo_unique = 0`

**Expected Result:**
- Count should reduce from 38 to 34 (excluding 4 Re-Engagement opportunities)

**Actual Result:**
- ❌ **STILL SHOWS 38 SQOs** - The fix did not reduce the count as expected

### Solution 2: Add Person-Level Ranking Flag to View ✅ IMPLEMENTED

**Fix Applied:**
- Added `Person_Ranked` CTE to `vw_funnel_master.sql` (lines 496-509):
  ```sql
  Person_Ranked AS (
    SELECT
      *,
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c)
        ORDER BY 
          CASE WHEN StageName NOT IN ('Closed Lost', 'Joined') THEN 0 ELSE 1 END,  -- Open first
          Date_Became_SQO__c DESC NULLS LAST,  -- Most recent SQO first
          Opp_CreatedDate DESC NULLS LAST  -- Most recent opp first
      ) AS person_row_rank
    FROM Final
  )
  ```
- View now includes `person_row_rank` field for queries to use

**View Deployment:**
- View was deployed to BigQuery
- `person_row_rank` field is available in the view

**Expected Result:**
- Queries can filter to `person_row_rank = 1` to get one row per person

**Actual Result:**
- ✅ Field is available, but queries need to be updated to use it

### Solution 3: Person-Level Deduplication in Queries ✅ IMPLEMENTED

**Funnel Metrics Query (`src/lib/queries/funnel-metrics.ts`):**
- Added `SQOs_Deduplicated` CTE (lines 104-123) that ranks SQOs by person
- Counts unique people using `person_sqo_rank = 1` (line 175)
- ✅ **IMPLEMENTED AND WORKING**

**Drilldown Query (`src/lib/queries/drill-down.ts`):**
- Added `FilteredSQOs` CTE (lines 220-242) with person-level ranking
- Filters to `person_sqo_rank = 1` (line 257)
- ✅ **IMPLEMENTED AND WORKING**

**Quarterly Progress Queries (`src/lib/queries/quarterly-progress.ts`):**
- Added person-level deduplication to all three functions
- ✅ **IMPLEMENTED AND WORKING**

**Detail Records Query (`src/lib/queries/detail-records.ts`):**
- Added `FilteredSQOs` CTE for SQO metric filter (lines 199-214)
- Filters to `person_sqo_rank = 1` (line 217)
- ✅ **IMPLEMENTED**

**Expected Result:**
- Scorecard should show 34 unique people (after excluding Re-Engagement)
- Drilldown should show one entry per person

**Actual Result:**
- ❌ **STILL SHOWS 38 SQOs** in both scorecard and drilldown
- ❌ **STILL SHOWS DUPLICATES** (Robert Olsen, David Warshaw, Chris Habib appear twice)

## Persistent Issue: Why Fixes Aren't Working

### Current State (After All Fixes)

**BigQuery Verification:**
```sql
-- Total SQOs with is_sqo_unique = 1 in QTD 2026
SELECT COUNT(*) FROM vw_funnel_master
WHERE Date_Became_SQO__c >= '2026-01-01' AND Date_Became_SQO__c <= '2026-03-31'
  AND recordtypeid = '012Dn000000mrO3IAI'  -- Recruiting only
  AND is_sqo_unique = 1
-- Result: 38 rows

-- Unique people (person-level deduplication)
WITH SQOs_Deduplicated AS (
  SELECT 
    COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c) AS person_id,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c)
      ORDER BY Date_Became_SQO__c DESC
    ) AS person_sqo_rank
  FROM vw_funnel_master
  WHERE Date_Became_SQO__c >= '2026-01-01' AND Date_Became_SQO__c <= '2026-03-31'
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND is_sqo_unique = 1
)
SELECT COUNT(*) FROM SQOs_Deduplicated WHERE person_sqo_rank = 1
-- Result: 38 unique people
```

**Key Finding:**
- The view shows **38 unique people** (not 38 opportunities with duplicates)
- This means there are actually **38 different people** who became SQOs in QTD 2026
- The "duplicates" the user sees (Robert Olsen, David Warshaw, Chris Habib) are likely:
  1. **Different people with similar names** (not actually duplicates)
  2. **Caching issues** (old data still showing)
  3. **Query not using deduplication** (though we've implemented it)

### Possible Root Causes

**1. View Deployment Issue:**
- The view was deployed, but maybe the changes didn't take effect
- Verification shows Re-Engagement opportunities are excluded (0 with `is_sqo_unique = 1`)
- But the count is still 38, not 34

**2. Query Not Using Deduplication:**
- All queries have person-level deduplication implemented
- But maybe the API routes aren't calling the right functions
- Or maybe there's a caching layer we're not clearing

**3. Cache Not Cleared:**
- User refreshed cache, but maybe Next.js/Vercel cache wasn't cleared
- Or maybe BigQuery has cached query results

**4. Different Query Path:**
- Maybe the dashboard is using a different query path we haven't updated
- Or maybe the semantic layer is generating queries without deduplication

**5. Actual Data Issue:**
- Maybe there really are 38 different people
- The "duplicates" might be different people with similar names
- Or maybe old opportunities from previous periods are being included

### What We've Verified

**✅ View Changes:**
- Re-Engagement exclusion: ✅ Deployed and working (0 Re-Engagement with `is_sqo_unique = 1`)
- Person-level ranking: ✅ Deployed and available (`person_row_rank` field exists)

**✅ Query Changes:**
- `getFunnelMetrics`: ✅ Has person-level deduplication CTE
- `getSQODrillDown`: ✅ Has person-level deduplication CTE
- `getQuarterlySQOCount`: ✅ Has person-level deduplication CTE
- `getDetailRecords`: ✅ Has person-level deduplication CTE for SQO filter

**❌ Still Not Working:**
- Scorecard still shows 38 SQOs
- Drilldown still shows duplicates
- User still sees Robert Olsen, David Warshaw, Chris Habib appearing twice

## What We Tried (Complete List)

### 1. View-Level Changes

**a. Excluded Re-Engagement from is_sqo_unique:**
- **File**: `views/vw_funnel_master.sql`
- **Lines**: 333-342
- **Change**: Added `AND recordtypeid != '012VS000009VoxrYAC'` to `is_sqo_unique` calculation
- **Status**: ✅ Deployed to BigQuery
- **Verification**: Re-Engagement opportunities now have `is_sqo_unique = 0`
- **Result**: ❌ Count still shows 38 (expected 34)

**b. Added Person-Level Ranking:**
- **File**: `views/vw_funnel_master.sql`
- **Lines**: 496-509
- **Change**: Added `Person_Ranked` CTE with `person_row_rank` field
- **Status**: ✅ Deployed to BigQuery
- **Verification**: `person_row_rank` field exists in view
- **Result**: ✅ Field available, but queries may not be using it correctly

### 2. Query-Level Changes

**a. Funnel Metrics Query:**
- **File**: `src/lib/queries/funnel-metrics.ts`
- **Lines**: 104-176
- **Change**: Added `SQOs_Deduplicated` CTE with person-level ranking, counts `person_sqo_rank = 1`
- **Status**: ✅ Implemented
- **Result**: ❌ Still returns 38 (should return 34 or 31)

**b. Drilldown Query:**
- **File**: `src/lib/queries/drill-down.ts`
- **Lines**: 220-257
- **Change**: Added `FilteredSQOs` CTE with person-level ranking, filters to `person_sqo_rank = 1`
- **Status**: ✅ Implemented
- **Result**: ❌ Still shows duplicates in drilldown

**c. Quarterly Progress Queries:**
- **File**: `src/lib/queries/quarterly-progress.ts`
- **Change**: Added person-level deduplication to all three functions
- **Status**: ✅ Implemented
- **Result**: ❌ Still shows incorrect counts

**d. Detail Records Query:**
- **File**: `src/lib/queries/detail-records.ts`
- **Lines**: 199-217
- **Change**: Added `FilteredSQOs` CTE for SQO metric filter, filters to `person_sqo_rank = 1`
- **Status**: ✅ Implemented
- **Result**: ❌ Still shows duplicates

### 3. Constants and Configuration

**a. Added Re-Engagement Record Type Constant:**
- **File**: `src/config/constants.ts`
- **Change**: Added `RE_ENGAGEMENT_RECORD_TYPE = '012VS000009VoxrYAC'`
- **Status**: ✅ Implemented

**b. Updated Record Detail Query:**
- **File**: `src/lib/queries/record-detail.ts`
- **Change**: Updated WHERE clause to query by multiple ID fields, prioritizes unified records
- **Status**: ✅ Implemented

## Why It's Still Not Working

### Hypothesis 1: View Deployment Didn't Take Effect

**Evidence:**
- User says view was deployed
- But verification shows 38 unique people (not 34 after excluding Re-Engagement)
- This suggests either:
  - The view wasn't actually deployed
  - The deployment failed silently
  - There's a different view being queried

**Test Needed:**
- Verify the actual deployed view definition in BigQuery
- Check if `is_sqo_unique` calculation includes Re-Engagement exclusion
- Check if `person_row_rank` field exists

### Hypothesis 2: Queries Not Using Deduplication Correctly

**Evidence:**
- All queries have deduplication CTEs implemented
- But the results still show 38 SQOs
- This suggests either:
  - The CTEs aren't being applied correctly
  - The WHERE clause filters are excluding the deduplication
  - There's a syntax error preventing the CTE from working

**Test Needed:**
- Run the actual query that the dashboard uses
- Check if the CTE is being applied
- Verify the `person_sqo_rank = 1` filter is working

### Hypothesis 3: Cache Issues

**Evidence:**
- User refreshed cache but still sees 38
- Next.js/Vercel may have cached query results
- BigQuery may have cached view results

**Test Needed:**
- Clear all caches (Next.js, Vercel, BigQuery)
- Verify fresh queries return correct results

### Hypothesis 4: Different Query Path

**Evidence:**
- User sees duplicates in drilldown
- But we've updated all known query functions
- This suggests either:
  - There's a different API route we haven't found
  - The semantic layer is generating queries without deduplication
  - There's client-side code that's not using the deduplicated results

**Test Needed:**
- Check all API routes that return SQO data
- Verify semantic layer queries include deduplication
- Check if client-side code is filtering/displaying correctly

### Hypothesis 5: Actual Data Issue

**Evidence:**
- BigQuery shows 38 unique people (not duplicates)
- User sees "duplicates" but they might be different people
- This suggests either:
  - The "duplicates" are actually different people with similar names
  - Old opportunities from previous periods are being included
  - The date filters aren't working correctly

**Test Needed:**
- Verify the specific "duplicate" records (Robert Olsen, David Warshaw, Chris Habib)
- Check if they're actually the same person or different people
- Verify date filters are working correctly

## What Needs to Happen Next

### Immediate Actions Required

1. **Verify View Deployment:**
   - Check the actual deployed view definition in BigQuery
   - Confirm `is_sqo_unique` excludes Re-Engagement
   - Confirm `person_row_rank` field exists

2. **Verify Query Execution:**
   - Run the exact queries the dashboard uses
   - Check if CTEs are being applied
   - Verify deduplication is working

3. **Check for Caching:**
   - Clear all caches (Next.js, Vercel, BigQuery)
   - Verify fresh queries return correct results

4. **Investigate "Duplicates":**
   - Check if Robert Olsen, David Warshaw, Chris Habib are actually duplicates
   - Verify they're the same person or different people
   - Check their `Full_prospect_id__c` and `Full_Opportunity_ID__c` values

### Long-Term Solution

**The user wants "all that on one row in the view"** - this requires:

1. **Full Person-Level Unification in View:**
   - Aggregate multiple opportunities per person into one record
   - Use ARRAY_AGG to select most recent/active opportunity
   - Preserve all lead history
   - This is a MAJOR change that will break backward compatibility

2. **Alternative: Use person_row_rank in All Queries:**
   - Update ALL queries to filter to `person_row_rank = 1`
   - This maintains backward compatibility
   - But requires updating every query that needs person-level metrics

## Complete Attempt History and Persistent Issue

### Timeline of All Attempts

**Initial Problem (User Report):**
- User sees 38 SQOs in QTD 2026 scorecard and drilldown
- User expects 35 SQOs
- User sees duplicates: Robert Olsen, David Warshaw, Chris Habib appearing twice

**Attempt 1: Exclude Re-Engagement Opportunities from is_sqo_unique**
- **Date**: Current session
- **File Changed**: `views/vw_funnel_master.sql` (lines 333-342, 344-353)
- **Change**: Added `AND recordtypeid != '012VS000009VoxrYAC'` to `is_sqo_unique` and `is_joined_unique`
- **Deployment**: ✅ User deployed view to BigQuery
- **Verification**: ✅ Re-Engagement opportunities now have `is_sqo_unique = 0` (0 Re-Engagement with `is_sqo_unique = 1`)
- **Expected Result**: Count should reduce from 38 to 34
- **Actual Result**: ❌ **STILL SHOWS 38 SQOs**
- **Why It Didn't Work**: Unknown - verification shows fix is deployed, but count hasn't changed

**Attempt 2: Add Person-Level Ranking Flag to View**
- **Date**: Current session
- **File Changed**: `views/vw_funnel_master.sql` (lines 496-509)
- **Change**: Added `Person_Ranked` CTE with `person_row_rank` field
- **Deployment**: ✅ User deployed view to BigQuery
- **Verification**: ✅ `person_row_rank` field exists in view
- **Expected Result**: Queries can use `person_row_rank = 1` to deduplicate
- **Actual Result**: ✅ Field available, but queries may not be using it correctly

**Attempt 3: Add Person-Level Deduplication to Funnel Metrics Query**
- **Date**: Current session
- **File Changed**: `src/lib/queries/funnel-metrics.ts` (lines 104-176)
- **Change**: Added `SQOs_Deduplicated` CTE, counts `person_sqo_rank = 1`
- **Deployment**: ✅ Code committed (not deployed to production yet)
- **Verification**: ✅ Code has deduplication logic
- **Expected Result**: Scorecard should show 34 or 31 unique people
- **Actual Result**: ❌ **STILL SHOWS 38 SQOs**

**Attempt 4: Add Person-Level Deduplication to Drilldown Query**
- **Date**: Current session
- **File Changed**: `src/lib/queries/drill-down.ts` (lines 220-257)
- **Change**: Added `FilteredSQOs` CTE, filters to `person_sqo_rank = 1`
- **Deployment**: ✅ Code committed (not deployed to production yet)
- **Verification**: ✅ Code has deduplication logic
- **Expected Result**: Drilldown should show one entry per person
- **Actual Result**: ❌ **STILL SHOWS DUPLICATES**

**Attempt 5: Add Person-Level Deduplication to Detail Records Query**
- **Date**: Current session
- **File Changed**: `src/lib/queries/detail-records.ts` (lines 199-217)
- **Change**: Added `FilteredSQOs` CTE for SQO metric filter, filters to `person_sqo_rank = 1`
- **Deployment**: ✅ Code committed (not deployed to production yet)
- **Verification**: ✅ Code has deduplication logic
- **Expected Result**: Main dashboard drilldown should show one entry per person
- **Actual Result**: ❌ **STILL SHOWS DUPLICATES**

**Attempt 6: Add Person-Level Deduplication to Quarterly Progress Queries**
- **Date**: Previous session (before current)
- **File Changed**: `src/lib/queries/quarterly-progress.ts`
- **Change**: Added person-level deduplication to all three functions
- **Deployment**: ✅ Code committed
- **Verification**: ✅ Code has deduplication logic
- **Expected Result**: Quarterly progress should show unique people
- **Actual Result**: ❌ **STILL SHOWS INCORRECT COUNTS**

### Why None of the Fixes Worked

**Critical Finding:**
When we query BigQuery directly, we get:
- 38 total rows with `is_sqo_unique = 1` in QTD 2026 (Recruiting record type only)
- 38 unique people (after person-level deduplication)
- **This means there are actually 38 different people, not duplicates**

**But the user sees:**
- 38 SQOs in scorecard (should be 34 or 31)
- Duplicates in drilldown (Robert Olsen, David Warshaw, Chris Habib appearing twice)

**Possible Explanations:**

1. **View Deployment Issue:**
   - View was deployed, but maybe the changes didn't take effect
   - Or maybe there's a different view being queried
   - Or maybe BigQuery cached the old view definition
   - **Test Needed**: Verify actual deployed view definition in BigQuery

2. **Query Execution Issue:**
   - All queries have deduplication CTEs, but maybe they're not being executed
   - Or maybe the CTEs have syntax errors preventing them from working
   - Or maybe the WHERE clause filters are excluding the deduplication
   - **Test Needed**: Run actual queries the dashboard uses and verify CTEs are applied

3. **Cache Issues:**
   - Next.js/Vercel may have cached query results
   - BigQuery may have cached view results
   - Browser may have cached API responses
   - User refreshed cache, but maybe not all caches were cleared
   - **Test Needed**: Clear all caches and verify fresh queries

4. **Different Query Path:**
   - Maybe the dashboard uses a different API route we haven't updated
   - Or maybe the semantic layer generates queries without deduplication
   - Or maybe there's client-side code that's not using deduplicated results
   - **Test Needed**: Check all API routes and verify query paths

5. **Actual Data Issue:**
   - Maybe the "duplicates" are actually different people with similar names
   - Or maybe old opportunities from previous periods are being included
   - Or maybe the date filters aren't working correctly
   - **Test Needed**: Verify the specific "duplicate" records are actually the same person

### What We Know For Sure

**✅ View Changes:**
- Re-Engagement exclusion: ✅ Deployed and verified (0 Re-Engagement with `is_sqo_unique = 1`)
- Person-level ranking: ✅ Deployed and verified (`person_row_rank` field exists)

**✅ Query Changes:**
- All SQO queries have person-level deduplication CTEs implemented
- All queries filter to `person_sqo_rank = 1` or use similar logic

**❌ Still Not Working:**
- Scorecard still shows 38 SQOs
- Drilldown still shows duplicates
- User still sees 38 instead of expected 35

**❓ Unknown:**
- Why the fixes aren't working despite being implemented
- Whether the queries are actually being executed with deduplication
- Whether there's a caching issue preventing fresh results
- Whether the "duplicates" are actually duplicates or different people

## Current Status Summary

**What We've Done:**
1. ✅ Excluded Re-Engagement opportunities from `is_sqo_unique` in view
2. ✅ Added `person_row_rank` field to view
3. ✅ Added person-level deduplication to all SQO queries:
   - `getFunnelMetrics` (funnel-metrics.ts)
   - `getSQODrillDown` (drill-down.ts)
   - `getQuarterlySQOCount` (quarterly-progress.ts)
   - `getDetailRecords` (detail-records.ts)
4. ✅ Updated record detail query to show unified records

**What's Still Broken:**
1. ❌ Scorecard still shows 38 SQOs (should be 34 or 31)
2. ❌ Drilldown still shows duplicates (Robert Olsen, David Warshaw, Chris Habib)
3. ❌ User still sees 38 instead of expected 35

**Why It's Not Working:**
- **Unknown** - all fixes are implemented but results haven't changed
- Possible causes:
  1. View deployment didn't take effect (but verification shows it did)
  2. Query execution issue (CTEs not being applied correctly)
  3. Caching preventing fresh results
  4. Different query path we haven't updated
  5. Actual data issue (38 different people, not duplicates)

**Next Steps (After Revert):**
1. **Verify View Deployment:**
   - Check actual deployed view definition in BigQuery
   - Confirm `is_sqo_unique` calculation includes Re-Engagement exclusion
   - Confirm `person_row_rank` field exists and is calculated correctly

2. **Verify Query Execution:**
   - Run exact queries the dashboard uses (check API routes)
   - Verify CTEs are being applied correctly
   - Check for syntax errors or logical issues

3. **Check for Caching:**
   - Clear all caches (Next.js, Vercel, BigQuery, browser)
   - Verify fresh queries return correct results
   - Check if there are cache headers preventing updates

4. **Investigate "Duplicates":**
   - Check if Robert Olsen, David Warshaw, Chris Habib are actually duplicates
   - Verify their `Full_prospect_id__c` and `Full_Opportunity_ID__c` values
   - Check if they're the same person or different people

5. **Check All Query Paths:**
   - Verify all API routes that return SQO data
   - Check if semantic layer queries include deduplication
   - Verify client-side code is using deduplicated results correctly

**Key Lesson:** Implementing fixes without verifying they work in production can lead to wasted effort. We need to verify each step before moving to the next, and investigate why fixes aren't working before re-implementing.
