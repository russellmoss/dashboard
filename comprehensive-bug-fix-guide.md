# Comprehensive Bug Fix: Date Filtering & MQL Definition

## Executive Summary

This document provides step-by-step instructions to fix critical bugs in the Savvy Funnel Analytics Dashboard where:

1. **Prospects and Contacted columns** show all-time counts instead of period-filtered counts
2. **MQL counts** use the wrong date field (`stage_entered_contacting__c` instead of `mql_stage_entered_ts`)
3. **MQL→SQL conversion rate** uses the wrong cohort date

**Impact**: Q1 2026 shows 93,000+ prospects when actual should be ~2,000. MQL counts are misaligned with Salesforce definitions.

---

## Prerequisites

Before starting, ensure you understand the correct date field mapping:

| Funnel Stage | Correct Date Field | Field Source |
|--------------|-------------------|--------------|
| Prospect | `FilterDate` | Computed: MAX of CreatedDate, stage_entered_new__c, stage_entered_contacting__c |
| Contacted | `stage_entered_contacting__c` | Lead.stage_entered_contacting__c |
| **MQL** | **`mql_stage_entered_ts`** | Lead.Stage_Entered_Call_Scheduled__c |
| SQL | `converted_date_raw` | Lead.ConvertedDate |
| SQO | `Date_Became_SQO__c` | Opportunity.Date_Became_SQO__c |
| Joined | `advisor_join_date__c` | Opportunity.advisor_join_date__c |

---

## PHASE 1: Fix `src/lib/queries/source-performance.ts`

### Step 1.1: Locate the File
Open `src/lib/queries/source-performance.ts`

### Step 1.2: Fix `getChannelPerformance()` Function

#### 1.2.1: Fix Prospects Count
**Find this code block (around line 33-44):**
```typescript
  const query = `
    SELECT
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      COUNT(*) as prospects,
      SUM(v.is_contacted) as contacted,
```

**Replace with:**
```typescript
  const query = `
    SELECT
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      -- FIX: prospects filtered by FilterDate (the cohort date that handles recycled leads)
      SUM(
        CASE 
          WHEN v.FilterDate IS NOT NULL
            AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.FilterDate) <= TIMESTAMP(@endDate)
          THEN 1 
          ELSE 0 
        END
      ) as prospects,
      -- FIX: contacted filtered by stage_entered_contacting__c (Contacting stage)
      SUM(
        CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN 1 
          ELSE 0 
        END
      ) as contacted,
```

#### 1.2.2: Fix MQL Count in Channel Performance
**Find this code block (the MQL SUM after contacted):**
```typescript
      SUM(
        CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN 1 
          ELSE 0 
        END
      ) as mqls,
```

**Replace with:**
```typescript
      -- FIX: MQLs filtered by mql_stage_entered_ts (Call Scheduled stage = Stage_Entered_Call_Scheduled__c)
      SUM(
        CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          THEN 1 
          ELSE 0 
        END
      ) as mqls,
```

#### 1.2.3: Fix MQL→SQL Rate Cohort in Channel Performance
**Find this code block:**
```typescript
      -- MQL→SQL (cohort by stage_entered_contacting__c)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.mql_to_sql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END)
      ) as mql_to_sql_rate,
```

**Replace with:**
```typescript
      -- MQL→SQL (cohort by mql_stage_entered_ts - people who became MQL in the period)
      SAFE_DIVIDE(
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          THEN v.mql_to_sql_progression ELSE 0 
        END),
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END)
      ) as mql_to_sql_rate,
```

### Step 1.3: Fix `getSourcePerformance()` Function

Apply the **exact same changes** as Steps 1.2.1, 1.2.2, and 1.2.3 to the `getSourcePerformance()` function (starts around line 193).

The code blocks to find and replace are identical - they appear twice in the file (once for channel, once for source).

### ⚠️ VERIFICATION GATE 1

After completing Phase 1, verify the file compiles:
```bash
npm run build
```

**Expected**: No TypeScript errors in `source-performance.ts`

---

## PHASE 2: Fix `src/lib/queries/funnel-metrics.ts`

### Step 2.1: Locate the File
Open `src/lib/queries/funnel-metrics.ts`

### Step 2.2: Fix MQL Count in Metrics Query

**Find this code block (around line 45-55):**
```typescript
  const metricsQuery = `
    SELECT
      SUM(
        CASE 
          WHEN stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(stage_entered_contacting__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN 1 
          ELSE 0 
        END
      ) as mqls,
```

**Replace with:**
```typescript
  const metricsQuery = `
    SELECT
      -- FIX: MQLs use mql_stage_entered_ts (Call Scheduled), NOT stage_entered_contacting__c
      SUM(
        CASE 
          WHEN mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          THEN 1 
          ELSE 0 
        END
      ) as mqls,
```

### Step 2.3: Add Contacted Count (Optional Enhancement)

If you want to track "Contacted" as a separate metric, add this after the MQLs block:
```typescript
      -- Contacted: People who entered Contacting stage in the period
      SUM(
        CASE 
          WHEN stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(stage_entered_contacting__c) >= TIMESTAMP(@startDate) 
            AND TIMESTAMP(stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN 1 
          ELSE 0 
        END
      ) as contacted,
```

**Note**: This requires updating the `FunnelMetrics` type in `src/types/dashboard.ts` and the return mapping.

### ⚠️ VERIFICATION GATE 2

After completing Phase 2, verify:
```bash
npm run build
```

**Expected**: No TypeScript errors in `funnel-metrics.ts`

---

## PHASE 3: Fix `src/lib/queries/conversion-rates.ts`

### Step 3.1: Locate the File
Open `src/lib/queries/conversion-rates.ts`

### Step 3.2: Update the Documentation Comment

**Find the DATE FIELD MAPPING comment block and update it:**

**Find:**
```typescript
 * DATE FIELD MAPPING:
 * | Conversion     | Period Num Date      | Period Denom Date           | Cohort Date               |
 * |----------------|----------------------|-----------------------------|---------------------------|
 * | Contacted→MQL  | stage_entered_contacting__c | stage_entered_contacting__c | stage_entered_contacting__c |
 * | MQL→SQL        | converted_date_raw   | stage_entered_contacting__c | stage_entered_contacting__c |
```

**Replace with:**
```typescript
 * DATE FIELD MAPPING:
 * | Conversion     | Period Num Date      | Period Denom Date           | Cohort Date               |
 * |----------------|----------------------|-----------------------------|---------------------------|
 * | Contacted→MQL  | stage_entered_contacting__c | stage_entered_contacting__c | stage_entered_contacting__c |
 * | MQL→SQL        | converted_date_raw   | mql_stage_entered_ts        | mql_stage_entered_ts      |
```

### Step 3.3: Fix MQL→SQL in `getConversionRates()` - Period Mode

**Find this code block in the period mode query:**
```typescript
        -- MQL→SQL (cohort by stage_entered_contacting__c)
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.mql_to_sql_progression ELSE 0 
        END) as mql_numer,
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END) as mql_denom,
```

**Replace with:**
```typescript
        -- MQL→SQL (cohort by mql_stage_entered_ts - Call Scheduled date)
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          THEN v.mql_to_sql_progression ELSE 0 
        END) as mql_numer,
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END) as mql_denom,
```

### Step 3.4: Fix MQL→SQL in `getConversionRates()` - Cohort Mode

**Find this code block in the cohort mode query:**
```typescript
        -- MQL→SQL (cohort by stage_entered_contacting__c)
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.mql_to_sql_progression ELSE 0 
        END) as mql_numer,
        SUM(CASE 
          WHEN v.stage_entered_contacting__c IS NOT NULL
            AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END) as mql_denom,
```

**Replace with:**
```typescript
        -- MQL→SQL (cohort by mql_stage_entered_ts - Call Scheduled date)
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          THEN v.mql_to_sql_progression ELSE 0 
        END) as mql_numer,
        SUM(CASE 
          WHEN v.mql_stage_entered_ts IS NOT NULL
            AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
            AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
          THEN v.eligible_for_mql_conversions ELSE 0 
        END) as mql_denom,
```

### Step 3.5: Fix MQL Cohort in `getConversionTrends()` Function

Locate the `getConversionTrends()` function and find the MQL cohort CTE.

**Find:**
```typescript
    -- CTE 2: MQL COHORT (by stage_entered_contacting__c)
    -- Uses eligible_for_mql_conversions (resolved only) and mql_to_sql_progression
    mql_cohort AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
        SUM(v.eligible_for_mql_conversions) as eligible_mqls,
        SUM(v.mql_to_sql_progression) as progressed_to_sql
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@trendEndDate)
```

**Replace with:**
```typescript
    -- CTE 2: MQL COHORT (by mql_stage_entered_ts - Call Scheduled date)
    -- Uses eligible_for_mql_conversions (resolved only) and mql_to_sql_progression
    mql_cohort AS (
      SELECT
        ${periodFn('v.mql_stage_entered_ts')} as period,
        SUM(v.eligible_for_mql_conversions) as eligible_mqls,
        SUM(v.mql_to_sql_progression) as progressed_to_sql
      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE v.mql_stage_entered_ts IS NOT NULL
        AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@trendEndDate)
```

### Step 3.6: Fix MQL→SQL Denominator CTE in Trends (if using period mode)

**Find:**
```typescript
    -- CTE 3: MQL→SQL DENOMINATOR (by stage_entered_contacting__c)
    mql_to_sql_denom AS (
      SELECT
        ${periodFn('v.stage_entered_contacting__c')} as period,
```

**Replace with:**
```typescript
    -- CTE 3: MQL→SQL DENOMINATOR (by mql_stage_entered_ts)
    mql_to_sql_denom AS (
      SELECT
        ${periodFn('v.mql_stage_entered_ts')} as period,
```

And update the WHERE clause in the same CTE:
```typescript
      WHERE v.mql_stage_entered_ts IS NOT NULL
        AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@trendStartDate)
        AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@trendEndDate)
```

### ⚠️ VERIFICATION GATE 3

After completing Phase 3, verify:
```bash
npm run build
```

**Expected**: No TypeScript errors in `conversion-rates.ts`

---

## PHASE 4: Full Application Verification

### Step 4.1: Build the Application
```bash
npm run build
```

**Expected**: Build completes successfully with no errors.

### Step 4.2: Start Development Server
```bash
npm run dev
```

### Step 4.3: Test with Q1 2026 Data

1. Open the dashboard at `http://localhost:3000/dashboard`
2. Select **Q1 2026** date filter (or custom: 2026-01-01 to 2026-03-31)
3. Verify the following metrics:

#### Channel Performance Table
| Metric | Expected Behavior |
|--------|-------------------|
| Prospects | Should be ~2,000-3,000 (NOT 93,000+) |
| Contacted | Should match people entering Contacting stage in Q1 |
| MQLs | Should match people entering Call Scheduled stage in Q1 |

#### Source Performance Table
| Source | Expected MQL Count (approx) |
|--------|----------------------------|
| LinkedIn (Self Sourced) | ~738 (per Salesforce) |
| Provided Lead List | ~390 (per Salesforce) |
| Provided Lead List (Marketing) | ~116 (per Salesforce) |

### Step 4.4: Verify Conversion Rates

Check that conversion rates are calculating correctly:
- Contacted→MQL rate should be based on Contacted cohort
- MQL→SQL rate should be based on MQL (Call Scheduled) cohort
- SQL→SQO rate should be based on SQL cohort
- SQO→Joined rate should be based on SQO cohort

### ⚠️ VERIFICATION GATE 4 (Final)

Run this BigQuery query to validate dashboard matches raw data:

```sql
-- Validation Query: Q1 2026 Metrics
SELECT
  -- Prospects (by FilterDate)
  COUNTIF(
    FilterDate IS NOT NULL
    AND TIMESTAMP(FilterDate) >= TIMESTAMP('2026-01-01')
    AND TIMESTAMP(FilterDate) <= TIMESTAMP('2026-03-31 23:59:59')
  ) as prospects_q1,
  
  -- Contacted (by stage_entered_contacting__c)
  COUNTIF(
    stage_entered_contacting__c IS NOT NULL
    AND TIMESTAMP(stage_entered_contacting__c) >= TIMESTAMP('2026-01-01')
    AND TIMESTAMP(stage_entered_contacting__c) <= TIMESTAMP('2026-03-31 23:59:59')
  ) as contacted_q1,
  
  -- MQLs (by mql_stage_entered_ts = Call Scheduled)
  COUNTIF(
    mql_stage_entered_ts IS NOT NULL
    AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP('2026-01-01')
    AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP('2026-03-31 23:59:59')
  ) as mqls_q1,
  
  -- SQLs (by converted_date_raw)
  COUNTIF(
    converted_date_raw IS NOT NULL
    AND TIMESTAMP(converted_date_raw) >= TIMESTAMP('2026-01-01')
    AND TIMESTAMP(converted_date_raw) <= TIMESTAMP('2026-03-31 23:59:59')
    AND is_sql = 1
  ) as sqls_q1,
  
  -- SQOs (by Date_Became_SQO__c)
  COUNTIF(
    Date_Became_SQO__c IS NOT NULL
    AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP('2026-01-01')
    AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP('2026-03-31 23:59:59')
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND is_sqo_unique = 1
  ) as sqos_q1,
  
  -- Joined (by advisor_join_date__c)
  COUNTIF(
    advisor_join_date__c IS NOT NULL
    AND TIMESTAMP(advisor_join_date__c) >= TIMESTAMP('2026-01-01')
    AND TIMESTAMP(advisor_join_date__c) <= TIMESTAMP('2026-03-31 23:59:59')
    AND is_joined_unique = 1
  ) as joined_q1

FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`;
```

Dashboard values should match these BigQuery results.

---

## Summary of All Changes

### Files Modified

| File | Changes Made |
|------|-------------|
| `src/lib/queries/source-performance.ts` | Fixed prospects, contacted, mqls counts; Fixed mql_to_sql_rate cohort |
| `src/lib/queries/funnel-metrics.ts` | Fixed mqls to use mql_stage_entered_ts |
| `src/lib/queries/conversion-rates.ts` | Fixed MQL→SQL cohort date in all functions |

### Date Field Corrections

| Metric | Old (Wrong) | New (Correct) |
|--------|-------------|---------------|
| Prospects | `COUNT(*)` (no filter) | `FilterDate` filtered |
| Contacted | `SUM(is_contacted)` (no filter) | `stage_entered_contacting__c` filtered |
| MQLs | `stage_entered_contacting__c` | `mql_stage_entered_ts` |
| MQL→SQL Cohort | `stage_entered_contacting__c` | `mql_stage_entered_ts` |

---

## Rollback Plan

If issues occur, revert changes using git:
```bash
git checkout HEAD -- src/lib/queries/source-performance.ts
git checkout HEAD -- src/lib/queries/funnel-metrics.ts
git checkout HEAD -- src/lib/queries/conversion-rates.ts
```

---

## Post-Implementation Notes

After successful implementation:

1. **Update Documentation**: Update `README.md` and `.cursorrules` to reflect correct date field mappings
2. **Add Comments**: Ensure all date field usages have comments explaining which stage they represent
3. **Create Tests**: Consider adding unit tests that validate date field usage
4. **Monitor**: Watch for any discrepancies in the first few days after deployment

---

## Appendix: Quick Reference - Correct Date Fields

```
FUNNEL STAGE → DATE FIELD
─────────────────────────────────────────────
Prospect      → FilterDate
Contacted     → stage_entered_contacting__c
MQL           → mql_stage_entered_ts
SQL           → converted_date_raw  
SQO           → Date_Became_SQO__c
Joined        → advisor_join_date__c

CONVERSION RATE → COHORT DATE
─────────────────────────────────────────────
Contacted→MQL → stage_entered_contacting__c
MQL→SQL       → mql_stage_entered_ts
SQL→SQO       → converted_date_raw
SQO→Joined    → Date_Became_SQO__c
```
