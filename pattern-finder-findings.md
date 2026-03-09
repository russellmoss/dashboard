# Pattern Finder Findings — Weekly Goals vs. Actuals

## 1. Tab Pattern

**Current implementation:** `src/components/sga-hub/SGAHubTabs.tsx`
- Button-based tab switcher using Tremor's Button component
- Tab enum: `SGAHubTab` defined in SGAHubContent.tsx
- Parent manages active tab via `useState`
- Content rendered conditionally in SGAHubContent based on active tab

**To add/rename tab:** Update the enum, update SGAHubTabs.tsx button list, add content block in SGAHubContent.tsx.

---

## 2. BigQuery Query Pattern

**Client:** `src/lib/bigquery.ts`
```typescript
async function runQuery<T>(query: string, params?: Record<string, any>): Promise<T[]>
```

**Parameterized queries:** Always `@paramName` syntax, NEVER string interpolation.

**Date windowing pattern (from weekly-actuals.ts):**
```sql
WHERE SGA_Owner_Name__c = @sgaName
  AND DATE_TRUNC(mql_stage_entered_ts, WEEK(MONDAY)) >= @startDate
```

**CTE pattern:** Multiple CTEs for different metrics, LEFT JOIN to generate all weeks (even 0-count weeks).

**Key tables:**
- `vw_funnel_master` — primary for MQL/SQL/SQO (used via FULL_TABLE constant)
- `vw_sga_funnel` — SGA-specific funnel view (active SGAs only)
- `vw_sga_activity_performance` — Task-level data with Initial/Qual call dates
- `SavvyGTMData.Lead` — Direct table for leads sourced/contacted with Final_Source__c

---

## 3. API Route Pattern

**Standard structure:**
```typescript
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const permissions = await getSessionPermissions(session);
  if (!permissions) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Admin override pattern:
  let userEmail = session.user.email;
  const targetEmail = searchParams.get('userEmail');
  if (targetEmail) {
    if (!['admin', 'manager', 'revops_admin'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    userEmail = targetEmail;
  }

  const data = await queryFunction(userEmail, ...params);
  return NextResponse.json(data);
}
```

---

## 4. Scorecard / Metric Card Pattern

**Current weekly goals:** Table-based layout in `WeeklyGoalsTable.tsx`
- Rows per week, columns per metric
- Goal values are inline-editable (click to edit, Enter to save)
- Color coding: green if actual >= goal, red if below
- Click on actual number opens drill-down modal

**No existing "scorecard card" pattern** — the spec calls for a card-based layout for the 3 week sections. Will need new component.

---

## 5. Drilldown Modal Pattern

**MetricDrillDownModal.tsx:**
- Takes `metricType` to determine column configuration
- Existing MetricTypes: 'initial-calls', 'qualification-calls', 'sqos', 'open-sqls'
- Each type has different table columns
- Export CSV capability built in
- Row click → `onRecordClick(primaryKey)` → opens RecordDetailModal

**To add new metric types:** Add to MetricType enum, add column config in MetricDrillDownModal.

---

## 6. Chart Pattern

**Existing:** `QuarterlyProgressChart.tsx` uses Tremor AreaChart
- Data structure: `{ date: string, actual: number, goal: number }[]`
- Toggleable series via Tremor's built-in legend clicks

**For new "Goals vs Actuals" graphs:**
- Use Tremor LineChart (consistent with library)
- 3 charts: Pipeline (MQL/SQL/SQO), Calls (Initial/Qual), Lead Activity (Sourced/Contacted)
- Each metric: goal line + actual line
- Default trailing 90 days, customizable date range
- Data: array of weekly data points with goal/actual per metric

---

## 7. Goal Editing Pattern

**Current flow:**
1. `WeeklyGoalEditor.tsx` — Modal with form inputs
2. POST to `/api/sga-hub/weekly-goals` with `WeeklyGoalInput`
3. Backend calls `upsertWeeklyGoal()` in `weekly-goals.ts`
4. Prisma upsert (create or update on unique constraint)
5. Frontend refetches actuals data

**Prisma upsert pattern (weekly-goals.ts):**
```typescript
await prisma.weeklyGoal.upsert({
  where: { userEmail_weekStartDate: { userEmail, weekStartDate } },
  create: { userEmail, weekStartDate, ...goalData, createdBy, updatedBy },
  update: { ...goalData, updatedBy },
});
```

---

## 8. Admin vs SGA Data Filtering

**SGA view:** Only sees own data. userEmail from session.
**Admin view:** Can view any SGA via `userEmail` query param override.
**Rollup:** Admin routes (e.g., `admin-quarterly-progress`) aggregate across all SGAs.

**SGA selector:** `AdminQuarterlyProgressView.tsx` has SGA dropdown for individual view.

---

## 9. Three-Section (Last/This/Next Week) Pattern

**NOT currently implemented.** The current weekly goals tab shows a rolling multi-week table. The new feature replaces this with 3 distinct sections.

**Week calculation helpers exist:** `src/lib/utils/sga-hub-helpers.ts`
- `getWeekStartDate(date)` — Get Monday for any date
- `getWeekEndDate(weekStartDate)` — Get Sunday
- `getWeekLabel(weekStart, weekEnd)` — Format label
- `isCurrentWeek(weekStartDate)` — Check if week is current
- `isFutureWeek(weekStartDate)` — Check if week is future

These helpers support Monday-based weeks, matching the spec's "Monday-ized" requirement.

---

## 10. CSV Export Pattern

**Existing:** `src/lib/utils/sga-hub-csv-export.ts`
- `exportToCsv(filename, records, columns)` — Client-side CSV generation
- Used in MetricDrillDownModal export button
- Handles special characters, date formatting
