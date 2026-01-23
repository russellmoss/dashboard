# SGA Activity Dashboard - Final Verification Investigation

**Purpose**: Before executing the implementation plan, verify these remaining details via MCP BigQuery connection and codebase review. Update the implementation plan as needed based on findings.

---

## Section 1: Verify Helper Functions & Imports

### 1.1 Verify `runQuery<T>()` Helper

**Task**: Find and verify the `runQuery` helper function signature.

```bash
# Search for runQuery in the codebase
grep -r "export.*runQuery" src/lib/
grep -r "function runQuery" src/lib/
cat src/lib/bigquery.ts
```

**Questions**:
1. Does `runQuery<T>()` exist? What file is it in?
2. What is its exact signature (parameters, return type)?
3. How should it be imported?

**If NOT found**: The plan needs to be updated to use the actual BigQuery query pattern in the codebase. Check how `src/lib/queries/weekly-actuals.ts` executes queries.

**Update Plan If Needed**: Adjust all query function imports and execution patterns.

---

### 1.2 Verify `cachedQuery` Function Signature

**Task**: Verify the exact signature of `cachedQuery` utility.

```bash
cat src/lib/cache.ts
```

**Questions**:
1. What is the exact function signature?
2. How are cache keys generated?
3. What are the correct parameters for `revalidate` and `tags`?

**Verify this pattern is correct**:
```typescript
cachedQuery(
  getScheduledInitialCalls,
  'sga-activity-initial-calls',
  CACHE_TAGS.SGA_HUB
);
```

**Update Plan If Needed**: Fix all cached wrapper functions to match actual signature.

---

### 1.3 Verify `logger` Import

**Task**: Find where `logger` is imported from.

```bash
grep -r "import.*logger" src/app/api/
grep -r "from.*logger" src/lib/
cat src/lib/logger.ts 2>/dev/null || echo "logger.ts not found"
```

**Questions**:
1. Does a `logger` module exist?
2. What is the correct import path?
3. Or should we use `console.error` instead?

**Update Plan If Needed**: Fix all API route logger imports or revert to console.error.

---

## Section 2: Verify Tremor Component Availability

### 2.1 Check Tremor Components Used

**Task**: Verify all Tremor components referenced in the plan exist.

```bash
# Check package.json for Tremor version
grep "tremor" package.json

# Check existing component imports for patterns
grep -r "from '@tremor/react'" src/components/ | head -20
```

**Components to verify**:
- [ ] `DateRangePicker` - Does it exist in Tremor?
- [ ] `DonutChart` - Does it exist?
- [ ] `BarList` - Does it exist?
- [ ] `Switch` - Does it exist?
- [ ] `ProgressBar` - Does it exist?

**If any component doesn't exist**:
- Find alternative Tremor component
- Or use native HTML/custom component
- Update the plan accordingly

---

### 2.2 Check Existing Filter Components

**Task**: Review how existing filters are implemented to match patterns.

```bash
cat src/components/dashboard/GlobalFilters.tsx
```

**Questions**:
1. How are date range filters currently implemented?
2. Is there a reusable DateRangePicker pattern?
3. How are toggle switches implemented?

**Update Plan If Needed**: Match existing filter UI patterns.

---

## Section 3: Verify BigQuery Field Names

### 3.1 Verify Activity View Fields

**Run in BigQuery via MCP**:
```sql
-- Get exact field names from vw_sga_activity_performance
SELECT column_name, data_type
FROM `savvy-gtm-analytics.savvy_analytics.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_sga_activity_performance'
ORDER BY ordinal_position;
```

**Fields to confirm**:
- [ ] `activity_channel_group` - Does this exist or is it `activity_channel`?
- [ ] `SGA_IsActive` - Does this exist?
- [ ] `task_who_id` - Confirmed in original investigation
- [ ] `task_subject` - Confirmed in original investigation
- [ ] `task_subtype` - Does this exist or is it `task_type`?
- [ ] `is_true_cold_call` - Confirmed

**Update Plan If Needed**: Fix any incorrect field names in queries.

---

### 3.2 Verify Funnel Master Fields for Scheduled Calls

**Run in BigQuery via MCP**:
```sql
-- Check if scheduled call date fields exist in vw_funnel_master
SELECT column_name, data_type
FROM `savvy-gtm-analytics.Tableau_Views.INFORMATION_SCHEMA.COLUMNS`
WHERE table_name = 'vw_funnel_master'
  AND column_name IN (
    'Initial_Call_Scheduled_Date__c',
    'Qualification_Call_Date__c',
    'SGA_Owner_Name__c',
    'Opp_SGA_Name__c',
    'primary_key',
    'advisor_name',
    'salesforce_url'
  )
ORDER BY column_name;
```

**Update Plan If Needed**: Fix any incorrect field names.

---

### 3.3 Test Key Queries for Errors

**Run these test queries in BigQuery via MCP to catch syntax errors**:

**Test Query 1: Scheduled Initial Calls**
```sql
SELECT
  SGA_Owner_Name__c as sga_name,
  Initial_Call_Scheduled_Date__c as scheduled_date,
  COUNT(*) as call_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Initial_Call_Scheduled_Date__c IS NOT NULL
  AND Initial_Call_Scheduled_Date__c >= '2026-01-19'
  AND Initial_Call_Scheduled_Date__c <= '2026-02-01'
GROUP BY sga_name, scheduled_date
ORDER BY scheduled_date
LIMIT 10;
```

**Test Query 2: Activity Distribution**
```sql
SELECT
  activity_channel_group as channel,
  activity_day_of_week as day_name,
  EXTRACT(DAYOFWEEK FROM task_created_date_est) as day_of_week,
  COUNT(*) as activity_count
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
WHERE task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
  AND SGA_IsActive = TRUE
  AND task_subject NOT LIKE '%[lemlist]%'
GROUP BY channel, day_name, day_of_week
ORDER BY channel, day_of_week
LIMIT 20;
```

**Test Query 3: SMS Response Rate**
```sql
WITH outgoing AS (
  SELECT DISTINCT task_who_id as lead_id
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
  WHERE activity_channel_group = 'SMS'
    AND direction = 'Outbound'
    AND task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND task_who_id IS NOT NULL
),
incoming AS (
  SELECT DISTINCT task_who_id as lead_id
  FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_activity_performance`
  WHERE activity_channel_group = 'SMS'
    AND direction = 'Inbound'
    AND task_created_date_est >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
    AND task_who_id IS NOT NULL
)
SELECT
  COUNT(DISTINCT o.lead_id) as leads_texted,
  COUNT(DISTINCT i.lead_id) as leads_responded,
  SAFE_DIVIDE(COUNT(DISTINCT i.lead_id), COUNT(DISTINCT o.lead_id)) as response_rate
FROM outgoing o
LEFT JOIN incoming i ON o.lead_id = i.lead_id;
```

**If any query fails**: Document the error and fix the corresponding query in the plan.

---

## Section 4: Verify Component Integration

### 4.1 RecordDetailModal Compatibility

**Task**: Verify RecordDetailModal can accept different ID types.

```bash
cat src/components/dashboard/RecordDetailModal.tsx | head -50
```

**Questions**:
1. What ID format does RecordDetailModal expect?
2. Can it accept a Lead ID (`00Q...`)?
3. Can it accept a Task ID (`00T...`)?
4. How does it fetch record details?

**If incompatible**: 
- May need to pass Lead ID instead of Task ID
- Or create a separate Task Detail Modal
- Update the drill-down click handler

---

### 4.2 DataFreshnessIndicator Component

**Task**: Verify this component exists and how it's used.

```bash
ls src/components/dashboard/DataFreshnessIndicator*
cat src/components/dashboard/DataFreshnessIndicator.tsx 2>/dev/null | head -30
```

**If not found**: Remove from the plan or create it.

---

## Section 5: Verify CACHE_TAGS Constant

### 5.1 Check Available Cache Tags

**Task**: Verify CACHE_TAGS includes SGA_HUB or what to use.

```bash
cat src/lib/cache.ts | grep -A 10 "CACHE_TAGS"
```

**Questions**:
1. What cache tags are available?
2. Is `CACHE_TAGS.SGA_HUB` correct?
3. Or should we use `CACHE_TAGS.DASHBOARD`?

**Update Plan If Needed**: Use correct cache tag constant.

---

## Section 6: Verify Permissions Pattern

### 6.1 Check Permission Utilities

**Task**: Verify how permissions are checked in existing pages.

```bash
cat src/lib/permissions.ts | head -50
grep -r "getUserPermissions" src/app/api/ | head -5
```

**Questions**:
1. Is `getUserPermissions` the correct function name?
2. What does it return (shape of permissions object)?
3. How is `sgaFilter` applied?

**Update Plan If Needed**: Match existing permission patterns.

---

### 6.2 Check getSessionPermissions Location

**Task**: Verify the correct import path.

```bash
grep -r "export.*getSessionPermissions" src/
grep -r "getSessionPermissions" src/app/dashboard/ | head -5
```

**Questions**:
1. Is it in `@/types/auth` as Cursor said?
2. Or is it in `@/lib/utils/permissions`?
3. Or somewhere else?

**Update Plan If Needed**: Fix import path in SGAActivityContent.tsx.

---

## Section 7: Final Pre-Build Checklist

After completing all investigations above, verify:

- [ ] All BigQuery field names confirmed
- [ ] All helper function imports verified
- [ ] All Tremor components available
- [ ] All cache patterns correct
- [ ] All permission patterns correct
- [ ] Test queries execute without errors
- [ ] RecordDetailModal integration verified

**Only proceed with implementation once all items are checked.**

---

## Instructions for Cursor.ai

1. **Execute each section in order**
2. **Document findings** for each verification point
3. **Update the implementation plan** (`sga-activity-dashboard-implementation-plan.md`) if any issues found
4. **Add findings to Appendix D** of the plan as "Pre-Build Verification Results"
5. **Mark this investigation complete** when all sections verified

---

## Findings Log

*(Cursor.ai: Document your findings here as you complete each section)*

### Section 1 Findings:
- 1.1 runQuery: 
- 1.2 cachedQuery: 
- 1.3 logger: 

### Section 2 Findings:
- 2.1 Tremor components: 
- 2.2 Filter patterns: 

### Section 3 Findings:
- 3.1 Activity view fields: 
- 3.2 Funnel master fields: 
- 3.3 Test query results: 

### Section 4 Findings:
- 4.1 RecordDetailModal: 
- 4.2 DataFreshnessIndicator: 

### Section 5 Findings:
- 5.1 Cache tags: 

### Section 6 Findings:
- 6.1 Permissions pattern: 
- 6.2 getSessionPermissions: 

### Section 7 Status:
- [ ] All verifications complete
- [ ] Plan updated with corrections
- [ ] Ready for implementation

---

**End of Investigation Document**
