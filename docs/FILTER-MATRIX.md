# Filter Application Matrix

This document shows which filters apply to which metrics and how they're applied based on the data source (Lead vs Opportunity).

## Filter Types

1. **Date Filters**: Applied to specific date fields per metric
2. **Channel Filters**: Applied via `Channel_Grouping_Name` from `new_mapping` table
3. **Source Filters**: Applied via `Original_source` field
4. **SGA Filters**: Applied based on metric type (Lead vs Opportunity)
5. **SGM Filters**: Applied only to opportunity-level metrics

---

## Filter Application by Metric

| Metric | Date Field | Channel Filter | Source Filter | SGA Filter | SGM Filter | Record Type |
|--------|------------|----------------|---------------|------------|------------|-------------|
| **Prospect** | `FilterDate` | ✅ | ✅ | `SGA_Owner_Name__c` (Lead) | ❌ | ❌ |
| **Contacted** | `stage_entered_contacting__c` | ✅ | ✅ | `SGA_Owner_Name__c` (Lead) | ❌ | ❌ |
| **MQL** | `mql_stage_entered_ts` | ✅ | ✅ | `SGA_Owner_Name__c` (Lead) | ❌ | ❌ |
| **SQL** | `converted_date_raw` | ✅ | ✅ | `SGA_Owner_Name__c` (Lead) | ❌ | ❌ |
| **SQO** | `Date_Became_SQO__c` | ✅ | ✅ | `Opp_SGA_Name__c` (Opp) | `SGM_Owner_Name__c` | ✅ Recruiting |
| **Joined** | `advisor_join_date__c` | ✅ | ✅ | `Opp_SGA_Name__c` (Opp) | `SGM_Owner_Name__c` | ✅ Recruiting |
| **Open Pipeline AUM** | N/A (current state) | ❌ | ❌ | ❌ | ❌ | ✅ Recruiting |

---

## SGA Filter Logic

### Lead-Level Metrics (Contacted, MQL, SQL)
```sql
WHERE v.SGA_Owner_Name__c = @sga
```
- **Field**: `SGA_Owner_Name__c` (from Lead object)
- **Applies To**: Contacted, MQL, SQL metrics
- **Source**: Lead record before conversion

### Opportunity-Level Metrics (SQO, Joined)
```sql
WHERE v.Opp_SGA_Name__c = @sga
```
- **Field**: `Opp_SGA_Name__c` (from Opportunity object)
- **Applies To**: SQO, Joined metrics
- **Source**: Opportunity record after conversion
- **Note**: May differ from Lead SGA if SGA changed post-conversion

---

## SGM Filter Logic

### Opportunity-Level Metrics Only
```sql
WHERE v.SGM_Owner_Name__c = @sgm
```
- **Field**: `SGM_Owner_Name__c` (from `Opportunity_Owner_Name__c`)
- **Applies To**: SQO, Joined, Open Pipeline AUM
- **Does NOT Apply To**: Contacted, MQL, SQL (these are lead-level)

---

## Channel Filter Logic

```sql
WHERE COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') = @channel
```
- **Source**: `new_mapping` table (`Channel_Grouping_Name`)
- **Fallback**: `Channel_Grouping_Name` from view (if mapping exists)
- **Default**: 'Other' if no mapping found
- **Applies To**: All metrics (Contacted, MQL, SQL, SQO, Joined)
- **Does NOT Apply To**: Open Pipeline AUM (no filters)

---

## Source Filter Logic

```sql
WHERE v.Original_source = @source
```
- **Field**: `Original_source` (from Lead or Opportunity)
- **Priority**: Opportunity source takes precedence if available
- **Applies To**: All metrics (Contacted, MQL, SQL, SQO, Joined)
- **Does NOT Apply To**: Open Pipeline AUM (no filters)

---

## Record Type Filter

```sql
WHERE v.recordtypeid = @recruitingRecordType
```
- **Value**: `'012Dn000000mrO3IAI'` (Recruiting)
- **Applies To**: SQO, Joined, Open Pipeline AUM
- **Does NOT Apply To**: Contacted, MQL, SQL (lead-level, no record type)

---

## Date Filter Application

Date filters are applied to **specific date fields** per metric, NOT to a generic `FilterDate`:

| Metric | Date Field Used | Additional Conditions |
|--------|----------------|----------------------|
| Prospect | `FilterDate` | None (all records with FilterDate in range) |
| Contacted | `stage_entered_contacting__c` | `is_contacted = 1` |
| MQL | `mql_stage_entered_ts` | `is_mql = 1` |
| SQL | `converted_date_raw` | `is_sql = 1` |
| SQO | `Date_Became_SQO__c` |
| Joined | `advisor_join_date__c` |
| Open Pipeline AUM | N/A (no date filter) |

**Important**: Each metric uses its own date field. Do NOT filter by `FilterDate` for volume metrics.

---

## Complete Filter Example

### SQL → SQO Rate Query with All Filters

```sql
SELECT
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
    AND v.recordtypeid = @recruitingRecordType  -- Record type filter
    AND v.is_sqo_unique = 1
    -- Channel filter
    AND COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') = @channel
    -- Source filter
    AND v.Original_source = @source
    -- SGA filter (Opportunity-level)
    AND v.Opp_SGA_Name__c = @sga
    -- SGM filter
    AND v.SGM_Owner_Name__c = @sgm
  ) as sql_numer,
  
  -- Denominator (similar filters)
  COUNTIF(...) as sql_denom
  
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` v
LEFT JOIN `savvy-gtm-analytics.SavvyGTMData.new_mapping` nm
  ON v.Original_source = nm.original_source
WHERE 1=1
  -- Additional WHERE conditions if needed
```

---

## Permission-Based Filter Application

When a user has restricted permissions, filters are automatically applied:

### SGA Filter (User is SGA)
```typescript
if (permissions.sgaFilter) {
  filters.sga = permissions.sgaFilter;
}
```
- **Applied To**: All metrics (uses appropriate SGA field per metric type)

### SGM Filter (User is SGM)
```typescript
if (permissions.sgmFilter) {
  filters.sgm = permissions.sgmFilter;
}
```
- **Applied To**: Only opportunity-level metrics (SQO, Joined, Open Pipeline AUM)

---

## Filter Precedence

1. **User Permissions**: Automatically applied based on user role
2. **Explicit Filters**: User-selected filters in dashboard
3. **Date Range**: Applied to specific date fields per metric
4. **Record Type**: Always applied for opportunity-level metrics

---

## Special Cases

### Open Pipeline AUM
- **No Date Filter**: Shows current state, all time
- **No Channel Filter**: Shows all channels
- **No Source Filter**: Shows all sources
- **No SGA Filter**: Shows all SGAs
- **No SGM Filter**: Shows all SGMs
- **Record Type Filter**: ✅ Always applied (Recruiting only)
- **Stage Filter**: ✅ Applied (only active stages)

### Conversion Rates (Period Mode)
- **Resolution Required**: Records must enter AND resolve in same period
- **Date Fields**: May differ for numerator vs denominator
- **Example**: SQL→SQO uses `converted_date_raw` for denominator, `Date_Became_SQO__c` for numerator

### Conversion Rates (Cohort Mode)
- **Uses Pre-calculated Flags**: `eligible_for_*_conversions` and `*_progression`
- **Same Date Field**: Both numerator and denominator use cohort date
- **Resolved Only**: Open records excluded from denominators

---

## Filter Field Reference

| Filter Type | Lead Metrics Field | Opportunity Metrics Field |
|-------------|-------------------|---------------------------|
| **SGA** | `SGA_Owner_Name__c` | `Opp_SGA_Name__c` |
| **SGM** | N/A (not applicable) | `SGM_Owner_Name__c` |
| **Channel** | `Channel_Grouping_Name` (from mapping) | `Channel_Grouping_Name` (from mapping) |
| **Source** | `Original_source` | `Original_source` |

---

## Implementation Notes

- All filters use **parameterized queries** (`@paramName` syntax)
- Channel filter uses `COALESCE` to handle mapping fallback
- SGA filter field changes based on metric type (Lead vs Opportunity)
- Record type filter is always `'012Dn000000mrO3IAI'` (Recruiting)
- Date filters use `TIMESTAMP(@paramName)` for BigQuery compatibility
