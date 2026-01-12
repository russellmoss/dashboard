# Dashboard Conversion Mode Update - Cursor.ai Implementation Guide

## Overview

This guide provides step-by-step prompts and code snippets for Cursor.ai to update the dashboard's conversion rate calculation modes.

## ⚠️ Critical Fixes Applied to This Guide

This guide has been updated with the following critical fixes for safety and correctness:

1. **SQL Query Structure Fixed:**
   - Removed incorrect `filtered_data` CTE that caused table alias issues
   - Fixed table alias references to use `v.` consistently
   - Added proper `is_contacted = 1` and `is_mql = 1` checks

2. **Closed Lost Date Validation:**
   - Fixed SQL→SQO and SQO→Joined queries to check `Stage_Entered_Closed__c` is in period
   - Previously used `StageName = 'Closed Lost'` without date check (would include old closed records)
   - Now properly validates closed records happened within the period

3. **Period Function Nesting Fixed:**
   - Fixed `buildPeriodModeQuery()` to avoid nested `periodFn()` calls
   - Changed from complex `LEAST()` CASE statements to simple period comparisons
   - Uses direct period equality checks: `${periodFn('entry_date')} = ${periodFn('resolution_date')}`

4. **Pre-Execution Validation Added:**
   - Added prerequisite section to verify BigQuery view deployment
   - Added codebase state verification
   - Added backup branch recommendation

5. **Enhanced Verification Gates:**
   - Added testing recommendations after each major change
   - Added validation queries to verify logic correctness
   - Added comparison checks between Period and Cohort modes

6. **Dashboard State Variable Fixed:**
   - Corrected reference from `conversionMode` to `trendMode` (actual variable name)

### What We're Changing

| Change | Current | New |
|--------|---------|-----|
| Period Mode Logic | Includes ALL records (open + resolved) | Only records that **entered AND resolved** in same period |
| Default Mode | Period | **Cohort** |
| Toggle Order | Period (left), Cohort (right) | **Cohort (left)**, Period (right) |
| Tooltips | Basic descriptions | **Clear, detailed explanations** |
| Mode Names | "Period" and "Cohort" | Keep names, update descriptions |

### Mode Definitions (Final)

| Mode | Entry | Resolution | Best For |
|------|-------|------------|----------|
| **Period (Resolved)** | In Period X | Also in Period X | Current period snapshot, excludes in-flight |
| **Cohort (Mature)** | In Period X | Any time (matured) | Long-term funnel efficiency |

---

## File Locations

```
src/
├── lib/
│   └── queries/
│       └── conversion-rates.ts          # Query logic (MAIN CHANGES)
├── components/
│   └── dashboard/
│       ├── ConversionTrendChart.tsx     # Toggle UI + tooltips
│       └── ConversionRateCards.tsx      # Scorecard tooltips
├── app/
│   ├── dashboard/
│   │   └── page.tsx                     # Default mode state
│   └── api/
│       └── dashboard/
│           └── conversion-rates/
│               └── route.ts             # API default mode
└── types/
    └── dashboard.ts                     # Type definitions
```

---

## PREREQUISITE: Pre-Execution Validation

### Step 0.1: Verify BigQuery View Deployment

**⚠️ CRITICAL: Before executing Phase 1, verify that `vw_funnel_master` view is deployed to BigQuery with the `lead_closed_date` field.**

**Verification Query:**
```sql
-- Run this in BigQuery to verify lead_closed_date exists
SELECT 
  lead_closed_date,
  COUNT(*) as count
FROM \`savvy-gtm-analytics.Tableau_Views.vw_funnel_master\`
WHERE lead_closed_date IS NOT NULL
GROUP BY lead_closed_date
LIMIT 5;
```

**Expected:** Query should execute without errors. If it fails, deploy the updated `vw_funnel_master.sql` view first.

### Step 0.2: Verify Current Codebase State

**Before making changes, verify:**
```bash
# Ensure codebase compiles
npx tsc --noEmit

# Ensure build works
npm run build

# Check for any uncommitted critical changes
git status
```

**Expected:** No TypeScript errors, successful build, review any uncommitted changes.

### Step 0.3: Create Backup Branch (Recommended)

```bash
# Create a backup branch before making changes
git checkout -b backup/pre-period-resolved-implementation
git push origin backup/pre-period-resolved-implementation

# Return to main branch
git checkout main
```

**Note:** This allows easy rollback if needed.

---

## PHASE 1: Update Query Logic for Period-Resolved Mode

### Step 1.1: Update `getConversionRates()` Period Mode

**File:** `src/lib/queries/conversion-rates.ts`

**Cursor.ai Prompt:**
```
In the file src/lib/queries/conversion-rates.ts, find the getConversionRates() function.

Update the PERIOD MODE query logic to use "Period-Resolved" methodology:
- Records must ENTER the stage within the date range
- Records must also RESOLVE (progress to next stage OR close) within the same date range
- Use the new `lead_closed_date` field from vw_funnel_master for Lead-level closure
- For Opportunity-level closure, use `StageName = 'Closed Lost'` AND `Stage_Entered_Closed__c` in period

The key change is that denominators should now filter for resolution within the period, not just entry.

For Contacted→MQL:
- Denominator: Contacted in period AND (MQL'd in period OR lead_closed_date in period)
- Numerator: MQL'd in period (from contacted in period)

For MQL→SQL:
- Denominator: MQL'd in period AND (SQL'd in period OR lead_closed_date in period)
- Numerator: SQL'd in period (from MQL'd in period)

For SQL→SQO (Opportunity level):
- Denominator: SQL'd in period AND (SQO'd in period OR Closed Lost in period)
- Numerator: SQO'd in period

For SQO→Joined (Opportunity level):
- Denominator: SQO'd in period AND (Joined in period OR Closed Lost in period)
- Numerator: Joined in period

Keep the cohort mode logic unchanged - it's already correct.
```

**Code Snippet - Replace Period Mode Query in `getConversionRates()`:**

Find the section that starts with:
```typescript
if (mode === 'period') {
```

Replace the entire period mode query with:

```typescript
  if (mode === 'period') {
    // ═══════════════════════════════════════════════════════════════════════
    // PERIOD-RESOLVED MODE: Entry AND Resolution in Same Period
    // "What actually completed this period?" (excludes in-flight records)
    // ═══════════════════════════════════════════════════════════════════════
    query = `
      SELECT
        -- ═══════════════════════════════════════════════════════════════════
        -- CONTACTED → MQL (Period-Resolved)
        -- Denominator: Contacted in period AND resolved in period
        -- Resolution = MQL'd OR Closed (whichever came first)
        -- ═══════════════════════════════════════════════════════════════════
        COUNTIF(
          v.stage_entered_contacting__c IS NOT NULL
          AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          AND v.is_contacted = 1
          AND (
            -- Resolved by becoming MQL in period
            (v.mql_stage_entered_ts IS NOT NULL 
             AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate) 
             AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate))
            OR
            -- Resolved by being closed in period
            (v.lead_closed_date IS NOT NULL 
             AND TIMESTAMP(v.lead_closed_date) >= TIMESTAMP(@startDate) 
             AND TIMESTAMP(v.lead_closed_date) <= TIMESTAMP(@endDate))
          )
        ) as contacted_denom,
        
        COUNTIF(
          v.stage_entered_contacting__c IS NOT NULL
          AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          AND v.is_contacted = 1
          AND v.mql_stage_entered_ts IS NOT NULL
          AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
        ) as contacted_numer,

        -- ═══════════════════════════════════════════════════════════════════
        -- MQL → SQL (Period-Resolved)
        -- Denominator: MQL'd in period AND resolved in period
        -- Resolution = SQL'd (converted) OR Closed
        -- ═══════════════════════════════════════════════════════════════════
        COUNTIF(
          v.mql_stage_entered_ts IS NOT NULL
          AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          AND v.is_mql = 1
          AND (
            -- Resolved by becoming SQL in period
            (v.converted_date_raw IS NOT NULL 
             AND DATE(v.converted_date_raw) >= DATE(@startDate) 
             AND DATE(v.converted_date_raw) <= DATE(@endDate))
            OR
            -- Resolved by being closed in period
            (v.lead_closed_date IS NOT NULL 
             AND TIMESTAMP(v.lead_closed_date) >= TIMESTAMP(@startDate) 
             AND TIMESTAMP(v.lead_closed_date) <= TIMESTAMP(@endDate))
          )
        ) as mql_denom,
        
        COUNTIF(
          v.mql_stage_entered_ts IS NOT NULL
          AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          AND v.is_mql = 1
          AND v.converted_date_raw IS NOT NULL
          AND DATE(v.converted_date_raw) >= DATE(@startDate)
          AND DATE(v.converted_date_raw) <= DATE(@endDate)
        ) as mql_numer,

        -- ═══════════════════════════════════════════════════════════════════
        -- SQL → SQO (Period-Resolved)
        -- Denominator: SQL'd in period AND resolved in period
        -- Resolution = SQO'd OR Closed Lost (Opportunity level, must be in period)
        -- ═══════════════════════════════════════════════════════════════════
        COUNTIF(
          v.converted_date_raw IS NOT NULL
          AND DATE(v.converted_date_raw) >= DATE(@startDate)
          AND DATE(v.converted_date_raw) <= DATE(@endDate)
          AND v.is_sql = 1
          AND v.recordtypeid = @recruitingRecordType
          AND (
            -- Resolved by becoming SQO in period
            (LOWER(v.SQO_raw) = 'yes' 
             AND v.Date_Became_SQO__c IS NOT NULL
             AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
             AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate))
            OR
            -- Resolved by being closed lost in period (use Stage_Entered_Closed__c)
            (v.StageName = 'Closed Lost' 
             AND v.Stage_Entered_Closed__c IS NOT NULL
             AND TIMESTAMP(v.Stage_Entered_Closed__c) >= TIMESTAMP(@startDate) 
             AND TIMESTAMP(v.Stage_Entered_Closed__c) <= TIMESTAMP(@endDate))
          )
        ) as sql_denom,
        
        COUNTIF(
          v.converted_date_raw IS NOT NULL
          AND DATE(v.converted_date_raw) >= DATE(@startDate)
          AND DATE(v.converted_date_raw) <= DATE(@endDate)
          AND v.is_sql = 1
          AND LOWER(v.SQO_raw) = 'yes'
          AND v.Date_Became_SQO__c IS NOT NULL
          AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
          AND v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
        ) as sql_numer,

        -- ═══════════════════════════════════════════════════════════════════
        -- SQO → JOINED (Period-Resolved)
        -- Denominator: SQO'd in period AND resolved in period
        -- Resolution = Joined OR Closed Lost (must be in period)
        -- ═══════════════════════════════════════════════════════════════════
        COUNTIF(
          LOWER(v.SQO_raw) = 'yes'
          AND v.Date_Became_SQO__c IS NOT NULL
          AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
          AND v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
          AND (
            -- Resolved by joining in period
            (v.advisor_join_date__c IS NOT NULL 
             AND DATE(v.advisor_join_date__c) >= DATE(@startDate) 
             AND DATE(v.advisor_join_date__c) <= DATE(@endDate))
            OR
            -- Resolved by being closed lost in period (use Stage_Entered_Closed__c)
            (v.StageName = 'Closed Lost' 
             AND v.Stage_Entered_Closed__c IS NOT NULL
             AND TIMESTAMP(v.Stage_Entered_Closed__c) >= TIMESTAMP(@startDate) 
             AND TIMESTAMP(v.Stage_Entered_Closed__c) <= TIMESTAMP(@endDate))
          )
        ) as sqo_denom,
        
        COUNTIF(
          LOWER(v.SQO_raw) = 'yes'
          AND v.Date_Became_SQO__c IS NOT NULL
          AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
          AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate)
          AND v.recordtypeid = @recruitingRecordType
          AND v.is_sqo_unique = 1
          AND v.advisor_join_date__c IS NOT NULL
          AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
          AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
          AND v.is_joined_unique = 1
        ) as sqo_numer

      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm
        ON v.Original_source = nm.original_source
      WHERE 1=1 ${filterWhereClause}
    `;
  }
```

### ⚠️ VERIFICATION GATE 1.1

After making this change, run:
```bash
npx tsc --noEmit
```

**Expected:** No TypeScript errors

**⚠️ IMPORTANT:** Test the query logic with a small date range before proceeding:
- Use a known date range (e.g., Q4 2025)
- Verify denominators are smaller than current period mode (should exclude in-flight records)
- Verify numerators match expected values
- Check that rates are between 0-100%

**Note on Date Handling:**
- `TIMESTAMP()` is used for timestamp fields (stage_entered_contacting__c, mql_stage_entered_ts, lead_closed_date, Date_Became_SQO__c, Stage_Entered_Closed__c)
- `DATE()` is used for date-only fields (converted_date_raw, advisor_join_date__c)
- This ensures proper type matching in BigQuery comparisons

---

### Step 1.2: Update `buildPeriodModeQuery()` for Trends

**File:** `src/lib/queries/conversion-rates.ts`

**Cursor.ai Prompt:**
```
In src/lib/queries/conversion-rates.ts, find the buildPeriodModeQuery() function.

Update it to use Period-Resolved logic for the trend chart. The denominators need to filter for records that:
1. Entered the stage in the period
2. AND resolved (progressed OR closed) in the SAME period

Use the new resolution date fields from vw_funnel_master:
- contacted_resolution_date (for Contacted→MQL)
- mql_resolution_date (for MQL→SQL)
- sql_resolution_date (for SQL→SQO)
- sqo_resolution_date (for SQO→Joined)

If these fields don't exist yet, use inline CASE logic like:
- LEAST(mql_stage_entered_ts, lead_closed_date) for contacted resolution
- LEAST(converted_date_raw, lead_closed_date) for MQL resolution

Keep the CTE structure but update the WHERE clauses to filter for same-period resolution.
```

**Code Snippet - Replace `buildPeriodModeQuery()` function:**

```typescript
/**
 * Build the SQL query for PERIOD-RESOLVED MODE
 * Records must ENTER and RESOLVE within the same period
 * Resolution = progress to next stage OR close/lost
 */
function buildPeriodModeQuery(
  periodFn: (field: string) => string,
  filterWhereClause: string,
  expectedPeriods: string[],
  granularity: 'month' | 'quarter'
): string {
  return `
    -- ═══════════════════════════════════════════════════════════════════════════
    -- PERIOD-RESOLVED MODE: Entry AND Resolution in Same Period
    -- "What actually completed this period?" (excludes in-flight records)
    -- ═══════════════════════════════════════════════════════════════════════════
    
    -- Generate all expected periods
    WITH all_periods AS (
      SELECT period FROM UNNEST([${expectedPeriods.map(p => `'${p}'`).join(', ')}]) AS period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- CONTACTED → MQL (Period-Resolved by Period)
    -- ═══════════════════════════════════════════════════════════════════════════
    contacted_to_mql AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        -- Denominator: Contacted AND resolved in same period
        -- Resolution = earliest of: MQL date OR closed date (both must be in same period as entry)
        COUNTIF(
          ${periodFn('v.stage_entered_contacting__c')} = ${periodFn('v.mql_stage_entered_ts')}
          OR (
            v.lead_closed_date IS NOT NULL 
            AND ${periodFn('v.stage_entered_contacting__c')} = ${periodFn('v.lead_closed_date')}
          )
        ) as contacted_denom,
        -- Numerator: MQL'd in same period as contacted
        COUNTIF(
          ${periodFn('v.stage_entered_contacting__c')} = ${periodFn('v.mql_stage_entered_ts')}
          AND v.is_mql = 1
        ) as contacted_numer
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
        AND v.is_contacted = 1
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- MQL → SQL Numerator (SQLs created in each period)
    -- ═══════════════════════════════════════════════════════════════════════════
    mql_to_sql_numer AS (
      SELECT
        ${periodFn('TIMESTAMP(v.converted_date_raw)')} as period,
        COUNT(*) as mql_to_sql_numer,
        COUNT(*) as sqls
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND v.is_sql = 1
        AND DATE(v.converted_date_raw) >= DATE(@trendStartDate)
        AND DATE(v.converted_date_raw) <= DATE(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- MQL → SQL Denominator (Period-Resolved: MQL'd AND resolved in same period)
    -- ═══════════════════════════════════════════════════════════════════════════
    mql_to_sql_denom AS (
      SELECT
        ${periodFn('v.mql_stage_entered_ts')} as period,
        COUNTIF(
          ${periodFn('v.mql_stage_entered_ts')} = ${periodFn('TIMESTAMP(v.converted_date_raw)')}
          OR (
            v.lead_closed_date IS NOT NULL 
            AND ${periodFn('v.mql_stage_entered_ts')} = ${periodFn('v.lead_closed_date')}
          )
        ) as mql_to_sql_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.mql_stage_entered_ts IS NOT NULL
        AND v.is_mql = 1
        AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- SQL → SQO Numerator (SQOs created in each period)
    -- ═══════════════════════════════════════════════════════════════════════════
    sql_to_sqo_numer AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNT(*) as sql_to_sqo_numer,
        COUNT(*) as sqos
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND LOWER(v.SQO_raw) = 'yes'
        AND v.is_sqo_unique = 1
        AND v.recordtypeid = @recruitingRecordType
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- SQL → SQO Denominator (Period-Resolved: SQL'd AND resolved in same period)
    -- ═══════════════════════════════════════════════════════════════════════════
    sql_to_sqo_denom AS (
      SELECT
        ${periodFn('TIMESTAMP(v.converted_date_raw)')} as period,
        COUNTIF(
          v.recordtypeid = @recruitingRecordType
          AND (
            -- Resolved by becoming SQO in same period
            (LOWER(v.SQO_raw) = 'yes' 
             AND v.Date_Became_SQO__c IS NOT NULL
             AND ${periodFn('TIMESTAMP(v.converted_date_raw)')} = ${periodFn('v.Date_Became_SQO__c')})
            OR
            -- Resolved by being closed lost in same period
            (v.StageName = 'Closed Lost' 
             AND v.Stage_Entered_Closed__c IS NOT NULL
             AND ${periodFn('TIMESTAMP(v.converted_date_raw)')} = ${periodFn('v.Stage_Entered_Closed__c')})
          )
        ) as sql_to_sqo_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.converted_date_raw IS NOT NULL
        AND v.is_sql = 1
        AND DATE(v.converted_date_raw) >= DATE(@trendStartDate)
        AND DATE(v.converted_date_raw) <= DATE(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- SQO → JOINED Numerator (Joined in each period)
    -- ═══════════════════════════════════════════════════════════════════════════
    sqo_to_joined_numer AS (
      SELECT
        ${periodFn('TIMESTAMP(v.advisor_join_date__c)')} as period,
        COUNT(*) as sqo_to_joined_numer,
        COUNT(*) as joined
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.advisor_join_date__c IS NOT NULL
        AND v.is_joined_unique = 1
        AND v.recordtypeid = @recruitingRecordType
        AND DATE(v.advisor_join_date__c) >= DATE(@trendStartDate)
        AND DATE(v.advisor_join_date__c) <= DATE(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    ),
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- SQO → JOINED Denominator (Period-Resolved: SQO'd AND resolved in same period)
    -- ═══════════════════════════════════════════════════════════════════════════
    sqo_to_joined_denom AS (
      SELECT
        ${periodFn('v.Date_Became_SQO__c')} as period,
        COUNTIF(
          v.is_sqo_unique = 1
          AND v.recordtypeid = @recruitingRecordType
          AND (
            -- Resolved by joining in same period
            (v.advisor_join_date__c IS NOT NULL 
             AND ${periodFn('v.Date_Became_SQO__c')} = ${periodFn('TIMESTAMP(v.advisor_join_date__c)')})
            OR
            -- Resolved by being closed lost in same period
            (v.StageName = 'Closed Lost' 
             AND v.Stage_Entered_Closed__c IS NOT NULL
             AND ${periodFn('v.Date_Became_SQO__c')} = ${periodFn('v.Stage_Entered_Closed__c')})
          )
        ) as sqo_to_joined_denom
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.Date_Became_SQO__c IS NOT NULL
        AND LOWER(v.SQO_raw) = 'yes'
        AND v.is_sqo_unique = 1
        AND v.recordtypeid = @recruitingRecordType
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@trendEndDate)
        ${filterWhereClause}
      GROUP BY period
    )
    
    -- ═══════════════════════════════════════════════════════════════════════════
    -- FINAL JOIN: Combine all metrics by period
    -- ═══════════════════════════════════════════════════════════════════════════
    SELECT
      ap.period,
      COALESCE(c2m.contacted_numer, 0) as contacted_to_mql_numer,
      COALESCE(c2m.contacted_denom, 0) as contacted_to_mql_denom,
      COALESCE(m2s_n.mql_to_sql_numer, 0) as mql_to_sql_numer,
      COALESCE(m2s_d.mql_to_sql_denom, 0) as mql_to_sql_denom,
      COALESCE(s2sq_n.sql_to_sqo_numer, 0) as sql_to_sqo_numer,
      COALESCE(s2sq_d.sql_to_sqo_denom, 0) as sql_to_sqo_denom,
      COALESCE(sq2j_n.sqo_to_joined_numer, 0) as sqo_to_joined_numer,
      COALESCE(sq2j_d.sqo_to_joined_denom, 0) as sqo_to_joined_denom,
      COALESCE(m2s_n.sqls, 0) as sqls,
      COALESCE(s2sq_n.sqos, 0) as sqos,
      COALESCE(sq2j_n.joined, 0) as joined
    FROM all_periods ap
    LEFT JOIN contacted_to_mql c2m ON ap.period = c2m.period
    LEFT JOIN mql_to_sql_numer m2s_n ON ap.period = m2s_n.period
    LEFT JOIN mql_to_sql_denom m2s_d ON ap.period = m2s_d.period
    LEFT JOIN sql_to_sqo_numer s2sq_n ON ap.period = s2sq_n.period
    LEFT JOIN sql_to_sqo_denom s2sq_d ON ap.period = s2sq_d.period
    LEFT JOIN sqo_to_joined_numer sq2j_n ON ap.period = sq2j_n.period
    LEFT JOIN sqo_to_joined_denom sq2j_d ON ap.period = sq2j_d.period
    ORDER BY ap.period
  `;
}
```

### ⚠️ VERIFICATION GATE 1.2

```bash
npx tsc --noEmit
npm run build
```

**Expected:** No errors

**⚠️ IMPORTANT:** After this change, test the trend chart:
- Load dashboard with a date range that has data
- Toggle to Period mode
- Verify trend chart renders without errors
- Verify period-over-period rates make sense (should be 0-100%)
- Compare with Cohort mode to ensure they're different (Period should show higher rates for recent periods)

---

## PHASE 2: Update Default Mode to Cohort

### Step 2.1: Update API Route Default

**File:** `src/app/api/dashboard/conversion-rates/route.ts`

**Cursor.ai Prompt:**
```
In src/app/api/dashboard/conversion-rates/route.ts, change the default mode from 'period' to 'cohort'.

Find this line:
const mode = (body.mode as 'period' | 'cohort') || 'period';

Change it to:
const mode = (body.mode as 'period' | 'cohort') || 'cohort';
```

**Code Change:**
```typescript
// Before:
const mode = (body.mode as 'period' | 'cohort') || 'period';

// After:
const mode = (body.mode as 'period' | 'cohort') || 'cohort';
```

---

### Step 2.2: Update Dashboard Page Default State

**File:** `src/app/dashboard/page.tsx`

**Cursor.ai Prompt:**
```
In src/app/dashboard/page.tsx, find where the trend mode state is initialized.

Look for:
const [trendMode, setTrendMode] = useState<ConversionTrendMode>('period');

Change it to:
const [trendMode, setTrendMode] = useState<ConversionTrendMode>('cohort');

Note: The state variable is named `trendMode`, not `conversionMode`.
```

---

### Step 2.3: Update API Client Default

**File:** `src/lib/api-client.ts`

**Cursor.ai Prompt:**
```
In src/lib/api-client.ts, find the getConversionRates function.

Change the default mode from 'period' to 'cohort':

mode: options?.mode ?? 'cohort',
```

**Code Change:**
```typescript
// Before:
mode: options?.mode ?? 'period',

// After:
mode: options?.mode ?? 'cohort',
```

### ⚠️ VERIFICATION GATE 2

```bash
npx tsc --noEmit
```

**Expected:** No TypeScript errors

---

## PHASE 3: Update Toggle UI (Cohort on Left)

### Step 3.1: Update ConversionTrendChart Toggle Order

**File:** `src/components/dashboard/ConversionTrendChart.tsx`

**Cursor.ai Prompt:**
```
In src/components/dashboard/ConversionTrendChart.tsx, find the mode toggle buttons.

Swap the order so Cohort appears FIRST (on the left) and Period appears SECOND (on the right).

Find the div with className containing "bg-gray-100 rounded-lg p-1" that has the Period and Cohort buttons.

Move the Cohort button BEFORE the Period button in the JSX.
```

**Code - Replace the Mode Toggle Section:**

Find:
```tsx
{/* Mode Toggle */}
{onModeChange && (
  <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
    <button
      onClick={() => handleModeChange('period')}
      ...
    >
      Period
      ...
    </button>
    <button
      onClick={() => handleModeChange('cohort')}
      ...
    >
      Cohort
      ...
    </button>
  </div>
)}
```

Replace with:
```tsx
{/* Mode Toggle - Cohort first (default), Period second */}
{onModeChange && (
  <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
    <button
      onClick={() => handleModeChange('cohort')}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
        mode === 'cohort'
          ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      }`}
    >
      Cohort
      <ModeTooltip mode="cohort">
        <InfoIcon className="ml-0.5" />
      </ModeTooltip>
    </button>
    <button
      onClick={() => handleModeChange('period')}
      className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1 ${
        mode === 'period'
          ? 'bg-white dark:bg-gray-700 shadow text-blue-600 dark:text-blue-400 font-medium'
          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      }`}
    >
      Period
      <ModeTooltip mode="period">
        <InfoIcon className="ml-0.5" />
      </ModeTooltip>
    </button>
  </div>
)}
```

---

## PHASE 4: Update Tooltips and Descriptions

### Step 4.1: Update ModeTooltip Explanations in ConversionTrendChart

**File:** `src/components/dashboard/ConversionTrendChart.tsx`

**Cursor.ai Prompt:**
```
In src/components/dashboard/ConversionTrendChart.tsx, find the ModeTooltip component and its explanations object.

Update the explanations to clearly describe:

COHORT MODE:
- Title: "Cohort Mode (Funnel Efficiency)"
- Description: "Tracks how leads from each period ultimately convert, regardless of when they convert."
- Example: "A Q3 SQL that becomes SQO in Q4 counts toward Q3's rate."
- Details should include: 
  - Only includes resolved records (converted OR closed)
  - Open/in-flight records are excluded
  - Shows true funnel efficiency
  - Rates are always 0-100%
  - Best for forecasting and funnel analysis

PERIOD MODE:
- Title: "Period Mode (Resolved Snapshot)"
- Description: "Shows conversion rates for records that both entered AND completed their journey within the same period."
- Example: "Only counts a Q4 SQL→SQO if BOTH the SQL date AND SQO date are in Q4."
- Details should include:
  - Excludes in-flight records (still being worked)
  - Clean period-over-period comparison
  - Rates are always 0-100%
  - Best for current period performance snapshots
```

**Code - Replace the explanations object:**

```typescript
const explanations = {
  cohort: {
    title: 'Cohort Mode (Funnel Efficiency)',
    description: 'Tracks how leads from each period ultimately convert, regardless of when they convert.',
    example: 'A Q3 SQL that becomes SQO in Q4 counts toward Q3\'s conversion rate.',
    details: [
      'Answers: "How well do leads from this period convert?"',
      'Only includes RESOLVED records (converted OR closed/lost)',
      'Open/in-flight records are excluded from denominators',
      'Rates are always 0-100%',
      'Best for: Funnel efficiency analysis, forecasting, identifying bottlenecks',
    ],
    calculation: 'SQL→SQO Rate = (SQLs from period that became SQO) ÷ (SQLs from period that resolved)',
  },
  period: {
    title: 'Period Mode (Resolved Snapshot)',
    description: 'Shows conversion rates for records that entered AND resolved within the same period.',
    example: 'A Q4 SQL→SQO only counts if BOTH the SQL date AND SQO/Closed date are in Q4.',
    details: [
      'Answers: "What actually completed this period?"',
      'Excludes in-flight records (entered but not yet resolved)',
      'Clean period-over-period comparison',
      'Rates are always 0-100%',
      'Best for: Current period snapshots, operational performance',
    ],
    calculation: 'SQL→SQO Rate = (SQLs resolved as SQO in period) ÷ (SQLs that entered AND resolved in period)',
  },
};
```

---

### Step 4.2: Update Legend Explanation at Bottom of Chart

**File:** `src/components/dashboard/ConversionTrendChart.tsx`

**Cursor.ai Prompt:**
```
In src/components/dashboard/ConversionTrendChart.tsx, find the Legend Explanation section at the bottom of the chart (inside the "mt-4 pt-4 border-t" div).

Update the text for both modes to match the new Period-Resolved logic:

For cohort mode (keep similar but clarify):
"Cohort Mode: Tracks each cohort through the funnel. A Q3 SQL that becomes SQO in Q4 counts toward Q3's rate. Only includes resolved records (converted or closed). Open records are excluded."

For period mode (update to Period-Resolved):
"Period Mode: Shows what completed in each period. Records must enter AND resolve (convert or close) in the same period to be counted. Excludes in-flight records for clean period-over-period comparison."
```

**Code - Replace the Legend Explanation:**

```tsx
{/* Legend Explanation */}
<div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
  <div className="flex items-start gap-2">
    <InfoIcon className="mt-0.5 flex-shrink-0" />
    <Text className="text-xs text-gray-500 dark:text-gray-400">
      {mode === 'cohort' ? (
        <>
          <strong>Cohort Mode:</strong> Tracks each cohort through the funnel over time.
          A Q3 SQL that becomes SQO in Q4 counts toward Q3&apos;s rate.
          Only includes resolved records (converted or closed). Open records still in progress are excluded.
          Rates are always 0-100%. Best for funnel efficiency analysis.
        </>
      ) : (
        <>
          <strong>Period Mode:</strong> Shows what completed within each period.
          Records must enter AND resolve (convert or close) in the same period to be counted.
          Excludes in-flight records for clean period comparisons.
          Rates are always 0-100%. Best for current period snapshots.
        </>
      )}
    </Text>
  </div>
</div>
```

---

### Step 4.3: Update Subtitle Text

**File:** `src/components/dashboard/ConversionTrendChart.tsx`

**Cursor.ai Prompt:**
```
In src/components/dashboard/ConversionTrendChart.tsx, find the subtitle Text component that shows different text based on mode.

Update the subtitles:
- Cohort: "Cohort view: How well leads from each period ultimately convert"
- Period: "Period view: What entered AND completed within each period"
```

**Code:**
```tsx
<Text className="text-xs text-gray-500 dark:text-gray-400 mt-1">
  {mode === 'period'
    ? 'Period view: What entered AND completed within each period'
    : 'Cohort view: How well leads from each period ultimately convert'
  }
</Text>
```

---

### Step 4.4: Update ConversionRateCards Tooltips

**File:** `src/components/dashboard/ConversionRateCards.tsx`

**Cursor.ai Prompt:**
```
In src/components/dashboard/ConversionRateCards.tsx, find the SimpleTooltip components that explain the modes.

Update the tooltip content:

For cohort mode:
"Cohort Mode: Shows conversion efficiency for leads that originated in this period AND have resolved (converted or closed). Open records still being worked are excluded. Rates are always 0-100%."

For period mode:
"Period Mode: Shows conversion rates for records that entered AND resolved (converted or closed) within this period. In-flight records are excluded for a clean snapshot. Rates are always 0-100%."
```

**Code - Find and replace the tooltip content:**

```tsx
<SimpleTooltip 
  content={
    isResolved 
      ? 'Cohort Mode: Shows conversion efficiency for leads that originated in this period AND have resolved (converted or closed). Open records still being worked are excluded. Rates are always 0-100%.'
      : 'Period Mode: Shows conversion rates for records that entered AND resolved (converted or closed) within this period. In-flight records are excluded for a clean snapshot. Rates are always 0-100%.'
  }
>
```

---

### Step 4.5: Update Mode Indicator Text

**File:** `src/components/dashboard/ConversionRateCards.tsx`

**Cursor.ai Prompt:**
```
In src/components/dashboard/ConversionRateCards.tsx, find the mode indicator text that says "Showing {mode} rates".

Update it to be more descriptive:
- Cohort: "Showing cohort efficiency rates (resolved records only)"
- Period: "Showing period snapshot rates (resolved in-period only)"
```

**Code:**
```tsx
<Text className="text-xs text-gray-500">
  {isResolved 
    ? 'Showing cohort efficiency rates (resolved records only)' 
    : 'Showing period snapshot rates (resolved in-period only)'
  }
</Text>
```

### ⚠️ VERIFICATION GATE 4

```bash
npm run build
npm run lint
```

**Expected:** No build or lint errors

---

## PHASE 5: Final Testing Checklist

### Step 5.1: Create Test Query for BigQuery

**Cursor.ai Prompt:**
```
Use your MCP connection to BigQuery to run this validation query for Q4 2025.

Compare the results with expected values:
- Cohort should show mature conversion efficiency
- Period should show in-period resolved rates only
```

**Test Query to Run in BigQuery:**
```sql
-- Validation: Q4 2025 Contacted→MQL comparison
WITH q4_leads AS (
  SELECT
    stage_entered_contacting__c,
    mql_stage_entered_ts,
    lead_closed_date,
    is_mql,
    is_contacted
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE stage_entered_contacting__c >= TIMESTAMP('2025-10-01')
    AND stage_entered_contacting__c < TIMESTAMP('2026-01-01')
    AND is_contacted = 1
)
SELECT
  -- PERIOD-RESOLVED
  'Period-Resolved' as mode,
  COUNTIF(
    (mql_stage_entered_ts >= TIMESTAMP('2025-10-01') AND mql_stage_entered_ts < TIMESTAMP('2026-01-01'))
    OR (lead_closed_date >= TIMESTAMP('2025-10-01') AND lead_closed_date < TIMESTAMP('2026-01-01'))
  ) as denominator,
  COUNTIF(
    mql_stage_entered_ts >= TIMESTAMP('2025-10-01') AND mql_stage_entered_ts < TIMESTAMP('2026-01-01')
  ) as numerator,
  ROUND(SAFE_DIVIDE(
    COUNTIF(mql_stage_entered_ts >= TIMESTAMP('2025-10-01') AND mql_stage_entered_ts < TIMESTAMP('2026-01-01')),
    COUNTIF(
      (mql_stage_entered_ts >= TIMESTAMP('2025-10-01') AND mql_stage_entered_ts < TIMESTAMP('2026-01-01'))
      OR (lead_closed_date >= TIMESTAMP('2025-10-01') AND lead_closed_date < TIMESTAMP('2026-01-01'))
    )
  ) * 100, 2) as rate_pct
FROM q4_leads

UNION ALL

SELECT
  -- COHORT
  'Cohort' as mode,
  COUNTIF(is_mql = 1 OR lead_closed_date IS NOT NULL) as denominator,
  COUNTIF(is_mql = 1) as numerator,
  ROUND(SAFE_DIVIDE(
    COUNTIF(is_mql = 1),
    COUNTIF(is_mql = 1 OR lead_closed_date IS NOT NULL)
  ) * 100, 2) as rate_pct
FROM q4_leads;
```

**Expected Results:**
| Mode | Denominator | Numerator | Rate |
|------|-------------|-----------|------|
| Period-Resolved | ~3,200-3,400 | ~430-450 | ~12-14% |
| Cohort | ~7,200-7,400 | ~560-580 | ~7-8% |

---

### Step 5.2: Manual UI Testing Checklist

After all code changes, test manually:

- [ ] **Default Mode**: Dashboard loads with Cohort mode selected
- [ ] **Toggle Order**: Cohort is on LEFT, Period is on RIGHT
- [ ] **Cohort Rates**: Q4 2025 shows ~7.75% for Contacted→MQL
- [ ] **Period Rates**: Q4 2025 shows ~13% for Contacted→MQL (higher due to resolved-only)
- [ ] **Tooltips**: Hover over info icons, verify new descriptions appear
- [ ] **Chart Legend**: Bottom text explains the mode correctly
- [ ] **Mode Switching**: Toggle between modes, rates update correctly
- [ ] **Trend Chart**: Both modes render without errors
- [ ] **No Console Errors**: Check browser console for errors

---

### Step 5.3: Vercel Deployment Check

```bash
# Build locally first
npm run build

# Check for TypeScript errors
npx tsc --noEmit

# Run linter
npm run lint

# If all pass, deploy to Vercel
vercel --prod
```

---

## Summary of All Files Changed

| File | Changes |
|------|---------|
| `src/lib/queries/conversion-rates.ts` | Period mode query updated to Period-Resolved logic |
| `src/app/api/dashboard/conversion-rates/route.ts` | Default mode changed to 'cohort' |
| `src/app/dashboard/page.tsx` | Default state changed to 'cohort' |
| `src/lib/api-client.ts` | Default mode changed to 'cohort' |
| `src/components/dashboard/ConversionTrendChart.tsx` | Toggle order swapped, tooltips updated |
| `src/components/dashboard/ConversionRateCards.tsx` | Tooltips updated |

---

## Rollback Plan

If issues arise, revert these specific changes:
1. Change default mode back to 'period' in route.ts, page.tsx, api-client.ts
2. Swap toggle order back (Period left, Cohort right)
3. Revert buildPeriodModeQuery() to original version

The cohort mode code is unchanged, so that will continue to work as a fallback.
