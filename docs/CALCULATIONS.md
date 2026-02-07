# Calculation Reference

This document provides explicit formulas and SQL snippets for all metrics calculated in the Savvy Funnel Analytics Dashboard. It covers both **Period Mode** (activity-based) and **Cohort Mode** (resolved-only) calculations.

## Table of Contents

1. [Calculation Modes Overview](#calculation-modes-overview)
2. [Conversion Rate Formulas](#conversion-rate-formulas)
3. [Volume Metrics](#volume-metrics)
4. [Opportunity Stage Metrics](#opportunity-stage-metrics)
5. [Open Pipeline AUM](#open-pipeline-aum)
6. [Resolution and Flagging Logic](#resolution-and-flagging-logic)
7. [Period vs Cohort Mode Details](#period-vs-cohort-mode-details)

---

## Calculation Modes Overview

### Period Mode (Activity-Based)
- **Question**: "What conversion activity happened in this period?"
- **Numerator**: Records reaching next stage IN the period (by that stage's date)
- **Denominator**: Records reaching current stage IN the period (by that stage's date)
- **Resolution**: Records must ENTER and RESOLVE within the same period
- **Population**: Different populations for numerator and denominator
- **Rate Range**: Can exceed 100% (different populations)
- **Best For**: Activity tracking, sales dashboards, operational metrics
- **Excludes**: In-flight records (entered but not resolved in period)

### Cohort Mode (Resolved-Only)
- **Question**: "Of records from this period, what % converted?"
- **Numerator**: Uses pre-calculated `*_progression` flags from `vw_funnel_master`
- **Denominator**: Uses pre-calculated `eligible_for_*_conversions` flags from `vw_funnel_master`
- **Resolution**: Only includes RESOLVED records (converted OR closed/lost)
- **Population**: Same population for numerator and denominator
- **Rate Range**: Always 0-100% (same population)
- **Best For**: Funnel efficiency, forecasting, conversion analysis
- **Excludes**: Open records (not yet resolved)

---

## Conversion Rate Formulas

### Contacted → MQL Rate

#### Period Mode
```
Formula: (MQLs in period) / (Contacted AND resolved in period) × 100

Numerator:
  COUNT(*) WHERE 
    stage_entered_contacting__c IN date_range
    AND is_contacted = 1
    AND mql_stage_entered_ts IN date_range
    AND mql_stage_entered_ts >= stage_entered_contacting__c  -- Handles recycled leads

Denominator:
  COUNT(*) WHERE 
    stage_entered_contacting__c IN date_range
    AND is_contacted = 1
    AND (
      -- Resolved by becoming MQL in period
      (mql_stage_entered_ts IN date_range)
      OR
      -- Resolved by being closed in period
      (lead_closed_date IN date_range)
      OR
      -- Resolved by 30-day rule: no MQL, no close, 30+ days in Contacting
      (mql_stage_entered_ts IS NULL AND lead_closed_date IS NULL AND DATE(stage_entered_contacting__c) + 30 <= CURRENT_DATE())
    )
```

**SQL Example (Period Mode)**:
```sql
-- Numerator
COUNTIF(
  v.stage_entered_contacting__c IS NOT NULL
  AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
  AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
  AND v.is_contacted = 1
  AND v.mql_stage_entered_ts IS NOT NULL
  AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
  AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
) as contacted_numer

-- Denominator
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
    OR
    -- Resolved by 30-day rule
    (v.mql_stage_entered_ts IS NULL AND v.lead_closed_date IS NULL AND DATE(v.stage_entered_contacting__c) + 30 <= CURRENT_DATE())
  )
) as contacted_denom
```

#### Cohort Mode
```
Formula: (Progression) / (Eligible) × 100

Numerator:
  SUM(contacted_to_mql_progression) WHERE
    stage_entered_contacting__c IN date_range

Denominator:
  SUM(eligible_for_contacted_conversions_30d) WHERE
    stage_entered_contacting__c IN date_range
```
The dashboard uses `eligible_for_contacted_conversions_30d` for the Contacted→MQL denominator. Leads in Contacting for 30+ days without MQL or close are treated as resolved in the denominator (reporting only; no Salesforce change).

**SQL Example (Cohort Mode)**:
```sql
-- Numerator
SUM(CASE 
  WHEN v.stage_entered_contacting__c IS NOT NULL
    AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
    AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
  THEN v.contacted_to_mql_progression ELSE 0 
END) as contacted_numer

-- Denominator (30-day effective resolution)
SUM(CASE 
  WHEN v.stage_entered_contacting__c IS NOT NULL
    AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)
    AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate)
  THEN v.eligible_for_contacted_conversions_30d ELSE 0 
END) as contacted_denom
```

**Eligibility Flag Logic** (from `vw_funnel_master`):
```sql
-- eligible_for_contacted_conversions (resolved only: MQL or closed)
CASE 
  WHEN is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0 
END

-- eligible_for_contacted_conversions_30d (used for Contacted→MQL rate; adds 30-day rule)
CASE
  WHEN is_contacted = 1 AND (
    is_mql = 1 OR lead_closed_date IS NOT NULL
    OR (mql_stage_entered_ts IS NULL AND lead_closed_date IS NULL AND DATE(stage_entered_contacting__c) + 30 <= CURRENT_DATE())
  )
  THEN 1 ELSE 0
END

-- contacted_to_mql_progression
CASE 
  WHEN is_contacted = 1 
    AND is_mql = 1 
    AND mql_stage_entered_ts IS NOT NULL
    AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)  -- Handles recycled leads
  THEN 1 ELSE 0 
END
```

---

### MQL → SQL Rate

#### Period Mode
```
Formula: (SQLs in period) / (MQLs AND resolved in period) × 100

Numerator:
  COUNT(*) WHERE 
    mql_stage_entered_ts IN date_range
    AND is_mql = 1
    AND converted_date_raw IN date_range

Denominator:
  COUNT(*) WHERE 
    mql_stage_entered_ts IN date_range
    AND is_mql = 1
    AND (
      -- Resolved by becoming SQL in period
      (converted_date_raw IN date_range)
      OR
      -- Resolved by being closed in period
      (lead_closed_date IN date_range)
    )
```

**SQL Example (Period Mode)**:
```sql
-- Numerator
COUNTIF(
  v.mql_stage_entered_ts IS NOT NULL
  AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)
  AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate)
  AND v.is_mql = 1
  AND v.converted_date_raw IS NOT NULL
  AND DATE(v.converted_date_raw) >= DATE(@startDate)
  AND DATE(v.converted_date_raw) <= DATE(@endDate)
) as mql_numer

-- Denominator
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
) as mql_denom
```

#### Cohort Mode
```
Formula: (Progression) / (Eligible) × 100

Numerator:
  SUM(mql_to_sql_progression) WHERE
    mql_stage_entered_ts IN date_range

Denominator:
  SUM(eligible_for_mql_conversions) WHERE
    mql_stage_entered_ts IN date_range
```

**Eligibility Flag Logic** (from `vw_funnel_master`):
```sql
-- eligible_for_mql_conversions
CASE 
  WHEN is_mql = 1 AND (is_sql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0 
END

-- mql_to_sql_progression
CASE WHEN is_mql = 1 AND is_sql = 1 THEN 1 ELSE 0 END
```

---

### SQL → SQO Rate

#### Period Mode
```
Formula: (SQOs in period) / (SQLs AND resolved in period) × 100

Numerator:
  COUNT(*) WHERE 
    converted_date_raw IN date_range
    AND is_sql = 1
    AND Date_Became_SQO__c IN date_range
    AND recordtypeid = '012Dn000000mrO3IAI'  -- RECRUITING_RECORD_TYPE
    AND is_sqo_unique = 1  -- Deduplication

Denominator:
  COUNT(*) WHERE 
    converted_date_raw IN date_range
    AND is_sql = 1
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND (
      -- Resolved by becoming SQO in period
      (Date_Became_SQO__c IN date_range AND LOWER(SQO_raw) = 'yes')
      OR
      -- Resolved by being closed lost in period
      (StageName = 'Closed Lost' AND Stage_Entered_Closed__c IN date_range)
    )
```

**SQL Example (Period Mode)**:
```sql
-- Numerator
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
) as sql_numer

-- Denominator
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
    -- Resolved by being closed lost in period
    (v.StageName = 'Closed Lost' 
     AND v.Stage_Entered_Closed__c IS NOT NULL
     AND TIMESTAMP(v.Stage_Entered_Closed__c) >= TIMESTAMP(@startDate) 
     AND TIMESTAMP(v.Stage_Entered_Closed__c) <= TIMESTAMP(@endDate))
  )
) as sql_denom
```

#### Cohort Mode
```
Formula: (Progression) / (Eligible) × 100

Numerator:
  SUM(sql_to_sqo_progression) WHERE
    converted_date_raw IN date_range

Denominator:
  SUM(eligible_for_sql_conversions) WHERE
    converted_date_raw IN date_range
```

**Eligibility Flag Logic** (from `vw_funnel_master`):
```sql
-- eligible_for_sql_conversions
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

-- sql_to_sqo_progression
CASE WHEN is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 1 ELSE 0 END
```

**Critical Note**: Once a lead converts to an opportunity, resolution is tracked at the **Opportunity level**, not Lead level. Use `StageName = 'Closed Lost'` for opportunity closure, not `lead_closed_date`.

---

### SQO → Joined Rate

#### Period Mode
```
Formula: (Joined in period) / (SQOs AND resolved in period) × 100

Numerator:
  COUNT(*) WHERE 
    Date_Became_SQO__c IN date_range
    AND LOWER(SQO_raw) = 'yes'
    AND advisor_join_date__c IN date_range
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND is_sqo_unique = 1
    AND is_joined_unique = 1  -- Deduplication

Denominator:
  COUNT(*) WHERE 
    Date_Became_SQO__c IN date_range
    AND LOWER(SQO_raw) = 'yes'
    AND recordtypeid = '012Dn000000mrO3IAI'
    AND is_sqo_unique = 1
    AND (
      -- Resolved by joining in period
      (advisor_join_date__c IN date_range)
      OR
      -- Resolved by being closed lost in period
      (StageName = 'Closed Lost' AND Stage_Entered_Closed__c IN date_range)
    )
```

**SQL Example (Period Mode)**:
```sql
-- Numerator
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

-- Denominator
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
    -- Resolved by being closed lost in period
    (v.StageName = 'Closed Lost' 
     AND v.Stage_Entered_Closed__c IS NOT NULL
     AND TIMESTAMP(v.Stage_Entered_Closed__c) >= TIMESTAMP(@startDate) 
     AND TIMESTAMP(v.Stage_Entered_Closed__c) <= TIMESTAMP(@endDate))
  )
) as sqo_denom
```

#### Cohort Mode
```
Formula: (Progression) / (Eligible) × 100

Numerator:
  SUM(sqo_to_joined_progression) WHERE
    Date_Became_SQO__c IN date_range

Denominator:
  SUM(eligible_for_sqo_conversions) WHERE
    Date_Became_SQO__c IN date_range
```

**Eligibility Flag Logic** (from `vw_funnel_master`):
```sql
-- eligible_for_sqo_conversions
CASE 
  WHEN LOWER(SQO_raw) = 'yes' AND (
    (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') OR 
    StageName = 'Closed Lost'
  )
  THEN 1 ELSE 0 
END

-- sqo_to_joined_progression
CASE 
  WHEN LOWER(SQO_raw) = 'yes' AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
  THEN 1 ELSE 0 
END
```

---

## Volume Metrics

Volume metrics count records that reached a stage within the date range. They use specific date fields and deduplication flags.

### MQLs
```
COUNT(*) WHERE 
  mql_stage_entered_ts IN date_range
  AND is_mql = 1
```

**SQL**:
```sql
SUM(
  CASE 
    WHEN mql_stage_entered_ts IS NOT NULL
      AND TIMESTAMP(mql_stage_entered_ts) >= TIMESTAMP(@startDate) 
      AND TIMESTAMP(mql_stage_entered_ts) <= TIMESTAMP(@endDate)
    THEN 1 
    ELSE 0 
  END
) as mqls
```

### SQLs
```
COUNT(*) WHERE 
  converted_date_raw IN date_range
  AND is_sql = 1
```

**SQL**:
```sql
SUM(
  CASE 
    WHEN converted_date_raw IS NOT NULL
      AND TIMESTAMP(converted_date_raw) >= TIMESTAMP(@startDate) 
      AND TIMESTAMP(converted_date_raw) <= TIMESTAMP(@endDate)
      AND is_sql = 1
    THEN 1 
    ELSE 0 
  END
) as sqls
```

### SQOs
```
COUNT(*) WHERE 
  Date_Became_SQO__c IN date_range
  AND recordtypeid = '012Dn000000mrO3IAI'  -- RECRUITING_RECORD_TYPE
  AND is_sqo_unique = 1  -- CRITICAL: Use unique flag for deduplication
```

**SQL**:
```sql
SUM(
  CASE 
    WHEN Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(Date_Became_SQO__c) >= TIMESTAMP(@startDate) 
      AND TIMESTAMP(Date_Became_SQO__c) <= TIMESTAMP(@endDate)
      AND recordtypeid = @recruitingRecordType
      AND is_sqo_unique = 1  -- Deduplication: one count per opportunity
    THEN 1 
    ELSE 0 
  END
) as sqos
```

### Joined
```
COUNT(*) WHERE 
  advisor_join_date__c IN date_range
  AND is_joined_unique = 1  -- CRITICAL: Use unique flag for deduplication
```

**SQL**:
```sql
SUM(
  CASE 
    WHEN advisor_join_date__c IS NOT NULL
      AND DATE(advisor_join_date__c) >= DATE(@startDate) 
      AND DATE(advisor_join_date__c) <= DATE(@endDate)
      AND is_joined_unique = 1  -- Deduplication: one count per opportunity
    THEN 1 
    ELSE 0 
  END
) as joined
```

### Signed
```
COUNT(*) WHERE 
  Stage_Entered_Signed__c IN date_range
  AND is_primary_opp_record = 1  -- CRITICAL: Use primary record flag for deduplication
```

**SQL**:
```sql
SUM(
  CASE 
    WHEN Stage_Entered_Signed__c IS NOT NULL
      AND TIMESTAMP(Stage_Entered_Signed__c) >= TIMESTAMP(@startDate) 
      AND TIMESTAMP(Stage_Entered_Signed__c) <= TIMESTAMP(@endDate)
      AND is_primary_opp_record = 1  -- Deduplication: one count per opportunity
    THEN 1 
    ELSE 0 
  END
) as signed
```

**Important Notes**:
- Uses `is_primary_opp_record = 1` (not `is_signed_unique`) to handle multiple leads converting to same opportunity
- Records may have moved past "Signed" stage (e.g., to "Joined") but are still counted if they entered "Signed" in the date range
- Date field is TIMESTAMP type, so use `TIMESTAMP()` wrapper in queries

---

## Opportunity Stage Metrics

Opportunity stages represent the progression of an opportunity after a lead converts (SQL). Each stage has an associated `Stage_Entered_*` timestamp field that records when the opportunity entered that stage.

### Stage Date Fields and Data Types

| Stage Name | Date Field | Data Type | Query Pattern | Deduplication |
|------------|------------|-----------|---------------|---------------|
| **Qualifying** | None | N/A | Filter by `StageName = 'Qualifying'` | N/A |
| **Discovery** | `Stage_Entered_Discovery__c` | TIMESTAMP | `TIMESTAMP(Stage_Entered_Discovery__c) >= TIMESTAMP(@startDate)` | Use `is_primary_opp_record = 1` |
| **Sales Process** | `Stage_Entered_Sales_Process__c` | TIMESTAMP | `TIMESTAMP(Stage_Entered_Sales_Process__c) >= TIMESTAMP(@startDate)` | Use `is_primary_opp_record = 1` |
| **Negotiating** | `Stage_Entered_Negotiating__c` | TIMESTAMP | `TIMESTAMP(Stage_Entered_Negotiating__c) >= TIMESTAMP(@startDate)` | Use `is_primary_opp_record = 1` |
| **Signed** | `Stage_Entered_Signed__c` | TIMESTAMP | `TIMESTAMP(Stage_Entered_Signed__c) >= TIMESTAMP(@startDate)` | Use `is_primary_opp_record = 1` |
| **On Hold** | `Stage_Entered_On_Hold__c` | TIMESTAMP | `TIMESTAMP(Stage_Entered_On_Hold__c) >= TIMESTAMP(@startDate)` | Use `is_primary_opp_record = 1` |
| **Closed Lost** | `Stage_Entered_Closed__c` | TIMESTAMP | `TIMESTAMP(Stage_Entered_Closed__c) >= TIMESTAMP(@startDate)` AND `StageName = 'Closed Lost'` | Use `is_primary_opp_record = 1` |
| **Joined** | `advisor_join_date__c` | DATE | `DATE(advisor_join_date__c) >= DATE(@startDate)` | Use `is_joined_unique = 1` |

### Filtering Logic

When filtering records by opportunity stage in the Record Details table:

1. **Stages with Date Fields** (Discovery, Sales Process, Negotiating, Signed, On Hold):
   - Filter by the `Stage_Entered_*` date being within the selected date range
   - **Important**: Records that have moved past the stage are still included if they entered that stage in the date range
   - Example: A record currently in "Joined" stage will appear when filtering by "Signed" if `Stage_Entered_Signed__c` is in the date range

2. **Stages without Date Fields** (Qualifying):
   - Filter by `StageName` matching the stage name
   - No date filtering applied

### Example: Signed Stage Filtering

```sql
-- Count signed opportunities in Q4 2025
SELECT COUNT(*) 
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Stage_Entered_Signed__c IS NOT NULL
  AND TIMESTAMP(Stage_Entered_Signed__c) >= TIMESTAMP('2025-10-01')
  AND TIMESTAMP(Stage_Entered_Signed__c) <= TIMESTAMP('2025-12-31 23:59:59')
  AND is_primary_opp_record = 1
```

**Key Points**:
- Uses `TIMESTAMP()` wrapper because `Stage_Entered_Signed__c` is TIMESTAMP type
- Uses `is_primary_opp_record = 1` to deduplicate opportunities with multiple leads
- Includes records even if they've moved past "Signed" (e.g., to "Joined")

### Date Column Display

The Record Details table dynamically displays the stage-specific date based on the selected stage filter:

- **Signed selected**: Shows `Stage_Entered_Signed__c`
- **Discovery selected**: Shows `Stage_Entered_Discovery__c`
- **Sales Process selected**: Shows `Stage_Entered_Sales_Process__c`
- **Negotiating selected**: Shows `Stage_Entered_Negotiating__c`
- **On Hold selected**: Shows `Stage_Entered_On_Hold__c`
- **Joined selected**: Shows `advisor_join_date__c`

This ensures users see the date relevant to the stage they're filtering by, not just the `FilterDate` or current stage date.

---

## Open Pipeline AUM

Open Pipeline AUM is a **snapshot metric** showing current state, not filtered by date range.

```
SUM(Opportunity_AUM) WHERE 
  recordtypeid = '012Dn000000mrO3IAI'
  AND StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating')
  AND is_sqo_unique = 1
  AND is_primary_opp_record = 1  -- One AUM value per opportunity
```

**SQL**:
```sql
SELECT
  SUM(CASE WHEN v.is_primary_opp_record = 1 THEN v.Opportunity_AUM ELSE 0 END) as open_pipeline_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.recordtypeid = @recruitingRecordType
  AND v.StageName IN (@stage0, @stage1, @stage2, @stage3, @stage4, @stage5, @stage6, @stage7)
  AND v.is_sqo_unique = 1
```

**Important Notes**:
- **No date filter**: Shows current state, all time
- **No channel/source/SGA/SGM filters**: Shows all open pipeline
- **Uses `is_primary_opp_record`**: Ensures AUM counted once per opportunity
- **Stage filter**: Only includes active stages (excludes 'Closed Lost', 'Joined', 'On Hold', 'Signed')

---

## Resolution and Flagging Logic

The `vw_funnel_master` view includes pre-calculated flags that handle resolution logic for cohort mode.

### Resolution Concept

A record is **resolved** when it has reached a final outcome:
- **Progressed**: Moved to the next stage
- **Closed**: Closed without progressing (Lead: `lead_closed_date`, Opportunity: `StageName = 'Closed Lost'`)

### Eligibility Flags (Denominators for Cohort Mode)

These flags identify records that are eligible for conversion calculations (have reached a final outcome):

#### `eligible_for_contacted_conversions`
```sql
CASE 
  WHEN is_contacted = 1 AND (is_mql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0 
END
```
- **Meaning**: Contacted lead that either became MQL or was closed
- **Use**: Legacy/reserved; dashboard Contacted→MQL uses `eligible_for_contacted_conversions_30d`

#### `eligible_for_contacted_conversions_30d`
```sql
CASE
  WHEN is_contacted = 1 AND (
    is_mql = 1 OR lead_closed_date IS NOT NULL
    OR (mql_stage_entered_ts IS NULL AND lead_closed_date IS NULL AND DATE(stage_entered_contacting__c) + 30 <= CURRENT_DATE())
  )
  THEN 1 ELSE 0
END
```
- **Meaning**: Contacted lead that became MQL, was closed, or has been in Contacting 30+ days without MQL or close (effectively resolved for reporting)
- **Use**: Denominator for Contacted→MQL in cohort and period mode; leads in Contacting 30+ days without MQL or close are treated as resolved (reporting only; no Salesforce change)

#### `eligible_for_mql_conversions`
```sql
CASE 
  WHEN is_mql = 1 AND (is_sql = 1 OR lead_closed_date IS NOT NULL)
  THEN 1 ELSE 0 
END
```
- **Meaning**: MQL that either became SQL or was closed
- **Use**: Denominator for MQL→SQL in cohort mode

#### `eligible_for_sql_conversions`
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
- **Meaning**: SQL (Opportunity) that either became SQO or was closed lost
- **Use**: Denominator for SQL→SQO in cohort mode
- **Note**: Once converted, resolution is tracked at Opportunity level

#### `eligible_for_sqo_conversions`
```sql
CASE 
  WHEN LOWER(SQO_raw) = 'yes' AND (
    (advisor_join_date__c IS NOT NULL OR StageName = 'Joined') OR 
    StageName = 'Closed Lost'
  )
  THEN 1 ELSE 0 
END
```
- **Meaning**: SQO that either joined or was closed lost
- **Use**: Denominator for SQO→Joined in cohort mode

### Progression Flags (Numerators for Cohort Mode)

These flags identify records that actually progressed to the next stage:

#### `contacted_to_mql_progression`
```sql
CASE 
  WHEN is_contacted = 1 
    AND is_mql = 1 
    AND mql_stage_entered_ts IS NOT NULL
    AND DATE(mql_stage_entered_ts) >= DATE(FilterDate)  -- Handles recycled leads
  THEN 1 ELSE 0 
END
```
- **Meaning**: Contacted lead that became MQL
- **Use**: Numerator for Contacted→MQL in cohort mode
- **Note**: `FilterDate` check prevents counting old MQL conversions for recycled leads

#### `mql_to_sql_progression`
```sql
CASE WHEN is_mql = 1 AND is_sql = 1 THEN 1 ELSE 0 END
```
- **Meaning**: MQL that became SQL (converted to opportunity)
- **Use**: Numerator for MQL→SQL in cohort mode

#### `sql_to_sqo_progression`
```sql
CASE WHEN is_sql = 1 AND LOWER(SQO_raw) = 'yes' THEN 1 ELSE 0 END
```
- **Meaning**: SQL (Opportunity) that became SQO
- **Use**: Numerator for SQL→SQO in cohort mode

#### `sqo_to_joined_progression`
```sql
CASE 
  WHEN LOWER(SQO_raw) = 'yes' AND (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
  THEN 1 ELSE 0 
END
```
- **Meaning**: SQO that joined
- **Use**: Numerator for SQO→Joined in cohort mode

---

## Period vs Cohort Mode Details

### Period Mode: Activity-Based Tracking

**Philosophy**: "What happened in this period?"

**Key Characteristics**:
1. **Entry AND Resolution in Same Period**: Records must both enter the stage AND resolve (progress or close) within the same period
2. **Different Populations**: Numerator and denominator can have different populations
3. **Can Exceed 100%**: Because populations differ, rates can exceed 100%
4. **Excludes In-Flight**: Records that entered but haven't resolved are excluded

**Example - Contacted→MQL (Period Mode)**:
- **Period**: Q4 2025
- **Denominator**: Leads contacted in Q4 AND resolved in Q4 (became MQL OR closed)
- **Numerator**: Leads contacted in Q4 AND became MQL in Q4
- **Result**: Shows conversion activity that completed in Q4

**Use Cases**:
- Operational dashboards
- Activity tracking
- Sales performance metrics
- "What did we accomplish this period?"

### Cohort Mode: Resolved-Only Efficiency Tracking

**Philosophy**: "How well do records from this period convert?"

**Key Characteristics**:
1. **Same Population**: Numerator and denominator use the same cohort (records from the period)
2. **Resolved Only**: Only includes records that have reached a final outcome (converted OR closed)
3. **Always 0-100%**: Same population ensures rates stay within 0-100%
4. **Excludes Open Records**: Records still in progress are excluded from denominators

**Example - Contacted→MQL (Cohort Mode)**:
- **Period**: Q4 2025
- **Cohort**: All leads contacted in Q4
- **Denominator**: Leads contacted in Q4 that are resolved (became MQL OR closed)
- **Numerator**: Leads contacted in Q4 that became MQL (anytime, not just in Q4)
- **Result**: Shows conversion efficiency of Q4 contacted leads

**Use Cases**:
- Funnel efficiency analysis
- Forecasting
- Conversion rate optimization
- "How well do our leads convert?"

### Date Field Mapping

Both modes use the same date fields for grouping, but differ in how they calculate numerators and denominators:

| Conversion | Period Num Date | Period Denom Date | Cohort Date (Both) |
|------------|----------------|-------------------|-------------------|
| Contacted→MQL | `stage_entered_contacting__c` | `stage_entered_contacting__c` | `stage_entered_contacting__c` |
| MQL→SQL | `converted_date_raw` | `mql_stage_entered_ts` | `mql_stage_entered_ts` |
| SQL→SQO | `Date_Became_SQO__c` | `converted_date_raw` | `converted_date_raw` |
| SQO→Joined | `advisor_join_date__c` | `Date_Became_SQO__c` | `Date_Became_SQO__c` |

**Key Difference**:
- **Period Mode**: Numerator and denominator may use different date fields
- **Cohort Mode**: Both numerator and denominator use the same date field (cohort date)

### When to Use Each Mode

**Use Period Mode When**:
- Tracking activity in a specific time period
- Measuring operational performance
- Showing "what happened this quarter"
- Rates can exceed 100% are acceptable

**Use Cohort Mode When**:
- Analyzing conversion efficiency
- Forecasting future performance
- Comparing conversion rates across periods
- Need rates to stay within 0-100%

---

## Deduplication Logic

### Opportunity-Level Metrics

Multiple leads can convert to the same opportunity. For opportunity-level metrics (SQO, Joined, AUM), we must deduplicate.

#### Deduplication Flags (from `vw_funnel_master`)

**`is_primary_opp_record`**:
```sql
CASE 
  WHEN Full_Opportunity_ID__c IS NULL THEN 1  -- Lead-only records
  WHEN opp_row_num = 1 THEN 1                  -- First lead for this opp
  ELSE 0 
END
```
- **Use**: For AUM calculations (one AUM value per opportunity)

**`is_sqo_unique`**:
```sql
CASE 
  WHEN LOWER(SQO_raw) = 'yes' 
    AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
  THEN 1 
  ELSE 0 
END
```
- **Use**: For SQO volume counts (one count per opportunity)

**`is_joined_unique`**:
```sql
CASE 
  WHEN (advisor_join_date__c IS NOT NULL OR StageName = 'Joined')
    AND (Full_Opportunity_ID__c IS NULL OR opp_row_num = 1)
  THEN 1 
  ELSE 0 
END
```
- **Use**: For Joined volume counts (one count per opportunity)

### When to Use Each Flag

| Metric | Use This Flag | Why |
|--------|---------------|-----|
| SQO Volume | `is_sqo_unique = 1` | One count per opportunity |
| Joined Volume | `is_joined_unique = 1` | One count per opportunity |
| Open Pipeline AUM | `is_primary_opp_record = 1` | One AUM value per opportunity |
| SQO Rate (Period) | `is_sqo_unique = 1` in numerator | Deduplicate numerator |
| SQO Rate (Cohort) | `*_progression` flags (already deduped) | Flags handle deduplication |
| Conversion Rate (any) | `is_sqo` or `is_joined` (binary flags) | For progression flags, not counts |

---

## Verification Test Cases

### Q4 2025 (October 1 - December 31, 2025)

| Metric | Expected | Query Hint |
|--------|----------|------------|
| **SQLs** | 193 | `is_sql=1`, `converted_date_raw` in range |
| **SQOs** | 144 | `is_sqo_unique=1`, `recordtypeid='012Dn000000mrO3IAI'`, `Date_Became_SQO__c` in range |
| **Joined** | 17 | `is_joined_unique=1`, `advisor_join_date__c` in range |
| **Contacted→MQL (Period)** | 3.6% | Denominator uses `stage_entered_contacting__c` with resolution in period |
| **Contacted→MQL (Cohort)** | 3.6% | Uses `eligible_for_contacted_conversions_30d` and `contacted_to_mql_progression` |
| **SQL→SQO (Period)** | 74.6% | Num: `Date_Became_SQO__c`, Denom: `converted_date_raw` (both in period) |
| **SQL→SQO (Cohort)** | 74.6% | Uses `eligible_for_sql_conversions` and `sql_to_sqo_progression` |
| **SQO→Joined (Period)** | 11.6% | Num: `advisor_join_date__c`, Denom: `Date_Became_SQO__c` (both in period) |
| **SQO→Joined (Cohort)** | 11.6% | Uses `eligible_for_sqo_conversions` and `sqo_to_joined_progression` |

### If Values Don't Match Expected:

1. **Check Date Field Usage**: Ensure using correct date field for each metric
2. **Verify Deduplication**: Confirm using `is_sqo_unique` and `is_joined_unique` for volumes
3. **Confirm Record Type Filter**: Check `recordtypeid = '012Dn000000mrO3IAI'` for SQO/Joined
4. **Compare with Reference**: Use `getConversionRates()` logic as reference implementation
5. **Check Resolution Logic**: Period mode requires entry AND resolution in same period
6. **Verify Eligibility Flags**: Cohort mode uses pre-calculated flags from `vw_funnel_master`

---

## Common Calculation Patterns

### Pattern 1: Period Mode with Resolution

```sql
-- Denominator: Entered AND resolved in period
COUNTIF(
  date_field IN date_range
  AND stage_flag = 1
  AND (
    -- Resolved by progressing
    (next_stage_date IN date_range)
    OR
    -- Resolved by closing
    (closed_date IN date_range)
  )
) as denominator

-- Numerator: Entered AND progressed in period
COUNTIF(
  date_field IN date_range
  AND stage_flag = 1
  AND next_stage_date IN date_range
) as numerator
```

### Pattern 2: Cohort Mode with Eligibility Flags

```sql
-- Denominator: Eligible (resolved) records from cohort
SUM(CASE 
  WHEN cohort_date IN date_range
  THEN eligible_for_*_conversions ELSE 0 
END) as denominator

-- Numerator: Progressed records from cohort
SUM(CASE 
  WHEN cohort_date IN date_range
  THEN *_progression ELSE 0 
END) as numerator
```

### Pattern 3: Volume Count with Deduplication

```sql
-- For opportunity-level metrics
SUM(CASE 
  WHEN date_field IN date_range
    AND recordtypeid = @recruitingRecordType
    AND is_*_unique = 1  -- Deduplication
  THEN 1 ELSE 0 
END) as volume
```

---

## References

- **View Definition**: `vw_funnel_master.sql` - Full SQL view definition
- **Implementation**: `src/lib/queries/conversion-rates.ts` - Reference implementation
- **Constants**: `src/config/constants.ts` - Record types and table names
- **Types**: `src/types/dashboard.ts` - TypeScript type definitions
