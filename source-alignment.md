# Source Alignment - Final_Source__c Migration

## Executive Summary

This migration involves two major changes to `vw_funnel_master.sql`:

1. **Source Field Migration**: Switch from `LeadSource` to `Final_Source__c` for tracking lead/opportunity sources
2. **Channel Mapping Migration**: Replace `new_mapping` table join with direct use of `Finance_View__c` field from Salesforce records

**Key Benefits:**
- Channel groupings now come directly from Salesforce (`Finance_View__c`), eliminating the need to maintain a separate mapping table
- "Fintrx (Self-Sourced)" already maps to "Outbound" in Salesforce (no table changes needed)
- Backward compatible - all output field names remain the same (`Original_source`, `Channel_Grouping_Name`)

## Overview
This document outlines the changes needed to:
1. Switch from `Original_source__c` (LeadSource) to `Final_Source__c` in the funnel master view
2. Replace the `new_mapping` table join with direct use of `Finance_View__c` from Lead and Opportunity tables
3. Map `Finance_View__c` to `Channel_Grouping_Name` field (keeping field name for backward compatibility)
4. Ensure the dashboard continues to work without breaking changes

## Investigation Summary

### Current State
- **View**: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
- **Current Source Field**: Uses `LeadSource` from both Lead and Opportunity tables (aliased as `Lead_Original_Source` and `Opp_Original_Source`)
- **Target Source Field**: `Final_Source__c` exists in both `savvy-gtm-analytics.SavvyGTMData.Lead` and `savvy-gtm-analytics.SavvyGTMData.Opportunity`
- **Current Channel Mapping**: Uses `savvy-gtm-analytics.SavvyGTMData.new_mapping` table with a LEFT JOIN on `Original_source`
- **Target Channel Mapping**: Use `Finance_View__c` directly from Lead and Opportunity tables (no table join needed)

### Key Findings

#### Source Field (Final_Source__c)
1. **Final_Source__c exists** in both Lead and Opportunity tables
2. **Current view already selects** `Final_Source__c` as `Final_Source` from Lead (line 26) but doesn't use it
3. **"Fintrx (Self-Sourced)"** exists in the data with 120 Lead records and 2 Opportunity records

#### Channel Mapping (Finance_View__c)
4. **Finance_View__c exists** in both Lead and Opportunity tables
5. **Channel mapping** currently joins to `new_mapping` table on `Original_source` field (lines 167-173)
6. **Finance_View__c values found**:
   - **Lead table**: "Outbound" (120 records for "Fintrx (Self-Sourced)"), "Recruitment Firm" (2,545 records), "Employee Referral" (9 records), "Partnerships", "Re-Engagement", "Marketing", etc.
   - **Opportunity table**: "Recruitment Firm" (755 records), "Employee Referral" (6 records), and other values
7. **"Fintrx (Self-Sourced)" mapping**: Already has `Finance_View__c = "Outbound"` in Salesforce (120 Lead records confirmed, 2 Opportunity records have NULL)
8. **Finance_View__c coverage**: 
   - Lead: ~2,179 records have Finance_View__c populated (out of 95,186 total) - ~2.3% coverage
   - Opportunity: ~2,662 records have Finance_View__c populated (out of 2,767 total) - ~96.2% coverage
   - **NULL handling required**: Use COALESCE with default to 'Other' for records without Finance_View__c
9. **Advantage of using Finance_View__c**: Channel groupings come directly from Salesforce records, eliminating the need to maintain a separate mapping table. Changes in Salesforce automatically reflect in the view.

## Implementation Steps

### Step 1: Update vw_funnel_master.sql View

**Note:** No changes needed to `new_mapping` table - we're replacing the table join with direct use of `Finance_View__c` from Salesforce records.

The view needs to be updated to:
1. Use `Final_Source__c` instead of `LeadSource` for source tracking
2. Use `Finance_View__c` directly instead of joining to `new_mapping` table for channel grouping

Here are the specific changes:

#### Change 1: Update Lead_Base CTE (Line 25-26)
**Current:**
```sql
LeadSource AS Lead_Original_Source,
Final_Source__c AS Final_Source,
```

**Change to:**
```sql
Final_Source__c AS Lead_Original_Source,  -- Using Final_Source__c instead of LeadSource
Final_Source__c AS Final_Source,
Finance_View__c AS Lead_Finance_View__c,  -- NEW: Add Finance_View__c for channel mapping
```

#### Change 2: Update Opp_Base CTE (Line 57)
**Current:**
```sql
LeadSource AS Opp_Original_Source,
```

**Change to:**
```sql
Final_Source__c AS Opp_Original_Source,  -- Using Final_Source__c instead of LeadSource
Finance_View__c AS Opp_Finance_View__c,  -- NEW: Add Finance_View__c for channel mapping
```

#### Change 3: Update Combined CTE (Line 120)
**Current:**
```sql
--##TODO## Work with Kenji when we update Final Source to move from Original Source to Final Source
COALESCE(o.Opp_Original_Source, l.Lead_Original_Source, 'Unknown') AS Original_source,
```

**Change to:**
```sql
-- Using Final_Source__c from both Lead and Opportunity
COALESCE(o.Opp_Original_Source, l.Lead_Original_Source, 'Unknown') AS Original_source,
-- NEW: Add Finance_View__c for channel mapping (prefer Opportunity over Lead, default to 'Other')
COALESCE(o.Opp_Finance_View__c, l.Lead_Finance_View__c, 'Other') AS Finance_View__c,
```

**Note:** Since we're already changing the aliases in Lead_Base and Opp_Base to use `Final_Source__c`, the `Original_source` field will automatically use `Final_Source__c` values. The field name `Original_source` is kept to maintain backward compatibility with the dashboard.

#### Change 4: Replace With_Channel_Mapping CTE (Lines 167-173)

**Current:**
```sql
With_Channel_Mapping AS (
  SELECT
    c.*,
    IFNULL(nm.Channel_Grouping_Name, 'Other') AS Channel_Grouping_Name
  FROM Combined c
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm
    ON c.Original_source = nm.original_source
),
```

**Change to:**
```sql
With_Channel_Mapping AS (
  SELECT
    c.*,
    -- Use Finance_View__c directly from Combined CTE (which comes from Lead/Opp records)
    -- Keep field name as Channel_Grouping_Name for backward compatibility
    IFNULL(c.Finance_View__c, 'Other') AS Channel_Grouping_Name
  FROM Combined c
),
```

**Note:** This removes the dependency on the `new_mapping` table entirely. The channel grouping now comes directly from Salesforce `Finance_View__c` field on each record.

#### Change 5: Update With_SGA_Lookup CTE reference

No changes needed - the CTE name and structure remain the same, it just now receives `Channel_Grouping_Name` from `Finance_View__c` instead of the `new_mapping` table.

### Step 2: Verify the Changes

After making the changes, run these verification queries:

#### Check that Final_Source__c values are being used:
```sql
SELECT 
  Original_source,
  Channel_Grouping_Name,
  COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Original_source IS NOT NULL
GROUP BY Original_source, Channel_Grouping_Name
ORDER BY count DESC
LIMIT 50;
```

#### Verify "Fintrx (Self-Sourced)" maps to "Outbound":
```sql
SELECT 
  Original_source,
  Channel_Grouping_Name,
  COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Original_source = 'Fintrx (Self-Sourced)'
GROUP BY Original_source, Channel_Grouping_Name;
```

**Expected Result:** Should show `Channel_Grouping_Name = 'Outbound'` for "Fintrx (Self-Sourced)" records.

#### Check Finance_View__c coverage and NULL handling:
```sql
SELECT 
  Original_source,
  Channel_Grouping_Name,
  COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Channel_Grouping_Name = 'Other' OR Channel_Grouping_Name IS NULL
GROUP BY Original_source, Channel_Grouping_Name
ORDER BY count DESC;
```

#### Verify Finance_View__c values are being used:
```sql
SELECT 
  Channel_Grouping_Name,
  COUNT(*) as count,
  COUNT(DISTINCT Original_source) as distinct_sources
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Channel_Grouping_Name IS NOT NULL
GROUP BY Channel_Grouping_Name
ORDER BY count DESC;
```

**Expected Result:** Should show channel groupings like "Outbound", "Recruitment Firm", "Partnerships", "Re-Engagement", "Marketing", etc. (matching Finance_View__c values from Salesforce).

## Complete SQL Changes

### File: views/vw_funnel_master.sql

**Line 25-27 (Lead_Base CTE):**
```sql
-- OLD:
LeadSource AS Lead_Original_Source,
Final_Source__c AS Final_Source,

-- NEW:
Final_Source__c AS Lead_Original_Source,  -- Changed from LeadSource to Final_Source__c
Final_Source__c AS Final_Source,
Finance_View__c AS Lead_Finance_View__c,  -- NEW: Add Finance_View__c for channel mapping
```

**Line 57-58 (Opp_Base CTE):**
```sql
-- OLD:
LeadSource AS Opp_Original_Source,

-- NEW:
Final_Source__c AS Opp_Original_Source,  -- Changed from LeadSource to Final_Source__c
Finance_View__c AS Opp_Finance_View__c,  -- NEW: Add Finance_View__c for channel mapping
```

**Line 120-122 (Combined CTE):**
```sql
-- OLD:
--##TODO## Work with Kenji when we update Final Source to move from Original Source to Final Source
COALESCE(o.Opp_Original_Source, l.Lead_Original_Source, 'Unknown') AS Original_source,

-- NEW:
-- Using Final_Source__c from both Lead and Opportunity (via aliases in CTEs above)
COALESCE(o.Opp_Original_Source, l.Lead_Original_Source, 'Unknown') AS Original_source,
-- Using Finance_View__c from both Lead and Opportunity for channel mapping
COALESCE(o.Opp_Finance_View__c, l.Lead_Finance_View__c, 'Other') AS Finance_View__c,
```

**Lines 167-173 (With_Channel_Mapping CTE):**
```sql
-- OLD:
With_Channel_Mapping AS (
  SELECT
    c.*,
    IFNULL(nm.Channel_Grouping_Name, 'Other') AS Channel_Grouping_Name
  FROM Combined c
  LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm
    ON c.Original_source = nm.original_source
),

-- NEW:
With_Channel_Mapping AS (
  SELECT
    c.*,
    -- Use Finance_View__c directly from Combined CTE (comes from Salesforce records)
    -- Keep field name as Channel_Grouping_Name for backward compatibility
    IFNULL(c.Finance_View__c, 'Other') AS Channel_Grouping_Name
  FROM Combined c
),
```

## Impact Analysis

### Backward Compatibility
- ✅ **Field name preserved**: The output field `Original_source` remains the same, so dashboard filters and calculations won't break
- ✅ **Channel field name preserved**: The output field `Channel_Grouping_Name` remains the same, so dashboard filters and calculations won't break
- ✅ **No breaking changes**: Only the source of the data changes:
  - Source: from `LeadSource` to `Final_Source__c`
  - Channel: from `new_mapping` table join to `Finance_View__c` field directly
- ✅ **CTE structure unchanged**: The CTE names and flow remain the same, only the data sources change

### Expected Behavior Changes
- The view will now show `Final_Source__c` values instead of `LeadSource` values
- The view will now show `Finance_View__c` values instead of `new_mapping` table values for channel grouping
- "Fintrx (Self-Sourced)" will now show "Outbound" channel grouping (from `Finance_View__c` in Salesforce)
- Records with NULL `Finance_View__c` will show as "Other" channel grouping
- Channel groupings will now reflect what's in Salesforce `Finance_View__c` field, not what's in the `new_mapping` table

## Testing Checklist

- [ ] Update `vw_funnel_master.sql` with all five changes above:
  - [ ] Change 1: Add `Finance_View__c` to Lead_Base CTE
  - [ ] Change 2: Add `Finance_View__c` to Opp_Base CTE
  - [ ] Change 3: Add `Finance_View__c` to Combined CTE
  - [ ] Change 4: Replace `With_Channel_Mapping` CTE to use `Finance_View__c` directly
  - [ ] Change 5: Update source fields from `LeadSource` to `Final_Source__c`
- [ ] Deploy the updated view
- [ ] Verify "Fintrx (Self-Sourced)" appears in the view with "Outbound" channel (from `Finance_View__c`)
- [ ] Check that dashboard filters still work (field names unchanged)
- [ ] Verify channel groupings match `Finance_View__c` values from Salesforce
- [ ] Check NULL handling - records with NULL `Finance_View__c` should show as "Other"
- [ ] Compare record counts before/after to ensure no data loss
- [ ] Test dashboard visualizations to ensure they render correctly
- [ ] Verify no dependency on `new_mapping` table (can be removed/ignored going forward)

## Rollback Plan

If issues arise, revert the view changes:

1. **Revert source field changes**: Change back to using `LeadSource` instead of `Final_Source__c` in Lead_Base and Opp_Base CTEs
2. **Revert channel mapping**: Change `With_Channel_Mapping` CTE back to joining to `new_mapping` table
3. **Remove Finance_View__c fields**: Remove the `Finance_View__c` fields from Lead_Base, Opp_Base, and Combined CTEs
4. **Note**: No changes needed to `new_mapping` table - it can remain as-is for rollback purposes

## Notes

- **No `new_mapping` table changes needed**: We're replacing the table join entirely with direct use of `Finance_View__c` from Salesforce records
- **Finance_View__c is the source of truth**: Channel groupings now come directly from Salesforce, not from a mapping table
- **NULL handling**: Records with NULL `Finance_View__c` will default to "Other" channel grouping
- **"Fintrx (Self-Sourced)" mapping**: Already exists in Salesforce as `Finance_View__c = "Outbound"` (120 Lead records confirmed)
- The TODO comment on line 119 can be removed after this change is implemented
- The `Final_Source` field in Lead_Base (line 26) is kept for potential future use but is not currently used in the view
- **Future maintenance**: Channel groupings are now managed in Salesforce via `Finance_View__c` field, not in the `new_mapping` table
