# Semantic Layer Review & Validation Guide

## Purpose
This document provides step-by-step instructions for Cursor.ai to systematically review, validate, and improve the semantic layer files for the self-service AI analytics feature. Work through each section sequentially, using your MCP connection to BigQuery to validate SQL queries against live data.

## Files to Review
- `docs/semantic_layer/definitions.ts`
- `docs/semantic_layer/query-templates.ts`
- `docs/semantic_layer/index.ts`
- `docs/semantic_layer/validation-examples.ts`

## Output Files to Generate
At the end of this review, create two files:
1. `docs/semantic_layer/semantic_layer_corrections.md` - Log all changes made
2. `docs/semantic_layer/semantic_layer_admin_questions.md` - Questions for the admin about business logic

---

# PHASE 1: Schema Validation Against BigQuery

## Step 1.1: Verify vw_funnel_master Schema
Run this query against BigQuery to get the actual schema:

```sql
SELECT column_name, data_type, is_nullable
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
ORDER BY ordinal_position;
```

**Task:** Compare the returned columns against every field referenced in `definitions.ts`. Document any:
- Fields referenced in definitions.ts that don't exist in the view
- Fields in the view that might be useful but aren't in definitions.ts
- Data type mismatches (e.g., DATE vs TIMESTAMP handling)

## Step 1.2: Verify new_mapping Table Schema
```sql
SELECT column_name, data_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'new_mapping';
```

**Task:** Confirm the JOIN condition `v.Original_source = nm.original_source` uses correct field names.

## Step 1.3: Verify vw_daily_forecast Schema
```sql
SELECT column_name, data_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_daily_forecast';
```

**Task:** Confirm forecast-related queries in query-templates.ts match the actual view structure.

## Step 1.4: Verify Constants
Run these queries to validate the constants in definitions.ts:

```sql
-- Verify Recruiting Record Type ID
SELECT DISTINCT recordtypeid, record_type_name
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE record_type_name = 'Recruiting';

-- Verify Open Pipeline Stages exist
SELECT DISTINCT StageName, COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE StageName IS NOT NULL
GROUP BY StageName
ORDER BY count DESC;
```

**Task:** Confirm:
- `RECRUITING_RECORD_TYPE: '012Dn000000mrO3IAI'` is correct
- `OPEN_PIPELINE_STAGES` array contains all valid open stages
- No stages are missing from the array

---

# PHASE 2: Metric SQL Validation

## Step 2.1: Test Each Volume Metric
For each volume metric in `VOLUME_METRICS`, run a test query to verify it returns sensible results.

### Test Prospects Metric
```sql
SELECT
  SUM(
    CASE 
      WHEN v.FilterDate IS NOT NULL
        AND TIMESTAMP(v.FilterDate) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.FilterDate) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN 1 ELSE 0 
    END
  ) as prospects
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test Contacted Metric
```sql
SELECT
  SUM(
    CASE 
      WHEN v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP('2025-01-31 23:59:59')
        AND v.is_contacted = 1
      THEN 1 ELSE 0 
    END
  ) as contacted
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test MQLs Metric
```sql
SELECT
  SUM(
    CASE 
      WHEN v.mql_stage_entered_ts IS NOT NULL
        AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN 1 ELSE 0 
    END
  ) as mqls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test SQLs Metric
```sql
SELECT
  SUM(
    CASE 
      WHEN v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP('2025-01-31 23:59:59')
        AND v.is_sql = 1
      THEN 1 ELSE 0 
    END
  ) as sqls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test SQOs Metric
```sql
SELECT
  SUM(
    CASE 
      WHEN v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP('2025-01-31 23:59:59')
        AND v.recordtypeid = '012Dn000000mrO3IAI'
        AND v.is_sqo_unique = 1
      THEN 1 ELSE 0 
    END
  ) as sqos
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test Joined Metric
```sql
SELECT
  SUM(
    CASE 
      WHEN v.advisor_join_date__c IS NOT NULL
        AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP('2025-01-31 23:59:59')
        AND v.is_joined_unique = 1
      THEN 1 ELSE 0 
    END
  ) as joined
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test Initial Calls Scheduled Metric
```sql
SELECT
  COUNT(DISTINCT 
    CASE 
      WHEN v.Initial_Call_Scheduled_Date__c IS NOT NULL
        AND v.Initial_Call_Scheduled_Date__c >= DATE('2025-01-01')
        AND v.Initial_Call_Scheduled_Date__c <= DATE('2025-01-31')
      THEN v.primary_key 
    END
  ) as initial_calls_scheduled
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test Qualification Calls Metric
```sql
SELECT
  COUNT(DISTINCT 
    CASE 
      WHEN v.Qualification_Call_Date__c IS NOT NULL
        AND v.Qualification_Call_Date__c >= DATE('2025-01-01')
        AND v.Qualification_Call_Date__c <= DATE('2025-01-31')
      THEN v.Full_Opportunity_ID__c 
    END
  ) as qualification_calls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test Signed Metric
```sql
SELECT
  SUM(
    CASE 
      WHEN v.Stage_Entered_Signed__c IS NOT NULL
        AND TIMESTAMP(v.Stage_Entered_Signed__c) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.Stage_Entered_Signed__c) <= TIMESTAMP('2025-01-31 23:59:59')
        AND v.is_sqo_unique = 1
      THEN 1 ELSE 0 
    END
  ) as signed
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

**Task:** For each query:
1. Verify it runs without errors
2. Check results are reasonable (not 0, not astronomically high)
3. Document any SQL syntax issues
4. Update definitions.ts if corrections needed

## Step 2.2: Test Each AUM Metric

### Test SQO AUM
```sql
SELECT
  SUM(
    CASE 
      WHEN v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP('2025-01-31 23:59:59')
        AND v.recordtypeid = '012Dn000000mrO3IAI'
        AND v.is_sqo_unique = 1
      THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) 
      ELSE 0 
    END
  ) as sqo_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test Joined AUM
```sql
SELECT
  SUM(
    CASE 
      WHEN v.advisor_join_date__c IS NOT NULL
        AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP('2025-01-31 23:59:59')
        AND v.is_joined_unique = 1
      THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) 
      ELSE 0 
    END
  ) as joined_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test Signed AUM
```sql
SELECT
  SUM(
    CASE 
      WHEN v.Stage_Entered_Signed__c IS NOT NULL
        AND TIMESTAMP(v.Stage_Entered_Signed__c) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.Stage_Entered_Signed__c) <= TIMESTAMP('2025-01-31 23:59:59')
        AND v.is_sqo_unique = 1
      THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) 
      ELSE 0 
    END
  ) as signed_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test Open Pipeline AUM
```sql
SELECT
  SUM(
    CASE 
      WHEN v.recordtypeid = '012Dn000000mrO3IAI'
        AND v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'Signed', 'On Hold', 'Planned Nurture')
        AND v.is_primary_opp_record = 1
      THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) 
      ELSE 0 
    END
  ) as open_pipeline_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test Average AUM (for Joined Advisors)
```sql
SELECT
  AVG(COALESCE(v.Underwritten_AUM__c, v.Amount)) as avg_aum,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE COALESCE(v.Underwritten_AUM__c, v.Amount) IS NOT NULL
  AND COALESCE(v.Underwritten_AUM__c, v.Amount) > 0
  AND v.is_joined_unique = 1
  AND v.advisor_join_date__c IS NOT NULL
  AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP('2025-01-01')
  AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP('2025-12-31 23:59:59');
```

**Task:** Verify:
1. All AUM queries use `COALESCE(Underwritten_AUM__c, Amount)` - NEVER adding them
2. Results are reasonable dollar amounts
3. Open pipeline has no date filter (correct behavior)

## Step 2.3: Test Conversion Rate Metrics

### Test Contacted to MQL Rate
```sql
SELECT
  SAFE_DIVIDE(
    SUM(CASE 
      WHEN v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN v.contacted_to_mql_progression ELSE 0 
    END),
    SUM(CASE 
      WHEN v.stage_entered_contacting__c IS NOT NULL
        AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN v.eligible_for_contacted_conversions_30d ELSE 0 
    END)
  ) as contacted_to_mql_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test MQL to SQL Rate
```sql
SELECT
  SAFE_DIVIDE(
    SUM(CASE 
      WHEN v.mql_stage_entered_ts IS NOT NULL
        AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN v.mql_to_sql_progression ELSE 0 
    END),
    SUM(CASE 
      WHEN v.mql_stage_entered_ts IS NOT NULL
        AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN v.eligible_for_mql_conversions ELSE 0 
    END)
  ) as mql_to_sql_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test SQL to SQO Rate
```sql
SELECT
  SAFE_DIVIDE(
    SUM(CASE 
      WHEN v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN v.sql_to_sqo_progression ELSE 0 
    END),
    SUM(CASE 
      WHEN v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN v.eligible_for_sql_conversions ELSE 0 
    END)
  ) as sql_to_sqo_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Test SQO to Joined Rate
```sql
SELECT
  SAFE_DIVIDE(
    SUM(CASE 
      WHEN v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN v.sqo_to_joined_progression ELSE 0 
    END),
    SUM(CASE 
      WHEN v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP('2025-01-31 23:59:59')
      THEN v.eligible_for_sqo_conversions ELSE 0 
    END)
  ) as sqo_to_joined_rate
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

**Task:** Verify:
1. All progression/eligibility fields exist in the view
2. Rates are between 0 and 1 (0-100%)
3. Each uses the correct cohort date field

---

# PHASE 3: Dimension Validation

## Step 3.1: Validate Channel Dimension
```sql
-- Check channel values
SELECT 
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.new_mapping` nm 
  ON v.Original_source = nm.original_source
GROUP BY channel
ORDER BY record_count DESC
LIMIT 20;
```

**Task:** Document all channel values for reference. These should be available for filtering.

## Step 3.2: Validate Source Dimension
```sql
-- Check top sources
SELECT 
  v.Original_source as source,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Original_source IS NOT NULL
GROUP BY source
ORDER BY record_count DESC
LIMIT 50;
```

**Task:** Note the variety of sources. These are dynamic values the agent can filter by.

## Step 3.3: Validate SGA Dimension
```sql
-- Check SGA names
SELECT 
  v.SGA_Owner_Name__c as sga,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.SGA_Owner_Name__c IS NOT NULL
GROUP BY sga
ORDER BY record_count DESC
LIMIT 30;
```

**Task:** Document active SGAs. Consider adding an `activeSGAs` list to definitions.ts.

## Step 3.4: Validate SGM Dimension
```sql
-- Check SGM names
SELECT 
  v.SGM_Owner_Name__c as sgm,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.SGM_Owner_Name__c IS NOT NULL
GROUP BY sgm
ORDER BY record_count DESC
LIMIT 30;
```

**Task:** Document active SGMs.

## Step 3.5: Validate Experimentation Tags
```sql
-- Check experimentation tags
SELECT 
  tag,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v,
UNNEST(v.Experimentation_Tag_List) as tag
WHERE tag IS NOT NULL AND tag != ''
GROUP BY tag
ORDER BY record_count DESC
LIMIT 30;
```

**Task:** Verify UNNEST works correctly with the array field. Document common tags.

## Step 3.6: Validate Stage Names
```sql
-- Check all stage names
SELECT 
  v.StageName as stage,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.StageName IS NOT NULL
GROUP BY stage
ORDER BY record_count DESC;
```

**Task:** Compare against `OPEN_PIPELINE_STAGES` in definitions.ts. Make sure all stages are accounted for.

## Step 3.7: Validate AUM Tiers
```sql
-- Check AUM tier distribution
SELECT 
  v.aum_tier,
  COUNT(*) as record_count,
  AVG(COALESCE(v.Underwritten_AUM__c, v.Amount)) as avg_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.aum_tier IS NOT NULL
GROUP BY v.aum_tier
ORDER BY avg_aum DESC;
```

**Task:** Verify the tier definitions match reality.

## Step 3.8: Validate External Agency
```sql
-- Check external agencies
SELECT 
  v.External_Agency__c as agency,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.External_Agency__c IS NOT NULL
GROUP BY agency
ORDER BY record_count DESC
LIMIT 20;
```

**Task:** Document common agencies.

---

# PHASE 4: Query Template Validation

## Step 4.1: Test metric_by_dimension Template
```sql
-- SQOs by Channel this quarter (example)
SELECT 
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as dimension_value,
  SUM(
    CASE 
      WHEN v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP('2025-03-31 23:59:59')
        AND v.recordtypeid = '012Dn000000mrO3IAI'
        AND v.is_sqo_unique = 1
      THEN 1 ELSE 0 
    END
  ) as metric_value
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.new_mapping` nm ON v.Original_source = nm.original_source
GROUP BY dimension_value
HAVING metric_value > 0
ORDER BY metric_value DESC;
```

**Task:** Verify this pattern works and returns expected results.

## Step 4.2: Test conversion_by_dimension Template
```sql
-- SQL to SQO rate by channel
SELECT
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as dimension_value,
  SAFE_DIVIDE(
    SUM(CASE 
      WHEN v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP('2025-03-31 23:59:59')
      THEN v.sql_to_sqo_progression ELSE 0 
    END),
    SUM(CASE 
      WHEN v.converted_date_raw IS NOT NULL
        AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP('2025-01-01')
        AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP('2025-03-31 23:59:59')
      THEN v.eligible_for_sql_conversions ELSE 0 
    END)
  ) as rate,
  SUM(CASE 
    WHEN v.converted_date_raw IS NOT NULL
      AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP('2025-01-01')
      AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP('2025-03-31 23:59:59')
    THEN v.sql_to_sqo_progression ELSE 0 
  END) as numerator,
  SUM(CASE 
    WHEN v.converted_date_raw IS NOT NULL
      AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP('2025-01-01')
      AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP('2025-03-31 23:59:59')
    THEN v.eligible_for_sql_conversions ELSE 0 
  END) as denominator
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.new_mapping` nm ON v.Original_source = nm.original_source
GROUP BY dimension_value
HAVING denominator > 0
ORDER BY rate DESC;
```

## Step 4.3: Test metric_trend Template
```sql
-- Monthly SQO trend
SELECT
  FORMAT_DATE('%Y-%m', DATE(v.Date_Became_SQO__c)) as period,
  SUM(
    CASE 
      WHEN v.recordtypeid = '012Dn000000mrO3IAI'
        AND v.is_sqo_unique = 1
      THEN 1 ELSE 0 
    END
  ) as metric_value
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.Date_Became_SQO__c IS NOT NULL
  AND v.Date_Became_SQO__c >= TIMESTAMP('2024-01-01')
  AND v.Date_Became_SQO__c <= TIMESTAMP('2025-12-31')
GROUP BY period
ORDER BY period ASC;
```

## Step 4.4: Test scheduled_calls_list Template
```sql
-- Initial calls scheduled for a week
SELECT 
  v.primary_key,
  v.advisor_name,
  v.Initial_Call_Scheduled_Date__c as call_date,
  v.SGA_Owner_Name__c as sga,
  v.Original_source as source,
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
  v.Lead_Score_Tier__c as lead_score_tier,
  v.TOF_Stage as tof_stage,
  v.lead_url,
  v.opportunity_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.new_mapping` nm ON v.Original_source = nm.original_source
WHERE v.Initial_Call_Scheduled_Date__c IS NOT NULL
  AND v.Initial_Call_Scheduled_Date__c >= DATE('2025-01-20')
  AND v.Initial_Call_Scheduled_Date__c <= DATE('2025-01-26')
ORDER BY v.Initial_Call_Scheduled_Date__c ASC, v.SGA_Owner_Name__c
LIMIT 100;
```

## Step 4.5: Test open_pipeline_list Template
```sql
-- Open pipeline
SELECT 
  v.primary_key,
  v.advisor_name,
  v.SGA_Owner_Name__c as sga,
  v.SGM_Owner_Name__c as sgm,
  v.Original_source as source,
  COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
  COALESCE(v.Underwritten_AUM__c, v.Amount) as aum,
  v.aum_tier,
  v.StageName as stage,
  v.Date_Became_SQO__c as sqo_date,
  v.lead_url,
  v.opportunity_url
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.Tableau_Views.new_mapping` nm ON v.Original_source = nm.original_source
WHERE v.recordtypeid = '012Dn000000mrO3IAI'
  AND v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'Signed', 'On Hold', 'Planned Nurture')
  AND v.is_sqo_unique = 1
ORDER BY COALESCE(v.Underwritten_AUM__c, v.Amount) DESC NULLS LAST
LIMIT 100;
```

---

# PHASE 5: Cross-Reference with Existing Dashboard Queries

## Step 5.1: Compare with funnel-metrics.ts
Open `src/lib/queries/funnel-metrics.ts` and verify:
1. The date field for each metric matches what's in definitions.ts
2. The SGA filter logic matches (lead-level vs opportunity-level)
3. The required filters (recordtypeid, is_sqo_unique, is_joined_unique) are consistent

**Task:** Document any discrepancies and update definitions.ts to match the proven dashboard queries.

## Step 5.2: Compare with conversion-rates.ts
Open `src/lib/queries/conversion-rates.ts` and verify:
1. Cohort date fields match
2. Progression and eligibility fields are used correctly
3. The SAFE_DIVIDE pattern is consistent

## Step 5.3: Compare with source-performance.ts
Open `src/lib/queries/source-performance.ts` and verify:
1. Channel JOIN logic is identical
2. All metrics match
3. Conversion rate calculations match

## Step 5.4: Compare with detail-records.ts
Open `src/lib/queries/detail-records.ts` and verify:
1. All detail fields are available for list templates
2. Date field switching logic is captured

## Step 5.5: Compare with weekly-actuals.ts
Open `src/lib/queries/weekly-actuals.ts` and verify:
1. Initial calls and qualification calls queries match
2. Week truncation logic is correct

---

# PHASE 6: Gap Analysis

## Step 6.1: Identify Missing Metrics
Compare the semantic layer against the Funnel Performance Dashboard features. Check for:

1. **Period-over-period calculations** - Is there a template for "this quarter vs last quarter" changes?
2. **Attainment vs goals** - Can we calculate % of forecast achieved?
3. **Rolling averages** - Do we need trailing 30/60/90 day metrics?
4. **Lead velocity** - Time from contacted to MQL, MQL to SQL, etc.?

## Step 6.2: Identify Missing Dimensions
Are there any filter options in the dashboard that aren't in the semantic layer?

1. Record Type filter (Recruiting vs Re-Engagement)
2. Date of specific stages (e.g., "show me opps in Discovery that entered Discovery this quarter")
3. Lead Score Tier filtering

## Step 6.3: Identify Missing Question Patterns
Review `validation-examples.ts` and consider what questions users might ask that aren't covered:

1. "What's my conversion rate from MQL to Joined?" (multi-step conversion)
2. "Show me the pipeline by stage" (stage breakdown, not just totals)
3. "Who hasn't had activity in 30 days?" (stale pipeline)
4. "What's the average time from SQL to SQO?" (velocity)

---

# PHASE 7: Advanced Query Needs

## Step 7.1: Consider Multi-Stage Conversions
Users might ask "What's our MQL to Joined rate?" This requires calculating across multiple stages.

**Task:** Determine if we need to add composite conversion metrics.

## Step 7.2: Consider Time-to-Convert Metrics
Users might ask "How long does it take for an MQL to become SQL?"

**Task:** Check if the view has the date fields needed to calculate stage-to-stage duration.

```sql
-- Example: Time from MQL to SQL
SELECT
  AVG(DATE_DIFF(DATE(v.converted_date_raw), DATE(v.mql_stage_entered_ts), DAY)) as avg_days_mql_to_sql,
  PERCENTILE_CONT(DATE_DIFF(DATE(v.converted_date_raw), DATE(v.mql_stage_entered_ts), DAY), 0.5) 
    OVER() as median_days_mql_to_sql
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.mql_stage_entered_ts IS NOT NULL
  AND v.converted_date_raw IS NOT NULL
  AND v.is_sql = 1;
```

## Step 7.3: Consider Stage-by-Stage Pipeline
Users might ask "How many opportunities are in each stage?"

```sql
-- Pipeline by stage
SELECT
  v.StageName as stage,
  COUNT(*) as opp_count,
  SUM(COALESCE(v.Underwritten_AUM__c, v.Amount, 0)) as total_aum
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
WHERE v.recordtypeid = '012Dn000000mrO3IAI'
  AND v.is_sqo_unique = 1
  AND v.StageName IN ('Qualifying', 'Discovery', 'Sales Process', 'Negotiating', 'Signed', 'On Hold')
GROUP BY stage
ORDER BY 
  CASE stage
    WHEN 'Qualifying' THEN 1
    WHEN 'Discovery' THEN 2
    WHEN 'Sales Process' THEN 3
    WHEN 'Negotiating' THEN 4
    WHEN 'Signed' THEN 5
    WHEN 'On Hold' THEN 6
  END;
```

**Task:** Consider adding a `pipeline_by_stage` template.

---

# PHASE 8: SGA-Specific Queries

## Step 8.1: Validate SGA Filter Logic
The definitions.ts has two SGA filter patterns. Verify they work correctly:

### Lead-level with SGA filter
```sql
-- MQLs for a specific SGA
SELECT
  SUM(
    CASE 
      WHEN v.mql_stage_entered_ts IS NOT NULL
        AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP('2025-03-31 23:59:59')
        AND v.SGA_Owner_Name__c = 'John Doe'  -- Replace with actual SGA name
      THEN 1 ELSE 0 
    END
  ) as mqls
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

### Opportunity-level with SGA filter
```sql
-- SQOs for a specific SGA (check both fields)
SELECT
  SUM(
    CASE 
      WHEN v.Date_Became_SQO__c IS NOT NULL
        AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2025-01-01') 
        AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP('2025-03-31 23:59:59')
        AND v.recordtypeid = '012Dn000000mrO3IAI'
        AND v.is_sqo_unique = 1
        AND (v.SGA_Owner_Name__c = 'John Doe' OR v.Opp_SGA_Name__c = 'John Doe')
      THEN 1 ELSE 0 
    END
  ) as sqos
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

**Task:** Verify the OR logic for opportunity-level SGA filtering is correct and produces expected results.

## Step 8.2: Consider SGA Performance Summary
Users will frequently ask "How is [SGA name] doing this quarter?" 

**Task:** Consider adding an `sga_summary` template that returns all key metrics for an SGA in one query.

---

# PHASE 9: Date Handling Validation

## Step 9.1: Verify DATE vs TIMESTAMP Handling
Different fields have different types. Verify the SQL handles each correctly:

```sql
-- Check data types
SELECT 
  'FilterDate' as field, 
  MIN(FilterDate) as min_val, 
  MAX(FilterDate) as max_val,
  COUNT(*) as non_null_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE FilterDate IS NOT NULL

UNION ALL

SELECT 
  'converted_date_raw' as field, 
  TIMESTAMP(MIN(converted_date_raw)) as min_val, 
  TIMESTAMP(MAX(converted_date_raw)) as max_val,
  COUNT(*) as non_null_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw IS NOT NULL

UNION ALL

SELECT 
  'advisor_join_date__c' as field, 
  TIMESTAMP(MIN(advisor_join_date__c)) as min_val, 
  TIMESTAMP(MAX(advisor_join_date__c)) as max_val,
  COUNT(*) as non_null_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_join_date__c IS NOT NULL;
```

**Task:** Ensure each date field in definitions.ts has the correct type annotation and the SQL handles conversions properly.

## Step 9.2: Validate Date Range SQL
Test that the DATE_RANGES in definitions.ts produce correct dates:

```sql
-- Test this_quarter
SELECT 
  DATE_TRUNC(CURRENT_DATE(), QUARTER) as start_date,
  CURRENT_DATE() as end_date;

-- Test last_quarter  
SELECT
  DATE_TRUNC(DATE_SUB(CURRENT_DATE(), INTERVAL 1 QUARTER), QUARTER) as start_date,
  DATE_SUB(DATE_TRUNC(CURRENT_DATE(), QUARTER), INTERVAL 1 DAY) as end_date;

-- Test next_week
SELECT
  DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 1 WEEK) as start_date,
  DATE_ADD(DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY)), INTERVAL 13 DAY) as end_date;
```

---

# PHASE 10: Final Validation & Documentation

## Step 10.1: Run Full Funnel Query
Test a complete funnel metrics query that matches the dashboard:

```sql
SELECT
  -- Prospects
  SUM(CASE WHEN v.FilterDate IS NOT NULL
    AND TIMESTAMP(v.FilterDate) >= TIMESTAMP('2025-01-01') 
    AND TIMESTAMP(v.FilterDate) <= TIMESTAMP('2025-03-31 23:59:59')
  THEN 1 ELSE 0 END) as prospects,
  
  -- Contacted
  SUM(CASE WHEN v.stage_entered_contacting__c IS NOT NULL
    AND TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP('2025-01-01') 
    AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP('2025-03-31 23:59:59')
    AND v.is_contacted = 1
  THEN 1 ELSE 0 END) as contacted,
  
  -- MQLs
  SUM(CASE WHEN v.mql_stage_entered_ts IS NOT NULL
    AND TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP('2025-01-01') 
    AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP('2025-03-31 23:59:59')
  THEN 1 ELSE 0 END) as mqls,
  
  -- SQLs
  SUM(CASE WHEN v.converted_date_raw IS NOT NULL
    AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP('2025-01-01') 
    AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP('2025-03-31 23:59:59')
    AND v.is_sql = 1
  THEN 1 ELSE 0 END) as sqls,
  
  -- SQOs
  SUM(CASE WHEN v.Date_Became_SQO__c IS NOT NULL
    AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP('2025-01-01') 
    AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP('2025-03-31 23:59:59')
    AND v.recordtypeid = '012Dn000000mrO3IAI'
    AND v.is_sqo_unique = 1
  THEN 1 ELSE 0 END) as sqos,
  
  -- Joined
  SUM(CASE WHEN v.advisor_join_date__c IS NOT NULL
    AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP('2025-01-01') 
    AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP('2025-03-31 23:59:59')
    AND v.is_joined_unique = 1
  THEN 1 ELSE 0 END) as joined,
  
  -- Joined AUM
  SUM(CASE WHEN v.advisor_join_date__c IS NOT NULL
    AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP('2025-01-01') 
    AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP('2025-03-31 23:59:59')
    AND v.is_joined_unique = 1
  THEN COALESCE(v.Underwritten_AUM__c, v.Amount, 0) ELSE 0 END) as joined_aum
  
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v;
```

**Task:** Compare these results with the actual dashboard for Q1 2025. They should match.

## Step 10.2: Generate Output Files

### Create semantic_layer_corrections.md
Document all changes made during this review:
- Schema corrections
- SQL syntax fixes
- Missing fields added
- Logic corrections
- New templates added

### Create semantic_layer_admin_questions.md
Document questions that need admin input:
- Business logic clarifications
- Metric definition confirmations
- Missing functionality requests
- Priority of new features

---

# PHASE 11: Additional Templates to Consider

Based on the review, consider adding these templates to query-templates.ts:

## 11.1: Pipeline by Stage
```typescript
pipeline_by_stage: {
  id: 'pipeline_by_stage',
  description: 'Show open pipeline broken down by opportunity stage',
  // ... template details
}
```

## 11.2: SGA Summary Dashboard
```typescript
sga_summary: {
  id: 'sga_summary', 
  description: 'Complete performance summary for a specific SGA',
  // ... returns all key metrics in one query
}
```

## 11.3: Time to Convert
```typescript
time_to_convert: {
  id: 'time_to_convert',
  description: 'Average days between funnel stages',
  // ... velocity metrics
}
```

## 11.4: Multi-Stage Conversion
```typescript
multi_stage_conversion: {
  id: 'multi_stage_conversion',
  description: 'Calculate conversion rate across multiple stages (e.g., MQL to Joined)',
  // ... composite rate calculation
}
```

## 11.5: Stale Pipeline
```typescript
stale_pipeline: {
  id: 'stale_pipeline',
  description: 'Opportunities with no activity in X days',
  // ... identify stuck deals
}
```

---

# Final Checklist

Before completing this review, confirm:

- [ ] All metric SQL validated against BigQuery
- [ ] All dimensions verified to exist
- [ ] All templates tested with real queries
- [ ] Cross-referenced with existing dashboard queries
- [ ] SGA filter logic verified for lead vs opp level
- [ ] Date handling confirmed for DATE vs TIMESTAMP fields
- [ ] AUM calculations use COALESCE (never ADD)
- [ ] Deduplication flags (is_sqo_unique, is_joined_unique) used correctly
- [ ] Record type filter (recruiting) applied where needed
- [ ] semantic_layer_corrections.md generated
- [ ] semantic_layer_admin_questions.md generated

---

# Output File Templates

## semantic_layer_corrections.md Template

```markdown
# Semantic Layer Corrections Log

## Date: [YYYY-MM-DD]

## Summary
- Total corrections made: X
- Files modified: [list]

## Schema Corrections
| Field | Issue | Resolution |
|-------|-------|------------|
| ... | ... | ... |

## SQL Syntax Fixes
| File | Location | Original | Corrected |
|------|----------|----------|-----------|
| ... | ... | ... | ... |

## Missing Fields Added
| Field | Description | File |
|-------|-------------|------|
| ... | ... | ... |

## New Templates Added
| Template ID | Description | Rationale |
|-------------|-------------|-----------|
| ... | ... | ... |

## Logic Corrections
| Issue | Original Logic | Corrected Logic | Rationale |
|-------|----------------|-----------------|-----------|
| ... | ... | ... | ... |
```

## semantic_layer_admin_questions.md Template

```markdown
# Semantic Layer Admin Questions

## Date: [YYYY-MM-DD]

## Business Logic Questions

### Question 1: [Title]
**Context:** [Explanation of what we found]
**Question:** [Specific question]
**Options:**
- A: [Option A]
- B: [Option B]
**Impact:** [What changes based on the answer]

### Question 2: ...

## Metric Definition Confirmations

### [Metric Name]
**Current Definition:** [How it's defined]
**Concern:** [What needs clarification]
**Please Confirm:** [Specific confirmation needed]

## Missing Functionality Requests

### [Feature Name]
**User Need:** [What users might ask for]
**Current Gap:** [What's missing]
**Proposed Solution:** [How we could add it]
**Priority Request:** [Please indicate priority: High/Medium/Low]

## Data Quality Observations

### [Observation Title]
**Finding:** [What we observed]
**Question:** [What we need to understand]
**Potential Impact:** [How this affects the semantic layer]
```

---

# END OF REVIEW GUIDE

Work through each phase sequentially. Use BigQuery MCP to validate all SQL. Make corrections directly to the files. Generate the two output documents at the end.
