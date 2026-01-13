TASK: Update C:\Users\russe\Documents\Dashboard\advanced-filters-implementation-agentic.md with critical corrections
The validation queries and codebase review revealed several issues that must be fixed before the plan can be executed. Apply ALL of the following corrections:

CORRECTION 1: TIMESTAMP vs DATE Field Handling
Location: All SQL queries throughout the document
Problem: Plan doesn't account for TIMESTAMP vs DATE type differences, causing runtime errors.
Field Type Reference:
TIMESTAMP fields (use TIMESTAMP() wrapper):
- stage_entered_contacting__c
- mql_stage_entered_ts
- Date_Became_SQO__c
- Opp_CreatedDate
- FilterDate
- lead_closed_date
- CreatedDate

DATE fields (direct comparison OK):
- Initial_Call_Scheduled_Date__c
- Qualification_Call_Date__c
- advisor_join_date__c
- converted_date_raw
Fix Pattern:
sql-- WRONG (will error):
WHERE stage_entered_contacting__c >= DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR)

-- CORRECT:
WHERE stage_entered_contacting__c >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))

-- DATE fields are fine as-is:
WHERE Initial_Call_Scheduled_Date__c >= @startDate
Update the filter-helpers.ts section to handle both types:
typescript// For Initial_Call_Scheduled_Date__c (DATE type) - direct comparison
if (filters.initialCallScheduled.enabled) {
  if (filters.initialCallScheduled.startDate) {
    whereClauses.push(`Initial_Call_Scheduled_Date__c >= @${paramPrefix}_initial_start`);
    params[`${paramPrefix}_initial_start`] = filters.initialCallScheduled.startDate;
  }
  if (filters.initialCallScheduled.endDate) {
    whereClauses.push(`Initial_Call_Scheduled_Date__c <= @${paramPrefix}_initial_end`);
    params[`${paramPrefix}_initial_end`] = filters.initialCallScheduled.endDate;
  }
}

// For Qualification_Call_Date__c (DATE type) - direct comparison
if (filters.qualificationCallDate.enabled) {
  if (filters.qualificationCallDate.startDate) {
    whereClauses.push(`Qualification_Call_Date__c >= @${paramPrefix}_qual_start`);
    params[`${paramPrefix}_qual_start`] = filters.qualificationCallDate.startDate;
  }
  if (filters.qualificationCallDate.endDate) {
    whereClauses.push(`Qualification_Call_Date__c <= @${paramPrefix}_qual_end`);
    params[`${paramPrefix}_qual_end`] = filters.qualificationCallDate.endDate;
  }
}

CORRECTION 2: Remove SGA/SGM Role Filtering from Dropdown Queries
Location: Phase 2 - Filter Options API queries
Problem: Filtering by IsSGA__c = TRUE excludes valid users who appear in the data but don't have the flag set. Examples from validation:

Arianna Butler: appears in SGA_Owner_Name__c but IsSGA__c = false
Bre McDaniel: appears in SGA_Owner_Name__c but IsSGA__c = false
Corey Marcello: appears in SGA_Owner_Name__c but IsSGA__c = false

Fix: Query directly from the view's name fields without role filtering:
Replace SGA query with:
sql-- Get all SGAs who appear in the data (not filtered by role flag)
SELECT 
  SGA_Owner_Name__c AS value,
  COUNT(*) AS record_count
FROM `${FULL_TABLE}`
WHERE SGA_Owner_Name__c IS NOT NULL
  AND SGA_Owner_Name__c != 'Savvy Operations'
  AND stage_entered_contacting__c >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
GROUP BY SGA_Owner_Name__c
ORDER BY record_count DESC
Replace SGM query with:
sql-- Get all SGMs who appear in the data (not filtered by role flag)
SELECT 
  SGM_Owner_Name__c AS value,
  COUNT(DISTINCT Full_Opportunity_ID__c) AS record_count
FROM `${FULL_TABLE}`
WHERE SGM_Owner_Name__c IS NOT NULL
  AND Full_Opportunity_ID__c IS NOT NULL
  AND Opp_CreatedDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
GROUP BY SGM_Owner_Name__c
ORDER BY record_count DESC
Remove all JOINs with the User table from dropdown queries - they're not needed.

CORRECTION 3: Fix Constant Names
Location: All SQL queries and code references
Find and Replace:

TABLES.FUNNEL_MASTER → FULL_TABLE
TABLES.MAPPING → MAPPING_TABLE

Example:
typescript// WRONG:
FROM \`${TABLES.FUNNEL_MASTER}\`

// CORRECT:
FROM \`${FULL_TABLE}\`

CORRECTION 4: Fix Type Names
Location: All TypeScript type references
Find and Replace:

FunnelViewType → ViewMode
'full' (as view value) → 'fullFunnel'
'sql+' → 'focused'

Example:
typescript// WRONG:
funnelView: FunnelViewType = 'full'
const showInitialCallFilter = funnelView === 'full';

// CORRECT:
viewMode: ViewMode = 'fullFunnel'
const showInitialCallFilter = viewMode === 'fullFunnel';
```

---

### CORRECTION 5: Extend Existing Files, Don't Create New

**Location**: Phase 1 and Phase 2 instructions

**Problem**: Plan creates new files that already exist

**Fix for Phase 1 (Types)**:
```
WRONG: "Create new file src/types/filters.ts"
CORRECT: "Extend existing file src/types/filters.ts"

Add to existing FilterOption interface:
  count?: number;  // ADD this property

Add to existing DashboardFilters interface:
  advancedFilters?: AdvancedFilters;  // ADD this property (optional for backward compatibility)

Add NEW interfaces (DateRangeFilter, MultiSelectFilter, AdvancedFilters) to the EXISTING file.
```

**Fix for Phase 2 (API)**:
```
WRONG: "Create new file src/app/api/dashboard/filter-options/route.ts"
CORRECT: "Extend existing file src/app/api/dashboard/filters/route.ts"

The existing route already has queries for channels, sources, sgas, sgms.
Update the existing queries to include COUNT(*) and return counts.
Keep the existing GET method.

CORRECTION 6: Fix API Method
Location: Phase 2 and Phase 6
Problem: Plan suggests POST for filter options, but existing route uses GET
Fix:

Keep /api/dashboard/filters as GET (for fetching filter options)
Data-fetching routes like /api/dashboard/funnel-metrics use POST (this is correct)


CORRECTION 7: Update MCP Validation Queries
Location: All MCP verification sections
Update all validation queries to use correct TIMESTAMP syntax:
sql-- Channel count validation (FIXED)
SELECT 
  Channel_Grouping_Name AS value,
  COUNT(*) AS record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Channel_Grouping_Name IS NOT NULL
  AND stage_entered_contacting__c >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
GROUP BY Channel_Grouping_Name
ORDER BY record_count DESC;
-- EXPECTED: 7 rows

-- SGA count validation (FIXED - no User table JOIN)
SELECT 
  SGA_Owner_Name__c AS value,
  COUNT(*) AS record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c IS NOT NULL
  AND SGA_Owner_Name__c != 'Savvy Operations'
  AND stage_entered_contacting__c >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
GROUP BY SGA_Owner_Name__c
ORDER BY record_count DESC;
-- EXPECTED: ~17 SGAs

-- SGM count validation (FIXED - no User table JOIN)
SELECT 
  SGM_Owner_Name__c AS value,
  COUNT(DISTINCT Full_Opportunity_ID__c) AS record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGM_Owner_Name__c IS NOT NULL
  AND Full_Opportunity_ID__c IS NOT NULL
  AND Opp_CreatedDate >= TIMESTAMP(DATE_SUB(CURRENT_DATE(), INTERVAL 2 YEAR))
GROUP BY SGM_Owner_Name__c
ORDER BY record_count DESC;
-- EXPECTED: ~9 SGMs

-- Initial Call filter validation (DATE field - no TIMESTAMP needed)
SELECT COUNT(*) as filtered_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Initial_Call_Scheduled_Date__c >= '2026-01-01'
  AND Initial_Call_Scheduled_Date__c <= '2026-01-12';
-- EXPECTED: 57

-- Qualification Call filter validation (DATE field - no TIMESTAMP needed)  
SELECT COUNT(DISTINCT Full_Opportunity_ID__c) as filtered_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Qualification_Call_Date__c >= '2026-01-01'
  AND Qualification_Call_Date__c <= '2026-01-12';
-- EXPECTED: 18

CORRECTION 8: Add Field Type Reference Table
Location: Add as new section after "Data Context"
Add this reference table for developers:
markdown## Field Type Reference (Critical for SQL)

| Field Name | Data Type | Comparison Pattern |
|------------|-----------|-------------------|
| `stage_entered_contacting__c` | TIMESTAMP | `>= TIMESTAMP(@param)` |
| `mql_stage_entered_ts` | TIMESTAMP | `>= TIMESTAMP(@param)` |
| `converted_date_raw` | DATE | `>= @param` |
| `Date_Became_SQO__c` | TIMESTAMP | `>= TIMESTAMP(@param)` |
| `Opp_CreatedDate` | TIMESTAMP | `>= TIMESTAMP(@param)` |
| `advisor_join_date__c` | DATE | `>= @param` |
| `FilterDate` | TIMESTAMP | `>= TIMESTAMP(@param)` |
| `Initial_Call_Scheduled_Date__c` | DATE | `>= @param` |
| `Qualification_Call_Date__c` | DATE | `>= @param` |
| `lead_closed_date` | TIMESTAMP | `>= TIMESTAMP(@param)` |
| `CreatedDate` | TIMESTAMP | `>= TIMESTAMP(@param)` |

**Rule**: TIMESTAMP fields require `TIMESTAMP()` wrapper when comparing to date strings or DATE_SUB results.

CORRECTION 9: Update Expected Dropdown Counts
Location: Appendix and verification sections
Update expected counts based on validation results:
FilterExpected CountSourceChannels7ValidatedSources~24ValidatedSGAs~17Validated (without role filter)SGMs~9Validated (without role filter)

VERIFICATION AFTER CORRECTIONS
After applying all corrections, verify the document by checking:

Search for TABLES.FUNNEL_MASTER - should find 0 results
Search for FunnelViewType - should find 0 results
Search for 'full' as view value - should find 0 results (except in prose)
Search for IsSGA__c - should find 0 results in dropdown queries
Search for JOIN.*User - should find 0 results in dropdown queries
All TIMESTAMP field comparisons should have TIMESTAMP() wrapper


END OF CORRECTIONS
Apply all corrections to C:\Users\russe\Documents\Dashboard\advanced-filters-implementation-agentic.md and confirm when complete.
