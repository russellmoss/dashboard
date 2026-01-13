# Cohort Conversion Rate Calculation Guide

## Overview

This document explains how **Cohort Mode** conversion rates are calculated in the Savvy Funnel Analytics Dashboard. Cohort mode tracks conversion efficiency by following records from their entry into a stage through to their resolution (conversion or closure), regardless of when the resolution occurs.

---

## Table of Contents

1. [What is Cohort Mode?](#what-is-cohort-mode)
2. [Key Concepts](#key-concepts)
3. [Conversion Rate Calculations](#conversion-rate-calculations)
4. [Date Attribution Logic](#date-attribution-logic)
5. [Cross-Period Conversions](#cross-period-conversions)
6. [Progression Flags Explained](#progression-flags-explained)
7. [Eligibility Flags Explained](#eligibility-flags-explained)
8. [FilterDate and Recycled Leads](#filterdate-and-recycled-leads)
9. [Examples](#examples)
10. [Technical Implementation](#technical-implementation)

---

## What is Cohort Mode?

**Cohort Mode** answers the question: *"Of all records that entered a stage in this period, what percentage eventually converted to the next stage?"*

### Key Characteristics:

- **Resolved-Only**: Only includes records that have reached a final outcome (converted OR closed/lost)
- **Open Records Excluded**: Records still in-flight are NOT counted in denominators
- **Cross-Period Tracking**: Tracks conversions that happen in future periods
- **Same Population**: Numerator and denominator use the same cohort of records
- **Rate Range**: Always 0-100% (cannot exceed 100% since numerator is subset of denominator)

### Example:
If 100 people were contacted in Q1 2025:
- 50 became MQL (in Q1, Q2, or Q3)
- 30 were closed as leads (in Q1, Q2, or Q3)
- 20 are still open (not yet MQL or closed)

**Cohort Rate**: 50 / 80 = 62.5% (only resolved records: 50 MQL + 30 closed = 80 total resolved)

---

## Key Concepts

### 1. Cohort Date
The **cohort date** is the date when a record entered the starting stage. This determines which period the record belongs to.

| Conversion | Cohort Date Field | Meaning |
|------------|------------------|---------|
| Contacted→MQL | `stage_entered_contacting__c` | When they entered Contacting stage |
| MQL→SQL | `mql_stage_entered_ts` | When they became MQL (Call Scheduled stage) |
| SQL→SQO | `converted_date_raw` | When they converted to SQL (Opportunity created) |
| SQO→Joined | `Date_Became_SQO__c` | When they became SQO |

### 2. Resolution
A record is **resolved** when it reaches a final outcome:
- **Positive Resolution**: Progressed to the next stage
- **Negative Resolution**: Closed/lost without progressing

### 3. Progression Flags (Numerators)
Pre-calculated flags in `vw_funnel_master` that indicate if a record progressed to the next stage:
- `contacted_to_mql_progression`
- `mql_to_sql_progression`
- `sql_to_sqo_progression`
- `sqo_to_joined_progression`

### 4. Eligibility Flags (Denominators)
Pre-calculated flags in `vw_funnel_master` that indicate if a record is eligible for conversion tracking (i.e., has reached a final outcome):
- `eligible_for_contacted_conversions`
- `eligible_for_mql_conversions`
- `eligible_for_sql_conversions`
- `eligible_for_sqo_conversions`

---

## Conversion Rate Calculations

### Contacted → MQL Rate

**Formula**: `contacted_to_mql_progression / eligible_for_contacted_conversions`

**Cohort Date**: `stage_entered_contacting__c` (when they entered Contacting stage)

**Eligibility Flag Logic** (`eligible_for_contacted_conversions`):
```sql
CASE 
  WHEN is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0 
END
```
- **Includes**: Contacted records that either became MQL OR were closed as a lead
- **Excludes**: Contacted records that are still open (not yet MQL or closed)

**Progression Flag Logic** (`contacted_to_mql_progression`):
```sql
CASE 
  WHEN is_contacted = 1 
    AND is_mql = 1 
    AND mql_stage_entered_ts IS NOT NULL
    AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)  -- ⚠️ Critical: Prevents double-counting recycled leads
  THEN 1 ELSE 0 
END
```
- **Includes**: Contacted records that became MQL
- **FilterDate Check**: Only counts MQL conversions that happened ON or AFTER the FilterDate (prevents counting old MQL conversions for recycled leads)

**Example**:
- Q1 2025: 1,000 people entered Contacting stage
- 600 became MQL (anytime, even in Q2 or Q3)
- 200 were closed as leads (anytime)
- 200 are still open

**Rate**: 600 / 800 = 75% (only resolved: 600 MQL + 200 closed = 800)

---

### MQL → SQL Rate

**Formula**: `mql_to_sql_progression / eligible_for_mql_conversions`

**Cohort Date**: `mql_stage_entered_ts` (when they became MQL - Call Scheduled stage)

**Eligibility Flag Logic** (`eligible_for_mql_conversions`):
```sql
CASE 
  WHEN is_mql = 1 AND (is_sql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0 
END
```
- **Includes**: MQL records that either converted to SQL OR were closed as a lead
- **Excludes**: MQL records that are still open (not yet SQL or closed)

**Progression Flag Logic** (`mql_to_sql_progression`):
```sql
CASE WHEN is_mql = 1 AND is_sql = 1 THEN 1 ELSE 0 END
```
- **Includes**: MQL records that converted to SQL (became an Opportunity)
- **Note**: No FilterDate check needed - once MQL, conversion to SQL is straightforward

**Example**:
- Q1 2025: 500 people became MQL
- 200 converted to SQL (anytime, even in Q2 or Q3)
- 100 were closed as leads (anytime)
- 200 are still open

**Rate**: 200 / 300 = 66.7% (only resolved: 200 SQL + 100 closed = 300)

---

### SQL → SQO Rate

**Formula**: `sql_to_sqo_progression / eligible_for_sql_conversions`

**Cohort Date**: `converted_date_raw` (when they converted to SQL - Opportunity created date)

**Eligibility Flag Logic** (`eligible_for_sql_conversions`):
```sql
CASE 
  WHEN is_sql = 1 AND (
    LOWER(SQO_raw) = 'yes' OR                    -- Became SQO (progress)
    StageName = 'Closed Lost'                     -- Closed without becoming SQO
  )
  THEN 1 
  -- Include direct opportunities (no linked lead) that became SQO
  WHEN Full_prospect_id__c IS NULL AND LOWER(SQO_raw) = 'yes'
  THEN 1
  ELSE 0 
END
```
- **Includes**: SQL records (Opportunities) that either became SQO OR were closed lost
- **Includes**: Direct opportunities (created without a lead) that became SQO
- **Excludes**: SQL records that are still open (not yet SQO or closed lost)
- **Note**: Once converted to SQL, we track Opportunity-level outcomes, not Lead disposition

**Progression Flag Logic** (`sql_to_sqo_progression`):
```sql
CASE WHEN is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 1 ELSE 0 END
```
- **Includes**: SQL records (Opportunities) that became SQO
- **Uses**: `SQO_raw` field (despite the name, this represents SQO status)

**Example**:
- Q1 2025: 150 Opportunities were created (SQLs)
- 100 became SQO (anytime, even in Q2 or Q3)
- 30 were closed lost (anytime)
- 20 are still open

**Rate**: 100 / 130 = 76.9% (only resolved: 100 SQO + 30 closed lost = 130)

---

### SQO → Joined Rate

**Formula**: `sqo_to_joined_progression / eligible_for_sqo_conversions`

**Cohort Date**: `Date_Became_SQO__c` (when they became SQO)

**Eligibility Flag Logic** (`eligible_for_sqo_conversions`):
```sql
CASE 
  WHEN LOWER(SQO_raw) = 'yes' AND (
    (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') OR 
    StageName = 'Closed Lost'
  )
  THEN 1 ELSE 0 
END
```
- **Includes**: SQO records that either joined OR were closed lost
- **Excludes**: SQO records that are still open (not yet joined or closed lost)

**Progression Flag Logic** (`sqo_to_joined_progression`):
```sql
CASE 
  WHEN LOWER(SQO_raw) = 'yes' AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
  THEN 1 ELSE 0 
END
```
- **Includes**: SQO records that joined (have `advisor_join_date__c` OR `StageName = 'Joined'`)

**Example**:
- Q1 2025: 80 people became SQO
- 15 joined (anytime, even in Q2 or Q3)
- 50 were closed lost (anytime)
- 15 are still open

**Rate**: 15 / 65 = 23.1% (only resolved: 15 joined + 50 closed lost = 65)

---

## Date Attribution Logic

### How Dates Are Used

Each conversion rate uses a specific date field to determine which period a record belongs to (the cohort):

| Conversion | Cohort Date Field | Data Type | Filter Pattern |
|------------|------------------|-----------|----------------|
| Contacted→MQL | `stage_entered_contacting__c` | TIMESTAMP | `TIMESTAMP(@startDate)` to `TIMESTAMP(@endDate)` |
| MQL→SQL | `mql_stage_entered_ts` | TIMESTAMP | `TIMESTAMP(@startDate)` to `TIMESTAMP(@endDate)` |
| SQL→SQO | `converted_date_raw` | DATE | `DATE(@startDate)` to `DATE(@endDate)` |
| SQO→Joined | `Date_Became_SQO__c` | TIMESTAMP | `TIMESTAMP(@startDate)` to `TIMESTAMP(@endDate)` |

### Important Notes:

1. **TIMESTAMP vs DATE**: 
   - TIMESTAMP fields require `TIMESTAMP()` wrapper: `TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)`
   - DATE fields use direct comparison: `v.converted_date_raw >= @startDate`

2. **Date Range Filtering**:
   - Records are included in a period if their cohort date falls within the date range
   - The resolution date (when they converted or closed) does NOT need to be in the same period

---

## Cross-Period Conversions

### How It Works

Cohort mode tracks conversions across periods. A record that enters a stage in Q1 can convert in Q2, Q3, or any future period, and it will still be counted in the Q1 cohort.

### Example: SQL in Q1, SQO in Q2

**Scenario**:
- Record A: Converted to SQL on March 15, 2025 (Q1)
- Record A: Became SQO on April 20, 2025 (Q2)

**Calculation**:
1. **Cohort Assignment**: Record A belongs to Q1 2025 cohort (based on `converted_date_raw = March 15`)
2. **Eligibility**: Record A is eligible (`eligible_for_sql_conversions = 1`) because it became SQO
3. **Progression**: Record A progressed (`sql_to_sqo_progression = 1`) because it became SQO
4. **Rate Calculation**: 
   - Q1 2025 SQL→SQO Rate includes Record A in both numerator and denominator
   - Q2 2025 SQL→SQO Rate does NOT include Record A (it's not in Q2 cohort)

**Result**: Q1 2025 SQL→SQO rate reflects all SQLs from Q1 that eventually became SQO, regardless of when they became SQO.

### Example: Contacted in Q1, MQL in Q2

**Scenario**:
- Record B: Entered Contacting stage on January 10, 2025 (Q1)
- Record B: Became MQL on April 5, 2025 (Q2)

**Calculation**:
1. **Cohort Assignment**: Record B belongs to Q1 2025 cohort (based on `stage_entered_contacting__c = January 10`)
2. **Eligibility**: Record B is eligible (`eligible_for_contacted_conversions = 1`) because it became MQL
3. **Progression**: Record B progressed (`contacted_to_mql_progression = 1`) because:
   - It became MQL (`is_mql = 1`)
   - MQL date (April 5) is >= FilterDate (January 10) ✅
4. **Rate Calculation**:
   - Q1 2025 Contacted→MQL Rate includes Record B in both numerator and denominator
   - Q2 2025 Contacted→MQL Rate does NOT include Record B (it's not in Q2 cohort)

**Result**: Q1 2025 Contacted→MQL rate reflects all contacted records from Q1 that eventually became MQL, regardless of when they became MQL.

---

## Progression Flags Explained

Progression flags are pre-calculated in `vw_funnel_master` and indicate whether a record progressed to the next stage.

### Contacted → MQL Progression

```sql
CASE 
  WHEN is_contacted = 1 
    AND is_mql = 1 
    AND mql_stage_entered_ts IS NOT NULL
    AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)  -- ⚠️ Critical check
  THEN 1 ELSE 0 
END AS contacted_to_mql_progression
```

**Key Points**:
- Requires both `is_contacted = 1` AND `is_mql = 1`
- **FilterDate Check**: Only counts MQL conversions that happened ON or AFTER the FilterDate
- **Why FilterDate?**: Prevents double-counting old MQL conversions for recycled leads (see [FilterDate and Recycled Leads](#filterdate-and-recycled-leads))

### MQL → SQL Progression

```sql
CASE WHEN is_mql = 1 AND is_sql = 1 THEN 1 ELSE 0 END AS mql_to_sql_progression
```

**Key Points**:
- Requires both `is_mql = 1` AND `is_sql = 1`
- No date check needed - once MQL, conversion to SQL is straightforward

### SQL → SQO Progression

```sql
CASE WHEN is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 1 ELSE 0 END AS sql_to_sqo_progression
```

**Key Points**:
- Requires `is_sql = 1` AND `SQO_raw = 'yes'`
- Uses `SQO_raw` field (despite the name, this represents SQO status)
- Opportunity-level metric (not lead-level)

### SQO → Joined Progression

```sql
CASE 
  WHEN LOWER(SQO_raw) = 'yes' AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
  THEN 1 ELSE 0 
END AS sqo_to_joined_progression
```

**Key Points**:
- Requires `SQO_raw = 'yes'` AND either `advisor_join_date__c IS NOT NULL` OR `StageName = 'Joined'`
- Opportunity-level metric

---

## Eligibility Flags Explained

Eligibility flags are pre-calculated in `vw_funnel_master` and indicate whether a record has reached a final outcome (is "resolved").

### Contacted Eligibility

```sql
CASE 
  WHEN is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0 
END AS eligible_for_contacted_conversions
```

**Meaning**: Contacted records that have reached a final outcome:
- ✅ Became MQL (positive resolution)
- ✅ Closed as lead (negative resolution)
- ❌ Still open (not yet MQL or closed) - **EXCLUDED**

### MQL Eligibility

```sql
CASE 
  WHEN is_mql = 1 AND (is_sql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0 
END AS eligible_for_mql_conversions
```

**Meaning**: MQL records that have reached a final outcome:
- ✅ Converted to SQL (positive resolution)
- ✅ Closed as lead (negative resolution)
- ❌ Still open (not yet SQL or closed) - **EXCLUDED**

### SQL Eligibility

```sql
CASE 
  WHEN is_sql = 1 AND (
    LOWER(SQO_raw) = 'yes' OR                    -- Became SQO (progress)
    StageName = 'Closed Lost'                     -- Closed without becoming SQO
  )
  THEN 1 
  -- Include direct opportunities (no linked lead) that became SQO
  WHEN Full_prospect_id__c IS NULL AND LOWER(SQO_raw) = 'yes'
  THEN 1
  ELSE 0 
END AS eligible_for_sql_conversions
```

**Meaning**: SQL records (Opportunities) that have reached a final outcome:
- ✅ Became SQO (positive resolution)
- ✅ Closed lost (negative resolution)
- ✅ Direct opportunities (no lead) that became SQO
- ❌ Still open (not yet SQO or closed lost) - **EXCLUDED**

**Note**: Once converted to SQL, we track Opportunity-level outcomes (`StageName`, `SQO_raw`), not Lead disposition.

### SQO Eligibility

```sql
CASE 
  WHEN LOWER(SQO_raw) = 'yes' AND (
    (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') OR 
    StageName = 'Closed Lost'
  )
  THEN 1 ELSE 0 
END AS eligible_for_sqo_conversions
```

**Meaning**: SQO records that have reached a final outcome:
- ✅ Joined (positive resolution)
- ✅ Closed lost (negative resolution)
- ❌ Still open (not yet joined or closed lost) - **EXCLUDED**

---

## FilterDate and Recycled Leads

### What is FilterDate?

`FilterDate` is a calculated field in `vw_funnel_master` that handles **recycled leads** - leads that were created, closed, and then re-opened for a new opportunity.

**Calculation**:
```sql
COALESCE(
  l.Lead_FilterDate,                    -- Lead's FilterDate (most recent of creation or stage entry)
  o.Opp_CreatedDate,                    -- Opportunity created date
  o.Date_Became_SQO__c,                 -- SQO date
  TIMESTAMP(o.advisor_join_date__c)     -- Join date
) AS FilterDate
```

**Lead FilterDate**:
```sql
GREATEST(
  IFNULL(CreatedDate, TIMESTAMP('1900-01-01')),
  IFNULL(stage_entered_new__c, TIMESTAMP('1900-01-01')),
  IFNULL(stage_entered_contacting__c, TIMESTAMP('1900-01-01'))
) AS Lead_FilterDate
```

### Why FilterDate Matters for Contacted→MQL

The `contacted_to_mql_progression` flag includes a critical check:

```sql
AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)
```

**Example: Recycled Lead**

1. **Original Timeline**:
   - Lead created: January 1, 2024
   - Entered Contacting: January 5, 2024
   - Became MQL: January 10, 2024
   - Closed: February 1, 2024

2. **Recycled Timeline**:
   - Lead re-opened: January 1, 2025
   - Entered Contacting again: January 15, 2025 (new FilterDate = Jan 15, 2025)
   - Became MQL again: January 20, 2025

**Without FilterDate Check**:
- Both MQL conversions would be counted (Jan 10, 2024 AND Jan 20, 2025)
- This would double-count the conversion

**With FilterDate Check**:
- Only the MQL conversion on Jan 20, 2025 is counted (because `Jan 20 >= Jan 15`)
- The old MQL conversion on Jan 10, 2024 is excluded (because `Jan 10 < Jan 15`)

**Result**: Each recycled lead cycle is tracked independently, preventing double-counting.

---

## Examples

### Example 1: Simple Conversion (Same Period)

**Record**: John Doe
- **Jan 5, 2025**: Entered Contacting stage (`stage_entered_contacting__c`)
- **Jan 10, 2025**: Became MQL (`mql_stage_entered_ts`)
- **Jan 15, 2025**: Converted to SQL (`converted_date_raw`)
- **Feb 1, 2025**: Became SQO (`Date_Became_SQO__c`)

**Q1 2025 Rates**:
- **Contacted→MQL**: John is in Q1 cohort (entered Contacting in Jan)
  - Eligible: ✅ (became MQL)
  - Progressed: ✅ (became MQL in Jan)
  - Counted in Q1 rate
- **MQL→SQL**: John is in Q1 cohort (became MQL in Jan)
  - Eligible: ✅ (converted to SQL)
  - Progressed: ✅ (converted to SQL in Jan)
  - Counted in Q1 rate
- **SQL→SQO**: John is in Q1 cohort (converted to SQL in Jan)
  - Eligible: ✅ (became SQO)
  - Progressed: ✅ (became SQO in Feb, but still counted in Q1 cohort)
  - Counted in Q1 rate

**Note**: Even though John became SQO in February (Q1), he's still counted in Q1 SQL→SQO rate because his SQL conversion date (Jan 15) is in Q1.

---

### Example 2: Cross-Quarter Conversion

**Record**: Jane Smith
- **Oct 10, 2025**: Entered Contacting stage
- **Oct 15, 2025**: Became MQL
- **Nov 5, 2025**: Converted to SQL
- **Jan 20, 2026**: Became SQO (next quarter!)

**Q4 2025 Rates**:
- **Contacted→MQL**: Jane is in Q4 cohort (entered Contacting in Oct)
  - Eligible: ✅ (became MQL)
  - Progressed: ✅ (became MQL in Oct)
  - Counted in Q4 rate
- **MQL→SQL**: Jane is in Q4 cohort (became MQL in Oct)
  - Eligible: ✅ (converted to SQL)
  - Progressed: ✅ (converted to SQL in Nov)
  - Counted in Q4 rate
- **SQL→SQO**: Jane is in Q4 cohort (converted to SQL in Nov)
  - Eligible: ✅ (became SQO in Jan 2026)
  - Progressed: ✅ (became SQO in Jan 2026)
  - **Counted in Q4 rate** (even though SQO happened in Q1 2026!)

**Q1 2026 Rates**:
- **SQL→SQO**: Jane is NOT in Q1 cohort (she converted to SQL in Nov 2025, not Q1 2026)
  - Not counted in Q1 rate

**Key Insight**: Jane's SQO conversion in Q1 2026 is attributed to her Q4 2025 SQL cohort, not Q1 2026.

---

### Example 3: Closed Without Conversion

**Record**: Bob Johnson
- **Jan 10, 2025**: Entered Contacting stage
- **Jan 15, 2025**: Became MQL
- **Feb 1, 2025**: Converted to SQL
- **Mar 1, 2025**: Closed Lost (never became SQO)

**Q1 2025 Rates**:
- **Contacted→MQL**: Bob is in Q1 cohort
  - Eligible: ✅ (became MQL)
  - Progressed: ✅ (became MQL)
  - Counted in Q1 rate
- **MQL→SQL**: Bob is in Q1 cohort
  - Eligible: ✅ (converted to SQL)
  - Progressed: ✅ (converted to SQL)
  - Counted in Q1 rate
- **SQL→SQO**: Bob is in Q1 cohort
  - Eligible: ✅ (closed lost = resolved)
  - Progressed: ❌ (never became SQO)
  - **Counted in denominator but NOT numerator**
  - Rate: 0 / 1 = 0% (for Bob's contribution)

**Key Insight**: Closed lost records are included in denominators (they're resolved) but not in numerators (they didn't progress).

---

### Example 4: Still Open (Not Resolved)

**Record**: Alice Williams
- **Jan 10, 2025**: Entered Contacting stage
- **Jan 15, 2025**: Became MQL
- **Feb 1, 2025**: Converted to SQL
- **Current**: Still in Discovery stage (not yet SQO or closed)

**Q1 2025 Rates**:
- **Contacted→MQL**: Alice is in Q1 cohort
  - Eligible: ✅ (became MQL)
  - Progressed: ✅ (became MQL)
  - Counted in Q1 rate
- **MQL→SQL**: Alice is in Q1 cohort
  - Eligible: ✅ (converted to SQL)
  - Progressed: ✅ (converted to SQL)
  - Counted in Q1 rate
- **SQL→SQO**: Alice is in Q1 cohort
  - Eligible: ❌ (still open - not yet SQO or closed lost)
  - Progressed: ❌ (not yet SQO)
  - **NOT counted in Q1 rate** (excluded from denominator)

**Key Insight**: Open records are excluded from cohort rates until they reach a final outcome.

---

## Technical Implementation

### Query Structure

Cohort mode conversion rates are calculated using pre-calculated flags from `vw_funnel_master`:

```sql
SELECT
  -- Contacted→MQL (cohort by stage_entered_contacting__c)
  SUM(CASE 
    WHEN v.stage_entered_contacting__c IS NOT NULL
      AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
    THEN v.contacted_to_mql_progression ELSE 0 
  END) as contacted_numer,
  SUM(CASE 
    WHEN v.stage_entered_contacting__c IS NOT NULL
      AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
    THEN v.eligible_for_contacted_conversions ELSE 0 
  END) as contacted_denom,
  
  -- Similar pattern for MQL→SQL, SQL→SQO, SQO→Joined
  ...
```

### Key Implementation Details:

1. **Date Filtering**: Records are filtered by their cohort date (entry date) within the selected period
2. **Flag Summation**: Progression and eligibility flags are summed across all records in the cohort
3. **Rate Calculation**: `rate = numerator / denominator` (with safe division to handle zero denominators)

### View Location

All progression and eligibility flags are calculated in:
- **View**: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
- **File**: `views/vw_funnel_master.sql`
- **CTE**: `Final` (lines 200-380)

### Query Function Location

Cohort mode conversion rate queries are implemented in:
- **File**: `src/lib/queries/conversion-rates.ts`
- **Function**: `getConversionRates(filters, mode: 'cohort')`
- **Lines**: 248-312

---

## Summary

### Cohort Mode Conversion Rates:

1. **Track efficiency**: "Of records from this period, what % converted?"
2. **Resolved-only**: Only includes records with final outcomes (converted OR closed)
3. **Cross-period**: Tracks conversions that happen in future periods
4. **Same population**: Numerator is always a subset of denominator
5. **0-100% range**: Rates cannot exceed 100%

### Key Date Fields:

- **Contacted→MQL**: Cohort by `stage_entered_contacting__c`
- **MQL→SQL**: Cohort by `mql_stage_entered_ts`
- **SQL→SQO**: Cohort by `converted_date_raw`
- **SQO→Joined**: Cohort by `Date_Became_SQO__c`

### Critical Logic:

- **FilterDate check**: Prevents double-counting recycled leads in Contacted→MQL
- **Eligibility flags**: Only resolved records are included in denominators
- **Progression flags**: Only records that actually progressed are included in numerators
- **Cross-period tracking**: Conversions in future periods are attributed to the original cohort period

---

## Related Documentation

- **Calculation Reference**: `docs/CALCULATIONS.md` - Detailed formulas and SQL snippets
- **Filter Matrix**: `docs/FILTER-MATRIX.md` - How filters affect calculations
- **View Definition**: `views/vw_funnel_master.sql` - Source of all progression/eligibility flags
- **Query Implementation**: `src/lib/queries/conversion-rates.ts` - Actual query code

---

**Last Updated**: January 2026  
**View Version**: vw_funnel_master (with SGA lookup fix)
