# Export Validation Bug Fix - Cursor.ai Implementation Guide

## Status: ✅ FIXED (January 2026)

**Last Updated:** January 13, 2026

The validation issues have been resolved. This document now serves as:
1. Documentation of the fix that was applied
2. Reference for future maintenance
3. Alternative implementation approach (UNION-based) if needed

## Problem Statement (Historical)

The Google Sheets export feature had a critical bug where the "Validation" tab showed mismatches between dashboard values and values calculated from the exported detail records.

### Original Broken State (Q4 2025 Export)

| Metric | Dashboard Value | From Export | Status |
|--------|----------------|-------------|--------|
| SQLs | 193 | 40 | ❌ WRONG |
| SQOs | 144 | 24 | ❌ WRONG |
| Joined | 17 | 0 | ❌ WRONG |
| Contacted→MQL | 6.1% | 5.4% | ⚠️ Close |
| MQL→SQL | 45.2% | 56% | ❌ WRONG |
| SQL→SQO | 73.1% | 80.6% | ❌ WRONG |
| SQO→Joined | 10.6% | 0% | ❌ WRONG |

### Current State After Fix ✅

All metrics now show ✅ with matching values. The fix was implemented using a simpler OR-based approach with corrected validation formulas.

---

## Root Cause Analysis

### 1. Dashboard Calculation Logic (CORRECT)

The dashboard uses **stage-specific date filtering** for each metric:

**Volume Metrics:**
```sql
-- SQLs: Records where they BECAME SQL in the period
WHERE converted_date_raw BETWEEN '2025-10-01' AND '2025-12-31' AND is_sql = 1

-- SQOs: Records where they BECAME SQO in the period (Recruiting only)
WHERE Date_Became_SQO__c BETWEEN '2025-10-01' AND '2025-12-31' 
  AND recordtypeid = '012Dn000000mrO3IAI' AND is_sqo_unique = 1

-- Joined: Records where they JOINED in the period
WHERE advisor_join_date__c BETWEEN '2025-10-01' AND '2025-12-31' AND is_joined_unique = 1
```

**Conversion Rates (Cohort Efficiency):**
Each rate filters by when they **entered that specific stage**:

```sql
-- Contacted→MQL: Filter by CONTACTED date
WHERE stage_entered_contacting__c IN period
  → Numerator: contacted_to_mql_progression
  → Denominator: eligible_for_contacted_conversions

-- MQL→SQL: Filter by MQL date  
WHERE mql_stage_entered_ts IN period
  → Numerator: mql_to_sql_progression
  → Denominator: eligible_for_mql_conversions

-- SQL→SQO: Filter by SQL date
WHERE converted_date_raw IN period
  → Numerator: sql_to_sqo_progression
  → Denominator: eligible_for_sql_conversions

-- SQO→Joined: Filter by SQO date
WHERE Date_Became_SQO__c IN period
  → Numerator: sqo_to_joined_progression
  → Denominator: eligible_for_sqo_conversions
```

### 2. Export Query Logic (FIXED ✅)

The export query in `src/lib/queries/export-records.ts` now uses:

```sql
WHERE (
  FilterDate IN period
  OR stage_entered_contacting__c IN period
  OR mql_stage_entered_ts IN period  -- ✅ ADDED: This was missing!
  OR converted_date_raw IN period
  OR Date_Became_SQO__c IN period
  OR advisor_join_date__c IN period
)
```

**Fix Applied:**
1. ✅ Added `mql_stage_entered_ts` to the OR condition (was missing, causing MQL→SQL denominator mismatch)
2. ✅ Validation formulas now filter by specific date columns for each metric
3. ✅ Match formulas check numerator/denominator matches first, then fall back to percentage comparison

**Note:** The OR approach works because validation formulas filter by the specific date field needed for each metric. A UNION-based approach (documented below) is an alternative but not necessary.

### 3. Validation Formula Logic (FIXED ✅)

The validation formulas now correctly filter by date range and specific flags:

```excel
-- SQLs: SQL Date in range AND Is SQL = YES
=COUNTIFS('Detail Records'!O:O,">=2026-01-01",'Detail Records'!O:O,"<=2026-01-13",'Detail Records'!O:O,"<>",'Detail Records'!T:T,"YES")

-- SQOs: SQO Date in range AND Is SQO = YES AND Is SQO Unique = YES AND Record Type = Recruiting
=COUNTIFS('Detail Records'!P:P,">=2026-01-01",'Detail Records'!P:P,"<=2026-01-13",'Detail Records'!P:P,"<>",'Detail Records'!U:U,"YES",'Detail Records'!AE:AE,"YES",'Detail Records'!AG:AG,"Recruiting")

-- Conversion Rates: Filter by specific date field for each cohort
-- Contacted→MQL: Filter by Contacted Date (M) in range
=COUNTIFS('Detail Records'!M:M,">=startDate",'Detail Records'!M:M,"<=endDate",'Detail Records'!M:M,"<>",'Detail Records'!W:W,"YES")
```

**Fix Applied:**
1. ✅ All formulas use COUNTIFS with date range filtering
2. ✅ Each metric filters by its specific date column (Contacted Date, MQL Date, SQL Date, etc.)
3. ✅ Match formulas check numerator/denominator matches first (most reliable)

---

## Verified Expected Values (Q4 2025)

These values were verified directly against BigQuery:

### Volume Metrics
| Metric | Value | Date Field Used |
|--------|-------|-----------------|
| SQLs | 193 | `converted_date_raw` |
| SQOs | 144 | `Date_Became_SQO__c` + recordtype filter |
| Joined | 17 | `advisor_join_date__c` |

### Conversion Rates
| Metric | Numerator | Denominator | Rate | Date Field |
|--------|-----------|-------------|------|------------|
| Contacted→MQL | 447 | 7,292 | 6.1% | `stage_entered_contacting__c` |
| MQL→SQL | 193 | 427 | 45.2% | `mql_stage_entered_ts` |
| SQL→SQO | 122 | 167 | 73.1% | `converted_date_raw` |
| SQO→Joined | 7 | 66 | 10.6% | `Date_Became_SQO__c` |

### Cohort Record Counts
| Cohort | Count | Purpose |
|--------|-------|---------|
| Contacted in Q4 | ~15,767 | Contacted→MQL denominator |
| MQL in Q4 | ~427 | MQL→SQL denominator |
| SQL in Q4 | 193 | SQL→SQO denominator + SQL volume |
| SQO in Q4 | ~219 | SQO→Joined denominator |
| Joined in Q4 | 17-18 | Joined volume |

### Field Data Types (Important!)
```
FilterDate:                  TIMESTAMP
stage_entered_contacting__c: TIMESTAMP  → use DATE() function
mql_stage_entered_ts:        TIMESTAMP  → use DATE() function
converted_date_raw:          DATE       → use directly
Date_Became_SQO__c:          TIMESTAMP  → use DATE() function
advisor_join_date__c:        DATE       → use directly
```

---

## Implementation Summary (What Was Fixed)

### ✅ Fix 1: Added Missing Date Field to Export Query

**File:** `src/lib/queries/export-records.ts`

**Change:** Added `mql_stage_entered_ts` to the OR condition in the date filter.

**Before:**
```typescript
OR (TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate) ...)
OR (TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) ...)
```

**After:**
```typescript
OR (TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate))  // ✅ ADDED
OR (TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate) ...)
```

This ensures records where only the MQL date is in range are included in the export.

### ✅ Fix 2: Updated Validation Formulas

**File:** `src/lib/sheets/google-sheets-exporter.ts`

**Change:** Validation formulas now use COUNTIFS with date range filtering for each specific metric.

**Key Changes:**
- Conversion rates filter by the specific date field (Contacted Date, MQL Date, SQL Date, SQO Date)
- Volume metrics filter by the correct date field with additional filters (unique flags, record type)
- Match formulas check numerator/denominator matches first, then fall back to percentage comparison

### ✅ Fix 3: Improved Match Formula Logic

**Change:** Match formulas now prioritize numerator/denominator comparison:

```excel
=IF(AND(N(G6)=N(E6),N(H6)=N(F6)),"✓",IFERROR(IF(ROUND(ABS(...))<=0.1,"✓","✗"),"✗"))
```

This ensures that when numerators and denominators match (same calculation), it shows ✓ regardless of rounding differences.

---

## Alternative Implementation: UNION-Based Approach

The following UNION-based approach is documented as an alternative implementation that would be more explicit about capturing each cohort. **This is not necessary** given the current fix, but may be useful for:
- Better debugging (export_reason column shows why each record was included)
- More explicit cohort tracking
- Future enhancements

### Step 1: Update Export Query (Alternative UNION Approach)

**File:** `src/lib/queries/export-records.ts`

**Function:** `getExportDetailRecords()`

**Change Required:** Replace the OR-based date filter with a UNION approach that captures all necessary cohorts.

#### Current Code Pattern (✅ Already Fixed):
```typescript
// Date filter - include records that have any activity in the period
// ✅ FIXED: Now includes mql_stage_entered_ts
conditions.push(`(
  (TIMESTAMP(v.FilterDate) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.FilterDate) <= TIMESTAMP(@endDate))
  OR (TIMESTAMP(v.stage_entered_contacting__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.stage_entered_contacting__c) <= TIMESTAMP(@endDate))
  OR (TIMESTAMP(v.mql_stage_entered_ts) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.mql_stage_entered_ts) <= TIMESTAMP(@endDate))  // ✅ ADDED
  OR (TIMESTAMP(v.converted_date_raw) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.converted_date_raw) <= TIMESTAMP(@endDate))
  OR (TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(@endDate))
  OR (TIMESTAMP(v.advisor_join_date__c) >= TIMESTAMP(@startDate) AND TIMESTAMP(v.advisor_join_date__c) <= TIMESTAMP(@endDate))
)`);
```

#### Alternative UNION-Based Code Pattern (Optional Enhancement):

Replace the entire `getExportDetailRecords` function with this implementation:

```typescript
/**
 * Get all detail records for export with correct cohort-based date filtering
 * 
 * This query uses UNION to capture 4 distinct cohorts needed for validation:
 * 1. Contacted cohort - for Contacted→MQL conversion rate
 * 2. MQL cohort - for MQL→SQL conversion rate  
 * 3. SQL cohort - for SQL→SQO conversion rate AND SQL volume metric
 * 4. SQO cohort - for SQO→Joined conversion rate AND SQO volume metric
 * 5. Joined cohort - for Joined volume metric
 */
export async function getExportDetailRecords(
  filters: DashboardFilters,
  limit: number = 50000  // Increased from 10000 to ensure all records included
): Promise<ExportDetailRecord[]> {
  const { startDate, endDate } = buildDateRangeFromFilters(filters);
  
  // Build optional filter conditions (channel, source, sga, sgm)
  const filterConditions: string[] = [];
  const params: Record<string, any> = {
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
    limit,
  };

  if (filters.channel) {
    filterConditions.push('COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, \'Other\') = @channel');
    params.channel = filters.channel;
  }
  if (filters.source) {
    filterConditions.push('v.Original_source = @source');
    params.source = filters.source;
  }
  if (filters.sga) {
    filterConditions.push('v.SGA_Owner_Name__c = @sga');
    params.sga = filters.sga;
  }
  if (filters.sgm) {
    filterConditions.push('v.SGM_Owner_Name__c = @sgm');
    params.sgm = filters.sgm;
  }

  const optionalFilters = filterConditions.length > 0 
    ? 'AND ' + filterConditions.join(' AND ') 
    : '';

  const query = `
    WITH base_select AS (
      SELECT
        -- Identifiers
        v.Full_prospect_id__c as lead_id,
        NULL as contact_id,  -- Contact ID not available in vw_funnel_master
        v.Full_Opportunity_ID__c as opportunity_id,
        v.primary_key,
        
        -- Advisor Info
        v.advisor_name,
        v.salesforce_url,
        
        -- Attribution
        v.Original_source as original_source,
        COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
        v.SGA_Owner_Name__c as sga,
        v.SGM_Owner_Name__c as sgm,
        
        -- Stage Info
        v.StageName as stage_name,
        COALESCE(v.Underwritten_AUM__c, v.Amount, 0) as aum,
        
        -- Date Fields (formatted for export)
        FORMAT_TIMESTAMP('%Y-%m-%d', v.FilterDate) as filter_date,
        FORMAT_TIMESTAMP('%Y-%m-%d', v.stage_entered_contacting__c) as contacted_date,
        FORMAT_TIMESTAMP('%Y-%m-%d', v.mql_stage_entered_ts) as mql_date,
        FORMAT_TIMESTAMP('%Y-%m-%d', TIMESTAMP(v.converted_date_raw)) as sql_date,  -- converted_date_raw is DATE, cast to TIMESTAMP
        FORMAT_TIMESTAMP('%Y-%m-%d', v.Date_Became_SQO__c) as sqo_date,
        FORMAT_TIMESTAMP('%Y-%m-%d', TIMESTAMP(v.advisor_join_date__c)) as joined_date,  -- advisor_join_date__c is DATE, cast to TIMESTAMP
        
        -- Stage Flags
        v.is_contacted,
        v.is_mql,
        v.is_sql,
        CASE WHEN LOWER(v.SQO_raw) = 'yes' THEN 1 ELSE 0 END as is_sqo,
        CASE WHEN v.advisor_join_date__c IS NOT NULL OR v.StageName = 'Joined' THEN 1 ELSE 0 END as is_joined,
        
        -- Progression Flags (Numerators for conversion rates)
        v.contacted_to_mql_progression,
        v.mql_to_sql_progression,
        v.sql_to_sqo_progression,
        v.sqo_to_joined_progression,
        
        -- Eligibility Flags (Denominators for conversion rates)
        v.eligible_for_contacted_conversions,
        v.eligible_for_mql_conversions,
        v.eligible_for_sql_conversions,
        v.eligible_for_sqo_conversions,
        
        -- Deduplication Flags
        v.is_sqo_unique,
        v.is_joined_unique,
        v.is_primary_opp_record,
        
        -- Record Type
        v.recordtypeid as record_type_id,
        CASE 
          WHEN v.recordtypeid = @recruitingRecordType THEN 'Recruiting'
          WHEN v.recordtypeid = '012VS000009VoxrYAC' THEN 'Re-Engagement'
          ELSE 'Unknown'
        END as record_type_name,
        
        -- Raw date fields for cohort filtering (kept for UNION logic)
        v.stage_entered_contacting__c as _contacted_ts,
        v.mql_stage_entered_ts as _mql_ts,
        v.converted_date_raw as _sql_date,
        v.Date_Became_SQO__c as _sqo_ts,
        v.advisor_join_date__c as _joined_date

      FROM \`${FULL_TABLE}\` v
      LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
      WHERE 1=1 ${optionalFilters}
    ),
    
    -- Cohort 1: Contacted in period (for Contacted→MQL rate)
    contacted_cohort AS (
      SELECT *, 'contacted_in_period' as export_reason
      FROM base_select
      WHERE DATE(_contacted_ts) >= DATE(@startDate) 
        AND DATE(_contacted_ts) <= DATE(@endDate)
    ),
    
    -- Cohort 2: MQL in period (for MQL→SQL rate)
    mql_cohort AS (
      SELECT *, 'mql_in_period' as export_reason
      FROM base_select
      WHERE DATE(_mql_ts) >= DATE(@startDate) 
        AND DATE(_mql_ts) <= DATE(@endDate)
    ),
    
    -- Cohort 3: SQL in period (for SQL→SQO rate AND SQL volume)
    sql_cohort AS (
      SELECT *, 'sql_in_period' as export_reason
      FROM base_select
      WHERE DATE(_sql_date) >= DATE(@startDate) 
        AND DATE(_sql_date) <= DATE(@endDate)
    ),
    
    -- Cohort 4: SQO in period (for SQO→Joined rate AND SQO volume)
    sqo_cohort AS (
      SELECT *, 'sqo_in_period' as export_reason
      FROM base_select
      WHERE DATE(_sqo_ts) >= DATE(@startDate) 
        AND DATE(_sqo_ts) <= DATE(@endDate)
    ),
    
    -- Cohort 5: Joined in period (for Joined volume)
    joined_cohort AS (
      SELECT *, 'joined_in_period' as export_reason
      FROM base_select
      WHERE DATE(_joined_date) >= DATE(@startDate) 
        AND DATE(_joined_date) <= DATE(@endDate)
    ),
    
    -- Combine all cohorts (a record may appear in multiple cohorts)
    all_cohorts AS (
      SELECT * FROM contacted_cohort
      UNION ALL
      SELECT * FROM mql_cohort
      UNION ALL
      SELECT * FROM sql_cohort
      UNION ALL
      SELECT * FROM sqo_cohort
      UNION ALL
      SELECT * FROM joined_cohort
    ),
    
    -- Deduplicate by primary_key, keeping the most "advanced" export_reason
    deduplicated AS (
      SELECT 
        * EXCEPT(export_reason, _contacted_ts, _mql_ts, _sql_date, _sqo_ts, _joined_date),
        -- Aggregate export reasons for records in multiple cohorts
        STRING_AGG(DISTINCT export_reason, ', ') as export_reason
      FROM all_cohorts
      GROUP BY 
        lead_id, contact_id, opportunity_id, primary_key,
        advisor_name, salesforce_url, original_source, channel, sga, sgm,
        stage_name, aum, filter_date, contacted_date, mql_date, sql_date, sqo_date, joined_date,
        is_contacted, is_mql, is_sql, is_sqo, is_joined,
        contacted_to_mql_progression, mql_to_sql_progression, sql_to_sqo_progression, sqo_to_joined_progression,
        eligible_for_contacted_conversions, eligible_for_mql_conversions, eligible_for_sql_conversions, eligible_for_sqo_conversions,
        is_sqo_unique, is_joined_unique, is_primary_opp_record,
        record_type_id, record_type_name
    )
    
    SELECT * FROM deduplicated
    ORDER BY 
      -- Prioritize records that progressed further in funnel
      CASE 
        WHEN is_joined = 1 THEN 1
        WHEN is_sqo = 1 THEN 2
        WHEN is_sql = 1 THEN 3
        WHEN is_mql = 1 THEN 4
        ELSE 5
      END,
      contacted_date DESC
    LIMIT @limit
  `;

  interface RawExportRecord {
    lead_id: string | null;
    contact_id: string | null;
    opportunity_id: string | null;
    primary_key: string;
    advisor_name: string | null;
    salesforce_url: string | null;
    original_source: string | null;
    channel: string | null;
    sga: string | null;
    sgm: string | null;
    stage_name: string | null;
    aum: number | null;
    filter_date: string | null;
    contacted_date: string | null;
    mql_date: string | null;
    sql_date: string | null;
    sqo_date: string | null;
    joined_date: string | null;
    is_contacted: number;
    is_mql: number;
    is_sql: number;
    is_sqo: number;
    is_joined: number;
    contacted_to_mql_progression: number;
    mql_to_sql_progression: number;
    sql_to_sqo_progression: number;
    sqo_to_joined_progression: number;
    eligible_for_contacted_conversions: number;
    eligible_for_mql_conversions: number;
    eligible_for_sql_conversions: number;
    eligible_for_sqo_conversions: number;
    is_sqo_unique: number;
    is_joined_unique: number;
    is_primary_opp_record: number;
    record_type_id: string | null;
    record_type_name: string;
    export_reason: string;
  }

  const results = await runQuery<RawExportRecord>(query, params);

  return results.map(r => ({
    leadId: r.lead_id,
    contactId: r.contact_id,
    opportunityId: r.opportunity_id,
    primaryKey: r.primary_key,
    advisorName: r.advisor_name || 'Unknown',
    salesforceUrl: r.salesforce_url,
    originalSource: r.original_source,
    channel: r.channel,
    sga: r.sga,
    sgm: r.sgm,
    stageName: r.stage_name,
    aum: Number(r.aum) || 0,
    aumFormatted: formatCurrency(Number(r.aum) || 0),
    filterDate: r.filter_date,
    contactedDate: r.contacted_date,
    mqlDate: r.mql_date,
    sqlDate: r.sql_date,
    sqoDate: r.sqo_date,
    joinedDate: r.joined_date,
    isContacted: r.is_contacted,
    isMql: r.is_mql,
    isSql: r.is_sql,
    isSqo: r.is_sqo,
    isJoined: r.is_joined,
    contactedToMqlProgression: r.contacted_to_mql_progression,
    mqlToSqlProgression: r.mql_to_sql_progression,
    sqlToSqoProgression: r.sql_to_sqo_progression,
    sqoToJoinedProgression: r.sqo_to_joined_progression,
    eligibleForContactedConversions: r.eligible_for_contacted_conversions,
    eligibleForMqlConversions: r.eligible_for_mql_conversions,
    eligibleForSqlConversions: r.eligible_for_sql_conversions,
    eligibleForSqoConversions: r.eligible_for_sqo_conversions,
    isSqoUnique: r.is_sqo_unique,
    isJoinedUnique: r.is_joined_unique,
    isPrimaryOppRecord: r.is_primary_opp_record,
    recordTypeId: r.record_type_id,
    recordTypeName: r.record_type_name,
    exportReason: r.export_reason,
  }));
}
```

---

### Step 2: Update Type Definition

**File:** `src/lib/sheets/sheets-types.ts`

**Change Required:** Add `exportReason` field to `ExportDetailRecord` interface.

#### Find the ExportDetailRecord interface and add:

```typescript
export interface ExportDetailRecord {
  // ... existing fields ...
  
  // Add this new field:
  exportReason?: string;  // Why this record was included: 'contacted_in_period', 'sql_in_period', etc.
}
```

---

### Step 3: Update Detail Records Sheet Population

**File:** `src/lib/sheets/google-sheets-exporter.ts`

**Function:** `populateDetailRecordsSheet()`

**Change Required:** Add "Export Reason" column to the exported data.

#### Find the headers array and add 'Export Reason':

```typescript
const headers = [
  'Lead ID', 'Contact ID', 'Opportunity ID', 'Advisor Name', 'Salesforce URL',
  'Original Source', 'Channel', 'SGA', 'SGM', 'Stage', 'AUM',
  'FilterDate', 'Contacted Date', 'MQL Date', 'SQL Date', 'SQO Date', 'Joined Date',
  'Is Contacted', 'Is MQL', 'Is SQL', 'Is SQO', 'Is Joined',
  'Contacted→MQL', 'MQL→SQL', 'SQL→SQO', 'SQO→Joined',
  'Elig. Contacted', 'Elig. MQL', 'Elig. SQL', 'Elig. SQO',
  'Is SQO Unique', 'Is Joined Unique', 'Record Type',
  'Export Reason'  // ADD THIS
];
```

#### Find the row mapping and add export reason:

```typescript
const rows = records.map(r => [
  r.leadId || '',
  r.contactId || '',
  r.opportunityId || '',
  r.advisorName,
  r.salesforceUrl || '',
  r.originalSource || '',
  r.channel || '',
  r.sga || '',
  r.sgm || '',
  r.stageName || '',
  r.aum,
  r.filterDate || '',
  r.contactedDate || '',
  r.mqlDate || '',
  r.sqlDate || '',
  r.sqoDate || '',
  r.joinedDate || '',
  r.isContacted ? 'YES' : 'NO',
  r.isMql ? 'YES' : 'NO',
  r.isSql ? 'YES' : 'NO',
  r.isSqo ? 'YES' : 'NO',
  r.isJoined ? 'YES' : 'NO',
  r.contactedToMqlProgression ? 'YES' : 'NO',
  r.mqlToSqlProgression ? 'YES' : 'NO',
  r.sqlToSqoProgression ? 'YES' : 'NO',
  r.sqoToJoinedProgression ? 'YES' : 'NO',
  r.eligibleForContactedConversions ? 'YES' : 'NO',
  r.eligibleForMqlConversions ? 'YES' : 'NO',
  r.eligibleForSqlConversions ? 'YES' : 'NO',
  r.eligibleForSqoConversions ? 'YES' : 'NO',
  r.isSqoUnique ? 'YES' : 'NO',
  r.isJoinedUnique ? 'YES' : 'NO',
  r.recordTypeName || '',
  r.exportReason || ''  // ADD THIS
]);
```

---

### Step 4: Update Validation Sheet Formulas (✅ Already Fixed)

**File:** `src/lib/sheets/google-sheets-exporter.ts`

**Function:** `populateValidationSheet()`

**Status:** ✅ Already implemented with correct cohort logic.

The validation formulas:
1. ✅ Use the correct date column for each metric
2. ✅ Filter by date range AND specific flags
3. ✅ Match formulas check numerator/denominator first

#### Column Reference (Current Implementation)

Based on the current header order (without Export Reason):
- Column M: Contacted Date
- Column N: MQL Date  
- Column O: SQL Date
- Column P: SQO Date
- Column Q: Joined Date
- Column R: Is Contacted
- Column S: Is MQL
- Column T: Is SQL
- Column U: Is SQO
- Column V: Is Joined
- Column W: Contacted→MQL (progression)
- Column X: MQL→SQL (progression)
- Column Y: SQL→SQO (progression)
- Column Z: SQO→Joined (progression)
- Column AA: Elig. Contacted
- Column AB: Elig. MQL
- Column AC: Elig. SQL
- Column AD: Elig. SQO
- Column AE: Is SQO Unique
- Column AF: Is Joined Unique
- Column AG: Record Type

**Note:** If implementing the UNION approach, Export Reason would be Column AH.

#### Current Implementation (✅ Working):

The current `populateValidationSheet` function correctly implements cohort-based validation. See `src/lib/sheets/google-sheets-exporter.ts` lines 444-598.

**Key Features:**
- ✅ Filters by specific date column for each conversion rate
- ✅ Uses COUNTIFS with date range and flag filtering
- ✅ Match formulas check numerator/denominator matches first
- ✅ Includes debug columns (Detail Num Formula, Detail Den Formula, Dashboard Num, Dashboard Den)

#### Alternative Implementation (If Using UNION Approach):

If you implement the UNION approach with Export Reason, you could use this alternative validation structure:

```typescript
private async populateValidationSheet(spreadsheetId: string, data: SheetsExportData): Promise<void> {
  const startDate = data.dateRange.start;
  const endDate = data.dateRange.end;
  
  const values = [
    ['EXPORT VALIDATION REPORT'],
    [''],
    ['This sheet validates that exported records match dashboard calculations.'],
    [`Mode: ${data.calculationMode || 'Cohort (Resolved-only)'}`],
    [`Date Range: ${startDate} to ${endDate}`],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['VOLUME METRICS VALIDATION'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Metric', 'Dashboard', 'From Export', 'Match?', 'Validation Logic'],
    [
      'SQLs',
      data.metrics.sqls,
      // Count records where SQL Date is in range AND Is SQL = YES
      `=COUNTIFS('Detail Records'!O:O,">="&"${startDate}",'Detail Records'!O:O,"<="&"${endDate}",'Detail Records'!T:T,"YES")`,
      `=IF(B12=C12,"✓","✗")`,
      'SQL Date in period AND Is SQL = YES'
    ],
    [
      'SQOs',
      data.metrics.sqos,
      // Count records where SQO Date is in range AND Is SQO Unique = YES AND Record Type = Recruiting
      `=COUNTIFS('Detail Records'!P:P,">="&"${startDate}",'Detail Records'!P:P,"<="&"${endDate}",'Detail Records'!AE:AE,"YES",'Detail Records'!AG:AG,"Recruiting")`,
      `=IF(B13=C13,"✓","✗")`,
      'SQO Date in period AND Is SQO Unique = YES AND Recruiting'
    ],
    [
      'Joined',
      data.metrics.joined,
      // Count records where Joined Date is in range AND Is Joined Unique = YES
      `=COUNTIFS('Detail Records'!Q:Q,">="&"${startDate}",'Detail Records'!Q:Q,"<="&"${endDate}",'Detail Records'!AF:AF,"YES")`,
      `=IF(B14=C14,"✓","✗")`,
      'Joined Date in period AND Is Joined Unique = YES'
    ],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['CONVERSION RATE VALIDATION'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Each conversion rate is calculated from records who ENTERED that stage in the period.'],
    [''],
    ['Metric', 'Dashboard Rate', 'Dashboard Num', 'Dashboard Den', 'Export Num', 'Export Den', 'Export Rate', 'Match?'],
    [
      'Contacted → MQL',
      `${(data.conversionRates.contactedToMql.rate * 100).toFixed(1)}%`,
      data.conversionRates.contactedToMql.numerator,
      data.conversionRates.contactedToMql.denominator,
      // Numerator: Contacted Date in range AND Contacted→MQL = YES
      `=COUNTIFS('Detail Records'!M:M,">="&"${startDate}",'Detail Records'!M:M,"<="&"${endDate}",'Detail Records'!W:W,"YES")`,
      // Denominator: Contacted Date in range AND Elig. Contacted = YES  
      `=COUNTIFS('Detail Records'!M:M,">="&"${startDate}",'Detail Records'!M:M,"<="&"${endDate}",'Detail Records'!AA:AA,"YES")`,
      `=IFERROR(ROUND(E22/F22*100,1)&"%","N/A")`,
      `=IF(ABS(VALUE(SUBSTITUTE(B22,"%",""))-VALUE(SUBSTITUTE(G22,"%","")))<=0.5,"✓","✗")`
    ],
    [
      'MQL → SQL',
      `${(data.conversionRates.mqlToSql.rate * 100).toFixed(1)}%`,
      data.conversionRates.mqlToSql.numerator,
      data.conversionRates.mqlToSql.denominator,
      // Numerator: MQL Date in range AND MQL→SQL = YES
      `=COUNTIFS('Detail Records'!N:N,">="&"${startDate}",'Detail Records'!N:N,"<="&"${endDate}",'Detail Records'!X:X,"YES")`,
      // Denominator: MQL Date in range AND Elig. MQL = YES
      `=COUNTIFS('Detail Records'!N:N,">="&"${startDate}",'Detail Records'!N:N,"<="&"${endDate}",'Detail Records'!AB:AB,"YES")`,
      `=IFERROR(ROUND(E23/F23*100,1)&"%","N/A")`,
      `=IF(ABS(VALUE(SUBSTITUTE(B23,"%",""))-VALUE(SUBSTITUTE(G23,"%","")))<=0.5,"✓","✗")`
    ],
    [
      'SQL → SQO',
      `${(data.conversionRates.sqlToSqo.rate * 100).toFixed(1)}%`,
      data.conversionRates.sqlToSqo.numerator,
      data.conversionRates.sqlToSqo.denominator,
      // Numerator: SQL Date in range AND SQL→SQO = YES
      `=COUNTIFS('Detail Records'!O:O,">="&"${startDate}",'Detail Records'!O:O,"<="&"${endDate}",'Detail Records'!Y:Y,"YES")`,
      // Denominator: SQL Date in range AND Elig. SQL = YES
      `=COUNTIFS('Detail Records'!O:O,">="&"${startDate}",'Detail Records'!O:O,"<="&"${endDate}",'Detail Records'!AC:AC,"YES")`,
      `=IFERROR(ROUND(E24/F24*100,1)&"%","N/A")`,
      `=IF(ABS(VALUE(SUBSTITUTE(B24,"%",""))-VALUE(SUBSTITUTE(G24,"%","")))<=0.5,"✓","✗")`
    ],
    [
      'SQO → Joined',
      `${(data.conversionRates.sqoToJoined.rate * 100).toFixed(1)}%`,
      data.conversionRates.sqoToJoined.numerator,
      data.conversionRates.sqoToJoined.denominator,
      // Numerator: SQO Date in range AND SQO→Joined = YES
      `=COUNTIFS('Detail Records'!P:P,">="&"${startDate}",'Detail Records'!P:P,"<="&"${endDate}",'Detail Records'!Z:Z,"YES")`,
      // Denominator: SQO Date in range AND Elig. SQO = YES
      `=COUNTIFS('Detail Records'!P:P,">="&"${startDate}",'Detail Records'!P:P,"<="&"${endDate}",'Detail Records'!AD:AD,"YES")`,
      `=IFERROR(ROUND(E25/F25*100,1)&"%","N/A")`,
      `=IF(ABS(VALUE(SUBSTITUTE(B25,"%",""))-VALUE(SUBSTITUTE(G25,"%","")))<=0.5,"✓","✗")`
    ],
    [''],
    ['═══════════════════════════════════════════════════════════════'],
    ['COHORT LOGIC EXPLANATION'],
    ['═══════════════════════════════════════════════════════════════'],
    [''],
    ['Volume Metrics:'],
    ['  • SQLs: Count of records where converted_date_raw (SQL Date) is in the selected period'],
    ['  • SQOs: Count of records where Date_Became_SQO__c (SQO Date) is in period AND Recruiting record type'],
    ['  • Joined: Count of records where advisor_join_date__c (Joined Date) is in the selected period'],
    [''],
    ['Conversion Rates (Cohort Efficiency):'],
    ['  • Contacted→MQL: Of people CONTACTED in the period who resolved, how many became MQL?'],
    ['  • MQL→SQL: Of people who became MQL in the period who resolved, how many became SQL?'],
    ['  • SQL→SQO: Of people who became SQL in the period who resolved, how many became SQO?'],
    ['  • SQO→Joined: Of people who became SQO in the period who resolved, how many joined?'],
    [''],
    ['Note: A record may appear in multiple cohorts if they progressed through multiple stages in the period.'],
  ];

  await this.sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Validation!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}
```

---

## Testing Checklist

✅ **Current Status:** All validations are passing. Use this checklist to verify after any future changes.

To verify the fix is working, test with any date range:

### 1. Pre-Export Dashboard Check
- [ ] Verify dashboard values match expected values for the selected date range
- [ ] Note the numerator and denominator for each conversion rate
- [ ] Verify the mode (Cohort vs Period) matches your expectation

### 2. Run Export
- [ ] Click "Export to Sheets" button
- [ ] Export completes without error
- [ ] Google Sheet opens in new tab

### 3. Verify Detail Records Tab
- [ ] Total records include all necessary cohorts
- [ ] All date columns (Contacted Date, MQL Date, SQL Date, SQO Date, Joined Date) are populated where applicable
- [ ] Eligibility and progression flags are correctly set
- [ ] Record Type column shows "Recruiting" for SQOs

**Note:** If using UNION approach, Export Reason column would show which cohort(s) each record belongs to.

### 4. Verify Validation Tab
- [ ] SQLs: Dashboard=193, Export=193, Match=✓
- [ ] SQOs: Dashboard=144, Export=144, Match=✓
- [ ] Joined: Dashboard=17, Export=17, Match=✓
- [ ] Contacted→MQL: Rate matches within 0.5%
- [ ] MQL→SQL: Rate matches within 0.5%
- [ ] SQL→SQO: Rate matches within 0.5%
- [ ] SQO→Joined: Rate matches within 0.5%

### 5. Verify Specific Record Counts
Using the Detail Records sheet, spot-check:
- [ ] Records where SQL Date is in range AND Is SQL=YES: should match dashboard SQLs count
- [ ] Records where SQO Date is in range AND Is SQO Unique=YES AND Record Type=Recruiting: should match dashboard SQOs count
- [ ] Records where Joined Date is in range AND Is Joined Unique=YES: should match dashboard Joined count

**Note:** If using UNION approach with Export Reason, you could filter by export_reason to verify each cohort separately.

---

## Troubleshooting

### Issue: Column references are wrong
**Symptom:** Formulas show #REF! errors or wrong values
**Solution:** Count the actual columns in the Detail Records sheet and update the column letters in the validation formulas. The column letters above assume the exact header order shown in Step 3.

### Issue: Export takes too long or times out
**Symptom:** Export fails with timeout error
**Solution:** 
1. Reduce the limit from 50000 to 25000
2. Or increase the Vercel function timeout in `vercel.json`

### Issue: Date comparison not working
**Symptom:** COUNTIFS returns 0 when it shouldn't
**Solution:** The date columns may be formatted as text. Ensure dates are in YYYY-MM-DD format and the COUNTIFS comparison uses the same format.

### Issue: Slight mismatch in conversion rates (off by 1-2)
**Symptom:** Validation shows ✗ but numbers are very close
**Solution:** This can happen due to:
1. Records that were updated between dashboard load and export
2. Edge cases with date/time boundaries
Adjust the tolerance in the Match formula from 0.5 to 1.0 if needed.

---

## Files Changed Summary (What Was Actually Fixed)

| File | Change | Status |
|------|--------|--------|
| `src/lib/queries/export-records.ts` | Added `mql_stage_entered_ts` to date filter OR condition | ✅ Fixed |
| `src/lib/sheets/google-sheets-exporter.ts` | Updated `populateValidationSheet()` with correct COUNTIFS formulas | ✅ Fixed |
| `src/lib/sheets/google-sheets-exporter.ts` | Improved match formula to check numerator/denominator first | ✅ Fixed |

## Alternative Implementation (UNION Approach)

If you want to implement the more explicit UNION-based approach for better debugging:

| File | Change | Status |
|------|--------|--------|
| `src/lib/queries/export-records.ts` | Replace `getExportDetailRecords()` with UNION-based query | ⚠️ Optional |
| `src/lib/sheets/sheets-types.ts` | Add `exportReason` to `ExportDetailRecord` interface | ⚠️ Optional |
| `src/lib/sheets/google-sheets-exporter.ts` | Update `populateDetailRecordsSheet()` to include Export Reason column | ⚠️ Optional |

---

## Quick Reference: Date Fields by Metric

| Metric | Date Field | BigQuery Type |
|--------|-----------|---------------|
| Contacted→MQL cohort | `stage_entered_contacting__c` | TIMESTAMP |
| MQL→SQL cohort | `mql_stage_entered_ts` | TIMESTAMP |
| SQL→SQO cohort / SQL volume | `converted_date_raw` | DATE |
| SQO→Joined cohort / SQO volume | `Date_Became_SQO__c` | TIMESTAMP |
| Joined volume | `advisor_join_date__c` | DATE |

---

## BigQuery Verification Query

Use this to verify the fix is working correctly:

```sql
-- Should return exact dashboard values
SELECT
  -- Volumes
  (SELECT COUNT(*) FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   WHERE converted_date_raw BETWEEN '2025-10-01' AND '2025-12-31' AND is_sql = 1) as sqls,
  
  (SELECT SUM(is_sqo_unique) FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   WHERE DATE(Date_Became_SQO__c) BETWEEN '2025-10-01' AND '2025-12-31'
   AND recordtypeid = '012Dn000000mrO3IAI') as sqos,
   
  (SELECT SUM(is_joined_unique) FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   WHERE advisor_join_date__c BETWEEN '2025-10-01' AND '2025-12-31') as joined,

  -- Conversion Rates
  (SELECT ROUND(SAFE_DIVIDE(SUM(contacted_to_mql_progression), SUM(eligible_for_contacted_conversions))*100,1)
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   WHERE DATE(stage_entered_contacting__c) BETWEEN '2025-10-01' AND '2025-12-31') as contacted_to_mql_pct,
   
  (SELECT ROUND(SAFE_DIVIDE(SUM(mql_to_sql_progression), SUM(eligible_for_mql_conversions))*100,1)
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   WHERE DATE(mql_stage_entered_ts) BETWEEN '2025-10-01' AND '2025-12-31') as mql_to_sql_pct,
   
  (SELECT ROUND(SAFE_DIVIDE(SUM(sql_to_sqo_progression), SUM(eligible_for_sql_conversions))*100,1)
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   WHERE converted_date_raw BETWEEN '2025-10-01' AND '2025-12-31') as sql_to_sqo_pct,
   
  (SELECT ROUND(SAFE_DIVIDE(SUM(sqo_to_joined_progression), SUM(eligible_for_sqo_conversions))*100,1)
   FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
   WHERE DATE(Date_Became_SQO__c) BETWEEN '2025-10-01' AND '2025-12-31') as sqo_to_joined_pct;
```

Expected output:
```
sqls: 193
sqos: 144
joined: 17
contacted_to_mql_pct: 6.1
mql_to_sql_pct: 45.2
sql_to_sqo_pct: 73.1
sqo_to_joined_pct: 10.6
```
