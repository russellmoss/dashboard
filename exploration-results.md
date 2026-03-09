# Exploration Results — Weekly Goals vs. Actuals

## 1. Feature Summary

**Replace** the existing "Weekly Goals" tab (3 metrics: Initial Calls, Qualification Calls, SQO) with a new **"Weekly Goals vs. Actuals"** tab supporting **7 metrics** across **3 time sections** (Last Week, This Week, Next Week), with drilldowns, 3 historical line charts, and an admin rollup view.

### Metrics (Goal + Actual)
| # | Metric | Goal Source | Actual Source | BigQuery Date Field |
|---|--------|-------------|---------------|---------------------|
| 1 | MQL | Neon: WeeklyGoal | vw_sga_funnel | `mql_stage_entered_ts` (TIMESTAMP) |
| 2 | SQL | Neon: WeeklyGoal | vw_sga_funnel | `converted_date_raw` (DATE) |
| 3 | SQO | Neon: WeeklyGoal | vw_sga_funnel | `Date_Became_SQO__c` (TIMESTAMP) |
| 4 | Initial Calls | Neon: WeeklyGoal | vw_sga_activity_performance | `Initial_Call_Scheduled_Date__c` (DATE) |
| 5 | Qualification Calls | Neon: WeeklyGoal | vw_sga_activity_performance | `Qualification_Call_Date__c` (DATE) |
| 6 | Leads Sourced | Neon: WeeklyGoal | SavvyGTMData.Lead | `CreatedDate` (TIMESTAMP) |
| 7 | Leads Contacted | Neon: WeeklyGoal | vw_sga_funnel + Lead table | `stage_entered_contacting__c` (TIMESTAMP) |

### Key Identifiers
- **SGA attribution:** `SGA_Owner_Name__c` (consistent across all views/tables)
- **User mapping:** `User.email` → `User.name` → `SGA_Owner_Name__c`
- **Self-sourced filter:** `Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')`
- **Initial/Qual call counts:** Must use `COUNT(DISTINCT COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c))` to avoid task-level duplication

---

## 2. BigQuery Status

### All fields exist ✅ — No view modifications needed

| Metric | View/Table | Verified | Sample (3/2–3/8) |
|--------|------------|----------|-------------------|
| MQL | vw_sga_funnel.mql_stage_entered_ts | ✅ | 152 total, 15 SGAs |
| SQL | vw_sga_funnel.converted_date_raw | ✅ | 28 total, 10 SGAs |
| SQO | vw_sga_funnel.Date_Became_SQO__c | ✅ | 43 total, 12 SGAs |
| Initial Calls | vw_sga_activity_performance.Initial_Call_Scheduled_Date__c | ✅ | 63 total, 15 SGAs |
| Qual Calls | vw_sga_activity_performance.Qualification_Call_Date__c | ✅ | 18 total, 9 SGAs |
| Leads Sourced | Lead.CreatedDate + Final_Source__c | ✅ | 1,534 self-sourced |
| Leads Contacted (all) | vw_sga_funnel.stage_entered_contacting__c | ✅ | 4,468 total |
| Leads Contacted (self) | Lead.Stage_Entered_Contacting__c + Final_Source__c | ✅ | 1,478 self-sourced |
| Next-week lookahead | Initial_Call_Scheduled_Date__c (future dates) | ✅ | 44 scheduled |
| Qual call SGM linkage | vw_sga_activity_performance.sgm_name | ✅ | Populated |

### Data Quality Notes
- `SGA_Owner_Name__c` may be "Savvy Operations" or "Savvy Marketing" on some leads — filter to real SGAs
- `vw_sga_funnel` already filters to active SGA/SGM users (safe for MQL/SQL/SQO/Contacted)
- Direct Lead table queries (Leads Sourced, Self-Sourced Contacted) need explicit SGA filtering
- Initial/Qual call dates: low population rate (~2% / 0.5%) — expected, only leads reaching those stages

---

## 3. Files to Modify

### Schema & Types
| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Drop & recreate WeeklyGoal: add mqlGoal, sqlGoal, leadsSourcedGoal, leadsContactedGoal (4 new Int fields) |
| `src/types/sga-hub.ts` | Expand WeeklyGoal, WeeklyGoalInput, WeeklyActual, WeeklyGoalWithActuals with 4 new metrics |
| `src/types/drill-down.ts` | Add MQLDrillDownRecord, SQLDrillDownRecord, LeadsSourcedRecord, LeadsContactedRecord |

### Query Functions
| File | Changes |
|------|---------|
| `src/lib/queries/weekly-goals.ts` | Handle 7 goal fields in all CRUD operations |
| `src/lib/queries/weekly-actuals.ts` | Add 4 new BigQuery metric queries (MQL, SQL, Leads Sourced, Leads Contacted) |
| `src/lib/queries/drill-down.ts` | Add 4 new drill-down functions |

### API Routes
| File | Changes |
|------|---------|
| `src/app/api/sga-hub/weekly-goals/route.ts` | Accept/return 7 goal fields |
| `src/app/api/sga-hub/weekly-actuals/route.ts` | Return expanded actuals (7 metrics + self-sourced toggle) |
| NEW: `src/app/api/sga-hub/drill-down/mqls/route.ts` | MQL drill-down |
| NEW: `src/app/api/sga-hub/drill-down/sqls/route.ts` | SQL drill-down |
| NEW: `src/app/api/sga-hub/drill-down/leads-sourced/route.ts` | Leads sourced drill-down |
| NEW: `src/app/api/sga-hub/drill-down/leads-contacted/route.ts` | Leads contacted drill-down |

### Components
| File | Changes |
|------|---------|
| `src/components/sga-hub/SGAHubTabs.tsx` | Rename "Weekly Goals" → "Goals vs. Actuals" |
| `src/components/sga-hub/WeeklyGoalsTable.tsx` | **Major rewrite:** 3-section layout (Last/This/Next Week), 7 metrics per section, scorecard cards |
| `src/components/sga-hub/WeeklyGoalEditor.tsx` | 7 goal inputs instead of 3 |
| `src/components/sga-hub/MetricDrillDownModal.tsx` | Add column configs for 4 new metric types |
| `src/components/sga-hub/IndividualGoalEditor.tsx` | Update for 7 goals |
| `src/components/sga-hub/BulkGoalEditor.tsx` | Update for 7 goals |
| NEW: `src/components/sga-hub/WeeklyGoalsVsActuals.tsx` | Main container: 3 sections + 3 charts |
| NEW: `src/components/sga-hub/WeekSection.tsx` | Single week section (Last/This/Next) with 7 metric cards |
| NEW: `src/components/sga-hub/MetricScorecard.tsx` | Individual metric card (goal vs actual, clickable) |
| NEW: `src/components/sga-hub/GoalsVsActualsChart.tsx` | Line chart with toggleable goal/actual series |
| NEW: `src/components/sga-hub/AdminGoalsRollupView.tsx` | Admin rollup + individual SGA drill-in |

### Page / Main Component
| File | Changes |
|------|---------|
| `src/app/dashboard/sga-hub/SGAHubContent.tsx` | Wire new tab content, add drilldown handlers for 4 new metrics, admin rollup logic |

### Utilities
| File | Changes |
|------|---------|
| `src/lib/utils/sga-hub-helpers.ts` | May need `getLastWeek()`, `getNextWeek()` helpers |
| `src/lib/utils/sga-hub-csv-export.ts` | Add export configs for new drill-down types |

---

## 4. Type Changes

### WeeklyGoal (Prisma + TypeScript)
```diff
model WeeklyGoal {
  id                     String   @id @default(cuid())
  userEmail              String
  weekStartDate          DateTime @db.Date
+ mqlGoal                Int      @default(0)
+ sqlGoal                Int      @default(0)
  sqoGoal                Int      @default(0)
  initialCallsGoal       Int      @default(0)
  qualificationCallsGoal Int      @default(0)
+ leadsSourcedGoal       Int      @default(0)
+ leadsContactedGoal     Int      @default(0)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  createdBy              String?
  updatedBy              String?
  @@unique([userEmail, weekStartDate])
}
```

### WeeklyActual (TypeScript)
```diff
interface WeeklyActual {
  weekStartDate: string;
+ mqls: number;
+ sqls: number;
+ sqos: number;
  initialCalls: number;
  qualificationCalls: number;
- sqos: number;
+ leadsSourced: number;
+ leadsSourcedSelfSourced: number;
+ leadsContacted: number;
+ leadsContactedSelfSourced: number;
}
```

### WeeklyGoalWithActuals (TypeScript)
Add goal/actual/diff triplets for all 7 metrics, plus `leadsContactedToggle: 'all' | 'self-sourced'` state.

---

## 5. Construction Site Inventory

Every location that constructs or transforms WeeklyGoal / WeeklyActual objects:

| # | File | Function/Line | What it constructs |
|---|------|---------------|-------------------|
| 1 | `src/lib/queries/weekly-goals.ts` | `upsertWeeklyGoal()` | Prisma create/update |
| 2 | `src/lib/queries/weekly-goals.ts` | `copyWeeklyGoal()` | Copy from previous week |
| 3 | `src/lib/queries/weekly-goals.ts` | `getWeeklyGoals()` | Returns WeeklyGoal[] |
| 4 | `src/lib/queries/weekly-goals.ts` | `getWeeklyGoalsByWeek()` | Returns all SGAs for a week (admin) |
| 5 | `src/lib/queries/weekly-goals.ts` | `getAllSGAWeeklyGoals()` | Bulk fetch (admin) |
| 6 | `src/lib/queries/weekly-actuals.ts` | `getWeeklyActuals()` | Constructs WeeklyActual from BQ |
| 7 | `src/lib/queries/weekly-actuals.ts` | `getAllSGAWeeklyActuals()` | All SGAs actuals (admin) |
| 8 | `src/app/api/sga-hub/weekly-goals/route.ts` | POST handler (lines 160-178) | Validates & passes input, SGA editability check |
| 9 | `src/app/api/sga-hub/weekly-actuals/route.ts` | GET handler (lines 68-80) | Email→name lookup + returns actuals |
| 10 | `src/components/sga-hub/WeeklyGoalsTable.tsx` | Render logic (lines 169-302) | Merges goals + actuals, clickable metric cells |
| 11 | `src/components/sga-hub/WeeklyGoalEditor.tsx` | Form submission | Creates WeeklyGoalInput (uses direct `fetch`, not dashboardApi) |
| 12 | `src/components/sga-hub/IndividualGoalEditor.tsx` | Form submission | Creates WeeklyGoalInput |
| 13 | `src/components/sga-hub/BulkGoalEditor.tsx` | Batch submission | Creates WeeklyGoalInput[] |
| 14 | `src/app/dashboard/sga-hub/SGAHubContent.tsx` | `fetchWeeklyData()` (line 271-284) | Combines goals + actuals |
| 15 | `src/app/dashboard/sga-hub/SGAHubContent.tsx` | `handleWeeklyMetricClick()` (line 378) | Drilldown dispatch + MetricType labeling |
| 16 | `src/lib/utils/sga-hub-csv-export.ts` | Export functions | Explicit column configs for CSV |
| 17 | `src/lib/api-client.ts` | `dashboardApi.*` methods (lines 490-713) | API client for all SGA Hub endpoints |

---

## 6. Recommended Phase Order

### Phase 1: Schema & Types (breaks build intentionally)
1. Update `prisma/schema.prisma` — add 4 new goal fields to WeeklyGoal
2. Run migration: `npx prisma migrate dev --name add-weekly-goal-metrics`
3. Update `src/types/sga-hub.ts` — expand all weekly goal/actual types
4. Update `src/types/drill-down.ts` — add new drill-down record types

### Phase 2: Backend — Query Functions
5. Update `src/lib/queries/weekly-goals.ts` — handle 7 fields in all CRUD
6. Expand `src/lib/queries/weekly-actuals.ts` — add MQL, SQL, Leads Sourced, Leads Contacted queries
7. Add drill-down query functions to `src/lib/queries/drill-down.ts`

### Phase 3: Backend — API Routes
8. Update `src/app/api/sga-hub/weekly-goals/route.ts` — 7 goal fields
9. Update `src/app/api/sga-hub/weekly-actuals/route.ts` — expanded response
10. Create 4 new drill-down API routes

### Phase 4: Frontend — Core Components
11. Create `WeeklyGoalsVsActuals.tsx` — main container with 3 sections
12. Create `WeekSection.tsx` — single week (Last/This/Next) with metric cards
13. Create `MetricScorecard.tsx` — goal vs actual card with click-to-drilldown
14. Update `WeeklyGoalEditor.tsx` — 7 inputs
15. Update `MetricDrillDownModal.tsx` — new metric type configs

### Phase 5: Frontend — Charts
16. Create `GoalsVsActualsChart.tsx` — Tremor LineChart with toggleable series
17. Wire 3 chart instances (Pipeline, Calls, Lead Activity) with date range controls

### Phase 6: Frontend — Admin Rollup
18. Create `AdminGoalsRollupView.tsx` — aggregated view + individual SGA drill-in
19. Update `SGAHubContent.tsx` — admin toggle between rollup/individual

### Phase 7: Integration & Polish
20. Update `SGAHubTabs.tsx` — rename tab
21. Wire everything in `SGAHubContent.tsx` — tab content, drilldown handlers
22. Update CSV export for new drill-down types
23. Test all 7 metrics × 3 sections × SGA/Admin views

### Phase 7.5: Documentation Sync
24. Run `npx agent-guard sync`
25. Run `npm run gen:all` to regenerate inventory docs

---

## 7. Risks and Blockers

### No Blockers ✅
- All BigQuery fields exist in current views
- No view modifications needed
- Existing patterns cover all technical needs

### Risks
| Risk | Mitigation |
|------|------------|
| **Prisma migration on existing data** | WeeklyGoal table has only ~few hundred rows. New fields default to 0 — safe to migrate without data loss. Spec says "drop & recreate" but a simple `ALTER ADD COLUMN` migration is cleaner. |
| **"Savvy Operations" in lead queries** | Filter to real SGAs: JOIN to User table or exclude by name |
| **Task-level duplication in call counts** | Always use `COUNT(DISTINCT COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c))` |
| **Mixed date types (DATE vs TIMESTAMP)** | Handle in query functions — DATE: `field >= @start`, TIMESTAMP: `field >= TIMESTAMP(@start)` |
| **Large component (SGAHubContent.tsx ~950 lines)** | Extract new tab content to dedicated component to avoid bloat |
| **3 different BigQuery sources for 7 metrics** | Single API route can make parallel BigQuery calls; or split into sub-routes |
| **Self-sourced toggle state** | Keep toggle state local to the Leads Contacted card; fetch both values upfront |
| **SQO SGA resolution complexity** | SQO queries need `LEFT JOIN User ON Opp_SGA_Name__c = User.Id` because Opp_SGA_Name__c can be a User ID (`005...`), not a name. Follow existing pattern in `weekly-actuals.ts` lines 56-58. |
| **`extractDate` vs `extractDateValue` inconsistency** | 6+ files define local copies. New code should use `extractDateValue` returning `string \| null`. |
| **Direct fetch vs dashboardApi** | Existing `WeeklyGoalEditor.tsx` calls `fetch()` directly. New code should always use `dashboardApi` methods in `src/lib/api-client.ts`. |

### Critical Implementation Details (from code inspection)
- All BigQuery query functions MUST be wrapped in `cachedQuery(fn, key, CACHE_TAGS.SGA_HUB)` — 4-hour TTL
- `MetricDrillDownModal` CSV export uses **explicit column mapping** (not `Object.keys`) — must add branches manually for new metric types
- `MetricType` in `drill-down.ts` line 8: must add to union + `COLUMN_CONFIGS` + type guards + export mapping
- API client methods: add to `src/lib/api-client.ts` (lines 490-713) for all new drill-down endpoints
- Chart library is **Recharts** (not Tremor charts). Use `strokeDasharray="5 5"` on goal lines to distinguish.
- Colors: import from `CHART_COLORS` in `src/config/theme.ts`
- Dark mode: `const isDark = resolvedTheme === 'dark'` pattern on all chart tooltips
- `ClickableMetricValue` component already exists at `src/components/sga-hub/ClickableMetricValue.tsx` — reuse for drilldown triggers

---

## 8. Documentation

The implementation guide must include:
- Phase 7.5: Run `npx agent-guard sync` after code changes pass build
- Run `npm run gen:api-routes` after creating new API routes
- Run `npm run gen:models` after Prisma migration
- Update ARCHITECTURE.md SGA Hub section with new tab description

---

## 9. BigQuery Query Reference

### MQL Actuals
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as mql_count
FROM `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
WHERE mql_stage_entered_ts >= @weekStart AND mql_stage_entered_ts < @weekEnd
GROUP BY SGA_Owner_Name__c
```

### SQL Actuals
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as sql_count
FROM `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
WHERE converted_date_raw >= @weekStart AND converted_date_raw < @weekEnd
GROUP BY SGA_Owner_Name__c
```

### SQO Actuals
```sql
SELECT SGA_Owner_Name__c, COUNT(*) as sqo_count
FROM `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
WHERE Date_Became_SQO__c >= @weekStart AND Date_Became_SQO__c < @weekEnd
GROUP BY SGA_Owner_Name__c
```

### Initial Calls (DISTINCT to deduplicate tasks)
```sql
SELECT SGA_Owner_Name__c,
  COUNT(DISTINCT COALESCE(Full_prospect_id__c, Full_Opportunity_ID__c)) as initial_calls
FROM `savvy-gtm-analytics.Tableau_Views.vw_sga_activity_performance`
WHERE Initial_Call_Scheduled_Date__c >= @weekStart
  AND Initial_Call_Scheduled_Date__c < @weekEnd
GROUP BY SGA_Owner_Name__c
```

### Qualification Calls (DISTINCT + SGM linkage available)
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
-- All leads sourced
SELECT SGA_Owner_Name__c, COUNT(*) as total
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON l.SGA_Owner_Name__c = u.Name AND u.IsSGA__c = TRUE
WHERE l.CreatedDate >= @weekStart AND l.CreatedDate < @weekEnd
GROUP BY SGA_Owner_Name__c

-- Self-sourced only
SELECT SGA_Owner_Name__c, COUNT(*) as self_sourced
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON l.SGA_Owner_Name__c = u.Name AND u.IsSGA__c = TRUE
WHERE l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND l.CreatedDate >= @weekStart AND l.CreatedDate < @weekEnd
GROUP BY SGA_Owner_Name__c
```

### Leads Contacted (all + self-sourced)
```sql
-- All leads contacted
SELECT SGA_Owner_Name__c, COUNT(*) as contacted
FROM `savvy-gtm-analytics.SavvyGTMData.vw_sga_funnel`
WHERE stage_entered_contacting__c >= @weekStart AND stage_entered_contacting__c < @weekEnd
GROUP BY SGA_Owner_Name__c

-- Self-sourced contacted
SELECT l.SGA_Owner_Name__c, COUNT(*) as self_sourced_contacted
FROM `savvy-gtm-analytics.SavvyGTMData.Lead` l
JOIN `savvy-gtm-analytics.SavvyGTMData.User` u ON l.SGA_Owner_Name__c = u.Name AND u.IsSGA__c = TRUE
WHERE l.Final_Source__c IN ('Fintrx (Self-Sourced)', 'LinkedIn (Self Sourced)')
  AND l.Stage_Entered_Contacting__c >= @weekStart AND l.Stage_Entered_Contacting__c < @weekEnd
GROUP BY l.SGA_Owner_Name__c
```
