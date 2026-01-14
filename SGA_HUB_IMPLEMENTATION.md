# SGA Hub Feature - Agentic Implementation Plan

**Created:** January 2026
**Last Updated:** January 27, 2026 (Validation Complete)
**Status:** Ready for Implementation (Validated & Corrected)

**Estimated Duration:** 25-35 hours

**Prerequisites:** SGA_HUB_FINDINGS.md review complete

> [!IMPORTANT]
> ### ⚠️ CRITICAL INSTRUCTIONS FOR CURSOR.AI
> 
> 
> * **ALWAYS** run `npx tsc --noEmit` after creating/modifying TypeScript files.
> * **ALWAYS** run `npm run lint` before committing.
> * Use **MCP** to verify BigQuery queries against actual data.
> * Follow existing codebase patterns exactly—reference files mentioned.
> * **Commit** after each phase with the provided commit message.
> * **Do NOT** proceed to the next phase if verification fails.
> 
> ### ⚠️ VALIDATION COMPLETE - ALL PATTERNS VERIFIED (January 27, 2026)
> 
> **Validation Status:** ✅ All codebase patterns verified against actual implementation
> 
> **Key Verified Patterns:**
> - ✅ API Routes: `getServerSession(authOptions)`, `getUserPermissions()`, `NextResponse.json()`
> - ✅ BigQuery: `runQuery<T>(query, params)` with named params, `toNumber()` helper exists
> - ✅ Prisma: Named export `prisma` from `@/lib/prisma`, PostgreSQL provider
> - ✅ Constants: `FULL_TABLE`, `RECRUITING_RECORD_TYPE` exist in `@/config/constants.ts`
> - ✅ Permissions: Roles `admin`, `manager`, `sgm`, `sga`, `viewer` confirmed
> - ✅ Page IDs: Current highest is 7 (Settings), SGA Hub = 8, SGA Management = 9
> - ✅ User Model: Has `name` field (String, required), matches `SGA_Owner_Name__c` exactly
> 
> ### ⚠️ CRITICAL CORRECTIONS APPLIED (January 27, 2026)
> 
> **1. DATE vs TIMESTAMP Field Handling:**
> - `Initial_Call_Scheduled_Date__c` and `Qualification_Call_Date__c` are **DATE** fields - use direct comparison (NO TIMESTAMP wrapper)
>   - Correct: `Initial_Call_Scheduled_Date__c >= @startDate`
>   - Wrong: `TIMESTAMP(Initial_Call_Scheduled_Date__c) >= TIMESTAMP(@startDate)`
> - `Date_Became_SQO__c` is a **TIMESTAMP** field - MUST use `TIMESTAMP()` wrapper for date comparisons
>   - Correct: `Date_Became_SQO__c >= TIMESTAMP(@startDate) AND Date_Became_SQO__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))`
> - When joining week_start values, cast TIMESTAMP results to DATE: `DATE(DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY)))`
> 
> **2. Week Calculation & Type Consistency:**
> - `DATE_TRUNC(..., WEEK(MONDAY))` returns DATE for DATE fields, TIMESTAMP for TIMESTAMP fields
> - Always cast TIMESTAMP week_start to DATE when joining: `DATE(DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY)))`
> - This ensures all week_start values are DATE type for consistent joins
> 
> **3. Constants:**
> - Use `RECRUITING_RECORD_TYPE` from `@/config/constants.ts` (value: '012Dn000000mrO3IAI')
> - Use `FULL_TABLE` constant: 'savvy-gtm-analytics.Tableau_Views.vw_funnel_master'
> 
> **4. SGA Name Matching:**
> - Use `user.name` from Prisma User table to match `SGA_Owner_Name__c` in BigQuery (exact match, case-sensitive)
> - Query: `WHERE SGA_Owner_Name__c = @sgaName` (not case-insensitive)
> 
> **5. Edit Permissions:**
> - SGAs can ONLY edit current/future weeks (not past weeks)
> - Validation in POST handler: Check if `weekStartDate < currentWeekMonday` for SGA role
> - Admins can edit any week for any SGA
> - Use `getWeekInfo()` helper to determine `canEdit` in UI
> 
> **6. Date Range Handling:**
> - For DATE fields: `<= @endDate` is sufficient (includes full day)
> - For TIMESTAMP fields: `<= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))` to include full day
> 
> **7. Prisma Date Handling:**
> - `weekStartDate` uses `@db.Date` - stored as DATE only (no time)
> - Transform function should handle Date object: `goal.weekStartDate.toISOString().split('T')[0]`
> - Always extract date part (YYYY-MM-DD) for API responses
> 
> **8. Closed Lost View:**
> - View name: `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`
> - Filter by `sga_name` field (exact match to `user.name`)
> - Construct `lead_url` in query or application code (not in view)
> 
> **9. Quarterly SQO Queries:**
> - Use `Date_Became_SQO__c` (TIMESTAMP) with `TIMESTAMP()` wrapper
> - Filter by `is_sqo_unique = 1` AND `recordtypeid = @recruitingRecordType`
> - Format quarter as: `CONCAT(CAST(EXTRACT(YEAR FROM Date_Became_SQO__c) AS STRING), '-Q', CAST(EXTRACT(QUARTER FROM Date_Became_SQO__c) AS STRING))`
> 
> 

---

## Table of Contents

1. Phase 0: Pre-Flight Checks
2. Phase 1: Database Schema
3. Phase 2: Types & Interfaces
4. Phase 3: Weekly Goals API Routes
5. Phase 4: Weekly Actuals BigQuery
6. Phase 5: SGA Hub Page - Weekly Goals Tab
7. Phase 6: Closed Lost Tab
8. Phase 7: Quarterly Progress Tab
9. Phase 8: Admin SGA Management Page
10. Phase 9: Navigation & Permissions
11. Phase 10: Final Integration & Testing

---

## Phase 0: Pre-Flight Checks

### Step 0.1: Verify Development Environment

**Cursor.ai Prompt:**
Before starting the SGA Hub implementation, verify the development environment is ready:

1. Run `npm run build` to ensure the project builds successfully.
2. Run `npx tsc --noEmit` to check for TypeScript errors.
3. Run `npm run lint` to check for linting errors.
4. Verify Prisma is working: `npx prisma db pull` (should complete without errors).
5. Check that the dev server starts: `npm run dev`.

Report any errors found. **Do NOT proceed** if there are existing errors.

### Step 0.2: Verify BigQuery Access (MCP)

**Cursor.ai Prompt:**
Use MCP to verify BigQuery access by running this test query:

```sql
SELECT 
  SGA_Owner_Name__c,
  COUNT(*) as record_count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c IS NOT NULL
  AND Initial_Call_Scheduled_Date__c >= '2025-01-01'
GROUP BY SGA_Owner_Name__c
ORDER BY record_count DESC
LIMIT 5

```

**Verify:**

* Query executes successfully.
* Returns SGA names matching User table names.
* Data exists for recent dates.

**Also verify the closed lost view:**

```sql
SELECT COUNT(*) as total_records
FROM `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`

```

Report results before proceeding.

### Step 0.3: Verify SGA Name Mapping

**Cursor.ai Prompt:**
Use MCP to verify the test users' SGA names exist in BigQuery:

```sql
SELECT DISTINCT
  u.Name as user_name,
  u.Email as user_email,
  (SELECT COUNT(*) FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master` 
   WHERE SGA_Owner_Name__c = u.Name) as funnel_records
FROM `savvy-gtm-analytics.SavvyGTMData.User` u
WHERE u.Email IN (
  'eleni@savvywealth.com',
  'perry.kalmeta@savvywealth.com',
  'russell.armitage@savvywealth.com'
)

```

Document the exact Name values for each email - these **MUST** match exactly for filtering to work.

### Verification Gate 0:

* [ ] `npm run build` succeeds
* [ ] `npx tsc --noEmit` has no errors
* [ ] `npm run lint` has no errors
* [ ] BigQuery queries execute successfully
* [ ] Test user names verified

---

## Phase 1: Database Schema

### Step 1.1: Add Prisma Models

**Cursor.ai Prompt:**
Add the WeeklyGoal and QuarterlyGoal models to `prisma/schema.prisma`.

Reference the existing User model pattern in the file. Add the new models **AFTER** the User model.

**Requirements:**

1. **WeeklyGoal:** userEmail, weekStartDate, three goal fields, audit fields, unique constraint.
2. **QuarterlyGoal:** userEmail, quarter string, sqoGoal, audit fields, unique constraint.
3. Use the same patterns as User model (@id, @default, etc.).
4. Add appropriate indexes for query performance.

**Code to Add (append to prisma/schema.prisma):**

```prisma
model WeeklyGoal {
  id                     String   @id @default(cuid())
  userEmail              String   // Links to User.email - matches SGA_Owner_Name__c via User.name
  weekStartDate          DateTime @db.Date // Monday of the week (DATE only)
  initialCallsGoal       Int      @default(0)
  qualificationCallsGoal Int      @default(0)
  sqoGoal                Int      @default(0)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  createdBy              String?  // Email of user who created
  updatedBy              String?  // Email of user who last updated

  @@unique([userEmail, weekStartDate])
  @@index([userEmail])
  @@index([weekStartDate])
}

model QuarterlyGoal {
  id        String   @id @default(cuid())
  userEmail String   // Links to User.email
  quarter   String   // Format: "2026-Q1", "2026-Q2", etc.
  sqoGoal   Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  createdBy String?  // Email of admin who set it
  updatedBy String?  // Email of admin who last updated

  @@unique([userEmail, quarter])
  @@index([userEmail])
  @@index([quarter])
}

```

### Step 1.2: Run Migration

**Cursor.ai Prompt:**
Run the Prisma migration to create the new tables:

1. Run: `npx prisma migrate dev --name add_sga_hub_goals`
2. If prompted, confirm the migration.
3. Run: `npx prisma generate`
4. Verify the migration was successful.

If there are any errors, report them and **do NOT proceed**.

### Step 1.3: Verify Database Tables

**Cursor.ai Prompt:**
Verify the new tables were created correctly:

1. Run: `npx prisma db pull` (should complete without changes).
2. Check that `prisma/schema.prisma` still has the new models.
3. Run a quick test to ensure Prisma client works:

**Create a temporary test file `test-prisma.ts` in the root:**

```typescript
import { prisma } from './src/lib/prisma';

async function test() {
  // Test WeeklyGoal
  const weeklyGoals = await prisma.weeklyGoal.findMany({ take: 1 });
  console.log('WeeklyGoal table accessible:', weeklyGoals.length >= 0);
  
  // Test QuarterlyGoal
  const quarterlyGoals = await prisma.quarterlyGoal.findMany({ take: 1 });
  console.log('QuarterlyGoal table accessible:', quarterlyGoals.length >= 0);
}

test().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

```

Run: `npx ts-node test-prisma.ts`

Then **DELETE** the test file after verification.

### Verification Gate 1:

* [ ] Migration completed successfully
* [ ] `npx prisma generate` succeeded
* [ ] Test script confirms tables are accessible
* [ ] `npx tsc --noEmit` passes
* [ ] Test file deleted

**Checkpoint:**

```bash
git add -A && git commit -m "Phase 1: Add WeeklyGoal and QuarterlyGoal Prisma models"

```

---

## Phase 2: Types & Interfaces

### Step 2.1: Create SGA Hub Types

**Cursor.ai Prompt:**
Create a new types file for the SGA Hub feature: `src/types/sga-hub.ts`

Reference existing type patterns in:

* `src/types/dashboard.ts`
* `src/types/user.ts`
* `src/types/filters.ts`

Include types for:

1. WeeklyGoal (from database)
2. WeeklyActual (from BigQuery)
3. WeeklyGoalWithActuals (combined for display)
4. QuarterlyGoal (from database)
5. QuarterlyProgress (with pacing calculation)
6. ClosedLostRecord (from BigQuery view)
7. API request/response types

**Code to Create (src/types/sga-hub.ts):**

```typescript
// src/types/sga-hub.ts

/**
 * SGA Hub Feature Types
 * Types for weekly goals, quarterly progress, and closed lost tracking
 */

// ============================================================================
// WEEKLY GOALS
// ============================================================================

/** Weekly goal from database */
export interface WeeklyGoal {
  id: string;
  userEmail: string;
  weekStartDate: string; // ISO date string (Monday)
  initialCallsGoal: number;
  qualificationCallsGoal: number;
  sqoGoal: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

/** Weekly goal input for create/update */
export interface WeeklyGoalInput {
  weekStartDate: string; // ISO date string (Monday)
  initialCallsGoal: number;
  qualificationCallsGoal: number;
  sqoGoal: number;
}

/** Weekly actuals from BigQuery */
export interface WeeklyActual {
  weekStartDate: string; // ISO date string (Monday) - YYYY-MM-DD format
  initialCalls: number;
  qualificationCalls: number;
  sqos: number;
}

/** Combined goal and actual for display */
export interface WeeklyGoalWithActuals {
  weekStartDate: string;
  weekEndDate: string; // Sunday
  weekLabel: string; // e.g., "Jan 13 - Jan 19, 2026"
  
  // Goals (null if not set)
  initialCallsGoal: number | null;
  qualificationCallsGoal: number | null;
  sqoGoal: number | null;
  
  // Actuals
  initialCallsActual: number;
  qualificationCallsActual: number;
  sqoActual: number;
  
  // Differences (null if goal not set)
  initialCallsDiff: number | null;
  qualificationCallsDiff: number | null;
  sqoDiff: number | null;
  
  // Status
  hasGoal: boolean;
  canEdit: boolean; // SGAs can only edit current/future weeks; Admins can edit any week
}

// ============================================================================
// QUARTERLY GOALS & PROGRESS
// ============================================================================

/** Quarterly goal from database */
export interface QuarterlyGoal {
  id: string;
  userEmail: string;
  quarter: string; // "2026-Q1" format
  sqoGoal: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

/** Quarterly goal input for create/update */
export interface QuarterlyGoalInput {
  userEmail: string;
  quarter: string;
  sqoGoal: number;
}

/** Quarterly progress with pacing */
export interface QuarterlyProgress {
  quarter: string;
  quarterLabel: string; // "Q1 2026"
  
  // Goal
  sqoGoal: number | null;
  hasGoal: boolean;
  
  // Actuals
  sqoActual: number;
  totalAum: number;
  totalAumFormatted: string;
  
  // Progress percentage (actual / goal * 100)
  progressPercent: number | null;
  
  // Pacing
  quarterStartDate: string;
  quarterEndDate: string;
  daysInQuarter: number;
  daysElapsed: number;
  expectedSqos: number; // Prorated based on days elapsed
  pacingDiff: number; // actual - expected (positive = ahead, negative = behind)
  pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal';
}

/** SQO detail record for quarterly progress table */
export interface SQODetail {
  id: string; // primary_key
  advisorName: string;
  sqoDate: string;
  aum: number;
  aumFormatted: string;
  aumTier: string;
  channel: string;
  source: string;
  stageName: string;
  leadUrl: string | null;
  opportunityUrl: string | null;
  salesforceUrl: string;
}

// ============================================================================
// CLOSED LOST
// ============================================================================

/** Time bucket for closed lost filtering */
export type ClosedLostTimeBucket = 
  | '30-60' 
  | '60-90' 
  | '90-120' 
  | '120-150' 
  | '150-180'
  | 'all';

/** Closed lost record from BigQuery view */
export interface ClosedLostRecord {
  id: string; // Full_Opportunity_ID__c
  oppName: string;
  leadId: string | null;
  opportunityId: string;
  leadUrl: string | null;
  opportunityUrl: string;
  salesforceUrl: string;
  lastContactDate: string;
  closedLostDate: string;
  sqlDate: string;
  closedLostReason: string;
  closedLostDetails: string | null;
  timeSinceContactBucket: string;
  daysSinceContact: number;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/** GET /api/sga-hub/weekly-goals query params */
export interface WeeklyGoalsQueryParams {
  startDate?: string; // ISO date
  endDate?: string; // ISO date
}

/** POST /api/sga-hub/weekly-goals request body */
export interface WeeklyGoalsPostBody extends WeeklyGoalInput {
  // Inherits weekStartDate, initialCallsGoal, qualificationCallsGoal, sqoGoal
}

/** GET /api/sga-hub/weekly-actuals query params */
export interface WeeklyActualsQueryParams {
  startDate?: string;
  endDate?: string;
}

/** GET /api/sga-hub/closed-lost query params */
export interface ClosedLostQueryParams {
  timeBuckets?: ClosedLostTimeBucket[]; // Multi-select
}

/** GET /api/sga-hub/quarterly-progress query params */
export interface QuarterlyProgressQueryParams {
  quarters?: string[]; // Multi-select, e.g., ["2026-Q1", "2025-Q4"]
}

/** GET /api/admin/sga-overview query params */
export interface AdminSGAOverviewQueryParams {
  weekStartDate?: string;
  quarter?: string;
}

/** Admin SGA overview response item */
export interface AdminSGAOverview {
  userEmail: string;
  userName: string;
  isActive: boolean;
  
  // Current week
  currentWeekGoal: WeeklyGoal | null;
  currentWeekActual: WeeklyActual | null;
  
  // Current quarter
  currentQuarterGoal: QuarterlyGoal | null;
  currentQuarterProgress: QuarterlyProgress | null;
  
  // Closed lost count
  closedLostCount: number;
  
  // Alerts
  missingWeeklyGoal: boolean;
  missingQuarterlyGoal: boolean;
  behindPacing: boolean;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/** Quarter info helper */
export interface QuarterInfo {
  quarter: string; // "2026-Q1"
  label: string; // "Q1 2026"
  startDate: string;
  endDate: string;
  year: number;
  quarterNumber: 1 | 2 | 3 | 4;
}

/** Week info helper */
export interface WeekInfo {
  weekStartDate: string; // Monday ISO date
  weekEndDate: string; // Sunday ISO date
  label: string; // "Jan 13 - Jan 19, 2026"
  isCurrentWeek: boolean;
  isFutureWeek: boolean;
  isPastWeek: boolean;
}

```

### Step 2.2: Create Date Utility Functions

**Cursor.ai Prompt:**
Create a utility file for SGA Hub date functions: `src/lib/utils/sga-hub-helpers.ts`

Reference existing helpers in:

* `src/lib/utils/date-helpers.ts`
* `src/lib/utils/format-helpers.ts`

Include functions for:

1. `getWeekMondayDate(date)` - Get Monday of the week containing date.
2. `getWeekSundayDate(date)` - Get Sunday of the week.
3. `formatWeekRange(monday)` - Format as "Jan 13 - Jan 19, 2026".
4. `getQuarterFromDate(date)` - Get "2026-Q1" format.
5. `getQuarterDates(quarter)` - Get start/end dates for quarter.
6. `calculateQuarterPacing(quarter, goal, actual)` - Calculate pacing.
7. `getWeeksInRange(start, end)` - Get array of week Mondays.
8. `isCurrentWeek(monday)` - Check if date is in current week.

**Code to Create (src/lib/utils/sga-hub-helpers.ts):**

```typescript
// src/lib/utils/sga-hub-helpers.ts

import { QuarterInfo, WeekInfo, QuarterlyProgress } from '@/types/sga-hub';

/**
 * Get the Monday of the week containing the given date
 */
export function getWeekMondayDate(date: Date | string): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust for Sunday
  const monday = new Date(d.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Get the Sunday of the week containing the given date
 */
export function getWeekSundayDate(date: Date | string): Date {
  const monday = getWeekMondayDate(date);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return sunday;
}

/**
 * Format a week range as "Jan 13 - Jan 19, 2026"
 */
export function formatWeekRange(mondayDate: Date | string): string {
  const monday = new Date(mondayDate);
  const sunday = getWeekSundayDate(monday);
  
  const monthFormat = new Intl.DateTimeFormat('en-US', { month: 'short' });
  const dayFormat = new Intl.DateTimeFormat('en-US', { day: 'numeric' });
  const yearFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric' });
  
  const monMonth = monthFormat.format(monday);
  const monDay = dayFormat.format(monday);
  const sunMonth = monthFormat.format(sunday);
  const sunDay = dayFormat.format(sunday);
  const year = yearFormat.format(sunday);
  
  // Same month
  if (monMonth === sunMonth) {
    return `${monMonth} ${monDay} - ${sunDay}, ${year}`;
  }
  // Different months
  return `${monMonth} ${monDay} - ${sunMonth} ${sunDay}, ${year}`;
}

/**
 * Format date as ISO string (YYYY-MM-DD)
 */
export function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get quarter string from date (e.g., "2026-Q1")
 */
export function getQuarterFromDate(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0-11
  const quarter = Math.floor(month / 3) + 1;
  return `${year}-Q${quarter}`;
}

/**
 * Get quarter info from quarter string
 */
export function getQuarterInfo(quarter: string): QuarterInfo {
  const [yearStr, qStr] = quarter.split('-Q');
  const year = parseInt(yearStr, 10);
  const quarterNumber = parseInt(qStr, 10) as 1 | 2 | 3 | 4;
  
  const startMonth = (quarterNumber - 1) * 3;
  const startDate = new Date(year, startMonth, 1);
  const endDate = new Date(year, startMonth + 3, 0); // Last day of quarter
  
  return {
    quarter,
    label: `Q${quarterNumber} ${year}`,
    startDate: formatDateISO(startDate),
    endDate: formatDateISO(endDate),
    year,
    quarterNumber,
  };
}

/**
 * Get all quarters in a range (for historical view)
 */
export function getQuartersInRange(startQuarter: string, endQuarter: string): string[] {
  const quarters: string[] = [];
  const start = getQuarterInfo(startQuarter);
  const end = getQuarterInfo(endQuarter);
  
  let currentYear = start.year;
  let currentQ = start.quarterNumber;
  
  while (currentYear < end.year || (currentYear === end.year && currentQ <= end.quarterNumber)) {
    quarters.push(`${currentYear}-Q${currentQ}`);
    currentQ++;
    if (currentQ > 4) {
      currentQ = 1;
      currentYear++;
    }
  }
  
  return quarters;
}

/**
 * Calculate quarterly pacing
 */
export function calculateQuarterPacing(
  quarter: string,
  goal: number | null,
  actual: number,
  totalAum: number,
  formatCurrency: (n: number) => string
): QuarterlyProgress {
  const info = getQuarterInfo(quarter);
  const today = new Date();
  const startDate = new Date(info.startDate);
  const endDate = new Date(info.endDate);
  
  // Calculate days
  const daysInQuarter = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.max(0, Math.min(
    daysInQuarter,
    Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
  ));
  
  // Calculate pacing
  let expectedSqos = 0;
  let pacingDiff = 0;
  let pacingStatus: 'ahead' | 'on-track' | 'behind' | 'no-goal' = 'no-goal';
  let progressPercent: number | null = null;
  
  if (goal !== null && goal > 0) {
    expectedSqos = Math.round((goal / daysInQuarter) * daysElapsed * 10) / 10; // 1 decimal
    pacingDiff = actual - expectedSqos;
    progressPercent = Math.round((actual / goal) * 100);
    
    if (pacingDiff >= 0.5) {
      pacingStatus = 'ahead';
    } else if (pacingDiff >= -0.5) {
      pacingStatus = 'on-track';
    } else {
      pacingStatus = 'behind';
    }
  }
  
  return {
    quarter,
    quarterLabel: info.label,
    sqoGoal: goal,
    hasGoal: goal !== null,
    sqoActual: actual,
    totalAum,
    totalAumFormatted: formatCurrency(totalAum),
    progressPercent,
    quarterStartDate: info.startDate,
    quarterEndDate: info.endDate,
    daysInQuarter,
    daysElapsed,
    expectedSqos,
    pacingDiff: Math.round(pacingDiff * 10) / 10,
    pacingStatus,
  };
}

/**
 * Get week info for a given Monday date
 */
export function getWeekInfo(mondayDate: Date | string): WeekInfo {
  const monday = new Date(mondayDate);
  monday.setHours(0, 0, 0, 0);
  const sunday = getWeekSundayDate(monday);
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const currentWeekMonday = getWeekMondayDate(today);
  
  const isCurrentWeek = monday.getTime() === currentWeekMonday.getTime();
  const isFutureWeek = monday.getTime() > currentWeekMonday.getTime();
  const isPastWeek = monday.getTime() < currentWeekMonday.getTime();
  
  return {
    weekStartDate: formatDateISO(monday),
    weekEndDate: formatDateISO(sunday),
    label: formatWeekRange(monday),
    isCurrentWeek,
    isFutureWeek,
    isPastWeek,
  };
}

/**
 * Get array of week Monday dates in a range
 */
export function getWeeksInRange(startDate: Date | string, endDate: Date | string): Date[] {
  const weeks: Date[] = [];
  let currentMonday = getWeekMondayDate(startDate);
  const end = new Date(endDate);
  
  while (currentMonday <= end) {
    weeks.push(new Date(currentMonday));
    currentMonday.setDate(currentMonday.getDate() + 7);
  }
  
  return weeks;
}

/**
 * Get default date range for weekly goals view (3 past weeks + current + next week)
 */
export function getDefaultWeekRange(): { startDate: string; endDate: string } {
  const today = new Date();
  const currentMonday = getWeekMondayDate(today);
  
  // 3 weeks before current
  const startMonday = new Date(currentMonday);
  startMonday.setDate(startMonday.getDate() - 21);
  
  // 1 week after current (next week's Sunday)
  const endSunday = new Date(currentMonday);
  endSunday.setDate(endSunday.getDate() + 13); // Current Monday + 13 = next week Sunday
  
  return {
    startDate: formatDateISO(startMonday),
    endDate: formatDateISO(endSunday),
  };
}

/**
 * Get current quarter string
 */
export function getCurrentQuarter(): string {
  return getQuarterFromDate(new Date());
}

/**
 * Validate that a date is a Monday
 */
export function isMonday(date: Date | string): boolean {
  const d = new Date(date);
  return d.getDay() === 1;
}

/**
 * Parse quarter string and validate
 */
export function parseQuarter(quarter: string): { year: number; quarter: number } | null {
  const match = quarter.match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;
  return {
    year: parseInt(match[1], 10),
    quarter: parseInt(match[2], 10),
  };
}

```

### Step 2.3: Verify Types Compile

**Cursor.ai Prompt:**
Verify the new types and helpers compile correctly:

1. Run: `npx tsc --noEmit`
2. Check for any import errors or type issues.
3. Fix any errors found.

If there are import path issues, verify the `tsconfig.json` has the correct path mappings.

### Verification Gate 2:

* [ ] `src/types/sga-hub.ts` created
* [ ] `src/lib/utils/sga-hub-helpers.ts` created
* [ ] `npx tsc --noEmit` passes
* [ ] `npm run lint` passes

**Checkpoint:**

```bash
git add -A && git commit -m "Phase 2: Add SGA Hub types and date utility helpers"

```

---

## Phase 3: Weekly Goals API Routes

### Step 3.1: Create Weekly Goals Query Functions

**Cursor.ai Prompt:**
Create the database query functions for weekly goals: `src/lib/queries/weekly-goals.ts`

Reference existing query patterns in:

* `src/lib/queries/detail-records.ts`
* `src/lib/queries/funnel-metrics.ts`

Use Prisma client from `@/lib/prisma`.

**Include functions:**

1. `getWeeklyGoals(userEmail, startDate?, endDate?)` - Get goals for a user.
2. `upsertWeeklyGoal(userEmail, goalInput, updatedBy)` - Create or update a goal.
3. `getWeeklyGoalsByWeek(weekStartDate)` - Get all goals for a specific week (admin).
4. `getAllSGAWeeklyGoals(startDate, endDate)` - Get all SGA goals (admin).

**Code to Create (src/lib/queries/weekly-goals.ts):**

```typescript
// src/lib/queries/weekly-goals.ts

import { prisma } from '@/lib/prisma';
import { WeeklyGoal, WeeklyGoalInput } from '@/types/sga-hub';
import { isMonday } from '@/lib/utils/sga-hub-helpers';

/**
 * Get weekly goals for a specific user within a date range
 */
export async function getWeeklyGoals(
  userEmail: string,
  startDate?: string,
  endDate?: string
): Promise<WeeklyGoal[]> {
  const where: any = { userEmail };
  
  if (startDate || endDate) {
    where.weekStartDate = {};
    if (startDate) {
      where.weekStartDate.gte = new Date(startDate);
    }
    if (endDate) {
      where.weekStartDate.lte = new Date(endDate);
    }
  }
  
  const goals = await prisma.weeklyGoal.findMany({
    where,
    orderBy: { weekStartDate: 'desc' },
  });
  
  return goals.map(transformWeeklyGoal);
}

/**
 * Get a single weekly goal by user and week
 */
export async function getWeeklyGoalByWeek(
  userEmail: string,
  weekStartDate: string
): Promise<WeeklyGoal | null> {
  const goal = await prisma.weeklyGoal.findUnique({
    where: {
      userEmail_weekStartDate: {
        userEmail,
        weekStartDate: new Date(weekStartDate),
      },
    },
  });
  
  return goal ? transformWeeklyGoal(goal) : null;
}

/**
 * Create or update a weekly goal
 */
export async function upsertWeeklyGoal(
  userEmail: string,
  input: WeeklyGoalInput,
  updatedBy: string
): Promise<WeeklyGoal> {
  // Validate weekStartDate is a Monday
  if (!isMonday(input.weekStartDate)) {
    throw new Error('weekStartDate must be a Monday');
  }
  
  // Validate goals are non-negative
  if (input.initialCallsGoal < 0 || input.qualificationCallsGoal < 0 || input.sqoGoal < 0) {
    throw new Error('Goal values must be non-negative');
  }
  
  const weekStartDate = new Date(input.weekStartDate);
  
  const goal = await prisma.weeklyGoal.upsert({
    where: {
      userEmail_weekStartDate: {
        userEmail,
        weekStartDate,
      },
    },
    update: {
      initialCallsGoal: input.initialCallsGoal,
      qualificationCallsGoal: input.qualificationCallsGoal,
      sqoGoal: input.sqoGoal,
      updatedBy,
    },
    create: {
      userEmail,
      weekStartDate,
      initialCallsGoal: input.initialCallsGoal,
      qualificationCallsGoal: input.qualificationCallsGoal,
      sqoGoal: input.sqoGoal,
      createdBy: updatedBy,
      updatedBy,
    },
  });
  
  return transformWeeklyGoal(goal);
}

/**
 * Get all weekly goals for a specific week (admin view)
 */
export async function getWeeklyGoalsByWeek(
  weekStartDate: string
): Promise<WeeklyGoal[]> {
  const goals = await prisma.weeklyGoal.findMany({
    where: {
      weekStartDate: new Date(weekStartDate),
    },
    orderBy: { userEmail: 'asc' },
  });
  
  return goals.map(transformWeeklyGoal);
}

/**
 * Get all SGA weekly goals within a date range (admin view)
 */
export async function getAllSGAWeeklyGoals(
  startDate: string,
  endDate: string
): Promise<WeeklyGoal[]> {
  const goals = await prisma.weeklyGoal.findMany({
    where: {
      weekStartDate: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    },
    orderBy: [
      { weekStartDate: 'desc' },
      { userEmail: 'asc' },
    ],
  });
  
  return goals.map(transformWeeklyGoal);
}

/**
 * Delete a weekly goal (admin only)
 */
export async function deleteWeeklyGoal(
  userEmail: string,
  weekStartDate: string
): Promise<void> {
  await prisma.weeklyGoal.delete({
    where: {
      userEmail_weekStartDate: {
        userEmail,
        weekStartDate: new Date(weekStartDate),
      },
    },
  });
}

/**
 * Copy goals from one week to another
 */
export async function copyWeeklyGoal(
  userEmail: string,
  sourceWeekStartDate: string,
  targetWeekStartDate: string,
  updatedBy: string
): Promise<WeeklyGoal | null> {
  const sourceGoal = await getWeeklyGoalByWeek(userEmail, sourceWeekStartDate);
  
  if (!sourceGoal) {
    return null;
  }
  
  return upsertWeeklyGoal(
    userEmail,
    {
      weekStartDate: targetWeekStartDate,
      initialCallsGoal: sourceGoal.initialCallsGoal,
      qualificationCallsGoal: sourceGoal.qualificationCallsGoal,
      sqoGoal: sourceGoal.sqoGoal,
    },
    updatedBy
  );
}

/**
 * Transform Prisma model to API response type
 * ✅ VERIFIED: Prisma @db.Date fields return as Date objects in JavaScript
 * weekStartDate is stored as DATE in database (via @db.Date), so it's a Date object but only contains date part
 */
function transformWeeklyGoal(goal: any): WeeklyGoal {
  // ✅ VERIFIED: Prisma Date fields (with @db.Date) return as Date objects
  // Convert to ISO string and extract date part (YYYY-MM-DD)
  const weekStartDate = goal.weekStartDate instanceof Date 
    ? goal.weekStartDate.toISOString().split('T')[0]
    : String(goal.weekStartDate).split('T')[0];
  
  return {
    id: goal.id,
    userEmail: goal.userEmail,
    weekStartDate,
    initialCallsGoal: goal.initialCallsGoal,
    qualificationCallsGoal: goal.qualificationCallsGoal,
    sqoGoal: goal.sqoGoal,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    createdBy: goal.createdBy,
    updatedBy: goal.updatedBy,
  };
}

```

### Step 3.2: Create Quarterly Goals Query Functions

**Cursor.ai Prompt:**
Create the database query functions for quarterly goals: `src/lib/queries/quarterly-goals.ts`

Follow the same patterns as `weekly-goals.ts`.

**Include functions:**

1. `getQuarterlyGoal(userEmail, quarter)` - Get single goal.
2. `getQuarterlyGoals(userEmail)` - Get all goals for a user.
3. `upsertQuarterlyGoal(userEmail, quarter, sqoGoal, updatedBy)` - Create or update.
4. `getAllSGAQuarterlyGoals(quarter)` - Get all SGA goals for a quarter (admin).

**Code to Create (src/lib/queries/quarterly-goals.ts):**

```typescript
// src/lib/queries/quarterly-goals.ts

import { prisma } from '@/lib/prisma';
import { QuarterlyGoal, QuarterlyGoalInput } from '@/types/sga-hub';
import { parseQuarter } from '@/lib/utils/sga-hub-helpers';

/**
 * Get a quarterly goal for a specific user and quarter
 */
export async function getQuarterlyGoal(
  userEmail: string,
  quarter: string
): Promise<QuarterlyGoal | null> {
  const goal = await prisma.quarterlyGoal.findUnique({
    where: {
      userEmail_quarter: {
        userEmail,
        quarter,
      },
    },
  });
  
  return goal ? transformQuarterlyGoal(goal) : null;
}

/**
 * Get all quarterly goals for a user
 */
export async function getQuarterlyGoals(
  userEmail: string
): Promise<QuarterlyGoal[]> {
  const goals = await prisma.quarterlyGoal.findMany({
    where: { userEmail },
    orderBy: { quarter: 'desc' },
  });
  
  return goals.map(transformQuarterlyGoal);
}

/**
 * Create or update a quarterly goal
 */
export async function upsertQuarterlyGoal(
  input: QuarterlyGoalInput,
  updatedBy: string
): Promise<QuarterlyGoal> {
  // Validate quarter format
  const parsed = parseQuarter(input.quarter);
  if (!parsed) {
    throw new Error('Invalid quarter format. Use "YYYY-QN" (e.g., "2026-Q1")');
  }
  
  // Validate goal is non-negative
  if (input.sqoGoal < 0) {
    throw new Error('SQO goal must be non-negative');
  }
  
  const goal = await prisma.quarterlyGoal.upsert({
    where: {
      userEmail_quarter: {
        userEmail: input.userEmail,
        quarter: input.quarter,
      },
    },
    update: {
      sqoGoal: input.sqoGoal,
      updatedBy,
    },
    create: {
      userEmail: input.userEmail,
      quarter: input.quarter,
      sqoGoal: input.sqoGoal,
      createdBy: updatedBy,
      updatedBy,
    },
  });
  
  return transformQuarterlyGoal(goal);
}

/**
 * Get all SGA quarterly goals for a specific quarter (admin view)
 */
export async function getAllSGAQuarterlyGoals(
  quarter: string
): Promise<QuarterlyGoal[]> {
  const goals = await prisma.quarterlyGoal.findMany({
    where: { quarter },
    orderBy: { userEmail: 'asc' },
  });
  
  return goals.map(transformQuarterlyGoal);
}

/**
 * Get quarterly goals for multiple quarters (for historical view)
 */
export async function getQuarterlyGoalsForQuarters(
  userEmail: string,
  quarters: string[]
): Promise<QuarterlyGoal[]> {
  const goals = await prisma.quarterlyGoal.findMany({
    where: {
      userEmail,
      quarter: { in: quarters },
    },
    orderBy: { quarter: 'desc' },
  });
  
  return goals.map(transformQuarterlyGoal);
}

/**
 * Delete a quarterly goal (admin only)
 */
export async function deleteQuarterlyGoal(
  userEmail: string,
  quarter: string
): Promise<void> {
  await prisma.quarterlyGoal.delete({
    where: {
      userEmail_quarter: {
        userEmail,
        quarter,
      },
    },
  });
}

/**
 * Transform Prisma model to API response type
 */
function transformQuarterlyGoal(goal: any): QuarterlyGoal {
  return {
    id: goal.id,
    userEmail: goal.userEmail,
    quarter: goal.quarter,
    sqoGoal: goal.sqoGoal,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    createdBy: goal.createdBy,
    updatedBy: goal.updatedBy,
  };
}

```

### Step 3.3: Create Weekly Goals API Route

**Cursor.ai Prompt:**
Create the API route for weekly goals: `src/app/api/sga-hub/weekly-goals/route.ts`

Reference existing API patterns in:

* `src/app/api/users/route.ts`
* `src/app/api/dashboard/record-detail/[id]/route.ts`

**Requirements:**

1. **GET** handler - get goals for logged-in user (or specific user if admin).
2. **POST** handler - create/update goal.
3. Authentication required.
4. SGA role can only access own data.
5. Admin/Manager can access any SGA's data.
6. Proper error handling with status codes.

**Code to Create (src/app/api/sga-hub/weekly-goals/route.ts):**

```typescript
// src/app/api/sga-hub/weekly-goals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { 
  getWeeklyGoals, 
  upsertWeeklyGoal,
  copyWeeklyGoal,
} from '@/lib/queries/weekly-goals';
import { getDefaultWeekRange, getWeekMondayDate, isMonday } from '@/lib/utils/sga-hub-helpers';
import { WeeklyGoalInput } from '@/types/sga-hub';

/**
 * GET /api/sga-hub/weekly-goals
 * Get weekly goals for the logged-in user or a specific user (admin only)
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Parse query params
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const targetUserEmail = searchParams.get('userEmail'); // Admin only
    
    // Determine which user's goals to fetch
    let userEmail = session.user.email;
    
    if (targetUserEmail) {
      // Only admin/manager can view other users' goals
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA role required for own goals
      if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    
    // Use default range if not provided
    const dateRange = startDate && endDate 
      ? { startDate, endDate }
      : getDefaultWeekRange();
    
    const goals = await getWeeklyGoals(
      userEmail,
      dateRange.startDate,
      dateRange.endDate
    );
    
    return NextResponse.json({ goals });
    
  } catch (error) {
    console.error('[API] Error fetching weekly goals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weekly goals' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sga-hub/weekly-goals
 * Create or update a weekly goal
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Parse request body
    const body = await request.json();
    const { 
      weekStartDate, 
      initialCallsGoal, 
      qualificationCallsGoal, 
      sqoGoal,
      userEmail: targetUserEmail, // Admin only - to set for another user
      copyFromWeek, // Optional - copy goals from another week
    } = body;
    
    // Determine target user
    let userEmail = session.user.email;
    
    if (targetUserEmail && targetUserEmail !== session.user.email) {
      // Only admin/manager can set goals for other users
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA role required for own goals
      if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    
    // Handle copy from previous week
    if (copyFromWeek) {
      const copiedGoal = await copyWeeklyGoal(
        userEmail,
        copyFromWeek,
        weekStartDate,
        session.user.email
      );
      
      if (!copiedGoal) {
        return NextResponse.json(
          { error: 'No goals found for source week' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({ goal: copiedGoal });
    }
    
    // Validate required fields
    if (!weekStartDate) {
      return NextResponse.json(
        { error: 'weekStartDate is required' },
        { status: 400 }
      );
    }
    
    // Validate weekStartDate is a Monday
    if (!isMonday(weekStartDate)) {
      return NextResponse.json(
        { error: 'weekStartDate must be a Monday' },
        { status: 400 }
      );
    }
    
    // SGA role can only edit current/future weeks (not past weeks)
    if (permissions.role === 'sga' && userEmail === session.user.email) {
      const weekDate = new Date(weekStartDate);
      const today = new Date();
      const currentWeekMonday = getWeekMondayDate(today);
      
      if (weekDate < currentWeekMonday) {
        return NextResponse.json(
          { error: 'SGAs can only edit goals for current or future weeks' },
          { status: 403 }
        );
      }
    }
    
    const goalInput: WeeklyGoalInput = {
      weekStartDate,
      initialCallsGoal: initialCallsGoal ?? 0,
      qualificationCallsGoal: qualificationCallsGoal ?? 0,
      sqoGoal: sqoGoal ?? 0,
    };
    
    const goal = await upsertWeeklyGoal(
      userEmail,
      goalInput,
      session.user.email
    );
    
    return NextResponse.json({ goal });
    
  } catch (error: any) {
    console.error('[API] Error saving weekly goal:', error);
    
    // Handle validation errors
    if (error.message?.includes('Monday') || error.message?.includes('non-negative')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json(
      { error: 'Failed to save weekly goal' },
      { status: 500 }
    );
  }
}

```

### Step 3.4: Create Quarterly Goals API Route

**Cursor.ai Prompt:**
Create the API route for quarterly goals: `src/app/api/sga-hub/quarterly-goals/route.ts`

Follow the same pattern as weekly-goals route.
Only admin/manager can set quarterly goals.
SGAs can view their own quarterly goals.

**Code to Create (src/app/api/sga-hub/quarterly-goals/route.ts):**

```typescript
// src/app/api/sga-hub/quarterly-goals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { 
  getQuarterlyGoal,
  getQuarterlyGoals,
  upsertQuarterlyGoal,
  getAllSGAQuarterlyGoals,
} from '@/lib/queries/quarterly-goals';
import { getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';

/**
 * GET /api/sga-hub/quarterly-goals
 * Get quarterly goals for the logged-in user or all SGAs (admin)
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Parse query params
    const { searchParams } = new URL(request.url);
    const quarter = searchParams.get('quarter') || getCurrentQuarter();
    const targetUserEmail = searchParams.get('userEmail');
    const allSGAs = searchParams.get('allSGAs') === 'true'; // Admin only
    
    // Admin: Get all SGAs' goals for a quarter
    if (allSGAs) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      
      const goals = await getAllSGAQuarterlyGoals(quarter);
      return NextResponse.json({ goals, quarter });
    }
    
    // Get specific user's goals
    let userEmail = session.user.email;
    
    if (targetUserEmail) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    
    // Get all quarters for user (for historical view)
    const goals = await getQuarterlyGoals(userEmail);
    
    return NextResponse.json({ goals });
    
  } catch (error) {
    console.error('[API] Error fetching quarterly goals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quarterly goals' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sga-hub/quarterly-goals
 * Create or update a quarterly goal (admin/manager only)
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Only admin/manager can set quarterly goals
    if (!['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Parse request body
    const body = await request.json();
    const { userEmail, quarter, sqoGoal } = body;
    
    // Validate required fields
    if (!userEmail || !quarter || sqoGoal === undefined) {
      return NextResponse.json(
        { error: 'userEmail, quarter, and sqoGoal are required' },
        { status: 400 }
      );
    }
    
    const goal = await upsertQuarterlyGoal(
      { userEmail, quarter, sqoGoal },
      session.user.email
    );
    
    return NextResponse.json({ goal });
    
  } catch (error: any) {
    console.error('[API] Error saving quarterly goal:', error);
    
    if (error.message?.includes('Invalid quarter')) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json(
      { error: 'Failed to save quarterly goal' },
      { status: 500 }
    );
  }
}

```

### Step 3.5: Verify API Routes

**Cursor.ai Prompt:**
Verify the API routes compile and lint correctly:

1. Run: `npx tsc --noEmit`
2. Run: `npm run lint`
3. Run: `npm run build`

Fix any errors before proceeding.

**Also verify the directory structure:**

```text
src/app/api/sga-hub/
├── weekly-goals/
│   └── route.ts
└── quarterly-goals/
    └── route.ts

```

### Verification Gate 3:

* [ ] `src/lib/queries/weekly-goals.ts` created
* [ ] `src/lib/queries/quarterly-goals.ts` created
* [ ] `src/app/api/sga-hub/weekly-goals/route.ts` created
* [ ] `src/app/api/sga-hub/quarterly-goals/route.ts` created
* [ ] `npx tsc --noEmit` passes
* [ ] `npm run lint` passes
* [ ] `npm run build` passes

**Checkpoint:**

```bash
git add -A && git commit -m "Phase 3: Add weekly and quarterly goals API routes"

```

---

## Phase 4: Weekly Actuals BigQuery

### Step 4.1: Create Weekly Actuals Query Function

**Cursor.ai Prompt:**
Create the BigQuery query function for weekly actuals: `src/lib/queries/weekly-actuals.ts`

Reference existing BigQuery patterns in:

* `src/lib/queries/funnel-metrics.ts`
* `src/lib/queries/detail-records.ts`

Use the `runQuery` function from `@/lib/bigquery`. Use constants from `@/config/constants.ts`.

**The query should:**

1. Get Initial Calls Scheduled grouped by week (Monday).
2. Get Qualification Calls grouped by week.
3. Get SQOs grouped by week (by Date_Became_SQO__c).
4. Filter by SGA_Owner_Name__c (exact match to `user.name`).
5. Support date range filtering.

**Code to Create (src/lib/queries/weekly-actuals.ts):**

```typescript
// src/lib/queries/weekly-actuals.ts

// ✅ VERIFIED: All imports match existing patterns
import { runQuery } from '@/lib/bigquery'; // ✅ Verified: runQuery<T>(query, params?: Record<string, any>): Promise<T[]>
import { FULL_TABLE, RECRUITING_RECORD_TYPE } from '@/config/constants'; // ✅ Verified: Constants exist
import { WeeklyActual } from '@/types/sga-hub';
import { toNumber } from '@/types/bigquery-raw'; // ✅ Verified: Helper function exists

interface RawWeeklyActualResult {
  week_start: { value: string } | string;
  initial_calls: number | null;
  qualification_calls: number | null;
  sqos: number | null;
}

/**
 * Get weekly actuals for a specific SGA
 * @param sgaName - Exact SGA_Owner_Name__c value (from user.name)
 * @param startDate - Start date for range (ISO string)
 * @param endDate - End date for range (ISO string)
 */
export async function getWeeklyActuals(
  sgaName: string,
  startDate: string,
  endDate: string
): Promise<WeeklyActual[]> {
  const query = `
    WITH initial_calls AS (
      SELECT 
        DATE_TRUNC(Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) as week_start,
        COUNT(DISTINCT primary_key) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c = @sgaName
        AND Initial_Call_Scheduled_Date__c IS NOT NULL
        AND Initial_Call_Scheduled_Date__c >= @startDate
        AND Initial_Call_Scheduled_Date__c <= @endDate
      GROUP BY week_start
    ),
    qual_calls AS (
      SELECT 
        DATE_TRUNC(Qualification_Call_Date__c, WEEK(MONDAY)) as week_start,
        COUNT(DISTINCT Full_Opportunity_ID__c) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c = @sgaName
        AND Qualification_Call_Date__c IS NOT NULL
        AND Qualification_Call_Date__c >= @startDate
        AND Qualification_Call_Date__c <= @endDate
      GROUP BY week_start
    ),
    sqos AS (
      SELECT 
        DATE(DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY))) as week_start,
        COUNT(*) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c = @sgaName
        AND is_sqo_unique = 1
        AND Date_Became_SQO__c IS NOT NULL
        AND Date_Became_SQO__c >= TIMESTAMP(@startDate)
        AND Date_Became_SQO__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
        AND recordtypeid = @recruitingRecordType
      GROUP BY week_start
    ),
    -- Generate all weeks in range
    all_weeks AS (
      SELECT week_start
      FROM UNNEST(
        GENERATE_DATE_ARRAY(
          DATE_TRUNC(DATE(@startDate), WEEK(MONDAY)),
          DATE_TRUNC(DATE(@endDate), WEEK(MONDAY)),
          INTERVAL 1 WEEK
        )
      ) as week_start
    )
    SELECT 
      aw.week_start,
      COALESCE(ic.count, 0) as initial_calls,
      COALESCE(qc.count, 0) as qualification_calls,
      COALESCE(s.count, 0) as sqos
    FROM all_weeks aw
    LEFT JOIN initial_calls ic ON aw.week_start = ic.week_start
    LEFT JOIN qual_calls qc ON aw.week_start = qc.week_start
    LEFT JOIN sqos s ON aw.week_start = s.week_start
    ORDER BY aw.week_start DESC
  `;
  
  const params = {
    sgaName,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawWeeklyActualResult>(query, params);
  
  return results.map(transformWeeklyActual);
}

/**
 * Get weekly actuals for all SGAs (admin view)
 */
export async function getAllSGAWeeklyActuals(
  startDate: string,
  endDate: string
): Promise<{ sgaName: string; actuals: WeeklyActual[] }[]> {
  const query = `
    WITH initial_calls AS (
      SELECT 
        SGA_Owner_Name__c as sga_name,
        DATE_TRUNC(Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) as week_start,
        COUNT(DISTINCT primary_key) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
        AND Initial_Call_Scheduled_Date__c IS NOT NULL
        AND Initial_Call_Scheduled_Date__c >= @startDate
        AND Initial_Call_Scheduled_Date__c <= @endDate
      GROUP BY sga_name, week_start
    ),
    qual_calls AS (
      SELECT 
        SGA_Owner_Name__c as sga_name,
        DATE_TRUNC(Qualification_Call_Date__c, WEEK(MONDAY)) as week_start,
        COUNT(DISTINCT Full_Opportunity_ID__c) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
        AND Qualification_Call_Date__c IS NOT NULL
        AND Qualification_Call_Date__c >= @startDate
        AND Qualification_Call_Date__c <= @endDate
      GROUP BY sga_name, week_start
    ),
    sqos AS (
      SELECT 
        SGA_Owner_Name__c as sga_name,
        DATE(DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY))) as week_start,
        COUNT(*) as count
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
        AND is_sqo_unique = 1
        AND Date_Became_SQO__c IS NOT NULL
        AND Date_Became_SQO__c >= TIMESTAMP(@startDate)
        AND Date_Became_SQO__c <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
        AND recordtypeid = @recruitingRecordType
      GROUP BY sga_name, week_start
    ),
    all_sgas AS (
      SELECT DISTINCT SGA_Owner_Name__c as sga_name
      FROM \`${FULL_TABLE}\`
      WHERE SGA_Owner_Name__c IS NOT NULL
    ),
    all_weeks AS (
      SELECT week_start
      FROM UNNEST(
        GENERATE_DATE_ARRAY(
          DATE_TRUNC(DATE(@startDate), WEEK(MONDAY)),
          DATE_TRUNC(DATE(@endDate), WEEK(MONDAY)),
          INTERVAL 1 WEEK
        )
      ) as week_start
    )
    SELECT 
      s.sga_name,
      aw.week_start,
      COALESCE(ic.count, 0) as initial_calls,
      COALESCE(qc.count, 0) as qualification_calls,
      COALESCE(sq.count, 0) as sqos
    FROM all_sgas s
    CROSS JOIN all_weeks aw
    LEFT JOIN initial_calls ic ON s.sga_name = ic.sga_name AND aw.week_start = ic.week_start
    LEFT JOIN qual_calls qc ON s.sga_name = qc.sga_name AND aw.week_start = qc.week_start
    LEFT JOIN sqos sq ON s.sga_name = sq.sga_name AND aw.week_start = sq.week_start
    ORDER BY s.sga_name, aw.week_start DESC
  `;
  
  const params = {
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawWeeklyActualResult & { sga_name: string }>(query, params);
  
  // Group by SGA
  const sgaMap = new Map<string, WeeklyActual[]>();
  
  for (const row of results) {
    const sgaName = row.sga_name;
    if (!sgaMap.has(sgaName)) {
      sgaMap.set(sgaName, []);
    }
    sgaMap.get(sgaName)!.push(transformWeeklyActual(row));
  }
  
  return Array.from(sgaMap.entries()).map(([sgaName, actuals]) => ({
    sgaName,
    actuals,
  }));
}

/**
 * Transform raw BigQuery result to WeeklyActual
 * week_start is always a DATE type from BigQuery (YYYY-MM-DD format)
 */
function transformWeeklyActual(row: RawWeeklyActualResult): WeeklyActual {
  let weekStartDate: string;
  if (typeof row.week_start === 'object' && 'value' in row.week_start) {
    // BigQuery DATE fields can return as { value: "YYYY-MM-DD" }
    weekStartDate = row.week_start.value.split('T')[0];
  } else if (typeof row.week_start === 'string') {
    // Direct string format "YYYY-MM-DD"
    weekStartDate = row.week_start.split('T')[0];
  } else {
    // Fallback: convert to string and extract date part
    weekStartDate = String(row.week_start).split('T')[0];
  }
  
  // Ensure format is YYYY-MM-DD (no time component)
  if (weekStartDate.length > 10) {
    weekStartDate = weekStartDate.substring(0, 10);
  }
  
  return {
    weekStartDate,
    initialCalls: toNumber(row.initial_calls) || 0,
    qualificationCalls: toNumber(row.qualification_calls) || 0,
    sqos: toNumber(row.sqos) || 0,
  };
}

```

### Step 4.2: Create Weekly Actuals API Route

**Cursor.ai Prompt:**
Create the API route for weekly actuals: `src/app/api/sga-hub/weekly-actuals/route.ts`

This route queries BigQuery and returns actuals for the logged-in SGA. Admin/Manager can query for any SGA.

**Code to Create (src/app/api/sga-hub/weekly-actuals/route.ts):**

```typescript
// src/app/api/sga-hub/weekly-actuals/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getWeeklyActuals, getAllSGAWeeklyActuals } from '@/lib/queries/weekly-actuals';
import { getDefaultWeekRange } from '@/lib/utils/sga-hub-helpers';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/sga-hub/weekly-actuals
 * Get weekly actuals from BigQuery for the logged-in user or specified SGA
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const targetUserEmail = searchParams.get('userEmail');
    const allSGAs = searchParams.get('allSGAs') === 'true';
    
    const dateRange = startDate && endDate 
      ? { startDate, endDate }
      : getDefaultWeekRange();
    
    if (allSGAs) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      
      const allActuals = await getAllSGAWeeklyActuals(
        dateRange.startDate,
        dateRange.endDate
      );
      
      return NextResponse.json({ 
        actuals: allActuals,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
      });
    }
    
    let userEmail = session.user.email;
    if (targetUserEmail) {
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { name: true },
    });
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    const actuals = await getWeeklyActuals(
      user.name,
      dateRange.startDate,
      dateRange.endDate
    );
    
    return NextResponse.json({ 
      actuals,
      sgaName: user.name,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    });
    
  } catch (error) {
    console.error('[API] Error fetching weekly actuals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch weekly actuals' },
      { status: 500 }
    );
  }
}

```

### Step 4.3: Verify BigQuery Query with MCP

**Cursor.ai Prompt:**
Use MCP to verify the weekly actuals query works correctly. Run this query with a known SGA name (e.g., 'Eleni Stefanopoulos'):

```sql
WITH initial_calls AS (
  SELECT 
    DATE_TRUNC(Initial_Call_Scheduled_Date__c, WEEK(MONDAY)) as week_start,
    COUNT(DISTINCT primary_key) as count
  FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
  WHERE SGA_Owner_Name__c = 'Eleni Stefanopoulos'
    AND Initial_Call_Scheduled_Date__c IS NOT NULL
    AND Initial_Call_Scheduled_Date__c >= '2025-01-01'
    AND Initial_Call_Scheduled_Date__c <= '2026-01-31'
  GROUP BY week_start
)
SELECT * FROM initial_calls ORDER BY week_start DESC LIMIT 10

```

**Verify:**

1. Query executes without errors.
2. Returns expected week_start dates (Mondays).
3. Counts look reasonable.
4. Week_start values are DATE type (YYYY-MM-DD format, no time component).

**✅ VERIFIED:** BigQuery field types:
- `Initial_Call_Scheduled_Date__c`: DATE (direct comparison, no TIMESTAMP wrapper)
- `Qualification_Call_Date__c`: DATE (direct comparison, no TIMESTAMP wrapper)
- `Date_Became_SQO__c`: TIMESTAMP (requires TIMESTAMP wrapper)
- `is_sqo_unique`: INT64 (0 or 1, not BOOLEAN)
- `SGA_Owner_Name__c`: STRING (exact match required)
- `primary_key`: STRING (Lead ID format: 00Q... or Opp ID: 006...)
- `Full_Opportunity_ID__c`: STRING (nullable)

**Also test the SQO query separately:**
```sql
SELECT 
  DATE(DATE_TRUNC(Date_Became_SQO__c, WEEK(MONDAY))) as week_start,
  COUNT(*) as count
FROM `savvy-gtm-analytics.Tableau_Views.vw_funnel_master`
WHERE SGA_Owner_Name__c = 'Eleni Stefanopoulos'
  AND is_sqo_unique = 1
  AND Date_Became_SQO__c IS NOT NULL
  AND Date_Became_SQO__c >= TIMESTAMP('2025-01-01')
  AND Date_Became_SQO__c <= TIMESTAMP('2026-01-31 23:59:59')
  AND recordtypeid = '012Dn000000mrO3IAI'
GROUP BY week_start
ORDER BY week_start DESC
LIMIT 5
```

**Verify:**
- `DATE(DATE_TRUNC(...))` correctly converts TIMESTAMP to DATE
- Week_start values match DATE format (no time component)
- Counts are reasonable

### Verification Gate 4:

* [ ] `src/lib/queries/weekly-actuals.ts` created
* [ ] `src/app/api/sga-hub/weekly-actuals/route.ts` created
* [ ] BigQuery query verified with MCP
* [ ] `npx tsc --noEmit` passes
* [ ] `npm run lint` passes

**Checkpoint:**

```bash
git add -A && git commit -m "Phase 4: Add weekly actuals BigQuery queries and API route"

```

---

## Phase 5: SGA Hub Page - Weekly Goals Tab

### Step 5.1: Create API Client Functions

**Cursor.ai Prompt:**
Add SGA Hub API client functions to `src/lib/api-client.ts`. Include: `getWeeklyGoals`, `saveWeeklyGoal`, `getWeeklyActuals`, `getQuarterlyGoals`, `saveQuarterlyGoal`, `getClosedLostRecords`, `getQuarterlyProgress`, and `getSQODetails`.

**Reference existing patterns in `src/lib/api-client.ts`:**
- Use `apiFetch<T>()` helper function
- Follow the same structure as `dashboardApi` object
- Use POST for requests with body, GET for query params
- Handle errors with `ApiError` class

**Functions to add to `dashboardApi` object:**
```typescript
// Weekly Goals
getWeeklyGoals: (startDate?: string, endDate?: string, userEmail?: string) =>
  apiFetch<{ goals: WeeklyGoal[] }>(`/api/sga-hub/weekly-goals?${new URLSearchParams({ 
    ...(startDate && { startDate }), 
    ...(endDate && { endDate }),
    ...(userEmail && { userEmail })
  }).toString()}`),

saveWeeklyGoal: (goal: WeeklyGoalInput, userEmail?: string) =>
  apiFetch<{ goal: WeeklyGoal }>('/api/sga-hub/weekly-goals', {
    method: 'POST',
    body: JSON.stringify({ ...goal, ...(userEmail && { userEmail }) }),
  }),

// Weekly Actuals
getWeeklyActuals: (startDate?: string, endDate?: string, userEmail?: string) =>
  apiFetch<{ actuals: WeeklyActual[]; sgaName?: string; startDate: string; endDate: string }>(
    `/api/sga-hub/weekly-actuals?${new URLSearchParams({ 
      ...(startDate && { startDate }), 
      ...(endDate && { endDate }),
      ...(userEmail && { userEmail })
    }).toString()}`
  ),

// Quarterly Goals
getQuarterlyGoals: (quarter?: string, userEmail?: string) =>
  apiFetch<{ goals: QuarterlyGoal[]; quarter?: string }>(
    `/api/sga-hub/quarterly-goals?${new URLSearchParams({ 
      ...(quarter && { quarter }), 
      ...(userEmail && { userEmail })
    }).toString()}`
  ),

saveQuarterlyGoal: (input: QuarterlyGoalInput) =>
  apiFetch<{ goal: QuarterlyGoal }>('/api/sga-hub/quarterly-goals', {
    method: 'POST',
    body: JSON.stringify(input),
  }),

// Closed Lost
getClosedLostRecords: (timeBuckets?: ClosedLostTimeBucket[]) =>
  apiFetch<{ records: ClosedLostRecord[] }>('/api/sga-hub/closed-lost', {
    method: 'POST',
    body: JSON.stringify({ timeBuckets: timeBuckets || ['all'] }),
  }),

// Quarterly Progress
getQuarterlyProgress: (quarter?: string) =>
  apiFetch<QuarterlyProgress>(
    `/api/sga-hub/quarterly-progress?${new URLSearchParams({ 
      ...(quarter && { quarter })
    }).toString()}`
  ),

// SQO Details
getSQODetails: (quarter: string) =>
  apiFetch<{ sqos: SQODetail[] }>(
    `/api/sga-hub/sqo-details?${new URLSearchParams({ quarter }).toString()}`
  ),
```

### Step 5.2: Create Weekly Goals Table Component

**Cursor.ai Prompt:**
Create `src/components/sga-hub/WeeklyGoalsTable.tsx`. Include goal vs actual display, differences with color coding (green ≥ 0, red < 0), and an edit button for each row.

**Important Logic:**
- Use `canEdit` property from `WeeklyGoalWithActuals` to determine if edit button should be enabled
- For SGAs: `canEdit = isCurrentWeek || isFutureWeek` (use `getWeekInfo()` helper)
- For Admins: `canEdit = true` (can edit any week)
- Disable edit button and show tooltip if `!canEdit`
- Display differences: `actual - goal` (positive = green, negative = red, null if no goal)

### Step 5.3: Create Weekly Goal Editor Modal

**Cursor.ai Prompt:**
Create `src/components/sga-hub/WeeklyGoalEditor.tsx`. Include form validation for non-negative integers and a loading state during save.

### Step 5.4: Create SGA Hub Tabs Component

**Cursor.ai Prompt:**
Create `src/components/sga-hub/SGAHubTabs.tsx`. Switch between Weekly Goals, Closed Lost Follow-Up, and Quarterly Progress.

### Step 5.5: Create SGA Hub Page

**Cursor.ai Prompt:**
Create `src/app/dashboard/sga-hub/page.tsx`. Ensure session check and role redirection for non-SGA/Admin users.

### Step 5.6: Create SGA Hub Content Client Component

**Cursor.ai Prompt:**
Create `src/app/dashboard/sga-hub/SGAHubContent.tsx`. Handle tab switching, date range state, and data fetching for the weekly view.

### Verification Gate 5:

* [ ] All components created in `src/components/sga-hub/`
* [ ] SGA Hub page created at `src/app/dashboard/sga-hub/`
* [ ] API client functions added
* [ ] `npx tsc --noEmit` passes
* [ ] Page loads in browser

**Checkpoint:**

```bash
git add -A && git commit -m "Phase 5: Add SGA Hub page with Weekly Goals tab"

```

---

## Phase 6: Closed Lost Tab

### Step 6.1: Create Closed Lost Query Function

**Cursor.ai Prompt:**
Create `src/lib/queries/closed-lost.ts`. Query `vw_sga_closed_lost_sql_followup`, filter by SGA name, and calculate days since contact.

**Important Notes:**
- ✅ VERIFIED: View exists at `savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup`
- ✅ VERIFIED: Filter by `sga_name` field (exact match to `user.name`) - field exists as STRING
- ✅ VERIFIED: View has `time_since_last_contact_bucket` field (STRING type) for filtering (30-60, 60-90, 90-120, 120-150, 150-180 days)
- ✅ VERIFIED: View has both `Full_prospect_id__c` and `Full_Opportunity_ID__c` for URL construction
- ✅ VERIFIED: `salesforce_url` field exists (Opportunity URL)
- Need to construct `lead_url` from `Full_prospect_id__c`: `CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', Full_prospect_id__c, '/view')`

**Code to Create (src/lib/queries/closed-lost.ts):**

```typescript
// src/lib/queries/closed-lost.ts

import { runQuery } from '@/lib/bigquery';
import { ClosedLostRecord, ClosedLostTimeBucket } from '@/types/sga-hub';
import { toString, toNumber } from '@/types/bigquery-raw';

const CLOSED_LOST_VIEW = 'savvy-gtm-analytics.savvy_analytics.vw_sga_closed_lost_sql_followup';

/**
 * Raw BigQuery result interface matching the view columns
 */
interface RawClosedLostResult {
  id: string; // Full_Opportunity_ID__c
  opp_name: string | null;
  lead_id: string | null; // Full_prospect_id__c
  opportunity_id: string; // Full_Opportunity_ID__c
  lead_url: string | null; // Constructed in query
  opportunity_url: string | null; // salesforce_url
  salesforce_url: string | null;
  last_contact_date: string | null; // Last_Contact_Date__c (DATE field)
  closed_lost_date: string | null; // Closed_Lost_Date__c (DATE field)
  sql_date: string | null; // SQL_Date__c (DATE field)
  closed_lost_reason: string | null; // Closed_Lost_Reason__c
  closed_lost_details: string | null; // Closed_Lost_Details__c
  time_since_last_contact_bucket: string | null; // time_since_last_contact_bucket
  days_since_contact: number | null; // Days_Since_Last_Contact__c
}

/**
 * Map time bucket values from UI format to view format
 * View may have values like "1 month since last contact", "30-60 days", etc.
 * We need to handle both formats
 */
function normalizeTimeBucket(bucket: ClosedLostTimeBucket): string[] {
  if (bucket === 'all') {
    return []; // Empty array means no filter
  }
  
  // Map UI bucket values to possible view values
  // The view may have different formats, so we include common variations
  const bucketMap: Record<string, string[]> = {
    '30-60': ['30-60', '30-60 days', '1 month since last contact'],
    '60-90': ['60-90', '60-90 days', '2 months since last contact'],
    '90-120': ['90-120', '90-120 days', '3 months since last contact'],
    '120-150': ['120-150', '120-150 days', '4 months since last contact'],
    '150-180': ['150-180', '150-180 days', '5 months since last contact'],
  };
  
  return bucketMap[bucket] || [bucket];
}

/**
 * Get closed lost records for a specific SGA
 * @param sgaName - Exact SGA name (from user.name, matches sga_name in view)
 * @param timeBuckets - Optional array of time buckets to filter by ('all' means no filter)
 */
export async function getClosedLostRecords(
  sgaName: string,
  timeBuckets?: ClosedLostTimeBucket[]
): Promise<ClosedLostRecord[]> {
  // Build WHERE conditions
  const conditions: string[] = [`sga_name = @sgaName`];
  const params: Record<string, any> = { sgaName };
  
  // Handle time bucket filtering
  if (timeBuckets && timeBuckets.length > 0 && !timeBuckets.includes('all')) {
    // Flatten all possible bucket values
    const allBucketValues: string[] = [];
    for (const bucket of timeBuckets) {
      allBucketValues.push(...normalizeTimeBucket(bucket));
    }
    
    if (allBucketValues.length > 0) {
      // Use IN with UNNEST for array parameter
      conditions.push('time_since_last_contact_bucket IN UNNEST(@timeBuckets)');
      params.timeBuckets = allBucketValues;
    }
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const query = `
    SELECT 
      Full_Opportunity_ID__c as id,
      Opp_Name__c as opp_name,
      Full_prospect_id__c as lead_id,
      Full_Opportunity_ID__c as opportunity_id,
      CASE 
        WHEN Full_prospect_id__c IS NOT NULL 
        THEN CONCAT('https://savvywealth.lightning.force.com/lightning/r/Lead/', Full_prospect_id__c, '/view')
        ELSE NULL
      END as lead_url,
      salesforce_url as opportunity_url,
      salesforce_url,
      Last_Contact_Date__c as last_contact_date,
      Closed_Lost_Date__c as closed_lost_date,
      SQL_Date__c as sql_date,
      Closed_Lost_Reason__c as closed_lost_reason,
      Closed_Lost_Details__c as closed_lost_details,
      time_since_last_contact_bucket,
      Days_Since_Last_Contact__c as days_since_contact
    FROM \`${CLOSED_LOST_VIEW}\`
    ${whereClause}
    ORDER BY closed_lost_date DESC, last_contact_date DESC
  `;
  
  const results = await runQuery<RawClosedLostResult>(query, params);
  
  return results.map(transformClosedLostRecord);
}

/**
 * Transform raw BigQuery result to ClosedLostRecord
 */
function transformClosedLostRecord(row: RawClosedLostResult): ClosedLostRecord {
  // Extract date values (DATE fields return as strings in YYYY-MM-DD format)
  const lastContactDate = row.last_contact_date 
    ? toString(row.last_contact_date).split('T')[0] // Ensure YYYY-MM-DD format
    : '';
  
  const closedLostDate = row.closed_lost_date 
    ? toString(row.closed_lost_date).split('T')[0]
    : '';
  
  const sqlDate = row.sql_date 
    ? toString(row.sql_date).split('T')[0]
    : '';
  
  // Extract lead URL (constructed in query or null)
  const leadUrl = row.lead_url ? toString(row.lead_url) : null;
  
  // Use opportunity_url (salesforce_url) as primary salesforceUrl
  // Fallback to constructed URL if needed
  const salesforceUrl = row.salesforce_url 
    ? toString(row.salesforce_url)
    : (row.opportunity_id 
        ? `https://savvywealth.lightning.force.com/lightning/r/Opportunity/${row.opportunity_id}/view`
        : '');
  
  const opportunityUrl = row.opportunity_url || salesforceUrl;
  
  return {
    id: toString(row.id),
    oppName: toString(row.opp_name) || 'Unknown',
    leadId: row.lead_id ? toString(row.lead_id) : null,
    opportunityId: toString(row.opportunity_id),
    leadUrl,
    opportunityUrl,
    salesforceUrl,
    lastContactDate,
    closedLostDate,
    sqlDate,
    closedLostReason: toString(row.closed_lost_reason) || 'Unknown',
    closedLostDetails: row.closed_lost_details ? toString(row.closed_lost_details) : null,
    timeSinceContactBucket: toString(row.time_since_last_contact_bucket) || 'Unknown',
    daysSinceContact: toNumber(row.days_since_contact),
  };
}
```

### Step 6.2: Create Closed Lost API Route

**Cursor.ai Prompt:**
Create `src/app/api/sga-hub/closed-lost/route.ts` to return records for the logged-in SGA.

**Code to Create (src/app/api/sga-hub/closed-lost/route.ts):**

```typescript
// src/app/api/sga-hub/closed-lost/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getClosedLostRecords } from '@/lib/queries/closed-lost';
import { ClosedLostTimeBucket } from '@/types/sga-hub';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/sga-hub/closed-lost
 * Get closed lost records for the logged-in SGA or specified SGA (admin/manager only)
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const permissions = await getUserPermissions(session.user.email);
    
    // Check role permissions
    if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    // Parse query params
    const { searchParams } = new URL(request.url);
    const targetUserEmail = searchParams.get('userEmail'); // Admin/manager only
    const timeBucketsParam = searchParams.get('timeBuckets'); // Comma-separated or single value
    
    // Determine which user's records to fetch
    let userEmail = session.user.email;
    
    if (targetUserEmail) {
      // Only admin/manager can view other users' records
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA role can only view own records
      if (permissions.role === 'sga' && userEmail !== session.user.email) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    
    // Get user to retrieve name for BigQuery filter
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { name: true },
    });
    
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    
    // Parse timeBuckets parameter
    let timeBuckets: ClosedLostTimeBucket[] | undefined;
    
    if (timeBucketsParam) {
      // Handle comma-separated string or single value
      const buckets = timeBucketsParam.split(',').map(b => b.trim()) as ClosedLostTimeBucket[];
      // Validate buckets are valid ClosedLostTimeBucket values
      const validBuckets: ClosedLostTimeBucket[] = ['30-60', '60-90', '90-120', '120-150', '150-180', 'all'];
      timeBuckets = buckets.filter(b => validBuckets.includes(b));
      
      // If no valid buckets, default to all
      if (timeBuckets.length === 0) {
        timeBuckets = ['30-60', '60-90', '90-120', '120-150', '150-180'];
      }
    } else {
      // Default to all buckets if not specified
      timeBuckets = ['30-60', '60-90', '90-120', '120-150', '150-180'];
    }
    
    // Fetch closed lost records
    const records = await getClosedLostRecords(user.name, timeBuckets);
    
    return NextResponse.json({ records });
    
  } catch (error) {
    console.error('[API] Error fetching closed lost records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch closed lost records' },
      { status: 500 }
    );
  }
}
```

### Step 6.3: Create Closed Lost Table Component

**Cursor.ai Prompt:**
Create `src/components/sga-hub/ClosedLostTable.tsx`. Add sortable columns, multi-select bucket filters, and Salesforce links.

**Code to Create (src/components/sga-hub/ClosedLostTable.tsx):**

```typescript
// src/components/sga-hub/ClosedLostTable.tsx

'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Button } from '@tremor/react';
import { ClosedLostRecord, ClosedLostTimeBucket } from '@/types/sga-hub';
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type SortColumn = 'oppName' | 'lastContactDate' | 'daysSinceContact' | 'closedLostDate' | 'closedLostReason' | 'timeBucket' | null;
type SortDirection = 'asc' | 'desc';

interface ClosedLostTableProps {
  records: ClosedLostRecord[];
  isLoading?: boolean;
  onRecordClick?: (record: ClosedLostRecord) => void;
}

/**
 * Get color class for time bucket badge (older = more urgent/red)
 */
function getTimeBucketColor(bucket: string): string {
  const normalized = bucket.toLowerCase();
  
  // Check for days ranges
  if (normalized.includes('150') || normalized.includes('180') || normalized.includes('5 month')) {
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'; // Most urgent
  }
  if (normalized.includes('120') || normalized.includes('150') || normalized.includes('4 month')) {
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
  }
  if (normalized.includes('90') || normalized.includes('120') || normalized.includes('3 month')) {
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  }
  if (normalized.includes('60') || normalized.includes('90') || normalized.includes('2 month')) {
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
  }
  if (normalized.includes('30') || normalized.includes('60') || normalized.includes('1 month')) {
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'; // Least urgent
  }
  
  // Default
  return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
}

/**
 * Get row background color based on time bucket (older = more urgent/red tint)
 */
function getRowColorClass(bucket: string, index: number): string {
  const normalized = bucket.toLowerCase();
  const baseColor = index % 2 === 0 
    ? 'bg-white dark:bg-gray-800' 
    : 'bg-gray-50 dark:bg-gray-900';
  
  // Add subtle tint for older buckets
  if (normalized.includes('150') || normalized.includes('180') || normalized.includes('5 month')) {
    return `${baseColor} hover:bg-red-50 dark:hover:bg-red-950/20`;
  }
  if (normalized.includes('120') || normalized.includes('150') || normalized.includes('4 month')) {
    return `${baseColor} hover:bg-orange-50 dark:hover:bg-orange-950/20`;
  }
  
  return `${baseColor} hover:bg-gray-100 dark:hover:bg-gray-700`;
}

/**
 * Sort records based on column and direction
 */
function sortRecords(records: ClosedLostRecord[], sortColumn: SortColumn, sortDirection: SortDirection): ClosedLostRecord[] {
  if (!sortColumn) return records;
  
  return [...records].sort((a, b) => {
    let comparison = 0;
    
    switch (sortColumn) {
      case 'oppName':
        comparison = (a.oppName || '').toLowerCase().localeCompare((b.oppName || '').toLowerCase());
        break;
      case 'lastContactDate':
        const aLastContact = a.lastContactDate ? new Date(a.lastContactDate).getTime() : 0;
        const bLastContact = b.lastContactDate ? new Date(b.lastContactDate).getTime() : 0;
        comparison = aLastContact - bLastContact;
        break;
      case 'daysSinceContact':
        comparison = (a.daysSinceContact || 0) - (b.daysSinceContact || 0);
        break;
      case 'closedLostDate':
        const aClosed = a.closedLostDate ? new Date(a.closedLostDate).getTime() : 0;
        const bClosed = b.closedLostDate ? new Date(b.closedLostDate).getTime() : 0;
        comparison = aClosed - bClosed;
        break;
      case 'closedLostReason':
        comparison = (a.closedLostReason || '').toLowerCase().localeCompare((b.closedLostReason || '').toLowerCase());
        break;
      case 'timeBucket':
        comparison = (a.timeSinceContactBucket || '').toLowerCase().localeCompare((b.timeSinceContactBucket || '').toLowerCase());
        break;
    }
    
    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function ClosedLostTable({ records, isLoading = false, onRecordClick }: ClosedLostTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('daysSinceContact'); // Default sort by days since contact
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc'); // Default descending (most urgent first)
  const [selectedBuckets, setSelectedBuckets] = useState<Set<string>>(new Set()); // Empty = show all
  
  // Available time buckets from records
  const availableBuckets = useMemo(() => {
    const buckets = new Set<string>();
    records.forEach(record => {
      if (record.timeSinceContactBucket) {
        buckets.add(record.timeSinceContactBucket);
      }
    });
    return Array.from(buckets).sort();
  }, [records]);
  
  // Filter records by selected buckets
  const filteredRecords = useMemo(() => {
    if (selectedBuckets.size === 0) {
      return records; // Show all if no filter selected
    }
    return records.filter(record => 
      record.timeSinceContactBucket && selectedBuckets.has(record.timeSinceContactBucket)
    );
  }, [records, selectedBuckets]);
  
  // Sort filtered records
  const sortedRecords = useMemo(() => {
    return sortRecords(filteredRecords, sortColumn, sortDirection);
  }, [filteredRecords, sortColumn, sortDirection]);
  
  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (column === null) return;
    
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to descending for dates/numbers, ascending for text
      setSortColumn(column);
      if (column === 'daysSinceContact' || column === 'lastContactDate' || column === 'closedLostDate') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };
  
  // Toggle bucket filter
  const toggleBucket = (bucket: string) => {
    setSelectedBuckets(prev => {
      const next = new Set(prev);
      if (next.has(bucket)) {
        next.delete(bucket);
      } else {
        next.add(bucket);
      }
      return next;
    });
  };
  
  // Sortable header cell component
  const SortableHeader = ({ column, children, alignRight = false }: { column: SortColumn; children: React.ReactNode; alignRight?: boolean }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';
    
    return (
      <TableHeaderCell 
        className={`border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 ${
          column !== null ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none' : ''
        } ${alignRight ? 'text-right' : ''}`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : ''}`}>
          {children}
          {column !== null && (
            <div className="flex flex-col">
              <ChevronUp 
                className={`w-3 h-3 ${showAsc ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`} 
              />
              <ChevronDown 
                className={`w-3 h-3 -mt-1 ${showDesc ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`} 
              />
            </div>
          )}
        </div>
      </TableHeaderCell>
    );
  };
  
  if (isLoading) {
    return (
      <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
        <div className="py-12">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }
  
  return (
    <Card className="mb-6 dark:bg-gray-800 dark:border-gray-700">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Closed Lost Follow-Up Records
        </h3>
        
        {/* Time Bucket Filter */}
        {availableBuckets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">Filter by time bucket:</span>
            {availableBuckets.map(bucket => {
              const isSelected = selectedBuckets.size === 0 || selectedBuckets.has(bucket);
              return (
                <button
                  key={bucket}
                  onClick={() => toggleBucket(bucket)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    isSelected
                      ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border border-blue-300 dark:border-blue-700'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {bucket}
                </button>
              );
            })}
            {selectedBuckets.size > 0 && (
              <button
                onClick={() => setSelectedBuckets(new Set())}
                className="px-3 py-1 rounded-md text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 underline"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHead>
            <TableRow>
              <SortableHeader column="oppName">Opportunity Name</SortableHeader>
              <SortableHeader column="lastContactDate">Last Contact Date</SortableHeader>
              <SortableHeader column="daysSinceContact" alignRight>Days Since Contact</SortableHeader>
              <SortableHeader column="closedLostDate">Closed Lost Date</SortableHeader>
              <SortableHeader column="closedLostReason">Closed Lost Reason</SortableHeader>
              <SortableHeader column="timeBucket">Time Bucket</SortableHeader>
              <TableHeaderCell className="text-gray-600 dark:text-gray-400">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedRecords.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-gray-500 dark:text-gray-400 py-8">
                  {selectedBuckets.size > 0 
                    ? 'No records found matching selected time buckets' 
                    : 'No closed lost records found'}
                </TableCell>
              </TableRow>
            ) : (
              sortedRecords.map((record, idx) => (
                <TableRow 
                  key={record.id}
                  className={`${getRowColorClass(record.timeSinceContactBucket, idx)} transition-colors ${
                    onRecordClick ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => onRecordClick?.(record)}
                >
                  <TableCell className="font-medium border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                    {record.oppName || 'Unknown'}
                  </TableCell>
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {formatDate(record.lastContactDate) || '-'}
                  </TableCell>
                  <TableCell className="text-right font-semibold border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                    {record.daysSinceContact || 0}
                  </TableCell>
                  <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {formatDate(record.closedLostDate) || '-'}
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                    {record.closedLostReason || 'Unknown'}
                  </TableCell>
                  <TableCell className="border-r border-gray-200 dark:border-gray-700">
                    <Badge 
                      size="xs" 
                      className={getTimeBucketColor(record.timeSinceContactBucket)}
                    >
                      {record.timeSinceContactBucket || 'Unknown'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {record.leadUrl && (
                        <a
                          href={record.leadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs"
                          title="View Lead"
                        >
                          Lead <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {record.opportunityUrl && (
                        <a
                          href={record.opportunityUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-xs"
                          title="View Opportunity"
                        >
                          Opp <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      
      {sortedRecords.length > 0 && (
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Showing {sortedRecords.length} record{sortedRecords.length !== 1 ? 's' : ''}
          {selectedBuckets.size > 0 && (
            <span className="ml-2 text-blue-600 dark:text-blue-400">
              (filtered from {records.length} total)
            </span>
          )}
          {sortColumn && (
            <span className="ml-2 text-blue-600 dark:text-blue-400">
              (sorted by {sortColumn} {sortDirection === 'asc' ? '↑' : '↓'})
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
```

### Step 6.4: Update SGA Hub Content for Closed Lost Tab

**Cursor.ai Prompt:**
Integrate `ClosedLostTable` into `SGAHubContent.tsx`. Add `RecordDetailModal` for record drilldown.

### Verification Gate 6:

* [ ] BigQuery query verified with MCP
* [ ] `ClosedLostTable` functional
* [ ] Detail modal drilldown working
* [ ] `npm run build` passes

**Checkpoint:**

```bash
git add -A && git commit -m "Phase 6: Add Closed Lost Follow-Up tab with filtering and detail modal"

```

---

## Phase 7: Quarterly Progress Tab

### Step 7.1: Create Quarterly Progress Query

**Cursor.ai Prompt:**
Create `src/lib/queries/quarterly-progress.ts` for SQO counts, AUM, and detailed SQO records.

**Code to Create (src/lib/queries/quarterly-progress.ts):**

```typescript
// src/lib/queries/quarterly-progress.ts

import { runQuery } from '@/lib/bigquery';
import { SQODetail } from '@/types/sga-hub';
import { toNumber, toString } from '@/types/bigquery-raw';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { FULL_TABLE, RECRUITING_RECORD_TYPE, MAPPING_TABLE } from '@/config/constants';
import { getQuarterInfo } from '@/lib/utils/sga-hub-helpers';

/**
 * Raw BigQuery result for quarterly SQO count
 */
interface RawQuarterlySQOCount {
  quarter: string;
  sqo_count: number | null;
  total_aum: number | null;
}

/**
 * Raw BigQuery result for SQO detail record
 */
interface RawSQODetailResult {
  id: string; // primary_key
  advisor_name: string | null;
  sqo_date: string | null; // Date_Became_SQO__c (TIMESTAMP, formatted as DATE)
  aum: number | null; // Opportunity_AUM
  aum_tier: string | null;
  channel: string | null; // Channel_Grouping_Name
  source: string | null; // Original_source
  stage_name: string | null; // StageName
  lead_id: string | null; // Full_prospect_id__c
  opportunity_id: string | null; // Full_Opportunity_ID__c
  salesforce_url: string | null;
}

/**
 * Get quarterly SQO count and total AUM for a specific SGA and quarter
 * @param sgaName - Exact SGA name (from user.name, matches SGA_Owner_Name__c)
 * @param quarter - Quarter string in format "YYYY-QN" (e.g., "2025-Q1")
 */
export async function getQuarterlySQOCount(
  sgaName: string,
  quarter: string
): Promise<{ sqoCount: number; totalAum: number }> {
  const quarterInfo = getQuarterInfo(quarter);
  const startDate = quarterInfo.startDate; // YYYY-MM-DD
  const endDate = quarterInfo.endDate; // YYYY-MM-DD
  
  const query = `
    SELECT 
      CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) as quarter,
      COUNT(*) as sqo_count,
      SUM(v.Opportunity_AUM) as total_aum
    FROM \`${FULL_TABLE}\` v
    WHERE v.SGA_Owner_Name__c = @sgaName
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = @recruitingRecordType
      AND v.Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      AND CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) = @quarter
    GROUP BY quarter
  `;
  
  const params = {
    sgaName,
    quarter,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawQuarterlySQOCount>(query, params);
  
  if (results.length === 0) {
    return { sqoCount: 0, totalAum: 0 };
  }
  
  const result = results[0];
  return {
    sqoCount: toNumber(result.sqo_count),
    totalAum: toNumber(result.total_aum),
  };
}

/**
 * Get detailed SQO records for a specific SGA and quarter
 * @param sgaName - Exact SGA name (from user.name, matches SGA_Owner_Name__c)
 * @param quarter - Quarter string in format "YYYY-QN" (e.g., "2025-Q1")
 */
export async function getQuarterlySQODetails(
  sgaName: string,
  quarter: string
): Promise<SQODetail[]> {
  const quarterInfo = getQuarterInfo(quarter);
  const startDate = quarterInfo.startDate; // YYYY-MM-DD
  const endDate = quarterInfo.endDate; // YYYY-MM-DD
  
  const query = `
    SELECT 
      v.primary_key as id,
      v.advisor_name,
      FORMAT_TIMESTAMP('%Y-%m-%d', v.Date_Became_SQO__c) as sqo_date,
      v.Opportunity_AUM as aum,
      v.aum_tier,
      COALESCE(nm.Channel_Grouping_Name, v.Channel_Grouping_Name, 'Other') as channel,
      v.Original_source as source,
      v.StageName as stage_name,
      v.Full_prospect_id__c as lead_id,
      v.Full_Opportunity_ID__c as opportunity_id,
      v.salesforce_url
    FROM \`${FULL_TABLE}\` v
    LEFT JOIN \`${MAPPING_TABLE}\` nm ON v.Original_source = nm.original_source
    WHERE v.SGA_Owner_Name__c = @sgaName
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = @recruitingRecordType
      AND v.Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      AND CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) = @quarter
    ORDER BY v.Date_Became_SQO__c DESC, v.Opportunity_AUM DESC
  `;
  
  const params = {
    sgaName,
    quarter,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawSQODetailResult>(query, params);
  
  return results.map(transformSQODetail);
}

/**
 * Get quarterly progress for multiple quarters for a specific SGA
 * @param sgaName - Exact SGA name (from user.name, matches SGA_Owner_Name__c)
 * @param quarters - Array of quarter strings in format "YYYY-QN" (e.g., ["2025-Q1", "2025-Q2"])
 */
export async function getQuarterlyProgressForSGA(
  sgaName: string,
  quarters: string[]
): Promise<Array<{ quarter: string; sqoCount: number; totalAum: number }>> {
  if (quarters.length === 0) {
    return [];
  }
  
  // Build date range from first to last quarter
  const quarterInfos = quarters.map(q => getQuarterInfo(q)).sort((a, b) => 
    a.startDate.localeCompare(b.startDate)
  );
  const startDate = quarterInfos[0].startDate;
  const endDate = quarterInfos[quarterInfos.length - 1].endDate;
  
  const query = `
    SELECT 
      CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) as quarter,
      COUNT(*) as sqo_count,
      SUM(v.Opportunity_AUM) as total_aum
    FROM \`${FULL_TABLE}\` v
    WHERE v.SGA_Owner_Name__c = @sgaName
      AND v.is_sqo_unique = 1
      AND v.recordtypeid = @recruitingRecordType
      AND v.Date_Became_SQO__c IS NOT NULL
      AND TIMESTAMP(v.Date_Became_SQO__c) >= TIMESTAMP(@startDate)
      AND TIMESTAMP(v.Date_Became_SQO__c) <= TIMESTAMP(CONCAT(@endDate, ' 23:59:59'))
      AND CONCAT(
        CAST(EXTRACT(YEAR FROM v.Date_Became_SQO__c) AS STRING), 
        '-Q', 
        CAST(EXTRACT(QUARTER FROM v.Date_Became_SQO__c) AS STRING)
      ) IN UNNEST(@quarters)
    GROUP BY quarter
    ORDER BY quarter DESC
  `;
  
  const params = {
    sgaName,
    quarters,
    startDate,
    endDate,
    recruitingRecordType: RECRUITING_RECORD_TYPE,
  };
  
  const results = await runQuery<RawQuarterlySQOCount>(query, params);
  
  // Map results to include all requested quarters (with 0s for missing ones)
  const resultMap = new Map<string, { sqoCount: number; totalAum: number }>();
  results.forEach(r => {
    resultMap.set(r.quarter, {
      sqoCount: toNumber(r.sqo_count),
      totalAum: toNumber(r.total_aum),
    });
  });
  
  return quarters.map(quarter => ({
    quarter,
    sqoCount: resultMap.get(quarter)?.sqoCount || 0,
    totalAum: resultMap.get(quarter)?.totalAum || 0,
  }));
}

/**
 * Transform raw BigQuery result to SQODetail
 */
function transformSQODetail(row: RawSQODetailResult): SQODetail {
  // Extract SQO date (formatted as YYYY-MM-DD from FORMAT_TIMESTAMP)
  const sqoDate = row.sqo_date ? toString(row.sqo_date).split('T')[0] : '';
  
  // Build Salesforce URLs
  const leadUrl = row.lead_id 
    ? `https://savvywealth.lightning.force.com/lightning/r/Lead/${row.lead_id}/view`
    : null;
  
  const opportunityUrl = row.opportunity_id
    ? `https://savvywealth.lightning.force.com/lightning/r/Opportunity/${row.opportunity_id}/view`
    : null;
  
  // Use salesforce_url if available, otherwise construct from opportunity_id
  const salesforceUrl = row.salesforce_url 
    ? toString(row.salesforce_url)
    : (opportunityUrl || '');
  
  const aum = toNumber(row.aum);
  
  return {
    id: toString(row.id),
    advisorName: toString(row.advisor_name) || 'Unknown',
    sqoDate,
    aum,
    aumFormatted: formatCurrency(aum),
    aumTier: toString(row.aum_tier) || 'Unknown',
    channel: toString(row.channel) || 'Unknown',
    source: toString(row.source) || 'Unknown',
    stageName: toString(row.stage_name) || 'Unknown',
    leadUrl,
    opportunityUrl,
    salesforceUrl,
  };
}
```

### Step 7.2: Create Quarterly Progress API Route

**Cursor.ai Prompt:**
Create API routes for quarterly progress and SQO details.

**Code to Create (src/app/api/sga-hub/quarterly-progress/route.ts):**

```typescript
// src/app/api/sga-hub/quarterly-progress/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getQuarterlySQOCount } from '@/lib/queries/quarterly-progress';
import { getQuarterlyGoal } from '@/lib/queries/quarterly-goals';
import { calculateQuarterPacing, getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { prisma } from '@/lib/prisma';
import { QuarterlyProgress } from '@/types/sga-hub';

/**
 * GET /api/sga-hub/quarterly-progress
 * Get quarterly progress with pacing calculation for the logged-in user or specified SGA
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    // Parse query params
    const { searchParams } = new URL(request.url);
    const quarter = searchParams.get('quarter') || getCurrentQuarter();
    const targetUserEmail = searchParams.get('userEmail');

    // Determine target user
    let userEmail = session.user.email;

    if (targetUserEmail) {
      // Admin/Manager can view any SGA's progress
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA can only view their own progress
      if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Get user's name (matches SGA_Owner_Name__c in BigQuery)
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch SQO count and AUM from BigQuery
    const { sqoCount, totalAum } = await getQuarterlySQOCount(user.name, quarter);

    // Fetch quarterly goal from Prisma
    const goal = await getQuarterlyGoal(userEmail, quarter);
    const sqoGoal = goal?.sqoGoal || null;

    // Calculate pacing using helper function
    const progress: QuarterlyProgress = calculateQuarterPacing(
      quarter,
      sqoGoal,
      sqoCount,
      totalAum,
      formatCurrency
    );

    return NextResponse.json(progress);

  } catch (error) {
    console.error('[API] Error fetching quarterly progress:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quarterly progress' },
      { status: 500 }
    );
  }
}
```

**Code to Create (src/app/api/sga-hub/sqo-details/route.ts):**

```typescript
// src/app/api/sga-hub/sqo-details/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { getQuarterlySQODetails } from '@/lib/queries/quarterly-progress';
import { getCurrentQuarter } from '@/lib/utils/sga-hub-helpers';
import { prisma } from '@/lib/prisma';
import { SQODetail } from '@/types/sga-hub';

/**
 * GET /api/sga-hub/sqo-details
 * Get detailed SQO records for a specific quarter
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    // Parse query params
    const { searchParams } = new URL(request.url);
    const quarter = searchParams.get('quarter') || getCurrentQuarter();
    const targetUserEmail = searchParams.get('userEmail');

    // Determine target user
    let userEmail = session.user.email;

    if (targetUserEmail) {
      // Admin/Manager can view any SGA's SQO details
      if (!['admin', 'manager'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      userEmail = targetUserEmail;
    } else {
      // SGA can only view their own SQO details
      if (!['admin', 'manager', 'sga'].includes(permissions.role)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Get user's name (matches SGA_Owner_Name__c in BigQuery)
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { name: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch SQO details from BigQuery
    const sqos = await getQuarterlySQODetails(user.name, quarter);

    return NextResponse.json({ sqos });

  } catch (error) {
    console.error('[API] Error fetching SQO details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SQO details' },
      { status: 500 }
    );
  }
}
```

### Step 7.3: Create Quarterly Progress Components

**Cursor.ai Prompt:**
Create `QuarterlyProgressCard.tsx` (progress/pacing), `SQODetailTable.tsx`, and `QuarterlyProgressChart.tsx` (Recharts).

**Code to Create (src/components/sga-hub/QuarterlyProgressCard.tsx):**

```typescript
// src/components/sga-hub/QuarterlyProgressCard.tsx

'use client';

import { Card, Metric, Text, Badge } from '@tremor/react';
import { QuarterlyProgress } from '@/types/sga-hub';
import { TrendingUp, TrendingDown, Minus, Target } from 'lucide-react';

interface QuarterlyProgressCardProps {
  progress: QuarterlyProgress;
}

/**
 * Get color classes for pacing status badge
 */
function getPacingBadgeColor(status: QuarterlyProgress['pacingStatus']): string {
  switch (status) {
    case 'ahead':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
    case 'on-track':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'behind':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'no-goal':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200';
  }
}

/**
 * Get icon for pacing status
 */
function getPacingIcon(status: QuarterlyProgress['pacingStatus']) {
  switch (status) {
    case 'ahead':
      return <TrendingUp className="w-4 h-4" />;
    case 'behind':
      return <TrendingDown className="w-4 h-4" />;
    case 'on-track':
      return <Minus className="w-4 h-4" />;
    default:
      return <Target className="w-4 h-4" />;
  }
}

/**
 * Get label for pacing status
 */
function getPacingLabel(status: QuarterlyProgress['pacingStatus'], diff: number): string {
  switch (status) {
    case 'ahead':
      return `Ahead by ${Math.abs(diff).toFixed(1)} SQOs`;
    case 'behind':
      return `Behind by ${Math.abs(diff).toFixed(1)} SQOs`;
    case 'on-track':
      return 'On Track';
    case 'no-goal':
      return 'No Goal Set';
    default:
      return 'Unknown';
  }
}

export function QuarterlyProgressCard({ progress }: QuarterlyProgressCardProps) {
  const {
    quarterLabel,
    sqoGoal,
    hasGoal,
    sqoActual,
    totalAumFormatted,
    progressPercent,
    daysElapsed,
    daysInQuarter,
    expectedSqos,
    pacingDiff,
    pacingStatus,
  } = progress;

  // Calculate progress bar percentage (clamp to 0-100)
  const progressBarPercent = hasGoal && sqoGoal && sqoGoal > 0
    ? Math.min(100, Math.max(0, progressPercent || 0))
    : 0;

  return (
    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <Text className="text-gray-600 dark:text-gray-400 text-sm">Quarterly Progress</Text>
          <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
            {quarterLabel}
          </Metric>
        </div>
        <Badge className={getPacingBadgeColor(pacingStatus)} size="lg">
          <div className="flex items-center gap-1.5">
            {getPacingIcon(pacingStatus)}
            <span>{getPacingLabel(pacingStatus, pacingDiff)}</span>
          </div>
        </Badge>
      </div>

      {/* SQO Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium">
            SQOs: {sqoActual.toFixed(0)} {hasGoal && sqoGoal ? `of ${sqoGoal.toFixed(0)}` : ''}
          </Text>
          {hasGoal && progressPercent !== null && (
            <Text className="text-gray-900 dark:text-white font-semibold">
              {progressPercent.toFixed(0)}%
            </Text>
          )}
        </div>
        
        {/* Progress Bar */}
        {hasGoal && sqoGoal && sqoGoal > 0 ? (
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                progressBarPercent >= 100
                  ? 'bg-green-500 dark:bg-green-600'
                  : progressBarPercent >= 75
                  ? 'bg-blue-500 dark:bg-blue-600'
                  : progressBarPercent >= 50
                  ? 'bg-yellow-500 dark:bg-yellow-600'
                  : 'bg-red-500 dark:bg-red-600'
              }`}
              style={{ width: `${progressBarPercent}%` }}
            />
          </div>
        ) : (
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div className="h-full w-0" />
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Total AUM */}
        <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
          <Text className="text-gray-600 dark:text-gray-400 text-xs mb-1">Total AUM</Text>
          <Text className="text-gray-900 dark:text-white font-semibold text-lg">
            {totalAumFormatted}
          </Text>
        </div>

        {/* Expected SQOs */}
        {hasGoal && (
          <div className="p-3 bg-gray-50 dark:bg-gray-900 rounded-lg">
            <Text className="text-gray-600 dark:text-gray-400 text-xs mb-1">Expected SQOs</Text>
            <Text className="text-gray-900 dark:text-white font-semibold text-lg">
              {expectedSqos.toFixed(1)}
            </Text>
          </div>
        )}
      </div>

      {/* Time Progress */}
      <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <span>Days Elapsed: {daysElapsed} / {daysInQuarter}</span>
          <span>{Math.round((daysElapsed / daysInQuarter) * 100)}% of quarter</span>
        </div>
      </div>
    </Card>
  );
}
```

**Code to Create (src/components/sga-hub/SQODetailTable.tsx):**

```typescript
// src/components/sga-hub/SQODetailTable.tsx

'use client';

import { useState, useMemo } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge } from '@tremor/react';
import { SQODetail } from '@/types/sga-hub';
import { ExternalLink, ChevronUp, ChevronDown } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

type SortColumn = 'advisorName' | 'sqoDate' | 'aum' | 'aumTier' | 'channel' | 'source' | null;
type SortDirection = 'asc' | 'desc';

interface SQODetailTableProps {
  sqos: SQODetail[];
  isLoading?: boolean;
  onRecordClick?: (sqo: SQODetail) => void;
}

/**
 * Sort records based on column and direction
 */
function sortRecords(
  records: SQODetail[],
  sortColumn: SortColumn,
  sortDirection: SortDirection
): SQODetail[] {
  if (!sortColumn) return records;

  return [...records].sort((a, b) => {
    let comparison = 0;

    switch (sortColumn) {
      case 'advisorName':
        comparison = (a.advisorName || '').localeCompare(b.advisorName || '');
        break;
      case 'sqoDate':
        comparison = (a.sqoDate || '').localeCompare(b.sqoDate || '');
        break;
      case 'aum':
        comparison = (a.aum || 0) - (b.aum || 0);
        break;
      case 'aumTier':
        comparison = (a.aumTier || '').localeCompare(b.aumTier || '');
        break;
      case 'channel':
        comparison = (a.channel || '').localeCompare(b.channel || '');
        break;
      case 'source':
        comparison = (a.source || '').localeCompare(b.source || '');
        break;
      default:
        return 0;
    }

    return sortDirection === 'asc' ? comparison : -comparison;
  });
}

export function SQODetailTable({ sqos, isLoading = false, onRecordClick }: SQODetailTableProps) {
  const [sortColumn, setSortColumn] = useState<SortColumn>('sqoDate');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Sort records
  const sortedRecords = useMemo(() => {
    return sortRecords(sqos, sortColumn, sortDirection);
  }, [sqos, sortColumn, sortDirection]);

  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (column === null) return;

    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to descending for dates/numbers, ascending for text
      setSortColumn(column);
      if (column === 'sqoDate' || column === 'aum') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };

  // Sortable header cell component
  const SortableHeader = ({
    column,
    children,
    alignRight = false,
  }: {
    column: SortColumn;
    children: React.ReactNode;
    alignRight?: boolean;
  }) => {
    const isActive = sortColumn === column;
    const showAsc = isActive && sortDirection === 'asc';
    const showDesc = isActive && sortDirection === 'desc';

    return (
      <TableHeaderCell
        className={`border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 ${
          column !== null
            ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 select-none'
            : ''
        } ${alignRight ? 'text-right' : ''}`}
        onClick={() => handleSort(column)}
      >
        <div className={`flex items-center gap-1 ${alignRight ? 'justify-end' : ''}`}>
          {children}
          {column !== null && (
            <div className="flex flex-col">
              <ChevronUp
                className={`w-3 h-3 ${showAsc ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}
              />
              <ChevronDown
                className={`w-3 h-3 -mt-1 ${
                  showDesc ? 'text-gray-900 dark:text-white' : 'text-gray-400'
                }`}
              />
            </div>
          )}
        </div>
      </TableHeaderCell>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <LoadingSpinner />
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHead>
          <TableRow>
            <SortableHeader column="advisorName">Advisor Name</SortableHeader>
            <SortableHeader column="sqoDate">SQO Date</SortableHeader>
            <SortableHeader column="aum" alignRight>AUM</SortableHeader>
            <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
              AUM Tier
            </TableHeaderCell>
            <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
              Channel
            </TableHeaderCell>
            <TableHeaderCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
              Source
            </TableHeaderCell>
            <TableHeaderCell>Actions</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sortedRecords.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-gray-500 dark:text-gray-400 py-8">
                No SQO records found for this quarter
              </TableCell>
            </TableRow>
          ) : (
            sortedRecords.map((sqo) => (
              <TableRow
                key={sqo.id}
                className={`transition-colors ${
                  onRecordClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800' : ''
                }`}
                onClick={() => onRecordClick?.(sqo)}
              >
                <TableCell className="font-medium border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                  {sqo.advisorName || 'Unknown'}
                </TableCell>
                <TableCell className="text-sm border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                  {formatDate(sqo.sqoDate) || '-'}
                </TableCell>
                <TableCell className="text-right font-semibold border-r border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white">
                  {sqo.aumFormatted || '-'}
                </TableCell>
                <TableCell className="border-r border-gray-200 dark:border-gray-700">
                  <Badge size="xs" className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {sqo.aumTier || 'Unknown'}
                  </Badge>
                </TableCell>
                <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                  {sqo.channel || 'Unknown'}
                </TableCell>
                <TableCell className="border-r border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400">
                  {sqo.source || 'Unknown'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {sqo.leadUrl && (
                      <a
                        href={sqo.leadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-sm flex items-center gap-1"
                      >
                        Lead <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {sqo.opportunityUrl && (
                      <a
                        href={sqo.opportunityUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 dark:text-blue-400 hover:underline text-sm flex items-center gap-1"
                      >
                        Opp <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
```

**Code to Create (src/components/sga-hub/QuarterlyProgressChart.tsx):**

```typescript
// src/components/sga-hub/QuarterlyProgressChart.tsx

'use client';

import { Card, Title, Text } from '@tremor/react';
import { useTheme } from 'next-themes';
import { CHART_COLORS } from '@/config/theme';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { QuarterlyProgress } from '@/types/sga-hub';

interface QuarterlyProgressChartProps {
  progressData: QuarterlyProgress[];
  isLoading?: boolean;
}

/**
 * Transform quarterly progress data for chart display
 */
function transformChartData(progressData: QuarterlyProgress[]) {
  return progressData.map(p => ({
    quarter: p.quarter,
    quarterLabel: p.quarterLabel,
    actual: p.sqoActual,
    goal: p.sqoGoal || 0,
    hasGoal: p.hasGoal,
  }));
}

export function QuarterlyProgressChart({
  progressData,
  isLoading = false,
}: QuarterlyProgressChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const chartData = transformChartData(progressData);

  // Check if any quarter has a goal (for showing goal line)
  const hasAnyGoal = progressData.some(p => p.hasGoal);

  if (isLoading) {
    return (
      <Card className="mb-6">
        <div className="h-80 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </Card>
    );
  }

  if (chartData.length === 0) {
    return (
      <Card className="mb-6">
        <Title className="dark:text-white mb-4">Historical Quarterly Progress</Title>
        <div className="h-80 flex items-center justify-center text-gray-500 dark:text-gray-400">
          No data available
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <div className="mb-4">
        <Title className="dark:text-white">Historical Quarterly Progress</Title>
        <Text className="text-gray-500 dark:text-gray-400 text-sm mt-1">
          SQO counts by quarter with goal overlay (if set)
        </Text>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 25, right: 30, left: 20, bottom: 5 }}
            barCategoryGap="20%"
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={CHART_COLORS.grid}
              vertical={false}
              className="dark:stroke-gray-700"
            />
            <XAxis
              dataKey="quarterLabel"
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
              tickLine={{ stroke: CHART_COLORS.grid }}
              className="dark:[&_text]:fill-gray-400 dark:[&_line]:stroke-gray-700"
            />
            <YAxis
              tick={{ fontSize: 12, fill: CHART_COLORS.axis }}
              tickLine={{ stroke: CHART_COLORS.grid }}
              tickFormatter={(value) => value.toLocaleString()}
              domain={['auto', 'auto']}
              className="dark:[&_text]:fill-gray-400 dark:[&_line]:stroke-gray-700"
            />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: isDark ? '#1f2937' : '#fff',
                border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                color: isDark ? '#f9fafb' : '#111827',
              }}
              formatter={(value: number | undefined, name: string | undefined) => [
                value?.toLocaleString() || 0,
                name === 'actual' ? 'Actual SQOs' : name === 'goal' ? 'Goal' : name || '',
              ]}
              labelStyle={{
                fontWeight: 600,
                marginBottom: '4px',
                color: isDark ? '#f9fafb' : '#111827',
              }}
              itemStyle={{
                color: isDark ? '#f9fafb' : '#111827',
              }}
            />
            <Legend
              wrapperStyle={{
                paddingTop: '20px',
                color: isDark ? '#9ca3af' : '#4b5563',
              }}
            />
            {/* Actual SQOs Bar */}
            <Bar
              dataKey="actual"
              name="Actual SQOs"
              fill={CHART_COLORS.sqoToJoined}
              radius={[4, 4, 0, 0]}
              maxBarSize={60}
            />
            {/* Goal Line (if any quarter has a goal) */}
            {hasAnyGoal && (
              <Bar
                dataKey="goal"
                name="Goal"
                fill={CHART_COLORS.primary}
                radius={[4, 4, 0, 0]}
                maxBarSize={60}
                opacity={0.6}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend Explanation */}
      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
        <Text className="text-xs text-gray-500 dark:text-gray-400">
          <strong>Note:</strong> Shows actual SQO counts by quarter. Goal bars are shown when a
          quarterly goal is set. Bars are grouped by quarter for easy comparison.
        </Text>
      </div>
    </Card>
  );
}
```

### Step 7.4: Integrate Quarterly Progress Tab

**Cursor.ai Prompt:**
Integrate into `SGAHubContent.tsx` with a multi-select quarter dropdown and behind-pace warnings.

### Verification Gate 7:

* [ ] Pacing calculation working
* [ ] Historical chart displaying
* [ ] `npx tsc --noEmit` passes

**Checkpoint:**

```bash
git add -A && git commit -m "Phase 7: Add Quarterly Progress tab with pacing and historical view"

```

---

## Phase 8: Admin SGA Management Page

### Step 8.1: Create Admin Overview API Route

**Cursor.ai Prompt:**
Create `src/app/api/admin/sga-overview/route.ts` for aggregated SGA performance data.

**Code to Create (src/app/api/admin/sga-overview/route.ts):**

```typescript
// src/app/api/admin/sga-overview/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { getWeeklyGoalByWeek } from '@/lib/queries/weekly-goals';
import { getWeeklyActuals } from '@/lib/queries/weekly-actuals';
import { getQuarterlyGoal } from '@/lib/queries/quarterly-goals';
import { getQuarterlySQOCount } from '@/lib/queries/quarterly-progress';
import { getClosedLostRecords } from '@/lib/queries/closed-lost';
import { calculateQuarterPacing, getCurrentQuarter, getWeekMondayDate } from '@/lib/utils/sga-hub-helpers';
import { formatCurrency } from '@/lib/utils/date-helpers';
import { AdminSGAOverview } from '@/types/sga-hub';

/**
 * GET /api/admin/sga-overview
 * Get aggregated SGA performance data for admin/manager view
 * 
 * Query params:
 * - weekStartDate?: string (ISO date, defaults to current week Monday)
 * - quarter?: string (format: "YYYY-QN", defaults to current quarter)
 */
export async function GET(request: NextRequest) {
  try {
    // Authentication check
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await getUserPermissions(session.user.email);

    // Only admin and manager can access this endpoint
    if (!['admin', 'manager'].includes(permissions.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const weekStartDateParam = searchParams.get('weekStartDate');
    const quarterParam = searchParams.get('quarter');

    // Determine current week (Monday)
    const currentWeekMonday = weekStartDateParam
      ? new Date(weekStartDateParam)
      : getWeekMondayDate(new Date());
    const weekStartDate = currentWeekMonday.toISOString().split('T')[0];

    // Determine current quarter
    const quarter = quarterParam || getCurrentQuarter();

    // Get all SGA users
    const sgaUsers = await prisma.user.findMany({
      where: {
        role: 'sga',
        isActive: true, // Only active SGAs
      },
      select: {
        email: true,
        name: true,
        isActive: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    // Fetch data for all SGAs in parallel
    const overviewPromises = sgaUsers.map(async (user) => {
      try {
        // Fetch all data in parallel for this SGA
        const [
          weeklyGoal,
          weeklyActuals,
          quarterlyGoal,
          quarterlySQOData,
          closedLostRecords,
        ] = await Promise.all([
          // Current week goal
          getWeeklyGoalByWeek(user.email, weekStartDate).catch(() => null),
          
          // Current week actuals (need to calculate week end date)
          (async () => {
            const weekEndDate = new Date(currentWeekMonday);
            weekEndDate.setDate(weekEndDate.getDate() + 6); // Sunday
            const actuals = await getWeeklyActuals(
              user.name,
              weekStartDate,
              weekEndDate.toISOString().split('T')[0]
            );
            // Find actual for this specific week
            return actuals.find(a => a.weekStartDate === weekStartDate) || null;
          })().catch(() => null),
          
          // Current quarter goal
          getQuarterlyGoal(user.email, quarter).catch(() => null),
          
          // Current quarter SQO count and AUM
          getQuarterlySQOCount(user.name, quarter).catch(() => ({ sqoCount: 0, totalAum: 0 })),
          
          // Closed lost count (all time buckets)
          getClosedLostRecords(user.name).catch(() => []),
        ]);

        // Calculate quarterly progress with pacing
        let quarterlyProgress = null;
        if (quarterlyGoal) {
          quarterlyProgress = calculateQuarterPacing(
            quarter,
            quarterlyGoal.sqoGoal,
            quarterlySQOData.sqoCount,
            quarterlySQOData.totalAum,
            formatCurrency
          );
        } else if (quarterlySQOData.sqoCount > 0) {
          // Calculate progress even without goal (for display purposes)
          quarterlyProgress = calculateQuarterPacing(
            quarter,
            null,
            quarterlySQOData.sqoCount,
            quarterlySQOData.totalAum,
            formatCurrency
          );
        }

        // Calculate alerts
        const missingWeeklyGoal = weeklyGoal === null;
        const missingQuarterlyGoal = quarterlyGoal === null;
        const behindPacing = quarterlyProgress?.pacingStatus === 'behind';

        return {
          userEmail: user.email,
          userName: user.name,
          isActive: user.isActive ?? true,
          currentWeekGoal: weeklyGoal,
          currentWeekActual: weeklyActuals,
          currentQuarterGoal: quarterlyGoal,
          currentQuarterProgress: quarterlyProgress,
          closedLostCount: closedLostRecords.length,
          missingWeeklyGoal,
          missingQuarterlyGoal,
          behindPacing,
        } as AdminSGAOverview;
      } catch (error) {
        // If any error occurs for a specific SGA, return minimal data
        console.error(`[API] Error fetching data for SGA ${user.email}:`, error);
        return {
          userEmail: user.email,
          userName: user.name,
          isActive: user.isActive ?? true,
          currentWeekGoal: null,
          currentWeekActual: null,
          currentQuarterGoal: null,
          currentQuarterProgress: null,
          closedLostCount: 0,
          missingWeeklyGoal: true,
          missingQuarterlyGoal: true,
          behindPacing: false,
        } as AdminSGAOverview;
      }
    });

    // Wait for all promises to resolve
    const sgaOverviews = await Promise.all(overviewPromises);

    return NextResponse.json({
      sgaOverviews,
      weekStartDate,
      quarter,
    });

  } catch (error) {
    console.error('[API] Error fetching SGA overview:', error);
    return NextResponse.json(
      { error: 'Failed to fetch SGA overview' },
      { status: 500 }
    );
  }
}
```

### Step 8.2: Create Admin Page and Components

**Cursor.ai Prompt:**
Create the SGA Management page and goal editor for admins.

**Code to Create (src/app/dashboard/sga-management/page.tsx):**

```typescript
// src/app/dashboard/sga-management/page.tsx

import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getUserPermissions } from '@/lib/permissions';
import { SGAManagementContent } from './SGAManagementContent';

export const dynamic = 'force-dynamic';

export default async function SGAManagementPage() {
  const session = await getServerSession(authOptions);
  
  if (!session?.user?.email) {
    redirect('/login');
  }
  
  const permissions = await getUserPermissions(session.user.email);
  
  // Only admin and manager can access this page
  if (!['admin', 'manager'].includes(permissions.role)) {
    redirect('/dashboard');
  }
  
  return <SGAManagementContent />;
}
```

**Code to Create (src/app/dashboard/sga-management/SGAManagementContent.tsx):**

```typescript
// src/app/dashboard/sga-management/SGAManagementContent.tsx

'use client';

import { useState, useEffect } from 'react';
import { Card, Title, Text, Metric, Badge, Button, Select, SelectItem } from '@tremor/react';
import { AdminSGAOverview } from '@/types/sga-hub';
import { AdminSGATable } from '@/components/sga-hub/AdminSGATable';
import { BulkGoalEditor } from '@/components/sga-hub/BulkGoalEditor';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { getCurrentQuarter, getWeekMondayDate, formatDateISO } from '@/lib/utils/sga-hub-helpers';
import { Settings, Users, AlertTriangle, Target } from 'lucide-react';

interface SGAManagementContentProps {}

export function SGAManagementContent({}: SGAManagementContentProps) {
  const [loading, setLoading] = useState(true);
  const [sgaOverviews, setSgaOverviews] = useState<AdminSGAOverview[]>([]);
  const [selectedSGAEmail, setSelectedSGAEmail] = useState<string | null>(null);
  const [showBulkEditor, setShowBulkEditor] = useState(false);
  const [weekStartDate, setWeekStartDate] = useState<string>(
    formatDateISO(getWeekMondayDate(new Date()))
  );
  const [quarter, setQuarter] = useState<string>(getCurrentQuarter());

  // Fetch SGA overview data
  const fetchSGAOverviews = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        weekStartDate,
        quarter,
      });
      
      const response = await fetch(`/api/admin/sga-overview?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch SGA overview');
      
      const data = await response.json();
      setSgaOverviews(data.sgaOverviews || []);
      
      // Auto-select first SGA if none selected
      if (!selectedSGAEmail && data.sgaOverviews?.length > 0) {
        setSelectedSGAEmail(data.sgaOverviews[0].userEmail);
      }
    } catch (error) {
      console.error('Failed to fetch SGA overview:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSGAOverviews();
  }, [weekStartDate, quarter]);

  // Calculate summary stats
  const totalSGAs = sgaOverviews.length;
  const behindPacingCount = sgaOverviews.filter(sga => sga.behindPacing).length;
  const missingWeeklyGoalCount = sgaOverviews.filter(sga => sga.missingWeeklyGoal).length;
  const missingQuarterlyGoalCount = sgaOverviews.filter(sga => sga.missingQuarterlyGoal).length;
  const totalAlerts = behindPacingCount + missingWeeklyGoalCount + missingQuarterlyGoalCount;

  const selectedSGA = selectedSGAEmail
    ? sgaOverviews.find(sga => sga.userEmail === selectedSGAEmail)
    : null;

  const handleRefresh = () => {
    fetchSGAOverviews();
  };

  if (loading && sgaOverviews.length === 0) {
    return <LoadingSpinner />;
  }

  return (
    <div className="w-full max-w-full overflow-x-hidden">
      {/* Header */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <Title>SGA Management</Title>
            <Text>Monitor and manage SGA performance, goals, and alerts</Text>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setShowBulkEditor(true)} icon={Settings}>
              Bulk Goal Editor
            </Button>
            <Button onClick={handleRefresh} variant="secondary">
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">Total SGAs</Text>
              <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {totalSGAs}
              </Metric>
            </div>
            <Users className="w-8 h-8 text-blue-500 dark:text-blue-400" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">Behind Pacing</Text>
              <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {behindPacingCount}
              </Metric>
            </div>
            <AlertTriangle className="w-8 h-8 text-red-500 dark:text-red-400" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">Missing Weekly Goals</Text>
              <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {missingWeeklyGoalCount}
              </Metric>
            </div>
            <Target className="w-8 h-8 text-yellow-500 dark:text-yellow-400" />
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">Missing Quarterly Goals</Text>
              <Metric className="text-2xl font-bold text-gray-900 dark:text-white mt-1">
                {missingQuarterlyGoalCount}
              </Metric>
            </div>
            <Target className="w-8 h-8 text-orange-500 dark:text-orange-400" />
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6 p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Text className="text-gray-600 dark:text-gray-400 text-sm mb-2">Week</Text>
            <input
              type="date"
              value={weekStartDate}
              onChange={(e) => setWeekStartDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex-1">
            <Text className="text-gray-600 dark:text-gray-400 text-sm mb-2">Quarter</Text>
            <input
              type="text"
              value={quarter}
              onChange={(e) => setQuarter(e.target.value)}
              placeholder="2025-Q1"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
          </div>
          <div className="flex-1">
            <Text className="text-gray-600 dark:text-gray-400 text-sm mb-2">Select SGA</Text>
            <Select
              value={selectedSGAEmail || ''}
              onValueChange={(value) => setSelectedSGAEmail(value || null)}
            >
              {sgaOverviews.map((sga) => (
                <SelectItem key={sga.userEmail} value={sga.userEmail}>
                  {sga.userName}
                </SelectItem>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {/* SGA Table */}
      <AdminSGATable
        sgaOverviews={sgaOverviews}
        selectedSGAEmail={selectedSGAEmail}
        onSGASelect={setSelectedSGAEmail}
        onRefresh={handleRefresh}
        weekStartDate={weekStartDate}
        quarter={quarter}
      />

      {/* Selected SGA Details */}
      {selectedSGA && (
        <Card className="mt-6 p-6">
          <Title className="mb-4">{selectedSGA.userName} - Details</Title>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Current Week */}
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium mb-2">
                Current Week
              </Text>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Goal:</Text>
                  <Text className="font-semibold">
                    {selectedSGA.currentWeekGoal
                      ? `IC: ${selectedSGA.currentWeekGoal.initialCallsGoal}, QC: ${selectedSGA.currentWeekGoal.qualificationCallsGoal}, SQO: ${selectedSGA.currentWeekGoal.sqoGoal}`
                      : 'Not set'}
                  </Text>
                </div>
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Actual:</Text>
                  <Text className="font-semibold">
                    {selectedSGA.currentWeekActual
                      ? `IC: ${selectedSGA.currentWeekActual.initialCalls}, QC: ${selectedSGA.currentWeekActual.qualificationCalls}, SQO: ${selectedSGA.currentWeekActual.sqos}`
                      : 'No data'}
                  </Text>
                </div>
              </div>
            </div>

            {/* Current Quarter */}
            <div>
              <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium mb-2">
                Current Quarter
              </Text>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Goal:</Text>
                  <Text className="font-semibold">
                    {selectedSGA.currentQuarterGoal
                      ? `${selectedSGA.currentQuarterGoal.sqoGoal} SQOs`
                      : 'Not set'}
                  </Text>
                </div>
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Actual:</Text>
                  <Text className="font-semibold">
                    {selectedSGA.currentQuarterProgress
                      ? `${selectedSGA.currentQuarterProgress.sqoActual} SQOs (${selectedSGA.currentQuarterProgress.progressPercent?.toFixed(0) || 0}%)`
                      : 'No data'}
                  </Text>
                </div>
                <div className="flex justify-between">
                  <Text className="text-gray-600 dark:text-gray-400">Pacing:</Text>
                  <Badge
                    className={
                      selectedSGA.currentQuarterProgress?.pacingStatus === 'ahead'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : selectedSGA.currentQuarterProgress?.pacingStatus === 'behind'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        : selectedSGA.currentQuarterProgress?.pacingStatus === 'on-track'
                        ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                    }
                  >
                    {selectedSGA.currentQuarterProgress?.pacingStatus || 'No goal'}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Alerts */}
            <div className="md:col-span-2">
              <Text className="text-gray-600 dark:text-gray-400 text-sm font-medium mb-2">
                Alerts
              </Text>
              <div className="flex gap-2 flex-wrap">
                {selectedSGA.missingWeeklyGoal && (
                  <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                    Missing Weekly Goal
                  </Badge>
                )}
                {selectedSGA.missingQuarterlyGoal && (
                  <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200">
                    Missing Quarterly Goal
                  </Badge>
                )}
                {selectedSGA.behindPacing && (
                  <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                    Behind Pacing
                  </Badge>
                )}
                {selectedSGA.closedLostCount > 0 && (
                  <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    {selectedSGA.closedLostCount} Closed Lost
                  </Badge>
                )}
                {!selectedSGA.missingWeeklyGoal &&
                  !selectedSGA.missingQuarterlyGoal &&
                  !selectedSGA.behindPacing && (
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      All Good
                    </Badge>
                  )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Bulk Goal Editor Modal */}
      <BulkGoalEditor
        isOpen={showBulkEditor}
        onClose={() => setShowBulkEditor(false)}
        onSaved={() => {
          setShowBulkEditor(false);
          fetchSGAOverviews();
        }}
        sgaOverviews={sgaOverviews}
      />
    </div>
  );
}
```

**Code to Create (src/components/sga-hub/AdminSGATable.tsx):**

```typescript
// src/components/sga-hub/AdminSGATable.tsx

'use client';

import React, { useState } from 'react';
import { Card, Table, TableHead, TableRow, TableHeaderCell, TableBody, TableCell, Badge, Button } from '@tremor/react';
import { AdminSGAOverview } from '@/types/sga-hub';
import { ChevronDown, ChevronUp, Pencil, ExternalLink } from 'lucide-react';
import { formatDate } from '@/lib/utils/format-helpers';

interface AdminSGATableProps {
  sgaOverviews: AdminSGAOverview[];
  selectedSGAEmail: string | null;
  onSGASelect: (email: string | null) => void;
  onRefresh: () => void;
  weekStartDate: string;
  quarter: string;
}

export function AdminSGATable({
  sgaOverviews,
  selectedSGAEmail,
  onSGASelect,
  onRefresh,
  weekStartDate,
  quarter,
}: AdminSGATableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleRow = (email: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(email)) {
      newExpanded.delete(email);
    } else {
      newExpanded.add(email);
    }
    setExpandedRows(newExpanded);
  };

  const getWeekStatusBadge = (overview: AdminSGAOverview) => {
    if (!overview.currentWeekGoal) {
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">No Goal</Badge>;
    }
    if (!overview.currentWeekActual) {
      return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">No Data</Badge>;
    }
    
    const goal = overview.currentWeekGoal.sqoGoal;
    const actual = overview.currentWeekActual.sqos;
    
    if (actual >= goal) {
      return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">On Track</Badge>;
    } else if (actual >= goal * 0.8) {
      return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">Close</Badge>;
    } else {
      return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Behind</Badge>;
    }
  };

  const getQuarterStatusBadge = (overview: AdminSGAOverview) => {
    if (!overview.currentQuarterProgress) {
      return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">No Data</Badge>;
    }
    
    const status = overview.currentQuarterProgress.pacingStatus;
    switch (status) {
      case 'ahead':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">Ahead</Badge>;
      case 'on-track':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">On Track</Badge>;
      case 'behind':
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">Behind</Badge>;
      default:
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">No Goal</Badge>;
    }
  };

  const getAlertsBadges = (overview: AdminSGAOverview) => {
    const badges = [];
    if (overview.missingWeeklyGoal) {
      badges.push(
        <Badge key="weekly" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 text-xs">
          Missing Weekly
        </Badge>
      );
    }
    if (overview.missingQuarterlyGoal) {
      badges.push(
        <Badge key="quarterly" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 text-xs">
          Missing Quarterly
        </Badge>
      );
    }
    if (overview.behindPacing) {
      badges.push(
        <Badge key="pacing" className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs">
          Behind Pacing
        </Badge>
      );
    }
    if (badges.length === 0) {
      badges.push(
        <Badge key="good" className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 text-xs">
          All Good
        </Badge>
      );
    }
    return badges;
  };

  return (
    <Card>
      <Table>
        <TableHead>
          <TableRow>
            <TableHeaderCell className="w-12"></TableHeaderCell>
            <TableHeaderCell>Name</TableHeaderCell>
            <TableHeaderCell>Email</TableHeaderCell>
            <TableHeaderCell>Week Status</TableHeaderCell>
            <TableHeaderCell>Quarter Status</TableHeaderCell>
            <TableHeaderCell>Alerts</TableHeaderCell>
            <TableHeaderCell>Actions</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sgaOverviews.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-gray-500 dark:text-gray-400 py-8">
                No SGAs found
              </TableCell>
            </TableRow>
          ) : (
            sgaOverviews.map((overview) => {
              const isExpanded = expandedRows.has(overview.userEmail);
              const isSelected = selectedSGAEmail === overview.userEmail;

              return (
                <React.Fragment key={overview.userEmail}>
                  <TableRow
                  <TableRow
                    className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 ${
                      isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                    }`}
                    onClick={() => toggleRow(overview.userEmail)}
                  >
                    <TableCell>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-gray-900 dark:text-white">
                      {overview.userName}
                    </TableCell>
                    <TableCell className="text-gray-600 dark:text-gray-400">
                      {overview.userEmail}
                    </TableCell>
                    <TableCell>{getWeekStatusBadge(overview)}</TableCell>
                    <TableCell>{getQuarterStatusBadge(overview)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">{getAlertsBadges(overview)}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="xs"
                          variant="secondary"
                          icon={Pencil}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSGASelect(overview.userEmail);
                          }}
                        >
                          Edit
                        </Button>
                        <a
                          href={`/dashboard/sga-hub?userEmail=${encodeURIComponent(overview.userEmail)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button size="xs" variant="secondary" icon={ExternalLink}>
                            View Hub
                          </Button>
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="bg-gray-50 dark:bg-gray-900">
                      <TableCell colSpan={7} className="p-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Week Details */}
                          <div>
                            <Text className="font-semibold mb-2">Current Week ({formatDate(weekStartDate)})</Text>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Goal:</Text>
                                <Text>
                                  {overview.currentWeekGoal
                                    ? `IC: ${overview.currentWeekGoal.initialCallsGoal}, QC: ${overview.currentWeekGoal.qualificationCallsGoal}, SQO: ${overview.currentWeekGoal.sqoGoal}`
                                    : 'Not set'}
                                </Text>
                              </div>
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Actual:</Text>
                                <Text>
                                  {overview.currentWeekActual
                                    ? `IC: ${overview.currentWeekActual.initialCalls}, QC: ${overview.currentWeekActual.qualificationCalls}, SQO: ${overview.currentWeekActual.sqos}`
                                    : 'No data'}
                                </Text>
                              </div>
                            </div>
                          </div>

                          {/* Quarter Details */}
                          <div>
                            <Text className="font-semibold mb-2">Current Quarter ({quarter})</Text>
                            <div className="space-y-1 text-sm">
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Goal:</Text>
                                <Text>
                                  {overview.currentQuarterGoal
                                    ? `${overview.currentQuarterGoal.sqoGoal} SQOs`
                                    : 'Not set'}
                                </Text>
                              </div>
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Actual:</Text>
                                <Text>
                                  {overview.currentQuarterProgress
                                    ? `${overview.currentQuarterProgress.sqoActual} SQOs (${overview.currentQuarterProgress.progressPercent?.toFixed(0) || 0}%)`
                                    : 'No data'}
                                </Text>
                              </div>
                              <div className="flex justify-between">
                                <Text className="text-gray-600 dark:text-gray-400">Pacing:</Text>
                                <Text>
                                  {overview.currentQuarterProgress
                                    ? `${overview.currentQuarterProgress.pacingStatus} (${overview.currentQuarterProgress.pacingDiff > 0 ? '+' : ''}${overview.currentQuarterProgress.pacingDiff.toFixed(1)})`
                                    : 'N/A'}
                                </Text>
                              </div>
                            </div>
                          </div>

                          {/* Additional Info */}
                          <div className="md:col-span-2">
                            <Text className="font-semibold mb-2">Additional Info</Text>
                            <div className="flex gap-4 text-sm">
                              <div>
                                <Text className="text-gray-600 dark:text-gray-400">Closed Lost:</Text>
                                <Text className="ml-2">{overview.closedLostCount}</Text>
                              </div>
                              <div>
                                <Text className="text-gray-600 dark:text-gray-400">Status:</Text>
                                <Badge
                                  className={`ml-2 ${
                                    overview.isActive
                                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                                      : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                                  }`}
                                >
                                  {overview.isActive ? 'Active' : 'Inactive'}
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
```

**Code to Create (src/components/sga-hub/BulkGoalEditor.tsx):**

```typescript
// src/components/sga-hub/BulkGoalEditor.tsx

'use client';

import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { AdminSGAOverview } from '@/types/sga-hub';
import { getCurrentQuarter, getWeekMondayDate, formatDateISO } from '@/lib/utils/sga-hub-helpers';
import { Button } from '@tremor/react';

interface BulkGoalEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  sgaOverviews: AdminSGAOverview[];
}

type GoalType = 'weekly' | 'quarterly';

export function BulkGoalEditor({
  isOpen,
  onClose,
  onSaved,
  sgaOverviews,
}: BulkGoalEditorProps) {
  const [goalType, setGoalType] = useState<GoalType>('weekly');
  const [weekStartDate, setWeekStartDate] = useState<string>(
    formatDateISO(getWeekMondayDate(new Date()))
  );
  const [quarter, setQuarter] = useState<string>(getCurrentQuarter());
  const [selectedSGAs, setSelectedSGAs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Weekly goal fields
  const [initialCallsGoal, setInitialCallsGoal] = useState<number>(0);
  const [qualificationCallsGoal, setQualificationCallsGoal] = useState<number>(0);
  const [sqoGoal, setSqoGoal] = useState<number>(0);

  // Quarterly goal field
  const [quarterlySqoGoal, setQuarterlySqoGoal] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      // Reset form when modal opens
      setSelectedSGAs(new Set());
      setInitialCallsGoal(0);
      setQualificationCallsGoal(0);
      setSqoGoal(0);
      setQuarterlySqoGoal(0);
      setError(null);
    }
  }, [isOpen]);

  const toggleSGA = (email: string) => {
    const newSet = new Set(selectedSGAs);
    if (newSet.has(email)) {
      newSet.delete(email);
    } else {
      newSet.add(email);
    }
    setSelectedSGAs(newSet);
  };

  const selectAll = () => {
    setSelectedSGAs(new Set(sgaOverviews.map(sga => sga.userEmail)));
  };

  const deselectAll = () => {
    setSelectedSGAs(new Set());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (selectedSGAs.size === 0) {
        setError('Please select at least one SGA');
        setLoading(false);
        return;
      }

      // Create goals for all selected SGAs
      const promises = Array.from(selectedSGAs).map(async (email) => {
        if (goalType === 'weekly') {
          const response = await fetch('/api/sga-hub/weekly-goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userEmail: email,
              weekStartDate,
              initialCallsGoal,
              qualificationCallsGoal,
              sqoGoal,
            }),
          });
          if (!response.ok) throw new Error(`Failed to save goal for ${email}`);
        } else {
          const response = await fetch('/api/sga-hub/quarterly-goals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userEmail: email,
              quarter,
              sqoGoal: quarterlySqoGoal,
            }),
          });
          if (!response.ok) throw new Error(`Failed to save goal for ${email}`);
        }
      });

      await Promise.all(promises);
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save goals');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Bulk Goal Editor</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Goal Type Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Goal Type
            </label>
            <div className="flex gap-4">
              <label className="flex items-center">
                <input
                  type="radio"
                  value="weekly"
                  checked={goalType === 'weekly'}
                  onChange={(e) => setGoalType(e.target.value as GoalType)}
                  className="mr-2"
                />
                <span className="text-gray-700 dark:text-gray-300">Weekly</span>
              </label>
              <label className="flex items-center">
                <input
                  type="radio"
                  value="quarterly"
                  checked={goalType === 'quarterly'}
                  onChange={(e) => setGoalType(e.target.value as GoalType)}
                  className="mr-2"
                />
                <span className="text-gray-700 dark:text-gray-300">Quarterly</span>
              </label>
            </div>
          </div>

          {/* Week/Quarter Selector */}
          {goalType === 'weekly' ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Week Start Date (Monday)
              </label>
              <input
                type="date"
                value={weekStartDate}
                onChange={(e) => setWeekStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                required
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Quarter
              </label>
              <input
                type="text"
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                placeholder="2025-Q1"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                required
              />
            </div>
          )}

          {/* Goal Values */}
          {goalType === 'weekly' ? (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Initial Calls Goal
                </label>
                <input
                  type="number"
                  min="0"
                  value={initialCallsGoal}
                  onChange={(e) => setInitialCallsGoal(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Qualification Calls Goal
                </label>
                <input
                  type="number"
                  min="0"
                  value={qualificationCallsGoal}
                  onChange={(e) => setQualificationCallsGoal(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  SQO Goal
                </label>
                <input
                  type="number"
                  min="0"
                  value={sqoGoal}
                  onChange={(e) => setSqoGoal(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  required
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                SQO Goal
              </label>
              <input
                type="number"
                min="0"
                value={quarterlySqoGoal}
                onChange={(e) => setQuarterlySqoGoal(parseInt(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                required
              />
            </div>
          )}

          {/* SGA Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Select SGAs ({selectedSGAs.size} selected)
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Deselect All
                </button>
              </div>
            </div>
            <div className="border border-gray-300 dark:border-gray-600 rounded-md p-4 max-h-60 overflow-y-auto">
              {sgaOverviews.map((sga) => (
                <label key={sga.userEmail} className="flex items-center mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSGAs.has(sga.userEmail)}
                    onChange={() => toggleSGA(sga.userEmail)}
                    className="mr-2"
                  />
                  <span className="text-gray-700 dark:text-gray-300">{sga.userName}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
              <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : `Save Goals (${selectedSGAs.size} SGAs)`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

### Step 8.3: Add Export Functionality

**Cursor.ai Prompt:**
Add CSV export functions for weekly, quarterly, and closed lost reports.

**Code to Create (src/lib/utils/csv-export.ts):**

```typescript
// src/lib/utils/csv-export.ts

import { 
  WeeklyGoalWithActuals, 
  QuarterlyProgress, 
  ClosedLostRecord, 
  AdminSGAOverview 
} from '@/types/sga-hub';
import { formatDate } from '@/lib/utils/format-helpers';
import { formatCurrency } from '@/lib/utils/date-helpers';

type CSVValue = string | number | boolean | null | undefined;
type CSVRow = Record<string, CSVValue>;

/**
 * Generic CSV generation and download function
 */
export function generateCSV<T extends Record<string, any>>(
  data: T[],
  columns: { key: keyof T; header: string }[],
  filename: string
): void {
  if (data.length === 0) {
    alert('No data to export');
    return;
  }

  // Build CSV header row
  const headers = columns.map(col => col.header);
  const csvContent = [
    headers.join(','),
    ...data.map(row => 
      columns.map(col => {
        const value = row[col.key];
        // Convert value to string, handling null/undefined
        const stringValue = String(value ?? '');
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      }).join(',')
    )
  ].join('\n');

  // Download CSV
  downloadCSV(csvContent, filename);
}

/**
 * Download CSV file using browser Blob API
 */
function downloadCSV(csvContent: string, filename: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

/**
 * Export weekly goals with actuals to CSV
 */
export function exportWeeklyGoalsCSV(
  goals: WeeklyGoalWithActuals[],
  sgaName: string
): void {
  const sanitizedName = sgaName.replace(/[^a-zA-Z0-9]/g, '_');
  
  const columns = [
    { key: 'weekLabel' as keyof WeeklyGoalWithActuals, header: 'Week' },
    { key: 'weekStartDate' as keyof WeeklyGoalWithActuals, header: 'Week Start Date' },
    { key: 'weekEndDate' as keyof WeeklyGoalWithActuals, header: 'Week End Date' },
    { key: 'initialCallsGoal' as keyof WeeklyGoalWithActuals, header: 'Initial Calls Goal' },
    { key: 'initialCallsActual' as keyof WeeklyGoalWithActuals, header: 'Initial Calls Actual' },
    { key: 'initialCallsDiff' as keyof WeeklyGoalWithActuals, header: 'Initial Calls Difference' },
    { key: 'qualificationCallsGoal' as keyof WeeklyGoalWithActuals, header: 'Qualification Calls Goal' },
    { key: 'qualificationCallsActual' as keyof WeeklyGoalWithActuals, header: 'Qualification Calls Actual' },
    { key: 'qualificationCallsDiff' as keyof WeeklyGoalWithActuals, header: 'Qualification Calls Difference' },
    { key: 'sqoGoal' as keyof WeeklyGoalWithActuals, header: 'SQO Goal' },
    { key: 'sqoActual' as keyof WeeklyGoalWithActuals, header: 'SQO Actual' },
    { key: 'sqoDiff' as keyof WeeklyGoalWithActuals, header: 'SQO Difference' },
    { key: 'hasGoal' as keyof WeeklyGoalWithActuals, header: 'Has Goal' },
  ];

  // Transform data for CSV (format dates, handle nulls)
  const csvData = goals.map(goal => ({
    weekLabel: goal.weekLabel,
    weekStartDate: formatDate(goal.weekStartDate),
    weekEndDate: formatDate(goal.weekEndDate),
    initialCallsGoal: goal.initialCallsGoal ?? '',
    initialCallsActual: goal.initialCallsActual,
    initialCallsDiff: goal.initialCallsDiff ?? '',
    qualificationCallsGoal: goal.qualificationCallsGoal ?? '',
    qualificationCallsActual: goal.qualificationCallsActual,
    qualificationCallsDiff: goal.qualificationCallsDiff ?? '',
    sqoGoal: goal.sqoGoal ?? '',
    sqoActual: goal.sqoActual,
    sqoDiff: goal.sqoDiff ?? '',
    hasGoal: goal.hasGoal ? 'Yes' : 'No',
  }));

  generateCSV(csvData, columns, `weekly_goals_${sanitizedName}`);
}

/**
 * Export quarterly progress to CSV
 */
export function exportQuarterlyProgressCSV(
  progress: QuarterlyProgress[],
  sgaName: string
): void {
  const sanitizedName = sgaName.replace(/[^a-zA-Z0-9]/g, '_');
  
  const columns = [
    { key: 'quarterLabel' as keyof QuarterlyProgress, header: 'Quarter' },
    { key: 'quarter' as keyof QuarterlyProgress, header: 'Quarter Code' },
    { key: 'sqoGoal' as keyof QuarterlyProgress, header: 'SQO Goal' },
    { key: 'sqoActual' as keyof QuarterlyProgress, header: 'SQO Actual' },
    { key: 'progressPercent' as keyof QuarterlyProgress, header: 'Progress %' },
    { key: 'totalAumFormatted' as keyof QuarterlyProgress, header: 'Total AUM' },
    { key: 'daysElapsed' as keyof QuarterlyProgress, header: 'Days Elapsed' },
    { key: 'daysInQuarter' as keyof QuarterlyProgress, header: 'Days in Quarter' },
    { key: 'expectedSqos' as keyof QuarterlyProgress, header: 'Expected SQOs' },
    { key: 'pacingDiff' as keyof QuarterlyProgress, header: 'Pacing Difference' },
    { key: 'pacingStatus' as keyof QuarterlyProgress, header: 'Pacing Status' },
    { key: 'quarterStartDate' as keyof QuarterlyProgress, header: 'Quarter Start Date' },
    { key: 'quarterEndDate' as keyof QuarterlyProgress, header: 'Quarter End Date' },
  ];

  // Transform data for CSV (format dates, handle nulls)
  const csvData = progress.map(p => ({
    quarterLabel: p.quarterLabel,
    quarter: p.quarter,
    sqoGoal: p.sqoGoal ?? '',
    sqoActual: p.sqoActual,
    progressPercent: p.progressPercent ? `${p.progressPercent.toFixed(1)}%` : '',
    totalAumFormatted: p.totalAumFormatted,
    daysElapsed: p.daysElapsed,
    daysInQuarter: p.daysInQuarter,
    expectedSqos: p.expectedSqos.toFixed(1),
    pacingDiff: p.pacingDiff.toFixed(1),
    pacingStatus: p.pacingStatus,
    quarterStartDate: formatDate(p.quarterStartDate),
    quarterEndDate: formatDate(p.quarterEndDate),
  }));

  generateCSV(csvData, columns, `quarterly_progress_${sanitizedName}`);
}

/**
 * Export closed lost records to CSV
 */
export function exportClosedLostCSV(
  records: ClosedLostRecord[],
  sgaName: string
): void {
  const sanitizedName = sgaName.replace(/[^a-zA-Z0-9]/g, '_');
  
  const columns = [
    { key: 'oppName' as keyof ClosedLostRecord, header: 'Opportunity Name' },
    { key: 'lastContactDate' as keyof ClosedLostRecord, header: 'Last Contact Date' },
    { key: 'daysSinceContact' as keyof ClosedLostRecord, header: 'Days Since Contact' },
    { key: 'closedLostDate' as keyof ClosedLostRecord, header: 'Closed Lost Date' },
    { key: 'sqlDate' as keyof ClosedLostRecord, header: 'SQL Date' },
    { key: 'closedLostReason' as keyof ClosedLostRecord, header: 'Closed Lost Reason' },
    { key: 'closedLostDetails' as keyof ClosedLostRecord, header: 'Closed Lost Details' },
    { key: 'timeSinceContactBucket' as keyof ClosedLostRecord, header: 'Time Since Contact Bucket' },
    { key: 'leadId' as keyof ClosedLostRecord, header: 'Lead ID' },
    { key: 'opportunityId' as keyof ClosedLostRecord, header: 'Opportunity ID' },
    { key: 'leadUrl' as keyof ClosedLostRecord, header: 'Lead URL' },
    { key: 'opportunityUrl' as keyof ClosedLostRecord, header: 'Opportunity URL' },
  ];

  // Transform data for CSV (format dates, handle nulls)
  const csvData = records.map(record => ({
    oppName: record.oppName || '',
    lastContactDate: formatDate(record.lastContactDate),
    daysSinceContact: record.daysSinceContact ?? '',
    closedLostDate: formatDate(record.closedLostDate),
    sqlDate: formatDate(record.sqlDate),
    closedLostReason: record.closedLostReason || '',
    closedLostDetails: record.closedLostDetails || '',
    timeSinceContactBucket: record.timeSinceContactBucket || '',
    leadId: record.leadId || '',
    opportunityId: record.opportunityId || '',
    leadUrl: record.leadUrl || '',
    opportunityUrl: record.opportunityUrl || '',
  }));

  generateCSV(csvData, columns, `closed_lost_${sanitizedName}`);
}

/**
 * Export admin SGA overview to CSV
 */
export function exportAdminOverviewCSV(
  overviews: AdminSGAOverview[]
): void {
  const columns = [
    { key: 'userName' as keyof AdminSGAOverview, header: 'SGA Name' },
    { key: 'userEmail' as keyof AdminSGAOverview, header: 'Email' },
    { key: 'isActive' as keyof AdminSGAOverview, header: 'Active' },
    { key: 'weeklyGoalIC' as keyof any, header: 'Week Goal - Initial Calls' },
    { key: 'weeklyGoalQC' as keyof any, header: 'Week Goal - Qualification Calls' },
    { key: 'weeklyGoalSQO' as keyof any, header: 'Week Goal - SQO' },
    { key: 'weeklyActualIC' as keyof any, header: 'Week Actual - Initial Calls' },
    { key: 'weeklyActualQC' as keyof any, header: 'Week Actual - Qualification Calls' },
    { key: 'weeklyActualSQO' as keyof any, header: 'Week Actual - SQO' },
    { key: 'quarterlyGoal' as keyof any, header: 'Quarter Goal - SQO' },
    { key: 'quarterlyActual' as keyof any, header: 'Quarter Actual - SQO' },
    { key: 'quarterlyProgress' as keyof any, header: 'Quarter Progress %' },
    { key: 'quarterlyPacing' as keyof any, header: 'Quarter Pacing Status' },
    { key: 'closedLostCount' as keyof AdminSGAOverview, header: 'Closed Lost Count' },
    { key: 'missingWeeklyGoal' as keyof AdminSGAOverview, header: 'Missing Weekly Goal' },
    { key: 'missingQuarterlyGoal' as keyof AdminSGAOverview, header: 'Missing Quarterly Goal' },
    { key: 'behindPacing' as keyof AdminSGAOverview, header: 'Behind Pacing' },
  ];

  // Transform data for CSV (flatten nested objects)
  const csvData = overviews.map(overview => ({
    userName: overview.userName,
    userEmail: overview.userEmail,
    isActive: overview.isActive ? 'Yes' : 'No',
    weeklyGoalIC: overview.currentWeekGoal?.initialCallsGoal ?? '',
    weeklyGoalQC: overview.currentWeekGoal?.qualificationCallsGoal ?? '',
    weeklyGoalSQO: overview.currentWeekGoal?.sqoGoal ?? '',
    weeklyActualIC: overview.currentWeekActual?.initialCalls ?? '',
    weeklyActualQC: overview.currentWeekActual?.qualificationCalls ?? '',
    weeklyActualSQO: overview.currentWeekActual?.sqos ?? '',
    quarterlyGoal: overview.currentQuarterGoal?.sqoGoal ?? '',
    quarterlyActual: overview.currentQuarterProgress?.sqoActual ?? '',
    quarterlyProgress: overview.currentQuarterProgress?.progressPercent 
      ? `${overview.currentQuarterProgress.progressPercent.toFixed(1)}%` 
      : '',
    quarterlyPacing: overview.currentQuarterProgress?.pacingStatus ?? '',
    closedLostCount: overview.closedLostCount,
    missingWeeklyGoal: overview.missingWeeklyGoal ? 'Yes' : 'No',
    missingQuarterlyGoal: overview.missingQuarterlyGoal ? 'Yes' : 'No',
    behindPacing: overview.behindPacing ? 'Yes' : 'No',
  }));

  generateCSV(csvData, columns, 'admin_sga_overview');
}
```

**Components that need export buttons added:**

1. **Weekly Goals Tab** (`src/components/sga-hub/WeeklyGoalsTable.tsx` or similar):
   ```typescript
   import { exportWeeklyGoalsCSV } from '@/lib/utils/csv-export';
   
   // Add export button in component
   <Button 
     onClick={() => exportWeeklyGoalsCSV(goals, sgaName)} 
     icon={Download}
     variant="secondary"
   >
     Export CSV
   </Button>
   ```

2. **Quarterly Progress Tab** (`src/components/sga-hub/QuarterlyProgressChart.tsx` or similar):
   ```typescript
   import { exportQuarterlyProgressCSV } from '@/lib/utils/csv-export';
   
   // Add export button in component
   <Button 
     onClick={() => exportQuarterlyProgressCSV(progressData, sgaName)} 
     icon={Download}
     variant="secondary"
   >
     Export CSV
   </Button>
   ```

3. **Closed Lost Tab** (`src/components/sga-hub/ClosedLostTable.tsx`):
   ```typescript
   import { exportClosedLostCSV } from '@/lib/utils/csv-export';
   
   // Add export button in component
   <Button 
     onClick={() => exportClosedLostCSV(records, sgaName)} 
     icon={Download}
     variant="secondary"
   >
     Export CSV
   </Button>
   ```

4. **Admin SGA Management Page** (`src/app/dashboard/sga-management/SGAManagementContent.tsx`):
   ```typescript
   import { exportAdminOverviewCSV } from '@/lib/utils/csv-export';
   
   // Add export button in header section
   <Button 
     onClick={() => exportAdminOverviewCSV(sgaOverviews)} 
     icon={Download}
     variant="secondary"
   >
     Export CSV
   </Button>
   ```

### Verification Gate 8:

* [ ] Admin page accessible
* [ ] Export functionality working
* [ ] `npm run build` passes

**Checkpoint:**

```bash
git add -A && git commit -m "Phase 8: Add Admin SGA Management page with export functionality"

```

---

## Phase 9: Navigation & Permissions

### Step 9.1: Update Sidebar Navigation

**Cursor.ai Prompt:**
Add SGA Hub (ID 8) and SGA Management (ID 9) to `src/components/layout/Sidebar.tsx`.

**Code to add to PAGES array:**
```typescript
const PAGES = [
  { id: 1, name: 'Funnel Performance', href: '/dashboard', icon: BarChart3 },
  { id: 2, name: 'Channel Drilldown', href: '/dashboard/channels', icon: GitBranch },
  { id: 3, name: 'Open Pipeline', href: '/dashboard/pipeline', icon: Users },
  { id: 4, name: 'Partner Performance', href: '/dashboard/partners', icon: Building2 },
  { id: 5, name: 'Experimentation', href: '/dashboard/experiments', icon: FlaskConical },
  { id: 6, name: 'SGA Performance', href: '/dashboard/sga', icon: UserCircle },
  { id: 7, name: 'Settings', href: '/dashboard/settings', icon: Settings },
  { id: 8, name: 'SGA Hub', href: '/dashboard/sga-hub', icon: UserCircle }, // ✅ NEW - for SGA role
  { id: 9, name: 'SGA Management', href: '/dashboard/admin/sga-management', icon: Users }, // ✅ NEW - Admin only
];
```

**Note:** The `filteredPages` logic already filters by `allowedPages` from permissions, so no additional filtering needed.

### Step 9.2: Update Permissions

**Cursor.ai Prompt:**
Update `src/lib/permissions.ts` to map new page IDs to the correct roles.

**Code to update in ROLE_PERMISSIONS:**
```typescript
const ROLE_PERMISSIONS: Record<string, Omit<UserPermissions, 'sgaFilter' | 'sgmFilter'>> = {
  admin: {
    role: 'admin',
    allowedPages: [1, 2, 3, 4, 5, 6, 7, 8, 9], // ✅ Added 8 (SGA Hub), 9 (SGA Management)
    canExport: true,
    canManageUsers: true,
  },
  manager: {
    role: 'manager',
    allowedPages: [1, 2, 3, 4, 5, 6, 7, 8, 9], // ✅ Added 8, 9
    canExport: true,
    canManageUsers: true,
  },
  sgm: {
    role: 'sgm',
    allowedPages: [1, 2, 3, 6], // ✅ No change (SGM doesn't need SGA Hub)
    canExport: true,
    canManageUsers: false,
  },
  sga: {
    role: 'sga',
    allowedPages: [1, 2, 6, 8], // ✅ Added 8 (SGA Hub) - SGAs can access their own hub
    canExport: true,
    canManageUsers: false,
  },
  viewer: {
    role: 'viewer',
    allowedPages: [1, 2], // ✅ No change
    canExport: false,
    canManageUsers: false,
  },
};
```

### Step 9.3: Add Test Users

**Cursor.ai Prompt:**
Add Eleni, Perry, Russell, and David to the database with correct roles.

**✅ VERIFIED:** User model has `name` field (String, required) which matches `SGA_Owner_Name__c` in BigQuery.

**Test Users to Add:**
- Eleni Stefanopoulos (email: eleni@savvywealth.com, role: sga, name: "Eleni Stefanopoulos")
- Perry Kalmeta (email: perry.kalmeta@savvywealth.com, role: sga, name: "Perry Kalmeta")
- Russell Armitage (email: russell.armitage@savvywealth.com, role: admin, name: "Russell Armitage")
- David [Last Name] (email: david@savvywealth.com, role: manager, name: "David [Last Name]")

**Important:** The `name` field MUST match exactly (case-sensitive) with `SGA_Owner_Name__c` values in BigQuery for filtering to work.

### Verification Gate 9:

* [ ] Sidebar shows correct pages per role
* [ ] Permissions enforced
* [ ] Test users can login

**Checkpoint:**

```bash
git add -A && git commit -m "Phase 9: Add navigation and permissions for SGA Hub and Admin pages"

```

---

## Phase 10: Final Integration & Testing

### Step 10.1: Full Application Test

**Cursor.ai Prompt:**
Verify build and perform user role testing (Admin vs SGA vs Viewer).

### Step 10.2: BigQuery Data Verification with MCP

**Cursor.ai Prompt:**
Compare manual SQL counts against application display values for test users.

### Step 10.3: Error Handling & Edge Cases

**Cursor.ai Prompt:**
Test empty data states, missing goals, and date boundary cases.

### Step 10.4: Final Cleanup

**Cursor.ai Prompt:**
Remove logs, add JSDoc, format code, and update `README.md`.

### Verification Gate 10:

* [ ] Production build successful
* [ ] Edge cases handled
* [ ] README updated

**Final Checkpoint:**

```bash
git add -A && git commit -m "Phase 10: Final integration testing and cleanup complete"
git tag -a v2.0.0-sga-hub -m "SGA Hub Feature Release"

```
