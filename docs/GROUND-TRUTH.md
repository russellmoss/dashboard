# Ground Truth Values for Dashboard Verification

> **Purpose**: This document contains verified values from BigQuery that all dashboard metrics MUST match. It includes cohort maturity guidance to ensure proper validation based on how "baked" each cohort is.
>
> **Last Updated**: January 13, 2026  
> **Verified Against**: `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`

---

## 🚨 CRITICAL: Cohort Maturity Guide

Conversion rates are **cohort-based** and take time to stabilize. A Q4 2025 SQO may not join until Q1 or Q2 2026. This means recent cohorts will have **artificially low** SQO→Joined rates that will increase over time.

### Conversion Cycle Lengths

| Conversion | Typical Cycle | Fully Stable After |
|------------|--------------|-------------------|
| Contacted→MQL | Days to weeks | 60 days |
| MQL→SQL | 30-60 days | 90 days |
| SQL→SQO | 30-90 days | 120 days |
| SQO→Joined | **90-200 days** | **200 days** |

### Cohort Maturity Status (as of January 13, 2026)

| Cohort | Days Since End | All Rates Stable? | SQO→Joined Stable? |
|--------|---------------|-------------------|-------------------|
| **Q1 2025** | 288 days | ✅ YES | ✅ YES |
| **Q2 2025** | 197 days | ✅ YES | ✅ YES |
| **Q3 2025** | 105 days | ✅ Mostly | ⚠️ MAY INCREASE |
| **Q4 2025** | 13 days | ❌ NO | ❌ WILL INCREASE |

---

## Validation Tiers

### 🟢 TIER 1: STABLE COHORTS (Q1-Q2 2025)
**Use for: Strict validation of calculation logic**

These cohorts are **fully baked**. Values will NOT change. If dashboard values don't match these, **something is broken**.

| Tolerance | Volumes | Conversion Rates |
|-----------|---------|-----------------|
| Allowed | ±0 | ±0.1% |

### 🟡 TIER 2: MATURING COHORTS (Q3 2025)
**Use for: Directional validation**

Most rates are stable. SQO→Joined may still increase slightly as late conversions come in.

| Tolerance | Volumes | Most Rates | SQO→Joined |
|-----------|---------|------------|------------|
| Allowed | ±0 | ±0.5% | May increase up to 2-3% |

### 🔴 TIER 3: CURRENT COHORTS (Q4 2025)
**Use for: Sanity checks and data flow testing only**

Rates **WILL change** as deals progress. Good for testing filters and UI, NOT for validating calculation correctness.

| What to Check | Expected Behavior |
|---------------|------------------|
| Volumes | Should match (these are point-in-time) |
| Rates | Will INCREASE over time (never decrease) |
| Direction | If rates go DOWN, something is wrong |

---

## 🟢 TIER 1: Q1 2025 (STABLE - PRIMARY VALIDATION)

**Period**: January 1, 2025 - March 31, 2025  
**Days Since End**: 288 days  
**Status**: ✅ FULLY BAKED - Use for strict validation

### Volume Metrics

| Metric | Expected Value | Tolerance |
|--------|---------------|-----------|
| SQLs | **123** | ±0 |
| SQOs | **96** | ±0 |
| Joined | **12** | ±0 |

### Conversion Rates (Cohort Mode)

| Conversion | Rate | Numerator | Denominator | Tolerance |
|------------|------|-----------|-------------|-----------|
| Contacted→MQL | **4.94%** | 314 | 6,360 | ±0.1% |
| MQL→SQL | **27.70%** | 123 | 444 | ±0.1% |
| SQL→SQO | **70.83%** | 85 | 120 | ±0.1% |
| SQO→Joined | **12.20%** | 10 | 82 | ±0.1% |

---

## 🟢 TIER 1: Q2 2025 (STABLE - SECONDARY VALIDATION)

**Period**: April 1, 2025 - June 30, 2025  
**Days Since End**: 197 days  
**Status**: ✅ FULLY BAKED - Use for strict validation

### Volume Metrics

| Metric | Expected Value | Tolerance |
|--------|---------------|-----------|
| SQLs | **155** | ±0 |
| SQOs | **110** | ±0 |
| Joined | **13** | ±0 |

### Conversion Rates (Cohort Mode)

| Conversion | Rate | Numerator | Denominator | Tolerance |
|------------|------|-----------|-------------|-----------|
| Contacted→MQL | **4.63%** | 315 | 6,809 | ±0.1% |
| MQL→SQL | **37.93%** | 154 | 406 | ±0.1% |
| SQL→SQO | **68.63%** | 105 | 153 | ±0.1% |
| SQO→Joined | **13.79%** | 12 | 87 | ±0.1% |

---

## 🟡 TIER 2: Q3 2025 (MATURING)

**Period**: July 1, 2025 - September 30, 2025  
**Days Since End**: 105 days  
**Status**: ⚠️ MOSTLY STABLE - SQO→Joined may increase

### Volume Metrics

| Metric | Expected Value | Tolerance |
|--------|---------------|-----------|
| SQLs | **221** | ±0 |
| SQOs | **133** | ±0 |
| Joined | **15** | ±0 (may increase) |

### Conversion Rates (Cohort Mode)

| Conversion | Rate | Numerator | Denominator | Notes |
|------------|------|-----------|-------------|-------|
| Contacted→MQL | **4.29%** | 400 | 9,320 | Stable |
| MQL→SQL | **46.23%** | 221 | 478 | Stable |
| SQL→SQO | **67.80%** | 139 | 205 | Stable |
| SQO→Joined | **17.53%** | 17 | 97 | ⚠️ May increase to ~20% |

---

## 🔴 TIER 3: Q4 2025 (CURRENT - SANITY CHECK ONLY)

**Period**: October 1, 2025 - December 31, 2025  
**Days Since End**: 13 days  
**Status**: ❌ IMMATURE - Values WILL change

### Volume Metrics (Point-in-time, should match)

| Metric | Value as of Jan 13, 2026 | Notes |
|--------|-------------------------|-------|
| Prospects | 22,885 | Stable |
| Contacted | 15,766 | Stable |
| MQLs | 595 | Stable |
| SQLs | 193 | Stable |
| SQOs | 144 | Stable |
| Joined | 17 | **Will increase** |

### Conversion Rates (WILL CHANGE - for reference only)

| Conversion | Rate (Jan 13) | Numerator | Denominator | Expected Direction |
|------------|--------------|-----------|-------------|-------------------|
| Contacted→MQL | 6.10% | 447 | 7,323 | ↑ Will increase |
| MQL→SQL | 45.12% | 194 | 430 | ↑ Will increase |
| SQL→SQO | 71.35% | 122 | 171 | ↑ Will increase |
| SQO→Joined | 10.14% | 7 | 69 | ↑ **Will increase significantly** (expect 15-20%) |

---

## 🔴 TIER 3: Q3 2025 + Source Filter (SANITY CHECK)

**Period**: July 1, 2025 - September 30, 2025  
**Filter**: `Original_source = 'Provided Lead List'`  
**Purpose**: Validate that source filtering works correctly

### Volume Metrics

| Metric | Expected Value |
|--------|---------------|
| Prospects | 8,257 |
| Contacted | 6,026 |
| MQLs | 183 |
| SQLs | 61 |
| SQOs | 28 |
| Joined | 2 |

### Conversion Rates

| Conversion | Rate | Numerator | Denominator |
|------------|------|-----------|-------------|
| Contacted→MQL | 3.00% | 167 | 5,574 |
| MQL→SQL | 38.85% | 61 | 157 |
| SQL→SQO | 51.79% | 29 | 56 |
| SQO→Joined | 14.29% | 3 | 21 |

---

## How to Validate

### For Calculation Logic Changes (Use TIER 1)

```
1. Set dashboard filters to Q1 2025 (Jan 1 - Mar 31, 2025)
2. Verify: SQLs = 123, SQOs = 96, Joined = 12
3. Verify: SQL→SQO = 70.83% (85/120)
4. Verify: SQO→Joined = 12.20% (10/82)
5. If ANY value differs → STOP and investigate
```

### For Filter/UI Changes (Use TIER 3)

```
1. Set dashboard filters to Q4 2025
2. Check that volumes appear (SQLs = 193, etc.)
3. Check that rates appear and are reasonable
4. Don't fail the build if rates differ from this doc
```

### For Source Filtering Validation

```
1. Set dashboard to Q3 2025 + "Provided Lead List" source
2. Verify SQLs = 61, SQOs = 28, Joined = 2
3. If volumes match, filtering is working
```

---

## Validation Decision Tree

```
Is this a calculation logic change?
├── YES → Use Q1/Q2 2025 (TIER 1)
│         └── Values MUST match exactly
│         └── If mismatch → BUG - do not proceed
│
└── NO → Is this a UI/filter change?
         ├── YES → Use Q4 2025 (TIER 3) for visual testing
         │         └── Volumes should match
         │         └── Rates may differ (that's OK)
         │
         └── NO → Is this adding a new metric?
                  └── YES → Verify with Q1/Q2 2025 first
                            Then test with Q3/Q4 for recent data
```

---

## Verification Queries

### Master Query: Q1 2025 (STABLE - Use This First)

```sql
SELECT
  'Q1 2025' as period,
  
  -- Volumes
  COUNT(DISTINCT CASE WHEN converted_date_raw >= '2025-01-01' AND converted_date_raw < '2025-04-01' AND is_sql = 1 
    THEN Full_prospect_id__c END) as sqls,  -- Expected: 123
  COUNT(DISTINCT CASE WHEN Date_Became_SQO__c >= '2025-01-01' AND Date_Became_SQO__c < '2025-04-01' 
    AND is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI' THEN Full_Opportunity_ID__c END) as sqos,  -- Expected: 96
  COUNT(DISTINCT CASE WHEN advisor_join_date__c >= '2025-01-01' AND advisor_join_date__c < '2025-04-01' 
    AND is_joined_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI' THEN Full_Opportunity_ID__c END) as joined,  -- Expected: 12
  
  -- Contacted→MQL (Expected: 314/6360 = 4.94%)
  SUM(CASE WHEN stage_entered_contacting__c >= '2025-01-01' AND stage_entered_contacting__c < '2025-04-01'
    THEN contacted_to_mql_progression ELSE 0 END) as contacted_mql_numer,
  SUM(CASE WHEN stage_entered_contacting__c >= '2025-01-01' AND stage_entered_contacting__c < '2025-04-01'
    THEN eligible_for_contacted_conversions ELSE 0 END) as contacted_mql_denom,
    
  -- MQL→SQL (Expected: 123/444 = 27.70%)
  SUM(CASE WHEN mql_stage_entered_ts >= '2025-01-01' AND mql_stage_entered_ts < '2025-04-01'
    THEN mql_to_sql_progression ELSE 0 END) as mql_sql_numer,
  SUM(CASE WHEN mql_stage_entered_ts >= '2025-01-01' AND mql_stage_entered_ts < '2025-04-01'
    THEN eligible_for_mql_conversions ELSE 0 END) as mql_sql_denom,
    
  -- SQL→SQO (Expected: 85/120 = 70.83%)
  SUM(CASE WHEN converted_date_raw >= '2025-01-01' AND converted_date_raw < '2025-04-01'
    THEN sql_to_sqo_progression ELSE 0 END) as sql_sqo_numer,
  SUM(CASE WHEN converted_date_raw >= '2025-01-01' AND converted_date_raw < '2025-04-01'
    THEN eligible_for_sql_conversions ELSE 0 END) as sql_sqo_denom,
    
  -- SQO→Joined (Expected: 10/82 = 12.20%)
  SUM(CASE WHEN Date_Became_SQO__c >= '2025-01-01' AND Date_Became_SQO__c < '2025-04-01'
    THEN sqo_to_joined_progression ELSE 0 END) as sqo_joined_numer,
  SUM(CASE WHEN Date_Became_SQO__c >= '2025-01-01' AND Date_Became_SQO__c < '2025-04-01'
    THEN eligible_for_sqo_conversions ELSE 0 END) as sqo_joined_denom

FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
```

### Master Query: Q2 2025 (STABLE)

```sql
SELECT
  'Q2 2025' as period,
  
  -- Volumes
  COUNT(DISTINCT CASE WHEN converted_date_raw >= '2025-04-01' AND converted_date_raw < '2025-07-01' AND is_sql = 1 
    THEN Full_prospect_id__c END) as sqls,  -- Expected: 155
  COUNT(DISTINCT CASE WHEN Date_Became_SQO__c >= '2025-04-01' AND Date_Became_SQO__c < '2025-07-01' 
    AND is_sqo_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI' THEN Full_Opportunity_ID__c END) as sqos,  -- Expected: 110
  COUNT(DISTINCT CASE WHEN advisor_join_date__c >= '2025-04-01' AND advisor_join_date__c < '2025-07-01' 
    AND is_joined_unique = 1 AND recordtypeid = '012Dn000000mrO3IAI' THEN Full_Opportunity_ID__c END) as joined,  -- Expected: 13
  
  -- Contacted→MQL (Expected: 315/6809 = 4.63%)
  SUM(CASE WHEN stage_entered_contacting__c >= '2025-04-01' AND stage_entered_contacting__c < '2025-07-01'
    THEN contacted_to_mql_progression ELSE 0 END) as contacted_mql_numer,
  SUM(CASE WHEN stage_entered_contacting__c >= '2025-04-01' AND stage_entered_contacting__c < '2025-07-01'
    THEN eligible_for_contacted_conversions ELSE 0 END) as contacted_mql_denom,
    
  -- MQL→SQL (Expected: 154/406 = 37.93%)
  SUM(CASE WHEN mql_stage_entered_ts >= '2025-04-01' AND mql_stage_entered_ts < '2025-07-01'
    THEN mql_to_sql_progression ELSE 0 END) as mql_sql_numer,
  SUM(CASE WHEN mql_stage_entered_ts >= '2025-04-01' AND mql_stage_entered_ts < '2025-07-01'
    THEN eligible_for_mql_conversions ELSE 0 END) as mql_sql_denom,
    
  -- SQL→SQO (Expected: 105/153 = 68.63%)
  SUM(CASE WHEN converted_date_raw >= '2025-04-01' AND converted_date_raw < '2025-07-01'
    THEN sql_to_sqo_progression ELSE 0 END) as sql_sqo_numer,
  SUM(CASE WHEN converted_date_raw >= '2025-04-01' AND converted_date_raw < '2025-07-01'
    THEN eligible_for_sql_conversions ELSE 0 END) as sql_sqo_denom,
    
  -- SQO→Joined (Expected: 12/87 = 13.79%)
  SUM(CASE WHEN Date_Became_SQO__c >= '2025-04-01' AND Date_Became_SQO__c < '2025-07-01'
    THEN sqo_to_joined_progression ELSE 0 END) as sqo_joined_numer,
  SUM(CASE WHEN Date_Became_SQO__c >= '2025-04-01' AND Date_Became_SQO__c < '2025-07-01'
    THEN eligible_for_sqo_conversions ELSE 0 END) as sqo_joined_denom

FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
```

---

## SOQL Queries for MCP Salesforce Verification

### SQOs (Recruiting Only)
```sql
SELECT COUNT(Id) FROM Opportunity 
WHERE RecordType.Name = 'Recruiting' AND SQL__c = 'Yes'
AND Date_Became_SQO__c >= [START] AND Date_Became_SQO__c <= [END]
```

### Joined (Recruiting Only)
```sql
SELECT COUNT(Id) FROM Opportunity 
WHERE RecordType.Name = 'Recruiting' AND StageName = 'Joined'
AND Advisor_Join_Date__c >= [START] AND Advisor_Join_Date__c <= [END]
```

### SQLs (Converted Leads)
```sql
SELECT COUNT(Id) FROM Lead 
WHERE IsConverted = true
AND ConvertedDate >= [START] AND ConvertedDate <= [END]
```

---

## Metrics NOT Suitable for Ground Truth

| Metric | Reason |
|--------|--------|
| Open Pipeline AUM | Changes constantly as opps progress |
| Pipeline AUM | Changes as opps are created/closed |
| Joined AUM | Can change if AUM updated post-join |
| Any rate for cohorts < 200 days old | SQO→Joined not yet stable |

---

## Discrepancy Log

| Date | Metric | Period | Expected | Actual | Root Cause | Resolution |
|------|--------|--------|----------|--------|------------|------------|
| 2026-01-13 | All | Q1-Q4 2025 | - | - | Initial verification | Baseline established |

---

## Update Schedule

| Frequency | Action |
|-----------|--------|
| **After calculation changes** | Run Q1 2025 verification query |
| **Weekly** | Spot-check one TIER 1 metric |
| **Monthly** | Full verification of Q1 + Q2 2025 |
| **After view changes** | Re-verify ALL ground truth values |
| **When Q4 2025 is 200+ days old** | Move Q4 to TIER 1, add Q1 2026 as TIER 3 |

---

## Related Documentation

- `docs/CALCULATIONS.md` - Detailed calculation formulas
- `docs/GLOSSARY.md` - Business definitions
- `docs/FILTER-MATRIX.md` - Filter application by metric
- `docs/conversion_rate_explanation.md` - Cohort mode explanation
- `vw_funnel_master.sql` - BigQuery view definition

---

**Remember**: 
- **Q1/Q2 2025 values are IMMUTABLE** - if they don't match, the dashboard is wrong
- **Q3/Q4 2025 values WILL CHANGE** - use only for sanity checks
- **Never fail a build because Q4 SQO→Joined is "low"** - it hasn't baked yet
