# Verify and Fix DATE/TIMESTAMP Wrapper Issues

**Purpose**: Verify field types directly from BigQuery schema, then check and fix any incorrect DATE/TIMESTAMP wrapper usage in the codebase.

**Why This Matters**: BigQuery requires type consistency in comparisons. Using `TIMESTAMP()` on a DATE field or `DATE()` on a TIMESTAMP field can cause:
- Incorrect query results at day boundaries
- Implicit type conversions that hurt performance
- Inconsistency across query files

---

## Phase 1: Verify Field Types from BigQuery Schema (MCP)

**Use your MCP connection to BigQuery to verify the actual data types of these fields.**

### Step 1.1: Query the BigQuery Schema

Run this query to get the actual field types from `vw_funnel_master`:

```sql
SELECT 
  column_name,
  data_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
  AND column_name IN (
    'FilterDate',
    'stage_entered_contacting__c',
    'mql_stage_entered_ts',
    'converted_date_raw',
    'Date_Became_SQO__c',
    'advisor_join_date__c',
    'Initial_Call_Scheduled_Date__c',
    'Qualification_Call_Date__c',
    'Opp_CreatedDate'
  )
ORDER BY column_name
```

### Step 1.2: Document the Results

Create a table with the actual BigQuery types:

| Field | BigQuery Type | Correct Wrapper |
|-------|---------------|-----------------|
| `FilterDate` | ? | ? |
| `stage_entered_contacting__c` | ? | ? |
| `mql_stage_entered_ts` | ? | ? |
| `converted_date_raw` | ? | ? |
| `Date_Became_SQO__c` | ? | ? |
| `advisor_join_date__c` | ? | ? |
| `Initial_Call_Scheduled_Date__c` | ? | ? |
| `Qualification_Call_Date__c` | ? | ? |
| `Opp_CreatedDate` | ? | ? |

**Rules for Correct Wrapper:**
- If BigQuery type is `DATE` → use `DATE()` wrapper
- If BigQuery type is `TIMESTAMP` → use `TIMESTAMP()` wrapper
- If BigQuery type is `DATETIME` → use `DATETIME()` wrapper (rare)

### Step 1.3: Compare with ARCHITECTURE.md

Check if `docs/ARCHITECTURE.md` Section 2 "DATE vs TIMESTAMP Handling" matches the actual BigQuery schema.

If there are discrepancies, note them for update.

---

## Phase 2: Search for Incorrect Wrapper Usage

### Step 2.1: Find TIMESTAMP wrapper on DATE fields

Based on the BigQuery schema results, search for incorrect usage.

**If `converted_date_raw` is DATE:**
```bash
grep -rn "TIMESTAMP.*converted_date_raw" src/lib/queries/ src/lib/semantic-layer/
```

**If `advisor_join_date__c` is DATE:**
```bash
grep -rn "TIMESTAMP.*advisor_join_date" src/lib/queries/ src/lib/semantic-layer/
```

**If `Initial_Call_Scheduled_Date__c` is DATE:**
```bash
grep -rn "TIMESTAMP.*Initial_Call_Scheduled" src/lib/queries/ src/lib/semantic-layer/
```

**If `Qualification_Call_Date__c` is DATE:**
```bash
grep -rn "TIMESTAMP.*Qualification_Call" src/lib/queries/ src/lib/semantic-layer/
```

### Step 2.2: Find DATE wrapper on TIMESTAMP fields

**If `FilterDate` is TIMESTAMP:**
```bash
grep -rn "DATE(.*FilterDate" src/lib/queries/ src/lib/semantic-layer/
```

**If `Date_Became_SQO__c` is TIMESTAMP:**
```bash
grep -rn "DATE(.*Date_Became_SQO" src/lib/queries/ src/lib/semantic-layer/
```

**If `mql_stage_entered_ts` is TIMESTAMP:**
```bash
grep -rn "DATE(.*mql_stage_entered" src/lib/queries/ src/lib/semantic-layer/
```

**If `stage_entered_contacting__c` is TIMESTAMP:**
```bash
grep -rn "DATE(.*stage_entered_contacting" src/lib/queries/ src/lib/semantic-layer/
```

### Step 2.3: Check funnel-metrics.ts in detail

This file was flagged in ARCHITECTURE.md Appendix C. Review lines 100-150:

```bash
sed -n '100,150p' src/lib/queries/funnel-metrics.ts
```

Look for any date field comparisons and verify they use the correct wrapper based on BigQuery schema.

### Step 2.4: Check other key query files

```bash
# conversion-rates.ts
grep -n "TIMESTAMP\|DATE(" src/lib/queries/conversion-rates.ts | head -30

# source-performance.ts  
grep -n "TIMESTAMP\|DATE(" src/lib/queries/source-performance.ts | head -30

# detail-records.ts
grep -n "TIMESTAMP\|DATE(" src/lib/queries/detail-records.ts | head -30

# drill-down.ts
grep -n "TIMESTAMP\|DATE(" src/lib/queries/drill-down.ts | head -30
```

### Step 2.5: Check semantic layer definitions

The semantic layer should be the source of truth. Verify it's correct:

```bash
# Check all date field handling in definitions.ts
grep -B2 -A5 "dateField\|DATE(\|TIMESTAMP(" src/lib/semantic-layer/definitions.ts | head -80
```

---

## Phase 3: Report Findings

Create a findings table:

| File | Line | Field | Current Wrapper | BigQuery Type | Status |
|------|------|-------|-----------------|---------------|--------|
| funnel-metrics.ts | 114 | converted_date_raw | TIMESTAMP() | DATE | ❌ FIX |
| ... | ... | ... | ... | ... | ... |

**Status Key:**
- ✅ CORRECT — Wrapper matches BigQuery type
- ❌ FIX — Wrapper does not match, needs fixing
- ⚠️ REVIEW — Edge case, needs manual review

---

## Phase 4: Apply Fixes

### Step 4.1: Fix incorrect wrappers

For each ❌ FIX item:

**If field is DATE but code uses TIMESTAMP():**
```typescript
// BEFORE (incorrect):
AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate)

// AFTER (correct):
AND DATE(v.converted_date_raw) >= DATE(@startDate)
```

**If field is TIMESTAMP but code uses DATE():**
```typescript
// BEFORE (incorrect):
AND DATE(v.FilterDate) >= DATE(@startDate)

// AFTER (correct):
AND TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate)
```

### Step 4.2: Verify fixes compile

```bash
npx tsc --noEmit
```

### Step 4.3: Verify query still works (MCP)

For each fixed file, run a simple test query via MCP to ensure it doesn't error:

```sql
-- Test converted_date_raw (if fixed)
SELECT COUNT(*) 
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(converted_date_raw) >= DATE('2025-01-01')
  AND DATE(converted_date_raw) <= DATE('2025-01-31')
  AND is_sql = 1
```

---

## Phase 5: Update Documentation

### Step 5.1: Update ARCHITECTURE.md Section 2

If any field types in the documentation were wrong, update them:

**Location**: `docs/ARCHITECTURE.md` → Section 2 "Data Layer" → "DATE vs TIMESTAMP Handling"

Ensure the "Field Type Reference" matches the BigQuery schema exactly.

### Step 5.2: Update or Remove Appendix C

**If bug was fixed:**
- Remove the "DATE vs TIMESTAMP Inconsistency in funnel-metrics.ts" entry from Appendix C
- Or update it to say "FIXED" with date

**If bug still exists (couldn't fix for some reason):**
- Keep the entry but update with current findings

### Step 5.3: Update Validation Summary

Add a new entry to the Validation Summary section:

```markdown
### Changes Made ([TODAY'S DATE] - DATE/TIMESTAMP Verification)

**Phase 1: BigQuery Schema Verification (MCP)**:
- ✅ Verified field types directly from BigQuery INFORMATION_SCHEMA
- [List any discrepancies found with documentation]

**Phase 2: Code Search Results**:
- [List files checked and issues found]

**Phase 3: Fixes Applied**:
- [List each fix: file, line, before/after]

**Phase 4: Verification**:
- ✅ TypeScript compilation passes
- ✅ Test queries execute successfully via MCP
```

---

## Phase 6: Final Verification

### Step 6.1: Run full type check

```bash
npx tsc --noEmit
```

### Step 6.2: Run linter

```bash
npm run lint
```

### Step 6.3: Verify no regressions

Use MCP to run the Q4 2025 validation queries and ensure counts still match:

```sql
-- SQLs should be 193
SELECT COUNT(*)
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(converted_date_raw) >= DATE('2025-10-01')
  AND DATE(converted_date_raw) <= DATE('2025-12-31')
  AND is_sql = 1

-- Joined should be 17
SELECT COUNT(*)
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(advisor_join_date__c) >= DATE('2025-10-01')
  AND DATE(advisor_join_date__c) <= DATE('2025-12-31')
  AND is_joined_unique = 1
```

**Expected Results (Q4 2025):**
- SQLs: 193
- Joined: 17

---

## Output Summary

After completing all phases, provide:

1. **BigQuery Schema Results**: Table of actual field types from MCP query
2. **Issues Found**: List of files/lines with incorrect wrappers
3. **Fixes Applied**: Before/after for each fix
4. **Verification Results**: TypeScript compile status, test query results
5. **Documentation Updates**: Changes made to ARCHITECTURE.md
6. **Final Status**: Confirm bug is resolved or explain why not

---

## Quick Reference: Correct Patterns

Based on typical BigQuery schema:

| Field | Expected Type | Correct Pattern |
|-------|---------------|-----------------|
| `converted_date_raw` | DATE | `DATE(v.converted_date_raw) >= DATE(@startDate)` |
| `advisor_join_date__c` | DATE | `DATE(v.advisor_join_date__c) >= DATE(@startDate)` |
| `Initial_Call_Scheduled_Date__c` | DATE | `v.Initial_Call_Scheduled_Date__c >= @startDate` (direct) |
| `Qualification_Call_Date__c` | DATE | `v.Qualification_Call_Date__c >= @startDate` (direct) |
| `FilterDate` | TIMESTAMP | `TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate)` |
| `stage_entered_contacting__c` | TIMESTAMP | `TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate)` |
| `mql_stage_entered_ts` | TIMESTAMP | `TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate)` |
| `Date_Became_SQO__c` | TIMESTAMP | `TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)` |

**Note**: Some DATE fields may work with direct comparison (no wrapper) if the parameter is also a DATE string. The key is consistency.

---

**END OF VERIFICATION GUIDE**
