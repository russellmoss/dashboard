# DATE/TIMESTAMP Bug Fix Guide

**Purpose**: Step-by-step guide for Cursor.ai to fix the DATE/TIMESTAMP wrapper bug with verification at each step.

**Bug Summary**: 29 instances across 4 files use `TIMESTAMP()` wrapper on DATE fields (`converted_date_raw`, `advisor_join_date__c`) instead of `DATE()` wrapper.

**Reference Document**: `docs/DATE_TIMESTAMP_BUG_VERIFICATION_REPORT.md`

---

## Pre-Fix Reference Values (QTD - Q1 2026)

**Screenshot taken**: January 18, 2026  
**Filter**: Quarter to Date (Q1 2026)

### Volume Metrics (MUST MATCH AFTER FIX)

| Metric | Value | Affected by Fix? |
|--------|-------|------------------|
| Prospects | 4,685 | No (uses FilterDate - TIMESTAMP) |
| Contacted | 3,833 | No (uses stage_entered_contacting__c - TIMESTAMP) |
| MQLs | 97 | No (uses mql_stage_entered_ts - TIMESTAMP) |
| **SQLs** | **34** | **YES** (uses converted_date_raw - DATE) |
| SQOs | 20 | No (uses Date_Became_SQO__c - TIMESTAMP) |
| **Joined** | **0** | **YES** (uses advisor_join_date__c - DATE) |
| Open Pipeline | $12.5B | No |

### Conversion Rates (MUST MATCH AFTER FIX)

| Conversion | Rate | Resolved |
|------------|------|----------|
| Contacted → MQL | 4.5% | 50 / 1107 |
| MQL → SQL | 45.0% | 27 / 60 |
| **SQL → SQO** | **73.3%** | **11 / 15** |
| SQO → Joined | 0.0% | 0 / 0 |

**Critical Values to Verify**: SQLs (34), Joined (0), SQL→SQO rate (73.3%)

---

## Phase 1: Pre-Fix Verification

### Step 1.1: Verify Bug Still Exists

Run these commands to confirm the bug is present:

```bash
# Check for TIMESTAMP wrapper on converted_date_raw (should find matches)
grep -n "TIMESTAMP.*converted_date_raw" src/lib/queries/funnel-metrics.ts

# Check for TIMESTAMP wrapper on advisor_join_date__c (should find matches)
grep -n "TIMESTAMP.*advisor_join_date" src/lib/queries/funnel-metrics.ts
```

**Expected Output**: Lines showing `TIMESTAMP(v.converted_date_raw)` and `TIMESTAMP(v.advisor_join_date__c)`

**If no matches found**: Bug may already be fixed. Skip to Phase 6 verification.

### Step 1.2: Verify Current Query Results via MCP

Use MCP BigQuery connection to get baseline values for QTD (Jan 1 - Jan 18, 2026):

```sql
-- SQLs QTD (should return 34)
SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE TIMESTAMP(converted_date_raw) >= TIMESTAMP('2026-01-01')
  AND TIMESTAMP(converted_date_raw) <= TIMESTAMP('2026-01-18')
  AND is_sql = 1;

-- Joined QTD (should return 0)
SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE TIMESTAMP(advisor_join_date__c) >= TIMESTAMP('2026-01-01')
  AND TIMESTAMP(advisor_join_date__c) <= TIMESTAMP('2026-01-18')
  AND is_joined_unique = 1;
```

**Record Results**:
- SQLs (current query): ___
- Joined (current query): ___

### Step 1.3: Verify Correct Query Returns Same Results via MCP

```sql
-- SQLs with correct DATE wrapper (should also return 34)
SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(converted_date_raw) >= DATE('2026-01-01')
  AND DATE(converted_date_raw) <= DATE('2026-01-18')
  AND is_sql = 1;

-- Joined with correct DATE wrapper (should also return 0)
SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(advisor_join_date__c) >= DATE('2026-01-01')
  AND DATE(advisor_join_date__c) <= DATE('2026-01-18')
  AND is_joined_unique = 1;
```

**Record Results**:
- SQLs (correct query): ___
- Joined (correct query): ___

**Verification**: Both queries should return the same values. If they do, the fix is safe to apply.

### Step 1.4: Create Git Backup

```bash
# Create a backup branch before making changes
git checkout -b backup/pre-date-timestamp-fix
git checkout -  # Return to original branch
```

---

## Phase 2: Fix funnel-metrics.ts (3 instances)

### Step 2.1: Review Current Code

```bash
# Show the affected lines with context
grep -n -B2 -A2 "TIMESTAMP.*converted_date_raw\|TIMESTAMP.*advisor_join_date" src/lib/queries/funnel-metrics.ts
```

### Step 2.2: Apply Fixes

**Fix Pattern**: Change `TIMESTAMP(v.field)` to `DATE(v.field)` for DATE fields only.

**Instance 1** (lines ~114-115): `converted_date_raw`
```typescript
// BEFORE:
AND TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate)
AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate)

// AFTER:
AND DATE(v.converted_date_raw) >= DATE(@startDate)
AND DATE(v.converted_date_raw) <= DATE(@endDate)
```

**Instance 2** (lines ~137-138): `advisor_join_date__c`
```typescript
// BEFORE:
AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@startDate)
AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP(@endDate)

// AFTER:
AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
AND DATE(v.advisor_join_date__c) <= DATE(@endDate)
```

**Instance 3** (lines ~150-151): `advisor_join_date__c` (if exists)
```typescript
// BEFORE:
AND TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@startDate)

// AFTER:
AND DATE(v.advisor_join_date__c) >= DATE(@startDate)
```

### Step 2.3: Verify File Compiles

```bash
npx tsc --noEmit src/lib/queries/funnel-metrics.ts 2>&1 | head -20
```

**Expected**: No errors (empty output or only warnings)

### Step 2.4: Verify No TIMESTAMP Wrappers Remain on DATE Fields

```bash
# Should return no matches
grep -n "TIMESTAMP.*converted_date_raw\|TIMESTAMP.*advisor_join_date" src/lib/queries/funnel-metrics.ts
```

**Expected**: No output (no matches found)

### Step 2.5: Checkpoint

- [ ] funnel-metrics.ts: 3 instances fixed
- [ ] TypeScript compiles
- [ ] No incorrect wrappers remain

---

## Phase 3: Fix source-performance.ts (8 instances)

### Step 3.1: Review Current Code

```bash
grep -n -B2 -A2 "TIMESTAMP.*converted_date_raw\|TIMESTAMP.*advisor_join_date" src/lib/queries/source-performance.ts
```

### Step 3.2: Apply Fixes

Apply the same pattern to all 8 instances:

| Line (approx) | Field | Change |
|---------------|-------|--------|
| 90-91 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 111-112 | `advisor_join_date__c` | `TIMESTAMP()` → `DATE()` |
| 152-153 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 158-159 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 300-301 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 321-322 | `advisor_join_date__c` | `TIMESTAMP()` → `DATE()` |
| 362-363 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 368-369 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |

**Use find/replace**:
- Find: `TIMESTAMP(v.converted_date_raw)` → Replace: `DATE(v.converted_date_raw)`
- Find: `TIMESTAMP(v.advisor_join_date__c)` → Replace: `DATE(v.advisor_join_date__c)`
- Find: `TIMESTAMP(@startDate)` → Replace: `DATE(@startDate)` (only in lines with DATE fields)
- Find: `TIMESTAMP(@endDate)` → Replace: `DATE(@endDate)` (only in lines with DATE fields)

**⚠️ CAUTION**: Only change the wrapper on lines that reference DATE fields. Do NOT change TIMESTAMP wrappers for `FilterDate`, `Date_Became_SQO__c`, etc.

### Step 3.3: Verify File Compiles

```bash
npx tsc --noEmit src/lib/queries/source-performance.ts 2>&1 | head -20
```

### Step 3.4: Verify No TIMESTAMP Wrappers Remain on DATE Fields

```bash
grep -n "TIMESTAMP.*converted_date_raw\|TIMESTAMP.*advisor_join_date" src/lib/queries/source-performance.ts
```

**Expected**: No output

### Step 3.5: Checkpoint

- [ ] source-performance.ts: 8 instances fixed
- [ ] TypeScript compiles
- [ ] No incorrect wrappers remain

---

## Phase 4: Fix conversion-rates.ts (12 instances)

### Step 4.1: Review Current Code

```bash
grep -n "TIMESTAMP.*converted_date_raw\|TIMESTAMP.*advisor_join_date" src/lib/queries/conversion-rates.ts
```

### Step 4.2: Apply Fixes

Apply the same pattern to all 12 instances:

| Line (approx) | Field | Change |
|---------------|-------|--------|
| 291-292 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 297-298 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 676 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 696 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 717 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 724 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 742 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 749 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 754 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 778 | `advisor_join_date__c` | `TIMESTAMP()` → `DATE()` |
| 805 | `advisor_join_date__c` | `TIMESTAMP()` → `DATE()` |
| 958-959 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |

### Step 4.3: Verify File Compiles

```bash
npx tsc --noEmit src/lib/queries/conversion-rates.ts 2>&1 | head -20
```

### Step 4.4: Verify No TIMESTAMP Wrappers Remain on DATE Fields

```bash
grep -n "TIMESTAMP.*converted_date_raw\|TIMESTAMP.*advisor_join_date" src/lib/queries/conversion-rates.ts
```

**Expected**: No output

### Step 4.5: Checkpoint

- [ ] conversion-rates.ts: 12 instances fixed
- [ ] TypeScript compiles
- [ ] No incorrect wrappers remain

---

## Phase 5: Fix detail-records.ts (6 instances)

### Step 5.1: Review Current Code

```bash
grep -n "TIMESTAMP.*converted_date_raw\|TIMESTAMP.*advisor_join_date" src/lib/queries/detail-records.ts
```

### Step 5.2: Apply Fixes

Apply the same pattern to all 6 instances:

| Line (approx) | Field | Change |
|---------------|-------|--------|
| 101-102 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| 121-122 | `advisor_join_date__c` | `TIMESTAMP()` → `DATE()` |
| 166-167 | `converted_date_raw` | `TIMESTAMP()` → `DATE()` |
| (check for more) | ... | ... |

### Step 5.3: Verify File Compiles

```bash
npx tsc --noEmit src/lib/queries/detail-records.ts 2>&1 | head -20
```

### Step 5.4: Verify No TIMESTAMP Wrappers Remain on DATE Fields

```bash
grep -n "TIMESTAMP.*converted_date_raw\|TIMESTAMP.*advisor_join_date" src/lib/queries/detail-records.ts
```

**Expected**: No output

### Step 5.5: Checkpoint

- [ ] detail-records.ts: 6 instances fixed
- [ ] TypeScript compiles
- [ ] No incorrect wrappers remain

---

## Phase 6: Full Project Verification

### Step 6.1: TypeScript Full Build

```bash
npx tsc --noEmit
```

**Expected**: No errors

### Step 6.2: Linting

```bash
npm run lint
```

**Expected**: No new errors (existing warnings are OK)

### Step 6.3: Verify No Remaining Issues Across Codebase

```bash
# Search entire src/lib/queries directory
grep -rn "TIMESTAMP.*converted_date_raw\|TIMESTAMP.*advisor_join_date" src/lib/queries/

# Should only find export-records.ts (which uses TIMESTAMP for FORMAT_TIMESTAMP function)
```

**Expected**: Only `export-records.ts` matches (this is OK - it's for formatting, not comparison)

### Step 6.4: MCP Query Verification

Use MCP BigQuery connection to verify queries still return correct values:

```sql
-- SQLs QTD with fixed query (should return 34)
SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(converted_date_raw) >= DATE('2026-01-01')
  AND DATE(converted_date_raw) <= DATE('2026-01-18')
  AND is_sql = 1;
```

**Expected**: 34

```sql
-- Joined QTD with fixed query (should return 0)
SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(advisor_join_date__c) >= DATE('2026-01-01')
  AND DATE(advisor_join_date__c) <= DATE('2026-01-18')
  AND is_joined_unique = 1;
```

**Expected**: 0

```sql
-- Also verify Q4 2025 reference values
-- SQLs Q4 2025 (should return 193)
SELECT COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(converted_date_raw) >= DATE('2025-10-01')
  AND DATE(converted_date_raw) <= DATE('2025-12-31')
  AND is_sql = 1;
```

**Expected**: 193

```sql
-- Joined Q4 2025 (should return 17)
SELECT COUNT(*) as joined_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE DATE(advisor_join_date__c) >= DATE('2025-10-01')
  AND DATE(advisor_join_date__c) <= DATE('2025-12-31')
  AND is_joined_unique = 1;
```

**Expected**: 17

### Step 6.5: MCP Verification Results

Record results:

| Query | Expected | Actual | Status |
|-------|----------|--------|--------|
| SQLs QTD | 34 | ___ | ⬜ |
| Joined QTD | 0 | ___ | ⬜ |
| SQLs Q4 2025 | 193 | ___ | ⬜ |
| Joined Q4 2025 | 17 | ___ | ⬜ |

**All must match for fix to be valid.**

---

## Phase 7: User Manual Verification

**STOP HERE** - Cursor should pause and let the user verify the UI.

### Step 7.1: Start Development Server

```bash
npm run dev
```

### Step 7.2: User Verification Checklist

Open http://localhost:3000/dashboard and verify:

#### Main Dashboard (QTD Filter)

| Metric | Expected | Actual | Match? |
|--------|----------|--------|--------|
| Prospects | 4,685 | ___ | ⬜ |
| Contacted | 3,833 | ___ | ⬜ |
| MQLs | 97 | ___ | ⬜ |
| **SQLs** | **34** | ___ | ⬜ |
| SQOs | 20 | ___ | ⬜ |
| **Joined** | **0** | ___ | ⬜ |
| Open Pipeline | $12.5B | ___ | ⬜ |

#### Conversion Rates

| Conversion | Expected | Actual | Match? |
|------------|----------|--------|--------|
| Contacted → MQL | 4.5% | ___ | ⬜ |
| MQL → SQL | 45.0% | ___ | ⬜ |
| **SQL → SQO** | **73.3%** | ___ | ⬜ |
| SQO → Joined | 0.0% | ___ | ⬜ |

#### Drill-Down Test

1. Click on SQLs (34) → Modal opens with records?  ⬜
2. Records show dates in Q1 2026?  ⬜
3. Close modal
4. Click on Joined (0) → Modal opens (empty is OK)?  ⬜

#### Console Check

1. Open DevTools (F12) → Console tab
2. Any red errors? ⬜ No / ⬜ Yes (if yes, STOP and investigate)

#### Channel Drilldown Page

1. Go to /dashboard/channels
2. Table loads with data? ⬜
3. SQL column shows values? ⬜
4. Joined column shows values? ⬜

### Step 7.3: User Sign-Off

- [ ] All metrics match expected values
- [ ] No console errors
- [ ] Drill-down modals work
- [ ] Channel page works

**User Approval**: ⬜ APPROVED / ⬜ REJECTED (if rejected, rollback)

---

## Phase 8: Update Documentation

### Step 8.1: Update ARCHITECTURE.md

**Remove or update Appendix C**:

If bug is fully fixed, update Appendix C to:

```markdown
## Appendix C: Known Code Issues

### DATE vs TIMESTAMP Inconsistency in funnel-metrics.ts

**Status**: ✅ **FIXED** (January 18, 2026)

**Issue**: Multiple query files incorrectly used `TIMESTAMP()` wrapper for DATE fields (`converted_date_raw`, `advisor_join_date__c`).

**Files Fixed**:
- `src/lib/queries/funnel-metrics.ts` - 3 instances
- `src/lib/queries/source-performance.ts` - 8 instances
- `src/lib/queries/conversion-rates.ts` - 12 instances
- `src/lib/queries/detail-records.ts` - 6 instances

**Total**: 29 instances fixed

**Verification**: All queries return identical results before and after fix. UI metrics unchanged.
```

### Step 8.2: Update Validation Summary

Add to the Validation Summary section:

```markdown
### Changes Made (January 18, 2026 - DATE/TIMESTAMP Bug Fix)

**Phase 1: Pre-Fix Verification**:
- ✅ Bug confirmed via grep search (29 instances across 4 files)
- ✅ MCP queries confirmed current values match expected

**Phase 2-5: Fixes Applied**:
- ✅ funnel-metrics.ts: 3 instances fixed
- ✅ source-performance.ts: 8 instances fixed
- ✅ conversion-rates.ts: 12 instances fixed
- ✅ detail-records.ts: 6 instances fixed

**Phase 6: Verification**:
- ✅ TypeScript compilation passes
- ✅ Linting passes
- ✅ MCP queries return correct values (SQLs=34, Joined=0 for QTD)
- ✅ Q4 2025 reference values verified (SQLs=193, Joined=17)

**Phase 7: User Verification**:
- ✅ UI metrics match expected values
- ✅ No console errors
- ✅ Drill-down modals functional

**Status**: ✅ Bug fully resolved
```

### Step 8.3: Update Last Updated Date

```markdown
*Last Updated: January 18, 2026*  
*Validated Against Codebase: Yes*  
*Last Review: January 18, 2026 (DATE/TIMESTAMP bug fix applied)*
```

---

## Phase 9: Commit and Deploy

### Step 9.1: Review Changes

```bash
git diff --stat
git diff src/lib/queries/
```

### Step 9.2: Commit

```bash
git add src/lib/queries/funnel-metrics.ts
git add src/lib/queries/source-performance.ts
git add src/lib/queries/conversion-rates.ts
git add src/lib/queries/detail-records.ts
git add docs/ARCHITECTURE.md

git commit -m "fix: correct DATE/TIMESTAMP wrappers for converted_date_raw and advisor_join_date__c

- Fixed 29 instances across 4 query files
- Changed TIMESTAMP() to DATE() for DATE-type fields
- Verified via MCP queries: SQLs=34, Joined=0 (QTD)
- Verified Q4 2025 reference values: SQLs=193, Joined=17
- UI manually verified - all metrics match expected values

Files modified:
- src/lib/queries/funnel-metrics.ts (3 fixes)
- src/lib/queries/source-performance.ts (8 fixes)
- src/lib/queries/conversion-rates.ts (12 fixes)
- src/lib/queries/detail-records.ts (6 fixes)
- docs/ARCHITECTURE.md (updated Appendix C)"
```

### Step 9.3: Deploy (Optional)

```bash
# If ready to deploy
git push origin main
```

---

## Rollback Instructions

If something goes wrong, rollback immediately:

```bash
# Option 1: Revert specific files
git checkout HEAD~1 -- src/lib/queries/funnel-metrics.ts
git checkout HEAD~1 -- src/lib/queries/source-performance.ts
git checkout HEAD~1 -- src/lib/queries/conversion-rates.ts
git checkout HEAD~1 -- src/lib/queries/detail-records.ts

# Option 2: Revert entire commit
git revert HEAD

# Option 3: Use backup branch
git checkout backup/pre-date-timestamp-fix
```

---

## Summary Checklist

### Cursor.ai Verification

- [ ] Phase 1: Pre-fix verification complete
- [ ] Phase 2: funnel-metrics.ts fixed and compiles
- [ ] Phase 3: source-performance.ts fixed and compiles
- [ ] Phase 4: conversion-rates.ts fixed and compiles
- [ ] Phase 5: detail-records.ts fixed and compiles
- [ ] Phase 6: Full project verification passes
- [ ] Phase 6: MCP queries return expected values

### User Verification

- [ ] Phase 7: UI metrics match screenshot values
- [ ] Phase 7: No console errors
- [ ] Phase 7: Drill-down modals work
- [ ] Phase 7: User approval given

### Final Steps

- [ ] Phase 8: ARCHITECTURE.md updated
- [ ] Phase 9: Changes committed
- [ ] Phase 9: Deployed (optional)

---

**END OF BUG FIX GUIDE**
