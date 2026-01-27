# Dashboard Channel Mapping Update

## Issue
After updating `vw_funnel_master` to use `Finance_View__c` directly instead of the `new_mapping` table, the Funnel Performance dashboard needs to be updated to match.

**Problem**: When clicking "Marketing" in Channel Performance, only some sources (LinkedIn Savvy, LinkedIn Ads, Blog) show up in Source Performance, but "Direct Traffic" (which should be in Marketing channel) doesn't appear.

## Root Cause
The queries in `src/lib/queries/source-performance.ts` were still:
1. Joining to the `new_mapping` table
2. Using `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')` which tried to use the mapping table first

Since the view now provides `Channel_Grouping_Name` directly from `Finance_View__c`, these joins and COALESCE statements are no longer needed and were causing incorrect filtering.

## Changes Made

### File: `src/lib/queries/source-performance.ts`

#### 1. Removed MAPPING_TABLE import
```typescript
// OLD:
import { FULL_TABLE, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';

// NEW:
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants';
```

#### 2. Updated `_getChannelPerformance` function
- **Removed** LEFT JOIN to `new_mapping` table
- **Changed** `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')` to `v.Channel_Grouping_Name`
- **Updated** WHERE clause condition from `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') IS NOT NULL` to `v.Channel_Grouping_Name IS NOT NULL`
- **Updated** GROUP BY clause to use `v.Channel_Grouping_Name` directly

#### 3. Updated `_getSourcePerformance` function
- **Removed** LEFT JOIN to `new_mapping` table
- **Changed** channel filter condition from `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') = @channel` to `v.Channel_Grouping_Name = @channel`
- **Changed** SELECT clause from `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel` to `v.Channel_Grouping_Name as channel`
- **Updated** GROUP BY clause to use `v.Channel_Grouping_Name` directly

## Verification

Confirmed via BigQuery that:
- "Direct Traffic" has `Channel_Grouping_Name = 'Marketing'` (591 records)
- The view is correctly returning channel groupings from `Finance_View__c`

## Expected Behavior After Fix

1. **Channel Performance table**: Shows channels based on `Finance_View__c` values from Salesforce
2. **Source Performance table**: When a channel is clicked, it immediately refetches sources with that channel filter applied at the query level (not just client-side filtering)
3. **"Direct Traffic" in Marketing**: Should now appear when "Marketing" channel is selected, since it has `Finance_View__c = 'Marketing'` in Salesforce
4. **No cross-channel sources**: Sources from other channels (like "Recruitment Firm" or "Re-Engagement") should NOT appear when filtering by "Marketing"

## Additional Fix: Immediate Channel Filter Application

### File: `src/app/dashboard/page.tsx`

Updated `handleChannelClick` to immediately apply the channel filter and refetch sources:

```typescript
// OLD:
const handleChannelClick = (channel: string | null) => {
  setSelectedChannel(channel);
  setSelectedSource(null);
  setFilters(prev => ({
    ...prev,
    channel: channel,
    source: null,
  }));
};

// NEW:
const handleChannelClick = (channel: string | null) => {
  setSelectedChannel(channel);
  setSelectedSource(null);
  const updatedFilters = {
    ...appliedFilters,
    channel: channel,
    source: null,
  };
  setFilters(updatedFilters);
  setAppliedFilters(updatedFilters); // Immediately apply to trigger refetch with channel filter
};
```

**Why this fix was needed**: Previously, clicking a channel only updated the `filters` state (which requires clicking "Apply" to take effect), and sources were filtered client-side. This could cause sources from other channels to appear if there were data inconsistencies. Now, clicking a channel immediately updates `appliedFilters` and triggers a refetch with the channel filter applied at the database query level, ensuring only sources with that channel are returned.

## Additional Fix: Detail Records Query

### File: `src/lib/queries/detail-records.ts`

Updated to use `Channel_Grouping_Name` directly from the view:

1. **Removed MAPPING_TABLE import**
2. **Updated channel filter** to use `v.Channel_Grouping_Name = @channel` instead of `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') = @channel`
3. **Updated SELECT clause** to use `v.Channel_Grouping_Name as channel` instead of `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel`
4. **Removed LEFT JOIN** to `new_mapping` table

**Why this fix was needed**: When clicking "Marketing" in Channel Performance, the Record Details table should show all records (e.g., all 12 SQOs) from the Marketing channel. Previously, it was still using the old mapping table join which could cause incorrect filtering.

## Additional Fix: Funnel Metrics Query

### File: `src/lib/queries/funnel-metrics.ts`

Updated to use `Channel_Grouping_Name` directly from the view:

1. **Removed MAPPING_TABLE import**
2. **Updated channel filter** to use `v.Channel_Grouping_Name = @channel` instead of `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') = @channel`
3. **Removed LEFT JOIN** to `new_mapping` table from main metrics query
4. **Removed LEFT JOIN** to `new_mapping` table from open pipeline query

**Why this fix was needed**: When filtering by Channel = "Recruitment Firm", the query was using the old COALESCE pattern which could cause incorrect filtering. Now it uses `v.Channel_Grouping_Name` directly, which matches the view's logic.

**Expected behavior**: When selecting Channel = "Recruitment Firm" and Q4 2025, you should see 22 SQOs (matching the Source = "Recruitment Firm" filter). For comparison, "Re-Engagement" channel and source has 23 SQOs in Q4 2025.

## Additional Fix: Filter Options Query

### File: `src/app/api/dashboard/filters/route.ts`

Updated the channel filter options query to use `Channel_Grouping_Name` directly and use `FilterDate` instead of `stage_entered_contacting__c`:

1. **Removed MAPPING_TABLE import**
2. **Updated channelsQuery**:
   - Removed LEFT JOIN to `new_mapping` table
   - Changed to use `v.Channel_Grouping_Name` directly
   - Changed date filter from `stage_entered_contacting__c` to `FilterDate` (more inclusive - includes records without contacting stage)
3. **Updated sourcesQuery**: Changed date filter from `stage_entered_contacting__c` to `FilterDate`
4. **Updated sgasQuery**: Changed date filter from `stage_entered_contacting__c` to `FilterDate`
5. **Updated experimentationTagsQuery**: Changed date filter from `stage_entered_contacting__c` to `FilterDate`

**Why this fix was needed**: 
- The old query used `stage_entered_contacting__c` which excluded records that don't have that field populated (like opportunities created directly, or older records)
- "Recruitment Firm" has 419 total records, but only 89 with `stage_entered_contacting__c` in the last 2 years
- With `FilterDate` filter, "Recruitment Firm" has 395 records in the last 2 years, so it will now appear in the dropdown

## Additional Files That May Need Updates

The following files also reference `MAPPING_TABLE` and may need similar updates in the future:
- `src/lib/queries/funnel-metrics.ts`
- `src/lib/queries/conversion-rates.ts`
- ~~`src/lib/queries/detail-records.ts`~~ ✅ **UPDATED**
- ~~`src/lib/queries/funnel-metrics.ts`~~ ✅ **UPDATED**
- `src/lib/queries/drill-down.ts`
- `src/lib/queries/export-records.ts`
- `src/lib/queries/open-pipeline.ts`
- `src/lib/queries/quarterly-progress.ts`
- `src/lib/queries/record-detail.ts`
- `src/lib/semantic-layer/query-compiler.ts`
- `src/lib/semantic-layer/query-templates.ts`
- ~~`src/app/api/dashboard/filters/route.ts`~~ ✅ **UPDATED**

**Note**: These files may still work correctly if they're using the COALESCE pattern, but they should be updated to use `v.Channel_Grouping_Name` directly for consistency and to remove unnecessary joins.

## Testing Checklist

- [ ] Click "Marketing" in Channel Performance table
- [ ] Verify "Direct Traffic" appears in Source Performance table
- [ ] Verify all sources with `Finance_View__c = 'Marketing'` appear
- [ ] Test other channels (Outbound, Recruitment Firm, etc.)
- [ ] Verify channel filtering works correctly in all dashboard views
- [ ] Check that no errors appear in browser console
- [ ] Verify export functionality still works

## Rollback Plan

If issues arise:
1. Revert changes to `src/lib/queries/source-performance.ts`
2. Restore the LEFT JOIN to `new_mapping` table
3. Restore `COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other')` pattern
