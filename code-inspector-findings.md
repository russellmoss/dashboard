# Code Inspector Findings — Weekly Goals vs. Actuals

## 1. SGA Hub Page Structure

**Main Files:**
- `src/app/dashboard/sga-hub/page.tsx` — Server wrapper (auth + permissions)
- `src/app/dashboard/sga-hub/SGAHubContent.tsx` — Main client component (~950 lines)

**5 Existing Tabs** (SGAHubTab enum):
1. `leaderboard` — SGA rankings
2. `weekly-goals` — Current weekly goal tracking (3 metrics only)
3. `closed-lost` — Follow-up opportunities
4. `quarterly-progress` — Quarterly pacing
5. `activity` — SGA activity overview

**Tab component:** `src/components/sga-hub/SGAHubTabs.tsx` — Button-based switcher with icons

---

## 2. Current WeeklyGoal Prisma Model (prisma/schema.prisma lines 50-65)

```prisma
model WeeklyGoal {
  id                     String   @id @default(cuid())
  userEmail              String
  weekStartDate          DateTime @db.Date
  initialCallsGoal       Int      @default(0)
  qualificationCallsGoal Int      @default(0)
  sqoGoal                Int      @default(0)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  createdBy              String?
  updatedBy              String?
  @@unique([userEmail, weekStartDate])
  @@index([userEmail])
  @@index([weekStartDate])
}
```

**Current model has only 3 goal metrics.** New feature needs 7: MQL, SQL, SQO, Initial Calls, Qualification Calls, Leads Sourced, Leads Contacted.

---

## 3. Current Types (src/types/sga-hub.ts)

### Types to modify:
- `WeeklyGoal` (line 13) — add mqlGoal, sqlGoal, leadsSourcedGoal, leadsContactedGoal
- `WeeklyGoalInput` (line 27) — add new goal fields
- `WeeklyActual` (line 35) — add mqlActual, sqlActual, leadsSourced, leadsContacted, leadsContactedSelfSourced
- `WeeklyGoalWithActuals` (line 43) — add all new goal/actual/diff fields + toggle state

### Types to create:
- New drilldown record types for MQL, SQL, Leads Sourced, Leads Contacted

---

## 4. Current Weekly Goals Components

- `src/components/sga-hub/WeeklyGoalsTable.tsx` — Interactive table (currently 3 metrics)
- `src/components/sga-hub/WeeklyGoalEditor.tsx` — Modal for editing goals
- `src/components/sga-hub/IndividualGoalEditor.tsx` — Single SGA editor (admin)
- `src/components/sga-hub/BulkGoalEditor.tsx` — Bulk editor (admin)

---

## 5. API Routes (src/app/api/sga-hub/)

**Weekly Goals routes:**
- `weekly-goals/route.ts` — GET/POST for goals (Prisma)
- `weekly-actuals/route.ts` — GET actuals from BigQuery

**Drill-down routes:**
- `drill-down/initial-calls/route.ts` — Initial calls by week/SGA
- `drill-down/qualification-calls/route.ts` — Qual calls by week/SGA
- `drill-down/sqos/route.ts` — SQOs with filters

**New routes needed:**
- `drill-down/mqls/route.ts` — MQL drill-down
- `drill-down/sqls/route.ts` — SQL drill-down
- `drill-down/leads-sourced/route.ts` — Leads sourced drill-down
- `drill-down/leads-contacted/route.ts` — Leads contacted drill-down

---

## 6. User Role Detection

**Permission system:** `src/lib/permissions.ts`

```typescript
const isAdmin = permissions?.role === 'admin' || permissions?.role === 'manager' || permissions?.role === 'revops_admin';
```

**SGA filter from token:**
```typescript
sgaFilter: tokenData.role === 'sga' ? tokenData.name : null
```

**Edit permissions (SGAHubContent.tsx line ~347):**
```typescript
canEdit: isAdmin || isCurrentWeek || isFutureWeek
```

---

## 7. SGA User ↔ BigQuery Mapping

**Chain:** `User.email` → `User.name` → `SGA_Owner_Name__c` in BigQuery

In weekly-actuals.ts:
```typescript
const user = await prisma.user.findUnique({ where: { email: userEmail }, select: { name: true } });
// user.name is passed as @sgaName to BigQuery
```

---

## 8. Query Functions

- `src/lib/queries/weekly-goals.ts` (209 lines) — Prisma CRUD: get, upsert, delete, copy
- `src/lib/queries/weekly-actuals.ts` (242 lines) — BigQuery: aggregates by WEEK(MONDAY)
- `src/lib/queries/drill-down.ts` (469 lines) — BigQuery: detailed records for modals
- `src/lib/bigquery.ts` — Client setup + `runQuery<T>()` helper

---

## 9. Drilldown Pattern

**Flow:** Click metric → `handleWeeklyMetricClick()` → fetch drill-down → `MetricDrillDownModal` → click row → `RecordDetailModal`

**State in SGAHubContent.tsx:**
```typescript
const [drillDownOpen, setDrillDownOpen] = useState(false);
const [drillDownMetricType, setDrillDownMetricType] = useState<MetricType | null>(null);
const [drillDownRecords, setDrillDownRecords] = useState<DrillDownRecord[]>([]);
```

**Components:**
- `src/components/sga-hub/MetricDrillDownModal.tsx` — Configurable by MetricType
- `src/components/dashboard/RecordDetailModal.tsx` — Full record detail viewer

---

## 10. Chart/Graph Patterns

**Libraries:** Tremor React + Recharts
**Existing charts:**
- `QuarterlyProgressChart.tsx` — AreaChart with historical SQO data
- No existing "goal vs actual line chart" — will need to create

---

## 11. Constants (src/config/constants.ts)

```typescript
FULL_TABLE = `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
MAPPING_TABLE = `savvy-gtm-analytics.Tableau_Views.source_to_channel_mapping`
RECRUITING_RECORD_TYPE = '012Dn000000mrO3IAI'
```

---

## 12. Files to Modify Summary

| Category | File | Changes |
|----------|------|---------|
| Schema | `prisma/schema.prisma` | Drop & recreate WeeklyGoal with 7 goals |
| Types | `src/types/sga-hub.ts` | Add new fields to WeeklyGoal, WeeklyActual, WeeklyGoalWithActuals |
| Types | `src/types/drill-down.ts` | Add MQL, SQL, LeadsSourced, LeadsContacted record types |
| Queries | `src/lib/queries/weekly-goals.ts` | Update for 7 goal fields |
| Queries | `src/lib/queries/weekly-actuals.ts` | Add MQL, SQL, Leads Sourced, Leads Contacted queries |
| Queries | `src/lib/queries/drill-down.ts` | Add 4 new drill-down query functions |
| API | `src/app/api/sga-hub/weekly-goals/route.ts` | Handle 7 goal fields |
| API | `src/app/api/sga-hub/weekly-actuals/route.ts` | Return expanded actuals |
| API | New: `drill-down/mqls/`, `drill-down/sqls/`, `drill-down/leads-sourced/`, `drill-down/leads-contacted/` | 4 new routes |
| Components | `src/components/sga-hub/WeeklyGoalsTable.tsx` | Expand to 7 metrics, 3 sections, graphs |
| Components | `src/components/sga-hub/WeeklyGoalEditor.tsx` | 7 goal inputs |
| Components | `src/components/sga-hub/MetricDrillDownModal.tsx` | Handle new metric types |
| Components | `src/components/sga-hub/SGAHubTabs.tsx` | Rename tab |
| Components | New: Goals vs Actuals charts (3 graphs) | Line charts with toggleable series |
| Page | `src/app/dashboard/sga-hub/SGAHubContent.tsx` | Wire new tab, drilldown handlers, admin rollup |
