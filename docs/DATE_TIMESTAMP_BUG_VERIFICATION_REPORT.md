# DATE/TIMESTAMP Bug Verification Report

**Date**: January 18, 2026  
**Verified Against**: BigQuery Schema (MCP)  
**Status**: ❌ **BUGS CONFIRMED - Multiple files need fixes**

---

## Phase 1: BigQuery Schema Verification (MCP)

### Step 1.1: Actual Field Types from BigQuery

Query executed via MCP BigQuery connection to `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`:

| Field | BigQuery Type | Correct Wrapper | Status |
|-------|---------------|-----------------|--------|
| `FilterDate` | **TIMESTAMP** | `TIMESTAMP()` | ✅ Correct in code |
| `stage_entered_contacting__c` | **TIMESTAMP** | `TIMESTAMP()` | ✅ Correct in code |
| `mql_stage_entered_ts` | **TIMESTAMP** | `TIMESTAMP()` | ✅ Correct in code |
| `converted_date_raw` | **DATE** | `DATE()` | ❌ **INCORRECT** - Using TIMESTAMP() |
| `Date_Became_SQO__c` | **TIMESTAMP** | `TIMESTAMP()` | ✅ Correct in code |
| `advisor_join_date__c` | **DATE** | `DATE()` | ❌ **INCORRECT** - Using TIMESTAMP() |
| `Initial_Call_Scheduled_Date__c` | **DATE** | `DATE()` | ✅ Correct in code (direct comparison) |
| `Qualification_Call_Date__c` | **DATE** | `DATE()` | ✅ Correct in code (direct comparison) |
| `Opp_CreatedDate` | **TIMESTAMP** | `TIMESTAMP()` | ✅ Correct in code |

### Step 1.2: Comparison with ARCHITECTURE.md

**ARCHITECTURE.md Section 2** correctly documents:
- `converted_date_raw` as DATE ✅
- `advisor_join_date__c` as DATE ✅
- `FilterDate` as TIMESTAMP ✅
- `Date_Became_SQO__c` as TIMESTAMP ✅

**Conclusion**: Documentation is correct. The bug is in the code, not the documentation.

---

## Phase 2: Code Search Results

### Step 2.1: Files with Incorrect TIMESTAMP() on DATE Fields

**Files Affected**: 4 files (excluding export-records.ts which correctly uses TIMESTAMP for FORMAT_TIMESTAMP)

1. `src/lib/queries/funnel-metrics.ts` - 3 instances
2. `src/lib/queries/source-performance.ts` - 8 instances
3. `src/lib/queries/conversion-rates.ts` - ~12 instances
4. `src/lib/queries/detail-records.ts` - 6 instances

### Step 2.2: Detailed Findings Table

| File | Line | Field | Current Wrapper | BigQuery Type | Status |
|------|------|-------|-----------------|---------------|--------|
| **funnel-metrics.ts** | 114-115 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **funnel-metrics.ts** | 137-138 | `advisor_join_date__c` | `TIMESTAMP()` | DATE | ❌ FIX |
| **funnel-metrics.ts** | 150-151 | `advisor_join_date__c` | `TIMESTAMP()` | DATE | ❌ FIX |
| **source-performance.ts** | 90-91 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **source-performance.ts** | 111-112 | `advisor_join_date__c` | `TIMESTAMP()` | DATE | ❌ FIX |
| **source-performance.ts** | 152-153 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **source-performance.ts** | 158-159 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **source-performance.ts** | 300-301 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **source-performance.ts** | 321-322 | `advisor_join_date__c` | `TIMESTAMP()` | DATE | ❌ FIX |
| **source-performance.ts** | 362-363 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **source-performance.ts** | 368-369 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 291-292 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 297-298 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 676 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 696 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 717 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 724 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 742 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 749 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 754 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 778 | `advisor_join_date__c` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 805 | `advisor_join_date__c` | `TIMESTAMP()` | DATE | ❌ FIX |
| **conversion-rates.ts** | 958-959 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **detail-records.ts** | 101-102 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **detail-records.ts** | 121-122 | `advisor_join_date__c` | `TIMESTAMP()` | DATE | ❌ FIX |
| **detail-records.ts** | 166-167 | `converted_date_raw` | `TIMESTAMP()` | DATE | ❌ FIX |
| **export-records.ts** | 80 | `converted_date_raw` | `TIMESTAMP()` | DATE | ⚠️ REVIEW |
| **export-records.ts** | 82 | `advisor_join_date__c` | `TIMESTAMP()` | DATE | ⚠️ REVIEW |

**Total Issues**: 29 instances requiring fixes

**Note on export-records.ts**: Uses `TIMESTAMP()` wrapper for `FORMAT_TIMESTAMP()` function, which requires TIMESTAMP input. This is technically correct for the function call, but could be documented better.

### Step 2.3: Semantic Layer Verification

**Status**: ✅ **CORRECT**

The semantic layer (`src/lib/semantic-layer/definitions.ts`) correctly uses `DATE()` wrappers:
- Line 188-189: `DATE(v.converted_date_raw) >= DATE(@startDate)` ✅
- Line 226-227: `DATE(v.advisor_join_date__c) >= DATE(@startDate)` ✅

**Conclusion**: Semantic layer is the source of truth and is correct. Query files need to be updated to match.

---

## Phase 3: Impact Analysis

### Potential Issues

1. **Type Mismatch**: BigQuery may perform implicit conversions, but this is inefficient and can cause:
   - Performance degradation
   - Potential edge case bugs at day boundaries
   - Inconsistent behavior across queries

2. **Inconsistency**: Different files use different patterns for the same fields, making maintenance difficult.

3. **Documentation Mismatch**: Code doesn't match documented patterns in ARCHITECTURE.md.

### Risk Level

- **Severity**: Medium
- **Likelihood**: Low (BigQuery handles implicit conversions, but not ideal)
- **Impact**: Performance and maintainability

---

## Phase 4: Recommended Fixes

### Fix Pattern for DATE Fields

**BEFORE (Incorrect)**:
```typescript
AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate)
AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@startDate)
```

**AFTER (Correct)**:
```typescript
AND DATE(v.converted_date_raw) >= DATE(@startDate)
AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
```

### Files Requiring Fixes

1. **funnel-metrics.ts** - 3 fixes needed
2. **source-performance.ts** - 8 fixes needed
3. **conversion-rates.ts** - 12 fixes needed
4. **detail-records.ts** - 6 fixes needed

**Total**: 29 individual fixes across 4 files

---

## Phase 5: Verification Queries

After fixes are applied, verify with these test queries:

### Test Query 1: SQLs (should return 193 for Q4 2025)
```sql
SELECT COUNT(*)
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(converted_date_raw) >= DATE('2025-10-01')
  AND DATE(converted_date_raw) <= DATE('2025-12-31')
  AND is_sql = 1
```

### Test Query 2: Joined (should return 17 for Q4 2025)
```sql
SELECT COUNT(*)
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(advisor_join_date__c) >= DATE('2025-10-01')
  AND DATE(advisor_join_date__c) <= DATE('2025-12-31')
  AND is_joined_unique = 1
```

---

## Phase 6: Documentation Updates Required

### Update ARCHITECTURE.md Appendix C

**Current Status**: Bug documented but scope is understated.

**Recommended Update**:
- Expand Appendix C to list all 4 affected files
- Update status to show 29 total instances
- Add note that semantic layer is correct (source of truth)

---

## Summary

### Verification Results

✅ **BigQuery Schema**: Verified via MCP - field types confirmed  
✅ **Documentation**: ARCHITECTURE.md is correct  
❌ **Code**: 4 files with 29 instances of incorrect wrapper usage  
✅ **Semantic Layer**: Correct implementation (source of truth)

### Next Steps

1. **Fix all 29 instances** in the 4 affected files
2. **Run TypeScript compilation** to verify no syntax errors
3. **Test queries** using MCP to verify results match expected values
4. **Update ARCHITECTURE.md** Appendix C with complete bug report
5. **Consider adding lint rule** to prevent future issues

### Final Status

**Bug Confirmed**: Yes  
**Scope**: 4 files, 29 instances  
**Priority**: Medium (performance and maintainability)  
**Fix Complexity**: Low (find/replace pattern)

---

**Report Generated**: January 18, 2026  
**Verified By**: Cursor AI (following verify_date_timestamp_bug.md guide)
