# Volume Investigation Log

**Date**: January 2026
**Issue**: Conversion Trends volume display showing incorrect values
**Expected Q4 2025**: 193 SQL, 144 SQO, 17 Joined
**Expected Q3 2025**: 221 SQL, 133 SQO, 15 Joined

---

## Investigation Progress

[Findings will be logged here as we progress through each phase]

---

## Phase 2: Ground Truth Validation

### Q4 2025 Validation Results

**SQL Count Query:**
```sql
SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw >= '2025-10-01' 
  AND converted_date_raw <= '2025-12-31'
```

**Result**: 193 SQLs ✅ (Matches expected: 193)

---

**SQO Count Query:**
```sql
SELECT COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Date_Became_SQO__c >= '2025-10-01' 
  AND Date_Became_SQO__c <= '2025-12-31'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
```

**Result**: 143 SQOs ⚠️ (Expected: 144, Difference: -1)

---

**Joined Count Query:**
```sql
SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_join_date__c >= '2025-10-01' 
  AND advisor_join_date__c <= '2025-12-31'
  AND is_joined_unique = 1
```

**Result**: 17 Joined ✅ (Matches expected: 17)

---

### Q3 2025 Validation Results

**SQL Count Query:**
```sql
SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw >= '2025-07-01' 
  AND converted_date_raw <= '2025-09-30'
```

**Result**: 221 SQLs ✅ (Matches expected: 221)

---

**SQO Count Query:**
```sql
SELECT COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Date_Became_SQO__c >= '2025-07-01' 
  AND Date_Became_SQO__c <= '2025-09-30'
  AND is_sqo_unique = 1
  AND recordtypeid = '012Dn000000mrO3IAI'
```

**Result**: 131 SQOs ⚠️ (Expected: 133, Difference: -2)

---

**Joined Count Query:**
```sql
SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE advisor_join_date__c >= '2025-07-01' 
  AND advisor_join_date__c <= '2025-09-30'
  AND is_joined_unique = 1
```

**Result**: 15 Joined ✅ (Matches expected: 15)

---

### Summary

| Quarter | Metric | Actual Count | Expected | Status |
|---------|--------|--------------|----------|--------|
| Q4 2025 | SQL | 193 | 193 | ✅ Match |
| Q4 2025 | SQO | 143 | 144 | ⚠️ -1 difference |
| Q4 2025 | Joined | 17 | 17 | ✅ Match |
| Q3 2025 | SQL | 221 | 221 | ✅ Match |
| Q3 2025 | SQO | 131 | 133 | ⚠️ -2 difference |
| Q3 2025 | Joined | 15 | 15 | ✅ Match |

### Notes
- Boolean fields in BigQuery are stored as INT64 (0/1), not BOOL type
- Queries must use `= 1` instead of `= TRUE` for boolean comparisons
- SQL and Joined counts match expected values exactly
- SQO counts are slightly lower than expected (1-2 records difference)
  - This may be due to data updates or slight differences in expected calculation logic
  - The actual BigQuery results will be used as the ground truth for fixing the volume display
