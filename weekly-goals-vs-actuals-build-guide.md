# Weekly Goals vs. Actuals — Agentic Implementation Guide

**Feature:** Replace "Weekly Goals" tab with "Goals vs. Actuals" in the SGA Hub
**Date:** March 9, 2026
**Author:** Russell (RevOps) via Claude Projects
**Executor:** Claude Code

---

## How to Use This Guide

This guide is organized into **7 phases**, each with **numbered steps**. Each step begins with a **Claude Code prompt** followed by **exact code snippets** to keep the agent on track. At the end of each phase, Claude Code must run **validation and verification**, then **STOP** and report results. Do not proceed to the next phase until the human confirms.

### Conventions

- `🚫 DO NOT PROCEED` — Hard stop. Wait for human approval.
- `✅ VERIFY` — Run the verification command and report output.
- `📋 VALIDATION DATA` — Use these known-good values to confirm queries return correct data.
- All file paths are relative to the project root.
- All BigQuery queries use parameterized `@` params, never string interpolation.
- All new query functions MUST be wrapped in `cachedQuery(fn, key, CACHE_TAGS.SGA_HUB)`.
- Neon/Prisma migrations: generate manual SQL for human execution in Neon SQL Editor, then run `npx prisma generate` locally. Agents MUST NOT run `npx prisma migrate dev` directly.

### Validation Data (Amy Waller)

Use these known values to verify queries throughout the build:

| Metric | Week | Expected Value |
|--------|------|----------------|
| Initial Calls | This Week (3/9–3/15) | 1 (John Hetzel, Mar 9) |
| Initial Calls | Next Week (3/16–3/22) | 2 (Korey Doucette + Paul Bullock, Tue 3/17) |
| MQL Actuals | Last Week (3/2–3/8) | 7 |
| SQL Actuals | Last Week (3/2–3/8) | 2 |
| SQO Actuals | Last Week (3/2–3/8) | 2 |

---

## Phase 1: Schema & Types

**Goal:** Update the Prisma schema with 4 new goal fields, update all TypeScript types, and add new drill-down record types. This phase intentionally breaks the build — types will be out of sync with implementations until Phase 2.

---

### Step 1.1: Prisma Schema Migration

**Claude Code Prompt:**
```
MANDATORY FILE READS (in this order):
1. prisma/schema.prisma
2. src/types/sga-hub.ts
3. src/types/drill-down.ts

CONTEXT:
We are adding 4 new goal fields to the existing WeeklyGoal model using ALTER ADD COLUMN (NOT drop & recreate). The existing 3 fields (initialCallsGoal, qualificationCallsGoal, sqoGoal) stay as-is. We add: mqlGoal, sqlGoal, leadsSourcedGoal, leadsContactedGoal — all Int with @default(0).

IMPORTANT: Do NOT run `npx prisma migrate dev`. Instead:
1. Generate the SQL migration manually
2. Output the SQL for human execution in Neon SQL Editor
3. After human confirms SQL was run, run `npx prisma generate` to update the client

CHANGE — prisma/schema.prisma:
In the WeeklyGoal model, add these 4 fields AFTER the existing sqoGoal field:

  mqlGoal                Int      @default(0)
  sqlGoal                Int      @default(0)
  leadsSourcedGoal       Int      @default(0)
  leadsContactedGoal     Int      @default(0)

Do NOT change any other model.
Do NOT change the @@unique, @@index constraints — they remain as-is.
Do NOT remove or rename any existing fields.

OUTPUT the following SQL for human execution:
```

**Migration SQL (for human to run in Neon SQL Editor):**
```sql
ALTER TABLE "WeeklyGoal" ADD COLUMN "mqlGoal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WeeklyGoal" ADD COLUMN "sqlGoal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WeeklyGoal" ADD COLUMN "leadsSourcedGoal" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WeeklyGoal" ADD COLUMN "leadsContactedGoal" INTEGER NOT NULL DEFAULT 0;
```

**After human confirms SQL ran:**
```bash
npx prisma generate
```

---

### Step 1.2: Update TypeScript Types — sga-hub.ts

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/types/sga-hub.ts (read the ENTIRE file)

CONTEXT:
We are expanding the Weekly Goals feature from 3 metrics to 7. The existing types must be updated ADDITIVELY — add new fields, do not remove or rename existing ones.

CHANGES to src/types/sga-hub.ts:

1. WeeklyGoal interface — add 4 new fields:
   mqlGoal: number;
   sqlGoal: number;
   leadsSourcedGoal: number;
   leadsContactedGoal: number;

2. WeeklyGoalInput interface — add 4 new fields:
   mqlGoal: number;
   sqlGoal: number;
   leadsSourcedGoal: number;
   leadsContactedGoal: number;

3. WeeklyActual interface — REPLACE the existing 3 fields with 7 metrics + 2 self-sourced variants:
   mqls: number;
   sqls: number;
   sqos: number;
   initialCalls: number;
   qualificationCalls: number;
   leadsSourced: number;
   leadsSourcedSelfSourced: number;
   leadsContacted: number;
   leadsContactedSelfSourced: number;

   IMPORTANT: The existing field names `initialCalls`, `qualificationCalls`, `sqos` stay the same.
   Add `mqls`, `sqls`, `leadsSourced`, `leadsSourcedSelfSourced`, `leadsContacted`, `leadsContactedSelfSourced`.

4. WeeklyGoalWithActuals interface — add goal/actual/diff triplets for all 7 metrics.
   Keep existing: initialCallsGoal, initialCallsActual, initialCallsDiff, qualificationCallsGoal, qualificationCallsActual, qualificationCallsDiff, sqoGoal, sqoActual, sqoDiff
   Add new triplets:
     mqlGoal: number | null;
     mqlActual: number;
     mqlDiff: number | null;
     sqlGoal: number | null;
     sqlActual: number;
     sqlDiff: number | null;
     leadsSourcedGoal: number | null;
     leadsSourcedActual: number;
     leadsSourcedSelfSourcedActual: number;
     leadsSourcedDiff: number | null;
     leadsContactedGoal: number | null;
     leadsContactedActual: number;
     leadsContactedSelfSourcedActual: number;
     leadsContactedDiff: number | null;

Do NOT change any other types in this file.
Do NOT remove the existing WeeklyGoalsPostBody, WeeklyActualsQueryParams, or any other types.
```

---

### Step 1.3: Update TypeScript Types — drill-down.ts

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/types/drill-down.ts (read the ENTIRE file)

CONTEXT:
We are adding 4 new drill-down metric types: 'mqls', 'sqls', 'leads-sourced', 'leads-contacted'. Each needs a record type, raw BigQuery type, and inclusion in the MetricType union and DrillDownRecord union.

CHANGES to src/types/drill-down.ts:

1. Update MetricType union:
   export type MetricType = 'initial-calls' | 'qualification-calls' | 'sqos' | 'open-sqls' | 'mqls' | 'sqls' | 'leads-sourced' | 'leads-contacted';

2. Add MQLDrillDownRecord interface:
   export interface MQLDrillDownRecord extends DrillDownRecordBase {
     mqlDate: string;
     initialCallDate: string | null;
   }

3. Add SQLDrillDownRecord interface:
   export interface SQLDrillDownRecord extends DrillDownRecordBase {
     sqlDate: string;
     qualificationCallDate: string | null;
   }

4. Add LeadsSourcedRecord interface (NOTE: does NOT extend DrillDownRecordBase — different fields from Lead table):
   export interface LeadsSourcedRecord {
     primaryKey: string;  // Lead Id — matches primary_key in vw_funnel_master (Full_prospect_id__c = Lead Id)
     leadId: string;
     advisorName: string;
     company: string;
     source: string;
     createdDate: string;
     isSelfSourced: boolean;
     leadUrl: string | null;
   }

5. Add LeadsContactedRecord interface:
   export interface LeadsContactedRecord {
     primaryKey: string;
     advisorName: string;
     source: string;
     channel: string;
     contactedDate: string;
     leadUrl: string | null;
   }
   NOTE: No isSelfSourced field — Final_Source__c is NOT available in vw_funnel_master. The self-sourced toggle on Leads Contacted only affects the COUNT, not the drill-down records.

6. Update DrillDownRecord union type to include all new types:
   export type DrillDownRecord = InitialCallRecord | QualificationCallRecord | SQODrillDownRecord | OpenSQLDrillDownRecord | MQLDrillDownRecord | SQLDrillDownRecord | LeadsSourcedRecord | LeadsContactedRecord;

7. Add Raw BigQuery types for each new record:
   export interface RawMQLDrillDownRecord {
     primary_key: string;
     advisor_name: string;
     mql_stage_entered_ts: { value: string } | string | null;
     Original_source: string;
     Channel_Grouping_Name: string | null;
     TOF_Stage: string;
     Initial_Call_Scheduled_Date__c: { value: string } | string | null;
     lead_url: string | null;
     opportunity_url: string | null;
     Next_Steps__c: string | null;
     NextStep: string | null;
   }

   export interface RawSQLDrillDownRecord {
     primary_key: string;
     advisor_name: string;
     converted_date_raw: string | { value: string } | null;
     Original_source: string;
     Channel_Grouping_Name: string | null;
     TOF_Stage: string;
     Qualification_Call_Date__c: { value: string } | string | null;
     lead_url: string | null;
     opportunity_url: string | null;
     Next_Steps__c: string | null;
     NextStep: string | null;
   }

   export interface RawLeadsSourcedRecord {
     Id: string;
     Name: string;
     Company: string | null;
     Final_Source__c: string;
     CreatedDate: { value: string } | string | null;
     SGA_Owner_Name__c: string;
   }

   export interface RawLeadsContactedRecord {
     primary_key: string;
     advisor_name: string;
     Original_source: string;
     Channel_Grouping_Name: string | null;
     stage_entered_contacting__c: { value: string } | string | null;
     lead_url: string | null;
   }
   // NOTE: Final_Source__c is NOT in vw_funnel_master. Self-sourced toggle only affects counts, not drill-down records.

Do NOT remove any existing types, interfaces, or type guards.
```

---

### Phase 1 Verification

**Claude Code Prompt:**
```
Run the following verification steps and report ALL results:

1. npx prisma generate
   — Confirm Prisma client regenerates without errors

2. Check that the WeeklyGoal model in prisma/schema.prisma has exactly 11 fields:
   id, userEmail, weekStartDate, initialCallsGoal, qualificationCallsGoal, sqoGoal, mqlGoal, sqlGoal, leadsSourcedGoal, leadsContactedGoal, createdAt, updatedAt, createdBy, updatedBy

3. grep -c "mqlGoal\|sqlGoal\|leadsSourcedGoal\|leadsContactedGoal" src/types/sga-hub.ts
   — Expect 12+ occurrences (across WeeklyGoal, WeeklyGoalInput, WeeklyGoalWithActuals)

4. grep -c "mqls\|sqls\|leads-sourced\|leads-contacted" src/types/drill-down.ts
   — Expect 8+ occurrences (MetricType union + record types)

5. Report the current TypeScript compilation status:
   npx tsc --noEmit 2>&1 | head -50
   — EXPECTED: Errors in implementation files (weekly-goals.ts, weekly-actuals.ts, etc.)
   — These are expected because we updated types but not implementations yet.
   — List the files with errors so we can verify they are ONLY the expected ones.

DO NOT fix any compilation errors. Just report them.
```

**🚫 DO NOT PROCEED to Phase 2 until human confirms:**
- [ ] Migration SQL has been run in Neon SQL Editor
- [ ] `npx prisma generate` succeeded
- [ ] Type errors are only in expected implementation files

---

## Phase 2: Backend — Query Functions

**Goal:** Update `weekly-goals.ts` to handle 7 goal fields in all CRUD operations. Expand `weekly-actuals.ts` to query 7 metrics (+ self-sourced variants) from BigQuery. Add 4 new drill-down query functions.

---

### Step 2.1: Update weekly-goals.ts — CRUD for 7 Fields

**Claude Code Prompt:**
```
MANDATORY FILE READS (in this order):
1. src/lib/queries/weekly-goals.ts (read ENTIRE file)
2. src/types/sga-hub.ts (read WeeklyGoal and WeeklyGoalInput interfaces)

CONTEXT:
The WeeklyGoal table now has 4 new fields: mqlGoal, sqlGoal, leadsSourcedGoal, leadsContactedGoal.
All CRUD operations must handle these fields. The existing 3 fields remain unchanged.

CHANGES to src/lib/queries/weekly-goals.ts:

1. upsertWeeklyGoal() — Add 4 new fields to both `create` and `update` in the Prisma upsert:
   create: { ...existing fields, mqlGoal: input.mqlGoal, sqlGoal: input.sqlGoal, leadsSourcedGoal: input.leadsSourcedGoal, leadsContactedGoal: input.leadsContactedGoal }
   update: { ...existing fields, mqlGoal: input.mqlGoal, sqlGoal: input.sqlGoal, leadsSourcedGoal: input.leadsSourcedGoal, leadsContactedGoal: input.leadsContactedGoal }

2. copyWeeklyGoal() — Copy all 7 fields from source to target:
   Add: mqlGoal: sourceGoal.mqlGoal, sqlGoal: sourceGoal.sqlGoal, leadsSourcedGoal: sourceGoal.leadsSourcedGoal, leadsContactedGoal: sourceGoal.leadsContactedGoal

3. transformWeeklyGoal() — Add 4 new fields to the returned object:
   mqlGoal: goal.mqlGoal,
   sqlGoal: goal.sqlGoal,
   leadsSourcedGoal: goal.leadsSourcedGoal,
   leadsContactedGoal: goal.leadsContactedGoal,

4. Update the negative value validation check (around line 68) to include new fields:
   The existing check validates initialCallsGoal, qualificationCallsGoal, sqoGoal >= 0.
   Add: mqlGoal, sqlGoal, leadsSourcedGoal, leadsContactedGoal to the same check.

Do NOT change getWeeklyGoals, getWeeklyGoalByWeek, getWeeklyGoalsByWeek, getAllSGAWeeklyGoals, deleteWeeklyGoal — these return full Prisma objects and only need the transformWeeklyGoal change.
Do NOT change any function signatures.
Do NOT add new functions.
```

---

### Step 2.2: Expand weekly-actuals.ts — 7 Metrics from BigQuery

**Claude Code Prompt:**
```
MANDATORY FILE READS (in this order):
1. src/lib/queries/weekly-actuals.ts (read ENTIRE file)
2. src/types/sga-hub.ts (read WeeklyActual interface)
3. src/config/constants.ts (read FULL_TABLE and RECRUITING_RECORD_TYPE constants)

CONTEXT:
The existing weekly-actuals.ts queries 3 metrics (initialCalls, qualificationCalls, sqos) from vw_funnel_master via BigQuery. We need to ADD 4 more metrics: MQLs, SQLs, Leads Sourced, Leads Contacted (+ self-sourced variants for the last two).

KEY PATTERNS (from existing code — follow exactly):
- All BigQuery queries wrapped in cachedQuery(fn, key, CACHE_TAGS.SGA_HUB)
- CTE pattern: each metric is its own CTE, joined via all_weeks
- DATE fields use direct comparison: `field >= @startDate`
- TIMESTAMP fields use wrapped comparison: `field >= TIMESTAMP(@startDate)`
- SQO queries use: `is_sqo_unique = 1 AND recordtypeid = @recruitingRecordType`
- SQO SGA resolution: LEFT JOIN User ON Opp_SGA_Name__c = sga_user.Id (existing pattern at lines 56-58)

CHANGES to src/lib/queries/weekly-actuals.ts:

1. Update RawWeeklyActualResult to include new fields:
   Add: mqls: number | null; sqls: number | null; leads_sourced: number | null; leads_sourced_self: number | null; leads_contacted: number | null; leads_contacted_self: number | null;

2. In _getWeeklyActuals (single SGA query), add 4 new CTEs to the existing query:

   ADD after the existing sqos CTE:

   mqls AS (
     SELECT
       DATE(DATE_TRUNC(mql_stage_entered_ts, WEEK(MONDAY))) as week_start,
       COUNT(*) as count
     FROM `${FULL_TABLE}`
     WHERE SGA_Owner_Name__c = @sgaName
       AND mql_stage_entered_ts IS NOT NULL
       AND mql_stage_entered_ts >= TIMESTAMP(@startDate)
       AND mql_stage_entered_ts <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
     GROUP BY week_start
   ),
   sqls AS (
     SELECT
       DATE_TRUNC(converted_date_raw, WEEK(MONDAY)) as week_start,
       COUNT(*) as count
     FROM `${FULL_TABLE}`
     WHERE SGA_Owner_Name__c = @sgaName
       AND converted_date_raw IS NOT NULL
       AND converted_date_raw >= @startDate
       AND converted_date_raw <= @endDate
       AND is_sql = 1
     GROUP BY week_start
   ),
   leads_sourced AS (
     SELECT
       DATE(DATE_TRUNC(l.CreatedDate, WEEK(MONDAY))) as week_start,
       COUNT(*) as total,
       COUNTIF(l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')) as self_sourced
     FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
     WHERE l.SGA_Owner_Name__c = @sgaName
       AND l.CreatedDate >= TIMESTAMP(@startDate)
       AND l.CreatedDate <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
     GROUP BY week_start
   ),
   leads_contacted AS (
     SELECT
       DATE(DATE_TRUNC(stage_entered_contacting__c, WEEK(MONDAY))) as week_start,
       COUNT(*) as total
     FROM `${FULL_TABLE}`
     WHERE SGA_Owner_Name__c = @sgaName
       AND stage_entered_contacting__c IS NOT NULL
       AND stage_entered_contacting__c >= TIMESTAMP(@startDate)
       AND stage_entered_contacting__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
     GROUP BY week_start
   ),
   leads_contacted_self AS (
     SELECT
       DATE(DATE_TRUNC(l.Stage_Entered_Contacting__c, WEEK(MONDAY))) as week_start,
       COUNT(*) as self_sourced
     FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
     WHERE l.SGA_Owner_Name__c = @sgaName
       AND l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
       AND l.Stage_Entered_Contacting__c IS NOT NULL
       AND l.Stage_Entered_Contacting__c >= TIMESTAMP(@startDate)
       AND l.Stage_Entered_Contacting__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
     GROUP BY week_start
   )

3. Update the final SELECT to join all new CTEs:
   LEFT JOIN mqls m ON aw.week_start = m.week_start
   LEFT JOIN sqls sq2 ON aw.week_start = sq2.week_start
   LEFT JOIN leads_sourced ls ON aw.week_start = ls.week_start
   LEFT JOIN leads_contacted lc ON aw.week_start = lc.week_start
   LEFT JOIN leads_contacted_self lcs ON aw.week_start = lcs.week_start

   Add to SELECT:
   COALESCE(m.count, 0) as mqls,
   COALESCE(sq2.count, 0) as sqls,
   COALESCE(ls.total, 0) as leads_sourced,
   COALESCE(ls.self_sourced, 0) as leads_sourced_self,
   COALESCE(lc.total, 0) as leads_contacted,
   COALESCE(lcs.self_sourced, 0) as leads_contacted_self

4. Update transformWeeklyActual() to include new fields:
   mqls: toNumber(row.mqls) || 0,
   sqls: toNumber(row.sqls) || 0,
   leadsSourced: toNumber(row.leads_sourced) || 0,
   leadsSourcedSelfSourced: toNumber(row.leads_sourced_self) || 0,
   leadsContacted: toNumber(row.leads_contacted) || 0,
   leadsContactedSelfSourced: toNumber(row.leads_contacted_self) || 0,

5. Apply the SAME CTE additions to _getAllSGAWeeklyActuals (admin view).
   Follow the same pattern but:
   - Use SGA_Owner_Name__c as sga_name grouping (no @sgaName filter)
   - Add GROUP BY sga_name, week_start to all new CTEs
   - Join on both s.sga_name = [cte].sga_name AND aw.week_start = [cte].week_start
   - IMPORTANT: The leads_sourced and leads_contacted_self CTEs in the admin version MUST include the User table JOIN (`JOIN savvy-gtm-analytics.SavvyGTMData.User u ON l.SGA_Owner_Name__c = u.Name AND u.IsSGA__c = TRUE`) to filter to active SGAs only and exclude "Savvy Operations"/"Savvy Marketing" records. The single-SGA version doesn't need this because it's already filtered by @sgaName.

CRITICAL: Do NOT rename the existing CTE aliases. The existing `sqos` CTE stays as `sqos`. The new CTEs are named `mqls`, `sqls`, `leads_sourced`, `leads_contacted`, `leads_contacted_self` — these do NOT collide with anything existing.

The JOIN aliases used in item 3 above match these CTE names:
- `mqls m` — MQL CTE aliased as m
- `sqls sq2` — SQL CTE aliased as sq2
- `leads_sourced ls` — Leads Sourced CTE aliased as ls
- `leads_contacted lc` — Leads Contacted CTE aliased as lc
- `leads_contacted_self lcs` — Leads Contacted Self-Sourced CTE aliased as lcs
```

---

### Step 2.3: Add 4 New Drill-Down Query Functions

**Claude Code Prompt:**
```
MANDATORY FILE READS (in this order):
1. src/lib/queries/drill-down.ts (read ENTIRE file — pay attention to existing patterns)
2. src/types/drill-down.ts (read new types we added: MQLDrillDownRecord, SQLDrillDownRecord, LeadsSourcedRecord, LeadsContactedRecord + their Raw types)
3. src/config/constants.ts (read FULL_TABLE constant)

CONTEXT:
We need 4 new drill-down query functions that follow the EXACT same pattern as the existing getInitialCallsDrillDown. Each must:
- Be an internal function prefixed with _
- Be exported via cachedQuery wrapper
- Use the same FULL_TABLE constant and channel mapping LEFT JOIN
- Use extractDateValue for date parsing
- Follow existing transform patterns

ADD to src/lib/queries/drill-down.ts (append at end, before any closing exports):

FUNCTION 1: getMQLDrillDown
Query from vw_funnel_master (FULL_TABLE):
SELECT fields: primary_key, advisor_name, mql_stage_entered_ts, Original_source, COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as Channel_Grouping_Name, TOF_Stage, Initial_Call_Scheduled_Date__c, lead_url, opportunity_url, Next_Steps__c, NextStep
WHERE: SGA_Owner_Name__c = @sgaName AND mql_stage_entered_ts IS NOT NULL AND mql_stage_entered_ts >= TIMESTAMP(@weekStartDate) AND mql_stage_entered_ts <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
ORDER BY: mql_stage_entered_ts DESC
LEFT JOIN MAPPING_TABLE on Original_source

Transform to MQLDrillDownRecord:
  primaryKey: raw.primary_key
  advisorName: toString(raw.advisor_name)
  source: toString(raw.Original_source)
  channel: toString(raw.Channel_Grouping_Name) || 'Other'
  tofStage: toString(raw.TOF_Stage) || 'Unknown'
  mqlDate: extractDateValue(raw.mql_stage_entered_ts) || ''
  initialCallDate: extractDateValue(raw.Initial_Call_Scheduled_Date__c)
  leadUrl: raw.lead_url
  opportunityUrl: raw.opportunity_url
  nextSteps: raw.Next_Steps__c
  opportunityNextStep: raw.NextStep
  daysInCurrentStage: null (not applicable for MQL drill-down)

FUNCTION 2: getSQLDrillDown
Query from FULL_TABLE:
SELECT fields: primary_key, advisor_name, converted_date_raw, Original_source, COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other'), TOF_Stage, Qualification_Call_Date__c, lead_url, opportunity_url, Next_Steps__c, NextStep
WHERE: SGA_Owner_Name__c = @sgaName AND converted_date_raw IS NOT NULL AND converted_date_raw >= @weekStartDate AND converted_date_raw <= @weekEndDate AND is_sql = 1
ORDER BY: converted_date_raw DESC

NOTE: converted_date_raw is a DATE field — use direct comparison, NOT TIMESTAMP().

Transform to SQLDrillDownRecord:
  primaryKey: raw.primary_key
  advisorName: toString(raw.advisor_name)
  source: toString(raw.Original_source)
  channel: toString(raw.Channel_Grouping_Name) || 'Other'
  tofStage: toString(raw.TOF_Stage) || 'Unknown'
  sqlDate: extractDateValue(raw.converted_date_raw) || ''
  qualificationCallDate: extractDateValue(raw.Qualification_Call_Date__c)
  leadUrl: raw.lead_url
  opportunityUrl: raw.opportunity_url
  nextSteps: raw.Next_Steps__c
  opportunityNextStep: raw.NextStep
  daysInCurrentStage: null

FUNCTION 3: getLeadsSourcedDrillDown
Parameters: sgaName: string, weekStartDate: string, weekEndDate: string, selfSourcedOnly?: boolean

Query directly from SavvyGTMData.Lead table (NOT FULL_TABLE):
SELECT: l.Id, l.Name, l.Company, l.Final_Source__c, l.CreatedDate, l.SGA_Owner_Name__c
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
WHERE l.SGA_Owner_Name__c = @sgaName
  AND l.CreatedDate >= TIMESTAMP(@weekStartDate)
  AND l.CreatedDate <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
  ${selfSourcedOnly ? "AND l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')" : ''}
ORDER BY l.CreatedDate DESC

NOTE: The selfSourcedOnly filter is added via conditional string append (not a BigQuery param) since it's a static clause toggle, not a user-supplied value. This is safe — no injection risk.

Transform to LeadsSourcedRecord:
  primaryKey: raw.Id  // Lead Id = primary_key in vw_funnel_master — enables RecordDetailModal
  leadId: raw.Id
  advisorName: toString(raw.Name)
  company: toString(raw.Company) || ''
  source: toString(raw.Final_Source__c)
  createdDate: extractDateValue(raw.CreatedDate) || ''
  isSelfSourced: ['Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)'].includes(raw.Final_Source__c)
  leadUrl: `https://savvywealth.lightning.force.com/lightning/r/Lead/${raw.Id}/view`

FUNCTION 4: getLeadsContactedDrillDown
Parameters: sgaName: string, weekStartDate: string, weekEndDate: string, selfSourcedOnly?: boolean

This function has TWO query paths based on selfSourcedOnly:

PATH A — selfSourcedOnly is false/undefined (default):
Query from FULL_TABLE (vw_funnel_master):
SELECT: v.primary_key, v.advisor_name, v.Original_source, COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as Channel_Grouping_Name, v.stage_entered_contacting__c, v.lead_url
FROM FULL_TABLE v
LEFT JOIN MAPPING_TABLE nm ON v.Original_source = nm.original_source
WHERE v.SGA_Owner_Name__c = @sgaName
  AND v.stage_entered_contacting__c IS NOT NULL
  AND v.stage_entered_contacting__c >= TIMESTAMP(@weekStartDate)
  AND v.stage_entered_contacting__c <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
ORDER BY v.stage_entered_contacting__c DESC

PATH B — selfSourcedOnly is true:
Query from Lead table directly (Final_Source__c is NOT in vw_funnel_master):
SELECT l.Id as primary_key, l.Name as advisor_name,
  l.Final_Source__c as Original_source,
  l.Stage_Entered_Contacting__c as stage_entered_contacting__c,
  l.SGA_Owner_Name__c
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
WHERE l.SGA_Owner_Name__c = @sgaName
  AND l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND l.Stage_Entered_Contacting__c IS NOT NULL
  AND l.Stage_Entered_Contacting__c >= TIMESTAMP(@weekStartDate)
  AND l.Stage_Entered_Contacting__c <= TIMESTAMP(CONCAT(@weekEndDate, ' 23:59:59'))
ORDER BY l.Stage_Entered_Contacting__c DESC

NOTE: Path B has no channel mapping JOIN — Lead table doesn't have Channel_Grouping_Name. Set channel to the Final_Source__c value instead (more useful in self-sourced context).
NOTE: Path B returns l.Id as primary_key — Lead Id = primary_key in vw_funnel_master, so RecordDetailModal still works.
NOTE: Path B has no lead_url column — construct it in the transform: `https://savvywealth.lightning.force.com/lightning/r/Lead/${raw.primary_key}/view`

Implementation pattern:
  const query = selfSourcedOnly ? selfSourcedQuery : defaultQuery;
  const results = await runQuery<RawLeadsContactedRecord>(query, params);

Transform to LeadsContactedRecord (same for both paths):
  primaryKey: raw.primary_key
  advisorName: toString(raw.advisor_name)
  source: toString(raw.Original_source)
  channel: toString(raw.Channel_Grouping_Name) || toString(raw.Original_source) || 'Other'
  contactedDate: extractDateValue(raw.stage_entered_contacting__c) || ''
  leadUrl: raw.lead_url || `https://savvywealth.lightning.force.com/lightning/r/Lead/${raw.primary_key}/view`

IMPORTANT: Wrap each export in cachedQuery:
export const getMQLDrillDown = cachedQuery(_getMQLDrillDown, 'getMQLDrillDown', CACHE_TAGS.DASHBOARD);
export const getSQLDrillDown = cachedQuery(_getSQLDrillDown, 'getSQLDrillDown', CACHE_TAGS.DASHBOARD);
export const getLeadsSourcedDrillDown = cachedQuery(_getLeadsSourcedDrillDown, 'getLeadsSourcedDrillDown', CACHE_TAGS.DASHBOARD);
export const getLeadsContactedDrillDown = cachedQuery(_getLeadsContactedDrillDown, 'getLeadsContactedDrillDown', CACHE_TAGS.DASHBOARD);

NOTE: The existing getSQODrillDown already exists. We keep it. The SQO drill-down for this feature will reuse the existing function.
```

---

### Phase 2 Verification

**Claude Code Prompt:**
```
Run ALL of the following verification steps and report results:

1. npx tsc --noEmit 2>&1 | head -80
   — Report remaining TypeScript errors. Errors should now be ONLY in:
     - API routes (weekly-goals/route.ts, weekly-actuals/route.ts)
     - Components (WeeklyGoalsTable, WeeklyGoalEditor, SGAHubContent, etc.)
     - CSV export (sga-hub-csv-export.ts)
     - api-client.ts
   — If there are errors in weekly-goals.ts, weekly-actuals.ts, or drill-down.ts, those are bugs — fix them.

2. grep -n "cachedQuery" src/lib/queries/weekly-actuals.ts
   — Confirm both getWeeklyActuals and getAllSGAWeeklyActuals are wrapped

3. grep -n "cachedQuery" src/lib/queries/drill-down.ts | tail -10
   — Confirm 4 new drill-down functions are wrapped

4. grep -c "mqls\|sqls\|leads_sourced\|leads_contacted" src/lib/queries/weekly-actuals.ts
   — Expect 8+ occurrences (CTE definitions + JOIN references)

5. grep -c "mqlGoal\|sqlGoal\|leadsSourcedGoal\|leadsContactedGoal" src/lib/queries/weekly-goals.ts
   — Expect 12+ (across upsert create/update + copy + transform)

Report all results. If any errors exist in the query files, fix them before reporting.
```

**🚫 DO NOT PROCEED to Phase 3 until human confirms Phase 2 verification passes.**

---

## Phase 3: Backend — API Routes

**Goal:** Update existing API routes to handle 7 goal fields and expanded actuals. Create 4 new drill-down API routes.

---

### Step 3.1: Update weekly-goals API Route

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/app/api/sga-hub/weekly-goals/route.ts (read ENTIRE file)

CONTEXT:
The POST handler currently validates and accepts 3 goal fields. We need it to accept 7.
The GET handler returns goals — no changes needed since transformWeeklyGoal already includes new fields.

CHANGES to src/app/api/sga-hub/weekly-goals/route.ts:

1. In the POST handler, update the input validation to accept 7 fields:
   const { weekStartDate, initialCallsGoal, qualificationCallsGoal, sqoGoal, mqlGoal, sqlGoal, leadsSourcedGoal, leadsContactedGoal } = body;

2. Update the input object passed to upsertWeeklyGoal:
   {
     weekStartDate,
     initialCallsGoal: initialCallsGoal ?? 0,
     qualificationCallsGoal: qualificationCallsGoal ?? 0,
     sqoGoal: sqoGoal ?? 0,
     mqlGoal: mqlGoal ?? 0,
     sqlGoal: sqlGoal ?? 0,
     leadsSourcedGoal: leadsSourcedGoal ?? 0,
     leadsContactedGoal: leadsContactedGoal ?? 0,
   }

Do NOT change the GET handler.
Do NOT change authentication, authorization, or error handling logic.
Do NOT change the SGA editability check.
```

---

### Step 3.2: Update weekly-actuals API Route

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/app/api/sga-hub/weekly-actuals/route.ts (read ENTIRE file)

CONTEXT:
The response shape changes because WeeklyActual now has 9 fields instead of 3.
The query functions already return the expanded shape — the API route just needs to pass it through.

VERIFY: The route already returns `{ actuals }` from getWeeklyActuals / getAllSGAWeeklyActuals.
If the functions already return the correct type, NO changes are needed to this file.

Check if there are any explicit field selections or transformations in the route that would filter out new fields. If not, confirm "No changes needed — route passes through full actuals object."

If there ARE transformations, update them to include all 9 fields.
```

---

### Step 3.3: Create 4 New Drill-Down API Routes

**Claude Code Prompt:**
```
MANDATORY FILE READS (in this order):
1. src/app/api/sga-hub/drill-down/initial-calls/route.ts (read as the TEMPLATE pattern)
2. src/lib/queries/drill-down.ts (read the new function signatures)

CONTEXT:
Create 4 new API routes following the EXACT same pattern as initial-calls/route.ts.
Each route: GET handler, session auth, role check, optional userEmail param, Prisma user lookup, call query function.

CREATE these 4 files:

FILE 1: src/app/api/sga-hub/drill-down/mqls/route.ts
- Import getMQLDrillDown from '@/lib/queries/drill-down'
- Same auth/role pattern as initial-calls
- Parameters: userEmail (optional), weekStartDate (required), weekEndDate (required)
- Calls getMQLDrillDown(user.name, weekStartDate, weekEndDate)
- Returns { records }

FILE 2: src/app/api/sga-hub/drill-down/sqls/route.ts
- Import getSQLDrillDown from '@/lib/queries/drill-down'
- Same pattern
- Calls getSQLDrillDown(user.name, weekStartDate, weekEndDate)

FILE 3: src/app/api/sga-hub/drill-down/leads-sourced/route.ts
- Import getLeadsSourcedDrillDown from '@/lib/queries/drill-down'
- Same auth/role pattern as initial-calls
- Parameters: userEmail (optional), weekStartDate (required), weekEndDate (required), selfSourcedOnly (optional)
- Parse selfSourcedOnly: `const selfSourcedOnly = searchParams.get('selfSourcedOnly') === 'true';`
- Calls getLeadsSourcedDrillDown(user.name, weekStartDate, weekEndDate, selfSourcedOnly)

FILE 4: src/app/api/sga-hub/drill-down/leads-contacted/route.ts
- Import getLeadsContactedDrillDown from '@/lib/queries/drill-down'
- Same auth/role pattern as initial-calls
- Parameters: userEmail (optional), weekStartDate (required), weekEndDate (required), selfSourcedOnly (optional)
- Parse selfSourcedOnly: `const selfSourcedOnly = searchParams.get('selfSourcedOnly') === 'true';`
- Calls getLeadsContactedDrillDown(user.name, weekStartDate, weekEndDate, selfSourcedOnly)

CRITICAL:
- Each file must have `export const dynamic = 'force-dynamic';` at the top
- Role check: ['admin', 'manager', 'sga', 'sgm', 'revops_admin']
- Use getSessionPermissions(session) NOT getUserPermissions
- Error handling: try/catch with 500 response
```

---

### Step 3.4: Update API Client (api-client.ts)

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/lib/api-client.ts (read lines 490-713 — the SGA Hub section)

CONTEXT:
Add 4 new drill-down API client functions following the exact pattern of getInitialCallsDrillDown.

ADD to src/lib/api-client.ts (in the dashboardApi object, near the existing drill-down methods):

getMQLDrillDown: (sgaName: string, weekStartDate: string, weekEndDate: string, userEmail?: string) => {
  const params = new URLSearchParams({ weekStartDate, weekEndDate });
  if (userEmail) params.append('userEmail', userEmail);
  return apiFetch<{ records: MQLDrillDownRecord[] }>(`/api/sga-hub/drill-down/mqls?${params}`);
},

getSQLDrillDown: (sgaName: string, weekStartDate: string, weekEndDate: string, userEmail?: string) => {
  const params = new URLSearchParams({ weekStartDate, weekEndDate });
  if (userEmail) params.append('userEmail', userEmail);
  return apiFetch<{ records: SQLDrillDownRecord[] }>(`/api/sga-hub/drill-down/sqls?${params}`);
},

getLeadsSourcedDrillDown: (sgaName: string, weekStartDate: string, weekEndDate: string, selfSourcedOnly?: boolean, userEmail?: string) => {
  const params = new URLSearchParams({ weekStartDate, weekEndDate });
  if (selfSourcedOnly) params.append('selfSourcedOnly', 'true');
  if (userEmail) params.append('userEmail', userEmail);
  return apiFetch<{ records: LeadsSourcedRecord[] }>(`/api/sga-hub/drill-down/leads-sourced?${params}`);
},

getLeadsContactedDrillDown: (sgaName: string, weekStartDate: string, weekEndDate: string, selfSourcedOnly?: boolean, userEmail?: string) => {
  const params = new URLSearchParams({ weekStartDate, weekEndDate });
  if (selfSourcedOnly) params.append('selfSourcedOnly', 'true');
  if (userEmail) params.append('userEmail', userEmail);
  return apiFetch<{ records: LeadsContactedRecord[] }>(`/api/sga-hub/drill-down/leads-contacted?${params}`);
},

ALSO: Add imports at the top of the file for the new types:
import { MQLDrillDownRecord, SQLDrillDownRecord, LeadsSourcedRecord, LeadsContactedRecord } from '@/types/drill-down';
```

---

### Phase 3 Verification

**Claude Code Prompt:**
```
Run ALL verification steps and report results:

1. npx tsc --noEmit 2>&1 | head -80
   — Errors should now be ONLY in frontend component files.
   — If there are errors in API routes or api-client.ts, fix them.

2. Verify all 4 new API routes exist:
   ls -la src/app/api/sga-hub/drill-down/mqls/route.ts
   ls -la src/app/api/sga-hub/drill-down/sqls/route.ts
   ls -la src/app/api/sga-hub/drill-down/leads-sourced/route.ts
   ls -la src/app/api/sga-hub/drill-down/leads-contacted/route.ts

3. grep -n "dynamic.*force-dynamic" src/app/api/sga-hub/drill-down/mqls/route.ts
   — Confirm force-dynamic is set

4. grep -n "getSessionPermissions" src/app/api/sga-hub/drill-down/mqls/route.ts
   — Confirm using session permissions (not getUserPermissions)

5. grep -c "getMQLDrillDown\|getSQLDrillDown\|getLeadsSourcedDrillDown\|getLeadsContactedDrillDown" src/lib/api-client.ts
   — Expect 4 occurrences

6. Run: npx eslint src/app/api/sga-hub/drill-down/ --ext .ts 2>&1 | tail -20
   — Report any linting errors

Report all results.
```

**🚫 DO NOT PROCEED to Phase 4 until human confirms Phase 3 verification passes.**

---

## Phase 4: Frontend — Core Components

**Goal:** Create the new "Goals vs. Actuals" tab UI with 3 week sections, 7 metric scorecards per section, editable goals, clickable drilldown values, and the self-sourced toggle on Leads Contacted.

---

### Step 4.1: Create MetricScorecard Component

**Claude Code Prompt:**
```
MANDATORY FILE READS:
1. src/components/sga-hub/ClickableMetricValue.tsx (existing reusable component)
2. src/components/sga-hub/WeeklyGoalsTable.tsx (existing table — see how goals vs actuals are displayed)
3. src/types/sga-hub.ts (WeeklyGoalWithActuals type)

CONTEXT:
Create a reusable MetricScorecard component that shows a single metric's goal vs actual, with:
- Metric label (e.g., "MQLs")
- Goal value (editable or locked depending on the week section)
- Actual value (clickable for drilldown — use ClickableMetricValue)
- Diff indicator (green if actual >= goal, red if behind)
- Optional toggle for "All" / "Self-Sourced" (only on Leads Contacted and Leads Sourced)

CREATE: src/components/sga-hub/MetricScorecard.tsx

Props:
  label: string
  goalValue: number | null
  actualValue: number
  secondaryActualValue?: number  // for self-sourced toggle
  isEditable: boolean
  onGoalChange?: (value: number) => void
  onActualClick?: () => void
  showToggle?: boolean
  toggleLabel?: [string, string]  // e.g., ['All', 'Self-Sourced']
  toggleValue?: 'all' | 'self-sourced'
  onToggleChange?: (value: 'all' | 'self-sourced') => void

DESIGN:
- Use Tremor Card component
- Goal input: type="text" with inputMode="numeric" (NOT type="number" — per .cursorrules)
- When not editable, show goal as plain text
- Actual: wrap in ClickableMetricValue when onActualClick is provided
- Diff: show as "+N" (green/tremor-green) or "-N" (red/tremor-red) badge
- When goalValue is null, show "No goal set" in muted text
- Toggle: small segmented control above the actual value (only when showToggle=true)
- Use dark mode pattern: useTheme() from next-themes, resolvedTheme === 'dark'
- Use Tailwind utility classes only (no custom CSS)

KEEP IT SIMPLE. This is a card with a label, a goal number, an actual number, and a diff.
```

---

### Step 4.2: Create WeekSection Component

**Claude Code Prompt:**
```
MANDATORY FILE READS:
1. src/components/sga-hub/MetricScorecard.tsx (just created)
2. src/types/sga-hub.ts (WeeklyGoalWithActuals)

CREATE: src/components/sga-hub/WeekSection.tsx

CONTEXT:
A single week section (Last Week, This Week, or Next Week) that shows 7 MetricScorecard components in a responsive grid.

Props:
  title: string  // "Last Week", "This Week", "Next Week"
  dateRange: string  // e.g., "Mar 2 - Mar 8, 2026"
  weekData: WeeklyGoalWithActuals | null
  isEditable: boolean
  onGoalChange: (field: string, value: number) => void
  onMetricClick: (metricType: MetricType, options?: { selfSourcedOnly?: boolean }) => void
  leadsContactedToggle: 'all' | 'self-sourced'
  onLeadsContactedToggleChange: (value: 'all' | 'self-sourced') => void
  leadsSourcedToggle: 'all' | 'self-sourced'
  onLeadsSourcedToggleChange: (value: 'all' | 'self-sourced') => void

CLICK HANDLER:
When a user clicks a Leads Sourced or Leads Contacted actual, pass the current toggle state:
- Leads Sourced:  onMetricClick('leads-sourced', { selfSourcedOnly: leadsSourcedToggle === 'self-sourced' })
- Leads Contacted: onMetricClick('leads-contacted', { selfSourcedOnly: leadsContactedToggle === 'self-sourced' })
- All other metrics: onMetricClick(metricType) — no options needed

LAYOUT:
- Title + date range as header
- 7 MetricScorecard cards in a responsive grid:
  Row 1 (Pipeline): MQL, SQL, SQO — 3 columns
  Row 2 (Calls): Initial Calls, Qualification Calls — 2 columns
  Row 3 (Lead Activity): Leads Sourced, Leads Contacted — 2 columns
- Grid: grid-cols-2 md:grid-cols-3 gap-4

METRIC MAPPING (field name → label):
  mql → "MQLs"
  sql → "SQLs"
  sqo → "SQOs"
  initialCalls → "Initial Calls"
  qualificationCalls → "Qualification Calls"
  leadsSourced → "Leads Sourced"
  leadsContacted → "Leads Contacted"

For Next Week section: MQL, SQL, SQO only show goals (no actuals).
Initial Calls and Qualification Calls show goals + scheduled actuals.
Leads Sourced and Leads Contacted show goals only (no actuals).

Use the weekData object to determine what to display:
- If weekData is null, show "No data" state
- Pass isEditable to each MetricScorecard
- Leads Sourced gets toggle for All/Self-Sourced (showing leadsSourcedActual or leadsSourcedSelfSourcedActual)
- Leads Contacted gets toggle for All/Self-Sourced (showing leadsContactedActual or leadsContactedSelfSourcedActual)
```

---

### Step 4.3: Create Main WeeklyGoalsVsActuals Container

**Claude Code Prompt:**
```
MANDATORY FILE READS:
1. src/components/sga-hub/WeekSection.tsx (just created)
2. src/lib/utils/sga-hub-helpers.ts (getWeekMondayDate, formatWeekRange, getWeekInfo)
3. src/app/dashboard/sga-hub/SGAHubContent.tsx (read the existing fetchWeeklyData and goals/actuals merge logic)

CREATE: src/components/sga-hub/WeeklyGoalsVsActuals.tsx

CONTEXT:
This is the main container component for the "Goals vs. Actuals" tab. It replaces the content currently shown for the "Weekly Goals" tab.

It manages:
1. Three WeekSection components (Last Week, This Week, Next Week)
2. Goal editing state and save handlers
3. Drilldown click handlers (delegates to parent via callback)
4. Toggle states for Leads Contacted / Leads Sourced

Props:
  weeklyGoals: WeeklyGoal[]
  weeklyActuals: WeeklyActual[]
  isAdmin: boolean
  sgaName: string
  userEmail: string
  onGoalSaved: () => void  // callback to refetch data after save
  onMetricClick: (weekStartDate: string, metricType: MetricType, options?: { selfSourcedOnly?: boolean }) => void

INTERNAL STATE:
  leadsContactedToggle: 'all' | 'self-sourced' (default: 'all')
  leadsSourcedToggle: 'all' | 'self-sourced' (default: 'all')
  savingGoal: boolean
  saveError: string | null

WEEK CALCULATION:
  Use getWeekMondayDate(new Date()) to get current Monday.
  lastWeekMonday = currentMonday - 7 days
  nextWeekMonday = currentMonday + 7 days

  For each week, find matching goal and actual from the arrays:
  - goal = weeklyGoals.find(g => g.weekStartDate === mondayISO)
  - actual = weeklyActuals.find(a => a.weekStartDate === mondayISO) || defaults

  Merge into WeeklyGoalWithActuals objects (same merge logic as existing SGAHubContent fetchWeeklyData).

EDITABILITY:
  - Last Week: never editable (isEditable=false)
  - This Week: editable for SGAs and admins (isEditable=true)
  - Next Week: editable for SGAs and admins (isEditable=true)

GOAL SAVE:
  When a goal field changes, debounce 500ms, then call:
  dashboardApi.saveWeeklyGoal(userEmail, goalInput)
  — Use the existing POST /api/sga-hub/weekly-goals endpoint
  — On success, call onGoalSaved()

LAYOUT:
  Three WeekSection components stacked vertically with gap-6.
  Order: This Week (top), Last Week (middle), Next Week (bottom).
  Actually — order: Last Week, This Week, Next Week (chronological, matching spec).
```

---

### Step 4.4: Update MetricDrillDownModal for New Types

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/components/sga-hub/MetricDrillDownModal.tsx (read ENTIRE file)

CONTEXT:
Add column configurations and type guards for the 4 new metric types.

CHANGES to src/components/sga-hub/MetricDrillDownModal.tsx:

1. Add imports for new types:
   import { MQLDrillDownRecord, SQLDrillDownRecord, LeadsSourcedRecord, LeadsContactedRecord } from '@/types/drill-down';

2. Add type guards:
   function isMQLDrillDownRecord(record: DrillDownRecord): record is MQLDrillDownRecord {
     return 'mqlDate' in record;
   }
   function isSQLDrillDownRecord(record: DrillDownRecord): record is SQLDrillDownRecord {
     return 'sqlDate' in record;
   }
   function isLeadsSourcedRecord(record: DrillDownRecord): record is LeadsSourcedRecord {
     return 'leadId' in record && 'createdDate' in record;
   }
   function isLeadsContactedRecord(record: DrillDownRecord): record is LeadsContactedRecord {
     return 'contactedDate' in record;
   }

3. Add column configs to COLUMN_CONFIGS:

   'mqls': [
     { key: 'advisorName', label: 'Advisor Name', width: 'w-48' },
     { key: 'mqlDate', label: 'MQL Date', width: 'w-32' },
     { key: 'source', label: 'Source', width: 'w-32' },
     { key: 'channel', label: 'Channel', width: 'w-32' },
     { key: 'initialCallDate', label: 'Initial Call Date', width: 'w-32' },
     { key: 'actions', label: '', width: 'w-20' },
   ],
   'sqls': [
     { key: 'advisorName', label: 'Advisor Name', width: 'w-48' },
     { key: 'sqlDate', label: 'SQL Date', width: 'w-32' },
     { key: 'source', label: 'Source', width: 'w-32' },
     { key: 'channel', label: 'Channel', width: 'w-32' },
     { key: 'qualificationCallDate', label: 'Qual Call Date', width: 'w-32' },
     { key: 'actions', label: '', width: 'w-20' },
   ],
   'leads-sourced': [
     { key: 'advisorName', label: 'Advisor Name', width: 'w-48' },
     { key: 'company', label: 'Company', width: 'w-40' },
     { key: 'createdDate', label: 'Created Date', width: 'w-32' },
     { key: 'source', label: 'Source', width: 'w-32' },
     { key: 'isSelfSourced', label: 'Self-Sourced', width: 'w-24' },
     { key: 'actions', label: '', width: 'w-20' },
   ],
   'leads-contacted': [
     { key: 'advisorName', label: 'Advisor Name', width: 'w-48' },
     { key: 'contactedDate', label: 'Contacted Date', width: 'w-32' },
     { key: 'source', label: 'Source', width: 'w-32' },
     { key: 'channel', label: 'Channel', width: 'w-32' },
     { key: 'actions', label: '', width: 'w-20' },
   ],

4. Update the table body rendering to handle new record types.
   Add cell rendering branches for each new type in the table body map function.
   For isSelfSourced: show "Yes" (green badge) or "No".
   For date fields: use formatDate() helper.
   For actions: show Salesforce link icon (ExternalLink) pointing to leadUrl or opportunityUrl.

5. Update the CSV export column mapping in the export handler to include branches for new metric types.
```

---

### Step 4.5: Update WeeklyGoalEditor for 7 Goals

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/components/sga-hub/WeeklyGoalEditor.tsx (read ENTIRE file)

CONTEXT:
The goal editor modal currently has 3 inputs. Expand to 7.

CHANGES:
1. Add state for 4 new fields:
   const [mqlGoal, setMqlGoal] = useState<number>(0);
   const [sqlGoal, setSqlGoal] = useState<number>(0);
   const [leadsSourcedGoal, setLeadsSourcedGoal] = useState<number>(0);
   const [leadsContactedGoal, setLeadsContactedGoal] = useState<number>(0);

2. In useEffect that populates from existing goal:
   Add: setMqlGoal(existingGoal.mqlGoal || 0), etc.

3. In form submission:
   Include all 7 fields in the POST body:
   { weekStartDate, initialCallsGoal, qualificationCallsGoal, sqoGoal, mqlGoal, sqlGoal, leadsSourcedGoal, leadsContactedGoal }

4. In the form JSX, add 4 new inputs BEFORE the existing 3:
   Group 1 (Pipeline): MQL Goal, SQL Goal, SQO Goal
   Group 2 (Calls): Initial Calls Goal, Qualification Calls Goal
   Group 3 (Lead Activity): Leads Sourced Goal, Leads Contacted Goal

   Each input: type="text" inputMode="numeric" (NOT type="number")

5. IMPORTANT: If this component uses direct fetch() instead of dashboardApi, migrate it to use dashboardApi. Check the exploration notes — this was flagged as inconsistent.

Do NOT change the modal open/close logic.
Do NOT change the week selection logic.
```

---

### Phase 4 Verification

**Claude Code Prompt:**
```
Run ALL verification steps:

1. npx tsc --noEmit 2>&1 | head -80
   — Report remaining errors. At this point, errors should be limited to:
     - SGAHubContent.tsx (needs wiring — Phase 6)
     - IndividualGoalEditor.tsx and BulkGoalEditor.tsx (need 7 fields — address now)
     - sga-hub-csv-export.ts (needs update — Phase 7)
   — Fix any errors in the files we modified in Phase 4.

2. Verify new component files exist:
   ls -la src/components/sga-hub/MetricScorecard.tsx
   ls -la src/components/sga-hub/WeekSection.tsx
   ls -la src/components/sga-hub/WeeklyGoalsVsActuals.tsx

3. grep -c "MetricType" src/components/sga-hub/MetricDrillDownModal.tsx
   — Confirm MetricType usage covers new types

4. grep -c "'mqls'\|'sqls'\|'leads-sourced'\|'leads-contacted'" src/components/sga-hub/MetricDrillDownModal.tsx
   — Expect 4+ occurrences in COLUMN_CONFIGS

5. grep -n "dashboardApi\|fetch(" src/components/sga-hub/WeeklyGoalEditor.tsx
   — Confirm it uses dashboardApi (not direct fetch)

Report all results.
```

**🚫 DO NOT PROCEED to Phase 5 until human confirms Phase 4 verification passes.**

**HUMAN: Test the following in the UI before proceeding:**
- [ ] Navigate to SGA Hub — no console errors on page load
- [ ] The app compiles and loads (even though tab content may not be wired yet)

---

## Phase 5: Frontend — Charts (Goals vs. Actuals Over Time)

**Goal:** Create 3 line charts showing goals vs. actuals over time with toggleable metrics and customizable date ranges.

---

### Step 5.1: Create GoalsVsActualsChart Component

**Claude Code Prompt:**
```
MANDATORY FILE READS:
1. src/components/sga-hub/QuarterlyProgressChart.tsx (existing chart pattern — uses Recharts)
2. src/config/theme.ts (CHART_COLORS)

CREATE: src/components/sga-hub/GoalsVsActualsChart.tsx

CONTEXT:
A reusable line chart component that plots weekly goals vs actuals over time.
Uses Recharts (NOT Tremor charts — per exploration results).

Props:
  title: string  // e.g., "Pipeline Metrics"
  data: Array<{
    weekLabel: string;
    weekStartDate: string;
    [metricKey: string]: number | string | null;
  }>
  metrics: Array<{
    key: string;  // e.g., "mql"
    label: string;  // e.g., "MQLs"
    goalColor: string;
    actualColor: string;
    defaultVisible?: boolean;
  }>

INTERNAL STATE:
  visibleMetrics: Set<string> — which metrics are toggled on (initialize from defaultVisible)
  dateRange: { start: string; end: string } — default trailing 90 days

CHART SETUP:
  - X axis: weekLabel
  - For each visible metric:
    - Actual line: solid, using actualColor
    - Goal line: dashed (strokeDasharray="5 5"), using goalColor
  - Legend toggles for each metric (click to show/hide)
  - Tooltip: show all visible metric values for hovered week
  - Dark mode: const { resolvedTheme } = useTheme(); isDark = resolvedTheme === 'dark'
  - Responsive: use ResponsiveContainer from Recharts

DATE RANGE CONTROL:
  - Default: trailing 90 days from today
  - Simple select: "Last 30 days", "Last 90 days", "Last 6 months", "Last 12 months", "All time"
  - Filter data array by weekStartDate >= selected range start

COLORS (import from CHART_COLORS in src/config/theme.ts):
  - Use distinct color pairs for each metric type
  - Goal lines are lighter/muted versions of the actual colors

NOTE: Charts will show actuals even for weeks without goals. Goal lines will be null/missing for weeks without goals — Recharts handles this by breaking the line (connectNulls=false).
```

---

### Step 5.2: Wire Charts into WeeklyGoalsVsActuals

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/components/sga-hub/WeeklyGoalsVsActuals.tsx (just created in Phase 4)
2. src/components/sga-hub/GoalsVsActualsChart.tsx (just created)

CONTEXT:
Add 3 chart instances below the 3 week sections.

CHANGES to src/components/sga-hub/WeeklyGoalsVsActuals.tsx:

1. Import GoalsVsActualsChart.

2. Compute chart data from weeklyGoals + weeklyActuals arrays:
   - Generate all weeks in the trailing 90-day range
   - For each week, merge goal and actual into a flat object:
     { weekLabel, weekStartDate, mqlGoal, mqlActual, sqlGoal, sqlActual, sqoGoal, sqoActual, initialCallsGoal, initialCallsActual, qualificationCallsGoal, qualificationCallsActual, leadsSourcedGoal, leadsSourcedActual, leadsContactedGoal, leadsContactedActual }

3. Add 3 GoalsVsActualsChart instances after the WeekSection components:

   Chart 1: Pipeline Metrics
   metrics: [
     { key: 'mql', label: 'MQLs', defaultVisible: true },
     { key: 'sql', label: 'SQLs', defaultVisible: true },
     { key: 'sqo', label: 'SQOs', defaultVisible: true },
   ]

   Chart 2: Call Metrics
   metrics: [
     { key: 'initialCalls', label: 'Initial Calls', defaultVisible: true },
     { key: 'qualificationCalls', label: 'Qualification Calls', defaultVisible: true },
   ]

   Chart 3: Lead Activity Metrics
   metrics: [
     { key: 'leadsSourced', label: 'Leads Sourced', defaultVisible: true },
     { key: 'leadsContacted', label: 'Leads Contacted', defaultVisible: true },
   ]

   For each chart, map the data array so that goal keys are `${key}Goal` and actual keys are `${key}Actual`.
```

---

### Phase 5 Verification

**Claude Code Prompt:**
```
Run verification:

1. npx tsc --noEmit 2>&1 | head -50
   — Fix any errors in chart components

2. Verify chart component exists:
   ls -la src/components/sga-hub/GoalsVsActualsChart.tsx

3. grep -n "GoalsVsActualsChart" src/components/sga-hub/WeeklyGoalsVsActuals.tsx
   — Confirm 3 chart instances

4. grep -n "Recharts\|recharts\|LineChart\|ResponsiveContainer" src/components/sga-hub/GoalsVsActualsChart.tsx
   — Confirm Recharts usage (not Tremor charts)

Report results.
```

**🚫 DO NOT PROCEED to Phase 6 until human confirms.**

---

## Phase 6: Frontend — Admin Rollup + Wiring

**Goal:** Create the admin rollup view, wire everything into SGAHubContent, update the tab name, and handle all drilldown dispatch.

---

### Step 6.1: Create AdminGoalsRollupView

**Claude Code Prompt:**
```
MANDATORY FILE READS:
1. src/components/sga-hub/WeeklyGoalsVsActuals.tsx (the SGA view we just created)
2. src/app/dashboard/sga-hub/SGAHubContent.tsx (read the isAdmin logic and state management)

CREATE: src/components/sga-hub/AdminGoalsRollupView.tsx

CONTEXT:
Admin/manager view that shows:
1. A selector to toggle between "All SGAs (Rollup)" and individual SGA views
2. In rollup mode: SUMmed goals and actuals across all SGAs, displayed in the same WeekSection + chart format
3. In individual mode: same as SGA view but for a selected SGA
4. Admin can edit goals on behalf of any SGA in individual mode

Props:
  allSGAGoals: WeeklyGoal[]  // all SGAs' goals
  allSGAActuals: Array<{ sgaName: string; actuals: WeeklyActual[] }>
  sgaList: Array<{ email: string; name: string }>  // for selector dropdown
  onGoalSaved: () => void
  onMetricClick: (weekStartDate: string, metricType: MetricType, options?: { selfSourcedOnly?: boolean; sgaName?: string }) => void

INTERNAL STATE:
  viewMode: 'rollup' | 'individual'
  selectedSGA: { email: string; name: string } | null

ROLLUP AGGREGATION:
  For each week:
  - Sum all SGA goals for that week (mqlGoal, sqlGoal, etc.)
  - Sum all SGA actuals for that week (mqls, sqls, etc.)
  - Display in WeekSection components (NOT editable in rollup mode)

SGA SELECTOR:
  - Dropdown at the top with "All SGAs" option + list of individual SGA names
  - When "All SGAs" selected: show rollup
  - When individual SGA selected: show that SGA's WeeklyGoalsVsActuals with admin edit permissions

LAYOUT:
  - SGA selector dropdown at top
  - WeekSection components (3 sections)
  - Charts (3 charts)
```

---

### Step 6.2: Wire Everything into SGAHubContent

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/app/dashboard/sga-hub/SGAHubContent.tsx (read ENTIRE file — this is ~950 lines)
2. src/components/sga-hub/SGAHubTabs.tsx (tab definitions)

CONTEXT:
This is the most complex step. We need to:
1. Rename "Weekly Goals" tab to "Goals vs. Actuals"
2. Replace the current weekly goals tab content with WeeklyGoalsVsActuals (SGA) or AdminGoalsRollupView (admin)
3. Update fetchWeeklyData to use expanded actuals
4. Add drilldown handlers for 4 new metric types
5. Update the goals/actuals merge logic for 7 metrics

CHANGES:

1. SGAHubTabs.tsx — rename tab:
   Change the tab with id 'weekly-goals' to have label "Goals vs. Actuals"
   (keep the id as 'weekly-goals' to avoid breaking the activeTab state)

2. SGAHubContent.tsx — imports:
   Add: import { WeeklyGoalsVsActuals } from '@/components/sga-hub/WeeklyGoalsVsActuals';
   Add: import { AdminGoalsRollupView } from '@/components/sga-hub/AdminGoalsRollupView';

3. SGAHubContent.tsx — fetchWeeklyData update:
   The existing fetchWeeklyData already calls dashboardApi for goals and actuals.
   The actuals response shape changed (9 fields instead of 3).
   Verify the merge logic in the useEffect handles the new fields.
   Update the WeeklyGoalWithActuals construction to include all 7 metric triplets.

4. SGAHubContent.tsx — drilldown handler update:
   Update handleWeeklyMetricClick signature to accept options:
   handleWeeklyMetricClick(weekStartDate: string, metricType: MetricType, options?: { selfSourcedOnly?: boolean })

   Add cases for new metric types:

   case 'mqls': {
     const response = await dashboardApi.getMQLDrillDown(sgaName, weekStartDate, weekEndDate);
     records = response.records;
     break;
   }
   case 'sqls': {
     const response = await dashboardApi.getSQLDrillDown(sgaName, weekStartDate, weekEndDate);
     records = response.records;
     break;
   }
   case 'leads-sourced': {
     const response = await dashboardApi.getLeadsSourcedDrillDown(
       sgaName, weekStartDate, weekEndDate, options?.selfSourcedOnly
     );
     records = response.records;
     break;
   }
   case 'leads-contacted': {
     const response = await dashboardApi.getLeadsContactedDrillDown(
       sgaName, weekStartDate, weekEndDate, options?.selfSourcedOnly
     );
     records = response.records;
     break;
   }

   Update metricLabels to include:
   'mqls': 'MQLs',
   'sqls': 'SQLs',
   'leads-sourced': 'Leads Sourced',
   'leads-contacted': 'Leads Contacted',

5. SGAHubContent.tsx — tab content rendering:
   In the JSX where activeTab === 'weekly-goals', replace the current WeeklyGoalsTable with:
   
   {isAdmin ? (
     <AdminGoalsRollupView
       allSGAGoals={weeklyGoals}
       allSGAActuals={allSGAActuals}
       sgaList={sgaList}
       onGoalSaved={() => fetchWeeklyData()}
       onMetricClick={handleWeeklyMetricClick}
     />
   ) : (
     <WeeklyGoalsVsActuals
       weeklyGoals={weeklyGoals}
       weeklyActuals={weeklyActuals}
       isAdmin={isAdmin}
       sgaName={sgaName}
       userEmail={session?.user?.email || ''}
       onGoalSaved={() => fetchWeeklyData()}
       onMetricClick={handleWeeklyMetricClick}
     />
   )}

6. For admin view: add state and fetch for allSGAActuals and sgaList.
   When isAdmin and activeTab === 'weekly-goals':
   - Fetch allSGAs actuals via dashboardApi with allSGAs=true
   - Fetch SGA user list for the selector

CRITICAL:
- Do NOT remove or break any existing tab functionality (closed-lost, quarterly, leaderboard)
- Do NOT change the date range state or picker
- Do NOT change the existing drilldown modal or record detail modal rendering in JSX
- The MetricDrillDownModal and RecordDetailModal should still be rendered at the bottom of the component
```

---

### Step 6.3: Update IndividualGoalEditor and BulkGoalEditor

**Claude Code Prompt:**
```
MANDATORY FILE READS:
1. src/components/sga-hub/IndividualGoalEditor.tsx
2. src/components/sga-hub/BulkGoalEditor.tsx

CONTEXT:
Both editors are used in the SGA Management page (admin). They currently handle 3 goal fields.
Update both to handle 7 goal fields.

CHANGES to IndividualGoalEditor.tsx:
1. Add state for 4 new fields (mqlGoal, sqlGoal, leadsSourcedGoal, leadsContactedGoal)
2. Populate from sgaOverview.currentWeekGoal in useEffect
3. Include in POST body
4. Add 4 new inputs to the form

CHANGES to BulkGoalEditor.tsx:
1. Add state for 4 new fields
2. Include in POST body for each selected SGA
3. Add 4 new inputs to the form

Follow the same input pattern (type="text" inputMode="numeric").
```

---

### Phase 6 Verification

**Claude Code Prompt:**
```
Run ALL verification steps:

1. npx tsc --noEmit
   — This MUST pass with ZERO errors. If there are errors, fix them ALL.

2. npx eslint src/components/sga-hub/ src/app/dashboard/sga-hub/ --ext .ts,.tsx 2>&1 | tail -30
   — Report any linting errors and fix them

3. grep -n "Goals vs. Actuals\|Goals vs Actuals" src/components/sga-hub/SGAHubTabs.tsx
   — Confirm tab renamed

4. grep -n "WeeklyGoalsVsActuals\|AdminGoalsRollupView" src/app/dashboard/sga-hub/SGAHubContent.tsx
   — Confirm both are imported and rendered

5. grep -c "'mqls'\|'sqls'\|'leads-sourced'\|'leads-contacted'" src/app/dashboard/sga-hub/SGAHubContent.tsx
   — Confirm all 4 new metric types in drilldown handler

6. Verify all component files exist:
   ls -la src/components/sga-hub/MetricScorecard.tsx
   ls -la src/components/sga-hub/WeekSection.tsx
   ls -la src/components/sga-hub/WeeklyGoalsVsActuals.tsx
   ls -la src/components/sga-hub/GoalsVsActualsChart.tsx
   ls -la src/components/sga-hub/AdminGoalsRollupView.tsx

Report all results. TypeScript MUST compile with zero errors before proceeding.
```

**🚫 DO NOT PROCEED to Phase 7 until human confirms Phase 6 AND tests the following in the UI:**

**HUMAN UI/UX Testing Checklist:**
- [ ] SGA Hub loads without console errors
- [ ] "Goals vs. Actuals" tab appears (renamed from "Weekly Goals")
- [ ] SGA user: sees 3 week sections (Last/This/Next) with 7 metric scorecards each
- [ ] SGA user: This Week and Next Week goals are editable; Last Week is locked
- [ ] SGA user: clicking an actual number opens the drill-down modal
- [ ] SGA user: Leads Contacted toggle switches between All and Self-Sourced actuals
- [ ] Admin user: sees rollup view by default with SGA selector
- [ ] Admin user: can switch to individual SGA view
- [ ] Charts render with goal (dashed) and actual (solid) lines
- [ ] Other tabs (Leaderboard, Closed Lost, Quarterly) still work

**📋 VALIDATION DATA — Verify these in the UI for Amy Waller:**
- [ ] Last Week (3/2–3/8): MQL actual = 7, SQL actual = 2, SQO actual = 2
- [ ] This Week (3/9–3/15): Initial Calls actual = 1
- [ ] Next Week (3/16–3/22): Initial Calls actual = 2
- [ ] This Week Initial Calls drilldown shows John Hetzel (Mar 9)
- [ ] Next Week Initial Calls drilldown shows Korey Doucette + Paul Bullock (Mar 17)

---

## Phase 7: Integration, CSV Export & Documentation

**Goal:** Update CSV exports, polish, and run documentation sync.

---

### Step 7.1: Update CSV Export

**Claude Code Prompt:**
```
MANDATORY FILE READ:
1. src/lib/utils/sga-hub-csv-export.ts (read ENTIRE file)

CHANGES:

1. Update exportWeeklyGoalsCSV to include all 7 metrics:
   Add columns for: mqlGoal, mqlActual, mqlDiff, sqlGoal, sqlActual, sqlDiff, leadsSourcedGoal, leadsSourcedActual, leadsSourcedDiff, leadsContactedGoal, leadsContactedActual, leadsContactedDiff

2. Update exportAdminOverviewCSV to include new weekly goal fields:
   Add: weeklyGoalMQL, weeklyGoalSQL, weeklyGoalLeadsSourced, weeklyGoalLeadsContacted
   Add: weeklyActualMQL, weeklyActualSQL, weeklyActualLeadsSourced, weeklyActualLeadsContacted

3. Add CSV export column mappings for new drill-down types in MetricDrillDownModal.
   The MetricDrillDownModal CSV export uses explicit column mapping (not Object.keys).
   Add branches for 'mqls', 'sqls', 'leads-sourced', 'leads-contacted' in the export handler.
```

---

### Step 7.2: Final Compilation & Lint Check

**Claude Code Prompt:**
```
Run the final build verification:

1. npx tsc --noEmit
   — MUST pass with ZERO errors

2. npx eslint src/ --ext .ts,.tsx 2>&1 | grep -c "error"
   — Report error count. Fix any new errors introduced by our changes.
   — Do NOT fix pre-existing errors in files we didn't touch.

3. npm run build 2>&1 | tail -30
   — Attempt a full Next.js build. Report result.

Report all results.
```

---

### Step 7.3: Documentation Sync

**Claude Code Prompt:**
```
Run documentation sync:

1. npx agent-guard sync
   — Let agent-guard detect changes and update docs

2. npm run gen:api-routes
   — Regenerate API routes documentation (we added 4 new routes)

3. npm run gen:models
   — Regenerate Prisma models documentation (WeeklyGoal has 4 new fields)

4. Update docs/ARCHITECTURE.md:
   In the SGA Hub section, update the description of the Weekly Goals tab to:
   "Goals vs. Actuals" — Weekly goal setting and tracking for 7 metrics (MQL, SQL, SQO, Initial Calls, Qualification Calls, Leads Sourced, Leads Contacted) across 3 time sections (Last Week, This Week, Next Week) with drill-down modals, 3 historical charts, and admin rollup view.

   Add the 4 new API routes to the API Routes table:
   | `/api/sga-hub/drill-down/mqls` | GET | Drill-down for MQLs |
   | `/api/sga-hub/drill-down/sqls` | GET | Drill-down for SQLs |
   | `/api/sga-hub/drill-down/leads-sourced` | GET | Drill-down for leads sourced |
   | `/api/sga-hub/drill-down/leads-contacted` | GET | Drill-down for leads contacted |

5. Report what agent-guard detected and updated.
```

---

### Phase 7 Verification (Final)

**Claude Code Prompt:**
```
Run the COMPLETE final verification:

1. npx tsc --noEmit — MUST pass with ZERO errors
2. npm run build — MUST succeed
3. npx agent-guard check — Report status

4. Count of new files created:
   find src -name "*.ts" -o -name "*.tsx" -newer prisma/schema.prisma | wc -l

5. Summary of all changes:
   git diff --stat (or equivalent showing files changed, insertions, deletions)

6. Verify all 4 new drill-down routes are in generated docs:
   grep -c "mqls\|leads-sourced\|leads-contacted" docs/_generated/api-routes.md

Report everything. This is the final checkpoint.
```

**🚫 FINAL HUMAN TESTING — Complete the full QA checklist:**

**SGA User Testing:**
- [ ] "Goals vs. Actuals" tab loads with 3 week sections
- [ ] Last Week: all goals locked, actuals displayed
- [ ] This Week: goals editable, actuals update
- [ ] Next Week: goals editable, Initial Calls + Qual Calls show scheduled actuals
- [ ] All 7 metric scorecards render correctly in each section
- [ ] Leads Sourced toggle: All ↔ Self-Sourced changes the actual number
- [ ] Leads Contacted toggle: All ↔ Self-Sourced changes the actual number
- [ ] Clicking any actual opens drill-down modal with correct records
- [ ] Drill-down modal: clicking a record opens RecordDetailModal
- [ ] Back button from RecordDetailModal returns to drill-down
- [ ] 3 charts render: Pipeline, Calls, Lead Activity
- [ ] Chart metric toggles work (click legend to hide/show)
- [ ] Chart date range selector works
- [ ] CSV export includes all 7 metrics
- [ ] Goal save persists across page reload

**Admin User Testing:**
- [ ] Rollup view shows SUMmed goals and actuals
- [ ] SGA selector dropdown works
- [ ] Individual SGA view shows that SGA's data
- [ ] Admin can edit goals on behalf of SGA
- [ ] Charts in rollup show aggregated data
- [ ] Charts in individual view show that SGA's data

**📋 VALIDATION DATA — Final Check for Amy Waller:**
- [ ] Last Week (3/2–3/8): 7 MQLs, 2 SQLs, 2 SQOs
- [ ] This Week (3/9–3/15): 1 Initial Call (John Hetzel, Mar 9)
- [ ] Next Week (3/16–3/22): 2 Initial Calls (Korey Doucette + Paul Bullock, Mar 17)
- [ ] MQL drill-down for Last Week shows 7 records
- [ ] Initial Call drill-down for This Week shows 1 record (John Hetzel)
- [ ] Initial Call drill-down for Next Week shows 2 records

**Regression Testing:**
- [ ] Leaderboard tab unchanged
- [ ] Closed Lost tab unchanged
- [ ] Quarterly Progress tab unchanged
- [ ] SGA Management page: IndividualGoalEditor shows 7 fields
- [ ] SGA Management page: BulkGoalEditor shows 7 fields

---

## Appendix A: BigQuery Query Reference

These are the verified queries for each metric. Use these as the source of truth when implementing.

### MQL Actuals (TIMESTAMP field)
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as mql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE mql_stage_entered_ts >= TIMESTAMP(@weekStart)
  AND mql_stage_entered_ts < TIMESTAMP(@weekEnd)
GROUP BY SGA_Owner_Name__c
```

### SQL Actuals (DATE field)
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as sql_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE converted_date_raw >= @weekStart AND converted_date_raw < @weekEnd
  AND is_sql = 1
GROUP BY SGA_Owner_Name__c
```

### SQO Actuals (TIMESTAMP field + dedup + record type)
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE Date_Became_SQO__c >= TIMESTAMP(@weekStart)
  AND Date_Became_SQO__c < TIMESTAMP(@weekEnd)
  AND is_sqo_unique = 1
  AND recordtypeid = @recruitingRecordType
GROUP BY SGA_Owner_Name__c
```

### Initial Calls (DATE field + DISTINCT dedup)
> **NOTE:** This standalone reference query uses `vw_sga_activity_performance` (task-level view with DISTINCT dedup).
> However, the existing weekly-actuals.ts CTEs use `FULL_TABLE` (vw_funnel_master) which also has `Initial_Call_Scheduled_Date__c`.
> **For Step 2.2 CTEs, follow the existing code pattern and use FULL_TABLE.** For drill-down queries (Step 2.3), the existing drill-down functions also use their own patterns — follow those.

```sql
SELECT SGA_Owner_Name__c,
  COUNT(DISTINCT COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c)) as initial_calls
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
WHERE Initial_Call_Scheduled_Date__c >= @weekStart
  AND Initial_Call_Scheduled_Date__c < @weekEnd
GROUP BY SGA_Owner_Name__c
```

### Qualification Calls (DATE field + DISTINCT dedup)
> **NOTE:** Same table discrepancy as Initial Calls above. CTEs in weekly-actuals.ts use FULL_TABLE.

```sql
SELECT SGA_Owner_Name__c,
  COUNT(DISTINCT COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c)) as qual_calls
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
WHERE Qualification_Call_Date__c >= @weekStart
  AND Qualification_Call_Date__c < @weekEnd
GROUP BY SGA_Owner_Name__c
```

### Leads Sourced (all + self-sourced)
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as total,
  COUNTIF(Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')) as self_sourced
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON l.SGA_Owner_Name__c = u.Name AND u.IsSGA__c = TRUE
WHERE l.CreatedDate >= TIMESTAMP(@weekStart)
  AND l.CreatedDate < TIMESTAMP(@weekEnd)
GROUP BY SGA_Owner_Name__c
```

### Leads Contacted (all from vw_funnel_master)
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as contacted
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE stage_entered_contacting__c >= TIMESTAMP(@weekStart)
  AND stage_entered_contacting__c < TIMESTAMP(@weekEnd)
GROUP BY SGA_Owner_Name__c
```

### Leads Contacted (self-sourced from Lead table)
```sql
SELECT l.SGA_Owner_Name__c, COUNT(*) as self_sourced_contacted
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON l.SGA_Owner_Name__c = u.Name AND u.IsSGA__c = TRUE
WHERE l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND l.Stage_Entered_Contacting__c >= TIMESTAMP(@weekStart)
  AND l.Stage_Entered_Contacting__c < TIMESTAMP(@weekEnd)
GROUP BY l.SGA_Owner_Name__c
```

---

## Appendix B: Date Type Quick Reference

| Field | Type | Comparison Pattern |
|-------|------|-------------------|
| `mql_stage_entered_ts` | TIMESTAMP | `>= TIMESTAMP(@date)` |
| `converted_date_raw` | DATE | `>= @date` (direct) |
| `Date_Became_SQO__c` | TIMESTAMP | `>= TIMESTAMP(@date)` |
| `Initial_Call_Scheduled_Date__c` | DATE | `>= @date` (direct) |
| `Qualification_Call_Date__c` | DATE | `>= @date` (direct) |
| `CreatedDate` (Lead table) | TIMESTAMP | `>= TIMESTAMP(@date)` |
| `stage_entered_contacting__c` | TIMESTAMP | `>= TIMESTAMP(@date)` |
| `Stage_Entered_Contacting__c` (Lead table) | TIMESTAMP | `>= TIMESTAMP(@date)` |

---

## Appendix C: Construction Site Inventory (Updated)

Every file that constructs or transforms WeeklyGoal / WeeklyActual objects:

| # | File | What Changes |
|---|------|-------------|
| 1 | `prisma/schema.prisma` | +4 new fields on WeeklyGoal |
| 2 | `src/types/sga-hub.ts` | Expanded types for all weekly interfaces |
| 3 | `src/types/drill-down.ts` | +4 MetricType values, +4 record types, +4 raw types |
| 4 | `src/lib/queries/weekly-goals.ts` | 7 fields in CRUD operations |
| 5 | `src/lib/queries/weekly-actuals.ts` | +6 CTEs for new metrics (single SGA + admin) |
| 6 | `src/lib/queries/drill-down.ts` | +4 new drill-down query functions |
| 7 | `src/app/api/sga-hub/weekly-goals/route.ts` | POST accepts 7 fields |
| 8 | `src/app/api/sga-hub/weekly-actuals/route.ts` | Pass-through (no changes if clean) |
| 9 | `src/app/api/sga-hub/drill-down/mqls/route.ts` | NEW |
| 10 | `src/app/api/sga-hub/drill-down/sqls/route.ts` | NEW |
| 11 | `src/app/api/sga-hub/drill-down/leads-sourced/route.ts` | NEW |
| 12 | `src/app/api/sga-hub/drill-down/leads-contacted/route.ts` | NEW |
| 13 | `src/lib/api-client.ts` | +4 drill-down API client methods |
| 14 | `src/components/sga-hub/MetricScorecard.tsx` | NEW |
| 15 | `src/components/sga-hub/WeekSection.tsx` | NEW |
| 16 | `src/components/sga-hub/WeeklyGoalsVsActuals.tsx` | NEW |
| 17 | `src/components/sga-hub/GoalsVsActualsChart.tsx` | NEW |
| 18 | `src/components/sga-hub/AdminGoalsRollupView.tsx` | NEW |
| 19 | `src/components/sga-hub/MetricDrillDownModal.tsx` | +4 column configs, +4 type guards |
| 20 | `src/components/sga-hub/WeeklyGoalEditor.tsx` | 7 inputs instead of 3 |
| 21 | `src/components/sga-hub/SGAHubTabs.tsx` | Tab rename |
| 22 | `src/components/sga-hub/IndividualGoalEditor.tsx` | 7 goal fields |
| 23 | `src/components/sga-hub/BulkGoalEditor.tsx` | 7 goal fields |
| 24 | `src/app/dashboard/sga-hub/SGAHubContent.tsx` | Wire new tab content, drilldown handlers |
| 25 | `src/lib/utils/sga-hub-csv-export.ts` | +4 metric columns in exports |
| 26 | `docs/ARCHITECTURE.md` | Updated SGA Hub description + API routes |

---

*Document generated from Claude Projects planning session*
*Companion spec: weekly_goals_vs_actuals_spec.md*
*Data exploration: exploration-results.md*
